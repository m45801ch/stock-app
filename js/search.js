(function(window) {
  let activeGroupId = 'default';

  function initSearch(onStockAdded) {
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const searchBtn = document.querySelector('.search-icon-btn');

    if (!searchInput || !searchResults) return;

    // 執行搜尋與結果渲染
    async function triggerSearch() {
      const query = searchInput.value.trim();
      
      // 當輸入太短時不搜尋
      if (query.length < 2) {
        searchResults.innerHTML = '<div class="search-no-result">請輸入至少 2 個字元以進行搜尋</div>';
        searchResults.style.display = 'block';
        return;
      }

      searchResults.innerHTML = '<div class="search-loading">搜尋中...</div>';
      searchResults.style.display = 'block';

      try {
        const results = await window.StockAPI.searchStock(query);
        renderResults(results, searchResults, onStockAdded);
      } catch (err) {
        searchResults.innerHTML = '<div class="search-error">搜尋失敗</div>';
      }
    }

    // 1. 移除了 input 事件，改為只監聽 Enter 鍵按下 (修復使用者要求：不要馬上搜尋)
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); // 阻止 Enter 鍵的預設表單提交行為
        triggerSearch();
      }
    });

    // 2. 當點擊旁邊的「搜尋圖案」放大鏡按鈕時觸發搜尋 (修復搜尋圖案點擊無反應)
    searchBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      searchInput.focus();
      triggerSearch();
    });

    // 3. 點選輸入框取得焦點時，如果裡面已經有搜尋結果，直接展開，沒有則不主動展開
    searchInput.addEventListener('focus', () => {
      if (searchResults.children.length > 0) {
        searchResults.style.display = 'block';
      }
    });

    // 4. 點選外部任意地方關閉搜尋結果選單
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !searchResults.contains(e.target) && !searchBtn?.contains(e.target)) {
        searchResults.style.display = 'none';
      }
    });

    // 5. 初始化彈出式視窗搜尋框 (Modal Search)
    const modalSearchInput = document.getElementById('modal-search-input');
    const modalSearchResults = document.getElementById('modal-search-results');
    const modalSearchBtn = document.getElementById('modal-search-btn');

    if (modalSearchInput && modalSearchResults) {
      async function triggerModalSearch() {
        const query = modalSearchInput.value.trim();
        if (query.length < 2) {
          modalSearchResults.innerHTML = '<div class="search-no-result">請輸入至少 2 個字元以進行搜尋</div>';
          modalSearchResults.style.display = 'block';
          return;
        }

        modalSearchResults.innerHTML = '<div class="search-loading">搜尋中...</div>';
        modalSearchResults.style.display = 'block';

        try {
          const results = await window.StockAPI.searchStock(query);
          renderResults(results, modalSearchResults, onStockAdded);
        } catch (err) {
          modalSearchResults.innerHTML = '<div class="search-error">搜尋失敗</div>';
        }
      }

      modalSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          triggerModalSearch();
        }
      });

      modalSearchBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerModalSearch();
      });

      modalSearchInput.addEventListener('input', () => {
        if (modalSearchInput.value.trim() === '') {
          modalSearchResults.style.display = 'none';
          modalSearchResults.innerHTML = '';
        }
      });
    }
  }

  function updateSearchActiveGroup(groupId) {
    activeGroupId = groupId;
  }

  async function renderResults(results, container, onStockAdded) {
    if (results.length === 0) {
      container.innerHTML = '<div class="search-no-result">查無此台股股票代號或名稱</div>';
      return;
    }

    const existingStocks = await window.StockDB.getStocksByGroup(activeGroupId);
    const existingSymbols = new Set(existingStocks.map(s => s.symbol));

    container.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'search-results-list';

    results.forEach(stock => {
      const li = document.createElement('li');
      li.className = 'search-item';
      
      const isAdded = existingSymbols.has(stock.symbol);

      li.innerHTML = `
        <div class="search-item-info">
          <span class="search-item-symbol">${stock.symbol}</span>
          <span class="search-item-name">${stock.name}</span>
        </div>
        <button class="search-add-btn" ${isAdded ? 'disabled' : ''}>
          ${isAdded ? '已加入' : '加入'}
        </button>
      `;

      if (!isAdded) {
        const btn = li.querySelector('.search-add-btn');
        btn.addEventListener('click', async () => {
          try {
            await window.StockDB.addStockToGroup(activeGroupId, stock.symbol, stock.name);
            btn.textContent = '已加入';
            btn.disabled = true;
            
            if (onStockAdded) onStockAdded();
          } catch (err) {
            alert('新增失敗: ' + err.message);
          }
        });
      }

      ul.appendChild(li);
    });

    container.appendChild(ul);
  }

  window.StockSearch = {
    initSearch,
    updateSearchActiveGroup
  };
})(window);
