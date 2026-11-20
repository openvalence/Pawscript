// paw-l64q: with the GPU turned off (the sidecar's probe: the card cannot be used) T picks no GPU point tracker for its grid:
// canGrid is false, T's message names the CPU route (quickbar.js gridBlock), nothing is selected or remembered.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T, Q;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  Q = await server.ssrLoadModule('/src/features/timeline/quickbar.js');
});
after(() => server?.close());

test('GPU off: no grid tracker, T says why and names the CPU route, nothing remembered; GPU fine: TAPNext++', () => {
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), media: { ...M.sampleDoc().media, path: 'C:/v/clip.mp4' } }, keys: false, backend: M.mockBackend() });
  app.toast = () => {};
  const tr = T.trackingFor(app);
  tr.trackers = [{ id: 'lk_box', name: 'Optical flow (box)', roi: 'box', params: [] }, { id: 'tapnext_points', name: 'TAPNext++', roi: 'box', gpu: true, params: [] }];
  tr.trackerId = 'lk_box';
  tr.gpu = { state: 'unsupported', name: 'NVIDIA GeForce GTX 980', reason: 'old' };
  const was = app.settings.get('tracking.lastTracker');
  assert.equal(tr.gridTracker, null);
  assert.equal(tr.canGrid, false);
  assert.match(Q.gridBlock(tr, 'Ctrl+T'), /needs a CUDA GPU.*Optical flow \(box\)/);
  tr.gridFrame();
  assert.equal(tr.trackerId, 'lk_box', 'not switched to TAPNext++');
  assert.equal(app.settings.get('tracking.lastTracker'), was, 'nothing remembered');
  tr.trackerId = 'tapnext_points';   // a greyed tracker left selected: not used either
  assert.equal(tr.gridTracker, null);
  tr.gpu = { state: 'ok' };
  assert.equal(tr.gridTracker?.id, 'tapnext_points', 'the GPU fine: TAPNext++');
  tr.destroy();
});
