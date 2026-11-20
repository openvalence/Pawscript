import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toWorld, toScreen, zoomAt, fitView, boundsOf, boxSelect, boxOf, visibleWorld, overlaps, inside,
  wirePath, wireAt, handle, segmentsCross, strokeCutsWire, distToWire, gridOf, centerOn, wheelFactor, K_MIN, K_MAX,
} from '../src/features/graph/editor/geometry.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('toWorld / toScreen are inverse', () => {
  const v = { x: 37, y: -12, k: 1.7 };
  const [wx, wy] = toWorld(v, 400, 300);
  const [sx, sy] = toScreen(v, wx, wy);
  near(sx, 400); near(sy, 300);
});

test('zoomAt keeps the world point under the cursor fixed and clamps k', () => {
  const v = { x: 10, y: 20, k: 1 };
  const before = toWorld(v, 250, 140);
  const z = zoomAt(v, 250, 140, 1.5);
  const after = toWorld(z, 250, 140);
  near(before[0], after[0]); near(before[1], after[1]);
  assert.equal(z.k, 1.5);
  assert.equal(zoomAt(v, 0, 0, 100).k, K_MAX);
  assert.equal(zoomAt(v, 0, 0, 0.0001).k, K_MIN);
  assert.ok(wheelFactor(-100) > 1 && wheelFactor(100) < 1);
  assert.ok(Math.abs(wheelFactor(3, 1) - wheelFactor(48)) < 1e-12);
});

test('fitView centres content that fits and starts at top-left when it does not', () => {
  const b = { x0: 100, y0: 100, x1: 300, y1: 200 };
  const v = fitView(b, 800, 600, { pad: 40, kMax: 1 });
  assert.equal(v.k, 1);
  near(v.x + 200 * v.k / 2 + 100 * v.k, 400);   // centre of content at centre of view
  near(v.y + 150 * v.k, 300);
  const huge = { x0: 0, y0: 0, x1: 100000, y1: 100 };
  const h = fitView(huge, 800, 600, { pad: 40, kMin: 0.2 });
  assert.equal(h.k, 0.2);
  near(h.x, 40);   // does not fit: starts at the left padding
  assert.deepEqual(fitView(null, 800, 600), { x: 40, y: 40, k: 1 });
});

test('boundsOf, overlaps, inside, boxOf', () => {
  assert.equal(boundsOf([]), null);
  assert.deepEqual(boundsOf([{ x: 0, y: 0, w: 10, h: 10 }, { x: -5, y: 20, w: 5, h: 5 }]), { x0: -5, y0: 0, x1: 10, y1: 25 });
  const b = boxOf(10, 10, 0, 0);
  assert.deepEqual(b, { x0: 0, y0: 0, x1: 10, y1: 10 });
  assert.ok(overlaps({ x: 5, y: 5, w: 10, h: 10 }, b));
  assert.ok(!overlaps({ x: 10, y: 0, w: 10, h: 10 }, b));
  assert.ok(inside({ x: 1, y: 1, w: 2, h: 2 }, b));
  assert.ok(!inside({ x: 1, y: 1, w: 20, h: 2 }, b));
});

test('boxSelect replace / add / toggle', () => {
  const rects = [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }, { id: 'b', x: 50, y: 0, w: 10, h: 10 }, { id: 'c', x: 100, y: 0, w: 10, h: 10 }];
  const box = boxOf(-1, -1, 55, 5);
  assert.deepEqual([...boxSelect(rects, box)].sort(), ['a', 'b']);
  assert.deepEqual([...boxSelect(rects, box, new Set(['c']), 'add')].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...boxSelect(rects, box, new Set(['a', 'c']), 'toggle')].sort(), ['b', 'c']);
});

test('visibleWorld and centerOn', () => {
  const v = { x: -100, y: -50, k: 2 };
  assert.deepEqual(visibleWorld(v, 200, 100), { x0: 50, y0: 25, x1: 150, y1: 75 });
  const c = centerOn(v, 0, 0, 200, 100);
  const [sx, sy] = toScreen(c, 0, 0);
  near(sx, 100); near(sy, 50);
});

test('wires: endpoints, handles grow for backward links, path string', () => {
  const p1 = [0, 0], p2 = [300, 100];
  assert.deepEqual(wireAt(p1, p2, 0), p1);
  assert.deepEqual(wireAt(p1, p2, 1), p2);
  assert.equal(handle(p1, p2), 150);
  assert.ok(handle([300, 0], [0, 400]) >= 200, 'backward link gets a big handle');
  assert.match(wirePath(p1, p2), /^M0 0C150 0 150 100 300 100$/);
});

test('segmentsCross and knife strokes', () => {
  assert.ok(segmentsCross([0, 0], [10, 10], [0, 10], [10, 0]));
  assert.ok(!segmentsCross([0, 0], [10, 0], [0, 5], [10, 5]));
  assert.ok(segmentsCross([0, 0], [10, 0], [5, 0], [5, 5]), 'touching counts');
  const p1 = [0, 0], p2 = [300, 0];
  assert.ok(strokeCutsWire([[150, -50], [150, 50]], p1, p2));
  assert.ok(!strokeCutsWire([[150, 10], [150, 50]], p1, p2));
  assert.ok(!strokeCutsWire([[150, 10]], p1, p2));
  assert.ok(distToWire([150, 0], p1, p2) < 1e-6);
  near(distToWire([150, 20], p1, p2), 20, 1e-6);
});

test('gridOf coarsens tiny cells', () => {
  assert.equal(gridOf({ x: 0, y: 0, k: 1 }).cell, 20);
  assert.equal(gridOf({ x: 0, y: 0, k: 0.25 }).cell, 25);
});
