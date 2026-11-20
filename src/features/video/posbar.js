// posbar.js -- the position bar over the video (paw-rtby), pure parts (test/video-posbar.test.mjs). The bar is two ends
// in normalised 0..1 frame coords, the DEEP end (x0, y0) = pos 0 and the OUT end (x1, y1) = pos 100, so it stays glued
// to the picture through env.map under zoom / pan / rotation / flips (like the stroke axis arrow, tracking/axis.js).
// Stored per video in settings 'video.posbar:<media path>'; on / off is the player's ui.posBar.
import { planInto, planSpan, simInto } from './simdraw.js';

/** Default placement: a vertical bar near the right edge, deep end down. */
export const BAR_DEFAULT = Object.freeze({ x0: 0.93, y0: 0.82, x1: 0.93, y1: 0.18 });
export const END_PX = 14;   // grab radius of an end and half the body's grab width (stage px)
export const MIN_PX = 24;   // the ends never come closer than this on screen

const unit = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** A usable bar: four coords in 0..1, not a point. */
export const barOk = (b) => !!b && [b.x0, b.y0, b.x1, b.y1].every(unit) && (b.x0 !== b.x1 || b.y0 !== b.y1);
/** The stored bar if usable, else the default (old / broken settings never crash). */
export const barOf = (b) => (barOk(b) ? { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } : { ...BAR_DEFAULT });
/** Settings key of a video's bar ('' without a video). */
export const barKey = (path) => (path ? 'video.posbar:' + path : '');

/** The point at pos (0 deep .. 100 out) along the bar (normalised coords). */
export function barPoint(b, pos) {
  const f = Math.max(0, Math.min(100, pos)) / 100;
  return [b.x0 + (b.x1 - b.x0) * f, b.y0 + (b.y1 - b.y0) * f];
}

/** What a pointer at stage (x, y) grabs: 'deep' | 'out' (an end, the nearer one) | 'body' | null. D, O: the ends in
 *  stage px ([x, y]). */
export function barHit(D, O, x, y, r = END_PX) {
  const dd = Math.hypot(x - D[0], y - D[1]), dO = Math.hypot(x - O[0], y - O[1]);
  if (Math.min(dd, dO) <= r) return dd <= dO ? 'deep' : 'out';
  const vx = O[0] - D[0], vy = O[1] - D[1], L2 = vx * vx + vy * vy;
  if (!L2) return null;
  const f = ((x - D[0]) * vx + (y - D[1]) * vy) / L2;
  if (f < 0 || f > 1) return null;
  return Math.hypot(x - (D[0] + vx * f), y - (D[1] + vy * f)) <= r ? 'body' : null;
}

/** b0 dragged by (dx, dy) normalised: 'body' moves both ends (kept inside the frame, the shape kept), 'deep' / 'out'
 *  that end (clamped to the frame; onto the other end: b0 unchanged). The caller keeps a screen minimum (MIN_PX). */
export function barDrag(b0, kind, dx, dy) {
  if (kind === 'body') {
    const lo = (a, c) => -Math.min(a, c), hi = (a, c) => 1 - Math.max(a, c);
    const mx = Math.max(lo(b0.x0, b0.x1), Math.min(hi(b0.x0, b0.x1), dx)), my = Math.max(lo(b0.y0, b0.y1), Math.min(hi(b0.y0, b0.y1), dy));
    return { x0: r4(b0.x0 + mx), y0: r4(b0.y0 + my), x1: r4(b0.x1 + mx), y1: r4(b0.y1 + my) };
  }
  const k = kind === 'deep' ? 0 : 1, o = k ? 0 : 1;
  const x = clamp01(b0['x' + k] + dx), y = clamp01(b0['y' + k] + dy);
  if (Math.hypot(x - b0['x' + o], y - b0['y' + o]) < 1e-4) return { ...b0 };
  return { ...b0, ['x' + k]: r4(x), ['y' + k]: r4(y) };
}

/** Where the machine is at t: inside the device plan ({t0, dtMs, pos}, the machine preview's) the planned motion, else
 *  the script (exactly posAt). out: {pos, speed, dir} (reused). */
export function machinePos(out, script, plan, t) {
  if (plan?.pos?.length) { const [a, b] = planSpan(plan); if (t >= a && t <= b) return planInto(out, plan, t); }
  return simInto(out, script, t);
}

// ---- paw-4c48.8: the bar ON THE SHAFT (the owner's "the preview rail drawn over the shaft per scene to validate"). Its ends
//      come from the tracked shaft each frame (lib/shaft.js railContext / railAt: pos 0 at the base = hilt, pos 100 at the tip),
//      then the owner's look: trims at each drawn end (shares of the rail, + shortens), an offset along / across (shares of its
//      length), a per-shot flip (0 at the tip), width / opacity / colour / end labels. Stored per video in settings
//      'video.posbar.shaft:<media path>' (the hand-placed bar keeps 'video.posbar:<path>'). ----
export const LOOK_DEFAULT = Object.freeze({ on: false, width: 0, opacity: 0.6, color: 'axis', labels: true, along: 0, across: 0, trim0: 0, trim1: 0, flips: [] });
export const LOOK_COLORS = ['axis', 'white', 'warn'];
export const TRIM = [-0.5, 0.45], OFFSET = 1.5, WIDTH = [2, 60], OPACITY = [0.15, 1];
/** Settings key of a video's shaft-bar look ('' without a video). */
export const lookKey = (path) => (path ? 'video.posbar.shaft:' + path : '');
const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
/** The stored look, cleaned (old / broken settings never crash). */
export function lookOf(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    on: o.on === true, width: num(o.width, 0, WIDTH[1], 0), opacity: num(o.opacity, OPACITY[0], OPACITY[1], LOOK_DEFAULT.opacity),
    color: LOOK_COLORS.includes(o.color) ? o.color : 'axis', labels: o.labels !== false,
    along: num(o.along, -OFFSET, OFFSET, 0), across: num(o.across, -OFFSET, OFFSET, 0), trim0: num(o.trim0, TRIM[0], TRIM[1], 0), trim1: num(o.trim1, TRIM[0], TRIM[1], 0),
    flips: Array.isArray(o.flips) ? o.flips.filter(Number.isFinite) : [],
  };
}
/** The bar on the shaft: r = railAt's {D, O (normalised: hilt = pos 0, tip = pos 100), entry, w (frame heights)}, look, flipped
 *  (this shot reads the other way: 0 at the tip), aspect (w / h) -> {x0, y0, x1, y1 (pos 0 / pos 100 ends), entry, w} | null. */
export function shaftBar(r, look, flipped = false, aspect = 16 / 9) {
  if (!r) return null;
  let [D, O] = [r.D, r.O];
  if (flipped) [D, O] = [O, D];
  const dx = (O[0] - D[0]) * aspect, dy = O[1] - D[1], L = Math.hypot(dx, dy);
  if (!(L > 1e-9)) return null;
  const ux = dx / L, uy = dy / L, ox = (look.along * ux - look.across * uy) * L, oy = (look.along * uy + look.across * ux) * L;
  const P = (Q, f) => [(Q[0] * aspect + f * dx + ox) / aspect, Q[1] + f * dy + oy];
  const a = P(D, look.trim0), b = P(O, -look.trim1);
  return { x0: a[0], y0: a[1], x1: b[0], y1: b[1], entry: r.entry ? [r.entry[0] + ox / aspect, r.entry[1] + oy] : null, w: r.w };
}
/** paw-4c48.10: a script position (0..100 along the whole rail) as a position along the shaft bar drawn with look's trims
 *  (its ends at trim0 .. 1 - trim1 of the rail), so the marker sits where the rail has that position, as the measured entry
 *  does (posOn on the same trimmed bar): trimming moves the bar's ends, never what a position means. Not clamped. */
export function onTrimmed(pos, look) {
  const t0 = look?.trim0 || 0, w = 1 - t0 - (look?.trim1 || 0);
  return w > 1e-6 ? (pos - 100 * t0) / w : pos;
}
/** Where point p (normalised) sits along bar b as a position (0 at x0 / y0 .. 100 at x1 / y1, not clamped). */
export function posOn(b, p, aspect = 16 / 9) {
  const dx = (b.x1 - b.x0) * aspect, dy = b.y1 - b.y0, l2 = dx * dx + dy * dy;
  return l2 > 0 && p ? (100 * ((p[0] - b.x0) * aspect * dx + (p[1] - b.y0) * dy)) / l2 : NaN;
}
/** look0 dragged on the shaft bar by (dx, dy) in square units (x times aspect), the bar's drawn ends D -> O in square units:
 *  'body' moves the offset (along / across, shares of the untrimmed rail RL), 'deep' / 'out' trims that end (+ = shorter). */
export function lookDrag(look0, kind, dx, dy, D, O, RL) {
  const vx = O[0] - D[0], vy = O[1] - D[1], L = Math.hypot(vx, vy) || 1, ux = vx / L, uy = vy / L, R = RL > 0 ? RL : L;
  const a = (dx * ux + dy * uy) / R, c = (-dx * uy + dy * ux) / R, r3 = (x) => Math.round(x * 1000) / 1000;
  if (kind === 'body') return { ...look0, along: r3(num(look0.along + a, -OFFSET, OFFSET, 0)), across: r3(num(look0.across + c, -OFFSET, OFFSET, 0)) };
  if (kind === 'deep') return { ...look0, trim0: r3(num(look0.trim0 + a, TRIM[0], TRIM[1], 0)) };
  return { ...look0, trim1: r3(num(look0.trim1 - a, TRIM[0], TRIM[1], 0)) };
}
/** Hold through a dropout: prev = the last good {bar, shot} (or null), bar = this frame's (null: none), held = no measured
 *  geometry this frame -> {bar (to draw; null = none: the hand-placed bar shows), faint, prev (to keep)}. Never across shots. */
export function holdRail(prev, bar, held, shot) {
  if (bar && !held) return { bar, faint: false, prev: { bar, shot } };
  if (prev && prev.shot === shot) return { bar: prev.bar, faint: true, prev };
  return { bar: null, faint: true, prev: null };
}
