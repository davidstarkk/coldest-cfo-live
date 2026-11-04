/* =====================================================================
   COLDEST · SPEND MIX (MMM)  — where and how much to spend
   ---------------------------------------------------------------------
   Reporting-only. Reads two feeds the data repo's weekly refit publishes
   (davidstarkk/coldest-cfo-dashboard, .github/workflows/mmm-refit.yml →
   lib/publish_live_feeds.sh):

     ads_throttle/mmm_recommendation.json   advisory per-channel verdict
         status: insufficient_data | recommendation
         data_sufficiency, channel_coverage, channels[ch]
         { verdict, marginal_roas (+low/high), avg_roas_at_current,
           current_daily_spend, recommended_daily_spend_fixed_total,
           spend_at_breakeven_mroas, contribution_share_pct, confidence },
         fixed_total_reallocation, target_mer_total, learnings, studios
     mmm/results.json                       the same + model curves

   Never invents a number: below 180 usable days the tab shows how far the
   panel is from a fit and what is missing, not a curve. The live Jarvis
   rule (platform-reported 7d ROAS) is unchanged; this tab adds the
   marginal view next to it.
   ===================================================================== */
(function (root) {
  'use strict';

  var FEEDS = { rec: 'ads_throttle/mmm_recommendation.json', results: 'mmm/results.json' };
  var LABELS = {
    meta: 'Meta', google: 'Google Ads', tiktok_web: 'TikTok (website)', tiktok_shop: 'TikTok Shop',
    applovin: 'AppLovin', bing: 'Bing / Microsoft', pinterest: 'Pinterest', snapchat: 'Snapchat',
    reddit: 'Reddit', chatgpt: 'ChatGPT Ads', taboola: 'Taboola', outbrain: 'Outbrain', x: 'X Ads',
    amazon: 'Amazon', whatnot: 'Whatnot'
  };
  var COLORS = {
    meta: '#3987e5', google: '#d95926', tiktok_web: '#199e70', applovin: '#008300', bing: '#c98500',
    snapchat: '#d55181', pinterest: '#9085e9', chatgpt: '#e66767', reddit: '#8888a8', taboola: '#8888a8',
    outbrain: '#8888a8', x: '#8888a8'
  };

  /* ------------------------------------------------------------ utils */
  function num(v) { if (v == null || v === '') return null; var n = Number(v); return Number.isFinite(n) ? n : null; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function usd(v, d) {
    var n = num(v); if (n == null) return '—';
    var digits = d == null ? 0 : d;
    var s = '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return n < 0 ? '−' + s : s;
  }
  function x(v) { var n = num(v); return n == null ? '—' : n.toFixed(2) + 'x'; }
  function pct(v, d) { var n = num(v); return n == null ? '—' : (n > 0 && d !== 'nosign' ? '+' : '') + n.toFixed(1) + '%'; }
  function label(ch) { return LABELS[ch] || ch; }

  /* ------------------------------------------------------------ pure */
  function readiness(rec) {
    var s = (rec && rec.data_sufficiency) || {};
    var need = num(s.min_days_required) || 180;
    var have = num(s.consecutive_usable_days) || 0;
    var span = s.usable_span || null;
    var pctDone = Math.max(0, Math.min(100, Math.round(have / need * 100)));
    var weeksLeft = Math.max(0, Math.ceil((need - have) / 7));
    return {
      sufficient: !!s.sufficient_for_mmm,
      have: have, need: need, pct: pctDone, weeksLeft: weeksLeft,
      span: span, gaps: s.kpi_gap_days_in_run || [],
      reasons: s.reasons || [],
      historyOnlyDays: num(s.company_history_only_days)
    };
  }

  function coverageRows(rec) {
    var cov = (rec && rec.channel_coverage) || {};
    return Object.keys(cov).map(function (ch) {
      var c = cov[ch] || {};
      var state = c.curve_eligible ? 'measured' : (c.days_with_spend === 0 ? 'no spend' : c.prior_dominated_expected ? 'too small / too new' : 'waiting for history');
      return {
        channel: ch, label: label(ch), d2c: !!c.d2c,
        days: num(c.days_with_spend) || 0, reported: num(c.days_reported) || 0,
        share: num(c.d2c_share_pct), cv: num(c.spend_cv), state: state
      };
    }).sort(function (a, b) { return (b.share || 0) - (a.share || 0) || b.days - a.days; });
  }

  function verdictClass(v) {
    return v === 'scale' ? 'mm-good' : v === 'cut' ? 'mm-bad' : v === 'hold' ? 'mm-warn' : 'mm-muted';
  }

  function channelRows(rec) {
    var chs = (rec && rec.channels) || {};
    return Object.keys(chs).map(function (ch) {
      var c = chs[ch] || {};
      var cur = num(c.current_daily_spend), rcm = num(c.recommended_daily_spend_fixed_total);
      return {
        channel: ch, label: label(ch), verdict: c.verdict || 'insufficient', why: c.why || '',
        mroas: num(c.marginal_roas), lo: num(c.marginal_roas_low), hi: num(c.marginal_roas_high),
        avgRoas: num(c.avg_roas_at_current), share: num(c.contribution_share_pct),
        current: cur, recommended: rcm,
        changePct: cur && rcm != null ? (rcm / cur - 1) * 100 : null,
        breakeven: num(c.spend_at_breakeven_mroas), confidence: c.confidence || 'low',
        prior: num(c.prior_roas), priorDominated: !!c.prior_dominated
      };
    }).sort(function (a, b) { return (b.current || 0) - (a.current || 0); });
  }

  function curveDatasets(results) {
    var model = results && results.model;
    if (!model || !model.channels) return [];
    return Object.keys(model.channels).filter(function (ch) { return !model.channels[ch].prior_dominated; }).map(function (ch) {
      var c = model.channels[ch];
      return {
        label: label(ch), borderColor: COLORS[ch] || '#8888a8', backgroundColor: 'transparent', tension: 0.3, pointRadius: 0,
        data: (c.curve || []).map(function (p) { return { x: num(p.spend), y: num(p.revenue) }; }),
        current: { x: num(c.current_daily_spend), y: null }
      };
    });
  }

  /* ------------------------------------------------------------ css */
  var CSS = [
    '#tab-spend_mix{max-width:1400px;margin:0 auto}',
    '.mm-head{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;margin-bottom:14px}',
    '.mm-pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.66rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--border)}',
    '.mm-good{color:var(--green);border-color:var(--green)}.mm-bad{color:var(--red);border-color:var(--red)}.mm-warn{color:var(--yellow);border-color:var(--yellow)}.mm-muted{color:var(--text-muted)}',
    '.mm-note{font-size:.76rem;color:var(--text-muted);line-height:1.5;max-width:900px}',
    '.mm-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:16px}',
    '.mm-card h3{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);margin:0 0 10px}',
    '.mm-bar{height:10px;background:var(--surface);border:1px solid var(--border);border-radius:999px;overflow:hidden;margin:8px 0}',
    '.mm-bar i{display:block;height:100%;background:var(--cyan)}',
    '.mm-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:8px 0 12px}',
    '.mm-kpi{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px}',
    '.mm-kpi .mm-v{font-size:1.25rem;font-weight:700}.mm-kpi .mm-l{font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);margin-top:2px}',
    '.mm-table{width:100%;border-collapse:collapse;font-size:.76rem}.mm-table th,.mm-table td{padding:6px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid rgba(37,37,72,.6)}',
    '.mm-table th{font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)}.mm-table td:first-child,.mm-table th:first-child{text-align:left}',
    '.mm-table .mm-why{white-space:normal;text-align:left;color:var(--text-dim);font-size:.66rem;padding-top:0}',
    '.mm-chart{position:relative;height:300px}',
    '.mm-list{font-size:.76rem;color:var(--text-muted);line-height:1.55;padding-left:18px;margin:6px 0}',
    '.mm-src{font-size:.66rem;color:var(--text-dim);margin-top:8px;line-height:1.4}',
    '@media (max-width:600px){.mm-table{font-size:.68rem}.mm-chart{height:220px}}'
  ].join('\n');

  var STATE = { rec: null, results: null, charts: [], loaded: false };

  function injectCss() {
    if (document.getElementById('mm-module-css')) return;
    var st = document.createElement('style'); st.id = 'mm-module-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  function ensureTab() {
    var panel = document.getElementById('tab-spend_mix');
    if (!panel) {
      panel = document.createElement('div'); panel.id = 'tab-spend_mix'; panel.className = 'tab-content';
      var reports = document.getElementById('tab-reports');
      if (reports && reports.parentNode) reports.parentNode.appendChild(panel); else document.body.appendChild(panel);
    }
    var btn = document.querySelector('.tab[data-tab="spend_mix"]');
    if (!btn) {
      var anchor = document.querySelector('.tab[data-tab="ad_channels"]') || document.querySelector('.tab[data-tab="throttles"]') || document.querySelector('.tab[data-tab="reports"]');
      if (anchor && anchor.parentNode) {
        btn = document.createElement('div'); btn.className = 'tab'; btn.setAttribute('data-tab', 'spend_mix');
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      }
    }
    if (btn) btn.textContent = 'SPEND MIX (MMM)';
    if (btn && !btn._mmBound) {
      btn._mmBound = true;
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
        document.body.classList.remove('reports-active');
        btn.classList.add('active'); panel.classList.add('active');
        if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, null, '#spend-mix');
        render();
      });
    }
    return panel;
  }

  /* ------------------------------------------------------------ render */
  function pill(text, cls) { return '<span class="mm-pill ' + cls + '">' + esc(text) + '</span>'; }

  function renderReadiness(rec) {
    var r = readiness(rec);
    var h = '<div class="mm-card"><h3>Data readiness</h3>';
    h += '<div class="mm-kpis">' +
      '<div class="mm-kpi"><div class="mm-v">' + r.have + ' / ' + r.need + '</div><div class="mm-l">usable days</div></div>' +
      '<div class="mm-kpi"><div class="mm-v">' + r.pct + '%</div><div class="mm-l">of minimum history</div></div>' +
      '<div class="mm-kpi"><div class="mm-v">' + (r.sufficient ? 'ready' : '~' + r.weeksLeft + ' wk') + '</div><div class="mm-l">' + (r.sufficient ? 'model fits weekly' : 'until first fit at today\'s pace') + '</div></div>' +
      '</div>';
    h += '<div class="mm-bar"><i style="width:' + r.pct + '%"></i></div>';
    if (r.span) h += '<div class="mm-note">Per-channel window: ' + esc(r.span.start) + ' → ' + esc(r.span.end) + (r.gaps.length ? ' · missing days excluded: ' + esc(r.gaps.join(', ')) : '') + '</div>';
    if (r.reasons.length) h += '<ul class="mm-list">' + r.reasons.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
    h += '<div class="mm-note">Backfilling per-channel spend and Shopify daily revenue from the platform APIs (2025-01-01 onward) closes this in days, not months. ' +
      'Until then the tab shows readiness, never a curve.' + (r.historyOnlyDays ? ' Company-level history without a channel split: ' + r.historyOnlyDays + ' days (context only).' : '') + '</div>';
    var rows = coverageRows(rec);
    if (rows.length) {
      h += '<table class="mm-table"><thead><tr><th>Channel</th><th>Spend days</th><th>Feed days</th><th>D2C share</th><th>Spend CV</th><th>State</th></tr></thead><tbody>';
      rows.forEach(function (c) {
        h += '<tr><td>' + esc(c.label) + (c.d2c ? '' : ' <span class="mm-pill mm-muted">non-D2C</span>') + '</td><td>' + c.days + '</td><td>' + c.reported + '</td><td>' +
          (c.share == null ? '—' : c.share.toFixed(1) + '%') + '</td><td>' + (c.cv == null ? '—' : c.cv.toFixed(2)) + '</td><td>' + pill(c.state, c.state === 'measured' ? 'mm-good' : 'mm-muted') + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    return h + '</div>';
  }

  function renderRecommendation(rec, results) {
    var rows = channelRows(rec);
    if (!rows.length) return '';
    var fit = rec.fit || {};
    var h = '<div class="mm-card"><h3>Marginal view · target MER ' + esc(rec.mer_target) + '</h3>';
    h += '<div class="mm-kpis">' +
      '<div class="mm-kpi"><div class="mm-v">' + (fit.r2 != null ? fit.r2.toFixed(2) : '—') + '</div><div class="mm-l">fit R²</div></div>' +
      '<div class="mm-kpi"><div class="mm-v">' + (fit.holdout && fit.holdout.mape_pct != null ? fit.holdout.mape_pct + '%' : '—') + '</div><div class="mm-l">holdout error (' + ((fit.holdout && fit.holdout.days) || 14) + 'd)</div></div>' +
      '<div class="mm-kpi"><div class="mm-v">' + (rec.baseline_share_pct != null ? rec.baseline_share_pct.toFixed(0) + '%' : '—') + '</div><div class="mm-l">revenue not from paid (28d)</div></div>' +
      '</div>';
    h += '<table class="mm-table"><thead><tr><th>Channel</th><th>Verdict</th><th>$/day now</th><th>Marginal ROAS</th><th>10–90%</th><th>Avg ROAS</th><th>Share of paid rev</th><th>$/day at fixed total</th><th>Change</th><th>Target reached at</th><th>Conf.</th></tr></thead><tbody>';
    rows.forEach(function (c) {
      h += '<tr><td>' + esc(c.label) + '</td><td><span title="' + esc(c.why) + '">' + pill(c.verdict, verdictClass(c.verdict)) + '</span></td><td>' + usd(c.current) + '</td><td>' + x(c.mroas) + '</td><td>' +
        (c.lo == null ? '—' : x(c.lo) + '–' + x(c.hi)) + '</td><td>' + x(c.avgRoas) + '</td><td>' + (c.share == null ? '—' : c.share.toFixed(0) + '%') + '</td><td>' + usd(c.recommended) + '</td><td>' +
        pct(c.changePct) + '</td><td>' + (c.breakeven == null ? '—' : usd(c.breakeven) + '/d') + '</td><td>' + esc(c.confidence) + '</td></tr>';
      h += '<tr><td colspan="11" class="mm-why">' + esc(c.why) + '</td></tr>';
    });
    h += '</tbody></table>';
    var tp = rec.target_mer_total;
    if (tp && tp.status === 'ok') {
      h += '<div class="mm-note" style="margin-top:10px">Total D2C paid spend: blended marginal ROAS now ' + x(tp.blended_marginal_roas_now) + ' vs target ' + esc(tp.mer_target) + ' → ' +
        esc(tp.direction) + ' to ' + usd(tp.total_daily_spend_recommended) + '/day (×' + esc(tp.scale_factor) + ', capped ±20%).</div>';
    }
    var ra = rec.fixed_total_reallocation;
    if (ra && ra.status === 'ok') {
      h += '<div class="mm-note">Reallocation at today\'s total (' + usd(ra.total_daily_spend) + '/day): predicted +' + usd(ra.predicted_daily_revenue_delta) + '/day Shopify revenue, each channel moved at most ±' + esc(ra.step_cap_pct) + '%.</div>';
    }
    h += '<div class="mm-src">' + esc(rec.rule_status || '') + ' Basis: ' + esc(rec.basis || '') + '. Intervals are a 7-day block bootstrap with the response shapes held fixed.</div></div>';
    var ds = curveDatasets(results);
    if (ds.length) h += '<div class="mm-card"><h3>Response curves · daily Shopify revenue vs daily spend (steady state)</h3><div class="mm-chart"><canvas id="mm-curves"></canvas></div></div>';
    return h;
  }

  function renderLearnings(rec) {
    var L = (rec && rec.learnings) || [];
    var st = (rec && rec.studios) || {};
    var h = '<div class="mm-card"><h3>Learnings → Coldest Studios</h3>';
    if (!L.length) {
      h += '<div class="mm-note">No learning written: the model has no measured channel yet. When it does, one <code>cfo-mmm</code> learning per channel lands in Studios → More → Learnings (type <em>rule</em>), where Grokbot already reads the Meta creative learnings.</div>';
    } else {
      h += '<ul class="mm-list">' + L.map(function (l) { return '<li><strong>' + esc(label(l.channel)) + '</strong> · ' + esc(l.statement) + ' <span class="mm-pill mm-muted">' + esc(l.confidence) + '</span></li>'; }).join('') + '</ul>';
    }
    var ev = st.events || {}, lr = st.learnings || {};
    h += '<div class="mm-src">Studios bridge: drops as events ' + esc(ev.status || 'skipped') + (ev.events != null ? ' (' + ev.events + ')' : '') + ' · learnings push ' + esc(lr.status || 'skipped') + (lr.pushed != null ? ' (' + lr.pushed + ')' : '') +
      (ev.note ? ' · ' + esc(ev.note) : '') + '</div></div>';
    return h;
  }

  function drawCurves(results) {
    var ds = curveDatasets(results);
    var el = document.getElementById('mm-curves');
    if (!el || !ds.length || typeof root.Chart === 'undefined') return;
    STATE.charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* noop */ } }); STATE.charts = [];
    STATE.charts.push(new root.Chart(el.getContext('2d'), {
      type: 'line',
      data: { datasets: ds.map(function (d) { return { label: d.label, data: d.data, borderColor: d.borderColor, backgroundColor: d.backgroundColor, tension: d.tension, pointRadius: d.pointRadius }; }) },
      options: {
        responsive: true, maintainAspectRatio: false, parsing: false,
        scales: {
          x: { type: 'linear', title: { display: true, text: 'daily spend ($)' }, ticks: { color: '#8888a8' }, grid: { color: 'rgba(37,37,72,.6)' } },
          y: { title: { display: true, text: 'daily Shopify revenue ($)' }, ticks: { color: '#8888a8' }, grid: { color: 'rgba(37,37,72,.6)' } }
        },
        plugins: { legend: { labels: { color: '#8888a8' } } }
      }
    }));
  }

  function render() {
    var panel = ensureTab();
    var rec = STATE.rec;
    if (!STATE.loaded) { panel.innerHTML = '<div class="mm-note">Loading spend mix…</div>'; return; }
    if (!rec) {
      panel.innerHTML = '<div class="mm-card"><h3>Spend mix (MMM)</h3><div class="mm-note">No feed yet: <code>' + esc(FEEDS.rec) + '</code> has not been published to this page. The data repo\'s weekly refit (mmm-refit.yml) writes it; the publish step needs LIVE_MIRROR_TOKEN.</div></div>';
      return;
    }
    var insufficient = rec.status !== 'recommendation';
    var h = '<div class="mm-head">' +
      pill(insufficient ? 'INSUFFICIENT DATA' : 'RECOMMENDATION · ADVISORY', insufficient ? 'mm-warn' : 'mm-good') +
      '<span class="mm-note">as of ' + esc(rec.as_of || '—') + ' · computed ' + esc((rec.computed_at || '').replace('T', ' ').replace('Z', ' UTC')) + ' · ' + esc(rec.source || '') + '</span></div>';
    h += '<div class="mm-note" style="margin-bottom:14px">In-house media mix model: Shopify D2C net revenue explained by each channel\'s adstocked, saturating spend plus day-of-week, holidays, discount rate, Whatnot shows and named events (Studios drops). ' +
      'Marginal ROAS is the revenue the <em>next</em> dollar on a channel returns; the Jarvis rule keeps using platform-reported 7-day ROAS until David changes it.</div>';
    h += renderReadiness(rec);
    if (!insufficient) h += renderRecommendation(rec, STATE.results);
    h += renderLearnings(rec);
    panel.innerHTML = h;
    if (!insufficient) drawCurves(STATE.results);
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; });
  }

  function load() {
    return Promise.all([getJson(FEEDS.rec), getJson(FEEDS.results)]).then(function (docs) {
      STATE.rec = docs[0]; STATE.results = docs[1]; STATE.loaded = true;
      return STATE;
    });
  }

  function boot() {
    injectCss();
    var panel = ensureTab();
    load().then(function () { if (panel.classList.contains('active')) render(); });
    var hsh = typeof location !== 'undefined' ? location.hash : '';
    if (hsh === '#spend-mix' || hsh === '#spend_mix' || hsh === '#mmm') {
      var btn = document.querySelector('.tab[data-tab="spend_mix"]');
      if (btn) btn.click();
    }
  }

  var api = {
    FEEDS: FEEDS, LABELS: LABELS,
    readiness: readiness, coverageRows: coverageRows, channelRows: channelRows, curveDatasets: curveDatasets,
    verdictClass: verdictClass, render: render, load: load, _state: STATE, _fmt: { usd: usd, x: x, pct: pct }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SpendMix = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
    else setTimeout(boot, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
