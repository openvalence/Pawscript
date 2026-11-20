// paw-ls54: the Groups dock's pure parts: which part chips a group gets, and the unassigned groups folded into one line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipParts, dockRows, COMMON_PARTS } from '../src/features/tracking/groups.js';

test('chipParts: the group\'s own part and its proposal first, then the common parts, each once, paired as L and R, capped', () => {
  assert.deepEqual(chipParts([], 99).map((c) => c.part), COMMON_PARTS, 'nothing known: the common parts');
  const c = chipParts(['tail', 'penis', 'tail'], 4);
  assert.deepEqual(c, [{ part: 'tail', side: null }, { part: 'penis', side: null }, { part: 'balls', side: null }, { part: 'sheath', side: null }], 'own first, no repeats, capped (paw-njnf: no knot chip)');
  assert.deepEqual(chipParts(['hand'], 3), [{ part: 'hand', side: 'l' }, { part: 'hand', side: 'r' }, { part: 'penis', side: null }], 'a paired part: both sides');
  assert.equal(chipParts(['unassigned', 'nope'], 99).length, COMMON_PARTS.length, 'unknown parts are left out');
});

test('dockRows: assigned groups as rows, the unassigned ones one fold line, their rows only when open', () => {
  const list = [{ name: 'c1_penis' }, { name: 'unassigned_1' }, { name: 'c2_hips' }, { name: 'unassigned_2' }];
  assert.deepEqual(dockRows(list), [{ k: 0 }, { k: 2 }, { fold: 2 }], 'closed: one line for 2');
  assert.deepEqual(dockRows(list, true), [{ k: 0 }, { k: 2 }, { fold: 2 }, { k: 1 }, { k: 3 }], 'open: the line, then their rows');
  assert.deepEqual(dockRows([{ name: 'c1_penis' }], true), [{ k: 0 }], 'none unassigned: no line');
  assert.deepEqual(dockRows([]), []);
});
