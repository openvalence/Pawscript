import assert from 'node:assert/strict';
import test from 'node:test';
import { loopInfo, toFrame, repetitions, seam, seamWarning, srcKey, needsRetile, suggestions } from '../src/features/timeline/loops.js';

test('loops: frames, repetitions, seams, re-tile detection, suggestions', () => {
  const fm = 1000 / 24, loop = { t0: 1000, t1: 1000 + 48 * fm };
  assert.deepEqual(loopInfo(loop, fm), { ms: 2000, frames: 48, exact: true, real: 2000 });
  assert.equal(loopInfo({ t0: 0, t1: 2010 }, fm).exact, false);
  assert.equal(toFrame(1010, fm), 1000);
  const reps = repetitions({ t0: 1000, t1: 1300 }, 2200);
  assert.deepEqual(reps.map((x) => [x.k, x.t0, x.t1, x.partial]), [[0, 1000, 1300, false], [1, 1300, 1600, false], [2, 1600, 1900, false], [3, 1900, 2200, false]]);
  assert.equal(repetitions({ t0: 0, t1: 300 }, 700).at(-1).partial, true);
  // exact anchoring: rep 1000 of a 1001/3 ms cycle starts where 1000 periods say, not where rounding drifted
  assert.equal(repetitions({ t0: 0, t1: 1001 / 3 }, 1e9, 2000)[1000].t0, Math.round((1000 * 1001) / 3));
  const cyc = [{ at: 0, pos: 10 }, { at: 250, pos: 90 }, { at: 500, pos: 10 }];
  assert.deepEqual(seam(cyc, 600), { dt: 100, dpos: 0, speed: 0 });
  assert.equal(seamWarning(cyc, 600), null);
  const bad = [{ at: 0, pos: 10 }, { at: 300, pos: 90 }, { at: 590, pos: 95 }];
  assert.ok(seamWarning(bad, 600).speed > 1000);
  const s = [{ at: 0, pos: 0 }, { at: 100, pos: 50 }, { at: 400, pos: 0 }];
  const L = { t0: 0, t1: 300, tiledTo: 3000, srcKey: srcKey(s, { t0: 0, t1: 300 }) };
  assert.equal(needsRetile(s, L), false);
  assert.equal(needsRetile([{ at: 0, pos: 0 }, { at: 100, pos: 60 }], L), true);
  assert.deepEqual(suggestions([{ start_ms: 0, end_ms: 9000, loop: { kind: 'exact', period_ms: 2000, period_frames: 48, confidence: 0.9 } }, { start_ms: 9000, loop: { kind: null } }]).map((x) => [x.t0, x.t1, x.frames]), [[0, 2000, 48]]);
});
