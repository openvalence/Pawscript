// paw-cp8k: a drag held near / past a row's edge pans the view (lib/edge-scroll.js): the speed ramp and the clamp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeSpeed, edgePan, EDGE_PX, EDGE_MAX_VIEWS } from '../src/lib/edge-scroll.js';

test('edgeSpeed: nothing in the middle, grows into the band, full speed one band past the edge', () => {
  const w = 1000, full = EDGE_MAX_VIEWS * w;
  assert.equal(edgeSpeed(500, w), 0);
  assert.equal(edgeSpeed(EDGE_PX, w), 0);
  assert.equal(edgeSpeed(w - EDGE_PX, w), 0);
  assert.ok(edgeSpeed(w - EDGE_PX + 1, w) > 0 && edgeSpeed(EDGE_PX - 1, w) < 0, 'the sign is the direction');
  assert.equal(edgeSpeed(w, w), full / 2, 'at the edge: half');
  assert.equal(edgeSpeed(0, w), -full / 2);
  assert.equal(edgeSpeed(w + EDGE_PX, w), full, 'one band past: full');
  assert.equal(edgeSpeed(w + 5000, w), full, 'capped');
  assert.equal(edgeSpeed(-5000, w), -full);
  assert.ok(edgeSpeed(w - 10, w) > edgeSpeed(w - 30, w), 'further in is faster');
  assert.equal(edgeSpeed(20, 100), edgeSpeed(20, 100, 25), 'a narrow row: a quarter each side');
  assert.equal(edgeSpeed(10, 0), 0);
  assert.equal(edgeSpeed(NaN, 1000), 0);
});

test('edgePan: screen px to ms, clamped to [0, dur], never pulled back, nothing when all is in view', () => {
  const v = { start: 8000, span: 10000 };
  assert.deepEqual(edgePan(v, 100, 1000, 60000), { start: 9000, span: 10000 });
  assert.deepEqual(edgePan(v, -100, 1000, 60000), { start: 7000, span: 10000 });
  assert.deepEqual(edgePan(v, -5000, 1000, 60000), { start: 0, span: 10000 }, 'down to 0, not negative');
  assert.deepEqual(edgePan(v, 50000, 1000, 60000), { start: 50000, span: 10000 }, 'up to dur - span');
  const at0 = { start: 0, span: 10000 };
  assert.equal(edgePan(at0, -10, 1000, 60000), at0, 'at 0: unchanged (the same object: the loop idles)');
  const past = { start: -2000, span: 10000 };
  assert.equal(edgePan(past, -10, 1000, 60000), past, 'already past 0 (a manual pan): not pushed further');
  assert.deepEqual(edgePan(past, 10, 1000, 60000), { start: -1900, span: 10000 }, 'but back toward the video it moves');
  const all = { start: 0, span: 60000 };
  assert.equal(edgePan(all, 100, 1000, 60000), all, 'the whole video in view: no scroll');
  assert.equal(edgePan(v, 0, 1000, 60000), v);
});
