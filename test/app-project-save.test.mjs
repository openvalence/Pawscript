// Lost saves (paw-xeb): app.project.save end to end against the mock backend. project.svelte.js is a .svelte.js
// module, loaded through vite's SSR transform (no server, no browser), like test/tracking-runs-file.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const VIDEO = 'C:/videos/sample.mp4', PROJ = 'C:/videos/sample.pawproj';
let server, M, P, CMDS;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  P = await server.ssrLoadModule('/src/app/project.svelte.js');
  CMDS = (await server.ssrLoadModule('/src/app/project-commands.js')).default;
});
after(() => server?.close());

/** A dirty video document without a project (as after opening a video); toasts collected. */
function setup({ doc = {} } = {}) {
  const be = M.mockBackend();
  const app = M.createMockApp({ backend: be, doc: { ...M.sampleDoc({ minutes: 1 }), ...doc }, keys: false });
  const toasts = [];
  app.toast = (msg, kind = 'info') => { toasts.push({ msg, kind }); };
  app.project = P.createProject(app);
  app.history.markDirty();
  const dialogs = [];
  be.saveDialog = async (o) => { dialogs.push(o); return o.defaultPath; };
  return { be, app, project: app.project, toasts, dialogs };
}

test('Ctrl+S on a video without a project writes <video stem>.pawproj beside the video, no dialog; the next save goes there too', async () => {
  const { be, app, project, dialogs } = setup();
  assert.equal(await project.save(), true);
  assert.deepEqual(dialogs, []);
  assert.equal(project.path, PROJ);
  assert.ok(be.files.has(PROJ));
  assert.equal(app.doc.dirty, false);
  app.history.markDirty();
  assert.equal(await project.save(), true);
  assert.deepEqual(dialogs, []);
  assert.equal(app.doc.dirty, false);
});

test('a .pawproj already beside the video is not taken over silently: Save As opens on that path', async () => {
  const { be, project, dialogs } = setup();
  be.files.set(PROJ, '{"other":"project"}');
  be.saveDialog = async (o) => { dialogs.push(o); return null; };   // cancelled
  assert.equal(await project.save(), false);
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].defaultPath, PROJ);
  assert.equal(be.files.get(PROJ), '{"other":"project"}');
  assert.equal(project.path, null);
});

test('Save while another save / open / export runs is not swallowed: the command stays enabled and save() warns, dirty stays', async () => {
  const { be, app, project, toasts } = setup({ doc: { project: { path: PROJ } } });
  const cmd = CMDS.find((c) => c.id === 'file.save');
  let release;
  const write = be.writeWithBackup.bind(be);
  const gate = new Promise((r) => { release = r; });
  be.writeWithBackup = async (...a) => { await gate; return write(...a); };
  const first = project.save();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(project.busy, 'save');
  assert.equal(cmd.when(app), true, 'Ctrl+S must reach save() while busy');
  assert.equal(await project.save(), false);
  const warn = toasts.find((t) => /not saved/i.test(t.msg));
  assert.ok(warn && (warn.kind === 'warn' || warn.kind === 'error'), JSON.stringify(toasts));
  release();
  assert.equal(await first, true);
  assert.equal(app.doc.dirty, false);
});

test('an autosave in flight when a save completes leaves no stale snapshot behind (no "Recover unsaved work?" for a saved document)', async () => {
  const { be, project } = setup({ doc: { project: { path: PROJ } } });
  let release;
  const write = be.autosaveWrite.bind(be);
  const gate = new Promise((r) => { release = r; });
  be.autosaveWrite = async (o) => { await gate; return write(o); };
  const snap = project.flushAutosave();
  await new Promise((r) => setTimeout(r, 10));
  const saved = project.save();
  await new Promise((r) => setTimeout(r, 10));
  release();
  be.autosaveWrite = write;
  await snap;
  assert.equal(await saved, true);
  assert.deepEqual((await be.autosaveList()).filter((c) => c.unsaved_work), []);
});

test('every save failure is an error toast naming the file and the reason; dirty stays', async () => {
  const { be, app, project, toasts } = setup({ doc: { project: { path: PROJ } } });
  be.writeWithBackup = async (p) => { throw Object.assign(new Error(`${p}: W:\\Videos is read-only for Pawscript`), { code: 'protected' }); };
  assert.equal(await project.save(), false);
  const t = toasts.find((x) => x.kind === 'error');
  assert.ok(t && /sample\.funscript|sample\.pawproj/.test(t.msg) && /read-only/.test(t.msg), JSON.stringify(toasts));
  assert.equal(app.doc.dirty, true);
});
