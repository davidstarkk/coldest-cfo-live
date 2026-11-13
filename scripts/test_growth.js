'use strict';

var assert = require('assert');
var M = require('../growth_module.js');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) { failed += 1; console.error('FAIL - ' + name); console.error('     ' + (e && e.stack ? e.stack : e)); }
}

var doc = {
  as_of: '2026-11-10',
  headline: { mer_7d: 1.83, mer_target: 3.24, total_mer_7d: 3.33, breakeven_mer_before_overhead: 1.39, stance: 'give_back', rule_conflict: true,
    first_to_give_back: ['meta', 'x'], blended_ncac: 141.17, first_order_value: 72.68, new_share_of_net_sales_pct: 31.1,
    revenue_per_customer_m2: 105.38, paid_back_by: null, low_stock: ['36oz'], annual_run_rate: 29158553, multiple_to_target: 3.43 },
  governor: { status: 'ok', adopted: false, stance: 'give_back', mer_7d: 1.83, mer_target: 3.24, spend_reading_hold_or_raise_pct: 98.2, basis: 'b',
    give_back_order: [
      { channel: 'meta', label: 'Meta', spend_7d: 73388.39, share_of_spend_pct: 69.5, roas_7d: 2.06, marginal_roas: -0.04, ranked_on: 'marginal_roas', rule_verdict: 'hold', mode: 'frozen', who_can_act: 'David' },
      { channel: 'x', label: 'X', spend_7d: 1300.4, share_of_spend_pct: 1.2, roas_7d: 1.1, marginal_roas: null, ranked_on: 'roas_7d', rule_verdict: 'cut', mode: 'auto', who_can_act: 'Grok' }],
    add_order: [], unranked: [{ channel: 'google', why: 'disputed read' }] },
  marginal: { caveat: 'not causal', basis: 'b', confounders_in_window: [], channels: {
    x: { label: 'X', read: 'insufficient', spend: 1300.4, spend_prior: 0, why: 'under $200 of spend in one of the two weeks' },
    meta: { label: 'Meta', read: 'added_spend_lost_revenue', spend: 73433.46, spend_prior: 61366.73, spend_change_pct: 19.7, revenue_change: -508.04, roas: 2.06, roas_prior: 2.47, marginal_roas: -0.04 } } },
  new_customers: { status: 'ok', basis: 'b', now: { window: '2026-11-04..2026-11-10', days_with_customers: 7, new_customers: 751, blended_ncac: 141.17 }, prior: { window: '2026-10-28..2026-11-03', days_with_customers: 7 },
    by_channel: { window: '2026-11-04..2026-11-10', utm_coverage_pct: 49.5, usable_for_ncac: false, why_withheld: 'only 49.5% of new-customer orders carry a UTM (needs 80%)',
      channels: { meta: { new_customers: 255, net_sales: 17161.78, spend_7d: 73388.39, ncac: null } } } },
  ltv_payback: { status: 'no_feed', why: 'the Shopify cohort pull has not been ingested' },
  incrementality: { status: 'ok', basis: 'b', tests: [
    { id: 't1', channel: 'meta', status: 'running', start: '2026-12-07', end: '2026-12-20', readout: { read: 'preliminary', lift_pct: 9.0, noise_pct: 2.0, outside_noise: true, incremental_roas: 1.2, platform_roas: 2.4, calibration: 0.5 } },
    { id: 't0', channel: 'google', status: 'complete', start: '2026-11-01', end: '2026-11-14', readout: { read: 'final', lift_pct: 1.0, noise_pct: 3.0, outside_noise: false, incremental_roas: 0.2, platform_roas: 4.0, calibration: 0.05 } }] },
  margin_inventory: { status: 'ok', window: '2026-10-14..2026-11-10', blended: { contribution_margin_pct: 72.1, breakeven_roas: 1.39 }, inventory: { status: 'ok', low_cover_days: 21, as_of: '2026-11-10' },
    products: [{ title: '36oz', units: 3070, revenue: 175929.73, contribution_margin_pct: 74.7, breakeven_roas: 1.34, days_of_stock: 3.9, stock_flag: 'low', cost_basis: ['shopify_parent'] },
      { title: 'Personalize', units: 600, revenue: 3000, contribution_margin_pct: 60, breakeven_roas: 1.67, days_of_stock: null, stock_flag: 'not_tracked', cost_basis: ['fallback'] }] },
  autonomy: { note: 'n', channels: {
    snapchat: { label: 'Snapchat', mode: 'auto', spend_7d: 4059.92, score: '6/7', suggestion: 'review_auto', failing: ['two_measured_changes'] },
    meta: { label: 'Meta', mode: 'frozen', spend_7d: 73388.39, score: '5/7', suggestion: 'made_up', failing: ['budget_known', 'something_new'] } } },
  asks: [{ id: 'incrementality.no_test', severity: 'low', title: 't', detail: 'd', age_days: 0 },
    { id: 'inventory.low_cover', severity: 'medium', title: 'low', detail: 'd', age_days: 1 },
    { id: 'plan.target_date.unset', severity: 'medium', title: 'date', detail: 'd', age_days: 3, ack: { status: 'wont_do' } }]
};

test('headline passes values through and never fills a missing one', function () {
  var k = M.headline(doc);
  assert.strictEqual(k.ncac, 141.17);
  assert.strictEqual(k.paidBackBy, null);
  assert.strictEqual(k.margin, null);
  assert.deepStrictEqual(M.headline({}).giveBack, []);
  assert.strictEqual(M.headline({}).mer, null);
});

test('total-company scope: the target sits under total-company MER', function () {
  var d = JSON.parse(JSON.stringify(doc));
  d.headline.target_scope = 'total_company';
  d.governor.target_scope = 'total_company'; d.governor.compared_mer_7d = 3.33; d.governor.stance = 'room_to_add';
  d.governor.add_order = d.governor.give_back_order.slice().reverse(); d.governor.give_back_order = [];
  assert.strictEqual(M.headline(d).scope, 'total_company');
  var html = M.renderGovernor(d);
  assert.ok(html.indexOf('Total-company MER 3.33x is at or above the 3.24x target') !== -1);
  assert.ok(html.indexOf('Shopify D2C MER is 1.83x') !== -1);
  assert.deepStrictEqual(M.governorRows(d).map(function (r) { return r.channel; }), ['x', 'meta']);
  assert.ok(M.renderTests({ incrementality: { status: 'scheduled', why: 'first test starts 2027-01-01', tests: [] } }).indexOf('Scheduled — first test starts 2027-01-01') !== -1);
});

test('governor rows keep the order the feed gave', function () {
  var rows = M.governorRows(doc);
  assert.deepStrictEqual(rows.map(function (r) { return r.channel; }), ['meta', 'x']);
  assert.strictEqual(rows[0].rank, 1);
  assert.strictEqual(rows[1].marginal, null);
  var html = M.renderGovernor(doc);
  assert.ok(html.indexOf('Advisory until David adopts it') !== -1);
  assert.ok(html.indexOf('google (disputed read)') !== -1);
});

test('a marginal read that was withheld shows its reason, not 0.00x', function () {
  var rows = M.marginalRows(doc);
  assert.strictEqual(rows[0].channel, 'meta');
  assert.strictEqual(rows[0].readText, 'More spend, no more revenue');
  assert.strictEqual(rows[1].marginal, null);
  var html = M.renderMarginal(doc);
  assert.ok(html.indexOf('under $200 of spend') !== -1);
  assert.ok(html.indexOf('-0.04x') !== -1);
});

test('per-channel CAC stays blank when the feed withheld it', function () {
  var html = M.renderCustomers(doc);
  assert.ok(html.indexOf('Per-channel CAC withheld: only 49.5%') !== -1);
  assert.ok(html.indexOf('$141.17') !== -1);
  assert.ok(html.indexOf('Feed not pulled yet — the Shopify cohort pull has not been ingested') !== -1);
  assert.strictEqual(M.paybackRows(doc).length, 0);
});

test('a holdout factor is shown only for a final read outside noise', function () {
  var html = M.renderTests(doc);
  assert.ok(html.indexOf('0.50x') === -1, 'preliminary factor must not be shown');
  assert.ok(html.indexOf('0.05x') === -1, 'inside-noise factor must not be shown');
  assert.ok(html.indexOf('preliminary') !== -1);
  assert.ok(M.renderTests({ incrementality: { status: 'no_tests', tests: [] } }).indexOf('No test approved yet') !== -1);
});

test('stock: low is flagged, an untracked product shows no day count', function () {
  var rows = M.productRows(doc);
  assert.strictEqual(rows[0].flag, 'low');
  assert.strictEqual(rows[1].stockDays, null);
  assert.strictEqual(rows[1].estimated, true);
  var html = M.renderMargin(doc);
  assert.ok(html.indexOf('3.9 days') !== -1);
  assert.ok(html.indexOf('not tracked') !== -1);
});

test('autonomy: unknown suggestion falls back to not yet, unknown check passes through', function () {
  var rows = M.autonomyRows(doc);
  assert.strictEqual(rows[0].channel, 'meta');
  assert.strictEqual(rows[0].text, 'Not yet');
  assert.deepStrictEqual(rows[0].failing, ['daily budget written', 'something_new']);
  assert.strictEqual(rows[1].text, 'Auto, checks failing');
});

test('asks: open first by severity, closed last', function () {
  assert.deepStrictEqual(M.askRows(doc).map(function (a) { return a.id; }), ['inventory.low_cover', 'incrementality.no_test', 'plan.target_date.unset']);
});

test('Grok requests: open and answered are drawn as written', function () {
  var html = M.renderRequests({ grok_requests: { requests: [
    { id: 'r1', ask: 'Which hooks do winners share?', by: 'jarvis', asked_on: '2026-11-14', status: 'open', age_days: 2 },
    { id: 'r2', ask: 'Share by landing page', asked_on: '2026-11-12', status: 'answered', answer: 'In new_customers.', where: 'growth_brief.new_customers', answered_on: '2026-11-13' }] } });
  assert.ok(html.indexOf('open 2d') !== -1);
  assert.ok(html.indexOf('In new_customers. (growth_brief.new_customers)') !== -1);
  assert.ok(html.indexOf('answered 11/13') !== -1);
  assert.ok(M.renderRequests({}).indexOf('None yet') !== -1);
});

test('blocks that are missing render a reason and no table', function () {
  ['renderGovernor', 'renderMarginal', 'renderHalo', 'renderMargin', 'renderCreative', 'renderPacing'].forEach(function (fn) {
    var html = M[fn]({});
    assert.ok(html.indexOf('<table') === -1, fn);
  });
  assert.strictEqual(M.statusNote({ status: 'ok' }), null);
  assert.strictEqual(M.statusNote({ status: 'insufficient_data', why: 'x' }), 'Not enough data yet — x');
});

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('growth module: all passed');
