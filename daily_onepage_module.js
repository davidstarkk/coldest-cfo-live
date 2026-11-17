/* =====================================================================
   COLDEST · DAILY ONE PAGE
   ---------------------------------------------------------------------
   David 11/17: one scroll should explain yesterday. This puts three
   sections inside each day's report card on DAILY REPORTS:
     - WHATNOT SHOWS      every show that day   (whatnot_shows.json)
     - META BY COUNTRY    one row per line      (ads_throttle/intl_meta.json)
     - BUDGET CALLS       what the rule says    (ads_throttle/cfo_brief.json)
   Nothing is computed here. Rows come from WhatnotShows.dayRows and
   IntlMeta.countryRows / spendDisplay, and the brief is drawn as the data
   repo built it. Meta-by-country and budget calls are as-of snapshots, so
   they appear only on the card whose date equals the feed's as_of. A value
   the feed does not carry is a dash, never $0. The full tabs stay.
   No MutationObserver: sections are redrawn after renderReports().
   ===================================================================== */
(function (root) {
  'use strict';

  var FEEDS = { shows: 'whatnot_shows.json', intl: 'ads_throttle/intl_meta.json', registry: 'ads_throttle/intl_meta_registry.json', brief: 'ads_throttle/cfo_brief.json' };
  var STATE = { shows: null, intl: null, registry: null, brief: null, loaded: false };

  function dep(name, file) {
    if (root[name]) return root[name];
    if (typeof require === 'function') { try { return require(file); } catch (e) { return null; } }
    return null;
  }
  function num(v) { if (v == null || v === '') return null; var n = Number(v); return Number.isFinite(n) ? n : null; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; });
  }
  function usd(v, cents) {
    var n = num(v); if (n == null) return '—';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  }
  function int(v) { var n = num(v); return n == null ? '—' : Math.round(n).toLocaleString('en-US'); }
  function x(v) { var n = num(v); return n == null ? '—' : n.toFixed(2) + 'x'; }

  function table(heads, rows) {
    return '<div class="op-scroll"><table class="op-table"><thead><tr>' + heads.map(function (h) {
      return '<th' + (h[1] ? ' class="op-left"' : '') + '>' + esc(h[0]) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function section(key, title, body, tab, linkText) {
    return '<div class="op-block" data-op="' + key + '"><div class="section-title">' + esc(title) +
      (tab ? ' <a class="op-link" data-op-tab="' + esc(tab) + '" href="#' + esc(tab) + '">' + esc(linkText) + ' →</a>' : '') + '</div>' + body + '</div>';
  }

  /* ------------------------------------------------------ whatnot shows */
  function whatnotHtml(doc, date) {
    var W = dep('WhatnotShows', './whatnot_shows_module.js');
    if (!W || !doc || !doc.by_date || !doc.by_date[date]) return '';
    var d = W.dayRows({ by_date: (function () { var o = {}; o[date] = doc.by_date[date]; return o; })() })[0];
    var body;
    if (d.status === 'no_shows') body = '<p class="op-note">No Whatnot shows this day.</p>';
    else if (!d.shows.length) {
      body = '<p class="op-note">Day total ' + usd(d.recorded) + '. <span class="op-warn">' + esc(d.note || 'no per-show rows') + '</span></p>';
    } else {
      var rows = d.shows.map(function (s) {
        return '<tr><td class="op-left">' + esc(s.start || '—') + '</td><td class="op-left">' + esc(s.title) + '</td><td>' + usd(s.revenue) + '</td><td>' + int(s.orders) +
          '</td><td>' + usd(s.perOrder, true) + '</td><td>' + int(s.buyers) + '</td><td>' + usd(s.promo) + '</td></tr>';
      });
      rows.push('<tr class="op-total"><td class="op-left" colspan="2">' + int(d.count) + (d.count === 1 ? ' show' : ' shows') + ' · ' + usd(d.perShow) + ' per show</td><td>' + usd(d.total) +
        '</td><td colspan="4"></td></tr>');
      body = table([['Start', 1], ['Show', 1], ['Revenue'], ['Orders'], ['Per order'], ['First-time buyers'], ['Promotion spend']], rows) +
        (d.note ? '<p class="op-note op-warn">' + esc(d.note) + (d.differsBy != null ? ' (recorded ' + usd(d.recorded) + ')' : '') + '</p>' : '') +
        '<p class="op-note">A dash under promotion spend means the feed does not carry it per show yet, not $0.</p>';
    }
    return section('whatnot', 'Whatnot shows', body, 'whatnot_shows', 'all shows');
  }

  /* --------------------------------------------------- meta by country */
  function intlHtml(feedDoc, registry, date) {
    var I = dep('IntlMeta', './intl_meta_module.js');
    if (!I || !feedDoc || !registry) return '';
    var feed = I.unwrapFeed(feedDoc) || feedDoc;
    if (!feed || feed.as_of !== date) return '';
    var status = feedDoc.status || feed.status;
    var rows = I.countryRows(I.unwrapRegistry ? (I.unwrapRegistry(registry) || registry) : registry, feed, false).map(function (r) {
      var sp = I.spendDisplay(r);
      var spend = esc(sp.amount || '—') + (sp.caption ? '<span class="op-sub">' + esc(sp.caption) + '</span>' : '') + (sp.badge ? '<span class="op-sub op-warn">' + esc(sp.badge) + '</span>' : '');
      return '<tr><td class="op-left">' + esc(r.flag ? r.flag + ' ' : '') + esc(r.label) + '</td><td>' + spend + '</td><td>' + usd(r.spend_7d) + '</td><td>' + usd(r.revenue_7d) +
        '</td><td>' + x(r.roas_7d) + '</td><td>' + usd(r.aov_7d, true) + '</td><td class="op-left">' + I.budgetChip(r.budget_call) + '</td></tr>';
    });
    var body = (I.renderStatus(status) || '') + (I.renderRecon(feed.reconciliation) || '') +
      (status === 'PENDING_INPUT' ? '<p class="op-note op-warn">Country spend has not been pulled yet (feed status PENDING_INPUT). Nothing below is measured.</p>' : '') +
      table([['Line', 1], ['Spend (1d)'], ['Spend 7d'], ['Revenue 7d'], ['ROAS 7d'], ['AOV (Shopify, ship-to)'], ['Budget call', 1]], rows) +
      '<p class="op-note">Revenue and ROAS are Meta platform-reported. These lines split the Meta total above; they are not added to D2C ad spend or MER.</p>';
    return section('intl', 'Meta by country', body, 'intl_meta', 'detail');
  }

  /* ------------------------------------------------------- budget calls */
  function callsHtml(brief, date) {
    if (!brief || brief.as_of !== date || !brief.channels) return '';
    var rows = Object.keys(brief.channels).map(function (k) {
      var c = brief.channels[k] || {};
      var blockers = Array.isArray(c.blockers) ? c.blockers : [];
      return '<tr' + (c.actionable ? '' : ' class="op-faded"') + '><td class="op-left">' + esc(c.label || k) + '<span class="op-sub">' + esc(c.mode || '') + '</span></td><td>' + usd(c.spend_7d) +
        '</td><td>' + x(c.roas_7d) + '<span class="op-sub">' + (num(c.roas_7d) == null || num(c.roas_days) == null ? '' : int(c.roas_days) + ' of 7 days') + '</span></td><td>' + x(c.roas_prior_7d) +
        '</td><td class="op-left">' + esc(c.rule_says || '—') + (blockers.length ? '<span class="op-sub">' + esc(blockers.join(', ')) + '</span>' : '') + '</td></tr>';
    });
    if (!rows.length) return '';
    var body = table([['Channel', 1], ['Spend 7d'], ['Platform ROAS 7d'], ['Prior 7d'], ['Rule says', 1]], rows) +
      '<p class="op-note">Platform-reported ROAS over the trailing 7 days. A faded row is what the rule would say for a channel that is blocked or not in auto mode. Advisory; nothing here changes a budget.</p>';
    return section('calls', 'Budget calls', body, 'loop', 'feeds & Grok loop');
  }

  /* ---------------------------------------------------------------- dom */
  var CSS = [
    '.op-scroll{overflow-x:auto}',
    '.op-table{width:100%;border-collapse:collapse;font-size:.78rem}',
    '.op-table th,.op-table td{padding:7px 8px;text-align:right;border-bottom:1px solid rgba(37,37,72,.6);vertical-align:top}',
    '.op-table th{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);white-space:nowrap}',
    '.op-table .op-left{text-align:left}',
    '.op-table tr.op-total td{font-weight:700;border-top:1px solid var(--border)}',
    '.op-table tr.op-faded td{opacity:.7}',
    '.op-sub{display:block;font-size:.64rem;color:var(--text-dim);margin-top:1px;font-weight:400}',
    '.op-note{font-size:.7rem;color:var(--text-muted);line-height:1.5;margin:8px 0 0}',
    '.op-warn{color:var(--yellow)}',
    '.op-link{font-size:.62rem;letter-spacing:.08em;color:var(--text-muted);margin-left:10px;text-decoration:none;font-weight:600}',
    '.op-link:hover{color:var(--cyan)}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('op-module-css')) return;
    var st = document.createElement('style'); st.id = 'op-module-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  /* Insert after the block that follows the section title starting with `title`. */
  function after(body, title) {
    var heads = body.querySelectorAll(':scope > .section-title');
    for (var i = 0; i < heads.length; i++) {
      if ((heads[i].textContent || '').trim().toUpperCase().indexOf(title) === 0) return heads[i].nextElementSibling || heads[i];
    }
    return null;
  }
  function place(body, anchor, html) {
    if (!html) return;
    var holder = document.createElement('div'); holder.innerHTML = html;
    var node = holder.firstChild;
    if (anchor && anchor.parentNode === body) body.insertBefore(node, anchor.nextSibling); else body.appendChild(node);
  }

  function decorate(card) {
    var date = card.getAttribute('data-date');
    var body = card.querySelector('.report-body');
    if (!date || !body) return;
    Array.prototype.forEach.call(body.querySelectorAll(':scope > .op-block'), function (n) { n.parentNode.removeChild(n); });
    var spendAnchor = after(body, 'AD SPEND BREAKDOWN') || after(body, 'AD SPEND PER CHANNEL');
    place(body, spendAnchor, callsHtml(STATE.brief, date));   // inserted first, ends up below intl
    place(body, spendAnchor, intlHtml(STATE.intl, STATE.registry, date));
    place(body, after(body, 'REVENUE PER CHANNEL'), whatnotHtml(STATE.shows, date));
  }

  function apply() {
    if (typeof document === 'undefined' || !STATE.loaded) return;
    var tab = document.getElementById('tab-reports');
    if (!tab) return;
    injectCss();
    Array.prototype.forEach.call(tab.querySelectorAll('.report-card[data-date]'), decorate);
  }

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; try { apply(); } catch (err) { if (root.console) root.console.error('[daily-onepage]', err); } }, 0);
  }
  function wrap() {
    var fn = root.renderReports;
    if (typeof fn !== 'function' || fn.__opWrapped) return;
    var wrapped = function () { var out = fn.apply(this, arguments); schedule(); return out; };
    wrapped.__opWrapped = true;
    for (var k in fn) if (Object.prototype.hasOwnProperty.call(fn, k)) wrapped[k] = fn[k];
    root.renderReports = wrapped;
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; });
  }
  function load() {
    return Promise.all([getJson(FEEDS.shows), getJson(FEEDS.intl), getJson(FEEDS.registry), getJson(FEEDS.brief)]).then(function (r) {
      STATE.shows = r[0]; STATE.intl = r[1]; STATE.registry = r[2]; STATE.brief = r[3]; STATE.loaded = true; return STATE;
    });
  }

  function boot() {
    wrap();
    document.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('[data-op-tab]') : null;
      if (!a) return;
      var btn = document.querySelector('.tabs .tab[data-tab="' + a.getAttribute('data-op-tab') + '"]');
      if (btn) { ev.preventDefault(); btn.click(); root.scrollTo(0, 0); }
    });
    load().then(schedule);
  }

  var api = { FEEDS: FEEDS, whatnotHtml: whatnotHtml, intlHtml: intlHtml, callsHtml: callsHtml, apply: apply, load: load, _state: STATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DailyOnePage = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 60); });
    else setTimeout(boot, 60);
  }
})(typeof window !== 'undefined' ? window : globalThis);
