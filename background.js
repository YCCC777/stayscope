// ============================================================
// StayScope — Background Service Worker
// 負責管理工具列圖示的徽章狀態
// ============================================================

'use strict';

// 收到 content.js 或 popup.js 傳來的座標更新通知
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action !== 'coordinatesUpdated') return;

  // content.js 帶 sender.tab；popup.js 帶 message.tabId
  const tabId = sender.tab?.id || message.tabId;
  if (!tabId) return;

  if (message.data?.success) {
    // 找到座標：顯示綠色勾勾徽章
    chrome.action.setBadgeText({ text: '✓', tabId }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#34C759', tabId }).catch(() => {});
  } else {
    // 在支援頁面但無法提取座標：顯示警告
    chrome.action.setBadgeText({ text: '!', tabId }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#FF9F0A', tabId }).catch(() => {});
  }
});

// 離開支援的訂房頁面時清除徽章
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const url = changeInfo.url;
  const isListingPage = /airbnb.*\/rooms\/\d+/.test(url)
    || /booking\.com\/hotel\/[a-z]{2}\//.test(url)
    || /agoda\.com.*\/hotel\//.test(url)
    || /trip\.com\/hotels\//.test(url);

  if (!isListingPage) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }
});
