// Every preset places, compiles with zero errors against the catalogue, survives a save/load, and evaluates end to end
// on a synthetic document: every output produces a valid script, deterministically, with no error anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValid } from '../src/lib/core/script.js';
import { emptyGraph, applyPreset } from '../src/lib/graph/model.js';
import { compile, validate, evaluateSync, createCache } from '../src/lib/graph/eval.js';
import { parseGraph, serializeGraph } from '../src/lib/graph/serialize.js';
import { PRESETS } from '../src/lib/graph/presets.js';
import { gridFor, makeSignal } from '../src/lib/graph/types.js';
import { testRegistry, makeSnapshot, sourcesOf } from './graph-nodes-fixtures.mjs';

const reg = testRegistry();
const REQUIRED = ['tracker-cleanup', 'depth-by-kind', 'mix-trackers', 'roll-from-phase', 'twist-from-phase', 'climax-pulses', 'ab-smoothing', 'polish',
  'fill-dropouts', 'scene-flip-fix', 'plan-plus-tracker'];

/** Place a preset and bind its slots the way integration does (repeated 'run' slots take successive runs). */
function place(preset, snapshot) {
  const { graph, map } = applyPreset(emptyGraph({ rate: preset.rate ?? 50 }), reg, preset, { x: 0, y: 0 });
  const runs = snapshot.runs.map((r) => r.id), trackers = snapshot.ghosts.filter((g) => g.source?.kind === 'tracker').map((g) => g.id);
  let ri = 0;
  const nodes = graph.nodes.map((nd) => {
    const slots = (preset.slots || []).filter((s) => map[s.node] === nd.id);
    if (!slots.length) return nd;
    const params = { ...nd.params };
    for (const s of slots) {
      if (s.auto === 'tracker') params[s.param] = trackers[0];
      else if (s.auto === 'reference') params[s.param] = 'ref';
      else if (s.auto === 'run') params[s.param] = runs[Math.min(s.n ?? ri++, runs.length - 1)];
      else if (s.auto.startsWith('axis:')) params[s.param] = s.auto.slice(5);
    }
    return { ...nd, params };
  });
  return { graph: { ...graph, nodes }, map };
}

test('the required presets exist, with names, descriptions and unique ids', () => {
  const ids = PRESETS.map((p) => p.id);
  for (const id of REQUIRED) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(PRESETS.length >= 8);
  for (const p of PRESETS) {
    assert.ok(p.name && p.description && Array.isArray(p.tags), p.id);
    const nodeIds = new Set(p.nodes.map((x) => x.id));
    assert.equal(nodeIds.size, p.nodes.length, `${p.id}: duplicate node ids`);
    for (const l of p.links) assert.ok(nodeIds.has(l.from) && nodeIds.has(l.to), `${p.id}: link ${JSON.stringify(l)}`);
    for (const s of p.slots || []) assert.ok(nodeIds.has(s.node), `${p.id}: slot ${s.node}`);
    for (const x of p.nodes) { assert.equal(x.x % 20, 0); assert.equal(x.y % 20, 0); assert.ok(reg.has(x.type), `${p.id}: unknown type ${x.type}`); }
    assert.doesNotThrow(() => JSON.stringify(p));
  }
});

for (const preset of PRESETS) {
  test(`preset ${preset.id} compiles and evaluates end to end`, () => {
    const snap = makeSnapshot(21);
    const { graph } = place(preset, snap);
    const errors = validate(graph, reg).filter((d) => d.severity === 'error');
    assert.deepEqual(errors, [], `${preset.id} static errors`);
    assert.equal(graph.links.length, preset.links.length, 'every link placed');

    const program = compile(graph, reg);
    assert.ok(program.outputs.length > 0, 'has outputs');
    const runCtx = () => ({ sources: sourcesOf(snap), durationMs: snap.durationMs, media: snap.media, frameMs: snap.frameMs, cache: createCache() });
    const res = evaluateSync(program, runCtx(), {});
    const bad = res.diags.filter((d) => d.severity === 'error' || d.code === 'invalid-output');
    assert.deepEqual(bad.map((d) => `${d.node}: ${d.message}`), [], `${preset.id} runtime errors`);
    for (const id of program.outputs) {
      assert.equal(res.status.get(id), 'ok', `${preset.id}: output ${id}`);
      const v = res.values.get(`${id}:result`);
      assert.ok(isValid(v), `${preset.id}: ${id} result is a valid script`);
      assert.ok(v.length > 0, `${preset.id}: ${id} result is not empty`);
    }

    // determinism: a fresh cache gives bit-identical values
    const again = evaluateSync(compile(graph, reg), runCtx(), {});
    for (const id of program.outputs) assert.deepEqual(again.values.get(`${id}:result`), res.values.get(`${id}:result`));

    // a second run on the same cache recomputes nothing
    const cache = createCache(), rc = { ...runCtx(), cache };
    evaluateSync(program, rc, {});
    const warm = evaluateSync(program, rc, {});
    assert.ok([...warm.status.values()].every((s) => s === 'cached' || s === 'muted'), 'warm run is all cache hits');

    // a windowed preview runs without errors
    const win = evaluateSync(program, runCtx(), { range: { t0: 15000, t1: 30000 } });
    assert.deepEqual(win.diags.filter((d) => d.severity === 'error').map((d) => d.message), []);

    // save / load keeps it clean
    const { graph: loaded } = parseGraph(JSON.parse(JSON.stringify(serializeGraph(graph))), reg);
    assert.deepEqual(validate(loaded, reg).filter((d) => d.severity === 'error'), []);
  });
}

test('depth-by-kind puts each plan segment inside its range', () => {
  const snap = makeSnapshot(5);
  const preset = PRESETS.find((p) => p.id === 'depth-by-kind');
  const { graph } = place(preset, snap);
  const program = compile(graph, reg);
  const res = evaluateSync(program, { sources: sourcesOf(snap), durationMs: snap.durationMs, cache: createCache() }, {});
  const out = res.values.get(`${program.outputs[0]}:result`);
  const table = preset.nodes.find((x) => x.id === 'range').params.table;
  for (const seg of snap.plan) {
    const [lo, hi] = table[seg.kind];
    const inner = out.filter((a) => a.at >= seg.t0 + 400 && a.at < seg.t1 - 400); // away from the crossfades
    assert.ok(inner.length > 0, seg.kind);
    for (const a of inner) assert.ok(a.pos >= lo && a.pos <= hi, `${seg.kind} @${a.at}: ${a.pos} not in [${lo}, ${hi}]`);
  }
});

test('climax-pulses changes the stroke only around orgasm segments', () => {
  const snap = makeSnapshot(6);
  const { graph } = place(PRESETS.find((p) => p.id === 'climax-pulses'), snap);
  const program = compile(graph, reg);
  const res = evaluateSync(program, { sources: sourcesOf(snap), durationMs: snap.durationMs, cache: createCache() }, {});
  const out = res.values.get(`${program.outputs[0]}:result`);
  const climax = snap.plan.find((s) => s.kind === 'orgasm');
  const outside = (a) => a.at < climax.t0 - 1000 || a.at > climax.t1 + 1000;
  assert.deepEqual(out.filter(outside), snap.axes.stroke.filter(outside));
  const inside = out.filter((a) => a.at > climax.t0 + 500 && a.at < climax.t1 - 500);
  assert.ok(inside.length > 40, 'dense pulses inside the climax');
  assert.ok(inside.every((a) => a.pos <= 40), 'pulses stay near the deep end');
});

// Runs are session-only: after a reload snapshot.runs is [] and every src.run falls back to the ghost of the same id.
function reloaded(snap) {
  const ghosts = snap.runs.map((r, i) => ({ id: r.id, name: `Run ${i + 1}`, script: snap.ghosts[i].script, source: { kind: 'tracker' } }));
  return { ...snap, runs: [], ghosts: [...snap.ghosts, ...ghosts] };
}
const evalOn = (graph, snap) => evaluateSync(compile(graph, reg), { sources: sourcesOf(snap), durationMs: snap.durationMs, media: snap.media, frameMs: snap.frameMs, cache: createCache() }, {});
const known = (sig) => sig.v.reduce((n, x) => n + (x === x ? 1 : 0), 0);

test('src.run ghost fallback: confidence is 1 exactly where the signal is known', () => {
  const snap = makeSnapshot(31);
  const { graph, map } = place(PRESETS.find((p) => p.id === 'mix-trackers'), snap);
  const res = evaluateSync(compile(graph, reg), { sources: sourcesOf(reloaded(snap)), durationMs: snap.durationMs, cache: createCache() }, { targets: [map.a] });
  const sig = res.values.get(`${map.a}:signal`), conf = res.values.get(`${map.a}:confidence`);
  assert.ok(known(sig) > 0);
  for (let k = 0; k < sig.v.length; k++) assert.equal(conf.v[k] === conf.v[k] ? conf.v[k] : 'NaN', sig.v[k] === sig.v[k] ? 1 : 'NaN', `sample ${k}`);
  assert.deepEqual(conf.range, [0, 1]);
});

test('mix-trackers still blends after a reload (runs gone, ghosts present)', () => {
  const snap = makeSnapshot(32);
  const { graph, map } = place(PRESETS.find((p) => p.id === 'mix-trackers'), snap);
  const res = evalOn(graph, reloaded(snap));
  assert.ok(known(res.values.get(`${map.blend}:signal`)) > 0.9 * res.values.get(`${map.a}:signal`).v.length, 'blend is known almost everywhere');
  assert.ok(res.values.get(`${map.out}:result`).length > 50, 'out.axis has a result');
});

test('fill-dropouts after a reload does not treat the whole timeline as a dropout', () => {
  const snap = makeSnapshot(33);
  const { graph, map } = place(PRESETS.find((p) => p.id === 'fill-dropouts'), snap);
  const res = evalOn(graph, reloaded(snap));
  const lost = res.values.get(`${map.low}:spans`).reduce((n, s) => n + s.t1 - s.t0, 0);
  assert.ok(lost < 0.2 * snap.durationMs, `dropouts cover ${lost} ms of ${snap.durationMs}`);
  assert.ok(res.values.get(`${map.out}:result`).length > 50);
});

test('sig.blend: an unknown confidence on a known sample counts as 1', () => {
  const g = gridFor({ t0: 0, t1: 1000 }, 20), a = makeSignal(g.i0, g.n, g.dt, 20), b = makeSignal(g.i0, g.n, g.dt, 80), nan = makeSignal(g.i0, g.n, g.dt, NaN);
  const out = reg.get('sig.blend').eval({ a, ca: nan, b, cb: nan }, { mode: 'blend', gamma: 2 }, { grid: () => g });
  assert.ok([...out.signal.v].every((x) => x === 50), 'equal weights → midpoint');
});

// Rendered cards are 224 px wide and up to ~223 px tall (src.run with five outputs): no two may overlap.
test('preset layouts leave room for every card and frames do not overlap', () => {
  const W = 224, H = 240, hit = (a, b, w, h) => Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h;
  for (const p of PRESETS) {
    for (let i = 0; i < p.nodes.length; i++) {
      for (let j = i + 1; j < p.nodes.length; j++) assert.ok(!hit(p.nodes[i], p.nodes[j], W + 20, H + 20), `${p.id}: ${p.nodes[i].id} overlaps ${p.nodes[j].id}`);
    }
    const fr = p.frames || [];
    for (let i = 0; i < fr.length; i++) {
      for (let j = i + 1; j < fr.length; j++) {
        const [a, b] = [fr[i], fr[j]];
        assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${p.id}: frames ${a.id} and ${b.id} overlap`);
      }
    }
  }
});

test('roll-from-phase peaks at the stroke tops', () => {
  const snap = makeSnapshot(8);
  // a clean regular stroke: tops (100) at 0, 1000, 2000 …, bottoms (0) in between
  snap.axes = { ...snap.axes, stroke: Array.from({ length: 121 }, (_, i) => ({ at: i * 500, pos: i % 2 ? 0 : 100 })) };
  const { graph } = place(PRESETS.find((p) => p.id === 'roll-from-phase'), snap);
  const program = compile(graph, reg);
  const res = evaluateSync(program, { sources: sourcesOf(snap), durationMs: snap.durationMs, cache: createCache() }, {});
  const roll = res.values.get(`${program.outputs[0]}:result`);
  const at = (t) => roll.find((a) => a.at === t)?.pos;
  assert.equal(at(10000), 68); // top: 50 + 18
  assert.equal(at(10500), 32); // bottom: 50 - 18
  assert.equal(at(10250), 50); // midpoint
});
