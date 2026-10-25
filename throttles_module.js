/* =====================================================================
   COLDEST · THROTTLES
   ---------------------------------------------------------------------
   Visual dashboard of every paid channel + read-only live settings
   from ads_throttle/settings.json. What-if inputs are client-side only.
   Live settings change only through Jarvis in chat.
   Reporting only. No credentials.
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
    { id: 'tiktok', label: 'TikTok' }
  ];
  var ISSUE_REPO = 'https://github.com/davidstarkk/coldest-cfo-dashboard/issues/new';
  var SETTINGS_PATH = 'ads_throttle/settings.json';
  var CHANGES_PATH = 'ads_throttle/changes.json';
  var SERIES_PATH = 'ads_throttle/series.json';

  var LIVE = { settings: null, changes: null, series: null };
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

  function lastActionAt(changes, channelId, action) {
    var entries = (changes && changes.entries) || [];
    var i, e, at, best = null;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (channelId && e.channel && e.channel !== channelId) continue;
      if (action && e.action !== action) continue;
      at = e.at ? Date.parse(e.at) : NaN;
      if (!Number.isFinite(at)) continue;
      if (best == null || at > best) best = at;
    }
    return best;
  }

  function daysSince(ts) {
    if (ts == null) return Infinity;
    return (Date.now() - ts) / 86400000;
  }

  function mergeSettings(live, whatif) {
    var out = clone(live || { global: {}, channels: {}, mode_legend: {} });
    out.global = Object.assign({}, out.global, whatif && whatif.global);
    out.channels = out.channels || {};
    Object.keys((whatif && whatif.channels) || {}).forEach(function (id) {
      out.channels[id] = Object.assign({}, out.channels[id] || {}, whatif.channels[id]);
    });
    return out;
  }

  function recommend(channelId, settings, series, changes) {
    settings = settings || {};
    var g = settings.global || {};
    var ch = (settings.channels && settings.channels[channelId]) || {};
    var legend = settings.mode_legend || {};
    var days = lastN((series && series.days) || [], num(g.window_days) || 7);
    var spend7 = 0;
    days.forEach(function (d) { spend7 = round2(spend7 + channelSpend(d, channelId)); });
    var last = latestDay(series);
    var current = last ? channelSpend(last, channelId) : 0;
    var win = windowTotals(days);
    var mer = win.blendedMer;
    var threshold = num(g.roas_threshold);
    var step = num(g.step_pct);
    var base = {
      channel: channelId,
      mode: ch.mode || 'view',
      current: current,
      spend7: spend7,
      mer: mer,
      threshold: threshold,
      step_pct: step
    };

    if (ch.mode === 'frozen') return Object.assign(base, { action: 'none', label: 'Frozen', reason: legend.frozen || 'view only, no changes' });
    if (ch.mode === 'view') return Object.assign(base, { action: 'none', label: 'View only', reason: legend.view || 'tracked only' });
    if (ch.mode === 'hold') return Object.assign(base, { action: 'hold', label: 'Hold', reason: legend.hold || 'no changes, keep budget' });

    if (spend7 < num(g.min_spend_7d)) {
      return Object.assign(base, { action: 'hold', label: 'Hold', reason: '7d spend $' + spend7.toFixed(2) + ' is below min_spend_7d $' + num(g.min_spend_7d).toFixed(0) });
    }

    var wantScale = mer != null && mer >= threshold;
    var action = wantScale ? 'scale' : 'cut';
    var cooldown = wantScale ? num(g.scale_cooldown_days) : num(g.cut_cooldown_days);
    var lastAt = lastActionAt(changes, channelId, action);
    if (daysSince(lastAt) < cooldown) {
      return Object.assign(base, { action: 'hold', label: 'Cooldown', reason: action + ' cooldown ' + cooldown + 'd still running' });
    }

    var next = wantScale ? current * (1 + step / 100) : current * (1 - step / 100);
    if (ch.min_daily_budget != null && ch.min_daily_budget !== '') next = Math.max(next, num(ch.min_daily_budget));
    if (ch.max_daily_budget != null && ch.max_daily_budget !== '') next = Math.min(next, num(ch.max_daily_budget));
    next = round2(next);
    return Object.assign(base, {
      action: action,
      label: wantScale ? 'Scale +' + step + '%' : 'Cut −' + step + '%',
      recommended: next,
      reason: 'D2C blended MER ' + merTxt(mer) + ' vs threshold ' + merTxt(threshold) + ' (revenue_scope ' + (g.revenue_scope || 'shopify_d2c') + ')'
    });
  }

  function requestChangeUrl(settings) {
    var title = 'Throttle settings change request';
    var body = [
      'Requesting a live settings change. Live settings change only through Jarvis in chat.',
      '',
      'Current `' + SETTINGS_PATH + '`:',
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

  function chartColors() {
    return {
      cyan: '#00d4d4',
      green: '#22c55e',
      yellow: '#f59e0b',
      red: '#ef4444',
      muted: '#8888a8',
      dim: '#5c5c7a',
      grid: 'rgba(37,37,72,0.7)',
      text: '#e8e8f0'
    };
  }

  function lineChart(canvas, labels, spend, mer, threshold) {
    if (typeof Chart === 'undefined' || !canvas) return null;
    var c = chartColors();
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Daily spend',
            data: spend,
            yAxisID: 'y',
            borderColor: c.cyan,
            backgroundColor: 'rgba(0,212,212,0.12)',
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 2
          },
          {
            label: 'D2C MER / ROAS',
            data: mer,
            yAxisID: 'y1',
            borderColor: c.yellow,
            backgroundColor: 'transparent',
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 2
          },
          {
            label: '3.0 reference',
            data: labels.map(function () { return threshold; }),
            yAxisID: 'y1',
            borderColor: c.green,
            borderDash: [5, 4],
            pointRadius: 0,
            borderWidth: 1.5,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: c.muted, boxWidth: 10, font: { size: 10 } } },
          tooltip: {
            backgroundColor: '#12121e',
            titleColor: c.text,
            bodyColor: c.muted
          }
        },
        scales: {
          x: { ticks: { color: c.dim, maxTicksLimit: 8, font: { size: 10 } }, grid: { color: c.grid } },
          y: {
            position: 'left',
            ticks: { color: c.cyan, font: { size: 10 }, callback: function (v) { return '$' + Number(v).toLocaleString(); } },
            grid: { color: c.grid }
          },
          y1: {
            position: 'right',
            min: 0,
            ticks: { color: c.yellow, font: { size: 10 }, callback: function (v) { return Number(v).toFixed(1) + 'x'; } },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
    CHARTS.push(chart);
    return chart;
  }

  function shareChart(canvas, labels, values) {
    if (typeof Chart === 'undefined' || !canvas) return null;
    var c = chartColors();
    var palette = [c.cyan, '#3b82f6', c.yellow, '#a78bfa', '#fb7185', '#34d399', c.muted];
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{ data: values, backgroundColor: palette, borderColor: '#131328', borderWidth: 2 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: c.muted, boxWidth: 10, font: { size: 10 } } }
        }
      }
    });
    CHARTS.push(chart);
    return chart;
  }

  function injectCss() {
    if (document.getElementById('th-module-css')) return;
    var css = ''
      + '.th-wrap{max-width:1400px;margin:0 auto;padding:8px 0 32px}'
      + '.th-title{font-size:.72rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--cyan,#00d4d4);margin:0 0 8px}'
      + '.th-h{font-size:1.35rem;font-weight:700;margin:0 0 6px}'
      + '.th-sub{color:var(--text-muted,#8888a8);font-size:.82rem;margin:0 0 16px;line-height:1.5}'
      + '.th-note{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);border-radius:8px;padding:10px 12px;color:var(--yellow,#f59e0b);font-size:.8rem;margin:0 0 16px}'
      + '.th-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}'
      + '.th-card{background:var(--card,#171730);border:1px solid var(--border,#252548);border-radius:8px;padding:14px 16px}'
      + '.th-label{font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim,#5c5c7a);margin-bottom:6px}'
      + '.th-val{font-family:var(--font-mono,ui-monospace,monospace);font-size:1.35rem;font-weight:700}'
      + '.th-muted{color:var(--text-muted,#8888a8);font-size:.75rem;margin-top:4px}'
      + '.th-grid{display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:16px}'
      + '.th-chart{height:220px}'
      + '.th-channels{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:16px 0}'
      + '.th-chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.65rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}'
      + '.th-chip.auto{background:rgba(0,212,212,.15);color:#00d4d4}'
      + '.th-chip.hold{background:rgba(245,158,11,.15);color:#f59e0b}'
      + '.th-chip.frozen{background:rgba(239,68,68,.15);color:#ef4444}'
      + '.th-chip.view{background:rgba(136,136,168,.15);color:#8888a8}'
      + '.th-table{width:100%;border-collapse:collapse;font-size:.8rem}'
      + '.th-table th{color:var(--text-dim,#5c5c7a);font-size:.65rem;letter-spacing:.08em;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid var(--border,#252548);text-align:right}'
      + '.th-table th:first-child,.th-table td:first-child{text-align:left}'
      + '.th-table td{padding:7px 8px;border-bottom:1px solid var(--border,#252548);font-family:var(--font-mono,ui-monospace,monospace)}'
      + '.th-form{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px}'
      + '.th-form label{display:block;font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#5c5c7a);margin-bottom:4px}'
      + '.th-form input,.th-form select{width:100%;background:var(--card,#171730);color:var(--text,#e8e8f0);border:1px solid var(--border,#252548);border-radius:6px;padding:7px 8px;font-family:var(--font-mono,ui-monospace,monospace);font-size:.8rem}'
      + '.th-form input:disabled,.th-form select:disabled{opacity:.7;cursor:not-allowed}'
      + '.th-btn{display:inline-block;background:var(--cyan,#00d4d4);color:#0d0d1a;border:none;border-radius:6px;padding:8px 12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;font-size:.7rem;text-decoration:none}'
      + '.th-ro{opacity:.85}'
      + '@media (max-width:900px){.th-kpis,.th-grid,.th-channels,.th-form{grid-template-columns:1fr}}';
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
      var after = document.querySelector('.tab[data-tab="scaling"]') || document.querySelector('.tab[data-tab="reports"]');
      if (after && after.parentNode) {
        btn = document.createElement('div');
        btn.className = 'tab';
        btn.setAttribute('data-tab', 'throttles');
        btn.textContent = 'THROTTLES';
        after.parentNode.insertBefore(btn, after.nextSibling);
      }
    }
    if (btn && !btn._thBound) {
      btn._thBound = true;
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
        document.body.classList.remove('reports-active');
        btn.classList.add('active');
        panel.classList.add('active');
        render();
      });
    }
    return panel;
  }

  function settingsBlock(live, editable) {
    var g = (live && live.global) || {};
    var legend = (live && live.mode_legend) || {};
    var fields = [
      ['roas_threshold', 'ROAS threshold', g.roas_threshold],
      ['step_pct', 'Step %', g.step_pct],
      ['window_days', 'Window days', g.window_days],
      ['min_spend_7d', 'Min spend 7d', g.min_spend_7d],
      ['scale_cooldown_days', 'Scale cooldown', g.scale_cooldown_days],
      ['cut_cooldown_days', 'Cut cooldown', g.cut_cooldown_days]
    ];
    var globalHtml = fields.map(function (f) {
      var val = WHATIF.global[f[0]] != null && editable ? WHATIF.global[f[0]] : f[2];
      return '<div><label>' + esc(f[1]) + '</label><input data-th-g="' + f[0] + '" type="number" step="any" value="' + esc(val) + '"' + (editable ? '' : ' disabled') + '></div>';
    }).join('');
    var chHtml = CHANNEL_META.map(function (c) {
      var row = ((live && live.channels) || {})[c.id] || {};
      var wf = WHATIF.channels[c.id] || {};
      var mode = editable && wf.mode != null ? wf.mode : (row.mode || 'view');
      var minB = editable && wf.min_daily_budget != null ? wf.min_daily_budget : (row.min_daily_budget == null ? '' : row.min_daily_budget);
      var maxB = editable && wf.max_daily_budget != null ? wf.max_daily_budget : (row.max_daily_budget == null ? '' : row.max_daily_budget);
      return '<div class="th-card">'
        + '<div class="th-label">' + esc(c.label) + ' <span class="th-chip ' + esc(mode) + '">' + esc(mode) + '</span></div>'
        + '<div class="th-form" style="grid-template-columns:1fr 1fr 1fr">'
        + '<div><label>mode</label><select data-th-ch="' + c.id + '" data-th-f="mode"' + (editable ? '' : ' disabled') + '>'
        + ['auto', 'hold', 'frozen', 'view'].map(function (m) { return '<option value="' + m + '"' + (m === mode ? ' selected' : '') + '>' + m + '</option>'; }).join('')
        + '</select></div>'
        + '<div><label>min daily</label><input data-th-ch="' + c.id + '" data-th-f="min_daily_budget" type="number" step="0.01" placeholder="none" value="' + esc(minB) + '"' + (editable ? '' : ' disabled') + '></div>'
        + '<div><label>max daily</label><input data-th-ch="' + c.id + '" data-th-f="max_daily_budget" type="number" step="0.01" placeholder="none" value="' + esc(maxB) + '"' + (editable ? '' : ' disabled') + '></div>'
        + '</div>'
        + (row.notes ? '<div class="th-muted">' + esc(row.notes) + '</div>' : '')
        + (row.owner_bot ? '<div class="th-muted">Owner: ' + esc(row.owner_bot) + '</div>' : '')
        + '</div>';
    }).join('');
    var legendHtml = Object.keys(legend).map(function (k) {
      return '<span class="th-chip ' + esc(k) + '">' + esc(k) + '</span> ' + esc(legend[k]);
    }).join(' · ');
    return { globalHtml: globalHtml, chHtml: chHtml, legendHtml: legendHtml };
  }

  function recsTableHtml(recs) {
    return recs.map(function (r) {
      return '<tr><td>' + esc(channelLabel(r.channel)) + '</td><td>' + esc(r.mode) + '</td><td>' + usd(r.spend7) + '</td><td>' + esc(r.label) + '</td><td>' + esc(r.reason) + (r.recommended != null ? ' → ' + usd(r.recommended) : '') + '</td></tr>';
    }).join('');
  }

  function currentRecs() {
    return CHANNEL_META.map(function (c) {
      return recommend(c.id, mergeSettings(LIVE.settings, WHATIF), LIVE.series, LIVE.changes);
    });
  }

  function refreshRecs(rootEl) {
    var body = rootEl.querySelector('#th-recs-body');
    if (body) body.innerHTML = recsTableHtml(currentRecs());
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

  function render() {
    var panel = ensureTab();
    if (!panel) return;
    injectCss();
    destroyCharts();
    var settings = LIVE.settings || { global: {}, channels: {}, mode_legend: {} };
    var series = LIVE.series || { days: [] };
    var days = series.days || [];
    var last = latestDay(series);
    var merged = mergeSettings(settings, WHATIF);
    var recs = CHANNEL_META.map(function (c) { return recommend(c.id, merged, series, LIVE.changes); });
    var threshold = num((merged.global || {}).roas_threshold) || 3;
    var labels = days.map(function (d) { return d.date.slice(5); });
    var merSeries = days.map(function (d) { return d.blended_mer == null ? null : num(d.blended_mer); });
    var spendSeries = days.map(function (d) { return num(d.total_ad_spend); });
    var liveUi = settingsBlock(settings, false);
    var ifUi = settingsBlock(merged, true);
    var shareLabels = [];
    var shareVals = [];
    CHANNEL_META.forEach(function (c) {
      var sum = 0;
      days.forEach(function (d) { sum = round2(sum + channelSpendPublished(d, c.id)); });
      shareLabels.push(c.label);
      shareVals.push(sum);
    });

    panel.innerHTML = ''
      + '<div class="th-wrap">'
      + '<div class="th-title">Throttles</div>'
      + '<h2 class="th-h">Channel controls</h2>'
      + '<p class="th-sub">28-day series from <code>' + esc(SERIES_PATH) + '</code> (source ' + esc(series.source || 'daily_inputs') + ', as_of ' + esc(series.as_of || (last && last.date) || '—') + '). Live rules from <code>' + esc(SETTINGS_PATH) + '</code>.</p>'
      + '<div class="th-note">Live settings change only through Jarvis in chat. '
      + '<a class="th-btn" style="margin-left:8px" target="_blank" rel="noopener" href="' + esc(requestChangeUrl(settings)) + '">Request change</a></div>'
      + '<div class="th-kpis">'
      + '<div class="th-card"><div class="th-label">Total ad spend</div><div class="th-val">' + usd(last ? last.total_ad_spend : 0) + '</div><div class="th-muted">' + esc(last ? last.date : 'no series') + ' · total_ad_spend</div></div>'
      + '<div class="th-card"><div class="th-label">Shopify D2C revenue</div><div class="th-val">' + usd(last ? last.shopify_d2c_revenue : 0) + '</div><div class="th-muted">revenue_scope shopify_d2c</div></div>'
      + '<div class="th-card"><div class="th-label">Blended MER</div><div class="th-val">' + merTxt(last && last.blended_mer) + '</div><div class="th-muted">vs ' + merTxt(threshold) + ' reference</div></div>'
      + '</div>'
      + '<div class="th-grid">'
      + '<div class="th-card"><div class="th-label">Blended MER trend · 28d</div><div class="th-chart"><canvas id="th-mer-chart"></canvas></div></div>'
      + '<div class="th-card"><div class="th-label">Budget share · 28d spend</div><div class="th-chart"><canvas id="th-share-chart"></canvas></div></div>'
      + '</div>'
      + '<div class="th-title">Live settings · read only</div>'
      + '<div class="th-card th-ro"><div class="th-label">Global</div><div class="th-form">' + liveUi.globalHtml + '</div>'
      + '<div class="th-muted" style="margin-top:8px">Updated ' + esc(settings.updated_at || '—') + ' · ' + esc(settings.updated_by || '') + '</div>'
      + '<div class="th-muted" style="margin-top:6px">' + liveUi.legendHtml + '</div></div>'
      + '<div class="th-channels">' + liveUi.chHtml + '</div>'
      + '<div class="th-title">What-if · client-side only</div>'
      + '<p class="th-sub">These inputs do not write ' + esc(SETTINGS_PATH) + '. They recompute recommended actions on this page only.</p>'
      + '<div class="th-card"><div class="th-form">' + ifUi.globalHtml + '</div></div>'
      + '<div class="th-channels">' + ifUi.chHtml + '</div>'
      + '<div class="th-card"><div class="th-label">Recommended actions</div>'
      + '<table class="th-table"><thead><tr><th>Channel</th><th>Mode</th><th>7d spend</th><th>Action</th><th>Detail</th></tr></thead><tbody id="th-recs-body">'
      + recsTableHtml(recs)
      + '</tbody></table></div>'
      + '<div class="th-title">Per channel · 28d spend + ROAS</div>'
      + '<div class="th-channels" id="th-channel-cards">'
      + CHANNEL_META.map(function (c) {
        var rec = recs.filter(function (r) { return r.channel === c.id; })[0];
        var lastCh = last && last.channels ? last.channels[c.id] : null;
        var split = (c.id === 'bing' && lastCh && (lastCh.d2c != null || lastCh.amazon != null))
          ? ('bing.d2c ' + usd(lastCh.d2c) + ' + bing.amazon ' + usd(lastCh.amazon))
          : '';
        return '<div class="th-card"><div class="th-label">' + esc(c.label) + ' <span class="th-chip ' + esc((rec && rec.mode) || 'view') + '">' + esc((rec && rec.mode) || 'view') + '</span></div>'
          + '<div class="th-val">' + usd(lastCh ? lastCh.spend : 0) + '</div>'
          + '<div class="th-muted">' + esc(split || ((lastCh && lastCh.source) || 'no feed')) + ' · ' + esc(rec ? rec.label : '') + '</div>'
          + '<div class="th-chart"><canvas id="th-ch-' + c.id + '"></canvas></div></div>';
      }).join('')
      + '</div>'
      + '<div class="th-title">Change log</div>'
      + '<div class="th-card"><table class="th-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Summary</th></tr></thead><tbody>'
      + (((LIVE.changes && LIVE.changes.entries) || []).map(function (e) {
        return '<tr><td>' + esc(e.at || '—') + '</td><td>' + esc(e.by || '—') + '</td><td>' + esc(e.action || '—') + '</td><td>' + esc(e.summary || '') + '</td></tr>';
      }).join('') || '<tr><td colspan="4">No ads_throttle/changes.json entries.</td></tr>')
      + '</tbody></table></div>'
      + '</div>';

    lineChart(document.getElementById('th-mer-chart'), labels, spendSeries, merSeries, threshold);
    shareChart(document.getElementById('th-share-chart'), shareLabels, shareVals);
    CHANNEL_META.forEach(function (c) {
      var spend = days.map(function (d) { return channelSpendPublished(d, c.id); });
      var roas = days.map(function (d) {
        var ch = d.channels && d.channels[c.id];
        if (ch && ch.roas != null) return num(ch.roas);
        return d.blended_mer == null ? null : num(d.blended_mer);
      });
      lineChart(document.getElementById('th-ch-' + c.id), labels, spend, roas, threshold);
    });
    bindWhatIf(panel);
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status));
    });
  }

  function openFromHash() {
    if (typeof location === 'undefined' || location.hash !== '#throttles') return;
    var btn = document.querySelector('.tab[data-tab="throttles"]');
    if (btn) btn.click();
  }

  function boot() {
    ensureTab();
    injectCss();
    Promise.allSettled([
      fetchJson(SETTINGS_PATH),
      fetchJson(CHANGES_PATH),
      fetchJson(SERIES_PATH)
    ]).then(function (results) {
      LIVE.settings = results[0].status === 'fulfilled' ? results[0].value : null;
      LIVE.changes = results[1].status === 'fulfilled' ? results[1].value : { entries: [] };
      LIVE.series = results[2].status === 'fulfilled' ? results[2].value : { days: [] };
      var panel = document.getElementById('tab-throttles');
      if (panel && panel.classList.contains('active')) render();
      openFromHash();
    });
  }

  var api = {
    CHANNEL_META: CHANNEL_META,
    recommend: recommend,
    mergeSettings: mergeSettings,
    windowTotals: windowTotals,
    requestChangeUrl: requestChangeUrl,
    channelSpend: channelSpend,
    render: render,
    _setLive: function (settings, series, changes) {
      LIVE.settings = settings || null;
      LIVE.series = series || { days: [] };
      LIVE.changes = changes || { entries: [] };
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
