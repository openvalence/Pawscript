// The menus family's pure parts: option flattening, ComboBox filtering and match emphasis, alignment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatOptions, filterOptions, splitMatch, treeHas, isRow, autoAlign } from '../src/ui/kit/menus.js';

const opts = [{ value: 1, label: 'Smooth' }, { value: 2, label: 'Simplify' }, { value: 3, label: 'Remove smooth' }];

test('flatOptions: groups flatten, plain options pass', () => {
  assert.deepEqual(flatOptions([{ label: 'A', options: [opts[0]] }, opts[1]]).map((o) => o.value), [1, 2]);
});

test('filterOptions: prefix matches first, then contains, case-insensitive; empty keeps all', () => {
  assert.deepEqual(filterOptions(opts, 'SMOO').map((o) => o.value), [1, 3]);
  assert.deepEqual(filterOptions(opts, 'oth').map((o) => o.value), [1, 3]);
  assert.equal(filterOptions(opts, '  ').length, 3);
  assert.deepEqual(filterOptions(opts, 'x', () => true).map((o) => o.value), [1, 2, 3]);
});

test('splitMatch: emphasises the first occurrence', () => {
  assert.deepEqual(splitMatch('Remove smooth', 'SMO'), ['Remove ', 'smo', 'oth']);
  assert.deepEqual(splitMatch('Smooth', 'zz'), ['Smooth', '', '']);
  assert.deepEqual(splitMatch('Smooth', ''), ['Smooth', '', '']);
});

test('treeHas / isRow', () => {
  assert.equal(treeHas([{ label: 'a', items: [{ label: 'b', icon: 'cut' }] }], 'icon'), true);
  assert.equal(treeHas([{ label: 'a' }, { separator: true }], 'icon'), false);
  assert.equal(isRow({ separator: true }), false);
  assert.equal(isRow({ section: 'View' }), false);
  assert.equal(isRow({ label: 'Cut' }), true);
});

test('autoAlign: flips start/end at the viewport edge only when the other side fits', () => {
  assert.equal(autoAlign('bottom-start', { x: 900, width: 0 }, 200, 1000), 'bottom-end');
  assert.equal(autoAlign('bottom-start', { x: 100, width: 0 }, 200, 1000), 'bottom-start');
  assert.equal(autoAlign('bottom-end', { x: 50, width: 40 }, 200, 1000), 'bottom-start');
  assert.equal(autoAlign('bottom-start', { x: 100, width: 0 }, 2000, 1000), 'bottom-start', 'neither fits: keep');
  assert.equal(autoAlign('right-start', { x: 900, width: 0 }, 200, 1000), 'right-start');
});
