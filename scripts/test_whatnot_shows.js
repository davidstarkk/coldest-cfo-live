'use strict';

var assert = require('assert');
var M = require('../whatnot_shows_module.js');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) { failed += 1; console.error('FAIL - ' + name); console.error('     ' + (e && e.stack ? e.stack : e)); }
}

var doc = {
  as_of: '2026-11-12', window: { first_day: '2026-10-27', last_day: '2026-11-12', days_with_shows: 13 },
  overall: { shows: 40, days: 13, revenue: 125021, revenue_per_show: 3125.53, best_show: 4182, worst_show: 1966, orders_per_show: 100.2, first_time_buyers_per_show: 11.8 },
  by_daypart: [{ daypart: 'morning', hours: 'before 11 AM', shows: 12, days: 12, revenue_per_show: 2931.83, best_show: 3286, worst_show: 2509, orders_per_show: 100.8, first_time_buyers_per_show: 14 },
    { daypart: 'night', hours: '8 PM and later', shows: 4, days: 4, revenue_per_show: 2940.5, best_show: 4172, worst_show: 1966, orders_per_show: 86, first_time_buyers_per_show: 11 }],
  by_host: [{ host: 'Nate', shows: 4, revenue_per_show: 2994, orders_per_show: 113.2, first_time_buyers_per_show: 13 }],
  caveat: 'read a gap as a lead', basis: 'emails',
  by_date: {
    '2026-11-12': { status: 'ok', show_count: 2, shows_revenue: 6470, revenue_per_show: 3235, recorded_revenue: null, shows: [
      { start: '9:31 AM EST', daypart: 'morning', title: 'Wake Up Wins', revenue: 3112, orders: 115, revenue_per_order: 27.06, first_time_buyers: 26, promotion_spend: null },
      { start: '12:48 PM EST', daypart: 'midday', title: 'Afternoon Ice', revenue: 3358, orders: 106, revenue_per_order: 31.68, first_time_buyers: 8, promotion_spend: 250 }] },
    '2026-10-28': { status: 'ok', show_count: 3, shows_revenue: 8330, revenue_per_show: 2776.67, recorded_revenue: 11199, recorded_differs_by: 2869,
      note: 'the recorded day total counts a restated summary as an extra show', shows: [{ start: '9:29 AM EDT', title: 'Show 1 w/Chloe', revenue: 2509, orders: 104 }] },
    '2026-10-26': { status: 'no_show_detail', note: 'the day has a total but no per-show rows yet', show_count: null, recorded_revenue: 7000, shows: [] },
    '2026-10-25': { status: 'no_shows', show_count: 0, recorded_revenue: 0, shows: [] }
  }
};

test('days come newest first with the shows the feed listed', function () {
  var rows = M.dayRows(doc);
  assert.deepStrictEqual(rows.map(function (r) { return r.date; }), ['2026-11-12', '2026-10-28', '2026-10-26', '2026-10-25']);
  assert.strictEqual(rows[0].shows.length, 2);
  assert.strictEqual(rows[0].shows[0].promo, null);
  assert.strictEqual(rows[2].count, null);
});

test('a day without per-show rows shows its total and a reason, never a show count', function () {
  var html = M.renderDays(doc);
  assert.ok(html.indexOf('the day has a total but no per-show rows yet') !== -1);
  assert.ok(html.indexOf('$7,000') !== -1);
  assert.ok(html.indexOf('no shows') !== -1);
  assert.ok(html.indexOf('Mon 10/26') !== -1);
});

test('a recorded total that differs is flagged with both numbers', function () {
  var html = M.renderDays(doc);
  assert.ok(html.indexOf('counts a restated summary as an extra show (recorded $11,199)') !== -1);
  assert.ok(html.indexOf('$8,330') !== -1);
});

test('missing promotion spend is a dash, not $0', function () {
  var html = M.renderDays(doc);
  assert.ok(html.indexOf('<td>26</td><td>—</td>') !== -1);
  assert.ok(html.indexOf('<td>8</td><td>$250</td>') !== -1);
});

test('time of day and host tables pass the feed through', function () {
  assert.deepStrictEqual(M.partRows(doc).map(function (r) { return [r.part, r.shows, r.perShow]; }), [['morning', 12, 2931.83], ['night', 4, 2940.5]]);
  var html = M.renderParts(doc);
  assert.ok(html.indexOf('read a gap as a lead') !== -1);
  assert.ok(html.indexOf('Nate') !== -1);
  assert.strictEqual(M.renderParts({}), '');
});

test('no per-show data at all says so', function () {
  assert.ok(M.renderSummary({}).indexOf('No day has per-show rows yet') !== -1);
  assert.ok(M.renderSummary(doc).indexOf('$3,126') !== -1);
});

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('whatnot shows module: all passed');
