import test from 'node:test';
import assert from 'node:assert/strict';
import { isValid } from '../src/lib/core/script.js';
import { pointTime, frameStep, nudgeBlock, timeSpan, fitSpan, recordingToScript, playheadMs, sameScript, clipToEnd } from '../src/features/lanes/cmdlogic.js';

const F = 1000 / 30;
const s = [{ at: 0, pos: 0 }, { at: 100, pos: 100 }, { at: 200, pos: 0 }, { at: 300, pos: 90 }, { at: 400, pos: 50 }];

test('pointTime: latency only while playing, frame snap, never negative', () => {
  assert.equal(pointTime(1010.4), 1010);
  assert.equal(pointTime(1010, { frameMs: F }), 1000);
  assert.equal(pointTime(1010, { playing: true, latency: 100, frameMs: F }), 900);
  assert.equal(pointTime(1010, { playing: false, latency: 100, frameMs: F }), 1000);
  assert.equal(pointTime(20, { playing: true, latency: 100 }), 0);
});

test('frameStep: one frame on the grid without drift, next frame start off it', () => {
  let t = 1000;
  for (let i = 0; i < 30; i++) t = frameStep(t, 1, F);
  assert.equal(t, 2000);
  for (let i = 0; i < 30; i++) t = frameStep(t, -1, F);
  assert.equal(t, 1000);
  assert.equal(frameStep(1033, 1, F), 1067);
  assert.equal(frameStep(250, 1, F), 267);
  assert.equal(frameStep(250, -1, F), 233);
  assert.equal(frameStep(0, -1, F), 0);
  assert.equal(frameStep(10, 1, 0), 11);
});

test('nudgeBlock: clamps time against unselected neighbours, keeps the block shape', () => {
  let r = nudgeBlock(s, new Set([100]), 33, 0);
  assert.deepEqual(r.script[1], { at: 133, pos: 100 });
  assert.deepEqual(r.ats, [133]);
  r = nudgeBlock(s, new Set([100]), 150, 0);            // stops 1 ms before the neighbour at 200
  assert.equal(r.dt, 99);
  assert.ok(isValid(r.script));
  r = nudgeBlock(s, new Set([0]), -33, 0);              // can't go below 0
  assert.equal(r.dt, 0);
  assert.equal(r.script, s);
  r = nudgeBlock(s, new Set([100, 200]), 200, 0);       // block of two: limited by 300
  assert.equal(r.dt, 99);
  assert.deepEqual(r.ats, [199, 299]);
  r = nudgeBlock(s, new Set([200, 300]), 0, 20);        // shape-preserving: 90 can only rise 10
  assert.equal(r.dp, 10);
  assert.deepEqual(r.script.slice(2, 4), [{ at: 200, pos: 10 }, { at: 300, pos: 100 }]);
  assert.deepEqual(nudgeBlock(s, new Set([300]), 0, -5).script[3], { at: 300, pos: 85 });
  assert.equal(nudgeBlock(s, new Set([999]), 33, 0).script, s, 'stale selection: no-op');
});

test('timeSpan / fitSpan', () => {
  assert.deepEqual(timeSpan(new Set([300, 100, 200])), { t0: 100, t1: 300 });
  assert.equal(timeSpan(new Set()), null);
  const v = fitSpan(1000, 2000);
  assert.ok(Math.abs(v.span - 1160) < 1e-9 && Math.abs(v.start - 920) < 1e-9);
  assert.deepEqual(fitSpan(1000, 1000), { start: 800, span: 400 });
});

test('recordingToScript: tap snaps and dedupes, live fits', () => {
  const tap = recordingToScript({ mode: 'tap', samples: [{ t: 1010, pos: 100 }, { t: 500, pos: 0 }, { t: 1005, pos: 90 }] }, { frameMs: F });
  assert.deepEqual(tap, [{ at: 500, pos: 0 }, { at: 1000, pos: 90 }]);
  assert.deepEqual(recordingToScript({ mode: 'tap', samples: [] }), []);
  const samples = [];
  for (let t = 0; t <= 1000; t += 16) samples.push({ t, pos: 50 + 50 * Math.sin((t / 1000) * 2 * Math.PI) });
  const live = recordingToScript({ mode: 'live', samples }, { eps: 4 });
  assert.ok(isValid(live) && live.length >= 4 && live.length < samples.length / 4);
  assert.equal(live[0].at, 0);
  assert.equal(live[live.length - 1].at, 992);
});

test('playheadMs: paused = the frame shown or being sought, not the stale presented time (QA: digit after a step)', () => {
  const clock = { frameAt: (ms) => Math.floor((ms + 0.6) / F), timeOfFrame: (k) => k * F };
  // a step from frame 90 to 91 is in flight: timeMs still holds frame 90, pendingMs is the mid-frame seek target
  assert.equal(playheadMs({ ...clock, playing: false, timeMs: 3000, pendingMs: 91.5 * F, displayMs: 91.5 * F }), 91 * F);
  assert.equal(pointTime(playheadMs({ ...clock, playing: false, timeMs: 3000, displayMs: 91.5 * F }), { frameMs: F }), 3033);
  assert.equal(playheadMs({ ...clock, playing: false, timeMs: 3000, displayMs: 3000 }), 3000);
  assert.equal(playheadMs({ ...clock, playing: true, timeMs: 3010.5, displayMs: 3010.5 }), 3010.5, 'playing: the live time');
  assert.equal(playheadMs({ playing: false, timeMs: 1234 }), 1234, 'fallback player without a frame clock');
});

test('sameScript: content equality (QA: a repeated digit or Q added empty undo entries)', () => {
  assert.ok(sameScript(s, s.map((a) => ({ ...a }))));
  assert.ok(!sameScript(s, s.slice(1)));
  assert.ok(!sameScript(s, s.map((a, i) => (i === 2 ? { ...a, pos: 1 } : a))));
  assert.ok(sameScript([], []));
});

test('clipToEnd: drops what an edit put past the video end, keeps what was already there (QA: Q past the end)', () => {
  const prev = [{ at: 8800, pos: 0 }, { at: 9200, pos: 100 }, { at: 9600, pos: 0 }];
  const next = [...prev, { at: 9700, pos: 100 }, { at: 10100, pos: 0 }, { at: 10500, pos: 100 }];
  assert.deepEqual(clipToEnd(next, prev, 10000), { script: next.slice(0, 4), dropped: 2 });
  assert.equal(clipToEnd(next, prev, 0).script, next, 'no video: no end');
  assert.equal(clipToEnd(prev, prev, 10000).script, prev, 'nothing past the end: same value');
  const long = [...prev, { at: 12000, pos: 50 }];                  // a script longer than its video
  const edited = [...long.slice(0, 3), { at: 9900, pos: 40 }, long[3], { at: 12500, pos: 0 }];
  assert.deepEqual(clipToEnd(edited, long, 10000).script.map((a) => a.at), [8800, 9200, 9600, 9900, 12000]);
});
