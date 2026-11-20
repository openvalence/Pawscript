// ops.js -- the few Script operations the lane editor needs that src/lib/edit does not have (yet).
// Same calling convention as lib/edit: (script, sel, opts) -> { script, ats }. Pure.
import { lowerBound, clampPos, posAt } from '../../lib/core/script.js';
import { mergeWin } from '../../lib/edit/util.js';

/**
 * Take a ghost's actions into the script. sel: {t0, t1} (a time range) or null (the whole ghost).
 * mode 'replace' clears the span first (the range, or the ghost's own first..last) | 'merge' (ghost wins ties).
 */
export function acceptGhost(script, sel, { ghost = [], mode = 'replace' } = {}) {
  const t0 = sel?.t0 ?? -Infinity, t1 = sel?.t1 ?? Infinity;
  const take = ghost.slice(lowerBound(ghost, t0), t1 === Infinity ? ghost.length : lowerBound(ghost, t1 + 1)).map((a) => ({ at: a.at, pos: clampPos(a.pos) }));
  if (!take.length) return { script, ats: [] };
  const lo = sel ? t0 : take[0].at, hi = sel ? t1 : take[take.length - 1].at;
  const base = mode === 'merge' ? script : script.filter((a) => a.at < lo || a.at > hi);
  return { script: mergeWin(base, take), ats: take.map((a) => a.at) };
}

/** Interpolated pos at t, rounded (50 on an empty script). */
export const posAtInt = (script, t) => (script.length ? clampPos(posAt(script, t)) : 50);
/** Index of the next action strictly after t / the previous strictly before t (-1 if none). */
export const nextIndex = (script, t) => { const i = lowerBound(script, Math.floor(t) + 1); return i < script.length ? i : -1; };
export const prevIndex = (script, t) => lowerBound(script, Math.ceil(t)) - 1;
/** Index of the first action in a later frame than t (dir > 0) / the last one in an earlier frame (-1 if none).
 *  frameOf maps ms to a frame index: an action at integer ms and the frame start the player lands on (1292 vs
 *  1291.67) are the same frame, so repeated presses never find the same point again. */
export function seekIndex(script, t, dir, frameOf) {
  const cur = frameOf(t);
  if (dir > 0) { let i = lowerBound(script, Math.floor(t) + 1); while (i < script.length && frameOf(script[i].at) <= cur) i++; return i < script.length ? i : -1; }
  let i = lowerBound(script, Math.ceil(t)) - 1;
  while (i >= 0 && frameOf(script[i].at) >= cur) i--;
  return i;
}
