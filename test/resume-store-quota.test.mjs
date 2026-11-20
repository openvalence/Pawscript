// paw-juqk: the resume store ('pawscript.resume') stays small (a capped selection, a size cap, oldest first out), is not
// rewritten every second while the video plays, and a settings write that fails is said.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, P, S;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  P = await server.ssrLoadModule('/src/app/project.svelte.js');
  S = await server.ssrLoadModule('/src/app/settings.svelte.js');
});
after(() => server?.close());

const VIDEO = 'C:/clips/gen.mp4', PROJ = 'C:/clips/gen.pawproj', KEY = 'pawscript.resume';
const projectText = () => JSON.stringify({ format: 'pawproj', version: 3, media: { path: VIDEO, name: 'gen.mp4', durationMs: 60000, fps: 30 }, axes: { stroke: Array.from({ length: 2000 }, (_, i) => [i * 20, i % 2 ? 100 : 0]) } });
function storage(quota = Infinity) {
  const m = new Map(), writes = [];
  return { m, writes, getItem: (k) => m.get(k) ?? null, removeItem: (k) => m.delete(k),
    setItem(k, v) { v = String(v); const used = [...m].reduce((n, [kk, vv]) => n + (kk === k ? 0 : vv.length), 0); if (used + v.length > quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } m.set(k, v); writes.push(k); } };
}
async function opened(st) {
  const be = M.mockBackend();
  be.files.set(VIDEO, 'v'); be.files.set(PROJ, projectText());
  const app = M.createMockApp({ backend: be, storage: st, doc: {}, keys: false });
  app.toast = () => {};
  app.project = P.createProject(app);
  assert.equal(await app.project.openProject(PROJ), true);
  return app;
}

test('a big store of old documents is cut to size (oldest first); a big selection is not kept, a small one is', async () => {
  const st = storage();
  const docs = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`c:/old/${i}.pawproj`, { at: 1000 + i, t: 0, sel: { axis: 'stroke', ats: Array.from({ length: 20000 }, (_, j) => j * 7) } }]));
  st.setItem(KEY, JSON.stringify({ last: null, docs }));
  const app = await opened(st);
  app.select(app.doc.axes.stroke.slice(0, 1000).map((p) => p.at));
  await app.project.close({ quit: true });
  let s = JSON.parse(st.getItem(KEY));
  assert.ok(st.getItem(KEY).length <= 400_000, `store ${st.getItem(KEY).length} chars`);
  assert.ok(s.docs['c:/old/59.pawproj'] && !s.docs['c:/old/0.pawproj'], 'the oldest went first');
  assert.deepEqual(s.docs['c:/clips/gen.pawproj'].sel.ats, [], 'a 1000-point selection is not kept');
  app.select(app.doc.axes.stroke.slice(0, 50).map((p) => p.at));
  await app.project.close({ quit: true });
  s = JSON.parse(st.getItem(KEY));
  assert.equal(s.docs['c:/clips/gen.pawproj'].sel.ats.length, 50);
});

test('while the video plays the tick does not rewrite the store; it does once paused', async () => {
  const st = storage(), app = await opened(st);
  app.project.startAutosave();
  try {
    app.player.playing = true;
    const n = st.writes.filter((k) => k === KEY).length;
    for (const t of [1000, 2000]) { app.player.timeMs = t; app.player.displayMs = t; await new Promise((r) => setTimeout(r, 1100)); }
    assert.equal(st.writes.filter((k) => k === KEY).length, n, 'nothing written during playback');
    app.player.playing = false;
    await new Promise((r) => setTimeout(r, 1100));
    assert.ok(st.writes.filter((k) => k === KEY).length > n, 'written once paused');
  } finally { app.project.stopAutosave(); }
});

test('a settings write that fails (quota) stays as writeError (the health slot says it once, paw-wfd2.3) until one works again', () => {
  const st = storage(10);
  const s = new S.Settings(st);
  s.set('recent', [{ path: 'C:/a/very/long/path.pawproj' }]); s.flush();
  s.set('recent', [{ path: 'C:/another/long/path.pawproj' }]); s.flush();
  assert.equal(s.writeError, 'QuotaExceededError');
  s.storage = { setItem() {} }; s.flush();
  assert.equal(s.writeError, '', 'a write that works clears it');
});
