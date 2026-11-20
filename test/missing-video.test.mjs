// paw-xfg6: a project whose video file is gone. The player knows (missing, from the backend's stat) even while the webview
// plays its cached copy, so the pane can say so with "Locate video…"; locating a file clears it. Tracking (the sidecar reads
// the original) is refused with that reason and the same action, never sent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

let server, M, T, V;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  globalThis.cancelAnimationFrame ??= () => {};
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  V = await server.ssrLoadModule('/src/features/video/player.svelte.js');
});
after(() => server?.close());
const tick = () => new Promise((r) => setTimeout(r, 0));

test('the player marks a video whose file is not there, and clears it when another file is located', async () => {
  const files = { 'C:/v/here.mp4': { exists: true, size: 9 } };
  let picked = null;
  const app = { doc: { media: null }, history: { markDirty() {} },
    backend: { stat: async (p) => files[p] || { exists: false }, openDialog: async () => picked, mediaProbe: async () => null } };
  const p = new V.Player(app);
  p.load({ path: 'C:/v/gone.mp4', name: 'gone.mp4' });
  await tick(); await tick();
  assert.equal(p.missing, true);
  picked = 'C:/v/here.mp4';
  await p.relink();
  await tick(); await tick();
  assert.equal(app.doc.media.path, 'C:/v/here.mp4');
  assert.equal(p.missing, false);
  // the same file opened again after it went (the editor re-mounting keeps the player's source: same url, no reload)
  delete files['C:/v/here.mp4'];
  p.load({ path: 'C:/v/here.mp4', name: 'here.mp4' });
  await tick(); await tick();
  assert.equal(p.missing, true);
});

test('a sidecar job on a missing video is not sent: the reason and a Locate video action', async () => {
  const be = M.mockBackend();
  let sent = 0;
  const sidecar = be.sidecar.bind(be);
  be.sidecar = (...a) => { sent++; return sidecar(...a); };
  const app = M.createMockApp({ doc: M.sampleDoc(), keys: false, backend: be });
  const tr = app.tracking = T.trackingFor(app), toasts = [];
  app.toast = (m, k, o) => toasts.push({ m, k, o });
  app.player.missing = true;
  const r = await tr.job('track', { cmd: 'track', video: app.doc.media.path });
  assert.match(r.error, /video file not found/);
  assert.equal(sent, 0);
  assert.equal(toasts.at(-1).o.action.label, 'Locate video…');
});

test('paw-zo60: the drive comes back after the load: the player asks again, and Track runs', async () => {
  const files = {};
  const app = { doc: { media: null }, history: { markDirty() {} }, backend: { stat: async (p) => files[p] || { exists: false }, mediaProbe: async () => null } };
  const p = new V.Player(app);
  p.load({ path: 'D:/v/clip.mp4', name: 'clip.mp4' });
  await tick(); await tick();
  assert.equal(p.missing, true);
  files['D:/v/clip.mp4'] = { exists: true, size: 9 };   // the drive is back
  assert.equal(await p.recheckMissing(), false);
  assert.equal(p.missing, false);
  // the job asks the player again before refusing
  const be = M.mockBackend();
  let sent = 0;
  const sidecar = be.sidecar.bind(be);
  be.sidecar = (...a) => { sent++; return sidecar(...a); };
  const a2 = M.createMockApp({ doc: M.sampleDoc(), keys: false, backend: be });
  const tr = a2.tracking = T.trackingFor(a2);
  a2.toast = () => {};
  a2.player.missing = true;
  a2.player.recheckMissing = async () => { a2.player.missing = false; return false; };
  const r = await tr.job('list', { cmd: 'list', video: a2.doc.media.path });
  assert.doesNotMatch(String(r.error || ''), /video file not found/);
  assert.equal(sent, 1, 'the job went to the tracker');
});