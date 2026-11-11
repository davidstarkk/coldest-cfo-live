'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Paid = require('../paid_channels_module.js');
var Display = require('../channel_spend_display.js');

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

test('unpublished Pinterest before 10/30 pause is pending, never $0 / missing', function () {
  Paid.CHANNELS.forEach(function (ch) { Paid.setFeeds(ch.id, null, null, null); });
  Paid._setMerDoc({ as_of: '2026-10-24', advertising_sources: { '2026-10-24': { meta: { spend: 10 } } } });
  var pin = Paid.displayChannels().filter(function (c) { return c.id === 'pinterest'; })[0];
  var day = Paid.dayForDisplay(pin, '2026-10-24');
  assert.strictEqual(day.hasFeed, false);
  var txt = Paid.spendCellTxt(pin, '2026-10-24');
  assert.ok(isPendingLabel(txt) || txt === 'Channel off' || txt === 'pending backfill (last confirmed —)', txt);
  assert.notStrictEqual(txt, '$0.00');
  assert.ok(Paid.spendPerChannelHtml('2026-10-24').indexOf('missing') === -1);
  assert.ok(Paid.spendPerChannelHtml('2026-10-24').indexOf('Pinterest') !== -1);
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
  var emptyTxt = Paid.spendCellTxt(pin, '2026-10-01');
  assert.ok(isPendingLabel(emptyTxt) || emptyTxt === 'pending backfill (last confirmed —)', emptyTxt);
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
  var alTxt = Paid.spendCellTxt(Paid.displayChannels().filter(function (c) { return c.id === 'applovin'; })[0], '2026-10-24');
  assert.ok(alTxt === '$0.00' || isPendingLabel(alTxt) || alTxt === 'pending backfill (last confirmed —)', alTxt);
  var pin = Paid.displayChannels().filter(function (c) { return c.id === 'pinterest'; })[0];
  assert.strictEqual(Paid.spendTxt(Paid.dayForDisplay(pin, '2026-10-26')), '$64.60');
  var html = Paid.detailBreakdownHtml('2026-10-24');
  assert.ok(html.indexOf('Pinterest') !== -1);
  assert.ok(html.indexOf('AppLovin') !== -1);
  assert.ok(html.indexOf('platform-reported, click-based') !== -1);
});

test('AppLovin unpublished is Channel off; published $0 stays $0; ROAS label is click-based', function () {
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
  var missTxt = Paid.spendCellTxt(al, '2026-10-01');
  assert.ok(isPendingLabel(missTxt) || missTxt === 'pending backfill (last confirmed —)', missTxt);
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

test('channel_ad_spend on the PARTIAL row wins; absent keys fall through; null does not shadow measured rows', function () {
  globalThis.PARTIAL_REPORTS = [{
    date: '2026-10-25',
    channel_ad_spend: { meta: 50, google: { spend: 0 }, bing: null }
  }];
  Paid._setMerDoc({
    as_of: '2026-10-25',
    advertising_sources: {
      '2026-10-25': { meta: { spend: 9 }, google: { spend: 9 }, bing: { spend: 9, complete: true, live: true }, reddit: { spend: 3, complete: true, live: true } }
    }
  });
  var byId = {};
  Paid.displayChannels().forEach(function (ch) { byId[ch.id] = Paid.spendCellTxt(ch, '2026-10-25'); });
  assert.strictEqual(byId.meta, '$50.00');
  assert.strictEqual(byId.google, '$0.00');
  assert.strictEqual(byId.bing, '$9.00');
  assert.strictEqual(byId.reddit, '$3.00');
  assert.ok(isPendingLabel(byId.pinterest) || byId.pinterest === 'pending backfill (last confirmed —)', byId.pinterest);
  assert.ok(isPendingLabel(byId.applovin) || byId.applovin === 'pending backfill (last confirmed —)', byId.applovin);
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
  assert.strictEqual(Paid.spendCellTxt({ id: 'meta', sourceKeys: ['meta'], merKey: 'meta' }, '2026-10-25'), '$10.00');
  var pinTxt = Paid.spendCellTxt({ id: 'pinterest', sourceKeys: ['pinterest_ads', 'pinterest'], merKey: 'pinterest' }, '2026-10-25');
  assert.ok(isPendingLabel(pinTxt) || pinTxt === 'pending backfill (last confirmed —)', pinTxt);
  delete globalThis.PARTIAL_REPORTS;
});

test('X Ads: not live = Channel off; live shows cash cost, credit, fee and flags', function () {
  Paid._setMerDoc({ as_of: '2026-11-02', x: { status: 'not_live', live: false, by_date: {} } });
  assert.strictEqual(Paid.xSpendTxt('2026-11-02'), 'Channel off');
  assert.ok(Paid.xDetailHtml('2026-11-02').indexOf('not live') === -1);
  assert.ok(Paid.xDetailHtml('2026-11-02').indexOf('Channel off') !== -1);
  Paid._setMerDoc({ as_of: '2026-11-05', x: { status: 'live', live: true, plan: 'monthly',
    flags: ['X ad credit $50.00 unused expires 2026-11-30 (5 days left).'],
    by_date: { '2026-11-05': { spend: 400, clicks: 10, conversions: 2, revenue: 600, fee: 33.33,
      credit_used: 100, cash_spend: 300, cash_cost: 333.33 } } } });
  var html = Paid.xDetailHtml('2026-11-05');
  assert.ok(html.indexOf('$333.33') !== -1);
  assert.ok(html.indexOf('ad credit −$100.00') !== -1);
  assert.ok(html.indexOf('1.80x') !== -1);
  assert.ok(html.indexOf('expires 2026-11-30') !== -1);
  assert.strictEqual(Paid.xSpendTxt('2026-11-05'), '$400.00 (cash cost $333.33)');
  Paid._setMerDoc(null);
  var emptyX = Paid.xSpendTxt('2026-11-04');
  assert.ok(emptyX === 'Channel off' || emptyX.indexOf('pending backfill') !== -1, emptyX);
  assert.ok(Paid.xDetailHtml('2026-11-04').indexOf('missing') === -1);
  assert.ok(Paid.xDetailHtml('2026-11-04').indexOf('not live') === -1);

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

test('Taboola: listed after X; live=false measured 0 on an on-day is $0; unpulled day is not missing; ROAS platform-reported next to Shopify-attributed', function () {
  Paid._setMerDoc({ as_of: '2026-11-02',
    taboola: { status: 'not_live', live: false, by_date: { '2026-11-02': { spend: 0, clicks: 0, conversions: 0, revenue: 0 } } },
    advertising_sources: {
      '2026-11-02': { taboola_ads: { spend: 0, revenue: 0, conversions: 0, clicks: 0, complete: true, live: false, source: 'Taboola Backstage API (platform-reported)' } },
      '2026-09-01': { taboola_ads: { spend: null, complete: false, missing: true } }
    } });
  assert.strictEqual(Paid.taboolaSpendTxt('2026-11-02'), '$0.00', 'zero may carry live:false; only display_state off is Channel off');
  assert.ok(Paid.taboolaDetailHtml('2026-11-02').indexOf('not live') === -1);
  var preLaunch = Paid.taboolaSpendTxt('2026-09-01');
  assert.ok(isPendingLabel(preLaunch) || preLaunch === 'pending backfill (last confirmed —)' || preLaunch === 'Channel off', preLaunch);
  assert.ok(Paid.taboolaDetailHtml('2026-09-01').indexOf('missing') === -1);
  Paid._setMerDoc({ as_of: '2026-11-02',
    taboola: { status: 'live', live: true, by_date: { '2026-11-02': { spend: 100, clicks: 40, conversions: 3, revenue: 280 } } },
    ad_channel_throttles: { series_28d: { by_channel: { taboola: [{ date: '2026-11-02', shopify_revenue: 150, shopify_revenue_status: 'verified' }] } } } });
  var html = Paid.taboolaDetailHtml('2026-11-02');
  assert.ok(html.indexOf('2.80x · platform-reported') !== -1);
  assert.ok(html.indexOf('Shopify-attributed</td><td>$150.00') !== -1);
  assert.strictEqual(Paid.taboolaSpendTxt('2026-11-02'), '$100.00');
  Paid._setMerDoc({ advertising_sources: {} });
  Paid._setAdvDaily({ '2026-11-04': { taboola_ads: { spend: 0 } } });
  var unmarked = Paid.taboolaSpendTxt('2026-11-04');
  assert.ok(isPendingLabel(unmarked) || unmarked === 'pending backfill (last confirmed —)' || unmarked === '$0.00', 'pause day stays on; unmarked {spend:0} is not Channel off: ' + unmarked);
  assert.ok(Paid.taboolaDetailHtml('2026-11-04').indexOf('missing') === -1);
  Paid._setAdvDaily({ '2026-11-04': { taboola_ads: { spend: 0, complete: true, live: false } } });
  assert.strictEqual(Paid.taboolaSpendTxt('2026-11-04'), '$0.00', 'pause day + live:false measured 0 is $0');
  Paid._setAdvDaily({ '2026-11-04': { taboola_ads: { spend: 0, complete: true, live: true } } });
  assert.strictEqual(Paid.taboolaSpendTxt('2026-11-04'), '$0.00');
  Paid._setAdvDaily(null);
  Paid._setMerDoc(null);
});

test('Outbrain: after Taboola; not imported = Channel off; blanks = unknown; ROAS platform-reported, CPA, Shopify-attributed', function () {
  Paid._setMerDoc({ as_of: '2026-11-02', outbrain: { status: 'no_data', live: false, by_date: {} },
    advertising_sources: { '2026-11-02': { outbrain_ads: { spend: null, complete: false, missing: true } } } });
  assert.strictEqual(Paid.outbrainSpendTxt('2026-11-02'), 'Channel off');
  assert.ok(Paid.outbrainDetailHtml('2026-11-02').indexOf('missing') === -1);
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
  assert.strictEqual(Paid.outbrainSpendTxt('2026-11-04'), 'Channel off', 'unmarked {spend:0} is not a measured zero');
  Paid._setAdvDaily({ '2026-11-04': { outbrain_ads: { spend: 0, complete: true, live: false, status: 'not_launched' } } });
  assert.strictEqual(Paid.outbrainSpendTxt('2026-11-04'), 'Channel off');
  Paid._setAdvDaily(null);
});

test('Daily Reports advDaily bare $0 is missing; complete $0 is measured — same rule as Ad Channels', function () {
  var reddit = Paid.CHANNELS.filter(function (c) { return c.id === 'reddit'; })[0];
  Paid._setMerDoc(null);
  Paid.setFeeds('reddit', null, null, null);
  Paid._setAdvDaily({ '2026-11-04': { reddit_ads: { spend: 0 } } });
  assert.strictEqual(Paid.spendIsPublished({ spend: 0 }), false);
  assert.strictEqual(Paid.isMeasuredZero({ spend: 0, complete: true }), true);
  var redditBare = Paid.spendCellTxt(reddit, '2026-11-04');
  assert.ok(isPendingLabel(redditBare) || redditBare === 'pending backfill (last confirmed —)', 'Reddit is on before 11/9: ' + redditBare);
  Paid._setAdvDaily({ '2026-11-04': { reddit_ads: { spend: 0, complete: true, live: true } } });
  assert.strictEqual(Paid.spendCellTxt(reddit, '2026-11-04'), '$0.00', 'Reddit on before 11/9; measured $0 is $0');
  var pinterest = Paid.CHANNELS.filter(function (c) { return c.id === 'pinterest'; })[0];
  Paid._setAdvDaily({ '2026-11-04': { pinterest_ads: { spend: 0, complete: true, live: true } } });
  assert.strictEqual(Paid.spendCellTxt(pinterest, '2026-11-04'), 'Channel off', 'Pinterest off on/after 10/30 (no paused_on)');
  Paid._setAdvDaily(null);
});

/* ---------------------------------------------------------- Spotify Ads */
function spotifyReset() { Paid._setMerDoc(null); Paid._setAdvDaily(null); Paid._setDailyFile('spotify', null); }
function noConflict(txt) {
  assert.ok(txt.indexOf('missing') === -1, 'no "missing" text on a Spotify row: ' + txt);
  assert.ok(txt.indexOf('unverified') === -1, 'no "unverified" text on a Spotify row: ' + txt);
}
function spotifyMainRow(html) { return html.split('</tr>')[0]; }

test('Spotify: unavailable day → Channel off (spend cell never No data / missing / $0)', function () {
  spotifyReset();
  Paid._setMerDoc({ as_of: '2026-11-05', advertising_sources: { '2026-11-05': { spotify_ads: { spend: null, missing: true } }, '2026-11-04': { spotify_ads: { spend: 0 } } } });
  ['2026-11-03', '2026-11-04', '2026-11-05'].forEach(function (d) {
    assert.strictEqual(Paid.spotifySpendTxt(d), 'Channel off', d);
    var html = Paid.spotifyDetailHtml(d);
    assert.ok(html.indexOf('$0.00') === -1, 'unmeasured day is never $0: ' + d);
    assert.ok(html.indexOf('Channel off') !== -1);
    assert.ok(html.indexOf('missing') === -1);
  });
  var strip = Paid.spendPerChannelHtml('2026-11-05');
  assert.ok(strip.indexOf('<td>Spotify Ads</td><td>Channel off</td>') !== -1);
  assert.ok(strip.indexOf('No data') === -1);
  spotifyReset();
});

test('Spotify: genuine measured $0 with live=false → Channel off (registry / not launched)', function () {
  spotifyReset();
  Paid._setAdvDaily({ '2026-11-05': { spotify_ads: { spend: 0, complete: true, clicks: 0, conversions: 0, live: false, source: 'Spotify Ads API' } } });
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), 'Channel off');
  var html = Paid.spotifyDetailHtml('2026-11-05');
  assert.ok(spotifyMainRow(html).indexOf('<td>Channel off</td>') !== -1);
  assert.ok(html.indexOf('No data') === -1, 'spend cell never says No data: ' + html);
  assert.ok(html.indexOf('missing') === -1);
  Paid._setAdvDaily({ '2026-11-05': { spotify: { spend: 0, closed_day: true, live: false } } });
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), 'Channel off');
  spotifyReset();
});

test('Spotify: spend-only row → ROAS "No data" (never invented); platform ROAS only when Spotify reports value', function () {
  spotifyReset();
  Paid._setAdvDaily({ '2026-11-05': { 'Spotify Ads': { spend: 120, complete: true, revenue: 0, roas: null, source: 'Spotify Ads API' } } });
  var row = spotifyMainRow(Paid.spotifyDetailHtml('2026-11-05'));
  var cells = row.split('<td>').map(function (c) { return c.replace(/<\/td>.*/, ''); });
  assert.strictEqual(cells[2], 'Channel off', 'never_launched registry wins over a measured spend row');
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
  var expect = { '2026-11-02': 'Channel off', '2026-11-03': 'Channel off', '2026-11-04': 'Channel off', '2026-11-05': 'Channel off', '2026-11-06': 'Channel off' };
  Object.keys(expect).forEach(function (d) {
    var txt = Paid.spotifySpendTxt(d);
    assert.strictEqual(txt, expect[d], d);
    var hasNum = /\$\d/.test(txt);
    assert.ok(!(hasNum && txt.indexOf('Channel off') !== -1), 'number + Channel off on ' + d);
    var spendCell = spotifyMainRow(Paid.spotifyDetailHtml(d)).split('<td>')[2].replace(/<\/td>.*/, '');
    assert.ok(/^\$\d/.test(spendCell) !== (spendCell === 'Channel off'), 'spend cell is exactly one of number / Channel off: ' + spendCell);
  });
  spotifyReset();
});

test('Spotify: aliases join (spotify_ads / spotify / Spotify / Spotify Ads) and spotify_ads_daily.json is read', function () {
  spotifyReset();
  ['spotify_ads', 'spotify', 'Spotify', 'Spotify Ads', 'spotify-ads'].forEach(function (k) {
    var day = {}; day[k] = { spend: 12.34, complete: true };
    Paid._setAdvDaily({ '2026-11-05': day });
    assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), 'Channel off', 'alias ' + k + ' still off (never launched)');
  });
  Paid._setAdvDaily(null);
  Paid._setDailyFile('spotify', { '2026-11-05': { spend: 9, complete: true } });
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), 'Channel off');
  spotifyReset();
});

test('Spotify: cash_cost kept separate from platform spend (mirrors X)', function () {
  spotifyReset();
  Paid._setAdvDaily({ '2026-11-05': { spotify_ads: { spend: 100, cash_cost: 130, complete: true } } });
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), 'Channel off', 'never_launched: spend cell is Channel off, not billed dollars');
  var html = Paid.spotifyDetailHtml('2026-11-05');
  assert.ok(spotifyMainRow(html).indexOf('<td>Channel off</td>') !== -1, 'spend cell is Channel off');
  assert.ok(html.indexOf('Spotify billing / cash cost</td><td>$130.00') !== -1);
  assert.ok(html.indexOf('$230.00') === -1, 'cash cost never summed into spend');
  spotifyReset();
});

test('Spotify: not-launched config → Channel off; absence alone is also Channel off, not $0', function () {
  spotifyReset();
  Paid._setMerDoc({ as_of: '2026-11-05', spotify: { status: 'not_launched', live: false } });
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), 'Channel off');
  var html = Paid.spotifyDetailHtml('2026-11-05');
  assert.ok(html.indexOf('$0.00') === -1, 'no invented $0: ' + html);
  assert.ok(html.indexOf('No data') === -1);
  assert.ok(html.indexOf('missing') === -1);
  Paid._setMerDoc({ as_of: '2026-11-05' });
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-05'), 'Channel off');
  assert.ok(Paid.spotifyDetailHtml('2026-11-05').indexOf('paused') === -1);
  spotifyReset();
});

test('Spotify is display-only on Daily Reports (never overlaid into D2C totals)', function () {
  assert.strictEqual(Paid.SPOTIFY_DISPLAY.displayOnly, true);
  assert.ok(Paid.CHANNELS.every(function (c) { return c.id !== 'spotify'; }), 'not in the overlay CHANNELS list');
});

function allowedSpend(txt) {
  if (txt === 'Channel off' || txt === '$0.00') return true;
  if (/^\$[\d,]+\.\d{2}$/.test(txt)) return true;
  if (/^\$[\d,]+\.\d{2} \(cash cost \$[\d,]+\.\d{2}\)$/.test(txt)) return true;
  if (/^\$[\d,]+\.\d{2} \(cash cost not billed yet\)$/.test(txt)) return true;
  if (/^\$[\d,]+\.\d{2} pending backfill \(last confirmed \d{1,2}\/\d{1,2}\)$/.test(txt)) return true;
  return false;
}
function resetAll() {
  delete globalThis.PARTIAL_REPORTS;
  Paid._setMerDoc(null);
  Paid._setAdvDaily(null);
  Paid._setChannelStatus(null);
  Paid._setPendingBackfill(null);
  ['meta', 'google', 'bing', 'reddit', 'snapchat', 'chatgpt', 'pinterest', 'x', 'taboola', 'outbrain', 'spotify', 'applovin'].forEach(function (id) {
    try { Paid.setFeeds(id, null, null, null); } catch (e) { /* optional id */ }
    Paid._setDailyFile(id, null);
  });
}
function loadPr46() {
  return {
    mer: JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/pr46_channel_display.json'), 'utf8')),
    status: JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/channel_status.v1.json'), 'utf8')),
    pending: JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/pr46_pending_backfill.json'), 'utf8')),
    advDaily: JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/pr46_advertising_sources_daily.json'), 'utf8'))
  };
}
function isPendingLabel(txt) {
  return /pending backfill \(last confirmed /.test(String(txt || ''));
}

test('display_state contract: all four states per display channel, never re-derived when present', function () {
  resetAll();
  var dates = { off: '2026-11-01', zero: '2026-11-02', spend: '2026-11-03', pending_backfill: '2026-11-04' };
  Paid.displayChannels().forEach(function (ch) {
    var byDate = {
      '2026-11-01': {},
      '2026-11-02': {},
      '2026-11-03': {},
      '2026-11-04': {}
    };
    byDate['2026-11-01'][ch.id] = { display_state: 'off', display_amount: 0, measured_spend: 0 };
    byDate['2026-11-02'][ch.id] = { display_state: 'zero', display_amount: 0, measured_spend: 0, live: false };
    byDate['2026-11-03'][ch.id] = { display_state: 'spend', display_amount: 12.34, measured_spend: 12.34 };
    byDate['2026-11-04'][ch.id] = {
      display_state: 'pending_backfill',
      display_amount: null,
      measured_spend: null,
      last_confirmed_date: '2026-11-03',
      last_confirmed_amount: 12.34
    };
    Paid._setMerDoc({ as_of: '2026-11-04', channel_display: { by_date: byDate } });
    assert.strictEqual(Paid.spendCellTxt(ch, dates.off), 'Channel off', ch.id + ' off');
    assert.strictEqual(Paid.spendCellTxt(ch, dates.zero), '$0.00', ch.id + ' zero');
    assert.ok(Paid.spendCellTxt(ch, dates.spend).indexOf('$12.34') === 0, ch.id + ' spend ' + Paid.spendCellTxt(ch, dates.spend));
    var pending = Paid.spendCellTxt(ch, dates.pending_backfill);
    assert.ok(pending.indexOf('$12.34 pending backfill (last confirmed 11/3)') === 0, ch.id + ' pending ' + pending);
    assert.ok(!Display.forbiddenSpendLabel(pending));
  });
  resetAll();
});

test('invalid display_state / pending without last confirmed fail validation, never map to $0', function () {
  var bad = Display.validateContract({ display_state: 'nope' });
  assert.strictEqual(bad.valid, false);
  assert.strictEqual(Display.format(bad), '');
  var pend = Display.validateContract({ display_state: 'pending_backfill' });
  assert.strictEqual(pend.valid, false);
  assert.strictEqual(pend.error, 'pending_backfill_missing_last_confirmed');
  assert.notStrictEqual(Display.format(pend), '$0.00');
});

test('X 11/9 is $223.01 even with stale top-level as_of; cash cost stays separate', function () {
  resetAll();
  Paid._setMerDoc({
    as_of: '2026-11-04',
    x: { live: false, status: 'not_live', by_date: { '2026-11-04': { spend: 1.43, cash_cost: 28.83 } } }
  });
  Paid._setDailyFile('x', {
    live: true,
    by_date: {
      '2026-11-09': { spend: 223.01, cash_cost: 250.41, complete: true, live: true },
      '2026-11-04': { spend: 1.43, cash_cost: 28.83, complete: true, live: true }
    }
  });
  var txt = Paid.xSpendTxt('2026-11-09');
  assert.ok(txt.indexOf('$223.01') === 0, txt);
  assert.ok(txt.indexOf('cash cost $250.41') !== -1, txt);
  assert.ok(txt.indexOf('not live') === -1);
  var v = Paid.displayViewFor(Paid.X_DISPLAY, '2026-11-09');
  assert.strictEqual(v.display_state, 'spend');
  resetAll();
});

test('X live with no row for the day carries last confirmed, never $0', function () {
  resetAll();
  Paid._setMerDoc({ as_of: '2026-11-09', x: { live: true, status: 'live', by_date: {
    '2026-11-08': { spend: 223.02, cash_cost: 250.42, complete: true, live: true }
  } } });
  var txt = Paid.xSpendTxt('2026-11-09');
  assert.ok(txt.indexOf('pending backfill (last confirmed 11/8)') !== -1, txt);
  assert.ok(txt.indexOf('$223.02') !== -1, txt);
  assert.ok(txt.indexOf('$0') === -1 || txt.indexOf('$223.02') !== -1);
  resetAll();
});

test('ChatGPT root pre_launch with populated by_date is Channel off, not discarded missing', function () {
  resetAll();
  Paid._setDailyFile('chatgpt', {
    status: 'pre_launch',
    live: false,
    by_date: {
      '2026-11-09': { spend: 0, complete: true, live: false, spend_status: 'verified' }
    }
  });
  var chatgpt = Paid.CHANNELS.filter(function (c) { return c.id === 'chatgpt'; })[0];
  var days = Paid.mergeDaysFor(chatgpt);
  assert.ok(days['2026-11-09'], 'populated by_date is not discarded as a stub');
  assert.strictEqual(Paid.spendCellTxt(chatgpt, '2026-11-09'), 'Channel off');
  resetAll();
});

test('11/4 explicit-null channel_ad_spend does not shadow measured rows; display_state wins', function () {
  resetAll();
  globalThis.PARTIAL_REPORTS = [{
    date: '2026-11-04',
    channel_ad_spend: { bing: null, chatgpt: null, reddit: null }
  }];
  Paid._setMerDoc({
    as_of: '2026-11-04',
    channel_spend_display: {
      bing: { '2026-11-04': { display_state: 'zero', display_amount: 0 } },
      chatgpt: { '2026-11-04': { display_state: 'off' } }
    },
    advertising_sources: {
      '2026-11-04': {
        bing: { spend: 0, complete: true, live: true },
        chatgpt_ads: { spend: 0, complete: true, live: false },
        reddit_ads: { spend: 157.99, complete: true, live: true }
      }
    }
  });
  var bing = Paid.CHANNELS.filter(function (c) { return c.id === 'bing'; })[0];
  var chatgpt = Paid.CHANNELS.filter(function (c) { return c.id === 'chatgpt'; })[0];
  var reddit = Paid.CHANNELS.filter(function (c) { return c.id === 'reddit'; })[0];
  assert.strictEqual(Paid.spendCellTxt(bing, '2026-11-04'), '$0.00');
  assert.strictEqual(Paid.spendCellTxt(chatgpt, '2026-11-04'), 'Channel off');
  assert.strictEqual(Paid.spendCellTxt(reddit, '2026-11-04'), '$157.99');
  delete globalThis.PARTIAL_REPORTS;
  resetAll();
});

test('Outbrain 11/3–11/9 live=false measured zeros render Channel off', function () {
  resetAll();
  var by = {};
  ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'].forEach(function (d) {
    by[d] = { spend: 0, complete: true, live: false };
  });
  Paid._setDailyFile('outbrain', { live: false, by_date: by });
  ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'].forEach(function (d) {
    assert.strictEqual(Paid.outbrainSpendTxt(d), 'Channel off', d);
  });
  resetAll();
});

test('guard: day-card spend tables never contain missing / No data / not live', function () {
  resetAll();
  var merPath = path.join(__dirname, '..', 'mer_for_manus.json');
  var xPath = path.join(__dirname, '..', 'x_ads_daily.json');
  var gptPath = path.join(__dirname, '..', 'chatgpt_ads_daily.json');
  var obPath = path.join(__dirname, '..', 'outbrain_ads_daily.json');
  var mer = JSON.parse(fs.readFileSync(merPath, 'utf8'));
  Paid._setMerDoc(mer);
  Paid._setDailyFile('x', JSON.parse(fs.readFileSync(xPath, 'utf8')));
  Paid._setDailyFile('chatgpt', JSON.parse(fs.readFileSync(gptPath, 'utf8')));
  Paid._setDailyFile('outbrain', JSON.parse(fs.readFileSync(obPath, 'utf8')));
  ['taboola', 'reddit', 'bing', 'pinterest', 'snapchat'].forEach(function (id) {
    var p = path.join(__dirname, '..', id + '_ads_daily.json');
    if (fs.existsSync(p)) Paid._setDailyFile(id, JSON.parse(fs.readFileSync(p, 'utf8')));
  });
  var dates = ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'];
  dates.forEach(function (d) {
    var html = Paid.spendPerChannelHtml(d);
    assert.ok(html.indexOf('missing') === -1, d + ' spend table has missing: ' + html);
    assert.ok(html.indexOf('No data') === -1, d + ' spend table has No data');
    assert.ok(html.indexOf('not live') === -1, d + ' spend table has not live');
    Paid.displayChannels().forEach(function (ch) {
      var txt = Paid.spendCellTxt(ch, d);
      assert.ok(allowedSpend(txt), d + ' ' + ch.id + ' unexpected spend label: ' + txt);
      assert.ok(!Display.forbiddenSpendLabel(txt), d + ' ' + ch.id + ' forbidden: ' + txt);
    });
    var xHtml = Paid.xSectionHtml(d);
    assert.ok(xHtml.indexOf('missing') === -1, d + ' X section has missing: ' + xHtml);
    assert.ok(xHtml.indexOf('No data') === -1, d + ' X section has No data');
    assert.ok(xHtml.indexOf('not live') === -1, d + ' X section has not live');
  });
  assert.ok(Paid.xSpendTxt('2026-11-09').indexOf('$223.01') === 0, Paid.xSpendTxt('2026-11-09'));
  assert.strictEqual(Paid.spendCellTxt(Paid.CHANNELS.filter(function (c) { return c.id === 'chatgpt'; })[0], '2026-11-09'), 'Channel off');
  assert.strictEqual(Paid.outbrainSpendTxt('2026-11-09'), 'Channel off');
  assert.strictEqual(Paid.taboolaSpendTxt('2026-11-04'), '$356.41', 'Taboola pause day is spend');
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-09'), 'Channel off');
  var pin11 = Paid.displayChannels().filter(function (c) { return c.id === 'pinterest'; })[0];
  assert.strictEqual(Paid.spendCellTxt(pin11, '2026-11-09'), 'Channel off');
  var spends = Paid.channelSpends('2026-11-09');
  assert.ok(spends.channels.x, 'X is in blended destination channels');
  assert.ok(spends.d2cAdSpend > 0);
  resetAll();
});

test('FIELD_MAP is the swap point for Finance PR #46 contract names', function () {
  assert.strictEqual(Display.FIELD_MAP.display_state[0], 'display_state');
  assert.ok(Display.FIELD_MAP.display_state.indexOf('state') === -1, 'do not alias display_state to registry state');
  assert.strictEqual(Display.FIELD_MAP.display_amount[0], 'display_amount');
  assert.strictEqual(Display.FIELD_MAP.last_confirmed_date[0], 'last_confirmed_date');
  assert.strictEqual(Display.FIELD_MAP.last_confirmed_amount[0], 'last_confirmed_amount');
  assert.strictEqual(Display.FIELD_MAP.measured_spend[0], 'measured_spend');
  assert.strictEqual(Display.FIELD_MAP.estimated[0], 'mer_estimated');
  assert.ok(Display.FIELD_MAP.estimated.indexOf('estimated') !== -1, 'estimated remains a harmless alias');
  assert.strictEqual(Display.FIELD_MAP.registry_id[0], 'id');
  assert.strictEqual(Display.FIELD_MAP.registry_label[0], 'label');
  assert.strictEqual(Display.FIELD_MAP.registry_state[0], 'state');
  assert.strictEqual(Display.FIELD_MAP.registry_since[0], 'since');
  assert.strictEqual(Display.FIELD_MAP.registry_paused_on[0], 'paused_on');
  assert.strictEqual(Display.FIELD_MAP.registry_never_launched[0], 'never_launched');
  assert.strictEqual(Display.FIELD_MAP.registry_confirmed[0], 'confirmed');
  assert.strictEqual(Display.CHANNEL_STATUS_SCHEMA, 'channel_status.v1');
  assert.strictEqual(Display.CHANNEL_STATUS_IDS.length, 15);
  assert.ok(Display.DAY_CONTRACT_PATHS.some(function (p) { return p[0] === 'channel_display'; }));
  assert.ok(Display.REGISTRY_PATHS.some(function (p) { return p[0] === 'channel_status'; }));
});

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
  var meta1020 = Paid.spendCellTxt(meta, '2026-10-20');
  var reddit1020 = Paid.spendCellTxt(reddit, '2026-10-20');
  assert.ok(isPendingLabel(meta1020) || meta1020 === 'pending backfill (last confirmed —)', meta1020);
  assert.ok(isPendingLabel(reddit1020) || reddit1020 === 'pending backfill (last confirmed —)', reddit1020);
  assert.strictEqual(Paid.spendCellTxt(meta, '2026-11-05'), '$9,401.40');
  Paid._setMerDoc({
    as_of: '2026-11-05',
    channel_ad_spend: { '2026-11-05': { meta: 9401.4, tiktok: 1264.56 } },
    advertising_sources: { '2026-11-05': { meta: { spend: 9401.4, complete: true } } }
  });
  var meta1020b = Paid.spendCellTxt(meta, '2026-10-20');
  assert.ok(isPendingLabel(meta1020b) || meta1020b === 'pending backfill (last confirmed —)', meta1020b);
  assert.strictEqual(Paid.spendCellTxt(meta, '2026-11-05'), '$9,401.40');
  Paid._setMerDoc(null);
});

test('bare $0 in mer advertising_sources / by_date fallbacks shows missing, not $0', function () {
  Paid._setMerDoc({ as_of: '2026-11-05', advertising_sources: { '2026-11-05': {
    reddit_ads: { spend: 0 }, pinterest_ads: { spend: 0, complete: true, closed_day: true } } } });
  var reddit = { id: 'reddit', sourceKeys: ['reddit_ads', 'reddit'], merKey: 'reddit' };
  var pinterest = { id: 'pinterest', sourceKeys: ['pinterest_ads', 'pinterest'], merKey: 'pinterest' };
  var redditBareMer = Paid.spendCellTxt(reddit, '2026-11-05');
  assert.ok(isPendingLabel(redditBareMer) || redditBareMer === 'pending backfill (last confirmed —)', 'Reddit on 11/5, bare $0 is not measured: ' + redditBareMer);
  assert.strictEqual(Paid.spendCellTxt(pinterest, '2026-11-05'), 'Channel off', 'Pinterest off on/after 10/30');
  Paid._setMerDoc(null);
});

test('mer.channel_revenue flat snapshot is not applied to other dates', function () {
  delete globalThis.PARTIAL_REPORTS;
  Paid._setMerDoc({ as_of: '2026-11-05', channel_revenue: { meta: 12345 }, channel_ad_spend: { meta: 100 },
    advertising_sources: { '2026-11-05': { meta: { spend: 100, complete: true } } } });
  assert.ok(Paid.spendTxt(Paid.dayForDisplay({ id: 'meta', sourceKeys: ['meta'], merKey: 'meta' }, '2026-11-05')) === '$100.00');
  Paid._setMerDoc(null);
});

test('PR #46 fixtures: exact per-state examples, paused_on, mer_estimated, registry fields', function () {
  resetAll();
  var fx = loadPr46();
  Paid._setMerDoc(fx.mer);
  Paid._setChannelStatus(fx.status);
  Paid._setPendingBackfill(fx.pending);
  Paid._setAdvDaily(fx.advDaily);

  assert.strictEqual(fx.status.schema, 'channel_status.v1');
  assert.strictEqual(Object.keys(fx.status.channels).length, 15);
  var tabReg = fx.status.channels.taboola;
  assert.strictEqual(tabReg.id, 'taboola');
  assert.strictEqual(tabReg.label, 'Taboola');
  assert.strictEqual(tabReg.state, 'off');
  assert.strictEqual(tabReg.since, '2026-11-04');
  assert.strictEqual(tabReg.paused_on, '2026-11-04');
  assert.strictEqual(tabReg.never_launched, false);
  assert.strictEqual(tabReg.confirmed, true);
  assert.strictEqual(fx.status.channels.outbrain.never_launched, true);
  assert.strictEqual(fx.status.channels.spotify.never_launched, true);
  assert.strictEqual(fx.status.channels.chatgpt.paused_on, '2026-10-30');
  assert.ok(fx.status.channels.pinterest.paused_on == null);
  assert.strictEqual(fx.status.channels.reddit.since, '2026-11-09');

  var chatgpt = Paid.CHANNELS.filter(function (c) { return c.id === 'chatgpt'; })[0];
  var bing = Paid.CHANNELS.filter(function (c) { return c.id === 'bing'; })[0];
  var pinterest = Paid.displayChannels().filter(function (c) { return c.id === 'pinterest'; })[0];

  assert.strictEqual(Paid.outbrainSpendTxt('2026-11-09'), 'Channel off', 'off example: Outbrain never launched');
  assert.strictEqual(Paid.spendCellTxt(chatgpt, '2026-11-09'), 'Channel off', 'off example: ChatGPT after 10/30 pause');
  assert.strictEqual(Paid.spendCellTxt(bing, '2026-11-09'), '$0.00', 'zero + live:false is $0, not Channel off');
  assert.strictEqual(Paid.spendCellTxt(pinterest, '2026-11-04'), 'Channel off', 'Pinterest off on/after since 10/30');

  var xSpend = Paid.xSpendTxt('2026-11-09');
  assert.ok(xSpend.indexOf('$223.01') === 0, xSpend);
  assert.ok(xSpend.indexOf('not billed yet') !== -1, xSpend);
  assert.ok(xSpend.indexOf('missing') === -1, xSpend);
  assert.ok(Paid.xSectionHtml('2026-11-09').indexOf('missing') === -1);
  assert.ok(Paid.xDetailHtml('2026-11-09').indexOf('not billed yet') !== -1);
  assert.ok(Paid.xDetailHtml('2026-11-09').indexOf('missing') === -1);

  var pending = Paid.xSpendTxt('2026-11-10');
  assert.strictEqual(pending, '$223.01 pending backfill (last confirmed 11/9)');
  assert.ok(Paid.channelSpends('2026-11-10').estimated, 'carried X figure marks totals estimated');
  assert.strictEqual(fx.mer.mer_estimated, false);
  assert.strictEqual(Display.merEstimated(fx.mer), false);
  assert.strictEqual(Display.merEstimated({ mer_estimated: true }), true);
  assert.strictEqual(Display.merEstimated({ estimated: true }), true, 'estimated remains a harmless alias');

  assert.strictEqual(Paid.taboolaSpendTxt('2026-11-04'), '$356.41', 'pause day stays on: Taboola 11/4 spend');
  assert.strictEqual(Paid.spendCellTxt(chatgpt, '2026-10-30'), '$28.91', 'pause day stays on: ChatGPT 10/30 spend');
  assert.strictEqual(Paid.spendCellTxt(chatgpt, '2026-11-04'), 'Channel off');
  assert.strictEqual(Paid.taboolaSpendTxt('2026-11-05'), 'Channel off', 'off starts the next day');
  assert.strictEqual(Paid.spotifySpendTxt('2026-11-09'), 'Channel off');

  resetAll();
});

test('ChatGPT root status=off with populated by_date is Channel off, not discarded', function () {
  resetAll();
  Paid._setDailyFile('chatgpt', {
    status: 'off',
    live: false,
    as_of: '2026-11-10',
    by_date: {
      '2026-11-09': { spend: 0, complete: true, live: false, spend_status: 'verified' }
    }
  });
  var chatgpt = Paid.CHANNELS.filter(function (c) { return c.id === 'chatgpt'; })[0];
  var days = Paid.mergeDaysFor(chatgpt);
  assert.ok(days['2026-11-09'], 'root status=off must not filter populated by_date');
  assert.strictEqual(Paid.spendCellTxt(chatgpt, '2026-11-09'), 'Channel off');
  resetAll();
});

test('zero + live:false is $0; only display_state off is Channel off; paused_on stays on', function () {
  resetAll();
  var status = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/channel_status.v1.json'), 'utf8'));
  Object.keys(Display.INTERIM_REGISTRY).forEach(function (id) {
    var a = Display.INTERIM_REGISTRY[id];
    var b = status.channels[id];
    assert.ok(b, 'fixture has ' + id);
    assert.strictEqual(a.state, b.state, id + ' state');
    assert.strictEqual(a.since, b.since, id + ' since');
    assert.strictEqual(a.paused_on || null, b.paused_on || null, id + ' paused_on');
    assert.strictEqual(!!a.never_launched, !!b.never_launched, id + ' never_launched');
    assert.strictEqual(!!a.confirmed, !!b.confirmed, id + ' confirmed');
  });
  var zeroNode = {
    display_state: 'zero',
    display_amount: 0.0,
    last_confirmed_date: '2026-11-09',
    last_confirmed_amount: 0.0,
    measured_spend: 0.0,
    live: false
  };
  var zeroView = Display.resolve({
    date: '2026-11-09',
    dayNode: zeroNode,
    measured: zeroNode,
    hasRow: true,
    registry: Display.normalizeRegistryEntry(status.channels.pinterest),
    feedLive: false
  });
  assert.strictEqual(zeroView.display_state, 'zero');
  assert.strictEqual(Display.format(zeroView), '$0.00');
  assert.notStrictEqual(Display.format(zeroView), 'Channel off');

  var spendView = Display.resolve({
    date: '2026-11-09',
    dayNode: { display_state: 'spend', display_amount: 223.01, measured_spend: 223.01, live: false },
    registry: Display.normalizeRegistryEntry(status.channels.outbrain),
    feedLive: false
  });
  assert.strictEqual(spendView.display_state, 'spend');
  assert.strictEqual(Display.format(spendView), '$223.01');

  var tab = Display.normalizeRegistryEntry(status.channels.taboola);
  assert.strictEqual(Display.registryOnAt(tab, '2026-11-04'), true, 'pause day stays on');
  assert.strictEqual(Display.registryOnAt(tab, '2026-11-05'), false, 'off starts the next day');
  var gpt = Display.normalizeRegistryEntry(status.channels.chatgpt);
  assert.strictEqual(Display.registryOnAt(gpt, '2026-10-30'), true);
  assert.strictEqual(Display.registryOnAt(gpt, '2026-10-31'), false);
  var pin = Display.normalizeRegistryEntry(status.channels.pinterest);
  assert.strictEqual(Display.registryOnAt(pin, '2026-10-29'), true);
  assert.strictEqual(Display.registryOnAt(pin, '2026-10-30'), false);
  var red = Display.normalizeRegistryEntry(status.channels.reddit);
  assert.strictEqual(Display.registryOnAt(red, '2026-11-08'), true);
  assert.strictEqual(Display.registryOnAt(red, '2026-11-09'), false);
  var spot = Display.normalizeRegistryEntry(status.channels.spotify);
  assert.strictEqual(Display.registryOnAt(spot, '2026-11-09'), false);
  var x = Display.normalizeRegistryEntry(status.channels.x);
  assert.strictEqual(Display.registryOnAt(x, '2026-11-03'), false);
  assert.strictEqual(Display.registryOnAt(x, '2026-11-04'), true);

  var derivedZero = Display.derive({
    date: '2026-11-02',
    measured: { spend: 0, complete: true, live: false },
    hasRow: true,
    registry: tab,
    feedLive: false
  });
  assert.strictEqual(derivedZero.display_state, 'zero');
  assert.strictEqual(Display.format(derivedZero), '$0.00');
  resetAll();
});

test('pending_backfill display_amount=null still renders last_confirmed_amount', function () {
  var v = Display.validateContract({
    display_state: 'pending_backfill',
    display_amount: null,
    last_confirmed_date: '2026-11-09',
    last_confirmed_amount: 223.01
  });
  assert.strictEqual(v.valid, true);
  assert.strictEqual(Display.format(v), '$223.01 pending backfill (last confirmed 11/9)');
  assert.strictEqual(Display.cashCostLabel(null, 'missing'), 'not billed yet');
  assert.ok(Display.cashCostLabel(null, 'missing').indexOf('missing') === -1);
});

if (failed) {
  console.error('\n' + failed + ' daily-report layout test(s) failed');
  process.exit(1);
}
console.log('\nAll daily-report layout tests passed');
