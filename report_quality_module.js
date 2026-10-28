/* =====================================================================
   COLDEST · REPORT QUALITY + POLISH LAYER
   Tell a real loss day from a data hole. Each revenue channel is compared
   with its median on the same weekday over the previous 4 weeks (REPORTS +
   PARTIAL_REPORTS). Missing on a weekday that usually has revenue = hole
   (verdict greyed, INCOMPLETE). Missing on a weekday that usually has none
   (Whatnot weekends) = expected. 60%+ below its usual = Check (only drops:
   promo spikes are real sales, a hole only ever reads low). A partial
   headline that does not equal its own channels is flagged too. Baselines
   are comparisons only — never added to a total, never shown as data.

   Polish: −$3,856 (not $-3,856), ET times instead of raw ISO stamps,
   weekday dates, one as-of bar, a 30-day at-a-glance table, and cards older
   than a week folded behind one click (deep links still open them).

   Display-only augmentation: wraps the template's render functions and
   re-applies after each render. No MutationObserver (froze Analytics once).
   Same rules as the email: cfo_backend/report_quality.py in
   davidstarkk/coldest-cfo-dashboard.
   ===================================================================== */
(function (root) {
  'use strict';

  var CHANNELS = ['shopify', 'amazon', 'tiktok', 'whatnot'];
  var LABELS = { shopify: 'Shopify', amazon: 'Amazon', tiktok: 'TikTok', whatnot: 'Whatnot' };
  var CLOSED_KEYS = { shopify: 'shop_revenue', amazon: 'amz_revenue', tiktok: 'tiktok_revenue', whatnot: 'whatnot_revenue' };
  var WEEKS = 4, MIN_WEEKS = 2, DROP_PCT = 60, SHOW_RECENT = 7, GLANCE_DAYS = 30;
  var MISSING = '—';
  var GREY = '#9090b0';
  var ISO_STAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})/g;

  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function money(v, places) {
    var n = num(v);
    if (n == null) return MISSING;
    var p = places == null ? 2 : places;
    return (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: p, maximumFractionDigits: p });
  }

  function stampET(iso) {
    var t = new Date(iso);
    if (isNaN(t.getTime())) return String(iso == null ? '' : iso);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }).format(t) + ' ET';
  }

  function noon(date) { return new Date(date + 'T12:00:00Z'); }

  function dayLabel(date) {
    var d = noon(date);
    if (isNaN(d.getTime())) return String(date);
    return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  }

  function weekdayName(date) {
    return noon(date).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' });
  }

  function shiftDate(date, days) {
    var d = noon(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function median(vals) {
    var s = vals.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function presentPartial(c) {
    return !!c && num(c.revenue) != null && c.data_available !== false && !c.zero_assumed;
  }

  /* date → { date, closed, channels: { ch: revenue | null (no data) }, row }.
     Closed REPORTS win over a partial for the same date, as in renderReports. */
  function series(reports, partials) {
    var map = {};
    (partials || []).forEach(function (r) {
      if (!r || !r.date) return;
      var obs = r.channel_observations || {}, ch = {};
      CHANNELS.forEach(function (k) { ch[k] = presentPartial(obs[k]) ? num(obs[k].revenue) : null; });
      map[r.date] = { date: r.date, closed: false, channels: ch, row: r };
    });
    (reports || []).forEach(function (r) {
      if (!r || !r.date) return;
      var ch = {};
      CHANNELS.forEach(function (k) { ch[k] = num(r[CLOSED_KEYS[k]]); });
      map[r.date] = { date: r.date, closed: true, channels: ch, row: r };
    });
    return map;
  }

  function baselines(date, map) {
    var out = {};
    CHANNELS.forEach(function (k) {
      var vals = [];
      for (var w = 1; w <= WEEKS; w++) {
        var e = map[shiftDate(date, -7 * w)];
        if (e) vals.push(e.channels[k] == null ? 0 : e.channels[k]);
      }
      out[k] = vals.length >= MIN_WEEKS ? median(vals) : null;
    });
    return out;
  }

  function assess(date, map) {
    var e = map[date];
    if (!e) return null;
    var usual = baselines(date, map);
    var q = { date: date, weekday: weekdayName(date), closed: e.closed, missing: [], expectedZero: [], anomalies: [], status: {}, mismatch: null };
    CHANNELS.forEach(function (k) {
      var v = e.channels[k], base = usual[k];
      if (v == null) {
        if (base === 0) { q.expectedZero.push(k); q.status[k] = 'none_expected'; }
        else { q.missing.push({ channel: k, label: LABELS[k], usual: base }); q.status[k] = 'missing'; }
        return;
      }
      q.status[k] = 'in';
      if (base) {
        var pct = (v / base - 1) * 100;
        if (pct <= -DROP_PCT) {
          q.anomalies.push({ channel: k, label: LABELS[k], revenue: v, usual: base, pct: pct });
          q.status[k] = 'check';
        }
      }
    });
    if (!e.closed) {
      var head = num((e.row.provisional_totals || {}).revenue);
      var sum = CHANNELS.reduce(function (s, k) { return s + (e.channels[k] || 0); }, 0);
      if (head != null && Math.abs(head - sum) > Math.max(1, 0.01 * sum)) q.mismatch = { headline: head, channels: sum };
    }
    q.sourcesIn = CHANNELS.filter(function (k) { return q.status[k] === 'in' || q.status[k] === 'check'; }).length;
    q.sourcesExpected = CHANNELS.length - q.expectedZero.length;
    q.incomplete = q.missing.length > 0 || !!q.mismatch;
    return q;
  }

  function checks(q) {
    if (!q) return [];
    var out = q.missing.map(function (m) {
      return m.label + ' — no data yet' + (m.usual ? '; usual ' + q.weekday + ' ≈ ' + money(m.usual, 0) + '. Revenue and profit exclude it.' : '; no same-weekday history to compare.');
    });
    if (q.mismatch) {
      out.push('Headline revenue ' + money(q.mismatch.headline, 0) + ' does not match its channels (' + money(q.mismatch.channels, 0) +
        '). The day\'s totals were not recomputed after a restore, so its net profit is not reliable.');
    }
    q.anomalies.forEach(function (a) {
      out.push(a.label + ' ' + money(a.revenue, 0) + ' — ' + Math.abs(a.pct).toFixed(0) + '% below a usual ' + q.weekday +
        ' (' + money(a.usual, 0) + '). Check the source before reading the day.');
    });
    return out;
  }

  function chip(q) {
    if (!q) return null;
    if (q.missing.length) return { text: q.missing.map(function (m) { return m.label; }).join(' + ') + ' missing', cls: 'rq-warn' };
    if (q.mismatch) return { text: 'Totals don\'t add up', cls: 'rq-warn' };
    if (q.anomalies.length) return { text: 'Check ' + q.anomalies.map(function (a) { return a.label; }).join(', '), cls: 'rq-warn' };
    return { text: q.sourcesIn + ' of ' + q.sourcesExpected + ' sources in', cls: 'rq-ok' };
  }

  /* Newest-first dates, same list renderReports shows. */
  function sortedDates(map) {
    return Object.keys(map).sort(function (a, b) { return b.localeCompare(a); });
  }

  /* ------------------------------------------------------------------ DOM */

  var CSS = [
    '.rq-chip{display:inline-block;margin-left:8px;padding:1px 7px;border:1px solid currentColor;border-radius:999px;font-size:.6rem;font-weight:700;letter-spacing:.08em;vertical-align:middle;white-space:nowrap}',
    '.rq-ok{color:var(--green)}.rq-warn{color:var(--yellow)}.rq-muted{color:var(--text-muted)}',
    '.rq-checks{margin:4px 0 18px;padding:12px 14px;border:1px solid rgba(245,158,11,.45);border-radius:8px;background:rgba(245,158,11,.06)}',
    '.rq-checks .section-title{margin:0 0 8px;padding:0;color:var(--yellow)}',
    '.rq-checks ul{margin:0;padding-left:20px;color:var(--yellow);line-height:1.6;font-size:.85rem}',
    '#rq-asof{display:none;flex-wrap:wrap;gap:6px 20px;max-width:1400px;margin:0 auto 12px;padding:10px 14px;border:1px solid var(--border);border-radius:8px;background:var(--surface);font-size:.78rem;color:var(--text-muted)}',
    'body.reports-active #rq-asof{display:flex}',
    '#rq-asof b{color:var(--text);font-weight:600}',
    '.rq-yday-note{grid-column:1/-1;font-size:.82rem;color:var(--yellow)}',
    '#rq-glance{margin:4px 0 16px}',
    '#rq-glance .rq-scroll{overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--card)}',
    '#rq-glance td,#rq-glance th{padding:7px 10px;white-space:nowrap}',
    '#rq-glance tbody tr{cursor:pointer}#rq-glance tbody tr:hover{background:var(--card-hover)}',
    '#rq-glance td.rq-data,#rq-glance th.rq-data{text-align:left;font-family:var(--font-body);font-size:.72rem}',
    '.report-card.rq-folded{display:none}',
    '.rq-more{display:block;width:100%;margin:2px 0 12px;padding:10px;border:1px dashed var(--border);border-radius:8px;background:transparent;color:var(--cyan);font:600 .72rem var(--font-body);letter-spacing:.1em;text-transform:uppercase;cursor:pointer}',
    '@media (max-width:600px){#rq-glance .rq-hide-sm{display:none}#rq-glance td,#rq-glance th{padding:7px 6px}}'
  ].join('\n');

  var unfolded = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function injectCss() {
    if (document.getElementById('rq-style')) return;
    var s = el('style');
    s.id = 'rq-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* −$ and ET times in visible text (never touches markup or data). */
  function fixText(node) {
    if (!node) return;
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    var todo = [], n;
    while ((n = walker.nextNode())) {
      var s = n.nodeValue;
      ISO_STAMP.lastIndex = 0;
      if (s.indexOf('$-') !== -1 || ISO_STAMP.test(s)) todo.push(n);
    }
    todo.forEach(function (t) {
      t.nodeValue = t.nodeValue.replace(/\$-(?=\d)/g, '−$').replace(ISO_STAMP, stampET);
    });
  }

  function checksBox(flags) {
    var box = el('div', 'rq-checks');
    box.appendChild(el('div', 'section-title', 'Check before reading the day'));
    var ul = el('ul');
    flags.forEach(function (f) { ul.appendChild(el('li', null, f)); });
    box.appendChild(ul);
    return box;
  }

  function decorateCard(card, map) {
    var date = card.getAttribute('data-date');
    var e = map[date];
    if (!e || e.closed) return;
    var q = assess(date, map);
    var h3 = card.querySelector('.report-header h3');
    if (h3 && h3.firstChild && h3.firstChild.nodeType === 3 && /^\s*\d{4}-\d{2}-\d{2}/.test(h3.firstChild.nodeValue)) {
      h3.firstChild.nodeValue = dayLabel(date) + ' ';
    }
    var tag = card.querySelector('.day-tag');
    var c = chip(q);
    if (tag && c && !tag.querySelector('.rq-chip')) tag.appendChild(el('span', 'rq-chip ' + c.cls, c.text));
    if (q.incomplete) {
      card.style.borderLeftColor = GREY;
      var mv = card.querySelector('.report-header .mer-val');
      if (mv) { mv.style.color = GREY; mv.title = 'Incomplete day — not a profit or loss verdict yet'; }
      card.querySelectorAll('.report-body .section-title').forEach(function (t) {
        if (/^NET PROFIT:/.test(t.textContent)) t.style.color = GREY;
      });
    }
    var body = card.querySelector('.report-body');
    var flags = checks(q);
    if (body && flags.length && !body.querySelector('.rq-checks')) body.insertBefore(checksBox(flags), body.firstChild);
    if (!body) return;
    Array.prototype.forEach.call(body.querySelectorAll('tr'), function (tr) {
      var cells = tr.cells;
      if (!cells || cells.length < 5) return;
      var name = ((cells[0].firstChild && cells[0].firstChild.nodeValue) || '').trim().toLowerCase();
      if (q.status[name] !== 'missing') return;
      for (var i = 1; i < 5; i++) cells[i].textContent = MISSING;
      var m = q.missing.filter(function (x) { return x.channel === name; })[0];
      var small = cells[0].querySelector('small');
      if (small) {
        small.textContent = 'Missing' + (m && m.usual ? ' — usual ' + q.weekday + ' ≈ ' + money(m.usual, 0) : '') + ' · adds $0 to totals';
        small.style.color = 'var(--yellow)';
      }
    });
  }

  function decorateLatest(map) {
    var bar = document.getElementById('yday-bar');
    var dateEl = bar && bar.querySelector('.yday-date');
    if (!dateEl) return;
    var date = dateEl.getAttribute('data-rq-date') || dateEl.textContent.trim();
    var e = map[date];
    if (!e || e.closed) return;
    var q = assess(date, map);
    dateEl.setAttribute('data-rq-date', date);
    dateEl.textContent = dayLabel(date);
    var c = chip(q);
    Array.prototype.forEach.call(bar.querySelectorAll('.yday-sub'), function (sub) {
      if (/source channels/.test(sub.textContent)) sub.textContent = q.sourcesIn + ' of ' + q.sourcesExpected + ' sources in' + (q.missing.length ? ' · ' + c.text : '');
    });
    if (!q.incomplete) return;
    Array.prototype.forEach.call(bar.querySelectorAll('.yday-value'), function (v) { if (v.style.color) v.style.color = GREY; });
    if (!bar.querySelector('.rq-yday-note')) {
      bar.appendChild(el('div', 'rq-yday-note', 'Incomplete — not a profit or loss verdict yet. ' + checks(q)[0]));
    }
  }

  function relabelAverages(reports) {
    var head = document.querySelector('#avg30-bar .avg30-header');
    if (!head || head.getAttribute('data-rq')) return;
    var sorted = (reports || []).map(function (r) { return r.date; }).filter(Boolean).sort().slice(-30);
    if (!sorted.length) return;
    head.textContent = '30-day average · last ' + sorted.length + ' closed days (' + dayLabel(sorted[0]) + ' – ' + dayLabel(sorted[sorted.length - 1]) + ')';
    head.setAttribute('data-rq', '1');
  }

  function asOfBar(map, reports) {
    var slot = document.getElementById('rolling-mer-slot');
    if (!slot || !slot.parentNode) return;
    var bar = document.getElementById('rq-asof');
    if (!bar) {
      bar = el('div');
      bar.id = 'rq-asof';
      slot.parentNode.insertBefore(bar, slot);
    }
    var dates = sortedDates(map);
    var latest = dates[0];
    var q = latest ? assess(latest, map) : null;
    var closed = (reports || []).map(function (r) { return r.date; }).filter(Boolean).sort().pop();
    var parts = [];
    if (latest) parts.push(['Latest day', dayLabel(latest) + (q && !q.closed ? ' · ' + chip(q).text : '')]);
    if (closed) parts.push(['Closed P&L through', dayLabel(closed)]);
    var openDays = dates.filter(function (d) { return !map[d].closed; }).length;
    if (openDays) parts.push(['Open (partial) days', String(openDays)]);
    bar.textContent = '';
    parts.forEach(function (p) {
      var span = el('span');
      span.appendChild(document.createTextNode(p[0] + ': '));
      span.appendChild(el('b', null, p[1]));
      bar.appendChild(span);
    });
  }

  function openDate(date) {
    unfold();
    if (root.location.hash === '#' + date && typeof root.openFromHash === 'function') root.openFromHash();
    else root.location.hash = date;
  }

  function glance(map) {
    var tab = document.getElementById('tab-reports');
    if (!tab || document.getElementById('rq-glance')) return;
    var dates = sortedDates(map).slice(0, GLANCE_DAYS);
    if (!dates.length) return;
    var wrap = el('div');
    wrap.id = 'rq-glance';
    wrap.appendChild(el('div', 'section-title', 'Last ' + dates.length + ' days at a glance'));
    var scroll = el('div', 'rq-scroll');
    var table = el('table');
    var thead = el('thead'), hr = el('tr');
    [['Day'], ['Revenue'], ['Net profit'], ['MER', 'rq-hide-sm'], ['Data', 'rq-data']].forEach(function (h) { hr.appendChild(el('th', h[1] || null, h[0])); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    dates.forEach(function (d) {
      var e = map[d], r = e.row, q = assess(d, map);
      var p = e.closed ? { revenue: r.total_revenue, net_profit: r.net_profit, mer: r.mer } : (r.provisional_totals || {});
      var tr = el('tr');
      tr.appendChild(el('td', null, dayLabel(d)));
      tr.appendChild(el('td', null, money(p.revenue, 0)));
      var net = el('td', null, money(p.net_profit, 0));
      var n = num(p.net_profit);
      net.style.color = q && q.incomplete && !e.closed ? GREY : n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text-muted)';
      tr.appendChild(net);
      tr.appendChild(el('td', 'rq-hide-sm', num(p.mer) == null ? MISSING : Number(p.mer).toFixed(2) + 'x'));
      var c = e.closed ? { text: 'Closed', cls: 'rq-muted' } : chip(q);
      var data = el('td', 'rq-data');
      data.appendChild(el('span', 'rq-chip ' + c.cls, c.text));
      tr.appendChild(data);
      tr.addEventListener('click', function () { openDate(d); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    tab.insertBefore(wrap, tab.firstChild);
  }

  function fold() {
    var tab = document.getElementById('tab-reports');
    if (!tab || unfolded) return;
    var cards = tab.querySelectorAll('.report-card[data-date]');
    var hash = (root.location.hash || '').slice(1);
    var targetIdx = -1;
    Array.prototype.forEach.call(cards, function (card, i) { if (card.getAttribute('data-date') === hash) targetIdx = i; });
    if (cards.length <= SHOW_RECENT || targetIdx >= SHOW_RECENT) { unfold(); return; }
    if (tab.querySelector('.rq-more')) return;
    for (var i = SHOW_RECENT; i < cards.length; i++) cards[i].classList.add('rq-folded');
    var btn = el('button', 'rq-more', 'Show ' + (cards.length - SHOW_RECENT) + ' earlier days');
    btn.type = 'button';
    btn.addEventListener('click', unfold);
    cards[SHOW_RECENT - 1].parentNode.insertBefore(btn, cards[SHOW_RECENT]);
  }

  function unfold() {
    unfolded = true;
    var tab = document.getElementById('tab-reports');
    if (!tab) return;
    Array.prototype.forEach.call(tab.querySelectorAll('.report-card.rq-folded'), function (c) { c.classList.remove('rq-folded'); });
    var btn = tab.querySelector('.rq-more');
    if (btn) btn.parentNode.removeChild(btn);
  }

  function apply() {
    if (typeof document === 'undefined') return;
    var reports = typeof REPORTS !== 'undefined' ? REPORTS : root.REPORTS;
    var partials = typeof PARTIAL_REPORTS !== 'undefined' ? PARTIAL_REPORTS : root.PARTIAL_REPORTS;
    var map = series(reports, partials);
    injectCss();
    var tab = document.getElementById('tab-reports');
    if (tab) Array.prototype.forEach.call(tab.querySelectorAll('.report-card[data-date]'), function (card) { decorateCard(card, map); });
    glance(map);
    fold();
    decorateLatest(map);
    relabelAverages(reports);
    asOfBar(map, reports);
    fixText(document.getElementById('reports-summary'));
    fixText(tab);
  }

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () {
      pending = null;
      try { apply(); } catch (err) { if (root.console) root.console.error('[report-quality]', err); }
    }, 0);
  }

  function wrap(name) {
    var fn = root[name];
    if (typeof fn !== 'function' || fn.__rqWrapped) return;
    var wrapped = function () {
      var out = fn.apply(this, arguments);
      schedule();
      return out;
    };
    wrapped.__rqWrapped = true;
    root[name] = wrapped;
  }

  function boot() {
    ['renderReports', 'renderYesterday', 'render30DayAverages'].forEach(wrap);
    if (root.addEventListener) {
      root.addEventListener('hashchange', function () {
        var hash = (root.location.hash || '').slice(1);
        var card = hash && document.getElementById('report-' + hash);
        if (card && card.classList.contains('rq-folded')) {
          unfold();
          if (typeof root.openFromHash === 'function') root.openFromHash();
        }
      });
    }
    schedule();
    setTimeout(schedule, 1500);
  }

  var api = {
    CHANNELS: CHANNELS, money: money, stampET: stampET, dayLabel: dayLabel, series: series,
    baselines: baselines, assess: assess, checks: checks, chip: chip, apply: apply
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ReportQuality = api;
  if (typeof document !== 'undefined') boot();
})(typeof window !== 'undefined' ? window : globalThis);
