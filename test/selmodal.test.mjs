// paw-qbvj: Blender's selection keys on the timeline (src/lib/selmodal.js): A toggles all / none (2.7x), the circle select's hit
// functions, the brush radius steps; the interval rows' box hit and id combine (src/features/timeline/intervals.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleAll, toggleCmd, inCircle, circleBox, clampRadius, stepRadius, RADIUS_MIN, RADIUS_MAX } from '../src/lib/selmodal.js';
import { spansIn, combineIds } from '../src/features/timeline/intervals.js';

test('A: anything selected -> none; nothing selected -> all, or the reason there is nothing to select', () => {
  assert.equal(toggleAll(true), 'none');
  assert.equal(toggleAll(true, 'No points'), 'none', 'a selection always clears, whatever the reason says');
  assert.equal(toggleAll(false), 'all');
  assert.equal(toggleAll(false, ''), 'all');
  assert.equal(toggleAll(false, 'No points on this lane to select'), 'No points on this lane to select');
});

test('toggleCmd: the editor\'s own select all / none commands do the work; A is its key; the reason is a quiet toast', () => {
  const ran = [], said = [];
  let sel = [], items = [1, 2, 3];
  const all = { run: () => { ran.push('all'); sel = [...items]; } }, none = { run: () => { ran.push('none'); sel = []; } };
  const c = toggleCmd({ id: 'x.selectToggle', title: 't', when: () => true, any: () => sel.length > 0, all, none, empty: () => (items.length ? '' : 'Nothing here') });
  assert.deepEqual([c.id, c.keys], ['x.selectToggle', ['A']]);
  const app = { toast: (m, k) => said.push([m, k]) };
  c.run(app); assert.deepEqual(sel, [1, 2, 3]);
  c.run(app); assert.deepEqual(sel, []);
  sel = [2]; c.run(app); assert.deepEqual(sel, [], 'a partial selection clears too (2.7x)');
  items = []; c.run(app);
  assert.deepEqual(ran, ['all', 'none', 'none']);
  assert.deepEqual(said, [['Nothing here', 'quiet']]);
});

test('circle hit: the points inside (the edge counts), not the corners of its box', () => {
  const pts = [{ id: 'c', x: 50, y: 50 }, { id: 'edge', x: 60, y: 50 }, { id: 'corner', x: 58, y: 58 }, { id: 'out', x: 61, y: 50 }, { id: 'diag', x: 57, y: 57 }];
  assert.deepEqual(inCircle(pts, 50, 50, 10).map((p) => p.id), ['c', 'edge', 'diag']);
  assert.deepEqual(inCircle(pts, 50, 50, 0).map((p) => p.id), ['c']);
  assert.deepEqual(circleBox(50, 40, 10), [40, 30, 60, 50]);
});

test('circle on an interval row selects what it touches: the box hit of its bounding box', () => {
  const list = [{ id: 'a', t0: 0, t1: 100 }, { id: 'b', t0: 200, t1: 300 }, { id: 'c', t0: 400, t1: 500 }];
  const [x0, , x1] = circleBox(250, 10, 60);   // 1 px = 1 ms here
  assert.deepEqual(spansIn(list, x0, x1).map((x) => x.id), ['b']);
  assert.deepEqual(spansIn(list, 100, 200).map((x) => x.id), ['a', 'b'], 'touching an edge counts');
  assert.deepEqual(spansIn(list, 450, 90).map((x) => x.id), ['a', 'b', 'c'], 'any corner order');
  assert.deepEqual(combineIds(['a'], ['b'], 'add'), ['a', 'b']);
  assert.deepEqual(combineIds(['a', 'b'], ['b', 'c'], 'add'), ['a', 'b', 'c'], 'no duplicates');
  assert.deepEqual(combineIds(['a', 'b'], ['b'], 'sub'), ['a']);
  assert.deepEqual(combineIds(['a'], ['c'], 'replace'), ['c']);
});

test('the brush radius: the wheel / [ ] step it at least a pixel, clamped', () => {
  assert.equal(clampRadius(1), RADIUS_MIN);
  assert.equal(clampRadius(1e6), RADIUS_MAX);
  assert.equal(clampRadius('x'), 24, 'a broken setting falls back');
  assert.ok(stepRadius(24, 1) > 24 && stepRadius(24, -1) < 24);
  assert.equal(stepRadius(4, 1), 5, 'a small brush still grows');
  assert.equal(stepRadius(RADIUS_MIN, -1), RADIUS_MIN);
  assert.equal(stepRadius(RADIUS_MAX, 1), RADIUS_MAX);
  let r = 24;
  for (let k = 0; k < 5; k++) r = stepRadius(r, 1);
  for (let k = 0; k < 5; k++) r = stepRadius(r, -1);
  assert.ok(Math.abs(r - 24) <= 3, `up five, down five: back near where it was (${r})`);
});
