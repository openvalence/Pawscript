// paw-p52k: a click on a shot lands on the frame that STARTS there, and "the shot at the playhead" is decided by that frame's
// start on the ms grid (a cut is stored rounded), never by the element's reported time, which sits a hair under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, seekTimeOf } from '../src/features/video/frames.js';
import { playheadFrameStart } from '../src/lib/lane.js';
import { sceneAtPlayhead, sceneIndexAt } from '../src/features/timeline/scenes.js';

const RATES = [['30 fps', 30], ['29.97 fps', 30000 / 1001], ['23.976 fps', 24000 / 1001]];
for (const [name, fps] of RATES) for (const startMs of [0, 33]) {
  test(`${name}, startMs ${startMs}: a cut on a frame start belongs to the shot starting there`, () => {
    const clock = makeClock({ fps, durationMs: 120000 });
    for (const k of [1, 300, 777, 1001, 2043, 2150]) {
      const cut = Math.round(clock.timeOf(k)), list = [{ start_ms: 0, end_ms: cut }, { start_ms: cut, end_ms: 120000 }];
      // the element reports the frame's exact pts, minus float noise, plus the app's startMs offset taken back off
      for (const reported of [clock.timeOf(k), clock.timeOf(k) - 1e-6, clock.timeOf(k) + startMs / 1e3 - startMs / 1e3 - 1e-9]) {
        const frame = clock.frameAt(reported), timeMs = Math.round(clock.timeOf(frame));
        assert.equal(frame, k);
        assert.equal(clock.frameAt(timeMs), k, 'idempotent: the rounded start is in the same frame');
        const player = { frame, timeMs, frameMs: clock.frameMs, playing: false, timeOfFrame: clock.timeOf };
        assert.equal(sceneAtPlayhead(list, player), 1, `frame ${k}`);
        assert.equal(playheadFrameStart(player), cut);
      }
      // the raw reported time under a rounded-up cut is what used to pick the shot before it
      const raw = clock.timeOf(k);
      if (raw < cut) assert.equal(sceneIndexAt(list, raw), 0);
      // the seek target is inside the frame: start plus a fraction, whatever the rounding of the container
      const s = seekTimeOf(clock, k);
      assert.ok(s > clock.timeOf(k) && s < clock.timeOf(k + 1) && clock.frameAt(s) === k);
    }
  });
}
test('a playing playhead uses its own time; the frame before a cut stays in the previous shot', () => {
  const clock = makeClock({ fps: 30000 / 1001, durationMs: 60000 }), k = 777, cut = Math.round(clock.timeOf(k)), list = [{ start_ms: 0, end_ms: cut }, { start_ms: cut, end_ms: 60000 }];
  assert.equal(sceneAtPlayhead(list, { frame: k - 1, timeMs: Math.round(clock.timeOf(k - 1)), frameMs: clock.frameMs, playing: false, timeOfFrame: clock.timeOf }), 0);
  assert.equal(sceneAtPlayhead(list, { timeMs: cut + 5, frameMs: clock.frameMs, playing: true }), 1);
});
