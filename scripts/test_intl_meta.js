'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var M = require('../intl_meta_module.js');
var Paid = require('../paid_channels_module.js');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) { failed += 1; console.error('FAIL - ' + name); console.error('     ' + (e && e.stack ? e.stack : e)); }
}

var ROOT = path.join(__dirname, '..');
var FIX = path.join(__dirname, 'fixtures');
var SAMPLE = JSON.parse(fs.readFileSync(path.join(FIX, 'intl_meta.sample.json'), 'utf8'));
var REGISTRY = JSON.parse(fs.readFileSync(path.join(FIX, 'intl_meta_registry.sample.json'), 'utf8'));
var DAILY = JSON.parse(fs.readFileSync(path.join(FIX, 'intl_meta_daily.sample.json'), 'utf8'));
var SHOPIFY = JSON.parse(fs.readFileSync(path.join(FIX, 'shopify_by_ship_country.example.json'), 'utf8'));
var FEED = M.unwrapFeed(SAMPLE);
var REG = M.unwrapRegistry(REGISTRY);

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function card(html, code) {
  var m = String(html).match(new RegExp('<article class="im-row" data-im-code="' + code + '"[\\s\\S]*?</article>'));
  return m ? m[0] : '';
}
function forbidMissing(html, where) {
  assert.ok(!/missing/i.test(html), (where || 'html') + ' must not say missing');
  assert.ok(html.indexOf('No data') === -1, (where || 'html') + ' must not say No data');
}

test('sample fixtures are labeled EXAMPLE DATA and live under scripts/fixtures (repo convention)', function () {
  [SAMPLE, REGISTRY, DAILY, SHOPIFY].forEach(function (doc) {
    assert.strictEqual(doc.example, true);
    assert.strictEqual(doc.label, 'EXAMPLE DATA');
    assert.strictEqual(doc.EXAMPLE_DATA, true);
    assert.ok(/EXAMPLE DATA/.test(doc.note));
  });
  assert.strictEqual(FEED.schema_version, 'intl_meta.v1');
  assert.strictEqual(REG.schema, 'intl_meta_registry.v1');
  assert.strictEqual(SAMPLE.status, 'OK');
  assert.strictEqual(FEED.status, 'OK');
  assert.deepStrictEqual(REG.countries.map(function (c) { return c.code; }), ['CA', 'GB', 'AU']);
  assert.strictEqual(REG.domestic.code, 'US');
  assert.strictEqual(REG.domestic.residual, true);
});

test('producer PR #52 payload field names are used as-is (daily + shopify + registry + output)', function () {
  assert.strictEqual(DAILY.schema, 'intl_meta_daily.v1');
  assert.ok(Array.isArray(DAILY.campaigns));
  assert.ok(Array.isArray(DAILY.account_totals));
  assert.deepStrictEqual(Object.keys(DAILY.campaigns[0]).sort(), ['campaign_id', 'date', 'purchase_value', 'purchases', 'spend']);
  assert.strictEqual(SHOPIFY.schema, 'shopify_by_ship_country.v1');
  assert.ok(SHOPIFY.rows.some(function (r) { return Object.prototype.hasOwnProperty.call(r, 'shipping_country'); }));
  assert.strictEqual(REG.countries[0].meta_campaign_match.country_breakdown, true);
  assert.deepStrictEqual(REG.upcoming, ['DE', 'FR', 'NL', 'AE', 'JP', 'IE', 'NZ']);
  var ca = FEED.countries.CA;
  ['display_name', 'display_state', 'aov_7d', 'shopify_revenue_7d', 'shopify_orders_7d',
    'contribution_profit_7d', 'contribution_profit_status', 'residual', 'meta_campaign_ids',
    'purchases_1d', 'revenue_1d', 'roas_1d', 'cpp_7d', 'revenue_gap_7d', 'gap_pct'].forEach(function (k) {
    assert.ok(Object.prototype.hasOwnProperty.call(ca, k), k);
  });
  assert.deepStrictEqual(Object.keys(FEED.totals).sort(), ['note', 'spend_1d', 'spend_7d']);
  ['account_purchase_value', 'lines_purchase_value', 'account_purchases', 'lines_purchases',
    'account_spend', 'lines_spend', 'delta', 'ok', 'duplicate_campaign_ids', 'date'].forEach(function (k) {
    assert.ok(Object.prototype.hasOwnProperty.call(FEED.reconciliation, k), k);
  });
  assert.strictEqual(ca.aov_7d, 57.14);
  assert.strictEqual(ca.spend_1d, 60);
  assert.strictEqual(ca.purchases_7d, 22);
  assert.strictEqual(ca.cpp_7d, 5);
  assert.strictEqual(ca.shopify_revenue_7d, 400);
  assert.strictEqual(ca.shopify_orders_7d, 7);
  assert.strictEqual(FEED.countries.US.spend_1d, 875);
  assert.strictEqual(FEED.countries.US.residual, true);
  assert.strictEqual(FEED.reconciliation.ok, true);
  assert.strictEqual(FEED.reconciliation.delta, 0);
});

test('registry sort_order drives rows; residual US is first; CA/GB/AU follow', function () {
  var rows = M.countryRows(REG, FEED, false);
  assert.deepStrictEqual(rows.map(function (r) { return r.code; }), ['US', 'CA', 'GB', 'AU']);
  assert.strictEqual(rows[0].label, 'Meta USA');
  assert.strictEqual(rows[1].label, 'Meta Canada');
  assert.strictEqual(rows[2].label, 'Meta UK');
  assert.strictEqual(rows[3].label, 'Meta Australia');
  assert.strictEqual(rows[0].display_state, 'spend');
  assert.strictEqual(rows[0].residual, true);
  var html = M.renderPanel(REG, FEED);
  assert.ok(html.indexOf('data-im-code="US"') < html.indexOf('data-im-code="CA"'));
  assert.ok(html.indexOf('Meta USA') !== -1 && html.indexOf('Meta Canada') !== -1);
});

test('display_name present is the row label; absent falls back to name', function () {
  assert.strictEqual(M.countryLabel({ code: 'CA', name: 'Canada', display_name: 'Meta Canada' }, { display_name: 'Meta Canada' }), 'Meta Canada');
  var entry = { code: 'CA', name: 'Canada' };
  var raw = { name: 'Canada', display_state: 'spend' };
  assert.strictEqual(M.countryLabel(entry, raw), 'Canada');
  var feed = clone(FEED);
  delete feed.countries.CA.display_name;
  var rows = M.countryRows(REG, feed, false);
  var ca = rows.filter(function (r) { return r.code === 'CA'; })[0];
  assert.strictEqual(ca.label, 'Meta Canada', 'registry display_name fills in when the feed omits it');
  var reg = clone(REG);
  reg.countries.forEach(function (c) { if (c.code === 'CA') delete c.display_name; });
  var rows2 = M.countryRows(reg, feed, false);
  var ca2 = rows2.filter(function (r) { return r.code === 'CA'; })[0];
  assert.strictEqual(ca2.label, 'Canada');
});

test('rule 1: day-card display states (off / zero / spend / pending_backfill)', function () {
  var html = M.renderPanel(REG, FEED);
  var us = card(html, 'US'), ca = card(html, 'CA'), gb = card(html, 'GB'), au = card(html, 'AU');
  assert.ok(us.indexOf('$875') !== -1);
  assert.ok(ca.indexOf('$60') !== -1);
  assert.ok(gb.indexOf('$40') !== -1);
  assert.ok(au.indexOf('$25') !== -1);
  assert.ok(us.indexOf('pending backfill') === -1);
  assert.ok(ca.indexOf('Channel off') === -1);

  var offFeed = clone(FEED);
  offFeed.countries.AU.display_state = 'off';
  offFeed.countries.AU.display_amount = 0;
  var off = card(M.renderPanel(REG, offFeed), 'AU');
  assert.ok(off.indexOf('Channel off') !== -1);
  assert.ok(off.indexOf('$0') !== -1);

  var pendingFeed = clone(FEED);
  pendingFeed.countries.GB.display_state = 'pending_backfill';
  pendingFeed.countries.GB.display_amount = null;
  pendingFeed.countries.GB.spend_7d = null;
  pendingFeed.countries.GB.last_confirmed_amount = 40;
  pendingFeed.countries.GB.last_confirmed_date = '2026-11-08';
  var pending = card(M.renderPanel(REG, pendingFeed), 'GB');
  assert.ok(pending.indexOf('pending backfill') !== -1);
  assert.ok(!/measured/i.test(pending), 'pending_backfill is never labeled measured');
  assert.ok(pending.indexOf('$40') !== -1);

  var zeroFeed = clone(FEED);
  zeroFeed.countries.CA.display_state = 'zero';
  zeroFeed.countries.CA.display_amount = 0;
  var z = card(M.renderPanel(REG, zeroFeed), 'CA');
  assert.ok(z.indexOf('$0') !== -1);
  assert.ok(z.indexOf('Channel off') === -1);
  assert.ok(z.indexOf('pending backfill') === -1);
  forbidMissing(html, 'sample panel');
});

test('rule 4: cpp null is a dash; Infinity / NaN never render', function () {
  var inf = M.renderCountry({
    code: 'XX', label: 'X', flag: '', display_state: 'spend', display_amount: 1,
    spend_7d: 1, revenue_7d: 1, purchases_7d: 0, cpp_7d: Infinity, roas_7d: NaN, aov_7d: null,
    trend: { direction: 'insufficient_data' }, budget_call: null, notes: [], fromFeed: true
  });
  assert.ok(inf.indexOf('Infinity') === -1);
  assert.ok(inf.indexOf('NaN') === -1);
  assert.ok(inf.indexOf('—') !== -1);
  assert.ok(/CPP 7d<\/div><div class="im-v">—<\/div>/.test(inf) || inf.indexOf('—') !== -1);
  assert.strictEqual(M._fmt.num(Infinity), null);
  assert.strictEqual(M._fmt.num(NaN), null);
  assert.strictEqual(M._fmt.num(null), null);
  var au = card(M.renderPanel(REG, FEED), 'AU');
  assert.ok(au.indexOf('$4.55') !== -1);
});

test('rule 6: budget_call is an advisory chip with reason and cooldown, never a button', function () {
  var html = M.renderPanel(REG, FEED);
  var us = card(html, 'US'), ca = card(html, 'CA');
  assert.ok(us.indexOf('Raise 20%') !== -1);
  assert.ok(us.indexOf('advisory') !== -1);
  assert.ok(us.indexOf('roas_7d 4.00x &gt; 2.8') !== -1);
  assert.ok(ca.indexOf('Not enough data') !== -1);
  assert.ok(ca.indexOf('spend_7d $110.00') !== -1);
  assert.ok(html.indexOf('<button') === -1);
  assert.ok(html.indexOf('</button>') === -1);
  assert.ok(M.budgetChip({ action: 'HOLD', reason: 'r', advisory: true, cooldown_until: null }).indexOf('<button') === -1);

  var cooled = clone(FEED);
  cooled.countries.US.budget_call = {
    action: 'HOLD', reason: 'cooldown until 2026-11-20 after RAISE_20',
    advisory: true, cooldown_until: '2026-11-20'
  };
  var cooledHtml = M.renderPanel(REG, cooled);
  assert.ok(card(cooledHtml, 'US').indexOf('cooldown until 11/20') !== -1);
  assert.ok(card(html, 'GB').indexOf('cooldown until') === -1);
});

test('rule 9: feed 404 renders every registry country as pending_backfill with no amount', function () {
  var html = M.renderPanel(REG, null, { feedFailed: true });
  ['US', 'CA', 'GB', 'AU'].forEach(function (code) {
    var c = card(html, code);
    assert.ok(c, code);
    assert.ok(c.indexOf('pending backfill') !== -1, code);
    assert.ok(c.indexOf('data-im-state="pending_backfill"') !== -1, code);
    assert.ok(!/measured/i.test(c), code);
    assert.ok(c.indexOf('$') === -1, code + ' has no amount');
  });
  forbidMissing(html, 'feed 404');
  assert.ok(html.indexOf('Channel off') === -1);
});

test('rule 9: registry fail is a tab-level unavailable state, not missing', function () {
  var html = M.renderUnavailable();
  assert.ok(/unavailable/i.test(html));
  forbidMissing(html, 'registry fail');
  assert.strictEqual(M.renderPanel(null, FEED), html);
});

test('rule 10: a 4th registry country (DE) absent from the feed is pending_backfill — adding a country is registry-only', function () {
  var reg = clone(REG);
  reg.countries.push({
    code: 'DE', name: 'Germany', display_name: 'Meta Germany', flag: '🇩🇪',
    status: 'on', sort_order: 4, added: '2026-11-15',
    meta_campaign_match: { country_breakdown: true }
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(FEED.countries, 'DE'), false);
  var rows = M.countryRows(reg, FEED, false);
  assert.deepStrictEqual(rows.map(function (r) { return r.code; }), ['US', 'CA', 'GB', 'AU', 'DE']);
  var de = rows[4];
  assert.strictEqual(de.display_state, 'pending_backfill');
  assert.strictEqual(de.last_confirmed_amount, null);
  assert.strictEqual(de.fromFeed, false);
  var html = M.renderPanel(reg, FEED);
  var c = card(html, 'DE');
  assert.ok(c.indexOf('pending backfill') !== -1);
  assert.ok(c.indexOf('Meta Germany') !== -1);
  assert.ok(c.indexOf('$') === -1);
  assert.ok(!/measured/i.test(c));
  forbidMissing(c, 'DE');
  assert.ok(html.indexOf('Meta USA') !== -1 && html.indexOf('Meta Canada') !== -1);
});

test('null Shopify fields render as a dash plus pending, never $0', function () {
  var feed = clone(FEED);
  feed.countries.GB.shopify_revenue_7d = null;
  feed.countries.GB.shopify_orders_7d = null;
  feed.countries.GB.revenue_gap_7d = null;
  feed.countries.GB.gap_pct = null;
  feed.countries.GB.notes = ['shopify_by_ship_country_daily.json pending; shopify_revenue_7d is null, not $0'];
  var gb = card(M.renderPanel(REG, feed), 'GB');
  assert.ok(gb.indexOf('im-pending') !== -1);
  assert.ok(gb.indexOf('shopify_by_ship_country_daily.json pending') !== -1);
  assert.ok(gb.indexOf('Shopify revenue 7d') !== -1);
  assert.ok(/Shopify revenue 7d \(ship-to\)<\/div><div class="im-s"><span class="im-dash">—<\/span>/.test(gb));
  assert.ok(/Shopify orders 7d<\/div><div class="im-s"><span class="im-dash">—<\/span>/.test(gb));
  assert.ok(gb.indexOf('im-shop') !== -1 && gb.indexOf('$0.00') === -1);
  var ca = card(M.renderPanel(REG, FEED), 'CA');
  assert.ok(ca.indexOf('$400') !== -1);
  assert.ok(ca.indexOf('−9.1%') !== -1 || ca.indexOf('-9.1%') !== -1);
});

test('contribution_profit_7d null + pending_landed_costs renders that string', function () {
  var html = M.renderPanel(REG, FEED);
  assert.ok(card(html, 'GB').indexOf('pending landed costs') !== -1);
  assert.ok(card(html, 'CA').indexOf('pending landed costs') !== -1);
  assert.ok(card(html, 'CA').indexOf('$1,800') === -1);
  var ready = clone(FEED);
  ready.countries.CA.contribution_profit_7d = 137.00;
  ready.countries.CA.contribution_profit_status = 'ok';
  assert.ok(card(M.renderPanel(REG, ready), 'CA').indexOf('$137') !== -1);
  var off = clone(FEED);
  off.countries.AU.contribution_profit_7d = null;
  off.countries.AU.contribution_profit_status = null;
  assert.ok(card(M.renderPanel(REG, off), 'AU').indexOf('Contribution profit') === -1);
  assert.strictEqual(M.contributionTxt({ contribution_profit_7d: null, contribution_profit_status: 'pending_landed_costs' }), 'pending landed costs');
  assert.strictEqual(M.contributionTxt({ contribution_profit_7d: 'pending landed costs' }), 'pending landed costs');
});

test('trend.arrow is used when present, otherwise derived from direction; insufficient_data is Not enough data', function () {
  assert.strictEqual(M.trendArrow({ direction: 'up', arrow: '▲' }), '▲');
  assert.strictEqual(M.trendArrow({ direction: 'down' }), '▼');
  assert.strictEqual(M.trendArrow({ direction: 'flat' }), '▶');
  assert.strictEqual(M.trendArrow({ direction: 'insufficient_data' }), '—');
  var html = M.renderPanel(REG, FEED);
  assert.ok(card(html, 'CA').indexOf('Not enough data') !== -1);
  var arrows = clone(FEED);
  arrows.countries.CA.trend = { direction: 'up', arrow: '▲', delta_pct: 12.5 };
  arrows.countries.GB.trend = { direction: 'flat', arrow: '▶', delta_pct: 1.0 };
  arrows.countries.US.trend = { direction: 'down', delta_pct: -8.0 };
  arrows.countries.AU.trend = { direction: 'insufficient_data', arrow: '—' };
  var ahtml = M.renderPanel(REG, arrows);
  assert.ok(card(ahtml, 'CA').indexOf('▲') !== -1);
  assert.ok(card(ahtml, 'GB').indexOf('▶') !== -1);
  assert.ok(card(ahtml, 'US').indexOf('▼') !== -1, 'US has no arrow in the feed so direction down becomes ▼');
  assert.ok(card(ahtml, 'AU').indexOf('Not enough data') !== -1);
});

test('reconciliation ok:false shows a warning badge with delta and duplicate campaign IDs', function () {
  var fail = clone(FEED);
  fail.status = 'OK';
  fail.reconciliation = {
    date: '2026-11-14', account_spend: 1000.50, lines_spend: 1000, delta: -0.5,
    ok: false, duplicate_campaign_ids: ['52562731737847']
  };
  var html = M.renderPanel(REG, fail);
  assert.ok(html.indexOf('data-im-recon="fail"') !== -1);
  assert.ok(html.indexOf('Reconciliation warning') !== -1);
  assert.ok(html.indexOf('-$0.50') !== -1);
  assert.ok(html.indexOf('52562731737847') !== -1);
  var okHtml = M.renderPanel(REG, FEED);
  assert.ok(okHtml.indexOf('data-im-recon="fail"') === -1);
  assert.ok(okHtml.indexOf('reconciled 11/14') !== -1);
});

test('intl_meta.status RECONCILIATION_FAILED shows a tab-level banner and keeps the recon.ok:false badge', function () {
  assert.strictEqual(SAMPLE.status, FEED.status);
  assert.ok(M.renderPanel(REG, FEED).indexOf('data-im-status="RECONCILIATION_FAILED"') === -1);

  var failed = clone(SAMPLE);
  failed.status = 'RECONCILIATION_FAILED';
  failed.intl_meta.status = 'RECONCILIATION_FAILED';
  failed.intl_meta.reconciliation.ok = false;
  failed.intl_meta.reconciliation.delta = -0.5;
  failed.intl_meta.reconciliation.duplicate_campaign_ids = ['52562731737847'];
  var html = M.renderPanel(REG, failed);
  assert.ok(html.indexOf('data-im-status="RECONCILIATION_FAILED"') !== -1);
  assert.ok(html.indexOf('im-banner-fail') !== -1);
  assert.ok(html.indexOf('RECONCILIATION_FAILED') !== -1);
  assert.ok(html.indexOf('data-im-recon="fail"') !== -1);
  assert.ok(html.indexOf('Reconciliation warning') !== -1);
  assert.ok(html.indexOf('52562731737847') !== -1);
  var banners = html.match(/class="im-banner/g) || [];
  assert.ok(banners.length >= 2, 'status banner and recon.ok:false badge both render');

  var statusOnly = clone(FEED);
  statusOnly.status = 'RECONCILIATION_FAILED';
  statusOnly.reconciliation.ok = true;
  var so = M.renderPanel(REG, statusOnly);
  assert.ok(so.indexOf('data-im-status="RECONCILIATION_FAILED"') !== -1);
  assert.ok(so.indexOf('data-im-recon="fail"') === -1);
  assert.ok(so.indexOf('reconciled 11/14') !== -1);
});

test('per-line aov_7d renders as AOV (platform-reported); null is a dash, never $0', function () {
  var html = M.renderPanel(REG, FEED);
  var ca = card(html, 'CA');
  assert.ok(ca.indexOf('AOV (platform-reported)') !== -1);
  assert.ok(ca.indexOf('$57.14') !== -1);
  assert.ok(card(html, 'GB').indexOf('$76.25') !== -1);
  assert.ok(card(html, 'AU').indexOf('$92.50') !== -1);
  assert.ok(card(html, 'US').indexOf('$80.77') !== -1);
  var none = clone(FEED);
  none.countries.CA.aov_7d = null;
  var dash = card(M.renderPanel(REG, none), 'CA');
  assert.ok(/AOV \(platform-reported\)<\/div><div class="im-v">—<\/div>/.test(dash));
  assert.ok(dash.indexOf('$0.00') === -1);
  var nan = M.renderCountry({
    code: 'XX', label: 'X', flag: '', display_state: 'spend', display_amount: 1,
    aov_7d: NaN, cpp_7d: null, spend_7d: 1, revenue_7d: 1, purchases_7d: 1,
    trend: { direction: 'insufficient_data' }, notes: [], fromFeed: true
  });
  assert.ok(nan.indexOf('NaN') === -1);
  assert.ok(/AOV \(platform-reported\)<\/div><div class="im-v">—<\/div>/.test(nan));
});

test('totals are the feed\'s Meta (breakdown) figures, not a client-side sum, and ROAS is not MER', function () {
  var html = M.renderPanel(REG, FEED);
  assert.ok(html.indexOf('Meta (breakdown)') !== -1);
  assert.ok(html.indexOf('not added to D2C') !== -1 || html.indexOf('Do not add them to d2c_ad_spend') !== -1);
  assert.ok(html.indexOf('platform-reported (Meta)') !== -1);
  assert.ok(html.indexOf('not MER') !== -1);
  assert.ok(html.indexOf('$1,000') !== -1);
  assert.ok(html.indexOf('$2,000') !== -1);
  var lied = clone(FEED);
  lied.totals.spend_7d = 1;
  assert.ok(M.renderPanel(REG, lied).indexOf('$1') !== -1);
  assert.ok(M.renderTotals(lied).indexOf('$2,000') === -1);
});

test('notes are information text, not a kill', function () {
  var ca = card(M.renderPanel(REG, FEED), 'CA');
  assert.ok(ca.indexOf('im-info') !== -1);
  assert.ok(ca.indexOf('pending_landed_costs') !== -1);
  assert.ok(!/kill/i.test(ca));
});

test('intl_meta lines do not change MER or D2C totals on other tabs', function () {
  var src = fs.readFileSync(path.join(ROOT, 'intl_meta_module.js'), 'utf8');
  ['mer_for_manus', 'd2c_ad_spend', 'blended_mer', 'mer_7d_pooled', 'PARTIAL_REPORTS', 'channelSpends', 'merHeader', 'applyChannel'].forEach(function (s) {
    assert.ok(src.indexOf(s) === -1, 'module must not mention ' + s);
  });
  var ids = Paid.displayChannels().map(function (c) { return c.id; });
  ['US', 'CA', 'GB', 'AU', 'DE', 'intl_meta'].forEach(function (id) {
    assert.ok(ids.indexOf(id) === -1, id + ' is not a paid-channels D2C line');
  });
  var p = {
    date: '2026-11-13',
    advertising_sources: { meta: { spend: 5000, complete: true }, google_ads: { spend: 1000, complete: true } },
    channel_observations: { shopify: { revenue: 18000, orders: 40, known_ads: 6000 } },
    provisional_totals: { revenue: 18000, ads: 6000, mer: 3, net_profit: 0, net_margin_pct: 0 }
  };
  global.PARTIAL_REPORTS = [p];
  Paid._setMerDoc({ as_of: '2026-11-13' });
  Paid.CHANNELS.forEach(function (ch) { Paid.setFeeds(ch.id, null, { as_of: '2026-11-13' }, null); });
  Paid.CHANNELS.forEach(function (ch) { Paid.applyChannel(ch, Paid.mergeDaysFor(ch)); });
  var before = Paid.channelSpends('2026-11-13');
  M.renderPanel(REG, FEED);
  var after = Paid.channelSpends('2026-11-13');
  assert.strictEqual(after.totalAdSpend, before.totalAdSpend);
  assert.strictEqual(after.shopifyD2C, before.shopifyD2C);
  assert.strictEqual(after.blendedMer, before.blendedMer);
  assert.strictEqual(after.channels.meta.spend, before.channels.meta.spend);
  assert.strictEqual(after.totalAdSpend, 6000);
  delete global.PARTIAL_REPORTS;
});

test('index.html loads the module once, after the other tab modules, and does not embed a panel', function () {
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.strictEqual((html.match(/<script src="intl_meta_module.js"><\/script>/g) || []).length, 1);
  assert.ok(html.indexOf('intl_meta_module.js') > html.indexOf('whatnot_shows_module.js'));
  assert.ok(html.indexOf('intl_meta_module.js') < html.indexOf('subscriptions_module.js'));
  assert.ok(html.indexOf('data-tab="intl_meta"') === -1);
  assert.ok(html.indexOf('id="tab-intl_meta"') === -1);
});

test('nav cleanup does not hide the International Meta tab', function () {
  var N = require('../nav_cleanup_module.js');
  assert.strictEqual(N.HIDDEN.indexOf('intl_meta'), -1);
});

if (failed) { console.error(failed + ' failing'); process.exit(1); }
console.log('intl meta module: all tests passed');
