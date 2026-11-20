// knot-stroke ("knot on every stroke"): the cycle fitted from the owner's own knot scripting.
// Targets are the fitted proportions only (KNOT_STROKE_FIT), not reference data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValid, speeds } from '../src/lib/core/script.js';
import { GENERATORS, KNOT_STROKE_FIT, KINDS, RECIPES, resolveSegment, compilePlan, recompileSegment, mulberry32 } from '../src/lib/gen/index.js';

const G = (t0, t1, params = {}, ctx = {}) => GENERATORS['knot-stroke'].gen(t0, t1, params, ctx);
const POS = [17, 64, 80, 30, 20, 0];                                // target level after each move
const FRAC = [0.270, 0.077, 0.132, 0.326, 0.157, 0.038];           // target share of the cycle per move
const med = (v) => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sd = (v) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length); };

/** Full cycles (7 points: depth .. depth) of a knot-stroke script. */
function cycles(s, lo = 0) {
  const z = s.map((a, i) => (a.pos === lo ? i : -1)).filter((i) => i >= 0), out = [];
  for (let c = 0; c + 1 < z.length; c++) if (z[c + 1] - z[c] === 6) out.push(s.slice(z[c], z[c + 1] + 1));
  return out;
}
const shape = (cyc) => {
  const L = cyc[6].at - cyc[0].at;
  return { L, pos: cyc.slice(1).map((a) => a.pos), frac: cyc.slice(1).map((a, i) => (a.at - cyc[i].at) / L), dur: cyc.slice(1).map((a, i) => a.at - cyc[i].at) };
};

test('fit table is the documented one and its fractions sum to 1', () => {
  assert.deepEqual(KNOT_STROKE_FIT.fractions, FRAC);
  assert.ok(Math.abs(FRAC.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.deepEqual(KNOT_STROKE_FIT.pos, { lo: 0, knotOut: 17, popTo: 64, hi: 80, knotIn: 30, press: 20 });
});

test('default period, no variation: every cycle reproduces the fitted proportions (pos +-4, timing +-0.04)', () => {
  const s = G(0, 30000, { variation: 0 }, { seed: 1 });
  assert.ok(isValid(s));
  const cs = cycles(s).map(shape);
  assert.ok(cs.length >= 25, `${cs.length} cycles`);
  for (const c of cs) {
    assert.ok(Math.abs(c.L - KNOT_STROKE_FIT.refMs) <= 6, `cycle ${c.L} ms`);
    c.pos.forEach((p, i) => assert.ok(Math.abs(p - POS[i]) <= 4, `move ${i} pos ${p}`));
    c.frac.forEach((f, i) => assert.ok(Math.abs(f - FRAC[i]) <= 0.04, `move ${i} frac ${f.toFixed(3)}`));
  }
});

test('default variation matches the measured spread; medians stay on the fit', () => {
  const s = G(0, 600000, {}, { seed: 7 });
  const cs = cycles(s).map(shape);
  assert.ok(cs.length > 400);
  for (let i = 0; i < 6; i++) {
    assert.ok(Math.abs(med(cs.map((c) => c.pos[i])) - POS[i]) <= 4, `median pos ${i}`);
    assert.ok(Math.abs(med(cs.map((c) => c.frac[i])) - FRAC[i]) <= 0.04, `median frac ${i}: ${med(cs.map((c) => c.frac[i]))}`);
  }
  const Ls = cs.map((c) => c.L), rel = sd(Ls) / (Ls.reduce((a, b) => a + b, 0) / Ls.length);
  assert.ok(Math.abs(rel - KNOT_STROKE_FIT.periodSd) < 0.04, `cycle-length spread ${rel.toFixed(3)}`);
  assert.ok(Math.abs(sd(cs.map((c) => c.pos[3])) - KNOT_STROKE_FIT.knotInSd) < 0.6, 'knot-in spread');
  for (const i of [0, 1, 2, 4, 5]) assert.equal(new Set(cs.map((c) => c.pos[i])).size, 1, `level ${i} never varies`);
  assert.deepEqual(G(0, 20000, {}, { seed: 7 }), G(0, 20000, {}, { seed: 7 }));
  assert.notDeepEqual(G(0, 20000, {}, { seed: 7 }), G(0, 20000, {}, { seed: 8 }));
});

test('pops survive the speed pass at their measured speed; popSpeed caps them; popSpeed 0 = global cap', () => {
  const s = G(0, 20000, { variation: 0 }, { seed: 1, maxSpeed: 450 });
  const v = speeds(s);
  assert.ok(Math.max(...v) > 540 && Math.max(...v) <= 600, `pop out ${Math.max(...v)}`);
  const popIn = s.map((a, i) => (i && s[i - 1].pos === 20 && a.pos === 0 ? v[i] : 0));
  assert.ok(Math.max(...popIn) > 450, `pop in ${Math.max(...popIn)}`);
  // every non-pop move stays under the global cap
  s.forEach((a, i) => { if (i && !(s[i - 1].pos === 17 && a.pos === 64) && !(s[i - 1].pos === 20 && a.pos === 0)) assert.ok(v[i] <= 450, `slow move ${v[i]}`); });
  const capped = G(0, 20000, { variation: 0, popSpeed: 500 }, { seed: 1 });
  assert.ok(Math.max(...speeds(capped)) <= 500);
  const global = G(0, 20000, { variation: 0, popSpeed: 0 }, { seed: 1, maxSpeed: 450 });
  assert.ok(Math.max(...speeds(global)) <= 450);
  assert.ok(cycles(global).every((c) => c[2].pos === 64 && c[6].pos === 0), 'pops lengthened, not flattened');
});

test('period scaling: pops keep their duration, slow moves absorb the change; popScale 1 = proportional', () => {
  for (const L of [875, 1375, 700]) {
    const cs = cycles(G(0, 30000, { rate: 2000 / L, variation: 0 }, { seed: 1 })).map(shape);
    for (const c of cs) {
      assert.ok(Math.abs(c.L - L) <= 6, `cycle ${c.L} for ${L}`);
      assert.ok(Math.abs(c.dur[1] - 0.077 * KNOT_STROKE_FIT.refMs) <= 2 && Math.abs(c.dur[5] - 0.038 * KNOT_STROKE_FIT.refMs) <= 2, 'pops fixed');
      const extra = L - KNOT_STROKE_FIT.refMs; // the pull and the descent take most of it
      assert.ok(Math.abs(c.dur[0] - (0.270 * KNOT_STROKE_FIT.refMs + 0.475 * extra)) < 25, `pull ${c.dur[0]} at ${L}`);
      assert.ok(Math.abs(c.dur[3] - (0.326 * KNOT_STROKE_FIT.refMs + 0.317 * extra)) < 25, `descent ${c.dur[3]} at ${L}`);
    }
  }
  const prop = cycles(G(0, 20000, { rate: 2000 / 1500, variation: 0, popScale: 1 }, { seed: 1 })).map(shape);
  for (const c of prop) c.frac.forEach((f, i) => assert.ok(Math.abs(f - FRAC[i]) <= 0.01, `proportional ${i}`));
});

test('follow: one cycle per tracked in/out pair, depth on the bottoms and the top on the tops', () => {
  const rng = mulberry32(4), turns = [];
  for (let t = 600, k = -1; t < 20000; t += 450 + rng() * 200, k = -k) turns.push({ at: Math.round(t), kind: k < 0 ? 'bottom' : 'top' });
  const s = G(2000, 18000, {}, { seed: 3, turns });
  assert.ok(isValid(s));
  for (const tr of turns.filter((x) => x.at > 2100 && x.at < 17900)) {
    const want = tr.kind === 'bottom' ? 0 : 80;
    assert.ok(s.some((a) => a.pos === want && Math.abs(a.at - tr.at) <= 1), `${tr.kind} at ${tr.at}`);
  }
  for (const c of cycles(s)) assert.deepEqual([c[1].pos, c[2].pos, c[3].pos, c[5].pos], [17, 64, 80, 20]);
  const rate = G(2000, 18000, { timing: 'rate' }, { seed: 3, turns });
  assert.notDeepEqual(rate, s);
});

test('recipes: knot-pop-stroke is the knotting default; the held and tied variants remain', () => {
  assert.equal(KINDS.knotting.recipe, 'knot-pop-stroke');
  assert.equal(RECIPES['knot-pop-stroke'].gen, 'knot-stroke');
  assert.equal(resolveSegment({ id: 'x', t0: 0, t1: 1, kind: 'knotting' }).genId, 'knot-stroke');
  assert.equal(RECIPES['knot-pop-held'].gen, 'knot');
  assert.equal(RECIPES['knot-tied'].gen, 'knot');
  assert.equal(RECIPES['knot-tied'].params.tied, true);
});

test('plan: knotting blends at both boundaries, keeps its pops, and recompile invariants hold', () => {
  const plan = [
    { id: 'p', t0: 0, t1: 20000, kind: 'penetration' },
    { id: 'k', t0: 20000, t1: 45000, kind: 'knotting' },
    { id: 'c', t0: 45000, t1: 60000, kind: 'climax' },
  ];
  const ctx = { seed: 2 };
  const res = compilePlan(plan, ctx);
  assert.deepEqual(res.issues, []);
  const s = res.script, v = speeds(s);
  for (const b of [20000, 45000]) { // the crossing steps respect the global cap
    const i = s.findIndex((a) => a.at >= b);
    assert.ok(v[i] <= 450 && v[i + 1] <= 450 + (s[i].at < 45000 ? 150 : 0), `join at ${b}`);
  }
  const inside = s.map((a, i) => (a.at > 20500 && a.at < 44500 ? v[i] : 0));
  assert.ok(Math.max(...inside) > 450 && Math.max(...inside) <= 600, 'pops survive compilation');
  s.forEach((a, i) => { if (i && (a.at < 20000 || a.at > 45000)) assert.ok(v[i] <= 450, `outside knotting at ${a.at}`); });
  const edited = plan.map((g) => (g.id === 'k' ? { ...g, params: { knotIn: 34, variation: 0 } } : g));
  const re = recompileSegment(res, edited, 'k', ctx);
  assert.deepEqual(re.script, compilePlan(edited, ctx).script);
  assert.equal(re.raw.p, res.raw.p);
  assert.equal(re.raw.c, res.raw.c);
  const W = 310, out = (x) => x.filter((a) => a.at < 20000 - W || a.at > 45000 + W);
  assert.deepEqual(out(re.script), out(s));
  const re2 = recompileSegment(res, plan.map((g) => (g.id === 'p' ? { ...g, params: { intensity: 0.5 } } : g)), 'p', ctx);
  assert.equal(re2.raw.k, res.raw.k, 'knotting not regenerated when a neighbour changes');
});
