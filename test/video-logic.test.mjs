// Pure logic of the video feature: frame clock (CFR rational + VFR table), probing steps, seek coalescing,
// view transform maths, loop boundaries, the interpolated clock, simulator maths, LRU, waveform pyramid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rational, snapFps, makeClock, seekTimeOf, probeForward, probeBack, loopShouldWrap, stopLookahead, loopStart, interpolate,
  fmtMs, fmtTimecode, parseTime, fmtTime, TOL_MS } from '../src/features/video/frames.js';
import { SeekQueue } from '../src/features/video/seek.js';
import { DEFAULT_VIEW, viewMatrix, apply, invert, toNorm, fromNorm, zoomAround, panView, rotateView, zoomPercent, scaleOf } from '../src/features/video/view.js';
import { simAt, speedColor, windowRange, SPEED_RAMP, SPEED_OVER } from '../src/features/video/sim.js';
import { LRU } from '../src/features/video/preview.js';
import { buildPyramid, peaks, pyramidFrom } from '../src/features/video/waveform.js';
import { posAt } from '../src/lib/core/script.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('rational recognises NTSC rates and integers', () => {
  assert.deepEqual(rational(29.97002997), { num: 30000, den: 1001 });
  assert.deepEqual(rational(29.97), { num: 30000, den: 1001 });
  assert.deepEqual(rational(23.976), { num: 24000, den: 1001 });
  assert.deepEqual(rational(59.94), { num: 60000, den: 1001 });
  assert.deepEqual(rational('30000/1001'), { num: 30000, den: 1001 });
  assert.deepEqual(rational(25), { num: 25, den: 1 });
  assert.deepEqual(rational(12.5), { num: 12500, den: 1000 });
  assert.equal(rational(0), null);
  assert.equal(rational(undefined), null);
});

test('snapFps snaps measured rates to common ones', () => {
  close(snapFps(1000 / 33.4), 30000 / 1001);
  assert.equal(snapFps(1000 / 41.6), 24);
  assert.equal(snapFps(1000 / 16.6), 60);
  assert.equal(snapFps(37), 37);
});

test('CFR 30000/1001: frame <-> time exact over an hour, no drift', () => {
  const c = makeClock({ fps: 29.97, durationMs: 3600 * 1000 });
  assert.equal(c.count, 107892);
  for (const k of [0, 1, 2, 1000, 17982, 53946, 107891]) {
    const t = c.timeOf(k);
    close(t, (k * 1001) / 30);
    assert.equal(c.frameAt(t), k, 'pts -> own frame');
    assert.equal(c.frameAt(seekTimeOf(c, k)), k, 'mid-frame seek target');
    assert.equal(c.frameAt(Math.round(t)), k, 'integer-ms action time maps back to its frame');
    assert.equal(c.frameAt(c.endOf(k) - 1), k);
    if (k < c.count - 1) assert.equal(c.frameAt(c.endOf(k)), k + 1);
  }
  // the hour mark: 107892 frames of 1001/30 ms, exact per index (no summing)
  close(c.timeOf(107892), 3599996.4, 1e-6);
});

test('CFR integer rates and clamping', () => {
  for (const fps of [24, 25, 30, 60]) {
    const c = makeClock({ fps, durationMs: 10000 });
    assert.equal(c.count, 10000 * fps / 1000);
    assert.equal(c.frameAt(-50), 0);
    assert.equal(c.frameAt(99999), c.count - 1);
    assert.equal(c.frameAt(seekTimeOf(c, c.count - 1)), c.count - 1);
    assert.ok(seekTimeOf(c, c.count - 1) < 10000, 'last frame target inside duration');
    assert.equal(seekTimeOf(c, 10 ** 9), seekTimeOf(c, c.count - 1));
    assert.equal(seekTimeOf(c, -3), seekTimeOf(c, 0));
  }
});

test('integer-ms rounding of 60 and 120 fps frames still maps back', () => {
  for (const fps of [60, 59.94, 120]) {
    const c = makeClock({ fps, durationMs: 60000 });
    for (let k = 0; k < c.count; k += 7) assert.equal(c.frameAt(Math.round(c.timeOf(k))), k, `fps ${fps} k ${k}`);
  }
});

test('VFR table clock', () => {
  // the harness's vfr.mp4: 60 frames at 30 fps, 30 at 10 fps, 60 at 60 fps
  const times = [];
  for (let n = 0; n < 150; n++) times.push(n < 60 ? (n * 1000) / 30 : n < 90 ? 2000 + (n - 60) * 100 : 5000 + ((n - 90) * 1000) / 60);
  const c = makeClock({ times, durationMs: 6000 });
  assert.equal(c.count, 150);
  close(c.minFrameMs, 1000 / 60, 1e-9);
  for (let k = 0; k < 150; k++) {
    assert.equal(c.frameAt(c.timeOf(k)), k);
    assert.equal(c.frameAt(seekTimeOf(c, k)), k);
    assert.equal(c.frameAt(Math.round(c.timeOf(k))), k);
  }
  assert.equal(c.frameAt(2950), 69);
  close(c.endOf(149), 6000);
});

test('probing steps never skip a VFR frame', () => {
  const times = [];
  for (let n = 0; n < 150; n++) times.push(n < 60 ? (n * 1000) / 30 : n < 90 ? 2000 + (n - 60) * 100 : 5000 + ((n - 90) * 1000) / 60);
  const c = makeClock({ times, durationMs: 6000 });
  const delta = Math.min(c.minFrameMs, 1000 / 120);
  for (let k = 0; k < 149; k++) {
    let n = 1, f;
    while ((f = c.frameAt(probeForward(c.timeOf(k), delta, n))) === k) n++;
    assert.equal(f, k + 1, `forward from ${k}`);
  }
  for (let k = 1; k < 150; k++) assert.equal(c.frameAt(probeBack(c.timeOf(k), delta)), k - 1, `back from ${k}`);
});

test('seek queue coalesces to the latest request', () => {
  const q = new SeekQueue();
  assert.equal(q.request(100), 100);
  assert.equal(q.request(200), null);
  assert.equal(q.request(300), null);
  assert.equal(q.request(400), null);
  assert.equal(q.latest, 400);
  assert.equal(q.settle(), 400, 'only the newest is issued next');
  assert.equal(q.busy, true);
  assert.equal(q.settle(), null);
  assert.equal(q.busy, false);
  assert.equal(q.issued, 2);
  assert.equal(q.dropped, 2);
  assert.equal(q.request(5), 5);
  q.reset();
  assert.equal(q.busy, false);
});

test('view: fit centres, 100% is device-pixel exact, inverse round-trips', () => {
  const m = viewMatrix(DEFAULT_VIEW, 1000, 500, 640, 360, 1);
  close(m.s, 500 / 360);
  const [x0, y0] = apply(m, 0, 0), [x1, y1] = apply(m, 640, 360);
  close(y0, 0, 1e-9); close(y1, 500, 1e-9); close((x0 + x1) / 2, 500, 0.5);
  const one = viewMatrix({ ...DEFAULT_VIEW, mode: '1:1' }, 1001, 501, 640, 360, 1.5);
  close(zoomPercent(one, 1.5), 100);
  const [ex, ey] = apply(one, 0, 0);
  close(Math.round(ex * 1.5), ex * 1.5, 1e-9); close(Math.round(ey * 1.5), ey * 1.5, 1e-9);
  for (const v of [DEFAULT_VIEW, { ...DEFAULT_VIEW, rot: 90 }, { ...DEFAULT_VIEW, rot: 270, flipH: true }, { ...DEFAULT_VIEW, mode: 'custom', zoom: 3, panX: 40, panY: -12, flipV: true }]) {
    const mm = viewMatrix(v, 800, 600, 640, 360, 2);
    const [X, Y] = fromNorm(mm, 640, 360, 0.3, 0.7), [nx, ny] = toNorm(mm, 640, 360, X, Y);
    close(nx, 0.3, 1e-9); close(ny, 0.7, 1e-9);
    const [px, py] = invert(mm, ...apply(mm, 12, 34));
    close(px, 12, 1e-9); close(py, 34, 1e-9);
  }
});

test('view: rotation and flips put corners where expected', () => {
  const m = viewMatrix({ ...DEFAULT_VIEW, rot: 90 }, 360, 640, 640, 360, 1);   // portrait stage fits rotated video exactly
  const tl = apply(m, 0, 0);
  close(tl[0], 360, 1e-9); close(tl[1], 0, 1e-9);   // video top-left goes to the stage's top-right
  const f = viewMatrix({ ...DEFAULT_VIEW, flipH: true }, 640, 360, 640, 360, 1);
  const p = apply(f, 0, 0); close(p[0], 640, 1e-9); close(p[1], 0, 1e-9);
  assert.equal(rotateView({ rot: 270 }, 1).rot, 0);
  assert.equal(rotateView({ rot: 0 }, -1).rot, 270);
});

test('view: zoom around the cursor keeps the pixel under it, pan clamps', () => {
  const cw = 900, ch = 500, vw = 640, vh = 360;
  let v = DEFAULT_VIEW;
  const cursor = [700, 120];
  const before = toNorm(viewMatrix(v, cw, ch, vw, vh, 1), vw, vh, ...cursor);
  for (const f of [1.25, 1.25, 2, 0.8]) {
    v = zoomAround(v, cw, ch, vw, vh, ...cursor, f, 1);
    const after = toNorm(viewMatrix(v, cw, ch, vw, vh, 1), vw, vh, ...cursor);
    close(after[0], before[0], 2e-3); close(after[1], before[1], 2e-3);   // within the 1-device-px snap
  }
  assert.equal(v.mode, 'custom');
  const far = panView(v, cw, ch, vw, vh, 1e6, -1e6, 1);
  const m = viewMatrix(far, cw, ch, vw, vh, 1), [l] = apply(m, 0, 0);
  assert.ok(l <= cw - 48 + 1, 'at least 48 px of video stay on stage');
  close(scaleOf({ ...DEFAULT_VIEW, mode: 'custom', zoom: 1e9 }, cw, ch, vw, vh, 1), 32);
});

test('loop boundaries', () => {
  const fm = 1000 / 24, loop = { t0: 1000, t1: 2000 };
  const last = Math.floor(2000 / fm - 1e-9) * fm;           // frame 47 at 1958.33 is the loop's last
  assert.equal(loopShouldWrap(last, fm, loop), true);
  assert.equal(loopShouldWrap(last - fm, fm, loop), false);
  assert.equal(loopShouldWrap(2000, fm, loop), true, 'ran past the out point');
  assert.equal(loopShouldWrap(5000, fm, loop), false, 'seeked far past: no wrap');
  assert.equal(loopShouldWrap(500, fm, loop), false, 'before the loop');
  assert.equal(loopShouldWrap(last, fm, null), false);
  assert.equal(loopStart(1500, loop), 1500);
  assert.equal(loopStart(2500, loop), 1000);
  assert.equal(loopStart(0, loop), 1000);
  assert.equal(loopStart(0, null), 0);
});

test('loop lookahead: real VFR frame length, skipped frames, the committed vsync frame', () => {
  // vfr.mp4 table, loop [1500, 2500): frame 64 (2400..2500) is 100 ms long while the clock averages ~40 ms
  const times = [];
  for (let n = 0; n < 150; n++) times.push(n < 60 ? (n * 1000) / 30 : n < 90 ? 2000 + (n - 60) * 100 : 5000 + ((n - 90) * 1000) / 60);
  const v = makeClock({ times, durationMs: 6000 }), loop = { t0: 1500, t1: 2500 };
  assert.equal(loopShouldWrap(2400, v.frameMs, loop), false, 'the average frame length misses the wrap (old bug: frame 65 shown)');
  assert.equal(loopShouldWrap(2400, stopLookahead(v, 64, 2400), loop), true);
  assert.equal(loopShouldWrap(2300, stopLookahead(v, 63, 2300, 100, 1, 16.7), loop), false, 'one frame early: no wrap');
  // 60 fps at 2x on a 120 Hz display (lead 8.3 ms), loop frames 108..155
  const c = makeClock({ fps: 60, durationMs: 6000 }), lp = { t0: 1800, t1: 2600 }, L = 8.3;
  const wraps = (k, adv, rate, lead) => loopShouldWrap(c.timeOf(k), stopLookahead(c, k, c.timeOf(k), adv, rate, lead), lp);
  assert.equal(wraps(154, c.frameMs, 2, 0), false, 'no lead: the committed frame 156 would show');
  assert.equal(wraps(154, c.frameMs, 2, L), true);
  assert.equal(wraps(153, 2 * c.frameMs, 2, L), true, 'callback for 154/155 may be dropped: wrap from 153');
  // 24 fps at 4x, 120 Hz: callbacks 89 -> 91 were seen (90 dropped); the wrap must go out at 89
  const f = makeClock({ fps: 24, durationMs: 10000 }), l24 = { t0: 3000, t1: 3792 };   // frames 72..90
  assert.equal(loopShouldWrap(f.timeOf(89), stopLookahead(f, 89, f.timeOf(89), f.frameMs, 4, L), l24), true);
  // at 1x the lead never wraps a frame early (24 and 30 fps at 60 Hz, 60 fps at 120 Hz)
  for (const [fps, lead] of [[24, 16.7], [30, 16.7], [60, 8.3]]) {
    const g = makeClock({ fps, durationMs: 10000 }), b = 100, lp2 = { t0: 0, t1: Math.round(g.timeOf(b)) };
    const w = (k) => loopShouldWrap(g.timeOf(k), stopLookahead(g, k, g.timeOf(k), g.frameMs, 1, lead), lp2);
    assert.equal(w(b - 2), false, `${fps} fps early`);
    assert.equal(w(b - 1), true, `${fps} fps last`);
  }
  // playRange parks on the range's last frame, frameAt(t1 - 2 TOL). At 30000/1001 frame 15 starts at 500.5, so
  // t1 = 501 (rounded up by 0.5) is its start: the old target frameAt(t1 - 1) parked on 15, outside the range
  const n = makeClock({ fps: 29.97, durationMs: 60000 });
  close(n.timeOf(15), 500.5, 1e-9);
  assert.equal(n.frameAt(501 - 1), 15, 'old park target: outside the range');
  assert.equal(n.frameAt(501 - 2 * TOL_MS), 14);
  assert.equal(loopShouldWrap(n.timeOf(14), stopLookahead(n, 14, n.timeOf(14)), { t0: 0, t1: 501 }), true, 'and 14 is where the loop wraps');
  // a seek (big jump) is not a playback advance; at 4x a 6-frame advance still is
  close(stopLookahead(c, 10, c.timeOf(10), 900), c.frameMs, 1e-9);
  close(stopLookahead(c, 10, c.timeOf(10), 6 * c.frameMs, 4), 6 * c.frameMs, 1e-9);
});

test('interpolated clock: exact when paused, bounded while playing', () => {
  assert.equal(interpolate({ ms: 500, perf: 100, rate: 1, playing: false }, 9999, 50), 500);
  assert.equal(interpolate({ ms: 500, perf: 100, rate: 1, playing: true }, 120, 50), 520);
  assert.equal(interpolate({ ms: 500, perf: 100, rate: 0.5, playing: true }, 120, 50), 510);
  assert.equal(interpolate({ ms: 500, perf: 100, rate: 1, playing: true }, 90, 50), 500, 'before display: frame time');
  assert.equal(interpolate({ ms: 500, perf: 100, rate: 1, playing: true }, 900, 50), 550, 'stalled: capped');
});

test('timecode formatting and parsing', () => {
  assert.equal(fmtMs(83456), '1:23.456');
  assert.equal(fmtMs(3723004), '1:02:03.004');
  assert.equal(fmtTimecode(30 * 3661 + 7, 30), '01:01:01:07');
  assert.equal(fmtTimecode(30, 29.97), '00:00:01:00');
  assert.deepEqual(parseTime('1:23.456'), { ms: 83456 });
  assert.deepEqual(parseTime('1:02:03.5'), { ms: 3723500 });
  assert.deepEqual(parseTime('83.4'), { ms: 83400 });
  assert.deepEqual(parseTime('83,4s'), { ms: 83400 });
  assert.deepEqual(parseTime('1200ms'), { ms: 1200 });
  assert.deepEqual(parseTime('#120'), { frame: 120 });
  assert.deepEqual(parseTime('120f'), { frame: 120 });
  assert.deepEqual(parseTime('00:00:02:05', 25), { frame: 55 });
  assert.deepEqual(parseTime('+10f'), { frame: 10, rel: true });
  assert.deepEqual(parseTime('-2s'), { ms: -2000, rel: true });
  assert.equal(parseTime('abc'), null);
  const c = makeClock({ fps: 25, durationMs: 10000 });
  assert.equal(fmtTime('frames', 1000, c), '25');
  assert.equal(fmtTime('tc', 1000, c), '00:00:01:00');
  assert.equal(fmtTime('ms', 1000, c), '0:01.000');
});

test('simulator: position is exactly posAt, speed per segment, colour ramp', () => {
  const s = [{ at: 0, pos: 0 }, { at: 500, pos: 100 }, { at: 1000, pos: 20 }, { at: 1200, pos: 20 }];
  for (const t of [-10, 0, 1, 250, 499, 500, 777, 1100, 5000]) close(simAt(s, t).pos, posAt(s, t));
  assert.equal(simAt(s, 250).speed, 200); assert.equal(simAt(s, 250).dir, 1);
  assert.equal(simAt(s, 750).speed, 160); assert.equal(simAt(s, 750).dir, -1);
  assert.equal(simAt(s, 1100).speed, 0);
  assert.equal(simAt(s, 5000).speed, 0);
  assert.ok(Number.isNaN(simAt([], 5).pos));
  assert.equal(speedColor(0), SPEED_RAMP[0]);
  assert.equal(speedColor(399, 400), SPEED_RAMP[8]);
  assert.equal(speedColor(401, 400), SPEED_OVER);
  assert.deepEqual(windowRange(s, 600, 900), [1, 3]);
  assert.deepEqual(windowRange(s, -100, 5000), [0, 4]);
});

test('LRU evicts least recently used', () => {
  const ev = [];
  const c = new LRU(2, (v) => ev.push(v));
  c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3);
  assert.equal(c.has('b'), false); assert.equal(c.get('a'), 1); assert.equal(c.get('c'), 3);
  assert.deepEqual(ev, [2]);
  c.set('a', 9); assert.deepEqual(ev, [2, 1]);
  c.clear(); assert.equal(c.size, 0);
});

test('waveform pyramid and column peaks', async () => {
  const sr = 8000, n = sr * 3, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (i >= sr && i < 2 * sr ? 0.8 : 0.1) * Math.sin(i / 3);
  const p = await buildPyramid(x, sr, { base: 64, chunk: 4096 });
  assert.equal(p.levels[0].min.length, Math.ceil(n / 64));
  for (let i = 1; i < p.levels.length; i++) assert.equal(p.levels[i].per, p.levels[i - 1].per * 2);
  const pk = peaks(p, 0, 3000, 30);
  assert.ok(pk.max[5] < 0.11 && pk.max[15] > 0.75 && pk.max[25] < 0.11);
  assert.ok(pk.min[15] < -0.75);
  const q = pyramidFrom(p.levels[0].min, p.levels[0].max, sr, 64);
  assert.equal(q.levels.length, p.levels.length);
});
