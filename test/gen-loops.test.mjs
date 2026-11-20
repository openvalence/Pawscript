import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValid } from '../src/lib/core/script.js';
import { tile, extractCycle, retile } from '../src/lib/gen/loops.js';
import { budget } from './perf.mjs';

const C0 = 12000;
// last pos 10 -> first pos 100 over a 100 ms gap = 900 pos/s seam
const SHAPE = [[0, 100], [200, 30], [450, 0], [700, 60], [900, 10]];
const cyc = (shape = SHAPE, t0 = C0) => shape.map(([r, pos]) => ({ at: t0 + r, pos }));
const posMap = (s) => new Map(s.map((a) => [a.at, a.pos]));
const inside = (s, t0, t1) => s.every((a) => a.at >= t0 && a.at <= t1);

test('N tiles copy the cycle shape exactly; valid; inside range', () => {
  const c = cyc(), N = 5;
  const { script, tiles, issues } = tile(c, C0, 1000, C0, C0 + N * 1000 - 1, { partial: 'drop' });
  assert.equal(tiles.length, N);
  assert.ok(isValid(script) && inside(script, C0, C0 + N * 1000 - 1));
  assert.deepEqual(issues.map((x) => x.msg), ['loop seam moves at 900 pos/s (cap 450)']);
  tiles.forEach((t, k) => {
    assert.deepEqual(t, { k, start: C0 + k * 1000, end: C0 + (k + 1) * 1000, partial: false });
    const pts = script.filter((a) => a.at >= t.start && a.at < t.end).map((a) => [a.at - t.start, a.pos]);
    assert.deepEqual(pts, SHAPE);
  });
  // clip over the same range = same points + an interpolated edge at the range end (seam motion, 9999)
  const clip = tile(c, C0, 1000, C0, C0 + N * 1000 - 1);
  assert.deepEqual(clip.script.slice(0, -1), script);
  assert.deepEqual(clip.script.at(-1), { at: C0 + N * 1000 - 1, pos: 99 });
});

test('anchors exact for fractional periods over 1000 cycles (no drift)', () => {
  for (const P of [1001.37, 8300 / 3]) {
    const shape = [[0, 90], [300, 10], [Math.floor(P) - 1, 80]];
    const { script, tiles } = tile(cyc(shape), C0, P, C0, Math.round(C0 + 1000 * P));
    assert.ok(isValid(script));
    assert.equal(tiles.length, 1001);
    const m = posMap(script);
    for (const t of tiles) {
      assert.equal(t.start, Math.round(C0 + t.k * P));
      assert.equal(m.get(t.start), 90);
      if (!t.partial) assert.equal(m.get(t.start + 300), 10);
    }
    assert.equal(tiles.at(-1).start, Math.round(C0 + 1000 * P));
  }
});

test('seam: speed reported, spike shown not hidden; join meet', () => {
  const r = tile(cyc(), C0, 1000, C0, C0 + 3000);
  assert.deepEqual(r.seam, { speed: 900, spike: true, gapMs: 100, fromPos: 10, toPos: 100 });
  assert.ok(r.issues.some((x) => /seam/.test(x.msg)));
  const m = posMap(r.script);
  assert.equal(m.get(C0 + 900), 10); assert.equal(m.get(C0 + 1000), 100); // the spike is still there
  assert.equal(tile(cyc(), C0, 1000, C0, C0 + 3000, { maxSpeed: 1000 }).seam.spike, false);

  // fractional period: worst case uses floor(P)
  assert.equal(tile(cyc(), C0, 1000.6, C0, C0 + 3000).seam.gapMs, 100);

  const closing = [[0, 100], [400, 0], [970, 90]];
  const keep = tile(cyc(closing), C0, 1000, C0, C0 + 3000);
  assert.equal(keep.seam.gapMs, 30); assert.ok(Math.abs(keep.seam.speed - 10000 / 30) < 1e-9);
  const meet = tile(cyc(closing), C0, 1000, C0, C0 + 3000, { join: 'meet' });
  assert.deepEqual(meet.seam, { speed: 0, spike: false, gapMs: 30, fromPos: 100, toPos: 100 });
  assert.equal(posMap(meet.script).get(C0 + 1970), 100);
  // last point outside the tolerance: unchanged, warned
  const far = tile(cyc(), C0, 1000, C0, C0 + 3000, { join: 'meet' });
  assert.equal(far.seam.speed, 900);
  assert.ok(far.issues.some((x) => /meet/.test(x.msg)));
});

test('partial clip / drop at both ends, negative k, edges interpolated (also across the seam)', () => {
  const c = cyc();
  const clip = tile(c, C0, 1000, C0 + 250, C0 + 2600);
  assert.deepEqual(clip.tiles.map((t) => [t.k, t.partial]), [[0, true], [1, false], [2, true]]);
  assert.ok(isValid(clip.script) && inside(clip.script, C0 + 250, C0 + 2600));
  assert.deepEqual(clip.script[0], { at: C0 + 250, pos: 24 });
  assert.deepEqual(clip.script.at(-1), { at: C0 + 2600, pos: 36 });

  const drop = tile(c, C0, 1000, C0 + 250, C0 + 2600, { partial: 'drop' });
  assert.deepEqual(drop.tiles, [{ k: 1, start: C0 + 1000, end: C0 + 2000, partial: false }]);
  assert.deepEqual(drop.script, cyc(SHAPE, C0 + 1000));

  // range before the cycle: tiled backward
  const back = tile(c, C0, 1000, C0 - 1500, C0 + 500);
  assert.deepEqual(back.tiles.map((t) => [t.k, t.start, t.partial]), [[-2, C0 - 2000, true], [-1, C0 - 1000, false], [0, C0, true]]);
  assert.deepEqual(back.script[0], { at: C0 - 1500, pos: 12 });
  assert.deepEqual(back.script.at(-1), { at: C0 + 500, pos: 12 });
  assert.ok(isValid(back.script));

  // edges inside the seam gap interpolate across it (10 -> 100)
  const seamEdge = tile(c, C0, 1000, C0 - 50, C0 + 950);
  assert.deepEqual(seamEdge.script[0], { at: C0 - 50, pos: 55 });
  assert.deepEqual(seamEdge.script.at(-1), { at: C0 + 950, pos: 55 });

  // never below 0 ms
  const zero = tile(cyc(SHAPE, 300), 300, 1000, -5000, 2000);
  assert.ok(isValid(zero.script) && zero.script[0].at === 0);
});

test('explicit starts, stretch, collisions stay valid', () => {
  const c = cyc(SHAPE, 0), starts = [0, 1000, 1900, 3100];
  const plain = tile(c, 0, 1000, 0, 5000, { starts, partial: 'drop' });
  assert.deepEqual(plain.tiles.map((t) => [t.start, t.end]), [[0, 1000], [1000, 1900], [1900, 3100], [3100, 4100]]);
  assert.ok(isValid(plain.script));
  const m = posMap(plain.script);
  assert.equal(m.get(1900), 100); // tile 1's offset 900 would land on tile 2's start: dropped, later tile wins
  assert.equal(m.get(1700), 60);
  assert.ok(plain.issues.some((x) => /dropped/.test(x.msg)));
  assert.deepEqual(plain.seam, { speed: 900, spike: true, gapMs: 100, fromPos: 10, toPos: 100 }); // worst spacing

  const st = tile(c, 0, 1000, 0, 5000, { starts, stretch: true, partial: 'drop' });
  const pts = st.script.filter((a) => a.at >= 1900 && a.at < 3100).map((a) => [a.at - 1900, a.pos]);
  assert.deepEqual(pts, [[0, 100], [240, 30], [540, 0], [840, 60], [1080, 10]]);
  assert.ok(isValid(st.script));

  // tiny tile: stretched offsets collide; later point wins, still valid
  const tiny = tile(c, 0, 1000, 0, 3000, { starts: [0, 1000, 1003, 2000], stretch: true });
  assert.ok(isValid(tiny.script) && inside(tiny.script, 0, 3000));

  // fractional grid: a point at offset 1000 of P=1000.5 lands on the next start in 1000-ms tiles
  const frac = tile(cyc([[0, 100], [500, 0], [1000, 50]], 0), 0, 1000.5, 0, 20000);
  assert.ok(isValid(frac.script));
  assert.ok(frac.issues.some((x) => /dropped/.test(x.msg)));
  for (const t of frac.tiles) assert.equal(posMap(frac.script).get(t.start), 100);
});

test('variation: seeded, reproducible, starts exact, in range, independent of range', () => {
  const c = cyc(), P = 1001.37, vary = { seed: 1, amp: 0.3, timeMs: 40 };
  const a = tile(c, C0, P, C0, C0 + 50 * P, { vary });
  const b = tile(c, C0, P, C0, C0 + 50 * P, { vary: { ...vary } });
  assert.deepEqual(a, b);
  assert.notDeepEqual(tile(c, C0, P, C0, C0 + 50 * P, { vary: { ...vary, seed: 2 } }).script, a.script);
  assert.ok(isValid(a.script));
  const plain = tile(c, C0, P, C0, C0 + 50 * P);
  assert.notDeepEqual(a.script.map((x) => x.pos), plain.script.map((x) => x.pos));
  assert.notDeepEqual(a.script.map((x) => x.at), plain.script.map((x) => x.at));
  const m = posMap(a.script);
  for (const t of a.tiles) {
    assert.equal(t.start, Math.round(C0 + t.k * P));
    assert.equal(m.get(t.start), 100); // anchor 'hi' = cycle max: the first point keeps its pos too
  }
  // tile 5 identical whichever range it is tiled in
  const t5 = (r) => r.script.filter((x) => x.at >= r.tiles.find((t) => t.k === 5).start && x.at < r.tiles.find((t) => t.k === 5).end);
  const other = tile(c, C0, P, C0 + 3 * P, C0 + 8 * P, { vary });
  assert.deepEqual(t5(other), t5(a));
  // heavy jitter still never crosses neighbours
  assert.ok(isValid(tile(c, C0, P, C0, C0 + 200 * P, { vary: { seed: 9, amp: 1, timeMs: 10000 } }).script));
});

test('extractCycle includeStart', () => {
  const s = [{ at: 11900, pos: 50 }, { at: 12100, pos: 70 }, { at: 12900, pos: 0 }, { at: 13000, pos: 20 }];
  assert.deepEqual(extractCycle(s, 12000, 1000), [{ at: 12000, pos: 60 }, { at: 12100, pos: 70 }, { at: 12900, pos: 0 }]);
  assert.deepEqual(extractCycle(s, 12000, 1000, { includeStart: false }), [{ at: 12100, pos: 70 }, { at: 12900, pos: 0 }]);
  assert.deepEqual(extractCycle(s, 12100, 800), [{ at: 12100, pos: 70 }]);
});

test('retile reproduces the source, follows edits, never mutates inputs', () => {
  const src = [{ at: 0, pos: 50 }, { at: 11000, pos: 70 }, ...cyc(), { at: 13500, pos: 33 }, { at: 20000, pos: 40 }];
  const snap = JSON.stringify(src);
  const loop = { t0: C0, t1: C0 + 1000, tiledTo: C0 + 5000 };
  const { script, report } = retile(src, loop);
  assert.equal(JSON.stringify(src), snap);
  assert.ok(isValid(script));
  assert.deepEqual(script.filter((a) => a.at >= C0 && a.at < C0 + 1000), cyc()); // tile 0 = source
  assert.deepEqual(script.filter((a) => a.at < C0 || a.at > C0 + 5000), [src[0], src[1], src.at(-1)]);
  assert.equal(posMap(script).get(C0 + 3450), 0);
  assert.equal(report.tiles.length, 6); // 0..4 full, 5 = the edge point at tiledTo
  assert.equal(report.seam.speed, 900);

  const edited = script.map((a) => (a.at === C0 + 450 ? { at: a.at, pos: 20 } : a));
  const again = retile(edited, loop).script;
  for (let k = 0; k < 5; k++) assert.equal(posMap(again).get(C0 + k * 1000 + 450), 20);

  const ranged = retile(src, { t0: C0, t1: C0 + 1000, periodMs: 1000, tiledTo: { t0: C0 - 2000, t1: C0 + 2000 } }).script;
  assert.deepEqual(ranged.filter((a) => a.at >= C0 - 2000 && a.at < C0 - 1000), cyc(SHAPE, C0 - 2000));
  // an unusable loop leaves the script alone
  assert.deepEqual(retile(src, { t0: C0, t1: C0, tiledTo: 40000 }).script, src);
  assert.deepEqual(retile([], loop).script, []);
});

test('performance: 2000 cycles of a 10-point cycle', () => {
  const P = 8300 / 3, shape = Array.from({ length: 10 }, (_, i) => [Math.round((i * P) / 10), i % 2 ? 5 : 95]);
  const c = cyc(shape);
  const t = performance.now();
  const r = tile(c, C0, P, C0, C0 + 2000 * P, { vary: { seed: 3, amp: 0.1, timeMs: 20 } });
  const ms = performance.now() - t;
  console.log(`tile 2000 cycles (${r.script.length} points): ${ms.toFixed(1)} ms`);
  assert.ok(isValid(r.script));
  assert.equal(r.tiles.length, 2001);
  budget(ms < 500);
});
