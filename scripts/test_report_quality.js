'use strict';

var assert = require('assert');
var Q = require('../report_quality_module.js');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) {
    failed += 1;
    console.error('FAIL - ' + name);
    console.error('     ' + (e && e.stack ? e.stack : e));
  }
}

var DAY = '2026-10-27'; // Tuesday

function obs(v) {
  var out = {};
  Q.CHANNELS.forEach(function (k) {
    var x = v[k];
    out[k] = x === null ? { revenue: 0, data_available: false, zero_assumed: true } : { revenue: x, data_available: true, zero_assumed: false };
  });
  return out;
}

function partial(date, v, revenue) {
  var ch = obs(v);
  var sum = Q.CHANNELS.reduce(function (s, k) { return s + (v[k] || 0); }, 0);
  return { date: date, report_status: 'partial', channel_observations: ch, provisional_totals: { revenue: revenue == null ? sum : revenue, net_profit: -100 } };
}

var usual = { shopify: 20000, amazon: 12000, tiktok: 20000, whatnot: 8000 };
var history = ['2026-10-20', '2026-10-13', '2026-10-06', '2026-09-29'].map(function (d) { return partial(d, usual); });
function with_(today, extra) { return Q.series([], history.concat([partial(DAY, today, extra)])); }

test('missing Whatnot on a usual show day is a hole, not a loss', function () {
  var q = Q.assess(DAY, with_({ shopify: 20000, amazon: 12000, tiktok: 20000, whatnot: null }));
  assert.strictEqual(q.incomplete, true);
  assert.deepStrictEqual(q.missing.map(function (m) { return [m.label, m.usual]; }), [['Whatnot', 8000]]);
  assert.strictEqual(Q.chip(q).text, 'Whatnot missing');
  assert.ok(/usual Tuesday ≈ \$8,000/.test(Q.checks(q)[0]));
});

test('missing Whatnot on a usual no-show weekday is expected', function () {
  var noShow = ['2026-10-20', '2026-10-13'].map(function (d) { return partial(d, { shopify: 20000, amazon: 12000, tiktok: 20000, whatnot: null }); });
  var q = Q.assess(DAY, Q.series([], noShow.concat([partial(DAY, { shopify: 20000, amazon: 12000, tiktok: 20000, whatnot: null })])));
  assert.strictEqual(q.incomplete, false);
  assert.deepStrictEqual(q.expectedZero, ['whatnot']);
  assert.strictEqual(Q.chip(q).text, '3 of 3 sources in');
});

test('a 60%+ drop is flagged; a promo spike is not', function () {
  var q = Q.assess(DAY, with_({ shopify: 90000, amazon: 12000, tiktok: 3150, whatnot: 8000 }));
  assert.deepStrictEqual(q.anomalies.map(function (a) { return a.label; }), ['TikTok']);
  assert.strictEqual(q.incomplete, false);
});

test('a headline that does not equal its channels is flagged', function () {
  var q = Q.assess(DAY, with_({ shopify: 16958, amazon: 13989, tiktok: 3150, whatnot: 0 }, 3150));
  assert.strictEqual(q.incomplete, true);
  assert.strictEqual(Q.chip(q).text, 'Totals don\'t add up');
});

test('closed REPORTS count as history and win over a partial for the same date', function () {
  var closed = [{ date: '2026-10-20', shop_revenue: 1, amz_revenue: 1, tiktok_revenue: 1, whatnot_revenue: 1 }];
  var map = Q.series(closed, history);
  assert.strictEqual(map['2026-10-20'].closed, true);
  assert.strictEqual(map['2026-10-20'].channels.shopify, 1);
});

test('readable money, ET times and weekday dates', function () {
  assert.strictEqual(Q.money(-3856.13), '−$3,856.13');
  assert.strictEqual(Q.money(8114.5, 0), '$8,115');
  assert.strictEqual(Q.money(null), '—');
  assert.strictEqual(Q.stampET('2026-10-28T13:30:50.870845+00:00'), 'Oct 28, 9:30 AM ET');
  assert.strictEqual(Q.dayLabel('2026-10-27'), 'Tue, Oct 27');
});

/* ---------------------------------------------------------- 30-day window */

function closedRow(date, rev, ads, net, orders) {
  return { date: date, total_revenue: rev, total_ad_spend: ads, net_profit: net, total_orders: orders,
    shop_revenue: rev / 2, amz_revenue: rev / 4, tiktok_revenue: rev / 4, whatnot_revenue: 0,
    shop_ad_spend: ads, amz_ad_spend: 0, tiktok_ad_spend: 0, whatnot_ad_spend: 0,
    shop_net_profit: net, amz_net_profit: 0, tiktok_net_profit: 0, whatnot_net_profit: 0 };
}

function dailyRow(date, v, net) {
  var r = partial(date, v);
  var sum = Q.CHANNELS.reduce(function (s, k) { return s + (v[k] || 0); }, 0);
  r.provisional_totals = { revenue: sum, ads: 1000, net_profit: net == null ? 500 : net, orders: 100 };
  Q.CHANNELS.forEach(function (k) {
    var c = r.channel_observations[k];
    c.known_ads = k === 'shopify' ? 1000 : 0;
    c.net_profit = k === 'shopify' ? (net == null ? 500 : net) : 0;
  });
  return r;
}

test('30-day window is 30 calendar days ending at the latest day, not the last 30 REPORTS rows', function () {
  // 28 closed September rows + 2 closed November rows (the 10/31 + 11/01 cutover), 11/02 partial.
  var closed = [];
  for (var i = 0; i < 28; i++) closed.push(closedRow(shift('2026-09-27', -i), 100000, 20000, 10000, 1000));
  closed.push(closedRow('2026-10-31', 40000, 16000, -2000, 900));
  closed.push(closedRow('2026-11-01', 88000, 18000, 20000, 1500));
  var open = [dailyRow('2026-11-02', usual, 14000)];
  var w = Q.rolling(Q.series(closed, open), 30);
  assert.strictEqual(w.start, '2026-10-04');
  assert.strictEqual(w.end, '2026-11-02');
  assert.deepStrictEqual(w.used, ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.strictEqual(w.closedDays, 2);
  assert.strictEqual(w.partialDays, 1);
  assert.strictEqual(w.missing.length, 27);
  assert.strictEqual(w.days, 3);
  assert.strictEqual(Math.round(w.avg.revenue), Math.round((40000 + 88000 + 60000) / 3));
  assert.strictEqual(Q.windowLabel(w), 'Sun, Oct 4 – Mon, Nov 2 · 3 of 30 days · 2 closed + 1 daily report');
  assert.ok(/No report: .*Sun, Oct 4/.test(Q.windowNote(w)));
});

test('closed rows win over a daily report for the same date; missing days are never filled', function () {
  var closed = [closedRow('2026-10-27', 50000, 10000, 5000, 400)];
  var open = [dailyRow('2026-10-27', usual, 999), dailyRow('2026-10-26', usual)];
  var w = Q.rolling(Q.series(closed, open), 7);
  assert.strictEqual(w.sum.revenue, 50000 + 60000);
  assert.strictEqual(w.sum.net_profit, 5000 + 500);
  assert.deepStrictEqual(w.missing, ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.strictEqual(w.mer, (50000 + 60000) / (10000 + 1000));
});

test('an incomplete daily report (hole or headline mismatch) is excluded from the average and named', function () {
  var rows = history.map(function (r) { return dailyRow(r.date, usual); });
  var hole = dailyRow(DAY, { shopify: 20000, amazon: 12000, tiktok: 20000, whatnot: null }, -6000);
  var w = Q.rolling(Q.series([], rows.concat([hole])), 30);
  assert.strictEqual(w.end, DAY);
  assert.deepStrictEqual(w.excluded, [{ date: DAY, reason: 'Whatnot missing' }]);
  assert.strictEqual(w.used.indexOf(DAY), -1);
  assert.strictEqual(w.days, 4);
  assert.strictEqual(w.avg.net_profit, 500);
  assert.ok(/Excluded \(incomplete\): Tue, Oct 27 — Whatnot missing/.test(Q.windowNote(w)));
});

test('channel dist comes from the same window: closed per-channel nets plus partial observations', function () {
  var closed = [closedRow('2026-10-27', 40000, 8000, 4000, 400)];
  var open = [dailyRow('2026-10-26', usual, 700)];
  var w = Q.rolling(Q.series(closed, open), 7);
  var d = Q.rollingDist(w);
  assert.strictEqual(d.start_date, '2026-10-21');
  assert.strictEqual(d.end_date, '2026-10-27');
  assert.strictEqual(d.days, 2);
  assert.strictEqual(d.revenue.shopify, 20000 + 20000);
  assert.strictEqual(d.revenue.total, 40000 + 60000);
  assert.strictEqual(d.ad_spend.shopify, 8000 + 1000);
  assert.strictEqual(d.profit.shopify, 4000 + 700);
  assert.strictEqual(d.channel_mer.whatnot, null);
  assert.strictEqual(d.channel_mer.shopify, Math.round(40000 / 9000 * 10000) / 10000);
  assert.strictEqual(d.report_days, 1);
  assert.strictEqual(d.partial_days, 1);
  assert.ok(/5 day\(s\) left out, not zero-filled/.test(d.note));
});

test('MER header is company-wide (all channels) over 7 calendar days, with deltas only from full windows', function () {
  var rows = [];
  for (var i = 0; i < 14; i++) {
    var p = partial(shift('2026-11-11', -i), usual);
    p.provisional_totals = { revenue: 60000, ads: i < 7 ? 20000 : 15000, net_profit: 6000 };
    rows.push(p);
  }
  var h = Q.merHeader(Q.series([], rows));
  assert.strictEqual(h.window.start, '2026-11-05');
  assert.strictEqual(h.mer, 3);
  assert.strictEqual(h.revenue, 420000);
  assert.strictEqual(h.ads, 140000);
  assert.strictEqual(h.margin_pct, 10);
  assert.strictEqual(h.wow, -1);
  assert.ok(Math.abs(h.dod - (3 - 420000 / 135000)) < 1e-9);
  var gap = Q.merHeader(Q.series([], rows.slice(0, 3).concat(rows.slice(4))));
  assert.strictEqual(gap.complete, false);
  assert.strictEqual(gap.dod, null, 'no delta from a window with a missing day');
  assert.deepStrictEqual(gap.window.missing, ['2026-11-08']);
});

test('latest-day header is the full date', function () {
  assert.strictEqual(Q.longDate('2026-11-11'), 'Wednesday, November 11, 2026');
});

function shift(date, days) {
  var d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

if (failed) {
  console.error('\n' + failed + ' report quality test(s) failed');
  process.exit(1);
}
console.log('\nAll report quality tests passed');
