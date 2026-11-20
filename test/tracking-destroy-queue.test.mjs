// paw-vt22: closing a tab (the store's destroy) kills its running job AND the jobs already queued in its chain (an owner's
// camera check after a track, a panel job) never start on the sidecar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
});
after(() => server?.close());

test('destroy: the running job is killed, the queued ones (owner and panel) never reach the sidecar', async () => {
  const started = [];
  let release;
  const backend = { ...M.mockBackend(),
    sidecar: (req) => { started.push(req.cmd); return started.length > 1 ? Promise.resolve({ result: {}, error: null, cancelled: false }) : new Promise((res) => { release = () => res({ result: null, error: null, cancelled: true }); }); },
    cancelSidecar: () => release?.() };
  const app = M.createMockApp({ doc: M.sampleDoc(), keys: false, backend });
  app.toast = () => {};
  const tr = T.trackingFor(app);
  const a = tr.job('score', { cmd: 'track' }, { task: false });
  const b = tr.job('camera', { cmd: 'camera' }, { task: false, owner: 'camera' });
  const c = tr.job('describe', { cmd: 'describe' }, { task: false });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(started, ['track'], 'one at a time');
  tr.destroy();
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.equal(ra.cancelled, true, 'the running one killed');
  assert.deepEqual([rb.cancelled, rc.cancelled], [true, true]);
  assert.deepEqual(started, ['track'], 'nothing queued started after the tab closed');
});
