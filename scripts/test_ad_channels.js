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
  assert.strictEqual(meta.roas7, null);
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

test('false zeros after a durable stop are stripped; measured zeros on a live feed stay', function () {
  var inp = {
    mer: {
      as_of: '2026-11-04',
      advertising_sources: {
        '2026-10-29': { bing_ads: { spend: 80, complete: true, live: true, source: 'Pipeboard Bing' } },
        '2026-10-30': { bing_ads: { spend: 90, complete: true, live: true, source: 'Pipeboard Bing' } },
        '2026-10-31': { bing_ads: { spend: 0, live: true, source: 'copied' } },
        '2026-11-01': { bing_ads: { spend: 0, complete: true, live: true, source: 'copied-complete' } },
        '2026-11-03': { outbrain_ads: { spend: 0, complete: true, live: false, status: 'not_launched' } },
        '2026-11-04': { outbrain_ads: { spend: 0, closed_day: true, live: false, status: 'not_launched' } }
      }
    }
  };
  var s = A.buildSeries(inp);
  assert.strictEqual(s.channels.bing.days['2026-10-30'].spend, 90);
  assert.ok(!s.channels.bing.days['2026-10-31'] || s.channels.bing.days['2026-10-31'].spend == null, 'unmeasured $0 after stop is missing');
  assert.ok(!s.channels.bing.days['2026-11-01'] || s.channels.bing.days['2026-11-01'].spend == null, 'copied complete $0 after durable stop is stripped');
  assert.strictEqual(s.channels.bing.durableThrough, '2026-10-30');
  assert.strictEqual(s.channels.outbrain.days['2026-11-03'].spend, 0);
  assert.strictEqual(s.channels.outbrain.days['2026-11-04'].spend, 0);
  var bing = A.channelStats(A.CHANNELS.filter(function (c) { return c.id === 'bing'; })[0], s, inp, '2026-11-04');
  assert.strictEqual(bing.spend7, 170, 'only the two measured days, missing days not $0');
  assert.strictEqual(bing.spend7Days, 2);
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

test('screenshot window ending 11/4: unpublished channels are not painted $0 LIVE', function () {
  var embedded = liveEmbedded();
  var stubs = {
    bing: require('../bing_ads_data.json'),
    chatgpt: require('../chatgpt_ads_data.json'),
    reddit: require('../reddit_ads_data.json'),
    snapchat: require('../snapchat_ads_data.json'),
    pinterest: require('../pinterest_ads_data.json')
  };
  var inp = { embedded: embedded, mer: require('../mer_for_manus.json'), settings: require('../ads_throttle/settings.json'), changes: require('../ads_throttle/changes.json'), rankings: require('../ads_throttle/rankings.json'), tracking: require('../ads_throttle/tracking_health.json'), seriesFile: require('../ads_throttle/series.json'), channelFiles: stubs };
  var s = A.buildSeries(inp);
  var end = s.spendThrough >= '2026-11-04' ? '2026-11-04' : s.spendThrough;
  var byId = {};
  A.CHANNELS.forEach(function (ch) { byId[ch.id] = A.channelStats(ch, s, inp, end); });
  assert.ok(byId.meta.spend7 > 0);
  assert.strictEqual(byId.meta.roas7, null);
  assert.notStrictEqual(byId.bing.statusLabel, 'LIVE', 'stale mer.live must not paint Bing LIVE');
  assert.ok(byId.bing.spend7 == null || byId.bing.feed.code === 'stale');
  assert.strictEqual(A._fmt.usd(byId.bing.yday), '—');
  assert.strictEqual(byId.chatgpt.statusLabel, 'STALE');
  assert.strictEqual(byId.chatgpt.posture.code, 'killed');
  assert.strictEqual(A._fmt.usd(byId.chatgpt.spend7), '—');
  ['taboola', 'outbrain', 'x'].forEach(function (id) {
    assert.strictEqual(byId[id].spend7, null, id + ' 7d is missing, not $0');
    assert.ok(byId[id].growth.code === 'nofeed' || byId[id].statusLabel === 'NOT LAUNCHED');
  });
  assert.ok(byId.bing.spend30 == null || byId.bing.spend30Days < 30, '30d must not silently fill the unpublished week');
});

if (failed) {
  console.error(failed + ' ad-channel test(s) failed');
  process.exit(1);
}
console.log('ad-channel tests passed');
