// dev/draft.js -- harness for src/features/draft: the whole shell (every feature) on the in-memory mock backend, a
// 60 s synthetic clip and a fake sidecar with the semantics of test/fake-pawtrack.mjs, shaped so the pipeline has
// something to decide: 9 scenes, varied describe summaries, black / still scenes at the head, inside and the tail,
// two exact loops. Vite on port 5196:  npx vite --port 5196 --strictPort   then /dev/draft.html
// Query: ?describe=none (not installed) | error (CUDA error)   ?real (no fake.none: lk_box on the whole frame)
//        ?keep (keep the sample script and plan)   ?theme=light   ?delay=ms per 8 frames (default 8)
//        ?slow=ms (list and score take that long, like a Python start)
// window.H = { app, D (draft store), FAKE, requests } for Playwright.
import '../src/ui/kit/theme.css';
import '../src/style.css';
import { mount } from 'svelte';
import Shell from '../src/app/Shell.svelte';
import { bootApp } from '../src/app/boot.js';
import { mockBackend, sampleDoc } from './mock-app.js';
import { draftFor } from '../src/features/draft/draft.svelte.js';
import { applyLook } from '../src/app/core-commands.js';

const q = new URLSearchParams(location.search);
const FAKE = { describe: q.get('describe') || 'ok', delay: +(q.get('delay') ?? 8), slow: +(q.get('slow') ?? 0), cancelled: false, real: q.has('real') };
const requests = [];

const P = (key, label, type, def, min = null, max = null, choices = null) => ({ key, label, type, default: def, min, max, choices });
const shared = [P('pipe_gate', 'Activity gate', 'choice', 'motion', null, null, ['off', 'motion']), P('pipe_invert', 'Invert direction', 'bool', false), P('loop_min_confidence', 'Loop min confidence', 'float', 0.5, 0, 1)];
const trackers = [
  { id: 'fake.box', name: 'Fake box oscillator', roi: 'box', channels: [], params: shared },
  ...(FAKE.real ? [{ id: 'lk_box', name: 'Optical flow (box)', roi: 'box', channels: [], params: shared }] : [{ id: 'fake.none', name: 'Fake whole-frame', roi: 'none', channels: [], params: shared }]),
];
const media = { duration_ms: 60027, fps: 29.97, is_vfr: false, width: 640, height: 360, frame_count: 1799 };
// scene i: [start, end, describe summary (null = black), loop kind]
const SUM = (acts, o = {}) => ({ count: 'duo', species: ['canine'], acts, visible_parts: [], knot: false, rating: 'explicit', positions: [], views: ['side_view'], ...o });
const BLACK = { count: 'unknown', species: [], acts: [], visible_parts: [], knot: false, rating: 'safe', positions: [], views: [] };
const SCENES = [
  [0, 3000, BLACK, null], [3000, 11000, SUM(['fellatio']), 'exact'], [11000, 19000, SUM(['oral', 'licking']), 'periodic'],
  [19000, 23000, SUM([], { rating: 'questionable' }), null], [23000, 35000, SUM(['anal_penetration']), 'exact'], [35000, 45000, SUM(['anal_knotting', 'anal']), 'periodic'],
  [45000, 49000, SUM(['vaginal_penetration']), 'periodic'], [49000, 56000, SUM(['vaginal_penetration'], { knot: true }), 'periodic'], [56000, 60027, BLACK, null],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (r) => ({ result: null, error: null, cancelled: false, ...r });

async function fakeTrack(req, onEvent, onFrames) {
  const frameMs = 1000 / media.fps, total = Math.max(1, Math.floor((req.end_ms - req.start_ms) / frameMs));
  const samples = [], pts = [];
  let batch = [];
  for (let i = 0; i <= total; i++) {
    if (FAKE.cancelled) return { cancelled: true };
    const tm = Math.round(req.start_ms + i * frameMs), v = 0.5 - 0.5 * Math.cos(2 * Math.PI * (tm / 1000) * 1.5);
    batch.push({ type: 'frame', t_ms: tm, value: v, overlay: { points: [[0.5, 1 - v]], boxes: req.roi ? [[req.roi.x, req.roi.y, req.roi.w, req.roi.h]] : [] } });
    samples.push([tm, +v.toFixed(4)]);
    if (i % 8 === 7 || i === total) { onFrames(batch); batch = []; onEvent({ type: 'progress', done: i, total }); await sleep(FAKE.delay); }
  }
  for (let k = 0; (k * 1000) / 3 + req.start_ms < req.end_ms; k++) pts.push({ at: Math.round(req.start_ms + (k * 1000) / 3), pos: k % 2 ? 100 : 0 });
  const events = (req.spans || []).filter((s) => s.state !== 'active').map((s) => ({ t_ms: s.start_ms, end_ms: s.end_ms, kind: s.state, label: `${s.state} ${((s.end_ms - s.start_ms) / 1000).toFixed(1)} s` }));
  const scenes = SCENES.filter(([a, b]) => b > req.start_ms && a < req.end_ms).map(([a, b]) => ({ start_ms: Math.max(a, req.start_ms), end_ms: Math.min(b, req.end_ms), sign: 1, auto_sign: null }));
  return { result: { type: 'result', samples, points: pts, events, media, scenes, confidence: samples.map(([t]) => [t, 0.9]) } };
}

const backend = {
  ...mockBackend(),
  mediaUrl: (p) => p,
  async cancelSidecar() { FAKE.cancelled = true; },
  async sidecar(req, { onEvent = () => {}, onFrames = () => {} } = {}) {
    FAKE.cancelled = false;
    requests.push(req);
    await sleep(40);
    if ((req.cmd === 'list' || req.cmd === 'score') && FAKE.slow) { await sleep(FAKE.slow); if (FAKE.cancelled) return done({ cancelled: true }); }
    if (req.cmd === 'list') return done({ result: { type: 'result', trackers, scene_params: [P('scene_len_s', 'Mean scene length (s)', 'float', 5, 1, 60)], loop_params: [shared[2]], describe_params: FAKE.describe === 'none' ? null : [P('min_score', 'Min tag score', 'float', 0.3, 0, 1)] } });
    if (req.cmd === 'probe') return done({ result: { type: 'result', media } });
    if (req.cmd === 'score') return done({ result: { type: 'result', overall: { f1: 0.5, precision: 0.5, recall: 0.5 }, scenes: [] } });
    if (req.cmd === 'scenes') {
      for (let k = 1; k <= 4; k++) { onEvent({ type: 'progress', done: k, total: 4 }); await sleep(100); if (FAKE.cancelled) return done({ cancelled: true }); }
      return done({ result: { type: 'result', scenes: SCENES.map(([a, b]) => ({ start_ms: a, end_ms: b })), media } });
    }
    const sc = SCENES.find(([a]) => a === req.start_ms);
    if (req.cmd === 'describe') {
      for (let k = 1; k <= 3; k++) { await sleep(80); if (FAKE.cancelled) return done({ cancelled: true }); onEvent({ type: 'progress', done: k, total: 3 }); }
      if (FAKE.describe === 'error') return done({ error: 'describe needs a CUDA GPU: torch.cuda.is_available() is False\nTraceback (most recent call last): ...' });
      return done({ result: { type: 'result', model: 'fake-tagger', media, tags: [], summary: sc?.[2] || BLACK, per_frame: [] } });
    }
    if (req.cmd === 'loop') {
      await sleep(120);
      if (FAKE.cancelled) return done({ cancelled: true });
      const kind = sc?.[3] ?? null, exact = kind === 'exact', cycles = exact ? Math.floor((req.end_ms - req.start_ms) / 1000) : 0;
      return done({ result: { type: 'result', period_ms: exact ? 1000.999 : null, period_frames: exact ? 30 : null, confidence: exact ? 0.93 : 0.1, cycles, kind, prominence: kind ? (exact ? 1.4 : 0.35) : 0,
        motion_period_frames: kind ? 30 : null, motion_period_ms: kind ? 1001 : null, held: { step: 1, ratio: 0 }, media } });
    }
    if (req.cmd === 'track') return done(await fakeTrack(req, onEvent, onFrames));
    return done({ error: 'unknown cmd ' + req.cmd });
  },
};

const app = bootApp({ backend, storage: null });
if (q.get('theme')) { app.settings.set('ui.theme', q.get('theme')); applyLook(app); }
const d = sampleDoc({ minutes: 1, fps: 29.97 });
d.media = { path: '/dev/assets/cfr2997.mp4', name: 'cfr2997.mp4', durationMs: 60027, fps: 29.97, isVfr: false, width: 640, height: 360 };
if (!q.has('keep')) { d.axes = { stroke: [] }; d.plan = []; d.loops = []; d.ghosts = d.ghosts.filter((g) => g.pinned); }
app.load(d);
mount(Shell, { target: document.getElementById('app'), props: { app } });
window.H = { app, D: draftFor(app), FAKE, requests };
window.app = app;
