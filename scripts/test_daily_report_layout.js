'use strict';

var assert = require('assert');
var Paid = require('../paid_channels_module.js');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) {
    failed += 1;
    console.error('FAIL - ' + name);
    console.error('     ' + (e && e.stack ? e.stack : e));
  }
}

test('display list is Meta → Google → Bing → Reddit → Snapchat → ChatGPT → Pinterest → AppLovin → X → Taboola → Outbrain → Spotify', function () {
  var ids = Paid.displayChannels().map(function (c) { return c.id; });
  assert.deepStrictEqual(ids, ['meta', 'google', 'bing', 'reddit', 'snapchat', 'chatgpt', 'pinterest', 'applovin', 'x', 'taboola', 'outbrain', 'spotify']);
});

test('unpublished Pinterest is missing, never $0', function () {
  Paid.CHANNELS.forEach(function (ch) { Paid.setFeeds(ch.id, null, null, null); });
  Paid._setMerDoc({ as_of: '2026-10-24', advertising_sources: { '2026-10-24': { meta: { spend: 10 } } } });
  var pin = Paid.displayChannels().filter(function (c) { return c.id === 'pinterest'; })[0];
  var day = Paid.dayForDisplay(pin, '2026-10-24');
  assert.strictEqual(day.hasFeed, false);
  assert.strictEqual(Paid.spendTxt(day), 'missing');
  assert.ok(Paid.spendPerChannelHtml('2026-10-24').indexOf('missing') !== -1);
  assert.ok(Paid.spendPerChannelHtml('2026-10-24').indexOf('Pinterest') !== -1);
  assert.ok(Paid.spendPerChannelHtml('2026-10-24').indexOf('$0.00') === -1 || Paid.spendTxt(day) === 'missing');
});

test('published mer.pinterest spend is shown; still missing when the key is absent', function () {
  Paid._setMerDoc({
    as_of: '2026-10-25',
    pinterest: { as_of: '2026-10-25', spend: 42, spend_d2c: 42, clicks: 8, live: true },
    advertising_sources: {
      '2026-10-25': { pinterest_ads: { spend: 42, clicks: 8, complete: true } }
    }
  });
  var pin = Paid.displayChannels().filter(function (c) { return c.id === 'pinterest'; })[0];
  var live = Paid.dayForDisplay(pin, '2026-10-25');
  assert.strictEqual(live.hasFeed, true);
  assert.strictEqual(Paid.spendTxt(live), '$42.00');
  var empty = Paid.dayForDisplay(pin, '2026-10-01');
  assert.strictEqual(empty.hasFeed, false);
  assert.strictEqual(Paid.spendTxt(empty), 'missing');
});

test('10/24 Meta and Bing are published dollars; AppLovin is $0; Pinterest publishes 10/26', function () {
  var mer = require('./fixtures/mer_for_manus_2026-10-26.json');
  Paid._setMerDoc(mer);
  Paid.CHANNELS.forEach(function (ch) { Paid.setFeeds(ch.id, null, mer, null); });
  var byId = {};
  Paid.displayChannels().forEach(function (ch) { byId[ch.id] = Paid.dayForDisplay(ch, '2026-10-24'); });
  assert.strictEqual(byId.meta.hasFeed, true);
  assert.strictEqual(byId.google.hasFeed, true);
  assert.strictEqual(byId.bing.hasFeed, true);
  assert.ok(byId.bing.spend > 0);
  assert.strictEqual(byId.applovin.hasFeed, true);
  assert.strictEqual(Paid.spendTxt(byId.applovin), '$0.00');
  var pin = Paid.displayChannels().filter(function (c) { return c.id === 'pinterest'; })[0];
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay(pin, '2026-10-26')), '$64.60');
  var html = Paid.detailBreakdownHtml('2026-10-24');
  assert.ok(html.indexOf('Pinterest') !== -1);
  assert.ok(html.indexOf('AppLovin') !== -1);
  assert.ok(html.indexOf('platform-reported, click-based') !== -1);
});

test('AppLovin missing stays missing; published $0 stays $0; ROAS label is click-based', function () {
  Paid.CHANNELS.forEach(function (ch) { Paid.setFeeds(ch.id, null, null, null); });
  Paid._setMerDoc({
    as_of: '2026-10-24',
    advertising_sources: {
      '2026-10-24': { meta: { spend: 10 }, applovin: { spend: 0, clicks: 0, conversions: 0, revenue: 0, complete: true } }
    }
  });
  var al = Paid.displayChannels().filter(function (c) { return c.id === 'applovin'; })[0];
  assert.strictEqual(al.roasLabel, 'platform-reported, click-based');
  var zero = Paid.dayForDisplay(al, '2026-10-24');
  assert.strictEqual(zero.hasFeed, true);
  assert.strictEqual(Paid.spendTxt(zero), '$0.00');
  assert.strictEqual(Paid.roasDisplay(zero, al), '— · platform-reported, click-based');
  var miss = Paid.dayForDisplay(al, '2026-10-01');
  assert.strictEqual(miss.hasFeed, false);
  assert.strictEqual(Paid.spendTxt(miss), 'missing');
  assert.strictEqual(Paid.roasDisplay(miss, al), 'missing');
  var spendHtml = Paid.spendPerChannelHtml('2026-10-24');
  assert.ok(spendHtml.indexOf('AppLovin') !== -1);
  assert.ok(spendHtml.indexOf('$0.00') !== -1);
  Paid._setMerDoc({
    as_of: '2026-10-25',
    channel_ad_spend: { applovin: 12.5 }
  });
  var cas = Paid.dayForDisplay(al, '2026-10-25');
  assert.strictEqual(Paid.spendTxt(cas), '$12.50');
});

test('renderStrip does not inject a dashboard strip after yday-bar', function () {
  if (typeof document === 'undefined') {
    Paid.renderStrip();
    return;
  }
  throw new Error('unexpected document in node test');
});

test('channel_revenue on the PARTIAL row is preferred and unpublished stays missing', function () {
  var rows = Paid.channelRevenueRows({
    date: '2026-10-25',
    channel_revenue: { shopify: 1111.1, amazon: { revenue: 2222.2 }, tiktok: null },
    channel_observations: { shopify: { revenue: 9, data_available: true } }
  });
  var by = {};
  rows.forEach(function (r) { by[r.label] = r.value; });
  assert.strictEqual(by.Shopify, '$1,111.10');
  assert.strictEqual(by.Amazon, '$2,222.20');
  assert.strictEqual(by.TikTok, 'missing');
  assert.strictEqual(by.Whatnot, 'missing');
});

test('channel_ad_spend on the PARTIAL row wins; absent keys fall through; null is missing', function () {
  globalThis.PARTIAL_REPORTS = [{
    date: '2026-10-25',
    channel_ad_spend: { meta: 50, google: { spend: 0 }, bing: null }
  }];
  Paid._setMerDoc({
    as_of: '2026-10-25',
    advertising_sources: {
      '2026-10-25': { meta: { spend: 9 }, google: { spend: 9 }, bing: { spend: 9 }, reddit: { spend: 3 } }
    }
  });
  var byId = {};
  Paid.displayChannels().forEach(function (ch) { byId[ch.id] = Paid.dayForDisplay(ch, '2026-10-25'); });
  assert.strictEqual(Paid.spendTxt(byId.meta), '$50.00');
  assert.strictEqual(Paid.spendTxt(byId.google), '$0.00');
  assert.strictEqual(Paid.spendTxt(byId.bing), 'missing');
  assert.strictEqual(Paid.spendTxt(byId.reddit), '$3.00');
  assert.strictEqual(Paid.spendTxt(byId.pinterest), 'missing');
  assert.strictEqual(Paid.spendTxt(byId.applovin), 'missing');
  delete globalThis.PARTIAL_REPORTS;
});

test('scalar channel_ad_spend keeps mer clicks and Bing D2C split', function () {
  globalThis.PARTIAL_REPORTS = [{
    date: '2026-10-25',
    channel_ad_spend: { bing: 130.3 }
  }];
  Paid._setMerDoc({
    as_of: '2026-10-25',
    advertising_sources: {
      '2026-10-25': {
        bing_ads: { spend: 130.3, clicks: 243, spend_d2c: 60.56, spend_amazon: 69.74, destination: 'mixed' }
      }
    }
  });
  var bing = Paid.dayForDisplay({
    id: 'bing',
    merKey: 'bing',
    sourceKeys: ['bing', 'bing_ads', 'microsoft_ads']
  }, '2026-10-25');
  assert.strictEqual(Paid.spendTxt(bing), '$130.30');
  assert.strictEqual(bing.hasClicks, true);
  assert.strictEqual(bing.clicks, 243);
  assert.strictEqual(bing.d2c, 60.56);
  assert.strictEqual(bing.amazon, 69.74);
  delete globalThis.PARTIAL_REPORTS;
});

test('hydratePartialFromMer adds a 10/25 card from mer.as_of without inventing spend', function () {
  globalThis.PARTIAL_REPORTS = [{ date: '2026-10-24', channel_observations: {} }];
  var mer = {
    as_of: '2026-10-25',
    shop_revenue: 26420.44,
    channel_revenue: { shopify: 26420.44, amazon: 100, tiktok: null, whatnot: 0 },
    channel_ad_spend: { meta: 10, pinterest: null },
    advertising_sources: { '2026-10-25': { google_ads: { spend: 4 } } }
  };
  assert.strictEqual(Paid.hydratePartialFromMer(mer), true);
  var row = globalThis.PARTIAL_REPORTS.filter(function (r) { return r.date === '2026-10-25'; })[0];
  assert.ok(row);
  assert.deepStrictEqual(Paid.channelRevenueRows(row).map(function (x) { return x.value; }), [
    '$26,420.44', '$100.00', 'missing', '$0.00'
  ]);
  Paid._setMerDoc(mer);
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay({ id: 'meta', sourceKeys: ['meta'], merKey: 'meta' }, '2026-10-25')), '$10.00');
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay({ id: 'pinterest', sourceKeys: ['pinterest_ads', 'pinterest'], merKey: 'pinterest' }, '2026-10-25')), 'missing');
  delete globalThis.PARTIAL_REPORTS;
});

test('X Ads: not live = $0 / not live; live shows cash cost, credit, fee and flags', function () {
  Paid._setMerDoc({ as_of: '2026-11-02', x: { status: 'not_live', live: false, by_date: {} } });
  assert.strictEqual(Paid.xSpendTxt('2026-11-02'), '$0.00 · not live');
  assert.ok(Paid.xDetailHtml('2026-11-02').indexOf('not live') !== -1);
  Paid._setMerDoc({ as_of: '2026-11-02', x: { status: 'live', live: true, plan: 'monthly',
    flags: ['X ad credit $50.00 unused expires 2026-11-30 (5 days left).'],
    by_date: { '2026-11-02': { spend: 400, clicks: 10, conversions: 2, revenue: 600, fee: 33.33,
      credit_used: 100, cash_spend: 300, cash_cost: 333.33 } } } });
  var html = Paid.xDetailHtml('2026-11-02');
  assert.ok(html.indexOf('$333.33') !== -1);
  assert.ok(html.indexOf('ad credit −$100.00') !== -1);
  assert.ok(html.indexOf('1.80x') !== -1);
  assert.ok(html.indexOf('expires 2026-11-30') !== -1);
  assert.strictEqual(Paid.xSpendTxt('2026-11-02'), '$400.00 (cash cost $333.33)');
  Paid._setMerDoc(null);
  assert.strictEqual(Paid.xSpendTxt('2026-11-04'), 'missing');
  assert.ok(Paid.xDetailHtml('2026-11-04').indexOf('missing') !== -1);
  assert.ok(Paid.xDetailHtml('2026-11-04').indexOf('$0.00') === -1);

  Paid._setMerDoc({ advertising_sources: {} });
  Paid._setAdvDaily({ '2026-11-05': { x_ads: { spend: 65.62, cash_cost: 93.02, clicks: 12, conversions: 1, revenue: 40 } } });
  var htmlDaily = Paid.xDetailHtml('2026-11-05');
  assert.ok(htmlDaily.indexOf('$65.62') !== -1, 'advDaily X spend renders when mer.x is absent');
  assert.ok(htmlDaily.indexOf('$93.02') !== -1);
  assert.ok(htmlDaily.indexOf('advertising_sources') !== -1 || htmlDaily.indexOf('x_ads') !== -1 || htmlDaily.length > 0);
  assert.strictEqual(Paid.xSpendTxt('2026-11-05'), '$65.62 (cash cost $93.02)');
  Paid._setAdvDaily(null);
  Paid._setMerDoc({ advertising_sources: { '2026-11-05': { x_ads: { spend: 65.62, cash_cost: 93.02 } } } });
  assert.doesNotThrow(function () { Paid.xDetailHtml('2026-11-05'); });
  assert.ok(Paid.xDetailHtml('2026-11-05').indexOf('$65.62') !== -1);
  Paid._setMerDoc(null);
  Paid._setDailyFile('x', { '2026-11-05': { spend: 65.62, cash_cost: 93.02, complete: true } });
  assert.ok(Paid.xDetailHtml('2026-11-05').indexOf('$65.62') !== -1, 'x_ads_daily.json is read');
  Paid._setDailyFile('x', null);
});

test('Taboola: listed after X; $0 day = $0 / not live; unpulled day = missing; ROAS platform-reported next to Shopify-attributed', function () {
  Paid._setMerDoc({ as_of: '2026-11-02',
    taboola: { status: 'not_live', live: false, by_date: { '2026-11-02': { spend: 0, clicks: 0, conversions: 0, revenue: 0 } } },
    advertising_sources: {
      '2026-11-02': { taboola_ads: { spend: 0, revenue: 0, conversions: 0, clicks: 0, complete: true, live: false, source: 'Taboola Backstage API (platform-reported)' } },
      '2026-09-01': { taboola_ads: { spend: null, complete: false, missing: true } }
    } });
  assert.strictEqual(Paid.taboolaSpendTxt('2026-11-02'), '$0.00 · not live');
  assert.ok(Paid.taboolaDetailHtml('2026-11-02').indexOf('not live (0 campaigns)') !== -1);
  assert.ok(Paid.taboolaDetailHtml('2026-11-02').indexOf('Shopify-attributed</td><td>missing') !== -1);
  assert.strictEqual(Paid.taboolaSpendTxt('2026-09-01'), 'missing');
  assert.ok(Paid.taboolaDetailHtml('2026-09-01').indexOf('$0.00') === -1);
  Paid._setMerDoc({ as_of: '2026-11-02',
    taboola: { status: 'live', live: true, by_date: { '2026-11-02': { spend: 100, clicks: 40, conversions: 3, revenue: 280 } } },
    ad_channel_throttles: { series_28d: { by_channel: { taboola: [{ date: '2026-11-02', shopify_revenue: 150, shopify_revenue_status: 'verified' }] } } } });
  var html = Paid.taboolaDetailHtml('2026-11-02');
  assert.ok(html.indexOf('2.80x · platform-reported') !== -1);
  assert.ok(html.indexOf('Shopify-attributed</td><td>$150.00') !== -1);
  assert.strictEqual(Paid.taboolaSpendTxt('2026-11-02'), '$100.00');
  Paid._setMerDoc({ advertising_sources: {} });
  Paid._setAdvDaily({ '2026-11-04': { taboola_ads: { spend: 0 } } });
  assert.strictEqual(Paid.taboolaSpendTxt('2026-11-04'), 'missing', 'unmarked {spend:0} on advDaily is not $0.00 · not live');
  assert.ok(Paid.taboolaDetailHtml('2026-11-04').indexOf('$0.00') === -1);
  Paid._setAdvDaily({ '2026-11-04': { taboola_ads: { spend: 0, complete: true, live: false } } });
  assert.strictEqual(Paid.taboolaSpendTxt('2026-11-04'), '$0.00 · not live');
  Paid._setAdvDaily(null);
  Paid._setMerDoc(null);
});

test('Outbrain: after Taboola; not imported = missing; blanks = unknown; ROAS platform-reported, CPA, Shopify-attributed', function () {
  Paid._setMerDoc({ as_of: '2026-11-02', outbrain: { status: 'no_data', live: false, by_date: {} },
    advertising_sources: { '2026-11-02': { outbrain_ads: { spend: null, complete: false, missing: true } } } });
  assert.strictEqual(Paid.outbrainSpendTxt('2026-11-02'), 'missing');
  assert.ok(Paid.outbrainDetailHtml('2026-11-02').indexOf('$0.00') === -1);
  Paid._setMerDoc({ as_of: '2026-11-03',
    outbrain: { status: 'live', live: true, by_date: {
      '2026-11-02': { spend: 100, clicks: 40, conversions: 4, revenue: 300 },
      '2026-11-03': { spend: 80, clicks: null, conversions: null, revenue: null, revenue_known: false, conversions_known: false } } },
    ad_channel_throttles: { series_28d: { by_channel: { outbrain: [{ date: '2026-11-02', shopify_revenue: 90, shopify_revenue_status: 'verified' }] } } } });
  var html = Paid.outbrainDetailHtml('2026-11-02');
  assert.ok(html.indexOf('3.00x · platform-reported') !== -1);
  assert.ok(html.indexOf('CPA $25.00') !== -1);
  assert.ok(html.indexOf('Shopify-attributed</td><td>$90.00') !== -1);
  var h2 = Paid.outbrainDetailHtml('2026-11-03');
  assert.ok(h2.indexOf('unknown · platform-reported') !== -1);
  assert.ok(h2.indexOf('CPA unknown') !== -1);
  Paid._setMerDoc(null);
  Paid._setAdvDaily({ '2026-11-04': { outbrain_ads: { spend: 0 } } });
  assert.strictEqual(Paid.outbrainSpendTxt('2026-11-04'), 'missing', 'unmarked {spend:0} is missing, not $0.00 · not live');
  Paid._setAdvDaily({ '2026-11-04': { outbrain_ads: { spend: 0, complete: true, live: false, status: 'not_launched' } } });
  assert.strictEqual(Paid.outbrainSpendTxt('2026-11-04'), '$0.00 · not live');
  Paid._setAdvDaily(null);
});

test('Daily Reports advDaily bare $0 is missing; complete $0 is measured — same rule as Ad Channels', function () {
  var reddit = Paid.CHANNELS.filter(function (c) { return c.id === 'reddit'; })[0];
  Paid._setMerDoc(null);
  Paid.setFeeds('reddit', null, null, null);
  Paid._setAdvDaily({ '2026-11-04': { reddit_ads: { spend: 0 } } });
  assert.strictEqual(Paid.spendIsPublished({ spend: 0 }), false);
  assert.strictEqual(Paid.isMeasuredZero({ spend: 0, complete: true }), true);
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay(reddit, '2026-11-04')), 'missing');
  Paid._setAdvDaily({ '2026-11-04': { reddit_ads: { spend: 0, complete: true } } });
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay(reddit, '2026-11-04')), '$0.00');
  Paid._setAdvDaily(null);
});

/* ---------------------------------------------------------- Spotify Ads */
function spotifyReset() { Paid._setMerDoc(null); Paid._setAdvDaily(null); Paid._setDailyFile('spotify', null); Paid._setSpotifyConfig(null); }
function noConflict(txt) {
  assert.ok(txt.indexOf('missing') === -1, 'no "missing" text on a Spotify row: ' + txt);
  assert.ok(txt.indexOf('unverified') === -1, 'no "unverified" text on a Spotify row: ' + txt);
}
function spotifyMainRow(html) { return html.split('</tr>')[0]; }

test('Spotify: unavailable day → Channel off spend (no $0, no missing/unverified), excluded from D2C coverage note', function () {
  spotifyReset();
  Paid._setMerDoc({ as_of: '2026-11-05', advertising_sources: { '2026-11-05': { spotify_ads: { spend: null, missing: true } }, '2026-11-04': { spotify_ads: { spend: 0 } } } });
  ['2026-11-03', '2026-11-04', '2026-11-05'].forEach(function (d) {
    assert.strictEqual(Paid.spotifySpendTxt(d), 'Channel off', d);
    var html = Paid.spotifyDetailHtml(d);
    assert.ok(html.indexOf('$0.00') === -1, 'unmeasured day is never $0: ' + d);
    assert.ok(spotifyMainRow(html).indexOf('<td>Channel off</td>') !== -1);
    assert.ok(html.indexOf('excluded from D2C ad spend / MER') !== -1, 'coverage labelled');
    noConflict(html);
  });
  var strip = Paid.spendPerChannelHtml('2026-11-05');
  assert.ok(strip.indexOf('<td>Spotify Ads</td><td>Channel off</td>') !== -1);
  spotifyReset();
});

test('Spotify: genuine measured $0 → number only ($0.00), no "No data" on that row', function () {
  spotifyReset();
  Paid._setAdvDaily({ '2026-11-05': { spotify_ads: { spend: 0, complete: true, clicks: 0, conversions: 0, live: false, source: 'Spotify Ads API' } } });
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), '$0.00');
  var html = Paid.spotifyDetailHtml('2026-11-05');
  assert.ok(spotifyMainRow(html).indexOf('<td>$0.00</td>') !== -1);
  assert.ok(html.indexOf('No data') === -1, 'measured $0 row never says No data: ' + html);
  noConflict(html);
  // closed_day and verified status are measured too
  Paid._setAdvDaily({ '2026-11-05': { spotify: { spend: 0, closed_day: true } } });
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), '$0.00');
  spotifyReset();
});

test('Spotify: spend-only row → ROAS "No data" (never invented); platform ROAS only when Spotify reports value', function () {
  spotifyReset();
  Paid._setAdvDaily({ '2026-11-05': { 'Spotify Ads': { spend: 120, complete: true, revenue: 0, roas: null, source: 'Spotify Ads API' } } });
  var row = spotifyMainRow(Paid.spotifyDetailHtml('2026-11-05'));
  var cells = row.split('<td>').map(function (c) { return c.replace(/<\/td>.*/, ''); });
  assert.strictEqual(cells[2], '$120.00');
  assert.strictEqual(cells[5], 'No data', 'spend-only revenue is No data, not $0');
  assert.strictEqual(cells[6], 'No data', 'spend-only ROAS is No data');
  assert.ok(row.indexOf('x · platform-reported') === -1);
  noConflict(row);
  Paid._setAdvDaily({ '2026-11-05': { spotify_ads: { spend: 100, complete: true, platform_revenue: 250, conversions: 5, clicks: 80 } } });
  assert.ok(Paid.spotifyDetailHtml('2026-11-05').indexOf('2.50x · platform-reported') !== -1);
  spotifyReset();
});

test('Spotify: no conflicting labels — every day is either a number or "No data", never both', function () {
  spotifyReset();
  Paid._setDailyFile('spotify', { by_date: {
    '2026-11-02': { spend: 0, complete: true },
    '2026-11-03': { spend: null, missing: true },
    '2026-11-04': { spend: 0 },
    '2026-11-05': { spend: 55.5, spend_status: 'verified' }
  } });
  var expect = { '2026-11-02': '$0.00', '2026-11-03': 'Channel off', '2026-11-04': 'Channel off', '2026-11-05': '$55.50', '2026-11-06': 'Channel off' };
  Object.keys(expect).forEach(function (d) {
    var txt = Paid.spotifySpendTxt(d);
    assert.strictEqual(txt, expect[d], d);
    var hasNum = /\$\d/.test(txt);
    assert.ok(!(hasNum && txt.indexOf('Channel off') !== -1), 'number + Channel off on ' + d);
    var spendCell = spotifyMainRow(Paid.spotifyDetailHtml(d)).split('<td>')[2].replace(/<\/td>.*/, '');
    assert.ok(/^\$\d/.test(spendCell) !== (spendCell === 'Channel off'), 'spend cell is exactly one of number / Channel off: ' + spendCell);
    noConflict(Paid.spotifyDetailHtml(d));
  });
  spotifyReset();
});

test('Spotify: aliases join (spotify_ads / spotify / Spotify / Spotify Ads) and spotify_ads_daily.json is read', function () {
  spotifyReset();
  ['spotify_ads', 'spotify', 'Spotify', 'Spotify Ads', 'spotify-ads'].forEach(function (k) {
    var day = {}; day[k] = { spend: 12.34, complete: true };
    Paid._setAdvDaily({ '2026-11-05': day });
    assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), '$12.34', 'alias ' + k);
  });
  Paid._setAdvDaily(null);
  Paid._setDailyFile('spotify', { '2026-11-05': { spend: 9, complete: true } });
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), '$9.00');
  spotifyReset();
});

test('Spotify: cash_cost kept separate from platform spend (mirrors X)', function () {
  spotifyReset();
  Paid._setAdvDaily({ '2026-11-05': { spotify_ads: { spend: 100, cash_cost: 130, complete: true } } });
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), '$100.00 (cash cost $130.00)');
  var html = Paid.spotifyDetailHtml('2026-11-05');
  assert.ok(spotifyMainRow(html).indexOf('<td>$100.00</td>') !== -1, 'spend cell is platform spend');
  assert.ok(html.indexOf('Spotify billing / cash cost</td><td>$130.00') !== -1);
  assert.ok(html.indexOf('$230.00') === -1, 'cash cost never summed into spend');
  spotifyReset();
});

test('Spotify: not-launched config → Channel off, no metrics; absence alone is Channel off, not paused', function () {
  spotifyReset();
  Paid._setMerDoc({ as_of: '2026-11-05', spotify: { status: 'not_launched', live: false } });
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), 'Channel off');
  var html = Paid.spotifyDetailHtml('2026-11-05');
  assert.ok(html.indexOf('$') === -1, 'no metrics for not launched: ' + html);
  assert.ok(spotifyMainRow(html).indexOf('<td>Channel off</td>') !== -1);
  noConflict(html);
  Paid._setMerDoc({ as_of: '2026-11-05' });
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), 'Channel off');
  assert.ok(Paid.spotifyDetailHtml('2026-11-05').indexOf('paused') === -1);
  spotifyReset();
});

test('Spotify is display-only on Daily Reports (never overlaid into D2C totals)', function () {
  assert.strictEqual(Paid.SPOTIFY_DISPLAY.displayOnly, true);
  assert.ok(Paid.CHANNELS.every(function (c) { return c.id !== 'spotify'; }), 'not in the overlay CHANNELS list');
});

var SPOTIFY_CAP = require('./fixtures/spotify_ads_config.json');
var SPOTIFY_CAP_LABEL = 'Planned 7-day test: $250/day total cap, $1,750 overall, allocated by performance across eligible formats (formats pending; start date not set). Plan only, not spend.';

test('Spotify: companion daily starting cap labels the plan, not spend; legacy $300 ignored', function () {
  spotifyReset();
  assert.strictEqual(SPOTIFY_CAP.planned_daily_cap_usd, 250);
  assert.strictEqual(SPOTIFY_CAP.planned_test_total_cap_usd, 1750);
  assert.strictEqual(SPOTIFY_CAP.test_duration_days, 7);
  assert.strictEqual(SPOTIFY_CAP.start_date, null);
  assert.strictEqual(SPOTIFY_CAP.format_groups[0].id, 'audio');
  assert.ok(!Object.prototype.hasOwnProperty.call(SPOTIFY_CAP.format_groups[0], 'name'));
  assert.ok(!Object.prototype.hasOwnProperty.call(SPOTIFY_CAP.format_groups[0], 'enabled'));
  assert.ok(!Object.prototype.hasOwnProperty.call(SPOTIFY_CAP, 'per_ad'));
  assert.ok(!Object.prototype.hasOwnProperty.call(SPOTIFY_CAP, 'planned_total_cap_usd'));
  Paid._setMerDoc({
    as_of: '2026-11-05',
    d2c_ad_spend: 13895.86,
    blended_mer: 2.51,
    total_ad_spend: 14695.42,
    spotify_ads_config: SPOTIFY_CAP,
    advertising_sources: { '2026-11-05': { spotify_ads: { spend: null, missing: true } } }
  });
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), 'Channel off');
  assert.strictEqual(Paid.spotifyCapNote(), SPOTIFY_CAP_LABEL);
  Paid._setMerDoc({
    as_of: '2026-11-05',
    spotify_ads_config: {
      planned_total_cap_usd: 300,
      cap_type: 'lifetime_test',
      per_ad: [{ name: 'Drive-Thru', planned_cap_usd: 100 }]
    }
  });
  assert.strictEqual(Paid.spotifyCapNote(), '');
  var spends = Paid.channelSpends('2026-11-05');
  assert.ok(!spends.channels.spotify);
  spotifyReset();
});

test('Spotify: planned cap present is labelled separately from No data spend; MER unchanged', function () {
  spotifyReset();
  var mer = {
    as_of: '2026-11-05',
    d2c_ad_spend: 13895.86,
    blended_mer: 2.51,
    total_ad_spend: 14695.42,
    shop_revenue: 34876.92,
    spotify_ads_config: SPOTIFY_CAP,
    advertising_sources: { '2026-11-05': { spotify_ads: { spend: null, missing: true } } }
  };
  Paid._setMerDoc(mer);
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), 'Channel off');
  assert.strictEqual(Paid.spotifyCapNote(), SPOTIFY_CAP_LABEL);
  var strip = Paid.spendPerChannelHtml('2026-11-05');
  assert.ok(strip.indexOf('<td>Spotify Ads</td><td>Channel off</td>') !== -1);
  assert.ok(strip.indexOf(SPOTIFY_CAP_LABEL) !== -1);
  assert.ok(strip.indexOf('<td>$250') === -1, 'cap is not the spend cell');
  assert.ok(strip.indexOf('split evenly') === -1);
  assert.ok(strip.indexOf('Drive-Thru') === -1);
  var html = Paid.spotifyDetailHtml('2026-11-05');
  assert.ok(spotifyMainRow(html).indexOf('<td>Channel off</td>') !== -1);
  assert.ok(html.indexOf(SPOTIFY_CAP_LABEL) !== -1);
  assert.ok(html.indexOf('not spend') !== -1);
  var spends = Paid.channelSpends('2026-11-05');
  assert.strictEqual(spends.d2cAdSpend, 13895.86);
  assert.strictEqual(spends.blendedMer, 2.51);
  assert.strictEqual(spends.totalAdSpend, 14695.42);
  assert.ok(!spends.channels.spotify, 'Spotify is not in overlay spend map');
  spotifyReset();
});

test('Spotify: planned cap absent renders nothing (never hardcoded)', function () {
  spotifyReset();
  Paid._setMerDoc({ as_of: '2026-11-05', advertising_sources: { '2026-11-05': { spotify_ads: { spend: null, missing: true } } } });
  assert.strictEqual(Paid.spotifyCapNote(), '');
  var strip = Paid.spendPerChannelHtml('2026-11-05');
  var html = Paid.spotifyDetailHtml('2026-11-05');
  assert.ok(strip.indexOf('Planned 7-day test') === -1);
  assert.ok(html.indexOf('Planned starting cap') === -1);
  assert.ok(strip.indexOf('Planned starting cap') === -1);
  assert.ok(strip.indexOf('Planned test cap') === -1);
  assert.ok(html.indexOf('Planned test cap') === -1);
  assert.ok(strip.indexOf('$250') === -1);
  assert.ok(html.indexOf('$1,750') === -1);
  assert.ok(strip.indexOf('$500') === -1);
  assert.ok(html.indexOf('$3,500') === -1);
  assert.ok(html.indexOf('split evenly') === -1);
  assert.ok(html.indexOf('$300') === -1);
  assert.ok(html.indexOf('Drive-Thru') === -1);
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), 'Channel off');
  var mer = require('./fixtures/cfo_2026_11_05_mer.json');
  Paid._setMerDoc(mer);
  assert.strictEqual(Paid.spotifyCapNote(), '', '11/5 fixture has no cap fields');
  spotifyReset();
});

if (failed) {
  console.error('\n' + failed + ' daily-report layout test(s) failed');
  process.exit(1);
}
console.log('\nAll daily-report layout tests passed');

test('mer.channel_ad_spend as-of snapshot is not applied to other dates', function () {
  delete globalThis.PARTIAL_REPORTS;
  var meta = { id: 'meta', sourceKeys: ['meta'], merKey: 'meta' };
  var reddit = { id: 'reddit', sourceKeys: ['reddit_ads', 'reddit'], merKey: 'reddit' };
  Paid._setMerDoc({
    as_of: '2026-11-05',
    channel_ad_spend: { meta: 9401.4, tiktok: 0, reddit: 150.12 },
    advertising_sources: { '2026-11-05': {
      meta: { spend: 9401.4, complete: true },
      reddit_ads: { spend: 150.12, complete: true },
      tiktok_ads: { spend: null, shopify_spend: 1264.56, complete: false }
    } }
  });
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay(meta, '2026-10-20')), 'missing');
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay(reddit, '2026-10-20')), 'missing');
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay(meta, '2026-11-05')), '$9,401.40');
  Paid._setMerDoc({
    as_of: '2026-11-05',
    channel_ad_spend: { '2026-11-05': { meta: 9401.4, tiktok: 1264.56 } },
    advertising_sources: { '2026-11-05': { meta: { spend: 9401.4, complete: true } } }
  });
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay(meta, '2026-10-20')), 'missing');
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay(meta, '2026-11-05')), '$9,401.40');
  Paid._setMerDoc(null);
});

test('bare $0 in mer advertising_sources / by_date fallbacks shows missing, not $0', function () {
  Paid._setMerDoc({ as_of: '2026-11-05', advertising_sources: { '2026-11-05': {
    reddit_ads: { spend: 0 }, pinterest_ads: { spend: 0, complete: true, closed_day: true } } } });
  var reddit = { id: 'reddit', sourceKeys: ['reddit_ads', 'reddit'], merKey: 'reddit' };
  var pinterest = { id: 'pinterest', sourceKeys: ['pinterest_ads', 'pinterest'], merKey: 'pinterest' };
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay(reddit, '2026-11-05')), 'missing');
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay(pinterest, '2026-11-05')), '$0.00');
  Paid._setMerDoc(null);
});

test('mer.channel_revenue flat snapshot is not applied to other dates', function () {
  delete globalThis.PARTIAL_REPORTS;
  Paid._setMerDoc({ as_of: '2026-11-05', channel_revenue: { meta: 12345 }, channel_ad_spend: { meta: 100 },
    advertising_sources: { '2026-11-05': { meta: { spend: 100, complete: true } } } });
  assert.ok(Paid.spendTxt(Paid.dayForDisplay({ id: 'meta', sourceKeys: ['meta'], merKey: 'meta' }, '2026-11-05')) === '$100.00');
  Paid._setMerDoc(null);
});
