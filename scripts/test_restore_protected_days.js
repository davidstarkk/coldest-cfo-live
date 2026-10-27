'use strict';

var assert = require('assert');
var P = require('./lib/protected_days');

var failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  - ' + name); }
  catch (e) {
    failed += 1;
    console.error('FAIL - ' + name);
    console.error('     ' + (e && e.stack ? e.stack : e));
  }
}

var snapMer = {
  as_of: '2026-10-24',
  shop_revenue: 26420.44,
  d2c_ad_spend: 14382.78,
  blended_mer: 1.84,
  advertising_sources: {
    '2026-10-24': { meta: { spend: 11521.87 }, applovin: { spend: 0 } }
  }
};

var snapshot = {
  mer_as_of: '2026-10-24',
  days: {
    '2026-10-09': {
      date: '2026-10-09',
      shopify_needs_backfill: true,
      channel_revenue: { tiktok: 15285.84, whatnot: 10106 },
      channel_ad_spend: { meta: 4281.49, google: 1113.18, applovin: 0 },
      row: {
        date: '2026-10-09',
        report_status: 'partial',
        channel_observations: {
          shopify: { revenue: 0, data_available: false, zero_assumed: true },
          tiktok: { revenue: 15285.84, data_available: true, zero_assumed: false }
        },
        advertising_sources: { meta: { spend: 4281.49 } }
      }
    },
    '2026-10-24': {
      date: '2026-10-24',
      channel_revenue: { shopify: 26598.51, amazon: 14925.74 },
      channel_ad_spend: { meta: 11521.87, applovin: 0 },
      row: {
        date: '2026-10-24',
        report_status: 'partial',
        channel_observations: {
          shopify: { revenue: 26598.51, data_available: true, zero_assumed: false },
          amazon: { revenue: 14925.74, data_available: true, zero_assumed: false }
        },
        advertising_sources: { meta: { spend: 11521.87 }, applovin: { spend: 0 } }
      }
    }
  }
};

test('dropped protected day is restored; later live days are kept', function () {
  var live = [{ date: '2026-10-25', channel_observations: { shopify: { revenue: 100, data_available: true } } }];
  var out = P.mergePartials(live, snapshot);
  assert.strictEqual(out.changed, true);
  var dates = out.rows.map(function (r) { return r.date; });
  assert.deepStrictEqual(dates, ['2026-10-09', '2026-10-24', '2026-10-25']);
  assert.strictEqual(out.rows[2].channel_observations.shopify.revenue, 100);
});

function rowOn(rows, date) {
  return rows.filter(function (r) { return r.date === date; })[0];
}

test('zeroed Shopify is restored; published $0 AppLovin is not treated as missing', function () {
  var live = [{
    date: '2026-10-24',
    channel_observations: {
      shopify: { revenue: 0, data_available: false, zero_assumed: true },
      amazon: { revenue: 14925.74, data_available: true, zero_assumed: false }
    },
    advertising_sources: { meta: { spend: 0 }, applovin: { spend: 0 } },
    channel_ad_spend: { meta: 0, applovin: 0 }
  }];
  var out = P.mergePartials(live, snapshot);
  assert.strictEqual(out.changed, true);
  var day = rowOn(out.rows, '2026-10-24');
  assert.strictEqual(day.channel_observations.shopify.revenue, 26598.51);
  assert.strictEqual(day.channel_revenue.shopify, 26598.51);
  assert.strictEqual(day.channel_ad_spend.meta, 11521.87);
  assert.strictEqual(day.channel_ad_spend.applovin, 0);
});

test('newer published Shopify is kept (never delete newer real data)', function () {
  var live = [{
    date: '2026-10-24',
    channel_observations: { shopify: { revenue: 99999, data_available: true, zero_assumed: false } },
    channel_revenue: { shopify: 99999 }
  }];
  var out = P.mergePartials(live, snapshot);
  var day = rowOn(out.rows, '2026-10-24');
  assert.strictEqual(day.channel_revenue.shopify, 99999);
  assert.strictEqual(day.channel_observations.shopify.revenue, 99999);
});

test('10/9 Shopify backfill is not invented from zero_assumed snapshot', function () {
  var live = [{
    date: '2026-10-09',
    channel_observations: {
      shopify: { revenue: 0, data_available: false, zero_assumed: true },
      tiktok: { revenue: 1, data_available: true, zero_assumed: false }
    }
  }];
  var out = P.mergePartials(live, snapshot);
  assert.strictEqual(out.rows[0].channel_observations.shopify.revenue, 0);
  assert.strictEqual(out.rows[0].channel_revenue.shopify, undefined);
  assert.strictEqual(out.rows[0].channel_revenue.tiktok, 1);
  assert.strictEqual(out.rows[0].channel_revenue.whatnot, 10106);
});

test('mer as_of only moves forward when live is older or missing', function () {
  var older = P.mergeMer({ as_of: '2026-09-27', shop_revenue: 1 }, snapMer, snapshot);
  assert.strictEqual(older.changed, true);
  assert.strictEqual(older.as_of_restored, true);
  assert.strictEqual(older.mer.as_of, '2026-10-24');
  assert.strictEqual(older.mer.shop_revenue, 26420.44);

  var newer = P.mergeMer({
    as_of: '2026-10-26',
    shop_revenue: 30000,
    advertising_sources: { '2026-10-26': { meta: { spend: 1 } } }
  }, snapMer, snapshot);
  assert.strictEqual(newer.as_of_restored, false);
  assert.strictEqual(newer.mer.as_of, '2026-10-26');
  assert.strictEqual(newer.mer.shop_revenue, 30000);

  var missing = P.mergeMer(null, snapMer, snapshot);
  assert.strictEqual(missing.mer.as_of, '2026-10-24');
});

test('newer mer keeps later advertising_sources days when restoring an older as_of', function () {
  var live = {
    as_of: '2026-10-20',
    advertising_sources: {
      '2026-10-26': { meta: { spend: 9 } }
    }
  };
  var out = P.mergeMer(live, snapMer, snapshot);
  assert.strictEqual(out.mer.as_of, '2026-10-24');
  assert.strictEqual(out.mer.advertising_sources['2026-10-26'].meta.spend, 9);
  assert.strictEqual(out.mer.advertising_sources['2026-10-24'].meta.spend, 11521.87);
});

test('extract/write PARTIAL_REPORTS does not touch surrounding layout HTML', function () {
  var html = '<div class="report-card">KEEP</div>\nconst PARTIAL_REPORTS = [{"date":"2026-10-24"}];\n<div id="tab-reports">KEEP2</div>\n';
  var rows = P.extractPartials(html);
  assert.strictEqual(rows[0].date, '2026-10-24');
  var next = P.writePartials(html, [{ date: '2026-10-24', channel_revenue: { shopify: 1 } }]);
  assert.ok(next.indexOf('<div class="report-card">KEEP</div>') === 0);
  assert.ok(next.indexOf('<div id="tab-reports">KEEP2</div>') !== -1);
});

test('mer-only Bing spend is not treated as a PARTIAL wipe', function () {
  var live = [{
    date: '2026-10-24',
    channel_observations: {
      shopify: { revenue: 26598.51, data_available: true, zero_assumed: false },
      amazon: { revenue: 14925.74, data_available: true, zero_assumed: false }
    },
    advertising_sources: { meta: { spend: 11521.87 }, applovin: { spend: 0 } }
  }];
  var mer = {
    as_of: '2026-10-24',
    advertising_sources: {
      '2026-10-24': { bing: { spend: 77.33 }, meta: { spend: 11521.87 } }
    }
  };
  var snap = {
    days: {
      '2026-10-24': JSON.parse(JSON.stringify(snapshot.days['2026-10-24']))
    }
  };
  snap.days['2026-10-24'].channel_ad_spend.bing = 77.33;
  var out = P.mergePartials(live, snap, mer);
  assert.strictEqual(out.changed, false);
});

test('restore() is a no-op on the current live snapshot + mer + PARTIAL_REPORTS', function () {
  var fs = require('fs');
  var path = require('path');
  var root = path.join(__dirname, '..');
  var snapshotLive = JSON.parse(fs.readFileSync(path.join(root, 'protected_days', 'snapshot.json'), 'utf8'));
  var snapMer = JSON.parse(fs.readFileSync(path.join(root, 'protected_days', 'mer_for_manus.json'), 'utf8'));
  var liveMer = JSON.parse(fs.readFileSync(path.join(root, 'mer_for_manus.json'), 'utf8'));
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var partials = P.extractPartials(html);
  var out = P.restore({ snapshot: snapshotLive, snapshotMer: snapMer, mer: liveMer, partials: partials });
  assert.strictEqual(out.changed, false);
  assert.strictEqual(out.partialsChanged, false);
  assert.strictEqual(out.merChanged, false);
  assert.strictEqual(out.asOfRestored, false);
  assert.strictEqual(snapshotLive.as_of, '2026-10-26');
  assert.strictEqual(liveMer.as_of, '2026-10-26');
  var d9 = rowOn(partials, '2026-10-09');
  var d10 = rowOn(partials, '2026-10-10');
  var d26 = rowOn(partials, '2026-10-26');
  assert.strictEqual(d9.channel_observations.shopify.revenue, 26289.5);
  assert.strictEqual(d9.channel_observations.shopify.zero_assumed, false);
  assert.strictEqual(d10.channel_observations.shopify.revenue, 16958.06);
  assert.strictEqual(d10.channel_observations.shopify.zero_assumed, false);
  assert.ok(d26);
  assert.strictEqual(d26.channel_observations.shopify.revenue, 15435.88);
});

test('restore() reports a wipe of protected days + mer regression', function () {
  var out = P.restore({
    snapshot: snapshot,
    snapshotMer: snapMer,
    mer: { as_of: '2026-09-27' },
    partials: []
  });
  assert.strictEqual(out.changed, true);
  assert.strictEqual(out.partialsChanged, true);
  assert.strictEqual(out.asOfRestored, true);
  assert.strictEqual(out.partials.length, 2);
  assert.strictEqual(out.mer.as_of, '2026-10-24');
});

if (failed) {
  console.error('\n' + failed + ' protected-days restore test(s) failed');
  process.exit(1);
}
console.log('\nAll protected-days restore tests passed');
