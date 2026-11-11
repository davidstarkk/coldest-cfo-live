/* =====================================================================
   COLDEST · SUBSCRIPTIONS
   ---------------------------------------------------------------------
   Last nav tab. Deep link #subscriptions.

   The payload is never embedded. The page fetches subscriptions.enc.json
   (PBKDF2-SHA256 → AES-256-GCM envelope) and decrypts it in the browser.
   Wrong password fails closed. Session unlock lives in sessionStorage
   only; Lock clears it. Do not commit a plaintext dump next to this file.
   ===================================================================== */
(function (root) {
  'use strict';

  var FILE = 'subscriptions.enc.json';
  var OVERRIDES_FILE = 'subscriptions_overrides.enc.json';
  var EXAMPLE_FILE = 'scripts/fixtures/subscriptions.example.enc.json';
  var TAB_KEY = 'subscriptions';
  var HASH = '#subscriptions';
  var SESSION_KEY = 'cfo_su_session';
  var LOCAL_KEY = 'cfo_su_ovr';
  var DAY_MS = 86400000;
  var RENEWAL_DAYS = 30;
  var PAGE_SIZE = 25;
  var CHART_SLICES = 8;

  var BUCKETS = [
    { id: 'all', label: 'All' },
    { id: 'lt50', label: '<$50/mo', min: null, max: 50 },
    { id: '50_250', label: '$50–250', min: 50, max: 250 },
    { id: '250_1k', label: '$250–1k', min: 250, max: 1000 },
    { id: '1k', label: '$1k+', min: 1000, max: null }
  ];

  var CHART_COLORS = ['#00d4d4', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#9085e9', '#d55181', '#8888a8'];

  var STATE = {
    envelope: null,
    overridesEnvelope: null,
    data: null,
    key: null,
    localMarks: {},
    committedMarks: {},
    loaded: false,
    unlocked: false,
    error: '',
    busy: false,
    remember: true,
    search: '',
    showOff: false,
    cycle: 'all',
    category: 'all',
    bucket: 'all',
    sortKey: 'annual_cost',
    sortDir: 'desc',
    page: 1,
    charts: []
  };

  /* ------------------------------------------------------------ crypto */
  function getSubtle() {
    if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
    try {
      if (typeof require !== 'undefined') return require('crypto').webcrypto.subtle;
    } catch (e) { /* noop */ }
    return null;
  }

  function b64ToBytes(b64) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    var bin = atob(b64);
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  function bytesToB64(u) {
    if (typeof Buffer !== 'undefined') return Buffer.from(u).toString('base64');
    var s = '';
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }

  function randomBytes(n) {
    var u = new Uint8Array(n);
    var c = typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto;
    c.getRandomValues(u);
    return u;
  }

  function assertEnvelope(enc) {
    if (!enc || enc.v !== 1) throw new Error('Unsupported envelope');
    if (enc.kdf !== 'PBKDF2-SHA256') throw new Error('Unsupported envelope');
    if (enc.cipher !== 'AES-256-GCM') throw new Error('Unsupported envelope');
    if (!enc.salt || !enc.iv || !enc.ct) throw new Error('Unsupported envelope');
    var iter = Number(enc.iter);
    if (!Number.isFinite(iter) || iter < 1) throw new Error('Unsupported envelope');
  }

  function deriveKey(password, salt, iter) {
    var subtle = getSubtle();
    if (!subtle) return Promise.reject(new Error('WebCrypto unavailable'));
    return subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter },
        base,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    });
  }

  function aesDecrypt(key, iv, ct) {
    return getSubtle().decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
  }

  function aesEncrypt(key, iv, bytes) {
    return getSubtle().encrypt({ name: 'AES-GCM', iv: iv }, key, bytes);
  }

  function decryptJsonWithKey(key, ivB64, ctB64) {
    return aesDecrypt(key, b64ToBytes(ivB64), b64ToBytes(ctB64)).then(function (pt) {
      return JSON.parse(new TextDecoder().decode(pt));
    });
  }

  function encryptJsonWithKey(key, obj) {
    var iv = randomBytes(12);
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    return aesEncrypt(key, iv, bytes).then(function (ct) {
      return { v: 1, cipher: 'AES-256-GCM', iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
    });
  }

  function decryptEnvelope(enc, password) {
    assertEnvelope(enc);
    if (!password) return Promise.reject(new Error('Enter the password'));
    var salt = b64ToBytes(enc.salt);
    var iter = Number(enc.iter);
    return deriveKey(password, salt, iter).then(function (key) {
      return decryptJsonWithKey(key, enc.iv, enc.ct).then(function (data) {
        return { data: data, key: key };
      });
    });
  }

  function decryptSubscriptions(enc, password) {
    return decryptEnvelope(enc, password).then(function (res) {
      if (!res.data || !Array.isArray(res.data.subscriptions)) throw new Error('Unexpected payload');
      return res;
    });
  }

  /* ------------------------------------------------------------ pure */
  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function usd(v) {
    var n = num(v);
    if (n == null) return '—';
    var d = Math.abs(n - Math.round(n)) < 1e-9 ? 0 : 2;
    var s = '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
    return n < 0 ? '−' + s : s;
  }

  function parseDay(s) {
    if (!s) return null;
    var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  function fmtDay(s) {
    var t = parseDay(s);
    if (t == null) return s ? esc(s) : '—';
    var d = new Date(t);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  }

  function fmtAsOf(s) {
    if (!s) return '—';
    var d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    try {
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) {
      return String(s);
    }
  }

  function normStatus(s) {
    var v = String(s == null ? '' : s).trim().toLowerCase();
    if (v === 'active') return 'active';
    if (v === 'canceled (marked)' || v === 'canceled_marked') return 'canceled';
    if (v === 'turned off' || v === 'turned_off' || v === 'inactive' || v === 'cancelled' || v === 'canceled') return 'turned off';
    return 'unknown';
  }

  function effectiveStatus(r) {
    if (r && r.marked) return 'canceled';
    return normStatus(r && r.status);
  }

  function isOffLike(st) {
    return st === 'turned off' || st === 'canceled';
  }

  function statusLabel(s) {
    var n = typeof s === 'string' && (s === 'canceled' || s === 'turned off' || s === 'active' || s === 'unknown')
      ? s
      : (s && typeof s === 'object' ? effectiveStatus(s) : normStatus(s));
    if (n === 'active') return 'Active';
    if (n === 'canceled') return 'Canceled (marked)';
    if (n === 'turned off') return 'Turned off';
    return 'Needs verification';
  }

  function statusClass(s) {
    var n = typeof s === 'string' && (s === 'canceled' || s === 'turned off' || s === 'active' || s === 'unknown')
      ? s
      : (s && typeof s === 'object' ? effectiveStatus(s) : normStatus(s));
    if (n === 'active') return 'su-good';
    if (n === 'canceled' || n === 'turned off') return 'su-off';
    return 'su-warn';
  }

  function cycleLabel(s) {
    if (!s) return '—';
    var v = String(s).trim().toLowerCase().replace(/_/g, '-');
    if (!v) return '—';
    var map = {
      monthly: 'Monthly',
      annual: 'Annual',
      yearly: 'Annual',
      quarterly: 'Quarterly',
      weekly: 'Weekly',
      daily: 'Daily',
      'usage-based': 'Usage-based',
      unknown: 'Unknown'
    };
    if (map[v]) return map[v];
    return v.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function inBucket(monthly, bucketId) {
    if (!bucketId || bucketId === 'all') return true;
    var n = num(monthly);
    if (n == null) return false;
    var b = null;
    for (var i = 0; i < BUCKETS.length; i++) if (BUCKETS[i].id === bucketId) b = BUCKETS[i];
    if (!b) return true;
    if (b.min != null && n < b.min) return false;
    if (b.max != null && n >= b.max) return false;
    return true;
  }

  function asOfMs(data) {
    return parseDay(data && data.generated_at) || Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  }

  function parseOverrideList(doc) {
    if (!doc) return [];
    if (Array.isArray(doc)) return doc;
    if (Array.isArray(doc.overrides)) return doc.overrides;
    if (doc.byId && typeof doc.byId === 'object') {
      return Object.keys(doc.byId).map(function (k) { return doc.byId[k]; });
    }
    return [];
  }

  function listToMarkMap(list) {
    var out = {};
    (list || []).forEach(function (o) {
      if (!o || o.id == null || o.id === '') return;
      var id = String(o.id);
      var st = String(o.status || '').toLowerCase();
      if (st === 'canceled' || st === 'cancelled') {
        out[id] = { id: id, status: 'canceled', marked_at: o.marked_at || null };
      } else if (st === 'clear' || st === 'undo' || st === 'active') {
        out[id] = { id: id, status: 'clear' };
      }
    });
    return out;
  }

  function mergeMarks(committed, local) {
    var out = {};
    [committed || {}, local || {}].forEach(function (src) {
      Object.keys(src).forEach(function (id) {
        var o = src[id];
        if (!o) return;
        if (o.status === 'canceled') out[id] = { id: id, status: 'canceled', marked_at: o.marked_at || null };
        else delete out[id];
      });
    });
    return out;
  }

  function applyOverrides(rows, markMap) {
    markMap = markMap || {};
    return (rows || []).map(function (r) {
      var id = r && r.id != null ? String(r.id) : '';
      var o = id && markMap[id];
      if (o && o.status === 'canceled') {
        return Object.assign({}, r, { marked: true, marked_at: o.marked_at || null });
      }
      return Object.assign({}, r, { marked: false, marked_at: null });
    });
  }

  function markCanceled(map, id, at) {
    var out = Object.assign({}, map || {});
    var key = String(id);
    out[key] = { id: key, status: 'canceled', marked_at: at || new Date().toISOString() };
    return out;
  }

  function undoMark(local, id, committed) {
    var out = Object.assign({}, local || {});
    var key = String(id);
    delete out[key];
    if (committed && committed[key] && committed[key].status === 'canceled') {
      out[key] = { id: key, status: 'clear' };
    }
    return out;
  }

  function exportMarks(markMap) {
    return Object.keys(markMap || {}).filter(function (id) {
      return markMap[id] && markMap[id].status === 'canceled';
    }).map(function (id) {
      return { id: markMap[id].id, status: 'canceled', marked_at: markMap[id].marked_at };
    }).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
  }

  function kpis(data, markMap) {
    var rows = applyOverrides((data && data.subscriptions) || [], markMap);
    var from = asOfMs(data);
    var monthly = 0, annual = 0, active = 0, off = 0, unknown = 0, canceled = 0, renewals30 = 0;
    rows.forEach(function (r) {
      var st = effectiveStatus(r);
      if (st === 'active') {
        active += 1;
        monthly += num(r.monthly_cost) || 0;
        annual += num(r.annual_cost) || 0;
        var nxt = parseDay(r.next_renewal);
        if (nxt != null) {
          var days = Math.round((nxt - from) / DAY_MS);
          if (days >= 0 && days <= RENEWAL_DAYS) renewals30 += 1;
        }
      } else if (st === 'canceled') { canceled += 1; off += 1; }
      else if (st === 'turned off') off += 1;
      else unknown += 1;
    });
    return { monthly: monthly, annual: annual, active: active, off: off, unknown: unknown, canceled: canceled, renewals30: renewals30 };
  }

  function applyFilters(rows, f) {
    f = f || {};
    var q = String(f.search || '').trim().toLowerCase();
    var cycle = (f.cycle && f.cycle !== 'all') ? String(f.cycle).toLowerCase() : '';
    var category = (f.category && f.category !== 'all') ? String(f.category) : '';
    return (rows || []).filter(function (r) {
      var st = effectiveStatus(r);
      if (!f.showOff && isOffLike(st)) return false;
      if (cycle && String(r.cycle || '').toLowerCase() !== cycle) return false;
      if (category && String(r.category || '') !== category) return false;
      if (!inBucket(r.monthly_cost, f.bucket)) return false;
      if (q) {
        var blob = [r.name, r.description, r.category, r.cycle, cycleLabel(r.cycle), r.status, statusLabel(st), r.marked_at].map(function (x) { return x == null ? '' : String(x); }).join(' ').toLowerCase();
        if (blob.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function sortRows(rows, key, dir) {
    var k = key || 'annual_cost';
    var d = dir === 'asc' ? 'asc' : 'desc';
    return (rows || []).slice().sort(function (a, b) {
      var va = a[k], vb = b[k];
      var na = va == null || va === '';
      var nb = vb == null || vb === '';
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      if (k === 'last_charge' || k === 'next_renewal') {
        va = parseDay(va); vb = parseDay(vb);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return d === 'asc' ? va - vb : vb - va;
      }
      if (typeof va === 'number' || typeof vb === 'number') {
        var xa = num(va), xb = num(vb);
        if (xa == null && xb == null) return 0;
        if (xa == null) return 1;
        if (xb == null) return -1;
        return d === 'asc' ? xa - xb : xb - xa;
      }
      var sa = String(va).toLowerCase(), sb = String(vb).toLowerCase();
      if (sa < sb) return d === 'asc' ? -1 : 1;
      if (sa > sb) return d === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function uniqueValues(rows, key) {
    var seen = {}, out = [];
    (rows || []).forEach(function (r) {
      var v = r[key];
      if (v == null || v === '') return;
      var s = String(v);
      if (seen[s]) return;
      seen[s] = 1;
      out.push(s);
    });
    out.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
    return out;
  }

  function breakdown(rows, key) {
    var sums = {}, order = [];
    (rows || []).forEach(function (r) {
      var k = r[key] == null || r[key] === '' ? '—' : String(r[key]);
      if (!sums[k]) { sums[k] = 0; order.push(k); }
      sums[k] += num(r.annual_cost) || 0;
    });
    return order.map(function (k) { return { key: k, label: key === 'cycle' ? cycleLabel(k) : k, annual: sums[k] }; })
      .sort(function (a, b) { return b.annual - a.annual; });
  }

  function topSlices(items, n) {
    n = n == null ? CHART_SLICES : n;
    if (!items || items.length <= n) return items || [];
    var top = items.slice(0, n);
    var rest = 0;
    for (var i = n; i < items.length; i++) rest += items[i].annual;
    top.push({ key: 'other', label: 'Other', annual: rest });
    return top;
  }

  function pageSlice(rows, page, size) {
    size = size || PAGE_SIZE;
    var total = (rows || []).length;
    var pages = Math.max(1, Math.ceil(total / size) || 1);
    var p = Math.min(Math.max(1, page || 1), pages);
    var start = (p - 1) * size;
    return {
      page: p, pages: pages, size: size, total: total,
      from: total ? start + 1 : 0,
      to: Math.min(start + size, total),
      rows: (rows || []).slice(start, start + size)
    };
  }

  /* ------------------------------------------------------------ css */
  var CSS = [
    '#tab-subscriptions{max-width:1400px;margin:0 auto}',
    '.su-lock{max-width:440px;margin:48px auto;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:28px 28px 24px}',
    '.su-lock h3{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--cyan);margin:0 0 8px}',
    '.su-lock p{color:var(--text-muted);font-size:.85rem;line-height:1.55;margin:0 0 18px}',
    '.su-lock label{display:block;font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);margin-bottom:6px}',
    '.su-lock input[type=password]{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:10px 12px;font-family:var(--font-mono);font-size:.9rem;outline:none}',
    '.su-lock input[type=password]:focus{border-color:var(--cyan)}',
    '.su-row{display:flex;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap}',
    '.su-btn{background:var(--cyan);color:#0c0c14;border:none;border-radius:6px;padding:8px 16px;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}',
    '.su-btn:disabled{opacity:.5;cursor:wait}',
    '.su-btn-ghost{background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:6px;padding:6px 12px;font-size:.72rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}',
    '.su-btn-ghost:hover:not(:disabled){color:var(--text);border-color:var(--text-dim)}',
    '.su-btn-ghost:disabled{opacity:.4;cursor:default}',
    '.su-check{display:flex;align-items:center;gap:8px;font-size:.78rem;color:var(--text-muted);cursor:pointer;user-select:none}',
    '.su-check input{accent-color:var(--cyan)}',
    '.su-err{color:var(--red);font-size:.78rem;margin-top:10px;min-height:1.1em}',
    '.su-head{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;justify-content:space-between;margin-bottom:14px}',
    '.su-head-actions{display:flex;flex-wrap:wrap;gap:8px}',
    '.su-head h3{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--cyan);margin:0}',
    '.su-asof{font-size:.76rem;color:var(--text-muted)}',
    '.su-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}',
    '.su-kpi{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px 16px}',
    '.su-kpi .su-v{font-family:var(--font-mono);font-size:1.25rem;font-weight:700;color:var(--text);line-height:1.1}',
    '.su-kpi .su-l{font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);margin-top:6px}',
    '.su-kpi.su-kpi-warn .su-v{color:var(--yellow)}',
    '.su-filters{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:14px;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:8px}',
    '.su-filters input[type=search],.su-filters select{background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:6px 10px;font-size:.78rem}',
    '.su-filters input[type=search]{min-width:200px;flex:1}',
    '.su-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.su-chip{padding:4px 10px;border-radius:999px;border:1px solid var(--border);font-size:.68rem;font-weight:600;letter-spacing:.04em;color:var(--text-muted);background:transparent;cursor:pointer}',
    '.su-chip.on{color:var(--cyan);border-color:var(--cyan);background:rgba(0,212,212,.08)}',
    '.su-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.64rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--border)}',
    '.su-good{color:var(--green);border-color:var(--green)}',
    '.su-off{color:var(--text-dim);border-color:var(--text-dim)}',
    '.su-warn{color:var(--yellow);border-color:var(--yellow)}',
    '.su-cycle{color:var(--cyan);border-color:var(--cyan)}',
    '.su-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:16px}',
    '.su-card h4{font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim);margin:0 0 12px}',
    '.su-table-wrap{overflow:auto;max-height:min(60vh,560px);border:1px solid var(--border);border-radius:8px}',
    '.su-table{width:100%;border-collapse:collapse;font-size:.78rem}',
    '.su-table th{font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim);text-align:right;padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;white-space:nowrap;user-select:none;position:sticky;top:0;background:var(--card);z-index:1}',
    '.su-table th:first-child,.su-table td:first-child{text-align:left}',
    '.su-table th.su-nosort{cursor:default}',
    '.su-table td{padding:9px 10px;text-align:right;border-bottom:1px solid rgba(37,37,72,.5);vertical-align:top;white-space:nowrap}',
    '.su-table td:first-child{white-space:normal}',
    '.su-name{font-weight:600;color:var(--text)}',
    '.su-desc{display:block;font-size:.7rem;color:var(--text-dim);font-weight:400;margin-top:2px}',
    '.su-link{color:var(--cyan);text-decoration:none;font-size:.72rem;font-weight:600}',
    '.su-link:hover{text-decoration:underline}',
    'button.su-act{background:none;border:none;padding:0;font:inherit;color:var(--cyan);cursor:pointer;font-size:.72rem;font-weight:600}',
    'button.su-act:hover{text-decoration:underline}',
    '.su-mark-date{display:block;font-size:.64rem;color:var(--text-dim);margin-top:3px;font-weight:400;letter-spacing:0;text-transform:none}',
    '.su-empty{color:var(--text-muted);font-size:.82rem;padding:16px 0}',
    '.su-charts{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}',
    '.su-chart{position:relative;height:220px}',
    '.su-sort{margin-left:4px;color:var(--cyan)}',
    '.su-pager{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;font-size:.76rem;color:var(--text-muted)}',
    '.su-pager-btns{display:flex;gap:6px}',
    '@media (max-width:900px){.su-charts{grid-template-columns:1fr}}'
  ].join('\n');

  function injectCss() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('su-module-css')) return;
    var st = document.createElement('style');
    st.id = 'su-module-css';
    st.textContent = CSS;
    document.head.appendChild(st);
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
    var tabs = document.querySelector('.tabs');
    var btn = document.querySelector('.tab[data-tab="' + TAB_KEY + '"]');
    if (!btn) {
      btn = document.createElement('div');
      btn.className = 'tab';
      btn.setAttribute('data-tab', TAB_KEY);
    }
    btn.textContent = 'SUBSCRIPTIONS';
    if (tabs) tabs.appendChild(btn);
    if (btn && !btn._suBound) {
      btn._suBound = true;
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

  /* ------------------------------------------------------------ session / encrypted local marks */
  function dataFileUrl() {
    try {
      if (typeof location !== 'undefined' && /(?:\?|&)su_example=1(?:&|$)/.test(location.search || '')) return EXAMPLE_FILE;
    } catch (e) { /* noop */ }
    return FILE;
  }

  function readSessionJwk() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var doc = JSON.parse(raw);
      if (!doc || doc.v !== 2 || !doc.jwk) return null;
      return doc.jwk;
    } catch (e) { return null; }
  }

  function writeSessionJwk(jwk) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ v: 2, jwk: jwk })); } catch (e) { /* noop */ }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* noop */ }
  }

  function readLocalBlob() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch (e) { return null; }
  }

  function writeLocalBlob(blob) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(blob)); } catch (e) { /* noop */ }
  }

  function mergedMarks() {
    return mergeMarks(STATE.committedMarks, STATE.localMarks);
  }

  function persistLocalMarks() {
    if (!STATE.key) return Promise.resolve();
    return encryptJsonWithKey(STATE.key, { local: STATE.localMarks, committed: STATE.committedMarks }).then(function (blob) {
      writeLocalBlob(blob);
    }).catch(function () { /* noop */ });
  }

  function loadLocalMarks(key) {
    var blob = readLocalBlob();
    if (!blob || !blob.iv || !blob.ct) return Promise.resolve({ local: {}, committed: {} });
    return decryptJsonWithKey(key, blob.iv, blob.ct).then(function (doc) {
      return {
        local: (doc && doc.local) || {},
        committed: (doc && doc.committed) || {}
      };
    }).catch(function () { return { local: {}, committed: {} }; });
  }

  function importAesKey(jwk) {
    return getSubtle().importKey('jwk', jwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }

  /* ------------------------------------------------------------ render */
  function destroyCharts() {
    STATE.charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* noop */ } });
    STATE.charts = [];
  }

  function pill(text, cls) {
    return '<span class="su-pill ' + cls + '">' + esc(text) + '</span>';
  }

  function sortMark(key) {
    if (STATE.sortKey !== key) return '';
    return '<span class="su-sort">' + (STATE.sortDir === 'asc' ? '▲' : '▼') + '</span>';
  }

  function th(key, label, extra) {
    return '<th data-sort="' + esc(key) + '"' + (extra || '') + '>' + esc(label) + sortMark(key) + '</th>';
  }

  function linkCell(r) {
    var bits = [];
    if (r.manage_url) bits.push('<a class="su-link" href="' + esc(r.manage_url) + '" target="_blank" rel="noopener noreferrer">Manage / Pay</a>');
    if (r.cancel_url) bits.push('<a class="su-link" href="' + esc(r.cancel_url) + '" target="_blank" rel="noopener noreferrer">Cancel</a>');
    if (r.id != null && r.id !== '') {
      if (r.marked) bits.push('<button type="button" class="su-act" data-act="undo" data-id="' + esc(r.id) + '">Undo</button>');
      else bits.push('<button type="button" class="su-act" data-act="cancel" data-id="' + esc(r.id) + '">Mark as canceled</button>');
    }
    return bits.length ? bits.join(' · ') : '—';
  }

  function visibleRows() {
    var rows = applyOverrides((STATE.data && STATE.data.subscriptions) || [], mergedMarks());
    rows = applyFilters(rows, {
      search: STATE.search,
      showOff: STATE.showOff,
      cycle: STATE.cycle,
      category: STATE.category,
      bucket: STATE.bucket
    });
    return sortRows(rows, STATE.sortKey, STATE.sortDir);
  }

  function renderLock(panel) {
    destroyCharts();
    var err = STATE.error ? esc(STATE.error) : '';
    var missing = !STATE.envelope;
    panel.innerHTML =
      '<div class="su-lock">' +
        '<h3>Subscriptions</h3>' +
        '<p>' + (missing
          ? 'Encrypted file is not on this page yet.'
          : 'This section is encrypted. Enter the password to view it in this browser only.') + '</p>' +
        (missing ? '' :
          '<form id="su-unlock-form">' +
            '<label for="su-pass">Password</label>' +
            '<input id="su-pass" type="password" autocomplete="off" spellcheck="false"' + (STATE.busy ? ' disabled' : '') + '>' +
            '<div class="su-row">' +
              '<button class="su-btn" type="submit"' + (STATE.busy ? ' disabled' : '') + '>' + (STATE.busy ? 'Unlocking…' : 'Unlock') + '</button>' +
              '<label class="su-check"><input id="su-remember" type="checkbox"' + (STATE.remember ? ' checked' : '') + '> Keep unlocked until this tab closes</label>' +
            '</div>' +
            '<div class="su-err" id="su-err">' + err + '</div>' +
          '</form>') +
      '</div>';
    var form = document.getElementById('su-unlock-form');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var input = document.getElementById('su-pass');
        var rem = document.getElementById('su-remember');
        STATE.remember = !!(rem && rem.checked);
        unlock(input ? input.value : '');
      });
      var input = document.getElementById('su-pass');
      if (input) setTimeout(function () { try { input.focus(); } catch (e) { /* noop */ } }, 0);
    }
  }

  function renderShell(panel) {
    var all = (STATE.data && STATE.data.subscriptions) || [];
    var cycles = uniqueValues(all, 'cycle');
    var cats = uniqueValues(all, 'category');
    var cycleOpts = ['<option value="all">All cycles</option>'].concat(cycles.map(function (c) {
      return '<option value="' + esc(c) + '"' + (STATE.cycle === c ? ' selected' : '') + '>' + esc(cycleLabel(c)) + '</option>';
    })).join('');
    var catOpts = ['<option value="all">All categories</option>'].concat(cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (STATE.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    })).join('');
    var chips = BUCKETS.map(function (b) {
      return '<button type="button" class="su-chip' + (STATE.bucket === b.id ? ' on' : '') + '" data-bucket="' + esc(b.id) + '">' + esc(b.label) + '</button>';
    }).join('');
    var src = STATE.data && STATE.data.source ? '<div class="su-asof">' + esc(STATE.data.source) + '</div>' : '';
    panel.innerHTML =
      '<div class="su-app">' +
        '<div class="su-head">' +
          '<div><h3>Subscriptions</h3><div class="su-asof" id="su-asof"></div>' + src + '</div>' +
          '<div class="su-head-actions">' +
            '<button type="button" class="su-btn-ghost" id="su-export">Export changes</button>' +
            '<button type="button" class="su-btn-ghost" id="su-lock">Lock</button>' +
          '</div>' +
        '</div>' +
        '<div class="su-kpis" id="su-kpis"></div>' +
        '<div class="su-filters">' +
          '<input id="su-search" type="search" placeholder="Search name or category" value="' + esc(STATE.search) + '">' +
          '<label class="su-check"><input id="su-showoff" type="checkbox"' + (STATE.showOff ? ' checked' : '') + '> Include turned off / canceled</label>' +
          '<select id="su-cycle">' + cycleOpts + '</select>' +
          '<select id="su-category">' + catOpts + '</select>' +
          '<div class="su-chips" id="su-buckets">' + chips + '</div>' +
        '</div>' +
        '<div class="su-charts">' +
          '<div class="su-card"><h4>Annual spend by billing cycle</h4><div class="su-chart"><canvas id="su-chart-cycle"></canvas></div></div>' +
          '<div class="su-card"><h4>Annual spend by category</h4><div class="su-chart"><canvas id="su-chart-cat"></canvas></div></div>' +
        '</div>' +
        '<div class="su-card"><div class="su-table-wrap" id="su-table-wrap"></div><div id="su-pager"></div></div>' +
      '</div>';

    document.getElementById('su-lock').addEventListener('click', lock);
    document.getElementById('su-export').addEventListener('click', exportChanges);
    document.getElementById('su-search').addEventListener('input', function (ev) {
      STATE.search = ev.target.value;
      STATE.page = 1;
      refreshApp(panel);
    });
    document.getElementById('su-showoff').addEventListener('change', function (ev) {
      STATE.showOff = !!ev.target.checked;
      STATE.page = 1;
      refreshApp(panel);
    });
    document.getElementById('su-cycle').addEventListener('change', function (ev) {
      STATE.cycle = ev.target.value;
      STATE.page = 1;
      refreshApp(panel);
    });
    document.getElementById('su-category').addEventListener('change', function (ev) {
      STATE.category = ev.target.value;
      STATE.page = 1;
      refreshApp(panel);
    });
    document.getElementById('su-buckets').addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-bucket]');
      if (!t) return;
      STATE.bucket = t.getAttribute('data-bucket');
      STATE.page = 1;
      var chipsEl = document.getElementById('su-buckets');
      if (chipsEl) {
        Array.prototype.forEach.call(chipsEl.querySelectorAll('.su-chip'), function (c) {
          c.classList.toggle('on', c.getAttribute('data-bucket') === STATE.bucket);
        });
      }
      refreshApp(panel);
    });
  }

  function refreshApp(panel) {
    var k = kpis(STATE.data, mergedMarks());
    var kpisEl = document.getElementById('su-kpis');
    if (kpisEl) {
      kpisEl.innerHTML =
        kpiCard(usd(k.monthly), 'Active monthly run-rate') +
        kpiCard(usd(k.annual), 'Active annual run-rate') +
        kpiCard(String(k.active), 'Active') +
        kpiCard(String(k.unknown), 'Needs verification', 'su-kpi-warn') +
        kpiCard(String(k.off), 'Turned off') +
        kpiCard(String(k.renewals30), 'Renewals in next 30 days');
    }
    var asof = document.getElementById('su-asof');
    if (asof) asof.textContent = 'Data as of ' + fmtAsOf(STATE.data && STATE.data.generated_at);
    var rows = visibleRows();
    var slice = pageSlice(rows, STATE.page, PAGE_SIZE);
    STATE.page = slice.page;
    var wrap = document.getElementById('su-table-wrap');
    var pager = document.getElementById('su-pager');
    if (wrap) {
      if (!rows.length) {
        wrap.innerHTML = '<div class="su-empty">No rows match these filters.</div>';
        if (pager) pager.innerHTML = '';
      } else {
        wrap.innerHTML = '<table class="su-table"><thead><tr>' +
          th('name', 'Name') +
          th('category', 'Category') +
          th('amount', 'Amount') +
          th('cycle', 'Billing cycle') +
          th('monthly_cost', 'Monthly equiv.') +
          th('annual_cost', 'Annual cost') +
          th('status', 'Status') +
          th('last_charge', 'Last charge') +
          th('next_renewal', 'Next renewal') +
          '<th class="su-nosort">Links</th>' +
          '</tr></thead><tbody>' +
          slice.rows.map(rowHtml).join('') +
          '</tbody></table>';
        wrap.querySelector('thead').addEventListener('click', function (ev) {
          var thEl = ev.target.closest('th[data-sort]');
          if (!thEl) return;
          var key = thEl.getAttribute('data-sort');
          if (STATE.sortKey === key) STATE.sortDir = STATE.sortDir === 'desc' ? 'asc' : 'desc';
          else { STATE.sortKey = key; STATE.sortDir = key === 'name' || key === 'category' || key === 'cycle' || key === 'status' ? 'asc' : 'desc'; }
          STATE.page = 1;
          refreshApp(panel);
        });
        if (pager) {
          pager.className = 'su-pager';
          pager.innerHTML =
            '<span>Showing ' + slice.from + '–' + slice.to + ' of ' + slice.total + '</span>' +
            '<div class="su-pager-btns">' +
              '<button type="button" class="su-btn-ghost" id="su-prev"' + (slice.page <= 1 ? ' disabled' : '') + '>Prev</button>' +
              '<button type="button" class="su-btn-ghost" id="su-next"' + (slice.page >= slice.pages ? ' disabled' : '') + '>Next</button>' +
            '</div>';
          var prev = document.getElementById('su-prev');
          var next = document.getElementById('su-next');
          if (prev) prev.addEventListener('click', function () { STATE.page = Math.max(1, STATE.page - 1); refreshApp(panel); });
          if (next) next.addEventListener('click', function () { STATE.page += 1; refreshApp(panel); });
        }
        wrap.onclick = function (ev) {
          var btn = ev.target.closest ? ev.target.closest('[data-act]') : null;
          if (!btn) return;
          var act = btn.getAttribute('data-act');
          var id = btn.getAttribute('data-id');
          if (!id) return;
          if (act === 'cancel') onMarkCanceled(id);
          else if (act === 'undo') onUndo(id);
        };
      }
    }
    var chartRows = rows.filter(function (r) { return effectiveStatus(r) === 'active'; });
    drawCharts(chartRows);
  }

  function kpiCard(val, label, cls) {
    return '<div class="su-kpi' + (cls ? ' ' + cls : '') + '"><div class="su-v">' + esc(val) + '</div><div class="su-l">' + esc(label) + '</div></div>';
  }

  function rowHtml(r) {
    var st = effectiveStatus(r);
    var title = r.status_reason ? ' title="' + esc(r.status_reason) + '"' : '';
    var desc = r.description ? '<span class="su-desc">' + esc(r.description) + '</span>' : '';
    var markDate = st === 'canceled' && r.marked_at
      ? '<span class="su-mark-date">' + fmtDay(r.marked_at) + '</span>'
      : '';
    return '<tr>' +
      '<td><span class="su-name">' + esc(r.name || '—') + '</span>' + desc + '</td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + usd(r.amount) + '</td>' +
      '<td>' + (r.cycle ? pill(cycleLabel(r.cycle), 'su-cycle') : '—') + '</td>' +
      '<td>' + usd(r.monthly_cost) + '</td>' +
      '<td>' + usd(r.annual_cost) + '</td>' +
      '<td><span' + title + '>' + pill(statusLabel(st), statusClass(st)) + '</span>' + markDate + '</td>' +
      '<td>' + fmtDay(r.last_charge) + '</td>' +
      '<td>' + fmtDay(r.next_renewal) + '</td>' +
      '<td>' + linkCell(r) + '</td>' +
      '</tr>';
  }

  function drawCharts(rows) {
    destroyCharts();
    if (typeof root.Chart === 'undefined') return;
    paintChart('su-chart-cycle', topSlices(breakdown(rows, 'cycle')));
    paintChart('su-chart-cat', topSlices(breakdown(rows, 'category')));
  }

  function paintChart(id, items) {
    var el = document.getElementById(id);
    if (!el) return;
    var labels = items.map(function (i) { return i.label; });
    var data = items.map(function (i) { return i.annual; });
    var colors = items.map(function (_, i) { return CHART_COLORS[i % CHART_COLORS.length]; });
    STATE.charts.push(new root.Chart(el.getContext('2d'), {
      type: 'doughnut',
      data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: '#8888a8', boxWidth: 10, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var v = ctx.parsed;
                return ' ' + ctx.label + ': ' + usd(v);
              }
            }
          }
        }
      }
    }));
  }

  function render() {
    var panel = ensureTab();
    if (!panel) return;
    if (!STATE.loaded) {
      panel.innerHTML = '<div class="su-lock"><h3>Subscriptions</h3><p>Loading…</p></div>';
      return;
    }
    if (STATE.unlocked && STATE.data) {
      if (!panel.querySelector('.su-app')) renderShell(panel);
      refreshApp(panel);
      return;
    }
    renderLock(panel);
  }

  function onMarkCanceled(id) {
    STATE.localMarks = markCanceled(STATE.localMarks, id, new Date().toISOString());
    persistLocalMarks();
    var panel = document.getElementById('tab-' + TAB_KEY);
    if (panel) refreshApp(panel);
  }

  function onUndo(id) {
    STATE.localMarks = undoMark(STATE.localMarks, id, STATE.committedMarks);
    persistLocalMarks();
    var panel = document.getElementById('tab-' + TAB_KEY);
    if (panel) refreshApp(panel);
  }

  function exportChanges() {
    var list = exportMarks(mergedMarks());
    var text = JSON.stringify(list, null, 2);
    if (typeof document === 'undefined') return text;
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'subscriptions-overrides.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 0);
    return text;
  }

  function afterUnlock(data, key, fromPassword, password) {
    STATE.data = data;
    STATE.key = key;
    STATE.unlocked = true;
    STATE.busy = false;
    STATE.error = '';
    var committedP = Promise.resolve({});
    if (fromPassword && password && STATE.overridesEnvelope) {
      committedP = decryptEnvelope(STATE.overridesEnvelope, password).then(function (res) {
        return listToMarkMap(parseOverrideList(res.data));
      }).catch(function () { return {}; });
    }
    return loadLocalMarks(key).then(function (stored) {
      STATE.localMarks = stored.local || {};
      return committedP.then(function (fromFile) {
        STATE.committedMarks = Object.keys(fromFile).length ? fromFile : (stored.committed || {});
        if (fromPassword && STATE.remember) {
          return getSubtle().exportKey('jwk', key).then(function (jwk) { writeSessionJwk(jwk); });
        }
        if (fromPassword && !STATE.remember) clearSession();
      });
    }).then(function () {
      return persistLocalMarks();
    }).then(function () {
      render();
    });
  }

  function unlock(password) {
    if (STATE.busy) return;
    STATE.error = '';
    STATE.busy = true;
    render();
    decryptSubscriptions(STATE.envelope, password).then(function (res) {
      return afterUnlock(res.data, res.key, true, password);
    }).catch(function () {
      STATE.busy = false;
      STATE.unlocked = false;
      STATE.data = null;
      STATE.key = null;
      STATE.error = 'Wrong password';
      render();
    });
  }

  function restoreSession() {
    var jwk = readSessionJwk();
    if (!jwk || !STATE.envelope) return Promise.resolve(false);
    return importAesKey(jwk).then(function (key) {
      return decryptJsonWithKey(key, STATE.envelope.iv, STATE.envelope.ct).then(function (data) {
        if (!data || !Array.isArray(data.subscriptions)) throw new Error('Unexpected payload');
        return afterUnlock(data, key, false, null);
      }).then(function () { return true; });
    }).catch(function () {
      clearSession();
      return false;
    });
  }

  function lock() {
    STATE.unlocked = false;
    STATE.data = null;
    STATE.key = null;
    STATE.error = '';
    STATE.search = '';
    STATE.showOff = false;
    STATE.cycle = 'all';
    STATE.category = 'all';
    STATE.bucket = 'all';
    STATE.sortKey = 'annual_cost';
    STATE.sortDir = 'desc';
    STATE.page = 1;
    clearSession();
    destroyCharts();
    render();
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; });
  }

  function load() {
    var mainUrl = dataFileUrl();
    return Promise.all([getJson(mainUrl), getJson(OVERRIDES_FILE)]).then(function (docs) {
      STATE.envelope = docs[0];
      STATE.overridesEnvelope = docs[1];
      STATE.loaded = true;
      return restoreSession();
    });
  }

  function boot() {
    injectCss();
    ensureTab();
    var hsh = typeof location !== 'undefined' ? location.hash : '';
    var open = hsh === HASH || hsh === '#subscription';
    load().then(function () {
      if (open) {
        var btn = document.querySelector('.tab[data-tab="' + TAB_KEY + '"]');
        if (btn) btn.click();
        else render();
      } else {
        var panel = document.getElementById('tab-' + TAB_KEY);
        if (panel && panel.classList.contains('active')) render();
      }
    });
  }

  var api = {
    FILE: FILE,
    OVERRIDES_FILE: OVERRIDES_FILE,
    EXAMPLE_FILE: EXAMPLE_FILE,
    TAB_KEY: TAB_KEY,
    HASH: HASH,
    SESSION_KEY: SESSION_KEY,
    LOCAL_KEY: LOCAL_KEY,
    BUCKETS: BUCKETS,
    PAGE_SIZE: PAGE_SIZE,
    decryptEnvelope: function (enc, password) {
      return decryptSubscriptions(enc, password).then(function (r) { return r.data; });
    },
    decryptSubscriptions: decryptSubscriptions,
    encryptJsonWithKey: encryptJsonWithKey,
    decryptJsonWithKey: decryptJsonWithKey,
    kpis: kpis,
    applyFilters: applyFilters,
    applyOverrides: applyOverrides,
    mergeMarks: mergeMarks,
    listToMarkMap: listToMarkMap,
    parseOverrideList: parseOverrideList,
    markCanceled: markCanceled,
    undoMark: undoMark,
    exportMarks: exportMarks,
    effectiveStatus: effectiveStatus,
    sortRows: sortRows,
    pageSlice: pageSlice,
    inBucket: inBucket,
    breakdown: breakdown,
    topSlices: topSlices,
    uniqueValues: uniqueValues,
    normStatus: normStatus,
    statusClass: statusClass,
    statusLabel: statusLabel,
    cycleLabel: cycleLabel,
    usd: usd,
    fmtDay: fmtDay,
    _state: STATE,
    render: render,
    lock: lock
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Subscriptions = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
    else setTimeout(boot, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
