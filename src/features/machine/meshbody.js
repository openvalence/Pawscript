// meshbody.js -- imported character models as the Machine view's body (pure, no DOM). The owner's own model ships as
// bodies/<id>.bin (+ .tex.webp, .json), written by tools/build-body-asset.mjs from an OBJ + MTL. The procedural bodies
// (body.js) are built in the simulation's frame; an imported one is posed in its own, so it is put into that frame
// from a few landmarks (the opening, the canal's entry direction, dorsal), found from the geometry at build time and
// nudged by the owner (machine.bodyFit), and everything the simulation asks of a body (the torso's section, the bone
// boundary, the belly) is measured from the mesh in that frame (fitProfile).
//
// Frame (as body.js / anatomy.js): mm, the opening at the origin, y = along the rail into the body, z = dorsal, x
// across (+x = the receiver's right).
//
// .bin layout, little endian: 'PWB1', u32 vertices, u32 triangles, f32 min[3], f32 max[3] (native units, metres),
// u16 positions (quantised over min..max), i8 normals (x 127, padded to 4 bytes), u16 uv (0..1), u8 rgba (colour; a =
// 0 a flat colour, 1 skin (textured, the landmarks and the fit use it), 2 other textured parts), u16 indices.
import { boneAt as procBoneAt, BONE_FROM, boneLine, rearMesh } from './body.js';
import { meshPath, restPath, ANATOMY } from './anatomy.js';

const MAGIC = 'PWB1';
const nrm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** {pos: Float32Array, nor: Float32Array, uv: Float32Array, col: Uint8Array (rgba), idx: Uint16Array} -> bytes. */
export function encodeBody({ pos, nor, uv, col, idx }) {
  const nv = pos.length / 3, nt = idx.length / 3, np = Math.ceil((nv * 3) / 4) * 4;
  if (nv > 65535) throw new Error('body mesh over 65535 vertices');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv * 3; i++) { const k = i % 3; min[k] = Math.min(min[k], pos[i]); max[k] = Math.max(max[k], pos[i]); }
  const buf = new ArrayBuffer(36 + nv * 6 + np + nv * 4 + nv * 4 + nt * 6), dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, MAGIC.charCodeAt(i));
  dv.setUint32(4, nv, true); dv.setUint32(8, nt, true);
  for (let k = 0; k < 3; k++) { dv.setFloat32(12 + k * 4, min[k], true); dv.setFloat32(24 + k * 4, max[k], true); }
  let o = 36;
  for (let i = 0; i < nv * 3; i++, o += 2) { const k = i % 3; dv.setUint16(o, Math.round(((pos[i] - min[k]) / (max[k] - min[k] || 1)) * 65535), true); }
  for (let i = 0; i < nv * 3; i++) dv.setInt8(o + i, Math.max(-127, Math.min(127, Math.round(nor[i] * 127))));
  o += np;
  for (let i = 0; i < nv * 2; i++, o += 2) dv.setUint16(o, Math.round(Math.max(0, Math.min(1, uv[i])) * 65535), true);
  for (let i = 0; i < nv * 4; i++, o++) dv.setUint8(o, col[i]);
  for (let i = 0; i < nt * 3; i++, o += 2) dv.setUint16(o, idx[i], true);
  return new Uint8Array(buf);
}

/** bytes -> {pos, nor, uv, col (Float32Array rgba: rgb 0..1, a = the part flag 0 | 1 | 2), idx}, native units. */
export function parseBody(buf) {
  const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== MAGIC) throw new Error('not a body mesh');
  const nv = dv.getUint32(4, true), nt = dv.getUint32(8, true), np = Math.ceil((nv * 3) / 4) * 4, min = [], max = [];
  for (let k = 0; k < 3; k++) { min.push(dv.getFloat32(12 + k * 4, true)); max.push(dv.getFloat32(24 + k * 4, true)); }
  if (dv.byteLength < 36 + nv * 6 + np + nv * 8 + nt * 6) throw new Error('truncated body mesh');
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 4), idx = new Uint16Array(nt * 3);
  let o = 36;
  for (let i = 0; i < nv * 3; i++, o += 2) { const k = i % 3; pos[i] = min[k] + (dv.getUint16(o, true) / 65535) * (max[k] - min[k]); }
  for (let i = 0; i < nv; i++) { const n = nrm3([dv.getInt8(o + i * 3), dv.getInt8(o + i * 3 + 1), dv.getInt8(o + i * 3 + 2)]); nor.set(n, i * 3); }
  o += np;
  for (let i = 0; i < nv * 2; i++, o += 2) uv[i] = dv.getUint16(o, true) / 65535;
  for (let i = 0; i < nv * 4; i++, o++) col[i] = i % 4 === 3 ? dv.getUint8(o) : dv.getUint8(o) / 255;
  for (let i = 0; i < nt * 3; i++, o += 2) idx[i] = dv.getUint16(o, true);
  return { pos, nor, uv, col, idx };
}

/** Segments of the skin cut by a plane: points p with dot(p, n) = c -> [[a0, a1, b0, b1], ...] in the plane's own
 *  axes (dot with e0, e1). Skin: triangles whose three vertices are flagged 1. */
function planeCut(m, n, c, e0, e1, tri = null) {
  const { pos, idx, col } = m, out = [];
  const list = tri || { length: idx.length / 3, at: (i) => i };
  for (let q = 0; q < list.length; q++) {
    const t = list.at(q) * 3, a = idx[t], b = idx[t + 1], d = idx[t + 2];
    if (col[a * 4 + 3] !== 1 || col[b * 4 + 3] !== 1 || col[d * 4 + 3] !== 1) continue;
    const V = [a, b, d], s = V.map((v) => pos[v * 3] * n[0] + pos[v * 3 + 1] * n[1] + pos[v * 3 + 2] * n[2] - c), P = [];
    for (let e = 0; e < 3; e++) {
      const i = V[e], j = V[(e + 1) % 3], si = s[e], sj = s[(e + 1) % 3];
      if ((si < 0) === (sj < 0)) continue;
      const f = si / (si - sj), p = [0, 1, 2].map((k) => pos[i * 3 + k] + (pos[j * 3 + k] - pos[i * 3 + k]) * f);
      P.push(dot(p, e0), dot(p, e1));
    }
    if (P.length === 4) out.push(P);
  }
  return out;
}

/** The landmarks from the geometry (native units), for a model with the given up and forward (toward the head)
 *  axes, symmetric about a plane across its width:
 *  - the symmetry plane: the middle of the skin's extent across;
 *  - the opening: on a cut just off the midline, the skin seen from behind (per height the rearmost point, below
 *    the skin's centre) runs up the perineum and then turns back sharply along the tail's (or the buttocks') underside:
 *    the opening is that kink (the most negative second difference over 10 mm), within the lowest 8 % of the model's
 *    height above the lowest such point;
 *  - the entry direction: parallel to the torso's centre line (midway between the belly and the back on the same cut,
 *    from 8 to 30 % of the model's length ahead of the opening), in the midline plane; dorsal: square to it, up.
 *  -> {opening, entry, dorsal, symmetry} (arrays, native units). */
export function autoLandmarks(m, { up = [0, 1, 0], fwd = [0, 0, 1] } = {}) {
  const U = nrm3(up), F = nrm3(fwd), X = crs(F, U), { pos, col } = m;
  let lo = Infinity, hi = -Infinity, uLo = Infinity, uHi = -Infinity, fLo = Infinity, fHi = -Infinity, fSum = 0, uSum = 0, n = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    if (col[i * 4 + 3] !== 1) continue;
    const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], x = dot(p, X), u = dot(p, U), f = dot(p, F);
    lo = Math.min(lo, x); hi = Math.max(hi, x); uLo = Math.min(uLo, u); uHi = Math.max(uHi, u); fLo = Math.min(fLo, f); fHi = Math.max(fHi, f); fSum += f; uSum += u; n++;
  }
  const sym = (lo + hi) / 2, x0 = sym + 0.0015 * (uHi - uLo) / 1.7;   // just off the midline (mirrored meshes put vertices exactly on it)
  const seg = planeCut(m, X, x0, F, U), fMid = fSum / n, uMid = uSum / n;
  // the skin seen from behind: per height, the rearmost crossing behind the middle
  const rear = (u) => { let best = Infinity; for (const [a0, a1, b0, b1] of seg) { if ((a1 - u) * (b1 - u) > 0 || a1 === b1) continue; const f = a0 + ((b0 - a0) * (u - a1)) / (b1 - a1); if (f < fMid) best = Math.min(best, f); } return best; };
  let uStart = Infinity;
  for (const [a0, a1, b0, b1] of seg) { if (a0 < fMid && a1 < uMid) uStart = Math.min(uStart, a1); if (b0 < fMid && b1 < uMid) uStart = Math.min(uStart, b1); }
  // (nothing of the rear below the skin's mean height on this cut, the limbs pulling the mean down: its lowest point)
  if (!Number.isFinite(uStart)) for (const [a0, a1, b0, b1] of seg) { if (a0 < fMid) uStart = Math.min(uStart, a1); if (b0 < fMid) uStart = Math.min(uStart, b1); }
  const H = uHi - uLo, h = 0.0059 * H, step = h / 4;   // 10 mm on a 1.7 m model
  let best = { k: Infinity, u: NaN, f: NaN };
  for (let u = uStart + 2 * h; u <= uStart + 0.08 * H; u += step) {
    const a = rear(u - h), b = rear(u), c = rear(u + h);
    if (![a, b, c].every(Number.isFinite)) continue;
    const k = c - 2 * b + a;
    if (k < best.k) best = { k, u, f: b };
  }
  // the torso's centre line: on vertical lines of the same cut, the first crossing (the belly) and the next (the back)
  const L = fHi - fLo, cs = [];
  for (let f = best.f + 0.08 * L; f <= best.f + 0.3 * L; f += 0.01 * L) {
    const us = [];
    for (const [a0, a1, b0, b1] of seg) { if ((a0 - f) * (b0 - f) > 0 || a0 === b0) continue; us.push(a1 + ((b1 - a1) * (f - a0)) / (b0 - a0)); }
    us.sort((p, q) => p - q);
    if (us.length >= 2) cs.push([f, (us[0] + us[1]) / 2]);
  }
  let sf = 0, su = 0, sff = 0, sfu = 0;
  for (const [f, u] of cs) { sf += f; su += u; sff += f * f; sfu += f * u; }
  const slope = cs.length > 1 ? (cs.length * sfu - sf * su) / (cs.length * sff - sf * sf || 1) : 0;
  const entry = nrm3([F[0] + slope * U[0], F[1] + slope * U[1], F[2] + slope * U[2]]), dorsal = nrm3(crs(X, entry));
  const opening = [0, 1, 2].map((k) => X[k] * sym + U[k] * best.u + F[k] * best.f);
  return { opening, entry, dorsal, symmetry: sym };
}

/** The frame for landmarks and the owner's nudges ({up, fwd} mm along dorsal / entry at the model's own height,
 *  pitch deg: the entry tilted dorsally), at mm per native unit `mm` -> {o, ex, ey, ez, mm}. */
export function bodyFrame(lm, nudge = {}, mm = 1000) {
  const p = ((nudge.pitch || 0) * Math.PI) / 180, e0 = nrm3(lm.entry), d0 = nrm3(crs(crs(e0, lm.dorsal), e0));
  const ey = nrm3(e0.map((v, k) => v * Math.cos(p) + d0[k] * Math.sin(p))), ez = nrm3(d0.map((v, k) => v * Math.cos(p) - e0[k] * Math.sin(p))), ex = crs(ey, ez);
  const o = lm.opening.map((v, k) => v + (((nudge.up || 0) * d0[k] + (nudge.fwd || 0) * e0[k]) / 1000));
  return { o, ex, ey, ez, mm };
}

/** A point (native units) in the simulation's frame (mm); dir: a direction (unit, not moved or scaled). */
export const framePoint = (p, { o, ex, ey, ez, mm }) => { const q = [p[0] - o[0], p[1] - o[1], p[2] - o[2]]; return [dot(q, ex) * mm, dot(q, ey) * mm, dot(q, ez) * mm]; };
export const frameDir = (d, { ex, ey, ez }) => [dot(d, ex), dot(d, ey), dot(d, ez)];

/** The mesh in the simulation's frame (mm), with a canal cut in at the opening (cutCanal; canal: false leaves it, an
 *  inner layer); col / uv kept. */
export function framedMesh(m, fr, { canalR = 14, canalDepth = 42, canal = true } = {}) {
  const nv = m.pos.length / 3, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), { o, ex, ey, ez, mm } = fr;
  for (let i = 0; i < nv; i++) {
    const p = [m.pos[i * 3] - o[0], m.pos[i * 3 + 1] - o[1], m.pos[i * 3 + 2] - o[2]], n = [m.nor[i * 3], m.nor[i * 3 + 1], m.nor[i * 3 + 2]];
    pos[i * 3] = dot(p, ex) * mm; pos[i * 3 + 1] = dot(p, ey) * mm; pos[i * 3 + 2] = dot(p, ez) * mm;
    nor[i * 3] = dot(n, ex); nor[i * 3 + 1] = dot(n, ey); nor[i * 3 + 2] = dot(n, ez);
  }
  const out = { pos, nor, uv: m.uv, col: m.col, idx: m.idx };
  return canal ? cutCanal(out, canalR, canalDepth) : { ...out, canal: false };
}

/** Meshes (each {pos, idx, col}) as one, 32-bit indices: the parts of a layer for the fit and the readouts. */
export function mergeMeshes(ms) {
  const nv = ms.reduce((s, m) => s + m.pos.length / 3, 0), nt = ms.reduce((s, m) => s + m.idx.length, 0);
  const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 4), idx = new Uint32Array(nt);
  let v = 0, t = 0;
  for (const m of ms) { pos.set(m.pos, v * 3); col.set(m.col, v * 4); for (let i = 0; i < m.idx.length; i++) idx[t + i] = m.idx[i] + v; v += m.pos.length / 3; t += m.idx.length; }
  return { pos, col, idx };
}

/** The bony dorsal boundary from a modelled skeleton (framed meshes; part flags 3: the sacrum, vertebrae and discs, 5:
 *  the coccyx): per `step` mm along y the most ventral bone within 15 mm of the midline (the front of the coccyx, the
 *  sacrum and the vertebral bodies), gaps filled from the neighbours, smoothed over 30 mm. -> {at(y), from (where the
 *  sacrum ends: the sacrococcygeal joint; short of it the coccyx is mobile, centreline.js), tip (the coccyx's tip y)}
 *  or null (no such bone). */
export function skeletonBone(meshes, { step = 10, upTo = 800 } = {}) {
  const n = Math.floor(upTo / step) + 1, lo = new Float32Array(n).fill(Infinity);
  let from = Infinity, tip = Infinity;
  for (const m of meshes) for (let i = 0; i < m.pos.length / 3; i++) {
    const f = m.col[i * 4 + 3];
    if (f !== 3 && f !== 5) continue;
    const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
    if (Math.abs(x) > 15 || y < 0 || y > upTo) continue;
    const b = Math.round(y / step);
    lo[b] = Math.min(lo[b], z); tip = Math.min(tip, y);
    if (f === 3) from = Math.min(from, y);
  }
  const have = [...lo.keys()].filter((i) => Number.isFinite(lo[i]));
  if (!have.length) return null;
  const raw = Array.from(lo, (v, i) => (Number.isFinite(v) ? v : lo[have.reduce((a, b) => (Math.abs(b - i) < Math.abs(a - i) ? b : a))]));
  const sm = raw.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) { s += raw[j]; c++; } return s / c; });
  const at = (y) => { const x = Math.max(0, Math.min(n - 1, y / step)), i = Math.min(n - 2, Math.floor(x)); return sm[i] + (sm[i + 1] - sm[i]) * (x - i); };
  return { at, from, tip };
}

/** A blind canal of radius R into the skin at the opening, as the procedural bodies have (the shader opens it to the
 *  toy): the skin triangles near the axis around the opening are removed, the hole's rim snapped onto the canal's
 *  circle and a tube with an end cap stitched to it, `depth` mm deep. A model with no clean hole there (the opening
 *  moved off the skin) is returned as it was, `canal` false: the view then leaves the opening undeformed. */
export function cutCanal(m, R = 14, depth = 42) {
  const { pos, idx, col } = m, nt = idx.length / 3, rho = (v) => Math.hypot(pos[v * 3], pos[v * 3 + 2]), yy = (v) => pos[v * 3 + 1];
  const inside = (v) => col[v * 4 + 3] === 1 && rho(v) < R && yy(v) > -25 && yy(v) < depth;
  const keep = new Uint8Array(nt).fill(1);
  let cut = 0;
  for (let t = 0; t < nt; t++) if (inside(idx[t * 3]) || inside(idx[t * 3 + 1]) || inside(idx[t * 3 + 2])) { keep[t] = 0; cut++; }
  const fail = { ...m, canal: false };
  if (!cut) return fail;
  // boundary edges of what is left, near the axis
  const ec = new Map(), key = (a, b) => (a < b ? a * 65536 + b : b * 65536 + a);
  for (let t = 0; t < nt; t++) if (keep[t]) for (let e = 0; e < 3; e++) { const a = idx[t * 3 + e], b = idx[t * 3 + (e + 1) % 3], k = key(a, b); const c = ec.get(k); ec.set(k, c ? [c[0] + 1, a, b] : [1, a, b]); }
  const next = new Map();
  for (const [, [c, a, b]] of ec) if (c === 1 && rho(a) < 3 * R && rho(b) < 3 * R && yy(a) > -40 && yy(b) > -40) { next.set(a, [...(next.get(a) || []), b]); next.set(b, [...(next.get(b) || []), a]); }
  // the loops; the one that winds once round the axis
  const seen = new Set();
  let loop = null;
  for (const s of next.keys()) {
    if (seen.has(s)) continue;
    const L = [s]; seen.add(s);
    let prev = -1, cur = s;
    for (;;) { const nb = (next.get(cur) || []).find((v) => v !== prev && (!seen.has(v) || (v === s && L.length > 2))); if (nb === undefined || nb === s) break; L.push(nb); seen.add(nb); prev = cur; cur = nb; }
    let w = 0;
    for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; let d = Math.atan2(pos[b * 3 + 2], pos[b * 3]) - Math.atan2(pos[a * 3 + 2], pos[a * 3]); d = Math.atan2(Math.sin(d), Math.cos(d)); w += d; }
    if (Math.abs(Math.abs(w) - 2 * Math.PI) < 0.5 && (!loop || L.length > loop.length)) loop = L;
  }
  if (!loop || loop.length < 8) return fail;
  const P = Array.from(pos), N = Array.from(m.nor), UV = Array.from(m.uv), C = Array.from(col), T = [];
  for (let t = 0; t < nt; t++) if (keep[t]) T.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  // the rim onto the circle; then rings down to the cap
  const RINGS = 6, base = P.length / 3, nl = loop.length, dark = [C[loop[0] * 4], C[loop[0] * 4 + 1], C[loop[0] * 4 + 2]];
  for (const v of loop) { const r = rho(v) || 1; P[v * 3] *= R / r; P[v * 3 + 2] *= R / r; }
  for (let j = 1; j <= RINGS; j++) for (const v of loop) {
    const a = Math.atan2(P[v * 3 + 2], P[v * 3]), y = P[v * 3 + 1] + ((depth - P[v * 3 + 1]) * j) / RINGS;
    P.push(R * Math.cos(a), y, R * Math.sin(a)); N.push(-Math.cos(a), 0, -Math.sin(a)); UV.push(0, 0); C.push(...dark, 0);
  }
  P.push(0, depth, 0); N.push(0, -1, 0); UV.push(0, 0); C.push(...dark, 0);
  const ring = (j, i) => (j === 0 ? loop[i % nl] : base + (j - 1) * nl + (i % nl)), cap = base + RINGS * nl;
  for (let j = 0; j < RINGS; j++) for (let i = 0; i < nl; i++) T.push(ring(j, i), ring(j + 1, i), ring(j + 1, i + 1), ring(j, i), ring(j + 1, i + 1), ring(j, i + 1));
  for (let i = 0; i < nl; i++) T.push(ring(RINGS, i), ring(RINGS, i + 1), cap);
  if (P.length / 3 > 65535) return fail;
  return { pos: Float32Array.from(P), nor: Float32Array.from(N), uv: Float32Array.from(UV), col: Float32Array.from(C), idx: Uint16Array.from(T), canal: true };
}

/** The skin made finer where the toy can push it out (paw-ani1: the bulge's knee is a few mm wide, the belly's
 *  triangles 8-20 mm; displaced over them it showed facets and shards): every edge longer than maxEdge of a triangle
 *  with where(centroid) true split at its middle, `passes` times; the triangles round the region take only the splits
 *  on their own edges (one, two or three: no T-junction to crack open). The new vertices interpolate their edge's
 *  attributes (the normal renormalised, the colour's flags from the first end); then cut into parts of at most
 *  `maxVerts` vertices (16-bit indices). Any other field of the first part (canal) is kept on the first. -> [mesh]. */
export function refineWhere(parts, where, { maxEdge = 4, passes = 2, maxVerts = 60000 } = {}) {
  let P = [], N = [], UV = [], C = [], T = [];
  const add = (A, B) => { for (let i = 0; i < B.length; i++) A.push(B[i]); };
  for (const m of parts) { const o = P.length / 3, nv = m.pos.length / 3; add(P, m.pos); add(N, m.nor); add(UV, m.uv || new Float32Array(nv * 2)); add(C, m.col || new Float32Array(nv * 4)); for (const v of m.idx) T.push(v + o); }
  const len = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  for (let pass = 0; pass < passes; pass++) {
    const mid = new Map(), key = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
    for (let t = 0; t < T.length; t += 3) {
      const [a, b, c] = [T[t], T[t + 1], T[t + 2]], cen = [0, 1, 2].map((q) => (P[a * 3 + q] + P[b * 3 + q] + P[c * 3 + q]) / 3);
      if (!where(cen)) continue;
      for (const [u, v] of [[a, b], [b, c], [c, a]]) if (len(u, v) > maxEdge && !mid.has(key(u, v))) {
        const k = P.length / 3; mid.set(key(u, v), k);
        for (let q = 0; q < 3; q++) P.push((P[u * 3 + q] + P[v * 3 + q]) / 2);
        const n = [0, 1, 2].map((q) => N[u * 3 + q] + N[v * 3 + q]), nl = Math.hypot(...n) || 1; N.push(...n.map((x) => x / nl));
        UV.push((UV[u * 2] + UV[v * 2]) / 2, (UV[u * 2 + 1] + UV[v * 2 + 1]) / 2);
        C.push((C[u * 4] + C[v * 4]) / 2, (C[u * 4 + 1] + C[v * 4 + 1]) / 2, (C[u * 4 + 2] + C[v * 4 + 2]) / 2, C[u * 4 + 3]);
      }
    }
    if (!mid.size) break;
    const out = [];
    for (let t = 0; t < T.length; t += 3) {
      const [a, b, c] = [T[t], T[t + 1], T[t + 2]], ab = mid.get(key(a, b)), bc = mid.get(key(b, c)), ca = mid.get(key(c, a));
      const n = (ab != null) + (bc != null) + (ca != null);
      if (n === 0) out.push(a, b, c);
      else if (n === 3) out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      else if (n === 1) { if (ab != null) out.push(a, ab, c, ab, b, c); else if (bc != null) out.push(a, b, bc, a, bc, c); else out.push(a, b, ca, ca, b, c); }
      else { // two: rotate so the unsplit edge is c-a
        const [x, y, z, m1, m2] = ca == null ? [a, b, c, ab, bc] : ab == null ? [b, c, a, bc, ca] : [c, a, b, ca, ab];
        out.push(x, m1, z, m1, y, m2, m1, m2, z);
      }
    }
    T = out;
  }
  // into parts of at most maxVerts vertices
  const res = [];
  for (let t = 0; t < T.length; ) {
    const map = new Map(), idx = [];
    for (; t < T.length; t += 3) {
      const need = [T[t], T[t + 1], T[t + 2]].filter((v) => !map.has(v)).length;
      if (map.size + need > maxVerts) break;
      for (let e = 0; e < 3; e++) { const v = T[t + e]; if (!map.has(v)) map.set(v, map.size); idx.push(map.get(v)); }
    }
    const nv = map.size, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 4);
    for (const [v, k] of map) { pos.set(P.slice(v * 3, v * 3 + 3), k * 3); nor.set(N.slice(v * 3, v * 3 + 3), k * 3); uv.set(UV.slice(v * 2, v * 2 + 2), k * 2); col.set(C.slice(v * 4, v * 4 + 4), k * 4); }
    res.push({ pos, nor, uv, col, idx: Uint16Array.from(idx) });
  }
  if (res.length) { const { pos, nor, uv, col, idx, ...rest } = parts[0]; Object.assign(res[0], rest); }
  return res;
}
/** What the simulation needs of a framed body, measured on its skin: per 10 mm along y from the opening, the torso's
 *  section as body.js torsoSection has it ([y, centre z, half-width, dorsal radius, ventral radius], about the canal's
 *  line (centre z 0: a tail rising from the back would lift a measured centre into it) from rays out of it: the first
 *  skin each meets, so the limbs and the tail beyond the torso's wall do not count; where the line is not inside the
 *  skin (in the cleft at the opening) the nearest section inside stands in), the bone boundary (the procedural sacrum and spine at this height, never closer than a tissue layer under
 *  this back), the hip width (the widest section in the first 200 mm) and the bone line for the shader (8 points).
 *  scale: the height scale (height / 175). A modelled body (paw-27u0) brings its own anatomy: bone (skeletonBone) is
 *  the bone boundary instead of the procedural one, path (its colon's centre line, framed mm) the resting path
 *  (anatomy.js meshPath) and the side the colon runs to. -> {sec, step, section(y), boneAt(y), boneLine, boneFrom, hip,
 *  rest (or null), side (or null)}. */
export function fitProfile(m, scale = 1, { step = 10, upTo = 700, bone = null, path = null } = {}) {
  const { pos, idx, col } = m, nt = idx.length / 3, n = Math.floor((upTo * scale) / step) + 1, buckets = Array.from({ length: n }, () => []);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (col[a * 4 + 3] !== 1 || col[b * 4 + 3] !== 1 || col[c * 4 + 3] !== 1) continue;
    const y0 = Math.min(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]), y1 = Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]);
    for (let i = Math.max(0, Math.ceil(y0 / step)); i <= Math.min(n - 1, Math.floor(y1 / step)); i++) buckets[i].push(t);
  }
  // the nearest crossing from (cx, cz) along (dx, dz) on a section's segments
  const ray = (seg, cx, cz, dx, dz, all = null) => {
    let best = Infinity, far = -Infinity;
    for (const [ax, az, bx, bz] of seg) {
      const ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((ax - cx) * ez - (az - cz) * ex) / den, u = ((ax - cx) * dz - (az - cz) * dx) / den;
      if (t > 0 && u >= 0 && u <= 1) { best = Math.min(best, t); far = Math.max(far, t); if (all) all.n++; }
    }
    if (all) all.far = far;
    return best;
  };
  const sec = [];
  let last = null;
  for (let i = 0; i < n; i++) {
    const y = i * step, seg = planeCut(m, [0, 1, 0], y, [1, 0, 0], [0, 0, 1], { length: buckets[i].length, at: (q) => buckets[i][q] });
    let row = null;
    if (seg.length >= 6) {
      // (ventrally the last skin: the outer belly, past any pocket in it, a slit's or a navel's)
      const cnt = { n: 0 }, below = { n: 0 }, up = ray(seg, 0, 0, 0, 1, cnt), dn = (ray(seg, 0, 0, 0, -1, below), below.far), r = ray(seg, 0, 0, 1, 0), l = ray(seg, 0, 0, -1, 0);
      if (cnt.n % 2 === 1 && [up, dn, r, l].every(Number.isFinite)) row = [y, 0, (r + l) / 2, up, dn];
    }
    if (!row && last) row = [y, ...last.slice(1)];
    if (row) { sec.push(row); last = row; } else sec.push(null);
  }
  const first = sec.find(Boolean);
  if (!first) return null;
  for (let i = 0; i < sec.length; i++) if (!sec[i]) sec[i] = [i * step, ...first.slice(1)];
  const at = (y, k) => { const x = Math.max(0, Math.min(sec.length - 1, (y - sec[0][0]) / step)), i = Math.min(sec.length - 2, Math.floor(x)), f = x - i; return sec.length < 2 ? sec[0][k] : sec[i][k] + (sec[i + 1][k] - sec[i][k]) * f; };
  const section = (y) => [at(y, 1), at(y, 2), at(y, 3), at(y, 4)];
  // the bone: the procedural sacrum / spine line, but at least a tissue layer (30 % of the section's depth, 30-70 mm
  // at 175 cm) under this back's skin
  const boneAt = bone ? bone.at : (y) => { const [zc, , rt, rb] = section(y); return Math.min(procBoneAt(y, scale), zc + rt - Math.max(30 * scale, Math.min(70 * scale, 0.3 * (rt + rb)))); };
  const boneLine = Float32Array.from([40, 80, 120, 160, 220, 300, 400, 640].flatMap((y) => [y * scale, boneAt(y * scale)]));
  let hip = 0;
  for (const r of sec) if (r[0] <= 200 * scale) hip = Math.max(hip, 2 * r[2]);
  const rest = path?.length > 4 ? meshPath(path, scale) : null;
  return { sec, step, section, boneAt, boneLine, boneFrom: bone ? bone.from : BONE_FROM * scale, hip, rest, side: rest ? rest.side : null };
}

/** The angle (rad, about x) that turns a framed body level on its own floor (up: the floor's normal in the body's own
 *  coordinates): the view draws the scene turned by it, so the body stays put and the rail shows its angle (paw-3562). */
export function levelTilt(up, fr) { const n = frameDir(up, fr); return Math.atan2(n[1], n[2]); }

/** A procedural body with the rail pitched against it (paw-3562; pitch deg, + toward the back): the body's mesh (its
 *  canal along the rail, body.js rearSdf pitch) turned into the rail's frame about the opening, and its anatomy with
 *  it: the bone line and the resting path past the canal turned the same way (fitProfile's bone / path), the torso
 *  measured on the turned mesh. pitch 0: null (the procedural body as it was, unturned). -> {mesh, fit, prof, tilt}. */
export function pitchedBody(props, pitch, side = -1) {
  if (!pitch) return null;
  const sc = props.scale ?? 1, m = rearMesh({ ...props, pitch }), fr = bodyFrame({ opening: [0, 0, 0], entry: [0, 1, 0], dorsal: [0, 0, 1] }, { pitch }, 1);
  const mesh = { ...framedMesh({ pos: m.pos, nor: m.nor, uv: m.uv, col: null, idx: m.idx }, fr, { canal: false }), canal: true };
  const col = new Float32Array((mesh.pos.length / 3) * 4);
  for (let i = 3; i < col.length; i += 4) col[i] = 1;
  const fit = { pos: mesh.pos, idx: mesh.idx, col };
  // the bone line (body.js BONE, [y, z]) and the sacrococcygeal joint, turned into the rail's frame
  const bl = boneLine(sc), pts = [];
  for (let i = 0; i < bl.length; i += 2) pts.push(framePoint([0, bl[i], bl[i + 1]], fr));
  pts.sort((a, b) => a[1] - b[1]);
  const at = (y) => { if (y <= pts[0][1]) return pts[0][2]; for (let i = 1; i < pts.length; i++) if (y <= pts[i][1]) { const f = (y - pts[i - 1][1]) / (pts[i][1] - pts[i - 1][1]); return pts[i - 1][2] + (pts[i][2] - pts[i - 1][2]) * f; } return pts.at(-1)[2]; };
  const bf = framePoint([0, BONE_FROM * sc, procBoneAt(BONE_FROM * sc, sc)], fr)[1];
  const rest = restPath(sc, { side }), path = [];
  for (let i = Math.ceil((ANATOMY.canalLen * sc) / rest.step); i < rest.n; i++) path.push(framePoint([rest.P[i * 3], rest.P[i * 3 + 1], rest.P[i * 3 + 2]], fr));
  const prof = fitProfile(fit, sc, { bone: { at, from: bf, tip: pts[0][1] }, path });
  return { mesh, fit, prof, tilt: levelTilt([0, 0, 1], fr) };
}
