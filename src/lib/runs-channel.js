// runs-channel.js -- a run's points rebuilt from one of its raw channels (lane channel pick, e.g. sem_c1_hips_proj), pure.
// The sidecar's points always come from its primary signal; picking a channel must change what Accept gets, so the
// channel goes through the graph's own kernels (sig.fillGaps, sig.smooth gaussian, sig.toScript extremes) per scene.

import { fillGaps, smooth, normalise, toScript, signalExtremes } from './graph/nodes/signal.js';
import { rdp } from './edit/density.js';
import { sceneAt, channelOf, series, linkFor, strayFence, maskRun, cutPoints } from './runs.js';
import { continuations } from './scenes-continue.js';
import { lowerBound } from './lane.js';
import { cleanJoins } from './core/script.js';
import { splitName, partLabel, whoName, WHOS } from '../features/tracking/groups.js';
import { deriveChannels, deriveClean, reprojects, userReprojects, trackedAxis } from './rederive.js';
import { canSource, resolveSource, fusionInput, splice, BLEND_MS } from './signal-source.js';
import { fusedChannel, canFuse, fusionGroups } from './fusion.js';
import { strokes as strokesOf, STROKES, frameTurn, inSpans } from './strokes.js';
import { dressPoints, shapeAt } from './stroke-shape.js';
import { shaftDepth, depthR, partOf, isShaftSource, SHARE_MIN, R_MIN } from './shaft.js';
import { shaftChannel } from './shaft-source.js';
import { averagedRun, averagedChannel, loopStates, loopPeriods } from './loop-average.js';
import { heldRun } from './held.js';
import { flipChannel, flipsIn, flipsClean, directionOf, loopFlips, flippedAt } from './polarity.js';

// Defaults = match the tracker: the channel's own range over the run onto 0..100 (what the lane draws), no smoothing, a
// point at the top and bottom of every stroke (prominence 1 on 0..100 drops jitter only). Adjustments are opt-in:
// fit 'scene' (each scene's min..max), 'rolling' (the sidecar's 3 s p5..p95 window: a drift or one big move stops
// squashing the strokes, but small strokes become full ones), smoothing, a higher prominence.
export const CHANNEL_FIT = { fit: 'run', maxGapMs: 500, sigmaMs: 0, minProminence: 1, minGapMs: 60, normWindowMs: 3000, detail: 0, stitch: 'smart' };

// paw-4c48.10: an absolute channel (the shaft source) keeps its shape between the turns too (its points within detailTol(8) =
// 3.4 pos of what it reads), so the script follows the position bar's diamond, not only at the turns
const ABS_DETAIL = 8;
// detail 1..10 -> RDP tolerance in pos units, linear 12..1 (never below 1, so +-0.5 rounding at the turns adds nothing on straight strokes)
const detailTol = (d) => 12 - ((Math.min(10, d) - 1) * 11) / 9;

/** paw-s80k: |r| a shot's own signal needs with its scene's channel to be matched to it (channelPatch). */
export const MATCH_R = 0.3;
/** Pearson r of channel c against channel ref (linear at c's times, within 60 ms of a ref sample) over [a, b); 0 under 10 pairs. */
export function corrOver(c, ref, a, b) {
  let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let j = 0; j < c.t.length; j++) {
    const t = c.t[j], x = c.v[j];
    if (t < a || t >= b || x == null || x !== x) continue;
    const k = lowerBound(ref.t, t), k0 = Math.max(0, k - 1), k1 = Math.min(ref.t.length - 1, k);
    const t0 = ref.t[k0], t1 = ref.t[k1], y0 = ref.v[k0], y1 = ref.v[k1];
    if (!(Math.min(Math.abs(t - t0), Math.abs(t1 - t)) <= 60) || y0 == null || y1 == null || y0 !== y0 || y1 !== y1) continue;
    const y = t1 > t0 ? y0 + ((y1 - y0) * Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))) : y0;
    n++; sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y;
  }
  const vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n;
  return n >= 10 && vx > 1e-12 && vy > 1e-12 ? (sxy - (sx * sy) / n) / Math.sqrt(vx * vy) : 0;
}

/** One scene's samples -> {x: graph signal {i0: 0, dt, v} (gaps filled, smoothed), t0, n, dt, ctx}, or null (no data). */
function sceneGrid(t, v, o) {
  // every frame has a channel entry (null when lost), so the scene's mean spacing is the frame interval (ms are rounded)
  const t0 = t[0], dt = t.length > 1 ? (t[t.length - 1] - t0) / (t.length - 1) || 1000 / 30 : 1000 / 30;
  const n = Math.round((t[t.length - 1] - t0) / dt) + 1;
  const grid = new Float32Array(n).fill(NaN);
  for (let j = 0; j < t.length; j++) if (v[j] === v[j]) grid[Math.round((t[j] - t0) / dt)] = v[j];
  const ctx = { grid: () => ({ i0: 0, n, dt }) };
  let x = { i0: 0, dt, v: grid };
  x = fillGaps.eval({ signal: x }, { maxGapMs: o.maxGapMs, mode: 'linear' }, ctx).signal;
  if (o.sigmaMs > 0) x = smooth.eval({ signal: x }, { method: 'gaussian', windowMs: 4 * o.sigmaMs }, ctx).signal;   // sig.smooth: sigma = window / 4
  return x.v.some((y) => y === y) ? { x, t0, n, dt, ctx } : null;
}

// ---- carrier: the slow motion the strokes ride on (camera drift, a body bob; "FM"), per scene link, never baked ----
// link.baseline = {mode: 'off' | 'auto' | 'knots', knots?: [[ms, value]]} (raw channel units; the user's knots are kept
// while the mode is off / auto, so switching back restores them): points come from channel −
// baseline (+ the run range's middle), then the usual fit. link.envelope = {mode: 'off' | 'auto'}: top / bottom curves
// through the extremes; the strokes are stretched between them (full strokes all scene long).
// ponytail: envelope is auto only; editable top / bottom knots would reuse spline() and the lane's knot drag.
/** A link from a file with its carrier fields checked (a malformed baseline / envelope is dropped, the link kept). */
export function carrierClean(l) {
  const { baseline: b, envelope: e, ...rest } = l;
  const knotsOk = (k) => Array.isArray(k) && k.length > 0 && k.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const knots = knotsOk(b?.knots) ? { knots: b.knots } : {}, mode = ['off', 'auto', 'knots'].includes(b?.mode) && (b.mode !== 'knots' || knots.knots) ? b.mode : null;
  return { ...rest, ...(mode && (mode !== 'off' || knots.knots) ? { baseline: { mode, ...knots } } : {}), ...(e?.mode === 'auto' ? { envelope: { mode: 'auto' } } : {}) };
}
export const carrierOn = (l) => l?.baseline?.mode === 'auto' || (l?.baseline?.mode === 'knots' && !!l.baseline.knots?.length) || l?.envelope?.mode === 'auto';

/** Catmull-Rom (cubic Hermite, tangent = the neighbours' secant) through knots [[t, v]]; flat beyond the ends. -> t => v.
 *  Not monotone on purpose: a carrier peaks between knots, and a monotone spline would flatten every peak to its knots. */
export function spline(knots) {
  const k = (knots || []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1])).sort((a, b) => a[0] - b[0]);
  const n = k.length;
  if (!n) return () => NaN;
  if (n === 1) return () => k[0][1];
  const sec = (a, b) => (k[b][1] - k[a][1]) / (k[b][0] - k[a][0] || 1), m = k.map((_, i) => sec(Math.max(0, i - 1), Math.min(n - 1, i + 1)));
  return (t) => {
    if (t <= k[0][0]) return k[0][1];
    if (t >= k[n - 1][0]) return k[n - 1][1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const c = (lo + hi) >> 1; if (k[c][0] <= t) lo = c; else hi = c; }
    const h = k[hi][0] - k[lo][0], u = (t - k[lo][0]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * k[lo][1] + (u3 - 2 * u2 + u) * h * m[lo] + (-2 * u3 + 3 * u2) * k[hi][1] + (u3 - u2) * h * m[hi];
  };
}

/**
 * Auto knots for one scene grid (sceneGrid: x, t0): which 'mid' = the midpoints of consecutive extremes (a top and the
 * next bottom), 'top' / 'bottom' = the extremes themselves. Extremes = turns of at least 10 % of the scene's range. One
 * knot every ~spacingMs (at least 3, first and last on the scene's ends), each a triangle-weighted mean of the points
 * within one knot spacing; none there: the window's mean (top: max, bottom: min) of the data. -> [[ms, value]].
 */
export function autoKnots(x, t0, which = 'mid', spacingMs = 2000) {
  const v = x.v, n = v.length, dt = x.dt;
  let lo = Infinity, hi = -Infinity;
  for (const y of v) if (y === y) { if (y < lo) lo = y; if (y > hi) hi = y; }
  if (lo > hi) return [];
  const ext = hi > lo ? signalExtremes(x, 0.1 * (hi - lo), { ends: false }) : [], pts = [];
  if (which === 'mid') { for (let j = 1; j < ext.length; j++) { const a = ext[j - 1], b = ext[j]; if (a.kind !== b.kind && a.run === b.run) pts.push([(a.at + b.at) / 2, (a.value + b.value) / 2]); } }
  else for (const e of ext) if (e.kind === which) pts.push([e.at, e.value]);
  const dur = (n - 1) * dt, m = Math.max(3, Math.round(dur / spacingMs) + 1), step = dur / (m - 1) || 1, out = [];
  for (let i = 0; i < m; i++) {
    const tk = i * step;
    // triangle-weighted local line through the points, read at the knot (a plain mean would lag a slope at the scene's ends)
    let c = 0, st = 0, sy = 0, stt = 0, sty = 0;
    for (const [t, y] of pts) { const wt = 1 - Math.abs(t - tk) / step, u = t - tk; if (wt > 0) { c += wt; st += wt * u; sy += wt * y; stt += wt * u * u; sty += wt * u * y; } }   // ponytail: O(knots x points), fine for minutes-long scenes
    const den = c * stt - st * st;
    // the line's value at the knot (times c, divided below); points bunched in under an eighth of a spacing: their mean
    let s = c && den > (c * step / 8) ** 2 ? ((sy * stt - st * sty) / den) * c : sy;
    if (!c) {
      let a = which === 'top' ? -Infinity : which === 'bottom' ? Infinity : 0, q = 0;
      for (let k = Math.max(0, Math.floor((tk - step) / dt)); k <= Math.min(n - 1, Math.ceil((tk + step) / dt)); k++) {
        const y = v[k];
        if (y !== y) continue;
        if (which === 'top') a = Math.max(a, y); else if (which === 'bottom') a = Math.min(a, y); else a += y;
        q++;
      }
      if (!q) continue;
      s = which === 'mid' ? a / q : a; c = 1;
    }
    out.push([Math.round(t0 + tk), +(s / c).toPrecision(6)]);
  }
  return out;
}

/** The carrier curves of a scene grid for link fields {baseline, envelope}: {mid, top, bottom} knots ([[ms, v]]) or null. */
function curvesOf(g, baseline, envelope) {
  const mid = baseline?.mode === 'knots' && baseline.knots?.length ? baseline.knots : baseline?.mode === 'auto' ? autoKnots(g.x, g.t0, 'mid') : null;
  const env = envelope?.mode === 'auto';
  return { mid, top: env ? autoKnots(g.x, g.t0, 'top') : null, bottom: env ? autoKnots(g.x, g.t0, 'bottom') : null };
}

/** The grid with the carrier taken out: v − mid(t) + the range's middle; with an envelope, stretched between its curves onto the range.
 *  paw-gy1r: lv (a seated fused scene's level on the grid) = the level the strokes ride on: the owner's knots replace it
 *  (v − lv + knots(t): the dashed line is where the strokes sit). */
function removeCarrier(g, c, [lo, hi], lv = null) {
  const B = c.mid && spline(c.mid), T = c.top?.length && c.bottom?.length && spline(c.top), D = T && spline(c.bottom);
  if (!B && !T) return g.x;
  const v = Float32Array.from(g.x.v, (y, k) => {
    if (y !== y) return y;
    const t = g.t0 + k * g.dt;
    if (!T && lv) return Number.isFinite(lv[k]) ? y - lv[k] + B(t) : y;
    if (!T) return y - B(t) + (lo + hi) / 2;
    const top = T(t), bot = D(t), w = top - bot, u = w > 1e-9 ? 0.5 + (y - (B ? B(t) : (top + bot) / 2)) / w : 0.5;
    return lo + (hi - lo) * Math.min(1, Math.max(0, u));
  });
  return { ...g.x, v };
}

// ---- paw-2ntn: the anchor, where a stroke shorter than the range sits (a shot's derive.anchorTo, per run per shot) ----
// Fusion centers every relationship over two strokes (fusion.js rows' r.f) before the piece's p2..p98 sets the scale: a stretch of half strokes comes out
// 25..75, round the middle. 'middle' (absent) keeps that; 'in' / 'out' pin the deep / out ends; 'full' is the link's envelope.
export const ANCHORS = ['middle', 'in', 'out', 'full'];
/** One scene's points q [[at, pos, ...rest]] (sorted, as played) with every stroke's deep end ('in': its bottom, pos 0) or out
 *  end ('out': its top, pos 100) pinned there. A turn of that kind moves onto the edge; every other point moves by the line
 *  between the moves of the pinned turns either side of it (flat past the first / last), so each stroke keeps its size (a half
 *  stroke is half the range tall) and a drift under the strokes goes. A hold (equal points) is one turn. A turn whose larger
 *  half-stroke is under a quarter of the local half-stroke size (a wobble at a turn) is not pinned: it rides along.
 *  ponytail: a quarter of the median of 8 half-strokes; a per-turn prominence from the strokes step if wobbles still pin. */
export function anchorStrokes(q, side) {
  const n = q.length, k = side === 'in' ? -1 : 1, edge = side === 'in' ? 0 : 100;
  if (n < 3 || (side !== 'in' && side !== 'out')) return q;
  const runs = [];
  for (let j = 0; j < n;) { let e = j; while (e + 1 < n && q[e + 1][1] === q[j][1]) e++; runs.push([j, e]); j = e + 1; }
  const T = [];
  for (let r = 1; r + 1 < runs.length; r++) {
    const v = q[runs[r][0]][1], a = q[runs[r - 1][0]][1], b = q[runs[r + 1][0]][1];
    if ((v > a && v > b) || (v < a && v < b)) T.push({ j0: runs[r][0], j1: runs[r][1], v, kind: v > a ? 1 : -1 });
  }
  // half-strokes between the turns, the scene's first / last point as the ends: h[m] before turn m, h[m + 1] after it
  const V = [q[0][1], ...T.map((x) => x.v), q[n - 1][1]], h = V.slice(1).map((v, m) => Math.abs(v - V[m]));
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  const pins = T.filter((x, m) => x.kind === k && Math.max(h[m], h[m + 1]) >= 0.25 * med(h.slice(Math.max(0, m - 3), m + 5)));
  if (!pins.length) return q;
  const o = (x) => x.v - edge;
  let c = -1;
  return q.map((p, j) => {
    while (c + 1 < pins.length && pins[c + 1].j0 <= j) c++;
    const A = pins[c], B = pins[c + 1];
    const d = !A ? o(B) : !B || j <= A.j1 ? o(A) : o(A) + ((o(B) - o(A)) * (p[0] - q[A.j1][0])) / (q[B.j0][0] - q[A.j1][0] || 1);
    return [p[0], Math.min(100, Math.max(0, Math.round(p[1] - d))), ...p.slice(2)];
  });
}

/** One scene's samples -> [{at, pos}]: grid, fill gaps, smooth, carrier out (o.baseline / o.envelope), fit (run range | scene min..max | rolling), extremes. */
function scenePoints(t, v, sign, o, range, lev = null) {
  const g = sceneGrid(t, v, o);
  if (!g) return [];
  const { t0, n, dt, ctx } = g;
  // paw-gy1r: a seated scene (lev: its depth level) keeps that level: only the owner's knots move it (auto would flatten it)
  const lv = lev ? sceneGrid(t, lev, { ...o, sigmaMs: 0 })?.x.v : null, c = carrierOn(o) ? curvesOf(g, o.baseline, o.envelope) : null;
  if (c && lv && o.baseline?.mode !== 'knots') c.mid = null;
  const x = c ? removeCarrier(g, c, range, lv) : g.x;
  let fit;
  if (o.fit === 'run') {   // the channel's range over the whole run (the lane's own scale): the tracker data as is
    const [lo, hi] = range;
    fit = Float32Array.from(x.v, (y) => (hi - lo < 1e-9 ? 50 : Math.min(100, Math.max(0, (100 * (y - lo)) / (hi - lo)))));
  } else {   // fit after smoothing; rolling = the sidecar's p5..p95 window (scenes shorter than the window: the whole scene)
    const local = o.fit === 'rolling' && o.normWindowMs > 0 && n * dt > o.normWindowMs;
    fit = normalise.eval({ signal: x }, { mode: local ? 'local' : 'global', pLo: local ? 5 : 0, pHi: local ? 95 : 100, windowMs: o.normWindowMs, outLo: 0, outHi: 100, clamp: true }, ctx).signal.v;
  }
  // larger value = out = pos 100 (proj's convention); the sidecar's scene sign (shaft / pipe_invert) as on the primary
  if (sign < 0) for (let k = 0; k < n; k++) fit[k] = 100 - fit[k];
  const p = { mode: 'extremes', minProminence: o.minProminence, minGapMs: Math.max(o.minGapMs, 2 * dt), gaps: 'break' };
  let turns = toScript.eval({ signal: { i0: 0, dt, v: fit } }, p, ctx).script;
  // paw-imsi: inside a detected exact loop (o.exact) a turn sits on the frame of its extreme drawing, not between frames
  if (o.exact?.length) {
    const gt = Float64Array.from({ length: n }, (_, q) => q * dt);
    turns = turns.map((b, j) => {
      const pa = turns[j - 1]?.pos, pb = turns[j + 1]?.pos, k = pa == null || pb == null ? 0 : b.pos > pa && b.pos > pb ? 1 : b.pos < pa && b.pos < pb ? -1 : 0;
      if (!k || !inSpans(o.exact, b.at + t0)) return b;
      const at = frameTurn(gt, fit, Math.max(0, Math.min(n - 1, Math.round(b.at / dt))), k, 1);
      const v = fit[Math.floor(at / dt + 1e-9)];
      return Number.isFinite(v) ? { ...b, at, pos: v } : b;
    });
  }
  const out = [];
  for (let j = 0; j < turns.length; j++) {
    const b = turns[j];
    if (o.detail > 0 && j) {   // between consecutive turns: the fitted frames, Douglas-Peucker'd, interior kept
      const ka = Math.round(turns[j - 1].at / dt), kb = Math.round(b.at / dt), m = kb - ka + 1;
      if (m > 2) {
        const ts = new Float64Array(m), vs = new Float64Array(m), keep = new Uint8Array(m);
        for (let q = 0; q < m; q++) { ts[q] = q; vs[q] = fit[ka + q]; }
        vs[0] = turns[j - 1].pos; vs[m - 1] = b.pos; keep[0] = keep[m - 1] = 1;
        rdp(ts, vs, keep, detailTol(o.detail));
        for (let q = 1; q < m - 1; q++) if (keep[q]) out.push({ at: Math.round((ka + q) * dt + t0), pos: Math.round(Math.min(100, Math.max(0, vs[q]))) });
      }
    }
    out.push({ at: Math.round(b.at + t0), pos: b.pos });
  }
  return out;
}

/** A channel's samples split by run scene (sceneAt: no scenes = one, key -1), sorted -> [[k, {t, v}]]; plus its [min, max]. */
function byScene(run, ch) {
  const scenes = run.scenes || [], by = new Map();
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < ch.t.length; j++) {
    const k = sceneAt(scenes, ch.t[j]), y = ch.v[j];
    if (!by.has(k)) by.set(k, { t: [], v: [], conf: ch.conf ? [] : null, timing: ch.timing ? [] : null, level: ch.level ? [] : null });
    const b = by.get(k);
    b.t.push(ch.t[j]); b.v.push(y);
    if (b.conf) b.conf.push(ch.conf[j]);
    if (b.timing) b.timing.push(ch.timing[j]);
    if (b.level) b.level.push(ch.level[j]);   // paw-gy1r: the depth level a seated fused scene rides on
  }
  for (const b of by.values()) {
    const f = ch.absolute ? null : strayFence(b.v);   // paw-4c48.10: an absolute channel's values are positions: none is a stray
    for (let j = 0; j < b.v.length; j++) {
      const y = b.v[j];
      if (f && (y < f[0] || y > f[1])) b.v[j] = NaN;   // a gap, not the scale of the whole run
      else if (y === y) { if (y < lo) lo = y; if (y > hi) hi = y; }
    }
  }
  return { parts: [...by].sort((a, b) => a[0] - b[0]), range: ch.absolute ? [0, 1] : [lo, hi] };
}

/** Channel `name` of `run` -> points {at, pos} (Float64Array, makeRun's shape), per run scene, NaN gaps > maxGapMs kept.
 *  opts.only = a run scene index: only that scene (a scene with its own carrier is composed alone). With opts.strokes also
 *  why / by / cap per point (strokes.js), low, depthUsed [{k, want ('auto' | a range), used, r (shaft.js depthR), share}]
 *  per run scene with a SAM shaft (paw-6t7d: 'shaft' wanted, 'scene' used where the shaft's depth does not follow). */
export function pointsFromChannel(run, name, opts = {}) {
  const o = { ...CHANNEL_FIT, ...opts }, ch = run.channels?.[name], out = [], low = [], depthUsed = [];
  if (ch?.t.length) {
    const scenes = run.scenes || [], { parts, range } = byScene(run, ch);
    for (const [k, s] of parts) {
      if (o.only != null && scenes.length && k !== o.only) continue;
      // the scene's direction (paw-vtec, polarity.js directionOf): the sidecar's sign (a rel: channel has its own rule, the
      // sidecar's samples carry it already: signed) times the owner's whole-scene flip (opts.flipped), on the signal
      const sign = (name.startsWith('rel:') || ch.signed ? 1 : scenes[k]?.sign ?? 1) * (o.flipped?.includes(Math.max(0, k)) ? -1 : 1);
      // paw-e3i: opts.strokes = the new strokes step (lib/strokes.js) for this channel; else the classic fit + extremes
      // paw-azd: a scene with a confident SAM shaft takes its depth from it (range 'shaft') unless a range was chosen.
      // paw-6t7d: only a shaft whose depth follows the signal (r >= R_MIN, shaft.js depthR): one that does not (the owner's
      // r -0.11, confident on every frame) gave every stroke its own noise extremes as depth; then 'scene', said in depthUsed.
      // paw-s80k: |r| decides, and the depth is read the way the scene plays (1 - share where it runs against the signal as
      // played): a flip (F) mirrors the points exactly. It was r >= R_MIN: one direction anchored to the shaft, the flipped
      // one on the scene's range, so the two were different points (up to 68 pos apart on the synthetic suite)
      // paw-4c48.10: an absolute channel (the shaft source: its values are pos / 100) keeps its depth as it reads ('abs')
      const st = () => ch.absolute ? strokesPts({ range: 'abs' }) : depthPts();
      const strokesPts = (x) => {
        const r = strokesOf(s.t, s.v, { ...STROKES, ...o.strokes, ...x, ...(o.exact?.length ? { exact: o.exact } : {}), ...(o.mask ? { mask: o.mask } : {}), sign, conf: s.conf, timing: s.timing, how: ch.how, pic: o.picAt ? Array.from(s.t, o.picAt) : undefined, keepLevel: !!ch.depth?.[Math.max(0, k)]?.used });
        low.push(...r.low);
        return r.points;
      };
      const depthPts = () => {
        const sd = o.strokes.range == null || o.strokes.range === 'shaft' ? shaftDepth(run, k, s.t, o.calib, { aspect: o.aspect, motion: { t: s.t, v: s.v } }) : null;
        const want = o.strokes.range ?? (sd && sd.share >= SHARE_MIN ? 'shaft' : undefined), dr = sd ? depthR(s.v, sd.depth, sign) : 0;
        const range = want === 'shaft' && sd && !(Math.abs(dr) >= R_MIN) ? 'scene' : want;
        if (sd) depthUsed.push({ k, want: o.strokes.range ?? 'auto', used: range ?? STROKES.range, r: Math.round(dr * 100) / 100, share: Math.round(sd.share * 100) / 100 });
        const depth = range === 'shaft' && sd ? (dr < 0 ? sd.depth.map((x) => 1 - x) : sd.depth) : undefined;
        return strokesPts({ ...(range ? { range } : {}), depth });
      };
      const pts = o.strokes && !carrierOn(o) ? st() : scenePoints(s.t, s.v, sign, ch.absolute ? { ...o, fit: 'run', detail: Math.max(o.detail || 0, ABS_DETAIL) } : o, range, ch.depth?.[Math.max(0, k)]?.used ? s.level : null);
      for (const q of pts) if (!out.length || q.at > out[out.length - 1].at) out.push(q);
    }
  }
  return { at: Float64Array.from(out, (q) => q.at), pos: Float64Array.from(out, (q) => q.pos), ...(o.strokes ? { why: out.map((q) => q.why || 'turn'), by: out.map((q) => q.by || ''), cap: out.map((q) => (q.cap ? 1 : 0)), low, depthUsed } : {}) };
}

/** Per run scene (none: the whole range is one), the channel and fit it uses: this run's scene link for it (tracking
 *  `links` [{t0, t1, run, channel, fit?, baseline?, envelope?}], lib/runs.js linkFor), else the run's own `channel` with
 *  `fit`. -> [{channel, fit, link (the link object or null)}]. */
export function sceneChannels(run, links = [], fit = {}) {
  const mine = links.filter((l) => l.run === run.id && (l.channel === 'primary' || run.channels?.[l.channel]));
  const scenes = run.scenes?.length ? run.scenes : [{ start_ms: run.range.start, end_ms: run.range.end }];
  return scenes.map((s) => { const l = mine[linkFor(mine, s)]; return l ? { channel: l.channel, fit: l.fit || fit, link: l } : { channel: run.channel, fit, link: null }; });
}

/**
 * The carrier curves the Tracker row draws for a run: per run scene whose link has a baseline or envelope on and a
 * channel the run has -> [{i, t0, t1, link, channel, mid, top, bottom}] (knots [[ms, raw value]] or null; t0..t1 =
 * the scene's samples' extent). Same grid and auto knots as the points (pointsFromChannel), so the curve is the one used.
 */
export function carriers(run, links = [], fit = {}) {
  const out = [], per = sceneChannels(run, links, fit), cache = new Map();
  per.forEach((p, i) => {
    // paw-gy1r: a fused scene seated on a depth reference always shows the level it rides on (the owner's knots, else the
    // reference's level: level true), baseline on or off
    const fz = run.channels?.fused, lev = (p.channel === 'fused' || run.sceneChannels?.[i] === 'fused') && fz?.depth?.[i]?.used ? fz : null;
    const name = lev ? 'fused' : p.channel, ch = run.channels?.[name];
    if (!ch?.t.length || !(carrierOn(p.link) || lev)) return;
    if (!cache.has(name)) cache.set(name, new Map(byScene(run, ch).parts));
    const s = cache.get(name).get(run.scenes?.length ? i : -1), g = s && sceneGrid(s.t, s.v, { ...CHANNEL_FIT, ...p.fit });
    if (!g) return;
    const c = curvesOf(g, p.link?.baseline, p.link?.envelope);
    if (lev && p.link?.baseline?.mode !== 'knots') {   // one knot a second along the level (slow: the spline redraws it)
      const m = Math.max(3, Math.round((s.t[s.t.length - 1] - s.t[0]) / 1000) + 1), q = (k) => Math.round(((s.t.length - 1) * k) / (m - 1));
      c.mid = Array.from({ length: m }, (_, k) => [Math.round(s.t[q(k)]), +(+s.level[q(k)]).toPrecision(6)]).filter((x) => Number.isFinite(x[1]));
    }
    out.push({ i, t0: g.t0, t1: g.t0 + (g.n - 1) * g.dt, link: p.link, channel: name, ...c, ...(lev ? { level: true } : {}) });
  });
  return out;
}

const pct = (x) => Math.round(x * 100) + '%';
// ---- groups: the pinned ones (painted, or seeded from the tagger), named per scene ----
// pinned semantic groups (v4.6, seeded from the tagger's CAM): hips / penis default to _proj, balls to _scale (contraction)
// paw-ol3: _pulse = a pulse group's contraction signal from detect cumshots (lib/cum.js pulseChannels); an anus shows it first
const SEM_ALTS = { hips: ['proj', 'rel', 'scale', 'pulse'], penis: ['proj', 'rel', 'scale', 'pulse'], balls: ['scale', 'proj', 'rel', 'pulse'], anus: ['pulse', 'proj', 'rel', 'scale'] };
/** 'sem_hips_proj' -> {key: 'sem_hips', sem: 'hips', kind: 'proj'} (a pinned group); else null. */
export function groupOfChannel(c) {
  // v4.11: any user group name; v4.12 a character's ('sem_c1_hand_l_proj': the name holds underscores, the kind does not)
  const s = /^sem_([a-z0-9_]+?)_(x|y|n|proj|rel|scale|area|pulse)$/.exec(c || '');
  return s ? { key: 'sem_' + s[1], sem: s[1], kind: s[2] } : null;
}
/** The channels one picker chip offers that the run has, its default first: a pinned group _proj, _rel, _scale (balls:
 *  _scale first); any other channel just itself. */
export function chipVariants(run, c) {
  const g = groupOfChannel(c), alts = g && (SEM_ALTS[splitName(g.sem).part] || SEM_ALTS.hips);
  return alts?.includes(g.kind) ? alts.map((k) => `${g.key}_${k}`).filter((n) => run?.channels?.[n]) : [c];
}
const PICK = /^sem_[a-z0-9_]+_(proj|rel|scale|pulse)$|^who_(c[12]|x|pair|p1h2|p2h1)_proj$|^cam_[xy]$|^proj_cam$/;
const SEM_RANK = { hips: 12.1, balls: 12.2, penis: 12.3 };
// v4.12: a character's groups after the plain ones, Bottom then Top then Extra; the characters' own channels after them
const semRank = (s) => { const q = splitName(s); return q.who ? 12.5 + ({ c2: 0.25, x: 0.5 }[q.who] || 0) + (SEM_RANK[q.part] ?? 12.4) / 1000 : SEM_RANK[s] ?? 12.5; };
const WHO_RANK = { who_c1_proj: 13.1, who_c2_proj: 13.2, who_x_proj: 13.25, who_pair_proj: 13.3, who_p1h2_proj: 13.4, who_p2h1_proj: 13.5 };
/** A character channel (PROTOCOL v4.12) as people read it: 'who_c1_proj' -> 'Bottom center', 'who_pair_proj' -> 'Bottom ↔ Top',
 *  'who_p1h2_proj' -> 'Bottom penis ↔ Top hips' (_dist the same + ' (fh)'); else ''. */
export function whoLabel(c) {
  const m = /^who_(c[12]|x|pair|p1h2|p2h1)_(proj|dist|x|y|n)$/.exec(c || '');
  if (!m) return '';
  const B = whoName('c1'), T = whoName('c2');
  const base = WHOS.includes(m[1]) ? `${whoName(m[1])} center` : { pair: `${B} ↔ ${T}`, p1h2: `${B} penis ↔ ${T} hips`, p2h1: `${T} penis ↔ ${B} hips` }[m[1]];
  return m[2] === 'proj' ? base : `${base} ${m[2]}`;
}
// paw-u6s5: a channel as the source menu says it (user words; the channel id never reaches a label)
const CHANNEL_WORDS = { primary: "Tracker's choice", fused: 'Fused', proj: 'All points', proj_cam: 'All points, camera removed', cam_x: 'Camera left / right',
  cam_y: 'Camera up / down', centroid_x: 'Points left / right', centroid_y: 'Points up / down',
  centroid_auto: 'Points along their motion', dist01: 'Distance of the first two clicks', vis_frac: 'Share of points visible',
  vis_extent: 'Share of the seed line visible', vis_len: 'Visible length' };
/** A group channel's variant as people read it ('sem_penis_rel' in the variants submenu -> 'Own motion'). */
export const VARIANT_WORDS = { proj: 'Position', rel: 'Own motion', scale: 'Size', pulse: 'Contractions', area: 'Area' };
/** 'cam_x' -> 'Camera left / right', 'p0_y' -> 'Point 1 up / down', 'who_c1_proj' -> 'Bottom center';
 *  an unknown id -> its words ('vis_foo' -> 'Vis foo'). A pinned group's own name comes from labelOf. */
export function channelWord(c) {
  if (CHANNEL_WORDS[c]) return CHANNEL_WORDS[c];
  const p = /^p(\d+)_([xy])$/.exec(c || '');
  if (p) return `Point ${+p[1] + 1} ${p[2] === 'x' ? 'left / right' : 'up / down'}`;
  const w = whoLabel(c) || String(c || '').replace(/_/g, ' ');
  return w ? w[0].toUpperCase() + w.slice(1) : '';
}
/** Has channel c (a relative one: both its groups) a value in [t0, t1)? 'primary' / 'fused' (made per scene): yes. A
 *  channel without its own times is taken as in range. */
export function channelHasData(run, c, t0 = -Infinity, t1 = Infinity) {
  if (c === 'primary' || c === 'fused') return true;
  const r = relParse(c);
  if (r) return channelHasData(run, r.a + '_x', t0, t1) && channelHasData(run, r.b + '_x', t0, t1);
  const ch = run?.channels?.[c];
  for (let i = 0; i < (ch?.v?.length || 0); i++) { const t = ch.t ? ch.t[i] : t0; if (t >= t0 && t < t1 && Number.isFinite(ch.v[i])) return true; }
  return false;
}
/** The channels a lane picker offers for a run: 'primary', then the camera-removed / group set when the run has one
 *  (proj_cam; the pinned groups: sem_hips_proj, sem_balls_scale, sem_penis_proj; the characters' who_*; cam_x, cam_y),
 *  else every channel it has. A group's other channels are its chip's variants (chipVariants). */
export function pickerChannels(run) {
  const names = Object.keys(run?.channels || {}).filter((n) => n !== 'fused');   // 'fused' (paw-e3i): second, when the run has parts to fuse
  const rank = (n) => { const g = groupOfChannel(n); return n === 'proj_cam' ? 0 : g ? semRank(g.sem) : WHO_RANK[n] ?? (n === 'cam_x' ? 14 : 15); };
  const set = [...new Set(names.filter((n) => PICK.test(n)).sort((a, b) => rank(a) - rank(b)).map((n) => chipVariants(run, n)[0]))];
  return ['primary', ...(canFuse(run) ? ['fused'] : []), ...(set.length ? set : names.filter((n) => !n.startsWith('rel:')))];
}
/** Share of the frames in [t0, t1) on which group `key` ('sem_c1_hips') is present ({key}_n > 0). No _n channel: 1. */
export function groupPresence(run, key, t0 = -Infinity, t1 = Infinity) {
  const ch = run?.channels?.[key + '_n'];
  if (!ch?.v) return 1;
  let on = 0, n = 0;
  for (let i = 0; i < ch.v.length; i++) { const t = ch.t ? ch.t[i] : 0; if (t >= t0 && t < t1) { n++; if (ch.v[i] > 0) on++; } }
  return n ? on / n : 0;
}
/** The records of run scene k's pinned groups ({sem_c1_penis: {label, source, points, ...}, ...}): the scene record's
 *  groups, else that scene's group_labels note data; {} when none. */
export function sceneGroups(run, k) {
  const g = run?.scenes?.[Math.max(0, k)]?.groups;
  if (g && typeof g === 'object') return g;
  const n = (run?.notes || []).find((x) => x?.code === 'group_labels' && (x.scene_index ?? 0) === Math.max(0, k) && x.data?.groups);
  return n ? n.data.groups : {};
}
/** A channel's group name: a pinned group 'sem_hips_proj' -> 'hips (seeded)' (named by its channel when the scene has
 *  no record); none -> ''. */
export const labelOf = (groups, c) => {
  const g = groupOfChannel(c);
  return g ? `${partLabel(groups?.[g.key]?.label || g.sem)} (${groups?.[g.key]?.source === 'user' ? 'drawn' : 'seeded'})` : '';
};
/** A group name's evidence as text: top tags (tagger heat), margin, stability, a suspect fallback; a pinned group
 *  (source cam): where it came from, its tag score and points. */
export function labelText(rec) {
  if (rec?.source === 'user') return ['drawn on the video (Groups)', rec.points != null && `${rec.points} points`].filter(Boolean).join(' · ');
  if (rec?.source === 'cam') return ['seeded from the tagger (CAM)', rec.score != null && `tag ${pct(rec.score)}`, rec.points != null && `${rec.points} points`].filter(Boolean).join(' · ');
  if (!rec?.label) return '';
  const tags = Object.entries(rec.tags || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${pct(v)}`);
  return [`named ${rec.label}`, tags.length && `tags ${tags.join(', ')}`, rec.score && `margin ${rec.score}`,
    rec.stable != null && `stable ${pct(rec.stable)} of ${rec.frames ?? '?'} frames`, rec.suspect && `${rec.suspect} won but the group is too big for it`].filter(Boolean).join(' · ');
}
/** Run scene k's balls contraction channel: the pinned balls group's 'sem_balls_scale' when it has a value in the
 *  scene, else ''. */
export function ballsScale(run, k) {
  const sb = run?.channels?.sem_balls_scale, sc = run?.scenes?.[k];
  for (let i = 0; i < (sb?.t?.length || 0); i++) if (sb.v[i] === sb.v[i] && sb.v[i] != null && (!sc || (sb.t[i] >= sc.start_ms && sb.t[i] < sc.end_ms))) return 'sem_balls_scale';
  return '';
}
/**
 * Spurt times from a part's contraction channel (sem_<name>_scale, raw, high-passed) over [t0, t1): local maxima of
 * sign x its 3-sample mean that clear median + k x MAD (robust sigma), at least minGapMs apart (the taller wins).
 * sign -1 = the part shrinking (a contraction), +1 = swelling. Fewer than 5 values or a flat signal: []. -> [t ms].
 * ponytail: one robust threshold per scene; add a rate prior (pulses ~0.6-1 s apart) if real runs show false peaks.
 */
export function scalePeaks(ch, t0, t1, { sign = -1, k = 2, minGapMs = 300 } = {}) {
  const T = [], V = [];
  for (let i = 0; i < (ch?.t?.length || 0); i++) { const v = ch.v[i]; if (ch.t[i] >= t0 && ch.t[i] < t1 && v != null && v === v) { T.push(ch.t[i]); V.push(sign * v); } }
  const n = V.length;
  if (n < 5) return [];
  const s = V.map((_, i) => (V[Math.max(0, i - 1)] + V[i] + V[Math.min(n - 1, i + 1)]) / 3);
  const med = (a) => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const c = med(s), mad = 1.4826 * med(s.map((y) => Math.abs(y - c)));
  if (!(mad > 0)) return [];
  const cand = [];
  for (let i = 1; i < n - 1; i++) if (s[i] > c + k * mad && s[i] >= s[i - 1] && s[i] > s[i + 1]) cand.push(i);
  const keep = [];
  for (const i of cand.sort((a, b) => s[b] - s[a])) if (keep.every((j) => Math.abs(T[j] - T[i]) >= minGapMs)) keep.push(i);
  return keep.map((i) => Math.round(T[i])).sort((a, b) => a - b);
}
/** The run's camera estimate is weak: mean cam_conf (sidecar, 0..1 per frame) below 0.3. No cam_conf channel: false. */
export function camWeak(run) {
  const v = run?.channels?.cam_conf?.v;
  let s = 0, n = 0;
  for (const y of v || []) if (y === y) { s += y; n++; }
  return n > 0 && s / n < 0.3;
}
/** Channels that rest on the camera estimate (greyed when it is weak): proj_cam, a character's center, a pinned
 *  group's _proj / _rel. */
export const camChannel = (c) => c === 'proj_cam' || /^who_(?:c[12]|x)_proj$|^sem_[a-z0-9_]+_(proj|rel)$/.test(c);

// ---- relative channels (frontend): one group's centroid relative to another's, on the stroke axis ----
// 'rel:<a>:<b>' (a, b = pinned groups: sem_penis, sem_c2_hips, ...) is built here from the run's camera-removed centroids
// ({a}_x / _y, PROTOCOL channel table), never by the sidecar: penis vs the other body's hips, hips vs hips, ...
const REL_GROUP = /^sem_[a-z0-9_]+$/;
/** 'rel:sem_penis:sem_hips' -> {a: 'sem_penis', b: 'sem_hips'}; anything else (or a = b) -> null. */
export function relParse(id) {
  const m = /^rel:([^:]+):([^:]+)$/.exec(id || '');
  return m && m[1] !== m[2] && REL_GROUP.test(m[1]) && REL_GROUP.test(m[2]) ? { a: m[1], b: m[2] } : null;
}
export const relId = (a, b) => `rel:${a}:${b}`;
/** The raw channels a relative channel is built from (what a saved run must keep). */
export const relSources = (id) => { const r = relParse(id); return r ? [r.a, r.b].flatMap((k) => [k + '_x', k + '_y']) : []; };
/** Run scene k's stroke axis from the sidecar (decision record axis.deg, else a kept scene's axis_deg) or null. */
function sceneDeg(run, k) {
  const i = Math.max(0, k), d = decisionsOf(run?.notes)[i]?.axis?.deg ?? run?.scenes?.[i]?.axis_deg;
  return Number.isFinite(d) ? d : null;
}
/**
 * Relative channel of `run`: per run scene, s = (centroid a − centroid b) · u, frame heights (x times aspect = w / h),
 * NaN where either group is absent. u = the custom axis (opts.axis {x0, y0, x1, y1}, else run.params' axis: 'custom'),
 * else the sidecar's axis.deg for the scene (0° right, 90° up), else the principal axis of the difference over the scene.
 * Signed (not |s|), so the two may cross along the axis, then oriented so the scene's mean is >= 0 (groups.axis_dist's rule):
 * smaller = closer. Normalised 0..1 per scene by its min..max (who_pair_proj's rule; flat: 0.5), so closer = deeper = lower
 * pos. -> a channel ({t, v, min, max, scaled}, + axes: [{kind, deg}] per run scene) | null (a group has no centroid).
 * ponytail: one axis per scene; the sidecar groups.pair_dist's rolling axis (turntables) if an orbit scene ever needs it.
 */
/** run with its pinned groups' centres camera-handled per run scene as the derives say (cam only: a pair has its own `against`;
 *  paw-hiq5: a pair used to read the stored centres whatever the camera setting was, so "vs camera" did nothing on it). */
export const camInput = (run, derives, aspect) => {
  if (!derives || !(derives.length || derives[-1])) return run;
  const strip = (d) => (d?.against && d.against !== 'none' ? { ...d, against: undefined } : d);
  const dd = derives.map(strip);
  dd[-1] = strip(derives[-1]);
  return fusionInput(run, dd, aspect);
};
export function relChannel(run, a, b, { axis = null, aspect = 16 / 9, derives = null } = {}) {
  run = camInput(run, derives, aspect);
  const ch = run?.channels || {}, ax = ch[a + '_x'], ay = ch[a + '_y'], bx = ch[b + '_x'], by = ch[b + '_y'];
  if (!ax?.t?.length || !ay || !bx || !by) return null;
  const t = ax.t, n = t.length, scenes = run.scenes || [];
  const val = (c, j) => { if (c.t[j] === t[j]) return c.v[j]; const k = lowerBound(c.t, t[j]); return c.t[k] === t[j] ? c.v[k] : NaN; };
  const dx = new Float64Array(n), dy = new Float64Array(n);
  for (let j = 0; j < n; j++) { dx[j] = (val(ax, j) - val(bx, j)) * aspect; dy[j] = val(ay, j) - val(by, j); }
  const p = run.params || {}, cu = axis || (p.axis === 'custom' ? { x0: p.axis_x0, y0: p.axis_y0, x1: p.axis_x1, y1: p.axis_y1 } : null);
  const custom = cu && [cu.x0, cu.y0, cu.x1, cu.y1].every(Number.isFinite) && (cu.x1 !== cu.x0 || cu.y1 !== cu.y0) ? [(cu.x1 - cu.x0) * aspect, cu.y1 - cu.y0] : null;
  const v = new Float32Array(n).fill(NaN), per = new Map(), axes = [];
  for (let j = 0; j < n; j++) { const k = sceneAt(scenes, t[j]); if (!per.has(k)) per.set(k, []); per.get(k).push(j); }
  for (const [k, js] of per) {
    const ok = js.filter((j) => dx[j] === dx[j] && dy[j] === dy[j]);
    if (!ok.length) continue;
    const deg = custom ? null : sceneDeg(run, k);
    let u = custom, kind = 'custom';
    if (!u && deg != null) { u = [Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180)]; kind = 'sidecar'; }   // screen y grows down
    if (!u) {   // principal axis of the difference (groups.axis_dist's fit); under 3 frames: its mean direction
      let mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0;
      for (const j of ok) { mx += dx[j]; my += dy[j]; }
      mx /= ok.length; my /= ok.length;
      for (const j of ok) { const q = dx[j] - mx, r = dy[j] - my; sxx += q * q; syy += r * r; sxy += q * r; }
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      u = ok.length >= 3 && sxx + syy > 1e-12 ? [Math.cos(th), Math.sin(th)] : [mx, my];
      kind = 'PCA';
    }
    const L = Math.hypot(u[0], u[1]) || 1, s = ok.map((j) => (dx[j] * u[0] + dy[j] * u[1]) / L);
    const sg = s.reduce((q, x) => q + x, 0) < 0 ? -1 : 1;
    let lo = Infinity, hi = -Infinity;
    for (const x of s) { if (sg * x < lo) lo = sg * x; if (sg * x > hi) hi = sg * x; }
    ok.forEach((j, q) => { v[j] = hi - lo > 1e-12 ? (sg * s[q] - lo) / (hi - lo) : 0.5; });
    axes[Math.max(0, k)] = { kind, deg: Math.round((Math.atan2(-sg * u[1], sg * u[0]) * 180) / Math.PI) || 0 };
  }
  let min = Infinity, max = -Infinity;
  for (const y of v) if (y === y) { if (y < min) min = y; if (y > max) max = y; }
  if (min > max) min = max = 0;
  const span = max - min || 1;
  return { t: Float64Array.from(t), v, min, max, scaled: Float32Array.from(v, (y) => (y - min) / span), axes };
}
/** run.channels plus the relative channels among `ids` (rebuilt each time: the axis or aspect may have changed); a
 *  rel id whose groups are gone is dropped. ctx = {aspect, axis}. None among ids: null. */
export function relChannels(run, ids, ctx = {}) {
  const want = [...new Set(ids)].filter((id) => relParse(id));
  if (!want.length) return null;
  const out = { ...run.channels };
  for (const id of want) { const { a, b } = relParse(id), c = relChannel(run, a, b, ctx); if (c) out[id] = c; else delete out[id]; }
  return out;
}
/** 'rel:sem_penis:sem_hips' -> 'penis ↔ hips (seeded)'; else ''. */
export function relLabel(groups, id) {
  const r = relParse(id);
  return r ? `${partLabel(r.a.slice(4))} ↔ ${partLabel(r.b.slice(4))} (seeded)` : '';
}
/** Ready-made relative channels for the picker where both groups exist: the seeded penis ↔ the seeded hips. -> [rel id].
 *  ponytail: one hips group is seeded per scene, so "hips ↔ hips" is arm + click. */
export function relSuggestions(run) {
  const has = (k) => !!run?.channels?.[k + '_x'];
  return has('sem_penis') && has('sem_hips') ? [relId('sem_penis', 'sem_hips')] : [];
}

/** The sidecar's primary decision per run scene (track result notes, code 'primary', PROTOCOL v3.2):
 *  [{message, chosen?, rule?, candidates?, axis?, sign?, camera?, low_motion?, cadence_fill?, held_input?}] by
 *  scene_index (holes = no record). A note without data -> {message} only. */
export function decisionsOf(notes) {
  const out = [];
  for (const n of notes || []) if (n?.code === 'primary') out[n.scene_index ?? 0] = { ...(n.data || {}), message: n.message };
  return out;
}
/** One candidate's numbers as text (signals in frame heights, fh). */
export function candidateText(c) {
  if (!c) return '';
  return [c.std != null && `std ${c.std} fh`, c.travel != null && `travel ${c.travel} fh`, c.valid != null && `valid ${pct(c.valid)}`,
    c.cam_conf != null && `cam conf ${c.cam_conf}`, c.share != null && `share ${pct(c.share)}`, c.present != null && `present ${pct(c.present)}`].filter(Boolean).join(' · ');
}
/** The Why table: [{id, label, chosen, text}], the chosen one first, then the record's order; label = the candidate's
 *  group name in `groups` (sceneGroups), else ''. */
export function candidateRows(d, groups = {}) {
  const rows = Object.entries(d?.candidates || {}).map(([id, c]) => ({ id, label: labelOf(groups, id), chosen: id === d.chosen, text: candidateText(c) }));
  return [...rows.filter((r) => r.chosen), ...rows.filter((r) => !r.chosen)];
}
const sgn = (s) => (s > 0 ? '+1' : s < 0 ? '−1' : '?');
// ---- the scene's camera tag (timeline/acts.js camera category, from pawtrack camera.py) ----
const share = (c, t0, t1) => { let n = 0, k = 0; for (let j = 0; j < (c?.t?.length || 0); j++) if (c.t[j] >= t0 && c.t[j] < t1) { n++; if (c.v[j] === c.v[j]) k++; } return n ? k / n : 0; };
/** The signal a run defaults to in a scene [t0, t1) with camera tag `cam`, or null (leave the sidecar's pick): pan / zoom /
 *  handheld -> proj_cam (camera removed); orbit (turntable: a translational camera model is wrong there) -> the two
 *  characters' distance who_pair_proj when it covers half the scene, else the painted parts' fusion; reciprocal (the camera
 *  rides the stroke) and pov (a character's eyes: its motion is part of the action) -> proj (no removal). */
export const CAMERA_SIGNAL = { pan: 'proj_cam', zoom: 'proj_cam', handheld: 'proj_cam', reciprocal: 'proj', pov: 'proj', orbit: 'who_pair_proj / fused' };   // what cameraDefault picks (orbit: by the run's characters)
export function cameraDefault(cam, run, t0, t1) {
  const ch = run?.channels || {}, has = (c) => !!ch[c]?.t?.length;
  const pick = cam !== 'orbit' && CAMERA_SIGNAL[cam];
  if (pick) return has(pick) ? pick : null;
  if (cam !== 'orbit') return null;
  if (has('who_pair_proj') && share(ch.who_pair_proj, t0, t1) >= 0.5) return 'who_pair_proj';
  return canFuse(run) ? 'fused' : null;
}
/** paw-iasp: the signal a new run takes on a scene [t0, t1): 'fused' where two painted groups or more have data there (the
 *  fusion is measured at least as good as the old default on the owner's scripts: experiments/fusion), else the camera
 *  tag's (cameraDefault), else null. */
export function defaultSignal(cam, run, t0, t1) {
  const ch = run?.channels || {}, seen = (c) => { for (let i = 0; i < c.t.length; i++) if (c.t[i] >= t0 && c.t[i] < t1 && c.v[i] === c.v[i] && c.v[i] != null) return true; return false; };
  return fusionGroups(run).filter((g) => seen(ch[g.key + '_x'])).length >= 2 ? 'fused' : cameraDefault(cam, run, t0, t1);
}
/** The why panel's line for a camera tag ('' = none). */
export function cameraNote(cam) {
  return {
    static: 'camera tag: static',
    reciprocal: 'camera is reciprocal (rides the stroke): no camera removal; cam x / y are stroke candidates',
    pan: 'camera tag: pan — the default signal is proj_cam (camera removed)',
    zoom: 'camera tag: zoom — the default signal is proj_cam (camera removed)',
    handheld: 'camera tag: handheld — the default signal is proj_cam (camera removed)',
    orbit: 'turntable: camera removal off (default signal Bottom ↔ Top, else fused)',
    pov: 'camera tag: POV (a character\'s eyes) — no camera removal, the default signal is proj',
  }[cam] || '';
}
/** The one line for a scene's `input` record (sidecar v4.23, auto levels the tracker was fed): '' when the sidecar sent none. */
export function inputLine(inp) {
  if (!inp || typeof inp !== 'object') return '';
  if (inp.mode === 'off') return 'Tracker input: as decoded (levels off)';
  if (!inp.applied) return 'Tracker input: unchanged' + (inp.why && inp.why !== 'unchanged' ? ` (${inp.why})` : '');
  const sat = inp.saturation > 1 ? `, saturation ×${(+inp.saturation).toFixed(1)}` : '';
  const cap = inp.capped?.length ? ` · cap reached: ${inp.capped.join(', ')}` : '';
  return `Tracker input: levels ${inp.black}–${inp.white} → full range, gamma ${(+inp.gamma).toFixed(2).replace(/0$/, '')}${sat}${cap}`;
}
/** Sidecar v4.55: TAPNext++'s auto input size per run scene (note model_size), [scene index] = its line; none from an
 *  explicit 256 / 512 run or an older sidecar. */
export function modelLines(notes) {
  const out = [];
  for (const n of notes || []) if (n?.code === 'model_size' && n.message) out[n.scene_index ?? 0] = 'Model input: ' + n.message;
  return out;
}
/** The record's other decisions, one line each: axis, sign, camera, low motion, cadence fill, held input; cam = the
 *  scene's camera tag (its cameraNote first). */
export function decisionLines(d, cam = null) {
  const L = [], obj = (x) => x && typeof x === 'object';
  if (cameraNote(cam)) L.push(cameraNote(cam));
  if (d?.axis) L.push(`axis: ${d.axis.mode}${d.axis.deg != null ? ` ${d.axis.deg}°` : ''} (direction of rising value; 0° right, 90° up)`);
  const s = d?.sign;
  if (s) L.push(`sign: ${s.mode}${s.invert ? ', inverted' : ''} · applied ${sgn(s.applied)}`);
  const sd = d?.seed;   // v4.3: the frame the scene's points were laid on (tracked both ways from it)
  if (sd) L.push(`seed: ${sd.mode} at ${(sd.frame_ms / 1000).toFixed(1)} s (${sd.reason})`);
  if (d?.camera) L.push(`camera: conf ${d.camera.cam_conf ?? '–'} · moves ${d.camera.std ?? '–'} fh (std)`);
  const lm = d?.low_motion;
  if (lm) L.push(obj(lm) ? `low motion: ${lm.ptp_px} px peak-to-peak < ${lm.thr_px} px (probably noise)` : `low motion: ${lm}`);
  if (d?.cadence_fill) L.push(`cadence fill: ${d.cadence_fill.inserted} stroke${d.cadence_fill.inserted === 1 ? '' : 's'} inserted`);
  const h = d?.held_input;
  if (h) L.push(obj(h) ? `held input ${h.mode}: step ${h.step}, ratio ${h.ratio}, tracked ${h.tracked}/${h.frames} frames` : `held input: ${h}`);
  for (const l of segmentLines(d?.segments)) L.push(l);
  return L;
}
/** v4.9: the scene's soft-cut segments (PROTOCOL, the primary note's `segments`), one line each: 'segment 2 (4.0–10.1 s):
 *  pan → camera trend removed 38 px (camera path; strokes 0.12 → 0.91 of the range)'. */
export function segmentLines(segs) {
  if (!Array.isArray(segs)) return [];
  const s1 = (ms) => (ms / 1000).toFixed(1), how = { cam: 'camera path', trend: 'trend', 'cam+trend': 'camera path + trend' };
  return segs.map((g, i) => {
    const head = `segment ${i + 1} (${s1(g.t0)}–${s1(g.t1)} s): ${g.kind || 'no camera data'}`;
    if (!g.detrend) return head + (g.share_before != null ? ` · strokes ${g.share_before} of the range` : '');
    const amt = g.trend_px != null ? `${g.trend_px} px` : `${Math.round(100 * g.trend)} % of the scene range`;
    return `${head} → camera trend removed ${amt} (${how[g.detrend] || g.detrend}${g.why === 'camera travel' ? ', the tracker saw the camera travel' : ''}; strokes ${g.share_before} → ${g.share_after} of the range)`;
  });
}
const NORM = 'normalised 0..1 per scene';
/** How a primary is computed, one plain sentence (fixed strings; unknown id -> ''). */
export function primaryHow(id) {
  const p = /^p([0-3])_([xy])$/.exec(id || ''), s = /^sem_(penis|balls|hips)_proj$/.exec(id || ''), u = /^sem_([a-z0-9_]+?)_proj$/.exec(id || '');
  const w = /^who_(c[12]|x|pair|p1h2|p2h1)_proj$/.exec(id || '');
  if (s) return `the ${s[1]} points seeded from the tagger (CAM) on the seed frame: their centroid, camera removed, projected on the stroke axis, ${NORM}`;
  if (u) return `the ${partLabel(u[1])} group's pinned points: their centroid, camera removed, projected on the stroke axis, ${NORM}`;
  if (w) return WHOS.includes(w[1]) ? `${whoName(w[1])}'s center: the mean of all its pinned groups (anchored at the seed), camera removed, projected on the stroke axis, ${NORM}`
    : `${whoLabel(id)}: their distance along the stroke axis (larger = farther apart; camera moves cancel out), ${NORM}`;
  if (p) return `point ${+p[1] + 1}'s ${p[2]} position (${p[2] === 'y' ? 'image up' : 'image right'} = higher), ${NORM}`;
  if (id === 'fused') return `every tracked part combined (lib/fusion.js): each character's parts as one body, the relationships the scene's act names leading (rimming: Top head on Bottom hips, ...), the two bodies against each other (camera moves cancel), each weighed by how rhythmic, visible and in phase with the stroke it is (a lagging tail fades), ${NORM}`;
  return {
    proj: `visible points' mean position, projected on the stroke axis, ${NORM}`,
    proj_cam: `visible points' mean position, camera removed, projected on the stroke axis, ${NORM}`,
    dist01: `distance between the first two clicks, ${NORM}`,
    centroid_x: `visible points' mean x (image right = higher), ${NORM}`,
    centroid_y: `visible points' mean y (image up = higher), ${NORM}`,
    centroid_auto: `visible points' mean position along its own main direction of motion (up / right = higher), ${NORM}`,
    vis_frac: `share of the points that are visible, ${NORM}`,
    vis_extent: `share of the seed line the visible points still span, ${NORM}`,
    vis_len: `length of the visible points along their own axis, ${NORM}`,
  }[id] || '';
}

/** paw-9qm: one range override's channel for run scene i (lib/signal-source.js spanClean shape s over the shot's derive
 *  d0; src = the scene's own source): its source / against / camera as the shot's derive would make them, from the run
 *  before any derive (run0). null = the run cannot build it. */
function overrideChannel(run0, s, d0, src, i, ctx) {
  const dA = deriveClean({ ...(d0 || {}), ...(s.source ? { source: s.source } : {}), ...(s.against ? { against: s.against === 'camera' ? undefined : s.against } : {}), ...(s.cam ? { cam: s.cam } : {}), ...(s.fuse ? { fuse: s.fuse } : {}) });
  const dd = [];
  dd[i] = d0?.acts ? { ...(dA || {}), acts: d0.acts } : dA;   // paw-iasp: the override's fusion keeps the shot's act tags
  let nm = dA?.source && canSource(run0, dA.source, canFuse) ? dA.source : src;
  if (nm === 'primary') nm = decisionsOf(run0.notes)[i]?.chosen ?? run0.params?.primary ?? '';
  nm = resolveSource(run0, nm, dA?.against);
  if (nm === 'fused') return canFuse(run0) ? fusedChannel(fusionInput(run0, dd, ctx.aspect), { aspect: ctx.aspect, derives: dd, trackedAxis: trackedAxis(run0) }) : null;
  const q = relParse(nm);
  if (q) return relChannel(run0, q.a, q.b, { ...ctx, derives: dd });
  return (reprojects(dA) ? deriveChannels(run0, dd, ctx).channels[nm] : null) || run0.channels?.[nm] || null;
}

/**
 * Run patch for a channel pick, composed per run scene (sceneChannels): each scene's points come from the channel that
 * scene uses (pointsFromChannel with its fit), or the sidecar's own points (points0Primary) where it uses 'primary' or the
 * run's own params.primary. -> {channel (the run's default), points0Primary, points0, sceneChannels: [name per scene],
 * lane: {t, v} | null (the lane trace: each scene's channel, 0..1, NaN between scenes; null = the default drawing)}.
 * The run's direction (run.flips, run.orient, ctx.flips: polarity.js directionOf) is applied here, to the signal: points0
 * plays as it is (paw-vtec; callers only stitch it). + {flipSpans (the owner's stretches over the run), dir {whole, partial},
 * whys {at, why, by, cap}, depthUsed [{i, k, want, used, r, share}] | null (paw-6t7d)}.
 */
const NO_POINTS = { at: [], pos: [] };
/** paw-o60v.2: ctx.live (a fusion drag between rests): the trace only (the lane, the channels and the fusion record);
 *  the points (strokes step, Detail, HOW) are not made: the caller keeps the run's points until the rest composes them. */
export function channelPatch(run, channel, opts = {}, links = [], ctx = {}) {
  const dv = ctx.derives || [], spans = ctx.spans || [], stored0 = run;   // stored0: the run as tracked (the shaft's rail reads it, as the position bar does)
  // paw-9qm: a shot's own source (derive.source, lib/signal-source.js) is built like a linked channel
  const srcs = [...dv, dv[-1]].map((d) => d?.source).filter(Boolean);
  const rel = relChannels(run, [channel, ...links.filter((l) => l.run === run.id).map((l) => l.channel), ...srcs], ctx);
  if (rel) run = { ...run, channels: rel };
  const extra = rel ? { channels: rel } : {}, stored = run.channels;   // (fused below adds to it; derived channels never do)
  // paw-2lp7.1: positioning ranges (ctx.mask [[t0, t1]], regions.js withPositioning) are gaps in everything composed below:
  // no range, level, size, weight or depth is calibrated on the move into position, and no point comes out there (the
  // tracking store eases the script over it). The stored channels and what is handed back stay as tracked
  const mask = ctx.mask?.length ? ctx.mask : null, pure = run;
  if (mask) run = maskRun(run, mask);
  // paw-rnv1: characters drawn on twos / threes, retimed per character from their own tracks (lib/held.js; the shot's
  // derive.held switches it); every channel composed below reads the retimed parts, the stored ones stay as tracked
  const unheld = run, held = heldRun(run, dv, ctx.aspect);
  if (held) run = held.run;
  // paw-ef73.5: the loops whose passes are averaged (lib/loop-average.js): every channel composed from the averaged copy;
  // the stored channels keep the raw passes
  const raw = run;
  if (ctx.loopAvg) run = averagedRun(run, ctx.loopAvg);
  const looped = run !== raw;
  // paw-imsi: the detected exact loops (an automatic loop's span: where its pictures repeat): turns there sit on frames
  const exact = (ctx.loopAvg?.loops ?? ctx.exactLoops ?? []).filter((l) => l?.auto && l.auto.end > l.auto.t0).map((l) => [l.auto.t0, l.auto.end]);
  // paw-vtec: the run's direction (polarity.js directionOf: scene flips, Assist's spans, stretches) as one map, applied to
  // the signal below: whole = the scene's sign (pointsFromChannel; the sidecar's points mirrored), partial = flipChannel.
  // An averaged loop's stretches apply at the same phase in every pass (they share one signal)
  const dir = directionOf(run, ctx.flips), cuts = (run.scenes || []).slice(1).map((s) => s.start_ms);
  if (run !== raw && dir.partial.length) dir.partial = flipsClean(loopFlips(dir.partial, loopStates(raw, ctx.loopAvg.loops, ctx.loopAvg.ix, ctx.loopAvg.fm).filter((s) => s.on).map((s) => s.plan)), cuts);
  let flipped = [...dir.whole];
  const primaryRaw = run.points0Primary || run.points0;
  const run0 = run;   // before the derive: a range override re-derives from here (paw-9qm)
  // paw-a3n: run scenes with a shot `derive` (camera / axis set after tracking) recompute their projected channels from
  // the stored centres (lib/rederive.js); used for the points and the lane only, never written back over the stored ones
  const dOn = (i) => userReprojects(dv[i] ?? (i === 0 && !run.scenes?.length ? dv[-1] : null));
  if (dv.length || dv[-1]) { const d = deriveChannels(run, dv, ctx); if (d.changed.length) run = maskRun({ ...run, channels: d.channels }, mask); }
  // paw-e3i: 'fused' (lib/fusion.js) is built here from the stored group centres whenever the run or a link uses it,
  // like the rel: channels (handed back as one of the run's channels, rebuilt on every compose). paw-9qm: its inputs
  // follow a shot's camera override / against (signal-source.js fusionInput; none set: the stored centres as they are)
  const smartOn = dv.some((d) => d?.smart) || !!dv[-1]?.smart;
  const partsOn = [...new Set(srcs.map(partOf).filter(Boolean))];   // paw-4c48.19: the depth parts a shot plays ('part:<name>')
  const shaftOn = srcs.includes('shaft') || partsOn.length > 0;   // paw-4c48.10: its gaps are filled from fusion
  let fuseAgain = null, anchored = [], fFwd = null;
  const signsOf = (k, ms) => (run.scenes?.[k]?.sign ?? 1) * (dir.whole.has(k) ? -1 : 1) * (flippedAt(dir.partial, ms) ? -1 : 1);
  if ((smartOn || shaftOn || [channel, ...links.filter((l) => l.run === run.id).map((l) => l.channel), ...srcs].includes('fused')) && canFuse(run)) {
    // paw-o60v.2: ctx.live = a drag between rests; paw-zhn4: the exact loops' periods (the rows' rhythm at the stroke)
    // paw-wg2d / paw-ze8n: signs = each run scene's direction as its points will play it (the sidecar's scene sign x the owner's
    // whole-scene flip x a flipped stretch over the anchor), so the owner's anchors (pos 0 = fully in) are read the way the
    // script plays. With anchors the automatic (anchor-free) fused channel is kept too: the match below decides on it exactly
    // as without anchors, and the anchored one is redone if that flips an anchored scene
    const fin0 = fusionInput(run, dv, ctx.aspect), lp = ctx.loopAvg ? loopPeriods(raw, ctx.loopAvg) : null;
    fuseAgain = (ds, signs) => { let g = fusedChannel(fin0, { aspect: ctx.aspect, derives: ds, trackedAxis: trackedAxis(run), live: !!ctx.live, loops: lp, signs }); if (g && looped) g = averagedChannel(raw, g, ctx.loopAvg, ['v', 'timing']); return g; };
    anchored = [...dv.keys()].filter((k) => dv[k]?.anchors?.length);
    if (dv[-1]?.anchors?.length) anchored.push(-1);
    const strip = (d) => (d?.anchors ? { ...d, anchors: undefined } : d);
    // An owner clip, shot 47: fusion weighs its rows per window, windows that do not line up with an averaged loop made each pass
    // of the fused signal (and its timing series: Smart stroke's turn times) different again; averaged over the same passes
    // (fuseAgain). ponytail: the averaging softens an anchor's snap where the other passes have none
    const f = fuseAgain(dv, signsOf);
    if (anchored.length) fFwd = fuseAgain(Object.assign(dv.map(strip), dv[-1] ? { [-1]: strip(dv[-1]) } : {}), null);
    if (f) { run = { ...run, channels: { ...run.channels, fused: f } }; extra.channels = { ...(extra.channels || stored), fused: f }; }
  }
  // paw-4c48.10: 'shaft' (lib/shaft-source.js): the position bar's diamond as the signal, built whenever a shot picks it (never
  // handed back: its per run scene record is, as shaftSrc, for the chip); a run scene that cannot read it keeps its own channel
  const shaftCh = srcs.includes('shaft') ? shaftChannel(stored0, { derives: dv, aspect: ctx.aspect, fused: run.channels.fused }) : null;
  if (shaftCh?.t) run = { ...run, channels: { ...run.channels, shaft: shaftCh } };
  extra.shaftSrc = shaftCh ? shaftCh.info : null;
  // paw-4c48.19: each depth part a shot plays, its channel built the same way ('part:<name>'; its per run scene record in partSrc)
  const partCh = {};
  for (const nm of partsOn) {
    const c = shaftChannel(stored0, { derives: dv, aspect: ctx.aspect, fused: run.channels.fused, part: nm });
    partCh[nm] = c;
    if (c?.t) run = { ...run, channels: { ...run.channels, ['part:' + nm]: c } };
  }
  extra.partSrc = partsOn.length ? Object.fromEntries(partsOn.map((nm) => [nm, partCh[nm]?.info || null])) : null;
  /** a rel: channel the run does not have yet (a source measured against a part): built and handed back */
  /** the sidecar's processed signal as a channel: in the sidecar's direction already (signed: its scene sign is not applied again) */
  const withSamples = () => { if (!run.channels.__samples) run = { ...run, channels: { ...run.channels, __samples: { ...channelOf(Array.from(run.samples.t, (x, j) => [x, run.samples.v[j]])), signed: true } } }; };
  const ensure = (name) => {
    const q = relParse(name);
    if (!q || run.channels[name]) return;
    const c = relChannel(run, q.a, q.b, ctx);
    // (handed back as tracked: a later compose reuses it, with the retime on or off)
    if (c) { run = { ...run, channels: { ...run.channels, [name]: c } }; extra.channels = { ...(extra.channels || stored), [name]: held || mask ? relChannel(pure, q.a, q.b, ctx) || c : c }; }
  };
  // the sidecar's points (its signal's result: no signal to re-run) in the scene's direction (paw-vtec): mirrored where the
  // scene is flipped, BEFORE the Detail dresses them (points0Primary stays the sidecar's)
  const scAt = (t) => Math.max(0, sceneAt(run.scenes || [], t));
  let primary = !flipped.length ? primaryRaw : { at: primaryRaw.at, pos: Float64Array.from(primaryRaw.pos, (x, j) => (dir.whole.has(scAt(primaryRaw.at[j])) ? 100 - x : x)) };
  const r = { ...run, channel };
  const chosen = decisionsOf(run.notes);
  const dAt = (i) => dv[i] ?? (i === 0 && !run.scenes?.length ? dv[-1] : null) ?? null;
  const pickOf = (i) => (chosen[i]?.chosen ?? run.params?.primary ?? 'primary');
  // paw-9qm: per run scene, the shot's source (when the run can build it) wins over the link; against a part, a single
  // part becomes the pair part:against (resolveSource)
  const base = sceneChannels(r, links, opts).map((p, i) => {
    const d = dAt(i), pt = partOf(d?.source), pick = d?.source === 'shaft' ? (shaftCh?.info?.[i]?.ok ? 'shaft' : null) : pt ? (partCh[pt]?.info?.[i]?.ok ? d.source : null) : d?.source && canSource(run, d.source, canFuse) ? d.source : null;
    const src = pick || (d?.smart && run.channels.fused ? 'fused' : p.channel);
    const nm = d?.against ? resolveSource(run, src === 'primary' ? pickOf(i) : src, d.against) : src;
    if (nm !== src) ensure(nm);
    const c = nm !== src && run.channels[nm] ? nm : src;
    return c === p.channel ? { ...p, src, home: p.channel } : { ...p, channel: c, source: true, src, home: p.channel };
  });
  const names = base.map((p) => p.channel);
  // paw-d323: undrift on for a raw channel (its drift eats the depth range), off for the fused one (its held level is the
  // depth); the shot's own strokes.undrift wins
  const stOpts = (d, c) => ({ undrift: c !== 'fused', ...(d.strokes || {}), ...(d.detail && !ctx.live ? { shapes: d.detail } : {}) });   // paw-izk: + the Detail over its time (paw-o60v.2: not during a drag between rests)
  const pf = ctx.picAt ? { picAt: ctx.picAt } : {};   // paw-w7wr: a loop's passes get one layout (stroke-shape.js PICTURES)
  const per = base.map((p, i) => {   // a re-derived scene on the sidecar's pick: that pick's channel, recomputed
    const d = dAt(i), sm = !!d?.smart && !!run.channels?.fused, st = sm || !!d?.strokes;
    // paw-e3i: Smart stroke = the fused signal through the new strokes step; strokes alone = the shot's signal through it
    const cal = d?.shaft ? { calib: d.shaft } : {};   // paw-azd: the owner's fully-out / hilted marks for the shaft depth
    if (sm) { const c = p.source && run.channels[p.channel] ? p.channel : 'fused'; return { ...p, channel: c, derived: true, fit: { ...p.fit, ...cal, ...pf, strokes: stOpts(d, c) } }; }
    if (!dOn(i) && !st) return p.source ? { ...p, derived: true } : p;
    // strokes alone on the sidecar's pick: the sidecar's own processed signal (samples), so the new step starts where its
    // pipeline did (camera trend removed); a camera / axis change re-derives the pick's channel instead
    if (st && !dOn(i) && (p.channel === 'primary' || p.channel === run.params?.primary) && run.samples?.t?.length) {
      withSamples();
      return { ...p, channel: '__samples', derived: true, fit: { ...p.fit, ...cal, ...pf, strokes: stOpts(d, '__samples') } };
    }
    const c = p.channel === 'primary' || p.channel === run.params?.primary ? (p.channel === 'primary' ? chosen[i]?.chosen ?? run.params?.primary : p.channel) : p.channel;
    if (!run.channels?.[c]) return p;
    return { ...p, channel: c, derived: dOn(i) || st || c !== p.channel, ...(st ? { fit: { ...p.fit, ...cal, ...pf, strokes: stOpts(d, c) } } : {}) };
  });
  // scene i = [its start, the next scene's start) as sceneAt has it (the first from -inf, the last to +inf)
  const sc = run.scenes?.length ? run.scenes : null, lo = (i) => (i && sc ? sc[i].start_ms : -Infinity), hi = (i) => (sc && i + 1 < sc.length ? sc[i + 1].start_ms : Infinity);
  // paw-9qm: range overrides (ctx.spans, lib/signal-source.js): the run scene's signal with each override's own source /
  // against / camera spliced in over its span (cross-faded at its ends: no jump), as one channel of its own
  // a scene on the sidecar's own points keeps them outside its overrides (only = the override windows, their cross-fades
  // included): inside, the points come from the sidecar's processed signal (samples, what its points were made from) with
  // the override spliced in
  // a channel of the run's own makes its points here; the sidecar's primary too when the scene takes its carrier out
  const own = (p) => p.channel !== 'primary' && !!run.channels?.[p.channel] && (p.channel !== run.params?.primary || carrierOn(p.link) || !!p.derived);
  const r0 = run.range ? [run.range.start, run.range.end] : [-Infinity, Infinity];
  // paw-s80k: a shot playing a signal of its own (Smart stroke's fused, the source chip, a camera / axis re-derive) plays
  // the same way up as its scene's own channel (the link / the run's default; the sidecar's signal for 'primary', as
  // tracked): the new signal against that one over the run scene, both as their scene sign plays them; r <= -MATCH_R =
  // flipped to match (one more whole-scene flip, so the owner's flips still flip what he sees). A relative alignment of two
  // signals of the same shot (as a range override's splice does), never a direction of its own: |r| under MATCH_R keeps
  // the signal's own orientation (match[i].weak, said on the direction strip). Only on derives written since (d.match:
  // a shot flipped against the old orientation keeps looking as it did). -> extra.match [{ref, r, flip, weak}] per run scene
  const match = [], sgOf = (name, c, i) => (name.startsWith('rel:') || c?.signed ? 1 : run.scenes?.[i]?.sign ?? 1);
  per.forEach((p, i) => {
    const h = p.home, prim = h === 'primary' || h === run.params?.primary;
    if (isShaftSource(p.channel)) return;   // paw-4c48.10: the shaft (a depth part too) has a direction of its own (pos 0 = hilted): never matched
    if (!dAt(i)?.match || !own(p) || h == null || (!dOn(i) && (p.channel === h || (prim && p.channel === '__samples')))) return;
    const ref = prim ? (run0.samples?.t?.length ? { t: run0.samples.t, v: run0.samples.v, signed: true } : run0.channels[pickOf(i)]) : run0.channels[h] || run.channels[h];
    const c = p.channel === 'fused' && fFwd ? fFwd : run.channels[p.channel];   // paw-ze8n: decided on the anchor-free signal, as without anchors
    if (!ref?.t?.length || !c?.t?.length) return;
    const R = corrOver(c, ref, Math.max(lo(i), r0[0]), Math.min(hi(i), r0[1])) * sgOf(p.channel, c, i) * sgOf(prim ? '' : h, ref, i);
    match[i] = { ref: prim ? 'primary' : h, r: Math.round(R * 100) / 100, flip: R <= -MATCH_R, weak: !(Math.abs(R) >= MATCH_R) };
    if (match[i].flip && !dir.whole.delete(i)) dir.whole.add(i);
  });
  // paw-4c48.10: picking Shaft cleared the shot's earlier flip (derive.unflip, set by the pick: the run scene was flipped then);
  // F after the pick flips the run scene again (unflip xor the run's flips); another source ignores it
  per.forEach((p, i) => { if (isShaftSource(base[i].channel) && dAt(i)?.unflip && !dir.whole.delete(i)) dir.whole.add(i); });
  // paw-ze8n: a match flip of an anchored scene: its anchors are read the way it now plays (the fused channel redone with them)
  if (anchored.some((k) => match[Math.max(0, k)]?.flip)) {
    const f = fuseAgain(dv, signsOf);
    if (f) { run = { ...run, channels: { ...run.channels, fused: f } }; extra.channels = { ...(extra.channels || stored), fused: f }; }
  }
  flipped = [...dir.whole];
  extra.match = match.length ? match : null;
  const fuseSpans = [];   // paw-439e: a fused override's own fusion record {t0, t1, info} (the panel and the pad inside it read it)
  if (spans.length) per.forEach((p, i) => {
    const a = lo(i), b = hi(i), mine = spans.filter((s) => s.t1 > Math.max(a, r0[0]) && s.t0 < Math.min(b, r0[1]));
    if (!mine.length) return;
    const sidecar = !own(p);
    let bn = sidecar ? '__samples' : p.channel;
    if (sidecar && !run.samples?.t?.length) bn = pickOf(i);
    else if (sidecar) withSamples();
    if (!run.channels[bn]) return;
    const ovs = mine.map((s) => ({ t0: s.t0, t1: s.t1, ch: s.ch ?? overrideChannel(run0, s, dAt(i), base[i].src === 'primary' ? pickOf(i) : base[i].src, i, ctx) })).filter((o) => o.ch);   // s.ch: a modifier's measure (paw-ef73.26)
    for (const o of ovs) if (o.ch.info && (o.t0 + o.t1) / 2 >= a && (o.t0 + o.t1) / 2 < b) fuseSpans.push({ t0: o.t0, t1: o.t1, info: o.ch.info[i] ?? o.ch.info[0] ?? null });
    if (!ovs.length) return;
    const name = (bn.startsWith('rel:') ? 'rel:' : '') + `__sig${i}`;   // a rel: base keeps its own sign rule (pointsFromChannel)
    run = { ...run, channels: { ...run.channels, [name]: { ...splice(run.channels[bn], ovs, { lo: a, hi: b }), ...(run.channels[bn].signed ? { signed: true } : {}), ...(run.channels[bn].absolute ? { absolute: true } : {}) } } };
    per[i] = { ...p, channel: name, derived: true, ...(sidecar ? { only: ovs.map((o) => [o.t0 - BLEND_MS, o.t1 + BLEND_MS]) } : {}) };
  });
  extra.fuseSpans = fuseSpans.length ? fuseSpans : null;
  // paw-57ve: polarity stretches (the direction map's partial part, lib/polarity.js): the scene's signal (overrides spliced
  // in) mirrored inside each, the joins continuous; everything after (extremes, strokes, Detail, the lane) reads the flipped
  // signal. A scene on the sidecar's points keeps them outside the stretches, as around an override (only)
  const flipSpans = flipsIn(ctx.flips, r0[0], r0[1]);   // the owner's stretches over the run, as the strip edits them
  if (dir.partial.length) per.forEach((p, i) => {
    const mine = flipsIn(dir.partial, Math.max(lo(i), r0[0]), Math.min(hi(i), r0[1]));
    if (!mine.length) return;
    const sidecar = !own(p);
    let bn = sidecar ? '__samples' : p.channel;
    if (sidecar && !run.samples?.t?.length) bn = pickOf(i);
    else if (sidecar) withSamples();
    // a restored run on the sidecar's points has no signal to flip there: its points mirrored inside instead (never dropped)
    if (!run.channels[bn]) { if (sidecar) primary = { at: primary.at, pos: Float64Array.from(primary.pos, (x, j) => (mine.some(([u, v]) => primary.at[j] >= u && primary.at[j] < v) ? 100 - x : x)) }; return; }
    const name = (bn.startsWith('rel:') ? 'rel:' : '') + `__pol${i}`, win = mine.map(([u, v]) => [u - BLEND_MS, v + BLEND_MS]);
    run = { ...run, channels: { ...run.channels, [name]: flipChannel(run.channels[bn], mine, { lo: lo(i), hi: hi(i) }) } };
    per[i] = { ...p, channel: name, derived: true, ...(sidecar ? { only: win } : p.only ? { only: [...p.only, ...win] } : {}) };
  });
  extra.flipSpans = flipSpans.length ? flipSpans : null;
  extra.dir = { whole: flipped, partial: dir.partial };   // what was applied (polarity.js signAt reads it)
  // paw-otoh: the Detail on a scene whose points are not the strokes step's (the sidecar's, the classic fit's): their turns
  // stay exactly, the midpoints / holds come from the signal they were made from (stroke-shape.js dressPoints). It used
  // to switch the shot to the strokes step instead, which re-made every turn: changing the Detail changed the strokes.
  // (the signal as the scene plays, sg: dressPoints maps each half of it onto its two turns, a half running the other way
  // stays plain; paw-vtec: the sidecar's sign and the owner's flip of a raw channel)
  const dress = (q, i, sig, sg = 1) => {
    const d = dAt(i);
    if (!d?.detail || q.length < 3 || !sig?.t?.length || ctx.live) return q;   // paw-o60v.2: a drag between rests plays the points undressed
    if (sg < 0) sig = { ...sig, v: Float32Array.from(sig.v, (x) => -x) };
    const t0 = q[0][0] - 1000, t1 = q[q.length - 1][0] + 1000, a = lowerBound(sig.t, t0), b = lowerBound(sig.t, t1);
    const st = sig.t.subarray ? sig.t.subarray(a, b) : sig.t.slice(a, b), sv = sig.v.subarray ? sig.v.subarray(a, b) : sig.v.slice(a, b);
    const r = dressPoints(q.map(([x, y]) => ({ at: x, pos: y })), st, sv, shapeAt({ shapes: d.detail }), { minIntervalMs: STROKES.minIntervalMs, maxSpeed: STROKES.maxSpeed, how: sig.how, pic: ctx.picAt ? Array.from(st, ctx.picAt) : undefined });
    return r ? r.map((x) => [x.at, x.pos, x.why, x.by]) : q;
  };
  const inScene = (s, i) => { const q = []; for (let j = 0; j < s.at.length; j++) if (s.at[j] >= lo(i) && s.at[j] < hi(i)) q.push([s.at[j], s.pos[j], s.why?.[j], s.by?.[j], s.cap?.[j]]); return q; };
  extra.pinned = null;   // paw-2ntn: [run scene] = its anchor where one was applied (stitchPoints leaves their level alone)
  if (!per.some(own)) {
    const q = per.flatMap((_, i) => dress(inScene(primary, i), i, run.samples, dir.whole.has(i) ? -1 : 1));
    // paw-2lp7.1: the sidecar's own points keep its normalisation (made in the sidecar, over the whole run); only the points
    // inside a positioning range go
    if (!q.some((x) => x[2])) return { ...extra, channel, points0Primary: primaryRaw, points0: cutPoints(primary, mask), sceneChannels: names, lane: null, whys: null, low: null };
    const w = q.filter((x) => x[2]);
    return { ...extra, channel, points0Primary: primaryRaw, points0: cutPoints({ at: Float64Array.from(q, (x) => x[0]), pos: Float64Array.from(q, (x) => x[1]) }, mask), sceneChannels: names, lane: null, whys: { at: w.map((x) => x[0]), why: w.map((x) => x[2]), by: w.map((x) => x[3] || '') }, low: null };
  }
  const src = new Map(), at = [], pos = [], lt = [], lv = [], whyAt = [], why = [], whyBy = [], whyCap = [], low = [], depthUsed = [], pinned = [];
  per.forEach((p, i) => {
    const mine = own(p), cr = mine && carrierOn(p.link);   // a scene with a carrier is composed alone
    const key = !mine ? 'primary' : p.channel + JSON.stringify(p.fit) + (cr ? i + JSON.stringify([p.link.baseline, p.link.envelope]) : '');
    if (!src.has(key)) src.set(key, !mine ? primary : ctx.live ? NO_POINTS : pointsFromChannel(run, p.channel, { ...(exact.length ? { exact } : {}), ...(cr ? { ...p.fit, baseline: p.link.baseline, envelope: p.link.envelope, only: i } : p.fit), ...(flipped.length ? { flipped } : {}), ...(ctx.aspect ? { aspect: ctx.aspect } : {}), ...(mask ? { mask } : {}) }));
    const s = src.get(key), a = lo(i), b = hi(i), inOnly = (x) => !p.only || p.only.some(([u, v]) => x >= u && x < v);
    let q;
    if (p.only) {   // paw-9qm: the sidecar's points outside the overrides, the spliced signal's inside
      q = [];
      for (let j = 0; j < s.at.length; j++) if (s.at[j] >= a && s.at[j] < b && inOnly(s.at[j])) q.push([s.at[j], s.pos[j], s.why?.[j], s.by?.[j], s.cap?.[j]]);
      for (let j = 0; j < primary.at.length; j++) if (primary.at[j] >= a && primary.at[j] < b && !inOnly(primary.at[j])) q.push([primary.at[j], primary.pos[j]]);
      q.sort((u, v) => u[0] - v[0]);
    } else q = inScene(s, i);
    // paw-2ntn: the shot's anchor (derive.anchorTo 'in' / 'out'): every stroke's deep / out end pinned, its size kept. Never where
    // the depth is measured (an absolute channel: the shaft; a seated level; the shaft's depth): that already says where they sit
    const an = mine ? dAt(i)?.anchorTo : null, cm = mine ? run.channels[p.channel] : null;
    if ((an === 'in' || an === 'out') && !cm.absolute && !cm.depth?.[i]?.used && !(s.depthUsed || []).some((d) => Math.max(0, d.k) === i && d.used === 'shaft')) { q = anchorStrokes(q, an); pinned[i] = an; }
    const sg =(mine && !p.channel.startsWith('rel:') && !run.channels[p.channel].signed ? run.scenes?.[i]?.sign ?? 1 : 1) * (dir.whole.has(i) ? -1 : 1);
    if (!s.why) q = dress(q, i, mine ? run.channels[p.channel] : run.samples, sg);   // not the strokes step's: the Detail on its turns
    for (const [x, y, wy, by, cp] of q) { at.push(x); pos.push(y); if (wy) { whyAt.push(x); why.push(wy); whyBy.push(by || ''); whyCap.push(cp ? 1 : 0); } }
    for (const l of s.low || []) if (l.t1 > a && l.t0 < b) low.push({ t0: Math.max(a, l.t0), t1: Math.min(b, l.t1) });
    for (const d of s.depthUsed || []) if (Math.max(0, d.k) === i) depthUsed.push({ ...d, i });   // paw-6t7d: the depth a shaft scene really used
    const ch = mine ? run.channels[p.channel] : null, t = ch ? ch.t : run.samples?.t || [], v = ch ? (ch.absolute ? ch.v : ch.scaled) : run.samples?.v || [];   // an absolute channel draws as it reads (pos / 100)
    const j0 = lt.length;
    for (let j = 0; j < t.length; j++) if (t[j] >= a && t[j] < b) { lt.push(t[j]); lv.push(v[j]); }
    if (dir.whole.has(i)) {   // paw-vtec: a flipped scene's trace is its signal flipped (mirrored about its range there, as a stretch's is)
      let L = Infinity, H = -Infinity;
      for (let j = j0; j < lv.length; j++) if (lv[j] === lv[j]) { L = Math.min(L, lv[j]); H = Math.max(H, lv[j]); }
      for (let j = j0; j < lv.length; j++) lv[j] = ch?.absolute ? 1 - lv[j] : L + H - lv[j];   // (absolute: as its points flip, 100 - pos)
    }
    if (lt.length) { lt.push(lt[lt.length - 1]); lv.push(NaN); }   // a gap: scenes never join across a channel change
  });
  return { ...extra, channel, points0Primary: primaryRaw, points0: cutPoints({ at: Float64Array.from(at), pos: Float64Array.from(pos) }, mask), sceneChannels: names,
    lane: { t: Float64Array.from(lt), v: Float32Array.from(lv) }, whys: whyAt.length ? { at: whyAt, why, by: whyBy, cap: whyCap } : null, low: low.length ? low : null, depthUsed: depthUsed.length ? depthUsed : null, pinned: pinned.length ? pinned : null };
}

// ---- stitching: the composed scenes of a run meet without a level jump or a clipped stroke ----
const STITCH_WIN = 2000;   // ms of strokes either side of a cut that say where its level / size is
/** Level (mean of consecutive points' midpoints = a one-knot baseline) and size (mean |step|) of points [{at, pos}]. */
function levelOf(pts) {
  if (!pts.length) return null;
  if (pts.length < 2) return { level: pts[0].pos, amp: 0 };
  let l = 0, a = 0;
  for (let k = 1; k < pts.length; k++) { l += (pts[k].pos + pts[k - 1].pos) / 2; a += Math.abs(pts[k].pos - pts[k - 1].pos); }
  return { level: l / (pts.length - 1), amp: a / (pts.length - 1) };
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
/** Which run scene scene i carries its level from: the one before it in the same document scene (shot) or in another
 *  shot of the same scene (join), or in the document
 *  scene right before a continuing one with no cutaway between (a camera split: same shot), else the action part
 *  before it (lib/scenes-continue.js continuations: the action scene, its internal-view members, the continuing scene;
 *  cutaways skipped); -1 = a real cut. d[i] = the document scene of run scene i (-1: none); doc = the document scenes. */
function carryFrom(i, d, cont, doc = []) {
  if (i < 1 || d[i] < 0) return -1;
  if (d[i - 1] === d[i]) return i - 1;
  for (const cs of cont) {
    const parts = [cs.a, ...cs.internal, cs.c], k = parts.indexOf(d[i]);
    if (k > 0) { for (let j = i - 1; j >= 0; j--) if (d[j] === parts[k - 1]) return j; return -1; }
  }
  if (d[i - 1] === d[i] - 1 && doc[d[i]]?.continues) return i - 1;   // a camera split: the same shot
  // shots of one scene (timeline/shots.js join): the level carries across every cut inside it, resets at the scene's edge
  if (d[i - 1] >= 0 && d[i - 1] < d[i]) { for (let k = d[i - 1] + 1; k <= d[i]; k++) if (doc[k]?.join !== true) return -1; return i - 1; }
  return -1;
}

/**
 * The points of a composed run (oriented: flips / span orientations applied) stitched at its run scenes' cuts, pure.
 * fit = the run-level channel fit (stitch 'smart' | 'off', minGapMs); links = scene links (envelope flags); ctx =
 * {scenes: the document scenes as drawn (continues, kinds, views), internal: s => bool, clean: join cleanup options (core/script.js
 * cleanJoins, settings cleanMicroOpts; absent / null = off)}. Per cut, left to right:
 *  1. level: where the action continues (carryFrom) the scene is moved so its level over its first 2 s is the level the
 *     scene it carries from ended on; with an envelope on both, its stroke size too; squeezed about that level to stay
 *     in 0..100. A real cut keeps both centres.
 *  2. phase: the cut's own data-end points (within 1.5 frames of the cut) go; then, between the last point before and
 *     the first after: two turns the same way closer than 1.5 half-strokes merge into the more extreme one, farther
 *     apart get the missing opposite turn between them (the partial stroke completed); opposite turns closer than half
 *     an incoming half-stroke or the min gap drop the incoming one. The join is then one stroke-long move, never a jump.
 *  3. with ctx.clean, micro glitches within its blendMs of each join go (cleanMicro).
 * -> {points: {at, pos}, stitches: [{t0, p0, t1, p1, carry}]} (the joins, for the lane).
 */
export function stitchPoints(points, run, links = [], fit = {}, ctx = {}) {
  const o = { ...CHANNEL_FIT, ...fit }, sc = run.scenes || [];
  if (o.stitch === 'off' || sc.length < 2 || !points.at.length) return { points, stitches: [] };
  const lo = (i) => (i ? sc[i].start_ms : -Infinity), hi = (i) => (i + 1 < sc.length ? sc[i + 1].start_ms : Infinity);
  const parts = sc.map((_, i) => { const out = []; for (let j = 0; j < points.at.length; j++) if (points.at[j] >= lo(i) && points.at[j] < hi(i)) out.push({ at: points.at[j], pos: points.pos[j] }); return out; });
  const ch = Object.values(run.channels || {}).find((c) => c.t?.length > 1), frame = ch ? (ch.t[ch.t.length - 1] - ch.t[0]) / (ch.t.length - 1) : 1000 / 30;
  const doc = ctx.scenes || [], d = sc.map((s) => { const m = (s.start_ms + s.end_ms) / 2, k = sceneAt(doc, m); return k >= 0 && doc[k].start_ms <= m && doc[k].end_ms > m ? k : -1; });
  const cont = doc.length ? continuations(doc, ctx.internal ? { internal: ctx.internal } : undefined) : [];
  const env = run.range ? sceneChannels(run, links, fit).map((p) => p.link?.envelope?.mode === 'auto') : [];
  const minGap = o.minGapMs, stitches = [];
  const halfStroke = (pts) => { const iv = []; for (let k = 1; k < Math.min(pts.length, 6); k++) iv.push(Math.abs(pts[k].at - pts[k - 1].at)); return iv.length ? median(iv) : NaN; };
  const kindEnd = (L) => (L.length < 2 ? 0 : Math.sign(L[L.length - 1].pos - L[L.length - 2].pos));   // +1 = a top
  const kindStart = (R) => (R.length < 2 ? 0 : Math.sign(R[0].pos - R[1].pos));
  /** A scene's point on the frame at the cut (side = its points, last: the end before the cut, else the start after) is
   *  the data's end, not a turn, unless it reaches the scene's turns of its kind there (within a quarter stroke). */
  const isEnd = (side, last) => {
    if (side.length < 3) return false;
    const e = last ? side[side.length - 1] : side[0], nb = last ? side[side.length - 2] : side[1], kind = Math.sign(e.pos - nb.pos);
    const win = last ? side.slice(-8, -1) : side.slice(1, 8), turns = [];
    for (let k = 1; k + 1 < win.length; k++) if (Math.sign(win[k].pos - win[k - 1].pos) === kind && Math.sign(win[k].pos - win[k + 1].pos) === kind) turns.push(win[k].pos);
    if (!kind || !turns.length) return true;
    const amp = levelOf(win).amp || 1;
    return kind * (e.pos - median(turns)) < -0.25 * amp;
  };
  for (let i = 1; i < sc.length; i++) {
    const R = parts[i], L = parts[i - 1], tc = sc[i].start_ms;
    // the data ends at the cut go first (they would skew the levels)
    if (L.length && tc - L[L.length - 1].at <= 1.5 * frame && isEnd(L, true)) L.pop();
    if (!R.length) continue;
    if (R[0].at - tc <= 1.5 * frame && isEnd(R, false)) R.shift();
    // 1. level carry
    const p = isShaftSource(run.sceneChannels?.[i]) || run.pinned?.[i] ? -1 : carryFrom(i, d, cont, doc), P = p >= 0 ? parts[p] : null;   // paw-4c48.10: the shaft's level is absolute (a depth part's too); paw-2ntn: an anchored scene's is its anchor's
    let carry = false;
    if (P?.length) {
      const end = levelOf(P.filter((q) => q.at >= P[P.length - 1].at - STITCH_WIN)), start = levelOf(R.filter((q) => q.at <= R[0].at + STITCH_WIN));
      const k = env[i] && env[p] && start.amp > 0 && end.amp > 0 ? Math.min(4, Math.max(0.25, end.amp / start.amp)) : 1;
      let moved = R.map((q) => end.level + k * (q.pos - start.level));
      const mx = Math.max(...moved), mn = Math.min(...moved);
      const f = Math.min(1, mx > 100 && mx > end.level ? (100 - end.level) / (mx - end.level) : 1, mn < 0 && mn < end.level ? end.level / (end.level - mn) : 1);
      moved = moved.map((v) => Math.round(Math.min(100, Math.max(0, end.level + f * (v - end.level)))));
      R.forEach((q, j) => { q.pos = moved[j]; });
      carry = true;
    }
    if (!L.length) continue;
    // 2. phase at the cut: the turns either side are made one clean stroke
    const H = halfStroke(R) || halfStroke(L.slice(-6)) || 400;
    for (let n = 0; n < 4 && L.length && R.length; n++) {
      const a = L[L.length - 1], b = R[0], gap = b.at - a.at, kA = kindEnd(L), kB = kindStart(R);
      if (kA && kB && kA === kB) {
        if (gap < 1.5 * H) { if (kA * (b.pos - a.pos) > 0 && R.length > 1) L.pop(); else if (R.length > 1) R.shift(); else L.pop(); continue; }
        const opp = (L.length > 1 ? L[L.length - 2].pos : a.pos) / 2 + (R.length > 1 ? R[1].pos : b.pos) / 2;
        R.unshift({ at: Math.round((a.at + b.at) / 2), pos: Math.round(opp) });
        break;
      }
      if (gap >= Math.max(minGap, 0.5 * H) || R.length < 2) break;
      R.shift();
    }
    if (L.length && R.length) stitches.push({ t0: L[L.length - 1].at, p0: L[L.length - 1].pos, t1: R[0].at, p1: R[0].pos, carry });
  }
  let out = [];
  for (const q of parts.flat()) if (!out.length || q.at > out[out.length - 1].at) out.push(q);
  // 3. the joins clean themselves: micro glitches (blips, back-steps, stalls) within blendMs of each stitch go
  if (ctx.clean && stitches.length) out = cleanJoins(out, stitches.map((st) => [st.t0, st.t1]), ctx.clean);
  return { points: { at: Float64Array.from(out, (q) => q.at), pos: Float64Array.from(out, (q) => q.pos) }, stitches };
}

// ---- a run's channel pick, kept on its ghost (ghost.source.keep) so it survives a reload ----
// Runs are session-only; their ghosts are saved in the .pawproj. keep = what rebuilding the run's points needs:
// {channel, channels: {name: [[t, v|null]]} (the picked / linked raw series, sidecar pair shape), points0Primary:
// [[at, pos]], scenes: [{start_ms, end_ms, sign?}], flips, orient, roi, fit}. ~2 numbers per frame per channel.
const pairs = (t, v) => Array.from(t, (x, i) => [x, v[i] === v[i] ? +(+v[i]).toPrecision(6) : null]);
const pts = (p = []) => ({ at: Float64Array.from(p, (x) => x[0]), pos: Float64Array.from(p, (x) => x[1]) });

/** run -> ghost.source.keep, with the raw series of `names` (channels the run has: its default and every linked one). */
export function keepOf(run, names, fit = {}) {
  const p = run.points0Primary || run.points0, src = [...new Set(names.flatMap((n) => (relParse(n) ? relSources(n) : n.startsWith('rel:') ? [] : [n])))];
  return {
    channel: run.channel,
    channels: Object.fromEntries(src.filter((n) => run.channels?.[n]).map((n) => [n, pairs(run.channels[n].t, run.channels[n].v)])),
    points0Primary: pairs(p.at, p.pos),
    scenes: (run.scenes || []).map((s, k) => { const deg = sceneDeg(run, k); return { start_ms: s.start_ms, end_ms: s.end_ms, ...(s.sign != null ? { sign: s.sign } : {}), ...(s.groups ? { groups: s.groups } : {}), ...(deg != null ? { axis_deg: deg } : {}) }; }),
    flips: run.flips || [], orient: run.orient || [], roi: run.roi ?? null, fit: { ...fit },
  };
}

/** A tracker ghost with source.keep -> a run record (makeRun's shape, restored: true; no frames, samples or events) whose
 *  points are the ghost's script and whose points0 recomposes from the kept channels and `links`; else null. */
export function runFromGhost(g, links = [], ctx = {}) {
  const s = g?.source, k = s?.keep;
  if (s?.kind !== 'tracker' || !k || !s.range) return null;
  const channels = Object.fromEntries(Object.entries(k.channels || {}).map(([n, v]) => [n, channelOf(v)]));
  const channel = k.channel === 'primary' || channels[k.channel] || relParse(k.channel) ? k.channel : 'primary';
  const run = {
    id: g.id, n: +(/^run(\d+)$/.exec(g.id)?.[1] || 0), color: g.color, visible: g.visible !== false, ref: false, restored: true,
    tracker: s.tracker, name: String(g.name || g.id).replace(/^#\d+\s*/, ''), params: s.params || {}, range: { start: s.range.t0, end: s.range.t1 },
    roi: k.roi ?? null, samples: series([]), scenes: k.scenes || [], flips: k.flips || [], orient: k.orient || [],
    channels, channel, points0Primary: pts(k.points0Primary), confidence: null, events: [], notes: [], frames: null,
    points: { at: Float64Array.from(g.script || [], (a) => a.at), pos: Float64Array.from(g.script || [], (a) => a.pos) },
    ...(s.tag ? { tag: s.tag } : {}),
  };
  const { points0, sceneChannels: names, lane, channels: rel, flipSpans } = channelPatch(run, channel, k.fit, links, ctx);
  return Object.assign(run, { points0, sceneChannels: names, lane, flipSpans, ...(rel ? { channels: rel } : {}) });
}
