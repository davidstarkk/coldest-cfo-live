#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var P = require('./lib/protected_days');

var ROOT = path.join(__dirname, '..');
var APPLY = process.argv.indexOf('--apply') !== -1;
var SNAP_PATH = path.join(ROOT, 'protected_days', 'snapshot.json');
var MER_SNAP_PATH = path.join(ROOT, 'protected_days', 'mer_for_manus.json');
var MER_LIVE_PATH = path.join(ROOT, 'mer_for_manus.json');
var INDEX_PATH = path.join(ROOT, 'index.html');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  if (!fs.existsSync(SNAP_PATH)) {
    console.error('missing ' + SNAP_PATH);
    process.exit(2);
  }
  var snapshot = readJson(SNAP_PATH);
  var snapMer = fs.existsSync(MER_SNAP_PATH) ? readJson(MER_SNAP_PATH) : null;
  var liveMer = fs.existsSync(MER_LIVE_PATH) ? readJson(MER_LIVE_PATH) : null;
  var html = fs.readFileSync(INDEX_PATH, 'utf8');
  var partials = P.extractPartials(html);
  if (!partials) {
    console.error('could not parse PARTIAL_REPORTS from index.html');
    process.exit(2);
  }
  var out = P.restore({ snapshot: snapshot, snapshotMer: snapMer, mer: liveMer, partials: partials });
  if (!out.changed) {
    console.log('protected days ok — no restore needed');
    process.exit(0);
  }
  console.log('restore needed', JSON.stringify({
    partialsChanged: out.partialsChanged,
    merChanged: out.merChanged,
    asOfRestored: out.asOfRestored,
    mer_as_of: P.merAsOf(out.mer),
    days: out.partials.length
  }));
  if (!APPLY) {
    console.log('dry-run (pass --apply to write)');
    process.exit(1);
  }
  if (out.partialsChanged) fs.writeFileSync(INDEX_PATH, P.writePartials(html, out.partials));
  if (out.merChanged && out.mer) fs.writeFileSync(MER_LIVE_PATH, JSON.stringify(out.mer, null, 2) + '\n');
  console.log('restored protected days');
}

main();
