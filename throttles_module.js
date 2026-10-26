/* =====================================================================
   COLDEST · AD CHANNEL THROTTLES
   ---------------------------------------------------------------------
   Read-only dashboard. Live rules change only via Jarvis.
   Data: ad_channel_throttles → throttle_settings → ads_throttle/changes.json
   → ads_throttle/tracking_health.json → ads_throttle/rankings.json
   (fallbacks: ads_throttle/settings.json, ads_throttle/series.json,
   mer_for_manus.json blocks, ad_channel_throttles.rankings). Reporting only.
   No credentials. Missing tracking_health = unknown — never invented.
   Missing rankings.json = empty copy, never invented.
   Missing attribution / shopify_roas / coverage = — / unknown — never invented.
   ===================================================================== */
(function (root) {
  'use strict';

  var CHANNEL_META = [
    { id: 'meta', label: 'Meta' },
    { id: 'google', label: 'Google' },
    { id: 'bing', label: 'Bing / Microsoft' },
    { id: 'reddit', label: 'Reddit' },
    { id: 'snapchat', label: 'Snapchat' },
    { id: 'chatgpt', label: 'ChatGPT' },
    { id: 'pinterest', label: 'Pinterest' },
    { id: 'applovin', label: 'AppLovin' },
    { id: 'tiktok', label: 'TikTok' }
  ];
  var HEALTH_CHANNELS = [
    { id: 'meta', label: 'Meta' },
    { id: 'google', label: 'Google' },
    { id: 'bing', label: 'Bing / Microsoft' },
    { id: 'reddit', label: 'Reddit' },
    { id: 'snapchat', label: 'Snapchat' },
    { id: 'chatgpt', label: 'ChatGPT' },
    { id: 'pinterest', label: 'Pinterest' },
    { id: 'applovin', label: 'AppLovin' },
    { id: 'tiktok', label: 'TikTok' }
  ];
  var ISSUE_REPO = 'https://github.com/davidstarkk/coldest-cfo-dashboard/issues/new';
  var SNAPSHOT_PATH = 'ad_channel_throttles.json';
  var SETTINGS_PATH = 'throttle_settings.json';
  var SETTINGS_FALLBACK = 'ads_throttle/settings.json';
  var CHANGES_PATH = 'ads_throttle/changes.json';
  var SERIES_PATH = 'ads_throttle/series.json';
  var HEALTH_PATH = 'ads_throttle/tracking_health.json';
  var RANKINGS_PATH = 'ads_throttle/rankings.json';
  var RANKINGS_EXAMPLE_PATH = 'scripts/fixtures/rankings_example.json';
  var ATTRIBUTION_EXAMPLE_PATH = 'scripts/fixtures/attribution_example.json';
  var PINTEREST_EXAMPLE_PATH = 'scripts/fixtures/pinterest_example.json';
  var PINTEREST_KNOWN_GAP = 'No CAPI (Conversions API) — known gap, browser tag only';
  var PINTEREST_ROAS_WINDOW = 'platform-reported, 7d click / 1d view';
  var UNVERIFIED = 'unverified';
  var UNKNOWN = 'unknown';
  var HOLD_TRACKING_DOWN = 'Hold - tracking down';
  var EMPTY_RANKING_COPY = 'First ranking lands Mon 10/26 ~11:15 AM ET';
  var TIER_ORDER = { lead: 0, steady: 1, lagging: 2, 'not enough data': 3 };
  var LIVE_RULE_NOTE = 'Live rule stays platform-reported per settings until David switches.';

  var LIVE = { settings: null, changes: null, series: null, snapshot: null, health: null, rankings: null, attribution: null, attributionExample: false, pinterestExample: false };
  var WHATIF = { global: {}, channels: {} };
  var CHARTS = [];

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
  function merTxt(v) {
    return v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(2) + 'x';
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function channelLabel(id) {
    var m = CHANNEL_META.filter(function (c) { return c.id === id; })[0];
    return m ? m.label : id;
  }

  function lastN(days, n) {
    if (!days || !days.length) return [];
    return days.slice(Math.max(0, days.length - n));
  }

  function channelSpend(day, id) {
    if (!day || !day.channels || !day.channels[id]) return 0;
    var ch = day.channels[id];
    if (id === 'bing' && ch.d2c != null && LIVE.settings && LIVE.settings.global && LIVE.settings.global.revenue_scope === 'shopify_d2c') {
      return num(ch.d2c);
    }
    return num(ch.spend);
  }

  function channelSpendPublished(day, id) {
    if (!day || !day.channels || !day.channels[id]) return 0;
    return num(day.channels[id].spend);
  }

  function windowTotals(days) {
    var spend = 0, rev = 0, d2c = 0;
    (days || []).forEach(function (d) {
      spend = round2(spend + num(d.total_ad_spend));
      rev = round2(rev + num(d.shopify_d2c_revenue));
      d2c = round2(d2c + num(d.d2c_ad_spend));
    });
    return { spend: spend, shopifyD2C: rev, d2c: d2c, blendedMer: d2c > 0 && rev > 0 ? rev / d2c : null };
  }

  function latestDay(series) {
    var days = (series && series.days) || [];
    return days.length ? days[days.length - 1] : null;
  }

  function stepPctOf(g) {
    if (!g) return 0;
    if (g.step_pct != null && g.step_pct !== '') return num(g.step_pct);
    if (g.step != null && g.step !== '') return num(g.step) <= 1 ? num(g.step) * 100 : num(g.step);
    return 0;
  }

  function normalizeSettings(raw) {
    if (!raw || typeof raw !== 'object') return { global: {}, channels: {}, mode_legend: {} };
    var nested = raw.global && typeof raw.global === 'object';
    var src = nested ? raw.global : raw;
    var g0 = {
      roas_threshold: src.roas_threshold != null ? src.roas_threshold : src.threshold,
      threshold: src.threshold != null ? src.threshold : src.roas_threshold,
      step: src.step,
      step_pct: src.step_pct != null ? src.step_pct : (src.step != null && num(src.step) <= 1 ? num(src.step) * 100 : src.step),
      window_days: src.window_days,
      min_spend_7d: src.min_spend_7d != null ? src.min_spend_7d : src.min_spend,
      min_spend: src.min_spend != null ? src.min_spend : src.min_spend_7d,
      scale_cooldown_days: src.scale_cooldown_days,
      cut_cooldown_days: src.cut_cooldown_days,
      revenue_scope: src.revenue_scope || 'shopify_d2c',
      roas_basis: src.roas_basis || 'platform'
    };
    return {
      as_of: raw.as_of,
      source: raw.source || (nested ? raw.source : 'throttle_settings'),
      updated_at: raw.updated_at,
      updated_by: raw.updated_by,
      note: raw.note,
      global: g0,
      channels: raw.channels || {},
      mode_legend: raw.mode_legend || {}
    };
  }

  function snapshotChannel(id) {
    var snap = LIVE.snapshot;
    if (!snap || !snap.channels) return null;
    return snap.channels[id] || null;
  }

  function normalizeHealth(raw) {
    if (!raw || typeof raw !== 'object') return { as_of: null, shopify_orders_yesterday: null, channels: {} };
    var src = raw.tracking_health && typeof raw.tracking_health === 'object' ? raw.tracking_health : raw;
    return {
      as_of: src.as_of != null && src.as_of !== '' ? src.as_of : null,
      shopify_orders_yesterday: src.shopify_orders_yesterday != null && src.shopify_orders_yesterday !== ''
        ? src.shopify_orders_yesterday : null,
      channels: src.channels && typeof src.channels === 'object' ? src.channels : {}
    };
  }

  function healthStatus(raw) {
    if (raw == null || raw === '') return UNKNOWN;
    var s = String(raw).trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (s === 'OK') return 'OK';
    if (s === 'WARN' || s === 'WARNING') return 'WARN';
    if (s === 'DOWN') return 'DOWN';
    if (s === 'NO_SPEND' || s === 'NOSPEND') return 'NO_SPEND';
    return UNKNOWN;
  }

  function channelHealth(id) {
    var health = LIVE.health;
    var ch = health && health.channels ? health.channels[id] : null;
    if (!ch || typeof ch !== 'object') {
      return {
        status: UNKNOWN,
        last_checkout_event: null,
        last_purchase_event: null,
        purchases_24h: null,
        purchases_7d_avg: null,
        notes: null,
        known_gap: null,
        tracking_status: null
      };
    }
    return {
      status: healthStatus(ch.status),
      last_checkout_event: ch.last_checkout_event != null && ch.last_checkout_event !== '' ? ch.last_checkout_event : null,
      last_purchase_event: ch.last_purchase_event != null && ch.last_purchase_event !== '' ? ch.last_purchase_event : null,
      purchases_24h: ch.purchases_24h != null && ch.purchases_24h !== '' ? ch.purchases_24h : null,
      purchases_7d_avg: ch.purchases_7d_avg != null && ch.purchases_7d_avg !== '' ? ch.purchases_7d_avg : null,
      notes: ch.notes != null && ch.notes !== '' ? ch.notes : null,
      known_gap: ch.known_gap != null && ch.known_gap !== '' ? ch.known_gap : null,
      tracking_status: ch.tracking_status != null && ch.tracking_status !== '' ? ch.tracking_status : null
    };
  }

  function isTrackingDown(id) {
    return channelHealth(id).status === 'DOWN';
  }

  function nullableNum(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function exampleQueryFlag(name) {
    try {
      if (typeof location === 'undefined' || !location.search) return false;
      return new URLSearchParams(location.search).get(name) === '1';
    } catch (e) {
      return false;
    }
  }

  function exampleRankingRequested() {
    return exampleQueryFlag('ranking_example');
  }

  function exampleAttributionRequested() {
    return exampleQueryFlag('attribution_example');
  }

  function examplePinterestRequested() {
    return exampleQueryFlag('pinterest_example');
  }

  function applyPinterestExample(snapshot, health, rankings, fixture) {
    var snap = snapshot ? clone(snapshot) : { channels: {} };
    snap.channels = snap.channels || {};
    if (fixture && fixture.channel) {
      snap.channels.pinterest = Object.assign({}, snap.channels.pinterest || {}, fixture.channel);
    }
    var h = health ? clone(health) : { channels: {} };
    if (h.channels == null || typeof h.channels !== 'object') h.channels = {};
    if (fixture && fixture.tracking_health) {
      h.channels.pinterest = Object.assign({}, h.channels.pinterest || {}, fixture.tracking_health);
    }
    var rank = rankings ? clone(rankings) : { date: 'EXAMPLE-WEEK', example: true, channels: [] };
    if (Array.isArray(rank)) rank = { date: 'EXAMPLE-WEEK', example: true, channels: rank };
    if (fixture && fixture.ranking) {
      rank.channels = (rank.channels || []).filter(function (c) { return c && c.channel !== 'pinterest'; });
      rank.channels.push(fixture.ranking);
      rank.eligible_channels = (rank.eligible_channels || []).concat(['pinterest']);
      rank.example = true;
    }
    return { snapshot: snap, health: h, rankings: rank };
  }

  function pinterestKnownGapText(id) {
    if (id !== 'pinterest') return null;
    var snap = snapshotChannel('pinterest') || {};
    var h = channelHealth('pinterest');
    if (snap.known_gap) return String(snap.known_gap);
    if (h && h.known_gap) return String(h.known_gap);
    return PINTEREST_KNOWN_GAP;
  }

  function normalizeRoasSource(raw) {
    if (raw == null || raw === '') return null;
    var s = String(raw).trim().toLowerCase().replace(/[-\s]+/g, '_');
    if (s === 'shopify_attributed' || s === 'shopify') return 'shopify_attributed';
    if (s === 'platform_reported' || s === 'platform') return 'platform_reported';
    return String(raw).trim();
  }

  function roasSourceLabel(src) {
    if (src === 'shopify_attributed') return 'Shopify-attributed';
    if (src === 'platform_reported') return 'platform-reported';
    return src || null;
  }

  function displayCoveragePct(raw) {
    var n = nullableNum(raw);
    if (n == null) return null;
    return Math.min(100, n);
  }

  function coverageChipClass(raw) {
    var n = nullableNum(raw);
    if (n == null) return 'cov-miss';
    if (n >= 80) return 'cov-high';
    if (n >= 50) return 'cov-mid';
    return 'cov-low';
  }

  function coverageChipHtml(raw) {
    var n = nullableNum(raw);
    if (n == null) return '<span class="th-chip cov-miss">—</span>';
    return '<span class="th-chip ' + coverageChipClass(n) + '">' + displayCoveragePct(n).toFixed(0) + '%</span>';
  }

  function dashOr(value, fmt) {
    if (value == null || value === '') return '<span class="th-unknown">—</span>';
    return fmt ? fmt(value) : esc(String(value));
  }

  function channelAttribution(id) {
    var snap = snapshotChannel(id) || {};
    return {
      shopify_orders_7d: nullableNum(snap.shopify_orders_7d),
      shopify_revenue_7d: nullableNum(snap.shopify_revenue_7d),
      shopify_roas_7d: nullableNum(snap.shopify_roas_7d),
      platform_roas_7d: nullableNum(snap.platform_roas_7d),
      coverage_pct: nullableNum(snap.coverage_pct),
      roas_source: normalizeRoasSource(snap.roas_source),
      rule_roas_source: normalizeRoasSource(snap.rule_roas_source)
    };
  }

  function normalizeAttribution(raw) {
    if (!raw || typeof raw !== 'object') {
      return {
        as_of: null,
        total_orders_7d: null,
        attributed_paid_pct: null,
        owned_pct: null,
        unattributed_pct: null,
        by_channel: {},
        example: false,
        empty: true
      };
    }
    var by = {};
    if (raw.by_channel && typeof raw.by_channel === 'object' && !Array.isArray(raw.by_channel)) {
      Object.keys(raw.by_channel).forEach(function (id) {
        by[id] = nullableNum(raw.by_channel[id]);
      });
    }
    var attr = {
      as_of: raw.as_of != null && raw.as_of !== '' ? String(raw.as_of) : null,
      total_orders_7d: nullableNum(raw.total_orders_7d),
      attributed_paid_pct: nullableNum(raw.attributed_paid_pct),
      owned_pct: nullableNum(raw.owned_pct),
      unattributed_pct: nullableNum(raw.unattributed_pct),
      by_channel: by,
      example: !!raw.example,
      empty: false
    };
    attr.empty = attr.as_of == null
      && attr.total_orders_7d == null
      && attr.attributed_paid_pct == null
      && attr.owned_pct == null
      && attr.unattributed_pct == null
      && !Object.keys(by).length;
    return attr;
  }

  function applyAttributionExample(snapshot, fixture) {
    var out = snapshot ? clone(snapshot) : { channels: {} };
    out.channels = out.channels || {};
    var srcCh = (fixture && fixture.channels) || {};
    Object.keys(srcCh).forEach(function (id) {
      out.channels[id] = Object.assign({}, out.channels[id] || {}, srcCh[id] || {});
    });
    if (fixture && fixture.attribution) {
      out.attribution = Object.assign({ example: true }, fixture.attribution);
    }
    return out;
  }

  function attributionStackHtml(attr) {
    var paid = attr && attr.attributed_paid_pct;
    var owned = attr && attr.owned_pct;
    var unattr = attr && attr.unattributed_pct;
    if (paid == null && owned == null && unattr == null) {
      return '<div class="th-muted">Share of Shopify orders: <span class="th-unknown">' + UNKNOWN + '</span></div>';
    }
    function seg(v, cls) {
      if (v == null) return '';
      var w = Math.max(0, Math.min(100, v));
      return '<i class="' + cls + '" style="width:' + w.toFixed(1) + '%" title="' + w.toFixed(0) + '%"></i>';
    }
    function legend(label, v) {
      return '<span>' + label + ' <strong>' + (v == null ? '—' : Number(v).toFixed(0) + '%') + '</strong></span>';
    }
    return '<div class="th-stack" aria-label="Paid-attributed vs Owned vs Unattributed">'
      + seg(paid, 'paid') + seg(owned, 'owned') + seg(unattr, 'unattr')
      + '</div>'
      + '<div class="th-stack-legend">'
      + legend('Paid-attributed', paid)
      + legend('Owned', owned)
      + legend('Unattributed', unattr)
      + '</div>';
  }

  function asRankingWeeks(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(function (w) { return w && typeof w === 'object'; });
    if (typeof raw !== 'object') return [];
    if (Array.isArray(raw.weeks)) return raw.weeks.filter(function (w) { return w && typeof w === 'object'; });
    if (Array.isArray(raw.rankings)) return raw.rankings.filter(function (w) { return w && typeof w === 'object'; });
    if (raw.channels != null || raw.date != null) return [raw];
    return [];
  }

  function asChannelList(channels) {
    if (Array.isArray(channels)) return channels.filter(function (c) { return c && typeof c === 'object'; });
    if (channels && typeof channels === 'object') {
      return Object.keys(channels).map(function (id) {
        var row = channels[id];
        if (!row || typeof row !== 'object') return { channel: id };
        return Object.assign({ channel: id }, row);
      });
    }
    return [];
  }

  function normalizeTier(raw) {
    if (raw == null || raw === '') return 'not enough data';
    var s = String(raw).trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (s === 'lead') return 'Lead';
    if (s === 'steady') return 'Steady';
    if (s === 'lagging') return 'Lagging';
    if (s === 'not enough data' || s === 'nodata' || s === 'not enough' || s === 'unknown') return 'not enough data';
    return String(raw).trim();
  }

  function tierRank(tier) {
    var key = String(tier || '').trim().toLowerCase();
    return TIER_ORDER[key] != null ? TIER_ORDER[key] : 4;
  }

  function normalizeRankingChannel(row) {
    var src = row && typeof row === 'object' ? row : {};
    return {
      channel: src.channel != null && src.channel !== '' ? String(src.channel) : '',
      roas_7d: nullableNum(src.roas_7d),
      roas_28d: nullableNum(src.roas_28d),
      spend_7d: nullableNum(src.spend_7d),
      wow_change: nullableNum(src.wow_change),
      spend_share: nullableNum(src.spend_share),
      revenue_share: nullableNum(src.revenue_share),
      tier: normalizeTier(src.tier)
    };
  }

  function sortRankingChannels(channels) {
    return (channels || []).slice().sort(function (a, b) {
      var ta = tierRank(a && a.tier);
      var tb = tierRank(b && b.tier);
      if (ta !== tb) return ta - tb;
      var ra = a && a.roas_7d;
      var rb = b && b.roas_7d;
      if (ra == null && rb == null) return String((a && a.channel) || '').localeCompare(String((b && b.channel) || ''));
      if (ra == null) return 1;
      if (rb == null) return -1;
      if (rb !== ra) return rb - ra;
      return String((a && a.channel) || '').localeCompare(String((b && b.channel) || ''));
    });
  }

  function latestRankingWeek(raw) {
    var weeks = asRankingWeeks(raw);
    if (!weeks.length) return null;
    var dated = weeks.slice().sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });
    return dated[dated.length - 1];
  }

  function normalizeRankings(raw) {
    var week = latestRankingWeek(raw);
    if (!week) {
      return { date: null, channels: [], example: false, empty: true };
    }
    var list = asChannelList(week.channels);
    var eligible = week.eligible_channels;
    if (Array.isArray(eligible)) {
      eligible.forEach(function (id) {
        if (!id) return;
        var key = String(id);
        if (list.some(function (c) { return String(c.channel || '') === key; })) return;
        list.push({ channel: key });
      });
    }
    var channels = sortRankingChannels(list.map(normalizeRankingChannel));
    var example = !!(week.example || (raw && raw.example) || week.date === 'EXAMPLE-WEEK');
    return {
      date: week.date != null && week.date !== '' ? String(week.date) : null,
      channels: channels,
      example: example,
      empty: !channels.length,
      share_is_percent: sharesLookLikePercent(channels),
      label: week.label || (raw && raw.label) || (example ? 'EXAMPLE DATA' : null)
    };
  }

  function wowTxt(v) {
    var n = nullableNum(v);
    if (n == null) return null;
    var pct = Math.abs(n) <= 1 ? n * 100 : n;
    var sign = pct > 0 ? '+' : '';
    return sign + pct.toFixed(1) + '%';
  }

  function sharesLookLikePercent(channels) {
    return (channels || []).some(function (c) {
      var spend = nullableNum(c && c.spend_share);
      var rev = nullableNum(c && c.revenue_share);
      return (spend != null && Math.abs(spend) > 1.0000001)
        || (rev != null && Math.abs(rev) > 1.0000001);
    });
  }

  function sharePct(v, alreadyPercent) {
    var n = nullableNum(v);
    if (n == null) return null;
    if (alreadyPercent) return n;
    return Math.abs(n) <= 1.0000001 ? n * 100 : n;
  }

  function usdOrDash(v) {
    if (nullableNum(v) == null) return '—';
    return usd(v);
  }

  function shareBarHtml(spendShare, revShare, alreadyPercent) {
    function row(label, pct, cls) {
      if (pct == null) {
        return '<div class="th-share-row"><span>' + label + '</span><div class="th-bar ' + cls + '"></div><span>—</span></div>';
      }
      var w = Math.max(0, Math.min(100, pct));
      return '<div class="th-share-row"><span>' + label + '</span><div class="th-bar ' + cls + '"><i style="width:' + w.toFixed(1) + '%"></i></div><span class="mono">' + pct.toFixed(1) + '%</span></div>';
    }
    return '<div class="th-share-pair">' + row('Spend', sharePct(spendShare, alreadyPercent), '') + row('Revenue', sharePct(revShare, alreadyPercent), 'rev') + '</div>';
  }

  function tierChipClass(tier) {
    var key = String(tier || '').trim().toLowerCase();
    if (key === 'lead') return 'lead';
    if (key === 'steady') return 'steady';
    if (key === 'lagging') return 'lagging';
    return 'rank-nodata';
  }

  function formatEt(v) {
    if (v == null || v === '') return null;
    var s = String(v);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(s) && !/Z$/.test(s) && !/[+-]\d{2}:\d{2}$/.test(s)) return s;
    var d = new Date(s);
    if (!Number.isFinite(d.getTime())) return s;
    try {
      var txt = d.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      return txt + ' ET';
    } catch (e) {
      return String(v);
    }
  }

  function countTxt(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function unknownOr(value, fmt) {
    if (value == null || value === '') return '<span class="th-unknown">' + UNKNOWN + '</span>';
    return fmt ? fmt(value) : esc(String(value));
  }

  function changesEntries(changes) {
    if (Array.isArray(changes)) return changes;
    if (changes && Array.isArray(changes.entries)) return changes.entries;
    if (LIVE.snapshot && Array.isArray(LIVE.snapshot.recent_changes)) return LIVE.snapshot.recent_changes;
    return [];
  }

  function lastActionAt(changes, channelId, action) {
    var entries = changesEntries(changes);
    var i, e, at, best = null;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (channelId && e.channel !== channelId) continue;
      if (action && e.action !== action) continue;
      at = e.at ? Date.parse(e.at) : (e.date ? Date.parse(e.date) : NaN);
      if (!Number.isFinite(at)) continue;
      if (best == null || at > best) best = at;
    }
    return best;
  }

  function lastChangeEntry(changes, channelId) {
    var entries = changesEntries(changes);
    var i, e, at, best = null, bestE = null;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (channelId && e.channel && e.channel !== channelId) continue;
      if (channelId && !e.channel) continue;
      at = e.at ? Date.parse(e.at) : (e.date ? Date.parse(e.date) : NaN);
      if (!Number.isFinite(at)) continue;
      if (best == null || at > best) { best = at; bestE = e; }
    }
    return bestE;
  }

  function daysSince(ts) {
    if (ts == null) return Infinity;
    return (Date.now() - ts) / 86400000;
  }

  function addDays(ts, days) {
    if (ts == null || !Number.isFinite(ts)) return null;
    return new Date(ts + days * 86400000).toISOString().slice(0, 10);
  }

  function mergeSettings(live, whatif) {
    var out = clone(normalizeSettings(live));
    out.global = Object.assign({}, out.global, whatif && whatif.global);
    out.channels = out.channels || {};
    Object.keys((whatif && whatif.channels) || {}).forEach(function (id) {
      out.channels[id] = Object.assign({}, out.channels[id] || {}, whatif.channels[id]);
    });
    return out;
  }

  function channelRoas(channelId, settings, series) {
    var snap = snapshotChannel(channelId);
    var g = (settings && settings.global) || {};
    var basis = (snap && snap.roas_basis) || g.roas_basis || 'platform';
    if (snap) {
      if (basis === 'platform' && snap.platform_roas_7d != null && Number.isFinite(Number(snap.platform_roas_7d))) {
        return { roas: num(snap.platform_roas_7d), source: 'platform_roas', verified: snap.platform_roas_status === 'verified', basis: 'platform' };
      }
      if (snap.roas_7d != null && Number.isFinite(Number(snap.roas_7d)) && snap.roas_7d_status !== 'unverified') {
        return { roas: num(snap.roas_7d), source: 'roas_7d', verified: true, basis: basis };
      }
      var rev = snap.shopify_revenue_7d != null ? snap.shopify_revenue_7d
        : (snap.shopify_attributed_revenue != null ? snap.shopify_attributed_revenue : snap.shopify_attributed_revenue_7d);
      if (rev != null && num(snap.spend_7d) > 0) {
        return { roas: num(rev) / num(snap.spend_7d), source: 'shopify_revenue_7d', verified: snap.shopify_revenue_status === 'verified', basis: 'shopify' };
      }
    }
    var days = lastN((series && series.days) || [], num(g.window_days) || 7);
    var win = windowTotals(days);
    return { roas: win.blendedMer, source: 'company_d2c_mer', verified: false, basis: basis };
  }

  function whatIfActive() {
    return Object.keys(WHATIF.global || {}).some(function (k) { return WHATIF.global[k] != null && WHATIF.global[k] !== ''; })
      || Object.keys(WHATIF.channels || {}).length > 0;
  }

  function publishedStatus(snap) {
    if (!snap || !snap.rule_status) return null;
    var label = snap.rule_status;
    var action = 'none';
    if (label.indexOf('Scale') === 0) action = 'scale';
    else if (label.indexOf('Cut') === 0) action = 'cut';
    else if (label.indexOf('Hold') === 0) action = 'hold';
    else if (label.indexOf('Not enough') === 0) action = 'not_enough_data';
    else if (label.indexOf('Learning') === 0) action = 'none';
    return { action: action, label: label };
  }

  function channelSpend7(channelId, settings, series) {
    var snap = snapshotChannel(channelId);
    if (snap && snap.spend_7d != null) return num(snap.spend_7d);
    var g = (settings && settings.global) || {};
    var days = lastN((series && series.days) || [], num(g.window_days) || 7);
    var spend7 = 0;
    days.forEach(function (d) { spend7 = round2(spend7 + channelSpendPublished(d, channelId)); });
    return spend7;
  }

  function channelD2cSpend7(channelId, settings, series) {
    var snap = snapshotChannel(channelId);
    if (snap) {
      if (snap.spend_d2c_7d != null) return num(snap.spend_d2c_7d);
      var split = snap.destination_split || {};
      if (split.shopify != null) return num(split.shopify);
      if (split.d2c != null) return num(split.d2c);
    }
    var g = (settings && settings.global) || {};
    var days = lastN((series && series.days) || [], num(g.window_days) || 7);
    var spend7 = 0;
    var any = false;
    days.forEach(function (d) {
      var ch = d && d.channels && d.channels[channelId];
      if (!ch) return;
      if (ch.d2c != null || ch.spend_d2c != null) {
        any = true;
        spend7 = round2(spend7 + num(ch.d2c != null ? ch.d2c : ch.spend_d2c));
      }
    });
    if (any) return spend7;
    return null;
  }

  function channelSpend7ForRule(channelId, settings, series) {
    if (channelId === 'bing') {
      var d2c = channelD2cSpend7(channelId, settings, series);
      if (d2c != null) return d2c;
    }
    return channelSpend7(channelId, settings, series);
  }

  function recommend(channelId, settings, series, changes) {
    settings = normalizeSettings(settings || {});
    var g = settings.global || {};
    var ch = (settings.channels && settings.channels[channelId]) || {};
    var snap = snapshotChannel(channelId) || {};
    var spend7 = channelSpend7(channelId, settings, series);
    var spend7Rule = channelSpend7ForRule(channelId, settings, series);
    var last = latestDay(series);
    var current = last ? channelSpendPublished(last, channelId) : num(snap.spend_7d);
    if (ch.daily_budget != null) current = num(ch.daily_budget);
    else if (snap.daily_budget != null) current = num(snap.daily_budget);
    var roasInfo = channelRoas(channelId, settings, series);
    var mer = roasInfo.roas;
    var threshold = num(g.roas_threshold != null ? g.roas_threshold : g.threshold);
    var step = stepPctOf(g);
    var minSpend = num(g.min_spend_7d != null ? g.min_spend_7d : g.min_spend);
    var mode = ch.mode || snap.mode || 'view';
    var base = {
      channel: channelId,
      mode: mode,
      current: current,
      spend7: spend7,
      spend7_rule: spend7Rule,
      mer: mer,
      roas: mer,
      roas_source: roasInfo.source,
      roas_verified: roasInfo.verified,
      roas_basis: roasInfo.basis || snap.roas_basis || g.roas_basis || 'platform',
      threshold: threshold,
      step_pct: step
    };

    if (isTrackingDown(channelId)) {
      return Object.assign(base, {
        action: 'hold',
        label: HOLD_TRACKING_DOWN,
        reason: 'tracking_health.status is DOWN — hold until tracking recovers'
      });
    }

    if (!whatIfActive()) {
      var pub = publishedStatus(snap);
      if (pub) return Object.assign(base, pub, { published: true, reason: snap.strategy_notes || 'published rule_status' });
    }

    if (mode === 'frozen') {
      return Object.assign(base, { action: 'none', label: 'Frozen - view only', reason: 'Meta freeze / frozen mode — view only until lifted' });
    }
    if (mode === 'view') {
      return Object.assign(base, { action: 'none', label: 'View only', reason: 'Tracked only — no budget change' });
    }

    if (spend7Rule < minSpend) {
      return Object.assign(base, {
        action: 'not_enough_data',
        label: 'Not enough data',
        reason: (channelId === 'bing' ? 'D2C-only 7d spend ' : '7d spend ') + usd(spend7Rule) + ' is under min spend ' + usd(minSpend)
      });
    }

    var wantScale = mer != null && mer >= threshold;
    var action = wantScale ? 'scale' : 'cut';
    var cooldown = wantScale ? num(g.scale_cooldown_days) : num(g.cut_cooldown_days);
    var lastAt = wantScale
      ? lastActionAt(changes, channelId, 'scale')
      : lastActionAt(changes, channelId, null);
    if (daysSince(lastAt) < cooldown) {
      return Object.assign(base, {
        action: 'hold',
        label: 'Hold-cooldown',
        next_eligible: addDays(lastAt, cooldown),
        reason: (wantScale ? 'scale' : 'cut') + ' cooldown ' + cooldown + 'd still running'
      });
    }

    if (mode === 'hold') {
      return Object.assign(base, { action: 'hold', label: 'Hold-cooldown', reason: 'mode hold — keep budget' });
    }

    var next = wantScale ? current * (1 + step / 100) : current * (1 - step / 100);
    if (ch.min_daily_budget != null && ch.min_daily_budget !== '') next = Math.max(next, num(ch.min_daily_budget));
    if (ch.max_daily_budget != null && ch.max_daily_budget !== '') next = Math.min(next, num(ch.max_daily_budget));
    next = round2(next);
    var unverifiedNote = roasInfo.verified ? '' : ' · channel ROAS unverified (using ' + roasInfo.source + ')';
    return Object.assign(base, {
      action: action,
      label: wantScale ? ('Scale +' + step + '%') : ('Cut -' + step + '% + new strategy'),
      recommended: next,
      reason: (wantScale ? 'ROAS ' + merTxt(mer) + ' ≥ ' + merTxt(threshold) : 'ROAS ' + merTxt(mer) + ' < ' + merTxt(threshold) + ' — cut, never pause') + unverifiedNote
    });
  }

  function requestChangeUrl(settings) {
    var title = 'Throttle settings change request';
    var body = [
      'Requesting a live settings change. Live settings change only through Jarvis in chat.',
      '',
      'Current `throttle_settings` / `ads_throttle/settings.json`:',
      '',
      '```json',
      JSON.stringify(settings || {}, null, 2),
      '```',
      '',
      'Requested change:',
      '- '
    ].join('\n');
    return ISSUE_REPO + '?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
  }

  function destroyCharts() {
    CHARTS.forEach(function (c) { try { if (c && c.destroy) c.destroy(); } catch (e) { /* ignore */ } });
    CHARTS = [];
  }

  function destLabel(dest, note) {
    if (dest === 'amazon') return 'Amazon' + (note ? ' · ' + note : '');
    if (dest === 'other') return 'Other';
    if (dest === 'split' || dest === 'mixed') return 'Shopify + Amazon' + (note ? ' · ' + note : '');
    if (dest === 'shopify' || dest === 'd2c') return 'Shopify';
    return dest ? dest : 'Shopify';
  }

  function basisLabel(basis) {
    if (basis === 'platform') return 'platform-reported';
    if (basis === 'shopify' || basis === 'shopify_d2c') return 'Shopify-attributed';
    return basis || 'platform-reported';
  }

  function sparkSvg(points) {
    var vals = (points || []).map(function (p) { return num(p && p.spend != null ? p.spend : p); });
    if (!vals.length) return '<span class="th-unverified">' + UNVERIFIED + '</span>';
    var max = Math.max.apply(null, vals.concat([1]));
    var min = Math.min.apply(null, vals);
    var span = max - min || 1;
    var w = 72, h = 22, pad = 2;
    var d = vals.map(function (v, i) {
      var x = pad + (vals.length === 1 ? w / 2 : i * (w - pad * 2) / (vals.length - 1));
      var y = h - pad - ((v - min) / span) * (h - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var first = vals[0], last = vals[vals.length - 1];
    var arrow = last > first * 1.02 ? '↑' : (last < first * 0.98 ? '↓' : '→');
    var cls = last > first * 1.02 ? 'up' : (last < first * 0.98 ? 'down' : 'flat');
    return '<span class="th-trend"><svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><polyline fill="none" stroke="#00d4d4" stroke-width="1.6" points="' + d + '"/></svg><span class="th-arrow ' + cls + '">' + arrow + '</span></span>';
  }

  function unverifiedOr(value, fmt, status) {
    if (status === 'unverified' || value == null || value === '') return '<span class="th-unverified">' + UNVERIFIED + '</span>';
    return fmt ? fmt(value) : esc(String(value));
  }

  function badgeClass(label) {
    if (!label) return 'view';
    if (label.indexOf('Scale') === 0) return 'scale';
    if (label.indexOf('Cut') === 0) return 'cut';
    if (label.indexOf('Hold - tracking') === 0) return 'down';
    if (label.indexOf('Hold') === 0) return 'hold';
    if (label.indexOf('Not enough') === 0) return 'nodata';
    if (label.indexOf('Learning') === 0) return 'learning';
    if (label.indexOf('Frozen') === 0) return 'frozen';
    return 'view';
  }

  function injectCss() {
    if (document.getElementById('th-module-css')) return;
    var css = ''
      + '.th-wrap{max-width:1400px;margin:0 auto;padding:8px 0 32px}'
      + '.th-title{font-size:.72rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--cyan,#00d4d4);margin:0 0 8px}'
      + '.th-h{font-size:1.35rem;font-weight:700;margin:0 0 6px}'
      + '.th-sub{color:var(--text-muted,#8888a8);font-size:.82rem;margin:0 0 16px;line-height:1.5}'
      + '.th-note{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);border-radius:8px;padding:10px 12px;color:var(--yellow,#f59e0b);font-size:.8rem;margin:0 0 16px}'
      + '.th-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}'
      + '.th-grid{display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:16px}'
      + '.th-channels{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:16px 0}'
      + '.th-card{background:var(--card,#171730);border:1px solid var(--border,#252548);border-radius:8px;padding:14px 16px}'
      + '.th-label{font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim,#5c5c7a);margin-bottom:6px}'
      + '.th-val{font-family:var(--font-mono,ui-monospace,monospace);font-size:1.35rem;font-weight:700}'
      + '.th-muted{color:var(--text-muted,#8888a8);font-size:.75rem;margin-top:4px}'
      + '.th-chart{height:180px}'
      + '.th-chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.65rem;font-weight:700;letter-spacing:.04em}'
      + '.th-chip.auto{background:rgba(0,212,212,.15);color:#00d4d4}'
      + '.th-chip.hold,.th-chip.hold-cooldown{background:rgba(245,158,11,.15);color:#f59e0b}'
      + '.th-chip.frozen{background:rgba(239,68,68,.15);color:#ef4444}'
      + '.th-chip.view,.th-chip.nodata{background:rgba(136,136,168,.15);color:#8888a8}'
      + '.th-chip.scale{background:rgba(34,197,94,.15);color:#22c55e}'
      + '.th-chip.cut{background:rgba(239,68,68,.18);color:#fb7185}'
      + '.th-chip.ok{background:rgba(34,197,94,.18);color:#22c55e}'
      + '.th-chip.warn{background:rgba(245,158,11,.18);color:#f59e0b}'
      + '.th-chip.down{background:rgba(239,68,68,.2);color:#ef4444}'
      + '.th-chip.nospend{background:rgba(0,212,212,.14);color:#7dd3d3}'
      + '.th-chip.unknown{background:rgba(136,136,168,.15);color:#8888a8}'
      + '.th-chip.lead{background:rgba(34,197,94,.18);color:#22c55e}'
      + '.th-chip.steady{background:rgba(59,130,246,.16);color:#93c5fd}'
      + '.th-chip.lagging{background:rgba(245,158,11,.18);color:#f59e0b}'
      + '.th-chip.rank-nodata{background:rgba(136,136,168,.15);color:#8888a8}'
      + '.th-chip.learning{background:rgba(0,212,212,.15);color:#00d4d4}'
      + '.th-chip.known-gap{background:rgba(245,158,11,.18);color:#f59e0b;margin-top:4px;max-width:260px;white-space:normal;line-height:1.3}'
      + '.th-chip.cov-high{background:rgba(34,197,94,.18);color:#22c55e}'
      + '.th-chip.cov-mid{background:rgba(245,158,11,.18);color:#f59e0b}'
      + '.th-chip.cov-low{background:rgba(239,68,68,.2);color:#fb7185}'
      + '.th-chip.cov-miss{background:rgba(136,136,168,.15);color:#8888a8}'
      + '.th-stack{display:flex;height:14px;border-radius:999px;overflow:hidden;background:rgba(37,37,72,.9);margin:10px 0 8px}'
      + '.th-stack>i{display:block;height:100%}'
      + '.th-stack>i.paid{background:#00d4d4}'
      + '.th-stack>i.owned{background:#3b82f6}'
      + '.th-stack>i.unattr{background:#8888a8}'
      + '.th-stack-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:.75rem;color:#8888a8}'
      + '.th-stack-legend strong{color:#e8e8f0;font-weight:700}'
      + '.th-example-banner{background:rgba(167,139,250,.14);border:1px dashed #a78bfa;color:#c4b5fd;border-radius:8px;padding:10px 12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;font-size:.78rem;margin:0 0 12px}'
      + '.th-empty-ranking{color:#8888a8;font-size:.9rem;padding:18px 16px}'
      + '.th-share-pair{min-width:180px}'
      + '.th-share-row{display:grid;grid-template-columns:64px 1fr 42px;gap:6px;align-items:center;margin:3px 0;font-size:.68rem;color:#8888a8}'
      + '.th-bar{height:8px;background:rgba(37,37,72,.9);border-radius:999px;overflow:hidden}'
      + '.th-bar>i{display:block;height:100%;background:#00d4d4;border-radius:999px}'
      + '.th-bar.rev>i{background:#a78bfa}'
      + '.th-unverified{color:var(--yellow,#f59e0b);font-weight:600;font-size:.75rem}'
      + '.th-unknown{color:#8888a8;font-weight:600;font-size:.75rem}'
      + '.th-scroll{overflow-x:auto}'
      + '.th-table{width:100%;border-collapse:collapse;font-size:.78rem;min-width:1100px}'
      + '.th-table.th-wide{min-width:1480px}'
      + '.th-table th{color:var(--text-dim,#5c5c7a);font-size:.62rem;letter-spacing:.06em;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid var(--border,#252548);text-align:right;white-space:nowrap}'
      + '.th-table th:first-child,.th-table td:first-child{text-align:left}'
      + '.th-table td{padding:8px;border-bottom:1px solid var(--border,#252548);vertical-align:middle}'
      + '.th-table td.mono{font-family:var(--font-mono,ui-monospace,monospace)}'
      + '.th-trend{display:inline-flex;align-items:center;gap:4px}'
      + '.th-arrow.up{color:#22c55e}'
      + '.th-arrow.down{color:#fb7185}'
      + '.th-arrow.flat{color:#8888a8}'
      + '.th-form{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:10px}'
      + '.th-form label{display:block;font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#5c5c7a);margin-bottom:4px}'
      + '.th-form input,.th-form select{width:100%;background:var(--card,#171730);color:var(--text,#e8e8f0);border:1px solid var(--border,#252548);border-radius:6px;padding:7px 8px;font-family:var(--font-mono,ui-monospace,monospace);font-size:.8rem}'
      + '.th-form input:disabled,.th-form select:disabled{opacity:.7;cursor:not-allowed}'
      + '.th-btn{display:inline-block;background:var(--cyan,#00d4d4);color:#0d0d1a;border:none;border-radius:6px;padding:8px 12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;font-size:.7rem;text-decoration:none}'
      + '.th-ro{opacity:.9}'
      + '@media (max-width:900px){.th-kpis,.th-form{grid-template-columns:1fr}}';
    var st = document.createElement('style');
    st.id = 'th-module-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function ensureTab() {
    var panel = document.getElementById('tab-throttles');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'tab-throttles';
      panel.className = 'tab-content';
      var reports = document.getElementById('tab-reports');
      if (reports && reports.parentNode) reports.parentNode.appendChild(panel);
      else document.body.appendChild(panel);
    }
    var btn = document.querySelector('.tab[data-tab="throttles"]');
    if (!btn) {
      var after = document.querySelector('.tab[data-tab="reports"]');
      if (after && after.parentNode) {
        btn = document.createElement('div');
        btn.className = 'tab';
        btn.setAttribute('data-tab', 'throttles');
        after.parentNode.insertBefore(btn, after.nextSibling);
      }
    } else if (btn.parentNode) {
      var reportsTab = document.querySelector('.tab[data-tab="reports"]');
      if (reportsTab && reportsTab.nextElementSibling !== btn) {
        reportsTab.parentNode.insertBefore(btn, reportsTab.nextSibling);
      }
    }
    if (btn) btn.textContent = 'AD CHANNEL THROTTLES';
    if (btn && !btn._thBound) {
      btn._thBound = true;
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
        document.body.classList.remove('reports-active');
        btn.classList.add('active');
        panel.classList.add('active');
        if (typeof history !== 'undefined' && history.replaceState) {
          history.replaceState(null, null, '#throttles');
        } else if (typeof location !== 'undefined') {
          location.hash = 'throttles';
        }
        try { btn.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (e) { /* ignore */ }
        render();
      });
    }
    return panel;
  }

  function rowHtml(c, rec, settings) {
    var snap = snapshotChannel(c.id) || {};
    var chSet = ((settings && settings.channels) || {})[c.id] || {};
    var dest = snap.destination || chSet.destination || (c.id === 'bing' ? 'amazon' : 'shopify');
    var split = snap.destination_split || {};
    var destNote = '';
    if (split.shopify != null || split.amazon != null) {
      destNote = 'D2C ' + usd(split.shopify || 0) + ' / Amazon ' + usd(split.amazon || 0);
    }
    var budget = snap.daily_budget;
    var attr = channelAttribution(c.id);
    var rev = attr.shopify_revenue_7d != null ? attr.shopify_revenue_7d : snap.shopify_attributed_revenue;
    var trend = snap.trend_3d;
    if (!trend || !trend.length) {
      var days = lastN((LIVE.series && LIVE.series.days) || [], 3);
      trend = days.map(function (d) { return { date: d.date, spend: channelSpendPublished(d, c.id) }; });
    }
    var lastE = lastChangeEntry(LIVE.changes, c.id);
    var lastAt = snap.last_change_date || snap.last_change_at || (lastE && (lastE.at || lastE.date)) || null;
    var nextEl = snap.next_eligible_date || snap.next_eligible_at || rec.next_eligible || '—';
    var owner = snap.owner_bot != null ? snap.owner_bot : chSet.owner_bot;
    var notes = snap.strategy_notes != null ? snap.strategy_notes : (chSet.strategy_notes || chSet.notes || '');
    var lastTxt = lastAt ? String(lastAt).slice(0, 10) : '<span class="th-unverified">no change yet</span>';
    var spendHtml = usd(rec.spend7);
    if (c.id === 'bing' && (split.shopify != null || split.amazon != null)) {
      spendHtml += '<div class="th-muted">D2C ' + usd(split.shopify) + ' / Amazon ' + usd(split.amazon) + '</div>';
    }
    if (c.id === 'pinterest' && snap.spend_d2c_7d != null) {
      spendHtml += '<div class="th-muted">D2C ' + usd(snap.spend_d2c_7d) + '</div>';
    }
    var shopRoasHtml = dashOr(attr.shopify_roas_7d, merTxt);
    var platLabel = c.id === 'pinterest' ? PINTEREST_ROAS_WINDOW : 'platform-reported';
    var platRoasHtml = dashOr(attr.platform_roas_7d, merTxt)
      + ((attr.platform_roas_7d != null || c.id === 'pinterest') ? '<div class="th-muted">' + esc(platLabel) + '</div>' : '');
    var ruleUses = roasSourceLabel(attr.rule_roas_source || attr.roas_source);
    var dateBits = [];
    if (c.id === 'pinterest') {
      dateBits.push('launch ' + (snap.launch_date ? esc(String(snap.launch_date).slice(0, 10)) : '—'));
      dateBits.push('soft read ' + (snap.soft_read_date ? esc(String(snap.soft_read_date).slice(0, 10)) : '—'));
      dateBits.push('first binding ' + (snap.first_binding_date ? esc(String(snap.first_binding_date).slice(0, 10)) : '—'));
    }
    return '<tr' + (c.id === 'pinterest' ? ' id="th-row-pinterest"' : '') + '>'
      + '<td>' + esc(c.label)
      + (c.id === 'pinterest' && LIVE.pinterestExample ? '<div class="th-example-banner" style="margin:6px 0 4px">EXAMPLE DATA</div>' : '')
      + (c.id === 'pinterest' ? '<div class="th-muted">' + dateBits.join(' · ') + '</div>' : '')
      + (c.id === 'pinterest' ? '<div><span class="th-chip known-gap">' + esc(pinterestKnownGapText('pinterest')) + '</span></div>' : '')
      + '</td>'
      + '<td class="mono">' + unverifiedOr(budget, usd, snap.daily_budget_status) + '</td>'
      + '<td class="mono">' + spendHtml + '</td>'
      + '<td class="mono">' + (attr.shopify_revenue_7d != null ? usd(attr.shopify_revenue_7d) : unverifiedOr(rev, usd, snap.shopify_revenue_status)) + '</td>'
      + '<td class="mono">' + shopRoasHtml + '</td>'
      + '<td class="mono">' + platRoasHtml + '</td>'
      + '<td>' + coverageChipHtml(attr.coverage_pct) + '</td>'
      + '<td>' + (ruleUses ? esc(ruleUses) : '<span class="th-unknown">—</span>') + '</td>'
      + '<td>' + sparkSvg(trend) + '</td>'
      + '<td>' + esc(destLabel(dest)) + (destNote ? '<div class="th-muted">' + esc(destNote) + '</div>' : '') + '</td>'
      + '<td><span class="th-chip ' + badgeClass(rec.label) + '">' + esc(rec.label) + '</span></td>'
      + '<td>' + lastTxt + '<div class="th-muted">next ' + (nextEl && nextEl !== '—' ? esc(String(nextEl).slice(0, 10)) : 'eligible now') + '</div></td>'
      + '<td>' + (owner ? esc(owner) : '<span class="th-unverified">' + UNVERIFIED + '</span>') + '</td>'
      + '<td>' + (notes ? esc(notes) : '—') + '</td>'
      + '</tr>';
  }

  function healthChipClass(status) {
    if (status === 'OK') return 'ok';
    if (status === 'WARN') return 'warn';
    if (status === 'DOWN') return 'down';
    if (status === 'NO_SPEND') return 'nospend';
    return 'unknown';
  }

  function trackingHealthHtml() {
    var health = LIVE.health || { as_of: null, shopify_orders_yesterday: null, channels: {} };
    var shopYday = health.shopify_orders_yesterday;
    var ids = HEALTH_CHANNELS.slice();
    Object.keys(health.channels || {}).forEach(function (id) {
      if (ids.some(function (c) { return c.id === id; })) return;
      ids.push({ id: id, label: channelLabel(id) });
    });
    var rows = ids.map(function (c) {
      var h = channelHealth(c.id);
      return '<tr>'
        + '<td>' + esc(c.label) + '</td>'
        + '<td><span class="th-chip ' + healthChipClass(h.status) + '">' + esc(h.status) + '</span></td>'
        + '<td class="mono">' + unknownOr(formatEt(h.last_checkout_event)) + '</td>'
        + '<td class="mono">' + unknownOr(formatEt(h.last_purchase_event)) + '</td>'
        + '<td class="mono">' + unknownOr(h.purchases_24h, countTxt) + '</td>'
        + '<td class="mono">' + unknownOr(shopYday, countTxt) + '</td>'
        + '<td class="mono">' + unknownOr(h.purchases_7d_avg, countTxt) + '</td>'
        + '<td>' + (h.notes ? esc(h.notes) : '<span class="th-unknown">' + UNKNOWN + '</span>')
        + (c.id === 'pinterest' ? '<div><span class="th-chip known-gap">' + esc(pinterestKnownGapText('pinterest')) + '</span></div>' : '')
        + '</td>'
        + '</tr>';
    }).join('');
    return ''
      + '<div id="th-tracking-health">'
      + '<div class="th-title">Tracking health</div>'
      + (LIVE.pinterestExample ? '<div class="th-example-banner">EXAMPLE DATA — test-only Pinterest fixture, not a published feed</div>' : '')
      + '<p class="th-sub">Snapshot <code>tracking_health</code> / <code>ads_throttle/tracking_health.json</code>'
      + ' (as_of ' + (health.as_of ? esc(String(health.as_of)) : '<span class="th-unknown">' + UNKNOWN + '</span>') + '). '
      + 'Missing fields stay <span class="th-unknown">unknown</span> — never invented. '
      + 'DOWN channels force throttle badge <code>' + esc(HOLD_TRACKING_DOWN) + '</code>.</p>'
      + '<div class="th-kpis" style="grid-template-columns:repeat(2,1fr)">'
      + '<div class="th-card"><div class="th-label">Shopify orders yesterday</div><div class="th-val">'
      + unknownOr(shopYday, countTxt) + '</div><div class="th-muted">shopify_orders_yesterday</div></div>'
      + '<div class="th-card"><div class="th-label">Compare</div><div class="th-muted" style="margin-top:8px">Platform <code>purchases_24h</code> vs Shopify orders yesterday and vs <code>purchases_7d_avg</code>. Times in ET.</div></div>'
      + '</div>'
      + '<div class="th-card th-scroll"><table class="th-table"><thead><tr>'
      + '<th>Channel</th><th>Status</th><th>Last checkout (ET)</th><th>Last purchase (ET)</th>'
      + '<th>purchases_24h</th><th>vs Shopify yday</th><th>vs 7d avg</th><th>Notes</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '</div>';
  }

  function rankingHtml() {
    var week = LIVE.rankings || { date: null, channels: [], example: false, empty: true };
    var empty = !week.channels || !week.channels.length;
    var banner = week.example
      ? '<div class="th-example-banner" role="status">EXAMPLE DATA — test-only fixture, not a published ranking</div>'
      : '';
    var dateTxt = week.date ? esc(String(week.date)) : '—';
    var body;
    if (empty) {
      body = '<div class="th-card th-empty-ranking" id="th-ranking-empty">' + esc(EMPTY_RANKING_COPY) + '</div>';
    } else {
      var rows = week.channels.map(function (ch) {
        var wow = wowTxt(ch.wow_change);
        return '<tr>'
          + '<td>' + esc(channelLabel(ch.channel)) + '</td>'
          + '<td><span class="th-chip ' + tierChipClass(ch.tier) + '">' + esc(ch.tier) + '</span></td>'
          + '<td class="mono">' + merTxt(ch.roas_7d) + '<div class="th-muted">platform-reported</div></td>'
          + '<td class="mono">' + merTxt(ch.roas_28d) + '<div class="th-muted">platform-reported</div></td>'
          + '<td class="mono">' + usdOrDash(ch.spend_7d) + '</td>'
          + '<td class="mono">' + (wow == null ? '—' : esc(wow)) + '</td>'
          + '<td>' + shareBarHtml(ch.spend_share, ch.revenue_share, week.share_is_percent) + '</td>'
          + '</tr>';
      }).join('');
      body = '<div class="th-card th-scroll"><table class="th-table" style="min-width:860px"><thead><tr>'
        + '<th>Channel</th><th>Tier</th>'
        + '<th>ROAS 7d</th><th>ROAS 28d</th>'
        + '<th>Spend 7d</th><th>WoW change</th>'
        + '<th>Spend vs revenue share</th>'
        + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    return ''
      + '<div id="th-channel-ranking">'
      + '<div class="th-title">Channel ranking</div>'
      + '<p class="th-sub">Latest week from <code>ads_throttle/rankings.json</code> then <code>ad_channel_throttles.rankings</code>'
      + ' (week ' + dateTxt + '). Rows sorted by tier then <code>roas_7d</code>. '
      + 'ROAS is <strong>platform-reported</strong>. Missing file stays empty — never invented.</p>'
      + banner
      + body
      + '</div>';
  }

  function attributionHtml() {
    var attr = LIVE.attribution || normalizeAttribution(null);
    var example = !!(LIVE.attributionExample || attr.example);
    var banner = example
      ? '<div class="th-example-banner" role="status">EXAMPLE DATA — test-only fixture, not published attribution</div>'
      : '';
    var asOf = attr.as_of ? esc(attr.as_of) : '<span class="th-unknown">' + UNKNOWN + '</span>';
    var orders = attr.total_orders_7d != null
      ? '<span class="mono">' + countTxt(attr.total_orders_7d) + '</span>'
      : '<span class="th-unknown">' + UNKNOWN + '</span>';
    return ''
      + '<div id="th-attribution-coverage">'
      + '<div class="th-title">Attribution coverage</div>'
      + '<p class="th-sub">Share of Shopify orders from <code>ad_channel_throttles.attribution</code> (as_of ' + asOf + '). '
      + 'Paid-attributed vs Owned vs Unattributed. Missing fields stay <span class="th-unknown">unknown</span> — never invented. '
      + esc(LIVE_RULE_NOTE) + '</p>'
      + banner
      + '<div class="th-card">'
      + '<div class="th-label">Shopify orders · 7d</div>'
      + '<div class="th-val" style="font-size:1.05rem">' + orders + '</div>'
      + attributionStackHtml(attr)
      + '</div>'
      + '</div>';
  }

  function recsTableHtml(recs, settings) {
    return CHANNEL_META.map(function (c) {
      var rec = recs.filter(function (r) { return r.channel === c.id; })[0] || recommend(c.id, settings, LIVE.series, LIVE.changes);
      return rowHtml(c, rec, settings);
    }).join('');
  }

  function changeRows() {
    var entries = changesEntries(LIVE.changes);
    if (!entries.length) return '<tr><td colspan="6">No recent_changes / ads_throttle/changes.json entries.</td></tr>';
    return entries.map(function (e) {
      var oldB = e.old_budget != null ? e.old_budget : e.old;
      var newB = e.new_budget != null ? e.new_budget : e.new;
      var budget = (oldB != null || newB != null)
        ? ((oldB != null ? usd(oldB) : '—') + ' → ' + (newB != null ? usd(newB) : '—'))
        : '—';
      return '<tr>'
        + '<td>' + esc((e.date || e.at || '—').toString().slice(0, 10)) + '</td>'
        + '<td>' + esc(e.channel ? channelLabel(e.channel) : 'all') + '</td>'
        + '<td class="mono">' + (e.roas != null ? merTxt(e.roas) : '—') + '</td>'
        + '<td class="mono">' + (e.spend != null ? usd(e.spend) : '—') + '</td>'
        + '<td>' + esc(e.action || '—') + '</td>'
        + '<td class="mono">' + esc(budget) + (e.summary ? '<div class="th-muted">' + esc(e.summary) + '</div>' : '') + '</td>'
        + '</tr>';
    }).join('');
  }

  function currentRecs() {
    return CHANNEL_META.map(function (c) {
      return recommend(c.id, mergeSettings(LIVE.settings, WHATIF), LIVE.series, LIVE.changes);
    });
  }

  function refreshRecs(rootEl) {
    var body = rootEl.querySelector('#th-recs-body');
    var settings = mergeSettings(LIVE.settings, WHATIF);
    if (body) body.innerHTML = recsTableHtml(currentRecs(), settings);
  }

  function bindWhatIf(rootEl) {
    rootEl.querySelectorAll('[data-th-g]').forEach(function (el) {
      if (el.disabled) return;
      el.addEventListener('input', function () {
        WHATIF.global[el.getAttribute('data-th-g')] = el.value === '' ? null : num(el.value);
        refreshRecs(rootEl);
      });
    });
    rootEl.querySelectorAll('[data-th-ch]').forEach(function (el) {
      if (el.disabled) return;
      el.addEventListener('change', onCh);
      el.addEventListener('input', onCh);
      function onCh() {
        var id = el.getAttribute('data-th-ch');
        var f = el.getAttribute('data-th-f');
        WHATIF.channels[id] = WHATIF.channels[id] || {};
        WHATIF.channels[id][f] = (f === 'mode') ? el.value : (el.value === '' ? null : num(el.value));
        refreshRecs(rootEl);
      }
    });
  }

  function dualLine(canvas, labels, spend, roas, threshold) {
    if (typeof Chart === 'undefined' || !canvas) return null;
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Daily spend', data: spend, yAxisID: 'y', borderColor: '#00d4d4', backgroundColor: 'rgba(0,212,212,0.12)', fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2 },
          { label: 'ROAS', data: roas, yAxisID: 'y1', borderColor: '#f59e0b', backgroundColor: 'transparent', tension: 0.25, pointRadius: 0, borderWidth: 2 },
          { label: '3.0 reference', data: labels.map(function () { return threshold; }), yAxisID: 'y1', borderColor: '#22c55e', borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#8888a8', boxWidth: 10, font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: '#5c5c7a', maxTicksLimit: 8, font: { size: 10 } }, grid: { color: 'rgba(37,37,72,0.7)' } },
          y: { position: 'left', ticks: { color: '#00d4d4', font: { size: 10 }, callback: function (v) { return '$' + Number(v).toLocaleString(); } }, grid: { color: 'rgba(37,37,72,0.7)' } },
          y1: { position: 'right', min: 0, ticks: { color: '#f59e0b', font: { size: 10 }, callback: function (v) { return Number(v).toFixed(1) + 'x'; } }, grid: { drawOnChartArea: false } }
        }
      }
    });
    CHARTS.push(chart);
    return chart;
  }

  function shareChart(canvas, labels, values) {
    if (typeof Chart === 'undefined' || !canvas) return null;
    var palette = ['#00d4d4', '#3b82f6', '#f59e0b', '#a78bfa', '#fb7185', '#34d399', '#8888a8'];
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: { labels: labels, datasets: [{ data: values, backgroundColor: palette, borderColor: '#131328', borderWidth: 2 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { color: '#8888a8', boxWidth: 10, font: { size: 10 } } } }
      }
    });
    CHARTS.push(chart);
    return chart;
  }

  function liveSettingsHtml(live) {
    var g = (live && live.global) || {};
    var channels = (live && live.channels) || {};
    var chHtml = CHANNEL_META.map(function (c) {
      var row = channels[c.id] || {};
      return '<div class="th-card th-ro">'
        + '<div class="th-label">' + esc(c.label) + ' <span class="th-chip ' + esc(row.mode || 'view') + '">' + esc(row.mode || 'view') + '</span></div>'
        + '<div class="th-form" style="grid-template-columns:1fr 1fr 1fr">'
        + '<div><label>mode</label><input disabled value="' + esc(row.mode || 'view') + '"></div>'
        + '<div><label>min daily</label><input disabled value="' + esc(row.min_daily_budget == null ? '' : row.min_daily_budget) + '" placeholder="none"></div>'
        + '<div><label>max daily</label><input disabled value="' + esc(row.max_daily_budget == null ? '' : row.max_daily_budget) + '" placeholder="none"></div>'
        + '</div>'
        + (row.notes ? '<div class="th-muted">' + esc(row.notes) + '</div>' : '')
        + (row.owner_bot ? '<div class="th-muted">Owner: ' + esc(row.owner_bot) + '</div>' : '')
        + '</div>';
    }).join('');
    return { global: g, chHtml: chHtml };
  }

  function merVsLine(canvas, labels, mer, threshold) {
    if (typeof Chart === 'undefined' || !canvas) return null;
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Blended MER',
            data: mer,
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 2
          },
          {
            label: '3.0 reference',
            data: labels.map(function () { return threshold; }),
            borderColor: '#22c55e',
            borderDash: [5, 4],
            pointRadius: 0,
            borderWidth: 1.5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#8888a8', boxWidth: 10, font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: '#5c5c7a', maxTicksLimit: 8, font: { size: 10 } }, grid: { color: 'rgba(37,37,72,0.7)' } },
          y: { min: 0, ticks: { color: '#f59e0b', font: { size: 10 }, callback: function (v) { return Number(v).toFixed(1) + 'x'; } }, grid: { color: 'rgba(37,37,72,0.7)' } }
        }
      }
    });
    CHARTS.push(chart);
    return chart;
  }

  function series28() {
    return (LIVE.snapshot && LIVE.snapshot.series_28d) || null;
  }

  function render() {
    var panel = ensureTab();
    if (!panel) return;
    injectCss();
    destroyCharts();
    var liveSettings = LIVE.snapshot && LIVE.snapshot.settings ? normalizeSettings(LIVE.snapshot.settings) : LIVE.settings;
    var settings = mergeSettings(liveSettings, WHATIF);
    var series = LIVE.series || { days: [] };
    var snap = LIVE.snapshot || {};
    var s28 = series28();
    var blended = (s28 && s28.blended) || (series.days || []).map(function (d) {
      return { date: d.date, blended_mer: d.blended_mer, d2c_ad_spend: d.d2c_ad_spend, total_ad_spend: d.total_ad_spend, shopify_revenue: d.shopify_d2c_revenue };
    });
    var last = blended.length ? blended[blended.length - 1] : latestDay(series);
    var recs = currentRecs();
    var threshold = num((settings.global || {}).roas_threshold) || 3;
    var d2cSpend = snap.d2c_ad_spend != null ? snap.d2c_ad_spend : (last && last.d2c_ad_spend);
    var totalSpend = snap.total_ad_spend != null ? snap.total_ad_spend : (last && last.total_ad_spend);
    var shop = snap.shopify_d2c_revenue != null ? snap.shopify_d2c_revenue : (last && (last.shopify_revenue != null ? last.shopify_revenue : last.shopify_d2c_revenue));
    var mer = snap.blended_mer != null ? snap.blended_mer : (last && last.blended_mer);
    var merDelta = snap.blended_mer_vs_threshold != null ? snap.blended_mer_vs_threshold : (mer != null ? num(mer) - threshold : null);
    var g = settings.global || {};
    var labels = blended.map(function (d) { return String(d.date || '').slice(5); });
    var merSeries = blended.map(function (d) { return d.blended_mer == null ? null : num(d.blended_mer); });
    var shareLabels = [];
    var shareVals = [];
    CHANNEL_META.forEach(function (c) {
      var rows = (s28 && s28.by_channel && s28.by_channel[c.id]) || [];
      var sum = 0;
      rows.forEach(function (d) { if (d.spend != null) sum = round2(sum + num(d.spend)); });
      shareLabels.push(c.label);
      shareVals.push(sum);
    });
    var liveUi = liveSettingsHtml(liveSettings);

    panel.innerHTML = ''
      + '<div class="th-wrap">'
      + '<div class="th-title">Ad Channel Throttles</div>'
      + '<h2 class="th-h">Read-only channel controls</h2>'
      + '<p class="th-sub">Snapshot <code>ad_channel_throttles</code> (as_of ' + esc(snap.as_of || '—') + ') · <code>throttle_settings</code> / <code>ads_throttle/settings.json</code> · <code>recent_changes</code>. Status fields with <span class="th-unverified">unverified</span> are not invented.</p>'
      + '<div class="th-note">Live settings change only through Jarvis in chat. '
      + '<a class="th-btn" style="margin-left:8px" target="_blank" rel="noopener" href="' + esc(requestChangeUrl(liveSettings)) + '">Request change</a></div>'
      + '<div class="th-kpis">'
      + '<div class="th-card"><div class="th-label">D2C ad spend</div><div class="th-val">' + usd(d2cSpend) + '</div><div class="th-muted">d2c_ad_spend · vs Shopify D2C → blended MER</div></div>'
      + '<div class="th-card"><div class="th-label">All ad spend</div><div class="th-val">' + usd(totalSpend) + '</div><div class="th-muted">total_ad_spend · company</div></div>'
      + '<div class="th-card"><div class="th-label">Shopify D2C revenue</div><div class="th-val">' + usd(shop) + '</div><div class="th-muted">shopify_d2c_revenue · ' + esc(snap.as_of || '—') + '</div></div>'
      + '<div class="th-card"><div class="th-label">Blended MER vs 3.0</div><div class="th-val">' + merTxt(mer) + '</div><div class="th-muted">' + (merDelta == null ? 'no MER' : (merDelta >= 0 ? '+' : '') + Number(merDelta).toFixed(2) + ' vs 3.0') + ' · blended_mer</div></div>'
      + '</div>'
      + '<div class="th-grid">'
      + '<div class="th-card"><div class="th-label">Blended MER trend · 28d vs 3.0</div><div class="th-chart"><canvas id="th-mer-chart"></canvas></div></div>'
      + '<div class="th-card"><div class="th-label">Budget share · 28d spend</div><div class="th-chart"><canvas id="th-share-chart"></canvas></div></div>'
      + '</div>'
      + trackingHealthHtml()
      + rankingHtml()
      + '<div id="th-shopify-attribution">'
      + attributionHtml()
      + '<div class="th-title">Channels</div>'
      + '<p class="th-sub">Shopify ROAS (7d), platform-reported ROAS (7d), coverage %, and Rule uses from <code>channels[ch]</code>. '
      + esc(LIVE_RULE_NOTE) + '</p>'
      + '<div class="th-card th-scroll"><table class="th-table th-wide"><thead><tr>'
      + '<th>Channel</th><th>Daily budget</th><th>7d spend</th><th>Shopify rev</th>'
      + '<th>Shopify ROAS (7d)</th><th>Platform ROAS (7d)</th><th>Coverage %</th><th>Rule uses</th>'
      + '<th>3d trend</th><th>Destination</th><th>Rule</th><th>Last change / next</th><th>Owner bot</th><th>Strategy notes</th>'
      + '</tr></thead><tbody id="th-recs-body">'
      + recsTableHtml(recs, settings)
      + '</tbody></table></div>'
      + '</div>'
      + '<div class="th-title" style="margin-top:20px">Per channel · 28d spend + ROAS</div>'
      + '<div class="th-channels" id="th-channel-cards">'
      + CHANNEL_META.map(function (c) {
        var rec = recs.filter(function (r) { return r.channel === c.id; })[0];
        return '<div class="th-card"><div class="th-label">' + esc(c.label) + ' <span class="th-chip ' + badgeClass(rec && rec.label) + '">' + esc((rec && rec.label) || '') + '</span></div>'
          + '<div class="th-muted">series_28d.by_channel.' + esc(c.id) + ' · ROAS basis ' + esc(basisLabel(rec && rec.roas_basis)) + '</div>'
          + '<div class="th-chart"><canvas id="th-ch-' + c.id + '"></canvas></div></div>';
      }).join('')
      + '</div>'
      + '<div class="th-title">Live settings · read only</div>'
      + '<div class="th-card"><div class="th-label">Global</div><div class="th-form">'
      + '<div><label>threshold</label><input disabled value="' + esc(liveUi.global.roas_threshold) + '"></div>'
      + '<div><label>step %</label><input disabled value="' + esc(liveUi.global.step_pct) + '"></div>'
      + '<div><label>min spend 7d</label><input disabled value="' + esc(liveUi.global.min_spend_7d) + '"></div>'
      + '<div><label>scale cooldown</label><input disabled value="' + esc(liveUi.global.scale_cooldown_days) + '"></div>'
      + '<div><label>cut cooldown</label><input disabled value="' + esc(liveUi.global.cut_cooldown_days) + '"></div>'
      + '</div>'
      + '<div class="th-muted" style="margin-top:8px">Updated ' + esc((liveSettings && liveSettings.updated_at) || '—') + ' · ' + esc((liveSettings && liveSettings.updated_by) || '') + ' · roas_basis ' + esc(basisLabel(liveUi.global.roas_basis)) + '</div></div>'
      + '<div class="th-channels">' + liveUi.chHtml + '</div>'
      + '<div class="th-title">What-if · client-side only</div>'
      + '<p class="th-sub">These inputs recompute the recommended action in this browser only. They do not write <code>throttle_settings</code>.</p>'
      + '<div class="th-card"><div class="th-form">'
      + '<div><label>Threshold</label><input data-th-g="roas_threshold" type="number" step="0.1" value="' + esc(g.roas_threshold) + '"></div>'
      + '<div><label>Step %</label><input data-th-g="step_pct" type="number" step="1" value="' + esc(g.step_pct) + '"></div>'
      + '<div><label>Min spend 7d</label><input data-th-g="min_spend_7d" type="number" step="1" value="' + esc(g.min_spend_7d) + '"></div>'
      + '<div><label>Scale cooldown (d)</label><input data-th-g="scale_cooldown_days" type="number" step="1" value="' + esc(g.scale_cooldown_days) + '"></div>'
      + '<div><label>Cut cooldown (d)</label><input data-th-g="cut_cooldown_days" type="number" step="1" value="' + esc(g.cut_cooldown_days) + '"></div>'
      + '</div></div>'
      + '<div class="th-title" style="margin-top:20px">Change log</div>'
      + '<div class="th-card th-scroll"><table class="th-table"><thead><tr><th>Date</th><th>Channel</th><th>ROAS</th><th>Spend</th><th>Action</th><th>Old → new budget</th></tr></thead><tbody>'
      + changeRows()
      + '</tbody></table></div>'
      + '</div>';

    merVsLine(document.getElementById('th-mer-chart'), labels, merSeries, threshold);
    shareChart(document.getElementById('th-share-chart'), shareLabels, shareVals);
    CHANNEL_META.forEach(function (c) {
      var rows = (s28 && s28.by_channel && s28.by_channel[c.id]) || [];
      var chLabels = rows.map(function (d) { return String(d.date || '').slice(5); });
      var spend = rows.map(function (d) { return d.spend == null ? null : num(d.spend); });
      var roas = rows.map(function (d) {
        if (d.platform_roas != null && d.platform_status !== 'unverified') return num(d.platform_roas);
        if (d.roas != null && d.roas_status !== 'unverified') return num(d.roas);
        return null;
      });
      dualLine(document.getElementById('th-ch-' + c.id), chLabels.length ? chLabels : labels, spend, roas, threshold);
    });
    bindWhatIf(panel);
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status));
    });
  }

  function openFromHash() {
    if (typeof location === 'undefined') return;
    var h = location.hash;
    if (h !== '#throttles' && h !== '#ad-channel-throttles' && h !== '#ad_channel_throttles') return;
    var btn = document.querySelector('.tab[data-tab="throttles"]');
    if (btn) btn.click();
  }

  function pickMerBlock(doc, key) {
    if (!doc || typeof doc !== 'object') return null;
    if (doc[key]) return doc[key];
    return null;
  }

  function boot() {
    ensureTab();
    injectCss();
    Promise.allSettled([
      fetchJson(SNAPSHOT_PATH),
      fetchJson(SETTINGS_PATH),
      fetchJson(SETTINGS_FALLBACK),
      fetchJson(CHANGES_PATH),
      fetchJson(SERIES_PATH),
      fetchJson('mer_for_manus.json'),
      fetchJson(HEALTH_PATH),
      fetchJson(RANKINGS_PATH),
      exampleRankingRequested() ? fetchJson(RANKINGS_EXAMPLE_PATH) : Promise.reject(new Error('skip ranking example')),
      exampleAttributionRequested() ? fetchJson(ATTRIBUTION_EXAMPLE_PATH) : Promise.reject(new Error('skip attribution example')),
      examplePinterestRequested() ? fetchJson(PINTEREST_EXAMPLE_PATH) : Promise.reject(new Error('skip pinterest example'))
    ]).then(function (results) {
      var mer = results[5].status === 'fulfilled' ? results[5].value : null;
      LIVE.snapshot = results[0].status === 'fulfilled' ? results[0].value : pickMerBlock(mer, 'ad_channel_throttles');
      var settings = (LIVE.snapshot && LIVE.snapshot.settings) || null;
      if (!settings && results[1].status === 'fulfilled') settings = results[1].value;
      if (!settings && results[2].status === 'fulfilled') settings = results[2].value;
      if (!settings) settings = pickMerBlock(mer, 'throttle_settings') || (LIVE.snapshot && LIVE.snapshot.throttle_settings);
      LIVE.settings = normalizeSettings(settings);
      LIVE.changes = results[3].status === 'fulfilled' ? results[3].value : { entries: [] };
      LIVE.series = results[4].status === 'fulfilled' ? results[4].value : { days: [] };
      var health = results[6].status === 'fulfilled' ? results[6].value : null;
      if (!health && LIVE.snapshot) health = LIVE.snapshot.tracking_health || null;
      if (!health) health = pickMerBlock(mer, 'tracking_health');
      LIVE.health = normalizeHealth(health);
      var rankings = results[8].status === 'fulfilled' ? results[8].value : null;
      if (!rankings) rankings = results[7].status === 'fulfilled' ? results[7].value : null;
      if (!rankings && LIVE.snapshot) rankings = LIVE.snapshot.rankings || null;
      LIVE.rankings = normalizeRankings(rankings);
      LIVE.attributionExample = false;
      if (results[9] && results[9].status === 'fulfilled' && results[9].value) {
        LIVE.snapshot = applyAttributionExample(LIVE.snapshot, results[9].value);
        LIVE.attributionExample = true;
      }
      if (results[10] && results[10].status === 'fulfilled' && results[10].value) {
        var pin = applyPinterestExample(LIVE.snapshot, health, rankings, results[10].value);
        LIVE.snapshot = pin.snapshot;
        health = pin.health;
        LIVE.health = normalizeHealth(health);
        rankings = pin.rankings;
        LIVE.rankings = normalizeRankings(rankings);
        LIVE.attributionExample = true;
        LIVE.pinterestExample = true;
      }
      LIVE.attribution = normalizeAttribution(LIVE.snapshot && LIVE.snapshot.attribution);
      var panel = document.getElementById('tab-throttles');
      if (panel && panel.classList.contains('active')) render();
      openFromHash();
    });
  }

  var api = {
    CHANNEL_META: CHANNEL_META,
    HEALTH_CHANNELS: HEALTH_CHANNELS,
    HOLD_TRACKING_DOWN: HOLD_TRACKING_DOWN,
    UNKNOWN: UNKNOWN,
    recommend: recommend,
    mergeSettings: mergeSettings,
    normalizeSettings: normalizeSettings,
    normalizeHealth: normalizeHealth,
    healthStatus: healthStatus,
    channelHealth: channelHealth,
    formatEt: formatEt,
    channelSpend7: channelSpend7,
    channelSpend7ForRule: channelSpend7ForRule,
    channelD2cSpend7: channelD2cSpend7,
    windowTotals: windowTotals,
    requestChangeUrl: requestChangeUrl,
    channelSpend: channelSpend,
    destLabel: destLabel,
    UNVERIFIED: UNVERIFIED,
    render: render,
    rankingHtml: rankingHtml,
    normalizeRankings: normalizeRankings,
    latestRankingWeek: latestRankingWeek,
    sortRankingChannels: sortRankingChannels,
    normalizeTier: normalizeTier,
    tierChipClass: tierChipClass,
    wowTxt: wowTxt,
    EMPTY_RANKING_COPY: EMPTY_RANKING_COPY,
    trackingHealthHtml: trackingHealthHtml,
    HEALTH_PATH: HEALTH_PATH,
    RANKINGS_PATH: RANKINGS_PATH,
    RANKINGS_EXAMPLE_PATH: RANKINGS_EXAMPLE_PATH,
    ATTRIBUTION_EXAMPLE_PATH: ATTRIBUTION_EXAMPLE_PATH,
    LIVE_RULE_NOTE: LIVE_RULE_NOTE,
    attributionHtml: attributionHtml,
    channelsTableHtml: function () {
      return recsTableHtml(currentRecs(), mergeSettings(LIVE.settings, WHATIF));
    },
    normalizeAttribution: normalizeAttribution,
    applyAttributionExample: applyAttributionExample,
    channelAttribution: channelAttribution,
    coverageChipClass: coverageChipClass,
    coverageChipHtml: coverageChipHtml,
    displayCoveragePct: displayCoveragePct,
    normalizeRoasSource: normalizeRoasSource,
    roasSourceLabel: roasSourceLabel,
    applyPinterestExample: applyPinterestExample,
    pinterestKnownGapText: pinterestKnownGapText,
    PINTEREST_KNOWN_GAP: PINTEREST_KNOWN_GAP,
    PINTEREST_ROAS_WINDOW: PINTEREST_ROAS_WINDOW,
    trackingHealthHtml: trackingHealthHtml,
    _setLive: function (settings, series, changes, snapshot, health, rankings, attributionExample, pinterestExample) {
      LIVE.settings = normalizeSettings(settings || null);
      LIVE.series = series || { days: [] };
      LIVE.changes = changes != null ? changes : { entries: [] };
      LIVE.snapshot = snapshot || null;
      LIVE.health = normalizeHealth(health != null ? health : (snapshot && snapshot.tracking_health));
      var rankSrc = rankings !== undefined ? rankings : (snapshot && snapshot.rankings);
      LIVE.rankings = normalizeRankings(rankSrc);
      LIVE.attributionExample = false;
      LIVE.pinterestExample = false;
      if (attributionExample) {
        LIVE.snapshot = applyAttributionExample(LIVE.snapshot, attributionExample);
        LIVE.attributionExample = true;
      }
      if (pinterestExample) {
        var pin = applyPinterestExample(LIVE.snapshot, LIVE.health, rankSrc, pinterestExample);
        LIVE.snapshot = pin.snapshot;
        LIVE.health = normalizeHealth(pin.health);
        LIVE.rankings = normalizeRankings(pin.rankings);
        LIVE.attributionExample = true;
        LIVE.pinterestExample = true;
      }
      LIVE.attribution = normalizeAttribution(LIVE.snapshot && LIVE.snapshot.attribution);
      WHATIF = { global: {}, channels: {} };
    },
    _setWhatIf: function (whatif) {
      WHATIF = {
        global: (whatif && whatif.global) || {},
        channels: (whatif && whatif.channels) || {}
      };
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Throttles = api;
  root.renderThrottles = render;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
    else setTimeout(boot, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
