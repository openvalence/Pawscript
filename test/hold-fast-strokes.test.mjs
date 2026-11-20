import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeFit, shapeAt } from '../src/lib/stroke-shape.js';

// 2 strokes a second at 30 fps, noise, one shallow stroke: shoulders of `plateau` ms at the top and bottom (< 0: a sine)
function holds(plateau, seed) {
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
  const dt = 1000 / 30, T = 500, n = 12, N = Math.round((n * T) / dt), t = [], p = [], pl = plateau / T, mv = 0.5 - pl;
  for (let i = 0; i < N; i++) {
    const x = i * dt, k = Math.floor(x / T), u = (x % T) / T;
    const y = plateau < 0 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * u) : u < mv ? u / mv : u < 0.5 ? 1 : u < 0.5 + mv ? 1 - (u - 0.5) / mv : 0;
    t.push(x); p.push(50 + (k === 4 ? 0.6 : 1) * 40 * (2 * y - 1) + 1.5 * rnd());
  }
  const anchors = [0], turn = new Set();
  for (let k = 0; k < n; k++) for (const a of plateau < 0 ? [k * T + 0.5 * T, (k + 1) * T] : [k * T + mv * T, k * T + (1 - pl) * T]) {
    const i = t.findIndex((x) => x >= a - 1);
    if (i > anchors[anchors.length - 1]) { anchors.push(i); turn.add(i); }
  }
  if (anchors[anchors.length - 1] !== N - 1) anchors.push(N - 1);
  return shapeFit(t, p, anchors, turn, shapeAt({ shape: 'hold', sens: 50 }), { minIntervalMs: 60 }).filter((x) => x.why === 'hold').length;
}

test('fast strokes with a real shoulder get their holds on nearly every turn, whatever the noise; a sine and a triangle get none', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    assert.ok(holds(130, seed) >= 22, `130 ms shoulders, seed ${seed}: ${holds(130, seed)} of 24`);
    assert.equal(holds(-1, seed), 0);
    assert.equal(holds(0, seed), 0);
  }
});
