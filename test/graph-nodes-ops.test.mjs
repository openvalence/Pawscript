// Wrapped library calls equal the direct library calls: every edit op (whole script, one span through the clipped fold,
// several spans with per-kind overrides), every select op, every generator, and gen.plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeValues } from '../src/ui/kit/params.js';
import { mulberry32, hashSeed, DEFAULTS } from '../src/lib/gen/util.js';
import { OPS } from '../src/lib/edit/index.js';
import { GENERATORS } from '../src/lib/gen/generators.js';
import { RECIPES } from '../src/lib/gen/recipes.js';
import { compilePlan } from '../src/lib/gen/plan.js';
import { atsToSpans } from '../src/lib/graph/types.js';
import { EXCLUDED_OPS, FOLD_HALO, EDIT_HALO } from '../src/lib/graph/nodes/index.js';
import { testRegistry, makeSnapshot, buildGraph, run, randomScript, DUR } from './graph-nodes-fixtures.mjs';

const reg = testRegistry();
const snap = makeSnapshot(3);
const FRAME = 1000 / 30;

function randomParams(def, rng) {
  const p = {};
  for (const q of def.params) {
    if (q.seed) { p[q.key] = Math.floor(rng() * 1e6); continue; }
    if (q.type === 'number' || q.type === 'int') { const v = q.min + rng() * (q.max - q.min); p[q.key] = q.type === 'int' ? Math.round(v) : v; }
    else if (q.type === 'bool') p[q.key] = rng() < 0.5;
    else if (q.type === 'choice') p[q.key] = q.choices[Math.floor(rng() * q.choices.length)];
  }
  return p;
}
// moderate random params: huge time params make every op degenerate
function moderate(op, rng) {
  const p = {};
  for (const q of op.params) {
    if (q.type === 'number' && op.playhead !== q.key) { const lo = Math.max(q.min, -5000), hi = Math.min(q.max, 5000); p[q.key] = lo + rng() * (hi - lo); }
    else if (q.type === 'choice') p[q.key] = q.choices[Math.floor(rng() * q.choices.length)];
    else if (q.type === 'bool') p[q.key] = rng() < 0.5;
  }
  return p;
}

const edits = OPS.filter((o) => !EXCLUDED_OPS.includes(o.id));

for (const op of edits) {
  const sel = op.group === 'select' || op.selection;
  const type = `${sel ? 'select' : 'edit'}.${op.id}`;
  test(`${type} equals the direct call`, () => {
    const def = reg.get(type), rng = mulberry32(hashSeed(op.id));
    for (let trial = 0; trial < 6; trial++) {
      const s = randomScript(rng);
      snap.fx = { script: s };
      const params = trial === 0 ? {} : moderate(op, rng);
      const g = buildGraph(reg, [{ id: 'i', type: 'fx.script', params: { key: 'script' } }, { id: 'n', type, params }], [['i', 'value', 'n', 'script']]);
      const { res } = run(reg, g, snap, { targets: ['n'] });
      assert.equal(res.status.get('n'), 'ok', JSON.stringify(res.diags));
      const p = normalizeValues(def.params, g.nodes.find((n) => n.id === 'n').params);
      if ((op.id === 'quantize' || op.id === 'nudgeTime') && !(p.frameMs > 0)) p.frameMs = FRAME;
      const want = op.apply(s, null, p);
      if (sel) assert.deepEqual(res.values.get('n:points'), atsToSpans(want.ats));
      else {
        assert.deepEqual(res.values.get('n:script'), want.script, `${type} trial ${trial}`);
        assert.deepEqual(res.values.get('n:changed'), atsToSpans(want.ats));
      }
    }
  });
}

for (const op of edits.filter((o) => !(o.group === 'select' || o.selection))) {
  test(`edit.${op.id}: the per-span fold equals the direct call with that range`, () => {
    const type = `edit.${op.id}`, def = reg.get(type), rng = mulberry32(hashSeed('fold', op.id));
    for (let trial = 0; trial < 40; trial++) {
      const s = randomScript(rng);
      const t0 = Math.floor(rng() * (DUR - 8000)), t1 = t0 + 100 + Math.floor(rng() * 8000);
      const point = trial % 10 === 9 && s.length > 4;
      const span = point ? { t0: s[3].at, t1: s[3].at, kind: 'k' } : { t0, t1, kind: 'k' };
      snap.fx = { script: s, where: [span] };
      const params = trial % 2 ? moderate(op, rng) : {};
      const g = buildGraph(reg, [{ id: 'i', type: 'fx.script', params: { key: 'script' } }, { id: 'w', type: 'fx.spans', params: { key: 'where' } }, { id: 'n', type, params }],
        [['i', 'value', 'n', 'script'], ['w', 'value', 'n', 'where']]);
      const { res } = run(reg, g, snap, { targets: ['n'] });
      const p = normalizeValues(def.params, g.nodes.find((n) => n.id === 'n').params);
      if ((op.id === 'quantize' || op.id === 'nudgeTime') && !(p.frameMs > 0)) p.frameMs = FRAME;
      let want;
      try { want = op.apply(s, point ? { ats: [span.t0] } : { t0: span.t0, t1: span.t1 - 1 }, p); } catch { continue; }
      assert.equal(res.status.get('n'), 'ok', JSON.stringify(res.diags.filter((d) => d.node === 'n')));
      assert.deepEqual(res.values.get('n:script'), want.script, `${type} trial ${trial} span ${JSON.stringify(span)} params ${JSON.stringify(params)} (fold halo ${(FOLD_HALO[op.id] ?? EDIT_HALO[op.id])?.(p)})`);
    }
  });
}

test('the fold honours per-kind overrides and leaves the outside alone', () => {
  const s = randomScript(mulberry32(5)).map((a) => ({ at: a.at, pos: 50 }));
  snap.fx = { script: s, where: [{ t0: 10000, t1: 20000, kind: 'a' }, { t0: 30000, t1: 40000, kind: 'b' }] };
  const g = buildGraph(reg, [{ id: 'i', type: 'fx.script', params: { key: 'script' } }, { id: 'w', type: 'fx.spans', params: { key: 'where' } },
    { id: 'n', type: 'edit.offset', params: { amount: 10 }, byKind: { b: { amount: -20 } } }], [['i', 'value', 'n', 'script'], ['w', 'value', 'n', 'where']]);
  const out = run(reg, g, snap, { targets: ['n'] }).res.values.get('n:script');
  for (const a of out) assert.equal(a.pos, a.at >= 10000 && a.at < 20000 ? 60 : a.at >= 30000 && a.at < 40000 ? 30 : 50, `at ${a.at}`);
  const changed = run(reg, g, snap, { targets: ['n'] }).res.values.get('n:changed');
  assert.ok(changed.length > 0 && changed.every((c) => c.t0 === c.t1 && ((c.t0 >= 10000 && c.t0 < 20000) || (c.t0 >= 30000 && c.t0 < 40000))));
});

test('time-shifting ops fold right to left and are flagged', () => {
  const def = reg.get('edit.shift');
  assert.equal(def.timeShift, true);
  assert.equal(reg.get('edit.offset').timeShift, undefined);
});

test('quantize defaults to the media frame', () => {
  const s = [{ at: 0, pos: 0 }, { at: 1017, pos: 100 }, { at: 2049, pos: 0 }];
  snap.fx = { script: s };
  const g = buildGraph(reg, [{ id: 'i', type: 'fx.script', params: { key: 'script' } }, { id: 'n', type: 'edit.quantize' }], [['i', 'value', 'n', 'script']]);
  assert.equal(g.nodes.find((n) => n.id === 'n').params.frameMs, 0);
  const out = run(reg, g, snap, { targets: ['n'] }).res.values.get('n:script');
  assert.deepEqual(out.map((a) => a.at), [0, 1033, 2033]); // 30 fps frames: 31 × 33.33, 61 × 33.33
});

for (const [id, g0] of Object.entries(GENERATORS)) {
  test(`gen.${id} equals the direct generator call`, () => {
    const type = `gen.${id}`, def = reg.get(type), rng = mulberry32(hashSeed('gen', id));
    const turns = snap.axes.stroke.filter((_, i) => i % 2 === 0).map((a, i) => ({ t0: a.at, t1: a.at, kind: i % 2 ? 'top' : 'bottom' }));
    snap.fx = { turns, where: [{ t0: 5000, t1: 15000, kind: 'climax', data: { id: 'x' } }, { t0: 15000, t1: 22000, kind: 'oral' }] };
    for (let trial = 0; trial < 3; trial++) {
      const params = trial ? { ...randomParams(def, rng), maxSpeed: 450 } : {};
      const specs = [{ id: 'n', type, params }], links = [];
      const extra = id === 'beats' ? 'beats' : id === 'follow' || id === 'knot' ? 'turns' : null;
      if (extra) { specs.push({ id: 't', type: 'fx.spans', params: { key: 'turns' } }); links.push(['t', 'value', 'n', extra]); }
      const g = buildGraph(reg, specs, links);
      const p = normalizeValues(def.params, g.nodes.find((n) => n.id === 'n').params);
      const { maxSpeed, ...gp } = p;
      const ctx = { seed: 0, maxSpeed, minGapMs: DEFAULTS.minGapMs, turns: extra === 'turns' ? turns.map((s) => ({ at: s.t0, kind: s.kind })) : [], beats: extra === 'beats' ? turns.map((s) => s.t0) : [] };
      const { res } = run(reg, g, snap, { targets: ['n'] });
      assert.equal(res.status.get('n'), 'ok', JSON.stringify(res.diags));
      assert.deepEqual(res.values.get('n:script'), g0.gen(0, DUR, gp, ctx), `${type} trial ${trial}`);
    }
    // inside spans: each span generated over its own extent
    const g = buildGraph(reg, [{ id: 'n', type }, { id: 'w', type: 'fx.spans', params: { key: 'where' } }], [['w', 'value', 'n', 'where']]);
    const out = run(reg, g, snap, { targets: ['n'] }).res.values.get('n:script');
    assert.ok(out.every((a) => a.at >= 5000 && a.at <= 22000), `${type} stays inside the spans`);
    if (id !== 'beats' && id !== 'follow' && id !== 'knot') assert.ok(out.length > 1);
  });
}

test('generator recipes are variants with their params', () => {
  const v = reg.get('gen.pulses').variants;
  assert.ok(v.some((x) => x.id === 'orgasm-pulses' && x.params.rate === 6.8));
  for (const [rid, r] of Object.entries(RECIPES)) assert.ok(reg.get(`gen.${r.gen}`).variants.some((x) => x.id === rid), rid);
});

test('gen.plan equals compilePlan on the plan spans', () => {
  snap.fx = { plan: snap.plan.map((s) => ({ t0: s.t0, t1: s.t1, kind: s.kind, data: { id: s.id } })) };
  const g = buildGraph(reg, [{ id: 's', type: 'fx.spans', params: { key: 'plan' } }, { id: 'n', type: 'gen.plan', params: { seed: 9 } }], [['s', 'value', 'n', 'segments']]);
  const out = run(reg, g, snap, { targets: ['n'] }).res.values.get('n:script');
  const want = compilePlan(snap.plan.map((s) => ({ id: s.id, t0: s.t0, t1: s.t1, kind: s.kind })), { seed: 9, maxSpeed: 450, turns: [] }).script;
  assert.deepEqual(out, want);
});
