// depth-seat.js -- paw-gy1r: the fused stroke's MOTION seated on a depth reference's LEVEL and SIZE. Pure
// (test/depth-seat.test.mjs; measured in experiments/fusion/level.mjs, RESULTS.md).
// Fusion keeps the timing and shape of the strokes but not where they sit in the depth range or how big they are against
// each other: every relationship row is its position minus its own moving average over two strokes (lib/fusion.js r.f:
// relative rows have no absolute zero and bodies settle), and each row is divided by its own spread, so a stretch of small
// strokes at depth comes out centred and as big as the rest. Here, per run scene, with a shot's derive.fuse.depth:
//   reference  'pick' = the sidecar pick's channel (what it chose for the scene), 'pair' = the two bodies' distance along the
//              stroke (who_pair_proj), 'shaft' = the SAM shaft's visible share
//              (lib/shaft.js shaftDepth, only where confident over SHARE_MIN of the scene)
//   slow stats over a few strokes (DEPTH.STROKES x the stroke period, DEPTH.WIN): level = the running median, size = the
//              running p90 - p10, of the reference and of the fused signal; robust, so the reference's spikes, clipped
//              floor and jitter never come through (never a per-stroke copy)
//   seated     level_ref + (fused - level_fused) x size_ref / size_fused (the gain capped at GAIN_CAP x its median)
//   absent     where the reference is missing (coverage under COV in the window) the fused signal keeps its own shape about
//              the reference's median level with the median gain, cross-faded; a reference that does not move with the
//              stroke (|r| of the two above their slow levels < R_MIN) is not used at all, and says why
// The turn times barely move (a slowly varying affine map); HOW / the Detail's read (fusion's raw signal) is not touched.
import { savgol } from './strokes.js';
import { shaftDepth, partOf, partWord, SHARE_MIN } from './shaft.js';

const fin = Number.isFinite;
export const DEPTH = { FROM: ['pick', 'pair', 'shaft'], STROKES: 3, WIN: [2500, 8000], COV: [0.3, 0.7], R_MIN: 0.3, GAIN_CAP: 4, SMOOTH_MS: 150, MIN_SEEN: 0.3 };
export const DEPTH_WORD = { pick: 'the sidecar pick', pair: "the bodies' distance", shaft: 'the shaft' };
/** paw-4c48.19: the words for a depth reference, a depth part's ('part:<name>') included. */
export const depthWord = (from) => DEPTH_WORD[from] || (partOf(from) ? `the ${partWord(partOf(from))}` : from);

const smooth = (x, [a, b]) => (x <= a ? 0 : x >= b ? 1 : ((x - a) / (b - a)) ** 2 * (3 - (2 * (x - a)) / (b - a)));
const pctOf = (s, p) => { const x = (s.length - 1) * p, i = Math.floor(x); return s[i] + (s[Math.min(s.length - 1, i + 1)] - s[i]) * (x - i); };
const median = (a) => { const s = a.filter(fin).sort((p, q) => p - q); return s.length ? pctOf(s, 0.5) : NaN; };
function corr(x, y) {
  let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { const u = x[i], v = y[i]; if (!(fin(u) && fin(v))) continue; n++; sx += u; sy += v; sxy += u * v; sxx += u * u; syy += v * v; }
  const vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n;
  return n >= 8 && vx > 1e-12 && vy > 1e-12 ? (sxy - (sx * sy) / n) / Math.sqrt(vx * vy) : NaN;
}

/** Slow robust stats of x (NaN = none) over a window of w samples: per sample {mid (median), size (p90 - p10), cov (share
 *  seen)}: computed every ~w/16 samples, linear between, then a moving average over half the window (slow on purpose). */
export function slowStats(x, w) {
  const n = x.length, step = Math.max(1, Math.floor(w / 16)), h = Math.floor(w / 2), at = [], M = [], S = [], C = [];
  for (let i = 0; i < n; i += step) {
    const s = [];
    for (let k = Math.max(0, i - h); k <= Math.min(n - 1, i + h); k++) if (fin(x[k])) s.push(x[k]);
    s.sort((p, q) => p - q);
    at.push(i); C.push(s.length / (Math.min(n - 1, i + h) - Math.max(0, i - h) + 1));
    M.push(s.length >= 4 ? pctOf(s, 0.5) : NaN); S.push(s.length >= 4 ? pctOf(s, 0.9) - pctOf(s, 0.1) : NaN);
  }
  if (at[at.length - 1] !== n - 1) { at.push(n - 1); M.push(M[M.length - 1]); S.push(S[S.length - 1]); C.push(C[C.length - 1]); }
  // a missing centre takes its nearest known one (the coverage says how far to trust it)
  for (const A of [M, S]) { let last = NaN; for (let k = 0; k < A.length; k++) if (fin(A[k])) last = A[k]; else A[k] = last; last = NaN; for (let k = A.length - 1; k >= 0; k--) if (fin(A[k])) last = A[k]; else if (fin(last)) A[k] = last; }
  const lin = (A) => { const o = new Float64Array(n); let k = 0; for (let i = 0; i < n; i++) { while (k + 1 < at.length && at[k + 1] <= i) k++; const k2 = Math.min(at.length - 1, k + 1), f = k2 > k ? (i - at[k]) / (at[k2] - at[k]) : 0; o[i] = A[k] + (A[k2] - A[k]) * f; } return o; };
  const avg = (a) => { const hw = Math.max(1, Math.floor(h / 2)), cs = new Float64Array(n + 1), o = new Float64Array(n); for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + a[i]; for (let i = 0; i < n; i++) { const l = Math.max(0, i - hw), r = Math.min(n, i + hw + 1); o[i] = (cs[r] - cs[l]) / (r - l); } return o; };
  return { mid: avg(lin(M)), size: avg(lin(S)), cov: avg(lin(C)) };
}

/**
 * Seat fused v (one scene, on times t) on reference ref (same samples; NaN = none): -> {v, map (x -> seated, for a series
 * on the same samples: fusion's timing), level (the level used, per sample), used (0..1: the share seated on the
 * reference), r (|r| of the two above their slow levels), gain} | {why, r} (not used).
 */
export function seatDepth(t, v, ref, { periodMs = 0 } = {}) {
  const n = v.length, dt = n > 1 ? (t[n - 1] - t[0]) / (n - 1) || 1000 / 30 : 1000 / 30;
  const seen = ref.reduce((s, x) => s + (fin(x) ? 1 : 0), 0) / (n || 1);
  if (seen < DEPTH.MIN_SEEN) return { why: `seen on ${Math.round(100 * seen)} % of the scene`, r: 0 };
  // the reference smoothed like the strokes step (its tracker jitter out) over its seen stretches
  const x = Float64Array.from(ref, (q) => (fin(q) ? q : NaN)), hs = Math.floor(Math.round(DEPTH.SMOOTH_MS / dt) / 2);
  for (let i = 0; i < n;) { if (!fin(x[i])) { i++; continue; } let j = i; while (j < n && fin(x[j])) j++; if (j - i >= 5) x.set(savgol(x.subarray(i, j), hs), i); i = j; }
  const w = Math.max(5, Math.round(Math.min(DEPTH.WIN[1], Math.max(DEPTH.WIN[0], DEPTH.STROKES * (periodMs || 1000))) / dt));
  const F = slowStats(v, w);
  let R = slowStats(x, w);
  const r = corr(Array.from(v, (q, i) => q - F.mid[i]), Array.from(x, (q, i) => q - R.mid[i]));
  if (!(Math.abs(r) >= DEPTH.R_MIN)) return { why: `does not move with the stroke here (r ${fin(r) ? Math.abs(r).toFixed(2) : '-'})`, r: fin(r) ? Math.abs(r) : 0 };
  if (r < 0) { for (let i = 0; i < n; i++) x[i] = -x[i]; R = { ...R, mid: R.mid.map((q) => -q) }; }   // oriented like the fused stroke
  const c = Float64Array.from(R.cov, (q) => smooth(q, DEPTH.COV)), g0 = [], lv = [];
  for (let i = 0; i < n; i++) if (c[i] > 0.5 && F.size[i] > 1e-9 && fin(R.size[i])) { g0.push(R.size[i] / F.size[i]); lv.push(R.mid[i]); }
  const G = median(g0), Mx = median(lv);
  if (!(G > 0) || !fin(Mx)) return { why: 'no stretch where both are seen', r: Math.abs(r) };
  const gain = Float64Array.from(F.size, (s, i) => (s > 1e-9 && fin(R.size[i]) ? Math.min(G * DEPTH.GAIN_CAP, Math.max(G / DEPTH.GAIN_CAP, R.size[i] / s)) : G));
  const level = Float64Array.from(c, (ci, i) => ci * R.mid[i] + (1 - ci) * Mx);
  const map = (y) => Float64Array.from(y, (q, i) => (fin(q) ? c[i] * (R.mid[i] + (q - F.mid[i]) * gain[i]) + (1 - c[i]) * (Mx + (q - F.mid[i]) * G) : NaN));
  let us = 0, un = 0;
  for (let i = 0; i < n; i++) if (fin(v[i])) { us += c[i]; un++; }
  return { v: map(v), map, level, used: un ? us / un : 0, r: Math.abs(r), gain: G };
}

// ---- camera moves: body units and where the camera moves (owner: "during camera moves relativity and core needs to kinda
// re-calibrate"). A zoom / push-in multiplies every distance in the picture: a relative row's swing and the bodies' distance
// grow for no depth reason. The characters' own size per frame (the distances between the rigid-ish parts of one character:
// its core and genital groups, each pair against its own median, only pairs that hold within CAM.RIGID of their slow level
// (not a stroke between them), the median over the pairs, slow over CAM.SCALE_MS) is the
// body unit; only where it changes by more than CAM.ZOOM over the scene is anything divided by it (else nothing changes).
// move (0..1 per sample) = how fast the body unit changes or the camera path (cam_x / cam_y) travels: fusion lowers its
// absolute rows (a body against the frame) there ----
export const CAM = { ZOOM: 0.25, RIGID: 0.05, SCALE_MS: 2000, RATE: [0.04, 0.15], SPEED: [0.1, 0.3], ABS_MOVE: 0.75, MAX_PAIRS: 12 };
const RIGID = new Set(['hips', 'thighs', 'torso', 'body', 'belly', 'penis', 'balls', 'sheath', 'slit', 'anus']);
const cache = new WeakMap();
/**
 * Body scale of a run scene (idx into the run's channels, times T, aspect): {s (Float64Array: the body unit, 1 = its median;
 * null = no zoom worth correcting), move (Float64Array 0..1 | null), zoom (p95 / p5 of the body unit), pairs}.
 */
export function bodyScale(run, idx, T, aspect = 16 / 9) {
  const ch = run?.channels || {}, first = Object.keys(ch).find((k) => /^sem_.+_x$/.test(k));
  const key = `${idx[0]}:${idx.length}:${aspect}:${CAM.ZOOM}:${CAM.ABS_MOVE}`, memo = first && cache.get(ch[first]);
  if (memo?.has(key)) return memo.get(key);
  const m = idx.length, dt = m > 1 ? (T[idx[m - 1]] - T[idx[0]]) / (m - 1) || 1000 / 30 : 1000 / 30;
  const by = {};
  for (const k of Object.keys(ch)) {
    const g = /^sem_([a-z0-9_]+)_x$/.exec(k);
    if (!g || !ch[`sem_${g[1]}_y`]) continue;
    const s = /^(c[12]|x)_([a-z0-9]+?)(?:_[lr])?\d*$/.exec(g[1]);
    if (s && RIGID.has(s[2])) (by[s[1]] ||= []).push(g[1]);
  }
  const ratios = [];
  for (const L of Object.values(by)) for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length && ratios.length < CAM.MAX_PAIRS; b++) {
    const ax = ch[`sem_${L[a]}_x`].v, ay = ch[`sem_${L[a]}_y`].v, bx = ch[`sem_${L[b]}_x`].v, by2 = ch[`sem_${L[b]}_y`].v;
    const d = Float64Array.from(idx, (j) => { const v = [ax[j], ay[j], bx[j], by2[j]]; return v.every((x) => x != null && x === x) ? Math.hypot((v[0] - v[2]) * aspect, v[1] - v[3]) : NaN; });
    const md = median(Array.from(d));
    if (!(md > 0.01 && d.filter(fin).length >= 0.3 * m)) continue;
    // rigid enough: what is left of the ratio about its own slow level (a stroke, a swinging part) under CAM.RIGID
    const r = d.map((x) => x / md), sl = slowStats(r, Math.max(5, Math.round(CAM.SCALE_MS / dt))).mid;
    if (1.4826 * median(Array.from(r, (x, q) => Math.abs(x - sl[q]))) < CAM.RIGID) ratios.push(r);
  }
  let s = null, move = null, zoom = 1;
  if (ratios.length) {
    const raw = Float64Array.from({ length: m }, (_, q) => median(ratios.map((r) => r[q])));
    const sl = slowStats(raw, Math.max(5, Math.round(CAM.SCALE_MS / dt))).mid, mu = median(Array.from(sl));
    if (mu > 0) {
      const u = sl.map((x) => x / mu), srt = Array.from(u).filter(fin).sort((p, q) => p - q);
      zoom = srt.length ? pctOf(srt, 0.95) / pctOf(srt, 0.05) : 1;
      if (zoom > 1 + CAM.ZOOM) { s = u; move = Float64Array.from(u, (x, q) => smooth((Math.abs(Math.log(u[Math.min(m - 1, q + 1)] / u[Math.max(0, q - 1)])) / (2 * dt)) * 1000, CAM.RATE)); }
    }
  }
  // the camera path's travel (the sidecar's background motion, frame units): a pan / handheld sweep
  const cx = ch.cam_x, cy = ch.cam_y;
  if (cx?.v && cy?.v) {
    const h = Math.max(1, Math.round(250 / dt)), at = (c, q) => { const y = c.v[idx[Math.min(m - 1, Math.max(0, q))]]; return y != null && y === y ? +y : NaN; };
    const sp = Float64Array.from({ length: m }, (_, q) => { const v = Math.hypot((at(cx, q + h) - at(cx, q - h)) * aspect, at(cy, q + h) - at(cy, q - h)) / ((2 * h * dt) / 1000); return fin(v) ? smooth(v, CAM.SPEED) : 0; });
    if (sp.some((x) => x > 0)) move = move ? move.map((x, q) => Math.max(x, sp[q])) : sp;
  }
  const out = { s, move, zoom, pairs: ratios.length };
  if (first) { if (!cache.has(ch[first])) cache.set(ch[first], new Map()); cache.get(ch[first]).set(key, out); }
  return out;
}

/**
 * The depth reference of run scene k (sample indices idx into the run's channels, times T): from 'pick' (pick = the
 * sidecar pick's channel name), 'pair' or 'shaft' (calib: derive.shaft) -> {x (Float64Array on idx, NaN = none), name} |
 * {why} (nothing to read).
 */
export function depthRef(run, k, idx, T, from, { pick = null, calib = null, aspect = 16 / 9, scale = null, motion = null } = {}) {
  const ch = run?.channels || {};
  if (from === 'pair' && (scale?.s || !ch.who_pair_proj)) {
    // under a zoom (or with no stored pair channel): the two characters' centres (who_c1 / who_c2, else the mean of each one's
    // core groups), their difference along its own main direction, in body units (bodyScale: a zoom cancels). The stored
    // who_pair_proj (the sidecar's stroke axis) reads better on the owner's shots, but it is normalised per scene: a zoom
    // cannot be taken out of it
    const centre = (w) => {
      if (ch[`who_${w}_x`] && ch[`who_${w}_y`]) return [ch[`who_${w}_x`].v, ch[`who_${w}_y`].v].map((v) => idx.map((j) => (v[j] != null && v[j] === v[j] ? +v[j] : NaN)));
      const gs = Object.keys(ch).map((c) => new RegExp(`^sem_(${w}_(?:hips|thighs|torso|body|belly)(?:_[lr])?\\d*)_x$`).exec(c)?.[1]).filter((g) => g && ch[`sem_${g}_y`]);
      if (!gs.length) return null;
      return ['x', 'y'].map((a) => idx.map((j) => { let s = 0, n = 0; for (const g of gs) { const y = ch[`sem_${g}_${a}`].v[j]; if (y != null && y === y) { s += +y; n++; } } return n ? s / n : NaN; }));
    };
    const A = centre('c1'), B = centre('c2');
    if (A && B) {
      const dx = A[0].map((x, q) => (B[0][q] - x) * aspect), dy = A[1].map((y, q) => B[1][q] - y);
      let mx = 0, my = 0, n = 0;
      dx.forEach((x, q) => { if (fin(x) && fin(dy[q])) { mx += x; my += dy[q]; n++; } });
      if (n >= 8) {
        mx /= n; my /= n;
        let sxx = 0, syy = 0, sxy = 0;
        dx.forEach((x, q) => { if (fin(x) && fin(dy[q])) { const a = x - mx, b = dy[q] - my; sxx += a * a; syy += b * b; sxy += a * b; } });
        const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), u = [Math.cos(th), Math.sin(th)];
        const x = Float64Array.from(dx, (v, q) => (fin(v) && fin(dy[q]) ? (v * u[0] + dy[q] * u[1]) / (scale?.s ? scale.s[q] : 1) : NaN));
        return { x, name: ch.who_c1_x ? 'who_c1 / who_c2' : 'c1 / c2 core', body: !!scale?.s };
      }
    }
  }
  if (from === 'shaft' || partOf(from)) {   // paw-4c48.19: a depth part ('part:<name>') reads the same way
    const part = partOf(from), sd = shaftDepth(run, k, idx.map((j) => T[j]), calib, { aspect, motion, part });   // paw-4c48: its scale agrees with the stroke being seated
    if (!sd) return { why: part ? `no ${partWord(part)} measured in this scene (turn it on in the Groups tool and re-track)` : 'no shaft pass in this scene (paint the penis and re-track)' };
    if (sd.share < SHARE_MIN) return { why: `the ${part ? partWord(part) : 'shaft'} is confident on ${Math.round(100 * sd.share)} % of the scene only` };
    return { x: sd.depth, name: `sem_${sd.name}_len` };
  }
  const name = from === 'pick' ? (pick && pick !== 'fused' && ch[pick] ? pick : null) : from === 'pair' ? (ch.who_pair_proj ? 'who_pair_proj' : null) : null;
  if (!name) return { why: from === 'pick' ? 'no sidecar pick channel for this scene' : from === 'pair' ? 'no pair tracked (two characters)' : `unknown reference ${from}` };
  const c = ch[name], x = new Float64Array(idx.length).fill(NaN);
  let p = 0;
  idx.forEach((j, q) => {
    const tj = T[j];
    if (c.t[j] === tj) { const y = c.v[j]; x[q] = y != null && y === y ? +y : NaN; return; }   // channels share the frame times
    while (p + 1 < c.t.length && Math.abs(c.t[p + 1] - tj) <= Math.abs(c.t[p] - tj)) p++;
    const y = c.v[p];
    x[q] = Math.abs(c.t[p] - tj) <= 60 && y != null && y === y ? +y : NaN;
  });
  return { x, name };
}
