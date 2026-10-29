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

if (failed) {
  console.error('\n' + failed + ' report quality test(s) failed');
  process.exit(1);
}
console.log('\nAll report quality tests passed');
