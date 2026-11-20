// paw-iyl3: nothing after a track's last frame is silent or claims 100 % (src/lib/progress.js; the tracking store's job()):
// the sidecar's stages after the frames have words, the bar stops at 99 %, and once the result is in the app says it is
// reading it until the run is on the timeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressText, shownDone } from '../src/lib/progress.js';

test('every stage after the last frame has words, and nothing says 100 %', () => {
  assert.equal(progressText({ done: 3000, total: 3000, stage: 'inference' }), '99 % · tracking the scene');
  assert.equal(progressText({ done: 3000, total: 3000, stage: 'groups' }), '99 % · motion groups');
  assert.equal(progressText({ done: 1200, total: 3000, stage: 'frames' }), '40 % · sending the tracked frames');
  assert.equal(progressText({ done: 3000, total: 3000, stage: 'shaft' }), '99 % · shaft pass');
  assert.equal(progressText({ done: 3000, total: 3000, stage: 'points' }), '99 % · making points');
  assert.equal(progressText({ done: 3000, total: 3000, stage: 'result' }), '99 % · sending the result');
  assert.equal(progressText({ done: 3000, total: 3000, stage: 'read' }), '99 % · reading the result');
  assert.equal(progressText({ stage: 'read' }), 'reading the result', 'a job with no progress events (score) too');
  assert.equal(shownDone(3000, 3000), 2970); assert.equal(shownDone(10, 3000), 10);
});

test('the store: the status bar and the sweep stop short of full, and the result is read under its own words before the run shows', async () => {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    const app = M.createMockApp({ doc: { ...M.sampleDoc(), ghosts: [], scenes: [] }, keys: false }), tr = T.trackingFor(app);
    tr.path = tr.videoPath;   // openVideo runs from an effect, which the server build does not run
    const seen = {};
    const t = Array.from({ length: 90 }, (_, i) => Math.round((i * 1000) / 30));
    app.backend.sidecar = async (q, h) => {
      if (q.cmd !== 'track') return { result: null, error: null, cancelled: true };
      h.onEvent({ type: 'progress', done: 90, total: 90, stage: 'points' });
      seen.points = { label: tr.progressLabel, frac: tr.progressFrac, bar: app.tasks.map((k) => k.done / k.total) };
      h.onFrames(t.map((ms) => ({ t_ms: ms, value: 0.5, overlay: null })));
      const result = { type: 'result', samples: t.map((ms) => [ms, 0.5 + 0.4 * Math.sin(ms / 200)]), points: [{ at: 0, pos: 10 }, { at: 2900, pos: 90 }], scenes: [{ start_ms: 0, end_ms: 3000, sign: 1 }], notes: [], channels: {} };
      h.onEvent(result);
      seen.result = { label: tr.progressLabel, busy: tr.busy, runs: tr.runs.length };
      return { result, error: null, cancelled: false };
    };
    const r = await tr.runTrack({ id: 'fake.box', name: 'Fake box', params: [] }, { start: 0, end: 3000 }, {}, { kind: 'box', x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, [], { check: false });
    assert.deepEqual(seen.points, { label: '99 % · making points', frac: 0.99, bar: [0.99] });
    assert.deepEqual(seen.result, { label: '99 % · reading the result', busy: 'track', runs: 0 }, 'the job is still on, under its own words, until the run is made');
    assert.ok(r.run && tr.runs.length === 1 && !tr.busy, 'then the run is on the timeline and the job is over');
  } finally { await server.close(); }
});
