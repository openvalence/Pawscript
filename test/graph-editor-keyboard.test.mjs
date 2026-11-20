import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingOrder, neighbour, followWire, siblings, connectTargets } from '../src/features/graph/editor/keyboard.js';
import { classifyDown, clickSelect, pressSelect, escapeTarget, arrowDelta, passed } from '../src/features/graph/editor/gestures.js';

const R = (id, x, y, w = 100, h = 60) => ({ id, x, y, w, h });

test('readingOrder: rows top to bottom, left to right within a row', () => {
  const rs = [R('c', 300, 5), R('a', 0, 0), R('d', 0, 200), R('b', 150, 30)];
  assert.deepEqual(readingOrder(rs), ['a', 'b', 'c', 'd']);
});

test('neighbour picks the nearest in a direction, preferring alignment', () => {
  const rs = [R('m', 200, 200), R('r', 400, 210), R('rf', 380, 500), R('u', 210, 0), R('l', 0, 200)];
  assert.equal(neighbour(rs, 'm', 'right'), 'r');
  assert.equal(neighbour(rs, 'm', 'up'), 'u');
  assert.equal(neighbour(rs, 'm', 'left'), 'l');
  assert.equal(neighbour(rs, 'm', 'down'), 'rf');
  assert.equal(neighbour(rs, 'l', 'left'), null);
});

test('followWire down/up and cycling; siblings', () => {
  const g = { nodes: [], links: [
    { id: 'l1', from: 'a', out: 'script', to: 'b', in: 'script' },
    { id: 'l2', from: 'a', out: 'script', to: 'c', in: 'script' },
    { id: 'l3', from: 'x', out: 'spans', to: 'b', in: 'where' },
  ] };
  const pos = { a: [0, 0], b: [200, 100], c: [200, 0], x: [0, 200] };
  const posOf = (id) => pos[id];
  assert.deepEqual(followWire(g, 'a', 'down', { posOf }), { node: 'c', link: 'l2' });
  assert.deepEqual(followWire(g, 'a', 'down', { posOf, index: 1 }), { node: 'b', link: 'l1' });
  assert.deepEqual(followWire(g, 'b', 'up', { portOrder: () => ['script', 'where'] }), { node: 'a', link: 'l1' });
  assert.deepEqual(followWire(g, 'b', 'up', { portOrder: () => ['where', 'script'] }), { node: 'x', link: 'l3' });
  assert.equal(followWire(g, 'c', 'down', { posOf }), null);
  assert.deepEqual(siblings(g, 'b', posOf), ['c', 'b']);
});

test('connectTargets keeps valid targets, direct before adapter, then nearest', () => {
  const g = { nodes: [{ id: 'src' }, { id: 'near' }, { id: 'far' }, { id: 'sig' }], links: [] };
  const ports = {
    src: { ins: [], outs: [{ name: 'script', type: 'script' }], params: [] },
    near: { ins: [{ name: 'script', type: 'script' }], outs: [], params: [] },
    far: { ins: [{ name: 'script', type: 'script' }], outs: [], params: [{ name: 'p:lo', type: 'signal' }] },
    sig: { ins: [{ name: 'signal', type: 'signal' }, { name: 'n', type: 'number' }], outs: [], params: [] },
  };
  const pos = { src: [0, 0], near: [100, 0], far: [900, 0], sig: [50, 0] };
  const plan = (l) => {
    const t = [...ports[l.to].ins, ...ports[l.to].params].find((p) => p.name === l.in).type;
    if (t === 'script') return { ok: true };
    if (t === 'signal') return { ok: true, adapter: 'sample' };
    return { ok: false, reason: 'no' };
  };
  const r = connectTargets({ graph: g, from: { node: 'src', port: 'script', side: 'out' }, portsOf: (id) => ports[id], plan, posOf: (id) => pos[id] });
  assert.deepEqual(r.map((x) => `${x.node}:${x.port}`), ['near:script', 'far:script', 'sig:signal', 'far:p:lo']);
  assert.equal(r[2].adapter, 'sample');
});

test('classifyDown maps pointer facts to gestures', () => {
  assert.equal(classifyDown({ on: 'canvas' }), 'pan');
  assert.equal(classifyDown({ on: 'canvas', boxMode: true }), 'box');
  assert.equal(classifyDown({ on: 'canvas', shift: true }), 'box-add');
  assert.equal(classifyDown({ on: 'canvas', shift: true, ctrl: true }), 'box-toggle');
  assert.equal(classifyDown({ on: 'canvas', ctrl: true }), 'knife');
  assert.equal(classifyDown({ on: 'node' }), 'move');
  assert.equal(classifyDown({ on: 'node', button: 1 }), 'pan');
  assert.equal(classifyDown({ on: 'node', space: true }), 'pan');
  assert.equal(classifyDown({ on: 'socket', side: 'out' }), 'wire');
  assert.equal(classifyDown({ on: 'socket', side: 'in', linked: true }), 'reroute');
  assert.equal(classifyDown({ on: 'socket', side: 'in', linked: false }), 'wire');
  assert.equal(classifyDown({ on: 'wire' }), 'wire-select');
  assert.equal(classifyDown({ on: 'frameEdge' }), 'resize');
  assert.equal(classifyDown({ on: 'control' }), null);
  assert.equal(classifyDown({ on: 'overlay', button: 1 }), null);
  assert.equal(classifyDown({ on: 'canvas', button: 2 }), null);
  assert.ok(!passed(2, 2) && passed(3, 2));
});

test('selection reducers', () => {
  const s = new Set(['a', 'b']);
  assert.equal(pressSelect(s, 'a'), s, 'pressing a selected node keeps the group for dragging');
  assert.deepEqual([...pressSelect(s, 'c')], ['c']);
  assert.deepEqual([...pressSelect(s, 'c', { shift: true })], ['a', 'b', 'c']);
  assert.deepEqual([...clickSelect(s, 'a')], ['a']);
  assert.equal(clickSelect(s, 'a', { dragged: true }), s);
  assert.deepEqual([...clickSelect(s, 'a', { ctrl: true })], ['b']);
});

test('escape ladder order', () => {
  assert.equal(escapeTarget({ gesture: 1, palette: 1, selection: 3 }), 'gesture');
  assert.equal(escapeTarget({ palette: 1, field: 1 }), 'palette');
  assert.equal(escapeTarget({ field: 1, maximised: true, selection: 2 }), 'field');
  assert.equal(escapeTarget({ maximised: true, selection: 2 }), 'maximise');
  assert.equal(escapeTarget({ selection: 2 }), 'selection');
  assert.equal(escapeTarget({ wire: 'l1' }), 'selection');
  assert.equal(escapeTarget({}), null);
  assert.deepEqual(arrowDelta('ArrowLeft'), [-20, 0]);
  assert.deepEqual(arrowDelta('ArrowDown', true), [0, 100]);
  assert.equal(arrowDelta('KeyA'), null);
});
