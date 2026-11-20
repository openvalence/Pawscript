// paw-8ehz: the Groups tool's chrome keeps off the picture (groups-room.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupsRoom } from '../src/features/tracking/groups-room.js';

const A = 16 / 9;
test('a wide stage: the picture keeps its place, its margins hold the bar and the right column', () => {
  const r = groupsRoom(1230, 169, A, 107);   // 1280 x 720 with the side docks folded: a 300 px picture, 465 px each side
  assert.equal(r.inset, null); assert.equal(r.fold, false); assert.equal(r.right, 320);
});
test('margins too narrow: the picture is fitted between the columns, no smaller than it must be', () => {
  const r = groupsRoom(875, 352, A, 74);   // 1707 x 913: a 626 px picture with 125 px margins, less than the right column
  assert.deepEqual(r.inset, { l: 74, r: 180, t: 0, b: 0 }); assert.equal(r.fold, false);
  const pic = Math.min(875 - 74 - 180, 352 * A);
  assert.ok(pic >= 620, 'the picture loses at most a percent, it mostly moves');
});
test('a stage too narrow even so: fold the side docks (and keep off the picture meanwhile)', () => {
  for (const [W, H] of [[448, 169], [180, 169]]) {   // 1280 x 720 and 900 x 600 with the docks open
    const r = groupsRoom(W, H, A, 107);
    assert.equal(r.fold, true); assert.deepEqual(r.inset, { l: 107, r: 180, t: 0, b: 0 });
  }
});
test('a portrait picture in a wide stage: wide margins, nothing moves', () => {
  const r = groupsRoom(800, 400, 9 / 16, 40);
  assert.equal(r.inset, null); assert.equal(r.right, 287);
});
