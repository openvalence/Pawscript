// paw-pjlg: the project card's summary counts the points as they play (baked + live runs), not the baked ones only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, P;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  P = await server.ssrLoadModule('/src/app/project.svelte.js');
});
after(() => server?.close());

test('a project whose points are all live runs is not "no points yet"', async () => {
  const be = M.mockBackend(), VIDEO = 'C:/clips/live.mp4', PROJ = 'C:/clips/live.pawproj';
  be.files.set(VIDEO, 'v');
  be.files.set(PROJ, JSON.stringify({ format: 'pawproj', version: 3, media: { path: VIDEO, name: 'live.mp4', durationMs: 60000, fps: 30 }, axes: {} }));
  const app = M.createMockApp({ backend: be, doc: {}, keys: false });
  app.toast = () => {};
  app.project = P.createProject(app);
  assert.equal(await app.project.openProject(PROJ), true);
  const live = Array.from({ length: 23 }, (_, i) => ({ at: 1000 + i * 300, pos: i % 2 ? 90 : 10 }));
  app.liveOf = (axis) => (axis === 'stroke' ? { script: live, spans: [{ t0: 1000, t1: 8000, kind: 'run' }] } : null);
  app.history.markDirty();
  assert.equal(await app.project.flush(), true);
  const card = app.project.recent.find((e) => e.path === PROJ);
  assert.equal(card.summary.points, 23);
});
