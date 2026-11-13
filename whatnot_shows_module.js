/* =====================================================================
   COLDEST · WHATNOT SHOWS — every show, what it sold and when it started
   ---------------------------------------------------------------------
   Reporting-only. Draws whatnot_shows.json exactly as the data repo built
   it (davidstarkk/coldest-cfo-dashboard, cfo_backend/whatnot_shows.py →
   lib/publish_live_feeds.sh): shows per day, revenue per show, start time,
   and averages by part of the day. Nothing is computed here; a day without
   per-show rows says so and shows no number.
   ===================================================================== */
(function (root) {
  'use strict';

  var FEED = 'whatnot_shows.json';
  var PART = { morning: 'Morning', midday: 'Midday', evening: 'Evening', night: 'Night' };
  var STATE = { doc: null, loaded: false };

  function num(v) { if (v == null || v === '') return null; var n = Number(v); return Number.isFinite(n) ? n : null; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function usd(v, cents) {
    var n = num(v); if (n == null) return '—';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  }
  function int(v) { var n = num(v); return n == null ? '—' : Math.round(n).toLocaleString('en-US'); }
  function one(v) { var n = num(v); return n == null ? '—' : n.toFixed(1); }
  function dayLabel(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) return '—';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + (+m[2]) + '/' + (+m[3]);
  }
  function md(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? (+m[2]) + '/' + (+m[3]) : '—'; }

  /* ---------------------------------------------------------------- pure */
  function dayRows(doc) {
    var by = (doc && doc.by_date) || {};
    return Object.keys(by).sort().reverse().map(function (k) {
      var d = by[k];
      return { date: k, status: d.status, note: d.note || null, count: num(d.show_count), total: num(d.shows_revenue), perShow: num(d.revenue_per_show),
        recorded: num(d.recorded_revenue), differsBy: num(d.recorded_differs_by),
        shows: (d.shows || []).map(function (s) {
          return { start: s.start || null, part: s.daypart || null, title: s.title || '', host: s.host || null, revenue: num(s.revenue), orders: num(s.orders),
            perOrder: num(s.revenue_per_order), items: num(s.items_sold), buyers: num(s.first_time_buyers), promo: num(s.promotion_spend) };
        }) };
    });
  }
  function partRows(doc) {
    return ((doc && doc.by_daypart) || []).map(function (p) {
      return { part: p.daypart, hours: p.hours, shows: num(p.shows), days: num(p.days), perShow: num(p.revenue_per_show), best: num(p.best_show), worst: num(p.worst_show),
        orders: num(p.orders_per_show), buyers: num(p.first_time_buyers_per_show) };
    });
  }
  function hostRows(doc) {
    return ((doc && doc.by_host) || []).map(function (h) {
      return { host: h.host, shows: num(h.shows), perShow: num(h.revenue_per_show), orders: num(h.orders_per_show), buyers: num(h.first_time_buyers_per_show) };
    });
  }

  /* ---------------------------------------------------------------- css */
  var CSS = [
    '.ws-card{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin:0 0 14px}',
    '.ws-card h3{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim);margin:0 0 10px;font-weight:600}',
    '.ws-note{font-size:.72rem;color:var(--text-muted);line-height:1.5;margin:0 0 10px;max-width:980px}',
    '.ws-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
    '.ws-kpi{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px}',
    '.ws-kpi .ws-v{font-size:1.25rem;font-weight:700}.ws-kpi .ws-l{font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);margin-top:2px}',
    '.ws-kpi .ws-s{font-size:.68rem;color:var(--text-muted);margin-top:3px}',
    '.ws-scroll{overflow-x:auto}',
    '.ws-table{width:100%;border-collapse:collapse;font-size:.76rem}',
    '.ws-table th,.ws-table td{padding:7px 8px;text-align:right;border-bottom:1px solid rgba(37,37,72,.6);vertical-align:middle}',
    '.ws-table th{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);white-space:nowrap}',
    '.ws-table td:first-child,.ws-table th:first-child,.ws-table .ws-left{text-align:left}',
    '.ws-table tr.ws-day td{background:var(--surface);font-weight:600;border-top:1px solid var(--border)}',
    '.ws-sub{display:block;font-size:.64rem;color:var(--text-dim);margin-top:1px;font-weight:400}',
    '.ws-warn{color:var(--yellow)}.ws-muted{color:var(--text-dim)}',
    '.ws-src{font-size:.66rem;color:var(--text-dim);margin-top:8px;line-height:1.4;max-width:980px}',
    '@media (max-width:600px){.ws-table{font-size:.68rem}}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('ws-module-css')) return;
    var st = document.createElement('style'); st.id = 'ws-module-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------- render */
  function box(v, l, s) { return '<div class="ws-kpi"><div class="ws-v">' + v + '</div><div class="ws-l">' + esc(l) + '</div>' + (s ? '<div class="ws-s">' + s + '</div>' : '') + '</div>'; }
  function table(heads, rows) {
    return '<div class="ws-scroll"><table class="ws-table"><thead><tr>' + heads.map(function (h) {
      return '<th' + (h[1] ? ' class="ws-left"' : '') + '>' + esc(h[0]) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  function renderSummary(doc) {
    var o = doc.overall, w = doc.window || {};
    if (!o) return '<div class="ws-card"><h3>Whatnot shows</h3><p class="ws-note">No day has per-show rows yet.</p></div>';
    return '<div class="ws-card"><h3>Whatnot shows, ' + esc(md(w.first_day)) + ' to ' + esc(md(w.last_day)) + '</h3><div class="ws-kpis">' +
      box(int(o.shows), 'Shows', 'on ' + int(o.days) + ' days') + box(usd(o.revenue_per_show), 'Revenue per show', 'total ' + usd(o.revenue)) +
      box(usd(o.best_show), 'Best show', 'lowest ' + usd(o.worst_show)) + box(one(o.orders_per_show), 'Orders per show', 'shipments') +
      box(one(o.first_time_buyers_per_show), 'First-time buyers per show', 'as Whatnot reports them') + '</div></div>';
  }

  function renderParts(doc) {
    var rows = partRows(doc);
    if (!rows.length) return '';
    var html = '<div class="ws-card"><h3>By time of day</h3><p class="ws-note">' + esc(doc.caveat || '') + '</p>' +
      table([['Start time (Eastern)', 1], ['Shows'], ['Revenue per show'], ['Best'], ['Lowest'], ['Orders per show'], ['First-time buyers per show']], rows.map(function (r) {
        return '<tr><td>' + esc(PART[r.part] || r.part) + '<span class="ws-sub">' + esc(r.hours) + '</span></td><td>' + int(r.shows) + '</td><td>' + usd(r.perShow) + '</td><td>' + usd(r.best) +
          '</td><td>' + usd(r.worst) + '</td><td>' + one(r.orders) + '</td><td>' + one(r.buyers) + '</td></tr>';
      }));
    var hosts = hostRows(doc);
    if (hosts.length) {
      html += '<p class="ws-note" style="margin-top:14px">By host. ' + esc(doc.host_note || '') + '</p>' +
        table([['Host', 1], ['Shows'], ['Revenue per show'], ['Orders per show'], ['First-time buyers per show']], hosts.map(function (h) {
          return '<tr><td>' + esc(h.host) + '</td><td>' + int(h.shows) + '</td><td>' + usd(h.perShow) + '</td><td>' + one(h.orders) + '</td><td>' + one(h.buyers) + '</td></tr>';
        }));
    }
    return html + '</div>';
  }

  function renderDays(doc) {
    var rows = [];
    dayRows(doc).forEach(function (d) {
      if (d.status === 'no_shows') {
        rows.push('<tr class="ws-day"><td colspan="7">' + esc(dayLabel(d.date)) + '<span class="ws-sub">no shows</span></td></tr>');
        return;
      }
      if (!d.shows.length) {
        rows.push('<tr class="ws-day"><td colspan="2">' + esc(dayLabel(d.date)) + '<span class="ws-sub ws-warn">' + esc(d.note || 'no per-show rows') + '</span></td><td>' + usd(d.recorded) +
          '<span class="ws-sub">day total</span></td><td colspan="4"></td></tr>');
        return;
      }
      rows.push('<tr class="ws-day"><td colspan="2">' + esc(dayLabel(d.date)) + ' · ' + int(d.count) + (d.count === 1 ? ' show' : ' shows') +
        (d.note ? '<span class="ws-sub ws-warn">' + esc(d.note) + (d.differsBy != null ? ' (recorded ' + usd(d.recorded) + ')' : '') + '</span>' : '') + '</td><td>' + usd(d.total) +
        '<span class="ws-sub">' + usd(d.perShow) + ' per show</span></td><td colspan="4"></td></tr>');
      d.shows.forEach(function (s) {
        rows.push('<tr><td>' + esc(s.start || '—') + '</td><td class="ws-left">' + esc(s.title) + '</td><td>' + usd(s.revenue) + '</td><td>' + int(s.orders) + '</td><td>' + usd(s.perOrder, true) +
          '</td><td>' + int(s.buyers) + '</td><td>' + usd(s.promo) + '</td></tr>');
      });
    });
    return '<div class="ws-card"><h3>Every show</h3>' + table([['Start', 1], ['Show', 1], ['Revenue'], ['Orders'], ['Per order'], ['First-time buyers'], ['Promotion spend']], rows) +
      '<p class="ws-src">' + esc(doc.basis || '') + ' Promotion spend per show appears once the daily feed carries it; a dash means it is not in the feed, not $0.</p></div>';
  }

  function render() {
    var panel = document.getElementById('tab-whatnot_shows');
    if (!panel) return;
    if (!STATE.loaded) { panel.innerHTML = '<div class="ws-card"><p class="ws-note">Loading…</p></div>'; return; }
    var doc = STATE.doc;
    if (!doc || !doc.by_date) {
      panel.innerHTML = '<div class="ws-card"><h3>Whatnot shows</h3><p class="ws-note">' + esc(FEED) + ' has not been published to this page yet. It is rebuilt every morning in the data repo and copied here by its publish step.</p></div>';
      return;
    }
    panel.innerHTML = renderSummary(doc) + renderParts(doc) + renderDays(doc);
  }

  function ensureTab() {
    var panel = document.getElementById('tab-whatnot_shows');
    if (!panel) {
      panel = document.createElement('div'); panel.id = 'tab-whatnot_shows'; panel.className = 'tab-content';
      var reports = document.getElementById('tab-reports');
      if (reports && reports.parentNode) reports.parentNode.appendChild(panel); else document.body.appendChild(panel);
    }
    var btn = document.querySelector('.tab[data-tab="whatnot_shows"]');
    if (!btn) {
      var anchor = document.querySelector('.tab[data-tab="growth"]') || document.querySelector('.tab[data-tab="loop"]') || document.querySelector('.tab[data-tab="reports"]');
      if (anchor && anchor.parentNode) {
        btn = document.createElement('div'); btn.className = 'tab'; btn.setAttribute('data-tab', 'whatnot_shows');
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      }
    }
    if (btn) btn.textContent = 'WHATNOT SHOWS';
    if (btn && !btn._wsBound) {
      btn._wsBound = true;
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
        document.body.classList.remove('reports-active');
        btn.classList.add('active'); panel.classList.add('active');
        if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, null, '#whatnot_shows');
        render();
      });
    }
    return panel;
  }

  function load() {
    return fetch(FEED, { cache: 'no-store' }).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; })
      .then(function (doc) { STATE.doc = doc; STATE.loaded = true; return STATE; });
  }

  function boot() {
    injectCss();
    var panel = ensureTab();
    load().then(function () { if (panel.classList.contains('active')) render(); });
    if (typeof location !== 'undefined' && location.hash === '#whatnot_shows') {
      var btn = document.querySelector('.tab[data-tab="whatnot_shows"]');
      if (btn) btn.click();
    }
  }

  var api = { FEED: FEED, dayRows: dayRows, partRows: partRows, hostRows: hostRows, renderSummary: renderSummary, renderParts: renderParts, renderDays: renderDays, render: render, load: load, _state: STATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WhatnotShows = api;

  if (typeof document !== 'undefined') {
    // After growth_module.js has inserted its tab, so this one sits next to it.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 40); });
    else setTimeout(boot, 40);
  }
})(typeof window !== 'undefined' ? window : globalThis);
