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
snap.source = 'rebuilt from live PARTIAL_REPORTS + mer_for_manus.json (data-repo master 10d81d2 already mirrored)';
snap.gaps = [];
var destDir = path.join(ROOT, 'protected_days');
if (!fs.existsSync(destDir)) fs.mkdirSync(destDir);
fs.writeFileSync(path.join(destDir, 'snapshot.json'), JSON.stringify(snap, null, 2) + '\n');
fs.copyFileSync(path.join(ROOT, 'mer_for_manus.json'), path.join(destDir, 'mer_for_manus.json'));
console.log('wrote protected_days/snapshot.json', snap.protected_range, 'mer', snap.mer_as_of, 'days', Object.keys(snap.days).length);
