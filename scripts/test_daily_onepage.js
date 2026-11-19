'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var M = require('../daily_onepage_module.js');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) { failed += 1; console.error('FAIL - ' + name); console.error('     ' + (e && e.stack ? e.stack : e)); }
}

var shows = { by_date: {
  '2026-11-12': { status: 'ok', show_count: 2, shows_revenue: 6470, revenue_per_show: 3235, shows: [
    { start: '9:31 AM EST', title: 'Wake Up Wins', revenue: 3112, orders: 115, revenue_per_order: 27.06, first_time_buyers: 26, promotion_spend: null },
    { start: '12:48 PM EST', title: 'Afternoon Ice', revenue: 3358, orders: 106, revenue_per_order: 31.68, first_time_buyers: 8, promotion_spend: 250 }] },
  '2026-11-16': { status: 'no_show_detail', note: 'the day has a total but no per-show rows yet', show_count: null, recorded_revenue: 11103, shows: [] },
  '2026-11-15': { status: 'no_shows', show_count: 0, recorded_revenue: 0, shows: [] }
} };

test('a day lists its own shows with the feed total; missing promotion spend is a dash', function () {
  var html = M.whatnotHtml(shows, '2026-11-12');
  assert.ok(html.indexOf('Wake Up Wins') !== -1 && html.indexOf('Afternoon Ice') !== -1);
  assert.ok(html.indexOf('<td>26</td><td>—</td>') !== -1);
  assert.ok(html.indexOf('<td>8</td><td>$250</td>') !== -1);
  assert.ok(html.indexOf('2 shows · $3,235 per show</td><td>$6,470') !== -1);
});

test('a day with a total but no show rows gives the total and the reason; no shows says so; an unknown day draws nothing', function () {
  var html = M.whatnotHtml(shows, '2026-11-16');
  assert.ok(html.indexOf('$11,103') !== -1 && html.indexOf('no per-show rows yet') !== -1);
  assert.ok(html.indexOf('<table') === -1);
  assert.ok(M.whatnotHtml(shows, '2026-11-15').indexOf('No Whatnot shows this day') !== -1);
  assert.strictEqual(M.whatnotHtml(shows, '2026-11-01'), '');
  assert.strictEqual(M.whatnotHtml(null, '2026-11-12'), '');
});

var feed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'intl_meta.sample.json'), 'utf8'));
var registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'intl_meta_registry.sample.json'), 'utf8'));
var inner = feed.intl_meta || feed;

test('Meta by country is drawn only on the feed as_of day and is labelled as not part of MER', function () {
  var html = M.intlHtml(feed, registry, inner.as_of);
  assert.ok(html.indexOf('Meta by country') !== -1);
  assert.ok(html.indexOf('not added to D2C ad spend or MER') !== -1);
  assert.ok((html.match(/<tr>/g) || []).length >= 2);
  assert.strictEqual(M.intlHtml(feed, registry, '2001-01-01'), '');
  assert.strictEqual(M.intlHtml(feed, null, inner.as_of), '');
});

test('a PENDING_INPUT feed says nothing is measured and shows no $0', function () {
  var doc = { status: 'PENDING_INPUT', intl_meta: { as_of: '2026-11-16', status: 'PENDING_INPUT', countries: {
    CA: { display_name: 'Meta Canada', display_state: 'pending_backfill', last_confirmed_amount: null, spend_7d: null, roas_7d: null } } } };
  var html = M.intlHtml(doc, registry, '2026-11-16');
  assert.ok(html.indexOf('PENDING_INPUT') !== -1);
  assert.ok(html.indexOf('$0') === -1);
});

var brief = { as_of: '2026-11-16', channels: {
  meta: { label: 'Meta', mode: 'frozen', rule_says: 'Hold - cooldown', actionable: false, blockers: ['mode:frozen', 'cooldown'], spend_7d: 77607.22, roas_7d: 1.95, roas_days: 7, roas_prior_7d: 2.21 },
  snapchat: { label: 'Snapchat', mode: 'auto', rule_says: 'Not enough data', actionable: false, blockers: ['feed_gap:6/7 days measured'], spend_7d: 4121, roas_7d: null, roas_days: 7, roas_prior_7d: 8.58 },
  bing: { label: 'Bing', mode: 'auto', rule_says: 'Raise 20%', actionable: true, blockers: [], spend_7d: 1430, roas_7d: 3.1, roas_days: 7, roas_prior_7d: 2.8 }
} };

test('budget calls pass the brief through: rule text, blockers, faded when not actionable', function () {
  var html = M.callsHtml(brief, '2026-11-16');
  assert.ok(html.indexOf('Hold - cooldown') !== -1 && html.indexOf('mode:frozen, cooldown') !== -1);
  assert.ok(html.indexOf('$77,607') !== -1 && html.indexOf('1.95x') !== -1);
  assert.strictEqual((html.match(/class="op-faded"/g) || []).length, 2);
  assert.ok(html.indexOf('Raise 20%') !== -1);
  assert.strictEqual(M.callsHtml(brief, '2026-11-15'), '');
});

test('a ROAS the brief withheld is a dash with no day count beside it', function () {
  var html = M.callsHtml(brief, '2026-11-16');
  var snap = html.slice(html.indexOf('Snapchat'), html.indexOf('Bing'));
  assert.ok(snap.indexOf('<td>—<span class="op-sub"></span></td>') !== -1);
});

test('index.html loads the module after the two modules it draws with', function () {
  var page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var at = page.indexOf('<script src="daily_onepage_module.js"></script>');
  assert.ok(at !== -1);
  assert.ok(page.indexOf('<script src="whatnot_shows_module.js"></script>') < at);
  assert.ok(page.indexOf('<script src="intl_meta_module.js"></script>') < at);
});

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('all daily one-page tests passed');
