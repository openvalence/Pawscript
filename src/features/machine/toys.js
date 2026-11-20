// toys.js -- pure toy geometry for the Machine panel: a toy is a radius profile along its length,
//   {id, name, length_mm, profile: [[s_mm, radius_mm], ...], knot?: {from_mm, to_mm}}
// with s measured from the TIP (s = 0) to the BASE (s = length_mm). The built-ins are generic parametric shapes
// fallbacks; the real library comes from library.json (tools/build-toy-library.mjs) through libraryToy().
// Optional extras: usable_mm (deepest the toy can go), outline [[s, left, right]] (the drawn top-down outline about
// the centreline, mm; else the radius profile mirrored), img (a side-profile picture) with pic {aspect, cx, top, bottom}.
// traceSilhouette() turns a picture of a toy lying along one axis into a profile (the owner's own toys).

const STEP = 2;   // mm between profile samples of the built-ins

/** Sample f(s) -> radius every STEP mm over [0, len]. */
const sample = (len, f) => Array.from({ length: Math.floor(len / STEP) + 1 }, (_, i) => { const s = Math.min(len, i * STEP); return [s, +f(s).toFixed(2)]; });
const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const bump = (s, c, w) => Math.exp(-(((s - c) / w) ** 2));
/** A rounded tip: radius rises from ~1/3 of r to r over `len` mm. */
const tip = (s, r, len) => r * (0.35 + 0.65 * Math.sqrt(smooth01(s / len)));

export const BUILTIN_TOYS = Object.freeze([
  { id: 'b-taper', name: 'Taper', builtin: true, length_mm: 180,
    profile: sample(180, (s) => 6 + 14 * smooth01(s / 120) + (s > 170 ? 4 * smooth01((s - 170) / 10) : 0)) },
  { id: 'b-knot', name: 'Knot', builtin: true, length_mm: 210,
    profile: sample(210, (s) => tip(s, 15, 40) + 2 * smooth01((s - 40) / 60) + 13 * bump(s, 150, 17) + (s > 196 ? 6 * smooth01((s - 196) / 10) : 0)) },
]);

export const SIZE_LABELS = { mini: 'Mini', small: 'Small', medium: 'Medium', large: 'Large', extralarge: 'XL', '2xlarge': 'XXL', xxlarge: 'XXL',
  '3xlarge': 'XXXL', xxxlarge: 'XXXL', onesize: 'One size', 'paw-single': 'Single', 'paw-twopack': 'Two-pack' };
/** The size dropdown's order (unknown keys last, in their own order). */
export const SIZE_ORDER = ['mini', 'small', 'medium', 'large', 'extralarge', '2xlarge', 'xxlarge', '3xlarge', 'xxxlarge', 'onesize', 'paw-single', 'paw-twopack'];
export const sortSizes = (keys) => [...keys].sort((a, b) => (SIZE_ORDER.indexOf(a) + 1 || 99) - (SIZE_ORDER.indexOf(b) + 1 || 99));

/** A library entry (library.json) at one of its sizes -> a toy. The stations run from tip to base in units of the
 *  toy's length (lib.scale); every size is the same shape scaled to its published total length. */
export function libraryToy(e, size, lib = { stations: e.radius.length, scale: 1e4 }) {
  const sz = e.sizes[size] || Object.values(e.sizes)[0], L = sz.length_mm, n = e.radius.length - 1, k = L / lib.scale;
  return {
    // the hilt from the mesh's own neck (hiltOf, at build time) as a fraction of the length; else the catalogue's
    id: `${e.sku}:${size in e.sizes ? size : Object.keys(e.sizes)[0]}`, name: e.name, length_mm: L, ...(e.hilt ? { usable_mm: +(e.hilt * L).toFixed(1) } : sz.usable_mm ? { usable_mm: sz.usable_mm } : {}),
    profile: e.radius.map((r, i) => [+((i / n) * L).toFixed(2), +(r * k).toFixed(2)]),
    outline: e.outline.map(([l, r], i) => [+((i / n) * L).toFixed(2), +(l * k).toFixed(2), +(r * k).toFixed(2)]),
    knot: e.knot ? { from_mm: e.knot.from * L, to_mm: e.knot.to * L } : null,
    ...(e.pic ? { pic: e.pic } : {}),
    ...(e.themes?.length ? { themes: e.themes } : {}),
    ...(e.roll ? { roll: e.roll } : {}),
    ...(e.firmness ? { firmness: e.firmness } : {}),
    ...(e.centre ? { centre: e.centre } : {}),
  };
}

/**
 * The hilt (the last point that goes in, fraction of the length from the tip) from a radius profile: per station tip ->
 * base, in units of the length (library.json radius / scale). Candidates past 40 % of the length (and past a knot):
 *  - necks: a local minimum at least 3 % under the widest point of the 10 % before it (a waist above the base);
 *  - knees: where the profile turns up into a steeper rise (the rise ahead >= 0.12 radius per length and at least twice
 *    as steep as behind), at its sharpest bend;
 * each only if a base follows: the radius reaching 1.3 x its own within the next 25 % of the length and staying above
 * 1.15 x it. A knot or a medial ring is a bulge that falls again, never a base. With the catalogue's usable fraction: the candidate nearest it (the
 * catalogue picks between, say, a sheath and a plate; the geometry says exactly where), unless none is within 8 % of it;
 * then (and without one) the geometry alone: the first candidate whose base comes within 15 %, else the first. No
 * candidate: the catalogue's value, else the whole length. -> {hilt, by: 'geometry' | 'catalogue' | 'length', off}
 * (off: |hilt - usable|, the disagreement).
 */
export function hiltOf(radius, { knot = null, usable = null } = {}) {
  const r = radius, n = r.length - 1, at = (i) => r[Math.max(0, Math.min(n, i))];
  const lo = Math.max(Math.round(0.4 * n), knot ? Math.ceil(knot.to * n) + 1 : 0);
  // a base follows i: the radius reaches 1.3 x r[i] within f of the length and never falls back under 1.15 x after (a knot
  // or a ring falls back: insertable, not a base; the plate's rounded rim, the last two stations, does not count)
  const baseIn = (i, f) => {
    let m = 0, km = -1;
    for (let k = i + 1; k <= Math.min(n, i + Math.max(2, Math.round(f * n))); k++) if (r[k] > m) { m = r[k]; km = k; }
    if (m < 1.3 * r[i]) return false;
    for (let k = km; k < n - 1; k++) if (r[k] < 1.15 * r[i]) return false;
    return true;
  };
  const kneeAt = (i) => { const ahead = (at(i + 4) - r[i]) / (4 / n), behind = (r[i] - at(i - 6)) / (6 / n); return ahead >= 0.12 && ahead >= 2 * Math.max(behind, 0.02); };
  const cand = [];
  for (let i = lo; i < n - 1; i++) {
    let prev = 0;
    for (let k = Math.max(0, i - Math.round(0.1 * n)); k < i; k++) prev = Math.max(prev, r[k]);
    if (r[i] <= at(i - 1) && r[i] < at(i + 1) && r[i] <= 0.97 * prev && baseIn(i, 0.25)) cand.push(i);
    if (kneeAt(i) && !kneeAt(i - 1)) {   // a run of knee stations: its sharpest bend
      let best = i, bc = -Infinity;
      for (let k = i; k < n - 1 && kneeAt(k); k++) { const c = at(k + 2) - 2 * r[k] + at(k - 2); if (c > bc) { bc = c; best = k; } }
      if (baseIn(best, 0.25)) cand.push(best);
    }
  }
  cand.sort((a, b) => a - b);
  if (!cand.length) return usable > 0 ? { hilt: usable, by: 'catalogue', off: 0 } : { hilt: 1, by: 'length', off: 0 };
  let pick = null;
  if (usable > 0) { const near = cand.reduce((a, b) => (Math.abs(b / n - usable) < Math.abs(a / n - usable) ? b : a)); if (Math.abs(near / n - usable) <= 0.08) pick = near; }
  if (pick == null) pick = cand.find((i) => baseIn(i, 0.15)) ?? cand[0];
  return { hilt: pick / n, by: 'geometry', off: usable > 0 ? Math.abs(pick / n - usable) : 0 };
}

/** The toy with its hilt at fraction f of its length (the owner's correction; null: as it is). */
export const withHilt = (toy, f) => (Number.isFinite(f) ? { ...toy, usable_mm: +(f * toy.length_mm).toFixed(1) } : toy);

/** Radius (mm) at s mm from the tip; 0 outside [0, length]. Linear between samples. */
export function radiusAt(toy, s) {
  const p = toy.profile, n = p.length;
  if (!n || s < 0 || s > toy.length_mm) return 0;
  let lo = 0, hi = n - 1;
  if (s <= p[0][0]) return p[0][1];
  if (s >= p[hi][0]) return p[hi][1];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m][0] <= s) lo = m; else hi = m; }
  const [s0, r0] = p[lo], [s1, r1] = p[hi];
  return s1 > s0 ? r0 + ((r1 - r0) * (s - s0)) / (s1 - s0) : r0;
}

/** A 1 mm radius table (Float32Array, index = mm from the tip) for the simulator's hot loop. */
export function radiusTable(toy) {
  const n = Math.ceil(toy.length_mm) + 1, t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = radiusAt(toy, Math.min(i, toy.length_mm));
  return t;
}

export const maxRadius = (toy) => toy.profile.reduce((m, [, r]) => Math.max(m, r), 0);

/** The span [from, to] around the girth maximum at peak (mm): out each side while the flank still falls by more
 *  than 0.08 mm per mm (where it flattens into the shaft, or turns, the knot ends). */
export function spanAround(toy, peak) {
  const t = radiusTable(toy), n = t.length, k = Math.max(0, Math.min(n - 1, Math.round(peak)));
  let a = k, b = k;
  // off a flat top (up to 6 mm), then down the flank
  while (a > 0 && k - a < 6 && Math.abs(t[a] - t[a - 1]) <= 0.08) a--;
  while (a > 0 && t[a] - t[a - 1] > 0.08) a--;
  while (b < n - 1 && b - k < 6 && Math.abs(t[b] - t[b + 1]) <= 0.08) b++;
  while (b < n - 1 && t[b] - t[b + 1] > 0.08) b++;
  return { from_mm: a, peak_mm: k, to_mm: b };
}

/** The knot: the toy's own, else auto-detected as the most prominent girth maximum in the base half that drops
 *  again toward the base (so a widening base or flange is not a knot). null when there is none. */
export function knotOf(toy) {
  if (toy.knot === null) return null;
  if (toy.knot) {
    const { from_mm, to_mm } = toy.knot, t = radiusTable(toy);
    let peak = Math.round(from_mm);
    for (let i = Math.round(from_mm); i <= Math.round(to_mm) && i < t.length; i++) if (t[i] > t[peak]) peak = i;
    return { from_mm, to_mm, peak_mm: peak, radius: t[peak] };
  }
  const t = radiusTable(toy), n = t.length;
  let best = null;
  for (let i = Math.round(n * 0.4); i < n - 3; i++) {
    if (!(t[i] >= t[i - 1] && t[i] > t[i + 1])) continue;
    const sp = spanAround(toy, i), r = t[i];
    const riseIn = r - Math.min(...t.slice(Math.max(0, i - 50), i)), dropOut = r - t[sp.to_mm];
    // a knot stands out from the shaft before it by >= 15 % and >= 3 mm, and narrows again behind it by >= 8 %
    if (riseIn < Math.max(3, 0.15 * r) || dropOut < 0.08 * r) continue;
    if (!best || riseIn > best.rise) best = { from_mm: sp.from_mm, to_mm: sp.to_mm, peak_mm: i, radius: r, rise: riseIn };
  }
  if (!best) return null;
  const { rise: _, ...k } = best;
  return k;
}

// ---------------------------------------------------------------------------------------------------------
// Silhouette import

/** Foreground mask of an RGBA image {width, height, data}: alpha when the picture has transparency, else every
 *  pixel far enough from the background colour (the median of the border pixels). */
export function silhouetteMask({ width: W, height: H, data }) {
  const m = new Uint8Array(W * H);
  let clear = 0;
  for (let i = 0; i < W * H; i++) if (data[i * 4 + 3] < 128) clear++;
  if (clear > W * H * 0.02) { for (let i = 0; i < W * H; i++) m[i] = data[i * 4 + 3] >= 128 ? 1 : 0; return m; }
  const border = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
  const med = (c) => { const v = border.map((i) => data[i * 4 + c]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg = [med(0), med(1), med(2)];
  for (let i = 0; i < W * H; i++) {
    const dr = data[i * 4] - bg[0], dg = data[i * 4 + 1] - bg[1], db = data[i * 4 + 2] - bg[2];
    m[i] = dr * dr + dg * dg + db * db > 48 * 48 ? 1 : 0;
  }
  return m;
}

/** Trace a toy picture: the long side of the filled area is the length axis; per column the radius is half the
 *  filled extent. Returns {radii: px per column, from the narrower end (tip) to the wider (base), flipped} or null. */
export function traceSilhouette(img) {
  const { width: W, height: H } = img, m = silhouetteMask(img);
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const horiz = x1 - x0 >= y1 - y0;
  const len = horiz ? x1 - x0 + 1 : y1 - y0 + 1, across = horiz ? [y0, y1] : [x0, x1];
  const radii = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let a = -1, b = -1;
    for (let j = across[0]; j <= across[1]; j++) {
      if (m[horiz ? j * W + x0 + i : (y0 + i) * W + j]) { if (a < 0) a = j; b = j; }
    }
    radii[i] = a < 0 ? 0 : (b - a + 1) / 2;
  }
  // 3-tap median against stray pixels, then trim near-empty ends (shadows, antialiasing)
  const r = radii.map((v, i) => [radii[Math.max(0, i - 1)], v, radii[Math.min(len - 1, i + 1)]].sort((p, q) => p - q)[1]);
  const top = r.reduce((a, v) => Math.max(a, v), 0);
  let s = 0, e = len - 1;
  while (s < e && r[s] < top * 0.03) s++;
  while (e > s && r[e] < top * 0.03) e--;
  let out = Array.from(r.slice(s, e + 1));
  // base = the wider end: compare the mean radius of the outer fifths
  const k = Math.max(1, Math.round(out.length / 5)), mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const flipped = mean(out.slice(0, k)) > mean(out.slice(-k));
  if (flipped) out = out.reverse();
  return { radii: out, flipped, aspect: top / out.length };
}

/** A toy from traced radii (px) scaled so the whole toy is length_mm long; ~1 sample per mm (at most 400). */
export function toyFromTrace(radii, { length_mm, name = 'Toy', id, flip = false }) {
  const r = flip ? [...radii].reverse() : radii, n = r.length, pxPerMm = n / length_mm;
  const count = Math.min(400, Math.max(2, Math.round(length_mm) + 1));
  const profile = Array.from({ length: count }, (_, i) => {
    const s = (i / (count - 1)) * length_mm, x = Math.min(n - 1, s * pxPerMm);
    const a = Math.floor(x), b = Math.min(n - 1, a + 1), f = x - a;
    return [+s.toFixed(2), +((r[a] * (1 - f) + r[b] * f) / pxPerMm).toFixed(2)];
  });
  return { id: id || 'u-' + Date.now().toString(36), name, length_mm: Math.round(length_mm), profile };
}

/** A sanitised toy from storage (settings / a .json file), or null when it is not usable. */
export function validToy(t) {
  if (!t || typeof t !== 'object' || !Array.isArray(t.profile) || !(t.length_mm > 0)) return null;
  const profile = t.profile.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] >= 0).sort((a, b) => a[0] - b[0]);
  if (profile.length < 2) return null;
  const knot = t.knot === null ? null : t.knot && Number.isFinite(t.knot.from_mm) && Number.isFinite(t.knot.to_mm) ? { from_mm: t.knot.from_mm, to_mm: t.knot.to_mm } : undefined;
  return { id: String(t.id || 'u-' + Date.now().toString(36)), name: String(t.name || 'Toy').slice(0, 60), length_mm: +t.length_mm, profile, ...(knot !== undefined ? { knot } : {}) };
}
