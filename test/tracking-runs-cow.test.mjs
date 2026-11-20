// paw-ee14 / paw-s49h / paw-d1sq through the real stores (vite SSR, as tracking-runs-file.test.mjs): with the copy-on-write
// shell the continuous write puts runs in a version-2 .pawruns, a flip appends (no whole rewrite), history entries name
// the runs they had, a restore brings a discarded run back with its frames, a fresh app reopens all of it. The close: a
// held close writes every tab then closes; Cancel keeps the app; the shell is told the app is alive while it writes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeRun, newFrames, appendFrames } from '../src/lib/runs.js';
import { decodeRuns, runsFileState } from '../src/lib/runs-file.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T, P, W;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  P = await server.ssrLoadModule('/src/app/project.svelte.js');
  W = await server.ssrLoadModule('/src/app/writing.svelte.js');
});
after(() => server?.close());

const VIDEO = 'C:/clips/gen.mp4', PROJ = 'C:/clips/gen.pawproj', RUNS = 'C:/clips/gen.pawruns';
const projectText = () => JSON.stringify({ format: 'pawproj', version: 3, media: { path: VIDEO, name: 'gen.mp4', durationMs: 60000, fps: 30 }, axes: { stroke: [[1000, 0], [1500, 100], [2000, 0]] } }, null, 2);
function start(be) {
  const app = M.createMockApp({ backend: be, doc: {}, keys: false });
  app.toast = () => {};
  app.choose = async () => null;
  app.confirm = async () => false;
  const tr = T.trackingFor(app);
  app.project = P.createProject(app);
  return { app, tr, project: app.project };
}
function gridRun(n) {
  const frames = newFrames();
  appendFrames(frames, Array.from({ length: 30 }, (_, i) => ({ t_ms: i * 33, value: i / 30, overlay: { points: [[0.5, 0.5]], boxes: [], pts: [[0.5, 0.5, 1, 2], [0.25, 0.75, 0, -1]] } })));
  return makeRun({ n, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: {}, range: { start: 0, end: 1000 }, roi: { kind: 'box', x: 0, y: 0, w: 1, h: 1 }, frames, runs: [],
    result: { samples: [[0, 0.1], [33, 0.2]], points: [{ at: 0, pos: 10 }, { at: 500, pos: 90 }], channels: { g2_proj: [[0, 0.3], [33, 0.6]] } } });
}

test('copy-on-write runs through the stores: written as version 2, a flip appends, a discarded run comes back whole from a checkpoint, a fresh app reopens it', async () => {
  const be = M.mockBackend({ cow: true }), calls = [];
  for (const k of ['runsAppend', 'runsStageWrite', 'writeBytes']) { const f = be[k].bind(be); be[k] = (...a) => { if (a[0] === RUNS) calls.push(k); return f(...a); }; }
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  const { app, tr, project } = start(be);
  assert.equal(await project.openProject(PROJ), true);
  await tr.runsLoad;
  const run = gridRun(7);
  tr.runs = [...tr.runs, run];
  app.doc.ghosts = [...app.doc.ghosts, tr.ghostOf(run)];
  app.history.markDirty();
  await project.flush();
  assert.equal(runsFileState(decodeRuns(be.files.get(RUNS))).v, 2);
  assert.ok(!calls.includes('writeBytes'), 'never written whole through one IPC body');
  assert.ok(project.checkpoints[0].runRefs?.run7, 'the entry after the track names the run');
  // paw-d1sq: once written, the run's frames read from the packed bytes
  await new Promise((r) => setTimeout(r, 50));
  const RF = await server.ssrLoadModule('/src/lib/runs-file.js');   // the store's own instance (its lazy marker)
  assert.ok(RF.lazyFrames(tr.run('run7').frames));
  assert.deepEqual(tr.run('run7').frames.ov[3].pts, [[0.5, 0.5, 1, 2], [0.25, 0.75, 0, -1]]);
  // a flip: appended, no stage
  calls.length = 0;
  tr.patchRun('run7', { flips: [100] });
  app.history.markDirty();
  await project.flush();
  assert.deepEqual([...new Set(calls)], ['runsAppend']);
  assert.deepEqual(decodeRuns(be.files.get(RUNS))[0].flips, [100]);
  // discarded: the entry before it names it; the file's live runs no longer have it
  tr.remove('run7');
  app.history.markDirty();
  await project.flush();
  // (the flip left the .pawproj as it was: the entry before the discard is the one after the track, its runs brought up to date)
  const before = project.checkpoints.find((c) => c.runRefs?.run7);
  assert.ok(before?.runRefs?.run7, JSON.stringify(project.checkpoints.map((c) => [c.label, c.runRefs])));
  assert.deepEqual(decodeRuns(be.files.get(RUNS)).map((r) => r.id), []);
  // back to it: the run returns with its frames (paw-s49h), not only its ghost's points
  assert.equal(await project.restoreCheckpoint(before.id), true);
  const back = tr.run('run7');
  assert.ok(back && !back.restored && back.frames?.ov?.length === 30, 'whole');
  assert.deepEqual(back.flips, [100]);
  assert.deepEqual(back.frames.ov[3].pts, [[0.5, 0.5, 1, 2], [0.25, 0.75, 0, -1]]);
  await project.flush();
  assert.deepEqual(decodeRuns(be.files.get(RUNS)).map((r) => r.id), ['run7']);
  // a fresh app on the same disk
  const b = start(be);
  assert.equal(await b.project.openProject(PROJ), true);
  await b.tr.runsLoad;
  assert.equal(b.tr.run('run7')?.frames?.ov?.length, 30);
});

test('closing: every tab written, then the window closes; Cancel keeps the app (the write goes on); the shell hears the app is alive', async () => {
  let release, closed = 0, beats = 0, cancels = 0;
  const app = {
    backend: { windowCloseNow: async () => { closed++; }, closeHeartbeat: async () => { beats++; }, closeCancel: async () => { cancels++; } },
    tabs: { apps: [], closeAll: () => new Promise((r) => { release = r; }) },
  };
  const p = W.closeApp(app);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(W.writing.shown, true, 'the panel shows while it writes');
  assert.equal(W.writing.cancelable, true);
  assert.ok(beats >= 1);
  W.cancelClose(app);
  assert.equal(cancels, 1);
  release();
  await p;
  assert.equal(closed, 0, 'cancelled: the window stays');
  // closed again: it closes when the writes end
  const q = W.closeApp(app);
  release();
  await q;
  assert.equal(closed, 1);
  // a shell without the paw-ee14 commands: no Cancel offered, still closes
  const old = { backend: { windowCloseNow: async () => { closed++; } }, tabs: { apps: [], closeAll: async () => {} } };
  await W.closeApp(old);
  assert.equal(closed, 2);
  assert.equal(W.writing.cancelable, false);
});

test('paw-mn92: closing writes the usage log (app:close once) before the window goes; a usage log that hangs costs at most a second', async () => {
  const { Usage } = await server.ssrLoadModule('/src/app/usage.svelte.js');
  const order = [];
  const sink = { append: async (text) => { await new Promise((r) => setTimeout(r, 20)); order.push(text); } };
  const usage = new Usage(null, 100, { sink });
  const app = { usage, backend: { windowCloseNow: async () => { order.push('closed'); } }, tabs: { apps: [], closeAll: async () => {} } };
  await W.closeApp(app);
  assert.equal(order.length, 2);
  assert.match(order[0], /"k":"app:close"/);
  assert.equal(order[1], 'closed');
  usage.close();   // beforeunload after the close: no second app:close
  assert.equal(usage.log.filter((e) => e.kind === 'app:close').length, 1);
  const stuck = { usage: { close: () => new Promise(() => {}) }, backend: { windowCloseNow: async () => { order.push('closed2'); } }, tabs: { apps: [], closeAll: async () => {} } };
  const t0 = Date.now();
  await W.closeApp(stuck);
  assert.ok(order.at(-1) === 'closed2' && Date.now() - t0 < 2000);
});
