// Time operations. Selection-based ones take collide: 'moved' (moved point wins, may reorder) | 'clamp' (stay between neighbours).
import { lowerBound } from '../core/script.js';
import { selInfo, retime, rnd, frameSnap, O, fin } from './util.js';

/** Shift the selection by dt ms. */
export function shift(script, sel, opts) {
  const { dt = 0, collide = 'moved' } = O(opts), d = rnd(fin(dt, 0));
  return retime(script, sel, (a) => a.at + d, { collide });
}

/** Scale times about an anchor: 'start' | 'end' | 'center' (of the selection) | 'playhead' / 'custom' (opts.at). factor > 1 = slower. */
export function stretch(script, sel, opts) {
  const { factor = 1, anchor = 'start', at, collide = 'moved' } = O(opts), f = fin(factor, 1);
  return retime(script, sel, (a, k, info) => {
    const p = anchor === 'end' ? info.t1 : anchor === 'center' ? (info.t0 + info.t1) / 2 : anchor === 'playhead' || anchor === 'custom' ? fin(at, info.t0) : info.t0;
    return p + (a.at - p) * f;
  }, { collide });
}

/** Make the selection's span exactly `duration` ms, keeping the start, end or centre in place. */
export function fitDuration(script, sel, opts) {
  const { duration = 1000, anchor = 'start', collide = 'moved' } = O(opts);
  const info = selInfo(script, sel);
  if (!info.n || !(info.t1 > info.t0)) return { script, ats: info.idx.map((i) => script[i].at) };
  return stretch(script, sel, { factor: Math.max(1, duration) / (info.t1 - info.t0), anchor, collide });
}

/** Map the selection's span onto [t0, t1] (new start and end). */
export function fitToRange(script, sel, opts) {
  const { t0 = 0, t1 = 1000, collide = 'moved' } = O(opts);
  const info = selInfo(script, sel);
  if (!info.n) return { script, ats: [] };
  const f = info.t1 > info.t0 ? (t1 - t0) / (info.t1 - info.t0) : 1;
  return retime(script, sel, (a) => t0 + (a.at - info.t0) * f, { collide });
}

/** Mirror the selection in time about the middle of its range (range selection: of the range). */
export function reverse(script, sel) {
  return retime(script, sel, (a, k, info) => info.t0 + info.t1 - a.at, { collide: 'moved' });
}

const rangeOfSel = (script, sel, opts) => {
  const info = selInfo(script, sel), o = O(opts);
  const t0 = o.t0 ?? info.t0;
  return { info, t0: t0 == null ? t0 : Math.max(0, t0), t1: o.t1 ?? info.t1 };
};

/** Open a gap: everything at/after `at` (default: selection start) moves later by `duration` (default: selection length).
 *  ats = the previously selected actions' new times. NOT selection-local: ripples the rest of the script. */
export function rippleInsert(script, sel, opts) {
  const { info, t0, t1 } = rangeOfSel(script, sel, opts);
  const at = O(opts).at ?? t0, dur = rnd(O(opts).duration ?? (t1 != null && t0 != null ? t1 - t0 : 0));
  if (at == null || !(dur > 0)) return { script, ats: info.idx.map((i) => script[i].at) };
  const out = script.map((a) => (a.at >= at ? { at: a.at + dur, pos: a.pos } : a));
  return { script: out, ats: info.idx.map((i) => out[i].at) };
}

/** Delete the time range [t0, t1] (default: the selection's range; for an action selection first..last selected) including every
 *  action in it, and close the gap: later actions move earlier by t1 - t0. ats = []. */
export function rippleDelete(script, sel, opts) {
  const { t0, t1 } = rangeOfSel(script, sel, opts);
  if (t0 == null || t1 == null) return { script, ats: [] };
  const d = t1 - t0, out = [];
  for (const a of script) {
    if (a.at < t0) out.push(a);
    else if (a.at > t1) out.push({ at: a.at - d, pos: a.pos });
  }
  return { script: out, ats: [] };
}

/** Snap times to the frame grid (frameMs, origin) or, for VFR, to the nearest of `times` (sorted ms). Collisions: moved wins, later wins. */
export function quantize(script, sel, opts) {
  const { frameMs = 1000 / 30, origin = 0, times } = O(opts);
  if (Array.isArray(times) && times.length) return snapToTimes(script, sel, { times });
  return retime(script, sel, (a) => frameSnap(a.at, frameMs, origin));
}

/** Snap each selected action to the nearest time in `times` if within tolerance ms (default: always). */
export function snapToTimes(script, sel, opts) {
  const { times = [], tolerance = Infinity, collide = 'moved' } = O(opts);
  const T = [...times].sort((x, y) => x - y), TO = T.map((t) => ({ at: t }));
  if (!T.length) return { script, ats: selInfo(script, sel).idx.map((i) => script[i].at) };
  return retime(script, sel, (a) => {
    const j = lowerBound(TO, a.at), c = [T[j - 1], T[j]].filter((v) => v != null);
    let best = c[0];
    for (const v of c) if (Math.abs(v - a.at) < Math.abs(best - a.at)) best = v;
    return Math.abs(best - a.at) <= tolerance ? best : a.at;
  }, { collide });
}

/** Evenly space the selected actions between the first and last selected one (those two stay put). */
export function equaliseSpacing(script, sel, opts) {
  const { collide = 'moved' } = O(opts);
  const inf = selInfo(script, sel);
  const first = inf.n ? script[inf.idx[0]].at : 0, last = inf.n ? script[inf.idx[inf.n - 1]].at : 0;
  return retime(script, sel, (a, k, info) => (info.n < 3 ? a.at : first + ((last - first) * k) / (info.n - 1)), { collide });
}
