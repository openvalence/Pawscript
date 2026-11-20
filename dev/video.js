// dev/video.js -- harness for the video feature: the real mock app (dev/mock-app.js) with features/video's
// Player, VideoPane, commands, and the synthetic clips in dev/assets (bash dev/assets/make-clips.sh). Every clip
// burns its frame index in as a 12-bit code (squares at the top), so V.code() reads back the decoded frame.
//   ?clip=cfr24|cfr25|cfr2997|cfr30|cfr60|twos24|vfr  &probe=0 (no backend fps)  &table=1 (VFR frame table)  &bare=1
// window.V (for Playwright): code(), state(), step(n), seek(ms), seekFrame(k), waitIdle(), clips
import '../src/ui/kit/theme.css';
import '../src/style.css';
import { mount } from 'svelte';
import { createMockApp, sampleDoc, mockBackend } from './mock-app.js';
import { Player } from '../src/features/video/player.svelte.js';
import VideoPane from '../src/features/video/VideoPane.svelte';
import commands from '../src/features/video/commands.js';
import { drawRoi, drawFrameOverlay } from '../src/features/video/roi.js';

const vfrTimes = Array.from({ length: 150 }, (_, n) => (n < 60 ? (n * 1000) / 30 : n < 90 ? 2000 + (n - 60) * 100 : 5000 + ((n - 90) * 1000) / 60));
const CLIPS = {
  cfr24: { fps: 24, durationMs: 10000, frames: 240, audio: true },
  cfr25: { fps: 25, durationMs: 8000, frames: 200 },
  cfr2997: { fps: 30000 / 1001, durationMs: 60026.633, frames: 1799, audio: true },
  cfr30: { fps: 30, durationMs: 10000, frames: 300 },
  cfr60: { fps: 60, durationMs: 6000, frames: 360 },
  twos24: { fps: 24, durationMs: 8000, frames: 192 },
  vfr: { fps: 30, durationMs: 6000, frames: 150, isVfr: true, times: vfrTimes },
};
const q = new URLSearchParams(location.search);
const name = CLIPS[q.get('clip')] ? q.get('clip') : 'cfr2997';
const clip = CLIPS[name], probe = q.get('probe') !== '0', table = q.get('table') === '1';
if (q.get('bare') === '1') document.body.classList.add('bare');

const backend = { ...mockBackend(), ...(table ? { frameTimes: async () => clip.times || null } : {}) };
const doc = sampleDoc({ minutes: clip.durationMs / 60000, fps: 30 });
doc.media = { path: `/dev/assets/${name}.mp4`, url: `/dev/assets/${name}.mp4`, name: name + '.mp4', durationMs: probe ? clip.durationMs : 0,
  fps: probe ? clip.fps : 0, isVfr: probe ? !!clip.isVfr : false, hasAudio: probe ? !!clip.audio : undefined, width: 640, height: 360 };
doc.loops = [{ id: 'lp1', t0: 2000, t1: 3000 }];
const app = createMockApp({ doc, commands, backend });
app.player = new Player(app);
app.load(doc);
mount(VideoPane, { target: document.getElementById('pane'), props: { app } });
const P = app.player;

// ---- demo overlay clients (what the tracking feature does) ----
let roi = { kind: 'box', x: 120 / 640, y: 230 / 360, w: 80 / 640, h: 80 / 360 };   // the grey square of testsrc2
P.overlays.add({ id: 'demo.roi', order: 20, draw: (ctx, env) => drawRoi(ctx, env, roi) });
let trackOn = false;
// a synthetic run: box + mask polygon + point moving 1 px (of 640) per frame
P.overlays.add({ id: 'demo.track', order: 30, draw: (ctx, env) => {
  if (!trackOn) return;
  const x = 0.05 + (env.frame % 200) / 640;
  drawFrameOverlay(ctx, env, { boxes: [[x, 0.42, 0.08, 0.1]], points: [[x + 0.04, 0.47]], masks: [[[x, 0.6], [x + 0.08, 0.6], [x + 0.04, 0.7]]] }, '#FF5CB3');
} });
document.getElementById('track').onclick = (e) => { trackOn = !trackOn; e.target.textContent = 'Tracker overlay: ' + (trackOn ? 'on' : 'off'); P.overlays.invalidate(); };

// ---- clip picker ----
const sel = document.getElementById('clip');
for (const k of Object.keys(CLIPS)) sel.add(new Option(k, k, false, k === name));
document.getElementById('probe').checked = probe; document.getElementById('table').checked = table;
const go = () => { location.search = new URLSearchParams({ clip: sel.value, probe: document.getElementById('probe').checked ? 1 : 0, table: document.getElementById('table').checked ? 1 : 0 }); };
sel.onchange = go; document.getElementById('probe').onchange = go; document.getElementById('table').onchange = go;

// ---- probes for Playwright ----
const cv = document.createElement('canvas'); cv.width = 320; cv.height = 36;
const cx = cv.getContext('2d', { willReadFrequently: true });
/** The frame index burned into the decoded frame now in the <video> (12-bit code at the top). */
function code() {
  const el = P.el;
  if (!el || el.readyState < 2) return -1;
  cx.drawImage(el, 0, 0, 320, 36, 0, 0, 320, 36);
  const d = cx.getImageData(0, 0, 320, 36).data;
  let n = 0;
  for (let b = 0; b < 12; b++) { const i = (18 * 320 + 22 + b * 25) * 4; if (d[i] + d[i + 1] + d[i + 2] > 382) n |= 1 << b; }
  return n;
}
const raf = () => new Promise((r) => requestAnimationFrame(r));
async function waitIdle(timeout = 5000) {
  const t0 = performance.now();
  while ((P.seeking || P.q.busy) && performance.now() - t0 < timeout) await raf();
  await raf(); await raf();
}
const state = () => ({ clip: name, probe, table, timeMs: P.timeMs, frame: P.frame, exact: P.exact, direct: P.direct, fps: P.fps, frameMs: P.frameMs,
  learnedMs: P.learnedMs, count: P.frameCount, last: P.last, playing: P.playing, rate: P.rate, shuttle: P.shuttle, seeking: P.seeking, ready: P.ready,
  durationMs: P.durationMs, stats: { ...P.stats }, view: { ...P.view }, error: P.error?.message || null, code: code() });
window.V = { app, P, code, state, waitIdle, clip, clips: CLIPS,
  async step(n) { await P.step(n); await waitIdle(); return state(); },
  async seek(ms) { await P.seek(ms); await waitIdle(); return state(); },
  async seekFrame(k) { await P.seekFrame(k); await waitIdle(); return state(); },
  roi: () => roi, setRoi: (r) => { roi = r; P.overlays.invalidate(); }, track: (on) => { trackOn = on; P.overlays.invalidate(); } };
const out = document.getElementById('out');
setInterval(() => { const s = state(); out.textContent = JSON.stringify({ ...s, stats: undefined, view: undefined }, null, 1) + '\nstats ' + JSON.stringify(s.stats); }, 250);
