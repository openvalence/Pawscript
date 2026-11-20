// Shared plumbing for every edit operation. See README.md for the calling convention.
import { lowerBound, indexAt, clampPos } from '../core/script.js';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** Round to an integer, never -0 (deepStrictEqual and JSON care). */
export const rnd = (v) => Math.round(v) + 0;
export const pos100 = (v) => clampPos(v) + 0;
export const fin = (v, d) => (Number.isFinite(v) ? v : d);
export const O = (o) => o || {};

/** Selected-index mask for a selection: {ats}, {t0,t1} (either may be omitted) or null (everything). */
export function selMask(script, sel) {
  const n = script.length, m = new Uint8Array(n);
  if (!sel) { m.fill(1); return m; }
  if (sel.ats) { for (const t of sel.ats) { const i = indexAt(script, t); if (i >= 0) m[i] = 1; } return m; }
  let lo = sel.t0 ?? -Infinity, hi = sel.t1 ?? Infinity;
  if (lo > hi) [lo, hi] = [hi, lo];
  const a = lowerBound(script, lo), b = lowerBound(script, hi + 1);
  for (let i = a; i < b; i++) m[i] = 1;
  return m;
}

/** Everything an op needs to know about its selection. t0/t1: the range (given range, else first/last selected at). */
export function selInfo(script, sel) {
  const m = selMask(script, sel), idx = [];
  for (let i = 0; i < m.length; i++) if (m[i]) idx.push(i);
  const isRange = !!sel && !sel.ats && (sel.t0 != null || sel.t1 != null);
  let t0 = null, t1 = null;
  if (isRange) {
    t0 = sel.t0 ?? 0; t1 = sel.t1 ?? (script.length ? script[script.length - 1].at : 0);
    if (t0 > t1) [t0, t1] = [t1, t0];
  } else if (idx.length) { t0 = script[idx[0]].at; t1 = script[idx[idx.length - 1]].at; }
  return { m, idx, n: idx.length, isRange, t0, t1 };
}

/** Contiguous runs of script indices: [[firstK, lastK]] positions into idx. */
export function runsOf(idx) {
  const r = [];
  for (let k = 0; k < idx.length;) {
    let e = k;
    while (e + 1 < idx.length && idx[e + 1] === idx[e] + 1) e++;
    r.push([k, e]); k = e + 1;
  }
  return r;
}

/** Stable sort by `at`; on equal `at` the later entry wins. */
export function sortDedupe(pts) {
  const s = pts.map((a, i) => [a, i]).sort((x, y) => x[0].at - y[0].at || x[1] - y[1]);
  const out = [];
  for (const [a] of s) { if (out.length && out[out.length - 1].at === a.at) out[out.length - 1] = a; else out.push(a); }
  return out;
}

function sanitize(pts) {
  const out = [];
  for (const a of pts) {
    if (!a || !Number.isFinite(a.at) || !Number.isFinite(a.pos)) continue;
    const at = Math.max(0, rnd(a.at)), pos = pos100(a.pos);
    out.push(at === a.at && pos === a.pos ? a : { at, pos });
  }
  return out;
}

const sortedStrict = (p) => { for (let i = 1; i < p.length; i++) if (p[i].at <= p[i - 1].at) return false; return true; };

/** Merge two sorted Scripts; `pts` wins on equal `at`. */
export function mergeWin(base, pts) {
  const out = []; let j = 0;
  for (let i = 0; i < base.length; i++) {
    const a = base[i];
    while (j < pts.length && pts[j].at < a.at) out.push(pts[j++]);
    if (j < pts.length && pts[j].at === a.at) continue;
    out.push(a);
  }
  while (j < pts.length) out.push(pts[j++]);
  return out;
}

/** Final step of most ops: unselected actions stay, `moved` (any order, clamped/rounded here) replaces the selected ones.
 *  Moved points win collisions; among moved ones the later in the list wins. ats = survivors' timestamps. */
export function compose(script, m, moved) {
  let mv = sanitize(moved);
  if (!sortedStrict(mv)) mv = sortDedupe(mv);
  const base = []; for (let i = 0; i < script.length; i++) if (!m[i]) base.push(script[i]);
  return { script: mergeWin(base, mv), ats: mv.map((a) => a.at) };
}

/** Clamp new times of selected indices between their unselected neighbours, keeping their order. */
export function clampTimes(script, idx, targets) {
  const n = script.length, out = targets.map(rnd);
  for (let k = 0; k < idx.length;) {
    let e = k;
    while (e + 1 < idx.length && idx[e + 1] === idx[e] + 1) e++;
    const lo = idx[k] > 0 ? script[idx[k] - 1].at + 1 : 0;
    const hi = idx[e] < n - 1 ? script[idx[e] + 1].at - 1 : Infinity;
    for (let q = k; q <= e; q++) {
      let t = clamp(out[q], lo, hi);
      if (q > k && t < out[q - 1] + 1) t = out[q - 1] + 1;
      out[q] = t;
    }
    for (let q = e; q >= k; q--) { const mx = q === e ? hi : out[q + 1] - 1; if (out[q] > mx) out[q] = mx; }
    k = e + 1;
  }
  return out;
}

/** Retime (and optionally re-pos) the selected actions. fAt(a, k, info) -> new at; fPos(a, k, info) -> new pos.
 *  collide: 'moved' (moved point wins, may reorder) | 'clamp' (stay between unselected neighbours). */
export function retime(script, sel, fAt, { collide = 'moved', fPos } = {}) {
  const info = selInfo(script, sel);
  if (!info.n) return { script, ats: [] };
  let at = info.idx.map((i, k) => fAt(script[i], k, info));
  at = collide === 'clamp' ? clampTimes(script, info.idx, at) : at.map((t) => Math.max(0, rnd(t)));
  const moved = info.idx.map((i, k) => ({ at: at[k], pos: fPos ? fPos(script[i], k, info) : script[i].pos }));
  return compose(script, info.m, moved);
}

export function selStats(script, info) {
  let min = Infinity, max = -Infinity, sum = 0;
  for (const i of info.idx) { const p = script[i].pos; if (p < min) min = p; if (p > max) max = p; sum += p; }
  return { min, max, mean: info.n ? sum / info.n : 0 };
}

/** Change only pos of the selected actions: f(pos, action, k, ctx) -> new pos. ctx = {min,max,mean,t0,t1,n}. */
export function mapPos(script, sel, f) {
  const info = selInfo(script, sel);
  if (!info.n) return { script, ats: [] };
  const ctx = { ...selStats(script, info), t0: info.t0, t1: info.t1, n: info.n };
  const out = script.slice(), ats = [];
  info.idx.forEach((i, k) => { const a = script[i]; out[i] = { at: a.at, pos: pos100(f(a.pos, a, k, ctx)) }; ats.push(a.at); });
  return { script: out, ats };
}

/** Remove the actions flagged in `drop` (Uint8Array over script); ats = selected survivors. */
export function dropFlagged(script, drop, info) {
  const out = []; for (let i = 0; i < script.length; i++) if (!drop[i]) out.push(script[i]);
  return { script: out, ats: info.idx.filter((i) => !drop[i]).map((i) => script[i].at) };
}

/** Linear pos at time t from a sorted array of actions (held outside). */
export function interp(pts, t) {
  if (!pts.length) return NaN;
  const i = lowerBound(pts, t);
  if (i === 0) return pts[0].pos;
  if (i === pts.length) return pts[i - 1].pos;
  const a = pts[i - 1], b = pts[i];
  return a.pos + ((b.pos - a.pos) * (t - a.at)) / (b.at - a.at);
}

/** Repeat a snippet. rel: [{at relative to 0, pos}], copies start at a0 + k*period, stop after `copies` copies or past a1
 *  (the cut is closed with an interpolated point at a1). seam: what happens when copy k's last point and copy k+1's
 *  first point share a timestamp: 'next' | 'prev' | 'mean'. */
export function tile(rel, period, a0, a1 = Infinity, { copies = Infinity, seam = 'next', cut = 'interpolate' } = {}) {
  const out = [];
  if (!rel.length || !(period > 0)) return out;
  let cutDone = false;
  for (let k = 0; k < copies && k < 1e6 && !cutDone; k++) {
    const base = a0 + k * period;
    if (base > a1) break;
    for (let j = 0; j < rel.length; j++) {
      const at = rnd(base + rel[j].at), pos = rel[j].pos;
      if (at > a1) {
        const prev = out[out.length - 1];
        if (cut === 'interpolate' && prev && prev.at < a1) {
          out.push({ at: a1, pos: pos100(prev.pos + ((pos - prev.pos) * (a1 - prev.at)) / (at - prev.at)) });
        }
        cutDone = true; break;
      }
      const last = out[out.length - 1];
      if (last && last.at === at) {
        if (seam === 'next') out[out.length - 1] = { at, pos };
        else if (seam === 'mean') out[out.length - 1] = { at, pos: pos100((last.pos + pos) / 2) };
      } else out.push({ at, pos });
    }
  }
  return sortDedupe(out);
}

// Deterministic, selection-independent randomness: the value for a given (seed, at, salt) never changes.
export function hash01(seed, at, salt = 0) {
  let h = (seed | 0) ^ Math.imul(at | 0, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Seeded stream (mulberry32). */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const EASE = {
  linear: (u) => u,
  sine: (u) => (1 - Math.cos(Math.PI * u)) / 2,
  easeIn: (u) => u * u,
  easeOut: (u) => 1 - (1 - u) * (1 - u),
  easeInOut: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)),
};
/** Easing by name. twoSpeed: the first `split` of the time is travelled `ratio` times faster than the rest. */
export function easeFn(name = 'linear', { ratio = 2, split = 0.5 } = {}) {
  if (name === 'twoSpeed') {
    const s = clamp(split, 0.01, 0.99), r = Math.max(0.01, ratio), f1 = (r * s) / (r * s + (1 - s));
    return (u) => (u < s ? (f1 * u) / s : f1 + ((1 - f1) * (u - s)) / (1 - s));
  }
  return EASE[name] || EASE.linear;
}

export const frameSnap = (t, frameMs, origin = 0) => (frameMs > 0 ? rnd(Math.round((t - origin) / frameMs) * frameMs + origin) : rnd(t));
