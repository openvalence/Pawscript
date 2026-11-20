// Halo honesty (contract §11): for every `local` def, over seeded random inputs and params, the full-timeline value
// sliced to [a, b] equals the windowed value sliced to [a, b]. Runs through the real engine, so the widened ranges and
// the windowed sources are the ones the preview uses. A def (or an EDIT_HALO entry) that fails here may not be local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slice } from '../src/lib/core/script.js';
import { mulberry32 } from '../src/lib/gen/util.js';
import { testRegistry, makeSnapshot, buildGraph, run, randomScript, randomSignal, randomSpans, DUR } from './graph-nodes-fixtures.mjs';

const reg = testRegistry();
const PARAMS = { 'src.ghost': { ghost: 'g1' }, 'src.run': { run: 'run1' } };
const MIN_INPUTS = { 'sig.expr': ['a'], 'flow.select': ['in0'] };
const SKIP_PARAM_RANDOM = new Set(['src.ghost', 'src.run', 'src.axis', 'out.axis']); // their text params name document values

function randomParams(def, rng) {
  const p = {};
  for (const q of def.params) {
    if (q.seed || q.hidden) continue;
    if (q.type === 'number' || q.type === 'int' || q.type === 'float') {
      const lo = Math.max(q.min ?? -20000, -20000), hi = Math.min(q.max ?? 20000, 20000);
      let v = lo + rng() * (hi - lo);
      if (q.type === 'int') v = Math.round(v);
      p[q.key] = v;
    } else if (q.type === 'bool') p[q.key] = rng() < 0.5;
    else if (q.type === 'choice') { const c = q.choices || []; const x = c[Math.floor(rng() * c.length)]; p[q.key] = x && typeof x === 'object' ? x.value : x; }
  }
  return p;
}

/** The part of a value that must agree on [a, b]. */
function view(v, a, b) {
  if (typeof v === 'number') return v;
  if (v && v.v instanceof Float32Array) {
    const out = [];
    for (let i = Math.ceil(a / v.dt); i <= Math.floor(b / v.dt); i++) { const k = i - v.i0; out.push(k >= 0 && k < v.v.length ? v.v[k] : 'missing'); }
    return out;
  }
  // scripts: the actions inside [a, b] (contract §3.2: values outside the range may be missing or approximate)
  if (Array.isArray(v) && v.length && 'at' in v[0]) return slice(v, a, b);
  if (Array.isArray(v)) return v.filter((s) => s.t1 >= a && s.t0 <= b);
  return v;
}

function same(x, y, msg) {
  if (Array.isArray(x) && x.length && typeof x[0] !== 'object') {
    assert.equal(x.length, y.length, msg + ' (length)');
    for (let i = 0; i < x.length; i++) {
      const p = x[i], q = y[i];
      if (p !== p || q !== q || typeof p !== 'number' || typeof q !== 'number') { assert.ok((p !== p && q !== q) || p === q, `${msg} sample ${i}: ${p} vs ${q}`); continue; }
      assert.ok(Math.abs(p - q) <= 1e-4 * Math.max(1, Math.abs(p)), `${msg} sample ${i}: ${p} vs ${q}`);
    }
    return;
  }
  assert.deepEqual(y, x, msg);
}

const locals = reg.list().filter((d) => d.local && !d.type.startsWith('fx.'));

test('there are local defs to check', () => assert.ok(locals.length > 40, String(locals.length)));

for (const def of locals) {
  test(`halo ${def.type}`, () => {
    const rng = mulberry32((Number(process.env.HALO_SEED) || 0) + 1234 + def.type.length * 7919 + def.type.charCodeAt(def.type.length - 1));
    let checked = 0;
    const trials = def.type.startsWith('edit.') || def.type.startsWith('sig.') || def.type.startsWith('script.') ? 12 : 4;
    for (let trial = 0; trial < trials; trial++) {
      const snap = makeSnapshot(11 + trial);
      snap.fx = { script: randomScript(rng), script2: randomScript(rng), signal: randomSignal(rng), signal2: randomSignal(rng),
        spans: randomSpans(rng, 8), points: randomSpans(rng, 40, { pointsShare: 1 }), number: Math.round(rng() * 100) };
      const params = { ...(PARAMS[def.type] || {}), ...(trial === 0 || SKIP_PARAM_RANDOM.has(def.type) ? {} : randomParams(def, rng)) };
      const ports = reg.portsOf({ type: def.type });
      const specs = [{ id: 'n', type: def.type, params }], links = [];
      const variant = trial % 3;
      for (const port of ports.ins) {
        if (!(port.required || trial % 2 === 1 || port.name === 'where' || MIN_INPUTS[def.type]?.includes(port.name))) continue;
        let T = port.type;
        if (T === 'any') T = (port.accepts || ['script', 'signal', 'spans'])[variant % (port.accepts?.length || 3)];
        const key = T === 'spans' ? (port.hint === 'points' || port.name === 'times' ? 'points' : 'spans') : T === 'script' ? (port.name === 'b' || port.name === 'insert' ? 'script2' : 'script') : T === 'signal' ? (port.name === 'b' || port.name === 'cb' ? 'signal2' : 'signal') : 'number';
        specs.push({ id: 'i_' + port.name, type: 'fx.' + T, params: { key } });
        links.push(['i_' + port.name, 'value', 'n', port.name]);
      }
      const g = buildGraph(reg, specs, links);
      const full = run(reg, g, snap, { targets: ['n'] }).res;
      if (full.status.get('n') !== 'ok') continue; // a random param set the node refuses (e.g. equal range ends) proves nothing
      for (let w = 0; w < 3; w++) {
        const a = Math.floor(rng() * (DUR - 4000)), b = Math.min(DUR, a + 1000 + Math.floor(rng() * 14000));
        const win = run(reg, g, snap, { targets: ['n'], range: { t0: a, t1: b } }).res;
        assert.equal(win.status.get('n'), 'ok', `${def.type} windowed status (params ${JSON.stringify(params)})`);
        for (const op of ports.outs) {
          const x = full.values.get(`n:${op.name}`), y = win.values.get(`n:${op.name}`);
          if (x === undefined) { assert.equal(y, undefined); continue; }
          same(view(x, a, b), view(y, a, b), `${def.type}.${op.name} on [${a}, ${b}] trial ${trial} params ${JSON.stringify(params)}`);
        }
        checked++;
      }
    }
    assert.ok(checked > 0, `${def.type}: nothing checked`);
  });
}
