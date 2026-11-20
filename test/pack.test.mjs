// Pack project (paw-2k9s): the manifest, relative paths, the privacy scan of what is packed, entry-name refusal, and
// File > Pack project end to end against the mock backend (the shell's writer and its hashes: src-tauri/src/pack.rs tests).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildManifest, packNames, relName, scrubPaths, privacyIssues, userOf, safeEntryName, checkPackManifest, unpackDir,
  runsManifestText, fmtBytes, isPackPath } from '../src/app/pack.js';

test('names inside the pack follow the video; a document without one follows the project', () => {
  assert.deepEqual(packNames({ video: 'W:\\Videos\\My Clip.final.mp4', project: 'W:\\Videos\\x.pawproj' }),
    { base: 'My Clip.final.mp4', video: 'My Clip.final.mp4', project: 'My Clip.final.pawproj', runs: 'My Clip.final.pawruns', pack: 'My Clip.final.pawpack' });
  assert.deepEqual(packNames({ project: 'C:/p/show.pawproj' }), { base: 'show.pawproj', video: null, project: 'show.pawproj', runs: 'show.pawruns', pack: 'show.pawpack' });
  assert.ok(isPackPath('C:/a/b.PAWPACK') && !isPackPath('b.pawproj'));
});

test('the manifest: format, version, app, the video facts, the project name; no path, no files (the shell adds them)', () => {
  const names = packNames({ video: 'C:\\Users\\Ann\\Videos\\clip.mp4' });
  const m = buildManifest({ now: new Date('2026-11-18T10:00:00Z'), commit: 'abc123', names, media: { path: 'C:\\Users\\Ann\\Videos\\clip.mp4', durationMs: 61000, fps: 29.97, width: 1920, height: 1080, size: 123456 } });
  assert.equal(m.format, 'pawpack');
  assert.equal(m.version, '1.0');
  assert.equal(m.created, '2026-11-18T10:00:00.000Z');
  assert.equal(m.app.name, 'Pawscript');
  assert.equal(m.app.commit, 'abc123');
  assert.deepEqual(m.video, { name: 'clip.mp4', durationMs: 61000, fps: 29.97, width: 1920, height: 1080, size: 123456 });
  assert.equal(m.project, 'clip.pawproj');
  assert.equal(m.files, undefined);
  assert.deepEqual(privacyIssues(JSON.stringify(m), { user: 'Ann' }), []);
  assert.doesNotThrow(() => checkPackManifest({ ...m, files: [{ name: 'clip.mp4', sha256: 'a'.repeat(64) }] }));
});

test('absolute paths become relative to the project / video folder, else just the file name; unchanged parts stay the same objects', () => {
  const roots = ['C:\\Users\\Ann\\Videos', 'D:/proj'];
  assert.equal(relName('C:\\Users\\Ann\\Videos\\clip.mp4', roots), 'clip.mp4');
  assert.equal(relName('c:/users/ann/videos/sub/clip.roll.funscript', roots), 'sub/clip.roll.funscript');
  assert.equal(relName('E:\\elsewhere\\ref.funscript', roots), 'ref.funscript');
  const keep = { a: [1, 2], b: { c: 'plain text, 12:30, https://example.com/x' } };
  const v = { keep, ghost: { source: { kind: 'reference', path: '\\\\nas\\share\\Ann\\ref.funscript' } }, note: 'loaded C:\\Users\\Ann\\models\\m.pt (512 MB)', f: new Float64Array([1, 2]), m: new Map([['k', 'C:/x']]) };
  const s = scrubPaths(v, roots);
  assert.equal(s.keep, keep);
  assert.equal(s.ghost.source.path, 'ref.funscript');
  assert.equal(s.note, 'loaded m.pt (512 MB)');
  assert.equal(s.f, v.f);
  assert.equal(v.ghost.source.path, '\\\\nas\\share\\Ann\\ref.funscript', 'the input is not changed');
  assert.equal(scrubPaths(keep, roots), keep);
  // skipped keys (a run's frame data) are left alone
  const run = { frames: { p: 'C:/x' }, params: { video: 'D:/proj/clip.mp4' } };
  const r = scrubPaths(run, roots, new Set(['frames']));
  assert.equal(r.frames, run.frames);
  assert.equal(r.params.video, 'clip.mp4');
});

test('the privacy scan: absolute paths and the user folder, not ordinary text', () => {
  assert.equal(userOf('C:\\Users\\Ann\\AppData\\Local\\app.pawscript'), 'Ann');
  assert.equal(userOf('/home/ann/.local/share'), 'ann');
  for (const bad of [JSON.stringify({ p: 'C:\\Users\\Ann\\x.mp4' }), JSON.stringify({ p: 'W:/Videos/x.mp4' }), JSON.stringify({ p: '\\\\nas\\share\\x' })]) assert.notDeepEqual(privacyIssues(bad, { user: 'Ann' }), [], bad);
  assert.deepEqual(privacyIssues('{"x":"see /home/ann/clip"}', { user: 'ann' }), ['the user folder']);
  for (const ok of ['{"creator":"Ann the scripter","t":"12:30","u":"https://x.org/a"}', '{"metadata":{"creator":"AnnTM"}}']) assert.deepEqual(privacyIssues(ok, { user: 'Ann' }), [], ok);
});

test('entry names that leave their folder, name a drive or a device, are refused; a newer major format is refused plainly', () => {
  for (const ok of ['clip.mp4', 'sub/clip.funscript', '夏.pawproj']) assert.ok(safeEntryName(ok), ok);
  for (const bad of ['', '../x', 'a/../../x', '/etc/x', 'C:/x', 'a\\b', 'a//b', './x', 'con.txt', 'COM1', 'x.', 'a?b']) assert.ok(!safeEntryName(bad), bad);
  const ok = { format: 'pawpack', version: '1.3', files: [{ name: 'a.mp4', sha256: 'f'.repeat(64) }] };
  assert.equal(checkPackManifest(ok), ok);
  assert.throws(() => checkPackManifest({ ...ok, version: '2.0' }), /newer Pawscript \(pack format 2\.0\), update Pawscript/);
  assert.throws(() => checkPackManifest({ ...ok, files: [{ name: '../../evil.exe', sha256: 'f'.repeat(64) }] }), /outside its folder/);
  assert.throws(() => checkPackManifest({ ...ok, files: [{ name: 'a.mp4' }] }), /no checksum/);
  assert.throws(() => checkPackManifest({ format: 'zip', version: '1.0' }), /not a Pawscript pack/);
});

test('it unpacks beside the pack, into a folder named after it, never into one that is there', () => {
  const taken = new Set(['C:/a/clip', 'C:/a/clip (2)']);
  assert.equal(unpackDir('C:/a/clip.pawpack', (d) => taken.has(d)), 'C:/a/clip (3)');
  assert.equal(unpackDir('C:\\a\\clip.pawpack'), 'C:\\a\\clip');
  assert.equal(fmtBytes(3.2 * 2 ** 30), '3.2 GB');
  assert.equal(fmtBytes(540 * 2 ** 20), '540 MB');
});

// ---------- File > Pack project against the mock backend ----------
const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, P, PK, T;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  P = await server.ssrLoadModule('/src/app/project.svelte.js');
  PK = await server.ssrLoadModule('/src/app/pack.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
});
after(() => server?.close());

test('Pack project: the video by path, scripts / project / runs with no absolute path and no user folder; the manifest says what is inside', async () => {
  const be = M.mockBackend();
  const doc = M.sampleDoc({ minutes: 1 });
  doc.media = { ...doc.media, path: 'C:/Users/Ann/Videos/sample.mp4' };
  doc.ghosts = [...doc.ghosts, { id: 'ref2', name: 'other', color: '#fff', visible: true, script: [{ at: 0, pos: 0 }, { at: 500, pos: 100 }], source: { kind: 'reference', path: 'E:\\Users\\Ann\\Scripts\\other.funscript' } }];
  const app = M.createMockApp({ backend: be, doc, keys: false });
  app.toast = (msg, kind) => { (app.toasts ??= []).push({ msg, kind }); };
  app.project = P.createProject(app);
  app.doc.project = { path: 'C:/Users/Ann/Videos/sample.pawproj', extra: { notes: { last: 'C:\\Users\\Ann\\Desktop\\todo.txt' } } };
  be.appPaths = async () => ({ data_dir: 'C:\\Users\\Ann\\AppData\\Local\\app.pawscript', cache_dir: 'C:\\Users\\Ann\\AppData\\Local\\app.pawscript\\cache' });
  const t = T.trackingFor(app);
  const pts = { at: Float64Array.from([0, 500, 1000]), pos: Float64Array.from([0, 100, 0]) };
  t.runs = [{ id: 'run1', n: 1, tracker: 'cotracker_points', name: 'run 1', color: '#f00', visible: true, ref: false, params: { cache: 'C:\\Users\\Ann\\pawscript\\trackers\\.cache' },
    range: { start: 0, end: 1000 }, roi: null, samples: null, points: pts, points0: pts, scenes: [], flips: [], channels: {}, channel: 'primary', confidence: null, events: [],
    notes: [{ code: 'info', message: 'checkpoint C:\\Users\\Ann\\pawscript\\trackers\\.cache\\ck.pth loaded' }], frames: null }];
  let call = null;
  be.packWrite = (dest, manifest, entries) => { call = { dest, manifest, entries, runs: entries.find((e) => e.role === 'runs') && be.files.get(entries.find((e) => e.role === 'runs').path) }; return { promise: Promise.resolve({ path: dest, size: 4242 }), cancel() {} }; };
  assert.equal(await PK.packProject(app), true, JSON.stringify(app.toasts));
  assert.equal(call.dest, 'C:/Users/Ann/Videos/sample.pawpack');
  const byRole = (r) => call.entries.filter((e) => e.role === r);
  assert.deepEqual(byRole('video'), [{ name: 'sample.mp4', role: 'video', path: 'C:/Users/Ann/Videos/sample.mp4' }]);
  assert.deepEqual(byRole('script').map((e) => e.name), ['sample.funscript', 'sample.roll.funscript']);
  assert.equal(JSON.parse(byRole('script')[0].text).metadata.pawscript.project, 'sample.pawproj');
  const proj = JSON.parse(byRole('project')[0].text);
  assert.equal(proj.media.path, 'sample.mp4');
  assert.equal(proj.media.relativePath, 'sample.mp4');
  assert.equal(proj.ghosts.find((g) => g.id === 'ref2').source.path, 'other.funscript');
  assert.equal(proj.notes.last, 'todo.txt');
  assert.ok(call.runs, 'the runs are staged for the shell');
  const runsText = PK.runsManifestText(call.runs);
  assert.match(runsText, /checkpoint ck\.pth loaded/);
  for (const text of [JSON.stringify(call.manifest), ...call.entries.filter((e) => e.text).map((e) => e.text), runsText]) {
    assert.deepEqual(PK.privacyIssues(text, { user: 'Ann' }), []);
    assert.ok(!/Ann[\\/]|Users/.test(text), text.slice(0, 200));
  }
  assert.equal(call.manifest.video.name, 'sample.mp4');
  assert.equal(be.files.has(call.entries.find((e) => e.role === 'runs').path), false, 'the staged runs are removed afterwards');
  assert.match(app.toasts.at(-1).msg, /^Packed sample\.pawpack \(4\.1 KB\)/);
  assert.equal(app.project.busy, '');
});

test('Pack project without the shell command: says it needs an app restart / update, writes nothing', async () => {
  const be = M.mockBackend(), app = M.createMockApp({ backend: be, doc: M.sampleDoc({ minutes: 1 }), keys: false });
  const toasts = [];
  app.toast = (msg) => toasts.push(msg);
  app.project = P.createProject(app);
  assert.equal(await PK.packProject(app), false);
  assert.match(toasts[0], /app restart \/ update/);
});
