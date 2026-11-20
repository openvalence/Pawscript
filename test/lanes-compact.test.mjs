// paw-g56v: compact axis lanes (heights without a header bar) and the timeline's overscroll with the loop wrap ghost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneHeights, loopWrap, MIN_H, SHORT_MIN_H, COLLAPSED_H } from '../src/features/lanes/geom.js';
import { moveLimits, resolveMove } from '../src/features/lanes/drag.js';
import { oobBands, clampView } from '../src/lib/lane.js';
import { drawBase, readTheme } from '../src/features/lanes/render.js';

test('lane heights: minimums without a header bar', () => {
  assert.equal(MIN_H, 36); assert.equal(SHORT_MIN_H, 28); assert.equal(COLLAPSED_H, 22);
  assert.deepEqual(laneHeights([168, 104, 0], 400), [296, 104, 0]);   // spare room to the first open lane, collapsed stays 0
  const six = laneHeights([168, 104, 104, 104, 104, 104], 300);   // six lanes in 300 px: proportional, never under MIN_H, sum = avail
  const sum = six.reduce((a, b) => a + b, 0);
  assert.ok(sum <= 300 && sum >= 300 - six.length, String(six));   // floors round down: at most a px a lane short
  assert.ok(six.every((h) => h >= MIN_H), String(six));
  const tight = laneHeights([168, 104, 104, 104, 104, 104], 120);   // no room even for MIN_H: an even share, floored at SHORT_MIN_H
  assert.ok(tight.every((h) => h === SHORT_MIN_H), String(tight));
  assert.deepEqual(laneHeights([0, 0], 100), [0, 0]);
});

const S = [{ at: 0, pos: 10 }, { at: 1000, pos: 90 }, { at: 2000, pos: 20 }, { at: 9000, pos: 80 }, { at: 9800, pos: 30 }];
const D = 10000, LOOP = { t0: 0, t1: 10000 };

test('loop wrap: before the start the end of the loop, after the end its start, joined across the boundary', () => {
  const w = loopWrap(S, LOOP, D, { start: -1500, span: 4000 }, 33);
  // the last points shifted back by the loop's length (one past the view's edge, so the line runs off it), then the join to the real first point
  assert.deepEqual(w.before, [{ at: -8000, pos: 20 }, { at: -1000, pos: 80 }, { at: -200, pos: 30 }, { at: 0, pos: 10 }]);
  assert.equal(w.after, null);   // the view does not reach past the end
  const e = loopWrap(S, LOOP, D, { start: 8500, span: 3000 }, 33);
  // the join from the real last point, then the first points shifted on
  assert.deepEqual(e.after, [{ at: 9800, pos: 30 }, { at: 10000, pos: 10 }, { at: 11000, pos: 90 }, { at: 12000, pos: 20 }]);
  assert.equal(e.before, null);
});

test('loop wrap: only where the looped span reaches that end of the video; nothing when not looping', () => {
  assert.deepEqual(loopWrap(S, null, D, { start: -1500, span: 4000 }), { before: null, after: null });
  const inner = { t0: 1000, t1: 9000 };   // a loop inside the video would draw over real points
  assert.deepEqual(loopWrap(S, inner, D, { start: -1500, span: 20000 }, 33), { before: null, after: null });
  const head = loopWrap(S, { t0: 20, t1: 2000 }, D, { start: -3000, span: 20000 }, 33);   // starts within a frame of 0, ends inside
  assert.deepEqual(head.before.at(-1), { at: 1000, pos: 90 });   // the join lands on the loop's first point (1000: the first >= t0)
  assert.equal(head.after, null);
  assert.deepEqual(loopWrap([], LOOP, D, { start: -1500, span: 4000 }), { before: null, after: null });
});

test('the out-of-range bands of a view', () => {
  assert.deepEqual(oobBands({ start: 0, span: D }, D), { pre: 0, post: 100 });
  assert.deepEqual(oobBands({ start: -2000, span: 4000 }, D), { pre: 50, post: 100 });   // time 0 mid-view
  assert.deepEqual(oobBands({ start: 8000, span: 4000 }, D), { pre: 0, post: 50 });   // the end mid-view
  assert.deepEqual(oobBands(clampView({ start: -1e9, span: 4000 }, D), D), { pre: 50, post: 100 });   // never past half a view
  assert.deepEqual(oobBands({ start: 0, span: 200 }, 0), { pre: 0, post: 100 });   // no duration: nothing hatched
});

test('no point moves past the video end; existing clamps hold', () => {
  const s = [{ at: 100, pos: 0 }, { at: 5000, pos: 50 }, { at: 9900, pos: 100 }];
  assert.equal(moveLimits(s, [2], 'clamp', 1, D).dtMax, 100);
  assert.equal(moveLimits(s, [1, 2], 'clamp', 1, D).dtMax, 100);
  assert.equal(moveLimits(s, [0], 'push', 1, D).dtMax, 100);   // push moves everything after: the last point stops at the end
  assert.equal(moveLimits(s, [0], 'clamp', 1, D).dtMin, -100);   // and nothing before 0
  assert.equal(moveLimits([{ at: 12000, pos: 1 }], [0], 'clamp', 1, D).dtMax, 0);   // an old point already past the end: never further
  const r = resolveMove({ script: s, idx: [2], anchor: 2, t: 14000, pos: 100, mode: 'clamp', fms: 0, snap: false, targets: [], tolMs: 0, constrain: false, dxPx: 1, dyPx: 0, minGap: 1, dur: D });
  assert.equal(s[2].at + r.dt, D);
  const l = resolveMove({ script: s, idx: [0], anchor: 0, t: -3000, pos: 0, mode: 'clamp', fms: 0, snap: false, targets: [], tolMs: 0, constrain: false, dxPx: 1, dyPx: 0, minGap: 1, dur: D });
  assert.equal(s[0].at + l.dt, 0);
});

/** Every fillText a drawBase call makes (a recording context). */
function texts(L, view = { start: 0, span: D }) {
  const said = [];
  const ctx = new Proxy({}, { get: (o, k) => (k === 'fillText' ? (t) => said.push(t) : k === 'measureText' ? () => ({ width: 40 }) : k === 'getTransform' ? () => ({ a: 1 }) : k in o ? o[k] : () => {}), set: (o, k, v) => ((o[k] = v), true) });
  drawBase(ctx, 800, 120, view, { theme: readTheme(), selIdx: [], bookmarks: [], chapters: [], loops: [], ghosts: [], ...L });
  return said;
}

test('an empty lane draws no hint; the wrap is labelled; the info words are drawn behind the curve', () => {
  assert.deepEqual(texts({ script: [] }).filter((t) => !/^\d+$/.test(t)), []);   // owner 2026-11-15: no "Empty lane: press 0-9" text (only the pos scale)
  const view = { start: -2000, span: 4000 }, wrap = loopWrap(S, LOOP, D, view, 33);
  assert.ok(texts({ script: S, wrap, dur: D }, view).includes('↻ end of loop'));
  const v2 = { start: 8000, span: 4000 };
  assert.ok(texts({ script: S, wrap: loopWrap(S, LOOP, D, v2, 33), dur: D }, v2).includes('↻ start of loop'));
  assert.ok(texts({ script: S, dur: D, info: { x: 24, items: [{ text: '5 points' }] } }).includes('5 points'));
});
