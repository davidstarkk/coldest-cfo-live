#!/usr/bin/env node
/* =====================================================================
   SYNC GUARD — GitHub owns code/UI, the Perplexity workspace owns data.

   The workspace cron copies its whole folder over this repo every morning
   ("daily sync — YYYY-MM-DD"). It never pulls first, so every GitHub fix
   to cfo_backend/, pipeline/ or the index.html UI is reverted the next day.

   For each file the sync commit S changed vs its parent P (GitHub state),
   with B = the previous sync commit (the workspace copy as of last sync):
     - S == B        → the workspace did not touch it; the "change" is only
                       the revert of GitHub work → keep P.
     - data file     → the workspace owns it → keep S.
     - index.html    → 3-way merge of the UI with every top-level
                       `const NAME = …;` data literal masked, then refill
                       the data from S.
     - code          → 3-way merge (git merge-file); a conflict keeps
                       GitHub's lines. A merge that no longer parses falls
                       back to P.

   CLI: node lib/sync_guard.js [--write] [--sync-grep '^daily sync']
                               [--base REF] [--ours REF] [--theirs REF]
   Defaults: theirs=HEAD, ours=theirs^, base=previous sync commit.
   Same file is vendored in davidstarkk/coldest-cfo-live
   (scripts/lib/sync_guard.js) with --sync-grep '^public mirror sync'.
   ===================================================================== */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var DATA_EXT = { '.json': 1, '.db': 1, '.sqlite': 1, '.csv': 1 };
var DATA_FILES = { 'email_preview.html': 1 };
var DATA_DIRS = ['private_finance_data/', 'protected_days/', 'ads_throttle/'];
var DATA_CONST = /^const ([A-Z][A-Z0-9_]*) = /gm;
var MASK = '@@SYNC_GUARD:';

function classify(file) {
  var base = path.posix.basename(file);
  if (base === 'index.html') return 'page';
  if (DATA_FILES[base] || DATA_EXT[path.posix.extname(file)]) return 'data';
  for (var i = 0; i < DATA_DIRS.length; i++) if (file.indexOf(DATA_DIRS[i]) === 0) return 'data';
  return 'code';
}

/* End of a JS literal statement starting at i: index just past the `;`
   (or the newline) at bracket depth 0. Skips strings and comments. */
function literalEnd(src, i) {
  var depth = 0;
  for (var j = i; j < src.length; j++) {
    var ch = src[j];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (j++; j < src.length && src[j] !== ch; j++) if (src[j] === '\\') j++;
      continue;
    }
    if (ch === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); if (j < 0) return -1; j--; continue; }
    if (ch === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j + 2); if (j < 0) return -1; j++; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (depth === 0 && (ch === ';' || ch === '\n')) return ch === ';' ? j + 1 : j;
  }
  return -1;
}

/* Replace every top-level data literal with a mask token.
   Returns { skeleton, data: { 'NAME#n': 'literal text' } }. */
function maskPage(html) {
  var out = '', data = {}, seen = {}, last = 0, m;
  DATA_CONST.lastIndex = 0;
  while ((m = DATA_CONST.exec(html))) {
    var start = m.index + m[0].length;
    var end = literalEnd(html, start);
    if (end < 0) break;
    var semi = html[end - 1] === ';';
    var key = m[1] + '#' + (seen[m[1]] = (seen[m[1]] || 0) + 1);
    data[key] = html.slice(start, semi ? end - 1 : end);
    out += html.slice(last, start) + MASK + key + '@@' + (semi ? ';' : '');
    last = end;
    DATA_CONST.lastIndex = end;
  }
  return { skeleton: out + html.slice(last), data: data };
}

function fillPage(skeleton, sources) {
  var missing = [];
  var html = skeleton.replace(/@@SYNC_GUARD:([A-Z0-9_]+#\d+)@@/g, function (_, key) {
    for (var i = 0; i < sources.length; i++) {
      if (sources[i] && Object.prototype.hasOwnProperty.call(sources[i], key)) return sources[i][key];
    }
    missing.push(key);
    return 'null';
  });
  return { html: html, missing: missing };
}

function merge3(base, ours, theirs) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-guard-'));
  try {
    var files = { ours: ours, base: base, theirs: theirs };
    Object.keys(files).forEach(function (k) { fs.writeFileSync(path.join(dir, k), files[k]); });
    var conflicts = 0;
    var args = ['merge-file', '-p', path.join(dir, 'ours'), path.join(dir, 'base'), path.join(dir, 'theirs')];
    try { cp.execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30 }); }
    catch (e) { if (typeof e.status === 'number' && e.status > 0) conflicts = e.status; else throw e; }
    var text = cp.execFileSync('git', ['merge-file', '-p', '--ours'].concat(args.slice(2)),
      { encoding: 'utf8', maxBuffer: 1 << 30 });
    return { text: text, conflicts: conflicts };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function mergePage(base, ours, theirs) {
  var b = maskPage(base || ''), o = maskPage(ours), t = maskPage(theirs);
  var m = merge3(b.skeleton, o.skeleton, t.skeleton);
  var filled = fillPage(m.text, [t.data, o.data, b.data]);
  return { text: filled.html, conflicts: m.conflicts, missing: filled.missing };
}

function parses(file, text) {
  var ext = path.posix.extname(file);
  var check = ext === '.js' ? ['node', ['--check']] : ext === '.py' ? ['python3', ['-m', 'py_compile']] : null;
  if (!check) return true;
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-guard-'));
  try {
    var p = path.join(dir, 'f' + ext);
    fs.writeFileSync(p, text);
    cp.execFileSync(check[0], check[1].concat([p]), { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* Decide one file. b/o/t are Buffers or null (missing at that ref). */
function resolveFile(file, b, o, t) {
  if (t == null) return { action: 'skip_deleted' };
  if (o == null) return { action: 'took_theirs_new', out: t };
  if (b != null && Buffer.compare(b, t) === 0) return { action: 'kept_ours_unchanged_upstream', out: o };
  var kind = classify(file);
  if (kind === 'data') return { action: 'took_theirs_data', out: t };
  if (b == null) return { action: 'kept_ours_no_base', out: o };
  if (kind === 'page') {
    var pm = mergePage(b.toString('utf8'), o.toString('utf8'), t.toString('utf8'));
    if (pm.missing.length) return { action: 'took_theirs_page_unsafe', out: t, missing: pm.missing };
    return { action: 'merged_page', out: Buffer.from(pm.text, 'utf8'), conflicts: pm.conflicts };
  }
  var m = merge3(b, o, t);
  if (!parses(file, m.text)) return { action: 'kept_ours_merge_unparseable', out: o, conflicts: m.conflicts };
  return { action: m.conflicts ? 'merged_conflicts_kept_ours' : 'merged', out: Buffer.from(m.text, 'utf8'), conflicts: m.conflicts };
}

function git(args, opts) {
  return cp.execFileSync('git', args, Object.assign({ maxBuffer: 1 << 30 }, opts || {}));
}

function show(ref, file) {
  try { return git(['show', ref + ':' + file], { stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return null; }
}

function previousSync(ref, grep) {
  var out = git(['log', '--format=%H', '-n', '1', '--extended-regexp', '--grep=' + grep, ref], { encoding: 'utf8' }).trim();
  return out || null;
}

function run(opts) {
  var theirs = opts.theirs || 'HEAD';
  var ours = opts.ours || theirs + '^';
  var base = opts.base || previousSync(ours, opts.grep);
  var report = { base: base, ours: ours, theirs: theirs, files: [] };
  if (!base) { report.skipped = 'no previous sync commit in fetched history'; return report; }
  var changed = git(['diff', '--name-only', ours, theirs], { encoding: 'utf8' }).split('\n').filter(Boolean);
  changed.forEach(function (file) {
    var r = resolveFile(file, show(base, file), show(ours, file), show(theirs, file));
    var entry = { file: file, action: r.action };
    if (r.conflicts) entry.conflicts = r.conflicts;
    if (r.missing) entry.missing = r.missing;
    if (r.out) {
      var current = fs.existsSync(file) ? fs.readFileSync(file) : null;
      entry.changed = !current || Buffer.compare(current, r.out) !== 0;
      if (opts.write && entry.changed) fs.writeFileSync(file, r.out);
    }
    report.files.push(entry);
  });
  return report;
}

function parseArgs(argv) {
  var o = { grep: '^daily sync', write: false };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--write') o.write = true;
    else if (a === '--sync-grep') o.grep = argv[++i];
    else if (a === '--base') o.base = argv[++i];
    else if (a === '--ours') o.ours = argv[++i];
    else if (a === '--theirs') o.theirs = argv[++i];
  }
  return o;
}

if (require.main === module) {
  var report = run(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(report, null, 2));
}

module.exports = { classify: classify, literalEnd: literalEnd, maskPage: maskPage, fillPage: fillPage,
  merge3: merge3, mergePage: mergePage, resolveFile: resolveFile, run: run, parseArgs: parseArgs };
