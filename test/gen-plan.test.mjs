import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValid, lowerBound } from '../src/lib/core/script.js';
import { compilePlan, recompileSegment, validatePlan, applyPlan, KINDS, RECIPES, tile, extractCycle, mulberry32 } from '../src/lib/gen/index.js';
import { budget } from './perf.mjs';

const W = 300 + 10; // blend window + min gap (the auto-widened window is smaller at 450 pos/s)

function trackerTurns(t0, t1, seed = 3) {
  const rng = mulberry32(seed), out = [];
  for (let t = t0; t < t1; t += 300 + rng() * 250) out.push({ at: Math.round(t), kind: out.length % 2 ? 'top' : 'bottom' });
  return out;
}

const PLAN = [
  { id: 'a', t0: 0, t1: 8000, kind: 'idle' },
  { id: 'b', t0: 8000, t1: 20000, kind: 'fade-in' },
  { id: 'c', t0: 20000, t1: 60000, kind: 'penetration', params: { intensity: 0.8 } },
  { id: 'd', t0: 60000, t1: 84000, kind: 'knotting', recipe: 'knot-tied' },
  { id: 'e0', t0: 84000, t1: 90000, kind: 'climax' },
  { id: 'e', t0: 90000, t1: 110000, kind: 'orgasm', recipe: 'orgasm-pulses' },
  { id: 'f', t0: 110000, t1: 130000, kind: 'afterglow' },
  { id: 'g', t0: 135000, t1: 140000, kind: 'outro' },
];
const CTX = { seed: 11, turns: trackerTurns(15000, 95000) };

function maxSpeed(s) {
  let m = 0;
  for (let i = 1; i < s.length; i++) m = Math.max(m, (Math.abs(s[i].pos - s[i - 1].pos) * 1000) / (s[i].at - s[i - 1].at));
  return m;
}
const between = (s, a, b) => s.filter((x) => x.at > a && x.at < b);
// the step ending at point i is allowed above the cap only inside a knot-stroke segment (its pops), up to popSpeed 600
const popAllowed = (segments, a, b) => segments.some((g) => g.gen === 'knot-stroke' && a.at >= g.t0 && b.at <= g.t1);
function capViolations(s, segments, cap) {
  const out = [];
  for (let i = 1; i < s.length; i++) {
    const v = (Math.abs(s[i].pos - s[i - 1].pos) * 1000) / (s[i].at - s[i - 1].at);
    if (v > (popAllowed(segments, s[i - 1], s[i]) ? Math.max(cap, 600) : cap) + 1e-9) out.push({ at: s[i].at, v });
  }
  return out;
}

function checkCompiled(plan, ctx, res) {
  const s = res.script, cap = ctx.maxSpeed ?? 450, gap = ctx.minGapMs ?? 10;
  assert.ok(isValid(s), 'valid');
  assert.deepEqual(capViolations(s, res.segments, cap), [], 'cap (pops of knot-stroke segments excepted)');
  for (let i = 1; i < s.length; i++) assert.ok(s[i].at - s[i - 1].at >= gap, `min gap at ${s[i].at}`);
  const ok = res.segments;
  for (const a of s) assert.ok(ok.some((g) => a.at >= g.t0 && a.at <= g.t1), `point ${a.at} outside every segment`);
  for (let i = 1; i < ok.length; i++) if (ok[i].t0 > ok[i - 1].t1) assert.equal(between(s, ok[i - 1].t1, ok[i].t0).length, 0, 'gap stays empty');
  assert.equal(ok.reduce((n, g) => n + g.count, 0), s.length, 'counts add up');
}

test('compilePlan: valid, continuous under the cap, gaps empty, counts', () => {
  const res = compilePlan(PLAN, CTX);
  assert.deepEqual(res.issues, []);
  checkCompiled(PLAN, CTX, res);
  assert.deepEqual(res.segments.map((g) => g.recipe), ['hold', 'fade-in', 'penetration', 'knot-tied', 'climax', 'orgasm-pulses', 'afterglow', 'hold']);
  assert.ok(res.segments.every((g) => g.count > 0));
  // climax keeps its onset: pulses start right at the boundary (the outgoing side yields)
  const clim = res.script.filter((a) => a.at >= 90000 && a.at < 92000);
  assert.ok(clim[0].at - 90000 < 200, 'climax starts at its boundary');
  assert.ok(clim.every((a) => a.pos <= 34), 'orgasm pulses stay shallow at the deep end');
});

test('climax -> orgasm -> afterglow: fast full run-in, deep tremor, then the slow ending', () => {
  const plan = [{ id: 'c', t0: 0, t1: 6500, kind: 'climax' }, { id: 'o', t0: 6500, t1: 31500, kind: 'orgasm' }, { id: 'a', t0: 31500, t1: 60000, kind: 'afterglow' }];
  const res = compilePlan(plan, { seed: 2 });
  assert.deepEqual(res.issues, []);
  assert.deepEqual(res.segments.map((g) => g.gen), ['ramp', 'tremor', 'ramp']);
  const run = res.script.filter((a) => a.at > 300 && a.at < 6200), org = res.script.filter((a) => a.at > 7000 && a.at < 31000);
  assert.ok(Math.max(...run.map((a) => a.pos)) >= 85 && Math.min(...run.map((a) => a.pos)) <= 15, 'run-in uses the full range');
  assert.ok(org.every((a) => a.pos <= 20), 'orgasm stays at the deep end');
});

test('compilePlan: deterministic, seed-sensitive, order-independent, inputs untouched', () => {
  const frozen = structuredClone(PLAN);
  const a = compilePlan(PLAN, CTX), b = compilePlan(PLAN, CTX);
  assert.deepEqual(a.script, b.script);
  assert.deepEqual(PLAN, frozen);
  assert.notDeepEqual(compilePlan(PLAN, { ...CTX, seed: 12 }).script, a.script);
  assert.deepEqual(compilePlan([...PLAN].reverse(), CTX).script, a.script);
});

test('compilePlan: lower maxSpeed and larger minGap are respected everywhere', () => {
  for (const ctx of [{ ...CTX, maxSpeed: 200 }, { ...CTX, maxSpeed: 120, minGapMs: 40 }, { ...CTX, blendMs: 0 }]) checkCompiled(PLAN, ctx, compilePlan(PLAN, ctx));
});

test('validation: overlap, duplicate, bad span, unknown kind/recipe are reported and skipped; the rest compiles', () => {
  const bad = [
    ...PLAN.slice(0, 3),
    { id: 'ov', t0: 50000, t1: 52000, kind: 'climax' },          // overlaps c
    { id: 'c', t0: 200000, t1: 210000, kind: 'oral' },           // duplicate id
    { id: 'neg', t0: 5000, t1: 5000, kind: 'oral' },             // empty span
    { id: 'k', t0: 300000, t1: 301000, kind: 'nope' },
    { id: 'r', t0: 302000, t1: 303000, kind: 'oral', recipe: 'nope' },
    { t0: 1, t1: 2, kind: 'oral' },
    { id: 'p', t0: 400000, t1: 401000, kind: 'oral', params: { bogus: 1 } },
  ];
  const issues = validatePlan(bad);
  const errs = issues.filter((x) => x.level === 'error').map((x) => x.id);
  assert.deepEqual(errs.sort(), ['c', 'k', 'neg', 'ov', 'r', null].sort());
  assert.ok(issues.some((x) => x.id === 'p' && x.level === 'warn' && /bogus/.test(x.msg)));
  const res = compilePlan(bad, CTX);
  assert.deepEqual(res.segments.map((g) => g.id), ['a', 'b', 'c', 'p']);
  checkCompiled(bad, CTX, res);
  assert.deepEqual(compilePlan(null).script, []);
});

test('touching boundaries (t0 == previous t1) are not overlaps; the later segment owns the instant', () => {
  const res = compilePlan(PLAN.slice(0, 3), CTX);
  assert.deepEqual(res.issues, []);
  assert.equal(res.script.filter((a) => a.at === 8000).length <= 1, true);
  const b = res.segments.find((g) => g.id === 'b');
  assert.equal(b.count, lowerBound(res.script, 20000) - lowerBound(res.script, 8000));
});

test('recompileSegment: same as a full compile; others byte-identical outside the edited span and its join windows', () => {
  const prev = compilePlan(PLAN, CTX);
  const edited = PLAN.map((s) => (s.id === 'c' ? { ...s, params: { intensity: 0.4, shape: 'sine' } } : s));
  const next = recompileSegment(prev, edited, 'c', CTX);
  assert.deepEqual(next.script, compilePlan(edited, CTX).script);
  assert.notDeepEqual(next.script, prev.script);
  for (const id of ['a', 'b', 'd', 'e', 'f', 'g']) assert.equal(next.raw[id], prev.raw[id], `${id} not regenerated`);
  assert.notEqual(next.raw.c, prev.raw.c);
  const outside = (s) => s.filter((x) => x.at < 20000 - W || x.at > 60000 + W);
  assert.deepEqual(outside(next.script), outside(prev.script));
  // moving a shared boundary regenerates both neighbours, still equal to a full compile
  const moved = PLAN.map((s) => (s.id === 'c' ? { ...s, t1: 55000 } : s.id === 'd' ? { ...s, t0: 55000 } : s));
  const m = recompileSegment(prev, moved, 'c', CTX);
  assert.deepEqual(m.script, compilePlan(moved, CTX).script);
  assert.notEqual(m.raw.d, prev.raw.d);
  assert.equal(m.raw.b, prev.raw.b);
  // deleting a segment leaves its span empty
  const del = recompileSegment(prev, PLAN.filter((s) => s.id !== 'e'), 'e', CTX);
  assert.equal(between(del.script, 90000, 110000).length, 0);
  assert.deepEqual(del.script, compilePlan(PLAN.filter((s) => s.id !== 'e'), CTX).script);
});

test('per-segment intensity, invert and start', () => {
  const one = (params) => compilePlan([{ id: 'x', t0: 0, t1: 20000, kind: 'custom', params }], { seed: 1 }).script;
  const full = one({}), half = one({ intensity: 0.5 }), inv = one({ invert: true });
  const range = (s) => Math.max(...s.map((a) => a.pos)) - Math.min(...s.map((a) => a.pos));
  assert.ok(Math.abs(range(half) - range(full) / 2) <= 1);
  assert.equal(Math.max(...half.map((a) => a.pos)), 85, 'shrinks toward the out end');
  assert.deepEqual(inv, full.map((a) => ({ at: a.at, pos: 100 - a.pos })));
  assert.ok(one({ start: 'out' })[1].pos > one({ start: 'out' })[0].pos);
  assert.ok(full[1].pos < full[0].pos);
});

test('applyPlan: base outside the spans survives untouched; spans replaced; joins within the cap', () => {
  const base = [];
  for (let t = 0; t <= 150000; t += 500) base.push({ at: t, pos: (t / 500) % 2 ? 70 : 30 });
  const plan = [PLAN[2], PLAN[4]]; // 20..60 s and 90..110 s
  const res = compilePlan(plan, CTX);
  const out = applyPlan(base, res, CTX);
  assert.ok(isValid(out));
  const keep = base.filter((a) => !plan.some((s) => a.at >= s.t0 && a.at <= s.t1));
  for (const a of keep) assert.ok(out.some((b) => b.at === a.at && b.pos === a.pos), `base point ${a.at} kept`);
  assert.ok(maxSpeed(out) <= 450);
  assert.deepEqual(applyPlan(base, compilePlan([], CTX), CTX), base);
});

test('fuzz: random plans of every kind stay valid, under the cap, inside their spans, gaps empty', () => {
  const kinds = Object.keys(KINDS), recipes = Object.keys(RECIPES), rng = mulberry32(99);
  for (let trial = 0; trial < 60; trial++) {
    const plan = [];
    let t = Math.round(rng() * 3000);
    for (let i = 0; i < 2 + Math.floor(rng() * 8); i++) {
      const len = 30 + Math.round(rng() * (rng() < 0.2 ? 400 : 20000));
      const seg = { id: `s${i}`, t0: t, t1: t + len, kind: kinds[Math.floor(rng() * kinds.length)] };
      if (rng() < 0.4) seg.recipe = recipes[Math.floor(rng() * recipes.length)];
      if (rng() < 0.3) seg.params = { intensity: rng(), invert: rng() < 0.3 };
      plan.push(seg);
      t += len + (rng() < 0.3 ? Math.round(rng() * 2000) : 0);
    }
    const ctx = { seed: trial, maxSpeed: [450, 300, 150][trial % 3], minGapMs: [10, 25][trial % 2], turns: trackerTurns(0, t, trial), beats: trackerTurns(0, t, trial + 1).map((x) => x.at) };
    const res = compilePlan(plan, ctx);
    assert.deepEqual(res.issues.filter((x) => x.level === 'error'), []);
    const s = res.script;
    assert.ok(isValid(s));
    for (let i = 1; i < s.length; i++) assert.ok(s[i].at - s[i - 1].at >= ctx.minGapMs);
    const spikes = res.issues.filter((x) => /join/.test(x.msg)).map((x) => x.at);
    for (const { at, v } of capViolations(s, res.segments, ctx.maxSpeed)) assert.ok(spikes.includes(at), `unreported spike ${v} at ${at} (trial ${trial})`);
    for (let i = 1; i < plan.length; i++) if (plan[i].t0 > plan[i - 1].t1) assert.equal(between(s, plan[i - 1].t1, plan[i].t0).length, 0);
    for (const a of s) assert.ok(plan.some((g) => a.at >= g.t0 && a.at <= g.t1));
  }
});

test('performance: compile a 10-minute plan, recompile one segment, tile 2000 cycles', () => {
  const kinds = ['idle', 'fade-in', 'foreplay', 'oral', 'penetration', 'offscreen', 'penetration', 'knotting', 'climax', 'orgasm', 'afterglow'];
  const plan = [];
  for (let i = 0, t = 0; t < 600000; i++) { const len = 15000 + (i * 7919) % 30000; plan.push({ id: `p${i}`, t0: t, t1: Math.min(600000, t + len), kind: kinds[i % kinds.length] }); t += len; }
  const ctx = { seed: 5, turns: trackerTurns(0, 600000) };
  let t = performance.now();
  const res = compilePlan(plan, ctx);
  const compileMs = performance.now() - t;
  t = performance.now();
  const id = plan[10].id;
  const re = recompileSegment(res, plan.map((s) => (s.id === id ? { ...s, params: { intensity: 0.5 } } : s)), id, ctx);
  const recompileMs = performance.now() - t;
  checkCompiled(plan, ctx, res);
  assert.ok(isValid(re.script));
  const cyc = extractCycle(res.script, 300000, 2766.67);
  t = performance.now();
  const tl = tile(cyc, 300000, 2766.67, 0, 2000 * 2766.67);
  const tileMs = performance.now() - t;
  assert.ok(isValid(tl.script) && tl.tiles.length >= 2000);
  console.log(`perf: compile 10-min plan (${plan.length} segments, ${res.script.length} points) ${compileMs.toFixed(1)} ms; recompile one segment ${recompileMs.toFixed(1)} ms; tile 2000 cycles (${tl.script.length} points) ${tileMs.toFixed(1)} ms`);
  budget(compileMs < 2000 && tileMs < 500);
});

test('regression: adjacent follow segments whose boundary points land 10 ms apart honour minGapMs across the seam', () => {
  // tracker turns 400 ms apart, with a turn 10 ms before and 10 ms after the shared boundary at 10 s
  const turns = [];
  for (let t = 390; t < 9990; t += 400) turns.push(t);
  turns.push(9990, 10010);
  for (let t = 10410; t < 20000; t += 400) turns.push(t);
  const plan = [
    { id: 'a', t0: 0, t1: 10000, kind: 'penetration', params: { minHalfMs: 0 } }, // keep the 20 ms turn pair (no thinning)
    { id: 'b', t0: 10000, t1: 20000, kind: 'oral', params: { minHalfMs: 0 } },
  ];
  const gaps = (s) => s.slice(1).map((x, i) => x.at - s[i].at);
  const seam = (s) => s.filter((x) => x.at >= 9900 && x.at <= 10100);
  // the scenario: with a 10 ms minimum the seam really has points 10 ms apart
  assert.ok(gaps(seam(compilePlan(plan, { seed: 1, turns, minGapMs: 10 }).script)).includes(10));
  for (const [ctx, opts, want] of [[{ seed: 1, turns }, undefined, 20], [{ seed: 1, turns }, { minGapMs: 20 }, 20], [{ seed: 1, turns, minGapMs: 10 }, { minGapMs: 30, maxSpeed: 300 }, 30]]) {
    const res = compilePlan(plan, ctx, opts);
    const cap = opts?.maxSpeed ?? 450;
    assert.ok(isValid(res.script));
    assert.ok(Math.min(...gaps(res.script)) >= want, `min gap ${Math.min(...gaps(res.script))} < ${want}`);
    assert.ok(maxSpeed(res.script) <= cap, `seam speed ${maxSpeed(res.script)}`);
    assert.deepEqual(res.issues, []);
    // recompile with the same opts reuses; with different opts it recompiles from scratch
    assert.deepEqual(recompileSegment(res, plan, 'a', ctx, opts).script, res.script);
    assert.deepEqual(recompileSegment(res, plan, 'a', ctx, { minGapMs: 50 }).script, compilePlan(plan, ctx, { minGapMs: 50 }).script);
  }
  // applyPlan takes the same opts
  const base = [{ at: 0, pos: 50 }, { at: 25000, pos: 50 }];
  const applied = applyPlan(base, compilePlan(plan, { seed: 1, turns }, { minGapMs: 25 }), {}, { minGapMs: 25 });
  assert.ok(Math.min(...gaps(applied)) >= 25);
});
