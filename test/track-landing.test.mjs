// paw-d8eo: after a track the playhead goes back where the owner parked it (the follow walked it through the frames).
// paw-zu4h: undo / redo are refused while a track runs (its landing would drop the redo branch: what a held Ctrl+Z undid was
// lost for good); after the landing they work. The tracking store with the fake sidecar (test/fake-pawtrack.mjs fake.groups).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FAKE = fileURLToPath(new URL('./fake-pawtrack.mjs', import.meta.url));
const SQ = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const G = (who, part, t_ms, box) => ({ name: `${who}_${part}`, who, part, poly: SQ(...box), pinned: true, t_ms, source: 'user' });
function fakeSidecar() {
  return (request, { onEvent, onFrames }) => new Promise((resolve) => {
    const p = spawn(process.execPath, [FAKE], { env: { ...process.env, FAKE_DURATION_MS: '6000', FAKE_FPS: '30', FAKE_DELAY_MS: '6' }, windowsHide: true });
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

test('the playhead goes back where it was parked; undo and redo wait for the landing', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    const groups = [G('c1', 'hips', 500, [0.3, 0.5, 0.45, 0.65]), G('c2', 'hips', 500, [0.55, 0.3, 0.7, 0.45])];
    const doc = { ...M.sampleDoc(), axes: { stroke: [] }, scenes: [{ start_ms: 0, end_ms: 6000, groups }], ghosts: [], media: { ...M.sampleDoc().media, path: 'C:/v/clip.mp4', fps: 30, width: 640, height: 360 } };
    const app = M.createMockApp({ doc, keys: false, backend: { ...M.mockBackend(), sidecar: fakeSidecar() } });
    const toasts = [], toast0 = app.toast.bind(app);
    app.toast = (m, k, o) => { toasts.push(m); return toast0(m, k, o); };
    app.mode = 'track';
    const tr = T.trackingFor(app);
    tr.path = doc.media.path;
    await tr.list();
    tr.selectTracker('fake.groups');
    app.doc.range = { t0: 0, t1: 6000 };
    const ch0 = app.doc.chapters;
    app.transact('Chapter', () => { app.doc.chapters = [{ id: 'c1', t0: 0, t1: 900, name: 'intro', color: '#888' }]; });
    await app.player.seek(3000);
    const parked = app.player.timeMs;
    const p = tr.track();
    for (let i = 0; i < 400 && tr.busy !== 'track'; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(tr.busy, 'track', 'the track runs');
    assert.ok(!app.undo(), 'undo refused while it runs');
    assert.equal(app.doc.chapters[0]?.id, 'c1', 'nothing undone');
    assert.ok(toasts.some((m) => /Undo waits/.test(m)), `says why (${toasts.at(-1)})`);
    await p;
    assert.equal(tr.runs.length, 1, tr.error);
    assert.ok(Math.abs(app.player.timeMs - parked) <= 34, `the playhead back where it was parked (${app.player.timeMs} vs ${parked})`);
    assert.ok(app.undo(), 'after the landing undo works');
    assert.equal(app.doc.chapters, ch0);
    assert.ok(app.redo());
    assert.equal(app.doc.chapters[0]?.id, 'c1', 'and redo');
    tr.destroy();
  } finally { await server.close(); }
});