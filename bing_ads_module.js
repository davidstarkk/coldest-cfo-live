/* =====================================================================
   COLDEST · BING / MICROSOFT ADVERTISING MODULE  (self-contained)
   ---------------------------------------------------------------------
   Mirrors the Google Ads path on this live dashboard:

     Google daily numbers arrive in PARTIAL_REPORTS[].advertising_sources
     .google_ads (embedded by the public-mirror sync from
     davidstarkk/coldest-cfo-dashboard). They are already rolled into
     provisional_totals.ads / mer / net_profit by that pipeline.
     This page does not fetch the private data repo at runtime.

   Bing follows the same contract:
     - Prefer advertising_sources.bing | bing_ads | microsoft_ads
     - Else consume a `bing` block from mer_for_manus.json
     - Else bing_ads_data.json (manual file drop)
     - Else localStorage manual daily input
     - Missing / pre-launch → $0, totals unchanged

   Google and Meta fields are never rewritten. Bing spend is company-level
   paid spend (same as Google), not Shopify/Meta.
   ===================================================================== */
(function (root) {
  'use strict';

  var BA_TAB_KEY = 'bing_ads';
  var BA_TAB_LABEL = 'BING ADS';
  var BA_MANUAL_KEY = 'coldest_bing_manual';
  var SOURCE_KEYS = ['bing', 'bing_ads', 'microsoft_ads', 'microsoft_advertising'];

  var BA_FEED = null;       // bing_ads_data.json
  var BA_MER = null;        // mer_for_manus.json (optional bing block)
  var BA_MANUAL = null;     // localStorage

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
  function intFmt(v) { return Math.round(num(v)).toLocaleString(); }
  function roasTxt(spend, revenue, explicit) {
    if (explicit != null && Number.isFinite(Number(explicit))) return Number(explicit).toFixed(2) + 'x';
    if (num(spend) > 0 && num(revenue) > 0) return (num(revenue) / num(spend)).toFixed(2) + 'x';
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
      status: 'pre_launch',
      source: 'none',
      complete: true
    };
  }

  function pickSourceNode(sources) {
    if (!sources || typeof sources !== 'object') return null;
    for (var i = 0; i < SOURCE_KEYS.length; i++) {
      if (sources[SOURCE_KEYS[i]] != null) return { key: SOURCE_KEYS[i], node: sources[SOURCE_KEYS[i]] };
    }
    return null;
  }

  function nodeToDay(date, node, source) {
    if (node == null || node === false) return emptyDay(date);
    if (typeof node !== 'object') {
      var d0 = emptyDay(date);
      d0.spend = round2(node);
      d0.status = d0.spend > 0 ? 'ok' : 'pre_launch';
      d0.source = source;
      d0.complete = true;
      return d0;
    }
    var d = emptyDay(date);
    d.spend = round2(node.spend != null ? node.spend : (node.daily_spend != null ? node.daily_spend : node.ad_spend));
    d.clicks = num(node.clicks);
    d.conversions = num(node.conversions != null ? node.conversions : (node.conv != null ? node.conv : node.purchases));
    d.revenue = num(node.revenue != null ? node.revenue : node.conv_value);
    d.impressions = num(node.impressions);
    d.roas = node.roas != null ? num(node.roas) : (d.spend > 0 && d.revenue > 0 ? d.revenue / d.spend : null);
    d.status = node.status || (d.spend > 0 ? 'ok' : 'pre_launch');
    d.source = source;
    d.complete = node.complete !== false;
    d.updated_at = node.updated_at || node.observed_at || node.as_of || null;
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
    var hasScalar = block.spend != null || block.clicks != null || block.conversions != null || block.revenue != null;
    if (!hasScalar) return null;
    var day = nodeToDay(block.as_of || block.date || null, block, source);
    return day;
  }

  function loadManual() {
    try {
      if (typeof localStorage === 'undefined') return null;
      var raw = localStorage.getItem(BA_MANUAL_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function saveManual(payload) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(BA_MANUAL_KEY, JSON.stringify(payload));
    BA_MANUAL = payload;
  }

  function mergeDays() {
    var days = {};
    var merBlock = BA_MER && BA_MER.bing;
    Object.assign(days, dailyMapFromBlock(BA_FEED, 'bing_ads_data.json'));
    Object.assign(days, dailyMapFromBlock(merBlock, 'mer_for_manus.json#bing'));
    var snap = snapshotFromBlock(merBlock, 'mer_for_manus.json#bing');
    if (snap && snap.date) days[snap.date] = snap;
    Object.assign(days, dailyMapFromBlock(BA_MANUAL, 'manual'));

    var partials = hostArray('PARTIAL_REPORTS');
    if (partials) {
      partials.forEach(function (r) {
        var picked = pickSourceNode(r.advertising_sources);
        if (!picked) return;
        // Ignore $0 placeholders we injected so pre-launch history stays empty.
        if (r._ba_pipeline_bing === false && num(picked.node && picked.node.spend) === 0) return;
        var fromPartial = nodeToDay(r.date, picked.node, 'advertising_sources.' + picked.key);
        var existing = days[r.date];
        // Pipeline advertising_sources is the Google-equivalent source of truth
        // when present; keep richer KPI fields from a feed if the pipeline
        // only sent spend.
        if (!existing) {
          days[r.date] = fromPartial;
        } else {
          existing.spend = fromPartial.spend;
          existing.source = fromPartial.source;
          existing.complete = fromPartial.complete;
          existing.status = fromPartial.status;
          if (!existing.updated_at) existing.updated_at = fromPartial.updated_at;
        }
      });
    }
    return days;
  }

  function latestDay(days) {
    var dates = Object.keys(days).sort();
    if (dates.length) return days[dates[dates.length - 1]];
    var snap = snapshotFromBlock(BA_MER && BA_MER.bing, 'mer_for_manus.json#bing');
    if (snap) return snap;
    if (BA_FEED) return nodeToDay(BA_FEED.as_of, BA_FEED, 'bing_ads_data.json');
    return emptyDay(null);
  }

  function ensureBingOnPartials(days) {
    var partials = hostArray('PARTIAL_REPORTS');
    if (!partials) return;
    partials.forEach(function (r) {
      r.advertising_sources = r.advertising_sources || {};
      var picked = pickSourceNode(r.advertising_sources);
      var day = (days && days[r.date]) || emptyDay(r.date);
      if (r._ba_seen_sources == null) {
        r._ba_pipeline_bing = !!picked;
        r._ba_seen_sources = true;
      }
      if (picked) {
        if (picked.key !== 'bing') {
          r.advertising_sources.bing = r.advertising_sources.bing || picked.node;
        }
        return;
      }
      r._ba_pipeline_bing = false;
      r.advertising_sources.bing = {
        spend: day.spend,
        clicks: day.clicks,
        conversions: day.conversions,
        revenue: day.revenue,
        roas: day.roas,
        complete: true,
        closed_day: true,
        status: day.status,
        updated_at: day.updated_at || day.source || 'pre_launch',
        source: day.source
      };
    });
  }

  function applyPartialTotals(days) {
    var partials = hostArray('PARTIAL_REPORTS');
    if (!partials) return;
    partials.forEach(function (r) {
      var spend = days[r.date] ? round2(days[r.date].spend) : 0;
      r.bing_ad_spend = spend;
      // Pipeline-published Bing is already inside provisional_totals, same as Google.
      if (r._ba_pipeline_bing) {
        r._ba_bing_applied = 0;
        return;
      }
      var prev = r._ba_bing_applied || 0;
      var delta = round2(spend - prev);
      if (Math.abs(delta) < 0.005) return;
      var p = r.provisional_totals;
      if (p) {
        if (p.ads != null) p.ads = round2(num(p.ads) + delta);
        if (p.net_profit != null) p.net_profit = round2(num(p.net_profit) - delta);
        if (p.revenue > 0 && p.ads > 0) p.mer = p.revenue / p.ads;
        if (p.revenue > 0 && p.net_profit != null) p.net_margin_pct = (p.net_profit / p.revenue) * 100;
      }
      r._ba_bing_applied = spend;
    });
  }

  function applyReportTotals(days) {
    var reports = hostArray('REPORTS');
    if (!reports) return;
    reports.forEach(function (r) {
      var spend = days[r.date] ? round2(days[r.date].spend) : 0;
      var prev = r._ba_bing_applied || 0;
      var delta = round2(spend - prev);
      r.bing_ad_spend = spend;
      if (Math.abs(delta) < 0.005) return;
      // Company-level paid spend — same bucket Google uses. Do not touch
      // shop_ad_spend (Meta) or any Google field.
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
      r._ba_bing_applied = spend;
    });
  }

  function applyAll(days) {
    ensureBingOnPartials(days);
    applyPartialTotals(days);
    applyReportTotals(days);
  }

  function injectCss() {
    if (document.getElementById('ba-module-css')) return;
    var css = ''
      + '.ba-kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}'
      + '.ba-kpi-card{background:var(--card,#171730);border:1px solid var(--border,#252548);border-radius:8px;padding:16px 16px 14px}'
      + '.ba-kpi-label{font-size:.65rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim,#5c5c7a);margin-bottom:8px}'
      + '.ba-kpi-val{font-family:var(--font-mono,ui-monospace,monospace);font-size:1.35rem;font-weight:700;color:var(--text,#e8e8f0);line-height:1}'
      + '.ba-kpi-sub{margin-top:6px;font-size:.72rem;color:var(--text-muted,#8888a8)}'
      + '.ba-box{background:var(--surface,#131328);border:1px solid var(--border,#252548);border-radius:8px;padding:16px 18px;margin-bottom:16px}'
      + '.ba-title{font-size:.72rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--cyan,#00d4d4);margin:0 0 10px}'
      + '.ba-sub{color:var(--text-muted,#8888a8);font-size:.82rem;margin-bottom:12px}'
      + '.ba-strip{margin:0 0 16px;padding:14px 16px;background:linear-gradient(135deg,rgba(0,132,255,.08),rgba(0,212,212,.04));border:1px solid rgba(0,132,255,.28);border-radius:8px}'
      + '.ba-form{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;align-items:end}'
      + '.ba-form label{display:block;font-size:.65rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#5c5c7a);margin-bottom:4px}'
      + '.ba-form input{width:100%;background:var(--card,#171730);color:var(--text,#e8e8f0);border:1px solid var(--border,#252548);border-radius:6px;padding:8px 10px;font-family:var(--font-mono,ui-monospace,monospace);font-size:.85rem}'
      + '.ba-btn{background:var(--cyan,#00d4d4);color:#0d0d1a;border:none;border-radius:6px;padding:8px 14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:.72rem;cursor:pointer}'
      + '.ba-table{width:100%;font-size:.82rem;border-collapse:collapse}'
      + '.ba-table th{color:var(--text-dim,#5c5c7a);font-size:.65rem;letter-spacing:.08em;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid var(--border,#252548);text-align:right}'
      + '.ba-table th:first-child,.ba-table td:first-child{text-align:left}'
      + '.ba-table td{padding:6px 8px;border-bottom:1px solid var(--border,#252548);font-family:var(--font-mono,ui-monospace,monospace)}'
      + '@media (max-width:768px){.ba-kpi-row,.ba-form{grid-template-columns:repeat(2,1fr)}}';
    var st = document.createElement('style');
    st.id = 'ba-module-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function ensureScaffold() {
    var panel = document.getElementById('tab-' + BA_TAB_KEY);
    if (!panel) {
      var reports = document.getElementById('tab-reports');
      panel = document.createElement('div');
      panel.id = 'tab-' + BA_TAB_KEY;
      panel.className = 'tab-content';
      if (reports && reports.parentNode) reports.parentNode.insertBefore(panel, reports.nextSibling);
      else document.body.appendChild(panel);
    }
    var existingBtn = document.querySelector('.tab[data-tab="' + BA_TAB_KEY + '"]');
    if (!existingBtn) {
      var after = document.querySelector('.tab[data-tab="chatgpt_ads"]') || document.querySelector('.tab[data-tab="reports"]');
      if (after && after.parentNode) {
        var btn = document.createElement('div');
        btn.className = 'tab';
        btn.setAttribute('data-tab', BA_TAB_KEY);
        btn.textContent = BA_TAB_LABEL;
        after.parentNode.insertBefore(btn, after.nextSibling);
        btn.addEventListener('click', function () {
          document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
          document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
          document.body.classList.remove('reports-active');
          btn.classList.add('active');
          var p = document.getElementById('tab-' + BA_TAB_KEY);
          if (p) p.classList.add('active');
          renderTab();
        });
      }
    }
  }

  function kpiRow(day, note) {
    return ''
      + '<div class="ba-kpi-row">'
      + '<div class="ba-kpi-card"><div class="ba-kpi-label">Daily spend</div><div class="ba-kpi-val">' + usd(day.spend) + '</div><div class="ba-kpi-sub">' + esc(note) + '</div></div>'
      + '<div class="ba-kpi-card"><div class="ba-kpi-label">Clicks</div><div class="ba-kpi-val">' + intFmt(day.clicks) + '</div><div class="ba-kpi-sub">Pre-launch is 0</div></div>'
      + '<div class="ba-kpi-card"><div class="ba-kpi-label">Conversions</div><div class="ba-kpi-val">' + intFmt(day.conversions) + '</div><div class="ba-kpi-sub">Purchases / conversions</div></div>'
      + '<div class="ba-kpi-card"><div class="ba-kpi-label">Revenue</div><div class="ba-kpi-val">' + usd(day.revenue) + '</div><div class="ba-kpi-sub">Attributed conversion value</div></div>'
      + '<div class="ba-kpi-card"><div class="ba-kpi-label">ROAS</div><div class="ba-kpi-val">' + esc(roasTxt(day.spend, day.revenue, day.roas)) + '</div><div class="ba-kpi-sub">Revenue ÷ spend</div></div>'
      + '</div>';
  }

  function renderStrip(days) {
    var slot = document.getElementById('bing-ads-daily');
    if (!slot) {
      var yday = document.getElementById('yday-bar');
      if (!yday || !yday.parentNode) return;
      slot = document.createElement('div');
      slot.id = 'bing-ads-daily';
      yday.parentNode.insertBefore(slot, yday.nextSibling);
    }
    var day = latestDay(days);
    var dateLabel = day.date ? day.date : 'no dated feed yet';
    var status = day.spend > 0 ? 'Live' : 'Pre-launch · $0';
    slot.className = 'ba-strip';
    slot.innerHTML = ''
      + '<div class="ba-title">Bing / Microsoft Advertising</div>'
      + '<div class="ba-sub">Own paid-spend line (same path as Google Ads) · ' + esc(dateLabel) + ' · ' + esc(status) + ' · source: ' + esc(day.source) + '</div>'
      + kpiRow(day, day.spend > 0 ? 'Included in paid spend, blended MER, profit' : 'Totals unchanged while spend is $0');
  }

  function renderTab() {
    var c = document.getElementById('tab-' + BA_TAB_KEY);
    if (!c) return;
    var days = mergeDays();
    var day = latestDay(days);
    var rows = Object.keys(days).sort().reverse().map(function (date) { return days[date]; });
    var statusLine = day.spend > 0
      ? 'Campaigns reporting. Spend is included in company paid ads / blended MER / profit.'
      : 'Campaigns are not live. Showing $0 so launch (~$1,000/day) can land without changing today\'s totals.';
    var merNote = (BA_MER && BA_MER.bing)
      ? 'mer_for_manus.json has a bing block'
      : 'mer_for_manus.json has no bing block yet (graceful $0)';

    c.innerHTML = ''
      + '<div class="ba-title" style="margin-top:0">Bing Ads · Microsoft Advertising</div>'
      + '<div class="ba-sub">' + esc(statusLine) + ' · ' + esc(merNote) + '</div>'
      + kpiRow(day, day.date ? ('As of ' + day.date) : 'Awaiting first dated row')
      + '<div class="ba-title">Daily history</div>'
      + '<div class="ba-box">'
      + (rows.length
        ? ('<table class="ba-table"><thead><tr><th>Date</th><th>Spend</th><th>Clicks</th><th>Conversions</th><th>Revenue</th><th>ROAS</th><th>Source</th></tr></thead><tbody>'
          + rows.map(function (r) {
            return '<tr><td>' + esc(r.date || '—') + '</td><td>' + usd(r.spend) + '</td><td>' + intFmt(r.clicks) + '</td><td>' + intFmt(r.conversions) + '</td><td>' + usd(r.revenue) + '</td><td>' + esc(roasTxt(r.spend, r.revenue, r.roas)) + '</td><td>' + esc(r.source) + '</td></tr>';
          }).join('')
          + '</tbody></table>')
        : '<div class="ba-sub" style="margin:0">No dated Bing rows. Pre-launch empty state — this is expected until the data repo publishes a bing block or you enter a manual day below.</div>')
      + '</div>'
      + '<div class="ba-title">Manual daily number</div>'
      + '<div class="ba-box">'
      + '<div class="ba-sub">Browser-only override (localStorage). For a durable number that deploys with GitHub Pages, edit <code>bing_ads_data.json</code> or have the data repo publish <code>mer_for_manus.json</code> → <code>bing</code>.</div>'
      + '<form class="ba-form" id="ba-manual-form">'
      + '<div><label>Date</label><input name="date" type="date" required></div>'
      + '<div><label>Spend</label><input name="spend" type="number" min="0" step="0.01" value="0"></div>'
      + '<div><label>Clicks</label><input name="clicks" type="number" min="0" step="1" value="0"></div>'
      + '<div><label>Conversions</label><input name="conversions" type="number" min="0" step="1" value="0"></div>'
      + '<div><label>Revenue</label><input name="revenue" type="number" min="0" step="0.01" value="0"></div>'
      + '<div><button class="ba-btn" type="submit">Save day</button></div>'
      + '</form></div>';

    var form = c.querySelector('#ba-manual-form');
    if (form) {
      var today = new Date();
      var iso = today.toISOString().slice(0, 10);
      form.date.value = (day.date && /^\d{4}-\d{2}-\d{2}$/.test(day.date)) ? day.date : iso;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var payload = BA_MANUAL && typeof BA_MANUAL === 'object' ? BA_MANUAL : { by_date: {}, source: 'manual' };
        payload.by_date = payload.by_date || {};
        payload.by_date[form.date.value] = {
          spend: num(form.spend.value),
          clicks: num(form.clicks.value),
          conversions: num(form.conversions.value),
          revenue: num(form.revenue.value),
          status: num(form.spend.value) > 0 ? 'ok' : 'pre_launch'
        };
        payload.as_of = form.date.value;
        saveManual(payload);
        bootFromState();
      });
    }
  }

  function rerenderDashboard() {
    ['renderYesterday', 'renderYesterdayPie', 'render30DayAverages', 'renderReports'].forEach(function (fn) {
      try { if (typeof root[fn] === 'function') root[fn](); } catch (e) { /* non-fatal */ }
    });
  }

  function bootFromState() {
    var days = mergeDays();
    applyAll(days);
    renderStrip(days);
    var tab = document.getElementById('tab-' + BA_TAB_KEY);
    if (tab && tab.classList.contains('active')) renderTab();
    rerenderDashboard();
    renderStrip(days);
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status)); });
  }

  function saBoot() {
    injectCss();
    ensureScaffold();
    BA_MANUAL = loadManual();
    var jobs = [
      fetchJson('bing_ads_data.json').then(function (d) { BA_FEED = d; }).catch(function () { BA_FEED = null; }),
      fetchJson('mer_for_manus.json').then(function (d) { BA_MER = d; }).catch(function () { BA_MER = null; })
    ];
    Promise.allSettled(jobs).then(function () {
      bootFromState();
      var tab = document.getElementById('tab-' + BA_TAB_KEY);
      if (tab) renderTab();
    });
  }

  var api = {
    SOURCE_KEYS: SOURCE_KEYS,
    num: num,
    emptyDay: emptyDay,
    nodeToDay: nodeToDay,
    dailyMapFromBlock: dailyMapFromBlock,
    snapshotFromBlock: snapshotFromBlock,
    pickSourceNode: pickSourceNode,
    mergeDays: mergeDays,
    latestDay: latestDay,
    applyReportTotals: applyReportTotals,
    applyPartialTotals: applyPartialTotals,
    ensureBingOnPartials: ensureBingOnPartials,
    applyAll: applyAll,
    _setFeeds: function (feed, mer, manual) {
      BA_FEED = feed || null;
      BA_MER = mer || null;
      BA_MANUAL = manual || null;
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.BingAds = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(saBoot, 0); });
    } else {
      setTimeout(saBoot, 0);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
