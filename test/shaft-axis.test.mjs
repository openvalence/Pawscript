// paw-4c48.14: the shaft drawn sideways. lib/shaft.js shaftGeom took the axis from the penis group's shape on its reference frame;
// with little of the shaft visible the group is wider than long and its principal direction is the WIDTH. Now an ambiguous shape
// (elongation under GEO.ELONG) takes the axis from independent evidence: where the visible points change over the shot, else the
// owner's base part towards the partner's receiving part, else the shot's stroke axis. Synthetic shots: a shaft thrusting into a
// fixed entry at 0 / 45 / 90 deg (square units, image y down), its points in three rows across it, each visible while outside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shaftGeom, GEO } from '../src/lib/shaft.js';
import { channelOf } from '../src/lib/runs.js';

const A = 16 / 9, N = 150, T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / 30)), LF = 0.3, E = [0.62 * A, 0.5];
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI)), deg = (r) => (r * 180) / Math.PI;

/** deg = the shaft's direction base -> tip (square units, y down); vis(t) its visible share; W the rows' half spacing across it;
 *  base / receiver = paint the owner's hips behind the base and the partner's head beyond the entry; samDeg = the sidecar's
 *  stored outline direction (a wide outline lies across). */
function shot({ dirDeg, vis, W = 0.05, base = true, receiver = true, samDeg = dirDeg + 90, axisDeg = null }) {
  const th = (dirDeg * Math.PI) / 180, U = [Math.cos(th), Math.sin(th)], Nn = [-U[1], U[0]], ID = 4, HIPS = 5, HEAD = 6;
  const bse = (t) => [E[0] - vis(t) * LF * U[0], E[1] - vis(t) * LF * U[1]];
  const ov = T.map((t) => {
    const b = bse(t), pts = [];
    for (let q = 0; q < 10; q++) for (const a of [-W, 0, W]) { const f = 0.05 + 0.1 * q, x = b[0] + f * LF * U[0] + a * Nn[0], y = b[1] + f * LF * U[1] + a * Nn[1]; pts.push([x / A, y, f < vis(t) ? 1 : 0, 1, 0, ID]); }
    if (base) for (const a of [-0.03, 0, 0.03]) pts.push([(b[0] - 0.08 * U[0] + a * Nn[0]) / A, b[1] - 0.08 * U[1] + a * Nn[1], 1, 1, 0, HIPS]);
    if (receiver) for (const a of [-0.03, 0, 0.03]) pts.push([(E[0] + 0.12 * U[0] + a * Nn[0]) / A, E[1] + 0.12 * U[1] + a * Nn[1], 1, 1, 0, HEAD]);
    return { pts };
  });
  const sth = (samDeg * Math.PI) / 180, SU = [Math.cos(sth), Math.sin(sth)], ch = (f) => channelOf(T.map((t) => [t, f(t)])), P = 'sem_c2_penis_';
  return {
    id: 'r', range: { start: 0, end: 5000 }, frames: { t: T, ov },
    scenes: [{ start_ms: 0, end_ms: 5000, sign: 1, shaft: { c2_penis: { source: 'sam', full: 'seen' } }, groups: { sem_c2_penis: { id: ID }, ...(base ? { sem_c2_hips: { id: HIPS } } : {}), ...(receiver ? { sem_c1_head: { id: HEAD } } : {}) } }],
    notes: axisDeg != null ? [{ code: 'primary', scene_index: 0, data: { axis: { mode: 'auto', deg: axisDeg } } }] : [],
    channels: { [P + 'len']: ch(vis), [P + 'in']: ch((t) => 1 - vis(t)), [P + 'in_conf']: ch(() => 0.9), [P + 'bx']: ch((t) => bse(t)[0] / A), [P + 'by']: ch((t) => bse(t)[1]),
      [P + 'ex']: ch((t) => (bse(t)[0] + 0.05 * SU[0]) / A), [P + 'ey']: ch((t) => bse(t)[1] + 0.05 * SU[1]), [P + 'w']: ch(() => 0.05) },
  };
}
const short = (t) => 0.2 + 0.1 * Math.cos((2 * Math.PI * t) / 900);   // 10..30 % visible: 1-3 rows of points along, 3 across
const offBy = (G, dirDeg) => { const a = []; for (let i = 0; i < G.t.length; i++) if (G.src[i] === 2) a.push(Math.abs(deg(wrap(G.ang[i] - (dirDeg * Math.PI) / 180)))); a.sort((p, q) => p - q); return a[a.length >> 1]; };

test('a short, wide visible part: the axis along the shaft, at 0 / 45 / 90 deg (where the visible points change)', () => {
  for (const d of [0, 45, 90, -60]) {
    const G = shaftGeom(shot({ dirDeg: d, vis: short }), 0, 'c2_penis', { aspect: A });
    assert.equal(G.axisFrom, 'where the visible points change over the shot', `${d} deg: ${G.axisFrom}`);
    assert.ok(offBy(G, d) < 8, `${d} deg: the axis ${offBy(G, d).toFixed(1)} deg off the shaft (it used to lie across it)`);
  }
});

test('nothing changes over the shot: the base part towards the partner, else the stroke axis', () => {
  const still = () => 0.3;
  const G = shaftGeom(shot({ dirDeg: 90, vis: still }), 0, 'c2_penis', { aspect: A });
  assert.equal(G.axisFrom, 'its base towards the partner');
  assert.ok(offBy(G, 90) < 8, `${offBy(G, 90).toFixed(1)} deg`);
  const S = shaftGeom(shot({ dirDeg: -90, vis: still, base: false, receiver: false, axisDeg: 90 }), 0, 'c2_penis', { aspect: A });
  assert.equal(S.axisFrom, "the shot's stroke axis");
  assert.ok(Math.abs(Math.abs(deg(wrap(S.ang.find(Number.isFinite) + Math.PI / 2))) % 180) < 8 || Math.abs(Math.abs(deg(wrap(S.ang.find(Number.isFinite) + Math.PI / 2))) - 180) < 8, 'a line along the stroke axis (90 deg up)');
});

test('a long visible shaft is read as before (its own shape / the shaft pass)', () => {
  const long = (t) => 0.75 + 0.15 * Math.cos((2 * Math.PI * t) / 900);
  for (const d of [0, 45, 90]) {
    const G = shaftGeom(shot({ dirDeg: d, vis: long, W: 0.012, samDeg: d }), 0, 'c2_penis', { aspect: A });
    assert.ok(G.axisFrom === 'the shaft pass' || G.axisFrom === "the points' shape", G.axisFrom);
    assert.ok(offBy(G, d) < 3, `${d} deg: ${offBy(G, d).toFixed(1)} deg off`);
  }
  assert.ok(GEO.ELONG > 1);
});
