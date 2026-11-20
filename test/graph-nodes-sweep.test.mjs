// Catalogue sweep: every registered node type, default params, fixture inputs -> valid values of its declared output
// types (scripts pass core isValid), no error, no repaired output. Catches library drift in the wrapped ops/generators.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValid } from '../src/lib/core/script.js';
import { checkValue } from '../src/lib/graph/types.js';
import { mulberry32 } from '../src/lib/gen/util.js';
import { OPS } from '../src/lib/edit/index.js';
import { GENERATORS } from '../src/lib/gen/generators.js';
import { createCatalogue, BUILTINS, wrapEditOps, wrapGenerators, EXCLUDED_OPS } from '../src/lib/graph/nodes/index.js';
import { testRegistry, makeSnapshot, buildGraph, run, randomScript, randomSignal, randomSpans, deepFreeze } from './graph-nodes-fixtures.mjs';

const reg = testRegistry();
const snap = makeSnapshot(7);
const rng = mulberry32(99);
snap.fx = {
  script: randomScript(rng), script2: randomScript(rng), signal: randomSignal(rng), signal2: randomSignal(rng),
  spans: randomSpans(rng, 10), points: randomSpans(rng, 30, { pointsShare: 1 }), number: 42,
  plan: snap.plan.map((s) => ({ t0: s.t0, t1: s.t1, kind: s.kind, data: { id: s.id } })),
};
// every turn as a point (realistic input for follow / knot / beats)
snap.fx.points = snap.fx.script.filter((_, i) => i % 2 === 0).map((a, i) => ({ t0: a.at, t1: a.at, kind: i % 2 ? 'top' : 'bottom' }));
deepFreeze(snap);

const NEEDS_WHERE = new Set(['script.splice', 'script.trim', 'script.tile', 'flow.switch', 'flow.gate']);
const MIN_INPUTS = { 'sig.expr': ['a'], 'flow.select': ['in0'] };
const PARAMS = { 'src.ghost': { ghost: 'g1' }, 'src.run': { run: 'run1' } };
const fxFor = (port, variant = 0) => {
  let T = port.type;
  if (T === 'any') T = (port.accepts || ['script', 'signal', 'spans', 'number'])[variant % (port.accepts?.length || 4)];
  if (T === 'script') return ['fx.script', port.name === 'b' || port.name === 'insert' || port.name === 'ref' ? 'script2' : 'script'];
  if (T === 'signal') return ['fx.signal', port.name === 'b' ? 'signal2' : 'signal'];
  if (T === 'spans') return ['fx.spans', port.name === 'where' ? 'plan' : port.hint === 'points' || port.name === 'turns' || port.name === 'beats' || port.name === 'times' ? 'points' : port.name === 'segments' ? 'plan' : 'spans'];
  return ['fx.number', 'number'];
};

function sweepOne(def, { optional, variant }) {
  const ports = reg.portsOf({ type: def.type });
  const specs = [{ id: 'n', type: def.type, params: PARAMS[def.type] || {} }], links = [];
  for (const port of ports.ins) {
    const wanted = port.required || optional || MIN_INPUTS[def.type]?.includes(port.name) || (port.name === 'where' && NEEDS_WHERE.has(def.type));
    if (!wanted) continue;
    const [type, key] = fxFor(port, variant);
    specs.push({ id: 'i_' + port.name, type, params: { key } });
    links.push(['i_' + port.name, 'value', 'n', port.name]);
  }
  const g = buildGraph(reg, specs, links);
  const { program, res } = run(reg, g, snap, { targets: ['n'] });
  const bad = res.diags.filter((d) => d.node === 'n' && (d.severity === 'error' || d.code === 'invalid-output'));
  assert.deepEqual(bad.map((d) => d.message), [], `${def.type} (${optional ? 'all inputs' : 'required'}, variant ${variant})`);
  assert.equal(res.status.get('n'), 'ok', `${def.type} status`);
  for (const op of ports.outs) {
    const v = res.values.get(`n:${op.name}`);
    assert.notEqual(v, undefined, `${def.type}: output "${op.name}" missing`);
    let T = program.types.get(`n:${op.name}`) || op.type;
    if (T === 'any') T = ['script', 'signal', 'spans', 'number'].find((t) => !checkValue(t, v));
    assert.equal(checkValue(T, v), '', `${def.type}.${op.name} is a valid ${T}`);
    if (T === 'script') assert.ok(isValid(v), `${def.type}.${op.name} isValid`);
    if (T === 'number') assert.ok(Number.isFinite(v), `${def.type}.${op.name} finite`);
  }
}

const types = reg.list().filter((d) => !d.type.startsWith('fx.'));

test('the catalogue registers the contract\'s node types', () => {
  const have = new Set(types.map((d) => d.type));
  const want = ['src.axis', 'src.ghost', 'src.run', 'src.plan', 'src.chapters', 'src.loops', 'src.bookmarks', 'src.range', 'src.selection', 'src.scenes',
    'src.trackSpans', 'src.tags', 'src.audio', 'src.time', 'src.media', 'const.number', 'const.script', 'const.spans',
    'script.sample', 'script.turns', 'script.strokes', 'script.phase', 'script.speed', 'script.rate', 'script.splice', 'script.trim', 'script.merge', 'script.mix', 'script.tile',
    'amp.remap', 'amp.gain', 'amp.offset', 'amp.clamp', 'amp.curve',
    'sig.math', 'sig.expr', 'sig.smooth', 'sig.slew', 'sig.median', 'sig.fillGaps', 'sig.normalise', 'sig.remap', 'sig.blend', 'sig.delay', 'sig.derivative', 'sig.integrate',
    'sig.envelope', 'sig.quantise', 'sig.lfo', 'sig.noise', 'sig.phaseWave', 'sig.toScript', 'sig.sampleAt',
    'spans.filter', 'spans.not', 'spans.pad', 'spans.mergeGaps', 'spans.shift', 'spans.relabel', 'spans.between', 'spans.and', 'spans.or', 'spans.minus',
    'spans.threshold', 'spans.kindRange', 'spans.kindValue', 'spans.envelope', 'spans.toSignal',
    'flow.switch', 'flow.gate', 'flow.select', 'flow.reroute', 'an.stat', 'an.problems', 'an.compare', 'out.axis', 'out.ghost', 'gen.plan'];
  for (const t of want) assert.ok(have.has(t), `missing ${t}`);
  for (const op of OPS) {
    if (EXCLUDED_OPS.includes(op.id)) { assert.ok(!have.has(`edit.${op.id}`) && !have.has(`select.${op.id}`), `${op.id} excluded`); continue; }
    assert.ok(have.has(`${op.group === 'select' ? 'select' : 'edit'}.${op.id}`), `op ${op.id} wrapped`);
  }
  for (const id of Object.keys(GENERATORS)) assert.ok(have.has(`gen.${id}`), `generator ${id} wrapped`);
  assert.equal(wrapEditOps(OPS).skipped.length, 0);
  assert.equal(wrapGenerators(GENERATORS, {}).skipped.length, 0);
  assert.ok(BUILTINS.every((d) => Object.isFrozen(d)));
});

test('the contract port names hold', () => {
  const ins = (t) => reg.portsOf({ type: t }).ins.map((p) => p.name).join(',');
  const outs = (t) => reg.portsOf({ type: t }).outs.map((p) => p.name).join(',');
  assert.equal(ins('edit.smooth'), 'script,where'); assert.equal(outs('edit.smooth'), 'script,changed');
  assert.equal(ins('select.selectTurns'), 'script,where'); assert.equal(outs('select.selectTurns'), 'points');
  assert.equal(ins('gen.follow'), 'turns,where'); assert.equal(ins('gen.beats'), 'beats,where'); assert.equal(ins('gen.pulses'), 'where');
  assert.equal(ins('gen.plan'), 'segments,turns');
  assert.equal(outs('src.run'), 'signal,confidence,points,events,scenes');
  assert.equal(outs('src.media'), 'duration,fps');
  assert.equal(outs('script.phase'), 'phase,amp,period');
  assert.equal(ins('script.splice'), 'base,insert,where');
  assert.equal(ins('sig.blend'), 'a,ca,b,cb'); assert.equal(outs('sig.blend'), 'signal,dominance');
  assert.equal(ins('sig.sampleAt'), 'signal,times');
  assert.equal(outs('spans.kindRange'), 'lo,hi');
  assert.equal(ins('flow.switch'), 'a,b,where'); assert.equal(ins('flow.select'), 'in0,in1,in2,in3');
  assert.equal(outs('an.compare'), 'score,lag,diff');
  assert.equal(ins('out.axis'), 'script,where'); assert.equal(outs('out.axis'), 'result');
  assert.equal(outs('out.ghost'), 'result');
  for (const d of types) for (const q of d.params) if (q.mod) assert.ok(['number', 'float', 'int'].includes(q.type), `${d.type}.${q.key}`);
});

for (const def of types) {
  test(`sweep ${def.type}`, () => {
    sweepOne(def, { optional: false, variant: 0 });
    sweepOne(def, { optional: true, variant: 0 });
    const anyPorts = reg.portsOf({ type: def.type }).ins.filter((p) => p.type === 'any');
    const nv = Math.max(0, ...anyPorts.map((p) => (p.accepts?.length ?? 4)));
    for (let v = 1; v < nv; v++) {
      sweepOne(def, { optional: true, variant: v });
    }
  });
}

test('createCatalogue without compilePlan uses the fallback and still compiles plans', () => {
  const r = createCatalogue();
  assert.ok(r.get('gen.plan'));
});
