// mesh.js -- toy meshes for the Machine view, pure (no DOM). Library toys ship as toys/mesh/<sku>.bin (written by
// tools/build-toy-library.mjs); every other toy (the generic shapes, the owner's traced silhouettes) is lathed from
// its radius profile. Mesh frame, in units of the toy's length: x = across (the drawn width), s = 0 at the tip .. 1
// at the base, z = depth; about the centreline.
//
// .bin layout, little endian: 'PWM2', u32 vertex count, u32 triangle count, f32 min[3], f32 max[3] (x, s, z),
// u16 positions (x, s, z quantised over min..max), u16 uv (0..1), u16 indices. The file holds the base mesh; parseMesh
// subdivides it one level on load (subdivide: 4x the triangles, the build keeps the result under 65536 vertices).

/** -> {pos: Float32Array (x, s, z), uv: Float32Array, idx: Uint16Array, nor: Float32Array (smooth, mesh frame)},
 *  subdivided one level. */
export function parseMesh(buf) {
  const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'PWM2') throw new Error('not a toy mesh');
  const nv = dv.getUint32(4, true), nt = dv.getUint32(8, true), min = [], max = [];
  for (let k = 0; k < 3; k++) { min.push(dv.getFloat32(12 + k * 4, true)); max.push(dv.getFloat32(24 + k * 4, true)); }
  if (dv.byteLength < 36 + nv * 10 + nt * 6) throw new Error('truncated toy mesh');
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint16Array(nt * 3);
  for (let i = 0; i < nv * 3; i++) { const k = i % 3; pos[i] = min[k] + (dv.getUint16(36 + i * 2, true) / 65535) * (max[k] - min[k]); }
  const uo = 36 + nv * 6, io = uo + nv * 4;
  for (let i = 0; i < nv * 2; i++) uv[i] = dv.getUint16(uo + i * 2, true) / 65535;
  for (let i = 0; i < nt * 3; i++) idx[i] = dv.getUint16(io + i * 2, true);
  return subdivide({ pos, uv, idx, nor: smoothNormals(pos, idx) });
}

/** One level of interpolating subdivision: every triangle into four. The corners stay where they are (so profiles,
 *  centrelines and the picture fit measured on the base mesh still hold); a new vertex on each edge sits on the
 *  smooth surface the vertex normals describe (Phong tessellation, alpha 3/4), so the silhouette rounds out instead
 *  of shrinking. UVs split linearly, per vertex pair: an edge along a UV seam gets one new vertex per side, so the
 *  islands stay apart and the maps keep their placement. -> {pos, uv, idx, nor} (normals recomputed). */
export function subdivide({ pos, uv, idx, nor }) {
  const mid = new Map(), P = Array.from(pos), U = Array.from(uv);
  const edge = (a, b) => {
    const k = a < b ? a * 65536 + b : b * 65536 + a;
    let id = mid.get(k);
    if (id !== undefined) return id;
    id = P.length / 3; mid.set(k, id);
    // the flat midpoint projected onto each end's tangent plane, averaged, blended 3/4 with the flat midpoint
    const A = a * 3, B = b * 3, m = [0, 1, 2].map((r) => (pos[A + r] + pos[B + r]) / 2);
    let da = 0, db = 0;
    for (let r = 0; r < 3; r++) { da += (m[r] - pos[A + r]) * nor[A + r]; db += (m[r] - pos[B + r]) * nor[B + r]; }
    for (let r = 0; r < 3; r++) P.push(m[r] - 0.375 * (da * nor[A + r] + db * nor[B + r]));
    U.push((uv[a * 2] + uv[b * 2]) / 2, (uv[a * 2 + 1] + uv[b * 2 + 1]) / 2);
    return id;
  };
  const T = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2], ab = edge(a, b), bc = edge(b, c), ca = edge(c, a);
    T.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  if (P.length / 3 > 65535) throw new Error('subdivided toy mesh over 65535 vertices');
  const p = Float32Array.from(P), i = Uint16Array.from(T);
  return { pos: p, uv: Float32Array.from(U), idx: i, nor: smoothNormals(p, i) };
}

/** Area-weighted vertex normals; vertices at the same position (UV seams) share theirs, so seams do not show. */
export function smoothNormals(pos, idx) {
  const n = pos.length / 3, acc = new Float32Array(n * 3), key = new Map(), group = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
    let g = key.get(k);
    if (g === undefined) { g = i; key.set(k, i); }
    group[i] = g;
  }
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [idx[t], idx[t + 1], idx[t + 2]]) { const g = group[v] * 3; acc[g] += nx; acc[g + 1] += ny; acc[g + 2] += nz; }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const g = group[i] * 3, l = Math.hypot(acc[g], acc[g + 1], acc[g + 2]) || 1;
    out[i * 3] = acc[g] / l; out[i * 3 + 1] = acc[g + 1] / l; out[i * 3 + 2] = acc[g + 2] / l;
  }
  return out;
}

/** A lathed mesh from a toy's radius profile (round cross-sections), same frame and layout as parseMesh. */
export function latheMesh(toy, segs = 32) {
  const L = toy.length_mm, rings = toy.profile.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 120)) === 0 || i === a.length - 1);
  const pos = [], uv = [], idx = [];
  // tip cap point, the rings, the base cap point
  pos.push(0, 0, 0); uv.push(0, 0);
  for (const [s, r] of rings) for (let j = 0; j < segs; j++) {
    const a = (j / segs) * Math.PI * 2;
    pos.push((Math.cos(a) * r) / L, s / L, (Math.sin(a) * r) / L); uv.push(j / segs, s / L);
  }
  pos.push(0, 1, 0); uv.push(0, 1);
  const R = rings.length, last = 1 + R * segs;
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < segs; j++) {
    const a = 1 + i * segs + j, b = 1 + i * segs + ((j + 1) % segs), c = a + segs, d = b + segs;
    idx.push(a, b, c, b, d, c);
  }
  for (let j = 0; j < segs; j++) idx.push(last, 1 + (R - 1) * segs + j, 1 + (R - 1) * segs + ((j + 1) % segs));
  const P = Float32Array.from(pos), I = Uint16Array.from(idx);
  return { pos: P, uv: Float32Array.from(uv), idx: I, nor: smoothNormals(P, I) };
}

/** A toy mesh's rest centreline (its "bend prior"): per bin along s the middle of its cross-section's extents in x
 *  and z (robust to vertex density), smoothed; and the same less the straight line through the shaft (s 0.5-0.85),
 *  which the rail lines up with. -> {s: stations (0 tip .. 1 base), c: [[x, z]] (mesh units, the full centre: the
 *  mesh is expressed about it), delta: [[x, z]] (c less the shaft line: the rest curve)}. */
export function restCentre(mesh, n = 25) {
  const lo = Array.from({ length: n }, () => [Infinity, Infinity]), hi = Array.from({ length: n }, () => [-Infinity, -Infinity]), p = mesh.pos;
  for (let i = 0; i < p.length; i += 3) {
    const b = Math.max(0, Math.min(n - 1, Math.round(p[i + 1] * (n - 1))));
    lo[b][0] = Math.min(lo[b][0], p[i]); hi[b][0] = Math.max(hi[b][0], p[i]); lo[b][1] = Math.min(lo[b][1], p[i + 2]); hi[b][1] = Math.max(hi[b][1], p[i + 2]);
  }
  let c = lo.map((l, b) => (Number.isFinite(l[0]) ? [(l[0] + hi[b][0]) / 2, (l[1] + hi[b][1]) / 2] : null));
  for (let b = 0; b < n; b++) if (!c[b]) { const a = c.slice(0, b).reverse().find(Boolean), z = c.slice(b + 1).find(Boolean); c[b] = a && z ? [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2] : (a || z || [0, 0]).slice(); }
  for (let pass = 0; pass < 2; pass++) c = c.map((v, b) => { const a = c[Math.max(0, b - 1)], z = c[Math.min(n - 1, b + 1)]; return [(a[0] + 2 * v[0] + z[0]) / 4, (a[1] + 2 * v[1] + z[1]) / 4]; });
  const s = c.map((_, b) => b / (n - 1)), fit = (k) => {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let b = 0; b < n; b++) if (s[b] >= 0.5 && s[b] <= 0.85) { sw++; sx += s[b]; sy += c[b][k]; sxx += s[b] * s[b]; sxy += s[b] * c[b][k]; }
    const m = (sw * sxy - sx * sy) / (sw * sxx - sx * sx || 1);
    return [(sy - m * sx) / sw, m];
  };
  const fx = fit(0), fz = fit(1);
  return { s, c, delta: c.map((v, b) => [v[0] - fx[0] - fx[1] * s[b], v[1] - fz[0] - fz[1] * s[b]]) };
}

/** The mesh expressed about its rest centreline (x, z less the centre at its s), in place; normals are left as they
 *  are (the centre's slope is a few degrees). */
export function straighten(mesh, centre = restCentre(mesh)) {
  const { c } = centre, n = c.length, p = mesh.pos;
  for (let i = 0; i < p.length; i += 3) {
    const x = Math.max(0, Math.min(n - 1, p[i + 1] * (n - 1))), b = Math.min(n - 2, Math.floor(x)), f = x - b;
    p[i] -= c[b][0] + (c[b + 1][0] - c[b][0]) * f; p[i + 2] -= c[b][1] + (c[b + 1][1] - c[b][1]) * f;
  }
  return mesh;
}
