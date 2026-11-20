// snap.js -- the Groups brush edge snap (paw-ywby, reworked paw-2kdm; pure). The painted blob becomes one clean outline:
// a smoothed signed-distance field of the blob; each outline point looks along its normal for a close, clear picture
// edge (reach a fraction of the brush radius, the pull falling to nothing at the reach, scaled by the edge strength
// against the local contrast); pulls are averaged over neighbouring outline points (one smooth displacement: no spikes,
// the outline stays a level set so it cannot self-intersect); then the outline is pulled a little inside so a seed point
// placed inside never sits on or past the part edge (not where the shape is thin). Classical and local on purpose:
// SAM / the tagger did not reach useful precision here (bd memory seeder-probe-2026-11-10).

/** RGBA image ({w, h, data} or an ImageData) -> {w, h, e: colour gradient magnitude (0..~255), c: [r, g, b] float planes (3x3 box blur)}.
 *  place: where the image sits in mask px ({ox, oy, sx, sy}: its origin and its px per mask px; default: the whole frame). */
export function edgeMap(img, place = null) {
  const w = img.w ?? img.width, h = img.h ?? img.height, data = img.data, n = w * h, c = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];   // ImageData: width / height
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const i = 4 * (Y * w + X);
      r += data[i]; g += data[i + 1]; b += data[i + 2]; k++;
    }
    const j = y * w + x;
    c[0][j] = r / k; c[1][j] = g / k; c[2][j] = b / k;
  }
  const e = new Float32Array(n), jxx = new Float32Array(n), jyy = new Float32Array(n), jxy = new Float32Array(n), at = (p, x, y) => p[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let gx = 0, gy = 0, gxy = 0;
    for (const p of c) { const u = (at(p, x + 1, y) - at(p, x - 1, y)) / 2, v = (at(p, x, y + 1) - at(p, x, y - 1)) / 2; gx += u * u; gy += v * v; gxy += u * v; }
    const j = y * w + x;
    e[j] = Math.sqrt(gx + gy); jxx[j] = gx; jyy[j] = gy; jxy[j] = gxy;   // the structure tensor: the edge's strength AND direction (either polarity)
  }
  return { w, h, e, jxx, jyy, jxy, c, ...(place || {}) };
}

const bil = (p, w, h, x, y) => {   // bilinear at image px (x, y) (pixel centres at +0.5)
  const fx = Math.min(w - 1, Math.max(0, x - 0.5)), fy = Math.min(h - 1, Math.max(0, y - 0.5)), ix = Math.floor(fx), iy = Math.floor(fy);
  const u = fx - ix, v = fy - iy, X1 = Math.min(w - 1, ix + 1), Y1 = Math.min(h - 1, iy + 1);
  return (p[iy * w + ix] * (1 - u) + p[iy * w + X1] * u) * (1 - v) + (p[Y1 * w + ix] * (1 - u) + p[Y1 * w + X1] * u) * v;
};


export const SNAP_REACH = 0.3;      // the farthest an outline point moves, x the brush radius (was 0.6: it leapt)
export const SNAP_STRENGTH = 3;     // edge strength / local contrast at which the pull is full (a ratio of 1 or less: none)
export const EDGE_MIN = 10;         // colour gradient a snap needs at all (a hard edge of colour distance 20 of 441)
// ---- the paint margin (paw-s63m): how far inside the part's edge a finished outline sits. ONE setting, 0..100 % (default MARGIN_DEFAULT),
// shared by every aid (the magnet's snap, circle to fill, SAM grow, the sidecar's SAM-drawn suggestions). The painted shape should reach
// almost to the part's edge (the truth, and the edge contrast is what the seeder trains on); the safety inset for the trackers is applied
// when seed points are placed (the sidecar's seed_inset), never to the painted shape. margin px = setting x min(MARGIN_MAX, MARGIN_FRAC x
// the part's width): proportional to the PART (a small part loses proportionally little), never more than MARGIN_MAX mask px (mask px = 1/320 of the frame width).
export const MARGIN_DEFAULT = 15;           // % : about 0.45 mask px (~2.7 px at 1080p) on a large part, 0.1 px on a tiny one: just off the dark outline pixels
export const MARGIN_FRAC = 0.15, MARGIN_MAX = 3;
/** The part's narrower dimension from its signed distance field (< 0 inside): 4 x the mean depth of its pixels (a bar's width; 2/3 of a disc's diameter). */
export function partWidth(s) {
  let sum = 0, n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] < 0) { sum -= s[i]; n++; }
  return n ? (4 * sum) / n : 0;
}
/** The margin in mask px for a setting (0..1) on a part `width` mask px wide. */
export const marginPx = (setting, width) => clamp(setting, 0, 1) * Math.min(MARGIN_MAX, MARGIN_FRAC * width);
/** The margin in mask px for the part whose signed distance field is s. */
export const marginFor = (s, setting = MARGIN_DEFAULT / 100) => marginPx(setting, partWidth(s));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Felzenszwalb squared distance transform of f (0 at seeds, a big number elsewhere), in place over a w x h grid. */
export function edt(f, w, h) {
  const n = Math.max(w, h), v = new Int32Array(n), z = new Float64Array(n + 1), d = new Float64Array(n);
  const pass = (len, get, set) => {
    for (let i = 0; i < len; i++) d[i] = get(i);
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s;
      while ((s = ((d[q] + q * q) - (d[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])) <= z[k]) k--;
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; set(q, (q - v[k]) ** 2 + d[v[k]]); }
  };
  for (let x = 0; x < w; x++) pass(h, (y) => f[y * w + x], (y, val) => { f[y * w + x] = val; });
  for (let y = 0; y < h; y++) pass(w, (x) => f[y * w + x], (x, val) => { f[y * w + x] = val; });
}

/** Signed distance (mask px; < 0 inside) from the mask's 0.5 level, w x h row-major, sub-pixel near the outline. */
export function signedDistance(a, w, h) {
  const BIG = 1e8, fi = new Float64Array(w * h), fo = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) { const ins = a[i] >= 0.5; fi[i] = ins ? BIG : 0; fo[i] = ins ? 0 : BIG; }   // fi: distance to an outside pixel; fo: to an inside pixel
  edt(fi, w, h); edt(fo, w, h);
  const s = new Float32Array(w * h), at = (x, y) => a[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, ins = a[i] >= 0.5;
    let v = ins ? -(Math.sqrt(fi[i]) - 0.5) : Math.sqrt(fo[i]) - 0.5;
    if (Math.abs(v) <= 1.5) {   // next to the outline: first-order distance to the 0.5 level from the coverage itself
      const gx = (at(x + 1, y) - at(x - 1, y)) / 2, gy = (at(x, y + 1) - at(x, y - 1)) / 2, g = Math.hypot(gx, gy);
      if (g > 0.05) { const u = (0.5 - a[i]) / g; if (u * v >= 0 || Math.abs(u) < 0.5) v = clamp(u, -1.5, 1.5); }
    }
    s[i] = v;
  }
  return s;
}

/** Separable box blur (radius r px, `passes` times) of f over w x h, edges clamped. -> a new array. */
export function boxBlur(f, w, h, r, passes = 2) {
  let src = Float32Array.from(f);
  const dst = new Float32Array(w * h), k = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {   // rows
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[y * w + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) { dst[y * w + x] = acc / k; acc += src[y * w + clamp(x + r + 1, 0, w - 1)] - src[y * w + clamp(x - r, 0, w - 1)]; }
    }
    for (let x = 0; x < w; x++) {   // columns
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += dst[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) { src[y * w + x] = acc / k; acc += dst[clamp(y + r + 1, 0, h - 1) * w + x] - dst[clamp(y - r, 0, h - 1) * w + x]; }
    }
  }
  return src;
}

/**
 * The outward displacement field T of an outline (signed distance s, < 0 inside) toward close, clear picture edges.
 * edge(x, y): the picture's edge strength at mask px (x, y) (bilinear). Each outline pixel looks along its normal within
 * +-reach (falloff 1 - (t / reach)^2: an edge at the reach pulls nothing, full pull inside 0.7 x reach); its pull is t of the best edge times a
 * confidence (edge strength against the mean contrast within 2 x reach, and against EDGE_MIN). The pulls are averaged
 * over the neighbouring outline pixels (box blur of pull x confidence over that of the outline: pixels without an edge
 * count as zero pull, so a lone faint edge barely moves anything) and spread over the band around the outline.
 * -> {T (w x h; the new outline is where s < T), n: outline pixels looked at, moved: those whose smoothed pull >= 0.25}.
 */
export function snapDisplacement(s, w, h, edge, reach) {
  const num = new Float32Array(w * h), den = new Float32Array(w * h), T = new Float32Array(w * h);
  if (!(reach > 0.3)) return { T, n: 0, moved: 0 };
  const at = (x, y) => s[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)], dt = 0.25, m = Math.ceil(4 * reach / dt) + 1;   // profile: +-2 reach (context), the reach window inside it
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = s[y * w + x];
    if (Math.abs(v) > 1) continue;
    const gx = (at(x + 1, y) - at(x - 1, y)) / 2, gy = (at(x, y + 1) - at(x, y - 1)) / 2, g = Math.hypot(gx, gy);
    if (g < 0.2) continue;
    const nx = gx / g, ny = gy / g, px = x + 0.5 - v * nx, py = y + 0.5 - v * ny;   // the outline point nearest this pixel
    n++; den[y * w + x] = 1;
    let sum = 0, best = -1, bt = 0, be = 0;
    for (let k = 0; k < m; k++) {
      const t = (k - (m - 1) / 2) * dt, e = edge(px + nx * t, py + ny * t);
      sum += e;
      const f = 1 - (t / reach) ** 2;
      if (f > 0 && e * Math.sqrt(f) > best) { best = e * Math.sqrt(f); bt = t; be = e; }
    }
    if (best < 0) continue;
    const rel = be / (sum / m + EDGE_MIN), conf = clamp((rel - 1) / (SNAP_STRENGTH - 1), 0, 1) * clamp(be / (2 * EDGE_MIN), 0, 1) * Math.min(1, 2 * (1 - (bt / reach) ** 2));
    num[y * w + x] = bt * conf;
  }
  const rb = Math.max(2, Math.ceil(reach)), N = boxBlur(num, w, h, rb), Dn = boxBlur(den, w, h, rb);
  let moved = 0;
  for (let i = 0; i < w * h; i++) {
    if (Dn[i] > 1e-3) T[i] = clamp(N[i] / Dn[i], -reach, reach);
    if (den[i] && Math.abs(T[i]) >= 0.25) moved++;
  }
  return { T, n, moved };
}

/**
 * The outline of s (signed distance, < 0 inside) pulled `margin` px inside, except where the shape is thin: the margin
 * fades out as the local half-width (the deepest point within 3 x margin) falls from 2 x margin to 1 x margin, so a shape
 * under ~2 x margin wide is not touched and one under ~4 x margin is not collapsed. -> a new field.
 */
export function insetOutline(s, w, h, margin) {
  const out = Float32Array.from(s);
  if (!(margin > 0)) return out;
  const r = Math.ceil(3 * margin), depth = new Float32Array(w * h), tmp = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) depth[i] = Math.max(0, -s[i]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, depth[y * w + k]); tmp[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x]);
    out[y * w + x] = s[y * w + x] + margin * clamp((m - margin) / margin, 0, 1);
  }
  return out;
}

export const SIGMA_FLOOR = 5;   // Lab units: the least spread assumed (a flat part still tolerates its anti-aliasing)
// sRGB 0..255 -> Lab (D65), per pixel, into three planes
export function lab(em, w, h) {
  const n = w * h, L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }, f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [R, G, Bc] = em.c;
  for (let i = 0; i < n; i++) {
    const r = lin(R[i]), g = lin(G[i]), b = lin(Bc[i]);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    L[i] = 116 * y - 16; A[i] = 500 * (x - y); B[i] = 200 * (y - z);
  }
  return [L, A, B];
}
export function stats(planes, idx) {
  const m = [0, 0, 0], v = [0, 0, 0], n = idx.length || 1;
  for (const i of idx) for (let k = 0; k < 3; k++) m[k] += planes[k][i];
  for (let k = 0; k < 3; k++) m[k] /= n;
  for (const i of idx) for (let k = 0; k < 3; k++) v[k] += (planes[k][i] - m[k]) ** 2;
  return { m, s: v.map((x) => Math.max(SIGMA_FLOOR, Math.sqrt(x / n))), n: idx.length };
}
export const dist = (planes, i, st) => Math.sqrt([0, 1, 2].reduce((acc, k) => acc + ((planes[k][i] - st.m[k]) / st.s[k]) ** 2, 0) / 3);


/** The frame's Lab planes at the edge map's own resolution, computed once per edge map. */
export const labOf = (em) => (em.lab ||= lab(em, em.w, em.h));

// ---- the magnet's strength: ONE number 0..1 (the setting is 0..100 %) scales how far it reaches, how weak an edge it follows
// and how firmly it pulls. 0: the plain smoothed blob (the inside margin only). 0.5: the classic snap (SNAP_REACH x the brush
// radius). 1: about one brush radius, faint edges.
export const STRENGTH_DEFAULT = 0.5;
export const REACH_MAX = 1.0;                       // x the brush radius at strength 1
const REACH_EXP = Math.log(SNAP_REACH / REACH_MAX) / Math.log(0.5);   // so that strength 0.5 reaches SNAP_REACH
export const EDGE_MIN_RANGE = 2.5;                  // the edge threshold runs EDGE_MIN x 2.5 (strength 0) .. EDGE_MIN / 2.5 (strength 1)
export function snapParams(strength = STRENGTH_DEFAULT) {
  const s = clamp(strength, 0, 1);
  return { reachFrac: REACH_MAX * s ** REACH_EXP, edgeMin: EDGE_MIN * EDGE_MIN_RANGE ** (1 - 2 * s), wData: 0.4 + 1.2 * s };
}
// ---- the contour solve (the blob's shape is the prior)
export const ALIGN_MIN = 0.5;       // an edge counts where cos^2 of the angle between its gradient and the outline's normal is at least this (crossing edges: none)
export const CAND_STEP = 0.5;       // px between candidate offsets along the normal
export const MOVE_COST = 0.35;      // cost of moving a full reach away from the painted outline (quadratic in the offset)
export const INWARD_PRIOR = 0.6;    // moving inward costs this much more (the blob is a soft convex shape; the silhouette is the outer edge)
export const SMOOTH_COST = 0.6;     // per px^2 of offset difference between neighbouring outline points
export const SLOPE_STEPS = 2;       // neighbouring points' offsets differ by at most this many candidate steps (1 px)
export const AREA_MIN = 0.4, AREA_MAX = 4;   // the snapped area stays within this ratio of the painted blob's
export const PROBE_IN = 1.5, PROBE_OUT = 2.5;  // px inside / outside a candidate edge where the colour is compared with the blob's interior
export const COLOUR_FLOOR = 0.15;   // an edge that does not separate the interior colour from something else keeps this share of its pull
const STEP = 1;                     // outline resampling, px

/** Marching squares on s (< 0 inside) at pixel centres -> chains [{p: [[x, y]...] (px, centres at +0.5), closed}]; open chains run off the window. */
export function contours(s, w, h) {
  const pos = new Map(), adj = new Map();
  const cross = (id, x0, y0, x1, y1, a, b) => { if (!pos.has(id)) { const t = a / (a - b); pos.set(id, [x0 + 0.5 + (x1 - x0) * t, y0 + 0.5 + (y1 - y0) * t]); } return id; };
  const link = (p, q) => { (adj.get(p) || adj.set(p, []).get(p)).push(q); (adj.get(q) || adj.set(q, []).get(q)).push(p); };
  for (let y = 0; y + 1 < h; y++) for (let x = 0; x + 1 < w; x++) {
    const i = y * w + x, a = s[i], b = s[i + 1], c = s[i + w + 1], d = s[i + w], e = [];
    if ((a < 0) !== (b < 0)) e.push(cross(2 * i, x, y, x + 1, y, a, b));                     // top
    if ((b < 0) !== (c < 0)) e.push(cross(2 * (i + 1) + 1, x + 1, y, x + 1, y + 1, b, c));   // right
    if ((d < 0) !== (c < 0)) e.push(cross(2 * (i + w), x, y + 1, x + 1, y + 1, d, c));       // bottom
    if ((a < 0) !== (d < 0)) e.push(cross(2 * i + 1, x, y, x, y + 1, a, d));                 // left
    if (e.length === 2) link(e[0], e[1]); else if (e.length === 4) { link(e[0], e[3]); link(e[1], e[2]); }
  }
  const seen = new Set(), out = [];
  const walk = (start) => {
    const ids = [start]; seen.add(start);
    let prev = -1, cur = start;
    for (;;) {
      const nx = (adj.get(cur) || []).find((q) => q !== prev && !seen.has(q));
      if (nx === undefined) break;
      seen.add(nx); ids.push(nx); prev = cur; cur = nx;
    }
    return ids;
  };
  for (const [id, nb] of adj) if (nb.length === 1 && !seen.has(id)) out.push({ ids: walk(id), closed: false });   // open chains first, from an end
  for (const [id] of adj) if (!seen.has(id)) out.push({ ids: walk(id), closed: true });
  return out.map(({ ids, closed }) => ({ p: ids.map((i) => pos.get(i)), closed }));
}

/** A polyline resampled about every `step` px (closed: the first point is not repeated at the end). */
export function resample(p, closed, step = STEP) {
  const pts = closed ? [...p, p[0]] : p, cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1], n = Math.max(closed ? 8 : 2, Math.round(L / step)), out = [];
  let j = 0;
  for (let k = 0; k < (closed ? n : n + 1); k++) {
    const d = (k / n) * L;
    while (j + 2 < cum.length && cum[j + 1] < d) j++;
    const t = clamp((d - cum[j]) / (cum[j + 1] - cum[j] || 1), 0, 1);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  return out;
}

/** Viterbi over n points x K candidates (unary: an n x K array; pairwise ws x (dj x dt)^2 within SLOPE_STEPS); fixA / fixB force the first / last candidate. -> the path. */
function viterbi(n, K, U, at, ws, dt, fixA = -1, fixB = -1) {
  const cost = new Float32Array(n * K), from = new Int16Array(n * K);
  for (let j = 0; j < K; j++) cost[j] = fixA >= 0 && j !== fixA ? Infinity : U[at(0) * K + j];
  for (let i = 1; i < n; i++) for (let j = 0; j < K; j++) {
    const u = U[at(i) * K + j];
    if (u === Infinity) { cost[i * K + j] = Infinity; continue; }
    let best = Infinity, bk = j;
    for (let k = Math.max(0, j - SLOPE_STEPS); k <= Math.min(K - 1, j + SLOPE_STEPS); k++) {
      const c = cost[(i - 1) * K + k] + ws * ((j - k) * dt) ** 2;
      if (c < best) { best = c; bk = k; }
    }
    cost[i * K + j] = best + u; from[i * K + j] = bk;
  }
  let j = fixB >= 0 ? fixB : 0;
  if (fixB < 0) for (let k = 1; k < K; k++) if (cost[(n - 1) * K + k] < cost[(n - 1) * K + j]) j = k;
  const path = new Int16Array(n);
  for (let i = n - 1; i >= 0; i--) { path[i] = j; j = from[i * K + j]; }
  return path;
}

/**
 * The outline of s (signed distance, < 0 inside, w x h) solved as a whole. Every contour point gets candidate offsets along
 * its normal within +-reach; a candidate costs little on an edge that runs PARALLEL to the outline there (the structure
 * tensor: crossing edges and edges inside the part along the outline count nothing) whose inner side looks like the blob's
 * interior and whose outer side does not (Lab statistics from deep inside the blob: the part's silhouette beats a shading
 * line just inside it), and a little more the further it moves (more inward than outward); neighbouring points' offsets
 * must agree (a snake: one coherent edge chain, no notch from one stray edge pixel); the minimum around the ring is found by
 * dynamic programming (closed loops: a three-lap run fixes the first point, then one exact pass); the area stays within
 * AREA_MIN..AREA_MAX of the painted blob's. Points farther than `Z` from what the stroke changed stay put.
 * em: edgeMap (jxx, jyy, jxy, c); map(x, y): window px -> em px; dChg: distance to what the stroke changed (w x h).
 * -> {T (the outward displacement per pixel near the outline: the new outline is where s < T), moved, n (points solved), mean (px of those moved), area (ratio)}.
 */
export function solveContour(s, w, h, em, map, dChg, { reach, edgeMin, wData, Z, deep = 1.5 }) {
  const T = new Float32Array(w * h), res = { T, moved: 0, n: 0, mean: 0, area: 1 };
  if (!(reach >= 1)) return res;
  const half = Math.round(reach / CAND_STEP), K = 2 * half + 1, dt = CAND_STEP, ex = em.w, ey = em.h, P = labOf(em);
  const cidx = (x, y) => { const [u, v] = map(x, y); return clamp(Math.floor(v), 0, ey - 1) * ex + clamp(Math.floor(u), 0, ex - 1); };
  // the blob's interior colour: the median of deep pixels, then the cluster round it
  const core = [], stride = Math.max(1, Math.floor((w * h) / 900));
  for (let i = 0; i < w * h; i += stride) if (s[i] < -deep) core.push(cidx((i % w) + 0.5, ((i / w) | 0) + 0.5));
  let sin = null;
  if (core.length >= 6) {
    const med = [0, 1, 2].map((k) => { const a = core.map((i) => P[k][i]).sort((x, y) => x - y); return a[a.length >> 1]; });
    const mine = core.filter((i) => Math.hypot(P[0][i] - med[0], P[1][i] - med[1], P[2][i] - med[2]) < 14);
    sin = stats(P, mine.length >= 0.2 * core.length ? mine : core);
  }
  const pin = (d) => clamp((3.5 - d) / 1.5, 0, 1);   // 1: looks like the blob's inside, 0: does not
  const grad = (x, y) => { const X = clamp(Math.floor(x), 1, w - 2), Y = clamp(Math.floor(y), 1, h - 2); return [(s[Y * w + X + 1] - s[Y * w + X - 1]) / 2, (s[(Y + 1) * w + X] - s[(Y - 1) * w + X]) / 2]; };
  let area0 = 0;
  for (let i = 0; i < w * h; i++) if (s[i] < 0) area0++;
  const num = new Float32Array(w * h), den = new Float32Array(w * h), solved = [];
  let dArea = 0, nSolved = 0;
  for (const ch of contours(s, w, h)) {
    if (ch.p.length < 4) continue;
    const pts = resample(ch.p, ch.closed), n = pts.length, nrm = new Array(n), act = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      const a = pts[ch.closed ? (i + n - 2) % n : Math.max(0, i - 2)], b = pts[ch.closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      let nx = ty, ny = -tx;
      const g = grad(pts[i][0], pts[i][1]);
      if (nx * g[0] + ny * g[1] < 0) { nx = -nx; ny = -ny; }   // outward: s grows that way
      nrm[i] = [nx, ny];
      act[i] = dChg[clamp(Math.floor(pts[i][1]), 0, h - 1) * w + clamp(Math.floor(pts[i][0]), 0, w - 1)] <= Z ? 1 : 0;
      if (act[i]) any = true;
    }
    const d = new Float32Array(n);
    if (any) {
      const U = new Float32Array(n * K).fill(Infinity);
      for (let i = 0; i < n; i++) {
        if (!act[i]) { U[i * K + half] = 0; continue; }
        const [nx, ny] = nrm[i], [px, py] = pts[i];
        for (let j = 0; j < K; j++) {
          const t = (j - half) * dt, x = px + nx * t, y = py + ny * t, [u, v] = map(x, y);
          const jxx = bil(em.jxx, ex, ey, u, v), jyy = bil(em.jyy, ex, ey, u, v), jxy = bil(em.jxy, ex, ey, u, v), tr = jxx + jyy, en2 = nx * nx * jxx + 2 * nx * ny * jxy + ny * ny * jyy;
          const E = tr > 1e-6 && en2 / tr >= ALIGN_MIN ? Math.sqrt(en2) : 0;
          let g = E > edgeMin ? 1 - Math.exp(-(E - edgeMin) / (2 * edgeMin)) : 0;
          if (g > 0 && sin) g *= COLOUR_FLOOR + (1 - COLOUR_FLOOR) * pin(dist(P, cidx(x - nx * PROBE_IN, y - ny * PROBE_IN), sin)) * (1 - pin(dist(P, cidx(x + nx * PROBE_OUT, y + ny * PROBE_OUT), sin)));
          U[i * K + j] = -wData * g + MOVE_COST * (t / reach) ** 2 * (t < 0 ? 1 + INWARD_PRIOR : 1);
        }
      }
      let path;
      if (ch.closed) {
        const j0 = viterbi(3 * n, K, U, (i) => i % n, SMOOTH_COST, dt)[n];
        path = viterbi(n + 1, K, U, (i) => i % n, SMOOTH_COST, dt, j0, j0);
      } else path = viterbi(n, K, U, (i) => i, SMOOTH_COST, dt);
      for (let i = 0; i < n; i++) d[i] = (path[i] - half) * dt;
      const sm = Float32Array.from(d);   // one 3-tap pass: no half-pixel stairs
      for (let i = 0; i < n; i++) if (act[i]) { const a = d[ch.closed ? (i + n - 1) % n : Math.max(0, i - 1)], b = d[ch.closed ? (i + 1) % n : Math.min(n - 1, i + 1)]; sm[i] = (a + 2 * d[i] + b) / 4; }
      d.set(sm);
    }
    solved.push({ pts, d, act, n });
  }
  for (const c of solved) for (let i = 0; i < c.n; i++) dArea += c.d[i];
  let ratio = area0 > 0 ? (area0 + dArea) / area0 : 1, k = 1;
  if (ratio > AREA_MAX) k = (AREA_MAX - 1) / (ratio - 1); else if (ratio < AREA_MIN) k = (1 - AREA_MIN) / (1 - ratio);
  let sum = 0;
  for (const c of solved) for (let i = 0; i < c.n; i++) {
    const di = c.d[i] * k, x = clamp(Math.floor(c.pts[i][0]), 0, w - 1), y = clamp(Math.floor(c.pts[i][1]), 0, h - 1);
    num[y * w + x] += di; den[y * w + x] += 1;
    if (c.act[i]) { nSolved++; if (Math.abs(di) >= 0.25) { res.moved++; sum += di; } }
  }
  res.n = nSolved; res.mean = res.moved ? sum / res.moved : 0; res.area = k === 1 ? ratio : Math.min(AREA_MAX, Math.max(AREA_MIN, ratio));
  const N = boxBlur(num, w, h, 2, 1), D = boxBlur(den, w, h, 2, 1), band = reach + 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {   // each pixel near the outline takes the offset of the outline point nearest it
    const v = s[y * w + x];
    if (Math.abs(v) > band) continue;
    const g = grad(x, y), gl = Math.hypot(g[0], g[1]);
    if (gl < 0.2) continue;
    const fx = clamp(Math.floor(x + 0.5 - (v * g[0]) / gl), 0, w - 1), fy = clamp(Math.floor(y + 0.5 - (v * g[1]) / gl), 0, h - 1), j = fy * w + fx;
    if (D[j] > 1e-3) T[y * w + x] = N[j] / D[j];
  }
  return res;
}

/**
 * The mask m after a stroke (before: the same group's mask before it, or null) with the outline near the stroke made one
 * smooth outline, solved against the picture's edges (solveContour: the blob's shape is the prior) and pulled inside by the
 * paint margin. em:
 * edgeMap of the frame (any resolution; mask coords scale to it, or em.ox / oy / sx / sy place it). radius: the brush radius
 * in mask px (the reach scales with it). margin: the paint margin setting 0..1 (marginFor). strength: the magnet, 0..1 (snapParams). others: the other groups' masks
 * (never painted into). Only what is within reach + margin of what the stroke changed is rewritten (fading out over 3 px);
 * the rest of the mask is returned exactly as it was.
 * -> {mask, moved, near, mean (of the offsets that moved), reach, margin, area}.
 */
export function snapMask(m, before, em, { radius, others = [], strength = STRENGTH_DEFAULT, margin: setting = MARGIN_DEFAULT / 100 } = {}) {
  const { w, h, a } = m, b0 = before?.a, sp = snapParams(strength), reach = sp.reachFrac * radius, out = { w, h, a: a.slice() };
  const margin = setting > 0 ? marginFor(signedDistance(a, w, h), setting) : 0;   // from the WHOLE part (the stroke's window may hold only a corner of it)
  const res = { mask: out, moved: 0, near: 0, mean: 0, reach, margin, area: 1 };
  if (!(em?.w > 0 && em.h > 0) || !(radius > 0)) return res;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (Math.abs(a[i] - (b0 ? b0[i] : 0)) <= 0.01) continue;
    const x = i % w, y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return res;
  const Z = reach + margin + 2, RAMP = 3, P = Math.ceil(Z + RAMP) + 6;   // the zone, and the band the fields need around it
  const bx = Math.max(0, x0 - P), by = Math.max(0, y0 - P), bw = Math.min(w, x1 + P + 1) - bx, bh = Math.min(h, y1 + P + 1) - by;
  const sub = new Float32Array(bw * bh), chg = new Float64Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = (by + y) * w + bx + x;
    sub[y * bw + x] = a[i];
    chg[y * bw + x] = Math.abs(a[i] - (b0 ? b0[i] : 0)) > 0.01 ? 0 : 1e8;
  }
  edt(chg, bw, bh);   // squared distance to what the stroke changed
  const dChg = new Float32Array(bw * bh);
  for (let i = 0; i < bw * bh; i++) dChg[i] = Math.sqrt(chg[i]);
  const sx = em.sx ?? em.w / w, sy = em.sy ?? em.h / h, ox = em.ox ?? 0, oy = em.oy ?? 0;
  const s0 = boxBlur(signedDistance(sub, bw, bh), bw, bh, 1, 2);   // smooth: no brush scallops, no per-pixel jitter
  const r = solveContour(s0, bw, bh, em, (x, y) => [(bx + x - ox) * sx, (by + y - oy) * sy], dChg, { reach, edgeMin: sp.edgeMin, wData: sp.wData, Z });
  const s1 = new Float32Array(bw * bh);
  for (let i = 0; i < bw * bh; i++) s1[i] = s0[i] - r.T[i];
  const s2 = insetOutline(s1, bw, bh, margin), other = (i) => others.some((o) => o && o.a[i] >= 0.5);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const j = y * bw + x, wgt = clamp(1 - (dChg[j] - Z) / RAMP, 0, 1);
    if (wgt <= 0) continue;
    const i = (by + y) * w + bx + x, c = clamp(0.5 - s2[j], 0, 1);
    let v = a[i] + (c - a[i]) * wgt;
    if (v > a[i] && other(i)) v = a[i];
    out.a[i] = v;
  }
  return { ...res, moved: r.moved, near: r.n, mean: r.mean, area: r.area };
}
