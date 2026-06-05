(function(window) {
  // ============================================================
  // JSONP 工具函式 — 完全繞過 CORS，file:// 協議也能用
  // ============================================================
  function fetchJSONP(url, timeout = 10000) {
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
      script.src = `${url}${sep}callback=${cbName}`;
      document.head.appendChild(script);
    });
  }

  // ============================================================
  // ============================================================
  // CORS Proxy 備援
  // ============================================================
  const PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy/?quest=',
    'https://corsproxy.io/?',
    null
  ];

  // Sticky proxy：記住上次成功的 proxy，下次排第一
  let _lastWorkingProxyIdx = 0;

  async function fetchWithTimeout(url, timeout = 6000) { // 調大超時至 6 秒
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

  async function fetchWithProxyFallback(targetUrl, validateFn = null) {
    // 把上次成功的 proxy 移到最前面
    const orderedProxies = [
      ...PROXIES.slice(_lastWorkingProxyIdx),
      ...PROXIES.slice(0, _lastWorkingProxyIdx)
    ];

    let lastError = null;
    for (const proxy of orderedProxies) {
      const url = proxy ? `${proxy}${encodeURIComponent(targetUrl)}` : targetUrl;
      try {
        const response = await fetchWithTimeout(url);
        if (response.ok) {
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

          // 阻擋代理回傳之無效或錯誤 JSON 結構（例如 corsproxy.io 付費提示）
          if (parsed && parsed.error) {
            throw new Error(`代理回傳錯誤訊息: ${JSON.stringify(parsed.error)}`);
          }

          // 驗證回傳的資料結構是否符合該 API 預期
          if (validateFn && !validateFn(parsed)) {
            throw new Error('回傳資料格式不符合預期（可能被代理伺服器攔截）');
          }

          // 記住這次成功的 proxy index
          _lastWorkingProxyIdx = PROXIES.indexOf(proxy);
          return parsed;
        }
      } catch (err) {
        console.warn(`[Proxy] 失敗: ${proxy}`, err.message);
        lastError = err;
      }
    }
    throw lastError || new Error('所有代理連線失敗');
  }

  async function fetchTWSEQuotes(normalizedSymbols) {
    // 組合 ex_ch 字串：tse_2330.tw|otc_6547.tw
    const exChParts = normalizedSymbols.map(sym => {
      const code = sym.replace(/\.(TW|TWO)$/i, '');
      const isOTC = sym.toUpperCase().endsWith('.TWO');
      return `${isOTC ? 'otc' : 'tse'}_${code.toLowerCase()}.tw`;
    });
    const exCh = exChParts.join('|');
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0&_=${Date.now()}`;

    console.log(`[TWSE] 代理查詢中... ex_ch=${exCh}`);

    let data;
    try {
      data = await fetchWithProxyFallback(url, (json) => json && Array.isArray(json.msgArray));
    } catch (e) {
      console.warn('[TWSE] 代理請求失敗：', e.message);
      throw e;
    }
    const results = {};

    if (!data || !Array.isArray(data.msgArray)) {
      console.warn('[TWSE] 回傳格式異常:', data);
      return results;
    }

    data.msgArray.forEach(item => {
      const code = (item.c || '').toUpperCase();
      if (!code) return;

      // 找回對應的完整 symbol（.TW 或 .TWO）
      const matchedSym = normalizedSymbols.find(s => {
        const cleanS = s.split('.')[0].toUpperCase();
        return cleanS === code;
      });
      if (!matchedSym) return;

      const symKey = matchedSym.toUpperCase();

      // z = 當前成交價，y = 昨日收盤
      // 盤中 z 有數字；收盤後 z 可能是 '-' → parseFloat('-') = NaN
      const z = parseFloat(item.z) || 0;
      const y = parseFloat(item.y) || 0;
      const openP = parseFloat(item.o) || 0;
      const highP = parseFloat(item.h) || 0;
      const lowP = parseFloat(item.l) || 0;
      const volume = parseFloat(item.v) || 0;
      const time = item.t || '-';
      const bid = item.b ? (parseFloat(item.b.split('_')[0]) || 0) : 0;
      const ask = item.a ? (parseFloat(item.a.split('_')[0]) || 0) : 0;

      // 收盤後 z=0, o=0 → 使用昨收 y 作為參考價
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

      console.log(`[TWSE] ${symKey}: ${isOffline ? '(離線/收盤)' : ''} 現價=${currentPrice.toFixed(2)}, 昨收=${prevClose > 0 ? prevClose.toFixed(2) : 'N/A'}`);
    });

    return results;
  }


  // ============================================================
  // 批次取得即時報價 (主入口 - 支援本地與線上智慧模式 + 快取機制)
  // ============================================================
  const SYMBOL_MAPPING = {
    'T00.TW': '^TWII',
    'O00.TWO': '^TWOII',
    'T13.TW': '^TELI',
    'T17.TW': '^TFNI'
  };

  async function fetchBatchQuotes(symbols) {
    if (!symbols || symbols.length === 0) return {};

    // 標準化所有代號（補 .TW 後綴）
    const normalized = symbols.map(s => {
      let sym = s.toUpperCase().trim();
      if (!sym.includes('.')) sym = `${sym}.TW`;
      return sym;
    });

    const results = {};
    const indexSymbols = ['T00.TW', 'O00.TWO', 'T13.TW', 'T17.TW'];
    const stockSymbols = normalized.filter(sym => !indexSymbols.includes(sym));

    // 1. 先嘗試使用 TWSE API 批次查詢一般個股（因為 TWSE 有買進、賣出、開盤等即時最完整數據）
    if (stockSymbols.length > 0) {
      try {
        const twseResults = await fetchTWSEQuotes(stockSymbols);
        Object.keys(twseResults).forEach(sym => {
          if (twseResults[sym] && twseResults[sym].price > 0) {
            results[sym] = twseResults[sym];
          }
        });
        
        // 補足中文名稱（優先使用 API 回傳，若無則從本地字典取得）
        for (const sym of stockSymbols) {
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
        console.warn('[fetchBatchQuotes] TWSE 批次查詢失敗，將全數備援至 Yahoo:', e.message);
      }
    }

    // 2. 篩選出需要使用 Yahoo Chart 查詢的代號（大盤指數，或是 TWSE 查詢失敗的個股）
    const yahooSymbols = normalized.filter(sym => !results[sym] || results[sym].price <= 0);

    if (yahooSymbols.length > 0) {
      // 並行發送 Yahoo Chart 請求
      const fetchPromises = yahooSymbols.map(async (sym) => {
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

            // 獲取本地字典名稱，填補中文名稱 (若有)
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

            // 優化 Yahoo Chart 開盤、最高、最低的解析，增加從 indicators.quote 讀取的備份
            const rawOpen = meta.regularMarketOpen || result.indicators?.quote?.[0]?.open?.[0];
            const rawHigh = meta.regularMarketDayHigh || result.indicators?.quote?.[0]?.high?.[0];
            const rawLow = meta.regularMarketDayLow || result.indicators?.quote?.[0]?.low?.[0];

            results[sym] = {
              symbol: sym, // 保持原始的 Symbol
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
      });

      await Promise.all(fetchPromises);
    }

    // 快取備份與復原機制
    normalized.forEach(sym => {
      const q = results[sym];
      const cacheKey = `cached_quote_${sym}`;
      if (q && q.price > 0 && !q.offline && !q.error) {
        localStorage.setItem(cacheKey, JSON.stringify(q));
      } else {
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

    // 4. 最後還是完全拿不到任何資料的股票，標記離線
    normalized.forEach(sym => {
      if (!results[sym]) {
        results[sym] = { symbol: sym, price: 0, change: 0, changePercent: 0, offline: true, error: true };
      }
    });

    return results;
  }

  // ============================================================
  // 單個股票查詢（Fetch + Proxy + 快取支援）
  // ============================================================
  async function fetchSingleStockQuote(symbol) {
    let sym = symbol.toUpperCase().trim();
    if (!sym.includes('.')) sym = `${sym}.TW`;

    // 1. 先試 TWSE 經由 Proxy 查詢
    try {
      const r = await fetchTWSEQuotes([sym]);
      if (r[sym] && r[sym].price > 0) {
        localStorage.setItem(`cached_quote_${sym}`, JSON.stringify(r[sym]));
        return r[sym];
      }
    } catch (e) {
      console.warn(`[fetchSingle] ${sym} TWSE 查詢失敗:`, e.message);
    }

    // 2. 備援使用 Yahoo Finance Chart 經由 Proxy 查詢
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
        
        // 優化 Yahoo Chart 開盤、最高、最低的解析，增加從 indicators.quote 讀取的備份
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
        localStorage.setItem(`cached_quote_${sym}`, JSON.stringify(quote));
        return quote;
      }
    } catch (error) {
      console.error(`[fetchSingle] ${sym} 全部失敗，試圖從快取復原:`, error.message);
    }

    // 3. 快取備用
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
  // 搜尋功能（保持不變）
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
  // 獲取歷史配息與快取支援 (包含跨域 Fallback，快取 7 天)
  // ============================================================
  async function fetchStockDividends(symbol) {
    let sym = symbol.toUpperCase().trim();
    if (!sym.includes('.')) sym = `${sym}.TW`;

    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=10y&events=div&_=${Date.now()}`;
    console.log(`[API] 查詢配息歷史: ${sym}`);
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
            const dateStr = divDate.toISOString().split('T')[0]; // YYYY-MM-DD
            dividends.push({
              date: dateStr,
              amount: Number(item.amount) || 0
            });
          }
        });
      }
      // 按日期升序排列
      dividends.sort((a, b) => new Date(a.date) - new Date(b.date));
      console.log(`[API] ${sym} 獲取到 ${dividends.length} 筆配息紀錄`);
      return dividends;
    } catch (e) {
      console.warn(`[API] 獲取 ${sym} 歷史配息失敗:`, e.message);
      return [];
    }
  }

  async function getStockDividendsWithCache(symbol) {
    let sym = symbol.toUpperCase().trim();
    if (!sym.includes('.')) sym = `${sym}.TW`;

    // 大盤與指數等，直接回傳空陣列
    const indexSymbols = ['T00.TW', 'O00.TWO', 'T13.TW', 'T17.TW'];
    if (indexSymbols.includes(sym)) {
      return [];
    }

    const cacheKey = `cached_dividends_${sym}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        // 7 天有效期 (7 * 24 * 60 * 60 * 1000)
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
      // 失敗時若有過期快取則備用
      if (cached) {
        try {
          return JSON.parse(cached).data;
        } catch (e) {}
      }
      return [];
    }
  }

  window.StockAPI = {
    fetchJSONP,
    fetchStockQuote: fetchSingleStockQuote,
    fetchBatchQuotes,
    searchStock,
    initializeLocalStockDictionary,
    fetchWithProxyFallback,
    getStockDividendsWithCache
  };
})(window);
