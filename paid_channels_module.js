/* =====================================================================
   COLDEST · PAID CHANNELS  (Meta, Google, Bing, Reddit, Snapchat, ChatGPT)
   ---------------------------------------------------------------------
   Reporting-only. No API credentials. Missing feed → $0 / "no feed".
   Never invents clicks, conversions, revenue, or spend.

   Per-channel feed order (same as Bing):
     1. PARTIAL_REPORTS[].advertising_sources.<aliases>
     2. mer_for_manus.json <channel> block  (exact keys: bing, reddit, snapchat, chatgpt)
     3. optional <channel>_ads_data.json
     4. localStorage manual day (channel tabs)

   mer_for_manus.json daily_inputs contract (match these keys exactly):
     d2c_ad_spend, blended_mer, total_ad_spend,
     bing.{spend,d2c,amazon}, reddit, snapchat, chatgpt (tracking_verified),
     non_d2c.{whatnot,applovin,tiktok_shop,sellerboard_amazon,unallocated}

   Destination split (d2c vs amazon/other) is per channel:
     D2C ad spend  = Shopify-bound paid media (Meta, Google, Bing D2C,
                     Reddit, Snapchat, ChatGPT, TikTok shopify_spend).
                     Blended MER = Shopify D2C revenue ÷ D2C ad spend.
     All ad spend  = company total (D2C + Amazon-bound + other non-D2C).
     Amazon-bound  (Bing Amazon, Sellerboard Amazon) and other non-D2C
     (Whatnot, AppLovin, TikTok Shop, unallocated) sit in All ad spend
     and are excluded from D2C ad spend / blended MER.
     Per-channel feeds may publish d2c / amazon / other or
     destination: "d2c" | "amazon" | "other".

   Pipeline-published spend is already inside provisional_totals.ads
   (Meta, Google, …). Those channels are displayed, not added again.
   New channels (Bing / Reddit / Snapchat / ChatGPT) overlay only when
   the pipeline has not published them and a feed has spend > $0.

   When mer_for_manus publishes d2c_ad_spend / blended_mer / total_ad_spend
   for the focus date, those values are displayed as-is (not recomputed).
   ===================================================================== */
(function (root) {
  'use strict';

  var CHANNELS = [
    { id: 'meta', label: 'Meta', tabKey: 'meta_ads', tabLabel: 'META ADS', merKey: 'meta', file: 'meta_ads_data.json', sourceKeys: ['meta', 'meta_ads', 'facebook', 'fb_ads'], pipelineDefault: true },
    { id: 'google', label: 'Google Ads', tabKey: 'google_ads', tabLabel: 'GOOGLE ADS', merKey: 'google', file: 'google_ads_data.json', sourceKeys: ['google_ads', 'google', 'google_advertising'], pipelineDefault: true },
    { id: 'bing', label: 'Bing / Microsoft', tabKey: 'bing_ads', tabLabel: 'BING ADS', merKey: 'bing', file: 'bing_ads_data.json', sourceKeys: ['bing', 'bing_ads', 'microsoft_ads', 'microsoft_advertising'], pipelineDefault: false },
    { id: 'reddit', label: 'Reddit Ads', tabKey: 'reddit_ads', tabLabel: 'REDDIT ADS', merKey: 'reddit', file: 'reddit_ads_data.json', sourceKeys: ['reddit', 'reddit_ads'], pipelineDefault: false },
    { id: 'snapchat', label: 'Snapchat Ads', tabKey: 'snapchat_ads', tabLabel: 'SNAPCHAT ADS', merKey: 'snapchat', file: 'snapchat_ads_data.json', sourceKeys: ['snapchat', 'snapchat_ads', 'snap'], pipelineDefault: false },
    { id: 'chatgpt', label: 'ChatGPT Ads', tabKey: 'chatgpt_ads', tabLabel: 'CHATGPT ADS', merKey: 'chatgpt', file: 'chatgpt_ads_data.json', sourceKeys: ['chatgpt', 'chatgpt_ads', 'openai_ads'], pipelineDefault: false, tabExists: true }
  ];

  var NON_D2C_LINES = [
    { keys: ['whatnot'], label: 'Whatnot', kind: 'other' },
    { keys: ['applovin'], label: 'AppLovin', kind: 'other' },
    { keys: ['tiktok_shop', 'TikTok Shop', 'tiktok_shop_ads'], label: 'TikTok Shop', kind: 'other' },
    { keys: ['sellerboard_amazon', 'Sellerboard Amazon', 'sellerboard'], label: 'Sellerboard Amazon', kind: 'amazon' },
    { keys: ['unallocated', 'unallocated_ads'], label: 'Unallocated', kind: 'other' }
  ];

  var BING_AMAZON_CAMPAIGN = 'bing to amz tumbler listing 1';

  var FEEDS = {};
  CHANNELS.forEach(function (ch) {
    FEEDS[ch.id] = { file: null, mer: null, manual: null };
  });
  var MER_DOC = null;

  function hostArray(name) {
    try {
      if (name === 'REPORTS' && typeof REPORTS !== 'undefined') return REPORTS;
      if (name === 'PARTIAL_REPORTS' && typeof PARTIAL_REPORTS !== 'undefined') return PARTIAL_REPORTS;
    } catch (e) { /* Node has no lexical binding */ }
    var g = typeof globalThis !== 'undefined' ? globalThis : root;
    return g && Array.isArray(g[name]) ? g[name] : null;
  }

  function num(v) {
    if (v == null || v === '') return 0;
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  function round2(v) { return Math.round(num(v) * 100) / 100; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function usd(v) {
    return '$' + num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function intOrDash(v) {
    return v == null ? '—' : Math.round(num(v)).toLocaleString();
  }
  function usdOrDash(v) {
    return v == null ? '—' : usd(v);
  }
  function roasTxt(spend, revenue, explicit) {
    if (explicit != null && Number.isFinite(Number(explicit))) return Number(explicit).toFixed(2) + 'x';
    if (num(spend) > 0 && num(revenue) > 0) return (num(revenue) / num(spend)).toFixed(2) + 'x';
    return '—';
  }

  var TRACKING_UNVERIFIED = 'tracking not verified';

  function isTrackingUnverified(day, ch) {
    if (!ch || ch.id !== 'chatgpt') return false;
    if (day && day.tracking_verified != null) return day.tracking_verified === false;
    var mer = merBlockFor(ch);
    return !!(mer && mer.tracking_verified === false);
  }

  function outcomeTxt(day, kind, ch) {
    if (isTrackingUnverified(day, ch)) return TRACKING_UNVERIFIED;
    if (kind === 'conversions') return day && day.hasFeed && day.hasConversions ? intOrDash(day.conversions) : '—';
    if (kind === 'revenue') return day && day.hasFeed && day.hasRevenue ? usd(day.revenue) : '—';
    if (kind === 'roas') return day && day.hasFeed && (day.hasRevenue || (day && day.roas != null)) ? roasTxt(day.spend, day.revenue, day.roas) : '—';
    return '—';
  }

  function emptyDay(date) {
    return {
      date: date || null,
      spend: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
      roas: null,
      impressions: 0,
      status: 'no_feed',
      source: 'no feed',
      complete: true,
      hasFeed: false
    };
  }

  function isPlaceholderNode(node) {
    if (!node || typeof node !== 'object') return false;
    return (node.status === 'no_feed' || node.source === 'no feed' || node.source === 'none') && num(node.spend) === 0;
  }

  function pickSourceNode(sources, ch) {
    if (!sources || typeof sources !== 'object' || !ch) return null;
    for (var i = 0; i < ch.sourceKeys.length; i++) {
      if (sources[ch.sourceKeys[i]] != null) return { key: ch.sourceKeys[i], node: sources[ch.sourceKeys[i]] };
    }
    return null;
  }

  function nestedSpend(node) {
    if (node == null || node === false) return null;
    if (typeof node !== 'object') return round2(node);
    if (node.spend != null || node.daily_spend != null || node.ad_spend != null) {
      return round2(node.spend != null ? node.spend : (node.daily_spend != null ? node.daily_spend : node.ad_spend));
    }
    return null;
  }

  function hasDestinationFields(node) {
    if (!node || typeof node !== 'object') return false;
    return node.d2c != null || node.amazon != null || node.other != null
      || node.destination != null || node.dest != null
      || node.shopify_spend != null || node.shop_spend != null;
  }

  function destinationSplit(node) {
    if (node == null) return { spend: 0, d2c: null, amazon: null, other: null, destination: null };
    if (typeof node !== 'object') {
      return { spend: round2(node), d2c: round2(node), amazon: null, other: null, destination: 'd2c' };
    }
    var dest = node.destination || node.dest || null;
    var spend = nestedSpend(node);
    var d2c = node.d2c != null ? nestedSpend(node.d2c) : (node.shopify_spend != null ? round2(node.shopify_spend) : null);
    var amazon = node.amazon != null ? nestedSpend(node.amazon) : null;
    var other = node.other != null ? nestedSpend(node.other) : null;
    if (other == null && (node.shop_spend != null || node.unallocated_spend != null)) {
      other = round2(num(node.shop_spend) + num(node.unallocated_spend));
    }
    if (dest === 'amazon') {
      amazon = spend == null ? num(amazon) : spend;
      d2c = 0;
      if (other == null) other = 0;
    } else if (dest === 'other') {
      other = spend == null ? num(other) : spend;
      d2c = 0;
      if (amazon == null) amazon = 0;
    } else if (dest === 'd2c') {
      d2c = spend == null ? num(d2c) : spend;
    }
    if (spend == null && (d2c != null || amazon != null || other != null)) {
      spend = round2(num(d2c) + num(amazon) + num(other));
    }
    return {
      spend: spend == null ? 0 : spend,
      d2c: d2c,
      amazon: amazon,
      other: other,
      destination: dest
    };
  }

  function bingSplit(node) {
    var split = destinationSplit(node);
    return { spend: split.spend, d2c: split.d2c == null ? 0 : split.d2c, amazon: split.amazon == null ? 0 : split.amazon };
  }

  function nodeToDay(date, node, source) {
    if (node == null || node === false) return emptyDay(date);
    if (typeof node !== 'object') {
      var d0 = emptyDay(date);
      d0.spend = round2(node);
      d0.status = d0.spend > 0 ? 'ok' : 'zero';
      d0.source = source;
      d0.hasFeed = true;
      return d0;
    }
    var d = emptyDay(date);
    var split = hasDestinationFields(node) ? destinationSplit(node) : null;
    var spendRaw = node.spend != null ? node.spend : (node.daily_spend != null ? node.daily_spend : node.ad_spend);
    if (spendRaw == null && split) spendRaw = split.spend;
    d.spend = round2(spendRaw);
    d.clicks = node.clicks != null ? num(node.clicks) : 0;
    d.conversions = num(node.conversions != null ? node.conversions : (node.conv != null ? node.conv : node.purchases));
    d.revenue = num(node.revenue != null ? node.revenue : node.conv_value);
    d.impressions = num(node.impressions);
    d.hasClicks = node.clicks != null;
    d.hasConversions = node.conversions != null || node.conv != null || node.purchases != null;
    d.hasRevenue = node.revenue != null || node.conv_value != null;
    d.roas = node.roas != null ? num(node.roas) : (d.spend > 0 && d.revenue > 0 ? d.revenue / d.spend : null);
    d.status = node.status || (d.spend > 0 ? 'ok' : 'zero');
    d.source = source;
    d.hasFeed = true;
    d.complete = node.complete !== false;
    d.updated_at = node.updated_at || node.observed_at || node.as_of || null;
    if (node.tracking_verified != null) d.tracking_verified = !!node.tracking_verified;
    if (node.campaign) d.campaign = node.campaign;
    if (node.notes) d.notes = node.notes;
    if (split) {
      d.d2c = split.d2c;
      d.amazon = split.amazon;
      d.other = split.other;
      if (split.destination) d.destination = split.destination;
    }
    return d;
  }

  function dailyMapFromBlock(block, source) {
    var out = {};
    if (!block || typeof block !== 'object') return out;
    if (Array.isArray(block.daily)) {
      block.daily.forEach(function (row) {
        if (!row || !row.date) return;
        out[row.date] = nodeToDay(row.date, row, source);
      });
    }
    var byDate = block.by_date || block.by_day;
    if (byDate && typeof byDate === 'object' && !Array.isArray(byDate)) {
      Object.keys(byDate).forEach(function (date) {
        out[date] = nodeToDay(date, byDate[date], source);
      });
    }
    return out;
  }

  function snapshotFromBlock(block, source) {
    if (!block || typeof block !== 'object') return null;
    var hasScalar = block.spend != null || block.clicks != null || block.conversions != null || block.revenue != null || hasDestinationFields(block);
    if (!hasScalar) return null;
    return nodeToDay(block.as_of || block.date || null, block, source);
  }

  function pickNonD2cNode(block, keys) {
    if (!block || typeof block !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      if (Object.prototype.hasOwnProperty.call(block, keys[i]) && block[keys[i]] != null) {
        return block[keys[i]];
      }
    }
    return null;
  }

  function parseNonD2c(block) {
    if (!block || typeof block !== 'object') return [];
    return NON_D2C_LINES.map(function (line) {
      var node = pickNonD2cNode(block, line.keys);
      var spend = node == null ? 0 : (typeof node === 'object' ? num(nestedSpend(node) || node.known_ads) : num(node));
      return { key: line.keys[0], label: line.label, spend: round2(spend), present: node != null, kind: line.kind };
    });
  }

  function merContract(date) {
    if (!MER_DOC || typeof MER_DOC !== 'object') return null;
    if (date && MER_DOC.as_of && MER_DOC.as_of !== date) return null;
    var hasTotals = MER_DOC.d2c_ad_spend != null || MER_DOC.total_ad_spend != null || MER_DOC.blended_mer != null || MER_DOC.non_d2c != null;
    if (!hasTotals) return null;
    return {
      as_of: MER_DOC.as_of || date || null,
      source: MER_DOC.source || 'mer_for_manus.json',
      d2cAdSpend: MER_DOC.d2c_ad_spend != null ? num(MER_DOC.d2c_ad_spend) : null,
      totalAdSpend: MER_DOC.total_ad_spend != null ? num(MER_DOC.total_ad_spend) : null,
      blendedMer: MER_DOC.blended_mer != null ? num(MER_DOC.blended_mer) : null,
      nonD2c: parseNonD2c(MER_DOC.non_d2c)
    };
  }

  function merBlockFor(ch) {
    if (FEEDS[ch.id].mer && FEEDS[ch.id].mer[ch.merKey]) return FEEDS[ch.id].mer[ch.merKey];
    if (MER_DOC && MER_DOC[ch.merKey]) return MER_DOC[ch.merKey];
    return null;
  }

  function mergeDaysFor(ch) {
    var days = {};
    var file = FEEDS[ch.id].file;
    var merB = merBlockFor(ch);
    Object.assign(days, dailyMapFromBlock(file, ch.file));
    Object.assign(days, dailyMapFromBlock(merB, 'mer_for_manus.json#' + ch.merKey));
    var snap = snapshotFromBlock(merB, 'mer_for_manus.json#' + ch.merKey);
    if (snap && snap.date) days[snap.date] = snap;
    Object.assign(days, dailyMapFromBlock(FEEDS[ch.id].manual, 'manual'));

    var partials = hostArray('PARTIAL_REPORTS');
    if (partials) {
      partials.forEach(function (r) {
        var picked = pickSourceNode(r.advertising_sources, ch);
        if (!picked) return;
        if (pipelineFlag(r, ch) === false && num(picked.node && picked.node.spend) === 0) return;
        var fromPartial = nodeToDay(r.date, picked.node, 'advertising_sources.' + picked.key);
        var existing = days[r.date];
        if (!existing) {
          days[r.date] = fromPartial;
        } else {
          existing.spend = fromPartial.spend;
          existing.source = fromPartial.source;
          existing.complete = fromPartial.complete;
          existing.status = fromPartial.status;
          existing.hasFeed = true;
          if (!existing.updated_at) existing.updated_at = fromPartial.updated_at;
          if (fromPartial.d2c != null) existing.d2c = fromPartial.d2c;
          if (fromPartial.amazon != null) existing.amazon = fromPartial.amazon;
          if (fromPartial.other != null) existing.other = fromPartial.other;
          if (fromPartial.destination) existing.destination = fromPartial.destination;
          if (fromPartial.campaign) existing.campaign = fromPartial.campaign;
        }
      });
    }
    return days;
  }

  function latestDayFor(ch, days) {
    days = days || mergeDaysFor(ch);
    var dates = Object.keys(days).sort();
    if (dates.length) return days[dates[dates.length - 1]];
    var snap = snapshotFromBlock(merBlockFor(ch), 'mer_for_manus.json#' + ch.merKey);
    if (snap) return snap;
    if (FEEDS[ch.id].file) return nodeToDay(FEEDS[ch.id].file.as_of, FEEDS[ch.id].file, ch.file);
    return emptyDay(null);
  }

  function seenKey(ch) { return ch.id === 'bing' ? '_ba_seen_sources' : '_pc_' + ch.id + '_seen'; }
  function pipelineKey(ch) { return ch.id === 'bing' ? '_ba_pipeline_bing' : '_pc_' + ch.id + '_pipeline'; }
  function appliedKey(ch) { return ch.id === 'bing' ? '_ba_bing_applied' : '_pc_' + ch.id + '_applied'; }
  function spendField(ch) { return ch.id + '_ad_spend'; }

  function pipelineFlag(r, ch) {
    if (r[pipelineKey(ch)] != null) return r[pipelineKey(ch)];
    return null;
  }

  function ensureOnPartials(ch, days) {
    var partials = hostArray('PARTIAL_REPORTS');
    if (!partials) return;
    partials.forEach(function (r) {
      r.advertising_sources = r.advertising_sources || {};
      var picked = pickSourceNode(r.advertising_sources, ch);
      var day = (days && days[r.date]) || emptyDay(r.date);
      if (r[seenKey(ch)] == null) {
        r[pipelineKey(ch)] = !!picked;
        r[seenKey(ch)] = true;
      }
      if (picked) {
        return;
      }
      r[pipelineKey(ch)] = false;
      var injected = {
        spend: day.spend,
        clicks: day.clicks,
        conversions: day.conversions,
        revenue: day.revenue,
        roas: day.roas,
        complete: true,
        closed_day: true,
        status: day.hasFeed ? day.status : 'no_feed',
        updated_at: day.updated_at || day.source || 'no feed',
        source: day.source
      };
      if (day.d2c != null) injected.d2c = day.d2c;
      if (day.amazon != null) injected.amazon = day.amazon;
      if (day.other != null) injected.other = day.other;
      if (day.destination) injected.destination = day.destination;
      if (day.campaign) injected.campaign = day.campaign;
      r.advertising_sources[ch.id] = injected;
    });
  }

  function applyPartialTotalsFor(ch, days) {
    var partials = hostArray('PARTIAL_REPORTS');
    if (!partials) return;
    partials.forEach(function (r) {
      var spend = days[r.date] ? round2(days[r.date].spend) : 0;
      r[spendField(ch)] = spend;
      if (r[pipelineKey(ch)]) {
        r[appliedKey(ch)] = 0;
        return;
      }
      var prev = r[appliedKey(ch)] || 0;
      var delta = round2(spend - prev);
      if (Math.abs(delta) < 0.005) return;
      var p = r.provisional_totals;
      if (p) {
        if (p.ads != null) p.ads = round2(num(p.ads) + delta);
        if (p.net_profit != null) p.net_profit = round2(num(p.net_profit) - delta);
        if (p.revenue > 0 && p.ads > 0) p.mer = p.revenue / p.ads;
        if (p.revenue > 0 && p.net_profit != null) p.net_margin_pct = (p.net_profit / p.revenue) * 100;
      }
      r[appliedKey(ch)] = spend;
    });
  }

  function applyReportTotalsFor(ch, days) {
    var reports = hostArray('REPORTS');
    if (!reports) return;
    reports.forEach(function (r) {
      var spend = days[r.date] ? round2(days[r.date].spend) : 0;
      var prev = r[appliedKey(ch)] || 0;
      var delta = round2(spend - prev);
      r[spendField(ch)] = spend;
      if (Math.abs(delta) < 0.005) return;
      if (ch.pipelineDefault) return;
      if (r.total_ad_spend != null) r.total_ad_spend = round2(num(r.total_ad_spend) + delta);
      if (r.blended_ad_spend != null) r.blended_ad_spend = round2(num(r.blended_ad_spend) + delta);
      if (r.net_profit != null) r.net_profit = round2(num(r.net_profit) - delta);
      if (r.contribution_profit != null) r.contribution_profit = round2(num(r.contribution_profit) - delta);
      if (r.total_revenue > 0 && r.total_ad_spend != null) {
        r.mer = +(r.total_revenue / r.total_ad_spend).toFixed(2);
        var blendAd = r.blended_ad_spend != null ? r.blended_ad_spend : r.total_ad_spend;
        r.blended_ad_pct = +(blendAd / r.total_revenue * 100).toFixed(1);
        if (r.blended_ad_spend != null) r.blended_mer = +(r.total_revenue / r.blended_ad_spend).toFixed(2);
        if (r.net_profit != null) r.net_margin_pct = +(r.net_profit / r.total_revenue * 100).toFixed(1);
      }
      r[appliedKey(ch)] = spend;
    });
  }

  function applyChannel(ch, days) {
    ensureOnPartials(ch, days);
    applyPartialTotalsFor(ch, days);
    applyReportTotalsFor(ch, days);
  }

  function latestFocusDate() {
    var dates = [];
    var partials = hostArray('PARTIAL_REPORTS') || [];
    var reports = hostArray('REPORTS') || [];
    if (partials.length) dates.push(partials[partials.length - 1].date);
    if (reports.length) {
      var sorted = reports.slice().sort(function (a, b) { return String(a.date).localeCompare(b.date); });
      dates.push(sorted[sorted.length - 1].date);
    }
    dates.sort();
    return dates.length ? dates[dates.length - 1] : null;
  }

  function shopifyD2C(date) {
    var partials = hostArray('PARTIAL_REPORTS') || [];
    var i, r;
    for (i = 0; i < partials.length; i++) {
      if (partials[i].date === date) {
        var shop = (partials[i].channel_observations || {}).shopify;
        if (shop && shop.revenue != null) return num(shop.revenue);
      }
    }
    var reports = hostArray('REPORTS') || [];
    for (i = 0; i < reports.length; i++) {
      if (reports[i].date === date) return num(reports[i].shop_revenue);
    }
    return 0;
  }

  function resolveDay(ch, date) {
    var days = mergeDaysFor(ch);
    if (date && days[date]) return days[date];
    if (date) {
      var partials = hostArray('PARTIAL_REPORTS') || [];
      for (var i = 0; i < partials.length; i++) {
        if (partials[i].date !== date) continue;
        var picked = pickSourceNode(partials[i].advertising_sources, ch);
        if (picked && !isPlaceholderNode(picked.node)) {
          return nodeToDay(date, picked.node, 'advertising_sources.' + picked.key);
        }
      }
      return emptyDay(date);
    }
    return latestDayFor(ch, days);
  }

  function channelDestAmounts(day) {
    if (!day) return { d2c: 0, amazon: 0, other: 0, spend: 0 };
    var dest = day.destination;
    var spend = num(day.spend);
    if (dest === 'amazon') return { d2c: 0, amazon: spend, other: 0, spend: spend };
    if (dest === 'other') return { d2c: 0, amazon: 0, other: spend, spend: spend };
    var d2c = day.d2c != null ? num(day.d2c) : null;
    var amazon = day.amazon != null ? num(day.amazon) : null;
    var other = day.other != null ? num(day.other) : null;
    if (d2c == null && amazon == null && other == null) {
      return { d2c: spend, amazon: 0, other: 0, spend: spend };
    }
    return { d2c: num(d2c), amazon: num(amazon), other: num(other), spend: spend };
  }

  function advertisingSource(date, keys) {
    var partials = hostArray('PARTIAL_REPORTS') || [];
    var i, j, src;
    for (i = 0; i < partials.length; i++) {
      if (partials[i].date !== date) continue;
      src = partials[i].advertising_sources || {};
      for (j = 0; j < keys.length; j++) {
        if (src[keys[j]] != null) return src[keys[j]];
      }
    }
    return null;
  }

  function tiktokSplitFor(date) {
    var node = advertisingSource(date, ['tiktok_ads', 'tiktok']);
    if (MER_DOC && merContract(date) && MER_DOC.tiktok && !node) node = MER_DOC.tiktok;
    if (!node) return { d2c: null, shop: null, unallocated: null, spend: 0, present: false };
    return {
      d2c: node.shopify_spend != null ? num(node.shopify_spend) : null,
      shop: node.shop_spend != null ? num(node.shop_spend) : null,
      unallocated: node.unallocated_spend != null ? num(node.unallocated_spend) : null,
      spend: nestedSpend(node) || 0,
      present: true
    };
  }

  function upsertLine(list, seen, line) {
    if (seen[line.key]) {
      list.forEach(function (row) {
        if (row.key === line.key) {
          row.spend = line.spend;
          if (line.source) row.source = line.source;
          if (line.note) row.note = line.note;
        }
      });
      return;
    }
    seen[line.key] = true;
    list.push(line);
  }

  function destinationLines(date) {
    var d2cLines = [];
    var amazonLines = [];
    var otherLines = [];
    var channels = {};
    var seenAmazon = {};
    var seenOther = {};

    CHANNELS.forEach(function (ch) {
      var day = resolveDay(ch, date);
      channels[ch.id] = day;
      var amt = channelDestAmounts(day);
      d2cLines.push({
        key: ch.id,
        label: ch.label,
        spend: amt.d2c,
        kind: 'd2c',
        source: day.source,
        channel: ch.id,
        day: day
      });
      if (amt.amazon || day.amazon != null) {
        upsertLine(amazonLines, seenAmazon, {
          key: ch.id === 'bing' ? 'bing_amazon' : ch.id + '_amazon',
          label: ch.label + ' Amazon',
          spend: amt.amazon,
          kind: 'amazon',
          source: ch.merKey + '.amazon',
          note: day.campaign || day.notes || (ch.id === 'bing' ? BING_AMAZON_CAMPAIGN : '')
        });
      }
      if (amt.other) {
        upsertLine(otherLines, seenOther, {
          key: ch.id + '_other',
          label: ch.label + ' other',
          spend: amt.other,
          kind: 'other',
          source: ch.merKey + '.other'
        });
      }
    });

    var tt = tiktokSplitFor(date);
    if (tt.d2c != null) {
      d2cLines.push({
        key: 'tiktok_shopify',
        label: 'TikTok Shopify',
        spend: tt.d2c,
        kind: 'd2c',
        source: 'tiktok_ads.shopify_spend'
      });
    }
    if (tt.shop != null) {
      upsertLine(otherLines, seenOther, {
        key: 'tiktok_shop',
        label: 'TikTok Shop',
        spend: tt.shop,
        kind: 'other',
        source: 'tiktok_ads.shop_spend'
      });
    }
    if (tt.unallocated != null) {
      upsertLine(otherLines, seenOther, {
        key: 'unallocated',
        label: 'Unallocated',
        spend: tt.unallocated,
        kind: 'other',
        source: 'tiktok_ads.unallocated_spend'
      });
    }

    var applovin = advertisingSource(date, ['applovin', 'app_lovin']);
    if (applovin != null) {
      upsertLine(otherLines, seenOther, {
        key: 'applovin',
        label: 'AppLovin',
        spend: typeof applovin === 'object' ? num(nestedSpend(applovin)) : num(applovin),
        kind: 'other',
        source: 'advertising_sources.applovin'
      });
    }

    var whatnot = advertisingSource(date, ['whatnot']);
    if (whatnot != null) {
      upsertLine(otherLines, seenOther, {
        key: 'whatnot',
        label: 'Whatnot',
        spend: typeof whatnot === 'object' ? num(nestedSpend(whatnot)) : num(whatnot),
        kind: 'other',
        source: 'advertising_sources.whatnot'
      });
    }

    var contract = merContract(date);
    var nd = contract ? contract.nonD2c : [];
    nd.forEach(function (n) {
      if (!n.present) return;
      var line = {
        key: n.key,
        label: n.label,
        spend: n.spend,
        kind: n.kind,
        source: 'non_d2c.' + n.key,
        present: true
      };
      if (n.kind === 'amazon') upsertLine(amazonLines, seenAmazon, line);
      else upsertLine(otherLines, seenOther, line);
    });

    var d2cTotal = round2(d2cLines.reduce(function (a, l) { return a + num(l.spend); }, 0));
    var amazonTotal = round2(amazonLines.reduce(function (a, l) { return a + num(l.spend); }, 0));
    var otherTotal = round2(otherLines.reduce(function (a, l) { return a + num(l.spend); }, 0));
    return {
      d2c: d2cLines,
      amazon: amazonLines,
      other: otherLines,
      d2cTotal: d2cTotal,
      amazonTotal: amazonTotal,
      otherTotal: otherTotal,
      allTotal: round2(d2cTotal + amazonTotal + otherTotal),
      channels: channels
    };
  }

  function channelSpends(date) {
    var dest = destinationLines(date);
    var out = dest.channels;
    var shop = shopifyD2C(date);
    var contract = merContract(date);
    var d2c = contract && contract.d2cAdSpend != null ? contract.d2cAdSpend : dest.d2cTotal;
    var company = contract && contract.totalAdSpend != null ? contract.totalAdSpend : dest.allTotal;
    var mer = contract && contract.blendedMer != null
      ? contract.blendedMer
      : (d2c > 0 && shop > 0 ? shop / d2c : null);
    return {
      date: date,
      channels: out,
      totalAdSpend: company,
      allAdSpend: company,
      d2cAdSpend: d2c,
      shopifyD2C: shop,
      blendedMer: mer,
      nonD2c: contract ? contract.nonD2c : dest.other.concat(dest.amazon),
      destination: dest,
      contract: contract
    };
  }

  function setFeeds(id, file, mer, manual) {
    FEEDS[id] = FEEDS[id] || { file: null, mer: null, manual: null };
    FEEDS[id].file = file || null;
    FEEDS[id].mer = mer || null;
    FEEDS[id].manual = manual || null;
    if (mer) MER_DOC = mer;
  }

  function channelApi(id) {
    var ch = CHANNELS.filter(function (c) { return c.id === id; })[0];
    if (!ch) throw new Error('unknown channel ' + id);
    return {
      SOURCE_KEYS: ch.sourceKeys,
      num: num,
      emptyDay: emptyDay,
      nodeToDay: nodeToDay,
      dailyMapFromBlock: dailyMapFromBlock,
      snapshotFromBlock: snapshotFromBlock,
      pickSourceNode: function (sources) { return pickSourceNode(sources, ch); },
      mergeDays: function () { return mergeDaysFor(ch); },
      latestDay: function (days) { return latestDayFor(ch, days); },
      applyReportTotals: function (days) { return applyReportTotalsFor(ch, days); },
      applyPartialTotals: function (days) { return applyPartialTotalsFor(ch, days); },
      ensureBingOnPartials: function (days) { return ensureOnPartials(ch, days); },
      ensureOnPartials: function (days) { return ensureOnPartials(ch, days); },
      applyAll: function (days) { return applyChannel(ch, days); },
      _setFeeds: function (feed, mer, manual) { setFeeds(ch.id, feed, mer, manual); }
    };
  }

  function injectCss() {
    if (document.getElementById('pc-module-css')) return;
    var css = ''
      + '.pc-wrap{margin:0 0 16px;padding:14px 16px;background:linear-gradient(135deg,rgba(0,132,255,.08),rgba(0,212,212,.04));border:1px solid rgba(0,132,255,.28);border-radius:8px}'
      + '.pc-title{font-size:.72rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--cyan,#00d4d4);margin:0 0 8px}'
      + '.pc-sub{color:var(--text-muted,#8888a8);font-size:.82rem;margin-bottom:12px}'
      + '.pc-table{width:100%;font-size:.82rem;border-collapse:collapse}'
      + '.pc-table th{color:var(--text-dim,#5c5c7a);font-size:.65rem;letter-spacing:.08em;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid var(--border,#252548);text-align:right}'
      + '.pc-table th:first-child,.pc-table td:first-child{text-align:left}'
      + '.pc-table td{padding:7px 8px;border-bottom:1px solid var(--border,#252548);font-family:var(--font-mono,ui-monospace,monospace)}'
      + '.pc-table tr.pc-total td{font-weight:700;border-top:2px solid var(--border,#252548)}'
      + '.pc-table tr.pc-split td,.pc-table tr.pc-nond2c td{color:var(--text-muted,#8888a8);font-weight:400}'
      + '.pc-table tr.pc-section td{font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim,#5c5c7a);padding-top:12px}'
      + '.pc-unverified{color:var(--yellow,#f59e0b);font-size:.78rem;font-weight:600;letter-spacing:0}'
      + '.pc-kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}'
      + '.pc-kpi-row.pc-kpi-totals{grid-template-columns:repeat(4,1fr)}'
      + '.pc-kpi-card{background:var(--card,#171730);border:1px solid var(--border,#252548);border-radius:8px;padding:16px 16px 14px}'
      + '.pc-kpi-label{font-size:.65rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim,#5c5c7a);margin-bottom:8px}'
      + '.pc-kpi-val{font-family:var(--font-mono,ui-monospace,monospace);font-size:1.35rem;font-weight:700;color:var(--text,#e8e8f0);line-height:1}'
      + '.pc-kpi-sub{margin-top:6px;font-size:.72rem;color:var(--text-muted,#8888a8)}'
      + '.pc-box{background:var(--surface,#131328);border:1px solid var(--border,#252548);border-radius:8px;padding:16px 18px;margin-bottom:16px}'
      + '.pc-form{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;align-items:end}'
      + '.pc-form label{display:block;font-size:.65rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#5c5c7a);margin-bottom:4px}'
      + '.pc-form input{width:100%;background:var(--card,#171730);color:var(--text,#e8e8f0);border:1px solid var(--border,#252548);border-radius:6px;padding:8px 10px;font-family:var(--font-mono,ui-monospace,monospace);font-size:.85rem}'
      + '.pc-btn{background:var(--cyan,#00d4d4);color:#0d0d1a;border:none;border-radius:6px;padding:8px 14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:.72rem;cursor:pointer}'
      + '@media (max-width:768px){.pc-kpi-row,.pc-form{grid-template-columns:repeat(2,1fr)}}';
    var st = document.createElement('style');
    st.id = 'pc-module-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function ensureTab(ch) {
    var panel = document.getElementById('tab-' + ch.tabKey);
    if (!panel) {
      var reports = document.getElementById('tab-reports');
      panel = document.createElement('div');
      panel.id = 'tab-' + ch.tabKey;
      panel.className = 'tab-content';
      if (reports && reports.parentNode) reports.parentNode.insertBefore(panel, reports.nextSibling);
      else document.body.appendChild(panel);
    }
    var existingBtn = document.querySelector('.tab[data-tab="' + ch.tabKey + '"]');
    if (!existingBtn) {
      var after = document.querySelector('.tab[data-tab="chatgpt_ads"]') || document.querySelector('.tab[data-tab="reports"]');
      if (after && after.parentNode) {
        var btn = document.createElement('div');
        btn.className = 'tab';
        btn.setAttribute('data-tab', ch.tabKey);
        btn.textContent = ch.tabLabel;
        after.parentNode.appendChild(btn);
        existingBtn = btn;
      }
    }
    if (existingBtn && !existingBtn._pcBound) {
      existingBtn._pcBound = true;
      existingBtn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
        document.body.classList.remove('reports-active');
        existingBtn.classList.add('active');
        var p = document.getElementById('tab-' + ch.tabKey);
        if (p) p.classList.add('active');
        renderChannelTab(ch);
      });
    }
  }

  function kpiRow(day, note, ch) {
    var unverified = isTrackingUnverified(day, ch);
    var valClass = function (kind) {
      return unverified && (kind === 'conversions' || kind === 'revenue' || kind === 'roas') ? ' pc-unverified' : '';
    };
    return ''
      + '<div class="pc-kpi-row">'
      + '<div class="pc-kpi-card"><div class="pc-kpi-label">Daily spend</div><div class="pc-kpi-val">' + usd(day.spend) + '</div><div class="pc-kpi-sub">' + esc(note) + '</div></div>'
      + '<div class="pc-kpi-card"><div class="pc-kpi-label">Clicks</div><div class="pc-kpi-val">' + (day.hasFeed && day.hasClicks ? intOrDash(day.clicks) : '—') + '</div><div class="pc-kpi-sub">' + (day.hasFeed ? 'From feed when published' : 'no feed') + '</div></div>'
      + '<div class="pc-kpi-card"><div class="pc-kpi-label">Conversions</div><div class="pc-kpi-val' + valClass('conversions') + '">' + esc(outcomeTxt(day, 'conversions', ch)) + '</div><div class="pc-kpi-sub">' + (unverified ? TRACKING_UNVERIFIED : 'Where published') + '</div></div>'
      + '<div class="pc-kpi-card"><div class="pc-kpi-label">Revenue</div><div class="pc-kpi-val' + valClass('revenue') + '">' + esc(outcomeTxt(day, 'revenue', ch)) + '</div><div class="pc-kpi-sub">' + (unverified ? TRACKING_UNVERIFIED : 'Attributed conversion value') + '</div></div>'
      + '<div class="pc-kpi-card"><div class="pc-kpi-label">ROAS</div><div class="pc-kpi-val' + valClass('roas') + '">' + esc(outcomeTxt(day, 'roas', ch)) + '</div><div class="pc-kpi-sub">' + (unverified ? TRACKING_UNVERIFIED : 'Revenue ÷ spend') + '</div></div>'
      + '</div>';
  }

  function renderStrip() {
    var slot = document.getElementById('paid-channels-daily');
    if (!slot) {
      var yday = document.getElementById('yday-bar');
      if (!yday || !yday.parentNode) return;
      slot = document.createElement('div');
      slot.id = 'paid-channels-daily';
      yday.parentNode.insertBefore(slot, yday.nextSibling);
    }
    var old = document.getElementById('bing-ads-daily');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var date = latestFocusDate();
    var summary = channelSpends(date);
    var dest = summary.destination || { d2c: [], amazon: [], other: [] };
    var mer = summary.blendedMer == null ? '—' : Number(summary.blendedMer).toFixed(2) + 'x';

    function channelRow(ch, d) {
      var src = d.hasFeed ? d.source : 'no feed';
      if (d.tracking_verified === false) src = (src ? src + ' · ' : '') + 'tracking_verified:false';
      var html = '<tr>'
        + '<td>' + esc(ch.label) + '</td>'
        + '<td>' + usd(d.spend) + '</td>'
        + '<td>' + (d.hasFeed && d.hasClicks ? intOrDash(d.clicks) : '—') + '</td>'
        + '<td class="' + (isTrackingUnverified(d, ch) ? 'pc-unverified' : '') + '">' + esc(outcomeTxt(d, 'conversions', ch)) + '</td>'
        + '<td class="' + (isTrackingUnverified(d, ch) ? 'pc-unverified' : '') + '">' + esc(outcomeTxt(d, 'revenue', ch)) + '</td>'
        + '<td class="' + (isTrackingUnverified(d, ch) ? 'pc-unverified' : '') + '">' + esc(outcomeTxt(d, 'roas', ch)) + '</td>'
        + '<td>' + esc(src) + '</td>'
        + '</tr>';
      if (d.d2c != null || d.amazon != null || d.other != null) {
        if (d.d2c != null) {
          html += '<tr class="pc-split"><td>↳ ' + esc(ch.label) + ' D2C</td><td>' + usd(d.d2c) + '</td><td colspan="5">' + esc(ch.merKey) + '.d2c · counts in D2C ad spend</td></tr>';
        }
      }
      return html;
    }

    var d2cRows = CHANNELS.map(function (ch) {
      return channelRow(ch, summary.channels[ch.id]);
    }).join('');
    dest.d2c.forEach(function (line) {
      if (CHANNELS.some(function (ch) { return ch.id === line.key; })) return;
      d2cRows += '<tr class="pc-split"><td>' + esc(line.label) + '</td><td>' + usd(line.spend) + '</td><td colspan="5">' + esc(line.source || 'D2C') + ' · counts in D2C ad spend</td></tr>';
    });

    var amazonRows = dest.amazon.map(function (n) {
      var note = n.note ? ' · ' + n.note : '';
      return '<tr class="pc-nond2c"><td>' + esc(n.label) + '</td><td>' + usd(n.spend) + '</td><td colspan="5">' + esc(n.source || 'amazon') + esc(note) + ' · in All ad spend, excluded from D2C / blended MER</td></tr>';
    }).join('');

    var otherRows = dest.other.map(function (n) {
      return '<tr class="pc-nond2c"><td>' + esc(n.label) + '</td><td>' + usd(n.spend) + '</td><td colspan="5">' + esc(n.source || 'other') + ' · in All ad spend, excluded from D2C / blended MER</td></tr>';
    }).join('');

    var contractNote = summary.contract
      ? ('mer_for_manus.json · source ' + summary.contract.source + ' · as_of ' + (summary.contract.as_of || date))
      : ((date || 'no dated feed') + ' · missing channel = $0 / no feed');

    slot.className = 'pc-wrap';
    slot.innerHTML = ''
      + '<div class="pc-title">Paid channels · ad spend</div>'
      + '<div class="pc-sub">' + esc(contractNote) + ' · D2C ad spend is Shopify-bound only (TikTok Shopify share included). Amazon-bound and other non-D2C sit in All ad spend and are excluded from blended MER.</div>'
      + '<div class="pc-kpi-row pc-kpi-totals">'
      + '<div class="pc-kpi-card"><div class="pc-kpi-label">D2C ad spend</div><div class="pc-kpi-val">' + usd(summary.d2cAdSpend) + '</div><div class="pc-kpi-sub">vs Shopify D2C → blended MER</div></div>'
      + '<div class="pc-kpi-card"><div class="pc-kpi-label">Shopify D2C revenue</div><div class="pc-kpi-val">' + usd(summary.shopifyD2C) + '</div><div class="pc-kpi-sub">Shopify channel only</div></div>'
      + '<div class="pc-kpi-card"><div class="pc-kpi-label">Blended MER</div><div class="pc-kpi-val">' + esc(mer) + '</div><div class="pc-kpi-sub">Shopify D2C ÷ D2C ad spend</div></div>'
      + '<div class="pc-kpi-card"><div class="pc-kpi-label">All ad spend</div><div class="pc-kpi-val">' + usd(summary.allAdSpend) + '</div><div class="pc-kpi-sub">company · D2C + Amazon-bound + other</div></div>'
      + '</div>'
      + '<table class="pc-table"><thead><tr><th>Channel</th><th>Spend</th><th>Clicks</th><th>Conv.</th><th>Revenue</th><th>ROAS</th><th>Source</th></tr></thead><tbody>'
      + '<tr class="pc-section"><td colspan="7">D2C (Shopify)</td></tr>'
      + d2cRows
      + (amazonRows ? '<tr class="pc-section"><td colspan="7">Amazon-bound</td></tr>' + amazonRows : '')
      + (otherRows ? '<tr class="pc-section"><td colspan="7">Other non-D2C</td></tr>' + otherRows : '')
      + '<tr class="pc-total"><td>D2C ad spend</td><td>' + usd(summary.d2cAdSpend) + '</td><td colspan="5">d2c_ad_spend · vs Shopify revenue → blended MER</td></tr>'
      + '<tr class="pc-total"><td>Shopify D2C revenue</td><td>' + usd(summary.shopifyD2C) + '</td><td colspan="5">Shopify channel only</td></tr>'
      + '<tr class="pc-total"><td>Blended MER</td><td>' + esc(mer) + '</td><td colspan="5">blended_mer · Shopify D2C ÷ D2C ad spend</td></tr>'
      + '<tr class="pc-total"><td>All ad spend</td><td>' + usd(summary.allAdSpend) + '</td><td colspan="5">total_ad_spend · company (includes Amazon-bound + Whatnot / AppLovin / other)</td></tr>'
      + '</tbody></table>';
  }

  function renderChannelTab(ch) {
    var c = document.getElementById('tab-' + ch.tabKey);
    if (!c) return;
    var days = mergeDaysFor(ch);
    var day = latestDayFor(ch, days);
    var rows = Object.keys(days).sort().reverse().map(function (date) { return days[date]; });
    var merB = merBlockFor(ch);
    var merNote = merB
      ? ('mer_for_manus.json has a ' + ch.merKey + ' block')
      : ('mer_for_manus.json has no ' + ch.merKey + ' block (no feed → $0)');
    var statusLine = day.hasFeed
      ? (day.spend > 0 ? 'Feed reporting. D2C share counts in D2C ad spend / blended MER; Amazon / other share counts in All ad spend only.' : 'Feed present at $0.')
      : 'No feed yet. Showing $0 / no feed — numbers are not invented.';
    if (isTrackingUnverified(day, ch)) {
      statusLine += ' Conversion tracking is known-broken — conversions / revenue / ROAS show as tracking not verified, not 0.';
    }
    var splitNote = '';
    if (day.d2c != null || day.amazon != null || day.other != null) {
      splitNote = ch.merKey + '.d2c ' + usd(day.d2c) + ' + ' + ch.merKey + '.amazon ' + usd(day.amazon) + (day.other != null ? ' + ' + ch.merKey + '.other ' + usd(day.other) : '') + ' = ' + usd(day.spend);
    }
    if (ch.id === 'bing') {
      splitNote = (splitNote ? splitNote + ' · ' : '') + 'main campaign \'' + (day.campaign || BING_AMAZON_CAMPAIGN) + '\' sends to Amazon, not Shopify';
    }

    c.innerHTML = ''
      + '<div class="pc-title" style="margin-top:0">' + esc(ch.label) + '</div>'
      + '<div class="pc-sub">' + esc(statusLine) + ' · ' + esc(merNote) + (splitNote ? ' · ' + esc(splitNote) : '') + '</div>'
      + kpiRow(day, day.hasFeed ? (day.date ? ('As of ' + day.date) : 'Feed snapshot') : 'no feed', ch)
      + '<div class="pc-title">Daily history</div>'
      + '<div class="pc-box">'
      + (rows.length
        ? ('<table class="pc-table"><thead><tr><th>Date</th><th>Spend</th><th>Clicks</th><th>Conversions</th><th>Revenue</th><th>ROAS</th><th>Source</th></tr></thead><tbody>'
          + rows.map(function (r) {
            return '<tr><td>' + esc(r.date || '—') + '</td><td>' + usd(r.spend) + '</td><td>' + intOrDash(r.clicks) + '</td><td class="' + (isTrackingUnverified(r, ch) ? 'pc-unverified' : '') + '">' + esc(outcomeTxt(r, 'conversions', ch)) + '</td><td class="' + (isTrackingUnverified(r, ch) ? 'pc-unverified' : '') + '">' + esc(outcomeTxt(r, 'revenue', ch)) + '</td><td class="' + (isTrackingUnverified(r, ch) ? 'pc-unverified' : '') + '">' + esc(outcomeTxt(r, 'roas', ch)) + '</td><td>' + esc(r.source) + '</td></tr>';
          }).join('')
          + '</tbody></table>')
        : '<div class="pc-sub" style="margin:0">No dated rows. Empty / no-feed state until the data repo publishes <code>advertising_sources.' + esc(ch.id) + '</code> or <code>mer_for_manus.json</code> → <code>' + esc(ch.merKey) + '</code>.</div>')
      + '</div>'
      + '<div class="pc-title">Manual daily number</div>'
      + '<div class="pc-box">'
      + '<div class="pc-sub">Browser-only (localStorage). Durable path: <code>' + esc(ch.file) + '</code> or the data-repo <code>' + esc(ch.merKey) + '</code> block. Reporting only — no API credentials on this Pages site.</div>'
      + '<form class="pc-form" data-pc-ch="' + esc(ch.id) + '">'
      + '<div><label>Date</label><input name="date" type="date" required></div>'
      + '<div><label>Spend</label><input name="spend" type="number" min="0" step="0.01" value="0"></div>'
      + '<div><label>Clicks</label><input name="clicks" type="number" min="0" step="1" value="0"></div>'
      + '<div><label>Conversions</label><input name="conversions" type="number" min="0" step="1" value="0"></div>'
      + '<div><label>Revenue</label><input name="revenue" type="number" min="0" step="0.01" value="0"></div>'
      + '<div><button class="pc-btn" type="submit">Save day</button></div>'
      + '</form></div>';

    var form = c.querySelector('form[data-pc-ch="' + ch.id + '"]');
    if (form) {
      var iso = new Date().toISOString().slice(0, 10);
      form.date.value = (day.date && /^\d{4}-\d{2}-\d{2}$/.test(day.date)) ? day.date : iso;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var payload = FEEDS[ch.id].manual && typeof FEEDS[ch.id].manual === 'object' ? FEEDS[ch.id].manual : { by_date: {}, source: 'manual' };
        payload.by_date = payload.by_date || {};
        payload.by_date[form.date.value] = {
          spend: num(form.spend.value),
          clicks: num(form.clicks.value),
          conversions: num(form.conversions.value),
          revenue: num(form.revenue.value),
          status: num(form.spend.value) > 0 ? 'ok' : 'zero'
        };
        payload.as_of = form.date.value;
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem('coldest_' + ch.id + '_manual', JSON.stringify(payload));
        } catch (err) { /* ignore */ }
        FEEDS[ch.id].manual = payload;
        bootFromState();
        renderChannelTab(ch);
      });
    }
  }

  function rerenderDashboard() {
    ['renderYesterday', 'renderYesterdayPie', 'render30DayAverages', 'renderReports'].forEach(function (fn) {
      try { if (typeof root[fn] === 'function') root[fn](); } catch (e) { /* non-fatal */ }
    });
  }

  function bootFromState() {
    CHANNELS.forEach(function (ch) {
      applyChannel(ch, mergeDaysFor(ch));
    });
    renderStrip();
    CHANNELS.forEach(function (ch) {
      var tab = document.getElementById('tab-' + ch.tabKey);
      if (tab && tab.classList.contains('active')) renderChannelTab(ch);
    });
    rerenderDashboard();
    renderStrip();
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status)); });
  }

  function loadManual(ch) {
    try {
      if (typeof localStorage === 'undefined') return null;
      var raw = localStorage.getItem('coldest_' + ch.id + '_manual');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saBoot() {
    injectCss();
    CHANNELS.forEach(ensureTab);
    if (typeof root.renderChatGptAds !== 'function') {
      root.renderChatGptAds = function () { renderChannelTab(CHANNELS.filter(function (c) { return c.id === 'chatgpt'; })[0]); };
    }
    CHANNELS.forEach(function (ch) { FEEDS[ch.id].manual = loadManual(ch); });
    var jobs = [fetchJson('mer_for_manus.json').then(function (d) { MER_DOC = d; }).catch(function () { MER_DOC = null; })];
    CHANNELS.forEach(function (ch) {
      jobs.push(fetchJson(ch.file).then(function (d) { FEEDS[ch.id].file = d; }).catch(function () { FEEDS[ch.id].file = null; }));
    });
    Promise.allSettled(jobs).then(function () {
      bootFromState();
      CHANNELS.forEach(function (ch) {
        var tab = document.getElementById('tab-' + ch.tabKey);
        if (tab) renderChannelTab(ch);
      });
    });
  }

  var api = {
    CHANNELS: CHANNELS,
    num: num,
    emptyDay: emptyDay,
    nodeToDay: nodeToDay,
    dailyMapFromBlock: dailyMapFromBlock,
    snapshotFromBlock: snapshotFromBlock,
    pickSourceNode: pickSourceNode,
    mergeDaysFor: mergeDaysFor,
    latestDayFor: latestDayFor,
    ensureOnPartials: ensureOnPartials,
    applyPartialTotalsFor: applyPartialTotalsFor,
    applyReportTotalsFor: applyReportTotalsFor,
    applyChannel: applyChannel,
    channelSpends: channelSpends,
    shopifyD2C: shopifyD2C,
    latestFocusDate: latestFocusDate,
    channelApi: channelApi,
    setFeeds: setFeeds,
    bingSplit: bingSplit,
    destinationSplit: destinationSplit,
    destinationLines: destinationLines,
    BING_AMAZON_CAMPAIGN: BING_AMAZON_CAMPAIGN,
    merContract: merContract,
    parseNonD2c: parseNonD2c,
    isTrackingUnverified: isTrackingUnverified,
    outcomeTxt: outcomeTxt,
    TRACKING_UNVERIFIED: TRACKING_UNVERIFIED,
    _setMerDoc: function (doc) { MER_DOC = doc || null; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PaidChannels = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(saBoot, 0); });
    } else {
      setTimeout(saBoot, 0);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
