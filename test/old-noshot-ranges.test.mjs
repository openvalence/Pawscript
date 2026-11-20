// paw-05cg: a project from before run ranges with no shots played (and wrote) the run selected in the Runs list. At open it
// gets ranges once from what reopening it played (the run its resume entry selects, over what that run tracked; none:
// nothing), then only ranges decide: selecting another run never changes what plays or what Save / Export write.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, P, T, F, L, IO;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  P = await server.ssrLoadModule('/src/app/project.svelte.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  F = await server.ssrLoadModule('/src/lib/finish.js');
  L = await server.ssrLoadModule('/src/app/project-logic.js');
  IO = await server.ssrLoadModule('/src/lib/io/index.js');
});
after(() => server?.close());

const VIDEO = 'C:/clips/old.mp4', PROJ = 'C:/clips/old.pawproj';
const saw = (t0, t1, per, lo, hi) => { const s = []; for (let t = t0, i = 0; t < t1; t += per, i++) s.push({ at: t, pos: i % 2 ? hi : lo }); return s; };
const ghost = (id, t0, t1, lo, hi) => ({ id, name: '#' + id, color: '#f00', visible: true, script: saw(t0, t1, 100, lo, hi), source: { kind: 'tracker', runId: id, tracker: 'lk_box', range: { t0, t1 } } });
const memStorage = (m = new Map()) => ({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) });
/** The old project on disk: two runs, no shots, no runRanges (saved before ranges); baked points before both runs. */
function disk(extra = {}) {
  const be = M.mockBackend();
  const d = { media: { path: VIDEO, name: 'old.mp4', durationMs: 60000, fps: 30 }, axes: { stroke: [{ at: 0, pos: 50 }, { at: 400, pos: 10 }] }, activeAxis: 'stroke', chapters: [], bookmarks: [], loops: [], plan: [], graphs: [], scenes: [], fx: [],
    ghosts: [ghost('run1', 1000, 9000, 30, 70), ghost('run2', 2000, 12000, 10, 90)], runRanges: null, project: { path: PROJ }, ...extra };
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, IO.serialize(L.projectDoc(d), { projectPath: PROJ, ghostScripts: true }));
  return be;
}
async function open(be, resumeRun) {
  const m = new Map();
  if (resumeRun !== undefined) m.set('pawscript.resume', JSON.stringify({ last: PROJ, docs: { [L.pathKey(PROJ)]: { run: resumeRun, at: 1 } } }));
  const app = M.createMockApp({ backend: be, storage: memStorage(m), doc: {}, keys: false });
  app.toast = () => {}; app.choose = async () => null; app.confirm = async () => false;
  app.project = P.createProject(app);
  const tr = T.trackingFor(app);
  assert.equal(await app.project.openProject(PROJ), true);
  return { app, tr };
}
const out = (app) => JSON.stringify(F.finalAxes(app).stroke ?? []);

test('open with the run its resume entry selects: that run plays over what it tracked, as reopening played it', async () => {
  const { app, tr } = await open(disk(), 'run2');
  assert.deepEqual(app.doc.runRanges.map((r) => [r.run, r.t0, r.t1]), [['run2', 2000, 11901]]);
  const s = F.finalAxes(app).stroke;
  assert.deepEqual(s.filter((p) => p.at >= 2000), saw(2000, 12000, 100, 10, 90), 'run2 plays (what the old selection played)');
  assert.deepEqual(s.filter((p) => p.at < 2000), [{ at: 0, pos: 50 }, { at: 400, pos: 10 }], 'the baked points as they were');
  // the selection no longer decides
  const was = out(app);
  tr.select('run1'); assert.equal(out(app), was);
  tr.select(''); assert.equal(out(app), was);
  // saved with its ranges: the next open does not decide again
  assert.equal(JSON.parse(IO.serialize(L.projectDoc(app.doc))).runRanges.length, 1);
});

test('open with no resume entry (nothing was selected on reopen): nothing live, and selecting a run does not change that', async () => {
  const { app, tr } = await open(disk(), undefined);
  assert.deepEqual(app.doc.runRanges, []);
  const was = out(app);
  assert.equal(F.finalAxes(app).stroke.length, 2);
  tr.select('run2'); assert.equal(out(app), was);
});

test('left alone: a project with shots (its links decide) or with ranges already; a resume run that is gone', async () => {
  const shots = await open(disk({ scenes: [{ start_ms: 0, end_ms: 30000 }, { start_ms: 30000, end_ms: 60000 }] }), 'run2');
  assert.equal(shots.app.doc.runRanges, null);
  const ranged = await open(disk({ runRanges: [{ id: 'x', run: 'run1', t0: 1000, t1: 5000, layer: 0 }] }), 'run2');
  assert.deepEqual(ranged.app.doc.runRanges.map((r) => r.run), ['run1']);
  const gone = await open(disk(), 'run7');
  assert.deepEqual(gone.app.doc.runRanges, []);
});
