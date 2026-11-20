// paw-4c48.7: lib/shaft.js shaftGeom / geomAt / lenOf / shaftOverlay: the shaft drawn and measured along the penis group
// itself. A synthetic shot with a KNOWN story: a rigid penis at -40 deg (up-right, square units) thrusting along its own axis
// into a fixed entry, its base 0.06 frame heights off the Top's hips centre, its members hidden past the entry; the stored
// sidecar channels glitch the way an owner clip's shot 33 did (every 6th frame the entry swings 30 deg off the
// axis: the SAM mask's own axis, pawtrack/shaft.py measure before the fix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shaftGeom, geomAt, lenOf, shaftOverlay, shaftState, shaftDepth, despike, fullText, GEO, depthScale } from '../src/lib/shaft.js';
import { channelOf } from '../src/lib/runs.js';

const A = 16 / 9, FPS = 30, N = 120, T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / FPS));
const ANG = (-40 * Math.PI) / 180, U = [Math.cos(ANG), Math.sin(ANG)], NRM = [-U[1], U[0]], LF = 0.3, W = 0.06;
const E = [0.62 * A, 0.38];   // the entry (square units), fixed
const vis = (t) => 0.6 + 0.3 * Math.cos((2 * Math.PI * t) / 1000);
const baseSq = (t) => [E[0] - vis(t) * LF * U[0], E[1] - vis(t) * LF * U[1]];
const norm = (p) => [p[0] / A, p[1]];
const glitch = (i) => i % 6 === 3;
const deg = (r) => (r * 180) / Math.PI, wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/** The run: frames with members (ids), stored channels. o: {noFrames, noOwn, drop: (i) => bool (members hidden),
 *  storedGap: (i) => bool (no stored entry / base), allVis (every member visible: every frame is a reference frame)}. */
function makeRun(o = {}) {
  const pts = T.map((t, i) => {
    const b = baseSq(t), out = [], add = (p, v, id) => out.push([+(p[0] / A).toFixed(4), +p[1].toFixed(4), v ? 1 : 0, -1, 0, id]);   // rounded as the sidecar sends them
    for (const f of [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95]) for (const a of [-0.3, 0.3]) {
      const p = [b[0] + f * LF * U[0] + a * W * NRM[0], b[1] + f * LF * U[1] + a * W * NRM[1]];
      add(p, (o.allVis || f < vis(t)) && !o.drop?.(i), 1);
    }
    if (!o.noOwn) {
      for (const d of [-0.01, 0.01]) add([b[0] - 0.02 * U[0] + d, b[1] - 0.02 * U[1]], true, 2);   // the sheath, at the base
      for (const d of [-0.02, 0, 0.02]) add([b[0] - 0.04 + d, b[1] + 0.045], true, 3);            // the Top's hips: off the base
    }
    for (const d of [-0.01, 0.01]) add([E[0] + 0.03, E[1] + d], true, 4);                          // the Bottom's anus
    return out;
  });
  const ch = (f) => channelOf(T.map((t, i) => { const v = f(t, i); return [t, v === v && v != null ? v : null]; }));
  const sg = o.storedGap || (() => false);
  const ent = (t, i) => { const b = baseSq(t), L = vis(t) * LF, a = glitch(i) ? ANG - Math.PI / 6 : ANG; return norm([b[0] + L * Math.cos(a), b[1] + L * Math.sin(a)]); };
  const channels = {
    sem_c2_penis_len: ch((t, i) => (sg(i) ? NaN : vis(t))), sem_c2_penis_in: ch((t, i) => (sg(i) ? NaN : 1 - vis(t))), sem_c2_penis_in_conf: ch((t, i) => (sg(i) ? 0 : 1)),
    sem_c2_penis_bx: ch((t, i) => (sg(i) ? NaN : norm(baseSq(t))[0])), sem_c2_penis_by: ch((t, i) => (sg(i) ? NaN : baseSq(t)[1])),
    sem_c2_penis_ex: ch((t, i) => (sg(i) ? NaN : ent(t, i)[0])), sem_c2_penis_ey: ch((t, i) => (sg(i) ? NaN : ent(t, i)[1])),
    sem_c2_penis_w: ch((t, i) => (sg(i) ? NaN : W)), sem_c2_penis_knot: ch(() => NaN),
    sem_c1_anus_x: ch(() => E[0] / A + 0.03 / A), sem_c1_anus_y: ch(() => E[1]),
  };
  const groups = { sem_c2_penis: { id: 1 }, ...(o.noOwn ? {} : { sem_c2_sheath: { id: 2 }, sem_c2_hips: { id: 3 } }), sem_c1_anus: { id: 4 } };
  return { id: 'run1', channels, range: { start: 0, end: 4000 }, flips: [],
    scenes: [{ start_ms: 0, end_ms: 4000, sign: 1, groups, shaft: { c2_penis: { source: 'sam', full: 'seen', l_full_w: 5, members: 20 } } }],
    ...(o.noFrames ? {} : { frames: { t: T, v: T.map(() => 0), ov: pts.map((p) => ({ pts: p })) } }) };
}

test('the geometry comes from the penis group: along its axis, base on its base, no jumps, though the stored entry swings 30 deg', () => {
  const G = shaftGeom(makeRun(), 0, 'c2_penis', { aspect: A });
  assert.equal(G.from, 'members');
  assert.equal(G.why, 'sheath', 'the base end is the one by the sheath');
  for (let i = 0; i < N; i++) {
    assert.ok(Math.abs(deg(wrap(G.ang[i] - ANG))) < 0.5, `frame ${i}: axis ${deg(G.ang[i]).toFixed(1)}`);
    const b = baseSq(T[i]);
    // the members' base end sits 0.05 of the length up from the true base (the first member place): within half a width
    assert.ok(Math.hypot(G.bx[i] * A - b[0], G.by[i] - b[1]) < 0.5 * W, `frame ${i}: base off by ${Math.hypot(G.bx[i] * A - b[0], G.by[i] - b[1]).toFixed(3)}`);
    if (i) assert.ok(Math.abs(deg(wrap(G.ang[i] - G.ang[i - 1]))) < 1, 'no frame-to-frame swing');
  }
  // the visible length is the stored entry projected on the axis: cos 30 of it on the glitch frames
  assert.ok(Math.abs(G.L[3] - vis(T[3]) * LF * Math.cos(Math.PI / 6)) < 1e-3 && Math.abs(G.L[4] - vis(T[4]) * LF) < 1e-3);
});

test('the base end: the sheath first; without own parts or a stored direction: away from the partner', () => {
  const r = makeRun({ noOwn: true });
  for (const c of ['bx', 'by', 'ex', 'ey']) delete r.channels[`sem_c2_penis_${c}`];
  const G = shaftGeom(r, 0, 'c2_penis', { aspect: A });
  assert.equal(G.why, 'away from the partner');
  assert.ok(Math.abs(deg(wrap(G.ang[10] - ANG))) < 0.5, 'oriented base -> entry');
  assert.ok(Math.abs(G.L[0] - 0.9 * vis(T[0]) * LF) < 0.1 * LF, 'no stored entry: the farthest visible member');
});

test('older runs without the members: the stored axis through the spike filter', () => {
  const G = shaftGeom(makeRun({ noFrames: true }), 0, 'c2_penis', { aspect: A });
  assert.equal(G.from, 'stored');
  assert.equal(G.spikes, N / 6, 'every glitch frame replaced');
  for (let i = 0; i < N; i++) assert.ok(Math.abs(deg(wrap(G.ang[i] - ANG))) < 0.5, `frame ${i}`);
  const a = Float64Array.from([0, 0, 0, 1, 0, 0, NaN, 0]);
  assert.equal(despike(a), 1);
  assert.ok(Math.abs(a[3]) < 1e-9 && Number.isNaN(a[6]));
});

test('dropouts: under 3 members for a few frames are interpolated; a long gap holds the last placement and says so', () => {
  const r = makeRun({ drop: (i) => (i >= 40 && i < 44) || (i >= 60 && i < 85), storedGap: (i) => i >= 60 && i < 85 });
  const G = shaftGeom(r, 0, 'c2_penis', { aspect: A });
  assert.ok([40, 41, 42, 43].every((i) => G.src[i] === 0 && Math.abs(deg(wrap(G.ang[i] - ANG))) < 0.5), 'short gap: interpolated on the axis');
  assert.ok(Math.hypot(G.bx[70] - G.bx[59], G.by[70] - G.by[59]) < 1e-9, 'long gap (833 ms > HOLD_MS): the last good placement held');
  assert.ok(GEO.HOLD_MS < T[85] - T[59]);
  const g = geomAt(G, T[70], A);
  assert.equal(g.held, true);
  const o = shaftOverlay(r, T[70], null, { aspect: A });
  assert.equal(o, null, 'no reading there (the stored channels are empty): nothing drawn');
  const o2 = shaftOverlay(r, T[42], null, { aspect: A });
  assert.equal(o2.state, 'held');
  assert.match(o2.why, /held/);
  assert.equal(shaftOverlay(r, T[30], null, { aspect: A }).state, 'seen');
});

test('time interpolation between frames (smooth at 60 fps) and the overlay along the axis', () => {
  const r = makeRun(), G = shaftGeom(r, 0, 'c2_penis', { aspect: A });
  const tm = (T[10] + T[11]) / 2, g = geomAt(G, tm, A);
  assert.ok(Math.abs(g.base[0] - (G.bx[10] + G.bx[11]) / 2) < 1e-9 && Math.abs(g.L - (G.L[10] + G.L[11]) / 2) < 1e-9);
  const o = shaftOverlay(r, T[3], null, { aspect: A });   // a glitch frame
  const a = Math.atan2(o.entry[1] - o.base[1], (o.entry[0] - o.base[0]) * A);
  assert.ok(Math.abs(deg(wrap(a - ANG))) < 0.5, `drawn axis ${deg(a).toFixed(1)}`);
});

test('the visible share is taken along the corrected axis everywhere it is read (depth, the strip)', () => {
  const r = makeRun(), c = lenOf(r, 'c2_penis', A);
  assert.ok(Math.abs(c.v[3] - vis(T[3]) * Math.cos(Math.PI / 6)) < 2e-3 && Math.abs(c.v[4] - vis(T[4])) < 2e-3);
  const d = shaftDepth(r, 0, T, null, { aspect: A }), ds = depthScale(T, Array.from(T, (t, i) => c.v[i]));
  assert.ok(Math.abs(d.depth[3] - Math.min(1, Math.max(0, (c.v[3] - ds.a) / (ds.b - ds.a)))) < 1e-6, 'the depth is the corrected share on its scale');
  const st = shaftState(r, 0, { aspect: A });
  assert.ok(Math.abs(st.len[3] - c.v[3]) < 1e-6);
  const ax = st.frame(3).axis;
  assert.ok(Math.abs(deg(wrap(Math.atan2(ax[1], ax[0]) - ANG))) < 0.5, 'the strip\'s axis is the corrected one');
  assert.match(fullText(st), /tip free \(5 shaft widths\)/);
  assert.match(fullText({ ...st, full: 'relative' }), /relative/);
});

test('the reference axis is the median of the stored axes on the whole-shaft frames: the old pass\'s glitch frames do not pull it', () => {
  const G = shaftGeom(makeRun({ allVis: true }), 0, 'c2_penis', { aspect: A });
  assert.equal(G.from, 'members');
  for (let i = 0; i < N; i += 7) assert.ok(Math.abs(deg(wrap(G.ang[i] - ANG))) < 0.5, `frame ${i}: ${deg(G.ang[i]).toFixed(2)}`);
});