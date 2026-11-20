// Device simulator drawing (src/features/video/simdraw.js): geometry, the allocation-free sim, axis
// indicators, and the painter against a recording fake context (the piston head lands exactly on posAt).
import test from 'node:test';
import assert from 'node:assert/strict';
import { simGeometry, posToY, yToPos, timeToX, simInto, planInto, missAt, LANE_PAD, clampSimWidth, axisKind, axisAngle, axisValue, axesGrid,
  makeSimState, drawGraph, drawAxes, readColors, simDebug, rampIndex, rampOf, SIM_MIN_W, SIM_MAX_W,
  clampLead, SIM_LEAD, meteorSpeed, turnInto, pulseOf, PULSE_MS } from '../src/features/video/simdraw.js';
import { simAt } from '../src/features/video/sim.js';
import { posAt } from '../src/lib/core/script.js';
import { PAD } from '../src/features/lanes/geom.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const script = [{ at: 1000, pos: 10 }, { at: 1400, pos: 90 }, { at: 1500, pos: 0 }, { at: 3000, pos: 60 }, { at: 3010, pos: 100 }];

/** A 2D context that records what matters: fillRect calls with their fillStyle and globalAlpha, path points (moveTo /
 *  lineTo, with the strokeStyle then), drawImage calls with their alpha. */
function fakeCtx() {
  const rects = [], frames = [], pts = [], images = [];
  const ctx = new Proxy({ rects, frames, pts, images, fillStyle: '', strokeStyle: '', globalAlpha: 1, globalCompositeOperation: 'source-over' }, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'fillRect') return (x, y, w, h) => rects.push({ x, y, w, h, fill: o.fillStyle, alpha: o.globalAlpha });
      if (k === 'strokeRect') return (x, y, w, h) => frames.push({ x, y, w, h, stroke: o.strokeStyle });
      if (k === 'moveTo' || k === 'lineTo') return (x, y) => pts.push({ k, x, y, stroke: o.strokeStyle });
      if (k === 'drawImage') return (img, x, y, w, h) => images.push({ img, x, y, w, h, alpha: o.globalAlpha });
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
  return ctx;
}
const C = readColors(() => '');

test('width clamps to 120..420 and survives junk', () => {
  assert.equal(clampSimWidth(50), SIM_MIN_W);
  assert.equal(clampSimWidth(900), SIM_MAX_W);
  assert.equal(clampSimWidth(200.4), 200);
  assert.equal(clampSimWidth(undefined), 168);
});

test('geometry (paw-gwmd): the rail docked beside the video, the next lead ms come in from the far edge, pos 100 at the top', () => {
  const g = simGeometry({}, 168, 400, 1000, 'right');   // the panel right of the video: the rail at its left edge
  close(g.nowX, g.left + g.hw); assert.ok(2 * g.hw > g.tw, 'the head is wider than the rail');
  close(timeToX(g, 5000, 5000), g.nowX);
  close(timeToX(g, 5000, 6000), g.right);
  close(timeToX(g, 5000, 5500), (g.nowX + g.right) / 2);   // one fixed ms -> px scale
  assert.ok(timeToX(g, 5100, 5500) < timeToX(g, 5000, 5500), 'as time goes on, what is coming moves toward the rail (leftward)');
  close(posToY(g, 100), g.top); close(posToY(g, 0), g.bot);
  for (const p of [0, 12.5, 50, 99.9]) close(yToPos(g, posToY(g, p)), p);
  const l = simGeometry({}, 168, 400, 1000, 'left');   // the panel left of the video: mirrored
  close(l.nowX, l.right - l.hw); close(timeToX(l, 0, 1000), l.left);
  assert.ok(timeToX(l, 100, 500) > timeToX(l, 0, 500), 'mirrored: it moves rightward');
  const z = simGeometry({}, 40, 400, 0, 'right');   // folded: the rail centred, no trace
  close(z.nowX, 20); assert.equal(z.ppm, 0);
  assert.equal(clampLead(undefined), SIM_LEAD); assert.equal(clampLead(50), 400); assert.equal(clampLead(1e6), 6000); assert.equal(clampLead(1234), 1250);
});

test('meteor speed: 0 at rest, HARD_REF u/s reads fast (1), the root keeps slow strokes visible', () => {
  assert.equal(meteorSpeed(0, 300), 0);
  close(meteorSpeed(1.2, 300), 1);   // 300 px of travel at 400 u/s
  close(meteorSpeed(0.3, 300), 0.5);
  assert.equal(meteorSpeed(5, 300), 1); assert.equal(meteorSpeed(1, 0), 0);
});

test('reversals: the turn is where the motion arrives before going back, a hold counts, harder = faster', () => {
  const tri = [{ at: 0, pos: 0 }, { at: 300, pos: 100 }, { at: 600, pos: 0 }, { at: 900, pos: 100 }];
  const o = { at: 0, pos: 0, hard: 0 };
  assert.equal(turnInto(o, tri, 299), null, 'not before it');
  assert.equal(turnInto(o, tri, 300)?.at, 300); assert.equal(o.pos, 100);
  assert.equal(turnInto(o, tri, 300 + PULSE_MS - 1)?.at, 300);
  assert.equal(turnInto(o, tri, 300 + PULSE_MS), null, 'gone after PULSE_MS');
  assert.equal(turnInto(o, tri, 600)?.pos, 0);
  assert.equal(turnInto(o, tri, 900), null, 'the last point is no reversal');
  close(turnInto(o, tri, 310).hard, Math.sqrt((1000 / 3) / 400), 1e-6);
  const hold = [{ at: 0, pos: 10 }, { at: 400, pos: 90 }, { at: 500, pos: 90 }, { at: 900, pos: 10 }];
  assert.equal(turnInto(o, hold, 450)?.at, 400, 'arrives at 400, holds, goes back');
  const mono = [{ at: 0, pos: 0 }, { at: 100, pos: 50 }, { at: 200, pos: 50 }, { at: 300, pos: 100 }];
  assert.equal(turnInto(o, mono, 150), null, 'a pause on the way is no reversal');
  const slow = [{ at: 0, pos: 40 }, { at: 1000, pos: 50 }, { at: 2000, pos: 40 }];
  assert.equal(turnInto(o, slow, 1000).hard, 0.35, 'a gentle turn still shows');
  assert.equal(pulseOf(0, 1), 1); close(pulseOf(PULSE_MS / 2, 1), 0.25); assert.equal(pulseOf(PULSE_MS, 1), 0); assert.equal(pulseOf(-1, 1), 0);
});

test('simInto equals simAt (sim.js) everywhere, without allocating a result', () => {
  const out = { pos: 0, speed: 0, dir: 0 };
  for (let t = 0; t <= 3500; t += 7.3) {
    const r = simAt(script, t), o = simInto(out, script, t);
    assert.equal(o, out);
    close(o.pos, r.pos); close(o.speed, r.speed); assert.equal(o.dir, r.dir);
  }
  assert.ok(Number.isNaN(simInto(out, [], 5).pos));
});

test('axis kinds, angles and readouts: 50 is neutral, roll/pitch +-30 deg, twist +-180 deg', () => {
  assert.equal(axisKind('roll'), 'roll'); assert.equal(axisKind('R1'), 'roll');
  assert.equal(axisKind('pitch'), 'pitch'); assert.equal(axisKind('twist'), 'twist'); assert.equal(axisKind('r0'), 'twist');
  assert.equal(axisKind('surge'), 'linear'); assert.equal(axisKind('stroke'), 'linear');
  close(axisAngle('roll', 50), 0); close(axisAngle('roll', 100), Math.PI / 6); close(axisAngle('pitch', 0), -Math.PI / 6);
  close(axisAngle('twist', 100), Math.PI); close(axisAngle('twist', 25), -Math.PI / 2);
  assert.equal(axisValue('roll', 100), '+30°'); assert.equal(axisValue('twist', 0), '−180°'); assert.equal(axisValue('pitch', 50), '0°');
  assert.equal(axisValue('linear', 47.4), '47'); assert.equal(axisValue('roll', NaN), '–');
  assert.deepEqual(axesGrid(0, 168), { cols: 4, rows: 0, height: 0 });
  assert.equal(axesGrid(5, 168).rows, 2);
});

test('the meteor head is centred exactly on posAt(script, t), wider than the rail; its glow grows with speed', () => {
  const S = makeSimState(); S.script = script; S.w = 168; S.h = 420; S.glow = { sprite: 1 };
  for (const t of [0, 1000, 1123.4, 1399.99, 1450, 2999.5, 3005, 5000]) {
    S.t = t;
    const ctx = fakeCtx();
    const out = drawGraph(ctx, S, C);
    close(out.pos, posAt(script, t)); close(out.raw, posAt(script, t)); assert.equal(out.src, 'script');
    close(simDebug.drawnPos, posAt(script, t), 1e-9);
    const g = S.g, head = ctx.rects.find((r) => r.alpha === 1 && r.h === 6 && r.fill === C.hi);
    assert.ok(head, 'head drawn');
    close(head.y + head.h / 2, posToY(g, posAt(script, t))); close(head.x + head.w / 2, g.nowX);
    assert.ok(ctx.rects.some((r) => r.fill === C.accent && r.w === 2 * g.hw && r.w > g.tw), 'the bar across the rail, wider than it');
  }
  S.t = 2000; let ctx = fakeCtx(); drawGraph(ctx, S, C);   // 40 u/s
  const slow = simDebug.speed, gs = ctx.images.at(-1).w;
  S.t = 1200; ctx = fakeCtx(); drawGraph(ctx, S, C);   // 200 u/s
  assert.ok(simDebug.speed > slow, 'faster reads faster'); assert.ok(ctx.images.at(-1).w > gs, 'and glows wider');
  S.t = 5000; drawGraph(fakeCtx(), S, C); assert.equal(simDebug.speed, 0, 'at rest');
  S.unapplied = true; S.glowWarn = { sprite: 2 }; S.t = 1200; ctx = fakeCtx(); drawGraph(ctx, S, C);
  assert.ok(ctx.rects.some((r) => r.fill === C.warn && r.w === 2 * S.g.hw), 'unapplied: the warn ink'); assert.equal(ctx.images.at(-1).img, S.glowWarn);
});

test('the incoming script: one line from the head out to t + lead at a fixed scale, moving toward the rail as time goes on', () => {
  const S = makeSimState(); S.script = script; S.w = 168; S.h = 420; S.lead = 1000;
  S.t = 900; let ctx = fakeCtx(); drawGraph(ctx, S, C);
  const g = S.g, line = ctx.pts.filter((p) => p.stroke === C.val);
  close(line[0].x, g.nowX); close(line[0].y, posToY(g, posAt(script, 900)));   // it starts at the head
  const p1400 = line.find((p) => Math.abs(p.x - timeToX(g, 900, 1400)) < 1e-9);
  assert.ok(p1400, 'the 1400 ms point where its time puts it'); close(p1400.y, posToY(g, 90));
  close(line.at(-1).x, g.right); close(line.at(-1).y, posToY(g, posAt(script, 1900)));
  assert.equal(line.length, 1 + 3 + 1, 'the head, the 3 actions inside the window, the far end');
  S.t = 1000; ctx = fakeCtx(); drawGraph(ctx, S, C);
  const q1400 = ctx.pts.filter((p) => p.stroke === C.val).find((p) => Math.abs(p.y - posToY(g, 90)) < 1e-9);
  close(p1400.x - q1400.x, 100 * g.ppm, 1e-9);   // 100 ms later: 100 ms worth further left
  S.side = 'left'; ctx = fakeCtx(); drawGraph(ctx, S, C);
  assert.ok(ctx.pts.filter((p) => p.stroke === C.val).at(-1).x < S.g.nowX, 'left of the video: it comes in from the left');
});

test('a reversal lights up at the turn from its own frame for PULSE_MS, brighter for a harder turn; never while scrubbing', () => {
  const S = makeSimState(); S.script = script; S.w = 168; S.h = 420; S.glow = { sprite: 1 };
  S.t = 1400; drawGraph(fakeCtx(), S, C);   // the 10 -> 90 -> 0 turn at 1400
  const full = simDebug.pulse;
  close(full, turnInto({}, script, 1400).hard); close(simDebug.pulseY, posToY(S.g, 90));
  S.t = 1450; drawGraph(fakeCtx(), S, C); assert.ok(simDebug.pulse > 0 && simDebug.pulse < full, 'decaying');
  S.t = 1500 + PULSE_MS; drawGraph(fakeCtx(), S, C); assert.equal(simDebug.pulse, 0, 'gone (both turns, 1400 and 1500, past)');
  S.t = 1399; drawGraph(fakeCtx(), S, C); assert.equal(simDebug.pulse, 0, 'not before the turn');
  S.frameMs = 1000 / 30; drawGraph(fakeCtx(), S, C); close(simDebug.pulse, full, 1e-9, 'a frame shown from 1399 holds the turn at 1400: its own frame');
  S.t = 1380; drawGraph(fakeCtx(), S, C); assert.equal(simDebug.pulse, 0, 'the frame before it: none'); S.frameMs = 0;
  S.t = 1400; S.quiet = true; drawGraph(fakeCtx(), S, C); assert.equal(simDebug.pulse, 0, 'scrubbing: none');
  S.quiet = false; S.t = 1550; drawGraph(fakeCtx(), S, C);   // the 90 -> 0 -> 60 turn at 1500, 50 ms on
  assert.ok(simDebug.pulse > 0, 'the next turn lights too');
  const soft = [{ at: 0, pos: 40 }, { at: 1000, pos: 60 }, { at: 2000, pos: 40 }];
  S.script = soft; S.t = 1000; drawGraph(fakeCtx(), S, C);
  assert.ok(simDebug.pulse > 0 && simDebug.pulse < full, 'a softer turn, a softer light');
});

test('over the device limit: the track frame takes the bad ink (hard) or the info ink (planner)', () => {
  const S = makeSimState(); S.script = script; S.w = 168; S.h = 420; S.t = 3005; S.limit = 400;   // 4000 u/s here
  let ctx = fakeCtx(); assert.equal(drawGraph(ctx, S, C).over, true);
  assert.ok(ctx.frames.some((f) => f.stroke === C.bad));
  S.mode = 'planner'; ctx = fakeCtx(); drawGraph(ctx, S, C);
  assert.ok(ctx.frames.some((f) => f.stroke === C.info));
  S.t = 1200; ctx = fakeCtx(); assert.equal(drawGraph(ctx, S, C).over, false);   // 200 u/s
  assert.ok(!ctx.frames.some((f) => f.stroke === C.bad || f.stroke === C.info));
});

/** A plan like device-preview's: {t0, dtMs, pos} at 1 ms, here the script delayed by 60 ms. */
const planOf = (t0, t1, lag = 60) => ({ t0, dtMs: 1, engine: 'kinetic', pos: Float32Array.from({ length: t1 - t0 + 1 }, (_, i) => posAt(script, t0 + i - lag)) });

test('machine preview: inside the plan the carriage follows the machine exactly, the commanded position is kept', () => {
  const plan = planOf(1000, 3000);
  const S = makeSimState(); S.script = script; S.plan = plan; S.w = 200; S.h = 400;
  for (const t of [1000, 1234.5, 1460, 2999]) {
    S.t = t; const ctx = fakeCtx(); const out = drawGraph(ctx, S, C);
    assert.equal(out.src, 'machine');
    const want = planInto({}, plan, t).pos;
    close(out.pos, want); close(simDebug.drawnPos, want, 1e-9); close(out.raw, posAt(script, t));
    close(want, posAt(script, t - 60), 0.01);   // between ticks: linear
    // the hollow marker sits on the commanded position
    const m = ctx.frames.find((f) => f.stroke === C.val && f.h === 6);
    assert.ok(m, 'command marker'); close(m.y + 3, Math.round(posToY(S.g, posAt(script, t))) + 0.5);
  }
  S.t = 1460; const ctx = fakeCtx(); drawGraph(ctx, S, C);   // 60 ms behind on a fast stroke: the shortfall bar
  assert.ok(ctx.rects.some((r) => r.fill === C.warn && r.w === 2 && r.h > 5));
  S.t = 3500; const out = drawGraph(fakeCtx(), S, C);   // past the plan: back to the script
  assert.equal(out.src, 'script'); close(out.pos, posAt(script, 3500)); assert.equal(out.miss, false);
});

test("plan speed: a central difference over 40 ms, clipped to the plan; ramp buckets match the lanes rule", () => {
  const plan = { t0: 0, dtMs: 1, pos: Float32Array.from({ length: 1001 }, (_, i) => Math.min(100, i / 10)) };   // 100 u/s
  const o = planInto({}, plan, 500);
  close(o.speed, 100, 1e-3); assert.equal(o.dir, 1); close(o.pos, 50, 1e-4);
  close(planInto({}, plan, 0).speed, 100, 1e-3);   // one-sided at the edge
  close(planInto({}, plan, 0.5).pos, 0.05, 1e-6);   // linear between ticks
  assert.equal(rampIndex(0, 400, 12), 0); assert.equal(rampIndex(400, 400, 12), 11); assert.equal(rampIndex(9999, 400, 12), 11);
  assert.equal(rampIndex(200, 400, 12), Math.floor(0.5 * 11 + 0.5)); assert.equal(rampIndex(NaN, 400, 12), 0);
  assert.equal(rampOf('heat', 12).length, 12);
});

test("can't follow: the point the machine heads to is a miss, or the plan is held at an edge", () => {
  const misses = [{ at: 1500, pos: 0, got: 30 }];
  assert.equal(missAt(script, misses, null, 1450), true);    // heading to 1500
  assert.equal(missAt(script, misses, null, 1500), true);    // on it
  assert.equal(missAt(script, misses, null, 1501), false);   // heading to 3000
  assert.equal(missAt(script, misses, null, 1200), false);
  assert.equal(missAt(script, [], [{ t0: 2000, t1: 2100, edge: 'out' }], 2050), true);
  const S = makeSimState(); S.script = script; S.plan = planOf(1000, 3000); S.misses = misses; S.w = 200; S.h = 400; S.t = 1450;
  const ctx = fakeCtx(); assert.equal(drawGraph(ctx, S, C).miss, true);
  assert.ok(ctx.frames.some((f) => f.stroke === C.warn), 'the rail frame takes the warn ink');
});

test("the band and the misses are the main timeline's painters, mapped onto the graph", () => {
  assert.equal(LANE_PAD, PAD);
  const calls = [];
  const S = makeSimState(); S.script = script; S.plan = planOf(1000, 3000); S.misses = []; S.w = 200; S.h = 400; S.t = 2000;
  S.lanes = { T: {}, drawMachine: (ctx, w, h, view, g, n) => calls.push(['m', w, h, view.start, view.span, g.samples === S.plan, n]), drawMisses: (ctx, w, h, view) => calls.push(['x', w, h]) };
  drawGraph(fakeCtx(), S, C);
  const g = S.g;
  assert.deepEqual(calls.map((c) => c[0]), ['m', 'x']);
  const [, w, h, start, span, same, n] = calls[0];
  close(w, g.right - g.nowX); close(h, g.bot - g.top + 2 * PAD); assert.ok(same); assert.equal(n, 0);
  close(start, 2000, 1e-6); close(span, S.lead, 1e-6);   // the lanes' x starts at the rail, at t, and spans what is coming
});

test('empty script draws the track but no head; tiny canvases draw nothing', () => {
  const S = makeSimState(); S.script = []; S.w = 168; S.h = 300; S.t = 100;
  const ctx = fakeCtx(); drawGraph(ctx, S, C);
  assert.ok(Number.isNaN(S.out.pos));
  assert.ok(!ctx.rects.some((r) => r.h === 3 && r.fill === C.hi));
  S.h = 10; const c2 = fakeCtx(); drawGraph(c2, S, C); assert.equal(c2.rects.length, 0);
});

test('axis indicators draw every axis without throwing', () => {
  const axes = ['roll', 'pitch', 'twist', 'surge'].map((id) => ({ id, label: id.toUpperCase(), kind: axisKind(id), script, color: '#fff' }));
  const ctx = fakeCtx();
  drawAxes(ctx, axes, 1200, 168, axesGrid(4, 168).height, C);
  assert.ok(ctx.rects.length > 0);
});
