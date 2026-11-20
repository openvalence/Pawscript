// The balls -> spurts suggestion: on, or off with the reason the row / scene menu / palette show (timeline/balls.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ballsReason, MIN_BALLS } from '../src/features/timeline/balls.js';

const T = Array.from({ length: 100 }, (_, i) => i * 100);   // 10 s at 10 fps
const ch = (f) => ({ t: T, v: T.map(f) });
const scenes = [{ start_ms: 0, end_ms: 10000 }];
const ghost = { id: 'r1', visible: true, script: [{ at: 0, pos: 50 }, { at: 9900, pos: 50 }], source: { kind: 'tracker', range: { t0: 0, t1: 10000 } } };
const appWith = (run) => ({ doc: { scenes, ghosts: run ? [ghost] : [] }, tracking: { run: (id) => (id === 'r1' ? run : null) } });
const R = (channels, extra = {}) => ({ scenes: [{ start_ms: 0, end_ms: 10000 }], channels, notes: [], ...extra });

test('ballsReason: on with the pinned balls group seen often enough, else the reason (no run, too rare, old run, no group)', () => {
  assert.deepEqual(ballsReason(appWith(null), 5000), { enabled: false, reason: 'no run under this scene', short: 'no run' });
  const on = ballsReason(appWith(R({ sem_balls_scale: ch((t) => Math.sin(t / 300)), sem_balls_n: ch(() => 0.1) })), 5000);
  assert.equal(on.enabled, true); assert.equal(on.ch, 'sem_balls_scale'); assert.equal(on.reason, '');
  assert.deepEqual([on.at.t0, on.at.t1], [0, 10000]);
  // seen on 12 % of the frames: off, the share in the reason
  const rare = R({ sem_balls_scale: ch((t) => (t < 1200 ? Math.sin(t) : NaN)), sem_balls_n: ch((t) => (t < 1200 ? 0.05 : 0)) });
  assert.ok(0.12 < MIN_BALLS);
  assert.deepEqual(ballsReason(appWith(rare), 5000), { enabled: false, reason: 'balls seen on 12 % of frames only', short: 'balls 12 %' });
  // a run from before PROTOCOL v4.6: no sem_* channel, no seeded scene group, no v4.6 seed record
  const old = R({ g1_proj: ch(() => 0.5) });
  assert.equal(ballsReason(appWith(old), 5000).short, 'old run');
  assert.match(ballsReason(appWith(old), 5000).reason, /run predates seeded groups \(PROTOCOL < 4\.6\)/);
  // v4.6 run (hips seeded) with no balls group
  const noBalls = R({ sem_hips_proj: ch(() => 0.5), sem_hips_n: ch(() => 0.2) });
  assert.deepEqual(ballsReason(appWith(noBalls), 5000), { enabled: false, reason: 'no balls group in this run: re-track with the current sidecar (seeded groups)', short: 'no balls group' });
  // a v4.6 seed record alone also marks the run as seeded-aware
  assert.equal(ballsReason(appWith(R({ g1_proj: ch(() => 0.5) }, { notes: [{ code: 'primary', data: { seed: { layout: 'grid' } } }] })), 5000).short, 'no balls group');
  // a tracked part named balls (v3.4) counts without a presence check
  const part = R({ g1p1_scale: ch((t) => Math.sin(t / 300)) }, { scenes: [{ start_ms: 0, end_ms: 10000, groups: { g1p1: { label: 'balls' } } }] });
  assert.deepEqual([ballsReason(appWith(part), 5000).enabled, ballsReason(appWith(part), 5000).ch], [true, 'g1p1_scale']);
});
