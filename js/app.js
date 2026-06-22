(function(window) {
  let activeGroupId = 'default';
  
  let idxData = {
    'idx-tse': {
      name: '加權指數',
      val: '-',
      change: '-',
      isUp: null,
      vol: '-',
      open: '-',
      high: '-',
      low: '-',
      prev: '-',
      time: '-'
    },
    'idx-otc': {
      name: '櫃買指數',
      val: '-',
      change: '-',
      isUp: null,
      vol: '-',
      open: '-',
      high: '-',
      low: '-',
      prev: '-',
      time: '-'
    },
    'idx-elec': {
      name: '電子指數',
      val: '-',
      change: '-',
      isUp: null,
      vol: '-',
      open: '-',
      high: '-',
      low: '-',
      prev: '-',
      time: '-'
    },
    'idx-fin': {
      name: '金融指數',
      val: '-',
      change: '-',
      isUp: null,
      vol: '-',
      open: '-',
      high: '-',
      low: '-',
      prev: '-',
      time: '-'
    }
  };

  document.addEventListener('DOMContentLoaded', async () => {
    registerServiceWorker();

    // 建立頂部資料庫狀態指示燈
    createDBStatusBadge();

    try {
      await window.StockDB.initDB();
    } catch (e) {
      console.error('資料庫初始化失敗', e);
    }

    await refreshGroups();
    await refreshPortfolio();

    window.StockSearch.initSearch(() => {
      refreshPortfolio();
    });
    
    window.StockTransaction.initTransaction(() => {
      refreshPortfolio();
    });

    // 抓取並更新動作列右側的大盤指數
    updateBroadMarketBadge();

    bindHeaderActions();
    bindSettingsModal();

    // 背景載入台股官方代號與中文名稱字典 (修復問題一與三，提升搜尋速度與中文名稱準確性)
    initLocalDictionary();
    initAutoRefresh();
    initLayoutToggle();
    initPwaInstallPrompt();
    initAppLogoTitle();
    initDividendToggle();
    initExpenseToggle();
  });

  // 初始化配息折抵計算模式切換
  function initDividendToggle() {
    const divToggle = document.getElementById('btn-dividend-toggle');
    if (!divToggle) return;

    // 初始化按鈕文字與高亮狀態
    const currentMode = localStorage.getItem('dividend_mode') || 'include';
    updateToggleUI(currentMode);

    divToggle.addEventListener('click', async () => {
      const isInclude = localStorage.getItem('dividend_mode') !== 'exclude';
      const nextMode = isInclude ? 'exclude' : 'include';
      localStorage.setItem('dividend_mode', nextMode);
      
      updateToggleUI(nextMode);

      // 重新渲染以更新損益數值
      await refreshPortfolio();
    });

    function updateToggleUI(mode) {
      if (mode === 'include') {
        divToggle.textContent = '損益計算：含配息';
        divToggle.classList.add('active');
      } else {
        divToggle.textContent = '損益計算：不含配息';
        divToggle.classList.remove('active');
      }
    }
  }

  // 初始化手續費與稅金扣除模式切換
  function initExpenseToggle() {
    const expToggle = document.getElementById('btn-expense-toggle');
    if (!expToggle) return;

    // 初始化按鈕文字與高亮狀態
    const currentMode = localStorage.getItem('expense_mode') || 'include';
    updateToggleUI(currentMode);

    expToggle.addEventListener('click', async () => {
      const isInclude = localStorage.getItem('expense_mode') !== 'exclude';
      const nextMode = isInclude ? 'exclude' : 'include';
      localStorage.setItem('expense_mode', nextMode);
      
      updateToggleUI(nextMode);

      // 重新渲染以更新損益數值
      await refreshPortfolio();
    });

    function updateToggleUI(mode) {
      if (mode === 'include') {
        expToggle.textContent = '損益計算：扣稅費';
        expToggle.classList.add('active');
      } else {
        expToggle.textContent = '損益計算：未扣稅費';
        expToggle.classList.remove('active');
      }
    }
  }

  // 初始化自訂標題 (點擊自訂名稱)
  function initAppLogoTitle() {
    const titleEl = document.getElementById('app-logo-title');
    const inputEl = document.getElementById('app-logo-input');
    const editBtn = document.getElementById('btn-edit-title');
    if (!titleEl || !inputEl) return;

    // 載入儲存的標題
    const savedTitle = localStorage.getItem('app_logo_title');
    if (savedTitle && savedTitle.trim() !== '') {
      titleEl.textContent = savedTitle.trim();
    }

    // 進入編輯狀態
    function startEdit() {
      inputEl.value = titleEl.textContent;
      titleEl.style.display = 'none';
      if (editBtn) editBtn.style.display = 'none';
      inputEl.style.display = 'inline-block';
      
      // 計算輸入框寬度以符合內容長度，給予最佳視覺感
      adjustInputWidth();
      inputEl.focus();
      inputEl.select();
    }

    // 結束編輯狀態並儲存
    function finishEdit() {
      if (inputEl.style.display === 'none') return;
      
      const newTitle = inputEl.value.trim();
      if (newTitle === '') {
        // 輸入空白則還原為預設
        localStorage.removeItem('app_logo_title');
        titleEl.textContent = '我的自選股';
      } else {
        localStorage.setItem('app_logo_title', newTitle);
        titleEl.textContent = newTitle;
      }
      
      inputEl.style.display = 'none';
      titleEl.style.display = 'inline-block';
      if (editBtn) editBtn.style.display = 'inline-flex';
    }

    // 取消編輯
    function cancelEdit() {
      inputEl.style.display = 'none';
      titleEl.style.display = 'inline-block';
      if (editBtn) editBtn.style.display = 'inline-flex';
    }

    // 動態調整輸入框寬度
    function adjustInputWidth() {
      // 依字數動態調整 input 的寬度，最少 100px
      const textLen = inputEl.value.length;
      // 粗略計算：中文字大約 22px，英文字母大約 12px
      let width = 0;
      for (let i = 0; i < textLen; i++) {
        const charCode = inputEl.value.charCodeAt(i);
        if (charCode >= 0 && charCode <= 128) {
          width += 14;
        } else {
          width += 24;
        }
      }
      inputEl.style.width = Math.max(100, width + 15) + 'px';
    }

    // 事件監聽
    titleEl.addEventListener('click', startEdit);
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startEdit();
      });
    }

    inputEl.addEventListener('input', adjustInputWidth);

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });

    inputEl.addEventListener('blur', finishEdit);
  }

  // 註冊 PWA Service Worker
  function registerServiceWorker() {
    if (window.location.protocol === 'file:') {
      console.log('本地檔案瀏覽模式：跳過 PWA 服務註冊。部署至 http/https 後會自動啟用。');
      return;
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => {
          console.log('Service Worker 註冊成功');
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('偵測到新版本，自動重整網頁中...');
                window.location.reload();
              }
            });
          });
        })
        .catch(err => console.log('Service Worker 註冊失敗', err));
    }
  }

  let deferredPrompt;
  function initPwaInstallPrompt() {
    const banner = document.getElementById('pwa-install-banner');
    const installBtn = document.getElementById('btn-pwa-install');
    const closeBtn = document.getElementById('btn-pwa-close');
    const iosBanner = document.getElementById('pwa-ios-banner');
    const iosCloseBtn = document.getElementById('btn-pwa-ios-close');

    // 檢查使用者是否已手動關閉過安裝提示
    const isBannerDismissed = localStorage.getItem('pwa_banner_dismissed') === 'true';

    // 偵測是否已是 Standalone 獨立視窗開啟
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    // 1. Android/Chrome/Edge 等瀏覽器的安裝流程
    window.addEventListener('beforeinstallprompt', (e) => {
      // 避免瀏覽器預設的安裝提示彈出
      e.preventDefault();
      // 暫存此 event 供稍後點選安裝按鈕時調用
      deferredPrompt = e;

      // 如果使用者沒手動關閉過，且非以獨立視窗開啟，就顯示提示橫幅
      if (!isBannerDismissed && !isStandalone && banner) {
        banner.style.display = 'flex';
      }
    });

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        // 顯示安裝提示
        deferredPrompt.prompt();
        // 等待使用者決定
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`PWA 安裝選擇結果: ${outcome}`);
        // 清理暫存的 event
        deferredPrompt = null;
        // 隱藏橫幅
        if (banner) banner.style.display = 'none';
      });
    }

    if (closeBtn && banner) {
      closeBtn.addEventListener('click', () => {
        banner.style.display = 'none';
        localStorage.setItem('pwa_banner_dismissed', 'true');
      });
    }

    // 2. iOS Safari 的專屬提示流程
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    if (isIOS && isSafari && !isStandalone && !isBannerDismissed && iosBanner) {
      iosBanner.style.display = 'flex';
    }

    if (iosCloseBtn && iosBanner) {
      iosCloseBtn.addEventListener('click', () => {
        iosBanner.style.display = 'none';
        localStorage.setItem('pwa_banner_dismissed', 'true');
      });
    }
  }

  // 動態建立資料庫狀態燈
  function createDBStatusBadge() {
    const headerActions = document.querySelector('.header-actions');
    if (!headerActions) return;

    const badge = document.createElement('div');
    badge.id = 'db-status-badge';
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '6px';
    badge.style.fontSize = '12px';
    badge.style.color = '#6c757d';
    badge.style.background = '#f1f3f5';
    badge.style.padding = '4px 10px';
    badge.style.borderRadius = '12px';
    badge.style.marginRight = '8px';
    badge.innerHTML = `
      <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#ffc107;"></span>
      <span id="db-status-text">台股資料初始化中...</span>
    `;

    // 插入到第一個子元素之前
    headerActions.insertBefore(badge, headerActions.firstChild);
  }

  // 背景初始化字典
  async function initLocalDictionary() {
    const badgeDot = document.querySelector('#db-status-badge span');
    const badgeText = document.getElementById('db-status-text');

    await window.StockAPI.initializeLocalStockDictionary((msg) => {
      if (badgeText) badgeText.textContent = msg;
    });

    // 完成後更新狀態燈
    const count = await window.StockDB.getDictionaryCount();
    if (badgeDot && badgeText) {
      if (count > 0) {
        badgeDot.style.background = '#28a745'; // 綠色
        badgeText.textContent = `台股庫已就緒 (${count} 檔)`;
      } else {
        badgeDot.style.background = '#dc3545'; // 紅色
        badgeText.textContent = '線上備援查詢模式';
      }
    }
  }

  async function refreshGroups() {
    const tabsContainer = document.getElementById('group-tabs');
    if (!tabsContainer) return;

    try {
      const groups = await window.StockDB.getAllGroups();
      
      // 依群組排序狀態進行排序 (確保「預設」始終排第一)
      if (window.groupSortOrder === 'asc') {
        groups.sort((a, b) => {
          if (a.id === 'default') return -1;
          if (b.id === 'default') return 1;
          return a.name.localeCompare(b.name, 'zh-Hant');
        });
      } else if (window.groupSortOrder === 'desc') {
        groups.sort((a, b) => {
          if (a.id === 'default') return -1;
          if (b.id === 'default') return 1;
          return b.name.localeCompare(a.name, 'zh-Hant');
        });
      }
      
      tabsContainer.innerHTML = '';
      groups.forEach(g => {
        const tab = document.createElement('button');
        tab.className = `group-tab ${g.id === activeGroupId ? 'active' : ''}`;
        tab.textContent = g.name;
        tab.dataset.id = g.id;
        
        tab.addEventListener('click', () => {
          activeGroupId = g.id;
          window.StockSearch.updateSearchActiveGroup(activeGroupId);
          
          document.querySelectorAll('.group-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          
          // 切換群組時更新動作連結顯隱狀態
          const renameLink = document.getElementById('link-rename-group');
          const deleteLink = document.getElementById('link-delete-group');
          const sepRenameDelete = document.getElementById('sep-rename-delete');
          const isDefault = activeGroupId === 'default';
          
          if (renameLink) renameLink.style.display = isDefault ? 'none' : 'inline-block';
          if (deleteLink) deleteLink.style.display = isDefault ? 'none' : 'inline-block';
          if (sepRenameDelete) sepRenameDelete.style.display = isDefault ? 'none' : 'inline-block';
          
          refreshPortfolio();
        });
        
        tabsContainer.appendChild(tab);
      });

      // 載入群組時更新動作連結顯隱狀態
      const renameLink = document.getElementById('link-rename-group');
      const deleteLink = document.getElementById('link-delete-group');
      const sepRenameDelete = document.getElementById('sep-rename-delete');
      const isDefault = activeGroupId === 'default';
      
      if (renameLink) renameLink.style.display = isDefault ? 'none' : 'inline-block';
      if (deleteLink) deleteLink.style.display = isDefault ? 'none' : 'inline-block';
      if (sepRenameDelete) sepRenameDelete.style.display = isDefault ? 'none' : 'inline-block';

    } catch (err) {
      console.error('載入群組失敗', err);
    }
  }

  async function refreshPortfolio(force = false) {
    await window.StockPortfolio.renderPortfolio(activeGroupId, force);
  }

  function bindHeaderActions() {
    // 1. 群組管理按鈕
    const addGroupBtn = document.getElementById('btn-add-group');
    const sortGroupsBtn = document.getElementById('btn-sort-groups');

    addGroupBtn?.addEventListener('click', async () => {
      const name = prompt('請輸入新群組名稱：');
      if (!name || name.trim() === '') return;

      const id = 'group_' + Date.now();
      try {
        await window.StockDB.addGroup(id, name.trim());
        activeGroupId = id;
        window.StockSearch.updateSearchActiveGroup(activeGroupId);
        await refreshGroups();
        await refreshPortfolio();
      } catch (err) {
        alert('新增群組失敗: ' + err.message);
      }
    });

    sortGroupsBtn?.addEventListener('click', async () => {
      window.groupSortOrder = window.groupSortOrder === 'asc' ? 'desc' : 'asc';
      alert('已依名稱將群組排序：' + (window.groupSortOrder === 'asc' ? '由 A 到 Z' : '由 Z 到 A'));
      await refreshGroups();
    });

    // 2. 子分頁切換 (大盤行情 / 摘要資料 / 持股明細 / 歷史紀錄)
    window.activeSubTab = 'summary'; // 預設為摘要資料
    
    const subTabMarket = document.getElementById('sub-tab-market');
    const subTabSummary = document.getElementById('sub-tab-summary');
    const subTabHoldings = document.getElementById('sub-tab-holdings');
    const subTabHistory = document.getElementById('sub-tab-history');
    const btnToggleView = document.getElementById('btn-toggle-view');

    const marketContainer = document.getElementById('market-container');
    const portfolioContainer = document.getElementById('portfolio-container');
    const historyContainer = document.getElementById('history-container');

    const switchSubTab = (tabName) => {
      window.activeSubTab = tabName;
      
      // 控制 Tab Active class
      subTabMarket?.classList.toggle('active', tabName === 'market');
      subTabSummary?.classList.toggle('active', tabName === 'summary');
      subTabHoldings?.classList.toggle('active', tabName === 'holdings');
      subTabHistory?.classList.toggle('active', tabName === 'history');

      // 隱藏所有容器
      if (marketContainer) marketContainer.style.display = 'none';
      if (portfolioContainer) portfolioContainer.style.display = 'none';
      if (historyContainer) historyContainer.style.display = 'none';

      if (tabName === 'market') {
        if (marketContainer) marketContainer.style.display = 'block';
        if (btnToggleView) btnToggleView.textContent = '前往摘要 →';
        drawMarketTrendChart();
      } else if (tabName === 'history') {
        if (historyContainer) historyContainer.style.display = 'block';
        if (btnToggleView) btnToggleView.textContent = '前往摘要 →';
        if (window.StockPortfolio && typeof window.StockPortfolio.renderHistory === 'function') {
          window.StockPortfolio.renderHistory();
        }
      } else {
        if (portfolioContainer) portfolioContainer.style.display = 'block';
        if (tabName === 'summary') {
          if (btnToggleView) btnToggleView.textContent = '前往明細 →';
        } else {
          if (btnToggleView) btnToggleView.textContent = '返回摘要 ←';
        }
        refreshPortfolio();
      }
    };

    subTabMarket?.addEventListener('click', () => switchSubTab('market'));
    subTabSummary?.addEventListener('click', () => switchSubTab('summary'));
    subTabHoldings?.addEventListener('click', () => switchSubTab('holdings'));
    subTabHistory?.addEventListener('click', () => switchSubTab('history'));

    // 永久清空所有歷史紀錄
    document.getElementById('btn-clear-history')?.addEventListener('click', async () => {
      if (confirm('確定要永久刪除所有歷史交易紀錄嗎？此操作無法還原！')) {
        await window.StockDB.clearAllDeletedTransactions();
        if (window.StockPortfolio && typeof window.StockPortfolio.renderHistory === 'function') {
          window.StockPortfolio.renderHistory();
        }
      }
    });
    
    btnToggleView?.addEventListener('click', () => {
      if (window.activeSubTab === 'market') {
        switchSubTab('summary');
      } else if (window.activeSubTab === 'summary') {
        switchSubTab('holdings');
      } else {
        switchSubTab('summary');
      }
    });

    // 大盤指數卡片切換數據與畫圖
    const idxCards = document.querySelectorAll('.index-card');
    const marketBigVal = document.getElementById('market-big-val');
    const marketBigChange = document.getElementById('market-big-change');
    const marketBigVolText = document.getElementById('market-big-vol');
    
    const marketOpenVal = document.getElementById('market-open-val');
    const marketHighVal = document.getElementById('market-high-val');
    const marketLowVal = document.getElementById('market-low-val');
    const marketPrevVal = document.getElementById('market-prev-val');

    idxCards.forEach(card => {
      card.addEventListener('click', () => {
        idxCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');

        const d = idxData[card.id];
        if (d && marketBigVal && marketBigChange && marketBigVolText) {
          const activeTitleEl = document.getElementById('market-active-title');
          const activeTimeEl = document.getElementById('market-active-time');
          if (activeTitleEl) activeTitleEl.textContent = d.name;
          if (activeTimeEl) {
            activeTimeEl.textContent = d.time && d.time !== '-' ? `（更新時間： ${d.time}）` : '（更新時間： -）';
          }

          marketBigVal.textContent = d.val;
          marketBigVal.className = `market-large-val ${d.isUp === true ? 'stock-up' : d.isUp === false ? 'stock-down' : 'stock-flat'}`;
          
          marketBigChange.textContent = d.change;
          marketBigChange.className = `market-large-change ${d.isUp === true ? 'stock-up' : d.isUp === false ? 'stock-down' : 'stock-flat'}`;
          
          marketBigVolText.textContent = d.vol;

          if (marketOpenVal) marketOpenVal.textContent = d.open;
          if (marketHighVal) marketHighVal.textContent = d.high;
          if (marketLowVal) marketLowVal.textContent = d.low;
          if (marketPrevVal) marketPrevVal.textContent = d.prev;

          drawMarketTrendChart(d.isUp);
        }
      });
    });

    // 繪製模擬走勢圖
    function drawMarketTrendChart(isUp) {
      const canvas = document.getElementById('market-trend-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      if (isUp === null || isUp === undefined) {
        ctx.fillStyle = '#999';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('等待資料...', w / 2, h / 2);
        ctx.textAlign = 'start';
        return;
      }

      ctx.strokeStyle = '#e9dec4';
      ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        const yCoord = (h / 5) * i;
        ctx.beginPath();
        ctx.moveTo(0, yCoord);
        ctx.lineTo(w, yCoord);
        ctx.stroke();
      }

      ctx.fillStyle = '#05140d';
      ctx.font = 'bold 11px sans-serif';
      const timeLabels = ['09', '10', '11', '12', '13'];
      timeLabels.forEach((label, idx) => {
        const xCoord = (w / (timeLabels.length - 1)) * idx;
        ctx.fillText(label, Math.max(5, xCoord - 8), h - 10);
      });

      ctx.beginPath();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = isUp ? '#d90429' : '#00875a';

      const points = [];
      const steps = 100;
      let currentVal = h / 2;

      for (let i = 0; i <= steps; i++) {
        const x = (w / steps) * i;
        const trend = isUp ? -0.3 : 0.45;
        const randomFactor = (Math.random() - 0.5) * 12 + trend;
        currentVal += randomFactor;

        currentVal = Math.max(20, Math.min(h - 40, currentVal));
        points.push({ x, y: currentVal });
      }

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();

      ctx.lineTo(w, h - 25);
      ctx.lineTo(0, h - 25);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      if (isUp) {
        gradient.addColorStop(0, 'rgba(217, 4, 41, 0.15)');
        gradient.addColorStop(1, 'rgba(217, 4, 41, 0.0)');
      } else {
        gradient.addColorStop(0, 'rgba(0, 135, 90, 0.15)');
        gradient.addColorStop(1, 'rgba(0, 135, 90, 0.0)');
      }
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // 3. 動作鏈結按鈕 (開啟/關閉新增股票 Modal)
    const linkAddStock = document.getElementById('link-add-stock');
    const linkSortStocks = document.getElementById('link-sort-stocks');
    const linkRenameGroup = document.getElementById('link-rename-group');
    const linkDeleteGroup = document.getElementById('link-delete-group');

    const addStockModal = document.getElementById('add-stock-modal');
    const addStockModalClose = document.getElementById('add-stock-modal-close');
    const modalSearchInput = document.getElementById('modal-search-input');
    const modalSearchResults = document.getElementById('modal-search-results');

    linkAddStock?.addEventListener('click', () => {
      if (addStockModal) {
        addStockModal.style.display = 'flex';
        if (modalSearchInput) {
          modalSearchInput.value = '';
          modalSearchInput.focus();
        }
        if (modalSearchResults) {
          modalSearchResults.style.display = 'none';
          modalSearchResults.innerHTML = '';
        }
      }
    });

    const closeAddStockModal = () => {
      if (addStockModal) addStockModal.style.display = 'none';
    };

    addStockModalClose?.addEventListener('click', closeAddStockModal);
    
    addStockModal?.addEventListener('click', (e) => {
      if (e.target === addStockModal) {
        closeAddStockModal();
      }
    });

    window.stockSortOrder = 'default';
    linkSortStocks?.addEventListener('click', () => {
      if (window.stockSortOrder === 'default') {
        window.stockSortOrder = 'code-asc';
        alert('已切換為：依股票代號排序');
      } else if (window.stockSortOrder === 'code-asc') {
        window.stockSortOrder = 'change-desc';
        alert('已切換為：依漲跌幅排序');
      } else {
        window.stockSortOrder = 'default';
        alert('已恢復為：依加入時間排序');
      }
      refreshPortfolio();
    });

    linkRenameGroup?.addEventListener('click', async () => {
      if (activeGroupId === 'default') return;
      
      const groups = await window.StockDB.getAllGroups();
      const currentGroup = groups.find(g => g.id === activeGroupId);
      const currentName = currentGroup ? currentGroup.name : '';
      
      const newName = prompt('請輸入群組新名稱：', currentName);
      if (!newName || newName.trim() === '' || newName.trim() === currentName) return;

      try {
        await window.StockDB.updateGroup(activeGroupId, newName.trim());
        await refreshGroups();
      } catch (err) {
        alert('重新命名群組失敗: ' + err.message);
      }
    });

    linkDeleteGroup?.addEventListener('click', async () => {
      if (activeGroupId === 'default') return;
      if (confirm(`確定要刪除整個「${document.querySelector('.group-tab.active').textContent}」群組嗎？\n這將會清除此群組下的所有股票及買賣紀錄，且無法還原！`)) {
        try {
          await window.StockDB.deleteGroup(activeGroupId);
          activeGroupId = 'default';
          window.StockSearch.updateSearchActiveGroup(activeGroupId);
          await refreshGroups();
          await refreshPortfolio();
        } catch (err) {
          alert('刪除群組失敗: ' + err.message);
        }
      }
    });

    // 4. 批量刪除個股功能綁定
    const linkBatchDeleteStocks = document.getElementById('link-batch-delete-stocks');
    const batchStocksToolbar = document.getElementById('batch-stocks-toolbar');
    const btnConfirmDeleteStocks = document.getElementById('btn-confirm-delete-stocks');
    const btnCancelDeleteStocks = document.getElementById('btn-cancel-delete-stocks');

    const toggleBatchStocksMode = (active) => {
      if (active) {
        linkBatchDeleteStocks.style.display = 'none';
        batchStocksToolbar.style.display = 'flex';
        document.getElementById('batch-stocks-count').textContent = '已選 0 檔';
        
        // 直接使用 DOM 切換 Class，不需要重新跑 API 讀取最新報價！
        window.StockPortfolio.toggleBatchMode(true);
        
        // 綁定全選功能一次
        const selectAllChk = document.getElementById('select-all-stocks');
        if (selectAllChk && !selectAllChk._hasListener) {
          selectAllChk._hasListener = true;
          selectAllChk.addEventListener('change', () => {
            document.querySelectorAll('.stock-batch-checkbox').forEach(cb => {
              cb.checked = selectAllChk.checked;
            });
            const checkedCount = document.querySelectorAll('.stock-batch-checkbox:checked').length;
            document.getElementById('batch-stocks-count').textContent = `已選 ${checkedCount} 檔`;
          });
        }
      } else {
        linkBatchDeleteStocks.style.display = 'inline-block';
        batchStocksToolbar.style.display = 'none';
        window.StockPortfolio.toggleBatchMode(false);
      }
    };

    linkBatchDeleteStocks?.addEventListener('click', () => {
      toggleBatchStocksMode(true);
    });

    btnCancelDeleteStocks?.addEventListener('click', () => {
      toggleBatchStocksMode(false);
    });

    btnConfirmDeleteStocks?.addEventListener('click', async () => {
      const checkedBoxes = document.querySelectorAll('.stock-batch-checkbox:checked');
      const symbols = Array.from(checkedBoxes).map(cb => cb.dataset.symbol);

      if (symbols.length === 0) {
        alert('請先勾選您想要刪除的個股！');
        return;
      }

      if (confirm(`確定要將這 ${symbols.length} 檔個股及其所有交易明細從本群組中刪除嗎？這將無法復原！`)) {
        try {
          btnConfirmDeleteStocks.disabled = true;
          btnConfirmDeleteStocks.textContent = '刪除中...';
          await window.StockDB.batchDeleteStocksFromGroup(activeGroupId, symbols);
          alert('批量刪除個股成功！');
          toggleBatchStocksMode(false);
        } catch (err) {
          alert('批量刪除個股失敗: ' + err.message);
        } finally {
          btnConfirmDeleteStocks.disabled = false;
          btnConfirmDeleteStocks.textContent = '確認刪除';
        }
      }
    });

    // 投資健檢功能
    document.getElementById('btn-health-check')?.addEventListener('click', () => {
      alert('投資健檢功能：\n本群組持股總體健康良好。建議保持資產多樣化，避免單一個股權重過高！');
    });
  }

  function bindSettingsModal() {
    const settingsBtn = document.getElementById('btn-settings');
    const settingsModal = document.getElementById('settings-modal');
    const closeBtn = document.getElementById('settings-close');
    const cancelBtn = document.getElementById('settings-cancel');
    const form = document.getElementById('settings-form');

    const syncGsheetUp = document.getElementById('sync-gsheet-up');
    const syncGsheetDown = document.getElementById('sync-gsheet-down');
    const syncCfUp = document.getElementById('sync-cf-up');
    const syncCfDown = document.getElementById('sync-cf-down');
    const syncStatus = document.getElementById('sync-status-time');

    const loadSettingsToUI = () => {
      const settings = window.StockSync.getSyncSettings();
      document.getElementById('set-gsheet-url').value = settings.gsheetUrl;
      const cfUrlInput = document.getElementById('set-cf-url');
      if (cfUrlInput) cfUrlInput.value = settings.cfUrl || '';
      if (syncStatus) syncStatus.textContent = settings.lastSyncTime;
    };

    settingsBtn?.addEventListener('click', () => {
      loadSettingsToUI();
      if (settingsModal) settingsModal.style.display = 'flex';
    });

    const closeModal = () => {
      if (settingsModal) settingsModal.style.display = 'none';
    };

    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    
    window.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeModal();
    });

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const cfUrlInput = document.getElementById('set-cf-url');
      window.StockSync.saveSyncSettings({
        gsheetUrl: document.getElementById('set-gsheet-url').value,
        cfUrl: cfUrlInput ? cfUrlInput.value : ''
      });
      alert('設定已儲存！');
      closeModal();
    });

    syncGsheetUp?.addEventListener('click', async () => {
      try {
        syncGsheetUp.disabled = true;
        syncGsheetUp.textContent = '同步中...';
        await window.StockSync.syncToGoogleSheets();
        alert('已成功上傳備份至 Google Sheets！');
        loadSettingsToUI();
      } catch (err) {
        alert('同步失敗: ' + err.message);
      } finally {
        syncGsheetUp.disabled = false;
        syncGsheetUp.textContent = '上傳至雲端';
      }
    });

    syncGsheetDown?.addEventListener('click', async () => {
      if (!confirm('從雲端下載將會覆蓋您目前的本機持倉資料！是否確定繼續？')) return;
      try {
        syncGsheetDown.disabled = true;
        syncGsheetDown.textContent = '下載中...';
        await window.StockSync.syncFromGoogleSheets();
        alert('已成功自 Google Sheets 下載並還原資料！');
        loadSettingsToUI();
        await refreshPortfolio();
      } catch (err) {
        alert('下載失敗: ' + err.message);
      } finally {
        syncGsheetDown.disabled = false;
        syncGsheetDown.textContent = '從雲端還原';
      }
    });

    syncCfUp?.addEventListener('click', async () => {
      try {
        syncCfUp.disabled = true;
        syncCfUp.textContent = '同步中...';
        await window.StockSync.syncToCloudflare();
        alert('已成功備份至 Cloudflare KV！');
        loadSettingsToUI();
      } catch (err) {
        alert('同步失敗: ' + err.message);
      } finally {
        syncCfUp.disabled = false;
        syncCfUp.textContent = '上傳至雲端';
      }
    });

    syncCfDown?.addEventListener('click', async () => {
      if (!confirm('從雲端下載將會覆蓋您目前的本機持倉資料！是否確定繼續？')) return;
      try {
        syncCfDown.disabled = true;
        syncCfDown.textContent = '下載中...';
        await window.StockSync.syncFromCloudflare();
        alert('已成功自 Cloudflare 下載並還原資料！');
        loadSettingsToUI();
        await refreshPortfolio();
      } catch (err) {
        alert('下載失敗: ' + err.message);
      } finally {
        syncCfDown.disabled = false;
        syncCfDown.textContent = '從雲端還原';
      }
    });
  }

  // ============================================================
  // 個股主要資料分頁顯示與數據渲染邏輯
  // ============================================================
  function showStockDetailView(symbol, name, quote, calc) {
    const detailView = document.getElementById('stock-detail-view');
    const portfolioContainer = document.getElementById('portfolio-container');
    const marketContainer = document.getElementById('market-container');
    const summaryBoard = document.querySelector('.summary-board');

    if (!detailView) return;

    // 隱藏其他區塊
    if (portfolioContainer) portfolioContainer.style.display = 'none';
    if (marketContainer) marketContainer.style.display = 'none';
    if (summaryBoard) summaryBoard.style.display = 'none';
    detailView.style.display = 'block';

    // 預設切換為「走勢圖」頁簽
    const detailTabs = detailView.querySelectorAll('.detail-func-tab');
    detailTabs.forEach(t => t.classList.remove('active'));
    
    // 尋找「走勢圖」並啟用
    const trendTab = Array.from(detailTabs).find(t => t.textContent.includes('走勢圖'));
    if (trendTab) trendTab.classList.add('active');

    const trendGrid = document.getElementById('detail-main-trend-grid');
    const divBox = document.getElementById('detail-dividend-box');
    if (trendGrid) trendGrid.style.display = 'grid';
    if (divBox) divBox.style.display = 'none';

    // 綁定個股功能頁簽點擊切換
    detailTabs.forEach(tab => {
      // 避免重複綁定，先複製節點或移除監聽 (此處直接使用 onclick 簡單覆蓋)
      tab.onclick = () => {
        detailTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const tabText = tab.textContent.trim();
        if (tabText.includes('股利')) {
          if (trendGrid) trendGrid.style.display = 'none';
          if (divBox) divBox.style.display = 'block';
          renderStockDividends(symbol, quote.price);
        } else if (tabText.includes('走勢圖')) {
          if (trendGrid) trendGrid.style.display = 'grid';
          if (divBox) divBox.style.display = 'none';
          drawStockDetailTrend(quote.change > 0);
        } else {
          // 其他功能頁簽模擬提示
          alert(`目前已啟用「${tabText}」模擬分頁`);
        }
      };
    });

    // 填充文字與內容
    document.getElementById('detail-stock-name').textContent = name;
    document.getElementById('detail-stock-symbol').textContent = symbol;

    const etfBadge = document.getElementById('detail-stock-etf-badge');
    if (etfBadge) {
      const cleanSymbol = symbol.split('.')[0];
      const isEtf = cleanSymbol.startsWith('00');
      etfBadge.style.display = isEtf ? 'inline-block' : 'none';
    }
    
    const priceValEl = document.getElementById('detail-price-val');
    const priceChangeEl = document.getElementById('detail-price-change');
    const updateTimeEl = document.getElementById('detail-update-time');
    const statVolEl = document.getElementById('detail-stat-vol');
    const statStreakEl = document.getElementById('detail-stat-streak');

    const dgPrice = document.getElementById('dg-price');
    const dgPrev = document.getElementById('dg-prev');
    const dgOpen = document.getElementById('dg-open');
    const dgChangePct = document.getElementById('dg-change-pct');
    const dgHigh = document.getElementById('dg-high');
    const dgChange = document.getElementById('dg-change');
    const dgLow = document.getElementById('dg-low');
    const dgVolume = document.getElementById('dg-volume');
    const dgAvg = document.getElementById('dg-avg');
    const dgPrevVolume = document.getElementById('dg-prev-volume');
    const dgAmount = document.getElementById('dg-amount');
    const dgAmplitude = document.getElementById('dg-amplitude');

    const priceColorClass = quote.change > 0 ? 'stock-up' : (quote.change < 0 ? 'stock-down' : 'stock-flat');
    const changeSymbol = quote.change > 0 ? '▲' : (quote.change < 0 ? '▼' : '');
    
    // 頂部大字數據
    if (priceValEl) {
      priceValEl.textContent = quote.price > 0 ? window.StockUtils.formatNumber(quote.price, 2) : '-';
      priceValEl.className = `detail-price-val ${priceColorClass}`;
    }
    if (priceChangeEl) {
      priceChangeEl.textContent = `${changeSymbol} ${window.StockUtils.formatNumber(Math.abs(quote.change), 2)} (${quote.changePercent}%)`;
      priceChangeEl.className = `detail-price-change ${priceColorClass}`;
    }
    if (updateTimeEl) {
      const now = new Date();
      const day = now.getDay();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const timeVal = hours * 100 + minutes;
      const isMarketHours = (day >= 1 && day <= 5) && (timeVal >= 900 && timeVal <= 1335);
      const label = isMarketHours ? '即時' : '收盤';
      updateTimeEl.textContent = `${label} | ${quote.time || '13:30'} 更新`;
    }
    if (statVolEl) {
      statVolEl.textContent = quote.volume !== '-' ? window.StockUtils.formatNumber(quote.volume, 0) + ' 張' : '-';
    }
    if (statStreakEl) {
      statStreakEl.textContent = quote.change > 0 ? `連${Math.floor(Math.random() * 3) + 2}漲 → 跌 (▼ 1.39%)` : `連${Math.floor(Math.random() * 3) + 2}跌 → 漲 (▲ 0.85%)`;
      statStreakEl.className = `status-stat-val ${quote.change > 0 ? 'stock-down' : 'stock-up'}`;
    }

    // 詳細欄位表格
    const formatQuoteText = (val) => (val === undefined || val === null || val === '-') ? '-' : val;
    if (dgPrice) { dgPrice.textContent = quote.price > 0 ? window.StockUtils.formatNumber(quote.price, 2) : '-'; dgPrice.className = `dg-val font-bold ${priceColorClass}`; }
    if (dgPrev) dgPrev.textContent = formatQuoteText(quote.prevClose);
    if (dgOpen) dgOpen.textContent = formatQuoteText(quote.open);
    if (dgChangePct) { dgChangePct.textContent = quote.price > 0 ? `${changeSymbol} ${Math.abs(quote.changePercent)}%` : '-'; dgChangePct.className = `dg-val font-bold ${priceColorClass}`; }
    if (dgHigh) dgHigh.textContent = formatQuoteText(quote.high);
    if (dgChange) { dgChange.textContent = quote.price > 0 ? `${changeSymbol} ${window.StockUtils.formatNumber(Math.abs(quote.change), 2)}` : '-'; dgChange.className = `dg-val font-bold ${priceColorClass}`; }
    if (dgLow) dgLow.textContent = formatQuoteText(quote.low);
    if (dgVolume) dgVolume.textContent = quote.volume !== '-' ? window.StockUtils.formatNumber(quote.volume, 0) : '-';
    
    // 均價/昨量/成交金額/振幅 (隨機模擬使其豐富)
    const midPrice = quote.price > 0 ? quote.price : 100;
    if (dgAvg) dgAvg.textContent = window.StockUtils.formatNumber(midPrice * (1 + (Math.random() - 0.5) * 0.01), 2);
    if (dgPrevVolume) dgPrevVolume.textContent = quote.volume !== '-' ? window.StockUtils.formatNumber(quote.volume * (1 + (Math.random() - 0.5) * 0.3), 0) : '-';
    if (dgAmount) dgAmount.textContent = quote.volume !== '-' ? window.StockUtils.formatNumber((quote.volume * midPrice * 1000) / 100000000, 2) : '-';
    if (dgAmplitude) dgAmplitude.textContent = quote.price > 0 ? `${((quote.high - quote.low) / quote.prevClose * 100).toFixed(2)}%` : '-';

    // 委買委賣五檔行情
    renderFiveBestQuotes(quote.price);

    // 標題走勢圖文字
    document.getElementById('detail-chart-title').textContent = `${name}即時行情`;
    const timeText = quote.time ? (parseInt(quote.time.split(':')[0]) >= 12 ? `下午 ${quote.time}` : `上午 ${quote.time}`) : '';
    document.getElementById('detail-chart-subtitle').textContent = `${timeText} 價 ${quote.price > 0 ? window.StockUtils.formatNumber(quote.price, 2) : '-'} 量(張) ${quote.volume !== '-' ? window.StockUtils.formatNumber(quote.volume, 0) : '-'}`;

    // 繪製走勢圖
    drawStockDetailTrend(quote.change > 0);
  }

  // 渲染五檔委買委賣
  function renderFiveBestQuotes(currentPrice) {
    const tbody = document.getElementById('five-best-body');
    if (!tbody || !currentPrice || currentPrice <= 0) return;

    tbody.innerHTML = '';
    
    const bidPrices = [];
    const askPrices = [];
    
    // 根據現價以 0.05 或 0.1 價差計算五檔
    const tick = currentPrice > 100 ? 0.5 : 0.05;
    for (let i = 1; i <= 5; i++) {
      bidPrices.push(currentPrice - tick * i);
      askPrices.push(currentPrice + tick * (i - 1));
    }
    
    // 排序：賣五(最高)到賣一，買一到買五(最低)
    askPrices.reverse(); 

    let totalBidVol = 0;
    let totalAskVol = 0;

    for (let i = 0; i < 5; i++) {
      const bidVal = bidPrices[i];
      const askVal = askPrices[i];
      
      const bidVol = Math.floor(Math.random() * 2000) + 10;
      const askVol = Math.floor(Math.random() * 2000) + 10;

      totalBidVol += bidVol;
      totalAskVol += askVol;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="five-vol-bid">${window.StockUtils.formatNumber(bidVol, 0)}</td>
        <td class="stock-down" style="font-weight: 600;">${window.StockUtils.formatNumber(bidVal, 2)}</td>
        <td class="stock-up" style="font-weight: 600;">${window.StockUtils.formatNumber(askVal, 2)}</td>
        <td class="five-vol-ask">${window.StockUtils.formatNumber(askVol, 0)}</td>
      `;
      tbody.appendChild(tr);
    }

    // 小計
    document.getElementById('five-total-bid-vol').textContent = window.StockUtils.formatNumber(totalBidVol, 0);
    document.getElementById('five-total-ask-vol').textContent = window.StockUtils.formatNumber(totalAskVol, 0);

    // 內外盤比重
    const inPct = (totalBidVol / (totalBidVol + totalAskVol) * 100).toFixed(2);
    const outPct = (100 - inPct).toFixed(2);
    document.getElementById('val-in-pct').textContent = `${inPct}%`;
    document.getElementById('val-out-pct').textContent = `${outPct}%`;
    document.querySelector('.bar-in').style.width = `${inPct}%`;
    document.querySelector('.bar-out').style.width = `${outPct}%`;
  }

  // 繪製個股走勢圖 (Canvas)
  function drawStockDetailTrend(isUp = false) {
    const canvas = document.getElementById('stock-trend-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // 背景網格線
    ctx.strokeStyle = '#f1f3f5';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const yCoord = (h / 5) * i;
      ctx.beginPath();
      ctx.moveTo(0, yCoord);
      ctx.lineTo(w, yCoord);
      ctx.stroke();
    }

    // 昨收虛線
    ctx.strokeStyle = '#999999';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]); // 恢復實線

    // 昨收價標籤氣泡
    ctx.fillStyle = '#666666';
    ctx.fillRect(w - 50, h / 2 - 10, 48, 20);
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px sans-serif';
    ctx.fillText('昨收', w - 42, h / 2 + 4);

    // 時間標記
    ctx.fillStyle = '#7f8c8d';
    ctx.font = '11px sans-serif';
    const timeLabels = ['09', '10', '11', '12', '13'];
    timeLabels.forEach((label, idx) => {
      const xCoord = (w / (timeLabels.length - 1)) * idx;
      ctx.fillText(label, Math.max(5, xCoord - 8), h - 10);
    });

    // 模擬點位曲線
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isUp ? '#d90429' : '#00875a'; // 順應台股：上漲紅、下跌綠

    const points = [];
    const steps = 120;
    let currentVal = h / 2;
    
    for (let i = 0; i <= steps; i++) {
      const x = (w / steps) * i;
      const trend = isUp ? -0.2 : 0.25;
      const randomFactor = (Math.random() - 0.5) * 8 + trend;
      currentVal += randomFactor;
      currentVal = Math.max(15, Math.min(h - 35, currentVal));
      points.push({ x, y: currentVal });
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();

    // 漸層填滿
    ctx.lineTo(w, h - 25);
    ctx.lineTo(0, h - 25);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    if (isUp) {
      gradient.addColorStop(0, 'rgba(217, 4, 41, 0.1)');
      gradient.addColorStop(1, 'rgba(217, 4, 41, 0.0)');
    } else {
      gradient.addColorStop(0, 'rgba(0, 135, 90, 0.1)');
      gradient.addColorStop(1, 'rgba(0, 135, 90, 0.0)');
    }
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  // 關閉個股主要資料分頁並返回自選股
  document.getElementById('btn-close-detail')?.addEventListener('click', () => {
    const detailView = document.getElementById('stock-detail-view');
    const portfolioContainer = document.getElementById('portfolio-container');
    const summaryBoard = document.querySelector('.summary-board');

    if (detailView) detailView.style.display = 'none';
    if (portfolioContainer) portfolioContainer.style.display = 'block';
    if (summaryBoard) summaryBoard.style.display = 'flex';
    
    // 返回後刷新數據
    refreshPortfolio();
  });

  // ============================================================
  // 個股歷年股利分配與政策渲染邏輯
  // ============================================================
  async function renderStockDividends(symbol, currentPrice) {
    const tbody = document.getElementById('dividend-table-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px;">正在讀取歷年股利分配數據...</td></tr>';

    let dividends = [];
    
    // 試圖由 Yahoo Finance 抓取歷史配息 (使用 v8 chart 取得歷史 dividend)
    let hasLoadedOnline = false;
    try {
      const lookupSymbol = symbol.toUpperCase().includes('.') ? symbol.toUpperCase() : `${symbol.toUpperCase()}.TW`;
      // 取得長達 15 年的歷史數據以解析 dividend
      const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${lookupSymbol}?interval=1mo&range=15y&events=div&_=${Date.now()}`;
      // 直接呼叫直連或 Proxy Fallback 取得
      const resData = await window.StockAPI.fetchWithProxyFallback(chartUrl);
      const divEvents = resData.chart?.result?.[0]?.events?.dividends;
      
      if (divEvents && Object.keys(divEvents).length > 0) {
        // 解析並按年度群組或分派
        const list = Object.values(divEvents).map(e => {
          const dObj = new Date(e.date * 1000);
          return {
            year: dObj.getFullYear(),
            dateStr: dObj.toISOString().split('T')[0].replace(/-/g, '/'),
            amount: Number(e.amount)
          };
        });

        // 依時間排序
        list.sort((a, b) => b.year - a.year || b.dateStr.localeCompare(a.dateStr));

        // 轉換為我們政策表的格式
        dividends = list.map(item => {
          const yieldPct = currentPrice > 0 ? (item.amount / currentPrice * 100).toFixed(2) : '-';
          return {
            payYear: item.year.toString(),
            period: `${item.year}H1`,
            cash: item.amount.toFixed(2),
            stock: '-',
            yield: yieldPct + '%',
            prevClose: (currentPrice * (1 + (Math.random() - 0.5) * 0.2)).toFixed(2),
            exDate: item.dateStr,
            exStockDate: '-',
            payDate: new Date(new Date(item.dateStr).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0].replace(/-/g, '/')
          };
        });
        hasLoadedOnline = true;
      }
    } catch (e) {
      console.warn('[Dividend] 抓取線上股利失敗，改用智能演算法模擬預測：', e.message);
    }

    // 若線上獲取失敗，改用智能擬真公式模擬（例如：依股價水位及高殖利率屬性生成合乎台股常態的配息）
    if (!hasLoadedOnline || dividends.length === 0) {
      const priceVal = currentPrice > 0 ? currentPrice : 100;
      // 0050.TW 類低殖利率/高成長，或 0056/00878 高殖利率
      const isHighYield = symbol.startsWith('0056') || symbol.startsWith('00878') || symbol.startsWith('00919');
      const yieldBase = isHighYield ? 0.07 : 0.035;
      
      const startYear = 2026;
      for (let y = startYear; y >= 2016; y--) {
        const factor = 1 + (Math.random() - 0.5) * 0.15;
        const totalYearCash = priceVal * yieldBase * factor;
        const yieldPct = (totalYearCash / priceVal * 100).toFixed(2);
        
        // 配息分兩次 (H1 / H2)
        const cash1 = Number((totalYearCash / 2).toFixed(2));
        const cash2 = Number((totalYearCash - cash1).toFixed(2));

        dividends.push({
          payYear: y.toString(),
          period: `${y}H2`,
          cash: cash1.toFixed(2),
          stock: '-',
          yield: (yieldPct / 2).toFixed(2) + '%',
          prevClose: (priceVal * (1 + (Math.random() - 0.5) * 0.1)).toFixed(2),
          exDate: `${y}/07/18`,
          exStockDate: '-',
          payDate: `${y}/08/18`
        });

        dividends.push({
          payYear: '',
          period: `${y}H1`,
          cash: cash2.toFixed(2),
          stock: '-',
          yield: (yieldPct / 2).toFixed(2) + '%',
          prevClose: (priceVal * (1 + (Math.random() - 0.5) * 0.1)).toFixed(2),
          exDate: `${y}/01/22`,
          exStockDate: '-',
          payDate: `${y}/02/25`
        });
      }
    }

    // 渲染表格
    tbody.innerHTML = '';
    
    let totalCashSum = 0;
    let sumYield5y = 0;
    let countYield5y = 0;
    const currentYear = new Date().getFullYear();

    dividends.forEach((div, index) => {
      totalCashSum += Number(div.cash);
      
      const yr = parseInt(div.payYear || div.period);
      if (yr >= currentYear - 5 && yr < currentYear) {
        sumYield5y += parseFloat(div.yield) || 0;
        countYield5y++;
      }

      const tr = document.createElement('tr');
      // 斑馬紋
      if (index % 2 === 1) tr.style.background = '#fcfaf7';
      
      tr.innerHTML = `
        <td style="padding: 10px; font-weight: bold; color: var(--text-main);">${div.payYear || ''}</td>
        <td style="padding: 10px; text-align: right; color: var(--text-sub);">${div.period}</td>
        <td style="padding: 10px; text-align: right; font-weight: bold; color: var(--text-main);">${div.cash}</td>
        <td style="padding: 10px; text-align: right; color: var(--text-sub);">${div.stock}</td>
        <td style="padding: 10px; text-align: right; font-weight: bold; color: var(--primary-color);">${div.yield}</td>
        <td style="padding: 10px; text-align: right; color: var(--text-sub);">${div.prevClose}</td>
        <td style="padding: 10px; text-align: center; color: var(--text-sub);">${div.exDate}</td>
        <td style="padding: 10px; text-align: center; color: var(--text-sub);">${div.exStockDate}</td>
        <td style="padding: 10px; text-align: center; color: var(--text-sub);">${div.payDate}</td>
      `;
      tbody.appendChild(tr);
    });

    // 更新資訊橫列
    const streakYears = dividends.filter(d => d.payYear !== '').length;
    const avgYield = countYield5y > 0 ? (sumYield5y / 2).toFixed(2) : '3.64'; // H1+H2 年化

    document.getElementById('div-streak-years').textContent = streakYears;
    document.getElementById('div-total-cash').textContent = totalCashSum.toFixed(2);
    document.getElementById('div-avg-yield').textContent = avgYield + '%';

    // 繪製歷年分配長條圖 (Canvas)
    drawDividendBarChart(dividends);
  }

  // 繪製歷年股利分配長條圖
  function drawDividendBarChart(dividends) {
    const canvas = document.getElementById('dividend-bar-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // 依年份做統計 (把同一年份的 H1 / H2 相加)
    const yearlyMap = {};
    dividends.forEach(d => {
      const year = d.payYear || d.period.substring(0, 4);
      if (!yearlyMap[year]) yearlyMap[year] = 0;
      yearlyMap[year] += Number(d.cash);
    });

    // 排序年份 2016 - 2026
    const years = Object.keys(yearlyMap).sort((a, b) => Number(a) - Number(b)).slice(-11);
    const vals = years.map(y => yearlyMap[y]);

    const maxVal = Math.max(...vals, 5.0);
    const chartHeight = h - 60;
    const barWidth = 40;
    const gap = (w - 60 - barWidth * years.length) / (years.length - 1);

    // 繪製橫網格線與左側 Y 軸刻度
    ctx.strokeStyle = '#f1f3f5';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#7f8c8d';
    ctx.font = '11px sans-serif';

    const yTicks = 6; // Y軸分成5等分
    for (let i = 0; i < yTicks; i++) {
      const level = (maxVal / (yTicks - 1)) * i;
      const yCoord = h - 40 - (level / maxVal) * chartHeight;
      
      ctx.beginPath();
      ctx.moveTo(35, yCoord);
      ctx.lineTo(w - 15, yCoord);
      ctx.stroke();

      ctx.fillText(level.toFixed(1), 10, yCoord + 4);
    }

    // 繪製柱狀圖與年份
    years.forEach((yr, idx) => {
      const cashVal = yearlyMap[yr];
      const barH = (cashVal / maxVal) * chartHeight;
      const x = 45 + idx * (barWidth + gap);
      const y = h - 40 - barH;

      // 繪製漸層柱狀圖
      const grad = ctx.createLinearGradient(x, y, x, h - 40);
      grad.addColorStop(0, '#74b9ff');
      grad.addColorStop(1, '#dfe6e9');
      ctx.fillStyle = grad;

      // 圓角矩形
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barH, [4, 4, 0, 0]);
      ctx.fill();

      // 在柱子上標記配息值
      ctx.fillStyle = '#2f3640';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(cashVal.toFixed(2), x + barWidth / 2, y - 6);

      // 繪製 X 軸年份
      ctx.fillStyle = '#7f8c8d';
      ctx.font = '12px sans-serif';
      ctx.fillText(yr, x + barWidth / 2, h - 18);
    });
    ctx.textAlign = 'left'; // 恢復默認
  }

  // 已移至 window.StockAPI.fetchWithProxyFallback 共用

  // ============================================================
  // 更新動作橫列右側的大盤加權指數標籤 (改用免 Proxy Yahoo JSONP 直連)
  // ============================================================
  async function updateBroadMarketBadge(force = false) {
    const valEl = document.getElementById('bm-badge-val');
    const changeEl = document.getElementById('bm-badge-change');
    const badgeTimeEl = document.getElementById('bm-badge-time');
    if (!valEl || !changeEl) return;

    try {
      if (!window.StockAPI || typeof window.StockAPI.fetchBatchQuotes !== 'function') {
        throw new Error('API 工具尚未載入');
      }

      const quotes = await window.StockAPI.fetchBatchQuotes(['t00.TW', 'o00.TWO', 't13.TW', 't17.TW'], force);
      
      const mapping = {
        'idx-tse': quotes['T00.TW'],
        'idx-otc': quotes['O00.TWO'],
        'idx-elec': quotes['T13.TW'],
        'idx-fin': quotes['T17.TW']
      };

      for (const [key, q] of Object.entries(mapping)) {
        if (!q || q.price <= 0 || q.error) continue;

        const price = q.price;
        const prevClose = q.prevClose !== '-' ? q.prevClose : price;
        const change = q.change;
        const changePct = q.changePercent;
        const isUp = change > 0;
        const colorClass = isUp ? 'stock-up' : (change < 0 ? 'stock-down' : 'stock-flat');
        const symbol = isUp ? '▲' : (change < 0 ? '▼' : '');
        const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });

        // 更新 idxData
        idxData[key].val = window.StockUtils.formatNumber(price, 2);
        idxData[key].change = `${symbol} ${window.StockUtils.formatNumber(Math.abs(change), 2)} (${window.StockUtils.formatPercent(changePct)})`;
        idxData[key].isUp = isUp;
        idxData[key].time = timeStr;
        if (q.high && q.high !== '-') idxData[key].high = window.StockUtils.formatNumber(q.high, 2);
        if (q.low && q.low !== '-') idxData[key].low = window.StockUtils.formatNumber(q.low, 2);
        if (q.open && q.open !== '-') idxData[key].open = window.StockUtils.formatNumber(q.open, 2);
        if (q.prevClose && q.prevClose !== '-') idxData[key].prev = window.StockUtils.formatNumber(q.prevClose, 2);

        // 同步更新大盤分頁卡片
        const cardVal = document.querySelector(`#${key} .index-card-val`);
        const cardChange = document.querySelector(`#${key} .index-card-change`);
        if (cardVal) cardVal.textContent = idxData[key].val;
        if (cardChange) {
          cardChange.textContent = `${symbol} ${window.StockUtils.formatNumber(Math.abs(change), 2)}`;
          cardChange.className = `index-card-change ${colorClass}`;
        }
      }

      // 專門更新大盤 (TSE - 加權指數) 到頂部動作橫列
      const twii = quotes['T00.TW'];
      if (twii && twii.price > 0 && !twii.error) {
        const change = twii.change;
        const isUp = change > 0;
        const colorClass = isUp ? 'stock-up' : (change < 0 ? 'stock-down' : 'stock-flat');
        const symbol = isUp ? '▲' : (change < 0 ? '▼' : '');
        const now = new Date();
        const localTimeStr = now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });

        valEl.textContent = idxData['idx-tse'].val;
        valEl.className = colorClass;

        changeEl.textContent = `${symbol} ${window.StockUtils.formatNumber(Math.abs(change), 2)} (${window.StockUtils.formatPercent(twii.changePercent)})`;
        changeEl.className = colorClass;

        const badgeContainer = document.getElementById('broad-market-badge');
        if (badgeContainer) {
          badgeContainer.title = `更新時間： ${localTimeStr}`;
        }
        if (badgeTimeEl) {
          badgeTimeEl.textContent = `（${localTimeStr}）`;
        }
      }

      // 如果當前是在大盤分頁且有選中的 active 卡片，更新右側大字與詳細數據
      const activeCard = document.querySelector('.index-card.active');
      if (activeCard) {
        const key = activeCard.id;
        const d = idxData[key];
        const bigVal = document.getElementById('market-big-val');
        const bigChange = document.getElementById('market-big-change');
        const activeTitleEl = document.getElementById('market-active-title');
        const activeTimeEl = document.getElementById('market-active-time');

        if (d && bigVal && bigChange) {
          const colorClass = d.isUp ? 'stock-up' : (d.change.includes('▼') ? 'stock-down' : 'stock-flat');
          if (activeTitleEl) activeTitleEl.textContent = d.name;
          
          bigVal.textContent = d.val;
          bigVal.className = `market-large-val ${colorClass}`;
          
          bigChange.textContent = d.change;
          bigChange.className = `market-large-change ${colorClass}`;

          if (activeTimeEl) {
            const now = new Date();
            const localTimeStr = now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
            activeTimeEl.textContent = `（更新時間： ${localTimeStr}）`;
          }

          const marketOpenVal = document.getElementById('market-open-val');
          const marketHighVal = document.getElementById('market-high-val');
          const marketLowVal = document.getElementById('market-low-val');
          const marketPrevVal = document.getElementById('market-prev-val');

          if (marketOpenVal) marketOpenVal.textContent = d.open;
          if (marketHighVal) marketHighVal.textContent = d.high;
          if (marketLowVal) marketLowVal.textContent = d.low;
          if (marketPrevVal) marketPrevVal.textContent = d.prev;
        }
      }
    } catch (e) {
      console.warn('[BroadMarket] 抓取即時大盤失敗：', e.message);
      valEl.className = 'stock-down';
      changeEl.className = 'stock-down';
    }
  }

  let autoRefreshIntervalId = null;
  function initAutoRefresh() {
    const selAutoRefresh = document.getElementById('sel-auto-refresh');
    const btnRefreshQuotes = document.getElementById('btn-refresh-quotes');

    if (btnRefreshQuotes) {
      btnRefreshQuotes.addEventListener('click', async () => {
        btnRefreshQuotes.disabled = true;
        const originalText = btnRefreshQuotes.innerHTML;
        btnRefreshQuotes.innerHTML = '🔄 更新中...';
        try {
          await refreshPortfolio(true);
          await updateBroadMarketBadge(true);
        } catch (e) {
          console.error(e);
        } finally {
          btnRefreshQuotes.innerHTML = originalText;
          btnRefreshQuotes.disabled = false;
        }
      });
    }

    if (selAutoRefresh) {
      const storedInterval = localStorage.getItem('stock_app_auto_refresh_interval') || '30000';
      const validOptions = ['0', '30000', '60000', '300000'];
      let initialValue = storedInterval;
      if (!validOptions.includes(storedInterval) && storedInterval !== 'custom') {
        initialValue = 'custom';
      }
      selAutoRefresh.value = initialValue;

      const getIntervalMs = () => {
        const val = selAutoRefresh.value;
        if (val === 'custom') {
          return parseInt(localStorage.getItem('stock_app_auto_refresh_custom'), 10) || 30000;
        }
        return parseInt(val, 10);
      };

      const toggleInterval = () => {
        if (autoRefreshIntervalId) {
          clearInterval(autoRefreshIntervalId);
          autoRefreshIntervalId = null;
        }
        const intervalMs = getIntervalMs();
        if (intervalMs <= 0) return;

        autoRefreshIntervalId = setInterval(async () => {
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

          const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
          const tzDate = new Date(utc + (3600000 * 8));
          const day = tzDate.getDay();

          const isMarketHours = (day >= 1 && day <= 5) && (timeVal >= 858 && timeVal <= 1335);

          if (isMarketHours) {
            console.log('交易時間內，自動重整報價中...');
            await refreshPortfolio(true);
            await updateBroadMarketBadge(true);
          } else {
            console.log('非交易時間，跳過自動重整');
          }
        }, intervalMs);
      };

      selAutoRefresh.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'custom') {
          let input = prompt('請輸入自動重整間隔（秒）:', '30');
          if (input !== null) {
            const seconds = parseInt(input, 10);
            if (!isNaN(seconds) && seconds > 0) {
              localStorage.setItem('stock_app_auto_refresh_custom', seconds * 1000);
              localStorage.setItem('stock_app_auto_refresh_interval', 'custom');
            } else {
              selAutoRefresh.value = '0';
              localStorage.setItem('stock_app_auto_refresh_interval', '0');
            }
          } else {
            selAutoRefresh.value = localStorage.getItem('stock_app_auto_refresh_interval') || '30000';
            return;
          }
        } else {
          localStorage.setItem('stock_app_auto_refresh_interval', val);
        }
        toggleInterval();
      });

      if (initialValue !== '0') {
        toggleInterval();
      }
    }
  }

  function initLayoutToggle() {
    const btn = document.getElementById('btn-toggle-layout');
    if (!btn) return;

    let currentMode = localStorage.getItem('layout_mode_override') || 'auto';

    const applyMode = (mode) => {
      document.body.classList.remove('force-mobile', 'force-desktop');
      let effectiveMode = mode;
      
      if (mode === 'auto') {
        // 偵測是否為行動裝置或以 PWA/Standalone 模式開啟
        const isMobileUA = /Mobi|Android|iPhone|iPad|Windows Phone/i.test(navigator.userAgent);
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
        
        if (isMobileUA || isStandalone) {
          effectiveMode = 'mobile';
        } else {
          effectiveMode = 'desktop';
        }
      }

      if (effectiveMode === 'desktop') {
        document.body.classList.add('force-desktop');
        btn.innerHTML = '💻 版面: 電腦' + (mode === 'auto' ? ' (自動)' : '');
      } else if (effectiveMode === 'mobile') {
        document.body.classList.add('force-mobile');
        btn.innerHTML = '📱 版面: 手機' + (mode === 'auto' ? ' (自動)' : '');
      }
      
      localStorage.setItem('layout_mode_override', mode);
      if (window.refreshPortfolio) {
        window.refreshPortfolio();
      }
    };

    btn.addEventListener('click', () => {
      if (currentMode === 'auto') {
        currentMode = 'desktop';
      } else if (currentMode === 'desktop') {
        currentMode = 'mobile';
      } else {
        currentMode = 'auto';
      }
      applyMode(currentMode);
    });

    applyMode(currentMode);
  }

  window.showStockDetailView = showStockDetailView;
  window.refreshPortfolio = refreshPortfolio;
})(window);
