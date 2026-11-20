// paw-tog0: the timeline rows' level of detail (src/features/timeline/lod.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { thin, shownGrips, layoutLabels, fitText, GRIP_GAP } from '../src/features/timeline/lod.js';

test('thin keeps what has room, drops the lower priority on a collision, keeps forced items always', () => {
  assert.deepEqual(thin([{ x0: 0, x1: 5 }, { x0: 10, x1: 15 }], 2), [true, true]);
  assert.deepEqual(thin([{ x0: 0, x1: 5, pri: 0 }, { x0: 6, x1: 9, pri: 1 }], 2), [false, true]);
  assert.deepEqual(thin([{ x0: 0, x1: 5 }, { x0: 6, x1: 9 }], 2), [true, false]);   // same priority: left to right
  assert.deepEqual(thin([{ x0: 0, x1: 5, pri: 1 }, { x0: 6, x1: 9, force: true }], 2), [false, true]);
});

test("the owner's zoom: one 6-frame shot does not take every other grip with it", () => {
  // 20 px/s, 32 shots 60-250 px wide, shot 27 is 4 px wide; boundary 8 is a camera move
  const xs = [], cuts = [];
  for (let i = 1, x = 0; i < 32; i++) { x += i === 28 ? 4 : 60 + ((i * 37) % 190); xs.push(x); cuts.push({ i, x, move: i === 8 }); }
  const shown = shownGrips(cuts);
  assert.equal(shown.size, 30);   // all but one of the tiny shot's two
  assert.ok(shown.has(8), 'the camera move keeps its grip where it has room');
  assert.ok(shown.has(27) !== shown.has(28));
  // the one the pointer is near is drawn, whichever it is
  assert.ok(shownGrips(cuts.map((c) => ({ ...c, force: c.i === 28 }))).has(28));
  assert.ok(shownGrips(cuts.map((c) => ({ ...c, force: c.i === 27 }))).has(27));
});

test('a cut keeps its grip before a camera move next to it', () => {
  const s = shownGrips([{ i: 1, x: 100, move: true }, { i: 2, x: 104, move: false }]);
  assert.deepEqual([...s], [2]);
});

test('300 shots across 1600 px: a crowded run is lines (no comb of pills), drawn grips never touch, the near one is drawn', () => {
  const even = Array.from({ length: 299 }, (_, k) => ({ i: k + 1, x: ((k + 1) * 1600) / 300 }));
  assert.equal(shownGrips(even).size, 2);   // only the two ends of the run, which have room on one side
  assert.deepEqual([...shownGrips(even.map((c) => ({ ...c, force: c.i === 150 })))].sort((a, b) => a - b), [1, 150, 299]);
  const ragged = even.map((c, k) => ({ ...c, x: c.x + (k % 7 === 0 ? 4 : 0), move: k % 10 === 4 }));
  const xs = ragged.filter((c) => shownGrips(ragged).has(c.i)).map((c) => c.x).sort((a, b) => a - b);
  for (let k = 1; k < xs.length; k++) assert.ok(xs[k] - xs[k - 1] >= GRIP_GAP, `${xs[k - 1]} / ${xs[k]}`);
});

test('labels take their parts while they fit, then thin where they would overlap', () => {
  // number 12 px + 5, glyph 13
  const parts = [17, 13];
  assert.deepEqual(layoutLabels([{ x: 0, room: 40, parts }]), [2]);       // number + glyph
  assert.deepEqual(layoutLabels([{ x: 0, room: 20, parts }]), [1]);       // compact: the number
  assert.deepEqual(layoutLabels([{ x: 0, room: 10, parts }]), [0]);       // no room for the number: none
  // overlapping neighbours: the left one stays, unless the right one is selected / hovered
  const two = [{ x: 0, room: 60, parts }, { x: 20, room: 60, parts }];
  assert.deepEqual(layoutLabels(two), [2, 0]);
  assert.deepEqual(layoutLabels([two[0], { ...two[1], force: true }]), [0, 2]);
  assert.deepEqual(layoutLabels([{ x: 0, room: 18, parts }, { x: 22, room: 60, parts }]), [1, 2]);
});

test('a name keeps a few letters behind an ellipsis before it goes', () => {
  const ctx = { font: '10px x', measureText: (s) => ({ width: s.length * 6 }) };
  assert.equal(fitText(ctx, 'Orgasm', 36), 'Orgasm');
  assert.equal(fitText(ctx, 'Orgasm · generated', 48), 'Orgasm…');
  assert.equal(fitText(ctx, 'Orgasm', 24), 'Org…');
  assert.equal(fitText(ctx, 'Orgasm', 18), '');
  assert.equal(fitText(ctx, '', 100), '');
});

test('paw-h2e2 freeSlot: the right-most free stretch that holds the control, clear of every busy span; none: null', async () => {
  const { freeSlot } = await import('../src/features/timeline/lod.js');
  assert.equal(freeSlot([], 1000, 300), 700, 'an empty row: at its right end');
  assert.equal(freeSlot([[800, 1200]], 1000, 300), 500, 'a block running past the right end: left of it');
  assert.equal(freeSlot([[800, 1200], [300, 600]], 1000, 150), 650, 'between two blocks when it fits there');
  assert.equal(freeSlot([[800, 1200], [300, 600]], 1000, 250), 50, 'else further left');
  assert.equal(freeSlot([[300, 600], [800, 1200], [550, 700]], 1000, 120), 180, 'overlapping blocks leave 0..300 and 700..800: 120 px only in the first');
  assert.equal(freeSlot([[300, 600], [800, 1200], [550, 700]], 1000, 350), null, 'nothing holds 350 px');
});
