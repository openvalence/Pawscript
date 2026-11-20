// Parts-first (paw-ym1): the tracker panel preset's point budget and VRAM estimate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARTS_FIRST, pointTotal, vramGb, groupShare } from '../src/features/tracking/parts-first.js';

test('point budget: grid + groups x group_points; VRAM = the sidecar caps', () => {
  assert.equal(pointTotal(PARTS_FIRST, 6), 64 + 6 * 16);
  assert.equal(pointTotal({ box_points: 1024, group_points: 0 }, 3), 1024);
  // paw-s9ns: the sidecar's need_gb (measured peak + 15 % + 0.5): the owner's 512 / 1024 points asked 12.7 GB for 7.07 GiB
  assert.ok(Math.abs(vramGb('tapnext_points', { model: '512', chunk: 8 }, 1024) - 8.71) < 0.01);
  assert.ok(Math.abs(vramGb('tapnext_points', { model: '512', chunk: 8 }, 160) - 7.57) < 0.01);
  assert.ok(Math.abs(vramGb('tapnext_points', { model: '256', chunk: 8 }, 1024) - 4.45) < 0.01);
  assert.equal(vramGb('tapnext_points', { model: 'auto', chunk: 8 }, 1024), vramGb('tapnext_points', { model: '256', chunk: 8 }, 1024));   // v4.55 auto: the 256 figure
  assert.ok(vramGb('tapnext_points', { model: '512', chunk: 8 }, 1024) > 7.068 + 0.5);   // never under the measured peak
  assert.ok(vramGb('tapnext_points', { model: '256', chunk: 16 }, 2048) > 7.773 + 0.5);  // the old 256 cap was under it (7.16)
  assert.equal(vramGb('cotracker_points', { mode: 'online' }, 160), 2.2);
  assert.equal(vramGb('fake', {}, 10), null);
});

test('group_points 0 (paw-9qim, sidecar v4.46 group_counts): at least 16 a group, 10 % of n each, at most 3/4 of n', () => {
  assert.deepEqual(groupShare(512, 17), { base: 16, avg: 23, total: 384 });   // the owner's 17 parts in 512 points: was 15 each
  assert.deepEqual(groupShare(1024, 3), { base: 16, avg: 102, total: 306 });  // few groups: the old 10 % each on average
  assert.deepEqual(groupShare(64, 5), { base: 9, avg: 10, total: 48 });       // too small a box for 16 each: an even share of 3/4
  assert.equal(groupShare(512, 0), null);
});
