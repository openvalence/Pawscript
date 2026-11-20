// [review] the live script in the real store: hand edits on shots that play several runs (run ranges).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T, F;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  F = await server.ssrLoadModule('/src/lib/finish.js');
});
after(() => server?.close());
const saw = (t0, t1, per, lo, hi) => { const s = []; for (let t = t0, i = 0; t < t1; t += per, i++) s.push({ at: t, pos: i % 2 ? hi : lo }); return s; };
const shots = [{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 4000 }, { start_ms: 4000, end_ms: 6000 }];
const g = (id, lo, hi) => ({ id, name: '#' + id, color: 'red', visible: true, script: saw(0, 6000, 100, lo, hi), source: { kind: 'tracker' } });
function mk(runRanges = null, scenes = shots) {
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), axes: { stroke: [] }, activeAxis: 'stroke', ghosts: [g('run1', 30, 70), g('run2', 10, 90)], scenes, fx: [], plan: [], loops: [], runRanges }, keys: false, backend: M.mockBackend() });
  app.toast = () => {};
  const tr = T.trackingFor(app);
  tr.links = scenes.length ? [{ t0: 0, t1: 2000, run: 'run1', channel: 'primary' }, { t0: 2000, t1: 4000, run: 'run1', channel: 'primary' }, { t0: 4000, t1: 6000, run: 'run2', channel: 'primary' }] : [];
  return { app, tr };
}
const inS = (s, t0, t1) => s.filter((p) => p.at >= t0 && p.at < t1);
const R2 = inS(g('run2', 10, 90).script, 2600, 3400);

test('a point moved in one run piece of a shot leaves the other run piece playing', () => {
  const { app, tr } = mk(null);
  tr.useRun('run2', 2500, 3500);                                    // shot 2: run1 | run2 | run1
  assert.deepEqual(inS(F.finalAxes(app).stroke, 2600, 3400), R2);
  const s = F.finalAxes(app).stroke.map((p) => (p.at === 2100 ? { at: 2100, pos: 3 } : p));
  app.edit('Move point', 'stroke', s);
  assert.deepEqual(inS(F.finalAxes(app).stroke, 2600, 3400), R2, 'run2 piece should still play after an edit in the run1 piece');
});

test('no shots, two run ranges: a point moved in run1 leaves run2 playing', () => {
  const { app, tr } = mk([{ id: 'a', run: 'run1', t0: 0, t1: 3000, layer: 0 }, { id: 'b', run: 'run2', t0: 3000, t1: 6000, layer: 0 }], []);
  const R = inS(g('run2', 10, 90).script, 3000, 5900);
  assert.deepEqual(inS(F.finalAxes(app).stroke, 3000, 5900), R);
  app.edit('Move point', 'stroke', F.finalAxes(app).stroke.map((p) => (p.at === 500 ? { at: 500, pos: 3 } : p)));
  assert.deepEqual(inS(F.finalAxes(app).stroke, 3000, 5900), R, 'run2 should still play');
  // Unbake with no shots: the baked range plays its run again
  assert.equal(tr.unbake({ all: true }), 1);
  assert.deepEqual(app.doc.axes.stroke, []);
  assert.match(app._history.entries.at(-1).label, /^Unbake the script/);
});

test('per piece: bakeState, Bake by run, Unbake by shot and by run each act on the pieces, not the whole shot', () => {
  const { app, tr } = mk(null);
  tr.useRun('run2', 2500, 3500);                                    // shot 2: run1 | run2 | run1
  assert.deepEqual(tr.bakeState(1).pieces.map((p) => [p.t0, p.t1, p.run, p.state]), [[2000, 2500, 'run1', 'live'], [2500, 3500, 'run2', 'live'], [3500, 4000, 'run1', 'live']]);
  // Bake by run: only run2's piece; the shot stays live (its run1 pieces play), Unbake is offered
  assert.equal(tr.bake({ run: 'run2' }), 2);   // run2's piece in shot 2 and its whole shot 3 (its link)
  const st = tr.bakeState(1);
  assert.deepEqual([st.state, st.canUnbake, st.pieces.map((p) => p.state)], ['live', true, ['live', 'baked', 'live']]);
  assert.deepEqual(inS(app.doc.axes.stroke, 2000, 4000).map((p) => p.at)[0], 2500, 'nothing baked in the run1 pieces');
  // Unbake by run gives run2's pieces back; Bake of the shot then bakes all three pieces and the shot reads baked
  assert.equal(tr.unbake({ run: 'run2' }), 2);
  assert.deepEqual(app.doc.axes.stroke, []);
  tr.bake({ shots: [1] });
  assert.equal(tr.bakeState(1).state, 'baked');
  // Unbake by shot over an I/O-like range inside run2's piece: that piece only
  tr.unbake({ range: { t0: 2600, t1: 2700 } });
  assert.deepEqual(tr.bakeState(1).pieces.map((p) => p.state), ['baked', 'live', 'baked']);
});

test('paw-78fr: Delete of the points in an I/O range over a shot of three run pieces deletes exactly those, the rest keeps playing', () => {
  const { app, tr } = mk(null);
  tr.useRun('run2', 2500, 3500);                                    // shot 2: run1 | run2 | run1
  const s = F.finalAxes(app).stroke, inR = (p) => p.at >= 2300 && p.at <= 3400, keep = s.filter((p) => !inR(p));
  app.edit('Delete points', 'stroke', s.filter((p) => !inR(p)), { empty: true });   // what Delete of the points in an I/O range writes
  assert.deepEqual(F.finalAxes(app).stroke, keep, 'only the points in the range are gone');
  assert.deepEqual(tr.bakeState(1).pieces.map((p) => p.state), ['baked', 'baked', 'live'], 'the pieces it touched baked, the last one (outside the range) still live');
  app.undo();
  assert.deepEqual(F.finalAxes(app).stroke, s, 'undo: all back');
});
