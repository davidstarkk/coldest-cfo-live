'use strict';

var assert = require('assert');
var A = require('../ad_channels_module.js');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) {
    failed += 1;
    console.error('FAIL - ' + name);
    console.error('     ' + (e && e.stack ? e.stack : e));
  }
}

function day(date, spend, extra) {
  return Object.assign({ spend: spend, complete: true, closed_day: true }, extra || {});
}

// 14 embedded daily-report rows, 2026-10-20 .. 2026-11-02, spend only (what the mirror sync carries).
function embeddedRows() {
  var rows = [];
  for (var i = 0; i < 14; i++) {
    var d = A.windowDates('2026-11-02', 14)[i];
    var week2 = d >= '2026-10-27';
    rows.push({
      date: d,
      report_status: 'partial',
      advertising_sources: {
        meta: day(d, week2 ? '9000.00' : '12000.00'),
        google_ads: day(d, '2000.00'),
        tiktok_ads: { spend: '4000.00', shopify_spend: '1500.00', shop_spend: '2000.00', unallocated_spend: '500.00', complete: false },
        snapchat_ads: day(d, week2 ? '400.00' : '100.00'),
        pinterest_ads: day(d, week2 ? '0.00' : '60.00'),
        reddit_ads: day(d, week2 ? '150.00' : '0.00'),
        chatgpt_ads: day(d, '0.00')
      }
    });
  }
  return rows;
}

// mer doc: platform metrics for snapchat (through 10/30 only), spend-only Meta nodes, x not live.
function merDoc() {
  var adv = {};
  A.windowDates('2026-11-02', 14).forEach(function (d) {
    adv[d] = {
      meta: { spend: d >= '2026-10-27' ? 9000 : 12000, clicks: 0, conversions: 0, revenue: 0, impressions: 0, roas: null, live: true, source: 'daily_inputs.meta' },
      snapchat_ads: d <= '2026-10-30'
        ? { spend: d >= '2026-10-27' ? 400 : 100, clicks: 90, conversions: 12, revenue: 1000, impressions: 30000, roas: 2.5, live: true, source: 'Pipeboard Snapchat', spend_d2c: d >= '2026-10-27' ? 400 : 100, destination: 'd2c' }
        : { spend: 400, clicks: 0, conversions: 0, revenue: 0, impressions: 0, roas: null, live: true, source: 'Pipeboard Snapchat', spend_d2c: 400, destination: 'd2c' },
      bing_ads: d <= '2026-10-30'
        ? { spend: 80, spend_d2c: 5, spend_amazon: 75, clicks: 10, conversions: 1, revenue: 40, impressions: 500, roas: 0.5, live: true, source: 'Pipeboard Bing', destination: 'd2c' }
        : { spend: 80, spend_d2c: 5, spend_amazon: 75, clicks: 0, conversions: 0, revenue: 0, impressions: 0, roas: null, live: true, source: 'Pipeboard Bing', destination: 'd2c' },
      x_ads: { spend: 0, clicks: 0, conversions: 0, revenue: 0, impressions: 0, roas: null, live: false, status: 'not_live', cash_cost: 0, source: 'X Ads not live' }
    };
  });
  var blended = A.windowDates('2026-11-02', 14).map(function (d) {
    return { date: d, d2c_ad_spend: 12000, total_ad_spend: 16000, shopify_revenue: 24000, blended_mer: 2.0 };
  });
  return {
    as_of: '2026-11-02',
    spend_7d: 84000, rev_7d: 168000, mer_7d_pooled: 2.0,
    advertising_sources: adv,
    snapchat: { status: 'live', live: true, as_of: '2026-11-02' },
    x: { status: 'not_live', live: false, by_date: {} },
    taboola: { status: 'not_live', live: false },
    ad_channel_throttles: {
      as_of: '2026-11-02',
      series_28d: { by_channel: {}, blended: blended },
      channels: {
        meta: { mode: 'frozen', rule_status: 'Frozen - view only', tracking_status: 'OK' },
        google: { mode: 'auto', rule_status: 'Not enough data', last_change_date: '2026-10-29', last_change_action: 'cut_20pct_and_change_strategy' },
        snapchat: { mode: 'auto', rule_status: 'Not enough data' },
        pinterest: { mode: 'hold', launch_date: '2026-10-25', soft_read_date: '2026-11-01', first_binding_date: '2026-11-09' },
        reddit: { mode: 'hold' },
        taboola: { mode: 'auto', rule_status: 'Not launched' }
      },
      rankings: [{ date: '2026-10-19', channels: [] }, { date: '2026-10-26', channels: [{ channel: 'meta', tier: 'Lagging', roas_7d: 2.42, roas_28d: 2.75, wow_spend_change_pct: 50.2 }] }],
      tracking_health: { as_of: '2026-10-31T08:40:00-04:00', channels: { meta: { status: 'OK' }, reddit: { status: 'DOWN' }, snapchat: { status: 'WARN' } } }
    }
  };
}

var changes = [
  { date: '2026-10-30', channel: 'snapchat', action: 'raise_20pct', old_budget: 350, new_budget: 420, by: 'jarvis' },
  { date: '2026-10-29', channel: 'google', action: 'cut_20pct_and_change_strategy', old_budget: 73.5, new_budget: 58.8, by: 'jarvis' },
  { date: '2026-10-10', channel: 'snapchat', action: 'cut_20pct', old_budget: 500, new_budget: 400, by: 'jarvis' },
  { date: '2026-10-29', channel: 'pinterest', action: 'kill_under_1x', old_budget: 65, new_budget: 0, by: 'jarvis' }
];

function inputs() {
  return { embedded: embeddedRows(), mer: merDoc(), changes: changes, settings: { updated_at: '2026-10-28T08:30:00-04:00', global: { roas_source: 'platform_reported' }, channels: { meta: { mode: 'frozen' }, google: { mode: 'auto' }, snapchat: { mode: 'auto', owner_bot: 'snapchat ads bot' }, pinterest: { mode: 'hold' }, reddit: { mode: 'hold' }, taboola: { mode: 'auto' } } } };
}

test('spend comes from the embedded daily report rows; platform metrics from mer', function () {
  var s = A.buildSeries(inputs());
  assert.strictEqual(s.spendThrough, '2026-11-02');
  assert.strictEqual(s.platformThrough, '2026-10-30');
  var meta = s.channels.meta.days['2026-11-02'];
  assert.strictEqual(meta.spend, 9000);
  assert.strictEqual(meta.spendSource, 'daily report advertising_sources');
  assert.strictEqual(meta.hasPlatform, false, 'spend-only Meta node is not a platform read');
  assert.strictEqual(meta.revenue, null);
  var snap = s.channels.snapchat.days['2026-10-30'];
  assert.strictEqual(snap.spend, 400);
  assert.strictEqual(snap.hasPlatform, true);
  assert.strictEqual(snap.revenue, 1000);
  assert.strictEqual(snap.conversions, 12);
  var snapLate = s.channels.snapchat.days['2026-11-01'];
  assert.strictEqual(snapLate.hasPlatform, false, 'all-zero platform node with roas null is not a read');
});

test('TikTok D2C share is shopify_spend; Bing keeps the Amazon split; X stays not live', function () {
  var s = A.buildSeries(inputs());
  var tt = s.channels.tiktok.days['2026-11-02'];
  assert.strictEqual(tt.spend, 4000);
  assert.strictEqual(tt.spend_d2c, 1500);
  var bing = s.channels.bing.days['2026-11-02'];
  assert.strictEqual(bing.spend, 80);
  assert.strictEqual(bing.spend_d2c, 5);
  assert.strictEqual(bing.spend_amazon, 75);
  var x = s.channels.x.days['2026-11-02'];
  assert.strictEqual(x.spend, 0);
  assert.strictEqual(x.live, false);
});

test('growth verdicts: ±15% WoW, launching, stopped, no spend', function () {
  assert.strictEqual(A.growthVerdict(1200, 1000).code, 'growing');
  assert.strictEqual(A.growthVerdict(1100, 1000).code, 'flat');
  assert.strictEqual(A.growthVerdict(800, 1000).code, 'shrinking');
  assert.strictEqual(A.growthVerdict(500, 0).code, 'launching');
  assert.strictEqual(A.growthVerdict(0, 500).code, 'stopped');
  assert.strictEqual(A.growthVerdict(0, 0).code, 'none');
  assert.strictEqual(A.growthVerdict(0, 0).wow, null);
});

test('incomplete windows are flagged, never judged; no rows at all is NO FEED', function () {
  assert.strictEqual(A.growthVerdict(1000, 2000, 5, 7).code, 'incomplete');
  assert.ok(/5\/7/.test(A.growthVerdict(1000, 2000, 5, 7).label));
  assert.strictEqual(A.growthVerdict(0, 0, 0, 0).code, 'nofeed');
  assert.strictEqual(A.growthVerdict(1200, 1000, 7, 7).code, 'growing');
  var rows = embeddedRows().filter(function (r) { return r.date !== '2026-10-31' && r.date !== '2026-11-01'; });
  var inp = { embedded: rows };
  var s = A.buildSeries(inp);
  var meta = A.channelStats(A.CHANNELS[0], s, inp, s.spendThrough);
  assert.strictEqual(meta.spend7Days, 5);
  assert.strictEqual(meta.growth.code, 'incomplete');
  var stats = A.CHANNELS.map(function (ch) { return A.channelStats(ch, s, inp, s.spendThrough); });
  var sum = A.summarize(stats, s, inp, s.spendThrough);
  assert.deepStrictEqual(sum.missingDays7, ['2026-10-31', '2026-11-01']);
  assert.strictEqual(sum.trackedWow, null, 'WoW withheld when a day has no channel spend at all');
  var bing = stats.filter(function (x) { return x.ch.id === 'bing'; })[0];
  assert.strictEqual(bing.growth.code, 'nofeed');
});

test('channel stats: 7d windows, WoW, platform ROAS only over reported days, share and blended', function () {
  var inp = inputs();
  var s = A.buildSeries(inp);
  var meta = A.channelStats(A.CHANNELS[0], s, inp, s.spendThrough);
  assert.strictEqual(meta.spend7, 63000);
  assert.strictEqual(meta.prev7, 84000);
  assert.strictEqual(meta.growth.code, 'shrinking');
  assert.strictEqual(meta.roas7, null, 'no platform feed → ROAS is —, not 0');
  assert.strictEqual(meta.platformRev7, null);
  assert.strictEqual(meta.posture.code, 'frozen');
  assert.strictEqual(meta.rank.tier, 'Lagging');
  assert.strictEqual(meta.rankDate, '2026-10-26', 'latest dated ranking object is unwrapped from the Jarvis list');
  var snapCh = A.CHANNELS.filter(function (c) { return c.id === 'snapchat'; })[0];
  var snap = A.channelStats(snapCh, s, inp, s.spendThrough);
  assert.strictEqual(snap.spend7, 2800);
  assert.strictEqual(snap.prev7, 700);
  assert.strictEqual(snap.growth.code, 'growing');
  assert.strictEqual(snap.platformDays7, 4, '10/27–10/30 reported; 10/31–11/02 did not');
  assert.strictEqual(snap.platformRev7, 4000);
  assert.strictEqual(snap.roas7, 2.5);
  assert.strictEqual(snap.platformLatest, '2026-10-30');
  assert.strictEqual(snap.posture.code, 'scaling', 'raise_20pct on 10/30 within 14 days');
  assert.strictEqual(snap.change.date, '2026-10-30', 'latest change wins over the older cut');
  assert.strictEqual(snap.tracking, 'WARN');
  var stats = A.CHANNELS.map(function (ch) { return A.channelStats(ch, s, inp, s.spendThrough); });
  var sum = A.summarize(stats, s, inp, s.spendThrough);
  assert.strictEqual(sum.blended.mer, 2);
  assert.strictEqual(sum.blended.d2c, 84000);
  assert.strictEqual(sum.scaling, 1);
  assert.strictEqual(sum.live >= 5, true);
});

test('posture: tracking DOWN overrides, kill/cut/raise within 14 days, hold / view / frozen, pre-launch', function () {
  assert.strictEqual(A.posture({ tracking: 'DOWN', mode: 'auto', change: { date: '2026-11-01', action: 'raise_20pct' }, asOf: '2026-11-02', live: true, spend7: 100 }).code, 'tracking_down');
  assert.strictEqual(A.posture({ mode: 'auto', change: { date: '2026-10-29', action: 'kill_under_1x' }, asOf: '2026-11-02', live: true, spend7: 100 }).code, 'killed');
  assert.strictEqual(A.posture({ mode: 'auto', change: { date: '2026-10-30', action: 'kill_under_1x' }, asOf: '2026-11-04', live: false, spend7: 0 }).code, 'killed', 'Jarvis kill still shows when the 7d window is empty');
  assert.strictEqual(A.posture({ mode: 'auto', change: { date: '2026-10-29', action: 'cut_20pct_and_change_strategy' }, asOf: '2026-11-02', live: true, spend7: 100 }).code, 'cutting');
  assert.strictEqual(A.posture({ mode: 'auto', change: { date: '2026-10-01', action: 'raise_20pct' }, asOf: '2026-11-02', live: true, spend7: 100 }).code, 'auto', 'a 32-day-old raise is history, not posture');
  assert.strictEqual(A.posture({ mode: 'hold', live: true, spend7: 100 }).code, 'hold');
  assert.strictEqual(A.posture({ mode: 'view', live: true, spend7: 100 }).code, 'view');
  assert.strictEqual(A.posture({ mode: 'frozen', live: true, spend7: 100 }).code, 'frozen');
  assert.strictEqual(A.posture({ mode: 'auto', live: false, status: 'pre_launch', spend7: 0 }).code, 'not_live');
  var learning = A.posture({ mode: 'auto', live: true, spend7: 100, asOf: '2026-10-28', launch: { launch_date: '2026-10-25', soft_read_date: '2026-11-01' } });
  assert.strictEqual(learning.code, 'learning');
  assert.ok(/first read 11\/1/.test(learning.label));
  assert.strictEqual(A.posture({}).code, 'unknown');
});

test('freshness flags a stale platform feed and never invents a read', function () {
  var inp = inputs();
  var s = A.buildSeries(inp);
  var notes = A.freshness(s, inp);
  var plat = notes.filter(function (n) { return /Platform/.test(n.k); })[0];
  assert.ok(/behind/.test(plat.warn), 'platform feed 3 days behind spend is flagged');
  var noMer = A.buildSeries({ embedded: embeddedRows() });
  assert.strictEqual(noMer.platformThrough, null);
  var n2 = A.freshness(noMer, { embedded: embeddedRows() });
  assert.strictEqual(n2.filter(function (n) { return /Platform/.test(n.k); })[0].v, 'no feed');
  var metaNoMer = A.channelStats(A.CHANNELS[0], noMer, {}, noMer.spendThrough);
  assert.strictEqual(metaNoMer.roas7, null);
  assert.strictEqual(metaNoMer.posture.code, 'unknown');
  assert.strictEqual(metaNoMer.spend7, 63000);
});

test('rankings unwrap and action labels', function () {
  assert.strictEqual(A.unwrapRankings(null).date, null);
  assert.deepStrictEqual(A.unwrapRankings({ date: '2026-10-26', channels: [] }).date, '2026-10-26');
  assert.strictEqual(A.unwrapRankings([{ date: '2026-10-19', channels: [] }, { date: '2026-10-26', channels: [] }]).date, '2026-10-26');
  assert.strictEqual(A.actionKind('raise_20pct'), 'scale');
  assert.strictEqual(A.actionKind('kill_under_1x'), 'kill');
  assert.strictEqual(A.actionKind('cut_20pct_and_change_strategy'), 'cut');
  assert.strictEqual(A.actionLabel(changes[0]), 'Scaled $350 → $420/day on 10/30 by jarvis');
});

function extractLiteral(html, name) {
  var needle = 'const ' + name + ' = ';
  var start = html.indexOf(needle);
  if (start < 0) return [];
  start += needle.length;
  var i = start, depth = 0, inStr = null, esc = false;
  for (; i < html.length; i++) {
    var ch = html[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); }
        catch (e) { return []; }
      }
    }
  }
  return [];
}

function liveEmbedded() {
  var fs = require('fs');
  var path = require('path');
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  return [].concat(extractLiteral(html, 'PARTIAL_REPORTS'), extractLiteral(html, 'REPORTS'));
}

test('live page data: every channel resolves, missing totals stay null, Meta ROAS stays — on spend-only feed', function () {
  var embedded = liveEmbedded();
  var inp = { embedded: embedded, mer: require('../mer_for_manus.json'), settings: require('../ads_throttle/settings.json'), changes: require('../ads_throttle/changes.json'), rankings: require('../ads_throttle/rankings.json'), tracking: require('../ads_throttle/tracking_health.json'), seriesFile: require('../ads_throttle/series.json') };
  var s = A.buildSeries(inp);
  assert.ok(s.spendThrough >= '2026-11-01');
  var stats = A.CHANNELS.map(function (ch) { return A.channelStats(ch, s, inp, s.spendThrough); });
  stats.forEach(function (st) {
    ['spend7', 'prev7', 'spend30'].forEach(function (k) {
      assert.ok(st[k] == null || Number.isFinite(st[k]), st.ch.id + '.' + k);
    });
    if (st.roas7 != null) assert.ok(Number.isFinite(st.roas7));
    assert.ok(st.posture && st.posture.label);
    assert.ok(st.statusLabel);
    assert.ok(st.feed && st.feed.code);
  });
  var meta = stats.filter(function (x) { return x.ch.id === 'meta'; })[0];
  assert.ok(meta.spend7 > 0);
  // Meta ROAS comes from the daily report's performance.platforms (10/24 on), never from the spend-only feed.
  var perfDays = Object.keys(s.platforms.meta.days);
  if (perfDays.length) { assert.ok(Number.isFinite(meta.roas7) && meta.roas7 > 0); assert.strictEqual(meta.platformSource, 'daily report performance.platforms'); }
  else assert.strictEqual(meta.roas7, null);
  assert.ok(!s.partialDates.some(function (d) { return d <= s.spendThrough; }), 'partial today never ends the window');
  var lb = A.leaderboard(s, s.spendThrough, inp.settings);
  lb.rows.forEach(function (r) { assert.ok(r.roas7 == null || Number.isFinite(r.roas7), r.label); assert.ok(['raise', 'hold', 'cut', 'low', 'none'].indexOf(r.band) !== -1); });
});

/* ---------------------------------------------- platform units (performance.platforms) */
function perfRows(end, n) {
  // n (default 10) days ending `end`: partial rows with performance.platforms; Meta/Google spend-only in advertising_sources
  var rows = [];
  A.windowDates(end, n || 10).forEach(function (d, i) {
    rows.push({
      date: d, report_status: 'partial',
      advertising_sources: { meta: day(d, '10000.00'), google_ads: day(d, '2000.00'), tiktok_ads: { spend: '3000.00', shopify_spend: '1000.00', shop_spend: '1500.00', unallocated_spend: '500.00', complete: false }, snapchat_ads: day(d, '500.00'), bing_ads: day(d, '20.00') },
      channel_observations: { shopify: { revenue: 20000 + i * 100, known_ads: 10000, status: 'provisional', data_available: true, zero_assumed: false } },
      performance: { platforms: [
        { key: 'meta', label: 'Meta', spend: 9990, value: 24000, ratio: 2.4, badges: ['SOLID'], basis: 'Meta purchase value, account day' },
        { key: 'google_ads', label: 'Google Ads', spend: 2010, value: 3015, ratio: 1.5, badges: ['WEAK'], basis: 'Google conversion value, account day' },
        { key: 'tiktok_shop', label: 'TikTok Shop · GMV Max', spend: 1500, value: 6000, ratio: 4.0, badges: ['STRONG'], basis: 'GMV Max' },
        { key: 'tiktok_web', label: 'TikTok · website', spend: 1500, value: 3000, ratio: 2.0, badges: ['SOLID'], basis: 'website' },
        { key: 'snapchat_ads', label: 'Snapchat', spend: 500, value: 3500, ratio: 7.0, badges: ['TOP', 'STRONG'], basis: 'Snapchat purchase value, Eastern day' },
        { key: 'bing_ads', label: 'Bing', spend: 20, value: 200, ratio: 10, badges: ['LOW SPEND'], basis: 'Bing' }
      ] }
    });
  });
  return rows;
}
var SETTINGS = { global: { raise_above_roas: 2.8, cut_below_roas: 2.0, min_spend_7d: 200 }, channels: {} };

test('performance.platforms feeds channel platform ROAS with the platform\'s own spend as denominator; TikTok sums Shop + website', function () {
  var s = A.buildSeries({ embedded: perfRows('2026-11-04'), mer: null });
  var meta = A.channelStats(A.CHANNELS[0], s, { settings: SETTINGS }, '2026-11-04');
  assert.strictEqual(meta.platformDays7, 7);
  assert.strictEqual(meta.roas7, 2.4);                     // 24000 / 9990 per day, not / 10000 daily_inputs spend
  assert.strictEqual(meta.platformRev7, 168000);
  assert.strictEqual(meta.platformConv7, null);            // no conversion count on this feed → "—", never 0
  assert.strictEqual(meta.platformSource, 'daily report performance.platforms');
  var tt = A.channelStats(A.CHANNELS.filter(function (c) { return c.id === 'tiktok'; })[0], s, { settings: SETTINGS }, '2026-11-04');
  assert.strictEqual(tt.roas7, 3);                         // (6000+3000)/(1500+1500)
  assert.strictEqual(s.platformThrough, '2026-11-04');
  assert.strictEqual(A.performanceRow({ key: 'x', spend: 0, value: 0 }), null);
  assert.strictEqual(A.performanceRow({ key: 'x', spend: 10, value: null, ratio: null }), null);
  assert.strictEqual(A.performanceRow({ spend: 10, value: 25 }).ratio, 2.5);
});

test('leaderboard: one row per platform unit, banded by the Jarvis thresholds, low spend not judged, shares sum to 100', function () {
  var s = A.buildSeries({ embedded: perfRows('2026-11-04'), mer: null });
  var lb = A.leaderboard(s, '2026-11-04', SETTINGS);
  var by = {}; lb.rows.forEach(function (r) { by[r.id] = r; });
  assert.strictEqual(by.snapchat_ads.band, 'raise');
  assert.strictEqual(by.tiktok_shop.band, 'raise');
  assert.strictEqual(by.meta.band, 'hold');
  assert.strictEqual(by.tiktok_web.band, 'hold');
  assert.strictEqual(by.google_ads.band, 'cut');
  assert.strictEqual(by.bing_ads.band, 'low');             // $140 in 7d < $200 min_spend_7d
  assert.strictEqual(lb.rows[0].id, 'snapchat_ads');       // judged rows first, by ROAS
  assert.strictEqual(lb.rows[lb.rows.length - 1].id, 'bing_ads');
  assert.strictEqual(lb.above, 2); assert.strictEqual(lb.hold, 2); assert.strictEqual(lb.below, 1);
  var share = 0; lb.rows.forEach(function (r) { share += r.spendShare; });
  assert.ok(Math.abs(share - 100) < 1e-6);
  assert.strictEqual(lb.pooled.roas, Math.round((24000 + 3015 + 6000 + 3000 + 3500 + 200) / (9990 + 2010 + 1500 + 1500 + 500 + 20) * 100) / 100);
  assert.deepStrictEqual(lb.noRead, []);
  assert.strictEqual(A.band(2.8, 1000, lb.thresholds), 'raise');
  assert.strictEqual(A.band(1.99, 1000, lb.thresholds), 'cut');
  assert.strictEqual(A.band(5, 100, lb.thresholds), 'low');
  assert.strictEqual(A.band(null, 1000, lb.thresholds), 'none');
  assert.strictEqual(A.thresholds(null).source.indexOf('defaults'), 0);
});

test('heatmap: a day with no platform read is null (never 0x); under-$100 days are shown but not judged', function () {
  var rows = perfRows('2026-11-04');
  rows[rows.length - 1].performance = null;              // 11/04 not read yet
  var s = A.buildSeries({ embedded: rows, mer: null });
  var hm = A.heatmap(s, '2026-11-04', 14, SETTINGS);
  assert.strictEqual(hm.dates.length, 14);
  var meta = hm.rows.filter(function (r) { return r.id === 'meta'; })[0];
  assert.strictEqual(hm.rows[0].id, 'meta');             // ordered by window spend
  assert.strictEqual(meta.cells[13].ratio, null); assert.strictEqual(meta.cells[13].band, 'none');
  assert.strictEqual(meta.cells[12].ratio, 2.4); assert.strictEqual(meta.cells[12].band, 'hold');
  assert.strictEqual(meta.cells[0].ratio, null);          // before the 10-day fixture
  var bing = hm.rows.filter(function (r) { return r.id === 'bing_ads'; })[0];
  assert.strictEqual(bing.cells[12].low, true); assert.strictEqual(bing.cells[12].band, 'low');
});

test('action markers land on their window index with a short label; closed rows feed the Shop/DTC MER strip', function () {
  var dates = A.windowDates('2026-11-04', 14);
  var changes = [
    { date: '2026-10-30', channel: 'snapchat', action: 'raise_20pct', old_budget: 350, new_budget: 420, by: 'jarvis' },
    { date: '2026-10-30', channel: 'snapchat', action: 'raise_20pct', old_budget: 350, new_budget: 420, by: 'jarvis' },
    { date: '2026-10-29', channel: 'google', action: 'cut_20pct_and_change_strategy' },
    { date: '2026-10-30', channel: 'chatgpt', action: 'kill_under_1x' },
    { date: '2026-09-01', channel: 'meta', action: 'raise_20pct' }
  ];
  var m = A.actionMarkers(changes, dates);
  assert.deepStrictEqual(m.map(function (x) { return x.label; }), ['Google −20%', 'ChatGPT kill', 'Snap +20%']);
  assert.strictEqual(m[2].idx, dates.indexOf('2026-10-30'));
  var rows = perfRows('2026-11-04').concat([{ date: '2026-10-20', report_status: 'estimated', shop_revenue: 30000, shop_ad_spend: 12000, shop_mer: 2.5 }]);
  var s = A.buildSeries({ embedded: rows, mer: null });
  var md = A.merDaily(s, A.windowDates('2026-11-04', 16));
  assert.strictEqual(md[0].date, '2026-10-20'); assert.strictEqual(md[0].mer, 2.5);
  assert.strictEqual(md[1].mer, null);
  assert.strictEqual(md[15].mer, 2.09);                   // 20900 / 10000
});

test('a mer row newer than the page and mer.as_of (today, partial) never ends the window', function () {
  var rows = perfRows('2026-11-04', 14);
  var adv = {};
  adv['2026-11-05'] = { snapchat_ads: { spend: 120, live: true, source: 'manual' }, applovin: { spend: 150 } };
  var s = A.buildSeries({ embedded: rows, mer: { as_of: '2026-11-04', advertising_sources: adv } });
  assert.strictEqual(s.spendThrough, '2026-11-04');
  assert.deepStrictEqual(s.partialDates, ['2026-11-05']);
  var snap = A.channelStats(A.CHANNELS.filter(function (c) { return c.id === 'snapchat'; })[0], s, {}, s.spendThrough);
  assert.strictEqual(snap.growth.code, 'flat');
});

test('canonical aliases join microsoft_ads / Microsoft Ads onto bing', function () {
  assert.strictEqual(A.canonicalId('microsoft_ads'), 'bing');
  assert.strictEqual(A.canonicalId('Microsoft Ads'), 'bing');
  assert.strictEqual(A.canonicalId('google_advertising'), 'google');
  assert.strictEqual(A.canonicalId('openai_ads'), 'chatgpt');
  assert.strictEqual(A.canonicalId('twitter_ads'), 'x');
  var bing = A.CHANNELS.filter(function (c) { return c.id === 'bing'; })[0];
  var node = A.nodeFromAdv({ microsoft_ads: { spend: 12, complete: true } }, bing);
  assert.strictEqual(A.spendFromNode(bing, node), 12);
});

test('stubs, JSON null, and unmeasured $0 are missing — not published zeros', function () {
  var bing = A.CHANNELS.filter(function (c) { return c.id === 'bing'; })[0];
  assert.strictEqual(A.isPlaceholderNode({ status: 'pre_launch', spend: 0, daily: [] }), true);
  assert.strictEqual(A.isPlaceholderNode({ status: 'no_feed', spend: 0, daily: [] }), true);
  assert.strictEqual(A.spendFromNode(bing, { spend: 0, source: 'no_feed' }), null);
  assert.strictEqual(A.spendFromNode(bing, { spend: 0 }), null, 'bare $0 without complete is missing');
  assert.strictEqual(A.spendFromNode(bing, { spend: 0, complete: true }), 0);
  assert.strictEqual(A.isMeasuredZero({ spend: 0, closed_day: true }), true);
  assert.strictEqual(A.spendFromNode(bing, null), null);
  var s = A.buildSeries({
    embedded: [{ date: '2026-11-04', report_status: 'partial', advertising_sources: { bing_ads: null, meta: day('2026-11-04', 100) } }],
    channelFiles: { bing: { status: 'pre_launch', spend: 0, daily: [] } }
  });
  assert.strictEqual(s.channels.bing.days['2026-11-04'] && s.channels.bing.days['2026-11-04'].spend, undefined);
  assert.strictEqual(s.channels.meta.days['2026-11-04'].spend, 100);
});

test('advertising_sources_daily and *_ads_daily fill PARTIAL holes; first published spend wins', function () {
  var inp = {
    embedded: [
      { date: '2026-11-03', report_status: 'partial', advertising_sources: { meta: day('2026-11-03', 1000) } },
      { date: '2026-11-04', report_status: 'partial', advertising_sources: { meta: day('2026-11-04', 1100) } }
    ],
    advertisingSourcesDaily: {
      '2026-11-03': { meta: { spend: 9999, complete: true }, bing_ads: { spend: 40, complete: true, platform_revenue: 80, conversions: 2, roas: 2 } },
      '2026-11-05': { meta: { spend: 1200, complete: true }, microsoft_ads: { spend: 50, complete: true, platform_revenue: 100, conversions: 1 } }
    },
    dailyFiles: {
      bing: { '2026-11-06': { spend: 60, complete: true, platform_revenue: 90 } },
      taboola: { '2026-11-03': { spend: 200, complete: true, platform_revenue: 40 }, '2026-11-04': { spend: 305.29, complete: true, platform_revenue: 10 } }
    }
  };
  var s = A.buildSeries(inp);
  assert.strictEqual(s.channels.meta.days['2026-11-03'].spend, 1000, 'PARTIAL wins over advertising_sources_daily');
  assert.strictEqual(s.channels.meta.days['2026-11-05'].spend, 1200, 'daily export fills the 11/5 hole');
  assert.strictEqual(s.channels.bing.days['2026-11-03'].spend, 40);
  assert.strictEqual(s.channels.bing.days['2026-11-05'].spend, 50, 'microsoft_ads alias');
  assert.strictEqual(s.channels.bing.days['2026-11-06'].spend, 60);
  assert.strictEqual(s.channels.bing.days['2026-11-03'].hasPlatform, true);
  assert.strictEqual(s.channels.bing.days['2026-11-03'].revenue, 80);
  assert.strictEqual(s.channels.taboola.days['2026-11-03'].spend, 200);
  assert.strictEqual(s.channels.taboola.days['2026-11-04'].spend, 305.29);
  assert.strictEqual(s.spendThrough, '2026-11-06');
  var bing = A.channelStats(A.CHANNELS.filter(function (c) { return c.id === 'bing'; })[0], s, inp, '2026-11-06');
  assert.strictEqual(bing.platformRev7, 270);
  assert.ok(bing.roas7 != null);
});

test('synthetic $0 after a durable stop is missing; measured paused zeros stay $0', function () {
  var inp = {
    mer: {
      as_of: '2026-11-04',
      advertising_sources: {
        '2026-10-29': { bing_ads: { spend: 80, complete: true, live: true, source: 'Pipeboard Bing' } },
        '2026-10-30': { bing_ads: { spend: 90, complete: true, live: true, source: 'Pipeboard Bing' } },
        '2026-10-31': { bing_ads: { spend: 0, live: true, source: 'copied' } },
        '2026-11-01': { bing_ads: { spend: 0, complete: true, live: false, status: 'not_live' } },
        '2026-11-02': { bing_ads: { spend: 0, zero_assumed: true } },
        '2026-11-03': { outbrain_ads: { spend: 0, complete: true, live: false, status: 'not_launched' } },
        '2026-11-04': { outbrain_ads: { spend: 0, closed_day: true, live: false, status: 'not_launched' } }
      }
    }
  };
  var s = A.buildSeries(inp);
  assert.strictEqual(s.channels.bing.days['2026-10-30'].spend, 90);
  assert.ok(!s.channels.bing.days['2026-10-31'] || s.channels.bing.days['2026-10-31'].spend == null, 'unmeasured $0 after stop is missing');
  assert.strictEqual(s.channels.bing.days['2026-11-01'].spend, 0, 'complete paused $0 via mer stays measured');
  assert.ok(!s.channels.bing.days['2026-11-02'] || s.channels.bing.days['2026-11-02'].spend == null, 'zero_assumed is synthetic');
  assert.ok(s.channels.bing.durableThrough >= '2026-11-01');
  assert.strictEqual(s.channels.outbrain.days['2026-11-03'].spend, 0);
  assert.strictEqual(s.channels.outbrain.days['2026-11-04'].spend, 0);
  var bing = A.channelStats(A.CHANNELS.filter(function (c) { return c.id === 'bing'; })[0], s, inp, '2026-11-04');
  assert.strictEqual(bing.spend7, 170, 'measured days only; unmarked holes are not $0');
  assert.strictEqual(bing.spend7Days, 3);
  assert.strictEqual(bing.growth.code, 'incomplete');
  assert.strictEqual(A._fmt.usd(bing.yday), '—');
  var staleInp = {
    mer: {
      as_of: '2026-10-26',
      bing: { status: 'live', live: true, as_of: '2026-10-26' },
      advertising_sources: {
        '2026-10-26': { bing_ads: { spend: 80, complete: true, live: true } },
        '2026-10-27': { meta: { spend: 1, complete: true } },
        '2026-11-04': { meta: { spend: 1, complete: true } }
      }
    }
  };
  var staleSeries = A.buildSeries(staleInp);
  var staleBing = A.channelStats(A.CHANNELS.filter(function (c) { return c.id === 'bing'; })[0], staleSeries, staleInp, '2026-11-04');
  assert.strictEqual(staleBing.spend7, null);
  assert.ok(staleBing.feed.code === 'stale' || staleBing.growth.code === 'stale');
  assert.notStrictEqual(staleBing.statusLabel, 'LIVE', 'stale mer.live is not LIVE');
  assert.strictEqual(A._fmt.usd(staleBing.spend7), '—');
  var outb = A.channelStats(A.CHANNELS.filter(function (c) { return c.id === 'outbrain'; })[0], s, inp, '2026-11-04');
  assert.strictEqual(outb.spend7, 0);
  assert.strictEqual(outb.spend7Days, 2);
  assert.strictEqual(outb.growth.code, 'incomplete');
});

test('mer-path Pinterest complete $0 after last positive stays measured (paused), not stripped', function () {
  var adv = {
    '2026-10-28': { pinterest_ads: { spend: 60, complete: true, live: true } },
    '2026-10-29': { pinterest_ads: { spend: 50, complete: true, live: true } }
  };
  ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].forEach(function (d) {
    adv[d] = { pinterest_ads: { spend: 0, complete: true, live: false } };
  });
  var inp = { mer: { as_of: '2026-11-04', advertising_sources: adv } };
  var s = A.buildSeries(inp);
  assert.strictEqual(s.channels.pinterest.days['2026-11-04'].spend, 0);
  assert.strictEqual(s.channels.pinterest.days['2026-11-04'].spendKind, 'measured_zero');
  var pin = A.CHANNELS.filter(function (c) { return c.id === 'pinterest'; })[0];
  var st = A.channelStats(pin, s, inp, '2026-11-04');
  assert.strictEqual(st.yday, 0);
  assert.strictEqual(st.spend7Days, 7);
  assert.strictEqual(st.spend7, 50);
  assert.notStrictEqual(st.yday, null);
});

test('asDateMap keeps a 1–2 day backfill when extra keys are metadata', function () {
  var doc = {
    as_of: '2026-11-05',
    source: 'box runner',
    status: 'ok',
    schema_version: 1,
    generated_at: '2026-11-06T00:00:00Z',
    account_id: '18ce55yad5n',
    note: 'two-day backfill',
    '2026-11-04': { spend: 1.43, complete: true },
    '2026-11-05': { spend: 65.62, complete: true }
  };
  var map = A.asDateMap(doc);
  assert.strictEqual(Object.keys(map).sort().join(','), '2026-11-04,2026-11-05');
  assert.strictEqual(map['2026-11-04'].spend, 1.43);
  var nested = A.asDateMap({ advertising_sources: doc });
  assert.strictEqual(nested['2026-11-05'].spend, 65.62);
});

test('no published rows is NO FEED / —, never $0; Taboola unpublished is not launched $0', function () {
  var inp = { embedded: [{ date: '2026-11-04', report_status: 'partial', advertising_sources: { meta: day('2026-11-04', 50) } }] };
  var s = A.buildSeries(inp);
  var x = A.channelStats(A.CHANNELS.filter(function (c) { return c.id === 'x'; })[0], s, inp, s.spendThrough);
  var tab = A.channelStats(A.CHANNELS.filter(function (c) { return c.id === 'taboola'; })[0], s, inp, s.spendThrough);
  assert.strictEqual(x.spend7, null);
  assert.strictEqual(x.growth.code, 'nofeed');
  assert.ok(x.statusLabel === '—' || x.statusLabel === 'NO FEED');
  assert.strictEqual(tab.spend7, null);
  assert.strictEqual(tab.growth.code, 'nofeed');
  assert.ok(tab.statusLabel === 'NOT LAUNCHED' || tab.statusLabel === '—');
  assert.strictEqual(A._fmt.usd(0), '$0');
  assert.strictEqual(A._fmt.usd(null), '—');
});

test('schema contract is exported for CFO publishers', function () {
  assert.strictEqual(A.ADV_DAILY_FILE, 'advertising_sources_daily.json');
  assert.strictEqual(A.dailyFileName({ id: 'bing' }), 'bing_ads_daily.json');
  assert.ok(A.SCHEMA_CONTRACT.advertising_sources_daily);
  assert.ok(A.SCHEMA_CONTRACT.channel_ads_daily);
  assert.ok(/complete/.test(A.SCHEMA_CONTRACT.advertising_sources_daily.measured_zero));
});

test('stale flat mer blocks cannot erase newer embedded spend', function () {
  // The historical 11/4 view had embedded Meta through 11/2 but no durable
  // Bing / ChatGPT rows. Keep that state explicit; current publisher feeds
  // contain later durable rows and are correctly not stale.
  var embedded = liveEmbedded();
  var historicalMer = {
    as_of: '2026-10-26',
    advertising_sources: {},
    chatgpt: { as_of: '2026-10-26', live: true, status: 'live' },
    bing: { as_of: '2026-10-26', live: true, status: 'live' }
  };
  var inp = {
    embedded: embedded, mer: historicalMer, seriesFile: null, dailyFiles: {},
    channelFiles: { bing: require('../bing_ads_data.json'), chatgpt: require('../chatgpt_ads_data.json') }
  };
  historicalMer.ad_channel_throttles = { series_28d: { by_channel: {}, blended: [] } };
  var s = A.buildSeries(inp);
  var chatgpt = A.channelStats(A.CHANNELS.filter(function (c) { return c.id === 'chatgpt'; })[0], s, inp, '2026-11-04');
  var bing = A.channelStats(A.CHANNELS.filter(function (c) { return c.id === 'bing'; })[0], s, inp, '2026-11-04');
  assert.ok(bing.spend7 == null || bing.feed.code === 'stale');
  assert.notStrictEqual(bing.statusLabel, 'LIVE', 'stale mer.live must not paint Bing LIVE');
  assert.notStrictEqual(chatgpt.statusLabel, 'LIVE');
  assert.ok(chatgpt.spend7 == null || chatgpt.feed.code === 'stale');
});

test('current published 11/5 feed is current, not made stale by old embedded rows', function () {
  // Populated by the final 9794dac joint-feed review; see review journal.
  var mer = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'cfo_2026_11_05_mer.json'), 'utf8'));
  var seriesFile = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'cfo_2026_11_05_series.json'), 'utf8'));
  assert.strictEqual(mer.as_of, '2026-11-05');
  var inp = { embedded: liveEmbedded(), mer: mer, seriesFile: seriesFile,
    settings: require('../ads_throttle/settings.json'), changes: require('../ads_throttle/changes.json'),
    rankings: require('../ads_throttle/rankings.json'), tracking: require('../ads_throttle/tracking_health.json'),
    channelFiles: { bing: require('../bing_ads_data.json'), chatgpt: require('../chatgpt_ads_data.json') }
  };
  var s = A.buildSeries(inp);
  assert.strictEqual(s.spendThrough, '2026-11-05');
  var stats = {};
  A.CHANNELS.forEach(function (ch) { stats[ch.id] = A.channelStats(ch, s, inp, '2026-11-05'); });
  assert.strictEqual(stats.meta.yday, 9401.4);
  assert.strictEqual(stats.bing.yday, 97.71);
  // 11/5 mer/series Meta nodes are spend-only (ROAS stays empty). Live PARTIAL_REPORTS may
  // still fill platform ROAS from performance.platforms — that is not invented mer spend.
  var merOnly = A.buildSeries({ mer: mer, seriesFile: seriesFile, channelFiles: inp.channelFiles });
  var merMeta = A.channelStats(A.CHANNELS.filter(function (c) { return c.id === 'meta'; })[0], merOnly, { mer: mer }, '2026-11-05');
  var merGoogle = A.channelStats(A.CHANNELS.filter(function (c) { return c.id === 'google'; })[0], merOnly, { mer: mer }, '2026-11-05');
  assert.strictEqual(merMeta.roas7, null, 'spend-only Meta mer nodes have no platform ROAS');
  assert.strictEqual(merGoogle.roas7, null, 'spend-only Google mer nodes have no platform ROAS');
  var perfDays = Object.keys((s.platforms.meta && s.platforms.meta.days) || {});
  if (perfDays.length) {
    assert.ok(Number.isFinite(stats.meta.roas7) && stats.meta.roas7 > 0);
    assert.strictEqual(stats.meta.platformSource, 'daily report performance.platforms');
  } else {
    assert.strictEqual(stats.meta.roas7, null, 'spend-only Meta has no platform ROAS');
  }
  ['meta', 'bing', 'applovin'].forEach(function (id) {
    assert.notStrictEqual(stats[id].feed.code, 'stale', id);
    assert.strictEqual(stats[id].statusLabel, 'LIVE', id);
  });
  ['pinterest', 'taboola', 'chatgpt'].forEach(function (id) {
    assert.strictEqual(stats[id].yday, 0, id + ' measured paused spend');
    assert.strictEqual(stats[id].statusLabel, 'NOT LIVE', id + ' latest measured paused day is not live');
  });
  assert.strictEqual(stats.spotify.spend7, null);
  assert.strictEqual(stats.spotify.yday, null);
  assert.strictEqual(stats.spotify.statusLabel, 'NOT LAUNCHED');
});

/* ---------------------------------------------------------- Spotify Ads */
function spotifyCh() { return A.CHANNELS.filter(function (c) { return c.id === 'spotify'; })[0]; }
function metaWeeks(end) {
  var adv = {};
  A.windowDates(end, 14).forEach(function (d) { adv[d] = { meta: { spend: 100, complete: true } }; });
  return adv;
}
function spotifyCard(inp, end) {
  var s = A.buildSeries(inp);
  A._state.series = s;
  var st = A.channelStats(spotifyCh(), s, inp, end);
  return { series: s, stats: st, html: A.cardHtml(Object.assign({ share: null }, st), 14, A.windowDates(end, 14)) };
}
function rowFor(html, label) {
  var i = html.indexOf('<td>' + label + '</td>');
  assert.ok(i !== -1, 'row ' + label);
  return html.slice(i, html.indexOf('</tr>', i));
}

test('Spotify: canonical spotify_ads + aliases map to one channel and spotify_ads_daily.json', function () {
  ['spotify_ads', 'spotify', 'Spotify', 'Spotify Ads', 'spotify-ads', 'SPOTIFY_ADS'].forEach(function (k) {
    assert.strictEqual(A.canonicalId(k), 'spotify', k);
  });
  assert.strictEqual(A.dailyFileName(spotifyCh()), 'spotify_ads_daily.json');
  assert.ok(A.SCHEMA_CONTRACT.spotify_ads && /No data/.test(A.SCHEMA_CONTRACT.spotify_ads.missing));
  assert.strictEqual(A.SCHEMA_CONTRACT.advertising_sources_daily.aliases['Spotify Ads'], 'spotify');
  ['Spotify Ads', 'spotify'].forEach(function (k) {
    var adv = metaWeeks('2026-11-05');
    adv['2026-11-05'][k] = { spend: 42, complete: true };
    var s = A.buildSeries({ embedded: [], advertisingSourcesDaily: adv });
    assert.strictEqual(s.channels.spotify.days['2026-11-05'].spend, 42, 'advDaily alias ' + k);
  });
  var s2 = A.buildSeries({ embedded: [], advertisingSourcesDaily: metaWeeks('2026-11-05'), dailyFiles: { spotify: { by_date: { '2026-11-05': { spend: 7, complete: true } } } } });
  assert.strictEqual(s2.channels.spotify.days['2026-11-05'].spend, 7, 'spotify_ads_daily.json');
});

test('Spotify: unavailable → "No data" only; never $0 / LIVE / paused; excluded from tracked spend with coverage', function () {
  var adv = metaWeeks('2026-11-05');
  adv['2026-11-04'].spotify_ads = { spend: 0 };                 // bare $0 = not measured
  adv['2026-11-05'].spotify_ads = { spend: null, missing: true };
  var inp = { embedded: [], advertisingSourcesDaily: adv };
  var c = spotifyCard(inp, '2026-11-05');
  assert.strictEqual(c.stats.spend7, null);
  assert.strictEqual(c.stats.yday, null);
  assert.notStrictEqual(c.stats.statusLabel, 'LIVE');
  assert.strictEqual(c.stats.statusLabel, 'No data');
  assert.strictEqual(c.stats.growth.label, 'No data');
  assert.ok(c.html.indexOf('$0') === -1, 'no $0 anywhere on the unmeasured card');
  assert.ok(c.html.indexOf('missing') === -1 && c.html.indexOf('unverified') === -1);
  assert.ok(/paused/i.test(c.html) === false);
  assert.ok(rowFor(c.html, A._fmt.shortDate('2026-11-05')).indexOf('No data') !== -1);
  var stats = A.CHANNELS.map(function (ch) { return A.channelStats(ch, c.series, inp, '2026-11-05'); });
  var sum = A.summarize(stats, c.series, inp, '2026-11-05');
  assert.strictEqual(sum.tracked7, 700, 'unknown Spotify spend adds nothing to tracked spend');
  assert.ok(sum.unmeasured7.some(function (u) { return u.id === 'spotify' && u.days === 0; }), 'coverage lists Spotify 0/7d');
});

test('Spotify: genuine measured $0 → number only ($0.00), no "No data" on that day', function () {
  var adv = metaWeeks('2026-11-05');
  A.windowDates('2026-11-05', 14).forEach(function (d) { adv[d].spotify_ads = { spend: 0, complete: true, live: false }; });
  var inp = { embedded: [], advertisingSourcesDaily: adv };
  var c = spotifyCard(inp, '2026-11-05');
  assert.strictEqual(c.stats.yday, 0);
  assert.strictEqual(c.stats.spend7, 0);
  assert.strictEqual(c.stats.spend7Days, 7);
  var row = rowFor(c.html, A._fmt.shortDate('2026-11-05'));
  assert.ok(row.indexOf('$0.00') !== -1, row);
  assert.ok(row.indexOf('No data') === -1, 'measured $0 day never says No data: ' + row);
  assert.ok(row.indexOf('missing') === -1 && row.indexOf('unverified') === -1);
});

test('Spotify: spend-only rows keep platform ROAS "No data" (never invented)', function () {
  var adv = metaWeeks('2026-11-05');
  A.windowDates('2026-11-05', 7).forEach(function (d) { adv[d].spotify_ads = { spend: 50, complete: true, revenue: 0, roas: null, clicks: 0 }; });
  var inp = { embedded: [], advertisingSourcesDaily: adv };
  var c = spotifyCard(inp, '2026-11-05');
  assert.strictEqual(c.stats.spend7, 350);
  assert.strictEqual(c.stats.roas7, null);
  assert.strictEqual(c.stats.platformRev7, null);
  assert.ok(c.html.indexOf('<div class="l">Platform ROAS 7d</div><div class="v">No data</div>') !== -1);
  var row = rowFor(c.html, A._fmt.shortDate('2026-11-05'));
  var cells = row.split('<td>').slice(1).map(function (x) { return x.replace(/<\/td>.*/, ''); });
  assert.deepStrictEqual(cells.slice(1), ['$50.00', 'No data', 'No data', 'No data'], 'spend number; platform rev / conv / ROAS No data');
});

test('Spotify: no conflicting labels — each day is a number or "No data", never both', function () {
  var adv = metaWeeks('2026-11-05');
  adv['2026-11-02'].spotify_ads = { spend: 0, complete: true };
  adv['2026-11-03'].spotify_ads = { spend: null, missing: true };
  adv['2026-11-04'].spotify_ads = { spend: 0 };
  adv['2026-11-05'].spotify_ads = { spend: 55.5, spend_status: 'verified' };
  var inp = { embedded: [], advertisingSourcesDaily: adv };
  var c = spotifyCard(inp, '2026-11-05');
  var expect = { '2026-11-02': '$0.00', '2026-11-03': 'No data', '2026-11-04': 'No data', '2026-11-05': '$55.50' };
  Object.keys(expect).forEach(function (d) {
    var row = rowFor(c.html, A._fmt.shortDate(d));
    var spendCell = row.split('<td>')[2].replace(/<\/td>.*/, '');
    assert.strictEqual(spendCell, expect[d], d);
    if (expect[d] === 'No data') assert.ok(!/\$\d/.test(row), 'no number on a No data day ' + d + ': ' + row);
    else if (expect[d] === '$0.00') assert.ok(row.indexOf('No data') === -1, 'no No data on measured $0 ' + d);
    assert.ok(row.indexOf('missing') === -1 && row.indexOf('unverified') === -1);
  });
  assert.ok(c.html.indexOf('missing days are not $0') === -1, 'Spotify card uses "No data for …" coverage wording');
});

test('Spotify: cash_cost kept separate from platform spend (mirrors X)', function () {
  var adv = metaWeeks('2026-11-05');
  adv['2026-11-05'].spotify_ads = { spend: 100, cash_cost: 130, complete: true };
  var inp = { embedded: [], advertisingSourcesDaily: adv };
  var c = spotifyCard(inp, '2026-11-05');
  assert.strictEqual(c.series.channels.spotify.days['2026-11-05'].spend, 100);
  assert.strictEqual(c.series.channels.spotify.days['2026-11-05'].cash_cost, 130);
  assert.strictEqual(c.stats.yday, 100);
  assert.strictEqual(c.stats.ydayCash, 130);
  assert.strictEqual(c.stats.spend7, 100, 'cash cost never added to spend');
  assert.ok(c.html.indexOf('cash $130') !== -1);
});

test('Spotify: not-launched config → NOT LAUNCHED with no metrics; absence alone is not paused', function () {
  var adv = metaWeeks('2026-11-05');
  var inp = { embedded: [], advertisingSourcesDaily: adv, settings: { channels: { spotify_ads: { not_launched_while_zero: true } } } };
  var c = spotifyCard(inp, '2026-11-05');
  assert.strictEqual(c.stats.statusLabel, 'NOT LAUNCHED');
  assert.strictEqual(c.stats.posture.code, 'not_live');
  assert.strictEqual(c.stats.spend7, null);
  assert.strictEqual(c.stats.roas7, null);
  assert.ok(c.html.indexOf('$') === -1, 'no metrics on a not-launched card');
  var inp2 = { embedded: [], advertisingSourcesDaily: adv, mer: { as_of: '2026-11-05', spotify: { status: 'not_launched', live: false } } };
  assert.strictEqual(spotifyCard(inp2, '2026-11-05').stats.statusLabel, 'NOT LAUNCHED');
  var bare = spotifyCard({ embedded: [], advertisingSourcesDaily: adv }, '2026-11-05');
  assert.notStrictEqual(bare.stats.posture.code, 'killed');
  assert.notStrictEqual(bare.stats.statusLabel, 'NOT LIVE');
  assert.strictEqual(bare.stats.statusLabel, 'No data');
});

var SPOTIFY_CAP = require('./fixtures/spotify_ads_config.json');
var SPOTIFY_CAP_LABEL = 'Planned test cap: $300 total (lifetime) — $100 each: Drive-Thru, 32oz GO, 128oz Limitless Gallon';

test('Spotify: planned cap present is a labelled plan, separate from No data spend, excluded from MER', function () {
  var adv = metaWeeks('2026-11-05');
  var inp = { embedded: [], advertisingSourcesDaily: adv, mer: { as_of: '2026-11-05', spend_7d: 700, rev_7d: 1400, mer_7d_pooled: 2, spotify_ads_config: SPOTIFY_CAP } };
  assert.strictEqual(A.spotifyPlannedCapLabel(SPOTIFY_CAP), SPOTIFY_CAP_LABEL);
  assert.strictEqual(A.spotifyPlannedCapLabel({ spotify_ads: { planned_cap: 300, cap_type: 'lifetime_test', per_ad: SPOTIFY_CAP.per_ad } }), SPOTIFY_CAP_LABEL);
  var c = spotifyCard(inp, '2026-11-05');
  assert.strictEqual(c.stats.yday, null);
  assert.strictEqual(c.stats.spend7, null);
  assert.strictEqual(c.stats.roas7, null);
  assert.strictEqual(c.stats.statusLabel, 'No data');
  assert.strictEqual(c.stats.plannedCapLabel, SPOTIFY_CAP_LABEL);
  assert.ok(c.html.indexOf(SPOTIFY_CAP_LABEL) !== -1, 'cap label on the card');
  assert.ok(c.html.indexOf('class="ac-cap"') !== -1);
  var yday = c.html.match(/<div class="l">Yesterday<\/div><div class="v">([^<]*)<\/div>/);
  var spend7 = c.html.match(/<div class="l">7-day spend<\/div><div class="v">([^<]*)<\/div>/);
  var roas = c.html.match(/<div class="l">Platform ROAS 7d<\/div><div class="v">([^<]*)<\/div>/);
  assert.ok(yday && yday[1] === 'No data', 'yesterday spend stays No data: ' + (yday && yday[1]));
  assert.ok(spend7 && spend7[1] === 'No data', '7-day spend stays No data: ' + (spend7 && spend7[1]));
  assert.ok(roas && roas[1] === 'No data', 'ROAS stays No data');
  assert.ok(c.html.indexOf('$0') === -1, 'cap is not painted as $0 spend');
  var stats = A.CHANNELS.map(function (ch) { return A.channelStats(ch, c.series, inp, '2026-11-05'); });
  var withCap = A.summarize(stats, c.series, inp, '2026-11-05');
  var without = A.summarize(stats, c.series, { embedded: [], advertisingSourcesDaily: adv, mer: { as_of: '2026-11-05', spend_7d: 700, rev_7d: 1400, mer_7d_pooled: 2 } }, '2026-11-05');
  assert.strictEqual(withCap.tracked7, 700);
  assert.strictEqual(without.tracked7, 700);
  assert.strictEqual(withCap.tracked7, without.tracked7, 'cap does not change tracked spend');
  assert.deepStrictEqual(withCap.blended, without.blended, 'cap does not change blended MER');
  assert.strictEqual(withCap.blended.mer, 2);
});

test('Spotify: planned cap absent renders nothing (never hardcoded)', function () {
  var adv = metaWeeks('2026-11-05');
  var c = spotifyCard({ embedded: [], advertisingSourcesDaily: adv }, '2026-11-05');
  assert.strictEqual(c.stats.plannedCapLabel, '');
  assert.ok(c.html.indexOf('Planned test cap') === -1);
  assert.ok(c.html.indexOf('$300') === -1);
  assert.ok(c.html.indexOf('Drive-Thru') === -1);
  assert.strictEqual(A.spotifyPlannedCapLabel({}), '');
  assert.strictEqual(A.spotifyPlannedCapLabel({ spotify: { status: 'pre_launch', live: false, spend: null } }), '');
  assert.strictEqual(A.spotifyPlannedCapLabel({ bing: { planned_daily_budget: 1000 } }), '');
  var mer = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'cfo_2026_11_05_mer.json'), 'utf8'));
  assert.strictEqual(A.spotifyPlannedCapLabel(mer), '', '11/5 fixture has no cap fields');
});

if (failed) {
  console.error(failed + ' ad-channel test(s) failed');
  process.exit(1);
}
console.log('ad-channel tests passed');
