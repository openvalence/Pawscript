// shaft-source.js -- paw-4c48.10: the shaft's reading of its visible share (the position bar's hollow diamond: lib/shaft.js
// railContext / railAt / railPos) as a shot's stroke source, 'shaft' in the source menu. Pure (test/shaft-source.test.mjs).
// Two readings (shaft.js READINGS): 'points' (the share of the penis group's points still visible) and 'sam' (the shaft pass's
// measured entry). On the owner's shots the points follow his strokes where SAM does not, and SAM's confidence does not say
// when SAM is right (paw-72z: 99 % confident at r -0.12): so per run scene the reading is chosen by whether it REPEATS with the
// strokes (periodicity: the autocorrelation at the stroke period), the points first unless SAM repeats clearly better
// (PERIOD.PREFER); confidence alone never offers it. The diamond draws the reading the shot's source uses (the store's railFor).
// Per run scene, on its rail's frame times:
//   measured  the rail has geometry of its own there (not held) and the reading is sure there (not low): the source IS the
//             diamond's position, pos / 100 (0 = hilted, 1 = fully out; the owner's "hilted" / "fully out" marks included)
//   filled    every other frame: the fused signal seated on the measured reading's level and size (depth-seat.js seatDepth,
//             the measured frames as its reference), then shifted at each gap's two ends onto the measured frames beside it
//             (the offset ramped linearly across the gap: no jump, the measured frames untouched); with no fusion, or one that
//             does not move with the shaft (seatDepth's why), a straight line between the gap's ends
// Offered where the chosen reading covers RAIL_MIN of the run scene AND repeats (periodicity >= PERIOD.OFFER), else {why}.
// The channel is absolute (its values ARE pos / 100: never re-ranged, never level-carried) and signed (the shaft has a
// physical direction: the sidecar's scene sign does not apply; the owner's flips still do: a reading can be upside down).
import { railContext, railAt, railPos, shaftOf, partWord, SHARE_MIN, RAIL_MIN } from './shaft.js';
import { seatDepth } from './depth-seat.js';
import { lowerBound } from './lane.js';

const fin = Number.isFinite;
/** Periodicity: OFFER = the least to offer the source, HINT = the least to hint at it, PREFER = how much better SAM must repeat
 *  than the points to be chosen; LAG = the stroke periods searched without fusion's (ms); MAX_GAP = gaps bridged (ms); MIN_SWING = the least p90 - p10
 *  swing about its drift (pos / 100) that counts as moving. */
export const PERIOD = { OFFER: 0.3, HINT: 0.5, PREFER: 0.15, LAG: [300, 2500], MAX_GAP: 500, MIN_SWING: 0.03 };
/** Channel c's value nearest time t (within 60 ms) or NaN. */
function near(c, t) {
  if (!c?.t?.length) return NaN;
  const i = lowerBound(c.t, t), j = i > 0 && (i >= c.t.length || t - c.t[i - 1] < c.t[i] - t) ? i - 1 : Math.min(i, c.t.length - 1);
  const v = c.v[j];
  return Math.abs(c.t[j] - t) <= 60 && v != null && v === v ? +v : NaN;
}
function corr(x, y) {
  let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { const u = x[i], v = y[i]; if (!(fin(u) && fin(v))) continue; n++; sx += u; sy += v; sxy += u * v; sxx += u * u; syy += v * v; }
  const vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n;
  return n >= 8 && vx > 1e-12 && vy > 1e-12 ? (sxy - (sx * sy) / n) / Math.sqrt(vx * vy) : NaN;
}

/**
 * How well v (NaN = not read; on times t, about evenly spaced) repeats: gaps up to MAX_GAP bridged, the slow drift (its
 * moving average over one stroke period, else 1.2 s) out, then the largest autocorrelation at a lag within 0.6..1.5 x periodMs (fusion's stroke period)
 * or, without one, within PERIOD.LAG past its first zero crossing -> {q (0..1; 0 = does not repeat), lagMs}.
 */
export function periodicity(t, v, periodMs = 0) {
  const n = t.length;
  if (n < 20) return { q: 0, lagMs: 0 };
  const dt = (t[n - 1] - t[0]) / (n - 1) || 1000 / 30, x = Float64Array.from(v);
  let last = -1;
  for (let i = 0; i < n; i++) if (fin(x[i])) { if (last >= 0 && i - last > 1 && t[i] - t[last] <= PERIOD.MAX_GAP) for (let k = last + 1; k < i; k++) x[k] = x[last] + ((x[i] - x[last]) * (t[k] - t[last])) / (t[i] - t[last]); last = i; }
  const h = Math.max(1, Math.round((periodMs > 0 ? periodMs / 2 : 600) / dt)), y = new Float64Array(n).fill(NaN);
  // (the full window only: a window cut by the scene's ends lags a drift and reads as a stroke)
  for (let i = h; i < n - h; i++) { if (!fin(x[i])) continue; let s = 0, c = 0; for (let k = i - h; k <= i + h; k++) if (fin(x[k])) { s += x[k]; c++; } y[i] = x[i] - s / c; }   // ponytail: O(n x window), fine for minutes-long scenes
  const ys = Array.from(y).filter(fin).sort((p, q) => p - q);
  if (ys.length < 20 || ys[Math.floor(0.9 * (ys.length - 1))] - ys[Math.floor(0.1 * (ys.length - 1))] < PERIOD.MIN_SWING) return { q: 0, lagMs: 0 };   // nothing that moves like a stroke
  const ac = (L) => { const a = [], b = []; for (let i = 0; i + L < n; i++) { a.push(y[i]); b.push(y[i + L]); } return corr(a, b); };
  let lo, hi;
  if (periodMs > 0) { lo = Math.max(2, Math.round((0.6 * periodMs) / dt)); hi = Math.round((1.5 * periodMs) / dt); }
  else { lo = Math.max(2, Math.round(PERIOD.LAG[0] / dt)); hi = Math.round(PERIOD.LAG[1] / dt); let z = 1; while (z < hi && !(ac(z) <= 0)) z++; lo = Math.max(lo, z); }
  let best = { q: 0, lagMs: 0 };
  for (let L = lo; L <= Math.min(hi, n - 10); L++) { const r = ac(L); if (fin(r) && r > best.q) best = { q: r, lagMs: Math.round(L * dt) }; }
  return { q: Math.round(best.q * 100) / 100, lagMs: best.lagMs };
}

/** Run scene k's reading `reading` on its rail frames, measured frames only -> {ctx, t, v (0..1, NaN not measured), m, share,
 *  q, lagMs} | {why}. */
export function readScene(run, k, { calib = null, aspect = 16 / 9, reading = 'points', periodMs = 0, motion = null, part = null } = {}) {
  const ctx = railContext(run, k, calib, { aspect, reading, motion, part });
  if (!ctx.G) return { why: ctx.why };
  const T = ctx.G.t, n = T.length, v = new Float64Array(n).fill(NaN), m = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = railAt(ctx, T[i], aspect);
    if (!r || r.held || r.low) continue;
    const p = railPos(r, aspect);
    if (fin(p)) { v[i] = p / 100; m[i] = 1; }
  }
  let ok = 0;
  for (let i = 0; i < n; i++) ok += m[i];
  return { ctx, t: T, v, m, share: n ? ok / n : 0, ...periodicity(T, v, periodMs) };
}

/**
 * Run scene k's shaft source. calib = the shot's derive.shaft, fused = the run's fused channel ({t, v, info?}; null: lines),
 * reading 'auto' (chosen, above) | 'points' | 'sam' -> {t, v (Float64Array 0..1), m (Uint8Array: 1 measured), share (measured
 * share), q (its periodicity), reading, other ({reading, q, share} | {reading, why}: the one not chosen), how ('fusion' | 'line'
 * | null: nothing to fill), name, source ('sam' | 'points': what the shaft pass itself read), from} | {why}.
 */
export function shaftScene(run, k, { calib = null, aspect = 16 / 9, fused = null, reading = 'auto', part = null } = {}) {
  const periodMs = fused?.info?.[Math.max(0, k)]?.periodMs || 0, o = { calib, aspect, periodMs, motion: fused?.t?.length ? fused : null, part };   // paw-4c48: the extremes agree with fusion's strokes; paw-4c48.19: a depth part's readings the same way
  const RP = reading === 'sam' ? null : readScene(run, k, { ...o, reading: 'points' }) , RS = reading === 'points' ? null : readScene(run, k, { ...o, reading: 'sam' });
  const ok = (x) => !!x?.t && x.share >= RAIL_MIN;
  const pick = ok(RP) && ok(RS) ? (RS.q > RP.q + PERIOD.PREFER ? RS : RP) : ok(RP) ? RP : ok(RS) ? RS : null;
  const what = part ? partWord(part) : 'shaft';
  if (!pick) return { why: [...new Set([RP, RS].filter((x) => x && !ok(x)).map((x) => x.why || `read on ${Math.round(100 * x.share)} % of it only`).filter(Boolean))].join('; ') || `no ${what} read in this shot` };
  if (!(pick.q >= PERIOD.OFFER)) return { why: `the ${what}'s reading does not repeat with the strokes here (periodicity ${pick.q.toFixed(2)}, read from ${pick.ctx.reading === 'points' ? (part ? `the ${what} points` : 'the penis points') : 'SAM'})` };
  const alt = pick === RP ? RS : RP, ctx = pick.ctx, T = pick.t, n = T.length, v = pick.v, m = pick.m;
  const rec = shaftOf(run, k, { points: true, aspect, part })?.rec;
  const other = !alt ? null : alt.t ? { reading: alt.ctx.reading, q: alt.q, share: Math.round(alt.share * 1000) / 1000 } : { reading: pick === RP ? 'sam' : 'points', why: alt.why };
  const base = { t: T, m, share: pick.share, q: pick.q, reading: ctx.reading, other, name: ctx.name, source: rec?.source || null, from: ctx.G.from };
  if (pick.share === 1) return { ...base, v, how: null };
  // the fill: fused seated on the measured reading (its orientation found by seatDepth; turned back onto the shaft's)
  let S = null;
  if (fused?.t?.length) {
    const fv = Float64Array.from(T, (t) => near(fused, t)), s = seatDepth(T, fv, v);
    if (s.v) S = corr(s.v, v) < 0 ? s.v.map((x) => -x) : s.v;
  }
  const out = Float64Array.from(v);
  for (let a = 0; a < n;) {
    if (m[a]) { a++; continue; }
    let b = a;
    while (b < n && !m[b]) b++;
    const L = a - 1, R = b < n ? b : -1;   // the measured frames beside the gap [a, b)
    const dA = L >= 0 && S && fin(S[L]) ? v[L] - S[L] : NaN, dB = R >= 0 && S && fin(S[R]) ? v[R] - S[R] : NaN;
    for (let i = a; i < b; i++) {
      if (!S || !fin(S[i]) || !(fin(dA) || fin(dB))) continue;
      const f = L >= 0 && R >= 0 ? (T[i] - T[L]) / (T[R] - T[L]) : 0;
      out[i] = S[i] + (fin(dA) && fin(dB) ? dA + f * (dB - dA) : fin(dA) ? dA : dB);
    }
    // what is left (no fusion there): a straight line between the nearest values either side, held at the scene's ends
    for (let i = a; i < b; i++) {
      if (fin(out[i])) continue;
      let p = i - 1, q = i + 1;
      while (p >= 0 && !fin(out[p])) p--;
      while (q < n && !fin(out[q])) q++;
      out[i] = p >= 0 && q < n ? out[p] + ((out[q] - out[p]) * (T[i] - T[p])) / (T[q] - T[p]) : p >= 0 ? out[p] : q < n ? out[q] : NaN;
    }
    for (let i = a; i < b; i++) if (fin(out[i])) out[i] = Math.min(1, Math.max(0, out[i]));
    a = b;
  }
  return { ...base, v: out, how: S ? 'fusion' : 'line' };
}

/**
 * The run's 'shaft' channel: every run scene's shaftScene (derives[k]?.shaft its calibration), NaN where a scene cannot offer
 * it. -> {t, v, min 0, max 1, scaled (= v: the lane draws pos / 100), conf (1 measured / 0.5 filled), signed, absolute, info:
 * [per run scene {ok, share, how, name, source, from, reading, q, other} | {ok: false, why}]} | {info} alone (no scene can).
 */
export function shaftChannel(run, { derives = [], aspect = 16 / 9, fused = null, part = null } = {}) {
  const scenes = run?.scenes?.length ? run.scenes : [null], info = [], t = [], v = [], conf = [];
  scenes.forEach((_, k) => {
    const d = derives[k] ?? (k === 0 && !run.scenes?.length ? derives[-1] : null) ?? null;
    const s = shaftScene(run, k, { calib: d?.shaft || null, aspect, fused, part });
    if (!s.t) { info[k] = { ok: false, why: s.why }; return; }
    info[k] = { ok: true, share: Math.round(s.share * 1000) / 1000, how: s.how, name: s.name, source: s.source, from: s.from, reading: s.reading, q: s.q, other: s.other };
    for (let i = 0; i < s.t.length; i++) { if (t.length && s.t[i] <= t[t.length - 1]) continue; t.push(s.t[i]); v.push(s.v[i]); conf.push(s.m[i] ? 1 : 0.5); }
  });
  if (!info.some((x) => x.ok)) return { info };
  const V = Float32Array.from(v);
  return { t: Float64Array.from(t), v: V, min: 0, max: 1, scaled: V, conf: Float32Array.from(conf), signed: true, absolute: true, info };
}

/** The quiet hint (the source chip's mark): measured over HINT.SHARE of the shot and the current points read it differently. */
export const HINT = { SHARE: SHARE_MIN, R: 0.5, SIZE: 2 };
const spread = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(0.9 * (s.length - 1))] - s[Math.floor(0.1 * (s.length - 1))] : NaN; };
/**
 * Does shaftScene s disagree with points ({at, pos}: the run as it plays) over [t0, t1)? On the measured frames: Pearson r of
 * 100 x the shaft against the points (linear between them) under HINT.R, or the strokes' size (p90 - p10) off by more than
 * HINT.SIZE x either way -> {r, size (the shaft's / the points'), share (measured share of the shot)} | null (agrees, or not
 * measured over enough of the shot to say).
 */
export function shaftDisagrees(s, points, t0, t1) {
  if (!s?.t || !points?.at?.length) return null;
  const x = [], y = [], A = points.at, P = points.pos;
  let n = 0;
  for (let i = 0; i < s.t.length; i++) {
    const t = s.t[i];
    if (t < t0 || t >= t1) continue;
    n++;
    if (!s.m[i] || t < A[0] || t > A[A.length - 1]) continue;
    const j = Math.max(1, lowerBound(A, t)), f = A[j] > A[j - 1] ? (t - A[j - 1]) / (A[j] - A[j - 1]) : 0;
    x.push(100 * s.v[i]); y.push(P[j - 1] + f * (P[Math.min(j, A.length - 1)] - P[j - 1]));
  }
  const share = n ? x.length / n : 0;
  if (share < HINT.SHARE || x.length < 10) return null;
  const r = corr(x, y), sy = spread(y), size = sy > 1e-9 ? spread(x) / sy : Infinity;
  return !(r >= HINT.R) || !(size <= HINT.SIZE && size >= 1 / HINT.SIZE) ? { r: fin(r) ? Math.round(r * 100) / 100 : 0, size: Math.round(size * 10) / 10, share: Math.round(share * 100) / 100 } : null;
}

/** The chip's words for run scene info i ({ok, share, how} | {why}): 'shaft 82 % · filled 18 %'; part: a depth part's name. */
export function shaftChipText(i, part = null) {
  const w = part ? partWord(part) : 'shaft', W = w[0].toUpperCase() + w.slice(1);
  if (!i) return W;
  if (!i.ok) return `${W} (not read here)`;
  const s = Math.round(100 * i.share);
  return s >= 100 ? `${w} 100 %` : `${w} ${s} % · filled ${100 - s} %`;
}
