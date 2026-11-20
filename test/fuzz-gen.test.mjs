// Fuzz tests for lib/gen: every generator over random params / spans / ctx, and compilePlan over random plans.
// Seeded (mulberry32); failures print generator, seed, span, params and ctx so they can be replayed with G(...).
// FUZZ_SEEDS=n scales the seed count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValid } from '../src/lib/core/script.js';
import { mulberry32, hashSeed, DEFAULTS } from '../src/lib/gen/util.js';
import { GENERATORS } from '../src/lib/gen/generators.js';
import { RECIPES, KINDS } from '../src/lib/gen/recipes.js';
import { compilePlan, recompileSegment } from '../src/lib/gen/plan.js';

const SEEDS = Number(process.env.FUZZ_SEEDS) || 40;
const J = (x) => JSON.stringify(x);
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const pick = (rng, a) => a[Math.floor(rng() * a.length)];

function randParams(schema, rng) {
  const p = {};
  for (const q of schema) {
    if (rng() < 0.55) continue;
    if (q.type === 'number') p[q.key] = q.min + rng() * (q.max - q.min);
    else if (q.type === 'int') p[q.key] = Math.round(q.min + rng() * (q.max - q.min));
    else if (q.type === 'bool') p[q.key] = rng() < 0.5;
    else if (q.type === 'choice') p[q.key] = pick(rng, q.choices);
    else if (q.type === 'shape') p[q.key] = pick(rng, q.choices);
  }
  return p;
}
function randSpan(rng) {
  const t0 = rng() < 0.2 ? 0 : Math.floor(rng() * 200000), k = rng();
  const len = k < 0.08 ? 0 : k < 0.14 ? 1 : k < 0.2 ? 1 + Math.floor(rng() * 25) : k < 0.97 ? Math.floor(rng() * 90000) : Math.floor(rng() * 2e6);
  return [t0, t0 + len];
}
function randCtx(rng) {
  const ctx = { seed: Math.floor(rng() * 1e6) };
  if (rng() < 0.7) ctx.maxSpeed = pick(rng, [60, 150, 300, 450, 800, 2000]);
  if (rng() < 0.6) ctx.minGapMs = pick(rng, [1, 20, 20, 50, 100, 250]);
  if (rng() < 0.3) ctx.intensity = rng();
  if (rng() < 0.2) ctx.invert = true;
  if (rng() < 0.6) { let t = 0; ctx.turns = Array.from({ length: Math.floor(rng() * 300) }, () => (t += 20 + Math.floor(rng() * 800))); }
  if (rng() < 0.5) { let t = 0; ctx.beats = Array.from({ length: Math.floor(rng() * 200) }, () => (t += 100 + Math.floor(rng() * 900))); }
  return ctx;
}
const capOf = (id, p, ctx) => {
  const ms = ctx.maxSpeed ?? DEFAULTS.maxSpeed;
  if (!(ms > 0)) return Infinity;
  if (id === 'knot-stroke') return Math.max(ms, p.popSpeed ?? 600); // pops may exceed the global cap (documented)
  return ms;
};
const stepViolation = (s, cap) => {
  for (let i = 1; i < s.length; i++) {
    const v = (Math.abs(s[i].pos - s[i - 1].pos) * 1000) / (s[i].at - s[i - 1].at);
    if (v > cap + 1e-9) return { i, v };
  }
  return null;
};

for (const id of Object.keys(GENERATORS)) {
  test(`fuzz gen ${id}: valid, inside span, minGap, speed cap, deterministic`, () => {
    for (let seed = 0; seed < SEEDS * 5; seed++) {
      const rng = mulberry32(hashSeed('gen', id, seed));
      const [t0, t1] = randSpan(rng), params = randParams(GENERATORS[id].schema, rng), ctx = randCtx(rng);
      const tag = () => `${id} seed ${seed} span ${t0}..${t1} params ${J(params)} ctx ${J({ ...ctx, turns: ctx.turns && `[${ctx.turns.length}]`, beats: ctx.beats && `[${ctx.beats.length}]` })}`;
      const g = GENERATORS[id].gen;
      const s = g(t0, t1, deepFreeze(structuredClone(params)), deepFreeze(structuredClone(ctx)));
      assert.ok(Array.isArray(s), tag());
      assert.ok(s.every((a) => Number.isFinite(a.at) && Number.isFinite(a.pos)), `NaN ${tag()}`);
      assert.ok(isValid(s), `invalid ${tag()} -> ${J(s.slice(0, 6))}`);
      for (const a of s) assert.ok(a.at >= t0 && a.at <= t1, `outside span: ${a.at} ${tag()}`);
      const gap = Math.max(1, Math.round(ctx.minGapMs ?? DEFAULTS.minGapMs));
      for (let i = 1; i < s.length; i++) assert.ok(s[i].at - s[i - 1].at >= gap, `gap ${s[i].at - s[i - 1].at} < ${gap} at ${s[i].at}: ${tag()}`);
      const v = stepViolation(s, capOf(id, { ...Object.fromEntries(GENERATORS[id].schema.map((q) => [q.key, q.default])), ...params }, ctx));
      assert.ok(!v, `speed ${v && v.v.toFixed(1)} > cap at idx ${v && v.i} (${v && s[v.i].at}): ${tag()}`);
      assert.deepEqual(g(t0, t1, params, ctx), s, `not deterministic: ${tag()}`);
      if (t1 < t0) assert.deepEqual(g(t1, t0 - 1 + 0, params, ctx).length >= 0, true);
    }
  });
  test(`fuzz gen ${id}: degenerate spans (t0==t1, 1 ms, reversed) give valid output`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const rng = mulberry32(hashSeed('degen', id, seed));
      const t0 = Math.floor(rng() * 1e5), params = randParams(GENERATORS[id].schema, rng), ctx = randCtx(rng);
      for (const [a, b] of [[t0, t0], [t0, t0 + 1], [t0 + 5, t0], [0, 0], [t0 + 0.4, t0 + 0.6], [t0, t0 + 1e7]]) {
        const s = GENERATORS[id].gen(a, b, params, ctx);
        const tag = `${id} seed ${seed} span ${a}..${b} params ${J(params)}`;
        assert.ok(isValid(s) && s.every((x) => Number.isFinite(x.pos)), `${tag} -> ${J(s.slice(0, 4))}`);
        if (b < a) assert.equal(s.length, 0, tag);
        if (a === b) assert.ok(s.length <= 1, `${tag} -> ${J(s)}`);
      }
    }
  });
}

// a graph expression node can feed NaN/Infinity/1e9 into a param: non-finite falls back to the default, finite is clamped to the schema
test('fuzz gen: NaN / Infinity / huge numeric params still give a valid, bounded script', () => {
  for (const [id, g] of Object.entries(GENERATORS)) for (const q of g.schema) if (q.type === 'number' || q.type === 'int') {
    for (const bad of [NaN, Infinity, -Infinity, 1e9, -1e9]) {
      const s = g.gen(1000, 20000, { [q.key]: bad }, { seed: 1, turns: [1500, 2500, 4000], beats: [2000, 3000] });
      assert.ok(isValid(s) && s.length < 5000, `${id}.${q.key}=${bad} -> ${s.length} pts ${J(s.slice(0, 2))}`);
    }
  }
});

// ---- compilePlan
const KIND_IDS = Object.keys(KINDS), RECIPE_IDS = Object.keys(RECIPES);
function randPlan(rng) {
  const n = 1 + Math.floor(rng() * 7), plan = [];
  let t = rng() < 0.5 ? 0 : Math.floor(rng() * 5000);
  for (let i = 0; i < n; i++) {
    const t1 = t + 1 + Math.floor(rng() < 0.2 ? rng() * 60 : rng() * 40000);
    const seg = { id: `s${i}`, t0: t, t1, kind: pick(rng, KIND_IDS) };
    if (rng() < 0.4) seg.recipe = pick(rng, RECIPE_IDS);
    if (rng() < 0.2) seg.params = { lo: Math.floor(rng() * 100), hi: Math.floor(rng() * 100) };
    plan.push(seg);
    t = t1 - (rng() < 0.1 ? Math.floor(rng() * 20) : 0) + (rng() < 0.3 ? Math.floor(rng() * 3000) : 0); // a few overlaps and gaps
  }
  return plan;
}

test('fuzz compilePlan: seams respect minGap, no overlap/backward time, points stay in segments, cap or an issue', () => {
  for (let seed = 0; seed < SEEDS * 4; seed++) {
    const rng = mulberry32(hashSeed('plan', seed));
    const plan = randPlan(rng), ctx = randCtx(rng);
    const tag = `seed ${seed} plan ${J(plan)} ctx ${J({ ...ctx, turns: ctx.turns && `[${ctx.turns.length}]`, beats: ctx.beats && `[${ctx.beats.length}]` })}`;
    const res = compilePlan(deepFreeze(structuredClone(plan)), ctx);
    const s = res.script;
    assert.ok(isValid(s), `invalid ${tag}`);
    const gap = Math.max(1, ctx.minGapMs ?? DEFAULTS.minGapMs), cap = ctx.maxSpeed ?? DEFAULTS.maxSpeed;
    const ok = res.segments.map((x) => [x.t0, x.t1]);
    for (const a of s) assert.ok(ok.some(([x, y]) => a.at >= x && a.at <= y), `point ${a.at} outside every compiled segment: ${tag}`);
    const warned = res.issues.some((x) => x.level === 'warn' && /join at/.test(x.msg));
    const bad = [];
    for (let i = 1; i < s.length; i++) {
      if (s[i].at - s[i - 1].at < gap) bad.push(`gap@${s[i].at}`);
      else if (cap > 0 && !warned && (Math.abs(s[i].pos - s[i - 1].pos) * 1000) / (s[i].at - s[i - 1].at) > cap + 1e-9 && !res.segments.some((x) => x.recipe === 'knot-pop-stroke')) bad.push(`speed@${s[i].at}`);
    }
    assert.deepEqual(bad.slice(0, 3), [], `${tag}`);
    // overlapping segments are rejected with an error issue, never a throw; segments reported never overlap
    for (let i = 1; i < res.segments.length; i++) assert.ok(res.segments[i].t0 >= res.segments[i - 1].t1, `segments overlap: ${tag}`);
    // determinism + incremental recompile equals full compile
    assert.deepEqual(compilePlan(plan, ctx).script, s, `not deterministic ${tag}`);
    const id = pick(rng, plan).id;
    assert.deepEqual(recompileSegment(res, plan, id, ctx).script, s, `recompileSegment differs ${tag}`);
  }
});

test('fuzz compilePlan: knot-pop-stroke - every full stroke passes the knot (reaches <= knotOut then >= popTo)', () => {
  const P = RECIPES['knot-pop-stroke'].params;
  for (let seed = 0; seed < SEEDS * 3; seed++) {
    const rng = mulberry32(hashSeed('knot', seed));
    const t0 = Math.floor(rng() * 5000), t1 = t0 + 5000 + Math.floor(rng() * 60000);
    const ctx = { seed: Math.floor(rng() * 1e6), maxSpeed: pick(rng, [450, 600, 900]) };
    const s = compilePlan([{ id: 'k', t0, t1, kind: 'knotting' }], ctx).script;
    // full cycles run depth..depth with exactly the 7-point pattern; each must contain a knot-out dip and a pop-to peak
    const z = s.map((a, i) => (a.pos === P.lo ? i : -1)).filter((i) => i >= 0);
    for (let c = 0; c + 1 < z.length; c++) {
      if (z[c + 1] - z[c] !== 6) continue;
      const cyc = s.slice(z[c], z[c + 1] + 1);
      const knot = cyc[1].pos, peak = Math.max(...cyc.map((a) => a.pos));
      assert.ok(knot <= P.knotOut + 6 && cyc[2].pos >= P.popTo - 6 && peak >= P.popTo - 6, `seed ${seed} stroke at ${cyc[0].at}: ${J(cyc)} (knotOut ${P.knotOut}, popTo ${P.popTo})`);
    }
  }
});
