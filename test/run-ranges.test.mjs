// paw-1ysd: run ranges decide which run plays where. The pure rule (lib/run-ranges.js), then the store: an old project plays
// exactly what it did (ranges from its links), a range edit is one undo step and saved, selecting a run changes nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { putRange, moveEnd, fromLinks, normRanges, rangeAt, rangesIn, removeRange, playsAll } from '../src/lib/run-ranges.js';

test('putRange trims and splits on its layer, keeps the covered runs; moveEnd clamps to the extent and trims a neighbour', () => {
  let L = putRange([], { id: 'a', run: 'r1', t0: 0, t1: 6000 });
  L = putRange(L, { id: 'b', run: 'r2', t0: 2000, t1: 3000 });
  assert.deepEqual(L.map((x) => [x.run, x.t0, x.t1]), [['r1', 0, 2000], ['r2', 2000, 3000], ['r1', 3000, 6000]]);
  assert.equal(L[0].id, 'a'); assert.notEqual(L[2].id, 'a', 'a split piece has its own id');
  assert.equal(rangeAt(L, 2500).run, 'r2'); assert.equal(rangeAt(L, 6000), null);
  assert.deepEqual(rangesIn(L, 1000, 2500).map((x) => [x.run, x.a, x.b]), [['r1', 1000, 2000], ['r2', 2000, 2500]]);
  L = putRange(L, { id: 'c', run: 'r3', t0: 0, t1: 1000, layer: 1 });
  assert.equal(L.filter((x) => x.run === 'r1').length, 2, 'another layer trims nothing (layers are not mixed yet)');
  const M = moveEnd(L, 'b', 1, 9000, { hi: 4000 });
  assert.deepEqual(M.filter((x) => !x.layer).map((x) => [x.run, x.t0, x.t1]), [['r1', 0, 2000], ['r2', 2000, 4000], ['r1', 4000, 6000]], 'grown to its run\'s extent, the neighbour trimmed');
  assert.equal(moveEnd(L, 'b', 1, 3000), L, 'no change: same array');
  assert.deepEqual(removeRange(M, 'b').filter((x) => !x.layer).map((x) => x.run), ['r1', 'r1']);
});

test('playsAll: the run end to end over the span; no range there is not playing (paw-uzlr)', () => {
  const L = [{ id: 'a', run: 'r1', t0: 0, t1: 1000 }, { id: 'b', run: 'r1', t0: 1000, t1: 2000 }, { id: 'c', run: 'r2', t0: 3000, t1: 4000 }];
  assert.ok(playsAll(L, 'r1', 0, 2000), 'two pieces end to end');
  assert.ok(!playsAll(L, 'r1', 0, 2500), 'a gap at the end');
  assert.ok(!playsAll(L, 'r2', 2500, 4000), 'a gap at the start');
  assert.ok(!playsAll(L, 'r9', 5000, 6000), 'nothing there');
  assert.ok(!playsAll(L, 'r1', 500, 3500), 'another run inside');
});

test('ranges from links (a project before ranges): a shot per link, one run\'s neighbours merged; normRanges cleans a stored list', () => {
  const shots = [{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 4000 }, { start_ms: 4000, end_ms: 6000 }, { start_ms: 6000, end_ms: 8000 }];
  const R = fromLinks(shots, (i) => [null, 'r1', 'r1', 'r2'][i]);
  assert.deepEqual(R.map((x) => [x.run, x.t0, x.t1]), [['r1', 2000, 6000], ['r2', 6000, 8000]]);
  assert.deepEqual(normRanges([{ run: 'r', t0: 5, t1: 1 }, { run: 'r', t0: 0, t1: 10.4 }, { run: 'q', t0: 5, t1: 20 }]).map((x) => [x.run, x.t0, x.t1, x.layer]), [['r', 0, 5, 0], ['q', 5, 20, 0]]);
  assert.equal(normRanges(undefined), null);
});

// ---- the store (vite SSR, the real store) ----
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
const saw = (t0, t1, per, lo, hi) => { const s = []; for (let t = t0, i = 0; t < t1; t += per, i++) s.push({ at: t, pos: i % 2 ? hi : lo }); return s; };
const shots = [{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 4000 }, { start_ms: 4000, end_ms: 6000 }];
const g = (id, lo, hi) => ({ id, name: '#' + id, color: 'red', visible: true, script: saw(0, 6000, 100, lo, hi), source: { kind: 'tracker' } });
function mk(runRanges = null) {
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), axes: { stroke: [] }, activeAxis: 'stroke', ghosts: [g('run1', 30, 70), g('run2', 10, 90)], scenes: shots, fx: [], plan: [], loops: [], runRanges }, keys: false, backend: M.mockBackend() });
  app.toast = () => {};
  const tr = T.trackingFor(app);
  tr.links = [{ t0: 0, t1: 2000, run: 'run1', channel: 'primary' }, { t0: 2000, t1: 4000, run: 'run1', channel: 'primary' }, { t0: 4000, t1: 6000, run: 'run2', channel: 'primary' }];
  return { app, tr };
}
const inS = (s, t0, t1) => s.filter((p) => p.at >= t0 && p.at < t1);

test('an old project (no ranges) plays exactly what its links played; selecting another run no longer changes it', () => {
  const { app, tr } = mk(null);
  const out = F.finalAxes(app).stroke;
  assert.deepEqual(inS(out, 0, 4000), inS(g('run1', 30, 70).script, 0, 4000));
  assert.deepEqual(inS(out, 4000, 6000), inS(g('run2', 10, 90).script, 4000, 6000));
  const ref = mk(fromLinks(shots, (i) => ['run1', 'run1', 'run2'][i]));
  assert.equal(JSON.stringify(F.finalAxes(ref.app).stroke), JSON.stringify(out), 'byte for byte the same as its ranges written out');
  tr.select('run2');
  assert.equal(JSON.stringify(F.finalAxes(app).stroke), JSON.stringify(out), 'the selection only selects');
  assert.equal(app.doc.runRanges, null, 'nothing written on open');
});

test('a range edit is one undo step: a piece of a shot plays another run; resize clamps to what the run tracked; saved and read back', () => {
  const { app, tr } = mk(null);
  const n0 = app._history.entries.length;
  tr.useRun('run2', 2500, 3500);
  assert.equal(app._history.entries.length, n0 + 1);
  const out = F.finalAxes(app).stroke;
  assert.deepEqual(inS(out, 2600, 3400), inS(g('run2', 10, 90).script, 2600, 3400), 'the piece plays run 2');
  assert.deepEqual(inS(out, 600, 2400), inS(g('run1', 30, 70).script, 600, 2400), 'the rest of run 1 is left');
  assert.deepEqual(tr.runRanges.map((x) => [x.run, x.t0, x.t1]), [['run1', 0, 2500], ['run2', 2500, 3500], ['run1', 3500, 4000], ['run2', 4000, 6000]]);
  const first = tr.runRanges[0];
  tr.moveRangeEnd(first.id, 0, -5000);
  assert.equal(tr.runRanges[0].t0, 0, 'never before what the run tracked');
  // saved in the .pawproj and read back
  const pd = P.projectDoc(app.doc), back = P.appDocFrom({ ...pd, extra: pd.extra }, {});
  assert.deepEqual(back.runRanges.map((x) => [x.run, x.t0, x.t1]), app.doc.runRanges.map((x) => [x.run, x.t0, x.t1]));
  tr.removeRange(tr.runRanges.find((x) => x.t0 === 2500).id);
  assert.deepEqual(inS(F.finalAxes(app).stroke, 2600, 3400), [], 'a removed range plays nothing (the run stays)');
  assert.ok(tr.unusedRuns.length === 0 && tr.ghost('run2'), 'run 2 still plays shot 3; nothing discarded');
  app.undo(); app.undo();
  assert.equal(app.doc.runRanges, null, 'undo back to before any range');
});

test('Bake with no scope (Shift+B): the shot under the playhead; Unbake the same', () => {
  const { app, tr } = mk(null);
  app.player.seek(2500);
  assert.equal(tr.bake(), 1);
  assert.equal(inS(app.doc.axes.stroke, 2000, 4000).length, 20);
  assert.deepEqual(inS(app.doc.axes.stroke, 0, 2000), []);
  assert.equal(tr.unbake(), 1);
  assert.deepEqual(app.doc.axes.stroke, []);
});

test('a range a track takes survives undo: track A, edit A\'s range, track B, undo the edit -> B still there, the edit undone', () => {
  const { app, tr } = mk([]);
  app.doc.ghosts = [...app.doc.ghosts, g('run3', 20, 80)];
  tr.takeRange('run1', 0, 2000);                                  // track A (no undo step)
  const a = tr.runRanges.find((x) => x.run === 'run1');
  tr.moveRangeEnd(a.id, 1, 1500);                                 // edit A's range (one step)
  tr.takeRange('run3', 4000, 6000);                               // track B (no undo step)
  assert.deepEqual(tr.runRanges.map((x) => [x.run, x.t0, x.t1]), [['run1', 0, 1500], ['run3', 4000, 6000]]);
  app.undo();
  assert.deepEqual(tr.runRanges.map((x) => [x.run, x.t0, x.t1]), [['run1', 0, 2000], ['run3', 4000, 6000]], 'B kept, the edit undone');
  app.redo();
  assert.deepEqual(tr.runRanges.map((x) => [x.run, x.t0, x.t1]), [['run1', 0, 1500], ['run3', 4000, 6000]]);
});

test('restoring one section brings back the run ranges inside it (clipped at its edges) and leaves the rest', async () => {
  const H = await server.ssrLoadModule('/src/app/history-diff.js');
  const now = { runRanges: [{ id: 'a', run: 'r2', t0: 0, t1: 6000, layer: 0 }] };
  const then = { runRanges: [{ id: 'b', run: 'r1', t0: 0, t1: 3000, layer: 0 }, { id: 'c', run: 'r2', t0: 3000, t1: 6000, layer: 0 }] };
  const out = H.restoreSection(now, then, { t0: 2000, t1: 4000 });
  assert.deepEqual(out.runRanges.map((x) => [x.run, x.t0, x.t1]), [['r2', 0, 2000], ['r1', 2000, 3000], ['r2', 3000, 6000]]);
  assert.equal(H.restoreSection(now, now, { t0: 2000, t1: 4000 }).runRanges, undefined, 'the same: nothing to restore');
});
