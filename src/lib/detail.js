// detail.js -- where a half-stroke's Detail setting comes from, and Simplify to it (paw-izk). Pure (test/detail.test.mjs).
// Owner: "the detail I think should be a default setting across an entire scene, then adjustable per cut or area".
// The scene fact `detail` (timeline/shots.js ACT_KEYS: on every shot of the scene, saved once on the scene):
//   {shape?, sens?, spans?: [{t0, t1, shape, sens}]}   (lib/stroke-shape.js shapes; absent = SHAPE: By render, 50 since paw-na9u)
// shape / sens = the scene default; spans = overrides with absolute times (like modifier spans, timeline/mods.js): one
// with exactly a shot's times is that shot's override ("per cut"), any other an area override. Clipped to the scene when
// read; a moved cut keeps them where they were (a shot override then reads as an area); a merge keeps every scene's
// spans and turns the later scenes' own defaults into spans over their old extent (shots.js normScenes), a split gives
// each half its part. Setting an override over a span replaces whatever overrides were under it.
// Projects from before: a shot whose Strokes settings had a Detail tolerance keeps it as its shot override (Free at that
// tolerance; 0 = Turns only), migrateDetail on load; shots without follow the scene.
import { sceneRuns, sceneRange } from '../features/timeline/shots.js';
import { SHAPE, shapeClean, shapeFit } from './stroke-shape.js';
import { turns } from './edit/strokes.js';

const fin = Number.isFinite;
const same = (a, b) => a.shape === b.shape && a.sens === b.sens;
/** A stored `detail` cleaned: {shape?, sens?, spans?} or undefined (nothing differs from the defaults). */
export function detailClean(d) {
  if (!d || typeof d !== 'object') return undefined;
  const out = {};
  if (d.shape !== undefined || d.sens !== undefined) { const b = shapeClean(d); if (!same(b, SHAPE)) Object.assign(out, b); }
  const spans = (Array.isArray(d.spans) ? d.spans : []).filter((s) => fin(s?.t0) && fin(s?.t1) && s.t1 > s.t0)
    .map((s) => ({ t0: Math.round(s.t0), t1: Math.round(s.t1), ...shapeClean(s) })).sort((a, b) => a.t0 - b.t0);
  if (spans.length) out.spans = spans;
  return Object.keys(out).length ? out : undefined;
}
/** Scene of shot i: {lo, hi, t0, t1, shape, sens, spans (clipped to the scene)} or null. */
export function sceneDetail(list, i) {
  const r = sceneRange(list, i);
  if (!r) return null;
  const t0 = list[r[0]].start_ms, t1 = list[r[1]].end_ms, d = detailClean(list[r[0]].detail) || {};
  const spans = (d.spans || []).map((s) => ({ ...s, t0: Math.max(t0, s.t0), t1: Math.min(t1, s.t1) })).filter((s) => s.t1 > s.t0);
  return { lo: r[0], hi: r[1], t0, t1, ...shapeClean(d.shape ? d : SHAPE), spans };
}
/** A span is a shot override when it has exactly one shot's times. -> that shot's index or -1. */
export const spanShot = (list, s) => list.findIndex((x) => x.start_ms === s.t0 && x.end_ms === s.t1);
/** The settings over [t0, t1) for strokes.js `shapes` (later entries win): each scene's default over its part, then the
 *  overrides. */
export function detailSpans(list = [], t0 = -Infinity, t1 = Infinity) {
  const base = [], ov = [];
  for (const [lo, hi] of sceneRuns(list)) {
    const a = list[lo].start_ms, b = list[hi].end_ms;
    if (b <= t0 || a >= t1) continue;
    const d = sceneDetail(list, lo);
    base.push({ t0: Math.max(a, t0), t1: Math.min(b, t1), shape: d.shape, sens: d.sens });
    for (const s of d.spans) if (s.t1 > t0 && s.t0 < t1) ov.push({ t0: Math.max(s.t0, t0), t1: Math.min(s.t1, t1), shape: s.shape, sens: s.sens });
  }
  return [...base, ...ov];
}
/** What governs time t: {shape, sens, level: 'scene' | 'shot' | 'area', t0, t1 (the span or the scene), lo, hi} or null. */
export function detailAt(list, t) {
  const i = list.findIndex((s) => t >= s.start_ms && t < s.end_ms), d = i >= 0 ? sceneDetail(list, i) : null;
  if (!d) return null;
  const s = d.spans.findLast((x) => t >= x.t0 && t < x.t1);
  return s ? { shape: s.shape, sens: s.sens, level: spanShot(list, s) >= 0 ? 'shot' : 'area', t0: s.t0, t1: s.t1, lo: d.lo, hi: d.hi }
    : { shape: d.shape, sens: d.sens, level: 'scene', t0: d.t0, t1: d.t1, lo: d.lo, hi: d.hi };
}
/** spans with [t0, t1) taken out (trimmed / split). */
const cut = (spans, t0, t1) => spans.flatMap((s) => (s.t1 <= t0 || s.t0 >= t1 ? [s] : [...(s.t0 < t0 ? [{ ...s, t1: t0 }] : []), ...(s.t1 > t1 ? [{ ...s, t0: t1 }] : [])]));
/**
 * Set the Detail of the scene of shot i. span null: the scene default (setting null = back to the defaults); span {t0,
 * t1}: an override there, clipped to the scene (setting null = the overrides under it removed: back to the scene
 * default). -> a new list (the fact on every shot of the scene), or the same list when nothing changes.
 */
export function setDetail(list, i, setting, span = null) {
  const r = sceneRange(list, i);
  if (!r) return list;
  const S0 = list[r[0]].start_ms, S1 = list[r[1]].end_ms, cur = detailClean(list[r[0]].detail), d = cur || {};
  let next;
  if (!span) next = { ...(setting ? shapeClean(setting) : {}), spans: d.spans };
  else {
    const a = Math.max(S0, Math.round(span.t0)), b = Math.min(S1, Math.round(span.t1));
    if (!(b > a)) return list;
    const spans = cut(d.spans || [], a, b);
    if (setting) spans.push({ t0: a, t1: b, ...shapeClean(setting) });
    next = { ...(d.shape ? { shape: d.shape, sens: d.sens } : {}), spans };
  }
  next = detailClean(next);
  if (JSON.stringify(next) === JSON.stringify(cur)) return list;
  return list.map((s, k) => { if (k < r[0] || k > r[1]) return s; const { detail: _, ...rest } = s; return next ? { ...rest, detail: next } : rest; });   // eslint-disable-line no-unused-vars
}
/** The sensitivity whose Free tolerance is tol (pos). */
export const sensOfTol = (tol) => Math.round(Math.min(100, Math.max(0, 100 * (1 - (tol - 1) / 29))));
/** Load-time: a shot's old Strokes Detail tolerance (derive.strokes.detail) becomes its shot override. */
export function migrateDetail(list) {
  if (!Array.isArray(list)) return list;
  let out = list;
  list.forEach((s, k) => {
    const st = s?.derive?.strokes;
    if (!st || typeof st !== 'object' || !('detail' in st)) return;
    const tol = +st.detail, setting = tol > 0 ? { shape: 'free', sens: sensOfTol(tol) } : { shape: 'turns', sens: SHAPE.sens };
    out = setDetail(out, k, setting, { t0: s.start_ms, t1: s.end_ms });
    const { detail: _, ...rest } = st;   // eslint-disable-line no-unused-vars
    out = out.map((x, j) => (j === k ? { ...x, derive: { ...x.derive, strokes: rest } } : x));
  });
  return out;
}

/**
 * Simplify to this detail: the points of `script` inside [t0, t1] re-fitted to the stroke-shape model. Turns = the
 * zig-zag turns (lib/edit/strokes.js) of at least minProm pos (default: 10 % of the span's p5..p95, at least 4), kept
 * exactly (time and depth); between them at most one midpoint per half-stroke and one hold per turn, chosen among the
 * existing points by the setting at their time (at: lib/stroke-shape.js shapeAt). The span's first and last points
 * stay. -> a new script (the same array when there is nothing to do).
 */
export function simplifyScript(script, t0, t1, at, { minProm = null, minIntervalMs = 60, maxSpeed = 0 } = {}) {
  let ia = script.findIndex((p) => p.at >= t0), ib = script.findLastIndex((p) => p.at <= t1);
  if (ia < 0 || ib - ia < 2) return script;
  const seg = script.slice(ia, ib + 1), pos = seg.map((p) => p.pos), sorted = [...pos].sort((a, b) => a - b);
  const P = minProm ?? Math.max(4, 0.1 * (sorted[Math.floor(0.95 * (sorted.length - 1))] - sorted[Math.floor(0.05 * (sorted.length - 1))]));
  const T = turns(seg, P);
  const anchors = [...new Set([0, ...T.map((x) => x.i), seg.length - 1])].sort((a, b) => a - b);
  const fit = shapeFit(seg.map((p) => p.at), pos, anchors, new Set(anchors), at, { minIntervalMs, maxSpeed, quant: false });
  const pts = [];
  for (const q of fit) if (!pts.length || seg[q.i].at > pts[pts.length - 1].at) pts.push({ at: seg[q.i].at, pos: q.why === 'mid' ? seg[q.i].pos : Math.round(q.pos) });   // a kept midpoint keeps its own level
  return pts.length === seg.length && pts.every((p, k) => p.pos === seg[k].pos) ? script : [...script.slice(0, ia), ...pts, ...script.slice(ib + 1)];
}
