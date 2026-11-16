/* =====================================================================
   COLDEST · NAV CLEANUP
   David 11/03: hide tabs the AD CHANNELS tab and the daily report have
   made redundant. Only the nav button is hidden — every module keeps
   rendering its panel and its data keeps flowing, so a tab comes back by
   deleting its key from HIDDEN. CSS (not DOM removal) so tabs that the ad
   modules insert after this script loads are hidden too, with no
   MutationObserver. If a deep link lands on a hidden tab, fall back to
   DAILY REPORTS.
   ===================================================================== */
(function (root) {
  'use strict';

  var HIDDEN = [
    'cmasm',          // CMASM TABLE
    'analytics',      // ANALYTICS
    'predictive',     // PREDICTIVE
    'scaling',        // SCALING
    'news',           // NEWS
    'chatgpt_ads',    // CHATGPT ADS (static tab in index.html)
    'meta_ads',       // paid_channels_module.js tabs ↓
    'google_ads',
    'bing_ads',
    'reddit_ads',
    'snapchat_ads',
    'pinterest_ads'
  ];
  var FALLBACK = 'reports';

  function css(keys) {
    return keys.map(function (k) { return '.tabs .tab[data-tab="' + k + '"]'; }).join(',\n') + '{display:none !important}';
  }

  function inject() {
    if (document.getElementById('nav-cleanup-style')) return;
    var s = document.createElement('style');
    s.id = 'nav-cleanup-style';
    s.textContent = css(HIDDEN);
    document.head.appendChild(s);
  }

  /* A hidden tab that is somehow active (deep link, stale state) would
     leave the page on an invisible tab; click DAILY REPORTS instead. */
  function settle() {
    var active = document.querySelector('.tabs .tab.active');
    if (!active || HIDDEN.indexOf(active.getAttribute('data-tab')) === -1) return;
    var fallback = document.querySelector('.tabs .tab[data-tab="' + FALLBACK + '"]');
    if (fallback) fallback.click();
  }

  function boot() {
    inject();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', settle);
    else settle();
    setTimeout(settle, 1500);
  }

  var api = { HIDDEN: HIDDEN, FALLBACK: FALLBACK, css: css };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NavCleanup = api;
  if (typeof document !== 'undefined') boot();
})(typeof window !== 'undefined' ? window : globalThis);
