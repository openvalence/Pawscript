// intervals.js -- pure edits on interval lists: [{id, t0, t1, ...}] sorted by t0, never overlapping, t0 < t1,
// integer ms inside [0, dur]. Used for plan segments, chapters and loop regions. Every function returns a new
// list (untouched items keep their identity) or null when the edit is impossible; inputs are never mutated.
//
// Neighbour rules while dragging (callers map modifiers to them):
//   clamp  stop at the neighbour                                    (default for moves; Alt for edges)
//   roll   an edge shared with a touching neighbour moves both      (default for edges)
//   push   neighbours are shoved along, keeping their length        (Ctrl)

import { frameStartOf } from '../../lib/lane.js';

export const byT0 = (a, b) => a.t0 - b.t0;
export const sorted = (list) => [...list].sort(byT0);

/** True if `list` satisfies the invariant (used by tests and at trust boundaries). */
export function isValidIntervals(list, dur = Infinity, minLen = 1) {
  const ids = new Set();
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    if (!Number.isInteger(x.t0) || !Number.isInteger(x.t1) || x.t0 < 0 || x.t1 > dur || x.t1 - x.t0 < minLen) return false;
    if (i && x.t0 < list[i - 1].t1) return false;
    if (ids.has(x.id)) return false;
    ids.add(x.id);
  }
  return true;
}

/**
 * Restore the invariant on untrusted input (a .pawproj): drop items without a span of at least 1 ms, sort by t0,
 * start each overlapping item at the previous end (dropping what that swallows whole).
 * -> {list, dropped, trimmed}; `list` is the input itself when nothing needed fixing.
 */
export function repairIntervals(list) {
  if (!Array.isArray(list)) return { list: [], dropped: 0, trimmed: 0 };
  const ok = list.filter((x) => x && Number.isFinite(x.t0) && Number.isFinite(x.t1) && x.t1 - x.t0 >= 1);
  let dropped = list.length - ok.length, trimmed = 0, end = -Infinity;
  const out = [];
  for (const x of sorted(ok)) {
    if (x.t1 <= end) { dropped++; continue; }
    if (x.t0 < end) { out.push({ ...x, t0: end }); trimmed++; } else out.push(x);
    end = Math.max(end, x.t1);
  }
  const same = !dropped && !trimmed && out.every((x, i) => x === list[i]);
  return { list: same ? list : out, dropped, trimmed };
}

/** The item containing t (t0 <= t < t1), or null. */
export const itemAt = (list, t) => list.find((x) => x.t0 <= t && t < x.t1) ?? null;
/** The items a box from t0 to t1 touches (the box hit of an interval row: a drag on empty space, B, C). */
export const spansIn = (list, t0, t1) => list.filter((x) => x.t1 >= Math.min(t0, t1) && x.t0 <= Math.max(t0, t1));
/** An id selection combined with box hits: mode 'add' (Shift) | 'sub' (Ctrl, or B / C's take-out) | 'replace'. */
export const combineIds = (sel, hits, mode) => (mode === 'add' ? [...new Set([...sel, ...hits])] : mode === 'sub' ? sel.filter((id) => !hits.includes(id)) : hits);

/** The free gap containing t as {t0, t1}, or null if t is inside an item. */
export function gapAt(list, t, dur) {
  let lo = 0, hi = dur;
  for (const x of list) {
    if (x.t0 <= t && t < x.t1) return null;
    if (x.t1 <= t) lo = Math.max(lo, x.t1);
    else { hi = Math.min(hi, x.t0); break; }
  }
  return { t0: lo, t1: hi };
}

/** Next item starting after t (dir > 0) or the last starting before t (dir < 0); eps avoids sticking. */
export function neighbour(list, t, dir, eps = 1) {
  if (dir > 0) return list.find((x) => x.t0 > t + eps) ?? null;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].t0 < t - eps) return list[i];
  return null;
}

/** All item edges except those of `exclude` ids, for snapping. */
export const edgesOf = (list, exclude = new Set()) => list.filter((x) => !exclude.has(x.id)).flatMap((x) => [x.t0, x.t1]);

// ---- snapping ----
/** Snap targets: numbers or {t, label}, any order -> sorted [{t, label}] without duplicates. */
export function snapTargets(...groups) {
  const all = groups.flat().filter((x) => x != null).map((x) => (typeof x === 'number' ? { t: x, label: '' } : x)).filter((x) => Number.isFinite(x.t));
  all.sort((a, b) => a.t - b.t);
  return all.filter((x, i) => !i || x.t !== all[i - 1].t);
}
function nearestTarget(targets, t) {
  let lo = 0, hi = targets.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (targets[m].t < t) lo = m + 1; else hi = m; }
  let best = null;
  for (const j of [lo - 1, lo]) if (j >= 0 && j < targets.length && (!best || Math.abs(targets[j].t - t) < Math.abs(best.t - t))) best = targets[j];
  return best;
}
/** t snapped to the nearest target within tol ms, else to the start of the frame containing it (if frameMs; paw-ef73.14:
 *  structure lands on frames), else rounded. */
export function snapTime(t, targets = [], tol = 0, frameMs = 0) {
  const n = nearestTarget(targets, t);
  if (n && Math.abs(n.t - t) <= tol) return { t: Math.round(n.t), target: n };
  return { t: frameStartOf(t, frameMs), target: null };
}
/** A drag delta snapped so the closest of `edges` (+dt) lands on a target, else the first edge on the frame grid. */
export function snapDelta(edges, dt, targets = [], tol = 0, frameMs = 0) {
  let best = null, bd = Infinity;
  for (const e of edges) {
    const n = nearestTarget(targets, e + dt);
    if (n && Math.abs(n.t - (e + dt)) < bd) { bd = Math.abs(n.t - (e + dt)); best = { d: n.t - e, target: n }; }
  }
  if (best && bd <= tol) return { dt: Math.round(best.d), target: best.target };
  if (frameMs && edges.length) return { dt: frameStartOf(edges[0] + dt, frameMs) - edges[0], target: null };
  return { dt: Math.round(dt), target: null };
}

// ---- edits ----
/** Insert {t0, t1, ...} confined to the free gap containing `anchor` (default t0). t0 > t1 is fine (drag left). */
export function create(list, item, { dur, minLen = 1, anchor = item.t0 } = {}) {
  const g = gapAt(list, anchor, dur);
  if (!g) return null;
  const t0 = Math.round(Math.max(Math.min(item.t0, item.t1), g.t0)), t1 = Math.round(Math.min(Math.max(item.t0, item.t1), g.t1));
  if (t1 - t0 < minLen) return null;
  return sorted([...list, { ...item, t0, t1 }]);
}

// One push pass: selected items shift by d, others only when shoved. null if anything leaves [0, dur].
function pushPass(L, sel, d, dur) {
  const out = L.slice();
  if (d >= 0) {
    let prev = -Infinity;
    for (let i = 0; i < L.length; i++) {
      const x = L[i];
      let t0 = sel.has(x.id) ? x.t0 + d : x.t0;
      if (t0 < prev) t0 = prev;
      const t1 = t0 + (x.t1 - x.t0);
      if (t0 !== x.t0) out[i] = { ...x, t0, t1 };
      prev = t1;
    }
    return prev > dur ? null : out;
  }
  let next = Infinity;
  for (let i = L.length - 1; i >= 0; i--) {
    const x = L[i];
    let t1 = sel.has(x.id) ? x.t1 + d : x.t1;
    if (t1 > next) t1 = next;
    const t0 = t1 - (x.t1 - x.t0);
    if (t1 !== x.t1) out[i] = { ...x, t0, t1 };
    next = t0;
  }
  return next < 0 ? null : out;
}

/**
 * Move the items `ids` by dt ms. o: {dur, push, targets, tol, frameMs}. Snapping first (any group edge onto a
 * target, else the frame grid), then the neighbour rule. -> {list, dt (applied), snap (target or null)}.
 */
export function move(list, ids, dt, { dur, push = false, targets, tol = 0, frameMs = 0 } = {}) {
  const sel = new Set(ids), L = sorted(list), group = L.filter((x) => sel.has(x.id));
  if (!group.length) return { list: L, dt: 0, snap: null };
  let snap = null;
  if (targets?.length || frameMs) ({ dt, target: snap } = snapDelta(group.flatMap((x) => [x.t0, x.t1]), dt, targets, tol, frameMs));
  dt = Math.round(dt);
  if (!push) {
    let lo = -Infinity, hi = Infinity, prevEnd = 0;
    const nextStart = new Array(L.length);
    for (let i = L.length - 1, n = dur; i >= 0; i--) { nextStart[i] = n; if (!sel.has(L[i].id)) n = L[i].t0; }
    for (let i = 0; i < L.length; i++) {
      const x = L[i];
      if (!sel.has(x.id)) { prevEnd = x.t1; continue; }
      lo = Math.max(lo, prevEnd - x.t0); hi = Math.min(hi, nextStart[i] - x.t1);
    }
    const c = Math.max(lo, Math.min(hi, dt));
    if (c !== dt) snap = null;
    dt = lo > hi ? 0 : c;
    return { list: dt ? L.map((x) => (sel.has(x.id) ? { ...x, t0: x.t0 + dt, t1: x.t1 + dt } : x)) : L, dt, snap };
  }
  let out = pushPass(L, sel, dt, dur);
  if (!out) {   // largest |d| <= |dt| that fits (fitting is monotone in |d|)
    snap = null;
    let ok = 0, bad = Math.abs(dt);
    while (bad - ok > 1) { const m = (ok + bad) >> 1; if (pushPass(L, sel, Math.sign(dt) * m, dur)) ok = m; else bad = m; }
    dt = ok && Math.sign(dt) * ok;
    out = pushPass(L, sel, dt, dur);
  }
  return { list: out, dt, snap };
}

/**
 * Drag one edge ('t0' | 't1') of item `id` to t. o: {dur, minLen, mode: 'roll'|'clamp'|'push', targets, tol, frameMs}.
 * -> {list, t (applied), snap}.
 */
export function resize(list, id, edge, t, { dur, minLen = 1, mode = 'roll', targets, tol = 0, frameMs = 0 } = {}) {
  let L = sorted(list);
  const i = L.findIndex((x) => x.id === id);
  if (i < 0) return { list: L, t, snap: null };
  let { t: s, target: snap } = snapTime(t, targets, tol, frameMs);
  const x = L[i], start = edge === 't0';
  const nb = L[start ? i - 1 : i + 1];
  const lim = start ? x.t1 - minLen : x.t0 + minLen;
  const clampTo = (v) => { if (v !== s) snap = null; s = v; };
  clampTo(start ? Math.min(s, lim) : Math.max(s, lim));
  if (!nb) clampTo(start ? Math.max(s, 0) : Math.min(s, dur));
  else if (mode === 'roll' && (start ? nb.t1 === x.t0 : nb.t0 === x.t1)) {
    clampTo(start ? Math.max(s, nb.t0 + minLen) : Math.min(s, nb.t1 - minLen));
    L = L.map((y) => (y === nb ? { ...y, [start ? 't1' : 't0']: s } : y));
  } else if (mode === 'push' && (start ? s < nb.t1 : s > nb.t0)) {
    const r = move(L, [nb.id], start ? s - nb.t1 : s - nb.t0, { dur, push: true });
    L = r.list;
    clampTo(start ? nb.t1 + r.dt : nb.t0 + r.dt);
  } else clampTo(start ? Math.max(s, nb.t1) : Math.min(s, nb.t0));
  return { list: L.map((y) => (y.id === id ? { ...y, [edge]: s } : y)), t: s, snap };
}

/** Split item `id` at t; the right half gets `newId`. null if either half would be shorter than minLen. */
export function split(list, id, t, { minLen = 1, newId } = {}) {
  t = Math.round(t);
  const x = list.find((y) => y.id === id);
  if (!x || t - x.t0 < minLen || x.t1 - t < minLen) return null;
  return sorted([...list.filter((y) => y !== x), { ...x, t1: t }, { ...x, id: newId, t0: t }]);
}

/** Merge runs of selected items that are consecutive in the list (gaps between them are absorbed). -> {list, ids} | null. */
export function merge(list, ids) {
  const sel = new Set(ids), L = sorted(list), out = [], merged = [];
  let run = [];
  const flush = () => {
    if (run.length > 1) { const m = { ...run[0], t1: run[run.length - 1].t1 }; out.push(m); merged.push(m.id); } else out.push(...run);
    run = [];
  };
  for (const x of L) { if (sel.has(x.id)) run.push(x); else { flush(); out.push(x); } }
  flush();
  return merged.length ? { list: out, ids: merged } : null;
}

/** Copies of the selected items placed right after them, later items pushed along. -> {list, ids} | null (no room). */
export function duplicate(list, ids, { dur, newId } = {}) {
  const sel = new Set(ids), L = sorted(list), group = L.filter((x) => sel.has(x.id));
  if (!group.length) return null;
  const d = group[group.length - 1].t1 - group[0].t0;
  const copies = group.map((x) => ({ ...x, id: newId(), t0: x.t0 + d, t1: x.t1 + d }));
  const copyIds = new Set(copies.map((c) => c.id));
  const all = [...L, ...copies].sort((a, b) => a.t0 - b.t0 || (copyIds.has(b.id) ? 1 : 0) - (copyIds.has(a.id) ? 1 : 0));
  const out = pushPass(all, new Set(), 0, dur);
  return out ? { list: out, ids: [...copyIds] } : null;
}

export const remove = (list, ids) => { const s = new Set(ids); return list.filter((x) => !s.has(x.id)); };
/** Replace selected items by fn(item) (a patch object or a full item). */
export const patch = (list, ids, fn) => { const s = new Set(ids); return list.map((x) => (s.has(x.id) ? { ...x, ...fn(x) } : x)); };
