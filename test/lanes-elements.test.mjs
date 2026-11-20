// paw-5zpf: the lane editor's selection modes (src/features/lanes/elements.js) on awkward data: plateaus, equal neighbours,
// single points, holds, a script that starts high; the passage rule (Alt+click loop), the path (Ctrl+click), mode conversion,
// the active element and its carry through an edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { elements, strokesOf, hitElement, elementOfSegment, elementOfPoint, convertSelection, removeElements, addElements, combineElements,
  passages, loopOf, pathOf, activeIdx, carryActive, centreOf, islands, isSelected } from '../src/features/lanes/elements.js';
import { posToY } from '../src/features/lanes/geom.js';

const S = (...pp) => pp.map(([at, pos]) => ({ at, pos }));
/** A regular stroking script: n strokes of d ms between lo and hi, from t0. */
const wave = (n, d = 500, t0 = 0, lo = 10, hi = 90) => Array.from({ length: n + 1 }, (_, i) => ({ at: t0 + i * d, pos: i % 2 ? hi : lo }));
const sel = (...ats) => new Set(ats);

test('points and segments', () => {
  const s = wave(3);
  assert.deepEqual(elements(s, 'point'), [[0, 0], [1, 1], [2, 2], [3, 3]]);
  assert.deepEqual(elements(s, 'segment'), [[0, 1], [1, 2], [2, 3]]);
  assert.deepEqual(elements(S([0, 50]), 'segment'), [], 'a single point has no segment');
  assert.deepEqual(elements([], 'stroke'), []);
});

test('strokes: monotone runs; a hold ends a stroke and belongs to none; a flat script has none', () => {
  // up 10->50->90 (two segments), hold at 90, down to 10, hold at 10 then up
  const s = S([0, 10], [100, 50], [200, 90], [300, 90], [400, 10], [500, 10], [600, 70]);
  assert.deepEqual(strokesOf(s), [[0, 2], [3, 4], [5, 6]]);
  assert.deepEqual(elements(S([0, 50], [100, 50], [200, 50]), 'stroke'), [], 'flat');
  assert.deepEqual(elements(S([0, 50]), 'stroke'), [], 'one point');
  // equal neighbours inside a direction change: 10, 90, 90, 90, 10 -> the up stroke ends at the first 90, the down starts at the last
  assert.deepEqual(strokesOf(S([0, 10], [1, 90], [2, 90], [3, 90], [4, 10])), [[0, 1], [3, 4]]);
});

test('cycles: up then down (a hold at the top is in it, a hold at the bottom is not); a start from high has an orphan stroke', () => {
  const s = S([0, 90], [100, 10], [200, 90], [300, 90], [400, 10], [500, 10], [600, 80], [700, 20]);
  // strokes: [0,1] down (orphan), [1,2] up, [3,4] down, [5,6] up, [6,7] down
  assert.deepEqual(strokesOf(s), [[0, 1], [1, 2], [3, 4], [5, 6], [6, 7]]);
  assert.deepEqual(elements(s, 'cycle'), [[1, 4], [5, 7]]);
});

test('element lookup by segment and point; shared ends', () => {
  const s = wave(4), st = elements(s, 'stroke');
  assert.equal(elementOfSegment(st, 1), 0);
  assert.equal(elementOfSegment(st, 3), 2);
  assert.equal(elementOfPoint(st, 2), 1, 'a shared end: the first element holding it');
  assert.equal(elementOfSegment(elements(S([0, 10], [100, 90], [200, 90]), 'stroke'), 2), -1, 'a hold');
});

test('hitElement: the nearest segment within reach, the pointer side wins at a shared point; too dense -> -1', () => {
  const s = wave(4, 1000), view = { start: 0, span: 4000 }, w = 400, h = 120, st = elements(s, 'stroke');
  const y = (pos) => posToY(h, pos);
  assert.equal(hitElement(s, st, view, w, h, 50, y(50)), 0, 'middle of stroke 0');
  assert.equal(hitElement(s, st, view, w, h, 98, y(90)), 0, 'just left of the peak');
  assert.equal(hitElement(s, st, view, w, h, 102, y(90)), 1, 'just right of the peak');
  assert.equal(hitElement(s, st, view, w, h, 50, y(50) - 30), -1, 'far from the line');
  const dense = wave(2000, 2);
  assert.equal(hitElement(dense, elements(dense, 'segment'), view, w, h, 200, y(50)), -1);
});

test('mode conversion: up keeps complete elements only; down keeps every point', () => {
  const s = wave(4), at = (i) => s[i].at;
  const strokes01 = sel(at(0), at(1), at(2));
  assert.deepEqual([...convertSelection(s, strokes01, 'point', 'stroke')].sort((a, b) => a - b), [at(0), at(1), at(2)]);
  assert.deepEqual([...convertSelection(s, sel(at(0), at(1), at(3)), 'point', 'stroke')], [at(0), at(1)], 'only stroke 0 is complete');
  assert.deepEqual([...convertSelection(s, sel(at(0), at(1)), 'stroke', 'cycle')], [], 'half a cycle');
  assert.equal(convertSelection(s, strokes01, 'cycle', 'point'), strokes01, 'down: unchanged');
});

test('removing an element keeps the end it shares with another selected element', () => {
  const s = wave(4), st = elements(s, 'stroke'), all = addElements(new Set(), s, st, [0, 1]);
  const r = removeElements(all, s, st, [1]);
  assert.deepEqual([...r].sort((a, b) => a - b), [0, 500], 'stroke 0 stays whole (the peak it shares stays)');
  assert.ok(isSelected(r, s, st[0]) && !isSelected(r, s, st[1]));
  assert.deepEqual([...combineElements(new Set([9]), s, st, [2], 'replace')].sort((a, b) => a - b), [1000, 1500]);
});

test('centre: mid time on the line', () => {
  const s = wave(2, 1000);
  assert.deepEqual(centreOf(s, [0, 1]), { t: 500, pos: 50 });
  assert.deepEqual(centreOf(s, [0, 2]), { t: 1000, pos: 90 });
});

test('passages: a long hold or a slow drift ends one; tempo inside stays', () => {
  // 8 strokes of 500 ms (ends low at 4 s), held low 3 s, 6 strokes of 400 ms (7-9.4 s, ends low), one 5 s drift up, then 7
  // strokes of 500 ms from 14.4 s
  const s = [...wave(8, 500, 0), ...wave(6, 400, 7000), { at: 14400, pos: 90 }, ...wave(6, 500, 14900)];
  assert.deepEqual(passages(s), [[0, 7], [8, 13], [14, 14], [15, 21]]);
  // a steady speed-up (500 -> 300 ms) stays one passage
  let t = 0; const ramp = [{ at: 0, pos: 10 }];
  for (let k = 0; k < 20; k++) { t += Math.round(500 - k * 10); ramp.push({ at: t, pos: k % 2 ? 10 : 90 }); }
  assert.equal(passages(ramp).length, 1);
});

test('loop (Alt+click): every peak / trough of the passage; strokes of one direction; cycles', () => {
  const a = wave(8, 500, 0), s = [...a, ...wave(6, 500, 8000)];   // held low 4 s between the two passages
  const peaks = loopOf(s, 'point', { i: 1 });
  assert.deepEqual(peaks, [500, 1500, 2500, 3500], 'the peaks of the first passage only');
  assert.deepEqual(loopOf(s, 'point', { i: 2 }), [0, 1000, 2000, 3000, 4000], 'the troughs (the passage ends on one)');
  const st = elements(s, 'stroke');
  const ups = loopOf(s, 'stroke', { el: st[2] });
  assert.deepEqual(ups, [0, 500, 1000, 1500, 2000, 2500, 3000, 3500], 'every up stroke of the passage (with their ends)');
  assert.deepEqual(loopOf(s, 'segment', { el: [1, 2] }), [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000], 'segment mode: the down strokes');
  const cyc = loopOf(s, 'cycle', { el: elements(s, 'cycle')[0] });
  assert.deepEqual(cyc, a.map((p) => p.at), 'every cycle of the passage');
  assert.equal(loopOf(S([0, 10], [100, 50], [200, 90]), 'point', { i: 1 }), null, 'a mid-stroke point has no loop');
  assert.equal(loopOf(S([0, 10], [100, 90], [200, 90]), 'segment', { el: [1, 2] }), null, 'a hold has no loop');
});

test('path (Ctrl+click): every element between two, either order', () => {
  const s = wave(6), st = elements(s, 'stroke');
  assert.deepEqual(pathOf(s, st, 4, 1), [500, 1000, 1500, 2000, 2500]);
  assert.deepEqual(pathOf(s, elements(s, 'point'), 2, 2), [1000]);
});

test('active element: valid while all its points are selected; carried one to one through an edit', () => {
  const s = wave(4);
  assert.deepEqual(activeIdx(s, { ats: sel(0, 500, 1000), active: [500, 1000] }), [1, 2]);
  assert.equal(activeIdx(s, { ats: sel(0, 500), active: [500, 1000] }), null, 'deselected: cleared');
  assert.equal(activeIdx(s, { ats: sel(0, 500) }), null);
  // a move by +100 ms of three points keeps the active on the same (moved) points
  assert.deepEqual(carryActive({ ats: sel(0, 500, 1000), active: [500, 1000] }, [100, 600, 1100]), [600, 1100]);
  assert.equal(carryActive({ ats: sel(0, 500), active: [500] }, [0]), undefined, 'its point is gone');
  assert.deepEqual(carryActive({ ats: sel(0, 500), active: [500] }, [500, 700, 900]), [500], 'grown around it: kept');
});

test('islands: runs of consecutive selected indices', () => {
  assert.deepEqual(islands([1, 2, 3, 6, 8, 9]), [[1, 2, 3], [6], [8, 9]]);
  assert.deepEqual(islands([]), []);
});
