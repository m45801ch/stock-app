const CACHE_NAME = "tw-stock-tracker-v17";
const ASSETS = [
  "./",
  "./index.html",
  "./css/index.css",
  "./js/app.js",
  "./js/db.js",
  "./js/api.js",
  "./js/sync.js",
  "./js/portfolio.js",
  "./js/transaction.js",
  "./js/search.js",
  "./js/utils.js",
  "./js/stock_data.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// 安裝並快取資源
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// 啟用並清除舊快取
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 攔截請求
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  
  // 只攔截本站同源的靜態資源，外部 API (Yahoo, TWSE, CORS Proxies) 一律走網路，不快取
  if (!url.origin.startsWith(self.location.origin)) {
    return;
  }

  // 靜態資源使用 Cache-First 策略
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((networkResponse) => {
        if (networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // 離線且無快取時的 fallback
        if (e.request.mode === "navigate") {
          return caches.match("./index.html");
        }
      });
    })
  );
});
