// paw-shgb stage 2: several documents open as tabs, one app each (createApp + project + feature stores), sharing one settings
// object, one backend and one Tabs. Two apps side by side share no timeline / tracking state; an edit in one never reaches the
// other's undo or files (a hidden tab's continuous write included); a track started in A lands in A while B is shown, B's list
// never cancels it and B's own Track is refused naming A; the open tabs come back after a restart. Through vite's SSR transform
// (like app-continuous.test.mjs); the tracker is test/fake-pawtrack.mjs (like track-add.test.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)), FAKE = fileURLToPath(new URL('./fake-pawtrack.mjs', import.meta.url));
let server, M, A, P, PC, TB, T, TR, TK, S;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  A = await server.ssrLoadModule('/src/app/app.svelte.js');
  P = await server.ssrLoadModule('/src/app/project.svelte.js');
  PC = await server.ssrLoadModule('/src/app/project-commands.js');
  TB = await server.ssrLoadModule('/src/features/timeline/boot.js');
  T = await server.ssrLoadModule('/src/features/timeline/state.svelte.js');
  TR = await server.ssrLoadModule('/src/features/timeline/transitions.svelte.js');
  TK = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  S = await server.ssrLoadModule('/src/lib/shown.svelte.js');
});
after(() => server?.close());

const VA = 'C:/clips/a.mp4', PA = 'C:/clips/a.pawproj', VB = 'C:/clips/b.mp4', PB = 'C:/clips/b.pawproj';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const projectText = (video, pts) => JSON.stringify({ format: 'pawproj', version: 3, media: { path: video, name: video.split('/').pop(), durationMs: 60000, fps: 30 }, axes: { stroke: pts },
  scenes: [{ start_ms: 0, end_ms: 20000 }, { start_ms: 20000, end_ms: 60000 }] }, null, 2);
const disk = (be, p) => JSON.parse(be.files.get(p));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FADE = { kind: 'fade-in', ts: 20000, tm: 20100, f0: 600, f1: 606 };

/** A window: its first app and Tabs.make for more, as boot.js builds them (the parts these tests need). */
function windowOn(be, storage) {
  const toasts = [];
  const mk = (opts) => {
    const app = A.createApp({ backend: be, storage, ...opts });
    app.toast = (msg, kind = 'info') => { toasts.push({ app, msg, kind }); };
    app.choose = async () => null;
    app.commands.register(PC.default, 'project');
    app.project = P.createProject(app);
    TB.default(app);
    return app;
  };
  const first = mk({});
  first.tabs.make = () => mk({ settings: first.settings, usage: first.usage, tabs: first.tabs });
  return { first, tabs: first.tabs, toasts };
}
const files = () => { const be = M.mockBackend(); be.files.set(VA, 'v'); be.files.set(VB, 'v'); be.files.set(PA, projectText(VA, [[1000, 0], [1500, 100]])); be.files.set(PB, projectText(VB, [[5000, 20], [5500, 80]])); return be; };

test('two documents are two apps: each its own timeline state, undo, playhead and view; `tl` is the shown one\'s', async () => {
  const be = files(), { tabs } = windowOn(be, memStorage());
  assert.ok(await tabs.open([PA]));
  const a = tabs.current;
  a.player.seek(4000); a.setView({ start: 2000, span: 8000 });
  T.tlFor(a).shots = [1]; T.tlFor(a).scene = 1; T.tlFor(a).timeMode = 'frames';
  assert.ok(await tabs.open([PB]));
  const b = tabs.current;
  assert.notEqual(a, b, 'B opened in a tab of its own, A stays open');
  assert.deepEqual(tabs.list.map((t) => t.app), [a, b]);
  assert.equal(tabs.active, b.tabId);
  assert.notEqual(T.tlFor(a), T.tlFor(b));
  assert.deepEqual([T.tlFor(a).shots, T.tlFor(a).scene, T.tlFor(a).timeMode], [[1], 1, 'frames'], "B's load did not reset A's selection");
  assert.equal(S.shown.app, b);
  assert.deepEqual(T.tl.shots, [], '`tl` is the shown tab\'s');
  T.tl.shots = [0];
  assert.deepEqual(T.tlFor(b).shots, [0]);
  assert.ok(tabs.show(a.tabId));
  assert.deepEqual(T.tl.shots, [1], 'switching back: A\'s selection');
  assert.deepEqual([Math.round(a.player.timeMs), a.view.start, a.view.span], [4000, 2000, 8000], "A's playhead and view kept");
  assert.equal(T.blockSave(a)?.timeMode, 'frames');
  assert.equal(T.blockSave(b), null);
  assert.notEqual(TK.trackingFor(a), TK.trackingFor(b));
  // opening the open project again only switches to it; its video too
  assert.ok(await tabs.open([PB]));
  assert.equal(tabs.current, b);
  tabs.show(a.tabId);
  assert.ok(await tabs.open([VB]));
  assert.equal(tabs.current, b, 'the video of an open project: its tab');
  assert.equal(tabs.list.length, 2);
});

test("an edit in A never reaches B's undo or files; a hidden tab's write keeps its own blocks", async () => {
  const be = files(), { tabs } = windowOn(be, memStorage());
  await tabs.open([PA]);
  const a = tabs.current;
  await tabs.open([PB]);
  const b = tabs.current;
  TR.adoptTransitions(VA, [FADE]);   // A's fade, found by its pass
  TR.adoptTransitions(VB, []);       // B shown: its pass came back empty
  const before = be.files.get(PB);
  a.edit('Add point', 'stroke', [...a.doc.axes.stroke, { at: 3000, pos: 40 }]);
  assert.equal(a.history.entries.length, 1);
  assert.equal(b.history.entries.length, 0, "B's undo is its own");
  assert.equal(b.doc.dirty, false);
  assert.equal(await a.project.flush(), true, 'hidden A is written');
  await b.project.flush();
  assert.deepEqual(disk(be, PA).axes.stroke.map((x) => x[0]), [1000, 1500, 3000]);
  assert.deepEqual(disk(be, PA).transitions?.list?.map((x) => x.ts), [20000], "A's fades in A's file (not the shown tab's list)");
  assert.equal(be.files.get(PB), before, "B's file untouched");
  b.undo();
  assert.deepEqual(a.doc.axes.stroke.map((x) => x.at), [1000, 1500, 3000], "B's undo never undoes A's edit");
});

test('closing a tab: no question, it is written and its neighbour shows; the last one closed shows home', async () => {
  const be = files(), { tabs, first } = windowOn(be, memStorage());
  await tabs.open([PA]); const a = tabs.current;
  await tabs.open([PB]); const b = tabs.current;
  b.edit('Add point', 'stroke', [...b.doc.axes.stroke, { at: 9000, pos: 10 }]);
  b.commands.run('file.close');
  await wait(20);
  assert.deepEqual(disk(be, PB).axes.stroke.map((x) => x[0]), [5000, 5500, 9000], 'written on close');
  assert.deepEqual(tabs.list.map((t) => t.app), [a]);
  assert.equal(tabs.current, a, 'the neighbour shows');
  assert.ok(!tabs.apps.includes(b), 'its app is gone');
  a.commands.run('file.close');
  await wait(20);
  assert.equal(tabs.home, true);
  assert.equal(tabs.apps.length, 1, 'one app stays (the spare)');
  assert.ok(first);
});

test('the open tabs and the shown one come back after a restart, each where it was; a closed tab does not', async () => {
  const be = files(), storage = memStorage();
  const w1 = windowOn(be, storage);
  await w1.tabs.restore();   // nothing yet: from here the open tabs are kept
  await w1.tabs.open([PA]); const a = w1.tabs.current;
  a.player.seek(2500);
  await w1.tabs.open([PB]); const b = w1.tabs.current;
  b.player.seek(7000);
  w1.tabs.show(a.tabId);
  for (const x of [a, b]) await x.project.close({ quit: true });   // the window closes (App.svelte: tabs.closeAll)

  const w2 = windowOn(be, storage);
  assert.equal(await w2.tabs.restore(), 2);
  await wait(10);
  const l = w2.tabs.list.map((t) => t.app);
  assert.deepEqual(w2.tabs.list.map((t) => t.parked?.key || t.app.project.path), [PA, PB], 'both tabs, in order');
  assert.equal(w2.tabs.current.project.path, PA, 'the shown one shows, where it was');
  assert.equal(Math.round(l[0].player.timeMs), 2500);
  assert.ok(w2.tabs.list[1].parked && !l[1].doc.media, 'the other comes back parked: it opens when first shown');
  assert.ok(w2.tabs.show(l[1].tabId));
  for (let i = 0; i < 50 && !l[1].doc.media; i++) await wait(10);
  await wait(10);
  assert.equal(w2.tabs.current, l[1], 'shown once open');
  assert.equal(Math.round(l[1].player.timeMs), 7000, '... where it was');
  // close B, restart: only A
  l[1].commands.run('file.close');
  await wait(20);
  for (const x of w2.tabs.apps) await x.project.close({ quit: true });
  storage.removeItem('pawscript.opening');   // its start-up open stood its 5 s (open-guard.js: else it counts as a crash and stays closed)
  const w3 = windowOn(be, storage);
  assert.equal(await w3.tabs.restore(), 1);
  assert.deepEqual(w3.tabs.list.map((t) => t.app.project.path), [PA]);
});

test('paw-w959: a restore landing late never takes the screen from a document opened meanwhile; it comes back behind it', async () => {
  const be = files(), storage = memStorage();
  const w1 = windowOn(be, storage);
  await w1.tabs.restore();
  await w1.tabs.open([PA]);
  await w1.tabs.current.project.close({ quit: true });
  // A's project reads slowly at the next start (a big project's runs take seconds)
  let release; const gate = new Promise((r) => { release = r; });
  for (const k of ['readText', 'readFile']) { const f = be[k].bind(be); be[k] = async (p) => { if (p === PA) await gate; return f(p); }; }
  const w2 = windowOn(be, storage);
  const restoring = w2.tabs.restore();
  assert.ok(await w2.tabs.open([PB]), 'the owner opens B while A is still loading');
  assert.equal(w2.tabs.current.project.path, PB);
  release();
  assert.equal(await restoring, 1);
  await wait(10);
  assert.equal(w2.tabs.current.project.path, PB, 'B stays shown');
  assert.equal(S.shown.app, w2.tabs.current);
  assert.deepEqual(w2.tabs.list.map((t) => t.app.project.path).sort(), [PA, PB], 'A came back as a tab behind it');
});

// ---- tracking across tabs (the fake tracker as a process, one request each) ----
const SQ = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const G = (who, part, t_ms, box) => ({ name: `${who}_${part}`, who, part, poly: SQ(...box), pinned: true, t_ms, source: 'user' });
function fakeSidecar(log) {
  return (request, { onEvent, onFrames } = {}) => new Promise((resolve) => {
    log.push(request.cmd);
    const p = spawn(process.execPath, [FAKE], { env: { ...process.env, FAKE_DURATION_MS: '6000', FAKE_FPS: '30', FAKE_DELAY_MS: request.cmd === 'track' ? '2' : '0' }, windowsHide: true });
    let buf = '', result = null, error = null;
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'frame') onFrames?.([e]); else onEvent?.(e);
        if (e.type === 'result') result = e;
        if (e.type === 'error') error = e.message;
      }
    });
    p.on('close', () => resolve({ result: result && (({ type, ...r }) => r)(result), error, cancelled: false }));   // eslint-disable-line no-unused-vars
    p.stdin.end(JSON.stringify(request) + '\n');
  });
}

test("a track started in A lands in A while B is shown; B's tracker list never cancels it, B's own Track is refused naming A", async () => {
  const log = [], cancels = [], be = { ...M.mockBackend(), sidecar: fakeSidecar(log), cancelSidecar: async (o) => { cancels.push(o ?? null); } };
  const { tabs, toasts } = windowOn(be, memStorage());
  const docOf = (path) => ({ ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 6000, groups: [G('c1', 'torso', 500, [0.3, 0.2, 0.5, 0.4])] }], ghosts: [], media: { ...M.sampleDoc().media, path, name: path.split('/').pop(), fps: 30, width: 640, height: 360 } });
  const openDoc = (path) => tabs.into((x) => { x.load(docOf(path)); return true; });
  await openDoc(VA); const a = tabs.current;
  await openDoc(VB); const b = tabs.current;
  const ta = TK.trackingFor(a), tb = TK.trackingFor(b);
  for (const [x, t, v] of [[a, ta, VA], [b, tb, VB]]) { x.mode = 'track'; x.doc.range = { t0: 0, t1: 6000 }; t.path = v; }   // the store's video effect does not run under SSR
  tabs.show(a.tabId);
  await ta.list();
  ta.selectTracker('fake.groups');
  const going = ta.track();   // A tracks ...
  await wait(30);
  assert.equal(ta.busy, 'track');
  tabs.show(b.tabId);         // ... while the owner works in B
  const nCancels = cancels.length;
  await tb.list();            // B's first tracker list
  assert.equal(cancels.length, nCancels, "B's list sent no cancel (it would have killed A's track)");
  assert.ok(tb.listed && tb.trackers.some((t) => t.id === 'fake.groups'), 'B has the trackers (listed once per window)');
  tb.selectTracker('fake.groups');
  const r = await tb.track();
  assert.ok(!tb.runs.length, "B's Track did not run");
  assert.ok(toasts.some((t) => t.app === b && /running in a\.mp4/.test(t.msg)), 'a plain toast naming the busy tab: ' + toasts.map((t) => t.msg).join(' | '));
  void r;
  await going;
  assert.equal(ta.runs.length, 1, 'the run landed in A: ' + ta.error);
  assert.equal(tb.runs.length, 0, 'not in B');
  assert.ok(a.doc.ghosts.some((g) => g.id === ta.runs[0].id), "A's document has the run");
  assert.ok(!b.doc.ghosts.some((g) => g.id === ta.runs[0].id), "B's has not");
  assert.equal(S.shown.app, b, 'B still shown');
  assert.equal(a.doc.dirty, true, 'A is due to be written (its continuous write stores the run)');
  assert.ok(!cancels.length || cancels.every((o) => o === null || o === ta), 'no cancel from B');
});

test('memory: past the budget the hidden tab shown longest ago is parked (written, its app dropped whole, its tab kept); showing it opens it where it was, its undo with it', async () => {
  const be = files(), { tabs, first } = windowOn(be, memStorage());
  await tabs.restore();
  first.settings.set('tabs.memoryMB', 100);
  await tabs.open([PA]); const a = tabs.current;
  assert.notEqual(a, first, "a document never goes into the window's first app (it could not be dropped)");
  a.heavyMB = () => 150;   // as if its runs held 150 MB
  let destroyed = false;
  a.cleanups.push(() => { destroyed = true; });
  a.edit('Add point', 'stroke', [...a.doc.axes.stroke, { at: 3000, pos: 40 }]);
  a.player.seek(3333);
  await tabs.open([PB]); const b = tabs.current;
  b.heavyMB = () => 150;
  await tabs.budget();
  const pA = tabs.list[0].id;
  assert.ok(tabs.parked[pA] && tabs.parked[pA].key === PA, 'A (hidden, 150 MB > 100) parked');
  assert.ok(destroyed && !tabs.apps.includes(a), "A's app is gone (destroyed: its memory with it)");
  assert.deepEqual(disk(be, PA).axes.stroke.map((x) => x[0]), [1000, 1500, 3000], 'written first');
  assert.deepEqual(tabs.list.map((t) => t.parked ? 'parked:' + t.parked.name : t.app), ['parked:a.pawproj', b], 'its tab stays, in place');
  assert.equal(tabs.current, b, 'B (shown) is never parked');
  assert.ok(tabs.isOpen(PA), 'its project counts as open (its card switches to it)');
  tabs.show(pA);
  const a2 = tabs.appOf(pA);
  for (let i = 0; i < 50 && !a2.doc.media; i++) await wait(10);
  await wait(10);
  assert.equal(tabs.current, a2);
  assert.ok(!tabs.parked[pA]);
  assert.equal(Math.round(a2.player.timeMs), 3333, 'where it was');
  assert.deepEqual(a2.doc.axes.stroke.map((x) => x.at), [1000, 1500, 3000]);
  assert.equal(a2.history.canUndo, true, 'its undo came back (.pawhistory)');
  a2.undo();
  assert.deepEqual(a2.doc.axes.stroke.map((x) => x.at), [1000, 1500]);
  // a tab with a job running is never parked
  b.jobBusy = () => true;
  await tabs.budget();
  assert.ok(!tabs.parked[b.tabId] && b.doc.media, 'busy B stays in memory');
  // a parked tab's x closes it
  b.jobBusy = () => false;
  await tabs.budget();
  const pB = tabs.list[1].id;
  assert.ok(tabs.parked[pB]);
  tabs.close(tabs.appOf(pB));
  await wait(10);
  assert.deepEqual(tabs.list.map((t) => t.app), [a2]);
});
