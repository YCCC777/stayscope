// ============================================================
// StayScope — donate.js  (i18n for donate page)
// ============================================================
'use strict';

(async function () {
  const storedLang = await new Promise(r =>
    chrome.storage.local.get('ss_lang', res => r(res['ss_lang'] || null))
  );
  const ui = getUiStrings(storedLang || navigator.language || 'zh-TW');

  const t = (id, key) => {
    const el = document.getElementById(id);
    if (el && ui[key]) el.textContent = ui[key];
  };

  t('d-tagline-text',  'donate_tagline');
  t('d-features',      'donate_features');
  t('d-feat-detect',   'donate_feat_detect');
  t('d-feat-keyword',  'donate_feat_keyword');
  t('d-feat-fav',      'donate_feat_fav');
  t('d-feat-trip',     'donate_feat_trip');
  t('d-feat-lang',     'donate_feat_lang');
  t('d-feat-transport','donate_feat_transport');
  t('d-usage-title',   'donate_usage_title');
  t('d-usage-1',       'donate_usage_1');
  t('d-usage-2',       'donate_usage_2');
  t('d-usage-3',       'donate_usage_3');
  t('d-usage-4',       'donate_usage_4');
  t('d-feedback-btn',  'donate_feedback_btn');
  t('d-about',         'donate_about');
  // donate_about_text 有換行，需用 innerHTML 處理
  const aboutTextEl = document.getElementById('d-about-text');
  if (aboutTextEl && ui.donate_about_text) {
    aboutTextEl.textContent = '';
    ui.donate_about_text.split('\n').forEach((line, i, arr) => {
      aboutTextEl.appendChild(document.createTextNode(line));
      if (i < arr.length - 1) aboutTextEl.appendChild(document.createElement('br'));
    });
  }
  t('d-about-badge',   'donate_about_badge');
  t('d-changelog',     'donate_changelog');
  t('d-support',       'donate_support');
  t('d-jkopay-label',  'donate_jkopay');
  t('d-jkopay-link',   'donate_scan_qr');

  const descEl = document.getElementById('d-desc');
  if (descEl && ui.donate_desc) {
    descEl.textContent = '';
    ui.donate_desc.split('\n').forEach((line, i, arr) => {
      descEl.appendChild(document.createTextNode(line));
      if (i < arr.length - 1) descEl.appendChild(document.createElement('br'));
    });
  }

  const closeBtn = document.getElementById('btn-close');
  if (closeBtn) {
    closeBtn.textContent = ui.donate_close || 'Close';
    closeBtn.addEventListener('click', () => window.close());
  }
})();
