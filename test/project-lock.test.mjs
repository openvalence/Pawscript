// paw-vm6e: a project open in another Pawscript window is not written from a second one (no last-writer-wins): the second
// window says so plainly and keeps its changes in app data; once the first lets go (or its lock is stale), it writes.
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

const VIDEO = 'C:/clips/main.mp4', PROJ = 'C:/clips/main.pawproj', LOCK = 'C:/clips/main.pawhistory/lock.json';
const projectText = () => JSON.stringify({ format: 'pawproj', version: 3, media: { path: VIDEO, name: 'main.mp4', durationMs: 60000, fps: 30 }, axes: { stroke: [[1000, 0], [1500, 100], [2000, 0]] } });
// each window its own app (its own data folder) over one disk
const asApp = (be, dir) => { const b = Object.create(be); b.appPaths = async () => ({ data_dir: dir, cache_dir: dir + '/cache' }); return b; };
const win = async (be, dir = 'D:/one') => {
  const app = M.createMockApp({ backend: asApp(be, dir), doc: {}, keys: false });
  const toasts = [];
  app.toast = (m) => toasts.push(m);
  app.project = P.createProject(app);
  assert.equal(await app.project.openProject(PROJ), true);
  return { app, toasts, project: app.project };
};
const add = (app, at) => app.edit('Add point', 'stroke', [...app.doc.axes.stroke, { at, pos: 50 }]);
const onDisk = (be) => JSON.parse(be.files.get(PROJ)).axes.stroke.map((p) => p[0]);

test('the second window does not overwrite the first; it writes once the first closes', async () => {
  const be = M.mockBackend();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  const a = await win(be);
  assert.ok(be.files.has(LOCK), 'the first window holds the lock');
  assert.equal(a.project.readOnly, '');
  const b = await win(be, 'D:/two');
  assert.match(b.project.readOnly, /another Pawscript window/);
  assert.ok(b.toasts.some((m) => /open in another Pawscript window: this window does not write it/.test(m)));
  add(a.app, 3000);
  assert.equal(await a.project.flush(), true);
  add(b.app, 4000);
  assert.equal(await b.project.flush(), false);
  assert.deepEqual(onDisk(be), [1000, 1500, 2000, 3000], 'the first window\'s edit stays');
  assert.ok(b.project.keptIn, 'the second window\'s edit is in app data');
  assert.ok(!b.toasts.some((m) => /changed outside Pawscript/.test(m)));
  // the first window closes: the lock goes; the second takes it at its next check and writes
  assert.equal(await a.project.close(), true);
  assert.equal(be.files.has(LOCK), false);
  await b.project.checkLock();
  assert.equal(b.project.readOnly, '');
  assert.equal(await b.project.flush(), true);
  assert.ok(onDisk(be).includes(4000));
});

test('a lock this same app left (killed a moment ago) is taken at once', async () => {
  const be = M.mockBackend();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  be.files.set(LOCK, JSON.stringify({ id: 'killed-run', app: 'D:/one', at: Date.now() - 1000 }));
  const a = await win(be, 'D:/one');
  assert.equal(a.project.readOnly, '');
  add(a.app, 3000);
  assert.equal(await a.project.flush(), true);
});

test('a lock left by a crashed window (stale) does not stop the next one', async () => {
  const be = M.mockBackend();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  be.files.set(LOCK, JSON.stringify({ id: 'gone', at: Date.now() - 5 * 60_000 }));
  const a = await win(be);
  assert.equal(a.project.readOnly, '');
  add(a.app, 3000);
  assert.equal(await a.project.flush(), true);
});
