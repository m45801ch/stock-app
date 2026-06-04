(function(window) {
  let activeGroupId = 'default';
  let activeSymbol = '';
  let onTransactionChangedCallback = null;

  // 快捷賣出的狀態變數
  let qsGroupId = 'default';
  let qsSymbol = '';
  let qsParentTxId = null;

  function initTransaction(onChanged) {
    onTransactionChangedCallback = onChanged;

    // 1. 初始化一般新增交易 Modal
    const modal = document.getElementById('tx-modal');
    const closeBtn = document.getElementById('tx-modal-close');
    const form = document.getElementById('tx-form');
    const cancelBtn = document.getElementById('tx-modal-cancel');
    
    const sharesInput = document.getElementById('tx-shares');
    const priceInput = document.getElementById('tx-price');
    const totalValueSpan = document.getElementById('tx-total-value');

    if (modal && form) {
      const closeModal = () => {
        modal.style.display = 'none';
        form.reset();
        totalValueSpan.textContent = '0.00';
      };

      closeBtn?.addEventListener('click', closeModal);
      cancelBtn?.addEventListener('click', closeModal);
      
      window.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });

      const updateEstimatedValue = () => {
        const shares = Number(sharesInput.value) || 0;
        const price = Number(priceInput.value) || 0;
        totalValueSpan.textContent = window.StockUtils.formatNumber(shares * price, 2);
      };

      sharesInput.addEventListener('input', updateEstimatedValue);
      priceInput.addEventListener('input', updateEstimatedValue);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const date = document.getElementById('tx-date').value;
        const type = document.getElementById('tx-type').value;
        const shares = Number(sharesInput.value);
        const price = Number(priceInput.value);

        if (!date || !type || shares <= 0 || price <= 0) {
          alert('請填寫完整且正確的交易資訊！');
          return;
        }

        try {
          await window.StockDB.addTransaction(activeGroupId, activeSymbol, date, type, shares, price, null);
          closeModal();
          if (onTransactionChangedCallback) onTransactionChangedCallback();
        } catch (err) {
          alert('新增交易失敗: ' + err.message);
        }
      });
    }

    // 2. 初始化快捷平倉賣出 Modal
    initQuickSellModal();
  }

  // 快捷平倉賣出 Modal 初始化
  function initQuickSellModal() {
    const qsModal = document.getElementById('quick-sell-modal');
    const qsClose = document.getElementById('quick-sell-close');
    const qsCancel = document.getElementById('quick-sell-cancel');
    const qsForm = document.getElementById('quick-sell-form');

    const qsSharesInput = document.getElementById('qs-shares');
    const qsPriceInput = document.getElementById('qs-price');
    const qsTotalSpan = document.getElementById('qs-total-value');

    if (!qsModal || !qsForm) return;

    const closeQsModal = () => {
      qsModal.style.display = 'none';
      qsForm.reset();
      qsTotalSpan.textContent = '0.00';
      qsParentTxId = null;
    };

    qsClose?.addEventListener('click', closeQsModal);
    qsCancel?.addEventListener('click', closeQsModal);
    
    window.addEventListener('click', (e) => {
      if (e.target === qsModal) closeQsModal();
    });

    const updateQsEstimatedValue = () => {
      const shares = Number(qsSharesInput.value) || 0;
      const price = Number(qsPriceInput.value) || 0;
      qsTotalSpan.textContent = window.StockUtils.formatNumber(shares * price, 2);
    };

    qsSharesInput.addEventListener('input', updateQsEstimatedValue);
    qsPriceInput.addEventListener('input', updateQsEstimatedValue);

    qsForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const date = document.getElementById('qs-date').value;
      const shares = Number(qsSharesInput.value);
      const price = Number(qsPriceInput.value);

      if (!date || shares <= 0 || price <= 0) {
        alert('請輸入正確的賣出價格與資料！');
        return;
      }

      try {
        await window.StockDB.addTransaction(qsGroupId, qsSymbol, date, 'sell', shares, price, qsParentTxId);
        closeQsModal();
        if (onTransactionChangedCallback) onTransactionChangedCallback();
      } catch (err) {
        alert('快捷賣出失敗: ' + err.message);
      }
    });
  }

  function openQuickSellModal(groupId, symbol, date, shares, stockName, parentTxId) {
    qsGroupId = groupId;
    qsSymbol = symbol;
    qsParentTxId = parentTxId;

    const qsModal = document.getElementById('quick-sell-modal');
    const qsTitle = document.getElementById('qs-modal-title');
    const qsDateInput = document.getElementById('qs-date');
    const qsSharesInput = document.getElementById('qs-shares');
    const qsPriceInput = document.getElementById('qs-price');

    if (!qsModal) return;

    if (qsTitle) qsTitle.textContent = `快速賣出 - ${stockName} (${symbol})`;
    if (qsDateInput) qsDateInput.value = date;
    if (qsSharesInput) qsSharesInput.value = shares;

    qsModal.style.display = 'flex';
    if (qsPriceInput) {
      qsPriceInput.value = '';
      qsPriceInput.focus();
    }
    
    document.getElementById('qs-total-value').textContent = '0.00';
  }

  function openAddTransactionModal(groupId, symbol, stockName, currentPrice = 0) {
    activeGroupId = groupId;
    activeSymbol = symbol;

    const modal = document.getElementById('tx-modal');
    const titleSpan = document.getElementById('tx-modal-title');
    const dateInput = document.getElementById('tx-date');
    const priceInput = document.getElementById('tx-price');

    if (!modal) return;

    titleSpan.textContent = `新增交易 - ${stockName} (${symbol})`;

    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
    priceInput.value = currentPrice > 0 ? currentPrice : '';

    modal.style.display = 'flex';
    document.getElementById('tx-shares').focus();
    document.getElementById('tx-total-value').textContent = '0.00';
  }

  async function handleDeleteTransaction(txId) {
    if (!confirm('確定要刪除這筆交易紀錄嗎？')) return;

    try {
      await window.StockDB.deleteTransaction(txId);
      if (onTransactionChangedCallback) onTransactionChangedCallback();
    } catch (err) {
      alert('刪除交易失敗: ' + err.message);
    }
  }

  /**
   * 處理行內編輯儲存
   */
  async function handleInlineEdit(txId, field, value) {
    try {
      const updatedFields = { [field]: value };
      
      if (field === 'type' && value === 'buy') {
        updatedFields.parentId = null;
      }
      
      await window.StockDB.updateTransaction(txId, updatedFields);
      if (onTransactionChangedCallback) onTransactionChangedCallback();
    } catch (err) {
      alert('自動儲存失敗: ' + err.message);
    }
  }

  /**
   * 新增：快捷一鍵回復平倉 (刪除賣出子交易，還原為未平倉狀態)
   * @param {number} childId - 關聯的賣出子交易 ID
   */
  async function handleRestoreTransaction(childId) {
    if (!confirm('確定要回復此筆交易嗎？\n這將會刪除該對應的「賣出」紀錄，並將買入狀態恢復為未賣出。')) return;

    try {
      await window.StockDB.deleteTransaction(Number(childId));
      if (onTransactionChangedCallback) onTransactionChangedCallback();
    } catch (err) {
      alert('回復交易失敗: ' + err.message);
    }
  }

  /**
   * 批量刪除選取的交易紀錄，只觸發一次 UI refresh
   * @param {number[]} ids - 選取的交易 id 陣列（父交易 id）
   */
  async function handleBatchDelete(ids) {
    if (!ids || ids.length === 0) return;
    if (!confirm(`確定要刪除選取的 ${ids.length} 筆交易紀錄嗎？（含各自對應的賣出子交易）`)) return;

    try {
      await window.StockDB.batchDeleteTransactions(ids);
      if (onTransactionChangedCallback) onTransactionChangedCallback(); // 只觸發一次
    } catch (err) {
      alert('批量刪除失敗: ' + err.message);
    }
  }

  window.StockTransaction = {
    initTransaction,
    openAddTransactionModal,
    handleDeleteTransaction,
    openQuickSellModal,
    handleInlineEdit,
    handleRestoreTransaction,
    handleBatchDelete  // 批量刪除
  };
})(window);
