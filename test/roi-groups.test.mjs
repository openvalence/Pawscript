// Blobs view helpers (features/video/roi.js): convex hull, point-in-hull (the centres are blobs.js anchoredPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hull, inHull } from '../src/features/video/roi.js';

test('hull / inHull', () => {
  const h = hull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0.2, 0.8]]);
  assert.equal(h.length, 4);
  assert.ok(inHull(h, 0.5, 0.5) && !inHull(h, 1.5, 0.5) && !inHull(hull([[0, 0], [1, 1]]), 0.5, 0.5));
});
