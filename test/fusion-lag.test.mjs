// paw-bc9d: fusion's phase search stays under half the stroke period, and a lag between two frames is not beaten by its
// half-period twin landing on a frame (the trap of experiments/fusion/channels.mjs --traps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phase, lagRange, fuseScene, voicesOf, DEBUG, FUSE } from '../src/lib/fusion.js';
import { runOf, T, strokeAt } from './fusion-synth.mjs';

const dt = 1000 / 30, t = Array.from({ length: 600 }, (_, i) => i * dt);
const sine = (Pms, lagMs = 0) => Float64Array.from(t, (ms) => Math.sin((2 * Math.PI * (ms - lagMs)) / Pms) * (1 + 0.05 * Math.sin(ms / 1700)));

test('lagRange: under half the stroke period on fast strokes, LAG_MAX_MS on slow ones, LAG_MAX_MS without turns', () => {
  const f = lagRange(t, sine(500), dt);
  assert.ok(f.L * dt < 250 && f.L >= 6, `fast: L ${f.L * dt} ms`);
  assert.ok(Math.abs(f.P * dt - 500) < 40, `fast: P ${f.P * dt}`);
  assert.equal(lagRange(t, sine(1500), dt).L, Math.round(FUSE.LAG_MAX_MS / dt));
  assert.equal(lagRange(t, new Float64Array(600), dt).L, Math.round(FUSE.LAG_MAX_MS / dt));
});

test('phase: a lag between two frames beats its half-period twin on a frame; an out-of-range lag is ambiguous', () => {
  // 30 fps, a 500 ms tempo drifting a little (like the trap): +150 ms = 4.5 frames, its twin -100 ms = -3 frames exactly
  const ph = Float64Array.from(t, (ms, i) => (2 * Math.PI * (ms / 1000)) * 2 + 0.3 * Math.sin((2 * Math.PI * ms) / 7000));
  const at = (lagMs) => Float64Array.from(t, (ms) => { const x = (ms - lagMs) / dt, i = Math.max(0, Math.min(598, Math.floor(x))); return Math.sin(ph[i] + (ph[i + 1] - ph[i]) * (x - i)); });
  const ref = at(0), P = 500 / dt, L = Math.floor(0.45 * P), M = 12;
  const p150 = phase(at(150), ref, 12, P, M);
  assert.ok(p150.r > 0 && Math.abs(p150.lag * dt - 150) <= 20, `150 ms: lag ${p150.lag * dt} r ${p150.r}`);
  assert.ok(p150.amb < 0.5, `150 ms is decidable: amb ${p150.amb}`);
  // 250 ms (half a period) is past the range: the smaller-|lag| reading, the sign flipped, flagged as undecidable
  const p250 = phase(at(250), ref, L, P, M);
  assert.ok(Math.abs(p250.lag) * dt < 250 && p250.r < 0, `250 ms: lag ${p250.lag * dt} r ${p250.r}`);
  assert.ok(p250.amb > 0.5, `250 ms: amb ${p250.amb}`);
});

/** the trap: a big Top tail lagging lagMs behind 500 ms strokes -> its part reading in the panel and its HOW voice */
function trap(lagMs, seed) {
  const D = [0.6, -0.8], A = 16 / 9, mv = (amp, f) => (i) => [(amp * D[0] * f(T[i])) / A, amp * D[1] * f(T[i])], add = (a, b) => (i) => { const p = a(i), q = b(i); return [p[0] + q[0], p[1] + q[1]]; }, at = (x, y) => () => [x, y], S = (ms) => strokeAt(ms, true);
  const run = runOf({ c1_hips: { at: at(0.4, 0.6) }, c2_hips: { at: add(at(0.5, 0.45), mv(0.035, S)) }, c2_penis: { at: add(at(0.46, 0.53), mv(0.035, S)) }, c2_tail: { at: add(at(0.58, 0.4), mv(0.07, (ms) => S(ms - lagMs))) } }, { seed });
  DEBUG.on = true; DEBUG.last = null;
  const f = fuseScene(run, T.map((_, i) => i), { aspect: A, acts: ['anal', 'penetration'] }), An = DEBUG.last.A;
  DEBUG.on = false;
  return { part: f.info.bodies.flatMap((b) => b.parts).find((p) => p.id === 'c2_tail'), voice: voicesOf(An, f.v).find((x) => x.id === 'c2_tail'), dt: An.dt };
}
test('the trap: a tail lagging 100 / 150 / 200 ms behind 500 ms strokes reads at its lag with its own sign', () => {
  for (const L of [100, 150, 200]) for (const seed of [1, 3]) {
    const { part, voice, dt: d } = trap(L, seed);
    assert.ok(!part.anti && Math.abs(part.lagMs - L) <= 20, `L ${L} seed ${seed}: part ${part.lagMs} anti ${part.anti}`);
    assert.ok(Math.abs(voice.lag * d - L) <= 20 && voice.w > 0.5, `L ${L} seed ${seed}: voice ${voice.lag * d} w ${voice.w}`);
  }
});
test('the trap: a lag of half the period or more stays inside the range and loses its HOW say', () => {
  for (const L of [250, 300, 350]) {
    const { part, voice, dt: d } = trap(L, 1);
    assert.ok(Math.abs(part.lagMs) < 250 && Math.abs(voice.lag * d) < 250, `L ${L}: part ${part.lagMs} voice ${voice.lag * d}`);
    assert.ok(voice.amb > 0.5 && voice.w < 0.5, `L ${L}: amb ${voice.amb} w ${voice.w}`);
  }
});
