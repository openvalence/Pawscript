import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minMoveTime, minMoveTimeInfo, maxReach, maxStrokesPerMin, reachTime, strokeShortfalls, simulateDevice, simulateDeviceAsync, trackingError, sweepStroke, plannerShape,
  toUnits, effectiveMaxSpeed, withStroke, makeProfile, getProfile, BUILTIN_PROFILES, findProblems, summarize, loadKinetic, kineticLoaded, kineticVersion } from '../src/lib/analyze/index.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const CAP = { v: 1200, a: 100000, j: 20000000 };            // Nucleus Capstan in mm
const tri = (n, period, lo = 0, hi = 100) => Array.from({ length: n + 1 }, (_, i) => ({ at: i * period, pos: i % 2 ? hi : lo }));

test('minMoveTime: closed forms for the three regimes and the Capstan check values', () => {
  near(CAP.a / CAP.j, 0.005); near(CAP.a ** 2 / CAP.j, 500);
  near(CAP.v * (CAP.v / CAP.a + CAP.a / CAP.j), 20.4, 1e-9);
  near(minMoveTime(100, CAP) * 1000, 100.3333333, 1e-6);          // d/v + v/a + a/j
  near(minMoveTime(5, CAP) * 1000, 20, 1e-9);                      // 5 mm = 2a^3/j^2: the jerk-only / acceleration-limited boundary
  assert.equal(minMoveTimeInfo(100, CAP).regime, 'v'); assert.equal(minMoveTimeInfo(10, CAP).regime, 'a'); assert.equal(minMoveTimeInfo(2, CAP).regime, 'j');
  // regime j: T = 4 cbrt(d / 2j)
  near(minMoveTime(1, CAP), 4 * Math.cbrt(1 / (2 * CAP.j)), 1e-15);
  // regime a: T = 2 (vp/a + a/j), vp = (-a^2/j + sqrt(a^4/j^2 + 4 a d)) / 2 ; and the move covers d: d = vp (vp/a + a/j)
  const d = 10, vp = (-(CAP.a ** 2) / CAP.j + Math.sqrt(CAP.a ** 4 / CAP.j ** 2 + 4 * CAP.a * d)) / 2;
  near(minMoveTime(d, CAP), 2 * (vp / CAP.a + CAP.a / CAP.j), 1e-15); near(vp * (vp / CAP.a + CAP.a / CAP.j), d, 1e-9);
  // regime v boundary: vp = v at d = v (v/a + a/j) = 20.4
  const dv = CAP.v * (CAP.v / CAP.a + CAP.a / CAP.j);
  near(minMoveTime(dv - 1e-9, CAP), minMoveTime(dv + 1e-9, CAP), 1e-9);
  assert.equal(minMoveTimeInfo(dv - 1e-6, CAP).regime, 'a'); assert.equal(minMoveTimeInfo(dv + 1e-6, CAP).regime, 'v');
  near(minMoveTimeInfo(dv + 1e-6, CAP).vPeak, 1200, 1e-6);
  // continuity at the j/a boundary and monotonicity everywhere
  const dj = 2 * CAP.a ** 3 / CAP.j ** 2;
  near(minMoveTime(dj * (1 - 1e-9), CAP), minMoveTime(dj * (1 + 1e-9), CAP), 1e-9);
  let prev = 0;
  for (let x = 0.01; x < 500; x *= 1.07) { const T = minMoveTime(x, CAP); assert.ok(T > prev, `monotone at ${x}`); prev = T; }
  assert.equal(minMoveTime(0, CAP), 0); assert.equal(minMoveTime(-3, CAP), 0);
  // v below a^2/j: the acceleration limit is unreachable, the move is jerk-limited all the way (a -> sqrt(v j))
  const slow = { v: 100, a: 1e6, j: 1e4 };
  near(minMoveTime(500, slow), 500 / 100 + 2 * Math.sqrt(100 / 1e4), 1e-9);
  assert.throws(() => minMoveTime(1, { v: 0, a: 1, j: 1 }), /limits need/);
  near(minMoveTime(100, { v: 1200, a: 1e5, j: Infinity }) * 1000, 100 / 1.2 + 12, 1e-9);
  // inverse
  for (const t of [0.02, 0.05, 0.1, 0.3]) near(minMoveTime(maxReach(t, CAP), CAP), t, 1e-9);
});

test('Capstan table: max speed, stroke times, sustainable strokes per minute', () => {
  const rows = [];
  for (const L of [100, 150, 200, 300]) {
    const u = toUnits({ kinematics: { strokeMm: L, vMax: 1200, aMax: 1e5, jMax: 2e7 } });
    rows.push([L, u.v, ...[100, 50, 20, 5].map((d) => minMoveTime(d, u) * 1000), maxStrokesPerMin(100, u), maxStrokesPerMin(50, u)]);
  }
  console.log('  [capstan] stroke mm | max u/s | T100 T50 T20 T5 ms | spm full, half');
  for (const r of rows) console.log('  [capstan] ' + r.map((v) => (typeof v === 'number' ? +v.toFixed(1) : v)).join(' | '));
  near(rows[0][1], 1200); near(rows[2][1], 600); near(rows[3][1], 400);
  near(rows[0][2], 100.3, 0.05);                                    // 100 mm: 100 units = 100 mm
  assert.ok(rows[0][2] < rows[1][2] && rows[1][2] < rows[2][2] && rows[2][2] < rows[3][2], 'longer stroke = slower in units');
  near(rows[0][6], 60 / (2 * 0.1003333), 0.1);
});

test('reachTime: free end velocity is never slower than rest-to-rest', () => {
  for (const d of [0.1, 1, 5, 20, 80, 300]) assert.ok(reachTime(d, CAP).T <= minMoveTime(d, CAP) + 1e-12);
  near(reachTime(0, CAP).T, 0);
  // far away: cruise at v
  const a = reachTime(600, CAP).T, b = reachTime(1200, CAP).T;
  near(b - a, 0.5, 1e-9);
  assert.equal(reachTime(1200, CAP).regime, 'v'); assert.equal(reachTime(0.001, CAP).regime, 'j');
});

test('profiles: kinematics fields and helpers', () => {
  const P = getProfile('nucleus-capstan');
  assert.equal(P.verified, true); assert.equal(P.limits, 'planner');
  assert.deepEqual({ ...P.kinematics }, { strokeMm: 200, vMax: 1200, aMax: 100000, jMax: 20000000, strokeRange: P.kinematics.strokeRange });
  assert.deepEqual([...P.kinematics.strokeRange], [100, 300]); assert.equal(P.kinematics.needsInput, undefined);
  assert.deepEqual(toUnits(P), { v: 600, a: 50000, j: 10000000, strokeMm: 200 });
  assert.equal(effectiveMaxSpeed(P), 600); assert.equal(P.maxSpeed, 600);
  assert.equal(effectiveMaxSpeed(withStroke(P, 100)), 1200); near(toUnits(withStroke(P, 300)).a, 100000 / 3, 1e-6);
  assert.equal(effectiveMaxSpeed(getProfile('handy')), 360); assert.equal(effectiveMaxSpeed(null), 250);
  assert.equal(effectiveMaxSpeed({ kinematics: P.kinematics, maxSpeed: 111 }), 111, 'explicit maxSpeed wins');
  const mine = makeProfile({ id: 'm', kinematics: { strokeMm: 150, vMax: 900, aMax: 5e4, jMax: 1e7 } });
  assert.equal(mine.maxSpeed, 600); assert.equal(mine.maxSpeedDerived, true);
  assert.equal(makeProfile({ id: 'm2', maxSpeed: 123, kinematics: { strokeMm: 150, vMax: 900, aMax: 5e4, jMax: 1e7 } }).maxSpeed, 123);
  assert.throws(() => makeProfile({ id: 'x', kinematics: { strokeMm: 0, vMax: 1, aMax: 1, jMax: 1 } }), /strokeMm/);
  assert.throws(() => makeProfile({ id: 'x', limits: 'soft' }), /limits/);
  assert.throws(() => toUnits({}), /no kinematics/);
  assert.equal(makeProfile({ id: 'plain', maxSpeed: 200 }).kinematics, undefined);
  assert.ok(BUILTIN_PROFILES.filter((p) => p.id !== 'nucleus-capstan').every((p) => p.verified === false && !p.kinematics && p.limits === undefined));
});

test('strokeShortfalls: predicted shortfall of a too-fast stroke', () => {
  const lim = { v: 600, a: 50000, j: 1e7 };                          // Capstan at 200 mm, in units
  const need = minMoveTime(100, lim) * 1000;
  assert.equal(strokeShortfalls(tri(10, 400), lim).length, 0);
  const fast = [{ at: 0, pos: 0 }, { at: 100, pos: 100 }, { at: 600, pos: 100 }];
  const r = strokeShortfalls(fast, lim);
  assert.equal(r.length, 1); assert.equal(r[0].limiting, 'v');
  near(r[0].requiredMs, need, 1e-6); near(r[0].shortfallMs, need - 100, 1e-6); assert.equal(r.total, 1);
  // acceleration-limited small stroke: 5 units in 10 ms
  const small = strokeShortfalls([{ at: 0, pos: 50 }, { at: 10, pos: 55 }, { at: 500, pos: 55 }], lim);
  assert.equal(small.length, 1); near(small[0].requiredMs, minMoveTime(5, lim) * 1000, 1e-9);
  assert.ok(['a', 'j'].includes(small[0].limiting));
  // interior point reached too early (stroke total is fine): 100 units in 250 ms, 80% done after 20 ms
  const early = strokeShortfalls([{ at: 0, pos: 0 }, { at: 20, pos: 80 }, { at: 250, pos: 100 }, { at: 800, pos: 100 }], lim);
  assert.equal(early.length, 1); assert.ok(early[0].shortfallMs > 0 && early[0].requiredMs < early[0].durationMs + early[0].shortfallMs + 1e-9);
  assert.equal(strokeShortfalls([], lim).length, 0);
});

test('planner profile: informational findings, no fix, counted apart; hard profile unchanged', () => {
  const P = getProfile('nucleus-capstan');
  const s = tri(20, 60);
  const pl = findProblems(s, P, {});
  assert.ok(pl.length > 0 && pl.every((p) => p.severity === 'info' && p.planner === true && p.fix === undefined));
  assert.ok(pl.some((p) => p.kind === 'planner-reshaped' && p.optionalFix && /will reshape/.test(p.message) && /shortfall/.test(p.message)));
  assert.ok(pl.some((p) => p.kind === 'speed-limit' && /^The planner will reshape this/.test(p.message)));
  const sm = summarize(pl);
  assert.deepEqual([sm.error, sm.warn, sm.info], [0, 0, 0]); assert.equal(sm.planner, pl.length);
  assert.equal(new Set(pl.map((p) => p.id)).size, pl.length);
  const hard = findProblems(s, makeProfile({ id: 'h', kinematics: P.kinematics }), {});
  assert.ok(hard.some((p) => p.kind === 'kinematic-limit' && p.fix && p.fix.op === 'capSpeed' && p.fix.needs === 'capKinematics'));
  assert.ok(summarize(hard).error > 0 && summarize(hard).planner === 0);
  assert.equal(hard.find((p) => p.kind === 'kinematic-limit').limiting, 'v');
  // a measured simulation replaces the analytic estimate in the message
  const sim = simulateDevice(s, toUnits(P), { engine: 'scurve', dtMs: 2 });
  assert.ok(findProblems(s, P, { simulation: sim }).some((p) => p.kind === 'planner-reshaped' && !/>=/.test(p.message)));
  // slow script: nothing
  assert.deepEqual(findProblems(tri(10, 1000), P, {}), []);
});

test('scurve engine: respects v/a/j, converges when slow, loses amplitude when too fast', () => {
  const lim = { v: 600, a: 50000, j: 1e7 };
  const slow = tri(20, 500);
  const sim = simulateDevice(slow, lim, { engine: 'scurve', dtMs: 1, shape: false });
  assert.equal(sim.engine, 'scurve');
  let vmax = 0, amax = 0, jmax = 0;
  for (let i = 1; i < sim.t.length; i++) { vmax = Math.max(vmax, Math.abs(sim.vel[i])); amax = Math.max(amax, Math.abs(sim.acc[i])); jmax = Math.max(jmax, Math.abs(sim.acc[i] - sim.acc[i - 1]) * 1000); }
  assert.ok(vmax <= lim.v * 1.0001 && amax <= lim.a * 1.0001 && jmax <= lim.j * 1.01, `${vmax} ${amax} ${jmax}`);
  const te = trackingError(slow, sim);
  assert.ok(te.max < 2.5 && te.rms < 0.6, JSON.stringify(te));
  assert.ok(te.lagAtExtremesMs.n >= 15 && Math.abs(te.lagAtExtremesMs.mean) < 15 && te.extremeShortfall.max < 2.5);
  // saturated: limits still hold
  const wild = tri(40, 70);
  const w = simulateDevice(wild, lim, { engine: 'scurve', dtMs: 1, shape: false });
  let wv = 0, wa = 0;
  for (let i = 0; i < w.t.length; i++) { wv = Math.max(wv, Math.abs(w.vel[i])); wa = Math.max(wa, Math.abs(w.acc[i])); }
  assert.ok(wv <= lim.v * 1.0001 && wa <= lim.a * 1.0001);
  assert.ok(trackingError(wild, w).extremeShortfall.mean > 20, 'too-fast stroke loses amplitude');
  // dtMs sampling and range
  const r = simulateDevice(slow, lim, { engine: 'scurve', dtMs: 10, t0: 1000, t1: 2000 });
  assert.equal(r.t.length, 101); assert.equal(r.t[0], 1000); assert.equal(r.t[100], 2000);
  // jump 0->100 in 50 ms then hold: planner shape trims to the reach; without shape it arrives later, in about the predicted time
  const jump = [{ at: 0, pos: 0 }, { at: 500, pos: 0 }, { at: 550, pos: 100 }, { at: 2000, pos: 100 }];
  const j = simulateDevice(jump, lim, { engine: 'scurve', dtMs: 1, shape: false });
  let arrive = -1;
  for (let i = 0; i < j.t.length; i++) if (j.pos[i] >= 99) { arrive = j.t[i] - 500; break; }
  const T = minMoveTime(100, lim) * 1000;
  assert.ok(arrive >= T * 0.95 && arrive <= T * 1.5, `arrived after ${arrive} ms, ideal ${T}`);
  assert.deepEqual(simulateDevice([], lim, { engine: 'scurve' }).pos.length, 1);
});

test('plannerShape: time kept, amplitude trimmed forward, hold inherits, last knot of a move untouched', () => {
  const lim = { v: 600, a: 50000, j: 1e7 };
  const jump = [{ at: 0, pos: 0 }, { at: 500, pos: 0 }, { at: 550, pos: 100 }, { at: 1550, pos: 100 }];
  const sh = plannerShape(jump, lim, { smooth: false });
  assert.deepEqual(sh.at, [0, 500, 550, 1550]);
  const reach = 0.9 * maxReach(0.05, lim);
  near(sh.pos[2], reach, 1e-9); near(sh.pos[3], reach, 1e-9);        // the hold stays where the trim left it
  assert.ok(reach > 12 && reach < 25, String(reach));
  const slow = tri(6, 500);
  assert.deepEqual(plannerShape(slow, lim, { smooth: false }).pos, slow.map((a) => a.pos));
  const smooth = plannerShape(slow, lim);
  assert.ok(smooth.at.length > slow.length && smooth.pos.every((p) => p >= 0 && p <= 100));
});

test('sweepStroke: reshaping only grows with the window', () => {
  const P = getProfile('nucleus-capstan');
  const s = tri(40, 140);
  const rows = sweepStroke(s, P, [100, 150, 200, 250, 300], { tracking: false });
  assert.deepEqual(rows.map((r) => r.strokeMm), [100, 150, 200, 250, 300]);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].share >= rows[i - 1].share && rows[i].worstShortfallMs >= rows[i - 1].worstShortfallMs);
  assert.equal(rows[0].reshaped, 0); assert.ok(rows[4].reshaped > 0); assert.equal(rows[0].rms, null);
  const t = sweepStroke(s, P, [100, 300], { engine: 'scurve', dtMs: 2 });
  assert.ok(t[1].rms > t[0].rms && t[0].engine === 'scurve');
});

test('engine selection: auto falls back to scurve until the planner is loaded', async () => {
  const lim = { v: 600, a: 50000, j: 1e7 };
  const s = tri(10, 500);
  if (!kineticLoaded()) { assert.equal(simulateDevice(s, lim).engine, 'scurve'); assert.throws(() => simulateDevice(s, lim, { engine: 'kinetic' }), /not loaded/); }
  const v = await loadKinetic();
  assert.match(v, / kinetic2 /); assert.equal(kineticVersion(), v); assert.equal(await loadKinetic(), v, 'shared instance');
  assert.equal(simulateDevice(s, lim).engine, 'kinetic');
  assert.equal(simulateDevice(s, lim, { engine: 'scurve' }).engine, 'scurve');
  assert.equal((await simulateDeviceAsync(s, lim, { engine: 'scurve' })).engine, 'scurve');
});

test('kinetic engine: the machine planner on the reference scripts (values measured from the vendored wasm)', () => {
  const P = getProfile('nucleus-capstan');
  const at = (L) => toUnits(withStroke(P, L));
  // slow triangle: every extreme reached, legs are smoothstep (rms 6.9 against the linear script), no anomalies
  const slow = tri(20, 500);
  for (const L of [100, 200, 300]) {
    const k = simulateDevice(slow, at(L), { engine: 'kinetic', dtMs: 2 }), te = trackingError(slow, k);
    assert.deepEqual(k.anomalies, {}); near(te.rms, 6.9, 0.3); assert.ok(te.extremeShortfall.max < 0.5 && Math.abs(te.lagAtExtremesMs.mean) <= 2);
    assert.equal(k.strokeMm, L);
  }
  // 0->100 in 50 ms, hold: knot lands at 34.8 mm whatever the window (units 34.8 / 17.4 / 11.6), and stays
  const jump = [{ at: 0, pos: 0 }, { at: 500, pos: 0 }, { at: 550, pos: 100 }, { at: 1550, pos: 100 }];
  for (const [L, want] of [[100, 34.8], [200, 17.4], [300, 11.6]]) {
    const k = simulateDevice(jump, at(L), { engine: 'kinetic', dtMs: 1 }), i = k.t.indexOf(550), i2 = k.t.indexOf(1500);
    near(k.pos[i], want, 0.6); near(k.pos[i2], want, 0.6);
    assert.ok(k.anomalies['knot trimmed'] > 0);
  }
  // the analytic engine follows the same rules: close on the jump and the slow triangle
  for (const L of [100, 200, 300]) {
    const a = simulateDevice(jump, at(L), { engine: 'kinetic', dtMs: 5 }), b = simulateDevice(jump, at(L), { engine: 'scurve', dtMs: 5 });
    let mx = 0;
    for (let i = 0; i < a.t.length; i++) mx = Math.max(mx, Math.abs(a.pos[i] - b.pos[i]));
    assert.ok(mx < 4, `jump ${L}: engines differ by ${mx}`);
    const c = simulateDevice(slow, at(L), { engine: 'kinetic', dtMs: 5 }), d = simulateDevice(slow, at(L), { engine: 'scurve', dtMs: 5 });
    mx = 0;
    for (let i = 0; i < c.t.length; i++) mx = Math.max(mx, Math.abs(c.pos[i] - d.pos[i]));
    assert.ok(mx < 1.5, `triangle ${L}: engines differ by ${mx}`);
  }
  // the six-point knot cycle 0>17>64>80>30>20>0 (gen README): tops reached at every window, pop-out knot trimmed at 300 mm
  const knots = [[0, 0], [292, 17], [375, 64], [518, 80], [871, 30], [1041, 20], [1083, 0]], knot = [];
  for (let c = 0; c < 6; c++) for (const [t, p] of knots.slice(c ? 1 : 0)) knot.push({ at: c * 1083 + t, pos: p });
  const k3 = simulateDevice(knot, at(300), { engine: 'kinetic', dtMs: 1 });
  near(k3.pos[k3.t.indexOf(375 + 1083 * 2)], 45.3, 2.5);
  near(simulateDevice(knot, at(100), { engine: 'kinetic', dtMs: 1 }).pos[375 + 1083 * 2], 63.65, 1.5);
});

test('timings: 10 minutes', () => {
  const s = tri(2400, 250), lim = toUnits(getProfile('nucleus-capstan'));
  const time = (label, f) => { const t = performance.now(); const v = f(); console.log(`  [timing] ${label}: ${(performance.now() - t).toFixed(0)} ms`); return [performance.now() - t, v]; };
  const [k] = time('kinetic engine, 10 min at 1 ms', () => simulateDevice(s, lim, { engine: 'kinetic' }));
  const [c] = time('scurve engine, 10 min at 1 ms', () => simulateDevice(s, lim, { engine: 'scurve' }));
  const [p] = time('findProblems with kinematics, 10 min', () => findProblems(s, getProfile('nucleus-capstan'), {}));
  assert.ok(k < 3000 && c < 3000 && p < 3000);
});

test('strokeShortfalls / planner notes describe the limiting part, and sub-unit reshapes are not reported', () => {
  const lim = { v: 600, a: 50000, j: 1e7 };                          // Capstan at 200 mm, in units
  // knot-style pop at the end: 60 units in 400 ms, then 20 more in 20 ms into a hold. The whole stroke is easy; the pop is not.
  const pop = [{ at: 0, pos: 0 }, { at: 400, pos: 60 }, { at: 420, pos: 80 }, { at: 900, pos: 80 }];
  const [st] = strokeShortfalls(pop, lim);
  assert.equal(st.sub.whole, false); assert.deepEqual([st.sub.i0, st.sub.i1, st.sub.d, st.sub.durationMs], [1, 2, 20, 20]);
  near(st.sub.requiredMs, reachTime(20, lim).T * 1000, 1e-9); near(st.sub.requiredMs - st.sub.durationMs, st.shortfallMs, 1e-9);
  near(reachTime(20 - st.shortfallUnits, lim).T, 0.02, 1e-6);        // shortfall = what 20 ms of full throttle cannot cover
  const P = getProfile('nucleus-capstan');
  const note = findProblems(pop, P, {}).find((p) => p.kind === 'planner-reshaped');
  assert.match(note.message, /20 units in 20 ms \(last part of a 80-unit, 420 ms stroke\) needs at least \d+ ms .*has 20 ms; expected peak position shortfall >= \d/);
  assert.ok(note.shortfallUnits >= 1);
  // whole-stroke numbers are unchanged for a plain too-fast stroke
  const [w] = strokeShortfalls([{ at: 0, pos: 0 }, { at: 100, pos: 100 }, { at: 600, pos: 100 }], lim);
  assert.equal(w.sub.whole, true); near(w.shortfallUnits, 100 - maxReach(0.1, lim), 1e-9);
  // a pop right at the speed limit is reshaped by well under a unit: no note (was "... shortfall >= 0.0 units")
  const edge = [{ at: 0, pos: 0 }, { at: 400, pos: 60 }, { at: 441, pos: 80 }, { at: 900, pos: 80 }];
  assert.ok(strokeShortfalls(edge, lim).length === 1 && strokeShortfalls(edge, lim)[0].shortfallUnits < 1);
  assert.equal(findProblems(edge, P, {}).filter((p) => p.kind === 'planner-reshaped').length, 0);
});
