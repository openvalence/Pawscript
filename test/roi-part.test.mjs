// paw-x8we: Track ROI = one painted part (src/features/tracking/roi-part.js): which parts, the box, the span, the pick order,
// the tracker. Old box runs keep their seed frame from run.roi.t_ms (seed-marks.js), untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paintedParts, partBox, partRange, pickOrder, roiTracker } from '../src/features/tracking/roi-part.js';
import { seedTimes } from '../src/features/tracking/seed-marks.js';

const sq = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
const G = (name, t_ms, poly = sq(0.5, 0.5, 0.1), x = {}) => ({ name, t_ms, poly, who: name.split('_')[0], part: name.split('_')[1], ...x });
const scenes = [
  { start_ms: 0, end_ms: 4000, groups: [G('c2_penis', 1000), G('c2_penis', 2500, sq(0.6, 0.5, 0.1)), G('c1_anus', 1000), G('ignore1', 1000), G('c1_hips', 1500, sq(0.3, 0.3, 0.1), { off: true })] },
  { start_ms: 4000, end_ms: 9000, groups: [G('c2_balls', 6000)] },
];

test('paintedParts: one per name, its earliest painting the seed, in seed order; ignore regions and parts turned off are not parts', () => {
  const p = paintedParts(scenes, 0, 9000);
  assert.deepEqual(p.map((x) => [x.name, x.group.t_ms]), [['c2_penis', 1000], ['c1_anus', 1000], ['c2_balls', 6000]]);
  assert.deepEqual(paintedParts(scenes, 4000, 9000).map((x) => x.name), ['c2_balls'], 'only the range');
  assert.deepEqual(paintedParts(scenes, 2000, 4000).map((x) => [x.name, x.group.t_ms]), [['c2_penis', 2500]], 'inside the range: its painting there');
  assert.deepEqual(paintedParts([], 0, 1000), []);
});

test('partBox: the bounds plus 10 % each side, inside the frame; a degenerate painting has none', () => {
  const b = partBox(sq(0.5, 0.5, 0.1));
  for (const [k, v] of Object.entries({ x: 0.38, y: 0.38, w: 0.24, h: 0.24 })) assert.ok(Math.abs(b[k] - v) < 1e-9, `${k} ${b[k]}`);
  assert.equal(b.kind, 'box');
  const e = partBox([[0, 0], [0.2, 0], [0.2, 0.1], [0, 0.1]]);
  assert.equal(e.x, 0); assert.equal(e.y, 0); assert.ok(Math.abs(e.w - 0.22) < 1e-9);
  assert.equal(partBox([[0.5, 0.5], [0.5, 0.5]]), null);
  assert.equal(partBox([]), null);
});

test('partRange: the shot of the seed, inside the span', () => {
  assert.deepEqual(partRange(scenes, 1000, { t0: 0, t1: 9000 }), { start: 0, end: 4000 });
  assert.deepEqual(partRange(scenes, 6000, { t0: 5000, t1: 9000 }), { start: 5000, end: 9000 });
  assert.deepEqual(partRange([], 6000, { t0: 5000, t1: 7000 }), { start: 5000, end: 7000 }, 'no shots: the span');
});

test('pickOrder: the part under the pointer first, then the last pick, then the rest as painted', () => {
  const p = ['a', 'b', 'c', 'd'].map((name) => ({ name }));
  assert.deepEqual(pickOrder(p).map((x) => x.name), ['a', 'b', 'c', 'd']);
  assert.deepEqual(pickOrder(p, { last: 'c' }).map((x) => x.name), ['c', 'a', 'b', 'd']);
  assert.deepEqual(pickOrder(p, { first: 'd', last: 'c' }).map((x) => x.name), ['d', 'c', 'a', 'b']);
});

test('roiTracker: the panel tracker when it takes a box and is not the grid\'s; else SAM; else another box tracker; never a GPU one that is off', () => {
  const T = [{ id: 'tapnext_points', roi: 'box_or_points', gpu: true }, { id: 'sam2_mask', roi: 'box_or_points', gpu: true }, { id: 'lk_box', roi: 'box' }, { id: 'lk_two_point', roi: 'points' }, { id: 'fake.none', roi: 'none' }];
  const on = () => false, noGpu = (t) => !!t.gpu;
  assert.equal(roiTracker(T, 'tapnext_points', on).id, 'sam2_mask', 'after T (the grid picked): SAM, the part\'s size');
  assert.equal(roiTracker(T, 'lk_box', on).id, 'lk_box', 'a box tracker the owner picked');
  assert.equal(roiTracker(T, 'lk_two_point', on).id, 'sam2_mask', 'a points-only tracker: SAM');
  assert.equal(roiTracker(T, 'fake.none', on).id, 'sam2_mask');
  assert.equal(roiTracker(T, 'tapnext_points', noGpu).id, 'lk_box', 'no GPU: optical flow on the bounds');
  assert.equal(roiTracker([T[0]], '', on).id, 'tapnext_points', 'only a grid tracker: it');
  assert.equal(roiTracker([T[3], T[4]], '', on), null);
});

test('an old box run keeps its seed frame (run.roi.t_ms) when no group is painted in it', () => {
  const run = { range: { start: 4000, end: 9000 }, roi: { kind: 'box', x: 0.3, y: 0.3, w: 0.2, h: 0.2, t_ms: 5000 } };
  assert.deepEqual(seedTimes(run, [{ start_ms: 4000, end_ms: 9000 }]), [5000]);
});
