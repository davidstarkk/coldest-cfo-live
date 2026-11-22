/* =====================================================================
   SCALE HISTORY tab — Shopify D2C revenue, Meta spend, ads running and
   estimated profit, 2025 vs 2026, and where extra Meta spend stopped paying.

   Data: growth/scaling_history.json (cfo_backend/scaling_history.py).
   Loaded by dashboard_runtime.js; adds its own tab, so nothing here lives in
   the index.html the daily sync overwrites.

   Profit is an estimate from the planning rates in `assumptions` (the
   sliders): contribution after Meta ads. Other ad channels and fixed
   overhead are not subtracted. Meta ROAS is platform-reported.
   ===================================================================== */
(function (root) {
  'use strict';

  var BAND = 5000;
  var MIN_WEEKS = 3;          // a band or split with fewer weeks is shown but not judged
  var STEP_MOVE = 0.10;       // a week-over-week spend move of at least 10% is a "step"
  var YEAR_COLORS = { 2025: '#d95926', 2026: '#3987e5' };
  var NEUTRAL = '#8888a8';

  /* ---------- pure analysis (also used by the node tests) ---------- */

  function rates(a) {
    a = a || {};
    return {
      cogs: (a.cogs_pct == null ? 22.1 : +a.cogs_pct) / 100,
      ship: a.ship_per_order == null ? 7.32 : +a.ship_per_order,
      fee: (a.fee_pct == null ? 3 : +a.fee_pct) / 100
    };
  }

  // One period (week or month of sums) → per-day figures.
  function perDay(row, a) {
    var r = rates(a), d = row.days || 1;
    var contrib = row.rev - r.cogs * row.net - r.ship * row.orders - r.fee * row.rev;
    var profit = contrib - row.spend;
    return {
      key: row.w || row.m, y: row.y, n: row.n, days: d,
      spend: row.spend / d, rev: row.rev / d, contrib: contrib / d, profit: profit / d,
      margin: row.rev ? profit / row.rev : null,
      mer: row.spend ? row.rev / row.spend : null,
      roas: row.spend ? row.pv / row.spend : null,
      ads: row.ads / d, ads50: row.ads50 / d,
      spendPerAd: row.ads50 ? row.spend / row.ads50 : null,
      newShare: row.spend ? row.new_ad_spend / row.spend : null,
      top5: row.spend ? row.top5_spend / row.spend : null,
      newAds: row.new_ads, uniqueAds: row.unique_ads == null ? null : row.unique_ads,
      newRev: row.new_net / d, orders: row.orders / d,
      newCac: row.new_orders ? row.spend / row.new_orders : null
    };
  }

  function mean(xs) { return xs.length ? xs.reduce(function (s, x) { return s + x; }, 0) / xs.length : null; }
  function median(xs) {
    if (!xs.length) return null;
    var s = xs.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function pool(points) {
    var spend = 0, rev = 0, pv = 0, profit = 0;
    points.forEach(function (p) { spend += p.spend; rev += p.rev; pv += p.roas * p.spend; profit += p.profit; });
    var n = points.length;
    return {
      weeks: n, spend: spend / n, rev: rev / n, profit: profit / n,
      mer: spend ? rev / spend : null, roas: spend ? pv / spend : null,
      margin: rev ? profit / rev : null,
      ads: mean(points.map(function (p) { return p.ads; })),
      ads50: mean(points.map(function (p) { return p.ads50; })),
      spendPerAd: mean(points.filter(function (p) { return p.spendPerAd != null; }).map(function (p) { return p.spendPerAd; }))
    };
  }

  function bandLabel(i) { return '$' + (i * BAND / 1000) + '–' + ((i + 1) * BAND / 1000) + 'k'; }

  // Weeks grouped by Meta spend per day. `marginal*` compare a band with the
  // next lower band that has enough weeks: extra revenue / profit per extra $.
  function bandTable(points, year) {
    var by = {};
    points.forEach(function (p) {
      if (year && p.y !== year) return;
      var i = Math.floor(p.spend / BAND);
      (by[i] = by[i] || []).push(p);
    });
    var prev = null;
    return Object.keys(by).map(Number).sort(function (a, b) { return a - b; }).map(function (i) {
      var row = pool(by[i]);
      row.band = i; row.label = bandLabel(i); row.thin = row.weeks < MIN_WEEKS;
      row.marginalRev = row.marginalProfit = null;
      if (!row.thin) {
        if (prev && row.spend > prev.spend) {
          row.marginalRev = (row.rev - prev.rev) / (row.spend - prev.spend);
          row.marginalProfit = (row.profit - prev.profit) / (row.spend - prev.spend);
        }
        prev = row;
      }
      return row;
    });
  }

  // contribution/day = a + b·ln(spend/day). Profit = that − spend peaks at spend = b.
  function logFit(points) {
    var pts = points.filter(function (p) { return p.spend > 0; });
    var n = pts.length;
    if (n < 8) return null;
    var xs = pts.map(function (p) { return Math.log(p.spend); }), ys = pts.map(function (p) { return p.contrib; });
    var mx = mean(xs), my = mean(ys), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my); }
    if (!sxx || !syy) return null;
    var b = sxy / sxx, a = my - b * mx;
    var lo = Math.min.apply(null, pts.map(function (p) { return p.spend; }));
    var hi = Math.max.apply(null, pts.map(function (p) { return p.spend; }));
    return { a: a, b: b, r2: (sxy * sxy) / (sxx * syy), n: n, min: lo, max: hi,
             peak: b > 0 ? b : null, peakInRange: b > lo && b < hi };
  }
  function fitProfit(fit, spend) { return fit.a + fit.b * Math.log(spend) - spend; }

  // Consecutive weeks where spend moved ≥10%: what revenue and profit did next to it.
  function steps(points) {
    var out = [];
    for (var i = 1; i < points.length; i++) {
      var p = points[i - 1], q = points[i];
      if ((new Date(q.key) - new Date(p.key)) / 864e5 !== 7 || !p.spend) continue;
      var move = (q.spend - p.spend) / p.spend;
      if (Math.abs(move) < STEP_MOVE) continue;
      out.push({ from: p.key, to: q.key, y: q.y, base: p.spend, move: move,
                 dSpend: q.spend - p.spend, dRev: q.rev - p.rev, dProfit: q.profit - p.profit,
                 perDollar: (q.rev - p.rev) / (q.spend - p.spend) });
    }
    return out;
  }
  function stepSummary(list, lo, hi) {
    function side(up) {
      var s = list.filter(function (x) { return (x.move > 0) === up && x.base >= lo && x.base < hi; });
      if (!s.length) return null;
      return { n: s.length,
               profitUp: s.filter(function (x) { return x.dProfit > 0; }).length,
               revPerDollar: median(s.map(function (x) { return x.perDollar; })),
               dSpend: median(s.map(function (x) { return x.dSpend; })),
               dRev: median(s.map(function (x) { return x.dRev; })),
               dProfit: median(s.map(function (x) { return x.dProfit; })) };
    }
    return { raises: side(true), cuts: side(false) };
  }

  // Inside each spend band, weeks with more ads than the band's median vs fewer:
  // separates "more creative" from "more budget".
  function adsSplit(points) {
    var by = {}, out = [];
    points.forEach(function (p) { var i = Math.floor(p.spend / BAND); (by[i] = by[i] || []).push(p); });
    Object.keys(by).map(Number).sort(function (a, b) { return a - b; }).forEach(function (i) {
      var g = by[i];
      if (g.length < 2 * MIN_WEEKS) return;
      var med = median(g.map(function (p) { return p.ads50; }));
      var few = g.filter(function (p) { return p.ads50 <= med; }), many = g.filter(function (p) { return p.ads50 > med; });
      if (few.length < MIN_WEEKS || many.length < MIN_WEEKS) return;
      out.push({ band: i, label: bandLabel(i), medianAds: med, few: pool(few), many: pool(many) });
    });
    return out;
  }

  function summary(data, a) {
    var pts = (data.weeks || []).map(function (w) { return perDay(w, a); });
    var bands = bandTable(pts).filter(function (b) { return !b.thin; });
    var best = bands.slice().sort(function (x, y) { return y.profit - x.profit; })[0] || null;
    var firstNeg = bands.filter(function (b) { return b.marginalProfit != null && b.marginalProfit < 0; })[0] || null;
    var recent = pts.slice(-4);
    var fit = logFit(pts);
    var r = rates(a), rev = 0, varCost = 0;
    (data.weeks || []).forEach(function (w) { rev += w.rev; varCost += r.cogs * w.net + r.ship * w.orders + r.fee * w.rev; });
    return { points: pts, bands: bands, best: best, firstNegative: firstNeg, fit: fit,
             recent: recent.length ? pool(recent) : null,
             contributionRate: rev ? 1 - varCost / rev : null,
             breakevenMer: rev && rev > varCost ? rev / (rev - varCost) : null };
  }

  var api = { perDay: perDay, bandTable: bandTable, logFit: logFit, fitProfit: fitProfit, steps: steps,
              stepSummary: stepSummary, adsSplit: adsSplit, summary: summary, bandLabel: bandLabel, rates: rates };

  /* ---------- formatting ---------- */

  function usd(v, d) {
    if (v == null || !isFinite(v)) return '—';
    var s = Math.abs(v) >= 1000 && !d ? Math.round(Math.abs(v)).toLocaleString('en-US') : Math.abs(v).toFixed(d == null ? 0 : d);
    return (v < 0 ? '−$' : '$') + s;
  }
  function usdK(v) { return v == null || !isFinite(v) ? '—' : (v < 0 ? '−$' : '$') + (Math.abs(v) / 1000).toFixed(1) + 'k'; }
  function x2(v) { return v == null || !isFinite(v) ? '—' : v.toFixed(2) + 'x'; }
  function pct(v) { return v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + '%'; }
  function num(v, d) { return v == null || !isFinite(v) ? '—' : v.toFixed(d || 0); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function weekLabel(n) { var d = new Date(Date.UTC(2026, 0, 5 + (n - 2) * 7)); return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate(); }

  /* ---------- view ---------- */

  var CSS = [
    '.sh{color:var(--text,#e8e8f0);font-size:14px;line-height:1.5}',
    '.sh h3{font-size:1.05rem;font-weight:700;margin:0 0 4px}',
    '.sh .sh-sub{color:var(--text-muted,#8888a8);font-size:.82rem;margin:0 0 14px;max-width:920px}',
    '.sh .sh-card{background:var(--card,#171730);border:1px solid var(--border,#252548);border-radius:8px;padding:18px 20px;margin-bottom:14px}',
    '.sh .sh-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-bottom:14px}',
    '.sh .sh-kpi{background:var(--card,#171730);border:1px solid var(--border,#252548);border-radius:8px;padding:14px 16px}',
    '.sh .sh-kpi .l{font-size:.68rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim,#5c5c7a)}',
    '.sh .sh-kpi .v{font-family:var(--font-mono,monospace);font-size:1.45rem;font-weight:700;margin:4px 0 2px}',
    '.sh .sh-kpi .n{font-size:.78rem;color:var(--text-muted,#8888a8)}',
    '.sh .sh-verdict{font-size:.95rem;line-height:1.65;max-width:980px}',
    '.sh .sh-verdict li{margin:0 0 6px 18px}',
    '.sh .sh-play{font-size:1.25rem;font-weight:700;line-height:1.35;margin:0 0 12px;padding-left:14px;border-left:4px solid #3987e5}',
    '.sh .sh-controls{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;margin-bottom:14px}',
    '.sh .sh-controls label{display:flex;flex-direction:column;font-size:.7rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#5c5c7a);gap:4px}',
    '.sh .sh-controls input[type=range]{width:150px;accent-color:#3987e5}',
    '.sh .sh-controls output{font-family:var(--font-mono,monospace);color:var(--text,#e8e8f0);font-size:.85rem;letter-spacing:0;text-transform:none}',
    '.sh .sh-seg{display:inline-flex;border:1px solid var(--border,#252548);border-radius:6px;overflow:hidden}',
    '.sh .sh-seg button{background:none;border:0;color:var(--text-muted,#8888a8);padding:6px 12px;font:inherit;font-size:.78rem;cursor:pointer}',
    '.sh .sh-seg button.on{background:var(--border,#252548);color:var(--text,#e8e8f0)}',
    '.sh .sh-legend{display:flex;gap:16px;font-size:.8rem;color:var(--text-muted,#8888a8);margin:0 0 6px;flex-wrap:wrap}',
    '.sh .sh-legend i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}',
    '.sh .sh-legend i.dot{width:9px;height:9px;border-radius:50%}',
    '.sh .sh-read{font-family:var(--font-mono,monospace);font-size:.78rem;color:var(--text-muted,#8888a8);min-height:2.6em;margin-bottom:4px;display:grid;grid-template-columns:auto repeat(4,minmax(0,1fr));gap:2px 14px;max-width:820px}',
    '.sh .sh-read b{color:var(--text,#e8e8f0);font-weight:600}',
    '.sh .sh-panel{position:relative;height:150px;margin-bottom:2px}',
    '.sh .sh-panel-title{font-size:.72rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#5c5c7a);margin-top:8px}',
    '.sh .sh-chart{position:relative;height:380px}',
    '.sh .sh-scroll{overflow-x:auto}',
    '.sh table{width:100%;border-collapse:collapse;font-size:.82rem}',
    '.sh th{font-size:.66rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#5c5c7a);text-align:right;padding:7px 10px;border-bottom:1px solid var(--border,#252548);white-space:nowrap}',
    '.sh td{text-align:right;padding:7px 10px;border-bottom:1px solid var(--border,#252548);font-family:var(--font-mono,monospace);white-space:nowrap}',
    '.sh th:first-child,.sh td:first-child{text-align:left}',
    '.sh tr.thin td{color:var(--text-dim,#5c5c7a)}',
    '.sh tr.best td:first-child{box-shadow:inset 3px 0 0 #199e70}',
    '.sh .tag{font-family:var(--font-body,inherit);font-size:.7rem;color:var(--text-muted,#8888a8);margin-left:6px}',
    '.sh .sh-note{font-size:.78rem;color:var(--text-muted,#8888a8);margin-top:10px;max-width:980px}',
    '@media(max-width:640px){.sh .sh-read{grid-template-columns:auto repeat(2,minmax(0,1fr))}}'
  ].join('\n');

  function ensureChart(cb) {
    if (root.Chart) return cb();
    var s = document.createElement('script');
    s.src = 'chart.min.js'; s.onload = cb; document.head.appendChild(s);
  }

  var hairline = {
    id: 'shHairline',
    afterDatasetsDraw: function (chart) {
      var i = chart.$shIndex;
      if (i == null || !chart.scales.x) return;
      var x = chart.scales.x.getPixelForValue(i), area = chart.chartArea, ctx = chart.ctx;
      ctx.save(); ctx.strokeStyle = 'rgba(232,232,240,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, area.top); ctx.lineTo(x, area.bottom); ctx.stroke(); ctx.restore();
    }
  };

  function axis(fmt, extra) {
    return Object.assign({ grid: { color: 'rgba(136,136,168,.12)' }, border: { display: false },
                           ticks: { color: NEUTRAL, font: { size: 11 }, callback: fmt, maxTicksLimit: 5 } }, extra || {});
  }

  function mount(el, data) {
    if (!document.getElementById('sh-css')) {
      var st = document.createElement('style'); st.id = 'sh-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    var state = { a: Object.assign({}, data.assumptions), grain: 'week', y: 'profit', charts: [] };
    var years = Array.from(new Set((data.weeks || []).map(function (w) { return w.y; }))).filter(function (y) { return YEAR_COLORS[y]; }).sort();

    el.innerHTML = '<div class="sh">' +
      '<h3>Scale history — did more Meta spend buy more profit?</h3>' +
      '<p class="sh-sub">Shopify D2C (everything except TikTok Shop) against Meta spend and the number of ads running, ' +
      esc(data.first_day) + ' to ' + esc(data.as_of) + '. Profit is an estimate: revenue less product cost, shipping and payment fees at the rates below, less Meta spend. ' +
      'Other ad channels and fixed overhead are not subtracted.</p>' +
      '<div class="sh-kpis" data-sh="kpis"></div>' +
      '<div class="sh-card"><div class="sh-verdict" data-sh="verdict"></div></div>' +
      '<div class="sh-card"><div class="sh-controls">' +
        slider('cogs_pct', 'Product cost, % of net sales', 5, 45, 0.1) +
        slider('ship_per_order', 'Shipping + fulfillment per order', 0, 15, 0.01) +
        slider('fee_pct', 'Payment fees, % of revenue', 0, 6, 0.1) +
        '<label>View<span class="sh-seg" data-sh="grain"><button data-v="week" class="on">Weekly</button><button data-v="month">Monthly</button></span></label>' +
      '</div>' +
      '<div class="sh-legend">' + years.map(function (y) { return '<span><i style="background:' + YEAR_COLORS[y] + '"></i>' + y + '</span>'; }).join('') +
        '<span>per day, averaged over each period · same calendar position, year over year</span></div>' +
      '<div class="sh-read" data-sh="read"></div>' +
      panel('rev', 'Shopify D2C revenue per day') + panel('spend', 'Meta spend per day') +
      panel('profit', 'Estimated profit per day, after Meta') + panel('ads50', 'Ads running per day (at least $50 spend)') +
      '</div>' +
      '<div class="sh-card"><h3>Where the return bends</h3>' +
        '<p class="sh-sub">Each dot is one week. Left to right is more Meta spend per day; the diamonds are the average of each $5k spend band and the line is a fitted diminishing-returns curve.</p>' +
        '<div class="sh-controls"><label>Vertical axis<span class="sh-seg" data-sh="ymetric"><button data-v="profit" class="on">Profit / day</button><button data-v="rev">Revenue / day</button><button data-v="mer">Revenue ÷ Meta spend</button></span></label></div>' +
        '<div class="sh-legend">' + years.map(function (y) { return '<span><i class="dot" style="background:' + YEAR_COLORS[y] + '"></i>' + y + ' weeks</span>'; }).join('') +
        '<span><i class="dot" style="background:#e8e8f0;border-radius:1px;transform:rotate(45deg)"></i>spend-band average</span><span><i style="background:#8888a8"></i>fitted curve</span></div>' +
        '<div class="sh-chart"><canvas data-sh="scatter"></canvas></div>' +
        '<div class="sh-scroll" data-sh="bands" style="margin-top:14px"></div></div>' +
      '<div class="sh-card"><h3>When spend was moved week to week</h3>' +
        '<p class="sh-sub">Back-to-back weeks where Meta spend changed by 10% or more. This compares a week with the one right before it, so season and product drops mostly cancel out.</p>' +
        '<div class="sh-scroll" data-sh="steps"></div></div>' +
      '<div class="sh-card"><h3>Budget or creative?</h3>' +
        '<p class="sh-sub">Chart: ads running against Meta\'s own ROAS, one dot per week. Table: the same spend level, split into weeks with fewer and more ads running.</p>' +
        '<div class="sh-chart" style="height:320px"><canvas data-sh="creative"></canvas></div><div class="sh-scroll" data-sh="split" style="margin-top:14px"></div></div>' +
      '<div class="sh-card"><h3>Month by month</h3><div class="sh-scroll" data-sh="months"></div>' +
        '<p class="sh-note" data-sh="notes"></p></div>' +
      '</div>';

    function slider(key, label, min, max, step) {
      return '<label>' + label + '<input type="range" data-sh-a="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + state.a[key] + '"><output></output></label>';
    }
    function panel(key, title) {
      return '<div class="sh-panel-title">' + title + '</div><div class="sh-panel"><canvas data-sh-panel="' + key + '"></canvas></div>';
    }
    function q(name) { return el.querySelector('[data-sh="' + name + '"]'); }

    function seg(name, key) {
      q(name).addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        state[key] = b.dataset.v;
        Array.prototype.forEach.call(q(name).children, function (c) { c.classList.toggle('on', c === b); });
        render();
      });
    }
    seg('grain', 'grain'); seg('ymetric', 'y');
    Array.prototype.forEach.call(el.querySelectorAll('[data-sh-a]'), function (inp) {
      inp.addEventListener('input', function () { state.a[inp.dataset.shA] = +inp.value; render(); });
    });

    function render() {
      state.charts.forEach(function (c) { c.destroy(); }); state.charts = [];
      Array.prototype.forEach.call(el.querySelectorAll('[data-sh-a]'), function (inp) {
        var k = inp.dataset.shA, v = +inp.value;
        inp.nextElementSibling.textContent = k === 'ship_per_order' ? usd(v, 2) : v.toFixed(1) + '%';
      });
      var S = summary(data, state.a);
      renderKpis(S); renderVerdict(S); renderPanels(); renderScatter(S); renderBands(S);
      renderSteps(S); renderCreative(S); renderMonths(); renderNotes();
    }

    function renderKpis(S) {
      var cards = [];
      if (S.recent) cards.push(['Last 4 weeks', usdK(S.recent.spend) + ' / day', 'Meta spend · ' + x2(S.recent.mer) + ' revenue per $ · est. profit ' + usdK(S.recent.profit) + ' / day']);
      if (S.best) cards.push(['Most profitable spend level', S.best.label + ' / day', 'est. ' + usdK(S.best.profit) + ' profit / day across ' + S.best.weeks + ' weeks']);
      if (S.fit && S.fit.peak) cards.push(['Curve says profit peaks near', usdK(S.fit.peak) + ' / day', (S.fit.peakInRange ? 'inside' : 'outside') + ' the range we have run · fit explains ' + pct(S.fit.r2) + ' of the weekly swing']);
      if (S.breakevenMer) cards.push(['Break-even on the next $', x2(S.breakevenMer), 'extra revenue needed per extra Meta $ at these cost rates']);
      q('kpis').innerHTML = cards.map(function (c) { return '<div class="sh-kpi"><div class="l">' + c[0] + '</div><div class="v">' + c[1] + '</div><div class="n">' + c[2] + '</div></div>'; }).join('');
    }

    function renderVerdict(S) {
      var b = S.bands, be = S.breakevenMer, html = '';
      if (!S.best || b.length < 2) { q('verdict').innerHTML = '<p>Not enough weeks at different spend levels to make a call yet.</p>'; return; }
      // Ceiling: the top of the highest band where the step up still earned break-even revenue per extra dollar.
      var ceil = S.best;
      b.forEach(function (x) { if (x.band > ceil.band && x.band === ceil.band + 1 && x.marginalRev != null && x.marginalRev >= be) ceil = x; });
      var cap = (ceil.band + 1) * BAND, above = b.filter(function (x) { return x.band > ceil.band; });
      var floor = S.best.band * BAND;
      html += '<div class="sh-play">The play: hold Meta at ' + usdK(floor).replace('.0k', 'k') + '–' + usdK(cap).replace('.0k', 'k') + ' a day.' +
        (above.length ? ' Go above ' + usdK(cap).replace('.0k', 'k') + ' only while the extra spend returns ' + usd(be, 2) + ' or more per dollar.' : '') + '</div><ul>';
      html += '<li><b>Profit:</b> weeks at ' + S.best.label + ' a day made the most, about ' + usdK(S.best.profit) + ' a day (' + pct(S.best.margin) + ' of revenue, ' + S.best.weeks + ' weeks).</li>';
      above.forEach(function (x) {
        var dRev = x.rev - ceil.rev, dProfit = x.profit - ceil.profit;
        html += '<li><b>' + x.label + ' a day:</b> ' + (dRev >= 0 ? '+' : '') + usdK(dRev).replace('−', '-') + ' revenue a day, ' +
          (dProfit >= 0 ? '+' + usdK(dProfit) : usdK(dProfit)) + ' profit a day. Over a month that is about ' +
          usdK(dRev * 30) + ' more revenue for ' + usdK(Math.abs(dProfit) * 30) + (dProfit < 0 ? ' less' : ' more') + ' profit (' + x.weeks + ' weeks).</li>';
      });
      if (above.length) {
        html += '<li><b>If revenue is the goal:</b> each revenue dollar bought above ' + usdK(cap).replace('.0k', 'k') + ' cost ' +
          above.map(function (x) { var c = (ceil.profit - x.profit) / (x.rev - ceil.rev); return (c > 0 && isFinite(c) ? usd(c, 2) : '$0') + ' of profit at ' + x.label; }).join(', ') + '.</li>';
        html += '<li><b>How to raise:</b> one step of 20% or less, hold a week, keep it only if revenue rose ' + usd(be, 2) + ' or more per extra dollar. Otherwise go back.</li>';
      }
      var st = steps(S.points), hi = stepSummary(st, cap, Infinity);
      if (hi.raises) html += '<li><b>Track record above ' + usdK(cap).replace('.0k', 'k') + ':</b> spend was raised 10%+ ' + hi.raises.n + ' times from there; profit rose in ' + hi.raises.profitUp + '. It was cut ' + (hi.cuts ? hi.cuts.n : 0) + ' times; profit rose in ' + (hi.cuts ? hi.cuts.profitUp : 0) + '.</li>';
      if (S.recent) html += '<li><b>Now:</b> the last 4 weeks averaged ' + usdK(S.recent.spend) + ' a day, ' + (S.recent.spend > cap ? 'above' : S.recent.spend < floor ? 'below' : 'inside') + ' that range.</li>';
      q('verdict').innerHTML = html + '</ul>';
    }

    function series() {
      var rows = state.grain === 'week' ? data.weeks : data.months;
      var slots = state.grain === 'week' ? 53 : 12, labels = [], by = {};
      for (var i = 1; i <= slots; i++) labels.push(state.grain === 'week' ? weekLabel(i) : MONTHS[i - 1]);
      years.forEach(function (y) { by[y] = new Array(slots).fill(null); });
      rows.forEach(function (r) { if (by[r.y]) by[r.y][r.n - 1] = perDay(r, state.a); });
      return { labels: labels, by: by };
    }

    function renderPanels() {
      var s = series(), keys = ['rev', 'spend', 'profit', 'ads50'], charts = [];
      function read(i) {
        var html = '<span></span><b>Revenue</b><b>Meta spend</b><b>Est. profit</b><b>Ads running</b>';
        years.forEach(function (y) {
          var p = i == null ? null : s.by[y][i];
          html += '<span><i style="display:inline-block;width:10px;height:3px;background:' + YEAR_COLORS[y] + ';margin-right:6px;vertical-align:middle"></i>' + y + (i == null ? '' : ' · ' + s.labels[i]) + '</span>' +
            (p ? '<span>' + usd(p.rev) + '</span><span>' + usd(p.spend) + '</span><span>' + usd(p.profit) + ' (' + pct(p.margin) + ')</span><span>' + num(p.ads50) + ' · ' + x2(p.mer) + '</span>'
               : '<span>—</span><span>—</span><span>—</span><span>—</span>');
        });
        q('read').innerHTML = html;
      }
      function setIndex(i) { charts.forEach(function (c) { c.$shIndex = i; c.draw(); }); read(i); }
      keys.forEach(function (k, ki) {
        var canvas = el.querySelector('[data-sh-panel="' + k + '"]');
        var c = new root.Chart(canvas, {
          type: 'line',
          data: { labels: s.labels, datasets: years.map(function (y) {
            return { label: String(y), data: s.by[y].map(function (p) { return p ? p[k] : null; }), borderColor: YEAR_COLORS[y],
                     backgroundColor: YEAR_COLORS[y], borderWidth: 2, pointRadius: 0, pointHoverRadius: 0, tension: 0.25, spanGaps: false };
          }) },
          options: { responsive: true, maintainAspectRatio: false, animation: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: axis(undefined, { grid: { display: false }, ticks: { color: NEUTRAL, font: { size: 11 }, maxTicksLimit: 12, display: ki === keys.length - 1 } }),
                      y: axis(function (v) { return k === 'ads50' ? v : usdK(v); }, { beginAtZero: k !== 'profit' }) },
            onHover: function (evt, _a, chart) {
              var i = chart.scales.x.getValueForPixel(evt.x);
              setIndex(i == null || i < 0 || i >= s.labels.length ? null : Math.round(i));
            } },
          plugins: [hairline]
        });
        canvas.addEventListener('mouseleave', function () { setIndex(null); });
        charts.push(c); state.charts.push(c);
      });
      read(null);
    }

    function renderScatter(S) {
      var k = state.y, pts = S.points;
      var sets = years.map(function (y) {
        return { label: y + ' weeks', data: pts.filter(function (p) { return p.y === y; }).map(function (p) { return { x: p.spend, y: p[k], p: p }; }),
                 backgroundColor: YEAR_COLORS[y] + 'cc', borderColor: '#171730', borderWidth: 1.5, pointRadius: 5, pointHoverRadius: 7 };
      });
      sets.push({ label: 'Spend-band average', data: S.bands.map(function (b) { return { x: b.spend, y: b[k], b: b }; }),
                  pointStyle: 'rectRot', backgroundColor: '#e8e8f0', borderColor: '#171730', borderWidth: 2, pointRadius: 8, pointHoverRadius: 9 });
      if (S.fit && S.fit.b > 0) {
        var line = [];
        for (var i = 0; i <= 40; i++) {
          var x = S.fit.min + (S.fit.max - S.fit.min) * i / 40, c = S.fit.a + S.fit.b * Math.log(x);
          var p = c - x, rev = S.contributionRate ? c / S.contributionRate : null;
          line.push({ x: x, y: k === 'profit' ? p : k === 'rev' ? rev : rev / x });
        }
        sets.push({ label: 'Fitted curve', type: 'line', data: line, borderColor: NEUTRAL, borderWidth: 2, pointRadius: 0, pointHitRadius: 0, tension: 0.3 });
      }
      state.charts.push(new root.Chart(q('scatter'), {
        type: 'scatter', data: { datasets: sets },
        options: { responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) {
            var r = c.raw;
            if (r.p) return ['Week of ' + r.p.key, 'Meta ' + usd(r.p.spend) + ' / day', 'Revenue ' + usd(r.p.rev) + ' / day (' + x2(r.p.mer) + ')', 'Est. profit ' + usd(r.p.profit) + ' / day (' + pct(r.p.margin) + ')', num(r.p.ads50) + ' ads running'];
            if (r.b) return [r.b.label + ' · ' + r.b.weeks + ' weeks', 'Revenue ' + usd(r.b.rev) + ' / day (' + x2(r.b.mer) + ')', 'Est. profit ' + usd(r.b.profit) + ' / day'];
            return 'Fitted curve';
          } } } },
          scales: { x: axis(usdK, { title: { display: true, text: 'Meta spend per day', color: NEUTRAL } }),
                    y: axis(k === 'mer' ? function (v) { return v.toFixed(1) + 'x'; } : usdK, { title: { display: true, color: NEUTRAL, text: k === 'profit' ? 'Estimated profit per day' : k === 'rev' ? 'Shopify D2C revenue per day' : 'Revenue per Meta dollar' } }) } }
      }));
    }

    function table(head, rows) {
      return '<table><thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
    }
    function tr(cells, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }

    function renderBands(S) {
      var all = bandTable(S.points), byYear = {};
      years.forEach(function (y) { bandTable(S.points, y).forEach(function (b) { (byYear[b.band] = byYear[b.band] || {})[y] = b; }); });
      var head = ['Meta spend / day', 'Weeks'].concat(years.map(function (y) { return y + ' wks'; }), ['Revenue / day', 'Revenue ÷ spend', 'Meta ROAS', 'Est. profit / day', 'Margin', 'Ads running', 'Extra revenue per extra $', 'Extra profit per extra $']);
      q('bands').innerHTML = table(head, all.map(function (b) {
        return tr([b.label + (S.best && b.band === S.best.band ? '<span class="tag">most profit</span>' : '') + (b.thin ? '<span class="tag">too few weeks</span>' : ''), b.weeks].concat(
          years.map(function (y) { var r = (byYear[b.band] || {})[y]; return r ? r.weeks : 0; }),
          [usd(b.rev), x2(b.mer), x2(b.roas), usd(b.profit), pct(b.margin), num(b.ads50), usd(b.marginalRev, 2), usd(b.marginalProfit, 2)]),
          (b.thin ? 'thin' : '') + (S.best && b.band === S.best.band ? ' best' : ''));
      }));
    }

    function renderSteps(S) {
      var st = steps(S.points), rows = [];
      [[0, 15000, 'under $15k'], [15000, 20000, '$15–20k'], [20000, 25000, '$20–25k'], [25000, Infinity, '$25k and up'], [0, Infinity, 'All']].forEach(function (g) {
        var s = stepSummary(st, g[0], g[1]);
        [['Raised', s.raises], ['Cut', s.cuts]].forEach(function (d) {
          if (!d[1]) return;
          rows.push(tr([g[2] + ' · ' + d[0], d[1].n, usd(d[1].dSpend), usd(d[1].dRev), usd(d[1].dProfit), d[1].profitUp + ' of ' + d[1].n, usd(d[1].revPerDollar, 2)], d[1].n < MIN_WEEKS ? 'thin' : ''));
        });
      });
      q('steps').innerHTML = table(['Spend before the move', 'Times', 'Typical spend change / day', 'Typical revenue change / day', 'Typical profit change / day', 'Profit went up', 'Revenue per $ moved'], rows);
    }

    function renderCreative(S) {
      state.charts.push(new root.Chart(q('creative'), {
        type: 'scatter',
        data: { datasets: years.map(function (y) {
          return { label: String(y), data: S.points.filter(function (p) { return p.y === y && p.roas != null; }).map(function (p) { return { x: p.ads50, y: p.roas, p: p }; }),
                   backgroundColor: YEAR_COLORS[y] + 'cc', borderColor: '#171730', borderWidth: 1.5, pointRadius: 5, pointHoverRadius: 7 };
        }) },
        options: { responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) {
            var p = c.raw.p; return ['Week of ' + p.key, num(p.ads50) + ' ads running (' + num(p.ads) + ' with any spend)', 'Meta ' + usd(p.spend) + ' / day · ' + usd(p.spendPerAd) + ' per ad', 'Meta ROAS ' + x2(p.roas) + ' · revenue ÷ spend ' + x2(p.mer)];
          } } } },
          scales: { x: axis(undefined, { title: { display: true, text: 'Ads running per day (at least $50 spend)', color: NEUTRAL } }),
                    y: axis(function (v) { return v.toFixed(1) + 'x'; }, { title: { display: true, text: 'Meta-reported ROAS', color: NEUTRAL } }) } }
      }));
      var rows = [];
      adsSplit(S.points).forEach(function (g) {
        rows.push(tr([g.label + ' · fewer ads', g.few.weeks, num(g.few.ads50), usd(g.few.spendPerAd), x2(g.few.roas), x2(g.few.mer), usd(g.few.profit)]));
        rows.push(tr([g.label + ' · more ads', g.many.weeks, num(g.many.ads50), usd(g.many.spendPerAd), x2(g.many.roas), x2(g.many.mer), usd(g.many.profit)]));
      });
      q('split').innerHTML = rows.length ? table(['Same spend, split by ads running', 'Weeks', 'Ads running', 'Spend per ad / day', 'Meta ROAS', 'Revenue ÷ spend', 'Est. profit / day'], rows)
        : '<p class="sh-note">Not enough weeks in any one spend band to split by ads running.</p>';
    }

    function renderMonths() {
      var by = {};
      data.months.forEach(function (m) { (by[m.n] = by[m.n] || {})[m.y] = perDay(m, state.a); });
      var head = ['Month'];
      years.forEach(function (y) { head.push(y + ' Meta / day', y + ' revenue / day', y + ' rev ÷ spend', y + ' profit / day', y + ' margin', y + ' ads'); });
      q('months').innerHTML = table(head, Object.keys(by).map(Number).sort(function (a, b) { return a - b; }).map(function (n) {
        var cells = [MONTHS[n - 1]];
        years.forEach(function (y) { var p = by[n][y]; cells.push(p ? usd(p.spend) : '—', p ? usd(p.rev) : '—', p ? x2(p.mer) : '—', p ? usd(p.profit) : '—', p ? pct(p.margin) : '—', p ? num(p.ads50) : '—'); });
        return tr(cells);
      }));
    }

    function renderNotes() {
      var d = data.definitions || {}, miss = (data.missing_days || []).length;
      q('notes').innerHTML = 'Revenue: ' + esc(d.rev || '') + ' Meta ROAS is platform-reported (7-day click / 1-day view). ' +
        'Profit uses planning rates, not measured costs' + (data.assumptions && data.assumptions.source ? ' (' + esc(data.assumptions.source) + ')' : '') + '; move the sliders to test them. ' +
        'Google, AppLovin, TikTok and other ad spend, and about ' + usd((data.assumptions || {}).overhead_month) + ' a month of fixed overhead, are not subtracted. ' +
        'Spend levels are not a controlled test: high-spend weeks often coincide with drops and holidays. ' +
        (miss ? miss + ' day(s) missing from a source are left out. ' : '') + 'Data through ' + esc(data.as_of) + '.';
    }

    ensureChart(render);
    return { state: state, render: render };
  }

  api.mount = mount;

  /* ---------- dashboard tab ---------- */

  function install() {
    var tabs = document.querySelector('.tabs');
    if (!tabs || document.getElementById('tab-scale_history')) return;
    var btn = document.createElement('div');
    btn.className = 'tab'; btn.dataset.tab = 'scale_history'; btn.textContent = 'SCALE HISTORY';
    var after = tabs.querySelector('[data-tab="scaling"]');
    tabs.insertBefore(btn, after ? after.nextSibling : null);
    var pane = document.createElement('div');
    pane.id = 'tab-scale_history'; pane.className = 'tab-content';
    var host = document.getElementById('tab-scaling');
    (host ? host.parentNode : document.body).insertBefore(pane, host ? host.nextSibling : null);
    var loaded = false;
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.classList.remove('active'); });
      Array.prototype.forEach.call(document.querySelectorAll('.tab-content'), function (c) { c.classList.remove('active'); });
      document.body.classList.remove('reports-active');
      btn.classList.add('active'); pane.classList.add('active');
      if (loaded) return;
      loaded = true;
      pane.innerHTML = '<p style="color:var(--text-muted)">Loading scale history…</p>';
      fetch('growth/scaling_history.json', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) { mount(pane, data); })
        .catch(function (e) { loaded = false; pane.innerHTML = '<p style="color:var(--text-muted)">Scale history feed (growth/scaling_history.json) is not available: ' + esc(e.message) + '</p>'; });
    });
  }

  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ScaleHistory = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
