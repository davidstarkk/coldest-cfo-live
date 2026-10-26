'use strict';

var assert = require('assert');
var Throttles = require('../throttles_module.js');
var settings = require('../ads_throttle/settings.json');
var series = require('../ads_throttle/series.json');
var throttleSettings = require('../throttle_settings.json');
var snapshot = require('../ad_channel_throttles.json');
var rankingExample = require('./fixtures/rankings_example.json');
var attributionExample = require('./fixtures/attribution_example.json');
var fs = require('fs');
var path = require('path');

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
  assert.strictEqual(snapshot.channels.bing.rule_status, 'Not enough data');
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

test('published Bing rule is Not enough data; display 7d is 521.09, rule uses D2C 8.73', function () {
  Throttles._setLive(settings, series, [], snapshot);
  var r = Throttles.recommend('bing', settings, series, []);
  assert.strictEqual(r.spend7, 521.09);
  assert.strictEqual(r.spend7_rule, 8.73);
  assert.strictEqual(Throttles.channelSpend7ForRule('bing', settings, series), 8.73);
  assert.strictEqual(r.label, 'Not enough data');
  assert.strictEqual(r.action, 'not_enough_data');
  assert.strictEqual(r.published, true);
  assert.strictEqual(r.roas_basis, 'platform');
  assert.notStrictEqual(r.label, 'Cut -20% + new strategy');
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
  assert.strictEqual(r.label, 'Not enough data');
});

test('DOWN overrides published status and what-if Scale with Hold - tracking down', function () {
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
  assert.strictEqual(Throttles.recommend('bing', settings, series, []).label, 'Not enough data');
  assert.strictEqual(Throttles.channelHealth('reddit').status, 'OK');
});

test('what-if Bing recomputes with D2C-only 7d spend under the $200 minimum', function () {
  Throttles._setLive(settings, series, [], snapshot);
  Throttles._setWhatIf({ global: { roas_threshold: 3, min_spend_7d: 200 } });
  var r = Throttles.recommend('bing', settings, series, []);
  assert.strictEqual(r.spend7, 521.09);
  assert.strictEqual(r.spend7_rule, 8.73);
  assert.strictEqual(r.label, 'Not enough data');
  assert.notStrictEqual(r.label, 'Cut -20% + new strategy');

  var cutSet = Throttles.mergeSettings(settings, { global: { min_spend_7d: 1, roas_threshold: 9 } });
  Throttles._setWhatIf({ global: { min_spend_7d: 1, roas_threshold: 9 } });
  var cut = Throttles.recommend('bing', cutSet, series, []);
  assert.strictEqual(cut.spend7_rule, 8.73);
  assert.ok(cut.spend7_rule >= 1);
  assert.strictEqual(cut.label, 'Cut -20% + new strategy');
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

test('live rankings.json is not shipped — missing file is empty, never invented', function () {
  assert.strictEqual(fs.existsSync(path.join(__dirname, '..', 'ads_throttle', 'rankings.json')), false);
  Throttles._setLive(settings, series, [], snapshot, null, null);
  var empty = Throttles.normalizeRankings(null);
  assert.strictEqual(empty.empty, true);
  assert.strictEqual(empty.channels.length, 0);
  assert.strictEqual(empty.date, null);
  var html = Throttles.rankingHtml();
  assert.ok(html.indexOf('Channel ranking') !== -1);
  assert.ok(html.indexOf(Throttles.EMPTY_RANKING_COPY) !== -1);
  assert.ok(html.indexOf('First ranking lands Mon 10/26 ~11:15 AM ET') !== -1);
  assert.ok(html.indexOf('EXAMPLE DATA') === -1);
  assert.ok(html.indexOf('4.20x') === -1);
});

test('empty channels / empty object do not invent a ranking week', function () {
  assert.strictEqual(Throttles.normalizeRankings({ date: '2026-10-19', channels: [] }).empty, true);
  assert.strictEqual(Throttles.normalizeRankings({}).empty, true);
  assert.strictEqual(Throttles.normalizeRankings([]).empty, true);
  Throttles._setLive(settings, series, [], snapshot, null, { date: '2026-10-19', channels: [] });
  assert.strictEqual(Throttles.rankingHtml().indexOf(Throttles.EMPTY_RANKING_COPY) !== -1, true);
});

test('latest week from rankings array; snapshot.rankings fallback', function () {
  var weeks = [
    {
      date: '2026-10-12',
      channels: [{ channel: 'meta', roas_7d: 9, spend_7d: 1, spend_share: 0.5, revenue_share: 0.5, tier: 'Lead' }]
    },
    {
      date: '2026-10-19',
      channels: [
        { channel: 'google', roas_7d: 3.1, roas_28d: 2.9, spend_7d: 8000, wow_change: 0.02, spend_share: 0.3, revenue_share: 0.28, tier: 'Steady' },
        { channel: 'meta', roas_7d: 4.2, roas_28d: 3.8, spend_7d: 10000, wow_change: 0.1, spend_share: 0.4, revenue_share: 0.5, tier: 'Lead' }
      ]
    }
  ];
  var latest = Throttles.latestRankingWeek(weeks);
  assert.strictEqual(latest.date, '2026-10-19');
  var norm = Throttles.normalizeRankings({ weeks: weeks });
  assert.strictEqual(norm.date, '2026-10-19');
  assert.strictEqual(norm.channels[0].channel, 'meta');
  assert.strictEqual(norm.channels[1].channel, 'google');

  var snap = JSON.parse(JSON.stringify(snapshot));
  snap.rankings = weeks;
  Throttles._setLive(settings, series, [], snap);
  var html = Throttles.rankingHtml();
  assert.ok(html.indexOf('2026-10-19') !== -1);
  assert.ok(html.indexOf('4.20x') !== -1);
  assert.ok(html.indexOf(Throttles.EMPTY_RANKING_COPY) === -1);
});

test('example fixture sorts by tier then roas_7d and labels EXAMPLE DATA', function () {
  assert.strictEqual(rankingExample.example, true);
  assert.strictEqual(rankingExample.label, 'EXAMPLE DATA');
  assert.strictEqual(rankingExample.date, 'EXAMPLE-WEEK');
  var shuffled = {
    example: true,
    date: 'EXAMPLE-WEEK',
    channels: rankingExample.channels.slice().reverse()
  };
  var norm = Throttles.normalizeRankings(shuffled);
  assert.deepStrictEqual(norm.channels.map(function (c) { return c.channel; }), ['meta', 'google', 'tiktok', 'bing', 'reddit']);
  assert.strictEqual(norm.channels[0].tier, 'Lead');
  assert.strictEqual(norm.channels[1].tier, 'Steady');
  assert.strictEqual(norm.channels[2].tier, 'Steady');
  assert.ok(norm.channels[1].roas_7d > norm.channels[2].roas_7d);
  assert.strictEqual(norm.channels[3].tier, 'Lagging');
  assert.strictEqual(norm.channels[4].tier, 'not enough data');
  assert.strictEqual(norm.channels[4].roas_7d, null);
  assert.strictEqual(norm.example, true);

  Throttles._setLive(settings, series, [], snapshot, null, rankingExample);
  var html = Throttles.rankingHtml();
  assert.ok(html.indexOf('EXAMPLE DATA') !== -1);
  assert.ok(html.indexOf('test-only fixture') !== -1);
  assert.ok(html.indexOf('platform-reported') !== -1);
  assert.ok(html.indexOf('4.20x') !== -1);
  assert.ok(html.indexOf('3.10x') !== -1);
  assert.ok(html.indexOf('$10,000.00') !== -1);
  assert.ok(html.indexOf('+10.0%') !== -1);
  assert.ok(html.indexOf('-15.0%') !== -1);
  assert.ok(html.indexOf('th-chip lead') !== -1);
  assert.ok(html.indexOf('th-chip steady') !== -1);
  assert.ok(html.indexOf('th-chip lagging') !== -1);
  assert.ok(html.indexOf('th-chip rank-nodata') !== -1);
  assert.ok(html.indexOf('th-share-pair') !== -1);
  assert.ok(html.indexOf(Throttles.EMPTY_RANKING_COPY) === -1);
});

test('tier badges and wow/share stay blank when unpublished', function () {
  assert.strictEqual(Throttles.tierChipClass('Lead'), 'lead');
  assert.strictEqual(Throttles.tierChipClass('Steady'), 'steady');
  assert.strictEqual(Throttles.tierChipClass('Lagging'), 'lagging');
  assert.strictEqual(Throttles.tierChipClass('not enough data'), 'rank-nodata');
  assert.strictEqual(Throttles.wowTxt(null), null);
  assert.strictEqual(Throttles.wowTxt(0.1), '+10.0%');
  assert.strictEqual(Throttles.wowTxt(-0.15), '-15.0%');
  var sparse = Throttles.normalizeRankings({
    date: '2026-10-19',
    channels: [{ channel: 'snapchat', tier: 'not enough data' }]
  });
  assert.strictEqual(sparse.channels[0].roas_7d, null);
  assert.strictEqual(sparse.channels[0].spend_7d, null);
  assert.strictEqual(sparse.channels[0].wow_change, null);
  Throttles._setLive(settings, series, [], snapshot, null, { date: '2026-10-19', channels: [{ channel: 'snapchat', tier: 'not enough data' }] });
  var html = Throttles.rankingHtml();
  assert.ok(html.indexOf('—') !== -1);
  assert.ok(html.indexOf('$0.00') === -1);
});

test('live snapshot has no attribution block — empty card, never invented', function () {
  assert.strictEqual(snapshot.attribution, undefined);
  assert.strictEqual(snapshot.channels.meta.shopify_roas_7d, undefined);
  assert.strictEqual(snapshot.channels.meta.coverage_pct, undefined);
  assert.strictEqual(snapshot.channels.meta.roas_source, undefined);
  Throttles._setLive(settings, series, [], snapshot);
  var attr = Throttles.normalizeAttribution(snapshot.attribution);
  assert.strictEqual(attr.empty, true);
  assert.strictEqual(attr.attributed_paid_pct, null);
  var card = Throttles.attributionHtml();
  assert.ok(card.indexOf('Attribution coverage') !== -1);
  assert.ok(card.indexOf('unknown') !== -1);
  assert.ok(card.indexOf('EXAMPLE DATA') === -1);
  assert.ok(card.indexOf('55%') === -1);
  var meta = Throttles.channelAttribution('meta');
  assert.strictEqual(meta.shopify_roas_7d, null);
  assert.strictEqual(meta.coverage_pct, null);
  assert.strictEqual(meta.roas_source, null);
  var rows = Throttles.channelsTableHtml();
  assert.ok(rows.indexOf('>Shopify-attributed<') === -1);
  assert.ok(rows.indexOf('th-chip cov-miss') !== -1);
  assert.ok(rows.indexOf('th-chip cov-high') === -1);
});

test('example attribution overlays labels, chips, and 100% coverage cap', function () {
  assert.strictEqual(attributionExample.example, true);
  assert.strictEqual(attributionExample.label, 'EXAMPLE DATA');
  assert.strictEqual(attributionExample.channels.reddit.coverage_pct, 110);
  assert.strictEqual(attributionExample.channels.meta.roas_source, 'shopify_attributed');
  assert.strictEqual(attributionExample.channels.google.roas_source, 'platform_reported');
  assert.strictEqual(attributionExample.channels.bing.shopify_roas_7d, null);

  var originalMetaRoas = snapshot.channels.meta.shopify_roas_7d;
  Throttles._setLive(settings, series, [], snapshot, null, null, attributionExample);
  assert.strictEqual(snapshot.channels.meta.shopify_roas_7d, originalMetaRoas);

  assert.strictEqual(Throttles.displayCoveragePct(110), 100);
  assert.strictEqual(Throttles.displayCoveragePct(null), null);
  assert.strictEqual(Throttles.coverageChipClass(92), 'cov-high');
  assert.strictEqual(Throttles.coverageChipClass(65), 'cov-mid');
  assert.strictEqual(Throttles.coverageChipClass(50), 'cov-mid');
  assert.strictEqual(Throttles.coverageChipClass(12), 'cov-low');
  assert.strictEqual(Throttles.coverageChipClass(null), 'cov-miss');
  assert.strictEqual(Throttles.roasSourceLabel('shopify_attributed'), 'Shopify-attributed');
  assert.strictEqual(Throttles.roasSourceLabel('platform_reported'), 'platform-reported');
  assert.strictEqual(Throttles.normalizeRoasSource(null), null);

  var card = Throttles.attributionHtml();
  assert.ok(card.indexOf('EXAMPLE DATA') !== -1);
  assert.ok(card.indexOf('EXAMPLE-WEEK') !== -1);
  assert.ok(card.indexOf('Paid-attributed') !== -1);
  assert.ok(card.indexOf('55%') !== -1);
  assert.ok(card.indexOf('Owned') !== -1);
  assert.ok(card.indexOf('Unattributed') !== -1);
  assert.ok(card.indexOf(Throttles.LIVE_RULE_NOTE) !== -1);

  var meta = Throttles.channelAttribution('meta');
  assert.strictEqual(meta.shopify_roas_7d, 4);
  assert.strictEqual(meta.platform_roas_7d, 4.2);
  assert.strictEqual(meta.coverage_pct, 92);
  assert.strictEqual(meta.roas_source, 'shopify_attributed');
  var reddit = Throttles.channelAttribution('reddit');
  assert.strictEqual(reddit.coverage_pct, 110);
  assert.ok(Throttles.coverageChipHtml(110).indexOf('100%') !== -1);
  var snapchat = Throttles.channelAttribution('snapchat');
  assert.strictEqual(snapchat.coverage_pct, null);
  assert.strictEqual(snapchat.shopify_roas_7d, null);

  var rows = Throttles.channelsTableHtml();
  assert.ok(rows.indexOf('4.00x') !== -1);
  assert.ok(rows.indexOf('4.20x') !== -1);
  assert.ok(rows.indexOf('platform-reported') !== -1);
  assert.ok(rows.indexOf('Shopify-attributed') !== -1);
  assert.ok(rows.indexOf('th-chip cov-high') !== -1);
  assert.ok(rows.indexOf('th-chip cov-mid') !== -1);
  assert.ok(rows.indexOf('th-chip cov-low') !== -1);
  assert.ok(rows.indexOf('th-chip cov-miss') !== -1);
  assert.ok(rows.indexOf('100%') !== -1);
  assert.ok(rows.indexOf('110%') === -1);
});

test('live throttle rule stays platform-reported even when example source is shopify_attributed', function () {
  Throttles._setLive(settings, series, [], snapshot, null, null, attributionExample);
  assert.strictEqual(settings.global.roas_basis, 'platform');
  var r = Throttles.recommend('meta', settings, series, []);
  assert.strictEqual(r.roas_basis, 'platform');
  assert.strictEqual(r.label, 'Frozen - view only');
  assert.notStrictEqual(r.roas_basis, 'shopify_attributed');
});

if (failed) {
  console.error('\n' + failed + ' throttle test(s) failed');
  process.exit(1);
}
console.log('\nAll throttle tests passed');
