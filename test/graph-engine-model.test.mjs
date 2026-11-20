// lib/graph model.js: defineNode, registry, graph edits, planLink reasons and replace, wouldLoop, duplicate,
// presets (remap), frames, history. Uses small fake node types so it does not depend on nodes/.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID, snap, newId, defineNode, createRegistry, emptyGraph, addNode, removeNodes, moveNodes, setParams, setByKind,
  setNodeProps, planLink, connect, disconnect, insertOnLink, dissolveNodes, duplicate, wouldLoop, upstreamOf,
  downstreamOf, addFrame, patchFrame, removeFrames, toPreset, applyPreset, createHistory, portType,
} from '../src/lib/graph/model.js';

const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
const S = (name, extra = {}) => ({ name, type: 'script', ...extra });
const base = { group: 'Test', eval: () => ({}) };
const DEFS = [
  { ...base, type: 't.src', title: 'Source', ins: [], outs: [S('script')], params: [{ key: 'seed', type: 'int', default: 0, seed: true }] },
  { ...base, type: 't.gain', title: 'Gain', ins: [S('script', { required: true })], outs: [S('script')],
    params: [{ key: 'k', label: 'Gain', type: 'number', default: 1, min: 0, max: 4, mod: 'signal' }, { key: 'n', type: 'int', default: 2, min: 0, max: 10, mod: 'number' }],
    perSpan: true },
  { ...base, type: 't.sig', title: 'To signal', ins: [S('script', { required: true })], outs: [{ name: 'signal', type: 'signal' }], params: [] },
  { ...base, type: 't.toScript', title: 'Signal → Script', ins: [{ name: 'signal', type: 'signal', required: true }], outs: [S('script')], params: [] },
  { ...base, type: 't.num', title: 'Number', ins: [], outs: [{ name: 'value', type: 'number' }], params: [{ key: 'value', type: 'number', default: 1 }] },
  { ...base, type: 't.spans', title: 'Spans', ins: [], outs: [{ name: 'spans', type: 'spans' }], params: [] },
  { ...base, type: 't.any', title: 'Reroute', ins: [{ name: 'in', type: 'any', required: true }], outs: [{ name: 'out', type: 'any' }], params: [] },
  { ...base, type: 't.switch', title: 'Switch', ins: [{ name: 'a', type: 'any' }, { name: 'b', type: 'any', accepts: ['script', 'signal'] }], outs: [{ name: 'out', type: 'any' }], params: [] },
  { ...base, type: 't.mix', title: 'Mix', ins: [S('a', { required: true }), S('b')], outs: [S('script')], params: [], bypass: { script: 'b' } },
  { ...base, type: 'sig.toScript', title: 'Signal → Script', ins: [{ name: 'signal', type: 'signal', required: true }], outs: [S('script')], params: [] },
];
const reg = createRegistry(DEFS);

function chain(types) {
  let g = emptyGraph();
  const ids = [];
  for (const t of types) { const r = addNode(g, reg, t, { x: ids.length * 200 }); g = r.graph; ids.push(r.id); }
  return { g, ids };
}
const out0 = (reg2, g, id) => reg2.portsOf(g.nodes.find((n) => n.id === id), g).outs[0].name;
function wire(g, a, b, inName = 'script') {
  const r = connect(g, reg, { from: a, out: out0(reg, g, a), to: b, in: inName });
  assert.equal(r.reason, '', r.reason);
  return r.graph;
}

test('snap, GRID and newId', () => {
  assert.equal(GRID, 20);
  assert.equal(snap(29), 20);
  assert.equal(snap(31), 40);
  const a = newId('n'), b = newId('n');
  assert.ok(a.startsWith('n') && a !== b);
});

test('defineNode validates, fills defaults and freezes', () => {
  const d = defineNode({ ...base, type: 'x.ok', title: 'Ok', ins: [], outs: [], params: [] });
  assert.equal(d.version, 1);
  assert.equal(d.halo({}), Infinity);
  assert.ok(Object.isFrozen(d) && Object.isFrozen(d.ins));
  assert.equal(defineNode(d), d, 'idempotent');
  const bad = [
    [{ type: 'nodot' }, /group\.name/],
    [{ title: '' }, /title/],
    [{ ins: [{ name: 'where', type: 'script' }] }, /reserved/],
    [{ ins: [{ name: 'p:x', type: 'number' }] }, /reserved/],
    [{ ins: [S('a'), S('a')] }, /duplicate port/],
    [{ outs: [{ name: 'o', type: 'bool' }] }, /unknown type/],
    [{ params: [{ key: 'a', type: 'choice', mod: 'number' }] }, /not numeric/],
    [{ params: [{ key: 'a', type: 'int' }, { key: 'a', type: 'int' }] }, /duplicate param/],
    [{ eval: 1 }, /eval/],
    [{ version: 0 }, /version/],
    [{ bypass: { nope: 'a' } }, /bypass/],
  ];
  for (const [patch, re] of bad) {
    assert.throws(() => defineNode({ ...base, type: 'x.bad', title: 'Bad', ins: [], outs: [], params: [], ...patch }), (e) => re.test(e.message) && /^defineNode /.test(e.message), JSON.stringify(patch));
  }
});

test('registry: add, get, duplicates, groups tree, portsOf', () => {
  assert.equal(reg.get('t.gain').title, 'Gain');
  assert.equal(reg.get('nope'), null);
  assert.ok(reg.has('t.src'));
  assert.throws(() => reg.add(DEFS[0]), /duplicate/);
  const r2 = createRegistry().add({ ...base, type: 'a.x', title: 'X', group: 'Edit · amplitude', ins: [], outs: [], params: [] })
    .add({ ...base, type: 'a.y', title: 'Y', group: 'Edit · time', ins: [], outs: [], params: [] })
    .add({ ...base, type: 'a.z', title: 'Z', group: 'Sources', ins: [], outs: [], params: [] });
  const tree = r2.groups();
  assert.deepEqual(tree.map((g) => g.name), ['Edit', 'Sources']);
  assert.deepEqual(tree[0].groups.map((g) => [g.name, g.items.map((d) => d.type)]), [['amplitude', ['a.x']], ['time', ['a.y']]]);
  const { g, ids } = chain(['t.gain']);
  const ports = reg.portsOf(g.nodes[0], g);
  assert.deepEqual(ports.ins.map((p) => p.name), ['script', 'where']);
  assert.deepEqual(ports.params.map((p) => [p.name, p.type]), [['p:k', 'signal'], ['p:n', 'number']]);
  // unknown type: ports inferred from links, typed any
  const ug = { ...g, nodes: [...g.nodes, { id: 'u1', type: 'gone.node', tv: 1, x: 0, y: 0, params: {} }], links: [{ id: 'l1', from: 'u1', out: 'res', to: ids[0], in: 'script' }] };
  assert.deepEqual(reg.portsOf(ug.nodes[1], ug), { ins: [], outs: [{ name: 'res', type: 'any' }], params: [] });
  assert.deepEqual(reg.portsOf(ug.nodes[1]), { ins: [], outs: [], params: [] });
});

test('addNode fills and coerces params, randomises seeds, throws on unknown types', () => {
  const g0 = freeze(emptyGraph({ name: 'G', rate: 60 }));
  assert.equal(g0.rate, 50);
  const { graph, id } = addNode(g0, reg, 't.gain', { x: 10, y: 20, params: { k: 9, extra: 'kept' }, byKind: { climax: { k: -1 } }, label: 'G1' });
  const n = graph.nodes[0];
  assert.equal(n.id, id);
  assert.deepEqual(n.params, { k: 4, n: 2, extra: 'kept' });
  assert.deepEqual(n.byKind, { climax: { k: 0 } });
  assert.equal(n.tv, 1);
  assert.equal(n.label, 'G1');
  assert.equal(g0.nodes.length, 0, 'input untouched');
  const s1 = addNode(g0, reg, 't.src').graph.nodes[0].params.seed;
  const s2 = addNode(g0, reg, 't.src').graph.nodes[0].params.seed;
  assert.ok(Number.isInteger(s1) && (s1 !== s2 || s1 !== 0));
  assert.equal(addNode(g0, reg, 't.src', { params: { seed: 7 } }).graph.nodes[0].params.seed, 7);
  assert.throws(() => addNode(g0, reg, 'nope.x'), /unknown node type/);
});

test('remove, move, setParams, setByKind, setNodeProps are pure and return the same graph when nothing changes', () => {
  let { g, ids } = chain(['t.src', 't.gain']);
  g = wire(g, ids[0], ids[1]);
  g = { ...g, lastBake: { [ids[1]]: { axis: 'stroke', key: 'k', hash: 'h', time: 1 }, other: {} } };
  freeze(g);
  const r = removeNodes(g, [ids[1]]);
  assert.equal(r.nodes.length, 1);
  assert.equal(r.links.length, 0);
  assert.deepEqual(Object.keys(r.lastBake), ['other']);
  assert.equal(removeNodes(g, ['zzz']), g);
  const m = moveNodes(g, [ids[0]], 5, -5);
  assert.deepEqual([m.nodes[0].x, m.nodes[0].y], [5, -5]);
  assert.equal(m.nodes[1], g.nodes[1], 'untouched nodes are shared');
  assert.equal(moveNodes(g, [ids[0]], 0, 0), g);
  const p = setParams(g, reg, ids[1], { k: 100, foo: 1 });
  assert.deepEqual(p.nodes[1].params, { k: 4, n: 2, foo: 1 });
  assert.equal(setParams(p, reg, ids[1], { k: 4 }), p, 'unchanged -> same graph');
  let b = setByKind(g, reg, ids[1], 'climax', { k: 2 });
  assert.deepEqual(b.nodes[1].byKind, { climax: { k: 2 } });
  b = setByKind(b, reg, ids[1], 'oral', {});
  assert.deepEqual(b.nodes[1].byKind, { climax: { k: 2 }, oral: {} });
  b = setByKind(b, reg, ids[1], 'climax', { k: undefined });
  assert.deepEqual(b.nodes[1].byKind.climax, {});
  b = setByKind(setByKind(b, reg, ids[1], 'climax', null), reg, ids[1], 'oral', null);
  assert.equal(b.nodes[1].byKind, undefined);
  const s = setNodeProps(g, ids[1], { muted: true, label: 'Hi', bogus: 1 });
  assert.equal(s.nodes[1].muted, true);
  assert.equal(s.nodes[1].bogus, undefined);
  assert.equal(setNodeProps(s, ids[1], { muted: true }), s);
  assert.equal(setNodeProps(s, ids[1], { label: undefined }).nodes[1].label, undefined);
});

test('planLink: reasons, replace and adapters', () => {
  let { g, ids } = chain(['t.src', 't.gain', 't.sig', 't.toScript', 't.num', 't.spans']);
  const [src, gain, sig, toS, num, spans] = ids;
  const P = (from, out, to, inp) => planLink(g, reg, { from, out, to, in: inp });
  assert.deepEqual(P(src, 'script', gain, 'script'), { ok: true });
  assert.match(P(gain, 'script', gain, 'script').reason, /^refused: a node cannot feed itself/);
  assert.match(P(src, 'nope', gain, 'script').reason, /^refused: no such output "nope"/);
  assert.match(P(src, 'script', gain, 'x').reason, /^refused: no such input "x"/);
  assert.match(P(src, 'script', gain, 'p:zz').reason, /no such input "p:zz"/);
  g = wire(g, src, gain);
  g = wire(g, gain, sig);
  assert.match(P(sig, 'signal', gain, 'where').reason, /^refused: would loop/);
  const sig2 = addNode(g, reg, 't.sig');
  g = sig2.graph;
  const r = P(sig2.id, 'signal', gain, 'script');
  assert.equal(r.ok, false);
  assert.match(r.reason, /refused: signal cannot feed script — insert "Signal → Script"/);
  assert.deepEqual(r.suggest, ['sig.toScript', 'sig.sampleAt']);
  assert.deepEqual(P(src, 'script', toS, 'signal'), { ok: true, adapter: 'sample' });
  assert.deepEqual(P(num, 'value', toS, 'signal'), { ok: true, adapter: 'const' });
  assert.deepEqual(P(num, 'value', gain, 'p:n'), { ok: true });
  assert.equal(P(src, 'script', gain, 'p:n').ok, false, 'number param takes numbers only');
  assert.deepEqual(P(src, 'script', gain, 'p:k'), { ok: true, adapter: 'sample' });
  assert.deepEqual(P(spans, 'spans', gain, 'where'), { ok: true });
  const rep = P(spans, 'spans', gain, 'script');
  assert.equal(rep.ok, false);
  const src2 = addNode(g, reg, 't.src');
  g = src2.graph;
  const re = planLink(g, reg, { from: src2.id, out: 'script', to: gain, in: 'script' });
  assert.equal(re.ok, true);
  assert.equal(re.replace, g.links.find((l) => l.to === gain).id);
});

test('planLink resolves any ports through upstream types and accepts', () => {
  let { g, ids } = chain(['t.src', 't.any', 't.toScript', 't.sig', 't.switch', 't.spans']);
  const [src, any, toS, sig, sw, spans] = ids;
  assert.equal(portType(g, reg, any, 'out'), 'any');
  g = wire(g, src, any, 'in');
  assert.equal(portType(g, reg, any, 'out'), 'script');
  assert.deepEqual(planLink(g, reg, { from: any, out: 'out', to: toS, in: 'signal' }), { ok: true, adapter: 'sample' });
  g = wire(g, src, sig);
  g = wire(g, sig, sw, 'a');
  const r = planLink(g, reg, { from: src, out: 'script', to: sw, in: 'b' });
  assert.equal(r.ok, true, 'script feeds an any input that is not constrained by an earlier input of another type... ');
  assert.equal(r.adapter, 'sample', 'b is fixed to signal by a');
  assert.match(planLink(g, reg, { from: spans, out: 'spans', to: sw, in: 'b' }).reason, /takes script or signal/);
});

test('connect replaces the input\'s link; reconnecting the same wire is a no-op; disconnect', () => {
  let { g, ids } = chain(['t.src', 't.src', 't.gain']);
  g = wire(g, ids[0], ids[2]);
  const before = g;
  const same = connect(g, reg, { from: ids[0], out: 'script', to: ids[2], in: 'script' });
  assert.equal(same.graph, before);
  const r = connect(g, reg, { from: ids[1], out: 'script', to: ids[2], in: 'script' });
  assert.equal(r.graph.links.length, 1);
  assert.equal(r.graph.links[0].from, ids[1]);
  const bad = connect(g, reg, { from: ids[2], out: 'script', to: ids[2], in: 'script' });
  assert.equal(bad.id, null);
  assert.equal(bad.graph, g);
  assert.match(bad.reason, /refused/);
  assert.equal(disconnect(r.graph, [r.id]).links.length, 0);
  assert.equal(disconnect(r.graph, ['nope']), r.graph);
});

test('wouldLoop, upstreamOf, downstreamOf', () => {
  let { g, ids } = chain(['t.src', 't.gain', 't.gain', 't.gain']);
  g = wire(wire(wire(g, ids[0], ids[1]), ids[1], ids[2]), ids[2], ids[3]);
  assert.equal(wouldLoop(g, ids[3], ids[1]), true);
  assert.equal(wouldLoop(g, ids[1], ids[1]), true);
  assert.equal(wouldLoop(g, ids[0], ids[3]), false);
  assert.deepEqual([...upstreamOf(g, [ids[2]])].sort(), [ids[0], ids[1]].sort());
  assert.deepEqual([...downstreamOf(g, [ids[1]])].sort(), [ids[2], ids[3]].sort());
});

test('insertOnLink splices a node into a wire, with refusals', () => {
  let { g, ids } = chain(['t.src', 't.gain', 't.gain', 't.sig']);
  g = wire(g, ids[0], ids[1]);
  const lid = g.links[0].id;
  const r = insertOnLink(g, reg, lid, ids[2]);
  assert.equal(r.reason, '');
  assert.deepEqual(r.graph.links.map((l) => [l.from, l.to]), [[ids[0], ids[2]], [ids[2], ids[1]]]);
  const bad = insertOnLink(g, reg, lid, ids[3]); // t.sig outputs a signal: cannot feed gain.script
  assert.match(bad.reason, /refused/);
  assert.equal(bad.graph, g);
});

test('dissolveNodes reconnects through the bypass pair', () => {
  let { g, ids } = chain(['t.src', 't.gain', 't.gain', 't.mix']);
  g = wire(wire(g, ids[0], ids[1]), ids[1], ids[2]);
  g = wire(g, ids[2], ids[3], 'a');
  const d = dissolveNodes(g, reg, [ids[1], ids[2]]);
  assert.deepEqual(d.links.map((l) => [l.from, l.to, l.in]), [[ids[0], ids[3], 'a']]);
  assert.equal(d.nodes.length, 2);
  // explicit bypass: t.mix passes b, so dissolving it with only `a` wired drops the downstream wire
  let h = chain(['t.src', 't.src', 't.mix', 't.gain']);
  let hg = wire(wire(h.g, h.ids[0], h.ids[2], 'a'), h.ids[1], h.ids[2], 'b');
  hg = wire(hg, h.ids[2], h.ids[3]);
  assert.deepEqual(dissolveNodes(hg, reg, [h.ids[2]]).links.map((l) => [l.from, l.to]), [[h.ids[1], h.ids[3]]]);
});

test('duplicate copies nodes, params, seeds and inner links', () => {
  let { g, ids } = chain(['t.src', 't.gain', 't.gain']);
  g = wire(wire(g, ids[0], ids[1]), ids[1], ids[2]);
  freeze(g);
  const { graph, map } = duplicate(g, [ids[0], ids[1]]);
  assert.equal(graph.nodes.length, 5);
  assert.equal(graph.links.length, 3);
  const c0 = graph.nodes.find((n) => n.id === map[ids[0]]);
  assert.equal(c0.params.seed, g.nodes[0].params.seed);
  assert.equal(c0.x, g.nodes[0].x + 40);
  assert.ok(graph.links.some((l) => l.from === map[ids[0]] && l.to === map[ids[1]]));
  assert.ok(!graph.links.some((l) => l.from === map[ids[1]]), 'links to uncopied nodes are not copied');
});

test('frames: add, patch, remove', () => {
  const g0 = emptyGraph();
  const { graph, id } = addFrame(g0, { title: 'F', x: 0, y: 0, w: 100, h: 50 });
  assert.equal(graph.frames[0].color, null);
  const p = patchFrame(graph, id, { title: 'G', id: 'hack' });
  assert.equal(p.frames[0].title, 'G');
  assert.equal(p.frames[0].id, id);
  assert.equal(removeFrames(p, [id]).frames.length, 0);
  assert.equal(removeFrames(p, ['x']), p);
});

test('toPreset / applyPreset: remap ids, offset positions, fill defaults, keep links', () => {
  let { g, ids } = chain(['t.src', 't.gain', 't.gain']);
  g = wire(wire(g, ids[0], ids[1]), ids[1], ids[2]);
  g = setParams(g, reg, ids[1], { k: 3 });
  g = addFrame(g, { title: 'F', x: -10, y: -10, w: 420, h: 100 }).graph;
  const preset = toPreset(g, [ids[1], ids[2]], { name: 'two gains' });
  assert.equal(preset.nodes.length, 2);
  assert.deepEqual(preset.links.map((l) => [l.from, l.to]), [[ids[1], ids[2]]]);
  assert.equal(preset.frames, undefined, 'frame also contains the unselected source');
  const target = freeze(emptyGraph());
  const r = applyPreset(target, reg, preset, { x: 1000, y: 500 });
  assert.equal(r.ids.length, 2);
  assert.ok(!r.ids.includes(ids[1]));
  assert.deepEqual(r.graph.nodes.map((n) => [n.x, n.y]), [[1000, 500], [1200, 500]]);
  assert.equal(r.graph.nodes[0].params.k, 3);
  assert.deepEqual(r.graph.links.map((l) => [l.from, l.to]), [[r.map[ids[1]], r.map[ids[2]]]]);
  // a hand-written preset with partial params and an unknown type
  const hand = { id: 'p', name: 'hand', nodes: [{ id: 'a', type: 't.gain', x: 0, y: 0, params: { k: 2 } }, { id: 'b', type: 'gone.x', x: 20, y: 0, params: { z: 1 } }], links: [{ from: 'b', out: 'o', to: 'a', in: 'script' }] };
  const h = applyPreset(target, reg, hand);
  assert.deepEqual(h.graph.nodes[0].params, { k: 2, n: 2 });
  assert.deepEqual(h.graph.nodes[1].params, { z: 1 });
  assert.equal(h.graph.links.length, 1);
});

test('createHistory: push, undo/redo with swap, limit, clear', () => {
  const h = createHistory(2);
  let state = 'c';
  h.push('a'); h.push('b');
  const swap = (e) => { const cur = state; state = e; return cur; };
  assert.equal(h.undo(swap), 'b');
  assert.equal(state, 'b');
  assert.ok(h.canRedo);
  assert.equal(h.redo(swap), 'c');
  assert.equal(state, 'c');
  h.push('x'); // limit 2 drops 'a'
  assert.equal(h.canRedo, false);
  h.undo(swap); h.undo(swap);
  assert.equal(h.undo(swap), null);
  h.clear();
  assert.equal(h.canUndo || h.canRedo, false);
});

test('regression: fresh seeds stay inside the seed param range', () => {
  const r = createRegistry([{ ...base, type: 't.small', title: 'Small seed', ins: [], outs: [S('script')], params: [{ key: 'seed', type: 'int', default: 0, min: 0, max: 100, seed: true }] }]);
  const seeds = new Set();
  let g = emptyGraph();
  for (let i = 0; i < 40; i++) { g = addNode(g, r, 't.small').graph; seeds.add(g.nodes.at(-1).params.seed); }
  assert.ok([...seeds].every((s) => Number.isInteger(s) && s >= 0 && s <= 100));
  assert.ok(seeds.size > 5, 'not all clamped to max');
});
