// select.js -- pure selection-set operations. A selection is a Set of action timestamps (ms) on one axis.
// Every function returns a NEW Set (identity changes = Svelte sees it; render caches key on identity).
import { lowerBound, indexAt } from '../../lib/core/script.js';
import { turns } from '../../lib/edit/strokes.js';

export const EMPTY = new Set();
export const union = (a, b) => { const s = new Set(a); for (const x of b) s.add(x); return s; };
export const subtract = (a, b) => { const s = new Set(a); for (const x of b) s.delete(x); return s; };
export const toggle = (a, at) => { const s = new Set(a); s.has(at) ? s.delete(at) : s.add(at); return s; };
export const all = (script) => new Set(script.map((a) => a.at));
export const invert = (script, sel) => new Set(script.filter((a) => !sel.has(a.at)).map((a) => a.at));
/** Every action with t0 <= at <= t1. */
export const inRange = (script, t0, t1) => {
  const s = new Set();
  for (let i = lowerBound(script, Math.ceil(Math.min(t0, t1))); i < script.length && script[i].at <= Math.max(t0, t1); i++) s.add(script[i].at);
  return s;
};
/** Combine a new hit set with the old selection by mode: add, sub(tract), anything else replaces. */
export const combine = (old, hits, mode) => (mode === 'add' ? union(old, hits) : mode === 'sub' ? subtract(old, hits) : new Set(hits));
/** A drag on empty lane space by modifiers (Blender): replace (box, time x pos), add (Shift: box added), sub (Ctrl: box
 *  subtracted), span (Ctrl+Shift: every point from time to time), time (Alt: the I/O range, no selection). */
export const boxMode = (e) => (e.altKey ? 'time' : e.shiftKey && e.ctrlKey ? 'span' : e.shiftKey ? 'add' : e.ctrlKey ? 'sub' : 'replace');

/** Select connected (Blender L): every stroke (turning point to turning point, lib/edit turns) that holds a selected
 *  point; a selected turning point brings both strokes it joins. */
export function connected(script, sel) {
  const T = turns(script).map((t) => t.i), out = new Set(sel);
  for (let k = 0; k + 1 < T.length; k++) {
    let hit = false;
    for (let i = T[k]; i <= T[k + 1] && !hit; i++) hit = sel.has(script[i].at);
    if (hit) for (let i = T[k]; i <= T[k + 1]; i++) out.add(script[i].at);
  }
  return out;
}

/** Sorted indices of the selected actions that exist in the script (stale timestamps are ignored). */
export function indices(script, sel) {
  const out = [];
  if (sel.size > script.length / 8) { for (let i = 0; i < script.length; i++) if (sel.has(script[i].at)) out.push(i); return out; }
  for (const at of sel) { const i = indexAt(script, at); if (i >= 0) out.push(i); }
  return out.sort((x, y) => x - y);
}

/** Selection shifted by a time offset (after a move). */
export const shifted = (sel, dt) => new Set([...sel].map((t) => t + dt));
