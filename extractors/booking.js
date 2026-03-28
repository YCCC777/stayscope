// ============================================================
// StayScope — Booking.com Extractor
// 依賴 extractors/base.js 中的共用函式
// ============================================================
'use strict';

// ---- 從 URL path 提取國家代碼 ----
// Booking.com URL 格式非常一致：/hotel/jp/hotel-name.html → JP
function extractBookingCountryFromUrl() {
  const match = location.pathname.match(/\/hotel\/([a-z]{2})\//i);
  return match ? match[1].toUpperCase() : null;
}

// ---- 掃描 Booking.com 專屬全域變數 ----
function extractFromBookingGlobals() {
  try {
    // MAIN world：直接讀取全域變數
    const candidates = [window.b_hotel_data, window.booking_data];
    for (const d of candidates) {
      if (!d) continue;
      const obj = typeof d === 'string' ? null : d;
      if (obj?.latitude && obj?.longitude) {
        const lat = parseFloat(obj.latitude);
        const lng = parseFloat(obj.longitude);
        if (isValidCoord(lat, lng)) {
          return { lat, lng, name: obj.hotel_name || null, country: null, city: null, strategy: 'booking-globals' };
        }
      }
      const str = typeof d === 'object' ? JSON.stringify(d) : '';
      const m = str.match(/"latitude"\s*:\s*"?(-?\d{1,3}\.\d{4,})"?\s*,\s*"longitude"\s*:\s*"?(-?\d{1,3}\.\d{4,})"?/i);
      if (m) {
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (isValidCoord(lat, lng)) {
          return { lat, lng, name: null, country: null, city: null, strategy: 'booking-globals' };
        }
      }
    }

    // ISOLATED world：從 inline script 文字搜尋 b_hotel_data
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const text = script.textContent;
      if (text.length > 3_000_000 || !text.includes('hotel')) continue;
      const coordRe = /"lat(?:itude)?"\s*:\s*"?(-?\d{1,3}\.\d{4,})"?\s*,\s*"l(?:ng|on(?:gitude)?)"\s*:\s*"?(-?\d{1,3}\.\d{4,})"?/i;
      const m = text.match(coordRe);
      if (m) {
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (isValidCoord(lat, lng)) {
          const nameM = text.match(/"hotel_name"\s*:\s*"([^"]+)"/);
          return { lat, lng, name: nameM ? nameM[1] : null, country: null, city: null, strategy: 'booking-inline' };
        }
      }
    }
  } catch (e) {}
  return null;
}

// ---- Booking.com 價格提取 ----
function extractBookingPrice() {
  try {
    // 策略 1：window 全域變數（MAIN world）+ inline script 文字（ISOLATED world）
    const sources = [];
    if (window.b_hotel_data)  sources.push(JSON.stringify(window.b_hotel_data));
    if (window.booking_data)  sources.push(JSON.stringify(window.booking_data));

    // ISOLATED world 也能讀取 script 文字
    const scripts = document.querySelectorAll('script:not([src])');
    for (const s of scripts) {
      const t = s.textContent;
      if (t.length > 3_000_000) continue;
      if (t.includes('price') || t.includes('amount') || t.includes('currency')) {
        sources.push(t);
      }
    }

    for (const str of sources) {
      const pm = str.match(/"gross_amount_per_night"\s*:\s*\{[^}]{0,200}"value"\s*:\s*([\d.]+)/i)
               || str.match(/"gross_amount"\s*:\s*\{[^}]{0,200}"value"\s*:\s*([\d.]+)/i)
               || str.match(/"composite_price_breakdown"[\s\S]{0,600}"gross_amount"[\s\S]{0,200}"value"\s*:\s*([\d.]+)/i)
               || str.match(/"min_price"\s*:\s*([\d.]+)/i);
      const cm = str.match(/"selected_currency"\s*:\s*"([A-Z]{3})"/i)
               || str.match(/"currency(?:_code)?"\s*:\s*"([A-Z]{3})"/i)
               || str.match(/"currencyCode"\s*:\s*"([A-Z]{3})"/i);
      if (pm) {
        const amount = parseFloat(pm[1]);
        const currency = cm ? cm[1] : null;
        if (amount > 0 && amount < 1e7) {
          const display = currency ? `${currency} ${amount}` : String(amount);
          return { amount, display, currency, perNight: true };
        }
      }
    }

    // 策略 2：DOM 做最後防線
    const el = document.querySelector('[data-testid="price-and-discounted-price"]')
             || document.querySelector('[data-testid="price-for-x-nights"]')
             || document.querySelector('.bui-price-display__value')
             || document.querySelector('.prco-valign-middle-helper')
             || document.querySelector('[data-qa="header-price"]');
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
function extractBooking() {
  const result = extractFromJsonLd()
    || extractFromBookingGlobals()
    || extractFromMetaTags()
    || extractFromInlineScripts();

  if (!result) return null;

  // Booking.com URL path 是最可靠的國家來源
  if (!result.country) {
    result.country = extractBookingCountryFromUrl();
  }

  // 擴展：日期 + 價格
  const { checkin, checkout } = extractDatesFromUrl();
  result.checkin  = checkin;
  result.checkout = checkout;
  result.price    = extractBookingPrice();
  return result;
}

window.__siteExtractFn = extractBooking;
