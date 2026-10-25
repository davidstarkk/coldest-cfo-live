'use strict';

var assert = require('assert');
var Header = require('../rolling_mer_header.js');
var mer = require('../mer_for_manus.json');

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

test('published mer_for_manus is as_of 2026-10-24 with mer_7d_pooled', function () {
  assert.strictEqual(mer.as_of, '2026-10-24');
  assert.strictEqual(mer.mer_7d_pooled, 4.177);
  assert.strictEqual(mer.mer_30d_pooled, 4.5862);
  assert.strictEqual(mer.rev_7d, 674087.5);
  assert.strictEqual(mer.spend_7d, 161381.8);
  assert.strictEqual(mer.mer_breakeven, null);
  assert.strictEqual(mer.delta_dod, null);
});

test('fresh mer_for_manus overlays the header (no invented deltas)', function () {
  var resolved = Header.resolve(embedded, mer);
  assert.strictEqual(resolved.stale, false);
  assert.strictEqual(resolved.data.as_of, '2026-10-24');
  assert.strictEqual(resolved.data.latest.mer_7d_pooled, 4.177);
  assert.strictEqual(resolved.data.latest.date, '2026-10-24');
  assert.strictEqual(resolved.data.latest.rev_7d, 674087.5);
  assert.strictEqual(resolved.data.latest.spend_7d, 161381.8);
  assert.strictEqual(resolved.data.latest.delta_dod, null);
  assert.strictEqual(resolved.data.latest.profit_7d, null);
  assert.strictEqual(resolved.data.mer_breakeven, null);
  assert.deepStrictEqual(resolved.data.missing_report_dates, []);
  assert.ok(resolved.data.verdict.msg.indexOf('2026-10-24') !== -1);
});

test('missing mer_for_manus is STALE as of 2026-09-27 — number stays 3.1952', function () {
  var resolved = Header.resolve(embedded, null);
  assert.strictEqual(resolved.stale, true);
  assert.strictEqual(resolved.staleAsOf, '2026-09-27');
  assert.strictEqual(resolved.staleLabel, 'STALE — as of 2026-09-27, not current');
  assert.strictEqual(resolved.data.latest.mer_7d_pooled, 3.1952);
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
