// lib/graph eval.js: compile/validate diagnostics, cache keys, memo (0 recomputes, exact downstream recompute, undo
// identity hits), abort, faults, mute, windowing, adapters, perSpan, determinism and deep-frozen inputs.
// Small fake node types only, so nothing here depends on nodes/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, emptyGraph, addNode, connect, setParams, setNodeProps, setByKind, downstreamOf } from '../src/lib/graph/model.js';
import { compile, validate, withGraph, createCache, evaluate, evaluateSync, hashKey, stableJSON, tokenOf, ABORT, nodeSummary } from '../src/lib/graph/eval.js';
import { clipScript, sampleScript, checkValue, signalAt } from '../src/lib/graph/types.js';
import { clampPos, posAt } from '../src/lib/core/script.js';

const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o) && !ArrayBuffer.isView(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
const S = (name, extra = {}) => ({ name, type: 'script', ...extra });
const G = 'Test';
const mapPos = (s, f) => s.map((a) => ({ at: a.at, pos: clampPos(f(a)) }));

const DEFS = [
  { type: 't.src', title: 'Source', group: G, ins: [], outs: [S('script')], params: [{ key: 'axis', type: 'text', default: 'stroke' }],
    reads: (p) => [['axis', p.axis]], halo: () => 0, local: true,
    eval: (_i, p, ctx) => { const s = ctx.read('axis', p.axis) || []; return { script: ctx.window ? clipScript(s, ctx.range.t0, ctx.range.t1) : s }; } },
  { type: 'src.axis', title: 'Axis', group: G, ins: [], outs: [S('script')], params: [{ key: 'axis', type: 'text', default: 'stroke' }],
    reads: (p) => [['axis', p.axis]], eval: (_i, p, ctx) => ({ script: ctx.read('axis', p.axis) || [] }) },
  { type: 't.gain', title: 'Gain', group: G, ins: [S('script', { required: true })], outs: [S('script')],
    params: [{ key: 'k', label: 'Gain', type: 'number', default: 1, min: 0, max: 4, mod: 'signal' }], halo: () => 0, local: true,
    eval: ({ script }, p, ctx) => { const k = ctx.param('k'); return { script: mapPos(script, (a) => 50 + (a.pos - 50) * k(a.at)) }; } },
  { type: 't.offset', title: 'Offset', group: G, ins: [S('script', { required: true })], outs: [S('script')],
    params: [{ key: 'amount', type: 'number', default: 0, min: -100, max: 100, mod: 'number' }], halo: () => 0, local: true,
    eval: ({ script }, p) => ({ script: mapPos(script, (a) => a.pos + p.amount) }) },
  { type: 't.smooth', title: 'Smooth', group: G, ins: [S('script', { required: true })], outs: [S('script')],
    params: [{ key: 'w', type: 'int', default: 100, min: 0, max: 5000 }], halo: (p) => p.w, local: true,
    eval: ({ script }, p) => {
      const out = new Array(script.length);
      let lo = 0, hi = 0, sum = 0;
      for (let i = 0; i < script.length; i++) {
        while (hi < script.length && script[hi].at <= script[i].at + p.w) sum += script[hi++].pos;
        while (script[lo].at < script[i].at - p.w) sum -= script[lo++].pos;
        out[i] = { at: script[i].at, pos: clampPos(sum / (hi - lo)) };
      }
      return { script: out };
    } },
  { type: 't.shift', title: 'Shift', group: G, ins: [S('script', { required: true })], outs: [S('script')], timeShift: true,
    params: [{ key: 'ms', type: 'int', default: 0, min: -10000, max: 10000 }],
    eval: ({ script }, p) => ({ script: script.map((a) => ({ at: a.at + p.ms, pos: a.pos })).filter((a) => a.at >= 0) }) },
  { type: 't.boom', title: 'Boom', group: G, ins: [S('script', { required: true })], outs: [S('script')], params: [{ key: 'fail', type: 'bool', default: true }],
    eval: ({ script }, p) => { if (p.fail) throw new Error('boom'); return { script }; } },
  { type: 't.mix', title: 'Mix', group: G, ins: [S('a', { required: true }), S('b')], outs: [S('script')], params: [], bypass: { script: 'b' },
    eval: ({ a, b }) => ({ script: b ? mapPos(a, (x) => (x.pos + posAt(b, x.at)) / 2) : a }) },
  { type: 't.sig', title: 'To signal', group: G, ins: [S('script', { required: true })], outs: [{ name: 'signal', type: 'signal' }], params: [], halo: () => 0, local: true,
    eval: ({ script }, _p, ctx) => ({ signal: sampleScript(script, ctx.grid()) }) },
  { type: 't.thr', title: 'Threshold', group: G, ins: [{ name: 'signal', type: 'signal', required: true }], outs: [{ name: 'spans', type: 'spans' }],
    params: [{ key: 'above', type: 'number', default: 50 }],
    eval: ({ signal }, p) => {
      const out = [];
      let start = null;
      for (let k = 0; k <= signal.v.length; k++) {
        const on = k < signal.v.length && signal.v[k] > p.above;
        const t = (signal.i0 + k) * signal.dt;
        if (on && start === null) start = t;
        if (!on && start !== null) { out.push({ t0: start, t1: t, kind: 'hi' }); start = null; }
      }
      return { spans: out };
    } },
  { type: 't.mean', title: 'Mean', group: G, ins: [{ name: 'in', type: 'any', required: true, accepts: ['script', 'signal'] }], outs: [{ name: 'value', type: 'number' }], params: [],
    eval: ({ in: x }) => {
      if (Array.isArray(x)) return { value: x.reduce((s, a) => s + a.pos, 0) / Math.max(1, x.length) };
      let s = 0, n = 0;
      for (const v of x.v) if (v === v) { s += v; n++; }
      return { value: n ? s / n : 0 };
    } },
  { type: 't.num', title: 'Number', group: G, ins: [], outs: [{ name: 'value', type: 'number' }], params: [{ key: 'value', type: 'number', default: 1 }],
    halo: () => 0, local: true, eval: (_i, p) => ({ value: p.value }) },
  { type: 't.sigIn', title: 'Signal in', group: G, ins: [{ name: 'signal', type: 'signal', required: true }], outs: [{ name: 'signal', type: 'signal' }], params: [],
    eval: ({ signal }) => ({ signal }) },
  { type: 't.reroute', title: 'Reroute', group: G, ins: [{ name: 'in', type: 'any', required: true }], outs: [{ name: 'out', type: 'any' }], params: [], halo: () => 0, local: true,
    eval: (i) => ({ out: i.in }) },
  { type: 't.bad', title: 'Bad', group: G, ins: [], outs: [S('script'), { name: 'spans', type: 'spans' }], params: [],
    eval: () => ({ script: [{ at: 20, pos: 50 }, { at: 10, pos: 120 }], spans: [{ t0: 9, t1: 3 }] }) },
  { type: 't.nan', title: 'NaN', group: G, ins: [], outs: [{ name: 'value', type: 'number' }], params: [], eval: () => ({ value: NaN }) },
  { type: 't.note', title: 'Note', group: G, ins: [S('script', { required: true })], outs: [S('script')], params: [],
    eval: ({ script }, _p, ctx) => { ctx.warn('careful'); ctx.info('fyi', { label: 'Set', kind: 'setParam', args: { key: 'x', value: 1 } }); return { script }; } },
  { type: 't.rng', title: 'Random', group: G, ins: [], outs: [S('script')], params: [{ key: 'seed', type: 'int', default: 0, seed: true }],
    eval: (_i, _p, ctx) => { const r = ctx.rng(); return { script: Array.from({ length: 50 }, (_, i) => ({ at: i * 100, pos: Math.round(r() * 100) })) }; } },
  { type: 't.ws', title: 'Where-set', group: G, ins: [S('script', { required: true })], outs: [S('script')], perSpan: true,
    params: [{ key: 'v', type: 'int', default: 10, min: 0, max: 100 }],
    eval: ({ script }, p, ctx) => {
      if (!ctx.where) return { script: mapPos(script, () => p.v) };
      return { script: script.map((a) => { const s = ctx.where.find((w) => a.at >= w.t0 && a.at < w.t1); return s ? { at: a.at, pos: ctx.paramsFor(s).v } : a; }) };
    } },
  { type: 't.spans', title: 'Spans', group: G, ins: [], outs: [{ name: 'spans', type: 'spans' }], params: [{ key: 'list', type: 'json', default: [] }],
    eval: (_i, p) => ({ spans: p.list }) },
  { type: 't.abort', title: 'Abort', group: G, ins: [S('script', { required: true })], outs: [S('script')], params: [],
    eval: ({ script }, _p, ctx) => { if (globalThis.__abortCtl) globalThis.__abortCtl.abort(); if (ctx.abort.aborted) throw ABORT; return { script }; } },
  { type: 't.undeclared', title: 'Undeclared', group: G, ins: [], outs: [S('script')], params: [], reads: () => [['axis', 'stroke']],
    eval: (_i, _p, ctx) => ({ script: ctx.read('axis', 'roll') }) },
  { type: 'sig.toScript', title: 'Signal → Script', group: G, ins: [{ name: 'signal', type: 'signal', required: true }], outs: [S('script')], params: [], eval: () => ({ script: [] }) },
  { type: 'out.axis', title: 'Output', group: G, ins: [S('script', { required: true }), { name: 'where', type: 'spans' }], outs: [S('result')],
    params: [{ key: 'axis', type: 'text', default: 'stroke' }], halo: () => 0, local: true, eval: ({ script }) => ({ result: script }) },
  { type: 'out.ghost', title: 'Ghost', group: G, ins: [S('script', { required: true })], outs: [S('result')], params: [{ key: 'name', type: 'text', default: '' }],
    halo: () => 0, local: true, eval: ({ script }) => ({ result: script }) },
];
const reg = createRegistry(DEFS);

const wave = (n, step = 100) => freeze(Array.from({ length: n }, (_, i) => ({ at: i * step, pos: i % 2 ? 90 : 10 })));
const sourcesOf = (axes) => ({ get: (kind, ref) => (kind === 'axis' ? axes[ref] : undefined), list: () => [] });

// build a graph from a compact spec: nodes [[name, type, params?]], links [[from, to, in?, out?]]
function build(nodes, links) {
  let g = emptyGraph({ name: 'T' });
  const id = {};
  for (const [name, type, params] of nodes) { const r = addNode(g, reg, type, { params }); g = r.graph; id[name] = r.id; }
  for (const [a, b, inp = 'script', out] of links) {
    const fromNode = g.nodes.find((n) => n.id === id[a]);
    const r = connect(g, reg, { from: id[a], out: out ?? reg.portsOf(fromNode, g).outs[0].name, to: id[b], in: inp });
    if (r.reason) throw new Error(`${a}->${b}: ${r.reason}`);
    g = r.graph;
  }
  return { g, id };
}
const run = (axes, cache = createCache(), extra = {}) => ({ sources: sourcesOf(axes), durationMs: 20000, cache, ...extra });
const statuses = (res, id) => Object.fromEntries(Object.entries(id).map(([k, v]) => [k, res.status.get(v)]));
const recomputed = (res) => [...res.status].filter(([, s]) => s === 'ok').map(([k]) => k).sort();

test('hashKey, stableJSON, tokenOf', () => {
  assert.equal(hashKey('a', 'b'), hashKey('a', 'b'));
  assert.notEqual(hashKey('ab', 'c'), hashKey('a', 'bc'));
  assert.notEqual(hashKey(1), hashKey('1'));
  assert.match(hashKey('x'), /^[0-9a-z]+$/);
  assert.equal(stableJSON({ b: 1, a: [1, { d: 2, c: undefined }] }), '{"a":[1,{"d":2}],"b":1}');
  assert.notEqual(stableJSON(NaN), stableJSON(null));
  assert.throws(() => stableJSON({ v: new Float32Array(1) }), /typed arrays/);
  const o = {};
  assert.equal(tokenOf(o), tokenOf(o));
  assert.notEqual(tokenOf(o), tokenOf({}));
  assert.equal(tokenOf(undefined), '∅');
  assert.equal(tokenOf('a'), '"a"');
  assert.notEqual(tokenOf(1), tokenOf('1'));
});

test('compile: deterministic topological order with id ties; outputs; structureKey ignores params', () => {
  const { g, id } = build([['s', 't.src'], ['a', 't.gain'], ['b', 't.offset'], ['o', 'out.axis']], [['s', 'a'], ['a', 'b'], ['b', 'o']]);
  const p = compile(g, reg);
  assert.deepEqual(p.order, [id.s, id.a, id.b, id.o]);
  assert.deepEqual(p.outputs, [id.o]);
  assert.deepEqual(p.diags, []);
  assert.equal(compile(setParams(g, reg, id.a, { k: 2 }), reg).structureKey, p.structureKey);
  // shuffled arrays give the same order
  const shuffled = { ...g, nodes: [...g.nodes].reverse(), links: [...g.links] };
  assert.deepEqual(compile(shuffled, reg).order, p.order);
  // ties: two independent sources are ordered by id
  const two = build([['x', 't.src'], ['y', 't.src']], []);
  assert.deepEqual(compile(two.g, reg).order, [two.id.x, two.id.y].sort());
});

test('compile: static diagnostics', () => {
  const { g, id } = build([['s', 't.src'], ['a', 't.gain'], ['o1', 'out.axis'], ['o2', 'out.axis'], ['m', 't.mix'], ['sh', 't.shift'], ['x', 'src.axis']],
    [['s', 'a'], ['a', 'o1'], ['x', 'o2'], ['s', 'sh']]);
  let bad = { ...g, nodes: [...g.nodes, { id: 'u1', type: 'gone.thing', tv: 1, x: 0, y: 0, params: { keep: 1 } }],
    links: [...g.links, { id: 'ld', from: 'nobody', out: 'script', to: id.a, in: 'where' }] };
  bad = setParams(bad, reg, id.a, {});
  bad = { ...bad, nodes: bad.nodes.map((n) => (n.id === id.a ? { ...n, params: { k: 9 } } : n)) };
  const diags = validate(bad, reg);
  const by = (code) => diags.filter((d) => d.code === code);
  assert.equal(by('unknown-type')[0].node, 'u1');
  assert.equal(by('dangling-link')[0].link, 'ld');
  assert.equal(by('missing-input')[0].id, `missing-input@${id.m}:a`);
  assert.equal(by('param')[0].fix.kind, 'setParam');
  assert.equal(by('param')[0].fix.args.value, 4);
  assert.deepEqual(by('output-collision').map((d) => d.node).sort(), [id.o1, id.o2].sort());
  assert.equal(by('self-reference')[0].node, id.o2);
  assert.deepEqual(by('self-reference')[0].fix, { label: 'Freeze source to ghost', kind: 'freezeSource', args: { node: id.x } });
  assert.equal(by('time-shift')[0].node, id.sh);
  assert.equal(by('time-shift')[0].severity, 'info');
  // muting one output removes the collision (param-dependent diags are recomputed by withGraph)
  const p = compile(bad, reg);
  const p2 = withGraph(p, setNodeProps(bad, id.o2, { muted: true }));
  assert.equal(p2.diags.filter((d) => d.code === 'output-collision').length, 0);
});

test('compile: cycles (files can lie) and type errors with an insertBefore fix', () => {
  const { g, id } = build([['s', 't.src'], ['a', 't.gain'], ['b', 't.gain'], ['c', 't.gain'], ['sig', 't.sig'], ['o', 'out.axis']],
    [['s', 'a'], ['a', 'b'], ['b', 'c'], ['c', 'o']]);
  const cyc = { ...g, links: [...g.links.filter((l) => l.to !== id.a), { id: 'lc', from: id.b, out: 'script', to: id.a, in: 'script' }, { id: 'lt', from: id.sig, out: 'signal', to: id.c, in: 'where' }] };
  // c.where does not exist (t.gain is not perSpan) -> dangling; use a real type error instead
  const typed = { ...cyc, links: cyc.links.filter((l) => l.id !== 'lt').concat({ id: 'lt2', from: id.sig, out: 'signal', to: id.o, in: 'script' }) };
  const p = compile(typed, reg);
  const codes = p.diags.map((d) => `${d.code}@${d.node ?? d.link}`);
  assert.ok(codes.includes(`cycle@${id.a}`) && codes.includes(`cycle@${id.b}`), codes.join());
  assert.ok(!codes.includes(`cycle@${id.c}`), 'downstream of a cycle is not on it');
  const t = p.diags.find((d) => d.code === 'type');
  assert.equal(t.link, 'lt2');
  assert.deepEqual(t.fix, { label: 'Insert "Signal → Script"', kind: 'insertBefore', args: { node: id.o, port: 'script', type: 'sig.toScript' } });
  assert.equal(p.order.length, 6);
  const res = evaluateSync(p, run({ stroke: wave(10) }), { targets: [id.o, id.c] });
  assert.equal(res.status.get(id.a), 'error');
  assert.equal(res.status.get(id.c), 'blocked');
  assert.equal(res.status.get(id.o), 'error', 'required input fed by a type-mismatched wire');
});

test('evaluate: values, a second run recomputes 0 nodes, summaries', async () => {
  const { g, id } = build([['s', 't.src'], ['a', 't.gain', { k: 0.5 }], ['b', 't.offset', { amount: 5 }], ['o', 'out.axis']], [['s', 'a'], ['a', 'b'], ['b', 'o']]);
  const p = compile(g, reg);
  const cache = createCache();
  const axes = { stroke: wave(5) };
  const r1 = await evaluate(p, run(axes, cache));
  assert.deepEqual(r1.values.get(`${id.o}:result`).map((a) => a.pos), [35, 75, 35, 75, 35]);
  assert.deepEqual(statuses(r1, id), { s: 'ok', a: 'ok', b: 'ok', o: 'ok' });
  assert.equal(r1.window, false);
  assert.deepEqual(r1.range, { t0: 0, t1: 20000 });
  const r2 = await evaluate(p, run(axes, cache));
  assert.deepEqual(recomputed(r2), []);
  assert.deepEqual(statuses(r2, id), { s: 'cached', a: 'cached', b: 'cached', o: 'cached' });
  assert.equal(r2.values.get(`${id.o}:result`), r1.values.get(`${id.o}:result`), 'same value object');
  assert.deepEqual(r2.keys, r1.keys);
  assert.ok(r2.stats.get(id.a).hit);
  assert.equal(nodeSummary(p, r1, id.o), '5 pts · 0:00–0:00 · 35–75');
});

test('evaluate: a param change recomputes exactly the downstream set', () => {
  const { g, id } = build(
    [['s', 't.src'], ['a', 't.gain'], ['b', 't.offset'], ['c', 't.smooth'], ['d', 't.gain'], ['e', 't.mix'], ['o1', 'out.axis'], ['o2', 'out.ghost']],
    [['s', 'a'], ['a', 'b'], ['b', 'c'], ['a', 'd'], ['c', 'e', 'a'], ['d', 'e', 'b'], ['e', 'o1'], ['d', 'o2']]);
  const cache = createCache();
  const axes = { stroke: wave(200) };
  const p = compile(g, reg);
  evaluateSync(p, run(axes, cache));
  for (const name of ['a', 'b', 'c', 'd']) {
    const key = name === 'b' ? 'amount' : name === 'c' ? 'w' : 'k';
    const cur = p.graph.nodes.find((n) => n.id === id[name]).params[key];
    const g2 = setParams(p.graph, reg, id[name], { [key]: cur + 1 });
    const res = evaluateSync(withGraph(p, g2), run(axes, cache));
    assert.deepEqual(recomputed(res), [id[name], ...downstreamOf(g2, [id[name]])].sort(), name);
    evaluateSync(p, run(axes, cache)); // back to the original: every node hits again
  }
  const back = evaluateSync(p, run(axes, cache));
  assert.deepEqual(recomputed(back), []);
});

test('evaluate: source identity: a new array recomputes, undo (old identity) hits', () => {
  const { g, id } = build([['s', 't.src'], ['a', 't.gain'], ['o', 'out.axis'], ['r', 't.src', { axis: 'roll' }], ['o2', 'out.ghost']], [['s', 'a'], ['a', 'o'], ['r', 'o2']]);
  const p = compile(g, reg);
  const cache = createCache();
  const v1 = wave(10), v2 = wave(12);
  const roll = wave(3);
  evaluateSync(p, run({ stroke: v1, roll }, cache));
  const r2 = evaluateSync(p, run({ stroke: v2, roll }, cache));
  assert.deepEqual(recomputed(r2), [id.s, id.a, id.o].sort(), 'the roll branch hits');
  const r3 = evaluateSync(p, run({ stroke: v1, roll }, cache));
  assert.deepEqual(recomputed(r3), [], 'undo hands back the old array: every node hits');
  const r4 = evaluateSync(p, run({ stroke: [...v1], roll }, cache));
  assert.deepEqual(recomputed(r4), [id.s, id.a, id.o].sort(), 'equal content, new array: a false miss only recomputes');
  assert.deepEqual(r4.values.get(`${id.o}:result`), r3.values.get(`${id.o}:result`));
});

test('evaluate: identical sub-chains share cache entries (ids never enter keys)', () => {
  const { g, id } = build([['s1', 't.src'], ['a1', 't.gain', { k: 2 }], ['s2', 't.src'], ['a2', 't.gain', { k: 2 }], ['o1', 'out.ghost'], ['o2', 'out.ghost']],
    [['s1', 'a1'], ['a1', 'o1'], ['s2', 'a2'], ['a2', 'o2']]);
  const res = evaluateSync(compile(g, reg), run({ stroke: wave(10) }));
  assert.equal(res.keys.get(id.a1), res.keys.get(id.a2));
  const st = [res.status.get(id.a1), res.status.get(id.a2)].sort();
  assert.deepEqual(st, ['cached', 'ok']);
});

test('evaluate: abort keeps finished entries cached and resolves with aborted', async () => {
  const { g, id } = build([['s', 't.src'], ['a', 't.gain'], ['x', 't.abort'], ['b', 't.offset'], ['o', 'out.axis']], [['s', 'a'], ['a', 'x'], ['x', 'b'], ['b', 'o']]);
  const p = compile(g, reg);
  const cache = createCache();
  const ctl = new AbortController();
  globalThis.__abortCtl = ctl;
  const r1 = await evaluate(p, run({ stroke: wave(10) }, cache, { abort: ctl.signal }));
  globalThis.__abortCtl = null;
  assert.equal(r1.aborted, true);
  assert.deepEqual(statuses(r1, id), { s: 'ok', a: 'ok', x: 'skipped', b: 'skipped', o: 'skipped' });
  const r2 = evaluateSync(p, run({ stroke: wave(10) }, cache));
  assert.equal(r2.status.get(id.s), 'ok', 'wave(10) is a new array, so the source misses');
  // pre-aborted signal: nothing runs
  const pre = new AbortController();
  pre.abort();
  const r3 = await evaluate(p, run({ stroke: wave(10) }, cache, { abort: pre.signal }));
  assert.equal(r3.aborted, true);
  assert.equal(r3.status.get(id.s), 'skipped');
  // a cached prefix survives an abort
  const axes = { stroke: wave(10) };
  const c2 = createCache();
  const ctl2 = new AbortController();
  globalThis.__abortCtl = ctl2;
  await evaluate(p, run(axes, c2, { abort: ctl2.signal }));
  globalThis.__abortCtl = null;
  const r4 = evaluateSync(compile(setParams(g, reg, id.b, { amount: 1 }), reg), run(axes, c2));
  assert.equal(r4.status.get(id.s), 'cached');
  assert.equal(r4.status.get(id.a), 'cached');
});

test('evaluate: a fault stays on its node; required dependants are blocked; optional inputs get undefined; independent outputs evaluate', () => {
  const { g, id } = build(
    [['s', 't.src'], ['x', 't.boom'], ['a', 't.gain'], ['m', 't.mix'], ['o1', 'out.axis'], ['o2', 'out.ghost'], ['o3', 'out.ghost', { name: 'mix' }]],
    [['s', 'x'], ['x', 'a'], ['a', 'o1'], ['s', 'o2'], ['s', 'm', 'a'], ['x', 'm', 'b'], ['m', 'o3']]);
  const res = evaluateSync(compile(g, reg), run({ stroke: wave(6) }));
  assert.deepEqual(statuses(res, id), { s: 'ok', x: 'error', a: 'blocked', m: 'ok', o1: 'blocked', o2: 'ok', o3: 'ok' });
  const thr = res.diags.find((d) => d.code === 'throw');
  assert.equal(thr.node, id.x);
  assert.equal(thr.message, 'boom');
  const up = res.diags.filter((d) => d.code === 'upstream');
  assert.deepEqual(up.map((d) => [d.node, d.origin, d.severity]).sort(), [[id.a, id.x, 'info'], [id.o1, id.x, 'info']].sort());
  assert.match(up[0].message, /waiting on "Boom"/);
  assert.deepEqual(res.values.get(`${id.o3}:result`), wave(6), 'mix with b undefined passes a');
  assert.ok(!res.values.has(`${id.x}:script`));
  // fixing the fault (param) makes everything ok
  const fixed = evaluateSync(compile(setParams(g, reg, id.x, { fail: false }), reg), run({ stroke: wave(6) }));
  assert.ok([...fixed.status.values()].every((s) => s === 'ok'));
});

test('evaluate: invalid outputs are repaired with a warning; a non-finite number is an error; undeclared reads throw', () => {
  const { g, id } = build([['b', 't.bad'], ['n', 't.nan'], ['u', 't.undeclared']], []);
  const res = evaluateSync(compile(g, reg), run({ stroke: wave(3) }), { targets: [id.b, id.n, id.u] });
  assert.equal(res.status.get(id.b), 'ok');
  assert.deepEqual(res.values.get(`${id.b}:script`), [{ at: 10, pos: 100 }, { at: 20, pos: 50 }]);
  assert.deepEqual(res.values.get(`${id.b}:spans`), [{ t0: 3, t1: 9 }]);
  assert.equal(res.diags.filter((d) => d.code === 'invalid-output' && d.node === id.b && d.severity === 'warn').length, 2);
  assert.equal(res.status.get(id.n), 'error');
  assert.match(res.diags.find((d) => d.node === id.n).message, /not finite/);
  assert.equal(res.status.get(id.u), 'error');
  assert.match(res.diags.find((d) => d.node === id.u).message, /not declared/);
});

test('evaluate: notes from ctx.warn/info are diagnostics, replayed on cache hits, with the node filled into fixes', () => {
  const { g, id } = build([['s', 't.src'], ['n', 't.note'], ['o', 'out.ghost']], [['s', 'n'], ['n', 'o']]);
  const p = compile(g, reg);
  const cache = createCache();
  const axes = { stroke: wave(3) };
  const r1 = evaluateSync(p, run(axes, cache));
  const r2 = evaluateSync(p, run(axes, cache));
  for (const r of [r1, r2]) {
    const notes = r.diags.filter((d) => d.code === 'note' && d.node === id.n);
    assert.deepEqual(notes.map((d) => [d.severity, d.message]), [['warn', 'careful'], ['info', 'fyi']]);
    assert.equal(notes[1].fix.args.node, id.n);
  }
  assert.equal(r2.status.get(id.n), 'cached');
});

test('evaluate: mute passes the bypass input; muted outputs are muted; a missing bypass blocks dependants', () => {
  const { g, id } = build([['s', 't.src'], ['a', 't.gain', { k: 0 }], ['o', 'out.axis'], ['s2', 't.src', { axis: 'roll' }], ['m', 't.mix'], ['o2', 'out.ghost'], ['n', 't.num'], ['sg', 't.sigIn'], ['o3', 'out.ghost']],
    [['s', 'a'], ['a', 'o'], ['s', 'm', 'a'], ['s2', 'm', 'b'], ['m', 'o2']]);
  const axes = { stroke: wave(4), roll: wave(4, 50) };
  let g2 = setNodeProps(g, id.a, { muted: true });
  g2 = setNodeProps(g2, id.m, { muted: true });
  const cache = createCache();
  const res = evaluateSync(compile(g2, reg), run(axes, cache));
  assert.equal(res.status.get(id.a), 'muted');
  assert.deepEqual(res.values.get(`${id.o}:result`), axes.stroke, 'muted gain passes its input');
  assert.deepEqual(res.values.get(`${id.o2}:result`), axes.roll, 'explicit bypass: mix passes b');
  const res2 = evaluateSync(compile(setNodeProps(g2, id.o, { muted: true }), reg), run(axes, cache));
  assert.equal(res2.status.get(id.o), 'muted');
  // mute key: muted node key differs from its unmuted key, and flipping back hits
  const k1 = res.keys.get(id.a);
  const un = evaluateSync(compile(g, reg), run(axes, cache));
  assert.notEqual(un.keys.get(id.a), k1);
  const again = evaluateSync(compile(g2, reg), run(axes, cache));
  assert.deepEqual(recomputed(again), []);
  // a muted mix whose bypass input b is not wired has no output -> its required dependant is blocked
  const h = build([['s', 't.src'], ['m', 't.mix'], ['a', 't.gain'], ['o', 'out.ghost']], [['s', 'm', 'a'], ['m', 'a'], ['a', 'o']]);
  const hr = evaluateSync(compile(setNodeProps(h.g, h.id.m, { muted: true }), reg), run(axes));
  assert.deepEqual(statuses(hr, h.id), { s: 'ok', m: 'muted', a: 'blocked', o: 'blocked' });
  assert.equal(hr.diags.find((d) => d.node === h.id.a && d.code === 'upstream').origin, h.id.m);
});

test('evaluate: adapters (sample, const), mod signal and mod number params, any resolution', () => {
  const { g, id } = build(
    [['s', 't.src'], ['thr', 't.thr', { above: 50 }], ['n', 't.num', { value: 30 }], ['sg', 't.sigIn'], ['rr', 't.reroute'], ['mean', 't.mean'], ['k', 't.num', { value: 0 }],
      ['gain', 't.gain'], ['off', 't.offset'], ['o', 'out.ghost'], ['o2', 'out.ghost']],
    [['s', 'thr', 'signal'], ['n', 'sg', 'signal'], ['s', 'rr', 'in'], ['rr', 'mean', 'in'], ['rr', 'gain'], ['k', 'gain', 'p:k'], ['gain', 'off'], ['n', 'off', 'p:amount'], ['off', 'o'], ['s', 'o2']]);
  const p = compile(g, reg);
  assert.equal(p.types.get(`${id.rr}:out`), 'script');
  assert.equal(p.adapters.size, 2);
  const axes = { stroke: freeze([{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, { at: 2000, pos: 0 }]) };
  const res = evaluateSync(p, run(axes), { targets: [id.thr, id.sg, id.mean, id.o, id.o2] });
  assert.deepEqual(res.values.get(`${id.thr}:spans`), [{ t0: 520, t1: 1500, kind: 'hi' }]);
  const sg = res.values.get(`${id.sg}:signal`);
  assert.equal(sg.dt, 20);
  assert.equal(sg.v.length, 1001);
  assert.ok(sg.v.every((v) => v === 30));
  assert.equal(res.values.get(`${id.mean}:value`), 100 / 3);
  // gain k driven by a number (0) -> everything at 50; offset amount linked to 30 (coerced) -> 80
  assert.deepEqual(res.values.get(`${id.o}:result`).map((a) => a.pos), [80, 80, 80]);
});

test('evaluate: mod signal param driven by a signal with NaN falls back to the stored constant', () => {
  const sigDef = { type: 't.ramp', title: 'Ramp', group: G, ins: [], outs: [{ name: 'signal', type: 'signal' }], params: [],
    eval: (_i, _p, ctx) => { const gr = ctx.grid(); const v = new Float32Array(gr.n); for (let k = 0; k < gr.n; k++) v[k] = (gr.i0 + k) * gr.dt < 1000 ? 2 : NaN; return { signal: { i0: gr.i0, dt: gr.dt, v } }; } };
  const r2 = createRegistry([...DEFS, sigDef]);
  let g = emptyGraph();
  const add = (t, params) => { const r = addNode(g, r2, t, { params }); g = r.graph; return r.id; };
  const s = add('t.src'), ramp = add('t.ramp'), gain = add('t.gain', { k: 0 }), o = add('out.ghost');
  for (const l of [[s, 'script', gain, 'script'], [ramp, 'signal', gain, 'p:k'], [gain, 'script', o, 'script']]) g = connect(g, r2, { from: l[0], out: l[1], to: l[2], in: l[3] }).graph;
  const res = evaluateSync(compile(g, r2), run({ stroke: freeze([{ at: 0, pos: 70 }, { at: 2000, pos: 70 }]) }));
  assert.deepEqual(res.values.get(`${o}:result`).map((a) => a.pos), [90, 50]);
});

test('evaluate: perSpan nodes get ctx.where (flattened) and ctx.paramsFor with byKind overrides', () => {
  const list = [{ t0: 0, t1: 250, kind: 'climax' }, { t0: 250, t1: 450, kind: 'oral' }, { t0: 100, t1: 150, kind: 'oral' }];
  let { g, id } = build([['s', 't.src'], ['sp', 't.spans', { list }], ['w', 't.ws', { v: 10 }], ['o', 'out.ghost']], [['s', 'w'], ['sp', 'w', 'where'], ['w', 'o']]);
  g = setByKind(g, reg, id.w, 'climax', { v: 99 });
  const res = evaluateSync(compile(g, reg), run({ stroke: wave(6) }));
  assert.deepEqual(res.values.get(`${id.o}:result`).map((a) => a.pos), [99, 10, 99, 10, 10, 90]);
});

test('evaluate: windowed runs are exact on the window; global ancestors run full and are cached', () => {
  const axes = { stroke: freeze(Array.from({ length: 4000 }, (_, i) => ({ at: i * 37, pos: (i * 7919) % 101 }))) };
  const { g, id } = build([['s', 't.src'], ['a', 't.gain', { k: 0.7 }], ['c', 't.smooth', { w: 300 }], ['c2', 't.smooth', { w: 150 }], ['o', 'out.axis'], ['sh', 't.shift', { ms: 10 }], ['c3', 't.smooth'], ['o2', 'out.ghost']],
    [['s', 'a'], ['a', 'c'], ['c', 'c2'], ['c2', 'o'], ['s', 'sh'], ['sh', 'c3'], ['c3', 'o2']]);
  const p = compile(g, reg);
  const cache = createCache();
  const full = evaluateSync(p, run(axes, cache, { durationMs: 150000 }));
  const range = { t0: 60000, t1: 80000 };
  const win = evaluateSync(p, run(axes, cache, { durationMs: 150000 }), { range });
  assert.equal(win.window, true);
  assert.deepEqual(win.range, range);
  const cut = (s) => s.filter((a) => a.at >= range.t0 && a.at <= range.t1);
  for (const o of [id.o, id.o2]) assert.deepEqual(cut(win.values.get(`${o}:result`)), cut(full.values.get(`${o}:result`)));
  assert.ok(win.values.get(`${id.o}:result`).length < 1000, 'the local chain ran on the window only');
  assert.notEqual(win.keys.get(id.o), full.keys.get(id.o), 'windowed keys carry the range');
  assert.equal(win.status.get(id.sh), 'cached', 'the global node reused its full-timeline value');
  assert.equal(win.keys.get(id.sh), full.keys.get(id.sh));
  // the same window again: all hits; full again: all hits (both pin slots)
  assert.deepEqual(recomputed(evaluateSync(p, run(axes, cache, { durationMs: 150000 }), { range })), []);
  assert.deepEqual(recomputed(evaluateSync(p, run(axes, cache, { durationMs: 150000 }))), []);
});

test('evaluate: targets pull only their ancestors; node:port targets work', () => {
  const { g, id } = build([['s', 't.src'], ['a', 't.gain'], ['b', 't.offset'], ['o', 'out.axis'], ['x', 't.boom']], [['s', 'a'], ['a', 'o'], ['s', 'b'], ['s', 'x']]);
  const res = evaluateSync(compile(g, reg), run({ stroke: wave(3) }), { targets: [`${id.a}:script`] });
  assert.deepEqual([...res.status.keys()].sort(), [id.s, id.a].sort());
  const def = evaluateSync(compile(g, reg), run({ stroke: wave(3) }));
  assert.ok(!def.status.has(id.b) && !def.status.has(id.x), 'default targets are the outputs');
});

test('evaluate: determinism (fresh caches give identical values) and seeded rng', () => {
  const { g, id } = build([['r', 't.rng', { seed: 42 }], ['a', 't.smooth'], ['o', 'out.ghost'], ['r2', 't.rng', { seed: 43 }], ['o2', 'out.ghost']], [['r', 'a'], ['a', 'o'], ['r2', 'o2']]);
  const p = compile(g, reg);
  const a = evaluateSync(p, run({}));
  const b = evaluateSync(compile(JSON.parse(JSON.stringify(g)), reg), run({}));
  assert.deepEqual([...a.values], [...b.values]);
  assert.deepEqual([...a.keys], [...b.keys]);
  assert.notDeepEqual(a.values.get(`${id.o2}:result`), a.values.get(`${id.r}:script`));
});

test('evaluate: deep-frozen graph and sources are never mutated', async () => {
  const { g, id } = build([['s', 't.src'], ['a', 't.gain', { k: 2 }], ['c', 't.smooth'], ['sp', 't.spans', { list: [{ t0: 0, t1: 300, kind: 'k' }] }], ['w', 't.ws'], ['m', 't.mix'], ['o', 'out.axis'], ['sig', 't.sig'], ['thr', 't.thr']],
    [['s', 'a'], ['a', 'c'], ['c', 'w'], ['sp', 'w', 'where'], ['w', 'm', 'a'], ['s', 'm', 'b'], ['m', 'o'], ['m', 'sig'], ['sig', 'thr', 'signal']]);
  freeze(g);
  const axes = freeze({ stroke: wave(30) });
  const snapshot = JSON.stringify(axes);
  const p = compile(g, reg);
  const res = await evaluate(p, run(axes), { targets: [id.o, id.thr] });
  assert.ok([...res.status.values()].every((s) => s === 'ok'), JSON.stringify([...res.status]));
  assert.equal(JSON.stringify(axes), snapshot);
  const win = evaluateSync(p, run(axes), { range: { t0: 500, t1: 1500 } });
  assert.ok([...win.status.values()].every((s) => s === 'ok'));
});

test('withGraph swaps params but refuses a structural change', () => {
  const { g, id } = build([['s', 't.src'], ['a', 't.gain'], ['o', 'out.axis']], [['s', 'a'], ['a', 'o']]);
  const p = compile(g, reg);
  assert.equal(withGraph(p, g), p);
  const p2 = withGraph(p, setParams(g, reg, id.a, { k: 3 }));
  assert.equal(p2.order, p.order);
  assert.equal(p2.nodes.get(id.a).node.params.k, 3);
  assert.throws(() => withGraph(p, addNode(g, reg, 't.src').graph), /structure/);
});

test('evaluate async equals evaluateSync, and yields when asked to', async () => {
  const { g } = build([['s', 't.src'], ['a', 't.gain'], ['b', 't.smooth'], ['o', 'out.axis']], [['s', 'a'], ['a', 'b'], ['b', 'o']]);
  const axes = { stroke: wave(500) };
  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  const r = await evaluate(compile(g, reg), run(axes, createCache(), { yieldMs: 0 }));
  clearInterval(timer);
  const s = evaluateSync(compile(g, reg), run(axes));
  assert.deepEqual([...r.values], [...s.values]);
  assert.ok(r.ms >= 0);
});

test('createCache: LRU against the byte budget, pinned keys survive, slots, stats', () => {
  const c = createCache({ budgetMB: 1 / 1024 }); // 1024 bytes
  c.set('a', { x: 1 }, 400);
  c.set('b', { x: 2 }, 400);
  c.pinOnly(['a'], 'full');
  c.set('c', { x: 3 }, 400);
  c.set('d', { x: 4 }, 400);
  c.pinOnly(['a'], 'full'); // the fresh entries c, d are now evictable: b goes first (LRU), then c
  assert.ok(c.get('a'));
  assert.equal(c.get('b'), undefined);
  const st = c.stats();
  assert.equal(st.pinnedBytes, 400);
  assert.ok(st.bytes - st.pinnedBytes <= 1024);
  c.pinOnly(['d'], 'window');
  assert.ok(c.has('a') && c.has('d'), 'two slots pin together');
  c.clear();
  assert.deepEqual(c.stats(), { entries: 0, bytes: 0, pinnedBytes: 0, hits: 0, misses: 0 });
});

test('a value too big for the budget still stays for the next run (pinned latest value)', () => {
  const { g } = build([['s', 't.src'], ['a', 't.gain'], ['o', 'out.axis']], [['s', 'a'], ['a', 'o']]);
  const p = compile(g, reg);
  const cache = createCache({ budgetMB: 0.001 });
  const axes = { stroke: wave(5000) };
  evaluateSync(p, run(axes, cache));
  assert.deepEqual(recomputed(evaluateSync(p, run(axes, cache))), []);
});

test('checkValue is applied to declared outputs only (extra keys are dropped)', () => {
  const extra = { type: 't.extra', title: 'Extra', group: G, ins: [], outs: [S('script')], params: [], eval: () => ({ script: [], junk: 5 }) };
  const r2 = createRegistry([extra]);
  const { graph, id } = addNode(emptyGraph(), r2, 't.extra');
  const res = evaluateSync(compile(graph, r2), run({}), { targets: [id] });
  assert.deepEqual([...res.values.keys()], [`${id}:script`]);
  assert.equal(checkValue('script', res.values.get(`${id}:script`)), '');
  assert.ok(Number.isNaN(signalAt({ i0: 0, dt: 20, v: new Float32Array(0) }, 0)));
});

// ---------------------------------------------------------------- regressions (review defects)

const EXTRA = [
  { type: 't.failSpans', title: 'Lost tracker', group: G, ins: [], outs: [{ name: 'spans', type: 'spans' }], params: [], eval: () => { throw new Error('run is gone'); } },
  { type: 't.failNum', title: 'Lost number', group: G, ins: [], outs: [{ name: 'value', type: 'number' }], params: [], eval: () => { throw new Error('gone'); } },
  { type: 't.badReads', title: 'Bad reads', group: G, ins: [], outs: [S('script')], params: [], reads: () => 5, eval: () => ({ script: [] }) },
  { type: 't.anyBad', title: 'Any bad', group: G, ins: [], outs: [{ name: 'out', type: 'any' }], params: [], eval: () => ({ out: [5] }) },
  { type: 't.slow', title: 'Slow', group: G, ins: [], outs: [S('script')], params: [], eval: () => { const t = performance.now(); while (performance.now() - t < 60); return { script: [] }; } },
  { type: 't.lspans', title: 'Local spans', group: G, ins: [], outs: [{ name: 'spans', type: 'spans' }], params: [{ key: 'list', type: 'json', default: [] }],
    halo: () => 0, local: true, eval: (_i, p) => ({ spans: p.list }) },
  // perSpan moving average whose window (and halo) comes from the span's params: base w can be 0, an override large
  { type: 't.wsmooth', title: 'Span smooth', group: G, ins: [S('script', { required: true })], outs: [S('script')], perSpan: true,
    params: [{ key: 'w', type: 'int', default: 0, min: 0, max: 5000 }], halo: (p) => p.w, local: true,
    eval: ({ script }, p, ctx) => ({ script: script.map((a) => {
      const s = ctx.where && ctx.where.find((x) => a.at >= x.t0 && a.at < x.t1);
      const w = (s ? ctx.paramsFor(s) : p).w;
      const near = script.filter((b) => Math.abs(b.at - a.at) <= w);
      return { at: a.at, pos: clampPos(near.reduce((t, b) => t + b.pos, 0) / near.length) };
    }) }) },
];
const reg2 = createRegistry([...DEFS, ...EXTRA]);
function build2(nodes, links) {
  let g = emptyGraph({ name: 'T' });
  const id = {};
  for (const [name, type, params] of nodes) { const r = addNode(g, reg2, type, { params }); g = r.graph; id[name] = r.id; }
  for (const [a, b, inp = 'script', out] of links) {
    const r = connect(g, reg2, { from: id[a], out: out ?? reg2.portsOf(g.nodes.find((n) => n.id === id[a]), g).outs[0].name, to: id[b], in: inp });
    if (r.reason) throw new Error(`${a}->${b}: ${r.reason}`);
    g = r.graph;
  }
  return { g, id };
}

test('regression: the run environment (durationMs, frameMs, media) is in every key; grids follow a duration change', () => {
  const { g, id } = build2([['s', 't.src'], ['n', 't.num', { value: 30 }], ['c', 't.sigIn'], ['a', 't.sigIn'], ['sg', 't.sig'], ['o', 'out.ghost']],
    [['n', 'c', 'signal'], ['s', 'a', 'signal'], ['s', 'sg'], ['s', 'o']]);
  const p = compile(g, reg2);
  const cache = createCache();
  const axes = { stroke: freeze([{ at: 0, pos: 0 }, { at: 70000, pos: 100 }]) };
  const targets = [id.c, id.a, id.sg, id.o];
  evaluateSync(p, run(axes, cache, { durationMs: 10000 }), { targets });
  const r = evaluateSync(p, run(axes, cache, { durationMs: 60000 }), { targets });
  for (const k of ['c', 'a', 'sg']) {
    assert.equal(r.status.get(id[k]), 'ok', `${k} recomputed`);
    assert.equal(r.values.get(`${id[k]}:${k === 'sg' ? 'signal' : 'signal'}`).v.length, 3001, `${k} covers the new timeline`);
  }
  // the same environment again hits; frameMs or media changes miss
  assert.deepEqual(recomputed(evaluateSync(p, run(axes, cache, { durationMs: 60000 }), { targets })), []);
  assert.notDeepEqual(recomputed(evaluateSync(p, run(axes, cache, { durationMs: 60000, frameMs: 40 }), { targets })), []);
  const media = { durationMs: 60000, fps: 25 };
  assert.notDeepEqual(recomputed(evaluateSync(p, run(axes, cache, { durationMs: 60000, frameMs: 40, media }), { targets })), []);
  assert.deepEqual(recomputed(evaluateSync(p, run(axes, cache, { durationMs: 60000, frameMs: 40, media: { ...media } }), { targets })), [], 'media is keyed by content');
  // a muted node's key follows the environment too
  const m = withGraph(p, setNodeProps(g, id.a, { muted: true }));
  const k1 = evaluateSync(m, run(axes, cache, { durationMs: 10000 }), { targets }).keys.get(id.a);
  assert.notEqual(evaluateSync(m, run(axes, cache, { durationMs: 60000 }), { targets }).keys.get(id.a), k1);
});

test('regression: hashKey mixes both bytes of every code unit', () => {
  assert.notEqual(hashKey('中'), hashKey('-N'));
  assert.notEqual(hashKey('Ā'), hashKey('\u0000\u0001'));
});

test('regression: a failed "where" gate or modulator blocks the node instead of reading as unconnected', () => {
  const { g, id } = build2([['s', 't.src'], ['f', 't.failSpans'], ['w', 't.ws', { v: 0 }], ['o', 'out.axis'], ['fn', 't.failNum'], ['k', 't.gain'], ['o2', 'out.ghost'],
    ['m', 't.mix'], ['b', 't.boom'], ['o3', 'out.ghost']],
  [['s', 'w'], ['f', 'w', 'where'], ['w', 'o'], ['s', 'k'], ['fn', 'k', 'p:k'], ['k', 'o2'], ['s', 'm', 'a'], ['s', 'b'], ['b', 'm', 'b'], ['m', 'o3']]);
  const res = evaluateSync(compile(g, reg2), run({ stroke: wave(6) }));
  assert.deepEqual(statuses(res, id), { s: 'ok', f: 'error', w: 'blocked', o: 'blocked', fn: 'error', k: 'blocked', o2: 'blocked', m: 'ok', b: 'error', o3: 'ok' });
  assert.equal(res.diags.find((d) => d.code === 'upstream' && d.node === id.w).origin, id.f);
  assert.equal(res.diags.find((d) => d.code === 'upstream' && d.node === id.k).origin, id.fn);
  assert.ok(!res.values.has(`${id.o}:result`), 'nothing to bake');
});

test('regression: the windowed halo covers byKind overrides (preview equals bake inside overridden spans)', () => {
  const axes = { stroke: freeze(Array.from({ length: 600 }, (_, i) => ({ at: i * 50, pos: (i * 7919) % 101 }))) };
  const list = [{ t0: 5000, t1: 25000, kind: 'climax' }];
  let { g, id } = build2([['s', 't.src'], ['sp', 't.lspans', { list }], ['w', 't.wsmooth', { w: 0 }], ['o', 'out.ghost']], [['s', 'w'], ['sp', 'w', 'where'], ['w', 'o']]);
  g = setByKind(g, reg2, id.w, 'climax', { w: 1000 });
  const p = compile(g, reg2);
  const full = evaluateSync(p, run(axes, createCache(), { durationMs: 30000 }));
  const range = { t0: 12000, t1: 13500 };
  const win = evaluateSync(p, run(axes, createCache(), { durationMs: 30000 }), { range });
  assert.ok(win.values.get(`${id.w}:script`).length < 200, 'the node really ran windowed');
  const cut = (s) => s.filter((a) => a.at >= range.t0 && a.at <= range.t1);
  assert.ok(cut(full.values.get(`${id.o}:result`)).length > 10);
  assert.deepEqual(cut(win.values.get(`${id.o}:result`)), cut(full.values.get(`${id.o}:result`)));
});


test('regression: throws outside def.eval (reads(), output typing, adapters) fail only their node', () => {
  const { g, id } = build2([['s', 't.src'], ['r', 't.badReads'], ['x', 't.anyBad'], ['a', 't.sigIn'], ['o', 'out.ghost']], [['s', 'a', 'signal'], ['s', 'o']]);
  const p = compile(g, reg2);
  const targets = [id.r, id.x, id.a, id.o];
  const res = evaluateSync(p, run({ stroke: wave(6) }), { targets });
  assert.deepEqual(statuses(res, { r: id.r, x: id.x, o: id.o }), { r: 'error', x: 'error', o: 'ok' });
  assert.ok(res.diags.some((d) => d.node === id.r && d.code === 'throw'));
  assert.ok(res.diags.some((d) => d.node === id.x && d.severity === 'error'));
  const huge = evaluateSync(p, run({ stroke: wave(6) }, createCache(), { durationMs: 1e15 }), { targets: [id.a, id.o] });
  assert.equal(huge.status.get(id.a), 'error', 'the adapter allocation failure stays on its node');
  assert.equal(huge.status.get(id.o), 'ok');
  assert.ok(huge.diags.some((d) => d.node === id.a && d.code === 'throw'));
});

test('regression: a node that runs long in one piece gets an info "slow" diagnostic', () => {
  const { graph, id } = addNode(emptyGraph(), reg2, 't.slow');
  const res = evaluateSync(compile(graph, reg2), run({}), { targets: [id] });
  const d = res.diags.find((x) => x.code === 'slow');
  assert.equal(d?.node, id);
  assert.equal(d.severity, 'info');
});
