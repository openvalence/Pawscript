// strokes.js -- one signal -> script points, deterministic and explainable (paw-e3i part 2). Pure (test/strokes.test.mjs).
// The sidecar's to_points (pawtrack/pipeline.py) ported to the live path, with the owner's range policy:
//  1. short gaps (<= maxGapMs) bridged; longer ones split the scene into pieces (no stroke across a hole).
//  2. smoothing: Savitzky-Golay, order 2, smoothMs wide (the sidecar's pipe_smooth_ms 150: keeps turn timing).
//  3. turns: local maxima / minima whose prominence is at least minStroke x the LOCAL amplitude (p5..p95 over a 3 s
//     window, the sidecar's local range): jitter never becomes a stroke, a real small stroke between small strokes
//     still does. Forced to alternate (the more extreme of a same-kind run wins); a stroke shorter than minMs (turn to
//     turn) goes with its smaller neighbour.
//  4. timing: each turn refined to sub-frame (parabola through the three samples); with a `timing` series (fusion.js:
//     the best-timed contributors) the turn takes that series' same-kind extremum within a quarter stroke.
//  5. depth (pos 0 = deepest, 100 = out; larger value = out): range 'scene' = the piece's robust p2..p98 after its drift
//     over two strokes is taken out (default),
//     'follow' = a slow envelope (p5..p95 over followMs, 8 s), 'local' = the sidecar's 3 s window (every stroke full
//     size: kept for comparison). Never renormalised per stroke: a shallow stroke stays shallow.
//     'abs' (paw-4c48.10, an absolute channel: the shaft source) = 100 x the smoothed signal, as it reads.
//     'compress' (paw-woz5, the owner's "bus compressor": long handheld / POV runs) = per stroke, not per sample: each
//     turn's distance from its stroke's own centre is compressed above a soft knee at threshold x the run's MEDIAN stroke
//     (so a few big strokes never set the scale; under the knee unchanged; slope 1 - amount above it, so a bigger stroke
//     stays bigger), the centre's moves shorter than centreMs taken out (a drift does not eat the range) and longer ones
//     kept, compressed the same way about the run's median level, through a dead band (a stroke's own lopsidedness is no
//     drift); zero-phase (offline), no gain envelope (nothing pumps after a big stroke); the path between two turns
//     re-mapped onto them by one linear map (shape kept, continuous at the turns); then the turns' min..max onto 0..100
//     (the make-up gain: no turn is clipped). compressCurve is the law; the Adjust panel draws it with its two handles.
//     'shaft' (paw-azd) = 'scene', then every turn anchored to the shaft's measured depth (opts.depth: the visible share
//     0..1 per sample, lib/shaft.js shaftDepth; NaN = not confident): a top takes the depth's maximum, a bottom its
//     minimum within a quarter stroke (the mask may lag a frame), the path between two turns re-mapped onto their anchors
//     by one linear map of its level (its shape kept; done before the clip to 0..100, paw-6t7d). The timing stays the
//     signal's (and the timing series'). Under half the piece confident: 'scene' (and a shaft whose depth does not follow
//     the signal is never handed in: runs-channel.js pointsFromChannel, shaft.js depthR).
//  6. detail (paw-izk, lib/stroke-shape.js): between two turns at most one midpoint, and one hold per turn where the
//     signal dwells (shape 'hold', the default), or 'mid' / 'turns'; 'render' (paw-na9u) = the points chosen so the device's
//     curve follows the trace (fitted to the depth before it is kept inside 0..100, against the turns' final times, within
//     maxSpeed: paw-6t7d; opts.trace
//     [] collects that depth per piece); 'free' = Douglas-Peucker at a tolerance (`detail` pos, else the sensitivity's).
//     Per half-stroke the setting at its time: `shapes` [{t0, t1, shape, sens}] (scene default, shot and area overrides:
//     lib/detail.js detailSpans), else shape / sens.
//  7. speed: a step faster than maxSpeed pos/s is shortened in depth (its time kept), marked 'clamped'.
//  8. low confidence (conf series < lowConf for >= lowMs): the span is returned, its inner points dropped (Fill / bridge).
// -> {points: [{at, pos, why: 'turn' | 'mid' | 'shoulder' | 'hold' | 'detail' | 'end' | 'clamped', by?, cap? (by render: the speed
//    cap limited the shape of the half-stroke from this turn, paw-6t7d)}], low: [{t0, t1}]}.

import { shapeFit, shapeAt, exactMids, RENDER_DEBUG } from './stroke-shape.js';

export const STROKES = { smoothMs: 150, minStroke: 0.04, minMs: 120, range: 'scene', followMs: 8000, detail: 0, shape: 'hold', sens: 50, maxSpeed: 600, minIntervalMs: 60, maxGapMs: 500, lowConf: 0.35, lowMs: 1000 };
export const RANGES = ['scene', 'follow', 'local', 'shaft', 'compress'];
/** paw-woz5 range 'compress': amount 0..0.9 (slope above the knee = 1 - amount, log domain: 0.6 = 2.5:1), centreMs = a
 *  move of the stroke centre shorter than this is drift (taken out), longer is depth (kept), threshold = the knee in
 *  x the run's median stroke (not a handle: ponytail, exposed when the owner's long runs say it needs to move). */
export const COMPRESS = { amount: 0.6, centreMs: 8000, threshold: 1.5 };
const NORM_MS = 3000;
const fin = Number.isFinite;

/** Savitzky-Golay smoothing, quadratic, half-width h (edges: the window shrinks symmetrically). */
export function savgol(v, h) {
  const n = v.length;
  if (h < 2 || n < 5) return Float64Array.from(v);
  const out = new Float64Array(n);
  const coef = (m) => { const d = (2 * m + 1) * (2 * m - 1) * (2 * m + 3); return Array.from({ length: 2 * m + 1 }, (_, k) => (3 * (3 * m * m + 3 * m - 1) - 15 * (k - m) ** 2) / d); };
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    const m = Math.min(h, i, n - 1 - i);
    if (m < 1) { out[i] = v[i]; continue; }
    if (!cache.has(m)) cache.set(m, coef(m));
    const c = cache.get(m);
    let s = 0;
    for (let k = -m; k <= m; k++) s += c[k + m] * v[i + k];
    out[i] = s;
  }
  return out;
}
const pctOf = (b, p) => { if (!b.length) return NaN; const x = (b.length - 1) * p, i = Math.floor(x); return b[i] + (b[Math.min(b.length - 1, i + 1)] - b[i]) * (x - i); };   // b sorted
function pct(a, p) { return pctOf(Float64Array.from(a).sort(), p); }
/** Rolling p-lo / p-hi over w samples (stride sampled), then a moving average: the sidecar's _range. */
function rolling(v, w, lo, hi) {
  const n = v.length, L = new Float64Array(n), H = new Float64Array(n), step = Math.max(1, Math.floor(w / 16)), h = Math.floor(w / 2);
  const kl = [], kh = [], at = [];
  // paw-o60v.2: the window kept sorted as it slides (each value in and out once) instead of a sort per stride; Float64Array
  // sort's order exactly (-0 before +0), so the percentiles are the same numbers. A NaN anywhere: a sort per stride, as before
  let finite = true;
  for (let i = 0; i < n; i++) if (!fin(v[i])) { finite = false; break; }
  if (finite) {
    const buf = new Float64Array(2 * h + 2), lt = (x, y) => x < y || (x === 0 && y === 0 && 1 / x < 0 && 1 / y > 0);
    let len = 0, a0 = 0, b0 = 0;
    const lb = (x) => { let l = 0, r = len; while (l < r) { const md = (l + r) >> 1; if (lt(buf[md], x)) l = md + 1; else r = md; } return l; };
    for (let i = 0; i < n; i += step) {
      const a = Math.max(0, i - h), b = Math.min(n, i + h + 1);
      for (; a0 < a; a0++) { const k = lb(+v[a0]); buf.copyWithin(k, k + 1, len); len--; }
      for (; b0 < b; b0++) { const x = +v[b0], k = lb(x); buf.copyWithin(k + 1, k, len); buf[k] = x; len++; }
      const s = buf.subarray(0, len);
      kl.push(pctOf(s, lo)); kh.push(pctOf(s, hi)); at.push(i);
    }
  } else for (let i = 0; i < n; i += step) { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1), s = Float64Array.from(v.subarray ? v.subarray(a, b) : v.slice(a, b)).sort(); kl.push(pctOf(s, lo)); kh.push(pctOf(s, hi)); at.push(i); }
  for (let i = 0; i < n; i++) {   // linear between the stride samples, then a moving average of w
    const k = Math.min(at.length - 1, Math.floor(i / step)), k2 = Math.min(at.length - 1, k + 1), f = k2 > k ? (i - at[k]) / (at[k2] - at[k]) : 0;
    L[i] = kl[k] + (kl[k2] - kl[k]) * f; H[i] = kh[k] + (kh[k2] - kh[k]) * f;
  }
  const avg = (x) => { const cs = new Float64Array(n + 1), o = new Float64Array(n); for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i]; for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1); o[i] = (cs[b] - cs[a]) / (b - a); } return o; };
  return [avg(L), avg(H)];
}
/** scipy find_peaks(x, prominence >= p): indices of the local maxima (plateaus: their middle) with enough prominence. */
export function peaks(x, p) {
  const n = x.length, out = [];
  for (let i = 1; i < n - 1; i++) {
    if (!(x[i] > x[i - 1])) continue;
    let j = i;
    while (j + 1 < n && x[j + 1] === x[i]) j++;
    if (j + 1 >= n || !(x[j + 1] < x[i])) { i = j; continue; }
    const k = (i + j) >> 1;
    let lmin = x[k], rmin = x[k];
    for (let a = i - 1; a >= 0 && x[a] <= x[k]; a--) lmin = Math.min(lmin, x[a]);
    for (let b = j + 1; b < n && x[b] <= x[k]; b++) rmin = Math.min(rmin, x[b]);
    if (x[k] - Math.max(lmin, rmin) >= p) out.push(k);
    i = j;
  }
  return out;
}
/** paw-s80k: a pos rounded half away from 50, so the mirror of a rounded depth is the rounded mirror (Math.round rounds
 *  37.5 up and 62.5 up: a flip came out 1 pos off the mirror) */
export const roundPos = (p) => (p < 50 ? 100 - Math.round(100 - p) : Math.round(p));
/** paw-imsi: the time of the extreme DRAWING near sample i (an exact loop's frames are drawings: the motion turns on a frame,
 *  never between two): the most extreme sample of s (kind k: +1 max, -1 min) within reach of i; a plateau of equal values (a
 *  held drawing) -> its middle. No parabola: sub-frame refinement made a looped 4 + 4 frame stroke 149 / 185 ms (an owner clip, shot 76). */
export function frameTurn(t, s, i, k, reach = 2) {
  const n = t.length;
  let b = -1;
  for (let j = Math.max(0, i - reach); j <= Math.min(n - 1, i + reach); j++) if (fin(s[j]) && (b < 0 || k * s[j] > k * s[b])) b = j;
  if (b < 0) return t[i];
  let a = b, e = b;
  while (a > 0 && s[a - 1] === s[b]) a--;
  while (e < n - 1 && s[e + 1] === s[b]) e++;
  return (t[a] + t[e]) / 2;
}
/** paw-imsi: inside one of spans ([[t0, t1]] ms: the detected exact loops) -> true. */
export const inSpans = (spans, x) => !!spans?.length && spans.some(([a, b]) => x >= a && x <= b);
const sub = (y, i) => {   // parabola vertex offset in samples (-0.5..0.5)
  if (i < 1 || i >= y.length - 1) return 0;
  const den = y[i - 1] - 2 * y[i] + y[i + 1];
  return Math.abs(den) < 1e-12 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (y[i - 1] - y[i + 1])) / den));
};

/** 'shaft' depth: each turn's pos set to 100 x the depth's same-kind extremum within reach, the path between two turns
 *  re-mapped onto their anchors by one linear map of its level (its shape kept: paw-6t7d; before the first / after the last
 *  turn: shifted with it). In place, on the depth before it is kept inside 0..100. -> true when applied (at least half the
 *  piece confident). */
function anchor(pos, turns, depth, reach, sign) {
  const n = pos.length;
  let ok = 0;
  for (const d of depth) if (fin(d)) ok++;
  if (ok < 0.5 * n) return false;
  const want = turns.map(([i, k]) => {
    const top = (sign < 0 ? -k : k) > 0;
    let best = NaN;
    for (let j = Math.max(0, i - reach); j <= Math.min(n - 1, i + reach); j++) if (fin(depth[j]) && !(top ? depth[j] <= best : depth[j] >= best)) best = depth[j];
    return fin(best) ? 100 * best : pos[i];
  });
  const old = turns.map(([i]) => pos[i]);
  for (let q = 1; q < turns.length; q++) {
    const a = turns[q - 1][0], b = turns[q][0], pa = old[q - 1], pb = old[q], A = want[q - 1], B = want[q];
    for (let i = a + 1; i < b; i++) pos[i] = Math.abs(pb - pa) > 1e-9 ? A + ((pos[i] - pa) * (B - A)) / (pb - pa) : A + ((B - A) * (i - a)) / (b - a);
  }
  for (let i = 0; i < turns[0][0]; i++) pos[i] += want[0] - old[0];
  for (let i = turns[turns.length - 1][0] + 1; i < n; i++) pos[i] += want[want.length - 1] - old[old.length - 1];
  turns.forEach(([i], q) => { pos[i] = want[q]; });
  return true;
}

/** Steps 2-3 on one gap-free piece (t ms, v finite): the smoothed signal y and the turns [[sample index, +1 top / -1
 *  bottom of v]], alternating. Shared with fusion's HOW (lib/fusion-how.js), so both see the same turns. */
export function findTurns(t, v, o = STROKES) {
  const n = t.length;
  if (n < 2) return { y: Float64Array.from(v), u: new Float64Array(n).fill(0.5), turns: [], dt: 1000 / 30 };
  const dt = (t[n - 1] - t[0]) / (n - 1) || 1000 / 30;
  const h = Math.floor(Math.round(o.smoothMs / dt) / 2);
  const y = savgol(v, h);
  const w = Math.max(3, Math.round(NORM_MS / dt));
  const [lo, hi] = n > w ? rolling(y, w, 0.05, 0.95) : [new Float64Array(n).fill(pct(y, 0.05)), new Float64Array(n).fill(pct(y, 0.95))];
  const u = Float64Array.from(y, (x, i) => Math.min(1, Math.max(0, 0.5 + (x - (hi[i] + lo[i]) / 2) / Math.max(hi[i] - lo[i], 1e-9))));
  // turns, alternating
  const marks = [...peaks(u, o.minStroke).map((i) => [i, 1]), ...peaks(u.map((x) => -x), o.minStroke).map((i) => [i, -1])].sort((a, b) => a[0] - b[0]);
  let turns = [];
  for (const [i, k] of marks) {
    const last = turns[turns.length - 1];
    if (last && last[1] === k) { if (k * y[i] > k * y[last[0]]) turns[turns.length - 1] = [i, k]; }
    else turns.push([i, k]);
  }
  // minimum stroke duration: the shortest too-short stroke goes with its smaller neighbour, until none is left
  for (let guard = 0; guard < n && turns.length > 2; guard++) {
    let bi = -1, bd = Infinity;
    for (let q = 1; q < turns.length; q++) { const d = t[turns[q][0]] - t[turns[q - 1][0]]; if (d < o.minMs && Math.abs(y[turns[q][0]] - y[turns[q - 1][0]]) < bd) { bd = Math.abs(y[turns[q][0]] - y[turns[q - 1][0]]); bi = q; } }
    if (bi < 0) break;
    turns.splice(bi - 1, 2);   // a turn pair out: the alternation stays
    const merged = [];
    for (const tq of turns) { const last = merged[merged.length - 1]; if (last && last[1] === tq[1]) { if (tq[1] * y[tq[0]] > tq[1] * y[last[0]]) merged[merged.length - 1] = tq; } else merged.push(tq); }
    turns = merged;
  }
  return { y, u, turns, dt };
}
/** Step 1 + findTurns over a whole signal (NaN = lost: gaps up to maxGapMs bridged, longer ones split it) -> {y (smoothed,
 *  NaN in the long gaps), turns: [[index into t, +1 / -1]]}: the turns the strokes step finds on it. */
export function signalTurns(t, v, opts = {}) {
  const o = { ...STROKES, ...opts }, n = t.length, vv = Float64Array.from({ length: n }, (_, i) => (v[i] === v[i] && v[i] != null ? v[i] : NaN)), y = new Float64Array(n).fill(NaN), turns = [];
  let a = -1;
  for (let i = 0; i < n; i++) if (vv[i] === vv[i]) { if (a >= 0 && i - a > 1 && t[i] - t[a] <= o.maxGapMs) for (let k = a + 1; k < i; k++) vv[k] = vv[a] + ((vv[i] - vv[a]) * (t[k] - t[a])) / (t[i] - t[a]); a = i; }
  for (let i = 0; i < n;) {
    if (vv[i] !== vv[i]) { i++; continue; }
    let j = i;
    while (j < n && vv[j] === vv[j]) j++;
    const r = findTurns(t.slice(i, j), vv.slice(i, j), o);
    y.set(r.y, i);
    for (const [q, k] of r.turns) turns.push([q + i, k]);
    i = j;
  }
  return { y, turns };
}

/** Range 'scene''s depth signal: y minus its drift over two strokes (a body settling, camera residue), plus the piece's mean
 *  (centred: without it, so pieces calibrated together sit alike); y as it is with under 3 turns or keepLevel. */
function undrift(t, y, turns, dt, o, centred = false) {
  const n = y.length;
  if (o.keepLevel) return y;   // (a seated level is the depth: kept, centred or not)
  if (turns.length < 3) { if (!centred) return y; let m = 0; for (const x of y) m += x; m /= n || 1; return Float64Array.from(y, (x) => x - m); }
  const iv = []; for (let q = 1; q < turns.length; q++) iv.push(t[turns[q][0]] - t[turns[q - 1][0]]);
  iv.sort((x1, x2) => x1 - x2);
  const win = Math.max(3, Math.round(Math.min(4000, Math.max(800, 4 * iv[iv.length >> 1])) / dt)), hw = win >> 1, cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + y[i];
  const mu = centred ? 0 : cs[n] / n;
  return Float64Array.from(y, (x, i) => { const l = Math.max(0, i - hw), r = Math.min(n, i + hw + 1); return x - (cs[r] - cs[l]) / (r - l) + mu; });
}
// ---- range 'compress' (paw-woz5) ----
const KNEE_W = Math.LN2 / 2;   // the soft knee: half an octave of stroke size around the threshold (log domain)
/** The compressor's law, a bus compressor's in the log domain: stroke size x (x the run's median) -> out size; unchanged
 *  below the knee, slope 1 - amount above it, a soft knee between. Strictly increasing (amount <= 0.9). */
export function compressCurve(x, amount = COMPRESS.amount, threshold = COMPRESS.threshold) {
  if (!(x > 0)) return 0;
  const L = Math.log(x), d = L - Math.log(threshold), r = Math.min(0.9, Math.max(0, amount));
  return Math.exp(d <= -KNEE_W / 2 ? L : d >= KNEE_W / 2 ? L - d * r : L - (r * (d + KNEE_W / 2) ** 2) / (2 * KNEE_W));
}
/** Zero-phase one-pole (forward, then backward) over values v at times T (ms), time constant tau. */
function follow(T, v, tau) {
  const f = Float64Array.from(v), n = f.length;
  if (!(tau > 0)) return f;
  for (let q = 1; q < n; q++) f[q] = f[q - 1] + (1 - Math.exp(-(T[q] - T[q - 1]) / tau)) * (f[q] - f[q - 1]);
  for (let q = n - 2; q >= 0; q--) f[q] = f[q + 1] + (1 - Math.exp(-(T[q + 1] - T[q]) / tau)) * (f[q] - f[q + 1]);
  return f;
}
/** Per turn: Y (its level), c (its stroke's centre: the median of the midpoints of the two half-strokes either side, so
 *  one big stroke next door does not move it), d = Y - c, L (the slow level: c followed over o.centreMs; keepLevel: c). */
function cLevels(t, y, turns, o) {
  const Y = turns.map(([i]) => y[i]), T = turns.map(([i]) => t[i]), K = Y.length, m = Y.map((v, j) => (j ? (v + Y[j - 1]) / 2 : NaN));
  const c = Y.map((_, q) => pct(m.slice(Math.max(1, q - 1), Math.min(K, q + 3)), 0.5));
  return { Y, c, d: Y.map((v, q) => v - c[q]), L: o.keepLevel ? c : follow(T, c, o.centreMs ?? COMPRESS.centreMs) };
}
/** x the gain of a size e against reference r (compressCurve(|e| / r) / (|e| / r)). */
const cGain = (e, r, o) => { const x = Math.abs(e) / r; return x > 1e-12 ? compressCurve(x, o.amount ?? COMPRESS.amount, o.threshold ?? COMPRESS.threshold) / x : 1; };
/** The out level of every turn: the turn as it is, its distance from its centre compressed (against the median distance A0:
 *  nothing under the knee), plus a level correction toward the target (the slow level compressed about the median level
 *  L0) through a dead band of a quarter of the stroke riding there: a drift or a lasting move beyond it is pulled back by
 *  the excess, a stroke's own lopsidedness inside it is left alone (so ordinary strokes keep their sizes exactly; no gain
 *  envelope either, so nothing pumps after a big stroke). The band runs forward and backward, averaged: zero-phase. */
function cOut(lv, { A0, L0 }, o) {
  const { Y, c, d, L } = lv, K = Y.length, e = L.map((l, q) => L0 + cGain(l - L0, A0, o) * (l - L0) - c[q]);
  const z = (q) => Math.max(A0, Math.abs(d[q]), Math.abs(d[q - 1] ?? 0), Math.abs(d[q + 1] ?? 0)) / 4;
  const band = (prev, x, q) => prev + Math.sign(x - prev) * Math.max(0, Math.abs(x - prev) - z(q)), f = new Float64Array(K), b = new Float64Array(K);
  f[0] = e[0]; b[K - 1] = e[K - 1];
  for (let q = 1; q < K; q++) f[q] = band(f[q - 1], e[q], q);
  for (let q = K - 2; q >= 0; q--) b[q] = band(b[q + 1], e[q], q);
  return Y.map((v, q) => v + (cGain(d[q], A0, o) - 1) * d[q] + (f[q] + b[q]) / 2);
}
/** The reference of one or more pieces calibrated together: {A0, L0, lo, hi (the out turns' min..max: the make-up)} | null. */
function cRef(lvs, o) {
  const A0 = pct(lvs.flatMap((l) => l.d.map(Math.abs)), 0.5), L0 = pct(lvs.flatMap((l) => Array.from(l.L)), 0.5);
  if (!(A0 > 1e-9)) return null;
  const O = lvs.flatMap((l) => cOut(l, { A0, L0 }, o));
  return { A0, L0, lo: Math.min(...O), hi: Math.max(...O) };
}
/** One piece's depth (before the clip) under range 'compress', or null (under 3 turns, no strokes: the scene range).
 *  o.cjoint = the reference shared by pieces split by a positioning range. */
function compressed(t, y, turns, o) {
  if (turns.length < 3) return null;
  const lv = cLevels(t, y, turns, o), ref = o.cjoint ?? cRef([lv], o);
  if (!ref || !(ref.hi - ref.lo > 1e-9)) return null;
  const O = cOut(lv, ref, o), { Y } = lv, z = new Float64Array(y.length), K = turns.length;
  // outside the turns: scaled like the end turn's stroke about its centre (continuous at the turn)
  for (let i = 0; i <= turns[0][0]; i++) z[i] = O[0] + cGain(lv.d[0], ref.A0, o) * (y[i] - Y[0]);
  for (let i = turns[K - 1][0]; i < y.length; i++) z[i] = O[K - 1] + cGain(lv.d[K - 1], ref.A0, o) * (y[i] - Y[K - 1]);
  for (let q = 1; q < K; q++) {   // between two turns: one linear map of the level onto their out levels (shape kept)
    const a = turns[q - 1][0], b = turns[q][0], dy = Y[q] - Y[q - 1], dO = O[q] - O[q - 1];
    for (let i = a; i <= b; i++) z[i] = Math.abs(dy) > 1e-12 && Math.sign(dy) === Math.sign(dO) ? O[q - 1] + ((y[i] - Y[q - 1]) * dO) / dy : O[q - 1] + (dO * (i - a)) / Math.max(1, b - a);
  }
  return z.map((x) => (100 * (x - ref.lo)) / (ref.hi - ref.lo));
}

/** One gap-free piece: t (ms), v (finite), timing (same grid, optional) -> points [{at, pos, why}]. */
function piece(t, v, o, timing, sign, depth) {
  const n = t.length;
  if (n < 2) return [];
  const { y, u, turns, dt } = findTurns(t, v, o);
  // depth
  let pos, rawD = null;   // rawD: the depth before it is kept inside 0..100 (paw-na9u: the shape a render is fitted to; clipping the top 2 % flattens every turn)
  if (o.range === 'local') pos = Float64Array.from(u, (x) => 100 * x);
  else if (o.range === 'abs') { rawD = Float64Array.from(y, (x) => 100 * x); pos = rawD.map((x) => Math.min(100, Math.max(0, x))); }   // paw-4c48.10: the signal IS pos / 100
  else if (o.range === 'compress' && (rawD = compressed(t, y, turns, o))) pos = rawD.map((x) => Math.min(100, Math.max(0, x)));   // paw-woz5
  else {
    const [a, b] = o.range === 'follow' && n > Math.round(o.followMs / dt) ? rolling(y, Math.round(o.followMs / dt), 0.05, 0.95) : [null, null];
    // scene: depth from the signal minus its drift over two strokes (a body settling, camera residue), then the
    // piece's robust p2..p98: the strokes keep their relative size, a drift does not squash them. paw-gy1r: keepLevel (a
    // fused signal seated on a depth reference, lib/depth-seat.js) = its slow level is the depth: kept
    const z = a ? y : undrift(t, y, turns, dt, o, !!o.joint);
    // paw-2lp7.15: pieces split by a positioning range share one calibration (strokes() o.joint: their joint p2..p98)
    const [p2, p98] = o.joint ?? [pct(z, 0.02), pct(z, 0.98)];
    rawD = Float64Array.from(z, (x, i) => { const l = a ? a[i] : p2, r = a ? b[i] : p98; return r - l > 1e-9 ? (100 * (x - l)) / (r - l) : 50; });
    pos = rawD.map((x) => Math.min(100, Math.max(0, x)));
  }
  if (sign < 0) for (let i = 0; i < n; i++) { pos[i] = 100 - pos[i]; if (rawD) rawD[i] = 100 - rawD[i]; }
  // timing: sub-frame on the smoothed signal, or the timing series' same-kind extremum near it
  const half = turns.length > 2 ? (t[turns[turns.length - 1][0]] - t[turns[0][0]]) / (turns.length - 1) : 500;
  const reach = Math.max(2, Math.round((0.25 * half) / dt));
  // paw-6t7d: anchored before the clip (a stroke past 0 / 100 keeps its shape for the render fit), then kept inside 0..100
  if (o.range === 'shaft' && depth && turns.length && rawD && anchor(rawD, turns, depth, reach, sign)) pos = rawD.map((x) => Math.min(100, Math.max(0, x)));
  if (o.trace) o.trace.push({ t, pos });   // (experiments/detail-render: the signal as the points' depth)
  const tTurn = (i, k) => {
    // paw-imsi: inside a detected exact loop the turn is on the frame of its extreme drawing (sub-frame everywhere else)
    if (inSpans(o.exact, t[i])) return frameTurn(t, timing && fin(timing[i]) ? timing : v, i, k, reach);
    if (timing) {
      let best = -1;
      for (let j = Math.max(1, i - reach); j <= Math.min(n - 2, i + reach); j++) if (fin(timing[j]) && k * timing[j] >= k * timing[j - 1] && k * timing[j] >= k * timing[j + 1] && (best < 0 || k * timing[j] > k * timing[best])) best = j;
      if (best >= 0) return t[best] + sub(timing, best) * dt;
    }
    return t[i] + sub(y, i) * dt;
  };
  // points: the piece's ends, the turns, and between them the stroke-shape model (a held turn sits at its arrival)
  const idx = [...new Set([0, ...turns.map((x) => x[0]), n - 1])].sort((a, b) => a - b), why = new Map(turns.map(([i, k]) => [i, k]));
  // a midpoint at its group's exact phase / level between the final times of its turns (paw-otoh: never a frame off)
  // paw-t11b: a held turn keeps its turn's time inside its hold (arrival <= the turn's time <= departure, like dressPoints):
  // a hold added or dropped never moves a turn
  let cur = -Infinity;
  const raw = exactMids(shapeFit(t, pos, idx, why, shapeAt(o), { ...o, flat: y, raw: rawD, turnAt: new Map(turns.map(([i, k]) => [i, tTurn(i, k)])) }).map((q) => {
    const k = q.why === 'turn' ? why.get(q.k) : 0;
    let at = t[q.i];
    // (k = the turn's kind on v, and the timing series runs like v: the scene's sign never changes which extremum it is;
    // paw-vtec: it used to look for the opposite one under sign -1, so a flipped scene lost its timing series)
    if (k) { cur = tTurn(q.k, k); at = q.i === q.k ? cur : Math.min(t[q.i], cur); }
    else if (q.why === 'hold') at = Math.max(t[q.i], cur);
    return { at, pos: q.pos, why: q.why, u: q.u, df: q.df, t: q.at, rel: q.rel, by: q.by, opt: q.rel === 'turns', cap: q.cap };
  }));
  const out = [], src = [];   // src: what each point is before a clamp relabels it
  for (const q of raw) {
    const at = Math.round(q.at);
    let p = q.pos, w2 = q.why, prev = out[out.length - 1];
    if (prev && q.why === 'turn' && at - prev.at < Math.max(1, o.minIntervalMs) && /^(mid|hold|detail|shoulder|opt)$/.test(src[src.length - 1])) { out.pop(); src.pop(); prev = out[out.length - 1]; }   // a turn never yields to a detail point
    // ... nor is it shortened for an optional one (paw-6t7d: a point by render that, rounded, leaves the turn over the cap goes)
    if (RENDER_DEBUG.vcap && prev && q.why === 'turn' && o.maxSpeed > 0 && src[src.length - 1] === 'opt' && Math.abs(p - prev.pos) > (o.maxSpeed * (at - prev.at)) / 1000) { out.pop(); src.pop(); prev = out[out.length - 1]; }
    if (prev) {
      const gap = at - prev.at;
      if (gap < Math.max(1, o.minIntervalMs)) continue;
      if (o.maxSpeed > 0 && Math.abs(p - prev.pos) > (o.maxSpeed * gap) / 1000) { if (q.opt) continue; p = prev.pos + Math.sign(p - prev.pos) * ((o.maxSpeed * gap) / 1000); w2 = 'clamped'; }   // (paw-na9u: a point by render is optional: left out, never shortened)
    }
    out.push({ at, pos: roundPos(p), why: w2, ...(q.by ? { by: q.by } : {}), ...(q.cap ? { cap: true } : {}) }); src.push(q.opt ? 'opt' : q.why);
  }
  return out;
}

/**
 * One scene's signal -> {points, low}. t: ms (sorted), v: raw values (NaN = lost; larger = out), opts: STROKES fields +
 * sign (+1 / -1: the scene's direction), timing (a series on t, e.g. fusion's best-timed contributors), pic (per sample:
 * its repeated picture's id or -1, stroke-shape.js PICTURES: a loop's passes get one layout), conf (0..1 per
 * sample: spans below lowConf for lowMs are returned and emptied), depth (range 'shaft': the visible share per sample).
 */
export function strokes(t, v, opts = {}) {
  const o = { ...STROKES, ...opts, ...(opts.detail > 0 && !('shape' in opts) && !opts.shapes ? { shape: 'free' } : {}) }, n = t.length, sign = o.sign < 0 ? -1 : 1;   // a bare `detail` = Free (older callers)
  const ok = (i) => v[i] === v[i] && v[i] != null;
  // bridge short gaps, split at long ones
  const vv = Float64Array.from({ length: n }, (_, i) => (ok(i) ? v[i] : NaN));
  let a = -1;
  for (let i = 0; i < n; i++) if (vv[i] === vv[i]) { if (a >= 0 && i - a > 1 && t[i] - t[a] <= o.maxGapMs) for (let k = a + 1; k < i; k++) vv[k] = vv[a] + ((vv[i] - vv[a]) * (t[k] - t[a])) / (t[i] - t[a]); a = i; }
  const out = [], P = [];
  for (let i = 0; i < n;) {
    if (vv[i] !== vv[i]) { i++; continue; }
    let j = i;
    while (j < n && vv[j] === vv[j]) j++;
    P.push([i, j]);
    i = j;
  }
  // paw-2lp7.15 (the owner: "smart stroke keeps the stroke as close to video as possible"): pieces split by a positioning range
  // (o.mask [[t0, t1]]: the gap between them lies over one) are one stretch of the shot: range 'scene' / 'shaft' calibrates
  // them together (their joint p2..p98, each centred), never each to full on its own. A gap of any other kind keeps its own
  // paw-woz5: 'compress' the same: one reference (median stroke, median level, make-up) over the pieces of the stretch
  const joint = new Map(), comp = o.range === 'compress';
  if (o.mask?.length && (o.range === 'scene' || o.range === 'shaft' || comp)) {
    const over = (a, b) => o.mask.some(([u, w]) => u < b && w > a);
    for (let k = 0; k < P.length;) {
      let e = k;
      while (e + 1 < P.length && over(t[P[e][1] - 1], t[P[e + 1][0]])) e++;
      if (e > k) {
        const zs = [], lvs = [];
        for (let q = k; q <= e; q++) {
          const tt = t.slice(P[q][0], P[q][1]), f = findTurns(tt, vv.slice(P[q][0], P[q][1]), o);
          if (!comp) zs.push(...undrift(tt, f.y, f.turns, f.dt, o, true));
          else if (f.turns.length >= 3) lvs.push(cLevels(tt, f.y, f.turns, o));
        }
        const cal = comp ? (lvs.length ? cRef(lvs, o) : null) : [pct(zs, 0.02), pct(zs, 0.98)];
        if (cal) for (let q = k; q <= e; q++) joint.set(q, cal);
      }
      k = e + 1;
    }
  }
  P.forEach(([i, j], k) => {
    const oo = joint.has(k) ? { ...o, [comp ? 'cjoint' : 'joint']: joint.get(k) } : o;
    const pts = piece(t.slice(i, j), vv.slice(i, j), o.pic ? { ...oo, pic: Array.from(o.pic).slice(i, j) } : oo, o.timing ? Array.from(o.timing).slice(i, j) : null, sign, o.depth ? Array.from(o.depth).slice(i, j) : null);
    for (const p of pts) if (!out.length || p.at > out[out.length - 1].at) out.push(p);
  });
  const low = [];
  if (o.conf) {
    let s = -1;
    for (let i = 0; i <= n; i++) {
      const bad = i < n && vv[i] === vv[i] && o.conf[i] < o.lowConf;
      if (bad && s < 0) s = i;
      if (!bad && s >= 0) { if (t[i - 1] - t[s] >= o.lowMs) low.push({ t0: t[s], t1: t[i - 1] }); s = -1; }
    }
  }
  return { points: low.length ? out.filter((p) => !low.some((l) => p.at > l.t0 && p.at < l.t1)) : out, low };
}
