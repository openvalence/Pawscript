// penismesh.js -- the Stroker's realistic penis (paw-45rb): bodies/stroker-penis.glb, written by
// dev/stroker-penis-export.py from "Easy penis auto-rigger" v2.2 by Likkez (CC0 1.0; credit in NOTICE). Pure but for
// loadPenisMesh's fetch.
// The asset (mm): mesh "penis" a grid of rings round the y axis (base 0 -> tip lengthMm; under the base the root, to
// -rootMm), the pole first, then `rings` rings of `seg` vertices tip -> root; mesh "scrotum" in the same frame; _ZONES per
// penis vertex (glans, corona, shaft, base; the scrotum's all scrotum). For a body (stroker.js validBody) every vertex
// maps to a station s (mm from the tip, stroker.js's) piecewise along the axis: the glans to the body's glans length,
// the shaft to its length, the root to its pad; round the axis by girth / the asset's. The contact profile is the mesh's
// own mean radius per station under the same map (meshProfile), so what the sleeve presses on is what is drawn.
const STEP = 0.5;   // mm between the canonical profile's samples

/** Parse the .glb (an ArrayBuffer) -> {L0, g0, R0, root0, seg, rings, pen: {pos, nor, zones, idx}, scrot: {pos, nor, idx},
 *  prof: Float32Array (mean radius every STEP mm from the tip, root included)}. */
export function parsePenisGlb(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('not a glb');
  const jl = dv.getUint32(12, true), J = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl))), bin = 28 + jl;
  const T = { 5121: Uint8Array, 5123: Uint16Array, 5126: Float32Array }, N = { SCALAR: 1, VEC3: 3, VEC4: 4 };
  const acc = (i) => { const a = J.accessors[i], v = J.bufferViews[a.bufferView]; return new T[a.componentType](buf, bin + (v.byteOffset || 0) + (a.byteOffset || 0), a.count * N[a.type]); };
  const mesh = (name) => { const p = J.meshes.find((m) => m.name === name).primitives[0], at = p.attributes; return { pos: acc(at.POSITION), nor: acc(at.NORMAL), zones: at._ZONES != null ? acc(at._ZONES) : null, idx: acc(p.indices) }; };
  const x = J.asset.extras, pen = mesh('penis');
  const shape = { L0: x.lengthMm, g0: x.glansMm, R0: x.shaftR, root0: x.rootMm, seg: x.seg, rings: x.rings, credit: x.credit, pen, scrot: mesh('scrotum') };
  // the mean radius per station: round each angle's column (the pole, then its vertex in every ring: s rising), then
  // the mean over the angles
  const n = Math.ceil((shape.L0 + shape.root0) / STEP) + 1, prof = new Float32Array(n), P = pen.pos, seg = shape.seg;
  for (let j = 0; j < seg; j++) {
    let k = -1, s0 = 0, r0 = 0, s1 = shape.L0 - P[1], r1 = 0;   // (the pole: the tip, on the axis)
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      while (s > s1 && k < shape.rings - 1) { k++; const v = (1 + k * seg + j) * 3; s0 = s1; r0 = r1; s1 = shape.L0 - P[v + 1]; r1 = Math.hypot(P[v], P[v + 2]); }
      prof[i] += (s >= s1 ? r1 : s1 > s0 ? r0 + ((r1 - r0) * (s - s0)) / (s1 - s0) : r1) / seg;
    }
  }
  shape.prof = prof;
  return shape;
}

let pending = null;
/** The asset, fetched and parsed once (a promise; rejects when it cannot be read). */
export const loadPenisMesh = () => (pending ??= fetch(new URL('./bodies/stroker-penis.glb', import.meta.url)).then((r) => { if (!r.ok) throw new Error(`penis mesh ${r.status}`); return r.arrayBuffer(); }).then(parsePenisGlb));

/** The canonical mean radius s0 mm from the tip (linear between samples, the root's past the end). */
export function profAt(shape, s0) {
  const p = shape.prof, f = Math.max(0, s0) / STEP, i = Math.min(p.length - 2, Math.floor(f)), u = Math.min(1, f - i);
  return p[i] + (p[i + 1] - p[i]) * u;
}
/** The axial map for a body {lengthMm, glansMm, padMm}: canonical s0 -> the body's station s, its inverse, and the
 *  stretch ds / ds0 there. */
export function axialMap(shape, b) {
  const { L0, g0, root0 } = shape, L = b.lengthMm, g = b.glansMm, pad = b.padMm;
  const kg = g / g0, ks = (L - g) / (L0 - g0), kr = pad / root0;
  return {
    to: (s0) => (s0 <= g0 ? s0 * kg : s0 <= L0 ? g + (s0 - g0) * ks : L + (s0 - L0) * kr),
    from: (s) => (s <= g ? s / kg : s <= L ? g0 + (s - g) / ks : L0 + (pad > 0 ? (s - L) / kr : 0)),
    stretch: (s0) => (s0 <= g0 ? kg : s0 <= L0 ? ks : kr),
  };
}
/** The penis as stroker.js penisProfile gives it, from the mesh: the mean radius at every 1 mm station, tip -> root
 *  (girth scaled), a knot added as there. */
export function meshProfile(shape, b) {
  const L = b.lengthMm, R = b.girthMm / (2 * Math.PI), k = R / shape.R0, map = axialMap(shape, b), profile = [];
  for (let s = 0; s <= L + b.padMm; s++) {
    let r = k * profAt(shape, map.from(s));
    if (b.knot) r += 0.45 * R * Math.exp(-(((s - 0.86 * L) / (0.06 * L)) ** 2));
    profile.push([s, +r.toFixed(3)]);
  }
  return { length_mm: L, profile, glansMm: b.glansMm, R, rootMm: b.padMm, mesh: true };
}
