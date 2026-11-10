'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var M = require('../ad_loop_module.js');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) { failed += 1; console.error('FAIL - ' + name); console.error('     ' + (e && e.stack ? e.stack : e)); }
}

var health = {
  as_of: '2026-11-08',
  summary: { status: 'degraded', as_of_lag_days: 0, channels_stale: ['bing'], grok_files_stale: ['tracking_health'] },
  channels: {
    snapchat: { status: 'fresh', last_measured_day: '2026-11-08', days_behind: 0, days_14: '-0############', window_14: '2026-10-26..2026-11-08' },
    bing: { status: 'stale', last_measured_day: '2026-11-05', days_behind: 3, days_14: '###########...', window_14: '2026-10-26..2026-11-08' },
    spotify: { status: 'quiet', last_measured_day: null, days_behind: null, days_14: '..............', window_14: '2026-10-26..2026-11-08' }
  },
  files: {
    tracking_health: { file: 'ads_throttle/tracking_health.json', as_of: '2026-10-31T08:40:00-04:00', age_days: 9, status: 'stale', writer: 'Jarvis (daily)' },
    settings: { file: 'ads_throttle/settings.json', as_of: '2026-10-28T08:30:00-04:00', age_days: 12, status: 'info' }
  }
};
var brief = {
  as_of: '2026-11-08',
  portfolio: { mer_7d: 1.9863, mer_target: 3.24, mer_gap: -1.25, spend_judged_pct: 75.3, spend_in_auto_mode_pct: 18.2 },
  summary: { act_now: ['snapchat'], open_asks: 2, open_asks_high: 1 },
  channels: {
    bing: { label: 'Bing', mode: 'auto', verdict: 'insufficient', rule_says: 'Not enough data', actionable: false,
      blockers: ['feed_gap:4/7 days measured'], spend_7d: 307.26, spend_days_measured: 4, roas_7d: null, grok: { roas_7d: 4.2, tier: 'Steady', tier_label: 'Steady', as_of: '2026-11-09' } },
    snapchat: { label: 'Snapchat', mode: 'auto', owner_bot: 'snapchat ads bot', verdict: 'raise', rule_says: 'Scale +20%', actionable: true,
      blockers: [], spend_7d: 3791.93, spend_days_measured: 7, roas_7d: 8.67, roas_prior_7d: 7.1, grok: { roas_7d: 8.37, tier: 'Lead', tier_label: 'Lead (view-through caveat)' } },
    spotify: { label: 'Spotify', mode: 'view', verdict: 'made_up', rule_says: 'Not enough data', actionable: false, blockers: ['mode:view'], spend_7d: null }
  },
  asks: [
    { id: 'feed.bing', severity: 'high', title: 'Bing: no measured row since 2026-11-05', detail: 'write rows', owner: 'Bing Ads bot', age_days: 2, ack: { status: 'working', note: 're-pulling' } },
    { id: 'settings.daily_budget.unknown', severity: 'low', title: 'budget unknown', detail: '', age_days: 5, ack: { status: 'wont_do' } },
    { id: 'file.tracking_health.stale', severity: 'high', title: 'tracking_health.json is 9 days old', detail: '', age_days: 0 }
  ],
  change_outcomes: [
    { date: '2026-10-30', channel: 'snapchat', action: 'raise_20pct', executed: true, outcome: 'improved', partial_window: true,
      before: { roas: 7.61, spend: 1467.59 }, after: { roas: 9.01, spend: 3421.78 }, roas_change_pct: 18.4 },
    { date: '2026-10-29', channel: 'google', action: 'cut_20pct_and_change_strategy', executed: false, outcome: 'worse', before: { roas: 3.19 }, after: { roas: 1.53 } },
    { date: '2026-11-06', channel: 'bing', action: 'cut_20pct', outcome: 'pending', ready_on: '2026-11-14', before: {} }
  ]
};

test('kpis pass the feed numbers through untouched', function () {
  var k = M.kpis(brief, health);
  assert.strictEqual(k.asOf, '2026-11-08'); assert.strictEqual(k.feedStatus, 'degraded');
  assert.strictEqual(k.mer7d, 1.9863); assert.strictEqual(k.judgedPct, 75.3); assert.strictEqual(k.autoPct, 18.2);
  assert.deepStrictEqual(k.actNow, ['snapchat']); assert.strictEqual(k.openAsks, 2); assert.strictEqual(k.openHigh, 1);
  assert.deepStrictEqual(k.stale, ['bing']);
  var empty = M.kpis(null, null);
  assert.strictEqual(empty.mer7d, null); assert.deepStrictEqual(empty.actNow, []);
});

test('board rows: sorted by spend, missing stays null, unknown verdict is "no read"', function () {
  var rows = M.boardRows(brief, health);
  assert.deepStrictEqual(rows.map(function (r) { return r.id; }), ['snapchat', 'bing', 'spotify']);
  var snap = rows[0], bing = rows[1], spot = rows[2];
  assert.strictEqual(snap.verdict, 'raise'); assert.strictEqual(snap.actionable, true); assert.strictEqual(snap.roas, 8.67);
  assert.strictEqual(snap.grokTier, 'Lead (view-through caveat)'); assert.strictEqual(snap.feed, 'fresh');
  assert.strictEqual(bing.roas, null); assert.strictEqual(bing.spendDays, 4); assert.strictEqual(bing.grokRoas, 4.2);
  assert.deepStrictEqual(bing.blockers, ['feed gap (4/7 days measured)']); assert.strictEqual(bing.behind, 3);
  assert.strictEqual(spot.verdict, 'insufficient'); assert.strictEqual(spot.spend, null); assert.strictEqual(spot.grokRoas, null);
  assert.deepStrictEqual(spot.blockers, ['view mode']);
});

test('blocker wording', function () {
  assert.strictEqual(M.blockerText('spend_stopped:2026-11-04'), 'spend stopped after 11/4');
  assert.strictEqual(M.blockerText('roas_disputed'), 'CFO and Grok disagree');
  assert.strictEqual(M.blockerText('no_platform_revenue:5/7 days'), 'no platform revenue (5/7 days)');
  assert.strictEqual(M.blockerText('cooldown'), 'cooldown');
});

test('day strip: one dated cell per day, a missing day is never drawn as zero', function () {
  var cells = M.dayCells('###########...', '2026-10-26..2026-11-08');
  assert.strictEqual(cells.length, 14);
  assert.strictEqual(cells[0].date, '2026-10-26'); assert.strictEqual(cells[13].date, '2026-11-08');
  assert.strictEqual(cells[10].state, 'spend'); assert.strictEqual(cells[13].state, 'missing');
  assert.notStrictEqual(cells[13].cls, M.dayCells('0', '2026-11-08..2026-11-08')[0].cls);
  assert.strictEqual(M.dayCells('-0', '2026-10-31..2026-11-01')[1].date, '2026-11-01'); // month rollover
  assert.strictEqual(M.dayCells('?', null)[0].state, 'missing');
  assert.deepStrictEqual(M.dayCells('', null), []);
});

test('asks: wont_do and done are closed, working stays open with its note', function () {
  var rows = M.askRows(brief);
  assert.deepStrictEqual(rows.filter(function (r) { return r.open; }).map(function (r) { return r.id; }), ['feed.bing', 'file.tracking_health.stale']);
  assert.strictEqual(rows[0].ack, 'working'); assert.strictEqual(rows[0].ackNote, 're-pulling'); assert.strictEqual(rows[2].ack, null);
  assert.deepStrictEqual(M.askRows({}), []);
});

test('change outcomes keep before/after as published', function () {
  var rows = M.outcomeRows(brief);
  assert.strictEqual(rows[0].outcome, 'improved'); assert.strictEqual(rows[0].roasBefore, 7.61); assert.strictEqual(rows[0].roasAfter, 9.01);
  assert.strictEqual(rows[0].partial, true); assert.strictEqual(rows[0].action, 'raise 20pct');
  assert.strictEqual(rows[1].executed, false);
  assert.strictEqual(rows[2].outcome, 'pending'); assert.strictEqual(rows[2].readyOn, '2026-11-14'); assert.strictEqual(rows[2].roasAfter, null);
});

test('file rows', function () {
  var rows = M.fileRows(health);
  assert.strictEqual(rows[0].status, 'stale'); assert.strictEqual(rows[0].age, 9); assert.strictEqual(rows[1].status, 'info');
});

test('index.html loads the module once, after the other tab modules', function () {
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.strictEqual((html.match(/<script src="ad_loop_module.js"><\/script>/g) || []).length, 1);
  assert.ok(html.indexOf('ad_loop_module.js') > html.indexOf('ad_channels_module.js'));
});

test('published feeds, when present, have the shape the tab reads', function () {
  var dir = path.join(__dirname, '..', 'ads_throttle');
  if (!fs.existsSync(path.join(dir, 'cfo_brief.json'))) return;
  var b = JSON.parse(fs.readFileSync(path.join(dir, 'cfo_brief.json'), 'utf8'));
  var h = JSON.parse(fs.readFileSync(path.join(dir, 'feed_health.json'), 'utf8'));
  var rows = M.boardRows(b, h);
  assert.ok(rows.length >= 10);
  rows.forEach(function (r) {
    assert.ok(M.VERDICT[r.verdict], r.id);
    assert.strictEqual(M.dayCells(r.strip, r.window).length, 14, r.id);
    if (r.actionable) { assert.strictEqual(r.mode, 'auto', r.id); assert.deepStrictEqual(r.blockers, [], r.id); }
  });
});

if (failed) { console.error(failed + ' failing'); process.exit(1); }
console.log('ad loop module: all tests passed');
