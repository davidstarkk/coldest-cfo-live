#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var P = require('./lib/protected_days');

var ROOT = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var mer = JSON.parse(fs.readFileSync(path.join(ROOT, 'mer_for_manus.json'), 'utf8'));
var partials = P.extractPartials(html);
if (!partials) throw new Error('PARTIAL_REPORTS missing');
var snap = P.buildSnapshot(partials, mer);
snap.source = 'live coldest-cfo-live main (built locally; data-repo PR #21 snapshot.json was 404)';
snap.gaps = [
  'data-repo PR #21 protected_days/snapshot.json is unreadable from this token (404)',
  'live mer_for_manus.json as_of is ' + (snap.mer_as_of || 'missing') + ' — not 2026-10-26',
  'live PARTIAL_REPORTS ends ' + (snap.protected_range[1] || 'unknown') + ' — no 2026-10-26 row',
  '2026-10-09 and 2026-10-10 Shopify are zero_assumed in live data — backfill dollars were not invented'
];
var destDir = path.join(ROOT, 'protected_days');
if (!fs.existsSync(destDir)) fs.mkdirSync(destDir);
fs.writeFileSync(path.join(destDir, 'snapshot.json'), JSON.stringify(snap, null, 2) + '\n');
fs.copyFileSync(path.join(ROOT, 'mer_for_manus.json'), path.join(destDir, 'mer_for_manus.json'));
console.log('wrote protected_days/snapshot.json', snap.protected_range, 'mer', snap.mer_as_of, 'days', Object.keys(snap.days).length);
