/* =====================================================================
   COLDEST · SECONDARY ADS MODULE  (self-contained, drop-in)
   ---------------------------------------------------------------------
   Adds the "SECONDARY ADS" tab (ChatGPT / OpenAI Ads + future channels)
   to the CFO dashboard, and folds ChatGPT spend into the daily P&L
   (Shopify ad spend + blended MER + net profit) per David's spec.

   HOW IT WORKS
   - Injects its own nav-tab button + tab-content panel if missing, so it
     does NOT require you to hand-edit the dashboard's tab list.
   - Loads three JSON feeds shipped alongside index.html:
       secondary_ads_data.json     (OpenAI Ads spend — required)
       chatgpt_revenue_daily.json  (attributed revenue/ROAS — optional)
       chatgpt_spend_daily.json    (per-day spend for P&L overlay — optional)
   - Uses ONLY namespaced globals/helpers (SA_*) so nothing collides with
     the existing dashboard code (REPORTS, MER_TARGET, escAds, etc.).
   - The P&L overlay is DEFENSIVE: it only touches fields that already
     exist on each REPORTS row, and is idempotent (safe to re-run).

   INSTALL: see PASTE_INTO_BRIEFING_CHAT.md. In short — drop this file
   next to index.html and add ONE line before </body>:
       <script src="secondary_ads_module.js"></script>
   ===================================================================== */
(function () {
  'use strict';

  // ---- Config -------------------------------------------------------
  var SA_TARGET_ROAS = 2.5;                 // mirrors MER target
  var SA_TAB_KEY = 'secondary_ads';
  var SA_TAB_LABEL = 'SECONDARY ADS';
  var PLATFORM_LABEL = { chatgpt: 'ChatGPT (OpenAI Ads)', reddit: 'Reddit Ads' };
  var PLATFORM_ORDER = ['chatgpt', 'reddit'];

  // ---- Namespaced state --------------------------------------------
  var SA_DATA = null;        // secondary_ads_data.json
  var SA_REVENUE = null;     // chatgpt_revenue_daily.json
  var SA_SPEND_DAILY = null; // chatgpt_spend_daily.json (overlay source)

  // ---- Namespaced helpers (no collision with dashboard) ------------
  function saEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function saUsd(v) {
    return '$' + (v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function saNum(v) { return (v || 0).toLocaleString(); }

  // ---- Inject fallback CSS (only vars the theme may not define) -----
  // The dashboard theme already defines --cyan/--green/--surface/etc.;
  // these are safe fallbacks if a class is missing on the old dashboard.
  function saInjectCss() {
    if (document.getElementById('sa-module-css')) return;
    var css = ''
      + '#tab-' + SA_TAB_KEY + ' .sa-kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}'
      + '#tab-' + SA_TAB_KEY + ' .sa-kpi-card{background:var(--card,#15181d);border:1px solid var(--border,#262b33);border-radius:8px;padding:20px 20px 16px}'
      + '#tab-' + SA_TAB_KEY + ' .sa-kpi-label{font-size:.65rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim,#7a828e);margin-bottom:8px}'
      + '#tab-' + SA_TAB_KEY + ' .sa-kpi-val{font-family:var(--font-mono,ui-monospace,monospace);font-size:1.6rem;font-weight:700;color:var(--text,#e8eaed);line-height:1}'
      + '#tab-' + SA_TAB_KEY + ' .sa-kpi-change{display:flex;align-items:center;gap:5px;margin-top:8px;font-size:.72rem;font-weight:600;color:var(--text-dim,#7a828e)}'
      + '#tab-' + SA_TAB_KEY + ' .sa-box{background:var(--surface,#1a1d23);border:1px solid var(--border,#262b33);border-radius:6px;padding:20px;margin-bottom:24px}'
      + '#tab-' + SA_TAB_KEY + ' .sa-box .row{display:flex;justify-content:space-between;padding:4px 0}'
      + '#tab-' + SA_TAB_KEY + ' .sa-box .label{color:var(--text-muted,#9aa3af);font-size:.82rem}'
      + '#tab-' + SA_TAB_KEY + ' .sa-box .val{font-family:var(--font-mono,ui-monospace,monospace);font-weight:600;font-size:.85rem}'
      + '#tab-' + SA_TAB_KEY + ' .sa-title{font-size:.72rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--cyan,#22d3ee);margin:24px 0 12px;padding-top:8px}'
      + '#tab-' + SA_TAB_KEY + ' .sa-sub{color:var(--text-muted,#9aa3af);font-size:.82rem;margin-bottom:1rem}'
      + '#tab-' + SA_TAB_KEY + ' .sa-table{width:100%;font-size:.82rem;border-collapse:collapse}'
      + '#tab-' + SA_TAB_KEY + ' .sa-table th{color:var(--text-dim,#7a828e);font-size:.65rem;letter-spacing:.08em;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid var(--border,#262b33)}'
      + '#tab-' + SA_TAB_KEY + ' .sa-table td{padding:6px 8px;border-bottom:1px solid var(--border,#262b33);white-space:nowrap}'
      + '@media (max-width:768px){#tab-' + SA_TAB_KEY + ' .sa-kpi-row{grid-template-columns:repeat(2,1fr)}}';
    var st = document.createElement('style');
    st.id = 'sa-module-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---- Ensure nav tab + content panel exist -------------------------
  function saEnsureScaffold() {
    // 1) content panel
    var panel = document.getElementById('tab-' + SA_TAB_KEY);
    if (!panel) {
      var reports = document.getElementById('tab-reports');
      panel = document.createElement('div');
      panel.id = 'tab-' + SA_TAB_KEY;
      panel.className = 'tab-content';
      if (reports && reports.parentNode) {
        reports.parentNode.insertBefore(panel, reports.nextSibling);
      } else {
        document.body.appendChild(panel);
      }
    }
    // 2) nav button
    var existingBtn = document.querySelector('.tab[data-tab="' + SA_TAB_KEY + '"]');
    if (!existingBtn) {
      var firstTab = document.querySelector('.tab[data-tab="reports"]') || document.querySelector('.tab');
      if (firstTab && firstTab.parentNode) {
        var btn = document.createElement('div');
        btn.className = 'tab';
        btn.setAttribute('data-tab', SA_TAB_KEY);
        btn.textContent = SA_TAB_LABEL;
        firstTab.parentNode.insertBefore(btn, firstTab.nextSibling);
        // Wire click — mirror the dashboard's own tab behavior.
        btn.addEventListener('click', function () {
          document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
          document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
          btn.classList.add('active');
          var p = document.getElementById('tab-' + SA_TAB_KEY);
          if (p) p.classList.add('active');
          saRender();
        });
      }
    } else {
      // Tab already present in markup — just make sure it renders on click.
      existingBtn.addEventListener('click', function () { setTimeout(saRender, 0); });
    }
  }

  // ---- Merge attributed revenue into spend rows (in place) ----------
  function saMergeRevenue() {
    var rev = SA_REVENUE, D = SA_DATA;
    if (!D || !rev || rev.status !== 'ok') return;
    var rbc = rev.revenue_by_campaign || {};
    var bdr = rev.by_day_campaign_revenue || {};
    (D.by_campaign || []).forEach(function (r) {
      var node = rbc[r.campaign];
      if (node) { r.revenue = node.revenue; r.orders = node.orders; }
      else { delete r.revenue; delete r.orders; }
    });
    Object.keys(D.by_day_campaign || {}).forEach(function (date) {
      var dayRev = bdr[date] || {};
      (D.by_day_campaign[date] || []).forEach(function (r) {
        var node = dayRev[r.campaign];
        if (node) { r.revenue = node.revenue; r.orders = node.orders; }
        else { delete r.revenue; delete r.orders; }
      });
    });
  }

  // ---- Main render --------------------------------------------------
  function saRender() {
    var c = document.getElementById('tab-' + SA_TAB_KEY);
    if (!c) return;
    saMergeRevenue();
    var D = SA_DATA;

    if (!D || D.status !== 'ok' || !(D.by_campaign || []).length) {
      c.innerHTML = ''
        + '<div class="sa-box" style="text-align:center;padding:48px 24px">'
        + '<div style="font-size:.72rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--cyan,#22d3ee);margin-bottom:10px">Secondary Ads</div>'
        + '<div style="color:var(--text-muted,#9aa3af);font-size:.9rem">'
        + saEsc((D && D.message) || 'Awaiting spend data. Pipeline runs daily at 02:30 ET.')
        + '</div></div>';
      return;
    }

    // Group by platform
    var byPlat = {};
    (D.by_campaign || []).forEach(function (r) {
      var p = r.platform || 'chatgpt';
      byPlat[p] = byPlat[p] || { campaigns: [], daily: {}, spend: 0, impr: 0, clicks: 0 };
      byPlat[p].campaigns.push(r);
      byPlat[p].spend += (r.spend || 0); byPlat[p].impr += (r.impressions || 0); byPlat[p].clicks += (r.clicks || 0);
    });
    (D.daily || []).forEach(function (d) {
      var p = d.platform && d.platform !== 'all' ? d.platform : (D.platforms || ['chatgpt'])[0];
      byPlat[p] = byPlat[p] || { campaigns: [], daily: {}, spend: 0, impr: 0, clicks: 0 };
      byPlat[p].daily[d.date] = (byPlat[p].daily[d.date] || 0) + (d.spend || 0);
    });
    if (D.by_day_platform) {
      Object.keys(D.by_day_platform).forEach(function (date) {
        var pv = D.by_day_platform[date];
        Object.keys(pv).forEach(function (p) {
          byPlat[p] = byPlat[p] || { campaigns: [], daily: {}, spend: 0, impr: 0, clicks: 0 };
          byPlat[p].daily[date] = pv[p];
        });
      });
    }
    var platforms = PLATFORM_ORDER.filter(function (p) { return byPlat[p]; })
      .concat(Object.keys(byPlat).filter(function (p) { return PLATFORM_ORDER.indexOf(p) < 0; }));

    var gSpend = platforms.reduce(function (s, p) { return s + byPlat[p].spend; }, 0);
    var gImpr = platforms.reduce(function (s, p) { return s + byPlat[p].impr; }, 0);
    var gClicks = platforms.reduce(function (s, p) { return s + byPlat[p].clicks; }, 0);
    var activePlatforms = (D.platforms || platforms).map(function (p) { return PLATFORM_LABEL[p] || p; }).join(', ');

    var BDC = D.by_day_campaign || {};
    function datesFor(plat) {
      var ds = Object.keys(BDC).filter(function (date) {
        return plat === 'all' ? (BDC[date] || []).length
          : (BDC[date] || []).some(function (r) { return (r.platform || 'chatgpt') === plat; });
      });
      return ds.sort(function (a, b) { return b.localeCompare(a); });
    }

    function panelFor(plat, selDate) {
      selDate = selDate || '';
      var camps, dailyMap, sSpend, sImpr, sClicks, campCount;
      if (selDate) {
        var dayRows = (BDC[selDate] || []);
        if (plat !== 'all') dayRows = dayRows.filter(function (r) { return (r.platform || 'chatgpt') === plat; });
        camps = dayRows.slice().sort(function (a, b) { return (b.spend || 0) - (a.spend || 0); });
        sSpend = camps.reduce(function (s, r) { return s + (r.spend || 0); }, 0);
        sImpr = camps.reduce(function (s, r) { return s + (r.impressions || 0); }, 0);
        sClicks = camps.reduce(function (s, r) { return s + (r.clicks || 0); }, 0);
        dailyMap = {}; dailyMap[selDate] = sSpend; campCount = camps.length;
      } else if (plat === 'all') {
        camps = (D.by_campaign || []).slice().sort(function (a, b) { return (b.spend || 0) - (a.spend || 0); });
        dailyMap = {};
        platforms.forEach(function (p) {
          Object.keys(byPlat[p].daily).forEach(function (d) { dailyMap[d] = (dailyMap[d] || 0) + byPlat[p].daily[d]; });
        });
        sSpend = gSpend; sImpr = gImpr; sClicks = gClicks; campCount = camps.length;
      } else {
        var pd = byPlat[plat];
        camps = pd.campaigns.slice().sort(function (a, b) { return (b.spend || 0) - (a.spend || 0); });
        dailyMap = pd.daily; sSpend = pd.spend; sImpr = pd.impr; sClicks = pd.clicks; campCount = camps.length;
      }
      var sCtr = sImpr ? (sClicks / sImpr * 100) : 0;
      var sCpc = sClicks ? (sSpend / sClicks) : 0;
      var sCpm = sImpr ? (sSpend / sImpr * 1000) : 0;
      var daily = Object.keys(dailyMap).map(function (date) { return { date: date, spend: dailyMap[date] }; })
        .sort(function (a, b) { return a.date.localeCompare(b.date); });
      var maxDay = Math.max.apply(null, [1].concat(daily.map(function (d) { return d.spend; })));
      var showPlatCol = (plat === 'all');
      var trendLabel = selDate ? 'Daily Spend' : 'Daily Spend Trend';
      var periodNote = selDate ? selDate : (daily.length + ' day' + (daily.length === 1 ? '' : 's') + ' (window)');
      var archiveDates = datesFor(plat);
      var dateSelector = archiveDates.length ? (''
        + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">'
        + '<span style="font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted,#9aa3af)">View</span>'
        + '<select class="sa-date-select" data-sa-plat="' + saEsc(plat) + '" style="background:var(--surface,#1a1d23);color:var(--text,#e8eaed);border:1px solid var(--border,#262b33);border-radius:6px;padding:6px 10px;font-size:.82rem;cursor:pointer">'
        + '<option value=""' + (selDate === '' ? ' selected' : '') + '>All days (window)</option>'
        + archiveDates.map(function (d) { return '<option value="' + saEsc(d) + '"' + (selDate === d ? ' selected' : '') + '>' + saEsc(d) + '</option>'; }).join('')
        + '</select>'
        + '<span style="font-size:.72rem;color:var(--text-dim,#7a828e)">' + (selDate ? 'Archived day' : 'Lifetime in pull window') + '</span>'
        + '</div>') : '';

      var sRev = camps.reduce(function (s, r) { return s + (r.revenue || 0); }, 0);
      var sOrders = camps.reduce(function (s, r) { return s + (r.orders || 0); }, 0);
      var sRoas = (sRev > 0 && sSpend > 0) ? (sRev / sSpend) : null;
      var ranked = camps.filter(function (r) { return r.revenue != null && r.spend > 0; })
        .map(function (r) { return { campaign: r.campaign, platform: r.platform, spend: r.spend, revenue: r.revenue, orders: r.orders || 0, roas: r.revenue / r.spend }; })
        .sort(function (a, b) { return b.roas - a.roas; });
      var maxRoas = Math.max.apply(null, [1e-9].concat(ranked.map(function (r) { return r.roas; })));
      var rankingHtml = ranked.length ? (''
        + '<div class="sa-title" style="margin-top:28px">ROAS Feedback Loop <span style="font-weight:400;color:var(--text-dim,#7a828e);font-size:.72rem;text-transform:none;letter-spacing:0"> · scale the winners, cut the laggards</span></div>'
        + '<div class="sa-box">'
        + ranked.map(function (r, i) {
          var good = r.roas >= SA_TARGET_ROAS;
          var barColor = good ? 'var(--green,#30c97e)' : (r.roas >= 1 ? 'var(--yellow,#f5c451)' : 'var(--red,#e5484d)');
          var tag = i === 0 ? '<span style="font-size:.62rem;font-weight:700;color:var(--green,#30c97e);border:1px solid var(--green,#30c97e);border-radius:4px;padding:1px 5px;margin-left:8px;text-transform:uppercase;letter-spacing:.06em">Top</span>'
            : (r.roas < 1 ? '<span style="font-size:.62rem;font-weight:700;color:var(--red,#e5484d);border:1px solid var(--red,#e5484d);border-radius:4px;padding:1px 5px;margin-left:8px;text-transform:uppercase;letter-spacing:.06em">Cut</span>' : '');
          return '<div class="row" style="align-items:center;gap:12px;padding:7px 0">'
            + '<span class="label" style="min-width:210px;display:flex;align-items:center">' + saEsc(r.campaign) + (showPlatCol ? ' <span style="color:var(--text-dim,#7a828e);font-size:.72rem;margin-left:6px">(' + saEsc(PLATFORM_LABEL[r.platform] || r.platform) + ')</span>' : '') + tag + '</span>'
            + '<span style="flex:1;height:10px;background:var(--surface,#1a1d23);border-radius:5px;overflow:hidden"><span style="display:block;height:100%;width:' + Math.max(3, (r.roas / maxRoas * 100)).toFixed(1) + '%;background:' + barColor + '"></span></span>'
            + '<span class="val" style="min-width:64px;text-align:right;font-weight:700;color:' + barColor + '">' + r.roas.toFixed(2) + 'x</span>'
            + '<span class="val" style="min-width:96px;text-align:right;color:var(--text-muted,#9aa3af);font-size:.8rem">' + saUsd(r.revenue) + ' / ' + saNum(r.orders) + ' ord</span>'
            + '</div>';
        }).join('')
        + '</div>'
        + '<div style="font-size:.72rem;color:var(--text-dim,#7a828e);padding:8px 0 4px">Ranked by attributed ROAS (revenue ÷ spend). Target ' + SA_TARGET_ROAS + 'x — green clears target, yellow is profitable, red is below 1x and bleeding.</div>') : '';

      return ''
        + dateSelector
        + '<div class="sa-kpi-row">'
        + '<div class="sa-kpi-card"><div class="sa-kpi-label">Total Spend</div><div class="sa-kpi-val">' + saUsd(sSpend) + '</div><div class="sa-kpi-change"><span>' + saEsc(periodNote) + '</span></div></div>'
        + '<div class="sa-kpi-card"><div class="sa-kpi-label">Impressions</div><div class="sa-kpi-val">' + saNum(sImpr) + '</div><div class="sa-kpi-change"><span>CPM ' + saUsd(sCpm) + '</span></div></div>'
        + '<div class="sa-kpi-card"><div class="sa-kpi-label">Clicks</div><div class="sa-kpi-val">' + saNum(sClicks) + '</div><div class="sa-kpi-change"><span>CTR ' + sCtr.toFixed(2) + '%</span></div></div>'
        + '<div class="sa-kpi-card"><div class="sa-kpi-label">Avg CPC</div><div class="sa-kpi-val">' + saUsd(sCpc) + '</div><div class="sa-kpi-change"><span>' + campCount + ' campaigns</span></div></div>'
        + '</div>'
        + '<div class="sa-title">' + trendLabel + '</div>'
        + '<div class="sa-box" style="margin-bottom:24px">'
        + (daily.length ? daily.map(function (d) {
          return '<div class="row" style="align-items:center;gap:12px">'
            + '<span class="label" style="min-width:92px">' + saEsc(d.date) + '</span>'
            + '<span style="flex:1;height:8px;background:var(--surface,#1a1d23);border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:' + Math.max(2, (d.spend / maxDay * 100)).toFixed(1) + '%;background:var(--cyan,#22d3ee)"></span></span>'
            + '<span class="val" style="min-width:80px;text-align:right">' + saUsd(d.spend) + '</span>'
            + '</div>';
        }).join('') : '<div style="color:var(--text-muted,#9aa3af);font-size:.85rem">No daily data yet.</div>')
        + '</div>'
        + '<div class="sa-title">By Campaign</div>'
        + '<table class="sa-table">'
        + '<thead><tr><th style="text-align:left">Campaign</th>'
        + (showPlatCol ? '<th style="text-align:left">Platform</th>' : '')
        + '<th style="text-align:right">Spend</th><th style="text-align:right">Impr.</th><th style="text-align:right">Clicks</th><th style="text-align:right">CTR</th><th style="text-align:right">CPC</th><th style="text-align:right">Orders</th><th style="text-align:right">Revenue</th><th style="text-align:right">ROAS</th></tr></thead>'
        + '<tbody>'
        + camps.map(function (r) {
          var rCtr = r.impressions ? (r.clicks / r.impressions * 100) : 0;
          var rCpc = r.clicks ? (r.spend / r.clicks) : 0;
          var hasRev = r.revenue != null;
          var roas = (hasRev && r.spend) ? (r.revenue / r.spend) : null;
          return '<tr>'
            + '<td style="text-align:left;white-space:normal">' + saEsc(r.campaign) + '</td>'
            + (showPlatCol ? '<td style="text-align:left;color:var(--text-muted,#9aa3af)">' + saEsc(PLATFORM_LABEL[r.platform] || r.platform) + '</td>' : '')
            + '<td style="text-align:right;font-weight:600">' + saUsd(r.spend) + '</td>'
            + '<td style="text-align:right">' + saNum(r.impressions) + '</td>'
            + '<td style="text-align:right">' + saNum(r.clicks) + '</td>'
            + '<td style="text-align:right">' + rCtr.toFixed(2) + '%</td>'
            + '<td style="text-align:right">' + saUsd(rCpc) + '</td>'
            + '<td style="text-align:right;color:' + (r.orders ? 'var(--text,#e8eaed)' : 'var(--text-dim,#7a828e)') + '">' + (r.orders != null ? saNum(r.orders) : '—') + '</td>'
            + '<td style="text-align:right;color:' + (hasRev ? 'var(--text,#e8eaed)' : 'var(--text-dim,#7a828e)') + '">' + (hasRev ? saUsd(r.revenue) : '—') + '</td>'
            + '<td style="text-align:right;color:' + (roas != null ? (roas >= SA_TARGET_ROAS ? 'var(--green,#30c97e)' : 'var(--yellow,#f5c451)') : 'var(--text-dim,#7a828e)') + ';font-weight:' + (roas != null ? '700' : '400') + '">' + (roas != null ? roas.toFixed(2) + 'x' : '—') + '</td>'
            + '</tr>';
        }).join('')
        + '</tbody>'
        + '<tfoot><tr style="border-top:2px solid var(--border,#262b33);font-weight:700">'
        + '<td style="text-align:left">Total</td>'
        + (showPlatCol ? '<td></td>' : '')
        + '<td style="text-align:right">' + saUsd(sSpend) + '</td><td style="text-align:right">' + saNum(sImpr) + '</td><td style="text-align:right">' + saNum(sClicks) + '</td><td style="text-align:right">' + sCtr.toFixed(2) + '%</td><td style="text-align:right">' + saUsd(sCpc) + '</td>'
        + '<td style="text-align:right">' + (sOrders ? saNum(sOrders) : '—') + '</td><td style="text-align:right">' + (sRev ? saUsd(sRev) : '—') + '</td>'
        + '<td style="text-align:right;color:' + (sRoas != null ? (sRoas >= SA_TARGET_ROAS ? 'var(--green,#30c97e)' : 'var(--yellow,#f5c451)') : 'var(--text-dim,#7a828e)') + '">' + (sRoas != null ? sRoas.toFixed(2) + 'x' : '—') + '</td>'
        + '</tr></tfoot></table>'
        + rankingHtml
        + (sRev > 0 ? '' : '<div style="font-size:.72rem;color:var(--text-dim,#7a828e);padding:12px 0">Revenue &amp; ROAS activate once first-party UTM capture (utm_source=' + (plat === 'all' ? 'chatgpt' : saEsc(plat)) + ') lands on converting orders. No ChatGPT-attributed orders yet — capture is live and the pipeline is running.</div>');
    }

    var subTabs = [{ key: 'all', label: 'All Channels' }].concat(
      platforms.map(function (p) { return { key: p, label: PLATFORM_LABEL[p] || p }; })
    );
    var initial = platforms.length === 1 ? platforms[0] : 'all';

    c.innerHTML = ''
      + '<div class="sa-title" style="margin-top:0">Secondary Ads · Non-Meta Channels</div>'
      + '<div class="sa-sub">Source: ' + saEsc(D.source || '') + ' · Active: ' + saEsc(activePlatforms || '—') + ' · Updated ' + saEsc((D.as_of || '').replace('T', ' ')) + '</div>'
      + '<div class="sa-subnav" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;border-bottom:1px solid var(--border,#262b33);padding-bottom:2px">'
      + subTabs.map(function (t) {
        return '<button class="sa-subtab' + (t.key === initial ? ' active' : '') + '" data-sa="' + saEsc(t.key) + '" style="background:none;border:none;border-bottom:2px solid transparent;color:var(--text-muted,#9aa3af);font-size:.82rem;font-weight:600;padding:8px 12px;cursor:pointer">' + saEsc(t.label) + '</button>';
      }).join('')
      + '</div>'
      + subTabs.map(function (t) {
        return '<div class="sa-panel" data-sa-panel="' + saEsc(t.key) + '" style="display:' + (t.key === initial ? 'block' : 'none') + '"><div class="sa-panel-inner" data-sa-plat="' + saEsc(t.key) + '" data-sa-date="">' + panelFor(t.key, '') + '</div></div>';
      }).join('');

    // Date selector → re-render affected panel inner
    c.addEventListener('change', function (e) {
      var sel = e.target.closest('.sa-date-select');
      if (!sel) return;
      var plat = sel.dataset.saPlat;
      var date = sel.value || '';
      var inner = c.querySelector('.sa-panel-inner[data-sa-plat="' + (window.CSS && CSS.escape ? CSS.escape(plat) : plat) + '"]');
      if (inner) { inner.dataset.saDate = date; inner.innerHTML = panelFor(plat, date); }
    });
    // Sub-tab switching
    c.querySelectorAll('.sa-subtab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.sa;
        c.querySelectorAll('.sa-subtab').forEach(function (b) { b.classList.remove('active'); b.style.color = 'var(--text-muted,#9aa3af)'; b.style.borderBottomColor = 'transparent'; });
        btn.classList.add('active'); btn.style.color = 'var(--cyan,#22d3ee)'; btn.style.borderBottomColor = 'var(--cyan,#22d3ee)';
        c.querySelectorAll('.sa-panel').forEach(function (pnl) { pnl.style.display = (pnl.dataset.saPanel === key) ? 'block' : 'none'; });
      });
    });
    var act = c.querySelector('.sa-subtab.active');
    if (act) { act.style.color = 'var(--cyan,#22d3ee)'; act.style.borderBottomColor = 'var(--cyan,#22d3ee)'; }
  }

  // ---- P&L overlay: fold ChatGPT spend into REPORTS (defensive) -----
  // Per spec: ChatGPT spend adds into Shopify ad spend + blended/total ad
  // spend, and subtracts from net profit. Idempotent + only touches
  // fields that already exist on the row.
  function saApplyPnLOverlay() {
    if (typeof REPORTS === 'undefined' || !Array.isArray(REPORTS)) return; // old dashboard not loaded yet
    // Build per-date ChatGPT spend. Prefer chatgpt_spend_daily.json; else by_day_platform.
    var spendByDate = {};
    // chatgpt_spend_daily.json uses { "by_date": { "YYYY-MM-DD": spend } }.
    // (older builds used "by_day" — accept both.)
    var sd = SA_SPEND_DAILY && (SA_SPEND_DAILY.by_date || SA_SPEND_DAILY.by_day);
    if (sd) {
      Object.keys(sd).forEach(function (d) { spendByDate[d] = sd[d]; });
    } else if (SA_DATA && SA_DATA.by_day_platform) {
      Object.keys(SA_DATA.by_day_platform).forEach(function (date) {
        var pv = SA_DATA.by_day_platform[date]; var s = 0;
        for (var p in pv) s += (pv[p] || 0);
        spendByDate[date] = s;
      });
    } else { return; }

    REPORTS.forEach(function (r) {
      var cg = Math.round((spendByDate[r.date] || 0) * 100) / 100;
      var prev = r._sa_chatgpt_applied || 0;
      var delta = cg - prev;
      if (Math.abs(delta) < 0.005) { r.chatgpt_ad_spend = cg; return; }

      if (r.shop_ad_spend != null) r.shop_ad_spend += delta;
      if (r.total_ad_spend != null) r.total_ad_spend += delta;
      if (r.blended_ad_spend != null) r.blended_ad_spend += delta;
      if (r.shop_net_profit != null) r.shop_net_profit -= delta;
      if (r.net_profit != null) r.net_profit -= delta;
      if (r.contribution_profit != null) r.contribution_profit -= delta;

      if (r.shop_revenue > 0 && r.shop_ad_spend != null) {
        r.shop_mer = +(r.shop_revenue / r.shop_ad_spend).toFixed(2);
        r.shop_ad_pct = +(r.shop_ad_spend / r.shop_revenue * 100).toFixed(1);
        if (r.shop_net_profit != null) r.shop_margin = +(r.shop_net_profit / r.shop_revenue * 100).toFixed(1);
      }
      if (r.total_revenue > 0 && r.total_ad_spend != null) {
        r.mer = +(r.total_revenue / r.total_ad_spend).toFixed(2);
        var blendAd = (r.blended_ad_spend != null ? r.blended_ad_spend : r.total_ad_spend);
        r.blended_ad_pct = +(blendAd / r.total_revenue * 100).toFixed(1);
        if (r.blended_ad_spend != null) r.blended_mer = +(r.total_revenue / r.blended_ad_spend).toFixed(2);
        if (r.net_profit != null) r.net_margin_pct = +(r.net_profit / r.total_revenue * 100).toFixed(1);
      }
      r.chatgpt_ad_spend = cg;
      r._sa_chatgpt_applied = cg;
    });

    // Re-run the dashboard's own report renderers if present, so cards reflect overlay.
    ['renderYesterday', 'renderYesterdayPie', 'render30DayAverages', 'renderReports'].forEach(function (fn) {
      try { if (typeof window[fn] === 'function') window[fn](); } catch (e) { /* non-fatal */ }
    });
  }

  // ---- Load feeds + boot -------------------------------------------
  function saLoadAndRender() {
    var jobs = [
      fetch('secondary_ads_data.json', { cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status)); })
        .then(function (d) { if (d && d.status) SA_DATA = d; })
        .catch(function (e) { console.log('[SA] spend feed missing:', e.message); }),
      fetch('chatgpt_revenue_daily.json', { cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status)); })
        .then(function (d) { if (d && d.status === 'ok') SA_REVENUE = d; })
        .catch(function (e) { console.log('[SA] revenue feed not present yet:', e.message); }),
      fetch('chatgpt_spend_daily.json', { cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status)); })
        .then(function (d) { if (d) SA_SPEND_DAILY = d; })
        .catch(function (e) { console.log('[SA] daily-spend feed not present yet:', e.message); })
    ];
    Promise.allSettled(jobs).then(function () {
      saApplyPnLOverlay();
      saRender();
    });
  }

  function saBoot() {
    saInjectCss();
    saEnsureScaffold();
    saLoadAndRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(saBoot, 0); });
  } else {
    setTimeout(saBoot, 0);
  }
})();
