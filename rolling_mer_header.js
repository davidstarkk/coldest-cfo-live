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
  function perAdCapNum(node) {
    if (node == null) return null;
    if (typeof node !== 'object') return numOrNull(node);
    if (node.planned_cap_usd != null) return numOrNull(node.planned_cap_usd);
    if (node.cap_usd != null) return numOrNull(node.cap_usd);
    if (node.cap != null) return numOrNull(node.cap);
    if (node.planned_cap != null) return numOrNull(node.planned_cap);
    return null;
  }
  function parseSpotifyPlannedCap(src) {
    var cfg = readSpotifyCapNode(src);
    if (!cfg) return null;
    var total = numOrNull(cfg.planned_total_cap_usd);
    if (total == null) total = numOrNull(cfg.planned_cap);
    if (total == null) total = numOrNull(cfg.planned_cap_usd);
    if (total == null) total = numOrNull(cfg.total_cap_usd);
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
        pushAd(name, perAdCapNum(a));
      });
    } else if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach(function (k) {
        pushAd(k, perAdCapNum(raw[k]));
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
