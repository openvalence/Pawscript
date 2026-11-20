// paw-j89h: a video with no shots (none detected, none cut) is one piece. Its opened script is baked, so a run tracked over it
// plays nowhere (2e31f7a); Unbake must then be on (its `when` asked every shot, and there were none) and give the range to the run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const saw = (t0, t1, per, lo, hi) => { const s = []; for (let t = t0, i = 0; t < t1; t += per, i++) s.push({ at: t, pos: i % 2 ? hi : lo }); return s; };
const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T, C, F;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  C = (await server.ssrLoadModule('/src/features/tracking/commands.js')).default;
  F = await server.ssrLoadModule('/src/lib/finish.js');
});
after(() => server?.close());

test('no shots: a run over the opened script leaves it baked; Unbake is on and the run plays there; Bake writes it back', () => {
  const opened = saw(500, 9000, 400, 10, 90), run = saw(1000, 8000, 250, 30, 70);
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), axes: { stroke: opened }, activeAxis: 'stroke', scenes: [], fx: [], plan: [], loops: [],
    ghosts: [{ id: 'run1', name: '#1', color: 'red', visible: true, script: run, source: { kind: 'tracker' } }],
    runRanges: [{ layer: 0, run: 'run1', t0: 1000, t1: 8000, id: 'rr1' }] }, keys: false, backend: M.mockBackend() });
  app.toast = () => {};
  const tr = T.trackingFor(app), when = (id) => C.find((c) => c.id === id).when(app);
  assert.equal(tr.scenes.length, 0);
  assert.deepEqual(F.finalAxes(app).stroke, opened, 'baked: the run changes nothing');
  assert.deepEqual([tr.bakeState(0).state, tr.bakeState(0).canUnbake], ['baked', true], 'the whole video is piece 0');
  assert.equal(when('tracking.unbake'), true, 'Unbake offered');
  assert.equal(tr.unbake({ range: { t0: 1000, t1: 8000 } }), 1);
  const inR = (s) => s.filter((p) => p.at >= 1000 && p.at < 8000);
  assert.deepEqual(inR(F.finalAxes(app).stroke), inR(run), 'the run plays live in its range');
  assert.equal(tr.bakeState(0).state, 'live');
  assert.equal(when('tracking.unbake'), false, 'nothing baked under a run any more');
  assert.ok(tr.bake({ range: { t0: 1000, t1: 8000 } }) > 0);
  assert.deepEqual(inR(app.doc.axes.stroke), inR(run), 'Bake writes it');
});
