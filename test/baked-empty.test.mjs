// paw-q8jh item 1: deleting every point of a live piece bakes it EMPTY (nothing plays there, shown baked, Unbake gives the run
// back), one undo step; the state rides in the .pawproj (extra bakedEmpty) and old projects load without it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { liveSpans, emptiedLive, composeLive, unmarkEmpty, normEmpty } from '../src/lib/script-of.js';

const saw = (t0, t1, per, lo, hi) => { const s = []; for (let t = t0, i = 0; t < t1; t += per, i++) s.push({ at: t, pos: i % 2 ? hi : lo }); return s; };
const inS = (s, t0, t1) => s.filter((p) => p.at >= t0 && p.at < t1);
const shots = [{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 4000 }];
const run = { id: 'run1', name: '#1', script: saw(0, 4000, 100, 30, 70) };

test('pure: an emptied live span is reported, a baked-empty span plays nothing, unmark drops it', () => {
  const live = composeLive([], liveSpans({ shots, runOf: () => run }));
  const next = live.script.filter((p) => p.at >= 2000);
  assert.deepEqual(emptiedLive(live, next).map((s) => [s.t0, s.t1]), [[0, 2000]]);
  assert.deepEqual(emptiedLive(live, live.script.filter((p) => p.at !== 500)), [], 'one point gone: not empty');
  assert.deepEqual(liveSpans({ shots, runOf: () => run, empty: [{ t0: 0, t1: 2000 }] }).map((s) => s.shot), [1]);
  const list = [{ axis: 'stroke', t0: 0, t1: 2000 }, { axis: 'roll', t0: 0, t1: 2000 }];
  assert.deepEqual(unmarkEmpty(list, 'stroke', [{ t0: 100, t1: 200 }]), [list[1]]);
  assert.equal(unmarkEmpty(list, 'stroke', [{ t0: 3000, t1: 4000 }]), list, 'nothing there: same list');
  assert.deepEqual(normEmpty([{ axis: 'stroke', t0: 5, t1: 1 }, null, { axis: 'stroke', t0: 0, t1: 9, x: 1 }]), [{ axis: 'stroke', t0: 0, t1: 9 }]);
});

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T, F, P;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  F = await server.ssrLoadModule('/src/lib/finish.js');
  P = await server.ssrLoadModule('/src/app/project-logic.js');
});
after(() => server?.close());
function mk() {
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), axes: { stroke: [] }, activeAxis: 'stroke', ghosts: [{ id: 'run1', name: '#1', color: 'red', visible: true, script: run.script, source: { kind: 'tracker' } }], scenes: shots, fx: [], plan: [], loops: [] }, keys: false, backend: M.mockBackend() });
  app.toast = () => {};
  const tr = T.trackingFor(app);
  tr.links = shots.map((s) => ({ t0: s.start_ms, t1: s.end_ms, run: 'run1', channel: 'primary' }));
  return { app, tr };
}

test('store: Delete of every point of a live shot is one undo step; the shot plays nothing, reads baked, Unbake brings the run back', () => {
  const { app, tr } = mk();
  const n0 = app._history.entries.length;
  // a writer working from the baked points (a generator, a re-track) never empties a live piece: no Delete / Cut flag
  app.edit('Generate', 'stroke', [{ at: 5000, pos: 50 }]);
  assert.deepEqual(app.doc.bakedEmpty, [], 'not baked empty by a base write');
  app.undo();
  app.edit('Delete points', 'stroke', F.finalAxes(app).stroke.filter((p) => p.at >= 2000), { empty: true });   // what the Delete command passes
  assert.equal(app._history.entries.length, n0 + 1, 'an undo entry (it was a silent no-op)');
  assert.deepEqual(inS(F.finalAxes(app).stroke, 0, 2000), [], 'nothing plays in shot 1');
  assert.deepEqual(inS(F.finalAxes(app).stroke, 2000, 4000), inS(run.script, 2000, 4000), 'shot 2 still live');
  assert.deepEqual([tr.bakeState(0).state, tr.bakeState(0).canUnbake], ['baked', true]);
  assert.deepEqual(app.doc.axes.stroke, [], 'no point written');
  // saved and opened again: still baked empty; an old project (no bakedEmpty) opens with none
  const saved = P.projectDoc(app.doc);
  assert.deepEqual(saved.extra.bakedEmpty, [{ axis: 'stroke', t0: 0, t1: 2000 }]);
  assert.deepEqual(P.appDocFrom(saved).bakedEmpty, [{ axis: 'stroke', t0: 0, t1: 2000 }]);
  assert.equal('bakedEmpty' in (P.appDocFrom(saved).project.extra || {}), false, 'not kept twice in extra');
  assert.deepEqual(P.appDocFrom({ ...saved, extra: { ...saved.extra, bakedEmpty: undefined } }).bakedEmpty, []);
  // undo / redo
  app.undo(); assert.deepEqual(inS(F.finalAxes(app).stroke, 0, 2000), inS(run.script, 0, 2000));
  app.redo(); assert.deepEqual(inS(F.finalAxes(app).stroke, 0, 2000), []);
  // Unbake: the run plays there again
  assert.equal(tr.unbake({ shots: [0] }), 1);
  assert.deepEqual(app.doc.bakedEmpty, []);
  assert.deepEqual(inS(F.finalAxes(app).stroke, 0, 2000), inS(run.script, 0, 2000));
  assert.equal(tr.bakeState(0).state, 'live');
});
