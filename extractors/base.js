// ============================================================
// StayScope — Extractor Base Utilities
// 所有平台提取器的共用工具函式
// ============================================================
'use strict';

// ---- 座標有效性驗證 ----
function isValidCoord(lat, lng) {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    && !(lat === 0 && lng === 0);
}

// ---- 共用策略：JSON-LD 結構化資料 ----
// 遍歷所有 JSON-LD script，分別收集 geo 與 address，避免兩者在不同 <script> 的問題
// 支援 @graph 陣列、巢狀 geo（containedInPlace 等）、完整國家名稱→代碼轉換
function extractFromJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  let geoResult  = null;
  let addrResult = null;

  // 國名→代碼映射（常見旅遊國家，含中日韓泰文名稱）
  const COUNTRY_NAME_TO_CODE = {
    'japan':'JP','thailand':'TH','taiwan':'TW','south korea':'KR','korea':'KR',
    'vietnam':'VN','indonesia':'ID','malaysia':'MY','singapore':'SG','philippines':'PH',
    'china':'CN','hong kong':'HK','macau':'MO','macao':'MO','australia':'AU','new zealand':'NZ',
    'united kingdom':'GB','uk':'GB','united states':'US','usa':'US','france':'FR','germany':'DE',
    'deutschland':'DE','italy':'IT','italia':'IT','spain':'ES','españa':'ES',
    'portugal':'PT','greece':'GR','turkey':'TR','türkiye':'TR','netherlands':'NL','nederland':'NL',
    'canada':'CA','ireland':'IE','india':'IN',
    'united arab emirates':'AE','uae':'AE','mexico':'MX','brazil':'BR','argentina':'AR',
    // CJK 國名
    '日本':'JP','台湾':'TW','台灣':'TW','中国':'CN','中國':'CN',
    '韓国':'KR','韓國':'KR','香港':'HK','澳門':'MO','澳门':'MO',
    '新加坡':'SG','泰国':'TH','泰國':'TH','越南':'VN',
    '印尼':'ID','马来西亚':'MY','馬來西亞':'MY','菲律宾':'PH','菲律賓':'PH',
    '澳大利亚':'AU','澳洲':'AU','新西兰':'NZ','紐西蘭':'NZ',
    '美国':'US','美國':'US','加拿大':'CA','英国':'GB','英國':'GB',
    '法国':'FR','法國':'FR','德国':'DE','德國':'DE',
    '意大利':'IT','義大利':'IT','西班牙':'ES',
    // 日文カタカナ
    'シンガポール':'SG','タイ':'TH','ベトナム':'VN',
    'インドネシア':'ID','マレーシア':'MY','フィリピン':'PH',
    'オーストラリア':'AU','ニュージーランド':'NZ',
    'アメリカ':'US','カナダ':'CA','イギリス':'GB',
    'フランス':'FR','ドイツ':'DE','イタリア':'IT','スペイン':'ES',
    // 韓文
    '일본':'JP','대만':'TW','중국':'CN','한국':'KR','태국':'TH','싱가포르':'SG','베트남':'VN',
    '이탈리아':'IT','프랑스':'FR','독일':'DE','스페인':'ES','영국':'GB',
    '미국':'US','호주':'AU','캐나다':'CA','뉴질랜드':'NZ','포르투갈':'PT',
    '그리스':'GR','터키':'TR','튀르키예':'TR','네덜란드':'NL',
    '인도네시아':'ID','말레이시아':'MY','필리핀':'PH','홍콩':'HK','마카오':'MO','아일랜드':'IE',
  };

  function normalizeCountry(val) {
    if (!val) return null;
    const s = String(val).trim();
    if (/^[A-Z]{2}$/i.test(s)) return s.toUpperCase();
    return COUNTRY_NAME_TO_CODE[s] || COUNTRY_NAME_TO_CODE[s.toLowerCase()] || null;
  }

  // 遞迴掃描 JSON-LD 物件，從巢狀結構中找 geo 與 address
  function scanItem(item) {
    if (!item || typeof item !== 'object') return;
    // 直接 geo
    if (!geoResult && item.geo?.latitude != null && item.geo?.longitude != null) {
      const lat = parseFloat(item.geo.latitude), lng = parseFloat(item.geo.longitude);
      if (isValidCoord(lat, lng)) {
        geoResult = { lat, lng, name: item.name || null };
      }
    }
    // address
    if (!addrResult && item.address?.addressCountry) {
      addrResult = {
        country: normalizeCountry(item.address.addressCountry),
        city:    item.address.addressLocality || null,
      };
    }
    // 巢狀結構
    if (!geoResult) {
      for (const key of ['containedInPlace', 'location', 'containsPlace', 'mainEntity']) {
        const child = item[key];
        if (child) {
          const children = Array.isArray(child) ? child : [child];
          children.forEach(c => scanItem(c));
          if (geoResult && addrResult) return;
        }
      }
    }
  }

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      // 展開 @graph
      const items = Array.isArray(data) ? data
                  : data?.['@graph'] ? data['@graph']
                  : [data];
      for (const item of items) {
        scanItem(item);
        if (geoResult && addrResult) break;
      }
    } catch (e) {}
    if (geoResult && addrResult) break;
  }

  if (!geoResult) return null;
  return {
    lat:     geoResult.lat,
    lng:     geoResult.lng,
    name:    geoResult.name,
    country: addrResult?.country || null,
    city:    addrResult?.city    || null,
    strategy: 'jsonld',
  };
}

// ---- 共用策略：meta 標籤（Open Graph / Place） ----
function extractFromMetaTags() {
  const latStr = document.querySelector('meta[property="place:location:latitude"]')?.content
              || document.querySelector('meta[property="og:latitude"]')?.content;
  const lngStr = document.querySelector('meta[property="place:location:longitude"]')?.content
              || document.querySelector('meta[property="og:longitude"]')?.content;

  if (!latStr || !lngStr) return null;
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  if (!isValidCoord(lat, lng)) return null;

  return { lat, lng, name: null, country: null, city: null, strategy: 'meta' };
}

// ---- 共用策略：正則掃描 inline scripts ----
function extractFromInlineScripts() {
  const scripts = document.querySelectorAll('script:not([src])');
  const patterns = [
    /"lat(?:itude)?"\s*:\s*(-?\d{1,3}\.\d+)\s*,\s*"l(?:ng|nt|on(?:gitude)?)"\s*:\s*(-?\d{1,3}\.\d+)/i,
    /"latitude"\s*:\s*(-?\d{1,3}\.\d+)\s*,\s*"longitude"\s*:\s*(-?\d{1,3}\.\d+)/i,
    /\blat\s*:\s*(-?\d{1,3}\.\d+)\s*,\s*l(?:ng|nt|on)\s*:\s*(-?\d{1,3}\.\d+)/i,
  ];

  for (const script of scripts) {
    const text = script.textContent;
    if (text.length > 5_000_000) continue;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (isValidCoord(lat, lng)) {
          return { lat, lng, name: null, country: null, city: null, strategy: 'inline-script' };
        }
      }
    }
  }
  return null;
}

// ---- 座標範圍推算（所有策略都無法取得國家代碼時的最終 fallback） ----
// 注意：面積小的區域必須排在前面，避免被大區域吞掉（HK/MO/SG 需在 CN 之前）
function detectCountryFromCoords(lat, lng) {
  const regions = [
    { code: 'HK', latMin: 22.15, latMax: 22.57, lngMin: 113.83, lngMax: 114.44 },
    { code: 'MO', latMin: 22.09, latMax: 22.23, lngMin: 113.52, lngMax: 113.60 },
    { code: 'SG', latMin: 1.15,  latMax: 1.48,  lngMin: 103.60, lngMax: 104.01 },
    { code: 'TW', latMin: 21.87, latMax: 25.31, lngMin: 119.97, lngMax: 122.10 },
    { code: 'JP', latMin: 24.04, latMax: 45.55, lngMin: 122.93, lngMax: 153.99 },
    { code: 'KR', latMin: 33.11, latMax: 38.63, lngMin: 124.61, lngMax: 129.59 },
    { code: 'PH', latMin: 4.64,  latMax: 20.94, lngMin: 116.93, lngMax: 126.61 },
    { code: 'VN', latMin: 8.41,  latMax: 23.39, lngMin: 102.14, lngMax: 109.47 },
    { code: 'TH', latMin: 5.61,  latMax: 20.46, lngMin: 97.39,  lngMax: 105.65 },
    { code: 'MY', latMin: 0.85,  latMax: 7.36,  lngMin: 99.64,  lngMax: 119.28 },
    { code: 'ID', latMin: -10.93,latMax: 5.91,  lngMin: 95.01,  lngMax: 141.02 },
    { code: 'CN', latMin: 18.16, latMax: 53.56, lngMin: 73.50,  lngMax: 134.77 },
    { code: 'NZ', latMin: -47.29,latMax: -34.39,lngMin: 166.43, lngMax: 178.55 },
    { code: 'AU', latMin: -43.64,latMax: -10.07,lngMin: 113.16, lngMax: 153.64 },
    { code: 'IE', latMin: 51.42, latMax: 55.39, lngMin: -10.47, lngMax: -5.99  },
    { code: 'GB', latMin: 49.86, latMax: 60.86, lngMin: -8.17,  lngMax: 1.77   },
    { code: 'PT', latMin: 29.84, latMax: 42.15, lngMin: -31.27, lngMax: -6.19  },
    { code: 'ES', latMin: 27.64, latMax: 43.95, lngMin: -18.16, lngMax: 4.33   },
    { code: 'FR', latMin: 41.33, latMax: 51.12, lngMin: -5.14,  lngMax: 9.56   },
    { code: 'IT', latMin: 35.49, latMax: 47.09, lngMin: 6.63,   lngMax: 18.52  },
    { code: 'GR', latMin: 34.80, latMax: 41.75, lngMin: 19.37,  lngMax: 29.64  },
    { code: 'TR', latMin: 35.82, latMax: 42.11, lngMin: 25.66,  lngMax: 44.79  },
    { code: 'DE', latMin: 47.27, latMax: 55.06, lngMin: 5.87,   lngMax: 15.04  },
    { code: 'NL', latMin: 50.75, latMax: 53.55, lngMin: 3.35,   lngMax: 7.23   },
    { code: 'CA', latMin: 41.68, latMax: 83.11, lngMin: -141.00,lngMax: -52.62 },
    { code: 'US', latMin: 24.52, latMax: 49.38, lngMin: -124.77,lngMax: -66.95 },
  ];
  for (const r of regions) {
    if (lat >= r.latMin && lat <= r.latMax && lng >= r.lngMin && lng <= r.lngMax) {
      return r.code;
    }
  }
  return null;
}

// ---- 共用：從 URL query string 提取入住/退房日期 ----
// 支援 Airbnb (check_in/check_out), Booking (checkin/checkout),
// Agoda (checkIn + los 天數), Trip.com (checkin/checkout)
function extractDatesFromUrl() {
  try {
    const p = new URLSearchParams(location.search);
    const checkin  = p.get('check_in') || p.get('checkin') || p.get('checkIn') || null;
    let   checkout = p.get('check_out') || p.get('checkout') || p.get('checkOut') || null;
    // Agoda 用 los（length of stay）代替 checkout
    if (!checkout && checkin) {
      const los = parseInt(p.get('los') || p.get('lengthOfStay') || '0', 10);
      if (los > 0) {
        const d = new Date(checkin);
        d.setDate(d.getDate() + los);
        checkout = d.toISOString().slice(0, 10);
      }
    }
    return { checkin: checkin || null, checkout: checkout || null };
  } catch (e) {}
  return { checkin: null, checkout: null };
}

// ---- 共用：從顯示字串偵測貨幣代碼 ----
function detectCurrency(display) {
  if (!display) return null;
  const map = {
    'NT$': 'TWD', 'HK$': 'HKD', 'S$': 'SGD', 'A$': 'AUD', 'MOP$': 'MOP',
    'Rp': 'IDR', 'RM': 'MYR', '¥': 'JPY', '₩': 'KRW', '฿': 'THB',
    '₫': 'VND', '€': 'EUR', '£': 'GBP', '$': 'USD',
  };
  // 長符號優先（避免 $ 優先吃掉 HK$）
  for (const [sym, code] of Object.entries(map)) {
    if (display.includes(sym)) return code;
  }
  return null;
}
