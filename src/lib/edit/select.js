// Selection helpers. Pure: (script, sel, opts) -> { script (unchanged), ats }. `sel` is the current selection (null = everything).
import { selInfo, selMask, O } from './util.js';
import { turns, strokes } from './strokes.js';
import { speeds } from '../core/script.js';

const done = (script, idx) => ({ script, ats: idx.map((i) => script[i].at) });

/** All actions with t0 <= at <= t1 (also used for "select all in chapter"). */
export function selectRange(script, sel, opts) {
  const { t0, t1 } = O(opts);
  return done(script, [...selMask(script, { t0, t1 }).entries()].filter(([, v]) => v).map(([i]) => i));
}
export const selectChapter = selectRange;

export const selectAll = (script) => done(script, script.map((_, i) => i));

/** Extend the selection by `count` actions after its last (side 'after'), before its first ('before') or both. */
export function grow(script, sel, opts) {
  const { count = 1, side = 'both' } = O(opts), info = selInfo(script, sel), set = new Set(info.idx);
  if (!info.n) return done(script, []);
  const lo = info.idx[0], hi = info.idx[info.n - 1];
  for (let k = 1; k <= count; k++) {
    if (side !== 'before' && hi + k < script.length) set.add(hi + k);
    if (side !== 'after' && lo - k >= 0) set.add(lo - k);
  }
  return done(script, [...set].sort((a, b) => a - b));
}

/** Drop `count` actions from the end (side 'after'), the start ('before') or both. */
export function shrink(script, sel, opts) {
  const { count = 1, side = 'both' } = O(opts), idx = selInfo(script, sel).idx.slice();
  const a = side === 'after' ? 0 : count, b = side === 'before' ? 0 : count;
  return done(script, idx.slice(a, Math.max(a, idx.length - b)));
}

/** Every n-th selected action starting at `offset`. */
export function everyNth(script, sel, opts) {
  const { n = 2, offset = 0 } = O(opts), idx = selInfo(script, sel).idx, N = Math.max(1, Math.floor(n));
  return done(script, idx.filter((_, k) => (((k - offset) % N) + N) % N === 0));
}

/** Only tops, bottoms or both (turning points of the whole script, restricted to the selection). */
export function selectTurns(script, sel, opts) {
  const { which = 'both', minProminence = 0 } = O(opts), m = selMask(script, sel);
  return done(script, turns(script, minProminence).filter((t) => m[t.i] && (which === 'both' || (which === 'tops') === (t.kind === 'top'))).map((t) => t.i));
}

/** Actions whose speed (pos/s) is >= above and/or <= below. basis: 'in' (segment ending there) | 'out' | 'max' of both. */
export function selectBySpeed(script, sel, opts) {
  const { above = 0, below = Infinity, basis = 'max' } = O(opts), m = selMask(script, sel), sp = speeds(script), idx = [];
  for (let i = 0; i < script.length; i++) {
    if (!m[i]) continue;
    const vin = i ? sp[i] : 0, vout = i + 1 < script.length ? sp[i + 1] : 0;
    const v = basis === 'in' ? vin : basis === 'out' ? vout : Math.max(vin, vout);
    if (v >= above && v <= below) idx.push(i);
  }
  return done(script, idx);
}

/** Select every stroke that looks like the reference stroke (first full stroke inside the selection, else the one holding its first
 *  action): same direction, amplitude within +-ampTol pos units, duration within +-durTolPct %. Selects the actions i0..i1 of each match. */
export function selectSimilar(script, sel, opts) {
  const { ampTol = 10, durTolPct = 25, minProminence = 0 } = O(opts), info = selInfo(script, sel), S = strokes(script, minProminence);
  if (!info.n || !S.length) return done(script, []);
  const ref = S.find((s) => info.m[s.i0] && info.m[s.i1]) || S.find((s) => s.i0 <= info.idx[0] && info.idx[0] <= s.i1);
  if (!ref) return done(script, []);
  const set = new Set();
  for (const s of S) {
    if (s.dir !== ref.dir || Math.abs(s.amplitude - ref.amplitude) > ampTol) continue;
    if (Math.abs(s.durationMs - ref.durationMs) > (ref.durationMs * durTolPct) / 100) continue;
    for (let i = s.i0; i <= s.i1; i++) set.add(i);
  }
  return done(script, [...set].sort((a, b) => a - b));
}

/** Complement: every action not selected (within opts.t0..t1 if given). */
export function invertSelection(script, sel, opts) {
  const { t0, t1 } = O(opts), m = selMask(script, sel), within = t0 != null || t1 != null ? selMask(script, { t0, t1 }) : null, idx = [];
  for (let i = 0; i < script.length; i++) if (!m[i] && (!within || within[i])) idx.push(i);
  return done(script, idx);
}
