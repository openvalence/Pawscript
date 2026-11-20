// paw-jfwv: dragging the cut at 20 s left past the 15 s cut left a 1-frame shot ([15000, 15033]). The drag stops MIN_SHOT_MS
// short of the neighbouring cut; a shot already shorter than that is never shrunk further, nor made to jump.
import test from 'node:test';
import assert from 'node:assert/strict';
import { moveCut, MIN_SHOT_MS } from '../src/features/timeline/scenes.js';

const L = [{ start_ms: 0, end_ms: 15000 }, { start_ms: 15000, end_ms: 20000 }, { start_ms: 20000, end_ms: 25000 }];

test('a cut dragged past its neighbour stops a sane distance short of it', () => {
  const r = moveCut(L, 2, 14000, 33);
  assert.equal(r[1].start_ms, 15000);
  assert.equal(r[1].end_ms, 15000 + MIN_SHOT_MS);
  assert.ok(MIN_SHOT_MS >= 200);
  assert.equal(moveCut(L, 1, 26000, 33)[1].start_ms, 20000 - MIN_SHOT_MS, 'the other way too');
  assert.equal(moveCut(L, 2, 18000, 33)[2].start_ms, 18000, 'a plain move is untouched');
});

test('a shot already shorter than the floor keeps its length at most', () => {
  const s = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 1100 }, { start_ms: 1100, end_ms: 5000 }];
  assert.equal(moveCut(s, 2, 900, 33), s, 'it cannot shrink: unchanged');
  assert.equal(moveCut(s, 2, 1500, 33)[1].end_ms, 1500, 'it can grow');
});
