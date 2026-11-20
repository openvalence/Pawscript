// ring.js -- the opening (pure, no DOM; paw-j7em): the hole's outline along the canal, hugging the toy's own section,
// and its marker: the outside rim's green carried inward as a glow.
//  - toyPolar: once per toy, from its straightened mesh, the section's radius by angle round its axis at stations along
//    it, regularised (empty bins filled, only the lowest POLAR.harmonics kept round the circle, a light smoothing
//    along it): the gross shape and the larger features (an oval or lobed section, ridges, a knot), not surface noise.
//  - openingSleeve: per frame, per sample along the canal (the body shader's uSleeve), the hole: the physics aperture
//    there shaped like the toy's section at the station in it (rolled as the toy is drawn) plus a little tissue, as an
//    oval through its x / z extents and, per angle, its ratio to that oval (uRim, a 64 x 16 byte texture the vertex
//    shader reads where it can; without it, or with no section table, the oval alone).
//  - ringMesh: the marker, the hole's own outline extruded along the canal and flared out over the skin round the hole:
//    a thin sleeve of light just outside the canal wall, brightest at the rim and fading to clear both ways (out over
//    the flange, in along the canal), drawn additively over everything (scene3d.js); it moves and stretches because the
//    hole does.

/** The section table: angles round the axis, stations along the toy, harmonics kept round the circle, and the
 *  smoothing passes along it ([1 2 1] / 4). */
export const POLAR = Object.freeze({ angles: 32, stations: 96, harmonics: 4, along: 2 });
/** The hole: tissue between the toy's surface and the canal wall (mm); the rim texture's angles and rows; the toy's
 *  radius against the aperture over which the hole goes from round to the toy's section. */
export const HOLE = Object.freeze({ tissue: 0.6, angles: 64, rows: 16, grip: [0.5, 0.9] });
/** The toy's radius from its tip, carried in the rim texture's spare B / A channels for the carried colon (paw-fbqn: the
 *  gut opened per vertex to the toy's own profile, not interpolated between its stations): texel k (row-major, angles
 *  per row) holds the radius at u = k x PROFILE.mm / (texels - 1) mm, 0..PROFILE.max mm in 16 bits. */
export const PROFILE = Object.freeze({ mm: 512, max: 128 });
/** The radius profileAt reads back from a rim texture at u mm from the toy's tip (texel centres, linear between: as
 *  the shader does). */
export function profileAt(rim, u) {
  const N = HOLE.angles * HOLE.rows, x = Math.max(0, Math.min(N - 1, (u / PROFILE.mm) * (N - 1))), k = Math.min(N - 2, Math.floor(x)), f = x - k;
  const at = (i) => ((rim[i * 4 + 2] * 256 + rim[i * 4 + 3]) / 65535) * PROFILE.max;
  return at(k) + (at(k + 1) - at(k)) * f;
}
/** The marker (mm at 175 cm where they scale): how far outside the canal wall it floats, how far in from the rim its glow
 *  fades (relaxed, stretched: narrower as it stretches), its brightness at the rim (relaxed, stretched); segments round it
 *  and rows along it (Lite: fewer). Brightest at the hole, fading to clear at both free edges (the owner: "make the center
 *  bright and fade to clear around the edges, otherwise it's just the goofy onion ring"). */
export const GLOW = Object.freeze({ lift: 0.5, band: [11, 6], peak: [1, 1.25], seg: 64, rows: 28, liteSeg: 32, liteRows: 14 });
/** The marker's flange at the skin (mm at 175 cm, scaled by sqrt(scale) like the bands): the outline turns out of the
 *  canal over a quarter circle of radius `bell` and runs on as a lip `lip` wide over the skin round the hole, one surface
 *  with the sleeve, as bright as the rim where it leaves the canal and fading to clear at its outer edge; rows over the
 *  bell and the lip (Lite: fewer). From outside the body it is a glowing ring where the hole is, as wide as it
 *  is open (the owner: "flange out to make the hole on the outside visible"). The lip widens with the camera's
 *  distance from the hole (view, mm: x1 up to `near`, growing linearly to x`grow`), so it stays a few pixels wide from
 *  the panel's normal distance; its brightness falls as (1 - smoothstep) ** `fall` (lower: a wider bright core). */
export const FLARE = Object.freeze({ bell: 2.5, lip: 6, near: 350, grow: 2.5, fall: 0.8, rows: 10, liteRows: 5 });
/** The flange's profile at share t (0 at the sleeve's outer end .. 1 at the lip's edge) for bell radius b and lip
 *  width w: [dr (out from the hole's outline), dy (outward along the canal, toward -y), nr, ny (unit normal: radial,
 *  along)]. A quarter circle tangent to the sleeve, then flat: C1 at both joins. */
export function flareAt(t, b, w) {
  const arc = (Math.PI / 2) * b, l = t * (arc + w);
  if (l <= arc) { const f = l / b; return [b * (1 - Math.cos(f)), b * Math.sin(f), Math.cos(f), -Math.sin(f)]; }
  return [b + (l - arc), b, 0, -1];
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

/** The section table of a straightened toy mesh (mesh.js straighten: x, s (0 tip .. 1 base), z in units of its length):
 *  Float32Array(stations x angles), radius in units of the length, angle = atan2(z, x) at bin centres (j + 0.5) / angles. */
export function toyPolar(mesh) {
  const { angles: NA, stations: NU, harmonics: H, along } = POLAR, R = new Float32Array(NU * NA), P = mesh.pos;
  for (let i = 0; i < P.length; i += 3) {
    const s = P[i + 1];
    if (!(s >= 0 && s <= 1)) continue;
    const iu = Math.min(NU - 1, Math.round(s * (NU - 1))), ia = Math.floor((((Math.atan2(P[i + 2], P[i]) / TAU) % 1) + 1) % 1 * NA) % NA, r = Math.hypot(P[i], P[i + 2]);
    if (r > R[iu * NA + ia]) R[iu * NA + ia] = r;
  }
  // empty bins: round the circle from the nearest filled ones; empty stations from their neighbours along
  const full = new Uint8Array(NU);
  for (let u = 0; u < NU; u++) {
    const row = R.subarray(u * NA, u * NA + NA), got = [];
    for (let j = 0; j < NA; j++) if (row[j] > 0) got.push(j);
    if (!got.length) continue;
    full[u] = 1;
    for (let j = 0; j < NA; j++) {
      if (row[j] > 0) continue;
      let a = j, b = j; while (!(row[(a + NA) % NA] > 0)) a--; while (!(row[b % NA] > 0)) b++;
      row[j] = row[(a + NA) % NA] + (row[b % NA] - row[(a + NA) % NA]) * ((j - a) / (b - a));
    }
  }
  for (let u = 0; u < NU; u++) if (!full[u]) {
    let a = u, b = u; while (a >= 0 && !full[a]) a--; while (b < NU && !full[b]) b++;
    for (let j = 0; j < NA; j++) R[u * NA + j] = a < 0 ? (b < NU ? R[b * NA + j] : 0) : b >= NU ? R[a * NA + j] : R[a * NA + j] + (R[b * NA + j] - R[a * NA + j]) * ((u - a) / (b - a));
  }
  // round the circle: only the lowest harmonics (no spikes from single vertices); then along it
  const tmp = new Float32Array(NA);
  for (let u = 0; u < NU; u++) {
    const row = R.subarray(u * NA, u * NA + NA), cs = [];
    for (let k = 0; k <= H; k++) { let c = 0, s = 0; for (let j = 0; j < NA; j++) { const t = (TAU * k * (j + 0.5)) / NA; c += row[j] * Math.cos(t); s += row[j] * Math.sin(t); } cs.push([c / NA, s / NA]); }
    for (let j = 0; j < NA; j++) { let v = cs[0][0]; for (let k = 1; k <= H; k++) { const t = (TAU * k * (j + 0.5)) / NA; v += 2 * (cs[k][0] * Math.cos(t) + cs[k][1] * Math.sin(t)); } tmp[j] = Math.max(0, v); }
    row.set(tmp);
  }
  for (let pass = 0; pass < along; pass++) {
    const prev = Float32Array.from(R);
    for (let u = 0; u < NU; u++) for (let j = 0; j < NA; j++) R[u * NA + j] = (prev[Math.max(0, u - 1) * NA + j] + 2 * prev[u * NA + j] + prev[Math.min(NU - 1, u + 1) * NA + j]) / 4;
  }
  return R;
}
/** The section's radius (units of the length) at s (0 tip .. 1 base) and mesh angle th, bilinear (repeating round). */
export function polarAt(R, s, th) {
  const { angles: NA, stations: NU } = POLAR, x = Math.max(0, Math.min(NU - 1, s * (NU - 1))), u = Math.min(NU - 2, Math.floor(x)), fu = x - u;
  const y = ((((th / TAU) % 1) + 1) % 1) * NA - 0.5, j = Math.floor(y), fj = y - j, j0 = (j + NA) % NA, j1 = (j + 1) % NA;
  const at = (uu) => R[uu * NA + j0] + (R[uu * NA + j1] - R[uu * NA + j0]) * fj;
  return at(u) + (at(u + 1) - at(u)) * fu;
}
/** The toy's outline [left, right] across its drawn axis at u mm from the tip (library toys). */
function outlineAt(t, u) {
  const o = t.outline, n = o.length - 1, x = Math.max(0, Math.min(n, (u / t.length_mm) * n)), i = Math.min(n - 1, Math.floor(x)), f = x - i;
  return [o[i][1] + (o[i + 1][1] - o[i][1]) * f, o[i][2] + (o[i + 1][2] - o[i][2]) * f];
}

/** The hole along the canal now. s: physics state (ap, xi), canal: ctx.canal ({Lc, n}), toy, d (tip depth), roll (rad,
 *  as drawn), radiusAt (toys.js), polar: toyPolar's table or null (then the outline's oval, or round). -> {sleeve
 *  (Float32Array(48): per sample the oval's x / z half-widths, axial travel, -), sleeveY ([y0, dy]), rim (Uint8Array
 *  angles x rows x 4: per sample row, the hole's ratio to the oval at angle (j + 0.5) / angles, 0..4 in 16 bits over r and g;
 *  null without a section table)}. */
export function openingSleeve(s, canal, toy, d, roll, radiusAt, polar = null) {
  const Lc = canal.Lc, y0 = -8, dy = (Lc + 16) / 11, sleeve = new Float32Array(48), cr = Math.cos(roll), sr = Math.sin(roll), L = toy.length_mm, T = HOLE.tissue;
  const NA = HOLE.angles, rim = polar ? new Uint8Array(NA * HOLE.rows * 4) : null, ratio = new Float32Array(NA);
  for (let k = 0; k < 12; k++) {
    const y = y0 + k * dy, yc = Math.max(0, Math.min(Lc, y)), x = (yc / Lc) * (canal.n - 1), j = Math.min(canal.n - 2, Math.floor(x)), f = x - j;
    const a = s.ap[j] + (s.ap[j + 1] - s.ap[j]) * f, u = d - (yc + s.xi * (1 - yc / Lc)), rq = u > 0 ? radiusAt(toy, u) : 0;
    let rx = a + T, rz = a + T;
    ratio.fill(1);
    if (rq > 0.05 && polar) {
      // the toy's own section at this station, rolled, scaled by aperture / its radius (as the drawn toy is squashed):
      // fully where the ring grips it, eased back to round where the aperture stands well off it (HOLE.grip), never
      // inside it
      const w = smooth(HOLE.grip[0], HOLE.grip[1], rq / a), kq = Math.min(1, a / rq);
      const hole = (th) => { const P = polarAt(polar, u / L, th - roll) * L; return Math.max(a + ((a / rq) * P - a) * w, P * kq) + T; };
      rx = (hole(0) + hole(Math.PI)) / 2; rz = (hole(Math.PI / 2) + hole(-Math.PI / 2)) / 2;   // (the oval through its mean extents)
      for (let q = 0; q < NA; q++) { const th = (TAU * (q + 0.5)) / NA, c = Math.cos(th), sn = Math.sin(th); ratio[q] = hole(th) / ((rx * rz) / Math.max(0.01, Math.hypot(rz * c, rx * sn))); }
    } else if (rq > 1 && toy.outline) {   // the outline across x, the other from its area, rolled
      const o = outlineAt(toy, u), wx = Math.max(1, (o[1] - o[0]) / 2), wz = (rq * rq) / wx, k2 = a / rq;
      rx = Math.hypot(wx * cr, wz * sr) * k2 + T; rz = Math.hypot(wx * sr, wz * cr) * k2 + T;
    }
    sleeve.set([rx, rz, s.xi * (1 - yc / Lc), 0], k * 4);
    // (16 bits over R and G: linear filtering of each byte is linear filtering of the whole)
    if (rim) for (const row of k === 11 ? [11, 12, 13, 14, 15] : [k]) for (let q = 0; q < NA; q++) { const v = Math.max(0, Math.min(65535, Math.round((ratio[q] / 4) * 65535))), o = (row * NA + q) * 4; rim[o] = v >> 8; rim[o + 1] = v & 255; }
  }
  if (rim) for (let i = 0, N = NA * HOLE.rows; i < N; i++) { const v = Math.max(0, Math.min(65535, Math.round((radiusAt(toy, (i / (N - 1)) * PROFILE.mm) / PROFILE.max) * 65535))); rim[i * 4 + 2] = v >> 8; rim[i * 4 + 3] = v & 255; }
  return { sleeve, sleeveY: [y0, dy], rim };
}
/** The hole's distance from the canal's axis at angle th (atan2(z, x)) and y along it, as the body shader opens the
 *  canal (the oval, times the rim texture's ratio sampled as WebGL samples it: linear, repeating round, clamped
 *  along). */
export function holeAt({ sleeve, sleeveY: [y0, dy], rim }, th, y) {
  const fi = Math.max(0, Math.min(10.99, (y - y0) / dy)), i = Math.floor(fi), t = fi - i, S = [0, 1].map((q) => sleeve[i * 4 + q] + (sleeve[i * 4 + 4 + q] - sleeve[i * 4 + q]) * t);
  let R = (S[0] * S[1]) / Math.max(0.01, Math.hypot(S[1] * Math.cos(th), S[0] * Math.sin(th)));
  if (rim) {
    const NA = HOLE.angles, NR = HOLE.rows, x = ((((th / TAU) % 1) + 1) % 1) * NA - 0.5, j = Math.floor(x), fx = x - j, yy = Math.min(NR - 1, fi), r = Math.min(NR - 2, Math.floor(yy)), fy = yy - r;
    const b = (rr, jj) => { const o = (rr * NA + ((jj + NA) % NA)) * 4; return ((rim[o] * 256 + rim[o + 1]) / 65535) * 4; }, row = (rr) => b(rr, j) + (b(rr, j + 1) - b(rr, j)) * fx;
    R *= row(r) + (row(r + 1) - row(r)) * fy;
  }
  return R;
}

/** The marker's mesh in the body's frame: the hole's outline (holeAt, lifted GLOW.lift off the wall) extruded from the
 *  verge to the canal's inner end, its outer end flared out over the skin round the hole (FLARE, flareAt). op: openingSleeve's result; rel: the relaxed aperture (mm, physics.js restOf); view: the camera's distance from the hole (mm, 0: near); ->
 *  {pos, nor, col (r: brightness 0..1), idx, a (aperture at the verge), stretch (0 relaxed .. 1 at 3 x relaxed)}. */
export function ringMesh(op, { rel = 12, scale = 1, lite = false, view = 0 } = {}) {
  const { sleeve, sleeveY: [y0, dy] } = op, Lc = 11 * dy - 16, seg = lite ? GLOW.liteSeg : GLOW.seg, MT = lite ? GLOW.liteRows : GLOW.rows, MF = lite ? FLARE.liteRows : FLARE.rows, M = MF + MT;
  const a = (holeAt(op, 0, 0) + holeAt(op, Math.PI / 2, 0)) / 2 - HOLE.tissue, stretch = smooth(1, 3, a / rel);
  const w = (GLOW.band[0] + (GLOW.band[1] - GLOW.band[0]) * stretch) * Math.sqrt(scale), peak = GLOW.peak[0] + (GLOW.peak[1] - GLOW.peak[0]) * stretch;
  // rows along the canal, finer at both ends where the bands are; y from just outside the verge to the inner end
  const ys = Array.from({ length: MT }, (_, j) => { const t = j / (MT - 1); return -1 + (Lc + 1) * (t < 0.5 ? 0.5 * (2 * t) ** 2 : 1 - 0.5 * (2 - 2 * t) ** 2); });
  // the flange: rows 0 .. MF - 1 from the lip's edge in to the bell's start, then the sleeve's rows (one surface)
  const fb = FLARE.bell * Math.sqrt(scale), fw = FLARE.lip * Math.sqrt(scale) * Math.min(FLARE.grow, Math.max(1, view / FLARE.near)), fl = (t) => peak * (1 - smooth(0, 1, t)) ** FLARE.fall;
  const lum = (y) => peak * Math.exp(-(((y + 1) / w) ** 2)) * (1 - smooth(0.5 * Lc, Lc, y));
  const n = seg * M, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 4), sl = op.sleeve;
  const travel = (y) => { const fi = Math.max(0, Math.min(10.99, (y - y0) / dy)), i = Math.floor(fi); return sl[i * 4 + 2] + (sl[i * 4 + 6] - sl[i * 4 + 2]) * (fi - i); };
  for (let i = 0; i < seg; i++) {
    const th = (i / seg) * TAU, c = Math.cos(th), s = Math.sin(th);
    const r0 = holeAt(op, th, ys[0]) + GLOW.lift, t0 = ys[0] + travel(ys[0]);
    for (let j = 0; j < MF; j++) {   // (t from 1 at the lip's edge down to 1 / MF next to the sleeve's first row)
      const t = 1 - j / MF, [dr, dyo, nr, ny] = flareAt(t, fb, fw), o = (i * M + j) * 3;
      pos[o] = (r0 + dr) * c; pos[o + 1] = t0 - dyo; pos[o + 2] = (r0 + dr) * s; nor[o] = nr * c; nor[o + 1] = ny; nor[o + 2] = nr * s;
      col[(i * M + j) * 4] = fl(t);
    }
    for (let jj = 0; jj < MT; jj++) {
      const j = MF + jj, y = ys[jj], r = holeAt(op, th, y) + GLOW.lift, o = (i * M + j) * 3;
      pos[o] = r * c; pos[o + 1] = y + travel(y); pos[o + 2] = r * s; nor[o] = c; nor[o + 2] = s;
      col[(i * M + j) * 4] = lum(y);
    }
  }
  const idx = new Uint16Array(seg * (M - 1) * 6);
  for (let i = 0, t = 0; i < seg; i++) for (let j = 0; j < M - 1; j++) {
    const A = i * M + j, B = ((i + 1) % seg) * M + j;
    idx.set([A, B, A + 1, B, B + 1, A + 1], t); t += 6;
  }
  return { pos, nor, col, idx, a, stretch };
}
