/* =====================================================================
   COLDEST · AD CHANNEL THROTTLES
   ---------------------------------------------------------------------
   Read-only dashboard. Live rules change only via Jarvis.
   Data: ad_channel_throttles → throttle_settings → ads_throttle/changes.json
   (fallbacks: ads_throttle/settings.json, ads_throttle/series.json,
   mer_for_manus.json blocks). Reporting only. No credentials.
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
  var SNAPSHOT_PATH = 'ad_channel_throttles.json';
  var SETTINGS_PATH = 'throttle_settings.json';
  var SETTINGS_FALLBACK = 'ads_throttle/settings.json';
  var CHANGES_PATH = 'ads_throttle/changes.json';
  var SERIES_PATH = 'ads_throttle/series.json';
  var UNVERIFIED = 'unverified';

  var LIVE = { settings: null, changes: null, series: null, snapshot: null };
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

  function recommend(channelId, settings, series, changes) {
    settings = normalizeSettings(settings || {});
    var g = settings.global || {};
    var ch = (settings.channels && settings.channels[channelId]) || {};
    var snap = snapshotChannel(channelId) || {};
    var spend7 = channelSpend7(channelId, settings, series);
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
      mer: mer,
      roas: mer,
      roas_source: roasInfo.source,
      roas_verified: roasInfo.verified,
      roas_basis: roasInfo.basis || snap.roas_basis || g.roas_basis || 'platform',
      threshold: threshold,
      step_pct: step
    };

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

    if (spend7 < minSpend) {
      return Object.assign(base, { action: 'not_enough_data', label: 'Not enough data', reason: '7d spend ' + usd(spend7) + ' is under min spend ' + usd(minSpend) });
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
    if (label.indexOf('Hold') === 0) return 'hold';
    if (label.indexOf('Not enough') === 0) return 'nodata';
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
      + '.th-unverified{color:var(--yellow,#f59e0b);font-weight:600;font-size:.75rem}'
      + '.th-scroll{overflow-x:auto}'
      + '.th-table{width:100%;border-collapse:collapse;font-size:.78rem;min-width:1100px}'
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
      var after = document.querySelector('.tab[data-tab="scaling"]') || document.querySelector('.tab[data-tab="reports"]');
      if (after && after.parentNode) {
        btn = document.createElement('div');
        btn.className = 'tab';
        btn.setAttribute('data-tab', 'throttles');
        after.parentNode.insertBefore(btn, after.nextSibling);
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
    var rev = snap.shopify_revenue_7d != null ? snap.shopify_revenue_7d : snap.shopify_attributed_revenue;
    var roasVal = snap.platform_roas_7d != null ? snap.platform_roas_7d : snap.roas_7d;
    var roasStatus = snap.platform_roas_status || snap.roas_7d_status;
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
    var roasHtml = unverifiedOr(roasVal, merTxt, roasStatus);
    if (roasStatus === 'verified' || (roasVal != null && roasStatus !== 'unverified')) {
      roasHtml += '<div class="th-muted">' + esc(basisLabel(snap.roas_basis || rec.roas_basis)) + '</div>';
    }
    return '<tr>'
      + '<td>' + esc(c.label) + '</td>'
      + '<td class="mono">' + unverifiedOr(budget, usd, snap.daily_budget_status) + '</td>'
      + '<td class="mono">' + spendHtml + '</td>'
      + '<td class="mono">' + unverifiedOr(rev, usd, snap.shopify_revenue_status) + '</td>'
      + '<td class="mono">' + roasHtml + '</td>'
      + '<td>' + sparkSvg(trend) + '</td>'
      + '<td>' + esc(destLabel(dest)) + (destNote ? '<div class="th-muted">' + esc(destNote) + '</div>' : '') + '</td>'
      + '<td><span class="th-chip ' + badgeClass(rec.label) + '">' + esc(rec.label) + '</span></td>'
      + '<td>' + lastTxt + '<div class="th-muted">next ' + (nextEl && nextEl !== '—' ? esc(String(nextEl).slice(0, 10)) : 'eligible now') + '</div></td>'
      + '<td>' + (owner ? esc(owner) : '<span class="th-unverified">' + UNVERIFIED + '</span>') + '</td>'
      + '<td>' + (notes ? esc(notes) : '—') + '</td>'
      + '</tr>';
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
      + '<div class="th-title">Channels</div>'
      + '<div class="th-card th-scroll"><table class="th-table"><thead><tr>'
      + '<th>Channel</th><th>Daily budget</th><th>7d spend</th><th>Shopify rev</th><th>7d ROAS</th><th>3d trend</th><th>Destination</th><th>Rule</th><th>Last change / next</th><th>Owner bot</th><th>Strategy notes</th>'
      + '</tr></thead><tbody id="th-recs-body">'
      + recsTableHtml(recs, settings)
      + '</tbody></table></div>'
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
      fetchJson('mer_for_manus.json')
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
      var panel = document.getElementById('tab-throttles');
      if (panel && panel.classList.contains('active')) render();
      openFromHash();
    });
  }

  var api = {
    CHANNEL_META: CHANNEL_META,
    recommend: recommend,
    mergeSettings: mergeSettings,
    normalizeSettings: normalizeSettings,
    windowTotals: windowTotals,
    requestChangeUrl: requestChangeUrl,
    channelSpend: channelSpend,
    destLabel: destLabel,
    UNVERIFIED: UNVERIFIED,
    render: render,
    _setLive: function (settings, series, changes, snapshot) {
      LIVE.settings = normalizeSettings(settings || null);
      LIVE.series = series || { days: [] };
      LIVE.changes = changes != null ? changes : { entries: [] };
      LIVE.snapshot = snapshot || null;
      WHATIF = { global: {}, channels: {} };
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
