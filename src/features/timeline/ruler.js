// ruler.js -- pure ruler logic: which part is under the pointer, and the range a drag produces.
import { snapTime, snapDelta } from './intervals.js';
import { msToX } from '../../lib/lane.js';

export const BAND_Y = 16;   // the lower range band starts this many px from the top
export const EDGE = 6;      // px grab zone at a range edge

/** -> 'scrub' | 'new' | 't0' | 't1' | 'move'. y in lane px; shift forces range creation. */
export function hitRuler({ view, w, x, y, range, shift = false }) {
  if (range && y >= BAND_Y) {
    const x0 = msToX(view, w, range.t0), x1 = msToX(view, w, range.t1), e = Math.min(EDGE, (x1 - x0) / 3);
    const d0 = Math.abs(x - x0), d1 = Math.abs(x - x1);
    if (d0 <= EDGE && x <= x0 + e && d0 <= d1) return 't0';
    if (d1 <= EDGE && x >= x1 - e) return 't1';
    if (x > x0 && x < x1) return 'move';
  }
  return shift || y >= BAND_Y ? 'new' : 'scrub';
}

/**
 * The range after a drag. kind from hitRuler; tStart = pointer time at press, t = now; range0 = range at press.
 * sc = {targets, tol, frameMs} (snapContext, or tol 0 / no targets for no snapping). -> {range, snap}
 */
export function dragRange(kind, range0, tStart, t, sc, dur) {
  const cl = (v) => Math.max(0, Math.min(dur, v));
  if (kind === 'move') {
    const len = range0.t1 - range0.t0;
    const s = snapDelta([range0.t0, range0.t1], t - tStart, sc.targets, sc.tol, sc.frameMs);
    const t0 = Math.max(0, Math.min(dur - len, range0.t0 + s.dt));
    return { range: { t0, t1: t0 + len }, snap: s.target };
  }
  const s = snapTime(t, sc.targets, sc.tol, sc.frameMs), p = cl(s.t);
  const a = kind === 'new' ? cl(snapTime(tStart, sc.targets, sc.tol, sc.frameMs).t) : kind === 't0' ? range0.t1 : range0.t0;
  return { range: { t0: Math.min(a, p), t1: Math.max(a, p) }, snap: s.target };
}

/** Nearest cut within tol ms of t -> text, or null. cuts: [t] or [{t, text}] ('cut' / 'camera move (zoom), not a cut'). */
export function markAt(t, tol, cuts) {
  for (const c of cuts) {
    const ct = typeof c === 'number' ? c : c.t;
    if (Math.abs(ct - t) <= tol) return typeof c === 'number' || !c.text ? 'Cut' : `${c.text[0].toUpperCase()}${c.text.slice(1)}`;
  }
  return null;
}
