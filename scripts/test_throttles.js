'use strict';

var assert = require('assert');
var Throttles = require('../throttles_module.js');
var settings = require('../ads_throttle/settings.json');
var series = require('../ads_throttle/series.json');
var throttleSettings = require('../throttle_settings.json');
var snapshot = require('../ad_channel_throttles.json');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) {
    failed += 1;
    console.error('FAIL - ' + name);
    console.error('     ' + (e && e.stack ? e.stack : e));
  }
}

test('live settings match ads_throttle/settings.json (roas_basis platform)', function () {
  assert.strictEqual(settings.global.roas_threshold, 3.0);
  assert.strictEqual(settings.global.step_pct, 20);
  assert.strictEqual(settings.global.window_days, 7);
  assert.strictEqual(settings.global.min_spend_7d, 200);
  assert.strictEqual(settings.global.scale_cooldown_days, 7);
  assert.strictEqual(settings.global.cut_cooldown_days, 3);
  assert.strictEqual(settings.global.revenue_scope, 'shopify_d2c');
  assert.strictEqual(settings.global.roas_basis, 'platform');
  assert.strictEqual(settings.channels.meta.mode, 'frozen');
  assert.strictEqual(settings.channels.google.mode, 'view');
  assert.strictEqual(settings.channels.tiktok.mode, 'view');
  assert.strictEqual(settings.channels.bing.mode, 'auto');
  assert.strictEqual(settings.mode_legend.auto, 'daily rule applies');
});

test('ad_channel_throttles fixture matches PR #14 keys and 10/24 values', function () {
  assert.strictEqual(snapshot.as_of, '2026-10-24');
  assert.strictEqual(snapshot.d2c_ad_spend, 14382.78);
  assert.strictEqual(snapshot.total_ad_spend, 21678.86);
  assert.strictEqual(snapshot.shopify_d2c_revenue, 26420.44);
  assert.strictEqual(snapshot.blended_mer, 1.84);
  assert.strictEqual(snapshot.blended_mer_vs_threshold, -1.16);
  assert.strictEqual(snapshot.throttle_settings.roas_basis, 'platform');
  assert.ok(snapshot.series_28d.by_channel.bing.length === 28);
  assert.ok(snapshot.series_28d.blended.length === 28);
  assert.ok(Array.isArray(snapshot.recent_changes));
  assert.strictEqual(snapshot.channels.meta.spend_7d, 83995.42);
  assert.strictEqual(snapshot.channels.bing.spend_7d, 521.09);
  assert.strictEqual(snapshot.channels.bing.destination_split.shopify, 8.73);
  assert.strictEqual(snapshot.channels.bing.destination_split.amazon, 512.36);
  assert.strictEqual(snapshot.channels.bing.platform_roas_7d, 0);
  assert.strictEqual(snapshot.channels.bing.roas_basis, 'platform');
  assert.strictEqual(snapshot.channels.bing.rule_status, 'Cut -20% + new strategy');
  assert.strictEqual(snapshot.channels.meta.rule_status, 'Frozen - view only');
  var last = snapshot.series_28d.blended[snapshot.series_28d.blended.length - 1];
  assert.strictEqual(last.shopify_revenue, 26420.44);
  assert.strictEqual(last.d2c_ad_spend, 14382.78);
  assert.strictEqual(last.total_ad_spend, 21678.86);
});

test('throttle_settings aliases normalize to global keys', function () {
  var norm = Throttles.normalizeSettings(throttleSettings);
  assert.strictEqual(norm.global.roas_threshold, 3.0);
  assert.strictEqual(norm.global.min_spend_7d, 200);
  assert.strictEqual(norm.global.step_pct, 20);
  assert.strictEqual(norm.global.roas_basis, 'platform');
});

test('frozen / view never recommend a budget change', function () {
  Throttles._setLive(settings, series, [], null);
  var frozen = Throttles.recommend('meta', settings, series, []);
  assert.strictEqual(frozen.action, 'none');
  assert.ok(frozen.label.indexOf('Frozen') === 0);
  var view = Throttles.recommend('google', settings, series, []);
  assert.strictEqual(view.label, 'View only');
  var tiktok = Throttles.recommend('tiktok', settings, series, []);
  assert.strictEqual(tiktok.label, 'View only');
});

test('published Bing rule is Cut on platform ROAS; 7d spend 521.09', function () {
  Throttles._setLive(settings, series, [], snapshot);
  var r = Throttles.recommend('bing', settings, series, []);
  assert.strictEqual(r.spend7, 521.09);
  assert.strictEqual(r.label, 'Cut -20% + new strategy');
  assert.strictEqual(r.action, 'cut');
  assert.strictEqual(r.roas_basis, 'platform');
  assert.strictEqual(r.roas, 0);
  assert.notStrictEqual(r.action, 'pause');
});

test('auto channel below min_spend_7d is Not enough data', function () {
  Throttles._setLive(settings, series, [], snapshot);
  var r = Throttles.recommend('reddit', settings, series, []);
  assert.strictEqual(r.mode, 'auto');
  assert.strictEqual(r.label, 'Not enough data');
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
  Throttles._setLive(live, sample, [], null);
  var scaled = Throttles.recommend('reddit', live, sample, []);
  assert.strictEqual(scaled.action, 'scale');
  assert.strictEqual(scaled.label, 'Scale +20%');
  assert.strictEqual(scaled.recommended, 240);

  var cutSet = Throttles.mergeSettings(live, { global: { roas_threshold: 9 } });
  Throttles._setLive(cutSet, sample, [], null);
  // what-if path: mergeSettings already applied; recommend uses computed rules
  var cut = Throttles.recommend('reddit', cutSet, sample, []);
  assert.strictEqual(cut.action, 'cut');
  assert.strictEqual(cut.label, 'Cut -20% + new strategy');
  assert.strictEqual(cut.recommended, 160);
  assert.notStrictEqual(cut.action, 'pause');
  assert.strictEqual(live.global.roas_threshold, 3.0);
});

test('cut cooldown since last change holds; scale cooldown is since last scale', function () {
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
  Throttles._setLive(live, sample, [], null);
  var yesterday = new Date(Date.now() - 86400000).toISOString();
  var cutSet = Throttles.mergeSettings(live, { global: { roas_threshold: 9 } });
  var held = Throttles.recommend('reddit', cutSet, sample, [{ channel: 'reddit', action: 'cut', at: yesterday }]);
  assert.strictEqual(held.action, 'hold');
  assert.strictEqual(held.label, 'Hold-cooldown');
});

test('missing tracking_health is unknown — never invented; published rules stay', function () {
  Throttles._setLive(settings, series, [], snapshot, null);
  var h = Throttles.channelHealth('bing');
  assert.strictEqual(h.status, 'unknown');
  assert.strictEqual(h.purchases_24h, null);
  assert.strictEqual(Throttles.healthStatus(null), 'unknown');
  assert.strictEqual(Throttles.healthStatus(''), 'unknown');
  assert.strictEqual(Throttles.healthStatus('maybe'), 'unknown');
  var r = Throttles.recommend('bing', settings, series, []);
  assert.strictEqual(r.label, 'Cut -20% + new strategy');
});

test('DOWN overrides published Cut and what-if Scale with Hold - tracking down', function () {
  var health = {
    as_of: '2026-10-24',
    shopify_orders_yesterday: 120,
    channels: {
      bing: {
        status: 'DOWN',
        last_checkout_event: '2026-10-23T20:00:00Z',
        last_purchase_event: null,
        purchases_24h: 0,
        purchases_7d_avg: 4,
        notes: 'no purchase events'
      },
      reddit: { status: 'DOWN' },
      meta: { status: 'OK' }
    }
  };
  Throttles._setLive(settings, series, [], snapshot, health);
  var bing = Throttles.recommend('bing', settings, series, []);
  assert.strictEqual(bing.label, 'Hold - tracking down');
  assert.strictEqual(bing.action, 'hold');
  assert.strictEqual(Throttles.channelHealth('bing').status, 'DOWN');
  assert.strictEqual(Throttles.channelHealth('meta').status, 'OK');
  assert.strictEqual(Throttles.channelHealth('chatgpt').status, 'unknown');

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
  Throttles._setLive(live, sample, [], null, health);
  var scaledBlocked = Throttles.recommend('reddit', live, sample, []);
  assert.strictEqual(scaledBlocked.label, 'Hold - tracking down');
  assert.notStrictEqual(scaledBlocked.label, 'Scale +20%');
});

test('WARN / OK do not force Hold - tracking down', function () {
  Throttles._setLive(settings, series, [], snapshot, {
    channels: { bing: { status: 'WARN' }, reddit: { status: 'ok' } }
  });
  assert.strictEqual(Throttles.recommend('bing', settings, series, []).label, 'Cut -20% + new strategy');
  assert.strictEqual(Throttles.channelHealth('reddit').status, 'OK');
});

test('formatEt renders America/New_York and leaves missing blank for unknown', function () {
  assert.strictEqual(Throttles.formatEt(null), null);
  var txt = Throttles.formatEt('2026-10-24T20:00:00Z');
  assert.ok(txt.indexOf('ET') !== -1);
  assert.ok(/4:00/.test(txt));
});

test('Request change link targets the data repo issues form', function () {
  var url = Throttles.requestChangeUrl(settings);
  assert.ok(url.indexOf('https://github.com/davidstarkk/coldest-cfo-dashboard/issues/new') === 0);
  assert.ok(url.indexOf('title=') !== -1);
  assert.ok(url.indexOf('Jarvis') !== -1);
});

if (failed) {
  console.error('\n' + failed + ' throttle test(s) failed');
  process.exit(1);
}
console.log('\nAll throttle tests passed');
