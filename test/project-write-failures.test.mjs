// paw-f4i2: a write that fails, in each way (read-only, disk full, locked, path gone) at each point (the project, its runs,
// its undo stack, a checkpoint, a published funscript), never loses work: the work goes to an app-data snapshot that is
// read back; a tab or the app does not close while the work is kept nowhere else; the next open applies the snapshot.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, P, W;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  P = await server.ssrLoadModule('/src/app/project.svelte.js');
  W = await server.ssrLoadModule('/src/app/writing.svelte.js');
});
after(() => server?.close());

const VIDEO = 'C:/clips/gen.mp4', PROJ = 'C:/clips/gen.pawproj', HIST = 'C:/clips/gen.pawhistory';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const projectText = (extra = {}) => JSON.stringify({ format: 'pawproj', version: 3, media: { path: VIDEO, name: 'gen.mp4', durationMs: 60000, fps: 30 }, axes: { stroke: [[1000, 0], [1500, 100], [2000, 0]] }, ...extra }, null, 2);
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const KINDS = { 'read-only': 'permission_denied', 'disk full': 'io', locked: 'sharing_violation', 'path gone': 'not_found' };
const fail = (what) => { const e = new Error(what); e.code = KINDS[what] || 'io'; return e; };

function mkApp(be, storage = memStorage()) {
  const app = M.createMockApp({ backend: be, storage, doc: {}, keys: false });
  const toasts = [];
  app.toast = (msg, kind, opts) => { toasts.push({ msg, kind, opts }); return toasts.length; };
  app.project = P.createProject(app);
  return { app, toasts, project: app.project };
}
async function opened(be = M.mockBackend(), text = projectText()) {
  if (!be.files.has(VIDEO)) be.files.set(VIDEO, 'v');
  if (!be.files.has(PROJ)) be.files.set(PROJ, text);
  const x = mkApp(be);
  assert.equal(await x.project.openProject(PROJ), true);
  return { be, ...x };
}
const addPoint = (app, at = 3000) => app.edit('Add point', 'stroke', [...app.doc.axes.stroke, { at, pos: 50 }]);
const failProject = (be, what) => { const w = be.writeWithBackup.bind(be); be.writeWithBackup = async (p, ...x) => { if (p === PROJ) throw fail(what); return w(p, ...x); }; return () => { be.writeWithBackup = w; }; };
const pts = (app) => app.doc.axes.stroke.map((p) => p.at);

for (const what of Object.keys(KINDS)) {
  test(`the project cannot be written (${what}): the work is read back from app data; the tab stays; quit goes; the next open applies it`, async () => {
    const { be, app, toasts, project } = await opened();
    const restore = failProject(be, what);
    addPoint(app);
    assert.equal(await project.flush(), false);
    assert.match(project.writeError, new RegExp(what));
    assert.ok(project.keptIn, 'the snapshot it read back');
    assert.equal(be.files.get(project.keptIn).includes('3000'), true, 'the snapshot holds the edit');
    assert.ok(toasts.some((t) => /kept in app data/.test(t.msg)));
    assert.equal(app.doc.dirty, true, 'still dirty: retried');
    // a tab closed by hand stays and says where the work is; Retry and Save a copy to… are offered
    assert.equal(await project.close(), false);
    assert.deepEqual(pts(app), [1000, 1500, 2000, 3000]);
    const held = toasts.at(-1);
    assert.match(held.msg, /was not closed: .*kept in app data/);
    assert.deepEqual([held.opts.action.label, ...held.opts.actions.map((a) => a.label)], ['Retry', 'Save a copy to…', 'Close anyway']);
    // quitting: the work is in app data, the app may go
    assert.equal(await project.close({ quit: true }), true);
    // a new start: the project opens with the snapshot applied; the file as it was is a checkpoint at the first write
    restore();
    const again = mkApp(be);
    assert.equal(await again.project.openProject(PROJ), true);
    assert.deepEqual(pts(again.app), [1000, 1500, 2000, 3000]);
    assert.equal(await again.project.flush(), true);
    assert.deepEqual(JSON.parse(be.files.get(PROJ)).axes.stroke.map((p) => p[0]), [1000, 1500, 2000, 3000]);
    const asOpened = again.project.checkpoints.find((c) => /^As opened/.test(c.label));
    assert.deepEqual(JSON.parse(be.files.get(`${HIST}/${asOpened.id}.pawproj`)).axes.stroke.map((p) => p[0]), [1000, 1500, 2000], 'the file as it was is a checkpoint');
    assert.equal((await be.autosaveList()).length, 0, 'the snapshot goes once the project holds the work');
  });
}

test('the project cannot be written and app data neither: no close (tab or app); Retry writes and closes; Save a copy to… writes a copy', async () => {
  const { be, app, toasts, project } = await opened();
  const restore = failProject(be, 'disk full');
  const snap = be.autosaveWrite.bind(be);
  be.autosaveWrite = async () => { throw fail('disk full'); };
  addPoint(app);
  assert.equal(await project.flush(), false);
  assert.equal(project.keptIn, '');
  assert.ok(toasts.some((t) => /could not be kept in app data either/.test(t.msg)), 'never "kept in app data" unchecked');
  assert.equal(await project.close(), false);
  assert.equal(await project.close({ quit: true }), false);
  assert.equal(project.unsaved, true);
  assert.match(toasts.at(-1).msg, /Pawscript did not close: gen.pawproj could not be written \(disk full\)/);
  // the whole app close: held, the window stays, the shell's held close is let go
  let closedWin = 0, cancelled = 0;
  be.windowCloseNow = async () => { closedWin++; };
  be.closeCancel = async () => { cancelled++; };
  await W.closeApp(app);
  assert.equal(closedWin, 0);
  assert.equal(cancelled, 1);
  assert.deepEqual(pts(app), [1000, 1500, 2000, 3000]);
  // Save a copy to…: the one save dialog; the copy counts as kept, so the tab may close
  be.saveDialog = async () => 'D:/rescue/copy';
  assert.equal(await project.saveCopy(), true);
  assert.deepEqual(JSON.parse(be.files.get('D:/rescue/copy.pawproj')).axes.stroke.map((p) => p[0]), [1000, 1500, 2000, 3000]);
  assert.equal(project.unsaved, false);
  // Retry once it can be written: written, the held close goes on
  restore(); be.autosaveWrite = snap;
  addPoint(app, 4000);
  assert.equal(await project.retryWrite({ close: 'tab' }), true);
  assert.deepEqual(JSON.parse(be.files.get(PROJ)).axes.stroke.map((p) => p[0]), [1000, 1500, 2000, 3000, 4000]);
  assert.equal(app.doc.media, null, 'closed after the retry');
});

test('once written again, the failure and held-close messages go away', async () => {
  const { be, app, toasts, project } = await opened();
  const gone = [];
  app.dismiss = (id) => gone.push(id);
  const restore = failProject(be, 'locked');
  addPoint(app);
  await project.flush();
  assert.equal(await project.close(), false);
  const ids = toasts.map((t, i) => (/Could not write|was not closed/.test(t.msg) ? i + 1 : null)).filter(Boolean);
  assert.equal(ids.length, 2);
  restore();
  assert.equal(await project.flush(), true);
  assert.deepEqual(gone.sort(), ids.sort());
});

test('a snapshot that does not read back the same is not "kept": the close is held', async () => {
  const { be, app, project } = await opened();
  failProject(be, 'disk full');
  const read = be.readText.bind(be);
  be.readText = async (p) => (/mock-autosave/.test(p) ? '{}' : read(p));
  addPoint(app);
  await project.flush();
  assert.equal(project.keptIn, '');
  assert.equal(await project.close({ quit: true }), false);
});

test('the runs (a block\'s file) cannot be written: a failed write, the work goes to app data, the next open applies it', async () => {
  const be = M.mockBackend();
  const { app, project } = await opened(be);
  let broken = true;
  app.registerBlock('runs', { save: () => null, load: () => {}, saved: async () => { await tick(); if (broken) throw fail('locked'); } });
  addPoint(app);
  await tick();   // the snapshot is newer than the project file (ms clock)
  assert.equal(await project.flush(), false);
  assert.match(project.writeError, /runs: locked/);
  assert.equal(app.doc.dirty, true);
  assert.ok(project.keptIn);
  assert.equal(await project.close(), false);
  assert.equal(await project.close({ quit: true }), true);
  const again = mkApp(be);
  assert.equal(await again.project.openProject(PROJ), true);
  assert.deepEqual(pts(again.app), [1000, 1500, 2000, 3000]);
  assert.equal(again.app.doc.dirty, true, 'written at the next tick');
  broken = false;
});

test('the undo stack or a checkpoint cannot be written: the document is in its file, the tab closes, the next open has it', async () => {
  const { be, app, project } = await opened();
  const wt = be.writeText.bind(be);
  be.writeText = async (p, s) => { if (p.startsWith(HIST)) throw fail('read-only'); return wt(p, s); };
  addPoint(app);
  assert.equal(await project.flush(), true);
  assert.equal(await project.close(), true);
  const again = mkApp(be);
  assert.equal(await again.project.openProject(PROJ), true);
  assert.deepEqual(pts(again.app), [1000, 1500, 2000, 3000]);
});

test('Publish: a funscript or the project record failing publishes nothing and takes no version number', async () => {
  const { be, app, toasts, project } = await opened();
  const w = be.writeWithBackup.bind(be);
  let failAt = /\.funscript$/;
  be.writeWithBackup = async (p, ...x) => { if (failAt?.test(p)) throw fail('read-only'); return w(p, ...x); };
  assert.equal(await project.publish(), false);
  assert.equal(project.published, null);
  failAt = /\.pawproj$/;   // the funscripts are written, the project cannot record v1
  assert.equal(await project.publish(), false);
  assert.equal(project.published, null, 'v1 not taken');
  assert.match(toasts.at(-1).msg, /^Not published: .*could not record v1/);
  assert.ok(!toasts.some((t) => /^Published v/.test(t.msg)));
  assert.equal(project.checkpoints.some((c) => c.kind === 'publish'), false);
  failAt = null;
  assert.equal(await project.publish(), true);
  assert.equal(project.published.version, 1, 'the number not taken is used now');
  assert.equal(JSON.parse(be.files.get(PROJ)).published?.version, 1);
});

test('the publish entry and a checkpoint asked for meanwhile both land in the history index (one write queue)', async () => {
  const { be, project } = await opened();
  const wt = be.writeText.bind(be);
  let slow = true;
  be.writeText = async (p, s) => { if (slow && p.endsWith('index.json')) { slow = false; await tick(30); } return wt(p, s); };
  const pub = project.publish();
  await tick(1);
  const cp = project.checkpoint('Meanwhile');
  assert.equal(await pub, true);
  await cp;
  const idx = JSON.parse(be.files.get(`${HIST}/index.json`)).checkpoints.map((c) => c.kind === 'publish' ? 'publish' : c.label);
  assert.ok(idx.includes('publish'), JSON.stringify(idx));
  assert.deepEqual(idx.filter((x) => x === 'publish').length, 1);
});

test('commit while busy is refused, said', async () => {
  const { toasts, project } = await opened();
  project.busy = 'publish';
  assert.equal(await project.commit({ note: 'x' }), null);
  assert.match(toasts.at(-1).msg, /Not committed: still busy/);
  project.busy = '';
});

test('opening through the app-data branch loads the history and the published version: the next write keeps them', async () => {
  const be = M.mockBackend();
  be.files.set(VIDEO, 'v');
  be.files.set(PROJ, projectText({ published: { v: 1, version: 2, commit: null, at: 5, key: 'k' } }));
  be.files.set(`${HIST}/index.json`, JSON.stringify({ v: 1, checkpoints: [{ id: '100', at: 100, label: 'Commit', kind: 'commit', auto: false }] }));
  be.files.set(`${HIST}/100.pawproj`, projectText());
  // newer work in app data
  const first = mkApp(be);
  assert.equal(await first.project.openProject(PROJ), true);
  const restore = failProject(be, 'disk full');
  addPoint(first.app);
  await first.project.flush();
  assert.ok(first.project.keptIn);
  await first.project.close({ quit: true });
  restore();
  const { app, project } = mkApp(be);
  assert.equal(await project.openProject(PROJ), true);
  assert.deepEqual(pts(app), [1000, 1500, 2000, 3000]);
  assert.equal(project.published?.version, 2);
  assert.ok(project.checkpoints.some((c) => c.id === '100'));
  assert.equal(await project.flush(), true);
  const pd = JSON.parse(be.files.get(PROJ));
  assert.equal(pd.published?.version, 2, 'the published block is kept');
  assert.ok(JSON.parse(be.files.get(`${HIST}/index.json`)).checkpoints.some((c) => c.id === '100'));
});

test('an automatic checkpoint of the same document with other runs adds an entry: the older runRefs stay kept', async () => {
  const { app, project } = await opened();
  let refs = { r1: 'h1' };
  app.registerBlock('runs', { save: () => null, load: () => {}, refs: () => refs });
  await project.checkpoint('One');
  refs = { r1: 'h2' };
  await project.checkpoint('Two');
  assert.deepEqual(project.runRefsKept().sort(), ['h1', 'h2']);
});
