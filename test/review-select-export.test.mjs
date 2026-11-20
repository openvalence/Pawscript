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

test('no shots, a project before ranges: selecting a run in the list does not change what exports', () => {
  const { app, tr } = mk(null, []);
  tr.runs = ['run1', 'run2'].map((id, k) => ({ id, n: k + 1, tracker: 'lk_box', range: { start: 0, end: 6000 }, scenes: [], params: {}, points: { at: [], pos: [] }, samples: { t: [], v: [] } }));
  const before = JSON.stringify(F.finalAxes(app).stroke ?? []);
  tr.select('run1');
  const a = JSON.stringify(F.finalAxes(app).stroke ?? []);
  tr.select('run2');
  const b = JSON.stringify(F.finalAxes(app).stroke ?? []);
  assert.deepEqual([a === before, b === before], [true, true], `export changed with the selection (points: ${JSON.parse(before).length} -> ${JSON.parse(a).length} / ${JSON.parse(b).length}, run1 vs run2 equal: ${a === b})`);
});
