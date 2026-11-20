import assert from 'node:assert/strict';
import { isValid } from '../src/lib/core/script.js';
import { posToY, yToPos, hitPoint, hitSegment, boxSelect, lod, envelope, snapFrame, snapTime, extremes, bounds, boxRect, hitHandle, dragBox, mapThroughBox, wheelIntent, durationOf } from '../src/features/lanes/geom.js';
import * as S from '../src/features/lanes/select.js';
import { moveLimits, applyMove, resolveMove, applyBox, boxLimits, minBoxSpan } from '../src/features/lanes/drag.js';
import * as O from '../src/features/lanes/ops.js';
import { fitRecording, pushSample } from '../src/features/lanes/record.js';

const s = [{ at: 0, pos: 0 }, { at: 100, pos: 100 }, { at: 200, pos: 0 }, { at: 300, pos: 100 }, { at: 400, pos: 50 }];
const view = { start: 0, span: 1000 }, W = 1000, H = 120;

// ---- pos <-> y ----
assert.equal(posToY(H, 100), 10);
assert.equal(posToY(H, 0), 110);
assert.ok(Math.abs(yToPos(H, posToY(H, 37)) - 37) < 1e-9);

// ---- hit testing ----
assert.equal(hitPoint(s, view, W, H, 101, posToY(H, 100) + 2), 1);
assert.equal(hitPoint(s, view, W, H, 150, 60), -1);
assert.equal(hitPoint(s, view, W, H, 300, posToY(H, 100), 7, 0), -1, 'too many candidates -> no hit');
const dense = Array.from({ length: 1000 }, (_, i) => ({ at: i, pos: 50 }));
assert.equal(hitPoint(dense, view, W, H, 500, posToY(H, 50)), -1, 'dense: points not individually grabbable');
assert.equal(hitPoint(dense, { start: 495, span: 10 }, W, H, 500, posToY(H, 50)), 500);
assert.equal(hitSegment(s, view, W, H, 50, posToY(H, 50)), 1);
assert.equal(hitSegment(s, view, W, H, 50, posToY(H, 90)), -1);

// ---- box select ----
assert.deepEqual(boxSelect(s, view, W, H, 90, 0, 310, posToY(H, 90)), [100, 300]);
assert.deepEqual(boxSelect(s, view, W, H, 310, H, 90, 0), [100, 200, 300], 'any corner order');

// ---- LOD ----
assert.deepEqual(lod(80, 1000), { envelope: false, handles: true, heat: true });
assert.deepEqual(lod(100, 1000), { envelope: false, handles: false, heat: true }, 'handles need ~12 px between points (QA: roll lane read as oooo)');
assert.deepEqual(lod(400, 1000), { envelope: false, handles: false, heat: false }, 'speed colours only on segments >= 3 px');
assert.deepEqual(lod(600, 1000), { envelope: true, handles: false, heat: false }, 'envelope from 2 px per point (QA: solid block at mid zoom)');
assert.deepEqual(lod(100000, 1000), { envelope: true, handles: false, heat: false });
const big = Array.from({ length: 100000 }, (_, i) => ({ at: i * 10, pos: i % 2 ? 100 : 0 }));
const e = envelope(big, 0, big.length, { start: 0, span: 1e6 }, 1000, H, null);
assert.equal(e.w, 1000);
assert.equal(e.min[0], posToY(H, 100));
assert.equal(e.max[0], posToY(H, 0));
const e2 = envelope(s, 0, s.length, view, 1000, H, null, e);
assert.equal(e2, e, 'buffers reused');
assert.ok(Number.isNaN(e2.first[50]) && e2.first[100] === posToY(H, 100));

// ---- snapping ----
assert.equal(snapFrame(50, 1000 / 30), 67);
assert.equal(snapFrame(16, 1000 / 30), 0);
assert.deepEqual(snapTime(510, 1000 / 30, [500, 900], 20), { t: 500, target: true });
assert.deepEqual(snapTime(560, 1000 / 30, [500, 900], 20), { t: 567, target: false });
assert.deepEqual(extremes(s).map((a) => a.at), [0, 100, 200, 300, 400]);
assert.deepEqual(extremes([{ at: 0, pos: 0 }, { at: 1, pos: 50 }, { at: 2, pos: 100 }, { at: 3, pos: 100 }, { at: 4, pos: 0 }]).map((a) => a.at), [0, 2, 4]);

// ---- selection sets ----
const a = new Set([100, 200]);
assert.deepEqual([...S.union(a, [300])], [100, 200, 300]);
assert.deepEqual([...S.subtract(a, [100])], [200]);
assert.deepEqual([...S.toggle(a, 100)], [200]);
assert.deepEqual([...S.toggle(a, 0)].sort((x, y) => x - y), [0, 100, 200]);
assert.deepEqual([...S.invert(s, a)], [0, 300, 400]);
assert.deepEqual([...S.inRange(s, 150, 350)], [200, 300]);
assert.deepEqual([...S.combine(a, [0], 'add')].sort((x, y) => x - y), [0, 100, 200]);
assert.deepEqual([...S.combine(a, [100], 'sub')], [200]);
// drag on empty space (Blender): plain = box (time x pos), Shift adds, Ctrl subtracts, Ctrl+Shift = every point from time to time (full height), Alt = range
const mods = (o = {}) => ({ altKey: false, shiftKey: false, ctrlKey: false, ...o });
assert.equal(S.boxMode(mods()), 'replace');
assert.equal(S.boxMode(mods({ shiftKey: true })), 'add');
assert.equal(S.boxMode(mods({ shiftKey: true, ctrlKey: true })), 'span');
assert.equal(S.boxMode(mods({ ctrlKey: true })), 'sub');
assert.equal(S.boxMode(mods({ altKey: true, shiftKey: true })), 'time');
assert.deepEqual(boxSelect(s, view, W, H, 90, 0, 310, posToY(H, 90)), [100, 300], 'box: only the high points');
assert.deepEqual([...S.combine(a, S.inRange(s, 310, 90), 'span')], [100, 200, 300], 'span: every point in the time span, any height, either direction');
assert.deepEqual(S.indices(s, new Set([300, 100, 999])), [1, 3]);
// select connected (Blender L): the stroke between the turning points around each selected point
{
  const z = [{ at: 0, pos: 0 }, { at: 50, pos: 40 }, { at: 100, pos: 100 }, { at: 150, pos: 60 }, { at: 200, pos: 0 }, { at: 300, pos: 100 }];
  assert.deepEqual([...S.connected(z, new Set([50]))].sort((x, y) => x - y), [0, 50, 100], 'mid-stroke point: its up-stroke');
  assert.deepEqual([...S.connected(z, new Set([100]))].sort((x, y) => x - y), [0, 50, 100, 150, 200], 'a turn: both strokes it joins');
  assert.deepEqual([...S.connected(z, new Set([150, 300]))].sort((x, y) => x - y), [100, 150, 200, 300]);
  assert.deepEqual([...S.connected(z, new Set())], []);
}
assert.notEqual(S.union(a, []), a, 'always a new Set');

// ---- drag: limits, clamp, push, dup ----
let L = moveLimits(s, [1, 2], 'clamp');
assert.deepEqual(L, { dtMin: -99, dtMax: 99, dpMin: 0, dpMax: 0 });
L = moveLimits(s, [1, 3], 'clamp');
assert.equal(L.dtMin, -99); assert.equal(L.dtMax, 99);
L = moveLimits(s, [1, 2], 'clamp', 34);
assert.deepEqual([L.dtMin, L.dtMax], [-66, 66]);
assert.equal(moveLimits(s, [0], 'clamp').dtMin, 0, 'cannot go before 0');
let m = applyMove(s, [1, 2], 50, 0, 'clamp');
assert.deepEqual(m.map((x) => x.at), [0, 150, 250, 300, 400]); assert.ok(isValid(m));
assert.deepEqual(s[1], { at: 100, pos: 100 }, 'input untouched');
m = applyMove(s, [1], 250, 0, 'push');
assert.deepEqual(m.map((x) => x.at), [0, 350, 450, 550, 650], 'push right: everything after moves'); assert.ok(isValid(m));
m = applyMove(s, [3], -50, 0, 'push');
assert.deepEqual(m.map((x) => x.at), [-50, 50, 150, 250, 400].map((t, i) => (i < 4 ? t : 400)));
assert.equal(moveLimits(s, [3], 'push').dtMin, 0, 'push left stops when the first point reaches 0');
m = applyMove(s, [1, 2], 1000, 0, 'dup');
assert.deepEqual(m.map((x) => x.at), [0, 100, 200, 300, 400, 1100, 1200]); assert.ok(isValid(m));
m = applyMove(s, [0, 1], 250, 0, 'dup');
assert.deepEqual(m.map((x) => x.at), [0, 100, 200, 250, 350, 400], 'dup replaces what was in the copy span'); assert.ok(isValid(m));

// resolveMove: snapping, clamping onto frames, constraint, pos clamp
const F = 1000 / 30;
const base = { script: s, idx: [1], anchor: 1, mode: 'clamp', fms: F, snap: true, targets: [], tolMs: 0, constrain: false, dxPx: 0, dyPx: 0, minGap: 1 };
assert.deepEqual(resolveMove({ ...base, t: 140, pos: 100 }), { dt: 33, dp: 0, target: false }, '140 snaps to frame 4 = 133');
assert.deepEqual(resolveMove({ ...base, t: 140, pos: 100, snap: false }), { dt: 40, dp: 0, target: false });
assert.equal(resolveMove({ ...base, t: 900, pos: 100 }).dt, 67, 'clamped before the neighbour at 200, onto frame 5 = 167');
assert.equal(resolveMove({ ...base, t: 900, pos: 100, snap: false }).dt, 99);
assert.deepEqual(resolveMove({ ...base, t: 160, pos: 40, constrain: true, dxPx: 2, dyPx: 30 }), { dt: 0, dp: -60, target: false }, 'constrain to pos');
assert.equal(resolveMove({ ...base, t: 160, pos: 40, constrain: true, dxPx: 30, dyPx: 2 }).dp, 0, 'constrain to time');
assert.equal(resolveMove({ ...base, t: 100, pos: 150 }).dp, 0, 'pos clamped at 100');
assert.equal(resolveMove({ ...base, t: 155, pos: 100, targets: [150], tolMs: 10 }).target, true);

// ---- transform box ----
const idx = [1, 2, 3], b = bounds(s, idx);
assert.deepEqual(b, { t0: 100, t1: 300, p0: 0, p1: 100 });
const r = boxRect(b, view, W, H);
assert.equal(hitHandle(r, 300, posToY(H, 100)), 'ne');
assert.equal(hitHandle(r, 200, posToY(H, 0) + 1), 's');
assert.equal(hitHandle(r, 200, 60), null);
const lim = boxLimits(s, idx);
assert.deepEqual(lim, { tMin: 1, tMax: 399, minSpan: 2 });
let nb = dragBox(b, 'n', 0, 50, false, lim);
assert.deepEqual(nb, { t0: 100, t1: 300, p0: 0, p1: 50 });
assert.deepEqual(mapThroughBox({ at: 300, pos: 100 }, b, nb), { at: 300, pos: 50 });
nb = dragBox(b, 'e', 1000, 0, false, lim);
assert.equal(nb.t1, 399, 'stretch stops before the next neighbour');
nb = dragBox(b, 'w', 250, 0, true, lim);
assert.deepEqual([nb.t0, nb.t1], [150, 250], 'symmetric stretch about the centre');
nb = dragBox(b, 's', 0, 100, false, lim);
let out = applyBox(s, idx, b, nb);
assert.deepEqual(out.script.map((x) => x.pos), [0, 100, 100, 100, 50], 'top fixed, bottom dragged to top: flat');
out = applyBox(s, idx, b, { t0: 100, t1: 200, p0: 0, p1: 100 });
assert.deepEqual(out.script.map((x) => x.at), [0, 100, 150, 200, 400]); assert.ok(isValid(out.script));
assert.deepEqual(out.ats, [100, 150, 200]);
assert.equal(minBoxSpan([{ at: 0, pos: 0 }, { at: 1, pos: 0 }, { at: 101, pos: 0 }], [0, 1, 2]), 101);
// flat selection still scales about its centre without NaN
const flat = [{ at: 0, pos: 40 }, { at: 10, pos: 40 }];
assert.deepEqual(applyBox(flat, [0, 1], { t0: 0, t1: 10, p0: 40, p1: 40 }, { t0: 0, t1: 10, p0: 60, p1: 60 }).script.map((x) => x.pos), [60, 60]);

// ---- wheel ----
assert.equal(wheelIntent({ deltaY: 100, deltaX: 0, ctrlKey: false, shiftKey: false }).kind, 'zoom');
assert.equal(wheelIntent({ deltaY: 100, deltaX: 0, ctrlKey: false, shiftKey: true }).kind, 'pan');
assert.equal(wheelIntent({ deltaY: 100, deltaX: 0, ctrlKey: true, shiftKey: false }).kind, 'height');
assert.equal(wheelIntent({ deltaY: 3.2, deltaX: 0, ctrlKey: true, shiftKey: false }).kind, 'zoom', 'touchpad pinch');
assert.ok(wheelIntent({ deltaY: -100, deltaX: 0 }).amount < 1, 'wheel up zooms in');
assert.equal(durationOf({ media: { durationMs: 5000 }, axes: {} }), 5000);
assert.equal(durationOf({ axes: { stroke: [{ at: 90000, pos: 0 }] } }), 100000);

// ---- ops (what lib/edit lacks) ----
const ghost = [{ at: 150, pos: 20 }, { at: 250, pos: 80 }, { at: 350, pos: 20 }];
assert.deepEqual(O.acceptGhost(s, { t0: 140, t1: 260 }, { ghost }).script.map((x) => x.at), [0, 100, 150, 250, 300, 400]);
assert.deepEqual(O.acceptGhost(s, null, { ghost, mode: 'merge' }).script.length, 8);
const ag = O.acceptGhost(s, null, { ghost });
assert.deepEqual(ag.script.map((x) => x.at), [0, 100, 150, 250, 350, 400], 'whole ghost replaces its own span');
assert.deepEqual(ag.ats, [150, 250, 350]); assert.ok(isValid(ag.script));
assert.equal(O.acceptGhost(s, { t0: 900, t1: 950 }, { ghost }).script, s, 'nothing to take: unchanged');
assert.equal(O.nextIndex(s, 100), 2); assert.equal(O.prevIndex(s, 100), 0); assert.equal(O.nextIndex(s, 400), -1);
assert.equal(O.posAtInt(s, 50), 50); assert.equal(O.posAtInt([], 50), 50);
// seekIndex works in frame space: from a frame start (1291.67 / 1333.33 at 24 fps) the next press moves on, never
// finds the same integer-ms point again (QA: , / . stuck on 1292 and 1333 at cfr24)
{
  const f24 = 1000 / 24, fr = (ms) => Math.floor((ms + 0.6) / f24), pts = [500, 1292, 1333, 2000, 3000].map((at) => ({ at, pos: 50 }));
  const walk = (t, dir) => { const out = []; for (let k = 0; k < 6; k++) { const i = O.seekIndex(pts, t, dir, fr); if (i < 0) break; out.push(pts[i].at); t = fr(pts[i].at) * f24; } return out; };
  assert.deepEqual(walk(2500, -1), [2000, 1333, 1292, 500]);
  assert.deepEqual(walk(800, 1), [1292, 1333, 2000, 3000]);
  assert.equal(O.seekIndex(pts, 3000, 1, fr), -1);
  assert.equal(O.seekIndex(pts, 1291.6667, 1, fr), 2, 'the point in the current frame is not "next"');
  assert.equal(O.seekIndex(pts, 1333.3333, -1, fr), 1, 'nor "previous"');
}

// ---- recording ----
const samples = [];
for (let t = 0; t <= 2000; t += 16.7) samples.push({ t, pos: 50 + 50 * Math.sin((t / 1000) * Math.PI * 2) + (Math.random() - 0.5) });
const fit = fitRecording(samples, { eps: 4 });
assert.ok(isValid(fit));
assert.ok(fit.length >= 5 && fit.length < 40, 'a sine second becomes a handful of points, got ' + fit.length);
assert.ok(fit.some((p) => p.pos >= 97) && fit.some((p) => p.pos <= 3), 'extremes survive');
const steps = [];
for (let t = 0; t < 1000; t += 16) steps.push({ t, pos: t < 500 ? 20 : 80 });
assert.deepEqual(fitRecording(steps).map((p) => p.pos), [20, 20, 80, 80], 'held keys become a step');
// loop playback: when time jumps back the later pass replaces the earlier one (QA: passes merged into a 3 ms zigzag)
{
  const rec = [];
  for (let t = 2000; t <= 2600; t += 16) pushSample(rec, { t, pos: ((t - 2000) / 600) * 100 });          // pass 1: ramp up
  for (let t = 2003; t <= 2600; t += 16) pushSample(rec, { t, pos: 100 - ((t - 2003) / 600) * 100 });    // pass 2 (wrapped): ramp down
  assert.ok(rec.every((x, i) => !i || x.t > rec[i - 1].t), 'monotonic');
  assert.equal(rec[0].t, 2003, 'the first pass is gone, no seam sample left beside the new one');
  const r = fitRecording(rec);
  assert.ok(r.length <= 3 && r[0].pos === 100 && r[r.length - 1].pos <= 2, 'one clean ramp down: ' + JSON.stringify(r));
  const small = [{ t: 100, pos: 1 }, { t: 116, pos: 2 }];
  pushSample(small, { t: 90, pos: 3 });   // jitter inside the 50 ms window: kept, merged by time later
  assert.equal(small.length, 3);
}
