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

test('a discarded run leaves no range behind for the next run that takes its number', () => {
  const { app, tr } = mk([]);
  tr.useRun('run1', 0, 2000);                                       // an undoable range edit before the track
  tr.takeRange('run2', 2000, 6000);                                 // run2 tracked over the rest
  tr.remove('run2');                                                // discarded
  assert.equal(tr.nextRunNumber(), 3, 'paw-1fd3: its number is never given again');
  app.doc.ghosts = [...app.doc.ghosts, g('run2', 10, 90)];          // a ghost named run2 back (say, a history restore without its ranges)
  assert.deepEqual(tr.runRanges.filter((x) => x.run === 'run2'), [], 'the new run2 should play nowhere (it inherits the discarded run2 range)');
  app.undo(); app.redo();                                           // undo / redo of the range edit made before the track
  assert.deepEqual(app.doc.runRanges.filter((x) => x.run === 'run2'), [], 'undo does not resurrect the discarded run\'s ranges');
});

test('run numbers: never reused within a project; the counter is saved; an old project starts above every run it knows', () => {
  const { app, tr } = mk([]);
  tr.runs = [{ id: 'run2', n: 2 }, { id: 'run5', n: 5 }];
  assert.equal(tr.nextRunNumber(), 6);
  tr.remove('run5'); tr.runs = tr.runs.filter((r) => r.id !== 'run5');
  assert.equal(tr.nextRunNumber(), 6, 'run5 discarded: 6 still, not 5 again');
  // saved in the tracking block, read back on open
  const blk = app.blocks.get('tracking'), saved = blk.save();
  assert.equal(saved.runSeq, 5);
  blk.load(null, undefined); assert.equal(tr.runSeq, 0, 'an old project: no counter');
  blk.load(null, saved); assert.equal(tr.runSeq, 5);
  // an old project: a run that only a history entry keeps (its record in the copy-on-write runs file) is never collided with
  blk.load(null, undefined);
  app.project = { ...(app.project || {}), checkpoints: [{ id: '1', runRefs: { run9: 'abc' } }] };
  assert.equal(tr.nextRunNumber(), 10);
});
