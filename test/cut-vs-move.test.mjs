// paw-p2p0 (owner: "camera moves and cuts are not so easy to distinguish"): the helpers every row draws the two apart from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundaryTimes, blockShade, boundaryWord } from '../src/features/timeline/shots.js';

const S = (a, b, o = {}) => ({ start_ms: a, end_ms: b, ...o });
// shots 1 | cut | 2 | zoom | 3 | cut | 4 | move (no tag) | 5 ; scene start before 6
const L = [S(0, 10), S(10, 20, { join: true }), S(20, 30, { join: true, split: 'camera', tags: ['zoom'] }), S(30, 40, { join: true }),
  S(40, 50, { join: true, split: 'camera' }), S(50, 60)];

test('boundaryTimes splits hard cuts (and scene starts) from camera moves', () => {
  assert.deepEqual(boundaryTimes(L), { cuts: [10, 30, 50], moves: [20, 40] });
  assert.deepEqual(boundaryTimes([]), { cuts: [], moves: [] });
  assert.deepEqual(boundaryTimes([S(0, 5, { split: 'camera' })]), { cuts: [], moves: [] }, 'shot 0 has no boundary');
  assert.deepEqual(boundaryTimes([S(0, 5), S(5, 9, { split: 'camera' })]).cuts, [5], 'a camera split without join is a scene start: a cut');
});

test('blockShade alternates at cuts, never across a camera move (one take = one block)', () => {
  assert.deepEqual(blockShade(L), [0, 1, 1, 0, 0, 1]);
  assert.deepEqual(blockShade([S(0, 1), S(1, 2, { join: true }), S(2, 3, { join: true })]), [0, 1, 0], 'plain cuts alternate as before (i % 2)');
});

test('boundaryWord: "camera move (zoom), not a cut" vs "cut"', () => {
  assert.deepEqual(L.map((_, i) => boundaryWord(L, i)), ['', 'cut', 'camera move (zoom), not a cut', 'cut', 'camera move, not a cut', 'cut']);
});
