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
      daily_series: Array.isArray(mer.daily_series) ? mer.daily_series : []
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
    if (merIsFresh(mer, fallback)) {
      return { stale: false, staleAsOf: null, data: fromMer(mer, fallback) };
    }
    // Oct 31, 2026: the embedded snapshot is now rebuilt daily from every report (finalized + daily), company-wide.
    // When it says data_ready and is at most 2 days old (ET), it is current — not STALE.
    if (fallback.data_ready === true && fallback.as_of && !embeddedTooOld(fallback.as_of, arguments[2])) {
      return { stale: false, staleAsOf: null, data: fallback };
    }
    return {
      stale: true,
      staleAsOf: fallback.as_of || null,
      staleLabel: staleLabel(fallback.as_of || 'unknown'),
      data: fallback
    };
  }

  var api = {
    merIsFresh: merIsFresh,
    staleLabel: staleLabel,
    resolve: resolve
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RollingMerHeader = api;
})(typeof window !== 'undefined' ? window : globalThis);
