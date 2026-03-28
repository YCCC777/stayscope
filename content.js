// ============================================================
// StayScope — Content Script 入口
// 本檔案僅負責：呼叫平台提取器 → 快取結果 → 訊息監聽 → SPA 偵測
// 平台提取邏輯分別在 extractors/{airbnb,booking,agoda}.js
// 共用工具函式在 extractors/base.js
// ============================================================

(function () {
  'use strict';

  let cachedData = null;

  // ---- 主要提取函式 ----
  // window.__siteExtractFn 由對應的 extractor 檔案注入
  function extractCoordinates() {
    if (cachedData) return cachedData;

    const result = typeof window.__siteExtractFn === 'function'
      ? window.__siteExtractFn()
      : null;

    if (result) {
      // 若提取器無法得到國家代碼，以座標範圍推算（base.js 提供）
      if (!result.country && result.lat != null) {
        result.country = detectCountryFromCoords(result.lat, result.lng);
      }
      cachedData = { ...result, success: true, url: location.href };
    } else {
      cachedData = { success: false, url: location.href };
    }

    return cachedData;
  }

  // ---- 監聽 Popup 的訊息請求 ----
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getCoordinates') {
      const data = extractCoordinates();
      sendResponse(data);
    }
    return true; // 保持訊息通道開啟
  });

  // ---- SPA 導航偵測（Airbnb 是 React SPA，切換頁面不會完整重載） ----
  let lastUrl = location.href;

  const navObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      cachedData = null; // 清除快取

      const isListing = /\/rooms\/\d+/.test(location.pathname)         // Airbnb
        || /booking\.com\/hotel\//.test(location.href)                  // Booking
        || /agoda\.com.*\/hotel\//.test(location.href)                  // Agoda
        || /trip\.com\/hotels\//.test(location.href)                    // Trip.com
        || (/vrbo\.com/.test(location.href) && (/\/\d+(?:[?#]|$)/.test(location.pathname) || /\.ha\.\d+\.html/.test(location.pathname))); // VRBO

      if (isListing) {
        // 等待新頁面內容渲染完成後重新提取
        setTimeout(() => {
          const data = extractCoordinates();
          chrome.runtime.sendMessage({ action: 'coordinatesUpdated', data }).catch(() => {});
        }, 2000);
      }
    }
  });

  navObserver.observe(document.documentElement, { subtree: true, childList: true });

  // ---- 初次載入時提取 ----
  setTimeout(() => {
    const data = extractCoordinates();
    chrome.runtime.sendMessage({ action: 'coordinatesUpdated', data }).catch(() => {});
  }, 1000);

})();
