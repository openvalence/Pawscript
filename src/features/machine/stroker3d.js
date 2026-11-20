// stroker3d.js -- the Stroker mode in the Machine panel's 3D stage (paw-ttky, paw-n2ms), on the Machine's own WebGL
// layer (gl3d.js: the lit program, per-vertex colour, a fresnel alpha for clear shells) and camera (camera.js). World in
// mm: the body at y < 0, the penis along +y from its visible base (y = z, stroker.js: mm from the base) to its tip,
// round the y axis; z up (the penis's top, dorsal; its underside, ventral, at -z). Revolved meshes with fixed topology,
// their vertices rewritten in place each frame (no rebuilds):
//  - the penis from its profile, stylised anatomy: the glans to a corona flaring over the shaft, the frenulum's notch
//    under the corona, the meatus a short vertical slit at the tip, the urethral ridge along the underside of the shaft,
//    the root showing as the pubic pad is pressed in; coloured per station by the stimulation (one hue), the glans a
//    shade apart; squashed a little where the sleeve presses, the shaft's skin dragged along with the sleeve (taut
//    toward the base going down, bunched toward the glans going up: stroker.js skin), swaying at the turns;
//  - the pubic mound: a soft rounded surface the penis rises from, dented under the case's rim when it is pressed in;
//  - the sleeve, clear: its inner channel wall tinted where it presses (more opaque), its outer body fainter with a
//    fresnel rim so its shape reads; a product's hard case as a clearer outer shell (optional). Drawn after the opaque
//    parts without depth writes (two layers, no sorting), so the heat on the penis shows through.
// The handles (tip = length, side = girth, corona = glans, the pad on the mound, the stroke window's two markers) are
// screen-space points projected from the model (handles3d), each with its drag direction in px per mm (dragMm).
// Orientation (paw-iaai): 'up' (the default) draws the model frame turned so the penis points up and the sleeve travels
// up and down (orientView: model y -> world z, its underside toward a camera in front), the floor under the mound;
// 'side' is the old lying view. The sleeve is soft (from the model's own state): its channel stretched over the penis
// and its wall keeping its cross-section (stroker.js wallOuter: thinner, bulging out, against a case's inside), the
// inner wall lagging the shell by the solver's friction lag (the lip rolls in going down, everts coming up; the sleeve
// compresses or stretches lengthwise, graded entrance -> far end), a closed end ballooning as the tip presses it and
// drawn in by the suction, the ridges springing back past their rest with the Machine's wobble constants. Softness 0:
// rigid. Style: 'clean' (flat, the heat painted on) or 'realistic' (matte skin, a scrotum, a glossy sleeve, a hard
// clear case, a soft ground shadow, tone-mapped; the heat an optional overlay), through gl3d.js uniforms that default
// to the Machine's look. The pad's surface fades to clear at its rim. Realistic with the mesh loaded (paw-45rb,
// penismesh.js): the penis and the scrotum are the CC0 model's, the penis stretched along and round its axis to the size
// handles (its contact profile is the mesh's own: geometry(..., mesh)), filled per frame as the revolved one is.
import { createGL, upload, drop, draw, trs, project, box, sphere, mul } from './gl3d.js';
import { pressureAt, channelAt, padPress, seated, wallOuter, REF } from './stroker.js';
import { WOBBLE } from './physics.js';
import { validCam, viewOf } from './camera.js';
import { axialMap, profAt } from './penismesh.js';

export const SEG = 32, WALL = 13, MOUND_R = 78;
/** The stroker's camera presets per orientation. Upright: the penis up the screen (front, 3/4, side, from above);
 *  lying: along +y across the screen (side, 3/4 from the tip's side, top, tip-on). */
export const PRESETS_BY = Object.freeze({
  up: { front: { az: 0, el: 8 }, quarter: { az: 38, el: 18 }, side: { az: 90, el: 8 }, top: { az: 20, el: 72 } },
  side: { side: { az: 90, el: 6 }, quarter: { az: 125, el: 24 }, top: { az: 90, el: 89 }, tip: { az: 180, el: 12 } },
});
export const STROKER_PRESETS = PRESETS_BY.side;
export const UP_TILT = Math.PI / 2;
/** A preset's camera: framed on the penis (its middle, in the world's frame for the orientation). */
export const strokerCam = (k, L, orient = 'side') => ({ ...(PRESETS_BY[orient]?.[k] || PRESETS_BY[orient === 'up' ? 'up' : 'side'].quarter), zoom: 1, pan: orient === 'up' ? [0, 0, L * 0.5] : [0, L * 0.55, 0], shift: 0 });
/** stroker.cam / stroker.camUp as stored (paw-garg): the pan as a fraction of the length L. */
export const camToStore = (c, L) => ({ az: c.az, el: c.el, zoom: c.zoom, shift: c.shift, panL: c.pan.map((v) => v / L) });
/** The camera from its setting (camToStore, or an older one with the pan in mm), else the orientation's 3/4 view. */
export const camOf = (stored, L, orient = 'side') => (stored && typeof stored === 'object'
  ? validCam(Array.isArray(stored.panL) ? { ...stored, pan: stored.panL.map((v) => v * L) } : stored) : strokerCam('quarter', L, orient));
// upright: model (x, y, z) -> world (-x, z, y): the axis up, the underside (frenulum, scrotum) toward a camera in
// front and the top (dorsal) toward the body behind, as a person stands (a rotation: det +1)
const UPM = Float32Array.of(-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
const fromWorld = (p) => [-p[0], p[2], p[1]];
/** The view in the model's frame for an orientation (upright: the model turned so +y points up); eye / dir / right /
 *  up come back in the model's frame (the lighting, the handles' sides). */
export const orientView = (v, orient) => (orient === 'up' ? { ...v, vp: mul(v.vp, UPM), eye: fromWorld(v.eye), dir: fromWorld(v.dir), right: fromWorld(v.right), up: fromWorld(v.up), tilt: UP_TILT } : v);
/** Distance at zoom 1 that fits the model's key points (model frame) on the canvas for this camera and orientation
 *  (camera.js fitDist's bisection, with the model turned). */
export function fitView(cam, pts, w, h, orient, margin = 0.9) {
  const c = { ...cam, zoom: 1, pan: [0, 0, 0] };
  const ok = (d) => { const v = orientView(viewOf(c, d, w, h), orient); return pts.every((q) => { const x = v.vp[0] * q[0] + v.vp[4] * q[1] + v.vp[8] * q[2] + v.vp[12], y = v.vp[1] * q[0] + v.vp[5] * q[1] + v.vp[9] * q[2] + v.vp[13], ww = v.vp[3] * q[0] + v.vp[7] * q[1] + v.vp[11] * q[2] + v.vp[15]; return ww > 0 && Math.abs(x / ww) <= margin && Math.abs(y / ww) <= margin; }); };
  let a = 30, b = 30000;
  if (ok(a)) return a;
  for (let i = 0; i < 32; i++) { const m = Math.sqrt(a * b); if (ok(m)) b = m; else a = m; }
  return b;
}

// ---- pure helpers ----
/** Screen px moved by (dx, dy) -> mm along a handle's drag direction (a = px per mm on screen); 0 when the direction is
 *  edge-on (shorter than 0.05 px per mm: looking along it). */
export function dragMm(a, dx, dy) {
  const l2 = a[0] * a[0] + a[1] * a[1];
  return l2 < 0.0025 ? 0 : (dx * a[0] + dy * a[1]) / l2;
}
/** The radial direction across the axis that points most up the screen (the girth handle's side), from the view's up. */
export function sideOf(up) {
  const x = up[0], z = up[2], l = Math.hypot(x, z);
  return l < 1e-6 ? [0, 0, 1] : [x / l, 0, z / l];
}
/** The side across the axis for the handles: up the screen when the axis lies across it, else to the screen's right
 *  (upright, the axis runs up the screen: the girth handle and the rail go sideways). */
export function sideFor(view) {
  const u = view.up, r = view.right;
  return Math.hypot(u[0], u[2]) >= 0.5 ? sideOf(u) : sideOf(r);
}
const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** The pubic mound's height (y, mm) at radius rho from the axis: level with the base at the penis, falling away. */
export const moundY = (rho, rb) => -18 * sm((rho - rb) / (MOUND_R - rb)) ** 0.8;
/** The mound dented under the case's rim (radius rimR) when the case front is at y = front (only where it is lower). */
export function dentedY(rho, rb, rimR, front) {
  const y = moundY(rho, rb), g = 1 - sm((rho - rimR) / 16);
  return y - Math.max(0, y - front) * g;
}

/**
 * The handles in screen px for the view (vp on a w x h canvas): [{key, x, y, a: px per mm of its drag, at: world}].
 * tip / glans drag along the axis (glans: toward the base = longer), girth across it (side), pad into the body on the
 * mound, down / up along a rail under the model (offset `under` mm the other way from the side).
 */
export function handles3d({ L, glansMm, R, rig, outer, c = 0 }, view, w, h) {
  const P = (p) => project(view.vp, p, w, h);
  // the side across the axis that shows most on screen (from the view's up or its right: upright, the axis runs up the
  // screen and the handles and the rail go sideways)
  const spread = (d) => { const a = P([0, L / 2, 0]), b = P([d[0] * 10, L / 2, d[2] * 10]); return Math.hypot(b[0] - a[0], b[1] - a[1]); };
  const cu = sideOf(view.up), cr = sideOf(view.right), side = spread(cu) >= spread(cr) * 0.8 ? cu : cr, under = outer + 14;
  const at = (y, r = 0, dir = side) => [dir[0] * r, y, dir[2] * r];
  const per = (p, d) => { const a = P(p), b = P([p[0] + d[0], p[1] + d[1], p[2] + d[2]]); return { x: a[0], y: a[1], wv: a[2], a: [b[0] - a[0], b[1] - a[1]] }; };
  const Y = [0, 1, 0], mk = (key, p, d) => ({ key, at: p, ...per(p, d) });
  const neg = [-side[0], 0, -side[2]], padR = Math.max(R + 30, outer + 8);
  return [
    mk('tip', at(L + 3), Y),
    mk('girth', at(L * 0.42, R), side),
    mk('glans', at(L - glansMm, R * 1.05, neg), [0, -1, 0]),
    mk('pad', at(moundY(padR, R) - Math.min(c, 4), padR, side), [0, -1, 0]),
    mk('down', at(rig.downMm, under, neg), Y),
    mk('up', at(rig.upMm, under, neg), Y),
  ].filter((q) => q.wv > 0);
}
/** The nearest handle within `hit` px, or null. */
export function hitHandle(hs, x, y, hit = 14) {
  let best = null, bd = hit;
  for (const q of hs) { const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = q; } }
  return best;
}

// ---- meshes (fixed topology, filled in place) ----
/** A surface of revolution: `rings` rings of SEG + 1 vertices (the seam doubled), quads between the ring pairs in
 *  `joins`, fans to the poles ([ring] each, after the rings). */
function revolved(rings, joins, col = false, poles = []) {
  const nv = rings * (SEG + 1) + poles.length, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = [];
  const q = (a, b) => { for (let j = 0; j < SEG; j++) { const i0 = a * (SEG + 1) + j, i1 = b * (SEG + 1) + j; idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1); } };
  for (const [a, b] of joins) q(a, b);
  poles.forEach(([r], k) => { const c = rings * (SEG + 1) + k; for (let j = 0; j < SEG; j++) idx.push(c, r * (SEG + 1) + j, r * (SEG + 1) + j + 1); });
  return { pos, nor, idx: Uint16Array.from(idx), ...(col ? { col: new Float32Array(nv * 4) } : {}), rings, poles: poles.length };
}
const chain = (a, b) => Array.from({ length: b - a }, (_, i) => [a + i, a + i + 1]);
const TH = Float32Array.from({ length: SEG + 1 }, (_, j) => (j / SEG) * 2 * Math.PI);
const COS = TH.map(Math.cos), SIN = TH.map(Math.sin);
/** Angular distance from the underside (theta = -pi/2: z negative) and from the top. */
const fromBottom = TH.map((t) => Math.abs(Math.atan2(Math.sin(t + Math.PI / 2), Math.cos(t + Math.PI / 2))));
const fromTop = TH.map((t) => Math.abs(Math.atan2(Math.sin(t - Math.PI / 2), Math.cos(t - Math.PI / 2))));
// cross-section shapes (multipliers on the radius per vertex round the ring)
export const RIDGE = TH.map((_, j) => 0.045 * Math.exp(-((fromBottom[j] / 0.33) ** 2)));          // the urethral ridge, underside of the shaft
export const NOTCH = TH.map((_, j) => 0.11 * Math.exp(-((fromBottom[j] / 0.38) ** 2)));           // the frenulum's notch under the corona
export const SLIT = TH.map((_, j) => 0.4 * Math.max(Math.exp(-((fromBottom[j] / 0.22) ** 2)), Math.exp(-((fromTop[j] / 0.22) ** 2))));   // the meatus

/** Ring i at height y: radius r times mul(j), centre offset in z (cz), the profile's slope dr/dy (normals). */
function ring(m, i, y, r, cz, slope, mul = null) {
  const nl = Math.hypot(1, slope);
  for (let j = 0; j <= SEG; j++) {
    const k = (i * (SEG + 1) + j) * 3, rr = mul ? r * mul(j) : r;
    m.pos[k] = rr * COS[j]; m.pos[k + 1] = y; m.pos[k + 2] = cz + rr * SIN[j];
    m.nor[k] = COS[j] / nl; m.nor[k + 1] = -slope / nl; m.nor[k + 2] = SIN[j] / nl;
  }
}
const pole = (m, k, y, cz, ny) => { const o = (m.rings * (SEG + 1) + k) * 3; m.pos[o] = 0; m.pos[o + 1] = y; m.pos[o + 2] = cz; m.nor[o] = 0; m.nor[o + 1] = ny; m.nor[o + 2] = 0; };
const paint = (m, i, c, a = 1) => { for (let j = 0; j <= SEG; j++) { const k = (i * (SEG + 1) + j) * 4; m.col[k] = c[0]; m.col[k + 1] = c[1]; m.col[k + 2] = c[2]; m.col[k + 3] = a; } };

/** The penis mesh for a length and a pad: PEN_RINGS spread over the shaft showing (root to tip), a closing ring and the
 *  tip's pole. */
export const penRings = (L, pad) => Math.floor((L + pad) / 2) + 3;
export function penisMesh(L, pad) { const n = penRings(L, pad); return revolved(n, chain(0, n - 1), true, [[n - 1]]); }
export const MOUND_RINGS = 22;
export const moundMesh = () => revolved(MOUND_RINGS, chain(0, MOUND_RINGS - 1), true);   // (coloured: its rim fades to clear)
export const SL_RINGS = 64;   // (enough to show the Quickshot's ridges)
/** The clear sleeve's inner wall: rings entrance -> far end, closed by a pole at a closed end; coloured (the tint). */
export const innerMesh = (open) => revolved(SL_RINGS + 1, chain(0, SL_RINGS), true, open ? [] : [[SL_RINGS]]);
/** Its outer body: the entrance lip (a copy of inner ring 0), the outer rings, the far lip (a copy of the last inner
 *  ring) at an open end or a pole at a closed one. */
export const outerMesh = (open) => { const n = SL_RINGS + 3; return revolved(n, open ? chain(0, n - 1) : chain(0, n - 2), true, open ? [] : [[n - 2]]); };
export const CASE_RINGS = 30;
export const caseMesh = (open) => revolved(CASE_RINGS, chain(0, CASE_RINGS - 1), false, open ? [] : [[CASE_RINGS - 1]]);

/** The realistic penis from the mesh (penismesh.js, paw-45rb): its own vertex count and triangles, filled per frame. */
export function meshPenis(mesh) { const n = mesh.pen.pos.length / 3; return { pos: new Float32Array(n * 3), nor: new Float32Array(n * 3), col: new Float32Array(n * 4), idx: mesh.pen.idx, mesh, key: '' }; }
/** Per body (kept on the drawable until the size changes): each vertex's station, the axial stretch there, the radius
 *  the mesh has there at this girth (+1 mm: a safe ratio at the tip), and its glans tint (the corona band half). */
function meshStations(pm, geo) {
  const b = geo.body, key = `${b.lengthMm}|${b.glansMm}|${b.padMm}|${b.girthMm}`;
  if (pm.key === key) return pm.st;
  const sh = pm.mesh, P = sh.pen.pos, Z = sh.pen.zones, n = P.length / 3, map = axialMap(sh, b), k = b.girthMm / (2 * Math.PI) / sh.R0;
  const st = { s: new Float32Array(n), a: new Float32Array(n), d: new Float32Array(n), tint: new Float32Array(n), k };
  for (let v = 0; v < n; v++) {
    const s0 = sh.L0 - P[v * 3 + 1];
    st.s[v] = map.to(s0); st.a[v] = Math.max(1e-3, map.stretch(s0)); st.d[v] = k * profAt(sh, s0) + 1;
    st.tint[v] = (Z[v * 4] + 0.5 * Z[v * 4 + 1]) / 255;
  }
  pm.key = key; pm.st = st;
  return st;
}
/** Fill the mesh penis for a frame: each vertex at its station (dragged with the skin, swaying), scaled round the axis
 *  to the profile there as pressed (rvis: what the contact uses), its normal through the same stretch; coloured as the
 *  revolved one (skin / glans tint, heat per station, the sulcus and the sleeve's lip a little darker). */
function fillMeshPenis(pm, geo, s, { rvis, drag, sway, heatOn, colors, seat, norm }) {
  const st = meshStations(pm, geo), P = pm.mesh.pen.pos, Nn = pm.mesh.pen.nor, n = P.length / 3, L = geo.L, g = geo.body.glansMm, ns = geo.rp.length;
  const rv = new Float32Array(ns);
  for (let i = 0; i < ns; i++) rv[i] = rvis(i);
  for (let v = 0; v < n; v++) {
    // (the meatus's lips stand a hair past the tip's station: placed there, read at the tip)
    const sv = Math.max(0, Math.min(ns - 1, st.s[v])), i = Math.min(ns - 2, Math.floor(sv)), f = sv - i, r = rv[i] + (rv[i + 1] - rv[i]) * f;
    const k = (st.k * (r + 1)) / st.d[v], a = st.a[v], o = v * 3, z = L - st.s[v], y = z + drag(z);
    pm.pos[o] = P[o] * k; pm.pos[o + 1] = y; pm.pos[o + 2] = P[o + 2] * k + sway(y);
    const nx = Nn[o] * a, ny = Nn[o + 1] * k, nz = Nn[o + 2] * a, nl = Math.hypot(nx, ny, nz) || 1;
    pm.nor[o] = nx / nl; pm.nor[o + 1] = ny / nl; pm.nor[o + 2] = nz / nl;
    const ri = Math.round(sv), h = heatOn ? (s.heat[ri] || 0) * norm / 1.1 : 0;
    const c = heatColor(mixc(colors.skin, colors.glans, st.tint[v]), colors.heat, h);
    const ao = 1 - 0.22 * Math.exp(-(((sv - g - 3) / 2.5) ** 2)) - (s.e < L ? 0.14 * Math.exp(-(((z - seat) / 3) ** 2)) : 0), q = v * 4;
    pm.col[q] = c[0] * ao; pm.col[q + 1] = c[1] * ao; pm.col[q + 2] = c[2] * ao; pm.col[q + 3] = 1;
  }
}

/** The heat colour: neutral -> heat by sqrt(v) (one hue, sequential); rgb 0..1. */
export const heatColor = (base, hot, v) => { const f = Math.sqrt(Math.max(0, Math.min(1, v))); return [base[0] + (hot[0] - base[0]) * f, base[1] + (hot[1] - base[1]) * f, base[2] + (hot[2] - base[2]) * f]; };
const mixc = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

/** The case's outer radius x mm from its front: a flared entrance end (the classic's base), a middle band (the
 *  Quickshot's), else its barrel; drawn only. */
export function caseRadius(sl, x) {
  const Lc = sl.caseMm || sl.lengthMm, f = x / Lc, barrel = (sl.caseOuterMm || 60) / 2, ent = (sl.entranceOuterMm || sl.caseOuterMm || 60) / 2;
  const [f0, fw] = sl.flare || [0.22, 0.14];   // where the entrance end's flare (or the Flight's taper) gives way to the barrel
  let r = barrel + (ent - barrel) * (1 - sm((f - f0) / fw));
  if (sl.bandOuterMm) r = Math.max(r, barrel + (sl.bandOuterMm / 2 - barrel) * (1 - sm((Math.abs(f - 0.5) - 0.17) / 0.04)));
  return r;
}

/**
 * Fill every mesh for a state: s (stroker.js stateAt), geo, wob (sway, mm at the tip), colours {skin, glans, heat,
 * body, sleeve, tint} (rgb 0..1), the sleeve. -> {outer (the widest the sleeve or case gets: the rail), tipY, c (the
 * pad pressed in), seat, caseFront}
 */
export function fillMeshes(M, geo, s, wob, colors, sleeve, o = {}) {
  const L = geo.L, b = geo.body, g = b.glansMm, n = geo.rp.length, pp = padPress(geo, s.e), c = pp.c, seat = seated(geo, s.e);
  const soft = sleeve.soft ?? 0.5, heatOn = o.heat !== false, dyn = o.dyn || null;
  const seatD = Number.isFinite(s.drive) ? seated(geo, s.drive) : seat;   // the shell, where the hand holds it
  const skin = s.skin || 0, sway = (y) => wob * (Math.max(0, y) / L) ** 2;
  const rAt = (st) => { const k = Math.max(0, Math.min(n - 1, st)), i = Math.floor(k), f = k - i; return geo.rp[i] + (geo.rp[Math.min(n - 1, i + 1)] - geo.rp[i]) * f; };
  const press = (st) => Math.min(1, pressureAt(geo, Math.max(0, Math.min(n - 1, Math.round(st))), s.e));
  const rvis = (st) => rAt(st) * (1 - 0.08 * press(st));
  // the shaft's skin dragged with the sleeve: strongest near the entrance, anchored at the body and behind the corona
  const drag = (z) => skin * Math.exp(-(((z - seat) / 28) ** 2)) * sm((z + c) / 12) * sm((L - g - 6 - z) / 10);
  // the penis: rings from the root showing (z = -c) to the tip
  const pm = M.pm, nr = pm.rings - 1, norm = 30 / REF;
  const tipY = L + 0.6;
  if (pm.mesh) fillMeshPenis(pm, geo, s, { rvis, drag, sway, heatOn, colors, seat, norm });
  else {
  for (let i = 0; i < nr; i++) {
    const z = -c + ((L + c) * i) / (nr - 1), st = L - z, r = rvis(st), slope = (rvis(st - 1) - rvis(st + 1)) / 2;
    const ridge = sm((st - g - 6) / 8), notch = Math.exp(-(((st - (g - 2)) / 3) ** 2)), slit = Math.max(0, 1 - st / 3.5);
    ring(pm, i, z + drag(z), r, sway(z), slope, (j) => 1 + ridge * RIDGE[j] - notch * NOTCH[j] - slit * SLIT[j]);
    const base = st < g ? colors.glans : colors.skin, h = heatOn ? (s.heat[Math.max(0, Math.min(n - 1, Math.round(st)))] || 0) * norm / 1.1 : 0;
    // a little ambient occlusion: in the sulcus, and where the sleeve's lip seals on the skin
    const ao = 1 - 0.22 * Math.exp(-(((st - g - 3) / 2.5) ** 2)) - (s.e < L ? 0.14 * Math.exp(-(((z - seat) / 3) ** 2)) : 0);
    const cRing = heatColor(base, colors.heat, h);
    for (let j = 0; j <= SEG; j++) { const k = (i * (SEG + 1) + j) * 4, dark = 1 - (1 - slit * SLIT[j] * 1.6) * ao; pm.col[k] = cRing[0] * (1 - dark); pm.col[k + 1] = cRing[1] * (1 - dark); pm.col[k + 2] = cRing[2] * (1 - dark); pm.col[k + 3] = 1; }
  }
  ring(pm, nr, tipY, 0.01, sway(L), 0);
  paint(pm, nr, heatColor(colors.glans, colors.heat, heatOn ? (s.heat[0] || 0) * norm / 1.1 : 0));
  pole(pm, 0, tipY + 0.3, sway(L), 1);
  pm.col.set([...colors.glans, 1], pm.rings * (SEG + 1) * 4);
  }
  // the mound, dented under the case's rim when the case front is pushed into it
  const Ls = sleeve.lengthMm, front = seat - (sleeve.frontMm || 0), wall = Ls < 40 ? 9 : WALL;
  const rb = geo.rp[Math.min(n - 1, L)] * 1.02, rimR = sleeve.caseMm ? caseRadius(sleeve, 0) : (channelAt(sleeve, 0) || 8) + wall, mm = M.mm;
  for (let i = 0; i < MOUND_RINGS; i++) {
    const rho = rb + ((MOUND_R - rb) * i) / (MOUND_RINGS - 1), y = dentedY(rho, rb, rimR, front), d = (dentedY(rho + 1, rb, rimR, front) - dentedY(rho - 1, rb, rimR, front)) / 2;
    const nl = Math.hypot(d, 1);
    for (let j = 0; j <= SEG; j++) { const k = (i * (SEG + 1) + j) * 3; mm.pos[k] = rho * COS[j]; mm.pos[k + 1] = y; mm.pos[k + 2] = rho * SIN[j]; mm.nor[k] = (-d * COS[j]) / nl; mm.nor[k + 1] = 1 / nl; mm.nor[k + 2] = (-d * SIN[j]) / nl; }
    // the pad's surface fades to clear toward its rim (no hard edge, no block)
    paint(mm, i, colors.body, 1 - sm((rho - rb - 30) / (MOUND_R - rb - 30)) ** 1.5);
  }
  // the clear sleeve: the channel stretched over the penis, tinted where it presses; its body to the case's inside
  const N = SL_RINGS + 1, im = M.im, om = M.om;
  let outerMax = 0;
  const innerAt = (x) => { const z = seat + x, rc = channelAt(sleeve, Math.min(Ls, Math.max(0, x))), st = L - z, rp = z >= -c && z <= L ? rvis(st) : 0; return { rc, ri: Math.max(rc, rp), z, p: z >= -c && z <= L ? press(st) : 0 }; };
  // the closed end: pushed out by the tip and ballooning, drawn in by the suction on withdrawal (both soft)
  const endMm = s.endMm || 0, balloon = soft * endMm * 0.6, suck = soft * (s.suction || 0) * 2.2;
  const yEnd = Math.max(seat + Ls, sleeve.open ? -Infinity : tipY + 0.5);
  // the inner wall lags the shell by the solver's friction lag, most at the entrance (the lip rolls), least at the far end
  const lag = seat - seatD;
  for (let i = 0; i < N; i++) {
    const x = (Ls * i) / SL_RINGS, a = innerAt(x), f = x / Ls, y = i === N - 1 ? yEnd : a.z - lag * f;
    // the channel springs back past its rest where the penis leaves it (the Machine's wobble: a little overshoot)
    const target = a.ri + (a.ri > a.rc ? 0.5 : 0), ri = dyn ? dyn.radius(i, target, soft) : target;
    const endBulge = !sleeve.open ? balloon * Math.exp(-(((Ls - x) / 10) ** 2)) : 0;
    ring(im, i, y, ri + endBulge, sway(Math.max(0, Math.min(L, a.z))), 0);   // (a hair off the skin where it grips: no z-fight)
    paint(im, i, mixc(colors.sleeve, colors.tint, Math.min(1, a.p * 2.2)), 1);
    // the wall keeps its cross-section: thinner where stretched, bulging out (softness scales it), against a case's inside
    const caseIn = sleeve.caseMm ? caseRadius(sleeve, x + (sleeve.frontMm || 0)) - 2.5 : Infinity, ro0 = Math.min(caseIn, a.rc + wall);
    const bulged = ro0 + (wallOuter(a.rc, ri, ro0) - ro0) * (0.35 + 0.65 * soft), ro = Math.min(caseIn, Math.max(ri + 1.5, bulged)) + endBulge;
    const yo = seatD + x + (i === N - 1 && !sleeve.open ? Math.max(0, yEnd - seatD - Ls) + 2 + balloon * 0.5 - suck : 0);
    ring(om, i + 1, yo, ro, sway(Math.max(0, Math.min(L, a.z))), 0);
    const thick = Math.max(0, ro - ri);
    paint(om, i + 1, mixc(colors.sleeve, colors.thick || colors.sleeve, Math.min(1, thick / 22)), 1);
    outerMax = Math.max(outerMax, ro);
  }
  if (!sleeve.open) pole(im, 0, yEnd + balloon * 0.5 - suck, sway(L), -1);
  // the lips: the outer body's first and last rings on the inner wall's
  const copy = (from, fi, to, ti) => { to.pos.set(from.pos.subarray(fi * (SEG + 1) * 3, (fi + 1) * (SEG + 1) * 3), ti * (SEG + 1) * 3); to.nor.set(from.nor.subarray(fi * (SEG + 1) * 3, (fi + 1) * (SEG + 1) * 3), ti * (SEG + 1) * 3); };
  copy(im, 0, om, 0);
  paint(om, 0, colors.sleeve, 1);
  if (sleeve.open) { copy(im, N - 1, om, N + 1); paint(om, N + 1, colors.sleeve, 1); }
  else pole(om, 0, om.pos[N * (SEG + 1) * 3 + 1], sway(L), 1);
  // the case: a clearer shell over the case length, from its front
  if (M.cm) {
    const Lc = sleeve.caseMm || Ls, cm = M.cm;
    for (let i = 0; i < CASE_RINGS; i++) {
      const x = (Lc * i) / (CASE_RINGS - 1), r = caseRadius(sleeve, x), y = Math.max(front + x, i === CASE_RINGS - 1 && !sleeve.open ? yEnd + 4 : -Infinity);
      ring(cm, i, y, r, sway(Math.max(0, Math.min(L, front + x))), (caseRadius(sleeve, x + 1) - caseRadius(sleeve, x - 1)) / 2);
      outerMax = Math.max(outerMax, r);
    }
    if (!sleeve.open) pole(cm, 0, cm.pos[(CASE_RINGS - 1) * (SEG + 1) * 3 + 1], sway(L), 1);
  }
  return { outer: outerMax, tipY, c, seat, seatD, caseFront: front, balloon, suck };
}

/** Rewrite a drawable's vertex buffers from its arrays (same sizes: no reallocation). */
function refresh(G, b, m) {
  const { gl } = G;
  for (const k of ['pos', 'nor', 'col']) if (m[k] && b[k]) { gl.bindBuffer(gl.ARRAY_BUFFER, b[k]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, m[k]); }
}

/** The view-only sway of the shaft (mm at the tip): the Machine's wobble oscillator, kicked by the sleeve's turns. */
export class Sway {
  x = 0; v = 0; lastV = 0;
  step(v, dtMs, playing) {
    if (!playing) { this.x = 0; this.v = 0; this.lastV = v; return 0; }
    const dt = Math.min(0.05, Math.max(0, dtMs / 1000)), w = 2 * Math.PI * WOBBLE.hz, kick = (v - this.lastV) * 0.004 * WOBBLE.gain;
    this.lastV = v; this.v += kick;
    for (let k = 0; k < 4; k++) { const h = dt / 4; this.v += (-w * w * this.x - 2 * WOBBLE.zeta * w * this.v) * h; this.x += this.v * h; }
    this.x = Math.max(-WOBBLE.maxMm, Math.min(WOBBLE.maxMm, this.x));
    return this.x;
  }
}

/** The channel's spring-back per inner ring (view only, from the model's target radius): where the penis leaves a
 *  stretched ring it relaxes past its rest and settles (the Machine's wobble constants); softness scales the swing,
 *  paused it rests on the target. */
export class RingDyn {
  constructor(n) { this.r = new Float32Array(n); this.v = new Float32Array(n); this.ok = false; this.dt = 0; this.on = false; }
  /** Set the step for this frame (ms) and whether it moves (playing). */
  frame(dtMs, playing) { this.dt = Math.min(0.05, Math.max(0, dtMs / 1000)); this.on = playing; }
  radius(i, target, soft) {
    if (!this.ok || !this.on || !(soft > 0)) { this.r[i] = target; this.v[i] = 0; return target; }
    const w = 2 * Math.PI * WOBBLE.hz * 3, z = WOBBLE.zeta;   // (a ring is stiffer than a whole toy: three times the wobble's rate)
    let r = this.r[i], v = this.v[i];
    if (target > r) { r = target; v = 0; }   // pushed open at once by the penis
    else for (let k = 0; k < 4; k++) { const h = this.dt / 4; v += (-w * w * (r - target) - 2 * z * w * v) * h; r += v * h; }
    this.r[i] = r; this.v[i] = v;
    return target + (r - target) * soft;
  }
}

/** Every mesh for a shape (rebuilt only when the length, the pad, the end, the case or the penis mesh changes). */
export function meshesFor(L, pad, open, withCase, mesh = null) {
  return { pm: mesh ? meshPenis(mesh) : penisMesh(L, pad), mm: moundMesh(), im: innerMesh(open), om: outerMesh(open), cm: withCase ? caseMesh(open) : null };
}
/** The mesh's scrotum placed for the girth and the pad pressed in by c (mm), a wobble w: scaled with the girth, lifted
 *  to rest on the mound (the source's hangs into the body below the base), drawn down a little as the pad is pressed
 *  (as scrotumAt). -> {at, k} */
export const SCROTUM_LIFT = 12;
export const scrotumPlace = (mesh, R, c, w = 0) => { const k = R / mesh.R0; return { at: [0, SCROTUM_LIFT * k - c * 0.6, w], k }; };
/** Where the scrotum's two lobes sit (model frame) for a penis of base radius R, the pad pressed in by c, a wobble w
 *  (mm): under the base on the underside, hanging a little forward of the body. -> [[centre, radii] x2] */
export function scrotumAt(R, c, w = 0) {
  const y = 7 - c * 0.6, z = -(R + 12) + w;
  return [[[-7.5, y, z], [14, 15, 18]], [[7.5, y + 1, z - 1], [14, 15, 18]]];   // (two lobes overlapping: one sac with a soft cleft)
}
/** A flat disc in the world's floor plane (radius 1, about z): the soft ground shadow, drawn in a few rings. */
function floorDisc(seg = 40) {
  const pos = [0, 0, 0], nor = [0, 0, 1], idx = [];
  for (let j = 0; j <= seg; j++) { const t = (j / seg) * 2 * Math.PI; pos.push(Math.cos(t), Math.sin(t), 0); nor.push(0, 0, 1); }
  for (let j = 1; j <= seg; j++) idx.push(0, j, j + 1);
  return { pos: Float32Array.from(pos), nor: Float32Array.from(nor), idx: Uint16Array.from(idx) };
}

export class StrokerScene {
  constructor(canvas) {
    this.canvas = canvas; this.G = createGL(canvas); this.lost = false; this.B = {};
    this.unitBox = upload(this.G, box()); this.disc = upload(this.G, floorDisc()); this.ball = upload(this.G, sphere(18, 28));
    this.bounce = new Sway();   // the scrotum's own wobble (view only)
    this.dyn = new RingDyn(SL_RINGS + 1);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
  }
  setShape(L, pad, open, withCase, mesh = null) {
    const key = `${L}|${pad}|${open}|${withCase}|${!!mesh}`;
    if (key === this.key) return;
    this.key = key;
    for (const b of Object.values(this.B)) drop(this.G, b);
    this.M = meshesFor(L, pad, open, withCase, mesh); this.B = {};
    if (mesh && !this.scrot) this.scrot = upload(this.G, mesh.scrot);   // (static: placed by its model matrix)
    this.fresh = true; this.dyn.ok = false;
  }
  /** One frame: f {w, h, dpr, view (the model's frame: orientView), floorVp (the world's, for the floor), floorZ, orient,
   *  geo, s, wob, sleeve, showCase, style ('clean' | 'realistic'), heat (paint it), dtMs, playing, colors: {bg, grid,
   *  body, skin, glans, heat, sleeve, thick, tint, edge, warm, shadow}}. -> fill info (fillMeshes). */
  render(f) {
    const { gl } = this.G, G = this.G, W = Math.max(1, Math.round(f.w * f.dpr)), H = Math.max(1, Math.round(f.h * f.dpr));
    const withCase = !!(f.showCase && f.sleeve.caseMm), real = f.style === 'realistic', mesh = real ? f.geo.mesh : null;
    this.setShape(f.geo.L, f.geo.body.padMm, f.sleeve.open, withCase, mesh);
    this.dyn.frame(f.dtMs || 0, !!f.playing);
    const info = fillMeshes(this.M, f.geo, f.s, f.wob, f.colors, f.sleeve, { heat: f.heat !== false, dyn: this.dyn });
    this.dyn.ok = true;
    for (const [k, m] of Object.entries(this.M)) { if (!m) continue; if (this.fresh || !this.B[k]) this.B[k] = upload(G, m, this.B[k]); else refresh(G, this.B[k], m); }
    this.fresh = false;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.clearColor(...f.colors.bg, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const v = f.view, light = [0, 1, 2].map((i) => v.dir[i] - 0.45 * v.right[i] + 0.6 * v.up[i]), ll = Math.hypot(...light);
    const I = trs([0, 0, 0], [1, 1, 1]), N3 = Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1);
    const common = { uGlow: 0, uRimOn: 0, uFade: [0, 0, 0, 0], uFlagA: -1, uColonOn: 0, uPush: 0, uLatOn: 0, uProsI: 0, uVP: v.vp, uSkin: 0, uTube: 0, uDash: 0, uEye: v.eye, uLight: light.map((x) => x / ll),
      uToy: 0, uBody: 0, uNrmOn: 0, uTexOn: 0, uColOn: 0, uClipOn: 0, uAlpha: 1, uRimA: 0, uVAlpha: 0, uReal: 0, uSpecK: 0, uTone: real ? 1 : 0, uWarm: f.colors.warm || [1, 0.5, 0.4],
      uGrid: 0, uShine: 0.05, uContour: [0, 0], uClip: [0, 0, 1, 0], uLip: f.colors.edge, uInner: f.colors.sleeve, uEdge: f.colors.edge, uModel: I, uNorM: N3 };
    const B = this.B, up = f.orient === 'up';
    // the floor grid (in the world's frame: under the mound upright, under the model lying), and a soft ground shadow
    const zr = up ? (f.floorZ ?? -40) : -(info.outer + 22), fvp = up ? f.floorVp || v.vp : v.vp, eyeW = up ? f.floorEye || v.eye : v.eye;
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    if (eyeW[2] > zr) {
      draw(G, this.unitBox, { ...common, uVP: fvp, uModel: trs([0, up ? 0 : 60, zr], [3000, 3000, 0.1]), uColor: f.colors.grid, uGrid: 1 });
      if (real) for (const [k, a] of [[1, 0.1], [0.72, 0.12], [0.45, 0.14]]) {
        const m = up ? trs([0, 0, zr + 0.3], [95 * k, 95 * k, 1]) : trs([0, f.geo.L * 0.45, zr + 0.3], [(info.outer + 12) * k, (f.geo.L * 0.75 + 30) * k, 1]);
        draw(G, this.disc, { ...common, uVP: fvp, uModel: m, uColor: f.colors.shadow || [0, 0, 0], uAlpha: a, uTone: 0, uShine: 0 });
      }
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
    // opaque: the penis, the scrotum (realistic: matte skin, a soft wrap light, a faint warm light-through); then the
    // pad, its rim fading to clear (blended, depth kept)
    const skinU = real ? { uReal: 1, uSpecK: 10, uShine: 0.035, uEdge: f.colors.warm || f.colors.edge } : {};
    draw(G, B.pm, { ...common, uColor: f.colors.skin, uShine: 0.08, ...skinU });
    if (real && f.scrotum) {
      const w = this.bounce.step(-(f.s.v || 0) * 0.6, f.dtMs || 0, !!f.playing) * 0.7;
      if (mesh) {
        const p = scrotumPlace(mesh, f.geo.body.girthMm / (2 * Math.PI), info.c, w);
        draw(G, this.scrot, { ...common, uModel: trs(p.at, [p.k, p.k, p.k]), uColor: f.colors.skin.map((x) => x * 0.94), ...skinU });
      } else for (const [cc, rr] of scrotumAt(f.geo.rp[Math.min(f.geo.rp.length - 1, f.geo.L)], info.c, w)) {
        const m = trs(cc, rr);
        draw(G, this.ball, { ...common, uModel: m, uNorM: Float32Array.of(1 / rr[0], 0, 0, 0, 1 / rr[1], 0, 0, 0, 1 / rr[2]), uColor: f.colors.skin.map((x) => x * 0.94), ...skinU });
      }
    }
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    draw(G, B.mm, { ...common, uColor: f.colors.body, uSkin: real ? 0 : 1, ...skinU, uShine: real ? 0.03 : 0.05, uVAlpha: 1 });
    gl.disable(gl.BLEND);
    // clear: the inner wall (tinted where it presses), the sleeve's body, the case; over the opaque parts, no depth writes
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    if (real) {   // glossy silicone: more opaque edge-on, bright tight highlights, darker where thick; a hard clear case
      draw(G, B.im, { ...common, uColor: f.colors.sleeve, uAlpha: 0.3, uRimA: 0.35, uShine: 0.6, uSpecK: 48 });
      draw(G, B.om, { ...common, uColor: f.colors.sleeve, uAlpha: 0.16, uRimA: 0.6, uShine: 1.2, uSpecK: 70 });
      if (B.cm) draw(G, B.cm, { ...common, uColor: [0.85, 0.9, 0.95], uAlpha: 0.05, uRimA: 0.32, uShine: 1.6, uSpecK: 140 });
    } else {
      draw(G, B.im, { ...common, uColor: f.colors.sleeve, uAlpha: 0.3, uRimA: 0.25, uShine: 0.3 });
      draw(G, B.om, { ...common, uColor: f.colors.sleeve, uAlpha: 0.08, uRimA: 0.45, uShine: 0.35 });
      if (B.cm) draw(G, B.cm, { ...common, uColor: f.colors.edge, uAlpha: 0.04, uRimA: 0.32, uShine: 0.5 });
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
    return info;
  }
  destroy() {
    const G = this.G;
    for (const b of [...Object.values(this.B), this.unitBox, this.disc, this.ball, this.scrot]) drop(G, b);
    G.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
