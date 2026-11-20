// paw-j9b8: Track ROI's last row "Every painted part (<tracker>)" with a box tracker that takes no painted groups (Optical flow
// (box), the CPU install's pick) started nothing and said nothing: track() refused silently (no box: the drag box is gone and
// only SAM-like trackers take the groups). The refusal is a toast now; with SAM picked the row still tracks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T, C;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  C = await server.ssrLoadModule('/src/features/tracking/commands.js');
});
after(() => server?.close());

const sq = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
const G = (name, t_ms, poly) => ({ name, t_ms, poly, who: name.split('_')[0], part: name.split('_')[1] });

function setup(trackerId) {
  const doc = M.sampleDoc({ minutes: 1 });
  doc.media = { ...doc.media, path: 'C:/v/clip.mp4' };
  doc.scenes = [{ start_ms: 0, end_ms: 20000, groups: [G('c2_penis', 1000, sq(0.5, 0.5, 0.1)), G('c1_anus', 1000, sq(0.3, 0.6, 0.1))] }];
  doc.range = { t0: 0, t1: 20000 };
  const app = M.createMockApp({ doc, keys: false, backend: M.mockBackend() });
  app.mode = 'track';
  const toasts = [], runs = [];
  app.toast = (m) => toasts.push(m);
  const tr = T.trackingFor(app);
  tr.trackers = [{ id: 'lk_box', name: 'Optical flow (box)', roi: 'box', params: [] }, { id: 'sam2_mask', name: 'SAM 2', roi: 'box_or_points', params: [] }];
  tr.listed = true;
  tr.trackerId = trackerId;
  tr.runTrack = async (t, range, params, roi) => { runs.push([t.id, roi?.kind]); return { cancelled: true }; };
  const cmd = C.default.find((c) => c.id === 'track.run');
  return { app, tr, toasts, runs, every: async () => { assert.ok(cmd.when(app), 'Track ROI enabled'); await cmd.run(app, { all: true }); } };
}

test('Every painted part with Optical flow (box): nothing runs and a toast says why, in plain words', async () => {
  const { tr, toasts, runs, every } = setup('lk_box');
  assert.equal(tr.paintedParts().length, 2);
  await every();
  assert.deepEqual(runs, []);
  assert.deepEqual(toasts, ['Optical flow (box) tracks one part at a time: pick it in Track ROI']);
  tr.destroy();
});

test('Every painted part with SAM: the run starts on the painted groups, no refusal', async () => {
  const { tr, toasts, runs, every } = setup('sam2_mask');
  await every();
  assert.deepEqual(runs.map((r) => r[0]), ['sam2_mask']);
  assert.deepEqual(toasts.filter((m) => /one part at a time/.test(m)), []);
  tr.destroy();
});
