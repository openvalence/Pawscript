// Hand-computed expectations for the edit library (src/lib/edit).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/lib/edit/index.js';
import { isValid } from '../src/lib/core/script.js';

const S = (...pairs) => pairs.map(([at, pos]) => ({ at, pos }));
const P = (r) => r.script.map((a) => [a.at, a.pos]);
const B = S([0, 0], [100, 100], [200, 0], [300, 100], [400, 0]);
const ats = (...a) => ({ ats: a });
const eq = (r, ...pairs) => assert.deepEqual(P(r), pairs);

test('turns and strokes', () => {
  assert.deepEqual(E.turns(B).map((t) => [t.i, t.kind]), [[0, 'bottom'], [1, 'top'], [2, 'bottom'], [3, 'top'], [4, 'bottom']]);
  assert.deepEqual(E.turns(S([0, 0], [100, 50], [200, 48], [300, 60], [400, 0]), 5).map((t) => t.i), [0, 3, 4]);
  assert.deepEqual(E.turns(S([0, 0], [100, 50], [200, 100])).map((t) => [t.i, t.kind]), [[0, 'bottom'], [2, 'top']]);
  assert.deepEqual(E.turns(S([0, 0], [100, 100], [200, 100], [300, 0])).map((t) => t.i), [0, 1, 3]); // plateau: first index
  assert.deepEqual(E.turns(S([0, 5], [100, 5])), []);
  assert.deepEqual(E.turns(S([0, 5])), []);
  assert.deepEqual(E.turns([]), []);
  assert.deepEqual(E.turns(S([0, 50], [100, 100], [200, 20], [300, 80]), 0, { endpoints: false }).map((t) => t.i), [1, 2]);
  const st = E.strokes(B);
  assert.equal(st.length, 4);
  assert.deepEqual(st.map((s) => s.dir), [1, -1, 1, -1]);
  assert.deepEqual([st[0].i0, st[0].i1, st[0].amplitude, st[0].durationMs, st[0].speed], [0, 1, 100, 100, 1000]);
  assert.deepEqual(E.strokes([]), []);
});

test('point basics', () => {
  eq(E.setPointAt(B, null, { at: 150, pos: 50 }), [0, 0], [100, 100], [150, 50], [200, 0], [300, 100], [400, 0]);
  eq(E.setPointAt(B, null, { at: 105, pos: 7, tolerance: 10 }), [0, 0], [105, 7], [200, 0], [300, 100], [400, 0]);
  eq(E.setPointAt(B, null, { at: 100, pos: 7 }), [0, 0], [100, 7], [200, 0], [300, 100], [400, 0]);
  eq(E.setPointAt([], null, { at: 10, pos: 120 }), [10, 100]);
  eq(E.setPointAt(B, null, { at: 1000, pos: 3 }), [0, 0], [100, 100], [200, 0], [300, 100], [400, 0], [1000, 3]);
  eq(E.setPointAt(B, null, { at: 98, pos: 3, frameMs: 40 }), [0, 0], [80, 3], [100, 100], [200, 0], [300, 100], [400, 0]);
  assert.deepEqual(E.numberKey(B, null, { key: 3, at: 100 }).script[1], { at: 100, pos: 30 });
  assert.equal(E.numberKey(B, null, { key: 10, at: 150 }).script[2].pos, 100);
  assert.equal(E.numberKey(B, null, { key: 0, at: 150 }).script[2].pos, 0);
  eq(E.deletePoints(B, ats(100, 300)), [0, 0], [200, 0], [400, 0]);
  assert.deepEqual(E.deletePoints(B, ats(100, 300)).ats, []);
  eq(E.movePoints(B, ats(200), { dt: 150 }), [0, 0], [100, 100], [300, 100], [350, 0], [400, 0]);
  eq(E.movePoints(B, ats(200), { dt: 150, collide: 'clamp' }), [0, 0], [100, 100], [299, 0], [300, 100], [400, 0]);
  eq(E.movePoints(B, ats(200), { dt: -150, collide: 'clamp' }), [0, 0], [100, 100], [101, 0], [300, 100], [400, 0]);
  eq(E.movePoints(B, ats(100), { dt: 100 }), [0, 0], [200, 100], [300, 100], [400, 0]); // moved wins
  eq(E.movePoints(B, ats(0), { dpos: 30 }), [0, 30], [100, 100], [200, 0], [300, 100], [400, 0]);
  eq(E.movePoints(B, ats(100), { dpos: 30 }), [0, 0], [100, 100], [200, 0], [300, 100], [400, 0]);
  const m = E.movePoints(B, ats(100), { dt: 33, frameMs: 40 });
  assert.deepEqual(m.ats, [120]); // 133 -> 3.325 frames -> 3 -> 120
  eq(E.nudgeTime(B, ats(100), { frames: 1, frameMs: 40 }), [0, 0], [140, 100], [200, 0], [300, 100], [400, 0]);
  eq(E.nudgeTime(B, ats(100), { frames: -3, frameMs: 40 }), [0, 0], [1, 100], [200, 0], [300, 100], [400, 0]); // clamped
  eq(E.nudgePos(B, ats(0, 200), { amount: 5 }), [0, 5], [100, 100], [200, 5], [300, 100], [400, 0]);
  eq(E.setPos(B, ats(100), { pos: 33 }), [0, 0], [100, 33], [200, 0], [300, 100], [400, 0]);
  eq(E.setTime(B, ats(100, 200), { at: 150 }), [0, 0], [150, 100], [250, 0], [300, 100], [400, 0]);
});

test('amplitude', () => {
  const pos = (r) => r.script.map((a) => a.pos);
  assert.deepEqual(pos(E.scale(B, null, { factor: 0.5 })), [25, 75, 25, 75, 25]);
  assert.deepEqual(pos(E.scale(B, null, { factor: 0.5, pivot: 'top' })), [50, 100, 50, 100, 50]);
  assert.deepEqual(pos(E.scale(B, null, { factor: 0.5, pivot: 'bottom' })), [0, 50, 0, 50, 0]);
  assert.deepEqual(pos(E.scale(B, null, { factor: 2, pivot: 'mean' })), [0, 100, 0, 100, 0]);
  assert.deepEqual(pos(E.scale(B, null, { factor: 0.5, pivot: 'custom', value: 20 })), [10, 60, 10, 60, 10]);
  assert.deepEqual(pos(E.scale(B, null, { factor: 0.5, pivot: 'mid' })), [25, 75, 25, 75, 25]);
  assert.deepEqual(pos(E.scale(B, ats(100), { factor: 0.5 })), [0, 75, 0, 100, 0]);
  assert.deepEqual(pos(E.offset(B, null, { amount: 30 })), [30, 100, 30, 100, 30]);
  assert.deepEqual(pos(E.invert(B, null)), [100, 0, 100, 0, 100]);
  assert.deepEqual(pos(E.remapRange(B, null, { lo: 20, hi: 80 })), [20, 80, 20, 80, 20]);
  assert.deepEqual(pos(E.remapRange(B, ats(0, 200), { lo: 20, hi: 80 })).slice(0, 3), [50, 100, 50]);
  const ramp = S(...Array.from({ length: 11 }, (_, i) => [i * 100, i * 10]));
  assert.deepEqual(pos(E.remapRange(ramp, null, { lo: 0, hi: 100, trim: 10 })).slice(0, 4), [0, 0, 13, 25]);
  assert.deepEqual(pos(E.limitRange(B, null, { lo: 20, hi: 80 })), [20, 80, 20, 80, 20]);
  assert.deepEqual(pos(E.limitRange(S([0, 25], [10, 100]), null, { lo: 20, hi: 80, mode: 'compress' })), [35, 80]);
  assert.deepEqual(pos(E.normalise(S([0, 20], [1, 60], [2, 40]), null)), [0, 100, 50]);
  assert.deepEqual(pos(E.envelope(S([0, 100], [100, 100], [200, 100]), null, { from: 1, to: 0 })), [100, 75, 50]);
  assert.deepEqual(pos(E.envelope(S([0, 100], [100, 100], [200, 100]), null, { curve: 'custom', points: [[0, 1], [0.5, 1], [1, 0]] })), [100, 100, 50]);
  const T = S([0, 0], [100, 90], [200, 10], [300, 80], [400, 0]);
  assert.deepEqual(pos(E.alignExtremes(T, null, { which: 'tops', to: 'mean' })), [0, 85, 10, 85, 0]);
  assert.deepEqual(pos(E.alignExtremes(T, null, { which: 'tops', topValue: 100 })), [0, 100, 10, 100, 0]);
  assert.deepEqual(pos(E.alignExtremes(T, null, { which: 'bottoms', bottomValue: 0 })), [0, 90, 0, 80, 0]);
  assert.deepEqual(pos(E.alignExtremes(T, null, { which: 'tops', topValue: 100, strength: 0.5 })), [0, 95, 10, 90, 0]);
  assert.deepEqual(pos(E.extremes(T, null, { amount: 5 })), [0, 95, 5, 85, 0]);
  assert.deepEqual(pos(E.extremes(T, null, { amount: 50, relative: true })), [0, 95, 5, 90, 0]);
  assert.deepEqual(pos(E.extremes(T, null, { amount: -5 })), [5, 85, 15, 75, 5]);
});

test('time', () => {
  eq(E.shift(B, null, { dt: 50 }), [50, 0], [150, 100], [250, 0], [350, 100], [450, 0]);
  eq(E.shift(B, null, { dt: -150 }), [0, 100], [50, 0], [150, 100], [250, 0]); // pile-up at 0: later wins
  eq(E.shift(B, ats(300), { dt: -150, collide: 'clamp' }), [0, 0], [100, 100], [200, 0], [201, 100], [400, 0]);
  eq(E.stretch(B, null, { factor: 2 }), [0, 0], [200, 100], [400, 0], [600, 100], [800, 0]);
  eq(E.stretch(B, ats(100, 200, 300), { factor: 2, anchor: 'center' }), [0, 100], [200, 0], [400, 100]);
  eq(E.stretch(B, ats(200, 300), { factor: 2, anchor: 'playhead', at: 100 }), [0, 0], [100, 100], [300, 0], [400, 0], [500, 100]);
  eq(E.fitDuration(B, ats(100, 300), { duration: 400 }), [0, 0], [100, 100], [200, 0], [400, 0], [500, 100]);
  eq(E.fitToRange(B, ats(100, 300), { t0: 1000, t1: 2000 }), [0, 0], [200, 0], [400, 0], [1000, 100], [2000, 100]);
  eq(E.reverse(S([0, 10], [100, 20], [300, 90]), null), [0, 90], [200, 20], [300, 10]);
  eq(E.reverse(S([0, 10], [100, 20], [300, 90], [500, 5]), { t0: 100, t1: 300 }), [0, 10], [100, 90], [300, 20], [500, 5]);
  eq(E.rippleInsert(B, null, { at: 100, duration: 1000 }), [0, 0], [1100, 100], [1200, 0], [1300, 100], [1400, 0]);
  eq(E.rippleDelete(B, null, { t0: 100, t1: 200 }), [0, 0], [200, 100], [300, 0]);
  eq(E.rippleDelete(B, { t0: 100, t1: 200 }), [0, 0], [200, 100], [300, 0]);
  const Q = S([0, 0], [17, 50], [63, 70], [85, 30]);
  eq(E.quantize(Q, null, { frameMs: 40 }), [0, 50], [80, 30]);
  eq(E.quantize(Q, null, { times: [0, 100, 250] }), [0, 50], [100, 30]);
  eq(E.snapToTimes(Q, null, { times: [0, 100], tolerance: 20 }), [0, 50], [63, 70], [100, 30]);
  eq(E.equaliseSpacing(S([0, 0], [10, 50], [400, 60], [500, 10]), null), [0, 0], [167, 50], [333, 60], [500, 10]);
});

test('density', () => {
  eq(E.simplify(S([0, 0], [100, 50], [200, 100]), null, { tolerance: 0 }), [0, 0], [200, 100]);
  eq(E.simplify(S([0, 0], [100, 60], [200, 100]), null, { tolerance: 5 }), [0, 0], [100, 60], [200, 100]);
  eq(E.simplify(S([0, 0], [100, 60], [200, 100]), null, { tolerance: 10 }), [0, 0], [200, 100]);
  const K = S([0, 0], [100, 10], [200, 5], [300, 100]);
  eq(E.simplify(K, null, { tolerance: 50 }), [0, 0], [200, 5], [300, 100]);
  eq(E.simplify(K, null, { tolerance: 50, keepTurns: true }), [0, 0], [100, 10], [200, 5], [300, 100]);
  eq(E.simplify(K, ats(100, 200), { tolerance: 50 }), [0, 0], [100, 10], [200, 5], [300, 100]); // 2-point run: nothing to drop
  eq(E.thinMinGap(S([0, 0], [30, 50], [60, 100], [100, 0]), null, { minGapMs: 50 }), [0, 0], [60, 100]);
  eq(E.thinMinGap(S([0, 0], [100, 50], [120, 90], [300, 0]), null, { minGapMs: 50, keep: 'extreme' }), [0, 0], [120, 90], [300, 0]);
  eq(E.keepExtremes(S([0, 0], [50, 30], [100, 100], [150, 60], [200, 0]), null), [0, 0], [100, 100], [200, 0]);
  eq(E.keepExtremes(S([0, 0], [50, 30], [100, 100], [150, 60], [200, 0]), ats(50, 100, 150), { keepEnds: false }), [0, 0], [100, 100], [200, 0]);
  eq(E.keepExtremes(S([0, 0], [50, 30], [100, 100], [150, 60], [200, 0]), ats(50, 100, 150), { keepEnds: true }), [0, 0], [50, 30], [100, 100], [150, 60], [200, 0]);
  eq(E.removeMicroReversals(S([0, 0], [100, 50], [200, 48], [300, 100], [400, 0]), null, { threshold: 5 }), [0, 0], [300, 100], [400, 0]);
  const mid = E.addMidpoints(S([0, 0], [100, 100]), null, { count: 3 });
  eq(mid, [0, 0], [25, 25], [50, 50], [75, 75], [100, 100]);
  assert.deepEqual(mid.ats, [0, 25, 50, 75, 100]);
  eq(E.addMidpoints(S([0, 0], [2, 100]), null, { count: 5 }), [0, 0], [1, 50], [2, 100]);
  eq(E.addMidpoints(S([0, 0], [100, 100], [200, 0]), ats(0, 100), { count: 1 }), [0, 0], [50, 50], [100, 100], [200, 0]);
  eq(E.subdivide(S([0, 0], [100, 100]), null, { steps: 1, shape: 'sine' }), [0, 0], [50, 50], [100, 100]);
  eq(E.subdivide(S([0, 0], [100, 100]), null, { steps: 3, shape: 'sine' }), [0, 0], [25, 15], [50, 50], [75, 85], [100, 100]);
  eq(E.subdivide(S([0, 0], [100, 100]), null, { steps: 1, shape: 'twoSpeed', ratio: 3 }), [0, 0], [50, 75], [100, 100]);
  eq(E.subdivide(S([0, 0], [100, 100]), null, { stepMs: 25, shape: 'linear' }), [0, 0], [25, 25], [50, 50], [75, 75], [100, 100]);
  const sp = S([0, 50], [100, 50], [200, 100], [300, 50], [400, 50]);
  eq(E.smooth(sp, null, { window: 200, step: 100 }), [0, 50], [100, 67], [200, 67], [300, 67], [400, 50]);
  const ramp = S(...Array.from({ length: 11 }, (_, i) => [i * 100, i * 10]));
  assert.deepEqual(E.smooth(ramp, null, { method: 'savgol', window: 500, step: 100 }).script, ramp);
  assert.deepEqual(E.smooth(ramp, null, { method: 'savgol', window: 500, step: 100, refit: 'simplify', tolerance: 1 }).script, S([0, 0], [1000, 100]));
  const w = E.savgolWeights(5, 2, 0);
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9 && Math.abs(w[0] - -3 / 35) < 1e-9 && Math.abs(w[2] - 17 / 35) < 1e-9);
});

test('speed', () => {
  const Z = S([0, 0], [100, 100], [200, 0]);
  eq(E.capSpeed(Z, null, { maxSpeed: 100 }), [0, 0], [100, 10], [200, 0]);
  eq(E.capSpeed(Z, null, { maxSpeed: 100, method: 'retime' }), [0, 0], [1000, 100], [2000, 0]);
  eq(E.capSpeed(Z, ats(100), { maxSpeed: 100, method: 'retime', ripple: true }), [0, 0], [1000, 100], [1100, 0]);
  eq(E.capSpeed(Z, ats(100), { maxSpeed: 100, method: 'retime' }), [0, 0], [200, 0], [1000, 100]);
  eq(E.capSpeed(Z, null, { maxSpeed: 5000 }), [0, 0], [100, 100], [200, 0]);
  const C = S([0, 0], [10, 50], [20, 100], [200, 0]);
  eq(E.enforceMinSpacing(C, null, { minGapMs: 50 }), [0, 0], [50, 50], [100, 100], [200, 0]);
  eq(E.enforceMinSpacing(C, null, { minGapMs: 50, method: 'drop' }), [0, 0], [200, 0]);
});

const cyc = S([0, 0], [250, 100], [500, 0], [750, 100], [1000, 0], [1250, 100], [1500, 0], [1750, 100], [2000, 0]);
test('rhythm', () => {
  const half = E.halfTime(cyc, null);
  eq(half, [0, 0], [500, 100], [1000, 0], [1500, 100], [2000, 0]);
  assert.deepEqual(E.doubleTime(half.script, null).script, cyc);
  eq(E.halfTime(cyc, null, { keep: 'last' }), [0, 0], [500, 100], [1000, 0], [1500, 100], [2000, 0]);
  eq(E.changeStrokeRate(S([0, 0], [500, 100], [1000, 0]), null, { factor: 2 }), [0, 0], [250, 100], [500, 0], [750, 100], [1000, 0]);
  eq(E.changeStrokeRate(S([0, 0], [500, 100], [1000, 0], [1200, 50]), ats(0, 500, 1000), { factor: 2, fill: 'ripple' }), [0, 0], [250, 100], [500, 0], [700, 50]);
  eq(E.changeStrokeRate(S([0, 0], [500, 100], [1000, 0]), null, { factor: 0.5 }), [0, 0], [1000, 100]); // slower: cut at old end (interpolated)
  const R = S([0, 0], [500, 100], [1000, 0]);
  eq(E.repeatLastStroke(R, null, { at: 1500 }), [0, 0], [500, 100], [1000, 0], [1500, 0], [2000, 100], [2500, 0]);
  eq(E.repeatLastStroke(R, null, { at: 1500, shape: 'stroke' }), [0, 0], [500, 100], [1000, 0], [1500, 100], [2000, 0]);
  eq(E.repeatLastStroke(S([0, 0], [100, 100]), null, { at: 200 }), [0, 0], [100, 100]);
  eq(E.repeatLastStroke(R, null, { at: 1000, count: 2 }), [0, 0], [500, 100], [1000, 0], [1500, 100], [2000, 0], [2500, 100], [3000, 0]);
  // holds are not part of the stroke: trailing hold (endpoint turn) and a plateau at the cycle start are skipped
  assert.deepEqual(E.repeatLastStroke(S([0, 10], [400, 90], [800, 10], [2000, 10]), null, { at: 3000 }).ats, [3000, 3400, 3800]);
  assert.deepEqual(E.repeatLastStroke(S([0, 90], [400, 10], [1000, 10], [1400, 90], [1800, 10]), null, { at: 2000 }).ats, [2000, 2400, 2800]);
  let H = S([0, 10], [400, 90], [800, 10], [1200, 90], [1600, 10], [1800, 10]), qa = 2000; // repeated Q keeps the 400 ms tempo
  for (let k = 0; k < 3; k++) { const r = E.repeatLastStroke(H, null, { at: qa }); H = r.script; assert.deepEqual(r.ats, [qa, qa + 400, qa + 800]); qa += 800; }
  const Z = S([0, 0], [100, 100], [200, 0]);
  eq(E.repeatSelection(Z, null, { count: 1 }), [0, 0], [100, 100], [200, 0], [300, 100], [400, 0]);
  eq(E.repeatSelection(Z, null, { until: 500 }), [0, 0], [100, 100], [200, 0], [300, 100], [400, 0], [500, 100]);
  eq(E.repeatSelection(Z, null, { until: 450 }), [0, 0], [100, 100], [200, 0], [300, 100], [400, 0], [450, 50]);
  const Y = S([0, 0], [100, 100], [200, 20]);
  eq(E.repeatSelection(Y, null, { count: 1, seam: 'mean' }), [0, 0], [100, 100], [200, 10], [300, 100], [400, 20]);
  eq(E.repeatSelection(Y, null, { count: 1, seam: 'prev' }), [0, 0], [100, 100], [200, 20], [300, 100], [400, 20]);
  eq(E.repeatSelection(Z, null, { count: 1, period: 300 }), [0, 0], [100, 100], [200, 0], [300, 0], [400, 100], [500, 0]);
  const withExtra = S([0, 0], [100, 100], [200, 0], [350, 77], [1000, 50]);
  eq(E.repeatSelection(withExtra, ats(0, 100, 200), { count: 1 }), [0, 0], [100, 100], [200, 0], [300, 100], [400, 0], [1000, 50]);
  eq(E.repeatSelection(withExtra, ats(0, 100, 200), { count: 1, mode: 'merge' }), [0, 0], [100, 100], [200, 0], [300, 100], [350, 77], [400, 0], [1000, 50]);
  eq(E.repeatSelection(withExtra, ats(0, 100, 200), { count: 1, mode: 'insert' }), [0, 0], [100, 100], [200, 0], [300, 100], [400, 0], [550, 77], [1200, 50]);
});

test('clipboard', () => {
  const snip = E.copy(B, { t0: 100, t1: 300 });
  assert.deepEqual(snip, { origin: 100, duration: 200, actions: S([0, 100], [100, 0], [200, 100]) });
  eq(E.paste(B, snip, 1000, { mode: 'merge' }), [0, 0], [100, 100], [200, 0], [300, 100], [400, 0], [1000, 100], [1100, 0], [1200, 100]);
  eq(E.paste(B, snip, 150, { mode: 'insert' }), [0, 0], [100, 100], [150, 100], [250, 0], [350, 100], [400, 0], [500, 100], [600, 0]);
  eq(E.paste(B, snip, 100), [0, 0], [100, 100], [200, 0], [300, 100], [400, 0]); // replace in place
  eq(E.paste(B, snip, 250), [0, 0], [100, 100], [200, 0], [250, 100], [350, 0], [450, 100]);
  const c = E.cut(B, ats(100, 200));
  eq(c, [0, 0], [300, 100], [400, 0]);
  assert.deepEqual(c.snippet, { origin: 100, duration: 100, actions: S([0, 100], [100, 0]) });
  eq(E.cut(B, { t0: 100, t1: 200 }, { ripple: true }), [0, 0], [200, 100], [300, 0]);
  eq(E.pasteScaled(B, snip, { t0: 1000, t1: 1400, mode: 'merge' }), [0, 0], [100, 100], [200, 0], [300, 100], [400, 0], [1000, 100], [1200, 0], [1400, 100]);
  const d = E.duplicate(S([0, 0], [100, 100], [200, 0]), null, { count: 1 });
  eq(d, [0, 0], [100, 100], [200, 0], [300, 0], [400, 100], [500, 0]);
  assert.deepEqual(d.ats, [300, 400, 500]);
  const f = E.patternFill(S([0, 0], [100, 100], [200, 0], [5000, 5]), { t0: 400, t1: 1000 }, { source: { t0: 0, t1: 200 } });
  eq(f, [0, 0], [100, 100], [200, 0], [400, 0], [500, 100], [600, 0], [700, 100], [800, 0], [900, 100], [1000, 0], [5000, 5]);
  assert.deepEqual(E.copy([], null), { origin: 0, duration: 0, actions: [] });
});

test('variation', () => {
  const a = E.jitter(B, null, { timeMs: 30, amp: 10, seed: 7 }), b = E.jitter(B, null, { timeMs: 30, amp: 10, seed: 7 }), c = E.jitter(B, null, { timeMs: 30, amp: 10, seed: 8 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.script, c.script);
  a.script.forEach((x, i) => { assert.ok(Math.abs(x.pos - B[i].pos) <= 10 && Math.abs(x.at - B[i].at) <= 30); });
  assert.deepEqual(E.jitter(B, null, { seed: 3 }).script, B);
  // selection independence: the same action jitters the same way whatever else is selected
  const one = E.jitter(B, ats(200), { timeMs: 30, amp: 10, seed: 7 }).script[2], all = a.script[2];
  assert.deepEqual(one, all);
  assert.deepEqual(E.jitter(B, null, { timeMs: 30, keepEnds: true, seed: 7 }).script.map((x) => x.at).filter((_, i) => i === 0 || i === 4), [0, 400]);
  const h = E.humanise(B, null, { preset: 'loose', seed: 2 });
  assert.ok(isValid(h.script) && h.script.length === 5);
  assert.deepEqual(E.humanise(B, null, { seed: 2 }), E.humanise(B, null, { seed: 2 }));
});

test('selection helpers', () => {
  const at = (r) => r.ats;
  assert.deepEqual(at(E.selectRange(B, null, { t0: 100, t1: 300 })), [100, 200, 300]);
  assert.deepEqual(at(E.selectChapter(B, null, { t0: 150, t1: 250 })), [200]);
  assert.deepEqual(at(E.selectAll(B)), [0, 100, 200, 300, 400]);
  assert.deepEqual(at(E.selectTurns(B, null, { which: 'tops' })), [100, 300]);
  assert.deepEqual(at(E.selectTurns(B, null, { which: 'bottoms' })), [0, 200, 400]);
  assert.deepEqual(at(E.selectTurns(B, ats(0, 100), { which: 'both' })), [0, 100]);
  assert.deepEqual(at(E.grow(B, ats(200), { side: 'after' })), [200, 300]);
  assert.deepEqual(at(E.grow(B, ats(200), { count: 2 })), [0, 100, 200, 300, 400]);
  assert.deepEqual(at(E.grow(B, ats(0), { side: 'before' })), [0]);
  assert.deepEqual(at(E.shrink(B, ats(100, 200, 300))), [200]);
  assert.deepEqual(at(E.shrink(B, ats(100, 200, 300), { side: 'after' })), [100, 200]);
  assert.deepEqual(at(E.shrink(B, ats(100), { count: 5 })), []);
  assert.deepEqual(at(E.everyNth(B, null, { n: 2 })), [0, 200, 400]);
  assert.deepEqual(at(E.everyNth(B, null, { n: 2, offset: 1 })), [100, 300]);
  assert.deepEqual(at(E.selectBySpeed(B, null, { above: 500 })), [0, 100, 200, 300, 400]);
  assert.deepEqual(at(E.selectBySpeed(B, null, { above: 2000 })), []);
  assert.deepEqual(at(E.selectBySpeed(B, null, { below: 500 })), []);
  const M = S([0, 0], [100, 100], [200, 0], [300, 100], [400, 0], [1400, 50]);
  assert.deepEqual(at(E.selectSimilar(M, ats(0, 100))), [0, 100, 200, 300]);
  assert.deepEqual(at(E.invertSelection(B, ats(100))), [0, 200, 300, 400]);
  assert.deepEqual(at(E.invertSelection(B, ats(100), { t0: 0, t1: 200 })), [0, 200]);
  assert.equal(E.grow(B, ats(200)).script, B);
});

test('edge cases: empty, single, ends, zero-length, bounds', () => {
  const one = S([500, 50]);
  for (const o of E.OPS) {
    for (const s of [[], one]) {
      const r = o.apply(s, null, { at: 100 });
      assert.ok(isValid(r.script), `${o.id} on ${s.length}`);
      const r2 = o.apply(s, { ats: [123456] }, {});
      assert.ok(isValid(r2.script), `${o.id} stray ats`);
    }
  }
  // selection not in script is a no-op
  assert.equal(E.invert(B, ats(12345)).script.length, 5);
  assert.deepEqual(E.invert(B, ats(12345)).script, B);
  assert.deepEqual(E.invert(B, ats(12345)).ats, []);
  // zero-length range selects the point at that time
  assert.deepEqual(E.invert(B, { t0: 100, t1: 100 }).ats, [100]);
  assert.deepEqual(E.invert(B, { t0: 150, t1: 150 }).ats, []);
  assert.deepEqual(E.invert(B, { t0: 300, t1: 100 }).ats, [100, 200, 300]); // reversed range tolerated
  assert.deepEqual(E.invert(B, { ats: new Set([100]) }).ats, [100]); // Set accepted
  // first and last point
  eq(E.shift(B, ats(0), { dt: 50 }), [50, 0], [100, 100], [200, 0], [300, 100], [400, 0]);
  eq(E.shift(B, ats(400), { dt: 50, collide: 'clamp' }), [0, 0], [100, 100], [200, 0], [300, 100], [450, 0]);
  eq(E.shift(B, ats(0), { dt: -50, collide: 'clamp' }), [0, 0], [100, 100], [200, 0], [300, 100], [400, 0]);
  // pos 0 / 100 limits
  assert.deepEqual(E.offset(S([0, 0], [10, 100]), null, { amount: -5 }).script.map((a) => a.pos), [0, 95]);
  assert.deepEqual(E.scale(S([0, 0], [10, 100]), null, { factor: 5 }).script.map((a) => a.pos), [0, 100]);
  assert.deepEqual(E.invert(S([0, 0], [10, 100]), null).script.map((a) => a.pos), [100, 0]);
  // stretch of a zero-span selection and fit of a single point
  eq(E.fitDuration(one, null, { duration: 100 }), [500, 50]);
  eq(E.remapRange(one, null, { lo: 0, hi: 100 }), [500, 50]);
  // paste at negative / NaN
  eq(E.paste(B, E.copy(B, ats(100)), NaN), [0, 0], [100, 100], [200, 0], [300, 100], [400, 0]);
  // catalogue sanity
  assert.ok(E.OPS.length >= 45);
  assert.equal(new Set(E.OPS.map((o) => o.id)).size, E.OPS.length);
  for (const o of E.OPS) {
    assert.ok(o.title && o.group && Array.isArray(o.params) && typeof o.apply === 'function', o.id);
    for (const p of o.params) {
      assert.ok(['number', 'bool', 'choice'].includes(p.type) && p.key && p.label && 'default' in p, `${o.id}.${p.key}`);
      if (p.type === 'choice') assert.ok(p.choices.includes(p.default), `${o.id}.${p.key} default in choices`);
      if (p.type === 'number') assert.ok(p.default >= p.min && p.default <= p.max, `${o.id}.${p.key} default in range`);
    }
  }
  assert.throws(() => E.runOp('nope', B, null));
  assert.deepEqual(E.runOp('invert', B, null).script.map((a) => a.pos), [100, 0, 100, 0, 100]);
});
