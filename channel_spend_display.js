/* =====================================================================
   COLDEST · CHANNEL SPEND DISPLAY CONTRACT (adapter + formatter)
   ---------------------------------------------------------------------
   Finance owns the contract (coldest-cfo-dashboard PR #46, head 69045f7,
   unmerged). FIELD_MAP / REGISTRY_PATHS / DAY_CONTRACT_PATHS are the
   only rename points.

   Per channel-day (render ONLY from display_state when present):
     display_state ∈ {off, zero, spend, pending_backfill}
     display_amount, last_confirmed_date, last_confirmed_amount, measured_spend
     pending_backfill: display_amount=null → last_confirmed_amount
       + "pending backfill (last confirmed <date>)"

   Per-day state sources, first match with display_state wins:
     1. mer.channel_display.by_date[date][channel]
     2. mer.advertising_sources[date].<channel>_ads
     3. advertising_sources_daily.json
   Root `status` is NOT per-day truth — never filter on it.

   Registry: ads_throttle/channel_status.json (schema channel_status.v1).
   Pending list: ads_throttle/pending_backfill.json and mer.pending_backfill.
   Totals that include a carried figure are estimated.

   Interim fallback (current live feeds, pre-#46): see derive().
   ===================================================================== */
(function (root) {
  'use strict';

  var STATES = {
    OFF: 'off',
    ZERO: 'zero',
    SPEND: 'spend',
    PENDING: 'pending_backfill'
  };

  var ALLOWED = [STATES.OFF, STATES.ZERO, STATES.SPEND, STATES.PENDING];

  var CHANNEL_STATUS_SCHEMA = 'channel_status.v1';
  var CHANNEL_STATUS_IDS = [
    'meta', 'google', 'tiktok', 'bing', 'snapchat', 'applovin', 'pinterest',
    'chatgpt', 'reddit', 'taboola', 'outbrain', 'x', 'spotify', 'amazon', 'whatnot'
  ];

  // Canonical names first (PR #46). Arrays are aliases, first wins.
  var FIELD_MAP = {
    display_state: ['display_state', 'spend_display_state', 'state'],
    display_amount: ['display_amount', 'spend_display_amount', 'amount'],
    last_confirmed_date: ['last_confirmed_date', 'last_confirmed_as_of'],
    last_confirmed_amount: ['last_confirmed_amount', 'last_confirmed_spend'],
    measured_spend: ['measured_spend', 'spend', 'daily_spend', 'ad_spend'],
    cash_cost: ['cash_cost'],
    cash_cost_status: ['cash_cost_status'],
    estimated: ['estimated', 'totals_estimated', 'includes_carried'],
    registry_on: ['on', 'enabled', 'live'],
    registry_since: ['since', 'off_since', 'paused_since', 'on_since'],
    registry_owner: ['owner', 'owner_bot']
  };

  var REGISTRY_PATHS = [
    ['channel_status', 'channels'],
    ['channel_status'],
    ['ads_throttle', 'channel_status', 'channels'],
    ['ads_throttle', 'channel_status'],
    ['channel_spend_registry'],
    ['paid_channel_registry'],
    ['channel_registry'],
    ['display_contract', 'registry'],
    ['display_contract', 'channels'],
    ['paid_channels', 'registry']
  ];

  // Legacy bags only. Authoritative order is pickDayContract().
  var DAY_CONTRACT_PATHS = [
    ['channel_display'],
    ['channel_day_display'],
    ['display_contract', 'by_date'],
    ['channel_spend_display']
  ];

  // Date-effective interim registry used only when the published contract is absent.
  // `since` is the first date the listed `on` value applies (inclusive).
  var INTERIM_REGISTRY = {
    chatgpt: { on: false, since: '2026-10-31', owner: 'ChatGPT Ads', note: 'paused 2026-10-30' },
    outbrain: { on: false, since: null, owner: 'Outbrain' },
    reddit: { on: false, since: null, owner: 'Reddit', note: 'closed' },
    spotify: { on: false, since: null, owner: 'Spotify', note: 'not launched' },
    x: { on: true, since: '2026-11-04', owner: 'x.com ads' }
  };

  function isDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function finiteNum(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function round2(v) {
    var n = finiteNum(v);
    return n == null ? null : Math.round(n * 100) / 100;
  }

  function usd(v) {
    var n = finiteNum(v);
    if (n == null) n = 0;
    return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function readField(obj, names) {
    if (!obj || typeof obj !== 'object' || !names) return undefined;
    for (var i = 0; i < names.length; i++) {
      if (Object.prototype.hasOwnProperty.call(obj, names[i]) && obj[names[i]] != null && obj[names[i]] !== '') {
        return obj[names[i]];
      }
    }
    return undefined;
  }

  function walkPath(rootObj, path) {
    var cur = rootObj;
    for (var i = 0; i < path.length; i++) {
      if (!cur || typeof cur !== 'object') return null;
      cur = cur[path[i]];
    }
    return cur && typeof cur === 'object' ? cur : null;
  }

  function channelKeys(channelId) {
    if (!channelId) return [];
    var id = String(channelId);
    var bare = id.replace(/_ads$/, '');
    var keys = [id, bare, bare + '_ads', id + '_ads'];
    var out = [];
    var seen = {};
    keys.forEach(function (k) {
      if (!seen[k]) { seen[k] = true; out.push(k); }
    });
    return out;
  }

  function nodeFromBag(bag, channelId) {
    if (!bag || typeof bag !== 'object') return null;
    var keys = channelKeys(channelId);
    for (var i = 0; i < keys.length; i++) {
      if (bag[keys[i]] != null && typeof bag[keys[i]] === 'object') return bag[keys[i]];
    }
    return null;
  }

  function unwrapChannelStatus(doc) {
    if (!doc || typeof doc !== 'object') return null;
    if (doc.schema === CHANNEL_STATUS_SCHEMA || doc.schema_version === CHANNEL_STATUS_SCHEMA) {
      if (doc.channels && typeof doc.channels === 'object') return doc.channels;
      var copy = {};
      Object.keys(doc).forEach(function (k) {
        if (k === 'schema' || k === 'schema_version' || k === 'as_of' || k === 'updated_at' || k === 'notes') return;
        if (doc[k] && typeof doc[k] === 'object' && !Array.isArray(doc[k])) copy[k] = doc[k];
      });
      return Object.keys(copy).length ? copy : null;
    }
    if (doc.channels && typeof doc.channels === 'object' && (doc.schema == null || String(doc.schema).indexOf('channel_status') === 0)) {
      return doc.channels;
    }
    return null;
  }

  function pickRegistryMap(doc, extras) {
    extras = extras || {};
    var fromFile = unwrapChannelStatus(extras.channelStatus);
    if (fromFile) return fromFile;
    if (doc && typeof doc === 'object') {
      var fromMer = unwrapChannelStatus(doc.channel_status) || unwrapChannelStatus(walkPath(doc, ['ads_throttle', 'channel_status']));
      if (fromMer) return fromMer;
      for (var i = 0; i < REGISTRY_PATHS.length; i++) {
        var bag = walkPath(doc, REGISTRY_PATHS[i]);
        if (!bag || Array.isArray(bag)) continue;
        var unwrapped = unwrapChannelStatus(bag);
        if (unwrapped) return unwrapped;
        if (bag.schema || bag.schema_version) continue;
        return bag;
      }
    }
    return null;
  }

  function registryEntryFrom(map, channelId) {
    if (!map || !channelId) return null;
    if (map[channelId]) return map[channelId];
    var aliases = channelKeys(channelId);
    for (var i = 0; i < aliases.length; i++) {
      if (map[aliases[i]]) return map[aliases[i]];
    }
    return null;
  }

  function normalizeRegistryEntry(raw) {
    if (raw == null) return null;
    if (typeof raw !== 'object') {
      if (raw === true || raw === false) return { on: !!raw, since: null, owner: null };
      if (raw === 'on' || raw === 'off') return { on: raw === 'on', since: null, owner: null };
      return null;
    }
    var onRaw = readField(raw, FIELD_MAP.registry_on);
    if (onRaw == null && raw.status != null) {
      var st = String(raw.status);
      if (st === 'on' || st === 'live' || st === 'enabled') onRaw = true;
      else if (st === 'off' || st === 'paused' || st === 'closed' || st === 'not_live' || st === 'not_launched' || st === 'pre_launch') onRaw = false;
    }
    var on = onRaw == null ? null : !!onRaw;
    return {
      on: on,
      since: readField(raw, FIELD_MAP.registry_since) || null,
      owner: readField(raw, FIELD_MAP.registry_owner) || null,
      raw: raw
    };
  }

  function registryOnAt(entry, date) {
    if (!entry) return null;
    var on = entry.on;
    var since = entry.since;
    if (!isDate(date)) return on;
    if (on === false) {
      if (isDate(since) && date < since) return true;
      return false;
    }
    if (on === true) {
      if (isDate(since) && date < since) return false;
      return true;
    }
    return null;
  }

  function pendingItems(doc) {
    if (!doc || typeof doc !== 'object') return [];
    if (Array.isArray(doc.items)) return doc.items;
    if (Array.isArray(doc)) return doc;
    return [];
  }

  function pendingNodeFrom(doc, channelId, date) {
    if (!doc || typeof doc !== 'object' || !channelId || !isDate(date)) return null;
    var items = pendingItems(doc);
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;
      var ch = it.channel || it.id || it.channel_id;
      var dt = it.date || it.day;
      if (channelKeys(channelId).indexOf(String(ch)) === -1) continue;
      if (dt !== date) continue;
      return {
        display_state: STATES.PENDING,
        display_amount: null,
        last_confirmed_date: it.last_confirmed_date || it.date_confirmed || null,
        last_confirmed_amount: finiteNum(it.last_confirmed_amount != null ? it.last_confirmed_amount : it.amount),
        estimated: true
      };
    }
    var byDate = (doc.by_date && doc.by_date[date]) || doc[date];
    var n = nodeFromBag(byDate, channelId);
    if (n) {
      return {
        display_state: STATES.PENDING,
        display_amount: n.display_amount == null ? null : finiteNum(n.display_amount),
        last_confirmed_date: n.last_confirmed_date || null,
        last_confirmed_amount: finiteNum(n.last_confirmed_amount),
        estimated: true
      };
    }
    var byCh = nodeFromBag(doc, channelId);
    if (byCh && typeof byCh === 'object') {
      var day = byCh[date] || (byCh.by_date && byCh.by_date[date]);
      if (day) {
        return {
          display_state: STATES.PENDING,
          display_amount: day.display_amount == null ? null : finiteNum(day.display_amount),
          last_confirmed_date: day.last_confirmed_date || null,
          last_confirmed_amount: finiteNum(day.last_confirmed_amount),
          estimated: true
        };
      }
    }
    return null;
  }

  function pickPending(doc, extras, channelId, date) {
    extras = extras || {};
    return pendingNodeFrom(extras.pendingDoc, channelId, date)
      || pendingNodeFrom(doc && doc.pending_backfill, channelId, date)
      || pendingNodeFrom(walkPath(doc, ['ads_throttle', 'pending_backfill']), channelId, date);
  }

  function advBagForDate(doc, date) {
    if (!doc || !isDate(date)) return null;
    if (doc.advertising_sources && doc.advertising_sources[date]) return doc.advertising_sources[date];
    if (doc[date] && typeof doc[date] === 'object') return doc[date];
    return null;
  }

  function pickDayContract(doc, channelId, date, extras) {
    extras = extras || {};
    if (!channelId || !isDate(date)) return null;

    function withState(node) {
      return node && contractFromNode(node) ? node : null;
    }

    // 1. mer.channel_display.by_date[date][channel]
    if (doc && typeof doc === 'object') {
      var cd = walkPath(doc, ['channel_display', 'by_date', date])
        || walkPath(doc, ['channel_display', date]);
      var n = withState(nodeFromBag(cd, channelId));
      if (n) return n;
      var cdCh = nodeFromBag(doc.channel_display, channelId);
      if (cdCh && typeof cdCh === 'object') {
        n = withState(cdCh[date] || (cdCh.by_date && cdCh.by_date[date]));
        if (n) return n;
      }
    }

    // 2. mer.advertising_sources[date].<channel>_ads
    n = withState(nodeFromBag(advBagForDate(doc, date), channelId));
    if (n) return n;

    // 3. advertising_sources_daily.json
    n = withState(nodeFromBag(advBagForDate(extras.advDaily, date), channelId));
    if (n) return n;

    // Pending list (Finance-owned carried figures).
    var pending = pickPending(doc, extras, channelId, date);
    if (pending) return pending;

    // Legacy bags (pre-#46 adapter paths).
    if (doc && typeof doc === 'object') {
      for (var i = 0; i < DAY_CONTRACT_PATHS.length; i++) {
        var bag = walkPath(doc, DAY_CONTRACT_PATHS[i]);
        if (!bag) continue;
        var byDate = bag[date] || (bag.by_date && bag.by_date[date]);
        n = withState(nodeFromBag(byDate, channelId));
        if (n) return n;
        var byCh = nodeFromBag(bag, channelId);
        if (byCh && typeof byCh === 'object') {
          n = withState(byCh[date] || (byCh.by_date && byCh.by_date[date]));
          if (n) return n;
        }
      }
    }
    return null;
  }

  function contractFromNode(node) {
    if (!node || typeof node !== 'object') return null;
    var state = readField(node, FIELD_MAP.display_state);
    if (state == null) return null;
    var amountRaw = Object.prototype.hasOwnProperty.call(node, 'display_amount') ? node.display_amount : readField(node, FIELD_MAP.display_amount);
    return {
      display_state: String(state),
      display_amount: finiteNum(amountRaw),
      last_confirmed_date: readField(node, FIELD_MAP.last_confirmed_date) || null,
      last_confirmed_amount: finiteNum(readField(node, FIELD_MAP.last_confirmed_amount)),
      measured_spend: finiteNum(readField(node, FIELD_MAP.measured_spend)),
      cash_cost: Object.prototype.hasOwnProperty.call(node, 'cash_cost') ? finiteNum(node.cash_cost) : finiteNum(readField(node, FIELD_MAP.cash_cost)),
      cash_cost_status: node.cash_cost_status != null ? String(node.cash_cost_status) : null,
      estimated: !!readField(node, FIELD_MAP.estimated)
    };
  }

  function view(state, amount, extra) {
    extra = extra || {};
    return {
      display_state: state,
      display_amount: amount == null ? null : round2(amount),
      last_confirmed_date: extra.last_confirmed_date || null,
      last_confirmed_amount: extra.last_confirmed_amount == null ? null : round2(extra.last_confirmed_amount),
      measured_spend: extra.measured_spend == null ? null : round2(extra.measured_spend),
      cash_cost: extra.cash_cost == null ? null : round2(extra.cash_cost),
      cash_cost_status: extra.cash_cost_status || null,
      estimated: !!extra.estimated,
      source: extra.source || null,
      valid: extra.valid !== false,
      error: extra.error || null
    };
  }

  function validateContract(c) {
    if (!c || ALLOWED.indexOf(c.display_state) === -1) {
      return view(null, null, { valid: false, error: 'invalid_display_state', source: 'contract' });
    }
    if (c.display_state === STATES.SPEND && c.display_amount == null) {
      return view(STATES.SPEND, null, { valid: false, error: 'spend_missing_amount', source: 'contract' });
    }
    if (c.display_state === STATES.PENDING) {
      if (!isDate(c.last_confirmed_date) || c.last_confirmed_amount == null) {
        return view(STATES.PENDING, c.display_amount, {
          valid: false,
          error: 'pending_backfill_missing_last_confirmed',
          source: 'contract',
          last_confirmed_date: c.last_confirmed_date,
          last_confirmed_amount: c.last_confirmed_amount
        });
      }
    }
    var amt = c.display_state === STATES.ZERO ? 0
      : (c.display_state === STATES.PENDING ? c.last_confirmed_amount : c.display_amount);
    return view(c.display_state, amt, {
      last_confirmed_date: c.last_confirmed_date,
      last_confirmed_amount: c.last_confirmed_amount,
      measured_spend: c.measured_spend,
      cash_cost: c.cash_cost,
      cash_cost_status: c.cash_cost_status,
      estimated: c.estimated || c.display_state === STATES.PENDING,
      source: 'contract',
      valid: true
    });
  }

  function nodeLive(node) {
    if (!node || typeof node !== 'object') return null;
    if (typeof node.live === 'boolean') return node.live;
    return null;
  }

  function nodePaused(node) {
    if (!node || typeof node !== 'object') return false;
    // Per-day status only. Root wrappers (status off / pre_launch) are not passed here.
    var st = node.status != null ? String(node.status) : '';
    if (st === 'paused' || st === 'not_live' || st === 'not_launched' || st === 'pre_launch' || st === 'dark' || st === 'closed' || st === 'off') return true;
    if (node.paused === true) return true;
    return false;
  }

  function measuredSpend(node) {
    if (node == null) return null;
    if (typeof node === 'number' || typeof node === 'string') return finiteNum(node);
    if (typeof node !== 'object') return null;
    var s = finiteNum(node.measured_spend);
    if (s == null) s = finiteNum(node.spend);
    if (s == null) s = finiteNum(node.daily_spend);
    if (s == null) s = finiteNum(node.ad_spend);
    if (s == null && node.display_amount != null) s = finiteNum(node.display_amount);
    return s;
  }

  /**
   * Interim fallback when display_state is absent (current live feeds, pre-#46).
   *   off          → registry/feed live=false or paused
   *   spend        → measured > 0 (wins over off so a spent day is never hidden)
   *   zero         → measured 0 with live=true
   *   pending      → live channel, no row for that day (never $0)
   */
  function derive(input) {
    input = input || {};
    var date = input.date;
    var node = input.measured != null ? input.measured : null;
    var hasRow = !!input.hasRow;
    if (!hasRow && node != null) hasRow = true;
    var spend = hasRow ? measuredSpend(node) : null;
    var live = nodeLive(node);
    if (live == null && input.feedLive != null) live = !!input.feedLive;
    var regOn = registryOnAt(input.registry, date);
    var paused = !!(input.paused || nodePaused(node));
    var off = (regOn === false) || (live === false) || paused || (input.feedLive === false && !(spend > 0));

    if (spend != null && spend > 0) {
      return view(STATES.SPEND, spend, { source: 'measured', estimated: false, measured_spend: spend });
    }
    if (off) {
      return view(STATES.OFF, 0, { source: 'off' });
    }
    if (hasRow && spend === 0 && live !== false) {
      return view(STATES.ZERO, 0, { source: 'measured_zero', measured_spend: 0 });
    }
    if (live === true || input.feedLive === true || input.assumeLive) {
      var lc = input.lastConfirmed || null;
      if (!lc || !isDate(lc.date) || lc.amount == null) {
        return view(STATES.PENDING, null, {
          valid: false,
          error: 'pending_backfill_missing_last_confirmed',
          source: 'interim',
          estimated: true
        });
      }
      return view(STATES.PENDING, lc.amount, {
        last_confirmed_date: lc.date,
        last_confirmed_amount: lc.amount,
        estimated: true,
        source: 'interim'
      });
    }
    return view(STATES.OFF, 0, { source: 'off_default' });
  }

  function resolve(input) {
    input = input || {};
    var contract = input.contract || contractFromNode(input.dayNode) || contractFromNode(input.measured);
    if (contract && contract.display_state != null) {
      return validateContract(contract);
    }
    return derive(input);
  }

  function formatDateLabel(date) {
    if (!isDate(date)) return String(date == null ? '' : date);
    var p = date.split('-');
    return Number(p[1]) + '/' + Number(p[2]);
  }

  /**
   * One shared formatter. Returns exactly one of:
   *   Channel off
   *   $0.00
   *   $<amount>
   *   $<last_confirmed_amount> pending backfill (last confirmed <date>)
   * Invalid views do not invent $0 / off / missing — they return ''.
   */
  function format(v) {
    if (!v || v.valid === false) return '';
    if (v.display_state === STATES.OFF) return 'Channel off';
    if (v.display_state === STATES.ZERO) return '$0.00';
    if (v.display_state === STATES.SPEND) {
      if (v.display_amount == null) return '';
      return usd(v.display_amount);
    }
    if (v.display_state === STATES.PENDING) {
      if (v.last_confirmed_amount == null || !v.last_confirmed_date) return '';
      return usd(v.last_confirmed_amount) + ' pending backfill (last confirmed ' + formatDateLabel(v.last_confirmed_date) + ')';
    }
    return '';
  }

  function cashCostIsUnbilled(cashCost, cashStatus) {
    var st = cashStatus != null ? String(cashStatus) : '';
    if (st === 'missing' || st === 'not_billed' || st === 'unpublished' || st === 'pending') return true;
    return false;
  }

  function cashCostLabel(cashCost, cashStatus) {
    if (cashCostIsUnbilled(cashCost, cashStatus) && finiteNum(cashCost) == null) return 'not billed yet';
    var cash = finiteNum(cashCost);
    if (cash == null) return '';
    return usd(cash);
  }

  function formatWithCash(v, cashCost, cashStatus) {
    var txt = format(v);
    if (!txt || !v || v.display_state !== STATES.SPEND) return txt;
    var label = cashCostLabel(cashCost, cashStatus);
    if (!label) return txt;
    return txt + ' (cash cost ' + label + ')';
  }

  function forbiddenSpendLabel(txt) {
    if (txt == null) return false;
    var s = String(txt);
    return /missing/i.test(s) || /No data/.test(s) || /not live/i.test(s);
  }

  function mergeRegistry(doc, extras) {
    var published = pickRegistryMap(doc, extras);
    var out = {};
    Object.keys(INTERIM_REGISTRY).forEach(function (id) {
      out[id] = INTERIM_REGISTRY[id];
    });
    if (published) {
      Object.keys(published).forEach(function (id) {
        if (id === 'schema' || id === 'schema_version' || id === 'as_of' || id === 'updated_at' || id === 'notes' || id === 'channels') return;
        var n = normalizeRegistryEntry(published[id]);
        if (n) out[id] = n;
      });
    }
    return out;
  }

  var api = {
    STATES: STATES,
    ALLOWED: ALLOWED,
    FIELD_MAP: FIELD_MAP,
    REGISTRY_PATHS: REGISTRY_PATHS,
    DAY_CONTRACT_PATHS: DAY_CONTRACT_PATHS,
    INTERIM_REGISTRY: INTERIM_REGISTRY,
    CHANNEL_STATUS_SCHEMA: CHANNEL_STATUS_SCHEMA,
    CHANNEL_STATUS_IDS: CHANNEL_STATUS_IDS,
    usd: usd,
    finiteNum: finiteNum,
    readField: readField,
    pickRegistryMap: pickRegistryMap,
    pickDayContract: pickDayContract,
    pickPending: pickPending,
    contractFromNode: contractFromNode,
    normalizeRegistryEntry: normalizeRegistryEntry,
    registryOnAt: registryOnAt,
    mergeRegistry: mergeRegistry,
    registryEntryFrom: registryEntryFrom,
    validateContract: validateContract,
    derive: derive,
    resolve: resolve,
    format: format,
    formatWithCash: formatWithCash,
    cashCostLabel: cashCostLabel,
    formatDateLabel: formatDateLabel,
    forbiddenSpendLabel: forbiddenSpendLabel,
    measuredSpend: measuredSpend
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChannelSpendDisplay = api;
})(typeof window !== 'undefined' ? window : globalThis);
