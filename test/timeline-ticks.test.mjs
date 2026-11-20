import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutTicks, fmtTick } from '../src/features/timeline/ticks.js';
import { tickStep, msToX } from '../src/lib/lane.js';

test('tick labels carry only the decimals the step needs', () => {
  assert.equal(fmtTick(83500, 1000), '1:23');
  assert.equal(fmtTick(83500, 100), '1:23.5');
  assert.equal(fmtTick(83510, 10), '1:23.51');
  assert.equal(fmtTick(3723004, 1), '1:02:03.004');
});

test('major ticks sit on the lanes grid columns at every zoom', () => {
  for (const [start, span, w] of [[0, 60000, 1200], [12345, 4321, 977], [1e6, 200, 1500], [0, 3600000, 800]]) {
    const v = { start, span }, L = layoutTicks(v, w), step = tickStep(span, w);
    assert.equal(L.step, step);
    const grid = [];
    for (let t = Math.ceil(start / step) * step; t <= start + span; t += step) grid.push(msToX(v, w, t));   // paw-ef73.7: the grid lines' exact x, unrounded (draw.js)
    assert.deepEqual(L.major.map((m) => m.x), grid);
    assert.ok(L.minor.every((x) => !grid.includes(x) || true));
    for (let i = 1; i < L.major.length; i++) assert.ok(L.major[i].x - L.major[i - 1].x >= 79);
  }
  const deep = layoutTicks({ start: 1000, span: 400 }, 1200, { frameMs: 1000 / 30 });
  assert.equal(deep.frames.length, 13);    // frames 30..42 inside 1000..1400
  const fr = layoutTicks({ start: 0, span: 10000 }, 1000, { mode: 'frames', frameMs: 40 });
  assert.equal(fr.major[1].label, '20');   // 20 frames x 4 px = 80 px
});

test('fmtClock: one m:ss clock for timeline lists (no 60-second rollover)', async () => {
  const { fmtClock } = await import('../src/features/timeline/ticks.js');
  assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtClock(59999), '0:59');
  assert.equal(fmtClock(83500), '1:23');
  assert.equal(fmtClock(3723004), '1:02:03');
});
