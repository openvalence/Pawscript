// The Stroker's realistic penis (paw-45rb; src/features/machine/penismesh.js, bodies/stroker-penis.glb from
// dev/stroker-penis-export.py): the asset loads and is small, its zone weights sum to one, its profile has a glans that
// widens to its corona and a root that does not change, the contact profile is the mean radius of what is drawn, the
// size handles stretch it, the parametric (clean) numbers are untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePenisGlb, profAt, axialMap } from '../src/features/machine/penismesh.js';
import * as K from '../src/features/machine/stroker.js';
import * as V from '../src/features/machine/stroker3d.js';

const file = fileURLToPath(new URL('../src/features/machine/bodies/stroker-penis.glb', import.meta.url));
const bytes = readFileSync(file), mesh = parsePenisGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));

test('stroker mesh: loads, small, in budget, indices in range, finite, credited', () => {
  assert.ok(statSync(file).size < 500 * 1024, `${statSync(file).size} bytes`);
  const tris = (mesh.pen.idx.length + mesh.scrot.idx.length) / 3;
  assert.ok(tris <= 20000, `${tris} triangles`);
  for (const m of [mesh.pen, mesh.scrot]) {
    const nv = m.pos.length / 3;
    assert.ok(nv < 65536 && m.nor.length === m.pos.length && Math.max(...m.idx) < nv);
    assert.ok([...m.pos, ...m.nor].every(Number.isFinite));
  }
  assert.equal(mesh.pen.pos.length / 3, 1 + mesh.rings * mesh.seg, 'the pole and the rings');
  assert.match(mesh.credit, /Likkez\b.*CC0 1\.0/);
  assert.ok(mesh.L0 > 100 && mesh.g0 > 10 && mesh.g0 < 0.3 * mesh.L0 && Math.abs(mesh.R0 - 120 / (2 * Math.PI)) < 0.01);
});

test('stroker mesh: the zone weights sum to one on every vertex', () => {
  const Z = mesh.pen.zones;
  for (let v = 0; v < Z.length / 4; v++) assert.equal(Z[v * 4] + Z[v * 4 + 1] + Z[v * 4 + 2] + Z[v * 4 + 3], 255, `vertex ${v}`);
  // the tip all glans, mid-shaft all shaft, the root all base
  const at = (v) => [...Z.subarray(v * 4, v * 4 + 4)];
  assert.deepEqual(at(0), [255, 0, 0, 0]);
  assert.deepEqual(at(mesh.pen.pos.length / 3 - 1), [0, 0, 0, 255]);
});

test('stroker mesh: the profile: the dome widens to the corona, the corona over the sulcus, the root constant', () => {
  const g0 = mesh.g0, ridge = 0.95 * g0;
  let last = 0;
  for (let s = 0; s <= ridge - 1; s += 0.5) { const r = profAt(mesh, s); assert.ok(r >= last - 0.05, `the dome narrows at ${s} mm (${r.toFixed(2)} < ${last.toFixed(2)})`); last = r; }
  const sulcus = Math.min(...[1, 2, 3, 4, 5].map((d) => profAt(mesh, ridge + d)));
  assert.ok(profAt(mesh, ridge) > sulcus + 0.2, `the corona ${profAt(mesh, ridge).toFixed(2)} over the sulcus ${sulcus.toFixed(2)}`);
  const base = profAt(mesh, mesh.L0 + 1);
  for (const d of [5, 20, 39]) assert.ok(Math.abs(profAt(mesh, mesh.L0 + d) - base) < 1e-3, 'the root keeps the base');
  assert.ok(Math.abs(profAt(mesh, mesh.L0 / 2) - mesh.R0) < 0.3, 'girth / 2 pi at mid-shaft');
});

test('stroker mesh: the contact profile is the mean radius of the drawn mesh, at any size', () => {
  const sc = [{ at: 0, pos: 100 }, { at: 1000, pos: 100 }], sl = K.sleeveFor('open-short');
  const colors = { skin: [0.5, 0.5, 0.5], glans: [0.55, 0.45, 0.47], heat: [1, 0.6, 0.2], sleeve: [0.7, 0.7, 0.8], tint: [0.9, 0.9, 0.95], body: [0.5, 0.5, 0.5], thick: [0.4, 0.4, 0.5] };
  for (const body of [K.BODY_DEFAULT, K.validBody({ lengthMm: 210, girthMm: 150, glansMm: 40, padMm: 25 }), K.validBody({ lengthMm: 90, girthMm: 95, glansMm: 22, padMm: 0, knot: true })]) {
    const geo = K.geometry(body, sl, K.WEIGHTS_DEFAULT, mesh), L = body.lengthMm;
    assert.equal(geo.rp.length, L + body.padMm + 1);
    const rig = { downMm: L + 60, upMm: L + 60 }, s = K.stateAt(sc, 900, rig, geo);   // the sleeve off the tip: nothing pressed
    const M = V.meshesFor(L, body.padMm, sl.open, false, mesh);
    V.fillMeshes(M, geo, s, 0, colors, sl);
    assert.ok([...M.pm.pos, ...M.pm.nor, ...M.pm.col].every(Number.isFinite));
    const seg = mesh.seg, P = M.pm.pos;
    let checked = 0;
    for (let k = 9; k < mesh.rings - 4; k += 7) {   // the radial rings (past the dome's): one station each
      let r = 0, y = 0;
      for (let j = 0; j < seg; j++) { const o = (1 + k * seg + j) * 3; r += Math.hypot(P[o], P[o + 2]) / seg; y += P[o + 1] / seg; }
      const st = L - y, i = Math.floor(st), f = st - i, rp = geo.rp[i] + (geo.rp[Math.min(geo.rp.length - 1, i + 1)] - geo.rp[i]) * f;
      assert.ok(Math.abs(r - rp) < 0.02 * rp + 0.05, `L ${L}: ring ${k} at ${st.toFixed(1)} mm drawn ${r.toFixed(2)}, contact ${rp.toFixed(2)}`);
      checked++;
    }
    assert.ok(checked > 8);
    // the tip at the length, the base at 0, the glans length where the body has it
    const ys = []; for (let v = 0; v < P.length / 3; v++) ys.push(P[v * 3 + 1]);
    assert.ok(Math.abs(Math.max(...ys) - L) < 1.5, `tip at ${Math.max(...ys).toFixed(1)} for ${L}`);
    assert.ok(Math.abs(axialMap(mesh, body).to(mesh.g0) - body.glansMm) < 1e-9 && Math.abs(axialMap(mesh, body).from(body.glansMm) - mesh.g0) < 1e-9);
  }
});

test('stroker mesh: the parametric penis (the clean style) is unchanged; the mesh changes the contact only when given', () => {
  const sl = K.sleeveFor('closed-long');
  assert.deepEqual(K.penisProfile(K.BODY_DEFAULT, null), K.penisProfile(K.BODY_DEFAULT));
  assert.deepEqual([...K.geometry(K.BODY_DEFAULT, sl).rp], [...K.geometry(K.BODY_DEFAULT, sl, K.WEIGHTS_DEFAULT, null).rp]);
  const a = K.geometry(K.BODY_DEFAULT, sl), b = K.geometry(K.BODY_DEFAULT, sl, K.WEIGHTS_DEFAULT, mesh);
  assert.notDeepEqual([...a.rp], [...b.rp]);
  assert.equal(b.mesh, mesh);
  // the scrotum: scaled with the girth, drawn down as the pad is pressed
  const p0 = V.scrotumPlace(mesh, mesh.R0, 0), p1 = V.scrotumPlace(mesh, mesh.R0 * 1.2, 10);
  assert.ok(Math.abs(p0.k - 1) < 1e-9 && p1.k > 1.19 && p1.at[1] < p0.at[1]);
});
