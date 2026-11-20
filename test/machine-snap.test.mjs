// Machine: the knot's snap-through (paw-tgq, src/features/machine/physics.js ringForce and the toy's axial mode): it
// resists, then shoots in past the carriage; pulled, it flies out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TOYS, knotOf, radiusAt } from '../src/features/machine/toys.js';
import { initialState, makeContext, step, paramsFor, ringForce, MachineSim } from '../src/features/machine/physics.js';
import { budget } from './perf.mjs';

const knotted = BUILTIN_TOYS.find((t) => t.id === 'b-knot'), K = knotOf(knotted), RIG = { offsetMm: -10, strokeMm: 140 };
const posFor = (d) => (1 - (d - RIG.offsetMm) / RIG.strokeMm) * 100, DEEP = K.to_mm + 20, PUSH = 3000;
const VC = (DEEP + 5) / (PUSH / 1000);   // the carriage's speed, mm/s (69)

/** Push past the knot over PUSH ms, hold H ms, pull out over PUSH ms (no anatomy: the ring alone; Capstan cap). */
function cycle(level, firmness, w, over = {}, toy = knotted, H = 3000) {
  const ctx = makeContext(toy, RIG, paramsFor(level, { firmness, forceLimitN: 267, anatomy: false, ...over })), s = initialState(ctx.P);
  s.w = w; ctx.events = [];
  let over0 = 0, dMax = -Infinity, vMax = 0, bad = false, tIn = -Infinity;
  for (let t = 0; t < 2 * PUSH + H + 2000; t += 5) {
    const pos = t < PUSH ? posFor(-5 + (DEEP + 5) * t / PUSH) : t < PUSH + H ? posFor(DEEP) : t < 2 * PUSH + H ? posFor(DEEP - (DEEP + 5) * (t - PUSH - H) / PUSH) : posFor(-5);
    const was = s.knot;
    step(s, pos, ctx);
    if (s.knot === 'tied' && was !== 'tied' && tIn < 0) tIn = s.t;
    if (s.t - tIn <= 300) over0 = Math.max(over0, s.d - s.dcr);   // past the carriage just after the snap in
    dMax = Math.max(dMax, s.d); vMax = Math.max(vMax, Math.abs(s.v));
    if (![s.d, s.v, s.F, s.xi, s.w].every(Number.isFinite)) bad = true;
  }
  const ev = (k) => ctx.events.find((e) => e.kind === k);
  return { in: ev('in'), pop: ev('pop'), fail: ev('fail'), over: over0, vMax, bad };
}

test('snap: the ring\'s axial force on a knot peaks against it on the rising flank, then reverses past the widest point', () => {
  const ctx = makeContext(knotted, RIG, paramsFor('some', { firmness: '5', anatomy: false })), s = initialState(ctx.P), C = ctx.canal;
  const F = (d) => { for (let j = 0; j < C.n; j++) s.ap[j] = Math.max(3, radiusAt(knotted, d - C.y[j]) || 0); return ringForce(ctx, s, d); };   // the ring wrapping the toy
  const curve = [];
  for (let d = K.from_mm - 10; d <= K.to_mm + 10; d += 2) curve.push([d, F(d)]);
  const [dPk, fPk] = curve.reduce((a, b) => (b[1] < a[1] ? b : a));
  assert.ok(fPk < -20 && dPk < K.peak_mm + C.Lc / 2, `resists, most just before the widest point: ${fPk} N at ${dPk}`);
  const rev = curve.find(([d, f]) => d > dPk && f > 0);
  assert.ok(rev && rev[0] <= K.peak_mm + C.Lc, `reverses once the widest point is in the canal: ${JSON.stringify(rev)}`);
  assert.ok(Math.max(...curve.filter(([d]) => d > rev[0]).map(([, f]) => f)) > 15, 'and then pushes it in');
  assert.ok(Math.abs(F(K.from_mm - 30)) < 3, 'a plain shaft: almost nothing');
});

test('snap: half warm, the knot shoots in faster than the carriage and flies out on the pull; the overshoot is small', () => {
  const r = cycle('some', '5', 0.4);
  assert.ok(r.in && r.pop, JSON.stringify(r));
  assert.ok(r.in.speed > 5 * VC, `in at ${r.in.speed} mm/s, carriage ${VC}`);
  assert.ok(r.pop.speed > 5 * VC, `out at ${r.pop.speed} mm/s, carriage ${VC}`);
  assert.ok(r.in.peak > 25 && r.pop.peak > 25, `takes force: ${r.in.peak} N in, ${r.pop.peak} N out`);
  assert.ok(r.over > 1 && r.over < 0.25 * (K.to_mm - K.from_mm), `overshoots past the carriage by ${r.over} mm (knot ${K.to_mm - K.from_mm} mm)`);
  assert.ok(!r.bad && r.vMax < 5000, `bounded: ${r.vMax} mm/s`);
});

test('snap: warmer is a lower peak and a softer snap; a cold beginner with a big knot never gets over it', () => {
  const half = cycle('some', '5', 0.4), warm = cycle('some', '5', 0.8), very = cycle('very', '5', 0.6);
  assert.ok(warm.in.peak < half.in.peak && warm.in.speed < half.in.speed, `warm ${JSON.stringify(warm.in)} vs half ${JSON.stringify(half.in)}`);
  assert.ok(very.in.speed > 1.3 * VC && very.in.speed < half.in.speed, `very experienced still snaps, softly: ${very.in.speed}`);
  // a knot 1.3 x as wide (78 mm): past what a beginner's canal stretches to (J-shaped limit), held 3 s or 30 s
  const big = { ...knotted, id: 'big', profile: knotted.profile.map(([u, r]) => [u, r * 1.3]) };
  for (const hold of [{}, { holdMs: 30000 }]) {
    const cold = cycle('beginner', '5', 0, {}, big, hold.holdMs);
    assert.ok(!cold.in && cold.fail && !cold.bad, `cold beginner, big knot: ${JSON.stringify(cold)}`);
  }
  assert.ok(cycle('experienced', '5', 0.6, {}, big).in, 'a warmed experienced receiver takes it');
});

test('snap: a firm knot pops harder than a soft one', () => {
  const firm = cycle('some', '8', 0.4), soft = cycle('some', '2', 0.4);
  assert.ok(firm.in.peak > 3 * soft.in.peak && firm.pop.peak > 3 * soft.pop.peak, `peak force firm ${firm.in.peak} / ${firm.pop.peak} vs soft ${soft.in.peak} / ${soft.pop.peak}`);
  assert.ok(firm.in.speed > soft.in.speed && firm.pop.speed > soft.pop.speed, `speed firm ${firm.in.speed} / ${firm.pop.speed} vs soft ${soft.in.speed} / ${soft.pop.speed}`);
});

test('snap: stable and bounded at the stiffest and softest settings', () => {
  for (const [level, f, w] of [['beginner', '8', 0], ['beginner', '2', 0], ['very', '8', 1], ['very', '2', 1], ['some', 'rigid', 0.5]]) {
    const r = cycle(level, f, w);
    assert.ok(!r.bad && r.vMax < 8000 && r.over < 0.3 * (K.to_mm - K.from_mm), `${level} ${f}: ${JSON.stringify({ vMax: r.vMax, over: r.over })}`);
  }
});

test('snap: playing and scrubbing agree through knot strokes; an hour of them integrates fast', () => {
  const script = [];
  for (let i = 0; i < 1200; i++) script.push({ at: i * 3000, pos: 95 }, { at: i * 3000 + 1500, pos: 0 });
  const P = paramsFor('some', { firmness: '5', forceLimitN: 267 }), a = new MachineSim().configure(script, knotted, RIG, P);
  for (let t = 0; t < 60000; t += 16.7) a.stateAt(t);
  assert.deepEqual(a.stateAt(60000).state, new MachineSim().configure(script, knotted, RIG, P).stateAt(60000).state);
  // this thread's CPU time, not wall time (paw-0u3v: a full suite on a many-core PC keeps it waiting)
  const t0 = process.threadCpuUsage(); new MachineSim().configure(script, knotted, RIG, P).stateAt(3600000); const u = process.threadCpuUsage(t0), ms = (u.user + u.system) / 1000;
  budget(ms < 2000, `${ms} ms`);
  console.log(`an hour of knot strokes: ${Math.round(ms)} ms`);
});
