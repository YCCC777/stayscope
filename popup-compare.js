// ============================================================
// StayScope — Compare Panel (P2, popup 內嵌版)
// 依賴 popup.js 的全域狀態：ui, favList
// ============================================================
'use strict';

function renderCompare() {
  const grid = document.getElementById('compare-grid');
  const empty = document.getElementById('compare-empty');
  if (!grid) return;

  const checkedIds = [];
  document.querySelectorAll('.fav-compare-cb:checked').forEach(cb => {
    checkedIds.push(cb.dataset.id);
  });

  const selected = checkedIds
    .map(id => favList.find(f => f.id === id))
    .filter(Boolean)
    .slice(0, 5);

  if (selected.length < 2) {
    grid.innerHTML = '';
    show('compare-empty');
    const actionBar = document.getElementById('compare-action-bar');
    if (actionBar) actionBar.classList.add('hidden');
    return;
  }
  hide('compare-empty');

  grid.innerHTML = selected.map((f, i) => buildCompareCardHTML(f, i)).join('');

  // 操作列
  const actionBar = document.getElementById('compare-action-bar');
  if (actionBar) actionBar.classList.remove('hidden');
  const shareBtn = document.getElementById('btn-share-copy');
  if (shareBtn) {
    shareBtn.onclick = () => copyCompareSummary(selected);
  }

  // 比較卡的按鈕
  grid.querySelectorAll('[data-cmp-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const f = favList.find(x => x.id === id);
      if (!f) return;
      if (btn.dataset.cmpAction === 'pin') {
        openUrl(`https://www.google.com/maps?q=${f.lat},${f.lng}`);
      } else if (btn.dataset.cmpAction === 'link') {
        openUrl(f.url);
      }
    });
  });
}

function buildCompareCardHTML(f, idx) {
  const CK = ['supermarket','pharmacy','park','transit','hospital','restaurant','convenience','cafe'];
  const info = getCountryInfo(f.country);
  const flag = info ? info.flag : '🌍';
  const name = escHtml(f.name || f.url);
  const srcLabel = f.source ? (ui[`source_${f.source}`] || f.source) : '';
  const cl = f.checklist || {};
  const label = String.fromCharCode(65 + idx); // A, B, C, D, E

  const score = calcScore(f);
  const scoreHtml = score.confirmed > 0
    ? `<span class="compare-card-score">⭐ ${score.yes}/${score.total}</span>`
    : '';

  const confirmedKeys = CK.filter(key => cl[key] === true);
  const ckCells = confirmedKeys.map(key => {
    const icon = CHECKLIST_ICONS[key] || '?';
    const label = escHtml(ui[`checklist_${key}`] || key);
    return `<span class="cmp-ck-cell" title="${label}">${icon} <span class="cmp-ck-cell-label">${label}</span></span>`;
  }).join('');
  const ckSection = confirmedKeys.length
    ? `<div class="compare-card-checks">${ckCells}</div>`
    : '';

  return `
  <div class="compare-card">
    <div class="compare-card-header">
      <span class="compare-card-label">${label}</span>
      <span class="compare-card-flag">${flag}</span>
      <div class="compare-card-info">
        <div class="compare-card-name" title="${name}">${name}</div>
        <div class="compare-card-source">${srcLabel}</div>
      </div>
      ${scoreHtml}
      <button class="compare-card-pin" data-cmp-action="pin" data-id="${f.id}" title="Google Maps">📍</button>
      ${f.url ? `<button class="compare-card-pin" data-cmp-action="link" data-id="${f.id}" title="${escHtml(ui.fav_open_url || '原始頁面')}">🔗</button>` : ''}
    </div>
    ${ckSection}
  </div>`;
}

// ============================================================
// 複製比較結果到剪貼簿
// ============================================================
function copyCompareSummary(selected) {
  const CK = ['supermarket','pharmacy','park','transit','hospital','restaurant','convenience','cafe'];
  const date = new Date().toLocaleDateString(navigator.language || 'zh-TW');
  const lines = [];

  lines.push(`🏨 StayScope ${ui.compare_summary_title || '比較清單'} (${date})`);
  lines.push('');

  selected.forEach((f, i) => {
    const info = getCountryInfo(f.country);
    const flag = info ? info.flag : '🌍';
    const name = f.name || f.url;
    const srcLabel = f.source ? (ui[`source_${f.source}`] || f.source) : '';
    const label = String.fromCharCode(65 + i);
    lines.push(`${label}｜${flag} ${name}${srcLabel ? ` [${srcLabel}]` : ''}`);
    lines.push(`  📍 https://www.google.com/maps?q=${f.lat},${f.lng}`);

    const cl = f.checklist || {};
    const ckParts = CK
      .filter(key => cl[key] !== undefined)
      .map(key => (cl[key] ? '✅' : '❌') + (ui[`checklist_${key}`] || key));
    if (ckParts.length) lines.push(`  ${ckParts.join('  ')}`);
    if (f.tags?.length) lines.push(`  🏷 ${f.tags.join(', ')}`);
    if (f.notes?.trim()) lines.push(`  💬 ${f.notes.trim()}`);
    lines.push('');
  });

  const text = lines.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btn-share-copy');
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = ui.share_copied || '✅ 已複製！';
    setTimeout(() => { btn.textContent = original; }, 1800);
  }).catch(() => {
    alert(ui.share_copy_fail || '複製失敗，請手動複製');
  });
}
