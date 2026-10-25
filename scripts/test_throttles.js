'use strict';

var assert = require('assert');
var Throttles = require('../throttles_module.js');
var settings = require('../ads_throttle/settings.json');
var series = require('../ads_throttle/series.json');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) {
    failed += 1;
    console.error('FAIL - ' + name);
    console.error('     ' + (e && e.stack ? e.stack : e));
  }
}

test('live settings match the attached ads_throttle contract', function () {
  assert.strictEqual(settings.global.roas_threshold, 3.0);
  assert.strictEqual(settings.global.step_pct, 20);
  assert.strictEqual(settings.global.window_days, 7);
  assert.strictEqual(settings.global.min_spend_7d, 200);
  assert.strictEqual(settings.global.scale_cooldown_days, 7);
  assert.strictEqual(settings.global.cut_cooldown_days, 3);
  assert.strictEqual(settings.global.revenue_scope, 'shopify_d2c');
  assert.strictEqual(settings.channels.meta.mode, 'frozen');
  assert.strictEqual(settings.channels.google.mode, 'view');
  assert.strictEqual(settings.channels.tiktok.mode, 'view');
  assert.strictEqual(settings.channels.bing.mode, 'auto');
  assert.strictEqual(settings.channels.reddit.mode, 'auto');
  assert.strictEqual(settings.mode_legend.auto, 'daily rule applies');
});

test('28-day series ends on 2026-10-24 with published totals', function () {
  assert.strictEqual(series.window_days, 28);
  assert.strictEqual(series.days.length, 28);
  assert.strictEqual(series.days[0].date, '2026-09-27');
  var last = series.days[series.days.length - 1];
  assert.strictEqual(last.date, '2026-10-24');
  assert.strictEqual(last.d2c_ad_spend, 14382.78);
  assert.strictEqual(last.blended_mer, 1.84);
  assert.strictEqual(last.total_ad_spend, 21678.86);
  assert.strictEqual(last.shopify_d2c_revenue, 26598.51);
  assert.strictEqual(last.channels.bing.spend, 77.33);
  assert.strictEqual(last.channels.bing.d2c, 0.97);
  assert.strictEqual(last.channels.bing.amazon, 76.36);
});

test('frozen / view / hold never recommend a budget change', function () {
  var frozen = Throttles.recommend('meta', settings, series, { entries: [] });
  assert.strictEqual(frozen.action, 'none');
  assert.strictEqual(frozen.label, 'Frozen');
  var view = Throttles.recommend('google', settings, series, { entries: [] });
  assert.strictEqual(view.action, 'none');
  var holdSettings = JSON.parse(JSON.stringify(settings));
  holdSettings.channels.reddit.mode = 'hold';
  var hold = Throttles.recommend('reddit', holdSettings, series, { entries: [] });
  assert.strictEqual(hold.action, 'hold');
});

test('auto channel below min_spend_7d holds', function () {
  var r = Throttles.recommend('bing', settings, series, { entries: [] });
  assert.strictEqual(r.mode, 'auto');
  assert.strictEqual(r.action, 'hold');
  assert.ok(r.spend7 < settings.global.min_spend_7d);
});

test('what-if auto + low threshold scales; high threshold cuts', function () {
  var sample = {
    days: [
      { date: '2026-10-18', d2c_ad_spend: 1000, shopify_d2c_revenue: 4000, total_ad_spend: 1000, blended_mer: 4, channels: { reddit: { spend: 200 } } },
      { date: '2026-10-19', d2c_ad_spend: 1000, shopify_d2c_revenue: 4000, total_ad_spend: 1000, blended_mer: 4, channels: { reddit: { spend: 200 } } },
      { date: '2026-10-20', d2c_ad_spend: 1000, shopify_d2c_revenue: 4000, total_ad_spend: 1000, blended_mer: 4, channels: { reddit: { spend: 200 } } },
      { date: '2026-10-21', d2c_ad_spend: 1000, shopify_d2c_revenue: 4000, total_ad_spend: 1000, blended_mer: 4, channels: { reddit: { spend: 200 } } },
      { date: '2026-10-22', d2c_ad_spend: 1000, shopify_d2c_revenue: 4000, total_ad_spend: 1000, blended_mer: 4, channels: { reddit: { spend: 200 } } },
      { date: '2026-10-23', d2c_ad_spend: 1000, shopify_d2c_revenue: 4000, total_ad_spend: 1000, blended_mer: 4, channels: { reddit: { spend: 200 } } },
      { date: '2026-10-24', d2c_ad_spend: 1000, shopify_d2c_revenue: 4000, total_ad_spend: 1000, blended_mer: 4, channels: { reddit: { spend: 200 } } }
    ]
  };
  var live = JSON.parse(JSON.stringify(settings));
  var scaled = Throttles.recommend('reddit', live, sample, { entries: [] });
  assert.strictEqual(scaled.action, 'scale');
  assert.strictEqual(scaled.recommended, 240);

  var cutSet = Throttles.mergeSettings(live, { global: { roas_threshold: 9 } });
  var cut = Throttles.recommend('reddit', cutSet, sample, { entries: [] });
  assert.strictEqual(cut.action, 'cut');
  assert.strictEqual(cut.recommended, 160);
  assert.strictEqual(live.global.roas_threshold, 3.0);
});

test('Request change link targets the data repo issues form', function () {
  var url = Throttles.requestChangeUrl(settings);
  assert.ok(url.indexOf('https://github.com/davidstarkk/coldest-cfo-dashboard/issues/new') === 0);
  assert.ok(url.indexOf('title=') !== -1);
  assert.ok(url.indexOf('roas_threshold') !== -1);
});

if (failed) {
  console.error('\n' + failed + ' throttle test(s) failed');
  process.exit(1);
}
console.log('\nAll throttle tests passed');
