// Release paperwork (paw-jvrz, paw-umhr, paw-zqxu): licence, terms, the public folder's texts and build defaults.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
// the placeholders, spelt so the public export's fill (export-source.ps1) leaves this file alone (paw-x04i)
const PH = { SOURCE_URL: '{' + '{SOURCE_URL}}', CONTACT: '{' + '{CONTACT}}' };

test('LICENSE is the GPLv3 text, the same as the one shipped for ffmpeg', () => {
  const gpl = lf(read('LICENSE'));
  assert.match(gpl, /^\s*GNU GENERAL PUBLIC LICENSE\n\s*Version 3, 29 June 2007/);
  assert.equal(gpl, lf(read('dev/share/LICENSES/ffmpeg-LICENSE.txt')));
  assert.equal(JSON.parse(read('package.json')).license, 'GPL-3.0-or-later');
  assert.match(read('trackers/pyproject.toml'), /^license = "GPL-3.0-or-later"$/m);
  assert.doesNotMatch(read('README.md'), /not chosen yet/);
});

test('the public texts: 18+, terms, the source offer, one placeholder of each kind', async () => {
  const terms = read('dev/share/TERMS.txt'), readme = read('dev/share/README.txt');
  const rel = await import('../src/app/release.js');   // the public source export fills the placeholders with these
  const fill = (t) => t.replaceAll(rel.CONTACT, PH.CONTACT).replaceAll(rel.SOURCE_URL, PH.SOURCE_URL);
  for (const h of ['ADULTS ONLY (18+)', 'NO WARRANTY', 'DEVICES: AT YOUR OWN RISK', 'YOUR MEDIA', 'WHAT YOU MAKE IS YOURS',
    'NOTHING LEAVES YOUR PC', 'LICENCE', 'SOURCE CODE (WRITTEN OFFER)']) assert.ok(terms.includes(h), h);
  assert.match(terms, /Shift\+Esc or the Pause key/);
  assert.match(terms, /8\.1\.1-full_build-www\.gyan\.dev/);
  for (const t of [terms, readme].map(fill)) {
    assert.ok(t.includes(PH.SOURCE_URL) && t.includes(PH.CONTACT));
    assert.deepEqual(t.match(/\{\{[A-Z_]+\}\}/g).filter((x) => x !== PH.SOURCE_URL && x !== PH.CONTACT), []);
  }
  assert.doesNotMatch(readme, /pass it on|friends/i);
  assert.match(readme, /18\+/);
  assert.match(read('src/app/core-commands.js'), /For adults \(18\+\) only\./);
  assert.match(read('src/app/ProjectPage.svelte'), /For adults \(18\+\) only/);
  assert.doesNotMatch(read('dev/share/sitecustomize.py'), /Get-Pawscript/);
});

test('where Pawscript lives is set once (src/app/release.js) and quoted, not copied, elsewhere', async () => {
  const { SOURCE_URL, CONTACT } = await import('../src/app/release.js');
  assert.match(SOURCE_URL, /^https:\/\//);
  assert.match(CONTACT, /^https:\/\//);
  for (const f of ['README.md', 'NOTICE']) assert.ok(read(f).includes(SOURCE_URL), `${f} must quote release.js SOURCE_URL`);
  const bug = await import('../src/app/bug-report.js');
  assert.ok(bug.CONTACT.includes(CONTACT.replace(/^https?:\/\//, '')), bug.CONTACT);
  assert.match(read('src/app/core-commands.js'), /Source: \$\{SOURCE_URL\}/);
  assert.match(read('dev/share/build-nas.ps1'), /export const \$k = /, 'the build fills the shipped texts from release.js');
});

test('the public build leaves the stock toy library and the tagger pack out unless -Private', () => {
  const ps = read('dev/share/build-nas.ps1');
  assert.doesNotMatch(ps, /NoStockToys/);
  assert.match(ps, /\[switch\]\$Private/);
  assert.match(ps, /if \(-not \$Private\) \{\s*\n\s*\$toys = /);
  assert.doesNotMatch(ps, /trackers\\README\.md'\)/, 'code.zip must not carry the developer notebook');
  for (const f of ['TERMS.txt', "'LICENSE'", "'NOTICE'"]) assert.ok(ps.includes(f), f);
  assert.doesNotMatch(read('dev/share/LICENSES-SUMMARY.txt'), /Bad Dragon|taggerine/);
  // an empty library must fall back to a generic toy (the build no longer patches library.js)
  assert.match(read('src/features/machine/library.js'), /LIB\.toys\[0\] \? toyFor\(LIB\.toys\[0\]\.sku, '', custom\) : BUILTIN_TOYS\[0\]/);
});

// public-allow.txt as export-source.ps1 reads it: `*` crosses folders, `!` takes out, the last matching line decides.
// The public tree has no public-allow.txt (paw-x04i): the tests that need it skip there.
const ALLOW = 'dev/share/public-allow.txt';
const rules = existsSync(root + ALLOW) ? lf(read(ALLOW)).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => l.replace(/^\?/, '')).map((l) => ({ neg: l.startsWith('!'), rx: new RegExp('^' + l.replace(/^!/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i') })) : null;
const isPublic = (p) => rules.reduce((keep, r) => (r.rx.test(p) ? !r.neg : keep), false);

test('the CoTracker3 glue module is in no build and not in the public source (paw-uekm)', (t) => {
  if (!rules) return t.skip(`no ${ALLOW} (the public source has none)`);
  assert.match(read('dev/share/build-nas.ps1'), /Remove-Item \(Join-Path \$code 'trackers\\pawtrack\\trackers\\cotracker_points\.py'\) -Force/);
  assert.equal(isPublic('trackers/pawtrack/trackers/cotracker_points.py'), false);
  assert.equal(isPublic('trackers/tests/test_cotracker_glue.py'), false);
  for (const p of ['trackers/pawtrack/trackers/tapnext_points.py', 'trackers/pawtrack/points.py', 'trackers/tests/test_cotracker_optional.py',
    'trackers/tests/test_points_cotracker.py']) assert.equal(isPublic(p), true, p);
});

// paw-jw3o: the private names live nowhere in the files the public source or the shared build carries, so neither has
// to mask anything. The marker list is private (dev/share/privacy-markers.json, the one privacy-gate.ps1 reads); this
// test holds none of it and skips where it is absent (the public tree).
test('no private marker (home path, media names, reference set, owner email ...) in any public or shipped file', (t) => {
  if (!rules || !existsSync(root + 'dev/share/privacy-markers.json')) return t.skip('no dev/share/privacy-markers.json (the public source has no private marker list)');
  let files, email = '';
  try { files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean); } catch { return t.skip('not a git checkout'); }
  try { email = execFileSync('git', ['config', 'user.email'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* none set */ }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markers = JSON.parse(read('dev/share/privacy-markers.json')).markers
    .map((m) => ({ name: m.name, src: m.rx.join('|'), flags: m.flags, allow: m.allow ? new RegExp(m.allow, 'i') : null }));
  if (/^[^@]+@/.test(email)) markers.push({ name: 'owner email', src: `${esc(email)}|\\b${esc(email.split('@')[0])}\\b`, flags: 'i' });
  markers.push({ name: 'machine name (this PC)', src: `\\b${esc(hostname())}\\b`, flags: 'i' });
  // a hit a pending patch removes (dev/patches/*.patch, e.g. Rust the owner applies himself) is noted, not failed
  const pending = new Map();   // "file\0marker" -> lines that patches remove
  for (const p of existsSync(root + 'dev/patches') ? readdirSync(root + 'dev/patches').filter((n) => n.endsWith('.patch')) : []) {
    let file = '';
    for (const l of read('dev/patches/' + p).split(/\r?\n/)) {
      if (l.startsWith('+++ b/')) file = l.slice(6);
      else if (l.startsWith('-') && !l.startsWith('---')) for (const m of markers) {
        const n = (l.match(new RegExp(m.src, 'g' + m.flags)) || []).length;
        if (n) pending.set(`${file}\0${m.name}`, (pending.get(`${file}\0${m.name}`) || 0) + n);
      }
    }
  }
  const hits = [];
  for (const f of files.filter(isPublic)) {
    if (!existsSync(root + f)) continue;   // deleted in the working tree
    const s = readFileSync(root + f, 'latin1');
    for (const m of markers) {
      if ([...f.matchAll(new RegExp(m.src, 'g' + m.flags))].some((x) => !m.allow?.test(x[0]))) hits.push(`${f} (file name): ${m.name}`);
      for (const x of s.matchAll(new RegExp(m.src, 'g' + m.flags))) {
        if (m.allow?.test(x[0])) continue;
        const k = `${f}\0${m.name}`, line = s.slice(0, x.index).split('\n').length;
        if (pending.get(k) > 0) { pending.set(k, pending.get(k) - 1); t.diagnostic(`${f}:${line}: ${m.name} (a pending dev/patches patch removes it)`); }
        else hits.push(`${f}:${line}: ${m.name}`);
      }
    }
  }
  assert.deepEqual(hits, [], 'rewrite these in the source in neutral words (file:line: marker category)');
});

test('format specs are public: CC BY 4.0 and free to implement', () => {
  const idx = read('docs/formats/README.md');
  assert.match(idx, /CC BY 4\.0/);
  assert.match(idx, /Implementing the formats needs no licence/);
  for (const f of ['pawproj', 'pawruns', 'pawpack', 'funscript-metadata']) assert.match(read(`docs/formats/${f}.md`), /CC BY 4\.0/);
});

test('the build guide names the GPUs and driver the locked torch wheels need (paw-pizb)', () => {
  const b = read('docs/BUILDING.md'), py = read('trackers/pyproject.toml');
  assert.match(py, /cu130[^\n]*driver >= 580/);
  assert.match(b, /\| NVIDIA GPU, driver 580\+ \| GTX 16xx \/ RTX 20xx and newer, RTX 50xx included \(CUDA 13\.0 wheels/);
  assert.doesNotMatch(b, /cu126|CUDA 12|driver 560|GTX 9xx|RTX 40xx\)/);
  assert.doesNotMatch(b, /--extra cotracker/);
});
test('the guide documents no CoTracker3 settings or speed as if usable; no Accept key in comments (paw-f7f4)', () => {
  const t = read('docs/guide/tracking.md');
  assert.doesNotMatch(t, /^\| `cotracker_points` \| `(mode|chunk_frames)`/m);
  assert.doesNotMatch(t, /CoTracker3 (online|offline)|CoTracker3 points ·/);
  assert.doesNotMatch(read('src/features/timeline/fx-edit.js'), /Shift\+A/);
});