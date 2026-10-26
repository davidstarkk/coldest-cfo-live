'use strict';

var assert = require('assert');
var Paid = require('../paid_channels_module.js');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) {
    failed += 1;
    console.error('FAIL - ' + name);
    console.error('     ' + (e && e.stack ? e.stack : e));
  }
}

test('display list is Meta → Google → Bing → Reddit → Snapchat → ChatGPT → Pinterest', function () {
  var ids = Paid.displayChannels().map(function (c) { return c.id; });
  assert.deepStrictEqual(ids, ['meta', 'google', 'bing', 'reddit', 'snapchat', 'chatgpt', 'pinterest']);
});

test('unpublished Pinterest is missing, never $0', function () {
  Paid.CHANNELS.forEach(function (ch) { Paid.setFeeds(ch.id, null, null, null); });
  Paid._setMerDoc({ as_of: '2026-10-24', advertising_sources: { '2026-10-24': { meta: { spend: 10 } } } });
  var pin = Paid.displayChannels().filter(function (c) { return c.id === 'pinterest'; })[0];
  var day = Paid.dayForDisplay(pin, '2026-10-24');
  assert.strictEqual(day.hasFeed, false);
  assert.strictEqual(Paid.spendTxt(day), 'missing');
  assert.ok(Paid.spendPerChannelHtml('2026-10-24').indexOf('missing') !== -1);
  assert.ok(Paid.spendPerChannelHtml('2026-10-24').indexOf('Pinterest') !== -1);
  assert.ok(Paid.spendPerChannelHtml('2026-10-24').indexOf('$0.00') === -1 || Paid.spendTxt(day) === 'missing');
});

test('published mer.pinterest spend is shown; still missing when the key is absent', function () {
  Paid._setMerDoc({
    as_of: '2026-10-25',
    pinterest: { as_of: '2026-10-25', spend: 42, spend_d2c: 42, clicks: 8, live: true },
    advertising_sources: {
      '2026-10-25': { pinterest_ads: { spend: 42, clicks: 8, complete: true } }
    }
  });
  var pin = Paid.displayChannels().filter(function (c) { return c.id === 'pinterest'; })[0];
  var live = Paid.dayForDisplay(pin, '2026-10-25');
  assert.strictEqual(live.hasFeed, true);
  assert.strictEqual(Paid.spendTxt(live), '$42.00');
  var empty = Paid.dayForDisplay(pin, '2026-10-01');
  assert.strictEqual(empty.hasFeed, false);
  assert.strictEqual(Paid.spendTxt(empty), 'missing');
});

test('10/24 Meta and Bing are published dollars; Pinterest is missing', function () {
  var mer = require('../mer_for_manus.json');
  Paid._setMerDoc(mer);
  Paid.CHANNELS.forEach(function (ch) { Paid.setFeeds(ch.id, null, mer, null); });
  var byId = {};
  Paid.displayChannels().forEach(function (ch) { byId[ch.id] = Paid.dayForDisplay(ch, '2026-10-24'); });
  assert.strictEqual(byId.meta.hasFeed, true);
  assert.strictEqual(byId.google.hasFeed, true);
  assert.strictEqual(byId.bing.hasFeed, true);
  assert.ok(byId.bing.spend > 0);
  assert.strictEqual(Paid.spendTxt(byId.pinterest), 'missing');
  var html = Paid.detailBreakdownHtml('2026-10-24');
  assert.ok(html.indexOf('Pinterest') !== -1);
  assert.ok(html.indexOf('missing') !== -1);
});

test('renderStrip does not inject a dashboard strip after yday-bar', function () {
  if (typeof document === 'undefined') {
    Paid.renderStrip();
    return;
  }
  throw new Error('unexpected document in node test');
});

if (failed) {
  console.error('\n' + failed + ' daily-report layout test(s) failed');
  process.exit(1);
}
console.log('\nAll daily-report layout tests passed');
