// script-of.js -- the script at time t (paw-x7w7): ONE accessor for what is drawn, edited, played, analysed and written.
//
//   doc.axes[axis]   the BAKED points: permanent. No run, fusion, derive, anchor, range or flip change ever alters them. What
//                    Accept wrote before paw-x7w7 is baked as it is, byte for byte.
//   live             every piece of a shot (a run range's part of it; a project before ranges: the whole shot, its link's run)
//                    with NO baked points in it whose run has points there plays that run's derived points, recomputed whenever
//                    anything they come from changes; then (stroke) the fills, bridges, holds and positioning eases over spans
//                    with no baked points. Per piece: baked wins; live elsewhere; untracked gaps are the base as before.
//
// scriptOf(app, axis) = the base with the live spans in (composeLive), the same array while nothing changes it. The tracking
// store computes it (tracking.svelte.js liveOf, registered as app.liveOf; one memo per app and axis); without that store it is
// doc.axes[axis] itself. lib/finish.js finalOf / finalAxes evaluate autorange + modifiers over it: what plays and exports.
//
// Writes: app.edit(label, axis, next) settles `next` (settleEdit): every region an edit left as it was keeps the base there (a
// live piece stays live, a baked one keeps its points exactly), every region it changed takes the edit. So an edit computed from
// scriptOf that touches a live piece BAKES that piece in the same undo step; untouched live pieces stay live. Bake (bakeSpans)
// copies live points into the base; Unbake (unbakeRanges) removes a piece's baked points: the run plays there again.
import { lowerBound, isValid, normalize, slice, cleanMicro, MICRO } from './core/script.js';
import { acceptGhost } from '../features/tracking/accept.js';

const EMPTY = Object.freeze([]);
/** Points of s in [t0, t1). */
export const hasIn = (s, t0, t1) => { const k = lowerBound(s || EMPTY, t0); return k < (s?.length || 0) && s[k].at < t1; };
const part = (s, t0, t1) => s.slice(lowerBound(s, t0), lowerBound(s, t1));
const same = (a, b) => a === b || (a.length === b.length && a.every((p, k) => p.at === b[k].at && p.pos === b[k].pos));

/** The script of `axis` as it plays before autorange / modifiers: baked points + live spans. Never null. */
export function scriptOf(app, axis = app.doc.activeAxis) {
  return app.liveOf?.(axis)?.script ?? app.doc.axes?.[axis] ?? EMPTY;
}
/** Every axis of the document as scriptOf gives it: {axis: Script} (for code that reads a doc-shaped object). */
export const axesOf = (app) => Object.fromEntries(Object.keys(app.doc.axes || {}).map((a) => [a, scriptOf(app, a)]));
/** The live part of `axis`: {script (= scriptOf), spans [{t0, t1, kind: 'run' | 'fill', id?, name, shot?}]} | null (nothing live). */
export const liveOf = (app, axis = app.doc.activeAxis) => app.liveOf?.(axis) ?? null;

/**
 * The live spans in the order they apply. shots [{start_ms, end_ms}], base (doc.axes[axis]), runOf(i) -> the ghost
 * ({id, name, script}) shot i plays from on this axis | null, or (paw-1ysd, run ranges) [{t0, t1, g}] pieces of the shot, selected: the run ghost used when there are no shots,
 * bridges [{t0, t1, script, mode}] (fills, holds, eases; stroke only), empty [{t0, t1}] this axis's spans baked EMPTY
 * (paw-q8jh: every point of a live piece deleted: nothing plays there). A piece / bridge with baked points, or baked empty, is skipped.
 */
export function liveSpans({ shots = [], base = EMPTY, runOf = () => null, selected = null, bridges = [], empty = EMPTY }) {
  const out = [], baked = (a, b) => hasIn(base, a, b) || emptyIn(empty, a, b);
  if (!shots.length && selected?.script?.length) {
    const s = selected.script, t0 = s[0].at, t1 = s[s.length - 1].at + 1;
    if (!baked(t0, t1)) out.push({ t0, t1, script: s, kind: 'run', id: selected.id, name: selected.name });
  }
  // paw-40ps: baked per PIECE (a run range's part of the shot): an edit or a Bake of one piece leaves the shot's other pieces
  // live. A project before ranges has one piece per shot (its link's run over the whole shot): per shot, as before.
  // paw-3ga3: span edges on the integer ms the points use (a cut at a fractional ms, from an old or hand-made file, left the
  // point at its floor in neither shot: a 1 ms hole at every such cut)
  shots.forEach((sh, i) => {
    const t0 = Math.round(sh.start_ms), t1 = Math.round(sh.end_ms);
    if (!(t1 > t0)) return;
    const r = runOf(i), pieces = Array.isArray(r) ? r : r ? [{ t0, t1, g: r }] : [];
    for (const { t0: a, t1: b, g } of pieces) {
      const p0 = Math.max(t0, Math.round(a)), p1 = Math.min(t1, Math.round(b));
      if (p1 > p0 && g?.script?.length && hasIn(g.script, p0, p1) && !baked(p0, p1)) out.push({ t0: p0, t1: p1, script: g.script, kind: 'run', id: g.id, name: g.name, shot: i });
    }
  });
  for (const b of bridges || []) { const t0 = Math.round(b.t0), t1 = Math.round(b.t1); if (b.script?.length && t1 > t0 && !baked(t0, t1)) out.push({ t0, t1, script: b.script, kind: 'fill', name: b.mode || 'fill' }); }
  return out;
}

// ---- paw-q8jh: baked EMPTY. doc.bakedEmpty [{axis, t0, t1}] (undoable, the .pawproj extra `bakedEmpty`): a live piece whose
// every point an edit deleted is baked with nothing in it: nothing plays there, the Scenes row shows it baked, Unbake gives it
// back to its run. A baked-empty span that later gets points is just baked (the points decide); Unbake drops both. ----
/** Does a baked-empty span of `empty` ([{t0, t1}], one axis) overlap [t0, t1)? */
export const emptyIn = (empty, t0, t1) => !!empty?.length && empty.some((m) => m.t0 < t1 && m.t1 > t0);
/** The live spans an edit emptied (next has no point left in them): they are baked empty. */
export const emptiedLive = (live, next) => touchedLive(live, next).filter((s) => !hasIn(next, s.t0, s.t1));
/** The stored list cleaned (load): [{axis, t0, t1}] with t1 > t0. */
export const normEmpty = (list) => (Array.isArray(list) ? list.filter((m) => m && typeof m.axis === 'string' && Number.isFinite(m.t0) && Number.isFinite(m.t1) && m.t1 > m.t0).map(({ axis, t0, t1 }) => ({ axis, t0, t1 })) : []);
/** list without axis's spans that overlap any of ranges [{t0, t1}] (Unbake). -> list itself when nothing goes. */
export function unmarkEmpty(list, axis, ranges) {
  const out = (list || EMPTY).filter((m) => m.axis !== axis || !emptyIn(ranges, m.t0, m.t1));
  return out.length === (list || EMPTY).length ? list || EMPTY : out;
}

/** The ranges that are not live (between and around the spans), for the join cleanup's `keep`: it never removes a baked point. */
function keepOutside(spans) {
  const iv = spans.map((s) => [s.t0, s.t1 - 1]).sort((a, b) => a[0] - b[0]), keep = [];
  let from = -1;
  for (const [a, b] of iv) { if (a - 1 >= from) keep.push([from, a - 1]); from = Math.max(from, b + 1); }
  keep.push([from, Number.MAX_SAFE_INTEGER]);
  return keep;
}

/**
 * base with the spans put in, each a replace over [t0, t1) as Accept wrote it (join cleanup `clean`, never touching points
 * outside the live spans). -> {script (base itself when nothing changes), spans (the ones that changed it)}.
 * paw-3ga3: spans that do not overlap (every live script the store composes) go in one pass: base outside them + each span's
 * points (cached per run script and piece), then the join cleanup once, only around the joins. Overlapping spans (a fill over
 * a run piece) go one by one, later winning, as before.
 */
export function composeLive(base, spans, clean = null) {
  base = base || EMPTY;
  const S = spans.filter((s) => s?.script?.length && s.t1 > s.t0).sort((a, b) => a.t0 - b.t0);
  if (S.some((s, k) => k && s.t0 < S[k - 1].t1)) return composeSeq(base, spans, clean);
  const B = isValid(base) ? base : normalize(base), out = [], used = [], joins = [];
  let i = 0;
  for (const s of S) {
    const take = takeOf(s.script, s.t0, s.t1);
    if (!take.length) continue;   // nothing of the run here: the base stays
    const j0 = lowerBound(B, s.t0), j1 = upperBound(B, s.t1 - 1);
    if (same(take, B.slice(j0, j1))) continue;
    for (; i < j0; i++) out.push(B[i]);
    for (const p of take) out.push(p);
    i = Math.max(i, j1); used.push(s); joins.push(s.t0, s.t1 - 1);
  }
  if (!used.length) return { script: base, spans: used };
  for (; i < B.length; i++) out.push(B[i]);
  if (!clean) return { script: out, spans: used };
  const script = cleanAround(out, [...joins, ...(clean.joins || [])], { ...clean, keep: [...(clean.keep || []), ...keepOutside(spans)] });
  return { script, spans: used };
}
/** The span-by-span compose (overlapping spans). */
function composeSeq(base, spans, clean) {
  let out = base;
  const used = [], c = clean ? { ...clean, keep: [...(clean.keep || []), ...keepOutside(spans)] } : null;
  for (const s of spans) {
    if (!s?.script?.length || !(s.t1 > s.t0)) continue;
    const r = acceptGhost(out, s.script, { range: { t0: s.t0, t1: s.t1 - 1 }, mode: 'replace', clean: c }).script;
    if (r === out || same(part(r, s.t0, s.t1), part(out, s.t0, s.t1))) continue;
    out = r; used.push(s);
  }
  return { script: out, spans: used };
}
/** First index with at > t. */
const upperBound = (s, t) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m].at <= t) lo = m + 1; else hi = m; } return lo; };
// a run's script normalised once (ghosts are already: itself), and its points per piece [t0, t1) (an edit recomputes only the
// piece whose run changed; the other pieces' slices are reused while their run script is the same array)
const normed = new WeakMap(), takes = new WeakMap();
function takeOf(script, t0, t1) {
  let g = normed.get(script);
  if (!g) normed.set(script, (g = isValid(script) ? script : normalize(script)));
  let m = takes.get(g);
  if (!m) takes.set(g, (m = new Map()));
  const k = t0 + '|' + t1;
  let v = m.get(k);
  if (!v) m.set(k, (v = slice(g, t0, t1 - 1)));
  return v;
}
/** cleanJoins(s, joins, opts) worked out only near the joins: cleanMicro drops a point inside a join window looking at two
 *  neighbours each side, so each cluster of windows (with 3 points either side that it can never drop) is cleaned on its
 *  own slice, as the whole would be. -> s itself when nothing goes. */
function cleanAround(s, joins, opts) {
  const w = opts.blendMs ?? MICRO.blendMs, M = 3;
  const wins = joins.map((j) => (Array.isArray(j) ? [j[0] - w, j[1] + w] : [j - w, j + w])).sort((a, b) => a[0] - b[0]);
  const cl = [];   // [lo, hi, wins]
  for (const W of wins) {
    const lo = Math.max(0, lowerBound(s, W[0]) - M), hi = Math.min(s.length, upperBound(s, W[1]) + M), c = cl[cl.length - 1];
    if (c && lo <= c[1]) { c[1] = Math.max(c[1], hi); c[2].push(W); } else cl.push([lo, hi, [W]]);
  }
  let out = null, from = 0;
  for (const [lo, hi, ws] of cl) {
    const part0 = s.slice(lo, hi), r = cleanMicro(part0, { ...opts, spans: ws });
    if (r === part0) continue;
    out ??= [];
    for (let k = from; k < lo; k++) out.push(s[k]);
    for (const p of r) out.push(p);
    from = hi;
  }
  if (!out) return s;
  for (let k = from; k < s.length; k++) out.push(s[k]);
  return out;
}

/** Region bounds of the live spans, sorted, unique. */
const boundsOf = (spans) => [...new Set(spans.flatMap((s) => [s.t0, s.t1]))].sort((a, b) => a - b);

/**
 * What app.edit writes when the caller hands `next` (computed from the composed script, or from the base: both work):
 * per region (the live spans' edges cut the time line) next's points if the edit changed that region of the composed
 * script, else the base's (untouched live stays live; untouched baked points stay exactly as they are).
 * live = {script, spans} | null. -> the base itself when the edit changes nothing.
 */
export function settleEdit(base0, live, next) {
  const base = base0 || EMPTY;
  if (!live?.spans?.length || next === base) return next;
  const b = boundsOf(live.spans), comp = live.script, out = [];
  let changed = false;
  for (let k = -1; k < b.length; k++) {
    const t0 = k < 0 ? -Infinity : b[k], t1 = k + 1 < b.length ? b[k + 1] : Infinity;
    const n = part(next, t0, t1), c = part(comp, t0, t1), o = part(base, t0, t1);
    const take = same(n, c) ? o : n;
    if (!same(take, o)) changed = true;
    for (const p of take) out.push(p);
  }
  return changed || !base0 ? out : base;
}

/** The live spans an edit changed (next differs from the composed script inside them): the shots it bakes. */
export const touchedLive = (live, next) => (live?.spans || []).filter((s) => !same(part(next, s.t0, s.t1), part(live.script, s.t0, s.t1)));

/** base with the composed points of the given live spans copied in (each over [t0, t1)): Bake. -> base when nothing changes. */
export function bakeSpans(base, live, spans) {
  base = base || EMPTY;
  if (!live || !spans?.length) return base;
  let out = base;
  for (const s of [...spans].sort((a, b) => a.t0 - b.t0)) {
    const pts = part(live.script, s.t0, s.t1);
    if (!pts.length || hasIn(out, s.t0, s.t1)) continue;
    const k = lowerBound(out, s.t0);
    out = [...out.slice(0, k), ...pts, ...out.slice(k)];
  }
  return out;
}

/** base without its points in each [t0, t1): Unbake. -> base when nothing changes. */
export function unbakeRanges(base, ranges) {
  base = base || EMPTY;
  const r = (ranges || []).filter((x) => x.t1 > x.t0);
  if (!r.some((x) => hasIn(base, x.t0, x.t1))) return base;
  return base.filter((p) => !r.some((x) => p.at >= x.t0 && p.at < x.t1));
}
