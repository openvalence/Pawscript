/**
 * tokens.js -- the token facts JavaScript needs (canvas drawing, pickers, the theme switch). The values live
 * in theme.css; read them at draw time with cssVar() and re-read on a theme change (onThemeChange).
 */
import { cssVar } from './color.js';

export const THEMES = Object.freeze([
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'contrast', label: 'High contrast' },
]);
export const DENSITIES = Object.freeze(['compact', 'default', 'comfortable']);

/**
 * The series / overlay palette, in the order to hand out. The first eight stay distinguishable for
 * protan, deutan and tritan vision; past eight, colours repeat-ish, so draw those with `dash`
 * (canvas setLineDash). Store the `key` in documents, never a hex: the colour follows the theme.
 */
export const SERIES = Object.freeze([
  { key: 'sky', label: 'Sky', dash: null },
  { key: 'orange', label: 'Orange', dash: null },
  { key: 'green', label: 'Green', dash: null },
  { key: 'yellow', label: 'Yellow', dash: null },
  { key: 'blue', label: 'Blue', dash: null },
  { key: 'vermilion', label: 'Vermilion', dash: null },
  { key: 'pink', label: 'Pink', dash: null },
  { key: 'grey', label: 'Gray', dash: null },
  { key: 'violet', label: 'Violet', dash: [6, 3] },
  { key: 'lime', label: 'Lime', dash: [2, 3] },
].map(Object.freeze));

/** The i-th series entry, cycling; past the list, entries come back dashed. */
export function series(i) {
  const n = SERIES.length, s = SERIES[((i % n) + n) % n];
  return i >= n && !s.dash ? { ...s, dash: [4, 3] } : s;
}
/** CSS value for a series key: 'var(--series-sky)'. */
export const seriesVar = (key) => `var(--series-${key})`;
/** Resolved hex for a series key, for canvas. Browser only. */
export const seriesColor = (key, el) => cssVar(`--series-${key}`, el);

/** Set the theme on <html> (or el). */
export function setTheme(id, el = document.documentElement) {
  if (id === 'dark') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', id);
}
/** Set the density on <html> (or el). */
export function setDensity(d, el = document.documentElement) {
  if (d === 'default') el.removeAttribute('data-density'); else el.setAttribute('data-density', d);
}
/** Call fn whenever data-theme / data-density changes on <html> (re-read tokens for canvas). -> off() */
export function onThemeChange(fn, el = document.documentElement) {
  const mo = new MutationObserver(() => fn());
  mo.observe(el, { attributes: true, attributeFilter: ['data-theme', 'data-density'] });
  return () => mo.disconnect();
}
