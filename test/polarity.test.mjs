// paw-57ve: polarity stretches (lib/polarity.js) and their route through channelPatch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flipsClean, xorFlips, flipsIn, flipChannel } from '../src/lib/polarity.js';
import { channelPatch } from '../src/lib/runs-channel.js';
import { channelOf } from '../src/lib/runs.js';
import { BLEND_MS } from '../src/lib/signal-source.js';

test('stretches: clean merges touching / overlapping, splits at cuts, never merges across one', () => {
  assert.deepEqual(flipsClean([[500, 300], [100, 200], [200, 250.4], ['x', 1], [5, 5]]), [[100, 250], [300, 500]]);
  assert.deepEqual(flipsClean([[100, 900]], [400]), [[100, 400], [400, 900]], 'split at the cut');
  assert.deepEqual(flipsClean([[100, 400], [400, 900]], [400]), [[100, 400], [400, 900]], 'touching at a cut: kept apart');
  assert.deepEqual(flipsClean([[100, 400], [400, 900]]), [[100, 900]], 'touching elsewhere: one');
  assert.deepEqual(flipsClean(null), []);
});

test('stretches: xor flips what was not flipped and un-flips what was; twice = nothing', () => {
  let L = xorFlips([], 1000, 2000);
  assert.deepEqual(L, [[1000, 2000]]);
  L = xorFlips(L, 1500, 2500);
  assert.deepEqual(L, [[1000, 1500], [2000, 2500]], 'the overlap un-flips, the new part flips');
  L = xorFlips(L, 1500, 2000);
  assert.deepEqual(L, [[1000, 2500]], 'filling the hole merges them');
  assert.deepEqual(xorFlips(L, 1000, 2500), []);
  assert.deepEqual(xorFlips(xorFlips([[0, 100]], 300, 800), 300, 800), [[0, 100]], 'a drag and the same drag again: as before');
  // trim / move = the stretch replaced, then merged (union) with the rest
  const moved = flipsClean([[0, 100], [250, 450]]);
  assert.deepEqual(moved, [[0, 100], [250, 450]]);
  assert.deepEqual(flipsClean([[0, 100], [90, 300]]), [[0, 300]], 'a trimmed end that reaches the next merges');
  assert.deepEqual(flipsIn([[0, 100], [250, 450]], 50, 300), [[50, 100], [250, 300]]);
});

const FPS = 30, P = 800;   // a stroke every 0.8 s
const grid = (ms) => Array.from({ length: Math.round((ms * FPS) / 1000) }, (_, i) => Math.round((i * 1000) / FPS));
const d = (t, ph = 0) => Math.sin((2 * Math.PI * t) / P + ph);   // the true stroke, -1..1

/** The flop: model 'jump' = the measured value is -d from tb on (it jumps there); 'turn' = the measurement is continuous
 *  and its sense inverts at tb (x = 2 d(tb) - d: a spurious turn at tb). */
const measured = (T, tb, model, ph) => T.map((t) => (t < tb ? d(t, ph) : model === 'jump' ? -d(t, ph) : 2 * d(tb, ph) - d(t, ph)));
function runOf(T, v) {
  const ch = { sig: channelOf(T.map((t, i) => [t, v[i]])) };
  return { id: 'r', params: {}, scenes: [{ start_ms: 0, end_ms: T[T.length - 1] + 1 }], range: { start: 0, end: T[T.length - 1] + 1 }, channels: ch, notes: [], channel: 'sig', points0: { at: new Float64Array(), pos: new Float64Array() } };
}
/** Turns of points: alternate (no two tops in a row), and the gaps between them. */
const alternates = (p) => { for (let k = 2; k < p.pos.length; k++) if (Math.sign(p.pos[k] - p.pos[k - 1]) === Math.sign(p.pos[k - 1] - p.pos[k - 2])) return false; return true; };

test('flipChannel mirrors inside the stretch about the scene range and joins without a jump', () => {
  const T = grid(8000), tb = 4000;
  for (const model of ['jump', 'turn']) for (const ph of [0, 0.7, 1.6, 2.4, 3.1, 4.4]) {
    const x = measured(T, tb, model, ph), base = { t: Float64Array.from(T), v: Float32Array.from(x) };
    const f = flipChannel(base, [[tb, Infinity]]);
    let L = Infinity, H = -Infinity;
    for (const y of x) { L = Math.min(L, y); H = Math.max(H, y); }
    for (let j = 0; j < T.length; j++) {
      if (T[j] < tb) assert.equal(f.v[j], base.v[j], 'before: untouched');
      else if (T[j] >= tb + BLEND_MS) assert.ok(Math.abs(f.v[j] - (L + H - x[j])) < 1e-5, 'past the fade: the plain mirror');
    }
    // continuous: the largest step across the join is no bigger than the stroke's own steepest step (+ the fade's slope)
    const j0 = T.findIndex((t) => t >= tb), steep = (2 * Math.PI / P) * (1000 / FPS);
    let big = 0;
    for (let j = j0 - 2; j < j0 + 4; j++) big = Math.max(big, Math.abs(f.v[j + 1] - f.v[j]));
    assert.ok(big <= 1.6 * steep, `${model} ph ${ph}: no jump at the join (${big.toFixed(3)} vs a stroke step ${steep.toFixed(3)})`);
  }
});

test('a stroke train whose second half is inverted: flipping that half gives one consistent train', () => {
  const T = grid(8000), tb = 4000;
  for (const model of ['jump', 'turn']) for (const ph of [0, 0.7, 1.6, 2.4, 3.1, 4.4]) {
    const truth = channelPatch(runOf(T, T.map((t) => d(t, ph))), 'sig', {}, [], {}).points0;
    const r = runOf(T, measured(T, tb, model, ph));
    const flopped = channelPatch(r, 'sig', {}, [], {}).points0, fixed = channelPatch(r, 'sig', {}, [], { flips: [[tb, 8000]] });
    assert.ok(alternates(fixed.points0), `${model} ph ${ph}: tops and bottoms alternate (no double extreme at the boundary)`);
    const n = fixed.points0.at.length;
    assert.ok(Math.abs(n - truth.at.length) <= 1, `${model} ph ${ph}: ${n} turns, the true train has ${truth.at.length} (flopped ${flopped.at.length})`);
    assert.deepEqual(fixed.flipSpans, [[tb, r.range.end]]);
    // far from the boundary the fixed train is the true one, mirrored about the scene's middle: same times
    const far = (a) => Math.abs(a - tb) > 600;
    const tf = Array.from(fixed.points0.at).filter(far), tt = Array.from(truth.at).filter(far);
    assert.deepEqual(tf, tt, `${model} ph ${ph}: same turns away from the join`);
    // the lane trace is the flipped signal: after the join it follows the truth (up to the scene-range mirror)
    assert.ok(fixed.lane && fixed.lane.t.length > 0);
  }
});

test('a stretch on a scene on the sidecar\'s own points: its points outside, the flipped samples inside; other scenes untouched', () => {
  const T = grid(8000), x = T.map((t) => (t < 4000 ? d(t) : -d(t)));
  const pts = channelPatch(runOf(T, T.map((t) => d(t))), 'sig', {}, [], {}).points0;
  const r = { ...runOf(T, x), channel: 'primary', channels: {}, points0: pts, points0Primary: pts, samples: { t: Float64Array.from(T), v: Float32Array.from(x, (y) => 0.5 + 0.5 * y) } };
  const p = channelPatch(r, 'primary', {}, [], { flips: [[6000, 7000]] });
  const out = (a) => a < 6000 - BLEND_MS - 1 || a >= 7000 + BLEND_MS;
  assert.deepEqual(Array.from(p.points0.at).filter(out), Array.from(pts.at).filter(out), 'outside the stretch (+ its fade window): the sidecar\'s points');
  assert.ok(p.points0.at.some((a) => a >= 6000 && a < 7000), 'inside: points from the flipped samples');
  assert.deepEqual(p.flipSpans, [[6000, 7000]]);
  assert.equal(channelPatch(r, 'primary', {}, [], { flips: [[9000, 9500]] }).flipSpans, null, 'outside the run: nothing');
});
