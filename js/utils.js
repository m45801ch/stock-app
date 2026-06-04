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
  function calculatePortfolio(transactions, currentPrice = 0) {
    let activeBuyBatches = []; // 存儲尚未被賣出抵消的買入批次 { price, shares, date }
    let realizedPnL = 0; // 已實現損益

    // 排序確保時間先後順序
    const sortedTxs = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const tx of sortedTxs) {
      const shares = Number(tx.shares);
      const price = Number(tx.price);

      if (tx.type === 'buy') {
        activeBuyBatches.push({
          price: price,
          shares: shares,
          date: tx.date
        });
      } else if (tx.type === 'sell') {
        let remainingSellShares = shares;

        while (remainingSellShares > 0 && activeBuyBatches.length > 0) {
          const firstBatch = activeBuyBatches[0];

          if (firstBatch.shares <= remainingSellShares) {
            const profitPerShare = price - firstBatch.price;
            realizedPnL += profitPerShare * firstBatch.shares;

            remainingSellShares -= firstBatch.shares;
            activeBuyBatches.shift();
          } else {
            const profitPerShare = price - firstBatch.price;
            realizedPnL += profitPerShare * remainingSellShares;

            firstBatch.shares -= remainingSellShares;
            remainingSellShares = 0;
          }
        }
      }
    }

    const totalShares = activeBuyBatches.reduce((sum, batch) => sum + batch.shares, 0);
    const totalCost = activeBuyBatches.reduce((sum, batch) => sum + (batch.shares * batch.price), 0);
    const averageCost = totalShares > 0 ? (totalCost / totalShares) : 0;

    const marketValue = totalShares * currentPrice;
    const unrealizedPnL = totalShares > 0 ? (currentPrice - averageCost) * totalShares : 0;
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
