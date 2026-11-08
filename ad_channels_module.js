/* =====================================================================
   COLDEST · AD CHANNELS  (one block per ad platform, daily)
   ---------------------------------------------------------------------
   Reporting-only. No API credentials. Never invents spend, revenue,
   conversions, ROAS, rankings or tracking health — every number on the
   tab is read from a published feed and labelled with its source and
   as-of date. A channel without a feed renders "—", not $0 ROAS.

   Inputs (all optional; the tab degrades per field):
     • Embedded PARTIAL_REPORTS / REPORTS rows → advertising_sources
       (spend per channel per day — the same numbers the Daily Reports
       tab shows; refreshed by the mirror sync every day).
     • mer_for_manus.json (data repo rebuild_mer.py):
         advertising_sources[YYYY-MM-DD].<channel>_ads — spend, clicks,
           conversions, platform-reported revenue / ROAS, live, source
         ad_channel_throttles.series_28d.by_channel — verified daily
           spend + platform revenue with explicit status
         ad_channel_throttles.series_28d.blended — Shopify D2C revenue,
           D2C ad spend, blended MER per day
         ad_channel_throttles.channels[ch] — mode, rule_status, tracking,
           last_change_*, next_eligible_date, launch dates
         <channel>.by_date — per-channel block fallback (x: cash_cost)
     • ads_throttle/settings.json   — Jarvis modes (auto/hold/frozen/view)
     • ads_throttle/changes.json    — Jarvis budget actions (raise / cut / kill)
     • ads_throttle/rankings.json   — Jarvis weekly tiers + platform ROAS
     • ads_throttle/tracking_health.json — OK / WARN / DOWN per channel
     • advertising_sources_daily.json — date-keyed CFO export (fills PARTIAL gaps;
       canonical keys or aliases; a day not present is missing, not $0)
     • <channel>_ads_daily.json    — per-channel CFO export (box runner files)
     • <channel>_ads_data.json     — optional manual file; empty pre-launch / no_feed
       stubs are ignored (they are not measured $0)
     • ads_throttle/series.json     — older daily spend fallback (source:no_feed skipped)

   Completeness (null vs measured zero):
     spend is a number (including 0) only when the node is measured:
       complete === true, closed_day === true, spend_status === 'verified',
       or an explicit not-live published zero. Bare null / missing key /
       status missing|no_feed / source no_feed / $0 after a durable feed
       stops = missing (display "—"), never a false $0.
     Platform ROAS uses that channel's own platform_revenue/roas over the
     days it reported; Meta / Google spend-only nodes stay "—".

   Verdicts are derived, labelled and explained:
     growth  = measured spend over the selected window (yesterday / 7 / 14 / 28 /
               60 / 90 days) vs the same length before (±15 %); the selector drives
               every panel, the daily charts never show fewer than 7 days
     posture = Jarvis mode + last budget action (≤ 14 days) + tracking
   Platform ROAS = platform-reported conversion value ÷ spend, summed over
   the days the platform reported; display-only, never store revenue.
   ===================================================================== */
(function (root) {
  'use strict';

  var CHANNELS = [
    { id: 'meta', label: 'Meta', srcKeys: ['meta', 'meta_ads', 'facebook', 'fb_ads'], color: '#3987e5', d2c: true, file: 'meta_ads_data.json' },
    { id: 'google', label: 'Google Ads', srcKeys: ['google_ads', 'google', 'google_advertising'], color: '#d95926', d2c: true, file: 'google_ads_data.json' },
    { id: 'tiktok', label: 'TikTok Ads', srcKeys: ['tiktok_ads', 'tiktok'], color: '#199e70', d2c: 'partial', note: 'Shop ads + website; only the website share is D2C', file: 'tiktok_ads_data.json' },
    { id: 'bing', label: 'Bing / Microsoft', srcKeys: ['bing_ads', 'bing', 'microsoft_ads', 'microsoft_advertising', 'microsoft'], color: '#c98500', d2c: 'partial', note: 'Amazon-bound campaign is not D2C', file: 'bing_ads_data.json' },
    { id: 'snapchat', label: 'Snapchat', srcKeys: ['snapchat_ads', 'snapchat', 'snap'], color: '#d55181', d2c: true, file: 'snapchat_ads_data.json' },
    { id: 'applovin', label: 'AppLovin', srcKeys: ['applovin', 'applovin_ads', 'app_lovin', 'appLovin'], color: '#008300', d2c: true, file: 'applovin_ads_data.json' },
    { id: 'pinterest', label: 'Pinterest', srcKeys: ['pinterest_ads', 'pinterest'], color: '#9085e9', d2c: true, file: 'pinterest_ads_data.json' },
    { id: 'chatgpt', label: 'ChatGPT Ads', srcKeys: ['chatgpt_ads', 'chatgpt', 'openai_ads'], color: '#e66767', d2c: true, file: 'chatgpt_ads_data.json' },
    { id: 'reddit', label: 'Reddit', srcKeys: ['reddit_ads', 'reddit'], color: '#8888a8', other: true, d2c: true, file: 'reddit_ads_data.json' },
    { id: 'taboola', label: 'Taboola', srcKeys: ['taboola_ads', 'taboola'], color: '#8888a8', other: true, d2c: true, darkWhenZero: true, file: 'taboola_ads_data.json' },
    { id: 'outbrain', label: 'Outbrain', srcKeys: ['outbrain_ads', 'outbrain'], color: '#8888a8', other: true, d2c: true, darkWhenZero: true, note: 'Manual daily feed (outbrain ads); a day not imported is missing', file: 'outbrain_ads_data.json' },
    { id: 'x', label: 'X Ads', srcKeys: ['x_ads', 'x', 'twitter_ads', 'twitter'], color: '#8888a8', other: true, d2c: true, note: 'Only cash cost (spend − credit + Premium fee) folds into MER', file: 'x_ads_data.json', cashCost: true },
    // Spotify Ads (canonical feed key spotify_ads). No feed until CFO publishes spotify_ads in
    // advertising_sources_daily.json / spotify_ads_daily.json (coldest-cfo-dashboard). Unmeasured days render
    // "No data" (never $0); unknown spend is excluded from tracked / D2C totals and labelled as coverage.
    { id: 'spotify', label: 'Spotify Ads', srcKeys: ['spotify_ads', 'spotify', 'Spotify', 'Spotify Ads'], color: '#1db954', other: true, d2c: true, cashCost: true, noDataLabel: 'No data', note: 'Platform spend only; any billing / cash cost is shown separately and never added to spend', file: 'spotify_ads_data.json' }
  ];
  var OTHER_COLOR = '#8888a8';
  // Platform units = the rows of PARTIAL_REPORTS[].performance.platforms (cfo_backend/performance.py):
  // each platform's own spend AND attributed purchase value from the same query, on the platform's
  // own day / attribution window. TikTok reports Shop (GMV Max) and website separately.
  var PLATFORM_UNITS = [
    { id: 'meta', channel: 'meta', label: 'Meta' },
    { id: 'google_ads', channel: 'google', label: 'Google Ads' },
    { id: 'tiktok_shop', channel: 'tiktok', label: 'TikTok Shop · GMV Max', d2c: false },
    { id: 'tiktok_web', channel: 'tiktok', label: 'TikTok · website' },
    { id: 'snapchat_ads', channel: 'snapchat', label: 'Snapchat' },
    { id: 'applovin', channel: 'applovin', label: 'AppLovin' },
    { id: 'pinterest_ads', channel: 'pinterest', label: 'Pinterest' },
    { id: 'bing_ads', channel: 'bing', label: 'Bing / Microsoft' },
    { id: 'reddit_ads', channel: 'reddit', label: 'Reddit' },
    { id: 'chatgpt_ads', channel: 'chatgpt', label: 'ChatGPT Ads' },
    { id: 'taboola_ads', channel: 'taboola', label: 'Taboola' },
    { id: 'outbrain_ads', channel: 'outbrain', label: 'Outbrain' },
    { id: 'x_ads', channel: 'x', label: 'X Ads' }
  ];
  var LOW_SPEND = 100;          // performance.py LOW_SPEND: below this a day's ROAS is not judged
  var HEATMAP_DAYS = 14;
  var GROWTH_PCT = 15;          // ±15 % week over week
  var ACTION_RECENT_DAYS = 14;  // a Jarvis raise/cut older than this is history, not posture
  var WINDOWS = [1, 7, 14, 28, 60, 90];   // 1 = yesterday view
  var DEFAULT_WINDOW = 7;
  var MIN_CHART_DAYS = 7;       // the time-series panels never show fewer days than this
  var MAX_HEATMAP_DAYS = 28;    // wider windows show their last 28 days in the heatmap
  function winLabel(n) { return n === 1 ? 'YESTERDAY' : n + ' DAYS'; }
  function winShort(n) { return n === 1 ? 'yesterday' : n + 'd'; }
  function winBtn(n) { return n === 1 ? 'YDAY' : n + 'D'; }
  var MAX_STACK_SERIES = 7;     // top 7 by window spend + Other (fixed palette, never cycled)
  var ADV_DAILY_FILE = 'advertising_sources_daily.json';
  // Only fetch *_ads_data.json overlays that this repo actually ships (stubs). The
  // other channels 404 on Pages today; CFO spend lands in *_ads_daily.json instead.
  var OPTIONAL_DATA_FILES = {
    bing: 'bing_ads_data.json',
    chatgpt: 'chatgpt_ads_data.json',
    reddit: 'reddit_ads_data.json',
    snapchat: 'snapchat_ads_data.json',
    pinterest: 'pinterest_ads_data.json'
  };
  var ALIASES = {};
  CHANNELS.forEach(function (ch) {
    ALIASES[ch.id] = ch.id;
    (ch.srcKeys || []).forEach(function (k) { ALIASES[k] = ch.id; ALIASES[String(k).toLowerCase()] = ch.id; });
  });
  function canonicalId(key) {
    if (key == null) return null;
    var s = String(key);
    if (ALIASES[s]) return ALIASES[s];
    var lower = s.toLowerCase();
    if (ALIASES[lower]) return ALIASES[lower];
    var norm = lower.replace(/[\s-]+/g, '_').replace(/_advertising$/, '_ads');
    if (ALIASES[norm]) return ALIASES[norm];
    var stripped = norm.replace(/_ads$/, '');
    if (ALIASES[stripped]) return ALIASES[stripped];
    return null;
  }
  function dailyFileName(ch) { return ch.id + '_ads_daily.json'; }
  // Upstream publish contract (CFO / data repo). Empty *_ads_data.json stubs are
  // not this feed. A missing calendar day is omitted or {missing:true} — never a
  // bare spend:0 without complete/closed_day/spend_status.
  var SCHEMA_CONTRACT = {
    advertising_sources_daily: {
      file: ADV_DAILY_FILE,
      shape: 'date-keyed map or {advertising_sources:{YYYY-MM-DD:{<alias>: node}}} or {daily:[{date, ...channels}]}',
      aliases: ALIASES,
      node: '{spend, complete|closed_day|spend_status, live, source, platform_revenue?, platform_roas?, conversions?, clicks?, impressions?, spend_d2c?, spend_amazon?, destination?, cash_cost?}',
      measured_zero: 'spend:0 AND (complete:true | closed_day:true | spend_status:verified | live:false with status not_live|pre_launch|not_launched|dark). Measured zeros stay $0 even after the last positive day (paused Pinterest, never-launched Outbrain).',
      missing: 'omit the day, or spend:null / missing:true / status missing|no_feed|unpublished / bare {spend:0} without the flags above. Prefer the nested advertising_sources map. Do not calendar-fill unmarked $0 after a durable stop.',
      cash_cost: 'x_ads and spotify_ads may carry cash_cost (billing / cash cost) next to platform spend. spend stays platform spend; cash_cost is displayed separately and never summed into spend.'
    },
    spotify_ads: {
      key: 'spotify_ads (aliases spotify, Spotify, Spotify Ads)',
      daily_file: 'spotify_ads_daily.json',
      missing: 'an unmeasured day is omitted or spend:null + missing:true (or spend_status unverified) — never spend:0 with complete/closed_day. It renders "No data" and is excluded from tracked / D2C spend with explicit coverage.',
      measured_zero: 'spend:0 only with complete:true | closed_day:true | spend_status:verified (or live:false + status not_launched).',
      not_launched: 'settings.channels.spotify(.not_launched_while_zero) or mer.spotify / mer.spotify_ads {status:not_launched, live:false} → NOT LAUNCHED, no metrics.',
      platform: 'platform_revenue / platform_roas only when Spotify reports them; spend-only rows keep ROAS "No data".',
      cash_cost: 'optional; kept separate from platform spend (same as x_ads)'
    },
    channel_ads_daily: {
      file: '<id>_ads_daily.json',
      shape: 'date-keyed map or {by_date|by_day|daily|days}',
      platform: 'platform_revenue / platform_roas / conversions are that channel only; Meta/Google may be spend-only (ROAS stays —)'
    },
    channel_ads_data: {
      file: '<id>_ads_data.json',
      note: 'optional manual overlay. status pre_launch|no_feed with daily:[] is a stub and is ignored (not $0)'
    }
  };
  // Channel-keyed config / block (settings.channels, throttles.channels, tracking.channels,
  // mer.<id>): canonical id first, then any alias (e.g. spotify_ads).
  function chEntry(map, ch) {
    if (!map || typeof map !== 'object' || !ch) return null;
    if (map[ch.id] != null) return map[ch.id];
    var keys = ch.srcKeys || [];
    for (var i = 0; i < keys.length; i++) if (map[keys[i]] != null) return map[keys[i]];
    return null;
  }
  function nodeFromAdv(adv, ch) {
    if (!adv || typeof adv !== 'object' || !ch) return undefined;
    var node = pick(adv, ch.srcKeys);
    if (node !== undefined) return node;
    Object.keys(adv).forEach(function (k) {
      if (canonicalId(k) === ch.id && node === undefined) node = adv[k];
    });
    return node;
  }

  /* ------------------------------------------------------------ utils */
  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function n0(v) { var n = num(v); return n == null ? 0 : n; }
  function round2(v) { return Math.round(n0(v) * 100) / 100; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function usd(v, digits) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    var d = digits == null ? 0 : digits;
    var n = Number(v);
    var s = '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
    return n < 0 ? '−' + s : s;
  }
  function pct(v, digits) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    var n = Number(v);
    return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(digits == null ? 0 : digits) + '%';
  }
  function roasTxt(v) {
    return v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(2) + 'x';
  }
  function intTxt(v) {
    return v == null || !Number.isFinite(Number(v)) ? '—' : Math.round(Number(v)).toLocaleString();
  }
  // Channels with noDataLabel (Spotify) say "No data" where others show "—": a day / window
  // with no measured row. Never paired with a number for the same field.
  function dv(ch, txt) { return (txt === '—' && ch && ch.noDataLabel) ? ch.noDataLabel : txt; }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function addDays(date, n) {
    var d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  }
  function shortDate(date) {
    if (!isDate(date)) return '—';
    var d = new Date(date + 'T00:00:00Z');
    var wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    return wd + ' ' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
  }
  function mmdd(date) {
    if (!isDate(date)) return '—';
    return String(Number(date.slice(5, 7))) + '/' + String(Number(date.slice(8, 10)));
  }
  function pick(map, keys) {
    if (!map || typeof map !== 'object') return undefined;
    for (var i = 0; i < keys.length; i++) {
      if (Object.prototype.hasOwnProperty.call(map, keys[i]) && map[keys[i]] != null) return map[keys[i]];
    }
    return undefined;
  }
  // A node is a placeholder (not a published day) when the pipeline explicitly
  // says there is no feed / the day is missing / a $0 stub is pre-launch.
  // Published live $0 (Pinterest paused, Taboola 0 campaigns with a pulled row)
  // is NOT a placeholder — those days are real zeros.
  function isPlaceholderNode(node) {
    if (node == null || node === false) return true;
    if (typeof node !== 'object') return false;
    if (node.missing === true) return true;
    if (node.data_available === false || node.zero_assumed === true) return true;
    var st = node.status != null ? String(node.status) : '';
    if (st === 'missing' || st === 'no_feed' || st === 'unpublished' || st === 'no_data') return true;
    if (st === 'pre_launch' && (node.spend == null || n0(node.spend) === 0) && !node.complete) return true;
    var src = node.source != null ? String(node.source) : '';
    if ((src === 'no_feed' || src === 'no feed' || src === 'none') && (node.spend == null || n0(node.spend) === 0)) return true;
    return false;
  }
  // $0 is a real published zero only when the feed marked the day complete.
  // A $0 without those flags (calendar fill, stub, copied-forward row) is missing.
  function isMeasuredZero(node) {
    if (node == null) return false;
    if (typeof node === 'number' || typeof node === 'string') return num(node) === 0;
    if (typeof node !== 'object') return false;
    if (isPlaceholderNode(node)) return false;
    var s = num(node.spend);
    if (s == null) s = num(node.daily_spend);
    if (s == null) s = num(node.ad_spend);
    if (s !== 0) return false;
    if (node.complete === true || node.closed_day === true) return true;
    if (node.spend_status === 'verified') return true;
    var st = node.status != null ? String(node.status) : '';
    if (node.live === false && (st === 'not_live' || st === 'pre_launch' || st === 'not_launched' || st === 'dark')) return true;
    return false;
  }
  function asDateMap(doc) {
    if (!doc || typeof doc !== 'object') return {};
    if (Array.isArray(doc)) {
      var fromArr = {};
      doc.forEach(function (row) { if (row && isDate(row.date)) fromArr[row.date] = row; });
      return fromArr;
    }
    if (doc.advertising_sources && typeof doc.advertising_sources === 'object') return asDateMap(doc.advertising_sources);
    var nested = doc.by_date || doc.by_day;
    if (nested && typeof nested === 'object') return asDateMap(nested);
    if (Array.isArray(doc.daily) || Array.isArray(doc.days)) {
      var fromDaily = {};
      (doc.daily || doc.days).forEach(function (row) {
        if (!row) return;
        if (isDate(row.date)) fromDaily[row.date] = row;
      });
      return fromDaily;
    }
    var keys = Object.keys(doc);
    var dates = keys.filter(isDate);
    if (!dates.length) return {};
    var META = { as_of: 1, asOf: 1, source: 1, status: 1, message: 1, schema_version: 1, generated_at: 1, updated_at: 1, channel: 1, account_id: 1, note: 1, notes: 1 };
    var unknown = keys.filter(function (k) {
      return !isDate(k) && k.charAt(0) !== '_' && !META[k];
    });
    if (!unknown.length || dates.length >= unknown.length) {
      var map = {};
      dates.forEach(function (d) { map[d] = doc[d]; });
      return map;
    }
    return {};
  }
  function hostArray(name) {
    var g = typeof globalThis !== 'undefined' ? globalThis : root;
    try {
      if (name === 'REPORTS' && typeof REPORTS !== 'undefined') return REPORTS;
      if (name === 'PARTIAL_REPORTS' && typeof PARTIAL_REPORTS !== 'undefined') return PARTIAL_REPORTS;
    } catch (e) { /* node */ }
    return g && Array.isArray(g[name]) ? g[name] : null;
  }
  function byId(id) {
    for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].id === id) return CHANNELS[i];
    return null;
  }
  function unitById(id) {
    for (var i = 0; i < PLATFORM_UNITS.length; i++) if (PLATFORM_UNITS[i].id === id) return PLATFORM_UNITS[i];
    return null;
  }

  // One performance.platforms row → { spend, value, ratio, basis, badges } or null when the
  // platform did not report (spend <= 0 is omitted upstream; ratio null = value unavailable).
  function performanceRow(p) {
    if (!p || typeof p !== 'object') return null;
    var spend = num(p.spend);
    if (spend == null || spend <= 0) return null;
    var value = num(p.value);
    var ratio = num(p.ratio);
    if (ratio == null && value != null) ratio = Math.round(value / spend * 100) / 100;
    if (ratio == null) return null;
    return { spend: round2(spend), value: value == null ? null : round2(value), ratio: ratio, basis: p.basis || '', badges: Array.isArray(p.badges) ? p.badges.slice() : [] };
  }

  /* ------------------------------------------------------- day records */
  function emptyRec(date) {
    return {
      date: date, spend: null, spend_d2c: null, spend_amazon: null, cash_cost: null,
      clicks: null, impressions: null, conversions: null, revenue: null, roas: null,
      hasPlatform: false, live: null, complete: null, spendKind: null,
      platformSpend: null, platformBasis: null,
      spendSource: null, platformSource: null
    };
  }

  // A platform node "reported" when it carries any non-zero platform metric or an
  // explicit ROAS. daily_inputs spend-only nodes (Meta / Google) have revenue:0,
  // roas:null, clicks:0 — that is NOT a platform read, so ROAS stays "—".
  function platformReported(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.platform_status === 'verified') return true;
    if (node.platform_status === 'unverified') return false;
    var rev = num(node.platform_revenue != null ? node.platform_revenue : node.revenue);
    var roas = num(node.platform_roas != null ? node.platform_roas : node.roas);
    if (roas != null) return true;
    if (n0(rev) > 0 || n0(node.conversions) > 0 || n0(node.platform_conversions) > 0) return true;
    if (n0(node.clicks) > 0 || n0(node.impressions) > 0) return true;
    return false;
  }

  function spendFromNode(ch, node) {
    if (node == null) return null;
    if (typeof node === 'number' || typeof node === 'string') return num(node);
    if (typeof node !== 'object') return null;
    if (isPlaceholderNode(node)) return null;
    var s = num(node.spend);
    if (s == null) s = num(node.daily_spend);
    if (s == null) s = num(node.ad_spend);
    if (s == null) return null;
    if (s === 0 && typeof node === 'object' && !isMeasuredZero(node)) return null;
    return s;
  }

  function applySpend(rec, ch, node, sourceLabel) {
    if (rec.spend != null) return false;
    var s = spendFromNode(ch, node);
    if (s == null) return false;
    rec.spend = round2(s);
    rec.spendKind = s > 0 ? 'positive' : 'measured_zero';
    rec.spendSource = (node && typeof node === 'object' && node.source) ? String(node.source) : sourceLabel;
    if (node && typeof node === 'object') {
      if (ch.id === 'tiktok') {
        var web = num(node.shopify_spend);
        rec.spend_d2c = web == null ? null : round2(web);
      } else {
        var d2c = num(node.spend_d2c);
        if (d2c == null && node.destination === 'd2c') d2c = s;
        if (d2c == null && node.destination === 'amazon') d2c = 0;
        if (d2c == null && ch.d2c === true) d2c = s;
        rec.spend_d2c = d2c == null ? null : round2(d2c);
        var amz = num(node.spend_amazon);
        if (amz == null && node.destination === 'amazon') amz = s;
        rec.spend_amazon = amz == null ? null : round2(amz);
      }
      if (num(node.cash_cost) != null) rec.cash_cost = round2(node.cash_cost);
      if (typeof node.live === 'boolean') rec.live = node.live;
      if (typeof node.complete === 'boolean') rec.complete = node.complete;
      if (node.closed_day === true && rec.complete == null) rec.complete = true;
    } else if (ch.d2c === true) {
      rec.spend_d2c = round2(s);
    }
    return true;
  }

  function applyPlatform(rec, ch, node, sourceLabel) {
    if (rec.hasPlatform) return false;
    if (!platformReported(node)) return false;
    var rev = num(node.platform_revenue != null ? node.platform_revenue : node.revenue);
    var conv = num(node.platform_conversions != null ? node.platform_conversions : node.conversions);
    var roas = num(node.platform_roas != null ? node.platform_roas : node.roas);
    rec.revenue = rev == null ? null : round2(rev);
    rec.conversions = conv;
    rec.clicks = num(node.clicks);
    rec.impressions = num(node.impressions);
    rec.roas = roas;
    rec.hasPlatform = true;
    rec.platformSource = node.platform_source || node.source || sourceLabel;
    if (rec.live == null && typeof node.live === 'boolean') rec.live = node.live;
    if (ch.cashCost && num(node.cash_cost) != null && rec.cash_cost == null) rec.cash_cost = round2(node.cash_cost);
    return true;
  }

  function unwrapRankings(r) {
    if (Array.isArray(r)) {
      var dated = r.filter(function (x) { return x && typeof x === 'object' && isDate(x.date); });
      dated.sort(function (a, b) { return a.date.localeCompare(b.date); });
      return dated.length ? dated[dated.length - 1] : { date: null, channels: [] };
    }
    if (r && typeof r === 'object' && Array.isArray(r.channels)) return r;
    return { date: null, channels: [] };
  }

  /* ------------------------------------------------------- build series */
  function fileRows(file) {
    if (!file || typeof file !== 'object') return [];
    var rows = [];
    function pushRow(date, node) {
      if (!isDate(date) || node == null) return;
      var obj = typeof node === 'object' ? Object.assign({ date: date }, node) : { date: date, spend: node };
      rows.push(obj);
    }
    if (Array.isArray(file.daily)) file.daily.forEach(function (row) { if (row && isDate(row.date)) rows.push(row); });
    if (Array.isArray(file.days)) {
      file.days.forEach(function (day) {
        if (!day || !isDate(day.date)) return;
        if (day.channels && typeof day.channels === 'object') return;
        rows.push(day);
      });
    }
    var by = file.by_date || file.by_day;
    if (by && typeof by === 'object' && !Array.isArray(by)) {
      Object.keys(by).forEach(function (d) { pushRow(d, by[d]); });
    }
    return rows;
  }

  // inputs: { embedded, mer, settings, changes, rankings, tracking, seriesFile,
  //           throttlesFile, channelFiles, dailyFiles, advertisingSourcesDaily }
  function buildSeries(inputs) {
    inputs = inputs || {};
    var embedded = inputs.embedded || [].concat(hostArray('PARTIAL_REPORTS') || [], hostArray('REPORTS') || []);
    var mer = inputs.mer || null;
    var thr = (mer && mer.ad_channel_throttles) || inputs.throttlesFile || null;
    var merAdv = (mer && mer.advertising_sources) || {};
    var series28 = (thr && thr.series_28d && thr.series_28d.by_channel) || {};
    var blended28 = (thr && thr.series_28d && thr.series_28d.blended) || [];
    var seriesFile = inputs.seriesFile || null;
    var channelFiles = inputs.channelFiles || {};
    var dailyFiles = inputs.dailyFiles || {};
    var advDaily = inputs.advertisingSourcesDaily || null;

    var out = { channels: {}, platforms: {}, d2c: {}, dates: {}, spendThrough: null, platformThrough: null, merAsOf: (mer && isDate(mer.as_of)) ? mer.as_of : null, blended: {}, channelFeedThrough: {} };
    CHANNELS.forEach(function (ch) { out.channels[ch.id] = { days: {}, durableThrough: null }; });
    PLATFORM_UNITS.forEach(function (u) { out.platforms[u.id] = { days: {} }; });

    function rec(ch, date) {
      var days = out.channels[ch.id].days;
      if (!days[date]) days[date] = emptyRec(date);
      out.dates[date] = true;
      return days[date];
    }
    function markDurable(ch, date, node) {
      if (!isDate(date) || !node) return;
      if (isPlaceholderNode(node)) return;
      var s = spendFromNode(ch, node);
      var measured = s != null && (s > 0 || isMeasuredZero(node) || (typeof node === 'object' && (node.complete === true || node.closed_day === true)));
      if (!measured && !(typeof node === 'object' && node.complete === true)) return;
      if (!out.channels[ch.id].durableThrough || date > out.channels[ch.id].durableThrough) out.channels[ch.id].durableThrough = date;
    }
    function ingestAdvDay(date, adv, sourceLabel, durable) {
      if (!isDate(date) || !adv || typeof adv !== 'object') return;
      CHANNELS.forEach(function (ch) {
        var node = nodeFromAdv(adv, ch);
        if (node === undefined || isPlaceholderNode(node)) return;
        var r = rec(ch, date);
        applySpend(r, ch, node, sourceLabel);
        if (typeof node === 'object') applyPlatform(r, ch, node, sourceLabel);
        if (durable) markDurable(ch, date, node);
      });
    }

    // 1. embedded daily report rows (freshest spend, same numbers as Daily Reports)
    var embeddedByDate = {};
    embedded.forEach(function (row) {
      if (!row || !isDate(row.date) || !row.advertising_sources) return;
      if (embeddedByDate[row.date] && embeddedByDate[row.date].report_status !== 'partial') return;
      embeddedByDate[row.date] = row;
    });
    Object.keys(embeddedByDate).forEach(function (date) {
      var adv = embeddedByDate[date].advertising_sources;
      CHANNELS.forEach(function (ch) {
        var node = nodeFromAdv(adv, ch);
        if (node === undefined || isPlaceholderNode(node)) return;
        var r = rec(ch, date);
        applySpend(r, ch, node, 'daily report advertising_sources');
        markDurable(ch, date, node);
      });
    });

    // 1b. advertising_sources_daily.json (CFO export — fills PARTIAL holes, never invents)
    var advDailyMap = asDateMap(advDaily);
    Object.keys(advDailyMap).forEach(function (date) {
      ingestAdvDay(date, advDailyMap[date], 'advertising_sources_daily.json', true);
    });

    // 1c. per-channel *_ads_daily.json (box runner files)
    CHANNELS.forEach(function (ch) {
      var dailyDoc = dailyFiles[ch.id];
      if (!dailyDoc) return;
      var map = asDateMap(dailyDoc);
      Object.keys(map).forEach(function (date) {
        var node = map[date];
        if (node === undefined || isPlaceholderNode(node)) return;
        var r = rec(ch, date);
        applySpend(r, ch, node, dailyFileName(ch));
        if (typeof node === 'object') applyPlatform(r, ch, node, dailyFileName(ch));
        markDurable(ch, date, node);
      });
    });

    // 1b. embedded performance.platforms — platform-reported value per platform per day (the
    //     "Who's performing" block of the daily report; current through yesterday). Freshest
    //     platform source, so it is applied before any mer_for_manus.json platform node.
    Object.keys(embeddedByDate).forEach(function (date) {
      var row = embeddedByDate[date];
      var perf = row.performance && Array.isArray(row.performance.platforms) ? row.performance.platforms : null;
      if (!perf) return;
      var perChannel = {};
      perf.forEach(function (p) {
        var u = p && unitById(p.key);
        var pr = performanceRow(p);
        if (!u || !pr) return;
        out.platforms[u.id].days[date] = pr;
        if (!perChannel[u.channel]) perChannel[u.channel] = { spend: 0, value: 0, basis: [], badges: [] };
        var c = perChannel[u.channel];
        c.spend += pr.spend; c.value += n0(pr.value);
        if (pr.basis) c.basis.push(pr.basis);
      });
      Object.keys(perChannel).forEach(function (chId) {
        var ch = byId(chId);
        if (!ch) return;
        var r = rec(ch, date);
        if (r.hasPlatform) return;
        var c = perChannel[chId];
        r.revenue = round2(c.value);
        r.platformSpend = round2(c.spend);
        r.roas = c.spend > 0 ? Math.round(c.value / c.spend * 100) / 100 : null;
        r.hasPlatform = true;
        r.platformSource = 'daily report performance.platforms';
        r.platformBasis = c.basis.join(' + ');
      });
      // Shop/DTC per day: revenue, known ads and MER as the Daily Reports tab shows them
      var shop = row.channel_observations && row.channel_observations.shopify;
      if (shop && shop.data_available !== false && shop.zero_assumed !== true && num(shop.revenue) != null && n0(shop.known_ads) > 0) {
        out.d2c[date] = { date: date, revenue: round2(shop.revenue), ads: round2(shop.known_ads), mer: Math.round(num(shop.revenue) / num(shop.known_ads) * 100) / 100, status: shop.status || row.report_status || null, source: 'daily report channel_observations.shopify' };
      }
    });
    // 1c. closed REPORTS rows carry no advertising_sources / performance, but do carry the closed
    //     Shop/DTC line (shop_revenue, shop_ad_spend): the same ratio for the days that closed.
    embedded.forEach(function (row) {
      if (!row || !isDate(row.date) || out.d2c[row.date]) return;
      if (num(row.shop_revenue) == null || !(n0(row.shop_ad_spend) > 0)) return;
      out.d2c[row.date] = { date: row.date, revenue: round2(row.shop_revenue), ads: round2(row.shop_ad_spend), mer: num(row.shop_mer) != null ? num(row.shop_mer) : Math.round(num(row.shop_revenue) / num(row.shop_ad_spend) * 100) / 100, status: row.report_status || 'closed', source: 'closed daily report shop_revenue / shop_ad_spend' };
    });

    // 2. mer advertising_sources (spend fallback + platform metrics)
    Object.keys(merAdv).forEach(function (date) {
      if (!isDate(date)) return;
      var adv = merAdv[date];
      CHANNELS.forEach(function (ch) {
        var node = nodeFromAdv(adv, ch);
        if (node === undefined || isPlaceholderNode(node)) return;
        var r = rec(ch, date);
        applySpend(r, ch, node, 'mer_for_manus.json advertising_sources');
        markDurable(ch, date, node);
      });
    });

    // 3. series_28d (verified status flags — preferred platform source)
    Object.keys(series28).forEach(function (id) {
      var ch = byId(id);
      if (!ch || !Array.isArray(series28[id])) return;
      series28[id].forEach(function (row) {
        if (!row || !isDate(row.date)) return;
        var r = rec(ch, row.date);
        if (row.spend_status === 'verified' || row.spend_status == null) applySpend(r, ch, row, 'ad_channel_throttles.series_28d');
        applyPlatform(r, ch, row, 'ad_channel_throttles.series_28d');
      });
    });

    // 4. platform metrics from mer advertising_sources, then per-channel by_date
    Object.keys(merAdv).forEach(function (date) {
      if (!isDate(date)) return;
      CHANNELS.forEach(function (ch) {
        var node = nodeFromAdv(merAdv[date], ch);
        if (!node || typeof node !== 'object' || isPlaceholderNode(node)) return;
        applyPlatform(rec(ch, date), ch, node, 'mer_for_manus.json advertising_sources');
      });
    });
    if (mer) {
      CHANNELS.forEach(function (ch) {
        var block = chEntry(mer, ch);
        var by = block && typeof block === 'object' && (block.by_date || block.by_day);
        if (!by || typeof by !== 'object') return;
        Object.keys(by).forEach(function (date) {
          if (!isDate(date) || !by[date] || typeof by[date] !== 'object' || isPlaceholderNode(by[date])) return;
          var r = rec(ch, date);
          applySpend(r, ch, by[date], 'mer_for_manus.json#' + ch.id);
          applyPlatform(r, ch, by[date], 'mer_for_manus.json#' + ch.id);
        });
      });
    }

    // 5. ads_throttle/series.json (older spend only). source:no_feed + $0 is not a published day.
    if (seriesFile && Array.isArray(seriesFile.days)) {
      seriesFile.days.forEach(function (day) {
        if (!day || !isDate(day.date) || !day.channels) return;
        CHANNELS.forEach(function (ch) {
          var node = day.channels[ch.id];
          if (!node || isPlaceholderNode(node) || node.source === 'no_feed') return;
          if (node.spend == null) return;
          applySpend(rec(ch, day.date), ch, { spend: node.spend, spend_d2c: node.d2c, spend_amazon: node.amazon, source: node.source ? 'ads_throttle/series.json ← ' + node.source : 'ads_throttle/series.json' }, 'ads_throttle/series.json');
        });
        if (!out.blended[day.date] && num(day.d2c_ad_spend) != null) {
          out.blended[day.date] = { date: day.date, d2c_ad_spend: num(day.d2c_ad_spend), total_ad_spend: num(day.total_ad_spend), shopify_revenue: num(day.shopify_d2c_revenue), blended_mer: num(day.blended_mer), source: 'ads_throttle/series.json' };
        }
      });
    }

    // 6. optional <channel>_ads_data.json (lowest priority; skip empty pre-launch stubs)
    CHANNELS.forEach(function (ch) {
      var file = channelFiles[ch.id] || (ch.file && inputs[ch.id + 'File']) || null;
      if (!file || isPlaceholderNode(file)) {
        if (!file || !fileRows(file).length) return;
      }
      fileRows(file).forEach(function (row) {
        if (!row || !isDate(row.date) || isPlaceholderNode(row)) return;
        var r = rec(ch, row.date);
        applySpend(r, ch, row, ch.file || 'channel file');
        applyPlatform(r, ch, row, ch.file || 'channel file');
      });
    });

    // 7. mer.channel_ad_spend snapshot for mer.as_of only, when that day still has no row
    if (mer && isDate(mer.as_of) && mer.channel_ad_spend && typeof mer.channel_ad_spend === 'object' && !Array.isArray(mer.channel_ad_spend)) {
      var snapSpend = mer.channel_ad_spend;
      if (!Object.keys(snapSpend).every(function (k) { return isDate(k); })) {
        CHANNELS.forEach(function (ch) {
          var r = rec(ch, mer.as_of);
          if (r.spend != null) return;
          var node = pick(snapSpend, ch.srcKeys.concat([ch.id]));
          if (node === undefined || isPlaceholderNode(node)) return;
          applySpend(r, ch, typeof node === 'object' ? node : { spend: node }, 'mer_for_manus.json channel_ad_spend');
        });
      }
    }

    // blended D2C per day (series_28d.blended wins)
    blended28.forEach(function (row) {
      if (!row || !isDate(row.date)) return;
      out.blended[row.date] = {
        date: row.date,
        d2c_ad_spend: num(row.d2c_ad_spend), total_ad_spend: num(row.total_ad_spend),
        shopify_revenue: num(row.shopify_revenue), blended_mer: num(row.blended_mer),
        source: 'ad_channel_throttles.series_28d.blended'
      };
    });

    // Drop only synthetic $0 after a durable stop (no_feed / unmarked / zero_assumed).
    // Measured paused zeros (complete / closed_day / verified / explicit not-live) stay $0.
    CHANNELS.forEach(function (ch) {
      var bag = out.channels[ch.id];
      var lastPos = null;
      Object.keys(bag.days).sort().forEach(function (d) {
        if (bag.days[d].spend > 0) lastPos = d;
      });
      var cut = bag.durableThrough;
      Object.keys(bag.days).forEach(function (d) {
        var r = bag.days[d];
        if (r.spend == null || r.spend > 0) return;
        if (r.spendKind === 'measured_zero') return;
        var afterDurable = cut && d > cut;
        var afterPositive = lastPos && d > lastPos;
        if (afterDurable || afterPositive) {
          r.spend = null; r.spendKind = null; r.spendSource = null;
          r.spend_d2c = null; r.spend_amazon = null;
        }
      });
    });

    // dates with any published spend. A mer advertising_sources row newer than both the page's
    // last daily report and mer.as_of is today's partial row (a few channels reported so far):
    // it never ends the window. advertising_sources_daily / *_ads_daily published days do.
    var embeddedLatest = Object.keys(embeddedByDate).sort().pop() || null;
    var cap = [embeddedLatest, out.merAsOf].filter(Boolean).sort().pop() || null;
    function isMerPartialToday(d) {
      if (!cap || !isDate(d) || d <= cap) return false;
      return !!merAdv[d];
    }
    CHANNELS.forEach(function (ch) {
      var bag = out.channels[ch.id];
      var latest = null, plat = null;
      Object.keys(bag.days).forEach(function (d) {
        if (isMerPartialToday(d)) return;
        var r = bag.days[d];
        if (r.spend != null && (!latest || d > latest)) latest = d;
        if (r.hasPlatform && r.spend != null && r.spend > 0 && (!plat || d > plat)) plat = d;
      });
      bag.feedThrough = latest;
      bag.platformThrough = plat;
      out.channelFeedThrough[ch.id] = latest;
    });

    var dates = Object.keys(out.dates).filter(function (d) {
      if (isMerPartialToday(d)) return false;
      return CHANNELS.some(function (ch) { var r = out.channels[ch.id].days[d]; return r && r.spend != null; });
    }).sort();
    out.dates = dates;
    out.spendThrough = dates.length ? dates[dates.length - 1] : null;
    out.partialDates = [];
    if (cap) out.partialDates = Object.keys(embeddedByDate).concat(Object.keys(merAdv)).filter(function (d, i, arr) { return isDate(d) && d > cap && arr.indexOf(d) === i; }).sort();
    var pt = null;
    CHANNELS.forEach(function (ch) {
      var p = out.channels[ch.id].platformThrough;
      if (p && (!pt || p > pt)) pt = p;
    });
    out.platformThrough = pt;
    return out;
  }

  /* -------------------------------------------------------- windows */
  function windowDates(endDate, n) {
    var arr = [];
    for (var i = n - 1; i >= 0; i--) arr.push(addDays(endDate, -i));
    return arr;
  }

  // Platform ROAS denominators: the platform's own spend when the value came from the same
  // platform query (performance.platforms), else the published daily spend.
  function platformDenominator(r) {
    return r.platformSpend != null && r.platformSpend > 0 ? r.platformSpend : n0(r.spend);
  }
  function dayRoas(r) {
    if (!r || !r.hasPlatform || !(r.spend > 0)) return null;
    if (r.roas != null) return r.roas;
    var den = platformDenominator(r);
    return r.revenue != null && den > 0 ? Math.round(r.revenue / den * 100) / 100 : null;
  }

  function sumWindow(days, dates, field) {
    var total = 0, present = 0;
    dates.forEach(function (d) {
      var r = days[d];
      if (r && r[field] != null) { total += r[field]; present += 1; }
    });
    return { total: present ? round2(total) : null, present: present };
  }

  // present7 / presentPrev7: days in each window with a published spend row for
  // the channel. A window with holes is reported as INCOMPLETE, never judged.
  function growthVerdict(spend7, prev7, present7, presentPrev7, n) {
    n = n || 7;
    if (present7 != null && presentPrev7 != null) {
      if (present7 === 0 && presentPrev7 === 0) return { code: 'nofeed', label: 'NO FEED', wow: null, missing: 2 * n };
      if (present7 < n || presentPrev7 < n) {
        return { code: 'incomplete', label: 'INCOMPLETE · ' + present7 + '/' + n + ' + ' + presentPrev7 + '/' + n + ' days', wow: null, missing: (n - present7) + (n - presentPrev7) };
      }
    }
    if (spend7 <= 0 && prev7 <= 0) return { code: 'none', label: 'NO SPEND', wow: null };
    if (prev7 <= 0 && spend7 > 0) return { code: 'launching', label: 'NEW / LAUNCHING', wow: null };
    if (spend7 <= 0 && prev7 > 0) return { code: 'stopped', label: 'STOPPED', wow: -100 };
    var wow = (spend7 - prev7) / prev7 * 100;
    if (wow >= GROWTH_PCT) return { code: 'growing', label: 'GROWING', wow: wow };
    if (wow <= -GROWTH_PCT) return { code: 'shrinking', label: 'SHRINKING', wow: wow };
    return { code: 'flat', label: 'FLAT', wow: wow };
  }

  function latestChange(changes, chId, onOrBefore) {
    if (!Array.isArray(changes)) return null;
    var best = null;
    changes.forEach(function (c) {
      if (!c || (c.channel !== chId && canonicalId(c.channel) !== chId) || !isDate(c.date)) return;
      if (onOrBefore && c.date > onOrBefore) return;
      if (!best || c.date > best.date) best = c;
    });
    return best;
  }

  function actionKind(action) {
    var a = String(action || '').toLowerCase();
    if (!a) return null;
    if (/raise|scale|increase|up/.test(a)) return 'scale';
    if (/kill|pause|stop/.test(a)) return 'kill';
    if (/cut|reduce|lower|down/.test(a)) return 'cut';
    return 'other';
  }

  function actionLabel(change) {
    if (!change) return '';
    var k = actionKind(change.action);
    var verb = k === 'scale' ? 'Scaled' : k === 'kill' ? 'Killed' : k === 'cut' ? 'Cut' : String(change.action || 'Changed');
    var budget = (num(change.old_budget) != null && num(change.new_budget) != null)
      ? ' $' + Number(change.old_budget).toLocaleString() + ' → $' + Number(change.new_budget).toLocaleString() + '/day'
      : '';
    return verb + budget + ' on ' + mmdd(change.date) + (change.by ? ' by ' + change.by : '');
  }

  // ctx: { mode, ruleStatus, recommended, tracking, change, live, status, asOf, launch }
  function posture(ctx) {
    ctx = ctx || {};
    var tracking = ctx.tracking ? String(ctx.tracking).toUpperCase() : null;
    var mode = ctx.mode ? String(ctx.mode).toLowerCase() : null;
    var change = ctx.change || null;
    var recent = change && ctx.asOf && isDate(change.date) && daysBetween(change.date, ctx.asOf) <= ACTION_RECENT_DAYS;
    var kind = recent ? actionKind(change.action) : null;
    var detail = [];
    if (ctx.ruleStatus) detail.push('rule: ' + ctx.ruleStatus);
    if (ctx.recommended) detail.push('recommended: ' + ctx.recommended);
    if (change) detail.push(actionLabel(change));
    if (ctx.nextEligible) detail.push('next eligible ' + mmdd(ctx.nextEligible));

    if (tracking === 'DOWN') return { code: 'tracking_down', label: 'HOLD · TRACKING DOWN', cls: 'ac-bad', detail: detail };
    if (ctx.dark && !(ctx.spend7 > 0)) {
      return { code: 'not_live', label: 'NOT LAUNCHED', cls: 'ac-muted', detail: detail };
    }
    if (kind === 'scale') return { code: 'scaling', label: 'SCALING INTO', cls: 'ac-good', detail: detail };
    if (kind === 'kill') return { code: 'killed', label: 'KILLED / PAUSED', cls: 'ac-bad', detail: detail };
    if (kind === 'cut') return { code: 'cutting', label: 'CUTTING', cls: 'ac-warn', detail: detail };
    if (ctx.live === false && !(ctx.spend7 > 0)) {
      var lbl = ctx.status === 'pre_launch' ? 'PRE-LAUNCH' : 'NOT LIVE';
      if (ctx.launch && ctx.launch.launch_date && ctx.launch.launch_date > (ctx.asOf || '')) lbl += ' · launches ' + mmdd(ctx.launch.launch_date);
      return { code: 'not_live', label: lbl, cls: 'ac-muted', detail: detail };
    }
    if (mode === 'frozen') return { code: 'frozen', label: 'FROZEN · VIEW ONLY', cls: 'ac-muted', detail: detail };
    if (mode === 'hold') return { code: 'hold', label: 'HOLD', cls: 'ac-warn', detail: detail };
    if (mode === 'view') return { code: 'view', label: 'VIEW ONLY', cls: 'ac-muted', detail: detail };
    if (mode === 'auto') {
      if (ctx.launch && ctx.launch.soft_read_date && ctx.asOf && ctx.asOf < ctx.launch.soft_read_date) {
        return { code: 'learning', label: 'LEARNING · first read ' + mmdd(ctx.launch.soft_read_date), cls: 'ac-muted', detail: detail };
      }
      return { code: 'auto', label: 'AUTO RULE', cls: 'ac-ok', detail: detail };
    }
    return { code: 'unknown', label: 'NO JARVIS STATE', cls: 'ac-muted', detail: detail };
  }

  /* ---------------------------------------------------- channel stats */
  // n = window length in days (default 7; 1 = yesterday). Field names keep their *7 suffix for
  // compatibility; they mean "this window" and the result carries `win`.
  function channelStats(ch, series, inputs, endDate, n) {
    inputs = inputs || {};
    n = n || 7;
    var days = series.channels[ch.id].days;
    var end = endDate || series.spendThrough;
    var last7 = end ? windowDates(end, n) : [];
    var prev7 = end ? windowDates(addDays(end, -n), n) : [];
    var last30 = end ? windowDates(end, 30) : [];
    var s7 = sumWindow(days, last7, 'spend');
    var p7 = sumWindow(days, prev7, 'spend');
    var s30 = sumWindow(days, last30, 'spend');
    var d2c7 = sumWindow(days, last7, 'spend_d2c');
    var cash7 = sumWindow(days, last7, 'cash_cost');

    // platform window: only days where the platform reported AND spend > 0
    var pRev = 0, pConv = 0, pSpend = 0, pDays = 0, pClicks = 0, pLatest = null, pBasis = null, convDays = 0, clickDays = 0;
    last7.forEach(function (d) {
      var r = days[d];
      if (!r || !r.hasPlatform || r.spend == null || r.spend <= 0) return;
      pDays += 1; pSpend += platformDenominator(r); pRev += n0(r.revenue);
      if (r.conversions != null) { convDays += 1; pConv += n0(r.conversions); }
      if (r.clicks != null) { clickDays += 1; pClicks += n0(r.clicks); }
      if (!pLatest || d > pLatest) { pLatest = d; pBasis = r.platformBasis || null; }
    });
    var roas7 = pDays > 0 && pSpend > 0 ? pRev / pSpend : null;

    var ydayRec = end && days[end] ? days[end] : null;
    var growth = growthVerdict(n0(s7.total), n0(p7.total), s7.present, p7.present, n);

    var mer = inputs.mer || null;
    var thr = (mer && mer.ad_channel_throttles) || inputs.throttlesFile || null;
    var thrCh = (thr && chEntry(thr.channels, ch)) || null;
    var settings = inputs.settings || (thr && thr.settings) || null;
    var setCh = (settings && chEntry(settings.channels, ch)) || null;
    var trackingDoc = inputs.tracking || (thr && thr.tracking_health) || null;
    var trk = (trackingDoc && chEntry(trackingDoc.channels, ch)) || null;
    var trackingStatus = trk && trk.status ? String(trk.status).toUpperCase() : (thrCh && thrCh.tracking_status ? String(thrCh.tracking_status).toUpperCase() : null);
    if (trackingStatus === 'UNKNOWN') trackingStatus = null;
    var changes = inputs.changes || (thr && thr.recent_changes) || [];
    var change = latestChange(changes, ch.id, null);
    if (!change && thrCh && thrCh.last_change_date) change = { date: thrCh.last_change_date, channel: ch.id, action: thrCh.last_change_action };
    var rankings = unwrapRankings(inputs.rankings || (thr && thr.rankings) || null);
    var rank = null;
    (rankings.channels || []).forEach(function (c) { if (c && (c.channel === ch.id || canonicalId(c.channel) === ch.id)) rank = c; });

    var spendLatest = (series.channels[ch.id] && series.channels[ch.id].feedThrough) || null;
    if (!spendLatest) {
      Object.keys(days).forEach(function (d) { if (days[d].spend != null && (!spendLatest || d > spendLatest)) spendLatest = d; });
    }
    var missing7 = last7.filter(function (d) { return !days[d] || days[d].spend == null; });
    var missingPrev7 = prev7.filter(function (d) { return !days[d] || days[d].spend == null; });
    var stale = !!(spendLatest && last7.length && spendLatest < last7[0]);
    if (stale) {
      growth = { code: 'stale', label: 'STALE · last row ' + mmdd(spendLatest) + ' · ' + s7.present + '/' + n + ' + ' + p7.present + '/' + n + ' days', wow: null, missing: missing7.length + missingPrev7.length };
    }

    var blk0 = mer ? chEntry(mer, ch) : null;
    var block = blk0 && typeof blk0 === 'object' ? blk0 : null;
    var status = (block && block.status) || null;
    var blockAsOf = block && isDate(block.as_of) ? block.as_of : null;
    var liveFresh = !!(blockAsOf && last7.length && blockAsOf >= last7[0]);
    var live = null;
    // The badge reflects the latest measured day, not earlier activity in the
    // seven-day window. A measured paused zero keeps the $0 and reads NOT LIVE.
    var latestMeasured = spendLatest ? (days[spendLatest] || null) : null;
    if (!latestMeasured && ydayRec && ydayRec.spend != null) latestMeasured = ydayRec;
    if (!stale && latestMeasured && typeof latestMeasured.live === 'boolean') live = latestMeasured.live;
    else if (liveFresh && block && typeof block.live === 'boolean') live = block.live;
    else if (ydayRec && typeof ydayRec.live === 'boolean' && ydayRec.spend != null) live = ydayRec.live;
    else if (s7.total > 0 && !stale) live = true;
    else if (s7.present && s7.total === 0) live = false;

    var darkHint = !!(ch.darkWhenZero || (setCh && (setCh.not_launched_while_zero || setCh.status === 'not_launched')) || status === 'pre_launch' || status === 'not_live' || status === 'not_launched');
    var dark = darkHint && !(s7.total > 0) && !stale && s7.present === 0 && p7.present === 0;
    if (dark) {
      growth = { code: 'nofeed', label: 'NO FEED', wow: null, missing: 2 * n };
    }

    var launch = thrCh && (thrCh.launch_date || thrCh.soft_read_date) ? thrCh : (setCh && (setCh.launch_date || setCh.soft_read_date) ? setCh : null);
    var post = posture({
      mode: (setCh && setCh.mode) || (thrCh && thrCh.mode) || null,
      ruleStatus: thrCh && thrCh.rule_status,
      recommended: thrCh && thrCh.recommended_action,
      nextEligible: thrCh && thrCh.next_eligible_date,
      tracking: trackingStatus,
      change: change,
      live: live,
      status: status,
      spend7: s7.total,
      asOf: end,
      launch: launch,
      dark: dark
    });

    var spendSource = null, platformSource = null;
    for (var i = last7.length - 1; i >= 0 && !spendSource; i--) { var rr = days[last7[i]]; if (rr && rr.spendSource) spendSource = rr.spendSource; }
    if (!spendSource && spendLatest && days[spendLatest]) spendSource = days[spendLatest].spendSource;
    for (var j = last7.length - 1; j >= 0 && !platformSource; j--) { var pr = days[last7[j]]; if (pr && pr.platformSource) platformSource = pr.platformSource; }

    var feedCode = dark ? 'dark' : (s7.present === 0 && p7.present === 0 && !spendLatest ? 'nofeed' : (stale ? 'stale' : (s7.present < n ? 'incomplete' : (s7.total === 0 ? 'zero' : 'ok'))));
    var statusLabel = live === true ? 'LIVE' : (live === false ? ((feedCode === 'dark' || status === 'not_launched') ? 'NOT LAUNCHED' : (status === 'pre_launch' ? 'PRE-LAUNCH' : 'NOT LIVE')) : (feedCode === 'stale' ? 'STALE' : (feedCode === 'dark' ? 'NOT LAUNCHED' : (feedCode === 'nofeed' ? '—' : '—'))));

    if (ch.noDataLabel && (growth.code === 'nofeed') && !dark) growth = Object.assign({}, growth, { label: ch.noDataLabel });
    if (ch.noDataLabel && statusLabel === '—') statusLabel = ch.noDataLabel;
    return {
      ch: ch,
      end: end,
      win: n,
      yday: ydayRec && ydayRec.spend != null ? ydayRec.spend : null,
      ydayCash: ydayRec && ydayRec.cash_cost != null ? ydayRec.cash_cost : null,
      spend7: s7.total, spend7Days: s7.present,
      prev7: p7.total, prev7Days: p7.present,
      spend30: s30.total, spend30Days: s30.present,
      d2c7: d2c7.present ? d2c7.total : null,
      cash7: cash7.present ? cash7.total : null,
      platformRev7: pDays ? round2(pRev) : null,
      platformConv7: convDays ? pConv : null,
      platformClicks7: clickDays ? pClicks : null,
      platformDays7: pDays,
      platformSpend7: pDays ? round2(pSpend) : null,
      platformBasis: pBasis,
      platformLatest: pLatest || (series.channels[ch.id] && series.channels[ch.id].platformThrough) || null,
      roas7: roas7 == null ? null : Math.round(roas7 * 100) / 100,
      growth: growth,
      posture: post,
      mode: (setCh && setCh.mode) || (thrCh && thrCh.mode) || null,
      ruleStatus: thrCh && thrCh.rule_status || null,
      tracking: trackingStatus,
      trackingNotes: trk && trk.notes || null,
      change: change,
      rank: rank,
      rankDate: rankings.date || null,
      status: status,
      statusLabel: statusLabel,
      live: live,
      feed: { code: feedCode, through: spendLatest, missing7: missing7, missingPrev7: missingPrev7, durableThrough: series.channels[ch.id] && series.channels[ch.id].durableThrough || null },
      ownerBot: (setCh && setCh.owner_bot) || (thrCh && thrCh.owner_bot) || null,
      notes: (setCh && setCh.notes) || (thrCh && thrCh.strategy_notes) || null,
      spendSource: spendSource,
      platformSource: platformSource,
      spendLatest: spendLatest
    };
  }

  function summarize(statsList, series, inputs, endDate, n) {
    n = n || 7;
    var end = endDate || series.spendThrough;
    var tracked7 = 0, tracked7prev = 0, live = 0, growing = 0, shrinking = 0, scaling = 0, cutting = 0, launching = 0, incomplete = 0;
    var last7all = end ? windowDates(end, n) : [];
    var prev7all = end ? windowDates(addDays(end, -n), n) : [];
    function dayHasSpend(d) { return CHANNELS.some(function (ch) { var r = series.channels[ch.id].days[d]; return r && r.spend != null; }); }
    var missing7 = last7all.filter(function (d) { return !dayHasSpend(d); });
    var missingPrev7 = prev7all.filter(function (d) { return !dayHasSpend(d); });
    var unmeasured = [];
    statsList.forEach(function (s) {
      // Unknown spend (no measured row) is excluded from tracked / D2C totals — list it as coverage.
      var notLaunched = s.feed && s.feed.code === 'dark';
      if (!notLaunched && (s.spend7Days == null || s.spend7Days < n)) unmeasured.push({ id: s.ch.id, label: s.ch.label, days: s.spend7Days || 0 });
      if (s.growth.code === 'incomplete' || s.growth.code === 'stale') incomplete += 1;
      tracked7 += n0(s.spend7); tracked7prev += n0(s.prev7);
      if (s.live) live += 1;
      if (s.growth.code === 'growing') growing += 1;
      if (s.growth.code === 'shrinking' || s.growth.code === 'stopped') shrinking += 1;
      if (s.growth.code === 'launching') launching += 1;
      if (s.posture.code === 'scaling') scaling += 1;
      if (s.posture.code === 'cutting' || s.posture.code === 'killed') cutting += 1;
    });
    var last7 = end ? windowDates(end, n) : [];
    var d2c = 0, rev = 0, present = 0, blendedSource = null;
    last7.forEach(function (d) {
      var b = series.blended[d];
      if (!b || b.d2c_ad_spend == null || b.shopify_revenue == null) return;
      d2c += b.d2c_ad_spend; rev += b.shopify_revenue; present += 1; blendedSource = b.source;
    });
    var blended = null;
    // One source per number: the feed's blended series when it covers the whole window, else the
    // daily reports' Shop/DTC line (revenue ÷ known ads, current through yesterday), else the
    // feed's pooled 7d. Never a mix of the two series, never a partial window.
    var dRev = 0, dAds = 0, dPresent = 0, dMissing = [];
    last7.forEach(function (d) {
      var x = series.d2c && series.d2c[d];
      if (!x || x.mer == null) { dMissing.push(d); return; }
      dRev += x.revenue; dAds += x.ads; dPresent += 1;
    });
    if (present === n && d2c > 0) blended = { d2c: round2(d2c), rev: round2(rev), mer: Math.round(rev / d2c * 100) / 100, source: blendedSource, through: end, days: present };
    else if (dPresent === n && dAds > 0) blended = { d2c: round2(dAds), rev: round2(dRev), mer: Math.round(dRev / dAds * 100) / 100, source: 'daily report Shop/DTC revenue ÷ known ads', through: end, days: dPresent, shopDtc: true };
    else if (n === 7 && inputs && inputs.mer && num(inputs.mer.spend_7d) != null && num(inputs.mer.rev_7d) != null && n0(inputs.mer.spend_7d) > 0) {
      blended = { d2c: round2(inputs.mer.spend_7d), rev: round2(inputs.mer.rev_7d), mer: num(inputs.mer.mer_7d_pooled) != null ? Math.round(inputs.mer.mer_7d_pooled * 100) / 100 : Math.round(inputs.mer.rev_7d / inputs.mer.spend_7d * 100) / 100, source: 'mer_for_manus.json 7d pooled', through: inputs.mer.as_of, days: 7 };
    }
    return {
      end: end,
      win: n,
      tracked7: round2(tracked7), tracked7prev: round2(tracked7prev),
      trackedWow: tracked7prev > 0 && !missing7.length && !missingPrev7.length ? (tracked7 - tracked7prev) / tracked7prev * 100 : null,
      missingDays7: missing7, missingDaysPrev7: missingPrev7, incomplete: incomplete,
      live: live, growing: growing, shrinking: shrinking, launching: launching, scaling: scaling, cutting: cutting,
      channels: statsList.length,
      unmeasured7: unmeasured,
      blended: blended,
      blendedMissing: blended ? [] : dMissing
    };
  }

  function freshness(series, inputs) {
    var notes = [];
    var mer = inputs && inputs.mer;
    if (series.spendThrough) notes.push({ k: 'Portfolio spend through', v: shortDate(series.spendThrough), src: 'latest day any channel published spend (not a single all-clear)' });
    if (series.merAsOf) notes.push({ k: 'mer_for_manus.json', v: 'as of ' + series.merAsOf, src: 'rebuild_mer.py', warn: series.spendThrough && series.merAsOf < series.spendThrough ? (daysBetween(series.merAsOf, series.spendThrough) + ' days behind portfolio spend') : null });
    if (series.platformThrough) {
      var lag = series.spendThrough ? daysBetween(series.platformThrough, series.spendThrough) : 0;
      var perfAny = Object.keys(series.platforms || {}).some(function (k) { return Object.keys(series.platforms[k].days).length; });
      notes.push({ k: 'Platform revenue / ROAS through', v: shortDate(series.platformThrough), src: (perfAny ? 'daily report performance.platforms + ' : '') + 'per-channel platform_revenue (Meta/Google spend-only stay —)' + (series.merAsOf ? ' · mer_for_manus.json as of ' + series.merAsOf : ''), warn: lag > 1 ? lag + ' days behind portfolio spend — ROAS columns stop there' : null });
    } else {
      notes.push({ k: 'Platform revenue / ROAS', v: 'no feed', src: mer ? 'mer_for_manus.json has no platform rows' : 'mer_for_manus.json not loaded', warn: 'no platform-reported revenue available' });
    }
    var staleList = [];
    var nofeedList = [];
    CHANNELS.forEach(function (ch) {
      var through = series.channelFeedThrough && series.channelFeedThrough[ch.id];
      if (!through) nofeedList.push(ch.label);
      else if (series.spendThrough && through < series.spendThrough) staleList.push(ch.label + ' ' + mmdd(through));
    });
    if (staleList.length) notes.push({ k: 'Stale channel feeds', v: staleList.join(' · '), src: 'per-channel last measured row', warn: 'missing days are not $0' });
    if (nofeedList.length) notes.push({ k: 'No published spend rows', v: nofeedList.join(', '), src: 'advertising_sources / *_ads_daily.json', warn: 'NO FEED — display is —, not $0' });
    var rankings = unwrapRankings((inputs && inputs.rankings) || (mer && mer.ad_channel_throttles && mer.ad_channel_throttles.rankings) || null);
    notes.push({ k: 'Jarvis rankings', v: rankings.date ? mmdd(rankings.date) : 'none', src: 'ads_throttle/rankings.json' });
    var trk = (inputs && inputs.tracking) || (mer && mer.ad_channel_throttles && mer.ad_channel_throttles.tracking_health) || null;
    notes.push({ k: 'Tracking health', v: trk && trk.as_of ? String(trk.as_of).slice(0, 10) : 'none', src: 'ads_throttle/tracking_health.json' });
    var st = (inputs && inputs.settings) || null;
    notes.push({ k: 'Jarvis settings', v: st && st.updated_at ? String(st.updated_at).slice(0, 10) : 'none', src: 'ads_throttle/settings.json' });
    return notes;
  }

  /* ---------------------------------------------- platform leaderboard */
  // Jarvis rule thresholds (ads_throttle/settings.json global). Defaults mirror David 10/27.
  function thresholds(settings) {
    var g = (settings && settings.global) || {};
    return {
      raise: num(g.raise_above_roas) != null ? num(g.raise_above_roas) : 2.8,
      cut: num(g.cut_below_roas) != null ? num(g.cut_below_roas) : 2.0,
      minSpend: num(g.min_spend_7d) != null ? num(g.min_spend_7d) : 200,
      source: settings && settings.global ? 'ads_throttle/settings.json' : 'defaults (settings not loaded)'
    };
  }
  // The rule's $200 is per 7 days. Scale it to the window; a window shorter than a week is
  // judged on at least LOW_SPEND per day (performance.py: under $100 is not judged).
  function minSpendFor(th, n) {
    n = n || 7;
    var scaled = th.minSpend * n / 7;
    return Math.round(n < 7 ? Math.max(LOW_SPEND * n, scaled) : scaled);
  }

  // Band = where a platform-reported ROAS sits against the Jarvis rule.
  function band(roas, spend, th) {
    if (roas == null || !Number.isFinite(roas)) return 'none';
    if (spend != null && spend < th.minSpend) return 'low';
    if (roas >= th.raise) return 'raise';
    if (roas < th.cut) return 'cut';
    return 'hold';
  }
  var BAND_LABEL = { raise: 'ABOVE RAISE BAND', hold: 'HOLD BAND', cut: 'BELOW CUT BAND', low: 'NOT JUDGED · LOW SPEND', none: 'NO READ' };
  var BAND_COLOR = { raise: '#22c55e', hold: '#8888a8', cut: '#ef4444', low: '#5c5c7a', none: '#5c5c7a' };

  // 7-day leaderboard over platform units (performance.platforms) with the channel-level
  // record as fallback for channels whose only platform read comes from mer_for_manus.json.
  function leaderboard(series, end, settings, n) {
    n = n || 7;
    var th = Object.assign({}, thresholds(settings));
    th.minSpend7 = th.minSpend;
    th.minSpend = minSpendFor(th, n);
    th.win = n;
    var last7 = end ? windowDates(end, n) : [];
    var rows = [], covered = {};
    PLATFORM_UNITS.forEach(function (u) {
      var days = series.platforms[u.id] ? series.platforms[u.id].days : {};
      var spend = 0, value = 0, n = 0, latest = null, basis = null;
      last7.forEach(function (d) {
        var r = days[d];
        if (!r) return;
        n += 1; spend += r.spend; value += n0(r.value);
        if (!latest || d > latest) { latest = d; basis = r.basis || null; }
      });
      if (!n) return;
      covered[u.channel] = true;
      var roas = spend > 0 ? Math.round(value / spend * 100) / 100 : null;
      rows.push({ id: u.id, label: u.label, channel: u.channel, color: (byId(u.channel) || {}).color || OTHER_COLOR, spend7: round2(spend), value7: round2(value), roas7: roas, days: n, latest: latest, basis: basis, band: band(roas, spend, th), source: 'daily report performance.platforms' });
    });
    CHANNELS.forEach(function (ch) {
      if (covered[ch.id]) return;
      var days = series.channels[ch.id].days;
      var spend = 0, value = 0, n = 0, latest = null, src = null;
      last7.forEach(function (d) {
        var r = days[d];
        if (!r || !r.hasPlatform || !(r.spend > 0)) return;
        n += 1; spend += platformDenominator(r); value += n0(r.revenue);
        if (!latest || d > latest) { latest = d; src = r.platformSource; }
      });
      if (!n) return;
      var roas = spend > 0 ? Math.round(value / spend * 100) / 100 : null;
      rows.push({ id: ch.id, label: ch.label, channel: ch.id, color: ch.color, spend7: round2(spend), value7: round2(value), roas7: roas, days: n, latest: latest, basis: null, band: band(roas, spend, th), source: src });
    });
    var judged = rows.filter(function (r) { return r.band !== 'low' && r.band !== 'none'; });
    var totSpend = 0, totValue = 0;
    rows.forEach(function (r) { totSpend += r.spend7; totValue += r.value7; });
    rows.forEach(function (r) {
      r.spendShare = totSpend > 0 ? r.spend7 / totSpend * 100 : null;
      r.valueShare = totValue > 0 ? r.value7 / totValue * 100 : null;
    });
    var order = { raise: 0, hold: 0, cut: 0, low: 1, none: 2 };
    rows.sort(function (a, b) { return order[a.band] - order[b.band] || (b.roas7 == null ? -1 : a.roas7 == null ? 1 : b.roas7 - a.roas7) || b.spend7 - a.spend7; });
    var noRead = CHANNELS.filter(function (ch) {
      if (rows.some(function (r) { return r.channel === ch.id; })) return false;
      return last7.some(function (d) { var r = series.channels[ch.id].days[d]; return r && r.spend > 0; });
    }).map(function (ch) { return ch.label; });
    return {
      end: end, win: n, thresholds: th, rows: rows,
      pooled: totSpend > 0 ? { spend: round2(totSpend), value: round2(totValue), roas: Math.round(totValue / totSpend * 100) / 100, platforms: rows.length } : null,
      above: judged.filter(function (r) { return r.band === 'raise'; }).length,
      below: judged.filter(function (r) { return r.band === 'cut'; }).length,
      hold: judged.filter(function (r) { return r.band === 'hold'; }).length,
      noRead: noRead
    };
  }

  // Platform × day ROAS cells for the last n days (default 14). A day the platform did not
  // report is null (never 0x); a day under LOW_SPEND is shown but not judged.
  function heatmap(series, end, n, settings) {
    var th = thresholds(settings);
    var dates = end ? windowDates(end, n || HEATMAP_DAYS) : [];
    var rows = [];
    PLATFORM_UNITS.forEach(function (u) {
      var days = series.platforms[u.id] ? series.platforms[u.id].days : {};
      var any = false, spendSum = 0;
      var cells = dates.map(function (d) {
        var r = days[d];
        if (!r) return { date: d, ratio: null, spend: null, value: null, band: 'none', low: false };
        any = true; spendSum += r.spend;
        var low = r.spend < LOW_SPEND;
        return { date: d, ratio: r.ratio, spend: r.spend, value: r.value, basis: r.basis, low: low, band: low ? 'low' : band(r.ratio, null, th) };
      });
      if (any) rows.push({ id: u.id, label: u.label, channel: u.channel, color: (byId(u.channel) || {}).color || OTHER_COLOR, spend: round2(spendSum), cells: cells });
    });
    rows.sort(function (a, b) { return b.spend - a.spend; });
    return { dates: dates, rows: rows, thresholds: th };
  }

  var SHORT = { meta: 'Meta', google: 'Google', tiktok: 'TikTok', bing: 'Bing', snapchat: 'Snap', applovin: 'AppLovin', pinterest: 'Pinterest', chatgpt: 'ChatGPT', reddit: 'Reddit', taboola: 'Taboola', outbrain: 'Outbrain', x: 'X' };
  function markerLabel(c) {
    var k = actionKind(c.action);
    var ch = SHORT[c.channel] || c.channel;
    var pctM = String(c.action || '').match(/(\d+)\s*pct/);
    if (k === 'scale') return ch + ' +' + (pctM ? pctM[1] : '') + '%';
    if (k === 'cut') return ch + ' −' + (pctM ? pctM[1] : '') + '%';
    if (k === 'kill') return ch + ' kill';
    return ch + ' ' + String(c.action || 'change').replace(/_/g, ' ');
  }
  // Jarvis budget actions that fall inside the charted window, one marker per (date, channel).
  function actionMarkers(changes, dates) {
    if (!Array.isArray(changes) || !dates || !dates.length) return [];
    var seen = {}, out = [];
    changes.forEach(function (c) {
      if (!c || !isDate(c.date) || !c.channel) return;
      var idx = dates.indexOf(c.date);
      if (idx === -1) return;
      var key = c.date + '|' + c.channel + '|' + actionKind(c.action);
      if (seen[key]) return;
      seen[key] = true;
      out.push({ date: c.date, idx: idx, channel: c.channel, kind: actionKind(c.action), label: markerLabel(c), color: (byId(c.channel) || {}).color || OTHER_COLOR, change: c });
    });
    out.sort(function (a, b) { return a.idx - b.idx || a.channel.localeCompare(b.channel); });
    return out;
  }

  // Shop/DTC MER per day for the window (null where the daily report has no Shopify row).
  function merDaily(series, dates) {
    return dates.map(function (d) { var x = series.d2c[d]; return x ? { date: d, mer: x.mer, revenue: x.revenue, ads: x.ads, status: x.status } : { date: d, mer: null }; });
  }

  /* ------------------------------------------------------------- DOM */
  var CSS = [
    '#tab-ad_channels{max-width:1400px;margin:0 auto}',
    '.ac-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:10px}',
    '.ac-head h2{font-size:1.05rem;letter-spacing:.08em;text-transform:uppercase;margin:0}',
    '.ac-sub{color:var(--text-muted);font-size:.8rem}',
    '.ac-win{display:flex;gap:4px}.ac-win button{background:var(--card);border:1px solid var(--border);color:var(--text-muted);padding:5px 10px;border-radius:6px;font:600 .7rem var(--font-body);letter-spacing:.08em;cursor:pointer}.ac-win button.on{color:var(--cyan);border-color:var(--cyan)}',
    '.ac-asof{display:flex;flex-wrap:wrap;gap:6px 18px;padding:10px 14px;border:1px solid var(--border);border-radius:8px;background:var(--surface);font-size:.76rem;color:var(--text-muted);margin-bottom:14px}.ac-asof b{color:var(--text);font-weight:600}.ac-asof .ac-warn-txt{color:var(--yellow)}',
    '.ac-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}',
    '.ac-kpi{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px}.ac-kpi .l{font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)}.ac-kpi .v{font-family:var(--font-mono);font-size:1.25rem;font-weight:700;color:var(--text);margin-top:2px}.ac-kpi .s{font-size:.7rem;color:var(--text-muted);margin-top:2px}',
    '.ac-panel{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:14px}',
    '.ac-panel .section-title{margin:0 0 8px}',
    '.ac-chart{position:relative;height:260px}',
    '.ac-table-wrap{overflow-x:auto}.ac-table{width:100%;border-collapse:collapse;font-size:.78rem}.ac-table th{font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim);text-align:right;padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap}.ac-table td{padding:6px 8px;text-align:right;font-family:var(--font-mono);border-bottom:1px solid rgba(37,37,72,.5);white-space:nowrap}.ac-table th:first-child,.ac-table td:first-child{text-align:left;font-family:var(--font-body)}.ac-table tbody tr{cursor:pointer}.ac-table tbody tr:hover{background:var(--card-hover)}',
    '.ac-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle}',
    '.ac-pill{display:inline-block;padding:1px 7px;border:1px solid currentColor;border-radius:999px;font-size:.58rem;font-weight:700;letter-spacing:.08em;white-space:nowrap;margin-left:4px;vertical-align:middle}',
    '.ac-good{color:var(--green)}.ac-ok{color:var(--cyan)}.ac-warn{color:var(--yellow)}.ac-bad{color:var(--red)}.ac-muted{color:var(--text-muted)}',
    '.ac-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}',
    '.ac-card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px;border-top:3px solid var(--border)}',
    '.ac-card h3{font-size:.9rem;margin:0;display:flex;align-items:center;flex-wrap:wrap;gap:4px}',
    '.ac-card .ac-nums{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:10px 0 6px}.ac-card .ac-nums .l{font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)}.ac-card .ac-nums .v{font-family:var(--font-mono);font-size:1rem;font-weight:700}.ac-card .ac-nums .s{font-size:.66rem;color:var(--text-muted)}',
    '.ac-spark{position:relative;height:90px;margin:4px 0 8px}',
    '.ac-post{font-size:.76rem;line-height:1.5;margin-top:4px}.ac-post .ac-lbl{font-weight:700;letter-spacing:.06em}',
    '.ac-src{font-size:.66rem;color:var(--text-dim);margin-top:8px;line-height:1.4}',
    '.ac-card details{margin-top:8px}.ac-card summary{cursor:pointer;font-size:.68rem;letter-spacing:.08em;color:var(--cyan);text-transform:uppercase}',
    '.ac-mini{width:100%;border-collapse:collapse;font-size:.7rem;margin-top:6px}.ac-mini th,.ac-mini td{padding:3px 5px;text-align:right;white-space:nowrap;border-bottom:1px solid rgba(37,37,72,.5)}.ac-mini th{color:var(--text-dim);font-weight:600;font-size:.58rem;letter-spacing:.08em;text-transform:uppercase}.ac-mini td{font-family:var(--font-mono)}.ac-mini th:first-child,.ac-mini td:first-child{text-align:left;font-family:var(--font-body)}',
    '.ac-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.7rem;color:var(--text-muted);margin-top:6px}',
    '.ac-empty{padding:24px;color:var(--text-muted);text-align:center}',
    '.ac-view{font-size:.78rem;color:var(--text-muted);margin:-4px 0 10px}.ac-view b{color:var(--text)}',
    '.ac-kpi .v small{font-size:.75rem;font-weight:600;color:var(--text-muted)}',
    '.ac-two{display:grid;grid-template-columns:3fr 2fr;gap:14px}@media (max-width:900px){.ac-two{grid-template-columns:1fr}}',
    '.ac-lead{position:relative}',
    '.ac-strip{position:relative;height:150px}',
    '.ac-foot{font-size:.68rem;color:var(--text-dim);margin-top:8px;line-height:1.5}',
    '.ac-heat-wrap{overflow-x:auto}.ac-heat{border-collapse:separate;border-spacing:2px;font-size:.7rem;width:100%}.ac-heat th{font-size:.58rem;letter-spacing:.06em;color:var(--text-dim);font-weight:600;text-align:center;padding:2px 0;white-space:nowrap}.ac-heat th:first-child{text-align:left}.ac-heat td{font-family:var(--font-mono);text-align:center;padding:5px 2px;border-radius:4px;min-width:40px;color:var(--text)}.ac-heat td:first-child{font-family:var(--font-body);text-align:left;white-space:nowrap;padding-left:0;min-width:140px}.ac-heat td.ac-h-none{color:var(--text-dim)}.ac-heat td.ac-h-low{color:var(--text-muted)}',
    '.ac-bands{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.66rem;color:var(--text-muted);margin-top:8px}.ac-bands i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:middle}',
    '.ac-log{width:100%;border-collapse:collapse;font-size:.74rem}.ac-log th{font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim);text-align:left;padding:5px 8px;border-bottom:1px solid var(--border)}.ac-log td{padding:5px 8px;border-bottom:1px solid rgba(37,37,72,.5);vertical-align:top}.ac-log td.m{font-family:var(--font-mono);white-space:nowrap}',
    '@media (max-width:600px){.ac-card .ac-nums{grid-template-columns:1fr 1fr}.ac-chart{height:220px}}'
  ].join('\n');

  var STATE = { inputs: null, series: null, window: DEFAULT_WINDOW, charts: [], rendered: false, loaded: false };

  function injectCss() {
    if (document.getElementById('ac-module-css')) return;
    var st = document.createElement('style');
    st.id = 'ac-module-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function ensureTab() {
    var panel = document.getElementById('tab-ad_channels');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'tab-ad_channels';
      panel.className = 'tab-content';
      var reports = document.getElementById('tab-reports');
      if (reports && reports.parentNode) reports.parentNode.appendChild(panel);
      else document.body.appendChild(panel);
    }
    var btn = document.querySelector('.tab[data-tab="ad_channels"]');
    if (!btn) {
      var anchor = document.querySelector('.tab[data-tab="throttles"]') || document.querySelector('.tab[data-tab="reports"]');
      if (anchor && anchor.parentNode) {
        btn = document.createElement('div');
        btn.className = 'tab';
        btn.setAttribute('data-tab', 'ad_channels');
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      }
    }
    if (btn) btn.textContent = 'AD CHANNELS';
    if (btn && !btn._acBound) {
      btn._acBound = true;
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
        document.body.classList.remove('reports-active');
        btn.classList.add('active');
        panel.classList.add('active');
        if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, null, '#ad-channels');
        render();
      });
    }
    return panel;
  }

  function destroyCharts() {
    STATE.charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* noop */ } });
    STATE.charts = [];
  }

  function pillHtml(text, cls) { return '<span class="ac-pill ' + cls + '">' + esc(text) + '</span>'; }

  function trackingPill(st) {
    if (!st) return pillHtml('TRK ?', 'ac-muted');
    if (st === 'OK') return pillHtml('TRK OK', 'ac-good');
    if (st === 'WARN') return pillHtml('TRK WARN', 'ac-warn');
    if (st === 'DOWN') return pillHtml('TRK DOWN', 'ac-bad');
    return pillHtml('TRK ' + st, 'ac-muted');
  }
  function growthCls(code) {
    if (code === 'incomplete' || code === 'stale') return 'ac-warn';
    return code === 'growing' || code === 'launching' ? 'ac-good' : code === 'shrinking' || code === 'stopped' ? 'ac-bad' : 'ac-muted';
  }
  function growthArrow(g) {
    if (g.code === 'growing' || g.code === 'launching') return '▲';
    if (g.code === 'shrinking' || g.code === 'stopped') return '▼';
    if (g.code === 'incomplete' || g.code === 'nofeed' || g.code === 'stale') return '◌';
    return '▬';
  }

  function sparkline(canvas, labels, spend, revenue, color) {
    if (typeof Chart === 'undefined' || !canvas) return null;
    var datasets = [{ label: 'Spend', data: spend, backgroundColor: color, borderRadius: 2, barPercentage: 0.8, categoryPercentage: 0.9 }];
    if (revenue.some(function (v) { return v != null; })) {
      datasets.push({ label: 'Platform-reported revenue', data: revenue, type: 'line', borderColor: '#e8e8f0', borderWidth: 2, pointRadius: 2, pointBackgroundColor: '#e8e8f0', tension: 0.25, spanGaps: false });
    }
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + (c.parsed.y == null ? 'no row' : usd(c.parsed.y)); } } } },
        scales: {
          x: { display: false },
          y: { display: false, beginAtZero: true }
        }
      }
    });
    STATE.charts.push(chart);
    return chart;
  }

  function stackedChart(canvas, labels, seriesList, markers) {
    if (typeof Chart === 'undefined' || !canvas) return null;
    var chart = new Chart(canvas.getContext('2d'), {
      plugins: [markersPlugin(markers || [])],
      type: 'bar',
      data: {
        labels: labels,
        datasets: seriesList.map(function (s) {
          return { label: s.label, data: s.data, backgroundColor: s.color, borderColor: '#131328', borderWidth: 1, stack: 'spend', barPercentage: 0.85, categoryPercentage: 0.9 };
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { color: '#8888a8', boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + (c.parsed.y == null ? 'no row' : usd(c.parsed.y)); }, footer: function (items) { var t = 0; items.forEach(function (i) { t += n0(i.parsed.y); }); return 'Total ' + usd(t); } } }
        },
        scales: {
          x: { stacked: true, ticks: { color: '#5c5c7a', maxTicksLimit: 10, font: { size: 10 } }, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { color: '#8888a8', font: { size: 10 }, callback: function (v) { return '$' + Number(v).toLocaleString(); } }, grid: { color: 'rgba(37,37,72,0.7)' } }
        }
      }
    });
    STATE.charts.push(chart);
    return chart;
  }

  function bandFill(b, alpha) {
    var hex = BAND_COLOR[b] || BAND_COLOR.none;
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), bl = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + bl + ',' + alpha + ')';
  }
  function kusd(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    var n = Number(v);
    return Math.abs(n) >= 1000 ? '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : '$' + Math.round(n);
  }

  // Horizontal ROAS bars; the Jarvis cut / raise thresholds are drawn as hairlines with the
  // cut zone and raise zone tinted, so the picture is "who sits where against the rule".
  function leaderboardChart(canvas, lb) {
    if (typeof Chart === 'undefined' || !canvas || !lb.rows.length) return null;
    var th = lb.thresholds;
    var rows = lb.rows;
    var judgedMax = rows.reduce(function (m, r) { return r.band === 'low' || r.band === 'none' ? m : Math.max(m, r.roas7 || 0); }, th.raise * 1.5);
    var maxRoas = Math.ceil(judgedMax * 1.3);
    var plug = {
      id: 'acBands',
      beforeDatasetsDraw: function (chart) {
        var x = chart.scales.x, area = chart.chartArea, ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = bandFill('cut', 0.08);
        ctx.fillRect(area.left, area.top, x.getPixelForValue(th.cut) - area.left, area.bottom - area.top);
        ctx.fillStyle = bandFill('raise', 0.08);
        ctx.fillRect(x.getPixelForValue(th.raise), area.top, area.right - x.getPixelForValue(th.raise), area.bottom - area.top);
        ctx.strokeStyle = 'rgba(232,232,240,0.35)'; ctx.lineWidth = 1;
        [th.cut, th.raise].forEach(function (v) {
          var px = Math.round(x.getPixelForValue(v)) + 0.5;
          ctx.beginPath(); ctx.moveTo(px, area.top); ctx.lineTo(px, area.bottom); ctx.stroke();
        });
        ctx.fillStyle = '#8888a8'; ctx.font = '600 10px ' + 'Inter, system-ui, sans-serif'; ctx.textBaseline = 'bottom';
        ctx.textAlign = 'right'; ctx.fillText('cut < ' + th.cut.toFixed(1) + 'x ', x.getPixelForValue(th.cut), area.top - 2);
        ctx.textAlign = 'left'; ctx.fillText(' raise ≥ ' + th.raise.toFixed(1) + 'x', x.getPixelForValue(th.raise), area.top - 2);
        ctx.restore();
      },
      afterDatasetsDraw: function (chart) {
        var ctx = chart.ctx, meta = chart.getDatasetMeta(0), area = chart.chartArea;
        ctx.save();
        ctx.font = '600 11px JetBrains Mono, monospace'; ctx.textBaseline = 'middle';
        meta.data.forEach(function (bar, i) {
          var r = rows[i];
          var txt = (r.roas7 == null ? '—' : r.roas7.toFixed(2) + 'x') + '  ' + kusd(r.spend7) + (lb.win > 1 && r.days < lb.win ? '  ' + r.days + '/' + lb.win + 'd' : '');
          var w = ctx.measureText(txt).width;
          var inside = bar.x - area.left > w + 16;
          ctx.fillStyle = inside ? '#0d0d1a' : '#e8e8f0'; ctx.textAlign = inside ? 'right' : 'left';
          ctx.fillText(txt, inside ? bar.x - 8 : bar.x + 8, bar.y);
        });
        ctx.restore();
      }
    };
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: rows.map(function (r) { return r.label; }),
        datasets: [{ label: 'Platform ROAS 7d', data: rows.map(function (r) { return r.roas7 == null ? 0 : Math.min(r.roas7, maxRoas); }), backgroundColor: rows.map(function (r) { return BAND_COLOR[r.band]; }), borderRadius: 3, barThickness: 16, borderSkipped: 'start' }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { top: 14, right: 8 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { var r = rows[c.dataIndex]; return [roasTxt(r.roas7) + ' · ' + usd(r.value7) + ' platform value ÷ ' + usd(r.spend7) + ' spend', (lb.win === 1 ? 'reported ' + mmdd(r.latest) : r.days + ' of ' + lb.win + ' days reported' + (r.latest ? ' · through ' + mmdd(r.latest) : '')), BAND_LABEL[r.band] + (r.basis ? ' · ' + r.basis : '')]; } } } },
        scales: {
          x: { min: 0, max: maxRoas, ticks: { color: '#5c5c7a', font: { size: 10 }, callback: function (v) { return v + 'x'; } }, grid: { color: 'rgba(37,37,72,0.7)' } },
          y: { ticks: { color: '#e8e8f0', font: { size: 11 } }, grid: { display: false } }
        }
      },
      plugins: [plug]
    });
    STATE.charts.push(chart);
    return chart;
  }

  // Share of platform spend vs share of platform-reported value, same rows as the leaderboard.
  function sharesChart(canvas, lb) {
    if (typeof Chart === 'undefined' || !canvas || !lb.rows.length) return null;
    var rows = lb.rows.filter(function (r) { return r.spendShare != null; });
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: rows.map(function (r) { return r.label; }),
        datasets: [
          { label: '% of platform spend ' + winShort(lb.win || 7), data: rows.map(function (r) { return Math.round(r.spendShare * 10) / 10; }), backgroundColor: '#8888a8', borderRadius: 2, barThickness: 7 },
          { label: '% of platform-reported value ' + winShort(lb.win || 7), data: rows.map(function (r) { return Math.round((r.valueShare || 0) * 10) / 10; }), backgroundColor: '#00d4d4', borderRadius: 2, barThickness: 7 }
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { top: 14, right: 8 } },
        plugins: { legend: { position: 'bottom', labels: { color: '#8888a8', boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + c.parsed.x.toFixed(1) + '%'; } } } },
        scales: {
          x: { min: 0, max: 100, ticks: { color: '#5c5c7a', font: { size: 10 }, callback: function (v) { return v + '%'; } }, grid: { color: 'rgba(37,37,72,0.7)' } },
          y: { ticks: { color: '#e8e8f0', font: { size: 11 } }, grid: { display: false } }
        }
      }
    });
    STATE.charts.push(chart);
    return chart;
  }

  // Vertical hairline + label per Jarvis action on the daily spend chart.
  function markersPlugin(markers) {
    return {
      id: 'acMarkers',
      afterDatasetsDraw: function (chart) {
        if (!markers.length) return;
        var x = chart.scales.x, area = chart.chartArea, ctx = chart.ctx;
        ctx.save();
        ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.textBaseline = 'top';
        var rowEnd = [-1e9, -1e9, -1e9, -1e9];
        markers.forEach(function (m) {
          var px = Math.round(x.getPixelForValue(m.idx)) + 0.5;
          ctx.strokeStyle = 'rgba(232,232,240,0.45)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(px, area.top); ctx.lineTo(px, area.bottom); ctx.stroke();
          var w = ctx.measureText(m.label).width + 10;
          var row = 0;
          while (row < rowEnd.length - 1 && rowEnd[row] > px - 2) row += 1;
          rowEnd[row] = px + w + 4;
          var ty = area.top + 2 + row * 14;
          var lx = Math.min(px + 3, area.right - w);
          ctx.fillStyle = 'rgba(13,13,26,0.85)'; ctx.fillRect(lx, ty, w, 12);
          ctx.fillStyle = m.kind === 'scale' ? '#22c55e' : m.kind === 'kill' ? '#ef4444' : m.kind === 'cut' ? '#f59e0b' : '#e8e8f0';
          ctx.textAlign = 'left'; ctx.fillText(m.label, lx + 5, ty + 1);
        });
        ctx.restore();
      }
    };
  }

  // Daily Shop/DTC MER line with the Jarvis hold band and the owner's MER target.
  function merStripChart(canvas, labels, points, th, target) {
    if (typeof Chart === 'undefined' || !canvas) return null;
    var vals = points.map(function (p) { return p.mer; });
    if (!vals.some(function (v) { return v != null; })) return null;
    var top = Math.max.apply(null, vals.filter(function (v) { return v != null; }).concat([target || 0, th.raise])) * 1.15;
    var plug = {
      id: 'acMerBand',
      beforeDatasetsDraw: function (chart) {
        var y = chart.scales.y, area = chart.chartArea, ctx = chart.ctx;
        ctx.save();
        var yR = y.getPixelForValue(th.raise), yC = y.getPixelForValue(th.cut);
        ctx.fillStyle = 'rgba(136,136,168,0.12)';
        ctx.fillRect(area.left, yR, area.right - area.left, yC - yR);
        ctx.fillStyle = bandFill('cut', 0.07);
        ctx.fillRect(area.left, yC, area.right - area.left, area.bottom - yC);
        ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#8888a8';
        ctx.fillText('hold ' + th.cut.toFixed(1) + '–' + th.raise.toFixed(1) + 'x', area.right - 4, yR - 1);
        if (target != null) {
          var yT = Math.round(y.getPixelForValue(target)) + 0.5;
          ctx.strokeStyle = 'rgba(34,197,94,0.7)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(area.left, yT); ctx.lineTo(area.right, yT); ctx.stroke();
          ctx.fillStyle = '#22c55e'; ctx.textAlign = 'left';
          ctx.fillText('target ' + target.toFixed(2) + 'x', area.left + 4, yT - 1);
        }
        ctx.restore();
      }
    };
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: labels, datasets: [{ label: 'Shop/DTC MER', data: vals, borderColor: '#e8e8f0', borderWidth: 2, pointRadius: 2.5, pointBackgroundColor: vals.map(function (v) { return v == null ? '#e8e8f0' : BAND_COLOR[band(v, null, th)] === BAND_COLOR.hold ? '#e8e8f0' : BAND_COLOR[band(v, null, th)]; }), pointBorderColor: '#171730', pointBorderWidth: 1, tension: 0.2, spanGaps: false }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { var p = points[c.dataIndex]; return p.mer == null ? 'no Shopify row' : roasTxt(p.mer) + ' · ' + usd(p.revenue) + ' Shop/DTC revenue ÷ ' + usd(p.ads) + ' known ads' + (p.status ? ' · ' + p.status : ''); } } } },
        scales: {
          x: { ticks: { color: '#5c5c7a', maxTicksLimit: 10, font: { size: 10 } }, grid: { display: false } },
          y: { min: 0, max: Math.ceil(top * 2) / 2, ticks: { color: '#8888a8', font: { size: 10 }, callback: function (v) { return v + 'x'; } }, grid: { color: 'rgba(37,37,72,0.7)' } }
        }
      },
      plugins: [plug]
    });
    STATE.charts.push(chart);
    return chart;
  }

  function heatmapHtml(hm) {
    if (!hm.rows.length) return '<div class="ac-empty">No platform-reported ROAS in the last ' + hm.dates.length + ' days (daily report performance.platforms).</div>';
    var head = '<tr><th>Platform · ' + hm.dates.length + 'd spend</th>' + hm.dates.map(function (d) { return '<th>' + esc(mmdd(d)) + '</th>'; }).join('') + '</tr>';
    var body = hm.rows.map(function (r) {
      var cells = r.cells.map(function (c) {
        if (c.ratio == null) return '<td class="ac-h-none" title="' + esc(mmdd(c.date) + ': no platform read') + '">·</td>';
        var tip = mmdd(c.date) + ': ' + roasTxt(c.ratio) + ' · ' + usd(c.value) + ' ÷ ' + usd(c.spend) + (c.low ? ' · under $' + LOW_SPEND + ' spend, not judged' : ' · ' + BAND_LABEL[c.band]) + (c.basis ? ' · ' + c.basis : '');
        var bg = c.low ? 'transparent' : bandFill(c.band, c.band === 'hold' ? 0.18 : 0.28);
        return '<td class="' + (c.low ? 'ac-h-low' : '') + '" style="background:' + bg + '" title="' + esc(tip) + '">' + c.ratio.toFixed(1) + '</td>';
      }).join('');
      return '<tr><td><span class="ac-dot" style="background:' + r.color + '"></span>' + esc(r.label) + ' <span class="ac-muted">' + kusd(r.spend) + '</span></td>' + cells + '</tr>';
    }).join('');
    return '<div class="ac-heat-wrap"><table class="ac-heat"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>'
      + '<div class="ac-bands"><span><i style="background:' + bandFill('raise', 0.6) + '"></i>≥ ' + hm.thresholds.raise.toFixed(1) + 'x raise band</span><span><i style="background:' + bandFill('hold', 0.5) + '"></i>' + hm.thresholds.cut.toFixed(1) + '–' + hm.thresholds.raise.toFixed(1) + 'x hold</span><span><i style="background:' + bandFill('cut', 0.6) + '"></i>&lt; ' + hm.thresholds.cut.toFixed(1) + 'x cut band</span><span><i style="border:1px solid var(--border)"></i>under $' + LOW_SPEND + '/day, not judged</span><span>· no platform read</span></div>';
  }

  function actionLogHtml(changes, asOf) {
    var list = (Array.isArray(changes) ? changes : []).filter(function (c) { return c && isDate(c.date) && c.channel; }).slice().sort(function (a, b) { return b.date.localeCompare(a.date) || String(a.channel).localeCompare(String(b.channel)); });
    if (!list.length) return '<div class="ac-empty">No Jarvis budget actions published (ads_throttle/changes.json).</div>';
    var rows = list.slice(0, 20).map(function (c) {
      var ch = byId(c.channel);
      var k = actionKind(c.action);
      var cls = k === 'scale' ? 'ac-good' : k === 'kill' ? 'ac-bad' : k === 'cut' ? 'ac-warn' : 'ac-muted';
      var budget = num(c.old_budget) != null && num(c.new_budget) != null ? usd(c.old_budget) + ' → ' + usd(c.new_budget) + '/day' : '—';
      var roas = typeof c.roas_7d === 'number' ? roasTxt(c.roas_7d) : (c.roas_7d ? String(c.roas_7d).slice(0, 40) : '—');
      var age = asOf ? daysBetween(c.date, asOf) : null;
      return '<tr><td class="m">' + esc(shortDate(c.date)) + (age != null && age <= ACTION_RECENT_DAYS ? '' : ' <span class="ac-muted">(history)</span>') + '</td>'
        + '<td><span class="ac-dot" style="background:' + ((ch && ch.color) || OTHER_COLOR) + '"></span>' + esc(ch ? ch.label : c.channel) + '</td>'
        + '<td class="' + cls + '">' + esc(markerLabel(c)) + '</td><td class="m">' + esc(budget) + '</td><td class="m">' + esc(roas) + '</td>'
        + '<td class="ac-muted">' + esc(String(c.status || c.budget_note || c.roas_source || '').slice(0, 140)) + (c.by ? ' · ' + esc(c.by) : '') + '</td></tr>';
    }).join('');
    return '<table class="ac-log"><thead><tr><th>Date</th><th>Channel</th><th>Action</th><th>Budget</th><th>ROAS 7d at the time</th><th>Note</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function cardHtml(s, stacked, dates) {
    var ch = s.ch;
    var g = s.growth;
    var W = winShort(s.win || 7);
    var wowTxt = g.wow == null ? (g.code === 'launching' ? 'new' : '') : pct(g.wow, 0) + (s.win === 7 ? ' WoW' : s.win === 1 ? ' DoD' : ' vs prior');
    var platformNote;
    if (s.platformDays7 > 0) platformNote = (s.win === 1 ? 'platform reported' : s.platformDays7 + ' of ' + s.win + ' days reported') + (s.platformLatest && s.end && s.platformLatest < s.end ? ' · through ' + mmdd(s.platformLatest) : '') + (s.platformBasis ? ' · ' + s.platformBasis : '');
    else if (s.spend7 > 0) platformNote = 'no platform read';
    else platformNote = '';
    var head = '<h3><span class="ac-dot" style="background:' + ch.color + '"></span>' + esc(ch.label)
      + (s.statusLabel === 'LIVE' ? pillHtml('LIVE', 'ac-good') : s.statusLabel === 'STALE' ? pillHtml('STALE', 'ac-warn') : s.statusLabel === 'NOT LAUNCHED' ? pillHtml('NOT LAUNCHED', 'ac-muted') : s.live === false ? pillHtml(s.status === 'pre_launch' ? 'PRE-LAUNCH' : 'NOT LIVE', 'ac-muted') : pillHtml(s.statusLabel || 'NO FEED', 'ac-muted'))
      + (s.mode ? pillHtml(String(s.mode).toUpperCase(), s.mode === 'auto' ? 'ac-ok' : 'ac-muted') : '')
      + trackingPill(s.tracking) + '</h3>';
    var nums = '<div class="ac-nums">'
      + '<div><div class="l">Yesterday</div><div class="v">' + esc(dv(ch, usd(s.yday))) + '</div><div class="s">' + (s.end ? shortDate(s.end) : '') + (ch.cashCost && s.ydayCash != null ? ' · cash ' + usd(s.ydayCash) : '') + '</div></div>'
      + '<div><div class="l">' + (s.win === 1 ? 'Spend (yesterday)' : s.win + '-day spend') + '</div><div class="v">' + esc(dv(ch, usd(s.spend7))) + '</div><div class="s ' + growthCls(g.code) + '">' + growthArrow(g) + ' ' + esc(g.label) + (wowTxt ? ' · ' + wowTxt : '') + '</div>' + (g.code === 'incomplete' || g.code === 'stale' ? '<div class="s ac-warn">' + (ch.noDataLabel ? esc(ch.noDataLabel) + ' for ' : 'missing days are not $0 — ') + esc((s.feed && s.feed.missing7 || []).map(mmdd).join(', ') || 'feed gap') + (ch.noDataLabel ? ' · excluded from tracked spend' : '') + '</div>' : '') + '</div>'
      + '<div><div class="l">Share ' + W + '</div><div class="v">' + esc(dv(ch, s.share == null ? '—' : s.share.toFixed(0) + '%')) + '</div><div class="s">of tracked ad spend · 30d ' + esc(dv(ch, usd(s.spend30))) + '</div></div>'
      + '<div><div class="l">Platform ROAS ' + W + '</div><div class="v">' + esc(dv(ch, roasTxt(s.roas7))) + '</div><div class="s">' + esc(platformNote) + '</div></div>'
      + '<div><div class="l">Platform revenue ' + W + '</div><div class="v">' + esc(dv(ch, usd(s.platformRev7))) + '</div><div class="s">platform-reported, not store sales</div></div>'
      + '<div><div class="l">Conversions ' + W + '</div><div class="v">' + esc(dv(ch, intTxt(s.platformConv7))) + '</div><div class="s">' + (s.platformClicks7 != null ? intTxt(s.platformClicks7) + ' clicks' : '') + '</div></div>'
      + '</div>';
    var spark = '<div class="ac-spark"><canvas id="ac-spark-' + ch.id + '"></canvas></div>'
      + '<div class="ac-legend"><span><span class="ac-dot" style="background:' + ch.color + '"></span>daily spend</span>' + (s.platformDays7 > 0 || s.platformAny ? '<span><span class="ac-dot" style="background:#e8e8f0"></span>platform-reported revenue</span>' : '') + '<span>' + esc(String(stacked)) + ' days</span></div>';
    var post = '<div class="ac-post"><span class="ac-lbl ' + s.posture.cls + '">' + esc(s.posture.label) + '</span>'
      + (s.posture.detail.length ? '<br><span class="ac-muted">' + esc(s.posture.detail.join(' · ')) + '</span>' : '')
      + (s.rank ? '<br><span class="ac-muted">Jarvis ' + mmdd(s.rankDate) + ': ' + esc(s.rank.tier || '—') + (num(s.rank.roas_7d) != null ? ' · ' + roasTxt(s.rank.roas_7d) + ' 7d' : '') + (num(s.rank.roas_28d) != null ? ' · ' + roasTxt(s.rank.roas_28d) + ' 28d' : '') + (num(s.rank.wow_spend_change_pct) != null ? ' · spend ' + pct(s.rank.wow_spend_change_pct, 0) + ' WoW' : '') + '</span>' : '')
      + (s.d2c7 != null && s.spend7 != null && Math.abs(s.d2c7 - s.spend7) > 0.5 ? '<br><span class="ac-muted">D2C share of spend ' + W + ': ' + usd(s.d2c7) + (ch.note ? ' — ' + esc(ch.note) : '') + '</span>' : (ch.note && ch.cashCost ? '<br><span class="ac-muted">' + esc(ch.note) + (s.cash7 != null ? ' · cash cost 7d ' + usd(s.cash7) : '') + '</span>' : ''))
      + '</div>';
    var src = '<div class="ac-src">spend: ' + esc(s.spendSource || 'no feed') + (s.spendLatest ? ' · through ' + mmdd(s.spendLatest) : '') + (s.feed && s.feed.code === 'stale' ? ' · STALE vs portfolio ' + mmdd(s.end) : '')
      + '<br>platform: ' + esc(s.platformSource || 'none')
      + (s.ownerBot ? '<br>owner: ' + esc(s.ownerBot) : '')
      + (s.trackingNotes ? '<br>tracking: ' + esc(String(s.trackingNotes).slice(0, 220)) + (String(s.trackingNotes).length > 220 ? '…' : '') : '')
      + '</div>';
    var rows = dates.slice(-14).reverse().map(function (d) {
      var r = STATE.series.channels[ch.id].days[d];
      var nd = esc(dv(ch, '—'));
      if (!r) return '<tr><td>' + esc(shortDate(d)) + '</td><td>' + nd + '</td><td>' + nd + '</td><td>' + nd + '</td><td>' + nd + '</td></tr>';
      var roas = dayRoas(r);
      // measured $0 day: number-only row (metrics n/a "—"), never "No data" next to a number of spend
      var gap = r.spend === 0 ? '—' : nd;
      function g(txt) { return txt === '—' ? gap : txt; }
      return '<tr><td>' + esc(shortDate(d)) + '</td><td>' + esc(dv(ch, usd(r.spend, 2))) + '</td><td>' + (r.hasPlatform ? esc(g(usd(r.revenue, 2))) : gap) + '</td><td>' + (r.hasPlatform ? esc(g(intTxt(r.conversions))) : gap) + '</td><td>' + esc(g(roasTxt(roas))) + '</td></tr>';
    }).join('');
    var det = '<details><summary>Last 14 days</summary><table class="ac-mini"><thead><tr><th>Day</th><th>Spend</th><th>Plat. rev</th><th>Conv</th><th>ROAS</th></tr></thead><tbody>' + rows + '</tbody></table></details>';
    return '<div class="ac-card" id="ac-card-' + ch.id + '" style="border-top-color:' + ch.color + '">' + head + nums + spark + post + src + det + '</div>';
  }

  function render() {
    if (typeof document === 'undefined') return;
    var panel = document.getElementById('tab-ad_channels');
    if (!panel) return;
    if (!STATE.loaded) {
      panel.innerHTML = '<div class="ac-empty">Loading ad-channel feeds…</div>';
      return;
    }
    destroyCharts();
    var inputs = STATE.inputs || {};
    var series = STATE.series = buildSeries(inputs);
    if (!series.spendThrough) {
      panel.innerHTML = '<div class="ac-empty">No ad-channel spend published yet (daily report advertising_sources / mer_for_manus.json).</div>';
      return;
    }
    var end = series.spendThrough;
    var win = STATE.window;                       // the selected view: 1 (yesterday), 7, 14, 28, 60, 90
    var W = winShort(win), WL = winLabel(win);
    var chartDays = Math.max(win, MIN_CHART_DAYS); // time-series panels always show at least a week
    var stats = CHANNELS.map(function (ch) { return channelStats(ch, series, inputs, end, win); });
    var tracked = stats.reduce(function (a, s) { return a + n0(s.spend7); }, 0);
    stats.forEach(function (s) {
      s.share = tracked > 0 && s.spend7 != null ? s.spend7 / tracked * 100 : null;
      s.platformAny = Object.keys(series.channels[s.ch.id].days).some(function (d) { return series.channels[s.ch.id].days[d].hasPlatform; });
    });
    stats.sort(function (a, b) { return n0(b.spend7) - n0(a.spend7) || a.ch.label.localeCompare(b.ch.label); });
    var sum = summarize(stats, series, inputs, end, win);
    var dates = windowDates(end, chartDays);
    var notes = freshness(series, inputs);

    var html = '';
    var lb = leaderboard(series, end, inputs.settings, win);
    var hmDays = Math.min(chartDays, MAX_HEATMAP_DAYS);
    var hm = heatmap(series, end, hmDays, inputs.settings);
    var endTxt = win === 1 ? esc(shortDate(end).toUpperCase()) : WL + ' ENDING ' + esc(shortDate(end).toUpperCase());
    var changesList = inputs.changes || (inputs.mer && inputs.mer.ad_channel_throttles && inputs.mer.ad_channel_throttles.recent_changes) || [];
    var markers = actionMarkers(changesList, dates);
    var merPts = merDaily(series, dates);
    var merTarget = inputs.mer && num(inputs.mer.mer_target) != null ? num(inputs.mer.mer_target) : null;
    var th = lb.thresholds;

    html += '<div class="ac-head"><div><h2>Ad channels · who is winning, daily</h2><div class="ac-sub">Every platform\'s own reported return against the Jarvis rule (cut &lt; ' + th.cut.toFixed(1) + 'x · hold · raise ≥ ' + th.raise.toFixed(1) + 'x), spend by channel with Jarvis actions marked, and Shop/DTC MER by day against the target. Platform value is the platform\'s own attribution: it over-credits and overlaps, compares platforms, and is never added to store revenue.</div></div>'
      + '<div class="ac-win" role="tablist" aria-label="Window">' + WINDOWS.map(function (w) { return '<button data-win="' + w + '" class="' + (w === win ? 'on' : '') + '" title="' + (w === 1 ? 'Yesterday only' : 'Last ' + w + ' days') + '">' + winBtn(w) + '</button>'; }).join('') + '</div></div>';
    html += '<div class="ac-view">Showing <b>' + (win === 1 ? 'yesterday, ' + esc(shortDate(end)) : 'the ' + win + ' days ending ' + esc(shortDate(end))) + '</b>' + (win > 1 ? ' vs the ' + win + ' days before' : ' vs the day before') + ' · every panel below follows this selector' + (chartDays > win ? ' (the daily charts keep the last ' + chartDays + ' days for context)' : '') + '.</div>';
    html += '<div class="ac-asof">' + notes.map(function (n) { return '<span><b>' + esc(n.k) + ':</b> ' + esc(n.v) + ' <span class="ac-muted">(' + esc(n.src) + ')</span>' + (n.warn ? ' <span class="ac-warn-txt">⚠ ' + esc(n.warn) + '</span>' : '') + '</span>'; }).join('') + '</div>';

    var pooledTxt = lb.pooled ? roasTxt(lb.pooled.roas) : '—';
    var merDelta = sum.blended && merTarget != null ? sum.blended.mer - merTarget : null;
    html += '<div class="ac-kpis">'
      + '<div class="ac-kpi"><div class="l">Blended MER ' + W + ' (D2C)</div><div class="v">' + (sum.blended ? roasTxt(sum.blended.mer) : '—') + '</div>' + (merDelta != null ? '<div class="s ' + (merDelta >= 0 ? 'ac-good' : 'ac-bad') + '">' + (merDelta >= 0 ? '+' : '−') + Math.abs(merDelta).toFixed(2) + ' vs target ' + merTarget.toFixed(2) + 'x</div>' : '') + '<div class="s">' + (sum.blended ? usd(sum.blended.rev) + (sum.blended.shopDtc ? ' Shop/DTC ÷ ' + usd(sum.blended.d2c) + ' known ads (daily reports)' : ' Shopify D2C ÷ ' + usd(sum.blended.d2c) + ' D2C ads') + ' · through ' + mmdd(sum.blended.through) : 'withheld — no Shop/DTC row for ' + esc((sum.blendedMissing || []).slice(0, 4).map(mmdd).join(', ')) + ((sum.blendedMissing || []).length > 4 ? ' +' + (sum.blendedMissing.length - 4) + ' more' : '')) + '</div></div>'
      + '<div class="ac-kpi"><div class="l">Platform ROAS ' + W + ' · pooled</div><div class="v">' + pooledTxt + '</div><div class="s">' + (lb.pooled ? usd(lb.pooled.value) + ' platform value ÷ ' + usd(lb.pooled.spend) + ' · ' + lb.pooled.platforms + ' platforms reporting' : 'no platform reads in the window') + '</div></div>'
      + '<div class="ac-kpi"><div class="l">Above raise / below cut</div><div class="v"><span class="ac-good">' + lb.above + '</span> <span class="ac-muted">/</span> <span class="ac-bad">' + lb.below + '</span></div><div class="s">' + lb.hold + ' in hold band · ' + W + ' platform ROAS, ≥ ' + usd(th.minSpend) + ' spend</div></div>'
      + '<div class="ac-kpi"><div class="l">Tracked ad spend ' + W + '</div><div class="v">' + usd(sum.tracked7) + '</div><div class="s ' + (sum.trackedWow == null ? 'ac-muted' : sum.trackedWow > 0 ? 'ac-good' : sum.trackedWow < 0 ? 'ac-bad' : 'ac-muted') + '">' + (sum.missingDays7.length || sum.missingDaysPrev7.length ? '<span class="ac-warn">⚠ no channel spend for ' + esc(sum.missingDays7.concat(sum.missingDaysPrev7).map(mmdd).join(', ')) + ' — comparison withheld</span>' : sum.trackedWow == null ? 'no prior ' + (win === 1 ? 'day' : 'window') : pct(sum.trackedWow, 0) + ' vs prior ' + (win === 1 ? 'day' : W) + ' (' + usd(sum.tracked7prev) + ')') + '</div>'
      + (sum.unmeasured7 && sum.unmeasured7.length ? '<div class="s ac-muted">measured only · excludes unmeasured days: ' + esc(sum.unmeasured7.map(function (u) { return u.label + ' ' + u.days + '/' + win + 'd'; }).join(', ')) + '</div>' : '') + '</div>'
      + '<div class="ac-kpi"><div class="l">Growing / shrinking</div><div class="v"><span class="ac-good">' + sum.growing + '</span> <span class="ac-muted">/</span> <span class="ac-bad">' + sum.shrinking + '</span></div><div class="s">' + sum.live + ' of ' + sum.channels + ' live · spend ' + W + ' vs prior ' + (win === 1 ? 'day' : W) + ', ±' + GROWTH_PCT + '%' + (sum.incomplete ? ' · <span class="ac-warn">' + sum.incomplete + ' incomplete</span>' : '') + '</div></div>'
      + '<div class="ac-kpi"><div class="l">Scaling into / cutting</div><div class="v"><span class="ac-good">' + sum.scaling + '</span> <span class="ac-muted">/</span> <span class="ac-warn">' + sum.cutting + '</span></div><div class="s">Jarvis budget actions, last ' + ACTION_RECENT_DAYS + ' days</div></div>'
      + '</div>';

    // stacked spend by channel
    var ordered = stats.slice().sort(function (a, b) {
      var sa = n0(sumWindow(series.channels[a.ch.id].days, dates, 'spend').total);
      var sb = n0(sumWindow(series.channels[b.ch.id].days, dates, 'spend').total);
      return sb - sa;
    });
    var top = [], other = null;
    ordered.forEach(function (s) {
      var data = dates.map(function (d) { var r = series.channels[s.ch.id].days[d]; return r && r.spend != null ? r.spend : null; });
      if (!data.some(function (v) { return v > 0; })) return;
      if (!s.ch.other && top.length < MAX_STACK_SERIES) top.push({ label: s.ch.label, color: s.ch.color, data: data });
      else {
        if (!other) other = { label: 'Other', color: OTHER_COLOR, data: dates.map(function () { return 0; }), names: [] };
        other.names.push(s.ch.label);
        data.forEach(function (v, i) { if (v != null) other.data[i] += v; });
      }
    });
    var stackList = other ? top.concat([Object.assign({}, other, { label: 'Other (' + other.names.join(', ') + ')' })]) : top;
    var leadH = Math.max(140, 40 + lb.rows.length * 26);
    html += '<div class="ac-two">'
      + '<div class="ac-panel"><div class="section-title">WHO IS WINNING · PLATFORM ROAS, ' + endTxt + '</div>'
      + (lb.rows.length ? '<div class="ac-lead" style="height:' + leadH + 'px"><canvas id="ac-lead"></canvas></div>' : '<div class="ac-empty">No platform-reported value ' + (win === 1 ? 'for ' + esc(shortDate(end)) : 'in the last ' + win + ' days') + '.</div>')
      + '<div class="ac-foot">Bar = platform-reported purchase value ÷ that platform\'s own spend over the days it reported (daily report “Who\'s performing”, ' + esc(th.source) + ' thresholds). Grey = under ' + usd(th.minSpend) + (win === 1 ? ' on the day' : ' in ' + win + ' days') + ', not judged (rule: ' + usd(th.minSpend7) + ' per 7 days).' + (lb.noRead.length ? ' No platform read in this window: ' + esc(lb.noRead.join(', ')) + '.' : '') + '</div></div>'
      + '<div class="ac-panel"><div class="section-title">SPEND SHARE VS VALUE SHARE · ' + WL + '</div>'
      + (lb.rows.length ? '<div class="ac-lead" style="height:' + leadH + 'px"><canvas id="ac-shares"></canvas></div>' : '<div class="ac-empty">—</div>')
      + '<div class="ac-foot">Among the platforms that reported. A platform whose value share is far below its spend share is where the budget is least efficient on its own numbers.</div></div>'
      + '</div>';
    html += '<div class="ac-panel"><div class="section-title">PLATFORM ROAS BY DAY · LAST ' + hmDays + ' DAYS' + (hmDays < win ? ' OF ' + win : '') + '</div>' + heatmapHtml(hm) + '</div>';
    html += '<div class="ac-panel"><div class="section-title">DAILY AD SPEND BY CHANNEL · LAST ' + chartDays + ' DAYS' + (markers.length ? ' · ' + markers.length + ' JARVIS ACTION' + (markers.length === 1 ? '' : 'S') + ' MARKED' : '') + '</div><div class="ac-chart"><canvas id="ac-stack"></canvas></div></div>';
    html += '<div class="ac-panel"><div class="section-title">SHOP/DTC MER BY DAY · LAST ' + chartDays + ' DAYS</div>'
      + (merPts.some(function (p) { return p.mer != null; }) ? '<div class="ac-strip"><canvas id="ac-mer"></canvas></div>' : '<div class="ac-empty">No Shop/DTC rows in the daily reports for this window.</div>')
      + '<div class="ac-foot">Shop/DTC revenue ÷ known ad spend from each daily report (same numbers as the Daily Reports tab; partial days are provisional). Band = the Jarvis hold band; green line = owner MER target' + (merTarget != null ? ' ' + merTarget.toFixed(2) + 'x' : ' (not published)') + '.</div></div>';
    html += '<div class="ac-panel"><div class="section-title">JARVIS BUDGET ACTIONS</div>' + actionLogHtml(changesList, end) + '</div>';

    // portfolio table
    html += '<div class="ac-panel"><div class="section-title">PORTFOLIO · ' + endTxt + '</div><div class="ac-table-wrap"><table class="ac-table"><thead><tr>'
      + '<th>Channel</th><th>Status</th><th>Posture</th><th>Yesterday</th><th>' + (win === 1 ? 'Spend' : W + ' spend') + '</th><th>' + (win === 7 ? 'WoW' : 'vs prior') + '</th><th>Trend</th><th>Share</th><th>30d</th><th>Plat. rev ' + W + '</th><th>Plat. ROAS ' + W + '</th><th>Conv ' + W + '</th><th>Tracking</th><th>Last Jarvis action</th>'
      + '</tr></thead><tbody>';
    stats.forEach(function (s) {
      html += '<tr data-ch="' + s.ch.id + '"><td><span class="ac-dot" style="background:' + s.ch.color + '"></span>' + esc(s.ch.label) + '</td>'
        + '<td class="' + (s.statusLabel === 'LIVE' ? 'ac-good' : s.statusLabel === 'STALE' ? 'ac-warn' : 'ac-muted') + '">' + esc(s.statusLabel || '—') + '</td>'
        + '<td class="' + s.posture.cls + '">' + esc(s.posture.label) + '</td>'
        + '<td>' + esc(dv(s.ch, usd(s.yday))) + '</td><td>' + esc(dv(s.ch, usd(s.spend7))) + '</td>'
        + '<td class="' + growthCls(s.growth.code) + '">' + (s.growth.wow == null ? '—' : pct(s.growth.wow, 0)) + '</td>'
        + '<td class="' + growthCls(s.growth.code) + '">' + growthArrow(s.growth) + ' ' + esc(s.growth.label) + '</td>'
        + '<td>' + esc(dv(s.ch, s.share == null || s.spend7 == null ? '—' : s.share.toFixed(0) + '%')) + '</td><td>' + esc(dv(s.ch, usd(s.spend30))) + (s.spend30Days != null && s.spend30Days < 30 && s.spend30 != null ? ' <span class="ac-muted">(' + s.spend30Days + 'd)</span>' : '') + '</td>'
        + '<td>' + esc(dv(s.ch, usd(s.platformRev7))) + '</td><td>' + esc(dv(s.ch, roasTxt(s.roas7))) + (s.platformDays7 > 0 && s.platformDays7 < win ? ' <span class="ac-muted">(' + s.platformDays7 + 'd)</span>' : '') + '</td><td>' + esc(dv(s.ch, intTxt(s.platformConv7))) + '</td>'
        + '<td class="' + (s.tracking === 'OK' ? 'ac-good' : s.tracking === 'WARN' ? 'ac-warn' : s.tracking === 'DOWN' ? 'ac-bad' : 'ac-muted') + '">' + esc(s.tracking || '—') + '</td>'
        + '<td class="ac-muted" style="font-family:var(--font-body);text-align:left">' + esc(s.change ? actionLabel(s.change) : '—') + '</td></tr>';
    });
    html += '</tbody></table></div><div class="ac-sub" style="margin-top:8px">Platform ROAS = platform-reported purchase value ÷ that platform\'s own spend over the days it reported (' + esc(((inputs.settings || {}).global || {}).roas_source || 'platform_reported') + '; daily report “Who\'s performing” first, then mer_for_manus.json). Meta and Google mer nodes are spend-only, so their ROAS reads “—” unless <code>performance.platforms</code> reported. Conversions / clicks read “—” where the platform feed carries only value. A missing day is “—”, never a false $0. Measured $0 (complete/closed/verified) stays $0. Shopify-attributed revenue appears when <code>shopify_attribution_daily.json</code> has coverage. CFO publishes <code>advertising_sources_daily.json</code> and <code>&lt;channel&gt;_ads_daily.json</code> next to this page — empty <code>*_ads_data.json</code> stubs are ignored.</div></div>';

    // cards
    html += '<div class="ac-grid">' + stats.map(function (s) { return cardHtml(s, win, dates); }).join('') + '</div>';

    // daily grid
    var gridCols = stats.filter(function (s) { return n0(s.spend30) > 0 || n0(s.spend7) > 0; });
    html += '<div class="ac-panel" style="margin-top:14px"><details><summary style="cursor:pointer;font-size:.7rem;letter-spacing:.1em;color:var(--cyan);text-transform:uppercase">Daily grid · spend per channel · last ' + win + ' days</summary><div class="ac-table-wrap" style="margin-top:8px"><table class="ac-table"><thead><tr><th>Day</th>'
      + gridCols.map(function (s) { return '<th>' + esc(s.ch.label) + '</th>'; }).join('') + '<th>Tracked total</th><th>Blended MER</th></tr></thead><tbody>';
    dates.slice().reverse().forEach(function (d) {
      var tot = 0;
      var cells = gridCols.map(function (s) {
        var r = series.channels[s.ch.id].days[d];
        if (!r || r.spend == null) return '<td class="ac-muted">' + esc(dv(s.ch, '—')) + '</td>';
        tot += r.spend;
        var tip = r.hasPlatform ? 'platform rev ' + usd(r.revenue, 2) + (r.roas != null ? ' · ROAS ' + roasTxt(r.roas) : '') : 'no platform read';
        return '<td title="' + esc(tip) + '">' + usd(r.spend) + '</td>';
      }).join('');
      var b = series.blended[d];
      html += '<tr><td>' + esc(shortDate(d)) + '</td>' + cells + '<td>' + usd(tot) + '</td><td>' + (b && b.blended_mer != null ? roasTxt(b.blended_mer) : '—') + '</td></tr>';
    });
    html += '</tbody></table></div></details></div>';

    panel.innerHTML = html;

    // charts
    var labels = dates.map(function (d) { return mmdd(d); });
    leaderboardChart(document.getElementById('ac-lead'), lb);
    sharesChart(document.getElementById('ac-shares'), lb);
    stackedChart(document.getElementById('ac-stack'), labels, stackList, markers);
    merStripChart(document.getElementById('ac-mer'), labels, merPts, th, merTarget);
    stats.forEach(function (s) {
      var days = series.channels[s.ch.id].days;
      var spend = dates.map(function (d) { return days[d] && days[d].spend != null ? days[d].spend : null; });
      var rev = dates.map(function (d) { return days[d] && days[d].hasPlatform ? n0(days[d].revenue) : null; });
      sparkline(document.getElementById('ac-spark-' + s.ch.id), labels, spend, rev, s.ch.color);
    });

    panel.querySelectorAll('.ac-win button').forEach(function (b) {
      b.addEventListener('click', function () {
        STATE.window = Number(b.getAttribute('data-win')) || DEFAULT_WINDOW;
        try { localStorage.setItem('ac_window', String(STATE.window)); } catch (e) { /* private mode */ }
        render();
      });
    });
    panel.querySelectorAll('.ac-table tbody tr[data-ch]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var card = document.getElementById('ac-card-' + tr.getAttribute('data-ch'));
        if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    STATE.rendered = true;
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status + ' ' + url));
    });
  }

  function load() {
    var files = {
      mer: 'mer_for_manus.json',
      throttlesFile: 'ad_channel_throttles.json',
      settings: 'ads_throttle/settings.json',
      changes: 'ads_throttle/changes.json',
      rankings: 'ads_throttle/rankings.json',
      tracking: 'ads_throttle/tracking_health.json',
      seriesFile: 'ads_throttle/series.json'
    };
    var keys = Object.keys(files);
    var dailyUrls = CHANNELS.map(function (ch) { return dailyFileName(ch); });
    var dataIds = CHANNELS.filter(function (ch) { return ch.file && OPTIONAL_DATA_FILES[ch.id]; }).map(function (ch) { return ch.id; });
    var extra = [ADV_DAILY_FILE].concat(dailyUrls, dataIds.map(function (id) { return OPTIONAL_DATA_FILES[id]; }));
    return Promise.all(keys.concat(extra).map(function (k) {
      var url = files[k] || k;
      return fetchJson(url).then(function (doc) { return doc; }, function () { return null; });
    })).then(function (docs) {
      var inputs = { channelFiles: {}, dailyFiles: {} };
      keys.forEach(function (k, i) { inputs[k] = docs[i]; });
      var offset = keys.length;
      inputs.advertisingSourcesDaily = docs[offset];
      CHANNELS.forEach(function (ch, i) {
        inputs.dailyFiles[ch.id] = docs[offset + 1 + i];
      });
      dataIds.forEach(function (id, i) {
        inputs.channelFiles[id] = docs[offset + 1 + dailyUrls.length + i] || null;
      });
      STATE.inputs = inputs;
      STATE.loaded = true;
      return inputs;
    });
  }

  function boot() {
    injectCss();
    var panel = ensureTab();
    try { var w = Number(localStorage.getItem('ac_window')); if (WINDOWS.indexOf(w) !== -1) STATE.window = w; } catch (e) { /* noop */ }
    load().then(function () {
      if (panel.classList.contains('active')) render();
    });
    var h = typeof location !== 'undefined' ? location.hash : '';
    if (h === '#ad-channels' || h === '#ad_channels' || h === '#adchannels') {
      var btn = document.querySelector('.tab[data-tab="ad_channels"]');
      if (btn) btn.click();
    }
  }

  var api = {
    CHANNELS: CHANNELS,
    GROWTH_PCT: GROWTH_PCT,
    ACTION_RECENT_DAYS: ACTION_RECENT_DAYS,
    ALIASES: ALIASES,
    ADV_DAILY_FILE: ADV_DAILY_FILE,
    SCHEMA_CONTRACT: SCHEMA_CONTRACT,
    canonicalId: canonicalId,
    dailyFileName: dailyFileName,
    nodeFromAdv: nodeFromAdv,
    chEntry: chEntry,
    cardHtml: cardHtml,
    displayValue: dv,
    isPlaceholderNode: isPlaceholderNode,
    isMeasuredZero: isMeasuredZero,
    spendFromNode: spendFromNode,
    asDateMap: asDateMap,
    buildSeries: buildSeries,
    channelStats: channelStats,
    summarize: summarize,
    freshness: freshness,
    growthVerdict: growthVerdict,
    posture: posture,
    latestChange: latestChange,
    actionKind: actionKind,
    actionLabel: actionLabel,
    unwrapRankings: unwrapRankings,
    platformReported: platformReported,
    PLATFORM_UNITS: PLATFORM_UNITS,
    LOW_SPEND: LOW_SPEND,
    performanceRow: performanceRow,
    thresholds: thresholds,
    band: band,
    leaderboard: leaderboard,
    heatmap: heatmap,
    actionMarkers: actionMarkers,
    markerLabel: markerLabel,
    merDaily: merDaily,
    dayRoas: dayRoas,
    WINDOWS: WINDOWS,
    DEFAULT_WINDOW: DEFAULT_WINDOW,
    minSpendFor: minSpendFor,
    winLabel: winLabel,
    windowDates: windowDates,
    render: render,
    load: load,
    _state: STATE,
    _fmt: { usd: usd, pct: pct, roasTxt: roasTxt, shortDate: shortDate, mmdd: mmdd }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AdChannels = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
    else setTimeout(boot, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
