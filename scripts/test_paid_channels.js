'use strict';

var assert = require('assert');
var Paid = require('../paid_channels_module.js');
var BingAds = require('../bing_ads_module.js');

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function samplePartial() {
  return {
    date: '2026-10-24',
    advertising_sources: {
      meta: { spend: '11521.87', complete: true },
      applovin: { spend: 0, complete: true },
      google_ads: { spend: '1951.18', complete: true, closed_day: true },
      tiktok_ads: { spend: '5116.47', complete: false }
    },
    channel_observations: {
      shopify: { revenue: 26598.51, orders: 331, known_ads: 14381.81 }
    },
    provisional_totals: {
      revenue: 48795.5,
      ads: 21601.53,
      net_profit: -3689.89,
      mer: 2.25889,
      net_margin_pct: -7.56
    }
  };
}

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) {
    failed += 1;
    console.error('FAIL - ' + name);
    console.error('     ' + (e && e.stack ? e.stack : e));
  }
}

test('six-channel total is Meta + Google when others have no feed', function () {
  var p = samplePartial();
  global.PARTIAL_REPORTS = [p];
  Paid._setMerDoc({ as_of: '2026-09-27' });
  Paid.CHANNELS.forEach(function (ch) { Paid.setFeeds(ch.id, null, { as_of: '2026-09-27' }, null); });
  Paid.CHANNELS.forEach(function (ch) { Paid.applyChannel(ch, Paid.mergeDaysFor(ch)); });
  var s = Paid.channelSpends('2026-10-24');
  assert.strictEqual(s.channels.meta.spend, 11521.87);
  assert.strictEqual(s.channels.google.spend, 1951.18);
  assert.strictEqual(s.channels.bing.spend, 0);
  assert.strictEqual(s.channels.reddit.spend, 0);
  assert.strictEqual(s.channels.snapchat.spend, 0);
  assert.strictEqual(s.channels.chatgpt.spend, 0);
  assert.strictEqual(s.totalAdSpend, 13473.05);
  assert.strictEqual(s.shopifyD2C, 26598.51);
  assert.ok(Math.abs(s.blendedMer - (26598.51 / 13473.05)) < 0.0001);
  delete global.PARTIAL_REPORTS;
});

test('$0 new channels leave provisional_totals.ads unchanged', function () {
  var p = samplePartial();
  var before = clone(p.provisional_totals);
  global.PARTIAL_REPORTS = [p];
  Paid.CHANNELS.forEach(function (ch) { Paid.setFeeds(ch.id, null, {}, null); });
  Paid.CHANNELS.forEach(function (ch) { Paid.applyChannel(ch, Paid.mergeDaysFor(ch)); });
  assert.strictEqual(p.provisional_totals.ads, before.ads);
  assert.strictEqual(p.provisional_totals.net_profit, before.net_profit);
  assert.strictEqual(p.advertising_sources.google_ads.spend, '1951.18');
  assert.strictEqual(p.advertising_sources.meta.spend, '11521.87');
  assert.ok(p.advertising_sources.reddit);
  assert.ok(p.advertising_sources.snapchat);
  assert.ok(p.advertising_sources.chatgpt);
  assert.ok(p.advertising_sources.bing);
  delete global.PARTIAL_REPORTS;
});

test('mer_for_manus reddit/snapchat/chatgpt blocks are consumed', function () {
  var mer = {
    reddit: { as_of: '2026-10-24', spend: 40, clicks: 10, conversions: 1, revenue: 90 },
    snapchat: { as_of: '2026-10-24', spend: 25, clicks: 4, conversions: 0, revenue: 0 },
    chatgpt: { as_of: '2026-10-24', spend: 15, clicks: 2, conversions: 1, revenue: 50 }
  };
  Paid._setMerDoc(mer);
  ['reddit', 'snapchat', 'chatgpt'].forEach(function (id) {
    Paid.setFeeds(id, null, mer, null);
  });
  var r = Paid.snapshotFromBlock(mer.reddit, 'mer');
  assert.strictEqual(r.spend, 40);
  assert.strictEqual(r.clicks, 10);
  var s = Paid.latestDayFor(Paid.CHANNELS.filter(function (c) { return c.id === 'snapchat'; })[0]);
  assert.strictEqual(s.spend, 25);
  var c = Paid.latestDayFor(Paid.CHANNELS.filter(function (c) { return c.id === 'chatgpt'; })[0]);
  assert.strictEqual(c.spend, 15);
  assert.ok(Math.abs(c.roas - (50 / 15)) < 0.001);
});

test('feed Reddit not in pipeline is added once; Meta/Google are not double-counted', function () {
  var p = samplePartial();
  var before = clone(p.provisional_totals);
  global.PARTIAL_REPORTS = [p];
  var reddit = Paid.CHANNELS.filter(function (c) { return c.id === 'reddit'; })[0];
  Paid.setFeeds('reddit', null, { reddit: { as_of: '2026-10-24', spend: 80 } }, null);
  Paid.applyChannel(reddit, Paid.mergeDaysFor(reddit));
  assert.strictEqual(p.provisional_totals.ads, before.ads + 80);
  assert.strictEqual(p.provisional_totals.net_profit, before.net_profit - 80);
  var google = Paid.CHANNELS.filter(function (c) { return c.id === 'google'; })[0];
  Paid.applyChannel(google, Paid.mergeDaysFor(google));
  assert.strictEqual(p.provisional_totals.ads, before.ads + 80);
  delete global.PARTIAL_REPORTS;
});

test('pipeline reddit is not double-counted', function () {
  var p = samplePartial();
  p.advertising_sources.reddit = { spend: '80.00', complete: true };
  var before = clone(p.provisional_totals);
  global.PARTIAL_REPORTS = [p];
  var reddit = Paid.CHANNELS.filter(function (c) { return c.id === 'reddit'; })[0];
  Paid.setFeeds('reddit', null, { reddit: { as_of: '2026-10-24', spend: 80 } }, null);
  Paid.applyChannel(reddit, Paid.mergeDaysFor(reddit));
  assert.strictEqual(p.provisional_totals.ads, before.ads);
  delete global.PARTIAL_REPORTS;
});

test('Bing wrapper still works through PaidChannels', function () {
  BingAds._setFeeds({ status: 'pre_launch', daily: [] }, { as_of: '2026-09-27' }, null);
  var day = BingAds.latestDay(BingAds.mergeDays());
  assert.strictEqual(day.spend, 0);
  assert.strictEqual(BingAds.pickSourceNode({ reddit: { spend: 1 } }), null);
  assert.ok(BingAds.pickSourceNode({ bing: { spend: 2 } }));
});

test('missing feed is $0 / no feed — no invented spend', function () {
  Paid._setMerDoc(null);
  Paid.setFeeds('snapchat', null, null, null);
  var ch = Paid.CHANNELS.filter(function (c) { return c.id === 'snapchat'; })[0];
  var day = Paid.latestDayFor(ch, {});
  assert.strictEqual(day.spend, 0);
  assert.ok(day.source === 'no feed' || day.hasFeed === false || day.spend === 0);
});

function dailyInputsContract() {
  return {
    as_of: '2026-10-24',
    source: 'daily_inputs',
    d2c_ad_spend: 14382.78,
    blended_mer: 1.84,
    total_ad_spend: 21678.86,
    bing: { as_of: '2026-10-24', spend: 77.33, d2c: 0.97, amazon: 76.36, tracking_verified: true, campaign: 'bing to amz tumbler listing 1' },
    reddit: { as_of: '2026-10-24', spend: 0, tracking_verified: false },
    snapchat: { as_of: '2026-10-24', spend: 0, tracking_verified: false },
    chatgpt: { as_of: '2026-10-24', spend: 0, tracking_verified: false },
    non_d2c: {
      whatnot: 0,
      applovin: 0,
      tiktok_shop: 3409.28,
      sellerboard_amazon: 3012.01,
      unallocated: 798.43
    }
  };
}

test('2026-10-24 mer_for_manus daily_inputs keys render published totals', function () {
  var mer = dailyInputsContract();
  var p = samplePartial();
  p.advertising_sources.tiktok_ads = {
    spend: '5116.47',
    complete: false,
    shopify_spend: '908.76',
    shop_spend: '3409.28',
    unallocated_spend: '798.43'
  };
  global.PARTIAL_REPORTS = [p];
  Paid._setMerDoc(mer);
  Paid.CHANNELS.forEach(function (ch) { Paid.setFeeds(ch.id, null, mer, null); });
  Paid.CHANNELS.forEach(function (ch) { Paid.applyChannel(ch, Paid.mergeDaysFor(ch)); });
  var s = Paid.channelSpends('2026-10-24');
  assert.strictEqual(s.d2cAdSpend, 14382.78);
  assert.strictEqual(s.blendedMer, 1.84);
  assert.strictEqual(s.totalAdSpend, 21678.86);
  assert.strictEqual(s.channels.bing.spend, 77.33);
  assert.strictEqual(s.channels.bing.d2c, 0.97);
  assert.strictEqual(s.channels.bing.amazon, 76.36);
  assert.strictEqual(s.allAdSpend, 21678.86);
  assert.strictEqual(s.channels.bing.campaign, 'bing to amz tumbler listing 1');
  var dest = s.destination;
  assert.ok(dest.d2c.some(function (l) { return l.key === 'tiktok_shopify' && l.spend === 908.76; }));
  assert.ok(dest.amazon.some(function (l) { return l.key === 'bing_amazon' && l.spend === 76.36; }));
  assert.ok(dest.amazon.some(function (l) { return l.key === 'sellerboard_amazon' && l.spend === 3012.01; }));
  assert.ok(dest.other.some(function (l) { return l.key === 'whatnot' && l.spend === 0; }));
  assert.ok(dest.other.some(function (l) { return l.key === 'applovin'; }));
  assert.ok(dest.other.some(function (l) { return l.key === 'tiktok_shop' && l.spend === 3409.28; }));
  assert.strictEqual(s.channels.reddit.spend, 0);
  assert.strictEqual(s.channels.reddit.tracking_verified, false);
  assert.strictEqual(s.channels.snapchat.tracking_verified, false);
  assert.strictEqual(s.channels.chatgpt.tracking_verified, false);
  var labels = s.nonD2c.filter(function (n) { return n.present; }).map(function (n) { return n.key + ':' + n.spend; });
  assert.ok(labels.indexOf('whatnot:0') !== -1);
  assert.ok(labels.indexOf('applovin:0') !== -1);
  assert.ok(labels.indexOf('tiktok_shop:3409.28') !== -1);
  assert.ok(labels.indexOf('sellerboard_amazon:3012.01') !== -1);
  assert.ok(labels.indexOf('unallocated:798.43') !== -1);
  assert.strictEqual(s.contract.source, 'daily_inputs');
  delete global.PARTIAL_REPORTS;
  Paid._setMerDoc(null);
});

test('bing.d2c + bing.amazon split matches spend when spend omitted', function () {
  var split = Paid.bingSplit({ d2c: 0.97, amazon: 76.36 });
  assert.strictEqual(split.spend, 77.33);
  assert.strictEqual(split.d2c, 0.97);
  assert.strictEqual(split.amazon, 76.36);
  var aliased = Paid.destinationSplit({ spend: 77.33, spend_d2c: 0.97, spend_amazon: 76.36, destination: 'mixed' });
  assert.strictEqual(aliased.d2c, 0.97);
  assert.strictEqual(aliased.amazon, 76.36);
  var nested = Paid.bingSplit({ spend: 77.33, d2c: { spend: 0.97 }, amazon: { spend: 76.36 } });
  assert.strictEqual(nested.spend, 77.33);
  assert.strictEqual(nested.d2c, 0.97);
  assert.strictEqual(nested.amazon, 76.36);
});

test('destination:amazon is excluded from D2C and included in All ad spend', function () {
  var split = Paid.destinationSplit({ spend: 77.33, destination: 'amazon' });
  assert.strictEqual(split.d2c, 0);
  assert.strictEqual(split.amazon, 77.33);
  var other = Paid.destinationSplit({ spend: 40, destination: 'other' });
  assert.strictEqual(other.d2c, 0);
  assert.strictEqual(other.other, 40);
});

test('TikTok Shopify share is D2C; shop/unallocated/amazon are not', function () {
  var p = samplePartial();
  p.advertising_sources.tiktok_ads = {
    spend: '5116.47',
    shopify_spend: '908.76',
    shop_spend: '3409.28',
    unallocated_spend: '798.43'
  };
  global.PARTIAL_REPORTS = [p];
  Paid._setMerDoc(null);
  Paid.CHANNELS.forEach(function (ch) { Paid.setFeeds(ch.id, null, null, null); });
  var bing = Paid.CHANNELS.filter(function (c) { return c.id === 'bing'; })[0];
  Paid.setFeeds('bing', null, { bing: { as_of: '2026-10-24', spend: 77.33, d2c: 0.97, amazon: 76.36 } }, null);
  Paid.applyChannel(bing, Paid.mergeDaysFor(bing));
  var s = Paid.channelSpends('2026-10-24');
  assert.strictEqual(s.d2cAdSpend, 14382.78);
  assert.ok(s.destination.d2c.some(function (l) { return l.key === 'tiktok_shopify' && l.spend === 908.76; }));
  assert.ok(s.destination.other.some(function (l) { return l.key === 'tiktok_shop' && l.spend === 3409.28; }));
  assert.ok(s.destination.other.some(function (l) { return l.key === 'unallocated' && l.spend === 798.43; }));
  assert.ok(s.destination.amazon.some(function (l) { return l.key === 'bing_amazon' && l.spend === 76.36; }));
  assert.ok(Math.abs(s.d2cAdSpend - (11521.87 + 1951.18 + 0.97 + 908.76)) < 0.001);
  assert.ok(s.allAdSpend > s.d2cAdSpend);
  assert.ok(Math.abs(s.allAdSpend - (s.d2cAdSpend + 76.36 + 3409.28 + 798.43)) < 0.02);
  assert.ok(Math.abs(s.blendedMer - (26598.51 / 14382.78)) < 0.0001);
  delete global.PARTIAL_REPORTS;
  Paid._setMerDoc(null);
});

test('unpublished Bing from mer_for_manus overlays company ads once', function () {
  var p = samplePartial();
  var before = clone(p.provisional_totals);
  global.PARTIAL_REPORTS = [p];
  var mer = dailyInputsContract();
  Paid._setMerDoc(mer);
  var bing = Paid.CHANNELS.filter(function (c) { return c.id === 'bing'; })[0];
  Paid.setFeeds('bing', null, mer, null);
  Paid.applyChannel(bing, Paid.mergeDaysFor(bing));
  assert.strictEqual(p.provisional_totals.ads, round2(before.ads + 77.33));
  Paid.applyChannel(bing, Paid.mergeDaysFor(bing));
  assert.strictEqual(p.provisional_totals.ads, round2(before.ads + 77.33));
  delete global.PARTIAL_REPORTS;
  Paid._setMerDoc(null);
});

test('chatgpt tracking_verified:false shows tracking not verified, spend still counts', function () {
  var mer = {
    as_of: '2026-10-24',
    chatgpt: { as_of: '2026-10-24', spend: 40, clicks: 8, conversions: 0, revenue: 0, roas: 0, tracking_verified: false }
  };
  var p = samplePartial();
  var before = clone(p.provisional_totals);
  global.PARTIAL_REPORTS = [p];
  Paid._setMerDoc(mer);
  var ch = Paid.CHANNELS.filter(function (c) { return c.id === 'chatgpt'; })[0];
  Paid.setFeeds('chatgpt', null, mer, null);
  Paid.applyChannel(ch, Paid.mergeDaysFor(ch));
  var day = Paid.latestDayFor(ch);
  assert.strictEqual(day.spend, 40);
  assert.strictEqual(day.tracking_verified, false);
  assert.strictEqual(Paid.outcomeTxt(day, 'conversions', ch), 'tracking not verified');
  assert.strictEqual(Paid.outcomeTxt(day, 'revenue', ch), 'tracking not verified');
  assert.strictEqual(Paid.outcomeTxt(day, 'roas', ch), 'tracking not verified');
  var s = Paid.channelSpends('2026-10-24');
  assert.strictEqual(s.channels.chatgpt.spend, 40);
  assert.strictEqual(p.provisional_totals.ads, round2(before.ads + 40));
  var reddit = Paid.CHANNELS.filter(function (c) { return c.id === 'reddit'; })[0];
  var rDay = Paid.nodeToDay('2026-10-24', { spend: 0, conversions: 0, tracking_verified: false }, 'mer');
  assert.notStrictEqual(Paid.outcomeTxt(rDay, 'conversions', reddit), 'tracking not verified');
  delete global.PARTIAL_REPORTS;
  Paid._setMerDoc(null);
});

test('chatgpt tracking_verified omitted still shows published zeros', function () {
  var ch = Paid.CHANNELS.filter(function (c) { return c.id === 'chatgpt'; })[0];
  var mer = { chatgpt: { as_of: '2026-10-24', spend: 10, conversions: 0, revenue: 0 } };
  Paid._setMerDoc(mer);
  Paid.setFeeds('chatgpt', null, mer, null);
  var day = Paid.nodeToDay('2026-10-24', { spend: 10, conversions: 0, revenue: 0 }, 'mer');
  assert.strictEqual(day.tracking_verified, undefined);
  assert.strictEqual(Paid.outcomeTxt(day, 'conversions', ch), '0');
  assert.strictEqual(Paid.outcomeTxt(day, 'revenue', ch), '$0.00');
  Paid.setFeeds('chatgpt', null, null, null);
  Paid._setMerDoc(null);
});

function round2(v) { return Math.round(Number(v) * 100) / 100; }

if (failed) {
  console.error('\n' + failed + ' paid-channel test(s) failed');
  process.exit(1);
}
console.log('\nAll paid-channel tests passed');
