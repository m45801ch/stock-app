(function(window) {
  let expandedStocks = new Set();
  let expandedParentTxs = new Set(); // 記錄第二層折疊：哪些已平倉買入交易的「賣出子列」是展開狀態

  async function renderPortfolio(groupId) {
    const container = document.getElementById('portfolio-container');
    const summaryValuation = document.getElementById('summary-valuation');
    const summaryTodayChange = document.getElementById('summary-today-change');
    const summaryRealized = document.getElementById('summary-realized');
    const summaryUnrealized = document.getElementById('summary-unrealized');

    if (!container) return;

    container.innerHTML = '<div class="loading-state">讀取持股資料與最新報價中...</div>';

    try {
      const stocks = await window.StockDB.getStocksByGroup(groupId);
      if (stocks.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <p>此群組目前沒有股票</p>
            <p class="sub-text">請在上方搜尋列搜尋個股並點擊「加入」</p>
          </div>
        `;
        if (summaryValuation) summaryValuation.textContent = '$0 TWD';
        if (summaryTodayChange) summaryTodayChange.innerHTML = '-';
        if (summaryRealized) summaryRealized.innerHTML = '-';
        if (summaryUnrealized) summaryUnrealized.innerHTML = '-';
        return;
      }

      const symbols = stocks.map(s => s.symbol);
      const quotes = await window.StockAPI.fetchBatchQuotes(symbols);

      let portfolioItems = [];
      let totalMarketValue = 0;
      let totalCostValue = 0;
      let totalTodayChange = 0;
      let totalRealizedPnL = 0;
      let totalUnrealizedPnL = 0;

      // ── 並行取得所有股票的交易紀錄 + 字典名稱 ──
      const [allTxsList, allDictStocks] = await Promise.all([
        Promise.all(stocks.map(s => window.StockDB.getTransactionsByStock(groupId, s.symbol))),
        Promise.all(stocks.map(s => window.StockDB.getStockFromDictionary(s.symbol)))
      ]);

      for (let i = 0; i < stocks.length; i++) {
        const stock = stocks[i];
        const txs = allTxsList[i];
        const dictStock = allDictStocks[i];

        let lookupKey = stock.symbol.toUpperCase();
        if (!lookupKey.includes('.')) {
          lookupKey = `${lookupKey}.TW`;
        }
        let quote = quotes[lookupKey];
        if (!quote || quote.price === 0) {
          const tempCalc = window.StockUtils.calculatePortfolio(txs, 0);
          quote = {
            symbol: stock.symbol,
            price: tempCalc.averageCost,
            change: 0,
            changePercent: 0,
            open: '-',
            prevClose: '-',
            high: '-',
            low: '-',
            volume: '-',
            time: '-',
            bid: '-',
            ask: '-',
            isOffline: true
          };
        }

        const calc = window.StockUtils.calculatePortfolio(txs, quote.price);

        // 中文名稱自動導正機制
        let displayName = stock.name;
        if (dictStock && dictStock.name) {
          displayName = dictStock.name;
        }

        portfolioItems.push({
          stock,
          displayName,
          quote,
          calc,
          txs
        });

        totalMarketValue += calc.marketValue;
        totalCostValue += (calc.totalShares * calc.averageCost);
        totalRealizedPnL += calc.realizedPnL;
        totalUnrealizedPnL += calc.unrealizedPnL;

        if (!quote.isOffline) {
          totalTodayChange += (calc.totalShares * quote.change);
        }
      }

      // 股票排序處理
      const sortOrder = window.stockSortOrder || 'default';
      if (sortOrder === 'code-asc') {
        portfolioItems.sort((a, b) => a.stock.symbol.localeCompare(b.stock.symbol));
      } else if (sortOrder === 'change-desc') {
        portfolioItems.sort((a, b) => {
          const changeA = a.quote ? a.quote.changePercent : 0;
          const changeB = b.quote ? b.quote.changePercent : 0;
          return changeB - changeA;
        });
      }

      // --- 總覽面板渲染 ---
      if (summaryValuation) {
        summaryValuation.textContent = `$${window.StockUtils.formatNumber(totalMarketValue, 0)} TWD`;
      }

      if (summaryTodayChange) {
        const prevDayMarketValue = totalMarketValue - totalTodayChange;
        const todayChangePercent = prevDayMarketValue > 0 ? (totalTodayChange / prevDayMarketValue) * 100 : 0;
        
        const prefix = totalTodayChange > 0 ? '▲' : (totalTodayChange < 0 ? '▼' : '');
        const colorClass = totalTodayChange > 0 ? 'stock-up' : (totalTodayChange < 0 ? 'stock-down' : 'stock-flat');
        summaryTodayChange.className = `summary-value ${colorClass}`;
        summaryTodayChange.innerHTML = `${prefix} ${window.StockUtils.formatNumber(Math.abs(totalTodayChange), 2)} (${window.StockUtils.formatPercent(todayChangePercent)})`;
      }

      if (summaryUnrealized) {
        const totalUnrealizedPercent = totalCostValue > 0 ? (totalUnrealizedPnL / totalCostValue) * 100 : 0;
        const prefix = totalUnrealizedPnL > 0 ? '▲' : (totalUnrealizedPnL < 0 ? '▼' : '');
        const colorClass = totalUnrealizedPnL > 0 ? 'stock-up' : (totalUnrealizedPnL < 0 ? 'stock-down' : 'stock-flat');
        summaryUnrealized.className = `summary-value ${colorClass}`;
        summaryUnrealized.innerHTML = `${prefix} ${window.StockUtils.formatNumber(Math.abs(totalUnrealizedPnL), 2)} (${window.StockUtils.formatPercent(totalUnrealizedPercent)})`;
      }

      if (summaryRealized) {
        const prefix = totalRealizedPnL > 0 ? '▲' : (totalRealizedPnL < 0 ? '▼' : '');
        const colorClass = totalRealizedPnL > 0 ? 'stock-up' : (totalRealizedPnL < 0 ? 'stock-down' : 'stock-flat');
        summaryRealized.className = `summary-value ${colorClass}`;
        summaryRealized.innerHTML = `${prefix} ${window.StockUtils.formatNumber(Math.abs(totalRealizedPnL), 2)}`;
      }

      // --- 個股清單列表渲染 ---
      container.innerHTML = '';
      
      const activeSubTab = window.activeSubTab || 'summary';
      
      const tableHeader = document.createElement('div');
      const isBatchStocksActive = document.getElementById('batch-stocks-toolbar')?.style.display === 'flex';
      tableHeader.className = `stock-table-header view-${activeSubTab} ${isBatchStocksActive ? 'batch-mode-active' : ''}`;
      
      if (activeSubTab === 'summary') {
        tableHeader.innerHTML = `
          <div class="col-expand"></div>
          <div class="col-batch-check"><input type="checkbox" id="select-all-stocks" title="全選個股"></div>
          <div class="col-info">股名/股號</div>
          <div class="col-price" style="text-align: right;">股價</div>
          <div style="text-align: right;">漲跌</div>
          <div style="text-align: right;">漲跌幅(%)</div>
          <div style="text-align: right;">買進</div>
          <div style="text-align: right;">賣出</div>
          <div style="text-align: right;">開盤</div>
          <div style="text-align: right;">昨收</div>
          <div style="text-align: right;">最高</div>
          <div style="text-align: right;">最低</div>
          <div style="text-align: right;">成交量(張)</div>
          <div style="text-align: right;">時間(CST)</div>
          <div class="col-actions"></div>
        `;
      } else {
        tableHeader.innerHTML = `
          <div class="col-expand"></div>
          <div class="col-batch-check"><input type="checkbox" id="select-all-stocks" title="全選個股"></div>
          <div class="col-info">股名/股號</div>
          <div class="col-price">股價/漲跌(%)</div>
          <div class="col-shares">持有股數</div>
          <div class="col-avg-cost">持股成本均價</div>
          <div class="col-market-val">市值</div>
          <div class="col-realized">已實現損益</div>
          <div class="col-unrealized">未實現損益</div>
          <div class="col-tx-count">交易筆數</div>
          <div class="col-actions"></div>
        `;
      }
      container.appendChild(tableHeader);

      portfolioItems.forEach(item => {
        const { stock, displayName, quote, calc, txs } = item;
        const isExpanded = expandedStocks.has(stock.symbol);

        const row = document.createElement('div');
        row.className = `stock-row ${isExpanded ? 'is-expanded' : ''}`;
        row.dataset.symbol = stock.symbol;

        const priceColorClass = quote.change > 0 ? 'stock-up' : (quote.change < 0 ? 'stock-down' : 'stock-flat');
        const changeRealPrefix = quote.change > 0 ? '▲' : (quote.change < 0 ? '▼' : '');
        const priceText = quote.price > 0 ? window.StockUtils.formatNumber(quote.price, 2) : '-';
        const changeText = quote.price > 0 ? `${changeRealPrefix}${window.StockUtils.formatNumber(Math.abs(quote.change), 2)} (${quote.changePercent}%)` : '-';

        const pnlColorClass = calc.unrealizedPnL > 0 ? 'stock-up' : (calc.unrealizedPnL < 0 ? 'stock-down' : 'stock-flat');
        const pnlPrefix = calc.unrealizedPnL > 0 ? '▲' : (calc.unrealizedPnL < 0 ? '▼' : '');
        const pnlValText = calc.totalShares > 0 ? `${pnlPrefix}${window.StockUtils.formatNumber(Math.abs(calc.unrealizedPnL), 2)}` : '-';
        const pnlPercentText = calc.totalShares > 0 ? `(${window.StockUtils.formatPercent(calc.unrealizedPnLPercent)})` : '';

        const realizedColorClass = calc.realizedPnL > 0 ? 'stock-up' : (calc.realizedPnL < 0 ? 'stock-down' : 'stock-flat');
        const realizedPrefix = calc.realizedPnL > 0 ? '+' : '';
        const realizedText = calc.realizedPnL !== 0 ? `${realizedPrefix}${window.StockUtils.formatNumber(calc.realizedPnL, 2)}` : '-';

        // 父子關係交易分流渲染
        const parentTxs = txs.filter(t => !t.parentId);
        const childTxsMap = new Map();
        
        txs.forEach(t => {
          if (t.parentId) {
            if (!childTxsMap.has(t.parentId)) {
              childTxsMap.set(t.parentId, []);
            }
            childTxsMap.get(t.parentId).push(t);
          }
        });

        let txRowsHTML = '';
        if (txs.length > 0) {
          parentTxs.forEach(parentTx => {
            const hasChild = childTxsMap.has(parentTx.id);
            const children = childTxsMap.get(parentTx.id) || [];
            const isChildExpanded = expandedParentTxs.has(parentTx.id);
            
            // A. 渲染父交易 (買入列)
            const parentVal = parentTx.shares * parentTx.price;
            const isBuy = parentTx.type === 'buy';
            
            let typeCellHTML = '';
            let deleteCellHTML = '';
            
            if (hasChild) {
              typeCellHTML = `
                <div style="display:flex; align-items:center; gap:4px;">
                  <span class="toggle-child-btn" data-parent-id="${parentTx.id}" style="cursor:pointer; color:#0056b3; font-weight:700; margin-right:4px; user-select:none;">
                    ${isChildExpanded ? '▼' : '▶'}
                  </span>
                  <select class="inline-edit-select inline-type" data-id="${parentTx.id}" data-date="${parentTx.date}" data-shares="${parentTx.shares}">
                    <option value="buy" ${isBuy ? 'selected' : ''}>買入</option>
                    <option value="sell" ${!isBuy ? 'selected' : ''}>賣出</option>
                  </select>
                </div>
              `;
              deleteCellHTML = `<button class="delete-tx-btn" data-id="${parentTx.id}">刪除</button>`;
            } else {
              typeCellHTML = `
                <select class="inline-edit-select inline-type" data-id="${parentTx.id}" data-date="${parentTx.date}" data-shares="${parentTx.shares}">
                  <option value="buy" ${isBuy ? 'selected' : ''}>買入</option>
                  <option value="sell" ${!isBuy ? 'selected' : ''}>賣出</option>
                </select>
              `;
              deleteCellHTML = `<button class="delete-tx-btn" data-id="${parentTx.id}">刪除</button>`;
            }

            txRowsHTML += `
              <tr class="tx-parent-row" data-id="${parentTx.id}">
                <td class="tx-check-cell">
                  <input type="checkbox" class="tx-checkbox" data-id="${parentTx.id}">
                </td>
                <td>
                  <input type="date" class="inline-edit-input inline-date" data-id="${parentTx.id}" value="${parentTx.date}" ${hasChild ? 'disabled style="color:var(--text-sub);"' : ''}>
                </td>
                <td>
                  ${typeCellHTML}
                </td>
                <td>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <input type="number" class="inline-edit-input inline-shares" data-id="${parentTx.id}" value="${parentTx.shares}" min="1" step="1" style="width: 75px;" ${hasChild ? 'disabled style="color:var(--text-sub);"' : ''}>
                    <span style="color:var(--text-sub);">股</span>
                  </div>
                </td>
                <td>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <input type="number" class="inline-edit-input inline-price" data-id="${parentTx.id}" value="${parentTx.price}" min="0.01" step="0.01" style="width: 85px;" ${hasChild ? 'disabled style="color:var(--text-sub);"' : ''}>
                    <span style="color:var(--text-sub);">TWD</span>
                  </div>
                </td>
                <td>${window.StockUtils.formatNumber(parentVal, 2)}</td>
                <td>
                  ${deleteCellHTML}
                </td>
              </tr>
            `;

            children.forEach(childTx => {
              const childVal = childTx.shares * childTx.price;
              
              txRowsHTML += `
                <tr class="tx-child-row" data-id="${childTx.id}" data-parent-id="${parentTx.id}" style="display: ${isChildExpanded ? 'table-row' : 'none'};">
                  <td></td> <!-- 第一欄複選框留空對齊 -->
                  <td>
                    <input type="date" class="inline-edit-input inline-date" data-id="${childTx.id}" value="${childTx.date}">
                  </td>
                  <td>
                    <div style="display:flex; align-items:center; gap:4px; padding-left: 8px;">
                      <span style="color:#adb5bd; font-family: monospace; font-weight: bold; margin-right: 4px;">└─</span>
                      <span class="tx-status-sell" style="font-weight:700; color:var(--stock-down-color);">賣出</span>
                    </div>
                  </td>
                  <td>
                    <div style="display:flex; align-items:center; gap:4px;">
                      <input type="number" class="inline-edit-input inline-shares" data-id="${childTx.id}" value="${childTx.shares}" min="1" step="1" style="width: 75px;">
                      <span style="color:var(--text-sub);">股</span>
                    </div>
                  </td>
                  <td>
                    <div style="display:flex; align-items:center; gap:4px;">
                      <input type="number" class="inline-edit-input inline-price" data-id="${childTx.id}" value="${childTx.price}" min="0.01" step="0.01" style="width: 85px;">
                      <span style="color:var(--text-sub);">TWD</span>
                    </div>
                  </td>
                  <td>${window.StockUtils.formatNumber(childVal, 2)}</td>
                  <td>
                    <button class="delete-tx-btn" data-id="${childTx.id}" title="刪除此筆賣出，恢復未賣出狀態">刪除</button>
                  </td>
                </tr>
              `;
            });
          });
        }

        const summaryRow = document.createElement('div');
        const isBatchStocksActive = document.getElementById('batch-stocks-toolbar')?.style.display === 'flex';
        summaryRow.className = `stock-row-summary view-${activeSubTab} ${isBatchStocksActive ? 'batch-mode-active' : ''}`;
        
        if (activeSubTab === 'summary') {
          const formatQuoteVal = (val, dec = 2) => {
            if (val === undefined || val === null || val === '-') return '-';
            const num = Number(val);
            return isNaN(num) ? '-' : window.StockUtils.formatNumber(num, dec);
          };
          summaryRow.innerHTML = `
            <div class="col-expand">
              <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
            </div>
            <div class="col-batch-check">
              <input type="checkbox" class="stock-batch-checkbox" data-symbol="${stock.symbol}">
            </div>
            <div class="col-info">
              <div class="stock-name">${displayName}</div>
              <div class="stock-symbol">${stock.symbol}</div>
            </div>
            <div class="current-price ${priceColorClass}" style="text-align: right;">${priceText}</div>
            <div class="${priceColorClass}" style="text-align: right;">${quote.price > 0 ? (quote.change > 0 ? '▲ ' : quote.change < 0 ? '▼ ' : '') + window.StockUtils.formatNumber(Math.abs(quote.change), 2) : '-'}</div>
            <div class="${priceColorClass}" style="text-align: right;">${quote.price > 0 ? (quote.change > 0 ? '▲ ' : quote.change < 0 ? '▼ ' : '') + window.StockUtils.formatNumber(Math.abs(quote.changePercent), 2) + '%' : '-'}</div>
            <div style="text-align: right;">${formatQuoteVal(quote.bid)}</div>
            <div style="text-align: right;">${formatQuoteVal(quote.ask)}</div>
            <div style="text-align: right;">${formatQuoteVal(quote.open)}</div>
            <div style="text-align: right;">${formatQuoteVal(quote.prevClose)}</div>
            <div style="text-align: right;">${formatQuoteVal(quote.high)}</div>
            <div style="text-align: right;">${formatQuoteVal(quote.low)}</div>
            <div style="text-align: right;">${formatQuoteVal(quote.volume, 0)}</div>
            <div style="text-align: right; font-size: 12px; color: var(--text-sub);">${quote.time || '-'}</div>
            <div class="col-actions">
              <button class="delete-stock-btn" title="從自選股移除">✕</button>
            </div>
          `;
        } else {
          summaryRow.innerHTML = `
            <div class="col-expand">
              <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
            </div>
            <div class="col-batch-check">
              <input type="checkbox" class="stock-batch-checkbox" data-symbol="${stock.symbol}">
            </div>
            <div class="col-info" title="點擊展開/收合明細">
              <div class="stock-name">${displayName}</div>
              <div class="stock-symbol">${stock.symbol}</div>
            </div>
            <div class="col-price">
              <div class="current-price ${priceColorClass}">${priceText}</div>
              <div class="price-change ${priceColorClass}">${changeText}</div>
            </div>
            <div class="col-shares">${calc.totalShares > 0 ? window.StockUtils.formatNumber(calc.totalShares, 0) + ' 股' : '-'}</div>
            <div class="col-avg-cost">${calc.totalShares > 0 ? window.StockUtils.formatNumber(calc.averageCost, 2) + ' TWD' : '-'}</div>
            <div class="col-market-val">${calc.totalShares > 0 ? window.StockUtils.formatNumber(calc.marketValue, 2) : '-'}</div>
            <div class="col-realized ${realizedColorClass}">${realizedText}</div>
            <div class="col-unrealized ${pnlColorClass}">
              <div class="pnl-val">${pnlValText}</div>
              <div class="pnl-pct">${pnlPercentText}</div>
            </div>
            <div class="col-tx-count">${calc.txCount} 筆</div>
            <div class="col-actions">
              <button class="delete-stock-btn" title="從自選股移除">✕</button>
            </div>
          `;
        }
        
        row.appendChild(summaryRow);

        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'stock-details';
        detailsDiv.style.display = isExpanded ? 'block' : 'none';
        detailsDiv.innerHTML = `
          <div class="details-inner">
            <div class="details-header">
              <h3>歷史交易明細</h3>
              <div style="display:flex;gap:8px;align-items:center;">
                <div class="batch-toolbar" style="display:none;align-items:center;gap:8px;">
                  <span class="batch-count-label" style="font-size:13px;color:var(--text-sub);">已選 0 筆</span>
                  <button class="batch-delete-btn" style="background:#dc3545;color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:13px;cursor:pointer;">🗑 刪除選取</button>
                  <button class="batch-cancel-btn" style="background:var(--bg-card,#f1f3f5);color:var(--text-main);border:none;border-radius:6px;padding:4px 10px;font-size:13px;cursor:pointer;">取消</button>
                </div>
                <button class="add-tx-btn">新增交易</button>
              </div>
            </div>
            
            ${txs.length === 0 ? `
              <div class="no-tx-state">
                無交易明細，請點擊「新增交易」新增買賣紀錄
              </div>
            ` : `
              <table class="tx-table">
                <thead>
                  <tr>
                    <th class="tx-check-cell"><input type="checkbox" class="tx-select-all" title="全選"></th>
                    <th>交易日期</th>
                    <th>買入/賣出</th>
                    <th>交易股數</th>
                    <th>交易股價</th>
                    <th>市值</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  ${txRowsHTML}
                </tbody>
              </table>
            `}
          </div>
        `;
        row.appendChild(detailsDiv);

        // 綁定第一層展開收合事件 (股票)
        summaryRow.addEventListener('click', (e) => {
          if (e.target.closest('.delete-stock-btn')) return;
          
          // 如果點選的是批次選擇 checkbox 本身，則交由 change 事件處理，不要觸發展開收合
          if (e.target.closest('.stock-batch-checkbox')) {
            e.stopPropagation();
            return;
          }

          // 如果是在批量刪除個股模式下，點選整列自動勾選/取消勾選該個股
          const isBatchStocksActive = document.getElementById('batch-stocks-toolbar')?.style.display === 'flex';
          if (isBatchStocksActive) {
            e.stopPropagation();
            const chk = summaryRow.querySelector('.stock-batch-checkbox');
            if (chk) {
              chk.checked = !chk.checked;
              chk.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return;
          }

          if (e.target.closest('.stock-name')) {
            e.stopPropagation();
            if (typeof window.showStockDetailView === 'function') {
              window.showStockDetailView(stock.symbol, displayName, quote, calc);
            }
            return;
          }

          const details = row.querySelector('.stock-details');
          const icon = row.querySelector('.expand-icon');
          
          if (expandedStocks.has(stock.symbol)) {
            expandedStocks.delete(stock.symbol);
            details.style.display = 'none';
            icon.textContent = '▶';
            row.classList.remove('is-expanded');
          } else {
            expandedStocks.add(stock.symbol);
            details.style.display = 'block';
            icon.textContent = '▼';
            row.classList.add('is-expanded');
          }
        });

        // 綁定個股批次選擇 checkbox 變動事件
        summaryRow.querySelector('.stock-batch-checkbox')?.addEventListener('change', () => {
          const batchCountLabel = document.getElementById('batch-stocks-count');
          const selectAllChk = document.getElementById('select-all-stocks');
          const checked = document.querySelectorAll('.stock-batch-checkbox:checked');
          const total = document.querySelectorAll('.stock-batch-checkbox');

          if (batchCountLabel) {
            batchCountLabel.textContent = `已選 ${checked.length} 檔`;
          }
          if (selectAllChk) {
            selectAllChk.checked = total.length > 0 && checked.length === total.length;
          }
        });

        // ── 批量選擇 ──────────────────────────────────────────
        const toolbar = detailsDiv.querySelector('.batch-toolbar');
        const batchCountLabel = detailsDiv.querySelector('.batch-count-label');
        const selectAllChk = detailsDiv.querySelector('.tx-select-all');

        const updateBatchToolbar = () => {
          const checked = detailsDiv.querySelectorAll('.tx-checkbox:checked');
          const total = detailsDiv.querySelectorAll('.tx-checkbox');
          if (toolbar) {
            toolbar.style.display = checked.length > 0 ? 'flex' : 'none';
          }
          if (batchCountLabel) batchCountLabel.textContent = `已選 ${checked.length} 筆`;
          if (selectAllChk) selectAllChk.checked = total.length > 0 && checked.length === total.length;
        };

        // 全選 checkbox
        selectAllChk?.addEventListener('change', () => {
          detailsDiv.querySelectorAll('.tx-checkbox').forEach(cb => {
            cb.checked = selectAllChk.checked;
          });
          updateBatchToolbar();
        });

        // 各筆 checkbox
        detailsDiv.querySelectorAll('.tx-checkbox').forEach(cb => {
          cb.addEventListener('change', updateBatchToolbar);
        });

        // 批量刪除
        detailsDiv.querySelector('.batch-delete-btn')?.addEventListener('click', async () => {
          const ids = [...detailsDiv.querySelectorAll('.tx-checkbox:checked')].map(cb => Number(cb.dataset.id));
          await window.StockTransaction.handleBatchDelete(ids);
        });

        // 取消選取
        detailsDiv.querySelector('.batch-cancel-btn')?.addEventListener('click', () => {
          detailsDiv.querySelectorAll('.tx-checkbox').forEach(cb => cb.checked = false);
          if (selectAllChk) selectAllChk.checked = false;
          updateBatchToolbar();
        });
        // ─────────────────────────────────────────────────────

        // 綁定第二層展開收合事件 (點擊小三角形展開/收合賣出子列) (新增功能)
        detailsDiv.querySelectorAll('.toggle-child-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const parentId = Number(e.target.dataset.parentId);
            
            // 尋找此表格內所有以這筆買入為父 ID 的子交易列
            const childRows = detailsDiv.querySelectorAll(`tr.tx-child-row[data-parent-id="${parentId}"]`);
            
            if (expandedParentTxs.has(parentId)) {
              expandedParentTxs.delete(parentId);
              e.target.textContent = '▶';
              childRows.forEach(r => r.style.display = 'none');
            } else {
              expandedParentTxs.add(parentId);
              e.target.textContent = '▼';
              childRows.forEach(r => r.style.display = 'table-row');
            }
          });
        });

        // 1. 日期變更
        detailsDiv.querySelectorAll('.inline-date').forEach(input => {
          input.addEventListener('change', async (e) => {
            const id = e.target.dataset.id;
            const val = e.target.value;
            await window.StockTransaction.handleInlineEdit(id, 'date', val);
          });
        });

        // 2. 股數變更
        detailsDiv.querySelectorAll('.inline-shares').forEach(input => {
          input.addEventListener('change', async (e) => {
            const id = e.target.dataset.id;
            const val = Math.max(1, Math.round(Number(e.target.value) || 1));
            await window.StockTransaction.handleInlineEdit(id, 'shares', val);
          });
        });

        // 3. 股價變更
        detailsDiv.querySelectorAll('.inline-price').forEach(input => {
          input.addEventListener('change', async (e) => {
            const id = e.target.dataset.id;
            const val = Math.max(0.01, Number(e.target.value) || 0.01);
            await window.StockTransaction.handleInlineEdit(id, 'price', val);
          });
        });

        // 4. 買賣類別變更
        detailsDiv.querySelectorAll('.inline-type').forEach(select => {
          select.addEventListener('change', async (e) => {
            const id = Number(e.target.dataset.id);
            const currentVal = e.target.value;
            const origDate = e.target.dataset.date;
            const origShares = e.target.dataset.shares;

            if (currentVal === 'sell') {
              select.value = 'buy';
              window.StockTransaction.openQuickSellModal(
                groupId, 
                stock.symbol, 
                origDate, 
                origShares, 
                displayName,
                id
              );
            }
          });
        });

        // 綁定自選股移除
        row.querySelector('.delete-stock-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`確定要將 ${displayName} (${stock.symbol}) 自此群組移除嗎？這將會同步清除此股在該群組的交易紀錄！`)) {
            await window.StockDB.deleteStockFromGroup(groupId, stock.symbol);
            expandedStocks.delete(stock.symbol);
            renderPortfolio(groupId);
          }
        });

        // 綁定新增交易
        const addTxBtn = row.querySelector('.add-tx-btn');
        if (addTxBtn) {
          addTxBtn.addEventListener('click', () => {
            window.StockTransaction.openAddTransactionModal(groupId, stock.symbol, displayName, quote.price);
          });
        }

        // 綁定刪除明細
        const delTxBtns = row.querySelectorAll('.delete-tx-btn');
        delTxBtns.forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const id = e.target.dataset.id;
            const isChild = e.target.closest('tr').classList.contains('tx-child-row');
            if (isChild) {
              await window.StockTransaction.handleRestoreTransaction(id);
            } else {
              await window.StockTransaction.handleDeleteTransaction(id);
            }
          });
        });

        container.appendChild(row);
      });

    } catch (err) {
      console.error(err);
      container.innerHTML = `<div class="error-state">載入失敗: ${err.message}</div>`;
    }
  }

  function toggleBatchMode(active) {
    const header = document.querySelector('.stock-table-header');
    const rows = document.querySelectorAll('.stock-row-summary');
    const selectAllChk = document.getElementById('select-all-stocks');
    
    if (header) {
      header.classList.toggle('batch-mode-active', active);
    }
    rows.forEach(row => {
      row.classList.toggle('batch-mode-active', active);
      // 還原選取狀態
      const chk = row.querySelector('.stock-batch-checkbox');
      if (chk) chk.checked = false;
    });

    if (selectAllChk) {
      selectAllChk.checked = false;
    }
  }

  window.StockPortfolio = {
    renderPortfolio,
    toggleBatchMode
  };
})(window);
