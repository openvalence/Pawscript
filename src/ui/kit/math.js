/**
 * math.js -- the arithmetic behind the kit's numeric controls, lists and splitters. Pure.
 */

export const clamp = (v, lo = -Infinity, hi = Infinity) => Math.min(hi, Math.max(lo, v));

/** Decimal places a step implies: 1 -> 0, 0.1 -> 1, 0.25 -> 2. */
export function decimalsOf(step) {
  if (!Number.isFinite(step) || step <= 0) return 6;
  const s = String(step);
  if (s.includes('e-')) return +s.split('e-')[1];
  return s.includes('.') ? s.split('.')[1].length : 0;
}

/** Round away float noise to `dp` decimals. */
export const roundTo = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

/** v clamped into [min, max] and onto the step grid that starts at min (or 0), without float noise. */
export function snap(v, { min = -Infinity, max = Infinity, step = 0 } = {}) {
  if (!Number.isFinite(v)) return v;
  v = clamp(v, min, max);
  if (step > 0) {
    const base = Number.isFinite(min) ? min : 0;
    const dp = Math.max(decimalsOf(step), Number.isFinite(min) ? decimalsOf(Math.abs(min)) : 0);
    let n = Math.round((v - base) / step);
    if (base + n * step > max + 1e-9) n -= 1;
    v = roundTo(base + n * step, dp);
  }
  return v;
}

// Modifiers follow Blender (operator ruling, every numeric control): Shift = fine, Ctrl = snap. `coarse` is not a key: PageUp /
// PageDown ask for ten steps.
/** Step multiplier: Shift x0.1 (fine), coarse x10. */
export function stepScale({ shiftKey = false, coarse = false } = {}) {
  return (shiftKey ? 0.1 : 1) * (coarse ? 10 : 1);
}
/** Ctrl's snap grid: the decade below the range's magnitude (0..1000 -> 100, 0..50 -> 10), never finer than step; null
 *  without a finite range. */
export function snapGrid(min, max, step = 0) {
  const r = max - min;
  return r > 0 && Number.isFinite(r) ? Math.max(step, 10 ** (Math.ceil(Math.log10(r)) - 1)) : null;
}
const onGrid = (v, g, min) => { const b = Number.isFinite(min) ? min : 0; return roundTo(b + Math.round((v - b) / g) * g, decimalsOf(g) + 1); };

/** One keyboard nudge, dir +1 / -1. Shift a tenth of a step, on its own finer grid; Ctrl to the next line of the snap grid. */
export function nudge(v, dir, { min, max, step = 1 } = {}, mods = {}) {
  const x = Number.isFinite(v) ? v : 0, g = mods.ctrlKey ? snapGrid(min, max, step) : null;
  if (g) return snap(onGrid(x + dir * g * 0.501, g, min), { min, max });
  const s = roundTo(step * stepScale(mods), decimalsOf(step) + 1);
  return snap(x + dir * s, { min, max, step: Math.min(s, step) });
}

/**
 * Drag-to-scrub: the value after dragging dx CSS pixels from where the drag started.
 * `pxPerStep` pixels per step (Shift x0.1 fine; Ctrl lands on the snap grid).
 */
export function scrub(start, dx, { min, max, step = 1, pxPerStep = 4 } = {}, mods = {}) {
  const s = roundTo(step * stepScale(mods), decimalsOf(step) + 1), v = start + (dx / pxPerStep) * s, g = mods.ctrlKey ? snapGrid(min, max, step) : null;
  return g ? snap(onGrid(v, g, min), { min, max }) : snap(v, { min, max, step: Math.min(s, step) });
}

/**
 * Parse what a person typed into a number field: '12', '-3.5', '1,5' (comma decimal), '−2' (minus sign),
 * '40 ms' (unit suffix ignored). No expressions. NaN when it is not a number.
 */
export function parseNumber(text) {
  const t = String(text ?? '').trim().replace(/−/g, '-').replace(/^\+/, '');
  const m = t.match(/^(-?(?:\d+[.,]?\d*|[.,]\d+)(?:e[-+]?\d+)?)\s*[a-zµ%°×x/]*$/i);
  return m ? Number(m[1].replace(',', '.')) : NaN;
}

/** Format for display with the step's decimals (or `decimals`); '-0' shows as '0'. */
export function formatNumber(v, { step = 1, decimals } = {}) {
  if (!Number.isFinite(v)) return '';
  const s = v.toFixed(decimals ?? decimalsOf(step));
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/** The fraction 0..1 of v between min and max. */
export const fraction = (v, min, max) => (max > min ? clamp((v - min) / (max - min), 0, 1) : 0);

/** Rows [start, end) to render for a fixed-height virtual list. */
export function windowRange(scrollTop, viewHeight, rowHeight, count, overscan = 6) {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, viewHeight) / rowHeight) + 1;
  return { start: Math.max(0, first - overscan), end: Math.min(count, first + visible + overscan) };
}

/** scrollTop that brings row i fully into view (unchanged when already visible). */
export function scrollToRow(i, scrollTop, viewHeight, rowHeight) {
  const top = i * rowHeight, bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewHeight) return bottom - viewHeight;
  return scrollTop;
}

/**
 * A split pane's first-pane size, held so both panes keep their minimums.
 * total = container length minus the splitter.
 */
export function clampSplit(size, { min = 0, max = Infinity, minOther = 0, total = Infinity } = {}) {
  return Math.round(clamp(size, min, Math.max(min, Math.min(max, total - minOther))));
}
