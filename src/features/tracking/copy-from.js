// copy-from.js -- "Copy from…" in the Groups tool (paw-lgtx), pure. A frame of the shot on screen takes the groups of a frame
// of THIS video that looks like it: (a) another take's painted groups, (b) "from tracking": a finished run covering the frame
// on screen, its pinned points rebuilt as groups there (no lining up), (c) runs' tracked frames elsewhere, the same rebuild
// (inside a painted take: its painted groups carried along by the run's points, `carried`).
// paw-55la, the two-way search: every frame of the I-O range in this take, else of the shot on screen, is printed as well
// (paw-vnlj; COARSE frames, then every frame around the best pairs) and every PAIR (frame of the range, source frame) is
// compared: each tile is a source at the frame it matches best (bestPairs: one per source take, near-ties go to the frame
// nearest the playhead); (b) first at the frame on screen.
// Likeness: a 32 x 32 grey print of each frame (the 16 x 16 print of scenes-continue.js, twice as fine), compared as it is
// (printDist: what ranks). The move that lines the groups up is ONE scale + shift + turn for the whole set, searched over
// the pixels the groups cover (alignRegion; alignPrints only when the full prints are missing).
// Measured: experiments/copy-from/score.mjs, pairs.mjs.
// Copies are the existing copy kind (groups.js isCopy: source 'repeat' painted, 'run' rebuilt from points) with `from`
// and `lined` ('moved' | 'refound'): never training labels until the owner edits the take. landCopies: where they go in
// the take (never a part on two frames).
// Exact repeats (repeat-groups.js findFill) are the special case d = 0, s = 1: they rank first here too.
import { isSuggested, isUnassigned, isIgnore, isCopy, transformMask, fitPoly, encodeMask, maskOf, knotOf, withKnot, erasedOf, withErased } from './groups.js';
import { takeRange } from '../timeline/shots.js';
import { sceneIndexAt } from '../timeline/scenes.js';
import { runSeeds, seedGroups } from './repeat-groups.js';
import { printDist } from '../../lib/scenes-continue.js';
import { frameAt, timeInFrame } from '../../lib/lane.js';
import { matchFrames, refine, scoreAt, CROP_MATCH, SAME_SCALE } from '../../lib/crop-match.js';

export const FP = 32;          // print side (px)
export const THUMB_W = 160;    // thumbnail width (px); the print is taken from it
export const MAX = 6;          // candidates shown

/** RGBA bytes of an n x n picture -> Float32Array(n * n) of luma 0..1 (scenes-continue.js grey16, any n). */
export function greyN(rgba, n = FP) {
  const out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = (0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2]) / 255;
  return out;
}

const bil = (a, n, fx, fy) => {
  const x = Math.min(n - 1, Math.max(0, fx)), y = Math.min(n - 1, Math.max(0, fy)), x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1), u = x - x0, v = y - y0;
  return (a[y0 * n + x0] * (1 - u) + a[y0 * n + x1] * u) * (1 - v) + (a[y1 * n + x0] * (1 - u) + a[y1 * n + x1] * u) * v;
};
/** Mean |dst - src moved by (s, dx, dy)| over the dst pixels the moved src covers (>= half of them, else Infinity).
 *  The move: a frame point p of src lands at (p - 0.5) * s + 0.5 + d (0..1 coords; s about the centre). */
export function printCost(src, dst, s, dx, dy, n = FP) {
  let sum = 0, cnt = 0;
  for (let j = 0; j < n; j++) {
    const sy = ((j + 0.5) / n - 0.5 - dy) / s + 0.5;
    if (sy < 0 || sy > 1) continue;
    for (let i = 0; i < n; i++) {
      const sx = ((i + 0.5) / n - 0.5 - dx) / s + 0.5;
      if (sx < 0 || sx > 1) continue;
      sum += Math.abs(dst[j * n + i] - bil(src, n, sx * n - 0.5, sy * n - 0.5)); cnt++;
    }
  }
  return cnt >= (n * n) / 2 ? sum / cnt : Infinity;
}
// ponytail: an exhaustive coarse grid + two refinements, a fixed small penalty for moving; a pyramid / phase correlation if prints grow
const SCALES = [0.8, 0.894, 1, 1.118, 1.25], SHIFTS = [-0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2];
export const MOVE_PENALTY = 0.03;   // per unit of |dx| + |dy| + |ln s|: an ambiguous picture stays put
export const MOVE_GAIN = 0.9;       // the move is used only when it leaves at most this x the unmoved residual
// ponytail: penalty and gain picked on 27 painted frames of 4 owner projects, where variants were within noise of each other
/** The move of src that fits dst best -> {d (its residual: the likeness, 0 = the same picture), s, dx, dy}. */
export function alignPrints(src, dst, n = FP, penalty = MOVE_PENALTY) {
  const pen = (s, dx, dy) => penalty * (Math.abs(dx) + Math.abs(dy) + Math.abs(Math.log(s)));
  let best = { c: Infinity, d: Infinity, s: 1, dx: 0, dy: 0 };
  const tryAt = (s, dx, dy) => { const d = printCost(src, dst, s, dx, dy, n), c = d + pen(s, dx, dy); if (c < best.c) best = { c, d, s, dx, dy }; };
  for (const s of SCALES) for (const dy of SHIFTS) for (const dx of SHIFTS) tryAt(s, dx, dy);
  for (const [k, st] of [[1.054, 0.025], [1.027, 0.0125]]) {
    const b = best;
    for (const s of [b.s / k, b.s, b.s * k]) for (const dy of [b.dy - st, b.dy, b.dy + st]) for (const dx of [b.dx - st, b.dx, b.dx + st]) tryAt(s, dx, dy);
  }
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  return { d: r4(best.d), s: r4(best.s), dx: r4(best.dx), dy: r4(best.dy) };
}
export const IDENTITY = { d: 0, s: 1, dx: 0, dy: 0 };
/** How alike frame src is to frame dst (prints) -> {d (the unmoved print distance: what ranks; lib/scenes-continue.js
 *  printDist), xf (the move that lines src's groups up on dst, IDENTITY unless it clearly fits better)}. Measured on the
 *  owner's painted frames, ranking by the unmoved distance did as well as by the moved residual and costs nothing extra. */
export function likeness(src, dst) {
  const d = printDist(src, dst), xf = alignPrints(src, dst);
  return { d: Math.round(d * 1e4) / 1e4, xf: xf.d < MOVE_GAIN * d ? xf : IDENTITY };
}

// ---- re-framed footage (paw-d2d5) ----
// A close-up that is a crop of a wider shot (lib/crop-match.js; tracking's shotLinks link nearby shots) shows the same
// parts magnified and moved: the print move above searches scale 0.8-1.25 / shift +-0.2 and on a x1.8 crop settles on a
// wrong edge of that range (the owner's case: s 0.87 and the corner shift, every part shrunk into the lower left). The
// copy goes through the crop's own geometry instead: the link's box refined on the two frames, else a crop match of the
// two frames (both ways), else the print move as before.
/** The crop link (tracking shotLinks.links: {a, b: {start_ms}, tighter, box, scale, score}) between the shot holding
 *  frame ts (the source) and the shot holding frame tt (the target): {wideIsSrc, box (the tighter frame inside the wider,
 *  0..1 of the wider), scale, score} | null. */
export function linkFor(links, scenes, ts, tt) {
  const at = (t) => Math.round(scenes?.[sceneIndexAt(scenes || [], t)]?.start_ms ?? NaN), s = at(ts), t = at(tt);
  if (!Number.isFinite(s) || !Number.isFinite(t) || s === t) return null;
  for (const L of links || []) {
    if (L.kind && L.kind !== 'crop') continue;
    const a = Math.round(L.a.start_ms), b = Math.round(L.b.start_ms);
    if (!((a === s && b === t) || (a === t && b === s))) continue;
    const wide = L.tighter === 'b' ? a : b;
    return { wideIsSrc: wide === s, box: L.box, scale: L.scale, score: L.score, ...(L.via ? { via: L.via } : {}) };   // via 'loops': found by the loop cycles (paw-0zwb)
  }
  return null;
}
/** The move (moveGroups' xf) that puts a frame point of the source on the target when the tighter frame sits at box
 *  {x, y, w} (0..1 of the wider frame; the aspect kept, so its height share is w too) inside the wider: wide -> tight
 *  magnifies 1 / w, tight -> wide shrinks by w. */
export function boxXf(box, wideIsSrc) {
  const w = box.w;
  return wideIsSrc ? { s: 1 / w, dx: 0.5 / w - 0.5 - box.x / w, dy: 0.5 / w - 0.5 - box.y / w } : { s: w, dx: box.x + w / 2 - 0.5, dy: box.y + w / 2 - 0.5 };
}
/** How source frame S sits in target frame T (crop-match.js pyramids of their PRINT_W prints): with a crop link (linkFor)
 *  its box refined on these two frames (+-2 px a level; a refinement that fits worse than the box itself keeps the box);
 *  without one, a crop match of the two frames both ways, kept at score >= CROP_MATCH.score. -> {xf, scale, score, via
 *  'link' | 'match', wideIsSrc, box} | null (the same framing, scale < SAME_SCALE, or no confident match). */
export function cropXf(PS, PT, link = null) {
  let r, wideIsSrc;
  if (link) {
    wideIsSrc = link.wideIsSrc;
    const [W, T] = wideIsSrc ? [PS, PT] : [PT, PS], q = W[2], b = link.box;
    r = refine(W, T, { bw: Math.round(b.w * q.w), x: Math.round(b.x * q.w), y: Math.round(b.y * q.h) });
    const at = scoreAt(W, T, b);
    if (!(r.score >= at)) r = { ...b, scale: 1 / b.w, score: at };
  } else {
    const a = matchFrames(PS, PT), b = matchFrames(PT, PS);   // T inside S (S the wider), S inside T
    wideIsSrc = a.score >= b.score; r = wideIsSrc ? a : b;
    if (!(r.score >= CROP_MATCH.score)) return null;
  }
  if (!(r.scale >= SAME_SCALE)) return null;
  const box = { x: r.x, y: r.y, w: r.w, h: r.w }, r3 = (x) => Math.round(x * 1e3) / 1e3;
  return { xf: boxXf(box, wideIsSrc), scale: r3(r.scale), score: r3(r.score), via: link ? 'link' : 'match', wideIsSrc, box };
}
/** A crop-linked pair's distance for the ranking (bestPairs): 1 - NCC of the two PRINT_W prints under the link's box
 *  (0 = the same drawing re-framed): picks the frame of the shot showing the source's picture, loop phase included. */
export const cropDist = (ps, pt, link) => { const [W, T] = link.wideIsSrc ? [ps, pt] : [pt, ps]; return Math.round((1 - scoreAt([W], [T], link.box)) * 1e4) / 1e4; };

// ---- the candidates ----
const usable = (g) => !isSuggested(g) && !isUnassigned(g) && !isIgnore(g) && !g.off && g.poly?.length >= 3 && Number.isFinite(g.t_ms);
const spanOf = (scenes, i) => { const r = takeRange(scenes, i); return r ? [scenes[r[0]].start_ms, scenes[r[1]].end_ms] : null; };
/** The take a frame of the video belongs to (its first shot's index): one tile per take. */
const takeAt = (scenes, t) => { const r = takeRange(scenes, sceneIndexAt(scenes || [], t)); return r ? 's' + r[0] : 's?'; };
/** (a) Painted frames outside the take of shot i: [{kind 'painted', key, src (its take), t, shot, groups}], one per frame (a
 *  group's t_ms inside its own take; groups listed on several shots counted once); a frame whose groups are all copies (an
 *  untouched fill: the same picture as its original) is left out. */
export function paintedSources(scenes, i) {
  const own = spanOf(scenes, i), by = new Map();
  (scenes || []).forEach((s, j) => {
    const sp = spanOf(scenes, j);
    for (const g of s.groups || []) {
      if (!usable(g) || !sp || g.t_ms < sp[0] || g.t_ms >= sp[1] || (own && g.t_ms >= own[0] && g.t_ms < own[1])) continue;
      const t = Math.round(g.t_ms);
      if (!by.has(t)) by.set(t, { kind: 'painted', key: 'p' + t, src: 's' + takeRange(scenes, j)[0], t, shot: j, groups: [] });
      const e = by.get(t);
      if (!e.groups.some((x) => x.name === g.name)) e.groups.push(g);
    }
  });
  return [...by.values()].filter((e) => !e.groups.every(isCopy)).sort((a, b) => a.t - b.t);
}
const fine = (r) => r && !r.restored && !r.tag && r.frames?.t?.length;
const seedsAt = (r, t, frameMs) => Object.fromEntries(Object.entries(runSeeds(r, t, frameMs) || {}).filter(([, p]) => p.length >= 3));
/** (b) Runs covering frame t with the owner's pinned groups seeded there: [{kind 'here', key, t, run, seeds}] (newest run first). */
export function runsHere(runs, t, frameMs) {
  const out = [];
  for (const r of [...(runs || [])].reverse()) {
    if (!fine(r)) continue;
    const seeds = seedsAt(r, t, frameMs);
    if (Object.keys(seeds).length) out.push({ kind: 'here', key: 'h' + r.id, t: Math.round(t), run: r.id, seeds });
  }
  return out;
}
// ponytail: a fixed step along runs; the decode walks every frame of a run's span anyway (inter-coded video), the step only
// bounds the prints kept and compared
export const RUN_EVERY = 250;   // ms: a run's tracked frames are sources this far apart (paw-55la; was 1 s, at most 24)
export const RUN_MAX = 240;     // at most this many, spread over them
/** (c) Runs' tracked frames outside the take [t0, t1): one every `every` ms at most, at most `max` spread over them:
 *  [{kind 'tracked', key, src, t, run, seeds, carry?}]. scenes: src = the frame's take; painted (paintedSources): a frame
 *  inside a painted take whose run holds that frame's groups carries the painted groups along (`carry` {groups, at: the run's
 *  points on the painted frame}: the painted shapes moved with the points, sourceGroups). */
export function trackedSources(runs, t0, t1, frameMs, { every = RUN_EVERY, max = RUN_MAX, scenes = [], painted = [] } = {}) {
  const all = [];
  for (const r of runs || []) {
    if (!fine(r)) continue;
    const carry = new Map();   // src -> {groups, at} for the painted frames this run tracked
    for (const p of painted) {
      const at = seedsAt(r, p.t, frameMs), groups = p.groups.filter((g) => at[g.name]);
      if (groups.length && !carry.has(p.src)) carry.set(p.src, { groups, at });
    }
    let last = -Infinity;
    for (const t of r.frames.t) {
      if ((t >= t0 && t < t1) || t - last < every || nearCut(scenes, t)) continue;
      const seeds = seedsAt(r, t, frameMs);
      if (!Object.keys(seeds).length) continue;
      last = t;
      const src = takeAt(scenes, t), c = carry.get(src);
      all.push({ kind: 'tracked', key: `t${r.id}:${Math.round(t)}`, src, t: Math.round(t), run: r.id, seeds, ...(c ? { carry: c } : {}) });
    }
  }
  if (all.length <= max) return all;
  return Array.from({ length: max }, (_, k) => all[Math.floor((k * all.length) / max)]);
}
const mean = (pts) => pts.reduce((s, [x, y]) => [s[0] + x / pts.length, s[1] + y / pts.length], [0, 0]);
/** The groups a candidate brings, on its own frame: painted as they are; a run's points rebuilt (repeat-groups.js seedGroups),
 *  except the parts a painted frame of the same take carries: its painted shape moved by the shift of the part's points
 *  (copies, `from` = the painted frame). maskFor(g): the masks (default: decoded). */
export function sourceGroups(c, size, maskFor = (g) => maskOf(g, size)) {
  if (c.kind === 'painted') return c.groups;
  if (!c.carry) return seedGroups(c.seeds, c.t, c.t, size);
  const out = [], done = new Set();
  for (const g of c.carry.groups) {
    const p1 = c.seeds[g.name], p0 = c.carry.at[g.name];
    if (!p1 || !p0) continue;
    const [x1, y1] = mean(p1), [x0, y0] = mean(p0), m0 = maskFor(g), m = transformMask(m0, { dx: (x1 - x0) * m0.w, dy: (y1 - y0) * m0.h }), poly = fitPoly(m).poly;
    if (!poly) continue;
    done.add(g.name);
    out.push(moveSections({ ...bare(g), poly, mask: encodeMask(m), t_ms: c.t, source: 'repeat', from: g.from ?? Math.round(g.t_ms) }, g, m0, { dx: (x1 - x0) * m0.w, dy: (y1 - y0) * m0.h }));
  }
  const rest = Object.fromEntries(Object.entries(c.seeds).filter(([n]) => !done.has(n)));
  return [...out, ...seedGroups(rest, c.t, c.t, size)];
}

// ---- the two-way search (paw-55la) ----
export const EDGE_MS = 120;   // frames this close to a cut are left out: a cut found a frame off shows the other shot there (scenes-continue.js printTimes)
/** The frames of shot [a, b) to compare, by index (frame k on the grid, lane.js: the player's clock; its middle inside the shot),
 *  EDGE_MS in from each end (a quarter of a short shot at most) -> [k0, k1] (k0 > k1: none). */
export function shotFrames(a, b, frameMs) {
  const e = Math.min(EDGE_MS, (b - a) / 4), mid = (k) => timeInFrame(k, 0.5, frameMs);
  let k0 = frameAt(a + e, frameMs), k1 = frameAt(b - e, frameMs);
  if (mid(k0) < a + e) k0++;
  if (mid(k1) >= b - e) k1--;
  return [k0, k1];
}
const nearCut = (scenes, t) => { const s = scenes[sceneIndexAt(scenes, t)]; return !!s && (t - s.start_ms < EDGE_MS || s.end_ms - t < EDGE_MS); };
export const COARSE = 300;    // the range's frames printed first: every frame up to this many (10 s at 30 fps), else a stride (the owner: "search all frames")
export const NEAR = 0.015;    // print distances this close are a tie: the frame nearest the playhead wins (owner projects: the same IoU, the copy lands nearer)
/** Frame indices [k0, k1] of the shot to print first: all when they are few, else every `stride`-th (both ends kept). */
export function coarseFrames(k0, k1, n = COARSE) {
  const stride = Math.max(1, Math.ceil((k1 - k0 + 1) / n)), out = [];
  for (let k = k0; k <= k1; k += stride) out.push(k);
  if (out.length && out[out.length - 1] !== k1) out.push(k1);
  return Object.assign(out, { stride });
}
/** The refinement: every frame within r of the given ones, inside [k0, k1], not printed yet (have: Map / Set by index), sorted. */
export function aroundFrames(ks, r, k0, k1, have) {
  const out = new Set();
  for (const k of ks) for (let j = Math.max(k0, k - r); j <= Math.min(k1, k + r); j++) if (!have.has(j)) out.add(j);
  return [...out].sort((a, b) => a - b);
}
/** paw-trxk: what ranks first, whatever the distances (a crop link's 1 - NCC and a print distance are not on one scale):
 *  0 a source in a shot linked to this one (crop link or loop link: the same footage), 1 a painted frame, 2 a run's frame.
 *  The owner: painted groups "first priority"; the linked shot is the one he means. */
export const tierOf = (c) => (c.crop ? 0 : c.kind === 'painted' ? 1 : 2);
/** The tiles: every source (with a print) against every printed frame of the shot (targets: Map frame index -> print):
 *  per source its best frame (printDist, or dist(c, k): a cache; within `near` of the best, the frame nearest kNow), per
 *  take (c.src) its best source (a painted one within `near` of it wins), ranked by tierOf then distance, at most max ->
 *  [{...source, k (the frame of the shot), d}]. */
export function bestPairs(sources, targets, kNow, { max = MAX, near = NEAR, dist = (c, k) => printDist(c.print, targets.get(k)) } = {}) {
  const per = new Map();
  for (const c of sources) {
    if (!c.print) continue;
    const ds = [];
    let lo = Infinity;
    for (const k of targets.keys()) { const d = dist(c, k); ds.push([k, d]); if (d < lo) lo = d; }
    if (!ds.length) continue;
    let best = null;
    for (const [k, d] of ds) if (d <= lo + near && (!best || Math.abs(k - kNow) < Math.abs(best[0] - kNow))) best = [k, d];
    const e = { ...c, k: best[0], d: Math.round(lo * 1e4) / 1e4 }, o = per.get(c.src ?? c.key);
    const pt = (x) => x.kind === 'painted';
    if (!o || tierOf(e) < tierOf(o) || (tierOf(e) === tierOf(o) && (pt(e) !== pt(o) ? (pt(e) ? e.d <= o.d + near : e.d + near < o.d) : e.d < o.d))) per.set(c.src ?? c.key, e);
  }
  return [...per.values()].sort((a, b) => tierOf(a) - tierOf(b) || a.d - b.d || Math.abs(a.k - kNow) - Math.abs(b.k - kNow)).slice(0, max);
}
/** paw-55la: the take's groups once copies land on frame t: they replace frame t's groups, the take's other frames keep
 *  theirs. paw-o74b.1: a copied part the take has on another frame is another seed of it (a part may be seeded on any
 *  number of frames, never twice on one: frame t holds only the copies, whose names are unique). all: the take's groups;
 *  onT(g): g is seeded on frame t. -> {groups, replaced (false: kept for the callers' wording)} */
export function landCopies(all, copies, onT) {
  return { groups: [...(all || []).filter((g) => !onT(g)), ...copies], replaced: false };
}

// ---- lining up ----
const STRIP = ['points', 'unconfirmed', 'prior', 'score', 'tentative', 'sam', 'named_by', 'who_conf', 'mask_from', 'outline', 'lined'];
const bare = (g) => { const r = { ...g }; for (const k of STRIP) delete r[k]; return r; };
/** paw-k5kw: copy c of group g, whose mask (m: its size) moved by t (groups.js transformMask, mask px), with g's knot section and
 *  erase record moved the same way (as G / S do: groups.svelte.js endXf); a section moved off the picture goes. */
function moveSections(c, g, m, t) {
  const size = { w: m.w, h: m.h }, k = knotOf(g, size), er = erasedOf(g, size);
  let r = c;
  if (k) r = withKnot(r, transformMask({ ...size, a: k }, t).a, size);
  if (er) { const e2 = Uint8Array.from(transformMask({ ...size, a: Float32Array.from(er) }, t).a, (v) => (v >= 0.5 ? 1 : 0)); r = withErased(r, e2.some((v) => v) ? e2 : null, size); }
  return r;
}
/** paw-d2d5: a moved group showing less than this share of its area inside the target frame is left out (a tight crop
 *  shows part of the wide scene; generated x1.3-x2.5 crops: experiments/copy-crop/RESULTS.md). */
export const IN_FRAME = 0.15;
const massOf = (m) => { let s = 0; for (let i = 0; i < m.a.length; i++) s += m.a[i]; return s; };
/** Groups (with their masks: maskFor(g)) moved by xf onto frame t as copies: masks moved (groups.js transformMask about
 *  the centre: clipped to the frame), polygons refitted, `from` = their own frame, lined 'moved'. Identity (a run's
 *  points at this very frame): as they are, points kept. A group moved off the picture, or with under IN_FRAME of its
 *  area left inside it, is left out; `lost` counts them (`of`: how many came in). */
export function moveGroups(groups, xf, t, maskFor) {
  const id = !xf || (xf.s === 1 && !xf.dx && !xf.dy && !xf.rot), out = [];
  let lost = 0;
  for (const g of groups || []) {
    const m0 = maskFor(g), t1 = id ? null : { dx: xf.dx * m0.w, dy: xf.dy * m0.h, s: xf.s, rot: xf.rot || 0, cx: m0.w / 2, cy: m0.h / 2 };
    const m = id ? m0 : transformMask(m0, t1);
    const poly = id ? g.poly : massOf(m) < IN_FRAME * massOf(m0) * xf.s * xf.s ? null : fitPoly(m).poly;
    if (!poly) { lost++; continue; }
    const base = id ? { ...g } : bare(g);
    const c = { ...base, poly, mask: id ? g.mask || encodeMask(m) : encodeMask(m), t_ms: t, source: g.source === 'run' ? 'run' : 'repeat', from: g.from ?? Math.round(g.t_ms), ...(id ? {} : { lined: 'moved' }) };
    out.push(id ? c : moveSections(c, g, m0, t1));
  }
  return Object.assign(out, { lost, of: (groups || []).length });
}
// ---- one move for the whole set (paw-trxk) ----
// The owner: "lining up needs to be all points grouped rather than just individually". The copy is placed by ONE move of
// all its groups together (scale + shift): the crop / print move above, refined on the two frames over the pixels the
// groups cover in the source (their union, grown a little), never part by part (a re-find per part let one part snap to
// something else and the set fell apart). experiments/copy-crop/joint.mjs measures it.
/** The pixels of a w x h print of the source frame that the groups cover (union of their masks), grown by `grow` of the
 *  frame's height: Uint8Array(w * h) of 0 / 1, with .n = how many are set. */
export function regionOf(groups, w, h, maskFor, grow = 0.04) {
  let R = new Uint8Array(w * h);
  for (const g of groups || []) {
    const m = maskFor(g);
    if (!m) continue;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (m.a[Math.min(m.h - 1, Math.floor(((j + 0.5) / h) * m.h)) * m.w + Math.min(m.w - 1, Math.floor(((i + 0.5) / w) * m.w))] >= 0.5) R[j * w + i] = 1;
  }
  const r = Math.round(grow * h);
  for (let pass = 0; pass < 2 && r > 0; pass++) {   // a box dilation: rows, then columns
    const o = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!R[j * w + i]) continue;
      if (pass === 0) for (let x = Math.max(0, i - r); x <= Math.min(w - 1, i + r); x++) o[j * w + x] = 1;
      else for (let y = Math.max(0, j - r); y <= Math.min(h - 1, j + r); y++) o[y * w + i] = 1;
    }
    R = o;
  }
  let n = 0;
  for (let k = 0; k < R.length; k++) n += R[k];
  return Object.assign(R, { n });
}
/** NCC of source print S (inside region R) against target print T, S moved by xf (moveGroups' move, rot turning in
 *  picture space, not in 0..1 units); -Infinity when under half the region lands inside T. */
export function regionNcc(S, T, R, xf) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const A = S.w / S.h, B = T.h / T.w, c = Math.cos(xf.rot || 0) * xf.s, q = Math.sin(xf.rot || 0) * xf.s;
  for (let j = 0; j < S.h; j++) for (let i = 0; i < S.w; i++) {
    if (!R[j * S.w + i]) continue;
    const pu = ((i + 0.5) / S.w - 0.5) * A, pv = (j + 0.5) / S.h - 0.5;
    const tx = ((pu * c - pv * q) * B + 0.5 + xf.dx) * T.w - 0.5, ty = (pu * q + pv * c + 0.5 + xf.dy) * T.h - 0.5;
    if (tx < 0 || ty < 0 || tx > T.w - 1 || ty > T.h - 1) continue;
    const x0 = Math.floor(tx), y0 = Math.floor(ty), x1 = Math.min(T.w - 1, x0 + 1), y1 = Math.min(T.h - 1, y0 + 1), u = tx - x0, v = ty - y0;
    const b = (T.d[y0 * T.w + x0] * (1 - u) + T.d[y0 * T.w + x1] * u) * (1 - v) + (T.d[y1 * T.w + x0] * (1 - u) + T.d[y1 * T.w + x1] * u) * v, a = S.d[j * S.w + i];
    n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
  }
  if (n < 0.5 * R.n || n < 16) return -Infinity;
  const d = Math.sqrt((n * saa - sa * sa) * (n * sbb - sb * sb));
  return d > 0 ? (n * sab - sa * sb) / d : 0;
}
export const JOINT = { reach: 0.08, zoom: 1.15, turn: 0.12, gain: 0.01 };   // shift (frame units), zoom and turn (radians) reach from the start; kept only when the NCC gains this much
/** The move xf refined so the source pixels under the groups (R) fit the target best: ONE scale + shift + turn for all of
 *  them (coordinate descent, 3 step sizes, bounded by o). S, T: grey prints ({w, h, d}, crop-match.js grey). -> {s, dx,
 *  dy, rot, ncc, from (the start's NCC), joint: true} or xf itself when nothing fits better by o.gain (or the region is empty). */
export function jointFit(S, T, R, xf, o = JOINT) {
  if (!S || !T || !R?.n) return xf;
  const s0 = xf.s || 1, r0 = xf.rot || 0, from = regionNcc(S, T, R, xf);
  let best = { s: s0, dx: xf.dx || 0, dy: xf.dy || 0, rot: r0, ncc: from };
  for (const [st, k, a] of [[0.02, 1.04, 0.02], [0.01, 1.02, 0.01], [0.004, 1.008, 0.004]]) {
    for (let it = 0, moved = true; moved && it < 12; it++) {
      moved = false;
      for (const [ds, ddx, ddy, dr] of [[1, st, 0, 0], [1, -st, 0, 0], [1, 0, st, 0], [1, 0, -st, 0], [k, 0, 0, 0], [1 / k, 0, 0, 0], [1, 0, 0, a], [1, 0, 0, -a]]) {
        const c = { s: best.s * ds, dx: best.dx + ddx, dy: best.dy + ddy, rot: best.rot + dr };
        if (Math.abs(c.dx - (xf.dx || 0)) > o.reach || Math.abs(c.dy - (xf.dy || 0)) > o.reach || Math.abs(Math.log(c.s / s0)) > Math.log(o.zoom) || Math.abs(c.rot - r0) > o.turn) continue;
        const v = regionNcc(S, T, R, c);
        if (v > best.ncc + 1e-4) { best = { ...c, ncc: v }; moved = true; }
      }
    }
  }
  if (!(best.ncc >= from + o.gain) && Number.isFinite(from)) return xf;
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  return { ...xf, s: r4(best.s), dx: r4(best.dx), dy: r4(best.dy), rot: r4(best.rot), ncc: r4(best.ncc), from: Number.isFinite(from) ? r4(from) : null, joint: true };
}

// ---- the global search (owner 2026-11-19: "aligning the image is all it needs to do: scale, translate or rotate") ----
// jointFit only refines near its start; a copy whose frame moved further (or turned) settled on a wrong edge. alignRegion
// searches the whole range on a 4x smaller print first (every scale x turn x shift), then refines the best few distinct
// starts at full size and keeps the best NCC.
export const ALIGN = {
  scales: [0.67, 0.74, 0.82, 0.9, 1, 1.11, 1.22, 1.35, 1.5],
  turns: [-24, -18, -12, -6, 0, 6, 12, 18, 24].map((d) => (d * Math.PI) / 180),
  shift: 0.4, step: 0.05,   // shifts -shift..shift in frame units
  shrink: 4, starts: 4,
};
/** P ({w, h, d}) box-averaged f x f; R (0 / 1 over P) any-set f x f, with .n. */
function shrinkP(P, f) {
  const w = Math.max(1, Math.floor(P.w / f)), h = Math.max(1, Math.floor(P.h / f)), d = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0;
    for (let y = 0; y < f; y++) for (let x = 0; x < f; x++) s += P.d[(j * f + y) * P.w + i * f + x];
    d[j * w + i] = s / (f * f);
  }
  return { w, h, d };
}
function shrinkR(R, W, f) {
  const H = R.length / W, w = Math.max(1, Math.floor(W / f)), h = Math.max(1, Math.floor(H / f)), o = new Uint8Array(w * h);
  let n = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let on = 0;
    for (let y = 0; y < f && !on; y++) for (let x = 0; x < f && !on; x++) on = R[(j * f + y) * W + i * f + x];
    if (on) { o[j * w + i] = 1; n++; }
  }
  return Object.assign(o, { n });
}
/** The one move (scale, shift, turn) that lines the source pixels under the groups (R) up on the target, searched over
 *  the whole ALIGN range. -> {s, dx, dy, rot, ncc, from (the unmoved NCC), joint: true}, or IDENTITY when staying put
 *  fits as well (or there is nothing to compare). */
export function alignRegion(S, T, R, o = ALIGN) {
  if (!S || !T || !R?.n) return IDENTITY;
  const from = regionNcc(S, T, R, IDENTITY), s = shrinkP(S, o.shrink), t = shrinkP(T, o.shrink), r = shrinkR(R, S.w, o.shrink);
  const cand = [], n = Math.round(o.shift / o.step);
  for (const sc of o.scales) for (const rot of o.turns) for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
    const xf = { s: sc, rot, dx: a * o.step, dy: b * o.step }, v = regionNcc(s, t, r, xf);
    if (Number.isFinite(v)) cand.push({ ...xf, v });
  }
  cand.sort((x, y) => y.v - x.v);
  const far = (x, y) => Math.abs(Math.log(x.s / y.s)) > 0.15 || Math.abs(x.rot - y.rot) > 0.15 || Math.hypot(x.dx - y.dx, x.dy - y.dy) > 0.12;
  const starts = [];
  for (const c of cand) { if (starts.every((x) => far(x, c))) starts.push(c); if (starts.length >= o.starts) break; }
  let best = { ...IDENTITY, rot: 0, ncc: from };
  for (const c of starts) {
    const f = jointFit(S, T, R, { s: c.s, dx: c.dx, dy: c.dy, rot: c.rot }, { reach: 0.08, zoom: 1.12, turn: 0.12, gain: -Infinity });
    const v = f.ncc ?? regionNcc(S, T, R, f);
    if (v > best.ncc) best = { ...f, ncc: v };
  }
  if (!(best.ncc > from + JOINT.gain) && Number.isFinite(from)) return IDENTITY;
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  return { s: best.s, dx: best.dx, dy: best.dy, rot: best.rot, ncc: r4(best.ncc), from: Number.isFinite(from) ? r4(from) : null, joint: true };
}

/** The prior list for suggest_groups (v4.13) from moved copies: {name, who?, part?, side?, poly}. */
export const priorOf = (groups) => groups.map((g) => ({ name: g.name, ...(g.who ? { who: g.who } : {}), ...(g.part ? { part: g.part } : {}), ...(g.side ? { side: g.side } : {}), poly: g.poly }));
const centre = (m) => { let sx = 0, sy = 0, n = 0; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const v = m.a[y * m.w + x]; if (v >= 0.5) { sx += x + 0.5; sy += y + 0.5; n++; } } return n ? { x: sx / n / m.w, y: sy / n / m.h, n } : null; };
const polyCentre = (p) => p.reduce((s, q) => [s[0] + q[0] / p.length, s[1] + q[1] / p.length], [0, 0]);
/** Moved copies + suggest_groups' answer (its groups; the re-found ones carry `prior` = the copy's name): each re-found copy
 *  is shifted onto its re-found centre (its painted shape kept: ponytail, SAM's / the seeder's outline is not taken) and
 *  lined 'refound'; a copy not re-found, or re-found implausibly far (more than max(0.08, 1.5 x its radius), true aspect),
 *  keeps the move and is `unconfirmed` (dotted '?': Accept or repaint). Never dropped. size: the masks' size. */
export function refitGroups(moved, found, size, maskFor) {
  const by = new Map();
  for (const x of found || []) if (x.prior && x.poly?.length >= 3 && !by.has(x.prior)) by.set(x.prior, x);
  const a = size.w / size.h;
  return moved.map((g) => {
    const x = by.get(g.name), m = maskFor(g), c = centre(m);
    if (x && c) {
      const [px, py] = polyCentre(x.poly), dx = px - c.x, dy = py - c.y, r = Math.sqrt(c.n / Math.PI) / size.h;
      if (Math.hypot(dx * a, dy) <= Math.max(0.08, 1.5 * r)) {
        const mm = transformMask(m, { dx: dx * m.w, dy: dy * m.h }), poly = fitPoly(mm).poly;
        if (poly) { const { unconfirmed: _u, points: _p, ...r2 } = g; return moveSections({ ...r2, poly, mask: encodeMask(mm), lined: 'refound' }, g, m, { dx: dx * m.w, dy: dy * m.h }); }   // eslint-disable-line no-unused-vars
      }
    }
    return { ...g, unconfirmed: true };
  });
}
/** Mean IoU of copies against painted groups by name (each painted group's best name match; missing = 0): the measure
 *  experiments/copy-from uses. */
export function namedIoU(copies, painted, size) {
  if (!painted.length) return NaN;
  let s = 0;
  for (const p of painted) {
    const c = copies.find((g) => g.name === p.name);
    if (!c) continue;
    const A = maskOf(p, size).a, B = maskOf(c, size).a;
    let i = 0, u = 0;
    for (let k = 0; k < A.length; k++) { const x = A[k] >= 0.5, y = B[k] >= 0.5; if (x && y) i++; if (x || y) u++; }
    s += u ? i / u : 0;
  }
  return s / painted.length;
}
