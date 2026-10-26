'use strict';

var assert = require('assert');
var Paid = require('../paid_channels_module.js');
var Throttles = require('../throttles_module.js');
var Header = require('../rolling_mer_header.js');
var mer = require('../mer_for_manus.json');
var settings = require('../ads_throttle/settings.json');
var series = require('../ads_throttle/series.json');
var snapshot = require('../ad_channel_throttles.json');
var pinExample = require('./fixtures/pinterest_example.json');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) {
    failed += 1;
    console.error('FAIL - ' + name);
    console.error('     ' + (e && e.stack ? e.stack : e));
  }
}

var pinCh = Paid.CHANNELS.filter(function (c) { return c.id === 'pinterest'; })[0];

test('Pinterest is a paid channel (account 549760871033) and reads pinterest_ads', function () {
  assert.ok(pinCh);
  assert.strictEqual(pinCh.merKey, 'pinterest');
  assert.ok(pinCh.sourceKeys.indexOf('pinterest_ads') !== -1);
  assert.ok(Throttles.CHANNEL_META.some(function (c) { return c.id === 'pinterest'; }));
  assert.ok(Throttles.HEALTH_CHANNELS.some(function (c) { return c.id === 'pinterest'; }));
  assert.strictEqual(Throttles.PINTEREST_KNOWN_GAP, 'No CAPI (Conversions API) — known gap, browser tag only');
});

test('missing Pinterest feed is $0 / no feed — header and published totals unchanged', function () {
  assert.strictEqual(mer.pinterest, undefined);
  assert.strictEqual(snapshot.channels.pinterest, undefined);
  Paid._setMerDoc(mer);
  Paid.setFeeds('pinterest', null, mer, null);
  var day = Paid.latestDayFor(pinCh);
  assert.strictEqual(day.spend, 0);
  assert.ok(!day.hasFeed || day.spend === 0);

  var p = {
    date: '2026-10-24',
    advertising_sources: {
      meta: { spend: '11521.87', complete: true },
      google_ads: { spend: '1951.18', complete: true }
    },
    channel_observations: { shopify: { revenue: 26420.44, orders: 331 } },
    provisional_totals: { revenue: 48795.5, ads: 21601.53, net_profit: -3689.89 }
  };
  var before = JSON.parse(JSON.stringify(p.provisional_totals));
  global.PARTIAL_REPORTS = [p];
  Paid.applyChannel(pinCh, Paid.mergeDaysFor(pinCh));
  assert.strictEqual(p.provisional_totals.ads, before.ads);
  assert.strictEqual(p.provisional_totals.net_profit, before.net_profit);
  var s = Paid.channelSpends('2026-10-24');
  assert.strictEqual(s.d2cAdSpend, 14382.78);
  assert.strictEqual(s.totalAdSpend, 21678.86);
  assert.strictEqual(s.channels.pinterest.spend, 0);
  delete global.PARTIAL_REPORTS;

  var resolved = Header.resolve({
    as_of: '2026-09-27',
    latest: { date: '2026-09-27', mer_7d_pooled: 3.1952, rev_7d: 1, spend_7d: 1 }
  }, mer);
  assert.strictEqual(resolved.stale, false);
  assert.strictEqual(resolved.data.latest.mer_7d_pooled, 2.6887);
  assert.strictEqual(resolved.data.latest.spend_7d, 108735.13);
});

test('mer_for_manus.pinterest and advertising_sources[date].pinterest_ads are consumed', function () {
  var doc = {
    as_of: '2026-10-25',
    pinterest: {
      as_of: '2026-10-25',
      spend: 12.5,
      spend_d2c: 12.5,
      clicks: 9,
      conversions: 0,
      revenue: 0,
      roas: 0,
      spend_7d: 40,
      attribution_window: '7d click / 1d view',
      live: true,
      status: 'learning',
      source: 'pipeboard'
    },
    advertising_sources: {
      '2026-10-25': {
        pinterest_ads: { spend: 12.5, spend_d2c: 12.5, clicks: 9, conversions: 0, revenue: 0 }
      }
    }
  };
  Paid._setMerDoc(doc);
  Paid.setFeeds('pinterest', null, doc, null);
  var latest = Paid.latestDayFor(pinCh);
  assert.strictEqual(latest.spend, 12.5);
  assert.strictEqual(latest.d2c, 12.5);
  assert.strictEqual(latest.clicks, 9);
  assert.strictEqual(latest.attribution_window, '7d click / 1d view');
  var fromAds = Paid.merAdvertisingSourcesDays(pinCh)['2026-10-25'];
  assert.ok(fromAds);
  assert.strictEqual(fromAds.spend, 12.5);
  assert.strictEqual(fromAds.source, 'advertising_sources.pinterest_ads');
  Paid._setMerDoc(null);
});

test('live Throttles Pinterest row is empty/unknown — not DOWN, known-gap chip always shown', function () {
  Throttles._setLive(settings, series, [], snapshot);
  var h = Throttles.channelHealth('pinterest');
  assert.strictEqual(h.status, 'unknown');
  assert.notStrictEqual(h.status, 'DOWN');
  assert.strictEqual(Throttles.pinterestKnownGapText('pinterest'), Throttles.PINTEREST_KNOWN_GAP);
  var rec = Throttles.recommend('pinterest', settings, series, []);
  assert.notStrictEqual(rec.label, 'Hold - tracking down');
  var rows = Throttles.channelsTableHtml();
  assert.ok(rows.indexOf('Pinterest') !== -1);
  assert.ok(rows.indexOf('th-row-pinterest') !== -1);
  assert.ok(rows.indexOf('soft read') !== -1);
  assert.ok(rows.indexOf('first binding') !== -1);
  assert.ok(rows.indexOf(Throttles.PINTEREST_ROAS_WINDOW) !== -1);
  assert.ok(rows.indexOf(Throttles.PINTEREST_KNOWN_GAP) !== -1);
  assert.ok(rows.indexOf('Learning, first read 11/01') === -1);
  var health = Throttles.trackingHealthHtml();
  assert.ok(health.indexOf('Pinterest') !== -1);
  assert.ok(health.indexOf('unknown') !== -1);
  assert.ok(health.indexOf(Throttles.PINTEREST_KNOWN_GAP) !== -1);
  assert.ok(health.indexOf('th-chip known-gap') !== -1);
  var rank = Throttles.rankingHtml();
  assert.ok(rank.indexOf('Pinterest') === -1);
});

test('example Pinterest fixture overlays Learning row, dates, ranking, and WARN health — not live dollars', function () {
  assert.strictEqual(pinExample.example, true);
  assert.strictEqual(pinExample.label, 'EXAMPLE DATA');
  assert.strictEqual(pinExample.account_id, '549760871033');
  Throttles._setLive(settings, series, [], snapshot, null, null, null, pinExample);
  var rec = Throttles.recommend('pinterest', settings, series, []);
  assert.strictEqual(rec.label, 'Learning, first read 11/01');
  assert.strictEqual(rec.published, true);
  assert.notStrictEqual(rec.label, 'Hold - tracking down');
  var attr = Throttles.channelAttribution('pinterest');
  assert.strictEqual(attr.platform_roas_7d, 1.71);
  assert.strictEqual(attr.shopify_roas_7d, null);
  assert.strictEqual(attr.coverage_pct, 40);
  assert.strictEqual(attr.roas_source, 'platform_reported');
  assert.strictEqual(attr.rule_roas_source, 'platform_reported');
  var rows = Throttles.channelsTableHtml();
  assert.ok(rows.indexOf('EXAMPLE DATA') !== -1);
  assert.ok(rows.indexOf('Learning, first read 11/01') !== -1);
  assert.ok(rows.indexOf('2026-11-01') !== -1);
  assert.ok(rows.indexOf('2026-11-09') !== -1);
  assert.ok(rows.indexOf('1.71x') !== -1);
  assert.ok(rows.indexOf(Throttles.PINTEREST_ROAS_WINDOW) !== -1);
  assert.ok(rows.indexOf('th-chip cov-low') !== -1);
  assert.strictEqual(Throttles.channelHealth('pinterest').status, 'WARN');
  assert.notStrictEqual(Throttles.channelHealth('pinterest').status, 'DOWN');
  var health = Throttles.trackingHealthHtml();
  assert.ok(health.indexOf('WARN') !== -1);
  assert.ok(health.indexOf(Throttles.PINTEREST_KNOWN_GAP) !== -1);
  var rank = Throttles.normalizeRankings({
    date: 'EXAMPLE-WEEK',
    eligible_channels: ['pinterest'],
    channels: [pinExample.ranking]
  });
  assert.ok(rank.channels.some(function (c) { return c.channel === 'pinterest'; }));
  var merOverlay = Paid.applyPinterestMerExample({ as_of: '2026-10-24', d2c_ad_spend: 14382.78 }, pinExample);
  assert.strictEqual(merOverlay.pinterest.spend, 42);
  assert.strictEqual(mer.pinterest, undefined);
});

test('eligible_channels includes Pinterest without inventing ROAS', function () {
  var norm = Throttles.normalizeRankings({
    date: '2026-10-26',
    eligible_channels: ['pinterest'],
    channels: []
  });
  assert.strictEqual(norm.channels.length, 1);
  assert.strictEqual(norm.channels[0].channel, 'pinterest');
  assert.strictEqual(norm.channels[0].roas_7d, null);
  assert.strictEqual(norm.channels[0].spend_7d, null);
});

if (failed) {
  console.error('\n' + failed + ' pinterest test(s) failed');
  process.exit(1);
}
console.log('\nAll pinterest tests passed');
