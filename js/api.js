(function(window) {
  // ============================================================
  // JSONP 工具函式 — 完全繞過 CORS，file:// 協議也能用
  // ============================================================
  function fetchJSONP(url, timeout = 8000, callbackParam = 'callback') {
    return new Promise((resolve, reject) => {
      const cbName = 'stockCb_' + Math.random().toString(36).substr(2, 9);
      const script = document.createElement('script');
      let done = false;

      const cleanup = () => {
        done = true;
        delete window[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      const timer = setTimeout(() => {
        if (!done) { cleanup(); reject(new Error('JSONP timeout')); }
      }, timeout);

      window[cbName] = (data) => {
        clearTimeout(timer);
        cleanup();
        resolve(data);
      };

      script.onerror = () => {
        clearTimeout(timer);
        cleanup();
        reject(new Error('JSONP script load error'));
      };

      const sep = url.includes('?') ? '&' : '?';
      script.src = `${url}${sep}${callbackParam}=${cbName}`;
      document.head.appendChild(script);
    });
  }

  // ============================================================
  // TWSE 直連 JSONP — 不需 CORS Proxy，更快更穩定
  // ============================================================
  async function fetchTWSEViaJSONP(exCh, timeout = 8000) {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0&_=${Date.now()}`;
    try {
      const data = await fetchJSONP(url, timeout, 'jsoncallback');
      if (data && Array.isArray(data.msgArray)) {
        return data;
      }
      throw new Error('TWSE JSONP 回傳格式異常');
    } catch (err) {
      throw err;
    }
  }

  // ============================================================
  // 重試機制 — 指數退避
  // ============================================================
  async function withRetry(fn, maxRetries = 2, baseDelay = 1000) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  }

  // ============================================================
  // CORS Proxy 備援
  // ============================================================
  const PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
    'https://api.allorigins.win/get?url=',
    null
  ];

  let _lastWorkingProxyIdx = 0;
  // 優化：記住上次可用的 Proxy，下次啟動優先使用，省去逐個試錯的時間
  try {
    const savedIdx = parseInt(localStorage.getItem('stock_api_proxy_idx') || '', 10);
    if (!isNaN(savedIdx) && savedIdx >= 0 && savedIdx < PROXIES.length) {
      _lastWorkingProxyIdx = savedIdx;
    }
  } catch (e) {}

  function rememberWorkingProxy(proxy) {
    _lastWorkingProxyIdx = PROXIES.indexOf(proxy);
    try {
      localStorage.setItem('stock_api_proxy_idx', String(_lastWorkingProxyIdx));
    } catch (e) {}
  }

  async function fetchWithTimeout(url, timeout = 12000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  // 並行嘗試多個 Proxy，取最快成功者
  // 優化：先單獨試上次可用的 Proxy（最常見命中），失敗才並行試其餘，避免每次都等最慢的那個
  async function fetchWithProxyFallback(targetUrl, validateFn = null) {
    const orderedProxies = [
      ...PROXIES.slice(_lastWorkingProxyIdx),
      ...PROXIES.slice(0, _lastWorkingProxyIdx)
    ];

    const tryProxy = async (proxy) => {
      const url = proxy ? `${proxy}${encodeURIComponent(targetUrl)}` : targetUrl;
      const response = await fetchWithTimeout(url, 10000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && 'contents' in parsed) {
          parsed = JSON.parse(parsed.contents);
        }
      } catch (e) {
        if (text.includes('"contents":')) {
          const wrapped = JSON.parse(text);
          parsed = JSON.parse(wrapped.contents);
        } else throw e;
      }
      if (parsed && parsed.error) {
        throw new Error(`代理回傳錯誤: ${JSON.stringify(parsed.error)}`);
      }
      if (validateFn && !validateFn(parsed)) {
        throw new Error('回傳資料格式不符合預期');
      }
      rememberWorkingProxy(proxy);
      return parsed;
    };

    // 快捷路徑：先只試記住的 Proxy，命中則直接回傳（省一半流量與等待）
    const [fastPath, ...rest] = orderedProxies;
    try {
      return await tryProxy(fastPath);
    } catch (err) {
      console.warn(`[Proxy] 快捷失敗: ${fastPath}`, err.message);
      if (rest.length === 0) throw new Error('所有代理連線失敗');
    }

    // 慢速路徑：其餘 Proxy 兩兩並行嘗試
    for (let i = 0; i < rest.length; i += 2) {
      const batch = rest.slice(i, i + 2).map(p => tryProxy(p).catch(err => {
        console.warn(`[Proxy] 失敗: ${p}`, err.message);
        return null;
      }));
      const results = await Promise.all(batch);
      const success = results.find(r => r !== null);
      if (success) return success;
    }
    throw new Error('所有代理連線失敗');
  }

  // 優化：TWSE 一次塞太多代號時 URL 過長且任一代號異常會拖累整批；
  // 改為每批最多 10 檔並行查詢，單批失敗只備援該批，不擋其他批
  const TWSE_BATCH_SIZE = 10;
  const TWSE_JSONP_TIMEOUT = 5000;

  async function fetchTWSEBatch(batchSymbols) {
    const exChParts = batchSymbols.map(sym => {
      const code = sym.replace(/\.(TW|TWO)$/i, '');
      const isOTC = sym.toUpperCase().endsWith('.TWO');
      return `${isOTC ? 'otc' : 'tse'}_${code.toLowerCase()}.tw`;
    });
    const exCh = exChParts.join('|');
    console.log(`[TWSE] 查詢中... ex_ch=${exCh}`);

    // 策略 1：直接 JSONP (最快，不需 Proxy)
    try {
      const data = await withRetry(() => fetchTWSEViaJSONP(exCh, TWSE_JSONP_TIMEOUT), 1, 800);
      console.log(`[TWSE] JSONP 直連成功`);
      return parseTWSEQuoteData(data, batchSymbols);
    } catch (e) {
      console.warn('[TWSE] JSONP 直連失敗，切換至 Proxy:', e.message);
    }

    // 策略 2：透過 CORS Proxy（只備援這一小批）
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0&_=${Date.now()}`;
    const data = await fetchWithProxyFallback(url, (json) => json && Array.isArray(json.msgArray));
    console.log(`[TWSE] Proxy 查詢成功`);
    return parseTWSEQuoteData(data, batchSymbols);
  }

  async function fetchTWSEQuotes(normalizedSymbols) {
    if (!normalizedSymbols || normalizedSymbols.length === 0) return {};
    if (normalizedSymbols.length <= TWSE_BATCH_SIZE) {
      try {
        return await fetchTWSEBatch(normalizedSymbols);
      } catch (e) {
        console.warn('[TWSE] 全部方式失敗:', e.message);
        throw e;
      }
    }
    // 分批並行，各批獨立備援，單批失敗不拖累其他批
    const batches = [];
    for (let i = 0; i < normalizedSymbols.length; i += TWSE_BATCH_SIZE) {
      batches.push(normalizedSymbols.slice(i, i + TWSE_BATCH_SIZE));
    }
    const settled = await Promise.all(batches.map(batch =>
      fetchTWSEBatch(batch).catch(err => {
        console.warn('[TWSE] 某批次查詢失敗:', err.message);
        return {};
      })
    ));
    const merged = {};
    settled.forEach(part => Object.assign(merged, part));
    if (Object.keys(merged).length === 0) throw new Error('TWSE 全部批次查詢失敗');
    return merged;
  }

  function parseTWSEQuoteData(data, normalizedSymbols) {
    const results = {};
    if (!data || !Array.isArray(data.msgArray)) {
      console.warn('[TWSE] 回傳格式異常:', data);
      return results;
    }

    data.msgArray.forEach(item => {
      const code = (item.c || '').toUpperCase();
      if (!code) return;

      const matchedSym = normalizedSymbols.find(s => {
        const cleanS = s.split('.')[0].toUpperCase();
        return cleanS === code;
      });
      if (!matchedSym) return;

      const symKey = matchedSym.toUpperCase();

      const z = parseFloat(item.z) || 0;
      const y = parseFloat(item.y) || 0;
      const openP = parseFloat(item.o) || 0;
      const highP = parseFloat(item.h) || 0;
      const lowP = parseFloat(item.l) || 0;
      const volume = parseFloat(item.v) || 0;
      const time = item.t || '-';
      const bid = item.b ? (parseFloat(item.b.split('_')[0]) || 0) : 0;
      const ask = item.a ? (parseFloat(item.a.split('_')[0]) || 0) : 0;

      const currentPrice = z > 0 ? z : (openP > 0 ? openP : y);
      const prevClose = y > 0 ? y : currentPrice;
      const change = (currentPrice > 0 && prevClose > 0) ? currentPrice - prevClose : 0;
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
      const isOffline = currentPrice <= 0;

      results[symKey] = {
        symbol: symKey,
        name: item.n ? item.n.trim() : '',
        price: currentPrice > 0 ? Number(currentPrice.toFixed(2)) : (y > 0 ? Number(y.toFixed(2)) : 0),
        change: Number(change.toFixed(2)),
        changePercent: Number(changePercent.toFixed(2)),
        open: openP > 0 ? Number(openP.toFixed(2)) : '-',
        prevClose: prevClose > 0 ? Number(prevClose.toFixed(2)) : '-',
        high: highP > 0 ? Number(highP.toFixed(2)) : '-',
        low: lowP > 0 ? Number(lowP.toFixed(2)) : '-',
        volume: volume > 0 ? Number(volume.toFixed(0)) : '-',
        time: time,
        bid: bid > 0 ? Number(bid.toFixed(2)) : '-',
        ask: ask > 0 ? Number(ask.toFixed(2)) : '-',
        source: 'TWSE',
        offline: isOffline
      };
    });

    return results;
  }

  // ============================================================
  // 富果 (Fugle) 行情 API — 第三備源
  // ============================================================
  const FUGLE_API_KEY = 'NmY0ZmNhYzYtM2JlMS00Yzc3LWE1YTAtN2M5NmRlNGUzYWMyIGIyNDUyODRjLTI2MWEtNDA5NS1hMDQ0LTJmNDEwNTU4ZDUwMw==';

  async function fetchFugleQuoteDirect(code) {
    const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${code}?_=${Date.now()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        headers: { 'X-API-KEY': FUGLE_API_KEY },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !data.symbol) throw new Error('格式異常');
      return data;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  async function fetchFugleQuoteViaProxy(code) {
    const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${code}?apiKey=${FUGLE_API_KEY}&_=${Date.now()}`;
    return fetchWithProxyFallback(url, (data) => data && data.symbol);
  }

  async function fetchFugleQuotes(symbols, concurrency = 5) {
    const results = {};
    if (!symbols || symbols.length === 0) return results;

    const fetchOne = async (sym) => {
      const code = sym.replace(/\.(TW|TWO)$/i, '');
      let data = null;

      // 策略 1：直連 (若 Fugle 支援 CORS)
      try {
        data = await fetchFugleQuoteDirect(code);
      } catch (err) {
        console.warn(`[Fugle] ${sym} 直連失敗，嘗試代理:`, err.message);
      }

      // 策略 2：透過 Proxy (API key 改為 query param)
      if (!data) {
        try {
          data = await fetchFugleQuoteViaProxy(code);
        } catch (err) {
          console.warn(`[Fugle] ${sym} 代理查詢失敗:`, err.message);
        }
      }

      if (!data) return;

      const price = data.lastPrice || data.closePrice || 0;
      const prevClose = data.previousClose || data.referencePrice || 0;
      const change = data.change ?? (price - prevClose);
      const changePercent = data.changePercent ?? (prevClose ? (change / prevClose) * 100 : 0);

      const now = new Date();
      const time = now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });

      const bestBid = data.bids && data.bids.length > 0 ? data.bids[0].price : 0;
      const bestAsk = data.asks && data.asks.length > 0 ? data.asks[0].price : 0;

      results[sym] = {
        symbol: sym,
        name: data.name || '',
        price: price > 0 ? Number(price.toFixed(2)) : 0,
        change: Number(change.toFixed(2)),
        changePercent: Number(changePercent.toFixed(2)),
        open: data.openPrice > 0 ? Number(data.openPrice.toFixed(2)) : '-',
        prevClose: prevClose > 0 ? Number(prevClose.toFixed(2)) : '-',
        high: data.highPrice > 0 ? Number(data.highPrice.toFixed(2)) : '-',
        low: data.lowPrice > 0 ? Number(data.lowPrice.toFixed(2)) : '-',
        volume: data.total?.tradeVolume ? Number((data.total.tradeVolume / 1000).toFixed(0)) : '-',
        time: time,
        bid: bestBid > 0 ? Number(bestBid.toFixed(2)) : '-',
        ask: bestAsk > 0 ? Number(bestAsk.toFixed(2)) : '-',
        source: 'Fugle'
      };
    };

    // 優化：限制並發數，避免幾十檔同時打免費 Proxy 被 rate-limit 反而全慢
    for (let i = 0; i < symbols.length; i += concurrency) {
      const chunk = symbols.slice(i, i + concurrency);
      await Promise.all(chunk.map(fetchOne));
    }
    return results;
  }

  // ============================================================
  // 批次取得即時報價 (主入口)
  // ============================================================
  const SYMBOL_MAPPING = {
    'T00.TW': '^TWII',
    'O00.TWO': '^TWOII',
    'T13.TW': '^TELI',
    'T17.TW': '^TFNI'
  };

  function getTaipeiDate() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 8));
  }

  function isMarketOpen() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    }).formatToParts(now);

    const getVal = (type) => parts.find(p => p.type === type).value;
    const hour = parseInt(getVal('hour'), 10);
    const minute = parseInt(getVal('minute'), 10);
    const timeVal = hour * 100 + minute;

    const tzDate = getTaipeiDate();
    const day = tzDate.getDay();

    return (day >= 1 && day <= 5) && (timeVal >= 858 && timeVal <= 1335);
  }

  function getLastMarketCloseTime() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    }).formatToParts(now);

    const getVal = (type) => parts.find(p => p.type === type).value;
    const year = getVal('year');
    const month = getVal('month');
    const day = getVal('day');

    const tzDate = getTaipeiDate();
    const weekday = tzDate.getDay();

    const todayCloseTime = Date.parse(`${year}-${month}-${day}T13:35:00+08:00`);
    const nowTime = now.getTime();

    if (weekday === 0) {
      return todayCloseTime - 2 * 24 * 3600 * 1000;
    } else if (weekday === 6) {
      return todayCloseTime - 1 * 24 * 3600 * 1000;
    } else {
      if (nowTime < todayCloseTime) {
        const daysToSubtract = (weekday === 1) ? 3 : 1;
        return todayCloseTime - daysToSubtract * 24 * 3600 * 1000;
      } else {
        return todayCloseTime;
      }
    }
  }

  function isForceUpdateEnabled() {
    return localStorage.getItem('stock_app_force_update') === 'true';
  }

  async function fetchBatchQuotes(symbols, force = false) {
    if (!symbols || symbols.length === 0) return {};

    const normalized = symbols.map(s => {
      let sym = s.toUpperCase().trim();
      if (!sym.includes('.')) sym = `${sym}.TW`;
      return sym;
    });

    const results = {};
    const useCacheOnly = !force && !isMarketOpen() && !isForceUpdateEnabled();
    const lastCloseTime = getLastMarketCloseTime();

    const symbolsToFetch = [];
    normalized.forEach(sym => {
      const cacheKey = `cached_quote_${sym}`;
      const cachedData = localStorage.getItem(cacheKey);
      if (useCacheOnly && cachedData) {
        try {
          const parsed = JSON.parse(cachedData);
          if (parsed && parsed.price > 0 && parsed.fetchTime && parsed.fetchTime >= lastCloseTime) {
            parsed.offline = true;
            results[sym] = parsed;
          } else {
            symbolsToFetch.push(sym);
          }
        } catch (e) {
          symbolsToFetch.push(sym);
        }
      } else {
        symbolsToFetch.push(sym);
      }
    });

    if (symbolsToFetch.length > 0) {
      // 先透過 TWSE 查詢所有代號（包含大盤指數），TWSE JSONP 也支援 tse_t00.tw 等指數
      try {
        const twseResults = await fetchTWSEQuotes(symbolsToFetch);
        Object.keys(twseResults).forEach(sym => {
          if (twseResults[sym] && twseResults[sym].price > 0) {
            results[sym] = twseResults[sym];
          }
        });

        for (const sym of symbolsToFetch) {
          if (results[sym] && !results[sym].name) {
            try {
              const dictStock = await window.StockDB.getStockFromDictionary(sym);
              if (dictStock && dictStock.name) {
                results[sym].name = dictStock.name;
              }
            } catch (e) {}
          }
        }
      } catch (e) {
        console.warn('[fetchBatchQuotes] TWSE 查詢失敗，備援至 Fugle:', e.message);
      }

      const fugleSymbols = symbolsToFetch.filter(sym => {
        const isIndex = sym === 'T00.TW' || sym === 'O00.TWO' || sym === 'T13.TW' || sym === 'T17.TW';
        return !isIndex && (!results[sym] || results[sym].price <= 0);
      });

      if (fugleSymbols.length > 0) {
        try {
          const fugleResults = await fetchFugleQuotes(fugleSymbols);
          Object.keys(fugleResults).forEach(sym => {
            if (fugleResults[sym] && fugleResults[sym].price > 0) {
              results[sym] = fugleResults[sym];
            }
          });
        } catch (e) {
          console.warn('[fetchBatchQuotes] Fugle 查詢失敗，備援至 Yahoo:', e.message);
        }
      }

      const yahooSymbols = symbolsToFetch.filter(sym => !results[sym] || results[sym].price <= 0);

      if (yahooSymbols.length > 0) {
        // 優化：一次只並行 4 檔 Yahoo，避免免費 Proxy 被打爆反而全超時
        const fetchOneYahoo = async (sym) => {
          const yahooSym = SYMBOL_MAPPING[sym] || sym;
          const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=2d&_=${Date.now()}`;
          try {
            const data = await fetchWithProxyFallback(targetUrl, (json) => json && json.chart && Array.isArray(json.chart.result));
            const result = data.chart?.result?.[0];
            if (result) {
              const meta = result.meta;
              const price = meta.regularMarketPrice || meta.chartPreviousClose || 0;
              const prevClose = meta.previousClose || meta.chartPreviousClose || price;
              const change = price - prevClose;
              const changePercent = prevClose ? (change / prevClose) * 100 : 0;

              const now = new Date();
              const time = now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });

              let displayName = '';
              if (sym === 'T00.TW') displayName = '加權指數';
              else if (sym === 'O00.TWO') displayName = '櫃買指數';
              else if (sym === 'T13.TW') displayName = '電子指數';
              else if (sym === 'T17.TW') displayName = '金融指數';
              else {
                try {
                  const dictStock = await window.StockDB.getStockFromDictionary(sym);
                  if (dictStock && dictStock.name) {
                    displayName = dictStock.name;
                  }
                } catch (e) {}
              }

              const rawOpen = meta.regularMarketOpen || result.indicators?.quote?.[0]?.open?.[0];
              const rawHigh = meta.regularMarketDayHigh || result.indicators?.quote?.[0]?.high?.[0];
              const rawLow = meta.regularMarketDayLow || result.indicators?.quote?.[0]?.low?.[0];

              results[sym] = {
                symbol: sym,
                name: displayName || results[sym]?.name || '',
                price: Number(price.toFixed(2)),
                change: Number(change.toFixed(2)),
                changePercent: Number(changePercent.toFixed(2)),
                open: (rawOpen && rawOpen > 0) ? Number(rawOpen.toFixed(2)) : '-',
                prevClose: prevClose ? Number(prevClose.toFixed(2)) : '-',
                high: (rawHigh && rawHigh > 0) ? Number(rawHigh.toFixed(2)) : '-',
                low: (rawLow && rawLow > 0) ? Number(rawLow.toFixed(2)) : '-',
                volume: meta.regularMarketVolume ? Number((meta.regularMarketVolume / 1000).toFixed(0)) : '-',
                time: time,
                bid: '-',
                ask: '-',
                source: 'Yahoo-chart'
              };
            }
          } catch (err) {
            console.warn(`[Yahoo] 查詢 ${sym} (${yahooSym}) 失敗:`, err.message);
          }
        };

        for (let i = 0; i < yahooSymbols.length; i += 4) {
          await Promise.all(yahooSymbols.slice(i, i + 4).map(fetchOneYahoo));
        }
      }
    }

    normalized.forEach(sym => {
      const q = results[sym];
      const cacheKey = `cached_quote_${sym}`;
      if (q && q.price > 0 && !q.offline && !q.error) {
        q.fetchTime = Date.now();
        localStorage.setItem(cacheKey, JSON.stringify(q));
      } else if (!force) {
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          try {
            const parsed = JSON.parse(cachedData);
            parsed.offline = true;
            results[sym] = parsed;
            console.log(`[快取備份] ${sym} 復原成功: 現價=${parsed.price}`);
          } catch (e) {
            console.error(`[快取復原失敗] ${sym}:`, e);
          }
        }
      }
    });

    normalized.forEach(sym => {
      if (!results[sym]) {
        results[sym] = { symbol: sym, price: 0, change: 0, changePercent: 0, offline: true, error: true };
      }
    });

    return results;
  }

  // ============================================================
  // 單個股票查詢
  // ============================================================
  async function fetchSingleStockQuote(symbol) {
    let sym = symbol.toUpperCase().trim();
    if (!sym.includes('.')) sym = `${sym}.TW`;

    try {
      const r = await fetchTWSEQuotes([sym]);
      if (r[sym] && r[sym].price > 0) {
        r[sym].fetchTime = Date.now();
        localStorage.setItem(`cached_quote_${sym}`, JSON.stringify(r[sym]));
        return r[sym];
      }
    } catch (e) {
      console.warn(`[fetchSingle] ${sym} TWSE 查詢失敗:`, e.message);
    }

    try {
      const fugleResult = await fetchFugleQuotes([sym]);
      if (fugleResult[sym] && fugleResult[sym].price > 0) {
        fugleResult[sym].fetchTime = Date.now();
        localStorage.setItem(`cached_quote_${sym}`, JSON.stringify(fugleResult[sym]));
        return fugleResult[sym];
      }
    } catch (e) {
      console.warn(`[fetchSingle] ${sym} Fugle 查詢失敗:`, e.message);
    }

    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d&_=${Date.now()}`;
    try {
      const data = await fetchWithProxyFallback(targetUrl, (json) => json && json.chart && Array.isArray(json.chart.result));
      const result = data.chart?.result?.[0];
      if (result) {
        const meta = result.meta;
        const price = meta.regularMarketPrice || meta.chartPreviousClose || 0;
        const prevClose = meta.previousClose || meta.chartPreviousClose || price;
        const change = price - prevClose;
        const changePercent = prevClose ? (change / prevClose) * 100 : 0;

        const rawOpen = meta.regularMarketOpen || result.indicators?.quote?.[0]?.open?.[0];
        const rawHigh = meta.regularMarketDayHigh || result.indicators?.quote?.[0]?.high?.[0];
        const rawLow = meta.regularMarketDayLow || result.indicators?.quote?.[0]?.low?.[0];

        const quote = {
          symbol: sym,
          price: Number(price.toFixed(2)),
          change: Number(change.toFixed(2)),
          changePercent: Number(changePercent.toFixed(2)),
          open: (rawOpen && rawOpen > 0) ? Number(rawOpen.toFixed(2)) : '-',
          prevClose: prevClose ? Number(prevClose.toFixed(2)) : '-',
          high: (rawHigh && rawHigh > 0) ? Number(rawHigh.toFixed(2)) : '-',
          low: (rawLow && rawLow > 0) ? Number(rawLow.toFixed(2)) : '-',
          volume: meta.regularMarketVolume ? Number((meta.regularMarketVolume / 1000).toFixed(0)) : '-',
          time: new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' }),
          bid: '-',
          ask: '-',
          source: 'Yahoo-chart'
        };
        quote.fetchTime = Date.now();
        localStorage.setItem(`cached_quote_${sym}`, JSON.stringify(quote));
        return quote;
      }
    } catch (error) {
      console.error(`[fetchSingle] ${sym} 全部失敗，試圖從快取復原:`, error.message);
    }

    const cachedData = localStorage.getItem(`cached_quote_${sym}`);
    if (cachedData) {
      try {
        const parsed = JSON.parse(cachedData);
        parsed.offline = true;
        return parsed;
      } catch (err) {}
    }

    return { symbol: sym, price: 0, change: 0, changePercent: 0, offline: true, error: true };
  }

  // ============================================================
  // 搜尋功能
  // ============================================================
  async function searchStock(keyword) {
    if (!keyword || keyword.trim() === '') return [];
    const cleanKeyword = keyword.trim();

    try {
      const localResults = await window.StockDB.searchStocksLocally(cleanKeyword);
      if (localResults.length > 0) {
        return localResults.map(s => ({
          symbol: s.symbol,
          name: s.name,
          exchange: s.symbol.endsWith('.TWO') ? 'TWO' : 'TAI',
          typeDisp: 'EQUITY'
        }));
      }

      const targetUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(cleanKeyword)}&lang=zh-Hant-TW&quotesCount=10`;
      const data = await fetchWithProxyFallback(targetUrl, (json) => json && Array.isArray(json.quotes));
      const quotes = data.quotes || [];
      return quotes
        .filter(q => {
          const s = q.symbol.toUpperCase();
          return s.endsWith('.TW') || s.endsWith('.TWO');
        })
        .map(q => ({
          symbol: q.symbol.toUpperCase(),
          name: q.longName || q.shortName || q.longname || q.shortname || cleanKeyword,
          exchange: q.exchange,
          typeDisp: 'EQUITY'
        }));
    } catch (error) {
      console.error('搜尋失敗:', error);
      if (/^\d+$/.test(cleanKeyword)) {
        return [
          { symbol: `${cleanKeyword}.TW`, name: `台股 ${cleanKeyword} (上市)`, exchange: 'TAI', typeDisp: 'EQUITY' },
          { symbol: `${cleanKeyword}.TWO`, name: `台股 ${cleanKeyword} (上櫃)`, exchange: 'TWO', typeDisp: 'EQUITY' }
        ];
      }
      return [];
    }
  }

  // ============================================================
  // 初始化本地台股字典
  // ============================================================
  async function initializeLocalStockDictionary(onProgress) {
    try {
      if (onProgress) onProgress('正在載入台股本地資料庫...');
      if (window.PRESET_STOCK_LIST && window.PRESET_STOCK_LIST.length > 0) {
        const dbList = window.PRESET_STOCK_LIST.map(item => ({
          symbol: item.s,
          code: item.c,
          name: item.n
        }));
        await window.StockDB.saveStocksToDictionary(dbList);
        console.log(`[DB] 本地台股字典載入成功，共 ${dbList.length} 檔！`);
        if (onProgress) onProgress(`台股資料庫已就緒 (${dbList.length} 檔)`);
      } else {
        throw new Error('未偵測到預載的台股名冊 (PRESET_STOCK_LIST)');
      }
    } catch (e) {
      console.error('[DB] 建置本地台股字典失敗:', e);
      if (onProgress) onProgress('資料庫載入失敗，已啟用線上備援');
    }
  }

  // ============================================================
  // 獲取歷史配息 (支援快取)
  // ============================================================
  async function fetchStockDividends(symbol) {
    let sym = symbol.toUpperCase().trim();
    if (!sym.includes('.')) sym = `${sym}.TW`;

    const yahooHosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
    const ranges = ['5y', '10y'];

    console.log(`[API] 查詢配息歷史: ${sym}`);

    for (const host of yahooHosts) {
      for (const range of ranges) {
        const targetUrl = `https://${host}/v8/finance/chart/${sym}?interval=1d&range=${range}&events=div&_=${Date.now()}`;
        try {
          const data = await fetchWithProxyFallback(targetUrl, (json) => json && json.chart && Array.isArray(json.chart.result));
          const result = data.chart?.result?.[0];
          const dividends = [];
          if (result && result.events && result.events.dividends) {
            const divObj = result.events.dividends;
            Object.keys(divObj).forEach(key => {
              const item = divObj[key];
              if (item && item.amount !== undefined) {
                const divDate = new Date(item.date * 1000);
                const dateStr = divDate.toISOString().split('T')[0];
                dividends.push({
                  date: dateStr,
                  amount: Number(item.amount) || 0
                });
              }
            });
          }
          if (dividends.length > 0) {
            dividends.sort((a, b) => new Date(a.date) - new Date(b.date));
            console.log(`[API] ${sym} 獲取到 ${dividends.length} 筆配息紀錄 (${host}, range=${range})`);
            return dividends;
          }
        } catch (e) {
          console.warn(`[API] ${host} range=${range} 失敗:`, e.message);
        }
      }
    }

    console.warn(`[API] ${sym} 所有配息查詢方式皆失敗`);
    return [];
  }

  async function getStockDividendsWithCache(symbol) {
    let sym = symbol.toUpperCase().trim();
    if (!sym.includes('.')) sym = `${sym}.TW`;

    const indexSymbols = ['T00.TW', 'O00.TWO', 'T13.TW', 'T17.TW'];
    if (indexSymbols.includes(sym)) {
      return [];
    }

    const cacheKey = `cached_dividends_${sym}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < 7 * 24 * 60 * 60 * 1000) {
          return data;
        }
      } catch (e) {
        console.warn(`[API] 解析配息快取失敗 ${sym}`, e);
      }
    }

    try {
      const data = await fetchStockDividends(sym);
      localStorage.setItem(cacheKey, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
      return data;
    } catch (err) {
      console.error(`[API] 獲取配息失敗 ${sym}`, err);
      if (cached) {
        try {
          return JSON.parse(cached).data;
        } catch (e) {}
      }
      return [];
    }
  }

  // 優化：同步讀取配息快取（不打網路），供首屏秒渲染用；背景再用 getStockDividendsWithCache 補新資料
  function getCachedDividendsSync(symbol) {
    let sym = (symbol || '').toUpperCase().trim();
    if (!sym) return [];
    if (!sym.includes('.')) sym = `${sym}.TW`;
    if (sym === 'T00.TW' || sym === 'O00.TWO' || sym === 'T13.TW' || sym === 'T17.TW') return [];
    try {
      const cached = localStorage.getItem(`cached_dividends_${sym}`);
      if (!cached) return [];
      const { data } = JSON.parse(cached);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  window.StockAPI = {
    fetchJSONP,
    fetchTWSEViaJSONP,
    fetchStockQuote: fetchSingleStockQuote,
    fetchBatchQuotes,
    searchStock,
    initializeLocalStockDictionary,
    fetchWithProxyFallback,
    getStockDividendsWithCache,
    getCachedDividendsSync,
    fetchFugleQuotes
  };
})(window);
