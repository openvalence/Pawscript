// lib/graph serialize.js: tolerant parse (unknown types kept, dangling links dropped, ids/rate filled, params coerced,
// unknown keys kept, node migrations, format migrations), round trips, the .pawproj block and .pawgraph files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, emptyGraph, addNode, connect, addFrame } from '../src/lib/graph/model.js';
import { compile } from '../src/lib/graph/eval.js';
import {
  GRAPH_VERSION, MIGRATIONS, parseGraph, serializeGraph, parseGraphs, serializeGraphs, stringifyGraphFile, parseGraphFile,
} from '../src/lib/graph/serialize.js';

const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
const reg = createRegistry([
  { type: 't.src', title: 'Source', group: 'T', ins: [], outs: [{ name: 'script', type: 'script' }], params: [{ key: 'axis', type: 'text', default: 'stroke' }], eval: () => ({ script: [] }) },
  { type: 't.gain', title: 'Gain', group: 'T', version: 2, ins: [{ name: 'script', type: 'script', required: true }], outs: [{ name: 'script', type: 'script' }],
    params: [{ key: 'k', type: 'number', default: 1, min: 0, max: 4 }, { key: 'mode', type: 'choice', default: 'a', choices: ['a', 'b'] }], perSpan: true,
    migrate: (p, from) => (from < 2 && 'gain' in p ? { k: p.gain, mode: p.mode } : p), eval: ({ script }) => ({ script }) },
]);

test('GRAPH_VERSION and a not-a-graph refusal', () => {
  assert.equal(GRAPH_VERSION, 1);
  for (const bad of [null, 3, 'x', [1]]) assert.throws(() => parseGraph(bad, reg), /^Error: not a graph: /);
});

test('parseGraph fills ids, name and rate; keeps unknown keys at every level', () => {
  const raw = freeze({ nodes: [{ type: 't.src', x: 'nope', params: { axis: 'roll', extra: 1 }, custom: { a: 1 } }], links: [], rate: 70, macros: [{ id: 'm' }] });
  const { graph, diags } = parseGraph(raw, reg);
  assert.match(graph.id, /^g/);
  assert.equal(graph.name, 'Graph');
  assert.equal(graph.rate, 50);
  assert.equal(graph.v, 1);
  assert.deepEqual(graph.macros, [{ id: 'm' }]);
  const n = graph.nodes[0];
  assert.match(n.id, /^n/);
  assert.equal(n.x, 0);
  assert.equal(n.tv, 1);
  assert.deepEqual(n.params, { axis: 'roll', extra: 1 });
  assert.deepEqual(n.custom, { a: 1 });
  assert.deepEqual(diags, []);
  assert.equal(parseGraph({ rate: 200, nodes: 'x' }, reg).graph.rate, 200);
});

test('unknown node types are kept verbatim with their links; compile reports them', () => {
  const raw = {
    v: 1, id: 'g1', name: 'G', rate: 100,
    nodes: [{ id: 'a', type: 't.src', tv: 1, x: 0, y: 0, params: { axis: 'stroke' } }, { id: 'u', type: 'future.node', tv: 7, x: 20, y: 0, params: { whatever: [1, 2], deep: { x: 1 } }, flag: true }],
    links: [{ id: 'l1', from: 'a', out: 'script', to: 'u', in: 'mystery' }],
  };
  const { graph, diags } = parseGraph(raw, reg);
  assert.deepEqual(diags, []);
  assert.deepEqual(graph.nodes[1], raw.nodes[1]);
  assert.deepEqual(graph.links, raw.links);
  const p = compile(graph, reg);
  assert.equal(p.diags.find((d) => d.code === 'unknown-type').node, 'u');
  assert.deepEqual(serializeGraph(graph), raw, 'round trip keeps everything');
});

test('dangling links are dropped with a diagnostic; duplicate ids are renamed; one link per input', () => {
  const raw = {
    id: 'g', nodes: [{ id: 'a', type: 't.src', params: {} }, { id: 'a', type: 't.src', params: {} }, { id: 'b', type: 't.gain', tv: 2, params: {} }],
    links: [
      { id: 'l1', from: 'a', out: 'script', to: 'b', in: 'script' },
      { id: 'l2', from: 'ghost', out: 'script', to: 'b', in: 'script' },
      { id: 'l1', from: 'a', out: 'script', to: 'b', in: 'where' },
      { from: 'a', out: 'script', to: 'b', in: 'script' },
    ],
  };
  const { graph, diags } = parseGraph(raw, reg);
  assert.equal(graph.nodes.length, 3);
  assert.notEqual(graph.nodes[1].id, 'a');
  assert.ok(diags.some((d) => d.code === 'note' && /renamed/.test(d.message)));
  assert.equal(diags.filter((d) => d.code === 'dangling-link').length, 2, 'the missing source, and the replaced second wire into b.script');
  assert.equal(graph.links.length, 2);
  assert.equal(new Set(graph.links.map((l) => l.id)).size, 2, 'link ids are unique');
  assert.deepEqual(graph.links.map((l) => l.in).sort(), ['script', 'where']);
});

test('params of known types are coerced (with a param diagnostic); node migrations run when tv < version', () => {
  const raw = { id: 'g', nodes: [
    { id: 'a', type: 't.gain', tv: 2, params: { k: 9, mode: 'zzz', keep: 'me' }, byKind: { climax: { k: -3, other: 1 }, bad: 5 } },
    { id: 'b', type: 't.gain', tv: 1, params: { gain: 3, mode: 'b' } },
    { id: 'c', type: 't.gain', params: {} },
    { id: 'd', type: 't.gain', tv: 9, params: { k: 99 } },
  ], links: [] };
  const { graph, diags } = parseGraph(raw, reg);
  const [a, b, c, d] = graph.nodes;
  assert.deepEqual(a.params, { k: 4, mode: 'a', keep: 'me' });
  assert.deepEqual(a.byKind, { climax: { k: 0, other: 1 } });
  assert.deepEqual(diags.filter((x) => x.code === 'param').map((x) => x.id).sort(), ['param@a:p:k', 'param@a:p:mode']);
  assert.deepEqual(b.params, { k: 3, mode: 'b' });
  assert.equal(b.tv, 2);
  assert.deepEqual(c.params, { k: 1, mode: 'a' }, 'missing tv means version 1; migrate keeps p; defaults filled');
  assert.equal(c.tv, 2);
  assert.deepEqual(d.params, { k: 99 }, 'a newer node is kept as saved');
  assert.equal(d.tv, 9);
  assert.ok(diags.some((x) => x.node === 'd' && /newer/.test(x.message)));
});

test('format migrations run from MIGRATIONS', () => {
  MIGRATIONS[0] = (o) => ({ ...o, v: 1, nodes: o.items, items: undefined });
  try {
    const { graph } = parseGraph({ v: 0, id: 'old', items: [{ id: 'a', type: 't.src', params: {} }] }, reg);
    assert.equal(graph.v, 1);
    assert.equal(graph.nodes[0].id, 'a');
  } finally { delete MIGRATIONS[0]; }
  const { diags } = parseGraph({ v: 5, nodes: [] }, reg);
  assert.ok(diags.some((d) => /newer version/.test(d.message)));
});

test('frames and lastBake are sanitised and preserved', () => {
  const { graph } = parseGraph({ id: 'g', frames: [{ title: 5, x: 1 }, 'junk'], lastBake: { n1: { axis: 'stroke', key: 'k', hash: 'h', time: 1 } } }, reg);
  assert.equal(graph.frames.length, 1);
  assert.equal(graph.frames[0].title, '');
  assert.equal(graph.frames[0].color, null);
  assert.match(graph.frames[0].id, /^f/);
  assert.deepEqual(graph.lastBake, { n1: { axis: 'stroke', key: 'k', hash: 'h', time: 1 } });
  assert.equal(parseGraph({ id: 'g', lastBake: 3 }, reg).graph.lastBake, undefined);
});

test('serialize -> parse round trip of a built graph is the identity', () => {
  let g = emptyGraph({ name: 'Round', rate: 100 });
  const a = addNode(g, reg, 't.src', { x: 20, y: 40 }); g = a.graph;
  const b = addNode(g, reg, 't.gain', { params: { k: 2 }, byKind: { oral: { k: 3 } }, label: 'G' }); g = b.graph;
  g = connect(g, reg, { from: a.id, out: 'script', to: b.id, in: 'script' }).graph;
  g = addFrame(g, { title: 'F', x: 0, y: 0, w: 100, h: 100, color: 'sky' }).graph;
  g = { ...g, lastBake: { [b.id]: { axis: 'stroke', key: 'k', hash: 'h', time: 5 } }, nodes: g.nodes.map((n) => (n.id === b.id ? { ...n, muted: undefined, collapsed: true } : n)) };
  const json = JSON.parse(JSON.stringify(serializeGraph(g)));
  assert.equal('muted' in json.nodes[1], false, 'undefined fields are dropped');
  const { graph, diags } = parseGraph(json, reg);
  assert.deepEqual(diags, []);
  assert.deepEqual(graph, json);
});

test('.pawproj block: parseGraphs / serializeGraphs', () => {
  assert.deepEqual(parseGraphs(null, reg), { graphs: [], diags: [] });
  assert.deepEqual(parseGraphs(undefined, reg), { graphs: [], diags: [] });
  const g1 = emptyGraph({ name: 'A' });
  const block = serializeGraphs([g1, { ...g1, name: 'B' }]);
  assert.equal(block.v, 1);
  assert.equal(block.items.length, 2);
  const { graphs, diags } = parseGraphs({ v: 1, items: [...block.items, 'junk'] }, reg);
  assert.equal(graphs.length, 2);
  assert.notEqual(graphs[0].id, graphs[1].id, 'duplicate graph ids are made unique');
  assert.equal(diags.length, 1);
});

test('.pawgraph files', () => {
  const g = addNode(emptyGraph({ name: 'File' }), reg, 't.src').graph;
  const text = stringifyGraphFile(g);
  const obj = JSON.parse(text);
  assert.equal(obj.format, 'pawgraph');
  assert.equal(obj.version, 1);
  assert.deepEqual(parseGraphFile(text, reg).graph, g);
  assert.throws(() => parseGraphFile('{nope', reg), /^Error: not a \.pawgraph file: /);
  assert.throws(() => parseGraphFile('{"format":"x"}', reg), /not a \.pawgraph file/);
  assert.throws(() => parseGraphFile('{"format":"pawgraph"}', reg), /not a \.pawgraph file/);
  // a preset written as a file loads as a graph (preset-local ids, link ids filled)
  const preset = { id: 'my-preset', name: 'P', description: 'd', tags: [], nodes: [{ id: 'a', type: 't.src', x: 0, y: 0 }, { id: 'b', type: 't.gain', x: 0, y: 0 }], links: [{ from: 'a', out: 'script', to: 'b', in: 'script' }] };
  const back = parseGraphFile(stringifyGraphFile(preset), reg).graph;
  assert.equal(back.description, 'd');
  assert.equal(back.links.length, 1);
  assert.match(back.links[0].id, /^l/);
});

test('regression: a failed migrate keeps the old tv and raw params; byKind overrides are migrated', () => {
  const r = createRegistry([{ type: 't.depth', title: 'Depth', group: 'T', version: 2, ins: [], outs: [{ name: 'script', type: 'script' }],
    params: [{ key: 'depth', type: 'number', default: 50, min: 0, max: 100 }, { key: 'mode', type: 'choice', default: 'a', choices: ['a', 'b'] }],
    perSpan: true,
    migrate: (p) => { if (p.fail) throw new Error('nope'); const { oldDepth, ...rest } = p; return oldDepth === undefined ? rest : { ...rest, depth: oldDepth * 100 }; },
    eval: () => ({ script: [] }) }]);
  const failed = parseGraph({ nodes: [{ id: 'n1', type: 't.depth', tv: 1, params: { oldDepth: 0.2, fail: true } }], links: [] }, r);
  assert.equal(failed.graph.nodes[0].tv, 1, 'retried on the next load');
  assert.deepEqual(failed.graph.nodes[0].params, { oldDepth: 0.2, fail: true });
  assert.ok(failed.diags.some((d) => /could not migrate/.test(d.message)));
  const ok = parseGraph(freeze({ nodes: [{ id: 'n1', type: 't.depth', tv: 1, params: { oldDepth: 0.2 }, byKind: { climax: { oldDepth: 0.9 }, oral: { mode: 'b' } } }], links: [] }), r);
  const n = ok.graph.nodes[0];
  assert.equal(n.tv, 2);
  assert.deepEqual(n.params, { depth: 20, mode: 'a' });
  assert.deepEqual(n.byKind, { climax: { depth: 90 }, oral: { mode: 'b' } });
});
