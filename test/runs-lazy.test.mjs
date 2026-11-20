// paw-o60v.4 / paw-v9qp: decoded runs keep their points in the file's bytes and decode a frame when it is read. Every
// consumer must get the numbers the eager decode gave: the frames, the camera / axis derives from the point tracks, and
// the bytes they encode to, also after the decoded frames were dropped (holdPoints) and decoded again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeRuns, decodeRuns, holdPoints, runsFileKey, encodeRunsAsync, lazyFrames } from '../src/lib/runs-file.js';
import { deriveChannels } from '../src/lib/rederive.js';
import { synthRuns } from '../dev/perf/synth-runs.mjs';

/** 3 grid runs with pinned groups, one with odd frames: no overlay, a box only, points kept verbatim (not derivable),
 *  points without a label (pts of 3) carrying a part id. */
function fixture() {
  const runs = synthRuns({ runs: 3, frames: 90, points: 64, groups: 3 });
  const ov = runs[2].frames.ov;
  ov[5] = null;
  ov[6] = { boxes: [[0.1, 0.1, 0.2, 0.2]] };
  ov[7] = { ...ov[7], points: [[0.5, 0.5]] };
  ov[8] = { ...ov[8], pts: ov[8].pts.map((q, j) => (j === 3 ? [q[0], q[1], q[2]] : q)) };
  return runs;
}
const plain = (r) => ({ ...r, frames: JSON.parse(JSON.stringify(r.frames)) });   // what the eager decode held: plain arrays
const chans = (c) => JSON.stringify(Object.entries(c).map(([k, s]) => [k, Array.from(s.t), Array.from(s.v)]));
const DERIVES = [[{ cam: { mode: 'move', source: 'all', strength: 100, smoothMs: 0 } }], [{ cam: { mode: 'zoom', source: 'background', strength: 100, smoothMs: 0 } }], [{ cam: { mode: 'full', source: 'all', strength: 60, smoothMs: 0 }, axis: { mode: 'vertical' } }]];

test('lazy frames: the same overlays, derives and bytes as plain arrays; dropped frames decode to the same numbers', () => {
  const fx = fixture(), bytes = encodeRuns(fx), runs = decodeRuns(bytes), ref = runs.map(plain);
  assert.equal(typeof Object.getOwnPropertyDescriptor(runs[0].frames.ov[0], 'pts').get, 'function', 'decoded lazily');
  assert.deepEqual([lazyFrames(runs[2].frames), lazyFrames(fx[2].frames), lazyFrames(ref[2].frames)], [true, false, false]);
  for (let k = 0; k < runs.length; k++) {
    assert.deepEqual(runs[k].frames, ref[k].frames);
    assert.deepEqual(Object.keys(runs[k].frames.ov[0]), Object.keys(ref[k].frames.ov[0]));
    for (const d of DERIVES) assert.equal(chans(deriveChannels(runs[k], d, { aspect: 16 / 9, force: true }).channels), chans(deriveChannels(ref[k], d, { aspect: 16 / 9, force: true }).channels));
  }
  assert.deepEqual(runs[2].frames.ov[8].pts[3], ref[2].frames.ov[8].pts[3]);
  // encoded again without the kept sections (new frames objects: every frame packed through the accessors): the same file
  // as from the kept sections and as from plain arrays
  const again = encodeRuns(runs);
  assert.deepEqual(encodeRuns(runs.map((r) => ({ ...r, frames: { ...r.frames } }))), again);
  assert.deepEqual(encodeRuns(ref), again);
  // a tiny hold: every read drops the frame before, decodes again, same numbers (a new array)
  const was = holdPoints(64);
  try {
    const fresh = decodeRuns(bytes), a = fresh[1].frames.ov[10].pts;
    fresh[1].frames.ov[11].pts;   // eslint-disable-line no-unused-expressions
    const b = fresh[1].frames.ov[10].pts;
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
    for (let k = 0; k < fresh.length; k++) assert.deepEqual(fresh[k].frames, ref[k].frames);
  } finally { holdPoints(was); }
  // assigning a frame's points makes them plain (a consumer that replaces them keeps its own)
  const ov = runs[0].frames.ov[0], mine = [[0, 0, 1]];
  ov.pts = mine;
  assert.equal(ov.pts, mine);
  assert.deepEqual({ ...ov }.pts, mine);
});

test('paw-v9qp: the file a decode came from is its own key: the first write after an open writes nothing when the runs did not change', async () => {
  const bytes = encodeRuns(decodeRuns(encodeRuns(fixture())));   // a file the app wrote (its records as a decode makes them)
  const runs = decodeRuns(bytes), key = runsFileKey(runs);
  assert.ok(key);
  assert.equal((await encodeRunsAsync(runs.map((r) => ({ ...r })), key)).bytes, null);
  const flipped = runs.map((r, i) => (i === 1 ? { ...r, flips: [0] } : r)), out = await encodeRunsAsync(flipped, key);
  assert.ok(out.bytes);
  assert.deepEqual(decodeRuns(out.bytes)[1].flips, [0]);
  // a file whose sections would not re-encode the same has no key (it is written again)
  const odd = new Uint8Array(bytes);
  odd[odd.length - 1] = 0x80;   // the last pinned id (the file ends with the last run's id section): -128 is never written
  assert.equal(runsFileKey(decodeRuns(odd)), null);
});
