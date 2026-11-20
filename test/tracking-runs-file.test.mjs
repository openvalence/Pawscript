// Tracker runs persist beside the project (<stem>.pawruns): the tracking store's save hook, the read on open, removal
// as the only way out, unreadable / foreign files copied aside, a new run marking the document dirty.
// The store is a .svelte.js module: loaded through vite's SSR transform (no server, no browser).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeRun, newFrames, appendFrames } from '../src/lib/runs.js';
import { decodeRuns } from '../src/lib/runs-file.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const PROJ = 'C:/videos/sample.pawproj', RUNS = 'C:/videos/sample.pawruns';
let server, M, T;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
});
after(() => server?.close());

/** An app with the tracking store (blocks registered, as at boot), the sample doc saved as PROJ, then loaded. */
function open(be, ghosts) {
  const doc = { ...M.sampleDoc(), project: { path: PROJ } };
  if (ghosts) doc.ghosts = ghosts(doc.ghosts);
  const app = M.createMockApp({ backend: be, doc, keys: false }), tr = T.trackingFor(app);
  app.loadBlocks({});
  return { app, tr };
}
function gridRun(n) {
  const frames = newFrames();
  appendFrames(frames, Array.from({ length: 30 }, (_, i) => ({ t_ms: i * 33, value: i / 30, overlay: { points: [[0.5, 0.5]], boxes: [], pts: [[0.5, 0.5, 1, 2], [0.25, 0.75, 0, -1]] } })));
  return makeRun({ n, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: {}, range: { start: 0, end: 1000 }, roi: { kind: 'box', x: 0, y: 0, w: 1, h: 1 }, frames, runs: [],
    result: { samples: [[0, 0.1], [33, 0.2]], points: [{ at: 0, pos: 10 }, { at: 500, pos: 90 }], channels: { g2_proj: [[0, 0.3], [33, 0.6]] } } });
}

test('save writes every run to <stem>.pawruns; open loads them as real runs (frames, runsInfo), ghosts come back; remove is the only way out', async () => {
  const be = M.mockBackend();
  const a = open(be);
  await a.tr.runsLoad;
  const run = gridRun(7);
  a.tr.runs = [...a.tr.runs, run];
  a.app.doc.ghosts = [...a.app.doc.ghosts, a.tr.ghostOf(run)];
  assert.deepEqual(await a.app.blocksSaved(PROJ), []);
  assert.ok(be.files.get(RUNS) instanceof Uint8Array);

  // reopen with a project whose ghost list lost run7 (e.g. an older .pawproj): the run and its ghost come back
  const b = open(be, (gs) => gs.filter((g) => g.id !== 'run7'));
  await b.tr.runsLoad;
  const r = b.tr.run('run7');
  assert.ok(r && !r.restored);
  assert.equal(r.frames.ov.length, 30);
  assert.deepEqual(r.frames.ov[3].pts, [[0.5, 0.5, 1, 2], [0.25, 0.75, 0, -1]]);
  assert.ok(b.tr.runsInfo().some((x) => x.id === 'run7' && x.frames.t.length === 30));
  assert.ok(b.tr.ghost('run7'));
  assert.equal(b.tr.nextRunNumber(), 8);

  // a save without changes keeps it; an explicit remove drops it from the next save
  await b.app.blocksSaved(PROJ);
  assert.deepEqual(decodeRuns(be.files.get(RUNS)).map((x) => x.id), ['run7']);
  b.tr.remove('run7');
  b.tr.restoreRuns();   // what a link load / video change does: the removed run must not come back
  assert.equal(b.tr.run('run7'), null);
  await b.app.blocksSaved(PROJ);
  assert.deepEqual(decodeRuns(be.files.get(RUNS)), []);
  assert.deepEqual([...be.files.keys()].filter((k) => k.endsWith('.bak')), []);   // our own file: replaced, no copies
});

test('a file run replaces the ghost-rebuilt (restored) record of the same id', async () => {
  const be = M.mockBackend();
  const a = open(be);
  await a.tr.runsLoad;
  const run = { ...gridRun(3), channel: 'g2_proj' };
  a.tr.runs = [...a.tr.runs, run];
  const ghost = { ...a.tr.ghostOf(run), source: { ...a.tr.ghostOf(run).source, keep: { channel: 'g2_proj', channels: { g2_proj: [[0, 0.3], [33, 0.6]] }, points0Primary: [[0, 10]] } } };
  a.app.doc.ghosts = [...a.app.doc.ghosts, ghost];
  await a.app.blocksSaved(PROJ);
  const b = open(be, (gs) => [...gs, ghost]);   // the .pawproj kept the ghost (with its channel pick)
  assert.equal(b.tr.run('run3')?.restored, true);   // the ghost rebuild, before the file is read
  await b.tr.runsLoad;
  const r = b.tr.run('run3');
  assert.ok(!r.restored && r.frames.t.length === 30 && r.samples.t.length === 2);
  assert.equal(b.tr.runs.filter((x) => x.id === 'run3').length, 1);
});

test('an unreadable .pawruns is kept: open warns, the next save copies it to <name>.<ms>.bak first', async () => {
  const be = M.mockBackend();
  be.files.set(RUNS, new Uint8Array([1, 2, 3]));
  const toasts = [];
  const a = open(be);
  a.app.toast = (m, k) => toasts.push([k, m]);
  a.tr.loadRunsFile();   // again, with the toast captured
  await a.tr.runsLoad;
  assert.ok(toasts.some(([k, m]) => k === 'warn' && /sample\.pawruns/.test(m)));
  await a.app.blocksSaved(PROJ);
  const bak = [...be.files.keys()].find((k) => /^C:\/videos\/sample\.pawruns\.\d+\.bak$/.test(k));
  assert.deepEqual([...be.files.get(bak)], [1, 2, 3]);
  assert.ok(Array.isArray(decodeRuns(be.files.get(RUNS))));
});

test('Save As onto a path holding another project\'s runs copies that file aside; no runs and no file writes nothing', async () => {
  const be = M.mockBackend();
  const a = open(be);
  await a.tr.runsLoad;
  await a.app.blocksSaved(PROJ);
  assert.equal(be.files.has(RUNS), false);   // nothing tracked, nothing written
  const other = 'C:/other/show.pawruns';
  be.files.set(other, new Uint8Array([9]));
  a.tr.runs = [gridRun(1)];
  await a.app.blocksSaved('C:/other/show.pawproj');
  assert.ok([...be.files.keys()].some((k) => k.startsWith(other + '.') && k.endsWith('.bak')));
  assert.equal(decodeRuns(be.files.get(other))[0].id, 'run1');
});

test('a write failure is reported by blocksSaved (the save keeps the document dirty)', async () => {
  const be = M.mockBackend();
  be.writeBytes = async () => { throw new Error('disk full'); };
  const a = open(be);
  await a.tr.runsLoad;
  a.tr.runs = [gridRun(1)];
  const errs = await a.app.blocksSaved(PROJ);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /^runs: disk full/);
});

test('a finished track marks the document dirty', async () => {
  const be = M.mockBackend();
  be.sidecar = async (req, h) => {
    if (req.cmd !== 'track') return { result: null, error: 'no', cancelled: false };
    h?.onFrames?.([{ t_ms: 0, value: 0.5, overlay: null }]);
    return { result: { samples: [[0, 0.5]], points: [{ at: 0, pos: 50 }] }, error: null, cancelled: false };
  };
  const a = open(be);
  await a.tr.runsLoad;
  a.tr.openVideo(a.app.doc.media.path);   // the store's media effect (effects do not run under SSR)
  a.app.history.markSaved();
  assert.equal(a.app.doc.dirty, false);
  const r = await a.tr.runTrack({ id: 'lk_box', name: 'LK box' }, { start: 0, end: 1000 }, {}, { kind: 'box', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, [], { check: false });
  assert.ok(r.run, String(r.error));
  assert.equal(a.app.doc.dirty, true);
});

test('app.project.save writes the .pawproj, then the .pawruns; a failed runs write keeps the document dirty', async () => {
  const { createProject } = await server.ssrLoadModule('/src/app/project.svelte.js');
  const be = M.mockBackend();
  const a = open(be);
  await a.tr.runsLoad;
  const project = createProject(a.app);
  a.app.toast = () => {};
  a.tr.runs = [gridRun(2)];
  a.app.history.markDirty();
  assert.equal(await project.save(), true);
  assert.ok(be.files.has(PROJ) && be.files.get(RUNS) instanceof Uint8Array);
  assert.equal(a.app.doc.dirty, false);
  be.writeBytes = async () => { throw new Error('disk full'); };
  a.tr.patchRun('run2', { flips: [0] });   // a run changed: the runs must be written (unchanged ones are not, paw-o60v.3)
  a.app.history.markDirty();
  const notes = [];
  a.app.toast = (m) => notes.push(m);
  await project.save();
  assert.equal(a.app.doc.dirty, true);
  assert.ok(notes.some((m) => /Not saved: runs: disk full/.test(m)));
});

test('paw-up1r: the continuous write puts the runs in <stem>.pawruns only when they changed; a fresh app on the same disk reopens them with their frames', async () => {
  const { createProject } = await server.ssrLoadModule('/src/app/project.svelte.js');
  const be = M.mockBackend();
  be.sidecar = async (req, h) => {
    if (req.cmd !== 'track') return { result: null, error: 'no', cancelled: false };
    h?.onFrames?.([{ t_ms: 0, value: 0.5, overlay: { points: [], boxes: [], pts: [[0.5, 0.25, 1, 3]] } }, { t_ms: 33, value: 0.6, overlay: null }]);
    return { result: { samples: [[0, 0.5], [33, 0.6]], points: [{ at: 0, pos: 50 }] }, error: null, cancelled: false };
  };
  const writes = [], write = be.writeBytes.bind(be);
  be.writeBytes = async (p, b) => { writes.push(p); return write(p, b); };
  const a = open(be);
  const project = createProject(a.app);
  a.app.toast = () => {};
  await project.save();                       // the project exists on disk (no runs yet: no .pawruns)
  a.tr.openVideo(a.app.doc.media.path);
  const track = () => a.tr.runTrack({ id: 'lk_box', name: 'LK box' }, { start: 0, end: 1000 }, {}, { kind: 'box', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, [], { check: false });
  const runsWrites = () => writes.filter((p) => p === RUNS);
  const r1 = await track();
  assert.ok(r1.run);
  assert.equal(await project.flush(), true);
  a.app.transact('chapter', () => { a.app.doc.chapters = [{ id: 'c1', t0: 0, t1: 500, name: 'x', color: null }]; });
  assert.equal(await project.flush(), true);   // a write with no run change writes no runs
  assert.equal(runsWrites().length, 1);
  const r2 = await track();
  await project.flush();
  assert.equal(runsWrites().length, 2);
  assert.deepEqual(decodeRuns(be.files.get(RUNS)).map((x) => x.id), [r1.run.id, r2.run.id]);
  assert.equal(writes.filter((p) => p.startsWith('mock-autosave')).length, 0, 'nothing in app data: the project holds it');

  // crash: a fresh app on the same disk opens the project; the runs come back with their frames
  const b = M.createMockApp({ backend: be, doc: {}, keys: false }), trb = T.trackingFor(b);
  const p2 = createProject(b);
  b.toast = () => {};
  assert.equal(await p2.openProject(PROJ), true);
  await trb.runsLoad;
  for (const id of [r1.run.id, r2.run.id]) {
    const r = trb.run(id);
    assert.ok(r && !r.restored, id);
    assert.deepEqual(r.frames.ov[0].pts, [[0.5, 0.25, 1, 3]]);
  }
  assert.equal(b.doc.dirty, false);
});

test('paw-wzxu: a deleted modifier\'s own runs are not saved (.pawruns nor ghost); an undo of the delete brings them back for the next save', async () => {
  const be = M.mockBackend();
  const a = open(be);
  await a.tr.runsLoad;
  const mod = { id: 'fx1', kind: 'knotting', t0: 0, t1: 1000 }, run = { ...gridRun(3), mod: 'fx1', tag: 'mod' }, plain = gridRun(4);
  a.app.transact('Add Knotting', () => { a.app.doc.fx = [mod]; });
  a.tr.runs = [...a.tr.runs, run, plain];
  a.app.doc.ghosts = [...a.app.doc.ghosts, a.tr.ghostOf(run), a.tr.ghostOf(plain)];
  assert.equal(a.tr.ghost('run3').source.mod, 'fx1', 'the modifier run\'s ghost names its modifier');
  const ids = () => decodeRuns(be.files.get(RUNS)).map((x) => x.id).sort();
  const P = await server.ssrLoadModule('/src/app/project-logic.js');
  await a.app.blocksSaved(PROJ);
  assert.deepEqual(ids(), ['run3', 'run4']);
  a.app.transact('Delete modifiers', () => { a.app.doc.fx = []; });
  await a.app.blocksSaved(PROJ);
  assert.deepEqual(ids(), ['run4'], 'the orphan is dropped at the save');
  assert.deepEqual(P.savedGhosts(a.app.doc.ghosts, a.app.doc.fx).map((g) => g.id).filter((id) => /^run[34]$/.test(id)), ['run4'], 'its ghost is not saved in the .pawproj either');
  assert.ok(a.tr.run('run3'), 'still in memory');
  a.app.undo();
  await a.app.blocksSaved(PROJ);
  assert.deepEqual(ids(), ['run3', 'run4'], 'the modifier is back: so is its run');
  assert.equal(P.savedGhosts(a.app.doc.ghosts, a.app.doc.fx).filter((g) => g.id === 'run3').length, 1);
});

test('paw-o60v.3: a save with no run changed rewrites nothing; a flip writes once', async () => {
  const be = M.mockBackend(), writes = [], write = be.writeBytes.bind(be);
  be.writeBytes = async (p, b) => { writes.push(p); return write(p, b); };
  const a = open(be);
  await a.tr.runsLoad;
  a.tr.runs = [gridRun(1), gridRun(2)];
  await a.app.blocksSaved(PROJ);
  await a.app.blocksSaved(PROJ);
  assert.deepEqual(writes, [RUNS]);
  a.tr.patchRun('run2', { flips: [0] });
  await a.app.blocksSaved(PROJ);
  assert.deepEqual(writes, [RUNS, RUNS]);
  assert.deepEqual(decodeRuns(be.files.get(RUNS))[1].flips, [0]);
  be.files.delete(RUNS);   // gone (or replaced) behind our back: written again
  await a.app.blocksSaved(PROJ);
  assert.equal(writes.length, 3);
});

test('paw-v9qp: a reopened project\'s first write leaves its .pawruns alone when the runs did not change (it rewrote the whole file)', async () => {
  const be = M.mockBackend(), writes = [], write = be.writeBytes.bind(be);
  be.writeBytes = async (p, b) => { writes.push(p); return write(p, b); };
  const a = open(be, () => []);
  await a.tr.runsLoad;
  a.tr.runs = [gridRun(1), gridRun(2)];   // set as is: an open adds the keys a landed run has (lane, dir, ...), so it writes once
  await a.app.blocksSaved(PROJ);
  const once = open(be, () => []);
  await once.tr.runsLoad;
  await once.app.blocksSaved(PROJ);
  assert.equal(writes.length, 2);
  const b = open(be, () => []);
  await b.tr.runsLoad;
  assert.equal(b.tr.runs.length, 2);
  await b.app.blocksSaved(PROJ);
  assert.equal(writes.length, 2, 'the reopened runs are the file: not written again');
  b.tr.patchRun('run2', { flips: [0] });
  await b.app.blocksSaved(PROJ);
  assert.equal(writes.length, 3);
  assert.deepEqual(decodeRuns(be.files.get(RUNS))[1].flips, [0]);
});

test('paw-o60v.3: a save or autosave started under project A never writes into project B (B loaded before or during it)', async () => {
  const B = 'C:/videos/other.pawproj', BRUNS = 'C:/videos/other.pawruns';
  for (const when of ['before', 'during']) for (const kind of ['save', 'autosave']) {
    const be = M.mockBackend(), writes = [], write = be.writeBytes.bind(be);
    be.writeBytes = async (p, b) => { writes.push([p, decodeRuns(b).map((r) => r.id)]); return write(p, b); };
    const a = open(be);
    await a.tr.runsLoad;
    a.tr.runs = [gridRun(1)];
    a.tr.runsDirty = true;
    const toB = () => { a.app.doc.project = { path: B }; a.tr.loadRunsFile(); a.tr.runs = [gridRun(9)]; a.tr.runsDirty = true; };
    const stat = be.stat.bind(be), exists = be.exists.bind(be);
    let armed = when === 'during';   // B opens while A's save is under way (its file checks)
    be.exists = async (p) => { if (armed) { armed = false; toB(); } return exists(p); };
    be.stat = async (p) => { if (armed) { armed = false; toB(); } return stat(p); };
    const p = kind === 'save' ? a.tr.saveRunsFile(PROJ) : a.tr.autosaveRuns('mock-autosave/p-a');
    if (when === 'before') toB();
    await p;
    await a.tr.runsLoad;
    const label = `${kind}, B loaded ${when}`;
    assert.ok(writes.every(([path, ids]) => path !== BRUNS && !ids.includes('run9')), `${label}: ${JSON.stringify(writes)}`);
    assert.equal(a.tr.runsDirty, true, `${label}: B's unsaved runs stay to be written`);
  }
});
