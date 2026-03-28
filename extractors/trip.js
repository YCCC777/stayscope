// ============================================================
// StayScope — Trip.com Extractor
// 依賴 extractors/base.js 中的共用函式
// ============================================================
'use strict';

// ---- 遞迴遍歷物件，尋找座標（支援 Trip.com 的 lnt 欄位）----
// 避免 regex 因欄位不相鄰或小數位數不足而失敗
function extractCoordsDeep(obj, depth, seen) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  if (!seen) seen = new WeakSet();
  if (seen.has(obj)) return null;
  seen.add(obj);
  if (Array.isArray(obj)) {
    const limit = Math.min(obj.length, 20);
    for (let i = 0; i < limit; i++) {
      if (!obj[i] || typeof obj[i] !== 'object') continue;
      const r = extractCoordsDeep(obj[i], depth + 1, seen);
      if (r) return r;
    }
    return null;
  }
  // 直接欄位（Trip.com 使用 "lnt" 作為經度）
  const latVal = obj.lat ?? obj.latitude;
  const lngVal = obj.lnt ?? obj.lng ?? obj.longitude;
  if (latVal != null && lngVal != null) {
    const lat = parseFloat(latVal), lng = parseFloat(lngVal);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }
  for (const val of Object.values(obj)) {
    if (!val || typeof val !== 'object') continue;
    const r = extractCoordsDeep(val, depth + 1, seen);
    if (r) return r;
  }
  return null;
}

// ---- 掃描 Trip.com 專屬全域變數 ----
// Trip.com (Ctrip) 使用多種全域物件儲存飯店資料
// 注意：Trip.com 部分 API 回應使用 "lnt" 作為經度欄位名稱
function extractFromTripGlobals() {
  try {
    const countryRe = /"countryCode"\s*:\s*"([A-Z]{2})"/;

    // MAIN world：直接讀取全域變數，使用深度遍歷而非 regex（更可靠）
    const candidates = [
      window.__TRIP_INITIAL_DATA__,
      window.IBU_HOTEL,
      window.__trip_global_data__,
      window.__NEXT_DATA__,
      window.appState,
      window.htlConfig,
      window.seoData,
    ].filter(Boolean);

    for (const obj of candidates) {
      try {
        const coords = extractCoordsDeep(obj, 0);
        if (!coords) continue;
        let str = '';
        try { str = JSON.stringify(obj); } catch (e) {}
        const cm = str.match(countryRe);
        return { lat: coords.lat, lng: coords.lng, name: null, country: cm?.[1] || null, city: null, strategy: 'trip-globals' };
      } catch (e) { continue; }
    }

    // ISOLATED world fallback：從 #__NEXT_DATA__ DOM 元素讀取
    const nextEl = document.getElementById('__NEXT_DATA__');
    if (nextEl) {
      try {
        const parsed = JSON.parse(nextEl.textContent);
        const coords = extractCoordsDeep(parsed, 0);
        if (coords) {
          const cm = nextEl.textContent.match(countryRe);
          return { lat: coords.lat, lng: coords.lng, name: null, country: cm?.[1] || null, city: null, strategy: 'trip-next-data-dom' };
        }
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

// ---- Trip.com inline script 深度掃描（含 lnt 欄位） ----
function extractFromTripInline() {
  const scripts = document.querySelectorAll('script:not([src])');
  // 同時匹配 lat/lng 和 lat/lnt（Trip.com 特有），放寬小數位數（\d+ 而非 \d{4,}）
  const patterns = [
    /\"lat(?:itude)?\"\s*:\s*(-?\d{1,3}\.\d+)\s*,\s*\"l(?:ng|nt|on(?:gitude)?)\"\s*:\s*(-?\d{1,3}\.\d+)/i,
    /\"l(?:ng|nt|on(?:gitude)?)\"\s*:\s*(-?\d{1,3}\.\d+)\s*,\s*\"lat(?:itude)?\"\s*:\s*(-?\d{1,3}\.\d+)/i,
  ];
  for (const script of scripts) {
    const text = script.textContent;
    if (text.length > 3_000_000) continue;
    for (const [idx, pat] of patterns.entries()) {
      const m = text.match(pat);
      if (!m) continue;
      const lat = parseFloat(idx === 0 ? m[1] : m[2]);
      const lng = parseFloat(idx === 0 ? m[2] : m[1]);
      if (isValidCoord(lat, lng)) {
        return { lat, lng, name: null, country: null, city: null, strategy: 'trip-inline' };
      }
    }
  }
  return null;
}

// ---- Trip.com 價格提取 ----
function extractTripPrice() {
  try {
    // 策略 1： JSON-LD offers.price
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const d = JSON.parse(s.textContent);
        const offers = d?.offers || d?.containsPlace?.offers;
        if (offers?.price && offers.priceCurrency) {
          const amount = parseFloat(offers.price);
          if (amount > 0) {
            const display = `${offers.priceCurrency} ${amount}`;
            return { amount, display, currency: offers.priceCurrency, perNight: true };
          }
        }
      } catch (e) {}
    }

    // 策略 2：window 全域變數（MAIN world）— 含 __NEXT_DATA__
    const candidates = [
      window.__TRIP_INITIAL_DATA__,
      window.IBU_HOTEL,
      window.__NEXT_DATA__,
    ].filter(Boolean);
    const priceRe = /"price(?:Amount|Value|PerNight)?"\s*:\s*([\d.]+)/i;
    const curRe   = /"currency(?:Code)?"\s*:\s*"([A-Z]{3})"/i;
    for (const obj of candidates) {
      try {
        const str = JSON.stringify(obj);
        if (!str) continue;
        const pm = str.match(priceRe);
        const cm = str.match(curRe);
        if (pm) {
          const amount = parseFloat(pm[1]);
          if (amount > 0 && amount < 1e7) {
            const currency = cm ? cm[1] : null;
            return { amount, display: currency ? `${currency} ${amount}` : String(amount), currency, perNight: true };
          }
        }
      } catch (e) {}
    }

    // 策略 3：深度遍歷物件尋找 price + currency（與 extractCoordsDeep 同策略）
    for (const obj of candidates) {
      try {
        const p = findPriceDeep(obj, 0, new WeakSet());
        if (p) return p;
      } catch (e) {}
    }

    // 策略 4：#__NEXT_DATA__ DOM 元素（ISOLATED world）
    const nextEl = document.getElementById('__NEXT_DATA__');
    if (nextEl) {
      const text = nextEl.textContent;
      const pm = text.match(priceRe);
      const cm = text.match(curRe);
      if (pm) {
        const amount = parseFloat(pm[1]);
        if (amount > 0 && amount < 1e7) {
          const currency = cm ? cm[1] : null;
          return { amount, display: currency ? `${currency} ${amount}` : String(amount), currency, perNight: true };
        }
      }
    }

    // 策略 5：inline script 文字掃描（ISOLATED world）
    const inlineScripts = document.querySelectorAll('script:not([src])');
    for (const s of inlineScripts) {
      const text = s.textContent;
      if (text.length > 3_000_000 || !text.includes('price')) continue;
      const pm = text.match(priceRe);
      const cm = text.match(curRe);
      if (pm) {
        const amount = parseFloat(pm[1]);
        if (amount > 0 && amount < 1e7) {
          const currency = cm ? cm[1] : null;
          return { amount, display: currency ? `${currency} ${amount}` : String(amount), currency, perNight: true };
        }
      }
    }

    // 策略 6：DOM 價格文字（最終 fallback）
    // 注意：某些元素的 textContent 會包含原價+折扣價（如 "TWD2,352TWD2,218"），
    // 只取最小的（折扣價）或第一段乾淨的金額
    const priceEls = document.querySelectorAll(
      '[data-testid*="price"], [class*="price" i], [class*="Price"], [class*="amount" i], .totalPrice'
    );
    for (const el of priceEls) {
      const text = el.textContent.trim();
      // 用 matchAll 找出所有 currency+amount 組合，取最後一個（通常是折扣價）
      const allMatches = [...text.matchAll(/([\$€£¥₩฿₫]|[A-Z]{3})\s*([\d,]+(?:\.\d{1,2})?)/g)];
      if (allMatches.length > 0) {
        const best = allMatches[allMatches.length - 1]; // 最後一個 = 折扣價
        const amount = parseFloat(best[2].replace(/,/g, ''));
        if (amount > 0 && amount < 1e7) {
          const currency = best[1];
          return { amount, display: `${currency} ${amount}`, currency, perNight: true };
        }
      }
    }
  } catch (e) {}
  return null;
}

// 深度遍歷尋找價格欄位
function findPriceDeep(obj, depth, seen) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  if (seen.has(obj)) return null;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 15); i++) {
      if (!obj[i] || typeof obj[i] !== 'object') continue;
      const r = findPriceDeep(obj[i], depth + 1, seen);
      if (r) return r;
    }
    return null;
  }
  // 常見欄位名：price, priceAmount, avgPrice, roomPrice
  const priceKeys = ['price', 'priceAmount', 'avgPrice', 'roomPrice', 'pricePerNight', 'totalPrice', 'displayPrice'];
  const curKeys = ['currency', 'currencyCode', 'currencySign'];
  for (const pk of priceKeys) {
    const pv = obj[pk];
    if (pv != null && !isNaN(parseFloat(pv))) {
      const amount = parseFloat(pv);
      if (amount > 0 && amount < 1e7) {
        let currency = null;
        for (const ck of curKeys) { if (obj[ck]) { currency = String(obj[ck]); break; } }
        return { amount, display: currency ? `${currency} ${amount}` : String(amount), currency, perNight: true };
      }
    }
  }
  for (const val of Object.values(obj)) {
    if (!val || typeof val !== 'object') continue;
    const r = findPriceDeep(val, depth + 1, seen);
    if (r) return r;
  }
  return null;
}

// ---- 主提取函式 ----
function extractTrip() {
  const result = extractFromJsonLd()
    || extractFromTripGlobals()
    || extractFromTripInline()        // Trip.com 特化版（含 lnt 欄位）
    || extractFromInlineScripts();    // 通用 fallback

  if (!result) return null;

  // 若資料中沒有國家代碼，嘗試從 JSON-LD 的 addressCountry 取得
  if (!result.country) {
    try {
      document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
        if (result.country) return;
        try {
          const data = JSON.parse(el.textContent);
          const addr = data?.address || data?.geo?.address;
          if (addr?.addressCountry) {
            const raw = String(addr.addressCountry).trim();
            // 可能是 "JP" 也可能是 "日本" — 若為 2 字母代碼直接用，否則留給 popup 端正規化
            result.country = /^[A-Z]{2}$/i.test(raw) ? raw.toUpperCase() : raw;
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  // 最終 fallback：依座標推算國家（Trip.com 常無法提取 countryCode）
  if (!result.country) {
    result.country = detectCountryFromCoords(result.lat, result.lng);
  }

  // 擴展：日期 + 價格
  const { checkin, checkout } = extractDatesFromUrl();
  result.checkin  = checkin;
  result.checkout = checkout;
  result.price    = extractTripPrice();
  return result;
}

window.__siteExtractFn = extractTrip;
