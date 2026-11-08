/* =====================================================================
   COLDEST · 7-DAY ROLLING MER HEADER
   Prefer mer_for_manus.json (daily_inputs rebuild, as_of 2026-10-24).
   If that file has no newer mer_7d_pooled, keep the embedded closed-report
   snapshot and label it STALE. Never invent MER, deltas, or breakeven.
   ===================================================================== */
(function (root) {
  'use strict';

  function numOrNull(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function merIsFresh(mer, embedded) {
    if (!mer || typeof mer !== 'object') return false;
    if (numOrNull(mer.mer_7d_pooled) == null && !(mer.latest && numOrNull(mer.latest.mer_7d_pooled) != null)) {
      return false;
    }
    if (!mer.as_of) return false;
    var embeddedAsOf = embedded && embedded.as_of;
    if (!embeddedAsOf) return true;
    return String(mer.as_of) > String(embeddedAsOf);
  }

  function staleLabel(asOf) {
    return 'STALE — as of ' + (asOf || 'unknown') + ', not current';
  }

  function moneyPlain(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (Math.abs(n - Math.round(n)) < 1e-9) return '$' + Math.round(n).toLocaleString('en-US');
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function capHasPlanFields(node) {
    if (!node || typeof node !== 'object') return false;
    return node.planned_daily_cap_usd != null || node.daily_cap_usd != null
      || node.planned_daily_budget_usd != null
      || node.planned_test_total_cap_usd != null || node.test_duration_days != null
      || node.format_groups != null || node.formatGroups != null
      || node.format_groups_status != null || node.formats_status != null
      || node.cap_type === 'daily_total_starting_cap'
      || (typeof node.split === 'string' && /format/i.test(node.split));
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
  function flagOn(v) {
    if (v === true || v === 1) return true;
    if (v === false || v === 0 || v == null || v === '') return false;
    var s = String(v).toLowerCase();
    return s === 'true' || s === 'yes' || s === 'enabled' || s === '1';
  }
  function parseFormatGroups(raw) {
    var groups = [];
    function push(name, node) {
      var n = name ? String(name) : '';
      var enabled = false;
      var confirmed = false;
      var conditional = false;
      if (node && typeof node === 'object') {
        if (!n) n = String(node.id || node.name || node.label || node.format || '');
        enabled = flagOn(node.enabled);
        confirmed = flagOn(node.confirmed);
        conditional = flagOn(node.conditional);
      } else if (typeof node === 'boolean' || typeof node === 'number' || typeof node === 'string') {
        enabled = flagOn(node);
      }
      if (!n && !enabled && !confirmed) return;
      groups.push({ name: n, enabled: enabled, confirmed: confirmed, conditional: conditional });
    }
    if (Array.isArray(raw)) {
      raw.forEach(function (g) {
        if (g == null) return;
        if (typeof g === 'string') { push(g, null); return; }
        if (typeof g !== 'object') return;
        push(g.id || g.name || g.label || g.format, g);
      });
    } else if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach(function (k) { push(k, raw[k]); });
    }
    return groups;
  }
  function ymd(v) {
    if (v == null || v === '') return null;
    var s = String(v).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  function addDaysYmd(start, days) {
    var p = start.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function parseSpotifyPlannedCap(src) {
    var cfg = readSpotifyCapNode(src);
    if (!cfg) return null;
    var daily = numOrNull(cfg.planned_daily_cap_usd);
    if (daily == null) daily = numOrNull(cfg.daily_cap_usd);
    if (daily == null) daily = numOrNull(cfg.planned_daily_budget_usd);
    if (daily == null) return null;
    var total = numOrNull(cfg.planned_test_total_cap_usd);
    if (total == null) total = numOrNull(cfg.test_total_cap_usd);
    if (total == null) total = numOrNull(cfg.planned_overall_cap_usd);
    var duration = numOrNull(cfg.test_duration_days);
    if (duration == null) duration = numOrNull(cfg.duration_days);
    if (duration == null) duration = numOrNull(cfg.test_days);
    var start = ymd(cfg.start_date != null ? cfg.start_date : cfg.start);
    var end = ymd(cfg.end_date != null ? cfg.end_date : cfg.end);
    if (start && !end && duration != null && duration > 0) end = addDaysYmd(start, Math.round(duration) - 1);
    if (!start) end = null;
    var groups = parseFormatGroups(cfg.format_groups || cfg.formatGroups || cfg.formats);
    var status = cfg.format_groups_status != null ? String(cfg.format_groups_status)
      : (cfg.formatGroupsStatus != null ? String(cfg.formatGroupsStatus)
      : (cfg.formats_status != null ? String(cfg.formats_status) : ''));
    var split = cfg.split != null ? String(cfg.split) : (cfg.split_type != null ? String(cfg.split_type) : '');
    var capType = cfg.cap_type != null ? String(cfg.cap_type) : (cfg.capType != null ? String(cfg.capType) : '');
    var enabled = groups.filter(function (g) { return g.confirmed || g.enabled; });
    var perFormat = null;
    if (/^confirmed$/i.test(status) && enabled.length) perFormat = daily / enabled.length;
    return {
      daily: daily,
      total: total,
      duration: duration,
      start: start,
      end: end,
      capType: capType,
      split: split,
      formatGroupsStatus: status,
      formatGroups: groups,
      enabledCount: enabled.length,
      enabledNames: enabled.map(function (g) { return g.name; }).filter(Boolean),
      perFormat: perFormat,
      raw: cfg
    };
  }
  function spotifyPlannedCapLabel(src) {
    var cap = parseSpotifyPlannedCap(src);
    if (!cap || cap.daily == null) return '';
    var out = (cap.duration != null && cap.duration > 0)
      ? ('Planned ' + Math.round(cap.duration) + '-day test: ')
      : 'Planned test: ';
    out += moneyPlain(cap.daily) + '/day total cap';
    if (cap.total != null) out += ', ' + moneyPlain(cap.total) + ' overall';
    if (!cap.split || /even/i.test(cap.split)) out += ', split evenly across enabled formats';
    else out += ', ' + cap.split.replace(/_/g, ' ');
    var bits = [];
    if (/^confirmed$/i.test(cap.formatGroupsStatus) && cap.perFormat != null) {
      var pf = moneyPlain(cap.perFormat) + ' each';
      if (cap.enabledNames.length) pf += ': ' + cap.enabledNames.join(', ');
      bits.push(pf);
    } else {
      bits.push('formats pending');
    }
    if (cap.start) bits.push(cap.start + ' to ' + (cap.end || cap.start));
    else bits.push('start date not set');
    out += ' (' + bits.join('; ') + '). Plan only, not spend.';
    return out;
  }
  function spotifyExcludedFromMer(mer) {
    if (!mer || typeof mer !== 'object') return false;
    var cov = mer.d2c_coverage;
    if (cov && cov.spotify_included_in_d2c === false) return true;
    if (cov && Array.isArray(cov.excluded_channels)) {
      if (cov.excluded_channels.some(function (c) {
        var id = c && (c.channel || c.id || c);
        return String(id).toLowerCase().indexOf('spotify') !== -1;
      })) return true;
    }
    var cas = mer.channel_ad_spend;
    if (cas && typeof cas === 'object') {
      var day = cas[mer.as_of] || null;
      if (day && Object.prototype.hasOwnProperty.call(day, 'spotify') && day.spotify == null) return true;
    }
    return false;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function spotifyNoteHtml(data, mer) {
    var src = mer || data || null;
    var cap = spotifyPlannedCapLabel(src);
    var excluded = spotifyExcludedFromMer(src);
    if (!cap && !excluded) return '';
    var bits = [];
    if (excluded) bits.push('Spotify Ads: No data — excluded from measured MER');
    if (cap) bits.push(cap + ' · not spend');
    return '<div style="font-size:11px;opacity:0.7;margin-top:6px;line-height:1.45;">' + esc(bits.join(' · ')) + '</div>';
  }

  function fromMer(mer, embedded) {
    var pooled = numOrNull(mer.mer_7d_pooled);
    if (pooled == null && mer.latest) pooled = numOrNull(mer.latest.mer_7d_pooled);
    var latestSrc = mer.latest && typeof mer.latest === 'object' ? mer.latest : {};
    var reason = mer.budget_recommendation && mer.budget_recommendation.reason
      ? mer.budget_recommendation.reason
      : null;
    return {
      as_of: mer.as_of,
      data_ready: mer.data_ready !== false,
      missing_report_dates: Array.isArray(mer.missing_report_dates) ? mer.missing_report_dates : [],
      mer_target: mer.mer_target != null ? numOrNull(mer.mer_target) : (embedded && embedded.mer_target != null ? embedded.mer_target : null),
      mer_breakeven: mer.mer_breakeven != null ? numOrNull(mer.mer_breakeven) : null,
      latest: {
        date: mer.as_of,
        mer_7d_pooled: pooled,
        rev_7d: mer.rev_7d != null ? numOrNull(mer.rev_7d) : numOrNull(latestSrc.rev_7d),
        spend_7d: mer.spend_7d != null ? numOrNull(mer.spend_7d) : numOrNull(latestSrc.spend_7d),
        profit_7d: mer.profit_7d != null ? numOrNull(mer.profit_7d) : numOrNull(latestSrc.profit_7d),
        net_margin_7d_pct: mer.net_margin_7d_pct != null ? numOrNull(mer.net_margin_7d_pct) : numOrNull(latestSrc.net_margin_7d_pct),
        delta_dod: mer.delta_dod != null ? numOrNull(mer.delta_dod) : numOrNull(latestSrc.delta_dod),
        delta_wow: mer.delta_wow != null ? numOrNull(mer.delta_wow) : numOrNull(latestSrc.delta_wow),
        mer_30d_pooled: mer.mer_30d_pooled != null ? numOrNull(mer.mer_30d_pooled) : numOrNull(latestSrc.mer_30d_pooled),
        days_in_window: mer.days_in_window != null ? mer.days_in_window : (latestSrc.days_in_window != null ? latestSrc.days_in_window : 7)
      },
      verdict: {
        status: mer.status || (embedded && embedded.verdict && embedded.verdict.status) || 'CURRENT_DAILY_INPUTS',
        icon: '',
        msg: reason || ('mer_for_manus.json · source ' + (mer.source || 'daily_inputs') + ' · as_of ' + mer.as_of)
      },
      rolling_7d_series: Array.isArray(mer.rolling_7d_series) ? mer.rolling_7d_series : [],
      daily_series: Array.isArray(mer.daily_series) ? mer.daily_series : [],
      d2c_coverage: mer.d2c_coverage || null,
      spotify_ads_config: mer.spotify_ads_config || null
    };
  }

  function embeddedTooOld(asOf, now) {
    var d = now ? new Date(now) : new Date();
    var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
    var t = new Date(today + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 2);
    return String(asOf) < t.toISOString().slice(0, 10);
  }

  function resolve(embedded, mer) {
    var fallback = embedded || { as_of: null, latest: {}, verdict: {}, missing_report_dates: [] };
    var out;
    if (merIsFresh(mer, fallback)) {
      out = { stale: false, staleAsOf: null, data: fromMer(mer, fallback), mer: mer || null };
    } else if (fallback.data_ready === true && fallback.as_of && !embeddedTooOld(fallback.as_of, arguments[2])) {
      // Oct 31, 2026: the embedded snapshot is now rebuilt daily from every report (finalized + daily), company-wide.
      // When it says data_ready and is at most 2 days old (ET), it is current — not STALE.
      out = { stale: false, staleAsOf: null, data: fallback, mer: mer || null };
    } else {
      out = {
        stale: true,
        staleAsOf: fallback.as_of || null,
        staleLabel: staleLabel(fallback.as_of || 'unknown'),
        data: fallback,
        mer: mer || null
      };
    }
    return out;
  }

  var api = {
    merIsFresh: merIsFresh,
    staleLabel: staleLabel,
    resolve: resolve,
    parseSpotifyPlannedCap: parseSpotifyPlannedCap,
    spotifyPlannedCapLabel: spotifyPlannedCapLabel,
    spotifyExcludedFromMer: spotifyExcludedFromMer,
    spotifyNoteHtml: spotifyNoteHtml
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RollingMerHeader = api;
})(typeof window !== 'undefined' ? window : globalThis);
