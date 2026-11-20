// Machine panel: the tube past the canal (paw-z0k): per-station resting lumen, readiness and residual opening along
// the rectum, the rectosigmoid junction and the sigmoid (src/features/machine/physics.js TUBE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TOYS } from '../src/features/machine/toys.js';
import { MachineSim, initialState, makeContext, step, paramsFor, params, tubeState, depthSummary, primeDepth, TUBE } from '../src/features/machine/physics.js';
import { budget } from './perf.mjs';

const L = 320, RIG = { offsetMm: -10, strokeMm: 310 }, posFor = (d, rig = RIG) => (1 - (d - rig.offsetMm) / rig.strokeMm) * 100;
/** A long round toy: a 6 mm tip widening to radius r over 60 mm. */
const rod = (r) => ({ id: `rod${r}`, name: 'rod', length_mm: L, profile: Array.from({ length: L + 1 }, (_, u) => [u, 6 + (r - 6) * Math.min(1, u / 60)]) });
const runner = (ctx, s) => (ms, f) => { const end = s.t + ms; while (s.t < end) step(s, f(s.t), ctx); };
/** The station index nearest arc mm (at 175 cm) in each segment we check. */
const AT = { ampulla: (100 - 35) / 5, junction: (150 - 35) / 5, sigmoid: (240 - 35) / 5 };

/** Push rod r deep (to 300 mm), hold, withdraw; then -> excess(ms): lumen - resting lumen per segment, ms after. */
function afterDeep({ r = 30, level = 'some', prime = [0.5, 0.5], w = 0.9, holdMs = 60000 } = {}) {
  const ctx = makeContext(rod(r), RIG, paramsFor(level, { firmness: '3' })), s = initialState(ctx.P), run = runner(ctx, s);
  primeDepth(s, ctx, prime); s.w = w;
  run(3000, (t) => posFor(20 + 280 * Math.min(1, t / 3000))); run(holdMs, () => posFor(300)); run(1500, () => posFor(-20));
  const t0 = s.t;
  return { ctx, s, excess: (ms) => { run(t0 + ms - s.t, () => posFor(-20)); const ts = tubeState(s, ctx); return Object.fromEntries(Object.entries(AT).map(([k, j]) => [k, ts.lumen[j] - ts.r0[j]])); } };
}

test('tube: the segments in their table, in order along the path, each with a fast and a slow return', () => {
  assert.deepEqual(TUBE.map((x) => x.seg), ['flexure', 'ampulla', 'junction', 'sigmoid']);
  for (let i = 1; i < TUBE.length; i++) assert.ok(TUBE[i].from > TUBE[i - 1].from);
  const ctx = makeContext(rod(20), RIG, params()), T = ctx.tube;
  assert.equal(T.s[T.i0], 35); assert.equal(T.s[T.i1], 150);   // the bends sit on stations
  assert.ok(makeContext(rod(20), RIG, params({ anatomy: false })).tube === null);
});

test('tube: after a deep toy the lumen closes fast at first (the residue), then slowly (tone), per segment', () => {
  const { excess } = afterDeep(), fastS = Object.fromEntries(TUBE.map((x) => [x.seg, x.fastS]));
  const g = Object.fromEntries([0, 3000, 10000, 30000, 120000, 300000].map((ms) => [ms, excess(ms)]));
  for (const seg of Object.keys(AT)) {
    const f = fastS[seg] * 1000, fw = f <= 3000 ? 3000 : f <= 10000 ? 10000 : 30000;   // a window about the residue's time
    const fast = (g[0][seg] - g[fw][seg]) / fw, slow = (g[120000][seg] - g[300000][seg]) / 180000;
    assert.ok(g[0][seg] > 1, `${seg} opened: ${g[0][seg]}`);
    assert.ok(fast > 5 * slow && slow > 0, `${seg}: fast ${fast * 1000} mm/s vs slow ${slow * 1000} mm/s`);
    assert.ok(g[300000][seg] > 0.5, `${seg} still partly open after 5 min (tone returns over minutes): ${g[300000][seg]}`);
  }
});

test('tube: at low readiness the ampulla stays open longer than the rectosigmoid junction', () => {
  const { excess } = afterDeep({ prime: [0, 0], w: 0.3, holdMs: 6000 }), a = excess(0), b = excess(20000);
  assert.ok(b.ampulla / a.ampulla > b.junction / a.junction + 0.2, `kept after 20 s: ampulla ${b.ampulla / a.ampulla}, junction ${b.junction / a.junction}`);
});

test('tube: junction readiness builds with repeated depth work and persists longer after more of it', () => {
  const session = (minutes) => {
    const ctx = makeContext(rod(14), RIG, paramsFor('some', { firmness: '5' })), s = initialState(ctx.P), run = runner(ctx, s), j = ctx.tube.i1;
    s.w = 0.8;
    run(minutes * 60000, (t) => posFor(60 + 150 * (0.5 - 0.5 * Math.cos((t / 4000) * 2 * Math.PI))));   // to 210 mm every 4 s
    run(1000, () => posFor(-20));
    const end = s.tr[j];
    run(600000, () => posFor(-20));
    return { end, kept: s.tr[j] / end };
  };
  const one = session(1), five = session(5);
  assert.ok(five.end > one.end + 0.1, `built: 1 min ${one.end}, 5 min ${five.end}`);
  assert.ok(five.kept > one.kept + 0.05, `kept after 10 min: ${one.kept} after 1 min of work, ${five.kept} after 5`);
});

test('tube: a second insertion soon after needs less force and time than the first, and than one much later', () => {
  const taper = BUILTIN_TOYS.find((t) => t.id === 'b-taper'), rig = { offsetMm: -10, strokeMm: 180 };
  const twice = (firmness, waitMs) => {
    const ctx = makeContext(taper, rig, paramsFor('some', { firmness })), s = initialState(ctx.P), run = runner(ctx, s);
    ctx.events = []; s.w = 0.8;
    const push = () => { const t0 = s.t; let maxF = 0; run(40000, (t) => { if (s.d > 140) maxF = Math.max(maxF, Math.abs(s.F)); return posFor(Math.min(170, 20 + 150 * (t - t0) / 1500), rig); }); return maxF; };
    const f1 = push(); run(1500, () => posFor(-20, rig)); run(waitMs, () => posFor(-20, rig));
    const f2 = push(), lag = ctx.events.filter((e) => e.kind === 'bend' && e.bend === 1).map((e) => e.lag);
    return { f1, f2, lag1: lag[0], lag2: lag[1] };
  };
  const soon = twice('firm', 3000), later = twice('firm', 600000);
  assert.ok(soon.f2 < 0.85 * soon.f1 && soon.lag2 < soon.lag1, `firm, 3 s later: ${JSON.stringify(soon)}`);
  assert.ok(soon.f2 < later.f2 && soon.lag2 < later.lag2, `soon ${JSON.stringify(soon)} vs 10 min later ${JSON.stringify(later)}`);
  const med = twice('medium', 3000);
  assert.ok(med.lag2 < med.lag1 / 4, `medium: ${JSON.stringify(med)}`);
});

test('tube: playing and scrubbing give the same tube state', () => {
  const script = [];
  for (let i = 0; i < 60; i++) script.push({ at: i * 3000, pos: 95 }, { at: i * 3000 + 1500, pos: i % 4 ? 30 : 5 });
  const P = paramsFor('experienced', { firmness: '5' }), a = new MachineSim().configure(script, rod(18), RIG, P);
  for (let t = 0; t < 120000; t += 16.7) a.stateAt(t);
  const played = a.stateAt(120000).state, cold = new MachineSim().configure(script, rod(18), RIG, P).stateAt(120000).state;
  assert.deepEqual(played, cold);
  assert.ok(played.tr.some((x) => x > 0.2) && played.te.some((x) => x > 0), 'the tube was worked');
});

test('tube: the readouts are its summary (bend readiness, depth map, depth row)', () => {
  const ctx = makeContext(rod(16), RIG, paramsFor('some', { firmness: '5' })), s = initialState(ctx.P), run = runner(ctx, s), T = ctx.tube, dm = ctx.P.depthMax;
  for (let k = 0; k < 6; k++) {
    run(30000, (t) => posFor(40 + 220 * (0.5 - 0.5 * Math.cos((t / 5000) * 2 * Math.PI))));
    const sum = depthSummary(s, ctx), ts = tubeState(s, ctx);
    assert.deepEqual(sum.acc, [s.tr[T.i0], s.tr[T.i1], 0]);   // (no descending colon of its own: its readiness stays 0, paw-qin8)
    assert.ok(Math.abs(sum.map.junction - ts.ready[T.i1]) < 1e-6 && sum.map.junction === s.tr[T.i1] / dm);
    const mean = (seg) => { let a = 0, n = 0; for (let j = 0; j < T.n; j++) if (seg(T.seg[j])) { a += s.tr[j]; n++; } return a / n / dm; };
    assert.ok(Math.abs(sum.map.rectum - mean((g) => g <= 1)) < 1e-12 && Math.abs(sum.map.sigmoid - mean((g) => g === 3)) < 1e-12);
    assert.equal(sum.map.canal, s.w);
    assert.ok(Math.abs(sum.map.need - sum.need / dm) < 1e-12);
  }
  assert.ok(s.tr[T.i1] > 0.1);
});

test('tube: stable at the stiffest and softest settings over a long hard run', () => {
  const script = [];
  for (let i = 0; i < 200; i++) script.push({ at: i * 1500, pos: 100 }, { at: i * 1500 + 500, pos: 0 }, { at: i * 1500 + 900, pos: 0 });
  for (const [level, firmness] of [['beginner', '8'], ['very', '2'], ['beginner', '2'], ['very', '8']]) {
    const P = paramsFor(level, { firmness, forceLimitN: 267 }), sim = new MachineSim().configure(script, rod(30), RIG, P), s = sim.stateAt(300000).state, ts = tubeState(s, sim.ctx);
    for (let j = 0; j < ts.lumen.length; j++) {
      assert.ok(s.tr[j] >= 0 && s.tr[j] <= P.depthMax + 1e-9, `${level} ${firmness} readiness ${s.tr[j]}`);
      assert.ok(Number.isFinite(s.te[j]) && s.te[j] >= 0 && ts.lumen[j] < 60, `${level} ${firmness} lumen ${ts.lumen[j]}`);
    }
  }
});

test('tube: an hour of deep strokes (into the sigmoid) still integrates fast', () => {
  const script = [];
  for (let i = 0; i < 1800; i++) script.push({ at: i * 2000, pos: 100 }, { at: i * 2000 + 1000, pos: 5 });
  // (this thread's CPU time, not wall time: the work, not how long other processes kept it waiting)
  const sim = new MachineSim().configure(script, rod(16), RIG, paramsFor('very', { firmness: '3' })), t0 = process.threadCpuUsage();
  const s = sim.stateAt(3600000).state, u = process.threadCpuUsage(t0), ms = (u.user + u.system) / 1000;
  budget(ms < 1500, `${ms} ms`);
  assert.ok(s.tr[AT.sigmoid] > 0.3, 'it reached the sigmoid');
  console.log(`an hour of deep strokes: ${Math.round(ms)} ms`);
});
