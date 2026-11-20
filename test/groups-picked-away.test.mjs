// Suggest picked another frame of the take: since paw-o74b every frame of the take paints (onFrame is true off the seed
// frames), so the Groups notes card's "Suggest picked frame N (k parts vs m here) · Go there" hung on !onFrame never showed.
// G.pickedAway says it: the pick while the frame on screen is another one, null on the picked frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normScenes } from '../src/features/timeline/shots.js';

test('groups pickedAway: Suggest\'s pick away from the frame on screen; gone on its frame', async () => {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js'), GS = await server.ssrLoadModule('/src/features/tracking/groups.svelte.js');
    const T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    const app = M.createMockApp({ doc: { ...M.sampleDoc(), scenes: normScenes([{ start_ms: 0, end_ms: 10000 }]), ghosts: [] }, keys: false, backend: M.mockBackend() });
    app.tracking = T.trackingFor(app); app.mode = 'track';
    const at = (t) => { app.player.seek?.(t); if (app.player.timeMs !== t) app.player.timeMs = t; };
    at(4500);
    const G = GS.groupsFor(app);
    G.toggle(true);
    assert.equal(G.pickedAway, null, 'no Suggest yet');
    G.picked = { t: 6000, parts: 5, here: 3, from: 4500 };
    assert.equal(G.onFrame, true, 'every frame of the take paints (paw-o74b): onFrame cannot say it');
    assert.deepEqual(G.pickedAway, G.picked, 'off the picked frame: the pick');
    at(6000);
    assert.equal(G.pickedAway, null, 'on the picked frame: nothing to say');
  } finally { await server.close(); }
});
