// Signal nodes (DESIGN §7 "Signal"): typed-array kernels on the graph grid, NaN-aware, no per-sample allocation.
// Every node writes its output on ctx.grid(); inputs are read by absolute grid index (reader()), so a local node
// can look into the halo its input carries.
//
// PROVENANCE: OpenValence/Phosphor (same owner, Apache-2.0), src/model/graph.js: the MATH table (l.435-494) is the
// model for sig.math; lowpassStep / slewStep (l.58-78) are rewritten as whole-array functions run forward and back
// (zero phase, so offline smoothing never adds lag).

import { defineNode } from '../model.js';
import { normalize } from '../../core/script.js';
import { CURVES, hashSeed, mulberry32 } from '../../gen/util.js';
import { simplify } from '../../edit/index.js';
import { makeSignal, signalAt, typeOfValue } from '../types.js';
import { parseExpr } from './expr.js';
import {
  num, bool, choice, text, modNum, seedParam, script, signal, spans, any, req, points,
  genSignal, reader, finiteRuns, percentileOf, zigzag, refine, WAVES, WAVE_NAMES,
} from './util.js';

const G = 'Signal';
const GG = 'Signal · generators';
const unary = (extra = {}) => ({ ins: [signal('signal', req)], outs: [signal()], bypass: { signal: 'signal' }, ...extra });

/** Out signal on ctx.grid(): y[k] = f(x(i), i, t) with x read by absolute index. */
function mapGrid(ctx, x, f, range) {
  const g = ctx.grid(), rd = reader(x);
  return genSignal(ctx, (k, t) => f(rd(g.i0 + k), g.i0 + k, t), range);
}

// ---------------------------------------------------------------- maths

// fn: [label, uses b, f(a, b, w, lo, hi)]
const MATH = {
  add: ['Add', true, (a, b) => a + b],
  sub: ['Subtract', true, (a, b) => a - b],
  mul: ['Multiply', true, (a, b) => a * b],
  div: ['Divide', true, (a, b) => a / b],
  min: ['Minimum', true, Math.min],
  max: ['Maximum', true, Math.max],
  pow: ['Power', true, Math.pow],
  absdiff: ['Absolute difference', true, (a, b) => Math.abs(a - b)],
  avg: ['Average', true, (a, b) => (a + b) / 2],
  mix: ['Mix (by w)', true, (a, b, w) => a + (b - a) * w],
  clamp: ['Clamp (lo..hi)', false, (a, _b, _w, lo, hi) => Math.min(Math.max(lo, hi), Math.max(Math.min(lo, hi), a))],
  abs: ['Absolute', false, Math.abs],
  neg: ['Negate', false, (a) => -a],
};

export const math = defineNode({
  type: 'sig.math', title: 'Math', group: G, icon: 'plus',
  aliases: ['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'mix', 'crossfade', 'average', 'clamp', 'abs', 'arithmetic'],
  help: 'Elementwise maths on A and B (the B input, or the B param when unconnected). Mix crossfades A→B by w (wire a signal into w). NaN propagates; division by zero is NaN.',
  ins: [signal('a', req), signal('b')], outs: [signal()],
  params: [
    choice('fn', 'Operation', 'add', Object.keys(MATH).map((k) => ({ value: k, label: MATH[k][0] }))),
    modNum('b', 'B', 0, -1e6, 1e6, 0.1, { inline: true }),
    modNum('w', 'w (mix)', 0.5, 0, 1, 0.01),
    modNum('lo', 'lo (clamp)', 0, -1e6, 1e6, 1),
    modNum('hi', 'hi (clamp)', 100, -1e6, 1e6, 1),
  ],
  halo: () => 0, local: true, bypass: { signal: 'a' },
  eval({ a, b }, p, ctx) {
    const f = (MATH[p.fn] ?? MATH.add)[2];
    const rb = b ? reader(b) : null, pb = ctx.param('b'), pw = ctx.param('w'), plo = ctx.param('lo'), phi = ctx.param('hi');
    return { signal: mapGrid(ctx, a, (x, i, t) => f(x, rb ? rb(i) : pb(t), pw(t), plo(t), phi(t))) };
  },
});

export const expr = defineNode({
  type: 'sig.expr', title: 'Expression', group: G, icon: 'terminal',
  aliases: ['formula', 'equation', 'custom', 'maths', 'function', 'code'],
  help: 'A formula over inputs a b c d, t (ms) and s (seconds): + - * / % ^, comparisons and && || ! (0/1), c ? x : y, sin cos tan abs min max clamp mix pow exp log sqrt floor ceil round sign fract smoothstep tri saw sqr (period 1), isnan, nz(x, d); constants pi tau e. NaN in gives NaN out.',
  ins: [signal('a'), signal('b'), signal('c'), signal('d')], outs: [signal()],
  params: [text('expr', 'Expression', 'a', { editor: 'expr', inline: true })],
  halo: () => 0, local: true, bypass: { signal: 'a' },
  eval(ins, p, ctx) {
    const { fn, vars } = parseExpr(String(p.expr ?? ''));
    const rd = {};
    for (const k of ['a', 'b', 'c', 'd']) if (vars.has(k)) { if (!ins[k]) throw new Error(`"${k}" is used but its input is not connected`); rd[k] = reader(ins[k]); }
    const g = ctx.grid(), V = { a: NaN, b: NaN, c: NaN, d: NaN, t: 0, s: 0 };
    return { signal: genSignal(ctx, (k, t) => {
      const i = g.i0 + k;
      if (rd.a) V.a = rd.a(i); if (rd.b) V.b = rd.b(i); if (rd.c) V.c = rd.c(i); if (rd.d) V.d = rd.d(i);
      V.t = t; V.s = t / 1000;
      return fn(V);
    }) };
  },
});

export const remap = defineNode({
  ...unary(), type: 'sig.remap', title: 'Map range', group: G, icon: 'expand',
  aliases: ['scale', 'rescale', 'map', 'range', 'normalize'],
  help: 'Maps In low..In high linearly onto Out low..Out high (optionally clamped). The out ends are time-varying.',
  params: [num('inLo', 'In low', 0, -1e6, 1e6, 0.1), num('inHi', 'In high', 100, -1e6, 1e6, 0.1),
    modNum('outLo', 'Out low', 0, -1e6, 1e6, 0.1, { inline: true }), modNum('outHi', 'Out high', 100, -1e6, 1e6, 0.1, { inline: true }), bool('clamp', 'Clamp', true)],
  halo: () => 0, local: true,
  eval({ signal: x }, p, ctx) {
    const lo = ctx.param('outLo'), hi = ctx.param('outHi'), span = p.inHi - p.inLo;
    if (span === 0) throw new Error('In low and In high are equal');
    return { signal: mapGrid(ctx, x, (v, _i, t) => {
      let u = (v - p.inLo) / span;
      if (p.clamp) u = Math.min(1, Math.max(0, u));
      const l = lo(t);
      return l + u * (hi(t) - l);
    }) };
  },
});

export const clamp = defineNode({
  ...unary(), type: 'sig.clamp', title: 'Clamp', group: G, icon: 'normalize',
  aliases: ['limit', 'bound'],
  help: 'Keeps values inside Low..High (time-varying).',
  params: [modNum('lo', 'Low', 0, -1e6, 1e6, 1, { inline: true }), modNum('hi', 'High', 100, -1e6, 1e6, 1, { inline: true })],
  halo: () => 0, local: true,
  eval({ signal: x }, _p, ctx) {
    const lo = ctx.param('lo'), hi = ctx.param('hi');
    return { signal: mapGrid(ctx, x, (v, _i, t) => { const l = lo(t), h = hi(t); return Math.min(Math.max(l, h), Math.max(Math.min(l, h), v)); }) };
  },
});

export const curve = defineNode({
  ...unary(), type: 'sig.curve', title: 'Curve', group: G, icon: 'bezier',
  aliases: ['ease', 'easing', 'gamma', 'response'],
  help: 'Normalises Low..High to 0..1, bends it through an easing curve and a gamma, and maps it back.',
  params: [choice('curve', 'Curve', 'linear', Object.keys(CURVES).filter((c) => c !== 'step')), modNum('gamma', 'Gamma', 1, 0.1, 10, 0.05, { inline: true }),
    num('lo', 'Low', 0, -1e6, 1e6, 1), num('hi', 'High', 100, -1e6, 1e6, 1)],
  halo: () => 0, local: true,
  eval({ signal: x }, p, ctx) {
    const f = CURVES[p.curve] ?? CURVES.linear, g = ctx.param('gamma'), span = p.hi - p.lo;
    if (span === 0) throw new Error('Low and High are equal');
    return { signal: mapGrid(ctx, x, (v, _i, t) => { const u = Math.min(1, Math.max(0, (v - p.lo) / span)); return p.lo + span * Math.pow(f(u), Math.max(0.01, g(t))); }) };
  },
});

export const quantise = defineNode({
  ...unary(), type: 'sig.quantise', title: 'Quantise values', group: G, icon: 'grid',
  aliases: ['steps', 'round', 'quantize', 'posterize'],
  help: 'Rounds every value to a multiple of Step.',
  params: [num('step', 'Step', 5, 0.001, 1000, 0.5, { inline: true })],
  halo: () => 0, local: true,
  eval: ({ signal: x }, p, ctx) => ({ signal: mapGrid(ctx, x, (v) => Math.round(v / p.step) * p.step) }),
});

// ---------------------------------------------------------------- filters

const radius = (ms, dt) => Math.max(0, Math.round(ms / 2 / dt));

function savgolW(r) { // quadratic/cubic Savitzky–Golay smoothing weights over 2r+1 points
  const den = (2 * r + 1) * (4 * r * r + 4 * r - 3);
  return Array.from({ length: 2 * r + 1 }, (_, j) => (3 * (3 * r * r + 3 * r - 1) - 15 * (j - r) * (j - r)) / den);
}

// first-order low-pass, forward then backward, per finite run (Phosphor lowpassStep as a whole-array pass)
function onepole(v, tauMs, dt) {
  const out = Float32Array.from(v), a = tauMs > 0 ? 1 - Math.exp(-dt / tauMs) : 1;
  for (const [k0, k1] of finiteRuns(v)) {
    let y = out[k0];
    for (let k = k0; k < k1; k++) { y += (out[k] - y) * a; out[k] = y; }
    y = out[k1 - 1];
    for (let k = k1 - 1; k >= k0; k--) { y += (out[k] - y) * a; out[k] = y; }
  }
  return out;
}

export const smooth = defineNode({
  ...unary(), type: 'sig.smooth', title: 'Smooth', group: G, icon: 'smooth',
  aliases: ['lowpass', 'filter', 'blur', 'average', 'savgol', 'gaussian', 'denoise'],
  help: 'Zero-phase smoothing (never adds lag): moving average, gaussian, Savitzky–Golay (keeps peaks) or a one-pole low-pass run forward and back. Gaps stay gaps.',
  params: [choice('method', 'Method', 'gaussian', ['gaussian', 'moving', 'savgol', 'onepole']), num('windowMs', 'Window', 200, 0, 10000, 10, { unit: 'ms', inline: true })],
  halo: (p) => (p.method === 'onepole' ? Infinity : p.windowMs), local: true,
  eval({ signal: x }, p, ctx) {
    const g = ctx.grid(), dt = g.dt;
    if (p.method === 'onepole') {
      const y = onepole(x.v, p.windowMs / 2, dt);
      return { signal: mapGrid(ctx, { i0: x.i0, dt, v: y }, (v) => v) };
    }
    const rd = reader(x);
    let r, w;
    if (p.method === 'gaussian') {
      const sigma = p.windowMs / 4 / dt;
      r = Math.ceil(3 * sigma);
      w = Array.from({ length: 2 * r + 1 }, (_, j) => (sigma > 0 ? Math.exp(-((j - r) ** 2) / (2 * sigma * sigma)) : 1));
    } else {
      r = radius(p.windowMs, dt);
      w = p.method === 'savgol' && r >= 2 ? savgolW(r) : new Array(2 * r + 1).fill(1);
    }
    const sg = p.method === 'savgol' && r >= 2;
    return { signal: genSignal(ctx, (k) => {
      const i = g.i0 + k;
      if (rd(i) !== rd(i)) return NaN;
      let acc = 0, ws = 0, gap = false;
      for (let j = -r; j <= r; j++) { const v = rd(i + j); if (v === v) { acc += v * w[j + r]; ws += w[j + r]; } else gap = true; }
      if (sg && gap) { // a gap inside the window: fall back to the plain mean of what is there
        acc = 0; ws = 0;
        for (let j = -r; j <= r; j++) { const v = rd(i + j); if (v === v) { acc += v; ws++; } }
      }
      return sg && !gap ? acc : acc / ws;
    }) };
  },
});

export const median = defineNode({
  ...unary(), type: 'sig.median', title: 'Median', group: G, icon: 'filter',
  aliases: ['despike', 'outliers', 'impulse', 'denoise'],
  help: 'Running median over the window: removes single-frame spikes and keeps edges sharp. Gaps stay gaps.',
  params: [num('windowMs', 'Window', 100, 0, 5000, 10, { unit: 'ms', inline: true })],
  halo: (p) => p.windowMs, local: true,
  eval({ signal: x }, p, ctx) {
    const g = ctx.grid(), rd = reader(x), r = radius(p.windowMs, g.dt), buf = new Float64Array(2 * r + 1);
    return { signal: genSignal(ctx, (k) => {
      const i = g.i0 + k;
      if (rd(i) !== rd(i)) return NaN;
      let m = 0;
      for (let j = -r; j <= r; j++) { const v = rd(i + j); if (v === v) buf[m++] = v; }
      const s = buf.subarray(0, m).sort(), h = m >> 1;
      return m % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
    }) };
  },
});

export const slew = defineNode({
  ...unary(), type: 'sig.slew', title: 'Slew limit', group: G, icon: 'speed',
  aliases: ['rate limit', 'speed limit', 'max speed', 'slope'],
  help: 'Limits how fast the value may change (units per second), forward and then backward so it stays centred. Restarts after every gap.',
  params: [num('maxPerSec', 'Max change', 400, 0.1, 100000, 10, { unit: '/s', inline: true })],
  eval({ signal: x }, p, ctx) {
    const out = Float32Array.from(x.v), step = (p.maxPerSec * x.dt) / 1000;
    for (const [k0, k1] of finiteRuns(out)) { // Phosphor slewStep, both directions
      for (let k = k0 + 1; k < k1; k++) out[k] = Math.min(out[k - 1] + step, Math.max(out[k - 1] - step, out[k]));
      for (let k = k1 - 2; k >= k0; k--) out[k] = Math.min(out[k + 1] + step, Math.max(out[k + 1] - step, out[k]));
    }
    return { signal: mapGrid(ctx, { i0: x.i0, dt: x.dt, v: out }, (v) => v) };
  },
});

export const fillGaps = defineNode({
  ...unary(), type: 'sig.fillGaps', title: 'Fill gaps', group: G, icon: 'magnet',
  aliases: ['interpolate', 'bridge', 'dropouts', 'hold', 'carry', 'repair', 'nan'],
  help: 'Fills unknown (NaN) stretches no longer than Max gap: linear bridges them, hold keeps the last value. Longer gaps stay unknown.',
  params: [num('maxGapMs', 'Max gap', 500, 0, 60000, 10, { unit: 'ms', inline: true }), choice('mode', 'Mode', 'linear', ['linear', 'hold', 'none'])],
  halo: (p) => p.maxGapMs, local: true,
  eval({ signal: x }, p, ctx) {
    const g = ctx.grid(), rd = reader(x), m = Math.floor(p.maxGapMs / g.dt);
    return { signal: genSignal(ctx, (k) => {
      const i = g.i0 + k, v = rd(i);
      if (v === v || p.mode === 'none') return v;
      let L = -1, R = -1;
      for (let j = 1; j <= m; j++) if (rd(i - j) === rd(i - j)) { L = i - j; break; }
      if (L < 0) return NaN;
      for (let j = 1; i + j - L <= m + 1; j++) if (rd(i + j) === rd(i + j)) { R = i + j; break; }
      if (R < 0 || R - L - 1 > m) return NaN;
      return p.mode === 'hold' ? rd(L) : rd(L) + ((rd(R) - rd(L)) * (i - L)) / (R - L);
    }) };
  },
});

export const normalise = defineNode({
  ...unary(), type: 'sig.normalise', title: 'Normalize', group: G, icon: 'normalize',
  aliases: ['auto range', 'stretch', 'percentile', 'auto gain', 'normalize', 'local'],
  help: 'Maps the Low..High percentiles onto Out low..Out high: over the whole signal (global) or a sliding window (local, follows changing amplitude).',
  params: [choice('mode', 'Mode', 'global', ['global', 'local']),
    num('pLo', 'Low percentile', 2, 0, 100, 1, { unit: '%' }), num('pHi', 'High percentile', 98, 0, 100, 1, { unit: '%' }),
    num('windowMs', 'Window (local)', 10000, 500, 600000, 500, { unit: 'ms' }),
    num('outLo', 'Out low', 0, -1e6, 1e6, 1), num('outHi', 'Out high', 100, -1e6, 1e6, 1), bool('clamp', 'Clamp', true)],
  halo: (p) => (p.mode === 'local' ? p.windowMs : Infinity), local: true,
  eval({ signal: x }, p, ctx) {
    const map = (v, lo, hi) => {
      if (!(hi > lo)) return (p.outLo + p.outHi) / 2;
      let u = (v - lo) / (hi - lo);
      if (p.clamp) u = Math.min(1, Math.max(0, u));
      return p.outLo + u * (p.outHi - p.outLo);
    };
    if (p.mode !== 'local') {
      const lo = percentileOf(x.v, p.pLo), hi = percentileOf(x.v, p.pHi);
      return { signal: mapGrid(ctx, x, (v) => map(v, lo, hi)) };
    }
    // local: percentiles at block centres on absolute multiples of windowMs/4, linear between centres
    const g = ctx.grid(), dt = g.dt, step = p.windowMs / 4, half = Math.round(p.windowMs / 2 / dt), rd = reader(x);
    const memo = new Map(), buf = new Float32Array(2 * half + 1);
    const at = (m) => {
      if (memo.has(m)) return memo.get(m);
      const c = Math.round((m * step) / dt);
      for (let j = -half; j <= half; j++) buf[j + half] = rd(c + j);
      const r = [percentileOf(buf, p.pLo), percentileOf(buf, p.pHi)];
      memo.set(m, r);
      return r;
    };
    return { signal: genSignal(ctx, (k, t) => {
      const v = rd(g.i0 + k);
      if (v !== v) return NaN;
      const m = Math.floor(t / step), u = (t - m * step) / step, A = at(m), B = at(m + 1);
      const lo = A[0] === A[0] ? (B[0] === B[0] ? A[0] + (B[0] - A[0]) * u : A[0]) : B[0];
      const hi = A[1] === A[1] ? (B[1] === B[1] ? A[1] + (B[1] - A[1]) * u : A[1]) : B[1];
      return map(v, lo, hi);
    }) };
  },
});

export const delay = defineNode({
  ...unary(), type: 'sig.delay', title: 'Delay', group: G, icon: 'timer',
  aliases: ['latency', 'shift', 'lag', 'offset time', 'advance'],
  help: 'Shifts the signal in time: positive = later (compensate an early tracker), negative = earlier. Linear between samples.',
  params: [num('ms', 'Delay', 0, -10000, 10000, 1, { unit: 'ms', inline: true })],
  halo: (p) => Math.abs(p.ms) + 50, local: true,
  eval: ({ signal: x }, p, ctx) => ({ signal: genSignal(ctx, (_k, t) => signalAt(x, t - p.ms)) }),
});

export const derivative = defineNode({
  ...unary(), type: 'sig.derivative', title: 'Derivative', group: G, icon: 'arrow-up',
  aliases: ['velocity', 'slope', 'rate of change', 'speed', 'diff'],
  help: 'Rate of change per second (central difference; one-sided at the edges of known data).',
  params: [],
  halo: () => 100, local: true,
  eval({ signal: x }, _p, ctx) {
    const g = ctx.grid(), rd = reader(x), k1 = 1000 / g.dt;
    return { signal: genSignal(ctx, (k) => {
      const i = g.i0 + k, a = rd(i - 1), b = rd(i), c = rd(i + 1);
      if (b !== b) return NaN;
      if (a === a && c === c) return ((c - a) / 2) * k1;
      if (c === c) return (c - b) * k1;
      if (a === a) return (b - a) * k1;
      return NaN;
    }) };
  },
});

export const integrate = defineNode({
  ...unary(), type: 'sig.integrate', title: 'Integrate', group: G, icon: 'plus',
  aliases: ['accumulate', 'sum', 'running total', 'phase accumulator'],
  help: 'Running integral (value × seconds) from the start of the signal. Unknown samples add nothing.',
  params: [],
  eval({ signal: x }, _p, ctx) {
    const out = new Float32Array(x.v.length);
    let acc = 0;
    for (let k = 0; k < out.length; k++) { const v = x.v[k]; if (v === v) acc += (v * x.dt) / 1000; out[k] = acc; }
    return { signal: mapGrid(ctx, { i0: x.i0, dt: x.dt, v: out }, (v) => v) };
  },
});

export const envelope = defineNode({
  ...unary(), type: 'sig.envelope', title: 'Envelope follower', group: G, icon: 'heart-rate',
  aliases: ['amplitude', 'loudness', 'peak', 'rms', 'intensity', 'follower'],
  help: 'Follows the level of a signal: rises with Attack, falls with Release. Peak follows the value, RMS its root mean square. Feed it |x − centre| (Math) to get stroke amplitude.',
  params: [choice('mode', 'Mode', 'peak', ['peak', 'rms']), num('attackMs', 'Attack', 20, 0, 10000, 5, { unit: 'ms', inline: true }), num('releaseMs', 'Release', 300, 0, 60000, 10, { unit: 'ms', inline: true })],
  eval({ signal: x }, p, ctx) {
    const dt = x.dt, ka = p.attackMs > 0 ? 1 - Math.exp(-dt / p.attackMs) : 1, kr = p.releaseMs > 0 ? 1 - Math.exp(-dt / p.releaseMs) : 1;
    const out = new Float32Array(x.v.length).fill(NaN);
    let y = NaN;
    for (let k = 0; k < out.length; k++) {
      let v = x.v[k];
      if (v !== v) continue;
      if (p.mode === 'rms') v = v * v;
      y = y !== y ? v : y + (v - y) * (v > y ? ka : kr);
      out[k] = p.mode === 'rms' ? Math.sqrt(y) : y;
    }
    return { signal: mapGrid(ctx, { i0: x.i0, dt, v: out }, (v) => v) };
  },
});

export const blend = defineNode({
  type: 'sig.blend', title: 'Blend by confidence', group: G, icon: 'layers',
  aliases: ['mix trackers', 'fuse', 'confidence', 'weighted', 'select by confidence', 'pick', 'combine'],
  help: '(a·ca^γ + b·cb^γ) / (ca^γ + cb^γ), NaN-aware: where one arm is unknown the other is used; an unknown confidence counts as 1. Pick takes the more confident arm outright. Dominance = share of A. Unconnected confidences count as 1.',
  ins: [signal('a', req), signal('ca', { label: 'conf A' }), signal('b', req), signal('cb', { label: 'conf B' })],
  outs: [signal(), signal('dominance')],
  params: [choice('mode', 'Mode', 'blend', ['blend', 'pick']), num('gamma', 'Gamma', 2, 0, 16, 0.1, { inline: true })],
  halo: () => 0, local: true, bypass: { signal: 'a' },
  eval({ a, ca, b, cb }, p, ctx) {
    const g = ctx.grid(), ra = reader(a), rb = reader(b), rca = ca ? reader(ca) : () => 1, rcb = cb ? reader(cb) : () => 1;
    const out = makeSignal(g.i0, g.n, g.dt, NaN), dom = makeSignal(g.i0, g.n, g.dt, NaN);
    for (let k = 0; k < g.n; k++) {
      const i = g.i0 + k, x = ra(i), y = rb(i);
      const qa = rca(i), qb = rcb(i); // unknown confidence on a known sample counts as 1, like an unconnected one
      let wa = Math.pow(Math.max(0, qa === qa ? qa : 1), p.gamma), wb = Math.pow(Math.max(0, qb === qb ? qb : 1), p.gamma);
      if (x !== x) wa = NaN;
      if (y !== y) wb = NaN;
      const okA = wa === wa, okB = wb === wb;
      let d;
      if (okA && okB) d = wa + wb > 0 ? wa / (wa + wb) : 0.5;
      else if (okA) d = 1;
      else if (okB) d = 0;
      else continue;
      if (p.mode === 'pick') d = d > 0.5 ? 1 : d < 0.5 ? 0 : 1;
      out.v[k] = d === 1 ? x : d === 0 ? y : x * d + y * (1 - d);
      dom.v[k] = d;
    }
    dom.range = [0, 1];
    return { signal: out, dominance: dom };
  },
});

// ---------------------------------------------------------------- generators

export const lfo = defineNode({
  type: 'sig.lfo', title: 'LFO', group: GG, icon: 'wave',
  aliases: ['oscillator', 'sine', 'wave', 'periodic', 'triangle', 'square', 'saw'],
  help: 'A periodic wave between Low and High: value = f(t / period + phase). Period and ends are time-varying.',
  ins: [], outs: [signal()],
  params: [choice('shape', 'Shape', 'sine', WAVE_NAMES), modNum('periodMs', 'Period', 800, 20, 600000, 10, { unit: 'ms', inline: true }),
    num('phase', 'Phase', 0, 0, 1, 0.01, { unit: 'cycle' }), modNum('lo', 'Low', 0, -1e6, 1e6, 1, { inline: true }), modNum('hi', 'High', 100, -1e6, 1e6, 1)],
  halo: () => 0, local: true,
  eval(_in, p, ctx) {
    const f = WAVES[p.shape] ?? WAVES.sine, per = ctx.param('periodMs'), lo = ctx.param('lo'), hi = ctx.param('hi');
    return { signal: genSignal(ctx, (_k, t) => { const l = lo(t); return l + ((hi(t) - l) * (f(t / Math.max(1, per(t)) + p.phase) + 1)) / 2; }) };
  },
});

export const noise = defineNode({
  type: 'sig.noise', title: 'Smooth noise', group: GG, icon: 'random',
  aliases: ['random', 'drift', 'wander', 'variation', 'humanise'],
  help: 'Seeded smooth random values between Low and High: one random knot every Smoothness ms, eased between. Same seed, same noise.',
  ins: [], outs: [signal()],
  params: [num('smoothMs', 'Smoothness', 400, 10, 600000, 10, { unit: 'ms', inline: true }), modNum('lo', 'Low', 0, -1e6, 1e6, 1), modNum('hi', 'High', 100, -1e6, 1e6, 1), seedParam()],
  halo: () => 0, local: true,
  eval(_in, p, ctx) {
    const lo = ctx.param('lo'), hi = ctx.param('hi'), knot = (m) => mulberry32(hashSeed(p.seed, 'sig.noise', m))();
    return { signal: genSignal(ctx, (_k, t) => {
      const x = t / p.smoothMs, m = Math.floor(x), u = x - m, e = (1 - Math.cos(Math.PI * u)) / 2;
      const v = knot(m) + (knot(m + 1) - knot(m)) * e, l = lo(t);
      return l + (hi(t) - l) * v;
    }) };
  },
});

export const phaseWave = defineNode({
  type: 'sig.phaseWave', title: 'Phase → wave', group: GG, icon: 'refresh',
  aliases: ['roll', 'twist', 'pitch', 'derive', 'multi-axis', 'secondary axis'],
  help: 'centre + depth × wave(cycles × phase + offset) × amplitude-follow. From "Stroke phase": offset 0.25 puts the sine peak at the top of each stroke; cycles 0.5 gives one swing per two strokes. Follow amp scales depth by the stroke amplitude (0 = ignore it).',
  ins: [signal('phase', req), signal('amp')], outs: [signal()],
  params: [choice('shape', 'Shape', 'sine', WAVE_NAMES), num('cycles', 'Cycles per stroke', 1, 0.125, 8, 0.125), num('offset', 'Offset', 0.25, -1, 1, 0.01, { unit: 'cycle' }),
    modNum('center', 'Centre', 50, 0, 100, 1, { inline: true }), modNum('depth', 'Depth', 20, -100, 100, 1, { inline: true }), num('followAmp', 'Follow amp', 1, 0, 1, 0.05)],
  halo: () => 0, local: true,
  eval({ phase, amp }, p, ctx) {
    const g = ctx.grid(), rp = reader(phase), ra = amp ? reader(amp) : null, f = WAVES[p.shape] ?? WAVES.sine;
    const c = ctx.param('center'), d = ctx.param('depth');
    return { signal: genSignal(ctx, (k, t) => {
      const i = g.i0 + k, ph = rp(i);
      const scale = ra ? 1 + p.followAmp * (ra(i) - 1) : 1;
      return c(t) + d(t) * f(p.cycles * ph + p.offset) * scale;
    }, [0, 100]) };
  },
});

// ---------------------------------------------------------------- conversions

/** Extremes of a signal per finite run, parabolically refined: [{ at (float ms), value, kind }] plus run ends (kind 'end'). */
export function signalExtremes(x, prom, { ends = true } = {}) {
  const out = [], runs = finiteRuns(x.v);
  for (const [k0, k1] of runs) {
    if (ends) out.push({ at: (x.i0 + k0) * x.dt, value: x.v[k0], kind: 'end', run: k0 });
    for (const z of zigzag(x.v, k0, k1, prom)) {
      const r = refine(x.v, z.k);
      out.push({ at: (x.i0 + z.k + r.dk) * x.dt, value: r.value, kind: z.kind, run: k0 });
    }
    if (ends && k1 - 1 > k0) out.push({ at: (x.i0 + k1 - 1) * x.dt, value: x.v[k1 - 1], kind: 'end', run: k0 });
  }
  return out;
}

export const toScript = defineNode({
  type: 'sig.toScript', title: 'Signal → Script', group: G, icon: 'stroke',
  aliases: ['fit', 'extremes', 'convert', 'to script', 'actions', 'points'],
  help: 'Turns a signal into actions. Extremes: one action per turning point (sub-sample refined) plus the ends of known data; turns closer than Min gap are dropped in pairs. Resample: an action every N ms, then simplified. Gaps: break joins across them, hold keeps the last value until data returns, bridge joins gaps up to Max bridge and holds longer ones.',
  ins: [signal('signal', req)], outs: [script()],
  params: [choice('mode', 'Mode', 'extremes', ['extremes', 'resample']),
    num('minProminence', 'Min prominence', 3, 0, 100, 0.5, { inline: true }), num('minGapMs', 'Min gap', 60, 0, 2000, 5, { unit: 'ms' }),
    num('everyMs', 'Resample every', 100, 5, 10000, 5, { unit: 'ms' }), num('tolerance', 'Simplify tolerance', 1, 0, 50, 0.5),
    choice('gaps', 'Gaps', 'break', ['break', 'hold', 'bridge']), num('maxBridgeMs', 'Max bridge', 400, 0, 60000, 10, { unit: 'ms' })],
  eval({ signal: x }, p, ctx) {
    const runs = [];
    if (p.mode === 'resample') {
      for (const [k0, k1] of finiteRuns(x.v)) {
        const t0 = (x.i0 + k0) * x.dt, t1 = (x.i0 + k1 - 1) * x.dt, pts = [{ at: t0, pos: x.v[k0] }];
        for (let t = Math.ceil(t0 / p.everyMs) * p.everyMs; t < t1; t += p.everyMs) if (t > t0) pts.push({ at: t, pos: signalAt(x, t) });
        if (t1 > t0) pts.push({ at: t1, pos: x.v[k1 - 1] });
        runs.push(normalize(pts));
      }
    } else {
      let cur = null, run = -1;
      for (const e of signalExtremes(x, p.minProminence)) {
        if (e.run !== run) { run = e.run; runs.push((cur = [])); }
        const last = cur[cur.length - 1];
        if (last && e.kind !== 'end' && last.kind !== 'end' && e.at - last.at < p.minGapMs) { cur.pop(); continue; }
        cur.push(e);
      }
      for (let r = 0; r < runs.length; r++) runs[r] = normalize(runs[r].map((e) => ({ at: e.at, pos: e.value })));
    }
    const out = [];
    for (const r of runs) {
      if (!r.length) continue;
      const prev = out[out.length - 1];
      if (prev && (p.gaps === 'hold' || (p.gaps === 'bridge' && r[0].at - prev.at > p.maxBridgeMs))) {
        const at = r[0].at - x.dt;
        if (at > prev.at) out.push({ at, pos: prev.pos });
      }
      for (const a of r) if (!out.length || a.at > out[out.length - 1].at) out.push(a);
    }
    const s = normalize(out);
    return { script: p.mode === 'resample' && p.tolerance > 0 ? simplify(s, null, { tolerance: p.tolerance }).script : s };
  },
});

export const sampleAt = defineNode({
  type: 'sig.sampleAt', title: 'Sample at times', group: G, icon: 'target',
  aliases: ['at turns', 'sample', 'to script', 'derive', 'roll at strokes'],
  help: 'Actions at the given times (a script\'s action times, or span starts/ends) with the signal\'s value there, plus optional points in between (mids, quarters). Unknown values are skipped.',
  ins: [signal('signal', req), any('times', { required: true, accepts: ['script', 'spans'] })], outs: [script()],
  params: [choice('also', 'Also between', 'none', ['none', 'mids', 'quarters'])],
  eval({ signal: x, times }, p) {
    const kind = typeOfValue(times);
    // a script's times are already sorted and unique; span ends need sorting
    const T = kind === 'script' ? times.map((a) => a.at) : [...new Set((times || []).flatMap((s) => (s.t1 > s.t0 ? [s.t0, s.t1] : [s.t0])))].sort((a, b) => a - b);
    const fr = p.also === 'mids' ? [0.5] : p.also === 'quarters' ? [0.25, 0.5, 0.75] : [];
    const out = [];
    for (let k = 0; k < T.length; k++) {
      out.push(T[k]);
      if (k + 1 < T.length) for (const f of fr) out.push(T[k] + (T[k + 1] - T[k]) * f);
    }
    return { script: normalize(out.map((t) => ({ at: t, pos: signalAt(x, t) })).filter((a) => a.pos === a.pos)) };
  },
});

export const peaks = defineNode({
  type: 'sig.peaks', title: 'Signal extremes', group: G, icon: 'marker',
  aliases: ['peaks', 'valleys', 'turns', 'extremes', 'detect', 'times', 'tops', 'bottoms'],
  help: 'Turning points of a signal (prominence rule, sub-sample refined) as points: kind top/bottom, value = level. Feed them to "Follow" as turns, or to "Sample at times".',
  ins: [signal('signal', req)], outs: [spans('points', points)],
  params: [num('minProminence', 'Min prominence', 5, 0, 1e6, 0.5, { inline: true }), choice('which', 'Which', 'both', ['both', 'tops', 'bottoms'])],
  eval({ signal: x }, p) {
    const out = [];
    for (const e of signalExtremes(x, p.minProminence, { ends: false })) {
      if (p.which !== 'both' && (p.which === 'tops') !== (e.kind === 'top')) continue;
      const t = Math.round(e.at);
      if (!out.length || t > out[out.length - 1].t0) out.push({ t0: t, t1: t, kind: e.kind, value: e.value });
    }
    return { points: out };
  },
});

export const SIGNAL = [math, expr, remap, clamp, curve, quantise, smooth, median, slew, fillGaps, normalise, delay, derivative, integrate, envelope, blend, lfo, noise, phaseWave, toScript, sampleAt, peaks];

