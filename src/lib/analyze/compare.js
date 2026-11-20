// Compare two scripts over a range: a light, in-browser cousin of trackers/pawtrack/score.py.
// Field names match score.py where they overlap (tp, fp, fn, precision, recall, f1, f1_lag, dt_median_ms,
// dt_p90_ms, dt_bias_ms, lag_ms, lag_bound_ms, r_pos, r_vel, r_pos_lag, r_vel_lag, sign).
// Differences from score.py (deliberate, for speed): turning points are taken from the actions (not from a
// 100 Hz resample), and the amplitude / range-usage blocks are left to statistics().
import { clipped, turns, percentile, median, lb } from './util.js';

const STEP = 10;           // ms between samples (100 Hz, as score.py)
const WIN = 3000;          // samples per window when a long range is sampled in windows

/** Sample `a` at STEP ms from t0 for `count` samples (held outside its ends; empty script = parked mid-stroke, as score.py). */
function resample(a, t0, count) {
  const out = new Float64Array(count), { at, pos, n } = a;
  if (!n) return out.fill(50);
  let j = lb(at, t0);
  for (let k = 0; k < count; k++) {
    const t = t0 + k * STEP;
    while (j < n && at[j] < t) j++;
    out[k] = j === 0 ? pos[0] : j === n ? pos[n - 1] : at[j] === t ? pos[j] : pos[j - 1] + ((pos[j] - pos[j - 1]) * (t - at[j - 1])) / (at[j] - at[j - 1]);
  }
  return out;
}

/** Pearson r of x[k] vs y[k + L] pooled over windows [[offset, length], ...]; NaN if either side is constant. */
function corr(x, y, wins, L = 0) {
  let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  const a = L >= 0 ? 0 : -L, b = L >= 0 ? L : 0;
  for (const [o, len] of wins) {
    const m = len - Math.abs(L);
    for (let k = 0; k < m; k++) { const u = x[o + a + k], v = y[o + b + k]; n++; sx += u; sy += v; sxy += u * v; sxx += u * u; syy += v * v; }
  }
  if (n < 2) return NaN;
  const vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n;
  return vx > 1e-9 && vy > 1e-9 ? (sxy - (sx * sy) / n) / Math.sqrt(vx * vy) : NaN;
}

const diff = (x, wins) => { const d = new Float64Array(x.length); for (const [o, len] of wins) for (let k = 0; k < len - 1; k++) d[o + k] = x[o + k + 1] - x[o + k]; return d; };

/** Best lag in samples within +-bound (ties -> smaller |lag|) and the r there. */
function bestLag(x, y, wins, bound) {
  let best = 0, bestR = corr(x, y, wins, 0);
  for (let m = 1; m <= bound; m++) {
    for (const L of [m, -m]) {
      const v = corr(x, y, wins, L);
      if (Number.isFinite(v) && (!Number.isFinite(bestR) || v > bestR + 1e-12)) { best = L; bestR = v; }
    }
  }
  return { lag: best, r: bestR };
}

/**
 * One-to-one matching of same-kind turning points within tol, closest first (ties: earlier cand, then earlier ref).
 * Candidates are generated in (i, j) order and bucketed by |dt| with a stable counting sort (1 ms buckets for integer tol),
 * so the greedy order equals a full sort by (|dt|, i, j) in O(pairs); a bucket holding unequal |dt| is sorted stably.
 */
function match(cT, cK, rT, rK, tol) {
  const PI = [], PJ = [], PD = [];
  let lo = 0;
  for (let i = 0; i < cT.length; i++) {
    while (lo < rT.length && rT[lo] < cT[i] - tol) lo++;
    for (let j = lo; j < rT.length && rT[j] <= cT[i] + tol; j++) if (cK[i] === rK[j]) { PI.push(i); PJ.push(j); PD.push(cT[i] - rT[j]); }
  }
  const P = PD.length, nb = Math.min(Math.floor(tol), 65535) + 1, scale = tol > 0 ? (nb - 1) / tol : 0;
  const key = (p) => Math.min(nb - 1, Math.floor(Math.abs(PD[p]) * scale));
  const start = new Uint32Array(nb + 1);
  for (let p = 0; p < P; p++) start[key(p) + 1]++;
  for (let b = 0; b < nb; b++) start[b + 1] += start[b];
  const order = new Uint32Array(P), fill = start.slice(0, nb);
  for (let p = 0; p < P; p++) order[fill[key(p)]++] = p;
  for (let b = 0; b < nb; b++) {
    const s = start[b], e = start[b + 1];
    for (let k = s + 1; k < e; k++) {
      if (Math.abs(PD[order[k]]) !== Math.abs(PD[order[s]])) {
        order.set(Array.from(order.subarray(s, e)).sort((x, y) => Math.abs(PD[x]) - Math.abs(PD[y])), s);
        break;
      }
    }
  }
  const usedR = new Uint8Array(rT.length), mj = new Int32Array(cT.length).fill(-1), md = new Float64Array(cT.length);
  for (let k = 0; k < P; k++) {
    const p = order[k], i = PI[p], j = PJ[p];
    if (mj[i] < 0 && !usedR[j]) { mj[i] = j; md[i] = PD[p]; usedR[j] = 1; }
  }
  const out = [];
  for (let i = 0; i < cT.length; i++) if (mj[i] >= 0) out.push([i, mj[i], md[i]]);
  return out;
}

const prf = (tp, fp, fn) => {
  const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0;
  return [p, r, p + r ? (2 * p * r) / (p + r) : 0];
};
const nul = (v) => (Number.isFinite(v) ? v : null);

/**
 * compare(cand, ref, {t0, t1, tolMs=150, minProm=10, maxLagMs=500, allowFlip=false, maxSamples=60000})
 * -> { t0, t1, duration_ms, sign, lag_ms, lag_bound_ms, r_pos, r_vel, r_pos_lag, r_vel_lag,
 *      n_cand, n_ref, tp, fp, fn, precision, recall, f1, f1_lag,
 *      dt_median_ms, dt_p90_ms, dt_bias_ms,
 *      pairs: [{cand, ref, kind, dt}], unmatchedCand: [{at, kind}], unmatchedRef: [{at, kind}] }
 * lag_ms > 0 means the candidate is LATE; dt = cand time - ref time. Range defaults to the union of both scripts.
 */
export function compare(cand, ref, opts = {}) {
  const { tolMs = 150, minProm = 10, maxLagMs = 500, allowFlip = false, maxSamples = 60000 } = opts;
  const span = (s) => (s.length ? [s[0].at, s[s.length - 1].at] : [Infinity, -Infinity]);
  const [ca, cb] = span(cand), [ra, rb] = span(ref);
  const t0 = opts.t0 ?? Math.min(ca, ra), t1 = opts.t1 ?? Math.max(cb, rb);
  const base = { t0: Number.isFinite(t0) ? t0 : 0, t1: Number.isFinite(t1) ? t1 : 0 };
  if (!(t1 > t0)) return { ...base, duration_ms: 0, sign: 1, empty: true, tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0, pairs: [], unmatchedCand: [], unmatchedRef: [] };

  const R = clipped(ref, t0, t1);
  let C = clipped(cand, t0, t1);
  const dur = t1 - t0, total = Math.floor(dur / STEP);
  // Whole range at 100 Hz, or (past maxSamples, i.e. ~10 min) evenly spaced 30 s windows: lag resolution stays 10 ms.
  const wins = [];
  if (total <= maxSamples) wins.push([0, total]);
  else {
    const K = Math.max(1, Math.floor(maxSamples / WIN)), span = dur - WIN * STEP;
    for (let w = 0; w < K; w++) wins.push([w * WIN, WIN]);
    wins.starts = wins.map((_, w) => t0 + Math.floor((span * w) / Math.max(1, K - 1)));
  }
  const sample = (A) => {
    const parts = wins.starts ? wins.starts.map((ws, w) => resample(A, ws, WIN)) : [resample(A, t0, total)];
    const out = new Float64Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const x = sample(R);
  let y = sample(C);
  const step = STEP;

  const rt = turns(R.at, R.pos, minProm);
  const rT = rt.idx.map((i) => R.at[i]), rK = rt.kind;
  const peaks = rT.filter((_, k) => rK[k] === 1);
  const period = peaks.length >= 2 ? median(peaks.slice(1).map((t, k) => t - peaks[k])) : Infinity;
  const boundMs = Math.min(maxLagMs, period / 4);
  const bound = Number.isFinite(boundMs) ? Math.floor(boundMs / step) : 0;

  let sign = 1, best = bestLag(x, y, wins, bound);
  if (allowFlip) {
    const y2 = y.map((v) => 100 - v), alt = bestLag(x, y2, wins, bound);
    if (Number.isFinite(alt.r) && !(Number.isFinite(best.r) && best.r >= alt.r)) {
      sign = -1; y = y2; best = alt;
      C = { ...C, pos: C.pos.map((v) => 100 - v) };
    }
  }
  const lagMs = best.lag * step;
  const vwins = wins.map(([o, l]) => [o, l - 1]), vx = diff(x, wins), vy = diff(y, wins);
  const r_vel_lag = corr(vx, vy, vwins, best.lag);

  const ct = turns(C.at, C.pos, minProm);
  const cT = ct.idx.map((i) => C.at[i]), cK = ct.kind;
  const m0 = match(cT, cK, rT, rK, tolMs);
  const [precision, recall, f1] = prf(m0.length, cT.length - m0.length, rT.length - m0.length);
  const m1 = match(cT.map((t) => t - lagMs), cK, rT, rK, tolMs);
  const f1_lag = prf(m1.length, cT.length - m1.length, rT.length - m1.length)[2];

  const dts = m0.map((p) => p[2]), adts = Float64Array.from(dts, Math.abs).sort();
  const mc = new Set(m0.map((p) => p[0])), mr = new Set(m0.map((p) => p[1]));
  return {
    ...base, duration_ms: dur, sign, lag_ms: lagMs, lag_bound_ms: nul(bound * step),
    r_pos: nul(corr(x, y, wins)), r_vel: nul(corr(vx, vy, vwins)), r_pos_lag: nul(best.r), r_vel_lag: nul(r_vel_lag),
    n_cand: cT.length, n_ref: rT.length, tp: m0.length, fp: cT.length - m0.length, fn: rT.length - m0.length,
    precision, recall, f1, f1_lag,
    dt_median_ms: adts.length ? percentile(adts, 50) : null, dt_p90_ms: adts.length ? percentile(adts, 90) : null,
    dt_bias_ms: dts.length ? median(dts) : null,
    pairs: m0.map(([i, j, dt]) => ({ cand: cT[i], ref: rT[j], kind: cK[i], dt })),
    unmatchedCand: cT.map((at, i) => ({ at, kind: cK[i] })).filter((_, i) => !mc.has(i)),
    unmatchedRef: rT.map((at, j) => ({ at, kind: rK[j] })).filter((_, j) => !mr.has(j)),
  };
}
