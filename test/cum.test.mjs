// Cumshot proposals (src/lib/cum.js) and the sidecar request (src/lib/protocol.js cumRequest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cumProposals, cumShown, cumPlacement, velOfScore, cumThreshold, CUM_STRONG, cumTipText } from '../src/lib/cum.js';
import { cumRequest } from '../src/lib/protocol.js';

const RES = { spurts: [
  { t_ms: 900, score: 0.9, source: 'tag' },          // before the scene
  { t_ms: 1200.4, score: 0.71234, source: 'cam' },
  { t_ms: 1210, score: 0.8, source: 'fluid' },       // same frame as 1200 (40 ms frames): the higher stays
  { t_ms: 2500, score: 0.2, source: 'fluid' },
  { t_ms: 1800, score: 1.4, source: 'tag+pulse' },   // clamped to 1, sorted into place
  { t_ms: 4000, score: 0.6, source: 'tag' },         // at the scene end (exclusive)
  { t_ms: 3000, score: NaN }, { score: 0.5 },
] };
const SCENE = { start_ms: 1000, end_ms: 4000 };

test('cumProposals: inside the scene, sorted, one per frame, clamped and rounded', () => {
  assert.deepEqual(cumProposals(RES, SCENE, 40), [{ t: 1210, score: 0.8 }, { t: 1800, score: 1 }, { t: 2500, score: 0.2 }]);
  assert.deepEqual(cumProposals(RES, { t0: 1000, t1: 1500 }, 1), [{ t: 1200, score: 0.712 }, { t: 1210, score: 0.8 }]);
  assert.deepEqual(cumProposals(null, SCENE), []);
  assert.deepEqual(cumProposals({ spurts: [] }, SCENE), []);
});

test('cumShown / threshold pill', () => {
  const l = cumProposals(RES, SCENE, 40);
  assert.equal(cumShown(l, cumThreshold(false)).length, 3);
  assert.deepEqual(cumShown(l, cumThreshold(true)).map((p) => p.t), [1210, 1800]);
  assert.equal(cumThreshold(true), CUM_STRONG);
  assert.match(cumTipText({ t: 1, score: 0.2 }), /0\.20 \(weak\)/);
});

test('cumPlacement: skips frames that have a spurt, snaps, never doubles', () => {
  const list = [{ t: 1000, score: 0.9 }, { t: 1500, score: 0.3 }, { t: 1510, score: 0.6 }, { t: 2000, score: 0.1 }];
  const fx = [{ id: 'a', kind: 'spurt', t0: 1020, t1: 1020 }, { id: 'b', kind: 'shape', t0: 1900, t1: 2100 }];
  const snap = (t) => Math.round(t / 40) * 40;
  assert.deepEqual(cumPlacement(fx, list, { frameMs: 40, snap }), [{ t0: 1520, vel: 0.8 }, { t0: 2000, vel: 0.6 }]);   // 1000 -> the spurt at 1020; 1510 -> 1520, taken by 1500
  assert.deepEqual(cumPlacement(fx, list, { frameMs: 40, snap, threshold: 0.5 }), [{ t0: 1520, vel: 1.1 }]);
  assert.deepEqual(cumPlacement([], [], {}), []);
});

test('paw-d1g7 cumPlacement: each placed proposal is a marker with a velocity from its score (no spurt link: the orgasm holds the shape)', () => {
  assert.deepEqual([0, 0.25, 0.5, 0.9, 1, 3].map(velOfScore), [0.5, 0.75, 1, 1.4, 1.5, 1.5]);
  const fx = [{ id: 'y', kind: 'spurt', t0: 1100, t1: 1100, link: 'L1', params: { amount: 40 } }];
  assert.deepEqual(cumPlacement(fx, [{ t: 2000, score: 0.9 }], {}), [{ t0: 2000, vel: 1.4 }]);
});

test('cumRequest shape', () => {
  assert.deepEqual(cumRequest('v.mp4', 1000.4, 2000.6, { fps: 12 }),
    { cmd: 'cum', video: 'v.mp4', start_ms: 1000, end_ms: 2001, params: { fps: 12 } });
  assert.deepEqual(cumRequest('v.mp4', 0, 10, undefined, [3.4, 7.6]),
    { cmd: 'cum', video: 'v.mp4', start_ms: 0, end_ms: 10, params: {}, pulses: [3, 8] });
  assert.equal('pulses' in cumRequest('v', 0, 1, {}, []), false);
});
