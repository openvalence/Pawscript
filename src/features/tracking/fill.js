// fill.js -- "circle to fill" for the Groups brush (paw-714j; pure, classical, local: no model). The owner draws a rough loop
// around most of a part (a thin lasso line, not necessarily closed); the part becomes ONE smooth blob:
//   1. the loop's interior, smoothed (snap.js signed distance + blur);
//   2. what "inside" looks like (Lab colour statistics well inside the loop) and what "outside" looks like (a ring beyond it)
//      are learned from the cached frame (snap.js edgeMap, at mask resolution); the region grows over pixels that look like
//      inside, are connected to the loop's core, are not stopped by an edge, and lie within TRAVEL x the loop's own radius
//      of it; pixels of the loop that look like the outside (the loop overshot) are dropped; holes are filled; one component;
//   3. the contour is regularised (snapDisplacement) and pulled a little inside the part's edge (insetOutline: the snap's
//      margin, with its thin-shape guard); never into another group.
// Without a decodable frame, or when inside and outside look the same (a flat frame), the result is the loop's own
// smoothed, inset interior: it never floods. test/groups-fill.test.mjs.
import { signedDistance, boxBlur, snapDisplacement, insetOutline, marginFor, MARGIN_DEFAULT, lab, stats, dist, SIGMA_FLOOR } from './snap.js';

export const CLOSE_FRAC = 0.25;     // an open stroke closes when its ends are within this share of its length (the loop's gap)
export const MIN_AREA = 0.03;       // a loop encloses at least this x length^2 (a circle: 0.080, a straight stroke: 0, a gentle arc < 0.03)
export const MIN_LEN = 12;          // mask px: shorter is a dab, not a lasso
export const TRAVEL = 0.5;          // the farthest the region grows past the loop, x the loop's equivalent radius
export const HOLE_FRAC = 0.1;       // holes up to this share of the region are filled
export const INSIDE_SIGMA = 2.6;    // a pixel looks like inside within this many (floored) standard deviations of the inside mean
export const SEP_MIN = 2.2;         // inside and outside means closer than this (pooled sigmas): they look the same, no growing
export const EDGE_BLOCK_MIN = 28;   // colour gradient that stops the growth at least (and 3 x the typical inside gradient)
export const REACH_FRAC = 0.1;      // contour regularisation reach, x the radius

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** A stroke (mask px [[x, y], ...]) -> the closed loop polygon, or null when it is not loop-like. The ends are joined when
 *  their gap is within CLOSE_FRAC of the stroke's length; it must enclose MIN_AREA x length^2 (a straight stroke, a plain
 *  scribble back and forth, a gentle curve stay brush strokes). */
export function loopFrom(pts, { closeFrac = CLOSE_FRAC, minArea = MIN_AREA, minLen = MIN_LEN } = {}) {
  if (!pts || pts.length < 4) return null;
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (L < minLen) return null;
  const a = pts[0], b = pts[pts.length - 1], gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (gap > closeFrac * L) return null;
  let A = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; A += p[0] * q[1] - q[0] * p[1]; }
  A = Math.abs(A) / 2;
  if (A < minArea * (L + gap) ** 2) return null;
  return pts.map((p) => [p[0], p[1]]);
}

/** Even-odd raster of a polygon (mask px) -> Float32Array w x h of 0 / 1 (pixel centres). */
export function rasterLoop(poly, w, h) {
  const a = new Float32Array(w * h), n = poly.length;
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % n];
      if ((ay <= yc) !== (by <= yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); x++) a[y * w + x] = 1;
  }
  return a;
}

/** 4-connected components of a boolean array (1 = in) -> {lab: Int32Array (0 = none), sizes: [_, n1, n2, ...]}. */
export function components(b, w, h) {
  const lab = new Int32Array(w * h), sizes = [0], st = [];
  for (let s = 0; s < w * h; s++) {
    if (!b[s] || lab[s]) continue;
    const id = sizes.length; let n = 0;
    lab[s] = id; st.push(s);
    while (st.length) {
      const i = st.pop(); n++;
      const x = i % w, y = (i - x) / w;
      if (x > 0 && b[i - 1] && !lab[i - 1]) { lab[i - 1] = id; st.push(i - 1); }
      if (x < w - 1 && b[i + 1] && !lab[i + 1]) { lab[i + 1] = id; st.push(i + 1); }
      if (y > 0 && b[i - w] && !lab[i - w]) { lab[i - w] = id; st.push(i - w); }
      if (y < h - 1 && b[i + w] && !lab[i + w]) { lab[i + w] = id; st.push(i + w); }
    }
    sizes.push(n);
  }
  return { lab, sizes };
}

/**
 * The part a loop circles. poly: the closed loop (mask px). em: snap.js edgeMap of the frame at MASK resolution (em.w === w,
 * or null: no picture -> the loop's own interior). others: the other groups' masks (never covered). radius: the brush radius
 * in mask px; margin: the paint margin setting 0..1 (snap.js marginFor, as every aid). -> {mask {w, h, a}, grew (px added past the loop), shrank (px of the loop
 * dropped), mode: 'picture' | 'flat' | 'loop', ms}. raster (0/1, w x h): start from this region instead of a loop (grow to fill: a group's own mask, grown by `travel`).
 */
export function fillLoop(poly, w, h, em, { others = [], radius = 8, travel = TRAVEL, margin: setting = MARGIN_DEFAULT / 100, raster = null } = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0, n = w * h;
  const raw = raster || rasterLoop(poly, w, h);
  let area = 0;
  for (let i = 0; i < n; i++) area += raw[i];
  const R = Math.sqrt(Math.max(1, area) / Math.PI);
  const s0 = boxBlur(signedDistance(raw, w, h), w, h, 1, 2);   // the loop's own smoothed interior
  const blocked = (i) => others.some((o) => o && o.a[i] >= 0.5);
  let region = new Uint8Array(n), mode = 'loop', grew = 0, shrank = 0;
  for (let i = 0; i < n; i++) region[i] = s0[i] < 0 && !blocked(i) ? 1 : 0;
  if (em && em.w === w && em.h === h && area > 20) {
    const P = lab(em, w, h), core = [], ring = [], lo = Math.max(2, 0.35 * R), reachPx = travel * R;
    for (let i = 0; i < n; i++) {
      if (s0[i] < -lo) core.push(i);
      else if (s0[i] > reachPx && s0[i] < reachPx + Math.max(4, 0.4 * R) && !blocked(i)) ring.push(i);   // beyond the farthest growth: the part cannot reach it
    }
    const sin = stats(P, core.length >= 8 ? core : region.reduce((a, v, i) => (v ? (a.push(i), a) : a), []));
    // what outside looks like: the ring's pixels that do NOT look like inside (a ring that is all inside-coloured says nothing)
    const rout = ring.filter((i) => dist(P, i, sin) > INSIDE_SIGMA);
    const sout = rout.length >= 8 && rout.length >= 0.15 * ring.length ? stats(P, rout) : null;
    const sep = sout ? Math.sqrt([0, 1, 2].reduce((acc, k) => acc + ((sin.m[k] - sout.m[k]) / Math.sqrt((sin.s[k] ** 2 + sout.s[k] ** 2) / 2)) ** 2, 0) / 3) : 0;
    if (sout && sep >= SEP_MIN) {
      mode = 'picture';
      const ein = core.map((i) => em.e[i]).sort((a, b) => a - b), block = Math.max(EDGE_BLOCK_MIN, 3 * (ein[ein.length >> 1] || 0));
      const like = (i) => { const di = dist(P, i, sin); return di <= INSIDE_SIGMA && di <= 1.15 * dist(P, i, sout) && !blocked(i); };
      // candidates: look like inside, within the travel of the loop, not on a strong edge (edges stop growth OUTSIDE the loop;
      // inside the loop an edge pixel that looks like inside stays: the part's own texture)
      const cand = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (s0[i] > reachPx) continue;
        if (!like(i)) continue;
        if (s0[i] > 0 && em.e[i] > block) continue;
        cand[i] = 1;
      }
      const { lab: cl, sizes } = components(cand, w, h), score = new Float64Array(sizes.length);
      for (let i = 0; i < n; i++) if (cl[i] && s0[i] < -lo * 0.5) score[cl[i]]++;   // the component holding most of the loop's core
      let best = 0;
      for (let k = 1; k < sizes.length; k++) if (score[k] > score[best]) best = k;
      if (best) {
        const next = new Uint8Array(n);
        for (let i = 0; i < n; i++) next[i] = cl[i] === best ? 1 : 0;
        region = fillHoles(next, w, h, HOLE_FRAC);
        for (let i = 0; i < n; i++) { if (region[i] && !(s0[i] < 0)) grew++; if (!region[i] && s0[i] < 0) shrank++; }
      }
    } else mode = 'flat';   // inside and outside look the same (or no outside to compare): the loop's own interior
  }
  // one smooth blob: signed distance of the region, regularised and pulled inside the edge, never into another group
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = region[i] ? 1 : 0;
  let s1 = boxBlur(signedDistance(f, w, h), w, h, Math.max(1, Math.round(0.05 * R)), 2);
  if (mode === 'picture' && em) {
    const reach = Math.max(1, REACH_FRAC * R), edge = (x, y) => em.e[clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1)];
    const { T } = snapDisplacement(s1, w, h, edge, reach);
    for (let i = 0; i < n; i++) s1[i] -= T[i];
  }
  const s2 = insetOutline(s1, w, h, setting > 0 ? marginFor(s1, setting) : 0), out = new Float32Array(n), bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const c = blocked(i) ? 0 : clamp(0.5 - s2[i], 0, 1); out[i] = c; bin[i] = c >= 0.5 ? 1 : 0; }
  const { lab: cl, sizes } = components(bin, w, h);   // one connected component: the biggest
  let big = 0;
  for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[big]) big = k;
  for (let i = 0; i < n; i++) if (out[i] > 0 && !(cl[i] === big || (!cl[i] && touches(cl, i, w, h, big)))) out[i] = 0;
  return { mask: { w, h, a: out }, grew, shrank, mode, ms: typeof performance !== 'undefined' ? +(performance.now() - t0).toFixed(1) : 0 };
}
const touches = (cl, i, w, h, id) => { const x = i % w, y = (i - x) / w; return (x > 0 && cl[i - 1] === id) || (x < w - 1 && cl[i + 1] === id) || (y > 0 && cl[i - w] === id) || (y < h - 1 && cl[i + w] === id); };

/** Holes (background not connected to the border) up to `frac` of the region's area are filled. -> a new Uint8Array. */
export function fillHoles(reg, w, h, frac) {
  let area = 0;
  for (let i = 0; i < reg.length; i++) area += reg[i];
  const bg = new Uint8Array(w * h);
  for (let i = 0; i < bg.length; i++) bg[i] = reg[i] ? 0 : 1;
  const { lab, sizes } = components(bg, w, h), edge = new Set();
  for (let x = 0; x < w; x++) { edge.add(lab[x]); edge.add(lab[(h - 1) * w + x]); }
  for (let y = 0; y < h; y++) { edge.add(lab[y * w]); edge.add(lab[y * w + w - 1]); }
  const out = Uint8Array.from(reg);
  for (let i = 0; i < out.length; i++) if (!reg[i] && !edge.has(lab[i]) && sizes[lab[i]] <= frac * area) out[i] = 1;
  return out;
}

/** The loop's blob against the group's existing mask: it REPLACES it when it overlaps most of it (>= 50 % of the old shape),
 *  else it is ADDED (per-pixel max). -> {a (a new Float32Array), replaced}. */
export function mergeFill(old, neu) {
  if (!old) return { a: neu.a.slice(), replaced: false };
  let inter = 0, o = 0;
  for (let i = 0; i < old.a.length; i++) if (old.a[i] >= 0.5) { o++; if (neu.a[i] >= 0.5) inter++; }
  if (o && inter / o >= 0.5) return { a: neu.a.slice(), replaced: true };
  return { a: neu.a.map((v, i) => Math.max(v, old.a[i])), replaced: false };
}
