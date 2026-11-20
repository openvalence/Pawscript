// Point basics. Every op: (script, sel, opts) -> { script, ats }.
import { selInfo, retime, mapPos, frameSnap, rnd, pos100, O, fin } from './util.js';

/** Add or set a point at opts.at. Existing points within +-tolerance ms of `at` are replaced (all of them). frameMs>0
 *  snaps `at` to the frame grid first. sel is ignored. -> ats = [at]. */
export function setPointAt(script, sel, opts) {
  const { at, pos, tolerance = 0, frameMs = 0 } = O(opts);
  if (!Number.isFinite(at) || !Number.isFinite(pos)) return { script, ats: [] };
  const t = Math.max(0, frameSnap(at, frameMs)), p = pos100(pos), tol = Math.max(0, tolerance);
  const out = [];
  let placed = false;
  for (const a of script) {
    if (Math.abs(a.at - t) <= tol || a.at === t) continue;
    if (!placed && a.at > t) { out.push({ at: t, pos: p }); placed = true; }
    out.push(a);
  }
  if (!placed) out.push({ at: t, pos: p });
  return { script: out, ats: [t] };
}
export const addPoint = setPointAt;

/** Number-key semantics: key 0..9 -> pos = key*10 (10 -> 100) at opts.at (the playhead), replacing a point within tolerance. */
export function numberKey(script, sel, opts) {
  const { key = 5, at, tolerance = 40, frameMs = 0 } = O(opts);
  return setPointAt(script, sel, { at, pos: Math.min(10, Math.max(0, key)) * 10, tolerance, frameMs });
}

/** Delete the selected actions. -> ats = []. */
export function deletePoints(script, sel) {
  const info = selInfo(script, sel);
  if (!info.n) return { script, ats: [] };
  return { script: script.filter((_, i) => !info.m[i]), ats: [] };
}

/** Move by dt ms and dpos. collide: 'moved' (moved points win, may pass others) | 'clamp' (stay between unselected
 *  neighbours). frameMs>0 snaps the new times to the frame grid (frameOrigin offsets the grid). */
export function movePoints(script, sel, opts) {
  const { dt = 0, dpos = 0, collide = 'moved', frameMs = 0, frameOrigin = 0 } = O(opts);
  return retime(script, sel, (a) => frameSnap(a.at + fin(dt, 0), frameMs, frameOrigin), {
    collide, fPos: (a) => a.pos + fin(dpos, 0),
  });
}

/** Nudge time by +-frames (frameMs per frame, default 30 fps). */
export function nudgeTime(script, sel, opts) {
  const { frames = 1, frameMs = 1000 / 30, collide = 'clamp' } = O(opts);
  return movePoints(script, sel, { dt: rnd(frames * frameMs), collide });
}

/** Nudge pos by `amount` (clamped to 0..100). */
export function nudgePos(script, sel, opts) {
  return mapPos(script, sel, (p) => p + fin(O(opts).amount, 1));
}

/** Set every selected pos to `pos`. */
export function setPos(script, sel, opts) {
  const v = fin(O(opts).pos, 50);
  return mapPos(script, sel, () => v);
}

/** Move the selection (rigidly) so its first action lands at `at`. */
export function setTime(script, sel, opts) {
  const { at = 0, collide = 'moved' } = O(opts);
  const info = selInfo(script, sel);
  if (!info.n) return { script, ats: [] };
  const dt = rnd(at) - script[info.idx[0]].at;
  return movePoints(script, sel, { dt, collide });
}

