// Autorange (src/lib/autorange.js): per-scene depth bands from the policy table, applied as Reshape effects; gap fills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangePlan, applyRangePlan, setSceneRange, gapScript, gapText, isAuto, RULES } from '../src/lib/autorange.js';
import { applyFx, baseTurns } from '../src/lib/fx.js';
import { withMods } from '../src/features/timeline/mods.js';
import { dragBand, policyModel } from '../src/features/timeline/range-edit.js';

// strokes 0 <-> 100, half-stroke `half` ms, over [t0, t1)
const strokes = (t0, t1, half = 400, lo = 0, hi = 100) => { const s = []; let k = 0; for (let t = t0; t < t1; t += half) s.push({ at: t, pos: k++ % 2 ? hi : lo }); return s; };
const sc = (a, b, tags, extra = {}) => ({ start_ms: a, end_ms: b, tags, ...extra });
const PEN = ['anal', 'penetration'];
const run = (n, len = 20000, tags = PEN) => Array.from({ length: n }, (_, i) => sc(i * len, (i + 1) * len, tags));

test('the policy table has a reason for every rule', () => {
  for (const r of RULES) assert.equal(typeof r.reason, 'function', r.id);
  assert.deepEqual(RULES.map((r) => r.id), ['manual', 'unseen', 'inherit', 'rest-after', 'rest', 'insertion', 'pullout', 'orgasm', 'exposed', 'build-up']);
});

test('build-up: a penetration run deepens monotonically, tip only first, full depth by the end', () => {
  const scenes = run(4), plan = rangePlan(scenes, strokes(0, 80000));
  const los = plan.flatMap((r) => [r.lo, r.lo1]), his = plan.flatMap((r) => [r.hi, r.hi1]);
  for (let k = 1; k < los.length; k++) assert.ok(los[k] <= los[k - 1], `deep end never shallower: ${los}`);
  assert.ok(plan[0].lo >= 60 && plan[0].hi === 100, 'tip only at the start');
  assert.equal(plan[3].lo1, 0, 'full depth at the end');
  assert.ok(his.every((h) => h >= 85));
  assert.match(plan[0].reason, /tip only/);
  for (const r of plan) assert.equal(r.source, 'tracked');
  // continuous across the cut: one scene ends where the next starts
  for (let k = 1; k < plan.length; k++) assert.equal(plan[k].lo, plan[k - 1].lo1);
  // buildUp 0 = no build-up: full range from the first scene
  assert.equal(rangePlan(scenes, strokes(0, 80000), { policy: { buildUp: 0 } })[0].lo, 0);
});

test('oral / handjob get shallower bands than penetration', () => {
  const scenes = [sc(0, 20000, ['oral', 'penetration']), sc(20000, 40000, ['handjob'])];
  const plan = rangePlan(scenes, strokes(0, 40000), { policy: { buildUp: 0 } });
  assert.equal(plan[0].family, 'oral');
  assert.ok(plan[0].lo >= 40, `oral deep end ${plan[0].lo}`);
  assert.equal(plan[1].family, 'foreplay');
  assert.ok(plan[1].lo >= 50 && plan[1].hi <= 95);
});

test('knotting density: one knot = no reserve; knot cycles over half the run = full reserve, the knot span left to the knot', () => {
  const scenes = run(3, 20000, [...PEN, 'knotting']).map((s) => ({ ...s, tags: PEN }));   // tags without knotting: only the effects count
  const script = strokes(0, 60000);
  // run A: one single knot (a 4 s push near the end, no turns in it would make it single; mode set explicitly)
  const one = [{ id: 'k1', kind: 'knotting', t0: 54000, t1: 58000, params: { mode: 'single' } }];
  const A = rangePlan(scenes, script, { fx: one, policy: { buildUp: 0 } });
  assert.ok(A[0].run.density < 0.1);
  assert.equal(A[0].lo, 0, 'little knotting: the strokes use the full depth');
  assert.match(A[0].reason, /no reserve/);
  // the knot span is excluded and the tie after it holds deep
  const last = A[2].pieces;
  assert.ok(last.every((p) => p.t1 <= 54000 || p.t0 > 58000), 'no piece inside the knot');
  assert.ok(last.some((p) => p.tie && p.lo === 0 && p.hi === 15), 'the tie after a single knot');
  // run B: knot cycles over half the run's time
  const cycles = [{ id: 'kc', kind: 'knotting', t0: 10000, t1: 40000, params: { mode: 'cycles' } }];
  const B = rangePlan(scenes, script, { fx: cycles, policy: { buildUp: 0 } });
  assert.equal(Math.round(B[0].run.density * 100), 50);
  for (const r of B) assert.ok(r.lo >= 20 && r.lo1 >= 20, `ordinary strokes above the reserve: ${r.lo}`);
  assert.match(B[0].reason, /knotting 50 % of this run → floor 20/);
  assert.ok(B[1].pieces.length === 0 || B[1].pieces.every((p) => p.t1 <= 10000 || p.t0 > 40000), 'the cycles span belongs to the knot');
  // in between: a share of the reserve (25 % knotting -> half)
  const mid = rangePlan(scenes, script, { fx: [{ id: 'km', kind: 'knotting', t0: 0, t1: 15000, params: { mode: 'cycles' } }], policy: { buildUp: 0 } });
  assert.ok(mid[1].lo > 0 && mid[1].lo < 20, `interpolated floor ${mid[1].lo}`);
  // the pill is the maximum: a dense run with knotReserve 25 -> floor 30
  assert.equal(rangePlan(scenes, script, { fx: cycles, policy: { buildUp: 0, knotReserve: 25 } })[0].lo, 30);
});

test('applied: the knot keeps its full depth, the strokes before it stay above the reserve', () => {
  const scenes = run(2), script = strokes(0, 40000);
  const fx = [{ id: 'kc', kind: 'knotting', t0: 4000, t1: 24000, params: { mode: 'cycles' } }];
  const plan = rangePlan(scenes, script, { fx, policy: { buildUp: 0 } });
  const all = applyRangePlan(fx, plan), out = applyFx(script, all);
  const before = out.filter((a) => a.at > 200 && a.at < 3800), knot = out.filter((a) => a.at > 4500 && a.at < 23500);
  assert.ok(before.length && before.every((a) => a.pos >= 20), 'strokes before the knot >= 20');
  assert.equal(Math.min(...knot.map((a) => a.pos)), 0, 'the knot reaches 0');
});

test('machine: never below the floor (the policy\'s, or the profile\'s min position)', () => {
  const scenes = withMods([...run(3), sc(60000, 70000, PEN)], [{ id: 'o', kind: 'orgasm', t0: 60000, t1: 70000 }]), script = strokes(0, 70000);
  const plan = rangePlan(scenes, script, { policy: { device: 'machine', floor: 25 } });
  for (const r of plan) for (const k of ['lo', 'lo1', 'hi', 'hi1']) assert.ok(r[k] >= 25, `${k} ${r[k]}`);
  const p2 = rangePlan(scenes, script, { policy: { device: 'machine', floor: 0 }, profile: { range: [30, 100] } });
  assert.ok(p2.every((r) => r.lo >= 30));
  // a profile that says it is a machine wins over the toggle
  assert.ok(rangePlan(scenes, script, { profile: { device: 'machine', range: [0, 100] } }).every((r) => r.lo >= 20));
  // stroker reaches 0; a dragged band on a machine is held to the floor too
  assert.equal(Math.min(...rangePlan(scenes, script).map((r) => r.lo1)), 0);
  const man = setSceneRange(scenes, 0, { lo: 0, hi: 90 });
  assert.equal(rangePlan(man, script, { policy: { device: 'machine', floor: 25 } })[0].lo, 25);
  // machine bands are tighter than the stroker's
  const st = rangePlan(run(1), strokes(0, 20000), { policy: { buildUp: 0 } })[0], mc = rangePlan(run(1), strokes(0, 20000), { policy: { buildUp: 0, device: 'machine', floor: 0 } })[0];
  assert.ok(mc.hi - mc.lo < st.hi - st.lo);
});

test('orgasm: the deepest band of its run; after / outro ease to rest and hold; intro rests', () => {
  const scenes = withMods([sc(0, 5000, ['intro']), ...run(3).map((s) => ({ ...s, start_ms: s.start_ms + 5000, end_ms: s.end_ms + 5000 })),
    sc(65000, 75000, PEN), sc(75000, 85000, ['after']), sc(85000, 90000, ['outro'])], [{ id: 'o', kind: 'orgasm', t0: 65000, t1: 75000 }]);   // the Orgasm modifier
  const script = strokes(0, 90000), plan = rangePlan(scenes, script);
  const org = plan[4];
  assert.equal(org.rule, 'orgasm');
  for (const r of plan.slice(1, 4)) assert.ok(org.lo <= Math.min(r.lo, r.lo1) && org.hi <= Math.min(r.hi, r.hi1), 'deepest');
  assert.equal(plan[0].lo, 100); assert.equal(plan[0].hi, 100);
  for (const r of plan.slice(5)) { assert.equal(r.lo1, 100); assert.equal(r.hi1, 100); }
  assert.equal(plan[5].lo, org.lo1, 'after eases from where the orgasm ended');
  // spurts stay untouched: they come after the autorange effect (later t0) and ride on its trace
  const fx = applyRangePlan([{ id: 'sp', kind: 'spurt', t0: 70000, t1: 70000 }], plan);
  assert.ok(fx.findIndex((e) => e.id === 'sp') > fx.findIndex((e) => isAuto(e) && e.t0 === 65000));
  assert.deepEqual(fx.find((e) => e.id === 'sp'), { id: 'sp', kind: 'spurt', t0: 70000, t1: 70000 });
});

test('continuing scenes share one progression across a cutaway; a structure scene ends a run', () => {
  const scenes = [sc(0, 20000, PEN), sc(20000, 25000, ['offscreen']), sc(25000, 45000, PEN, { continues: true })];
  const script = [...strokes(0, 20000), ...strokes(25000, 45000)], plan = rangePlan(scenes, script);
  assert.equal(plan[0].run.id, plan[2].run.id);
  assert.deepEqual([plan[2].run.n, plan[2].run.k], [1, 2]);
  assert.equal(plan[2].lo, plan[0].lo1, 'the progression carries on behind the cutaway');
  assert.equal(plan[1].source, 'none'); assert.equal(plan[1].rule, 'inherit');
  const broken = rangePlan([sc(0, 20000, PEN), sc(20000, 25000, ['idle']), sc(25000, 45000, PEN)], script);
  assert.notEqual(broken[0].run.id, broken[2].run.id);
  assert.equal(broken[2].run.n, 0);
});

test('manual override wins and lands in the effect', () => {
  const scenes = setSceneRange(run(2), 1, { lo: 30, hi: 70 }), script = strokes(0, 40000);
  const plan = rangePlan(scenes, script);
  assert.equal(plan[1].rule, 'manual');
  assert.deepEqual([plan[1].lo, plan[1].hi, plan[1].lo1, plan[1].hi1], [30, 70, 30, 70]);
  const e = applyRangePlan([], plan).find((x) => x.t0 === 20000);
  assert.deepEqual(e.params, { lo: 30, hi: 70 });
  const out = applyFx(script, [e]).filter((a) => a.at >= 20000 && a.at < 40000);
  assert.ok(out.every((a) => a.pos >= 30 && a.pos <= 70) && out.some((a) => a.pos === 30) && out.some((a) => a.pos === 70));
  assert.equal(setSceneRange(scenes, 1, null)[1].range, undefined, 'cleared = back to the policy');
});

test('re-plan replaces only the live autorange effects; baked scenes stay; `only` redoes a scene', () => {
  const scenes = run(3), script = strokes(0, 60000), plan = rangePlan(scenes, script);
  const user = { id: 'u', kind: 'shape', t0: 2000, t1: 8000, params: { dwellTop: 0.2 } };
  const old = { id: 'old', kind: 'shape', t0: 0, t1: 19999, label: 'autorange', auto: true, params: { lo: 1, hi: 2 } };
  const baked = { id: 'bk', kind: 'shape', t0: 20000, t1: 39999, label: 'autorange', auto: true, baked: true, params: { lo: 1, hi: 2 } };
  const next = applyRangePlan([old, user, baked], plan);
  assert.ok(next.includes(user), 'the user\'s effect untouched');
  assert.ok(!next.includes(old), 'the old live autorange effect replaced');
  assert.ok(next.includes(baked), 'baked stays');
  assert.equal(next.filter((e) => isAuto(e) && e.t0 >= 20000 && e.t1 <= 40000).length, 1, 'no second effect over a baked scene');
  assert.equal(next.filter(isAuto).length, 3);
  assert.ok(next.indexOf(next.find((e) => isAuto(e) && e.t0 === 0)) < next.indexOf(user), 'autorange first: the user\'s effects act on top');
  for (const e of next.filter((x) => isAuto(x) && !x.baked)) assert.deepEqual(Object.keys(e.params).filter((k) => !['lo', 'hi', 'loEnd', 'hiEnd'].includes(k)), [], 'nothing else set');
  const redo = applyRangePlan(next, plan, { only: [1] });
  assert.ok(!redo.includes(baked) && redo.some((e) => isAuto(e) && e.t0 === 20000 && !e.baked), 'a drag un-bakes its scene');
  assert.equal(JSON.stringify(applyRangePlan(next, plan)), JSON.stringify(next), 'deterministic');
});

test('gap fill: the act\'s recipe inside the scene\'s band, never for scenes with points', () => {
  const scenes = [sc(0, 20000, PEN), sc(20000, 30000, ['oral', 'penetration']), sc(30000, 40000, ['handjob']), sc(40000, 50000, PEN), sc(50000, 60000, PEN)];
  const script = [...strokes(0, 20000, 350), ...strokes(50000, 60000, 350)];
  const plan = rangePlan(scenes, script, { policy: { buildUp: 0 } });
  const [oral, hand, pen] = [plan[1], plan[2], plan[3]];
  assert.deepEqual([oral.source, oral.kind, oral.recipe], ['gap', 'oral', 'oral']);
  assert.deepEqual([hand.source, hand.kind, hand.recipe], ['gap', 'foreplay', 'smooth-small']);
  assert.deepEqual([pen.source, pen.kind, pen.recipe], ['gap', 'penetration', 'penetration']);
  assert.equal(plan[0].source, 'tracked');
  assert.match(gapText(oral), /^gap: S2 oral — fill with oral recipe at \d+–\d+$/);
  for (const row of [oral, hand, pen]) {
    const s = gapScript(row, script);
    assert.ok(s.length > 4, row.kind);
    assert.ok(s.every((p) => p.at > row.t0 && p.at < row.t1));
    assert.ok(s.every((p) => p.pos >= Math.min(row.lo, row.lo1) - 1 && p.pos <= Math.max(row.hi, row.hi1) + 1), `${row.kind} inside its band`);
  }
  // penetration carries the neighbours' cadence (350 ms half-strokes) like the bridge
  const T = baseTurns(gapScript(pen, script), pen.t0, pen.t1), d = T.slice(1).map((x, i) => x.at - T[i].at).sort((a, b) => a - b);
  assert.ok(Math.abs(d[d.length >> 1] - 350) < 60, `cadence ${d[d.length >> 1]}`);
  // a scene with a linked run is not a gap; neither is a tracked one
  assert.equal(rangePlan(scenes, script, { linked: (i) => i === 1 })[1].source, 'none');
  assert.deepEqual(applyRangePlan([], plan).filter((e) => e.t0 >= 20000 && e.t1 <= 50000), [], 'gaps get no effect until filled');
});

test('small strokes and fast strokes narrow the band (the tracked stats)', () => {
  const script = [...strokes(0, 20000, 400), ...strokes(20000, 40000, 400, 40, 60), ...strokes(40000, 60000, 100)];
  const plan = rangePlan(run(3), script, { policy: { buildUp: 0 }, maxSpeed: 400 });
  assert.match(plan[1].reason, /small strokes/);
  assert.ok(plan[1].hi - plan[1].lo < plan[0].hi - plan[0].lo);
  assert.match(plan[2].reason, /fast \(100 ms/);
  assert.ok(plan[2].hi - plan[2].lo <= 40);
});

test('Reshape loEnd / hiEnd: the band slides over the span; edge points stay inside the band', () => {
  const script = strokes(0, 20000), e = { id: 'a', kind: 'shape', t0: 0, t1: 20000, params: { lo: 60, hi: 100, loEnd: 0, hiEnd: 90 } };
  const out = applyFx(script, [e]);
  const early = out.filter((a) => a.at < 2000), late = out.filter((a) => a.at > 18000);
  assert.ok(early.every((a) => a.pos >= 55), 'shallow at the start');
  assert.ok(Math.min(...late.map((a) => a.pos)) <= 10 && Math.max(...late.map((a) => a.pos)) <= 92, 'deep at the end');
  assert.ok(out[0].pos >= 60, 'the first point (not a turn) follows the band');
});

test('Range row: drag math and the policy curve', () => {
  const b = { lo: 20, hi: 80, lo1: 10, hi1: 90 };
  assert.deepEqual(dragBand(b, 'hi', 50), { lo: 20, hi: 90, lo1: 10, hi1: 100 });
  assert.deepEqual(dragBand(b, 'lo', 100), { lo: 80, hi: 80, lo1: 70, hi1: 90 }, 'never past the other edge');
  assert.deepEqual(dragBand(b, 'body', -30), { lo: 10, hi: 70, lo1: 0, hi1: 80 });
  const st = policyModel({}), mc = policyModel({ device: 'machine', floor: 20 });
  assert.ok(['ladders.penetration.at', 'knotReserve'].every((key) => st.handles.some((h) => h.key === key)));
  assert.ok(mc.handles.some((h) => h.key === 'floor') && !st.handles.some((h) => h.key === 'floor'));
  const h = st.handles.find((x) => x.key === 'ladders.penetration.at');
  assert.ok(Math.abs(h.toValue(h.x, h.y) - 0.6) < 0.02, 'build-up handle round-trips');
  const k = st.handles.find((x) => x.key === 'knotReserve');
  assert.ok(Math.abs(k.toValue(k.x, k.y) - 15) < 0.5, 'knot reserve handle round-trips');
});

test('exposed: rest band 85–100, in no run (transparent like a cutaway); throbbing leaves the band as it is', () => {
  const scenes = withMods([sc(0, 20000, PEN), sc(20000, 40000, ['exposed']), sc(40000, 60000, PEN), sc(60000, 80000, ['exposed'])], [{ id: 't', kind: 'throbbing', t0: 60000, t1: 80000 }]);
  const plan = rangePlan(scenes, strokes(0, 80000, 400, 90, 100));
  for (const k of [1, 3]) {
    assert.equal(plan[k].rule, 'exposed');
    assert.deepEqual([plan[k].lo, plan[k].hi, plan[k].lo1, plan[k].hi1], [85, 100, 85, 100]);
    assert.equal(plan[k].run, null);
    assert.match(plan[k].reason, /exposed: rest band 85–100/);
  }
  assert.equal(plan[2].run.n, 1, 'the penetration run continues across the exposed scene');
  // throbbing alone (no act, nothing else): not exposed, no rule of its own -> as before
  const only = rangePlan(withMods([sc(0, 20000, [])], [{ id: 't', kind: 'throbbing', t0: 0, t1: 20000 }]), strokes(0, 20000));
  assert.notEqual(only[0].rule, 'exposed');
});
