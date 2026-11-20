// paw-cfaz: a drag's preview (here the run strip's flip preview) plays while it is set, but nothing that writes reads it:
// Save / Publish / Export / pack (lib/finish.js finalAxes) and Bake drop every preview first and write the runs without it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeRun } from '../src/lib/runs.js';

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

test('a stuck flip preview never reaches what finalAxes and Bake write', () => {
  const pairs = Array.from({ length: 180 }, (_, f) => [Math.round(f * 1000 / 30), 50 + 40 * Math.sin(f / 3)]);
  const turns = pairs.filter((_, f) => f % 9 === 4).map(([at, v], k) => ({ at, pos: k % 2 ? 90 : 10 }));
  const S = makeRun({ n: 1, tracker: { id: 'lk_box', name: 'Optical flow' }, params: {}, range: { start: 0, end: 6000 }, roi: null, frames: null, runs: [],
    result: { samples: pairs, points: turns, scenes: [{ start_ms: 0, end_ms: 6000, sign: 1 }], channels: { proj: pairs } } });
  S.channel = 'proj';
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), axes: { stroke: [] }, activeAxis: 'stroke', scenes: [{ start_ms: 0, end_ms: 6000 }], runRanges: [{ id: 'a', run: 'run1', t0: 0, t1: 6000, layer: 0 }] }, keys: false, backend: M.mockBackend() });
  app.toast = () => {};
  const tr = T.trackingFor(app);
  tr.runs = [S]; app.doc.ghosts = [tr.ghostOf(S)];
  tr.applyRunPatch(tr.run('run1'), { flips: [] });
  const clean = JSON.stringify(F.finalAxes(app).stroke), cleanLive = JSON.stringify(tr.liveOf('stroke').script);
  assert.ok(JSON.parse(clean).length > 4, 'the run plays');
  // a drag's preview: the whole run flipped while the pointer is down (and say the release never came)
  const stick = () => { tr.flipPreview = { run: 'run1', list: [[0, 6000]] }; tr.applyRunPatch(tr.run('run1'), { flips: [] }); };
  stick();
  assert.notEqual(JSON.stringify(tr.ghost('run1').script), JSON.stringify(JSON.parse(clean)), 'the preview plays');
  assert.equal(JSON.stringify(F.finalAxes(app).stroke), clean, 'what is written: without the preview');
  assert.equal(tr.flipPreview, null, 'the preview dropped');
  stick();
  tr.bake({ all: true });
  assert.equal(JSON.stringify(app.doc.axes.stroke), cleanLive, 'Bake writes the run without the preview');
  tr.destroy();
});
