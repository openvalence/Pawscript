// Machine panel: a coarse lattice over a modelled body's abdominal cavity that moves the soft organs (the small
// intestine, the bladder) out of the toy's way (paw-dk87). The owner: "for the small intestine, perhaps a simple
// lattice deform works well". Each control point is pushed away from the toy's swept volume (the toy where the
// gut's slow return still holds it: physics.js TISSUE_RETURN), shares its push with its neighbours, and is kept
// inside the cavity (the belly wall, as far as the skin's own bulge has moved it out; the back and the bone; the
// flanks; the box's ends at the pelvic brim and the diaphragm). An organ vertex moves by the trilinear blend of the
// eight control points round its resting place (gl3d.js LATTICE, latticeAt here), so the loops slide aside as a
// whole instead of wrapping the toy in a sheath.
import { bulgeAt } from './centreline.js';

/** Control points per axis (x across, y along the body, z dorsal); RANGE: the largest push (mm) the texture holds. */
export const LATTICE = Object.freeze({ nx: 8, ny: 10, nz: 8, range: 64 });

/** The lattice's box round meshes (body frame, mm), padded: {o: origin [x, y, z], d: cell size [x, y, z], n: [nx, ny, nz]}. */
export function latticeBox(meshes, pad = 15) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) for (let i = 0; i < m.pos.length; i += 3) for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], m.pos[i + q]); hi[q] = Math.max(hi[q], m.pos[i + q]); }
  const n = [LATTICE.nx, LATTICE.ny, LATTICE.nz], o = lo.map((v) => v - pad);
  return { o, d: hi.map((v, q) => (v + pad - o[q]) / (n[q] - 1)), n };
}

/** The control points' displacements (Float32Array nx*ny*nz*3, x fastest) for the toy on centreline tc (centreline.js
 *  toyCentreline, world mm) with its envelope st (bulgeStations), the body moved by xb along y; body: fitProfile's
 *  {section, boneAt, boneLine}. wall: the organs keep this far off the toy's envelope, eased over `soft` mm; bulge:
 *  {roll, wall, from, cap} to let the organs follow the belly's skin out where the toy pushes it (null: the wall at
 *  rest). extra: more swept volumes as {C, st} in the same form (gutSweep: the gut where it has moved off its resting
 *  place). All zero with no toy inside and nothing extra. */
export function latticeField(box, body, tc, st, { xb = 0, wall = 6, soft = 30, margin = 8, bulge = null, extra = [] } = {}) {
  const [nx, ny, nz] = box.n, N = nx * ny * nz, D = new Float32Array(N * 3), P = (i, k) => box.o[k] + box.d[k] * i, sweeps = [{ C: tc.C, st }, ...extra];
  // pushed: away from the nearest point of the toy's axis by how far inside its envelope + wall, a C1 ramp over `soft`
  for (let iz = 0, j = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++, j++) {
    const g = [P(ix, 0), P(iy, 1) + xb, P(iz, 2)];
    let best = 0, dir = null;
    for (const { C, st } of sweeps) for (let k = 0, K = C.length / 3; k < K - 1; k++) {
      if (st[k * 4 + 3] < 4 && st[k * 4 + 7] < 4) continue;   // (the part still outside)
      const a = k * 3, e = [C[a + 3] - C[a], C[a + 4] - C[a + 1], C[a + 5] - C[a + 2]], ee = e[0] * e[0] + e[1] * e[1] + e[2] * e[2] || 1;
      const t = Math.max(0, Math.min(1, ((g[0] - C[a]) * e[0] + (g[1] - C[a + 1]) * e[1] + (g[2] - C[a + 2]) * e[2]) / ee));
      const r = [g[0] - C[a] - e[0] * t, g[1] - C[a + 1] - e[1] * t, g[2] - C[a + 2] - e[2] * t], rho = Math.hypot(r[0], r[1], r[2]);
      const R = Math.max(st[k * 4], st[k * 4 + 1]) + (Math.max(st[k * 4 + 4], st[k * 4 + 5]) - Math.max(st[k * 4], st[k * 4 + 1])) * t, x = R + wall - rho;
      const s = x > soft ? x : x > -soft ? ((x + soft) * (x + soft)) / (4 * soft) : 0;
      if (s > best && rho > 1e-3) { best = s; dir = r.map((c) => c / rho); }
    }
    if (dir) D.set(dir.map((c) => c * best), j * 3);
  }
  // shared with the neighbours, twice (each keeps half its own, half their mean: the loops move as a mass, roughly keeping
  // their volume, not as points), then kept inside the cavity
  const at = (ix, iy, iz) => ((iz * ny + iy) * nx + ix) * 3;
  for (let pass = 0; pass < 2; pass++) { const S = Float32Array.from(D); for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const j = at(ix, iy, iz), nb = [];
    if (ix) nb.push(at(ix - 1, iy, iz)); if (ix < nx - 1) nb.push(at(ix + 1, iy, iz)); if (iy) nb.push(at(ix, iy - 1, iz)); if (iy < ny - 1) nb.push(at(ix, iy + 1, iz)); if (iz) nb.push(at(ix, iy, iz - 1)); if (iz < nz - 1) nb.push(at(ix, iy, iz + 1));
    for (let q = 0; q < 3; q++) { let m = 0; for (const b of nb) m += S[b + q]; D[j + q] = 0.5 * S[j + q] + (0.5 * m) / nb.length; }
  } }
  for (let iy = 0; iy < ny; iy++) {
    const y = P(iy, 1), [zc, hw, rt, rb] = body.section(y + xb), back = Math.min(zc + rt, body.boneAt(y + xb)) - margin, side = hw - margin;
    for (let ix = 0; ix < nx; ix++) {
      const x = P(ix, 0), zb = zc - rb;
      // (the belly wall where the skin is now: out by its own bulge over this column)
      const out = bulge ? bulgeAt([x, y + xb, zb], tc, st, bulge.roll, bulge.wall, { from: bulge.from, cap: bulge.cap, bone: body.boneLine }) : 0, belly = zb + margin - out;
      for (let iz = 0; iz < nz; iz++) {
        const j = at(ix, iy, iz), g = [x, y, P(iz, 2)], lo = [-side, box.o[1], belly], hi = [side, box.o[1] + box.d[1] * (ny - 1), back];
        // (a control point already outside a limit at rest stays where it is on that side: no push from the limits alone)
        for (let q = 0; q < 3; q++) { const p = g[q] + D[j + q], a = Math.min(lo[q], g[q]), b = Math.max(hi[q], g[q]); D[j + q] = Math.max(a, Math.min(b, p)) - g[q]; }
        const l = Math.hypot(D[j], D[j + 1], D[j + 2]); if (l > LATTICE.range) for (let q = 0; q < 3; q++) D[j + q] *= LATTICE.range / l;
      }
    }
  }
  // and never folded: where two neighbours would come closer than a quarter cell along an axis (pressed against a
  // wall, or squeezed between the toy and it), both give back toward rest (rest is always inside the limits)
  for (let sweep = 0; sweep < 3; sweep++) for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++)
    for (const [q, dx, dy, dz] of [[0, 1, 0, 0], [1, 0, 1, 0], [2, 0, 0, 1]]) {
      if (ix + dx >= nx || iy + dy >= ny || iz + dz >= nz) continue;
      const a = at(ix, iy, iz) + q, b = at(ix + dx, iy + dy, iz + dz) + q, need = 0.25 * box.d[q] - (box.d[q] + D[b] - D[a]);
      if (need <= 0) continue;
      const t = Math.min(1, need / (Math.max(D[a], 0) - Math.min(D[b], 0) || 1));
      D[a] -= Math.max(D[a], 0) * t; D[b] -= Math.min(D[b], 0) * t;
    }
  return D;
}

/** The gut as a swept volume for latticeField's extra (paw-qin8: the sigmoid straightened forward with nothing in it
 *  must push the loops aside too, not pass through them): the solved path's nodes from arc `from` to `to` (mm), each
 *  counted only where it lies more than 3 mm off the same solve at rest (idle), its radius r eased in over `ramp` mm of
 *  that move (the gut where it rests pushes nothing); world mm (the body moved by xb). null when nothing has moved. */
export function gutSweep(path, idle, { from, to, r, xb = 0, ramp = 10 }) {
  const i0 = Math.max(0, Math.floor(from / path.step)), i1 = Math.min(path.n - 1, Math.ceil(to / path.step)), m = i1 - i0 + 1;
  if (m < 2) return null;
  const C = new Float32Array(m * 3), st = new Float32Array(m * 4);
  let any = false;
  for (let i = i0; i <= i1; i++) {
    const k = i - i0, mv = Math.hypot(path.P[i * 3] - idle.P[i * 3], path.P[i * 3 + 1] - idle.P[i * 3 + 1], path.P[i * 3 + 2] - idle.P[i * 3 + 2]), w = Math.min(1, mv / ramp) * r;
    C.set([path.P[i * 3], path.P[i * 3 + 1] + xb, path.P[i * 3 + 2]], k * 3);
    st.set([w, w, 0, mv > 3 ? 1e3 : 0], k * 4);
    if (mv > 3) any = true;
  }
  return any ? { C, st } : null;
}

/** The displacements as RGBA bytes for the vertex shader's texture (128 = no push, +-127 = +-LATTICE.range). */
export function latticeBytes(D) {
  const n = D.length / 3, b = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { for (let q = 0; q < 3; q++) b[i * 4 + q] = Math.max(1, Math.min(255, Math.round(128 + (D[i * 3 + q] / LATTICE.range) * 127))); b[i * 4 + 3] = 255; }
  return b;
}

/** One organ vertex where the vertex shader moves it (gl3d.js LATTICE; for the tests): p (body frame) on box with
 *  the displacements D (as latticeField, or decoded from latticeBytes) -> [x, y, z]. */
export function latticeAt(box, D, p) {
  const [nx, ny, nz] = box.n, g = [0, 1, 2].map((q) => Math.max(0, Math.min(box.n[q] - 1.0001, (p[q] - box.o[q]) / box.d[q]))), i = g.map(Math.floor), f = g.map((v, q) => v - i[q]);
  const out = [...p];
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1, w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]), j = (((i[2] + dz) * ny + i[1] + dy) * nx + i[0] + dx) * 3;
    for (let q = 0; q < 3; q++) out[q] += w * D[j + q];
  }
  void nz;
  return out;
}
