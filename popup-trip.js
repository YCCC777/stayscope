// ============================================================
// StayScope — Trip Type & Radius (P3)
// 依賴 popup.js 的全域狀態：activeTripType, currentRadius, coords
// ============================================================
'use strict';

const TRIP_PRESETS = {
  backpacker: ['supermarket','pharmacy','transit','cafe'],
  family:     ['supermarket','pharmacy','park','hospital'],
  couple:     ['restaurant','cafe','park','convenience'],
  business:   ['transit','airport','convenience','cafe'],
  senior:     ['hospital','pharmacy','park','supermarket'],
  custom:     null,  // null = 顯示全部 8 顆 + 套餐
};

function setupTripTypePills() {
  document.querySelectorAll('.trip-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.trip === activeTripType);
    btn.addEventListener('click', () => {
      activeTripType = btn.dataset.trip;
      chrome.storage.local.set({ ss_trip_type: activeTripType });
      document.querySelectorAll('.trip-pill').forEach(p =>
        p.classList.toggle('active', p.dataset.trip === activeTripType)
      );
      if (coords) applyTripTypeUI();
    });
  });
}

function updateTripPillLabels() {
  const map = {
    backpacker: ui.trip_backpacker,
    family:     ui.trip_family,
    couple:     ui.trip_couple,
    business:   ui.trip_business,
    senior:     ui.trip_senior,
    custom:     ui.trip_custom,
  };
  document.querySelectorAll('.trip-pill').forEach(btn => {
    const t = btn.dataset.trip;
    if (map[t]) {
      btn.textContent = map[t];
      btn.title = map[t].replace(/^[\p{Emoji}\s]+/u, '').trim();
    }
  });
}

function applyTripTypeUI() {
  const preset = TRIP_PRESETS[activeTripType];
  const bundleSection = document.getElementById('section-bundle');
  const catGrid = document.getElementById('cat-grid');
  if (!catGrid) return;

  if (!preset) {
    // custom: 顯示全部 8 顆 + 套餐
    if (bundleSection) bundleSection.style.display = '';
    catGrid.querySelectorAll('.btn-cat').forEach(b => b.style.display = '');
    return;
  }

  // 非 custom: 隱藏套餐，只顯示對應的 4 顆
  if (bundleSection) bundleSection.style.display = 'none';
  catGrid.querySelectorAll('.btn-cat').forEach(btn => {
    const key = btn.dataset.key;
    btn.style.display = preset.includes(key) ? '' : 'none';
  });
}

function setupRadiusSelect() {
  const sel = document.getElementById('select-radius');
  if (!sel) return;
  sel.value = String(currentRadius);
  sel.addEventListener('change', () => {
    currentRadius = parseInt(sel.value) || 15;
    chrome.storage.local.set({ ss_radius: String(currentRadius) });
  });
}
