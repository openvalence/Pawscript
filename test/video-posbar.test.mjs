// paw-rtby: the position bar's geometry (features/video/posbar.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAR_DEFAULT, barOk, barOf, barKey, barPoint, barHit, barDrag, machinePos, END_PX } from '../src/features/video/posbar.js';

test('default placement: vertical, near the right edge, deep end down; broken settings fall back to it', () => {
  const b = BAR_DEFAULT;
  assert.ok(barOk(b));
  assert.equal(b.x0, b.x1, 'vertical');
  assert.ok(b.x0 > 0.85, 'near the right edge');
  assert.ok(b.y0 > b.y1, 'deep end (pos 0) below the out end');
  for (const bad of [null, {}, { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 }, { x0: 2, y0: 0, x1: 0, y1: 0 }, 'x']) assert.deepEqual(barOf(bad), { ...BAR_DEFAULT });
  const mine = { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 };
  assert.deepEqual(barOf(mine), mine);
  assert.equal(barKey('C:/v.mp4'), 'video.posbar:C:/v.mp4');
  assert.equal(barKey(''), '');
});

test('position along the two ends: 0 at the deep end, 100 at the out end, clamped', () => {
  const b = { x0: 0.2, y0: 0.8, x1: 0.6, y1: 0.4 };
  assert.deepEqual(barPoint(b, 0), [0.2, 0.8]);
  assert.deepEqual(barPoint(b, 100), [0.6, 0.4]);
  const m = barPoint(b, 50);
  assert.ok(Math.abs(m[0] - 0.4) < 1e-12 && Math.abs(m[1] - 0.6) < 1e-12);
  assert.deepEqual(barPoint(b, 140), barPoint(b, 100));
});

test('hit testing: ends first (the nearer), then the body within the grab width, else nothing', () => {
  const D = [100, 300], O = [100, 100];
  assert.equal(barHit(D, O, 100, 300), 'deep');
  assert.equal(barHit(D, O, 100 + END_PX - 1, 300), 'deep');
  assert.equal(barHit(D, O, 104, 98), 'out');
  assert.equal(barHit(D, O, 108, 200), 'body');
  assert.equal(barHit(D, O, 100 + END_PX + 2, 200), null, 'beside the bar');
  assert.equal(barHit(D, O, 100, 100 - END_PX - 3), null, 'past the out end');
  assert.equal(barHit([0, 0], [0, 0], 50, 50), null);
});

test('dragging: the body moves both ends inside the frame, an end scales / turns; reset = the default', () => {
  const b = { ...BAR_DEFAULT };
  const m = barDrag(b, 'body', -0.5, 0.1);
  assert.ok(Math.abs(m.x0 - 0.43) < 1e-9 && Math.abs(m.x1 - 0.43) < 1e-9 && Math.abs(m.y0 - 0.92) < 1e-9 && Math.abs(m.y1 - 0.28) < 1e-9);
  const edge = barDrag(b, 'body', 0.5, 0.5);
  assert.equal(edge.x0, 1, 'stopped at the right edge');
  assert.equal(edge.y0, 1, 'the lower end stopped at the bottom');
  assert.ok(Math.abs((edge.y0 - edge.y1) - (b.y0 - b.y1)) < 1e-9, 'the shape kept');
  const turned = barDrag(b, 'out', -0.4, 0.3);
  assert.deepEqual([turned.x0, turned.y0], [b.x0, b.y0], 'the deep end stays');
  assert.ok(Math.abs(turned.x1 - 0.53) < 1e-9 && Math.abs(turned.y1 - 0.48) < 1e-9);
  assert.deepEqual(barDrag(b, 'deep', 0, -0.64), b, 'an end onto the other: unchanged');
  assert.equal(barDrag(b, 'deep', 0.5, 0.5).x0, 1, 'an end is clamped to the frame');
  assert.deepEqual(barOf(null), { ...BAR_DEFAULT }, 'reset (the stored placement cleared)');
});

test('the machine position: the plan where it covers t, else the script', () => {
  const out = {}, script = [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }];
  assert.equal(machinePos(out, script, null, 500).pos, 50);
  const plan = { t0: 0, dtMs: 100, pos: Float32Array.from({ length: 6 }, (_, i) => i * 10) };   // 0..500 ms
  assert.equal(machinePos(out, script, plan, 250).pos, 25);
  assert.equal(machinePos(out, script, plan, 800).pos, 80, 'outside the plan: the script');
});
