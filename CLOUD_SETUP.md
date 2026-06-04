# 雲端同步設定教學手冊

本程式支援 **Google 試算表** 以及 **Cloudflare KV** 兩種雲端同步備份方案，您可以自由選擇其中一種或兩者皆設定。以下為您說明如何設定並取得所需的金鑰：

---

## 方案 A：Google 試算表同步 (最推薦)

本方案能將您的交易資料直接備份到您的 Google 雲端硬碟，並可透過試算表直觀查看。

### 步驟 1：建立 Google 試算表
1. 開啟 [Google 試算表](https://sheets.google.com/)，建立一個新的空白試算表。
2. 記下該試算表網址中的 **ID**。
   - 網址格式為：`https://docs.google.com/spreadsheets/d/【這一串就是試算表ID】/edit`

### 步驟 2：建立 Apps Script 網頁服務
1. 在試算表上方選單點選 **「擴充功能」 -> 「Apps Script」**。
2. 將裡面的程式碼清空，並貼上以下代碼（請將程式碼中的 `YOUR_SPREADSHEET_ID_HERE` 換成您在步驟 1 取得的 ID）：

```javascript
const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID_HERE"; // 請替換成您的試算表 ID

function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);
    const action = postData.action;
    const payload = postData.payload;
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    if (action === 'upload') {
      // 1. 將完整 JSON 備份資料寫入 "BACKUP_DATA" 工作表 (供 App 下載還原使用)
      let backupSheet = ss.getSheetByName("BACKUP_DATA");
      if (!backupSheet) {
        backupSheet = ss.insertSheet("BACKUP_DATA");
      }
      backupSheet.clear();
      backupSheet.getRange(1, 1).setValue(JSON.stringify(payload));
      
      // 2. 自動匯出「群組列表」工作表
      let groupSheet = ss.getSheetByName("群組列表");
      if (!groupSheet) {
        groupSheet = ss.insertSheet("群組列表");
      }
      groupSheet.clear();
      groupSheet.appendRow(["群組ID", "群組名稱"]);
      if (payload.groups && payload.groups.length > 0) {
        payload.groups.forEach(function(g) {
          groupSheet.appendRow([g.id, g.name]);
        });
      }
      
      // 3. 自動匯出「交易明細」工作表 (包含關聯父交易，方便對帳)
      let txSheet = ss.getSheetByName("交易明細");
      if (!txSheet) {
        txSheet = ss.insertSheet("交易明細");
      }
      txSheet.clear();
      txSheet.appendRow(["交易ID", "群組ID", "股票代號", "交易日期", "交易類別", "交易股數", "交易單價", "交易總額", "關聯父交易ID"]);
      if (payload.transactions && payload.transactions.length > 0) {
        payload.transactions.forEach(function(tx) {
          txSheet.appendRow([
            tx.id,
            tx.groupId,
            tx.symbol,
            tx.date,
            tx.type === 'buy' ? '買入' : '賣出',
            tx.shares,
            tx.price,
            tx.shares * tx.price,
            tx.parentId || ""
          ]);
        });
      }
      
      // 4. 自動匯出「個股持倉總覽」並自動套用 GoogleFinance 報價公式！
      let portfolioSheet = ss.getSheetByName("個股持倉總覽");
      if (!portfolioSheet) {
        portfolioSheet = ss.insertSheet("個股持倉總覽");
      }
      portfolioSheet.clear();
      portfolioSheet.appendRow(["群組名稱", "股票代號", "個股名稱", "持有股數", "持股均價", "持股成本", "當前市價 (GoogleFinance)", "當前市值", "未實現損益", "未實現報酬率"]);
      
      const groupsMap = {};
      if (payload.groups) {
        payload.groups.forEach(function(g) { groupsMap[g.id] = g.name; });
      }
      
      const stockMap = {};
      if (payload.stocks) {
        payload.stocks.forEach(function(s) {
          stockMap[s.groupId + "_" + s.symbol] = s.name;
        });
      }
      
      const holdings = {};
      if (payload.transactions) {
        // 依日期排列
        const sortedTxs = [].concat(payload.transactions).sort(function(a, b) {
          return new Date(a.date) - new Date(b.date);
        });
        sortedTxs.forEach(function(tx) {
          const key = tx.groupId + "_" + tx.symbol;
          if (!holdings[key]) {
            holdings[key] = { groupId: tx.groupId, symbol: tx.symbol, shares: 0, totalCost: 0 };
          }
          if (tx.type === 'buy') {
            holdings[key].shares += tx.shares;
            holdings[key].totalCost += (tx.shares * tx.price);
          } else if (tx.type === 'sell') {
            const avgCostBefore = holdings[key].shares > 0 ? holdings[key].totalCost / holdings[key].shares : 0;
            holdings[key].shares -= tx.shares;
            if (holdings[key].shares < 0) holdings[key].shares = 0;
            holdings[key].totalCost = holdings[key].shares * avgCostBefore;
          }
        });
      }
      
      let rowIdx = 2;
      Object.keys(holdings).forEach(function(key) {
        const item = holdings[key];
        if (item.shares > 0) {
          const groupName = groupsMap[item.groupId] || "預設群組";
          const stockName = stockMap[item.groupId + "_" + item.symbol] || item.symbol;
          const avgCost = item.totalCost / item.shares;
          
          // 將台股轉換為 GoogleFinance 支援的規格 (例如 2330.TW -> TPE:2330)
          const cleanCode = item.symbol.replace(/\.(TW|TWO)$/i, '');
          const gfSymbol = "TPE:" + cleanCode;
          
          portfolioSheet.appendRow([
            groupName,
            item.symbol,
            stockName,
            item.shares,
            avgCost,
            item.totalCost,
            '=GOOGLEFINANCE("' + gfSymbol + '", "price")',
            '=D' + rowIdx + '*G' + rowIdx, // 持有股數 * 當前市價
            '=H' + rowIdx + '-F' + rowIdx, // 當前市值 - 持股成本
            '=IF(F' + rowIdx + '>0, I' + rowIdx + '/F' + rowIdx + ', 0)' // 未實現損益 / 持股成本
          ]);
          rowIdx++;
        }
      });
      
      // 套用試算表格式美化
      if (rowIdx > 2) {
        portfolioSheet.getRange("E2:F" + rowIdx).setNumberFormat("$#,##0.00");
        portfolioSheet.getRange("G2:H" + rowIdx).setNumberFormat("$#,##0.00");
        portfolioSheet.getRange("I2:I" + rowIdx).setNumberFormat("$#,##0.00");
        portfolioSheet.getRange("J2:J" + rowIdx).setNumberFormat("0.00%");
      }
      
      return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.message }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'download') {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const backupSheet = ss.getSheetByName("BACKUP_DATA");
      if (!backupSheet) {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "找不到備份工作表" }))
                             .setMimeType(ContentService.MimeType.JSON);
      }
      const dataStr = backupSheet.getRange(1, 1).getValue();
      return ContentService.createTextOutput(JSON.stringify({ status: "success", payload: JSON.parse(dataStr) }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.message }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}
```

3. 點選上方**「儲存」**按鈕 (磁碟圖示)。

### 步驟 3：部署為網頁應用程式
1. 點選右上角的 **「部署」 -> 「新增部署」**。
2. 點選齒輪圖示，選取 **「網頁應用程式」**。
3. 設定如下：
   - 說明：可輸入 `v1`
   - 專案執行身分：**「我」** (您的 Google 帳戶)
   - 誰有存取權：**「所有人」** (Anyone，這很重要，否則程式無法從外部打 API)
4. 點選 **「部署」**。
5. 此時會彈出視窗要求授權，請點選 **「授予存取權」**，選擇您的 Google 帳戶。如果顯示「Google 尚未驗證此應用程式」，請點擊左下角的 **「進階」 -> 「前往「未命名專案」(不安全)」**，然後點擊 **「允許」**。
6. 部署成功後，複製畫面上的 **「網頁應用程式網址」** (URL)。
   - 格式為：`https://script.google.com/macros/s/【一長串代碼】/exec`

### 步驟 4：貼回程式中
* 打開本程式的「設定與雲端同步」，將此網址貼入 **Google Apps Script Web App 網址** 輸入框中，點選「儲存設定」即可！

---

## 方案 B：Cloudflare KV 同步 (更安全、避免 CORS 攔截)

為了徹底避開瀏覽器對於 Cloudflare API 直連產生的 CORS 跨網域封鎖限制，且避免將您的 API Token 暴露在網頁瀏覽器中，我們改用部署一個極輕量、安全的 **Cloudflare Worker** 作為中繼。

### 步驟 1：建立 KV 命名空間 (Namespace)
1. 登入 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 點選左側選單 **「Workers & Pages」 -> 「KV」**。
3. 點選右上角 **「Create namespace」**，命名空間名稱填寫：`tw_stock_backup`，點選 Add。
4. 建立後，請記下該命名空間的名稱。

### 步驟 2：建立並部署 Workers 服務
1. 點選左側選單 **「Workers & Pages」 -> 「Overview」**。
2. 點選 **「Create application」 -> 「Create Worker」**。
3. 服務名稱輸入 `tw-stock-worker`（或自訂），直接點選最下方的 **「Deploy」**。
4. 部署成功後，點選 **「Edit code」** 進入程式碼編輯器。
5. 將裡面的程式碼清空，完整複製並貼上以下代碼：

```javascript
export default {
  async fetch(request, env, ctx) {
    // 設定 CORS 標頭以允許網頁端跨網域存取
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      
      if (request.method === "POST") {
        const body = await request.json();
        if (body.action === "upload") {
          // 將資產備份以 JSON 字串型式寫入 KV 中
          await env.STOCK_KV.put("tw_stock_backup_data", JSON.stringify(body.payload));
          return new Response(JSON.stringify({ status: "success" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      } else if (request.method === "GET") {
        const action = url.searchParams.get("action");
        if (action === "download") {
          const data = await env.STOCK_KV.get("tw_stock_backup_data");
          if (!data) {
            return new Response(JSON.stringify({ status: "error", message: "雲端無備份資料" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          return new Response(JSON.stringify({ status: "success", payload: JSON.parse(data) }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }
      return new Response("Not Found", { status: 404 });
    } catch (err) {
      return new Response(JSON.stringify({ status: "error", message: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
```

6. 點選右上角 **「Save and deploy」** 儲存並部署。

### 步驟 3：綁定 KV 命名空間至 Worker
1. 回到剛才建立的 `tw-stock-worker` 儀表板頁面。
2. 點選上方選單的 **「Bindings」** 分頁 (位於 Deployments 右方)。
3. 點選 **「Add binding」**，並在彈出的視窗中點選右下角的藍色 **「Add Binding」** 按鈕。
4. 視窗關閉後，在多出來的 KV Namespace 欄位中設定：
   - Variable name (變數名稱，必須大寫)：`STOCK_KV`
   - KV namespace：選擇您在步驟 1 建立的 `tw_stock_backup` 空間。
5. 點選最下方的 **「Save and deploy」** 完成綁定。

### 步驟 4：貼回程式中
1. 複製該 Worker 服務的網頁網址，例如：`https://tw-stock-worker.您的子網域.workers.dev`。
2. 打開本程式的「設定與雲端同步」，將此網址貼入 **Cloudflare Worker 網址** 輸入框中，點選「儲存設定」即可！

---

## 方案 B 追加：如何查看與管理您的雲端備份

若您需要手動檢查備份的資料內容或進行刪除，可透過以下步驟操作：

1. 登入 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 點選左側選單的 **「Storage & databases」 -> 「Workers KV」**。
3. 點選您的命名空間：**`tw_stock_backup`**。
4. 點選上方分頁中的 **「KV 組」** 分頁。
5. 在列表裡會出現 `tw_stock_backup_data` 金鑰：
   - 點選右側的 **「檢視」**：可查看當前備份的完整 JSON 資料值。
   - 點選右側的 **「...」** 按鈕 -> 點選 **「刪除」**：即可手動將該筆備份清除。


