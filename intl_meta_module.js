/* =====================================================================
   COLDEST · INTERNATIONAL META — one row per country Meta campaign
   ---------------------------------------------------------------------
   Reporting-only. Draws two feeds the data repo publishes
   (davidstarkk/coldest-cfo-dashboard → lib/publish_live_feeds.sh):

     ads_throttle/intl_meta.json            intl_meta.v1
     ads_throttle/intl_meta_registry.json   intl_meta_registry.v1

   Countries come from the registry in sort_order. Adding a country is one
   registry entry with no code change. Nothing is computed here: display_state,
   trend direction / delta, and budget_call are drawn as the feed wrote them.
   Lines are a breakdown of Meta and are never folded into D2C totals, MER,
   or any other tab.
   ===================================================================== */
(function (root) {
  'use strict';

  var FEEDS = { feed: 'ads_throttle/intl_meta.json', registry: 'ads_throttle/intl_meta_registry.json' };
  var EXAMPLE_FEEDS = {
    feed: 'scripts/fixtures/intl_meta.sample.json',
    registry: 'scripts/fixtures/intl_meta_registry.sample.json'
  };
  var TAB_KEY = 'intl_meta';
  var TAB_LABEL = 'INTERNATIONAL META';
  var HASH = '#intl_meta';
  var PLATFORM_ROAS = 'platform-reported (Meta)';
  var NOT_MER = 'This is platform-reported Meta ROAS, not MER.';

  /* Optional field names in one place so a producer rename is one edit. */
  var FIELDS = {
    displayName: 'display_name',
    shopifyRevenue7d: 'shopify_revenue_7d',
    shopifyOrders7d: 'shopify_orders_7d',
    aov7d: 'aov_7d',
    revenueGap7d: 'revenue_gap_7d',
    gapPct: 'gap_pct',
    contributionProfit7d: 'contribution_profit_7d',
    contributionProfitStatus: 'contribution_profit_status'
  };

  var ARROW = { up: '▲', flat: '▶', down: '▼', insufficient_data: '—' };
  var BUDGET = {
    RAISE_20: { text: 'Raise 20%', cls: 'im-good' },
    HOLD: { text: 'Hold', cls: 'im-warn' },
    CUT_20: { text: 'Cut 20%', cls: 'im-bad' },
    OFF: { text: 'Off', cls: 'im-muted' },
    INSUFFICIENT_DATA: { text: 'Not enough data', cls: 'im-muted' }
  };

  var STATE = { feed: null, registry: null, feedOk: false, registryOk: false, loaded: false, example: false };

  /* ------------------------------------------------------------ utils */
  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function usd(v, digits) {
    var n = num(v);
    if (n == null) return '—';
    var d = digits == null ? 0 : digits;
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function x(v) {
    var n = num(v);
    return n == null ? '—' : n.toFixed(2) + 'x';
  }
  function pct(v, signed) {
    var n = num(v);
    if (n == null) return '—';
    return (signed && n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function int(v) {
    var n = num(v);
    return n == null ? '—' : Math.round(n).toLocaleString('en-US');
  }
  function md(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? Number(m[2]) + '/' + Number(m[3]) : '—';
  }
  function pick(obj, fieldKey) {
    if (!obj) return undefined;
    var name = FIELDS[fieldKey] || fieldKey;
    return obj[name];
  }
  function exampleRequested() {
    try {
      if (typeof location === 'undefined' || !location.search) return false;
      return new URLSearchParams(location.search).get('im_example') === '1';
    } catch (e) { return false; }
  }

  /* ------------------------------------------------------------ unwrap */
  function unwrapFeed(doc) {
    if (!doc || typeof doc !== 'object') return null;
    if (doc.intl_meta && typeof doc.intl_meta === 'object') return doc.intl_meta;
    if (doc.schema_version || doc.countries) return doc;
    return null;
  }
  function unwrapRegistry(doc) {
    if (!doc || typeof doc !== 'object') return null;
    if (Array.isArray(doc.countries) || (doc.domestic && doc.domestic.code)) return doc;
    if (doc.intl_meta_registry && (Array.isArray(doc.intl_meta_registry.countries) || doc.intl_meta_registry.domestic)) {
      return doc.intl_meta_registry;
    }
    return null;
  }

  /* Residual US comes from registry.domestic (not countries[]). Display
     order matches producer daily_report: US first, then sort_order. */
  function registryEntries(registry) {
    var list = ((registry && registry.countries) || []).slice();
    var domestic = registry && registry.domestic;
    if (domestic && domestic.code && !list.some(function (e) { return e && e.code === domestic.code; })) {
      list = [Object.assign({ residual: true, status: domestic.status || 'on' }, domestic)].concat(list);
    }
    return list.sort(function (a, b) {
      var ar = !!(a && a.residual) || !!(domestic && a && a.code === domestic.code);
      var br = !!(b && b.residual) || !!(domestic && b && b.code === domestic.code);
      if (ar && !br) return -1;
      if (!ar && br) return 1;
      var ao = num(a && a.sort_order), bo = num(b && b.sort_order);
      if (ao == null && bo == null) return 0;
      if (ao == null) return 1;
      if (bo == null) return -1;
      return ao - bo;
    });
  }

  function countryLabel(entry, raw) {
    var fromFeed = raw && pick(raw, 'displayName');
    if (fromFeed) return String(fromFeed);
    if (entry && entry.display_name) return String(entry.display_name);
    if (raw && raw.name) return String(raw.name);
    if (entry && entry.name) return String(entry.name);
    return (entry && entry.code) || '';
  }

  function pendingRow(entry) {
    return {
      code: entry.code,
      name: entry.name || entry.code,
      label: countryLabel(entry, null),
      flag: entry.flag || '',
      status: entry.status || 'on',
      display_state: 'pending_backfill',
      display_amount: null,
      measured_spend: null,
      last_confirmed_date: null,
      last_confirmed_amount: null,
      spend_1d: null, spend_7d: null, revenue_7d: null, purchases_7d: null,
      cpp_7d: null, roas_7d: null,
      revenue_source: null,
      shopify_revenue_7d: null, shopify_orders_7d: null, aov_7d: null,
      revenue_gap_7d: null, gap_pct: null,
      contribution_profit_7d: null, contribution_profit_status: null,
      residual: !!entry.residual,
      trend: null, budget_call: null, notes: [],
      fromFeed: false
    };
  }

  function normalizeCountry(entry, raw) {
    var t = raw.trend && typeof raw.trend === 'object' ? raw.trend : null;
    var b = raw.budget_call && typeof raw.budget_call === 'object' ? raw.budget_call : null;
    return {
      code: entry.code,
      name: raw.name || entry.name || entry.code,
      label: countryLabel(entry, raw),
      flag: raw.flag || entry.flag || '',
      status: raw.status || entry.status || 'on',
      display_state: raw.display_state || 'pending_backfill',
      display_amount: num(raw.display_amount),
      measured_spend: num(raw.measured_spend),
      last_confirmed_date: raw.last_confirmed_date || null,
      last_confirmed_amount: num(raw.last_confirmed_amount),
      spend_1d: num(raw.spend_1d),
      spend_7d: num(raw.spend_7d),
      revenue_7d: num(raw.revenue_7d),
      purchases_7d: num(raw.purchases_7d),
      cpp_7d: num(raw.cpp_7d),
      roas_7d: num(raw.roas_7d),
      revenue_source: raw.revenue_source || null,
      shopify_revenue_7d: pick(raw, 'shopifyRevenue7d'),
      shopify_orders_7d: pick(raw, 'shopifyOrders7d'),
      aov_7d: pick(raw, 'aov7d'),
      revenue_gap_7d: pick(raw, 'revenueGap7d'),
      gap_pct: pick(raw, 'gapPct'),
      contribution_profit_7d: pick(raw, 'contributionProfit7d'),
      contribution_profit_status: pick(raw, 'contributionProfitStatus'),
      residual: !!raw.residual,
      trend: t, budget_call: b, notes: Array.isArray(raw.notes) ? raw.notes : [],
      fromFeed: true
    };
  }

  /* Registry order. A country in the registry but absent from the feed
     (or a failed feed) is pending_backfill with no amount. */
  function countryRows(registry, feed, feedFailed) {
    var entries = registryEntries(registry);
    var countries = (!feedFailed && feed && feed.countries && typeof feed.countries === 'object') ? feed.countries : {};
    return entries.map(function (entry) {
      if (!entry || !entry.code) return null;
      if (feedFailed || !Object.prototype.hasOwnProperty.call(countries, entry.code) || !countries[entry.code]) {
        return pendingRow(entry);
      }
      return normalizeCountry(entry, countries[entry.code]);
    }).filter(Boolean);
  }

  /* Day-card spend. display_state is taken from the feed, never computed. */
  function spendDisplay(row) {
    var state = row && row.display_state;
    if (state === 'off') return { amount: '$0', caption: 'Channel off', badge: null, measured: false };
    if (state === 'zero') return { amount: '$0', caption: null, badge: null, measured: true };
    if (state === 'spend') return { amount: usd(row.display_amount), caption: null, badge: null, measured: true };
    if (state === 'pending_backfill') {
      var amt = row.last_confirmed_amount;
      return {
        amount: amt == null ? '' : usd(amt),
        caption: null,
        badge: 'pending backfill',
        measured: false
      };
    }
    return { amount: '', caption: null, badge: null, measured: false };
  }

  function trendArrow(trend) {
    if (!trend) return '—';
    if (trend.arrow) return String(trend.arrow);
    return ARROW[trend.direction] || '—';
  }

  function trendHtml(trend) {
    if (!trend || trend.direction === 'insufficient_data') {
      return '<span class="im-trend im-muted">Not enough data</span>';
    }
    var dir = trend.direction || '';
    var cls = dir === 'up' ? 'im-good' : dir === 'down' ? 'im-bad' : 'im-muted';
    var delta = pct(trend.delta_pct, true);
    return '<span class="im-trend ' + cls + '">' + esc(trendArrow(trend)) + ' ' + esc(dir) + (delta !== '—' ? ' ' + esc(delta) : '') + '</span>';
  }

  /* Advisory chip only — never a <button> or anything actionable. */
  function budgetChip(call) {
    if (!call) return '';
    var meta = BUDGET[call.action] || { text: String(call.action || ''), cls: 'im-muted' };
    var h = '<span class="im-chip im-advisory ' + meta.cls + '">' + esc(meta.text) + ' · advisory</span>';
    if (call.reason) h += '<span class="im-reason">' + esc(call.reason) + '</span>';
    if (call.cooldown_until) h += '<span class="im-cooldown">cooldown until ' + esc(md(call.cooldown_until)) + '</span>';
    return h;
  }

  function shopifyBlock(row) {
    if (!row || row.fromFeed === false) return '';
    var rev = row.shopify_revenue_7d, orders = row.shopify_orders_7d, gap = row.revenue_gap_7d, gp = row.gap_pct;
    if (rev === undefined && orders === undefined && gap === undefined && gp === undefined) return '';
    var pendingNote = (row.notes && row.notes.length) ? row.notes.join('; ') : 'pending';
    function cell(v, kind) {
      if (v == null || v === '') return '<span class="im-dash">—</span> <span class="im-pending">' + esc(pendingNote) + '</span>';
      if (kind === 'usd') return esc(usd(v));
      if (kind === 'pct') return esc(pct(v, true));
      if (kind === 'int') return esc(int(v));
      return esc(String(v));
    }
    return '<div class="im-shop">' +
      '<div class="im-l">Shopify revenue 7d (ship-to)</div><div class="im-s">' + cell(rev, 'usd') + '</div>' +
      '<div class="im-l">Shopify orders 7d</div><div class="im-s">' + cell(orders, 'int') + '</div>' +
      '<div class="im-l">Gap vs Meta 7d</div><div class="im-s">' + cell(gap, 'usd') + (gp == null || gp === '' ? '' : ' · ' + cell(gp, 'pct')) + '</div>' +
      '</div>';
  }

  function contributionTxt(row) {
    var v = row.contribution_profit_7d;
    var st = row.contribution_profit_status;
    if (v == null || v === '') {
      if (st === 'pending_landed_costs') return 'pending landed costs';
      return null;
    }
    if (typeof v === 'string') return v;
    var n = num(v);
    return n == null ? String(v) : usd(v);
  }

  function notesHtml(notes) {
    if (!notes || !notes.length) return '';
    return '<p class="im-info">' + notes.map(function (n) { return esc(n); }).join(' · ') + '</p>';
  }

  /* ------------------------------------------------------------ css */
  var CSS = [
    '#tab-intl_meta{max-width:1400px;margin:0 auto}',
    '.im-head{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:baseline;margin-bottom:12px}',
    '.im-head h2{font-size:1.05rem;letter-spacing:.08em;text-transform:uppercase;margin:0}',
    '.im-sub{color:var(--text-muted);font-size:.78rem}',
    '.im-example{color:var(--yellow);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;font-weight:700}',
    '.im-banner{border:1px solid var(--yellow);color:var(--yellow);background:rgba(245,158,11,.08);border-radius:8px;padding:10px 14px;font-size:.78rem;margin:0 0 14px}',
    '.im-banner-fail{border-color:var(--red);color:var(--red);background:rgba(239,68,68,.08)}',
    '.im-recon-ok{font-size:.72rem;color:var(--text-dim);margin:0 0 12px}',
    '.im-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin:0 0 14px}',
    '.im-card h3{font-size:.8rem;margin:0 0 10px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-weight:600}',
    '.im-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}',
    '.im-kpi{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px}',
    '.im-kpi .im-v{font-family:var(--font-mono);font-size:1.15rem;font-weight:700}',
    '.im-kpi .im-l{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);margin-top:2px}',
    '.im-kpi .im-s{font-size:.66rem;color:var(--text-muted);margin-top:3px}',
    '.im-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}',
    '.im-row{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px;border-top:3px solid var(--border)}',
    '.im-row h3{font-size:.9rem;margin:0 0 8px;display:flex;align-items:center;flex-wrap:wrap;gap:6px}',
    '.im-nums{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:8px 0}',
    '.im-nums .im-l{font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)}',
    '.im-nums .im-v{font-family:var(--font-mono);font-size:1rem;font-weight:700}',
    '.im-nums .im-s{font-size:.66rem;color:var(--text-muted)}',
    '.im-pill{display:inline-block;padding:1px 8px;border:1px solid currentColor;border-radius:999px;font-size:.58rem;font-weight:700;letter-spacing:.06em;white-space:nowrap}',
    '.im-chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.64rem;font-weight:700;letter-spacing:.06em;border:1px solid currentColor;white-space:nowrap}',
    '.im-advisory{cursor:default}',
    '.im-reason,.im-cooldown{display:block;font-size:.66rem;color:var(--text-muted);margin-top:4px}',
    '.im-info{font-size:.72rem;color:var(--text-muted);line-height:1.45;margin:8px 0 0}',
    '.im-pending{color:var(--yellow);font-size:.66rem}',
    '.im-dash{color:var(--text-dim)}',
    '.im-shop{margin-top:8px;font-size:.7rem;color:var(--text-muted);display:grid;grid-template-columns:auto 1fr;gap:2px 10px}',
    '.im-shop .im-l{font-size:.58rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)}',
    '.im-empty{font-size:.78rem;color:var(--text-muted);margin:0}',
    '.im-src{font-size:.66rem;color:var(--text-dim);margin-top:8px;line-height:1.4}',
    '.im-good{color:var(--green)}.im-bad{color:var(--red)}.im-warn{color:var(--yellow)}.im-muted{color:var(--text-muted)}',
    '@media (max-width:600px){.im-nums{grid-template-columns:1fr 1fr}}'
  ].join('\n');

  function injectCss() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('im-module-css')) return;
    var st = document.createElement('style');
    st.id = 'im-module-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------ render */
  function pill(text, cls) {
    return '<span class="im-pill ' + cls + '">' + esc(text) + '</span>';
  }
  function box(v, l, s) {
    return '<div class="im-kpi"><div class="im-v">' + v + '</div><div class="im-l">' + esc(l) + '</div>' + (s ? '<div class="im-s">' + s + '</div>' : '') + '</div>';
  }

  function renderStatus(status) {
    if (status !== 'RECONCILIATION_FAILED') return '';
    return '<div class="im-banner im-banner-fail" data-im-status="RECONCILIATION_FAILED">' +
      'RECONCILIATION_FAILED — International Meta lines do not reconcile to Meta account act_24723036. Flagged, never shown as clean numbers.</div>';
  }

  function renderRecon(rec) {
    if (!rec || typeof rec !== 'object') return '';
    if (rec.ok === false) {
      var ids = Array.isArray(rec.duplicate_campaign_ids) ? rec.duplicate_campaign_ids : [];
      var bits = ['Reconciliation warning'];
      if (rec.delta != null) bits.push('delta ' + usd(rec.delta, 2));
      if (ids.length) bits.push('duplicate campaign IDs: ' + ids.join(', '));
      return '<div class="im-banner" data-im-recon="fail">' + esc(bits.join(' · ')) + '</div>';
    }
    if (rec.ok === true) {
      return '<p class="im-recon-ok">reconciled ' + esc(md(rec.date)) + '</p>';
    }
    return '';
  }

  function renderCountry(row) {
    var sp = spendDisplay(row);
    var off = sp.caption ? pill(sp.caption, 'im-muted') : '';
    var badge = sp.badge ? pill(sp.badge, 'im-warn') : '';
    var contrib = contributionTxt(row);
    var h = '<article class="im-row" data-im-code="' + esc(row.code) + '" data-im-state="' + esc(row.display_state) + '"' +
      (row.residual ? ' data-im-residual="1"' : '') + '>';
    h += '<h3>' + esc(row.flag ? row.flag + ' ' : '') + esc(row.label) + off + badge + '</h3>';
    h += '<div class="im-nums">';
    h += '<div><div class="im-l">Spend (1d)</div><div class="im-v">' + (sp.amount === '' ? '' : esc(sp.amount)) + '</div>' +
      (sp.caption ? '<div class="im-s">' + esc(sp.caption) + '</div>' : '') + '</div>';
    h += '<div><div class="im-l">Spend 7d</div><div class="im-v">' + esc(row.display_state === 'pending_backfill' && row.spend_7d == null ? '' : usd(row.spend_7d)) + '</div></div>';
    h += '<div><div class="im-l">Revenue 7d</div><div class="im-v">' + esc(usd(row.revenue_7d)) + '</div><div class="im-s">' + esc(PLATFORM_ROAS) + '</div></div>';
    h += '<div><div class="im-l">ROAS 7d</div><div class="im-v">' + esc(x(row.roas_7d)) + '</div><div class="im-s">' + esc(PLATFORM_ROAS) + '</div></div>';
    h += '<div><div class="im-l">CPP 7d</div><div class="im-v">' + esc(row.cpp_7d == null ? '—' : usd(row.cpp_7d, 2)) + '</div></div>';
    h += '<div><div class="im-l">Purchases 7d</div><div class="im-v">' + esc(int(row.purchases_7d)) + '</div></div>';
    h += '<div><div class="im-l">AOV (Shopify, ship-to)</div><div class="im-v">' + esc(usd(row.aov_7d, 2)) + '</div></div>';
    h += '</div>';
    h += '<div>' + trendHtml(row.trend) + '</div>';
    h += '<div style="margin-top:8px">' + budgetChip(row.budget_call) + '</div>';
    if (contrib) h += '<p class="im-info">Contribution profit 7d: ' + esc(contrib) + '</p>';
    h += shopifyBlock(row);
    h += notesHtml(row.notes);
    h += '</article>';
    return h;
  }

  function renderTotals(feed) {
    var t = (feed && feed.totals) || {};
    return '<div class="im-card" data-im-totals="1"><h3>Meta (breakdown)</h3>' +
      '<p class="im-sub">' + esc(t.note || 'Feed totals only — not added to D2C ad spend or MER.') + '</p>' +
      '<div class="im-kpis">' +
      box(esc(usd(t.spend_1d)), '1d spend', 'USD') +
      box(esc(usd(t.spend_7d)), '7d spend', 'USD') +
      '</div></div>';
  }

  function renderUnavailable() {
    return '<div class="im-card"><h3>International Meta</h3>' +
      '<p class="im-empty">This tab is unavailable: ' + esc(FEEDS.registry) +
      ' did not load. Other tabs are unaffected.</p></div>';
  }

  function renderPanel(registry, feedDoc, opts) {
    opts = opts || {};
    if (!registry) return renderUnavailable();
    var feed = unwrapFeed(feedDoc) || feedDoc;
    var status = (feedDoc && feedDoc.status) || (feed && feed.status);
    var rows = countryRows(registry, feed, !!opts.feedFailed);
    var asOf = feed && !opts.feedFailed ? feed.as_of : null;
    var computed = feed && !opts.feedFailed ? feed.computed_at : null;
    var h = '';
    if (opts.example) h += '<div class="im-example">EXAMPLE DATA</div>';
    h += '<div class="im-head"><h2>International Meta</h2>';
    h += '<span class="im-sub">as of ' + esc(asOf ? md(asOf) : '—') +
      (computed ? ' · computed ' + esc(String(computed).replace('T', ' ').replace('Z', ' UTC')) : '') +
      ' · USD</span></div>';
    if (feed && !opts.feedFailed) h += renderStatus(status);
    if (feed && !opts.feedFailed) h += renderRecon(feed.reconciliation);
    if (feed && !opts.feedFailed) h += renderTotals(feed);
    else h += '<div class="im-card" data-im-totals="1"><h3>Meta (breakdown)</h3><p class="im-sub">Totals pending backfill.</p></div>';
    h += '<div class="im-grid">' + rows.map(renderCountry).join('') + '</div>';
    h += '<p class="im-src">' + esc(PLATFORM_ROAS) + '. ' + esc(NOT_MER) +
      ' Registry-driven: a new country is one entry in ' + esc(FEEDS.registry) + '.</p>';
    return h;
  }

  function render() {
    var panel = typeof document !== 'undefined' ? document.getElementById('tab-' + TAB_KEY) : null;
    if (!panel) return;
    if (!STATE.loaded) { panel.innerHTML = '<div class="im-card"><p class="im-empty">Loading…</p></div>'; return; }
    if (!STATE.registryOk || !STATE.registry) { panel.innerHTML = renderUnavailable(); return; }
    panel.innerHTML = renderPanel(STATE.registry, STATE.feed, { feedFailed: !STATE.feedOk, example: STATE.example });
  }

  function ensureTab() {
    if (typeof document === 'undefined') return null;
    var panel = document.getElementById('tab-' + TAB_KEY);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'tab-' + TAB_KEY;
      panel.className = 'tab-content';
      var reports = document.getElementById('tab-reports');
      if (reports && reports.parentNode) reports.parentNode.appendChild(panel);
      else document.body.appendChild(panel);
    }
    var btn = document.querySelector('.tab[data-tab="' + TAB_KEY + '"]');
    if (!btn) {
      var anchor = document.querySelector('.tab[data-tab="whatnot_shows"]')
        || document.querySelector('.tab[data-tab="growth"]')
        || document.querySelector('.tab[data-tab="ad_channels"]')
        || document.querySelector('.tab[data-tab="reports"]');
      if (anchor && anchor.parentNode) {
        btn = document.createElement('div');
        btn.className = 'tab';
        btn.setAttribute('data-tab', TAB_KEY);
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      }
    }
    if (btn) btn.textContent = TAB_LABEL;
    if (btn && !btn._imBound) {
      btn._imBound = true;
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
        document.body.classList.remove('reports-active');
        btn.classList.add('active');
        panel.classList.add('active');
        if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, null, HASH);
        render();
      });
    }
    return panel;
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) return { ok: false, status: res.status, doc: null };
      return res.json().then(function (doc) { return { ok: true, status: res.status, doc: doc }; });
    }).catch(function () { return { ok: false, status: 0, doc: null }; });
  }

  function load() {
    var example = exampleRequested();
    var paths = example ? EXAMPLE_FEEDS : FEEDS;
    return Promise.all([getJson(paths.feed), getJson(paths.registry)]).then(function (pair) {
      var feedRes = pair[0], regRes = pair[1];
      STATE.example = example;
      STATE.registryOk = !!(regRes && regRes.ok);
      STATE.registry = STATE.registryOk ? unwrapRegistry(regRes.doc) : null;
      if (!STATE.registry) STATE.registryOk = false;
      STATE.feedOk = !!(feedRes && feedRes.ok);
      STATE.feed = STATE.feedOk ? unwrapFeed(feedRes.doc) : null;
      if (!STATE.feed) STATE.feedOk = false;
      STATE.loaded = true;
      return STATE;
    });
  }

  function boot() {
    injectCss();
    var panel = ensureTab();
    load().then(function () { if (panel && panel.classList.contains('active')) render(); });
    var hsh = typeof location !== 'undefined' ? location.hash : '';
    if (hsh === HASH || hsh === '#international-meta') {
      var btn = document.querySelector('.tab[data-tab="' + TAB_KEY + '"]');
      if (btn) btn.click();
    }
  }

  var api = {
    FEEDS: FEEDS, EXAMPLE_FEEDS: EXAMPLE_FEEDS, FIELDS: FIELDS, TAB_KEY: TAB_KEY, HASH: HASH,
    unwrapFeed: unwrapFeed, unwrapRegistry: unwrapRegistry, registryEntries: registryEntries,
    countryRows: countryRows, countryLabel: countryLabel, spendDisplay: spendDisplay,
    trendArrow: trendArrow, trendHtml: trendHtml, budgetChip: budgetChip,
    contributionTxt: contributionTxt, shopifyBlock: shopifyBlock,
    renderStatus: renderStatus, renderRecon: renderRecon, renderCountry: renderCountry, renderTotals: renderTotals,
    renderPanel: renderPanel, renderUnavailable: renderUnavailable, render: render, load: load,
    _state: STATE, _fmt: { usd: usd, x: x, pct: pct, num: num }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.IntlMeta = api;

  if (typeof document !== 'undefined') {
    // After whatnot_shows_module.js has inserted its tab.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 50); });
    else setTimeout(boot, 50);
  }
})(typeof window !== 'undefined' ? window : globalThis);
