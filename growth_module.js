/* =====================================================================
   COLDEST · GROWTH — what Grok needs beyond the 7-day ROAS rule
   ---------------------------------------------------------------------
   Reporting-only. Draws one feed the data repo rebuilds every morning
   (davidstarkk/coldest-cfo-dashboard, cfo_backend/growth_loop.py →
   lib/publish_live_feeds.sh):

     ads_throttle/growth_brief.json   governor, marginal ROAS, new-customer
         CAC, cohort payback, holdout tests, media-mix history, total-company
         MER, product margin + stock, creative engine, pacing, autonomy

   Nothing is computed here: no ROAS, no CAC, no ordering, no verdict. Each
   block carries its own status; when it is not readable the tab says why
   and shows no number. Contract: docs/GROK_LOOP.md in the data repo.
   ===================================================================== */
(function (root) {
  'use strict';

  var FEED = 'ads_throttle/growth_brief.json';
  var STATUS = {
    ok: null, partial: 'Partial window', sufficient: null,
    insufficient_data: 'Not enough data yet', no_feed: 'Feed not pulled yet', no_tests: 'No test approved yet', stale: 'Feed is old'
  };
  var READ = {
    added_spend_lost_revenue: ['More spend, no more revenue', 'gr-bad'],
    cut_spend_kept_revenue: ['Less spend, revenue held', 'gr-good'],
    added_spend: ['Spend rose', 'gr-muted'], cut_spend: ['Spend fell', 'gr-muted'],
    flat_spend: ['Spend flat', 'gr-muted'], insufficient: ['No read', 'gr-muted']
  };
  var SUGGEST = {
    keep_auto: ['Keep auto', 'gr-good'], ready_for_auto: ['Ready for auto', 'gr-good'],
    review_auto: ['Auto, checks failing', 'gr-warn'], not_yet: ['Not yet', 'gr-muted']
  };
  var CHECK = {
    feed_14_of_14: 'row every day for 14 days', full_7d_read: 'full 7-day platform read', tracking_ok: 'tracking OK',
    no_dispute: 'CFO and Grok agree', budget_known: 'daily budget written', two_measured_changes: 'two measured changes',
    changes_not_mostly_worse: 'changes not mostly worse'
  };

  /* ------------------------------------------------------------ utils */
  function num(v) { if (v == null || v === '') return null; var n = Number(v); return Number.isFinite(n) ? n : null; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function usd(v, cents) {
    var n = num(v); if (n == null) return '—';
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  }
  function big(v) {
    var n = num(v); if (n == null) return '—';
    return n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : usd(n);
  }
  function x(v) { var n = num(v); return n == null ? '—' : n.toFixed(2) + 'x'; }
  function pct(v, signed) { var n = num(v); return n == null ? '—' : (signed && n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function int(v) { var n = num(v); return n == null ? '—' : Math.round(n).toLocaleString('en-US'); }
  function md(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? Number(m[2]) + '/' + Number(m[3]) : '—'; }
  function win(w) { var p = String(w || '').split('..'); return p.length === 2 ? md(p[0]) + '–' + md(p[1]) : '—'; }
  function statusNote(block) {
    if (!block) return 'Not in this feed.';
    var text = STATUS[block.status];
    if (text === null) return null;
    return (text || String(block.status || 'Not readable')) + (block.why ? ' — ' + block.why : '');
  }

  /* ------------------------------------------------------------ pure: feed → rows (no arithmetic) */
  function headline(doc) {
    var h = (doc && doc.headline) || {};
    return {
      asOf: (doc && doc.as_of) || null, mer: num(h.mer_7d), target: num(h.mer_target), totalMer: num(h.total_mer_7d),
      breakeven: num(h.breakeven_mer_before_overhead), stance: h.stance || null, conflict: h.rule_conflict === true,
      giveBack: h.first_to_give_back || [], ncac: num(h.blended_ncac), firstOrder: num(h.first_order_value),
      newShare: num(h.new_share_of_net_sales_pct), m2: num(h.revenue_per_customer_m2), paidBackBy: h.paid_back_by || null,
      margin: num(h.contribution_margin_pct), lowStock: h.low_stock || [], runRate: num(h.annual_run_rate),
      multiple: num(h.multiple_to_target), historyDays: num(h.usable_history_days), testsRunning: num(h.tests_running) || 0
    };
  }

  function governorRows(doc) {
    var g = (doc && doc.governor) || {};
    var rows = (g.give_back_order && g.give_back_order.length ? g.give_back_order : g.add_order) || [];
    return rows.map(function (r, i) {
      return { rank: i + 1, channel: r.channel, label: r.label || r.channel, spend: num(r.spend_7d), share: num(r.share_of_spend_pct),
        roas: num(r.roas_7d), marginal: num(r.marginal_roas), rankedOn: r.ranked_on, verdict: r.rule_verdict, mode: r.mode, who: r.who_can_act };
    });
  }

  function marginalRows(doc) {
    var ch = ((doc && doc.marginal) || {}).channels || {};
    return Object.keys(ch).map(function (id) {
      var r = ch[id], read = READ[r.read] || READ.insufficient;
      return { channel: id, label: r.label || id, spendPrior: num(r.spend_prior), spend: num(r.spend), spendPct: num(r.spend_change_pct),
        revenueChange: num(r.revenue_change), roas: num(r.roas), roasPrior: num(r.roas_prior), marginal: num(r.marginal_roas),
        readText: read[0], readCls: read[1], why: r.why || '' };
    }).sort(function (a, b) { return (b.spend || 0) - (a.spend || 0); });
  }

  function paybackRows(doc) {
    var p = ((doc && doc.ltv_payback) || {}).payback;
    return ((p && p.steps) || []).map(function (s) {
      return { horizon: s.horizon, revenue: num(s.revenue_per_customer), contribution: num(s.contribution_per_customer), toCac: num(s.contribution_to_cac) };
    });
  }

  function productRows(doc) {
    return (((doc && doc.margin_inventory) || {}).products || []).map(function (p) {
      return { title: p.title, units: num(p.units), revenue: num(p.revenue), share: num(p.revenue_share_pct), margin: num(p.contribution_margin_pct),
        breakeven: num(p.breakeven_roas), stockDays: num(p.days_of_stock), flag: p.stock_flag || null,
        estimated: (p.cost_basis || []).indexOf('fallback') !== -1 };
    });
  }

  function autonomyRows(doc) {
    var ch = ((doc && doc.autonomy) || {}).channels || {};
    return Object.keys(ch).map(function (id) {
      var r = ch[id], s = SUGGEST[r.suggestion] || SUGGEST.not_yet;
      return { channel: id, label: r.label || id, mode: r.mode, spend: num(r.spend_7d), score: r.score, text: s[0], cls: s[1],
        failing: (r.failing || []).map(function (f) { return CHECK[f] || f; }) };
    }).sort(function (a, b) { return (b.spend || 0) - (a.spend || 0); });
  }

  function askRows(doc) {
    var order = { high: 0, medium: 1, low: 2 };
    return ((doc && doc.asks) || []).map(function (a) {
      var ack = a.ack && a.ack.status ? a.ack.status : null;
      return { id: a.id, severity: a.severity, title: a.title, detail: a.detail, owner: a.owner, age: num(a.age_days), ack: ack,
        closed: ack === 'done' || ack === 'wont_do' };
    }).sort(function (a, b) { return (a.closed - b.closed) || (order[a.severity] - order[b.severity]); });
  }

  /* ------------------------------------------------------------ css */
  var CSS = [
    '.gr-card{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin:0 0 14px}',
    '.gr-card h3{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim);margin:0 0 10px;font-weight:600}',
    '.gr-note{font-size:.72rem;color:var(--text-muted);line-height:1.5;margin:0 0 10px;max-width:980px}',
    '.gr-empty{font-size:.76rem;color:var(--text-muted);margin:0}',
    '.gr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
    '.gr-kpi{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px}',
    '.gr-kpi .gr-v{font-size:1.25rem;font-weight:700}.gr-kpi .gr-l{font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);margin-top:2px}',
    '.gr-kpi .gr-s{font-size:.68rem;color:var(--text-muted);margin-top:3px}',
    '.gr-scroll{overflow-x:auto}',
    '.gr-table{width:100%;border-collapse:collapse;font-size:.76rem}',
    '.gr-table th,.gr-table td{padding:7px 8px;text-align:right;border-bottom:1px solid rgba(37,37,72,.6);vertical-align:middle}',
    '.gr-table th{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);white-space:nowrap}',
    '.gr-table td:first-child,.gr-table th:first-child,.gr-table .gr-left{text-align:left}',
    '.gr-sub{display:block;font-size:.64rem;color:var(--text-dim);margin-top:1px}',
    '.gr-why{font-size:.68rem;color:var(--text-muted);white-space:normal;min-width:150px}',
    '.gr-pill{display:inline-block;font-size:.62rem;font-weight:600;letter-spacing:.05em;padding:2px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}',
    '.gr-good{color:var(--green)}.gr-bad{color:var(--red)}.gr-warn{color:var(--yellow)}.gr-muted{color:var(--text-dim)}',
    '.gr-ask{border-left:3px solid var(--border);padding:6px 0 6px 12px;margin:0 0 10px}',
    '.gr-ask.gr-medium{border-left-color:var(--yellow)}.gr-ask.gr-closed{opacity:.55}',
    '.gr-ask b{font-size:.8rem;font-weight:600}.gr-ask p{font-size:.72rem;color:var(--text-muted);line-height:1.5;margin:3px 0 0;max-width:980px}',
    '.gr-ask .gr-meta{font-size:.64rem;color:var(--text-dim);margin-top:3px;font-family:var(--font-mono)}',
    '.gr-src{font-size:.66rem;color:var(--text-dim);margin-top:8px;line-height:1.4;max-width:980px}',
    '@media (max-width:600px){.gr-table{font-size:.68rem}}'
  ].join('\n');

  var STATE = { doc: null, loaded: false };

  function injectCss() {
    if (document.getElementById('gr-module-css')) return;
    var st = document.createElement('style'); st.id = 'gr-module-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  /* ------------------------------------------------------------ render */
  function pill(text, cls) { return '<span class="gr-pill ' + cls + '">' + esc(text) + '</span>'; }
  function box(v, l, s) { return '<div class="gr-kpi"><div class="gr-v">' + v + '</div><div class="gr-l">' + esc(l) + '</div>' + (s ? '<div class="gr-s">' + s + '</div>' : '') + '</div>'; }
  function card(title, body, src) { return '<div class="gr-card"><h3>' + esc(title) + '</h3>' + body + (src ? '<p class="gr-src">' + esc(src) + '</p>' : '') + '</div>'; }
  function silent(title, block) { return card(title, '<p class="gr-empty">' + esc(statusNote(block)) + '</p>'); }
  function table(heads, rows) {
    return '<div class="gr-scroll"><table class="gr-table"><thead><tr>' + heads.map(function (h) {
      return '<th' + (h[1] ? ' class="gr-left"' : '') + '>' + esc(h[0]) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  function renderHeadline(k) {
    return '<div class="gr-card"><h3>Data through ' + esc(md(k.asOf)) + '</h3><div class="gr-kpis">' +
      box(x(k.mer), 'Shopify D2C MER, 7d', 'target ' + x(k.target) + ' · break-even ' + x(k.breakeven)) +
      box(x(k.totalMer), 'Total-company MER, 7d', 'Shopify + Amazon + TikTok Shop + Whatnot') +
      box(usd(k.ncac), 'New-customer CAC', 'first order ' + usd(k.firstOrder) + ' · blended') +
      box(pct(k.newShare), 'Net sales from new customers', 'the rest is returning customers') +
      box(k.paidBackBy ? esc(k.paidBackBy) : (k.ncac == null ? '—' : 'Not yet'), 'CAC paid back by', '90-day revenue per customer ' + usd(k.m2)) +
      box(big(k.runRate), 'Annual run-rate', k.multiple == null ? 'no target set' : k.multiple.toFixed(2) + 'x to reach the target') +
      box(k.lowStock.length ? pill(k.lowStock.length + ' low', 'gr-bad') : pill('OK', 'gr-good'), 'Stock on selling products', k.lowStock.length ? esc(k.lowStock.join(', ')) : 'none under the floor') +
      '</div></div>';
  }

  function renderGovernor(doc) {
    var g = doc.governor;
    if (!g || g.status !== 'ok') return silent('Portfolio governor', g);
    var rows = governorRows(doc), giving = g.stance === 'give_back';
    var intro = giving
      ? 'Shopify D2C MER ' + x(g.mer_7d) + ' is under the ' + x(g.mer_target) + ' target. ' + pct(g.spend_reading_hold_or_raise_pct) + ' of spend reads hold or raise under the channel rule. Order below: first to give spend back.'
      : 'Shopify D2C MER ' + x(g.mer_7d) + ' is at or above the ' + x(g.mer_target) + ' target. Order below: first to take more spend.';
    var body = '<p class="gr-note">' + esc(intro) + ' ' + esc(g.adopted ? 'Adopted by David.' : 'Advisory until David adopts it; no channel verdict changes.') + '</p>' +
      (rows.length ? table([['#', 1], ['Channel', 1], ['7d spend'], ['Share'], ['7d ROAS'], ['Last added $ returned'], ['Rule says', 1], ['Who can act', 1]], rows.map(function (r) {
        return '<tr><td>' + r.rank + '</td><td class="gr-left">' + esc(r.label) + '<span class="gr-sub">' + esc(r.mode) + '</span></td><td>' + usd(r.spend) + '</td><td>' + pct(r.share) +
          '</td><td>' + x(r.roas) + '</td><td>' + x(r.marginal) + '</td><td class="gr-left">' + esc(r.verdict || '—') + '</td><td class="gr-left">' + esc(r.who || '—') + '</td></tr>';
      })) : '<p class="gr-empty">No channel has a full, undisputed 7-day read to rank.</p>') +
      ((g.unranked || []).length ? '<p class="gr-src">Left out, not guessed: ' + esc(g.unranked.map(function (u) { return u.channel + ' (' + u.why + ')'; }).join(', ')) + '.</p>' : '');
    return card('1 · Portfolio governor', body, g.basis);
  }

  function renderMarginal(doc) {
    var m = doc.marginal;
    if (!m || !m.channels || !Object.keys(m.channels).length) return silent('Marginal return', m);
    var rows = marginalRows(doc).map(function (r) {
      return '<tr><td>' + esc(r.label) + '</td><td>' + usd(r.spendPrior) + '</td><td>' + usd(r.spend) + '<span class="gr-sub">' + pct(r.spendPct, true) + '</span></td><td>' +
        usd(r.revenueChange) + '</td><td>' + x(r.roas) + '<span class="gr-sub">prior ' + x(r.roasPrior) + '</span></td><td>' + x(r.marginal) +
        '</td><td class="gr-left">' + pill(r.readText, r.readCls) + (r.why ? '<span class="gr-sub">' + esc(r.why) + '</span>' : '') + '</td></tr>';
    });
    var conf = (m.confounders_in_window || []).length ? ' In these two weeks: ' + m.confounders_in_window.join(', ') + '.' : '';
    return card('4 · What the last change in spend returned', '<p class="gr-note">' + esc(m.caveat + conf) + '</p>' +
      table([['Channel', 1], ['Prior 7d spend'], ['This 7d spend'], ['Revenue change'], ['Average ROAS'], ['Marginal ROAS'], ['Read', 1]], rows), m.basis);
  }

  function renderCustomers(doc) {
    var n = doc.new_customers, l = doc.ltv_payback;
    var out = '';
    if (!n || !n.now) out += silent('2 · New customers', n);
    else {
      var now = n.now, prior = n.prior || {}, by = n.by_channel;
      var body = table([['Window', 1], ['New customers'], ['New-customer net sales'], ['Share of net sales'], ['First order'], ['D2C ad spend'], ['Blended CAC'], ['New-customer MER']],
        [now, prior].map(function (w) {
          return '<tr><td>' + esc(win(w.window)) + (w.days_with_customers < 7 ? '<span class="gr-sub">' + int(w.days_with_customers) + '/7 days</span>' : '') + '</td><td>' + int(w.new_customers) + '</td><td>' + usd(w.new_customer_net_sales) +
            '</td><td>' + pct(w.new_share_of_net_sales_pct) + '</td><td>' + usd(w.first_order_value, true) + '</td><td>' + usd(w.d2c_ad_spend) + '</td><td>' + usd(w.blended_ncac, true) + '</td><td>' + x(w.new_customer_mer) + '</td></tr>';
        }));
      if (by && by.channels) {
        body += '<p class="gr-note" style="margin-top:12px">New customers by the UTM on their order, ' + esc(win(by.window)) + '. ' + pct(by.utm_coverage_pct) + ' of new-customer orders carry a UTM. ' +
          esc(by.usable_for_ncac ? '' : 'Per-channel CAC withheld: ' + by.why_withheld + '.') + '</p>' +
          table([['Source', 1], ['New customers'], ['Net sales'], ['7d spend'], ['CAC']], Object.keys(by.channels).map(function (id) {
            var c = by.channels[id];
            return '<tr><td>' + esc(id) + '</td><td>' + int(c.new_customers) + '</td><td>' + usd(c.net_sales) + '</td><td>' + usd(c.spend_7d) + '</td><td>' + usd(c.ncac, true) + '</td></tr>';
          }));
      }
      out += card('2 · New customers', body, n.basis);
    }
    if (!l || l.status !== 'ok') out += silent('3 · Revenue per customer and payback', l);
    else {
      var steps = paybackRows(doc), p = l.payback;
      var cohorts = table([['First-order month', 1], ['Customers'], ['m0'], ['m1'], ['m2 ≈ 90d'], ['m3'], ['m5 ≈ 180d']], (l.cohorts || []).map(function (c) {
        return '<tr><td>' + esc(c.cohort) + '</td><td>' + int(c.customers) + '</td>' + ['m0', 'm1', 'm2', 'm3', 'm5'].map(function (h) { return '<td>' + usd(c['revenue_per_customer_' + h], true) + '</td>'; }).join('') + '</tr>';
      }));
      var pay = p ? '<p class="gr-note" style="margin-top:12px">Against a blended CAC of ' + usd(p.blended_ncac, true) + ' at a ' + pct(p.contribution_margin_pct) + ' contribution margin: ' +
        esc(p.paid_back_by ? 'paid back by ' + p.paid_back_by + '.' : p.note + '.') + '</p>' +
        table([['Horizon', 1], ['Revenue per customer'], ['Contribution per customer'], ['Share of CAC paid back']], steps.map(function (s) {
          return '<tr><td>' + esc(s.horizon) + '</td><td>' + usd(s.revenue, true) + '</td><td>' + usd(s.contribution, true) + '</td><td>' + (s.toCac == null ? '—' : Math.round(s.toCac * 100) + '%') + '</td></tr>';
        })) : '<p class="gr-empty" style="margin-top:10px">Payback needs a new-customer CAC and a contribution margin for the same period.</p>';
      out += card('3 · Revenue per customer and payback', cohorts + pay, l.basis + (p ? ' ' + p.basis : ''));
    }
    return out;
  }

  function renderTests(doc) {
    var t = doc.incrementality, h = doc.history, out = '';
    if (!t || !(t.tests || []).length) out += card('5 · Holdout tests', '<p class="gr-empty">' + esc(statusNote(t) || 'No tests listed.') + ' Platform ROAS is the only read of what ads cause until one runs.</p>', t && t.basis);
    else {
      out += card('5 · Holdout tests', table([['Test', 1], ['Channel', 1], ['Status', 1], ['Dates', 1], ['Lift'], ['Noise'], ['Measured ROAS'], ['Platform ROAS'], ['Factor']], t.tests.map(function (r) {
        var o = r.readout || {};
        return '<tr><td>' + esc(r.id) + '</td><td class="gr-left">' + esc(r.channel) + '</td><td class="gr-left">' + esc(r.status) + (o.read ? '<span class="gr-sub">' + esc(String(o.read).replace(/_/g, ' ')) + '</span>' : '') +
          '</td><td class="gr-left">' + esc(md(r.start) + '–' + md(r.end)) + '</td><td>' + pct(o.lift_pct) + '</td><td>' + pct(o.noise_pct) + '</td><td>' + x(o.incremental_roas) + '</td><td>' + x(o.platform_roas) +
          '</td><td>' + (o.outside_noise && o.read === 'final' ? x(o.calibration) : '—') + '</td></tr>';
      })), t.basis);
    }
    if (h) {
      out += card('6 · History for the media-mix model', '<div class="gr-kpis">' +
        box(int(h.usable_days) + ' / ' + int(h.days_required), 'Usable days', h.status === 'sufficient' ? 'enough to fit' : int(h.days_short) + ' short') +
        box(esc(h.ready_without_backfill ? md(h.ready_without_backfill) + '/' + String(h.ready_without_backfill).slice(0, 4) : '—'), 'Ready with no backfill', 'one more day per day') +
        box(esc(h.backfill_to_reach_it_now ? md(h.backfill_to_reach_it_now) + '/' + String(h.backfill_to_reach_it_now).slice(0, 4) : '—'), 'Backfill spend back to', 'to be ready now') +
        '</div>', h.how);
    }
    return out;
  }

  function renderHalo(doc) {
    var h = doc.halo, d = h && h.d7;
    if (!h || h.status !== 'ok' || !d || !d.revenue) return silent('7 · Total company', h);
    var keys = [['shopify', 'Shopify D2C', 'd2c'], ['amazon', 'Amazon', 'amazon'], ['tiktok_shop', 'TikTok Shop', 'tiktok_shop'], ['whatnot', 'Whatnot', 'whatnot']];
    var rows = keys.map(function (k) {
      return '<tr><td>' + k[1] + '</td><td>' + usd(d.revenue[k[0]]) + '</td><td>' + usd(d.ad_spend[k[2]]) + '</td></tr>';
    });
    rows.push('<tr><td><b>Total</b></td><td><b>' + usd(d.total_revenue) + '</b></td><td><b>' + usd(d.total_ad_spend) + '</b></td></tr>');
    var c = h.amazon_vs_d2c_spend || {};
    return card('7 · Total company, ' + win(d.window), '<div class="gr-kpis" style="margin-bottom:12px">' +
      box(x(d.total_mer), 'Total-company MER', 'all revenue over all ad spend') + box(x(d.d2c_mer), 'Shopify D2C MER', 'same days') +
      box(pct(d.amazon_tacos_pct), 'Amazon ad cost share', 'Amazon ads over Amazon revenue') +
      box(pct(d.d2c_ads_share_of_ad_spend_pct), 'Ad spend on D2C channels', pct(d.amazon_share_of_revenue_pct) + ' of revenue is Amazon') + '</div>' +
      table([['Sales channel', 1], ['Revenue'], ['Ad spend']], rows) +
      '<p class="gr-note" style="margin-top:10px">Halo of D2C ads on Amazon: not measured. ' + esc(h.halo_estimate_why || '') +
      (c.correlation != null ? ' Day-to-day correlation of Amazon revenue with D2C ad spend over ' + int(c.days) + ' days: ' + Number(c.correlation).toFixed(2) + ' (descriptive only).' : '') + '</p>', h.basis);
  }

  function renderMargin(doc) {
    var m = doc.margin_inventory;
    if (!m || !(m.products || []).length) return silent('8 · Product margin and stock', m);
    var b = m.blended || {}, inv = m.inventory || {};
    var rows = productRows(doc).map(function (p) {
      var stock = p.flag === 'low' ? pill(p.stockDays.toFixed(1) + ' days', 'gr-bad') : (p.flag === 'not_tracked' ? '<span class="gr-muted">not tracked</span>' : (p.stockDays == null ? '—' : Math.round(p.stockDays) + ' days'));
      return '<tr><td>' + esc(p.title) + (p.estimated ? '<span class="gr-sub">part of the cost is the fallback rate</span>' : '') + '</td><td>' + int(p.units) + '</td><td>' + usd(p.revenue) + '<span class="gr-sub">' + pct(p.share) + '</span></td><td>' +
        pct(p.margin) + '</td><td>' + x(p.breakeven) + '</td><td>' + stock + '</td></tr>';
    });
    return card('8 · Product margin and stock, ' + win(m.window), '<p class="gr-note">Shopify D2C, before ad spend and overhead: ' + pct(b.contribution_margin_pct) + ' contribution margin, break-even ROAS ' + x(b.breakeven_roas) +
      '. ' + pct(b.cogs_on_fallback_pct) + ' of revenue is costed at the fallback rate. Stock under ' + int(inv.low_cover_days) + ' days is flagged' + (inv.status === 'ok' ? ' (Shopify count, ' + esc(md(inv.as_of)) + ').' : '; stock feed not pulled yet.') + '</p>' +
      table([['Product', 1], ['Units'], ['Revenue'], ['Contribution margin'], ['Break-even ROAS'], ['Stock']], rows), m.basis);
  }

  function renderCreative(doc) {
    var c = doc.creative;
    if (!c || !c.winners) return silent('9 · Creative engine', c);
    var p = c.ports || {}, f = c.fatigue || {};
    var body = '<div class="gr-kpis" style="margin-bottom:12px">' +
      box(int(c.winners), 'Winning Meta creatives', int(c.new_this_week) + ' new this week') +
      box(pct(c.winner_share_of_meta_spend_pct), 'Of Meta spend is on winners', usd(c.winner_spend_7d) + ' in 7 days') +
      box(pct(c.top_winner_share_of_winner_spend_pct), 'Winner spend on the top one', 'concentration') +
      box(int(c.median_age_days) + ' days', 'Median winner age', 'oldest ' + int(c.oldest_age_days) + ' days') +
      box(int(p.live) + ' / ' + int(c.winners), 'Winners live on another channel', int(p.unported_winners) + ' not ported') + '</div>' +
      table([['Landing page', 1], ['Winner spend, 7d'], ['Share']], (c.landing_pages || []).map(function (l) {
        return '<tr><td>' + esc(l.url) + '</td><td>' + usd(l.winner_spend_7d) + '</td><td>' + pct(l.share_pct) + '</td></tr>';
      }));
    body += f.status === 'ok' ? table([['Creative', 1], ['ROAS then'], ['ROAS now'], ['Change']], f.rows.map(function (r) {
      return '<tr><td>' + esc(r.name || r.creative_id) + '<span class="gr-sub">since ' + esc(md(r.since)) + '</span></td><td>' + x(r.roas_then) + '</td><td>' + x(r.roas_now) + '</td><td>' + pct(r.change_pct, true) + '</td></tr>';
    })) : '<p class="gr-empty" style="margin-top:10px">ROAS movement per creative appears after the second pull.</p>';
    return card('9 · Creative engine', body, c.note);
  }

  function renderPacing(doc) {
    var p = doc.pacing, a = doc.autonomy, out = '';
    if (!p || p.status !== 'ok') out += silent('10 · Pacing to the plan', p);
    else {
      out += card('10 · Pacing to the plan', '<div class="gr-kpis">' +
        box(big(p.annual_run_rate), 'Total-company run-rate', int(p.days_used) + ' days, ' + win(p.window)) +
        box(big(p.target_annual_revenue), 'Target', p.target_date ? 'by ' + esc(p.target_date) : 'no date set') +
        box(p.multiple_to_target == null ? '—' : Number(p.multiple_to_target).toFixed(2) + 'x', 'Growth still needed', usd(p.total_revenue_per_day) + ' a day now, ' + usd(p.revenue_per_day_at_target) + ' at target') +
        box(p.weekly_growth_needed_pct == null ? '—' : pct(p.weekly_growth_needed_pct), 'Weekly growth needed', p.weekly_growth_needed_pct == null ? esc(p.why_no_growth_rate || '') : int(p.weeks_to_target_date) + ' weeks left') +
        box(big(p.d2c_annual_run_rate), 'Shopify D2C run-rate', 'part of the total') + '</div>', p.basis);
    }
    if (a && a.channels && Object.keys(a.channels).length) {
      out += card('10 · Which channels have earned auto', '<p class="gr-note">' + esc(a.note) + '</p>' +
        table([['Channel', 1], ['Mode', 1], ['7d spend'], ['Checks passed'], ['Suggestion', 1], ['Failing', 1]], autonomyRows(doc).map(function (r) {
          return '<tr><td>' + esc(r.label) + '</td><td class="gr-left">' + esc(r.mode) + '</td><td>' + usd(r.spend) + '</td><td>' + esc(r.score) + '</td><td class="gr-left">' + pill(r.text, r.cls) +
            '</td><td class="gr-left gr-why">' + esc(r.failing.join(' · ') || '—') + '</td></tr>';
        })));
    }
    return out;
  }

  function renderAsks(rows) {
    if (!rows.length) return '';
    return card('Open questions this raised', rows.map(function (a) {
      return '<div class="gr-ask gr-' + esc(a.severity) + (a.closed ? ' gr-closed' : '') + '"><b>' + esc(a.title) + '</b><p>' + esc(a.detail) + '</p><div class="gr-meta">' + esc(a.id) +
        ' · ' + esc(a.owner || 'unassigned') + ' · ' + int(a.age) + 'd' + (a.ack ? ' · ack: ' + esc(a.ack) : '') + '</div></div>';
    }).join(''));
  }

  function render() {
    var panel = document.getElementById('tab-growth');
    if (!panel) return;
    if (!STATE.loaded) { panel.innerHTML = '<div class="gr-card"><p class="gr-empty">Loading…</p></div>'; return; }
    var doc = STATE.doc;
    if (!doc || !doc.headline) {
      panel.innerHTML = '<div class="gr-card"><h3>Growth</h3><p class="gr-empty">' + esc(FEED) +
        ' has not been published to this page yet. It is rebuilt every morning in the data repo and copied here by its publish step.</p></div>';
      return;
    }
    panel.innerHTML = renderHeadline(headline(doc)) + renderAsks(askRows(doc)) + renderGovernor(doc) + renderMarginal(doc) + renderCustomers(doc) +
      renderTests(doc) + renderHalo(doc) + renderMargin(doc) + renderCreative(doc) + renderPacing(doc);
  }

  function ensureTab() {
    var panel = document.getElementById('tab-growth');
    if (!panel) {
      panel = document.createElement('div'); panel.id = 'tab-growth'; panel.className = 'tab-content';
      var reports = document.getElementById('tab-reports');
      if (reports && reports.parentNode) reports.parentNode.appendChild(panel); else document.body.appendChild(panel);
    }
    var btn = document.querySelector('.tab[data-tab="growth"]');
    if (!btn) {
      var anchor = document.querySelector('.tab[data-tab="loop"]') || document.querySelector('.tab[data-tab="ad_channels"]') || document.querySelector('.tab[data-tab="reports"]');
      if (anchor && anchor.parentNode) {
        btn = document.createElement('div'); btn.className = 'tab'; btn.setAttribute('data-tab', 'growth');
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      }
    }
    if (btn) btn.textContent = 'GROWTH';
    if (btn && !btn._grBound) {
      btn._grBound = true;
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
        document.body.classList.remove('reports-active');
        btn.classList.add('active'); panel.classList.add('active');
        if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, null, '#growth');
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
    if (typeof location !== 'undefined' && location.hash === '#growth') {
      var btn = document.querySelector('.tab[data-tab="growth"]');
      if (btn) btn.click();
    }
  }

  var api = {
    FEED: FEED, headline: headline, governorRows: governorRows, marginalRows: marginalRows, paybackRows: paybackRows,
    productRows: productRows, autonomyRows: autonomyRows, askRows: askRows, statusNote: statusNote,
    renderGovernor: renderGovernor, renderMarginal: renderMarginal, renderCustomers: renderCustomers, renderTests: renderTests,
    renderHalo: renderHalo, renderMargin: renderMargin, renderCreative: renderCreative, renderPacing: renderPacing,
    render: render, load: load, _state: STATE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Growth = api;

  if (typeof document !== 'undefined') {
    // After ad_loop_module.js has inserted its tab, so GROWTH sits next to it.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 20); });
    else setTimeout(boot, 20);
  }
})(typeof window !== 'undefined' ? window : globalThis);
