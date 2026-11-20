// Shared helpers for the node catalogue (contract §7, src/lib/graph/README.md). Pure, no DOM.
// Param builders in the kit params.js dialect, signal kernels aligned on ctx.grid(), script splicing.

import { posAt, lowerBound, clampPos } from '../../core/script.js';
import { joinPlan } from '../../gen/util.js';
import { makeSignal, flattenSpans } from '../types.js';

// ---------------------------------------------------------------- param builders

export const num = (key, label, def, min, max, step, extra = {}) => ({ key, label, type: 'number', default: def, min, max, step, ...extra });
export const int = (key, label, def, min, max, extra = {}) => ({ key, label, type: 'int', default: def, min, max, step: 1, ...extra });
export const bool = (key, label, def, extra = {}) => ({ key, label, type: 'bool', default: def, ...extra });
export const choice = (key, label, def, choices, extra = {}) => ({ key, label, type: 'choice', default: def, choices, ...extra });
export const text = (key, label, def, extra = {}) => ({ key, label, type: 'text', default: def, ...extra });
export const json = (key, label, def, extra = {}) => ({ key, label, type: 'json', default: def, ...extra });
export const SEED_MAX = 2147483647; // model.js freshSeed draws below 0x7fffffff
export const seedParam = () => int('seed', 'Seed', 1, 0, SEED_MAX, { seed: true });
/** A signal-modulated number param (pointwise nodes read it through ctx.param(key)). */
export const modNum = (key, label, def, min, max, step, extra = {}) => num(key, label, def, min, max, step, { mod: 'signal', ...extra });

// ---------------------------------------------------------------- ports

export const script = (name = 'script', extra = {}) => ({ name, type: 'script', ...extra });
export const signal = (name = 'signal', extra = {}) => ({ name, type: 'signal', ...extra });
export const spans = (name = 'spans', extra = {}) => ({ name, type: 'spans', ...extra });
export const number = (name = 'value', extra = {}) => ({ name, type: 'number', ...extra });
export const any = (name, extra = {}) => ({ name, type: 'any', ...extra });
export const req = { required: true };
export const points = { hint: 'points' };

// ---------------------------------------------------------------- signals

/** Samples of `sig` on `grid` (same dt): a Float32Array of grid.n, NaN where `sig` has no sample. Shares the buffer when it can. */
export function onGrid(sig, grid) {
  const { i0, n } = grid;
  if (!sig || !sig.v) return new Float32Array(n).fill(NaN);
  if (sig.dt !== grid.dt) return resampleTo(sig, grid);
  const off = i0 - sig.i0, m = sig.v.length;
  if (off >= 0 && off + n <= m) return sig.v.subarray(off, off + n);
  const out = new Float32Array(n).fill(NaN);
  for (let k = Math.max(0, -off); k < n && k + off < m; k++) out[k] = sig.v[k + off];
  return out;
}

// a signal on another dt (e.g. audio envelope) read linearly onto grid
function resampleTo(sig, grid) {
  const out = new Float32Array(grid.n);
  for (let k = 0; k < grid.n; k++) {
    const x = ((grid.i0 + k) * grid.dt) / sig.dt - sig.i0, j = Math.floor(x), f = x - j;
    out[k] = j < 0 || j >= sig.v.length ? NaN : f === 0 || j + 1 >= sig.v.length ? (f === 0 ? sig.v[j] : NaN) : sig.v[j] + (sig.v[j + 1] - sig.v[j]) * f;
  }
  return out;
}

/** (i) => sample at ABSOLUTE grid index i of `sig` (t = i * dt), NaN outside. Reads past ctx.grid() into the halo. */
export function reader(sig) {
  if (!sig || !sig.v) return () => NaN;
  const { i0, v } = sig, n = v.length;
  return (i) => { const j = i - i0; return j >= 0 && j < n ? v[j] : NaN; };
}

/**
 * Zig-zag turning points of v[k0..k1) (finite samples): a reversal counts once the signal has retraced by `prom`
 * from the running extreme (the same rule as edit `turns`). -> [{ k, kind: 'top' | 'bottom' }], endpoints excluded.
 */
export function zigzag(v, k0, k1, prom) {
  const out = [];
  if (k1 - k0 < 3) return out;
  const P = Math.max(1e-9, prom);
  let hi = k0, lo = k0, dir = 0, cand = k0;
  for (let k = k0 + 1; k < k1; k++) {
    const x = v[k];
    if (dir === 0) {
      if (x > v[hi]) hi = k;
      if (x < v[lo]) lo = k;
      if (v[hi] - v[lo] >= P) { if (hi > lo) { dir = 1; cand = hi; if (lo > k0) out.push({ k: lo, kind: 'bottom' }); } else { dir = -1; cand = lo; if (hi > k0) out.push({ k: hi, kind: 'top' }); } }
    } else if (dir === 1) {
      if (x > v[cand]) cand = k;
      else if (v[cand] - x >= P) { out.push({ k: cand, kind: 'top' }); dir = -1; cand = k; }
    } else if (x < v[cand]) cand = k;
    else if (x - v[cand] >= P) { out.push({ k: cand, kind: 'bottom' }); dir = 1; cand = k; }
  }
  if (dir !== 0 && cand < k1 - 1) out.push({ k: cand, kind: dir === 1 ? 'top' : 'bottom' });
  return out;
}

/** Parabolic sub-sample refinement of an extreme at k: { dk in [-0.5, 0.5], value }. */
export function refine(v, k) {
  const a = v[k - 1], b = v[k], c = v[k + 1];
  if (!(a === a && c === c)) return { dk: 0, value: b };
  const den = a - 2 * b + c;
  if (den === 0) return { dk: 0, value: b };
  const dk = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
  return { dk, value: b - 0.25 * (a - c) * dk };
}

/** A new signal on ctx.grid() whose sample k is f(k, t). Non-finite results (also past float32 range) become NaN. */
export function genSignal(ctx, f, range) {
  const g = ctx.grid(), sig = makeSignal(g.i0, g.n, g.dt, NaN), v = sig.v;
  for (let k = 0; k < g.n; k++) { v[k] = f(k, (g.i0 + k) * g.dt); if (v[k] === Infinity || v[k] === -Infinity) v[k] = NaN; } // incl. float32 overflow
  if (range) sig.range = range;
  return sig;
}

/** Contiguous runs of finite samples: [[k0, k1)] */
export function finiteRuns(v) {
  const runs = [];
  let k0 = -1;
  for (let k = 0; k <= v.length; k++) {
    const ok = k < v.length && v[k] === v[k];
    if (ok && k0 < 0) k0 = k;
    else if (!ok && k0 >= 0) { runs.push([k0, k]); k0 = -1; }
  }
  return runs;
}

/** Percentile (0..100) of the finite values of v, linear between order statistics. NaN if none. */
export function percentileOf(v, p) {
  const a = [];
  for (const x of v) if (x === x) a.push(x);
  if (!a.length) return NaN;
  a.sort((x, y) => x - y);
  const r = (Math.min(100, Math.max(0, p)) / 100) * (a.length - 1), i = Math.floor(r), f = r - i;
  return i + 1 < a.length ? a[i] + (a[i + 1] - a[i]) * f : a[i];
}

// ---------------------------------------------------------------- waves

/** Periodic wave of period 1 in [-1, 1]: sine (cos-free), triangle, saw, square. */
export const WAVES = {
  sine: (x) => Math.sin(2 * Math.PI * x),
  triangle: (x) => { const f = x - Math.floor(x); return f < 0.25 ? 4 * f : f < 0.75 ? 2 - 4 * f : 4 * f - 4; },
  saw: (x) => { const f = x - Math.floor(x); return 2 * f - 1; },
  square: (x) => (x - Math.floor(x) < 0.5 ? 1 : -1),
};
export const WAVE_NAMES = Object.keys(WAVES);

// ---------------------------------------------------------------- spans as a time function

/**
 * Box-average over [t - fadeMs/2, t + fadeMs/2] of the piecewise-constant function that is valueOf(span) inside each
 * flattened span and `outside` elsewhere. With fadeMs 0 it is the plain step function. The averaging gives exact
 * linear crossfades centred on every boundary, and short spans never overshoot.
 * -> (t) => number
 */
export function spanStep(list, valueOf, outside, fadeMs = 0) {
  const flat = flattenSpans(list || []).filter((s) => s.t1 > s.t0);
  const t0s = flat.map((s) => s.t0), vals = flat.map(valueOf);
  const at = (t) => { // value of the step at t
    let lo = 0, hi = flat.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (t0s[m] <= t) lo = m + 1; else hi = m; }
    const s = flat[lo - 1];
    return s && t < s.t1 ? vals[lo - 1] : outside;
  };
  if (!(fadeMs > 0) || !flat.length) return at;
  const h = fadeMs / 2;
  return (t) => {
    const a = t - h, b = t + h;
    // integrate the step over [a, b] across the boundaries inside it
    let lo = 0, hi = flat.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (flat[m].t1 <= a) lo = m + 1; else hi = m; }
    let acc = 0, x = a;
    for (let i = lo; i < flat.length && flat[i].t0 < b; i++) {
      const s = flat[i], s0 = Math.max(a, s.t0), s1 = Math.min(b, s.t1);
      if (s0 > x) acc += (s0 - x) * outside;
      if (s1 > s0) acc += (s1 - s0) * vals[i];
      x = Math.max(x, s1);
    }
    if (b > x) acc += (b - x) * outside;
    return acc / fadeMs;
  };
}

// ---------------------------------------------------------------- scripts

/** Actions of `s` with t0 <= at < t1 (half-open). */
export const sliceHalfOpen = (s, t0, t1) => s.slice(lowerBound(s, t0), lowerBound(s, t1));

/** Interpolated action at t, or null when t is outside the script. */
export function edgePoint(s, t) {
  if (!s.length || t < s[0].at || t > s[s.length - 1].at) return null;
  return { at: t, pos: clampPos(posAt(s, t)) };
}

/** Append `piece` to `out` (in place) through a speed-capped join (gen/plan.js appendJoined, made local: not exported there). */
export function appendJoined(out, piece, opts, warn) {
  if (!piece.length) return;
  const { dropLeft, dropRight, ok } = joinPlan(out, piece, opts);
  out.length -= dropLeft;
  if (!ok && out.length && warn) {
    const p = out[out.length - 1], q = piece[dropRight];
    warn(`join at ${q.at} ms moves at ${Math.round((Math.abs(q.pos - p.pos) * 1000) / Math.max(1, q.at - p.at))} pos/s (over the cap)`);
  }
  for (let j = dropRight; j < piece.length; j++) out.push(piece[j]);
}

/**
 * `insert` inside the (flattened, non-point) spans, `base` outside. Each piece is cut exactly at its boundaries with
 * interpolated edge points (the last one 1 ms before the next piece starts). seam 'blend' joins the pieces under
 * maxSpeed, removing points within seamMs of a join (gen/util joinPlan); 'cut' concatenates.
 */
export function splice(base, insert, where, { seam = 'cut', seamMs = 150, maxSpeed = 450, minGapMs = 1, warn } = {}) {
  const W = flattenSpans(where || []).filter((s) => s.t1 > s.t0);
  if (!W.length) return base;
  const pieces = [];
  let at = -Infinity;
  const take = (src, t0, t1) => { // [t0, t1) of src, cut with edge points
    if (t1 <= t0) return;
    const inner = sliceHalfOpen(src, t0, t1);
    const p = [];
    const e0 = Number.isFinite(t0) ? edgePoint(src, t0) : null;
    if (e0 && inner[0]?.at !== t0) p.push(e0);
    p.push(...inner);
    const e1 = Number.isFinite(t1) ? edgePoint(src, t1 - 1) : null;
    if (e1 && (!p.length || p[p.length - 1].at < t1 - 1)) p.push(e1);
    if (p.length) pieces.push(p);
  };
  for (const s of W) { take(base, at, s.t0); take(insert, s.t0, s.t1); at = s.t1; }
  take(base, at, Infinity);
  const out = [];
  if (seam === 'blend') {
    const opts = { maxSpeed, minGapMs, windowMs: seamMs };
    for (const p of pieces) appendJoined(out, p, opts, warn);
  } else {
    for (const p of pieces) for (const a of p) if (!out.length || a.at > out[out.length - 1].at) out.push(a);
  }
  return out;
}
