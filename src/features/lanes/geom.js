// geom.js -- pure lane geometry: pos<->y, hit testing, box selection, LOD envelope, transform box, snapping.
// x is CSS px from the lane's left edge, y CSS px from its top. Time maths comes from the shared viewport (lib/lane.js).
import { msToX, xToMs, lowerBound as lbNum, frameAt, frameTime, frameLen } from '../../lib/lane.js';
import { lowerBound } from '../../lib/core/script.js';
import { maxReach, minMoveTime } from '../../lib/analyze/kinematics.js';

export const PAD = 10;   // px above pos 100 and below pos 0, so handles at the extremes are never clipped
// paw-g56v: lanes have no header bar (the name sits in a gutter over the curve): a lane is legible down to 36 px (the gutter's
// swatch + a few letters, the 22 px buttons, pos 0..100 still 16 px apart); a collapsed lane is a strip one small control high.
export const COLLAPSED_H = 22, MIN_H = 36, MAX_H = 640, SHORT_MIN_H = 28, GUTTER_W = 18;

/**
 * The open lanes' px from their preferred heights (0 = collapsed) and the px they share (avail). Too little room: they shrink in
 * proportion down to minH each, or to an even share of avail but never under shortMin (below that the stack scrolls: a
 * scrollbar would narrow the lanes against the other timeline rows). Spare room goes to the first open lane.
 */
export function laneHeights(pref, avail, minH = MIN_H, shortMin = SHORT_MIN_H) {
  const sum = pref.reduce((a, b) => a + b, 0);
  if (!sum) return pref.slice();
  if (sum > avail) {
    const n = pref.filter((p) => p > 0).length, room = Math.max(shortMin, Math.floor(avail / n));
    const floor = (p) => Math.min(minH, p, room), hs = pref.map((p) => (p ? Math.max(floor(p), Math.floor((p * avail) / sum)) : 0));
    // the floor can push the total past avail: take the excess back from lanes still above their floor
    let over = hs.reduce((a, b) => a + b, 0) - avail;
    for (let i = 0; over > 0 && i < hs.length; i++) { const t = Math.min(over, Math.max(0, hs[i] - floor(pref[i]))); hs[i] -= t; over -= t; }
    return hs;
  }
  const first = pref.findIndex((p) => p > 0);
  return pref.map((p, i) => (i === first ? p + avail - sum : p));
}

/**
 * paw-g56v: while playback loops, the out-of-range part of a lane shows the script wrapped, as a ghost: before the video's start
 * the end of the looped span (shifted back by its length), after the video's end its start (shifted on), each joined to the real
 * first / last point of the span (the device's travel across the wrap). Only on a side where the looped span reaches that end of
 * the video (within tol ms): a loop inside the video would draw over real points. Only the slice the view needs (plus one point
 * past its edge, so the line runs off it). -> {before: [{at, pos}] | null, after: [{at, pos}] | null}, ascending.
 */
export function loopWrap(script, loop, dur, view, tol = 0) {
  const out = { before: null, after: null };
  if (!loop || !(loop.t1 > loop.t0) || !script?.length) return out;
  const L = loop.t1 - loop.t0, a = view.start, b = view.start + view.span;
  const i0 = lowerBound(script, loop.t0), i1 = lowerBound(script, Math.floor(loop.t1) + 1);   // the points in [t0, t1]
  if (i1 <= i0) return out;
  if (loop.t0 <= tol && a < loop.t0) {   // shifted back: source times in [a + L, t1] land in [a, t0]
    const pts = [];
    for (let i = Math.max(i0, lowerBound(script, a + L) - 1); i < i1; i++) pts.push({ at: script[i].at - L, pos: script[i].pos });
    pts.push({ at: script[i0].at, pos: script[i0].pos });
    out.before = pts;
  }
  if (loop.t1 >= dur - tol && b > loop.t1) {   // shifted on: source times in [t0, b - L] land in [t1, b]
    const pts = [{ at: script[i1 - 1].at, pos: script[i1 - 1].pos }];
    for (let i = i0, k1 = Math.min(i1, lowerBound(script, b - L) + 1); i < k1; i++) pts.push({ at: script[i].at + L, pos: script[i].pos });
    out.after = pts;
  }
  return out;
}
export const posToY = (h, pos) => PAD + (1 - pos / 100) * (h - 2 * PAD);
/** Unclamped, unrounded pos for a y. */
export const yToPos = (h, y) => (1 - (y - PAD) / Math.max(1, h - 2 * PAD)) * 100;

/** [i0, i1) of actions with at in [t0, t1] (float bounds). */
export function span(script, t0, t1) {
  return [lowerBound(script, Math.ceil(t0)), lowerBound(script, Math.floor(t1) + 1)];
}

/**
 * Index of the action whose handle is nearest (x, y) within r px, or -1.
 * Returns -1 when more than maxCand actions are within reach in time: points are not individually
 * visible at that zoom, so grabbing one would be a lottery (box select instead).
 */
export function hitPoint(script, view, w, h, x, y, r = 7, maxCand = 4) {
  const [i0, i1] = span(script, xToMs(view, w, x - r), xToMs(view, w, x + r));
  if (i1 - i0 > maxCand) return -1;
  let best = -1, bd = r * r;
  for (let i = i0; i < i1; i++) {
    const dx = msToX(view, w, script[i].at) - x, dy = posToY(h, script[i].pos) - y, d = dx * dx + dy * dy;
    if (d <= bd) { bd = d; best = i; }
  }
  return best;
}

export function segDist2(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
  const u = L ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L)) : 0;
  const dx = ax + u * vx - px, dy = ay + u * vy - py;
  return dx * dx + dy * dy;
}

/** Index j of the segment (j-1, j) nearest (x, y) within r px, or -1. Only where segments are wider than minW px. */
export function hitSegment(script, view, w, h, x, y, r = 5, minW = 10) {
  const i = lowerBound(script, xToMs(view, w, x));
  let best = -1, bd = r * r;
  for (let j = Math.max(1, i - 1); j <= Math.min(script.length - 1, i + 1); j++) {
    const ax = msToX(view, w, script[j - 1].at), bx = msToX(view, w, script[j].at);
    if (bx - ax < minW) continue;
    const d = segDist2(x, y, ax, posToY(h, script[j - 1].pos), bx, posToY(h, script[j].pos));
    if (d <= bd) { bd = d; best = j; }
  }
  return best;
}

/** `at`s of the actions inside the px rectangle (any corner order). */
export function boxSelect(script, view, w, h, x0, y0, x1, y1) {
  const [i0, i1] = span(script, xToMs(view, w, Math.min(x0, x1)), xToMs(view, w, Math.max(x0, x1)));
  const pHi = yToPos(h, Math.min(y0, y1)), pLo = yToPos(h, Math.max(y0, y1)), out = [];
  for (let i = i0; i < i1; i++) { const p = script[i].pos; if (p >= pLo && p <= pHi) out.push(script[i].at); }
  return out;
}

/**
 * Level of detail. Draw a polyline when there are few enough actions in view; else a per-pixel-column
 * envelope. Handles appear once actions are at least `handlePx` apart on average.
 */
export function lod(count, w, handlePx = 12) {
  // heat: speed colours only where segments are wide enough (>= 3 px) to read as colour, not as speckle
  // envelope from 2 px per action: denser polylines only overlap into a solid block
  return { envelope: count > w * 0.5, handles: count * handlePx <= w, heat: count * 3 <= w };
}

/**
 * Per-column min/max/first/last y and max speed of script[i0..i1) into reusable buffers (no allocation
 * once sized). Returns the buffer object; columns without actions have first = NaN.
 * bufs: {min,max,first,last,spd: Float32Array} or undefined; speeds: Float32Array|null (speed of the segment ending at i).
 */
export function envelope(script, i0, i1, view, w, h, speeds, bufs) {
  const W = Math.ceil(w);
  if (!bufs || bufs.min.length < W) bufs = { min: new Float32Array(W), max: new Float32Array(W), first: new Float32Array(W), last: new Float32Array(W), spd: new Float32Array(W) };
  bufs.first.fill(NaN, 0, W); bufs.spd.fill(0, 0, W);
  const k = w / view.span, s = view.start, top = PAD, sc = (h - 2 * PAD) / 100;
  for (let i = i0; i < i1; i++) {
    const a = script[i], c = Math.floor((a.at - s) * k);
    if (c < 0 || c >= W) continue;
    const y = top + (100 - a.pos) * sc;
    if (bufs.first[c] !== bufs.first[c]) { bufs.first[c] = bufs.min[c] = bufs.max[c] = y; }
    else { if (y < bufs.min[c]) bufs.min[c] = y; if (y > bufs.max[c]) bufs.max[c] = y; }
    bufs.last[c] = y;
    if (speeds && speeds[i] > bufs.spd[c]) bufs.spd[c] = speeds[i];
  }
  bufs.w = W;
  return bufs;
}

// ---- snapping ----

/** The start (ms, integer) of the frame nearest t; fms: the frame grid (lane.js: the player's clock, or a frame length), paw-kxz4:
 *  the video's real frames. Points snap only when asked (setting edit.snapFrames, Shift off); stored points keep their ms. */
export const snapFrame = (t, fms) => (frameLen(fms) ? frameTime(frameAt(t + frameLen(fms) / 2, fms), fms) : Math.round(t));
/** The frame containing t (the ruler's numbering), 0 without a grid. */
export const frameOf = (t, fms) => (frameLen(fms) ? frameAt(t, fms) : 0);

/**
 * Snap time t to the nearest target within tolMs (targets: sorted ms array), else to frames when fms > 0.
 * Returns {t, target: bool}.
 */
export function snapTime(t, fms, targets, tolMs) {
  if (targets && targets.length) {
    const i = lbNum(targets, t);
    let best = null, bd = tolMs;
    for (const j of [i - 1, i]) if (j >= 0 && j < targets.length && Math.abs(targets[j] - t) <= bd) { bd = Math.abs(targets[j] - t); best = targets[j]; }
    if (best != null) return { t: Math.round(best), target: true };
  }
  return { t: snapFrame(t, fms), target: false };
}

/** Times of turning points (local extremes, holds count once) of a script: snap targets from ghosts. */
export function extremes(script) {
  const out = [];
  for (let i = 0; i < script.length; i++) {
    const p = script[i - 1]?.pos, c = script[i].pos, n = script[i + 1]?.pos;
    if (p === undefined || n === undefined || (c - p) * (n - c) < 0 || (c !== p && c === n)) out.push(script[i]);
  }
  return out;
}

// ---- transform box around a multi-selection ----

/** {t0, t1, p0 (low pos), p1 (high pos)} of the selected indices (sorted Int array), or null. */
export function bounds(script, idx) {
  if (!idx.length) return null;
  let p0 = 100, p1 = 0;
  for (const i of idx) { const p = script[i].pos; if (p < p0) p0 = p; if (p > p1) p1 = p; }
  return { t0: script[idx[0]].at, t1: script[idx[idx.length - 1]].at, p0, p1 };
}

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Box rectangle in px (min 12px tall so a flat selection still has a grabbable box). */
export function boxRect(b, view, w, h) {
  const x0 = msToX(view, w, b.t0), x1 = msToX(view, w, b.t1);
  let y0 = posToY(h, b.p1), y1 = posToY(h, b.p0);
  if (y1 - y0 < 12) { const m = (y0 + y1) / 2; y0 = m - 6; y1 = m + 6; }
  return { x0, x1, y0, y1 };
}
export function handlePoints(r) {
  const mx = (r.x0 + r.x1) / 2, my = (r.y0 + r.y1) / 2;
  return { nw: [r.x0, r.y0], n: [mx, r.y0], ne: [r.x1, r.y0], e: [r.x1, my], se: [r.x1, r.y1], s: [mx, r.y1], sw: [r.x0, r.y1], w: [r.x0, my] };
}
/** Handle id under (x, y), or null. Corner handles win over edges. Handles are offset outward by `out` px. */
export function hitHandle(r, x, y, tol = 6, out = 0) {
  const R = { x0: r.x0 - out, x1: r.x1 + out, y0: r.y0 - out, y1: r.y1 + out }, P = handlePoints(R);
  let best = null, bd = tol * tol;
  for (const id of HANDLES) { const dx = P[id][0] - x, dy = P[id][1] - y, d = dx * dx + dy * dy; if (d <= bd) { bd = d; best = id; } }
  return best;
}

/**
 * New box for dragging handle `hd` of box `b` to (t, pos). symmetric = scale about the centre.
 * lim = {tMin, tMax, minSpan}: the time edges stay within [tMin, tMax] and the span >= minSpan (so no two
 * selected points merge). Pos may flip (dragging the top below the bottom inverts).
 */
export function dragBox(b, hd, t, pos, symmetric, lim) {
  let { t0, t1, p0, p1 } = b;
  const tc = (b.t0 + b.t1) / 2, pc = (b.p0 + b.p1) / 2;
  if (hd.includes('e')) { t1 = t; if (symmetric) t0 = 2 * tc - t; }
  if (hd.includes('w')) { t0 = t; if (symmetric) t1 = 2 * tc - t; }
  if (hd.includes('n')) { p1 = pos; if (symmetric) p0 = 2 * pc - pos; }
  if (hd.includes('s')) { p0 = pos; if (symmetric) p1 = 2 * pc - pos; }
  if (hd.includes('e') || hd.includes('w')) {
    const ms = lim.minSpan || 1;
    if (symmetric) {
      let half = Math.max(ms / 2, Math.abs(t1 - t0) / 2);
      half = Math.min(half, tc - lim.tMin, lim.tMax - tc);
      t0 = tc - half; t1 = tc + half;
    } else if (hd.includes('e')) t1 = Math.min(lim.tMax, Math.max(t0 + ms, t1));
    else t0 = Math.max(lim.tMin, Math.min(t1 - ms, t0));
  }
  return { t0, t1, p0, p1 };
}

/** Map action a from box `from` to box `to` (float result; caller rounds). */
export function mapThroughBox(a, from, to) {
  const kt = from.t1 > from.t0 ? (to.t1 - to.t0) / (from.t1 - from.t0) : 1;
  const pos = from.p1 > from.p0 ? to.p0 + ((a.pos - from.p0) * (to.p1 - to.p0)) / (from.p1 - from.p0) : a.pos + ((to.p0 + to.p1) - (from.p0 + from.p1)) / 2;
  return { at: to.t0 + (a.at - from.t0) * kt, pos };
}

// ---- viewport ----

/** Wheel event -> {kind: 'zoom'|'pan'|'height', amount}. Pinch on a touchpad arrives as ctrl+wheel with fractional deltas. */
export function wheelIntent(e) {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dy = e.deltaY * unit, dx = e.deltaX * unit;
  if (e.ctrlKey) return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50 ? { kind: 'height', amount: -Math.sign(dy) } : { kind: 'zoom', amount: Math.exp(dy * 0.01) };
  if (e.shiftKey) return { kind: 'pan', amount: dx || dy };
  if (Math.abs(dx) > Math.abs(dy)) return { kind: 'pan', amount: dx };
  return { kind: 'zoom', amount: Math.exp(dy * 0.0015) };
}

/** Duration that bounds the viewport: the media's, else enough to hold every script plus some room. */
export function durationOf(doc) {
  const m = doc?.media?.durationMs;
  if (m > 0) return m;
  let last = 0;
  for (const s of Object.values(doc?.axes || {})) if (s.length) last = Math.max(last, s[s.length - 1].at);
  return Math.max(60000, last + 10000);
}

// ---- reachability envelope (device limits as a live visual) ----
/** How far the device can move in dtMs under limits {v, a?, j?}: a slope cone (v * dt) for hard-limit profiles, maxReach for kinematic ones. */
export function reachIn(dtMs, limits) {
  if (!(dtMs > 0)) return 0;
  return limits.a > 0 && limits.j > 0 ? maxReach(dtMs / 1000, limits) : limits.v * (dtMs / 1000);
}
/** Milliseconds a move of d units needs under limits (hard-limit profiles: d / v). */
export const needMs = (d, limits) => (!(d > 0) ? 0 : limits.a > 0 && limits.j > 0 ? minMoveTime(d, limits) * 1000 : (d / limits.v) * 1000);

/**
 * Reachable position band at time t between prev and next (either may be null): {lo, hi} in pos units (0..100),
 * the region reachable from prev.pos within t - prev.at intersected with the mirror from next. Empty band -> lo > hi.
 */
export function envelopeAt(prev, next, t, limits) {
  let lo = 0, hi = 100;
  if (prev) { const r = reachIn(t - prev.at, limits); lo = Math.max(lo, prev.pos - r); hi = Math.min(hi, prev.pos + r); }
  if (next) { const r = reachIn(next.at - t, limits); lo = Math.max(lo, next.pos - r); hi = Math.min(hi, next.pos + r); }
  return { lo, hi };
}
