'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var N = require('../nav_cleanup_module.js');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) { failed += 1; console.error('FAIL - ' + name); console.error('     ' + (e && e.stack ? e.stack : e)); }
}

test('hides exactly the tabs David listed on 11/03', function () {
  assert.deepStrictEqual(N.HIDDEN.slice().sort(), [
    'analytics', 'bing_ads', 'chatgpt_ads', 'cmasm', 'google_ads', 'meta_ads', 'news',
    'pinterest_ads', 'predictive', 'reddit_ads', 'scaling', 'snapchat_ads'
  ]);
  assert.strictEqual(N.FALLBACK, 'reports');
});

test('never hides the tabs that stay', function () {
  ['reports', 'throttles', 'ad_channels', 'cashflow', 'ltv', 'monthly_pnl', 'ytd_pnl', 'secondary_ads', 'subscriptions'].forEach(function (k) {
    assert.strictEqual(N.HIDDEN.indexOf(k), -1, k + ' must stay visible');
  });
});

test('CSS targets each hidden key by data-tab and nothing else', function () {
  var css = N.css(N.HIDDEN);
  N.HIDDEN.forEach(function (k) { assert.ok(css.indexOf('.tab[data-tab="' + k + '"]') !== -1, k); });
  assert.strictEqual((css.match(/data-tab=/g) || []).length, N.HIDDEN.length);
  assert.ok(/display:none !important/.test(css));
});

test('hidden ad tab keys match the paid channels module tab keys', function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'paid_channels_module.js'), 'utf8');
  var keys = [];
  src.replace(/tabKey: '([a-z_]+)'/g, function (_, k) { keys.push(k); return _; });
  assert.ok(keys.length >= 7, 'found paid channel tab keys');
  keys.forEach(function (k) { assert.ok(N.HIDDEN.indexOf(k) !== -1, k + ' is hidden'); });
});

test('index.html loads the module once, after report_quality_module.js', function () {
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var tags = html.match(/<script src="nav_cleanup_module.js"><\/script>/g) || [];
  assert.strictEqual(tags.length, 1);
  assert.ok(html.indexOf('report_quality_module.js') < html.indexOf('nav_cleanup_module.js'));
});

if (failed) { console.error('\n' + failed + ' nav cleanup test(s) failed'); process.exit(1); }
console.log('\nAll nav cleanup tests passed');
