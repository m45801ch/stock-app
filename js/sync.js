(function(window) {
  function getSyncSettings() {
    return {
      gsheetUrl: localStorage.getItem('sync_gsheet_url') || '',
      cfUrl: localStorage.getItem('sync_cf_url') || '',
      lastSyncTime: localStorage.getItem('sync_last_time') || '從未同步'
    };
  }

  function saveSyncSettings(settings) {
    if (settings.gsheetUrl !== undefined) localStorage.setItem('sync_gsheet_url', settings.gsheetUrl.trim());
    if (settings.cfUrl !== undefined) localStorage.setItem('sync_cf_url', settings.cfUrl.trim());
  }

  async function syncToGoogleSheets() {
    const { gsheetUrl } = getSyncSettings();
    if (!gsheetUrl) {
      throw new Error('未設定 Google Sheets Web App 網址');
    }

    const data = await window.StockDB.exportAllData();

    const response = await fetch(gsheetUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'upload',
        payload: data
      })
    });

    if (!response.ok) {
      throw new Error('上傳至 Google 試算表失敗，狀態碼: ' + response.status);
    }
    
    const result = await response.json().catch(() => ({}));
    if (result && result.status === 'error') {
      throw new Error(result.message || 'Google Apps Script 執行錯誤');
    }

    localStorage.setItem('sync_last_time', new Date().toLocaleString('zh-TW'));
    return true;
  }

  async function syncFromGoogleSheets() {
    const { gsheetUrl } = getSyncSettings();
    if (!gsheetUrl) {
      throw new Error('未設定 Google Sheets Web App 網址');
    }

    const getUrl = `${gsheetUrl}?action=download`;
    const response = await fetch(getUrl);
    if (!response.ok) throw new Error('雲端下載失敗');
    
    const result = await response.json();
    if (result && result.payload) {
      await window.StockDB.importAllData(result.payload);
      localStorage.setItem('sync_last_time', new Date().toLocaleString('zh-TW'));
      return true;
    } else {
      throw new Error('雲端無備份資料');
    }
  }

  async function syncToCloudflare() {
    const { cfUrl } = getSyncSettings();
    if (!cfUrl) {
      throw new Error('未設定 Cloudflare Worker 網址');
    }

    const data = await window.StockDB.exportAllData();

    const response = await fetch(cfUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'upload',
        payload: data
      })
    });

    if (!response.ok) {
      throw new Error('上傳至 Cloudflare 失敗，狀態碼: ' + response.status);
    }

    const result = await response.json().catch(() => ({}));
    if (result && result.status === 'error') {
      throw new Error(result.message || 'Cloudflare Worker 執行錯誤');
    }

    localStorage.setItem('sync_last_time', new Date().toLocaleString('zh-TW'));
    return true;
  }

  async function syncFromCloudflare() {
    const { cfUrl } = getSyncSettings();
    if (!cfUrl) {
      throw new Error('未設定 Cloudflare Worker 網址');
    }

    const getUrl = `${cfUrl}?action=download`;
    const response = await fetch(getUrl);
    if (!response.ok) {
      throw new Error('自 Cloudflare 讀取失敗，狀態碼: ' + response.status);
    }

    const result = await response.json();
    if (result && result.payload) {
      await window.StockDB.importAllData(result.payload);
      localStorage.setItem('sync_last_time', new Date().toLocaleString('zh-TW'));
      return true;
    } else {
      throw new Error('雲端無備份資料');
    }
  }

  window.StockSync = {
    getSyncSettings,
    saveSyncSettings,
    syncToGoogleSheets,
    syncFromGoogleSheets,
    syncToCloudflare,
    syncFromCloudflare
  };
})(window);
