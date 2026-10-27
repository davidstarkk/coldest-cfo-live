#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var P = require('./lib/protected_days');

var ROOT = path.join(__dirname, '..');
var SRC_SNAP = process.argv[2] || path.join('/home/ubuntu/.cursor/projects/workspace/uploads/snapshot_fd54.json');
var SRC_MER = process.argv[3] || path.join('/home/ubuntu/.cursor/projects/workspace/uploads/mer_for_manus_adbb.json');

function applyBackfillDay(row, snapDay) {
  row = JSON.parse(JSON.stringify(row));
  row.channel_observations = row.channel_observations || {};
  var snapObs = (snapDay && snapDay.channel_observations) || {};
  var restored = [];
  P.REVENUE_CHANNELS.forEach(function (id) {
    var src = snapObs[id];
    if (!src || src.data_available === false || src.zero_assumed === true) return;
    if (!Number.isFinite(Number(src.revenue)) && src.revenue !== 0) return;
    row.channel_observations[id] = JSON.parse(JSON.stringify(src));
    restored.push(id);
  });
  var rev = P.revenueMapFromSnap(snapDay);
  if (Object.keys(rev).length) {
    row.channel_revenue = Object.assign({}, row.channel_revenue || {}, rev);
  }
  if (Array.isArray(row.zero_assumptions) && restored.length) {
    row.zero_assumptions = row.zero_assumptions.filter(function (line) {
      var lower = String(line).toLowerCase();
      return restored.every(function (id) { return lower.indexOf(id) === -1; });
    });
  }
  if (snapDay.backfill) row.calculation_basis = 'shopify_backfill';
  return row;
}

function main() {
  var srcSnap = JSON.parse(fs.readFileSync(SRC_SNAP, 'utf8'));
  var srcMer = JSON.parse(fs.readFileSync(SRC_MER, 'utf8'));
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var partials = P.extractPartials(html);
  if (!partials) throw new Error('PARTIAL_REPORTS missing');

  var byDate = {};
  partials.forEach(function (row) { if (row && row.date) byDate[row.date] = row; });

  ['2026-10-09', '2026-10-10'].forEach(function (date) {
    if (!byDate[date]) throw new Error('missing live PARTIAL row ' + date);
    if (!srcSnap.days[date]) throw new Error('missing snapshot day ' + date);
    byDate[date] = applyBackfillDay(byDate[date], srcSnap.days[date]);
  });

  if (!byDate['2026-10-26']) {
    if (!srcSnap.days['2026-10-26']) throw new Error('missing snapshot day 2026-10-26');
    byDate['2026-10-26'] = P.rowFromSnapDay(srcSnap.days['2026-10-26']);
    byDate['2026-10-26'].calculation_basis = 'mer_as_of';
    if (srcMer.computed_at) byDate['2026-10-26'].updated_at = srcMer.computed_at;
  }

  var dates = Object.keys(byDate).sort();
  var rows = dates.map(function (d) { return byDate[d]; });
  var nextHtml = P.writePartials(html, rows);
  if (nextHtml === html) throw new Error('PARTIAL_REPORTS write did not change');
  if (nextHtml.replace(/const PARTIAL_REPORTS = \[[\s\S]*?\];\s*\n/, '') !== html.replace(/const PARTIAL_REPORTS = \[[\s\S]*?\];\s*\n/, '')) {
    throw new Error('layout HTML changed');
  }

  var destDir = path.join(ROOT, 'protected_days');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir);
  var liveSnap = JSON.parse(JSON.stringify(srcSnap));
  liveSnap.protected_range = srcSnap.protected_dates && srcSnap.protected_dates.length
    ? [srcSnap.protected_dates[0], srcSnap.protected_dates[srcSnap.protected_dates.length - 1]]
    : ['2026-09-28', '2026-10-26'];
  liveSnap.shopify_backfill_dates = (srcSnap.backfill_days || P.SHOPIFY_BACKFILL_DATES).slice();
  liveSnap.source = 'data-repo master 10d81d2 protected_days/snapshot.json + mer_for_manus.json';
  liveSnap.gaps = [];
  liveSnap.mer = {
    as_of: srcMer.as_of || null,
    shop_revenue: srcMer.shop_revenue,
    d2c_ad_spend: srcMer.d2c_ad_spend,
    blended_mer: srcMer.blended_mer,
    mer_7d_pooled: srcMer.mer_7d_pooled,
    mer_30d_pooled: srcMer.mer_30d_pooled,
    total_ad_spend: srcMer.total_ad_spend
  };

  fs.writeFileSync(path.join(ROOT, 'index.html'), nextHtml);
  fs.writeFileSync(path.join(ROOT, 'mer_for_manus.json'), JSON.stringify(srcMer, null, 2) + '\n');
  fs.writeFileSync(path.join(destDir, 'mer_for_manus.json'), JSON.stringify(srcMer, null, 2) + '\n');
  fs.writeFileSync(path.join(destDir, 'snapshot.json'), JSON.stringify(liveSnap, null, 2) + '\n');

  var verify = P.extractPartials(nextHtml);
  var d9 = verify.filter(function (r) { return r.date === '2026-10-09'; })[0];
  var d10 = verify.filter(function (r) { return r.date === '2026-10-10'; })[0];
  var d26 = verify.filter(function (r) { return r.date === '2026-10-26'; })[0];
  if (!d9 || d9.channel_observations.shopify.zero_assumed || d9.channel_observations.shopify.revenue !== 26289.5) {
    throw new Error('10/9 Shopify backfill failed');
  }
  if (!d10 || d10.channel_observations.shopify.zero_assumed || d10.channel_observations.shopify.revenue !== 16958.06) {
    throw new Error('10/10 Shopify backfill failed');
  }
  if (!d26) throw new Error('10/26 row missing');
  console.log('applied data-repo snapshot', liveSnap.protected_range, 'mer', srcMer.as_of, 'partials', verify.length);
}

main();
