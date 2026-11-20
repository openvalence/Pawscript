// pivot.js -- paw-5zpf stage 2: the pivot (Blender's transform pivot point) and the maths of S (scale time and level about it)
// and R (rotate: time stays, levels tilt about it). Pure (test/lanes-pivot.test.mjs). Every function previews from the script
// as it was when the transform began (s0), so Esc restores it exactly; a level pushed past 0 / 100 is clamped there and counted
// (the status line says so) instead of the shape being flattened silently.
import { islands } from './elements.js';

export const PIVOTS = ['start', 'middle', 'end', 'playhead', 'active', 'individual'];
export const PIVOT_LABEL = { start: 'Start', middle: 'Middle', end: 'End', playhead: 'Playhead', active: 'Active element', individual: 'Individual origins' };
export const pivotOf = (v) => (PIVOTS.includes(v) ? v : 'middle');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** The line's level at time t (between its points; the end level past either end). */
export function levelAt(s, t) {
  if (!s.length) return 50;
  let lo = 0, hi = s.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (s[m].at < t) lo = m + 1; else hi = m; }
  if (lo <= 0) return s[0].pos;
  if (lo >= s.length) return s[s.length - 1].pos;
  const p = s[lo - 1], q = s[lo];
  return q.at === p.at ? q.pos : p.pos + ((q.pos - p.pos) * (t - p.at)) / (q.at - p.at);
}
const mid = (s, g) => { let lo = 100, hi = 0; for (const i of g) { lo = Math.min(lo, s[i].pos); hi = Math.max(hi, s[i].pos); } return (lo + hi) / 2; };

/**
 * The pivots of the selected indices idx (sorted) of s: [{idx (the points it moves), t, pos}]. One group, except Individual
 * origins: one per island (a run of consecutive selected points: Blender's connected parts), each about its own middle.
 *   start / end: the first / last selected point (time and level); middle: the bounding box centre; playhead: its time, the
 *   line's level there; active: the active element's centre (active = [i0, i1] or null: else the middle).
 */
export function pivots(s, idx, kind, { playhead = 0, active = null } = {}) {
  if (!idx.length) return [];
  const k = pivotOf(kind), a = s[idx[0]], b = s[idx[idx.length - 1]];
  if (k === 'individual') return islands(idx).map((g) => ({ idx: g, t: (s[g[0]].at + s[g[g.length - 1]].at) / 2, pos: mid(s, g) }));
  let t, pos;
  if (k === 'start') ({ at: t, pos } = a);
  else if (k === 'end') ({ at: t, pos } = b);
  else if (k === 'playhead') { t = playhead; pos = levelAt(s, playhead); }
  else if (k === 'active' && active) { const g = []; for (let i = active[0]; i <= active[1]; i++) g.push(i); t = (s[active[0]].at + s[active[1]].at) / 2; pos = mid(s, g); }
  else { t = (a.at + b.at) / 2; pos = mid(s, idx); }
  return [{ idx, t, pos }];
}

/**
 * The time factors that keep every group's order: no selected point crosses or meets an unselected neighbour, none goes before 0
 * or past dur, no two selected points merge (a gap g never below 1 ms). -> [lo, hi], always holding 1.
 */
export function timeFactorLimits(s, groups, dur = Infinity) {
  let lo = 0, hi = Infinity;
  const ge = (c, k) => { if (c > 0) lo = Math.max(lo, k / c); else if (c < 0) hi = Math.min(hi, k / c); };   // c * f >= k
  for (const { idx, t: tp } of groups) for (const g of islands(idx)) {
    const f = g[0], l = g[g.length - 1], A = s[f].at, B = s[l].at;
    const P = f > 0 ? s[f - 1].at + 1 : 0, N = l < s.length - 1 ? s[l + 1].at - 1 : dur;
    ge(A - tp, P - tp);                // tp + (A - tp) f >= P
    ge(B - tp, P - tp);
    if (Number.isFinite(N)) { ge(-(A - tp), -(N - tp)); ge(-(B - tp), -(N - tp)); }   // tp + (x - tp) f <= N
    for (let q = 1; q < g.length; q++) ge(s[g[q]].at - s[g[q - 1]].at, 1);   // gaps stay >= 1 ms
  }
  return [Math.min(lo, 1), Math.max(hi, 1)];
}

/**
 * S: scale time by fx and level by fy about each group's pivot. -> {script, idx (same order), clamped (indices whose level hit 0 /
 * 100), fx (the time factor actually used: limited by timeFactorLimits)}.
 */
export function scalePoints(s0, groups, { fx = 1, fy = 1, dur = Infinity } = {}) {
  const [lo, hi] = timeFactorLimits(s0, groups, dur), f = clamp(fx, lo, hi), script = s0.slice(), clamped = [];
  for (const { idx, t, pos } of groups) for (const i of idx) {
    const p = pos + (s0[i].pos - pos) * fy, q = clamp(Math.round(p), 0, 100);
    if (q !== Math.round(p)) clamped.push(i);
    script[i] = { at: Math.round(t + (s0[i].at - t) * f), pos: q };
  }
  return { script, idx: groups.flatMap((g) => g.idx).sort((a, b) => a - b), clamped, fx: f };
}

/** R: the far end of a group (the selected point farthest in time from its pivot), signed time from the pivot (0: none). */
export const farOf = (s, g) => g.idx.reduce((m, i) => (Math.abs(s[i].at - g.t) > Math.abs(m) ? s[i].at - g.t : m), 0);
/**
 * R: tilt the levels about each group's pivot time; time stays. a = {d}: the level change at each group's far end (typed), or
 * {slope}: pos per ms, the same for every group (the mouse's angle). Each point moves in proportion to its time from the pivot.
 * -> {script, idx, clamped, d (the reference group's far-end change)}.
 */
export function rotatePoints(s0, groups, a) {
  const script = s0.slice(), clamped = [];
  let dRef = 0;
  groups.forEach((g, n) => {
    const far = farOf(s0, g);
    if (!far) return;
    const slope = a.d != null ? a.d / far : a.slope || 0;
    if (n === 0) dRef = slope * far;
    for (const i of g.idx) {
      const p = s0[i].pos + slope * (s0[i].at - g.t), q = clamp(Math.round(p), 0, 100);
      if (q !== Math.round(p)) clamped.push(i);
      script[i] = { at: s0[i].at, pos: q };
    }
  });
  return { script, idx: groups.flatMap((g) => g.idx).sort((x, y) => x - y), clamped, d: dRef };
}
