'use strict';

var assert = require('assert');
var M = require('../mmm_module.js');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) { failed += 1; console.error('FAIL - ' + name); console.error('     ' + (e && e.stack ? e.stack : e)); }
}

var insufficient = {
  status: 'insufficient_data', as_of: '2026-11-02', mer_target: 3.24,
  data_sufficiency: { sufficient_for_mmm: false, min_days_required: 180, consecutive_usable_days: 34, run_days: 36,
    kpi_gap_days_in_run: ['2026-10-09', '2026-10-10'], usable_span: { start: '2026-09-28', end: '2026-11-02' },
    reasons: ['only 34 usable days in the longest per-channel run (36 days, 2 missing spend or Shopify revenue); need 180'],
    company_history_only_days: 912 },
  channel_coverage: {
    meta: { days_reported: 35, days_with_spend: 35, spend_cv: 0.28, d2c_share_pct: 73.7, d2c: true, curve_eligible: false, prior_dominated_expected: false },
    bing: { days_reported: 35, days_with_spend: 29, spend_cv: 2.2, d2c_share_pct: 0.13, d2c: true, curve_eligible: false, prior_dominated_expected: true },
    taboola: { days_reported: 35, days_with_spend: 0, spend_cv: null, d2c_share_pct: 0, d2c: true, curve_eligible: false, prior_dominated_expected: true },
    amazon: { days_reported: 34, days_with_spend: 34, spend_cv: 0.23, d2c_share_pct: null, d2c: false, curve_eligible: false, prior_dominated_expected: false }
  },
  channels: {}, learnings: [], studios: { events: { status: 'not_configured', note: 'set key' }, learnings: { status: 'skipped' } }
};

var recommendation = {
  status: 'recommendation', as_of: '2027-04-04', mer_target: 3.24, fit: { r2: 0.81, holdout: { days: 14, mape_pct: 9.1 } }, baseline_share_pct: 41.2,
  data_sufficiency: { sufficient_for_mmm: true, min_days_required: 180, consecutive_usable_days: 190, usable_span: { start: '2026-09-28', end: '2027-04-04' }, reasons: [] },
  channel_coverage: {},
  channels: {
    meta: { verdict: 'hold', why: 'straddles', marginal_roas: 3.1, marginal_roas_low: 2.7, marginal_roas_high: 3.6, avg_roas_at_current: 3.9, current_daily_spend: 8000, recommended_daily_spend_fixed_total: 7600, spend_at_breakeven_mroas: null, contribution_share_pct: 70, confidence: 'med', prior_roas: 2.75, prior_dominated: false },
    google: { verdict: 'scale', why: 'above', marginal_roas: 4.4, marginal_roas_low: 3.5, marginal_roas_high: 5.1, avg_roas_at_current: 5.0, current_daily_spend: 1800, recommended_daily_spend_fixed_total: 2160, spend_at_breakeven_mroas: 2600, contribution_share_pct: 20, confidence: 'high', prior_roas: 6.62, prior_dominated: false },
    pinterest: { verdict: 'insufficient', why: 'prior-dominated', marginal_roas: null, marginal_roas_low: null, marginal_roas_high: null, avg_roas_at_current: null, current_daily_spend: 150, recommended_daily_spend_fixed_total: null, spend_at_breakeven_mroas: null, contribution_share_pct: 0.4, confidence: 'low', prior_roas: 2.9, prior_dominated: true }
  },
  fixed_total_reallocation: { status: 'ok', total_daily_spend: 9800, step_cap_pct: 20, predicted_daily_revenue_delta: 420 },
  target_mer_total: { status: 'ok', mer_target: 3.24, direction: 'scale', blended_marginal_roas_now: 3.4, scale_factor: 1.08, total_daily_spend_recommended: 10584 },
  learnings: [{ channel: 'google', statement: 'MMM: google marginal ROAS 4.40', confidence: 'high' }],
  studios: { events: { status: 'ok', events: 3 }, learnings: { status: 'ok', pushed: 2 } }
};

test('readiness reads the sufficiency block and never rounds past 100%', function () {
  var r = M.readiness(insufficient);
  assert.strictEqual(r.sufficient, false);
  assert.strictEqual(r.have, 34); assert.strictEqual(r.need, 180); assert.strictEqual(r.pct, 19);
  assert.strictEqual(r.weeksLeft, 21);
  assert.deepStrictEqual(r.gaps, ['2026-10-09', '2026-10-10']);
  assert.strictEqual(r.span.start, '2026-09-28');
  assert.strictEqual(r.historyOnlyDays, 912);
  var ok = M.readiness(recommendation);
  assert.strictEqual(ok.sufficient, true); assert.strictEqual(ok.pct, 100); assert.strictEqual(ok.weeksLeft, 0);
  assert.strictEqual(M.readiness(null).have, 0);
});

test('coverage rows classify channels and sort by share', function () {
  var rows = M.coverageRows(insufficient);
  assert.strictEqual(rows[0].channel, 'meta');
  assert.strictEqual(rows[0].state, 'waiting for history');
  var by = {}; rows.forEach(function (r) { by[r.channel] = r; });
  assert.strictEqual(by.bing.state, 'too small / too new');
  assert.strictEqual(by.taboola.state, 'no spend');
  assert.strictEqual(by.amazon.d2c, false);
  assert.strictEqual(by.amazon.share, null);
});

test('channel rows carry verdict, interval, change % and never invent a missing number', function () {
  var rows = M.channelRows(recommendation);
  assert.deepStrictEqual(rows.map(function (r) { return r.channel; }), ['meta', 'google', 'pinterest']);
  var g = rows[1];
  assert.strictEqual(g.verdict, 'scale');
  assert.strictEqual(Math.round(g.changePct), 20);
  assert.strictEqual(g.breakeven, 2600);
  var p = rows[2];
  assert.strictEqual(p.verdict, 'insufficient');
  assert.strictEqual(p.mroas, null); assert.strictEqual(p.changePct, null); assert.strictEqual(p.priorDominated, true);
  assert.strictEqual(M.channelRows(insufficient).length, 0);
  assert.strictEqual(M.verdictClass('scale'), 'mm-good');
  assert.strictEqual(M.verdictClass('cut'), 'mm-bad');
  assert.strictEqual(M.verdictClass('hold'), 'mm-warn');
  assert.strictEqual(M.verdictClass('insufficient'), 'mm-muted');
});

test('curve datasets skip prior-dominated channels and need the model block', function () {
  var results = { model: { channels: {
    meta: { prior_dominated: false, current_daily_spend: 8000, curve: [{ spend: 0, revenue: 0 }, { spend: 8000, revenue: 30000 }] },
    pinterest: { prior_dominated: true, current_daily_spend: 150, curve: [{ spend: 0, revenue: 0 }] }
  } } };
  var ds = M.curveDatasets(results);
  assert.strictEqual(ds.length, 1);
  assert.strictEqual(ds[0].label, 'Meta');
  assert.deepStrictEqual(ds[0].data[1], { x: 8000, y: 30000 });
  assert.deepStrictEqual(M.curveDatasets(null), []);
  assert.deepStrictEqual(M.curveDatasets({}), []);
});

test('formatters', function () {
  assert.strictEqual(M._fmt.usd(1234.5), '$1,235');
  assert.strictEqual(M._fmt.usd(null), '—');
  assert.strictEqual(M._fmt.x(3.456), '3.46x');
  assert.strictEqual(M._fmt.x(undefined), '—');
  assert.strictEqual(M._fmt.pct(20), '+20.0%');
  assert.strictEqual(M._fmt.pct(-18.7), '-18.7%');
});

if (failed) { console.error(failed + ' failing'); process.exit(1); }
console.log('mmm module: all tests passed');
