// body.js -- the receiving body for the Machine view: one generic body on all fours, hips toward the rail, built
// procedurally as a single smooth surface (pure, no DOM). A signed distance field is a smooth union of ellipsoids and
// capsules (glutes with a clean cleft, pelvis, a tapered waist over a flat abdomen, the ribcage fading out at the
// shoulders, thighs down to the floor with a gap, an optional tail) minus a blind canal along the rail axis; it is
// polygonised with surface nets and given gradient normals. World mm: the opening at the origin, y = depth into the
// body (away from the machine), x across, z up. Height scales it (scale = height / 175), weight adds soft volume;
// characters change the proportions and the tail (a small kit: a spline from the tail's root, a radius profile, an
// optional hair shell; characters.js). A placeholder form, not anatomy.

export const CANAL_R = 14;   // radius of the canal through the mesh at rest (the shader opens or closes it to the ring)

const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
/** Approximate distance to an ellipsoid at c with radii r. */
function ell(px, py, pz, c, r) {
  const x = (px - c[0]) / r[0], y = (py - c[1]) / r[1], z = (pz - c[2]) / r[2];
  const k0 = len3(x, y, z), k1 = len3(x / r[0], y / r[1], z / r[2]);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
}
/** Distance to a capsule a -> b of radius r. */
function cap(px, py, pz, a, b, r) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], ax = px - a[0], ay = py - a[1], az = pz - a[2];
  const h = Math.max(0, Math.min(1, (ax * bx + ay * by + az * bz) / (bx * bx + by * by + bz * bz)));
  return len3(ax - bx * h, ay - by * h, az - bz * h) - r;
}
/** Polynomial smooth minimum (blend radius k). */
const smin = (a, b, k) => { const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k)); return b + (a - b) * h - k * h * (1 - h); };

/** Catmull-Rom through pts, `per` segments per span -> points. */
function spline(pts, per = 6) {
  const out = [], P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < per; k++) {
    const t = k / per, a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
    out.push([0, 1, 2].map((q) => 0.5 * (2 * b[q] + (c[q] - a[q]) * t + (2 * a[q] - 5 * b[q] + 4 * c[q] - d[q]) * t * t + (3 * b[q] - a[q] - 3 * c[q] + d[q]) * t * t * t)));
  }
  out.push(pts.at(-1));
  return out;
}
/** A profile [r0, ..., rn] (evenly spaced root -> tip) at u in 0..1. */
const at = (prof, u) => { const x = u * (prof.length - 1), i = Math.min(prof.length - 2, Math.floor(x)); return prof[i] + (prof[i + 1] - prof[i]) * (x - i); };

/** A tail's SDF (or null): tail = {root: [x, y, z], pts: [[x, y, z], ...] from the root, r: radius profile, hair?:
 *  radius profile of a soft outer shell, squash?: [x, y, z] its thinning along world axes (a sheet of hair), fluff?:
 *  its tufts (0..1), blend?: into the body (mm)}, all mm at height 175;
 *  scaled by s. A chain of round cones along the spline; f.lo / f.hi bound it. */
export function tailSdf(tail, s) {
  if (!tail) return null;
  const C = spline(tail.pts.map((p) => p.map((v, q) => (tail.root[q] + v) * s))), n = C.length - 1;
  const seg = C.slice(0, -1).map((a, i) => {
    const b = C[i + 1], u0 = i / n, u1 = (i + 1) / n, d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    return { a, d, dd: d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1, r0: at(tail.r, u0) * s, r1: at(tail.r, u1) * s, h0: tail.hair ? at(tail.hair, u0) * s : 0, h1: tail.hair ? at(tail.hair, u1) * s : 0 };
  });
  const fl = tail.fluff || 0, R = Math.max(...tail.r, ...(tail.hair || [0])) * s * (1 + fl), [sx, sy, sz] = tail.squash || [1, 1, 1];
  const lo = [0, 1, 2].map((q) => Math.min(...C.map((c) => c[q])) - R), hi = [0, 1, 2].map((q) => Math.max(...C.map((c) => c[q])) + R), k = 0.09 / s;
  const f = (x, y, z) => {
    let d = Infinity, h = Infinity;
    for (const g of seg) {
      const px = x - g.a[0], py = y - g.a[1], pz = z - g.a[2], t = Math.max(0, Math.min(1, (px * g.d[0] + py * g.d[1] + pz * g.d[2]) / g.dd));
      const q = len3(px - g.d[0] * t, py - g.d[1] * t, pz - g.d[2] * t);
      d = Math.min(d, q - (g.r0 + (g.r1 - g.r0) * t));
      if (g.h0 || g.h1) h = Math.min(h, len3((px - g.d[0] * t) * sx, (py - g.d[1] * t) * sy, (pz - g.d[2] * t) * sz) - (g.h0 + (g.h1 - g.h0) * t));
    }
    // tufts: a soft lumpy modulation of the hair shell
    if (h < Infinity && fl) h += fl * 6 * s * (Math.sin(x * k) * Math.sin(y * k * 1.3) + Math.sin(z * k * 1.7 + x * k * 0.5));
    return Math.min(d, h);
  };
  f.lo = lo; f.hi = hi;
  return f;
}
const boxDist = (x, y, z, lo, hi) => len3(Math.max(lo[0] - x, 0, x - hi[0]), Math.max(lo[1] - y, 0, y - hi[1]), Math.max(lo[2] - z, 0, z - hi[2]));

// The Human base: a slim, soft young adult (androgynous), curvy rather than athletic, on all fours with the back
// arched and the hips presented to the rail, mm at 175 cm (the Height control scales it all; the opening at the
// origin, y toward the head, z up = dorsal, x across). The owner's target (paw-2vh): the hips and glutes dominate the
// silhouette (the widest part, waist ~0.65-0.7 of them by width), full round high glutes projecting rearward with a
// deep cleft, a narrow arched waist with a tucked abdomen, a narrower ribcage, smooth surfaces (the landmarks only
// hinted), thighs full at the top (front-to-back ~0.6 of the hip depth) set apart and tapering to the knee. Within
// plausible anthropometry (figures, scaled by height): stature 1750 (7.5 heads of ~233); hip breadth ~0.21 H = 376 at
// the skin over the trochanters and glutes (bi-trochanteric bone ~0.19 H); waist ~250 wide, ~200 deep; buttock depth
// ~250; chest ~280 wide, ~240 deep; thigh ~170 across and ~205 front-to-back at the gluteal fold tapering to ~100 x
// ~120 above the knee; femur (hip joint to knee) ~0.245 H = 430; hip joints ~210 apart, the knees ~280 apart.
//   (Gordon et al., "2012 Anthropometric Survey of U.S. Army Personnel" (ANSUR II), 2014, and its female sample for
//   hip / waist ratios; Loomis, "Figure Drawing for All It's Worth", 1943: the 7.5-8 head canon.)
// Torso sections along y: [y, centre z, half-width, dorsal radius, ventral radius]. The dorsal line (centre + dorsal
// radius) dips over the lumbar spine and rises to the ribcage: the lordosis that gives the arched, presented posture
// on all fours. The rear closes over CAP mm behind the first section, behind the glutes.
const TORSO = [
  [24, -8, 140, 96, 98],
  [92, -8, 168, 112, 106],     // the sacrum over the rectum (it lies in the sacral hollow); the pelvis, the widest part
  [168, -14, 146, 120, 104],   // over L5 (the stiffest toy rides the sacral line here); the waist-to-hip curve
  [252, -18, 128, 118, 94],    // the waist: narrow (with the hips ~0.66 by width), the abdomen tucked
  [338, -22, 130, 94, 102],    // the lumbar dip (~65 under the glutes, ~40 under the ribcage)
  [432, -16, 136, 118, 118],   // the ribcage: narrower than the hips, wider than deep
  [532, -12, 142, 118, 122],
  [640, -10, 140, 116, 118],
];
const SQ = 2.35, CAP = 62;    // superellipse exponent of the sections (a broad back, rounded sides); the rear cap, mm
const GLUTE = { c: [80, 30, 40], r: [86, 76, 98] };   // each gluteal mass: centre (x mirrored), radii (across, back, up): full and
// high, projecting rearward past the opening (a deep cleft) with the pelvis tilted forward in the arched pose
const HIP = [104, 92, -34], KNEE = [140, 150, -404], SHIN = [134, -70, -432];   // the femur line (near vertical, the knees a
// little forward and wider than the hips: the inner thighs and the perineum open to view); the shin back along the floor
const THIGH_R = [84, 50], SHIN_R = [46, 30], THIGH_DEPTH = 1.22;   // radii: at the gluteal fold / above the knee; below the
// knee / at the cut; the thigh deeper front-to-back (quadriceps in front, hamstrings behind) than across
// the genital mass (schematic, plain): the scrotum and the shaft hanging between the thighs, forward of the perineum
const SCROTUM = { c: [0, 72, -108], r: [30, 27, 34] }, SHAFT = [[0, 92, -116], [0, 120, -182], 15];

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Polynomial smooth maximum. */
const smax = (a, b, k) => -smin(-a, -b, k);

/** Sections [y, ...values] at y: a smooth (Catmull-Rom) run through them, clamped at the ends (a smoothstep per span
 *  left a plateau at each section that banded the back). -> the values, interpolated. */
function sectionAt(sec, y, out = new Array(sec[0].length)) {
  const yy = Math.max(sec[0][0], Math.min(sec[sec.length - 1][0], y));
  let k = 0;
  while (k < sec.length - 2 && sec[k + 1][0] < yy) k++;
  const A = sec[k], B = sec[k + 1], A0 = sec[Math.max(0, k - 1)], B1 = sec[Math.min(sec.length - 1, k + 2)], h = B[0] - A[0], t = (yy - A[0]) / h, t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2, ia = h / (B[0] - A0[0] || 1), ib = h / (B1[0] - A[0] || 1);
  for (let i = 0; i < A.length; i++) out[i] = h00 * A[i] + h10 * (B[i] - A0[i]) * ia + h01 * B[i] + h11 * (B1[i] - A[i]) * ib;
  return out;
}

/** Distance to a tapered capsule a -> b (radius ra at a, rb at b, the taper eased) and the parameter along it. */
function cone(px, py, pz, a, b, ra, rb, ease = 1.3, deep = 1) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], ax = px - a[0], ay = py - a[1], az = pz - a[2];
  const h = Math.max(0, Math.min(1, (ax * bx + ay * by + az * bz) / (bx * bx + by * by + bz * bz)));
  const ox = ax - bx * h, oy = ay - by * h, oz = az - bz * h, rho = len3(ox, oy, oz), cy = rho > 1e-6 ? oy / rho : 0;
  return [rho - (rb + (ra - rb) * (1 - h) ** ease) * (1 + (deep - 1) * cy * cy), h];   // deep: the section's depth along y
}

/** The rear's SDF for proportions {scale (height / 175 cm), width, tail, weight (0 slim .. 1 chubby; 0.25 the lean
 *  default), genitals ('male' | 'neutral')}: negative inside. Profiled sections on a simple skeleton (the torso lofted
 *  along the spine, the gluteal masses, the femur lines and shins) blended at the joints, with the landmarks that make
 *  a rear read: the cleft, the gluteal folds, the sacral dimples, the iliac crests, the spinal furrow between the
 *  erector columns, the inner-thigh separation, the perineum and a plain genital mass. The build keeps the skeleton:
 *  slim tightens it a little, chubby adds soft volume where it goes (love handles, belly, glutes, inner thighs). */
export function rearSdf({ scale = 1, width = 1, tail = false, weight = 0.25, genitals = 'male', pitch = 0 } = {}) {
  const s = scale, w = width, g = Math.max(0, Math.min(1, weight)) - 0.25;   // g: the build away from the lean default
  const sec = TORSO.map(([y, zc, hw, rt, rb]) => {
    const handles = sstep(60, 150, y) * (1 - sstep(280, 360, y)), belly = sstep(170, 240, y) * (1 - sstep(400, 480, y));
    return [y * s, (zc - 14 * g * belly) * s, (hw + (g > 0 ? 34 * handles + 14 : 40 * handles + 24) * g) * s * w, (rt + 8 * g) * s, (rb + (g > 0 ? 62 * belly + 10 : 30 * belly + 16) * g) * s];
  });
  const gl = { c: [GLUTE.c[0] * s * w, GLUTE.c[1] * s, GLUTE.c[2] * s], r: [(GLUTE.r[0] + (g > 0 ? 22 : 20) * g) * s * w, (GLUTE.r[1] + 22 * g) * s, (GLUTE.r[2] + 14 * g) * s] };
  const P3 = (v) => [v[0] * s * w, v[1] * s, v[2] * s], hip = P3(HIP), knee = P3(KNEE), shin = P3(SHIN);
  const tr0 = (THIGH_R[0] + (g > 0 ? 32 : 30) * g) * s, tr1 = (THIGH_R[1] + (g > 0 ? 8 : 12) * g) * s, sr0 = SHIN_R[0] * s, sr1 = SHIN_R[1] * s;
  const sc = SCROTUM.c.map((v) => v * s), sr = SCROTUM.r.map((v) => v * s), sh = [SHAFT[0].map((v) => v * s), SHAFT[1].map((v) => v * s), SHAFT[2] * s];
  const y0 = sec[0][0], yN = sec[sec.length - 1][0], capL = CAP * s;
  const tl = tailSdf(tail, s), tk = s * (tail?.blend ?? 22), S = (v) => v * s, pc = Math.cos((pitch * Math.PI) / 180), ps = Math.sin((pitch * Math.PI) / 180);
  const SEC = new Array(5);   // scratch (no allocation per sample)
  // the torso: the sections interpolated at y (they run along y: no search), a superellipse in the section's x-z
  const torso = (x, y, z) => {
    const q = sectionAt(sec, y, SEC), L = (i) => q[i];
    const hw = L(2), dz = z - L(1), R = dz > 0 ? L(3) : L(4), rho = Math.hypot(x, dz);
    const nrm = ((Math.abs(x) / hw) ** SQ + (Math.abs(dz) / R) ** SQ) ** (1 / SQ), d0 = rho < 1e-6 ? -Math.min(hw, R) : rho * (1 - 1 / nrm);
    if (y >= y0) return d0;
    // behind the first section: a rounded end (radius CAP), continuous with the sections
    const wx = d0 + capL, wy = y0 - y;
    return Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - capL;
  };
  return (x, y, z) => {
    const ax = Math.abs(x);
    let d = torso(x, y, z);
    // the gluteal masses, fuller low; a clean cleft between them (a shallow groove on the midline)
    d = smin(d, ell(ax, y, z, gl.c, [gl.r[0], gl.r[1] * (z < gl.c[2] ? 1.08 : 0.94), gl.r[2]]), S(30));
    d += S(11) * Math.exp(-((x / S(10)) ** 2)) * (1 - sstep(S(25), S(70), y)) * sstep(S(-70), S(-30), z) * (1 - sstep(S(95), S(120), z));
    // the thighs to the knees (the gluteal fold where they meet the glutes); the hamstrings and adductors part on the
    // inner back of the thigh (a faint groove)
    let [th, ht] = cone(ax, y, z, hip, knee, tr0, tr1, 1, THIGH_DEPTH);
    if (th < S(20)) { const tx = ax - (hip[0] + (knee[0] - hip[0]) * ht), ty = y - (hip[1] + (knee[1] - hip[1]) * ht), ang = Math.atan2(-ty, -tx);   // 0 medial, pi/2 back
      th += S(1) * Math.exp(-(((ang - 0.9) / 0.28) ** 2)) * sstep(0.1, 0.3, ht) * (1 - sstep(0.75, 0.95, ht)); }
    d = smin(d, th, S(14));
    // the knee: a little fuller, and the calf starting back along the floor, fading out at once
    d = smin(d, smax(cone(ax, y, z, knee, shin, sr0, sr1, 1)[0], S(40) - y, S(40)), S(26));   // the start of the calf, faded out
    // the back: the spinal furrow between the erector columns over the lower back; the sacral dimples; the iliac crest
    if (d < S(25)) {   // the landmarks only shape the surface (far off they do not matter)
    const back = sstep(S(110), S(170), y) * (1 - sstep(S(470), S(560), y)) * sstep(S(10), S(50), z);
    d += back * (S(1.6) * Math.exp(-((x / S(14)) ** 2)) - S(0.5) * Math.exp(-(((ax - S(36)) / S(16)) ** 2)) * (1 - sstep(S(330), S(420), y)));
    d += S(2.2) * Math.exp(-(((ax - S(32)) ** 2 + (y - S(118)) ** 2) / S(12) ** 2)) * sstep(S(40), S(70), z);
    d -= S(0.8) * Math.exp(-(((y - S(150) - 0.18 * ax) / S(13)) ** 2)) * sstep(S(95), S(135), ax) * sstep(S(-70), S(-10), z);
    }
    // the genital mass, plain and schematic ('neutral': a smooth perineum only)
    if (genitals !== 'neutral') {
      d = smin(d, ell(x, y, z, sc, sr), S(10));
      d = smin(d, cap(x, y, z, sh[0], sh[1], sh[2]), S(8));
    }
    if (tl && boxDist(x, y, z, tl.lo, tl.hi) < d + tk) d = smin(d, tl(x, y, z), tk);
    d = Math.max(d, y - S(600));   // the shoulders fade out of view
    // the anal canal: a short straight tube in from the opening (radius in real mm); the rest of the internal path is
    // drawn on its own (anatomy.js), inside this translucent form
    // (a pitched rail, paw-3562: the canal along the rail's line, turned `pitch` deg toward the back about the opening)
    if (pitch) { const along = y * pc + z * ps; return Math.max(d, -Math.max(Math.hypot(x, z * pc - y * ps) - CANAL_R, Math.abs(along - S(-19)) - S(61))); }
    const canal = Math.max(Math.hypot(x, z) - CANAL_R, Math.abs(y - S(-19)) - S(61));
    return Math.max(d, -canal);
  };
}

/** The torso's section at y for the narrowest body any character has (the slim build, width 0.9), at a height
 *  scale: [centre z, half-width, dorsal radius, ventral radius] (mm, superellipse exponent SQ). The internal path's
 *  toy is kept inside it (centreline.js). */
export const TORSO_SQ = SQ;
export function torsoSection(y, scale = 1) {
  const s = scale, [, zc, hw, rt, rb] = sectionAt(SLIM, y / s);
  return [zc * s, hw * 0.9 * s, rt * s, rb * s];
}
/** The bony dorsal boundary at y (mm, z): the front of the sacrum and coccyx, then of the lumbar vertebral bodies, a
 *  smooth curve (BONE: [y, z] mm at 175 cm, the height scales it) that stays 34-76 mm under the slimmest back (the
 *  skin, the thin soft tissue over the sacrum and the bone itself; over the lumbar spine the spinous processes, the
 *  erector muscles and the vertebral bodies; typical adult values, Standring, Gray's Anatomy 42nd ed.: sacral thickness
 *  ~20-30 mm under ~10-15 mm of tissue, lumbar skin to the front of the bodies ~70-90 mm). It runs down (ventrally)
 *  past the sacral promontory with the lumbar curve no tighter than a stiff toy can follow. A straight toy along the rail
 *  (the canal's line, z = 0) passes ~60 mm ventral of the promontory: as in life, a long rigid object along the canal's
 *  axis is directed toward the umbilicus, not the back. Nothing of the toy ever
 *  crosses it past BONE_FROM (centreline.js): a toy meeting it slides along it and is forced ventrally, toward the
 *  belly. Short of BONE_FROM the coccyx's tip is mobile (it swings back around a wide toy at the top of the canal).
 */
export const BONE_FROM = 92;   // mm at 175 cm along y: the sacrococcygeal joint (the coccyx, ~30-40 mm, yields short of it)
const BONE = [[40, 54], [80, 62], [120, 66], [160, 60], [220, 40], [300, 16], [400, 20], [640, 60]];
export const boneAt = (y, scale = 1) => sectionAt(BONE, y / scale)[1] * scale;
/** The bone line for the skin's gate (the bulge shader and centreline.js bulgeAt: linear between the BONE points, the
 *  same in both): [y0, z0, y1, z1, ...] at a height scale. */
export const boneLine = (scale = 1) => Float32Array.from(BONE.flatMap(([y, z]) => [y * scale, z * scale]));
/** Linear on a boneLine. */
export function boneLinAt(line, y) {
  const n = line.length / 2;
  if (y <= line[0]) return line[1];
  for (let i = 1; i < n; i++) if (y <= line[i * 2]) { const t = (y - line[i * 2 - 2]) / (line[i * 2] - line[i * 2 - 2]); return line[i * 2 - 1] + (line[i * 2 + 1] - line[i * 2 - 1]) * t; }
  return line[n * 2 - 1];
}
// the slim build's sections (the same build terms as rearSdf at weight 0)
const SLIM = TORSO.map(([y, zc, hw, rt, rb]) => { const g = -0.25, handles = sstep(110, 190, y) * (1 - sstep(300, 380, y)), belly = sstep(170, 240, y) * (1 - sstep(400, 480, y)); return [y, zc, hw + (40 * handles + 24) * g, rt + 8 * g, rb + (30 * belly + 16) * g]; });

/** Bounds of the body for proportions p (mm). */
export function rearBounds({ scale = 1, width = 1, weight = 0.25, tail = null } = {}) {
  const s = scale, g = 1 + 0.4 * weight, t = tailSdf(tail, s);
  const min = [-270 * s * width * g, -150 * s, -470 * s], max = [270 * s * width * g, 610 * s, 240 * s];
  return t ? { min: min.map((v, q) => Math.min(v, t.lo[q])), max: max.map((v, q) => Math.max(v, t.hi[q])) } : { min, max };
}

/** Surface nets over sdf on a grid of `cell` mm in bounds -> {pos, nor, idx (Uint16), uv}. The field is evaluated on
 *  every second point first; a point next to a coarse value clearly away from the surface (over 5 cells) takes that
 *  value (only its sign matters there), the rest are evaluated: the same mesh for a fraction of the work. */
export function polygonise(sdf, { min, max }, cell) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1, ny = Math.ceil((max[1] - min[1]) / cell) + 1, nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const F = new Float32Array(nx * ny * nz), at = (i, j, k) => i + nx * (j + ny * k), far = 5 * cell;
  for (let k = 0; k < nz; k += 2) for (let j = 0; j < ny; j += 2) for (let i = 0; i < nx; i += 2) F[at(i, j, k)] = sdf(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!(i & 1 || j & 1 || k & 1)) continue;
    const c = F[at(i & ~1, j & ~1, k & ~1)];
    F[at(i, j, k)] = Math.abs(c) > far ? c : sdf(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
  }
  const vid = new Int32Array(nx * ny * nz).fill(-1), pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { cv[c] = F[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]; if (cv[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t; n++;
    }
    vid[at(i, j, k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
  }
  if (pos.length / 3 > 65535) throw new Error('body mesh too fine');
  // a quad for every grid edge with a sign change, joining the four cells around it
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = F[at(i, j, k)] < 0;
    if (v0 !== (F[at(i + 1, j, k)] < 0)) quad(vid[at(i, j - 1, k - 1)], vid[at(i, j, k - 1)], vid[at(i, j, k)], vid[at(i, j - 1, k)], v0);
    if (v0 !== (F[at(i, j + 1, k)] < 0)) quad(vid[at(i - 1, j, k - 1)], vid[at(i - 1, j, k)], vid[at(i, j, k)], vid[at(i, j, k - 1)], v0);
    if (v0 !== (F[at(i, j, k + 1)] < 0)) quad(vid[at(i - 1, j - 1, k)], vid[at(i, j - 1, k)], vid[at(i, j, k)], vid[at(i - 1, j, k)], v0);
  }
  // normals from the field's gradient: smooth, independent of the grid
  const nor = new Float32Array(pos.length), e = cell * 0.5;
  for (let v = 0; v < pos.length; v += 3) {
    const [x, y, z] = [pos[v], pos[v + 1], pos[v + 2]];
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e), l = len3(gx, gy, gz) || 1;
    nor[v] = gx / l; nor[v + 1] = gy / l; nor[v + 2] = gz / l;
  }
  return { pos: Float32Array.from(pos), nor, idx: Uint16Array.from(idx) };
}

const cache = new Map();
/** The rear mesh for a character's body proportions (the last few cached): `cell` mm at height 175, coarser if the
 *  mesh would pass 65535 vertices. */
const keyOf = (p, cell) => JSON.stringify([p.scale ?? 1, p.width ?? 1, p.tail || null, Math.round((p.weight ?? 0.25) * 20) / 20, p.genitals || 'male', cell, ...(p.pitch ? [p.pitch] : [])]);
/** Whether rearMesh(p, cell) is ready without building. */
export const rearReady = (p = {}, cell = 5) => cache.has(keyOf(p, cell));
export function rearMesh(p = {}, cell = 5) {
  const key = keyOf(p, cell);
  if (!cache.has(key)) {
    let c = cell * Math.max(0.6, Math.min(1.6, p.scale ?? 1)), m = null;
    while (!m) { try { m = polygonise(rearSdf(p), rearBounds(p), c); } catch { c *= 1.12; } }
    cache.set(key, m);
    if (cache.size > 8) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}
