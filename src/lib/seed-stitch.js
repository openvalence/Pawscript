// seed-stitch.js -- one part painted on several frames of a take (paw-o74b.1, "the same points on multiple frames"). Pure
// (test/seed-stitch.test.mjs). Each seed is tracked both ways from its own frame; here their tracks become ONE series.
// Ownership, per frame: of the seeds whose track holds that frame, the one with the nearest seed frame (so the handover is
// half way between two seed frames); a seed whose track has ended (lost: its data stops, gaps over GAP_MS end it) leaves
// its frames to the nearest seed that still holds them, before or after, as far as that one reaches; where none holds a
// frame, a gap stays a gap (NaN, never invented). A seed may own more than one stretch (a later seed lost before the end of
// the take: the earlier one takes the end again).
// The stitch: two seeds of one part are two paintings, so their centres differ by a little (and their scales); that offset
// must not become a step or a ramp. At each handover the incoming track is aligned to the outgoing one on the frames both
// hold around it (median difference for positions / angles, median ratio for sizes; chained from the first stretch's seed,
// each seed aligned once, at its first handover: every stretch keeps its own motion, only a constant moves), then the two
// are cross-faded (smoothstep) over a window of OVERLAP_MS (or the distance between the two seed frames, whichever is
// shorter) centred on the handover, inside the frames both hold. Tracks that only touch (no common frame): a plain switch,
// the incoming one carrying the outgoing one's offset.

export const STITCH = { GAP_MS: 500, OVERLAP_MS: 500 };
const fin = Number.isFinite;
/** How a channel suffix is aligned at a handover: 'add' (positions, angles, projections), 'mul' (sizes), 'none' (shares, fits). */
export const KIND = { x: 'add', y: 'add', rel: 'add', proj: 'add', rot: 'add', bx: 'add', by: 'add', ex: 'add', ey: 'add', scale: 'mul', size: 'mul', area: 'mul', lsz: 'add', prof: 'add', aniso: 'add', anisoXY: 'add' };   // the last four: six-axis.js group fits
export const kindOf = (sfx) => KIND[sfx] || 'none';

const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const nearest = (T, t) => { let lo = 0, hi = T.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < t) lo = m + 1; else hi = m; } return lo > 0 && Math.abs(T[lo - 1] - t) <= Math.abs(T[lo] - t) ? lo - 1 : lo; };

/** The frames a seed's track holds around its seed frame t: [i0, i1] (inclusive indices into T) of the run of finite
 *  values of x through t, gaps up to gapMs bridged; null when nothing finite lies within gapMs of t. */
export function extent(T, x, t, gapMs = STITCH.GAP_MS) {
  if (!T.length || !x) return null;
  let c = nearest(T, t);
  if (!fin(x[c])) {   // the seed frame itself lost: the nearest finite sample within gapMs
    let best = -1;
    for (let d = 1; d < T.length; d++) {
      const a = c - d, b = c + d;
      if ((a < 0 || t - T[a] > gapMs) && (b >= T.length || T[b] - t > gapMs)) break;
      if (a >= 0 && t - T[a] <= gapMs && fin(x[a])) { best = a; break; }
      if (b < T.length && T[b] - t <= gapMs && fin(x[b])) { best = b; break; }
    }
    if (best < 0) return null;
    c = best;
  }
  let i0 = c, i1 = c;
  for (let i = c - 1, last = c; i >= 0 && T[last] - T[i] <= gapMs; i--) if (fin(x[i])) i0 = last = i;
  for (let i = c + 1, last = c; i < T.length && T[i] - T[last] <= gapMs; i++) if (fin(x[i])) i1 = last = i;
  return [i0, i1];
}

/**
 * Who owns what. seeds: [{t (seed frame, ms), v: {x: ArrayLike on T, ...}}]; key: the series whose finite values say where a
 * seed's track holds (default 'x'). -> {own: per seed (input order) [[a, b], ...] (ms, first / last frame of each stretch it
 * owns) | null (none), hand: [{p, q (seed indices: outgoing, incoming), a, b (the cross-fade window, ms; a === b: a plain
 * switch), h (the handover), gap?: true (frames nobody holds between them)}], ext, owner (per frame: seed index | -1)}.
 */
export function ownership(T, seeds, { key = 'x', gapMs = STITCH.GAP_MS, overlapMs = STITCH.OVERLAP_MS } = {}) {
  const n = T.length, ext = seeds.map((s) => extent(T, s.v?.[key], s.t, gapMs)), owner = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = -1;
    seeds.forEach((s, k) => { if (ext[k] && i >= ext[k][0] && i <= ext[k][1] && (best < 0 || Math.abs(s.t - T[i]) < Math.abs(seeds[best].t - T[i]))) best = k; });
    owner[i] = best;
  }
  const own = seeds.map(() => null), hand = [];
  let last = -1, lastI = -1;
  for (let i = 0; i < n; i++) {
    const k = owner[i];
    if (k < 0) continue;
    if (last >= 0 && k !== last) {
      const p = last, q = k, gap = i - lastI > 1;
      const lo = Math.max(T[ext[p][0]], T[ext[q][0]]), hi = Math.min(T[ext[p][1]], T[ext[q][1]]), b0 = (T[lastI] + T[i]) / 2;
      if (gap || lo > hi) hand.push({ p, q, a: T[lastI], b: T[i], h: b0, ...(gap ? { gap: true } : {}), ...(lo > hi && !gap ? { touch: true } : {}) });
      else {
        const w = Math.min(overlapMs, Math.abs(seeds[q].t - seeds[p].t)), h = Math.min(hi, Math.max(lo, b0));
        let a = Math.max(lo, h - w / 2), b = Math.min(hi, a + w);
        a = Math.max(lo, b - w);
        hand.push({ p, q, a, b, h: (a + b) / 2 });
      }
    }
    if (k !== last || i - lastI > 1) (own[k] ||= []).push([T[i], T[i]]);
    own[k][own[k].length - 1][1] = T[i];
    last = k; lastI = i;
  }
  return { own, hand, ext, owner };
}

/**
 * The seeds' series stitched into one. seeds as for ownership (each v: {sfx: ArrayLike on T}); sfx: the suffixes to stitch
 * (default: those every seed has). -> {v: {sfx: Float64Array}, own, hand, off: per seed {sfx: offset | ratio}}.
 */
export function stitch(T, seeds, opts = {}) {
  const n = T.length, { own, hand, owner } = ownership(T, seeds, opts);
  const names = opts.sfx || Object.keys(seeds[0]?.v || {}).filter((s) => seeds.every((x) => x.v?.[s]));
  const out = {}, off = seeds.map(() => ({}));
  const first = Array.prototype.find.call(owner, (k) => k >= 0);
  for (const sfx of names) {
    const kind = kindOf(sfx), raw = seeds.map((s) => s.v[sfx]), unit = kind === 'mul' ? 1 : 0;
    const D = seeds.map(() => null);
    if (first != null) D[first] = unit;
    const al = (k, i) => { const x = raw[k]?.[i]; return !fin(x) ? NaN : kind === 'add' ? x - D[k] : kind === 'mul' ? x / D[k] : x; };
    for (const hd of hand) {   // each seed aligned once, to the one it takes over from (already aligned)
      if (D[hd.q] != null) continue;
      D[hd.q] = D[hd.p] ?? unit;
      if (hd.gap || hd.touch || kind === 'none') continue;
      const d = [];
      for (let i = 0; i < n; i++) {
        if (T[i] < hd.a || T[i] > hd.b) continue;
        const A = al(hd.p, i), B = raw[hd.q]?.[i];
        if (fin(A) && fin(B) && (kind === 'add' || (A > 0 && B > 0))) d.push(kind === 'add' ? B - A : B / A);
      }
      const m = median(d);
      if (fin(m) && (kind === 'add' || m > 0)) D[hd.q] = m;
    }
    seeds.forEach((_, k) => { if (D[k] == null) D[k] = unit; off[k][sfx] = D[k]; });
    const v = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) if (owner[i] >= 0) v[i] = al(owner[i], i);
    for (const hd of hand) {
      if (hd.gap || hd.touch || !(hd.b > hd.a)) continue;
      for (let i = 0; i < n; i++) {
        if (T[i] < hd.a || T[i] > hd.b) continue;
        const A = al(hd.p, i), B = al(hd.q, i), s = smooth((T[i] - hd.a) / (hd.b - hd.a));
        v[i] = fin(A) && fin(B) ? (1 - s) * A + s * B : fin(A) ? A : fin(B) ? B : NaN;
      }
    }
    out[sfx] = v;
  }
  return { v: out, own, hand, off };
}
