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

test('live page data: every channel resolves, no NaN, Meta ROAS stays — on spend-only feed', function () {
  var fs = require('fs');
  var path = require('path');
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var m = html.match(/^const PARTIAL_REPORTS\s*=\s*(\[.*?\]);\s*$/m);
  var r = html.match(/^const REPORTS\s*=\s*(\[.*?\]);\s*$/m);
  var embedded = [].concat(m ? JSON.parse(m[1]) : [], r ? JSON.parse(r[1]) : []);
  var inp = { embedded: embedded, mer: require('../mer_for_manus.json'), settings: require('../ads_throttle/settings.json'), changes: require('../ads_throttle/changes.json'), rankings: require('../ads_throttle/rankings.json'), tracking: require('../ads_throttle/tracking_health.json'), seriesFile: require('../ads_throttle/series.json') };
  var s = A.buildSeries(inp);
  assert.ok(s.spendThrough >= '2026-11-01');
  var stats = A.CHANNELS.map(function (ch) { return A.channelStats(ch, s, inp, s.spendThrough); });
  stats.forEach(function (st) {
    ['spend7', 'prev7', 'spend30'].forEach(function (k) { assert.ok(Number.isFinite(st[k]), st.ch.id + '.' + k); });
    if (st.roas7 != null) assert.ok(Number.isFinite(st.roas7));
    assert.ok(st.posture && st.posture.label);
  });
  var meta = stats.filter(function (x) { return x.ch.id === 'meta'; })[0];
  assert.ok(meta.spend7 > 0);
  assert.strictEqual(meta.roas7, null);
});

if (failed) {
  console.error(failed + ' ad-channel test(s) failed');
  process.exit(1);
}
console.log('ad-channel tests passed');
