// Heatmap: speed over time binned for a strip W pixels wide, plus colour scales.
// One pass over the segments inside the window (O(segments in window + W)); the typed-array form of the
// script is cached per Script identity, so recomputing after an edit costs one O(n) copy (~1 ms at 100k).
// ponytail: no prefix sums / sparse table; the window walk is already ~1-3 ms at 100k actions.
import { arrays, lb, turns } from './util.js';

/**
 * heatmap(script, {t0, t1, width, minProm=10, restSpeed=2}) ->
 *   { t0, t1, width, binMs, mean, peak, rate, activity, maxMean, maxPeak }  (Float32Arrays of length `width`)
 *   mean      distance travelled / bin length, pos units per second
 *   peak      fastest segment touching the bin, pos units per second
 *   rate      full strokes (cycles) per minute from turning points inside the bin
 *   activity  0..1 share of the bin during which speed > restSpeed
 */
export function heatmap(script, { t0, t1, width, minProm = 10, restSpeed = 2 } = {}) {
  const { at, pos, n } = arrays(script);
  if (t0 === undefined) t0 = n ? at[0] : 0;
  if (t1 === undefined) t1 = n ? at[n - 1] : 0;
  const W = Math.max(0, Math.floor(width || 0));
  const mean = new Float32Array(W), peak = new Float32Array(W), rate = new Float32Array(W), activity = new Float32Array(W);
  const out = { t0, t1, width: W, binMs: W ? (t1 - t0) / W : 0, mean, peak, rate, activity, maxMean: 0, maxPeak: 0 };
  if (!W || !(t1 > t0) || n < 2) return out;
  const binMs = out.binMs, inv = 1 / binMs;
  const jStart = Math.max(1, lb(at, t0));        // segment j runs at[j-1] -> at[j]
  let jEnd = jStart;
  for (let j = jStart; j < n && at[j - 1] < t1; j++) {
    jEnd = j + 1;
    const a = at[j - 1], b = at[j], v = (Math.abs(pos[j] - pos[j - 1]) * 1000) / (b - a);
    const s0 = Math.max(a, t0), s1 = Math.min(b, t1);
    if (!(s1 > s0)) continue;
    let b0 = Math.floor((s0 - t0) * inv);
    const b1 = Math.min(W - 1, Math.floor((s1 - t0) * inv - 1e-9));
    if (b0 > b1) b0 = b1;
    for (let k = b0; k <= b1; k++) {
      const ov = Math.min(s1, t0 + (k + 1) * binMs) - Math.max(s0, t0 + k * binMs);
      if (ov <= 0) continue;
      mean[k] += v * ov * inv;
      if (v > peak[k]) peak[k] = v;
      if (v > restSpeed) activity[k] += ov * inv;
    }
  }
  const tp = turns(at, pos, minProm, Math.max(0, jStart - 1), Math.min(n, jEnd + 1));
  const perMin = 60000 / binMs / 2;
  for (const i of tp.idx) {
    if (at[i] < t0 || at[i] >= t1) continue;
    rate[Math.min(W - 1, Math.floor((at[i] - t0) * inv))] += perMin;
  }
  for (let k = 0; k < W; k++) {
    if (activity[k] > 1) activity[k] = 1;
    if (mean[k] > out.maxMean) out.maxMean = mean[k];
    if (peak[k] > out.maxPeak) out.maxPeak = peak[k];
  }
  return out;
}

// ---- colour scales: speed -> [r,g,b] (0..255 ints) ----
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ramp = (stops) => stops.map(hex);

/** Named scales, each an array of evenly spaced [r,g,b] stops from slowest to fastest. */
export const SCALES = {
  // The familiar funscript heatmap look (blue -> cyan -> green -> yellow -> red). Approximation from memory of
  // OpenFunscripter/ScriptPlayer style heat colours; exact stops differ between tools (unverified).
  heat: ramp(['#1b2a6b', '#2a6fdb', '#2fc4d6', '#35c759', '#e8e03a', '#f0902a', '#e23b2e']),
  // Perceptual and colour-blind friendly: viridis (stops recalled from the matplotlib colormap; 10-stop approximation).
  viridis: ramp(['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725']),
  // Safe for red-green deficiencies: cividis-like blue -> grey -> yellow (approximate stops).
  cividis: ramp(['#00204d', '#31446b', '#666970', '#958f78', '#cbba69', '#ffea46']),
  // Greyscale for print / high contrast.
  grey: ramp(['#0a0a0a', '#ffffff']),
};
export const SCALE_NAMES = Object.keys(SCALES);

/** Colour at v in 0..1 (clamped; NaN -> first stop) on a named scale or an explicit stop array. */
export function colorAt(scale, v) {
  const s = typeof scale === 'string' ? SCALES[scale] || SCALES.heat : scale;
  const x = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) * (s.length - 1) : 0;
  const i = Math.min(s.length - 2, Math.floor(x)), f = x - i, a = s[i], b = s[i + 1];
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
}

/** Speed (units/s) -> [r,g,b]; `max` is the speed that maps to the top of the scale (default 400). */
export const speedColor = (speed, { scale = 'heat', max = 400 } = {}) => colorAt(scale, speed / max);

/** 256-entry lookup table of colours for a scale (index = round(v01 * 255)); build once, index per bin. */
export const colorLut = (scale = 'heat') => Array.from({ length: 256 }, (_, i) => colorAt(scale, i / 255));

/** Speeds (Float32Array) -> Uint8ClampedArray RGBA, ready for ImageData; alpha 255. */
export function colorize(values, { scale = 'heat', max = 400 } = {}) {
  const lut = colorLut(scale), out = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const c = lut[Math.max(0, Math.min(255, Math.round((values[i] / max) * 255) || 0))];
    out[4 * i] = c[0]; out[4 * i + 1] = c[1]; out[4 * i + 2] = c[2]; out[4 * i + 3] = 255;
  }
  return out;
}
