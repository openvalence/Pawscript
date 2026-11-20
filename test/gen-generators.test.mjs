import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERATORS, followTimes, prepTurns } from '../src/lib/gen/generators.js';
import { isValid, speeds } from '../src/lib/core/script.js';

const T0 = 1234, T1 = 17891, DUR = (T1 - T0) / 1000;
const G = (id, t0, t1, params, ctx) => GENERATORS[id].gen(t0, t1, params, ctx);

/** interior direction changes (zero steps ignored): [{at, pos, dir:+1 top | -1 bottom}] */
function extremes(s) {
  const out = [];
  let dir = 0, last = null;
  for (let i = 1; i < s.length; i++) {
    const d = Math.sign(s[i].pos - s[i - 1].pos);
    if (!d) continue;
    if (dir && d !== dir) out.push({ at: last.at, pos: last.pos, dir });
    dir = d; last = s[i];
    // a plateau start: the turn belongs to the last point of the previous move
  }
  return out;
}
const turnsIn = (s, a, b) => extremes(s).filter((e) => e.at >= a && e.at <= b).length;
const maxSpd = (s) => Math.max(0, ...speeds(s));
const minGapOf = (s) => Math.min(Infinity, ...s.slice(1).map((a, i) => a.at - s[i].at));
const range = (s) => [Math.min(...s.map((a) => a.pos)), Math.max(...s.map((a) => a.pos))];
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, want ${b} +-${tol}`);
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

// generator -> param sets (lo/hi given where meaningful)
const CASES = {
  hold: [{}, { pos: 40 }],
  strokes: [{}, { rate: 3, lo: 10, hi: 70 }, { spm: 90, lo: 20, hi: 100, shape: 'sine', start: 'out' }, { rate: 2, shape: { name: 'two-speed', prob: 0.5 }, inFrac: 0.35, phase: 0.3 }],
  ramp: [{}, { rate0: 1, rate1: 3, amp0: 0.3, amp1: 1, curve: 'linear', lo: 10, hi: 80 }, { curve: 'exp', anchor: 'lo' }],
  smooth: [{}, { lo: 30, hi: 70, amp: 20, rate: 2 }, { rate: 0.8, driftMs: 3000, variation: 1 }],
  pulses: [{}, { rate: 5, rateEnd: 3, decayMs: 4000, lo: 5, hi: 40 }],
  tremor: [{}, { lo: 5, hi: 30, amp: 30, pulseMs: 3000, restEndMs: 900 }, { pulseMs: 0 }],
  follow: [{}, { lo: 20, hi: 90, shape: 'sine' }],
  knot: [{}, { rate: 3, between: 2, lo: 5, hi: 90, knotLevel: 40 }, { tied: true, popsBeforeTie: 1 }],
  'knot-stroke': [{}, { rate: 2.5, lo: 5, hi: 90, variation: 0 }, { timing: 'rate', variation: 2, popSpeed: 0 }],
  tease: [{}, { rate: 3, lo: 10, hi: 90, every: 2 }],
  'tease-top': [{}, { lo: 60, hi: 90, rate: 1, pause: 0.3 }],
  beats: [{}, { mode: 'hit', lo: 5, hi: 70, shape: 'sine' }],
};
const TURNS = Array.from({ length: 60 }, (_, i) => 700 + i * 350 + (i % 3) * 11); // ~1.4 turns/s... dense tracker
const BEATS = Array.from({ length: 40 }, (_, i) => 500 + i * 530);
const baseCtx = (extra = {}) => ({ seed: 5, turns: TURNS, beats: BEATS, ...extra });
const covers = (id) => id !== 'beats';

test('registry has every documented generator', () => {
  assert.deepEqual(Object.keys(GENERATORS).sort(), Object.keys(CASES).sort());
  for (const g of Object.values(GENERATORS)) assert.ok(g.label && g.description && Array.isArray(g.schema) && typeof g.gen === 'function');
});

for (const [id, sets] of Object.entries(CASES)) {
  const spans = [[T0, T1], [1, 9999], [50000, 50777], [100, 100 + 25]];
  test(`${id}: valid, inside span, edges, range, common`, () => {
    for (const params of sets) for (const [t0, t1] of spans) {
      const s = G(id, t0, t1, params, baseCtx());
      assert.ok(s.length > 0 || id === 'beats', `${id} nonempty`);
      assert.ok(isValid(s), `${id} valid ${JSON.stringify(params)} ${t0}`);
      for (const a of s) assert.ok(a.at >= t0 && a.at <= t1, `${id} at ${a.at} outside ${t0}..${t1}`);
      if (covers(id)) {
        assert.ok(s[0].at - t0 < 10 && t1 - s.at(-1).at < 10, `${id} edges within minGap: ${s[0].at} ${s.at(-1).at}`);
      }
      const [mn, mx] = range(s);
      const lo = Math.min(params.lo ?? 0, params.hi ?? 100), hi = Math.max(params.lo ?? 0, params.hi ?? 100);
      if (id === 'hold') assert.ok(mn === mx && mn === (params.pos ?? 100));
      else if (id === 'smooth' || id === 'pulses' || id === 'tremor') {
        const d = GENERATORS[id].schema;
        const L = params.lo ?? d.find((x) => x.key === 'lo').default, H = params.hi ?? d.find((x) => x.key === 'hi').default;
        assert.ok(mn >= L && mx <= H, `${id} [${mn},${mx}] outside [${L},${H}]`);
      } else if (id === 'follow' || id === 'strokes' || id === 'beats' || id === 'knot' || id === 'knot-stroke' || id === 'tease' || id === 'ramp') {
        const d = GENERATORS[id].schema;
        const L = params.lo ?? d.find((x) => x.key === 'lo').default, H = params.hi ?? d.find((x) => x.key === 'hi').default;
        assert.ok(mn >= L && mx <= H, `${id} [${mn},${mx}] outside [${L},${H}]`);
      }
      assert.ok(mn >= 0 && mx <= 100);
    }
  });

  test(`${id}: first point exactly at t0, last exactly at t1`, () => {
    for (const params of sets) for (const [t0, t1] of spans) {
      const s = G(id, t0, t1, params, baseCtx());
      if (covers(id)) { assert.equal(s[0].at, t0, `${id} first`); assert.equal(s.at(-1).at, t1, `${id} last ${t0}..${t1} ${JSON.stringify(params)}`); }
    }
  });

  test(`${id}: swapped lo/hi behaves like ordered`, () => {
    if (id === 'hold') return;
    const a = G(id, T0, T1, { lo: 60, hi: 10 }, baseCtx());
    const b = G(id, T0, T1, { lo: 10, hi: 60 }, baseCtx());
    assert.deepEqual(a, b);
  });

  test(`${id}: invert is exactly 100 - pos`, () => {
    for (const params of sets) {
      const a = G(id, T0, T1, params, baseCtx());
      const b = G(id, T0, T1, { ...params, invert: true }, baseCtx());
      assert.deepEqual(b, a.map((x) => ({ at: x.at, pos: 100 - x.pos })), id);
      const c = G(id, T0, T1, params, baseCtx({ invert: true }));
      assert.deepEqual(c, b, `${id} ctx.invert`);
      const d = G(id, T0, T1, { ...params, invert: true }, baseCtx({ invert: true }));
      assert.deepEqual(d, a, `${id} double invert`);
    }
  });

  test(`${id}: speed cap and minGap respected (450, 200, tight)`, () => {
    for (const params of [...sets, { ...(sets[1] ?? {}), rate: 9, lo: 0, hi: 100 }, { rate: 11, lo: 0, hi: 100, rate0: 8, rate1: 11, amp0: 1 }]) {
      for (const maxSpeed of [undefined, 450, 200, 60]) {
        for (const minGapMs of [undefined, 10, 40]) {
          const ctx = baseCtx({ ...(maxSpeed != null && { maxSpeed }), ...(minGapMs != null && { minGapMs }) });
          const s = G(id, T0, T1, params, ctx);
          assert.ok(isValid(s));
          // knot-stroke's pops may move at up to popSpeed (a per-recipe allowance above the global cap)
          const allow = id === 'knot-stroke' && (params.popSpeed ?? 600) > 0 ? Math.max(maxSpeed ?? 450, params.popSpeed ?? 600) : (maxSpeed ?? 450);
          assert.ok(maxSpd(s) <= allow + 1e-9, `${id} ${JSON.stringify(params)} cap ${maxSpeed}: ${maxSpd(s)}`);
          assert.ok(minGapOf(s) >= (minGapMs ?? 10), `${id} minGap ${minGapMs}: ${minGapOf(s)}`);
        }
      }
    }
  });

  test(`${id}: seeded reproducibility`, () => {
    for (const params of sets) {
      const a = G(id, T0, T1, { ...params, jitterTime: 0.2, jitterAmp: 0.2 }, baseCtx({ seed: 9 }));
      const b = G(id, T0, T1, { ...params, jitterTime: 0.2, jitterAmp: 0.2 }, baseCtx({ seed: 9 }));
      assert.deepEqual(a, b);
    }
  });

  test(`${id}: inputs never mutated`, () => {
    const params = deepFreeze({ ...(sets[1] ?? {}), jitterTime: 0.2, jitterAmp: 0.2, fadeFrom: 0.5 });
    const ctx = deepFreeze(baseCtx({ turns: TURNS.map((t, i) => ({ at: t, kind: i % 2 ? 'top' : 'bottom' })), beats: [...BEATS] }));
    assert.doesNotThrow(() => G(id, T0, T1, params, ctx));
    const turns = [...TURNS], before = JSON.stringify(turns);
    G(id, T0, T1, {}, { turns, beats: BEATS });
    assert.equal(JSON.stringify(turns), before);
    const unsorted = [3000, 1000, 2000, 5000, 4000];
    G(id, T0, T1, {}, { turns: unsorted });
    assert.deepEqual(unsorted, [3000, 1000, 2000, 5000, 4000]);
  });

  test(`${id}: empty / reversed span`, () => {
    assert.deepEqual(G(id, 5000, 4000, {}, baseCtx()), []);
    const z = G(id, 5000, 5000, {}, baseCtx());
    assert.ok(isValid(z) && z.length <= 1);
    assert.doesNotThrow(() => G(id, T0, T1));
  });
}

// ------------------------------------------------------------ common params

for (const id of Object.keys(CASES).filter((x) => x !== 'hold' && x !== 'beats')) {
  test(`${id}: seed changes jitter output`, () => {
    const p = { jitterTime: 0.3, jitterAmp: 0.3 };
    const a = G(id, T0, T1, p, baseCtx({ seed: 1 }));
    const b = G(id, T0, T1, p, baseCtx({ seed: 2 }));
    const c = G(id, T0, T1, { ...p, seed: 7 }, baseCtx({ seed: 1 }));
    assert.notDeepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.notDeepEqual(a, G(id, T0, T1, {}, baseCtx({ seed: 1 })), 'jitter does something');
  });

  test(`${id}: jitterAmp / jitterTime never leave the range, stay valid`, () => {
    for (const seed of [1, 2, 3, 4]) {
      const plain = G(id, T0, T1, { lo: 10, hi: 80 }, baseCtx({ seed }));
      const s = G(id, T0, T1, { lo: 10, hi: 80, jitterAmp: 0.5, jitterTime: 0.4 }, baseCtx({ seed }));
      assert.ok(isValid(s));
      const [pl, ph] = range(plain), [mn, mx] = range(s);
      assert.ok(mn >= pl - 0 && mx <= ph, `${id} [${mn},${mx}] vs [${pl},${ph}]`);
      for (const a of s) assert.ok(a.at >= T0 && a.at <= T1);
    }
  });

  test(`${id}: intensity 0 and 1 are valid, lower intensity never deeper`, () => {
    const full = G(id, T0, T1, { lo: 10, hi: 80, intensity: 1 }, baseCtx());
    const half = G(id, T0, T1, { lo: 10, hi: 80, intensity: 0.5 }, baseCtx());
    const zero = G(id, T0, T1, { lo: 10, hi: 80, intensity: 0 }, baseCtx());
    for (const s of [full, half, zero]) assert.ok(isValid(s));
    const trav = (s) => range(s)[1] - range(s)[0];
    assert.ok(trav(half) <= trav(full) + 1 && trav(zero) <= trav(half) + 1, `${id} ${trav(zero)} ${trav(half)} ${trav(full)}`);
  });

  test(`${id}: ctx.intensity multiplies param intensity`, () => {
    const a = G(id, T0, T1, { intensity: 0.5 }, baseCtx({ intensity: 0.5 }));
    const b = G(id, T0, T1, { intensity: 0.25 }, baseCtx());
    assert.deepEqual(a, b);
  });

  test(`${id}: fadeFrom/fadeTo shrink depth over time`, () => {
    const ex = id === 'ramp' ? { amp0: 1 } : {};
    const s = G(id, T0, T1, { ...ex, lo: 0, hi: 90, fadeFrom: 1, fadeTo: 0.1 }, baseCtx({ maxSpeed: 0 }));
    const third = (T1 - T0) / 3;
    const trav = (a, b) => { const q = s.filter((x) => x.at >= a && x.at <= b).map((x) => x.pos); return Math.max(...q) - Math.min(...q); };
    const first = trav(T0, T0 + third), last = trav(T1 - third, T1);
    assert.ok(last < first * 0.6, `${id} first ${first} last ${last}`);
    const rev = G(id, T0, T1, { ...ex, lo: 0, hi: 90, fadeFrom: 0.1, fadeTo: 1 }, baseCtx({ maxSpeed: 0 }));
    const tr = (a, b) => { const q = rev.filter((x) => x.at >= a && x.at <= b).map((x) => x.pos); return Math.max(...q) - Math.min(...q); };
    assert.ok(tr(T0, T0 + third) < tr(T1 - third, T1) * 0.6, `${id} fade in`);
  });
}

// ------------------------------------------------------------ hold

test('hold: constant position, exact edges, invert', () => {
  const s = G('hold', T0, T1, { pos: 37 });
  assert.deepEqual(s, [{ at: T0, pos: 37 }, { at: T1, pos: 37 }]);
  assert.deepEqual(G('hold', T0, T1, { pos: 37, invert: true }), [{ at: T0, pos: 63 }, { at: T1, pos: 63 }]);
  assert.deepEqual(G('hold', 500, 500, { pos: 20 }), [{ at: 500, pos: 20 }]);
  assert.deepEqual(G('hold', T0, T1)[0].pos, 100);
});

// ------------------------------------------------------------ strokes

test('strokes: turn rate matches rate and spm alias', () => {
  for (const rate of [1, 2.4, 4, 6]) {
    const s = G('strokes', T0, T1, { rate, lo: 20, hi: 70 }, { seed: 1 });
    near(turnsIn(s, T0 + 1, T1 - 1) / DUR, rate, 0.12 * rate + 0.15, `rate ${rate}`);
  }
  const a = G('strokes', T0, T1, { spm: 90, lo: 20, hi: 70 }, {});
  const b = G('strokes', T0, T1, { rate: 3, lo: 20, hi: 70 }, {});
  assert.deepEqual(a, b);
  // explicit rate wins over spm
  assert.deepEqual(G('strokes', T0, T1, { spm: 90, rate: 2 }, {}), G('strokes', T0, T1, { rate: 2 }, {}));
});

test('strokes: extremes at lo/hi, start direction, phase', () => {
  const s = G('strokes', 0, 10000, { rate: 2, lo: 10, hi: 80 }, {});
  assert.equal(s[0].pos, 80, 'start in: begins at the top');
  assert.ok(s[1].pos < s[0].pos);
  const o = G('strokes', 0, 10000, { rate: 2, lo: 10, hi: 80, start: 'out' }, {});
  assert.equal(o[0].pos, 10);
  assert.ok(o[1].pos > o[0].pos);
  assert.deepEqual(range(s), [10, 80]);
  const ph = G('strokes', 0, 10000, { rate: 2, lo: 10, hi: 80, phase: 0.5 }, {});
  assert.notDeepEqual(ph, s);
  assert.equal(G('strokes', 0, 10000, { rate: 2, lo: 10, hi: 80, phase: 0.25 }, {})[0].pos, 45, 'phase 0.25 starts mid-stroke');
  assert.equal(ph[0].pos, 10, 'phase 0.5 = half a cycle');
});

test('strokes: inFrac shifts the turning points', () => {
  const s = G('strokes', 0, 20000, { rate: 2, lo: 0, hi: 80, inFrac: 0.3 }, {});
  const ex = extremes(s);
  const bottoms = ex.filter((e) => e.dir === -1), tops = ex.filter((e) => e.dir === 1);
  // top -> bottom (going in) takes 0.3 of a 1 s stroke, bottom -> top 0.7
  near(bottoms[1].at - tops[1].at === undefined ? 0 : bottoms[2].at - tops[1].at, 300, 15, 'in time');
  near(tops[2].at - bottoms[2].at, 700, 15, 'out time');
});

test('strokes: speed cap shrinks toward anchor hi, never past it', () => {
  const s = G('strokes', 0, 10000, { rate: 8, lo: 0, hi: 100 }, { maxSpeed: 450 });
  const [mn, mx] = range(s);
  assert.equal(mx, 100, 'anchor hi keeps the out end');
  assert.ok(mn > 40 && mn < 70, `shrunk to ~${mn}`);
  assert.ok(turnsIn(s, 0, 10000) >= 75, 'still turns at 8/s');
  const lo = G('strokes', 0, 10000, { rate: 8, lo: 0, hi: 100, anchor: 'lo' }, { maxSpeed: 450 });
  assert.equal(range(lo)[0], 0);
  const mid = G('strokes', 0, 10000, { rate: 8, lo: 0, hi: 100, anchor: 'mid' }, { maxSpeed: 450 });
  near((range(mid)[0] + range(mid)[1]) / 2, 50, 1);
});

test('strokes: intensity halves travel about hi (anchor hi), rate x(0.5+0.5I)', () => {
  const s = G('strokes', 0, 20000, { rate: 2, lo: 0, hi: 80, intensity: 0.5 }, {});
  assert.deepEqual(range(s), [40, 80]);
  near(turnsIn(s, 1, 19999) / 20, 2 * 0.75, 0.15);
  const l = G('strokes', 0, 20000, { rate: 2, lo: 0, hi: 80, intensity: 0.5, anchor: 'lo' }, {});
  assert.deepEqual(range(l), [0, 40]);
  const m = G('strokes', 0, 20000, { rate: 2, lo: 0, hi: 80, intensity: 0.5, anchor: 'mid' }, {});
  assert.deepEqual(range(m), [20, 60]);
  const z = G('strokes', 0, 20000, { rate: 2, lo: 0, hi: 80, intensity: 0 }, {});
  assert.deepEqual(range(z), [80, 80], 'intensity 0 collapses to a flat line at the anchor');
  const zr = G('strokes', 0, 20000, { rate: 2, lo: 0, hi: 80, intensity: 0.1 }, {});
  near(turnsIn(zr, 1, 19999) / 20, 2 * 0.55, 0.2);
});

test('strokes: jitterTime moves turns but order stays; jitterAmp only shrinks', () => {
  const plain = G('strokes', 0, 20000, { rate: 2, lo: 0, hi: 80 }, { seed: 3 });
  const j = G('strokes', 0, 20000, { rate: 2, lo: 0, hi: 80, jitterTime: 0.3, jitterAmp: 0.4 }, { seed: 3 });
  assert.notDeepEqual(plain, j);
  assert.ok(isValid(j));
  const ex = extremes(j);
  assert.ok(ex.filter((e) => e.dir === 1).every((e) => e.pos <= 80));
  assert.ok(ex.filter((e) => e.dir === -1).every((e) => e.pos >= 0));
  // anchor hi: tops are untouched, bottoms rise
  assert.ok(ex.filter((e) => e.dir === 1 && e.pos < 80).length <= 1);
  assert.ok(ex.filter((e) => e.dir === -1).some((e) => e.pos > 0));
  // the number of turns is preserved
  assert.equal(extremes(plain).length, ex.length);
});

test('strokes: two-speed prob is seeded and varies with seed', () => {
  const p = { rate: 2, lo: 0, hi: 80, shape: { name: 'two-speed', prob: 0.5 } };
  const a = G('strokes', 0, 30000, p, { seed: 1 }), b = G('strokes', 0, 30000, p, { seed: 2 });
  assert.deepEqual(a, G('strokes', 0, 30000, p, { seed: 1 }));
  assert.notDeepEqual(a, b);
  const lin = G('strokes', 0, 30000, { ...p, shape: 'linear' }, { seed: 1 });
  const all = G('strokes', 0, 30000, { ...p, shape: { name: 'two-speed' } }, { seed: 1 });
  assert.ok(a.length > lin.length && a.length < all.length, `${lin.length} < ${a.length} < ${all.length}`);
});

test('strokes: shape knots are never turns and keep out-of-range impossible', () => {
  for (const shape of ['sine', 'ease-in', 'ease-out', 'bounce', 'hold-top', 'hold-bottom', 'hold-both', { in: 'sine', out: 'bounce' }]) {
    const s = G('strokes', 0, 15000, { rate: 2, lo: 10, hi: 70, shape }, {});
    assert.ok(isValid(s));
    const [mn, mx] = range(s);
    assert.ok(mn >= 10 && mx <= 70, `${JSON.stringify(shape)} [${mn},${mx}]`);
  }
});

// ------------------------------------------------------------ ramp

test('ramp: turn count approximates the integral of rate', () => {
  for (const [r0, r1, curve] of [[1, 3, 'linear'], [3, 1, 'linear'], [1, 4, 'exp'], [2, 2, 'linear'], [1, 3, 'ease-in']]) {
    const s = G('ramp', 0, 20000, { rate0: r0, rate1: r1, amp0: 1, amp1: 1, curve, lo: 10, hi: 60 }, { maxSpeed: 0 });
    const f = { linear: (u) => u, exp: (u) => u, 'ease-in': (u) => u * u }[curve];
    let want = 0;
    for (let i = 0; i < 1000; i++) { const u = (i + 0.5) / 1000; want += (curve === 'exp' ? r0 * (r1 / r0) ** u : r0 + (r1 - r0) * f(u)) * 20 / 1000; }
    near(turnsIn(s, 1, 19999), want, 0.1 * want + 2, `${curve} ${r0}->${r1}`);
  }
});

test('ramp: depth goes amp0 -> amp1 toward anchor, rate1 > rate0 speeds up', () => {
  const s = G('ramp', 0, 20000, { rate0: 1, rate1: 1, amp0: 0.2, amp1: 1, curve: 'linear', lo: 0, hi: 80, shape: 'linear' }, { maxSpeed: 0 });
  const ex = extremes(s);
  const bottoms = ex.filter((e) => e.dir === -1);
  assert.ok(bottoms[0].pos > 55, `first bottom ${bottoms[0].pos}`);
  assert.ok(bottoms.at(-1).pos < 10, `last bottom ${bottoms.at(-1).pos}`);
  assert.ok(bottoms.every((b, i) => !i || b.pos <= bottoms[i - 1].pos));
  assert.ok(ex.filter((e) => e.dir === 1).every((e) => e.pos === 80), 'anchor hi keeps tops');
  const lo = G('ramp', 0, 20000, { rate0: 1, rate1: 1, amp0: 0.2, amp1: 1, curve: 'linear', lo: 0, hi: 80, anchor: 'lo' }, { maxSpeed: 0 });
  assert.ok(extremes(lo).filter((e) => e.dir === -1).every((e) => e.pos === 0));
});

test('ramp: step curve and fade-out (amp1 0) end near the anchor', () => {
  const s = G('ramp', 0, 20000, { rate0: 2, rate1: 0.6, amp0: 0.8, amp1: 0, curve: 'ease-out', lo: 0, hi: 90 }, {});
  assert.ok(isValid(s));
  assert.ok(s.slice(-3).every((a) => a.pos >= 85), `ends near the top: ${JSON.stringify(s.slice(-3))}`);
});

test('ramp: intensity rate scaling', () => {
  const s = G('ramp', 0, 20000, { rate0: 2, rate1: 2, amp0: 1, amp1: 1, intensity: 0.5, lo: 10, hi: 60 }, {});
  near(turnsIn(s, 1, 19999) / 20, 1.5, 0.15);
});

// ------------------------------------------------------------ smooth

test('smooth: stays in band, rate, seed variation, amp', () => {
  const p = { lo: 40, hi: 90, amp: 14, rate: 1.4 };
  const s = G('smooth', 0, 30000, p, { seed: 3 });
  const [mn, mx] = range(s);
  assert.ok(mn >= 40 && mx <= 90);
  near(turnsIn(s, 1, 29999) / 30, 1.4, 0.25);
  assert.notDeepEqual(s, G('smooth', 0, 30000, p, { seed: 4 }));
  assert.notDeepEqual(s, G('smooth', 0, 30000, { ...p, seed: 1 }, { seed: 3 }));
  assert.deepEqual(s, G('smooth', 0, 30000, p, { seed: 3 }));
  // small strokes: each half-stroke is at most ~amp
  const ex = extremes(s);
  for (let i = 1; i < ex.length; i++) assert.ok(Math.abs(ex[i].pos - ex[i - 1].pos) <= 14 + 12, `stroke ${Math.abs(ex[i].pos - ex[i - 1].pos)}`);
  // amp bigger than the band is clamped to the band
  const w = G('smooth', 0, 10000, { lo: 40, hi: 60, amp: 90 }, {});
  assert.ok(range(w)[0] >= 40 && range(w)[1] <= 60);
  near(turnsIn(G('smooth', 0, 30000, { lo: 40, hi: 90, spm: 60 }, { seed: 3 }), 1, 29999) / 30, 2, 0.35, 'spm alias');
});

test('smooth: intensity (anchor mid) shrinks about the band centre', () => {
  const p = { lo: 40, hi: 90, amp: 20, variation: 0 };
  const full = range(G('smooth', 0, 30000, p, { seed: 1 })), half = range(G('smooth', 0, 30000, { ...p, intensity: 0.5 }, { seed: 1 }));
  assert.ok(half[1] - half[0] < (full[1] - full[0]) * 0.65, `${half} vs ${full}`);
  near((half[0] + half[1]) / 2, 65, 6);
});

// ------------------------------------------------------------ pulses

test('pulses: rate ~6.8/s early, ~4.2/s after decay; tops <= 34, bottoms near lo, no holds', () => {
  const s = G('pulses', 0, 30000, {}, { seed: 2 });
  assert.ok(isValid(s));
  near(turnsIn(s, 0, 2000) / 2, 6.8, 0.9, 'onset');
  near(turnsIn(s, 20000, 30000) / 10, 4.2, 0.4, 'after decay');
  const [mn, mx] = range(s);
  assert.ok(mx <= 34 && mn >= 1, `[${mn},${mx}]`);
  const ex = extremes(s);
  for (const e of ex.filter((x) => x.dir === -1)) assert.ok(e.pos <= 3, `bottom ${e.pos}`);
  for (const e of ex.filter((x) => x.dir === 1)) assert.ok(e.pos > 8 && e.pos <= 34, `top ${e.pos}`);
  for (let i = 1; i < s.length; i++) assert.notEqual(s[i].pos, s[i - 1].pos, `hold at ${s[i].at}`);
  // monotone-ish decay: first 2 s faster than last 5 s
  assert.ok(turnsIn(s, 0, 2000) / 2 > turnsIn(s, 25000, 30000) / 5);
});

test('tremor (orgasm fit): 333 ms flutter with the reference pattern, then decaying pulse bursts every 583 ms', () => {
  const s = G('tremor', 0, 25000, {}, { seed: 1 });   // flutter 0..19 s, pulses 19..25 s (pulseMs 6000)
  assert.ok(isValid(s) && maxSpd(s) <= 450);
  const fl = s.filter((a) => a.at < 18000), starts = fl.filter((a, i) => a.pos === 0 && fl[i + 1]?.pos === 10).map((a) => a.at);
  const per = starts.slice(1).map((t, i) => t - starts[i]);
  for (const p of per) near(p, 333, 1, 'flutter period');
  assert.deepEqual(fl.slice(0, 11).map((a) => a.pos), [0, 10, 5, 15, 10, 20, 10, 15, 5, 10, 0], 'the reference pattern');
  near(fl[11].at - fl[10].at, 67, 1, 'hold at the bottom');
  assert.ok(range(fl)[1] === 20 && range(fl)[0] === 0);
  const i20 = s.findIndex((a, i) => a.pos === 0 && s[i + 1]?.pos === 20), pu = s.slice(i20);
  near(s[i20].at, 19000, 400, 'pulses take the last 6 s');
  const tops = extremes(pu).filter((e) => e.dir === 1).map((e) => e.pos);
  assert.deepEqual(tops.slice(0, 8), [20, 15, 10, 5, 20, 15, 10, 5], 'pulses decay 20 -> 5 inside each burst');
  const bursts = pu.filter((a, i) => a.pos === 0 && pu[i + 1]?.pos === 20).map((a) => a.at);
  for (let i = 1; i < bursts.length; i++) near(bursts[i] - bursts[i - 1], 583, 1, 'burst period');
  assert.equal(s.at(-1).pos, 0, 'ends at the bottom');
  // the rest may grow toward the end (reference A #1, 24 s: 233 -> 1200 ms)
  const slow = G('tremor', 0, 20000, { pulseMs: 20000, restEndMs: 1200 }, {}), b2 = slow.filter((a, i) => a.pos === 0 && slow[i + 1]?.pos === 20).map((a) => a.at);
  assert.ok(b2.at(-1) - b2.at(-2) > b2[1] - b2[0] + 500, 'rest grows');
  // intensity shrinks toward the deep end
  assert.ok(range(G('tremor', 0, 5000, { intensity: 0.5 }, {}))[1] <= 10);
});

test('pulses: climax default has no holds across seeds and spans', () => {
  for (const seed of [0, 1, 2, 3, 4, 5]) for (const [a, b] of [[T0, T1], [0, 3000], [777, 40001]]) {
    const s = G('pulses', a, b, {}, { seed });
    assert.ok(isValid(s));
    for (let i = 1; i < s.length; i++) assert.notEqual(s[i].pos, s[i - 1].pos, `seed ${seed} ${a}-${b} hold at ${s[i].at}`);
  }
});

test('pulses: intensity 0.5 halves travel about lo and scales rate by 0.75', () => {
  const full = G('pulses', 0, 20000, {}, { seed: 1 }), half = G('pulses', 0, 20000, { intensity: 0.5 }, { seed: 1 });
  const bump = (s) => extremes(s).filter((e) => e.dir === 1).map((e) => e.pos);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  near(mean(bump(half)) - 1, (mean(bump(full)) - 1) / 2, 4);
  assert.ok(range(half)[0] <= 2, 'deep end kept');
  assert.ok(turnsIn(half, 0, 2000) / 2 < 6.8 * 0.85, `rate ${turnsIn(half, 0, 2000) / 2}`);
  near(turnsIn(half, 0, 2000) / 2, 6.8 * 0.75, 0.9);
});

test('pulses: seeds change amplitudes; start out; spm alias; custom decay', () => {
  const a = G('pulses', 0, 8000, {}, { seed: 1 }), b = G('pulses', 0, 8000, {}, { seed: 2 });
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a, G('pulses', 0, 8000, { seed: 5 }, { seed: 1 }));
  const o = G('pulses', 0, 8000, { start: 'out' }, { seed: 1 });
  assert.ok(o[0].pos <= 3 && o[1].pos > 10, 'start out begins at the bottom');
  const c = G('pulses', 0, 20000, { rate: 5, rateEnd: 2, decayMs: 5000, decayCurve: 'linear' }, { seed: 1 });
  near(turnsIn(c, 0, 1000), 5, 1.5);
  near(turnsIn(c, 10000, 20000) / 10, 2, 0.35);
  const d = G('pulses', 0, 10000, { spm: 60 }, { seed: 1 });
  near(turnsIn(d, 0, 500) / 0.5, 2, 4); // spm 60 -> 2 turns/s onset (rate param stays default? alias sets rate)
});

// ------------------------------------------------------------ follow

const tracker = (a, b, step) => { const o = []; for (let t = a; t <= b; t += step) o.push(t); return o; };

test('follow: exactly at tracker turn times when dense; kinds alternate lo/hi', () => {
  const turns = tracker(1000, 20000, 400);
  const s = G('follow', T0, T1, { lo: 5, hi: 80 }, { turns });
  const want = turns.filter((t) => t > T0 && t < T1);
  const got = s.filter((a) => a.pos === 5 || a.pos === 80).map((a) => a.at).filter((t) => t > T0 && t < T1);
  assert.deepEqual(got, want);
  // missing kinds alternate; start 'in' => first turn is a bottom
  // turns[0] (1000) is a bottom; kinds alternate from it
  for (const t of want) assert.equal(s.find((a) => a.at === t).pos, ((t - 1000) / 400) % 2 === 0 ? 5 : 80);
  const o = G('follow', T0, T1, { lo: 5, hi: 80, start: 'out' }, { turns });
  for (const t of want) assert.equal(o.find((a) => a.at === t).pos, ((t - 1000) / 400) % 2 === 0 ? 80 : 5);
  assert.equal(s[0].at, T0); assert.equal(s.at(-1).at, T1);
});

test('follow: kinds as top/bottom strings, 1/-1, objects, or missing', () => {
  const ts = [2000, 2500, 3000, 3500, 4000, 4500];
  const check = (turns, expectFirst) => {
    const s = G('follow', 1000, 5500, { lo: 10, hi: 90 }, { turns });
    const pos = (t) => s.find((a) => a.at === t)?.pos;
    assert.deepEqual(ts.map(pos), ts.map((_, i) => ((i % 2 === 0) === (expectFirst === 'top') ? 90 : 10)));
  };
  check(ts.map((at, i) => ({ at, kind: i % 2 ? 'bottom' : 'top' })), 'top');
  check(ts.map((at, i) => ({ at, kind: i % 2 ? -1 : 1 })), 'top');
  check(ts.map((at, i) => ({ at, kind: i % 2 ? 'in' : 'out' })), 'top');
  check(ts.map((at, i) => ({ at, kind: i % 2 ? 'top' : 'bottom' })), 'bottom');
  check(ts.map((at, i) => ({ at, kind: i % 2 ? 'hi' : 'lo' })), 'bottom');
  check(ts.map((at, i) => ({ at, kind: i === 0 ? 'top' : undefined })), 'top'); // later kinds alternate
  check(ts.map((at) => ({ at })), 'bottom'); // all missing: start in => bottom first
  check(ts, 'bottom');
  check(ts.map((at, i) => ({ at, kind: i === 3 ? 'bottom' : undefined })), 'top'); // alternation derived from the first known kind
});

test('follow: prepTurns inserts the missing turn between two equal kinds, sorts, dedupes', () => {
  const r = prepTurns([{ at: 3000, kind: 'top' }, { at: 1000, kind: 'top' }, { at: 2000, kind: 'bottom' }, { at: 2000, kind: 'bottom' }, { at: 5000, kind: 'top' }]);
  assert.deepEqual(r.map((x) => x.t), [1000, 2000, 3000, 4000, 5000]);
  assert.deepEqual(r.map((x) => x.k), [1, -1, 1, -1, 1]);
  for (let i = 1; i < r.length; i++) assert.notEqual(r[i].k, r[i - 1].k);
  assert.deepEqual(prepTurns([]), []);
});

test('follow: thins turn pairs closer than minHalfMs', () => {
  const turns = [2000, 2500, 3000, 3030, 3500, 4000, 4500];
  const s = G('follow', 1500, 5000, { lo: 10, hi: 90, minHalfMs: 60 }, { turns, maxSpeed: 0 });
  const ats = new Set(s.map((a) => a.at));
  assert.ok(!ats.has(3000) && !ats.has(3030), 'the pair 3000/3030 is dropped');
  for (const t of [2000, 2500, 3500, 4000, 4500]) assert.ok(ats.has(t), `${t} kept`);
  const keep = G('follow', 1500, 5000, { lo: 10, hi: 90, minHalfMs: 0 }, { turns, maxSpeed: 0, minGapMs: 10 });
  assert.ok(new Set(keep.map((a) => a.at)).has(3030));
  // alternation after thinning
  const ex = extremes(s);
  ex.forEach((e, i) => { if (i) assert.notEqual(e.dir, ex[i - 1].dir); });
});

test('follow: carries the local rate across a gap > 1.5 s, parity meets next turn', () => {
  const a = tracker(1000, 5000, 400), b = tracker(9000, 14000, 400);
  const turns = [...a, ...b];
  const s = G('follow', 1000, 14000, { lo: 5, hi: 80, shape: 'linear' }, { turns, maxSpeed: 0 });
  const gapTurns = extremes(s).filter((e) => e.at > 5000 && e.at < 9000);
  near(gapTurns.length, 9, 2, 'carried turns in a 4 s gap at 400 ms');
  for (const e of gapTurns) assert.ok(e.pos === 5 || e.pos === 80);
  const all = extremes(s);
  all.forEach((e, i) => { if (i) assert.notEqual(e.dir, all[i - 1].dir, `alternation at ${e.at}`); });
  // the tracked turn at 9000 keeps its kind (the series alternates unbroken)
  const kind = (t) => s.find((x) => x.at === t).pos;
  const idxA = a.length - 1, idxB = 0;
  const expectedKind9000 = (idxA + 1 + gapTurns.length + idxB) % 2; // parity of number of extremes since 5000
  assert.equal(kind(9000), kind(5000) === 5 ? (gapTurns.length % 2 === 0 ? 80 : 5) : (gapTurns.length % 2 === 0 ? 5 : 80));
  void expectedKind9000;
  // carry: false leaves the gap empty
  const nc = G('follow', 1000, 14000, { lo: 5, hi: 80, carry: false }, { turns, maxSpeed: 0 });
  assert.equal(extremes(nc).filter((e) => e.at > 5100 && e.at < 8900).length, 0);
  // gap shorter than 1.5 s is not carried
  const small = G('follow', 1000, 6000, { lo: 5, hi: 80 }, { turns: [...tracker(1000, 3000, 400), ...tracker(4200, 6000, 400)], maxSpeed: 0 });
  assert.equal(extremes(small).filter((e) => e.at > 3000 && e.at < 4200).length, 0);
});

test('follow: carry parity holds for odd / even gap lengths and equal / unequal kinds', () => {
  for (const gapEnd of [8000, 8300, 8700, 9100, 9500, 10300]) for (const nextKind of ['top', 'bottom']) {
    const turns = [
      ...tracker(1000, 3000, 400).map((at, i) => ({ at, kind: i % 2 ? 'top' : 'bottom' })), // ends bottom (1000,..,3000: i=5 -> top)
      { at: gapEnd, kind: nextKind }, { at: gapEnd + 400, kind: nextKind === 'top' ? 'bottom' : 'top' },
    ];
    const s = G('follow', 1000, gapEnd + 400, { lo: 5, hi: 80, shape: 'linear' }, { turns, maxSpeed: 0, minGapMs: 1 });
    assert.ok(isValid(s));
    const ex = extremes(s);
    ex.forEach((e, i) => { if (i) assert.notEqual(e.dir, ex[i - 1].dir, `gapEnd ${gapEnd} ${nextKind}: no alternation at ${e.at}`); });
    assert.equal(s.find((a) => a.at === gapEnd).pos, nextKind === 'top' ? 80 : 5, `gapEnd ${gapEnd} ${nextKind}`);
  }
});

test('follow: edges carried at the local rate; fallbackRate with no turns', () => {
  const turns = tracker(8000, 12000, 500); // 2 turns/s locally
  const s = G('follow', 2000, 18000, { lo: 5, hi: 80, shape: 'linear' }, { turns, maxSpeed: 0 });
  near(turnsIn(s, 2100, 7900) / 5.8, 2, 0.4, 'leading carry');
  near(turnsIn(s, 12100, 17900) / 5.8, 2, 0.4, 'trailing carry');
  const none = G('follow', 0, 20000, { lo: 5, hi: 80, fallbackRate: 3, shape: 'linear' }, { turns: [], maxSpeed: 0 });
  near(turnsIn(none, 1, 19999) / 20, 3, 0.3);
  const def = G('follow', 0, 20000, {}, { maxSpeed: 0 });
  near(turnsIn(def, 1, 19999) / 20, 2.4, 0.3);
  // turns far outside contextMs do not count
  const far = G('follow', 0, 10000, { fallbackRate: 4, lo: 5, hi: 80 }, { turns: tracker(100000, 120000, 300), maxSpeed: 0 });
  near(turnsIn(far, 1, 9999) / 10, 4, 0.5);
  // a single turn: nothing to estimate the rate from -> fallback
  const one = G('follow', 0, 10000, { fallbackRate: 3, lo: 5, hi: 80 }, { turns: [5000], maxSpeed: 0 });
  near(turnsIn(one, 1, 9999) / 10, 3, 0.5);
});

test('follow: followTimes alternate and cover [t0,t1]; fallback start direction', () => {
  const ft = followTimes(1000, 9000, { fallbackRate: 2 }, { turns: [] });
  assert.ok(ft[0].t <= 1000 && ft.at(-1).t >= 9000);
  assert.deepEqual(ft.slice(0, 3).map((x) => x.k), [1, -1, 1]);
  assert.deepEqual(followTimes(1000, 9000, { fallbackRate: 2, start: 'out' }, { turns: [] }).slice(0, 2).map((x) => x.k), [-1, 1]);
  const t = followTimes(0, 20000, {}, { turns: tracker(3000, 9000, 350) });
  t.forEach((x, i) => { if (i) { assert.notEqual(x.k, t[i - 1].k); assert.ok(x.t > t[i - 1].t); } });
});

test('follow: too-fast tracker strokes shrink toward anchor, cap respected', () => {
  const turns = tracker(1000, 10000, 100); // 10 turns/s
  const s = G('follow', 1000, 10000, { lo: 0, hi: 100 }, { turns, maxSpeed: 450 });
  assert.ok(maxSpd(s) <= 450);
  const [mn, mx] = range(s);
  assert.equal(mx, 100);
  assert.ok(mn > 40, `shrunk, min ${mn}`);
  assert.ok(turnsIn(s, 1100, 9900) >= 85, 'keeps the tracker timing');
});

test('follow: intensity and fade apply', () => {
  const turns = tracker(1000, 20000, 400);
  const s = G('follow', 0, 20000, { lo: 0, hi: 80, intensity: 0.5 }, { turns });
  assert.deepEqual(range(s), [40, 80]);
  const f = G('follow', 0, 20000, { lo: 0, hi: 80, fadeFrom: 1, fadeTo: 0 }, { turns });
  assert.ok(range(f.filter((a) => a.at > 18000))[0] > 60);
});

// ------------------------------------------------------------ knot

test('knot: bumps bottom out at knotLevel; pops reach lo and hi', () => {
  const s = G('knot', 0, 40000, { lo: 5, hi: 90, knotLevel: 40, between: 3 }, { seed: 1, turns: [] });
  assert.ok(isValid(s));
  const [mn, mx] = range(s);
  assert.equal(mn, 5);
  assert.equal(mx, 90);
  // first bumps: before the first press, local minima are the knot level
  const ex = extremes(s);
  const firstBottoms = ex.filter((e) => e.dir === -1).slice(0, 3);
  for (const b of firstBottoms) assert.equal(b.pos, 40, 'bump bottom');
  const tops = ex.filter((e) => e.dir === 1).slice(0, 3);
  for (const t of tops) assert.equal(t.pos, 90);
  // pops: some bottom at lo
  assert.ok(ex.filter((e) => e.dir === -1).some((e) => e.pos <= 5 + 3));
  assert.ok(s.some((a) => a.pos === 5));
});

test('knot: bump rate with timing rate', () => {
  const s = G('knot', 0, 4000, { rate: 2.4, between: 4, timing: 'rate' }, { turns: [{ at: 1, kind: 'top' }] });
  const ex = extremes(s);
  const half = 1000 / 2.4;
  ex.slice(0, 6).forEach((e, i) => near(e.at, (i + 1) * half, 20, `turn ${i}`));
});

test('knot: timing auto takes bump times from ctx.turns, rate otherwise; follow timing with no turns', () => {
  const turns = tracker(500, 4000, 500);
  const s = G('knot', 0, 4000, { between: 6, lo: 0, hi: 85, knotLevel: 30 }, { turns });
  const ex = extremes(s);
  for (const e of ex.slice(0, 5)) assert.ok(turns.some((t) => Math.abs(t - e.at) <= 45), `turn ${e.at} near a tracker turn`);
  const r = G('knot', 0, 4000, { between: 6, timing: 'rate', rate: 2 }, { turns });
  near(extremes(r)[0].at, 500, 20);
  const f = G('knot', 0, 4000, { between: 6, timing: 'follow', fallbackRate: 2 }, {});
  assert.ok(isValid(f));
});

test('knot: durations lengthen instead of exceeding the cap; depth is kept', () => {
  for (const maxSpeed of [450, 200, 100]) {
    const s = G('knot', 0, 60000, { lo: 0, hi: 85, knotLevel: 30, popMs: 30, pushMs: 50, pullMs: 0, rate: 9, between: 1 }, { seed: 1, maxSpeed });
    assert.ok(maxSpd(s) <= maxSpeed, `cap ${maxSpeed}: ${maxSpd(s)}`);
    const [mn, mx] = range(s);
    assert.equal(mn, 0, `deep reached at ${maxSpeed}`);
    assert.equal(mx, 85, `out reached at ${maxSpeed}`);
    const ex = extremes(s);
    assert.ok(ex.some((e) => e.dir === -1 && e.pos === 0), 'a pop bottom');
    assert.ok(ex.filter((e) => e.dir === -1 && e.pos > 0).every((e) => e.pos >= 27), 'bumps keep the knot level');
  }
});

test('knot: tied ends in a small range at the deep end', () => {
  const s = G('knot', 0, 60000, { tied: true, popsBeforeTie: 2, lo: 0, hi: 85, tiedAmp: 10, tiedRate: 2, between: 2 }, { seed: 1 });
  assert.ok(isValid(s));
  const tail = s.filter((a) => a.at > 50000);
  assert.ok(Math.max(...tail.map((a) => a.pos)) <= 10, `tail max ${Math.max(...tail.map((a) => a.pos))}`);
  assert.equal(Math.min(...tail.map((a) => a.pos)), 0);
  near(turnsIn(s, 50000, 60000) / 10, 2, 0.5, 'tied rate');
  // before the tie, 2 pops happened: at least 2 climbs back to hi
  assert.ok(extremes(s).filter((e) => e.dir === 1 && e.pos === 85).length >= 2 * 2 + 2);
  const untied = G('knot', 0, 60000, { tied: false, between: 2 }, { seed: 1 });
  assert.ok(untied.filter((a) => a.at > 50000).some((a) => a.pos > 40));
  // popsBeforeTie 0 ties at the first push
  const zero = G('knot', 0, 30000, { tied: true, popsBeforeTie: 0, between: 1 }, { seed: 1 });
  assert.ok(zero.filter((a) => a.at > 20000).every((a) => a.pos <= 10));
});

test('knot: all-bumps (between large) never pops; between 0 pops immediately', () => {
  const s = G('knot', 0, 10000, { between: 32, lo: 0, hi: 85, knotLevel: 30 }, {});
  assert.ok(range(s)[0] >= 28);
  const z = G('knot', 0, 10000, { between: 0, lo: 0, hi: 85 }, {});
  assert.equal(range(z)[0], 0);
});

test('knot: knotLevel is clamped into the range', () => {
  const s = G('knot', 0, 10000, { lo: 20, hi: 60, knotLevel: 5 }, {});
  assert.ok(range(s)[0] >= 20 && range(s)[1] <= 60);
  const t = G('knot', 0, 10000, { lo: 20, hi: 60, knotLevel: 99 }, {});
  assert.ok(range(t)[0] >= 20 && range(t)[1] <= 60);
});

// ------------------------------------------------------------ tease

test('tease: shallow strokes at the out edge, dips, stays in range, rate', () => {
  const s = G('tease', 0, 40000, { lo: 0, hi: 95, rate: 2, edge: 0.3, every: 3, dip: 0.7, full: 0, variation: 0 }, { seed: 1 });
  assert.ok(isValid(s));
  const ex = extremes(s);
  assert.equal(range(s)[1], 95);
  // shallow bottoms ~ 95 - 0.3*95 = 66.5; dips ~ 95 - 0.7*95 = 28.5
  const bottoms = ex.filter((e) => e.dir === -1).map((e) => e.pos);
  assert.ok(bottoms.some((b) => Math.abs(b - 66.5) <= 2));
  assert.ok(bottoms.some((b) => Math.abs(b - 28.5) <= 2));
  assert.ok(bottoms.every((b) => b >= 27), 'full: 0 never goes all the way');
  const r = turnsIn(s, 1, 39999) / 40;
  assert.ok(r > 1.2 && r < 2.6, `rate ${r}`);
});

test('tease: full = 1 always goes all the way; seed varies it', () => {
  const s = G('tease', 0, 40000, { full: 1, every: 1 }, { seed: 1 });
  assert.equal(range(s)[0], 0);
  const a = G('tease', 0, 40000, { full: 0.5, variation: 0.5 }, { seed: 1 }), b = G('tease', 0, 40000, { full: 0.5, variation: 0.5 }, { seed: 2 });
  assert.notDeepEqual(a, b);
  assert.deepEqual(a, G('tease', 0, 40000, { full: 0.5, variation: 0.5 }, { seed: 1 }));
  assert.notDeepEqual(G('tease', 0, 40000, { seed: 3 }, { seed: 1 }), G('tease', 0, 40000, {}, { seed: 1 }));
});

test('tease: pause where the dip stops is a hold at that depth', () => {
  const s = G('tease', 0, 30000, { pauseMs: 400, full: 0, variation: 0, every: 1 }, { seed: 1 });
  let holds = 0;
  for (let i = 1; i < s.length; i++) if (s[i].pos === s[i - 1].pos && s[i].at - s[i - 1].at >= 350) holds++;
  assert.ok(holds >= 3, `holds ${holds}`);
  const none = G('tease', 0, 30000, { pauseMs: 0, full: 0, variation: 0, every: 1 }, { seed: 1 });
  for (let i = 1; i < none.length; i++) assert.ok(none[i].pos !== none[i - 1].pos || none[i].at - none[i - 1].at < 350);
});

// ------------------------------------------------------------ beats

test('beats: one extreme per beat (alternate), deep/out alternating', () => {
  const beats = tracker(2000, 12000, 500);
  const s = G('beats', 0, 20000, { lo: 5, hi: 80 }, { beats });
  assert.ok(isValid(s));
  beats.forEach((b, i) => {
    const a = s.find((x) => x.at === b);
    assert.ok(a, `point at beat ${b}`);
    assert.equal(a.pos, i % 2 === 0 ? 5 : 80, `beat ${i}`);
  });
  const ex = extremes(s);
  assert.equal(ex.length, beats.length - 0 - 0 || ex.length);
  assert.ok(ex.length >= beats.length - 1 && ex.length <= beats.length + 1);
  assert.ok(s[0].at >= 0 && s.at(-1).at <= 20000);
  const o = G('beats', 0, 20000, { lo: 5, hi: 80, start: 'out' }, { beats });
  assert.equal(o.find((x) => x.at === beats[0]).pos, 80);
});

test('beats: hit mode: every beat deep, out point between', () => {
  const beats = tracker(2000, 10000, 500);
  const s = G('beats', 0, 12000, { lo: 5, hi: 80, mode: 'hit' }, { beats });
  for (const b of beats) assert.equal(s.find((x) => x.at === b).pos, 5);
  for (let i = 0; i < beats.length - 1; i++) assert.ok(s.some((x) => x.at === beats[i] + 250 && x.pos === 80), `out between ${beats[i]}`);
  const f = G('beats', 0, 12000, { lo: 5, hi: 80, mode: 'hit', outFrac: 0.3 }, { beats });
  assert.ok(f.some((x) => x.at === 2150 && x.pos === 80));
});

test('beats: times from params.times > ctx.beats > ctx.taps; {at} objects; every; offsetMs; unsorted/dups', () => {
  const p = { lo: 0, hi: 100, maxSpeed: 0 };
  const a = G('beats', 0, 9000, { ...p, times: [3000, 4000, 5000] }, { beats: [1000, 2000], taps: [7000] });
  assert.ok(a.some((x) => x.at === 3000) && !a.some((x) => x.at === 1000));
  const b = G('beats', 0, 9000, p, { beats: [1000, 2000], taps: [7000] });
  assert.ok(b.some((x) => x.at === 1000));
  const c = G('beats', 0, 9000, p, { taps: [{ at: 7000 }, { at: 8000 }] });
  assert.ok(c.some((x) => x.at === 7000) && c.some((x) => x.at === 8000));
  const e = G('beats', 0, 9000, { ...p, every: 2 }, { beats: [1000, 2000, 3000, 4000, 5000] });
  const hit = (s, t) => s.some((x) => x.at === t);
  assert.ok(hit(e, 1000) && hit(e, 3000) && hit(e, 5000));
  assert.ok(!hit(e, 2000) && !hit(e, 4000));
  const off = G('beats', 0, 9000, { ...p, offsetMs: 100 }, { beats: [1000, 2000, 3000] });
  assert.ok(hit(off, 1100) && hit(off, 2100) && !hit(off, 1000));
  const m = G('beats', 0, 9000, p, { beats: [3000, 1000, 2000, 2000] });
  assert.ok(isValid(m));
  assert.ok(hit(m, 1000) && hit(m, 2000) && hit(m, 3000));
});

test('beats: no beats -> empty; beats only inside the span are used; mid-list parity is stable', () => {
  assert.deepEqual(G('beats', 0, 9000, {}, {}), []);
  assert.deepEqual(G('beats', 0, 9000, {}, { beats: [] }), []);
  const beats = tracker(1000, 30000, 500);
  const whole = G('beats', 0, 30000, { lo: 0, hi: 100, maxSpeed: 0 }, { beats });
  const part = G('beats', 10250, 20250, { lo: 0, hi: 100 }, { beats });
  for (const x of part) if (beats.includes(x.at)) assert.equal(x.pos, whole.find((w) => w.at === x.at).pos, `beat ${x.at}`);
  assert.ok(part.some((x) => beats.includes(x.at)));
  assert.ok(part.every((x) => x.at >= 10250 && x.at <= 20250));
});

test('beats: single beat, and beat outside span', () => {
  const s = G('beats', 0, 5000, { lo: 0, hi: 90 }, { beats: [2000] });
  assert.ok(isValid(s));
  assert.ok(s.some((x) => x.at === 2000 && x.pos === 0));
  const out = G('beats', 0, 5000, {}, { beats: [20000, 20500] });
  assert.ok(isValid(out));
});

test('beats: one extreme per beat holds at 450 cap with fast beats', () => {
  const beats = tracker(500, 8000, 120);
  const s = G('beats', 0, 9000, { lo: 0, hi: 100 }, { beats });
  assert.ok(maxSpd(s) <= 450);
  assert.ok(extremes(s).length >= beats.length - 2);
});

// ------------------------------------------------------------ defaults / misc

test('missing params take schema defaults', () => {
  for (const id of Object.keys(CASES)) {
    const explicit = {};
    for (const s of GENERATORS[id].schema) explicit[s.key] = s.default;
    assert.deepEqual(G(id, T0, T1, explicit, baseCtx()), G(id, T0, T1, {}, baseCtx()), id);
  }
});

test('undefined param values fall back to defaults', () => {
  assert.deepEqual(G('strokes', T0, T1, { rate: undefined, lo: undefined }, {}), G('strokes', T0, T1, {}, {}));
});

test('non-integer t0/t1 are rounded', () => {
  const s = G('strokes', 1000.4, 5000.6, {}, {});
  assert.equal(s[0].at, 1000);
  assert.equal(s.at(-1).at, 5001);
  assert.ok(isValid(s));
});

test('maxSpeed 0 disables the cap', () => {
  const s = G('strokes', 0, 5000, { rate: 10, lo: 0, hi: 100 }, { maxSpeed: 0 });
  assert.deepEqual(range(s), [0, 100]);
  assert.ok(maxSpd(s) > 450);
});
