// Machine: depth from video (paw-8x1, src/features/machine/video.js): the tracked shaft's inserted fraction as mm of the
// toy inside, only where trusted; "video" mode's script; the script-vs-video comparison.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STEP_MS, trusted, sampleTimes, videoTrack, videoAt, videoKnot, videoScript, compareDepth, diffText } from '../src/features/machine/video.js';
import { insertedAt } from '../src/lib/shaft.js';
import { channelOf } from '../src/lib/runs.js';
import { posAt } from '../src/lib/core/script.js';
import { depthOf } from '../src/features/machine/physics.js';

const RIG = { offsetMm: 0, strokeMm: 200 }, USABLE = 200;
/** 1 Hz strokes, 0..20 s: the script goes 0 -> 160 mm deep; the video says 0 -> 0.7 of the shaft (140 mm). */
const script = [];
for (let k = 0; k <= 20; k++) script.push({ at: k * 1000, pos: 100 }, ...(k < 20 ? [{ at: k * 1000 + 500, pos: 20 }] : []));
const inFrac = (t) => 0.35 * (1 - Math.cos((2 * Math.PI * t) / 1000));
/** Readings: SAM, confident, except a 2 s gap (8-10 s) of low confidence and 14-16 s from the points fallback. */
const reading = (t) => ({ in: inFrac(t), conf: t >= 8000 && t < 10000 ? 0.2 : 0.9, source: t >= 14000 && t < 16000 ? 'points' : 'sam', knot: t > 9000 ? 1 : 0, name: 'c1_penis' });
const times = sampleTimes(script), track = videoTrack(times, times.map(reading), USABLE);

test('video: only SAM readings at conf >= 0.5 count; nothing trusted is no track', () => {
  assert.ok(trusted({ in: 0.5, conf: 0.5, source: 'sam' }));
  assert.ok(!trusted({ in: 0.5, conf: 0.49, source: 'sam' }) && !trusted({ in: 0.5, conf: 1, source: 'points' }) && !trusted(null) && !trusted({ in: NaN, conf: 1, source: 'sam' }));
  assert.equal(videoTrack(times, times.map(() => null), USABLE), null);
  assert.equal(times[1] - times[0], STEP_MS);
  assert.ok(Math.abs(videoAt(track, 500) - 140) < 0.5, `${videoAt(track, 500)}`);   // in x the usable length
  for (const t of [8500, 9999, 14500, 15950, 25000, -10]) assert.ok(Number.isNaN(videoAt(track, t)), `nothing at ${t}`);
  assert.equal(videoKnot(track, 3000), 'out'); assert.equal(videoKnot(track, 12000), 'in'); assert.equal(videoKnot(track, 9000), null);
});

test('video mode: the script with the video put in where trusted, the script elsewhere', () => {
  const v = videoScript(script, track, RIG);
  for (let i = 1; i < v.length; i++) assert.ok(v[i].at > v[i - 1].at, `ascending at ${i}`);
  const dAt = (t) => depthOf(RIG, posAt(v, t));
  for (const t of [500, 3250, 12500, 19500]) assert.ok(Math.abs(dAt(t) - videoAt(track, t)) < 1, `video at ${t}: ${dAt(t)} vs ${videoAt(track, t)}`);
  for (const t of [8500, 9500, 14500, 15500]) assert.ok(Math.abs(posAt(v, t) - posAt(script, t)) < 1e-9, `script at ${t}`);
  assert.equal(videoScript(script, null, RIG), script);
});

test('compare: mean and worst difference, signed; reversals where the script runs against the video', () => {
  const c = compareDepth(track, script, RIG, 1000);
  assert.ok(c.n > 200 && c.worst > 0 && c.mean > 0, JSON.stringify(c));   // the script goes deeper (160 vs 140 mm)
  assert.ok(Math.abs(c.worst - 20) < 3, `worst ${c.worst}`);
  assert.deepEqual(c.reversals, []);
  // the same video, the script half a stroke late: they move against each other the whole time; a quarter stroke
  // late: half the time (the halves where both go the same way break it up)
  const shifted = (ms) => script.map((a) => ({ ...a, at: a.at + ms })), span = (r) => r.reversals.reduce((a, x) => a + x.t1 - x.t0, 0);
  const half = compareDepth(track, shifted(500), RIG, 1000, 2000, 7000), quarter = compareDepth(track, shifted(250), RIG, 1000, 2000, 7000);
  assert.ok(span(half) > 4500, JSON.stringify(half.reversals));
  assert.ok(quarter.reversals.length >= 4 && span(quarter) > 1500 && span(quarter) < 3500 && quarter.reversals.every((x) => x.t1 - x.t0 >= 150), JSON.stringify(quarter.reversals));
  assert.equal(compareDepth(track, script, RIG, 1000, 8100, 9900), null, 'nothing trusted in the range');
  assert.equal(diffText(12), 'script 12 mm deeper than video'); assert.equal(diffText(-7.6), 'script 8 mm shallower than video');
  assert.equal(diffText(1), 'script matches video'); assert.equal(diffText(NaN), '');
});

test('insertedAt with a memo (insertedSeries) reads the same as without', () => {
  const T = Array.from({ length: 300 }, (_, i) => i * 33), pairs = (f) => T.map((t) => [t, f(t)]);
  const run = { id: 'r', range: { start: 0, end: 10000 }, scenes: [{ start_ms: 0, end_ms: 5000, shaft: { c1_penis: { source: 'sam', full: 'seen' } } }, { start_ms: 5000, end_ms: 10000, shaft: { c1_penis: { source: 'points', full: 'seen' } } }],
    channels: { sem_c1_penis_in: channelOf(pairs(inFrac)), sem_c1_penis_in_conf: channelOf(pairs(() => 0.8)), sem_c1_penis_len: channelOf(pairs((t) => 1 - inFrac(t))), sem_c1_penis_knot: channelOf(pairs(() => 1)) } };
  const memo = new Map();
  for (let t = 0; t < 9900; t += 70) assert.deepEqual(insertedAt(run, t, null, memo), insertedAt(run, t), `at ${t}`);
});
