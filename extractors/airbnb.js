// ============================================================
// StayScope — Airbnb Extractor
// 依賴 extractors/base.js 中的共用函式
// ============================================================
'use strict';

// ---- Airbnb 專屬：掃描 window.__NEXT_DATA__ ----
function extractAirbnbNextData() {
  try {
    // 優先 window（MAIN world）；否則從 DOM 讀取（ISOLATED world）
    let nextData = window.__NEXT_DATA__;
    if (!nextData) {
      const el = document.getElementById('__NEXT_DATA__');
      if (el) try { nextData = JSON.parse(el.textContent); } catch (e) {}
    }
    if (!nextData) return null;

    const str = JSON.stringify(nextData);

    let lat = null, lng = null;
    const coordRe = /"lat(?:itude)?"\s*:\s*(-?\d{1,3}\.\d{4,})\s*,\s*"l(?:ng|on(?:gitude)?)"\s*:\s*(-?\d{1,3}\.\d{4,})/i;

    // 策略1：優先在已知 listing 上下文標記附近搜尋座標
    // Airbnb __NEXT_DATA__ 中 pdpListing/listingId 附近的座標才是該房源本身的
    // 2025+ 新版 Airbnb 使用 stayProductDetailPage / pdpDataV3 / pdpSections
    const contextKeys = [
      '"pdpListing"', '"listingPDP"', '"pdpContext"', '"pdpDataV3"',
      '"stayProductDetailPage"', '"stayPdpSections"',
      '"coordinate":{', '"geoPoint":{',
      // 注意：'"listingId":' 太泛用，會匹配 nearby_listings 導致座標錯誤，已移除
    ];
    for (const key of contextKeys) {
      const idx = str.indexOf(key);
      if (idx === -1) continue;
      const start = Math.max(0, idx - 100);
      const slice = str.substring(start, Math.min(str.length, idx + 6000));
      const m = slice.match(coordRe);
      if (m) {
        const tLat = parseFloat(m[1]);
        const tLng = parseFloat(m[2]);
        if (isValidCoord(tLat, tLng)) { lat = tLat; lng = tLng; break; }
      }
    }

    // 策略2：回退至全字串第一個出現的座標
    if (lat === null) {
      const coordPatterns = [
        /"lat(?:itude)?"\s*:\s*(-?\d{1,3}\.\d{4,})\s*,\s*"l(?:ng|on(?:gitude)?)"\s*:\s*(-?\d{1,3}\.\d{4,})/i,
        /"latitude"\s*:\s*(-?\d{1,3}\.\d{4,})\s*,\s*"longitude"\s*:\s*(-?\d{1,3}\.\d{4,})/i,
      ];
      for (const p of coordPatterns) {
        const m = str.match(p);
        if (m) { lat = parseFloat(m[1]); lng = parseFloat(m[2]); break; }
      }
    }

    if (lat === null || !isValidCoord(lat, lng)) return null;

    // Airbnb __NEXT_DATA__ 常見國家代碼欄位
    let country = null;
    const countryPatterns = [
      /"countryCode"\s*:\s*"([A-Z]{2})"/,
      /"country_code"\s*:\s*"([A-Z]{2})"/,
      /"addressCountry"\s*:\s*"([A-Z]{2})"/,
      /"localizedCountryName"\s*:\s*"[^"]+".*?"countryCode"\s*:\s*"([A-Z]{2})"/s,
    ];
    for (const p of countryPatterns) {
      const m = str.match(p);
      if (m) { country = m[1]; break; }
    }

    return { lat, lng, name: null, country, city: null, strategy: 'airbnb-next-data' };
  } catch (e) {}
  return null;
}

// ---- Airbnb 價格提取 ----
// 從 __NEXT_DATA__ 中搜尋每晩 structuredDisplayPrice 或 perNight context
function extractAirbnbPrice() {
  try {
    // 優先 window（MAIN world）；否則從 DOM 讀取（ISOLATED world）
    let raw = window.__NEXT_DATA__;
    if (!raw) {
      const el = document.getElementById('__NEXT_DATA__');
      if (el) try { raw = JSON.parse(el.textContent); } catch (e) {}
    }
    const str = raw ? JSON.stringify(raw) : '';

    if (str) {
      // 策略 1：structuredDisplayPrice 區塊內找帶貨幣符號的 "price" 欄位
      // 舊 regex 用 [^}] 會在巢狀物件提前中斷，改為直接搜尋 3000 字符範圍
      const sdpIdx = str.indexOf('"structuredDisplayPrice"');
      if (sdpIdx >= 0) {
        const slice = str.substring(sdpIdx, Math.min(str.length, sdpIdx + 3000));
        // 必須包含貨幣符號，避免誤抓 ID / 數字欄位
        const pm = slice.match(/"price"\s*:\s*"((?:NT\$|HK\$|S\$|A\$|MOP\$|Rp\s*|RM\s*|[¥$€£₩฿₫])\s*[\d,]+(?:\.\d+)?)"/);
        if (pm) {
          const display = pm[1].trim();
          const amount = parseFloat(display.replace(/[^\d.]/g, ''));
          if (amount > 0 && amount < 1e7) {
            return { display, amount, currency: detectCurrency(display), perNight: true };
          }
        }
      }

      // 策略 2：qualifier:"night" 前後 800 字符內找 displayString / price
      const nightIdx = str.search(/"qualifier"\s*:\s*"(?:night|per_night|per night)"/i);
      if (nightIdx >= 0) {
        const slice = str.substring(Math.max(0, nightIdx - 800), nightIdx + 800);
        const dm = slice.match(/"(?:displayString|formattedAmount|price_text|price)"\s*:\s*"((?:NT\$|HK\$|S\$|A\$|MOP\$|Rp\s*|RM\s*|[¥$€£₩฿₫])\s*[\d,]+(?:\.\d+)?)"/i);
        if (dm) {
          const display = dm[1].trim();
          const amount = parseFloat(display.replace(/[^\d.]/g, ''));
          if (amount > 0 && amount < 1e7) {
            return { display, amount, currency: detectCurrency(display), perNight: true };
          }
        }
      }

      // 策略 3：任何帶貨幣的 "displayPrice" / "price" 欄位（最寬鬆，最後才用）
      const broadRe = /"(?:displayPrice|priceString|priceText)"\s*:\s*"((?:NT\$|HK\$|S\$|A\$|MOP\$|Rp\s*|RM\s*|[¥$€£₩฿₫])\s*[\d,]+(?:\.\d+)?)"/;
      const bm = str.match(broadRe);
      if (bm) {
        const display = bm[1].trim();
        const amount = parseFloat(display.replace(/[^\d.]/g, ''));
        if (amount > 0 && amount < 1e7) {
          return { display, amount, currency: detectCurrency(display), perNight: true };
        }
      }
    }

    // 策略 4：DOM 預訂側欄文字（ISOLATED world 可用）
    const bookSection = document.querySelector(
      '[data-section-id="BOOK_IT_SIDEBAR"], [data-section-id="BOOK_IT_CALENDAR_SHEET_TRIGGER"], [data-testid="book-it-default"]'
    );
    if (bookSection) {
      const text = bookSection.textContent;
      const m = text.match(/((?:NT|HK|S|A|MOP)\$|[¥$€£₩฿₫]|Rp|RM)\s*([\d,]+(?:\.\d{1,2})?)/);
      if (m) {
        const amount = parseFloat(m[2].replace(/,/g, ''));
        if (amount > 0 && amount < 1e7) {
          const display = `${m[1]}${m[2]}`;
          return { display, amount, currency: detectCurrency(display), perNight: true };
        }
      }
    }

    // 策略 5：aria-label 中帶 "night" 的元素（幾乎所有語系皆有）
    const nightWords = ['night', '晩', '泊', '박', 'malam', 'noche', 'nuit', 'Nacht', 'คืน', 'đêm'];
    const ariaEls = document.querySelectorAll('[aria-label]');
    for (const el of ariaEls) {
      const label = el.getAttribute('aria-label') || '';
      if (!nightWords.some(w => label.includes(w))) continue;
      const m = label.match(/((?:NT|HK|S|A|MOP)\$|[¥$€£₩฿₫]|Rp|RM)\s*([\d,]+(?:\.\d{1,2})?)/);
      if (m) {
        const amount = parseFloat(m[2].replace(/,/g, ''));
        if (amount > 0 && amount < 1e7) {
          const display = `${m[1]}${m[2]}`;
          return { display, amount, currency: detectCurrency(display), perNight: true };
        }
      }
    }
  } catch (e) {}
  return null;
}

// ---- 主提取函式，依序嘗試各策略 ----
function extractAirbnb() {
  const result = extractFromJsonLd()
    || extractAirbnbNextData()
    || extractFromInlineScripts()
    || extractAirbnbBootstrap()
    || extractAirbnbFromJsonScript()   // React RSC / <script type="application/json">
    || extractAirbnbFromMapImage()     // 靜態地圖 URL 中的座標
    || extractAirbnbFromMapboxCanvas() // Mapbox GL data-lat/data-lng
    || extractAirbnbBroadScan();       // 最終 fallback：掃描所有 window.* 屬性
  if (!result) return null;

  // 擴展：日期 + 價格
  const { checkin, checkout } = extractDatesFromUrl();
  result.checkin  = checkin;
  result.checkout = checkout;
  result.price    = extractAirbnbPrice();
  return result;
}

// ---- 從靜態地圖圖片 URL 提取座標（ISOLATED world 可用！） ----
// Airbnb 列表頁有 map preview，Google Static Maps / Mapbox 的 URL 包含座標
function extractAirbnbFromMapImage() {
  try {
    // 掃描所有圖片（含 lazy-loaded）
    const imgs = document.querySelectorAll('img[src], img[data-src], img[srcset]');
    for (const img of imgs) {
      const urls = [img.src, img.dataset?.src, img.srcset].filter(Boolean);
      for (const url of urls) {
        // Google Static Maps: center=LAT,LNG 或 markers=LAT,LNG
        let m = url.match(/(?:center|markers)[=|](-?\d{1,3}\.\d{3,})[,%20]+(-?\d{1,3}\.\d{3,})/);
        if (m) {
          const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
          if (isValidCoord(lat, lng)) return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-map-img' };
        }
        // Mapbox: /LNG,LAT,ZOOM/
        m = url.match(/\/(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,}),\d/);
        if (m) {
          const lng = parseFloat(m[1]), lat = parseFloat(m[2]);
          if (isValidCoord(lat, lng)) return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-map-img' };
        }
      }
    }
    // 也掃描 <link> preload（Airbnb 有時 preload 地圖 tile）
    const links = document.querySelectorAll('link[href*="maps"], link[href*="mapbox"]');
    for (const link of links) {
      const url = link.href;
      let m = url.match(/(?:center|markers)[=|](-?\d{1,3}\.\d{3,})[,%20]+(-?\d{1,3}\.\d{3,})/);
      if (m) {
        const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
        if (isValidCoord(lat, lng)) return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-map-link' };
      }
    }
    // 掃描 inline style 中的 background-image
    const mapDivs = document.querySelectorAll('[style*="maps.googleapis"], [style*="mapbox"], [style*="staticmap"]');
    for (const div of mapDivs) {
      const style = div.getAttribute('style') || '';
      let m = style.match(/(?:center|markers)[=|](-?\d{1,3}\.\d{3,})[,%20]+(-?\d{1,3}\.\d{3,})/);
      if (m) {
        const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
        if (isValidCoord(lat, lng)) return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-map-bg' };
      }
    }
  } catch (e) {}
  return null;
}

// ---- 從 Mapbox GL / Google Maps DOM 容器提取座標（ISOLATED world 可用！） ----
function extractAirbnbFromMapboxCanvas() {
  try {
    // Mapbox GL 容器 + Google Maps
    const mapContainers = document.querySelectorAll(
      '.mapboxgl-map, [class*="map_canvas"], [data-testid*="map"], [aria-label*="Map"], [aria-label*="地圖"], [role="application"][aria-roledescription="map"]'
    );
    for (const el of mapContainers) {
      if (el.dataset?.lat && el.dataset?.lng) {
        const lat = parseFloat(el.dataset.lat), lng = parseFloat(el.dataset.lng);
        if (isValidCoord(lat, lng)) return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-map-data' };
      }
      const elStr = el.outerHTML.slice(0, 5000);
      const m = elStr.match(/(?:lat|latitude)[=:"]\s*(-?\d{1,3}\.\d{3,})[\s,;"]+(?:lng|longitude|lon)[=:"]\s*(-?\d{1,3}\.\d{3,})/i);
      if (m) {
        const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
        if (isValidCoord(lat, lng)) return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-map-dom' };
      }
    }
    // Google Maps iframe
    const iframes = document.querySelectorAll('iframe[src*="map"], iframe[src*="google.com/maps"]');
    for (const iframe of iframes) {
      const src = iframe.src || '';
      const m = src.match(/(?:center|q|ll|@)=?(-?\d{1,3}\.\d{3,})[,%20]+(-?\d{1,3}\.\d{3,})/);
      if (m) {
        const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
        if (isValidCoord(lat, lng)) return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-map-iframe' };
      }
    }
  } catch (e) {}
  return null;
}

// ---- 備援：扫描其他 Airbnb 全域變數 ----
function extractAirbnbBootstrap() {
  const candidates = [
    window.__BOOTSTRAP_DATA__,
    window.__EXPLORER_STATE__,
    window.__AIRBNB_DATA__,
    window.__A11Y_DATA__,
  ];
  const coordRe = /"lat(?:itude)?"\s*:\s*(-?\d{1,3}\.\d{4,})\s*,\s*"l(?:ng|on(?:gitude)?)"\s*:\s*(-?\d{1,3}\.\d{4,})/i;
  for (const obj of candidates) {
    if (!obj) continue;
    try {
      const str = JSON.stringify(obj);
      const m = str.match(coordRe);
      if (!m) continue;
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (isValidCoord(lat, lng)) {
        return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-bootstrap' };
      }
    } catch (e) {}
  }
  return null;
}

// ---- 掃描 <script type="application/json">（React 18 RSC / Apollo 等格式） ----
function extractAirbnbFromJsonScript() {
  const scripts = document.querySelectorAll('script[type="application/json"]');
  const coordRe = /"lat(?:itude)?"\s*:\s*(-?\d{1,3}\.\d+)\s*,\s*"l(?:ng|on(?:gitude)?)"\s*:\s*(-?\d{1,3}\.\d+)/i;
  const revRe   = /"l(?:ng|on(?:gitude)?)"\s*:\s*(-?\d{1,3}\.\d+)\s*,\s*"lat(?:itude)?"\s*:\s*(-?\d{1,3}\.\d+)/i;
  const ccRe    = /"countryCode"\s*:\s*"([A-Z]{2})"/;
  for (const s of scripts) {
    const text = s.textContent;
    if (text.length > 5_000_000) continue;
    let m = text.match(coordRe);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (isValidCoord(lat, lng)) {
        const cc = text.match(ccRe);
        return { lat, lng, name: null, country: cc?.[1] || null, city: null, strategy: 'airbnb-json-script' };
      }
    }
    m = text.match(revRe);
    if (m) {
      const lng = parseFloat(m[1]), lat = parseFloat(m[2]);
      if (isValidCoord(lat, lng)) {
        const cc = text.match(ccRe);
        return { lat, lng, name: null, country: cc?.[1] || null, city: null, strategy: 'airbnb-json-script' };
      }
    }
  }
  return null;
}

// ---- MAIN world：暴力掃描所有 window.* 屬性（Airbnb 架構常改，最終 fallback） ----
// 不論 Airbnb 用何種框架，只要座標在任一全域物件中，此函式就能找到
function extractAirbnbBroadScan() {
  const skip = new Set([
    'localStorage', 'sessionStorage', 'performance', 'history',
    'caches', 'cookieStore', 'indexedDB', 'crypto', 'screen',
    'visualViewport', 'location', 'document', 'navigator',
  ]);
  const coordRe = /"lat(?:itude)?"\s*:\s*(-?\d{1,3}\.\d+)\s*,\s*"l(?:ng|on(?:gitude)?)"\s*:\s*(-?\d{1,3}\.\d+)/i;
  const ccRe    = /"countryCode"\s*:\s*"([A-Z]{2})"/;
  try {
    for (const key of Object.keys(window)) {
      if (skip.has(key) || typeof window[key] !== 'object' || !window[key]) continue;
      try {
        const str = JSON.stringify(window[key]);
        if (!str || str.length > 10_000_000) continue;
        const m = str.match(coordRe);
        if (!m) continue;
        const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
        if (!isValidCoord(lat, lng)) continue;
        const cc = str.match(ccRe);
        return { lat, lng, name: null, country: cc?.[1] || null, city: null, strategy: `airbnb-win-${key}` };
      } catch (e) {}
    }
  } catch (e) {}

  // ---- MAIN world：讀取 Mapbox GL JS 地圖實例的 center 座標 ----
  try {
    const mapEl = document.querySelector('.mapboxgl-map');
    if (mapEl?.__mbglMap || mapEl?._map) {
      const map = mapEl.__mbglMap || mapEl._map;
      const center = typeof map.getCenter === 'function' ? map.getCenter() : null;
      if (center) {
        const lat = center.lat ?? center[1];
        const lng = center.lng ?? center[0];
        if (lat && lng && isValidCoord(lat, lng)) {
          return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-mapbox-instance' };
        }
      }
    }
  } catch (e) {}

  // ---- MAIN world：Google Maps API 實例掃描（擴大搜索範圍） ----
  try {
    if (window.google?.maps) {
      // 方式 A：從任何 div 找 __gm 屬性（不只找 gm-style class）
      const allDivs = document.querySelectorAll('div');
      for (const el of allDivs) {
        try {
          if (!el.__gm?.map) continue;
          const map = el.__gm.map;
          const center = typeof map.getCenter === 'function' ? map.getCenter() : null;
          if (!center) continue;
          const lat = typeof center.lat === 'function' ? center.lat() : center.lat;
          const lng = typeof center.lng === 'function' ? center.lng() : center.lng;
          if (isValidCoord(lat, lng)) {
            return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-google-maps' };
          }
        } catch (e) {}
      }

      // 方式 B：掃描 google.maps.Map 的所有已知實例
      // Google Maps JS API 有時把實例存在 window._gmaps_cdp_ 或其他地方
      for (const key of Object.getOwnPropertyNames(window)) {
        try {
          const val = window[key];
          if (!val || typeof val !== 'object') continue;
          if (typeof val.getCenter === 'function' && typeof val.getZoom === 'function') {
            const center = val.getCenter();
            const lat = typeof center.lat === 'function' ? center.lat() : center.lat;
            const lng = typeof center.lng === 'function' ? center.lng() : center.lng;
            if (isValidCoord(lat, lng)) {
              return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-google-maps-win' };
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}

  // ---- MAIN world：從 Google Maps API 載入的 script src 中提取座標 ----
  try {
    const gmScripts = document.querySelectorAll('script[src*="maps.googleapis.com"], script[src*="maps.google.com"]');
    for (const s of gmScripts) {
      const src = s.src || '';
      const m = src.match(/(?:center|ll|q)=(-?\d{1,3}\.\d{3,})[,%20]+(-?\d{1,3}\.\d{3,})/);
      if (m) {
        const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
        if (isValidCoord(lat, lng)) return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-gmaps-script' };
      }
    }
  } catch (e) {}

  // ---- MAIN world：React Fiber Tree 內部狀態掃描 ----
  try {
    const appRoot = document.getElementById('__next') || document.getElementById('app') || document.getElementById('root');
    if (appRoot) {
      const fiberKey = Object.keys(appRoot).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (fiberKey) {
        const coordPat = /"lat(?:itude)?"\s*:\s*(-?\d{1,3}\.\d+)\s*,\s*"l(?:ng|on(?:gitude)?)"\s*:\s*(-?\d{1,3}\.\d+)/i;
        const fiberRoot = appRoot[fiberKey];
        // BFS 遍歷 fiber tree（比 DFS 更快觸及地圖元件）
        const queue = [fiberRoot];
        const visited = new Set();
        let attempts = 0;
        while (queue.length > 0 && attempts < 500) {
          const fiber = queue.shift();
          if (!fiber || visited.has(fiber)) continue;
          visited.add(fiber);
          attempts++;
          try {
            // 嘗試多種 state 位置
            const targets = [fiber.memoizedProps, fiber.memoizedState, fiber.pendingProps, fiber.stateNode?.state];
            for (const state of targets) {
              if (!state || typeof state !== 'object') continue;
              let s;
              try { s = JSON.stringify(state); } catch (e) { continue; }
              if (s.length > 200000) continue;
              const m = s.match(coordPat);
              if (m) {
                const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
                if (isValidCoord(lat, lng)) {
                  return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-react-fiber' };
                }
              }
            }
          } catch (e) {}
          // 加入子節點
          if (fiber.child) queue.push(fiber.child);
          if (fiber.sibling) queue.push(fiber.sibling);
        }
      }
    }
  } catch (e) {}

  // ---- MAIN world：掃描所有 DOM 元素的 React props（__reactProps$）----
  try {
    const coordPat2 = /"lat(?:itude)?"\s*:\s*(-?\d{1,3}\.\d+)\s*,\s*"l(?:ng|on(?:gitude)?)"\s*:\s*(-?\d{1,3}\.\d+)/i;
    // 找到地圖區域附近的元素
    const mapSection = document.querySelector('[data-section-id*="MAP"], [data-section-id*="map"], [id*="map"], section[aria-label*="Map"], section[aria-label*="地圖"]');
    const searchRoot = mapSection || document.body;
    const elements = searchRoot.querySelectorAll('div, section');
    const propsPrefix = '__reactProps$';
    for (const el of elements) {
      const pk = Object.keys(el).find(k => k.startsWith(propsPrefix));
      if (!pk) continue;
      try {
        const props = el[pk];
        if (!props || typeof props !== 'object') continue;
        const s = JSON.stringify(props);
        if (s.length > 100000) continue;
        const m = s.match(coordPat2);
        if (m) {
          const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
          if (isValidCoord(lat, lng)) {
            return { lat, lng, name: null, country: null, city: null, strategy: 'airbnb-react-props' };
          }
        }
      } catch (e) {}
    }
  } catch (e) {}

  return null;
}
