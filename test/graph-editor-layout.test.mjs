import { test } from 'node:test';
import assert from 'node:assert/strict';
import { align, distribute, autoLayout, freeSpot } from '../src/features/graph/editor/layout.js';

const R = (id, x, y, w = 100, h = 60) => ({ id, x, y, w, h });
const apply = (rects, moves) => rects.map((r) => ({ ...r, ...(moves.find((m) => m.id === r.id) || {}) }));

test('align left/right/top/bottom/centres, only moved nodes returned', () => {
  const rs = [R('a', 0, 0), R('b', 40, 100, 200), R('c', 20, 200)];
  assert.deepEqual(align(rs, 'left').map((m) => m.id).sort(), ['b', 'c']);
  assert.ok(apply(rs, align(rs, 'left')).every((r) => r.x === 0));
  const right = apply(rs, align(rs, 'right'));
  assert.ok(right.every((r) => r.x + r.w === 240));
  assert.ok(apply(rs, align(rs, 'top')).every((r) => r.y === 0));
  assert.ok(apply(rs, align(rs, 'bottom')).every((r) => r.y + r.h === 260));
  const hc = apply(rs, align(rs, 'hcenter'));
  assert.ok(hc.every((r) => r.x + r.w / 2 === 120));
  assert.deepEqual(align([R('a', 0, 0)], 'left'), []);
  assert.throws(() => align(rs, 'diagonal'));
});

test('distribute makes equal gaps and keeps the ends', () => {
  const rs = [R('a', 0, 0), R('b', 130, 0), R('c', 400, 0)];
  const d = apply(rs, distribute(rs, 'x'));
  assert.equal(d.find((r) => r.id === 'a').x, 0);
  assert.equal(d.find((r) => r.id === 'c').x, 400);
  assert.equal(d.find((r) => r.id === 'b').x, 200);
  assert.deepEqual(distribute(rs.slice(0, 2), 'x'), []);
});

test('autoLayout layers a chain left to right and keeps the top-left', () => {
  const rs = [R('c', 0, 0), R('a', 400, 300), R('b', 200, 600)];
  const links = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
  const out = apply(rs, autoLayout(rs, links, { gapX: 80 }));
  const x = (id) => out.find((r) => r.id === id).x;
  assert.ok(x('a') < x('b') && x('b') < x('c'));
  assert.equal(Math.min(...out.map((r) => r.x)), 0);
  assert.equal(Math.min(...out.map((r) => r.y)), 0);
  assert.equal(x('b') - x('a'), 180);
});

test('autoLayout orders a layer by its predecessors and survives cycles', () => {
  const rs = [R('s1', 0, 0), R('s2', 0, 100), R('t2', 300, 0), R('t1', 300, 100)];
  const links = [{ from: 's1', to: 't1' }, { from: 's2', to: 't2' }];
  const out = apply(rs, autoLayout(rs, links));
  const y = (id) => out.find((r) => r.id === id).y;
  assert.ok(y('t1') < y('t2'), 't1 follows s1 on the top row');
  const cyc = autoLayout([R('a', 0, 0), R('b', 0, 100)], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]);
  assert.ok(Array.isArray(cyc));
});

test('freeSpot steps below overlapping rects', () => {
  const rs = [R('a', 0, 0, 100, 60), R('b', 0, 80, 100, 60)];
  const p = freeSpot(rs, 10, 10, 100, 40);
  assert.equal(p.x, 10);
  assert.ok(p.y >= 150);
  assert.deepEqual(freeSpot(rs, 400, 0, 50, 50), { x: 400, y: 0 });
});
