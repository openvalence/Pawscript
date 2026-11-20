// paw-ef73.18 (owner: "the drag to select video and drag scene and drag shot and drag is not obvious, it's super jank"):
// one meaning per gesture on the Scenes row (scenes-hit.js rowHit: a cut only from its grip, a body only selects, fades
// only from their handles, offers and buttons by click), the range-select geometry, the cut edits the single keys run
// (shots.js removeCut / nudgeCut / nearestCut: frames, scene merges) and the ruler's frame cells (ticks.js frameCells).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowHit, rowNear, shotGrips, clearCuts, pillOf, boxSelect, gripAt, shotButtons, scenesGrip, shotsGrip, filmGrip, tallGrip, OFFER_H, CUT_REACH, NEAR_PX } from '../src/features/timeline/scenes-hit.js';
import { makeFade, fadeBand, gripsOf, GRIP_W, GRAB_PX } from '../src/features/timeline/transitions.js';
import { removeCut, nudgeCut, nearestCut, normScenes, sceneRuns } from '../src/features/timeline/shots.js';
import { frameCells, framesView } from '../src/features/timeline/ticks.js';
import { frameTime, msToX } from '../src/lib/lane.js';

const FM = 1000 / 24, DUR = 20000, W = 1000, VIEW = { start: 0, span: 10000 };   // 0.1 px per ms
const px = (t) => msToX(VIEW, W, t);
const H = 56, SH = Math.round(H * 0.58), Y1 = SH + 1;   // ScenesLane's split
const FI = makeFade('fade-in', 2000, 2400, null, null, FM);
const CUTS = [{ i: 1, x: px(2000) }, { i: 2, x: px(5000) }], SCENE_CUTS = [{ i: 2, x: px(5000) }];
const at = (x, y, more = {}) => rowHit({ px: x, py: y, sh: SH, H, w: W, view: VIEW, dur: DUR, fades: [FI], cuts: CUTS, sceneCuts: SCENE_CUTS, ...more });
const gs = shotsGrip(Y1, H), gc = scenesGrip(SH), mid = (g) => (g.y0 + g.y1) / 2;

test('a cut answers only on its grip: in the grip strip, within CUT_REACH px of its line', () => {
  assert.deepEqual(at(px(5000), mid(gs)), { kind: 'cut', i: 2, strip: 'shots' });
  assert.deepEqual(at(px(5000) + CUT_REACH - 0.5, mid(gs)), { kind: 'cut', i: 2, strip: 'shots' });
  assert.equal(at(px(5000) + CUT_REACH + 1, mid(gs)).kind, 'body', 'beside the grip: the body (a drag selects, the cut stays)');
  assert.equal(at(px(2000), Y1 + 2).kind, 'body', 'on a line with a fade handle near, above the grip strip (the fades band): not the cut');
  assert.deepEqual(at(px(5000), mid(gc)), { kind: 'cut', i: 2, strip: 'scenes' }, 'a scene boundary: its grip in the Scenes strip too');
  assert.equal(at(px(2000), mid(gc)).kind, 'body', 'a cut inside a scene has no grip in the Scenes strip');
});

test('the grip strips never overlap a fade handle or an offer badge, at any row height', () => {
  for (let h = 30; h <= 200; h++) {
    const sh = Math.round(h * 0.58), y1 = sh + 1, b = fadeBand(y1, h), g = shotsGrip(y1, h);
    if (h - y1 >= 16) assert.ok(g.y0 >= b.y0 + b.h + 2, `${h}: the cut grip starts under the fades band`);   // (the band + its 2 px reach)
    assert.ok(scenesGrip(sh).y0 > OFFER_H, `${h}: the scene grip starts under the offer badges`);
  }
});

test('a fade handle is grabbed in the band, never as the cut it starts at; off the grips: the body', () => {
  const start = gripsOf(FI, VIEW, W, DUR).find((q) => q.h === 'start'), b = fadeBand(Y1, H);
  assert.equal(at(start.gx, b.y0 + 2).kind, 'handle');
  assert.equal(at(start.gx, b.y0 + 2).h, 'start');
  assert.equal(at(px(2000), b.y0 + 2).kind, 'body', 'on the line in the band, off the fade grip: the body (the cut is grabbed below)');
  assert.equal(at(start.gx + GRIP_W / 2 + GRAB_PX + 2, b.y0 + 2).kind, 'body');
  assert.deepEqual(at(700, mid(gs)), { kind: 'body', strip: 'shots', card: -1 });
  assert.deepEqual(at(700, mid(gc)), { kind: 'body', strip: 'scenes' });
});

test('offers, proposals, raised cards and buttons come before the body; a card over the Scenes strip is its shot', () => {
  const o = { t: 5000, text: 'offer' };
  assert.deepEqual(at(px(5000), 4, { offerAt: (x, y) => (y <= OFFER_H && Math.abs(x - px(5000)) <= 6 ? o : null) }), { kind: 'offer', o });
  assert.equal(at(px(5000), mid(gc), { offerAt: () => null }).kind, 'cut', 'under the badge: the boundary grip');
  const p = { a: 0, c: 2 };
  assert.deepEqual(at(300, mid(gc), { proposalAt: () => p }), { kind: 'proposal', p });
  assert.deepEqual(at(300, SH - 2, { cardAt: () => 1 }), { kind: 'body', strip: 'shots', card: 1 });
  const btn = { id: 'cutaway', x0: 400, x1: 450, y0: gs.y0 + 1, y1: gs.y0 + 12, shot: 1 };
  assert.deepEqual(at(420, gs.y0 + 5, { buttons: [btn] }), { kind: 'button', b: btn, shot: 1 });
});

test('the shot buttons sit clear of both cut grips; a card gets its two choices; narrow shots get none', () => {
  const r = { x0: 100, x1: 300, cut: '' }, [b, o] = shotButtons(r, gs);
  assert.deepEqual([b.id, o.id], ['cutaway', 'offscreen'], 'paw-2lp7.4: the two marks');
  assert.ok(b.x1 <= r.x1 - CUT_REACH - 1 && b.x0 >= r.x0 + CUT_REACH + 1, 'inside, off the grips');
  assert.equal(gripAt([{ i: 1, x: r.x1 }], b.x1 - 1, b.y0 + 2, gs), -1, 'pressing the button never grabs the cut');
  const card = { x0: 100, x1: 300, y0: SH - 7, y1: H - 6, cut: 'offscreen' }, cb = shotButtons(card, gs, { timing: true });
  assert.deepEqual(cb.map((q) => [q.id, q.label, q.on]), [['convert', '→ cutaway', false], ['timing', 'timing', true]]);
  assert.deepEqual(shotButtons({ ...card, cut: 'intermission' }, gs, { extend: true }).map((q) => [q.id, q.label]), [['convert', '→ off-screen'], ['timing', 'timing'], ['extend', 'carry ↔']], 'no action over it: carry the action across');
  assert.ok(cb.every((q) => q.y0 >= card.y0 && q.y1 <= card.y1 && q.y1 - q.y0 >= 7), 'on the card');
  assert.deepEqual(shotButtons({ x0: 100, x1: 140, cut: '' }, gs), []);
});

test('range select: the shots a drag touches, either way; from the Scenes strip whole scenes; Shift adds, Ctrl takes away', () => {
  const L = normScenes([{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 2000, join: true }, { start_ms: 2000, end_ms: 3000 }, { start_ms: 3000, end_ms: 4000, join: true }]);
  assert.deepEqual(boxSelect(L, 1500, 2500, 'replace', null, 'shots').shots, [1, 2]);
  assert.deepEqual(boxSelect(L, 2500, 1500, 'replace', null, 'shots').shots, [1, 2], 'backwards too');
  assert.deepEqual(boxSelect(L, 1500, 2500, 'replace', null, 'scenes').shots, [0, 1, 2, 3], 'the Scenes strip: whole scenes');
  assert.deepEqual(boxSelect(L, 3100, 3200, 'add', { active: 0, shots: [0] }, 'shots').shots, [0, 3]);
  assert.deepEqual(boxSelect(L, 0, 1500, 'sub', { active: 0, shots: [0, 1, 2] }, 'shots').shots, [2]);
});

const shots = () => normScenes([
  { start_ms: 0, end_ms: frameTime(48, FM), tags: ['anal', 'penetration'] },
  { start_ms: frameTime(48, FM), end_ms: frameTime(96, FM), join: true },
  { start_ms: frameTime(96, FM), end_ms: frameTime(144, FM), tags: ['oral', 'licking'] },
]);

test('removeCut: a cut inside a scene merges the two shots; a scene boundary merges the scenes too (the later tags offered)', () => {
  const L = shots(), a = removeCut(L, 1);
  assert.equal(a.scenes, false);
  assert.deepEqual(a.list.map((s) => [s.start_ms, s.end_ms]), [[0, frameTime(96, FM)], [frameTime(96, FM), frameTime(144, FM)]]);
  const b = removeCut(L, 2);
  assert.equal(b.scenes, true);
  assert.equal(b.list.length, 2);
  assert.equal(sceneRuns(b.list).length, 1, 'one scene');
  assert.equal(b.list[1].end_ms, frameTime(144, FM));
  assert.ok(b.list[1].offers?.length, "the later scene's tags are offered, not lost");
  assert.equal(removeCut(L, 0), null);
  assert.equal(removeCut(L, 3), null);
});

test('nudgeCut: one frame earlier / later, onto frame starts (frameTime), never squashing a shot; nearestCut', () => {
  const L = shots(), e = nudgeCut(L, 1, -1, FM), l = nudgeCut(L, 1, 1, FM);
  assert.equal(e[1].start_ms, frameTime(47, FM)); assert.equal(e[0].end_ms, frameTime(47, FM));
  assert.equal(l[1].start_ms, frameTime(49, FM));
  const off = L.map((s, k) => (k === 1 ? { ...s, start_ms: s.start_ms + 7 } : k === 0 ? { ...s, end_ms: s.end_ms + 7 } : s));   // a cut 7 ms past its frame start
  assert.equal(nudgeCut(off, 1, 1, FM)[1].start_ms, frameTime(49, FM), 'lands on a frame start');
  const tiny = [{ start_ms: 0, end_ms: frameTime(1, FM) }, { start_ms: frameTime(1, FM), end_ms: 1000, join: true }];
  assert.equal(nudgeCut(tiny, 1, -1, FM), null, 'the first shot would be gone');
  assert.equal(nearestCut(L, frameTime(90, FM)), 2);
  assert.equal(nearestCut(L, 10), 1);
  assert.equal(nearestCut([L[0]], 10), -1);
});

test('frame cells: from 6 px a frame; each cell is [frameTime(n), frameTime(n + 1)) on the one mapping; the number stride fits', () => {
  assert.equal(frameCells(VIEW, W, FM), null, 'zoomed out (4 px frames): the ruler as before');
  const v = { start: 1003.7, span: 1000 }, C = frameCells(v, W, FM);   // ~41.7 px frames
  assert.ok(C.cells.length >= 24);
  for (const c of C.cells) {
    assert.equal(c.x0, msToX(v, W, frameTime(c.n, FM)), 'no rounding');
    assert.equal(c.x1, msToX(v, W, frameTime(c.n + 1, FM)));
  }
  for (let k = 1; k < C.cells.length; k++) assert.equal(C.cells[k].x0, C.cells[k - 1].x1, 'cells tile');
  assert.equal(C.stride, 1, 'wide frames: every number');
  const near = frameCells({ start: 0, span: 4000 }, W, FM);   // ~10.4 px frames
  assert.ok(near.stride > 1 && near.stride * 10.4 >= 6 * 2 + 8, `the stride adapts (${near.stride})`);
  const far = frameCells({ start: 600000, span: 6000 }, W, 1000 / 6);   // 27.8 px, 4-digit numbers
  assert.ok(far.stride * 27.8 >= 6 * 4 + 8);
});

test('zoom to frames: frames 12 px wide around the playhead', () => {
  const v = framesView(1200, FM, 5000);
  assert.ok(Math.abs((FM / v.span) * 1200 - 12) < 1e-9);
  assert.ok(Math.abs(v.start + v.span / 2 - 5000) < 1e-9);
});

test('the filmstrip grip is its whole line; beside it, the picture (a click selects the shot)', () => {
  const g = filmGrip(150);
  for (const y of [0, 20, 75, 130, 149]) assert.equal(gripAt([{ i: 3, x: 500 }], 501, y, g), 3, `y ${y}`);
  assert.equal(gripAt([{ i: 3, x: 500 }], 500 + CUT_REACH + 1, 75, g), -1);
  assert.equal(gripAt([{ i: 3, x: 500 }], 500 + NEAR_PX - 1, 75, g, NEAR_PX), 3, 'near: the pill grows');
});

test('paw-ef73.28: a cut with no fade handle near grips over the whole Shots strip; one by a fade keeps the strip under the band', () => {
  assert.deepEqual(clearCuts(CUTS, [FI], VIEW, W, DUR).map((c) => c.i), [2], 'the fade in starts at cut 1');
  for (let y = Y1; y < H; y++) assert.deepEqual(at(px(5000) + CUT_REACH - 0.5, y), { kind: 'cut', i: 2, strip: 'shots' }, `y ${y}`);
  assert.equal(at(px(5000) + CUT_REACH + 1, Y1 + 4).kind, 'body', 'beside it: the body');
  const G = shotGrips({ sh: SH, H, w: W, view: VIEW, dur: DUR, fades: [FI], cuts: CUTS });
  assert.deepEqual(G.get(2), tallGrip(Y1, H));
  assert.deepEqual(G.get(1), shotsGrip(Y1, H));
  assert.ok(G.get(2).y1 - G.get(2).y0 >= 2 * (gs.y1 - gs.y0 - 2), `about twice as tall at the default row (${G.get(2).y1 - G.get(2).y0} vs ${gs.y1 - gs.y0} px)`);
  // the fade's handles still win wherever they answer, at any row height
  for (let h = 40; h <= 200; h += 7) {
    const sh = Math.round(h * 0.58), y1 = sh + 1, b = fadeBand(y1, h);
    for (const q of gripsOf(FI, VIEW, W, DUR)) {
      const r = rowHit({ px: q.gx, py: b.y0 + 1, sh, H: h, w: W, view: VIEW, dur: DUR, fades: [FI], cuts: CUTS, sceneCuts: SCENE_CUTS });
      assert.equal(r.kind, 'handle', `${h}: handle ${q.h}`);
    }
  }
});

test('paw-ef73.28: a grip grows as the pointer comes within NEAR_PX of its line, in its strip', () => {
  const q = (x, y) => rowNear({ px: x, py: y, sh: SH, H, w: W, view: VIEW, dur: DUR, fades: [FI], cuts: CUTS, sceneCuts: SCENE_CUTS });
  assert.deepEqual(q(px(5000) + NEAR_PX - 1, Y1 + 2), { i: 2, strip: 'shots' }, 'the tall grip, near');
  assert.equal(q(px(5000) + NEAR_PX + 1, Y1 + 2), null, 'farther: as it was');
  assert.equal(q(px(2000) + 3, Y1 + 2), null, 'by a fade: not in the band');
  assert.deepEqual(q(px(2000) + 3, mid(gs)), { i: 1, strip: 'shots' });
  assert.deepEqual(q(px(5000) - 8, mid(gc)), { i: 2, strip: 'scenes' });
  const small = pillOf(100, tallGrip(Y1, H), false), big = pillOf(100, tallGrip(Y1, H), true);
  assert.ok(big.w > small.w && big.h > small.h, 'bigger near');
  assert.ok(big.y >= Y1 && big.y + big.h <= H, 'inside its strip');
});
