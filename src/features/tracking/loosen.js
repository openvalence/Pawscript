// loosen.js -- the loosen / tighten dial of a group (paw-k8jj; pure): Alt + wheel (or Alt + Up / Down) over a group, one continuous scale.
//   a SAM-grown group first walks SAM's own answers: its candidates (sub-part -> part -> whole), SUBSTEPS notches between two of them
//   (their low-res logits blended), and past the ends the same logits shifted TAU_STEP per notch (a lower / higher threshold): no new request;
//   past what SAM offers, and for a hand-painted group from the start, an edge-aware step: outward = circle to fill's inside / outside model and
//   edge stop, EDGE_PX mask px per notch, never across a strong edge or into another group; inward = erode toward the core, one smooth piece,
//   never under MIN_FRAC of where it started. Looser always means "take more of THIS part" (an edge-less picture: the dial stops).
import { signedDistance } from './snap.js';
import { fillLoop } from './fill.js';
import { cleanMask, ABSURD_IMAGE } from './grow.js';

// ONE notch = about NOTCH_AREA of the area (owner: a notch was far too coarse; 1 / 10 of the old ~10 %). DIAL_FINE scales every per-notch size below: ask for a different factor here, nowhere else.
export const DIAL_FINE = 0.1;                // the old notch x this
export const NOTCH_AREA = 0.01;              // the area change one notch aims for (the old notch: ~8 - 10 %: GROW_MIN / SHRINK_MIN, which now only choose the REGION SAM suggests)
export const SUBSTEPS = 3;      // notches between two of SAM's candidates
export const TAU_AREA = 1 + NOTCH_AREA;   // past the first / last candidate a notch is the smallest threshold shift (TAU_GRAIN logit steps, SAM's decision threshold is 0, its masks swing about +-10) that changes the area by this ratio
export const TAU_GRAIN = 5 * DIAL_FINE;   // logit units: the threshold search moves in steps of this
export const TAU_NOTCHES = 8 / DIAL_FINE;   // at most this many threshold notches past the first / last candidate
export const TAU_MAX = 12;      // ... and the threshold never moves further than this (logit units)
export const LOOSE_CAP = 8;     // a SAM level covering more than this x the area the dial started at is a flood: the SAM range ends before it
export const TIGHT_FRAC = 0.1;  // ... one under this share of it is a speck
export const EDGE_PX = 2 * DIAL_FINE;       // mask px (the app's mask is ~320 wide) per edge-aware notch: sub-pixel, the field is re-thresholded
export const EDGE_MAX = 24 / DIAL_FINE;     // at most this many edge-aware notches either way
export const MIN_FRAC = 0.2;    // inward steps keep at least this share of the mask they started from ...
export const MIN_PX = 12;       // ... and this many pixels
export const STALL = 1.0002;     // an outward notch that grows the area by less than this ratio is the end of the road

const count = (a, th = 0.5) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= th) n++; return n; };

/**
 * A dial for one group. Either `cands`: [{L: logits (Float32Array w x h, > 0 inside)}] smallest candidate first, k0: the notch of the
 * candidate it started at (index * SUBSTEPS), or `base`: {w, h, a} a hand-painted mask. pos: the prompts (mask px) that keep one piece.
 * -> {mask(p, ctx) -> {a, p (the notch actually reached: p is clamped to what exists), mode: 'sam' | 'edge' | 'base', stuck},
 *     range() -> {lo, hi}}. p = notches relative to the start (0 = the group as it was). ctx: {em (snap.js edgeMap | null), others, margin 0..1, radius}.
 */
export function makeDial({ cands = null, k0 = 0, base = null, w, h, pos = [] }) {
  const n = cands?.length || 0, kmax = Math.max(0, (n - 1) * SUBSTEPS);
  const shifts = { up: [0], down: [0] };   // the threshold shift of notch i past the last / first candidate (found once, lazily)
  const inside = (L, d) => { let c = 0; for (let j = 0; j < L.length; j++) if (L[j] + d > 0) c++; return c; };
  const shiftOf = (side, i) => {
    const arr = shifts[side], L = side === 'up' ? cands[n - 1].L : cands[0].L, sg = side === 'up' ? 1 : -1;
    while (arr.length <= Math.min(i, TAU_NOTCHES)) {
      const prev = arr[arr.length - 1], base = inside(L, sg * prev);
      let d = prev;
      while (d < TAU_MAX && (sg > 0 ? inside(L, sg * d) < base * TAU_AREA : inside(L, sg * d) > base / TAU_AREA)) d += TAU_GRAIN;
      if (d === prev) break;   // the threshold ran out of room: the last notch stays
      arr.push(d);
    }
    return arr[Math.min(i, arr.length - 1)];
  };
  const field = (k) => {   // SAM's logits at notch k
    if (k <= 0) return shift(cands[0].L, k ? -shiftOf('down', -k) : 0);
    if (k >= kmax) return shift(cands[n - 1].L, shiftOf('up', k - kmax));
    const i = Math.floor(k / SUBSTEPS), t = (k % SUBSTEPS) / SUBSTEPS;
    if (!t) return cands[i].L;
    const out = new Float32Array(w * h), A = cands[i].L, B = cands[i + 1].L;
    for (let j = 0; j < out.length; j++) out[j] = (1 - t) * A[j] + t * B[j];
    return out;
  };
  const shift = (L, d) => { if (!d) return L; const o = new Float32Array(L.length); for (let j = 0; j < o.length; j++) o[j] = L[j] + d; return o; };
  const cover = (k) => { const f = field(k), a = new Float32Array(w * h); for (let j = 0; j < a.length; j++) a[j] = f[j] > 0 ? 1 : 0; return a; };
  const areas = new Map(), area = (k) => { if (!areas.has(k)) areas.set(k, count(cover(k))); return areas.get(k); };
  let kLo = k0, kHi = k0, ranged = false;
  const range = () => {   // the SAM notches that are neither a flood nor a speck, around the start
    if (ranged || !n) { ranged = true; return { lo: kLo - k0, hi: kHi - k0 }; }
    ranged = true;
    const a0 = Math.max(1, area(k0)), cap = Math.min(ABSURD_IMAGE * w * h, LOOSE_CAP * a0), kTop = kmax + TAU_NOTCHES, kBot = -TAU_NOTCHES;
    while (kHi < kTop && area(kHi + 1) <= cap && area(kHi + 1) >= area(kHi)) kHi++;
    while (kLo > kBot && area(kLo - 1) >= Math.max(MIN_PX, TIGHT_FRAC * a0) && area(kLo - 1) <= area(kLo)) kLo--;
    return { lo: kLo - k0, hi: kHi - k0 };
  };
  const memo = new Map();   // the cleaned mask at a SAM notch (the edge steps hang on the identity of it)
  const cleaned = (k, ctx, margin) => { if (!memo.has(k)) memo.set(k, cleanMask(cover(k), w, h, pos, { others: ctx.others || [], margin }).a); return memo.get(k); };

  // edge-aware steps from a base coverage: the outward region is found ONCE (the whole reach), each notch takes the part of it within n x EDGE_PX
  let eb = null;   // {key, cov, sd, full}
  const edgeOf = (cov, ctx) => {
    if (eb?.cov === cov) return eb;
    const raster = new Uint8Array(w * h);
    for (let j = 0; j < raster.length; j++) raster[j] = cov[j] >= 0.5 ? 1 : 0;
    const px = count(raster, 1), R = Math.sqrt(Math.max(1, px) / Math.PI);
    // the outside the model compares with is a ring beyond the reach: a small base deep inside a big part needs a farther ring, so the reach is tried at 1, 2.5 and 6 x
    let r = null;
    if (ctx.em && px > 20) for (const f of [1, 2.5, 6]) { r = fillLoop(null, w, h, ctx.em, { raster, others: ctx.others || [], radius: ctx.radius || 8, travel: (f * EDGE_MAX * EDGE_PX) / R, margin: ctx.margin }); if (r.mode === 'picture') break; }
    const sd = signedDistance(raster, w, h);
    let core = 0;
    for (let j = 1; j < sd.length; j++) if (sd[j] < sd[core]) core = j;
    eb = { cov, raster, px, sd, full: r && r.mode === 'picture' ? r.mask.a : null, core: [(core % w) + 0.5, ((core / w) | 0) + 0.5], grown: [] };
    return eb;
  };
  const grow = (cov, steps, ctx) => {   // -> {a, p: steps reached}
    const e = edgeOf(cov, ctx);
    if (!e.full) return { a: cov, p: 0 };
    if (e.dmax === undefined) { e.dmax = 0; for (let j = 0; j < e.sd.length; j++) if (e.full[j] >= 0.5 && !e.raster[j] && e.sd[j] > e.dmax) e.dmax = e.sd[j]; }   // the farthest pixel of the region: the end of the road
    const i = Math.min(steps, Math.floor(e.dmax / EDGE_PX), EDGE_MAX);
    if (i < 1) return { a: cov, p: 0 };
    if (!e.grown[i]) {
      const b = new Uint8Array(w * h);
      for (let j = 0; j < b.length; j++) b[j] = e.raster[j] || (e.full[j] >= 0.5 && e.sd[j] <= i * EDGE_PX) ? 1 : 0;
      const c = cleanMask(Float32Array.from(b), w, h, [e.core], { others: ctx.others || [], margin: 0 }).a;
      for (let j = 0; j < c.length; j++) c[j] = Math.max(c[j], cov[j]);
      e.grown[i] = { a: c };
    }
    return { a: e.grown[i].a, p: i };
  };
  const shrink = (cov, steps, ctx) => {
    const e = edgeOf(cov, ctx), floor = Math.max(MIN_PX, MIN_FRAC * e.px), left = (i) => { let c = 0; for (let j = 0; j < e.sd.length; j++) if (e.sd[j] < -i * EDGE_PX) c++; return c; };
    let lo = 0, hi = Math.min(steps, EDGE_MAX);   // the deepest notch that keeps the minimum size (the area only falls as it deepens)
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (left(mid) >= floor) lo = mid; else hi = mid - 1; }
    if (!lo) return { a: cov, p: 0 };
    const b = new Float32Array(w * h);
    for (let j = 0; j < b.length; j++) b[j] = e.sd[j] < -lo * EDGE_PX ? 1 : 0;
    return { a: cleanMask(b, w, h, [e.core], { others: [], margin: 0 }).a, p: lo };
  };

  return {
    range,
    mask(p, ctx = {}) {
      const margin = ctx.margin ?? 0.15;
      if (!n) {   // a hand-painted group: the base, then edge-aware steps either way
        if (p === 0) return { a: base.a, p: 0, mode: 'base' };
        const r = p > 0 ? grow(base.a, p, ctx) : shrink(base.a, -p, ctx);
        return { a: r.a, p: p > 0 ? r.p : -r.p, mode: r.p ? 'edge' : 'base', stuck: r.p < Math.abs(p) };
      }
      const { lo, hi } = range(), q = Math.max(lo, Math.min(hi, p));
      if (q === p) return { a: cleaned(k0 + p, ctx, margin), p, mode: 'sam' };
      // past SAM: edge-aware from the last SAM level
      const edge = cleaned(k0 + q, ctx, margin), r = p > q ? grow(edge, p - q, ctx) : shrink(edge, q - p, ctx);
      const reached = q + (p > q ? r.p : -r.p);
      return { a: r.p ? r.a : edge, p: reached, mode: r.p ? 'edge' : 'sam', stuck: reached !== p };
    },
  };
}

/** The sidecar's {w, h, s, b64} int8 logits -> Float32Array nw x nh (bilinear; the 256 x 256 grid spans the whole frame, as SAM's does). */
export function decodeLogits(lg, nw, nh) {
  const bin = atob(lg.b64), q = new Float32Array(lg.w * lg.h), out = new Float32Array(nw * nh);
  for (let i = 0; i < q.length; i++) { const v = bin.charCodeAt(i); q[i] = (v > 127 ? v - 256 : v) * lg.s; }
  for (let y = 0; y < nh; y++) {
    const fy = Math.max(0, Math.min(lg.h - 1, ((y + 0.5) * lg.h) / nh - 0.5)), y0 = Math.floor(fy), y1 = Math.min(lg.h - 1, y0 + 1), v = fy - y0;
    for (let x = 0; x < nw; x++) {
      const fx = Math.max(0, Math.min(lg.w - 1, ((x + 0.5) * lg.w) / nw - 0.5)), x0 = Math.floor(fx), x1 = Math.min(lg.w - 1, x0 + 1), u = fx - x0;
      out[y * nw + x] = (q[y0 * lg.w + x0] * (1 - u) + q[y0 * lg.w + x1] * u) * (1 - v) + (q[y1 * lg.w + x0] * (1 - u) + q[y1 * lg.w + x1] * u) * v;
    }
  }
  return out;
}

// ---- the SAM stage (paw-k8jj; the owner: "it should re-SAM per se"): every notch ASKS SAM AGAIN, built from the current mask and the direction ----
// looser: positives + extra positives just outside the edge where the picture still looks like the part, the mask dilated by a step as SAM's mask
// prompt, the box padded; take the smallest answer that holds the current mask and is meaningfully larger. tighter: the positives kept, negatives in the
// outermost band, the mask eroded, the box shrunk; take the largest answer that still holds the positives and is meaningfully smaller. The pointer
// decides which side the new points go (scrolling near an edge mainly moves that edge). Pure: the store sends the request.
import { labOf, stats, dist as labDist } from './snap.js';
import { INSIDE_SIGMA, EDGE_BLOCK_MIN, components } from './fill.js';

export const STEP_FRAC = 0.12;      // a step is this x the mask's equivalent radius ...
export const STEP_MIN = 2, STEP_MAX = 10;   // ... between these mask px
export const STEP_RETRY = 2.5;      // SAM returned nothing meaningfully different: ask once more with a step this x bigger
export const GROW_MIN = 0.08;       // a looser answer is at least this much larger than the current mask ...
export const SHRINK_MIN = 0.08;     // ... a tighter one this much smaller
export const CONTAIN = 0.9;         // a looser answer holds at least this share of the current mask
export const EXTRA = 3;             // extra positives (looser) / negatives (tighter) per request
export const SPREAD = 5;            // ... at least this many mask px apart
export const OUTSIDE_RING = 2.5;    // extra positives come from the ring this x the step outside the edge
export const BAND = 2;              // negatives come from the band this x the step inside the edge

const area = (a, th = 0.5) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= th) n++; return n; };
export const stepOf = (a) => Math.max(STEP_MIN, Math.min(STEP_MAX, STEP_FRAC * Math.sqrt(area(a) / Math.PI)));
const bin = (a) => Uint8Array.from(a, (v) => (v >= 0.5 ? 1 : 0));

/** The mask grown (d > 0) or shrunk (d < 0) by |d| px, 0 / 1. */
export function moved(a, w, h, d) {
  const sd = signedDistance(bin(a), w, h), out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = sd[i] < d ? 1 : 0;
  return out;
}
const bboxOf = (a, w, h) => { let x0 = w, y0 = h, x1 = -1, y1 = -1; for (let i = 0; i < a.length; i++) if (a[i] >= 0.5) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1]; };

/** n points well inside a mask (mask px): the deepest pixel, then farthest-point picks among the deep ones. */
export function insidePoints(a, w, h, n = 3) {
  const sd = signedDistance(bin(a), w, h);
  let best = 0;
  for (let i = 0; i < sd.length; i++) if (sd[i] < best) best = sd[i];
  if (!best) return [];
  const deep = [];
  for (let i = 0; i < sd.length; i++) if (sd[i] <= 0.5 * best) deep.push(i);
  const at = (i) => [(i % w) + 0.5, ((i / w) | 0) + 0.5], pts = [];
  let c = deep[0];
  for (const i of deep) if (sd[i] < sd[c]) c = i;
  pts.push(at(c));
  while (pts.length < n) {
    let far = -1, fd = 0;
    for (let k = 0; k < deep.length; k += Math.max(1, deep.length >> 9)) { const p = at(deep[k]), d = Math.min(...pts.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))); if (d > fd) { fd = d; far = deep[k]; } }
    if (far < 0 || fd < SPREAD) break;
    pts.push(at(far));
  }
  return pts;
}

// points near the pointer, spread out: candidates nearest the pointer first, each at least SPREAD from the kept ones
function nearest(cands, w, ptr, n, avoid = []) {
  const at = (i) => [(i % w) + 0.5, ((i / w) | 0) + 0.5], out = [];
  const key = ptr ? (i) => { const p = at(i); return Math.hypot(p[0] - ptr[0], p[1] - ptr[1]); } : () => 0;
  for (const i of cands.sort((x, y) => key(x) - key(y))) {
    const p = at(i);
    if ([...out, ...avoid].every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= SPREAD)) out.push(p);
    if (out.length >= n) break;
  }
  return out;
}

/** Extra positives just OUTSIDE the edge where the picture still looks like the part (circle to fill's Lab inside model, no strong edge). em: snap.js edgeMap | null. */
export function outsidePoints(a, w, h, { em, others = [], step, ptr, n = EXTRA }) {
  if (!em || em.w !== w || em.h !== h) return [];
  const sd = signedDistance(bin(a), w, h), P = labOf(em), core = [], ring = [];
  for (let i = 0; i < sd.length; i++) { if (sd[i] < -1) core.push(i); else if (sd[i] > 0.5 && sd[i] <= OUTSIDE_RING * step && !others.some((o) => o && o.a[i] >= 0.5)) ring.push(i); }
  if (core.length < 8) return [];
  const st = stats(P, core), ein = core.map((i) => em.e[i]).sort((x, y) => x - y), block = Math.max(EDGE_BLOCK_MIN, 3 * (ein[ein.length >> 1] || 0));
  // only ring pixels that are connected to the mask through pixels that look like the part (a strong edge in between cuts them off)
  const like = new Uint8Array(w * h);
  for (const i of ring) if (labDist(P, i, st) <= INSIDE_SIGMA && em.e[i] <= block) like[i] = 1;
  for (const i of core) like[i] = 1;
  for (let i = 0; i < sd.length; i++) if (sd[i] >= -1 && sd[i] <= 0.5) like[i] = 1;
  const { lab } = components(like, w, h), id = lab[core[0]];
  return nearest(ring.filter((i) => like[i] && lab[i] === id), w, ptr, n);
}

/** Negatives in the outermost band of the mask, nearest the pointer first (never within SPREAD of a positive). */
export function bandPoints(a, w, h, { step, ptr, n = EXTRA, avoid = [] }) {
  const sd = signedDistance(bin(a), w, h), band = [];
  for (let i = 0; i < sd.length; i++) if (sd[i] < -0.5 && sd[i] >= -BAND * step) band.push(i);
  return nearest(band, w, ptr, n, avoid);
}

/**
 * The `segment` request for one notch. cur: the current mask's coverage (w x h); dir: 1 looser, -1 tighter; pos0: the group's positive points
 * (mask px; none: points sampled inside it); ctx: {w, h, em, others, ptr (the pointer, mask px), step}.
 * -> {pos, neg, box [x0, y0, x1, y1] (mask px), mask: {w, h, a} the dilated / eroded current mask}.
 */
export function dialRequest(cur, dir, { w, h, em = null, others = [], ptr = null, step, pos0 = [] }) {
  const base = pos0.length ? pos0 : insidePoints(cur, w, h, 3), box = bboxOf(cur, w, h) || [0, 0, w, h], pad = dir > 0 ? step : -step;
  const bx = [Math.max(0, box[0] - pad), Math.max(0, box[1] - pad), Math.min(w, box[2] + pad), Math.min(h, box[3] + pad)];
  const mask = { w, h, a: moved(cur, w, h, dir > 0 ? step : -step) };
  if (dir > 0) return { pos: [...base, ...outsidePoints(cur, w, h, { em, others, step, ptr })], neg: [], box: bx[2] > bx[0] && bx[3] > bx[1] ? bx : box, mask };
  return { pos: base, neg: bandPoints(cur, w, h, { step, ptr, avoid: base }), box: bx[2] > bx[0] + 2 && bx[3] > bx[1] + 2 ? bx : box, mask };
}

const holds = (m, pts, w, h) => pts.every(([x, y]) => m[Math.min(h - 1, Math.max(0, Math.floor(y))) * w + Math.min(w - 1, Math.max(0, Math.floor(x)))] >= 0.5);

/** SAM's answers [{a, score}] -> the next LARGER one for a looser notch: holds CONTAIN of the current mask, at least GROW_MIN more area, under the flood guard `cap` (px); the smallest such. null: none. */
export function chooseLarger(cands, cur, { cap }) {
  const a0 = area(cur), ok = [];
  for (const c of cands) {
    const n = area(c.a);
    let inter = 0;
    for (let i = 0; i < cur.length; i++) if (cur[i] >= 0.5 && c.a[i] >= 0.5) inter++;
    if (n >= (1 + GROW_MIN) * a0 && n <= cap && inter >= CONTAIN * a0) ok.push({ c, n });
  }
  ok.sort((x, y) => x.n - y.n);
  return ok[0]?.c || null;
}

/** ... the next SMALLER one for a tighter notch: still holds every positive point, at least SHRINK_MIN less area, over the minimum `min` (px); the largest such. */
export function chooseSmaller(cands, cur, { w, h, pos, min }) {
  const a0 = area(cur), ok = [];
  for (const c of cands) {
    const n = area(c.a);
    if (n <= (1 - SHRINK_MIN) * a0 && n >= min && holds(c.a, pos, w, h)) ok.push({ c, n });
  }
  ok.sort((x, y) => y.n - x.n);
  return ok[0]?.c || null;
}

/** Soft logits of a mask (> 0 inside, a slope like SAM's at the edge): the stand-in when a mask has none of its own. */
export function logitsOfMask(a, w, h) {
  const sd = signedDistance(bin(a), w, h), L = new Float32Array(w * h);
  for (let i = 0; i < L.length; i++) L[i] = Math.max(-12, Math.min(12, -2 * sd[i]));
  return L;
}

/**
 * One FINE notch toward SAM's suggestion: the logits of the current mask blended toward the suggested candidate's, the blend found (bisection)
 * so the area moves by about NOTCH_AREA (looser: up, tighter: down). SAM still says WHICH region comes next and the boundary stays SAM-shaped;
 * the notch only decides how far toward it. A candidate already within a notch is taken whole. -> {raw (0 / 1), L (the blended logits)}.
 */
export function fineStep(cur, curL, pick, pickL, dir, w, h) {
  const a0 = area(cur), target = a0 * (1 + dir * NOTCH_AREA), n = w * h;
  const La = curL || logitsOfMask(cur, w, h), Lb = pickL || logitsOfMask(pick, w, h);
  if (dir > 0 ? area(pick) <= target : area(pick) >= target) return { raw: Float32Array.from(pick, (v) => (v >= 0.5 ? 1 : 0)), L: Lb };
  const blend = (t) => { const f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = La[i] * (1 - t) + Lb[i] * t; return f; };
  const inside = (f) => { let c = 0; for (let i = 0; i < n; i++) if (f[i] > 0) c++; return c; };
  let lo = 0, hi = 1;
  for (let k = 0; k < 9; k++) { const mid = (lo + hi) / 2, c = inside(blend(mid)); if (dir > 0 ? c < target : c > target) lo = mid; else hi = mid; }
  const f = blend(hi), raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = f[i] > 0 ? 1 : 0;
  return { raw, L: f };
}
