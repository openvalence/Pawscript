// ticks.js -- ruler tick layout. Major ticks use lane.js tickStep (same minPx), so in timecode mode they fall
// on exactly the columns of the lanes' grid lines. x = msToX(...), unrounded (draw.js: one continuous mapping).
import { tickStep, msToX, frameAt, frameTime, frameLen } from '../../lib/lane.js';

const FRAME_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000];
const SUBDIV = [10, 5, 4, 3, 2];

/** Label for a tick at t when ticks are `step` ms apart: only as many decimals as the step needs. */
export function fmtTick(t, step) {
  const ms = Math.round(t), neg = ms < 0 ? '-' : '', a = Math.abs(ms), s = Math.floor(a / 1000), p = (n, w = 2) => String(n).padStart(w, '0');
  const hms = s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
  const frac = step >= 1000 ? '' : step >= 100 ? '.' + Math.floor((a % 1000) / 100) : step >= 10 ? '.' + p(Math.floor((a % 1000) / 10)) : '.' + p(a % 1000, 3);
  return neg + hms + frac;
}

/** The timeline's clock for lists and labels: m:ss (h:mm:ss past an hour), the ruler's whole-second form.
 *  Detail fields (inspector, popovers, hover) use lib/video.js fmtMs, m:ss.mmm. */
export const fmtClock = (ms) => fmtTick(ms, 1000);

/**
 * -> {step, sub, major: [{t, x, label}], minor: [x], frames: [x]}.
 * mode 'time' | 'frames' (labels are frame numbers, steps whole frames). frames: one tick per frame once
 * frames are >= 5 px apart. frameMs = the frame grid (lane.js: the player's clock, or a frame length): frame ticks and numbers
 * sit on its frames (paw-kxz4: the video's real frames, never n x frameMs). dur: no ticks past it, none before 0 (paw-g56v: the
 * view pans past both ends; out there is not the video).
 */
export function layoutTicks(view, w, { mode = 'time', frameMs: grid = 1000 / 30, minPx = 80, dur = Infinity } = {}) {
  const a = Math.max(0, view.start), b = Math.min(dur, view.start + view.span), k = w / view.span, frameMs = frameLen(grid);
  let step, unit = 0;
  if (mode === 'frames') {
    unit = FRAME_STEPS.find((n) => n * frameMs * k >= minPx) ?? FRAME_STEPS[FRAME_STEPS.length - 1];
    step = unit * frameMs;
  } else step = tickStep(view.span, w, minPx);
  let sub = 1;
  for (const d of SUBDIV) {
    if ((step / d) * k >= 7 && (mode === 'frames' ? unit % d === 0 : Number.isInteger(step / d))) { sub = d; break; }
  }
  const ms = step / sub, major = [], minor = [], frames = [];
  if (mode === 'frames') {   // a frame tick at its frame's start, numbered by the frame
    const u = unit / sub, f0 = frameAt(a, grid), f1 = frameAt(b, grid);
    for (let i = Math.ceil(f0 / u), i1 = Math.floor(f1 / u); i <= i1; i++) {
      const n = i * u, t = frameTime(n, grid);
      if (t < a - 1e-6 || t > b + 1e-6) continue;
      if (i % sub === 0) major.push({ t, x: msToX(view, w, t), label: String(n) }); else minor.push(msToX(view, w, t));
    }
  } else for (let i = Math.ceil(a / ms), i1 = Math.floor(b / ms); i <= i1; i++) {
    const t = i * ms, x = msToX(view, w, t);
    if (i % sub === 0) major.push({ t, x, label: fmtTick(t, step) });
    else minor.push(x);
  }
  if (frameMs * k >= 5) for (let n = Math.max(0, frameAt(a, grid)), n1 = frameAt(b, grid); n <= n1; n++) { const t = frameTime(n, grid); if (t >= a - 1e-6) frames.push(msToX(view, w, t)); }
  return { step, sub, major, minor, frames };
}

/** paw-ef73.18 (owner: "on the ruler, make frames obvious"): once a frame is at least minPx wide, each frame is a cell on
 *  the ruler. -> null (narrower) or {cells: [{n, x0, x1}] (frame n = [frameTime(n), frameTime(n + 1)), the one mapping:
 *  lane.js frameTime / msToX, unrounded, so the cells meet the cuts and the filmstrip exactly), stride (every stride-th
 *  frame number is drawn: 1, 2, 5, 10, 20, ... so a number fits its room)}. */
export const CELL_MIN_PX = 6;
export function frameCells(view, w, grid, minPx = CELL_MIN_PX, dur = Infinity) {
  const frameMs = frameLen(grid);
  if (!(frameMs > 0) || !(w > 0)) return null;
  const fw = (frameMs / view.span) * w;
  if (fw < minPx) return null;
  const n0 = Math.max(0, frameAt(view.start, grid)), n1 = frameAt(Math.min(dur - 1e-6, view.start + view.span), grid), cells = [];
  for (let n = n0; n <= n1; n++) cells.push({ n, x0: msToX(view, w, frameTime(n, grid)), x1: msToX(view, w, frameTime(n + 1, grid)) });
  const room = 6 * String(Math.max(1, n1)).length + 8;   // ~6 px a digit at 9 px, plus a gap
  return { cells, stride: FRAME_STEPS.find((s) => s * fw >= room) ?? FRAME_STEPS[FRAME_STEPS.length - 1] };
}
/** The view "Zoom to frames" sets: frames px wide, the time t where it is (centred). */
export const framesView = (w, frameMs, t, px = 12) => { const span = (w * frameLen(frameMs)) / px; return { start: t - span / 2, span }; };
