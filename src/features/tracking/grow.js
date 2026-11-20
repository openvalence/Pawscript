// grow.js -- the Groups "grow" brush (paw-liwk; pure): strokes become SAM prompts, SAM's multi-mask answer becomes one soft blob.
//   dab / scribble          -> positive points sampled along the stroke
//   erase dab (Shift)       -> negative points (only on a group SAM made: SAM needs a positive to start from)
//   circle-to-fill loop (W) -> the loop's box + points inside it
// The sidecar's `segment` returns SAM's masks smallest first (PROTOCOL v4.25); pickMask takes the candidate that fits the
// gesture (every positive inside; the "part" level rather than a sub-part for a dab; the one whose extent matches a long stroke's),
// and refuses one that swallowed the picture or the previous mask. The others stay in hand for stepping (paw-k8jj). softBlob then finishes it like
// every other outline: smoothed, a hair inside, never into another group. The hand-painted groups are never touched by this
// module: only strokes made while grow is on come here.
import { signedDistance, boxBlur, insetOutline, marginFor, edt, MARGIN_DEFAULT } from './snap.js';
import { rasterLoop, components, fillHoles } from './fill.js';

export const MAX_POINTS = 6;        // prompts sampled from one stroke
export const SPACING = 1.2;         // sampled points are at least this x the brush radius apart (a scribble gives a few, a dab one)
export const LOOP_POINTS = 5;       // points inside a circled loop, besides its box
export const ABSURD_IMAGE = 0.5;    // a candidate covering more than this share of the picture swallowed the scene
export const ABSURD_PREV = 12;      // ... or more than this x the mask it refines (a refinement dab that makes the part twelve times bigger took the body)
export const LEVEL_MAX = 10;        // a dab walks up to the next larger candidate while it is at most this x the current one (measured on generated shaded parts, SAM tiny: the smallest held a quarter of the part, the middle level 0.9 of it, the largest the part; the level-to-level ratio is 1.4 .. 12 when the largest is the part and up to 70 when it swallowed the scene)
export const SCORE_FLOOR = 0.05;    // ... and SAM's own predicted quality of that candidate is at least this (its score FAVOURS the small ones: median 0.66 / 0.52 / 0.28 on parts where the largest was the right one: no use as a ranking)
export const EXTENT_PAD = 1.15;     // a candidate's bounding diagonal is expected this x the stroke's (a mask reaches a bit past the marks)
export const EXTENT_SCORE = 0.5;    // weight of SAM's score against the extent mismatch (a log ratio) when a long stroke picks
export const BOX_MIN = 6;           // a scribble whose bounding diagonal is at least this x the brush radius has an extent (picks the candidate that matches it)
export const HOLE_FRAC = 0.08;      // holes up to this share of SAM's mask are filled (its eyes, a gap between fingers are not parts)
export const SMOOTH_FRAC = 0.12;    // the boundary is smoothed over this x the mask's equivalent radius (>= 1, <= SMOOTH_MAX px): the staircase and SAM's ragged fringe go, the shape stays
export const SMOOTH_MAX = 6;
export const PIECE_FRAC = 0.05;     // a dropped piece larger than this share of the kept one is worth a toast
export const HIT = 0.5;             // a prompt point is held by a mask where its coverage is at least this
// paw-yx6q: "sometimes the smooth blob on the limb, other times very aggressive with little arms that reach everywhere". SAM's larger
// levels take in similar-coloured thin things touching the part (straps, strands, a crossing limb's edge); the dab took the largest
// level whenever it was under LEVEL_MAX x the one below. Measured on generated limbs through SAM 2.1 tiny (RESULTS in the commit).
export const OPEN_FRAC = 0.2;       // arms: what an opening by this x the blob's width (snap.js partWidth) takes away
export const ARM_MIN = 0.03;        // a level has arms when the opening takes at least this share of it ...
export const REACH_MIN = 1;         // ... out to at least this many blob widths from what is left (ears, fingers, a ragged edge reach less)
/** openArms' verdict: arms that reach out (a dab steps back down from such a level). */
export const hasArms = (r) => r.arm >= ARM_MIN && r.reach >= REACH_MIN;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Mask (>= 0.5 = in) opened by a disc of OPEN_FRAC x its width: its thin protrusions go. -> {o: Uint8Array (0 / 1, never outside
 *  the mask), arm: the share of the mask's px the opening took, reach: how far the farthest of them lies from what is left, in blob widths} */
export function openArms(a, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  for (let i = 0; i < w * h; i++) if (a[i] >= 0.5) { n++; const x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const o = new Uint8Array(w * h);
  if (!n) return { o, arm: 0, reach: 0 };
  // on the mask's box (+ 2 px) only: one distance transform each way (a few x cheaper than two signed distances over the frame)
  const X0 = Math.max(0, x0 - 2), Y0 = Math.max(0, y0 - 2), cw = Math.min(w, x1 + 3) - X0, ch = Math.min(h, y1 + 3) - Y0, BIG = 1e8;
  const fi = new Float64Array(cw * ch), fo = new Float64Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) fi[y * cw + x] = a[(y + Y0) * w + x + X0] >= 0.5 ? BIG : 0;
  edt(fi, cw, ch);   // squared distance of an inside px to the outside
  let depth = 0;
  for (let j = 0; j < cw * ch; j++) if (fi[j]) depth += Math.sqrt(fi[j]) - 0.5;
  const r = Math.max(1, OPEN_FRAC * ((4 * depth) / n)), r2 = (r + 0.5) ** 2;   // partWidth: 4 x the mean depth
  for (let j = 0; j < cw * ch; j++) fo[j] = fi[j] > r2 ? 0 : BIG;   // eroded by r
  edt(fo, cw, ch);
  let kept = 0, far = 0;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const j = y * cw + x;
    if (!fi[j]) continue;
    const d = Math.sqrt(fo[j]) - 0.5 - r;   // how far outside the opened core (< 0: in it)
    if (d < 0) { o[(y + Y0) * w + x + X0] = 1; kept++; } else if (d > far) far = d;
  }
  return { o, arm: 1 - kept / n, reach: far / Math.max(1, (4 * depth) / n) };   // reach: the farthest thin bit from the core, in blob widths
}

/** Points sampled along a stroke (mask px polyline [[x, y], ...]): spread evenly by arc length over the WHOLE stroke, first and
 *  last included, at least SPACING x radius apart, at most MAX_POINTS. A dab is its first point. */
export function strokePoints(pts, radius) {
  if (!pts?.length) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const len = cum[cum.length - 1], n = clamp(Math.floor(len / (SPACING * radius)) + 1, 1, MAX_POINTS);
  if (n === 1) return [pts[0]];
  const out = [];
  for (let k = 0, i = 0; k < n; k++) {
    const t = (k / (n - 1)) * len;
    while (i < pts.length - 1 && cum[i + 1] < t) i++;
    out.push(pts[i]);   // the sampled vertex just before arc length t
  }
  out[n - 1] = pts[pts.length - 1];   // the stroke's end
  return out;
}

/** A long stroke's extent: the diagonal of its bounding box in mask px once it is at least BOX_MIN x radius, else 0 (a dab, a short scribble). It picks the candidate whose extent matches; it is NOT sent to SAM as a box: a scribble runs along the middle of a part, its padded box is a strip, and SAM clipped to it (generated parts, one best mask from 5 points: IoU 0.94 without the box, 0.58 with it). */
export function strokeExtent(pts, radius) {
  if (!pts?.length) return 0;
  const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1])), diag = Math.hypot(x1 - x0, y1 - y0);
  return diag >= BOX_MIN * radius ? diag : 0;
}

/** A closed loop (mask px polygon) -> {box: [x0, y0, x1, y1], points: up to LOOP_POINTS well inside it (the centre, then the
 *  deepest pixels farthest from each other)} in mask px. */
export function loopPrompt(poly, w, h) {
  const x0 = Math.min(...poly.map((p) => p[0])), x1 = Math.max(...poly.map((p) => p[0])), y0 = Math.min(...poly.map((p) => p[1])), y1 = Math.max(...poly.map((p) => p[1]));
  const raw = rasterLoop(poly, w, h), s = signedDistance(raw, w, h), deep = [];
  let best = 0;
  for (let i = 0; i < w * h; i++) if (s[i] < best) best = s[i];
  for (let i = 0; i < w * h; i++) if (s[i] <= 0.5 * best) deep.push(i);
  const pts = [];
  const at = (i) => [(i % w) + 0.5, ((i / w) | 0) + 0.5];
  if (deep.length) {
    let c = deep[0], bd = Infinity;
    const cx = deep.reduce((a, i) => a + (i % w), 0) / deep.length, cy = deep.reduce((a, i) => a + ((i / w) | 0), 0) / deep.length;
    for (const i of deep) { const d = Math.hypot((i % w) - cx, ((i / w) | 0) - cy); if (d < bd) { bd = d; c = i; } }
    pts.push(at(c));
    while (pts.length < LOOP_POINTS) {   // farthest-point picks among the deep pixels
      let far = -1, fd = 0;
      for (let k = 0; k < deep.length; k += Math.max(1, deep.length >> 9)) { const p = at(deep[k]), d = Math.min(...pts.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))); if (d > fd) { fd = d; far = deep[k]; } }
      if (far < 0 || fd < 2) break;
      pts.push(at(far));
    }
  }
  return { box: [clamp(x0, 0, w), clamp(y0, 0, h), clamp(x1, 0, w), clamp(y1, 0, h)], points: pts };
}

/** The sidecar request's prompt fields from mask-px prompts (the app sends 0..1 of the frame). */
export const toFrac = (pts, w, h) => pts.map(([x, y]) => [+(x / w).toFixed(5), +(y / h).toFixed(5)]);

/**
 * SAM's masks (smallest first; each {a: Float32Array w x h 0..1, score}) -> the candidate that fits the gesture.
 * pos: positive points (mask px). ctx: {extent: the diagonal of a long stroke / loop box in mask px (0: a dab), prev: the px of the
 * mask being refined (0: none)}. Only candidates holding every positive point are considered (none holds all: the ones holding
 * the most). A dab walks UP from the smallest while the next candidate is at most LEVEL_MAX x larger and scored at least
 * SCORE_FLOOR: "hesitant to grow" was the smallest candidate being a sub-part. A long stroke picks the candidate whose bounding
 * diagonal matches it best (SAM's score weighs in). A candidate over ABSURD_IMAGE of the picture or ABSURD_PREV x the previous
 * mask is out; none left: 'large'. The rest stay in play: the loosen / tighten dial walks them.
 * -> {index, why: '' | 'none' | 'large', held, area, steps: the candidate indices in play, smallest first, at: the pick's place in steps}
 */
export function pickMask(masks, pos, w, h, { extent = 0, prev = 0, arms = false } = {}) {
  const info = masks.map((m, i) => {
    let held = 0, px = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (const [x, y] of pos) if (m.a[clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1)] >= HIT) held++;
    for (let j = 0; j < m.a.length; j++) if (m.a[j] >= HIT) { px++; const x = j % w, y = (j - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { i, held, px, score: m.score ?? 0, diag: px ? Math.hypot(x1 - x0 + 1, y1 - y0 + 1) : 0 };
  });
  const most = Math.max(0, ...info.map((c) => c.held));
  const holders = info.filter((c) => c.held === most && most > 0 && c.px > 0);
  if (!holders.length) return { index: -1, why: 'none', held: 0, area: 0, steps: [], at: 0 };
  const cap = Math.min(ABSURD_IMAGE * w * h, prev ? ABSURD_PREV * prev : Infinity), fit = holders.filter((c) => c.px <= cap);
  if (!fit.length) return { index: holders[0].i, why: 'large', held: most, area: holders[0].px, steps: [], at: 0 };
  let s = 0;
  if (extent && fit.length > 1) {
    const cost = (c) => Math.abs(Math.log(c.diag / (EXTENT_PAD * extent))) - EXTENT_SCORE * c.score;
    for (let k = 1; k < fit.length; k++) if (cost(fit[k]) < cost(fit[s])) s = k;
  } else {
    while (s + 1 < fit.length && fit[s + 1].px <= LEVEL_MAX * fit[s].px && fit[s + 1].score >= SCORE_FLOOR) s++;
    // paw-yx6q (the app's dab; Suggest's seedsam.walk_up has no such step): back down from a level with arms that reach out
    if (arms) while (s > 0 && hasArms(openArms(masks[fit[s].i].a, w, h))) s--;
  }
  return { index: fit[s].i, why: '', held: most, area: fit[s].px, steps: fit.map((c) => c.i), at: s };
}

/** One connected component of a 0/1 mask: the one holding the most prompt points (ties and none: the largest). -> {b (Uint8Array), dropped: pieces of the others, far: a dropped piece holds a prompt or is >= PIECE_FRAC of the kept one}. */
function keepOne(b, w, h, pos) {
  const { lab, sizes } = components(b, w, h), n = sizes.length, held = new Array(n).fill(0);
  for (const [x, y] of pos) { const id = lab[clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1)]; if (id) held[id]++; }
  let best = 0;
  for (let k = 1; k < n; k++) if (!best || held[k] > held[best] || (held[k] === held[best] && sizes[k] > sizes[best])) best = k;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = best && lab[i] === best ? 1 : 0;
  let far = false;
  for (let k = 1; k < n; k++) if (k !== best && (held[k] > 0 || sizes[k] >= PIECE_FRAC * sizes[best])) far = true;
  return { b: out, far, dropped: n - 2 };
}

/**
 * SAM's mask (coverage, w x h) -> the group's blob: ONE connected component (the one holding the prompts; far: the prompts sat in
 * two pieces, or a big piece was dropped), holes under HOLE_FRAC filled, specks gone, the boundary smoothed (signed distance blurred
 * over SMOOTH_FRAC of the radius, the magnet's own fields), the paint margin inside (insetOutline), one component again, never into another
 * group. The same path cleans every refinement (more dabs, a negative dab), so it never flickers between ragged and smooth.
 * -> {a: Float32Array w x h, far}.
 */
export function cleanMask(a, w, h, pos, { others = [], margin: setting = MARGIN_DEFAULT / 100, arms = false, stroke = null } = {}) {
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bin[i] = a[i] >= 0.5 ? 1 : 0;
  const one = keepOne(bin, w, h, pos);
  let filled = fillHoles(one.b, w, h, HOLE_FRAC);
  if (arms) {   // paw-yx6q: arms that reach out go (an opening at the blob's own width), then the piece holding the prompts; ears / fingers stay
    const op = openArms(filled, w, h), o = hasArms(op) ? keepOne(op.o, w, h, pos).b : null;
    if (o?.some((v) => v)) filled = o;
  }
  const f = new Float32Array(w * h);
  let px = 0;
  for (let i = 0; i < w * h; i++) { f[i] = filled[i]; px += filled[i]; }
  if (!px) return { a: f, far: one.far };
  const r = clamp(Math.round(SMOOTH_FRAC * Math.sqrt(px / Math.PI)), 1, SMOOTH_MAX);
  const s1 = areaKeep(boxBlur(signedDistance(f, w, h), w, h, r, 2), px, r), s2 = insetOutline(s1, w, h, setting > 0 ? marginFor(s1, setting) : 0), cov = new Float32Array(w * h), b2 = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { cov[i] = others.some((o) => o && o.a[i] >= 0.5) ? 0 : clamp(0.5 - s2[i], 0, 1); b2[i] = cov[i] >= 0.5 ? 1 : 0; }
  const two = keepOne(b2, w, h, pos), out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = two.b[i] || (cov[i] > 0 && cov[i] < 0.5 && nearKept(two.b, i, w, h)) ? cov[i] : 0;   // the soft rim of the kept piece stays
  if (stroke) for (let i = 0; i < w * h; i++) if (stroke[i] > out[i] && !others.some((o) => o && o.a[i] >= 0.5)) out[i] = stroke[i];   // paw-yx6q: the painted stroke is always kept
  return { a: out, far: one.far };
}
/** The smoothed signed distance shifted so its inside (< 0) keeps the cleaned mask's area `px`: the blur rounds the fringe, it must not shrink the part (the shift is at most r px). */
export function areaKeep(s1, px, r) {
  const sorted = Float32Array.from(s1).sort(), L = sorted[Math.min(px, sorted.length - 1)];
  let lo = 0, hi = sorted.length;   // ties (a flat edge has hundreds of equal values): the level that leaves the CLOSEST count inside (<= L: all the ties, < L: none of them)
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < L) lo = mid + 1; else hi = mid; }
  let le = lo;
  while (le < sorted.length && sorted[le] <= L) le++;
  const cut = clamp(px - lo < le - px ? L - 1e-4 : L, -r, r);
  return s1.map((v) => v - cut);
}
const nearKept = (b, i, w, h) => { const x = i % w, y = (i - x) / w; return (x > 0 && b[i - 1]) || (x < w - 1 && b[i + 1]) || (y > 0 && b[i - w]) || (y < h - 1 && b[i + w]); };

/** cleanMask's blob only (no prompts: the largest piece). */
export const softBlob = (a, w, h, o = {}) => cleanMask(a, w, h, o.pos || [], o).a;

/** Nearest-neighbour resample of a w x h mask to nw x nh (the sidecar's mask size and the app's can differ by a pixel). */
export function resizeMask(a, w, h, nw, nh) {
  if (w === nw && h === nh) return a;
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) out[y * nw + x] = a[Math.min(h - 1, Math.floor(((y + 0.5) * h) / nh)) * w + Math.min(w - 1, Math.floor(((x + 0.5) * w) / nw))];
  return out;
}

/** Latest-wins tokens: `next()` issues one and voids the older; `ok(t)` is whether t is still the latest (a late answer is dropped). */
export function latest() {
  let n = 0;
  return { next: () => ++n, ok: (t) => t === n, void: () => { n++; } };
}
