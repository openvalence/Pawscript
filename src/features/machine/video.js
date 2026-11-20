// video.js -- the Machine's depth from video (paw-8x1): the tracked shaft's inserted fraction (tracking api
// insertedSeries, lib/shaft.js insertedAt) as mm of the toy inside (the toy stands in for the tracked penis: inserted
// mm = in x the toy's usable length), against the script's depth through the stroke window. Only trusted readings
// count (a SAM-measured shaft, conf >= 0.5); anywhere else the video says nothing and nothing is drawn or driven.
// Pure (test/machine-video.test.mjs).
import { CONF_MIN } from '../../lib/shaft.js';
import { posAt } from '../../lib/core/script.js';
import { depthOf } from './physics.js';

export const STEP_MS = 50;   // the sampling step (the shaft channels are per video frame, ~33 ms)
const GAP = 2.5 * STEP_MS;   // two trusted samples further apart than this are not joined
const KNOT = new Map([[0, 'out'], [0.5, 'entrance'], [1, 'in']]);

/** A reading the Machine may use. */
export const trusted = (x) => !!x && x.source === 'sam' && x.conf >= CONF_MIN && Number.isFinite(x.in);

/** Sample times over a script's span (ms, every STEP_MS); [] for fewer than two actions. */
export function sampleTimes(script) {
  if (!script || script.length < 2) return [];
  const t0 = Math.ceil(script[0].at / STEP_MS) * STEP_MS, n = Math.max(0, Math.floor((script[script.length - 1].at - t0) / STEP_MS) + 1);
  return Array.from({ length: n }, (_, i) => t0 + i * STEP_MS);
}

/** times + their readings -> {t, mm (NaN where not trusted), knot ('out' | 'entrance' | 'in' | null), n trusted} | null
 *  (nothing trusted anywhere). */
export function videoTrack(times, readings, usable) {
  const t = Float64Array.from(times), mm = new Float64Array(t.length).fill(NaN), knot = new Array(t.length).fill(null);
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const r = readings[i];
    if (!trusted(r)) continue;
    mm[i] = Math.max(0, Math.min(1, r.in)) * usable; knot[i] = KNOT.get(r.knot) ?? null; n++;
  }
  return n ? { t, mm, knot, n } : null;
}

/** The trusted sample index at or before t joined to the next one (i, f) | null (a gap, or outside the track). */
function seg(track, t) {
  if (!track) return null;
  const { t: T, mm } = track, n = T.length;
  let lo = 0, hi = n - 1;
  if (!(t >= T[0] && t <= T[n - 1])) return null;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
  if (T[hi] <= t) lo = hi;
  if (!(mm[lo] === mm[lo])) return null;
  if (lo === n - 1 || t === T[lo]) return { i: lo, f: 0 };
  const j = lo + 1;
  return mm[j] === mm[j] && T[j] - T[lo] <= GAP ? { i: lo, f: (t - T[lo]) / (T[j] - T[lo]) } : null;
}

/** mm of the toy inside at t by the video (NaN: no trusted reading there). */
export function videoAt(track, t) {
  const s = seg(track, t);
  if (!s) return NaN;
  const { mm } = track;
  return s.f ? mm[s.i] + (mm[s.i + 1] - mm[s.i]) * s.f : mm[s.i];
}

/** The shaft's knot state at t ('out' | 'entrance' | 'in') | null. */
export const videoKnot = (track, t) => { const s = seg(track, t); return s ? track.knot[s.f > 0.5 ? s.i + 1 : s.i] : null; };

/** Spans of joined trusted samples: [[i0, i1], ...] (sample indices, inclusive). */
function spans(track) {
  const out = [], { t, mm } = track;
  let a = -1;
  for (let i = 0; i < t.length; i++) {
    const ok = mm[i] === mm[i];
    if (ok && a < 0) a = i;
    if (a >= 0 && (!ok || (i > a && t[i] - t[i - 1] > GAP))) { out.push([a, i - 1]); a = ok ? i : -1; }
  }
  if (a >= 0) out.push([a, t.length - 1]);
  return out;
}

/**
 * What the Machine plays in "video" mode: the script, with the video put in wherever it is trusted (its mm mapped back
 * to pos through the stroke window, unclamped, so the toy goes exactly as deep as the video says); the script's own
 * actions everywhere else. Same array back when nothing is trusted.
 */
export function videoScript(script, track, rig) {
  if (!track || !script?.length) return script;
  const posOf = (mm) => 100 * (1 - (mm - rig.offsetMm) / rig.strokeMm), out = [];
  let k = 0;
  for (const [i0, i1] of spans(track)) {
    const a = track.t[i0], b = track.t[i1];
    while (k < script.length && script[k].at < a) out.push(script[k++]);
    if (out.length && a - 1 > out[out.length - 1].at) out.push({ at: a - 1, pos: posAt(script, a - 1) });   // the script up to the span
    for (let i = i0; i <= i1; i++) out.push({ at: track.t[i], pos: posOf(track.mm[i]) });
    while (k < script.length && script[k].at <= b) k++;
    if (k < script.length && script[k].at > b + 1) out.push({ at: b + 1, pos: posAt(script, b + 1) });   // and back to it
  }
  while (k < script.length) out.push(script[k++]);
  return out;
}

/**
 * Script against video over [t0, t1): the script's depth (rigid, through the stroke window, capped at len) minus the
 * video's on every trusted sample -> {n, mean (signed mm: + the script deeper), meanAbs, worst (signed), worstAt,
 * reversals: [{t0, t1}] where the two move in opposite directions (each faster than 20 mm/s, at least 150 ms)} | null.
 */
export function compareDepth(track, script, rig, len, t0 = -Infinity, t1 = Infinity) {
  if (!track || !script?.length) return null;
  const dS = (t) => Math.min(depthOf(rig, posAt(script, t)), len), V = 20 * (STEP_MS / 1000), rev = [];
  let n = 0, sum = 0, sumAbs = 0, worst = 0, worstAt = null, r0 = null, last = null;
  const { t, mm } = track;
  for (let i = 0; i < t.length; i++) {
    if (t[i] < t0 || t[i] >= t1 || !(mm[i] === mm[i])) continue;
    const e = dS(t[i]) - mm[i];
    n++; sum += e; sumAbs += Math.abs(e);
    if (Math.abs(e) > Math.abs(worst)) { worst = e; worstAt = t[i]; }
    const j = i - 1, joined = j >= 0 && mm[j] === mm[j] && t[i] - t[j] <= GAP;
    const vs = joined ? dS(t[i]) - dS(t[j]) : 0, vv = joined ? mm[i] - mm[j] : 0, opp = joined && Math.abs(vs) > V && Math.abs(vv) > V && Math.sign(vs) !== Math.sign(vv);
    if (opp && r0 == null) r0 = t[j];
    if (!opp && r0 != null) { if (last - r0 >= 150) rev.push({ t0: r0, t1: last }); r0 = null; }
    last = t[i];
  }
  if (r0 != null && last - r0 >= 150) rev.push({ t0: r0, t1: last });
  return n ? { n, mean: sum / n, meanAbs: sumAbs / n, worst, worstAt, reversals: rev } : null;
}

/** "script 12 mm deeper than video" / "... shallower ..." / "script matches video" (within 2 mm). fmt(mm) -> text. */
export const diffText = (e, fmt = (x) => `${Math.round(x)} mm`) =>
  !Number.isFinite(e) ? '' : Math.abs(e) < 2 ? 'script matches video' : `script ${fmt(Math.abs(e))} ${e > 0 ? 'deeper' : 'shallower'} than video`;
