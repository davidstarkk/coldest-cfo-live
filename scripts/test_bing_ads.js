'use strict';

var assert = require('assert');
var BingAds = require('../bing_ads_module.js');

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function sampleReport() {
  return {
    date: '2026-10-24',
    total_revenue: 48795.5,
    total_ad_spend: 21601.53,
    blended_ad_spend: 21601.53,
    blended_ad_pct: 44.3,
    mer: 2.26,
    blended_mer: 2.26,
    net_profit: -3689.89,
    net_margin_pct: -7.56,
    contribution_profit: 1200,
    shop_ad_spend: 11521.87,
    shop_mer: 1.5,
    shop_net_profit: 100
  };
}

function samplePartial() {
  return {
    date: '2026-10-24',
    advertising_sources: {
      meta: { spend: '11521.87', complete: true },
      applovin: { spend: 0, complete: true },
      google_ads: { spend: '1951.18', complete: true, closed_day: true },
      tiktok_ads: { spend: '5116.47', complete: false }
    },
    provisional_totals: {
      revenue: 48795.5,
      ads: 21601.53,
      net_profit: -3689.89,
      mer: 2.25889,
      net_margin_pct: -7.56
    }
  };
}

var failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('ok  - ' + name);
  } catch (e) {
    failed += 1;
    console.error('FAIL - ' + name);
    console.error('     ' + (e && e.stack ? e.stack : e));
  }
}

test('empty feed latest day is $0', function () {
  BingAds._setFeeds({ status: 'pre_launch', daily: [] }, { as_of: '2026-09-27' }, null);
  var days = BingAds.mergeDays();
  var day = BingAds.latestDay(days);
  assert.strictEqual(day.spend, 0);
  assert.strictEqual(day.clicks, 0);
  assert.strictEqual(day.conversions, 0);
  assert.strictEqual(day.revenue, 0);
  assert.ok(day.roas == null || day.roas === 0);
});

test('mer_for_manus.json bing block is consumed', function () {
  BingAds._setFeeds(null, {
    bing: {
      as_of: '2026-10-24',
      status: 'ok',
      spend: 1000,
      clicks: 80,
      conversions: 12,
      revenue: 2400
    }
  }, null);
  var day = BingAds.snapshotFromBlock({
    as_of: '2026-10-24', status: 'ok', spend: 1000, clicks: 80, conversions: 12, revenue: 2400
  }, 'mer');
  assert.strictEqual(day.spend, 1000);
  assert.strictEqual(day.clicks, 80);
  assert.strictEqual(day.conversions, 12);
  assert.strictEqual(day.revenue, 2400);
  assert.ok(Math.abs(day.roas - 2.4) < 0.001);
});

test('string spend from advertising_sources parses like Google', function () {
  var day = BingAds.nodeToDay('2026-10-24', { spend: '1951.18', complete: true }, 'advertising_sources.google_ads');
  assert.strictEqual(day.spend, 1951.18);
});

test('pickSourceNode accepts bing aliases', function () {
  assert.strictEqual(BingAds.pickSourceNode({ google_ads: { spend: 1 } }), null);
  assert.strictEqual(BingAds.pickSourceNode({ bing: { spend: 2 } }).key, 'bing');
  assert.strictEqual(BingAds.pickSourceNode({ bing_ads: { spend: 2 } }).key, 'bing_ads');
  assert.strictEqual(BingAds.pickSourceNode({ microsoft_ads: { spend: 2 } }).key, 'microsoft_ads');
});

test('$0 Bing leaves REPORTS totals unchanged', function () {
  var r = sampleReport();
  var before = clone(r);
  global.REPORTS = [r];
  BingAds.applyReportTotals({});
  assert.strictEqual(r.total_ad_spend, before.total_ad_spend);
  assert.strictEqual(r.blended_ad_spend, before.blended_ad_spend);
  assert.strictEqual(r.mer, before.mer);
  assert.strictEqual(r.net_profit, before.net_profit);
  assert.strictEqual(r.shop_ad_spend, before.shop_ad_spend);
  assert.strictEqual(r.shop_net_profit, before.shop_net_profit);
  assert.strictEqual(r.bing_ad_spend, 0);
  delete global.REPORTS;
});

test('$0 Bing leaves PARTIAL provisional totals unchanged', function () {
  var p = samplePartial();
  var before = clone(p.provisional_totals);
  global.PARTIAL_REPORTS = [p];
  BingAds.ensureBingOnPartials({});
  BingAds.applyPartialTotals({});
  assert.strictEqual(p.provisional_totals.ads, before.ads);
  assert.strictEqual(p.provisional_totals.net_profit, before.net_profit);
  assert.strictEqual(p.provisional_totals.mer, before.mer);
  assert.ok(p.advertising_sources.bing);
  assert.strictEqual(Number(p.advertising_sources.bing.spend), 0);
  assert.strictEqual(p.advertising_sources.google_ads.spend, '1951.18');
  assert.strictEqual(p.advertising_sources.meta.spend, '11521.87');
  delete global.PARTIAL_REPORTS;
});

test('positive Bing overlays company paid spend and profit, not Meta', function () {
  var r = sampleReport();
  global.REPORTS = [r];
  BingAds.applyReportTotals({
    '2026-10-24': { spend: 1000, clicks: 10, conversions: 2, revenue: 500 }
  });
  assert.strictEqual(r.bing_ad_spend, 1000);
  assert.strictEqual(r.total_ad_spend, 22601.53);
  assert.strictEqual(r.blended_ad_spend, 22601.53);
  assert.strictEqual(r.net_profit, -4689.89);
  assert.strictEqual(r.shop_ad_spend, 11521.87);
  assert.ok(Math.abs(r.mer - (48795.5 / 22601.53)) < 0.015);
  delete global.REPORTS;
});

test('pipeline Bing is not double-counted in provisional totals', function () {
  var p = samplePartial();
  p.advertising_sources.bing = { spend: '400.00', complete: true };
  var before = clone(p.provisional_totals);
  global.PARTIAL_REPORTS = [p];
  BingAds.ensureBingOnPartials({
    '2026-10-24': { spend: 400, clicks: 0, conversions: 0, revenue: 0 }
  });
  BingAds.applyPartialTotals({
    '2026-10-24': { spend: 400, clicks: 0, conversions: 0, revenue: 0 }
  });
  assert.strictEqual(p.provisional_totals.ads, before.ads);
  assert.strictEqual(p.provisional_totals.net_profit, before.net_profit);
  delete global.PARTIAL_REPORTS;
});

test('feed Bing without pipeline key is added to provisional paid spend', function () {
  var p = samplePartial();
  var before = clone(p.provisional_totals);
  global.PARTIAL_REPORTS = [p];
  BingAds.ensureBingOnPartials({
    '2026-10-24': { spend: 250, clicks: 4, conversions: 1, revenue: 80 }
  });
  BingAds.applyPartialTotals({
    '2026-10-24': { spend: 250, clicks: 4, conversions: 1, revenue: 80 }
  });
  assert.strictEqual(p.provisional_totals.ads, before.ads + 250);
  assert.strictEqual(p.provisional_totals.net_profit, before.net_profit - 250);
  assert.strictEqual(p.advertising_sources.google_ads.spend, '1951.18');
  delete global.PARTIAL_REPORTS;
});

test('overlay is idempotent', function () {
  var r = sampleReport();
  global.REPORTS = [r];
  var days = { '2026-10-24': { spend: 100 } };
  BingAds.applyReportTotals(days);
  BingAds.applyReportTotals(days);
  assert.strictEqual(r.total_ad_spend, 21701.53);
  assert.strictEqual(r._ba_bing_applied, 100);
  delete global.REPORTS;
});

if (failed) {
  console.error('\n' + failed + ' test(s) failed');
  process.exit(1);
}
console.log('\nAll Bing Ads tests passed');
