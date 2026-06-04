(function(window) {
  const DB_NAME = 'TWStockTrackerDB';
  const DB_VERSION = 2; // 升級版本以建立新 store

  let dbInstance = null;

  function initDB() {
    return new Promise((resolve, reject) => {
      if (dbInstance) return resolve(dbInstance);

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 群組
        if (!db.objectStoreNames.contains('groups')) {
          const groupStore = db.createObjectStore('groups', { keyPath: 'id' });
          groupStore.add({ id: 'default', name: '預設' });
        }

        // 自選股
        if (!db.objectStoreNames.contains('stocks')) {
          db.createObjectStore('stocks', { keyPath: 'id', autoIncrement: true });
          const stockStore = request.transaction.objectStore('stocks');
          stockStore.createIndex('groupId', 'groupId', { unique: false });
          stockStore.createIndex('symbol', 'symbol', { unique: false });
          stockStore.createIndex('group_symbol', ['groupId', 'symbol'], { unique: true });
        }

        // 交易紀錄
        if (!db.objectStoreNames.contains('transactions')) {
          const txStore = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
          txStore.createIndex('symbol', 'symbol', { unique: false });
          txStore.createIndex('groupId', 'groupId', { unique: false });
        }

        // 新增台股中文字典 Store
        if (!db.objectStoreNames.contains('stock_dictionary')) {
          const dictStore = db.createObjectStore('stock_dictionary', { keyPath: 'symbol' });
          dictStore.createIndex('code', 'code', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  function getStore(storeName, mode = 'readonly') {
    return initDB().then((db) => {
      const tx = db.transaction(storeName, mode);
      return tx.objectStore(storeName);
    });
  }

  function getAllGroups() {
    return new Promise(async (resolve, reject) => {
      try {
        const store = await getStore('groups');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (e) { reject(e); }
    });
  }

  function addGroup(id, name) {
    return new Promise(async (resolve, reject) => {
      try {
        const store = await getStore('groups', 'readwrite');
        const request = store.add({ id, name });
        request.onsuccess = () => resolve({ id, name });
        request.onerror = () => reject(request.error);
      } catch (e) { reject(e); }
    });
  }

  function updateGroup(id, name) {
    return new Promise(async (resolve, reject) => {
      try {
        const store = await getStore('groups', 'readwrite');
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const data = getReq.result;
          if (!data) return reject(new Error('找不到該群組'));
          data.name = name;
          const putReq = store.put(data);
          putReq.onsuccess = () => resolve(data);
          putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
      } catch (e) { reject(e); }
    });
  }

  function deleteGroup(id) {
    return new Promise(async (resolve, reject) => {
      if (id === 'default') return reject(new Error('不能刪除預設群組'));
      try {
        const db = await initDB();
        const tx = db.transaction(['groups', 'stocks', 'transactions'], 'readwrite');
        
        tx.objectStore('groups').delete(id);

        const stockStore = tx.objectStore('stocks');
        const stockIndex = stockStore.index('groupId');
        const stockReq = stockIndex.openCursor(IDBKeyRange.only(id));
        stockReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };

        const txStore = tx.objectStore('transactions');
        const txIndex = txStore.index('groupId');
        const txReq = txIndex.openCursor(IDBKeyRange.only(id));
        txReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  function getStocksByGroup(groupId) {
    return new Promise(async (resolve, reject) => {
      try {
        const store = await getStore('stocks');
        const index = store.index('groupId');
        const request = index.getAll(IDBKeyRange.only(groupId));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (e) { reject(e); }
    });
  }

  function addStockToGroup(groupId, symbol, name) {
    return new Promise(async (resolve, reject) => {
      try {
        const store = await getStore('stocks', 'readwrite');
        const item = { groupId, symbol, name, addedAt: new Date().toISOString() };
        const request = store.add(item);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (e) { reject(e); }
    });
  }

  function deleteStockFromGroup(groupId, symbol) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await initDB();
        const tx = db.transaction(['stocks', 'transactions'], 'readwrite');
        
        const stockStore = tx.objectStore('stocks');
        const index = stockStore.index('group_symbol');
        const getReq = index.getKey([groupId, symbol]);
        getReq.onsuccess = () => {
          const key = getReq.result;
          if (key !== undefined) {
            stockStore.delete(key);
          }
        };

        const txStore = tx.objectStore('transactions');
        const request = txStore.openCursor();
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            if (cursor.value.groupId === groupId && cursor.value.symbol === symbol) {
              cursor.delete();
            }
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  function batchDeleteStocksFromGroup(groupId, symbols) {
    return new Promise(async (resolve, reject) => {
      if (!symbols || symbols.length === 0) return resolve(true);
      try {
        const db = await initDB();
        const tx = db.transaction(['stocks', 'transactions'], 'readwrite');
        const stockStore = tx.objectStore('stocks');
        const txStore = tx.objectStore('transactions');
        const symbolSet = new Set(symbols);

        // 1. 刪除 stocks 中符合 groupId 且 symbol 在 symbols 中的紀錄
        const stockIndex = stockStore.index('groupId');
        const stockReq = stockIndex.openCursor(IDBKeyRange.only(groupId));
        stockReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            if (symbolSet.has(cursor.value.symbol)) {
              cursor.delete();
            }
            cursor.continue();
          }
        };

        // 2. 刪除 transactions 中符合 groupId 且 symbol 在 symbols 中的交易紀錄
        const txReq = txStore.openCursor();
        txReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            if (cursor.value.groupId === groupId && symbolSet.has(cursor.value.symbol)) {
              cursor.delete();
            }
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  function getTransactionsByStock(groupId, symbol) {
    return new Promise(async (resolve, reject) => {
      try {
        const store = await getStore('transactions');
        const request = store.openCursor();
        const results = [];
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            if (cursor.value.groupId === groupId && cursor.value.symbol === symbol) {
              results.push({ id: cursor.key, ...cursor.value });
            }
            cursor.continue();
          } else {
            results.sort((a, b) => new Date(a.date) - new Date(b.date));
            resolve(results);
          }
        };
        request.onerror = () => reject(request.error);
      } catch (e) { reject(e); }
    });
  }

  function addTransaction(groupId, symbol, date, type, shares, price, parentId = null) {
    return new Promise(async (resolve, reject) => {
      try {
        const store = await getStore('transactions', 'readwrite');
        const tx = {
          groupId,
          symbol,
          date,
          type,
          shares: Number(shares),
          price: Number(price),
          parentId: parentId ? Number(parentId) : null, // 保存父交易 ID
          createdAt: new Date().toISOString()
        };
        const request = store.add(tx);
        request.onsuccess = () => resolve({ id: request.result, ...tx });
        request.onerror = () => reject(request.error);
      } catch (e) { reject(e); }
    });
  }

  function deleteTransaction(id) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await initDB();
        const tx = db.transaction('transactions', 'readwrite');
        const store = tx.objectStore('transactions');
        
        // 1. 刪除本筆交易
        store.delete(Number(id));

        // 2. 連同刪除以本筆交易為父交易 ID 的所有關聯子交易
        const request = store.openCursor();
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            if (cursor.value.parentId === Number(id)) {
              cursor.delete();
            }
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  /**
   * 批量刪除交易紀錄（含各自的子交易）
   * 一個 IDB transaction 搞定，不觸發多次 UI 重整
   * @param {number[]} ids - 要刪除的交易 id 陣列
   */
  function batchDeleteTransactions(ids) {
    return new Promise(async (resolve, reject) => {
      if (!ids || ids.length === 0) return resolve(true);
      try {
        const db = await initDB();
        const tx = db.transaction('transactions', 'readwrite');
        const store = tx.objectStore('transactions');
        const idSet = new Set(ids.map(Number));

        // 1. 刪除所有選取的父交易
        idSet.forEach(id => store.delete(id));

        // 2. 掃一次 cursor，刪除所有 parentId 在 idSet 中的子交易
        const req = store.openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            if (cursor.value.parentId && idSet.has(cursor.value.parentId)) {
              cursor.delete();
            }
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  // --- 本地台股字典 (Stock Dictionary) 操作 ---
  function saveStocksToDictionary(stockList) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await initDB();
        const tx = db.transaction('stock_dictionary', 'readwrite');
        const store = tx.objectStore('stock_dictionary');
        
        stockList.forEach(stock => {
          store.put(stock); // 使用 put 覆寫或新增
        });

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  function getStockFromDictionary(symbol) {
    return new Promise(async (resolve, reject) => {
      try {
        const store = await getStore('stock_dictionary');
        const request = store.get(symbol);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (e) { reject(e); }
    });
  }

  function searchStocksLocally(query) {
    return new Promise(async (resolve, reject) => {
      try {
        const store = await getStore('stock_dictionary');
        const request = store.openCursor();
        const results = [];
        const cleanQuery = query.toUpperCase().trim();

        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const val = cursor.value;
            // 模糊比對代號或名稱
            if (val.symbol.includes(cleanQuery) || val.code.includes(cleanQuery) || val.name.includes(cleanQuery)) {
              results.push(val);
            }
            // 限制回傳最大搜尋筆數，加快前端渲染
            if (results.length >= 15) {
              resolve(results);
              return;
            }
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        request.onerror = () => reject(request.error);
      } catch (e) { reject(e); }
    });
  }

  function getDictionaryCount() {
    return new Promise(async (resolve, reject) => {
      try {
        const store = await getStore('stock_dictionary');
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (e) { reject(e); }
    });
  }

  // --- 匯出 / 匯入資料功能 ---
  function exportAllData() {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await initDB();
        const tx = db.transaction(['groups', 'stocks', 'transactions'], 'readonly');
        const data = {};

        const getGroups = new Promise((res) => {
          tx.objectStore('groups').getAll().onsuccess = (e) => { data.groups = e.target.result; res(); };
        });
        const getStocks = new Promise((res) => {
          tx.objectStore('stocks').getAll().onsuccess = (e) => { data.stocks = e.target.result; res(); };
        });
        const getTxs = new Promise((res) => {
          tx.objectStore('transactions').getAll().onsuccess = (e) => { data.transactions = e.target.result; res(); };
        });

        await Promise.all([getGroups, getStocks, getTxs]);
        resolve(data);
      } catch (e) { reject(e); }
    });
  }

  function importAllData(data) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await initDB();
        const tx = db.transaction(['groups', 'stocks', 'transactions'], 'readwrite');

        tx.objectStore('groups').clear();
        tx.objectStore('stocks').clear();
        tx.objectStore('transactions').clear();

        if (data.groups) {
          data.groups.forEach((g) => tx.objectStore('groups').add(g));
        } else {
          tx.objectStore('groups').add({ id: 'default', name: '預設' });
        }

        if (data.stocks) {
          data.stocks.forEach((s) => {
            delete s.id;
            tx.objectStore('stocks').add(s);
          });
        }

        if (data.transactions) {
          data.transactions.forEach((t) => {
            delete t.id;
            tx.objectStore('transactions').add(t);
          });
        }

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  function updateTransaction(id, updatedData) {
    return new Promise(async (resolve, reject) => {
      try {
        const store = await getStore('transactions', 'readwrite');
        const getReq = store.get(Number(id));
        getReq.onsuccess = () => {
          const data = getReq.result;
          if (!data) return reject(new Error('找不到該筆交易紀錄'));
          
          // 將傳入欄位覆寫 (並確保型態正確)
          if (updatedData.date !== undefined) data.date = updatedData.date;
          if (updatedData.type !== undefined) data.type = updatedData.type;
          if (updatedData.shares !== undefined) data.shares = Number(updatedData.shares);
          if (updatedData.price !== undefined) data.price = Number(updatedData.price);
          if (updatedData.parentId !== undefined) {
            data.parentId = updatedData.parentId ? Number(updatedData.parentId) : null;
          }
          
          const putReq = store.put(data);
          putReq.onsuccess = () => resolve(data);
          putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
      } catch (e) { reject(e); }
    });
  }

  window.StockDB = {
    initDB,
    getAllGroups,
    addGroup,
    updateGroup,
    deleteGroup,
    getStocksByGroup,
    addStockToGroup,
    deleteStockFromGroup,
    batchDeleteStocksFromGroup,
    getTransactionsByStock,
    addTransaction,
    deleteTransaction,
    batchDeleteTransactions,
    updateTransaction, // 暴露更新 API
    saveStocksToDictionary,
    getStockFromDictionary,
    searchStocksLocally,
    getDictionaryCount,
    exportAllData,
    importAllData
  };
})(window);
