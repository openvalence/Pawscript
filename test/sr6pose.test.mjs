// paw-jyde.2: the six-axis preview's pure parts (src/features/video/sr6pose.js): pose, views, gauges, source, solo, the box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDS, RANGE, SLEEVE, VIEWS, viewOf, pose, place, openingOf, masked, basis, project, viewport, valuesAt, trail, pickScripts, hasData, qualityAt,
  gauge, ARC, hull, layout, boxOf, boxStore, boxMove, boxResize, BOX } from '../src/features/video/sr6pose.js';
import { posAt } from '../src/lib/core/script.js';

const C = { stroke: 50, surge: 50, sway: 50, twist: 50, roll: 50, pitch: 50 };
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const D = Math.PI / 180;
const mid = (s) => SLEEVE.y0 + SLEEVE.len / 2 + s * RANGE.stroke.mm;

test('centre: no rotation, no sideways move; stroke runs up the shaft, 0 = deepest', () => {
  const P = pose(C);
  assert.deepEqual(P.r, { twist: 0, roll: 0, pitch: 0 });
  near(P.p[0], 0); near(P.p[2], 0); near(P.p[1], mid(0.5));
  assert.deepEqual(place(P, [1, 2, 3]), [1, 2 + mid(0.5), 3]);
  assert.deepEqual(pose({}), P);                              // missing = centre
  assert.deepEqual(pose({ ...C, sway: NaN }), P);             // NaN = centre
  near(pose({ stroke: 0 }).p[1], mid(0)); near(pose({ stroke: 100 }).p[1], mid(1));
  near(openingOf(pose({ stroke: 0 }))[1], SLEEVE.y0);         // the opening sits low on the shaft at the deep end
});
test('each axis moves its own component with its sign; the mirror value (a flip) mirrors it', () => {
  near(pose({ ...C, sway: 100 }).p[0], RANGE.sway.mm);
  near(pose({ ...C, surge: 0 }).p[2], -RANGE.surge.mm);
  near(pose({ ...C, twist: 100 }).r.twist, RANGE.twist.deg * D);
  near(pose({ ...C, roll: 0 }).r.roll, -RANGE.roll.deg * D);
  near(pose({ ...C, pitch: 100 }).r.pitch, RANGE.pitch.deg * D);
  for (const id of ['surge', 'sway', 'twist', 'roll', 'pitch']) {
    const a = pose({ ...C, [id]: 70 }), b = pose({ ...C, [id]: 30 });
    near(a.p[0], -b.p[0]); near(a.p[2], -b.p[2]); near(a.r.twist, -b.r.twist); near(a.r.roll, -b.r.roll); near(a.r.pitch, -b.r.pitch);
  }
  const P0 = pose(C);
  // the wearer's frame, six-axis signs: twist + = ccw as the wearer sees it (+x toward -z), roll + = the top tips to +x (their
  // left), pitch + = the top tips to -z (their down)
  const tw = place(pose({ ...C, twist: 100 }), [10, 0, 0]);
  assert.ok(tw[2] - P0.p[2] < -9 * Math.sin(RANGE.twist.deg * D) + 1e-9, `twist ${tw}`);
  assert.ok(place(pose({ ...C, roll: 100 }), [0, 10, 0])[0] > place(P0, [0, 10, 0])[0] + 1);
  assert.ok(place(pose({ ...C, pitch: 100 }), [0, 10, 0])[2] < place(P0, [0, 10, 0])[2] - 1);
  // pivot = the receiver's middle: a rotation alone never moves it
  assert.deepEqual(pose({ ...C, roll: 0, pitch: 100, twist: 10 }).p, P0.p);
});
test('exaggeration scales the five secondary axes, clamps at the ends, never the stroke', () => {
  near(pose({ ...C, sway: 54 }, 6).p[0], 0.08 * 6 * RANGE.sway.mm);
  near(pose({ ...C, sway: 90 }, 6).p[0], RANGE.sway.mm);
  near(pose({ ...C, roll: 45 }, 3).r.roll, -0.3 * RANGE.roll.deg * D);
  near(pose({ ...C, stroke: 70 }, 6).p[1], mid(0.7));
});
test('solo: every other axis (the stroke too) held at centre', () => {
  const v = { stroke: 10, surge: 80, sway: 20, twist: 70, roll: 30, pitch: 90 };
  assert.deepEqual(masked(v, 'roll'), { stroke: 50, surge: 50, sway: 50, twist: 50, roll: 30, pitch: 50 });
  assert.deepEqual(masked(v, 'stroke'), { stroke: 10, surge: 50, sway: 50, twist: 50, roll: 50, pitch: 50 });
  assert.equal(masked(v, null), v);
  assert.equal(masked(v, 'bogus'), v);
  const P = pose(masked(v, 'sway'));
  assert.deepEqual(P.r, { twist: 0, roll: 0, pitch: 0 }); near(P.p[2], 0); near(P.p[1], mid(0.5));
});
test('views: you = the wearer\'s eye (their right on the right, their up at the top), facing = its mirror; one scale per view', () => {
  const s = (view, v) => project(view, v);
  assert.deepEqual(Object.keys(VIEWS), ['iso', 'you', 'facing', 'side', 'feet']);
  // you: looking along the shaft (away from the wearer: +y deeper) and down from their head side; +x (their left) on the left,
  // +z (their up) up the picture, further along the shaft = higher in the picture
  const B = basis('you');
  assert.ok(B.away[1] > 0.7 && B.away[2] < -0.3, `you looks down the shaft from above: ${B.away}`);
  assert.ok(s('you', [10, 110, 0])[0] < -8 && s('you', [0, 110, 10])[1] > 7 && s('you', [0, 160, 0])[1] > s('you', [0, 60, 0])[1]);
  // facing: from beyond the receiver back at the wearer: their left (+x) on the RIGHT, their up still up
  assert.ok(basis('facing').away[1] < -0.7 && s('facing', [10, 110, 0])[0] > 8 && s('facing', [0, 110, 10])[1] > 7);
  // side: from their left (camera at +x): their up (+z) to the right, the shaft up; feet: from -z, their left on the right
  assert.ok(s('side', [0, 110, 10])[0] > 9 && Math.abs(s('side', [10, 110, 0])[0]) < 1e-9 && s('side', [0, 120, 0])[1] > 9);
  assert.ok(s('feet', [10, 110, 0])[0] > 9 && s('feet', [0, 110, 10])[2] > 9 && s('feet', [0, 120, 0])[1] > 9);
  for (const v of Object.keys(VIEWS)) {
    const { right: r, up: u, away: a } = basis(v), dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    near(dot(r, r), 1); near(dot(u, u), 1); near(dot(a, a), 1); near(dot(r, u), 0); near(dot(r, a), 0); near(dot(u, a), 0);
    near(r[1] * u[2] - r[2] * u[1], a[0]); near(r[2] * u[0] - r[0] * u[2], a[1]); near(r[0] * u[1] - r[1] * u[0], a[2]);
  }
  // fitted: the whole reachable scene inside the canvas, canvas y down, the same scale whatever the pose
  for (const view of Object.keys(VIEWS)) {
    const px = viewport(view, 200, 160);
    for (const v of [[60, 0, 60], [-60, 230, -60], openingOf(pose({ stroke: 100 }, 6)), openingOf(pose({ stroke: 0, sway: 0 }, 6))]) { const [x, y] = px(v); assert.ok(x >= -1 && x <= 201 && y >= -1 && y <= 161, `${view}: ${v} -> ${x},${y}`); }
  }
  assert.ok(viewport('feet', 200, 160)([0, 100, 0])[1] < viewport('feet', 200, 160)([0, 0, 0])[1]);
});
test('each axis is visible in the view that shows it: the receiver moves on screen there, and not where it is hidden', () => {
  const at = (view, v) => { const px = viewport(view, 240, 200), P = pose(v, 1); return [px(openingOf(P)), px(place(P, [0, SLEEVE.len / 2, SLEEVE.r])), px(place(P, [SLEEVE.r, 0, 0]))]; };
  const moved = (view, id) => { const a = at(view, C), b = at(view, { ...C, [id]: 100 }); return Math.max(...a.map((p, i) => Math.hypot(b[i][0] - p[0], b[i][1] - p[1]))); };
  for (const [view, id] of [['side', 'stroke'], ['side', 'surge'], ['side', 'pitch'], ['feet', 'sway'], ['feet', 'roll'], ['feet', 'stroke'],
    ['you', 'sway'], ['you', 'twist'], ['you', 'surge'], ['you', 'stroke'], ['facing', 'sway'], ['facing', 'twist']]) assert.ok(moved(view, id) > 5, `${id} in ${view}: ${moved(view, id)}`);
  assert.ok(moved('side', 'sway') < 3 && moved('feet', 'surge') < 3, 'along the camera: no sideways move');
  for (const id of IDS) assert.ok(moved('iso', id) > 3, `${id} shows in the 3/4 view`);
  // you vs facing: sway moves the opening the opposite way on screen (+ = the wearer's left: LEFT as they see it), roll tips the
  // top the opposite way (mirrored sense), twist turns the opposite way round
  const d = (view, id, k, j = 0) => { const a = at(view, C)[k], b = at(view, { ...C, [id]: 100 })[k]; return b[j] - a[j]; };
  assert.ok(d('you', 'sway', 0) < -5 && d('facing', 'sway', 0) > 5 && d('feet', 'sway', 0) > 5, `sway: you ${d('you', 'sway', 0)}, facing ${d('facing', 'sway', 0)}`);
  assert.ok(d('you', 'roll', 1) < -3 && d('facing', 'roll', 1) > 3 && d('feet', 'roll', 1) > 5, `roll: you ${d('you', 'roll', 1)}, facing ${d('facing', 'roll', 1)}, feet ${d('feet', 'roll', 1)}`);
  // twist + = counter-clockwise as the wearer sees it: the receiver's left side (local +x, on screen left) swings DOWN in "you"
  // (canvas y grows), and the mirror in "facing" (on screen right, also swinging down: clockwise there)
  assert.ok(d('you', 'twist', 2, 1) > 5 && d('you', 'twist', 2, 0) > 3, `twist you: ${d('you', 'twist', 2, 0)}, ${d('you', 'twist', 2, 1)}`);
  assert.ok(d('facing', 'twist', 2, 1) > 5 && d('facing', 'twist', 2, 0) < -3, `twist facing: ${d('facing', 'twist', 2, 0)}, ${d('facing', 'twist', 2, 1)}`);
  // the stripe / nub (the receiver's up side) faces the camera in you / facing (nearer than the middle), behind it from the feet
  const depth = (view) => { const px = viewport(view, 240, 200), P = pose(C); return px(place(P, [0, 0, SLEEVE.r]))[2] - px(P.p)[2]; };
  assert.ok(depth('you') < -10 && depth('facing') < -5 && depth('feet') > 10, `${depth('you')} ${depth('facing')} ${depth('feet')}`);
});
test('the remembered view: every view key, and older saved names stay valid', () => {
  for (const v of Object.keys(VIEWS)) { assert.equal(viewOf(v), v); assert.ok(VIEWS[v].label && VIEWS[v].tip); }
  assert.equal(viewOf('rear'), 'feet'); assert.equal(viewOf('top'), 'facing'); assert.equal(viewOf('front'), 'facing');
  assert.equal(viewOf(undefined), 'iso'); assert.equal(viewOf('bogus'), 'iso');
  assert.match(VIEWS.you.tip, /wearer/); assert.match(VIEWS.you.tip, /your right on the picture’s right/);
  assert.match(VIEWS.facing.tip, /your right is on the picture’s LEFT/); assert.match(VIEWS.feet.tip, /picture’s LEFT/);
});test('values, trail and the source', () => {
  const s = { stroke: [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }], sway: [{ at: 0, pos: 50 }, { at: 1000, pos: 90 }] };
  const v = valuesAt(s, 500, posAt);
  near(v.stroke, 50); near(v.sway, 70); assert.ok(Number.isNaN(v.roll));
  const tp = trail(s, 1000, posAt, { n: 10 });
  assert.equal(tp.length, 11);
  near(tp[10][1], openingOf(pose({ stroke: 100, sway: 90 }))[1]); near(tp[0][1], openingOf(pose({ stroke: 0, sway: 50 }))[1]);   // oldest first
  near(trail(s, 1000, posAt, { n: 10, solo: 'stroke' })[10][0], 0);   // solo stroke: no sway in the path
  const lanes = { stroke: [{ at: 0, pos: 1 }], sway: [{ at: 0, pos: 2 }] }, ghost = [{ at: 0, pos: 9 }];
  assert.deepEqual(pickScripts(null, lanes), { scripts: { stroke: lanes.stroke, surge: null, sway: lanes.sway, twist: null, roll: null, pitch: null }, src: 'script' });
  const f = pickScripts({ sway: ghost }, lanes);
  assert.equal(f.src, 'unapplied'); assert.equal(f.scripts.sway, ghost); assert.equal(f.scripts.stroke, lanes.stroke);
  assert.equal(pickScripts({}, lanes).src, 'script');
});
test('data in this shot, and the measurement quality at t', () => {
  const s = [{ at: 1000, pos: 50 }, { at: 2000, pos: 70 }];
  assert.ok(hasData(s, null)); assert.ok(!hasData([], null)); assert.ok(!hasData(null, { start_ms: 0, end_ms: 9 }));
  assert.ok(hasData(s, { start_ms: 1500, end_ms: 3000 })); assert.ok(hasData(s, { start_ms: 1200, end_ms: 1800 }));   // a line through the shot
  assert.ok(!hasData(s, { start_ms: 3000, end_ms: 4000 }));
  const segs = [{ t0: 0, t1: 1000, label: 'none' }, { t0: 1000, t1: 2000, label: 'measured', from: 'rot' }, { t0: 2000, t1: 3000, label: 'estimate', guessed: true }, { t0: 3000, t1: 4000, label: 'measured', frame: { refGuess: true } }];
  assert.equal(qualityAt(segs, 500), null);
  assert.deepEqual(qualityAt(segs, 1500), { label: 'measured', guessed: false, frame: null, from: 'rot' });
  assert.equal(qualityAt(segs, 2500).guessed, true);
  assert.ok(qualityAt(segs, 3500).frame && qualityAt(segs, 3500).guessed);
  assert.equal(qualityAt(undefined, 1), null);
});
test('gauges: bars for translations (stroke from the deep end, the others about a centre mark), arcs for rotations', () => {
  assert.deepEqual(gauge('stroke', 25), { kind: 'bar', has: true, v: 25, f: 0.25, centre: false });
  assert.deepEqual(gauge('sway', 75), { kind: 'bar', has: true, v: 75, f: 0.75, centre: true });
  assert.deepEqual(gauge('surge', 140), { kind: 'bar', has: true, v: 100, f: 1, centre: true });
  near(gauge('roll', 100).a, ARC); near(gauge('twist', 0).a, -ARC); near(gauge('pitch', 50).a, 0);
  assert.equal(gauge('pitch', NaN).has, false); near(gauge('pitch', NaN).a, 0);
  assert.equal(gauge('stroke', undefined).has, false);
});
test('hull: a tilted cylinder outline', () => {
  const h = hull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 0.5]]);
  assert.equal(h.length, 4);
  assert.ok(!h.some(([x, y]) => x === 1));
});
test('the box: default bottom-left, kept inside the stage, moved / resized and stored as where it sits in the free room', () => {
  const W = 1000, H = 600, L = layout(BOX.w), d = boxOf(null, W, H);
  assert.deepEqual(d, { x: BOX.gap, y: H - L.h - BOX.gapB, w: BOX.w, h: L.h });
  assert.deepEqual(boxOf({ fx: 'x', fy: -1, w: 'big' }, W, H), d);   // broken settings: the default
  assert.equal(layout(300).gauges.length, 6); assert.ok(layout(300).gauges.every((g) => g.y + g.h <= layout(300).h));
  const m = boxMove(d, 5000, -5000, W, H);
  assert.deepEqual([m.fx, m.fy, m.w], [1, 0, BOX.w]);
  const b = boxOf(m, W, H);
  assert.deepEqual([b.x, b.y], [W - BOX.w - BOX.gap, BOX.gap]);
  near(boxOf(boxStore(300, 100, 260, W, H), W, H).x, 300, 0.1);
  // resize from the top-right grip: the bottom-left corner stays; limits hold
  const r = boxOf(boxResize(d, 60, 0, W, H), W, H);
  assert.equal(r.w, BOX.w + 60); near(r.x, d.x); near(r.y + r.h, d.y + d.h);
  assert.equal(boxOf(boxResize(d, -999, 0, W, H), W, H).w, BOX.min);
  assert.equal(boxResize(d, 0, -40, W, H).w > BOX.w, true);   // dragging up grows too
  // a small stage: shrunk to fit, never outside
  const s = boxOf({ w: 500 }, 400, 300);
  assert.ok((s.w <= 400 && s.h <= 300 - BOX.gap - BOX.gapB) || s.w === BOX.min, JSON.stringify(s));
  assert.ok(s.x >= BOX.gap && s.y >= BOX.gap, JSON.stringify(s));
});
