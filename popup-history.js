// ============================================================
// StayScope — History Panel (P4)
// 依賴 popup.js 的全域狀態：ui
// ============================================================
'use strict';

let historyOpen = false;

function setHistoryLabels() {
  const toggleBtn = document.getElementById('btn-history-toggle');
  if (toggleBtn) {
    const span = toggleBtn.querySelector('span:first-child');
    if (span) span.textContent = ui.history_title || '🕒 最近瀏覽';
  }
  const clearBtn = document.getElementById('btn-clear-history');
  if (clearBtn) clearBtn.textContent = ui.history_clear || '🗑️ 清除歷史';
}

async function renderHistory() {
  const list = await getHistory();
  const countEl = document.getElementById('history-count');
  if (countEl) countEl.textContent = list.length;

  const container = document.getElementById('history-list');
  const footer    = document.getElementById('history-footer');
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="history-empty">${escHtml(ui.history_empty || '尚無瀏覽記錄')}</div>`;
    if (footer) footer.classList.add('hidden');
    return;
  }

  container.innerHTML = list.map(h => {
    const info = getCountryInfo(h.country);
    const flag = info ? info.flag : '🌍';
    const name = escHtml(h.name || h.url);
    const src  = h.source || '';
    const ago  = timeAgo(h.visitedAt);
    return `
    <div class="history-item" data-url="${escHtml(h.url)}" data-lat="${h.lat}" data-lng="${h.lng}" data-country="${h.country || ''}">
      <span class="history-flag">${flag}</span>
      <div class="history-info">
        <div class="history-name" title="${name}">${name}</div>
        <div class="history-meta">${src ? escHtml(src) + ' · ' : ''}${ago}</div>
      </div>
      ${h.url ? `<a class="history-link-btn" href="${escHtml(h.url)}" target="_blank" rel="noopener" title="${escHtml(ui.fav_open_url || '原始頁面')}">🔗</a>` : ''}
      <button class="history-map-btn" data-lat="${h.lat}" data-lng="${h.lng}" title="${escHtml(ui.pin_badge || '在地圖查看')}">📍</button>
    </div>`;
  }).join('');

  // 綁定地圖按鈕
  container.querySelectorAll('.history-map-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openUrl(`https://www.google.com/maps?q=${btn.dataset.lat},${btn.dataset.lng}`);
    });
  });

  if (footer) footer.classList.toggle('hidden', !historyOpen);
}

function setupHistoryToggle() {
  const btn = document.getElementById('btn-history-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    historyOpen = !historyOpen;
    const listEl   = document.getElementById('history-list');
    const footerEl = document.getElementById('history-footer');
    const arrow    = document.getElementById('history-arrow');
    listEl?.classList.toggle('hidden', !historyOpen);
    footerEl?.classList.toggle('hidden', !historyOpen);
    if (arrow) arrow.textContent = historyOpen ? '▼' : '▶';
  });

  on('btn-clear-history', async () => {
    await clearHistory();
    historyOpen = false;
    const listEl   = document.getElementById('history-list');
    const footerEl = document.getElementById('history-footer');
    const arrow    = document.getElementById('history-arrow');
    listEl?.classList.add('hidden');
    footerEl?.classList.add('hidden');
    if (arrow) arrow.textContent = '▶';
    await renderHistory();
  });
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min  = Math.floor(diff / 60000);
  if (min < 1)  return ui.time_just_now || '剛剛';
  if (min < 60) return (ui.time_min_ago || '{n} 分鐘前').replace('{n}', min);
  const hr = Math.floor(min / 60);
  if (hr < 24)  return (ui.time_hr_ago || '{n} 小時前').replace('{n}', hr);
  const day = Math.floor(hr / 24);
  if (day < 7)  return (ui.time_day_ago || '{n} 天前').replace('{n}', day);
  return new Date(ts).toLocaleDateString();
}
