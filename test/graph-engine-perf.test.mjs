// lib/graph performance (DESIGN.md §6.6): a seeded 100 000-action, 10-minute script through a 30-node graph.
// Asserts cold < 2 s, warm (all hits) < 5 ms, one param change with a cheap 6-node downstream suffix < 100 ms full,
// and the same change as a windowed (60 s view) preview < 20 ms. Prints the timings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, emptyGraph, addNode, connect, setParams } from '../src/lib/graph/model.js';
import { compile, withGraph, createCache, evaluate, evaluateSync } from '../src/lib/graph/eval.js';
import { clipScript, sampleScript } from '../src/lib/graph/types.js';
import { clampPos } from '../src/lib/core/script.js';
import { mulberry32 } from '../src/lib/gen/util.js';
import { budget } from './perf.mjs';

const S = (name, extra = {}) => ({ name, type: 'script', ...extra });
const G = 'Perf';
const mapPos = (s, f) => { const out = new Array(s.length); for (let i = 0; i < s.length; i++) out[i] = { at: s[i].at, pos: clampPos(f(s[i])) }; return out; };
const reg = createRegistry([
  { type: 'p.src', title: 'Source', group: G, ins: [], outs: [S('script')], params: [{ key: 'axis', type: 'text', default: 'stroke' }],
    reads: (p) => [['axis', p.axis]], halo: () => 0, local: true,
    eval: (_i, p, ctx) => { const s = ctx.read('axis', p.axis) || []; return { script: ctx.window ? clipScript(s, ctx.range.t0, ctx.range.t1) : s }; } },
  { type: 'p.gain', title: 'Gain', group: G, ins: [S('script', { required: true })], outs: [S('script')],
    params: [{ key: 'k', type: 'number', default: 1, min: 0, max: 3, mod: 'signal' }], halo: () => 0, local: true,
    eval: ({ script }, _p, ctx) => { const k = ctx.param('k'); return { script: mapPos(script, (a) => 50 + (a.pos - 50) * k(a.at)) }; } },
  { type: 'p.offset', title: 'Offset', group: G, ins: [S('script', { required: true })], outs: [S('script')],
    params: [{ key: 'amount', type: 'number', default: 0, min: -50, max: 50 }], halo: () => 0, local: true,
    eval: ({ script }, p) => ({ script: mapPos(script, (a) => a.pos + p.amount) }) },
  { type: 'p.smooth', title: 'Smooth', group: G, ins: [S('script', { required: true })], outs: [S('script')],
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
  { type: 'p.sig', title: 'Sample', group: G, ins: [S('script', { required: true })], outs: [{ name: 'signal', type: 'signal' }], params: [], halo: () => 0, local: true,
    eval: ({ script }, _p, ctx) => ({ signal: sampleScript(script, ctx.grid()) }) },
  { type: 'p.thr', title: 'Threshold', group: G, ins: [{ name: 'signal', type: 'signal', required: true }], outs: [{ name: 'spans', type: 'spans' }],
    params: [{ key: 'above', type: 'number', default: 50 }], halo: () => 0, local: true,
    eval: ({ signal }, p) => {
      const out = [];
      let start = null;
      for (let k = 0; k <= signal.v.length; k++) {
        const on = k < signal.v.length && signal.v[k] > p.above, t = (signal.i0 + k) * signal.dt;
        if (on && start === null) start = t;
        if (!on && start !== null) { out.push({ t0: start, t1: t }); start = null; }
      }
      return { spans: out };
    } },
  { type: 'out.axis', title: 'Output', group: G, ins: [S('script', { required: true })], outs: [S('result')], params: [{ key: 'axis', type: 'text', default: 'stroke' }],
    halo: () => 0, local: true, eval: ({ script }) => ({ result: script }) },
  { type: 'out.ghost', title: 'Ghost', group: G, ins: [S('script', { required: true })], outs: [S('result')], params: [], halo: () => 0, local: true, eval: ({ script }) => ({ result: script }) },
]);

function bigScript(n = 100000, durationMs = 600000) {
  const rnd = mulberry32(7);
  const step = durationMs / n;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = Object.freeze({ at: Math.round(i * step), pos: i % 2 ? 60 + Math.floor(rnd() * 40) : Math.floor(rnd() * 40) });
  return Object.freeze(out);
}

function buildGraph() {
  let g = emptyGraph({ name: 'perf' });
  const add = (type, params) => { const r = addNode(g, reg, type, { params }); g = r.graph; return r.id; };
  const link = (from, out, to, inp = 'script') => { const r = connect(g, reg, { from, out, to, in: inp }); if (r.reason) throw new Error(r.reason); g = r.graph; };
  const src = add('p.src');
  const chain = [src];
  const types = ['p.gain', 'p.offset', 'p.smooth'];
  for (let i = 0; i < 23; i++) {
    const t = types[i % 3];
    const id = add(t, t === 'p.gain' ? { k: 1.01 } : t === 'p.offset' ? { amount: i % 2 ? 1 : -1 } : { w: 120 });
    link(chain[chain.length - 1], 'script', id);
    chain.push(id);
  }
  const out = add('out.axis');
  link(chain[chain.length - 1], 'script', out);
  const ghost = add('out.ghost');
  link(chain[10], 'script', ghost);
  const sig = add('p.sig');
  link(chain[12], 'script', sig);
  const thr = add('p.thr');
  link(sig, 'signal', thr, 'signal');
  const ghost2 = add('out.ghost');
  link(chain[5], 'script', ghost2);
  const sig2 = add('p.sig');
  link(src, 'script', sig2);
  return { g, chain, targets: [out, ghost, ghost2, thr, sig2] };
}

test('performance: 30 nodes, 100 000 actions, single param change', async () => {
  const axes = { stroke: bigScript() };
  const sources = { get: (k, ref) => (k === 'axis' ? axes[ref] : undefined), list: () => [] };
  const { g, chain, targets } = buildGraph();
  assert.equal(g.nodes.length, 30);
  const cache = createCache({ budgetMB: 256 });
  const run = { sources, durationMs: 600000, cache };
  const t = (fn) => { const a = performance.now(); const r = fn(); return [performance.now() - a, r]; };

  const [tCompile, p] = t(() => compile(g, reg));
  const [tCold, cold] = t(() => evaluateSync(p, run, { targets }));
  assert.ok([...cold.status.values()].every((s) => s === 'ok'));
  // timed cases take the best of 3 so a busy machine (the full suite runs files in parallel) does not fail them
  const best = (n, fn) => { let m = Infinity, r; for (let i = 0; i < n; i++) { const [ms, x] = t(() => fn(i)); if (ms < m) m = ms; r = x; } return [m, r]; };
  const [tWarm, warm] = best(3, () => evaluateSync(p, run, { targets }));
  assert.ok([...warm.status.values()].every((s) => s === 'cached'));

  // one param change with 6 cheap nodes downstream of it (chain[19] .. chain[23] + out.axis)
  const changed = chain[18];
  let g2, p2;
  const [tSwap] = t(() => withGraph(p, setParams(g, reg, changed, { k: 1.2 })));
  const [tChange, inc] = best(3, (i) => { g2 = setParams(g, reg, changed, { k: 1.2 + i / 100 }); p2 = withGraph(p, g2); return evaluateSync(p2, run, { targets }); });
  const recomputed = [...inc.status].filter(([, s]) => s === 'ok').length;
  assert.equal(recomputed, 7, 'the changed node and its 6 downstream nodes');

  // windowed preview of a 60 s view: warm the window once, then the same param change again
  const range = { t0: 300000, t1: 360000 };
  const [tWinCold] = t(() => evaluateSync(p2, run, { targets, range }));
  const [tWin, win] = best(3, (i) => evaluateSync(withGraph(p2, setParams(g2, reg, changed, { k: 1.3 + i / 100 })), run, { targets, range }));
  assert.equal([...win.status].filter(([, s]) => s === 'ok').length, 7);

  // the async evaluate (yielding every 8 ms) on a cold cache, for reference
  const a0 = performance.now();
  const asyncRes = await evaluate(compile(g, reg), { sources, durationMs: 600000, cache: createCache({ budgetMB: 256 }) }, { targets });
  const tAsync = performance.now() - a0;
  assert.equal(asyncRes.aborted, false);

  const per = (tWarm / 30).toFixed(3);
  console.log(`[graph-engine perf] compile ${tCompile.toFixed(1)} ms | cold ${tCold.toFixed(1)} ms | warm ${tWarm.toFixed(2)} ms (${per} ms/node) | `
    + `withGraph ${tSwap.toFixed(2)} ms | param change full ${tChange.toFixed(1)} ms (${recomputed} nodes) | window cold ${tWinCold.toFixed(1)} ms | `
    + `param change windowed ${tWin.toFixed(1)} ms | async cold ${tAsync.toFixed(1)} ms`);
  budget(tCold < 2000, `cold ${tCold} ms`);
  budget(tWarm < 5, `warm ${tWarm} ms`);
  budget(tChange < 100, `param change ${tChange} ms`);
  budget(tWin < 20, `windowed ${tWin} ms`);
});
