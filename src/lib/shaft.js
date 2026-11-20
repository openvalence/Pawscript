// shaft.js -- a points run's shaft consumption channels (sidecar PROTOCOL v4.17, trackers/pawtrack/shaft.py): how much
// of the penis is inside, per frame. Pure (test/shaft.test.mjs; shaftState / the scorecard: test/shaft-state.test.mjs).
//   sem_<name>_in      inserted fraction 0..1 (1 = all in; NaN unknown), _in_conf 0..1, _len visible / full (larger = out),
//   _knot 0 out / 0.5 at the entrance / 1 in, _bx _by (base point) _ex _ey (entry edge) _w (width): the overlay
//   run.scenes[k].shaft = {<name>: {source 'sam' | 'points' | 'none', full 'seen' | 'relative', conf_share, ...}}
// Only SAM-measured groups (source 'sam') drive the direction and the depth: the points fallback is drawn, never used
// (on the owner's runs the tracker keeps the members "visible" while they slide over the partner).
// The owner's marks (a shot's derive.shaft {out, hilt}: ms, "fully out here" / "hilted here") re-map the visible length
// so the out frame reads 0 % in and the hilt frame 100 %.
import { sceneAt } from './runs.js';
import { lowerBound, frameStartOf } from './lane.js';
import { signalTurns } from './strokes.js';
import { partName } from './content.js';

export const CONF_MIN = 0.5;    // pawtrack/shaft.py CONF_MIN: a frame below it says nothing
// paw-4c48.17 (PROTOCOL v4.50): the sidecar's per-frame reason sem_<name>_why (runs before it: none, the app infers as before)
export const WHY = { SEEN: 0, LOW: 1, BOUND: 2, HIDDEN: 3, FEW: 4, LOST: 5, POINTS: 6 };
export const WHY_TEXT = { 1: 'SAM is unsure here', 2: 'SAM prompted from too few of the penis points: may read too short', 3: 'a hand / paw / tail at the entry', 4: 'fewer than 3 visible points (SAM not prompted)', 5: 'SAM found no mask (drift or lost)', 6: 'the points fallback (no SAM reading)' };
/** Is SAM's reading at sidecar reason code c no reading to trust (bound / hidden / few / lost)? NaN (no channel) = false. */
export const whyBad = (c) => c === WHY.BOUND || c === WHY.HIDDEN || c === WHY.FEW || c === WHY.LOST;
export const SHARE_MIN = 0.6;   // confident over this share of a run scene: the shaft is the default depth there
export const R_MIN = 0.3;       // |r| with the stroke signal needed for a direction

// paw-4c48.19 (PROTOCOL v4.52): the same pass on any part the owner turned on (a forearm, a tail, a toy): its channels are named
// like the penis's (sem_<name>_in ...), its scene records carry role 'part'. A part is never "the shaft" (shaftNames / shaftOf
// leave it out: every default stays as it was); it is read only when asked for by name: { part } on the functions below, the
// source 'part:<name>' (lib/shaft-source.js), the fusion depth 'part:<name>' (lib/depth-seat.js).
const measured = (run) => Object.keys(run?.channels || {}).filter((k) => /^sem_[a-z0-9_]+_in$/.test(k) && run.channels[k.slice(0, -3) + '_in_conf']).map((k) => k.slice(4, -3));
/** Is `name` a depth part of the run (its scene records say role 'part')? */
export const isPart = (run, name) => !!(run?.scenes || []).some((s) => s?.shaft?.[name]?.role === 'part');
/** The run's shaft groups (a sem_<name>_in channel, not a depth part) -> ['c1_penis', ...]. */
export const shaftNames = (run) => measured(run).filter((n) => !isPart(run, n));
/** paw-4c48.19: the run's depth parts (the shaft pass on a part the owner turned on) -> ['c2_forearm_r', ...]. */
export const partNames = (run) => measured(run).filter((n) => isPart(run, n));
/** A source / depth value for depth part `name` ('part:<name>'), and back (null: not a part's). */
export const PART_PREFIX = 'part:';
export const partSource = (name) => PART_PREFIX + name;
export const partOf = (src) => (typeof src === 'string' && src.startsWith(PART_PREFIX) ? src.slice(PART_PREFIX.length) : null);
/** The shaft source or a depth part's ('shaft' | 'part:<name>'). */
export const isShaftSource = (src) => src === 'shaft' || !!partOf(src);
/** A depth part's words: 'c2_forearm_r' -> 'forearm R' (who left out: the chip says it for a part of either character; paws -> feet with furry items off). */
export const partWord = (name) => String(name || '').replace(/^(c[12]|x)_/, '').replace(/^[a-z]+/, partName).replace(/_([lr])(\d*)$/, (_, s, d) => ` ${s.toUpperCase()}${d}`).replace(/_/g, ' ');

/** The value of channel c nearest time t (within 60 ms; channels share the frame times) or NaN. */
function at(c, t) {
  if (!c?.t?.length) return NaN;
  const i = lowerBound(c.t, t), j = i > 0 && (i >= c.t.length || t - c.t[i - 1] < c.t[i] - t) ? i - 1 : i;
  const v = c.v[j];
  return Math.abs(c.t[j] - t) <= 60 && v != null && v === v ? v : NaN;
}

/** Run scene k's shaft: its SAM-measured group with the most confident frames inside the scene -> {name, rec, share}
 *  | null. points: true = the points fallback counts too (the overlay draws it). paw-wzxu: with several penises measured
 *  (the owner paints both characters'), the one pointing into another character (its entry end nearer that character's
 *  anus / slit / hips / torso than its base) and whose visible length moves with the stroke wins; a penis pointing away from
 *  them never does; when that does not tell them apart, the most confident one as before. Roles are paw-85px. */
export function shaftOf(run, k, { points = false, aspect = 16 / 9, part = null } = {}) {
  const sc = run?.scenes?.[Math.max(0, k)], recs = sc?.shaft || {}, inSc = (t) => !sc || (t >= sc.start_ms && t < sc.end_ms);
  const cand = [];
  for (const name of part ? (partNames(run).includes(part) ? [part] : []) : shaftNames(run)) {   // paw-4c48.19: a part only by name
    const rec = recs[name];
    if (!rec || rec.source === 'none' || (rec.source !== 'sam' && !points)) continue;
    const cf = run.channels[`sem_${name}_in_conf`];
    let n = 0, ok = 0;
    for (let i = 0; i < cf.t.length; i++) if (inSc(cf.t[i])) { n++; if (cf.v[i] >= CONF_MIN) ok++; }
    cand.push({ name, rec, share: n ? ok / n : 0 });
  }
  let pool = cand;
  if (cand.length > 1) {
    for (const c of cand) Object.assign(c, aim(run, c.name, inSc, aspect));
    const top = Math.max(...cand.map((c) => c.swing)), good = cand.filter((c) => c.toward === true && c.swing >= 0.5 * top), away = cand.filter((c) => c.toward === false);
    if (good.length && good.length < cand.length) pool = good;
    else if (away.length && away.length < cand.length) pool = cand.filter((c) => c.toward !== false);
  }
  let best = null;
  for (const { name, rec, share } of pool) if (!best || share > best.share) best = { name, rec, share };
  return best;
}
/** Shaft group `name` in a scene: toward (its entry end nearer another character's receiving part than its base on most
 *  frames; null: not enough frames to tell) and swing (p90 - p10 of its confident visible length). */
function aim(run, name, inSc, aspect) {
  const C = run.channels, n0 = `sem_${name}_`, who = /^(c[12]|x)_/.exec(name)?.[1] || null;
  const rk = partKey(C, ['c1', 'c2', 'x'].filter((w) => w !== who), RECEIVE), len = lenOf(run, name, aspect), cf = C[n0 + 'in_conf'];
  const lens = [];
  if (len?.t?.length) for (let i = 0; i < len.t.length; i++) if (inSc(len.t[i]) && at(cf, len.t[i]) >= CONF_MIN && fin(len.v[i])) lens.push(len.v[i]);
  lens.sort((a, b) => a - b);
  const swing = lens.length >= 5 ? lens[Math.floor(0.9 * (lens.length - 1))] - lens[Math.floor(0.1 * (lens.length - 1))] : 0;
  const ex = C[n0 + 'ex'];
  if (!rk || !ex?.t?.length) return { toward: null, swing };
  let nIn = 0, n = 0;
  for (let i = 0; i < ex.t.length; i++) {
    const t = ex.t[i];
    if (!inSc(t)) continue;
    const cx = at(C.cam_x, t), cy = at(C.cam_y, t), X = at(C[rk + '_x'], t) + (cx === cx ? cx : 0), Y = at(C[rk + '_y'], t) + (cy === cy ? cy : 0);
    const e = [ex.v[i], at(C[n0 + 'ey'], t)], b = [at(C[n0 + 'bx'], t), at(C[n0 + 'by'], t)];
    if (![X, Y, ...e, ...b].every(fin)) continue;
    n++;
    if (Math.hypot(e[0] - X, e[1] - Y) < Math.hypot(b[0] - X, b[1] - Y)) nIn++;
  }
  return { toward: n >= 5 ? nIn > n / 2 : null, swing };
}

// ---- the depth scale (paw-4c48: the owner's "shaft depth is driven from the largest and smallest that agree with motion").
// A reading's length (larger = more of the shaft out) becomes depth through ITS OWN extremes over the run scene: "fully out" = the
// largest of its stroke tops that recurs, "hilted" = the smallest of its bottoms that recurs, counting only turns of the reading itself
// (smoothed: a one-frame spike is no turn; unsure / held frames are not read) and, when a motion signal is given, only those that
// fall at a turn of the right sense of the motion (its sense from their correlation): a maximum where the motion says in, a
// one-off, a collapsed stretch at the wrong phase do not set them. Too few such turns: its p10 / p90 ('spread'). The owner's
// "hilted" / "fully out" marks override each end. One function for the rail (the diamond, the Shaft source: both readings),
// the depth chip "shaft" (shaftDepth) and "in N %" (insertedAt). ----
export const SCALE = { MIN_TURNS: 2, R_MOTION: 0.2, REACH: 0.5, SPREAD: [0.1, 0.9] };
function corrOf(x, y) {
  let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { const u = x[i], v = y[i]; if (!(fin(u) && fin(v))) continue; n++; sx += u; sy += v; sxy += u * v; sxx += u * u; syy += v * v; }
  const vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n;
  return n >= 10 && vx > 1e-12 && vy > 1e-12 ? (sxy - (sx * sy) / n) / Math.sqrt(vx * vy) : NaN;
}
/**
 * x (a reading's length per sample on times t; ok(i) = read and sure there), motion ({t, v} | null), hilt / out (the marks as the
 * reading's own values, NaN = none) -> {a (hilted), b (fully out), from ('motion' | 'turns' | 'spread' | 'marks'), tops, bottoms}.
 */
export function depthScale(t, x, ok = () => true, { motion = null, hilt = NaN, out = NaN } = {}) {
  const n = t.length, v = Float64Array.from({ length: n }, (_, i) => (ok(i) && fin(x[i]) ? x[i] : NaN));
  const { y, turns } = signalTurns(t, v);
  let keep = turns, from = 'turns';
  if (motion?.t?.length && turns.length >= 2) {
    const m = Float64Array.from(t, (tt) => at(motion, tt)), r = corrOf(v, m);
    if (Math.abs(r) >= SCALE.R_MOTION) {
      const mt = signalTurns(t, m).turns, gaps = [];
      for (let q = 1; q < turns.length; q++) gaps.push(t[turns[q][0]] - t[turns[q - 1][0]]);
      const reach = Math.max(100, SCALE.REACH * median(gaps)), sg = Math.sign(r);
      keep = turns.filter(([i, kd]) => mt.some(([j, km]) => km === kd * sg && Math.abs(t[j] - t[i]) <= reach));
      from = 'motion';
    }
  }
  // each turn's value: the reading's own extreme within two samples of it (the smoothing shaves the turns)
  const ext = (i, kd) => { let e = NaN; for (let q = Math.max(0, i - 2); q <= Math.min(n - 1, i + 2); q++) if (fin(v[q]) && !(kd > 0 ? v[q] <= e : v[q] >= e)) e = v[q]; return fin(e) ? e : y[i]; };
  const tops = keep.filter(([, kd]) => kd > 0).map(([i, kd]) => ext(i, kd)), bots = keep.filter(([, kd]) => kd < 0).map(([i, kd]) => ext(i, kd));
  let a, b;
  // the largest / smallest that RECURS: the second most extreme turn (a one-off, however far, never sets the scale; the
  // deepest strokes keep their depth, which a median of the per-stroke extremes would flatten)
  const hiR = [...tops].sort((p, q) => q - p)[1], loR = [...bots].sort((p, q) => p - q)[1];
  if (tops.length >= SCALE.MIN_TURNS && bots.length >= SCALE.MIN_TURNS && hiR > loR) { a = loR; b = hiR; }
  else {
    const sv = Array.from(v).filter(fin).sort((p, q) => p - q);
    a = sv.length ? sv[Math.floor(SCALE.SPREAD[0] * (sv.length - 1))] : 0; b = sv.length ? sv[Math.floor(SCALE.SPREAD[1] * (sv.length - 1))] : 1; from = 'spread';
  }
  if (fin(hilt)) a = hilt;
  if (fin(out)) b = out;
  if (fin(hilt) && fin(out)) from = 'marks';
  [a, b] = settle(a, b, hilt, out);
  return { a, b, from, tops: tops.length, bottoms: bots.length };
}
/** A scale [a, b] that collapsed (b <= a) keeps the owner's mark. paw-kbou: "fully out here" alone on a frame the reading has
 *  at or below its own hilted end (the visible length at its smallest: the reading had it all in) set b there and the scale
 *  fell back to [0, 1], dropping the mark: the marked frame still read up to 100 % in. Now: everything from the mark up reads
 *  fully out. Hilted alone, no marks, or the two crossed: [hilt or 0, + 1] as before. */
function settle(a, b, hilt, out) {
  if (b - a > 1e-6) return [a, b];
  if (fin(out) && !fin(hilt)) return [out - 1, out];
  const lo = fin(hilt) ? hilt : 0;
  return [lo, lo + 1];
}
/** A slow camera zoom from a per-frame scale (G.sc): its moving median over ZOOM_MS (well below the stroke rate), 1 where unknown. */
const ZOOM_MS = 4000;
function slowZoom(T, sc) {
  const n = T.length, out = new Float64Array(n).fill(1);
  for (let i = 0, lo = 0, hi = 0; i < n; i++) {
    while (T[lo] < T[i] - ZOOM_MS / 2) lo++;
    while (hi + 1 < n && T[hi + 1] <= T[i] + ZOOM_MS / 2) hi++;
    const w = [];
    for (let q = lo; q <= hi; q++) if (sc[q] > 0) w.push(sc[q]);   // ponytail: O(n x window), fine for minutes-long scenes
    if (w.length) out[i] = median(w);
  }
  return out;
}
const scaleMemo = new WeakMap();
/** SAM's visible length's depth scale in run scene k ([a, b, from]: hilted, fully out), the owner's marks over it. */
function calibAB(run, name, calib, aspect, k = -1, motion = null) {
  if (k < 0) {   // no scene: the plain visible share with the owner's marks (the shaft strip: what it shows is the share itself)
    const len = lenOf(run, name, aspect), lo = fin(calib?.hilt) ? at(len, calib.hilt) : NaN, hi = fin(calib?.out) ? at(len, calib.out) : NaN;
    return [...settle(fin(lo) ? lo : 0, fin(hi) ? hi : 1, lo, hi), 'marks'];
  }
  const len = lenOf(run, name, aspect), key = `${run.id}|${name}|${k}|${calib?.hilt ?? ''}|${calib?.out ?? ''}|${aspect.toFixed(4)}`, owner = motion || run;
  let m = scaleMemo.get(owner);   // kept per run, or per motion signal (the same fused channel object while nothing changes)
  if (!m) scaleMemo.set(owner, (m = new Map()));
  if (m.has(key)) return m.get(key);
  const sc = k >= 0 ? run?.scenes?.[k] : null, cf = run.channels[`sem_${name}_in_conf`], wy = run.channels[`sem_${name}_why`], I = [];
  if (len?.t?.length) for (let i = 0; i < len.t.length; i++) if (!sc || (len.t[i] >= sc.start_ms && len.t[i] < sc.end_ms)) I.push(i);
  const T = I.map((i) => len.t[i]), x = I.map((i) => len.v[i]);
  const ds = depthScale(T, x, (q) => at(cf, T[q]) >= CONF_MIN && !whyBad(at(wy, T[q])), { motion, hilt: fin(calib?.hilt) ? at(len, calib.hilt) : NaN, out: fin(calib?.out) ? at(len, calib.out) : NaN });   // paw-4c48.17: bound / lost frames never set it
  const r = [ds.a, ds.b, ds.from];
  m.set(key, r);
  return r;
}
/** The visible length (larger = out) re-mapped by its depth scale: fully out -> 1, hilted -> 0 (the owner's marks win). */
function calibrate(run, name, calib, aspect, k = -1, motion = null) {
  const [a, b] = calibAB(run, name, calib, aspect, k, motion);
  return (x) => (x === x && b - a > 1e-6 ? Math.min(1, Math.max(0, (x - a) / (b - a))) : NaN);
}

/** The shaft's depth on times t (ms) of run scene k: {depth (Float64Array, visible share 0..1 = script pos / 100;
 *  NaN where not confident), share (confident share of t), name, relative (never seen fully out)} | null. */
export function shaftDepth(run, k, t, calib = null, { aspect = 16 / 9, motion = null, part = null } = {}) {
  const s = shaftOf(run, k, { aspect, part });
  if (!s) return null;
  const len = lenOf(run, s.name, aspect), cf = run.channels[`sem_${s.name}_in_conf`], map = calibrate(run, s.name, calib, aspect, Math.max(0, k), motion);
  const depth = Float64Array.from(t, (x) => (at(cf, x) >= CONF_MIN ? map(at(len, x)) : NaN));
  let ok = 0;
  for (const d of depth) if (d === d) ok++;
  return { depth, share: t.length ? ok / t.length : 0, name: s.name, relative: s.rec.full === 'relative' && !Number.isFinite(calib?.out) };
}

/** paw-6t7d: does the shaft's depth follow a stroke signal? v (larger = out, NaN = lost) times the scene's sign against
 *  depth (shaftDepth: visible share, NaN = not confident), same samples -> Pearson r over the pairs both have (0 under 10).
 *  The strokes step anchors turns to the shaft only at r >= R_MIN (runs-channel.js pointsFromChannel). */
export function depthR(v, depth, sign = 1) {
  const x = [], y = [];
  for (let i = 0; i < Math.min(v.length, depth.length); i++) if (fin(v[i]) && fin(depth[i])) { x.push(sign * v[i]); y.push(depth[i]); }
  const r = pearson(x, y);
  return r === r ? r : 0;
}

/**
 * Direction from the shaft in run scene k: the run's points as they play (paw-vtec: its direction is applied when it is
 * composed, so points / points0 carry the owner's flips) against the shaft's visible length over its confident frames.
 * -> {sign: +1 the orientation that plays agrees | -1, r, share, confident, flipped (the owner flipped this scene),
 * agrees (sign > 0)} | null (no SAM shaft here).
 */
export function shaftDirection(run, k, { aspect = 16 / 9 } = {}) {
  const s = shaftOf(run, k, { aspect }), sc = run?.scenes?.[Math.max(0, k)], p = run?.points || run?.points0;
  if (!s || !p?.at?.length) return null;
  const len = lenOf(run, s.name, aspect), cf = run.channels[`sem_${s.name}_in_conf`];
  const xs = [], ys = [];
  let n = 0;
  for (let i = 0; i < len.t.length; i++) {
    const t = len.t[i];
    if (sc && (t < sc.start_ms || t >= sc.end_ms)) continue;
    n++;
    if (!(cf.v[i] >= CONF_MIN) || !(len.v[i] === len.v[i]) || len.v[i] == null) continue;
    const j = lowerBound(p.at, t);
    if (j <= 0 || j >= p.at.length) continue;
    const f = (t - p.at[j - 1]) / (p.at[j] - p.at[j - 1] || 1);
    xs.push(p.pos[j - 1] + f * (p.pos[j] - p.pos[j - 1])); ys.push(len.v[i]);
  }
  const m = xs.length, mx = xs.reduce((a, b) => a + b, 0) / (m || 1), my = ys.reduce((a, b) => a + b, 0) / (m || 1);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < m; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  const r = m >= 10 && sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0, share = n ? m / n : 0;
  const flipped = !!run.flips?.includes(Math.max(0, k)), sign = r >= 0 ? 1 : -1;
  return { sign, r: Math.round(r * 100) / 100, share: Math.round(share * 100) / 100, confident: share >= CONF_MIN && Math.abs(r) >= R_MIN, flipped, agrees: sign > 0 };
}

/** One line for the Adjust strip: '' without a SAM shaft in the scene. paw-6t7d: it used to print the share of confident
 *  frames as "% confident" beside an r that ruled the shaft out ("shaft unsure here (r -0.11, 100 % confident)"). */
export function directionText(d, key = 'F') {
  if (!d) return '';
  if (!d.confident) return d.share < CONF_MIN ? `shaft not used: read on only ${Math.round(100 * d.share)} % of the frames`
    : `shaft not used: its depth does not follow this signal (r ${d.r})`;
  return d.agrees ? `from the shaft (confident, r ${Math.abs(d.r)})` : `the shaft says the other way (r ${Math.abs(d.r)}): ${key} flips`;
}

/**
 * The inserted fraction at time t (the Machine panel's hook: inserted mm = in x the toy's length) -> {in 0..1, conf,
 * name, knot (0 out / 0.5 entrance / 1 in | null), source 'sam' | 'points'} | null. calib = the shot's derive.shaft.
 * memo (a Map, optional): keeps each run scene's shaft between calls, for sampling many times (insertedSeries).
 */
export function insertedAt(run, t, calib = null, memo = null, { aspect = 16 / 9, motion = null, part = null } = {}) {
  const k = sceneAt(run?.scenes || [], t), m = memo && (memo.get(run) || memo.set(run, new Map()).get(run));
  if (m && !m.has(k)) m.set(k, shaftOf(run, k, { points: true, aspect, part }));
  const s = m ? m.get(k) : shaftOf(run, k, { points: true, aspect, part });
  if (!s) return null;
  const v = calibrate(run, s.name, calib, aspect, Math.max(0, k), motion)(at(lenOf(run, s.name, aspect), t)), kn = at(run.channels[`sem_${s.name}_knot`], t);
  return v === v ? { in: 1 - v, conf: at(run.channels[`sem_${s.name}_in_conf`], t) || 0, name: s.name, knot: kn === kn ? kn : null, source: s.rec.source } : null;
}

/** The overlay at t: {name, base [x, y], entry [x, y], w (frame heights), in, conf, knot, source, state 'seen' | 'low' |
 *  'held', why} (normalized) | null. paw-4c48.7: base / entry from shaftGeom (along the penis group, time-interpolated),
 *  not the raw channels; aspect = the frame's width / height. */
export function shaftOverlay(run, t, calib = null, { aspect = 16 / 9, motion = null, part = null } = {}) {
  const ins = insertedAt(run, t, calib, null, { aspect, motion, part });
  if (!ins) return null;
  const g = geomAt(shaftGeom(run, sceneAt(run?.scenes || [], t), ins.name, { aspect }), t, aspect);
  if (!g) return null;
  const wc = at(run.channels[`sem_${ins.name}_why`], t), state = g.held ? 'held' : ins.conf >= CONF_MIN && !whyBad(wc) ? 'seen' : 'low';   // paw-4c48.17: bound / few / lost: unsure
  const why = g.held ? `held: the ${part ? partWord(part) : 'penis'} group is not tracked here` : state === 'low' ? `unsure (confidence ${ins.conf.toFixed(1)})` : null;
  return { ...ins, base: g.base, entry: g.entry, w: g.w, state, why };
}

// ================================================================================================================
// paw-4c48.7: the shaft's GEOMETRY per frame of a run scene, from the penis group itself. The owner's "the shaft almost
// always glitches about": the sidecar stored the entry along the SAM mask's own principal axis whenever it was within 45 deg of
// the tracked one (pawtrack/shaft.py measure, fixed there too), so on a fat painted penis whose mask takes in the balls /
// the partner at depth the drawn axis swung 15-30 deg once per stroke. Here, for every run (old ones included, no
// re-track): the group's members on a reference frame (most visible, nearest its seed) give the axis (principal direction)
// and the base end (nearest the owner's sheath > knot > balls > hips, else the sidecar's own choice, else away from the
// partner); per frame a similarity fit of the visible members (outliers refit out) carries base and axis rigidly; a spike of
// the angle past SPIKE_DEG from its running median is replaced by the median (a rotation never flips 180: the reference is
// oriented once); frames with under MIN_PTS shared members are held / interpolated (held: drawn faint). The visible length
// is the sidecar's measured entry PROJECTED on that axis (its own length where the mask axis agreed); runs without the
// members' ids (older .pawruns) get the stored base and the stored axis through the same spike filter.
export const GEO = { WIN: 2, SPIKE_DEG: 15, MIN_PTS: 3, HOLD_MS: 500, ELONG: 1.8, EV_CONTRAST: 1.5, EV_MIN: 0.005 };
const RECV_AXIS = ['mouth', 'muzzle', 'anus', 'slit', 'head', 'hips', 'torso'];   // the partner's part the shaft points at (paw-4c48.14)
/** paw-4c48.14: the axis (radians, a line) along which the visible members' extent changes most over the frames, from their
 *  places on the reference frame R (Map j -> [x, y]) and each frame's visible set X[i] (frames with a fit): the extent along
 *  a direction is max - min of the visible members' places; its spread over the frames is largest along the shaft (members go
 *  in and out along it) -> the angle, or null when no direction stands out (EV_CONTRAST) or nothing changes (EV_MIN). */
function axisEvidence(R, X, fits, n) {
  const K = 36, sd = new Float64Array(K);
  for (let a = 0; a < K; a++) {
    const th = (a * Math.PI) / K, u = [Math.cos(th), Math.sin(th)], e = [];
    for (let i = 0; i < n; i++) {
      if (!fits[i]) continue;
      let lo = Infinity, hi = -Infinity;
      for (const j of X[i].keys()) { const q = R.get(j); if (!q) continue; const v = q[0] * u[0] + q[1] * u[1]; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi >= lo) e.push(hi - lo);
    }
    if (e.length < 10) return null;
    const m = e.reduce((p, q) => p + q, 0) / e.length;
    sd[a] = Math.sqrt(e.reduce((p, q) => p + (q - m) ** 2, 0) / e.length);
  }
  let b = 0;
  for (let a = 1; a < K; a++) if (sd[a] > sd[b]) b = a;
  const across = sd[(b + K / 2) % K];
  return sd[b] >= GEO.EV_MIN && sd[b] >= GEO.EV_CONTRAST * across ? (b * Math.PI) / K : null;
}
const geoMemo = new WeakMap();
const OWN = ['sheath', 'knot', 'balls', 'hips'], wrapPi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
function groupsOf(run, k) {
  const g = run?.scenes?.[Math.max(0, k)]?.groups;
  if (g && typeof g === 'object') return g;
  return (run?.notes || []).find((x) => x?.code === 'group_labels' && (x.scene_index ?? 0) === Math.max(0, k))?.data?.groups || {};
}
/** Similarity B ~ z (A - ca) + cb (z complex: scale x rotation), least squares; refit once without residuals > 3 x the
 *  median and over 2e-3 frame heights (k >= 4). -> {zr, zi, ca, cb} | null. A, B: [[x, y]] (frame heights). */
export function simFit(A, B) {
  const fit = (I) => {
    const k = I.length, ca = [0, 0], cb = [0, 0];
    for (const i of I) { ca[0] += A[i][0] / k; ca[1] += A[i][1] / k; cb[0] += B[i][0] / k; cb[1] += B[i][1] / k; }
    let re = 0, im = 0, den = 0;
    for (const i of I) { const ax = A[i][0] - ca[0], ay = A[i][1] - ca[1], bx = B[i][0] - cb[0], by = B[i][1] - cb[1]; re += ax * bx + ay * by; im += ax * by - ay * bx; den += ax * ax + ay * ay; }
    return den > 1e-12 ? { zr: re / den, zi: im / den, ca, cb } : null;
  };
  const all = A.map((_, i) => i);
  if (A.length < 2) return null;
  const T = fit(all);
  if (!T || A.length < 4) return T;
  const res = all.map((i) => Math.hypot(...sub(simApply(T, A[i]), B[i]))), m = median(res);
  const keep = all.filter((i) => res[i] <= Math.max(3 * m, 2e-3));   // ~2 px at 1080: rounding is not an outlier (the sidecar: 1 px)
  return keep.length >= 2 && keep.length < all.length ? fit(keep) || T : T;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const simApply = (T, p) => { const x = p[0] - T.ca[0], y = p[1] - T.ca[1]; return [T.zr * x - T.zi * y + T.cb[0], T.zi * x + T.zr * y + T.cb[1]]; };
/** Principal axis of points P ([[x, y]], square units) -> {c, u}. */
function pca(P) {
  const c = [0, 0];
  for (const q of P) { c[0] += q[0] / P.length; c[1] += q[1] / P.length; }
  let sxx = 0, syy = 0, sxy = 0;
  for (const q of P) { const dx = q[0] - c[0], dy = q[1] - c[1]; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), tr = sxx + syy, dd = Math.sqrt(Math.max(0, (sxx - syy) ** 2 + 4 * sxy * sxy));
  return { c, u: [Math.cos(th), Math.sin(th)], elong: Math.sqrt((tr + dd) / Math.max(1e-18, tr - dd)) };   // elong: long / wide (1 = round)
}
/** Spike filter in place: angles a (radians, NaN = none) -> each finite one further than SPIKE_DEG from the median of its
 *  +-WIN finite neighbours (unwrapped against it) becomes that median. -> the number replaced. */
export function despike(a) {
  const lim = (GEO.SPIKE_DEG * Math.PI) / 180, src = Float64Array.from(a), idx = [];
  for (let i = 0; i < src.length; i++) if (fin(src[i])) idx.push(i);
  let n = 0;
  for (let q = 0; q < idx.length; q++) {
    const lo = Math.max(0, q - GEO.WIN), hi = Math.min(idx.length - 1, q + GEO.WIN), ref = src[idx[q]];
    const w = [];
    for (let r = lo; r <= hi; r++) w.push(ref + wrapPi(src[idx[r]] - ref));
    const m = median(w);
    if (Math.abs(wrapPi(ref - m)) > lim) { a[idx[q]] = wrapPi(m); n++; }
  }
  return n;
}
/** The shaft's geometry over run scene k for shaft group `name` -> {t (frame times), bx, by (normalized image), ang (axis
 *  angle, square units: x scaled by aspect), L (visible length along the axis, frame heights), w (frame heights), src
 *  (2 = from the members, 1 = the stored channels, 0 = held / none), n (visible members), spikes, from ('members' | 'stored'),
 *  why (how the base end was chosen)} | null. Memoized per run object. */
export function shaftGeom(run, k, name, { aspect = 16 / 9 } = {}) {
  if (!run?.channels || !name) return null;
  let m = geoMemo.get(run);
  if (!m) geoMemo.set(run, (m = new Map()));
  const key = `${k}|${name}|${aspect.toFixed(4)}`;
  if (!m.has(key)) m.set(key, buildGeom(run, Math.max(0, k), name, aspect));
  return m.get(key);
}
function buildGeom(run, k, name, A) {
  const C = run.channels, n0 = `sem_${name}_`, sc = run.scenes?.[k], inSc = (t) => !sc || (t >= sc.start_ms && t < sc.end_ms);
  const fr = run.frames, groups = groupsOf(run, k), gid = groups['sem_' + name]?.id, who = /^(c[12]|x)_/.exec(name)?.[1] || null;
  const own = sc?.shaft?.[name]?.role === 'part' ? [] : OWN;   // paw-4c48.19: a depth part's base: the sidecar's end (away from the receiver)
  // frame times: the run's frames inside the scene, else the shaft channel's
  const base = fr?.t?.length ? fr.t : C[n0 + 'len']?.t;
  if (!base?.length) return null;
  const I = [];
  for (let i = 0; i < base.length; i++) if (inSc(base[i])) I.push(i);
  if (!I.length) return null;
  const T = Float64Array.from(I, (i) => base[i]), n = T.length;
  const sbx = onT(C[n0 + 'bx'], T), sby = onT(C[n0 + 'by'], T), sex = onT(C[n0 + 'ex'], T), sey = onT(C[n0 + 'ey'], T), sw = onT(C[n0 + 'w'], T);
  const bx = new Float64Array(n).fill(NaN), by = new Float64Array(n).fill(NaN), ang = new Float64Array(n).fill(NaN), L = new Float64Array(n).fill(NaN);
  const w = Float64Array.from(sw), src = new Int8Array(n), nv = new Int16Array(n), scl = new Float64Array(n).fill(NaN);
  // the members (square units), per frame: Map index -> [x, y]
  const memb = (id) => I.map((i) => { const mp = new Map(), p = fr?.ov?.[i]?.pts; if (p && id != null) for (let j = 0; j < p.length; j++) { const q = p[j]; if (q[5] === id && q[2] > 0) mp.set(j, [q[0] * A, q[1]]); } return mp; });
  const X = Number.isInteger(gid) && fr?.ov ? memb(gid) : null;
  let max = 0;
  if (X) for (let i = 0; i < n; i++) { nv[i] = X[i].size; max = Math.max(max, X[i].size); }
  let from = 'stored', why = null, span = NaN, axisFrom = null;
  if (X && max >= GEO.MIN_PTS) {
    from = 'members';
    const seedT = (run.groupSeeds || []).find((s) => s?.name === name && inSc(s.t_ms))?.t_ms ?? T[0];
    let r = -1;
    for (let i = 0; i < n; i++) if (X[i].size >= 0.9 * max && (r < 0 || Math.abs(T[i] - seedT) < Math.abs(T[r] - seedT))) r = i;
    const R = X[r], P = [...R.values()], { c, u: uP, elong } = pca(P);
    // per frame: the similarity from the reference members to that frame's
    const fits = X.map((M) => { const Aa = [], Bb = []; for (const [j, q] of M) if (R.has(j)) { Aa.push(R.get(j)); Bb.push(q); } return Aa.length >= GEO.MIN_PTS ? simFit(Aa, Bb) : null; });
    // the axis line: the sidecar's stored axis on the frames that show (nearly) the whole group, each turned back into the
    // reference frame by its fit (SAM's outline of the out shaft beats the principal direction of a fat painted region);
    // the members' principal direction when there are none. A doubled-angle mean: a line, oriented below.
    const sAng = (i) => ([sbx[i], sby[i], sex[i], sey[i]].every(fin) ? Math.atan2(sey[i] - sby[i], (sex[i] - sbx[i]) * A) : NaN);
    let cx2 = 0, sy2 = 0;
    const refA = [];
    for (let i = 0; i < n; i++) if (fits[i] && X[i].size >= 0.9 * max && fin(sAng(i))) { const a = sAng(i) - Math.atan2(fits[i].zi, fits[i].zr); cx2 += Math.cos(2 * a); sy2 += Math.sin(2 * a); refA.push(a); }
    const nAx = refA.length, half = (x) => x - Math.PI * Math.round(x / Math.PI);
    // the doubled-angle mean, then the median of the lines around it (a glitch frame of the old pass does not pull it)
    const centreOf = (id) => { const M = memb(id); for (let d = 0; d < n; d++) for (const i of [r - d, r + d]) if (i >= 0 && i < n && M[i].size) { const Q = [...M[i].values()]; return [Q.reduce((a, q) => a + q[0], 0) / Q.length, Q.reduce((a, q) => a + q[1], 0) / Q.length]; } return null; };
    const idOf = (w0, p) => { const re = new RegExp(`^sem_${w0}_${p}(_[lr])?\\d*$`); return Object.entries(groups).find(([kk, g]) => re.test(kk) && Number.isInteger(g?.id))?.[1].id; };
    const th0 = 0.5 * Math.atan2(sy2, cx2), samOk = nAx >= 3 && Math.hypot(cx2, sy2) > 0.5 * nAx;
    let th = samOk ? th0 + median(refA.map((a) => half(a - th0))) : Math.atan2(uP[1], uP[0]);
    axisFrom = samOk ? 'the shaft pass' : "the points' shape";
    // paw-4c48.14: a group wider than it is long (little of the shaft visible on the reference frame) says nothing about the axis:
    // its principal direction is the WIDTH, and the sidecar's outline of so little is as wide. Then independent evidence, in
    // order: (1) the direction along which the visible members' extent changes over the shot (the shaft goes in along its axis),
    // (2) the owner's base part (sheath / knot / balls / hips) towards the partner's receiving part, (3) the shot's stroke axis
    // (the first also overrules a confident shape or outline that lies more than 45 deg across it: the points going in and out
    // along a line are the most direct evidence there is)
    const ev = axisEvidence(R, X, fits, n), across = ev != null && Math.abs(half(ev - th)) > Math.PI / 4;
    if (elong < GEO.ELONG || across) {
      const bq = who ? own.map((p) => idOf(who, p)).map((id) => (id != null ? centreOf(id) : null)).find(Boolean) : null;
      const rq = who ? RECV_AXIS.flatMap((p) => ['c1', 'c2', 'x'].filter((w0) => w0 !== who).map((w0) => idOf(w0, p))).map((id) => (id != null ? centreOf(id) : null)).find(Boolean) : null;
      const deg = (run.notes || []).find((x) => x?.code === 'primary' && (x.scene_index ?? 0) === k)?.data?.axis?.deg ?? sc?.axis_deg;
      if (ev != null) { th = ev; axisFrom = 'where the visible points change over the shot'; }
      else if (bq && rq && Math.hypot(rq[0] - bq[0], rq[1] - bq[1]) > 1e-3) { th = Math.atan2(rq[1] - bq[1], rq[0] - bq[0]); axisFrom = 'its base towards the partner'; }
      else if (fin(deg)) { th = (-deg * Math.PI) / 180; axisFrom = "the shot's stroke axis"; }
    }
    let u = [Math.cos(th), Math.sin(th)];
    const s = new Map([...R].map(([j, q]) => [j, (q[0] - c[0]) * u[0] + (q[1] - c[1]) * u[1]]));
    let lo = Math.min(...s.values()), hi = Math.max(...s.values());
    const end = (v) => [c[0] + v * u[0], c[1] + v * u[1]];
    // the base end: nearest the owner's sheath > knot > balls > hips (their members' centre on the reference frame or the
    // nearest), unless both ends are about as near (within 15 %); then the sidecar's direction on most frames; then away
    // from the partner's receiving parts
    let flip = null;
    for (const p of own) {
      if (!who || flip != null) break;
      const id = idOf(who, p), q = id != null ? centreOf(id) : null;
      if (!q) continue;
      const dl = Math.hypot(...sub(end(lo), q)), dh = Math.hypot(...sub(end(hi), q));
      if (Math.abs(dl - dh) > 0.15 * Math.max(dl, dh)) { flip = dh < dl; why = p; }
    }
    if (flip == null) {
      let vote = 0;
      for (let i = 0; i < n; i++) if (fits[i] && fin(sAng(i))) vote += Math.cos(sAng(i) - Math.atan2(fits[i].zi, fits[i].zr) - th) > 0 ? 1 : -1;
      if (vote) { flip = vote < 0; why = 'the shaft pass'; }
    }
    if (flip == null && who) for (const p of RECEIVE) {
      const id = ['c1', 'c2', 'x'].filter((w0) => w0 !== who).map((w0) => idOf(w0, p)).find((x) => x != null), q = id != null ? centreOf(id) : null;
      if (q) { flip = Math.hypot(...sub(end(lo), q)) < Math.hypot(...sub(end(hi), q)); why = 'away from the partner'; break; }
    }
    if (flip) { u = [-u[0], -u[1]]; [lo, hi] = [-hi, -lo]; for (const [j, v] of s) s.set(j, -v); }
    const b0 = end(lo), a0 = Math.atan2(u[1], u[0]);
    span = hi - lo;   // paw-4c48.10: the members' extent along the axis on the reference frame (the points reading's full length)
    for (let i = 0; i < n; i++) {
      const F = fits[i];
      if (!F) continue;
      const b = simApply(F, b0);
      bx[i] = b[0] / A; by[i] = b[1]; ang[i] = wrapPi(a0 + Math.atan2(F.zi, F.zr)); src[i] = 2; scl[i] = Math.hypot(F.zr, F.zi);
      if (!fin(w[i])) {   // no stored width: the members' spread across the axis on the reference x the scale
        const across = P.map((q) => Math.abs(-(q[0] - c[0]) * u[1] + (q[1] - c[1]) * u[0])).sort((p, q) => p - q);
        w[i] = 2 * across[Math.floor(0.9 * (across.length - 1))] * Math.hypot(F.zr, F.zi);
      }
      // the farthest place of a visible member (the points fallback's reading): where the stored entry is missing or lies
      // behind the base on this axis (the sidecar chose the other end)
      let e = -Infinity;
      for (const j of X[i].keys()) if (s.has(j)) e = Math.max(e, s.get(j) - lo);
      if (e > 0) L[i] = e * Math.hypot(F.zr, F.zi);
    }
  } else for (let i = 0; i < n; i++) if ([sbx[i], sby[i], sex[i], sey[i]].every(fin)) {
    bx[i] = sbx[i]; by[i] = sby[i]; src[i] = 1; scl[i] = fin(sw[i]) ? sw[i] : NaN;
    if (Math.hypot((sex[i] - sbx[i]) * A, sey[i] - sby[i]) > 1e-9) ang[i] = Math.atan2(sey[i] - sby[i], (sex[i] - sbx[i]) * A);   // else: the neighbours' (all in)
  }
  if (from === 'stored') { const wm = median(Array.from(scl).filter((x) => x > 0)); for (let i = 0; i < n; i++) scl[i] = wm > 0 && scl[i] > 0 ? scl[i] / wm : src[i] ? 1 : NaN; }   // the zoom: the width against its median
  const spikes = despike(ang);
  // the visible length: the stored entry projected on the axis
  const ratio = new Float64Array(n).fill(NaN);   // projected / stored length: lenOf re-scales the sidecar's visible share by it
  for (let i = 0; i < n; i++) {
    if (!fin(sex[i]) || !fin(sbx[i]) || !fin(sey[i]) || !fin(sby[i])) continue;
    const dx = (sex[i] - sbx[i]) * A, dy = sey[i] - sby[i], m = Math.hypot(dx, dy);
    if (m < 1e-9) { L[i] = 0; continue; }   // the entry at the base: all in
    if (!fin(ang[i])) continue;
    const p = dx * Math.cos(ang[i]) + dy * Math.sin(ang[i]);
    if (p > 0) { L[i] = p; if (src[i]) ratio[i] = p / m; }
  }
  // holes: interpolated between good frames up to HOLD_MS, else the last good placement held (src 0 = held)
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (fin(ang[i]) && fin(bx[i])) { last = i; continue; }
    let nx = i + 1;
    while (nx < n && !(fin(ang[nx]) && fin(bx[nx]))) nx++;
    const a = last, b = nx < n ? nx : -1;
    if (a < 0 && b < 0) continue;
    const f = a >= 0 && b >= 0 && T[b] - T[a] <= GEO.HOLD_MS ? (T[i] - T[a]) / (T[b] - T[a]) : null, j = a >= 0 ? a : b;
    const keep = fin(bx[i]) && fin(by[i]);   // a measured base without an axis (the entry at the base) keeps its base
    if (f != null) { if (!keep) { bx[i] = bx[a] + f * (bx[b] - bx[a]); by[i] = by[a] + f * (by[b] - by[a]); } ang[i] = ang[a] + f * wrapPi(ang[b] - ang[a]); }
    else { if (!keep) { bx[i] = bx[j]; by[i] = by[j]; } ang[i] = ang[j]; }
    if (!fin(L[i])) L[i] = f != null && fin(L[a]) && fin(L[b]) ? L[a] + f * (L[b] - L[a]) : L[j];
    if (!fin(w[i])) w[i] = w[j];
    if (!fin(scl[i])) scl[i] = f != null && fin(scl[a]) && fin(scl[b]) ? scl[a] + f * (scl[b] - scl[a]) : scl[j];
  }
  return { t: T, bx, by, ang, L, w, sc: scl, src, n: nv, nMax: max, span, ratio, spikes, from, why, axisFrom };
}
const lenMemo = new WeakMap();
/** The visible share channel of shaft `name` ({t, v}, sem_<name>_len's frames) with each frame's length taken along the
 *  corrected axis (shaftGeom ratio: the sidecar measured along the mask's own axis when it was within 45 deg of the tracked
 *  one; on those frames the share is re-scaled by the projection). Where no ratio is known: as stored. Every reader of the
 *  visible length (depth, direction, the gauge, the strip, the marks) reads this one. */
export function lenOf(run, name, aspect = 16 / 9) {
  const raw = run?.channels?.[`sem_${name}_len`];
  if (!raw?.t?.length) return raw;
  let m = lenMemo.get(run);
  if (!m) lenMemo.set(run, (m = new Map()));
  const key = `${name}|${aspect.toFixed(4)}`;
  if (m.has(key)) return m.get(key);
  const v = Float64Array.from(raw.v, (x) => (x == null ? NaN : x)), scenes = run.scenes?.length ? run.scenes : [null];
  scenes.forEach((sc, k) => {
    if (sc && !sc.shaft?.[name]) return;
    const G = shaftGeom(run, k, name, { aspect });
    if (!G) return;
    for (let i = 0; i < raw.t.length; i++) {
      const t = raw.t[i];
      if (sc && (t < sc.start_ms || t >= sc.end_ms)) continue;
      const j = stateIndex(G, t);
      if (j >= 0 && Math.abs(G.t[j] - t) <= 60 && fin(G.ratio[j]) && fin(v[i])) v[i] *= G.ratio[j];
    }
  });
  const c = { ...raw, v };
  m.set(key, c);
  return c;
}
/** shaftGeom G at time t, interpolated between its frames (smooth while playing) -> {base, entry ([x, y] normalized), u
 *  ([ux, uy] square units), L, w (frame heights), held (no measured geometry on either side)} | null. */
export function geomAt(G, t, aspect = 16 / 9) {
  const T = G?.t;
  if (!T?.length || t < T[0] - 60 || t > T[T.length - 1] + 60) return null;
  let i = Math.min(T.length - 1, Math.max(0, lowerBound(T, t) - 1));
  const j = Math.min(T.length - 1, i + 1), f = j > i && t > T[i] ? Math.min(1, (t - T[i]) / (T[j] - T[i])) : 0;
  if (!fin(G.ang[i])) i = j;
  if (!fin(G.ang[i])) return null;
  const mix = (a) => (fin(a[j]) && j !== i ? a[i] + f * (a[j] - a[i]) : a[i]);
  const ang = fin(G.ang[j]) && j !== i ? G.ang[i] + f * wrapPi(G.ang[j] - G.ang[i]) : G.ang[i];
  const u = [Math.cos(ang), Math.sin(ang)], bx = mix(G.bx), by = mix(G.by), L = mix(G.L), w = mix(G.w);
  if (![bx, by, L].every(fin)) return null;
  const sc = G.sc ? mix(G.sc) : 1;
  return { base: [bx, by], entry: [bx + (L * u[0]) / aspect, by + L * u[1]], u, L, w: fin(w) ? w : 0, sc: fin(sc) ? sc : 1, held: !G.src[i] && !(f > 0 && G.src[j]) };
}

// ================================================================================================================
// paw-4c48 stage 1: ONE reading of the shaft per frame of a run scene, from the channels the sidecar already writes. Nothing
// that makes the script reads it (the Knotting / Insertion / Pull-out modifiers, absolute depth, Autorange, the Machine and
// fusion keep their own readers): it is what the Tracker lane's shaft strip shows and what the scorecard measures.
// shaftState(run, k, {calib, aspect, grid}) for run scene k's shaft (shaftOf, the points fallback included: the overlay
// draws it too), per frame on the channel's frame times (snapped to frame starts on the player clock when grid is given):
//   vis    the visible share 0..1 (1 = all of it outside), re-mapped by the owner's out / hilt marks (insertedAt's rule)
//   conf   the sidecar's confidence; HIDDEN_CONF on an inferred-hidden frame
//   state  'seen' (conf >= CONF_MIN) | 'low' (a reading, unsure) | 'hidden' | 'lost'; why: why hidden / lost, else null
//   hidden = INFERRED FULLY IN: no confident reading, the shaft's body still tracked (its base point in the frame and the
//          group or its own sheath / balls / hips / torso present), and the last confident reading before the gap was low
//          (vis <= HIDDEN_VIS) and falling over FALL_MS (or already <= 0.15) with the tip not free. vis 0 there. (The
//          sidecar never reads 0: SAM is not prompted under 3 visible members and a tiny mask is None: "all in" was NaN.)
//   lost   no confident reading for another reason: the body not tracked (off frame / points lost), a hand / paw / tail
//          at the entry (len kept, in NaN: the sidecar's occlusion), fewer than 3 visible points (SAM not prompted; from
//          sem_<n>_n against its scene maximum x the record's members), else SAM found no mask (drift / lost)
//   knotAt the knot's place as a share of the full length from the base (raw, before the marks' re-map): the owner's mark
//          (calib.knot), else the painted knot (sem_<who>_knot_x / _y, + camera: the penis' knot section since paw-njnf /
//          PROTOCOL v4.54, an old separate knot group before; none painted = this step is skipped) projected on base -> entry x the raw
//          visible share (median), else the record's knot place (at_w / l_full_w). REJECTED (null; knotWhy says why) when
//          >= 1 (beyond the full length) or when the bulge reaches the base (at - half <= KNOT_EPS): the research found
//          one or the other in 2 of 3 scenes. The owner's mark is never rejected.
//   knot   per frame 0 out / 1 at / 2 in / -1 unknown, recomputed from the raw visible length against knotAt +- half with
//          hysteresis (KNOT_HYS); hidden = in; all -1 without knotAt. (The stitched _knot channel of a multi-seed part
//          is a cross-fade of states: never read.)
//   free   tip free (1) / at the partner (0) / unknown (-1): the entry point's distance to the receiving partner's
//          opening (anus > slit > hips > torso of the other character, image position = centre + camera) in shaft widths,
//          against d0 = the median distance on deep confident frames (a hips centre is never AT the opening): free above
//          d0 + FREE_ON, back at the partner under d0 + FREE_OFF; hidden = not free.
//   events [{t, kind}]: wentIn (free -> not), pulledOut (not -> free with vis >= OUT_VIS), knotIn (into in, last definite
//          out) / knotOut (into out, last definite in), each state held >= HOLD frames; at the first frame of the new state.
// Multi-seed parts (paw-o74b.1): the stitched sem_<n>_* channels are read as they are. The shaft pass does NOT know about
// seeds: each seed's groups_only call ran its own pass, so its len is against ITS OWN full length; the stitch cross-fades
// len / in / in_conf (kind 'none': no alignment) while bx / by / ex / ey are offset-aligned; the scene record (full length,
// knot place) is the first call's. A handover can step the visible share (a child bead of paw-4c48).
export const SHAFT = { HIDDEN_VIS: 0.4, HIDDEN_CONF: 0.2, FALL_MS: 400, KNOT_EPS: 0.05, KNOT_HYS: 0.03, KNOT_HALF: 0.05, FREE_ON: 3, FREE_OFF: 2, OUT_VIS: 0.8, MIN_MEMBERS: 3, MATCH_MS: 200, MAX_LAG_MS: 200, STRETCH_MS: 300, HOLD: 2 };
/** The owner's truth marks (per shot): out / hilt are the calibration marks (derive.shaft), the rest scene.shaftTruth. */
export const TRUTH_KINDS = ['out', 'hilt', 'wentIn', 'knotIn', 'knotOut', 'pulledOut'];
export const EVENT_KINDS = ['wentIn', 'pulledOut', 'knotIn', 'knotOut'];
export const KIND_TEXT = { out: 'fully out', hilt: 'hilted', wentIn: 'went in', knotIn: 'knot in', knotOut: 'knot out', pulledOut: 'pulled out' };
const RECEIVE = ['anus', 'slit', 'hips', 'torso'], BASE = ['sheath', 'balls', 'hips', 'torso'];
const fin = Number.isFinite;
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const snapT = (t, grid) => (grid ? frameStartOf(t, grid) : Math.round(t));

/** The raw visible length <-> the strip's (calibrated) visible share, for the knot line: {toVis, toLen}. */
export function shaftScale(run, name, calib = null, aspect = 16 / 9, k = -1) {
  const [a, b] = calibAB(run, name, calib, aspect, k), d = b - a > 1e-6 ? b - a : 1;
  return { toVis: (x) => Math.min(1, Math.max(0, (x - a) / d)), toLen: (v) => a + v * d };
}

/** Channel c's values on frame times T (nearest within 60 ms). */
function onT(c, T) {
  const out = new Float64Array(T.length).fill(NaN);
  if (c?.t?.length) for (let i = 0; i < T.length; i++) out[i] = at(c, T[i]);
  return out;
}
/** The first channel stem sem_<who>_<part>[_side][n] (it has _x) for parts in order, whos in order | null. */
function partKey(ch, whos, parts) {
  const keys = Object.keys(ch);
  for (const p of parts) for (const w of whos) {
    const re = new RegExp(`^sem_${w}_${p}(_[lr])?\\d*_x$`), k = keys.find((x) => re.test(x));
    if (k) return k.slice(0, -2);
  }
  return null;
}

/** Run scene k's shaft, one reading per frame (see above) | null (no shaft channels in that scene). */
export function shaftState(run, k, { calib = null, aspect = 16 / 9, grid = null, part = null } = {}) {
  const s = shaftOf(run, k, { points: true, aspect, part });
  if (!s) return null;
  const C = run.channels, n0 = `sem_${s.name}_`, lenC = lenOf(run, s.name, aspect), sc = run.scenes?.[Math.max(0, k)];
  if (!lenC?.t?.length) return null;
  const idx = [];
  for (let i = 0; i < lenC.t.length; i++) if (!sc || (lenC.t[i] >= sc.start_ms && lenC.t[i] < sc.end_ms)) idx.push(i);
  if (!idx.length) return null;
  const T = Float64Array.from(idx, (i) => lenC.t[i]), n = T.length, g = (sfx) => onT(C[n0 + sfx], T);
  const len = Float64Array.from(idx, (i) => (lenC.v[i] === lenC.v[i] ? lenC.v[i] : NaN));
  const ins = g('in'), cf = g('in_conf'), bx = g('bx'), by = g('by'), ex = g('ex'), ey = g('ey'), wd = g('w'), nn = g('n'), gx = g('x'), wy = g('why');   // wy: PROTOCOL v4.50 (NaN before)
  // paw-4c48.7: base / entry along the corrected axis (shaftGeom) on the frames it measured; the rest as stored
  const G = shaftGeom(run, k, s.name, { aspect });
  if (G) for (let q = 0; q < n; q++) {
    const j = stateIndex(G, T[q]);
    if (j < 0 || Math.abs(G.t[j] - T[q]) > 60 || !G.src[j] || !fin(G.ang[j])) continue;
    bx[q] = G.bx[j]; by[q] = G.by[j];
    if (fin(ex[q]) && fin(G.L[j])) { ex[q] = G.bx[j] + (G.L[j] * Math.cos(G.ang[j])) / aspect; ey[q] = G.by[j] + G.L[j] * Math.sin(G.ang[j]); }
  }
  const { toVis, toLen } = shaftScale(run, s.name, calib, aspect);   // (the strip shows the visible share itself: marks only)
  const vis = Float64Array.from(len, (x) => (x === x ? toVis(x) : NaN)), conf = Float64Array.from(cf, (x) => (x === x ? x : 0));
  const who = /^(c[12]|x)_/.exec(s.name)?.[1] || null, others = ['c1', 'c2', 'x'].filter((w) => w !== who);
  const camX = onT(C.cam_x, T), camY = onT(C.cam_y, T), img = (v, i, c) => v + (c[i] === c[i] ? c[i] : 0);
  // the shaft's body: the group itself, else its own base parts
  const own = (who ? BASE.map((p) => partKey(C, [who], [p])).filter(Boolean) : []).map((kk) => onT(C[kk + '_x'], T));
  const inFrame = (i) => bx[i] >= 0 && bx[i] <= 1 && by[i] >= 0 && by[i] <= 1;
  const bodyOk = (i) => fin(bx[i]) && fin(by[i]) && inFrame(i) && (fin(gx[i]) || own.some((o) => fin(o[i])) || !C[n0 + 'x']);
  const nMax = Math.max(0, ...Array.from(nn).filter(fin)), members = s.rec.members || 0;
  // ponytail: visible members ~ members x n / max(n) in the scene (all visible at the max); exact counts need the frames' pts
  const fewPts = (i) => (nMax > 0 && members > 0 && fin(nn[i]) ? (members * nn[i]) / nMax < SHAFT.MIN_MEMBERS : !fin(gx[i]) && !!C[n0 + 'x']);
  const seen = (i) => conf[i] >= CONF_MIN && vis[i] === vis[i] && !whyBad(wy[i]);   // paw-4c48.17: the sidecar's bound / hidden / few / lost never read as seen
  // tip free: the entry against the receiving partner's opening (image position), in shaft widths
  const rk = partKey(C, others, RECEIVE), rx = rk ? onT(C[rk + '_x'], T) : null, ry = rk ? onT(C[rk + '_y'], T) : null;
  const wMed = median(Array.from(wd).filter((x) => fin(x) && x > 0)), dw = new Float64Array(n).fill(NaN);
  if (rx && wMed > 0) for (let i = 0; i < n; i++) {
    const X = img(rx[i], i, camX), Y = img(ry[i], i, camY);
    if (fin(ex[i]) && fin(ey[i]) && fin(X) && fin(Y)) dw[i] = Math.hypot((ex[i] - X) * aspect, ey[i] - Y) / wMed;
  }
  const deep = [];
  for (let i = 0; i < n; i++) if (seen(i) && vis[i] < 0.6 && fin(dw[i])) deep.push(dw[i]);
  const d0 = deep.length >= 5 ? median(deep) : 0, on = d0 + SHAFT.FREE_ON, off = d0 + SHAFT.FREE_OFF;
  // pass 1: hidden vs lost, tip free; in time order
  const state = new Array(n).fill('lost'), why = new Array(n).fill(null), free = new Int8Array(n).fill(-1);
  let last = -1, hiddenOk = false, inGap = false, fr = null;
  for (let i = 0; i < n; i++) {
    if (seen(i)) {
      state[i] = 'seen'; last = i; inGap = false;
      if (fin(dw[i])) fr = fr == null ? (dw[i] > (on + off) / 2 ? 1 : 0) : fr === 1 ? (dw[i] < off ? 0 : 1) : dw[i] > on ? 1 : 0;
      free[i] = fr == null ? -1 : fr;
      continue;
    }
    if (!inGap) {   // a gap begins: does it read as fully in?
      inGap = true; hiddenOk = false;
      if (last >= 0) {
        let j = last;
        while (j > 0 && T[last] - T[j - 1] <= SHAFT.FALL_MS) j--;
        let first = last;
        for (let q = j; q <= last; q++) if (seen(q)) { first = q; break; }
        const v = vis[last];
        hiddenOk = v <= SHAFT.HIDDEN_VIS && (v - vis[first] < -0.01 || v <= 0.15) && free[last] !== 1;
      }
    }
    // paw-4c48.17: the sidecar's own reason where it says one (v4.50); else the app's inference as before
    const wc = wy[i];
    if (wc === WHY.HIDDEN || (!fin(wc) && len[i] === len[i] && !(ins[i] === ins[i]))) { why[i] = WHY_TEXT[WHY.HIDDEN]; continue; }   // the sidecar's occlusion: lost
    if (wc === WHY.LOST) { hiddenOk = false; why[i] = WHY_TEXT[WHY.LOST]; continue; }
    if (len[i] === len[i] && wc !== WHY.FEW) { state[i] = 'low'; why[i] = wc === WHY.BOUND ? WHY_TEXT[WHY.BOUND] : null; continue; }
    if (hiddenOk && bodyOk(i)) {
      state[i] = 'hidden'; why[i] = `the last reading was ${Math.round(100 * vis[last])} % visible and falling; the shaft's body is still tracked`;
      vis[i] = 0; conf[i] = SHAFT.HIDDEN_CONF; free[i] = 0; fr = 0;
      continue;
    }
    hiddenOk = false;   // the body went (or never qualified): the rest of the gap is lost
    why[i] = !bodyOk(i) ? (fin(bx[i]) && !inFrame(i) ? 'off frame' : "the shaft's body is not tracked here")
      : wc === WHY.FEW || fewPts(i) ? WHY_TEXT[WHY.FEW] : WHY_TEXT[WHY.LOST];
  }
  // the knot's place (raw share of the full length) and its sanity
  let knotAt = null, knotFrom = null, knotWhy = null, half = SHAFT.KNOT_HALF;
  const rec = s.rec, rkn = rec.knot && fin(rec.knot.at_w) && fin(rec.l_full_w) && rec.l_full_w > 0 ? { at: rec.knot.at_w / rec.l_full_w, half: (rec.knot.half_w || 0) / rec.l_full_w } : null;
  if (rkn?.half > 0) half = rkn.half;
  const kk = partKey(C, [who, ...others].filter(Boolean), ['knot']) || (C.sem_knot_x ? 'sem_knot' : null);
  let painted = null;
  if (kk) {
    const kx = onT(C[kk + '_x'], T), ky = onT(C[kk + '_y'], T), sh = [];
    for (let i = 0; i < n; i++) {
      if (state[i] !== 'seen' || !fin(kx[i]) || !fin(ex[i]) || !fin(bx[i])) continue;
      const ux = (ex[i] - bx[i]) * aspect, uy = ey[i] - by[i], uu = ux * ux + uy * uy;
      if (!(uu > 0)) continue;
      const q = ((img(kx[i], i, camX) - bx[i]) * aspect * ux + (img(ky[i], i, camY) - by[i]) * uy) / uu;
      if (q >= 0 && q <= 0.95) sh.push(q * len[i]);
    }
    if (sh.length >= 5) painted = median(sh);
  }
  if (fin(calib?.knot) && calib.knot > 0 && calib.knot < 1.5) { knotAt = calib.knot; knotFrom = 'mark'; }
  else {
    const cand = painted != null ? { at: painted, from: 'painted' } : rkn ? { at: rkn.at, from: 'record' } : null;
    if (cand) {
      const src = cand.from === 'painted' ? 'the painted knot' : "the shaft pass's knot place";
      if (cand.at >= 1) knotWhy = `${src} is beyond the full length (${Math.round(100 * cand.at)} %)`;
      else if (cand.at - half <= SHAFT.KNOT_EPS) knotWhy = `${src} reaches the base (${Math.round(100 * cand.at)} % +- ${Math.round(100 * half)} %)`;
      else { knotAt = cand.at; knotFrom = cand.from; }
    }
  }
  // pass 2: knot states (hysteresis)
  const knot = new Int8Array(n).fill(-1), H = SHAFT.KNOT_HYS;
  const hi = knotAt != null ? knotAt + half : 0, lo = knotAt != null ? knotAt - half : 0;
  let ks = null;
  if (knotAt != null) for (let i = 0; i < n; i++) {
    if (state[i] !== 'seen' && state[i] !== 'hidden') continue;
    const x = len[i];
    ks = state[i] === 'hidden' ? 2 : ks == null ? (x > hi ? 0 : x < lo ? 2 : 1)
      : ks === 0 ? (x < lo - H ? 2 : x < hi - H ? 1 : 0)
        : ks === 2 ? (x > hi + H ? 0 : x > lo + H ? 1 : 2)
          : x > hi + H ? 0 : x < lo - H ? 2 : 1;
    knot[i] = ks;
  }
  // the events: a state counts once it holds HOLD frames (the sidecar's rule: one drawing on twos); at its first frame
  const events = [], ev = (i, kind) => events.push({ t: snapT(T[i], grid), kind });
  const commits = (arr, a, b, on) => {
    let cur = null, run = null, start = -1, cnt = 0;
    for (let i = 0; i < n; i++) {
      if (arr[i] !== a && arr[i] !== b) continue;
      if (arr[i] === run) cnt++; else { run = arr[i]; start = i; cnt = 1; }
      if (cnt === SHAFT.HOLD && run !== cur) { if (cur != null) on(start, cur, run); cur = run; }
    }
  };
  commits(knot, 0, 2, (i, from, to) => ev(i, to === 2 ? 'knotIn' : 'knotOut'));
  commits(free, 0, 1, (i, from, to) => { if (to === 0) ev(i, 'wentIn'); else if (vis[i] >= SHAFT.OUT_VIS) ev(i, 'pulledOut'); });
  events.sort((p, q) => p.t - q.t);
  const t = grid ? Float64Array.from(T, (x) => snapT(x, grid)) : T, full = fin(calib?.out) ? 'mark' : rec.full || 'relative';
  const axis = (i) => { if (!fin(ex[i]) || !fin(bx[i])) return null; const ux = (ex[i] - bx[i]) * aspect, uy = ey[i] - by[i], m = Math.hypot(ux, uy) || 1; return [ux / m, uy / m]; };
  return {
    name: s.name, rec, k, t, vis, conf, len, state, why, free, knot, knotAt, knotFrom, knotWhy, knotVis: knotAt != null ? toVis(knotAt) : null,
    toLen, toVis, full, bx, by, ex, ey, receiver: rk ? rk.slice(4) : null, events, geo: G,
    frame: (i) => ({ t: t[i], vis: vis[i], conf: conf[i], full, state: state[i], why: why[i], base: [bx[i], by[i]], entry: [ex[i], ey[i]], axis: axis(i),
      knotAt, knot: knot[i] < 0 ? null : ['out', 'at', 'in'][knot[i]], tipFree: free[i] < 0 ? null : !!free[i], hidden: state[i] === 'hidden', lost: state[i] === 'lost' }),
  };
}

/** What 100 % visible means for state st, in words (the strip's tooltip; paw-4c48.7): the owner's mark, else the sidecar's
 *  full length (the 90th percentile of the frames with the tip free, or, never seen free, the 98th of the confident ones). */
export function fullText(st) {
  if (!st) return '';
  const w = fin(st.rec?.l_full_w) ? ` (${st.rec.l_full_w} shaft widths)` : '';
  return st.full === 'mark' ? 'full length: your "fully out" mark'
    : st.full === 'seen' ? `full length: as long as it is seen with the tip free${w}`
      : `full length: relative, the longest it is seen${w}; the tip is never seen free: mark "fully out here" where it is`;
}

/** The frame of state st nearest time t (index) | -1 (outside its frames by more than 60 ms). */
export function stateIndex(st, t) {
  const T = st?.t;
  if (!T?.length || t < T[0] - 60 || t > T[T.length - 1] + 60) return -1;
  const i = lowerBound(T, t);
  return i > 0 && (i >= T.length || t - T[i - 1] < T[i] - t) ? i - 1 : Math.min(i, T.length - 1);
}
/** Frame i of st in words: "38 % visible, knot outside, tip in, confidence 0.7; why hidden: ...". */
export function stateText(st, i) {
  const f = st.frame(i);
  if (f.state === 'lost') return `lost: ${f.why}`;
  const knot = f.knot ? { out: 'knot outside', at: 'knot at the entrance', in: 'knot inside' }[f.knot] : st.knotAt == null ? 'no knot place' : 'knot unknown';
  const tip = f.tipFree == null ? 'tip unknown' : f.tipFree ? 'tip free' : 'tip in';
  const head = f.state === 'hidden' ? 'hidden: inferred fully in' : `${Math.round(100 * f.vis)} % visible${f.state === 'low' ? ' (unsure)' : ''}`;
  return `${head}, ${knot}, ${tip}, confidence ${f.conf.toFixed(1)}${f.why ? `; ${f.state === 'low' ? 'why unsure' : 'why hidden'}: ${f.why}` : ''}`;
}

// ---- the scorecard (paw-4c48: what later stages are gated on). A pure function of the state, the accepted script and the
//      owner's truth marks; unit-tested on synthetic channels (test/shaft-state.test.mjs). ----
const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.round(p * (s.length - 1))] : NaN; };
function pearson(x, y) {
  const m = x.length;
  if (m < 10) return NaN;
  let mx = 0, my = 0;
  for (let i = 0; i < m; i++) { mx += x[i]; my += y[i]; }
  mx /= m; my /= m;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < m; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}
/** Detected times D vs truth times Tr: nearest pairs first within tol, each used once. -> {truth, found, matched, medianMs
 *  (detected - truth, signed), misses, falseAlarms}. */
export function matchEvents(D, Tr, tol = SHAFT.MATCH_MS) {
  const pairs = [];
  D.forEach((d, i) => Tr.forEach((t, j) => { if (Math.abs(d - t) <= tol) pairs.push([Math.abs(d - t), i, j, d - t]); }));
  pairs.sort((a, b) => a[0] - b[0]);
  const ud = new Set(), ut = new Set(), err = [];
  for (const [, i, j, e] of pairs) if (!ud.has(i) && !ut.has(j)) { ud.add(i); ut.add(j); err.push(e); }
  return { truth: Tr.length, found: D.length, matched: err.length, medianMs: err.length ? Math.round(median(err)) : null, misses: Tr.length - err.length, falseAlarms: D.length - err.length };
}

/**
 * One shot's scorecard. st = shaftState of the run scene under it (null: no shaft pass), [t0, t1) = the shot, script = the
 * accepted stroke ([{at, pos}]), truth = [{k, t}] (TRUTH_KINDS), calib = the shot's derive.shaft. -> {frames, seen, hidden,
 * low, lost (shares), lostBy {reason: share}, depth {r (signed, the largest |r| within +-MAX_LAG_MS), lagMs (+ = the shaft later), swing (p5-p95
 * of vis / of pos), n} | null, depthWhy, events {kind: matchEvents}, knot {at, from, sane, why}, calib {out, hilt}, source,
 * diagnosis [one line per bad stretch, then the scene's own notes]}.
 */
export function shaftScore(st, { t0 = -Infinity, t1 = Infinity, script = [], truth = [], calib = null } = {}) {
  const cal = { out: fin(calib?.out), hilt: fin(calib?.hilt) };
  if (!st) return { frames: 0, seen: 0, hidden: 0, low: 0, lost: 0, lostBy: {}, depth: null, depthWhy: 'no shaft pass', events: {}, knot: null, calib: cal, source: null, diagnosis: ['no shaft pass on this shot: paint the penis and re-track'] };
  const I = [];
  for (let i = 0; i < st.t.length; i++) if (st.t[i] >= t0 && st.t[i] < t1) I.push(i);
  const n = I.length || 1, cnt = { seen: 0, hidden: 0, low: 0, lost: 0 }, lostBy = {}, r3 = (x) => Math.round(x * 1000) / 1000;
  for (const i of I) { cnt[st.state[i]]++; if (st.state[i] === 'lost') lostBy[st.why[i]] = (lostBy[st.why[i]] || 0) + 1; }
  for (const k of Object.keys(lostBy)) lostBy[k] = r3(lostBy[k] / n);
  const fm = I.length > 1 ? median(I.slice(1).map((i, q) => st.t[i] - st.t[I[q]])) : 1000 / 30;
  // depth agreement: confident frames against the script (pos / 100) inside its first..last point
  let depth = null, depthWhy = '';
  const sc = (script || []).filter((p) => p.at >= t0 - 2000 && p.at <= t1 + 2000);
  if (sc.length < 2) depthWhy = 'no accepted script over this shot';
  else {
    const pos = (t) => {
      if (t < sc[0].at || t > sc[sc.length - 1].at) return NaN;
      let j = 1; while (j < sc.length - 1 && sc[j].at < t) j++;
      const a = sc[j - 1], b = sc[j];
      return (a.pos + ((b.pos - a.pos) * (t - a.at)) / (b.at - a.at || 1)) / 100;
    };
    const S = I.map((i) => pos(st.t[i])), V = I.map((i) => (st.state[i] === 'seen' ? st.vis[i] : NaN)), L = Math.round(SHAFT.MAX_LAG_MS / fm);
    let best = null;
    for (let lag = -L; lag <= L; lag++) {   // V[q] against S[q - lag]: lag > 0 = the shaft reads later than the script
      const x = [], y = [];
      for (let q = 0; q < I.length; q++) { const p = q - lag; if (p >= 0 && p < I.length && V[q] === V[q] && S[p] === S[p]) { x.push(V[q]); y.push(S[p]); } }
      const r = pearson(x, y);
      if (r === r && (!best || Math.abs(r) > Math.abs(best.r))) best = { r, lag, m: x.length };
    }
    if (!best) depthWhy = 'fewer than 10 confident frames under the script';
    else {
      const x0 = [], y0 = [];
      for (let q = 0; q < I.length; q++) if (V[q] === V[q] && S[q] === S[q]) { x0.push(V[q]); y0.push(S[q]); }
      const dy = pct(y0, 0.95) - pct(y0, 0.05), sw = dy > 1e-6 ? (pct(x0, 0.95) - pct(x0, 0.05)) / dy : NaN;
      depth = { r: Math.round(best.r * 100) / 100, lagMs: Math.round(best.lag * fm), swing: sw === sw ? Math.round(sw * 100) / 100 : null, n: best.m };
    }
  }
  const events = {};
  for (const kind of EVENT_KINDS) events[kind] = matchEvents(st.events.filter((e) => e.kind === kind && e.t >= t0 && e.t < t1).map((e) => e.t), (truth || []).filter((m) => m.k === kind && m.t >= t0 && m.t < t1).map((m) => m.t));
  const knot = { at: st.knotAt == null ? null : Math.round(st.knotAt * 100) / 100, from: st.knotFrom, sane: st.knotAt != null, why: st.knotWhy };
  const diagnosis = [];
  for (let q = 0; q < I.length;) {
    const i = I[q], s = st.state[i], w = st.why[i];
    let e = q;
    while (e + 1 < I.length && st.state[I[e + 1]] === s && st.why[I[e + 1]] === w) e++;
    const dur = st.t[I[e]] - st.t[i] + fm;
    if (s !== 'seen' && dur >= SHAFT.STRETCH_MS) diagnosis.push(s === 'hidden' ? `shaft hidden for ${sec(dur)} from ${sec(st.t[i])} (inferred fully in)` : s === 'low' ? `low confidence for ${sec(dur)} from ${sec(st.t[i])}` : `lost for ${sec(dur)} from ${sec(st.t[i])}: ${w}`);
    q = e + 1;
  }
  const rec = st.rec || {};
  if (rec.source !== 'sam') diagnosis.push(`no SAM reading: points fallback only${rec.note ? ` (${rec.note})` : ''}`);
  if (rec.drift > 0) diagnosis.push(`SAM drifted in ${rec.drift} of ${rec.chunks ?? '?'} chunks (re-prompted)`);
  if (rec.bound >= 0.1) diagnosis.push(`mask bound by too few points on ${Math.round(100 * rec.bound)} % of frames (read as unsure)`);   // paw-4c48.17
  if (st.full === 'relative') diagnosis.push('tip never seen free, so the full length is relative: mark "fully out here" on a frame where it is');
  if (st.knotWhy) diagnosis.push(`knot place rejected: ${st.knotWhy}`);
  if (!st.receiver) diagnosis.push('no receiving part painted on the partner: tip free / went in / pulled out unknown');
  return { frames: I.length, seen: r3(cnt.seen / n), hidden: r3(cnt.hidden / n), low: r3(cnt.low / n), lost: r3(cnt.lost / n), lostBy, depth, depthWhy, events, knot, calib: cal, source: rec.source || null, diagnosis };
}

/** The shots' scorecards pooled: shares weighted by frames, events summed (the median of the per-shot medians), median r. */
export function scoreOverall(cards) {
  const c = cards.filter((x) => x.frames), N = c.reduce((a, x) => a + x.frames, 0) || 1, w = (k) => Math.round((1000 * c.reduce((a, x) => a + x[k] * x.frames, 0)) / N) / 1000;
  const events = {}, sum = (e, k) => e.reduce((a, x) => a + x[k], 0);
  for (const kind of EVENT_KINDS) {
    const e = cards.map((x) => x.events?.[kind]).filter(Boolean), ms = e.map((x) => x.medianMs).filter((x) => x != null);
    events[kind] = { truth: sum(e, 'truth'), found: sum(e, 'found'), matched: sum(e, 'matched'), medianMs: ms.length ? Math.round(median(ms)) : null, misses: sum(e, 'misses'), falseAlarms: sum(e, 'falseAlarms') };
  }
  const rs = cards.map((x) => x.depth?.r).filter((x) => x != null);
  return { shots: cards.length, withShaft: c.length, frames: c.reduce((a, x) => a + x.frames, 0), seen: w('seen'), hidden: w('hidden'), low: w('low'), lost: w('lost'), medianR: rs.length ? median(rs) : null, events,
    knotsSane: cards.filter((x) => x.knot?.sane).length, knotsRejected: cards.filter((x) => x.knot?.why).length, calibrated: cards.filter((x) => x.calib.out || x.calib.hilt).length };
}

/** One compact line of a scorecard (the strip's readout). */
export function scoreLine(c) {
  if (!c?.frames) return 'no shaft pass';
  const ev = EVENT_KINDS.map((k) => c.events[k]).filter((e) => e?.truth), m = ev.reduce((a, e) => a + e.matched, 0), tr = ev.reduce((a, e) => a + e.truth, 0);
  return `${Math.round(100 * c.seen)}% seen · ${Math.round(100 * c.hidden)}% hidden · r ${c.depth ? c.depth.r.toFixed(2) : '–'}${tr ? ` · marks ${m}/${tr}` : ''}`;
}

/** One event kind's cell: "matched/truth ±ms faN" | '-'. */
export const eventCell = (e) => (e && (e.truth || e.found) ? `${e.matched}/${e.truth}${e.medianMs != null ? ` ${e.medianMs >= 0 ? '+' : ''}${e.medianMs} ms` : ''}${e.falseAlarms ? ` fa ${e.falseAlarms}` : ''}` : '-');

/** rows [{label, card}] + overall -> a plain text table (tab separated, one row per shot, its diagnosis lines under it). */
export function scoreTable(rows, overall) {
  const p = (x) => `${Math.round(100 * x)}%`;
  const out = [['shot', 'frames', 'seen', 'hidden', 'low', 'lost', 'r', 'lag ms', 'swing', ...EVENT_KINDS.map((k) => KIND_TEXT[k]), 'knot', 'out/hilt'].join('\t')];
  for (const { label, card: c } of rows) {
    out.push(!c.frames ? [label, 0].join('\t') : [label, c.frames, p(c.seen), p(c.hidden), p(c.low), p(c.lost), c.depth?.r ?? '-', c.depth?.lagMs ?? '-', c.depth?.swing ?? '-', ...EVENT_KINDS.map((k) => eventCell(c.events[k])),
      c.knot?.sane ? `${c.knot.at} (${c.knot.from})` : c.knot?.why ? 'rejected' : '-', `${c.calib.out ? 'out' : '-'}/${c.calib.hilt ? 'hilt' : '-'}`].join('\t'));
    for (const d of c.diagnosis) out.push(`\t${d}`);
  }
  if (overall) out.push(['overall', overall.frames, p(overall.seen), p(overall.hidden), p(overall.low), p(overall.lost), overall.medianR ?? '-', '', '', ...EVENT_KINDS.map((k) => eventCell(overall.events[k])), `${overall.knotsSane} sane, ${overall.knotsRejected} rejected`, `${overall.calibrated} shots`].join('\t'));
  return out.join('\n');
}

// ---- paw-4c48.8: the RAIL, the position bar laid along the shaft (features/video/PosBar.svelte "on the shaft"). Per shot a context
//      (the shaft group, its geometry, the full length, the owner's marks), per frame (time-interpolated) the rail's two ends:
//      pos 0 at the hilt (the base, or where the shaft reads "hilted" by the owner's mark), pos 100 at the tip (its full length,
//      or the "fully out" mark), and the measured entry. ----
export const RAIL_MIN = 0.3;   // confident over this share of the run scene: the rail is shown there
/** paw-4c48.10: the shaft's readings of its visible share: 'sam' (the shaft pass's measured entry: the diamond as it was) |
 *  'points' (the share of the penis group's members still visible, against the most visible on any frame of the scene: on the
 *  owner's shots it follows his strokes where SAM does not, paw-72z). */
export const READINGS = ['sam', 'points'];
/** Run scene k's rail context -> {name, G (its L / sc: the reading's length drawn at the slow zoom), conf (per G frame), Lf (the
 *  full length at zoom 1, frame heights), a, b (the reading at hilted / fully out: depthScale), scale (how they were set), share,
 *  reading} | {why} (no usable shaft here, in words). reading 'points': the share of the members visible (conf 1 on a frame with
 *  its own member fit, else 0), the full length their extent; 'sam': SAM's visible share of its full length. motion: a stroke
 *  signal ({t, v}: fused) the extremes must agree with. */
export function railContext(run, k, calib = null, { aspect = 16 / 9, reading = 'sam', motion = null, part = null } = {}) {
  const s = shaftOf(run, k, { points: true, aspect, part }), G = s && shaftGeom(run, k, s.name, { aspect });
  if (!G) return { why: part ? `no ${partWord(part)} read in this shot` : 'no shaft read in this shot' };
  const what = part ? `the ${partWord(part)} points` : 'the penis points';
  // paw-4c48: lengths in a unit that does not breathe with the stroke (the reading's own share), drawn at a slow camera zoom (the
  // members' fit scale low-passed well below the stroke rate: per frame it follows the stroke on the owner's shots and cancelled
  // it, paw-4c48.11); depth through depthScale (the extremes that agree with the motion; the owner's marks win)
  const n = G.t.length, z = slowZoom(G.t, G.sc);
  let x, conf, Lf, share;
  if (reading === 'points') {
    if (G.from !== 'members' || !(G.span > 0) || G.nMax < 6) return { why: G.from !== 'members' ? "no visible-points reading here (the run does not carry its points' groups)" : `no visible-points reading here (fewer than 6 of ${what})` };
    conf = Float64Array.from(G.src, (q) => (q === 2 ? 1 : 0)); x = Float64Array.from(G.n, (q) => q / G.nMax); Lf = G.span;
    share = conf.reduce((p, q) => p + q, 0) / n;
    if (share < RAIL_MIN) return { why: `no ${part ? partWord(part) : 'shaft'} read in this shot (${what} tracked on ${Math.round(100 * share)} % of it)` };
  } else {
    conf = onT(run.channels[`sem_${s.name}_in_conf`], G.t); x = onT(lenOf(run, s.name, aspect), G.t);
    const wy = onT(run.channels[`sem_${s.name}_why`], G.t);
    for (let i = 0; i < n; i++) if (whyBad(wy[i])) conf[i] = 0;   // paw-4c48.17: bound / hidden / few / lost: unsure, never calibrate
    const fl = [];
    let ok = 0;
    for (let i = 0; i < n; i++) {
      if (!(conf[i] >= CONF_MIN)) continue;
      ok++;
      if (G.src[i] && x[i] > 0.05 && G.L[i] > 0) fl.push(G.L[i] / x[i] / z[i]);   // the full length this frame implies (at the slow zoom)
    }
    share = ok / n;
    if (share < RAIL_MIN || fl.length < 3) return { why: `no ${part ? partWord(part) : 'shaft'} read in this shot (confident on ${Math.round(100 * share)} % of it)` };
    Lf = median(fl);
  }
  const mark = (t) => { if (!fin(t)) return NaN; const j = stateIndex(G, t); return j >= 0 && Math.abs(G.t[j] - t) <= 60 && conf[j] >= CONF_MIN ? x[j] : NaN; };
  const ds = depthScale(G.t, x, (i) => conf[i] >= CONF_MIN && G.src[i] > 0, { motion, hilt: mark(calib?.hilt), out: mark(calib?.out) });
  const L = Float64Array.from(x, (q, i) => (fin(q) ? q * Lf * z[i] : G.L[i]));
  return { name: s.name, G: { ...G, L, sc: z }, conf, Lf, a: ds.a, b: ds.b, scale: ds.from, share, reading, ...(part ? { part } : {}) };
}
/** The rail at time t -> {D, O (normalised ends: pos 0 hilt, pos 100 tip), entry (the measured entry), w (frame heights), held
 *  (no measured geometry here), low (an unsure reading)} | null (outside the scene). */
export function railAt(ctx, t, aspect = 16 / 9) {
  const g = ctx?.G && geomAt(ctx.G, t, aspect);
  if (!g) return null;
  const Lf = ctx.Lf * g.sc, at = (f) => [g.base[0] + (f * Lf * g.u[0]) / aspect, g.base[1] + f * Lf * g.u[1]];
  const i = stateIndex(ctx.G, t);
  return { D: at(ctx.a), O: at(ctx.b), entry: g.entry, w: g.w, held: g.held, low: !(ctx.conf[i] >= CONF_MIN) };
}
/** paw-4c48.10: the hollow diamond's reading on rail r (railAt): where the measured entry sits between pos 0 (D, hilted) and
 *  100 (O, fully out), clamped as it is drawn (PosBar: posOn on the untrimmed bar) | NaN. */
export function railPos(r, aspect = 16 / 9) {
  if (!r?.entry) return NaN;
  const dx = (r.O[0] - r.D[0]) * aspect, dy = r.O[1] - r.D[1], l2 = dx * dx + dy * dy;
  return l2 > 0 ? Math.max(0, Math.min(100, (100 * ((r.entry[0] - r.D[0]) * aspect * dx + (r.entry[1] - r.D[1]) * dy)) / l2)) : NaN;
}
