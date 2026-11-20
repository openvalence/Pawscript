// fx.js -- modifiers (paw-ef73.20): ONE object per event on the timeline, laid over the motion, live until Shift+A /
// Flatten. A modifier is { id, kind, t0, t1, params?, muted?, baked?, link?, label? } (doc.fx; the .pawproj `modifiers`).
// The EVENT kinds (`event`: orgasm, knotting, throbbing, idle) are marked in any tab (the Scenes tab is where they are
// made) and are also what the scene-level consumers read (timeline/mods.js withMods: Autorange's bands, the sidecar's
// climax / idle labels, Detect cumshots; a push / pull reads as 'insertion' / 'pullout', tagIdOf). The other kinds only
// modify strokes that exist (Reshape, Spurt): offered in the Refine tab only. applyFx(base, fx, ctx) re-shapes the base inside each
// modifier's span from the base's OWN turning points, so the cadence stays the video's:
//   knotting  paw-afoe: ONE set of levels for every mode, the knot-stroke recipe's (lo full depth, knotIn the catch,
//             press the knot depth, knotOut the tie, popTo where a pop out lands, hi the top). Mode 'cycles': the recipe
//             (timing 'auto') fitted onto the base's turns, one knot cycle per tracked bottom-top-bottom; 'single' = ONE
//             knot in over the span: from the tracked level to the catch, a slower press to the knot depth, the pop to
//             full depth in one frame, a drift up to the tie, then held there or (pullOut) pulled out through popTo back
//             onto the trace; 'unknot' = the knot coming OUT: held at the tie, a slow pull to the catch (tugs: small
//             slips back in), the pop out onto popTo, a settle at `to`. The mode is stored when the modifier is made
//             (autoKnotMode); one stored without it resolves it from the strokes when applied.
//             fitKnotIn() / fitKnotOut() read the push / pull and pop timing off the tracked samples.
//             paw-ajvq, mode 'none' (made as one: KNOT_PUSH / KNOT_PULL; no auto rule picks it): ONE slow push or pull,
//             no pop: from `from` (null = the level the trace is at when the span starts) eased onto `to` (null = the
//             trace at the span end), arriving at popAt after `push` of the span, held there (pushKeys).
//             insertionScript() is the same push (or One knot's knot-in) for an untracked scene (the bridges);
//             fitInsertion() reads the push timing
//   idle      a hold: the level the trace is at when the span starts, held to its end
//   orgasm    the base's turn times kept: depth pulled toward [lo, hi], a flutter between turns only where the base
//             is fast, eased in and out over half a stroke (edgeMsOf)
//   shape     "Reshape": the path between every two base turns re-drawn from a stroke profile (ease at departure and
//             arrival, dwell at top / bottom, depth lo / hi; inFrac, set by hand only, moves the tops). fitProfile()
//             reads the profile off the tracked samples, so the fit is just a param preset.
//   spurt     a point (t1 === t0), the inner event of an orgasm (one per cumshot): a ringing AROUND the trace at the
//             frame of the shot: amount deeper (on the frame), then amount x decay shallower, then deeper again ...,
//             `count` half-swings, back on the trace; several spurts a few hundred ms apart are the burst train
//   throbbing a heartbeat on the trace over the span: every `period` ms a fast dip of `amount` (attack), a slower return
//             (release), held until the next beat; one-sided (dir 'dip' = deeper, 'swell' = shallower), relative to the
//             trace like a spurt; `double` adds the lub-dub's second dip at +120 ms; seeded
//             jitter (its build / fade is the strength envelope). A single throb is a throbbing range one beat long (singleThrob)
// paw-xu4v, the kinds that ride on the trace (orgasm, throbbing, spurt):
//   base mix  `mix` (0..100 %): the trace under the span first pulled toward its center line (its mean over one stroke),
//             100 = the strokes as tracked, 0 = held at the center line (the strokes may be the orgasm shaking the
//             tracking); eased back to the trace at the span's edges (baseMix). Spurt and throbbing are offsets ADDED
//             onto that trace, sampled at the union of its points and the offset's keys, so no stroke is dropped
// Linked modifiers (`link`: a group id, same kind) share their params (fx-edit setFxParams writes them to every member);
// spans stay their own. applyFx does not care: each member carries its own copy.
// paw-r9nh, every span kind:
//   edges     the kinds that REPLACE the trace (knotting, idle, Reshape) ease in from the trace and back onto it over
//             the base's half-stroke at each edge (150..800 ms, longer when the cap needs it, at most a third of the
//             span): continuous in position, the trace's own speed at the edge (blendFx). The kinds that ride on the
//             trace (orgasm: its own half-stroke ease; throbbing, spurt: offsets from the trace) were continuous already.
//   strength  paw-ajvq: the ONE envelope per modifier (ENV params: envFrom -> envPeak over envIn of the span, envPeak ->
//             envTo over envOut) and `follow` (0..1: the strength follows the base's stroke travel there, so it breathes
//             with the motion): out = trace + strength x (modifier - trace). Flat (the default) = the modifier as before.
//             No kind has a build / fade of its own (an older rampIn / rampOut is read as envIn / envOut, fxParams)
//   timing    with ctx.grid (the player's clock) a knot's pop and each throb dip land on a frame start.
// Composition order (stable): live modifiers by t0 (ties: list order), each on the result of the ones before it.
// paw-xu4v: ONE limiter runs last (limitSpans) with the device's limits (ctx.maxSpeed, ctx.minGapMs: lib/finish.js
// fxCtxOf passes the active profile's): times stay, amplitude gives way. No kind does its own speed math.
// Outside every span the base comes back byte-identical (the same action objects). Pure and deterministic.
// pos 0 = deepest, 100 = out.

import { lowerBound, posAt } from './core/script.js';
import { frameStartOf, frameLen } from './lane.js';
import { applyPlan } from './gen/plan.js';
import { resolveSegment, recipeSchema, KINDS } from './gen/recipes.js';
import { TREMOR_FIT } from './gen/generators.js';
import { DEFAULTS, clamp, hashSeed, mulberry32, median, joinPlan, limitSpeed } from './gen/util.js';

const N = (key, label, dflt, min, max, step, unit, extra) => ({ key, label, type: 'number', default: dflt, min, max, step, ...(unit ? { unit } : {}), ...extra });
const ASIS = { optional: true };   // null = as tracked
/** paw-xu4v: the base mix (dry / wet) of the kinds that ride on the trace; defaults per kind (see BASE_MIX). */
const MIX = (dflt) => N('mix', 'Base', dflt, 0, 100, 1, '%');
export const BASE_MIX = Object.freeze({ orgasm: 50, throbbing: 0, spurt: 100 });
// a spurt: a ringing about the trace (spurtKeys); `vel` scales its swing (a marker's own, Detect cumshots: its score)
const SPURT = [
  N('amount', 'Swing about the trace', 25, 0, 100, 1, 'pos'), N('rise', 'Each swing deeper in', 50, 20, 500, 1, 'ms'),
  N('fall', 'Each swing shallower in', 50, 20, 500, 1, 'ms'), N('hold', 'Hold at each swing', 0, 0, 1000, 1, 'ms'),
  { key: 'count', label: 'Half-swings (deep, out, deep, ...)', type: 'int', default: 3, min: 1, max: 12, step: 1 },
  N('decay', 'Each swing of the one before', 0.75, 0.1, 1, 0.01, 'x'), N('vel', 'Velocity (scales the swing)', 1, 0, 2, 0.05, 'x'), MIX(BASE_MIX.spurt),
];
/** paw-d1g7: the spurt params an orgasm holds for its markers (the spurts inside its span): one shape per orgasm. */
export const MARKER_KEYS = Object.freeze(['amount', 'rise', 'fall', 'count', 'decay']);
// paw-d1g7, the orgasm container: a depth band, the reference tremor anchored deep (TREMOR_FIT), the markers' spurt shape
const ORGASM = [
  N('lo', 'Deep end', 0, 0, 100, 1, 'pos'), N('hi', 'Depth ceiling', 40, 0, 100, 1, 'pos'),
  N('tremor', 'Tremor depth', TREMOR_FIT.peak, 0, 40, 1, 'pos'),
];
const KNOT_RECIPE = 'knot-pop-stroke';
const KNOT_MODES = ['cycles', 'single', 'unknot', 'none'];
// the knot recipe's own keys the knotting reads (the plan's timing, fade and jitter keys stay at the recipe's defaults)
const KNOT_KEEP = new Set(['lo', 'hi', 'knotOut', 'popTo', 'knotIn', 'press', 'fPull', 'fPopOut', 'fTop', 'fDown', 'fPress', 'fPopIn', 'popScale', 'variation']);
// knotting modes 'single' and 'unknot': timing as shares of the span; the levels are the recipe's (KNOT_RECIPE). Defaults:
// the owner's reference knot cycle (paw-afoe, 10 cycles of mean 1129 ms): push 550 ms = 0.49 of it (the press 188 ms =
// 0.17), the pop at its end, the drift to the tie 308 ms = 0.27, the pull-out 229 ms = 0.20
const KNOT_IN = [
  { key: 'mode', label: 'Knot mode', type: 'choice', default: null, choices: KNOT_MODES, optional: true },
  N('from', 'Starts from', null, 0, 100, 1, 'pos', ASIS),
  N('push', 'Push takes', 0.49, 0.05, 1, 0.01, 'span'), N('pressTakes', 'Press takes', 0.17, 0, 1, 0.01, 'span'),
  N('popAt', 'The knot pops at', 0.49, 0.05, 1, 0.01, 'span'), N('settle', 'Settles over', 0.27, 0, 0.5, 0.01, 'span'),
  N('pullOut', 'Pull-out takes (0: held at the tie)', 0.2, 0, 0.5, 0.01, 'span'),
  // mode 'unknot' (also popAt, settle; the tie = knotOut, it gives at the catch = knotIn, the pop lands on popTo)
  N('pull', 'Pull takes', 0.35, 0.05, 1, 0.01, 'span'),
  { key: 'tugs', label: 'Tugs before it gives', type: 'int', default: 2, min: 0, max: 6, step: 1 },
  N('tugAmp', 'Each tug slips back in by', 4, 0, 30, 1, 'pos'),
  N('to', 'Ends at (pulled out)', 100, 0, 100, 1, 'pos', ASIS),
];
const KNOT_IN_KEYS = new Set(KNOT_IN.map((s) => s.key));
/** paw-ajvq: mode 'none' (one push or pull, no pop; was the Insertion / Pull-out kinds) as made: a push ends at the level
 *  set's full depth, a pull out at 100. Its timing defaults are its own (NONE_TIMING: the move fills the span). */
export const KNOT_PUSH = Object.freeze({ mode: 'none', to: 0 });
export const KNOT_PULL = Object.freeze({ mode: 'none', to: 100 });
const NONE_TIMING = { push: 0.85, popAt: 0.9 };   // experiments/knotin
/** A knotting in mode 'none' (one push / pull): its own params say it (no auto rule picks it). */
export const isPushFx = (e) => e?.kind === 'knotting' && e.params?.mode === 'none';
/** The scene-level tag a modifier reads as (timeline/mods.js withMods): a push 'insertion', a pull 'pullout', else its kind. */
export const tagIdOf = (e) => (isPushFx(e) ? ((e.params.to ?? 100) > 50 ? 'pullout' : 'insertion') : e.kind);

/** The strength envelope every span kind has (paw-r9nh): levels 0..1 (1 = the modifier in full), shares of the span. */
export const ENV = [
  N('envFrom', 'Strength at the start', 0, 0, 1, 0.01, 'x'), N('envIn', 'Builds over', 0, 0, 1, 0.01, 'span'),
  N('envPeak', 'Strength', 1, 0, 1, 0.01, 'x'),
  N('envOut', 'Fades over', 0, 0, 1, 0.01, 'span'), N('envTo', 'Strength at the end', 0, 0, 1, 0.01, 'x'),
  N('follow', 'Follows the strokes', 0, 0, 1, 0.01, 'x'),
];
const ENV_KEYS = new Set(ENV.map((s) => s.key));
/** The envelope's starting shapes (FxEditor's presets). */
export const ENV_PRESETS = {
  flat: { envFrom: 0, envIn: 0, envPeak: 1, envOut: 0, envTo: 0 },
  build: { envFrom: 0, envIn: 0.8, envPeak: 1, envOut: 0, envTo: 0 },
  fade: { envFrom: 0, envIn: 0, envPeak: 1, envOut: 0.8, envTo: 0 },
  swell: { envFrom: 0, envIn: 0.5, envPeak: 1, envOut: 0.5, envTo: 0 },
};
/** Strength at u (0..1 of the span): envFrom -> envPeak over envIn, envPeak, envPeak -> envTo over envOut (eased; the
 *  shares scaled down when they add up past the span). */
export function strength(u, p) {
  const a = clamp(p.envIn ?? 0, 0, 1), b = clamp(p.envOut ?? 0, 0, 1), k = a + b > 1 ? 1 / (a + b) : 1, i = a * k, o = b * k, pk = p.envPeak ?? 1;
  if (i > 0 && u < i) return (p.envFrom ?? 0) + (pk - (p.envFrom ?? 0)) * smooth(u / i);
  if (o > 0 && u > 1 - o) return pk + ((p.envTo ?? 0) - pk) * smooth((u - (1 - o)) / o);
  return pk;
}
/** The modifier acts in full everywhere in its span (no envelope, no follow). */
export const envFlat = (p) => !(p.envIn > 0) && !(p.envOut > 0) && (p.envPeak ?? 1) === 1 && !(p.follow > 0);

/** kind -> { label, color, schema, event?, point?, tip }. event = marked in any tab (prep for tracking, and what the scene
 *  consumers read); the rest only modify strokes that exist (Refine). Order = menu order. knotting is its plan recipe's
 *  schema (timing forced auto). Params with `optional` may be null: "as tracked". Every span kind ends with ENV. */
export const FX_KINDS = {
  orgasm: { label: 'Orgasm', color: KINDS.orgasm.color, event: true, schema: [...ORGASM, MIX(BASE_MIX.orgasm), ...SPURT.filter((s) => MARKER_KEYS.includes(s.key))],
    tip: 'Orgasm: where the cumshots happen, one spurt each (U)' },
  knotting: { label: 'Knotting', color: KINDS.knotting.color, event: true, get schema() { return [...recipeSchema(KNOT_RECIPE).filter((p) => KNOT_KEEP.has(p.key)), ...KNOT_IN]; },
    tip: 'Knotting: knot cycles, one knot, the knot out, or a push' },
  // a heartbeat over the span (the owner's reference: 100 -> 90 in ~42 ms, back in ~290 ms, every 667 ms = 90 bpm)
  throbbing: { label: 'Throbbing', color: '#e0607e', event: true, schema: [
    N('period', 'Beat every (ms; 60000 / bpm)', 667, 250, 2000, 1, 'ms'), N('amount', 'Each beat dips by', 10, 0, 40, 1, 'pos'),
    N('attack', 'The dip takes', 40, 10, 500, 1, 'ms'), N('release', 'The return takes', 290, 20, 1500, 1, 'ms'),
    N('double', 'Second beat (lub-dub) of the first', 0, 0, 1, 0.05, 'x'),
    N('jitter', 'Period varies by up to', 0, 0, 0.2, 0.01, 'x'),
    { key: 'dir', label: 'Direction', type: 'choice', default: 'dip', choices: ['dip', 'swell'] }, MIX(BASE_MIX.throbbing),
  ], tip: 'Throbbing: a heartbeat on the strokes' },
  idle: { label: 'Idle', color: '#A0A3A8', event: true, schema: [],
    tip: 'Idle: nothing happening, held at its starting level' },
  // a point (t1 === t0): one cumshot, timed to the frame; several in a row are the burst train
  spurt: { label: 'Spurt', color: '#ff7ac8', point: true, schema: SPURT, tip: 'Spurt: one cumshot on its frame (U)' },
  shape: { label: 'Reshape', color: '#5fb3a8', schema: [
    N('inFrac', 'Share of each stroke spent going in', null, 0.1, 0.9, 0.01, '', ASIS),
    N('accelIn', 'Ease leaving a turn', 0, -1, 1, 0.01),
    N('accelOut', 'Ease arriving at a turn', 0, -1, 1, 0.01),
    N('dwellTop', 'Dwell at the top', 0, 0, 0.6, 0.01, 'half'),
    N('dwellBottom', 'Dwell at the bottom', 0, 0, 0.6, 0.01, 'half'),
    N('lo', 'Deep end', null, 0, 100, 1, 'pos', ASIS), N('hi', 'Out end', null, 0, 100, 1, 'pos', ASIS),
    // the band at the span's end (null = lo / hi): the depth band slides linearly over the span (Autorange's build-up, ease to rest)
    N('loEnd', 'Deep end at the span end', null, 0, 100, 1, 'pos', ASIS), N('hiEnd', 'Out end at the span end', null, 0, 100, 1, 'pos', ASIS),
  ], tip: 'Reshape: ease, dwell and depth between the turns' },
};
export const FX_KIND_IDS = Object.keys(FX_KINDS);
export const fxSchema = (kind) => (!FX_KINDS[kind] ? [] : FX_KINDS[kind].point ? FX_KINDS[kind].schema : [...FX_KINDS[kind].schema, ...ENV]);
/** The event kinds (marked in any tab) and the kinds that only modify existing strokes (Refine), in menu order. */
export const EVENT_KINDS = FX_KIND_IDS.filter((k) => FX_KINDS[k].event);
export const REFINE_KINDS = FX_KIND_IDS.filter((k) => !FX_KINDS[k].event);
/** Why a Refine kind is greyed outside Refine (the owner: "used to modify existing strokes"). */
export const REFINE_WHY = 'modifies existing strokes: add it in Refine';

/** An effect's params: schema defaults, its own values, numbers held to the schema (stored params are untrusted). */
export function fxParams(e) {
  const p = {};
  for (const s of fxSchema(e.kind)) p[s.key] = s.default;
  for (const [k, v] of Object.entries(e.params || {})) if (v !== undefined) p[k] = v;
  // paw-ajvq: one envelope per modifier: an older orgasm's / throbbing's own build / fade (rampIn / rampOut) is the
  // strength's build / fade unless that is set; edgeMs is gone (the edges ease over the base mix's half-stroke)
  if (e.params?.rampIn > 0 && e.params.envIn == null) p.envIn = e.params.rampIn;
  if (e.params?.rampOut > 0 && e.params.envOut == null) p.envOut = e.params.rampOut;
  delete p.rampIn; delete p.rampOut; delete p.edgeMs;
  if (e.kind === 'spurt') delete p.depth;   // old absolute depth: a spurt is relative to the trace now (amount; default 25)
  if (e.kind === 'knotting' && !KNOT_MODES.includes(p.mode)) p.mode = null;   // null = auto
  if (e.kind === 'knotting' && p.mode === 'none') for (const k in NONE_TIMING) if (e.params?.[k] == null) p[k] = NONE_TIMING[k];
  if (e.kind === 'throbbing' && p.dir !== 'swell') p.dir = 'dip';
  for (const s of fxSchema(e.kind)) {
    if (s.type !== 'number' && s.type !== 'int') continue;
    const v = p[s.key];
    if (v == null && s.optional) p[s.key] = null;
    else p[s.key] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, s.min ?? -Infinity, s.max ?? Infinity) : s.default;
  }
  return p;
}

/** Is the modifier an instant (a spurt)? Drawn as a diamond, moved whole, duplicated 300 ms on. */
export const isPointFx = (e) => !!FX_KINDS[e?.kind]?.point;
/** The effects that act: known kind, a span (or an instant: isPointFx), not muted, not baked (already in the axis); sorted by t0 (stable). */
export const liveFx = (fx) => (Array.isArray(fx) ? fx : [])
  .filter((e) => e && !e.muted && !e.baked && FX_KINDS[e.kind] && Number.isFinite(e.t0) && Number.isFinite(e.t1) && (isPointFx(e) ? e.t1 >= e.t0 : Math.round(e.t1) > Math.round(e.t0)))
  .map((e, i) => [e, i]).sort((a, b) => a[0].t0 - b[0].t0 || a[1] - b[1]).map(([e]) => e);

/** Indices of pts where the motion stops or reverses (both ends of a plateau), interior points only. */
function stops(pts) {
  const out = [];
  for (let i = 1; i < pts.length - 1; i++) if (Math.sign(pts[i].pos - pts[i - 1].pos) !== Math.sign(pts[i + 1].pos - pts[i].pos)) out.push(i);
  return out;
}

/** Real extremes of script within [a, b] for the generators' ctx.turns: [{at, pos, kind: 'top'|'bottom'}], a plateau at its first point. */
export function baseTurns(script, a, b) {
  const pts = script.slice(Math.max(0, lowerBound(script, a) - 1), lowerBound(script, b + 1) + 1), out = [];
  let dir = 0, ext = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.sign(pts[i].pos - pts[i - 1].pos);
    if (!d) continue;
    if (dir && d !== dir && pts[ext].at >= a && pts[ext].at <= b) out.push({ at: pts[ext].at, pos: pts[ext].pos, kind: dir > 0 ? 'top' : 'bottom' });
    dir = d; ext = i;
  }
  return out;
}

const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

/** paw-ajvq: the edge ease of the kinds that ride on the trace (orgasm, the base mix): half a stroke of the trace around
 *  [S, E] (no strokes: 300 ms), at most a third of the span. -> ms. */
function edgeMsOf(cur, S, E) {
  const T = baseTurns(cur, S - 2000, E + 2000);
  const W = T.length >= 2 ? clamp(2 * median(T.slice(1).map((x, i) => x.at - T[i].at)), 200, 4000) : 600;
  return Math.max(1, Math.min((E - S) / 3, W / 2));
}

/** The reference tremor as offsets from the deep end over [t0, t1]: TREMOR_FIT's zig-zag (0, 10, 5, 15, 10, 20, ...,
 *  0, peak 20) every periodMs (333), its last 67 ms held at 0, scaled so its peak is `depth`. -> [{at, pos}] ([] at 0). */
export function tremorKeys(t0, t1, depth) {
  const { pattern: pat, periodMs, holdMs, peak } = TREMOR_FIT, step = (periodMs - holdMs) / (pat.length - 1), k = depth / peak, out = [];
  if (!(k > 0)) return out;
  for (let c = t0; c < t1 + periodMs; c += periodMs) pat.forEach((v, i) => { const at = Math.round(c + i * step); if (!out.length || at > out[out.length - 1].at) out.push({ at, pos: v * k }); });
  return out;
}

/** paw-d1g7, the orgasm container's bed over [t0, t1]: the trace after its base mix (mix), its depth pulled from the
 *  tracked strokes' own min..max onto [lo, hi], plus the reference tremor (tremorKeys) anchored deep: added shallower,
 *  squeezed to the room under hi, so it plays at the bottoms and on a deep hold. Both eased in and out over edgeMsOf
 *  (continuous at the edges). Sampled at the union of the trace's points, the tremor's keys and the eases' samples, so
 *  no stroke is dropped. Its markers (the spurts inside it) are applied after it (applyFx, markerParams). */
function orgasmFx(cur, e, p, ctx) {
  const t0 = Math.max(Math.round(e.t0), cur[0].at), t1 = Math.min(Math.round(e.t1), cur[cur.length - 1].at);
  if (t1 <= t0) return cur;
  const R = edgeMsOf(cur, t0, t1), dry = baseMix(cur, t0, t1, p.mix / 100), at = dry ? dry.at : (t) => posAt(cur, t);
  const minGap = Math.max(1, ctx.minGapMs ?? DEFAULTS.minGapMs), trem = thinGaps(tremorKeys(t0, t1, p.tremor), minGap);   // its extremes kept on a slow device
  const lo = Math.min(p.lo, p.hi), hi = Math.max(p.lo, p.hi), i0 = lowerBound(cur, t0), i1 = lowerBound(cur, t1 + 1);
  const own = new Set([t0, t1, ...cur.slice(i0, i1).map((a) => a.at)]), ts = new Set([...trem.map((q) => q.at), ...(dry ? dry.ts : [])]);
  for (let k = 1; k < 4; k++) { ts.add(Math.round(t0 + (R * k) / 4)); ts.add(Math.round(t1 - (R * k) / 4)); }
  // the trace's own points always; a tremor / ease sample only minGap clear of the points kept around it (the limiter, last,
  // then never drops a tracked turn for a tremor step)
  const O = [...own].sort((a, b) => a - b), T = [];
  let oi = 0;
  for (const t of [...new Set([...own, ...ts])].filter((x) => x >= t0 && x <= t1).sort((a, b) => a - b)) {
    if (own.has(t)) { while (T.length && !own.has(T[T.length - 1]) && t - T[T.length - 1] < minGap) T.pop(); T.push(t); continue; }
    if (T.length && t - T[T.length - 1] < minGap) continue;
    while (oi < O.length && O[oi] < t) oi++;
    if (oi < O.length && O[oi] - t < minGap) continue;
    T.push(t);
  }
  const V = T.map(at);
  let mn = Infinity, mx = -Infinity;
  for (const q of cur.slice(i0, i1)) { mn = Math.min(mn, q.pos); mx = Math.max(mx, q.pos); }
  if (!(mx >= mn)) { mn = Math.min(...V); mx = Math.max(...V); }
  const piece = T.map((t, j) => {
    const v = V[j], w = smooth((t - t0) / R) * smooth((t1 - t) / R), d = v + ((mx > mn ? lo + ((v - mn) * (hi - lo)) / (mx - mn) : lo) - v) * w;
    const o = trem.length ? posAt(trem, t) * w : 0;
    return { at: t, pos: clamp(Math.round(d + Math.min(o, Math.max(0, hi - d))), 0, 100) };
  });
  return [...cur.slice(0, i0), ...piece, ...cur.slice(i1)];
}

/** paw-d1g7: the orgasm a spurt is a marker of (its instant inside the span; the latest-starting one), or null. */
export const orgasmOf = (list, e) => (isPointFx(e) ? liveFx(list).filter((o) => o.kind === 'orgasm' && e.t0 >= o.t0 && e.t0 <= o.t1).pop() ?? null : null);
/** A marker's params: its orgasm's spurt shape (MARKER_KEYS) with its own velocity and base mix. */
export function markerParams(e, o) {
  const op = fxParams(o), own = fxParams(e);
  return { ...own, ...Object.fromEntries(MARKER_KEYS.map((k) => [k, op[k]])) };
}

// ---- Reshape: the stroke profile ----

/** One move between two turns, u = time share 0..1 -> travel share 0..1. Cubic Hermite with end slopes 1 - accelIn /
 *  1 - accelOut (0 = linear, 1 = eased to a stop, -1 = twice as fast), arriving early by `dwell` and holding. */
export function moveCurve(u, accelIn = 0, accelOut = 0, dwell = 0) {
  const d = clamp(dwell, 0, 0.95);
  if (u >= 1 - d) return 1;
  const w = clamp(u / (1 - d), 0, 1), m0 = 1 - clamp(accelIn, -1, 1), m1 = 1 - clamp(accelOut, -1, 1), w2 = w * w, w3 = w2 * w;
  return (w3 - 2 * w2 + w) * m0 + (-2 * w3 + 3 * w2) + (w3 - w2) * m1;
}
const MOVE_SAMPLES = [0.2, 0.4, 0.6, 0.8];

/** Reshape: the turn times stay the base's (tops move only when inFrac is set); the path between them is re-drawn.
 *  Depth (lo / hi, sliding to loEnd / hiEnd over [t0, t1]): the turns from their own min..max onto the band at their
 *  time; the other points follow the same map, held inside the band (depth alone keeps every point: the path between
 *  the turns keeps its shape). */
function shapeFx(pts, p, ctx, t0 = pts[0]?.at, t1 = pts[pts.length - 1]?.at) {
  const minGap = Math.max(1, ctx.minGapMs ?? DEFAULTS.minGapMs), keys = stops(pts);
  const asis = !p.accelIn && !p.accelOut && !p.dwellTop && !p.dwellBottom && p.inFrac == null && p.lo == null && p.hi == null;   // loEnd / hiEnd act only with lo / hi
  if (keys.length < 2 || asis) return pts;
  let K = keys.map((i) => pts[i]), edge = (a) => a;
  if (p.lo != null || p.hi != null) {   // depth: the span's turns from their own min..max onto lo..hi (sliding to loEnd / hiEnd)
    let mn = Infinity, mx = -Infinity;
    for (const a of K) { mn = Math.min(mn, a.pos); mx = Math.max(mx, a.pos); }
    const lo0 = p.lo ?? mn, hi0 = p.hi ?? mx, lo1 = p.loEnd ?? lo0, hi1 = p.hiEnd ?? hi0;
    const band = (at) => { const u = t1 > t0 ? clamp((at - t0) / (t1 - t0), 0, 1) : 0; return [lo0 + (lo1 - lo0) * u, hi0 + (hi1 - hi0) * u]; };
    const map = (a, hold) => {
      const [lo, hi] = band(a.at);
      let v = lo + ((a.pos - mn) * (hi - lo)) / (mx - mn);
      if (hold) v = clamp(v, Math.min(lo, hi), Math.max(lo, hi));
      return { at: a.at, pos: clamp(Math.round(v), 0, 100) };
    };
    if (mx > mn) { K = K.map((a) => map(a, false)); edge = (a) => map(a, true); }
    // depth only (Autorange): every point through the same map, so the path between the turns keeps its shape
    if (mx > mn && !p.accelIn && !p.accelOut && !p.dwellTop && !p.dwellBottom && p.inFrac == null) { const key = new Set(keys); return pts.map((a, i) => map(a, !key.has(i))); }
  }
  if (p.inFrac != null) {   // fast in / slow out: the deep turns stay, each single-point top moves inside its stroke
    const f = clamp(p.inFrac, 0.1, 0.9);
    for (let j = 1; j < K.length - 1; j++) {
      const a = K[j - 1], b = K[j], c = K[j + 1];
      if (!(b.pos > a.pos && b.pos > c.pos) || c.at - a.at < 2 * minGap + 2) continue;
      const at = clamp(Math.round(a.at + (1 - f) * (c.at - a.at)), a.at + minGap, c.at - minGap);
      if (at !== b.at) K[j] = { at, pos: b.pos };
    }
  }
  const flat = !p.accelIn && !p.accelOut;
  const out = pts.slice(0, keys[0]).map(edge);
  for (let j = 0; j < K.length; j++) {
    const a = K[j], b = K[j + 1];
    out.push(a);
    if (!b || a.pos === b.pos) continue;
    const dwell = b.pos > a.pos ? p.dwellTop : p.dwellBottom;
    const us = flat ? [] : [...MOVE_SAMPLES];
    if (dwell > 0) us.push(1 - dwell);
    us.sort((x, y) => x - y);
    for (const u of us) {
      if (u >= 1 - dwell && u !== 1 - dwell) continue;   // inside the hold: the knee carries it
      const at = Math.round(a.at + u * (b.at - a.at));
      if (at - out[out.length - 1].at < minGap || b.at - at < minGap) continue;
      out.push({ at, pos: clamp(Math.round(a.pos + moveCurve(u, p.accelIn, p.accelOut, dwell) * (b.pos - a.pos)), 0, 100) });
    }
  }
  for (let i = keys[keys.length - 1] + 1; i < pts.length; i++) out.push(edge(pts[i]));
  return out;
}

/**
 * "Fit from motion": the Reshape params read off the tracked trajectory. samples = the run's own track {t, v} (any
 * scale or sign: each half-stroke is normalised by its own ends), base = its keyframes (the turns). Over the span's
 * whole half-strokes: the mean normalised move -> accelIn / accelOut (start / end slope of its moving part), dwellTop /
 * dwellBottom (how long it sits within 3 % of the top / bottom around the turn), lo / hi (the turns' range). Never
 * inFrac: turn times come from the video (it stays as tracked until the user drags it). -> params | null.
 */
export function fitProfile(samples, base, t0, t1) {
  const T = samples?.t, V = samples?.v, turns = baseTurns(base, t0, t1);
  if (!T?.length || turns.length < 3) return null;
  const n = 24, at = (t) => {   // linear read of the samples at t (NaN where lost)
    let lo = 0, hi = T.length - 1;
    if (t < T[0] || t > T[hi]) return NaN;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    return T[hi] === T[lo] ? V[lo] : V[lo] + ((V[hi] - V[lo]) * (t - T[lo])) / (T[hi] - T[lo]);
  };
  const mean = { top: new Float64Array(n + 1), bottom: new Float64Array(n + 1) }, cnt = { top: 0, bottom: 0 };
  for (let j = 0; j + 1 < turns.length; j++) {
    const a = turns[j], b = turns[j + 1], s0 = at(a.at), s1 = at(b.at);
    if (!(Math.abs(s1 - s0) > 1e-9)) continue;
    const row = [];
    for (let k = 0; k <= n; k++) row.push(clamp((at(a.at + ((b.at - a.at) * k) / n) - s0) / (s1 - s0), -0.2, 1.2));
    if (row.some((x) => !(x === x))) continue;
    row.forEach((x, k) => { mean[b.kind][k] += x; });
    cnt[b.kind]++;
  }
  if (cnt.top + cnt.bottom < 2) return null;
  const curve = (kind) => (cnt[kind] ? Array.from(mean[kind], (x) => x / cnt[kind]) : null);
  const up = curve('top'), down = curve('bottom');
  const tail = (c) => { let k = n; while (k > 0 && c[k - 1] >= 0.97) k--; return (n - k) / n; };    // arrives early, holds
  const head = (c) => { let k = 0; while (k < n && c[k + 1] <= 0.03) k++; return k / n; };           // leaves late
  const hold = (arrive, leave) => clamp(+(((arrive ? tail(arrive) : 0) + (leave ? head(leave) : 0)).toFixed(2)), 0, 0.6);
  // slopes of the moving part, both directions together
  const slopes = [up, down].filter(Boolean).map((c) => {
    const h0 = head(c), d = tail(c), L = Math.max(0.1, 1 - h0 - d), r = (u) => c[Math.round(clamp(h0 + u * L, 0, 1) * n)];
    return [(r(0.2) - r(0)) / 0.2, (r(1) - r(0.8)) / 0.2];
  });
  const m0 = slopes.reduce((s, x) => s + x[0], 0) / slopes.length, m1 = slopes.reduce((s, x) => s + x[1], 0) / slopes.length;
  const pos = turns.map((x) => x.pos);
  return {
    accelIn: +clamp(1 - m0, -1, 1).toFixed(2), accelOut: +clamp(1 - m1, -1, 1).toFixed(2),
    dwellTop: hold(up, down), dwellBottom: hold(down, up),
    lo: Math.min(...pos), hi: Math.max(...pos),
  };
}

const CONTEXT_MS = 3000;   // turns this far outside a span still time the knot's first and last cycle

/**
 * Spurt keys relative to t0: [[ms, offset from the trace]]. A ringing about the trace: from the trace (offset 0) to
 * -amount (deeper) at 0 = the frame of the shot, then +amount x decay (shallower), -amount x decay^2, ... for `count`
 * half-swings, each held `hold` ms, then back to the trace. A swing deeper takes `rise` ms, one shallower `fall` ms
 * (the limiter, last, gives way in amplitude on a slower device; the times stay).
 */
export function spurtKeys(p) {
  const dur = (from, to) => (to < from ? p.rise : p.fall);
  const n = Math.max(1, Math.round(p.count)), keys = [];
  let o = -p.amount;
  keys.push([-dur(0, o), 0], [0, o]);
  let t = 0;
  if (p.hold > 0) keys.push([(t += p.hold), o]);
  for (let k = 1; k < n; k++) {
    const q = (k % 2 ? 1 : -1) * p.amount * Math.pow(p.decay, k);
    keys.push([(t += dur(o, q)), q]);
    if (p.hold > 0) keys.push([(t += p.hold), q]);
    o = q;
  }
  keys.push([t + dur(o, 0), 0]);
  return keys;
}

/** Spurt: the ringing (its swing x vel) added onto the trace at t0 (modulate: every trace point inside its window kept). */
function spurtFx(cur, e, p) {
  const t0 = Math.round(e.t0), K = spurtKeys({ ...p, amount: p.amount * p.vel }).map(([dt, o]) => [t0 + dt, o]);
  return modulate(cur, K, K[0][0], K[K.length - 1][0], p.mix / 100);
}

/** The trace's center line over [S, E]: its mean over one stroke (twice the median half-stroke between its turns,
 *  200..4000 ms) at t. null when the trace has fewer than 2 turns there (no strokes: nothing to flatten). */
function centerLine(cur, S, E) {
  const T = baseTurns(cur, S - 2000, E + 2000);
  if (T.length < 2) return null;
  const W = clamp(2 * median(T.slice(1).map((x, i) => x.at - T[i].at)), 200, 4000);
  const sl = cur.slice(Math.max(0, lowerBound(cur, S - W) - 1), lowerBound(cur, E + W) + 1), n = sl.length, I = new Float64Array(n);
  for (let i = 1; i < n; i++) I[i] = I[i - 1] + ((sl[i].pos + sl[i - 1].pos) * (sl[i].at - sl[i - 1].at)) / 2;
  const area = (t) => {   // the trace's integral from sl[0] to t (held flat past either end)
    if (t <= sl[0].at) return sl[0].pos * (t - sl[0].at);
    if (t >= sl[n - 1].at) return I[n - 1] + sl[n - 1].pos * (t - sl[n - 1].at);
    const i = lowerBound(sl, t), a = sl[i - 1], v = posAt(sl, t);
    return I[i - 1] + ((a.pos + v) * (t - a.at)) / 2;
  };
  return { W, at: (t) => (area(t + W / 2) - area(t - W / 2)) / W };
}

/** The base mix over [S, E] (mix 0..1): the trace pulled toward its center line by 1 - mix inside, eased back onto
 *  the trace over half a stroke at each edge (at most a third of the span), so the span's ends sit on the trace.
 *  -> {at(t), ts: sample times of the edge eases} | null when it changes nothing (mix 1, no strokes). */
function baseMix(cur, S, E, mix) {
  const c = mix < 1 && E > S ? centerLine(cur, S, E) : null;
  if (!c) return null;
  const R = Math.max(1, Math.min((E - S) / 3, c.W / 2)), ts = [];
  for (let k = 0; k <= 4; k++) ts.push(Math.round(S + (R * k) / 4), Math.round(E - (R * k) / 4));
  const g = (t) => 1 - (1 - mix) * smooth((t - S) / R) * smooth((E - t) / R);
  return { at: (t) => { const c0 = c.at(t); return c0 + g(t) * (posAt(cur, t) - c0); }, ts };
}

/** Modulate: offsets [[at, o]] (0 at both ends) added onto the trace, after its base mix over [S, E] (S <= the first
 *  key, E >= the last), sampled at the union of the trace's points, the keys and the base mix's samples there, clamped
 *  to 0..100 (a swing past an end is squeezed to the room). cur itself when the window leaves the base. */
function modulate(cur, K, S, E, mix) {
  if (S < cur[0].at || E > cur[cur.length - 1].at) return cur;   // only where the base has motion
  const dry = baseMix(cur, S, E, mix), i0 = lowerBound(cur, S), i1 = lowerBound(cur, E + 1);
  if (!dry && !K.length) return cur;
  const off = K.length ? K.map(([at, o]) => ({ at, pos: o })) : [{ at: S, pos: 0 }], ts = new Set(cur.slice(i0, i1).map((a) => a.at));
  for (const [at] of K) ts.add(Math.round(at));
  if (dry) for (const t of dry.ts) ts.add(t);
  const piece = [...ts].sort((a, b) => a - b).map((at) => ({ at, pos: clamp(Math.round((dry ? dry.at(at) : posAt(cur, at)) + posAt(off, at)), 0, 100) }));
  return [...cur.slice(0, i0), ...piece, ...cur.slice(i1)];
}

// ---- Throb: a heartbeat on the trace ----

/** One beat relative to its start: [[ms, offset]]. From the trace (0) to -amp (dir 'dip'; +amp for 'swell') in attack ms,
 *  back in release ms; with `double` the first return is cut to +120 ms and a second dip of double x amp follows (lub-dub). */
export function throbBeat(p, amp = p.amount) {
  const A = (p.dir === 'swell' ? 1 : -1) * amp, keys = [[0, 0], [p.attack, A]];
  if (!(p.double > 0)) return [...keys, [p.attack + p.release, 0]];
  const t2 = Math.max(120, p.attack + 20);
  return [...keys, [t2, 0], [t2 + p.attack, A * p.double], [t2 + p.attack + p.release, 0]];
}

/** Throbbing over the span: beats from t0 every period (x 1 +- jitter, seeded per modifier; a beat longer than the period
 *  finishes first; the strength envelope scales them, blendFx), added onto the trace (modulate, squeezed near 0 / 100,
 *  the base mix over the whole span). A beat belongs to the span when it fits; with ctx.grid its dip on that frame's start. */
function throbFx(cur, e, p, ctx) {
  const t0 = Math.max(Math.round(e.t0), cur[0].at), t1 = Math.min(Math.round(e.t1), cur[cur.length - 1].at);
  if (t1 <= t0) return cur;
  const rnd = mulberry32(hashSeed(ctx.seed ?? 0, e.id ?? `throb@${e.t0}`)), N = throbBeat(p), nAtk = N[1][0], nEnd = N[N.length - 1][0];
  const K = [];
  for (let tb = t0; tb + nEnd <= t1;) {
    const s = (ctx.grid ? frameStartOf(tb + nAtk, ctx.grid) : tb + nAtk) - nAtk;
    if (p.amount >= 0.5) for (const [dt, o] of N) { const at = Math.round(s + dt); if (!K.length || at > K[K.length - 1][0]) K.push([at, o]); }
    tb = Math.max(s + nEnd, tb + nEnd, Math.round(tb + p.period * (1 + p.jitter * (2 * rnd() - 1))));
  }
  return modulate(cur, K, Math.min(t0, K[0]?.[0] ?? t0), Math.max(t1, K[K.length - 1]?.[0] ?? t1), p.mix / 100);
}

/** A single throb with its dip on frame t: a throbbing range one beat long (it starts `attack` before t), its period
 *  longer than the range so exactly one beat fits. -> {t0, t1, params}. */
export function singleThrob(t, params = {}) {
  const p = fxParams({ kind: 'throbbing', params }), K = throbBeat(p), t0 = Math.round(t - K[1][0]);
  return { t0, t1: t0 + K[K.length - 1][0] + 1, params: { ...params, period: 2000 } };
}

/** Fit: the beat period off pulse times (scale-channel peaks, or the samples' small dips) = their median spacing.
 *  -> ms | null (fewer than 3 times). */
export function throbPeriod(times) {
  const d = [];
  for (let i = 1; i < (times?.length || 0); i++) d.push(times[i] - times[i - 1]);
  return d.length >= 2 ? Math.round(clamp(median(d), 250, 2000)) : null;
}

// ---- Knotting, modes 'single' and 'unknot': one knot in, one knot out ----

/** Where the pull-out's first leg (tie -> popTo) ends, share of the pull-out: the reference's 83 of 229 ms. */
const PULL_LEG = 0.36;
/** Knot-in keys over the span: [[u (share of the span), pos]]. From `from` (the tracked level at the span start), the
 *  push starts at popAt - push: the approach to the catch (knotIn), then the press to the knot depth (press) over the
 *  push's last pressTakes, the pop to full depth (lo) in popU (share), the drift up to the tie (knotOut) over settle;
 *  then held at the tie, or with pullOut the pull-out over the span's last pullOut: tie -> popTo -> `end` (the trace at
 *  the span's end). */
export function knotInKeys(p, from, popU = 0.04, end = from) {
  const a = clamp(p.popAt, 0.05, 1), u0 = Math.max(0, a - clamp(p.push, 0.05, 1)), uP = Math.max(u0, a - clamp(p.pressTakes, 0, 1));
  const keys = [[0, from], [u0, from]];
  if (uP > u0 && uP < a) keys.push([uP, Math.min(p.knotIn, from)]);
  const b = Math.min(1, a + popU), c = Math.min(1, b + Math.max(0, p.settle));
  keys.push([a, p.press], [b, p.lo], [c, p.knotOut]);
  if (p.pullOut > 0 && c < 1) {
    const q = Math.max(c, 1 - p.pullOut);
    keys.push([q, p.knotOut], [q + PULL_LEG * (1 - q), Math.min(p.popTo, Math.max(end, p.knotOut))], [1, end]);
  } else keys.push([1, p.knotOut]);
  return keys;
}

/** Knotting mode 'none' (one push or pull, no pop) over the span: [[u, pos]]: from `from`, the move starts at popAt - push
 *  and arrives on `to` at popAt (eased out of the start and onto the end), held there to the end; monotone. */
export function pushKeys(p, from, to) {
  const a = clamp(p.popAt, 0.05, 1), u0 = Math.max(0, a - clamp(p.push, 0.05, 1)), keys = [[0, from], [u0, from]];
  for (const u of MOVE_SAMPLES) keys.push([u0 + u * (a - u0), from + moveCurve(u, 0.5, 0.5) * (to - from)]);
  keys.push([a, to], [1, to]);
  return keys.filter(([u], i, k) => !i || u > k[i - 1][0]);
}
/** The level the trace is at when t starts: its value at t (paw-r9nh: it was its last point at or before t, so an edge
 *  mid-stroke cut the stroke at its last turn: the hold / push started up to a half-stroke early). */
const levelAt = (cur, t) => Math.round(posAt(cur, t));

/**
 * The push for an untracked scene [a, b] with a knotting in mode 'none' or 'single' over it (tracking's bridges): over
 * [t0, t1] (its span, inside the scene) ONE push / pull (mode 'none') from `from` (params.from wins: the level the script
 * is at before the scene) to its `to`, or one knot-in (mode 'single': push, pop, settle, held at the tie: no pull-out);
 * held at the start before t0 and at the end after t1. -> Script strictly inside (a, b).
 */
export function insertionScript(a, b, t0, t1, { params = {}, from = 100, maxSpeed, minGapMs } = {}) {
  t0 = Math.max(a, t0); t1 = Math.min(b, t1);
  if (!(t1 - t0 >= 3 * Math.max(1, minGapMs ?? DEFAULTS.minGapMs))) return [];
  const ctx = { maxSpeed, minGapMs };
  const p = fxParams({ kind: 'knotting', params }), f = p.from ?? from;
  const piece = p.mode === 'none' ? keysFx(pushKeys(p, f, p.to ?? f), t0, t1, ctx) : knotInFx([], t0, t1, { ...p, from: f, pullOut: 0 }, ctx);
  const out = [], put = (at, pos) => { at = Math.round(at); if (at > a && at < b && (!out.length || at > out[out.length - 1].at)) out.push({ at, pos }); };
  if (t0 > a + 1) put(a + 1, piece[0].pos);
  for (const q of piece) put(q.at === a ? a + 1 : q.at === b ? b - 1 : q.at, q.pos);
  put(b - 1, piece[piece.length - 1].pos);
  return out;
}

/** The auto rule (paw-afoe: one rule; a new knotting stores it, knotModeParams): knot cycles over 6 base turns (3 strokes)
 *  or more in [t0, t1], or 2 or more over a span past 8 s; else one knot: 'unknot' when the span holds no turn and the
 *  trace is deeper at t0 than at t1 (coming out), else 'single'. */
export function autoKnotMode(base, t0, t1) {
  const n = baseTurns(base, t0, t1).length;
  return n >= 6 || (n >= 2 && t1 - t0 > 8000) ? 'cycles' : !n && base.length && posAt(base, t0) < posAt(base, t1) ? 'unknot' : 'single';
}
/** The params a new knotting over [t0, t1] stores: {mode} from autoKnotMode on the stroke's points `base`, or {} (auto,
 *  resolved when applied) over a span past 8 s with no point under it yet (marked before tracking). */
export function knotModeParams(base, t0, t1) {
  const b = base || [], known = lowerBound(b, t1 + 1) > lowerBound(b, t0);
  return t1 - t0 > 8000 && !known ? {} : { mode: autoKnotMode(b, t0, t1) };
}
/** The effect's mode: its own, else autoKnotMode on the base it is applied to (never 'none': a push is made as one). */
export const knotMode = (p, base, t0, t1) => p.mode ?? autoKnotMode(base, t0, t1);

/** A pop takes one frame (ctx.grid's; no grid: the 30 fps clock), at least minGap: the limiter (last) slows it to what
 *  the device can follow. */
const popMs = (ctx) => Math.max(Math.max(1, ctx.minGapMs ?? DEFAULTS.minGapMs), frameLen(ctx.grid) || 1000 / 30);
/** ctx.grid: the pop (popAt, a share of [t0, t1]) on the start of its frame. */
const popOnFrame = (p, t0, t1, ctx) => (ctx.grid && t1 > t0 ? { ...p, popAt: (frameStartOf(t0 + clamp(p.popAt, 0.05, 1) * (t1 - t0), ctx.grid) - t0) / (t1 - t0) } : p);
/** Keys [[u, pos]] -> points over [t0, t1] (ms), none closer than minGap (the span's end always carries the last level). */
function keysFx(keys, t0, t1, ctx) {
  const span = t1 - t0, minGap = Math.max(1, ctx.minGapMs ?? DEFAULTS.minGapMs), piece = [];
  for (const [u, pos] of keys) {
    const q = { at: Math.round(t0 + u * span), pos: clamp(Math.round(pos), 0, 100) };
    if (!piece.length || q.at - piece[piece.length - 1].at >= minGap) piece.push(q);
    else if (q.at === Math.round(t1)) piece[piece.length - 1] = q;
  }
  return piece;
}
/** The knot-in piece over [t0, t1] (ms): knotInKeys from p.from (null = the base at t0), pulled out onto the base at t1. */
function knotInFx(cur, t0, t1, p, ctx) {
  p = popOnFrame(p, t0, t1, ctx);
  const from = p.from ?? posAt(cur, t0);
  return keysFx(knotInKeys(p, from, popMs(ctx) / (t1 - t0), cur.length ? posAt(cur, t1) : from), t0, t1, ctx);
}

/** Unknot keys over the span: [[u, pos]]. Held at the tie (knotOut) until popAt - pull, the pull to the catch (knotIn;
 *  each of `tugs` tugs slips back in by tugAmp, over the pull's last 60 %), at popAt the pop out onto popTo in popU
 *  (share), the settle onto `to` over settle, held there to the end. */
export function unknotKeys(p, to, popU = 0.04) {
  const a = clamp(p.popAt, 0.05, 1), u0 = Math.max(0, a - clamp(p.pull, 0.05, 1)), n = Math.round(p.tugs), line = (w) => p.knotOut + w * (p.knotIn - p.knotOut);
  const keys = [[0, p.knotOut], [u0, p.knotOut]];
  for (let k = 0; k < n; k++) {   // a tug: pulled out along the line, then it slips back in
    const w0 = 0.4 + (0.6 * k) / n, w1 = 0.4 + (0.6 * (k + 1)) / n, wm = (w0 + w1) / 2;
    keys.push([u0 + w0 * (a - u0), line(w0)], [u0 + wm * (a - u0), Math.max(0, line(wm) - p.tugAmp)]);
  }
  const b = Math.min(1, a + popU), c = Math.min(1, b + Math.max(0, p.settle));
  keys.push([a, p.knotIn], [b, p.popTo], [c, to], [1, to]);
  return keys;
}

/** The unknot piece over [t0, t1] (ms): unknotKeys onto p.to (null = the trace at t1). */
function unknotFx(cur, t0, t1, p, ctx) {
  p = popOnFrame(p, t0, t1, ctx);
  return keysFx(unknotKeys(p, p.to ?? posAt(cur, t1), popMs(ctx) / (t1 - t0)), t0, t1, ctx);
}

/** Pool-adjacent-violators: the least-squares non-increasing fit of y. */
function antitonic(y) {
  const v = [], w = [];
  for (const x of y) {
    v.push(x); w.push(1);
    while (v.length > 1 && v[v.length - 2] < v[v.length - 1]) { const b = v.pop(), wb = w.pop(), a = v.pop(), wa = w.pop(); v.push((a * wa + b * wb) / (wa + wb)); w.push(wa + wb); }
  }
  return v.flatMap((x, i) => Array(w[i]).fill(x));
}
const pctl = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.round(q * (s.length - 1))]; };

/**
 * "Fit" for a single knot-in over [t0, t1]: the push / pop timing read off the tracked samples {t, v} (any scale or sign:
 * the direction is the trend's own, whichever monotone fit is closer). The span's samples get a monotone (isotonic) fit;
 * the push = where it moves from 5 % to 95 % of its travel, the pop = the largest drop over ~100 ms in the push's last third
 * when it is >= 15 % of the travel (else the arrival), settle = from there to 98 %. Levels are not read (the knot's one
 * level set stays): the track has no depth. -> {mode: 'single', push, popAt, settle} | null when the samples do not show
 * the push (travel < 15 % of the samples' p5..p95 over the span +-3 s, or < 5 samples).
 */
export function fitKnotIn(samples, t0, t1) {
  const r = monoFit(samples, t0, t1, 2 / 3);
  return r && { mode: 'single', popAt: r.popAt, push: r.move, settle: r.settle };
}

/**
 * "Fit" for an unknot over [t0, t1]: the pull / pop timing off the samples, the same monotone fit as fitKnotIn (either
 * sign) with the pop searched after the travel's first third (the pull is the slow part, the pop and the settle come
 * after it). -> {mode: 'unknot', pull, popAt, settle} | null. Levels are not read.
 */
export function fitKnotOut(samples, t0, t1) {
  const r = monoFit(samples, t0, t1, 1 / 3);
  return r && { mode: 'unknot', popAt: r.popAt, pull: r.move, settle: r.settle };
}

/** "Fit" for a push / pull (knotting mode 'none') over [t0, t1]: the timing off the samples, the same monotone fit with no
 *  pop (popAt = the arrival, 95 % of the travel). -> {mode: 'none', push, popAt} | null. Levels are not read. */
export function fitInsertion(samples, t0, t1) {
  const r = monoFit(samples, t0, t1, null);
  return r && { mode: 'none', push: r.move, popAt: r.popAt };
}

/** fitKnotIn / fitKnotOut: the monotone move over the span, its pop searched from `from` (share of the travel's time;
 *  null = no pop: the arrival). */
function monoFit(samples, t0, t1, from) {
  const T = samples?.t, V = samples?.v, span = t1 - t0;
  if (!T?.length || !(span > 0)) return null;
  const ts = [], xs = [], near = [];
  for (let i = 0; i < T.length; i++) {
    const x = V[i];
    if (x == null || x !== x) continue;
    if (T[i] >= t0 - 3000 && T[i] <= t1 + 3000) near.push(x);
    if (T[i] >= t0 && T[i] <= t1) { ts.push(T[i]); xs.push(x); }
  }
  if (xs.length < 5) return null;
  const sse = (f, y) => f.reduce((s, z, i) => s + (z - y[i]) ** 2, 0);
  const neg = xs.map((x) => -x), dn = antitonic(xs), up = antitonic(neg);   // up: the fit of -x (lower = deeper again)
  const flip = sse(up, neg) < sse(dn, xs), f = flip ? up : dn, x = flip ? neg : xs;
  const travel = f[0] - f[f.length - 1];
  const mean = x.reduce((s, z) => s + z, 0) / x.length, sst = x.reduce((s, z) => s + (z - mean) ** 2, 0);
  if (!(travel > 0) || travel < 0.15 * (pctl(near, 0.95) - pctl(near, 0.05)) || sse(f, x) > 0.5 * sst) return null;   // strokes, not a push
  const level = (q) => f[0] - q * travel;
  let iStart = 0;
  for (let i = 0; i < f.length; i++) if (f[i] >= level(0.05)) iStart = i;
  const iArrive = f.findIndex((z) => z <= level(0.95)), iRest = f.findIndex((z) => z <= level(0.98));
  const dt = (ts[ts.length - 1] - ts[0]) / Math.max(1, ts.length - 1), k = Math.max(1, Math.round(100 / (dt || 1)));
  let pop = -1, best = 0;
  for (let i = 0; i + k < x.length; i++) {
    if (from == null || ts[i] < ts[iStart] + from * (ts[iArrive] - ts[iStart]) || ts[i] > ts[iArrive]) continue;
    const d = x[i] - x[i + k];
    if (d > best) { best = d; pop = i; }
  }
  const hasPop = pop >= 0 && best >= 0.15 * travel, uOf = (t) => clamp((t - t0) / span, 0, 1), r2 = (v) => +v.toFixed(2);
  const popAt = clamp(uOf(hasPop ? ts[pop] : ts[iArrive]), 0.05, 1);
  return {
    popAt: r2(popAt), move: r2(clamp(popAt - uOf(ts[iStart]), 0.05, 1)),
    settle: r2(clamp(uOf(ts[Math.max(iRest, hasPop ? pop + k : iArrive)]) - popAt, 0, 0.5)),
  };
}

// ---- paw-r9nh: edges eased onto the trace, the strength envelope ----
/** The kinds whose strokes replace the trace's strokes on the same turns: eased in and out (crossfaded) over a half-stroke.
 *  The slow single moves (idle, One knot, Unknot, a push / pull) start from the trace's level AT the edge (posAt)
 *  instead and hand back through the plan join (a crossfade would mix strokes into a monotone push); the rest ride on
 *  the trace (offsets, the orgasm's own edge ease) and are continuous at their edges already. An Autorange band (auto Reshape: its
 *  edges are the scene's, its band the contract) is not eased. */
const easesEdges = (e, p, cur, t0, t1) => (e.kind === 'shape' && !e.auto) || (e.kind === 'knotting' && knotMode(p, cur, t0, t1) === 'cycles');
/** The ease at edge te: the base's half-stroke around te (no turns near: 300 ms) held to 150..800 ms, long enough that
 *  closing a gap of `gap` pos stays near the cap's half, at most a third of the span. */
function easeMs(cur, te, span, gap, cap) {
  const T = baseTurns(cur, te - 2000, te + 2000).map((x) => x.at), k = lowerBound(T, te + 1);
  const hs = k > 0 && k < T.length ? T[k] - T[k - 1] : 300;
  return Math.round(Math.min(span / 3, Math.max(clamp(hs, 150, 800), cap > 0 ? (3000 * gap) / cap : 0)));
}
/** The base's stroke travel at t over the span, 0..1 of its largest there (`follow`): the half-stroke containing t. */
function travelOf(cur, t0, t1) {
  const T = baseTurns(cur, t0 - 2000, t1 + 2000);
  const tr = T.slice(1).map((b, i) => ({ t0: T[i].at, t1: b.at, d: Math.abs(b.pos - T[i].pos) })), mx = Math.max(1, ...tr.filter((x) => x.t1 > t0 && x.t0 < t1).map((x) => x.d));
  return (t) => { const x = tr.find((s) => t >= s.t0 && t < s.t1); return x ? x.d / mx : 1; };
}
/**
 * out (the modifier applied to cur) seen through its weight over [t0, t1]: w = ease at the edges (easesEdges) x
 * strength(u) x follow; result = cur + w (out - cur), rebuilt where w < 1 (where it is 1 the modifier's own points are
 * kept, so a flat strength only touches the two ease windows). Points: cur's and out's there plus samples of the ease,
 * nothing closer than minGap (out's points win, then cur's). Outside the span: out as it is.
 */
function blendFx(cur, out, e, p, ctx) {
  const t0 = Math.max(Math.round(e.t0), cur[0].at), t1 = Math.min(Math.round(e.t1), cur[cur.length - 1].at), span = t1 - t0;
  const flat = envFlat(p);
  if (span <= 0) return out;
  const ease = easesEdges(e, p, cur, t0, t1);
  if (!ease && flat) return out;
  const cap = ctx.maxSpeed ?? DEFAULTS.maxSpeed, minGap = Math.max(1, ctx.minGapMs ?? DEFAULTS.minGapMs);
  // (an edge at the trace's own start / end has nothing to join)
  const W0 = ease && t0 > cur[0].at ? easeMs(cur, t0, span, Math.abs(posAt(out, t0) - posAt(cur, t0)), cap) : 0;
  const W1 = ease && t1 < cur[cur.length - 1].at ? easeMs(cur, t1, span, Math.abs(posAt(out, t1) - posAt(cur, t1)), cap) : 0;
  const fol = p.follow > 0 ? travelOf(cur, t0, t1) : null;
  const w = (t) => (W0 > 0 ? smooth((t - t0) / W0) : 1) * (W1 > 0 ? smooth((t1 - t) / W1) : 1) * (flat ? 1 : clamp(strength((t - t0) / span, p), 0, 1) * (fol ? 1 - p.follow + p.follow * fol(t) : 1));
  const windows = flat ? [[t0, t0 + W0], [t1 - W1, t1]].filter(([a, b]) => b > a) : [[t0, t1]];
  let res = out;
  for (const [a, b] of windows) {
    const pts = [];
    for (const q of cur.slice(lowerBound(cur, a), lowerBound(cur, b + 1))) pts.push([q.at, 1]);
    for (const q of out.slice(lowerBound(out, a), lowerBound(out, b + 1))) pts.push([q.at, 2]);
    const n = Math.max(2, Math.min(12, Math.floor((b - a) / Math.max(minGap, 40))));
    for (let k = 0; k <= n; k++) pts.push([Math.round(a + ((b - a) * k) / n), k === 0 || k === n ? 3 : 0]);   // the window's ends always
    pts.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
    const keep = [];
    for (const q of pts) {
      const l = keep[keep.length - 1];
      if (!l || q[0] - l[0] >= minGap) keep.push(q);
      else if (q[1] > l[1] && keep.length > 1) keep[keep.length - 1] = q;
    }
    if (keep.length > 1 && keep[keep.length - 1][0] !== b) keep[keep.length - 1] = [b, 3];
    const piece = keep.map(([t]) => ({ at: t, pos: clamp(Math.round(posAt(cur, t) + w(t) * (posAt(res, t) - posAt(cur, t))), 0, 100) }));
    const i0 = lowerBound(res, a), i1 = lowerBound(res, b + 1), left = res.slice(0, i0), right = res.slice(i1);
    // the window's own ends yield to a neighbour closer than minGap (they lie on the lines either side: nothing moves)
    while (piece.length && left.length && piece[0].at - left[left.length - 1].at < minGap) piece.shift();
    while (piece.length && right.length && right[0].at - piece[piece.length - 1].at < minGap) piece.pop();
    res = [...left, ...piece, ...right];
  }
  return res;
}

function applyOne(cur, e, ctx) {
  if (cur.length < 2 || isPointFx(e)) return applyRaw(cur, e, ctx);
  const out = applyRaw(cur, e, ctx);
  return out === cur ? cur : blendFx(cur, out, e, fxParams(e), ctx);
}

/** A slow move's piece over [t0, t1] in place of cur's points there. A piece that starts ON the trace joins it on the
 *  trace's own line (its first point yields to a closer base point; no cap test: the step is the trace's own -- the plan
 *  join dropped it on fast tracked strokes, so an idle became a 10 s ramp from the last turn); one that starts off it
 *  (an Unknot at its tie, a set `from`) and the end join go through the plan join (the piece's side yields to the cap). */
function spliceOn(cur, piece, t0, t1, ctx) {
  const jo = { maxSpeed: ctx.maxSpeed ?? DEFAULTS.maxSpeed, minGapMs: Math.max(1, ctx.minGapMs ?? DEFAULTS.minGapMs), windowMs: ctx.blendMs ?? DEFAULTS.blendMs };
  const left = cur.slice(0, lowerBound(cur, t0)), right = cur.slice(lowerBound(cur, t1 + 1));
  let p = piece.slice();
  if (p.length && Math.abs(p[0].pos - posAt(cur, p[0].at)) <= 1) { while (p.length > 1 && left.length && p[0].at - left[left.length - 1].at < jo.minGapMs) p.shift(); }
  else p = p.slice(joinPlan(left, p, { ...jo, lockLeft: true }).dropRight);
  const r = joinPlan(p, right, { ...jo, lockRight: true });
  return [...left, ...p.slice(0, p.length - r.dropLeft), ...right];
}

function applyRaw(cur, e, ctx) {
  if (cur.length < 2) return cur;
  if (e.kind === 'spurt') return spurtFx(cur, e, e.marker ?? fxParams(e));
  if (e.kind === 'throbbing') return throbFx(cur, e, fxParams(e), ctx);
  if (e.kind === 'orgasm') return orgasmFx(cur, e, fxParams(e), ctx);
  // only where the base has motion: the span clipped to the base's own extent
  const t0 = Math.max(Math.round(e.t0), cur[0].at), t1 = Math.min(Math.round(e.t1), cur[cur.length - 1].at);
  const i0 = lowerBound(cur, t0), i1 = lowerBound(cur, t1 + 1);
  if (t1 <= t0) return cur;
  const p = fxParams(e);
  // one knot: a slow push may leave no base point inside the span
  const mode = e.kind === 'knotting' ? knotMode(p, cur, t0, t1) : null;
  if (mode === 'none') { const f = p.from ?? levelAt(cur, t0); return spliceOn(cur, keysFx(pushKeys(p, f, p.to ?? levelAt(cur, t1)), t0, t1, ctx), t0, t1, ctx); }
  if (e.kind === 'idle') { const v = levelAt(cur, t0); return spliceOn(cur, [{ at: t0, pos: v }, { at: t1, pos: v }], t0, t1, ctx); }
  if (mode === 'single' || mode === 'unknot') return spliceOn(cur, (mode === 'single' ? knotInFx : unknotFx)(cur, t0, t1, p, ctx), t0, t1, ctx);
  if (i1 - i0 < 2) return cur;
  if (e.kind === 'knotting') {
    const cp = Object.fromEntries(Object.entries(p).filter(([k]) => !KNOT_IN_KEYS.has(k) && !ENV_KEYS.has(k)));
    // popSpeed 0: no pop allowance above the device's cap (paw-xu4v; the limiter holds it there anyway)
    const r = resolveSegment({ kind: 'knotting', recipe: KNOT_RECIPE, params: { ...cp, timing: 'auto', popSpeed: 0 } });
    const turns = baseTurns(cur, t0 - CONTEXT_MS, t1 + CONTEXT_MS);
    const piece = r.gen(t0, t1, r.params, { ...ctx, seed: hashSeed(ctx.seed ?? 0, e.id ?? `${e.kind}@${e.t0}`), turns });
    return applyPlan(cur, { segments: [{ id: e.id, t0, t1 }], script: piece }, ctx);
  }
  const pts = cur.slice(i0, i1), piece = shapeFx(pts, p, ctx, t0, t1);
  return piece === pts ? cur : [...cur.slice(0, i0), ...piece, ...cur.slice(i1)];
}

/** Points of reg (its ends kept) at least minGap apart: in a cluster the point reaching furthest from the one kept before
 *  it wins (a turn survives, lib/edit thinMinGap 'extreme'); the end of a hold too close to the next point moves back
 *  along the hold instead (a throb's dip or a spurt's swing stays on its time, its approach starts earlier). */
function thinGaps(reg, minGap) {
  if (reg.length < 3) return reg;
  const kept = [reg[0]], last = reg[reg.length - 1];
  for (let k = 1; k < reg.length - 1; k++) {
    const a = reg[k], l = kept[kept.length - 1], pp = kept[kept.length - 2];
    if (a.at - l.at >= minGap) kept.push(a);
    else if (pp && l.pos === pp.pos && a.pos !== l.pos && a.at - pp.at >= 2 * minGap) kept.splice(-1, 1, { at: a.at - minGap, pos: l.pos }, a);
    else if (pp && Math.sign(a.pos - pp.pos) === Math.sign(l.pos - pp.pos) && Math.abs(a.pos - pp.pos) > Math.abs(l.pos - pp.pos)) kept[kept.length - 1] = a;
  }
  while (kept.length > 1 && last.at - kept[kept.length - 1].at < minGap) kept.pop();
  kept.push(last);
  return kept;
}
/** The script backward in time (negated times): lib/gen limitSpeed run on it pulls toward the point after. */
const mirror = (s) => s.map((a) => ({ at: -a.at, pos: a.pos })).reverse();

/**
 * The one limiter, last (paw-xu4v): over every run of points the modifiers changed (the base's own points either side
 * are its anchors and never move), points closer than ctx.minGapMs thinned (thinGaps), then every step held to
 * ctx.maxSpeed by pulling positions toward the point before (lib/gen limitSpeed, the pull Review's Limit speed uses;
 * forward up to the right anchor) and then toward the point after (backward from it). Times stay; amplitude gives way
 * (inside the run the base's own too-fast strokes too).
 */
function limitSpans(base, out, ctx) {
  const cap = ctx.maxSpeed ?? DEFAULTS.maxSpeed, minGap = Math.max(1, ctx.minGapMs ?? DEFAULTS.minGapMs), orig = new Set(base), res = [];
  for (let i = 0; i < out.length;) {
    if (orig.has(out[i])) { res.push(out[i++]); continue; }
    let j = i;
    while (j < out.length && !orig.has(out[j])) j++;
    const l = i > 0 ? 1 : 0, r = j < out.length ? 1 : 0;
    let reg = thinGaps(out.slice(i - l, j + r), minGap);
    if (cap > 0) {   // forward up to (not onto) the right anchor, then backward from it
      const f = limitSpeed(r ? reg.slice(0, -1) : reg, cap);
      reg = mirror(limitSpeed(mirror(r ? [...f, reg[reg.length - 1]] : f), cap));
    }
    res.push(...reg.slice(l, reg.length - r));
    i = j;
  }
  return res;
}

/**
 * base (a Script: the tracked points) + effects -> Script. Each live effect (liveFx order) works on the result of the
 * ones before it, inside its own span only; then the one limiter (limitSpans). ctx: { seed, maxSpeed, minGapMs, blendMs }
 * as in lib/gen (lib/finish.js fxCtxOf: the device's).
 */
export function applyFx(base, fx, ctx = {}) {
  let out = base;
  const L = liveFx(fx);
  for (const e of L) {   // a spurt inside an orgasm is its marker: the orgasm's spurt shape, its own velocity (paw-d1g7)
    const o = isPointFx(e) ? orgasmOf(L, e) : null;
    out = applyOne(out, o ? { ...e, marker: markerParams(e, o) } : e, ctx);
  }
  return out === base ? base : limitSpans(base, out, ctx);
}

// ---- cached views for the UI: a tracker ghost seen through the effects layer (lanes draw it, Accept takes it) ----
const scriptCache = new WeakMap(), ghostCache = new WeakMap();
const ctxKey = (ctx) => `${ctx.seed ?? 0}|${ctx.maxSpeed ?? ''}|${ctx.minGapMs ?? ''}`;

/** applyFx, memoised per script identity (recomputed when the fx list identity or ctx changes). */
export function fxCached(script, fx, ctx = {}) {
  if (!Array.isArray(script) || !liveFx(fx).length) return script;
  const k = ctxKey(ctx), c = scriptCache.get(script);
  if (c && c.fx === fx && c.k === k) return c.out;
  const out = applyFx(script, fx, ctx);
  scriptCache.set(script, { fx, k, out });
  return out;
}

/** A tracker ghost (source.kind 'tracker') with the effects applied to its script; any other ghost as it is.
 *  Same object back while nothing changed, so derived UI state keeps its identity. */
export function fxGhost(g, fx, ctx = {}) {
  if (!g || g.source?.kind !== 'tracker') return g;
  const s = fxCached(g.script, fx, ctx);
  if (s === g.script) return g;
  const c = ghostCache.get(g);
  if (c && c.s === s) return c.out;
  const out = { ...g, script: s };
  ghostCache.set(g, { s, out });
  return out;
}

// ---- the axis's own points through the layer: a live ghost until Flatten bakes it (paw-x7w7: no Shift+A) ----
const AXIS_PAD = 3000, axisCache = new WeakMap();
/** The live effects' reach: [min t0 - pad, max t1 + pad] (a spurt's ringing reaches past its instant), or null. */
export function fxReach(fx, pad = AXIS_PAD) {
  const L = liveFx(fx);
  return L.length ? { t0: Math.min(...L.map((e) => e.t0)) - pad, t1: Math.max(...L.map((e) => e.t1)) + pad } : null;
}
/** The axis script with the effects applied, as a ghost over their reach ({id 'fx-axis', source {kind 'fx'}}), or null
 *  when the effects change nothing there. Same object while the script and the fx list keep their identity. */
export function fxAxisGhost(script, fx, ctx = {}) {
  const out = fxCached(script, fx, ctx);
  if (!Array.isArray(script) || out === script) return null;
  const c = axisCache.get(out);
  if (c) return c;
  const r = fxReach(fx), a = lowerBound(out, r.t0), b = lowerBound(out, r.t1 + 1);
  const g = { id: 'fx-axis', name: 'Modifiers on the stroke (Flatten bakes)', color: '#ff7ac8', visible: true, script: out.slice(a, b), source: { kind: 'fx', axis: 'stroke' } };
  axisCache.set(out, g);
  return g;
}
/** After a bake over range (null = everywhere): the live effects reaching into it get `baked: true` (drawn hollow,
 *  skipped by applyFx; clear the flag to un-bake). -> fx list (the same array when nothing changes). */
export function markBaked(fx, range = null) {
  const ids = new Set(liveFx(fx).filter((e) => !range || (e.t1 >= range.t0 && e.t0 <= range.t1)).map((e) => e.id));
  return ids.size ? fx.map((e) => (ids.has(e.id) ? { ...e, baked: true } : e)) : fx;
}
