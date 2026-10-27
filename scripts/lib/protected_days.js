'use strict';

var SPEND_ALIASES = [
  { id: 'meta', keys: ['meta', 'meta_ads'] },
  { id: 'google', keys: ['google', 'google_ads'] },
  { id: 'bing', keys: ['bing', 'bing_ads'] },
  { id: 'reddit', keys: ['reddit', 'reddit_ads'] },
  { id: 'snapchat', keys: ['snapchat', 'snapchat_ads'] },
  { id: 'chatgpt', keys: ['chatgpt', 'chatgpt_ads'] },
  { id: 'pinterest', keys: ['pinterest', 'pinterest_ads'] },
  { id: 'applovin', keys: ['applovin', 'app_lovin'] }
];
var REVENUE_CHANNELS = ['shopify', 'amazon', 'tiktok', 'whatnot'];
var SHOPIFY_BACKFILL_DATES = ['2026-10-09', '2026-10-10'];

function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function merAsOf(doc) {
  return doc && isDate(doc.as_of) ? doc.as_of : null;
}

function publishedAmount(node, keys) {
  keys = keys || ['spend', 'revenue', 'daily_spend', 'ad_spend', 'amount'];
  if (node == null) return { published: false, value: null };
  if (typeof node === 'number') {
    return Number.isFinite(node) ? { published: true, value: node } : { published: false, value: null };
  }
  if (typeof node === 'string' && node !== '') {
    var n = Number(node);
    return Number.isFinite(n) ? { published: true, value: n } : { published: false, value: null };
  }
  if (typeof node !== 'object') return { published: false, value: null };
  for (var i = 0; i < keys.length; i++) {
    if (node[keys[i]] != null && node[keys[i]] !== '') {
      var v = Number(node[keys[i]]);
      if (Number.isFinite(v)) return { published: true, value: v };
    }
  }
  return { published: false, value: null };
}

function observationPublished(obs) {
  if (!obs || typeof obs !== 'object') return { published: false, value: null };
  if (obs.data_available === false || obs.zero_assumed === true) return { published: false, value: null };
  return publishedAmount(obs, ['revenue']);
}

function pickKeyed(map, keys) {
  if (!map || typeof map !== 'object') return undefined;
  for (var i = 0; i < keys.length; i++) {
    if (Object.prototype.hasOwnProperty.call(map, keys[i])) return map[keys[i]];
  }
  return undefined;
}

function channelAdSpendFromSources(sources) {
  var out = {};
  if (!sources || typeof sources !== 'object') return out;
  SPEND_ALIASES.forEach(function (ch) {
    var node = pickKeyed(sources, ch.keys);
    var amt = publishedAmount(node, ['spend', 'daily_spend', 'ad_spend']);
    if (amt.published) out[ch.id] = amt.value;
  });
  return out;
}

function channelRevenueFromObs(obs) {
  var out = {};
  if (!obs || typeof obs !== 'object') return out;
  REVENUE_CHANNELS.forEach(function (id) {
    var amt = observationPublished(obs[id]);
    if (amt.published) out[id] = amt.value;
  });
  return out;
}

function liveSpendMap(row, merSources) {
  var fromRow = row && row.channel_ad_spend && typeof row.channel_ad_spend === 'object'
    ? channelAdSpendFromSources(row.channel_ad_spend)
    : {};
  var fromPartial = channelAdSpendFromSources(row && row.advertising_sources);
  var fromMer = channelAdSpendFromSources(merSources);
  return Object.assign({}, fromMer, fromPartial, fromRow);
}

function liveRevenueMap(row) {
  var out = channelRevenueFromObs(row && row.channel_observations);
  if (row && row.channel_revenue && typeof row.channel_revenue === 'object') {
    REVENUE_CHANNELS.forEach(function (id) {
      var amt = publishedAmount(row.channel_revenue[id], ['revenue']);
      if (amt.published) out[id] = amt.value;
    });
  }
  return out;
}

function snapshotDayFromLive(row, merSources) {
  if (!row || !row.date) return null;
  var revenue = liveRevenueMap(row);
  var spend = liveSpendMap(row, merSources);
  return {
    date: row.date,
    channel_revenue: revenue,
    channel_ad_spend: spend,
    shopify_needs_backfill: SHOPIFY_BACKFILL_DATES.indexOf(row.date) !== -1 && revenue.shopify == null,
    row: {
      date: row.date,
      report_status: row.report_status || 'partial',
      source_mode: row.source_mode || 'partial_v1',
      channel_observations: row.channel_observations || {},
      advertising_sources: row.advertising_sources || {},
      provisional_totals: row.provisional_totals || {},
      channel_revenue: Object.keys(revenue).length ? revenue : undefined,
      channel_ad_spend: Object.keys(spend).length ? spend : undefined,
      calculation_basis: row.calculation_basis,
      blockers: row.blockers,
      zero_assumptions: row.zero_assumptions,
      updated_at: row.updated_at
    }
  };
}

function buildSnapshot(partials, mer) {
  var days = {};
  var merAdv = (mer && mer.advertising_sources) || {};
  (partials || []).forEach(function (row) {
    if (!row || !isDate(row.date)) return;
    days[row.date] = snapshotDayFromLive(row, merAdv[row.date]);
  });
  Object.keys(merAdv).forEach(function (date) {
    if (days[date]) return;
    if (!isDate(date)) return;
    days[date] = snapshotDayFromLive({ date: date, advertising_sources: merAdv[date] }, merAdv[date]);
  });
  var dates = Object.keys(days).sort();
  return {
    as_of: merAsOf(mer) || (dates.length ? dates[dates.length - 1] : null),
    mer_as_of: merAsOf(mer),
    protected_range: dates.length ? [dates[0], dates[dates.length - 1]] : [],
    shopify_backfill_dates: SHOPIFY_BACKFILL_DATES.slice(),
    days: days,
    mer: mer ? {
      as_of: mer.as_of || null,
      shop_revenue: mer.shop_revenue,
      d2c_ad_spend: mer.d2c_ad_spend,
      blended_mer: mer.blended_mer,
      mer_7d_pooled: mer.mer_7d_pooled,
      mer_30d_pooled: mer.mer_30d_pooled,
      total_ad_spend: mer.total_ad_spend
    } : null,
    gaps: []
  };
}

function revenueMapFromSnap(snapDay) {
  var src = (snapDay && snapDay.channel_revenue) || {};
  var out = {};
  REVENUE_CHANNELS.forEach(function (id) {
    var amt = publishedAmount(src[id], ['revenue']);
    if (amt.published) out[id] = amt.value;
  });
  return out;
}

function spendMapFromSnap(snapDay) {
  return channelAdSpendFromSources(snapDay && snapDay.channel_ad_spend);
}

function snapObservations(snapDay) {
  if (snapDay && snapDay.row && snapDay.row.channel_observations) return snapDay.row.channel_observations;
  return (snapDay && snapDay.channel_observations) || {};
}

function rowFromSnapDay(snapDay) {
  if (!snapDay) return null;
  if (snapDay.row) return JSON.parse(JSON.stringify(snapDay.row));
  var revenue = revenueMapFromSnap(snapDay);
  var spend = spendMapFromSnap(snapDay);
  return {
    date: snapDay.date,
    report_status: snapDay.report_status || 'partial',
    source_mode: snapDay.source_mode || 'partial_v1',
    channel_observations: JSON.parse(JSON.stringify(snapDay.channel_observations || {})),
    advertising_sources: JSON.parse(JSON.stringify(snapDay.advertising_sources || {})),
    blockers: snapDay.blockers,
    channel_revenue: Object.keys(revenue).length ? revenue : undefined,
    channel_ad_spend: Object.keys(spend).length ? spend : undefined,
    calculation_basis: snapDay.backfill ? 'shopify_backfill' : (snapDay.calculation_basis || 'partial_v1')
  };
}

function mapNeedsRestore(snapMap, liveMap) {
  snapMap = snapMap || {};
  liveMap = liveMap || {};
  var out = {};
  var changed = false;
  Object.keys(snapMap).forEach(function (k) {
    var snap = publishedAmount(snapMap[k]);
    if (!snap.published) return;
    var live = publishedAmount(liveMap[k]);
    if (!live.published) {
      if (snap.value === 0) return;
      out[k] = snap.value;
      changed = true;
      return;
    }
    if (live.value === 0 && snap.value !== 0) {
      out[k] = snap.value;
      changed = true;
      return;
    }
    out[k] = live.value;
  });
  Object.keys(liveMap).forEach(function (k) {
    if (out[k] != null) return;
    var live = publishedAmount(liveMap[k]);
    if (live.published) out[k] = live.value;
  });
  return { map: out, changed: changed };
}

function obsNeedsRestore(snapObs, liveObs) {
  var snap = observationPublished(snapObs);
  var live = observationPublished(liveObs);
  if (snap.published && snap.value === 0 && !live.published) return false;
  if (snap.published && !live.published) return true;
  if (snap.published && live.published && live.value === 0 && snap.value !== 0) return true;
  return false;
}

function mergeDay(snapDay, liveRow, merSources) {
  if (!snapDay) return { row: liveRow, changed: false };
  if (!liveRow) {
    return { row: rowFromSnapDay(snapDay), changed: true, dropped: true };
  }
  var row = JSON.parse(JSON.stringify(liveRow));
  var changed = false;
  var rev = mapNeedsRestore(revenueMapFromSnap(snapDay), liveRevenueMap(row));
  if (rev.changed) {
    row.channel_revenue = Object.assign({}, row.channel_revenue || {}, rev.map);
    changed = true;
  }
  var spend = mapNeedsRestore(spendMapFromSnap(snapDay), liveSpendMap(row, merSources));
  if (spend.changed) {
    row.channel_ad_spend = Object.assign({}, row.channel_ad_spend || {}, spend.map);
    changed = true;
  }
  var snapObs = snapObservations(snapDay);
  var liveObs = row.channel_observations || {};
  REVENUE_CHANNELS.forEach(function (id) {
    if (obsNeedsRestore(snapObs[id], liveObs[id])) {
      row.channel_observations = row.channel_observations || {};
      row.channel_observations[id] = JSON.parse(JSON.stringify(snapObs[id]));
      changed = true;
    }
  });
  return { row: row, changed: changed };
}

function mergePartials(partials, snapshot, mer) {
  var byDate = {};
  (partials || []).forEach(function (row) {
    if (row && row.date) byDate[row.date] = row;
  });
  var changed = false;
  var snapDays = (snapshot && snapshot.days) || {};
  var merAdv = (mer && mer.advertising_sources) || {};
  Object.keys(snapDays).sort().forEach(function (date) {
    var merged = mergeDay(snapDays[date], byDate[date], merAdv[date]);
    if (merged.changed) {
      byDate[date] = merged.row;
      changed = true;
    }
  });
  var dates = Object.keys(byDate).sort();
  return { rows: dates.map(function (d) { return byDate[d]; }), changed: changed };
}

function mergeMer(liveMer, snapMer, snapshot) {
  var snapAsOf = merAsOf(snapMer) || (snapshot && snapshot.mer_as_of);
  var liveAsOf = merAsOf(liveMer);
  var changed = false;
  if (!snapAsOf) return { mer: liveMer, changed: false, as_of_restored: false };
  if (!liveMer || !liveAsOf || liveAsOf < snapAsOf) {
    var restored = JSON.parse(JSON.stringify(snapMer));
    if (liveMer && liveMer.advertising_sources && restored.advertising_sources) {
      Object.keys(liveMer.advertising_sources).forEach(function (date) {
        if (!isDate(date)) return;
        if (!snapAsOf || date > snapAsOf) restored.advertising_sources[date] = liveMer.advertising_sources[date];
      });
    }
    if (liveAsOf && snapAsOf && liveAsOf > snapAsOf) restored.as_of = liveAsOf;
    return { mer: restored, changed: true, as_of_restored: !liveAsOf || liveAsOf < snapAsOf };
  }
  var mer = JSON.parse(JSON.stringify(liveMer));
  var snapAdv = (snapMer && snapMer.advertising_sources) || {};
  mer.advertising_sources = mer.advertising_sources || {};
  Object.keys(snapAdv).forEach(function (date) {
    if (!mer.advertising_sources[date]) {
      mer.advertising_sources[date] = JSON.parse(JSON.stringify(snapAdv[date]));
      changed = true;
    }
  });
  return { mer: mer, changed: changed, as_of_restored: false };
}

function extractPartials(html) {
  var m = String(html).match(/const PARTIAL_REPORTS = (\[[\s\S]*?\]);\s*\n/);
  if (!m) return null;
  return JSON.parse(m[1]);
}

function writePartials(html, rows) {
  return String(html).replace(
    /const PARTIAL_REPORTS = (\[[\s\S]*?\]);\s*\n/,
    'const PARTIAL_REPORTS = ' + JSON.stringify(rows) + ';\n'
  );
}

function restore(input) {
  var snapshot = input.snapshot;
  var partials = input.partials || [];
  var liveMer = input.mer;
  var snapMer = input.snapshotMer || (snapshot && snapshot.mer_doc) || null;
  var merged = mergePartials(partials, snapshot, liveMer);
  var merOut = mergeMer(liveMer, snapMer, snapshot);
  return {
    partials: merged.rows,
    mer: merOut.mer,
    changed: !!(merged.changed || merOut.changed),
    partialsChanged: merged.changed,
    merChanged: merOut.changed,
    asOfRestored: merOut.as_of_restored
  };
}

module.exports = {
  SPEND_ALIASES: SPEND_ALIASES,
  REVENUE_CHANNELS: REVENUE_CHANNELS,
  SHOPIFY_BACKFILL_DATES: SHOPIFY_BACKFILL_DATES,
  merAsOf: merAsOf,
  publishedAmount: publishedAmount,
  observationPublished: observationPublished,
  channelAdSpendFromSources: channelAdSpendFromSources,
  channelRevenueFromObs: channelRevenueFromObs,
  buildSnapshot: buildSnapshot,
  mergeDay: mergeDay,
  mergePartials: mergePartials,
  mergeMer: mergeMer,
  extractPartials: extractPartials,
  writePartials: writePartials,
  restore: restore,
  rowFromSnapDay: rowFromSnapDay,
  revenueMapFromSnap: revenueMapFromSnap,
  spendMapFromSnap: spendMapFromSnap
};
