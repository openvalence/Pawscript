// paw-5zpf stage 2: the pivot and S / R on the lane's points (src/features/lanes/pivot.js) and the modal state machine's new parts
// (src/lib/xform.js: S on two axes with X / Y locks, the first move or a middle drag picking the lock, R's amounts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pivots, levelAt, timeFactorLimits, scalePoints, rotatePoints, farOf } from '../src/features/lanes/pivot.js';
import { begin, key, amounts, hint, lockFrom } from '../src/lib/xform.js';

const S = (...pp) => pp.map(([at, pos]) => ({ at, pos }));
// 0: 0/20, 1: 1000/80, 2: 2000/20, 3: 3000/80, 4: 4000/20, 5: 5000/80
const s = S([0, 20], [1000, 80], [2000, 20], [3000, 80], [4000, 20], [5000, 80]);
const feed = (m, ...keys) => { for (const k of keys) m = key(m, k).m; return m; };

test('pivots: start / middle / end / playhead / active / individual', () => {
  const idx = [1, 2, 3];
  assert.deepEqual(pivots(s, idx, 'start')[0], { idx, t: 1000, pos: 80 });
  assert.deepEqual(pivots(s, idx, 'end')[0], { idx, t: 3000, pos: 80 });
  assert.deepEqual(pivots(s, idx, 'middle')[0], { idx, t: 2000, pos: 50 });
  assert.deepEqual(pivots(s, idx, 'playhead', { playhead: 1500 })[0], { idx, t: 1500, pos: 50 }, 'the line\'s level at the playhead');
  assert.deepEqual(pivots(s, idx, 'active', { active: [2, 3] })[0], { idx, t: 2500, pos: 50 });
  assert.deepEqual(pivots(s, idx, 'active')[0], pivots(s, idx, 'middle')[0], 'no active element: the middle');
  assert.deepEqual(pivots(s, [0, 1, 3, 4], 'individual'), [{ idx: [0, 1], t: 500, pos: 50 }, { idx: [3, 4], t: 3500, pos: 50 }], 'one per island');
  assert.equal(levelAt(s, 6000), 80);
  assert.equal(levelAt(s, -5), 20);
});

test('S both axes about the middle; X locks time (S X 2 doubles the duration); Y locks level (S Y .5 halves the height)', () => {
  const idx = [1, 2, 3], g = pivots(s, idx, 'middle');
  const lvl = scalePoints(s, g, { fx: 1, fy: 0.5 });
  assert.deepEqual(lvl.script.slice(1, 4), S([1000, 65], [2000, 35], [3000, 65]));
  assert.deepEqual(lvl.clamped, []);
  // time x2 about 2000 would put 1000 -> 0 and 3000 -> 4000: limited by the neighbours (0 + 1, 4000 - 1)
  const lim = timeFactorLimits(s, g);
  assert.ok(lim[1] < 2 && lim[1] > 1.99, `limited just under 2 (${lim})`);
  const wide = S([0, 0], [1000, 80], [2000, 20], [3000, 80], [9000, 0]);
  const t2 = scalePoints(wide, pivots(wide, idx, 'middle'), { fx: 2, fy: 1 });
  assert.deepEqual(t2.script.map((p) => p.at), [0, 1, 2000, 3999, 9000], 'the start held 1 ms after its neighbour; one factor for all');
  assert.equal(t2.fx, 1999 / 1000, 'the factor actually used');
  // amounts from the state machine: S X 2 / S Y .5
  assert.deepEqual(amounts(feed(begin('scale', { axes: 'xy' }), 'X', '2')), { f: 2, fx: 2, fy: 1 });
  assert.deepEqual(amounts(feed(begin('scale', { axes: 'xy' }), 'Y', '.', '5')), { f: 0.5, fx: 1, fy: 0.5 });
  assert.deepEqual(amounts(feed(begin('scale', { axes: 'xy' }), '2')), { f: 2, fx: 2, fy: 2 }, 'a typed factor with no lock: both (Blender)');
  assert.deepEqual(amounts({ ...begin('scale'), mouse: { f: 0.5 } }), { f: 0.5 }, 'the old level-only scale (timeline rows) unchanged');
});

test('S about the start / end: that point stays; a level past 0 / 100 is clamped and counted, never silently', () => {
  const idx = [1, 2, 3];
  const st = scalePoints(s, pivots(s, idx, 'start'), { fx: 1, fy: 2 });
  assert.deepEqual(st.script[1], { at: 1000, pos: 80 });
  assert.deepEqual(st.script[2], { at: 2000, pos: 0 }, '80 + (20 - 80) * 2 = -40 -> 0');
  assert.deepEqual(st.clamped, [2]);
  const en = scalePoints(s, pivots(s, idx, 'end'), { fx: 0.5, fy: 1 });
  assert.deepEqual(en.script.slice(1, 4).map((p) => p.at), [2000, 2500, 3000], 'about the end: it stays, the rest closes in');
});

test('S with Individual origins: each island about its own middle; the time limit holds for every island', () => {
  const r = scalePoints(s, pivots(s, [0, 1, 3, 4], 'individual'), { fx: 0.5, fy: 0.5 });
  assert.deepEqual(r.script.map((p) => [p.at, p.pos]), [[250, 35], [750, 65], [2000, 20], [3250, 65], [3750, 35], [5000, 80]]);
  assert.deepEqual(r.idx, [0, 1, 3, 4]);
});

test('R: time stays; levels tilt in proportion to their time from the pivot; the far end changes by the typed value', () => {
  const idx = [1, 2, 3];
  const a = rotatePoints(s, pivots(s, idx, 'start'), { d: 10 });
  assert.deepEqual(a.script.slice(1, 4), S([1000, 80], [2000, 25], [3000, 90]), 'pivot at the start: the end rises 10, the middle 5');
  const b = rotatePoints(s, pivots(s, idx, 'end'), { d: 10 });
  assert.deepEqual(b.script.slice(1, 4), S([1000, 90], [2000, 25], [3000, 80]), 'pivot at the end: the start changes by 10');
  const c = rotatePoints(s, pivots(s, idx, 'middle'), { slope: 0.01 });
  assert.deepEqual(c.script.slice(1, 4), S([1000, 70], [2000, 20], [3000, 90]), 'about the middle: one side up, the other down');
  const d = rotatePoints(s, pivots(s, idx, 'start'), { d: 30 });
  assert.deepEqual(d.script[3], { at: 3000, pos: 100 });
  assert.deepEqual(d.clamped, [3], 'held at 100 and said');
  assert.equal(d.d, 30);
  assert.equal(farOf(s, pivots(s, idx, 'middle')[0]), -1000, 'a tie: the first (earliest) wins');
  assert.deepEqual(amounts(feed(begin('rotate'), '1', '5')), { d: 15 });
  assert.deepEqual(amounts({ ...begin('rotate'), mouse: { slope: 0.02 } }), { slope: 0.02 });
  assert.equal(feed(begin('rotate'), 'X').con, null, 'R has no axis lock (time always stays)');
});

test('the lock from the first mouse travel (bare S) and from a middle drag', () => {
  const m = begin('scale', { axes: 'xy', autoLock: true });
  assert.equal(m.auto, true);
  assert.equal(lockFrom(m, 3, 2).con, null, 'under 8 px: not yet');
  assert.equal(lockFrom(m, 20, 5).con, 'x', 'sideways: time');
  assert.equal(lockFrom(m, 4, -30).con, 'y', 'up / down: level');
  assert.equal(lockFrom(m, 20, 5).auto, false, 'picked once');
  assert.equal(feed(m, 'X').auto, false, 'X first: no auto pick');
  assert.equal(lockFrom(begin('scale'), 30, 0).con, 'y', 'one axis: nothing to pick');
  assert.match(hint(m), /move to pick time \/ level/);
  assert.match(hint(feed(m, 'X'), { f: 2, fx: 2, fy: 1, pivot: 'Start', clamped: 2 }), /^Scale time: ×2\.00 · pivot Start · 2 clamped at 0 \/ 100/);
  assert.match(hint(begin('rotate'), { d: -12, pivot: 'End' }), /^Rotate: far end −12 · pivot End/);
});
