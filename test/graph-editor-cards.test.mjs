import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineParams, iconFor, titleOf, portLabel, paletteItems, nestItems, compatibleItems } from '../src/features/graph/editor/cards.js';
import { compat } from '../src/lib/graph/types.js';

const defs = [
  { type: 'amp.remap', title: 'Remap depth', group: 'Amplitude', icon: 'range', ins: [{ name: 'script', type: 'script' }], outs: [{ name: 'script', type: 'script' }],
    params: [{ key: 'lo', label: 'Deep end', type: 'number' }, { key: 'hi', label: 'Out end', type: 'number' }, { key: 'x', label: 'X', type: 'number' }] },
  { type: 'out.axis', title: 'Axis output', group: 'Outputs', ins: [{ name: 'script', type: 'script' }], outs: [{ name: 'result', type: 'script' }],
    params: [{ key: 'axis', type: 'text', editor: 'axis', inline: true }, { key: 'seamMs', type: 'number' }] },
  { type: 'script.sample', title: 'Sample', group: 'Script · analysis', ins: [{ name: 'script', type: 'script' }], outs: [{ name: 'signal', type: 'signal' }], params: [] },
  { type: 'gen.pulses', title: 'Pulses', group: 'Generate', perSpan: true, ins: [], outs: [{ name: 'script', type: 'script' }], params: [{ key: 'seed', type: 'int', hidden: true }],
    variants: [{ id: 'climax', title: 'Climax pulses', params: { rate: 6 } }] },
  { type: 'flow.gate', title: 'Gate', group: 'Flow', ins: [{ name: 'in', type: 'any' }, { name: 'where', type: 'spans' }], outs: [{ name: 'out', type: 'any' }], params: [] },
];

test('inlineParams: flagged first, else the first two plain numerics', () => {
  assert.deepEqual(inlineParams(defs[0]).map((p) => p.key), ['lo', 'hi']);
  assert.deepEqual(inlineParams(defs[1]).map((p) => p.key), ['axis']);
  assert.deepEqual(inlineParams(defs[3]), []);
});

test('icons, titles, labels', () => {
  assert.equal(iconFor(defs[0], new Set(['range'])), 'range');
  assert.equal(iconFor(defs[0], new Set()), 'sliders');
  assert.equal(iconFor(null, new Set()), 'warning');
  assert.equal(titleOf({ type: 'x.y' }, null), 'Missing: x.y');
  assert.equal(titleOf({ type: 'amp.remap', label: 'Depth' }, defs[0]), 'Depth');
  assert.equal(portLabel({ name: 'p:lo' }), 'Lo');
  assert.equal(portLabel({ name: 'where', label: 'Only inside' }), 'Only inside');
});

test('paletteItems adds variants; nestItems builds the group tree', () => {
  const items = paletteItems(defs);
  assert.equal(items.length, defs.length + 1);
  const v = items.find((i) => i.key === 'gen.pulses#climax');
  assert.equal(v.title, 'Climax pulses');
  assert.deepEqual(v.variant.params, { rate: 6 });
  assert.ok(!items.find((i) => i.key === 'gen.pulses').params.length, 'hidden params are not search words');
  const tree = nestItems(items);
  const script = tree.find((g) => g.name === 'Script');
  assert.equal(script.groups[0].name, 'analysis');
  assert.equal(script.groups[0].items[0].key, 'script.sample');
});

test('compatibleItems: a dragged script output finds script and any inputs, converters first', () => {
  const items = paletteItems(defs);
  const r = compatibleItems(items, { side: 'out', type: 'script', port: 'script' }, compat);
  const keys = r.map((x) => x.item.key);
  assert.ok(keys.includes('amp.remap') && keys.includes('flow.gate') && keys.includes('script.sample'));
  assert.ok(!keys.includes('gen.pulses'), 'no script input');
  assert.equal(keys[0], 'script.sample', 'script -> signal converter first');
  const firstAdapted = r.findIndex((x) => x.adapter);
  assert.ok(firstAdapted < 0 || r.slice(firstAdapted).every((x) => x.adapter), 'native takers before auto-converted ones');
  const spans = compatibleItems(items, { side: 'out', type: 'spans', port: 'spans' }, compat).map((x) => x.item.key);
  assert.ok(spans.includes('gen.pulses'), 'perSpan nodes take spans on "where"');
  const into = compatibleItems(items, { side: 'in', type: 'signal', port: 'p:lo' }, compat).map((x) => x.item.key);
  assert.ok(into.includes('script.sample'));
});
