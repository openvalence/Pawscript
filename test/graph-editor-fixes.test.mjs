// Regressions on the real catalogue: search ranking, Shift+A append filtering, source auto-binding, inspector
// value types, repeated paste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogue } from '../src/lib/graph/nodes/index.js';
import { compat } from '../src/lib/graph/types.js';
import { rank } from '../src/features/graph/editor/fuzzy.js';
import { paletteItems, compatibleItems, autoBindParams, shownType } from '../src/features/graph/editor/cards.js';
import { pasteSpot, plural } from '../src/features/graph/editor/clipboard.js';
import { resolveSlot } from '../src/features/graph/integration/core.js';

const reg = createCatalogue();
const items = paletteItems(reg.list());

test('typing a node\'s exact title places that node first', () => {
  assert.equal(rank('tracker run', items)[0].type, 'src.run');
  assert.equal(rank('Tracker run', items)[0].type, 'src.run');
  for (const it of items.filter((x) => !x.variant).slice(0, 400)) {
    if (it.title.trim().split(/\s+/).length < 2) continue;
    const top = rank(it.title, items)[0];
    assert.equal(top.title.toLowerCase(), it.title.toLowerCase(), `"${it.title}" ranked "${top.title}" first`);
  }
});

test('Shift+A after a signal output offers only nodes that take a signal (edit.smooth is not one)', () => {
  const list = compatibleItems(items, { side: 'out', type: 'signal', port: 'signal' }, compat);
  const types = new Set(list.map((c) => c.item.type));
  assert.ok(types.has('sig.smooth'));
  assert.ok(!types.has('edit.smooth'), 'edit.smooth takes a script; a signal cannot feed it');
  for (const c of list) assert.ok(c.port, `${c.item.key} has a port to wire`);
  const top = rank('smooth', list.map((c) => c.item))[0];
  assert.equal(top.type, 'sig.smooth');
});

test('a Ghost or Tracker run placed from the palette starts bound (not "pick a …")', () => {
  const ghosts = [{ id: 'ref', name: 'Reference', pinned: true, script: [] }, { id: 'trk', name: 'Tracker', source: { kind: 'tracker' }, script: [] }];
  const sources = {
    list: (k) => (k === 'ghost' ? ghosts.map((x) => ({ id: x.id, name: x.name })) : k === 'run' ? [{ id: 'run1', name: 'Run 1' }] : []),
    get: (k, id) => (k === 'ghost' ? ghosts.find((x) => x.id === id) : undefined),
  };
  assert.deepEqual(autoBindParams(reg.get('src.ghost'), sources, resolveSlot), { ghost: 'trk' });
  assert.deepEqual(autoBindParams(reg.get('src.run'), sources, resolveSlot), { run: 'run1' });
  assert.deepEqual(autoBindParams(reg.get('amp.remap'), sources, resolveSlot), {});
  const empty = { list: () => [], get: () => undefined };
  assert.deepEqual(autoBindParams(reg.get('src.run'), empty, resolveSlot), {}, 'nothing to bind: left empty');
  assert.deepEqual(autoBindParams(reg.get('src.run'), sources, null), {});
});

test('the inspector shows a linked input as its upstream value type (script into a signal port stays a script)', () => {
  const script = [{ at: 0, pos: 10 }, { at: 100, pos: 90 }];
  const signal = { i0: 0, dt: 20, v: new Float32Array(3) };
  assert.equal(shownType('signal', 'script', script), 'script', 'sample adapter: raw upstream script');
  assert.equal(shownType('signal', 'number', 5), 'number', 'const adapter');
  assert.equal(shownType('signal', null, script), 'script', 'mismatch caught from the value shape');
  assert.equal(shownType('signal', null, signal), 'signal');
  assert.equal(shownType('signal', 'any', []), 'signal');
  assert.equal(shownType('spans', null, undefined), 'spans');
});

test('repeated paste at one spot steps down-right; moving the pointer starts over', () => {
  let a = pasteSpot(null, 520, 540, 40);
  assert.deepEqual([a.x, a.y], [520, 540]);
  a = pasteSpot(a.state, 520, 540, 40);
  assert.deepEqual([a.x, a.y], [560, 580]);
  a = pasteSpot(a.state, 520, 540, 40);
  assert.deepEqual([a.x, a.y], [600, 620]);
  a = pasteSpot(a.state, 100, 100, 40);
  assert.deepEqual([a.x, a.y], [100, 100]);
  assert.equal(plural(1, 'node'), '1 node');
  assert.equal(plural(3, 'node'), '3 nodes');
});
