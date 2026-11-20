// crop-match.js -- "the same footage re-framed" (paw-3uyu), pure. Shot B is a crop / zoom of shot A when one of B's
// frames is found inside one of A's under a scale (1 .. MAX_SCALE) and a translation: zero-mean normalised
// cross-correlation of small grey prints, coarse to fine (a 3-level pyramid: every scale and offset at the coarsest,
// the best few refined). Frame SETS, not first vs last: animation loops, so the best pair of any sampled frames counts.
// A print = {w, h, d: Float32Array (luma 0..1, row major)} (grey(), from RGBA). mask (optional, everywhere): {w, h, d:
// Uint8Array | boolean[]} a low-resolution grid over the picture in normalised coordinates, true = ignore (a logo, a
// caption: they sit at the same screen place in both shots and are no evidence); null = every pixel counts.
// Cost (one direction, one frame pair, 128 x 72 prints): ~0.6 M multiply-adds at the coarsest level, ~0.4 M to refine.
// ponytail: no mirrored flips (none found on the owner's footage, see experiments/cropscene/RESULTS.md); add a flipped
// B to matchFrames if one shows up.

export const PRINT_W = 128;
/** A crop link: matchShots score >= score with a scale >= SAME_SCALE, between shots at most `gap` apart (the owner's
 *  projects and case, experiments/cropscene/RESULTS.md). */
export const CROP_MATCH = { score: 0.93, gap: 3 };
export const MAX_SCALE = 3;
/** A crop this close to 1 is the same framing ('same'), not a crop. */
export const SAME_SCALE = 1.08;

/** RGBA bytes of a w x h picture -> a print (luma 0..1). */
export function grey(rgba, w, h) {
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = (0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2]) / 255;
  return { w, h, d };
}
/** The print size for a video of vw x vh: PRINT_W wide, the aspect kept. */
export const printSize = (vw, vh, w = PRINT_W) => ({ w, h: Math.max(8, Math.round((w * (vh || 9)) / (vw || 16))) });

/** p resized to nw x nh by area averaging (nw <= p.w, nh <= p.h). */
export function resize(p, nw, nh) {
  if (nw === p.w && nh === p.h) return p;
  const d = new Float32Array(nw * nh), fx = p.w / nw, fy = p.h / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = y * fy, y1 = y0 + fy;
    for (let x = 0; x < nw; x++) {
      const x0 = x * fx, x1 = x0 + fx;
      let s = 0, a = 0;
      for (let sy = Math.floor(y0); sy < Math.min(p.h, Math.ceil(y1)); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.min(p.w, Math.ceil(x1)); sx++) {
          const wgt = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          s += wgt * p.d[sy * p.w + sx]; a += wgt;
        }
      }
      d[y * nw + x] = a ? s / a : 0;
    }
  }
  return { w: nw, h: nh, d };
}
/** The mask sampled at a w x h pixel grid (pixel centres), as Uint8Array (1 = ignore), or null. */
export function maskAt(mask, w, h) {
  if (!mask) return null;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const my = Math.min(mask.h - 1, Math.floor(((y + 0.5) / h) * mask.h));
    for (let x = 0; x < w; x++) out[y * w + x] = mask.d[my * mask.w + Math.min(mask.w - 1, Math.floor(((x + 0.5) / w) * mask.w))] ? 1 : 0;
  }
  return out;
}
/** paw-o60v.1: a decoded picture f (a VideoFrame, closed here when `close`; an ImageBitmap / canvas) -> {rgba16 (its 16 x 16
 *  RGBA, scenes-continue.js grey16's input), pyr (the pyramid of its w x h print)}: what tracking's shot-link scan reads of a
 *  frame, drawn with OffscreenCanvas (a Worker can run it). */
export function framePrint(f, w, h, close = false) {
  try {
    const g = new OffscreenCanvas(16, 16).getContext('2d', { willReadFrequently: true });
    g.drawImage(f, 0, 0, 16, 16);
    const gb = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    gb.imageSmoothingQuality = 'high'; gb.drawImage(f, 0, 0, w, h);
    return { rgba16: g.getImageData(0, 0, 16, 16).data, pyr: pyramid(grey(gb.getImageData(0, 0, w, h).data, w, h)) };
  } finally { if (close) f.close?.(); }
}
/** [full, half, quarter] of a print. */
export function pyramid(p) {
  const h1 = resize(p, Math.round(p.w / 2), Math.round(p.h / 2));
  return [p, h1, resize(h1, Math.round(h1.w / 2), Math.round(h1.h / 2))];
}

/** Zero-mean NCC of b (bw x bh) against a's window at (ox, oy), over pixels neither mask ignores. -> -1..1 (0 when
 *  either side is flat or fewer than half the pixels count). */
function ncc(a, ma, b, mb, ox, oy, flat = 4e-4) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const bw = b.w, bh = b.h, aw = a.w, ad = a.d, bd = b.d;
  for (let v = 0; v < bh; v++) {
    const ar = (oy + v) * aw + ox, br = v * bw;
    for (let u = 0; u < bw; u++) {
      if ((ma && ma[ar + u]) || (mb && mb[br + u])) continue;
      const x = ad[ar + u], y = bd[br + u];
      n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
    }
  }
  if (n < (bw * bh) / 2) return 0;
  const va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  if (va / n < flat || vb / n < flat) return 0;   // flat (std < 0.02): a blank says nothing
  return (sab - (sa * sb) / n) / Math.sqrt(va * vb);
}

/** b (a whole frame) scaled down to bw wide (its aspect kept) and its mask. */
function scaled(b, bw, mask) {
  const bh = Math.max(2, Math.round((bw * b.h) / b.w)), r = resize(b, bw, bh);
  return { r, m: maskAt(mask, bw, bh) };
}
/** Best offset of b scaled to bw wide inside a, offsets within [x0, x1] x [y0, y1] (clamped). -> {score, bw, x, y}
 *  paw-0zwb: a and b may be lists of frames of one size (pairs a[k] / b[k]): the score is then their mean NCC, one offset
 *  for all of them (a shared transform). */
function scan(a, ma, b, bw, mask, x0 = 0, x1 = Infinity, y0 = 0, y1 = Infinity) {
  const As = Array.isArray(a) ? a : [a], Bs = (Array.isArray(b) ? b : [b]).map((q) => scaled(q, bw, mask)), A0 = As[0], R0 = Bs[0].r;
  let best = { score: -2, bw, x: 0, y: 0 };
  for (let y = Math.max(0, y0); y <= Math.min(A0.h - R0.h, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(A0.w - R0.w, x1); x++) {
    let s = 0;
    for (let k = 0; k < As.length; k++) s += ncc(As[k], ma, Bs[k].r, Bs[k].m, x, y);
    s /= As.length;
    if (s > best.score) best = { score: s, bw, x, y };
  }
  return best;
}

/**
 * Coarse search of frame b inside frame a at the quarter level: every width from a.w / maxScale to a.w, every offset.
 * -> candidates [{score, bw, x, y}] (quarter-level pixels), the best `keep`.
 */
export function coarse(A, B, { mask = null, maxScale = MAX_SCALE, keep = 3 } = {}) {
  const a = A[2], b = B[2], ma = maskAt(mask, a.w, a.h), out = [];
  for (let bw = a.w; bw >= Math.max(4, Math.floor(a.w / maxScale)); bw--) out.push(scan(a, ma, b, bw, mask));
  return out.sort((p, q) => q.score - p.score).slice(0, keep);
}
/** Refine a quarter-level candidate c to the full level. -> {score, scale, x, y (offset of b's frame in a, 0..1 of a's
 *  width / height), w (b's window width in a, 0..1)} */
export function refine(A, B, c, o = {}) { return refineSet([A], [B], c, o); }
/** paw-0zwb: refine with ONE transform shared by several frame pairs (As[k] holds Bs[k]; pyramids of one size): the mean
 *  NCC decides. -> refine's result. */
export function refineSet(As, Bs, c, { mask = null, maxScale = MAX_SCALE } = {}) {
  let cur = c;
  for (const lv of [1, 0]) {
    const as = As.map((A) => A[lv]), bs = Bs.map((B) => B[lv]), a = as[0], ma = maskAt(mask, a.w, a.h), k = As[0][lv + 1].w ? a.w / As[0][lv + 1].w : 2;
    const bw0 = Math.round(cur.bw * k), x0 = Math.round(cur.x * k), y0 = Math.round(cur.y * k);
    let best = { score: -2 };
    for (let bw = Math.max(4, Math.ceil(a.w / maxScale), bw0 - 2); bw <= Math.min(a.w, bw0 + 2); bw++) {
      const s = scan(as, ma, bs, bw, mask, x0 - 2, x0 + 2, y0 - 2, y0 + 2);
      if (s.score > best.score) best = s;
    }
    cur = best;
  }
  const a = As[0][0];
  return { score: cur.score, scale: a.w / cur.bw, x: cur.x / a.w, y: cur.y / a.h, w: cur.bw / a.w };
}
/** Frame b found inside frame a (b the tighter framing). Pyramids in. -> refine's result. */
export function matchFrames(A, B, o = {}) {
  let best = null;
  for (const c of coarse(A, B, o)) { const r = refine(A, B, c, o); if (!best || r.score > best.score) best = r; }
  return best;
}

/**
 * Shot vs shot: sets of pyramids (a few frames of each). Coarse over every frame pair, both directions; the best
 * `refineTop` refined. -> {score, scale, x, y, w, tighter: 'a' | 'b' | 'same', fa, fb (the frame indices)} | null.
 */
export function matchShots(FA, FB, { mask = null, maxScale = MAX_SCALE, refineTop = 3 } = {}) {
  if (!FA?.length || !FB?.length) return null;
  const cand = [];
  for (let i = 0; i < FA.length; i++) for (let j = 0; j < FB.length; j++) {
    for (const c of coarse(FA[i], FB[j], { mask, maxScale, keep: 2 })) cand.push({ c, i, j, inA: true });
    for (const c of coarse(FB[j], FA[i], { mask, maxScale, keep: 2 })) cand.push({ c, i, j, inA: false });
  }
  cand.sort((p, q) => q.c.score - p.c.score);
  let best = null;
  for (const k of cand.slice(0, refineTop)) {
    const r = k.inA ? refine(FA[k.i], FB[k.j], k.c, { mask, maxScale }) : refine(FB[k.j], FA[k.i], k.c, { mask, maxScale });
    if (!best || r.score > best.score) best = { ...r, tighter: r.scale < SAME_SCALE ? 'same' : k.inA ? 'b' : 'a', fa: k.i, fb: k.j };
  }
  return best;
}

/** One frame pair under a known geometry m (matchShots' result; b inside a when m.tighter !== 'a'). -> NCC. */
export function scoreAt(A, B, m, { mask = null } = {}) {
  const [outer, inner] = m.tighter === 'a' ? [B[0], A[0]] : [A[0], B[0]];
  const bw = Math.round(m.w * outer.w), { r, m: mb } = scaled(inner, bw, mask);
  const x = Math.round(m.x * outer.w), y = Math.round(m.y * outer.h);
  return x + r.w <= outer.w && y + r.h <= outer.h ? ncc(outer, maskAt(mask, outer.w, outer.h), r, mb, x, y) : 0;
}

/**
 * The loop correspondence across a crop: loop A's frames over one period (one pyramid per frame, pa of them), loop B's
 * likewise (pb), the geometry m (matchShots, A = shot a). Every phase shift (B's frame t ~ A's frame (t + shift) mod pa,
 * t over max(pa, pb) frames) scored by the mean NCC. The periods may differ by a whole factor: on the owner's clip the
 * crop's cycle is 18 frames where the wide shot's is 9 (the crop's two passes differ in a few pictures; see
 * experiments/cropscene/RESULTS.md). -> {shift (frames: B's first frame shows A's frame `shift`), score, runnerUp (the
 * next best shift's score), ratio (pb / pa when one divides the other, else null)} | null.
 */
export function loopPhase(PA, PB, m, o = {}) {
  const pa = PA?.length, pb = PB?.length;
  if (!pa || !pb) return null;
  const S = PB.map((B) => PA.map((A) => scoreAt(A, B, m, o))), n = Math.max(pa, pb), shifts = [];   // S[k][j] = B's k vs A's j
  for (let s = 0; s < pa; s++) { let t = 0; for (let k = 0; k < n; k++) t += S[k % pb][(k + s) % pa]; shifts.push(t / n); }
  const order = shifts.map((v, s) => [v, s]).sort((p, q) => q[0] - p[0]);
  return { shift: order[0][1], score: order[0][0], runnerUp: order[1]?.[0] ?? null, ratio: pb % pa === 0 || pa % pb === 0 ? pb / pa : null };
}

/** Shot A vs shot B as a crop link: matchShots' result when it is one (score >= CROP_MATCH.score, not the same
 *  framing), else null. */
export function cropLink(FA, FB, o = {}) {
  const m = matchShots(FA, FB, o);
  return m && m.tighter !== 'same' && m.score >= (o.score ?? CROP_MATCH.score) ? m : null;
}
/**
 * Every crop link between shots at most `gap` apart. frames[i] = shot i's pyramids ([] = none); key(i) names shot i
 * stably (its span) for `cache` (a Map kept across calls: a pair is matched once per video); `step` is awaited before
 * each new pair (the caller's pause / cancel: false stops). Cost ~25-50 ms a pair (4 frames each, 128 px), so a
 * 160-shot video takes ~15 s in the background, once. match(FA, FB, o): cropLink, or the same elsewhere (paw-o60v.1: in a
 * Worker; may return a promise). -> Map `${i}:${j}` (i < j) -> link, or null when stopped.
 */
export async function linkShots(frames, { gap = CROP_MATCH.gap, key = String, cache = new Map(), step = async () => true, match = cropLink, ...o } = {}) {
  const out = new Map();
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j <= Math.min(frames.length - 1, i + gap); j++) {
    const k = `${key(i)}|${key(j)}`;
    if (!cache.has(k)) { if (!(await step())) return null; cache.set(k, await match(frames[i], frames[j], o)); }
    if (cache.get(k)) out.set(`${i}:${j}`, cache.get(k));
  }
  return out;
}
/** The box a link puts the tighter shot's frame at inside the wider one's (0..1 of the wider frame; aspect kept). */
export const linkBox = (m) => ({ x: m.x, y: m.y, w: m.w, h: m.w });
/**
 * The loops a crop link joins: LA / LB = the loops inside shot a / b, each {key, frames: [pyramid per frame of one
 * period]}; each A loop paired with the B loop whose phase fits best, kept when its mean NCC >= minScore. -> [{a, b
 * (loop keys), periodA, periodB (frames), shift, ratio, score}].
 */
export function loopLinks(m, LA = [], LB = [], { minScore = CROP_MATCH.score - 0.05, ...o } = {}) {
  const out = [];
  for (const A of LA) {
    let best = null;
    for (const B of LB) { const p = loopPhase(A.frames, B.frames, m, o); if (p && (!best || p.score > best.p.score)) best = { B, p }; }
    if (best && best.p.score >= minScore) out.push({ a: A.key, b: best.B.key, periodA: A.frames.length, periodB: best.B.frames.length, shift: best.p.shift, ratio: best.p.ratio, score: best.p.score });
  }
  return out;
}

// ---- paw-0zwb: loops matched as whole cycles, anywhere in the video ----
// The owner's rule: "it checks against loops of the same framecount ONLY, then matches every frame of a single loop, then
// validates random frames for every other repeat". Two detected loops of the same period n (frames) are the same animation
// re-framed when ONE pass of each matches picture for picture under one scale + offset and one phase shift: n pictures of
// evidence instead of one. The geometry comes from the passes' MEAN pictures (a crop of the mean is the mean of the crop,
// whatever the phase), every shift is scored over all n pairs by their motion, the winner's transform is refined jointly over the cycle;
// then a few seeded random frames of every other pass of both loops must agree with their predicted counterparts.
// ponytail: same period only (no 2:1 / twos-vs-ones pairs: the neighbour-shot matcher still links those nearby).
/** score: the cycle's MOTION agreement (mean NCC of each frame minus its pass's mean picture: the background cancels);
 *  margin: over the next best shift; weak: below `strong` margin (the fill only offers it); frames: the pictures' own mean
 *  NCC at that shift; mean: the mean pictures' prune (and geometry); floor / agree: a spot check counts when its
 *  NCC >= floor, the link stands when >= agree of them do; perPass / cap: spot checks per later pass and overall;
 *  minFrames / maxFrames: the periods searched. Chosen on generated clips and the owner's video
 *  (experiments/cropscene/RESULTS.md). */
export const LOOP_MATCH = { score: 0.5, margin: 0.1, strong: 0.2, frames: 0.85, mean: 0.7, floor: 0.8, agree: 0.8, perPass: 2, cap: 16, minFrames: 4, maxFrames: 64 };

/** The mean picture of frames P (pyramids of one size), as a pyramid. */
export function meanPyramid(P) {
  const { w, h } = P[0][0], d = new Float32Array(w * h);
  for (const p of P) { const s = p[0].d; for (let i = 0; i < d.length; i++) d[i] += s[i]; }
  for (let i = 0; i < d.length; i++) d[i] /= P.length;
  return pyramid({ w, h, d });
}
/** S[k][j] = PB[k] vs PA[j] under geometry m (scoreAt's, A = the first loop): each tighter frame scaled once. */
export function scoreMatrix(PA, PB, m, { mask = null, flat } = {}) {
  const inA = m.tighter !== 'a', outers = (inA ? PA : PB).map((p) => p[0]), W = outers[0].w, H = outers[0].h;
  const bw = Math.round(m.w * W), x = Math.round(m.x * W), y = Math.round(m.y * H), mo = maskAt(mask, W, H);
  const inners = (inA ? PB : PA).map((p) => scaled(p[0], bw, mask));
  if (!inners.length || x + inners[0].r.w > W || y + inners[0].r.h > H) return PB.map(() => PA.map(() => 0));
  return PB.map((_, k) => PA.map((_, j) => (inA ? ncc(outers[j], mo, inners[k].r, inners[k].m, x, y, flat) : ncc(outers[k], mo, inners[j].r, inners[j].m, x, y, flat))));
}
/** The motion of a pass: each frame minus the pass's mean picture (level 0 only, scoreMatrix's input). The background
 *  cancels, so a wrong shift or another motion over the same picture scores low instead of ~0.95. */
const motionOf = (P, M) => P.map((p) => [{ w: p[0].w, h: p[0].h, d: Float32Array.from(p[0].d, (v, i) => v - M[0].d[i]) }]);
const MOTION_FLAT = 1e-6;   // a residual is small by nature: only an exactly still pass is flat
const SUB_TOL = 0.03;
/** Every phase shift s of two equal cycles (B's frame k shows A's frame (k + s) mod n), scored by the mean of the best
 *  `keep` share of its n pairs (one redrawn or flashed picture does not sink it). -> {shift, score, margin (over the next
 *  best shift not equivalent to it), sub (1, or 2 / 3: the motion comes round that often in the cycle), scores} */
export function cycleShift(S, keep = 0.8) {
  const n = S.length, scores = [];
  for (let s = 0; s < n; s++) {
    const v = S.map((row, k) => row[(k + s) % n]).sort((a, b) => b - a), m = Math.max(1, Math.round(n * keep));
    let t = 0; for (let q = 0; q < m; q++) t += v[q];
    scores.push(t / m);
  }
  let shift = 0; scores.forEach((v, s) => { if (v > scores[shift]) shift = s; });
  // a cycle whose motion comes round twice (or three times) in it, redrawn (the owner's 16-frame loops: the same 8-frame
  // motion twice): the shifts a half (third) apart are the same motion, not a rival
  let sub = 1;
  for (const d of [2, 3]) if (n % d === 0 && n / d >= 2 && Array.from({ length: d - 1 }, (_, m) => scores[(shift + ((m + 1) * n) / d) % n]).every((v) => v >= scores[shift] - SUB_TOL)) { sub = d; break; }
  // the margin is over shifts two or more frames away (from each equivalent one): one frame off is half right on twos
  const p = n / sub, far = scores.filter((_, s) => { const o = (((s - shift) % p) + p) % p; return Math.min(o, p - o) >= 2; }), second = Math.max(-1, ...far);
  return { shift, score: scores[shift], margin: far.length ? scores[shift] - second : 0, sub, scores };
}
/**
 * One pass of loop A vs one pass of loop B (PA, PB: pyramids of their n frames, the same n) as the same animation re-framed.
 * -> {score, margin, shift (B's first frame shows A's frame `shift`), scale, x, y, w, tighter 'a' | 'b', mean, n} | null
 * (other periods, flat, the same framing, or the mean pictures do not match).
 */
export function matchCycles(PA, PB, { mask = null, maxScale = MAX_SCALE, minMean = LOOP_MATCH.mean, joint = 12 } = {}) {
  const n = PA?.length;
  if (!n || PB?.length !== n || n < LOOP_MATCH.minFrames) return null;
  const MA = meanPyramid(PA), MB = meanPyramid(PB), o = { mask, maxScale };
  const RA = motionOf(PA, MA), RB = motionOf(PB, MB), motion = (m) => cycleShift(scoreMatrix(RA, RB, m, { mask, flat: MOTION_FLAT }));
  const cand = [...coarse(MA, MB, { ...o, keep: 2 }).map((c) => ({ c, inA: true })), ...coarse(MB, MA, { ...o, keep: 2 }).map((c) => ({ c, inA: false }))]
    .sort((p, q) => q.c.score - p.c.score).slice(0, 3);
  let best = null;
  for (const { c, inA } of cand) {
    const r = inA ? refine(MA, MB, c, o) : refine(MB, MA, c, o);
    if (!(r.score >= minMean) || r.scale < SAME_SCALE) continue;
    const m = { ...r, tighter: inA ? 'b' : 'a' }, cs = motion(m);
    if (!best || cs.score > best.cs.score) best = { m, cs, mean: r.score };
  }
  if (!best) return null;
  // one transform for the whole cycle: refined over the matched pairs (at most `joint`, spread over the cycle)
  const inA = best.m.tighter === 'b', s = best.cs.shift, q = Math.min(n, joint), ks = Array.from({ length: q }, (_, i) => Math.floor((i * n) / q));
  const outer = ks.map((k) => (inA ? PA[(k + s) % n] : PB[k])), inner = ks.map((k) => (inA ? PB[k] : PA[(k + s) % n]));
  const W2 = outer[0][2].w, H2 = outer[0][2].h, c0 = { bw: Math.round(best.m.w * W2), x: Math.round(best.m.x * W2), y: Math.round(best.m.y * H2) };
  const j = refineSet(outer, inner, c0, o);
  if (j.scale >= SAME_SCALE) {
    const m = { ...j, tighter: best.m.tighter }, cs = motion(m);
    if (cs.score > best.cs.score) best = { ...best, m, cs };
  }
  const { m, cs } = best, frames = cycleShift(scoreMatrix(PA, PB, m, o)).scores[cs.shift];
  return { score: cs.score, margin: cs.margin, shift: cs.shift, sub: cs.sub, frames, scale: m.scale, x: m.x, y: m.y, w: m.w, tighter: m.tighter, mean: best.mean, n };
}
/** A cycle match that decides: the motion's score and margin, and the pictures themselves, over the thresholds. */
export const cycleOk = (r, o = LOOP_MATCH) => !!r && r.score >= o.score && r.margin >= o.margin && r.frames >= o.frames;

/** Seeded random (mulberry32 over a string's hash): the same loop picks the same frames every time. */
function rng(key) {
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** The spot-check frames of a loop's later passes: perPass random frames of each pass 1 .. passes - 1 (evenly chosen passes
 *  when that is over `cap`), seeded by `key`; ok(pass, k) leaves out frames past the loop's end. -> [{pass, k}] */
export function spotPicks(key, passes, n, { perPass = LOOP_MATCH.perPass, cap = LOOP_MATCH.cap, ok = () => true } = {}) {
  const r = rng(key), later = Array.from({ length: Math.max(0, Math.ceil(passes) - 1) }, (_, i) => i + 1), out = [];
  const keepN = Math.max(1, Math.floor(cap / perPass)), use = later.length > keepN ? Array.from({ length: keepN }, (_, i) => later[Math.floor((i * later.length) / keepN)]) : later;
  for (const pass of use) {
    const ks = new Set();
    for (let t = 0; t < 4 * perPass && ks.size < perPass; t++) { const k = Math.floor(r() * n); if (ok(pass, k)) ks.add(k); }
    for (const k of ks) out.push({ pass, k });
  }
  return out;
}
/** The spot checks of a cycle match r: pairs [{A, B}] (pyramids: a frame of loop A and its predicted counterpart in loop
 *  B) scored under r's transform. -> {n, ok (NCC >= floor), agree: ok >= agree share} */
export function spotCheck(r, pairs, { mask = null, floor = LOOP_MATCH.floor, agree = LOOP_MATCH.agree } = {}) {
  let ok = 0;
  for (const p of pairs) if (scoreAt(p.A, p.B, r, { mask }) >= floor) ok++;
  return { n: pairs.length, ok, agree: !pairs.length || ok >= agree * pairs.length };
}
/** A loop frame's counterpart in the other loop's first pass: A's frame k <-> B's frame (k - shift) mod n (ofA), B's frame
 *  k <-> A's frame (k + shift) mod n. */
export const counterpart = (k, shift, n, ofA) => (((ofA ? k - shift : k + shift) % n) + n) % n;

/**
 * Loop-pair matches -> shotLinks.links entries (crop links' shape, via 'loops'): one per pair of shots, the best pair's
 * transform; pairs [{A, B: {key, id, shot: {start_ms, end_ms}}, r: matchCycles + {checks: {n, ok}}}].
 */
export function loopShotLinks(pairs) {
  const by = new Map();
  for (const { A, B, r } of pairs) {
    const flip = A.shot.start_ms > B.shot.start_ms, [P, Q] = flip ? [B, A] : [A, B];
    if (P.shot.start_ms === Q.shot.start_ms) continue;
    const tighter = flip ? (r.tighter === 'a' ? 'b' : 'a') : r.tighter, shift = flip ? (r.n - r.shift) % r.n : r.shift;
    const lp = { a: P.key, b: Q.key, ia: P.id, ib: Q.id, periodA: r.n, periodB: r.n, shift, ratio: 1, score: r.score, margin: r.margin, checks: r.checks, ...(r.margin < LOOP_MATCH.strong ? { weak: true } : {}), scale: r.scale, x: r.x, y: r.y, w: r.w, tighter };
    const k = `${P.shot.start_ms}|${Q.shot.start_ms}`, cur = by.get(k);
    if (!cur) by.set(k, { a: { start_ms: P.shot.start_ms, end_ms: P.shot.end_ms }, b: { start_ms: Q.shot.start_ms, end_ms: Q.shot.end_ms }, kind: 'crop', via: 'loops', loops: [lp] });
    else cur.loops.push(lp);
  }
  return [...by.values()].map((L) => {
    const b = L.loops.reduce((p, q) => (q.score > p.score ? q : p));
    return { ...L, score: b.score, margin: b.margin, scale: b.scale, tighter: b.tighter, box: linkBox(b), frames: b.periodA, checks: b.checks, ...(L.loops.every((q) => q.weak) ? { weak: true } : {}) };
  });
}
/** The project's 'loopLinks' block ({v: 1, done: [loop ids compared], pairs: loopShotLinks' input}) read back: anything
 *  malformed is left out; null / an old project -> nothing. -> {pairs, done: Set} */
export function loopStore(v) {
  const fin = Number.isFinite, str = (s) => typeof s === 'string' && s.length > 0 && s.length < 200;
  const end = (X) => X && str(X.key) && str(X.id) && fin(X.shot?.start_ms) && fin(X.shot?.end_ms) && X.shot.end_ms > X.shot.start_ms;
  const res = (r) => r && ['score', 'margin', 'frames', 'scale', 'x', 'y', 'w'].every((k) => fin(r[k])) && Number.isInteger(r.n) && r.n > 0 && Number.isInteger(r.shift) && r.shift >= 0 && r.shift < r.n && (r.tighter === 'a' || r.tighter === 'b');
  if (v?.v !== 1) return { pairs: [], done: new Set() };
  const pairs = (Array.isArray(v.pairs) ? v.pairs : []).filter((p) => end(p?.A) && end(p?.B) && res(p.r))
    .map(({ A, B, r }) => ({ A: { key: A.key, id: A.id, shot: { start_ms: A.shot.start_ms, end_ms: A.shot.end_ms } }, B: { key: B.key, id: B.id, shot: { start_ms: B.shot.start_ms, end_ms: B.shot.end_ms } }, r: { ...r } }));
  return { pairs, done: new Set((Array.isArray(v.done) ? v.done : []).filter(str)) };
}
/** The neighbour-shot links with the loop links laid over them: a pair found both ways takes the cycle's transform, score
 *  and `via` (and keeps the neighbour's other loop pairs); the rest of each as it is. */
export function mergeLinks(near = [], far = []) {
  const key = (L) => `${L.a.start_ms}|${L.b.start_ms}`, fk = new Map(far.map((L) => [key(L), L]));
  const out = near.map((L) => {
    const F = fk.get(key(L));
    if (!F) return L;
    fk.delete(key(L));
    return { ...F, loops: [...F.loops, ...(L.loops || []).filter((p) => !F.loops.some((q) => q.a === p.a || q.b === p.b))] };
  });
  return [...out, ...fk.values()];
}
