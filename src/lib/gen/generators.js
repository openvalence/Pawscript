// Pattern generators: gen(t0, t1, params, ctx) -> Script. Pure, deterministic for a given ctx.seed.
//
// Every generator first lays out KEYS (turning points and other anchor points, float ms / float pos, may
// start before t0 and end after t1 so the edges are exact), then one shared pipeline, finish(), turns keys
// into a valid Script:
//   1 humanise turning points (jitterTime, jitterAmp; seeded)
//   2 depth envelope: fadeFrom -> fadeTo along fadeCurve, times intensity, shrinking toward the anchor
//   3 resolve the stroke shape of every half-stroke (seeded where shape.prob < 1)
//   4 speed cap: shrink a too-fast half-stroke toward the anchor (its shape's peak slope counted)
//   5 expand shapes into interior points
//   6 clip to [t0, t1] with exact interpolated points at both edges
//   7 integer ms / pos, invert, resolve collisions closer than minGapMs (turns beat edges beat shape points)
//   8 exact integer speed limiter (only rounding-level corrections are left for it)
// pos 0 = deepest, 100 = out. `lo` is always the deep end of a range, `hi` the out end.

import { SHAPE_NAMES, resolveShape, knotSlope, SHAPES } from './shapes.js';
import { DEFAULTS, CURVES, clamp, mix, median, mulberry32, hashSeed, allowedStep } from './util.js';

// ---------------------------------------------------------------- schema helpers

const N = (key, label, dflt, min, max, step, unit) => ({ key, label, type: 'number', default: dflt, min, max, step, ...(unit ? { unit } : {}) });
const INT = (key, label, dflt, min, max, unit) => ({ key, label, type: 'int', default: dflt, min, max, step: 1, ...(unit ? { unit } : {}) });
const BOOL = (key, label, dflt) => ({ key, label, type: 'bool', default: dflt });
const CHOICE = (key, label, dflt, choices) => ({ key, label, type: 'choice', default: dflt, choices });
const RATE = (key, label, dflt) => N(key, label, dflt, 0.05, 12, 0.05, 'turns/s');
const SHAPE = (dflt = 'linear') => ({ key: 'shape', label: 'Stroke shape', type: 'shape', default: dflt, choices: SHAPE_NAMES });
const RANGE = (lo, hi) => [N('lo', 'Deep end', lo, 0, 100, 1, 'pos'), N('hi', 'Out end', hi, 0, 100, 1, 'pos')];
const START = CHOICE('start', 'First move', 'in', ['in', 'out']);
const PHASE = N('phase', 'Phase', 0, 0, 1, 0.01, 'cycle');
const INFRAC = N('inFrac', 'Share of each stroke spent going in', 0.5, 0.1, 0.9, 0.01);

/** Params every generator except `hold` understands (handled by finish()). */
export const COMMON_SCHEMA = [
  N('intensity', 'Intensity', 1, 0, 1, 0.05),
  BOOL('invert', 'Invert (100 - pos)', false),
  CHOICE('anchor', 'Shrink depth toward', 'hi', ['hi', 'mid', 'lo']),
  N('fadeFrom', 'Depth at start', 1, 0, 1, 0.05, 'x'),
  N('fadeTo', 'Depth at end', 1, 0, 1, 0.05, 'x'),
  CHOICE('fadeCurve', 'Fade curve', 'linear', Object.keys(CURVES)),
  N('jitterTime', 'Timing jitter', 0, 0, 0.4, 0.01, 'x half-stroke'),
  N('jitterAmp', 'Depth jitter', 0, 0, 0.5, 0.01, 'x travel'),
  INT('seed', 'Variation seed', 0, 0, 999999),
];

// fixed shapes used inside composite generators (objects, so finish() can cache them by identity)
const LIN = 'linear';
const SINE = { name: 'sine' };
const EASE_IN = { name: 'ease-in' };
const EASE_OUT = { name: 'ease-out' };
const BUMP = { name: 'two-speed', ratio: 2.5, at: 0.55 };   // fast approach, slows as it presses on the knot
const POP = { name: 'two-speed', ratio: 1.6, at: 0.5 };     // snaps out, settles at the top
const slopeOf = (spec) => { const r = resolveShape(spec); return Math.max(r.in.slope, r.out.slope); };

// ---------------------------------------------------------------- registry

/** id -> { id, label, description, schema, gen } */
export const GENERATORS = {};

function define(id, label, description, schema, keysFn, { common = true, defaults = {} } = {}) {
  const full = (common ? [...schema, ...COMMON_SCHEMA] : schema).map((s) => (s.key in defaults ? { ...s, default: defaults[s.key] } : s));
  function gen(t0, t1, params = {}, ctx = {}) {
    const p = {};
    for (const s of full) p[s.key] = s.default;
    for (const k in params) if (params[k] !== undefined) p[k] = params[k];
    if (params.spm != null && params.rate == null && 'rate' in p) p.rate = params.spm / 30; // strokes/min -> turns/s
    // graph expressions can feed NaN/Infinity: a non-finite number falls back to the default, a finite one is clamped to the schema
    for (const s of full) {
      if (s.type !== 'number' && s.type !== 'int') continue;
      const v = p[s.key];
      if (typeof v !== 'number' || !Number.isFinite(v)) p[s.key] = s.default;
      else if (s.min != null && s.max != null) p[s.key] = clamp(v, s.min, s.max);
    }
    if (typeof p.lo === 'number' && typeof p.hi === 'number' && p.lo > p.hi) [p.lo, p.hi] = [p.hi, p.lo];
    const I = clamp((p.intensity ?? 1) * (ctx.intensity ?? 1), 0, 1);
    if (I < 1) for (const s of full) if (s.unit === 'turns/s' && typeof p[s.key] === 'number') p[s.key] *= 0.5 + 0.5 * I;
    const seed = hashSeed(ctx.seed ?? 0, id, p.seed ?? 0);
    t0 = Math.round(t0); t1 = Math.round(t1);
    if (!(t1 >= t0)) return [];
    const keys = keysFn(t0, t1, p, ctx, mulberry32(hashSeed(seed, 'gen')));
    return finish(keys, t0, t1, p, ctx, mulberry32(hashSeed(seed, 'finish')), I);
  }
  GENERATORS[id] = { id, label, description, schema: full, gen };
  return gen;
}

// ---------------------------------------------------------------- finish: keys -> Script

const anchorPos = (p) => {
  const lo = typeof p.lo === 'number' ? p.lo : 0, hi = typeof p.hi === 'number' ? p.hi : 100;
  return p.anchor === 'lo' ? lo : p.anchor === 'mid' ? (lo + hi) / 2 : hi;
};

function jitter(keys, p, A, rng) {
  const jt = clamp(p.jitterTime || 0, 0, 0.45), ja = clamp(p.jitterAmp || 0, 0, 1);
  const shift = keys.map((k, i) => {
    const rt = rng(), ra = rng();
    if (!k.turn || k.fixed) return 0;
    if (ja > 0) k.p += (A - k.p) * ja * ra;
    if (jt <= 0 || i === 0 || i === keys.length - 1) return 0;
    return (2 * rt - 1) * jt * Math.min(k.t - keys[i - 1].t, keys[i + 1].t - k.t);
  });
  for (let i = 0; i < keys.length; i++) keys[i].t += shift[i];
}

const lerpP = (a, b, t) => (b.t === a.t ? b.p : a.p + ((b.p - a.p) * (t - a.t)) / (b.t - a.t));

/** keys (sorted by t) -> Script inside [t0, t1]. Exported for custom generators. */
export function finish(keys, t0, t1, p, ctx = {}, rng = mulberry32(0), ampScale = 1) {
  const maxSpeed = ctx.maxSpeed ?? DEFAULTS.maxSpeed;
  const minGap = Math.max(1, Math.round(ctx.minGapMs ?? DEFAULTS.minGapMs));
  if (!keys.length) return [];
  const A = anchorPos(p), span = Math.max(1, t1 - t0);

  if (p.jitterTime > 0 || p.jitterAmp > 0) jitter(keys, p, A, rng);

  const fading = (p.fadeFrom ?? 1) !== 1 || (p.fadeTo ?? 1) !== 1;
  if (ampScale !== 1 || fading) {
    for (const k of keys) {
      if (k.fixed) continue;
      const s = ampScale * (fading ? mix(p.fadeFrom ?? 1, p.fadeTo ?? 1, (k.t - t0) / span, p.fadeCurve) : 1);
      k.p = A + (k.p - A) * s;
    }
  }

  const base = resolveShape(p.shape), cache = new Map();
  const sh = new Array(keys.length).fill(null);
  for (let i = 1; i < keys.length; i++) {
    const spec = keys[i].shape;
    let r = base;
    if (spec !== undefined) { r = cache.get(spec); if (!r) cache.set(spec, (r = resolveShape(spec))); }
    const s = keys[i].p < keys[i - 1].p ? r.in : r.out;
    sh[i] = s.knots.length && (s.prob >= 1 || rng() < s.prob) ? s : null;
  }

  if (maxSpeed > 0) {
    const r = new Float64Array(keys.length + 1).fill(1);
    for (let i = 1; i < keys.length; i++) {
      const d = Math.abs(keys[i].p - keys[i - 1].p);
      const cap = keys[i].cap > 0 ? Math.max(keys[i].cap, maxSpeed) : maxSpeed; // per-move allowance (knot pops)
      const allowed = (0.98 * cap * (keys[i].t - keys[i - 1].t)) / 1000 / (sh[i] ? sh[i].slope : 1);
      if (d > allowed) r[i] = Math.max(0, allowed) / d;
    }
    for (let i = 0; i < keys.length; i++) {
      const s = Math.min(r[i], r[i + 1]);
      if (s < 1 && !keys[i].fixed) keys[i].p = A + (keys[i].p - A) * s;
    }
  }

  const pts = [{ t: keys[0].t, p: keys[0].p, pri: 3 }];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (sh[i] && a.p !== b.p) for (const [u, v] of sh[i].knots) pts.push({ t: a.t + u * (b.t - a.t), p: a.p + v * (b.p - a.p), pri: 1, cap: b.cap });
    pts.push({ t: b.t, p: b.p, pri: 3, cap: b.cap });
  }

  const clipped = [];
  let prev = null;
  for (const q of pts) {
    if (q.t < t0) { prev = q; continue; }
    if (!clipped.length && prev && q.t > t0) clipped.push({ t: t0, p: lerpP(prev, q, t0), pri: 2 });
    if (q.t > t1) {
      const last = clipped.length ? clipped[clipped.length - 1] : prev;
      if (last && last.t < t1) clipped.push({ t: t1, p: lerpP(last, q, t1), pri: 2, cap: q.cap });
      break;
    }
    clipped.push(q);
    prev = q;
  }

  const inv = !!p.invert !== !!ctx.invert;
  const res = [];
  for (const q of clipped) {
    const at = clamp(Math.round(q.t), t0, t1);
    let pos = clamp(Math.round(q.p), 0, 100);
    if (inv) pos = 100 - pos;
    let keep = true, at2 = at;
    while (res.length && at2 - res[res.length - 1].at < minGap) {
      const last = res[res.length - 1];
      // a turn and an edge point too close: the turn slides onto the edge, so the span stays covered exactly
      if (q.pri === 2 && last.pri === 3) { last.at = at2; keep = false; break; }
      if (q.pri === 3 && last.pri === 2) { res.pop(); at2 = last.at; continue; }
      if (q.pri > last.pri) res.pop(); else { keep = false; break; }
    }
    if (keep) res.push({ at: at2, pos, pri: q.pri, cap: q.cap });
  }
  // exact integer limiter; a point's cap (the step ending at it) may exceed maxSpeed where a recipe allows it
  const out = res.map(({ at, pos }) => ({ at, pos }));
  if (maxSpeed > 0) {
    for (let i = 1; i < out.length; i++) {
      const cap = res[i].cap > 0 ? Math.max(res[i].cap, maxSpeed) : maxSpeed;
      const lim = allowedStep(out[i].at - out[i - 1].at, cap);
      out[i].pos = clamp(out[i].pos, out[i - 1].pos - lim, out[i - 1].pos + lim);
    }
  }
  return out;
}

// ---------------------------------------------------------------- rate-driven strokes

/** Alternating turns from a (possibly time-varying) rate. posAt(t, top) -> pos. */
function cycleKeys(t0, t1, rateAt, posAt, { start, phase, inFrac }) {
  const f = clamp(inFrac ?? 0.5, 0.05, 0.95);
  let top = start !== 'out';
  let t = t0 - (clamp(phase ?? 0, 0, 1) * 2000) / rateAt(t0);
  const keys = [{ t, p: posAt(t, top), turn: true }];
  while (t < t1) {
    const frac = top ? f : 1 - f; // leaving the top = going in
    let d = (frac * 2000) / rateAt(t);
    d = (frac * 2000) / rateAt(t + d / 2); // rate at the middle of the half-stroke
    t += d;
    top = !top;
    keys.push({ t, p: posAt(t, top), turn: true });
  }
  return keys;
}

export const strokes = define('strokes', 'Constant strokes',
  'Strokes at a fixed rate between lo and hi. rate in turns/s (2 turns = 1 stroke) or pass spm (strokes/min).',
  [RATE('rate', 'Rate', 2.4), ...RANGE(0, 85), SHAPE('linear'), START, PHASE, INFRAC],
  (t0, t1, p) => cycleKeys(t0, t1, () => Math.max(0.02, p.rate), (t, top) => (top ? p.hi : p.lo), p));

export const ramp = define('ramp', 'Ramp (rate and depth)',
  'Rate goes rate0 -> rate1 and depth amp0 -> amp1 (fractions of lo..hi, shrinking toward the anchor) along curve: accelerando, ritardando, fade-in, fade-out.',
  [RATE('rate0', 'Rate at start', 1.2), RATE('rate1', 'Rate at end', 2.4),
    N('amp0', 'Depth at start', 0.2, 0, 1, 0.05, 'x'), N('amp1', 'Depth at end', 1, 0, 1, 0.05, 'x'),
    CHOICE('curve', 'Curve', 'ease-in-out', Object.keys(CURVES)), ...RANGE(0, 85), SHAPE('sine'), START, PHASE, INFRAC],
  (t0, t1, p) => {
    const span = Math.max(1, t1 - t0), A = anchorPos(p);
    return cycleKeys(t0, t1,
      (t) => Math.max(0.02, mix(p.rate0, p.rate1, (t - t0) / span, p.curve)),
      (t, top) => A + ((top ? p.hi : p.lo) - A) * mix(p.amp0, p.amp1, (t - t0) / span, p.curve), p);
  });

// ---------------------------------------------------------------- hold

export const hold = define('hold', 'Hold', 'Stay at one position.',
  [N('pos', 'Position', 100, 0, 100, 1, 'pos'), BOOL('invert', 'Invert (100 - pos)', false)],
  (t0, t1, p) => [{ t: t0, p: p.pos, fixed: true }, { t: t1, p: p.pos, fixed: true }], { common: false });

// ---------------------------------------------------------------- small smooth motion

export const smooth = define('smooth', 'Small smooth motion',
  'Low-amplitude sine strokes inside lo..hi whose centre drifts slowly (two incommensurate sines, seeded phases).',
  [...RANGE(55, 95), N('amp', 'Stroke depth', 14, 1, 100, 1, 'pos'), RATE('rate', 'Rate', 1.4),
    N('driftMs', 'Drift period', 9000, 1000, 120000, 500, 'ms'), N('variation', 'Variation', 0.25, 0, 1, 0.05, 'x'), SHAPE('sine'), START],
  (t0, t1, p, ctx, rng) => {
    const amp = Math.min(p.amp, p.hi - p.lo), span = (p.hi - p.lo - amp) / 2, mid = (p.lo + p.hi) / 2;
    const ph1 = rng() * 2 * Math.PI, ph2 = rng() * 2 * Math.PI, w = (2 * Math.PI) / Math.max(1000, p.driftMs);
    const centre = (t) => mid + span * (0.65 * Math.sin(w * t + ph1) + 0.35 * Math.sin((w * t) / 0.61 + ph2));
    const half = 1000 / Math.max(0.02, p.rate), v = clamp(p.variation, 0, 1);
    let top = p.start !== 'out', t = t0;
    const keys = [];
    for (;;) {
      const r = rng();
      keys.push({ t, p: centre(t) + (top ? 1 : -1) * (amp / 2) * (1 - 0.5 * v * r), turn: true });
      if (t >= t1) break;
      t += half * (1 + 0.3 * v * (2 * rng() - 1));
      top = !top;
    }
    return keys;
  }, { defaults: { anchor: 'mid' } });

// ---------------------------------------------------------------- climax pulses

export const pulses = define('pulses', 'Climax pulses',
  'Abrupt fast shallow pulses near the deep end (owner convention: 6.8 turns/s, depth ~23 between pos ~1 and ~34), easing to rateEnd over decayMs. No holds.',
  [RATE('rate', 'Onset rate', 6.8), RATE('rateEnd', 'Rate after the decay', 4.2),
    N('decayMs', 'Decay time', 15000, 0, 120000, 500, 'ms'), CHOICE('decayCurve', 'Decay curve', 'ease-in-out', Object.keys(CURVES)),
    ...RANGE(1, 34), N('amp', 'Pulse depth', 23, 1, 100, 1, 'pos'), N('ampEnd', 'Pulse depth after the decay', 20, 1, 100, 1, 'pos'),
    N('ampJitter', 'Depth variation', 0.25, 0, 1, 0.05, 'x'), N('deepJitter', 'Bottom variation', 2, 0, 20, 1, 'pos'), SHAPE('linear'), START],
  (t0, t1, p, ctx, rng) => {
    let t = t0, top = p.start !== 'out';
    const keys = [];
    for (;;) {
      const u = (t - t0) / Math.max(1, p.decayMs);
      const bottom = p.lo + rng() * p.deepJitter, j = 2 * rng() - 1;
      const depth = mix(p.amp, p.ampEnd, u, p.decayCurve) * (1 + p.ampJitter * j);
      keys.push({ t, p: Math.min(p.hi, top ? bottom + depth : bottom), turn: true });
      if (t >= t1) break;
      t += 1000 / Math.max(0.02, mix(p.rate, p.rateEnd, u, p.decayCurve));
      top = !top;
    }
    return keys;
  }, { defaults: { anchor: 'lo' } });

// ---------------------------------------------------------------- orgasm tremor (fitted, README "Orgasm")

/** The reference orgasm (reference A, a 25 s section; reference B has the same 333 ms period; README "Orgasm"):
 *  a deep-end flutter repeating every 333 ms (10 moves + a 67 ms hold at the bottom), then bursts of decaying
 *  pulses (20, 15, 10, 5) with a rest at the bottom, burst period 567-600 ms (uniform 100 ms pulses + 183 ms rest = 583). */
export const TREMOR_FIT = Object.freeze({
  pattern: Object.freeze([0, 10, 5, 15, 10, 20, 10, 15, 5, 10, 0]), periodMs: 333, holdMs: 67, peak: 20,
  pulses: Object.freeze([20, 15, 10, 5]), pulseHalfMs: 50, restMs: 183, burstMs: 583, pulseMs: 6000,
});

export const tremor = define('tremor', 'Orgasm tremor',
  'Deep-end flutter (the owner\'s orgasm: 0,10,5,15,10,20,10,15,5,10,0 + a hold at the bottom, every 333 ms), then for the last pulseMs bursts of pulseCount decaying pulses with a rest at the bottom. Fitted from the reference.',
  [...RANGE(0, 40), N('amp', 'Flutter depth', 20, 1, 100, 1, 'pos'), N('periodMs', 'Flutter period', 333, 100, 2000, 1, 'ms'),
    N('holdMs', 'Hold at the bottom', 67, 0, 1000, 1, 'ms'), N('pulseMs', 'Pulse bursts at the end', 6000, 0, 120000, 100, 'ms'),
    N('pulseAmp', 'First pulse depth', 20, 1, 100, 1, 'pos'), INT('pulseCount', 'Pulses per burst', 4, 1, 12),
    N('pulseHalfMs', 'Pulse half-time', 50, 20, 500, 1, 'ms'), N('restMs', 'Rest between bursts', 183, 0, 3000, 1, 'ms'),
    N('restEndMs', 'Rest at the end', 183, 0, 3000, 1, 'ms')],
  (t0, t1, p) => {
    const lo = p.lo, cap = (v) => Math.min(p.hi, lo + v), keys = [];
    const push = (t, v) => keys.push({ t, p: cap(v), turn: true });
    const tp = Math.max(t0, t1 - p.pulseMs), pat = TREMOR_FIT.pattern, k = p.amp / TREMOR_FIT.peak;
    const step = Math.max(1, p.periodMs - p.holdMs) / (pat.length - 1);
    let t = t0;
    while (t < tp) {   // flutter cycles; the last one may run past tp (finish clips at t1)
      pat.forEach((v, i) => push(t + i * step, v * k));
      t += p.periodMs;
    }
    const span = Math.max(1, t1 - tp);
    while (t + 2 * p.pulseHalfMs * p.pulseCount <= t1) {   // whole bursts of decaying pulses; rest goes restMs -> restEndMs
      for (let i = 0; i < p.pulseCount; i++) {
        push(t, 0);
        push(t + p.pulseHalfMs, p.pulseAmp * (1 - i / p.pulseCount));
        t += 2 * p.pulseHalfMs;
      }
      push(t, 0);
      t += mix(p.restMs, p.restEndMs, (t - tp) / span);
    }
    if (!keys.length) push(t0, 0);
    push(Math.max(t, t1), 0);
    return keys;
  }, { defaults: { anchor: 'lo' } });

// ---------------------------------------------------------------- tracker turns: follow + carry

const KIND = { top: 1, hi: 1, out: 1, peak: 1, max: 1, up: 1, bottom: -1, lo: -1, in: -1, valley: -1, min: -1, down: -1 };
const kindOf = (k) => (typeof k === 'number' ? Math.sign(k) : KIND[k] ?? 0);
const turnCache = new WeakMap();

/** ctx.turns ([ms] or [{at, kind?}], any order) -> sorted [{t, k: +1 top | -1 bottom}] with strict alternation
 *  (missing kinds alternate from the previous; two equal kinds in a row get the missing opposite turn at
 *  their midpoint). Cached per array and start. */
export function prepTurns(turns, start = 'in') {
  let byStart = turnCache.get(turns);
  if (!byStart) turnCache.set(turns, (byStart = {}));
  if (byStart[start]) return byStart[start];
  const raw = turns.map((x) => (typeof x === 'number' ? { t: x, k: 0 } : { t: x.at ?? x.t, k: kindOf(x.kind) }))
    .filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  const first = raw.find((x) => x.k)?.k;
  const out = [];
  for (const x of raw) {
    const last = out[out.length - 1];
    if (last && x.t === last.t) continue;
    const k = x.k || (last ? -last.k : first ? (raw.indexOf(x) % 2 ? first : -first) : start === 'out' ? 1 : -1);
    if (last && k === last.k) out.push({ t: (last.t + x.t) / 2, k: -k, inserted: true });
    out.push({ t: x.t, k });
  }
  return (byStart[start] = out);
}

const lbT = (a, t) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].t < t) lo = m + 1; else hi = m; } return lo; };

/** The alternating turn times `follow` uses for [t0, t1] (plus one beyond each edge): tracked turns within
 *  contextMs, thinned (pairs closer than minHalfMs removed), gaps longer than max(gapFactor x local
 *  half-stroke, gapMinMs) and the edges carried at the local rate. -> [{t, k, carried?}] */
export function followTimes(t0, t1, p, ctx = {}) {
  const all = prepTurns(ctx.turns ?? [], p.start ?? 'in');
  const C = p.contextMs ?? 10000, gapMin = p.gapMinMs ?? 1500, gapFactor = p.gapFactor ?? 3;
  const defH = 1000 / Math.max(0.05, p.fallbackRate ?? 2.4);
  const localH = (ta, tb) => {
    const a = lbT(all, ta - C), b = lbT(all, tb + C + 1), d = [];
    for (let i = a + 1; i < b; i++) { const x = all[i].t - all[i - 1].t; if (x <= gapMin) d.push(x); }
    return d.length >= 2 ? median(d) : defH;
  };
  const T = [];
  for (const x of all.slice(lbT(all, t0 - C), lbT(all, t1 + C + 1))) {
    if (T.length && x.t - T[T.length - 1].t < (p.minHalfMs ?? 0)) T.pop(); // drop the pair: keeps alternation
    else T.push(x);
  }
  if (!T.length) {
    const out = [];
    let k = p.start === 'out' ? -1 : 1;
    for (let t = t0; ; t += defH) { out.push({ t, k, carried: true }); k = -k; if (t >= t1) break; }
    return out;
  }
  const out = [];
  if (T[0].t > t0) { // leading edge, carried backward
    const h = localH(T[0].t, T[0].t), lead = [];
    for (let t = T[0].t, k = T[0].k; t > t0;) { t -= h; k = -k; lead.push({ t, k, carried: true }); }
    out.push(...lead.reverse());
  }
  for (let i = 0; i < T.length; i++) {
    if (i > 0 && p.carry !== false) {
      const a = T[i - 1], b = T[i], gap = b.t - a.t, h = localH(a.t, b.t);
      if (gap > Math.max(gapFactor * h, gapMin)) {
        let n = Math.max(1, Math.round(gap / h));
        if ((n % 2 === 1) !== (a.k !== b.k)) n += gap / h >= n ? 1 : -1; // parity so the kinds meet b
        if (n < 1) n = 2;
        for (let j = 1; j < n; j++) out.push({ t: a.t + (j * gap) / n, k: j % 2 ? -a.k : a.k, carried: true });
      }
    }
    out.push(T[i]);
  }
  const last = out[out.length - 1];
  if (last.t < t1) { // trailing edge, carried forward
    const h = localH(last.t, last.t);
    for (let t = last.t, k = last.k; t < t1;) { t += h; k = -k; out.push({ t, k, carried: true }); }
  }
  return out;
}

const FOLLOW_SCHEMA = [
  BOOL('carry', 'Carry the rate through gaps', true),
  N('gapFactor', 'A gap is longer than this x the local half-stroke', 3, 1.5, 10, 0.5),
  N('gapMinMs', 'and longer than', 1500, 200, 10000, 100, 'ms'),
  RATE('fallbackRate', 'Rate when nothing is tracked nearby', 2.4),
  N('minHalfMs', 'Thin half-strokes shorter than', 60, 0, 500, 5, 'ms'),
  N('contextMs', 'Context window', 10000, 1000, 60000, 1000, 'ms'),
];

export const follow = define('follow', 'Follow tracked strokes',
  'Extremes at the tracker turning points (ctx.turns) with this range and shape; gaps and edges carried at the local rate; too-fast strokes shrink toward the anchor.',
  [...RANGE(0, 85), SHAPE('linear'), START, ...FOLLOW_SCHEMA],
  (t0, t1, p, ctx) => followTimes(t0, t1, p, ctx).map((x) => ({ t: x.t, p: x.k > 0 ? p.hi : p.lo, turn: true })));

// ---------------------------------------------------------------- knot pop

export const knot = define('knot', 'Knot pop',
  'Shallow bumps held back at the knot level, then a press, a resisted push through to full depth, a dwell (with a little grind), a resisted pull and a pop back out; repeats every `between` bumps. Optionally gets tied: small motion at the deep end for the rest of the segment.',
  [...RANGE(0, 85), N('knotLevel', 'Knot level', 30, 0, 100, 1, 'pos'), RATE('rate', 'Bump rate', 2.4),
    INT('between', 'Bumps between pops', 4, 0, 32), N('pressMs', 'Press against the knot', 160, 0, 2000, 10, 'ms'),
    N('pushMs', 'Push through', 650, 50, 5000, 10, 'ms'), N('resist', 'Resistance (time share of the first quarter of the push)', 0.6, 0.25, 0.9, 0.05),
    N('dwellMs', 'Dwell at depth', 450, 0, 10000, 10, 'ms'), N('grind', 'Grind at depth', 3, 0, 20, 1, 'pos'),
    N('pullMs', 'Resisted pull', 260, 0, 3000, 10, 'ms'), N('popMs', 'Pop out', 140, 30, 2000, 10, 'ms'),
    BOOL('tied', 'Gets tied', false), INT('popsBeforeTie', 'Pops before it ties', 2, 0, 50),
    N('tiedAmp', 'Tied motion depth', 10, 0, 50, 1, 'pos'), RATE('tiedRate', 'Tied motion rate', 2),
    CHOICE('timing', 'Bump timing', 'auto', ['auto', 'rate', 'follow']), ...FOLLOW_SCHEMA],
  (t0, t1, p, ctx) => {
    const maxSpeed = ctx.maxSpeed ?? DEFAULTS.maxSpeed;
    const lo = p.lo, hi = p.hi, kl = clamp(p.knotLevel, lo, hi);
    const push = { name: 'custom', knots: [[clamp(p.resist, 0.05, 0.95), 0.25]] };
    let t = t0, pos = hi;
    const keys = [{ t, p: pos, turn: true }];
    const mv = (to, d, shape) => {
      const need = maxSpeed > 0 ? (Math.abs(to - pos) * slopeOf(shape) * 1000) / maxSpeed / 0.97 : 0;
      t += Math.max(d, need, 1); pos = to;
      keys.push({ t, p: to, turn: true, shape });
    };
    const useFollow = p.timing === 'follow' || (p.timing === 'auto' && (ctx.turns?.length ?? 0) > 0);
    const times = useFollow ? followTimes(t0, t1, p, ctx).map((x) => x.t) : null;
    let ti = 0;
    const half = () => {
      if (times) { while (ti < times.length && times[ti] <= t + 40) ti++; if (ti < times.length) return times[ti] - t; }
      return 1000 / Math.max(0.02, p.rate);
    };
    let pops = 0;
    while (t < t1) {
      for (let b = 0; b < p.between && t < t1; b++) { mv(kl, half(), BUMP); mv(hi, half(), SINE); }
      if (t >= t1) break;
      mv(kl, half(), BUMP);                          // approach: catches on the knot
      mv(Math.max(lo, kl - 3), p.pressMs, LIN);      // presses against it
      mv(lo, p.pushMs, push);                        // resists, then slips through
      const g = p.grind > 0 ? Math.floor(p.dwellMs / 200) : 0;
      if (g) for (let i = 0; i < g; i++) { mv(lo + p.grind, p.dwellMs / (2 * g), LIN); mv(lo, p.dwellMs / (2 * g), LIN); }
      else if (p.dwellMs > 0) { t += p.dwellMs; keys.push({ t, p: lo, shape: LIN }); }
      if (p.tied && pops >= p.popsBeforeTie) {       // tied: tugging at the deep end until the segment ends
        const h = 1000 / Math.max(0.02, p.tiedRate);
        while (t < t1) { mv(lo + p.tiedAmp, h, SINE); mv(lo, h, SINE); }
        break;
      }
      mv(lo + (kl - lo) * 0.5, p.pullMs, EASE_IN);   // pulls against the knot
      mv(hi, p.popMs, POP);                          // pops out
      pops++;
    }
    return keys;
  });

// ---------------------------------------------------------------- knot on every stroke

/** Fit of the owner's hand-made knot-pop scripting (10 full cycles of one reference scene): every stroke
 *  passes the knot. Moves of one cycle, starting at full depth: 0 pull out against the knot (slow), 1 pop out
 *  (near-instant), 2 rise to the top, 3 back down to the knot, 4 press against it (slow), 5 pop in.
 *  fractions = median share of the cycle per move; absorb = share of (cycle - refMs) each move takes when the
 *  cycle is longer or shorter (regression slopes; the pops keep their duration); *Sd = measured spread. */
export const KNOT_STROKE_FIT = Object.freeze({
  refMs: 1083,                                        // median cycle; 875..1375 ms seen
  fractions: [0.270, 0.077, 0.132, 0.326, 0.157, 0.038],
  absorb: [0.475, 0, 0.119, 0.317, 0.089, 0],
  pos: { lo: 0, knotOut: 17, popTo: 64, hi: 80, knotIn: 30, press: 20 },
  periodSd: 0.164,                                    // relative sd of the cycle length
  knotInSd: 1.22,                                     // pos sd of the knot-in level (29..33); the other levels never vary
  popSpeed: [566, 482],                               // pos/s of the pop out / pop in
});

/** Six move durations for one cycle from its out half (depth -> top) and in half (top -> depth). */
function knotStrokeMoves(Hout, Hin, p, need) {
  const f = [p.fPull, p.fPopOut, p.fTop, p.fDown, p.fPress, p.fPopIn].map((x) => Math.max(0, x));
  const sum = f.reduce((a, b) => a + b, 0) || 1, R0 = KNOT_STROKE_FIT.refMs, A = KNOT_STROKE_FIT.absorb;
  const m = f.map((x) => (x / sum) * R0);
  const half = (H, a, pop, b) => {
    const H0 = m[a] + m[pop] + m[b];
    let dp = m[pop] * (1 + clamp(p.popScale, 0, 1) * (H / Math.max(1, H0) - 1));
    dp = Math.max(Math.min(dp, 0.4 * H), need[pop], 1);
    const ps = clamp(p.popScale, 0, 1), sa = A[a] + A[b], sm = m[a] + m[b] || 1; // popScale 1: everything proportional
    const R = Math.max(H - dp, 2), wa = (1 - ps) * (A[a] / sa) + ps * (m[a] / sm) + 1e-9, wb = (1 - ps) * (A[b] / sa) + ps * (m[b] / sm) + 1e-9;
    const da = clamp(m[a] + (wa / (wa + wb)) * (R - m[a] - m[b]), 0.15 * R, 0.85 * R);
    return [da, dp, R - da];
  };
  const [d0, d1, d2] = half(Hout, 0, 1, 2), [d3, d5, d4] = half(Hin, 3, 5, 4);
  return [d0, d1, d2, d3, d4, d5];
}

export const knotStroke = define('knot-stroke', 'Knot on every stroke',
  'The owner\'s knot-pop scripting: every stroke passes the knot. From full depth a slow pull against the knot to knotOut, a near-instant pop out to popTo, up to the top, back down to the knot (knotIn), a slow press to `press`, and a near-instant pop in. Pops keep their measured duration and may move at up to popSpeed (above the global cap); seeded variation matches the measured spread. Timing from ctx.turns (one cycle per in/out pair) or rate.',
  [RATE('rate', 'Rate (2 turns = 1 cycle)', 1.85), N('lo', 'Full depth', 0, 0, 100, 1, 'pos'), N('hi', 'Top', 80, 0, 100, 1, 'pos'),
    N('knotOut', 'Knot level on the way out', 17, 0, 100, 1, 'pos'), N('popTo', 'Pop out lands at', 64, 0, 100, 1, 'pos'),
    N('knotIn', 'Knot level on the way in', 30, 0, 100, 1, 'pos'), N('press', 'Press against the knot to', 20, 0, 100, 1, 'pos'),
    N('fPull', 'Pull against the knot (share of cycle)', 0.270, 0, 1, 0.005), N('fPopOut', 'Pop out (share)', 0.077, 0, 1, 0.005),
    N('fTop', 'Up to the top (share)', 0.132, 0, 1, 0.005), N('fDown', 'Down to the knot (share)', 0.326, 0, 1, 0.005),
    N('fPress', 'Press (share)', 0.157, 0, 1, 0.005), N('fPopIn', 'Pop in (share)', 0.038, 0, 1, 0.005),
    N('popScale', 'Pops scale with the cycle (0 = keep their duration)', 0, 0, 1, 0.05),
    N('popSpeed', 'Pop speed allowance (0 = global cap)', 600, 0, 2000, 10, 'pos/s'),
    N('variation', 'Variation (1 = as measured)', 1, 0, 3, 0.05, 'x'),
    CHOICE('timing', 'Stroke timing', 'auto', ['auto', 'rate', 'follow']), ...FOLLOW_SCHEMA],
  (t0, t1, p, ctx, rng) => {
    const F = KNOT_STROKE_FIT, maxSpeed = ctx.maxSpeed ?? DEFAULTS.maxSpeed, v = Math.max(0, p.variation);
    const L = (x) => clamp(x, p.lo, p.hi);
    const lv = { out: L(p.knotOut), pop: L(p.popTo), in: L(p.knotIn), press: L(p.press) };
    const popCap = p.popSpeed > 0 ? Math.max(p.popSpeed, maxSpeed) : maxSpeed;
    const need = [0, 0, 0, 0, 0, 0];
    if (popCap > 0) { need[1] = (Math.abs(lv.pop - lv.out) * 1000) / popCap / 0.97; need[5] = (Math.abs(lv.press - p.lo) * 1000) / popCap / 0.97; }
    const cap = p.popSpeed > 0 ? p.popSpeed : undefined;
    const sum = p.fPull + p.fPopOut + p.fTop + p.fDown + p.fPress + p.fPopIn || 1;
    const outShare = (p.fPull + p.fPopOut + p.fTop) / sum, A = F.absorb;
    const outAbsorb = (1 - clamp(p.popScale, 0, 1)) * ((A[0] + A[2]) / (A[0] + A[2] + A[3] + A[4])) + clamp(p.popScale, 0, 1) * outShare;
    const splitCycle = (len) => { const h = clamp(outShare * F.refMs + outAbsorb * (len - F.refMs), 0.2 * len, 0.8 * len); return [h, len - h]; };
    const keys = [];
    const cycle = (t, Hout, Hin) => {
      const d = knotStrokeMoves(Hout, Hin, p, need);
      const ki = L(lv.in + v * F.knotInSd * Math.sqrt(3) * (2 * rng() - 1));
      if (!keys.length) keys.push({ t, p: p.lo, turn: true });
      const seq = [[lv.out, false], [lv.pop, true], [p.hi, false], [ki, false], [lv.press, false], [p.lo, true]];
      seq.forEach(([pos, pop], i) => { t += d[i]; keys.push({ t, p: pos, turn: i === 2 || i === 5, shape: pop ? LIN : undefined, cap: pop ? cap : undefined }); });
      return t;
    };
    const useFollow = p.timing === 'follow' || (p.timing === 'auto' && (ctx.turns?.length ?? 0) > 0);
    if (useFollow) {
      const T = followTimes(t0, t1, p, ctx);
      const [refOut, refIn] = splitCycle(F.refMs);
      // followTimes always has a turn at or before t0; cycles run bottom -> top -> bottom
      let b = -1;
      for (let j = 0; j < T.length && T[j].t <= t0; j++) if (T[j].k < 0) b = j;
      let i = b >= 0 ? b + 1 : T.findIndex((x) => x.k > 0);
      let t = b >= 0 ? T[b].t : i >= 0 ? T[i].t - refOut : t0;
      if (i < 0) i = T.length;
      while (t < t1) {
        const top = T[i]?.k > 0 ? T[i].t : t + refOut;
        const bot = T[i + 1]?.k < 0 ? T[i + 1].t : top + refIn;
        t = cycle(t, top - t, bot - top);
        i += 2;
      }
    } else {
      let t = t0;
      while (t < t1) {
        const len = Math.max(200, (2000 / Math.max(0.02, p.rate)) * (1 + v * F.periodSd * Math.sqrt(3) * (2 * rng() - 1)));
        const [Hout, Hin] = splitCycle(len);
        t = cycle(t, Hout, Hin);
      }
    }
    return keys;
  });

// ---------------------------------------------------------------- tease

export const tease = define('tease', 'Tease',
  'Shallow strokes at the out edge of the range; every few strokes a dip that stops short, pauses, and retreats (sometimes, by chance `full`, it goes all the way).',
  [...RANGE(0, 95), RATE('rate', 'Rate', 2), N('edge', 'Shallow stroke depth', 0.3, 0.05, 1, 0.05, 'x range'),
    INT('every', 'Shallow strokes per dip', 3, 0, 20), N('dip', 'Dip depth', 0.7, 0, 1, 0.05, 'x range'),
    N('pauseMs', 'Pause where the dip stops', 350, 0, 3000, 10, 'ms'), N('full', 'Chance a dip goes all the way', 0.15, 0, 1, 0.05),
    N('variation', 'Variation', 0.2, 0, 1, 0.05, 'x'), SHAPE('sine')],
  (t0, t1, p, ctx, rng) => {
    const R = p.hi - p.lo, half = 1000 / Math.max(0.02, p.rate), v = clamp(p.variation, 0, 1);
    let t = t0, pos = p.hi;
    const keys = [{ t, p: pos, turn: true }];
    const mv = (to, d, shape) => { t += d; pos = to; keys.push({ t, p: to, turn: true, shape }); };
    while (t < t1) {
      for (let i = 0; i < p.every && t < t1; i++) { mv(p.hi - p.edge * R * (1 - v * rng()), half); mv(p.hi, half); }
      if (t >= t1) break;
      if (rng() < p.full) { mv(p.lo, half * 1.5); mv(p.hi, half * 1.5); continue; }
      mv(p.hi - p.dip * R * (1 - 0.5 * v * rng()), half * 1.4, EASE_OUT);
      if (p.pauseMs > 0) { t += p.pauseMs; keys.push({ t, p: pos, shape: LIN }); }
      mv(p.hi, half, EASE_IN);
    }
    return keys;
  });

// ---------------------------------------------------------------- tease at the top (Autorange dead-gap fill)

export const teaseTop = define('tease-top', 'Tease at the top',
  'Slow, shallow eased strokes at the out end of lo..hi (a dead gap\'s fill: dynamic, never dramatic): seeded variation in each half-stroke\'s length and each stroke\'s depth, now and then a stroke held at the top. The deepest stroke reaches lo.',
  [...RANGE(80, 100), RATE('rate', 'Rate', 0.67), N('periodJitter', 'Stroke length variation', 0.2, 0, 0.5, 0.05, 'x'),
    N('ampJitter', 'Stroke depth variation', 0.3, 0, 0.5, 0.05, 'x'), N('pause', 'Chance a stroke holds at the top', 0.12, 0, 0.5, 0.01), SHAPE('sine')],
  (t0, t1, p, ctx, rng) => {
    const depth = (p.hi - p.lo) / (1 + p.ampJitter), half = 1000 / Math.max(0.02, p.rate), len = () => half * (1 + p.periodJitter * (2 * rng() - 1));
    let t = t0;
    const keys = [{ t, p: p.hi, turn: true }];
    while (t < t1) {
      if (rng() < p.pause) { t += 2 * len(); keys.push({ t, p: p.hi, shape: LIN }); continue; }
      t += len(); keys.push({ t, p: p.hi - depth * (1 + p.ampJitter * (2 * rng() - 1)), turn: true });
      t += len(); keys.push({ t, p: p.hi, turn: true });
    }
    return keys;
  });

// ---------------------------------------------------------------- taps / beats

export const beats = define('beats', 'Taps / beats',
  'Extremes on a list of tap or beat times (params.times, else ctx.beats, else ctx.taps; ms or {at}). alternate: beats alternate deep / out. hit: every beat is a deep hit with an out point between beats.',
  [...RANGE(0, 85), SHAPE('linear'), START, CHOICE('mode', 'Mode', 'alternate', ['alternate', 'hit']),
    INT('every', 'Use every nth beat', 1, 1, 16), N('offsetMs', 'Offset', 0, -1000, 1000, 1, 'ms'),
    N('outFrac', 'Hit mode: time of the out point between beats', 0.5, 0.1, 0.9, 0.05)],
  (t0, t1, p, ctx) => {
    const src = (p.times ?? ctx.beats ?? ctx.taps ?? []).map((b) => (typeof b === 'number' ? b : b.at)).filter(Number.isFinite).sort((a, b) => a - b);
    const all = src.filter((b, i) => i === 0 || b > src[i - 1]).filter((_, i) => i % Math.max(1, p.every) === 0).map((b) => b + p.offsetMs);
    if (!all.length) return [];
    const iv = all.length > 1 ? median(all.slice(1).map((b, i) => b - all[i])) : 1000;
    const i0 = Math.max(0, all.findIndex((b) => b >= t0) - 1), i1 = all.findIndex((b) => b > t1);
    const B = all.slice(i0, i1 < 0 ? all.length : i1 + 1);
    const keys = [];
    if (p.mode === 'hit') {
      if (B[0] > t0) keys.push({ t: B[0] - (1 - p.outFrac) * iv, p: p.hi, turn: true });
      B.forEach((b, i) => {
        keys.push({ t: b, p: p.lo, turn: true });
        const next = B[i + 1] ?? b + iv;
        if (i < B.length - 1 || b < t1) keys.push({ t: b + p.outFrac * (next - b), p: p.hi, turn: true });
      });
    } else {
      const deepFirst = (p.start !== 'out') === (i0 % 2 === 0); // parity from the whole list: stable per beat
      const posOf = (i) => ((i % 2 === 0) === deepFirst ? p.lo : p.hi);
      if (B[0] > t0) keys.push({ t: B[0] - iv, p: posOf(1), turn: true });
      B.forEach((b, i) => keys.push({ t: b, p: posOf(i), turn: true }));
      if (B[B.length - 1] < t1) keys.push({ t: B[B.length - 1] + iv, p: posOf(B.length), turn: true });
    }
    return keys;
  });

export { SHAPES };
