// Depth handles (features/lanes/depth.js) + the rescale they drive (lib/edit/amplitude.js remapRange).
import assert from 'node:assert/strict';
import test from 'node:test';
import { depthOf, depthTarget, hitDepth, DEPTH_MIN } from '../src/features/lanes/depth.js';
import { posToY } from '../src/features/lanes/geom.js';
import { remapRange } from '../src/lib/edit/amplitude.js';

const S = [{ at: 0, pos: 50 }, { at: 100, pos: 20 }, { at: 200, pos: 80 }, { at: 300, pos: 35 }, { at: 400, pos: 70 }, { at: 500, pos: 10 }];
const idx = [1, 2, 3, 4], ats = idx.map((i) => S[i].at);
const d = depthOf(S, idx);
const apply = (which, pos, mode) => { const t = depthTarget(d, which, pos, mode); return { t, s: remapRange(S, { ats }, { ...t, srcLo: d.min, srcHi: d.max }).script }; };
const sel = (s) => idx.map((i) => s[i].pos);

test('depthOf: min/max, span, guards', () => {
  assert.deepEqual(d, { min: 20, max: 80, t0: 100, t1: 400 });
  assert.deepEqual(depthOf(S, idx, { t0: 50, t1: 450 }), { min: 20, max: 80, t0: 50, t1: 450 }, 'the range holding the selection is the span');
  assert.deepEqual(depthOf(S, idx, { t0: 150, t1: 450 }), d, 'a range not holding it is ignored');
  assert.equal(DEPTH_MIN, 3);
  assert.equal(depthOf(S, [1, 2]), null, 'fewer than 3 points');
  assert.equal(depthOf([{ at: 0, pos: 40 }, { at: 1, pos: 40 }, { at: 2, pos: 40 }], [0, 1, 2]), null, 'flat');
});

test('top handle: max moves, min fixed, shape kept, integers', () => {
  const { t, s } = apply('top', 60.4, 'scale');
  assert.deepEqual(t, { lo: 20, hi: 60 });
  assert.deepEqual(sel(s), [20, 60, 30, 53]);   // 20 + (p - 20) * 40 / 60, rounded
  assert.equal(s[0].pos, 50); assert.equal(s[5].pos, 10, 'unselected points stay');
  assert.ok(s.every((a, i) => a.at === S[i].at), 'times never change');
});

test('bottom handle: min moves, max fixed', () => {
  const { t, s } = apply('bottom', 50, 'scale');
  assert.deepEqual(t, { lo: 50, hi: 80 });
  assert.deepEqual(sel(s), [50, 80, 58, 75]);
});

test('Shift: offset, range kept, clamped at the edge', () => {
  assert.deepEqual(apply('top', 90, 'move').t, { lo: 30, hi: 90 });
  assert.deepEqual(sel(apply('top', 90, 'move').s), [30, 90, 45, 80]);
  assert.deepEqual(apply('bottom', 5, 'move').t, { lo: 5, hi: 65 });
  assert.deepEqual(apply('top', 140, 'move').t, { lo: 40, hi: 100 }, 'stops when the top reaches 100');
  assert.deepEqual(apply('bottom', -30, 'move').t, { lo: 0, hi: 60 });
});

test('Alt: symmetric about the centre', () => {
  assert.deepEqual(apply('top', 90, 'sym').t, { lo: 10, hi: 90 });
  assert.deepEqual(apply('bottom', 40, 'sym').t, { lo: 40, hi: 60 });
  assert.deepEqual(apply('top', 120, 'sym').t, { lo: 0, hi: 100 }, 'clamped so both ends stay in 0..100');
  const odd = { min: 20, max: 81 };
  for (const p of [0, 30, 50, 51, 70, 100]) { const r = depthTarget(odd, 'top', p, 'sym'); assert.equal(r.lo + r.hi, 101); assert.ok(r.hi > r.lo); }
});

test('clamping and no crossing', () => {
  assert.deepEqual(depthTarget(d, 'top', 150), { lo: 20, hi: 100 });
  assert.deepEqual(depthTarget(d, 'top', 0), { lo: 20, hi: 21 }, 'top never goes below the bottom');
  assert.deepEqual(depthTarget(d, 'bottom', -9), { lo: 0, hi: 80 });
  assert.deepEqual(depthTarget(d, 'bottom', 99), { lo: 79, hi: 80 });
  const all = apply('top', 100, 'scale').s;
  assert.ok(all.every((a) => Number.isInteger(a.pos) && a.pos >= 0 && a.pos <= 100));
});

test('identity when unchanged', () => {
  const { t, s } = apply('top', 80, 'scale');
  assert.deepEqual(t, { lo: 20, hi: 80 });
  assert.deepEqual(s, S);
});

test('hit test: grip tab and bar', () => {
  const view = { start: 0, span: 1000 }, W = 1000, H = 120;
  assert.deepEqual(hitDepth(d, view, W, H, 250, posToY(H, 80)), { which: 'top', grip: false });
  assert.deepEqual(hitDepth(d, view, W, H, 250, posToY(H, 20) + 3), { which: 'bottom', grip: false });
  assert.deepEqual(hitDepth(d, view, W, H, 85, posToY(H, 80)), { which: 'top', grip: true }, 'tab left of the span');
  assert.equal(hitDepth(d, view, W, H, 250, posToY(H, 50)), null);
  assert.equal(hitDepth(d, view, W, H, 600, posToY(H, 80)), null, 'outside the span');
  assert.equal(hitDepth(null, view, W, H, 0, 0), null);
});
