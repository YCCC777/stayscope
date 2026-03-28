// ============================================================
// StayScope — Favorites Panel (P2)
// 依賴 popup.js 的全域狀態：ui, favList, activeFilter
// ============================================================
'use strict';

const CHECKLIST_KEYS  = ['supermarket','pharmacy','park','transit','hospital','restaurant','convenience','cafe'];
const CHECKLIST_ICONS = {
  supermarket:'🛒', pharmacy:'💊', park:'🌳', transit:'🚇',
  hospital:'🏥', restaurant:'🍽️', convenience:'🏪', cafe:'☕'
};

// ---- 快選標籤列表 ----
const QUICK_TAG_KEYS = ['tag_top_pick', 'tag_backup', 'tag_pricey', 'tag_poor_transit', 'tag_nice_view', 'tag_value'];
function getQuickTags() {
  return QUICK_TAG_KEYS.map(k => ui[k] || k);
}

// ---- 展開狀態追蹤 ----
const expandedIds = new Set();

// ---- 比較勾選的記憶體快取（避開 storage 非同步時序造成 batch bar 消失）----
let _compareIds = [];

// ---- 計算地段評分 ----
function calcScore(f) {
  const cl = f.checklist || {};
  let confirmed = 0;
  let yes = 0;
  for (const key of CHECKLIST_KEYS) {
    if (cl[key] !== undefined) {
      confirmed++;
      if (cl[key] === true) yes++;
    }
  }
  return { yes, total: CHECKLIST_KEYS.length, confirmed };
}

// ---- 主渲染函式 ----
async function renderFavorites() {
  const list = document.getElementById('fav-list');
  if (!list) return;

  buildFilterPills();

  const filtered = activeFilter === 'ALL'
    ? favList
    : favList.filter(f => f.country === activeFilter);

  if (filtered.length === 0) {
    list.innerHTML = '';
    show('fav-empty');
    return;
  }
  hide('fav-empty');

  // 載入所有收藏的價格紀錄
  const allPriceLogs = await getAllPriceLogs();

  list.innerHTML = filtered.map(f => buildFavItemHTML(f, allPriceLogs[f.id] || [])).join('');

  // 恢復展開狀態
  for (const id of expandedIds) {
    const detail = document.getElementById(`fav-detail-${id}`);
    if (detail) detail.classList.remove('hidden');
  }

  // 綁定展開、checkbox、刪除
  list.querySelectorAll('.fav-item-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('fav-compare-cb')) return;
      const id = row.closest('.fav-item').dataset.id;
      toggleFavDetail(id);
    });
  });

  list.querySelectorAll('.fav-compare-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      // 同步更新記憶體快取，不依賴 storage 時序
      _compareIds = [...document.querySelectorAll('.fav-compare-cb:checked')].map(c => c.dataset.id);
      setCompareSelection(_compareIds);
      renderCompare();
      updateBatchBar(_compareIds);
    });
  });

  // 用記憶體快取立即更新 batch bar（避免 storage 時序問題）
  updateBatchBar(_compareIds);
  // 同時從 storage 恢復勾選狀態（頁面初次載入或跨 session 恢復）
  getCompareSelection().then(savedIds => {
    _compareIds = savedIds || [];
    _compareIds.forEach(id => {
      const cb = document.querySelector(`.fav-compare-cb[data-id="${id}"]`);
      if (cb) cb.checked = true;
    });
    renderCompare();
    updateBatchBar(_compareIds);
  });

  bindFavActions(list);
}

function buildFilterPills() {
  const bar = document.getElementById('fav-filter-bar');
  if (!bar) return;

  const counts = {};
  for (const f of favList) {
    const c = f.country || (f.lat && f.lng ? detectCountryFromCoords(f.lat, f.lng) : null) || 'XX';
    counts[c] = (counts[c] || 0) + 1;
  }

  bar.querySelectorAll('.filter-pill:not(#fav-pill-all)').forEach(p => p.remove());

  const allBtn = document.getElementById('fav-pill-all');
  if (allBtn) allBtn.textContent = `${ui.fav_filter_all} ${favList.length}`;

  for (const [code, count] of Object.entries(counts)) {
    const info = getCountryInfo(code);
    const pill = document.createElement('button');
    pill.className = 'filter-pill' + (activeFilter === code ? ' active' : '');
    pill.dataset.country = code;
    pill.textContent = `${info ? info.flag : '🌍'} ${count}`;
    pill.addEventListener('click', () => {
      activeFilter = code;
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.toggle('active', p.dataset.country === code));
      renderFavorites();
    });
    bar.appendChild(pill);
  }

  if (allBtn) {
    allBtn.onclick = () => {
      activeFilter = 'ALL';
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.toggle('active', p.dataset.country === 'ALL'));
      renderFavorites();
    };
    allBtn.classList.toggle('active', activeFilter === 'ALL');
  }
}

function buildFavItemHTML(f, priceLog = []) {
  // 舊版 Trip.com 存檔可能 country=null，多層 fallback 推算
  let displayCountry = f.country;
  if (!displayCountry && f.lat && f.lng) {
    displayCountry = detectCountryFromCoords(f.lat, f.lng);
  }
  // Trip.com：從 URL 子域名推算（e.g. jp.trip.com → JP），不依賴座標
  if (!displayCountry && f.source === 'trip' && f.url) {
    const subM = f.url.match(/^https?:\/\/([a-z]{2})\.trip\.com/i);
    if (subM) {
      const sub = subM[1].toUpperCase();
      displayCountry = sub === 'UK' ? 'GB' : sub;
    }
  }
  const info = getCountryInfo(displayCountry);
  const flag = info ? info.flag : '🌍';
  const countryLabel = info ? `${flag} ${info.name}` : '';
  const name = escHtml(f.name || f.url);
  const srcLabel = f.source ? (ui[`source_${f.source}`] || f.source) : '';
  const tags = f.tags?.length ? f.tags.join(', ') : '';
  const score = calcScore(f);
  const scoreHtml = score.confirmed > 0
    ? `<span class="fav-score" title="${score.yes}/${score.total}">⭐ ${score.yes}/${score.total}</span>`
    : '';

  // ---- 價格展示 ----
  const latestPrice = priceLog[0];
  let favPriceHtml = '';
  if (latestPrice) {
    const perNight = ui?.per_night || '/ 晩';
    const prevEntry = priceLog.find((e, i) => i > 0 && e.amount !== latestPrice.amount);
    let deltaHtml = '';
    if (prevEntry) {
      const delta = latestPrice.amount - prevEntry.amount;
      const pct = Math.round(Math.abs(delta) / prevEntry.amount * 100);
      const cls = delta > 0 ? 'up' : 'down';
      deltaHtml = `<span class="price-delta ${cls}">${delta > 0 ? '↑' : '↓'}${pct}%</span>`;
    }
    const dateStr = new Date(latestPrice.recordedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
    favPriceHtml = `<div class="fav-price-row">
      <span class="fav-price-amount">💰 ${escHtml(latestPrice.display)} <span class="fav-price-per">${escHtml(perNight)}</span></span>
      ${deltaHtml}
      <span class="fav-price-date">${dateStr}</span>
    </div>`;
  }

  // 收藏列表項目中的價格指示（摺疊時顯示）
  const priceIndicator = latestPrice
    ? `<span class="fav-price-indicator">💰 ${escHtml(latestPrice.display)}</span>`
    : '';

  return `
  <div class="fav-item" data-id="${f.id}">
    <div class="fav-item-row">
      <input type="checkbox" class="fav-compare-cb" data-id="${f.id}" title="${escHtml(ui.fav_compare_select)}">
      <span class="fav-item-flag">${flag}</span>
      <div class="fav-item-info">
        <div class="fav-item-name" title="${name}">${name}</div>
        <div class="fav-item-meta">${tags || countryLabel || ''}${priceIndicator ? ' ' + priceIndicator : ''}</div>
      </div>
      ${scoreHtml}
      <span class="fav-item-source">${srcLabel}</span>
    </div>
    <div class="fav-item-detail hidden" id="fav-detail-${f.id}">
      ${favPriceHtml}
      ${buildChecklistHTML(f)}
      <input class="fav-input fav-input-name" data-field="name" data-id="${f.id}" placeholder="${escHtml(ui.fav_name_placeholder || '自訂名稱...')}" value="${escHtml(f.name || '')}">
      <div class="fav-tag-suggestions" id="tag-suggestions-${f.id}">${renderTagSuggestions(f)}</div>
      <input class="fav-input" data-field="tags" data-id="${f.id}" placeholder="${escHtml(ui.fav_tags_placeholder)}" value="${escHtml(tags)}">
      <div class="fav-detail-row fav-action-row">
        <button class="fav-detail-btn fav-btn-icon" data-action="pin" data-id="${f.id}" title="Google Maps">📍</button>
        ${f.url ? `<a class="fav-detail-btn fav-link-btn fav-btn-grow" href="${escHtml(f.url)}" target="_blank" rel="noopener" title="${escHtml(ui.fav_open_url || '原始頁面')}">🔗 ${escHtml(ui.fav_open_url || '原始頁面')}</a>` : '<span class="fav-btn-grow"></span>'}
        ${f.source !== 'airbnb' && f.source !== 'vrbo'
            ? `<a class="fav-detail-btn fav-link-btn fav-btn-grow" href="https://www.google.com/travel/hotels?q=${encodeURIComponent(cleanHotelName(f.name || '') || f.name || '')}" target="_blank" rel="noopener" title="${escHtml(ui.fav_hotels || '比價')}">🏨 ${escHtml(ui.fav_hotels || '比價')}</a>`
            : '<span class="fav-btn-grow"></span>'}
        <button class="fav-detail-btn danger fav-btn-icon" data-action="delete" data-id="${f.id}" title="${escHtml(ui.fav_delete)}">🗑️</button>
      </div>
    </div>
  </div>`;
}

// ---- 快ilter 標籤快選 chips ----
function renderTagSuggestions(f) {
  const tags = f.tags || [];
  return getQuickTags().map(label => {
    const active = tags.includes(label) ? ' active' : '';
    return `<button class="tag-chip${active}" data-tag-label="${escHtml(label)}" data-fav-id="${f.id}">${escHtml(label)}</button>`;
  }).join('');
}

function buildChecklistHTML(f) {
  const cl = f.checklist || {};
  const items = CHECKLIST_KEYS.map(key => {
    const val = cl[key];
    const state = val === true ? 'state-yes' : val === false ? 'state-no' : '';
    const icon  = val === true ? '✅' : val === false ? '❌' : CHECKLIST_ICONS[key];
    const label = escHtml(ui[`checklist_${key}`] || key);
    return `<div class="checklist-item ${state}" data-ck-key="${key}" data-fav-id="${f.id}" title="${label}">
      <span class="ck-icon">${icon}</span>
      <span class="ck-label">${label}</span>
    </div>`;
  }).join('');
  return `<div class="checklist-grid">${items}</div>`;
}

function toggleFavDetail(id) {
  const detail = document.getElementById(`fav-detail-${id}`);
  if (!detail) return;
  const isHidden = detail.classList.toggle('hidden');
  if (isHidden) expandedIds.delete(id);
  else expandedIds.add(id);
}

function bindFavActions(container) {
  // 按鈕動作
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { action, id } = btn.dataset;
      const f = favList.find(x => x.id === id);
      if (!f) return;

      if (action === 'delete') {
        favList = await removeFavorite(id);
        renderFavorites();
        renderCompare();
        updateSaveButton();
      } else if (action === 'pin') {
        openUrl(`https://www.google.com/maps?q=${f.lat},${f.lng}`);
      } else if (action === 'nearby') {
        const kw = getSearchKeywords(f.country);
        openUrl(buildMapsUrl(f.lat, f.lng, kw.supermarket));
      }
    });
  });

  // 快速標籤 chip（Task 8 在此補充）

  // checklist 三態循環（undefined → true → false → undefined）
  container.querySelectorAll('.checklist-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { ckKey, favId } = el.dataset;
      const f = favList.find(x => x.id === favId);
      if (!f) return;
      const cur = (f.checklist || {})[ckKey];
      const next = cur === undefined ? true : cur === true ? false : undefined;
      const newCl = { ...f.checklist };
      if (next === undefined) delete newCl[ckKey];
      else newCl[ckKey] = next;
      favList = await updateFavorite(favId, { checklist: newCl });
      renderFavorites();
      renderCompare();
    });
  });

  // 快選標籤 chip（Task 8）
  container.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { tagLabel, favId } = chip.dataset;
      const f = favList.find(x => x.id === favId);
      if (!f) return;
      const tags = [...(f.tags || [])];
      const idx = tags.indexOf(tagLabel);
      if (idx === -1) tags.push(tagLabel);
      else tags.splice(idx, 1);
      favList = await updateFavorite(favId, { tags });
      renderFavorites();
    });
  });

  // 文字輸入欄位（blur 後儲存）
  container.querySelectorAll('.fav-input').forEach(input => {
    input.addEventListener('blur', async () => {
      const { field, id } = input.dataset;
      if (!field || !id) return;
      const val = input.value.trim();
      const patch = field === 'tags'
        ? { tags: val ? val.split(',').map(t => t.trim()).filter(Boolean) : [] }
        : field === 'name'
        ? { name: val }
        : { notes: val };
      favList = await updateFavorite(id, patch);
      renderFavorites();
    });
  });
}

// ---- 批次刪除列 ----
function updateBatchBar(checkedIds) {
  const bar      = document.getElementById('fav-batch-bar');
  const countEl  = document.getElementById('fav-batch-count');
  const btn      = document.getElementById('btn-batch-delete');
  if (checkedIds.length > 0) {
    if (bar) bar.classList.remove('hidden');
    if (countEl) countEl.textContent = (ui?.batch_selected || '已選 {n} 筆').replace('{n}', checkedIds.length);
    if (btn) btn.disabled = false;
  } else {
    if (bar) bar.classList.add('hidden');
    if (countEl) countEl.textContent = '';
    if (btn) btn.disabled = true;
  }
}

function setupBatchDelete() {
  const btn = document.getElementById('btn-batch-delete');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('.fav-compare-cb:checked')].map(c => c.dataset.id);
    if (checked.length === 0) return;
    for (const id of checked) {
      favList = await removeFavorite(id);
    }
    _compareIds = [];
    setCompareSelection([]);
    await renderFavorites();
    renderCompare();
    updateSaveButton();
  });
}

// ---- 後台刷新所有收藏價格 ----
// 依序為每個收藏開啟背景分頁，注入提取器取得最新價格後關閉分頁
function setupFavRefreshPrices() {
  const btn = document.getElementById('btn-refresh-prices');
  if (!btn) return;
  btn.addEventListener('click', () => refreshAllPrices());
}

async function refreshAllPrices() {
  const btn = document.getElementById('btn-refresh-prices');
  if (!btn || btn.disabled) return;

  const toRefresh = favList.filter(f => f.url && detectSource(f.url));
  if (toRefresh.length === 0) return;

  btn.disabled = true;
  const labelEl = document.getElementById('label-refresh-prices');
  const origLabel = labelEl ? labelEl.textContent : '更新價格';

  let done = 0;
  for (const fav of toRefresh) {
    if (labelEl) labelEl.textContent = `${done}/${toRefresh.length}`;
    try {
      const price = await fetchPriceFromUrl(fav.url);
      if (price?.amount) {
        await savePriceEntry(urlToId(fav.url), {
          amount:     price.amount,
          currency:   price.currency,
          display:    price.display,
          checkin:    null,
          checkout:   null,
          recordedAt: Date.now(),
        });
      }
    } catch (e) {
      console.warn('[StayScope] price refresh failed:', fav.url, e);
    }
    done++;
  }

  btn.disabled = false;
  if (labelEl) labelEl.textContent = origLabel;
  await renderFavorites();
}

// ---- 用 fetch + DOMParser 提取房源價格（不開啟新分頁） ----
// 可取得：JSON-LD offers.price、inline script 中的價格欄位
// 不適用：需要 JS 執行才能算出的動態價格（Airbnb 部分頁面）
async function fetchPriceFromUrl(url) {
  try {
    const resp = await fetch(url, {
      credentials: 'omit',
      headers: { 'Accept': 'text/html,application/xhtml+xml' },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // 策略 1：JSON-LD offers.price
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent);
        const items = Array.isArray(data) ? data : data?.['@graph'] ? data['@graph'] : [data];
        for (const item of items) {
          const offers = item?.offers;
          if (offers?.price && offers.priceCurrency) {
            const amount = parseFloat(String(offers.price).replace(/[^\d.]/g, ''));
            if (amount > 0 && amount < 1e7) {
              return { amount, currency: offers.priceCurrency, display: `${offers.priceCurrency} ${amount}` };
            }
          }
        }
      } catch (e) {}
    }

    // 策略 2：inline script 掃描（含 __NEXT_DATA__ 的 SSR 頁面）
    const priceRe = /"(?:displayPrice|price_amount|priceAmount|avgPrice|roomPrice)"\s*:\s*"?([0-9,]+(?:\.[0-9]{1,2})?)"?/;
    const curRe   = /"(?:currency|currencyCode)"\s*:\s*"([A-Z]{3})"/;
    for (const script of doc.querySelectorAll('script:not([src])')) {
      const text = script.textContent;
      if (!text.includes('price') || text.length > 5_000_000) continue;
      const pm = text.match(priceRe);
      if (pm) {
        const amount = parseFloat(String(pm[1]).replace(/,/g, ''));
        if (amount > 0 && amount < 1e7) {
          const cm = text.match(curRe);
          const currency = cm ? cm[1] : null;
          return { amount, currency, display: currency ? `${currency} ${amount}` : String(amount) };
        }
      }
    }
  } catch (e) {}
  return null;
}

function setupFavImportExport() {
  const exportBtn = document.getElementById('btn-export');
  const importBtn = document.getElementById('btn-import');
  const fileInput = document.getElementById('import-file-input');
  if (!exportBtn || !importBtn || !fileInput) return;

  exportBtn.onclick = () => {
    const blob = new Blob([JSON.stringify(favList, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stayscope-favorites-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  importBtn.onclick = () => fileInput.click();

  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error('格式錯誤');
      for (const item of data) {
        if (!item.id || !item.lat) continue;
        favList = await addFavorite(item);
      }
      renderFavorites();
      renderCompare();
    } catch (err) {
      console.error('StayScope import error:', err);
    }
    fileInput.value = '';
  };
}
