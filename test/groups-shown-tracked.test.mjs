// paw-0apg: with the Groups tool off, a tracked shot shows its painted groups only on the frame they were painted on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupsShownAt } from '../src/features/tracking/groups.js';

const a = { name: 'c1_penis', t_ms: 1000 }, b = { name: 'c2_hips', t_ms: 1000 }, c = { name: 'c1_balls', t_ms: 3000 }, list = [a, b, c];
const run = { id: 'run1', range: { start: 0, end: 5000 } };

test('untracked: every group of the take, every frame', () => {
  assert.deepEqual(groupsShownAt(list, [], 2000, 33.33), list);
  assert.deepEqual(groupsShownAt(list, [{ ...run, range: { start: 6000, end: 9000 } }], 2000, 33.33), list);   // a run elsewhere
  for (const r of [{ ...run, tag: 'camera' }, { ...run, mod: 'fx1' }, { ...run, derived: { from: 'run0' } }]) assert.deepEqual(groupsShownAt(list, [r], 2000, 33.33), list);
});

test('tracked: only the groups painted on the frame on screen', () => {
  assert.deepEqual(groupsShownAt(list, [run], 2000, 33.33), []);
  assert.deepEqual(groupsShownAt(list, [run], 1000, 33.33), [a, b]);
  assert.deepEqual(groupsShownAt(list, [run], 1020, 33.33), [a, b]);   // within 3/4 frame
  assert.deepEqual(groupsShownAt(list, [run], 1033, 33.33), []);       // the next frame
  assert.deepEqual(groupsShownAt(list, [run], 3000, 33.33), [c]);      // each seed frame shows its own
  const old = { name: 'c1_body' };   // no frame: the take's first seed frame
  assert.deepEqual(groupsShownAt([old, c], [run], 3000, 33.33), [old, c]);
});
