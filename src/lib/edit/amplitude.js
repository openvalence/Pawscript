// Amplitude (pos) operations. Times never change, so there are no collisions.
import { mapPos, selInfo, clamp, O, fin } from './util.js';
import { turns } from './strokes.js';

/** pivot: 'center' (50) | 'top' (100) | 'bottom' (0) | 'mean' (selection mean) | 'mid' (middle of selection min..max) | 'custom' (value). */
export function pivotOf(pivot, value, c) {
  switch (pivot) {
    case 'top': return 100;
    case 'bottom': return 0;
    case 'mean': return c.mean;
    case 'mid': return (c.min + c.max) / 2;
    case 'custom': return fin(value, 50);
    default: return 50;
  }
}

export function scale(script, sel, opts) {
  const { factor = 1, pivot = 'center', value = 50 } = O(opts), f = fin(factor, 1);
  return mapPos(script, sel, (p, a, k, c) => { const pv = pivotOf(pivot, value, c); return pv + (p - pv) * f; });
}

export function offset(script, sel, opts) {
  const amount = fin(O(opts).amount, 0);
  return mapPos(script, sel, (p) => p + amount);
}

export const invert = (script, sel) => mapPos(script, sel, (p) => 100 - p);

/** Map the selection's own min..max (or srcLo..srcHi) to lo..hi. trim (0..49 %) ignores that share of the lowest and highest
 *  positions when finding the source range (outlier-proof); values beyond it clamp. A flat selection goes to the middle of lo..hi. */
export function remapRange(script, sel, opts) {
  const { lo = 0, hi = 100, srcLo, srcHi, trim = 0 } = O(opts);
  const info = selInfo(script, sel);
  if (!info.n) return { script, ats: [] };
  let a = srcLo, b = srcHi;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    const v = info.idx.map((i) => script[i].pos).sort((x, y) => x - y);
    const cut = Math.min(Math.floor((v.length * clamp(trim, 0, 49)) / 100), (v.length - 1) >> 1);
    a = Number.isFinite(srcLo) ? srcLo : v[cut]; b = Number.isFinite(srcHi) ? srcHi : v[v.length - 1 - cut];
  }
  return mapPos(script, sel, (p) => (b === a ? (lo + hi) / 2 : lo + ((clamp(p, Math.min(a, b), Math.max(a, b)) - a) / (b - a)) * (hi - lo)));
}

/** Restrict to lo..hi. mode 'clamp' cuts values outside; 'compress' squeezes the whole 0..100 scale into lo..hi. */
export function limitRange(script, sel, opts) {
  const { lo = 0, hi = 100, mode = 'clamp' } = O(opts), a = Math.min(lo, hi), b = Math.max(lo, hi);
  return mapPos(script, sel, (p) => (mode === 'compress' ? a + (p / 100) * (b - a) : clamp(p, a, b)));
}

export const normalise = (script, sel, opts) => remapRange(script, sel, { lo: 0, hi: 100, trim: 0, ...O(opts) });

const CURVES = {
  linear: (u) => u, easeIn: (u) => u * u, easeOut: (u) => 1 - (1 - u) * (1 - u),
  easeInOut: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)), sine: (u) => (1 - Math.cos(Math.PI * u)) / 2,
};
/** Gain ramp across the selection: gain goes from `from` to `to` along `curve` ('linear'|'easeIn'|'easeOut'|'easeInOut'|'sine'|
 *  'custom'); custom takes points: [[u 0..1, gain], ...] (piecewise linear). Positions scale about the pivot. */
export function envelope(script, sel, opts) {
  const { from = 1, to = 0.5, curve = 'linear', points, pivot = 'center', value = 50 } = O(opts);
  let g;
  if (curve === 'custom' && Array.isArray(points) && points.length) {
    const P = [...points].sort((x, y) => x[0] - y[0]);
    g = (u) => {
      if (u <= P[0][0]) return P[0][1];
      for (let i = 1; i < P.length; i++) if (u <= P[i][0]) return P[i - 1][1] + ((P[i][1] - P[i - 1][1]) * (u - P[i - 1][0])) / (P[i][0] - P[i - 1][0] || 1);
      return P[P.length - 1][1];
    };
  } else { const e = CURVES[curve] || CURVES.linear; g = (u) => from + (to - from) * e(u); }
  return mapPos(script, sel, (p, a, k, c) => {
    const span = c.t1 - c.t0, u = span > 0 ? (a.at - c.t0) / span : 0, pv = pivotOf(pivot, value, c);
    return pv + (p - pv) * g(u);
  });
}

/** Level the tops and/or bottoms (turning points inside the selection). to: 'value' (topValue / bottomValue) | 'mean' (mean of the
 *  selected tops, resp. bottoms). strength 0..1 blends from the current pos to the target. */
export function alignExtremes(script, sel, opts) {
  const { which = 'both', to = 'value', topValue = 100, bottomValue = 0, strength = 1, minProminence = 0 } = O(opts);
  const info = selInfo(script, sel);
  if (!info.n) return { script, ats: [] };
  const kind = new Map();
  for (const t of turns(script, minProminence)) if (info.m[t.i]) kind.set(t.i, t.kind);
  const sums = { top: [0, 0], bottom: [0, 0] };
  for (const [i, k] of kind) { sums[k][0] += script[i].pos; sums[k][1]++; }
  const out = script.slice(), ats = [];
  for (const [i, k] of kind) {
    if ((which === 'tops' && k !== 'top') || (which === 'bottoms' && k !== 'bottom')) continue;
    const target = to === 'mean' ? sums[k][0] / sums[k][1] : k === 'top' ? topValue : bottomValue;
    const a = script[i];
    out[i] = { at: a.at, pos: Math.round(clamp(a.pos + (target - a.pos) * clamp(strength, 0, 1), 0, 100)) };
  }
  for (const i of info.idx) ats.push(script[i].at);
  return { script: out, ats };
}

/** Push tops up and bottoms down by `amount` (negative softens). relative: amount is % of the remaining headroom (to 100 / 0). */
export function extremes(script, sel, opts) {
  const { amount = 5, which = 'both', relative = false, minProminence = 0 } = O(opts);
  const info = selInfo(script, sel);
  if (!info.n) return { script, ats: [] };
  const out = script.slice();
  for (const t of turns(script, minProminence)) {
    if (!info.m[t.i] || (which === 'tops' && t.kind !== 'top') || (which === 'bottoms' && t.kind !== 'bottom')) continue;
    const a = script[t.i], room = t.kind === 'top' ? 100 - a.pos : a.pos, d = relative ? (room * amount) / 100 : amount;
    out[t.i] = { at: a.at, pos: Math.round(clamp(a.pos + (t.kind === 'top' ? d : -d), 0, 100)) };
  }
  return { script: out, ats: info.idx.map((i) => script[i].at) };
}

