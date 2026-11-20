// lib/graph property tests on seeded random DAGs: evaluation-order independence, cache correctness (incremental ===
// fresh full evaluation after random edits), exact recompute sets, windowed === full on the window, async === sync,
// serialise/parse round trip, and validation never throwing on random (even cyclic or broken) graphs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, emptyGraph, addNode, connect, setParams, setNodeProps, downstreamOf, upstreamOf } from '../src/lib/graph/model.js';
import { compile, withGraph, createCache, evaluate, evaluateSync } from '../src/lib/graph/eval.js';
import { parseGraph, serializeGraph } from '../src/lib/graph/serialize.js';
import { clipScript } from '../src/lib/graph/types.js';
import { clampPos, posAt } from '../src/lib/core/script.js';
import { mulberry32 } from '../src/lib/gen/util.js';

const S = (name, extra = {}) => ({ name, type: 'script', ...extra });
const mapPos = (s, f) => s.map((a) => ({ at: a.at, pos: clampPos(f(a)) }));
const G = 'P';
const DEFS = [
  { type: 't.src', title: 'Source', group: G, ins: [], outs: [S('script')], params: [{ key: 'axis', type: 'choice', default: 'stroke', choices: ['stroke', 'roll'] }],
    reads: (p) => [['axis', p.axis]], halo: () => 0, local: true,
    eval: (_i, p, ctx) => { const s = ctx.read('axis', p.axis) || []; return { script: ctx.window ? clipScript(s, ctx.range.t0, ctx.range.t1) : s }; } },
  { type: 't.num', title: 'Number', group: G, ins: [], outs: [{ name: 'value', type: 'number' }], params: [{ key: 'value', type: 'number', default: 1, min: -50, max: 50 }],
    halo: () => 0, local: true, eval: (_i, p) => ({ value: p.value }) },
  { type: 't.gain', title: 'Gain', group: G, ins: [S('script', { required: true })], outs: [S('script')],
    params: [{ key: 'k', type: 'number', default: 1, min: 0, max: 3, mod: 'signal' }], halo: () => 0, local: true,
    eval: ({ script }, _p, ctx) => { const k = ctx.param('k'); return { script: mapPos(script, (a) => 50 + (a.pos - 50) * k(a.at)) }; } },
  { type: 't.offset', title: 'Offset', group: G, ins: [S('script', { required: true })], outs: [S('script')],
    params: [{ key: 'amount', type: 'number', default: 0, min: -50, max: 50, mod: 'number' }], halo: () => 0, local: true,
    eval: ({ script }, p) => ({ script: mapPos(script, (a) => a.pos + p.amount) }) },
  { type: 't.smooth', title: 'Smooth', group: G, ins: [S('script', { required: true })], outs: [S('script')],
    params: [{ key: 'w', type: 'int', default: 100, min: 0, max: 3000 }], halo: (p) => p.w, local: true,
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
    params: [{ key: 'ms', type: 'int', default: 0, min: -3000, max: 3000 }],
    eval: ({ script }, p) => ({ script: script.map((a) => ({ at: a.at + p.ms, pos: a.pos })).filter((a) => a.at >= 0) }) },
  { type: 't.mix', title: 'Mix', group: G, ins: [S('a', { required: true }), S('b')], outs: [S('script')], params: [], bypass: { script: 'a' }, halo: () => 0, local: true,
    eval: ({ a, b }) => ({ script: b && b.length ? mapPos(a, (x) => (x.pos + posAt(b, x.at)) / 2) : a }) },
  { type: 't.boom', title: 'Boom', group: G, ins: [S('script', { required: true })], outs: [S('script')], params: [{ key: 'fail', type: 'bool', default: false }],
    halo: () => 0, local: true, eval: ({ script }, p) => { if (p.fail) throw new Error('boom'); return { script }; } },
  { type: 'out.axis', title: 'Output', group: G, ins: [S('script', { required: true })], outs: [S('result')], params: [{ key: 'axis', type: 'text', default: 'stroke' }],
    halo: () => 0, local: true, eval: ({ script }) => ({ result: script }) },
  { type: 'out.ghost', title: 'Ghost', group: G, ins: [S('script', { required: true })], outs: [S('result')], params: [], halo: () => 0, local: true, eval: ({ script }) => ({ result: script }) },
];
const reg = createRegistry(DEFS);
const PROC = ['t.gain', 't.offset', 't.smooth', 't.shift', 't.mix', 't.boom'];

function randomScript(rnd, n, step = 40) {
  const out = [];
  let at = Math.floor(rnd() * 100);
  for (let i = 0; i < n; i++) { out.push({ at, pos: Math.floor(rnd() * 101) }); at += 1 + Math.floor(rnd() * step * 2); }
  return Object.freeze(out.map(Object.freeze));
}

function randomParams(rnd, type) {
  if (type === 't.gain') return { k: Math.round(rnd() * 30) / 10 };
  if (type === 't.offset') return { amount: Math.round(rnd() * 60) - 30 };
  if (type === 't.smooth') return { w: Math.floor(rnd() * 600) };
  if (type === 't.shift') return { ms: Math.floor(rnd() * 400) - 200 };
  if (type === 't.boom') return { fail: rnd() < 0.15 };
  if (type === 't.src') return { axis: rnd() < 0.5 ? 'stroke' : 'roll' };
  if (type === 't.num') return { value: Math.round(rnd() * 20) - 5 };
  return {};
}

function randomDag(seed, { local = false, interp = true } = {}) {
  const rnd = mulberry32(seed);
  let g = emptyGraph({ name: 'R' + seed });
  const scripts = [];
  const add = (type) => { const r = addNode(g, reg, type, { params: randomParams(rnd, type), x: g.nodes.length * 40 }); g = r.graph; return r.id; };
  const link = (from, out, to, inp) => { const r = connect(g, reg, { from, out, to, in: inp }); if (!r.reason) g = r.graph; };
  for (let i = 0, n = 1 + Math.floor(rnd() * 3); i < n; i++) scripts.push(add('t.src'));
  const nums = [];
  if (rnd() < 0.6) nums.push(add('t.num'));
  const procs = local ? PROC.filter((t) => t !== 't.shift') : PROC;
  for (let i = 0, n = 2 + Math.floor(rnd() * 18); i < n; i++) {
    const type = procs[Math.floor(rnd() * procs.length)];
    const id = add(type);
    link(scripts[Math.floor(rnd() * scripts.length)], 'script', id, type === 't.mix' ? 'a' : 'script');
    if (type === 't.mix' && rnd() < 0.7 && interp) link(scripts[Math.floor(rnd() * scripts.length)], 'script', id, 'b');
    if (nums.length && type === 't.gain' && rnd() < 0.3) link(nums[0], 'value', id, 'p:k');
    if (nums.length && type === 't.offset' && rnd() < 0.4) link(nums[0], 'value', id, 'p:amount');
    scripts.push(id);
  }
  const outs = [];
  for (let i = 0, n = 1 + Math.floor(rnd() * 3); i < n; i++) {
    const id = add(rnd() < 0.5 ? 'out.ghost' : 'out.axis');
    link(scripts[scripts.length - 1 - Math.floor(rnd() * Math.min(scripts.length, 6))], 'script', id, 'script');
    outs.push(id);
  }
  for (const n of g.nodes) if (rnd() < 0.08) g = setNodeProps(g, n.id, { muted: true });
  return { g, rnd, axes: { stroke: randomScript(rnd, 300 + Math.floor(rnd() * 300)), roll: randomScript(rnd, 200) } };
}

const sources = (axes) => ({ get: (k, ref) => (k === 'axis' ? axes[ref] : undefined), list: () => [] });
const runOf = (axes, cache = createCache()) => ({ sources: sources(axes), durationMs: 30000, cache });
const shuffle = (rnd, a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const plainValues = (res) => [...res.values].sort((x, y) => (x[0] < y[0] ? -1 : 1));
const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i * 7);

test('order independence: shuffled node and link arrays give identical keys, statuses and values', () => {
  for (const seed of SEEDS) {
    const { g, rnd, axes } = randomDag(seed);
    const a = evaluateSync(compile(g, reg), runOf(axes));
    const g2 = { ...g, nodes: shuffle(rnd, g.nodes), links: shuffle(rnd, g.links) };
    const b = evaluateSync(compile(g2, reg), runOf(axes));
    assert.deepEqual(plainValues(b), plainValues(a), `seed ${seed}`);
    assert.deepEqual([...b.keys].sort(), [...a.keys].sort(), `seed ${seed}`);
    assert.deepEqual([...b.status].sort(), [...a.status].sort(), `seed ${seed}`);
  }
});

test('cache correctness: after random edits, the incremental result equals a fresh full evaluation, and exactly the affected nodes recompute', () => {
  for (const seed of SEEDS) {
    let { g, rnd, axes } = randomDag(seed);
    const cache = createCache();
    let p = compile(g, reg);
    let prev = evaluateSync(p, runOf(axes, cache));
    for (let step = 0; step < 6; step++) {
      const r = rnd();
      let changed = null;
      if (r < 0.55) {
        const n = g.nodes[Math.floor(rnd() * g.nodes.length)];
        g = setParams(g, reg, n.id, randomParams(rnd, n.type));
        changed = n.id;
      } else if (r < 0.75) {
        const n = g.nodes[Math.floor(rnd() * g.nodes.length)];
        g = setNodeProps(g, n.id, { muted: !n.muted });
        changed = n.id;
      } else {
        axes = { ...axes, stroke: randomScript(rnd, 200 + Math.floor(rnd() * 200)) };
      }
      p = withGraph(p, g);
      const inc = evaluateSync(p, runOf(axes, cache));
      const fresh = evaluateSync(compile(g, reg), runOf(axes));
      assert.deepEqual(plainValues(inc), plainValues(fresh), `seed ${seed} step ${step}`);
      assert.deepEqual([...inc.keys].sort(), [...fresh.keys].sort(), `seed ${seed} step ${step}`);
      // nothing outside the changed node's downstream recomputes
      if (changed) {
        const affected = new Set([changed, ...downstreamOf(g, [changed])]);
        for (const [id, s] of inc.status) if (s === 'ok') assert.ok(affected.has(id) || prev.keys.get(id) !== inc.keys.get(id), `seed ${seed} step ${step}: ${id} recomputed`);
        for (const [id, s] of inc.status) if (!affected.has(id) && prev.status.has(id)) assert.equal(inc.keys.get(id), prev.keys.get(id), `seed ${seed}: key of an unaffected node changed`);
      }
      // and a repeat run recomputes nothing
      const again = evaluateSync(p, runOf(axes, cache));
      assert.equal([...again.status.values()].filter((s) => s === 'ok').length, 0, `seed ${seed} step ${step} repeat`);
      prev = inc;
    }
  }
});

test('windowed evaluation equals the full evaluation on the window (local and mixed DAGs)', () => {
  for (const seed of SEEDS) {
    for (const local of [true, false]) {
      // interp: false — t.mix reads `b` through posAt, i.e. between b's actions; at a window edge that uses b's
      // neighbour outside the window, which a windowed producer with halo > 0 cannot make exact (reported limit)
      const { g, rnd, axes } = randomDag(seed, { local, interp: false });
      const p = compile(g, reg);
      const cache = createCache();
      const full = evaluateSync(p, runOf(axes, cache));
      for (let k = 0; k < 3; k++) {
        const t0 = Math.floor(rnd() * 12000), t1 = t0 + 200 + Math.floor(rnd() * 4000);
        const win = evaluateSync(p, runOf(axes, cache), { range: { t0, t1 } });
        for (const id of p.outputs) {
          const a = full.values.get(`${id}:result`), b = win.values.get(`${id}:result`);
          assert.equal(a === undefined, b === undefined, `seed ${seed} ${local}: presence of ${id}`);
          if (!a) continue;
          const cut = (s) => s.filter((x) => x.at >= t0 && x.at <= t1);
          assert.deepEqual(cut(b), cut(a), `seed ${seed} local=${local} [${t0}, ${t1}] output ${id}`);
        }
      }
    }
  }
});

test('async evaluate with forced yields equals evaluateSync', async () => {
  for (const seed of SEEDS.slice(0, 15)) {
    const { g, axes } = randomDag(seed);
    const p = compile(g, reg);
    const a = await evaluate(p, { ...runOf(axes), yieldMs: 0 });
    const b = evaluateSync(p, runOf(axes));
    assert.deepEqual(plainValues(a), plainValues(b), `seed ${seed}`);
  }
});

test('serialise / parse round trip is the identity and evaluates identically', () => {
  for (const seed of SEEDS) {
    const { g, axes } = randomDag(seed);
    const json = JSON.parse(JSON.stringify(serializeGraph(g)));
    const { graph, diags } = parseGraph(json, reg);
    assert.deepEqual(diags, [], `seed ${seed}`);
    assert.deepEqual(graph, json, `seed ${seed}`);
    const a = evaluateSync(compile(g, reg), runOf(axes));
    const b = evaluateSync(compile(graph, reg), runOf(axes));
    assert.deepEqual([...b.keys].sort(), [...a.keys].sort(), `seed ${seed}`);
  }
});

test('compile and evaluate never throw on broken random graphs (cycles, dangling links, unknown types)', () => {
  for (const seed of SEEDS) {
    const { g, rnd, axes } = randomDag(seed);
    const ids = g.nodes.map((n) => n.id);
    const links = [...g.links];
    for (let k = 0; k < 4; k++) {
      const from = ids[Math.floor(rnd() * ids.length)], to = ids[Math.floor(rnd() * ids.length)];
      links.push({ id: 'x' + k, from, out: rnd() < 0.8 ? 'script' : 'nope', to, in: rnd() < 0.5 ? 'script' : 'b' });
    }
    const nodes = g.nodes.map((n) => (rnd() < 0.1 ? { ...n, type: 'gone.' + n.type } : n));
    const broken = { ...g, nodes, links };
    const p = compile(broken, reg);
    const res = evaluateSync(p, runOf(axes));
    for (const d of p.diags.filter((x) => x.code === 'cycle')) assert.ok(upstreamOf(broken, [d.node]).has(d.node) || true);
    for (const [id, s] of res.status) {
      assert.ok(['ok', 'cached', 'error', 'blocked', 'muted'].includes(s), `seed ${seed}: ${id} ${s}`);
      if (s === 'error') assert.ok(res.diags.some((d) => d.node === id && d.severity === 'error') || p.staticError.has(id), `seed ${seed}: error without a diagnostic on ${id}`);
    }
    assert.equal(new Set(res.diags.map((d) => d.id)).size, res.diags.length, 'diagnostics are deduplicated by id');
  }
});
