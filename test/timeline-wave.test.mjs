import test from 'node:test';
import assert from 'node:assert/strict';
import { placeTip, thumbSize, pyramidPeak } from '../src/features/timeline/wave-logic.js';

test('placeTip: default, flip, clamp', () => {
  assert.deepEqual(placeTip(100, 100, 50, 40, 800, 600), { left: 114, top: 116 });
  const r = placeTip(790, 590, 50, 40, 800, 600);
  assert.equal(r.left, 790 - 14 - 50); assert.equal(r.top, 590 - 16 - 40);
  const c = placeTip(10, 5, 900, 700, 800, 600);   // bigger than window: pinned to pad
  assert.deepEqual(c, { left: 4, top: 4 });
});
test('thumbSize aspect', () => {
  assert.deepEqual(thumbSize({ width: 1280, height: 720 }), { w: 144, h: 81 });
  assert.deepEqual(thumbSize(null), { w: 144, h: 81 });
  assert.equal(thumbSize({ width: 100, height: 100 }, 100).h, 100);
});
test('pyramidPeak', () => {
  assert.equal(pyramidPeak({ levels: [{ min: [-0.5, 0], max: [0.2, 0.7] }] }), 0.7);
  assert.equal(pyramidPeak({ levels: [{ min: [0], max: [0] }] }), 1);
  assert.equal(pyramidPeak(null), 1);
});
