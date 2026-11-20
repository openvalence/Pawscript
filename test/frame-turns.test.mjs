// paw-imsi: inside a detected exact loop (repeated drawings) the motion turns ON a frame; the turns are put on the frame of
// their extreme drawing, never between frames (an owner clip, shot 76: an 8-frame loop at 24 fps, sub-frame turns made the
// halves 149 / 185 ms instead of 167 / 167 and the 600 pos/s cap shortened every fast one). Everywhere else: unchanged.
// And the frames after the last whole pass that still show the cycle are averaged with it (the last stroke not deformed).
import assert from 'node:assert/strict';
import test from 'node:test';
import { strokes, STROKES } from '../src/lib/strokes.js';
import { pointsFromChannel } from '../src/lib/runs-channel.js';
import { channelOf } from '../src/lib/runs.js';
import { indexRepeats } from '../src/features/timeline/repeats.js';
import { averagedRun } from '../src/lib/loop-average.js';

const fm = 1000 / 24, N = 136, T = Array.from({ length: N }, (_, f) => Math.round(f * fm));
// shot 76's drawing values over one cycle (an asymmetric ramp: a parabola puts the top late and the bottom early)
const CYC = [0, 18, 37, 69, 97, 82, 49, 17];
const V = T.map((_, f) => CYC[f % 8]);
const span = [[T[0], T[N - 1]]];
const turnsOf = (pts) => pts.filter((p, i) => i > 0 && i < pts.length - 1 && (p.pos - pts[i - 1].pos) * (pts[i + 1].pos - p.pos) < 0);
const offFrame = (at) => Math.abs(at - Math.round(at / fm) * fm);

test('strokes step: inside an exact loop every turn is on a frame and the halves are 4 + 4 frames', () => {
  const o = { ...STROKES, shapes: [{ t0: 0, t1: 1e9, shape: 'turns', sens: 50 }] };
  const before = turnsOf(strokes(T, V, o).points), after = turnsOf(strokes(T, V, { ...o, exact: span }).points);
  assert.ok(before.some((p) => offFrame(p.at) > 3), 'sub-frame before (the test means something)');
  for (const p of after) assert.ok(offFrame(p.at) <= 0.5, `turn at ${p.at} is ${offFrame(p.at).toFixed(1)} ms off its frame`);
  const halves = after.slice(1).map((p, i) => p.at - after[i].at);
  for (const h of halves) assert.ok(Math.abs(h - 4 * fm) <= 1, `half-stroke ${h} ms`);
});

test('strokes step: outside the exact loops nothing changes (bit-identical)', () => {
  const o = { ...STROKES };
  const a = strokes(T, V, o).points, b = strokes(T, V, { ...o, exact: [[1e9, 2e9]] }).points, c = strokes(T, V, { ...o, exact: [] }).points;
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
});

test('classic extremes (no strokes step): turns on frames inside the loop, unchanged outside', () => {
  const run = { id: 'r', scenes: [], channels: { g1_proj: channelOf(T.map((t, f) => [t, V[f]])) }, range: { start: 0, end: T[N - 1] + 1 } };
  const plain = pointsFromChannel(run, 'g1_proj', {}), on = pointsFromChannel(run, 'g1_proj', { exact: span });
  const turns = (P) => turnsOf(Array.from(P.at, (at, i) => ({ at, pos: P.pos[i] })));
  assert.ok(turns(plain).some((p) => offFrame(p.at) > 3), 'sub-frame before');
  for (const p of turns(on)) assert.ok(offFrame(p.at) <= 0.5, `classic turn ${p.at} off its frame`);
  assert.deepEqual(pointsFromChannel(run, 'g1_proj', { exact: [[1e9, 2e9]] }), plain);
});

test('loop averaging: the frames after the last whole pass that show the cycle are averaged too', () => {
  // a 20-picture loop at 30 fps, 4 whole passes + 7 frames of the 5th (still the cycle's pictures), then other pictures
  const f30 = 1000 / 30, F = 20, P0 = 10, NP = 4, TAIL = 7, M = 140, t = Array.from({ length: M }, (_, f) => Math.round(f * f30));
  const occ = Array.from({ length: F }, () => []);
  for (let f = P0; f < P0 + NP * F + TAIL; f++) occ[(f - P0) % F].push({ f0: f, f1: f, t_ms: t[f] });
  const ix = indexRepeats({ frames: M, buckets: occ });
  const truth = (p) => 50 + 40 * Math.sin((2 * Math.PI * p) / F), wob = (f) => 6 * Math.sin(f * 1.7);
  const v = t.map((_, f) => (f >= P0 && f < P0 + NP * F + TAIL ? truth((f - P0) % F) + wob(f) : 50));
  const loop = { id: 'l', avg: true, t0: t[P0], t1: t[P0 + F], auto: { key: 'k', t0: t[P0], t1: t[P0 + F], end: t[P0 + NP * F + TAIL], n: NP + 1 } };
  const run = { range: { start: 0, end: t[M - 1] + 1 }, channel: 'g', channels: { g: channelOf(t.map((x, f) => [x, v[f]])) }, samples: { t: [], v: [] } };
  const a = averagedRun(run, { loops: [loop], ix, fm: f30 }).channels.g.v;
  for (let j = 0; j < TAIL; j++) {
    const f = P0 + NP * F + j;
    assert.ok(Math.abs(a[f] - a[P0 + F + j]) < 1e-3, `tail frame ${f}: ${a[f].toFixed(2)} vs the cycle's ${a[P0 + F + j].toFixed(2)}`);
  }
});
