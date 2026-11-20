// paw-xn04: the project page's model (src/app/home.js) and the autosave rules behind it (project.svelte.js through vite's
// SSR transform, like test/app-project-save.test.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { summarize, thumbTime, thumbKey, homeCards, stateLine, shortDir } from '../src/app/home.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, P;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  P = await server.ssrLoadModule('/src/app/project.svelte.js');
});
after(() => server?.close());

// ---------- model ----------
const S = (a, b, x = {}) => ({ start_ms: a, end_ms: b, ...x });
const doc = {
  media: { path: 'C:/v/a.mp4', durationMs: 20000 },
  scenes: [S(0, 4000), S(4000, 8000, { join: true }), S(8000, 12000, { tags: ['offscreen'] }), S(12000, 20000)],
  axes: { stroke: [{ at: 4000, pos: 0 }, { at: 5000, pos: 100 }, { at: 6000, pos: 0 }, { at: 13000, pos: 100 }, { at: 14000, pos: 0 }], roll: [], twist: [{ at: 0, pos: 50 }] },
};
const links = { v: 1, scenes: [{ t0: 12000, t1: 20000, run: 'r1', channel: 'primary' }] };

test('summarize: scenes (joined shots are one), tracked shots by links, points, coverage of the busy (not off-screen) time, axes with points', () => {
  const s = summarize(doc, { links });
  assert.deepEqual({ ...s, coverage: Math.round(s.coverage * 1000) / 1000 }, { durationMs: 20000, scenes: 3, shots: 4, tracked: 1, points: 6, coverage: 0.188, axes: ['stroke', 'twist'] });
  assert.equal(summarize({ ...doc, project: { extra: { links } } }).tracked, 1, 'links read from the document when not given');
  assert.deepEqual(stateLine(s), ['3 scenes', '1 / 4 shots tracked', '6 points', '19 % covered', 'stroke + twist']);
  assert.deepEqual(stateLine(summarize({ media: { durationMs: 1000 }, axes: { stroke: [] } })), ['no points yet']);
});

test('thumbTime: middle of the first tracked shot, else of the first shot with points, else 10 % in', () => {
  assert.equal(thumbTime(doc, { links }), 16000);
  assert.equal(thumbTime(doc), 6000);
  assert.equal(thumbTime({ media: { durationMs: 50000 }, axes: {} }), 5000);
});

test('thumbKey: the project path + the video size and mtime; a replaced video gets a new key', () => {
  const k = thumbKey('C:/v/a.pawproj', { size: 10, mtime_ms: 5 });
  assert.match(k, /^[0-9a-f]{16}$/);
  assert.equal(thumbKey('c:\\V\\A.pawproj', { size: 10, mtime_ms: 5 }), k, 'case and slash insensitive');
  assert.notEqual(thumbKey('C:/v/a.pawproj', { size: 11, mtime_ms: 5 }), k);
  assert.notEqual(thumbKey('C:/v/a.pawproj', { size: 10, mtime_ms: 6 }), k);
  assert.notEqual(thumbKey('C:/v/b.pawproj', { size: 10, mtime_ms: 5 }), k);
});

test('homeCards: newest first, pinned on top; a project folds its video entry; unsaved autosaves are cards matched by project / base or on their own', () => {
  const recent = [
    { path: 'C:/v/a.pawproj', kind: 'project', video: 'C:/v/a.mp4', openedAt: 100 },
    { path: 'C:/v/a.mp4', kind: 'video', openedAt: 90 },
    { path: 'C:/v/b.mp4', kind: 'video', openedAt: 50, summary: { points: 3 } },
    { path: 'C:/v/c.mp4', kind: 'video', openedAt: 10, pinned: true },
  ];
  const autos = [
    { id: 'u-1', project_path: null, base: 'C:/v/b.mp4', updated_ms: 200 },
    { id: 'u-2', project_path: null, base: 'C:/v/d.mp4', video: 'C:/v/d.mp4', updated_ms: 150, summary: { points: 9 } },
    { id: 'p-1', project_path: 'C:/v/a.pawproj', updated_ms: 120 },
  ];
  const c = homeCards(recent, autos);
  assert.deepEqual(c.map((x) => [x.name, x.kind, x.unsaved, x.autosave?.id ?? null]), [
    ['c.mp4', 'video', false, null],
    ['b.mp4', 'video', true, 'u-1'],
    ['d.mp4', 'unsaved', true, 'u-2'],
    ['a.mp4', 'project', false, 'p-1'],
  ]);
  assert.equal(c[1].openedAt, 200, 'an autosave makes its card recent');
  assert.deepEqual(c[1].summary, { points: 3 });
  assert.equal(c[2].path, 'C:/v/d.mp4');
  // removed from the list: the entry goes, its unsaved autosave still shows (until saved or discarded)
  const c2 = homeCards(recent.filter((e) => e.path !== 'C:/v/b.mp4'), autos);
  assert.ok(c2.some((x) => x.autosave?.id === 'u-1' && x.unsaved));
  // a video entry with unsaved work of its own beside its project stays
  assert.equal(homeCards(recent, [{ id: 'u-9', project_path: null, base: 'C:/v/a.mp4', updated_ms: 1 }]).filter((x) => x.name === 'a.mp4').length, 2);
  assert.equal(shortDir('W:\\Videos\\set\\sub\\x.mp4'), 'W:\\…\\set\\sub');
  assert.equal(shortDir('C:/v/x.mp4'), 'C:\\v');
});

// ---------- autosave rules (project.svelte.js) ----------
const A = 'C:/videos/a.mp4', B = 'C:/videos/b.mp4';
function setup() {
  const be = M.mockBackend();
  be.files.set(A, 'video a'); be.files.set(B, 'video b');
  const app = M.createMockApp({ backend: be, doc: { axes: { stroke: [] } }, keys: false });
  app.toast = () => {};
  app.project = P.createProject(app);
  return { be, app, project: app.project };
}
const edit = (app, at) => app.edit('Add point', 'stroke', [...(app.doc.axes.stroke || []), { at, pos: 50 }]);
const baseOf = async (be, c) => JSON.parse(await be.readText(c.snapshots[0].path)).pawscriptAutosaveOf;

test('paw-up1r: two videos each get their own project beside them; switching asks nothing; both are in the recents', async () => {
  const { be, app, project } = setup();
  let asked = 0;
  app.choose = async () => { asked++; return null; };
  assert.equal(await project.openVideo(A, { force: true }), true);
  edit(app, 1000);
  assert.equal(await project.openVideo(B), true);   // A is written on the way out
  edit(app, 2000);
  assert.equal(await project.flushAutosave(), true);
  assert.equal(asked, 0);
  assert.deepEqual(JSON.parse(be.files.get('C:/videos/a.pawproj')).axes.stroke, [[1000, 50]]);
  assert.deepEqual(JSON.parse(be.files.get('C:/videos/b.pawproj')).axes.stroke, [[2000, 50]]);
  assert.equal((await be.autosaveList()).length, 0, 'no app-data snapshot: the projects hold the work');
  assert.deepEqual(project.recent.filter((e) => e.kind === 'project').map((e) => [e.path, e.summary?.points]), [['C:/videos/b.pawproj', 1], ['C:/videos/a.pawproj', 1]]);
});

test('a write in flight when another video opens finishes against ITS document (no other video\'s runs in its place)', async () => {
  const { be, app, project } = setup();
  const log = [];
  app.registerBlock('probe', { save: () => null, load: () => {}, saved: async (a, path) => { log.push([path, a.doc.media?.path]); } });
  await project.openVideo(A, { force: true });
  edit(app, 1000);
  let release;
  const write = be.writeWithBackup.bind(be), gate = new Promise((r) => { release = r; });
  be.writeWithBackup = async (...x) => { await gate; return write(...x); };
  const flushing = project.flush();
  const opening = project.openVideo(B, { force: true });
  await new Promise((r) => setTimeout(r, 20));
  release();
  assert.equal(await flushing, true);
  assert.equal(await opening, true);
  assert.equal(log.length, 1);
  assert.deepEqual(log[0], ['C:/videos/a.pawproj', A], `the blocks' files of A's write were written with ${log[0][1]} loaded`);
  assert.equal(app.doc.media.path, B);
});

test('a project that cannot be written keeps the work in app data; its card opens it without a question; discard needs a confirmation', async () => {
  const { be, app, project } = setup();
  be.writeWithBackup = async () => { const e = new Error('disk full'); e.code = 'io'; throw e; };
  await project.openVideo(A, { force: true });
  edit(app, 1234);
  assert.equal(await project.flush(), false);
  assert.match(project.writeError, /disk full/);
  // paw-f4i2: a tab closed by hand stays while only app data has its work (it says so); Close anyway closes it
  assert.equal(await project.close(), false);
  assert.equal(app.doc.media?.path, A);
  await project.close({ anyway: true });
  assert.equal(app.doc.media, null);
  let asked = 0;
  app.choose = async () => { asked++; return null; };
  assert.equal(await project.openPaths([A], { recover: true }), true);
  assert.equal(asked, 0);
  assert.deepEqual(app.doc.axes.stroke.map((p) => p.at), [1234]);
  assert.equal(app.doc.dirty, true);
  await project.close({ anyway: true });
  const [cand] = (await be.autosaveList()).filter((c) => c.unsaved_work);
  assert.equal(await project.restoreAutosave(cand.id), true);
  assert.deepEqual(app.doc.axes.stroke.map((p) => p.at), [1234]);
  await project.close({ anyway: true });
  const [c2] = (await be.autosaveList()).filter((c) => c.unsaved_work);
  app.confirm = async () => false;
  assert.equal(await project.discardAutosave(c2.id, 'a.mp4'), false);
  assert.equal((await be.autosaveList()).length, 1, 'kept when not confirmed');
  app.confirm = async () => true;
  assert.equal(await project.discardAutosave(c2.id, 'a.mp4'), true);
  assert.equal((await be.autosaveList()).length, 0);
});

test('Clear undo history keeps a never-saved document unsaved', async () => {
  const { app, project } = setup();
  await project.openVideo(A, { force: true });
  edit(app, 1000);
  assert.equal(app.doc.dirty, true);
  app.history.reset();
  assert.equal(app.doc.dirty, true);
});

test('a change that is not an undo step, made while the save runs, keeps the document dirty', async () => {
  const { be, app, project } = setup();
  await project.openVideo(A, { force: true });
  edit(app, 1000);
  let release;
  const write = be.writeWithBackup.bind(be), gate = new Promise((r) => { release = r; });
  be.writeWithBackup = async (...a) => { await gate; return write(...a); };
  const saving = project.save();
  await new Promise((r) => setTimeout(r, 20));
  app.doc.ghosts = [...app.doc.ghosts, { id: 'run9', name: 'run 9', script: [{ at: 0, pos: 0 }, { at: 500, pos: 100 }], visible: true, source: { kind: 'tracker' } }];
  release();
  assert.equal(await saving, true);
  assert.equal(app.doc.dirty, true);
});
