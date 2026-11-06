'use strict';

var assert = require('assert');
var Header = require('../rolling_mer_header.js');
var mer = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'cfo_2026_11_05_mer.json'), 'utf8'));

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) {
    failed += 1;
    console.error('FAIL - ' + name);
    console.error('     ' + (e && e.stack ? e.stack : e));
  }
}

var embedded = {
  as_of: '2026-09-27',
  data_ready: false,
  missing_report_dates: ['2026-10-18', '2026-10-24'],
  mer_target: 3.24,
  mer_breakeven: 2.83,
  latest: {
    date: '2026-09-27',
    mer_7d_pooled: 3.1952,
    rev_7d: 408208.37,
    spend_7d: 127756.43,
    days_in_window: 7
  },
  verdict: { status: 'DATA_INCOMPLETE', msg: 'Historical metrics through 2026-09-27.' }
};

test('published mer_for_manus is as_of 2026-11-05 with independently rebuilt D2C MER', function () {
  assert.strictEqual(mer.as_of, '2026-11-05');
  assert.strictEqual(mer.data_ready, false, 'partial close must not read ready');
  assert.strictEqual(mer.mer_7d_pooled, 2.1619);
  assert.strictEqual(mer.mer_30d_pooled, 2.3878);
  assert.strictEqual(mer.rev_7d, 197402.55);
  assert.strictEqual(mer.spend_7d, 91309.61);
  assert.strictEqual(mer.rev_30d, 873225.86);
  assert.strictEqual(mer.spend_30d, 365703.61);
  assert.strictEqual(mer.delta_dod, 0.0197);
  assert.strictEqual(mer.delta_wow, 0.302);
  assert.strictEqual(mer.mer_breakeven, null);
  assert.strictEqual(mer.shop_revenue, 34876.92);
  assert.strictEqual(mer.d2c_ad_spend, 13895.86);
  assert.strictEqual(mer.blended_mer, 2.51);
});

test('fresh mer_for_manus overlays the header and preserves partial readiness', function () {
  var resolved = Header.resolve(embedded, mer);
  assert.strictEqual(resolved.stale, false);
  assert.strictEqual(resolved.data.as_of, '2026-11-05');
  assert.strictEqual(resolved.data.data_ready, false);
  assert.strictEqual(resolved.data.latest.mer_7d_pooled, 2.1619);
  assert.strictEqual(resolved.data.latest.date, '2026-11-05');
  assert.strictEqual(resolved.data.latest.rev_7d, 197402.55);
  assert.strictEqual(resolved.data.latest.spend_7d, 91309.61);
  assert.strictEqual(resolved.data.latest.delta_dod, 0.0197);
  assert.strictEqual(resolved.data.latest.delta_wow, 0.302);
  assert.strictEqual(resolved.data.latest.mer_30d_pooled, 2.3878);
  assert.strictEqual(resolved.data.latest.profit_7d, null);
  assert.strictEqual(resolved.data.mer_breakeven, null);
  assert.deepStrictEqual(resolved.data.missing_report_dates, []);
});

test('missing mer_for_manus is STALE as of 2026-09-27 — number stays 3.1952', function () {
  var resolved = Header.resolve(embedded, null);
  assert.strictEqual(resolved.stale, true);
  assert.strictEqual(resolved.staleAsOf, '2026-09-27');
  assert.strictEqual(resolved.staleLabel, 'STALE — as of 2026-09-27, not current');
  assert.strictEqual(resolved.data.latest.mer_7d_pooled, 3.1952);
});

test('current data_ready embedded snapshot is not STALE', function () {
  var cur = Object.assign({}, embedded, { as_of: '2026-10-30', data_ready: true, missing_report_dates: [],
    latest: Object.assign({}, embedded.latest, { date: '2026-10-30', mer_7d_pooled: 3.3881, rev_7d: 493548.71 }) });
  var olderMer = { as_of: '2026-10-26', mer_7d_pooled: 2.3882, data_ready: false };
  var resolved = Header.resolve(cur, olderMer, '2026-10-31T14:00:00Z');
  assert.strictEqual(resolved.stale, false);
  assert.strictEqual(resolved.data.latest.rev_7d, 493548.71);
  assert.strictEqual(Header.resolve(cur, olderMer, '2026-11-05T14:00:00Z').stale, true);
});

test('mer without mer_7d_pooled is STALE — do not invent a pooled MER', function () {
  var resolved = Header.resolve(embedded, { as_of: '2026-10-24', blended_mer: 1.84 });
  assert.strictEqual(resolved.stale, true);
  assert.strictEqual(resolved.data.latest.mer_7d_pooled, 3.1952);
});

test('mer as_of not newer than embedded stays STALE', function () {
  var resolved = Header.resolve(embedded, { as_of: '2026-09-27', mer_7d_pooled: 3.1952 });
  assert.strictEqual(resolved.stale, true);
});

if (failed) {
  console.error('\n' + failed + ' rolling MER header test(s) failed');
  process.exit(1);
}
console.log('\nAll rolling MER header tests passed');
