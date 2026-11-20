import assert from 'node:assert/strict';
import test from 'node:test';
import { indexRepeats } from '../src/features/timeline/repeats.js';
import { loopPasses, phaseMap, averagePass, repeatAveraged, loopStates, averagedRun, derivedChannel, spreadOf, SPREAD_MAX } from '../src/lib/loop-average.js';

// a 20-picture loop at 30 fps, 5 passes back to back from frame 30; reused footage at frame 300 starting at picture 7,
// picture 12 held 3 frames, picture 15 dropped. Truth = sin over the loop's phase.
const fm = 1000 / 30, F = 20, P0 = 30, NP = 5, T = (f) => f * fm;
const occ = Array.from({ length: F }, () => []);
for (let k = 0; k < NP; k++) for (let p = 0; p < F; p++) { const f = P0 + k * F + p; occ[p].push({ f0: f, f1: f, t_ms: T(f) }); }
const reused = [];   // [frame, picture]
{ let f = 300; for (const p of [...Array(F).keys()].map((i) => (i + 7) % F)) { if (p === 15) continue; const h = p === 12 ? 3 : 1; occ[p].push({ f0: f, f1: f + h - 1, t_ms: T(f) }); for (let i = 0; i < h; i++) reused.push([f + i, p]); f += h; } }
const ix = indexRepeats({ frames: 400, buckets: occ });
const truth = (p) => 50 + 40 * Math.sin((2 * Math.PI * p) / F);
const loop = { id: 'lp1', t0: Math.round(T(P0)), t1: Math.round(T(P0 + F)), auto: { key: 'k', t0: Math.round(T(P0)), t1: Math.round(T(P0 + F)), end: Math.round(T(P0 + NP * F)), n: NP } };
const noise = (k, j) => Math.sin(k * 12.9898 + j * 78.233) * 3;
/** a channel over frames 0..400: the truth inside the loop + per-pass noise; pass `bad` shifted by `off`; outside 20 */
function chan({ bad = -1, off = 0, scale = 1 } = {}) {
  const t = [], v = [];
  for (let f = 0; f < 400; f++) {
    t.push(T(f));
    const k = Math.floor((f - P0) / F), p = f - P0 - k * F;
    v.push(k >= 0 && k < NP ? truth(p) * (k === bad ? scale : 1) + noise(k, p) + (k === bad ? off : 0) : 20);
  }
  return { t: Float64Array.from(t), v: Float32Array.from(v), min: 0, max: 100, scaled: Float32Array.from(v, (x) => x / 100) };
}

test('passes of an automatic loop; phase by picture is exact on every pass', () => {
  const ps = loopPasses(loop, fm);
  assert.equal(ps.length, NP);
  for (let k = 0; k < NP; k++) {
    const m = phaseMap(ix, ps[0], ps[k], fm);
    for (const p of [0, 7, 19]) assert.ok(Math.abs(m.at(T(P0 + k * F + p)) - (T(P0 + p) - ps[0].t0)) < 1.5, `pass ${k} pic ${p}`);
  }
});

test('reused footage: another start phase, a held picture stalls the phase, a dropped one is skipped', () => {
  const ps = loopPasses(loop, fm), m = phaseMap(ix, ps[0], { t0: T(300), t1: T(300 + reused.length) }, fm), R = ps[0].t1 - ps[0].t0;
  for (const [f, p] of reused) {
    const ph = ((m.at(T(f)) % R) + R) % R, want = T(P0 + p) - ps[0].t0;
    assert.ok(Math.abs(ph - want) < fm * 1.01 || Math.abs(ph - want - R) < fm, `frame ${f} pic ${p}: ${ph} vs ${want}`);
  }
});

test('robust average: the median ignores one wild pass; spread kept per phase', () => {
  const ps = loopPasses(loop, fm), maps = ps.map((p) => phaseMap(ix, ps[0], p, fm));
  const a = averagePass(chan({ bad: 2, off: 60 }), ps, maps);
  assert.equal(a.per.length, NP);
  for (let j = 0; j < a.t.length; j++) assert.ok(Math.abs(a.v[j] - truth(j)) < 4, `phase ${j}: ${a.v[j]} vs ${truth(j)}`);
  assert.ok(spreadOf(a) < SPREAD_MAX, 'one wild pass of five does not close the gate');
});

test('repeat + blend: every pass identical, the raw signal untouched beyond the blend, faded in at the ends', () => {
  const ps = loopPasses(loop, fm), maps = ps.map((p) => phaseMap(ix, ps[0], p, fm)), ch = chan();
  const v = repeatAveraged(ch, ps, maps, averagePass(ch, ps, maps), 300);
  for (let p = 0; p < F; p++) for (let k = 1; k < NP; k++) assert.ok(Math.abs(v[P0 + k * F + p] - v[P0 + p]) < 1e-3);
  assert.equal(v[P0 - 10], 20);                           // 333 ms before: outside the blend
  assert.equal(v[P0 + NP * F + 10], 20);
  const near = v[P0 - 1];
  assert.ok(near !== 20 && Math.abs(near - 20) > 1, 'one frame before the loop is mostly the average');
});

test('the gate: on by default for a quiet automatic loop; passes that differ are not averaged and say so; the toggle wins', () => {
  const run = (ch) => ({ range: { start: 0, end: T(400) }, channel: 'g1_y', channels: { g1_y: ch }, samples: { t: [], v: [] } });
  const q = loopStates(run(chan()), [loop], ix, fm)[0];
  assert.ok(q.on && q.spread < SPREAD_MAX && q.n === NP, q.why);
  // passes that disagree: every other pass upside down
  const c = chan(); for (let f = 0; f < 400; f++) { const k = Math.floor((f - P0) / F); if (k >= 0 && k < NP && k % 2) c.v[f] = 100 - c.v[f]; }
  const d = loopStates(run(c), [loop], ix, fm)[0];
  assert.equal(d.on, false); assert.match(d.why, /passes differ: not averaged/);
  assert.equal(loopStates(run(c), [{ ...loop, avg: true }], ix, fm)[0].on, true);
  assert.equal(loopStates(run(chan()), [{ ...loop, avg: false }], ix, fm)[0].on, false);
  // a hand loop with no tiles has one pass: nothing
  assert.equal(loopStates(run(chan()), [{ id: 'h', t0: loop.t0, t1: loop.t1 }], ix, fm).length, 0);
});

test('averagedRun: every channel averaged in a copy, the stored run keeps its raw passes; off = the same run', () => {
  const r = { range: { start: 0, end: T(400) }, channel: 'g1_y', channels: { g1_y: chan({ bad: 1, off: 50 }), g2_y: chan() }, samples: { t: [], v: [] } };
  const raw = Float32Array.from(r.channels.g1_y.v);
  const a = averagedRun(r, { loops: [{ ...loop, avg: true }], ix, fm });
  assert.notEqual(a, r);
  assert.deepEqual(r.channels.g1_y.v, raw);
  assert.ok(Math.abs(a.channels.g1_y.v[P0 + F + 5] - a.channels.g1_y.v[P0 + 5]) < 1e-3);
  assert.ok(Math.abs(a.channels.g1_y.scaled[P0 + 5] - a.channels.g1_y.v[P0 + 5] / 100) < 1e-6);
  assert.equal(averagedRun(r, { loops: [{ ...loop, avg: false }], ix, fm }), r);
});

test('derivedChannel: the source loop averaged, mapped by picture onto reused footage', () => {
  const src = { ...chan({ bad: 3, off: 60 }), range: { start: 0, end: T(400) } };
  const d = derivedChannel(src, ix, loop, { t0: T(300), t1: T(300 + reused.length) }, fm);
  assert.ok(d && d.t.length >= reused.length - 1);
  for (let j = 0; j < d.t.length; j++) {
    const [, p] = reused[j];
    assert.ok(Math.abs(d.v[j] - truth(p)) < 5, `frame ${300 + j} pic ${p}: ${d.v[j]} vs ${truth(p)}`);
  }
});

test('a short loop with many passes and its last pass cut short: the passes stay on the pictures (an owner clip, shot 76)', () => {
  // 8 frames at 24 fps (333.33 ms), 16.6 passes: (end - t0) / n is 326 ms, 7 ms a pass short: within half a frame per pass,
  // but 117 ms (2.8 frames) off by the 17th; the drift over the passes decides, not one period
  const f24 = 1000 / 24, P = 8 * f24, l = { id: 'lp76', t0: 438000, t1: 438333, auto: { key: 'k76', t0: 438000, t1: 438333, end: 443542, n: 17 } };
  const ps = loopPasses(l, f24);
  assert.ok(ps.length >= 16, `${ps.length} passes`);
  for (const [k, p] of ps.entries()) assert.ok(Math.abs(p.t0 - (l.t0 + k * P)) <= 1, `pass ${k} starts ${p.t0}, the picture's cycle at ${(l.t0 + k * P).toFixed(1)}`);
  // whole passes that agree keep the n-pass mean (a frame-exact loop: the picture's cycle)
  const whole = { ...l, auto: { ...l.auto, end: Math.round(l.t0 + 16 * P), n: 16 } };
  assert.ok(loopPasses(whole, f24).every((p, k) => Math.abs(p.t0 - (l.t0 + k * P)) <= 1));
});
