// paw-vdr4: CoTracker3 is an optional, user-installed tracker (non-commercial licence; never in the public build). When the
// sidecar does not list it, a stored pick, a fresh start and a programmatic track (director, api) go to TAPNext++ (Optical
// flow (box) on a machine without an NVIDIA GPU) with one plain note, and an old CoTracker run still reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { trackerFor } from '../src/lib/protocol.js';
import { makeRun, newFrames, appendFrames } from '../src/lib/runs.js';
import { encodeRuns, decodeRuns } from '../src/lib/runs-file.js';

const P = (key, d = 0) => ({ key, label: key, type: 'int', default: d, min: null, max: null, choices: null });
const TAP = { id: 'tapnext_points', name: 'TAPNext++ points (clicks or box)', roi: 'box_or_points', channels: [], gpu: true, params: [P('box_points', 64)] };
const LK = { id: 'lk_box', name: 'Optical flow (box)', roi: 'box', channels: ['raw_px'], params: [] };
const PUBLIC = [LK, { id: 'lk_two_point', name: 'Optical flow (distance between 2 points)', roi: 'points', channels: [], params: [] }, TAP];

test('trackerFor: a listed pick stays; CoTracker3 not listed -> TAPNext++ (no NVIDIA: Optical flow) with one note', () => {
  assert.deepEqual(trackerFor(PUBLIC, 'lk_two_point'), { id: 'lk_two_point', note: '' });
  assert.deepEqual(trackerFor(PUBLIC, 'cotracker_points'), { id: 'tapnext_points', note: 'CoTracker3 is not installed: using TAPNext++ points (clicks or box)' });
  const CPU = PUBLIC.filter((t) => !t.gpu);   // what the store passes when the sidecar says the GPU trackers are off
  assert.deepEqual(trackerFor(CPU, 'cotracker_points'), { id: 'lk_box', note: 'CoTracker3 is not installed: using Optical flow (box)' });
  assert.deepEqual(trackerFor(PUBLIC, ''), { id: 'tapnext_points', note: '' }, 'a fresh start: TAPNext++, never the first listed');
  assert.deepEqual(trackerFor(CPU, ''), { id: 'lk_box', note: '' });
  assert.deepEqual(trackerFor(PUBLIC, 'gone_tracker'), { id: 'tapnext_points', note: '' });
  assert.deepEqual(trackerFor([TAP, { id: 'cotracker_points', name: 'CoTracker3' }], ''), { id: 'tapnext_points', note: '' }, 'installed: still not the default');
  assert.deepEqual(trackerFor([], 'cotracker_points'), { id: '', note: '' });
});

test('an old CoTracker run round-trips through the .pawruns codec (run data does not depend on the tracker)', () => {
  const frames = newFrames();
  appendFrames(frames, Array.from({ length: 30 }, (_, i) => ({ t_ms: Math.round(i * 1000 / 30), value: (i % 10) / 10, overlay: { points: [[0.5, 0.5]], boxes: [], pts: [[0.5, 0.5, 1]] } })));
  const samples = Array.from({ length: 30 }, (_, i) => [Math.round(i * 1000 / 30), 0.5 + 0.4 * Math.sin(i / 4)]);
  const run = makeRun({ n: 3, tracker: { id: 'cotracker_points', name: 'CoTracker3' }, params: { mode: 'online' }, range: { start: 0, end: 1000 }, roi: { kind: 'box', x: 0, y: 0, w: 1, h: 1 },
    frames, runs: [], result: { samples, points: [{ at: 0, pos: 10 }, { at: 500, pos: 90 }], scenes: [{ start_ms: 0, end_ms: 1000, sign: 1 }], channels: { proj: samples }, confidence: samples, events: [], notes: [] } });
  const [back] = decodeRuns(encodeRuns([run]));
  assert.equal(back.tracker, 'cotracker_points');
  assert.deepEqual(back.params, { mode: 'online' });
  assert.deepEqual([...back.points.pos], [...run.points.pos]);
  assert.equal(back.frames.t.length, 30);
});

async function store({ last = '', gpu = null } = {}) {
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  const sent = [];
  const backend = { ...M.mockBackend(),
    sidecar: async (req) => { sent.push(req); return req.cmd === 'list' ? { result: { trackers: PUBLIC, scene_params: [], loop_params: [], describe_params: null, gpu } } : { error: 'stop here' }; } };
  const doc = { ...M.sampleDoc(), media: { ...M.sampleDoc().media, path: 'C:/v/clip.mp4', fps: 30, width: 640, height: 360 } };
  const app = M.createMockApp({ doc, keys: false, backend });
  const toasts = [];
  app.toast = (m, kind) => toasts.push([m, kind]);
  if (last) app.settings.set('tracking.lastTracker', last);
  const tr = T.trackingFor(app);
  app.tracking = tr;
  tr.path = doc.media.path;
  await tr.list();
  return { server, app, tr, toasts, sent };
}

test('the store: a stored CoTracker3 pick falls back once (note, setting rewritten); a director track runs on TAPNext++ without CoTracker params', async () => {
  const { server, app, tr, toasts, sent } = await store({ last: 'cotracker_points', gpu: { state: 'ok', name: 'NVIDIA GeForce RTX 4070' } });
  try {
    assert.equal(tr.trackerId, 'tapnext_points');
    assert.deepEqual(toasts, [['CoTracker3 is not installed: using TAPNext++ points (clicks or box)', 'info']]);
    assert.equal(app.settings.get('tracking.lastTracker'), 'tapnext_points', 'the note once, not at every start');
    const r = await tr.trackRange({ tracker: 'cotracker_points', range: { t0: 0, t1: 2000 }, roi: { kind: 'points', points: [[0.5, 0.5]] }, params: { mode: 'offline', box_points: 32 } });
    assert.equal(r.error, 'stop here');
    const req = sent.find((x) => x.cmd === 'track');
    assert.equal(req.tracker, 'tapnext_points');
    assert.equal(req.params.mode, undefined, 'CoTracker-only params dropped');
    assert.equal(req.params.box_points, 32);
    assert.equal(toasts.filter(([m]) => /CoTracker3/.test(m)).length, 1, 'one note per session: ' + JSON.stringify(toasts));
  } finally { await server.close(); }
});

test('the store: no NVIDIA GPU -> Optical flow (box); a fresh start -> TAPNext++ without a note', async () => {
  const a = await store({ last: 'cotracker_points', gpu: { state: 'none' } });
  try {
    assert.equal(a.tr.trackerId, 'lk_box');
    assert.deepEqual(a.toasts, [['CoTracker3 is not installed: using Optical flow (box)', 'info']]);
  } finally { await a.server.close(); }
  const b = await store();
  try {
    assert.equal(b.tr.trackerId, 'tapnext_points');
    assert.deepEqual(b.toasts, []);
  } finally { await b.server.close(); }
});

test('a plan never defaults to CoTracker3 even when it is installed: an exposed shot tracks with TAPNext++', async () => {
  const { planTracks } = await import('../src/lib/track-plan.js');
  const trackers = [{ id: 'cotracker_points', roi: 'box_or_points' }, LK, TAP];   // the sidecar lists them alphabetically
  const p = planTracks([{ start_ms: 0, end_ms: 5000, tags: ['exposed'] }], { trackers, trackerId: 'lk_box', exposed: () => true, grid: { points: 512 } });
  assert.equal(p[0].tracker, 'tapnext_points');
});
