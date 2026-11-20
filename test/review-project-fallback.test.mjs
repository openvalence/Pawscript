// [review] a project write that fails must leave the work in an app-data snapshot (the toast promises it), and closing
// the document must not lose it.
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

const VIDEO = 'C:/clips/gen.mp4', PROJ = 'C:/clips/gen.pawproj';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const projectText = () => JSON.stringify({ format: 'pawproj', version: 3, media: { path: VIDEO, name: 'gen.mp4', durationMs: 60000, fps: 30 }, axes: { stroke: [[1000, 0], [1500, 100], [2000, 0]] } }, null, 2);

test('a failed write of an existing project makes an app-data snapshot; close keeps the work', async () => {
  const be = M.mockBackend();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  const app = M.createMockApp({ backend: be, storage: memStorage(), doc: {}, keys: false });
  const toasts = [];
  app.toast = (msg, kind) => toasts.push({ msg, kind });
  app.project = P.createProject(app);
  assert.equal(await app.project.openProject(PROJ), true);
  const write = be.writeWithBackup.bind(be);
  be.writeWithBackup = async (p, ...x) => { if (p === PROJ) { const e = new Error('disk full'); e.code = 'io'; throw e; } return write(p, ...x); };
  app.edit('Add point', 'stroke', [...app.doc.axes.stroke, { at: 3000, pos: 50 }]);
  const ok = await app.project.flush();
  assert.ok(toasts.some((t) => /kept in app data/.test(t.msg)), 'the toast promises app data');
  const okWas = ok; await app.project.close();
  const snaps = await be.autosaveList();
  assert.ok(snaps.length > 0, `no app-data snapshot after a failed write + close (flush returned ${JSON.stringify(okWas)})`);
});
