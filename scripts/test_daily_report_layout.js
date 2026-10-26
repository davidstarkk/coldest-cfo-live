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

test('display list is Meta → Google → Bing → Reddit → Snapchat → ChatGPT → Pinterest → AppLovin', function () {
  var ids = Paid.displayChannels().map(function (c) { return c.id; });
  assert.deepStrictEqual(ids, ['meta', 'google', 'bing', 'reddit', 'snapchat', 'chatgpt', 'pinterest', 'applovin']);
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

test('10/24 Meta and Bing are published dollars; Pinterest is missing; AppLovin is $0', function () {
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
  assert.strictEqual(byId.applovin.hasFeed, true);
  assert.strictEqual(Paid.spendTxt(byId.applovin), '$0.00');
  var html = Paid.detailBreakdownHtml('2026-10-24');
  assert.ok(html.indexOf('Pinterest') !== -1);
  assert.ok(html.indexOf('AppLovin') !== -1);
  assert.ok(html.indexOf('missing') !== -1);
  assert.ok(html.indexOf('platform-reported, click-based') !== -1);
});

test('AppLovin missing stays missing; published $0 stays $0; ROAS label is click-based', function () {
  Paid.CHANNELS.forEach(function (ch) { Paid.setFeeds(ch.id, null, null, null); });
  Paid._setMerDoc({
    as_of: '2026-10-24',
    advertising_sources: {
      '2026-10-24': { meta: { spend: 10 }, applovin: { spend: 0, clicks: 0, conversions: 0, revenue: 0, complete: true } }
    }
  });
  var al = Paid.displayChannels().filter(function (c) { return c.id === 'applovin'; })[0];
  assert.strictEqual(al.roasLabel, 'platform-reported, click-based');
  var zero = Paid.dayForDisplay(al, '2026-10-24');
  assert.strictEqual(zero.hasFeed, true);
  assert.strictEqual(Paid.spendTxt(zero), '$0.00');
  assert.strictEqual(Paid.roasDisplay(zero, al), '— · platform-reported, click-based');
  var miss = Paid.dayForDisplay(al, '2026-10-01');
  assert.strictEqual(miss.hasFeed, false);
  assert.strictEqual(Paid.spendTxt(miss), 'missing');
  assert.strictEqual(Paid.roasDisplay(miss, al), 'missing');
  var spendHtml = Paid.spendPerChannelHtml('2026-10-24');
  assert.ok(spendHtml.indexOf('AppLovin') !== -1);
  assert.ok(spendHtml.indexOf('$0.00') !== -1);
  Paid._setMerDoc({
    as_of: '2026-10-25',
    channel_ad_spend: { applovin: 12.5 }
  });
  var cas = Paid.dayForDisplay(al, '2026-10-25');
  assert.strictEqual(Paid.spendTxt(cas), '$12.50');
});

test('renderStrip does not inject a dashboard strip after yday-bar', function () {
  if (typeof document === 'undefined') {
    Paid.renderStrip();
    return;
  }
  throw new Error('unexpected document in node test');
});

test('channel_revenue on the PARTIAL row is preferred and unpublished stays missing', function () {
  var rows = Paid.channelRevenueRows({
    date: '2026-10-25',
    channel_revenue: { shopify: 1111.1, amazon: { revenue: 2222.2 }, tiktok: null },
    channel_observations: { shopify: { revenue: 9, data_available: true } }
  });
  var by = {};
  rows.forEach(function (r) { by[r.label] = r.value; });
  assert.strictEqual(by.Shopify, '$1,111.10');
  assert.strictEqual(by.Amazon, '$2,222.20');
  assert.strictEqual(by.TikTok, 'missing');
  assert.strictEqual(by.Whatnot, 'missing');
});

test('channel_ad_spend on the PARTIAL row wins; absent keys fall through; null is missing', function () {
  globalThis.PARTIAL_REPORTS = [{
    date: '2026-10-25',
    channel_ad_spend: { meta: 50, google: { spend: 0 }, bing: null }
  }];
  Paid._setMerDoc({
    as_of: '2026-10-25',
    advertising_sources: {
      '2026-10-25': { meta: { spend: 9 }, google: { spend: 9 }, bing: { spend: 9 }, reddit: { spend: 3 } }
    }
  });
  var byId = {};
  Paid.displayChannels().forEach(function (ch) { byId[ch.id] = Paid.dayForDisplay(ch, '2026-10-25'); });
  assert.strictEqual(Paid.spendTxt(byId.meta), '$50.00');
  assert.strictEqual(Paid.spendTxt(byId.google), '$0.00');
  assert.strictEqual(Paid.spendTxt(byId.bing), 'missing');
  assert.strictEqual(Paid.spendTxt(byId.reddit), '$3.00');
  assert.strictEqual(Paid.spendTxt(byId.pinterest), 'missing');
  assert.strictEqual(Paid.spendTxt(byId.applovin), 'missing');
  delete globalThis.PARTIAL_REPORTS;
});

test('scalar channel_ad_spend keeps mer clicks and Bing D2C split', function () {
  globalThis.PARTIAL_REPORTS = [{
    date: '2026-10-25',
    channel_ad_spend: { bing: 130.3 }
  }];
  Paid._setMerDoc({
    as_of: '2026-10-25',
    advertising_sources: {
      '2026-10-25': {
        bing_ads: { spend: 130.3, clicks: 243, spend_d2c: 60.56, spend_amazon: 69.74, destination: 'mixed' }
      }
    }
  });
  var bing = Paid.dayForDisplay({
    id: 'bing',
    merKey: 'bing',
    sourceKeys: ['bing', 'bing_ads', 'microsoft_ads']
  }, '2026-10-25');
  assert.strictEqual(Paid.spendTxt(bing), '$130.30');
  assert.strictEqual(bing.hasClicks, true);
  assert.strictEqual(bing.clicks, 243);
  assert.strictEqual(bing.d2c, 60.56);
  assert.strictEqual(bing.amazon, 69.74);
  delete globalThis.PARTIAL_REPORTS;
});

test('hydratePartialFromMer adds a 10/25 card from mer.as_of without inventing spend', function () {
  globalThis.PARTIAL_REPORTS = [{ date: '2026-10-24', channel_observations: {} }];
  var mer = {
    as_of: '2026-10-25',
    shop_revenue: 26420.44,
    channel_revenue: { shopify: 26420.44, amazon: 100, tiktok: null, whatnot: 0 },
    channel_ad_spend: { meta: 10, pinterest: null },
    advertising_sources: { '2026-10-25': { google_ads: { spend: 4 } } }
  };
  assert.strictEqual(Paid.hydratePartialFromMer(mer), true);
  var row = globalThis.PARTIAL_REPORTS.filter(function (r) { return r.date === '2026-10-25'; })[0];
  assert.ok(row);
  assert.deepStrictEqual(Paid.channelRevenueRows(row).map(function (x) { return x.value; }), [
    '$26,420.44', '$100.00', 'missing', '$0.00'
  ]);
  Paid._setMerDoc(mer);
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay({ id: 'meta', sourceKeys: ['meta'], merKey: 'meta' }, '2026-10-25')), '$10.00');
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay({ id: 'pinterest', sourceKeys: ['pinterest_ads', 'pinterest'], merKey: 'pinterest' }, '2026-10-25')), 'missing');
  delete globalThis.PARTIAL_REPORTS;
});

if (failed) {
  console.error('\n' + failed + ' daily-report layout test(s) failed');
  process.exit(1);
}
console.log('\nAll daily-report layout tests passed');
