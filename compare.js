// ============================================================
// StayScope — compare.js  (P4 全頁比較)
// ============================================================
'use strict';

let ui = null; // i18n strings

const CHECKLIST_KEYS  = ['supermarket','pharmacy','park','transit','hospital','restaurant','convenience','cafe'];
const CHECKLIST_ICONS  = {
  supermarket:'🛒', pharmacy:'💊', park:'🌳', transit:'🚇',
  hospital:'🏥', restaurant:'🍽️', convenience:'🏪', cafe:'☕'
};

// ── Haversine 距離（km）──────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function fmtDist(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

// 行車分鐘估算（城市均速 30 km/h）
function driveMin(km) { return Math.max(1, Math.round(km / 30 * 60)); }

// 格式化時間：< 60min → "13min"，≥ 60min → "1h 5min"
function fmtTime(totalMin) {
  if (totalMin < 60) return `${totalMin}min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// 步行分鐘估算（保留，路線按鈕說明用）
function walkMin(km) { return Math.round(km / 4 * 60); }

// ── Utility ─────────────────────────────────────────────────
// 從 SEO 長標題提取乾淨飯店名（括號內英文名，或去掉品牌後綴）
function cleanHotelName(name) {
  if (!name) return '';
  const parenM = name.match(/\(([A-Za-z][^)]{4,})\)/);
  if (parenM) return parenM[1].replace(/\s+(by|[-\u2013\u2014])\s+.+$/i, '').trim();
  return name.split(/\s*[-\u2013\u2014]\s+/)[0].trim();
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── 渲染 ─────────────────────────────────────────────────────
function renderColHeader(f) {
  const info = getCountryInfo(f.country);
  const flag = info ? info.flag : '🌍';
  const src  = f.source || '';
  return `
  <div class="cmp-col-header">
    <div class="cmp-col-flag">${flag}</div>
    <div class="cmp-col-name">${escHtml(f.name || f.url)}</div>
    <div class="cmp-col-meta">
      ${src ? `<span class="cmp-src-badge">${escHtml(src)}</span>` : ''}
      <span class="cmp-coords">${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}</span>
    </div>
  </div>`;
}

function renderChecklist(f) {
  const cl = f.checklist || {};
  const rows = CHECKLIST_KEYS.map(key => {
    const val = cl[key];
    const stateClass = val === true ? 'state-yes' : val === false ? 'state-no' : '';
    const icon = val === true ? '✅' : val === false ? '❌' : CHECKLIST_ICONS[key];
    const label = escHtml(ui[`checklist_${key}`] || key);
    return `<div class="cmp-ck-row ${stateClass}">
      <span class="ck-state">${icon}</span>
      <span>${label}</span>
    </div>`;
  }).join('');
  return `<div class="cmp-checklist">
    <div class="cmp-section-label">${escHtml(ui.cmp_checklist_title || '地段確認清單')}</div>
    ${rows}
  </div>`;
}

function renderColActions(f, idx) {
  const kw = getSearchKeywords(f.country);
  const nearby = encodeURIComponent(kw.supermarket || 'supermarket');
  return `
  <div class="cmp-col-actions">
    <button class="cmp-action-btn accent" data-href="https://www.google.com/maps/search/${nearby}/@${f.lat},${f.lng},15z">
      ${escHtml(ui.cmp_search_nearby || '🗺️ 搜尋周邊')}
    </button>
    <button class="cmp-action-btn" data-href="https://www.google.com/maps?q=${f.lat},${f.lng}">
      ${escHtml(ui.cmp_view_map || '📍 查看地圖')}
    </button>
    <button class="cmp-action-btn" data-href="${escHtml(f.url)}">
      ${escHtml(ui.cmp_open_listing || '🔗 開啟房源')}
    </button>
  </div>`;
}

function renderPropertyCols(listings, priceLog) {
  const grid = document.getElementById('cmp-grid');
  const LABELS = ['A', 'B', 'C', 'D', 'E'];

  grid.innerHTML = listings.map((f, i) => {
    let displayCountry = f.country;
    if (!displayCountry && f.lat && f.lng) displayCountry = detectCountryFromCoords(f.lat, f.lng);
    if (!displayCountry && f.source === 'trip' && f.url) {
      const subM = f.url.match(/^https?:\/\/([a-z]{2})\.trip\.com/i);
      if (subM) { const s = subM[1].toUpperCase(); displayCountry = s === 'UK' ? 'GB' : s; }
    }
    const info    = getCountryInfo(displayCountry);
    const flag    = info ? info.flag : '🌍';
    const src     = f.source || '';
    const srcLabel = src ? (ui[`source_${src}`] || src) : '';
    const cl      = f.checklist || {};
    const confirmedKeys = CHECKLIST_KEYS.filter(key => cl[key] === true);
    const scoreTotal    = CHECKLIST_KEYS.length;
    const scoreYes      = confirmedKeys.length;
    const scoreConfirm  = CHECKLIST_KEYS.filter(key => cl[key] !== undefined).length;

    const ckCells = confirmedKeys.map(key => {
      const icon  = CHECKLIST_ICONS[key] || '?';
      const label = escHtml(ui[`checklist_${key}`] || key);
      return `<span class="cmp-pill" title="${label}">${icon} <span class="cmp-pill-label">${label}</span></span>`;
    }).join('');

    const scoreHtml = scoreConfirm > 0
      ? `<span class="cmp-card-score" title="${scoreYes}/${scoreTotal}">⭐ ${scoreYes}/${scoreTotal}</span>`
      : '';

    const cleanName = cleanHotelName(f.name || '');
    const hotelsUrl = f.source === 'airbnb' ? '' :
      cleanName ? `https://www.google.com/travel/hotels?q=${encodeURIComponent(cleanName)}` :
      (f.lat && f.lng) ? `https://www.google.com/travel/hotels?q=hotels+near+${f.lat},${f.lng}` : '';


    // 價格記錄：取最新一筆
    const pLog = (priceLog && priceLog[f.id]) || [];
    const latestPrice = pLog[0] || null;
    const perNightStr = (ui && ui.per_night) || '/ 晩';
    const priceHtml = latestPrice
      ? (() => {
          const dateStr = new Date(latestPrice.recordedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
          return `<div class="cmp-price-row">💰 <span class="cmp-price-amount">${escHtml(latestPrice.display)}</span><span class="cmp-price-meta"> ${perNightStr} · ${dateStr}</span></div>`;
        })()
      : '';

    return `
  <div class="cmp-card">
    <div class="cmp-card-label-badge">${LABELS[i] || (i + 1)}</div>
    <div class="cmp-card-body">
      <div class="cmp-card-top">
        <span class="cmp-card-flag">${flag}</span>
        <div class="cmp-card-info">
          <span class="cmp-card-name" title="${escHtml(f.name || f.url)}">${escHtml(f.name || f.url)}</span>
          <div class="cmp-card-meta">
            ${srcLabel ? `<span class="cmp-src-badge">${escHtml(srcLabel)}</span>` : ''}
            <span class="cmp-coords">${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}</span>
          </div>
        </div>
        ${scoreHtml}
      </div>
      ${priceHtml}
      ${confirmedKeys.length > 0 ? `<div class="cmp-card-checks">${ckCells}</div>` : ''}
      <div class="cmp-card-actions">
        <button class="cmp-act-btn cmp-act-icon" data-href="https://www.google.com/maps?q=${f.lat},${f.lng}" title="Google Maps">📍</button>
        ${f.url ? `<button class="cmp-act-btn cmp-act-grow" data-href="${escHtml(f.url)}" title="${escHtml(ui.fav_open_url || '房源頁面')}">🔗 ${escHtml(ui.fav_open_url || '房源頁面')}</button>` : ''}
        ${hotelsUrl ? `<button class="cmp-act-btn cmp-act-grow" data-href="${escHtml(hotelsUrl)}" title="Hotels">🏨 Hotels</button>` : ''}
      </div>
    </div>
  </div>`;
  }).join('');

  grid.querySelectorAll('[data-href]').forEach(btn => {
    btn.addEventListener('click', () => chrome.tabs.create({ url: btn.dataset.href }));
  });
}

function renderDistanceBar(listings) {
  const bar = document.getElementById('distance-bar');
  const LABELS = ['A', 'B', 'C', 'D', 'E'];
  const pairs = [];
  for (let i = 0; i < listings.length; i++) {
    for (let j = i+1; j < listings.length; j++) {
      const d = haversine(listings[i].lat, listings[i].lng, listings[j].lat, listings[j].lng);
      pairs.push({ i, j, d });
    }
  }

  const label = ui.cmp_dist_label || '房源間距離';
  const badgeHtml = pairs.map(p => `
  <div class="dist-badge">
    <span class="dist-pair-labels">${LABELS[p.i]}→${LABELS[p.j]}</span>
    <span class="dist-km">${fmtDist(p.d)}</span>
    <span class="dist-walk">· ${(ui.cmp_drive_min || '🚗 ~{n}').replace('{n}', fmtTime(driveMin(p.d)))}</span>
  </div>`).join('');

  bar.innerHTML = `<span class="dist-bar-title">${escHtml(label)}</span>${badgeHtml}`;
}

// ── Init ─────────────────────────────────────────────────────
async function init() {
  // 載入 i18n
  const storedLang = await new Promise(r =>
    chrome.storage.local.get('ss_lang', res => r(res['ss_lang'] || null))
  );
  ui = getUiStrings(storedLang || navigator.language || 'zh-TW');

  // 頁面文字 i18n
  const titleEl = document.getElementById('cmp-title');
  if (titleEl) titleEl.textContent = `⚖️ ${ui.tab_compare?.replace(/^[^\s]+\s/, '') || '比較'}`;

  const emptyP = document.querySelector('#cmp-empty p');
  if (emptyP) emptyP.textContent = ui.compare_empty || '請在收藏頁選取 2–3 筆房源';

  const closeEmptyBtn = document.getElementById('btn-close-empty');
  if (closeEmptyBtn) closeEmptyBtn.textContent = ui.donate_close || '關閉';

  document.getElementById('btn-back').addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.close();
  });

  document.getElementById('btn-close-empty')?.addEventListener('click', () => window.close());

  // 讀取比較選取 ID + 收藏清單 + 價格記錄
  const [selIds, allFavs, rawPriceLog] = await Promise.all([
    getCompareSelection(),
    getFavorites(),
    new Promise(r => chrome.storage.local.get('ss_price_log', res => r(res['ss_price_log'] || {}))),
  ]);

  if (!selIds || selIds.length < 2) {
    document.getElementById('cmp-grid-wrap').classList.add('hidden');
    document.getElementById('distance-bar').classList.add('hidden');
    document.getElementById('maps-all-bar').classList.add('hidden');
    document.getElementById('cmp-empty').classList.remove('hidden');
    return;
  }

  const listings = selIds
    .map(id => allFavs.find(f => f.id === id))
    .filter(Boolean);

  if (listings.length < 2) {
    document.getElementById('cmp-empty').classList.remove('hidden');
    return;
  }

  // 更新標題
  document.getElementById('cmp-subtitle').textContent = `${listings.length} listings`;

  renderPropertyCols(listings, rawPriceLog);
  renderDistanceBar(listings);

  // ---- Google Maps 按鈕 ----
  const mapsAllBtn = document.getElementById('btn-maps-all');
  if (mapsAllBtn) {
    mapsAllBtn.textContent = `🗺️ ${ui.cmp_maps_all || '在 Google Maps 查看全部房源位置'}`;
    const waypoints = listings.map(f => `${f.lat},${f.lng}`).join('/');
    const mapsUrl = `https://www.google.com/maps/dir/${waypoints}`;
    mapsAllBtn.addEventListener('click', () => chrome.tabs.create({ url: mapsUrl }));
    mapsAllBtn.title = mapsUrl;
  }
}

document.addEventListener('DOMContentLoaded', init);
