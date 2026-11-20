import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, SHAPE_NAMES, resolveShape, strokePoints, knotSlope } from '../src/lib/gen/shapes.js';

const sorted = (k) => k.every((x, i) => i === 0 || x[0] > k[i - 1][0]);

test('every SHAPES entry yields sorted knots with 0<u<1, for both directions', () => {
  assert.ok(SHAPE_NAMES.length >= 10);
  for (const name of SHAPE_NAMES) {
    const spec = name === 'custom' ? { name, knots: [[0.7, 0.9], [0.3, 0.2], [0, 0], [1, 1], [0.5, 0.5]] } : name;
    const r = resolveShape(spec);
    for (const d of ['in', 'out']) {
      const k = r[d].knots;
      assert.ok(sorted(k), `${name}/${d} sorted`);
      for (const [u, v] of k) {
        assert.ok(u > 0 && u < 1, `${name}/${d} u=${u}`);
        assert.ok(Number.isFinite(v), `${name}/${d} v finite`);
      }
      assert.ok(r[d].slope >= 1 && r[d].prob === 1);
    }
  }
});

test('shape params at schema extremes still give valid knots', () => {
  for (const name of SHAPE_NAMES) {
    if (name === 'custom') continue;
    const lim = {};
    for (const p of SHAPES[name].params) lim[p.key] = p.min;
    for (const bound of ['min', 'max']) {
      const s = { name };
      for (const p of SHAPES[name].params) s[p.key] = p[bound];
      for (const d of ['in', 'out']) {
        const k = resolveShape(s)[d].knots;
        assert.ok(sorted(k), `${name} ${bound}`);
        for (const [u] of k) assert.ok(u > 0 && u < 1, `${name} ${bound} u=${u}`);
      }
    }
  }
});

test('custom drops u outside (0,1) and sorts', () => {
  const k = resolveShape({ name: 'custom', knots: [[0.8, 0.9], [0, 0], [0.2, 0.1], [1, 1], [-1, 0]] }).out.knots;
  assert.deepEqual(k, [[0.2, 0.1], [0.8, 0.9]]);
});

test('linear, null, undefined: no knots', () => {
  for (const s of ['linear', null, undefined]) {
    const r = resolveShape(s);
    assert.deepEqual(r.in.knots, []);
    assert.deepEqual(r.out.knots, []);
    assert.equal(r.in.slope, 1);
  }
});

test('sample counts follow params', () => {
  assert.equal(resolveShape('sine').out.knots.length, 3);
  assert.equal(resolveShape({ name: 'sine', samples: 7 }).out.knots.length, 7);
  assert.equal(resolveShape('ease-in').out.knots.length, 2);
  assert.equal(resolveShape({ name: 'ease-out', samples: 5 }).in.knots.length, 5);
});

test('sine / ease shapes are monotone and within [0,1]', () => {
  for (const s of ['sine', 'ease-in', 'ease-out']) {
    const k = resolveShape({ name: s, samples: 9 }).out.knots;
    k.forEach(([, v], i) => { assert.ok(v >= 0 && v <= 1); if (i) assert.ok(v >= k[i - 1][1]); });
  }
  // ease-in is below the diagonal, ease-out above
  for (const [u, v] of resolveShape('ease-in').out.knots) assert.ok(v < u);
  for (const [u, v] of resolveShape('ease-out').out.knots) assert.ok(v > u);
});

test('two-speed: speed before / after the break matches ratio', () => {
  for (const [ratio, at] of [[2, 0.5], [3, 0.4], [0.5, 0.7], [5, 0.25], [1, 0.5]]) {
    const [[u, v]] = resolveShape({ name: 'two-speed', ratio, at }).out.knots;
    assert.ok(Math.abs(u - at) < 1e-12);
    const before = v / u, after = (1 - v) / (1 - u);
    assert.ok(Math.abs(before / after - ratio) < 1e-9, `ratio ${ratio}: got ${before / after}`);
    assert.ok(v > 0 && v < 1);
  }
});

test('two-speed defaults: ratio 2, at 0.5', () => {
  const [[u, v]] = resolveShape('two-speed').out.knots;
  assert.equal(u, 0.5);
  assert.ok(Math.abs(v / u / ((1 - v) / (1 - u)) - 2) < 1e-9);
});

test('bounce stays in range, reaches the end early and rebounds by amount', () => {
  const k = resolveShape({ name: 'bounce', amount: 0.2 }).out.knots;
  for (const [, v] of k) assert.ok(v >= 0 && v <= 1);
  assert.equal(k[0][1], 1);
  assert.ok(Math.abs(k[1][1] - 0.8) < 1e-12);
  assert.ok(k[0][0] < 1 && k[1][0] > k[0][0]);
});

test('hold-top only on out-strokes (pos rising), hold-bottom only on in-strokes', () => {
  const top = resolveShape('hold-top'), bot = resolveShape('hold-bottom');
  assert.equal(top.in.knots.length, 0);
  assert.ok(top.out.knots.length > 0);
  assert.equal(bot.out.knots.length, 0);
  assert.ok(bot.in.knots.length > 0);
  // through strokePoints: rising stroke gets a point, falling none
  assert.ok(strokePoints(0, 10, 1000, 90, 'hold-top').length > 0);
  assert.equal(strokePoints(0, 90, 1000, 10, 'hold-top').length, 0);
  assert.ok(strokePoints(0, 90, 1000, 10, 'hold-bottom').length > 0);
  assert.equal(strokePoints(0, 10, 1000, 90, 'hold-bottom').length, 0);
});

test('hold-* dwell: the knot sits at the end value at 1-dwell; dwell 0 gives none', () => {
  const [[u, v]] = resolveShape({ name: 'hold-top', dwell: 0.4 }).out.knots;
  assert.ok(Math.abs(u - 0.6) < 1e-12 && v === 1);
  assert.equal(resolveShape({ name: 'hold-top', dwell: 0 }).out.knots.length, 0);
  assert.equal(resolveShape({ name: 'hold-bottom', dwell: 0 }).in.knots.length, 0);
  const both = resolveShape('hold-both');
  assert.equal(both.in.knots.length, 1);
  assert.equal(both.out.knots.length, 1);
  assert.equal(resolveShape({ name: 'hold-both', dwell: 0 }).in.knots.length, 0);
});

test("hold-* strokePoints: the dwell point equals the stroke's end position", () => {
  const pts = strokePoints(0, 10, 1000, 90, { name: 'hold-top', dwell: 0.25 });
  assert.equal(pts.length, 1);
  assert.equal(pts[0].pos, 90);
  assert.equal(pts[0].at, 750);
});

test('dir spec applies only to that direction', () => {
  const o = resolveShape({ name: 'sine', dir: 'out' });
  assert.equal(o.in.knots.length, 0);
  assert.equal(o.out.knots.length, 3);
  const i = resolveShape({ name: 'sine', dir: 'in' });
  assert.equal(i.out.knots.length, 0);
  assert.equal(i.in.knots.length, 3);
});

test('{in, out} spec: different shapes per direction; missing side linear', () => {
  const r = resolveShape({ in: 'sine', out: { name: 'ease-in', samples: 4 } });
  assert.equal(r.in.knots.length, 3);
  assert.equal(r.out.knots.length, 4);
  const only = resolveShape({ out: 'sine' });
  assert.equal(only.in.knots.length, 0);
  assert.equal(only.out.knots.length, 3);
  const onlyIn = resolveShape({ in: 'two-speed' });
  assert.equal(onlyIn.in.knots.length, 1);
  assert.equal(onlyIn.out.knots.length, 0);
});

test('{in, out} with nested dir/prob specs', () => {
  const r = resolveShape({ in: { name: 'sine', prob: 0.3 }, out: { name: 'sine', dir: 'in' } });
  assert.equal(r.in.prob, 0.3);
  assert.equal(r.out.knots.length, 0);
});

test('prob carried through; default 1; linear prob 1', () => {
  assert.equal(resolveShape({ name: 'two-speed', prob: 0.25 }).out.prob, 0.25);
  assert.equal(resolveShape('two-speed').out.prob, 1);
  assert.equal(resolveShape({ name: 'two-speed', prob: 0.25 }).in.prob, 0.25);
});

test('knotSlope: linear 1, steep segments counted', () => {
  assert.equal(knotSlope([]), 1);
  assert.equal(knotSlope([[0.5, 0.5]]), 1);
  // 0 -> 0.5 in u .25 : slope 2 ; then flat ; then 0.5->1 in u .5 => 1
  assert.ok(Math.abs(knotSlope([[0.25, 0.5]]) - 2) < 1e-12);
  // slow-start: slope never below 1
  assert.equal(knotSlope([[0.5, 0.1]]), 0.9 / 0.5);
  // last segment counted (to [1,1])
  assert.ok(Math.abs(knotSlope([[0.9, 0.1]]) - 9) < 1e-9);
  // shape slope surfaces in resolveShape
  const ts = resolveShape({ name: 'two-speed', ratio: 3, at: 0.5 }).out;
  assert.ok(Math.abs(ts.slope - knotSlope(ts.knots)) < 1e-12);
  assert.ok(ts.slope > 1.4);
});

test('knotSlope ignores zero-width steps and does not mutate', () => {
  const k = [[0.5, 0.2], [0.5, 0.8]];
  const copy = JSON.stringify(k);
  assert.ok(Number.isFinite(knotSlope(k)));
  assert.equal(JSON.stringify(k), copy);
});

test('strokePoints: interior only, mapped to time and position (in and out)', () => {
  const up = strokePoints(1000, 10, 2000, 90, 'sine');
  assert.equal(up.length, 3);
  for (const p of up) { assert.ok(p.at > 1000 && p.at < 2000); assert.ok(p.pos > 10 && p.pos < 90); }
  assert.ok(Math.abs(up[1].at - 1500) < 1e-9 && Math.abs(up[1].pos - 50) < 1e-9);
  const dn = strokePoints(1000, 90, 2000, 10, 'sine');
  assert.equal(dn.length, 3);
  assert.ok(Math.abs(dn[1].pos - 50) < 1e-9);
  assert.ok(dn[0].pos < 90 && dn[0].pos > dn[1].pos);
  assert.ok(dn.every((p, i) => i === 0 || p.at > dn[i - 1].at));
});

test('strokePoints: zero travel or linear -> none; direction picks the shape', () => {
  assert.deepEqual(strokePoints(0, 50, 1000, 50, 'sine'), []);
  assert.deepEqual(strokePoints(0, 10, 1000, 90, 'linear'), []);
  assert.deepEqual(strokePoints(0, 10, 1000, 90), []);
  assert.equal(strokePoints(0, 10, 1000, 90, { in: 'sine' }).length, 0);
  assert.equal(strokePoints(0, 90, 1000, 10, { in: 'sine' }).length, 3);
});

test('strokePoints does not mutate a frozen spec', () => {
  const spec = Object.freeze({ name: 'custom', knots: Object.freeze([[0.5, 0.2], [0.2, 0.1]]) });
  assert.doesNotThrow(() => strokePoints(0, 0, 1000, 100, spec));
});

test('unknown shape throws (string, object, nested)', () => {
  assert.throws(() => resolveShape('wobble'), /unknown shape/);
  assert.throws(() => resolveShape({ name: 'wobble' }), /unknown shape/);
  assert.throws(() => resolveShape({ in: 'sine', out: 'nope' }), /unknown shape/);
  assert.throws(() => strokePoints(0, 0, 1000, 100, 'wobble'), /unknown shape/);
});

test('SHAPES schema entries are well formed', () => {
  for (const [name, def] of Object.entries(SHAPES)) {
    assert.equal(typeof def.label, 'string', name);
    assert.ok(Array.isArray(def.params), name);
    assert.equal(typeof def.knots, 'function', name);
    for (const p of def.params) { assert.ok(p.key && p.type, name); assert.ok('default' in p, name); }
  }
});
