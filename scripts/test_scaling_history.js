'use strict';
// SCALE HISTORY tab: the module is the data repo's scaling_history_module.js, unchanged.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var SH = require('../scaling_history_module.js');

var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert.strictEqual((html.match(/<script src="scaling_history_module.js"><\/script>/g) || []).length, 1, 'one script tag');
assert.ok(html.indexOf('scaling_history_module.js') < html.indexOf('subscriptions_module.js'), 'subscriptions stays last');

var nav = fs.readFileSync(path.join(ROOT, 'nav_cleanup_module.js'), 'utf8');
assert.ok(nav.indexOf('scale_history') === -1, 'tab is not hidden by nav cleanup');

var feed = JSON.parse(fs.readFileSync(path.join(ROOT, 'growth', 'scaling_history.json'), 'utf8'));
assert.strictEqual(feed.schema, 'scaling_history.v1');
assert.ok(feed.weeks.length > 50 && feed.months.length > 12);
feed.weeks.forEach(function (w) {
  assert.strictEqual(w.days, 7, 'only complete weeks');
  assert.strictEqual(w.profit, undefined, 'feed holds measured sums, no profit');
});

// 40000 revenue, 100 orders, 10000 spend a day at 20% cost, $5 an order, 3% fees
var p = SH.perDay({ w: '2026-01-05', y: 2026, n: 2, days: 7, rev: 280000, net: 280000, orders: 700,
  spend: 70000, pv: 140000, ads: 700, ads50: 350, new_net: 0, new_orders: 0, new_ad_spend: 0, top5_spend: 0 },
  { cogs_pct: 20, ship_per_order: 5, fee_pct: 3 });
assert.strictEqual(Math.round(p.profit), 20300);
assert.strictEqual(SH.perDay({ days: 7, rev: 7, net: 7, orders: 1, spend: 0, pv: 0, ads: 0, ads50: 0 }, {}).mer, null, 'no spend is no ratio, not 0x');

var S = SH.summary(feed, feed.assumptions);
assert.ok(S.bands.length >= 3 && S.best && S.breakevenMer > 1);
console.log('scaling_history: ok');
