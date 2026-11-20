// paw-c61g: a new run's arrival settings on its shots (Smart stroke on where it can fuse, a re-track's carried settings) are
// not an undo step but are folded into every state the history holds: undo / redo of a scene edit made before the track keeps
// them. The tracking store with the fake sidecar (test/fake-pawtrack.mjs fake.groups: two painted hips, so the run can fuse).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FAKE = fileURLToPath(new URL('./fake-pawtrack.mjs', import.meta.url));
const SQ = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const G = (who, part, t_ms, box) => ({ name: `${who}_${part}`, who, part, poly: SQ(...box), pinned: true, t_ms, source: 'user' });
function fakeSidecar() {
  return (request, { onEvent, onFrames }) => new Promise((resolve) => {
    const p = spawn(process.execPath, [FAKE], { env: { ...process.env, FAKE_DURATION_MS: '6000', FAKE_FPS: '30', FAKE_DELAY_MS: '0' }, windowsHide: true });
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

test('undo / redo of a scene edit made before a track keeps the new run\'s Smart stroke on', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    const groups = [G('c1', 'hips', 500, [0.3, 0.5, 0.45, 0.65]), G('c2', 'hips', 500, [0.55, 0.3, 0.7, 0.45])];
    const doc = { ...M.sampleDoc(), axes: { stroke: [] }, scenes: [{ start_ms: 0, end_ms: 6000, groups }], ghosts: [], media: { ...M.sampleDoc().media, path: 'C:/v/clip.mp4', fps: 30, width: 640, height: 360 } };
    const app = M.createMockApp({ doc, keys: false, backend: { ...M.mockBackend(), sidecar: fakeSidecar() } });
    app.mode = 'track';
    const tr = T.trackingFor(app);
    tr.path = doc.media.path;
    await tr.list();
    tr.selectTracker('fake.groups');
    app.doc.range = { t0: 0, t1: 6000 };
    // a scene edit before the track (one undo step)
    app.transact('Dismiss the fill', () => { app.doc.scenes = app.doc.scenes.map((s) => ({ ...s, linkfill: 'off' })); });
    await tr.track();
    assert.equal(tr.runs.length, 1, tr.error);
    const id = tr.runs[0].id, smart = () => app.doc.scenes[0].derives?.[id]?.smart;
    assert.equal(smart(), true, 'the new run arrives with Smart stroke on');
    app.undo();
    assert.equal(app.doc.scenes[0].linkfill, undefined, 'the scene edit undone');
    assert.equal(smart(), true, 'undo keeps the arrival');
    app.redo();
    assert.equal(app.doc.scenes[0].linkfill, 'off');
    assert.equal(smart(), true, 'redo keeps it too');
    tr.destroy();
  } finally { await server.close(); }
});
