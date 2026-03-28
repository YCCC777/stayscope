// ============================================================
// StayScope — Popup Script  (P2)
// ============================================================
'use strict';

// ---- 全域狀態 ----
let coords     = null;   // { lat, lng }
let keywords   = null;   // SEARCH_KEYWORDS[countryCode]
let ui         = null;   // UI_STRINGS[lang]
let currentData = null;  // 最新的 content.js 回應
let currentUrl  = '';    // 目前房源 URL（用於收藏 ID）
let currentTabTitle = ''; // 目前分頁標題（房源頁面的 document.title）
let favList     = [];    // 快取的收藏陣列
let activeFilter = 'ALL';
let customCats   = [];    // 自訂搜尋類別（來自設定頁）

// ---- P3 狀態 ----
let activeTripType = 'custom';   // 目前選定的旅遊類型
let currentRadius  = 15;         // 地圖縮放（對應半徑）


// ============================================================
// 初始化
// ============================================================
async function init() {
  // 優先讀取使用者自訂語言，再 fallback 瀏覽器語言
  const storedLang = await new Promise(r =>
    chrome.storage.local.get('ss_lang', res => r(res['ss_lang'] || null))
  );
  ui = getUiStrings(storedLang || navigator.language || 'zh-TW');

  // 讀取已存半徑設定
  const storedRadius = await new Promise(r =>
    chrome.storage.local.get('ss_radius', res => r(res['ss_radius'] || null))
  );
  if (storedRadius) {
    currentRadius = parseInt(storedRadius) || 15;
    const sel = document.getElementById('select-radius');
    if (sel) sel.value = String(currentRadius);
  }

  // 讀取已存旅遊類型
  const storedTrip = await new Promise(r =>
    chrome.storage.local.get('ss_trip_type', res => r(res['ss_trip_type'] || null))
  );
  if (storedTrip) activeTripType = storedTrip;

  applyUiText();
  setupTabs();
  setupTripTypePills();
  setupRadiusSelect();
  setupSettingsBtn();
  setupTransportToggle();
  setupAttractionsToggle();

  // 自訂類別（預載，座標取得後再綁定點擊）
  await renderCustomCats();

  // 同時載入收藏清單 + 查詢目前頁面
  [favList] = await Promise.all([
    getFavorites(),
    queryActiveTab(),
  ]);

  renderFavorites();
  renderCompare();
  setupFavImportExport();
  setupFavRefreshPrices();
  setupBatchDelete();
  await renderHistory();
  setupHistoryToggle();
  setupCompareFullpage();
  setupFooter();
}

// ============================================================
// 頁籤切換
// ============================================================
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `pane-${tab}`));

  // footer hint 只在搜尋頁顯示，按鈕永遠顯示
  const hint = document.getElementById('footer-hint');
  if (hint) hint.style.visibility = tab === 'search' ? '' : 'hidden';
}

// ============================================================
// UI 文字
// ============================================================
function applyUiText() {
  setText('header-title',      ui.title);
  setText('status-text',       ui.status_detecting);
  setText('label-bundle',      ui.family_bundle);
  setText('label-daily',       ui.daily_essentials);
  setText('hint-daily',        ui.daily_hint);
  setText('label-family',      ui.family_fun);
  setText('hint-family',       ui.family_hint);
  setText('label-safety',      ui.safety_bundle   || '🛡️ 安全防身');
  setText('hint-safety',       ui.safety_hint     || '警局 + 醫院 + 藥局');
  setText('label-individual',  ui.individual);
  setText('label-not-listing', ui.status_not_listing);
  setTitle('btn-compare-fullpage', ui.tooltip_compare || '全頁比較');
  setText('label-fullpage',        ui.fullpage_compare || '全頁比較');
  setText('label-pin-badge',   ui.pin_badge);
  setText('label-map-center',  ui.map_center_hint);
  setTextAndTitle('btn-supermarket',   ui.btn_supermarket);
  setTextAndTitle('btn-pharmacy',      ui.btn_pharmacy);
  setTextAndTitle('btn-restaurant',    ui.btn_restaurant);
  setTextAndTitle('btn-park',          ui.btn_park);
  setTextAndTitle('btn-convenience',   ui.btn_convenience);
  setTextAndTitle('btn-transit',       ui.btn_transit);
  setTextAndTitle('btn-hospital',      ui.btn_hospital);
  setTextAndTitle('btn-cafe',          ui.btn_cafe);
  setTextAndTitle('btn-laundry',        ui.btn_laundry        || '🧺 自助洗衣');
  // 頁籤
  setTextAndTitle('tab-search',        ui.tab_search);
  setTextAndTitle('tab-favorites',     ui.tab_favorites);
  setTextAndTitle('tab-compare',       ui.tab_compare);
  // 收藏頁
  setText('fav-pill-all',      ui.fav_filter_all);
  setText('label-fav-empty',   ui.fav_empty);
  setText('label-fav-empty-hint', ui.fav_empty_hint);
  setText('label-export',      ui.fav_export);
  setText('label-import',      ui.fav_import);
  setText('label-refresh-prices', ui.btn_refresh_prices || '更新價格');
  setText('label-batch-delete',   ui.batch_delete       || '刪除已選');
  // 比較頁
  setText('label-compare-empty', ui.compare_empty);
  setText('label-share-copy',  ui.share_copy || '複製比較結果');
  // Footer
  setText('footer-brand-main', ui.footer_about || '關於 StayScope');
  setText('footer-brand-sub',  ui.footer_links || '使用說明 · 意見回饋');
  // 收藏按鈕
  setText('label-save',        ui.btn_save);
  setText('label-hotels',      ui.btn_hotels || '比價');
  // P3 交通區塊
  setText('label-transport',   ui.transport_label);
  setTextAndTitle('btn-metro',         ui.btn_metro);
  setTextAndTitle('btn-bus',           ui.btn_bus);
  setTextAndTitle('btn-airport',       ui.btn_airport);
  setTextAndTitle('btn-rental',        ui.btn_rental);
  setTextAndTitle('btn-bike',          ui.btn_bike);
  setTextAndTitle('btn-taxi',          ui.btn_taxi);
  // 景點區塊
  setText('label-attractions',         ui.label_attractions   || '景點搜尋');
  setTextAndTitle('btn-temple',        ui.btn_temple          || '⛩️ 廟宇');
  setTextAndTitle('btn-museum',        ui.btn_museum          || '🏗️ 博物館');
  setTextAndTitle('btn-mall',          ui.btn_mall            || '🛒 購物中心');
  setTextAndTitle('btn-botanical',     ui.btn_botanical       || '🌿 植物園');
  setTextAndTitle('btn-night-market',  ui.btn_night_market    || '🌙 夕市');
  setTextAndTitle('btn-zoo',           ui.btn_zoo             || '🦁 動物園');
  setTextAndTitle('btn-beach',         ui.btn_beach           || '🏖️ 海灘');
  setTextAndTitle('btn-art-gallery',    ui.btn_art_gallery     || '🎨 美術館');
  setTextAndTitle('btn-stationery',     ui.btn_stationery      || '✏️ 文具店');
  // P3 半徑標籤
  setText('label-radius',      ui.radius_label);
  // 自訂類別 section 標題
  setText('label-custom', `⚙️ ${ui.settings_custom_cats || '自訂類別'}`);
  // P3 trip pills (data-i18n 補文字)
  updateTripPillLabels();
  // P4 歷史區塊
  setHistoryLabels();
}

// ============================================================
// 查詢目前 Tab
// ============================================================
function queryActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) { showNotListing(); resolve(); return; }

      const tab = tabs[0];
      const url = tab.url || '';
      currentUrl = url;
      currentTabTitle = tab.title || '';

      const isAirbnb  = url.includes('airbnb')     && /\/rooms\/\d+/.test(url);
      const isBooking = url.includes('booking.com') && /\/hotel\/[a-z]{2}\//i.test(url);
      const isAgoda   = url.includes('agoda.com')   && /\/hotel\//.test(url);
      const isTrip    = url.includes('trip.com')    && /\/hotels\//.test(url);
      const isVrbo    = url.includes('vrbo.com')    && /\/p?\d{5,}(?:ha)?(?:[?&#\/]|$)/i.test(url);

      if (!isAirbnb && !isBooking && !isAgoda && !isTrip && !isVrbo) {
        showNotListing(); resolve(); return;
      }

      let extractorFiles;
      if (isBooking)     extractorFiles = ['extractors/base.js', 'extractors/booking.js'];
      else if (isAgoda)  extractorFiles = ['extractors/base.js', 'extractors/agoda.js'];
      else if (isTrip)   extractorFiles = ['extractors/base.js', 'extractors/trip.js'];
      else if (isVrbo)   extractorFiles = ['extractors/base.js', 'extractors/vrbo.js'];
      else               extractorFiles = ['extractors/base.js', 'extractors/airbnb.js'];

      chrome.tabs.sendMessage(tab.id, { action: 'getCoordinates' }, (response) => {
        if (!chrome.runtime.lastError && response?.success) {
          handleResponse(response); resolve(); return;
        }
        // ISOLATED world 無法存取頁面 JS 全域變數 → 用 MAIN world 重試
        chrome.scripting.executeScript(
          { target: { tabId: tab.id }, files: extractorFiles, world: 'MAIN' },
          () => {
            if (chrome.runtime.lastError) { showError(); resolve(); return; }
            chrome.scripting.executeScript(
              {
                target: { tabId: tab.id },
                func: () => {
                  try {
                    if (typeof window.__siteExtractFn !== 'function') return null;
                    const r = window.__siteExtractFn();
                    if (!r || r.lat == null) return null;
                    // 國家偵測 fallback（base.js 已注入 MAIN world）
                    let country = r.country || null;
                    if (!country && typeof detectCountryFromCoords === 'function') {
                      country = detectCountryFromCoords(r.lat, r.lng);
                    }
                    // 明確挑選可序列化欄位（避免 structured clone 失敗）
                    return {
                      success: true,
                      lat: r.lat,
                      lng: r.lng,
                      name: r.name || null,
                      country: country,
                      city: r.city || null,
                      strategy: r.strategy || null,
                      checkin: r.checkin || null,
                      checkout: r.checkout || null,
                      expediaPropertyId: r.expediaPropertyId || null,
                      price: r.price ? {
                        amount: r.price.amount,
                        display: r.price.display || null,
                        currency: r.price.currency || null,
                        perNight: !!r.price.perNight,
                      } : null,
                      url: location.href,
                    };
                  } catch (e) {}
                  return null;
                },
                world: 'MAIN',
              },
              (results) => {
                const data = results?.[0]?.result;
                if (data?.success) {
                  // 通知 background.js 更新 badge 為綠勾（popup 無 sender.tab，改帶 tabId）
                  chrome.runtime.sendMessage({ action: 'coordinatesUpdated', data, tabId: tab.id }).catch(() => {});
                  handleResponse(data); resolve();
                } else if (isAirbnb) {
                  // Airbnb 終極 fallback：fetch SSR HTML → 取回伺服器原始 __NEXT_DATA__
                  extractAirbnbViaFetch(tab).then(async (fetchData) => {
                    if (fetchData?.success) {
                      // 座標取得時 country 可能為 null，用已注入的 detectCountryFromCoords 補齊
                      if (!fetchData.country) {
                        try {
                          const [ccR] = await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            func: (lat, lng) => typeof detectCountryFromCoords === 'function'
                              ? detectCountryFromCoords(lat, lng) : null,
                            args: [fetchData.lat, fetchData.lng],
                            world: 'MAIN',
                          });
                          if (ccR?.result) fetchData.country = ccR.result;
                        } catch (e) {}
                      }
                      chrome.runtime.sendMessage({ action: 'coordinatesUpdated', data: fetchData, tabId: tab.id }).catch(() => {});
                      handleResponse(fetchData); resolve();
                    } else { showError(); resolve(); }
                  }).catch(() => { showError(); resolve(); });
                } else {
                  showError(); resolve();
                }
              }
            );
          }
        );
      });
    });
  });
}

// ============================================================
// Airbnb 終極 fallback：Fetch SSR HTML
// React hydration 後 __NEXT_DATA__ 會從 DOM 消失，
// 但 fetch 同一 URL 會拿到伺服器回傳的原始 HTML（含完整資料）
// ============================================================
async function extractAirbnbViaFetch(tab) {
  try {
    const url = tab.url;
    // 在頁面的 MAIN world 做 fetch（使用頁面自己的 cookies/session）
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (pageUrl) => {
        try {
          const res = await fetch(pageUrl, {
            credentials: 'include',
            headers: { 'Accept': 'text/html' },
          });
          if (!res.ok) return null;
          const html = await res.text();

          // 從 SSR HTML 中提取 __NEXT_DATA__
          const nextMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
          if (nextMatch) {
            const data = JSON.parse(nextMatch[1]);
            const str = JSON.stringify(data);
            // 座標
            const coordRe = /"lat(?:itude)?"\s*:\s*(-?\d{1,3}\.\d+)\s*,\s*"l(?:ng|on(?:gitude)?)"\s*:\s*(-?\d{1,3}\.\d+)/i;
            const m = str.match(coordRe);
            if (m) {
              const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
              if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0)) {
                const ccM = str.match(/"countryCode"\s*:\s*"([A-Z]{2})"/);
                return { success: true, lat, lng, name: null, country: ccM?.[1] || null, city: null, strategy: 'airbnb-fetch-ssr', url: pageUrl };
              }
            }
          }

          // 從 SSR HTML 的 meta 標籤提取
          const latM = html.match(/<meta[^>]+(?:property|name)="(?:place:location:latitude|og:latitude)"[^>]+content="(-?\d{1,3}\.\d+)"/i);
          const lngM = html.match(/<meta[^>]+(?:property|name)="(?:place:location:longitude|og:longitude)"[^>]+content="(-?\d{1,3}\.\d+)"/i);
          if (latM && lngM) {
            const lat = parseFloat(latM[1]), lng = parseFloat(lngM[1]);
            if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
              return { success: true, lat, lng, name: null, country: null, city: null, strategy: 'airbnb-fetch-meta', url: pageUrl };
            }
          }

          // 從 SSR HTML 中掃描 JSON-LD
          const ldMatches = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
          for (const ldM of ldMatches) {
            try {
              const ld = JSON.parse(ldM[1]);
              if (ld?.geo?.latitude != null && ld?.geo?.longitude != null) {
                const lat = parseFloat(ld.geo.latitude), lng = parseFloat(ld.geo.longitude);
                if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                  const cc = ld?.address?.addressCountry || null;
                  return { success: true, lat, lng, name: ld.name || null, country: cc, city: null, strategy: 'airbnb-fetch-jsonld', url: pageUrl };
                }
              }
            } catch (e) {}
          }

          // 從 SSR HTML 中暴力搜尋座標
          const coordRe2 = /"lat(?:itude)?"\s*:\s*(-?\d{1,3}\.\d{3,})\s*,\s*"l(?:ng|on(?:gitude)?)"\s*:\s*(-?\d{1,3}\.\d{3,})/i;
          const rawM = html.match(coordRe2);
          if (rawM) {
            const lat = parseFloat(rawM[1]), lng = parseFloat(rawM[2]);
            if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0)) {
              return { success: true, lat, lng, name: null, country: null, city: null, strategy: 'airbnb-fetch-raw', url: pageUrl };
            }
          }
        } catch (e) {}
        return null;
      },
      args: [url],
      world: 'MAIN',
    });
    return result?.result || null;
  } catch (e) {
    return null;
  }
}

// ============================================================
// 處理 content.js 回應
// ============================================================
function handleResponse(response) {
  if (!response || !response.success) { showError(); return; }
  // 正規化 country：extractor 可能回傳國名（"日本"）而非代碼（"JP"）
  if (response.country) {
    response.country = normalizeCountryCode(response.country) || null;
  }
  // 補齊 country：ISOLATED world 提取的 Trip.com 常有座標但缺 country code
  if (!response.country && response.lat && response.lng) {
    response.country = detectCountryFromCoords(response.lat, response.lng);
  }
  // Trip.com URL 子域名 fallback（e.g. jp.trip.com → JP）
  if (!response.country && response.url) {
    const m = response.url.match(/^https?:\/\/([a-z]{2})\.trip\.com/i);
    if (m) { const s = m[1].toUpperCase(); response.country = s === 'UK' ? 'GB' : s; }
  }
  currentData = response;
  coords      = { lat: response.lat, lng: response.lng };
  keywords    = getSearchKeywords(response.country);
  renderSuccess(response);
  bindSearchButtons();
  updateSaveButton();
  updateHotelsBtn();

  // 價格追蹤（非同步，不阻礙 UI 渲染）
  trackPrice(response);

  // P4: 記錄瀏覽歷史
  const src = detectSource(currentUrl);
  addHistory({
    id:      urlToId(currentUrl),
    name:    response.name || currentTabTitle || currentUrl,
    url:     currentUrl,
    lat:     response.lat,
    lng:     response.lng,
    country: response.country || null,
    city:    response.city    || null,
    source:  src,
  }).then(() => renderHistory());
}

// ============================================================
// 搜尋頁 UI 渲染
// ============================================================
function showNotListing() {
  hide('status-bar'); show('not-listing');
}

function showError() {
  setStatus('state-error', ui.status_failed); show('not-listing');
}

function renderSuccess(data) {
  setStatus('state-success', '');

  const info = getCountryInfo(data.country);
  setText('country-flag', info ? info.flag : '🌍');
  setText('country-name', info ? info.name : (data.country || ui.unknown_country));
  setText('status-text',  info ? `${info.flag} ${info.name}` : ui.unknown_country);

  const nameEl = document.getElementById('detected-name');
  if (nameEl) {
    const detectedName = data.name ||
      (currentTabTitle || '').replace(/\s*[|\-–—]\s*(Airbnb|Booking\.com|Agoda|Trip\.com|VRBO|Hotels\.com)[^|]*/i, '').trim();
    nameEl.textContent = detectedName;
    nameEl.classList.toggle('hidden', !detectedName);
  }

  // 平台來源標籤
  const src = detectSource(currentUrl);
  setText('source-badge', src ? ui[`source_${src}`] || src : '');

  setText('coord-lat', data.lat.toFixed(5));
  setText('coord-lng', data.lng.toFixed(5));

  // 提示文字維持使用者介面語言（不以房源當地關鍵字覆蓋）

  show('property-info');
  show('search-sections');
  hide('not-listing');
}

function detectSource(url) {
  if (url.includes('airbnb'))      return 'airbnb';
  if (url.includes('booking.com')) return 'booking';
  if (url.includes('agoda.com'))   return 'agoda';
  if (url.includes('trip.com'))    return 'trip';
  if (url.includes('vrbo.com'))    return 'vrbo';
  return null;
}

// ============================================================
// 自訂類別（設定頁新增的類別）
// ============================================================
async function renderCustomCats() {
  const res = await new Promise(r => chrome.storage.local.get('ss_custom_cats', r));
  const cats = res['ss_custom_cats'] || [];
  const section = document.getElementById('section-custom');
  const grid    = document.getElementById('custom-cat-grid');
  if (!section || !grid) return;

  section.classList.remove('hidden');

  if (!cats.length) {
    // 空狀態：引導用戶到設定頁新增自訂搜尋
    grid.innerHTML =
      `<button class="btn-custom-cta" id="btn-custom-cta">＋ <span id="label-custom-cta">${(ui && ui.custom_cta) || '新增自訂搜尋'}</span></button>`;
    const cta = document.getElementById('btn-custom-cta');
    if (cta) cta.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
    customCats = [];
    return;
  }

  grid.innerHTML = cats.map((cat, i) =>
    `<button class="btn-cat" data-customidx="${i}">${cat.icon || '📍'} ${cat.name}</button>`
  ).join('');

  // 儲存到全域（bindSearchButtons 將在 coords 就緒後重新綁定）
  customCats = cats;
}

function bindCustomCats(cats) {
  const grid = document.getElementById('custom-cat-grid');
  if (!grid || !coords) return;
  const { lat, lng } = coords;
  const r = () => currentRadius;
  grid.querySelectorAll('[data-customidx]').forEach(btn => {
    btn.onclick = () => {
      const cat = cats[parseInt(btn.dataset.customidx)];
      if (cat) openUrl(buildMapsUrl(lat, lng, cat.keyword, r()));
    };
  });
}

// ============================================================
// 搜尋按鈕綁定
// ============================================================
function bindSearchButtons() {
  const { lat, lng } = coords;
  const kw = keywords;
  const r  = () => currentRadius;

  on('btn-pin',     () => openUrl(`https://www.google.com/maps?q=${lat},${lng}`));
  on('btn-daily',   () => openUrl(buildBundleMapsUrl(lat, lng, [kw.supermarket, kw.pharmacy], r())));
  on('btn-family',  () => openUrl(buildBundleMapsUrl(lat, lng, [kw.park, kw.playground], r())));
  on('btn-safety',  () => openUrl(buildBundleMapsUrl(lat, lng, [kw.police || 'police station', kw.hospital, kw.pharmacy], r())));

  const catKeys = ['supermarket','pharmacy','restaurant','park','convenience','transit','hospital','cafe','laundry'];
  for (const key of catKeys) {
    on(`btn-${key}`, () => openUrl(buildMapsUrl(lat, lng, kw[key], r())));
  }

  // 景點按鈕
  const attrKeys = ['temple','museum','mall','botanical','night_market','zoo','beach','art_gallery','stationery'];
  for (const key of attrKeys) {
    on(`btn-${key.replace('_', '-')}`, () => openUrl(buildMapsUrl(lat, lng, kw[key] || key.replace('_', ' '), r())));
  }

  // 交通按鈕
  on('btn-metro',   () => openUrl(buildMapsUrl(lat, lng, kw.transit   || 'metro station',  r())));
  on('btn-bus',     () => openUrl(buildMapsUrl(lat, lng, kw.bus       || 'bus stop',        r())));
  on('btn-airport', () => openUrl(buildMapsUrl(lat, lng, kw.airport   || 'airport',         r())));
  on('btn-rental',  () => openUrl(buildMapsUrl(lat, lng, kw.rental    || 'car rental',      r())));
  on('btn-bike',    () => openUrl(buildMapsUrl(lat, lng, kw.bike      || 'bike share',      r())));
  on('btn-taxi',    () => openUrl(buildMapsUrl(lat, lng, kw.taxi      || 'taxi',            r())));

  // 收藏切換
  on('btn-save', handleSaveToggle);
  // 自訂類別座標就緒後綁定
  bindCustomCats(customCats);
  // 套餐按鈕依旅遊類型切換顯示
  applyTripTypeUI();
}

// ============================================================
// 收藏功能
// ============================================================
async function updateSaveButton() {
  if (!currentData) return;
  const id = urlToId(currentUrl);
  const saved = favList.some(f => f.id === id);
  const btn = document.getElementById('btn-save');
  if (!btn) return;
  btn.classList.toggle('is-saved', saved);
  setText('label-save', saved ? ui.btn_saved : ui.btn_save);
}

// ============================================================
// 工具：從 SEO 長標題提取乾淨的飯店名稱
// 例：「ANA皇冠假日-沖繩 (ANA Crowne Plaza Resort Okinawa By IHG)」→「ANA Crowne Plaza Resort Okinawa」
// ============================================================
function cleanHotelName(name) {
  if (!name) return '';
  // 優先取括號內的英文名，並去掉 "By XXX" 品牌後綴
  const parenM = name.match(/\(([A-Za-z][^)]{4,})\)/);
  if (parenM) {
    return parenM[1].replace(/\s+(by|[-–—])\s+.+$/i, '').trim();
  }
  // 取首段（" - " 之前），避免品牌後綴污染
  const segs = name.split(/\s*[-–—]\s+/);
  return segs[0].trim();
}

function updateHotelsBtn() {
  const src = detectSource(currentUrl);
  const btn = document.getElementById('btn-hotels');
  if (!btn) return;
  // Airbnb / VRBO 是民宿/私人短租，不適用飯店比價
  if (!src || src === 'unknown' || src === 'airbnb' || src === 'vrbo') {
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');
  setText('label-hotels', ui.btn_hotels || '比價');
  btn.title = 'Google Hotels';
  btn.onclick = () => {
    const rawName = currentData?.name || currentTabTitle || '';
    const name = cleanHotelName(rawName) || rawName;
    const q = encodeURIComponent(name);
    openUrl(`https://www.google.com/travel/hotels?q=${q}`);
  };
}

// 儲存時確保 country 有值：資料 → 座標推算 → URL 子域名（Trip.com）
function resolveCountry(data, url) {
  if (data.country) return data.country;
  if (data.lat && data.lng) {
    const c = detectCountryFromCoords(data.lat, data.lng);
    if (c) return c;
  }
  const m = (url || '').match(/^https?:\/\/([a-z]{2})\.trip\.com/i);
  if (m) { const s = m[1].toUpperCase(); return s === 'UK' ? 'GB' : s; }
  return null;
}

async function handleSaveToggle() {
  if (!currentData) return;
  const id = urlToId(currentUrl);
  const existing = favList.findIndex(f => f.id === id);

  if (existing >= 0) {
    // 取消收藏
    favList = await removeFavorite(id);
  } else {
    // 新增收藏
    const src = detectSource(currentUrl);
    const item = {
      id,
      name:      currentData.name || currentTabTitle || currentUrl,
      url:       currentUrl,
      lat:       currentData.lat,
      lng:       currentData.lng,
      country:   resolveCountry(currentData, currentUrl),
      city:      currentData.city || null,
      source:    src,
      tags:      [],
      notes:     '',
      checklist: {},
      savedAt:   Date.now(),
      ...(currentData.expediaPropertyId ? { expediaPropertyId: currentData.expediaPropertyId } : {}),
    };
    favList = await addFavorite(item);
  }

  updateSaveButton();
  renderFavorites();
  renderCompare();
}

// ── Favorites ──> popup-favorites.js

// ── Compare (popup panel) ──> popup-compare.js

// ── Trip / Radius ──> popup-trip.js

// ============================================================
// 交通區塊收折
// ============================================================
function setupTransportToggle() {
  const toggle = document.getElementById('btn-transport-toggle');
  const body   = document.getElementById('transport-body');
  const arrow  = document.getElementById('transport-arrow');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    const isOpen = !body.classList.contains('hidden');
    body.classList.toggle('hidden', isOpen);
    if (arrow) arrow.classList.toggle('open', !isOpen);
  });
}
function setupAttractionsToggle() {
  const toggle = document.getElementById('btn-attractions-toggle');
  const body   = document.getElementById('attractions-body');
  const arrow  = document.getElementById('attractions-arrow');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    const isOpen = !body.classList.contains('hidden');
    body.classList.toggle('hidden', isOpen);
    if (arrow) arrow.classList.toggle('open', !isOpen);
  });
}
function setupSettingsBtn() {
  on('btn-settings', () =>
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') })
  );
}

// ── History ──> popup-history.js

// ============================================================
// P4: 全頁比較按鈕
// ============================================================
function setupCompareFullpage() {
  on('btn-compare-fullpage', async () => {
    const ids = [];
    document.querySelectorAll('.fav-compare-cb:checked').forEach(cb => ids.push(cb.dataset.id));
    if (ids.length < 2) {
      switchTab('compare');
      return;
    }
    await setCompareSelection(ids);
    chrome.tabs.create({ url: chrome.runtime.getURL('compare.html') });
  });
}

// ============================================================
// Footer 品牌條
// ============================================================
// ============================================================
// 價格追蹤 + 歷史比對
// ============================================================
async function trackPrice(response) {
  if (!response.price || !response.price.amount) {
    // 無法提取價格：只隱藏價格列
    hide('price-row');
    return;
  }

  const propId = urlToId(currentUrl);
  const entry  = {
    amount:    response.price.amount,
    currency:  response.price.currency,
    display:   response.price.display,
    checkin:   response.checkin  || null,
    checkout:  response.checkout || null,
    recordedAt: Date.now(),
  };

  // 先取歷史記錄，再儲存（存入後歷史才含本次）
  const prevLog = await getPriceLog(propId);
  await savePriceEntry(propId, entry);

  // 找同日期區間的上一筆（排除本次）
  const prev = prevLog.find(e =>
    e.checkin  === entry.checkin &&
    e.checkout === entry.checkout &&
    e.amount   !== entry.amount
  );

  renderPriceRow(response.price, prev);
}

function renderPriceRow(price, prevEntry) {
  const row = document.getElementById('price-row');
  if (!row) return;

  let deltaHtml = '';
  if (prevEntry) {
    const delta = price.amount - prevEntry.amount;
    const pct   = Math.round(Math.abs(delta) / prevEntry.amount * 100);
    const date  = new Date(prevEntry.recordedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
    if (delta > 0) {
      deltaHtml = `<span class="price-delta up">↑${pct}% vs ${date}</span>`;
    } else if (delta < 0) {
      deltaHtml = `<span class="price-delta down">↓${pct}% vs ${date}</span>`;
    } else {
      deltaHtml = `<span class="price-delta same">= 與 ${date} 相同</span>`;
    }
  }

  const perNight = ui?.per_night || '/ 晩';
  row.innerHTML = `<span class="price-display">💰 ${price.display} ${perNight}</span>${deltaHtml}`;
  show('price-row');
}

// ============================================================
// Footer 品牌條
// ============================================================
function setupFooter() {
  // 品牌點擊 → 開啟 StayScope 品牌頁（donate.html）
  const brand = document.getElementById('footer-brand');
  if (brand) {
    brand.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('donate.html') });
    });
  }
}

// ============================================================
// DOM Helpers
// ============================================================
function setText(id, text) {
  const el = document.getElementById(id);
  if (el && text != null) el.textContent = text;
}

function setTitle(id, text) {
  const el = document.getElementById(id);
  if (el && text != null) el.title = text;
}

function setTextAndTitle(id, text) {
  const el = document.getElementById(id);
  if (el && text != null) {
    el.textContent = text;
    el.title = text.replace(/^[\p{Emoji}\s]+/u, '').trim();
  }
}

function setStatus(stateClass, message) {
  const bar = document.getElementById('status-bar');
  if (bar) bar.className = stateClass;
  setText('status-text', message);
}

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

function on(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handler);
}

function openUrl(url) { chrome.tabs.create({ url }); }

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// 啟動
// ============================================================
document.addEventListener('DOMContentLoaded', init);

// 即時回應語言切換（在 Settings 頁面修改語言後，不需重開 popup）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['ss_lang']) {
    const newLang = changes['ss_lang'].newValue;
    ui = getUiStrings(newLang || navigator.language || 'zh-TW');
    applyUiText();
  }
});

