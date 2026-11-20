// paw-qf5o: a project this install never wrote (an unpacked pack, a copy) opens and is written without a false "changed
// outside Pawscript" warning; a project that really changed on disk still says so; two tabs of one name each name their
// folder; a pack of a published project carries its published version.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, P, PK, TB;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  P = await server.ssrLoadModule('/src/app/project.svelte.js');
  PK = await server.ssrLoadModule('/src/app/pack.js');
  TB = await server.ssrLoadModule('/src/app/tabs.svelte.js');
});
after(() => server?.close());

const VIDEO = 'C:/clips/main.mp4', PROJ = 'C:/clips/main.pawproj';
const projectText = () => JSON.stringify({ format: 'pawproj', version: 3, media: { path: VIDEO, name: 'main.mp4', durationMs: 60000, fps: 30 }, axes: { stroke: [[1000, 0], [1500, 100], [2000, 0]] } });
async function opened() {
  const be = M.mockBackend();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  const app = M.createMockApp({ backend: be, doc: {}, keys: false });
  const toasts = [];
  app.toast = (msg) => toasts.push(msg);
  app.project = P.createProject(app);
  assert.equal(await app.project.openProject(PROJ), true);
  return { be, app, toasts };
}
const addPoint = (app, at) => app.edit('Add point', 'stroke', [...app.doc.axes.stroke, { at, pos: 50 }]);

test('the first write of a project this install never wrote keeps its .bak quietly; one changed on disk is said', async () => {
  const { be, app, toasts } = await opened();
  addPoint(app, 3000);
  assert.equal(await app.project.flush(), true);
  assert.ok(be.files.has(PROJ + '.bak'), 'the shell kept the original');
  assert.ok(!toasts.some((m) => /changed outside Pawscript/.test(m)), toasts.join(' | '));
  // another program changes it: that is said
  be.files.set(PROJ, be.files.get(PROJ).replace('3000', '3100'));
  addPoint(app, 4000);
  assert.equal(await app.project.flush(), true);
  assert.ok(toasts.some((m) => /changed outside Pawscript/.test(m)));
});

test('two tabs of one name each name their folder', () => {
  const mk = (path) => ({ tabId: path, project: { name: 'main.pawproj', key: path }, doc: { project: { path }, axes: {} } });
  const a = mk('C:/clips/main.pawproj'), b = mk('C:/clips/main-unpacked/main.pawproj'), c = { tabId: 'c', project: { name: 'other.pawproj', key: 'C:/x/other.pawproj' }, doc: { project: { path: 'C:/x/other.pawproj' }, axes: {} } };
  const self = { list: [a, b, c].map((x) => ({ app: x })), parked: {} };
  assert.equal(TB.Tabs.prototype.nameOf.call(self, a), 'main.pawproj · clips');
  assert.equal(TB.Tabs.prototype.nameOf.call(self, b), 'main.pawproj · main-unpacked');
  assert.equal(TB.Tabs.prototype.nameOf.call(self, c), 'other.pawproj');
});

test('a pack of a published project carries the published version', async () => {
  const { be, app } = await opened();
  be.files.set('C:/clips/main.funscript', JSON.stringify({ actions: [{ at: 1000, pos: 0 }], metadata: { pawscript: { publish: { version: 1 } } } }));
  app.doc.files = { stroke: { path: 'C:/clips/main.funscript' } };
  app.project.published = { version: 1, commit: null, at: 5, key: 'k' };
  be.appPaths = async () => ({ data_dir: 'D:/data', cache_dir: 'D:/cache' });
  let call = null;
  be.saveDialog = async () => 'C:/clips/main.pawpack';
  be.packWrite = (dest, manifest, entries) => { call = { manifest, entries }; return { promise: Promise.resolve({ path: dest, size: 1 }), cancel() {} }; };
  assert.equal(await PK.packProject(app), true);
  const proj = JSON.parse(call.entries.find((e) => e.role === 'project').text);
  assert.equal(proj.published?.version, 1);
});
