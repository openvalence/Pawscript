// paw-pq6b: the owner's app logged "Cannot read properties of undefined (reading 'flatMap') in $effect in DraftChip.svelte
// in StatusBar.svelte": the tracking store's always-on effects were made by the first component that asked for the store,
// the status bar's Draft chip (draftFor -> trackingApi -> trackingFor), so they lived under that chip's svelte:boundary (one
// throw tore the chip down) and every later error read as the status bar's. Now features/*/boot.js runs once in bootApp,
// before the shell mounts: the store is made there, its project blocks registered before any project loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('boot: the tracking store is a boot plug-in (made outside every component, its project blocks registered); the Draft store reaches the same one', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const P = await server.ssrLoadModule('/src/app/plugins.js');
    const boot = P.boots.find((b) => b.feature === 'tracking');
    assert.ok(boot && typeof boot.run === 'function', 'features/tracking/boot.js is discovered');
    assert.deepEqual(P.problems.filter((p) => p.includes('/boot')), [], 'no boot plug-in failed to load');
    const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    const app = M.createMockApp({ keys: false });
    assert.equal(T.peekTracking(app), null);
    boot.run(app);
    assert.ok(T.peekTracking(app), 'made by the boot plug-in');
    for (const k of ['tracking', 'runs', 'links', 'loopLinks']) assert.ok(app.blocks.has(k), `block ${k} registered at boot`);
    // the Draft chip's store reaches the same tracking store, never a second one
    const D = await server.ssrLoadModule('/src/features/draft/draft.svelte.js');
    const d = D.draftFor(app);
    assert.equal(d.busy, false);
    assert.equal(T.trackingFor(app), T.peekTracking(app));
  } finally { await server.close(); }
});
