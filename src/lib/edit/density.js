// Density: fewer or more points, smoothing. Operations work per contiguous run of selected actions; the ends of each run are
// kept unless stated, unselected actions are never touched.
import { selInfo, runsOf, dropFlagged, compose, easeFn, clamp, rnd, pos100, O, fin } from './util.js';
import { turns } from './strokes.js';
import { cleanMicro as cleanMicroScript } from '../core/script.js';

/** Ramer-Douglas-Peucker on parallel arrays. keep: Uint8Array with the forced points pre-marked (at least both ends); it is filled in.
 *  Distance is the vertical pos error against the chord (what a player interpolates), or perpendicular with time scaled by `scale`. */
export function rdp(ts, vs, keep, tol, perpendicular = false, scale = 0.1) {
  const stack = [];
  let prev = -1;
  for (let i = 0; i < keep.length; i++) if (keep[i]) { if (prev >= 0 && i - prev > 1) stack.push([prev, i]); prev = i; }
  while (stack.length) {
    const [a, b] = stack.pop(), dt = ts[b] - ts[a], dv = vs[b] - vs[a], len = Math.hypot(dt * scale, dv);
    let md = -1, mi = -1;
    for (let k = a + 1; k < b; k++) {
      const d = perpendicular ? Math.abs(dt * scale * (vs[k] - vs[a]) - dv * (ts[k] - ts[a]) * scale) / len : Math.abs(vs[k] - (vs[a] + (dv * (ts[k] - ts[a])) / dt));
      if (d > md) { md = d; mi = k; }
    }
    if (md > tol + 1e-9) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return keep;
}

/** Simplify with RDP. tolerance in pos units (0 removes only collinear points). metric 'vertical' | 'perpendicular' (timeScale = pos units per ms).
 *  keepTurns: turning points (prominence >= keepProminence) are never removed. */
export function simplify(script, sel, opts) {
  const { tolerance = 2, metric = 'vertical', timeScale = 0.1, keepTurns = false, keepProminence = 0 } = O(opts);
  const info = selInfo(script, sel);
  if (info.n < 3) return { script, ats: info.idx.map((i) => script[i].at) };
  const tm = new Uint8Array(script.length);
  if (keepTurns) for (const t of turns(script, keepProminence)) tm[t.i] = 1;
  const drop = new Uint8Array(script.length);
  for (const [k0, k1] of runsOf(info.idx)) {
    const len = k1 - k0 + 1;
    if (len < 3) continue;
    const ts = new Float64Array(len), vs = new Float64Array(len), keep = new Uint8Array(len);
    for (let q = 0; q < len; q++) { const i = info.idx[k0 + q]; ts[q] = script[i].at; vs[q] = script[i].pos; keep[q] = tm[i]; }
    keep[0] = keep[len - 1] = 1;
    rdp(ts, vs, keep, tolerance, metric === 'perpendicular', timeScale);
    for (let q = 0; q < len; q++) if (!keep[q]) drop[info.idx[k0 + q]] = 1;
  }
  return dropFlagged(script, drop, info);
}

/** Thin so that kept actions are at least minGapMs apart (gaps to unselected neighbours are not checked).
 *  keep 'first': the first of each cluster survives; 'extreme': a cluster keeps whichever point reaches furthest from the previous kept one. */
export function thinMinGap(script, sel, opts) {
  const { minGapMs = 100, keep = 'first' } = O(opts);
  const info = selInfo(script, sel), drop = new Uint8Array(script.length);
  for (const [k0, k1] of runsOf(info.idx)) {
    const kept = [];
    for (let q = k0; q <= k1; q++) {
      const j = info.idx[q], a = script[j], last = kept.length ? script[kept[kept.length - 1]] : null;
      if (!last || a.at - last.at >= minGapMs) { kept.push(j); continue; }
      if (keep === 'extreme' && kept.length >= 2) {
        const pp = script[kept[kept.length - 2]];
        if (Math.sign(a.pos - pp.pos) === Math.sign(last.pos - pp.pos) && Math.abs(a.pos - pp.pos) > Math.abs(last.pos - pp.pos)) kept[kept.length - 1] = j;
      }
    }
    const ks = new Set(kept);
    for (let q = k0; q <= k1; q++) if (!ks.has(info.idx[q])) drop[info.idx[q]] = 1;
  }
  return dropFlagged(script, drop, info);
}

/** Keep only turning points (prominence >= minProminence); keepEnds also keeps the first and last selected action. */
export function keepExtremes(script, sel, opts) {
  const { minProminence = 0, keepEnds = true } = O(opts);
  const info = selInfo(script, sel), tm = new Uint8Array(script.length), drop = new Uint8Array(script.length);
  for (const t of turns(script, minProminence)) tm[t.i] = 1;
  info.idx.forEach((i, q) => { if (!tm[i] && !(keepEnds && (q === 0 || q === info.n - 1))) drop[i] = 1; });
  return dropFlagged(script, drop, info);
}

/** Remove reversals smaller than `threshold` pos units (the turning points that only exist below that prominence). Script ends stay. */
export function removeMicroReversals(script, sel, opts) {
  const threshold = fin(O(opts).threshold, 3);
  const info = selInfo(script, sel), drop = new Uint8Array(script.length);
  const big = new Set(turns(script, threshold, { endpoints: false }).map((t) => t.i));
  for (const t of turns(script, 0, { endpoints: false })) {
    if (info.m[t.i] && !big.has(t.i) && t.i !== 0 && t.i !== script.length - 1) drop[t.i] = 1;
  }
  return dropFlagged(script, drop, info);
}

/** Remove micro glitches (core/script.js cleanMicro: blips, back-steps and stalls under gapMs / posTol) among the selected
 *  actions; the actions around them are the context, never removed. opts: { gapMs, posTol, minGapMs }. */
export function cleanMicro(script, sel, opts) {
  const { gapMs, posTol, minGapMs } = O(opts), info = selInfo(script, sel);
  const spans = sel ? runsOf(info.idx).map(([a, b]) => [script[info.idx[a]].at, script[info.idx[b]].at]) : null;
  const out = cleanMicroScript(script, { gapMs, posTol, minGapMs, spans });
  const left = new Set(out.map((a) => a.at));
  return { script: out, ats: info.idx.map((i) => script[i].at).filter((t) => left.has(t)) };
}

function insertBetween(script, sel, planner) {
  const info = selInfo(script, sel), out = [], ats = [];
  for (let i = 0; i < script.length; i++) {
    const a = script[i];
    out.push(a);
    if (info.m[i]) ats.push(a.at);
    if (info.m[i] && i + 1 < script.length && info.m[i + 1]) {
      for (const p of planner(a, script[i + 1])) { out.push(p); ats.push(p.at); }
    }
  }
  return { script: out, ats };
}

/** Insert `count` evenly spaced points (on the straight line) between neighbouring selected actions; segments shorter than minSegmentMs are skipped. */
export function addMidpoints(script, sel, opts) {
  const { count = 1, minSegmentMs = 0 } = O(opts);
  return insertBetween(script, sel, (a, b) => {
    const dt = b.at - a.at, c = Math.min(Math.floor(count), dt - 1), r = [];
    if (dt < minSegmentMs) return r;
    for (let j = 1; j <= c; j++) r.push({ at: a.at + rnd((dt * j) / (c + 1)), pos: pos100(a.pos + ((b.pos - a.pos) * j) / (c + 1)) });
    return r;
  });
}

/** Subdivide each segment between neighbouring selected actions into `steps`+1 pieces whose positions follow an easing shape:
 *  shape 'linear' | 'sine' | 'easeIn' | 'easeOut' | 'easeInOut' | 'twoSpeed' (first `split` of the time is `ratio` times faster).
 *  stepMs > 0 chooses the number of points from the segment length instead of `steps`. */
export function subdivide(script, sel, opts) {
  const { steps = 3, shape = 'sine', ratio = 2, split = 0.5, stepMs = 0 } = O(opts), ease = easeFn(shape, { ratio, split });
  return insertBetween(script, sel, (a, b) => {
    const dt = b.at - a.at, want = stepMs > 0 ? Math.floor(dt / stepMs) - 1 : Math.floor(steps), c = Math.min(want, dt - 1), r = [];
    for (let j = 1; j <= c; j++) r.push({ at: a.at + rnd((dt * j) / (c + 1)), pos: pos100(a.pos + (b.pos - a.pos) * ease(j / (c + 1))) });
    return r;
  });
}

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

/** Least-squares polynomial weights over a window of w points (x = -h..h) evaluated at xs: returns w weights. */
export function savgolWeights(w, order, xs = 0) {
  const h = (w - 1) / 2, m = order + 1, A = [], rhs = [];
  for (let r = 0; r < m; r++) {
    A.push([]);
    for (let c = 0; c < m; c++) { let s = 0; for (let x = -h; x <= h; x++) s += x ** (r + c); A[r].push(s); }
    rhs.push(xs ** r);
  }
  const v = solve(A, rhs), out = [];
  for (let x = -h; x <= h; x++) { let s = 0; for (let r = 0; r < m; r++) s += v[r] * x ** r; out.push(s); }
  return out;
}

/** Smooth a sampled series in place-copy. method 'moving' (window shrinks symmetrically at the ends, so ends are unchanged) | 'savgol'. */
export function smoothSeries(ys, method, w, order) {
  const n = ys.length, out = new Float64Array(n);
  if (method === 'savgol') {
    w = Math.min(w | 1, n % 2 ? n : n - 1);
    if (w <= order || w < 3) return Float64Array.from(ys);
    const h = (w - 1) / 2, mid = savgolWeights(w, order, 0), edge = new Map();
    for (let i = 0; i < n; i++) {
      let lo = i - h, wt = mid, xs = 0;
      if (i < h || i > n - 1 - h) {
        lo = clamp(i - h, 0, n - w); xs = i - (lo + h);
        if (!edge.has(xs)) edge.set(xs, savgolWeights(w, order, xs));
        wt = edge.get(xs);
      }
      let s = 0; for (let j = 0; j < w; j++) s += wt[j] * ys[lo + j];
      out[i] = s;
    }
    return out;
  }
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + ys[i];
  const h = Math.max(0, (w - 1) >> 1);
  for (let i = 0; i < n; i++) { const k = Math.min(h, i, n - 1 - i); out[i] = (pre[i + k + 1] - pre[i - k]) / (2 * k + 1); }
  return out;
}

/** Smooth the selected curve: resample every `step` ms, smooth (method 'moving' | 'savgol', window in ms, polynomial `order` for
 *  savgol), then refit: 'times' = keep the same actions, take the smoothed value at their times; 'simplify' = replace the run by an RDP
 *  fit (tolerance pos units) of the smoothed curve. pinEnds keeps the first/last pos of each run. */
export function smooth(script, sel, opts) {
  const { method = 'moving', window = 200, order = 2, step = 20, refit = 'times', tolerance = 1, pinEnds = true } = O(opts);
  const info = selInfo(script, sel);
  if (info.n < 3) return { script, ats: info.idx.map((i) => script[i].at) };
  const st = Math.max(1, step), w = Math.max(1, Math.round(window / st)) | 1;
  const moved = [];
  for (const [k0, k1] of runsOf(info.idx)) {
    const pts = []; for (let q = k0; q <= k1; q++) pts.push(script[info.idx[q]]);
    if (pts.length < 3) { moved.push(...pts); continue; }
    const t0 = pts[0].at, t1 = pts[pts.length - 1].at, ts = [], ys = [];
    let j = 0;
    for (let t = t0; ; t += st) {
      const tt = Math.min(t, t1);
      while (j + 1 < pts.length && pts[j + 1].at < tt) j++;
      const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
      ts.push(tt); ys.push(b.at === a.at ? a.pos : a.pos + ((b.pos - a.pos) * (tt - a.at)) / (b.at - a.at));
      if (tt >= t1) break;
    }
    const sm = smoothSeries(ys, method, w, order);
    if (refit === 'simplify') {
      const keep = new Uint8Array(ts.length); keep[0] = keep[ts.length - 1] = 1;
      rdp(ts, sm, keep, tolerance);
      for (let q = 0; q < ts.length; q++) if (keep[q]) moved.push({ at: ts[q], pos: pinEnds && (q === 0 || q === ts.length - 1) ? (q === 0 ? pts[0].pos : pts[pts.length - 1].pos) : sm[q] });
    } else {
      let g = 0;
      pts.forEach((a, q) => {
        while (g + 1 < ts.length - 1 && ts[g + 1] <= a.at) g++;
        const t = ts[g], u = ts[Math.min(g + 1, ts.length - 1)], v = u === t ? sm[g] : sm[g] + ((sm[Math.min(g + 1, ts.length - 1)] - sm[g]) * (a.at - t)) / (u - t);
        moved.push({ at: a.at, pos: pinEnds && (q === 0 || q === pts.length - 1) ? a.pos : v });
      });
    }
  }
  return compose(script, info.m, moved);
}
