// ============================================================
// StayScope — settings.js
// ============================================================
'use strict';

const CUSTOM_CATS_KEY = 'ss_custom_cats';
const LANG_KEY        = 'ss_lang';
const RADIUS_KEY      = 'ss_radius';

// ── Storage helpers ──────────────────────────────────────────
function stGet(keys) {
  return new Promise(resolve => {
    chrome.storage.local.get(keys, result => resolve(result));
  });
}
function stSet(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}
function stRemove(keys) {
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

// ── Toast ────────────────────────────────────────────────────
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ── i18n ─────────────────────────────────────────────────────
let uiStr = null;

function applyI18n(str) {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (str[key]) el.textContent = str[key];
  });
  document.title = str.settings_title || 'StayScope 設定';
  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = '⚙️ ' + (str.settings_title || '設定');
}

// ── Language ─────────────────────────────────────────────────
async function initLang() {
  const res = await stGet(LANG_KEY);
  const savedLang = res[LANG_KEY] || 'zh-TW';
  const sel = document.getElementById('select-lang');
  sel.value = savedLang;
  uiStr = getUiStrings(savedLang);
  applyI18n(uiStr);

  sel.addEventListener('change', async () => {
    const lang = sel.value;
    await stSet({ [LANG_KEY]: lang });
    uiStr = getUiStrings(lang);
    applyI18n(uiStr);
    // 更新 hint 文字（data-i18n 不管的部分）
    renderCatList(await loadCustomCats());
    showToast(uiStr.settings_save || '已儲存');
  });
}

// ── Radius ───────────────────────────────────────────────────
async function initRadius() {
  const res = await stGet(RADIUS_KEY);
  const saved = res[RADIUS_KEY] || '15';
  const radios = document.querySelectorAll('input[name="radius"]');
  radios.forEach(r => { r.checked = (r.value === String(saved)); });
  radios.forEach(r => {
    r.addEventListener('change', async () => {
      await stSet({ [RADIUS_KEY]: r.value });
      showToast(uiStr ? (uiStr.settings_save || '已儲存') : '已儲存');
    });
  });
}

// ── Custom Categories ─────────────────────────────────────────
async function loadCustomCats() {
  const res = await stGet(CUSTOM_CATS_KEY);
  return res[CUSTOM_CATS_KEY] || [];
}

async function saveCustomCats(cats) {
  await stSet({ [CUSTOM_CATS_KEY]: cats });
}

function renderCatList(cats) {
  const list = document.getElementById('custom-cats-list');
  const hint = document.getElementById('custom-cats-hint');
  list.innerHTML = '';

  if (!cats.length) {
    hint.style.display = 'block';
    return;
  }
  hint.style.display = 'none';

  cats.forEach((cat, idx) => {
    const item = document.createElement('div');
    item.className = 'cat-item';
    item.innerHTML = `
      <span class="cat-item-icon">${cat.icon || '📍'}</span>
      <div class="cat-item-info">
        <div class="cat-item-name">${escHtml(cat.name)}</div>
        <div class="cat-item-kw">${escHtml(cat.keyword)}</div>
      </div>
      <button class="cat-item-del" data-idx="${idx}" title="刪除">×</button>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll('.cat-item-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = parseInt(btn.dataset.idx);
      const cats = await loadCustomCats();
      cats.splice(i, 1);
      await saveCustomCats(cats);
      renderCatList(cats);
    });
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// icon 推測
const ICON_MAP = [
  [/(cafe|coffee|咖啡)/i,         '☕'],
  [/(restaurant|餐廳|食|飯|料理)/i,'🍽️'],
  [/(supermarket|超市|超級市場)/i, '🛒'],
  [/(pharmacy|藥|drug)/i,          '💊'],
  [/(hospital|醫院|clinic|診所)/i, '🏥'],
  [/(park|公園|garden)/i,          '🌳'],
  [/(playground|遊樂|兒童)/i,      '🛝'],
  [/(transit|metro|mrt|捷運|地鐵)/i,'🚇'],
  [/(bus|巴士|公車)/i,             '🚌'],
  [/(airport|機場)/i,              '✈️'],
  [/(rental|rent|租車)/i,          '🚗'],
  [/(bike|bicycle|單車|自行車)/i,  '🚲'],
  [/(taxi|計程車|cab)/i,           '🚕'],
  [/(convenience|便利|711|7-11)/i, '🏪'],
  [/(laundry|laundr|洗衣)/i,       '🧺'],
  [/(wifi|wi-fi|internet)/i,       '📶'],
];

function guessIcon(name, keyword) {
  const text = (name + ' ' + keyword).toLowerCase();
  for (const [re, icon] of ICON_MAP) {
    if (re.test(text)) return icon;
  }
  return '📍';
}

function showAddForm() {
  // 如果已有 form 就忽略
  if (document.querySelector('.cat-add-form')) return;

  const str = uiStr || {};
  const form = document.createElement('div');
  form.className = 'cat-add-form';
  form.innerHTML = `
    <div class="cat-add-row">
      <input type="text" id="cat-inp-name" placeholder="${escHtml(str.settings_cat_name || '類別名稱')}" maxlength="20">
      <input type="text" id="cat-inp-kw"   placeholder="${escHtml(str.settings_cat_keyword || '搜尋關鍵字')}" maxlength="50">
    </div>
    <div class="cat-add-form-btns">
      <button class="cat-add-cancel">✕</button>
      <button class="cat-add-confirm">✓ ${escHtml(str.settings_add_cat || '新增')}</button>
    </div>
  `;

  document.getElementById('custom-cats-list').before(form);

  form.querySelector('.cat-add-cancel').addEventListener('click', () => form.remove());
  form.querySelector('.cat-add-confirm').addEventListener('click', async () => {
    const name    = document.getElementById('cat-inp-name').value.trim();
    const keyword = document.getElementById('cat-inp-kw').value.trim();
    if (!name || !keyword) {
      showToast(str.settings_cat_name ? '請填入名稱和關鍵字' : 'Please fill in name and keyword');
      return;
    }
    const icon = guessIcon(name, keyword);
    const cats = await loadCustomCats();
    cats.push({ name, keyword, icon });
    await saveCustomCats(cats);
    form.remove();
    renderCatList(cats);
    showToast(str.settings_save || '已儲存');
  });

  document.getElementById('cat-inp-name').focus();
}

async function initCustomCats() {
  const cats = await loadCustomCats();
  renderCatList(cats);
  document.getElementById('btn-add-cat').addEventListener('click', showAddForm);
}

// ── Export / Import / Clear ───────────────────────────────────
async function exportAll() {
  const [favs, local] = await Promise.all([
    getFavorites(),
    stGet([CUSTOM_CATS_KEY, LANG_KEY, RADIUS_KEY]),
  ]);
  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    favorites: favs,
    custom_cats: local[CUSTOM_CATS_KEY] || [],
    lang: local[LANG_KEY] || null,
    radius: local[RADIUS_KEY] || null,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `stayscope-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(uiStr ? (uiStr.settings_export || '已匯出') : '已匯出');
}

function importAll() {
  document.getElementById('import-all-input').click();
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    showToast('JSON 格式錯誤');
    return;
  }

  if (!data || typeof data !== 'object') { showToast('檔案格式不符'); return; }

  const tasks = [];
  if (Array.isArray(data.favorites) && data.favorites.length) {
    tasks.push(setFavorites(data.favorites));
  }
  const localPayload = {};
  if (Array.isArray(data.custom_cats)) localPayload[CUSTOM_CATS_KEY] = data.custom_cats;
  if (data.lang)   localPayload[LANG_KEY]   = data.lang;
  if (data.radius) localPayload[RADIUS_KEY] = data.radius;
  if (Object.keys(localPayload).length) tasks.push(stSet(localPayload));

  await Promise.all(tasks);
  showToast(uiStr ? (uiStr.settings_import || '已匯入') : '已匯入');
  // 重新載入設定 UI
  setTimeout(() => location.reload(), 800);
}

async function clearAll() {
  const msg = uiStr ? (uiStr.settings_clear_confirm || '確定要清除所有收藏和設定嗎？') : '確定要清除所有收藏和設定嗎？';
  if (!confirm(msg)) return;
  await Promise.all([
    setFavorites([]),
    stRemove([CUSTOM_CATS_KEY, LANG_KEY, RADIUS_KEY]),
  ]);
  showToast('已清除');
  setTimeout(() => location.reload(), 800);
}

// ── Back button ───────────────────────────────────────────────
function initBackBtn() {
  document.getElementById('btn-back').addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.close();
  });
}

// ── Init ─────────────────────────────────────────────────────
async function init() {
  await initLang();
  await Promise.all([initRadius(), initCustomCats()]);
  initBackBtn();

  document.getElementById('btn-export-all').addEventListener('click', exportAll);
  document.getElementById('btn-import-all').addEventListener('click', importAll);
  document.getElementById('import-all-input').addEventListener('change', handleImportFile);
  document.getElementById('btn-clear-all').addEventListener('click', clearAll);
}

document.addEventListener('DOMContentLoaded', init);
