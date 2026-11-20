// paw-4c48.8: the position bar ON THE SHAFT, pure parts: lib/shaft.js railContext / railAt (the rail's ends from the tracked
// shaft: pos 0 at the hilt, 100 at the tip, the owner's marks), features/video/posbar.js shaftBar / posOn / lookOf / lookDrag /
// holdRail. A synthetic shot: an oblique shaft (-40 deg, square units) of full length 0.3 frame heights thrusting into a fixed
// entry, its visible share vis(t) = 0.6 + 0.3 cos (1 s strokes), stored channels only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { railContext, railAt, RAIL_MIN } from '../src/lib/shaft.js';
import { shaftBar, posOn, lookOf, lookDrag, holdRail, barPoint, LOOK_DEFAULT, TRIM } from '../src/features/video/posbar.js';
import { channelOf } from '../src/lib/runs.js';

const A = 16 / 9, N = 120, T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / 30));
const ANG = (-40 * Math.PI) / 180, U = [Math.cos(ANG), Math.sin(ANG)], LF = 0.3, E = [0.62 * A, 0.38];
const vis = (t) => 0.6 + 0.3 * Math.cos((2 * Math.PI * t) / 1000);
const base = (t) => [E[0] - vis(t) * LF * U[0], E[1] - vis(t) * LF * U[1]];   // square units
const near = (p, q, tol = 1e-3) => Math.hypot((p[0] - q[0]) * A, p[1] - q[1]) < tol;

function run({ conf = () => 1, gap = () => false } = {}) {
  const ch = (f) => channelOf(T.map((t, i) => { const v = f(t, i); return [t, v === v && v != null ? v : null]; }));
  const P = 'sem_c2_penis_';
  return { id: 'r', range: { start: 0, end: 4000 }, flips: [], scenes: [{ start_ms: 0, end_ms: 4000, sign: 1, shaft: { c2_penis: { source: 'sam', full: 'seen', l_full_w: 5 } } }],
    channels: {
      [P + 'len']: ch((t, i) => (gap(i) ? NaN : vis(t))), [P + 'in']: ch((t, i) => (gap(i) ? NaN : 1 - vis(t))), [P + 'in_conf']: ch((t, i) => (gap(i) ? 0 : conf(t, i))),
      [P + 'bx']: ch((t, i) => (gap(i) ? NaN : base(t)[0] / A)), [P + 'by']: ch((t, i) => (gap(i) ? NaN : base(t)[1])),
      [P + 'ex']: ch((t, i) => (gap(i) ? NaN : E[0] / A)), [P + 'ey']: ch((t, i) => (gap(i) ? NaN : E[1])), [P + 'w']: ch((t, i) => (gap(i) ? NaN : 0.05)),
    } };
}
const hiltT = 500, outT = 0;   // vis 0.3 at 500 ms (deepest), 0.9 at 0 ms (shallowest)

// paw-4c48 (the owner's "shaft depth is driven from the largest and smallest that agree with motion"): unmarked, pos 0 is the
// smallest visible share that recurs over the strokes (0.3 here) and 100 the largest (0.9), so depth = (vis - 0.3) / 0.6
const depthOf = (t) => (vis(t) - 0.3) / 0.6;
test('the rail lies along the shaft: pos 0 at the smallest recurring visible length, 100 at the largest; the measured entry reads the depth between', () => {
  const ctx = railContext(run(), 0, null, { aspect: A });
  assert.equal(ctx.name, 'c2_penis');
  assert.ok(Math.abs(ctx.Lf - LF) < 1e-3, `full length ${ctx.Lf}`);
  assert.ok(Math.abs(ctx.a - 0.3) < 2e-3 && Math.abs(ctx.b - 0.9) < 2e-3, `the scale ${ctx.a} .. ${ctx.b} (${ctx.scale})`);
  for (const t of [0, 250, 500, 1700]) {
    const r = railAt(ctx, t, A), b = base(t);
    assert.ok(near(r.D, [(b[0] + 0.3 * LF * U[0]) / A, b[1] + 0.3 * LF * U[1]], 2e-3), `t ${t}: pos 0 at 30 % of the shaft from the base`);
    assert.ok(near(r.O, [(b[0] + 0.9 * LF * U[0]) / A, b[1] + 0.9 * LF * U[1]], 2e-3), `t ${t}: pos 100 at 90 %`);
    const bar = shaftBar(r, LOOK_DEFAULT, false, A);
    assert.ok(Math.abs(posOn(bar, bar.entry, A) - 100 * depthOf(t)) < 0.5, `t ${t}: measured ${posOn(bar, bar.entry, A).toFixed(1)} vs ${(100 * depthOf(t)).toFixed(1)}`);
    // the script's marker: barPoint at the script's pos; the script = the truth -> on the measured entry
    assert.ok(near(barPoint(bar, 100 * depthOf(t)), r.entry, 2e-3), `t ${t}: the script marker on the measured entry`);
    assert.ok(!near(barPoint(bar, 100 * depthOf(t) + (depthOf(t) > 0.5 ? -20 : 20)), r.entry, 0.02), 'an offset script sits apart');
  }
});

test('the owner\'s marks: pos 0 where it was hilted, 100 where it was fully out', () => {
  const ctx = railContext(run(), 0, { hilt: hiltT, out: outT }, { aspect: A });
  assert.ok(Math.abs(ctx.a - vis(hiltT)) < 1e-3 && Math.abs(ctx.b - vis(outT)) < 1e-3);
  const r = railAt(ctx, 1500, A), b = base(1500), at = (f) => [(b[0] + f * LF * U[0]) / A, b[1] + f * LF * U[1]];
  assert.ok(near(r.D, at(vis(hiltT))) && near(r.O, at(vis(outT))));
  const bar = shaftBar(r, LOOK_DEFAULT, false, A);
  assert.ok(Math.abs(posOn(bar, bar.entry, A) - 0) < 0.5, 'at the hilted moment the measured entry reads 0');
  const b2 = shaftBar(railAt(ctx, 2000, A), LOOK_DEFAULT, false, A);
  assert.ok(Math.abs(posOn(b2, b2.entry, A) - 100) < 0.5, 'fully out reads 100');
});

test('time interpolation between frames, and no rail where the shaft is not read', () => {
  const ctx = railContext(run(), 0, null, { aspect: A });
  const a = railAt(ctx, T[10], A), b = railAt(ctx, T[11], A), m = railAt(ctx, (T[10] + T[11]) / 2, A);
  assert.ok(near(m.D, [(a.D[0] + b.D[0]) / 2, (a.D[1] + b.D[1]) / 2], 1e-4));
  assert.equal(railAt(ctx, 9000, A), null, 'outside the scene');
  const low = railContext(run({ conf: (t) => (t < 1000 ? 1 : 0.2) }), 0, null, { aspect: A });
  assert.ok(low.why && /no shaft read in this shot/.test(low.why) && RAIL_MIN > 0.25, low.why);
  assert.match(railContext({ channels: {}, scenes: [] }, 0).why, /no shaft read/);
});

test('a dropout holds the last good placement (faint), never across shots; the held frames say so', () => {
  const ctx = railContext(run({ gap: (i) => i >= 40 && i < 70 }), 0, null, { aspect: A });
  const r = railAt(ctx, T[55], A);
  assert.equal(r.held, true);
  const good = shaftBar(railAt(ctx, T[39], A), LOOK_DEFAULT, false, A);
  let H = holdRail(null, good, false, 0);
  assert.equal(H.faint, false);
  H = holdRail(H.prev, shaftBar(r, LOOK_DEFAULT, false, A), r.held, 0);
  assert.ok(H.faint && H.bar === good, 'held: the last good bar, faint');
  assert.equal(holdRail(H.prev, null, true, 5000).bar, null, 'another shot: nothing held (the hand-placed bar shows)');
});

test('the look: flip, trims, offsets, cleaned settings; dragging on the bar', () => {
  const r = { D: [0.2, 0.8], O: [0.5, 0.3], entry: [0.35, 0.55], w: 0.05 };
  const b = shaftBar(r, LOOK_DEFAULT, false, A), f = shaftBar(r, LOOK_DEFAULT, true, A);
  assert.ok(near([b.x0, b.y0], r.D) && near([b.x1, b.y1], r.O));
  assert.ok(near([f.x0, f.y0], r.O) && near([f.x1, f.y1], r.D), 'flipped: 0 at the tip');
  assert.ok(Math.abs(posOn(f, r.entry, A) - (100 - posOn(b, r.entry, A))) < 1e-6);
  const t = shaftBar(r, { ...LOOK_DEFAULT, trim0: 0.1, trim1: 0.2 }, false, A);
  assert.ok(near([t.x0, t.y0], barPoint({ x0: 0.2, y0: 0.8, x1: 0.5, y1: 0.3 }, 10)) && near([t.x1, t.y1], barPoint({ x0: 0.2, y0: 0.8, x1: 0.5, y1: 0.3 }, 80)));
  const o = shaftBar(r, { ...LOOK_DEFAULT, across: 0.2 }, false, A), L = Math.hypot(0.3 * A, 0.5);
  assert.ok(Math.abs(Math.hypot((o.x0 - b.x0) * A, o.y0 - b.y0) - 0.2 * L) < 1e-9 && Math.abs(posOn(o, o.entry, A) - posOn(b, r.entry, A)) < 1e-9, 'beside the shaft: same reading');
  assert.deepEqual(lookOf(null), { ...LOOK_DEFAULT, flips: [] });
  assert.equal(lookOf({ trim0: 9, opacity: 0, color: 'pink', flips: [1, 'x'] }).trim0, TRIM[1]);
  assert.deepEqual(lookOf({ color: 'pink', flips: [1, 'x'] }).flips, [1]);
  const D = [0, 0], O = [1, 0];
  assert.equal(lookDrag(LOOK_DEFAULT, 'deep', 0.1, 0, D, O, 1).trim0, 0.1);
  assert.equal(lookDrag(LOOK_DEFAULT, 'out', -0.1, 0, D, O, 1).trim1, 0.1);
  const m = lookDrag(LOOK_DEFAULT, 'body', 0.05, 0.1, D, O, 1);
  assert.ok(m.along === 0.05 && m.across === 0.1);
});
