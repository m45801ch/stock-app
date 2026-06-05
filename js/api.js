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
    'https://api.codetabs.com/v1/proxy/?quest=',
    'https://api.allorigins.win/raw?url=',
    'https://cors-proxy.htmldev.workers.dev/?url=', 
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

  async function fetchWithProxyFallback(targetUrl) {
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
      data = await fetchWithProxyFallback(url);
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
  async function fetchBatchQuotes(symbols) {
    if (!symbols || symbols.length === 0) return {};

    // 標準化所有代號（補 .TW 後綴）
    const normalized = symbols.map(s => {
      let sym = s.toUpperCase().trim();
      if (!sym.includes('.')) sym = `${sym}.TW`;
      return sym;
    });

    const results = {};

    // 1. 優先使用 TWSE 進行批次查詢 (經由 Proxy)
    try {
      const twseData = await fetchTWSEQuotes(normalized);
      Object.assign(results, twseData);
      console.log(`[TWSE] 批次共取得 ${Object.keys(twseData).length}/${normalized.length} 筆`);
    } catch (err) {
      console.warn('[TWSE] 批次查詢失敗，將進入 Yahoo 補救:', err.message);
    }

    // 2. 補救 missing 或價格為 0 的股票 (使用 Yahoo Finance API + Proxy)
    const missing = normalized.filter(sym => !results[sym] || results[sym].price === 0 || results[sym].offline);
    if (missing.length > 0) {
      console.log(`[Yahoo 補救] ${missing.length} 檔:`, missing);
      try {
        const symbolString = missing.join(',');
        const targetUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbolString}&_=${Date.now()}`;
        const data = await fetchWithProxyFallback(targetUrl);
        const quoteList = data.quoteResponse?.result || [];

        quoteList.forEach(q => {
          const sym = q.symbol.toUpperCase();
          const price = q.regularMarketPrice || q.regularMarketPreviousClose || q.chartPreviousClose || 0;
          const change = q.regularMarketChange ?? 0;
          const changePercent = q.regularMarketChangePercent ?? 0;
          const openP = q.regularMarketOpen || 0;
          const prevClose = q.regularMarketPreviousClose || 0;
          const highP = q.regularMarketDayHigh || 0;
          const lowP = q.regularMarketDayLow || 0;
          const volume = q.regularMarketVolume ? q.regularMarketVolume / 1000 : 0; // 股轉張
          const bid = q.bid || 0;
          const ask = q.ask || 0;
          
          let time = '-';
          if (q.regularMarketTime) {
            const dateObj = new Date(q.regularMarketTime * 1000);
            time = dateObj.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
          }

          results[sym] = {
            symbol: sym,
            price: Number(price.toFixed(2)),
            change: Number(change.toFixed(2)),
            changePercent: Number(changePercent.toFixed(2)),
            open: openP > 0 ? Number(openP.toFixed(2)) : '-',
            prevClose: prevClose > 0 ? Number(prevClose.toFixed(2)) : '-',
            high: highP > 0 ? Number(highP.toFixed(2)) : '-',
            low: lowP > 0 ? Number(lowP.toFixed(2)) : '-',
            volume: volume >= 0 ? Number(volume.toFixed(0)) : '-',
            time: time,
            bid: bid > 0 ? Number(bid.toFixed(2)) : '-',
            ask: ask > 0 ? Number(ask.toFixed(2)) : '-',
            source: 'Yahoo'
          };
        });
      } catch (err) {
        console.warn('[Yahoo 補救] 失敗，準備嘗試從本地快取中讀取備用資料:', err.message);
      }
    }

    // 3. 快取備份機制：
    // 對於成功獲取到有效價格的股票，存入 localStorage 備份
    // 對於最終失敗或被標記離線的股票，從 localStorage 備份中讀取
    normalized.forEach(sym => {
      const q = results[sym];
      const cacheKey = `cached_quote_${sym}`;
      if (q && q.price > 0 && !q.offline && !q.error) {
        // 存入快取
        localStorage.setItem(cacheKey, JSON.stringify(q));
      } else {
        // 從快取讀取
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          try {
            const parsed = JSON.parse(cachedData);
            parsed.offline = true; // 標記為離線快取資料
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
      const data = await fetchWithProxyFallback(targetUrl);
      const result = data.chart?.result?.[0];
      if (result) {
        const meta = result.meta;
        const price = meta.regularMarketPrice || meta.chartPreviousClose || 0;
        const prevClose = meta.previousClose || meta.chartPreviousClose || price;
        const change = price - prevClose;
        const changePercent = prevClose ? (change / prevClose) * 100 : 0;
        
        const quote = {
          symbol: sym,
          price: Number(price.toFixed(2)),
          change: Number(change.toFixed(2)),
          changePercent: Number(changePercent.toFixed(2)),
          open: meta.regularMarketOpen ? Number(meta.regularMarketOpen.toFixed(2)) : '-',
          prevClose: prevClose ? Number(prevClose.toFixed(2)) : '-',
          high: meta.regularMarketDayHigh ? Number(meta.regularMarketDayHigh.toFixed(2)) : '-',
          low: meta.regularMarketDayLow ? Number(meta.regularMarketDayLow.toFixed(2)) : '-',
          volume: meta.regularMarketVolume ? Number((meta.regularMarketVolume / 1000).toFixed(0)) : '-',
          time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '-',
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
      const data = await fetchWithProxyFallback(targetUrl);
      const quotes = data.quotes || [];
      return quotes
        .filter(q => {
          const s = q.symbol.toUpperCase();
          return s.endsWith('.TW') || s.endsWith('.TWO');
        })
        .map(q => ({
          symbol: q.symbol.toUpperCase(),
          name: q.longname || q.shortname || cleanKeyword,
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

  window.StockAPI = {
    fetchJSONP,
    fetchStockQuote: fetchSingleStockQuote,
    fetchBatchQuotes,
    searchStock,
    initializeLocalStockDictionary
  };
})(window);
