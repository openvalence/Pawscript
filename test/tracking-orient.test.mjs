import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addOrientation } from '../src/features/tracking/orient.js';
import { directionOf } from '../src/lib/polarity.js';
import { channelPatch } from '../src/lib/runs-channel.js';

const P = { at: Float64Array.from([0, 100, 200, 300, 400]), pos: Float64Array.from([10, 90, 10, 90, 10]) };
const scenes = [{ start_ms: 0, end_ms: 250, sign: 1 }, { start_ms: 250, end_ms: 500, sign: 1 }];
const run = (o) => ({ id: 'r', scenes, range: { start: 0, end: 500 }, channels: {}, channel: 'primary', notes: [], params: {}, points0: P, flips: [], orient: [], ...o });

test('overrides split earlier ones and stay sorted', () => {
  let l = addOrientation([], { t0: 0, t1: 400, sign: -1 });
  l = addOrientation(l, { t0: 100, t1: 200, sign: 1 });
  assert.deepEqual(l, [{ t0: 0, t1: 100, sign: -1 }, { t0: 100, t1: 200, sign: 1 }, { t0: 200, t1: 400, sign: -1 }]);
});

test('an override wins over a scene flip inside its span only (paw-vtec: one direction map, applied when composed)', () => {
  // scene 0 flipped, but 0..150 pinned to +1: the scene stays flipped, 0..150 is un-flipped against it
  const d = directionOf(run({ flips: [0], orient: [{ t0: 0, t1: 150, sign: 1 }] }));
  assert.deepEqual([...d.whole], [0]); assert.deepEqual(d.partial, [[0, 150]]);
  // an override over a whole scene is that scene's flip; pinned +1 over a flipped scene: not flipped
  const m = directionOf(run({ orient: [{ t0: 250, t1: 500, sign: -1 }] }));
  assert.deepEqual([...m.whole], [1]); assert.deepEqual(m.partial, []);
  assert.deepEqual([...directionOf(run({ flips: [1], orient: [{ t0: 250, t1: 500, sign: 1 }] })).whole], []);
  // composed: the sidecar's points of the whole-flipped scene mirrored (no samples here: a partial span mirrors its points)
  assert.deepEqual(Array.from(channelPatch(run({ orient: [{ t0: 250, t1: 500, sign: -1 }] }), 'primary').points0.pos), [10, 90, 10, 10, 90]);
  assert.deepEqual(Array.from(channelPatch(run({ flips: [0], orient: [{ t0: 0, t1: 150, sign: 1 }] }), 'primary').points0.pos), [10, 90, 90, 90, 10]);
  assert.deepEqual(Array.from(P.pos), [10, 90, 10, 90, 10], 'input untouched');
});
