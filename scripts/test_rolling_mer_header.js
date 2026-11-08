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

var SPOTIFY_CAP = require('./fixtures/spotify_ads_config.json');
var SPOTIFY_CAP_LABEL = 'Planned starting cap: $500/day total, split evenly across enabled formats (formats pending). Plan only, not spend.';

test('Spotify line on rolling MER header: No data excluded from measured MER; cap absent on 11/5 fixture', function () {
  assert.strictEqual(mer.d2c_coverage.spotify_included_in_d2c, false);
  assert.ok(mer.d2c_coverage.excluded_channels.some(function (c) { return c.channel === 'spotify'; }));
  assert.strictEqual(mer.channel_ad_spend['2026-11-05'].spotify, null);
  assert.strictEqual(Header.spotifyExcludedFromMer(mer), true);
  assert.strictEqual(Header.spotifyPlannedCapLabel(mer), '', 'cap absent → show nothing');
  var note = Header.spotifyNoteHtml(mer, mer);
  assert.ok(note.indexOf('Spotify Ads: No data — excluded from measured MER') !== -1);
  assert.ok(note.indexOf('Planned starting cap') === -1);
  assert.ok(note.indexOf('Planned test cap') === -1);
  assert.ok(note.indexOf('$500') === -1);
  assert.ok(note.indexOf('$300') === -1);
  var resolved = Header.resolve(embedded, mer);
  assert.strictEqual(resolved.data.latest.spend_7d, 91309.61);
  assert.strictEqual(resolved.data.latest.mer_7d_pooled, 2.1619);
  assert.strictEqual(resolved.data.latest.rev_7d, 197402.55);
});

test('Spotify companion daily starting cap labels the plan; MER unchanged; legacy $300 ignored', function () {
  assert.strictEqual(Header.spotifyPlannedCapLabel(SPOTIFY_CAP), SPOTIFY_CAP_LABEL);
  assert.strictEqual(Header.spotifyPlannedCapLabel({
    planned_total_cap_usd: 300,
    cap_type: 'lifetime_test',
    per_ad: [{ name: 'Drive-Thru', planned_cap_usd: 100 }]
  }), '');
  var withCap = JSON.parse(JSON.stringify(mer));
  withCap.spotify_ads_config = SPOTIFY_CAP;
  var resolved = Header.resolve(embedded, withCap);
  var baseline = Header.resolve(embedded, mer);
  assert.strictEqual(resolved.data.latest.spend_7d, baseline.data.latest.spend_7d);
  assert.strictEqual(resolved.data.latest.mer_7d_pooled, baseline.data.latest.mer_7d_pooled);
  assert.strictEqual(resolved.data.latest.rev_7d, baseline.data.latest.rev_7d);
});

test('Spotify planned cap present is labelled separately; MER / spend_7d unchanged', function () {
  var withCap = JSON.parse(JSON.stringify(mer));
  withCap.spotify_ads_config = SPOTIFY_CAP;
  assert.strictEqual(Header.spotifyPlannedCapLabel(SPOTIFY_CAP), SPOTIFY_CAP_LABEL);
  assert.strictEqual(Header.spotifyPlannedCapLabel(withCap), SPOTIFY_CAP_LABEL);
  var resolved = Header.resolve(embedded, withCap);
  var baseline = Header.resolve(embedded, mer);
  assert.strictEqual(resolved.data.latest.spend_7d, baseline.data.latest.spend_7d);
  assert.strictEqual(resolved.data.latest.mer_7d_pooled, baseline.data.latest.mer_7d_pooled);
  assert.strictEqual(resolved.data.latest.rev_7d, baseline.data.latest.rev_7d);
  assert.strictEqual(resolved.data.latest.spend_7d, 91309.61);
  assert.strictEqual(resolved.data.latest.mer_7d_pooled, 2.1619);
  var note = Header.spotifyNoteHtml(resolved.data, withCap);
  assert.ok(note.indexOf(SPOTIFY_CAP_LABEL) !== -1);
  assert.ok(note.indexOf('not spend') !== -1);
  assert.ok(note.indexOf('Drive-Thru') === -1);
  assert.ok(note.indexOf('$300') === -1);
  assert.ok(note.indexOf('Spotify Ads: No data — excluded from measured MER') !== -1);
  assert.strictEqual(Header.spotifyPlannedCapLabel({}), '');
});

if (failed) {
  console.error('\n' + failed + ' rolling MER header test(s) failed');
  process.exit(1);
}
console.log('\nAll rolling MER header tests passed');
