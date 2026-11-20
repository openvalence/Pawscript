// Carrier (baseline / envelope) under a picked channel: spline, auto knots, points from channel − baseline, per-scene links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRun, newFrames } from '../src/lib/runs.js';
import { spline, autoKnots, pointsFromChannel, channelPatch, carriers, pickerChannels, carrierOn, camWeak, camChannel } from '../src/lib/runs-channel.js';

const dt = 1000 / 30;
const drift = (t) => 0.5 * Math.sin((Math.PI * t) / 10000);           // half a wave over a 10 s scene
const strokes = (t) => 0.1 * Math.sin((2 * Math.PI * t) / 1000);      // 1 Hz, small next to the drift
const mk = (f, { scenes = [], primary = 'auto', channel = 'g2_proj', dur = 10000 } = {}) => {
  const pr = [];
  for (let t = 0; t < dur; t += dt) pr.push([Math.round(t), f(t)]);
  return makeRun({ n: 1, tracker: { id: 'tapnext_points', name: 'TAPNext' }, params: { primary }, range: { start: 0, end: dur }, roi: null,
    result: { samples: pr.map(([t]) => [t, 0.5]), points: [{ at: 0, pos: 50 }], scenes, channels: { [channel]: pr } }, frames: newFrames(), runs: [] });
};
const rows = (p) => Array.from(p.at, (at, i) => [at, p.pos[i]]);
const spread = (xs) => Math.max(...xs) - Math.min(...xs);

test('spline: through the knots, a smooth carrier from knots 2 s apart, flat beyond the ends', () => {
  const k = [[0, 0], [1000, 10], [2000, 10], [3000, 0]], f = spline(k);
  for (const [t, v] of k) assert.ok(Math.abs(f(t) - v) < 1e-9);
  assert.equal(f(-500), 0); assert.equal(f(9000), 0);
  const g = spline([0, 2000, 4000, 6000, 8000, 10000].map((t) => [t, drift(t)]));
  for (let t = 1000; t <= 9000; t += 100) assert.ok(Math.abs(g(t) - drift(t)) < 0.02, `carrier at ${t}: ${g(t)} vs ${drift(t)}`);
  assert.equal(spline([[5, 7]])(100), 7);
  assert.ok(Number.isNaN(spline([])(0)));
  assert.ok(Math.abs(spline([[2000, 1], [0, 0]])(1000) - 0.5) < 1e-9, 'unsorted knots');
});

test('autoKnots: midpoints of consecutive extremes follow the drift; one knot per ~2 s, at least 3', () => {
  const x = { i0: 0, dt, v: Float32Array.from({ length: 300 }, (_, k) => drift(k * dt) + strokes(k * dt)) };
  const mid = autoKnots(x, 5000, 'mid');
  assert.equal(mid.length, 6);
  assert.equal(mid[0][0], 5000); assert.equal(mid[5][0], 5000 + Math.round(299 * dt));
  for (const [t, v] of mid) assert.ok(Math.abs(v - drift(t - 5000)) < 0.06, `knot at ${t}: ${v} vs ${drift(t - 5000)}`);
  const top = autoKnots(x, 0, 'top'), bot = autoKnots(x, 0, 'bottom');
  for (let i = 1; i < 5; i++) assert.ok(top[i][1] - bot[i][1] > 0.15 && top[i][1] - bot[i][1] < 0.25, 'envelope ~ 2 x stroke amplitude');
  const short = autoKnots({ i0: 0, dt, v: Float32Array.from({ length: 20 }, (_, k) => k) }, 0);
  assert.equal(short.length, 3, 'a short scene still gets 3 knots (no extremes: window means)');
  assert.deepEqual(autoKnots({ i0: 0, dt, v: new Float32Array(5).fill(NaN) }, 0), []);
});

test('baseline auto: the strokes stop following the drift; off = as before', () => {
  const run = mk((t) => drift(t) + strokes(t));
  const off = pointsFromChannel(run, 'g2_proj', { fit: 'scene' }), on = pointsFromChannel(run, 'g2_proj', { fit: 'scene', baseline: { mode: 'auto' } });
  assert.deepEqual(rows(pointsFromChannel(run, 'g2_proj', { fit: 'scene', baseline: { mode: 'off' } })), rows(off));
  const tops = (p) => rows(p).filter(([t]) => t > 1500 && t < 8500 && Math.abs(((t % 1000) + 1000) % 1000 - 250) < 60).map(([, v]) => v);
  assert.ok(tops(off).length >= 6 && tops(on).length >= 6);
  assert.ok(spread(tops(off)) > 20,`without a baseline the tops ride the drift: ${spread(tops(off))}`);
  assert.ok(spread(tops(on)) < 15, `with it they line up: ${spread(tops(on))}`);
  // default fit (the run's range): the strokes sit around the middle, as small as tracked
  const mid = rows(pointsFromChannel(run, 'g2_proj', { baseline: { mode: 'auto' } })).filter(([t]) => t > 1500 && t < 8500).map(([, v]) => v);
  assert.ok(Math.min(...mid) > 25 && Math.max(...mid) < 75, `around 50: ${Math.min(...mid)}..${Math.max(...mid)}`);
});

test('baseline knots: the user curve is used; moving a knot only changes points near it', () => {
  const run = mk((t) => drift(t) + strokes(t)), knots = [0, 2000, 4000, 6000, 8000, 10000].map((t) => [t, drift(t)]);
  const a = rows(pointsFromChannel(run, 'g2_proj', { baseline: { mode: 'knots', knots } }));
  const auto = rows(pointsFromChannel(run, 'g2_proj', { baseline: { mode: 'auto' } }));
  assert.equal(a.length, auto.length);
  a.forEach(([t, v], i) => assert.ok(Math.abs(t - auto[i][0]) <= 10 && Math.abs(v - auto[i][1]) <= 6, `exact drift knots ~ auto at ${t}: ${v} vs ${auto[i]}`));
  const moved = knots.map(([t, v]) => [t, t === 8000 ? v + 0.2 : v]);
  const b = rows(pointsFromChannel(run, 'g2_proj', { baseline: { mode: 'knots', knots: moved } }));
  assert.deepEqual(b.filter(([t]) => t < 3900), a.filter(([t]) => t < 3900), 'far from the knot: unchanged');
  assert.notDeepEqual(b.filter(([t]) => t > 7000), a.filter(([t]) => t > 7000));
  assert.ok(!carrierOn({ baseline: { mode: 'knots', knots: [] } }) && carrierOn({ baseline: { mode: 'auto' } }) && carrierOn({ envelope: { mode: 'auto' } }));
});

test('envelope auto: growing strokes become full strokes all scene long', () => {
  const run = mk((t) => 0.3 + (0.02 + 0.25 * (t / 10000)) * Math.sin((2 * Math.PI * t) / 1000));
  const inner = (p) => rows(p).filter(([t]) => t > 1000 && t < 9000);
  const plain = inner(pointsFromChannel(run, 'g2_proj'));
  assert.ok(plain.filter(([t]) => t < 3000).every(([, v]) => v > 20 && v < 80), 'as tracked the early strokes are small');
  const env = inner(pointsFromChannel(run, 'g2_proj', { envelope: { mode: 'auto' } }));
  const hi = env.filter(([, v]) => v >= 85).length, lo = env.filter(([, v]) => v <= 15).length;
  assert.ok(hi >= 6 && lo >= 6 && hi + lo >= env.length - 2, `full strokes: ${hi} tops, ${lo} bottoms of ${env.length}`);
});

test('per-scene links: only the linked scene takes its carrier out; carriers() draws the same curve; sidecar primary too', () => {
  const scenes = [{ start_ms: 0, end_ms: 5000, sign: 1 }, { start_ms: 5000, end_ms: 10000, sign: 1 }];
  const run = mk((t) => drift(t) + strokes(t), { scenes });
  const plain = channelPatch(run, 'g2_proj', { fit: 'scene' });
  const links = [{ t0: 5000, t1: 10000, run: 'run1', channel: 'g2_proj', fit: { fit: 'scene' }, baseline: { mode: 'auto' } }];
  const withB = channelPatch(run, 'g2_proj', { fit: 'scene' }, links);
  assert.deepEqual(rows(withB.points0).filter(([t]) => t < 5000), rows(plain.points0).filter(([t]) => t < 5000));
  assert.notDeepEqual(rows(withB.points0).filter(([t]) => t >= 5000), rows(plain.points0).filter(([t]) => t >= 5000));
  const cs = carriers(run, links, { fit: 'scene' });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].i, 1); assert.equal(cs[0].link, links[0]); assert.equal(cs[0].top, null);
  assert.ok(cs[0].mid.length >= 3 && cs[0].mid.every(([t]) => t >= 5000 && t <= 10000));
  assert.deepEqual(carriers(run, [{ ...links[0], baseline: { mode: 'off' } }]), []);
  // the sidecar's own primary channel: its points are the sidecar's, unless the scene takes a carrier out
  const prim = mk((t) => drift(t) + strokes(t), { scenes, primary: 'g2_proj' });
  assert.equal(channelPatch(prim, 'g2_proj').points0, prim.points0);
  assert.notEqual(channelPatch(prim, 'g2_proj', {}, links).points0, prim.points0);
});

test('pickerChannels: primary, then the motion-group set in order; else every channel', () => {
  const ch = (names) => ({ channels: Object.fromEntries(names.map((n) => [n, {}])) });
  assert.deepEqual(pickerChannels(ch(['cam_y', 'g2_proj', 'g1_n', 'pair_proj', 'g1_proj', 'cam_x', 'pair_dist'])), ['primary', 'g1_proj', 'g2_proj', 'pair_proj', 'cam_x', 'cam_y']);
  assert.deepEqual(pickerChannels(ch(['area', 'raw_px'])), ['primary', 'area', 'raw_px']);
  assert.deepEqual(pickerChannels(null), ['primary']);
  assert.deepEqual(pickerChannels(ch(['g1_proj', 'raw_px_cam', 'proj_cam', 'cam_conf'])), ['primary', 'proj_cam', 'g1_proj']);
});

test('camWeak: mean cam_conf under 0.3 greys the camera-removed chips (proj_cam, g*, pair)', () => {
  const run = (v) => ({ channels: v ? { cam_conf: { v: Float32Array.from(v) } } : {} });
  assert.equal(camWeak(run([0, 0.2, NaN, 0.4])), true);
  assert.equal(camWeak(run([0.5, 0.2, 0.3])), false);
  assert.equal(camWeak(run(null)), false, 'no cam_conf: not weak');
  assert.equal(camWeak(null), false);
  assert.ok(camChannel('proj_cam') && camChannel('g3_proj') && camChannel('pair_proj'));
  assert.ok(!camChannel('primary') && !camChannel('cam_x') && !camChannel('proj'));
});
