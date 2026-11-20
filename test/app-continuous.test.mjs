// paw-up1r stage 1 + paw-bztd: the continuous project. Every change reaches the .pawproj without a save, closing / opening
// another asks nothing, checkpoints at milestones (pruned, restorable), the undo stack and where the owner was survive a
// restart, an old project's first write keeps it. project.svelte.js through vite's SSR transform (like app-home.test.mjs);
// project-history.js is pure.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { History } from '../src/app/history.js';
import { pruneCheckpoints, exportHistory, importHistory, contentKey, historyDir } from '../src/app/project-history.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, P, F;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  P = await server.ssrLoadModule('/src/app/project.svelte.js');
  F = await server.ssrLoadModule('/src/lib/finish.js');
});
after(() => server?.close());

const VIDEO = 'C:/clips/gen.mp4', PROJ = 'C:/clips/gen.pawproj', HIST = 'C:/clips/gen.pawhistory';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const projectText = (o = {}) => JSON.stringify({ format: 'pawproj', version: 3, media: { path: VIDEO, name: 'gen.mp4', durationMs: 60000, fps: 30 }, axes: { stroke: [[1000, 0], [1500, 100], [2000, 0]] }, ...o }, null, 2);
/** A fresh app (a new start of the program) on the disk `be` and the localStorage `storage`; dialogs counted. */
function start(be, storage) {
  const app = M.createMockApp({ backend: be, storage, doc: {}, keys: false });
  const toasts = [];
  app.toast = (msg, kind = 'info', opts = {}) => { toasts.push({ msg, kind, opts }); };
  let asked = 0;
  app.choose = async () => { asked++; return null; };
  app.confirm = async () => { asked++; return false; };
  app.project = P.createProject(app);
  return { app, project: app.project, toasts, asked: () => asked };
}
const add = (app, at, pos = 50) => app.edit('Add point', 'stroke', [...(app.doc.axes.stroke || []), { at, pos }].sort((a, b) => a.at - b.at));
const disk = (be, p = PROJ) => JSON.parse(be.files.get(p));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('an edit reaches the .pawproj within about a second, with no save call', async () => {
  const be = M.mockBackend();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  const { app, project } = start(be, memStorage());
  assert.equal(await project.openProject(PROJ), true);
  project.startAutosave();
  try {
    add(app, 3000);
    assert.equal(app.doc.dirty, true);
    await wait(1300);
    assert.deepEqual(disk(be).axes.stroke.map((x) => x[0]), [1000, 1500, 2000, 3000]);
    assert.equal(app.doc.dirty, false);
  } finally { project.stopAutosave(); }
});

test('kill and reopen: a new app on the same files gets the document, the undo stack and where the owner was', async () => {
  const be = M.mockBackend(), storage = memStorage();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText({ chapters: [] }));
  const a = start(be, storage);
  await a.project.openProject(PROJ);
  add(a.app, 3000);
  add(a.app, 4000);
  a.app.transact('Bookmark', () => { a.app.doc.bookmarks = [{ id: 'b1', at: 2500, note: 'here' }]; });
  assert.equal(await a.project.flush(), true);
  // where the owner is: playhead, view, tab, axis, points, range, loop, speed
  a.app.player.seek(2345);
  a.app.setView({ start: 1000, span: 4000 });
  a.app.setMode('refine');
  a.app.select([1500, 2000]);
  a.app.doc.range = { t0: 1200, t1: 2200 };
  a.app.player.setLoop({ t0: 1000, t1: 3000 });
  a.app.player.setRate(0.5);
  await a.project.close({ quit: true });   // the app quits (no load: the window goes)

  const b = start(be, storage);
  assert.equal(await b.project.reopenLast(), true, 'the last document opens at start');
  await wait(10);
  const d = b.app.doc;
  assert.deepEqual(d.axes.stroke.map((x) => x.at), [1000, 1500, 2000, 3000, 4000]);
  assert.equal(d.dirty, false);
  assert.equal(Math.round(b.app.player.timeMs), 2345);
  assert.deepEqual({ ...b.app.view }, { start: 1000, span: 4000 });
  assert.equal(b.app.mode, 'refine');
  assert.deepEqual([...d.selection.ats].sort(), [1500, 2000]);
  assert.deepEqual(d.range, { t0: 1200, t1: 2200 });
  assert.deepEqual(b.app.player.loop, { t0: 1000, t1: 3000 });
  assert.equal(b.app.player.rate, 0.5);
  // the undo stack came back: undo, undo, undo walks the edits back in order
  assert.deepEqual(b.app.history.entries.map((e) => e.label), ['Add point', 'Add point', 'Bookmark']);
  assert.equal(b.app.undo().label, 'Bookmark');
  assert.deepEqual(d.bookmarks, []);
  b.app.undo();
  assert.deepEqual(b.app.doc.axes.stroke.map((x) => x.at), [1000, 1500, 2000, 3000]);
  b.app.undo();
  assert.deepEqual(b.app.doc.axes.stroke.map((x) => x.at), [1000, 1500, 2000]);
  assert.equal(b.app.history.canUndo, false);
  b.app.redo();
  assert.deepEqual(b.app.doc.axes.stroke.map((x) => x.at), [1000, 1500, 2000, 3000]);
  assert.equal(b.asked(), 0);
});

// paw-zrru: the file is written with the state at the write's start. An undo / redo landing while it is in flight that goes
// back to the position saved before made the document look written (history dirty = top entry != saved entry), so nothing
// wrote it again and a quit kept the older file (tabs-multi-check, 1 run in 8 under load).
test('paw-zrru: an undo or redo while the project is being written still reaches the file; a quit keeps it', async () => {
  // killed: the file right after that write, opened by a new app with no quit (the undo stack must be that file's own)
  for (const [name, setup, during, want, killed] of [
    ['redo', (app) => app.undo(), (app) => app.redo(), [1000, 1500, 2000, 3000], { ats: [1000, 1500, 2000], undo: 0 }],
    ['undo', (app) => add(app, 4000), (app) => app.undo(), [1000, 1500, 2000, 3000], { ats: [1000, 1500, 2000, 3000, 4000], undo: 2 }],
  ]) {
    const be = M.mockBackend(), storage = memStorage();
    be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
    const a = start(be, storage);
    await a.project.openProject(PROJ);
    add(a.app, 3000);
    assert.equal(await a.project.flush(), true);   // the saved position: 4 points
    setup(a.app);
    assert.equal(a.app.doc.dirty, true);
    const real = be.writeWithBackup.bind(be);
    let hit = 0;
    be.writeWithBackup = async (p, text, o) => { if (p === PROJ && !hit++) during(a.app); return real(p, text, o); };
    await a.project.flush();
    be.writeWithBackup = real;
    assert.equal(hit, 1);
    assert.equal(a.app.doc.dirty, true, `${name}: the ${name} made during the write is not on disk yet`);
    const be2 = M.mockBackend();
    for (const [k, v] of be.files) be2.files.set(k, v);
    const k = start(be2, memStorage());
    await k.project.openProject(PROJ);
    assert.deepEqual(ats(k.app), killed.ats, `${name}: killed then, the file has the state the write started with`);
    assert.equal(k.app.history.entries.length, killed.undo, `${name}: and that state's undo stack`);
    if (killed.undo) { k.app.undo(); assert.deepEqual(ats(k.app), want); }
    assert.equal(await a.project.close({ quit: true }), true);
    assert.deepEqual(disk(be).axes.stroke.map((x) => x[0]), want, `${name}: the file has the state at quit`);
    const b = start(be, storage);
    assert.equal(await b.project.reopenLast(), true);
    assert.deepEqual(ats(b.app), want, `${name}: it reopens as it was at quit`);
    assert.equal(b.app.doc.dirty, false);
  }
});

// paw-zrru (seen beside it in tabs-multi-check: a parked tab came back at 0 ms, whole view): the 1 s tick landing while a project
// opens (between its load and its resume: the history and lock reads) stored the just-loaded state over where the owner was
test('paw-zrru: the write tick during an open does not replace where the owner was', async () => {
  const be = M.mockBackend(), storage = memStorage();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  const a = start(be, storage);
  await a.project.openProject(PROJ);
  a.app.player.seek(2345);
  a.app.setView({ start: 1000, span: 4000 });
  await a.project.close({ quit: true });
  const b = start(be, storage), read = be.readText.bind(be);
  be.readText = async (p) => { if (String(p).startsWith(HIST)) await wait(1300); return read(p); };   // a slow disk: the tick lands mid-open
  b.project.startAutosave();
  try {
    assert.equal(await b.project.openProject(PROJ), true);
    await wait(10);
    assert.equal(Math.round(b.app.player.timeMs), 2345);
    assert.deepEqual({ ...b.app.view }, { start: 1000, span: 4000 });
  } finally { b.project.stopAutosave(); be.readText = read; }
});

// paw-abi2 (2): app.load shows the document's tab; where the owner was came back only after the history and lock reads, so on
// a slow disk a reopened tab showed the whole view / another mode until those were done
test('paw-abi2: a reopened document shows where the owner was from its load on, not after its history and lock reads', async () => {
  const be = M.mockBackend(), storage = memStorage();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  const a = start(be, storage);
  await a.project.openProject(PROJ);
  a.app.setView({ start: 1000, span: 4000 });
  a.app.setMode('refine');
  await a.project.close({ quit: true });
  const b = start(be, storage), read = be.readText.bind(be), seen = [];
  be.readText = async (p) => { if (String(p).startsWith(HIST) && b.app.doc.media) seen.push({ view: { ...b.app.view }, mode: b.app.mode }); return read(p); };
  try { assert.equal(await b.project.openProject(PROJ), true); } finally { be.readText = read; }
  assert.ok(seen.length, 'the history was read after the load');
  assert.deepEqual(seen[0], { view: { start: 1000, span: 4000 }, mode: 'refine' });
});

// paw-abi2: the .pawproj and its .pawruns are two files written one after the other. Killed between the two writes, the
// project used to name a run that had just landed while the runs file did not have it yet: it reopened rebuilt from its
// ghost, frames gone for good. Killed at any moment of the write, the pair must open as one state (a run whole, or not there).
test('paw-abi2: killed at any moment of a write after a run lands or is discarded, the project and its runs file open as one state', async () => {
  const T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js'), R = await server.ssrLoadModule('/src/lib/runs.js');
  const gridRun = (n) => {
    const frames = R.newFrames();
    R.appendFrames(frames, Array.from({ length: 30 }, (_, i) => ({ t_ms: i * 33, value: i / 30, overlay: { points: [[0.5, 0.5]], boxes: [], pts: [[0.5, 0.5, 1, 2]] } })));
    return R.makeRun({ n, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: {}, range: { start: 0, end: 1000 }, roi: { kind: 'box', x: 0, y: 0, w: 1, h: 1 }, frames, runs: [],
      result: { samples: [[0, 0.1], [33, 0.2]], points: [{ at: 0, pos: 10 }, { at: 500, pos: 90 }] } });
  };
  const copy = (files) => new Map([...files].map(([k, v]) => [k, v instanceof Uint8Array ? v.slice() : v]));
  // discard-mid: an edit is written and the run is discarded while the .pawproj (naming it) is being written
  for (const cow of [false, true]) for (const step of ['land', 'discard', 'discard-mid']) {
    const be = M.mockBackend({ cow });
    be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
    const a = start(be, memStorage()), tr = T.trackingFor(a.app);
    assert.equal(await a.project.openProject(PROJ), true);
    await tr.runsLoad;
    const land = () => { const r = gridRun(7); tr.runs = [...tr.runs, r]; a.app.doc.ghosts = [...a.app.doc.ghosts, tr.ghostOf(r)]; tr.runsDirty = true; a.app.history.markDirty(); };
    if (step !== 'land') { land(); assert.equal(await a.project.flush(), true); }
    // a kill just before any write call: the files as they are at that moment
    const snaps = [], real = {};
    for (const m of ['writeText', 'writeBytes', 'writeWithBackup', 'runsAppend', 'runsStageCommit']) if (be[m]) { real[m] = be[m]; be[m] = async (...x) => { snaps.push([m, copy(be.files)]); return real[m].apply(be, x); }; }
    const discard = () => { tr.remove('run7'); a.app.history.markDirty(); };   // (the ghosts watch marks it dirty in the app; no effects under SSR)
    if (step === 'discard-mid') { const w = be.writeWithBackup; be.writeWithBackup = async (p, ...x) => { if (p === PROJ) discard(); return w.call(be, p, ...x); }; }
    if (step === 'land') land(); else if (step === 'discard') discard(); else add(a.app, 3000);
    assert.equal(await a.project.flush(), true);
    Object.assign(be, real);
    snaps.push(['end', copy(be.files)]);
    for (const [i, [m, files]] of snaps.entries()) {
      const be2 = M.mockBackend({ cow });
      for (const [k, v] of files) be2.files.set(k, v);
      const k = start(be2, memStorage()), tk = T.trackingFor(k.app);
      assert.equal(await k.project.openProject(PROJ), true);
      await tk.runsLoad;
      const g = k.app.doc.ghosts.some((x) => x.id === 'run7'), r = tk.run('run7');
      assert.ok(g ? r && !r.restored && r.frames?.t?.length === 30 : !r,
        `${cow ? 'cow' : 'plain'} ${step}, killed before ${m} (#${i}): ghost ${g}, run ${r ? (r.restored ? 'rebuilt from its ghost, no frames' : 'whole') : 'none'}`);
      if (m === 'end') assert.equal(g, step !== 'discard', 'not killed: the state the last write started with');
    }
  }
});

test('paw-a82t: a start-up reopen that never came back (it crashed the renderer) is not repeated: a quiet note names it, Open anyway opens it', async () => {
  const be = M.mockBackend(), storage = memStorage();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  const a = start(be, storage);
  await a.project.openProject(PROJ);
  await a.project.close({ quit: true });
  const b = start(be, storage);   // the next start reopens it, and dies before it stood a few seconds: its mark stays
  assert.equal(await b.project.reopenLast(), true);
  assert.match(storage.getItem('pawscript.opening') || '', /gen\.pawproj/);
  const c = start(be, storage);   // the start after: the project page, not the document
  assert.equal(await c.project.reopenLast(), false);
  assert.equal(c.project.hasDoc, false);
  const note = c.toasts.find((t) => t.opts.action?.label === 'Open anyway');
  assert.ok(note && note.kind === 'quiet' && /gen\.pawproj/.test(note.msg), JSON.stringify(c.toasts));
  assert.equal(c.asked(), 0);
  assert.equal(await note.opts.action.run(), true);
  assert.equal(c.project.hasDoc, true);
});

test('paw-a82t: openGuarded keeps the mark until the document has stood stableMs; a failed open leaves none', async () => {
  const G = await server.ssrLoadModule('/src/app/open-guard.js'), st = memStorage();
  assert.equal(await G.openGuarded(st, 'C:\\v\\A.pawproj', async () => true, { stableMs: 30 }), true);
  assert.equal(G.wasOpening(st, 'c:/v/a.pawproj'), true);
  await wait(60);
  assert.equal(G.wasOpening(st, 'C:\\v\\A.pawproj'), false);
  assert.equal(await G.openGuarded(st, 'C:/v/B.pawproj', async () => false), false);
  assert.equal(G.wasOpening(st, 'C:/v/B.pawproj'), false);
  st.setItem('pawscript.opening', '{not json');   // a damaged mark never stops a start
  assert.equal(G.wasOpening(st, 'C:/v/B.pawproj'), false);
});

test('undo history from another state of the file is not loaded (the project changed after it was written)', async () => {
  const be = M.mockBackend(), storage = memStorage();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  const a = start(be, storage);
  await a.project.openProject(PROJ);
  add(a.app, 3000);
  await a.project.flush();
  be.files.set(PROJ, be.files.get(PROJ).replace('"savedAt"', '"other": 1, "savedAt"'));   // edited by something else
  const b = start(be, storage);
  await b.project.openProject(PROJ);
  assert.equal(b.app.history.canUndo, false);
});

test('paw-0tas: undo history written by another build is not loaded (a field may have another shape now); this build\'s is', async () => {
  const be = M.mockBackend(), storage = memStorage();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  const a = start(be, storage);
  await a.project.openProject(PROJ);
  add(a.app, 3000);
  await a.project.flush();
  const u = [...be.files.keys()].find((k) => k.endsWith('undo.json')), mine = be.files.get(u);
  assert.match(mine, /"build":"[^"]+"/, 'undo.json names the build that wrote it');
  await a.project.close({ quit: true });   // paw-vm6e: one window at a time writes a project (its lock goes with it)
  const b = start(be, storage);
  await b.project.openProject(PROJ);
  assert.equal(b.app.history.canUndo, true, 'the same build: the stack comes back');
  await b.project.close({ quit: true });
  be.files.set(u, mine.replace(/"build":"[^"]*"/, '"build":"0.0.1+an0ther"'));
  const c = start(be, storage);
  await c.project.openProject(PROJ);
  assert.equal(c.app.history.canUndo, false, 'another build: an empty stack, nothing said');
  assert.equal(c.toasts.length + c.asked(), 0);
});

test('opening another document, closing, opening the video again: no question, the work is on disk, the video goes back into its project', async () => {
  const be = M.mockBackend(), storage = memStorage(), OTHER = 'C:/clips/other.mp4';
  be.files.set(VIDEO, 'v'); be.files.set(OTHER, 'w');
  const { app, project, asked, toasts } = start(be, storage);
  assert.equal(await project.openVideo(VIDEO), true);
  assert.equal(project.path, null);
  add(app, 1000);
  assert.equal(await project.openVideo(OTHER), true);   // switches; gen.mp4's work is written beside it on the way out
  assert.deepEqual(disk(be).axes.stroke, [[1000, 50]]);
  assert.ok(toasts.some((t) => t.kind === 'quiet' && t.msg === 'Kept as gen.pawproj beside the video' && t.opts.tip === PROJ), 'where it went, said once, quietly; the full path in its tooltip (paw-p8o2)');
  assert.ok(!toasts.some((t) => t.msg.includes(PROJ)), 'paw-vhcd: never the full path');
  add(app, 2000);
  assert.equal(await project.close(), true);
  assert.deepEqual(disk(be, 'C:/clips/other.pawproj').axes.stroke, [[2000, 50]]);
  assert.equal(app.tabs.list.length, 0);
  assert.equal(await project.openPaths([VIDEO]), true);
  assert.equal(project.path, PROJ, 'the video opened its own project');
  assert.deepEqual(app.doc.axes.stroke.map((x) => x.at), [1000]);
  assert.equal(asked(), 0);
  assert.equal(app.dialog, null);
});

test('paw-o2ij: the continuous write stores the video fingerprint (no Ctrl+S); the video moved into a subfolder is found again and its new place written', async () => {
  const be = M.mockBackend(), MOVED = 'C:/clips/sub/gen.mp4';
  be.files.set(VIDEO, 'video bytes');
  const { app, project, toasts } = start(be, memStorage());
  assert.equal(await project.openVideo(VIDEO), true);
  add(app, 1000);
  assert.equal(await project.flush(), true);
  const fp = (await be.fileFingerprint(VIDEO)).fingerprint;
  assert.deepEqual([disk(be).media.size, disk(be).media.hash], [11, { algo: 'q1', value: fp }]);
  assert.equal(await project.close(), true);
  be.files.set(MOVED, be.files.get(VIDEO)); be.files.delete(VIDEO);
  assert.equal(await project.openRecent(PROJ), true);
  assert.equal(app.doc.media.path, MOVED);
  assert.ok(toasts.some((t) => t.msg.includes('same file, moved')));
  assert.equal(await project.flush(), true);
  assert.equal(disk(be).media.path, MOVED, 'the new place is written');
});

test('paw-tjy6: a video file that is there but ffprobe cannot read opens nothing: one plain error, no card, the open document stays', async () => {
  const be = M.mockBackend(), JUNK = 'C:/clips/junk.mp4', ZERO = 'C:/clips/zero.mp4';
  be.files.set(VIDEO, 'v'); be.files.set(JUNK, 'random bytes'); be.files.set(ZERO, '');
  const probe = be.mediaProbe;
  be.mediaProbe = async (p) => { if (p === VIDEO) return probe(p); throw Object.assign(new Error('ffprobe failed: Invalid data found when processing input'), { code: 'ffmpeg_failed' }); };
  const { app, project, toasts } = start(be, memStorage());
  assert.equal(await project.openVideo(VIDEO), true);
  for (const [p, said] of [[JUNK, "junk.mp4 can't be read as a video"], [ZERO, "zero.mp4 can't be read as a video (empty file)"]]) {
    assert.equal(await project.openPaths([p]), false);
    assert.deepEqual(toasts.at(-1), { msg: said, kind: 'error', opts: {} });
    assert.equal(app.doc.media.path, VIDEO, 'the open document stays');
    assert.ok(!project.recent.some((e) => e.path === p), 'no project card');
  }
});

test('a document whose folder cannot be written goes to the app data projects folder', async () => {
  const be = M.mockBackend();
  be.files.set(VIDEO, 'v');
  be.appPaths = async () => ({ data_dir: 'C:/appdata' });
  const write = be.writeWithBackup.bind(be);
  be.writeWithBackup = async (p, ...x) => { if (p.startsWith('C:/clips/')) { const e = new Error('protected'); e.code = 'protected'; throw e; } return write(p, ...x); };
  const { app, project } = start(be, memStorage());
  await project.openVideo(VIDEO);
  add(app, 1000);
  assert.equal(await project.flush(), true);
  assert.match(project.path, /^C:\/appdata\/projects\/gen-[\w-]+\.pawproj$/);
  assert.deepEqual(disk(be, project.path).axes.stroke, [[1000, 50]]);
  assert.equal(app.doc.dirty, false);
});

test('checkpoints: after a track lands, before a run is discarded, on close; restorable, the state left becomes one', async () => {
  const be = M.mockBackend(), storage = memStorage();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  const { app, project } = start(be, storage);
  await project.openProject(PROJ);
  add(app, 3000);
  await project.flush();
  const labels = () => project.checkpoints.map((c) => c.label);
  assert.deepEqual(labels(), ['As opened'], 'the file as it was opened, kept for good');
  assert.equal(project.checkpoints[0].keep, true);
  const run = { id: 'run1', name: 'run 1', color: '#f0f', script: [{ at: 0, pos: 0 }, { at: 400, pos: 100 }], visible: true, source: { kind: 'tracker', runId: 'run1' } };
  app.doc.ghosts = [...app.doc.ghosts, run];
  app.history.markDirty();   // the app's watcher does this for a change that is not an undo step (and tracking on a run landing)
  await project.flush();
  assert.equal(labels()[0], 'After a track');
  add(app, 3500);   // worked on after the track (the same state twice makes one checkpoint)
  await project.flush();
  app.doc.ghosts = app.doc.ghosts.filter((g) => g.id !== 'run1');
  app.history.markDirty();
  await project.flush();
  assert.equal(labels()[0], 'Before a run was discarded');
  assert.ok(JSON.parse(be.files.get(`${HIST}/${project.checkpoints[0].id}.pawproj`)).ghosts.some((g) => g.id === 'run1'), 'it holds the run');
  // back to it: the run is back, the state left is a checkpoint, no question
  const id = project.checkpoints[0].id;
  assert.equal(await project.restoreCheckpoint(id), true);
  assert.ok(app.doc.ghosts.some((g) => g.id === 'run1'));
  assert.match(labels()[0], /^Before going back to/);
  await project.flush();
  assert.ok(disk(be).ghosts.some((g) => g.id === 'run1'), 'and it is written');
  await project.close();
  const idx = JSON.parse(be.files.get(`${HIST}/index.json`)).checkpoints;
  assert.equal(idx.at(-1).label, 'On close');
  for (const c of idx) assert.ok(be.files.has(`${HIST}/${c.id}.pawproj`), c.label);
});

test('an old project (version 2, no history) opens, plays the same after its first write, and that write keeps it', async () => {
  const be = M.mockBackend(), storage = memStorage();
  const old = JSON.stringify({ format: 'pawproj', version: 2, savedAt: '2026-01-01T00:00:00.000Z', media: { path: VIDEO, name: 'gen.mp4', durationMs: 60000, fps: 30 },
    axes: { stroke: [[0, 0], [400, 100], [800, 10], [1300, 90]], roll: [[0, 50], [600, 20]] }, bookmarks: [{ id: 'b', at: 400, note: 'x' }], view: { start: 200, span: 3000 }, playheadMs: 650 }, null, 2);
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, old);
  const a = start(be, storage);
  await a.project.openProject(PROJ);
  assert.deepEqual({ ...a.app.view }, { start: 200, span: 3000 }, 'its saved view (no resume entry yet)');
  assert.equal(Math.round(a.app.player.timeMs), 650);
  const final = (app) => JSON.stringify(F.finalAxes(app));
  const before = final(a.app);
  a.app.transact('Bookmark', () => { a.app.doc.bookmarks = [...a.app.doc.bookmarks, { id: 'c', at: 900, note: '' }]; });
  assert.equal(await a.project.flush(), true);
  const b = start(be, memStorage());
  await b.project.openProject(PROJ);
  assert.equal(final(b.app), before, 'plays identically');
  // the file as it was: a checkpoint kept for good, byte for byte, and the write's own .bak
  const idx = JSON.parse(be.files.get(`${HIST}/index.json`)).checkpoints;
  assert.equal(idx.length, 1);
  assert.equal(idx[0].keep, true);
  assert.equal(be.files.get(`${HIST}/${idx[0].id}.pawproj`), old);
  assert.equal(be.files.get(PROJ + '.bak'), old);
});

// ---------- pure ----------
test('pruneCheckpoints keeps the newest 20 automatic ones, then one per day; kept and manual ones always', () => {
  const day = 86400000, t0 = Date.UTC(2026, 10, 1, 12);
  const list = [];
  for (let d = 0; d < 5; d++) for (let k = 0; k < 10; k++) list.push({ id: `${d}-${k}`, at: t0 + d * day + k * 60000, auto: true });
  list.push({ id: 'old', at: t0 - 30 * day, auto: true, keep: true }, { id: 'mine', at: t0 - 20 * day, auto: false });
  const { keep, drop } = pruneCheckpoints(list);
  assert.equal(keep.length, 20 + 3 + 2);   // days 4, 3 fill the 20; days 2, 1, 0 keep their newest; + kept + manual
  assert.ok(keep.some((c) => c.id === 'old') && keep.some((c) => c.id === 'mine'));
  assert.deepEqual(keep.filter((c) => /^[012]-/.test(c.id)).map((c) => c.id), ['2-9', '1-9', '0-9']);
  assert.equal(drop.length, list.length - keep.length);
  assert.equal(contentKey('{\n  "savedAt": "a",\n  "x": 1\n}'), contentKey('{\n  "savedAt": "b",\n  "x": 1\n}'));
  assert.notEqual(contentKey('{"x": 1}'), contentKey('{"x": 2}'));
  assert.equal(historyDir('C:\\v\\clip.pawproj'), 'C:\\v\\clip.pawhistory');
});

function store(init) {
  const doc = { ...init };
  const h = new History({ read: () => ({ ...doc }), write: (p, v) => { if (v === undefined) delete doc[p]; else doc[p] = v; }, readSel: () => null, writeSel: () => {} });
  return { doc, h };
}
test('exportHistory / importHistory: a long script edit is stored as its slice, the stack comes back exactly, a mismatch stops it', () => {
  const pts = Array.from({ length: 50000 }, (_, i) => ({ at: i * 10, pos: i % 100 }));
  const { doc, h } = store({ 'axes.stroke': pts, plan: [] });
  h.transact('nudge', () => { const s = doc['axes.stroke'].slice(); s[100] = { at: 1000, pos: 7 }; doc['axes.stroke'] = s; });
  h.transact('roll', () => { doc['axes.roll'] = [{ at: 0, pos: 1 }]; });
  h.transact('plan', () => { doc.plan = [{ id: 'p', t0: 0, t1: 5 }]; });
  doc.plan = [{ id: 'p', t0: 0, t1: 9 }];   // changed outside the history after the last entry
  const { json, kept } = exportHistory(h, { ...doc });
  assert.equal(kept, 3);
  assert.ok(json.length < 2000, `small: ${json.length} chars`);
  const r = store(JSON.parse(JSON.stringify(doc)));
  assert.equal(importHistory(r.h, JSON.parse(json), { ...r.doc }), 3);
  assert.equal(r.h.dirty, false);
  r.h.undo();
  assert.deepEqual(r.doc.plan, []);
  r.h.undo();
  assert.equal('axes.roll' in r.doc, false, 'an axis that did not exist is gone again');
  r.h.undo();
  assert.deepEqual(r.doc['axes.stroke'][100], { at: 1000, pos: 100 % 100 });
  assert.equal(r.doc['axes.stroke'].length, 50000);
  r.h.redo(); r.h.redo(); r.h.redo();
  assert.deepEqual(r.doc.plan, [{ id: 'p', t0: 0, t1: 5 }], 'redo puts back what the entry recorded');
  // the document the file belongs to has another length: nothing older than the mismatch is loaded
  const s = store({ 'axes.stroke': pts.slice(0, 10), plan: doc.plan, 'axes.roll': doc['axes.roll'] });
  assert.equal(importHistory(s.h, JSON.parse(json), { ...s.doc }), 2);
  // a budget keeps the newest entries
  assert.equal(exportHistory(h, { ...doc }, { budget: 3 }).kept, 2);
});

// ---------- the funscripts beside it (paw-kdck: no dialog at open, ever) ----------
const FUN = 'C:/clips/gen.funscript';
const funText = (pts) => JSON.stringify({ version: '1.0', inverted: false, range: 100, actions: pts.map(([at, pos]) => ({ at, pos })) });
const ats = (app) => app.doc.axes.stroke.map((p) => p.at);

test('a video with a script beside it and no project: the script loads, no question; a variant beside it is offered as a ghost', async () => {
  const be = M.mockBackend();
  be.files.set(VIDEO, 'v'); be.files.set(FUN, funText([[100, 0], [600, 100]])); be.files.set('C:/clips/gen (1).funscript', funText([[100, 10], [700, 90]]));
  const { app, project, asked, toasts } = start(be, memStorage());
  assert.equal(await project.openPaths([VIDEO]), true);
  assert.equal(asked(), 0);
  assert.deepEqual(ats(app), [100, 600]);
  const t = toasts.find((x) => /^Loaded gen\.funscript from beside the video/.test(x.msg));
  assert.ok(t && /1 other script/.test(t.msg), JSON.stringify(toasts));
});

test('reopened after edits that were not Ctrl+S\'d: no dialog, no ghost, nothing said; an outside edit: a ghost and one toast, "Load the file" is one undo step', async () => {
  const be = M.mockBackend(), storage = memStorage();
  be.files.set(VIDEO, 'v'); be.files.set(FUN, funText([[100, 0], [600, 100]]));
  const a = start(be, storage);
  await a.project.openPaths([VIDEO]);
  add(a.app, 1000);
  assert.equal(await a.project.save(), true);   // Ctrl+S: the funscript is ours now
  add(a.app, 2000);
  await a.project.close();                      // the project runs ahead of its funscript
  const b = start(be, storage);
  assert.equal(await b.project.openPaths([VIDEO]), true);
  assert.equal(b.asked(), 0, 'no dialog');
  assert.deepEqual(ats(b.app), [100, 600, 1000, 2000], 'the project is the truth');
  assert.equal(b.app.doc.ghosts.filter((g) => /^disk/.test(g.id)).length, 0, 'no ghost');
  assert.equal(b.toasts.filter((x) => /changed outside/.test(x.msg)).length, 0, 'nothing said');
  await b.project.close();

  be.files.set(FUN, funText([[100, 0], [400, 100], [800, 0]]));   // edited in another tool
  const c = start(be, storage);
  assert.equal(await c.project.openPaths([VIDEO]), true);
  assert.equal(c.asked(), 0, 'no dialog');
  assert.deepEqual(ats(c.app), [100, 600, 1000, 2000], 'the project stays');
  const g = c.app.doc.ghosts.find((x) => /^disk/.test(x.id));
  assert.deepEqual(g?.script.map((p) => p.at), [100, 400, 800], 'the file as a ghost');
  const t = c.toasts.find((x) => /gen\.funscript changed outside Pawscript/.test(x.msg));
  assert.ok(t, JSON.stringify(c.toasts));
  // the toast's action: the file becomes the script, one undo step, a checkpoint first
  assert.equal(t.opts.action?.label, 'Load the file');
  const steps = c.app.history.entries.length;
  await t.opts.action.run();
  assert.deepEqual(ats(c.app), [100, 400, 800]);
  assert.equal(c.app.history.entries.length, steps + 1, 'one undo step');
  assert.match(c.project.checkpoints[0].label, /^Before loading gen\.funscript/);
  assert.equal(c.app.doc.ghosts.filter((x) => /^disk/.test(x.id)).length, 0, 'the ghost goes');
  c.app.undo();
  assert.deepEqual(ats(c.app), [100, 600, 1000, 2000]);
  c.app.redo();
  await c.project.close();
  // loaded: the file is known again, the next open says nothing
  const e = start(be, storage);
  await e.project.openPaths([VIDEO]);
  assert.equal(e.toasts.filter((x) => /changed outside/.test(x.msg)).length, 0);
  assert.equal(e.asked(), 0);
});

test('an older project with no record of its funscript: the file on disk is taken as known on first open (no ghost, no toast), and recorded', async () => {
  const be = M.mockBackend(), storage = memStorage();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText()); be.files.set(FUN, funText([[100, 0], [600, 100]]));   // differs from the project
  const { app, project, asked, toasts } = start(be, storage);
  assert.equal(await project.openProject(PROJ), true);
  assert.equal(asked(), 0);
  assert.deepEqual(ats(app), [1000, 1500, 2000]);
  assert.equal(app.doc.ghosts.filter((g) => /^disk/.test(g.id)).length, 0);
  assert.equal(toasts.filter((x) => /changed outside/.test(x.msg)).length, 0);
  add(app, 3000);
  await project.flush();
  assert.deepEqual(disk(be).scriptFiles?.files.map((f) => f.path), [FUN]);
});
test('exportHistory is bounded in bytes: heavy entries (scenes with painted masks) never make a huge undo.json', () => {
  const scene = (k) => ({ start_ms: 0, end_ms: 1000, groups: [{ name: 'g' + k, mask: 'm'.repeat(1_500_000) }] });
  const { doc, h } = store({ scenes: [scene(0)] });
  for (let k = 1; k <= 12; k++) h.transact('Groups: paint', () => { doc.scenes = [scene(k)]; });
  const all = exportHistory(h, { ...doc }, { bytes: Infinity });
  assert.equal(all.kept, 12);
  assert.ok(all.json.length > 15_000_000, 'unbounded it is large');
  const { json, kept } = exportHistory(h, { ...doc });
  assert.ok(json.length <= 4_000_000, `bounded: ${json.length}`);
  assert.ok(kept >= 1 && kept < 12, `the newest that fit are kept: ${kept}`);
  const big = store({ scenes: [{ mask: 'm'.repeat(6_000_000) }] });
  big.h.transact('one huge', () => { big.doc.scenes = [{ mask: 'n'.repeat(6_000_000) }]; });
  assert.equal(exportHistory(big.h, { ...big.doc }).kept, 0, 'an entry over the bound alone is not kept');
});
