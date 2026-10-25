#!/usr/bin/env node
'use strict';

/**
 * Optional Bing / Microsoft Advertising puller.
 *
 * Disabled by default. The live dashboard is a static GitHub Pages mirror and
 * cannot call Microsoft Advertising from the browser. When the private data
 * repo (davidstarkk/coldest-cfo-dashboard) starts publishing a `bing` block,
 * this script is not required.
 *
 * Enable only on a trusted machine / the private pipeline:
 *   BING_ADS_ENABLED=1
 *   BING_ADS_CLIENT_ID=...
 *   BING_ADS_CLIENT_SECRET=...
 *   BING_ADS_DEVELOPER_TOKEN=...
 *   BING_ADS_REFRESH_TOKEN=...
 *   BING_ADS_CUSTOMER_ID=...
 *   BING_ADS_ACCOUNT_ID=...
 *
 * Then: npm run pull:bing
 *
 * Until campaigns are live, the script writes a $0 pre-launch feed.
 */

var fs = require('fs');
var path = require('path');

var enabled = process.env.BING_ADS_ENABLED === '1' || process.env.BING_ADS_ENABLED === 'true';
var outPath = path.join(__dirname, '..', 'bing_ads_data.json');

function writeFeed(feed) {
  fs.writeFileSync(outPath, JSON.stringify(feed, null, 2) + '\n');
  console.log('Wrote ' + outPath + ' (status=' + feed.status + ', spend=' + (feed.spend || 0) + ')');
}

var empty = {
  as_of: new Date().toISOString().slice(0, 10),
  source: 'pull_bing_ads.js',
  status: 'pre_launch',
  message: 'Bing / Microsoft Advertising puller is disabled or campaigns are not live. Daily spend is $0.',
  spend: 0,
  clicks: 0,
  conversions: 0,
  revenue: 0,
  roas: null,
  daily: []
};

if (!enabled) {
  console.log('Bing Ads puller disabled (set BING_ADS_ENABLED=1 to enable). Writing $0 pre-launch feed.');
  writeFeed(empty);
  process.exit(0);
}

var required = [
  'BING_ADS_CLIENT_ID',
  'BING_ADS_CLIENT_SECRET',
  'BING_ADS_DEVELOPER_TOKEN',
  'BING_ADS_REFRESH_TOKEN',
  'BING_ADS_CUSTOMER_ID',
  'BING_ADS_ACCOUNT_ID'
];
var missing = required.filter(function (k) { return !process.env[k]; });
if (missing.length) {
  console.error('BING_ADS_ENABLED=1 but missing env vars: ' + missing.join(', '));
  console.error('Direct Microsoft Advertising API pull is not wired yet. Use bing_ads_data.json or mer_for_manus.json → bing.');
  process.exit(1);
}

console.error('Credentials are present, but a live Microsoft Advertising API client is not implemented in this public mirror.');
console.error('Publish daily numbers via davidstarkk/coldest-cfo-dashboard (bing block / advertising_sources.bing) or edit bing_ads_data.json.');
writeFeed(Object.assign({}, empty, {
  status: 'credentials_present_not_fetched',
  message: 'Env vars set, but this public Pages repo does not call Microsoft Advertising. Use the private data repo or the manual JSON file.'
}));
process.exit(0);
