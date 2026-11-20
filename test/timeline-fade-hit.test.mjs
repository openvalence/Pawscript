// paw-ef73.22: what is under the pointer on the Shots strip: a fade's grip, a cut line or the body. Grips sit inside the
// fade; the grab area is the grip + 3 px; the cut wins except on the grip itself; the primary grip is always there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitAt, gripsOf, makeFade, defaultFade, edgeFades, fadeBand, cutGrip, GRIP_W, GRAB_PX, GRIP_OFF, CUT_REACH } from '../src/features/timeline/transitions.js';

const FM = 1000 / 24, DUR = 20000, W = 1000, VIEW = { start: 0, span: 10000 };   // 0.1 px per ms
const px = (t) => (t - VIEW.start) / VIEW.span * W;
const FI = makeFade('fade-in', 2000, 2400, null, null, FM);   // 40 px wide, starts at a cut at 2000 (x = 200)
const CUT = [{ i: 3, x: px(2000) }];

test('the primary grip is drawn inside the fade, never on the cut line it starts at', () => {
  const [g] = gripsOf(FI, VIEW, W, DUR).filter((q) => q.always);
  assert.equal(g.h, 'clean');
  assert.equal(g.gx, px(FI.t1) - GRIP_OFF);
  const start = gripsOf(FI, VIEW, W, DUR).find((q) => q.h === 'start');
  assert.ok(start.gx - px(2000) >= GRIP_W / 2 + 1, 'the start grip clears the cut line');
});

test('over a grip: the handle; within the grip + 3 px: still the handle; beyond: not', () => {
  const g = px(FI.t1) - GRIP_OFF;
  for (const d of [0, 2.9, -2.9]) assert.equal(hitAt([FI], VIEW, W, g + d, [], true, DUR)?.h, 'clean');
  assert.equal(hitAt([FI], VIEW, W, g + GRIP_W / 2 + GRAB_PX - 0.1, [], true, DUR)?.h, 'clean');
  assert.equal(hitAt([FI], VIEW, W, g + GRIP_W / 2 + GRAB_PX + 0.5, [], true, DUR), null);
  assert.equal(hitAt([FI], VIEW, W, g, [], false, DUR), null, 'outside the fades band: no handle');
});

test('a handle and a cut at once: the cut wins unless the pointer is on the grip', () => {
  const start = gripsOf(FI, VIEW, W, DUR).find((q) => q.h === 'start');
  // on the cut line (the fade starts at the cut): the cut, although the start grip's reach is near
  assert.deepEqual(hitAt([FI], VIEW, W, px(2000), CUT, true, DUR), { kind: 'cut', i: 3 });
  assert.deepEqual(hitAt([FI], VIEW, W, px(2000) + 4, CUT, true, DUR), { kind: 'cut', i: 3 });
  // on the grip proper: the handle
  assert.equal(hitAt([FI], VIEW, W, start.gx, CUT, true, DUR).kind, 'handle');
  assert.equal(hitAt([FI], VIEW, W, start.gx, CUT, true, DUR).h, 'start');
  // a cut far from any fade: the cut; plain body: null
  assert.deepEqual(hitAt([FI], VIEW, W, 600, [{ i: 5, x: 602 }], true, DUR), { kind: 'cut', i: 5 });
  assert.equal(hitAt([FI], VIEW, W, 700, CUT, true, DUR), null);
});

test('paw-ef73.18: with a grip strip, a cut answers only on its grip (below the band), within CUT_REACH px', () => {
  const g = { y0: 40, y1: 56 };
  assert.deepEqual(hitAt([FI], VIEW, W, 600, [{ i: 5, x: 602 }], false, DUR, { py: 48, ...g }), { kind: 'cut', i: 5 });
  assert.equal(hitAt([FI], VIEW, W, 600, [{ i: 5, x: 602 }], false, DUR, { py: 30, ...g }), null, 'above the grip strip: the body');
  assert.equal(hitAt([FI], VIEW, W, 600, [{ i: 5, x: 600 + CUT_REACH + 1 }], false, DUR, { py: 48, ...g }), null, 'beside the grip: the body');
  const start = gripsOf(FI, VIEW, W, DUR).find((q) => q.h === 'start');
  assert.equal(hitAt([FI], VIEW, W, px(2000), CUT, true, DUR, { py: 36, ...g }), null, 'in the band, on the cut line but off the grip: neither');
  assert.equal(hitAt([FI], VIEW, W, start.gx, CUT, true, DUR, { py: 36, ...g }).h, 'start', 'the fade grip in the band');
  const b = fadeBand(33, 56), cg = cutGrip(33, 56);
  assert.ok(cg.y0 >= b.y0 + b.h + 2, 'the cut grip strip starts under the band and its reach');
});

test('the secondary grips answer only while the pointer is over their fade', () => {
  const start = gripsOf(FI, VIEW, W, DUR).find((q) => q.h === 'start');
  assert.equal(hitAt([FI], VIEW, W, start.gx, [], true, DUR).h, 'start');
  const far = makeFade('fade-in', 8000, 8400, null, null, FM);
  const s2 = gripsOf(far, VIEW, W, DUR).find((q) => q.h === 'start');
  assert.equal(hitAt([far], VIEW, W, s2.gx - 100, [], true, DUR), null);
});

test('zoom: the grip pulls in on a thin fade, the grab area stays small', () => {
  const thin = makeFade('fade-in', 2000, 2000 + FM, null, null, FM), wide = { start: 1900, span: 400 };   // 2.5 px per ms: ~104 px
  const near = { start: 0, span: 200000 };                                                              // ~0.2 px
  for (const g of gripsOf(thin, near, W, DUR)) assert.ok(Math.abs(g.gx - (thin.ts - near.start) / near.span * W) < 1.5);
  assert.ok(gripsOf(thin, wide, W, DUR).every((g) => Number.isFinite(g.gx)));
});

test('a default fade: 0.3 s (snapped to frames) or the whole short shot', () => {
  const shot = { start_ms: 1000, end_ms: 5000 };
  const fi = defaultFade('in', shot, FM), fo = defaultFade('out', shot, FM);
  assert.equal(fi.ts, 1000); assert.ok(Math.abs(fi.t1 - 1300) <= FM, 'about 0.3 s');
  assert.equal(fo.t1, 5000); assert.ok(Math.abs(fo.ts - 4700) <= FM);
  const short = defaultFade('in', { start_ms: 0, end_ms: 120 }, FM);
  assert.equal(short.t1, 120, 'a shot shorter than 0.3 s: fades over all of it');
  assert.equal(defaultFade('in', { start_ms: 0, end_ms: 10 }, FM), null, 'under a frame: none');
});

test('shotFades pairs the fade added at a shot edge with that shot (the menu shows Remove, not Add)', () => {
  const shots = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 5000 }];
  const L = [defaultFade('in', shots[1], FM)], f = shots.map((s) => edgeFades(s, L, FM, DUR));
  assert.ok(f[1].in && !f[1].out && !f[0].in && !f[0].out, 'a fade in belongs to the shot it opens, not the one before');
  const O = [defaultFade('out', shots[0], FM)], g = shots.map((s) => edgeFades(s, O, FM, DUR));
  assert.ok(g[0].out && !g[0].in && !g[1].in && !g[1].out, 'a fade out to the shot it darkens');
});
