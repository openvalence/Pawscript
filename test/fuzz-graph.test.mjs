// Fuzz tests for lib/graph: random valid DAGs over every registered node type (compile/evaluate never throw, errors are
// clean diagnostics, script outputs are valid, evaluation is deterministic, serialise round trips), and edit ops through the
// graph with random params and several spans equal the sequential direct calls.
// Seeded (mulberry32). FUZZ_SEEDS=n scales the number of random graphs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValid } from '../src/lib/core/script.js';
import { mulberry32, hashSeed } from '../src/lib/gen/util.js';
import { OPS } from '../src/lib/edit/index.js';
import { emptyGraph, addNode, planLink, connect } from '../src/lib/graph/model.js';
import { compile, evaluateSync, createCache, validate } from '../src/lib/graph/eval.js';
import { parseGraph, serializeGraph } from '../src/lib/graph/serialize.js';
import { atsToSpans } from '../src/lib/graph/types.js';
import { EXCLUDED_OPS, TIME_SHIFT_OPS } from '../src/lib/graph/nodes/index.js';
import { normalizeValues } from '../src/ui/kit/params.js';
import { testRegistry, makeSnapshot, sourcesOf, randomScript, randomSignal, randomSpans, buildGraph, run, DUR } from './graph-nodes-fixtures.mjs';

const SEEDS = Number(process.env.FUZZ_SEEDS) || 60;
const J = (x) => JSON.stringify(x);
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const reg = testRegistry();
const snap = makeSnapshot(7);
const FX_ALL = { script: snap.axes.stroke, signal: randomSignal(mulberry32(3)), spans: randomSpans(mulberry32(4)), number: 3 };
const FXKEY = { 'fx.script': 'script', 'fx.signal': 'signal', 'fx.spans': 'spans', 'fx.number': 'number' };
const TYPES = reg.list().map((d) => d.type);

function randomParams(def, rng) {
  const p = {};
  for (const q of def.params) {
    if (q.seed || q.hidden || q.type === 'text' || rng() < 0.3) continue;
    if (q.type === 'number' || q.type === 'int' || q.type === 'float') {
      const lo = Math.max(q.min ?? -2000, -2000), hi = Math.min(q.max ?? 2000, 2000);
      const v = lo + rng() * (hi - lo);
      p[q.key] = q.type === 'int' ? Math.round(v) : v;
    } else if (q.type === 'bool') p[q.key] = rng() < 0.5;
    else if (q.type === 'choice') { const c = q.choices || []; const x = c[Math.floor(rng() * c.length)]; p[q.key] = x && typeof x === 'object' ? x.value : x; }
  }
  return p;
}

/** Grow a random DAG: each new node's required (and some optional) inputs are wired from earlier nodes through planLink. */
function randomGraph(rng, size) {
  let g = emptyGraph({ rate: 50 });
  const ids = [];
  for (let k = 0; k < size; k++) {
    const type = k < 2 ? pick(rng, ['fx.script', 'fx.signal', 'fx.spans', 'fx.number']) : pick(rng, TYPES);
    const def = reg.get(type);
    const params = FXKEY[type] ? { key: FXKEY[type] } : type === 'src.ghost' ? { ghost: 'g1' } : type === 'src.run' ? { run: 'run1' } : randomParams(def, rng);
    const r = addNode(g, reg, type, { params });
    g = r.graph;
    const to = r.id, ports = reg.portsOf(g.nodes.find((n) => n.id === to), g);
    for (const inp of ports.ins) {
      if (!inp.required && rng() < 0.5) continue;
      const cands = ids.flatMap((from) => reg.portsOf(g.nodes.find((n) => n.id === from), g).outs.map((o) => ({ from, out: o.name }))).sort(() => rng() - 0.5);
      for (const c of cands) {
        if (!planLink(g, reg, { ...c, to, in: inp.name }).ok) continue;
        g = connect(g, reg, { ...c, to, in: inp.name }).graph;
        break;
      }
    }
    ids.push(to);
  }
  return g;
}
const BAD_MSG = /TypeError|ReferenceError|RangeError|is not a function|Cannot read|Cannot destructure|is not iterable|undefined|NaN|not defined|Maximum call stack|Invalid array length/;
const evaluate = (g, cache = createCache()) => {
  snap.fx = FX_ALL;
  const program = compile(g, reg);
  return { program, res: evaluateSync(program, { sources: sourcesOf(snap), durationMs: snap.durationMs, media: snap.media, frameMs: snap.frameMs, cache }, { targets: g.nodes.map((n) => n.id) }) };
};
const scripts = (res) => [...res.values].filter(([, v]) => Array.isArray(v) && v.length && 'at' in v[0] && 'pos' in v[0]);

test('fuzz graph: random valid DAGs evaluate without throwing; failures are clean diagnostics; script outputs valid', () => {
  for (let seed = 0; seed < SEEDS * 3; seed++) {
    const rng = mulberry32(hashSeed('graph', seed)), g = randomGraph(rng, 3 + Math.floor(rng() * 9));
    const tag = `seed ${seed} graph ${J(g.nodes.map((n) => [n.id, n.type, n.params]))} links ${J(g.links.map((l) => [l.from, l.out, l.to, l.in]))}`;
    let out;
    try { out = evaluate(g); } catch (e) { assert.fail(`threw ${e.stack.split('\n').slice(0, 3).join(' | ')}: ${tag}`); }
    const { res } = out;
    for (const d of res.diags) {
      if (d.code === 'throw') assert.ok(!BAD_MSG.test(d.message), `node ${d.node} (${g.nodes.find((n) => n.id === d.node)?.type}) leaked "${d.message}": ${tag}`);
      assert.ok(typeof d.message === 'string' && d.message.length, `empty diag ${J(d)}`);
    }
    for (const n of g.nodes) assert.ok(['ok', 'error', 'muted', 'blocked', 'cached', 'skipped'].includes(res.status.get(n.id)), `status ${res.status.get(n.id)} of ${n.type}: ${tag}`);
    for (const [key, s] of scripts(res)) assert.ok(isValid(s), `${key} (${g.nodes.find((n) => n.id === key.split(':')[0])?.type}) is not a valid Script: ${J(s.slice(0, 5))}: ${tag}`);
    // determinism: a fresh evaluation gives identical statuses and script values
    const again = evaluate(g).res;
    for (const n of g.nodes) assert.equal(again.status.get(n.id), res.status.get(n.id), `nondeterministic status ${n.type}: ${tag}`);
    for (const [key, s] of scripts(res)) assert.deepEqual(again.values.get(key), s, `nondeterministic ${key}: ${tag}`);
    // validate never throws and serialise round-trips
    assert.ok(Array.isArray(validate(g, reg)));
    const back = parseGraph(JSON.parse(J(serializeGraph(g))), reg);
    assert.deepEqual(J(serializeGraph(back.graph ?? back)), J(serializeGraph(g)), `serialise round trip: ${tag}`);
  }
});

// ---- wrapped edit ops over several spans (random params) equal the sequential direct calls
const FRAME = 1000 / 30;
const edits = OPS.filter((o) => !EXCLUDED_OPS.includes(o.id) && !(o.group === 'select' || o.selection) && !TIME_SHIFT_OPS.includes(o.id));
for (const op of edits) {
  test(`fuzz graph edit.${op.id}: several spans equal sequential direct calls`, () => {
    const type = `edit.${op.id}`, def = reg.get(type);
    for (let seed = 0; seed < SEEDS / 3; seed++) {
      const rng = mulberry32(hashSeed('fold', op.id, seed)), s = randomScript(rng);
      const spans = []; let t = Math.floor(rng() * 8000);
      for (let i = 0; i < 1 + Math.floor(rng() * 3); i++) {
        const t0 = t, t1 = t0 + (rng() < 0.15 ? 0 : 200 + Math.floor(rng() * 5000));
        spans.push({ t0, t1, kind: 'k' }); t = t1 + 100 + Math.floor(rng() * 8000);
      }
      const params = {};
      for (const q of op.params) {
        if (q.type === 'number' && op.playhead !== q.key && rng() < 0.7) { const lo = Math.max(q.min, -3000), hi = Math.min(q.max, 3000); params[q.key] = lo + rng() * (hi - lo); }
        else if (q.type === 'choice' && rng() < 0.7) params[q.key] = pick(rng, q.choices);
        else if (q.type === 'bool' && rng() < 0.7) params[q.key] = rng() < 0.5;
      }
      snap.fx = { script: s, where: spans };
      const g = buildGraph(reg, [{ id: 'i', type: 'fx.script', params: { key: 'script' } }, { id: 'w', type: 'fx.spans', params: { key: 'where' } }, { id: 'n', type, params }],
        [['i', 'value', 'n', 'script'], ['w', 'value', 'n', 'where']]);
      const { res } = run(reg, g, snap, { targets: ['n'] });
      const p = normalizeValues(def.params, g.nodes.find((n) => n.id === 'n').params);
      if ((op.id === 'quantize' || op.id === 'nudgeTime') && !(p.frameMs > 0)) p.frameMs = FRAME;
      let want = s, threw = false;
      try { for (const sp of spans) want = op.apply(want, sp.t0 === sp.t1 ? { ats: [sp.t0] } : { t0: sp.t0, t1: sp.t1 - 1 }, p).script; } catch { threw = true; }
      if (threw) continue;
      const tag = `${type} seed ${seed} spans ${J(spans)} params ${J(params)} script ${J(s.length)} pts`;
      assert.equal(res.status.get('n'), 'ok', `${tag}: ${J(res.diags.filter((d) => d.node === 'n'))}`);
      assert.deepEqual(res.values.get('n:script'), want, tag);
      assert.ok(isValid(res.values.get('n:script')), tag);
    }
  });
}
void DUR; void atsToSpans;

test('fuzz graph: coverage - most node types reach status ok in some random graph', () => {
  const ok = new Set(), seen = new Set(), errs = new Map();
  for (let seed = 0; seed < SEEDS * 15; seed++) {
    const rng = mulberry32(hashSeed('cover', seed)), g = randomGraph(rng, 4 + Math.floor(rng() * 10));
    const { res } = evaluate(g);
    for (const n of g.nodes) { seen.add(n.type); if (res.status.get(n.id) === 'ok') ok.add(n.type); }
    for (const d of res.diags) if (d.code === 'throw') errs.set(d.message, (errs.get(d.message) || 0) + 1);
  }
  const never = TYPES.filter((t) => !ok.has(t));
  if (process.env.FUZZ_VERBOSE) console.log('never ok:', never.join(', '), '\nthrow diags:', J([...errs]));
  assert.ok(ok.size >= TYPES.length * 0.8, `only ${ok.size}/${TYPES.length} node types ever evaluated ok; never: ${never.join(', ')}`);
});
