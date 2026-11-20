// The data family's pure parts: row selection, sorting, column templates, tree flattening.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRows, compareValues, nextSort, sortRows, trackOf, minWidthOf, flattenTree } from '../src/ui/kit/data.js';

const K = ['a', 'b', 'c', 'd', 'e'];
const keys = (s) => [...s].sort();

test('selectRows: click, Ctrl toggle, Shift range, Ctrl+Shift adds a range', () => {
  let r = selectRows(new Set(['a', 'b']), K, 2, 0);
  assert.deepEqual([keys(r.selected), r.anchor], [['c'], 2]);
  r = selectRows(r.selected, K, 4, r.anchor, { toggle: true });
  assert.deepEqual([keys(r.selected), r.anchor], [['c', 'e'], 4]);
  r = selectRows(r.selected, K, 4, r.anchor, { toggle: true });
  assert.deepEqual(keys(r.selected), ['c']);
  r = selectRows(new Set(['a']), K, 1, 3, { range: true });
  assert.deepEqual([keys(r.selected), r.anchor], [['b', 'c', 'd'], 3], 'range replaces, anchor stays');
  r = selectRows(new Set(['a']), K, 4, 3, { range: true, toggle: true });
  assert.deepEqual(keys(r.selected), ['a', 'd', 'e']);
  r = selectRows(new Set(['a']), K, 3, 0, { range: true, toggle: true, multiple: false });
  assert.deepEqual(keys(r.selected), ['d'], 'single selection ignores modifiers');
  r = selectRows(new Set(), K, 2, -1, { range: true });
  assert.deepEqual(keys(r.selected), ['c'], 'no anchor: a plain click');
});

test('compareValues: numbers, natural text, empties last', () => {
  assert.ok(compareValues(2, 10) < 0);
  assert.ok(compareValues('run 2', 'run 10') < 0);
  assert.equal(compareValues('Axis', 'axis'), 0);
  assert.ok(compareValues(null, 1) > 0 && compareValues(1, '') < 0);
});

test('nextSort cycles asc, desc, off; a new column starts asc', () => {
  assert.deepEqual(nextSort(null, 'a'), { key: 'a', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'a', dir: 'asc' }, 'a'), { key: 'a', dir: 'desc' });
  assert.equal(nextSort({ key: 'a', dir: 'desc' }, 'a'), null);
  assert.deepEqual(nextSort({ key: 'a', dir: 'desc' }, 'b'), { key: 'b', dir: 'asc' });
});

test('sortRows: stable, desc, custom compare, empties last both ways, unsorted is identity', () => {
  const rows = [{ id: 1, n: 3, s: 'b' }, { id: 2, n: 1, s: 'a' }, { id: 3, n: 3, s: null }, { id: 4, n: 2, s: 'c' }];
  assert.equal(sortRows(rows, null), rows);
  assert.deepEqual(sortRows(rows, { key: 'n', dir: 'asc' }).map((r) => r.id), [2, 4, 1, 3]);
  assert.deepEqual(sortRows(rows, { key: 'n', dir: 'desc' }).map((r) => r.id), [1, 3, 4, 2]);
  assert.deepEqual(sortRows(rows, { key: 's', dir: 'desc' }).map((r) => r.id), [4, 1, 2, 3]);
  const rank = { error: 0, warn: 1, info: 2 };
  const sev = [{ v: 'info' }, { v: 'error' }, { v: 'warn' }];
  const cols = [{ key: 'v', compare: (a, b) => rank[a.v] - rank[b.v] }];
  assert.deepEqual(sortRows(sev, { key: 'v', dir: 'asc' }, cols).map((r) => r.v), ['error', 'warn', 'info']);
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 4], 'input untouched');
});

test('trackOf / minWidthOf', () => {
  assert.equal(trackOf(120), '120px');
  assert.equal(trackOf('2fr'), '2fr');
  assert.equal(trackOf(), 'minmax(0, 1fr)');
  assert.equal(minWidthOf([{ width: 120 }, { width: 'minmax(200px, 1fr)' }, { width: '1fr' }, {}, { width: '64px' }]), 384);
});

test('flattenTree: levels, sets, parents, only open branches', () => {
  const nodes = [
    { id: 'p', label: 'Project', children: [
      { id: 'x', label: 'Stroke', children: [{ id: 'c1', label: 'Intro' }, { id: 'c2', label: 'Outro' }] },
      { id: 'y', label: 'Roll', children: [{ id: 'c3', label: 'Mid' }] },
    ] },
    { id: 'q', label: 'Other' },
  ];
  const f = flattenTree(nodes, new Set(['p', 'x']));
  assert.deepEqual(f.map((r) => r.node.id), ['p', 'x', 'c1', 'c2', 'y', 'q']);
  assert.deepEqual(f.map((r) => r.level), [1, 2, 3, 3, 2, 1]);
  assert.deepEqual(f.map((r) => r.parent), [-1, 0, 1, 1, 0, -1]);
  assert.deepEqual(f.map((r) => `${r.posinset}/${r.setsize}`), ['1/2', '1/2', '1/2', '2/2', '2/2', '2/2']);
  assert.deepEqual(f.map((r) => r.expandable), [true, true, false, false, true, false]);
  assert.equal(f[4].open, false);
  assert.deepEqual(flattenTree(nodes, new Set(['x'])).map((r) => r.node.id), ['p', 'q'], 'closed parent hides open child');
});
