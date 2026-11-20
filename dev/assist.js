// dev/assist.js -- harness for the assist feature: the real mock app, the synthetic clip dev/assets/assist60.mp4
// (bash dev/assets/make-assist-clip.sh) and a document whose script has the direction wrong in scene 2 (10-20 s),
// scene 5 (40-50 s) and the second half of scene 4 (35-40 s, where the picture is upside down). Two tracker runs are
// injected into the tracking store: #1 "SAM 2 mask" (the script; overlays on the rod tip, except scene 3 where it
// follows the wrong thing) and #2 "Optical flow" (right way round, no data for 30-40 s). A still span 54-58 s.
// The strip at the bottom: the script, the ranges, and per 0.5 s whether its direction matches the truth (green / red).
// window.H is for Playwright (oracle answers, orientation report).
import '../src/ui/kit/theme.css';
import { mount, tick } from 'svelte';
import { createMockApp } from './mock-app.js';
import commands from '../src/features/assist/commands.js';
import AssistPanel from '../src/features/assist/AssistPanel.svelte';
import AssistOverlay from '../src/features/assist/AssistOverlay.svelte';
import AssistChip from '../src/features/assist/AssistChip.svelte';
import { ToastHost } from '../src/ui/kit/index.js';
import { assistFor } from '../src/features/assist/assist.svelte.js';
import { trackingFor } from '../src/features/tracking/tracking.svelte.js';
import { makeRun, newFrames } from '../src/lib/runs.js';
import { normalize, posAt } from '../src/lib/core/script.js';

// ---- the clip's truth (same formula as make-assist-clip.sh) ----
const F = [0.8, 1.0, 0.7, 0.9, 1.1, 0.8];
export function depthAt(t) {
  const k = Math.min(5, Math.floor(t / 10000));
  let tl = (t - k * 10000) / 1000;
  if (k === 5) tl = tl < 4 ? tl : tl < 8 ? 4 : tl - 4;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * F[k] * tl);
}
const truthPos = (t) => 100 * (1 - depthAt(t));
const WRONG = [[10000, 20000], [35000, 40000], [40000, 50000]];
function makeScript(flips = [], noise = 0, seed = 3) {
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const fr = 1000 / 30, pts = [];
  for (let k = 0; k * fr < 60000; k++) pts.push({ at: Math.round(k * fr), pos: truthPos(k * fr) });
  const sc = (p) => Math.floor(p.at / 10000);
  const keep = pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const a = pts[i - 1].pos, b = pts[i + 1].pos;
    return (p.pos - a) * (b - p.pos) < 0 || (p.pos === a) !== (p.pos === b) || sc(p) !== sc(pts[i + 1]) || sc(p) !== sc(pts[i - 1]);
  });
  return normalize(keep.map((p) => {
    const f = flips.some(([a, b]) => p.at >= a && p.at < b);
    const v = Math.max(0, Math.min(100, p.pos + (noise ? (r() - 0.5) * noise : 0)));
    return { at: p.at, pos: f ? 100 - v : v };
  }));
}
/** Normalised rod tip (the clip draws the rod from y = 0 down to 60 + 230 d px of 360; 35-40 s upside down). */
const tipY = (t) => { const y = (60 + 230 * depthAt(t)) / 360; return t >= 35000 && t < 40000 ? 1 - y : y; };

const MEDIA = { path: '/dev/assets/assist60.mp4', name: 'assist60.mp4', durationMs: 60000, fps: 30, isVfr: false, width: 640, height: 360 };
const freshDoc = () => ({ axes: { stroke: makeScript(WRONG) }, activeAxis: 'stroke', chapters: [], bookmarks: [], loops: [], plan: [], ghosts: [], media: MEDIA });

const v = document.getElementById('v');
v.src = MEDIA.path;
const app = createMockApp({ doc: freshDoc(), commands, video: v });
const A = assistFor(app), tr = trackingFor(app);

function injectRuns() {
  const scenes = Array.from({ length: 6 }, (_, k) => ({ start_ms: k * 10000, end_ms: (k + 1) * 10000, sign: k === 1 || k === 4 ? -1 : 1, auto_sign: k === 1 || k === 4 ? -1 : 1 }));
  const fr = newFrames();
  for (let k = 0; k < 1800; k++) {
    const t = Math.round((k * 1000) / 30), y = tipY(t);
    fr.t.push(t); fr.v.push(NaN);
    fr.ov.push(t >= 20000 && t < 30000 ? { boxes: [[0.02, 0.03, 0.16, 0.1]], points: [[0.1, 0.08]] } : { boxes: [[0.45, y - 0.07, 0.1, 0.1]], points: [[0.5, y - 0.02]] });
  }
  const run1 = makeRun({ n: 1, tracker: { id: 'sam2_mask', name: 'SAM 2 mask' }, params: {}, range: { start: 0, end: 60000 }, roi: { kind: 'box', x: 0.42, y: 0.25, w: 0.16, h: 0.5 },
    result: { points: app.doc.axes.stroke, samples: [], scenes, events: [{ t_ms: 54000, end_ms: 58000, kind: 'still', label: 'still 4.0 s' }] }, frames: fr, runs: [] });
  const flow = makeScript([], 8, 11).filter((a) => a.at < 30000 || a.at >= 40000);
  const run2 = makeRun({ n: 2, tracker: { id: 'flow', name: 'Optical flow' }, params: {}, range: { start: 0, end: 60000 }, roi: null,
    result: { points: flow, samples: [], scenes: scenes.map((s) => ({ ...s, sign: 1, auto_sign: null })), events: [] }, frames: newFrames(), runs: [run1] });
  tr.runs = [run1, run2];
  app.doc.ghosts = [tr.ghostOf(run1), tr.ghostOf(run2)];
  tr.selectedId = 'run1';
}

async function reset() {
  A.close();
  app.load(freshDoc());
  await tick();
  injectRuns();
  await tick();
  A.regenerate();
}

mount(AssistPanel, { target: document.getElementById('panel'), props: { app } });
mount(AssistOverlay, { target: document.getElementById('modal'), props: { app } });
mount(AssistChip, { target: document.getElementById('chip'), props: { app } });
mount(ToastHost, { target: document.body });
document.getElementById('reset').onclick = reset;
await tick();
injectRuns();
await tick();
A.regenerate();

// ---- strip: script, range, playhead, direction right / wrong per 0.5 s ----
const cv = document.getElementById('strip'), g = cv.getContext('2d');
function orientation(script, t0, t1) {
  let s = 0;
  for (let t = t0 + 50; t < t1 - 50; t += 50) s += (posAt(script, t) - 50) * (truthPos(t) - 50);
  return Math.sign(s);
}
function draw() {
  const W = cv.clientWidth, H = cv.clientHeight, dpr = devicePixelRatio || 1;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const x = (t) => (t / 60000) * W, s = app.script, top = 14, h = H - top - 4;
  const r = app.doc.range;
  if (r) { g.fillStyle = 'rgba(77,166,255,.14)'; g.fillRect(x(r.t0), 0, x(r.t1) - x(r.t0), H); }
  for (let t = 0; t < 60000; t += 500) {
    const still = t >= 54000 && t < 58000;
    g.fillStyle = still ? '#454A54' : orientation(s, t, t + 500) > 0 ? '#3DD68C' : '#FF4757';
    g.fillRect(x(t) + 0.5, 2, x(500) - 1, 8);
  }
  g.strokeStyle = '#33373E';
  for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(x(k * 10000), 0); g.lineTo(x(k * 10000), H); g.stroke(); }
  g.strokeStyle = '#4DA6FF'; g.lineWidth = 1; g.beginPath();
  s.forEach((a, i) => { const X = x(a.at), Y = top + (1 - a.pos / 100) * h; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
  g.stroke();
  g.fillStyle = '#FF5CB3'; g.fillRect(x(app.player.timeMs) - 1, 0, 2, H);
  document.getElementById('st').textContent = `${app.history.entries.filter((e) => e.applied).length} undo steps · playhead ${(app.player.timeMs / 1000).toFixed(2)} s`;
  requestAnimationFrame(draw);
}
draw();

// ---- for Playwright ----
const SPANS = [[0, 10000], [10000, 20000], [20000, 30000], [30000, 35000], [36000, 40000], [40000, 50000], [50000, 54000], [58000, 60000]];
window.H = {
  app, A, tr, depthAt, reset,
  report: () => SPANS.map(([t0, t1]) => ({ t0, t1, o: orientation(app.script, t0, t1) })),
  state: () => { const q = A.q; return { open: A.open, mode: A.mode, id: q?.id, kind: q?.kind, t0: q?.t0, t1: q?.t1, pair: A.pairIdx, split: A.split && { i: A.split.i, n: A.split.cands.length, at: A.split.cands[A.split.i].at }, sug: A.suggestion, progress: A.progress, pending: A.frames?.pending }; },
  /** What a user who sees the truth would press for the current question. */
  oracle() {
    const q = A.q;
    if (A.mode === 'split') { const c = A.split.cands, want = c.findIndex((x) => x.at >= 35000); return want > A.split.i ? 'ArrowRight' : want < A.split.i ? 'ArrowLeft' : 'Enter'; }
    if (!q) return null;
    if (q.kind === 'direction') {
      if (q.t0 < 35000 && q.t1 > 36000 && q.t0 <= 30000) return 'S';
      const p = q.pairs[A.pairIdx];
      return depthAt(p.a.at) > depthAt(p.b.at) ? 'ArrowLeft' : 'ArrowRight';
    }
    if (q.kind === 'track') return q.t0 === 20000 ? 'N' : 'Y';
    if (q.kind === 'fallback') return 'Y';
    if (q.kind === 'activity') return 'N';
    if (q.kind === 'depth') return '1';
    return 'ArrowDown';
  },
};
