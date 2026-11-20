/**
 * fields.js -- the pure parts of the fields family (Slider, RangeSlider, NumberField, ColorSwatch). Node-tested
 * in test/kit-fields.test.mjs. Numbers themselves go through math.js.
 */
import { clamp, snap, formatNumber, roundTo, decimalsOf, parseNumber } from './math.js';

/**
 * Trim float noise after a fine (Alt) nudge or scrub: math.js scales the step by 0.1 (0.05 * 0.1 =
 * 0.005000000000000001), so the result can carry 17 digits. One decimal finer than the step (or min) is exact.
 */
export function tidy(v, { min = 0, step = 1 } = {}) {
  if (!Number.isFinite(v)) return v;
  return roundTo(v, Math.max(decimalsOf(step), Number.isFinite(min) ? decimalsOf(Math.abs(min)) : 0) + 1);
}

/** Typed text -> the value a field takes (parsed: 1,5 / -2 / 40 ms; clamped; snapped to the step), or NaN (nothing changes). */
export const typedValue = (text, bounds) => snap(parseNumber(text), bounds);

/** Tick values for a slider: number[] as given, a count (n evenly spaced, ends included), true = every step. */
export function tickValues(ticks, { min = 0, max = 100, step = 1 } = {}) {
  if (!ticks || max <= min) return [];
  if (Array.isArray(ticks)) return ticks.filter((v) => v >= min && v <= max);
  if (ticks === true) {
    const n = step > 0 ? Math.floor((max - min) / step + 1e-9) : 0;
    if (n < 1 || n > 200) return [min, max]; // ponytail: too dense to read; ends only
    return Array.from({ length: n + 1 }, (_, i) => snap(min + i * step, { min, max, step }));
  }
  const n = Math.max(2, Math.round(ticks));
  return Array.from({ length: n }, (_, i) => min + ((max - min) * i) / (n - 1));
}

/**
 * Pixel placement on a track `width` px wide with a thumb `thumb` px wide: the thumb travels inside the track
 * (its centre from thumb/2 to width - thumb/2). Returns the thumb's left edge, a whole pixel.
 */
export const thumbLeft = (f, width, thumb) => Math.round(clamp(f, 0, 1) * Math.max(0, width - thumb));

/** The value under pointer x (relative to the track's left edge), centre-of-thumb mapping, snapped. */
export function valueAt(x, width, thumb, { min = 0, max = 100, step = 1 } = {}) {
  const span = Math.max(1, width - thumb);
  return snap(min + clamp((x - thumb / 2) / span, 0, 1) * (max - min), { min, max, step });
}

/** A range [lo, hi] with thumb i moved to v, held inside [min, max] and at least minGap apart. */
export function setRange(pair, i, v, { min = 0, max = 100, minGap = 0 } = {}) {
  const [lo, hi] = pair;
  return i === 0 ? [clamp(v, min, hi - minGap), hi] : [lo, clamp(v, lo + minGap, max)];
}

/** Which thumb of a range a press at value v grabs: the nearer one; on a tie, the side v lies on. */
export function nearestThumb([lo, hi], v) {
  const dl = Math.abs(v - lo), dh = Math.abs(v - hi);
  if (dl !== dh) return dl < dh ? 0 : 1;
  return v > hi ? 1 : 0;
}

/** Characters the widest value of a numeric control needs (for a reserved width that never jumps). */
export function numberChars({ min = -Infinity, max = Infinity, step = 1, decimals, format } = {}) {
  const f = format || ((v) => formatNumber(v, { step, decimals }));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 6;
  return Math.max(String(f(min)).length, String(f(max)).length, 1);
}

/** Display decimals for a number field: `decimals`, else the step's, else one finer when a fine nudge left one. */
export function displayDecimals(v, step, decimals) {
  if (decimals != null) return decimals;
  const ds = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  const dv = Number.isFinite(v) && String(v).includes('.') ? String(v).split('.')[1].length : 0;
  return Math.max(ds, Math.min(dv, ds + 1));
}

/** 2D grid navigation (ColorSwatch): the index an arrow / Home / End key moves to, or null. No wrap. */
export function gridMove(i, key, cols, count) {
  const row = Math.floor(i / cols);
  const to = {
    ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols,
    Home: row * cols, End: Math.min(count - 1, row * cols + cols - 1),
  }[key];
  if (to === undefined) return null;
  return to >= 0 && to < count ? to : i;
}

/**
 * Attachment: a native listener on the element itself. Svelte delegates onkeydown to the root, which runs
 * after native listeners on ancestors (a popover's dismiss(), a dialog): Escape handled here is stopped first.
 */
export const listen = (type, fn) => (el) => {
  el.addEventListener(type, fn);
  return () => el.removeEventListener(type, fn);
};
