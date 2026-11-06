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
     growth  = measured spend, last 7 days vs the 7 before (±15 %)
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
  var GROWTH_PCT = 15;          // ±15 % week over week
  var ACTION_RECENT_DAYS = 14;  // a Jarvis raise/cut older than this is history, not posture
  var WINDOWS = [14, 28, 60, 90];
  var DEFAULT_WINDOW = 28;
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

  /* ------------------------------------------------------- day records */
  function emptyRec(date) {
    return {
      date: date, spend: null, spend_d2c: null, spend_amazon: null, cash_cost: null,
      clicks: null, impressions: null, conversions: null, revenue: null, roas: null,
      hasPlatform: false, live: null, complete: null, spendKind: null,
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

    var out = { channels: {}, dates: {}, spendThrough: null, platformThrough: null, merAsOf: (mer && isDate(mer.as_of)) ? mer.as_of : null, blended: {}, channelFeedThrough: {} };
    CHANNELS.forEach(function (ch) { out.channels[ch.id] = { days: {}, durableThrough: null }; });

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
      var latest = null, plat = null;
      Object.keys(bag.days).forEach(function (d) {
        var r = bag.days[d];
        if (r.spend != null && (!latest || d > latest)) latest = d;
        if (r.hasPlatform && r.spend != null && r.spend > 0 && (!plat || d > plat)) plat = d;
      });
      bag.feedThrough = latest;
      bag.platformThrough = plat;
      out.channelFeedThrough[ch.id] = latest;
    });

    // dates with any published spend
    var dates = Object.keys(out.dates).filter(function (d) {
      return CHANNELS.some(function (ch) { var r = out.channels[ch.id].days[d]; return r && r.spend != null; });
    }).sort();
    out.dates = dates;
    out.spendThrough = dates.length ? dates[dates.length - 1] : null;
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
  function growthVerdict(spend7, prev7, present7, presentPrev7) {
    if (present7 != null && presentPrev7 != null) {
      if (present7 === 0 && presentPrev7 === 0) return { code: 'nofeed', label: 'NO FEED', wow: null, missing: 14 };
      if (present7 < 7 || presentPrev7 < 7) {
        return { code: 'incomplete', label: 'INCOMPLETE · ' + present7 + '/7 + ' + presentPrev7 + '/7 days', wow: null, missing: (7 - present7) + (7 - presentPrev7) };
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
  function channelStats(ch, series, inputs, endDate) {
    inputs = inputs || {};
    var days = series.channels[ch.id].days;
    var end = endDate || series.spendThrough;
    var last7 = end ? windowDates(end, 7) : [];
    var prev7 = end ? windowDates(addDays(end, -7), 7) : [];
    var last30 = end ? windowDates(end, 30) : [];
    var s7 = sumWindow(days, last7, 'spend');
    var p7 = sumWindow(days, prev7, 'spend');
    var s30 = sumWindow(days, last30, 'spend');
    var d2c7 = sumWindow(days, last7, 'spend_d2c');
    var cash7 = sumWindow(days, last7, 'cash_cost');

    // platform window: only days where the platform reported AND spend > 0
    var pRev = 0, pConv = 0, pSpend = 0, pDays = 0, pClicks = 0, pLatest = null;
    last7.forEach(function (d) {
      var r = days[d];
      if (!r || !r.hasPlatform || r.spend == null || r.spend <= 0) return;
      pDays += 1; pSpend += r.spend; pRev += n0(r.revenue); pConv += n0(r.conversions); pClicks += n0(r.clicks);
      if (!pLatest || d > pLatest) pLatest = d;
    });
    var roas7 = pDays > 0 && pSpend > 0 ? pRev / pSpend : null;

    var ydayRec = end && days[end] ? days[end] : null;
    var growth = growthVerdict(n0(s7.total), n0(p7.total), s7.present, p7.present);

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
      growth = { code: 'stale', label: 'STALE · last row ' + mmdd(spendLatest) + ' · ' + s7.present + '/7 + ' + p7.present + '/7 days', wow: null, missing: missing7.length + missingPrev7.length };
    }

    var blk0 = mer ? chEntry(mer, ch) : null;
    var block = blk0 && typeof blk0 === 'object' ? blk0 : null;
    var status = (block && block.status) || null;
    var blockAsOf = block && isDate(block.as_of) ? block.as_of : null;
    var liveFresh = !!(blockAsOf && last7.length && blockAsOf >= last7[0]);
    var live = null;
    if (s7.total > 0) live = true;
    else if (liveFresh && block && typeof block.live === 'boolean') live = block.live;
    else if (ydayRec && typeof ydayRec.live === 'boolean' && ydayRec.spend != null) live = ydayRec.live;
    else if (s7.present && s7.total === 0) live = false;

    var darkHint = !!(ch.darkWhenZero || (setCh && (setCh.not_launched_while_zero || setCh.status === 'not_launched')) || status === 'pre_launch' || status === 'not_live' || status === 'not_launched');
    var dark = darkHint && !(s7.total > 0) && !stale && s7.present === 0 && p7.present === 0;
    if (dark) {
      growth = { code: 'nofeed', label: 'NO FEED', wow: null, missing: 14 };
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

    var feedCode = dark ? 'dark' : (s7.present === 0 && p7.present === 0 && !spendLatest ? 'nofeed' : (stale ? 'stale' : (s7.present < 7 ? 'incomplete' : (s7.total === 0 ? 'zero' : 'ok'))));
    var statusLabel = live === true ? 'LIVE' : (feedCode === 'stale' ? 'STALE' : (feedCode === 'dark' ? 'NOT LAUNCHED' : (feedCode === 'nofeed' ? '—' : (live === false ? (status === 'pre_launch' ? 'PRE-LAUNCH' : 'NOT LIVE') : '—'))));

    if (ch.noDataLabel && (growth.code === 'nofeed') && !dark) growth = Object.assign({}, growth, { label: ch.noDataLabel });
    if (ch.noDataLabel && statusLabel === '—') statusLabel = ch.noDataLabel;
    return {
      ch: ch,
      end: end,
      yday: ydayRec && ydayRec.spend != null ? ydayRec.spend : null,
      ydayCash: ydayRec && ydayRec.cash_cost != null ? ydayRec.cash_cost : null,
      spend7: s7.total, spend7Days: s7.present,
      prev7: p7.total, prev7Days: p7.present,
      spend30: s30.total, spend30Days: s30.present,
      d2c7: d2c7.present ? d2c7.total : null,
      cash7: cash7.present ? cash7.total : null,
      platformRev7: pDays ? round2(pRev) : null,
      platformConv7: pDays ? pConv : null,
      platformClicks7: pDays ? pClicks : null,
      platformDays7: pDays,
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

  function summarize(statsList, series, inputs, endDate) {
    var end = endDate || series.spendThrough;
    var tracked7 = 0, tracked7prev = 0, live = 0, growing = 0, shrinking = 0, scaling = 0, cutting = 0, launching = 0, incomplete = 0;
    var last7all = end ? windowDates(end, 7) : [];
    var prev7all = end ? windowDates(addDays(end, -7), 7) : [];
    function dayHasSpend(d) { return CHANNELS.some(function (ch) { var r = series.channels[ch.id].days[d]; return r && r.spend != null; }); }
    var missing7 = last7all.filter(function (d) { return !dayHasSpend(d); });
    var missingPrev7 = prev7all.filter(function (d) { return !dayHasSpend(d); });
    var unmeasured = [];
    statsList.forEach(function (s) {
      // Unknown spend (no measured row) is excluded from tracked / D2C totals — list it as coverage.
      var notLaunched = s.feed && s.feed.code === 'dark';
      if (!notLaunched && (s.spend7Days == null || s.spend7Days < 7)) unmeasured.push({ id: s.ch.id, label: s.ch.label, days: s.spend7Days || 0 });
      if (s.growth.code === 'incomplete' || s.growth.code === 'stale') incomplete += 1;
      tracked7 += n0(s.spend7); tracked7prev += n0(s.prev7);
      if (s.live) live += 1;
      if (s.growth.code === 'growing') growing += 1;
      if (s.growth.code === 'shrinking' || s.growth.code === 'stopped') shrinking += 1;
      if (s.growth.code === 'launching') launching += 1;
      if (s.posture.code === 'scaling') scaling += 1;
      if (s.posture.code === 'cutting' || s.posture.code === 'killed') cutting += 1;
    });
    var last7 = end ? windowDates(end, 7) : [];
    var d2c = 0, rev = 0, present = 0, blendedSource = null;
    last7.forEach(function (d) {
      var b = series.blended[d];
      if (!b || b.d2c_ad_spend == null || b.shopify_revenue == null) return;
      d2c += b.d2c_ad_spend; rev += b.shopify_revenue; present += 1; blendedSource = b.source;
    });
    var blended = null;
    if (present === 7 && d2c > 0) blended = { d2c: round2(d2c), rev: round2(rev), mer: Math.round(rev / d2c * 100) / 100, source: blendedSource, through: end, days: present };
    else if (inputs && inputs.mer && num(inputs.mer.spend_7d) != null && num(inputs.mer.rev_7d) != null && n0(inputs.mer.spend_7d) > 0) {
      blended = { d2c: round2(inputs.mer.spend_7d), rev: round2(inputs.mer.rev_7d), mer: num(inputs.mer.mer_7d_pooled) != null ? Math.round(inputs.mer.mer_7d_pooled * 100) / 100 : Math.round(inputs.mer.rev_7d / inputs.mer.spend_7d * 100) / 100, source: 'mer_for_manus.json 7d pooled', through: inputs.mer.as_of, days: 7 };
    }
    return {
      end: end,
      tracked7: round2(tracked7), tracked7prev: round2(tracked7prev),
      trackedWow: tracked7prev > 0 && !missing7.length && !missingPrev7.length ? (tracked7 - tracked7prev) / tracked7prev * 100 : null,
      missingDays7: missing7, missingDaysPrev7: missingPrev7, incomplete: incomplete,
      live: live, growing: growing, shrinking: shrinking, launching: launching, scaling: scaling, cutting: cutting,
      channels: statsList.length,
      unmeasured7: unmeasured,
      blended: blended
    };
  }

  function freshness(series, inputs) {
    var notes = [];
    var mer = inputs && inputs.mer;
    if (series.spendThrough) notes.push({ k: 'Portfolio spend through', v: shortDate(series.spendThrough), src: 'latest day any channel published spend (not a single all-clear)' });
    if (series.merAsOf) notes.push({ k: 'mer_for_manus.json', v: 'as of ' + series.merAsOf, src: 'rebuild_mer.py', warn: series.spendThrough && series.merAsOf < series.spendThrough ? (daysBetween(series.merAsOf, series.spendThrough) + ' days behind portfolio spend') : null });
    if (series.platformThrough) {
      var lag = series.spendThrough ? daysBetween(series.platformThrough, series.spendThrough) : 0;
      notes.push({ k: 'Platform revenue / ROAS through', v: shortDate(series.platformThrough), src: 'per-channel platform_revenue (Meta/Google spend-only stay —)', warn: lag > 1 ? lag + ' days behind portfolio spend — ROAS columns stop there' : null });
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

  function stackedChart(canvas, labels, seriesList) {
    if (typeof Chart === 'undefined' || !canvas) return null;
    var chart = new Chart(canvas.getContext('2d'), {
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

  function cardHtml(s, stacked, dates) {
    var ch = s.ch;
    var g = s.growth;
    var wowTxt = g.wow == null ? (g.code === 'launching' ? 'new' : '') : pct(g.wow, 0) + ' WoW';
    var platformNote;
    if (s.platformDays7 > 0) platformNote = s.platformDays7 + ' of 7 days reported' + (s.platformLatest && s.end && s.platformLatest < s.end ? ' · through ' + mmdd(s.platformLatest) : '');
    else if (s.spend7 > 0) platformNote = 'no platform read';
    else platformNote = '';
    var head = '<h3><span class="ac-dot" style="background:' + ch.color + '"></span>' + esc(ch.label)
      + (s.statusLabel === 'LIVE' ? pillHtml('LIVE', 'ac-good') : s.statusLabel === 'STALE' ? pillHtml('STALE', 'ac-warn') : s.statusLabel === 'NOT LAUNCHED' ? pillHtml('NOT LAUNCHED', 'ac-muted') : s.live === false ? pillHtml(s.status === 'pre_launch' ? 'PRE-LAUNCH' : 'NOT LIVE', 'ac-muted') : pillHtml(s.statusLabel || 'NO FEED', 'ac-muted'))
      + (s.mode ? pillHtml(String(s.mode).toUpperCase(), s.mode === 'auto' ? 'ac-ok' : 'ac-muted') : '')
      + trackingPill(s.tracking) + '</h3>';
    var nums = '<div class="ac-nums">'
      + '<div><div class="l">Yesterday</div><div class="v">' + esc(dv(ch, usd(s.yday))) + '</div><div class="s">' + (s.end ? shortDate(s.end) : '') + (ch.cashCost && s.ydayCash != null ? ' · cash ' + usd(s.ydayCash) : '') + '</div></div>'
      + '<div><div class="l">7-day spend</div><div class="v">' + esc(dv(ch, usd(s.spend7))) + '</div><div class="s ' + growthCls(g.code) + '">' + growthArrow(g) + ' ' + esc(g.label) + (wowTxt ? ' · ' + wowTxt : '') + '</div>' + (g.code === 'incomplete' || g.code === 'stale' ? '<div class="s ac-warn">' + (ch.noDataLabel ? esc(ch.noDataLabel) + ' for ' : 'missing days are not $0 — ') + esc((s.feed && s.feed.missing7 || []).map(mmdd).join(', ') || 'feed gap') + (ch.noDataLabel ? ' · excluded from tracked spend' : '') + '</div>' : '') + '</div>'
      + '<div><div class="l">Share 7d</div><div class="v">' + esc(dv(ch, s.share == null ? '—' : s.share.toFixed(0) + '%')) + '</div><div class="s">of tracked ad spend · 30d ' + esc(dv(ch, usd(s.spend30))) + '</div></div>'
      + '<div><div class="l">Platform ROAS 7d</div><div class="v">' + esc(dv(ch, roasTxt(s.roas7))) + '</div><div class="s">' + esc(platformNote) + '</div></div>'
      + '<div><div class="l">Platform revenue 7d</div><div class="v">' + esc(dv(ch, usd(s.platformRev7))) + '</div><div class="s">platform-reported, not store sales</div></div>'
      + '<div><div class="l">Conversions 7d</div><div class="v">' + esc(dv(ch, intTxt(s.platformConv7))) + '</div><div class="s">' + (s.platformClicks7 != null ? intTxt(s.platformClicks7) + ' clicks' : '') + '</div></div>'
      + '</div>';
    var spark = '<div class="ac-spark"><canvas id="ac-spark-' + ch.id + '"></canvas></div>'
      + '<div class="ac-legend"><span><span class="ac-dot" style="background:' + ch.color + '"></span>daily spend</span>' + (s.platformDays7 > 0 || s.platformAny ? '<span><span class="ac-dot" style="background:#e8e8f0"></span>platform-reported revenue</span>' : '') + '<span>' + esc(String(stacked)) + ' days</span></div>';
    var post = '<div class="ac-post"><span class="ac-lbl ' + s.posture.cls + '">' + esc(s.posture.label) + '</span>'
      + (s.posture.detail.length ? '<br><span class="ac-muted">' + esc(s.posture.detail.join(' · ')) + '</span>' : '')
      + (s.rank ? '<br><span class="ac-muted">Jarvis ' + mmdd(s.rankDate) + ': ' + esc(s.rank.tier || '—') + (num(s.rank.roas_7d) != null ? ' · ' + roasTxt(s.rank.roas_7d) + ' 7d' : '') + (num(s.rank.roas_28d) != null ? ' · ' + roasTxt(s.rank.roas_28d) + ' 28d' : '') + (num(s.rank.wow_spend_change_pct) != null ? ' · spend ' + pct(s.rank.wow_spend_change_pct, 0) + ' WoW' : '') + '</span>' : '')
      + (s.d2c7 != null && s.spend7 != null && Math.abs(s.d2c7 - s.spend7) > 0.5 ? '<br><span class="ac-muted">D2C share of spend 7d: ' + usd(s.d2c7) + (ch.note ? ' — ' + esc(ch.note) : '') + '</span>' : (ch.note && ch.cashCost ? '<br><span class="ac-muted">' + esc(ch.note) + (s.cash7 != null ? ' · cash cost 7d ' + usd(s.cash7) : '') + '</span>' : ''))
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
      var roas = r.hasPlatform && r.spend > 0 ? (r.roas != null ? r.roas : (r.revenue != null ? r.revenue / r.spend : null)) : null;
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
    var stats = CHANNELS.map(function (ch) { return channelStats(ch, series, inputs, end); });
    var tracked = stats.reduce(function (a, s) { return a + n0(s.spend7); }, 0);
    stats.forEach(function (s) {
      s.share = tracked > 0 && s.spend7 != null ? s.spend7 / tracked * 100 : null;
      s.platformAny = Object.keys(series.channels[s.ch.id].days).some(function (d) { return series.channels[s.ch.id].days[d].hasPlatform; });
    });
    stats.sort(function (a, b) { return n0(b.spend7) - n0(a.spend7) || a.ch.label.localeCompare(b.ch.label); });
    var sum = summarize(stats, series, inputs, end);
    var win = STATE.window;
    var dates = windowDates(end, win);
    var notes = freshness(series, inputs);

    var html = '';
    html += '<div class="ac-head"><div><h2>Ad channels · every platform, daily</h2><div class="ac-sub">Which channels are growing, which are shrinking, where Jarvis is scaling in or cutting — and what each platform says it drove. Platform revenue is the platform\'s own attribution, shown next to spend; it is never added to store revenue.</div></div>'
      + '<div class="ac-win">' + WINDOWS.map(function (w) { return '<button data-win="' + w + '" class="' + (w === win ? 'on' : '') + '">' + w + 'D</button>'; }).join('') + '</div></div>';
    html += '<div class="ac-asof">' + notes.map(function (n) { return '<span><b>' + esc(n.k) + ':</b> ' + esc(n.v) + ' <span class="ac-muted">(' + esc(n.src) + ')</span>' + (n.warn ? ' <span class="ac-warn-txt">⚠ ' + esc(n.warn) + '</span>' : '') + '</span>'; }).join('') + '</div>';

    html += '<div class="ac-kpis">'
      + '<div class="ac-kpi"><div class="l">Tracked ad spend 7d</div><div class="v">' + usd(sum.tracked7) + '</div><div class="s ' + (sum.trackedWow == null ? 'ac-muted' : sum.trackedWow > 0 ? 'ac-good' : sum.trackedWow < 0 ? 'ac-bad' : 'ac-muted') + '">' + (sum.missingDays7.length || sum.missingDaysPrev7.length ? '<span class="ac-warn">⚠ no channel spend for ' + esc(sum.missingDays7.concat(sum.missingDaysPrev7).map(mmdd).join(', ')) + ' — WoW withheld</span>' : sum.trackedWow == null ? 'no prior week' : pct(sum.trackedWow, 0) + ' vs prior 7d (' + usd(sum.tracked7prev) + ')') + '</div>'
      + (sum.unmeasured7 && sum.unmeasured7.length ? '<div class="s ac-muted">measured only · excludes unmeasured days: ' + esc(sum.unmeasured7.map(function (u) { return u.label + ' ' + u.days + '/7d'; }).join(', ')) + '</div>' : '') + '</div>'
      + '<div class="ac-kpi"><div class="l">Blended MER 7d (D2C)</div><div class="v">' + (sum.blended ? roasTxt(sum.blended.mer) : '—') + '</div><div class="s">' + (sum.blended ? usd(sum.blended.rev) + ' Shopify D2C ÷ ' + usd(sum.blended.d2c) + ' D2C ads · through ' + mmdd(sum.blended.through) : 'blended series not published for this window') + '</div></div>'
      + '<div class="ac-kpi"><div class="l">Channels live</div><div class="v">' + sum.live + ' <span class="ac-muted" style="font-size:.8rem">/ ' + sum.channels + '</span></div><div class="s">' + sum.launching + ' launching</div></div>'
      + '<div class="ac-kpi"><div class="l">Growing / shrinking</div><div class="v"><span class="ac-good">' + sum.growing + '</span> <span class="ac-muted">/</span> <span class="ac-bad">' + sum.shrinking + '</span></div><div class="s">spend 7d vs prior 7d, ±' + GROWTH_PCT + '%' + (sum.incomplete ? ' · <span class="ac-warn">' + sum.incomplete + ' incomplete</span>' : '') + '</div></div>'
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
    html += '<div class="ac-panel"><div class="section-title">DAILY AD SPEND BY CHANNEL · LAST ' + win + ' DAYS</div><div class="ac-chart"><canvas id="ac-stack"></canvas></div></div>';

    // portfolio table
    html += '<div class="ac-panel"><div class="section-title">PORTFOLIO · 7 DAYS ENDING ' + esc(shortDate(end).toUpperCase()) + '</div><div class="ac-table-wrap"><table class="ac-table"><thead><tr>'
      + '<th>Channel</th><th>Status</th><th>Posture</th><th>Yesterday</th><th>7d spend</th><th>WoW</th><th>Trend</th><th>Share</th><th>30d</th><th>Plat. rev 7d</th><th>Plat. ROAS 7d</th><th>Conv 7d</th><th>Tracking</th><th>Last Jarvis action</th>'
      + '</tr></thead><tbody>';
    stats.forEach(function (s) {
      html += '<tr data-ch="' + s.ch.id + '"><td><span class="ac-dot" style="background:' + s.ch.color + '"></span>' + esc(s.ch.label) + '</td>'
        + '<td class="' + (s.statusLabel === 'LIVE' ? 'ac-good' : s.statusLabel === 'STALE' ? 'ac-warn' : 'ac-muted') + '">' + esc(s.statusLabel || '—') + '</td>'
        + '<td class="' + s.posture.cls + '">' + esc(s.posture.label) + '</td>'
        + '<td>' + esc(dv(s.ch, usd(s.yday))) + '</td><td>' + esc(dv(s.ch, usd(s.spend7))) + '</td>'
        + '<td class="' + growthCls(s.growth.code) + '">' + (s.growth.wow == null ? '—' : pct(s.growth.wow, 0)) + '</td>'
        + '<td class="' + growthCls(s.growth.code) + '">' + growthArrow(s.growth) + ' ' + esc(s.growth.label) + '</td>'
        + '<td>' + esc(dv(s.ch, s.share == null || s.spend7 == null ? '—' : s.share.toFixed(0) + '%')) + '</td><td>' + esc(dv(s.ch, usd(s.spend30))) + (s.spend30Days != null && s.spend30Days < 30 && s.spend30 != null ? ' <span class="ac-muted">(' + s.spend30Days + 'd)</span>' : '') + '</td>'
        + '<td>' + esc(dv(s.ch, usd(s.platformRev7))) + '</td><td>' + esc(dv(s.ch, roasTxt(s.roas7))) + (s.platformDays7 > 0 && s.platformDays7 < 7 ? ' <span class="ac-muted">(' + s.platformDays7 + 'd)</span>' : '') + '</td><td>' + esc(dv(s.ch, intTxt(s.platformConv7))) + '</td>'
        + '<td class="' + (s.tracking === 'OK' ? 'ac-good' : s.tracking === 'WARN' ? 'ac-warn' : s.tracking === 'DOWN' ? 'ac-bad' : 'ac-muted') + '">' + esc(s.tracking || '—') + '</td>'
        + '<td class="ac-muted" style="font-family:var(--font-body);text-align:left">' + esc(s.change ? actionLabel(s.change) : '—') + '</td></tr>';
    });
    html += '</tbody></table></div><div class="ac-sub" style="margin-top:8px">Platform ROAS = that channel\'s platform-reported conversion value ÷ spend over the days it reported (' + esc(((inputs.settings || {}).global || {}).roas_source || 'platform_reported') + '). Meta and Google publish spend only on this feed, so their ROAS reads “—” here; Jarvis\'s weekly ranking ROAS is shown on the card. A missing day is “—”, never a false $0. Measured $0 (complete/closed/verified) stays $0. Shopify-attributed revenue appears when <code>shopify_attribution_daily.json</code> has coverage. CFO publishes <code>advertising_sources_daily.json</code> and <code>&lt;channel&gt;_ads_daily.json</code> next to this page — empty <code>*_ads_data.json</code> stubs are ignored.</div></div>';

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
    stackedChart(document.getElementById('ac-stack'), labels, stackList);
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
