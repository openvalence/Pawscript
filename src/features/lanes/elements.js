// elements.js -- the lane editor's selection modes (paw-5zpf, Blender's vertex / edge / face select): 1 Point, 2 Segment (the
// line between two neighbouring points), 3 Stroke (a maximal run in one direction), 4 Cycle (low, high, low). Pure
// (test/lanes-elements.test.mjs). The selection stays a Set of point times, so every operation keeps working: an element is
// selected when all its points are. An element is [i0, i1]: inclusive indices of a contiguous run of points.
//   Stroke: consecutive segments with the same sign of change. A hold (two equal neighbours) is in no stroke: it ends the one
//   before it, and a stroke needs a change (a single point or a flat script has none).
//   Cycle: an up stroke and the down stroke right after it (a hold at the top between them belongs to the cycle). A down
//   stroke with no up stroke before it (the script starts high) is in no cycle.
//   Passage (Alt+click): a run of strokes that a pause does not break. A pause is a hold longer than the local median stroke
//   (half the local period), or a stroke lasting more than 3x the local median (a slow drift between two sections). The local
//   median is over the 7 strokes around.
import { lowerBound } from '../../lib/core/script.js';
import { msToX, xToMs } from '../../lib/lane.js';
import { posToY, segDist2, span } from './geom.js';

export const MODES = ['point', 'segment', 'stroke', 'cycle'];
export const MODE_LABEL = { point: 'Point', segment: 'Segment', stroke: 'Stroke', cycle: 'Cycle' };
export const modeOf = (v) => (MODES.includes(v) ? v : 'point');

const cache = new WeakMap();
/** The elements of a script in a mode, sorted, as [[i0, i1]] (cached per script identity). */
export function elements(script, mode) {
  let c = cache.get(script);
  if (!c) cache.set(script, (c = {}));
  return (c[mode] ||= build(script, modeOf(mode)));
}
function build(s, mode) {
  if (mode === 'point') return s.map((_, i) => [i, i]);
  if (mode === 'segment') return s.slice(1).map((_, i) => [i, i + 1]);
  if (mode === 'stroke') return runs(s);
  const S = strokesOf(s), out = [];
  for (let k = 0; k + 1 < S.length; k++) if (dirOf(s, S[k]) > 0 && dirOf(s, S[k + 1]) < 0) out.push([S[k][0], S[k + 1][1]]);
  return out;
}
/** Maximal monotone runs [[i0, i1]]; holds belong to none. */
export const strokesOf = (s) => elements(s, 'stroke');
function runs(s) {
  const out = [];
  let a = -1, dir = 0;
  for (let i = 0; i + 1 < s.length; i++) {
    const d = Math.sign(s[i + 1].pos - s[i].pos);
    if (d !== dir) { if (dir) out.push([a, i]); a = i; dir = d; }
  }
  if (dir) out.push([a, s.length - 1]);
  return out;
}
export const dirOf = (s, el) => Math.sign(s[el[1]].pos - s[el[0]].pos);
export const atsOf = (s, el) => { const out = []; for (let i = el[0]; i <= el[1]; i++) out.push(s[i].at); return out; };
export const isSelected = (sel, s, el) => { for (let i = el[0]; i <= el[1]; i++) if (!sel.has(s[i].at)) return false; return true; };

/** Index of the element holding segment j (points j-1, j: geom.js hitSegment), or -1. Elements of modes 2-4 never share a segment. */
export function elementOfSegment(els, j) {
  let lo = 0, hi = els.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (els[m][0] <= j - 1) lo = m + 1; else hi = m; }
  const k = lo - 1;
  return k >= 0 && els[k][1] >= j ? k : -1;
}
/** Index of the element holding point i (the first one when it is a shared end), or -1. */
export function elementOfPoint(els, i) {
  let lo = 0, hi = els.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (els[m][1] < i) lo = m + 1; else hi = m; }
  return lo < els.length && els[lo][0] <= i ? lo : -1;
}

/**
 * The element under (x, y) px in modes 2-4: the nearest segment within r px (a segment whose time span holds x wins a tie, so a
 * point shared by two elements goes to the side the pointer is on), then its element. -1 when nothing is near, or when more than
 * maxCand segments lie within reach (too dense to pick one: box select instead).
 */
export function hitElement(script, els, view, w, h, x, y, r = 6, maxCand = 48) {
  if (script.length < 2) return -1;
  const [a, b] = span(script, xToMs(view, w, x - r), xToMs(view, w, x + r));
  const j0 = Math.max(1, a), j1 = Math.min(script.length - 1, b);
  if (j1 - j0 > maxCand) return -1;
  let best = -1, bd = r * r + 1e-6;
  for (let j = j0; j <= j1; j++) {
    const ax = msToX(view, w, script[j - 1].at), bx = msToX(view, w, script[j].at);
    const d = segDist2(x, y, ax, posToY(h, script[j - 1].pos), bx, posToY(h, script[j].pos)) + (x >= ax && x <= bx ? 0 : 1e-3);
    if (d <= bd) { bd = d; best = j; }
  }
  return best < 0 ? -1 : elementOfSegment(els, best);
}

/** The element's centre: mid time, the line's level there ({t, pos}). Box / circle select take an element whose centre is inside
 *  (Blender's face centres): a brush never has to cover a whole stroke. */
export function centreOf(s, el) {
  const t = (s[el[0]].at + s[el[1]].at) / 2;
  let i = el[0];
  while (i < el[1] && s[i + 1].at <= t) i++;
  if (i >= el[1]) return { t, pos: s[el[1]].pos };
  const p = s[i], q = s[i + 1], u = q.at > p.at ? (t - p.at) / (q.at - p.at) : 0;
  return { t, pos: p.pos + (q.pos - p.pos) * u };
}
/** Indices of the elements whose centre passes test(x, y) (px), among those overlapping times [t0, t1]. */
export function elementsWhere(s, els, view, w, h, t0, t1, test) {
  const out = [];
  let lo = 0, hi = els.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (s[els[m][1]].at < t0) lo = m + 1; else hi = m; }
  for (let k = lo; k < els.length && s[els[k][0]].at <= t1; k++) {
    const c = centreOf(s, els[k]);
    if (test(msToX(view, w, c.t), posToY(h, c.pos))) out.push(k);
  }
  return out;
}

/** Indices of the elements fully selected. */
export const selectedElements = (s, els, sel) => els.reduce((o, el, k) => (isSelected(sel, s, el) ? (o.push(k), o) : o), []);
/** sel plus the points of elements ks. */
export function addElements(sel, s, els, ks) { const out = new Set(sel); for (const k of ks) for (const t of atsOf(s, els[k])) out.add(t); return out; }
/** sel less elements ks: their points go, except the ends they share with another selected element (it stays selected). */
export function removeElements(sel, s, els, ks) {
  const drop = new Set(ks), keep = new Set(), out = new Set(sel);
  for (const k of selectedElements(s, els, sel)) if (!drop.has(k)) for (const t of atsOf(s, els[k])) keep.add(t);
  for (const k of ks) for (const t of atsOf(s, els[k])) if (!keep.has(t)) out.delete(t);
  return out;
}
/** Combine a hit set of elements with the selection: 'add', 'sub', anything else replaces. */
export const combineElements = (sel, s, els, ks, how) => (how === 'add' ? addElements(sel, s, els, ks) : how === 'sub' ? removeElements(sel, s, els, ks) : addElements(new Set(), s, els, ks));

/** Mode change: up (toward Cycle) keeps only complete elements; down keeps every point. */
export function convertSelection(s, sel, from, to) {
  if (MODES.indexOf(modeOf(to)) <= MODES.indexOf(modeOf(from))) return sel;
  const els = elements(s, to);
  return addElements(new Set(), s, els, selectedElements(s, els, sel));
}

// ---- passages, loops, paths ----
const median = (a) => { const b = [...a].sort((x, y) => x - y), n = b.length; return n ? (n % 2 ? b[(n - 1) >> 1] : (b[n / 2 - 1] + b[n / 2]) / 2) : 0; };
/** The passages as stroke index ranges [[k0, k1]] (into strokesOf(s)). */
export function passages(s) {
  const S = strokesOf(s), n = S.length;
  if (!n) return [];
  const d = S.map((el) => s[el[1]].at - s[el[0]].at);
  const med = d.map((_, k) => median(d.slice(Math.max(0, k - 3), k + 4)));
  const gap = (k) => d[k] > 3 * med[k];
  const out = [];
  let k0 = 0;
  for (let k = 0; k + 1 < n; k++) {
    const hold = s[S[k + 1][0]].at - s[S[k][1]].at;
    if (gap(k) || gap(k + 1) || hold > Math.max(med[k], med[k + 1])) { out.push([k0, k]); k0 = k + 1; }
  }
  out.push([k0, n - 1]);
  return out;
}
const passageOfStroke = (s, k) => passages(s).find((p) => p[0] <= k && k <= p[1]) || null;

/**
 * Alt+click (Blender's loop select). mode point: i = the clicked point; on a peak every peak of its passage, on a trough every
 * trough (a held extreme: both ends of the hold); any other point -> null. Segment / Stroke: el = the clicked element; every
 * stroke of its direction in the passage (a hold -> null). Cycle: every cycle of the passage. -> the points (ats) or null.
 */
export function loopOf(s, mode, { i = -1, el = null } = {}) {
  const S = strokesOf(s);
  if (!S.length) return null;
  const kOf = (pred) => S.findIndex(pred);
  if (modeOf(mode) === 'point') {
    const top = S.some((st) => (dirOf(s, st) > 0 ? st[1] : st[0]) === i), bot = S.some((st) => (dirOf(s, st) < 0 ? st[1] : st[0]) === i);
    if (!top && !bot) return null;
    const p = passageOfStroke(s, kOf((st) => st[0] === i || st[1] === i));
    const want = top ? 1 : -1, out = new Set();
    for (let k = p[0]; k <= p[1]; k++) { const st = S[k], dz = dirOf(s, st); out.add(s[dz === want ? st[1] : st[0]].at); }
    return [...out].sort((a, b) => a - b);
  }
  if (!el) return null;
  const k = kOf((st) => st[0] <= el[0] && el[1] <= st[1] || (st[0] >= el[0] && st[1] <= el[1]));
  if (k < 0) return null;
  const p = passageOfStroke(s, k), out = new Set();
  if (modeOf(mode) === 'cycle') {
    const kAt = new Map(S.map((st, q) => [st[0], q]));
    for (const c of elements(s, 'cycle')) {
      const kc = kAt.get(c[0]);
      if (kc >= p[0] && kc + 1 <= p[1]) for (const t of atsOf(s, c)) out.add(t);
    }
  } else {
    const want = dirOf(s, S[k]);
    for (let q = p[0]; q <= p[1]; q++) if (dirOf(s, S[q]) === want) for (const t of atsOf(s, S[q])) out.add(t);
  }
  return [...out].sort((a, b) => a - b);
}

/** Ctrl+click (Blender's pick shortest path): every element from element a to element b (indices into els), inclusive. */
export function pathOf(s, els, a, b) {
  const out = [];
  for (let k = Math.min(a, b); k <= Math.max(a, b); k++) out.push(...atsOf(s, els[k]));
  return [...new Set(out)];
}

// ---- the active element (Blender's lighter highlight): stored on the selection as the element's point times ----
/** The active element's [i0, i1] in s, or null (it is cleared once any of its points is no longer selected). */
export function activeIdx(s, sel) {
  const a = sel?.active;
  if (!a?.length || !a.every((t) => sel.ats.has(t))) return null;
  const i0 = lowerBound(s, a[0]), i1 = lowerBound(s, a[a.length - 1]);
  return i0 < s.length && i1 < s.length && s[i0].at === a[0] && s[i1].at === a[a.length - 1] ? [i0, i1] : null;
}
/** After an edit that maps the selection one to one in time order (a move, scale, rotate, nudge), the active element's new
 *  point times; else undefined. prev = the selection before, ats = the selected times after. */
export function carryActive(prev, ats) {
  const a = prev?.active;
  if (!a?.length) return undefined;
  const old = [...prev.ats].sort((x, y) => x - y), now = [...ats].sort((x, y) => x - y);
  if (old.length !== now.length) return a.every((t) => now.includes(t)) ? a : undefined;
  const out = a.map((t) => now[old.indexOf(t)]);
  return out.every((t) => t != null) ? out : undefined;
}

/** Islands: maximal runs of consecutive selected indices (Blender's connected parts, for Individual origins). idx sorted. */
export function islands(idx) {
  const out = [];
  for (const i of idx) { const l = out[out.length - 1]; if (l && l[l.length - 1] === i - 1) l.push(i); else out.push([i]); }
  return out;
}
