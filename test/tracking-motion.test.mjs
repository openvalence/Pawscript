import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraMotion, lowMotion, motionStats, statWindows, turnTimes, resample } from '../src/features/tracking/motion.js';
import { channelOf } from '../src/lib/runs.js';

const fps = 30, N = 300;
const T = Float64Array.from({ length: N }, (_, i) => Math.round((i * 1000) / fps));
const ser = (f) => ({ t: T, v: Float32Array.from(T, (t, i) => f(t / 1000, i)) });
// deterministic noise
let seed = 3; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
const pan = (s) => 0.5 + 0.4 * Math.sin(2 * Math.PI * 0.4 * s);          // slow camera sway
const local = (s) => 0.5 + 0.45 * Math.sin(2 * Math.PI * 1.7 * s);       // the stroke
const run = (f, scenes = [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 10000 }]) => ({ samples: ser(f), scenes });

test('cameraMotion: a run that follows the camera is flagged', () => {
  const ref = { samples: ser((s) => pan(s) + 0.01 * rnd()) };
  const r = cameraMotion(run((s) => pan(s) + 0.02 * rnd()), ref);
  assert.ok(r.flag, JSON.stringify(r)); assert.ok(r.score > 0.8); assert.ok(r.together > 0.6);
  // flipped in one scene (pipe_sign): still the camera
  const flipped = cameraMotion(run((s, i) => (i < 150 ? pan(s) : 1 - pan(s)) + 0.02 * rnd()), ref);
  assert.ok(flipped.flag, JSON.stringify(flipped));
});

test('cameraMotion: local motion on a static or panning camera is not flagged', () => {
  const still = { samples: ser(() => 0.5 + 0.02 * rnd()) };
  const a = cameraMotion(run((s) => local(s) + 0.02 * rnd()), still);
  assert.ok(!a.flag && a.score < 0.3, JSON.stringify(a));
  const panning = { samples: ser((s) => pan(s) + 0.01 * rnd()) };
  const b = cameraMotion(run((s) => local(s) + 0.02 * rnd()), panning);
  assert.ok(!b.flag, JSON.stringify(b));
});

test('cameraMotion: no primary signal -> null', () => {
  assert.equal(cameraMotion({ samples: { t: new Float64Array(0), v: new Float32Array(0) } }, { samples: ser(pan) }), null);
  assert.equal(cameraMotion(run(pan), null), null);
  assert.equal(cameraMotion(run(() => NaN), { samples: ser(pan) }), null);
});

test('resample: linear, NaN outside and across gaps', () => {
  const r = resample({ t: [0, 100, 200], v: [0, 1, NaN] }, [0, 50, 100, 150, 300]);
  assert.deepEqual(Array.from(r).map((x) => (Number.isNaN(x) ? 'nan' : x)), [0, 0.5, 1, 'nan', 'nan']);
});

test('lowMotion: raw_px channel, centroid channels, overlay frames', () => {
  const pairs = (f) => Array.from(T, (t, i) => [t, f(i)]);
  // a wall: lk_box raw_px wobbling by ~1.8 px -> low
  const wall = lowMotion({ channels: { raw_px: channelOf(pairs((i) => 0.9 * Math.sin(i / 5))) } }, { width: 640, height: 360 });
  assert.equal(wall.source, 'raw_px'); assert.ok(wall.low && wall.px > 1.5 && wall.px < 2, JSON.stringify(wall));
  const moving = lowMotion({ channels: { raw_px: channelOf(pairs((i) => 40 * Math.sin(i / 5))) } }, {});
  assert.ok(!moving.low && moving.px > 70);
  const cen = lowMotion({ channels: { centroid_x: channelOf(pairs(() => 0.5)), centroid_y: channelOf(pairs((i) => 0.5 + 0.1 * Math.sin(i / 5))) } }, { width: 640, height: 360 });
  assert.equal(cen.source, 'centroid'); assert.ok(!cen.low && cen.px > 60);
  const ov = Array.from(T, (_, i) => ({ points: [[0.3, 0.4 + 0.002 * Math.sin(i / 4)], [0.32, 0.42 + 0.002 * Math.sin(i / 4)]], boxes: [] }));
  const o = lowMotion({ channels: {}, frames: { t: Array.from(T), ov } }, { width: 640, height: 360 });
  assert.equal(o.source, 'overlay'); assert.ok(o.low && o.px < 2, JSON.stringify(o));
  const box = Array.from(T, (_, i) => ({ boxes: [[0.4, 0.3 + 0.1 * Math.sin(i / 4), 0.1, 0.1]] }));
  assert.ok(!lowMotion({ channels: {}, frames: { t: Array.from(T), ov: box } }, { width: 640, height: 360 }).low);
  assert.equal(lowMotion({ channels: {} }, { width: 640, height: 360 }), null);
});

test('turnTimes and motionStats', () => {
  const pts = [];
  for (let k = 0; k < 20; k++) pts.push({ at: 500 + k * 250, pos: k % 2 ? 90 : 10 });   // 500..5250, a turn every 250 ms
  pts.push({ at: 5500, pos: 10 }, { at: 9000, pos: 10 });                              // hold to 9 s
  for (let k = 0; k < 4; k++) pts.push({ at: 9300 + k * 300, pos: k % 2 ? 80 : 20 });
  const at = Float64Array.from(pts, (p) => p.at), pos = Float64Array.from(pts, (p) => p.pos);
  assert.equal(turnTimes({ at, pos })[0], 750);
  const w = statWindows([{ start_ms: 0, end_ms: 6000 }, { start_ms: 6000, end_ms: 12000 }, { start_ms: 12000, end_ms: 20000 }], 0, 11000);
  assert.deepEqual(w, [{ t0: 0, t1: 6000 }, { t0: 6000, t1: 11000 }]);
  const [a, b] = motionStats({ at, pos }, w);
  assert.ok(a.turns >= 18 && a.turns <= 20, JSON.stringify(a));
  assert.ok(Math.abs(a.strokesPerMin - (a.turns / 2) * 10) < 1e-9);
  assert.ok(a.regularity > 0.95);
  assert.equal(a.idle.length, 0);
  assert.equal(b.idle.length, 1); assert.equal(b.idle[0].t0, 6000);
  assert.ok(b.idleMs >= 3000);
  assert.deepEqual(statWindows([], 100, 200), [{ t0: 100, t1: 200 }]);
});
