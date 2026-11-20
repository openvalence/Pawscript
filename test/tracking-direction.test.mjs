// direction.js: Track forward / backward from the seed frame (paw-bh2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directionSpan, throughCuts, progressBand } from '../src/features/tracking/direction.js';

// scene A = shots 0 (0-4 s) | camera move | 1 (4-8 s); hard cut; shot 2 (8-12 s, a pan arriving at the action, split by
// the detector) | hard cut inside the scene | 3 (12-20 s, the action); scene cut; 4 (20-30 s)
const shots = [{ start_ms: 0, end_ms: 4000 }, { start_ms: 4000, end_ms: 8000, join: true, split: 'camera' },
  { start_ms: 8000, end_ms: 12000 }, { start_ms: 12000, end_ms: 20000, join: true }, { start_ms: 20000, end_ms: 30000 }];

test('both: the caller keeps its range', () => assert.equal(directionSpan(shots, 15000, 'both'), null));

test('backward from mid-shot: back to its take start, no crossing', () => {
  assert.deepEqual(directionSpan(shots, 15000, 'backward'), { t0: 12000, t1: 15001, crossed: [] });
  assert.deepEqual(directionSpan(shots, 6000, 'backward'), { t0: 0, t1: 6001, crossed: [] }, 'a camera move is not a stop');
});

test('backward from the first frame of a shot: on past its cut to the previous hard cut, the cut offered', () => {
  assert.deepEqual(directionSpan(shots, 12000, 'backward'), { t0: 8000, t1: 12001, crossed: [3] });
  assert.deepEqual(directionSpan(shots, 12300, 'backward'), { t0: 8000, t1: 12301, crossed: [3] }, 'near the start (< 0.5 s)');
  assert.deepEqual(directionSpan(shots, 8100, 'backward'), { t0: 0, t1: 8101, crossed: [2] }, 'the take before is two shots joined by a camera move');
});

test('forward: to the take end; from its last frames on to the next hard cut', () => {
  assert.deepEqual(directionSpan(shots, 1000, 'forward'), { t0: 1000, t1: 8000, crossed: [] });
  assert.deepEqual(directionSpan(shots, 19800, 'forward'), { t0: 19800, t1: 30000, crossed: [4] });
});

test('an owner range replaces the limits; every hard cut inside is crossed', () => {
  assert.deepEqual(directionSpan(shots, 15000, 'backward', { range: { t0: 5000, t1: 25000 } }), { t0: 5000, t1: 15001, crossed: [2, 3] });
  assert.deepEqual(directionSpan(shots, 15000, 'forward', { range: { t0: 5000, t1: 25000 } }), { t0: 15000, t1: 25000, crossed: [4] });
  assert.deepEqual(directionSpan([], 15000, 'backward', { duration: 60000 }), { t0: 0, t1: 15001, crossed: [] }, 'no shots: the whole video');
});

test('cuts are tracked through; the lane band grows from the seed', () => {
  assert.deepEqual(throughCuts([{ t_ms: 8000, kind: 'hard', why: 'scene' }, { t_ms: 4000, kind: 'soft', why: 'camera split' }]),
    [{ t_ms: 8000, kind: 'soft', why: 'tracked through: scene' }, { t_ms: 4000, kind: 'soft', why: 'camera split' }]);
  assert.deepEqual(throughCuts(undefined), []);
  assert.deepEqual(progressBand({ dir: 'backward', seed: 12000, t0: 8000, t1: 12001 }, 0.25), { t0: 11000, t1: 12000 });
  assert.deepEqual(progressBand({ dir: 'forward', seed: 1000, t0: 1000, t1: 9000 }, 0.5), { t0: 1000, t1: 5000 });
  assert.equal(progressBand({ dir: 'both' }, 0.5), null);
});

test('trackRequest: direction and seed_ms only for a one-way run (PROTOCOL v4.15)', async () => {
  const { trackRequest } = await import('../src/lib/protocol.js');
  const base = { video: 'v', tracker: 'x', start_ms: 0, end_ms: 9000, params: {} };
  assert.equal(trackRequest({ ...base, direction: 'both', seed_ms: 5 }).direction, undefined);
  assert.deepEqual([trackRequest({ ...base, direction: 'backward', seed_ms: 4000.4 })].map((r) => [r.direction, r.seed_ms]), [['backward', 4000]]);
});
