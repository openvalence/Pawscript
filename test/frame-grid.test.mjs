// paw-kxz4: ONE frame grid, the player's clock: lane.js frame helpers driven by the clock (exact rationals, and the file's own frame
// table when its frames are not where the probed rate puts them: an owner clip, first frame 66 ms in, a dropped frame,
// probe 69480/2317), loops / repeats / cuts on its frame starts, pass pairing by picture, edges re-snapped, points never moved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, offGridTable } from '../src/features/video/frames.js';
import { frameAt, frameTime, frameStartOf, timeInFrame } from '../src/lib/lane.js';
import { toFrame, nudgeEdge, snapToFrames, loopInfo, periodOf } from '../src/features/timeline/loops.js';
import { indexRepeats } from '../src/features/timeline/repeats.js';
import { passGeom, pickTicks } from '../src/features/timeline/loop-marks.js';
import { occurrenceAtTime } from '../src/features/tracking/repeat-groups.js';
import { edgesOnFrames } from '../src/features/timeline/scenes.js';
import { autoLoops } from '../src/features/timeline/repeat-scenes.js';
import { parse, serialize } from '../src/lib/io/index.js';

/** An owner clip's structure (its cached frame table, numbers only): 30 fps pts, first frame at 66.016 ms, frame 40 missing
 *  (a 66.7 ms step), 2316 frames; the probe says 69480/2317 (nb_frames over a duration that counts the gap). */
const lateTimes = (n = 2316) => Array.from({ length: n }, (_, i) => Math.round((66.016 + (i + (i >= 40 ? 1 : 0)) * 1000 / 30) * 1000) / 1000);
const lateClock = () => makeClock({ times: offGridTable(lateTimes(), makeClock({ fps: '69480/2317' })), durationMs: 77372 });

test('index <-> time agrees with the clock for every rate over 200k frames (frame starts land in their own frame)', () => {
  for (const fps of [30, '30000/1001', '69480/2317', 29.986, 44.95, 45, '60000/1001', 24, 12.5]) {
    const c = makeClock({ fps, durationMs: 1e10 });
    for (let n = 0; n < 200000; n++) {
      const t = frameTime(n, c);
      assert.equal(frameAt(t, c), n, `${fps}: frame ${n} starts at ${t}`);
      assert.equal(c.frameAt(t), n, `${fps}: the clock agrees on ${n}`);
      assert.equal(frameAt(t - 1.2, c), n - 1, `${fps}: 1.2 ms before ${n} is the frame before`);
    }
    assert.equal(frameAt(1e9, c), c.frameAt(1e9));
  }
  const g = lateClock();
  for (let n = 0; n < g.count; n++) assert.equal(frameAt(frameTime(n, g), g), n, `table frame ${n}`);
  assert.equal(frameTime(0, g), 0, 'the first picture shows from 0');
  assert.equal(frameTime(405, g), 13599);   // round(66.016 + 406 x 33.333)
  assert.equal(frameAt(13606, g), 405, 'the old nominal cut 13606 (408 x 33.348) is inside picture 405');
  assert.equal(frameAt(77372, g), g.count, 'the end is past the last frame (not clamped)');
});

test('the frame table is the clock only when the probed rate misplaces the frames', () => {
  assert.ok(offGridTable(lateTimes(), makeClock({ fps: '69480/2317' })));
  assert.equal(offGridTable(Array.from({ length: 5000 }, (_, i) => Math.round(i * 1000 / 45)), makeClock({ fps: 45 })), null, 'integer-ms WebM pts: within 0.5 ms');
  assert.equal(offGridTable(Array.from({ length: 5000 }, (_, i) => (i * 1001) / 30), makeClock({ fps: '30000/1001' })), null);
  assert.ok(offGridTable(Array.from({ length: 50 }, (_, i) => 7 + i * 80), makeClock({ fps: 12.5 })), 'a 7 ms start offset');
});

test('loop edges, nudges and snaps land on the real frame starts', () => {
  const g = lateClock(), on = (t) => frameTime(frameAt(t, g), g) === t;
  for (const t of [13600, 13606, 1400, 5000.4, 77000]) assert.ok(on(toFrame(t, g)), `toFrame ${t}`);
  const l = { id: 'a', t0: 13599, t1: 17166 };
  assert.deepEqual(loopInfo(l, g), { ms: 3567, frames: 107, exact: true, real: frameTimeRaw(g, 512) - frameTimeRaw(g, 405) });
  assert.ok(Math.abs(periodOf(l, g) - 107000 / 30) < 2e-3, 'the period is 107 real frames (33.333 ms), not 107 x the average');
  for (const [edge, dir] of [['t0', 1], ['t0', -1], ['t1', 1], ['t1', -1]]) { const n = nudgeEdge(l, edge, dir, g); assert.ok(on(n[edge]), `${edge} ${dir}`); assert.equal(frameAt(n[edge], g) - frameAt(l[edge], g), dir); }
  const s = snapToFrames({ id: 'b', t0: 13606, t1: 17170 }, g);
  assert.ok(on(s.t0) && on(s.t1));
});
const frameTimeRaw = (c, n) => c.timeOf(n);

test('repeats on the clock: the decoded frame f is the clock frame f, ticks and loop bars on its starts (old caches too)', () => {
  const g = lateClock(), pass = (k) => Array.from({ length: 3 }, (_, j) => ({ f0: 405 + 107 * k + j, f1: 405 + 107 * k + j }));
  const occ = (rule) => [0, 1, 2].map((j) => [0, 1, 2].map((k) => { const o = pass(k)[j]; return { ...o, t_ms: rule(o.f0) }; }));
  for (const [name, rule] of [['table times', (f) => lateTimes()[f]], ['old fallback n x 33.333', (f) => Math.round(f * 1000 / 30 * 1000) / 1000]]) {
    const ix = indexRepeats({ frames: 2316, buckets: occ(rule) }, g);
    for (const o of ix.occ) assert.equal(o.t, frameTime(o.f0, g), `${name}: occurrence ${o.f0} at its frame start`);
    assert.equal(ix.occ[0].t, 13599, name);
    const al = autoLoops(ix, g.frameMs, g);
    // end: the frame after the last pass's last repeating picture (paw-fc0r; only 3 of the cycle's 107 frames repeat here)
    assert.deepEqual(al.map((a) => [a.t0, a.t1, a.end]), [[13599, frameTime(512, g), frameTime(405 + 2 * 107 + 3, g)]], `${name}: the automatic loop`);
    // paw-llaa: the loop's preferred frame, once per pass, on the real frames (the clock's frame table)
    const lp = { id: 'a', t0: al[0].t0, t1: al[0].t1, auto: { key: al[0].key, t0: al[0].t0, t1: al[0].t1, end: al[0].end, n: al[0].n } }, gm = passGeom(lp, g);
    assert.deepEqual(pickTicks(lp, gm, 2, g).map((k) => k.t), [0, 1, 2].map((k) => frameTime(405 + k * 107 + 2, g)), `${name}: each pass's preferred frame on its frame start`);
  }
  // a result whose count differs from the clock's: by its time, onto the frame containing it
  const ix = indexRepeats({ frames: 2300, buckets: occ((f) => lateTimes()[f]) }, g);
  assert.equal(ix.occ[0].f0, 405);
});

test('pass pairing by picture: a run frame (integer-ms pts) finds its own picture, also across the dropped frame', () => {
  const g = lateClock(), T = lateTimes();
  const ix = indexRepeats({ frames: 2316, buckets: [[{ f0: 30, f1: 30, t_ms: T[30] }, { f0: 900, f1: 900, t_ms: T[900] }], [{ f0: 41, f1: 42, t_ms: T[41] }, { f0: 1000, f1: 1001, t_ms: T[1000] }]] }, g);
  for (const f of [30, 900, 41, 42, 1000, 1001]) assert.equal(occurrenceAtTime(ix, Math.round(T[f]), g)?.f0 <= f, true, `run frame ${f}`);
  assert.equal(occurrenceAtTime(ix, Math.round(T[900]), g).id, 0);
  assert.equal(occurrenceAtTime(ix, Math.round(T[1001]), g).id, 1);
  assert.equal(occurrenceAtTime(ix, Math.round(T[899]), g), null, 'the frame before is another picture');
});

test('stored edges move onto the real frames; points, runs and the first / last edges stay', () => {
  const g = lateClock(), stroke = [{ at: 13600, pos: 10 }, { at: 13611, pos: 90 }];
  const doc = { scenes: [{ start_ms: 0, end_ms: 13606 }, { start_ms: 13606, end_ms: 24311 }, { start_ms: 24311, end_ms: 77372 }],
    fx: [{ id: 'f', t0: 38570, t1: 43270 }], loops: [{ id: 'l', t0: 13600, t1: 17167, auto: { key: '0:0', t0: 13600, t1: 17167, end: 24300, n: 3 } }], axes: { stroke } };
  const r = edgesOnFrames(doc, g);
  assert.deepEqual(r.scenes.map((s) => [s.start_ms, s.end_ms]), [[0, 13599], [13599, 24299], [24299, 77372]]);
  assert.ok(r.loops[0].t0 === r.loops[0].auto.t0 && r.loops[0].t1 === r.loops[0].auto.t1, 'still automatic');
  for (const t of [r.fx[0].t0, r.fx[0].t1, r.loops[0].t0, r.loops[0].t1]) assert.equal(frameStartOf(t, g), t);
  assert.ok(r.moved >= 6 && r.maxMs > 6 && r.maxMs < 34);
  assert.equal(edgesOnFrames({ ...doc, ...r }, g), null, 'idempotent');
  assert.equal(doc.axes.stroke, stroke);
  assert.equal(edgesOnFrames({ scenes: [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 2000 }] }, 1000 / 30)?.moved ?? 0, 0, 'a regular file: nothing moves');
});

test('a point made at frame n + 0.37 keeps that fraction of the REAL frame, through save / load and every snap', () => {
  const g = lateClock(), c = makeClock({ fps: '69480/2317' });   // a start offset + a dropped frame, and an odd exact rate
  for (const [clock, n] of [[g, 41], [g, 405], [c, 405]]) {
    const at = timeInFrame(n, 0.37, clock), a = clock.timeOf(n), b = clock.endOf(n);
    assert.ok(Math.abs((at - a) / (b - a) - 0.37) < 1e-12);
    assert.equal(frameAt(at, clock), n);
  }
  const at = Math.round(timeInFrame(405, 0.37, g));   // stored as integer ms, like every point
  const doc = { media: null, axes: { stroke: [{ at, pos: 40 }] }, activeAxis: 'stroke', scenes: [{ start_ms: 0, end_ms: 13606 }, { start_ms: 13606, end_ms: 20000 }], loops: [], fx: [], chapters: [], bookmarks: [], plan: [], ghosts: [] };
  const back = parse(serialize(doc, { savedAt: '2026-11-14T00:00:00.000Z' }));
  assert.deepEqual(back.axes.stroke, [{ at, pos: 40 }]);
  const moved = edgesOnFrames(back, g);
  assert.deepEqual({ ...back, ...moved }.axes.stroke, [{ at, pos: 40 }], 'the edge re-snap leaves points alone');
  assert.notEqual(frameStartOf(at, g), at, 'the point is not on a frame start and nothing put it there');
});
