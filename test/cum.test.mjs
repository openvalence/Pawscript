// Cumshot proposals (src/lib/cum.js) and the sidecar request (src/lib/protocol.js cumRequest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cumProposals, cumShown, cumPlacement, linkedSpurt, cumThreshold, CUM_STRONG, cumTipText } from '../src/lib/cum.js';
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
  assert.deepEqual(cumPlacement(fx, list, { frameMs: 40, snap }), [{ t0: 1520 }, { t0: 2000 }]);   // 1000 -> the spurt at 1020; 1510 -> 1520, taken by 1500
  assert.deepEqual(cumPlacement(fx, list, { frameMs: 40, snap, threshold: 0.5 }), [{ t0: 1520 }]);
  assert.deepEqual(cumPlacement([], [], {}), []);
});

test('cumPlacement: joins the linked spurt group of the scene', () => {
  const fx = [
    { id: 'x', kind: 'spurt', t0: 500, t1: 500, link: 'L0', params: { amount: 10 } },    // another scene
    { id: 'y', kind: 'spurt', t0: 1100, t1: 1100, link: 'L1', params: { amount: 40, count: 3 } },
    { id: 'z', kind: 'knotting', t0: 1000, t1: 3000, link: 'K' },
  ];
  assert.deepEqual(linkedSpurt(fx, SCENE), { link: 'L1', params: { amount: 40, count: 3 } });
  assert.equal(linkedSpurt(fx, { start_ms: 2000, end_ms: 3000 }), null);
  const out = cumPlacement(fx, [{ t: 2000, score: 0.9 }], { span: SCENE });
  assert.deepEqual(out, [{ t0: 2000, link: 'L1', params: { amount: 40, count: 3 } }]);
  out[0].params.amount = 1;
  assert.equal(fx[1].params.amount, 40, 'params are copied');
  assert.deepEqual(cumPlacement(fx, [{ t: 2000, score: 0.9 }], {}), [{ t0: 2000 }], 'no span: no link');
});

test('cumRequest shape', () => {
  assert.deepEqual(cumRequest('v.mp4', 1000.4, 2000.6, { fps: 12 }),
    { cmd: 'cum', video: 'v.mp4', start_ms: 1000, end_ms: 2001, params: { fps: 12 } });
  assert.deepEqual(cumRequest('v.mp4', 0, 10, undefined, [3.4, 7.6]),
    { cmd: 'cum', video: 'v.mp4', start_ms: 0, end_ms: 10, params: {}, pulses: [3, 8] });
  assert.equal('pulses' in cumRequest('v', 0, 1, {}, []), false);
});
