import test from 'node:test';
import assert from 'node:assert/strict';
import { series, makeRun, newFrames, layerOf } from '../src/lib/runs.js';

test('arrays of a run are in strictly rising time whatever order the rows came in', () => {
  const s = series([[40, 1], [0, 0], [80, 2], [40, 9], [NaN, 3], [20, 5]]);
  assert.deepEqual(Array.from(s.t), [0, 20, 40, 80]);
  assert.deepEqual(Array.from(s.v), [0, 5, 1, 2]);
  const r = makeRun({ n: 1, tracker: { id: 'x', name: 'x' }, params: {}, range: { start: 0, end: 80 }, roi: null, runs: [], frames: newFrames(),
    result: { samples: [[40, 0.5], [0, 0], [80, 1]], points: [{ at: 80, pos: 100 }, { at: 0, pos: 0 }], channels: { c: [[40, 1], [0, 2]] } } });
  const mono = (t) => t.every((x, i) => !i || x > t[i - 1]);
  assert.ok(mono(r.samples.t) && mono(r.points.at) && mono(r.channels.c.t) && mono(layerOf(r).t));
});

test('a both-ways stream (backward half first, then forward, the seed row twice) is one rising run', () => {
  const seed = 30, back = [30, 20, 10, 0], fwd = [30, 40, 50];   // the order a tracker that did not merge would emit
  const r = makeRun({ n: 1, tracker: { id: 'x', name: 'x' }, params: {}, range: { start: 0, end: 60 }, roi: null, runs: [], frames: newFrames(),
    result: { samples: [...back, ...fwd].map((t) => [t, t / 100]), points: [] } });
  assert.deepEqual(Array.from(r.samples.t), [0, 10, 20, 30, 40, 50]);
  assert.equal(seed, 30);
});

test('appendFrames keeps live frames in rising time whatever order the chunks arrive in', async () => {
  const { newFrames, appendFrames, overlayIndex } = await import('../src/lib/runs.js');
  const fr = newFrames(), ev = (t) => ({ t_ms: t, value: t / 1000, overlay: { t } });
  appendFrames(fr, [ev(100), ev(133), ev(167)]);          // the seed chunk
  appendFrames(fr, [ev(33), ev(67), ev(100)]);             // a backward chunk, ascending inside, seed row again
  appendFrames(fr, [ev(0)]);
  appendFrames(fr, [ev(200), ev(233)]);                    // then forward
  assert.deepEqual(fr.t, [0, 33, 67, 100, 133, 167, 200, 233]);
  assert.deepEqual(fr.v, fr.t.map((t) => t / 1000));
  assert.equal(fr.ov[overlayIndex(fr, 70)].t, 67);
});

test('orderFrames sorts a saved run whose backward half was stored in arrival order', async () => {
  const { orderFrames, overlayIndex } = await import('../src/lib/runs.js');
  const fr = orderFrames({ t: [100, 133, 33, 67, 100, 0, 167], v: [1, 2, 3, 4, 5, 6, 7], ov: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  assert.deepEqual([...fr.t], [0, 33, 67, 100, 133, 167]);
  assert.deepEqual([...fr.v], [6, 3, 4, 5, 2, 7]);
  assert.equal(fr.ov[overlayIndex(fr, 70)], 'd');
  const same = { t: [0, 33], v: [1, 2], ov: [null, null] };
  assert.equal(orderFrames(same), same);
});
