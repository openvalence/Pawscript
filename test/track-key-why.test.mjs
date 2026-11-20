// paw-u0ik: T (track.gridFrame) did nothing, silently, with no point tracker listed (a CPU-only install): its `when` was
// false, so no command took the key. With a video it now runs and says why, naming the CPU tracker and its key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T, C;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  C = (await server.ssrLoadModule('/src/features/tracking/commands.js')).default;
});
after(() => server?.close());

test('T with no point tracker says why and what to do instead', () => {
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 20000 }], ghosts: [] }, keys: false }), tr = T.trackingFor(app);
  app.loadBlocks({});
  tr.openVideo(app.doc.media?.path || null);
  app.mode = 'track';
  tr.trackers = [{ id: 'lk_box', name: 'Optical flow (box)', roi: 'box', params: [] }];
  const toasts = [];
  app.toast = (m) => toasts.push(String(m));
  const cmd = C.find((c) => c.id === 'track.gridFrame');
  assert.equal(tr.canGrid, false);
  assert.ok(cmd.when(app), 'T is taken (not a dead key)');
  cmd.run(app);
  assert.match(toasts.at(-1) || '', /needs a point tracker .*Optical flow \(box\).*Ctrl\+T/);
});
