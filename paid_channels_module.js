/* =====================================================================
   COLDEST · PAID CHANNELS  (Meta, Google, Bing, Reddit, Snapchat, ChatGPT, Pinterest, X, Taboola, Outbrain, Spotify)
   ---------------------------------------------------------------------
   Reporting-only. No API credentials. Missing feed → $0 / "no feed".
   Never invents clicks, conversions, revenue, or spend.

   Per-channel feed order (same as Bing):
     1. PARTIAL_REPORTS[].advertising_sources.<aliases>
        or mer_for_manus.json advertising_sources[YYYY-MM-DD].<aliases>
     2. advertising_sources_daily.json / <channel>_ads_daily.json (CFO export)
     3. mer_for_manus.json <channel> block  (exact keys: bing, reddit, snapchat, chatgpt, pinterest; x, taboola, outbrain and spotify are display-only)
     4. optional <channel>_ads_data.json (empty pre_launch / no_feed stubs ignored)
     5. localStorage manual day (channel tabs)
   A missing mer.x / unpublished Taboola-Outbrain-X day is "missing", not $0.
   An unmeasured Spotify Ads (spotify_ads) day reads "No data" — never $0, never added to D2C spend.

   mer_for_manus.json daily_inputs contract (match these keys exactly):
     d2c_ad_spend, blended_mer, total_ad_spend,
     bing.{spend,d2c,amazon}, reddit, snapchat, chatgpt (tracking_verified),
     pinterest.{spend,spend_d2c,clicks,conversions,revenue,roas,*_7d,attribution_window,live,status,source,as_of},
     non_d2c.{whatnot,applovin,tiktok_shop,sellerboard_amazon,unallocated}

   Destination split (d2c vs amazon/other) is per channel:
     D2C ad spend  = Shopify-bound paid media (Meta, Google, Bing D2C,
                     Reddit, Snapchat, ChatGPT, Pinterest, TikTok shopify_spend).
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
    { id: 'chatgpt', label: 'ChatGPT Ads', tabKey: 'chatgpt_ads', tabLabel: 'CHATGPT ADS', merKey: 'chatgpt', file: 'chatgpt_ads_data.json', sourceKeys: ['chatgpt', 'chatgpt_ads', 'openai_ads'], pipelineDefault: false, tabExists: true },
    { id: 'pinterest', label: 'Pinterest Ads', tabKey: 'pinterest_ads', tabLabel: 'PINTEREST ADS', merKey: 'pinterest', file: 'pinterest_ads_data.json', sourceKeys: ['pinterest_ads', 'pinterest'], pipelineDefault: false }
  ];

  var NON_D2C_LINES = [
    { keys: ['whatnot'], label: 'Whatnot', kind: 'other' },
    { keys: ['applovin'], label: 'AppLovin', kind: 'other' },
    { keys: ['tiktok_shop', 'TikTok Shop', 'tiktok_shop_ads'], label: 'TikTok Shop', kind: 'other' },
    { keys: ['unallocated', 'unallocated_ads', 'tiktok_unallocated'], label: 'Unallocated', kind: 'other' },
    { keys: ['sellerboard_amazon', 'amazon_ads', 'Sellerboard Amazon', 'sellerboard'], label: 'Sellerboard Amazon', kind: 'amazon' },
    { keys: ['bing_amazon'], label: 'Bing Amazon', kind: 'amazon' }
  ];

  var BING_AMAZON_CAMPAIGN = 'bing to amz tumbler listing 1';

  var FEEDS = {};
  CHANNELS.forEach(function (ch) {
    FEEDS[ch.id] = { file: null, mer: null, manual: null, daily: null };
  });
  var MER_DOC = null;
  var ADV_DAILY = null;
  var SPOTIFY_CONFIG = null;

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

  var REVENUE_DISPLAY = [
    { id: 'shopify', label: 'Shopify', keys: ['shopify', 'shop', 'd2c'] },
    { id: 'amazon', label: 'Amazon', keys: ['amazon', 'amz'] },
    { id: 'tiktok', label: 'TikTok', keys: ['tiktok', 'tiktok_shop'] },
    { id: 'whatnot', label: 'Whatnot', keys: ['whatnot'] }
  ];

  function isDateKeyedMap(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    var keys = Object.keys(obj);
    if (!keys.length) return false;
    return keys.every(function (k) { return /^\d{4}-\d{2}-\d{2}$/.test(k); });
  }

  function mapForDate(obj, date, asOf) {
    if (!obj || typeof obj !== 'object') return null;
    if (isDateKeyedMap(obj)) return obj[date] || null;
    // Flat as-of snapshot. Never apply it to unrelated dates.
    if (asOf && date && date !== asOf) return null;
    return obj;
  }

  function pickKeyed(map, keys) {
    if (!map || typeof map !== 'object' || !keys) return undefined;
    for (var i = 0; i < keys.length; i++) {
      if (Object.prototype.hasOwnProperty.call(map, keys[i])) return map[keys[i]];
    }
    return undefined;
  }

  function publishedAmount(node, fields) {
    if (node === undefined) return { published: false, value: null };
    if (node === null || node === false || node === '') return { published: false, value: null };
    if (typeof node === 'number' || typeof node === 'string') {
      var n0 = Number(node);
      if (!Number.isFinite(n0)) return { published: false, value: null };
      return { published: true, value: n0 };
    }
    if (typeof node !== 'object') return { published: false, value: null };
    if (node.data_available === false || node.zero_assumed === true) return { published: false, value: null };
    if (node.status === 'missing' || node.status === 'no_feed' || node.status === 'unpublished') {
      return { published: false, value: null };
    }
    var names = fields || ['spend', 'revenue', 'amount', 'value', 'total'];
    for (var i = 0; i < names.length; i++) {
      if (node[names[i]] != null && node[names[i]] !== '') {
        var n = Number(node[names[i]]);
        if (Number.isFinite(n)) return { published: true, value: n };
      }
    }
    return { published: false, value: null };
  }

  function channelRevenueRows(r) {
    r = r || {};
    var rows = [];
    var src = mapForDate(r.channel_revenue, r.date);
    if (src) {
      REVENUE_DISPLAY.forEach(function (ch) {
        var amt = publishedAmount(pickKeyed(src, ch.keys), ['revenue', 'amount', 'value', 'total']);
        rows.push({ label: ch.label, value: amt.published ? usd(amt.value) : 'missing' });
      });
      return rows;
    }
    if (r.channel_observations) {
      REVENUE_DISPLAY.forEach(function (ch) {
        var c = r.channel_observations[ch.id];
        if (!c || c.data_available === false || c.zero_assumed || c.revenue == null) {
          rows.push({ label: ch.label, value: 'missing' });
          return;
        }
        rows.push({ label: ch.label, value: usd(c.revenue) });
      });
      return rows;
    }
    if (r.direct_breakdown) {
      Object.keys(r.direct_breakdown).forEach(function (k) {
        var c = r.direct_breakdown[k];
        rows.push({
          label: String(k).toUpperCase(),
          value: c && c.revenue != null ? usd(c.revenue) : 'missing'
        });
      });
      return rows;
    }
    rows.push({
      label: r.date >= '2026-04-07' ? 'Shopify' : 'Shopify/TikTok',
      value: r.shop_revenue == null ? 'missing' : usd(r.shop_revenue)
    });
    rows.push({ label: 'Amazon', value: r.amz_revenue == null ? 'missing' : usd(r.amz_revenue) });
    if (r.date >= '2026-04-07') {
      rows.push({ label: 'TikTok', value: r.tiktok_revenue == null ? 'missing' : usd(r.tiktok_revenue) });
    }
    if (r.whatnot_revenue != null) {
      rows.push({ label: 'Whatnot', value: usd(r.whatnot_revenue) });
    }
    return rows;
  }

  function reportForDate(date) {
    var lists = [hostArray('PARTIAL_REPORTS'), hostArray('REPORTS')];
    for (var i = 0; i < lists.length; i++) {
      var arr = lists[i];
      if (!arr) continue;
      for (var j = 0; j < arr.length; j++) {
        if (arr[j] && arr[j].date === date) return arr[j];
      }
    }
    return null;
  }

  function spendFromChannelAdSpend(ch, date) {
    var r = reportForDate(date);
    var map = r && r.channel_ad_spend;
    if (!map) map = MER_DOC && mapForDate(MER_DOC.channel_ad_spend, date, MER_DOC.as_of);
    else map = mapForDate(map, date);
    if (!map) return null;
    var keys = ((ch && ch.sourceKeys) || []).concat(ch ? [ch.id, ch.merKey] : []);
    var node = pickKeyed(map, keys);
    if (node === undefined) return null;
    var amt = publishedAmount(node, ['spend', 'daily_spend', 'ad_spend', 'amount']);
    if (!amt.published) return emptyDay(date);
    var rich = null;
    var src = MER_DOC && MER_DOC.advertising_sources && MER_DOC.advertising_sources[date];
    if (src) {
      var picked = pickSourceNode(src, ch);
      if (picked && !isPlaceholderNode(picked.node)) rich = picked.node;
    }
    if (!rich) {
      var merB = (ch && ((FEEDS[ch.id] && FEEDS[ch.id].mer && FEEDS[ch.id].mer[ch.merKey]) || (MER_DOC && MER_DOC[ch.merKey]))) || null;
      if (merB && !isPlaceholderNode(merB)) {
        var by = merB.by_date || merB.by_day;
        if (by && by[date] && !isPlaceholderNode(by[date])) rich = by[date];
        else {
          var snap = snapshotFromBlock(merB, 'mer_for_manus.json#' + (ch.merKey || ch.id));
          if (snap && snap.date === date) rich = merB;
        }
      }
    }
    var base = (typeof node === 'object') ? node : (rich && typeof rich === 'object' ? rich : { spend: amt.value });
    var day = nodeToDay(date, base, 'channel_ad_spend');
    day.spend = round2(amt.value);
    day.hasFeed = true;
    if (typeof node !== 'object' && rich && typeof rich === 'object') {
      if (rich.clicks != null) { day.clicks = num(rich.clicks); day.hasClicks = true; }
      if (hasDestinationFields(rich)) {
        var split = destinationSplit(rich);
        day.d2c = split.d2c;
        day.amazon = split.amazon;
        day.other = split.other;
        if (split.destination) day.destination = split.destination;
      }
    }
    return day;
  }

  function mergeOverlayRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return false;
    var g = typeof globalThis !== 'undefined' ? globalThis : root;
    var partials = hostArray('PARTIAL_REPORTS');
    if (!partials) {
      g.PARTIAL_REPORTS = [];
      partials = g.PARTIAL_REPORTS;
    }
    var changed = false;
    rows.forEach(function (row) {
      if (!row || !row.date) return;
      var idx = -1;
      for (var i = 0; i < partials.length; i++) {
        if (partials[i] && partials[i].date === row.date) { idx = i; break; }
      }
      if (idx === -1) partials.push(row);
      else partials[idx] = Object.assign({}, partials[idx], row);
      changed = true;
    });
    return changed;
  }

  function hydratePartialFromMer(mer) {
    mer = mer || MER_DOC;
    if (!mer || !mer.as_of || !/^\d{4}-\d{2}-\d{2}$/.test(mer.as_of)) return false;
    var date = mer.as_of;
    if (reportForDate(date)) return false;
    var fromMerPartials = Array.isArray(mer.partial_reports)
      ? mer.partial_reports.filter(function (r) { return r && r.date === date; })
      : [];
    if (fromMerPartials.length) return mergeOverlayRows(fromMerPartials);
    var adv = mer.advertising_sources && mer.advertising_sources[date];
    var rev = mapForDate(mer.channel_revenue, date, mer.as_of);
    var spend = mapForDate(mer.channel_ad_spend, date, mer.as_of);
    if (!adv && !rev && !spend) return false;
    var row = {
      date: date,
      report_status: 'partial',
      source_mode: 'partial_v1',
      channel_revenue: rev || undefined,
      channel_ad_spend: spend || undefined,
      advertising_sources: adv || {},
      channel_observations: mer.channel_observations || {},
      provisional_totals: {},
      calculation_basis: 'mer_as_of'
    };
    if (!row.channel_revenue && mer.shop_revenue != null) {
      row.channel_revenue = { shopify: mer.shop_revenue };
    }
    return mergeOverlayRows([row]);
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

  function finiteNum(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function isPlaceholderNode(node) {
    if (node == null || node === false) return true;
    if (typeof node !== 'object') return false;
    if (node.missing === true || node.data_available === false || node.zero_assumed === true) return true;
    var st = node.status != null ? String(node.status) : '';
    if (st === 'missing' || st === 'no_feed' || st === 'unpublished' || st === 'no_data') return true;
    if (st === 'pre_launch' && (finiteNum(node.spend) == null || finiteNum(node.spend) === 0) && !node.complete && !(Array.isArray(node.daily) && node.daily.length)) return true;
    return (st === 'no_feed' || node.source === 'no feed' || node.source === 'none') && (finiteNum(node.spend) == null || finiteNum(node.spend) === 0);
  }

  // Same measured-zero rule as ad_channels_module.js. Bare {spend:0} is missing.
  function isMeasuredZero(node) {
    if (node == null) return false;
    if (typeof node === 'number' || typeof node === 'string') return finiteNum(node) === 0;
    if (typeof node !== 'object') return false;
    if (isPlaceholderNode(node)) return false;
    var s = finiteNum(node.spend);
    if (s == null) s = finiteNum(node.daily_spend);
    if (s == null) s = finiteNum(node.ad_spend);
    if (s == null) s = finiteNum(node.shopify_spend);
    if (s !== 0) return false;
    if (node.complete === true || node.closed_day === true) return true;
    if (node.spend_status === 'verified') return true;
    var st = node.status != null ? String(node.status) : '';
    if (node.live === false && (st === 'not_live' || st === 'pre_launch' || st === 'not_launched' || st === 'dark')) return true;
    return false;
  }

  function spendIsPublished(node) {
    if (node == null || isPlaceholderNode(node)) return false;
    if (typeof node === 'number' || typeof node === 'string') return finiteNum(node) != null;
    var s = finiteNum(node.spend);
    if (s == null) s = finiteNum(node.daily_spend);
    if (s == null) s = finiteNum(node.ad_spend);
    if (s == null) s = finiteNum(node.shopify_spend);
    if (s == null) return false;
    if (s === 0) return isMeasuredZero(node);
    return true;
  }

  function pickSourceNode(sources, ch) {
    if (!sources || typeof sources !== 'object' || !ch) return null;
    var keys = (ch.sourceKeys || []).slice();
    Object.keys(sources).forEach(function (k) {
      var norm = String(k).toLowerCase().replace(/[\s-]+/g, '_');
      var hit = keys.some(function (sk) {
        var s = String(sk).toLowerCase();
        return s === String(k).toLowerCase() || s === norm || s.replace(/_ads$/, '') === norm.replace(/_ads$/, '');
      });
      if (hit && keys.indexOf(k) === -1) keys.push(k);
    });
    for (var i = 0; i < keys.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(sources, keys[i])) continue;
      if (sources[keys[i]] == null || isPlaceholderNode(sources[keys[i]])) continue;
      return { key: keys[i], node: sources[keys[i]] };
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
      || node.spend_d2c != null || node.spend_amazon != null
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
    var d2c = node.d2c != null ? nestedSpend(node.d2c)
      : (node.spend_d2c != null ? round2(node.spend_d2c)
        : (node.shopify_spend != null ? round2(node.shopify_spend) : null));
    var amazon = node.amazon != null ? nestedSpend(node.amazon)
      : (node.spend_amazon != null ? round2(node.spend_amazon) : null);
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
    if (node.attribution_window != null) d.attribution_window = node.attribution_window;
    if (node.live != null) d.live = !!node.live;
    if (node.spend_7d != null) d.spend_7d = round2(node.spend_7d);
    if (node.spend_d2c_7d != null) d.spend_d2c_7d = round2(node.spend_d2c_7d);
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
    function put(date, node) {
      if (!date || !spendIsPublished(node)) return;
      out[date] = nodeToDay(date, node, source);
    }
    if (Array.isArray(block.daily)) {
      block.daily.forEach(function (row) {
        if (!row || !row.date) return;
        put(row.date, row);
      });
    }
    var byDate = block.by_date || block.by_day;
    if (byDate && typeof byDate === 'object' && !Array.isArray(byDate)) {
      Object.keys(byDate).forEach(function (date) { put(date, byDate[date]); });
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

  function merAdvertisingSourcesDays(ch) {
    var src = MER_DOC && MER_DOC.advertising_sources;
    if (!src || typeof src !== 'object') return {};
    var out = {};
    Object.keys(src).forEach(function (date) {
      var day = src[date];
      if (!day || typeof day !== 'object' || Array.isArray(day)) return;
      var picked = pickSourceNode(day, ch);
      if (!picked || isPlaceholderNode(picked.node) || !spendIsPublished(picked.node)) return;
      out[date] = nodeToDay(date, picked.node, 'advertising_sources.' + picked.key);
    });
    return out;
  }

  function advertisingSourcesDailyDays(ch) {
    var src = ADV_DAILY;
    if (!src || typeof src !== 'object') return {};
    var map = src.advertising_sources && typeof src.advertising_sources === 'object' ? src.advertising_sources : src;
    var out = {};
    Object.keys(map).forEach(function (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      var day = map[date];
      if (!day || typeof day !== 'object' || Array.isArray(day)) return;
      var picked = pickSourceNode(day, ch);
      if (!picked || isPlaceholderNode(picked.node) || !spendIsPublished(picked.node)) return;
      out[date] = nodeToDay(date, picked.node, 'advertising_sources_daily.json');
    });
    return out;
  }

  function mergeDaysFor(ch) {
    var days = {};
    var file = FEEDS[ch.id].file;
    var merB = merBlockFor(ch);
    if (file && !isPlaceholderNode(file)) Object.assign(days, dailyMapFromBlock(file, ch.file));
    Object.assign(days, merAdvertisingSourcesDays(ch));
    Object.assign(days, dailyMapFromBlock(merB, 'mer_for_manus.json#' + ch.merKey));
    var snap = snapshotFromBlock(merB, 'mer_for_manus.json#' + ch.merKey);
    if (snap && snap.date && !isPlaceholderNode(merB)) days[snap.date] = snap;
    Object.assign(days, advertisingSourcesDailyDays(ch));
    var dailyDoc = (FEEDS[ch.id] && FEEDS[ch.id].daily) || null;
    if (dailyDoc && !isPlaceholderNode(dailyDoc)) Object.assign(days, dailyMapFromBlock(dailyDoc, ch.id + '_ads_daily.json'));
    Object.assign(days, dailyMapFromBlock(FEEDS[ch.id].manual, 'manual'));

    var partials = hostArray('PARTIAL_REPORTS');
    if (partials) {
      partials.forEach(function (r) {
        var picked = pickSourceNode(r.advertising_sources, ch);
        if (!picked) return;
        if (pipelineFlag(r, ch) === false && num(picked.node && picked.node.spend) === 0) return;
        if (!spendIsPublished(picked.node)) return;
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
    var contract = merContract(date);
    if (contract && MER_DOC) {
      if (MER_DOC.shopify_d2c_revenue != null) return num(MER_DOC.shopify_d2c_revenue);
      if (MER_DOC.shop_revenue != null) return num(MER_DOC.shop_revenue);
    }
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
    FEEDS[id] = FEEDS[id] || { file: null, mer: null, manual: null, daily: null };
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

  var PINTEREST_DISPLAY = {
    id: 'pinterest',
    label: 'Pinterest Ads',
    merKey: 'pinterest',
    sourceKeys: ['pinterest_ads', 'pinterest']
  };

  // X Ads is display-only here: mer_for_manus.json `x` (coldest-cfo-dashboard
  // cfo_backend/x_ads.py) already folds only cash_cost = (spend - ad credit used)
  // + Premium Business fee into d2c_ad_spend / blended_mer. Never overlay it.
  var X_DISPLAY = {
    id: 'x',
    label: 'X Ads',
    merKey: 'x',
    sourceKeys: ['x_ads'],
    roasLabel: 'platform-reported',
    displayOnly: true
  };

  function xBlock() {
    return (MER_DOC && MER_DOC.x && typeof MER_DOC.x === 'object') ? MER_DOC.x : null;
  }

  function publishedKeyedNode(bag, keys) {
    if (!bag || typeof bag !== 'object') return null;
    var picked = pickSourceNode(bag, { sourceKeys: keys });
    if (picked && spendIsPublished(picked.node)) return picked.node;
    return null;
  }

  function feedDailyNode(id, date, keys) {
    var doc = FEEDS[id] && FEEDS[id].daily;
    if (!doc || isPlaceholderNode(doc)) return null;
    var map = doc.advertising_sources && typeof doc.advertising_sources === 'object' ? doc.advertising_sources : doc;
    if (map.by_date && typeof map.by_date === 'object') map = map.by_date;
    else if (map.by_day && typeof map.by_day === 'object') map = map.by_day;
    var node = map && map[date];
    if (spendIsPublished(node)) return node;
    return publishedKeyedNode(node, keys || []);
  }

  function xAdvNode(date) {
    var src = MER_DOC && MER_DOC.advertising_sources && MER_DOC.advertising_sources[date];
    var node = publishedKeyedNode(src, ['x_ads', 'x', 'twitter_ads', 'twitter']);
    if (node) return node;
    var daily = ADV_DAILY && (ADV_DAILY.advertising_sources || ADV_DAILY);
    node = publishedKeyedNode(daily && daily[date], ['x_ads', 'x', 'twitter_ads', 'twitter']);
    if (node) return node;
    return feedDailyNode('x', date, ['x_ads', 'x', 'twitter_ads', 'twitter']);
  }

  function xDayRow(date) {
    var b = xBlock();
    if (b && b.live && b.by_date && b.by_date[date] && spendIsPublished(b.by_date[date])) return b.by_date[date];
    return xAdvNode(date);
  }

  function xSpendTxt(date) {
    var r = xDayRow(date);
    if (r) return usd(r.spend) + (r.cash_cost != null ? ' (cash cost ' + usd(r.cash_cost) + ')' : '');
    if (!xBlock()) return 'missing';
    return '$0.00 · not live';
  }

  function xDetailHtml(date) {
    var b = xBlock();
    var r = xDayRow(date);
    function rx(v) { return v == null || !(Number(v) > 0) ? '—' : Number(v).toFixed(2) + 'x'; }
    if (!r) {
      if (!b) {
        return '<tr><td>X Ads</td><td>missing</td><td>missing</td><td>missing</td><td>missing</td><td>missing</td><td>no X Ads feed published</td></tr>'
          + '<tr class="pc-split"><td colspan="7">↳ X spend is unpublished here — display is missing, not $0. CFO publishes advertising_sources.x_ads / x_ads_daily.json.</td></tr>';
      }
      return '<tr><td>X Ads</td><td>$0.00</td><td>0</td><td>0</td><td>$0.00</td><td>—</td><td>not live</td></tr>'
        + '<tr class="pc-split"><td colspan="7">↳ X Premium Business fee / ad credit: not live until the account id and start date are set. $0 in ad spend and MER.</td></tr>';
    }
    var spend = num(r.spend);
    var cash = finiteNum(r.cash_cost);
    var srcLabel = (b && b.source) || r.source || 'advertising_sources';
    var plan = (b && b.plan) || r.plan || 'monthly';
    var flags = (b && b.flags) || r.flags || [];
    var html = '<tr><td>X Ads</td><td>' + usd(spend) + '</td><td>' + intOrDash(r.clicks) + '</td><td>' + intOrDash(r.conversions)
      + '</td><td>' + usd(r.revenue) + '</td><td>' + esc(rx(spend > 0 ? num(r.revenue) / spend : null)) + ' · platform-reported</td><td>'
      + esc(srcLabel) + '</td></tr>'
      + '<tr class="pc-split"><td>↳ X cash cost</td><td>' + (cash == null ? 'missing' : usd(cash)) + '</td><td colspan="5">ad credit −' + usd(r.credit_used)
      + ' · cash spend ' + usd(r.cash_spend) + ' · Premium fee ' + usd(r.fee) + ' (' + esc(plan)
      + ') · ROAS on cash cost ' + esc(rx(cash > 0 ? num(r.revenue) / cash : null)) + '</td></tr>';
    flags.forEach(function (f) {
      html += '<tr class="pc-split"><td colspan="7" style="color:#f5bc62">⚠ ' + esc(f) + '</td></tr>';
    });
    return html;
  }

  // Taboola is display-only here: mer_for_manus.json (coldest-cfo-dashboard rebuild_mer.py,
  // taboola_ads_daily.json from cfo_backend/taboola_sync.py) already folds its D2C spend into
  // d2c_ad_spend / blended_mer. Never overlay it. Listed after X. A day with no pulled row is missing.
  var TABOOLA_DISPLAY = {
    id: 'taboola',
    label: 'Taboola Ads',
    merKey: 'taboola',
    sourceKeys: ['taboola_ads', 'taboola'],
    roasLabel: 'platform-reported',
    displayOnly: true
  };

  function taboolaDayRow(date) {
    var keys = ['taboola_ads', 'taboola'];
    var src = MER_DOC && MER_DOC.advertising_sources && MER_DOC.advertising_sources[date];
    var node = publishedKeyedNode(src, keys);
    if (node) return node;
    var daily = ADV_DAILY && (ADV_DAILY.advertising_sources || ADV_DAILY);
    node = publishedKeyedNode(daily && daily[date], keys);
    if (node) return node;
    node = feedDailyNode('taboola', date, keys);
    if (node) return node;
    var b = MER_DOC && MER_DOC.taboola;
    var by = b && b.by_date;
    if (by && by[date] && spendIsPublished(by[date])) return by[date];
    return null;
  }

  function taboolaShopify(date) {
    var t = MER_DOC && MER_DOC.ad_channel_throttles;
    var rows = (t && t.series_28d && t.series_28d.by_channel && t.series_28d.by_channel.taboola) || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].date === date) {
        return rows[i].shopify_revenue_status === 'verified' && rows[i].shopify_revenue != null ? num(rows[i].shopify_revenue) : null;
      }
    }
    return null;
  }

  function taboolaSpendTxt(date) {
    var r = taboolaDayRow(date);
    if (!r) return 'missing';
    var spend = num(r.spend);
    return usd(spend) + (spend > 0 || r.live ? '' : ' · not live');
  }

  function taboolaDetailHtml(date) {
    var r = taboolaDayRow(date);
    var shop = taboolaShopify(date);
    var shopTxt = shop == null ? 'missing' : usd(shop);
    function rx(v) { return v == null || !(Number(v) > 0) ? '—' : Number(v).toFixed(2) + 'x'; }
    if (!r) {
      return '<tr><td>Taboola Ads</td><td>missing</td><td>missing</td><td>missing</td><td>missing</td><td>missing</td><td>no Taboola report pulled</td></tr>'
        + '<tr class="pc-split"><td>↳ Taboola Shopify-attributed</td><td>' + esc(shopTxt) + '</td><td colspan="5">utm_source=taboola / utm_medium=paid_native</td></tr>';
    }
    var spend = num(r.spend);
    var rev = num(r.platform_revenue != null ? r.platform_revenue : r.revenue);
    var live = !!r.live || spend > 0;
    return '<tr><td>Taboola Ads</td><td>' + usd(spend) + '</td><td>' + intOrDash(r.clicks) + '</td><td>' + intOrDash(r.conversions)
      + '</td><td>' + usd(rev) + '</td><td>' + esc(rx(spend > 0 ? rev / spend : null)) + ' · platform-reported</td><td>'
      + esc((r.source || 'Taboola Backstage API') + (live ? '' : ' · not live (0 campaigns)')) + '</td></tr>'
      + '<tr class="pc-split"><td>↳ Taboola Shopify-attributed</td><td>' + esc(shopTxt) + '</td><td colspan="5">utm_source=taboola / utm_medium=paid_native · platform ROAS '
      + esc(rx(spend > 0 ? rev / spend : null)) + ' platform-reported</td></tr>';
  }

  // Outbrain (Teads DR) is display-only like Taboola: mer_for_manus.json (rebuild_mer.py,
  // outbrain_ads_daily.json from cfo_backend/outbrain_import.py, a manual daily feed) already folds its
  // D2C spend. Listed after Taboola. Not imported = missing; blank purchases / value = unknown.
  var OUTBRAIN_DISPLAY = {
    id: 'outbrain',
    label: 'Outbrain Ads',
    merKey: 'outbrain',
    sourceKeys: ['outbrain_ads', 'outbrain'],
    roasLabel: 'platform-reported',
    displayOnly: true
  };

  function outbrainDayRow(date) {
    var keys = ['outbrain_ads', 'outbrain'];
    var src = MER_DOC && MER_DOC.advertising_sources && MER_DOC.advertising_sources[date];
    var node = publishedKeyedNode(src, keys);
    if (node) return node;
    var daily = ADV_DAILY && (ADV_DAILY.advertising_sources || ADV_DAILY);
    node = publishedKeyedNode(daily && daily[date], keys);
    if (node) return node;
    node = feedDailyNode('outbrain', date, keys);
    if (node) return node;
    var b = MER_DOC && MER_DOC.outbrain;
    var by = b && b.by_date;
    if (by && by[date] && spendIsPublished(by[date])) return by[date];
    return null;
  }

  function outbrainShopify(date) {
    var t = MER_DOC && MER_DOC.ad_channel_throttles;
    var rows = (t && t.series_28d && t.series_28d.by_channel && t.series_28d.by_channel.outbrain) || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].date === date) {
        return rows[i].shopify_revenue_status === 'verified' && rows[i].shopify_revenue != null ? num(rows[i].shopify_revenue) : null;
      }
    }
    return null;
  }

  function outbrainSpendTxt(date) {
    var r = outbrainDayRow(date);
    if (!r) return 'missing';
    var spend = num(r.spend);
    return usd(spend) + (spend > 0 || r.live ? '' : ' · not live');
  }

  function outbrainDetailHtml(date) {
    var r = outbrainDayRow(date);
    var shop = outbrainShopify(date);
    var shopTxt = shop == null ? 'missing' : usd(shop);
    function rx(v) { return v == null || !(Number(v) > 0) ? '—' : Number(v).toFixed(2) + 'x'; }
    if (!r) {
      return '<tr><td>Outbrain Ads</td><td>missing</td><td>missing</td><td>missing</td><td>missing</td><td>missing</td><td>no Outbrain file imported</td></tr>'
        + '<tr class="pc-split"><td>↳ Outbrain Shopify-attributed</td><td>' + esc(shopTxt) + '</td><td colspan="5">utm_source=outbrain / click id obclid</td></tr>';
    }
    var spend = num(r.spend);
    var revKnown = r.revenue_known !== false && r.revenue != null;
    var convKnown = r.conversions_known !== false && r.conversions != null;
    var rev = revKnown ? num(r.platform_revenue != null ? r.platform_revenue : r.revenue) : null;
    var conv = convKnown ? num(r.conversions) : null;
    var roas = rev == null ? 'unknown' : rx(spend > 0 ? rev / spend : null);
    var cpa = conv == null ? 'unknown' : (conv > 0 ? usd(spend / conv) : '—');
    var live = !!r.live || spend > 0;
    return '<tr><td>Outbrain Ads</td><td>' + usd(spend) + '</td><td>' + (r.clicks == null ? 'unknown' : intOrDash(r.clicks))
      + '</td><td>' + (conv == null ? 'unknown' : intOrDash(conv)) + '</td><td>' + (rev == null ? 'unknown' : usd(rev)) + '</td><td>'
      + esc(roas) + ' · platform-reported</td><td>' + esc((r.source || 'Outbrain UI') + (live ? '' : ' · not live')) + '</td></tr>'
      + '<tr class="pc-split"><td>↳ Outbrain Shopify-attributed</td><td>' + esc(shopTxt) + '</td><td colspan="5">utm_source=outbrain / obclid · CPA '
      + esc(cpa) + ' · platform ROAS ' + esc(roas) + ' platform-reported</td></tr>';
  }

  // Spotify Ads (canonical feed key spotify_ads) is display-only like X / Taboola / Outbrain:
  // CFO (coldest-cfo-dashboard) folds only measured Spotify spend into d2c_ad_spend / blended_mer.
  // This module never overlays it, so unknown Spotify spend stays out of D2C totals / MER.
  // Display rule (CFO): a measured day shows numbers only; an unmeasured day shows "No data"
  // only; spend-only rows show ROAS "No data"; platform spend and billing / cash cost stay separate.
  var SPOTIFY_NO_DATA = 'No data';
  var SPOTIFY_KEYS = ['spotify_ads', 'spotify', 'Spotify', 'Spotify Ads'];
  function moneyPlain(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (Math.abs(n - Math.round(n)) < 1e-9) return '$' + Math.round(n).toLocaleString('en-US');
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function capHasPlanFields(node) {
    if (!node || typeof node !== 'object') return false;
    return node.planned_total_cap_usd != null || node.planned_cap != null || node.planned_cap_usd != null
      || node.total_cap_usd != null || node.per_ad != null || node.per_ad_caps != null;
  }
  function readSpotifyCapNode(src) {
    if (!src || typeof src !== 'object') return null;
    if (src.spotify_ads_config && typeof src.spotify_ads_config === 'object') return src.spotify_ads_config;
    if (src.spotifyAdsConfig && typeof src.spotifyAdsConfig === 'object') return src.spotifyAdsConfig;
    if (capHasPlanFields(src)) return src;
    if (capHasPlanFields(src.spotify_ads)) return src.spotify_ads;
    if (capHasPlanFields(src.spotify)) return src.spotify;
    return null;
  }
  function parseSpotifyPlannedCap(src) {
    var cfg = readSpotifyCapNode(src);
    if (!cfg) return null;
    var total = finiteNum(cfg.planned_total_cap_usd);
    if (total == null) total = finiteNum(cfg.planned_cap);
    if (total == null) total = finiteNum(cfg.planned_cap_usd);
    if (total == null) total = finiteNum(cfg.total_cap_usd);
    var ads = [];
    var raw = cfg.per_ad || cfg.per_ad_caps || cfg.ads || cfg.creatives;
    function pushAd(name, cap) {
      if (!name && cap == null) return;
      ads.push({ name: name ? String(name) : '', cap: cap });
    }
    if (Array.isArray(raw)) {
      raw.forEach(function (a) {
        if (a == null) return;
        if (typeof a === 'string') { pushAd(a, null); return; }
        if (typeof a !== 'object') return;
        var name = a.name || a.label || a.ad || a.product || a.creative || a.title;
        var cap = finiteNum(a.cap_usd != null ? a.cap_usd : (a.planned_cap_usd != null ? a.planned_cap_usd : (a.cap != null ? a.cap : a.planned_cap)));
        pushAd(name, cap);
      });
    } else if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach(function (k) {
        var v = raw[k];
        var cap = (v && typeof v === 'object') ? finiteNum(v.cap_usd != null ? v.cap_usd : v.cap) : finiteNum(v);
        pushAd(k, cap);
      });
    }
    if (total == null && !ads.length) return null;
    var capType = cfg.cap_type != null ? String(cfg.cap_type) : (cfg.capType != null ? String(cfg.capType) : '');
    return { total: total, capType: capType, perAd: ads, raw: cfg };
  }
  function spotifyPlannedCapLabel(src) {
    var cap = parseSpotifyPlannedCap(src);
    if (!cap) return '';
    var typeBit = '';
    if (/lifetime/i.test(cap.capType)) typeBit = ' (lifetime)';
    else if (cap.capType && !/^daily$/i.test(cap.capType)) typeBit = ' (' + cap.capType.replace(/_/g, ' ') + ')';
    var out = 'Planned test cap:';
    if (cap.total != null) out += ' ' + moneyPlain(cap.total) + ' total' + typeBit;
    else if (typeBit) out += typeBit;
    var named = cap.perAd.filter(function (a) { return a.name; });
    if (named.length) {
      var caps = named.map(function (a) { return a.cap; }).filter(function (c) { return c != null; });
      var same = caps.length === named.length && caps.length > 0 && caps.every(function (c) { return c === caps[0]; });
      if (same) out += ' — ' + moneyPlain(caps[0]) + ' each: ' + named.map(function (a) { return a.name; }).join(', ');
      else out += ' — ' + named.map(function (a) { return a.name + (a.cap != null ? ' ' + moneyPlain(a.cap) : ''); }).join(', ');
    }
    return out === 'Planned test cap:' ? '' : out;
  }
  function spotifyPlannedCapFromDoc() {
    var bags = [SPOTIFY_CONFIG, MER_DOC];
    for (var i = 0; i < bags.length; i++) {
      var cap = parseSpotifyPlannedCap(bags[i]);
      if (cap) return cap;
    }
    return null;
  }
  function spotifyCapNote() {
    var cap = spotifyPlannedCapFromDoc();
    return cap ? spotifyPlannedCapLabel(cap.raw) : '';
  }
  function spotifyCapRow(colspan) {
    var label = spotifyCapNote();
    if (!label) return '';
    return '<tr class="pc-split"><td colspan="' + (colspan || 7) + '">↳ ' + esc(label) + ' · not spend · excluded from MER / ROAS</td></tr>';
  }
  var SPOTIFY_DISPLAY = {
    id: 'spotify',
    label: 'Spotify Ads',
    merKey: 'spotify',
    sourceKeys: SPOTIFY_KEYS,
    roasLabel: 'platform-reported',
    displayOnly: true
  };

  function spotifyBlock() {
    if (!MER_DOC || typeof MER_DOC !== 'object') return null;
    var b = MER_DOC.spotify || MER_DOC.spotify_ads || null;
    return b && typeof b === 'object' ? b : null;
  }

  function spotifyDayRow(date) {
    var src = MER_DOC && MER_DOC.advertising_sources && MER_DOC.advertising_sources[date];
    var node = publishedKeyedNode(src, SPOTIFY_KEYS);
    if (node) return node;
    var daily = ADV_DAILY && (ADV_DAILY.advertising_sources || ADV_DAILY);
    node = publishedKeyedNode(daily && daily[date], SPOTIFY_KEYS);
    if (node) return node;
    node = feedDailyNode('spotify', date, SPOTIFY_KEYS);
    if (node) return node;
    var b = spotifyBlock();
    var by = b && (b.by_date || b.by_day);
    if (by && by[date] && spendIsPublished(by[date])) return by[date];
    return null;
  }

  // Not launched = explicit config (mer.spotify status not_launched / live:false), not mere absence.
  function spotifyNotLaunched() {
    var b = spotifyBlock();
    if (!b) return false;
    var st = b.status != null ? String(b.status) : '';
    return b.live === false && (st === 'not_launched' || st === 'pre_launch' || st === 'not_live');
  }

  function spotifyPlatform(r) {
    if (!r || typeof r !== 'object') return null;
    if (r.platform_status === 'unverified') return null;
    var rev = finiteNum(r.platform_revenue != null ? r.platform_revenue : r.revenue);
    var roas = finiteNum(r.platform_roas != null ? r.platform_roas : r.roas);
    var reported = r.platform_status === 'verified' || roas != null || (rev != null && rev > 0);
    if (!reported) return null;
    return { revenue: rev, roas: roas };
  }

  function spotifySpendTxt(date) {
    var r = spotifyDayRow(date);
    if (!r) return spotifyNotLaunched() ? 'Not launched' : SPOTIFY_NO_DATA;
    var spend = finiteNum(r.spend);
    if (spend == null) spend = finiteNum(r.daily_spend);
    if (spend == null) spend = finiteNum(r.ad_spend);
    var cash = finiteNum(r.cash_cost);
    return usd(spend) + (cash != null ? ' (cash cost ' + usd(cash) + ')' : '');
  }

  function spotifyDetailHtml(date) {
    var r = spotifyDayRow(date);
    var nd = SPOTIFY_NO_DATA;
    if (!r) {
      if (spotifyNotLaunched()) {
        return '<tr><td>Spotify Ads</td><td>Not launched</td><td>—</td><td>—</td><td>—</td><td>—</td><td>' + esc((spotifyBlock() || {}).source || 'Spotify Ads not launched') + '</td></tr>'
          + spotifyCapRow(7);
      }
      return '<tr><td>Spotify Ads</td><td>' + nd + '</td><td>' + nd + '</td><td>' + nd + '</td><td>' + nd + '</td><td>' + nd + '</td><td>no spotify_ads feed published</td></tr>'
        + '<tr class="pc-split"><td colspan="7">↳ Spotify spend unmeasured for this day — excluded from D2C ad spend / MER (coverage). CFO publishes advertising_sources.spotify_ads / spotify_ads_daily.json.</td></tr>'
        + spotifyCapRow(7);
    }
    var spend = finiteNum(r.spend);
    if (spend == null) spend = finiteNum(r.daily_spend);
    if (spend == null) spend = finiteNum(r.ad_spend);
    var plat = spotifyPlatform(r);
    var clicks = finiteNum(r.clicks);
    var conv = finiteNum(r.platform_conversions != null ? r.platform_conversions : r.conversions);
    var roas = null;
    if (plat) roas = plat.roas != null ? plat.roas : (spend > 0 && plat.revenue != null ? plat.revenue / spend : null);
    // A measured $0 day is a number-only row: unpublished metrics read "—" (n/a at $0 spend), never "No data".
    var gap = spend === 0 ? '—' : nd;
    var roasCell = roas != null && Number.isFinite(roas) && roas > 0 ? Number(roas).toFixed(2) + 'x · platform-reported' : gap;
    var html = '<tr><td>Spotify Ads</td><td>' + usd(spend) + '</td><td>' + (clicks == null ? gap : intOrDash(clicks)) + '</td><td>' + (conv == null ? gap : intOrDash(conv))
      + '</td><td>' + (plat && plat.revenue != null ? usd(plat.revenue) : gap) + '</td><td>' + esc(roasCell) + '</td><td>'
      + esc(r.source || 'spotify_ads') + '</td></tr>';
    var cash = finiteNum(r.cash_cost);
    if (cash != null) {
      html += '<tr class="pc-split"><td>↳ Spotify billing / cash cost</td><td>' + usd(cash) + '</td><td colspan="5">separate from platform spend · not added to spend</td></tr>';
    }
    html += spotifyCapRow(7);
    return html;
  }

  var APPLOVIN_DISPLAY = {
    id: 'applovin',
    label: 'AppLovin',
    merKey: 'applovin',
    sourceKeys: ['applovin', 'app_lovin', 'appLovin'],
    roasLabel: 'platform-reported, click-based'
  };

  function displayChannels() {
    var seen = {};
    var out = [];
    CHANNELS.forEach(function (ch) {
      if (seen[ch.id]) return;
      seen[ch.id] = true;
      out.push(ch);
    });
    if (!seen.pinterest) out.push(PINTEREST_DISPLAY);
    if (!seen.applovin) out.push(APPLOVIN_DISPLAY);
    if (!seen.x) out.push(X_DISPLAY);
    if (!seen.taboola) out.push(TABOOLA_DISPLAY);
    if (!seen.outbrain) out.push(OUTBRAIN_DISPLAY);
    if (!seen.spotify) out.push(SPOTIFY_DISPLAY);
    return out;
  }

  function spendTxt(day) {
    return day && day.hasFeed ? usd(day.spend) : 'missing';
  }

  function metricTxt(day, kind, ch) {
    if (!day || !day.hasFeed) return 'missing';
    if (kind === 'clicks') return day.hasClicks ? intOrDash(day.clicks) : 'missing';
    if (kind === 'source') {
      var src = day.source || 'published';
      if (day.tracking_verified === false) src += ' · tracking_verified:false';
      return src;
    }
    return outcomeTxt(day, kind, ch);
  }

  function roasDisplay(day, ch) {
    var txt = metricTxt(day, 'roas', ch);
    if (txt === 'missing') return txt;
    if (ch && ch.roasLabel) return txt + ' · ' + ch.roasLabel;
    return txt;
  }

  function dayForDisplay(ch, date) {
    var fromRow = spendFromChannelAdSpend(ch, date);
    if (fromRow) return fromRow;
    var known = CHANNELS.filter(function (c) { return c.id === ch.id; })[0];
    if (known) {
      var days = mergeDaysFor(known);
      if (days[date]) return days[date];
    }
    var src = MER_DOC && MER_DOC.advertising_sources && MER_DOC.advertising_sources[date];
    if (src) {
      var picked = pickSourceNode(src, ch);
      if (picked && spendIsPublished(picked.node) && !isPlaceholderNode(picked.node)) {
        return nodeToDay(date, picked.node, 'advertising_sources.' + picked.key);
      }
    }
    var merB = (known ? merBlockFor(known) : null) || (MER_DOC && MER_DOC[ch.merKey]) || null;
    if (merB && !isPlaceholderNode(merB)) {
      var by = merB.by_date || merB.by_day;
      if (by && by[date] && spendIsPublished(by[date]) && !isPlaceholderNode(by[date])) {
        return nodeToDay(date, by[date], 'mer_for_manus.json#' + ch.merKey);
      }
      var snap = snapshotFromBlock(merB, 'mer_for_manus.json#' + ch.merKey);
      if (snap && snap.date === date) return snap;
    }
    return emptyDay(date);
  }

  function spendPerChannelHtml(date) {
    var rows = displayChannels().map(function (ch) {
      if (ch.id === 'x') return '<tr><td>' + esc(ch.label) + '</td><td>' + esc(xSpendTxt(date)) + '</td></tr>';
      if (ch.id === 'taboola') return '<tr><td>' + esc(ch.label) + '</td><td>' + esc(taboolaSpendTxt(date)) + '</td></tr>';
      if (ch.id === 'outbrain') return '<tr><td>' + esc(ch.label) + '</td><td>' + esc(outbrainSpendTxt(date)) + '</td></tr>';
      if (ch.id === 'spotify') return '<tr><td>' + esc(ch.label) + '</td><td>' + esc(spotifySpendTxt(date)) + '</td></tr>' + spotifyCapRow(2);
      return '<tr><td>' + esc(ch.label) + '</td><td>' + esc(spendTxt(dayForDisplay(ch, date))) + '</td></tr>';
    }).join('');
    return '<table><thead><tr><th>Channel</th><th>Ad spend</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function detailBreakdownHtml(date) {
    var rows = displayChannels().map(function (ch) {
      if (ch.id === 'x') return xDetailHtml(date);
      if (ch.id === 'taboola') return taboolaDetailHtml(date);
      if (ch.id === 'outbrain') return outbrainDetailHtml(date);
      if (ch.id === 'spotify') return spotifyDetailHtml(date);
      var d = dayForDisplay(ch, date);
      var html = '<tr>'
        + '<td>' + esc(ch.label) + '</td>'
        + '<td>' + esc(spendTxt(d)) + '</td>'
        + '<td>' + esc(metricTxt(d, 'clicks', ch)) + '</td>'
        + '<td' + (isTrackingUnverified(d, ch) ? ' class="pc-unverified"' : '') + '>' + esc(metricTxt(d, 'conversions', ch)) + '</td>'
        + '<td' + (isTrackingUnverified(d, ch) ? ' class="pc-unverified"' : '') + '>' + esc(metricTxt(d, 'revenue', ch)) + '</td>'
        + '<td' + (isTrackingUnverified(d, ch) ? ' class="pc-unverified"' : '') + '>' + esc(roasDisplay(d, ch)) + '</td>'
        + '<td>' + esc(metricTxt(d, 'source', ch)) + '</td>'
        + '</tr>';
      if (d.hasFeed && d.d2c != null) {
        html += '<tr class="pc-split"><td>↳ ' + esc(ch.label) + ' D2C</td><td>' + usd(d.d2c) + '</td><td colspan="5">' + esc(ch.merKey) + '.d2c</td></tr>';
      }
      return html;
    }).join('');
    return '<table class="pc-table"><thead><tr><th>Channel</th><th>Spend</th><th>Clicks</th><th>Conv.</th><th>Revenue</th><th>ROAS</th><th>Source</th></tr></thead><tbody>'
      + rows
      + '</tbody></table>';
  }

  function removeDashboardStrip() {
    var strip = document.getElementById('paid-channels-daily');
    if (!strip || !strip.parentNode) return;
    if (strip.getAttribute('data-pc-keep') === '1') return;
    var parent = strip.parentNode;
    if (parent.id === 'reports-summary') parent.removeChild(strip);
  }

  function renderStrip() {
    if (typeof document === 'undefined') return;
    removeDashboardStrip();
    var old = document.getElementById('bing-ads-daily');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    document.querySelectorAll('[data-pc-spend]').forEach(function (el) {
      el.innerHTML = spendPerChannelHtml(el.getAttribute('data-pc-spend'));
    });
    document.querySelectorAll('.pc-day-detail[data-date]').forEach(function (el) {
      el.innerHTML = detailBreakdownHtml(el.getAttribute('data-date'));
    });
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

  function examplePinterestRequested() {
    try {
      if (typeof location === 'undefined' || !location.search) return false;
      return new URLSearchParams(location.search).get('pinterest_example') === '1';
    } catch (e) {
      return false;
    }
  }

  function applyPinterestMerExample(doc, fixture) {
    var out = doc ? JSON.parse(JSON.stringify(doc)) : {};
    if (!fixture || typeof fixture !== 'object') return out;
    if (fixture.pinterest) out.pinterest = Object.assign({ example: true }, fixture.pinterest);
    if (fixture.advertising_sources) {
      out.advertising_sources = Object.assign({}, out.advertising_sources || {}, fixture.advertising_sources);
    }
    return out;
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
    jobs.push(fetchJson('partial_reports_overlay.json').then(function (d) {
      var rows = Array.isArray(d) ? d : ((d && d.PARTIAL_REPORTS) || (d && d.reports) || []);
      mergeOverlayRows(rows);
    }).catch(function () { /* overlay is optional and never required in git */ }));
    jobs.push(fetchJson('advertising_sources_daily.json').then(function (d) { ADV_DAILY = d; }).catch(function () { ADV_DAILY = null; }));
    CHANNELS.forEach(function (ch) {
      jobs.push(fetchJson(ch.file).then(function (d) { FEEDS[ch.id].file = isPlaceholderNode(d) ? null : d; }).catch(function () { FEEDS[ch.id].file = null; }));
      jobs.push(fetchJson(ch.id + '_ads_daily.json').then(function (d) { FEEDS[ch.id].daily = d; }).catch(function () { FEEDS[ch.id].daily = null; }));
    });
    ['taboola', 'outbrain', 'x', 'spotify'].forEach(function (id) {
      jobs.push(fetchJson(id + '_ads_daily.json').then(function (d) {
        if (!FEEDS[id]) FEEDS[id] = { file: null, mer: null, manual: null, daily: null };
        FEEDS[id].daily = d;
      }).catch(function () { /* optional */ }));
    });
    jobs.push(fetchJson('spotify_ads_config.json').then(function (d) { SPOTIFY_CONFIG = d; }).catch(function () { SPOTIFY_CONFIG = null; }));
    if (examplePinterestRequested()) {
      jobs.push(fetchJson('scripts/fixtures/pinterest_example.json').then(function (fx) {
        MER_DOC = applyPinterestMerExample(MER_DOC, fx);
      }).catch(function () { /* keep live mer */ }));
    }
    Promise.allSettled(jobs).then(function () {
      hydratePartialFromMer(MER_DOC);
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
    merAdvertisingSourcesDays: merAdvertisingSourcesDays,
    applyPinterestMerExample: applyPinterestMerExample,
    parseNonD2c: parseNonD2c,
    isTrackingUnverified: isTrackingUnverified,
    outcomeTxt: outcomeTxt,
    TRACKING_UNVERIFIED: TRACKING_UNVERIFIED,
    displayChannels: displayChannels,
    X_DISPLAY: X_DISPLAY,
    TABOOLA_DISPLAY: TABOOLA_DISPLAY,
    taboolaDetailHtml: taboolaDetailHtml,
    taboolaSpendTxt: taboolaSpendTxt,
    OUTBRAIN_DISPLAY: OUTBRAIN_DISPLAY,
    outbrainDetailHtml: outbrainDetailHtml,
    outbrainSpendTxt: outbrainSpendTxt,
    SPOTIFY_DISPLAY: SPOTIFY_DISPLAY,
    SPOTIFY_NO_DATA: SPOTIFY_NO_DATA,
    spotifyDetailHtml: spotifyDetailHtml,
    spotifySpendTxt: spotifySpendTxt,
    spotifyDayRow: spotifyDayRow,
    parseSpotifyPlannedCap: parseSpotifyPlannedCap,
    spotifyPlannedCapLabel: spotifyPlannedCapLabel,
    spotifyCapNote: spotifyCapNote,
    xDetailHtml: xDetailHtml,
    xSpendTxt: xSpendTxt,
    spendTxt: spendTxt,
    metricTxt: metricTxt,
    roasDisplay: roasDisplay,
    dayForDisplay: dayForDisplay,
    spendPerChannelHtml: spendPerChannelHtml,
    detailBreakdownHtml: detailBreakdownHtml,
    renderStrip: renderStrip,
    channelRevenueRows: channelRevenueRows,
    publishedAmount: publishedAmount,
    mergeOverlayRows: mergeOverlayRows,
    hydratePartialFromMer: hydratePartialFromMer,
    isMeasuredZero: isMeasuredZero,
    spendIsPublished: spendIsPublished,
    _setMerDoc: function (doc) { MER_DOC = doc || null; },
    _setAdvDaily: function (doc) { ADV_DAILY = doc || null; },
    _setDailyFile: function (id, doc) {
      FEEDS[id] = FEEDS[id] || { file: null, mer: null, manual: null, daily: null };
      FEEDS[id].daily = doc || null;
    },
    _setSpotifyConfig: function (doc) { SPOTIFY_CONFIG = doc || null; }
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
