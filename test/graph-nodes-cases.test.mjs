// Per-node behaviour of the hand-written nodes: the numbers a user relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxStepSpeed } from '../src/lib/gen/util.js';
import { mulberry32 } from '../src/lib/gen/util.js';
import { gridFor, makeSignal, sampleScript } from '../src/lib/graph/types.js';
import { testRegistry, makeSnapshot, buildGraph, run, randomSignal, DUR } from './graph-nodes-fixtures.mjs';

const reg = testRegistry();
const FXTYPE = (v) => (typeof v === 'number' ? 'fx.number' : v && v.v ? 'fx.signal' : Array.isArray(v) && v.length && 'at' in v[0] ? 'fx.script' : 'fx.spans');

/** Evaluate one node: inputs { port: value }, -> { values (port -> value), diags, status }. */
function evalNode(type, inputs = {}, { params = {}, byKind, snap = makeSnapshot(1), range = null, rate = 50 } = {}) {
  snap.fx = {};
  const specs = [{ id: 'n', type, params, byKind }], links = [];
  for (const [port, v] of Object.entries(inputs)) {
    snap.fx[port] = v;
    specs.push({ id: 'i_' + port, type: FXTYPE(v), params: { key: port } });
    links.push(['i_' + port, 'value', 'n', port]);
  }
  const g = buildGraph(reg, specs, links, { rate });
  const { res } = run(reg, g, snap, { targets: ['n'], range });
  const values = {};
  for (const [k, v] of res.values) if (k.startsWith('n:')) values[k.slice(2)] = v;
  return { values, diags: res.diags.filter((d) => d.node === 'n'), status: res.status.get('n') };
}
const sig = (f, dt = 20, t1 = DUR) => { const g = gridFor({ t0: 0, t1 }, dt), s = makeSignal(g.i0, g.n, dt); for (let k = 0; k < g.n; k++) s.v[k] = f(k * dt); return s; };
const at = (s, t) => s.v[Math.round(t / s.dt) - s.i0];
const flat = (n, pos = 50, step = 100) => Array.from({ length: n }, (_, i) => ({ at: i * step, pos }));

test('amp.remap maps 0..100 onto lo..hi, per action, driven by signals', () => {
  const s = [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, { at: 2000, pos: 50 }];
  assert.deepEqual(evalNode('amp.remap', { script: s }, { params: { lo: 20, hi: 60 } }).values.script.map((a) => a.pos), [20, 60, 40]);
  const lo = sig((t) => (t < 1500 ? 0 : 50)), hi = sig(() => 100);
  const r = evalNode('amp.remap', { script: s, 'p:lo': lo, 'p:hi': hi });
  assert.deepEqual(r.values.script.map((a) => a.pos), [0, 100, 75]);
});

test('amp.gain mirrors with gain -1; amp.clamp clamps and compresses; amp.curve bends', () => {
  const s = [{ at: 0, pos: 0 }, { at: 100, pos: 30 }, { at: 200, pos: 100 }];
  assert.deepEqual(evalNode('amp.gain', { script: s }, { params: { gain: -1, pivot: 50 } }).values.script.map((a) => a.pos), [100, 70, 0]);
  assert.deepEqual(evalNode('amp.clamp', { script: s }, { params: { lo: 20, hi: 80 } }).values.script.map((a) => a.pos), [20, 30, 80]);
  assert.deepEqual(evalNode('amp.clamp', { script: s }, { params: { lo: 20, hi: 80, mode: 'compress' } }).values.script.map((a) => a.pos), [20, 38, 80]);
  assert.deepEqual(evalNode('amp.curve', { script: s }, { params: { gamma: 2 } }).values.script.map((a) => a.pos), [0, 9, 100]);
});

test('spans.kindRange: table values inside, default outside, linear crossfade centred on boundaries', () => {
  const spans = [{ t0: 10000, t1: 20000, kind: 'climax' }, { t0: 20000, t1: 30000, kind: 'oral' }];
  const r = evalNode('spans.kindRange', { spans }, { params: { table: { climax: [0, 40], oral: [40, 95] }, default: [10, 90], fadeMs: 400 } }).values;
  assert.equal(at(r.lo, 5000), 10); assert.equal(at(r.hi, 5000), 90);
  assert.equal(at(r.lo, 15000), 0); assert.equal(at(r.hi, 15000), 40);
  assert.equal(at(r.lo, 25000), 40); assert.equal(at(r.hi, 25000), 95);
  assert.equal(at(r.lo, 20000), 20);           // halfway through the 400 ms fade
  assert.ok(Math.abs(at(r.hi, 19900) - 53.75) < 1e-4); // a quarter into the 19800..20200 fade: 40 + (95 - 40) × 0.25
  assert.equal(at(r.lo, 9800), 10); assert.equal(at(r.lo, 10200), 0); // the fade spans ±200 ms
  const v = evalNode('spans.kindValue', { spans }, { params: { table: { climax: 7 }, default: 1, fadeMs: 0 } }).values.signal;
  assert.equal(at(v, 15000), 7); assert.equal(at(v, 25000), 1);
});

test('sig.blend: confidence weighting, a lost arm falls back to the other, dominance, pick', () => {
  const a = sig(() => 10), b = sig((t) => (t > 30000 && t < 31000 ? NaN : 90)), ca = sig(() => 0.5), cb = sig(() => 1);
  const r = evalNode('sig.blend', { a, ca, b, cb }, { params: { gamma: 1 } }).values;
  assert.ok(Math.abs(at(r.signal, 1000) - (10 * 0.5 + 90) / 1.5) < 1e-4);
  assert.ok(Math.abs(at(r.dominance, 1000) - 1 / 3) < 1e-6);
  assert.equal(at(r.signal, 30500), 10); assert.equal(at(r.dominance, 30500), 1);
  const p = evalNode('sig.blend', { a, ca, b, cb }, { params: { mode: 'pick' } }).values;
  assert.equal(at(p.signal, 1000), 90);
  const u = evalNode('sig.blend', { a, b }, { params: { gamma: 2 } }).values; // no confidences: plain average
  assert.equal(at(u.signal, 1000), 50);
});

test('sig.fillGaps bridges short gaps only', () => {
  const s = sig((t) => ((t > 1000 && t < 1200) || (t > 5000 && t < 7000) ? NaN : t / 100));
  const r = evalNode('sig.fillGaps', { signal: s }, { params: { maxGapMs: 500 } }).values.signal;
  assert.ok(Math.abs(at(r, 1100) - 11) < 1e-4);
  assert.ok(Number.isNaN(at(r, 6000)));
  const h = evalNode('sig.fillGaps', { signal: s }, { params: { maxGapMs: 500, mode: 'hold' } }).values.signal;
  assert.equal(at(h, 1100), 10);
});

test('sig.toScript puts actions on the extremes of a sine, sub-sample refined', () => {
  const s = sig((t) => 50 + 40 * Math.cos((2 * Math.PI * t) / 1010)); // period 1010 ms: extremes off the 20 ms grid
  const out = evalNode('sig.toScript', { signal: s }, { params: { minProminence: 10 } }).values.script;
  const tops = out.filter((a) => a.pos >= 89), bottoms = out.filter((a) => a.pos <= 11);
  assert.ok(tops.length > 50 && bottoms.length > 50);
  for (const a of tops.slice(1, 20)) { const k = Math.round(a.at / 1010); assert.ok(Math.abs(a.at - k * 1010) <= 2, `top at ${a.at}`); }
  for (const a of bottoms.slice(1, 20)) { const k = Math.round((a.at - 505) / 1010); assert.ok(Math.abs(a.at - (505 + k * 1010)) <= 2, `bottom at ${a.at}`); }
});

test('sig.toScript gaps: hold keeps the last value until data returns', () => {
  const s = sig((t) => (t > 10000 && t < 12000 ? NaN : 50 + 40 * Math.sin(t / 300)), 20, 20000);
  const brk = evalNode('sig.toScript', { signal: s }, { params: { gaps: 'break' } }).values.script;
  const hold = evalNode('sig.toScript', { signal: s }, { params: { gaps: 'hold' } }).values.script;
  assert.equal(hold.length, brk.length + 1);
  const i = hold.findIndex((a) => a.at > 10000);
  assert.equal(hold[i].pos, hold[i - 1].pos); // flat across the gap
});

test('script.phase: 0 at tops, 0.5 at bottoms, amplitude and period', () => {
  const stroke = Array.from({ length: 41 }, (_, i) => ({ at: i * 400, pos: i % 2 ? 10 : 90 })); // tops at 0, 800, …
  const r = evalNode('script.phase', { script: stroke }).values;
  assert.equal(at(r.phase, 4800), 0); assert.equal(at(r.phase, 5200), 0.5); assert.equal(at(r.phase, 5000), 0.25); assert.equal(at(r.phase, 5400), 0.75);
  assert.ok(Math.abs(at(r.amp, 5000) - 0.8) < 1e-6);
  assert.equal(at(r.period, 5000), 800);
  assert.ok(Number.isNaN(at(r.phase, 20000)), 'NaN after the last turn');
});

test('script.speed and script.rate', () => {
  const stroke = Array.from({ length: 41 }, (_, i) => ({ at: i * 500, pos: i % 2 ? 0 : 100 }));
  assert.equal(at(evalNode('script.speed', { script: stroke }).values.signal, 5250), 200);
  assert.ok(Math.abs(at(evalNode('script.speed', { script: stroke }, { params: { windowMs: 2000 } }).values.signal, 6000) - 200) < 1e-6);
  assert.equal(at(evalNode('script.rate', { script: stroke }).values.signal, 5250), 60); // 1 s per stroke
});

test('script.splice: cut keeps exact edges, blend respects the speed cap at the seams', () => {
  const base = flat(101, 100, 100), ins = Array.from({ length: 101 }, (_, i) => ({ at: i * 100, pos: 0 }));
  const where = [{ t0: 3000, t1: 6000 }];
  const cut = evalNode('script.splice', { base, insert: ins, where }, { params: { seam: 'cut' } }).values.script;
  assert.equal(cut.find((a) => a.at === 2900).pos, 100); assert.equal(cut.find((a) => a.at === 3000).pos, 0);
  assert.equal(cut.find((a) => a.at === 5999).pos, 0); assert.equal(cut.find((a) => a.at === 6000).pos, 100);
  const blend = evalNode('script.splice', { base, insert: ins, where }, { params: { seam: 'blend', maxSpeed: 400 } }).values.script;
  assert.ok(maxStepSpeed(blend).speed <= 400, String(maxStepSpeed(blend).speed));
  assert.equal(blend.find((a) => a.at === 4500).pos, 0);
  assert.equal(blend.find((a) => a.at === 1000).pos, 100);
});

test('flow.switch per type; flow.gate; flow.select', () => {
  const where = [{ t0: 10000, t1: 20000 }];
  const a = sig(() => 0), b = sig(() => 100);
  const s = evalNode('flow.switch', { a, b, where }, { params: { fadeMs: 1000 } }).values.out;
  assert.equal(at(s, 5000), 0); assert.equal(at(s, 15000), 100); assert.equal(at(s, 10000), 50); assert.equal(at(s, 10240), 74);
  const sp = evalNode('flow.switch', { a: [{ t0: 0, t1: 30000, kind: 'x' }], b: [{ t0: 0, t1: 30000, kind: 'y' }], where }).values.out;
  assert.deepEqual(sp.map((x) => [x.t0, x.t1, x.kind]), [[0, 10000, 'x'], [10000, 20000, 'y'], [20000, 30000, 'x']]);
  const scr = evalNode('flow.switch', { a: flat(301, 0), b: flat(301, 100), where }).values.out;
  assert.equal(scr.find((x) => x.at === 9900).pos, 0); assert.equal(scr.find((x) => x.at === 15000).pos, 100);
  const gs = evalNode('flow.gate', { in: b, where }).values.out;
  assert.ok(Number.isNaN(at(gs, 5000))); assert.equal(at(gs, 15000), 100);
  const gt = evalNode('flow.gate', { in: flat(301, 60), where }).values.out;
  assert.ok(gt[0].at === 10000 && gt[gt.length - 1].at === 19999);
  assert.equal(evalNode('flow.select', { in0: 1, in1: 2 }, { params: { pick: 1 } }).values.out, 2);
  assert.equal(evalNode('flow.select', { in0: 1 }, { params: { pick: 2 } }).status, 'error');
  assert.equal(evalNode('flow.switch', { a, b }).status, 'error', 'switch without spans is an error');
});

test('spans.threshold: hysteresis and min duration; spans set operations', () => {
  const s = sig((t) => (t < 10000 ? 40 : t < 10100 ? 60 : t < 10150 ? 49.5 : t < 20000 ? 60 : 40));
  const on = evalNode('spans.threshold', { signal: s }, { params: { level: 50, hysteresis: 2 } }).values.spans;
  assert.deepEqual(on.map((x) => [x.t0, x.t1]), [[10000, 20000]]); // the dip to 49.5 stays inside the hysteresis
  const none = evalNode('spans.threshold', { signal: s }, { params: { level: 50, hysteresis: 0, minMs: 5000 } }).values.spans;
  assert.deepEqual(none.map((x) => [x.t0, x.t1]), [[10160, 20000]]);
  const A = [{ t0: 0, t1: 100, kind: 'a' }], B = [{ t0: 50, t1: 150, kind: 'b' }];
  assert.deepEqual(evalNode('spans.and', { a: A, b: B }).values.spans.map((x) => [x.t0, x.t1, x.kind]), [[50, 100, 'a']]);
  assert.deepEqual(evalNode('spans.minus', { a: A, b: B }).values.spans.map((x) => [x.t0, x.t1]), [[0, 50]]);
  assert.deepEqual(evalNode('spans.or', { a: A, b: B }).values.spans.map((x) => [x.t0, x.t1]), [[0, 150]]);
  assert.deepEqual(evalNode('spans.not', { spans: A }).values.spans.map((x) => [x.t0, x.t1]), [[100, DUR]]);
  assert.deepEqual(evalNode('spans.pad', { spans: A }, { params: { beforeMs: -10, afterMs: 20 } }).values.spans.map((x) => [x.t0, x.t1]), [[10, 120]]);
  assert.deepEqual(evalNode('spans.mergeGaps', { spans: [...A, { t0: 300, t1: 400 }, { t0: 1500, t1: 1600 }] }, { params: { gapMs: 500 } }).values.spans.map((x) => [x.t0, x.t1]), [[0, 400], [1500, 1600]]);
  assert.deepEqual(evalNode('spans.between', { spans: [{ t0: 1000, t1: 1000 }, { t0: 5000, t1: 5000 }] }).values.spans.map((x) => [x.t0, x.t1]), [[0, 1000], [1000, 5000], [5000, DUR]]);
  const f = evalNode('spans.filter', { spans: [{ t0: 0, t1: 10, value: -1 }, { t0: 20, t1: 30, value: 1 }, { t0: 40, t1: 50 }] }, { params: { value: 'below', valueA: 0 } }).values.spans;
  assert.deepEqual(f.map((x) => x.t0), [0]);
  const env = evalNode('spans.envelope', { spans: [{ t0: 10000, t1: 20000 }] }, { params: { attackMs: 2000, releaseMs: 2000 } }).values.signal;
  assert.equal(at(env, 9000), 0); assert.equal(at(env, 11000), 0.5); assert.equal(at(env, 15000), 1); assert.equal(at(env, 19000), 0.5);
});

test('an.stat over scripts (time-weighted) and signals, optionally inside spans', () => {
  const s = [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }];
  assert.ok(Math.abs(evalNode('an.stat', { in: s }).values.value - 50) < 1e-9);
  assert.equal(evalNode('an.stat', { in: s }, { params: { fn: 'max' } }).values.value, 100);
  const x = sig((t) => (t < 30000 ? 10 : 30));
  assert.equal(evalNode('an.stat', { in: x, where: [{ t0: 40000, t1: 50000 }] }).values.value, 30);
  assert.equal(evalNode('an.stat', { in: sig(() => NaN) }).status, 'error', 'no data is an error, never a silent 0');
});

test('src.run: channels, confidence, fallback to the ghost, missing run', () => {
  const snap = makeSnapshot(2);
  const r = evalNode('src.run', {}, { params: { run: 'run1', channel: 'x' }, snap }).values;
  let lo = Infinity, hi = -Infinity;
  for (const v of r.signal.v) if (v === v) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(lo >= -1e-3 && hi <= 100 + 1e-3 && hi - lo > 90, `fit: ${lo}..${hi}`);
  assert.deepEqual(r.scenes.map((s) => s.value), [1, -1]);
  assert.ok(r.events.some((e) => e.kind === 'orgasm' && e.t1 > e.t0));
  const prim = evalNode('src.run', {}, { params: { run: 'run1' }, snap }).values;
  assert.ok(Number.isNaN(at(prim.signal, 20700)), 'lost samples are NaN');
  assert.ok(at(prim.confidence, 1000) > 0 && at(prim.confidence, 1000) <= 1);
  snap.ghosts = [...snap.ghosts, { id: 'run9', name: 'old run', script: snap.axes.stroke }];
  const fb = evalNode('src.run', {}, { params: { run: 'run9' }, snap });
  assert.equal(fb.status, 'ok');
  assert.ok(fb.diags.some((d) => d.code === 'source-missing'));
  assert.deepEqual(fb.values.points, snap.axes.stroke);
  assert.equal(evalNode('src.run', {}, { params: { run: 'nope' }, snap }).status, 'error');
  assert.equal(evalNode('src.ghost', {}, { params: { ghost: 'Tracker' }, snap }).status, 'ok', 'ghosts bind by name too');
});

test('src.plan: kinds filter and segment data', () => {
  const snap = makeSnapshot(2);
  const r = evalNode('src.plan', {}, { params: { kinds: ['orgasm', 'oral'] }, snap }).values.spans;
  assert.deepEqual(r.map((s) => s.kind), ['oral', 'orgasm']);
  assert.equal(r[1].data.id, 'p5');
  const tl = evalNode('src.trackSpans', {}, { snap }).values.spans;
  assert.deepEqual(tl.map((s) => s.kind), ['idle', 'penetration', 'orgasm']);
});

test('sig.smooth is zero-phase and keeps gaps; sig.delay shifts; sig.median removes a spike', () => {
  const pulse = sig((t) => (t === 10000 ? 100 : t > 20000 && t < 21000 ? NaN : 0));
  for (const method of ['gaussian', 'moving', 'savgol', 'onepole']) {
    const r = evalNode('sig.smooth', { signal: pulse }, { params: { method, windowMs: 400 } }).values.signal;
    assert.ok(Math.abs(at(r, 9900) - at(r, 10100)) < 1e-4, `${method} symmetric`);
    assert.ok(Number.isNaN(at(r, 20500)), `${method} keeps the gap`);
  }
  const d = evalNode('sig.delay', { signal: pulse }, { params: { ms: 100 } }).values.signal;
  assert.equal(at(d, 10100), 100);
  const m = evalNode('sig.median', { signal: pulse }, { params: { windowMs: 100 } }).values.signal;
  assert.equal(at(m, 10000), 0);
});

test('sig.phaseWave, sig.lfo, sig.noise are deterministic functions of time', () => {
  const ph = sig((t) => (t % 1000) / 1000);
  const w = evalNode('sig.phaseWave', { phase: ph }, { params: { center: 50, depth: 20, offset: 0.25 } }).values.signal;
  assert.ok(Math.abs(at(w, 5000) - 70) < 1e-4); assert.ok(Math.abs(at(w, 5500) - 30) < 1e-4);
  const l = evalNode('sig.lfo', {}, { params: { periodMs: 800, lo: 0, hi: 100, shape: 'triangle' } }).values.signal;
  assert.equal(at(l, 200), 100); assert.equal(at(l, 600), 0); assert.equal(at(l, 0), 50);
  const n1 = evalNode('sig.noise', {}, { params: { seed: 5 } }).values.signal, n2 = evalNode('sig.noise', {}, { params: { seed: 5 } }).values.signal;
  assert.deepEqual(n1.v, n2.v);
  const n3 = evalNode('sig.noise', {}, { params: { seed: 6 } }).values.signal;
  assert.notDeepEqual(n1.v, n3.v);
});

test('sig.sampleAt at a script\'s times plus mids; sig.peaks', () => {
  const s = sig((t) => t / 100);
  const times = [{ at: 1000, pos: 0 }, { at: 2000, pos: 0 }];
  assert.deepEqual(evalNode('sig.sampleAt', { signal: s, times }, { params: { also: 'mids' } }).values.script, [{ at: 1000, pos: 10 }, { at: 1500, pos: 15 }, { at: 2000, pos: 20 }]);
  const pk = evalNode('sig.peaks', { signal: sig((t) => 50 + 40 * Math.sin((2 * Math.PI * t) / 1000)) }, { params: { which: 'tops' } }).values.points;
  assert.ok(pk.length > 50 && pk.every((p) => p.kind === 'top' && Math.abs(((p.t0 - 250) % 1000 + 1000) % 1000) <= 2));
});

test('out.axis modes: replace, merge and inside', () => {
  const snap = makeSnapshot(3);
  snap.axes = { ...snap.axes, stroke: flat(101, 100, 100) };
  const input = [{ at: 2000, pos: 0 }, { at: 3000, pos: 0 }];
  assert.deepEqual(evalNode('out.axis', { script: input }, { snap }).values.result, input);
  const m = evalNode('out.axis', { script: input }, { params: { mode: 'merge' }, snap }).values.result;
  assert.equal(m.length, 101); assert.equal(m.find((a) => a.at === 2000).pos, 0);
  const ins = evalNode('out.axis', { script: input }, { params: { mode: 'inside' }, snap }).values.result;
  assert.ok(ins.filter((a) => a.at > 2000 && a.at < 3000).length === 0, 'replaced inside the input\'s own extent');
  assert.equal(ins.find((a) => a.at === 1900).pos, 100); assert.equal(ins.find((a) => a.at === 3100).pos, 100);
  const w = evalNode('out.axis', { script: flat(101, 0, 100), where: [{ t0: 5000, t1: 6000 }] }, { params: { mode: 'inside' }, snap }).values.result;
  assert.equal(w.find((a) => a.at === 5500).pos, 0); assert.equal(w.find((a) => a.at === 4000).pos, 100);
});

test('nodes never mutate their inputs (typed arrays included)', () => {
  const rng = mulberry32(4), s = randomSignal(rng), copy = Float32Array.from(s.v);
  for (const def of reg.list().filter((d) => d.type.startsWith('sig.'))) {
    const ins = {};
    for (const p of reg.portsOf({ type: def.type }).ins) if (p.type === 'signal' && (p.required || p.name === 'a')) ins[p.name] = s;
    if (!Object.keys(ins).length) continue;
    evalNode(def.type, ins);
  }
  assert.deepEqual(s.v, copy);
  const script = sampleScript([{ at: 0, pos: 0 }, { at: 100, pos: 100 }], gridFor({ t0: 0, t1: 100 }, 20));
  assert.ok(script.v.length === 6);
});
