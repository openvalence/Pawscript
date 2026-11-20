// The one data contract every editor module shares. FROZEN: extend by adding, never by changing.
//
//   Action = { at: integer ms from video start, pos: integer 0..100 }      pos 0 = deepest, 100 = out
//   Script = Action[] sorted by `at`, strictly increasing (no duplicate timestamps)
//
// Scripts are immutable values: every function returns a NEW array and never mutates its input.
// That is what makes undo trivial (keep the previous array) and lets Svelte see changes by identity.

export const clampPos = (p) => Math.max(0, Math.min(100, Math.round(p)));

/** Any list of {at,pos} -> valid Script: ints, clamped, sorted, later entry wins on equal `at`. */
export function normalize(actions) {
  const byAt = new Map();
  for (const a of actions) {
    const at = Math.round(a.at);
    if (Number.isFinite(at) && at >= 0 && Number.isFinite(a.pos)) byAt.set(at, clampPos(a.pos));
  }
  return [...byAt.keys()].sort((x, y) => x - y).map((at) => ({ at, pos: byAt.get(at) }));
}

/** Index of the first action with at >= t (script.length if none). */
export function lowerBound(script, t) {
  let lo = 0, hi = script.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (script[mid].at < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Index of the action exactly at t, or -1. */
export function indexAt(script, t) {
  const i = lowerBound(script, t);
  return i < script.length && script[i].at === t ? i : -1;
}

/** Index of the action nearest to t within tolMs, or -1. */
export function nearest(script, t, tolMs = Infinity) {
  const i = lowerBound(script, t);
  let best = -1, d = tolMs;
  for (const j of [i - 1, i]) {
    if (j >= 0 && j < script.length && Math.abs(script[j].at - t) <= d) { best = j; d = Math.abs(script[j].at - t); }
  }
  return best;
}

/** Position a device would be at at time t (linear between actions, held outside). NaN if empty. */
export function posAt(script, t) {
  if (!script.length) return NaN;
  const i = lowerBound(script, t);
  if (i === 0) return script[0].pos;
  if (i === script.length) return script[i - 1].pos;
  const a = script[i - 1], b = script[i];
  return a.pos + ((b.pos - a.pos) * (t - a.at)) / (b.at - a.at);
}

/** Actions with t0 <= at <= t1, as a new array. */
export const slice = (script, t0, t1) => script.slice(lowerBound(script, t0), lowerBound(script, t1 + 1));

/** [i0, i1) index range of actions with t0 <= at <= t1. */
export const rangeIndices = (script, t0, t1) => [lowerBound(script, t0), lowerBound(script, t1 + 1)];

/** Insert or replace actions (later wins on equal `at`). */
export const upsert = (script, actions) => normalize([...script, ...actions]);

/** Remove the actions whose `at` is in `ats` (array or Set of ms). */
export function removeAt(script, ats) {
  const s = ats instanceof Set ? ats : new Set(ats);
  return script.filter((a) => !s.has(a.at));
}

/** Remove everything with t0 <= at <= t1. */
export const removeRange = (script, t0, t1) => script.filter((a) => a.at < t0 || a.at > t1);

/** Replace the content of [t0, t1] with `actions` (which should lie inside it). */
export const replaceRange = (script, t0, t1, actions) => normalize([...removeRange(script, t0, t1), ...actions]);

/** Speed between consecutive actions in pos units per second; result[i] is the segment ending at i (result[0] = 0). */
export const speeds = (script) => script.map((a, i) => (i ? (Math.abs(a.pos - script[i - 1].pos) * 1000) / (a.at - script[i - 1].at) : 0));

/** True if `script` already satisfies the contract (cheap check for tests and trust boundaries). */
export function isValid(script) {
  return Array.isArray(script) && script.every((a, i) =>
    Number.isInteger(a.at) && a.at >= 0 && Number.isInteger(a.pos) && a.pos >= 0 && a.pos <= 100 && (i === 0 || a.at > script[i - 1].at));
}

/** cleanMicro's defaults (settings edit.cleanMicroMs / edit.cleanMicroPos) and the join window either side of a join edge. */
export const MICRO = Object.freeze({ gapMs: 60, posTol: 6, blendMs: 300 });

/**
 * Remove micro features: the tiny wiggles joins leave (a stitch at a cut, an accept's edge, an effect key next to a base
 * point). A micro leg = two neighbours under gapMs apart whose positions differ by under posTol.
 *  (a) blip: a reversal whose two legs are both under posTol and whose neighbours are under gapMs apart -> it goes;
 *  (b) a micro leg against the motion around it (a back-step or a stall on a slope) -> of its two points the one
 *      further off the line through their outer neighbours goes; at a turn the less extreme one goes (the turn keeps
 *      its extreme). A micro leg WITH the motion (dense samples on a slope) is left alone;
 *  (c) legs shorter than minGapMs (0 = off) count as micro legs whatever their size, except a back-step >= posTol (a real turn).
 * Never removes the first / last point, a point inside a `keep` range, or one outside `spans` ([[t0, t1]], null = anywhere;
 * the neighbours used as context may lie outside). Dropping a point never raises the speed between its neighbours
 * (|a + b| / (t1 + t2) <= the faster of the two legs; checked anyway). Repeats to a fixed point: idempotent.
 * -> the points left (the same array when nothing goes; an unsorted / invalid input is normalised first).
 */
export function cleanMicro(script, { gapMs = MICRO.gapMs, posTol = MICRO.posTol, minGapMs = 0, spans = null, keep = null } = {}) {
  // a sorted list of finite points (a tracker's float points too) is cleaned as it is; anything else is normalised first
  const sorted = Array.isArray(script) && script.every((a, i) => Number.isFinite(a.at) && Number.isFinite(a.pos) && (!i || a.at > script[i - 1].at));
  const s = sorted ? script.slice() : normalize(script || []);
  const inR = (rs, t) => rs.some(([a, b]) => t >= a && t <= b);
  const can = (k) => k > 0 && k < s.length - 1 && (!spans || inR(spans, s[k].at)) && !(keep && inR(keep, s[k].at));
  const v = (a, b) => (Math.abs(b.pos - a.pos) * 1000) / (b.at - a.at);
  const drop = (j) => {
    if (!can(j) || v(s[j - 1], s[j + 1]) > Math.max(v(s[j - 1], s[j]), v(s[j], s[j + 1])) + 1e-9) return false;
    s.splice(j, 1);
    return true;
  };
  for (let changed = true; changed;) {
    changed = false;
    // (a) blips first: a blip's legs would otherwise read as a turn's micro leg and take its neighbour
    for (let k = 1; k + 1 < s.length; k++) {
      const p = s[k - 1], a = s[k], n = s[k + 1], dIn = a.pos - p.pos, dOut = n.pos - a.pos;
      if (Math.sign(dIn) * Math.sign(dOut) < 0 && Math.abs(dIn) < posTol && Math.abs(dOut) < posTol && n.at - p.at < gapMs && drop(k)) { changed = true; k--; }
    }
    // (b) / (c) the leg a..n, with p and q as its context
    for (let k = 1; k + 2 < s.length; k++) {
      const p = s[k - 1], a = s[k], n = s[k + 1], q = s[k + 2], dOut = n.pos - a.pos, dt = n.at - a.at, micro = dt < gapMs && Math.abs(dOut) < posTol;
      if (!micro && !(dt < minGapMs)) continue;
      let sIn = Math.sign(a.pos - p.pos), sOut = Math.sign(q.pos - n.pos);
      if (!sIn) sIn = sOut;
      if (!sOut) sOut = sIn;
      let j;
      if (sIn === sOut) {   // a slope (or flat): only a leg against it, or a too-close one, is a glitch
        const against = Math.sign(dOut) !== sIn;
        if (against ? !micro : !(dt < minGapMs)) continue;
        const line = (t) => p.pos + ((q.pos - p.pos) * (t - p.at)) / (q.at - p.at);
        j = Math.abs(n.pos - line(n.at)) >= Math.abs(a.pos - line(a.at)) ? k + 1 : k;
      } else j = sIn * (a.pos - n.pos) >= 0 ? k + 1 : k;   // a turn: the more extreme point stays
      if (drop(j)) { changed = true; k--; }
    }
  }
  return sorted && s.length === script.length ? script : s;
}

/** cleanMicro within blendMs (default MICRO.blendMs) of each join: a time (ms) or a [t0, t1] span of joins.
 *  opts: cleanMicro's (keep, gapMs, posTol, minGapMs) + blendMs; null = off. */
export function cleanJoins(script, joins, opts) {
  if (!opts || !joins?.length) return script;
  const w = opts.blendMs ?? MICRO.blendMs;
  return cleanMicro(script, { ...opts, spans: joins.map((j) => (Array.isArray(j) ? [j[0] - w, j[1] + w] : [j - w, j + w])) });
}
