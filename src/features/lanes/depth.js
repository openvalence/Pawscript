// depth.js -- depth handles: two horizontal bars at the selection's max and min pos, drawn across its span (the
// range when it holds the whole selection: a scene click sets both). Dragging one rescales the selected points
// (lib/edit remapRange: affine, shape kept). Pure geometry + the target maths; LaneView owns the gesture.
import { posToY } from './geom.js';
import { msToX } from '../../lib/lane.js';

export const DEPTH_MIN = 3;          // selections this big get handles
const TAB_W = 26, TAB_H = 14;        // the grip tab (value label) left of the span

/** {min, max, t0, t1} for the handles, or null (fewer than DEPTH_MIN points, or all at one pos). */
export function depthOf(script, idx, range = null) {
  if (idx.length < DEPTH_MIN) return null;
  let min = 100, max = 0;
  for (const i of idx) { const p = script[i].pos; if (p < min) min = p; if (p > max) max = p; }
  if (!(max > min)) return null;
  let t0 = script[idx[0]].at, t1 = script[idx[idx.length - 1]].at;
  if (range && range.t0 <= t0 && range.t1 >= t1) { t0 = range.t0; t1 = range.t1; }
  return { min, max, t0, t1 };
}

/** Pixel layout: line x0..x1 and the grip tab's left x (outside the span, kept inside the lane). */
export function depthLayout(d, view, w) {
  const x0 = msToX(view, w, d.t0), x1 = msToX(view, w, d.t1);
  return { x0, x1, tab: Math.max(2, Math.min(w - TAB_W - 2, x0 - TAB_W - 2)) };
}

/** Handle under (x, y): {which: 'top'|'bottom', grip: bool (on the tab)} or null. */
export function hitDepth(d, view, w, h, x, y, tol = 5) {
  if (!d) return null;
  const L = depthLayout(d, view, w), yt = posToY(h, d.max), yb = posToY(h, d.min);
  for (const [which, yy] of [['top', yt], ['bottom', yb]]) if (x >= L.tab && x <= L.tab + TAB_W && Math.abs(y - yy) <= TAB_H / 2) return { which, grip: true };
  if (x < L.x0 - tol || x > L.x1 + tol) return null;
  const dt = Math.abs(y - yt), db = Math.abs(y - yb);
  if (Math.min(dt, db) > tol) return null;
  return { which: dt <= db ? 'top' : 'bottom', grip: false };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/**
 * Target {lo, hi} (integers, 0..100, hi > lo) for dragging handle `which` of d = {min, max} to `pos`.
 * mode 'scale': the other end stays; 'move' (Shift): both move, range kept; 'sym' (Alt): about the centre.
 */
export function depthTarget(d, which, pos, mode = 'scale') {
  const p = Math.round(pos), { min, max } = d;
  if (mode === 'move') { const dp = clamp(p - (which === 'top' ? max : min), -min, 100 - max); return { lo: min + dp, hi: max + dp }; }
  if (mode === 'sym') {
    const s = min + max;   // lo + hi stays s, so the centre stays and both stay integers
    if (which === 'top') { const hi = clamp(p, Math.floor(s / 2) + 1, Math.min(100, s)); return { lo: s - hi, hi }; }
    const lo = clamp(p, Math.max(0, s - 100), Math.ceil(s / 2) - 1); return { lo, hi: s - lo };
  }
  return which === 'top' ? { lo: min, hi: clamp(p, min + 1, 100) } : { lo: clamp(p, 0, max - 1), hi: max };
}

/** Overlay drawing: o = {d, hot: 'top'|'bottom'|null, view}; T = render.js theme. */
export function drawDepth(ctx, w, h, o, T) {
  const { d, hot, view } = o, L = depthLayout(d, view, w);
  ctx.font = '10px ' + T.mono; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  for (const [which, pos] of [['top', d.max], ['bottom', d.min]]) {
    const y = Math.round(posToY(h, pos)) + 0.5, on = hot === which;
    ctx.strokeStyle = T.reality; ctx.globalAlpha = on ? 1 : 0.7; ctx.lineWidth = on ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(Math.max(0, L.x0), y); ctx.lineTo(Math.min(w, L.x1), y); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = on ? T.reality : T.overlay; ctx.fillRect(L.tab, y - TAB_H / 2, TAB_W, TAB_H);
    ctx.strokeStyle = T.reality; ctx.lineWidth = 1; ctx.strokeRect(L.tab + 0.5, y - TAB_H / 2 + 0.5, TAB_W - 1, TAB_H - 1);
    ctx.fillStyle = on ? T.bg : T.hiTx; ctx.fillText(String(pos), L.tab + TAB_W / 2, y + 0.5);
  }
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}
