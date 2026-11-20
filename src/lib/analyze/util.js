// Shared numeric helpers for analysis. Internal "arrays" form of a Script: parallel Float64Arrays.
import { lowerBound } from '../core/script.js';

const cache = new WeakMap();
/** Script -> {at, pos, n} typed arrays, cached per Script identity (scripts are immutable). */
export function arrays(script) {
  let a = cache.get(script);
  if (!a) {
    const n = script.length, at = new Float64Array(n), pos = new Float64Array(n);
    for (let i = 0; i < n; i++) { at[i] = script[i].at; pos[i] = script[i].pos; }
    a = { at, pos, n };
    cache.set(script, a);
  }
  return a;
}

/** First index in sorted typed array `at` with at[i] >= t. */
export function lb(at, t) {
  let lo = 0, hi = at.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (at[m] < t) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * The part of a script inside [t0, t1] as arrays, with linearly interpolated end points at t0 / t1 when
 * they fall inside a segment (so speed and time statistics of a range are exact). Defaults: whole script.
 */
export function clipped(script, t0 = -Infinity, t1 = Infinity) {
  const n = script.length;
  if (!n) return { at: new Float64Array(0), pos: new Float64Array(0), n: 0 };
  const i0 = lowerBound(script, t0), i1 = lowerBound(script, Math.floor(t1) + 1);
  const at = [], pos = [];
  const lerp = (a, b, t) => a.pos + ((b.pos - a.pos) * (t - a.at)) / (b.at - a.at);
  if (Number.isFinite(t0) && i0 > 0 && i0 < n && script[i0].at > t0) { at.push(t0); pos.push(lerp(script[i0 - 1], script[i0], t0)); }
  for (let i = i0; i < i1; i++) { at.push(script[i].at); pos.push(script[i].pos); }
  if (Number.isFinite(t1) && i1 > 0 && i1 < n && script[i1 - 1].at < t1 && t1 > (at.length ? at[at.length - 1] : -Infinity)) {
    at.push(t1); pos.push(lerp(script[i1 - 1], script[i1], t1));
  }
  return { at: Float64Array.from(at), pos: Float64Array.from(pos), n: at.length };
}

/**
 * Turning points (strokes' peaks and valleys) of at/pos between indices [from, to): a reversal counts once the
 * signal has moved back by >= minProm from its extreme; a flat top counts at its arrival. The first and last
 * extreme are not counted unless confirmed by a reversal (same as find_peaks in trackers/pawtrack/score.py).
 * Returns {idx: number[], kind: number[]} with kind +1 peak, -1 valley.
 */
export function turns(at, pos, minProm = 10, from = 0, to = at.length) {
  const idx = [], kind = [];
  let dir = 0, ext = from, lo = from, hi = from;
  for (let i = from + 1; i < to; i++) {
    const p = pos[i];
    if (dir === 0) {
      if (p > pos[hi]) hi = i;
      if (p < pos[lo]) lo = i;
      if (pos[hi] - pos[lo] >= minProm) {
        if (hi > lo) { dir = 1; ext = hi; if (lo > from) { idx.push(lo); kind.push(-1); } }
        else { dir = -1; ext = lo; if (hi > from) { idx.push(hi); kind.push(1); } }
      }
    } else if (dir === 1) {
      if (p > pos[ext]) ext = i;
      else if (pos[ext] - p >= minProm) { idx.push(ext); kind.push(1); dir = -1; ext = i; }
    } else if (p < pos[ext]) ext = i;
    else if (p - pos[ext] >= minProm) { idx.push(ext); kind.push(-1); dir = 1; ext = i; }
  }
  return { idx, kind };
}

/** Percentile (0..100) of an ascending-sorted numeric array, linear interpolation. NaN if empty. */
export function percentile(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  const x = (Math.min(100, Math.max(0, p)) / 100) * (n - 1), i = Math.floor(x);
  return i + 1 < n ? sorted[i] + (sorted[i + 1] - sorted[i]) * (x - i) : sorted[n - 1];
}

/** Median of an unsorted array (NaN if empty). */
export const median = (a) => percentile(Float64Array.from(a).sort(), 50);

/** Weighted percentile: smallest value whose cumulative weight reaches p%. pairs sorted internally. */
export function weightedPercentiles(values, weights, ps) {
  const n = values.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a] - values[b]);
  let total = 0;
  for (let i = 0; i < n; i++) total += weights[i];
  return ps.map((p) => {
    if (!n || !(total > 0)) return NaN;
    const target = (p / 100) * total;
    let acc = 0;
    for (const i of order) { acc += weights[i]; if (acc >= target) return values[i]; }
    return values[order[n - 1]];
  });
}

export const finiteOr = (v, d) => (Number.isFinite(v) ? v : d);
