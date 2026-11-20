// decimate.js -- reduce values to what a plot `cols` pixels wide can show: scripts to points or per-column
// min/max bands, signals to per-column min/max (NaN = gap), spans to the visible ones. Pure, allocation per call
// only (test/graph-editor-decimate.test.mjs). Times in ms, the plotted range is [t0, t1].
import { lowerBound } from '../../../lib/core/script.js';

/**
 * Script -> { pts: [[t, pos], ...] } when few actions are visible (with one neighbour beyond each edge so the
 * line runs off the plot), else { min, max, first, last } Float32Arrays per column (NaN where empty).
 */
export function scriptColumns(script, t0, t1, cols) {
  const a = Math.max(0, lowerBound(script, t0) - 1), b = Math.min(script.length, lowerBound(script, t1 + 1) + 1);
  if (b - a <= cols * 2) {
    const pts = new Array(b - a);
    for (let i = a; i < b; i++) pts[i - a] = [script[i].at, script[i].pos];
    return { pts };
  }
  const min = new Float32Array(cols).fill(NaN), max = new Float32Array(cols).fill(NaN);
  const span = Math.max(1, t1 - t0);
  for (let i = a; i < b; i++) {
    const c = Math.floor(((script[i].at - t0) / span) * cols);
    if (c < 0 || c >= cols) continue;
    const y = script[i].pos;
    if (!(y >= min[c])) min[c] = y;
    if (!(y <= max[c])) max[c] = y;
  }
  return { min, max };
}

/** Linear value of a signal at time t (NaN outside or next to a NaN sample). */
export function sigAt(sig, t) {
  const f = t / sig.dt - sig.i0, k = Math.floor(f);
  if (k < 0 || k >= sig.v.length) return NaN;
  if (k === sig.v.length - 1) return f === k ? sig.v[k] : NaN;
  const a = sig.v[k], b = sig.v[k + 1], u = f - k;
  return u === 0 ? a : a + (b - a) * u;
}

/** Signal -> { min, max } per column; columns narrower than a sample are interpolated at their centre. */
export function signalColumns(sig, t0, t1, cols) {
  const min = new Float32Array(cols).fill(NaN), max = new Float32Array(cols).fill(NaN);
  const span = Math.max(1, t1 - t0), colMs = span / cols;
  if (colMs < sig.dt * 1.5) {
    for (let c = 0; c < cols; c++) { const v = sigAt(sig, t0 + (c + 0.5) * colMs); min[c] = max[c] = v; }
    return { min, max };
  }
  const k0 = Math.max(0, Math.floor(t0 / sig.dt) - sig.i0), k1 = Math.min(sig.v.length, Math.ceil(t1 / sig.dt) - sig.i0 + 1);
  for (let k = k0; k < k1; k++) {
    const y = sig.v[k];
    if (y !== y) continue;
    const c = Math.floor((((sig.i0 + k) * sig.dt - t0) / span) * cols);
    if (c < 0 || c >= cols) continue;
    if (!(y >= min[c])) min[c] = y;
    if (!(y <= max[c])) max[c] = y;
  }
  return { min, max };
}

/** Finite [lo, hi] of a signal's values (its `range` hint wins), [0, 1] when nothing is known. */
export function signalRange(sig) {
  if (Array.isArray(sig.range) && sig.range.length === 2 && sig.range[1] > sig.range[0]) return sig.range;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < sig.v.length; i++) { const y = sig.v[i]; if (y < lo) lo = y; if (y > hi) hi = y; }
  if (lo === Infinity) return [0, 1];
  // position-like signals read best on the full 0..100 scale
  if (lo >= 0 && hi <= 100 && hi - lo > 20) return [0, 100];
  if (lo >= 0 && hi <= 1) return [0, 1];
  return hi > lo ? [lo, hi] : [lo - 1, hi + 1];
}

/** The spans touching [t0, t1] (points included); spans are sorted by t0. */
export function visibleSpans(spans, t0, t1) {
  const out = [];
  for (const s of spans) {
    if (s.t0 > t1) break;
    if (s.t1 >= t0) out.push(s);
  }
  return out;
}
