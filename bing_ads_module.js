/* Bing channel wrapper — UI lives in paid_channels_module.js.
   Keeps the original BingAds test API. */
(function (root) {
  'use strict';
  var Paid = (typeof module !== 'undefined' && module.exports && typeof require === 'function')
    ? require('./paid_channels_module.js')
    : root.PaidChannels;
  var api = Paid.channelApi('bing');
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BingAds = api;
})(typeof window !== 'undefined' ? window : globalThis);
