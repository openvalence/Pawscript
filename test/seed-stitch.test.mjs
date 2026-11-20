// paw-o74b.1, lib/seed-stitch.js: one part tracked from several seed frames -> who owns which frames, and one series with
// no step at a handover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extent, ownership, stitch, STITCH } from '../src/lib/seed-stitch.js';

const FM = 1000 / 30, T = Array.from({ length: 301 }, (_, i) => i * FM);   // 0..10 s
const on = (f, a = -Infinity, b = Infinity) => T.map((t) => (t >= a && t <= b ? f(t) : NaN));
const truth = (t) => 0.5 + 0.1 * Math.sin((2 * Math.PI * t) / 800);   // a stroke: 1.25 Hz
const R = (o) => o.own.map((l) => l && l.map((r) => r.map(Math.round)));
const near = (t) => T.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), T[0]);

test('extent: the run of data through the seed frame, short gaps bridged', () => {
  const x = on(() => 1, 1000, 6000);
  for (let i = 90; i < 96; i++) x[i] = NaN;   // 200 ms gap at 3 s: bridged
  assert.deepEqual(extent(T, x, 2000).map((i) => Math.round(T[i])), [1000, 6000]);
  for (let i = 120; i < 150; i++) x[i] = NaN;   // 1 s gap at 4..5 s: the track ends there
  assert.deepEqual(extent(T, x, 2000).map((i) => Math.round(T[i])), [1000, 3967]);
  assert.deepEqual(extent(T, x, 5500).map((i) => Math.round(T[i])), [5000, 6000]);
  assert.equal(extent(T, on(() => NaN), 2000), null);
});

test('ownership: half way between seed frames; lost early -> the neighbour covers; a real gap stays', () => {
  const full = (t) => ({ t, v: { x: on(truth) } });
  let o = ownership(T, [full(1000), full(5000), full(9000)]);
  assert.deepEqual(R(o), [[[0, 3000]], [[3033, 6967]], [[7000, 10000]]], 'each frame to the nearest seed frame');
  assert.ok(o.hand.every((h, k) => h.b - h.a === 500 && Math.abs(h.h - [3000, 7000][k]) <= FM), 'a 500 ms cross-fade centred on the handover');
  o = ownership(T, [full(9000), full(1000)]);   // input order kept, time order used
  assert.deepEqual(R(o), [[[5000, 10000]], [[0, 4967]]]);
  // the first seed loses its points at 2 s (before the midpoint, 3 s): the second takes over where the first still holds
  o = ownership(T, [{ t: 1000, v: { x: on(truth, 0, 2000) } }, full(5000)]);
  const last = T.filter((t) => t <= 2000).at(-1);   // its last frame
  assert.deepEqual(o.hand.map((h) => [h.a, h.b]), [[last - 500, last]]);
  assert.deepEqual(R(o), [[[0, Math.round(last)]], [[Math.round(last + FM), 10000]]], 'the second covers from where the first stops');
  // the later seed lost before the end of the take: the earlier one, still holding, takes the end again
  o = ownership(T, [full(1000), { t: 5000, v: { x: on(truth, 2500, 5500) } }]);
  assert.deepEqual(R(o), [[[0, 3000], [5533, 10000]], [[3033, 5500]]]);
  assert.deepEqual(o.hand.map((h) => [Math.round(h.a), Math.round(h.b)]), [[2767, 3267], [5000, 5500]], 'each handover cross-faded inside the frames both hold');
  // neither reaches the other: a gap (NaN in the stitch)
  const g = stitch(T, [{ t: 1000, v: { x: on(truth, 0, 2000) } }, { t: 5000, v: { x: on(truth, 4000) } }]);
  assert.equal(g.hand[0].gap, true);
  T.forEach((t, i) => assert.equal(Number.isFinite(g.v.x[i]), t <= 2000 || t >= near(4000), `${t}`));
  // close seeds: the cross-fade is never longer than the distance between them
  o = ownership(T, [full(1000), full(1200)]);
  assert.ok(o.hand[0].b - o.hand[0].a <= 200 + 1e-9);
  assert.equal(STITCH.OVERLAP_MS, 500);
});

test('the stitch: each seed\'s constant offset removed, no step at a handover (velocity no larger than elsewhere); scale by ratio', () => {
  // two paintings of one part: centroids 0.03 apart, the second also drifts a little against the first while it turns
  const A = (t) => truth(t) + 0.03, B = (t) => truth(t) - 0.02 + 0.004 * Math.sin(t / 3000), Cc = (t) => truth(t) + 0.05;
  const s = stitch(T, [
    { t: 1000, v: { x: on(A), scale: on((t) => 1 + 0.2 * Math.sin(t / 900)), n: on(() => 1) } },
    { t: 5000, v: { x: on(B), scale: on((t) => 1.3 * (1 + 0.2 * Math.sin(t / 900))), n: on(() => 0.5) } },
    { t: 9000, v: { x: on(Cc), scale: on((t) => 0.8 * (1 + 0.2 * Math.sin(t / 900))), n: on(() => 0.5) } },
  ]);
  const x = s.v.x, vel = (i) => Math.abs(x[i + 1] - x[i - 1]) / (2 * FM);
  assert.ok(x.every(Number.isFinite));
  for (const h of s.hand) {
    const i = T.indexOf(near(h.h)), around = [];
    for (let j = i - 15; j <= i + 15; j++) around.push(vel(j));
    let elsewhere = 0;
    for (let j = 1; j < T.length - 1; j++) if (Math.abs(T[j] - h.h) > 1000) elsewhere = Math.max(elsewhere, vel(j));
    assert.ok(Math.max(...around) <= elsewhere * 1.02, `handover at ${Math.round(h.h)}: ${Math.max(...around)} vs ${elsewhere}`);
  }
  // the first seed's span is its own track; the later spans keep their own motion with the constant offset removed
  T.forEach((t, i) => { if (t < 2700) assert.ok(Math.abs(x[i] - A(t)) < 1e-12); });
  const err = T.map((t, i) => x[i] - (truth(t) + 0.03)), worst = Math.max(...err.map(Math.abs));
  assert.ok(worst < 0.01, `stays on the first painting's track to within the second one's own drift: ${worst}`);
  assert.ok(Math.abs(s.off[1].x - (-0.05)) < 0.006 && Math.abs(s.off[2].x - (0.02)) < 0.006, JSON.stringify(s.off.map((o) => o.x)));
  T.forEach((t, i) => assert.ok(Math.abs(s.v.scale[i] - (1 + 0.2 * Math.sin(t / 900))) < 1e-9, `scale at ${t}`));
  assert.ok(Math.abs(s.off[1].scale - 1.3) < 1e-9 && Math.abs(s.off[2].scale - 0.8 / 1.3 * 1.3) < 1e-9);
  // a share is cross-faded, never aligned
  assert.equal(s.v.n[0], 1); assert.equal(s.v.n[150], 0.5);
  const iMid = T.indexOf(near(s.hand[0].h));
  assert.ok(s.v.n[iMid] > 0.5 && s.v.n[iMid] < 1);
});

test('the stitch of one seed is that seed', () => {
  const x = on(truth, 2000, 7000), s = stitch(T, [{ t: 4000, v: { x } }]);
  T.forEach((t, i) => assert.ok(Number.isFinite(x[i]) ? s.v.x[i] === x[i] : !Number.isFinite(s.v.x[i])));
  assert.deepEqual(s.hand, []);
});
