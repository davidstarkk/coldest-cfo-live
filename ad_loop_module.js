/* =====================================================================
   COLDEST · FEEDS & GROK LOOP — is every channel feeding, and what the
   CFO rule says about each one
   ---------------------------------------------------------------------
   Reporting-only. Reads two feeds the data repo rebuilds every morning
   (davidstarkk/coldest-cfo-dashboard, cfo_backend/ad_loop.py →
   lib/publish_live_feeds.sh):

     ads_throttle/feed_health.json   per channel: fresh / stale / quiet,
         last measured day, a 14-day strip, and how old Grok's own files are
     ads_throttle/cfo_brief.json     per channel: the 7-day ROAS rule verdict,
         what blocks it, Grok's number next to the CFO's, open asks, and
         what each logged budget change did

   Nothing is computed here: no ROAS, no verdict, no status. A missing day
   is drawn as missing, never as $0. Contract: docs/GROK_LOOP.md in the data
   repo.
   ===================================================================== */
(function (root) {
  'use strict';

  var FEEDS = { health: 'ads_throttle/feed_health.json', brief: 'ads_throttle/cfo_brief.json' };
  var VERDICT = {
    raise: { text: 'Raise', cls: 'lp-good' }, cut: { text: 'Cut', cls: 'lp-bad' }, kill: { text: 'Kill', cls: 'lp-bad' },
    hold: { text: 'Hold', cls: 'lp-warn' }, cooldown: { text: 'Cooldown', cls: 'lp-warn' },
    tracking_down: { text: 'Tracking down', cls: 'lp-bad' }, paused: { text: 'Paused', cls: 'lp-muted' },
    learning: { text: 'Learning', cls: 'lp-muted' }, not_launched: { text: 'Not launched', cls: 'lp-muted' },
    insufficient: { text: 'No read', cls: 'lp-muted' }
  };
  var FEED = {
    fresh: { text: 'Fresh', cls: 'lp-good' }, stale: { text: 'Behind', cls: 'lp-bad' },
    no_feed: { text: 'No feed', cls: 'lp-bad' }, quiet: { text: 'Quiet', cls: 'lp-muted' }
  };
  var DAY = { '#': ['lp-d-spend', 'spend'], '0': ['lp-d-zero', 'measured $0'], '-': ['lp-d-off', 'not live'], '.': ['lp-d-miss', 'missing'] };
  var OUTCOME = {
    improved: 'lp-good', worse: 'lp-bad', flat: 'lp-warn', spend_stopped: 'lp-muted', pending: 'lp-muted', unmeasured: 'lp-muted'
  };

  /* ------------------------------------------------------------ utils */
  function num(v) { if (v == null || v === '') return null; var n = Number(v); return Number.isFinite(n) ? n : null; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function usd(v) { var n = num(v); return n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'); }
  function x(v) { var n = num(v); return n == null ? '—' : n.toFixed(2) + 'x'; }
  function pct(v) { var n = num(v); return n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function md(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? Number(m[2]) + '/' + Number(m[3]) : '—'; }
  function addDays(iso, n) {
    var d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
  }

  /* ------------------------------------------------------------ pure */
  function blockerText(b) {
    var s = String(b || '');
    if (s.indexOf('mode:') === 0) return s.slice(5) + ' mode';
    if (s.indexOf('feed_gap:') === 0) return 'feed gap (' + s.slice(9) + ')';
    if (s.indexOf('no_platform_revenue:') === 0) return 'no platform revenue (' + s.slice(20) + ')';
    if (s.indexOf('spend_stopped:') === 0) return 'spend stopped after ' + md(s.slice(14));
    if (s === 'roas_disputed') return 'CFO and Grok disagree';
    if (s === 'tracking_down') return 'tracking down';
    return s;
  }

  function kpis(brief, health) {
    var p = (brief && brief.portfolio) || {}, s = (brief && brief.summary) || {}, hs = (health && health.summary) || {};
    return {
      asOf: (brief && brief.as_of) || (health && health.as_of) || null,
      feedStatus: hs.status || null, lagDays: num(hs.as_of_lag_days),
      mer7d: num(p.mer_7d), merTarget: num(p.mer_target), merGap: num(p.mer_gap),
      judgedPct: num(p.spend_judged_pct), autoPct: num(p.spend_in_auto_mode_pct),
      actNow: s.act_now || [], openAsks: num(s.open_asks) || 0, openHigh: num(s.open_asks_high) || 0,
      stale: hs.channels_stale || [], staleFiles: hs.grok_files_stale || []
    };
  }

  function boardRows(brief, health) {
    var chs = (brief && brief.channels) || {}, hc = (health && health.channels) || {};
    return Object.keys(chs).map(function (id) {
      var c = chs[id] || {}, h = hc[id] || {}, g = c.grok || null;
      return {
        id: id, label: c.label || id, mode: c.mode || 'view', owner: c.owner_bot || null,
        verdict: VERDICT[c.verdict] ? c.verdict : 'insufficient', ruleSays: c.rule_says || '', actionable: c.actionable === true,
        spend: num(c.spend_7d), spendDays: num(c.spend_days_measured), roas: num(c.roas_7d), roasPrior: num(c.roas_prior_7d),
        roasSource: c.roas_source || null,
        blockers: (c.blockers || []).map(blockerText), cautions: c.cautions || [],
        grokRoas: g ? num(g.roas_7d) : null, grokTier: g ? (g.tier_label || g.tier || null) : null, grokAsOf: g ? g.as_of : null,
        feed: FEED[h.status] ? h.status : null, lastDay: h.last_measured_day || null, behind: num(h.days_behind),
        strip: String(h.days_14 || ''), window: h.window_14 || null
      };
    }).sort(function (a, b) { return (b.spend || 0) - (a.spend || 0); });
  }

  /* one cell per day of the 14-day strip, oldest first, with its date */
  function dayCells(strip, windowStr) {
    var start = String(windowStr || '').split('..')[0];
    return String(strip || '').split('').map(function (ch, i) {
      var meta = DAY[ch] || DAY['.'];
      return { cls: meta[0], state: meta[1], date: /^\d{4}-\d{2}-\d{2}$/.test(start) ? addDays(start, i) : null };
    });
  }

  function askRows(brief) {
    return ((brief && brief.asks) || []).map(function (a) {
      var ack = a.ack && a.ack.status ? a.ack : null;
      return {
        id: a.id, severity: a.severity || 'low', title: a.title || '', detail: a.detail || '', owner: a.owner || null,
        age: num(a.age_days) || 0, ack: ack ? ack.status : null, ackNote: ack ? (ack.note || '') : '',
        open: !(ack && (ack.status === 'done' || ack.status === 'wont_do'))
      };
    });
  }

  function outcomeRows(brief) {
    return ((brief && brief.change_outcomes) || []).map(function (o) {
      var b = o.before || {}, a = o.after || {};
      return {
        date: o.date, channel: o.channel, action: String(o.action || '').replace(/_/g, ' '), executed: o.executed !== false,
        outcome: OUTCOME[o.outcome] ? o.outcome : 'unmeasured', readyOn: o.ready_on || null, partial: o.partial_window === true,
        roasBefore: num(b.roas), roasAfter: num(a.roas), spendBefore: num(b.spend), spendAfter: num(a.spend),
        roasChange: num(o.roas_change_pct), by: o.by || null
      };
    });
  }

  function fileRows(health) {
    var files = (health && health.files) || {};
    return Object.keys(files).map(function (k) {
      var f = files[k] || {};
      return { key: k, file: f.file || k, asOf: f.as_of || null, age: num(f.age_days), status: f.status || 'info', writer: f.writer || '' };
    });
  }

  /* ------------------------------------------------------------ css */
  var CSS = [
    '#tab-loop{max-width:1400px;margin:0 auto}',
    '.lp-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:16px}',
    '.lp-card h3{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);margin:0 0 10px}',
    '.lp-note{font-size:.74rem;color:var(--text-muted);line-height:1.5;max-width:920px;margin:0 0 10px}',
    '.lp-pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.64rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;border:1px solid var(--border);white-space:nowrap}',
    '.lp-good{color:var(--green);border-color:var(--green)}.lp-bad{color:var(--red);border-color:var(--red)}.lp-warn{color:var(--yellow);border-color:var(--yellow)}.lp-muted{color:var(--text-muted)}',
    '.lp-dim{opacity:.55}',
    '.lp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
    '.lp-kpi{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px}',
    '.lp-kpi .lp-v{font-size:1.25rem;font-weight:700}.lp-kpi .lp-l{font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);margin-top:2px}',
    '.lp-kpi .lp-s{font-size:.68rem;color:var(--text-muted);margin-top:3px}',
    '.lp-scroll{overflow-x:auto}',
    '.lp-table{width:100%;border-collapse:collapse;font-size:.76rem}',
    '.lp-table th,.lp-table td{padding:7px 8px;text-align:right;border-bottom:1px solid rgba(37,37,72,.6);vertical-align:middle}',
    '.lp-table th{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);white-space:nowrap}',
    '.lp-table td:first-child,.lp-table th:first-child,.lp-table .lp-l{text-align:left}',
    '.lp-table .lp-sub{display:block;font-size:.64rem;color:var(--text-dim);margin-top:1px}',
    '.lp-table .lp-why{font-size:.68rem;color:var(--text-muted);white-space:normal;min-width:150px}',
    '.lp-strip{display:inline-flex;gap:2px;vertical-align:middle}',
    '.lp-strip i{display:block;width:9px;height:16px;border-radius:2px;box-sizing:border-box}',
    '.lp-d-spend{background:var(--cyan)}.lp-d-zero{background:transparent;border:1px solid var(--text-dim)}',
    '.lp-d-off{background:var(--border)}.lp-d-miss{background:var(--red)}',
    '.lp-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.66rem;color:var(--text-dim);margin-top:10px;align-items:center}',
    '.lp-legend span{display:inline-flex;gap:5px;align-items:center}',
    '.lp-ask{border-left:3px solid var(--border);padding:6px 0 6px 12px;margin:0 0 10px}',
    '.lp-ask.lp-high{border-left-color:var(--red)}.lp-ask.lp-medium{border-left-color:var(--yellow)}',
    '.lp-ask b{font-size:.8rem;font-weight:600}.lp-ask p{font-size:.72rem;color:var(--text-muted);line-height:1.5;margin:3px 0 0;max-width:980px}',
    '.lp-ask .lp-meta{font-size:.64rem;color:var(--text-dim);margin-top:3px;font-family:var(--font-mono)}',
    '.lp-src{font-size:.66rem;color:var(--text-dim);margin-top:8px;line-height:1.4}',
    '@media (max-width:600px){.lp-table{font-size:.68rem}.lp-strip i{width:6px}}'
  ].join('\n');

  var STATE = { health: null, brief: null, loaded: false };

  function injectCss() {
    if (document.getElementById('lp-module-css')) return;
    var st = document.createElement('style'); st.id = 'lp-module-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  /* ------------------------------------------------------------ render */
  function pill(text, cls, dim) { return '<span class="lp-pill ' + cls + (dim ? ' lp-dim' : '') + '">' + esc(text) + '</span>'; }

  function renderKpis(k) {
    var feed = k.feedStatus === 'ok' ? pill('All feeding', 'lp-good') : pill((k.stale.length || k.staleFiles.length) + ' behind', 'lp-bad');
    function box(v, l, s) { return '<div class="lp-kpi"><div class="lp-v">' + v + '</div><div class="lp-l">' + esc(l) + '</div>' + (s ? '<div class="lp-s">' + s + '</div>' : '') + '</div>'; }
    return '<div class="lp-card"><h3>Data through ' + esc(md(k.asOf)) + (k.lagDays > 0 ? ' · ' + k.lagDays + ' day(s) behind yesterday' : '') + '</h3><div class="lp-kpis">' +
      box(feed, 'Channel feeds', k.stale.length ? esc('Behind: ' + k.stale.join(', ')) : 'every live channel has a row') +
      box(x(k.mer7d), 'Blended 7d MER', 'target ' + x(k.merTarget) + (k.merGap != null ? ' (' + (k.merGap > 0 ? '+' : '') + k.merGap.toFixed(2) + ')' : '')) +
      box(k.judgedPct == null ? '—' : k.judgedPct.toFixed(0) + '%', 'Spend with an agreed read', 'full 7 days, not disputed by Grok') +
      box(k.autoPct == null ? '—' : k.autoPct.toFixed(0) + '%', 'Spend in auto mode', 'the rest is frozen / view / hold') +
      box(String(k.actNow.length), 'Ready to act', k.actNow.length ? esc(k.actNow.join(', ')) : 'nothing unblocked') +
      box(String(k.openAsks), 'Open asks to Grok', k.openHigh + ' high') +
      '</div></div>';
  }

  function renderBoard(rows) {
    var h = '<div class="lp-card"><h3>What the rule says, channel by channel</h3>' +
      '<p class="lp-note">One rule for every channel: 7-day platform-reported ROAS above 2.8x raise 20%, 2.0–2.8x hold, below 2.0x cut 20%. A faded verdict is what the rule would say if the channel were not blocked.</p>' +
      '<div class="lp-scroll"><table class="lp-table"><thead><tr><th>Channel</th><th>7d spend</th><th>7d ROAS</th><th>Grok reads</th><th class="lp-l">Rule says</th><th class="lp-l">Blocked by</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var v = VERDICT[r.verdict];
      h += '<tr><td>' + esc(r.label) + '<span class="lp-sub">' + esc(r.mode) + (r.owner ? ' · ' + esc(r.owner) : '') + '</span></td>' +
        '<td>' + usd(r.spend) + (r.spendDays != null && r.spendDays < 7 ? '<span class="lp-sub">' + r.spendDays + '/7 days</span>' : '') + '</td>' +
        '<td>' + x(r.roas) + (r.roasPrior != null ? '<span class="lp-sub">prior ' + x(r.roasPrior) + '</span>' : '') + '</td>' +
        '<td>' + x(r.grokRoas) + (r.grokTier ? '<span class="lp-sub">' + esc(r.grokTier) + '</span>' : '') + '</td>' +
        '<td class="lp-l">' + pill(v.text, v.cls, !r.actionable) + '<span class="lp-sub">' + esc(r.ruleSays) + '</span></td>' +
        '<td class="lp-l lp-why">' + (r.blockers.length ? esc(r.blockers.join(' · ')) : (r.actionable ? 'nothing — ready' : '—')) + '</td></tr>';
    });
    return h + '</tbody></table></div><div class="lp-src">ROAS is each platform\'s own purchase value over its own spend; a 7-day figure needs all 7 days. Grok\'s column is its Monday ranking, shown for comparison only.</div></div>';
  }

  function renderFeeds(rows) {
    var h = '<div class="lp-card"><h3>Did every channel feed, last 14 days</h3><div class="lp-scroll"><table class="lp-table"><thead><tr><th>Channel</th><th class="lp-l">Status</th><th>Last day</th><th class="lp-l">14 days (oldest → newest)</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var f = FEED[r.feed] || { text: '—', cls: 'lp-muted' };
      var quiet = r.feed === 'quiet';  // no spend expected: an absent row is not an alarm
      var cells = dayCells(r.strip, r.window).map(function (c) {
        var off = quiet && c.state === 'missing';
        return '<i class="' + (off ? 'lp-d-off' : c.cls) + '" title="' + esc((c.date ? md(c.date) + ': ' : '') + (off ? 'no row (not live)' : c.state)) + '"></i>';
      }).join('');
      h += '<tr><td>' + esc(r.label) + '</td><td class="lp-l">' + pill(f.text, f.cls) + '</td>' +
        '<td>' + esc(md(r.lastDay)) + (r.behind > 0 ? '<span class="lp-sub">' + r.behind + 'd behind</span>' : '') + '</td>' +
        '<td class="lp-l"><span class="lp-strip">' + cells + '</span></td></tr>';
    });
    return h + '</tbody></table></div><div class="lp-legend">' +
      '<span><span class="lp-strip"><i class="lp-d-spend"></i></span>spend</span>' +
      '<span><span class="lp-strip"><i class="lp-d-zero"></i></span>measured $0</span>' +
      '<span><span class="lp-strip"><i class="lp-d-off"></i></span>not live</span>' +
      '<span><span class="lp-strip"><i class="lp-d-miss"></i></span>missing (never counted as $0)</span></div></div>';
  }

  function renderAsks(rows) {
    var open = rows.filter(function (r) { return r.open; });
    var h = '<div class="lp-card"><h3>Open asks to Grok (' + open.length + ')</h3>';
    if (!open.length) return h + '<p class="lp-note">Nothing open. Every live channel fed its row and Grok\'s files are current.</p></div>';
    open.forEach(function (r) {
      h += '<div class="lp-ask lp-' + esc(r.severity) + '"><b>' + esc(r.title) + '</b><p>' + esc(r.detail) + '</p>' +
        '<div class="lp-meta">' + esc(r.severity) + ' · ' + esc(r.id) + ' · open ' + r.age + 'd' + (r.owner ? ' · ' + esc(r.owner) : '') +
        (r.ack ? ' · Grok: ' + esc(r.ack) + (r.ackNote ? ' — ' + esc(r.ackNote) : '') : ' · not acknowledged') + '</div></div>';
    });
    return h + '</div>';
  }

  function renderOutcomes(rows) {
    if (!rows.length) return '';
    var h = '<div class="lp-card"><h3>Did each budget change pay off</h3><p class="lp-note">Every entry in Grok\'s change log, with 7-day ROAS and spend before and after the change.</p>' +
      '<div class="lp-scroll"><table class="lp-table"><thead><tr><th>Date</th><th class="lp-l">Channel</th><th class="lp-l">Change</th><th>ROAS before</th><th>ROAS after</th><th>Spend before</th><th>Spend after</th><th class="lp-l">Result</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var res = r.outcome === 'pending' ? 'pending · ' + md(r.readyOn) : r.outcome.replace(/_/g, ' ');
      h += '<tr><td>' + esc(md(r.date)) + '</td><td class="lp-l">' + esc(r.channel) + '</td><td class="lp-l">' + esc(r.action) +
        (r.executed ? '' : '<span class="lp-sub">logged, not carried out</span>') + '</td>' +
        '<td>' + x(r.roasBefore) + '</td><td>' + x(r.roasAfter) + (r.roasChange != null ? '<span class="lp-sub">' + pct(r.roasChange) + '</span>' : '') + '</td>' +
        '<td>' + usd(r.spendBefore) + '</td><td>' + usd(r.spendAfter) + '</td>' +
        '<td class="lp-l">' + pill(res, OUTCOME[r.outcome]) + (r.partial ? '<span class="lp-sub">5–6 of 7 days on one side</span>' : '') + '</td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }

  function renderFiles(rows) {
    var h = '<div class="lp-card"><h3>Grok → CFO files</h3><div class="lp-scroll"><table class="lp-table"><thead><tr><th>File</th><th class="lp-l">Status</th><th>Last written</th><th>Age</th><th class="lp-l">Written by</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var cls = r.status === 'fresh' ? 'lp-good' : r.status === 'stale' || r.status === 'missing' ? 'lp-bad' : 'lp-muted';
      h += '<tr><td>' + esc(r.file) + '</td><td class="lp-l">' + pill(r.status === 'info' ? 'as written' : r.status, cls) + '</td>' +
        '<td>' + esc(md(r.asOf)) + '</td><td>' + (r.age == null ? '—' : r.age + 'd') + '</td><td class="lp-l">' + esc(r.writer) + '</td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }

  function render() {
    var panel = document.getElementById('tab-loop');
    if (!panel) return;
    if (!STATE.loaded) { panel.innerHTML = '<div class="lp-card"><p class="lp-note">Loading…</p></div>'; return; }
    if (!STATE.brief || !STATE.health) {
      panel.innerHTML = '<div class="lp-card"><h3>Feeds &amp; Grok loop</h3><p class="lp-note">' + esc(FEEDS.health) + ' / ' + esc(FEEDS.brief) +
        ' have not been published to this page yet. They are rebuilt every morning in the data repo and copied here by its publish step, which needs the LIVE_MIRROR_TOKEN secret.</p></div>';
      return;
    }
    var rows = boardRows(STATE.brief, STATE.health);
    panel.innerHTML = renderKpis(kpis(STATE.brief, STATE.health)) + renderBoard(rows) + renderAsks(askRows(STATE.brief)) +
      renderFeeds(rows) + renderOutcomes(outcomeRows(STATE.brief)) + renderFiles(fileRows(STATE.health));
  }

  function ensureTab() {
    var panel = document.getElementById('tab-loop');
    if (!panel) {
      panel = document.createElement('div'); panel.id = 'tab-loop'; panel.className = 'tab-content';
      var reports = document.getElementById('tab-reports');
      if (reports && reports.parentNode) reports.parentNode.appendChild(panel); else document.body.appendChild(panel);
    }
    var btn = document.querySelector('.tab[data-tab="loop"]');
    if (!btn) {
      var anchor = document.querySelector('.tab[data-tab="ad_channels"]') || document.querySelector('.tab[data-tab="throttles"]') || document.querySelector('.tab[data-tab="reports"]');
      if (anchor && anchor.parentNode) {
        btn = document.createElement('div'); btn.className = 'tab'; btn.setAttribute('data-tab', 'loop');
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      }
    }
    if (btn) btn.textContent = 'FEEDS & GROK LOOP';
    if (btn && !btn._lpBound) {
      btn._lpBound = true;
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
        document.body.classList.remove('reports-active');
        btn.classList.add('active'); panel.classList.add('active');
        if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, null, '#loop');
        render();
      });
    }
    return panel;
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; });
  }

  function load() {
    return Promise.all([getJson(FEEDS.health), getJson(FEEDS.brief)]).then(function (docs) {
      STATE.health = docs[0]; STATE.brief = docs[1]; STATE.loaded = true;
      return STATE;
    });
  }

  function boot() {
    injectCss();
    var panel = ensureTab();
    load().then(function () { if (panel.classList.contains('active')) render(); });
    var hsh = typeof location !== 'undefined' ? location.hash : '';
    if (hsh === '#loop' || hsh === '#feeds') {
      var btn = document.querySelector('.tab[data-tab="loop"]');
      if (btn) btn.click();
    }
  }

  var api = {
    FEEDS: FEEDS, VERDICT: VERDICT, kpis: kpis, boardRows: boardRows, dayCells: dayCells, askRows: askRows,
    outcomeRows: outcomeRows, fileRows: fileRows, blockerText: blockerText, render: render, load: load, _state: STATE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AdLoop = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
    else setTimeout(boot, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
