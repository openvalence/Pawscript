// paw-acfc through the tracking store: a .pawruns with an unreadable record opens the other runs with their ids on the right
// record hashes (runRefs), and the next write keeps the damaged file in the rolling backups before it rewrites it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeRun, newFrames, appendFrames } from '../src/lib/runs.js';
import { decodeRuns, runsFileState } from '../src/lib/runs-file.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T, P;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  P = await server.ssrLoadModule('/src/app/project.svelte.js');
});
after(() => server?.close());

const VIDEO = 'C:/clips/gen.mp4', PROJ = 'C:/clips/gen.pawproj', RUNS = 'C:/clips/gen.pawruns';
const projectText = () => JSON.stringify({ format: 'pawproj', version: 3, media: { path: VIDEO, name: 'gen.mp4', durationMs: 60000, fps: 30 }, axes: { stroke: [[1000, 0], [1500, 100], [2000, 0]] } }, null, 2);
function start(be) {
  const app = M.createMockApp({ backend: be, doc: {}, keys: false });
  const toasts = [];
  app.toast = (m) => toasts.push(m);
  const tr = T.trackingFor(app);
  app.project = P.createProject(app);
  return { app, tr, project: app.project, toasts };
}
function gridRun(n) {
  const frames = newFrames();
  appendFrames(frames, Array.from({ length: 30 }, (_, i) => ({ t_ms: i * 33 + n, value: i / 30, overlay: { points: [[0.5, 0.5]], boxes: [], pts: [[0.5, 0.5, 1, 2]] } })));
  return makeRun({ n, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: {}, range: { start: 0, end: 1000 }, roi: { kind: 'box', x: 0, y: 0, w: 1, h: 1 }, frames, runs: [],
    result: { samples: [[0, 0.1], [33, 0.2]], points: [{ at: 0, pos: 10 + n }, { at: 500, pos: 90 }] } });
}

test('an unreadable record: the other runs keep their own record hashes; the next write backs the damaged file up first', async () => {
  const be = M.mockBackend({ cow: true });
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  const a = start(be);
  assert.equal(await a.project.openProject(PROJ), true);
  await a.tr.runsLoad;
  for (const n of [1, 2, 3]) { const r = gridRun(n); a.tr.runs = [...a.tr.runs, r]; a.app.doc.ghosts = [...a.app.doc.ghosts, a.tr.ghostOf(r)]; }
  a.app.history.markDirty();
  assert.equal(await a.project.flush(), true);
  await a.project.close({ quit: true });   // paw-vm6e: one window writes a project at a time
  // run1's record made unreadable (one byte)
  const st = runsFileState(decodeRuns(be.files.get(RUNS))), hashes = st.runs;
  const bytes = new Uint8Array(be.files.get(RUNS)); bytes[st.blocks.get(hashes[0])[0]] = 0; be.files.set(RUNS, bytes);
  const damaged = be.files.get(RUNS);
  const b = start(be);
  assert.equal(await b.project.openProject(PROJ), true);
  await b.tr.runsLoad;
  assert.deepEqual(b.tr.runRefs(), { run2: hashes[1], run3: hashes[2] }, 'ids on their own hashes');
  assert.ok(b.toasts.some((m) => /is damaged: .*could not be read.*kept in the backups/.test(m)));
  b.tr.patchRun('run2', { flips: [100] });
  b.app.history.markDirty();
  assert.equal(await b.project.flush(), true);
  assert.equal(be.backups.length, 1);
  assert.equal(be.backups[0][1], damaged, 'the damaged file is in the backups');
  assert.deepEqual(decodeRuns(be.files.get(RUNS)).map((r) => r.id).sort(), ['run2', 'run3']);
});
