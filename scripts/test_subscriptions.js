'use strict';

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var M = require('../subscriptions_module.js');

var failed = 0;
var pending = [];

function test(name, fn) {
  var p;
  try { p = fn(); }
  catch (e) {
    failed += 1;
    console.error('FAIL - ' + name);
    console.error('     ' + (e && e.stack ? e.stack : e));
    return;
  }
  if (p && typeof p.then === 'function') {
    pending.push(p.then(function () { console.log('ok  - ' + name); }, function (e) {
      failed += 1;
      console.error('FAIL - ' + name);
      console.error('     ' + (e && e.stack ? e.stack : e));
    }));
  } else {
    console.log('ok  - ' + name);
  }
}

var ROOT = path.join(__dirname, '..');
var SHIPPED = path.join(ROOT, 'subscriptions.enc.json');
var FIXTURE = path.join(ROOT, 'scripts/fixtures/subscriptions.example.enc.json');
var PASS_OK = 'testpass123';

function walkFiles(dir, acc) {
  acc = acc || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent) {
    if (ent.name === 'node_modules' || ent.name === '.git') return;
    var p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  });
  return acc;
}

function assertEnvelope(enc) {
  assert.strictEqual(enc.v, 1);
  assert.strictEqual(enc.kdf, 'PBKDF2-SHA256');
  assert.strictEqual(enc.cipher, 'AES-256-GCM');
  assert.ok(enc.iter >= 100000);
  assert.ok(enc.salt && enc.iv && enc.ct);
}

test('shipped envelope is present, well-formed, and is not the example fixture', function () {
  var shipped = JSON.parse(fs.readFileSync(SHIPPED, 'utf8'));
  var fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assertEnvelope(shipped);
  assertEnvelope(fixture);
  assert.notStrictEqual(shipped.salt, fixture.salt);
  assert.notStrictEqual(shipped.ct, fixture.ct);
  assert.ok(shipped.ct.length > 20000, 'live envelope should be much larger than the 3-row example');
});

test('index.html loads the module once, after the other tab modules, and does not embed a panel', function () {
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.strictEqual((html.match(/<script src="subscriptions_module.js"><\/script>/g) || []).length, 1);
  assert.ok(html.indexOf('subscriptions_module.js') > html.indexOf('ad_loop_module.js'));
  assert.ok(html.indexOf('data-tab="subscriptions"') === -1);
  assert.ok(html.indexOf('id="tab-subscriptions"') === -1);
});

test('module appends the tab last and uses the #subscriptions hash', function () {
  var src = fs.readFileSync(path.join(ROOT, 'subscriptions_module.js'), 'utf8');
  assert.ok(src.indexOf('tabs.appendChild(btn)') !== -1);
  assert.strictEqual(M.TAB_KEY, 'subscriptions');
  assert.strictEqual(M.HASH, '#subscriptions');
  assert.strictEqual(M.FILE, 'subscriptions.enc.json');
  assert.strictEqual(M.PAGE_SIZE, 25);
});

test('gitignore ignores plaintext dumps but not encrypted envelopes', function () {
  var gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.ok(/subscriptions\*\.json/.test(gi));
  assert.ok(/!subscriptions\*\.enc\.json/.test(gi));
  var plain = cp.spawnSync('git', ['check-ignore', '-q', '--no-index', 'subscriptions.json'], { cwd: ROOT });
  assert.strictEqual(plain.status, 0, 'plaintext path is ignored');
  var enc = cp.spawnSync('git', ['check-ignore', '-q', 'subscriptions.enc.json'], { cwd: ROOT });
  assert.notStrictEqual(enc.status, 0, 'live envelope is not ignored');
  var fix = cp.spawnSync('git', ['check-ignore', '-q', 'scripts/fixtures/subscriptions.example.enc.json'], { cwd: ROOT });
  assert.notStrictEqual(fix.status, 0, 'example fixture envelope is not ignored');
});

test('example fixture decrypts with the test password; shipped file does not', async function () {
  var fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  var data = await M.decryptEnvelope(fixture, PASS_OK);
  assert.ok(data.generated_at);
  assert.ok(Array.isArray(data.subscriptions));
  assert.strictEqual(data.subscriptions.length, 3);
  var statuses = data.subscriptions.map(function (r) { return M.normStatus(r.status); }).sort();
  assert.deepStrictEqual(statuses, ['active', 'active', 'turned off']);
  var bad = false;
  try { await M.decryptEnvelope(fixture, 'not-the-password'); }
  catch (e) { bad = true; }
  assert.ok(bad, 'wrong password must reject');

  var shipped = JSON.parse(fs.readFileSync(SHIPPED, 'utf8'));
  var shippedIsNotExample = false;
  try { await M.decryptEnvelope(shipped, PASS_OK); }
  catch (e) { shippedIsNotExample = true; }
  assert.ok(shippedIsNotExample, 'live envelope must not unlock with the example password');
});

test('kpis, default filters, sort and buckets against the example fixture', async function () {
  var enc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  var data = await M.decryptEnvelope(enc, PASS_OK);
  var rows = data.subscriptions;
  var k = M.kpis(data);
  var active = rows.filter(function (r) { return M.normStatus(r.status) === 'active'; });
  var off = rows.filter(function (r) { return M.normStatus(r.status) === 'turned off'; });
  var monthly = active.reduce(function (s, r) { return s + (Number(r.monthly_cost) || 0); }, 0);
  var annual = active.reduce(function (s, r) { return s + (Number(r.annual_cost) || 0); }, 0);
  assert.strictEqual(k.active, active.length);
  assert.strictEqual(k.off, off.length);
  assert.strictEqual(k.unknown, 0);
  assert.strictEqual(k.monthly, monthly);
  assert.strictEqual(k.annual, annual);
  assert.strictEqual(k.active, 2);
  assert.strictEqual(k.off, 1);

  var def = M.applyFilters(rows, { showOff: false });
  assert.strictEqual(def.length, 2);
  def.forEach(function (r) { assert.notStrictEqual(M.normStatus(r.status), 'turned off'); });
  assert.strictEqual(M.applyFilters(rows, { showOff: true }).length, 3);

  var sorted = M.sortRows(rows, 'annual_cost', 'desc');
  assert.ok(sorted[0].annual_cost >= sorted[1].annual_cost);
  assert.ok(sorted[1].annual_cost >= sorted[2].annual_cost);
});

test('unknown status is needs-verification; extra cycles render and filter; active totals ignore them', function () {
  assert.strictEqual(M.statusLabel('unknown'), 'Needs verification');
  assert.strictEqual(M.statusClass('unknown'), 'su-warn');
  assert.strictEqual(M.cycleLabel('usage-based'), 'Usage-based');
  assert.strictEqual(M.cycleLabel('quarterly'), 'Quarterly');
  assert.strictEqual(M.cycleLabel('weekly'), 'Weekly');
  assert.strictEqual(M.cycleLabel('unknown'), 'Unknown');
  assert.strictEqual(M.cycleLabel('monthly'), 'Monthly');

  var rows = [
    { name: 'A', category: 'X', cycle: 'monthly', monthly_cost: 10, annual_cost: 120, status: 'active', amount: 10 },
    { name: 'B', category: 'Y', cycle: 'usage-based', monthly_cost: 9999, annual_cost: 99999, status: 'unknown', amount: 9999 },
    { name: 'C', category: 'X', cycle: 'quarterly', monthly_cost: 40, annual_cost: 480, status: 'active', amount: 120 },
    { name: 'D', category: 'Z', cycle: 'weekly', monthly_cost: 8, annual_cost: 416, status: 'turned off', amount: 8 },
    { name: 'E', category: 'Z', cycle: 'unknown', monthly_cost: 1, annual_cost: 12, status: 'unknown', amount: 1 }
  ];
  var k = M.kpis({ generated_at: '2026-11-10', subscriptions: rows });
  assert.strictEqual(k.active, 2);
  assert.strictEqual(k.unknown, 2);
  assert.strictEqual(k.off, 1);
  assert.strictEqual(k.monthly, 50);
  assert.strictEqual(k.annual, 600);

  var def = M.applyFilters(rows, { showOff: false });
  assert.strictEqual(def.length, 4);
  assert.ok(def.some(function (r) { return M.normStatus(r.status) === 'unknown'; }));

  assert.strictEqual(M.applyFilters(rows, { showOff: true, cycle: 'usage-based' }).length, 1);
  assert.strictEqual(M.applyFilters(rows, { showOff: true, cycle: 'quarterly' }).length, 1);
  assert.strictEqual(M.applyFilters(rows, { showOff: true, cycle: 'weekly' }).length, 1);
  assert.strictEqual(M.applyFilters(rows, { showOff: true, cycle: 'unknown' }).length, 1);
  assert.ok(M.applyFilters(rows, { showOff: true, search: 'verification' }).length >= 2);
});

test('null amounts format as em dash; paging handles 113 rows', function () {
  assert.strictEqual(M.usd(null), '—');
  assert.strictEqual(M.usd(1200), '$1,200');
  assert.strictEqual(M.fmtDay(null), '—');
  var many = [];
  var i;
  for (i = 0; i < 113; i++) {
    many.push({
      name: 'R' + i,
      category: 'G' + (i % 9),
      cycle: ['monthly', 'annual', 'quarterly', 'weekly', 'usage-based', 'unknown'][i % 6],
      monthly_cost: i,
      annual_cost: 113 - i,
      status: i % 10 === 0 ? 'unknown' : (i % 7 === 0 ? 'turned off' : 'active')
    });
  }
  assert.strictEqual(many.length, 113);
  var k = M.kpis({ generated_at: '2026-11-10', subscriptions: many });
  assert.strictEqual(k.active + k.off + k.unknown, 113);
  assert.ok(k.unknown > 0);
  var p1 = M.pageSlice(many, 1, 25);
  assert.strictEqual(p1.rows.length, 25);
  assert.strictEqual(p1.pages, 5);
  assert.strictEqual(p1.from, 1);
  assert.strictEqual(p1.to, 25);
  var p5 = M.pageSlice(many, 5, 25);
  assert.strictEqual(p5.rows.length, 13);
  assert.strictEqual(p5.from, 101);
  assert.strictEqual(p5.to, 113);
  var clamped = M.pageSlice(many, 99, 25);
  assert.strictEqual(clamped.page, 5);
  assert.strictEqual(M.topSlices(M.breakdown(many, 'category'), 3).length, 4);
});

test('encrypt script round-trips through decryptEnvelope', async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'su-enc-'));
  var inp = path.join(dir, 'in.json');
  var out = path.join(dir, 'out.enc.json');
  var payload = { generated_at: '2026-01-01T00:00:00Z', subscriptions: [{ id: 't', status: 'active', annual_cost: 12, monthly_cost: 1, amount: 1, cycle: 'monthly' }] };
  fs.writeFileSync(inp, JSON.stringify(payload));
  cp.execFileSync('node', [path.join(ROOT, 'scripts/encrypt_subscriptions.mjs'), inp, out], {
    env: Object.assign({}, process.env, { PASS: 'roundtrip-secret' })
  });
  var enc = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(enc.kdf, 'PBKDF2-SHA256');
  var data = await M.decryptEnvelope(enc, 'roundtrip-secret');
  assert.strictEqual(data.subscriptions[0].id, 't');
  var rejected = false;
  try { await M.decryptEnvelope(enc, 'nope'); } catch (e) { rejected = true; }
  assert.ok(rejected);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('published source has no plaintext fields from the example fixture', async function () {
  var enc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  var data = await M.decryptEnvelope(enc, PASS_OK);
  var needles = [];
  data.subscriptions.forEach(function (s) {
    ['name', 'account_email', 'manage_url', 'cancel_url', 'latest_subject'].forEach(function (k) {
      if (s[k]) needles.push(String(s[k]));
    });
    if (s.card_last4 && String(s.card_last4).length >= 4) needles.push(String(s.card_last4));
  });
  needles = needles.filter(function (n) { return n.length >= 8; });
  assert.ok(needles.length >= 3);
  var files = walkFiles(ROOT);
  files.forEach(function (p) {
    var abs = path.resolve(p);
    if (abs === path.resolve(FIXTURE) || abs === path.resolve(SHIPPED)) return;
    if (/\.(png|jpg|jpeg|webp|gif|woff2?|min\.js)$/i.test(p)) return;
    var txt = fs.readFileSync(p, 'utf8');
    needles.forEach(function (n) {
      assert.ok(txt.indexOf(n) === -1, path.relative(ROOT, p) + ' leaks ' + JSON.stringify(n));
    });
  });
});

test('mark as canceled drops active KPIs and charts; undo restores; local wins over committed', async function () {
  var enc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  var data = await M.decryptEnvelope(enc, PASS_OK);
  var before = M.kpis(data);
  var active = data.subscriptions.filter(function (r) { return M.normStatus(r.status) === 'active'; });
  var target = active[0];
  var marks = M.markCanceled({}, target.id, '2026-11-11T12:00:00Z');
  var after = M.kpis(data, marks);
  assert.strictEqual(after.active, before.active - 1);
  assert.strictEqual(after.monthly, before.monthly - (Number(target.monthly_cost) || 0));
  assert.strictEqual(after.annual, before.annual - (Number(target.annual_cost) || 0));
  assert.ok(after.canceled >= 1);
  assert.ok(after.renewals30 <= before.renewals30);

  var applied = M.applyOverrides(data.subscriptions, marks);
  var row = applied.filter(function (r) { return String(r.id) === String(target.id); })[0];
  assert.strictEqual(M.effectiveStatus(row), 'canceled');
  assert.strictEqual(M.statusLabel('canceled'), 'Canceled (marked)');
  assert.strictEqual(M.statusClass('canceled'), 'su-off');
  assert.strictEqual(M.applyFilters(applied, { showOff: false }).length, before.active - 1 + before.unknown);
  assert.ok(M.applyFilters(applied, { showOff: true }).some(function (r) { return r.marked; }));

  var chartRows = applied.filter(function (r) { return M.effectiveStatus(r) === 'active'; });
  var beforeAnnual = M.breakdown(data.subscriptions.filter(function (r) { return M.normStatus(r.status) === 'active'; }), 'cycle')
    .reduce(function (s, x) { return s + x.annual; }, 0);
  var afterAnnual = M.breakdown(chartRows, 'cycle').reduce(function (s, x) { return s + x.annual; }, 0);
  assert.strictEqual(afterAnnual, beforeAnnual - (Number(target.annual_cost) || 0));

  var restored = M.kpis(data, M.undoMark(marks, target.id, {}));
  assert.strictEqual(restored.active, before.active);
  assert.strictEqual(restored.monthly, before.monthly);
  assert.strictEqual(restored.annual, before.annual);

  var committed = M.listToMarkMap([{ id: target.id, status: 'canceled', marked_at: '2026-01-01' }]);
  var localClear = M.undoMark({}, target.id, committed);
  var merged = M.mergeMarks(committed, localClear);
  assert.strictEqual(Object.keys(merged).length, 0);
  var localWin = M.mergeMarks(committed, M.markCanceled({}, 'other', '2026-11-11'));
  assert.strictEqual(localWin[String(target.id)].status, 'canceled');
  assert.strictEqual(localWin.other.status, 'canceled');
  assert.deepStrictEqual(M.exportMarks(marks), [{ id: String(target.id), status: 'canceled', marked_at: '2026-11-11T12:00:00Z' }]);
});

test('override blob is AES-GCM with a fresh IV and does not contain plaintext ids', async function () {
  var enc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  var unlocked = await M.decryptSubscriptions(enc, PASS_OK);
  var id = 'override-id-should-not-leak-plaintext';
  var payload = { local: M.markCanceled({}, id, '2026-11-11T00:00:00Z'), committed: {} };
  var blob1 = await M.encryptJsonWithKey(unlocked.key, payload);
  var blob2 = await M.encryptJsonWithKey(unlocked.key, payload);
  assert.strictEqual(blob1.cipher, 'AES-256-GCM');
  assert.notStrictEqual(blob1.iv, blob2.iv);
  assert.ok(JSON.stringify(blob1).indexOf(id) === -1);
  var round = await M.decryptJsonWithKey(unlocked.key, blob1.iv, blob1.ct);
  assert.strictEqual(round.local[id].status, 'canceled');
});

Promise.all(pending).then(function () {
  if (failed) {
    console.error('\n' + failed + ' subscriptions test(s) failed');
    process.exit(1);
  }
  console.log('\nAll subscriptions tests passed');
});
