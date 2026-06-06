(function(window) {
  /**
   * 格式化數字為千分位，支援指定小數點位數
   */
  function formatNumber(num, decimals = 2) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    return Number(num).toLocaleString('zh-TW', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /**
   * 格式化百分比並加上正負號前綴
   */
  function formatPercent(num) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    const prefix = num > 0 ? '+' : '';
    return `${prefix}${num.toFixed(2)}%`;
  }

  /**
   * 格式化日期格式為 YYYY/MM/DD
   */
  function formatDate(dateStr) {
    if (!dateStr) return '';
    return dateStr.replace(/-/g, '/');
  }

  /**
   * 先進先出 (FIFO) 持倉與損益計算邏輯
   */
  function calculatePortfolio(transactions, currentPrice = 0, dividends = [], includeDividends = true, includeExpenses = true) {
    let activeBuyBatches = []; // 存儲尚未被賣出抵消的買入批次 { originalPrice, shares, originalShares, buyFee, date }
    let realizedPnL = 0; // 已實現損益

    // 取得股票代號並判定是否為 ETF (台股 ETF 代號皆以 00 開頭)
    const firstTx = transactions[0];
    const symbol = firstTx ? (firstTx.symbol || '') : '';
    const isETF = symbol.startsWith('00');
    const taxRate = isETF ? 0.001 : 0.003; // ETF 適用 0.1% 交易稅，個股適用 0.3%

    // 費用與稅金計算輔助函數
    const getBuyFee = (val) => includeExpenses ? Math.max(20, Math.floor(val * 0.001425)) : 0;
    const getSellFee = (val) => includeExpenses ? Math.max(20, Math.floor(val * 0.001425)) : 0;
    const getSellTax = (val) => includeExpenses ? Math.floor(val * taxRate) : 0;

    // 排序確保時間先後順序
    const sortedTxs = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const tx of sortedTxs) {
      const shares = Number(tx.shares);
      const price = Number(tx.price);

      if (tx.type === 'buy') {
        const buyValue = shares * price;
        const buyFee = getBuyFee(buyValue);
        activeBuyBatches.push({
          originalPrice: price, // 保留原始買入價
          shares: shares,
          originalShares: shares, // 原始買入股數，用以等比分攤手續費
          buyFee: buyFee,
          date: tx.date
        });
      } else if (tx.type === 'sell') {
        let remainingSellShares = shares;
        const sellValue = shares * price;
        const sellFee = getSellFee(sellValue);
        const sellTax = getSellTax(sellValue);

        while (remainingSellShares > 0 && activeBuyBatches.length > 0) {
          const firstBatch = activeBuyBatches[0];

          // 獲取該買入批次在持有期間（buyDate 到 sellDate）內的所有配息
          const totalDivAmount = includeDividends ? dividends
            .filter(d => d.date >= firstBatch.date && d.date <= tx.date)
            .reduce((sum, d) => sum + d.amount, 0) : 0;
          
          const unitBuyFee = firstBatch.originalShares > 0 ? (firstBatch.buyFee / firstBatch.originalShares) : 0;
          const adjustedBuyPrice = firstBatch.originalPrice + unitBuyFee - totalDivAmount;

          if (firstBatch.shares <= remainingSellShares) {
            const consumed = firstBatch.shares;
            const feeShare = (consumed / shares) * sellFee;
            const taxShare = (consumed / shares) * sellTax;

            realizedPnL += (price * consumed) - feeShare - taxShare - (adjustedBuyPrice * consumed);

            remainingSellShares -= firstBatch.shares;
            activeBuyBatches.shift();
          } else {
            const consumed = remainingSellShares;
            const feeShare = (consumed / shares) * sellFee;
            const taxShare = (consumed / shares) * sellTax;

            realizedPnL += (price * consumed) - feeShare - taxShare - (adjustedBuyPrice * consumed);

            firstBatch.shares -= remainingSellShares;
            remainingSellShares = 0;
          }
        }
      }
    }

    const totalShares = activeBuyBatches.reduce((sum, batch) => sum + batch.shares, 0);

    // 對於未實現持股，計算其買入日期至今的折抵後單價（含買入手續費、扣除配息）
    const getAdjustedPrice = (batch) => {
      const unitBuyFee = batch.originalShares > 0 ? (batch.buyFee / batch.originalShares) : 0;
      const totalDivAmount = includeDividends ? dividends
        .filter(d => d.date >= batch.date)
        .reduce((sum, d) => sum + d.amount, 0) : 0;
      return batch.originalPrice + unitBuyFee - totalDivAmount;
    };

    const totalCost = activeBuyBatches.reduce((sum, batch) => sum + (batch.shares * getAdjustedPrice(batch)), 0);
    const averageCost = totalShares > 0 ? (totalCost / totalShares) : 0;

    const rawMarketValue = totalShares * currentPrice;

    // 預估當前持有部位若於此時賣出，所需的交易手續費及證券交易稅
    const estSellValue = totalShares * currentPrice;
    const estSellFee = totalShares > 0 ? getSellFee(estSellValue) : 0;
    const estSellTax = totalShares > 0 ? getSellTax(estSellValue) : 0;
    const estSellExpenses = estSellFee + estSellTax;

    // 依據是否扣除稅費，調整回傳的市值
    const marketValue = includeExpenses ? (rawMarketValue - estSellExpenses) : rawMarketValue;

    const unrealizedPnL = totalShares > 0 ? (marketValue - totalCost) : 0;
    const unrealizedPnLPercent = totalCost > 0 ? (unrealizedPnL / totalCost) * 100 : 0;

    return {
      totalShares,
      averageCost,
      marketValue,
      realizedPnL,
      unrealizedPnL,
      unrealizedPnLPercent,
      txCount: transactions.length
    };
  }

  // 掛載到全域變數
  window.StockUtils = {
    formatNumber,
    formatPercent,
    formatDate,
    calculatePortfolio
  };
})(window);
