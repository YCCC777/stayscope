// ============================================================
// StayScope — Agoda Extractor
// 依賴 extractors/base.js 中的共用函式
// ============================================================
'use strict';

// ---- 從 Agoda URL path 提取國家代碼 ----
// Agoda URL 範例：/osaka-city-jp/hotel/...  或  /zh-tw/osaka-city-jp/hotel/...
// 城市區段格式：{city-name}-{2字母國碼}，例如 osaka-city-jp、bangkok-th
function extractAgodaCountryFromUrl() {
  const path = location.pathname;

  // Pattern 1: /city-CC/hotel/ (e.g., /osaka-city-jp/hotel/)
  const m1 = path.match(/-([a-z]{2})\/hotel\//i);
  if (m1) return m1[1].toUpperCase();

  // Pattern 2: /hotel/city-CC.html 或 /hotel/city-CC/ (e.g., /hotel/osaka-jp.html)
  const m2 = path.match(/\/hotel\/[^/]*-([a-z]{2})(?:\.html|\/)/i);
  if (m2) return m2[1].toUpperCase();

  // Pattern 3: 路徑結尾 -CC.html (e.g., /taipei-tw.html)
  const m3 = path.match(/-([a-z]{2})\.html/i);
  if (m3) return m3[1].toUpperCase();

  return null;
}

// ---- 掃描 Agoda __NEXT_DATA__（Agoda 使用 Next.js） ----
function extractFromAgodaNextData() {
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

    // Strategy 1：相鄰 lat/lng（含反序）
    const adjacentPatterns = [
      [/"latitude"\s*:\s*(-?\d{1,3}\.\d{4,})\s*,\s*"longitude"\s*:\s*(-?\d{1,3}\.\d{4,})/i, false],
      [/"lat"\s*:\s*(-?\d{1,3}\.\d{4,})\s*,\s*"lng"\s*:\s*(-?\d{1,3}\.\d{4,})/i, false],
      [/"longitude"\s*:\s*(-?\d{1,3}\.\d{4,})\s*,\s*"latitude"\s*:\s*(-?\d{1,3}\.\d{4,})/i, true],
    ];
    for (const [p, reversed] of adjacentPatterns) {
      const m = str.match(p);
      if (m) {
        const a = parseFloat(m[1]), b = parseFloat(m[2]);
        const [tryLat, tryLng] = reversed ? [b, a] : [a, b];
        if (isValidCoord(tryLat, tryLng)) { lat = tryLat; lng = tryLng; break; }
      }
    }

    // Strategy 2：各自獨立搜尋（處理非相鄰欄位）
    if (lat === null) {
      const latPats = [/"latitude"\s*:\s*(-?\d{1,3}\.\d{4,})/i, /"lat"\s*:\s*(-?\d{1,3}\.\d{4,})/i];
      const lngPats = [/"longitude"\s*:\s*(-?\d{1,3}\.\d{4,})/i, /"l(?:ng|on)"\s*:\s*(-?\d{1,3}\.\d{4,})/i];
      outer: for (const lp of latPats) {
        const lm = str.match(lp);
        if (!lm) continue;
        for (const gp of lngPats) {
          const gm = str.match(gp);
          if (!gm) continue;
          const a = parseFloat(lm[1]), b = parseFloat(gm[1]);
          if (isValidCoord(a, b)) { lat = a; lng = b; break outer; }
        }
      }
    }

    if (lat === null) return null;

    // Agoda __NEXT_DATA__ 常見國家欄位
    let country = null;
    const countryPatterns = [
      /"countryCode"\s*:\s*"([A-Z]{2})"/,
      /"country_code"\s*:\s*"([A-Z]{2})"/,
      /"addressCountry"\s*:\s*"([A-Z]{2})"/,
    ];
    for (const p of countryPatterns) {
      const m = str.match(p);
      if (m) { country = m[1]; break; }
    }

    return { lat, lng, name: null, country, city: null, strategy: 'agoda-next-data' };
  } catch (e) {}
  return null;
}

// ---- Agoda 價格提取 ----
function extractAgodaPrice() {
  try {
    // 優先 window（MAIN world）；否則從 DOM 讀取（ISOLATED world）
    let raw = window.__NEXT_DATA__;
    if (!raw) {
      const el = document.getElementById('__NEXT_DATA__');
      if (el) try { raw = JSON.parse(el.textContent); } catch (e) {}
    }
    const str = JSON.stringify(raw || {});
    const pm = str.match(/"displayPrice"\s*:\s*\{[^}]{0,300}"perNight"\s*:\s*"([^"]+)"/i)
             || str.match(/"perNightPrice"\s*:\s*\{[^}]{0,200}"display"\s*:\s*"([^"]+)"/i)
             || str.match(/"price"\s*:\s*\{[^}]{0,200}"perRoomPerNight"\s*:\s*"([^"]+)"/i);
    if (pm) {
      const display = pm[1];
      const amount = parseFloat(display.replace(/[^\d.]/g, ''));
      if (amount > 0 && amount < 1e7) {
        return { amount, display, currency: detectCurrency(display), perNight: true };
      }
    }

    // 策略 2： DOM
    const el = document.querySelector('[data-selenium="PriceDisplay"]')
             || document.querySelector('.Typographystyled__TypographyStyled-sc-j18mtu-0')
             || document.querySelector('[class*="price-per-night"]');
    if (el) {
      const display = el.textContent.trim();
      const amount = parseFloat(display.replace(/[^\d.]/g, ''));
      if (amount > 0 && amount < 1e7) {
        return { amount, display, currency: detectCurrency(display), perNight: true };
      }
    }
  } catch (e) {}
  return null;
}

// ---- 主提取函式 ----
function extractAgoda() {
  const result = extractFromAgodaNextData()
    || extractFromJsonLd()
    || extractFromMetaTags()
    || extractFromInlineScripts();

  if (!result) return null;

  // 若 __NEXT_DATA__ 沒有國家代碼，用 URL 推算
  if (!result.country) {
    result.country = extractAgodaCountryFromUrl();
  }

  // 擴展：日期 + 價格
  const { checkin, checkout } = extractDatesFromUrl();
  result.checkin  = checkin;
  result.checkout = checkout;
  result.price    = extractAgodaPrice();
  return result;
}

window.__siteExtractFn = extractAgoda;
