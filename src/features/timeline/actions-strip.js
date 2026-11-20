// actions-strip.js -- paw-2lp7.5 (regions stage 2): the Actions strip, the top strip of the Scenes and shots row, pure
// (test/actions-strip.test.mjs): its layout, what a press hits, where an edge snaps, and the keyboard path's edits.
// Owner: "regions are named on action, with one action per strip, add another on top for a secondary action ... essentially
// it's layers". Top to bottom: the secondary layers (n, n-1 ... 1: thin bands, the row grows LAYER_H px for each one that has a
// region in view), the main line (layer 0: the primary driver, full blocks), then the positioning lane (POS_H px, hatched, right
// over the shots: "a re-position range indicates that it happens within a shot"; a lane of its own, so it can lie over an action
// without taking the action's slot), then the Shots strip [y1, H).
import { frameStartOf } from '../../lib/lane.js';
import { actKind } from './acts.js';
import { addRegion, resizeRegion, KINDS } from './regions.js';

export const LAYER_H = 13, POS_H = 10, EDGE_PX = 5, MIX_W = 34;   // POS_H 10 (was 6): a positioning card holds its words (paw-2lp7.1)
/** The highest secondary layer with a region (not a positioning range) over [t0, t1): the bands the strip draws. */
export const layersIn = (acts, t0, t1) => (acts || []).reduce((n, r) => (r.kind !== 'positioning' && r.t1 > t0 && r.t0 < t1 ? Math.max(n, r.layer) : n), 0);
/** The bands the strip shows over [t0, t1): the used ones plus one empty band above any region in view, so there is always
 *  somewhere to drag a secondary action out (owner: "nowhere for me to drag a secondary action ... a small gap like positioning"). */
export const bandsIn = (acts, t0, t1) => ((acts || []).some((r) => r.kind !== 'positioning' && r.t1 > t0 && r.t0 < t1) ? layersIn(acts, t0, t1) + 1 : 0);
/** The px the row grows for n secondary bands. */
export const extraFor = (n) => Math.max(0, n) * LAYER_H;

/**
 * The strip in a row H px tall showing n secondary bands: {sh (the Actions strip's height: the Shots strip is [y1 = sh + 1,
 * H)), pos {y0, y1} (the positioning lane), main {y0, y1}, layers [{y0, y1}] (index k - 1 = layer k), lh, n}. The bands keep
 * LAYER_H px while the row has room for them (it grew by extraFor(n)), else share what there is (7 px at least).
 */
export function stripLayout(H, n = 0) {
  const l0 = !n ? 0 : H - n * LAYER_H >= 40 ? LAYER_H : Math.max(7, Math.floor((H - 40) / n));
  const sh = Math.max(20, Math.round((H - n * l0) * 0.58)) + n * l0, pos = { y0: sh - POS_H, y1: sh };
  // in a tall row a band is a third of the main line, not a sliver (owner: "the ratio of these is a little insane perhaps 1/4 or 1/3")
  const lh = !n ? 0 : Math.max(l0, Math.floor((pos.y0 - 2) / (n + 3)));
  const main = { y0: 1 + n * lh, y1: pos.y0 - 1 };
  const layers = Array.from({ length: n }, (_, k) => ({ y0: 1 + (n - 1 - k) * lh, y1: 1 + (n - k) * lh - 1 }));
  return { sh, y1: sh + 1, pos, main, layers, lh, n };
}
/** Region r's lane box in layout L: {y0, y1} | null (a layer the strip does not draw). */
export const laneOf = (L, r) => (r.kind === 'positioning' ? L.pos : r.layer === 0 ? L.main : L.layers[r.layer - 1] ?? null);
/** The regions as drawn: [{r, x0, x1, y0, y1}] (x(ms) -> px), secondary bands over the main line, positioning last; only
 *  those on screen (w px). */
export function regionRects(acts, x, L, w = Infinity) {
  const out = [];
  for (const r of acts || []) {
    const b = laneOf(L, r), x0 = x(r.t0), x1 = x(r.t1);
    if (b && x1 >= -2 && x0 <= w + 2) out.push({ r, x0, x1, y0: b.y0, y1: b.y1 });
  }
  return out;
}
/** The lane at py: {layer, positioning} | null (the Shots strip). Above the top band (py < its top; a drag that left the
 *  canvas upward too): a new layer n + 1. */
export function laneAt(L, py) {
  if (py >= L.y1) return null;
  if (py >= L.pos.y0) return { layer: 0, positioning: true };
  if (py >= L.main.y0) return { layer: 0, positioning: false };
  for (let k = 0; k < L.layers.length; k++) if (py >= L.layers[k].y0) return { layer: k + 1, positioning: false };
  return { layer: L.n + 1, positioning: false };
}
/** A secondary band's mix chip (mix / layer / ignore), at its right end: {x0, x1, y0, y1} | null when the band is too short. */
export const mixChip = (q, w = Infinity) => (q.r.layer > 0 && q.r.kind === 'act' && Math.min(q.x1, w) - Math.max(q.x0, 0) >= MIX_W + 30
  ? { x0: Math.min(q.x1, w) - MIX_W - 2, x1: Math.min(q.x1, w) - 2, y0: q.y0 + 1, y1: q.y1 - 1 } : null);

/**
 * What a press at (px, py) is on in the Actions strip: {kind: 'actMix', r} (a band's mix chip) | {kind: 'actEdge', r, side:
 * 't0' | 't1'} (within EDGE_PX of an end, inside a third of a narrow region) | {kind: 'actBody', r} | {kind: 'actEmpty',
 * layer, positioning} (an empty stretch of a lane) | null (the Shots strip). rects: regionRects.
 */
export function actHit(rects, L, px, py, w = Infinity) {
  if (py >= L.y1) return null;
  const lane = laneAt(L, py);
  let edge = null, body = null;
  for (const q of rects) {
    if (py < q.y0 - 1 || py > q.y1 + 1) continue;
    const c = mixChip(q, w);
    if (c && px >= c.x0 && px < c.x1) return { kind: 'actMix', r: q.r };
    const e = Math.min(EDGE_PX, (q.x1 - q.x0) / 3), d0 = Math.abs(px - q.x0), d1 = Math.abs(px - q.x1);
    if (d0 <= EDGE_PX && px <= q.x0 + e && (!edge || d0 < edge.d)) edge = { kind: 'actEdge', r: q.r, side: 't0', d: d0 };
    if (d1 <= EDGE_PX && px >= q.x1 - e && (!edge || d1 < edge.d)) edge = { kind: 'actEdge', r: q.r, side: 't1', d: d1 };
    if (px >= q.x0 && px < q.x1) body = { kind: 'actBody', r: q.r };
  }
  if (edge) return { kind: edge.kind, r: edge.r, side: edge.side };
  return body ?? (lane ? { kind: 'actEmpty', ...lane } : null);
}

/** Snap targets for a region drag: other regions' edges (labelled 'action') before `more` ([{t, label}]: cuts, the playhead ...). */
export const regionTargets = (acts, exceptId, more = []) => [...(acts || []).filter((r) => r.id !== exceptId).flatMap((r) => [{ t: r.t0, label: 'action' }, { t: r.t1, label: 'action' }]), ...more];
/** t snapped: to the nearest target within tol ms unless `free` (Shift), else (or then) onto the start of its frame on the
 *  grid (a frame table on a VFR / offset file: lib/lane.js frameStartOf). -> {t, hit (the target) | null} */
export function snapAt(t, targets, tol, grid, free = false) {
  let best = null;
  if (!free) for (const q of targets || []) if (Math.abs(q.t - t) <= tol && (!best || Math.abs(q.t - t) < Math.abs(best.t - t))) best = q;
  return best ? { t: Math.round(best.t), hit: best } : { t: frameStartOf(t, grid), hit: null };
}

// ---- reading ----
/** The kinds.js id a region is coloured with: an action by its act's family; a no-action kind is drawn grey (null). */
export const regionKind = (r) => (r?.kind === 'act' ? actKind({ tags: r.tags }) : null);
/** Per shot, the main-line region holding its middle (accepted, not positioning), else null: its tint. */
export const coverOf = (shots, acts) => {
  const base = (acts || []).filter((r) => r.layer === 0 && r.kind !== 'positioning' && !r.auto);
  return (shots || []).map((s) => { const m = (s.start_ms + s.end_ms) / 2; return base.find((r) => r.t0 <= m && m < r.t1) ?? null; });
};
/**
 * The main-line edges that fall inside a shot (stage 1's rule: a shot's whole-shot facts follow the region at its middle, so
 * the action that changes inside it is tracked as one shot): [{i (the shot), t (the edge), r (the region that starts or ends
 * there)}], one per shot and time.
 */
export function midShotEdges(shots, acts) {
  const out = [], seen = new Set();
  for (const r of acts || []) {
    if (r.layer !== 0 || r.kind === 'positioning' || r.auto) continue;
    for (const t of [r.t0, r.t1]) {
      const i = (shots || []).findIndex((s) => t > s.start_ms + 0.5 && t < s.end_ms - 0.5);
      if (i >= 0 && !seen.has(`${i}:${t}`)) { seen.add(`${i}:${t}`); out.push({ i, t, r }); }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** paw-qoo5: is r an action (not positioning, not a proposal) over part of one shot only? In the Track tab a click on one
 *  selects it (T then tracks just it); a click on any other region selects the shot under it there (paw-iphl). */
export const partOfShot = (r, shots) => r?.kind === 'act' && !r.auto
  && (shots || []).some((s) => r.t0 >= s.start_ms - 0.5 && r.t1 <= s.end_ms + 0.5 && (r.t0 > s.start_ms + 0.5 || r.t1 < s.end_ms - 0.5));

// ---- the keyboard path ----
const keyOf = (tags) => JSON.stringify([...(tags || [])].sort());
/** The recent actions (the 1-9 keys): tags put first, the same action once, at most 9. Empty tags: unchanged. */
export const pushMru = (mru, tags) => (!tags?.length ? mru || [] : [tags, ...(mru || []).filter((t) => keyOf(t) !== keyOf(tags))].slice(0, 9));
/** One main-line region with `tags` over each unbroken run of the shots idx (sorted indices). -> acts | null */
export function regionOverShots(acts, shots, idx, tags = [], kind = 'act') {
  const runs = [];
  for (const k of idx || []) { if (!shots[k]) continue; const p = runs.at(-1); if (p && p[1] === k - 1) p[1] = k; else runs.push([k, k]); }
  if (!runs.length || !KINDS.includes(kind)) return null;
  let out = acts || [];
  for (const [a, b] of runs) out = addRegion(out, { kind, t0: shots[a].start_ms, t1: shots[b].end_ms, layer: 0, tags: kind === 'act' ? tags : [] }) ?? out;
  return out;
}
/** Region id's start (side 't0') or end ('t1') at t (the playhead's frame start; [ / ]). -> acts | null */
export const edgeTo = (acts, id, side, t) => { const r = (acts || []).find((x) => x.id === id); return r ? resizeRegion(acts, id, side === 't0' ? t : r.t0, side === 't1' ? t : r.t1) : null; };
/**
 * The extend key: region r (the selected one, else the main-line one at the playhead t) on to the end of the shot under the
 * playhead when it ends before that; else through the next cut after its end (to the end of that shot). -> acts | null
 */
export function extendRegion(acts, shots, r, t) {
  if (!r || !shots?.length) return null;
  const here = shots.find((s) => t >= s.start_ms && t < s.end_ms);
  const to = here && r.t1 < here.end_ms - 0.5 ? here.end_ms : shots.find((s) => s.end_ms > r.t1 + 0.5)?.end_ms;
  return to != null ? resizeRegion(acts, r.id, r.t0, to) : null;
}
