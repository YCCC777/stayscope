// ============================================================
// StayScope — Storage Layer
// 策略：sync + local 雙寫，讀取時合併去重（取最新 savedAt）
// sync 限 100KB，超出時繼續寫 local 保底
// ============================================================
'use strict';

const FAVORITES_KEY = 'ss_favorites';  // Array<FavoriteItem>

// ---- 內部：同時讀取 sync + local，合併後去重 ----
function _getMergedFavorites() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(FAVORITES_KEY, (syncResult) => {
      const syncList = (chrome.runtime.lastError ? [] : syncResult[FAVORITES_KEY]) || [];
      chrome.storage.local.get(FAVORITES_KEY, (localResult) => {
        const localList = (localResult[FAVORITES_KEY]) || [];
        // 合併：以 id 去重，保留 savedAt 較新的那筆
        const map = new Map();
        for (const item of [...localList, ...syncList]) {
          const existing = map.get(item.id);
          if (!existing || (item.savedAt || 0) > (existing.savedAt || 0)) {
            map.set(item.id, item);
          }
        }
        // 保持 savedAt 降序
        const merged = [...map.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        resolve(merged);
      });
    });
  });
}

// ---- 讀取所有收藏 ----
function getFavorites() {
  return _getMergedFavorites();
}

// ---- 同步狀態：'ok' | 'local_only'，供 UI 顯示圓點 ----
let _syncStatus = 'ok';
function getSyncStatus() { return _syncStatus; }
// popup 可設定一個 callback 在狀態改變時更新 UI
let _syncStatusCallback = null;
function onSyncStatusChange(cb) { _syncStatusCallback = cb; }
function _notifySyncStatus(status) {
  _syncStatus = status;
  if (_syncStatusCallback) _syncStatusCallback(status);
}

// ---- 儲存收藏陣列（同時寫 sync + local）----
function setFavorites(list) {
  return new Promise((resolve) => {
    const payload = { [FAVORITES_KEY]: list };
    // 先寫 local（可靠、不限大小）
    chrome.storage.local.set(payload, () => {
      // 再嘗試同步寫 sync（作為跨裝置鏡像）
      chrome.storage.sync.set(payload, () => {
        if (chrome.runtime.lastError) {
          // sync 超限時靜默忽略，local 仍已寫入
          console.warn('[StayScope] sync quota exceeded, local only');
          _notifySyncStatus('local_only');
        } else {
          _notifySyncStatus('ok');
        }
        resolve();
      });
    });
  });
}

// ---- 新增收藏（去重） ----
async function addFavorite(item) {
  const list = await getFavorites();
  const existing = list.findIndex(f => f.id === item.id);
  if (existing >= 0) {
    list[existing] = item; // 更新
  } else {
    list.unshift(item); // 插入最前面
  }
  await setFavorites(list);
  return list;
}

// ---- 刪除收藏 ----
async function removeFavorite(id) {
  const list = await getFavorites();
  const updated = list.filter(f => f.id !== id);
  await setFavorites(updated);
  return updated;
}

// ---- 更新單筆收藏（checklist、tags、notes 等欄位） ----
async function updateFavorite(id, patch) {
  const list = await getFavorites();
  const idx = list.findIndex(f => f.id === id);
  if (idx < 0) return list;
  list[idx] = { ...list[idx], ...patch };
  await setFavorites(list);
  return list;
}

// ---- 判斷 URL 是否已收藏 ----
async function isFavorited(id) {
  const list = await getFavorites();
  return list.some(f => f.id === id);
}

// ---- 幫助函式：從 URL 生成穩定 ID ----
// 簡易 hash（無需 crypto），對 URL 做 djb2
function urlToId(url) {
  // 去掉 query string 和 fragment，保留核心路徑
  let u;
  try { u = new URL(url); } catch { return url.slice(-32); }
  const key = u.hostname + u.pathname;
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h) ^ key.charCodeAt(i);
    h = h >>> 0; // 轉 uint32
  }
  return h.toString(36);
}

// ============================================================
// ---- 瀏覽歷史（chrome.storage.local，最多 20 筆） ----
// ============================================================
const HISTORY_KEY = 'ss_history';
const HISTORY_MAX = 20;

function addHistory(item) {
  return new Promise((resolve) => {
    chrome.storage.local.get(HISTORY_KEY, (result) => {
      let list = result[HISTORY_KEY] || [];
      list = list.filter(h => h.id !== item.id); // 去重
      list.unshift({ ...item, visitedAt: Date.now() });
      if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
      chrome.storage.local.set({ [HISTORY_KEY]: list }, () => resolve(list));
    });
  });
}

function getHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(HISTORY_KEY, (result) => {
      resolve(result[HISTORY_KEY] || []);
    });
  });
}

function clearHistory() {
  return new Promise((resolve) => chrome.storage.local.remove(HISTORY_KEY, resolve));
}

// ---- 比較選取 ID（跨頁面傳遞） ----
const COMPARE_SEL_KEY = 'ss_compare_selection';

function setCompareSelection(ids) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [COMPARE_SEL_KEY]: ids }, resolve);
  });
}

function getCompareSelection() {
  return new Promise((resolve) => {
    chrome.storage.local.get(COMPARE_SEL_KEY, (r) => resolve(r[COMPARE_SEL_KEY] || []));
  });
}

// ============================================================
// ---- 房源價格紀錄（chrome.storage.local，每房源最多 20 筆） ----
// ============================================================
const PRICE_LOG_KEY = 'ss_price_log';
const PRICE_LOG_MAX = 20;   // 每筆房源最多保留幾筆價格記錄
const PRICE_PROP_MAX = 200; // 最多追蹤幾筆不同房源

// entry 結構：{ amount, currency, display, checkin, checkout, recordedAt }
function savePriceEntry(propId, entry) {
  return new Promise((resolve) => {
    chrome.storage.local.get(PRICE_LOG_KEY, (res) => {
      const log = res[PRICE_LOG_KEY] || {};
      let list = log[propId] || [];
      // 去重策略：
      //   有日期 → 同入住/退房期間只保留最新一筆（避免重複記錄）
      //   無日期 → 同一曆日只保留一筆（允許跨日漲跌比較）
      const entryDay = new Date(entry.recordedAt || Date.now()).toDateString();
      list = list.filter(e => {
        if (entry.checkin !== null) {
          return !(e.checkin === entry.checkin && e.checkout === entry.checkout);
        } else {
          return new Date(e.recordedAt || 0).toDateString() !== entryDay;
        }
      });
      list.unshift({ ...entry, recordedAt: entry.recordedAt || Date.now() });
      if (list.length > PRICE_LOG_MAX) list = list.slice(0, PRICE_LOG_MAX);
      log[propId] = list;

      // 房源總數超限時，淘汰最舊（最早 recordedAt）的那一筆
      const propIds = Object.keys(log);
      if (propIds.length > PRICE_PROP_MAX) {
        let oldestId = null, oldestTime = Infinity;
        for (const id of propIds) {
          if (id === propId) continue;
          const t = log[id]?.[0]?.recordedAt || 0;
          if (t < oldestTime) { oldestTime = t; oldestId = id; }
        }
        if (oldestId) delete log[oldestId];
      }

      chrome.storage.local.set({ [PRICE_LOG_KEY]: log }, () => resolve(list));
    });
  });
}

function getPriceLog(propId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(PRICE_LOG_KEY, (res) => {
      const log = res[PRICE_LOG_KEY] || {};
      resolve(log[propId] || []);
    });
  });
}

function getAllPriceLogs() {
  return new Promise((resolve) => {
    chrome.storage.local.get(PRICE_LOG_KEY, (res) => {
      resolve(res[PRICE_LOG_KEY] || {});
    });
  });
}

// ---- 命名空間化 export ----
window.StayScope = window.StayScope || {};
Object.assign(window.StayScope, {
  getFavorites,
  setFavorites,
  addFavorite,
  removeFavorite,
  updateFavorite,
  isFavorited,
  urlToId,
  addHistory,
  getHistory,
  clearHistory,
  setCompareSelection,
  getCompareSelection,
  getSyncStatus,
  onSyncStatusChange,
  savePriceEntry,
  getPriceLog,
  getAllPriceLogs,
});
