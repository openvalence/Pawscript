// paw-2pcf: lib/six-axis.js. Two synthetic 3-D bodies (point clouds) with a known motion, projected to each view: the
// motion comes out on the axis the header's table names, with the documented sign; an unobservable one stays empty; the
// conditioning keeps every output centre-returning, inside its band, under its speed cap, faded at the shot's edges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, deriveShot, viewFor, condition, fadeEnvelope, corrAt, sideSigns, BAND, SPEED, SIX, VIEW_TABLE } from '../src/lib/six-axis.js';
import { synth } from './six-axis-synth.mjs';
const derive = (view, motion) => {
  const { run, truth } = synth(view, motion), m = measure(run, 0, 1e9, { aspect: 1 });
  assert.ok(m, 'measured');
  return { d: deriveShot(m, { view }), truth, m };
};
const S = 0, F = 1, L = 2;

test('the view table: a known motion lands on its axis with the documented sign, the other seen axes stay small', () => {
  const cases = [
    ['side', { kind: 'move', k: F }, 'surge', 1], ['side', { kind: 'rot', k: L }, 'pitch', 1],
    ['rear', { kind: 'move', k: L }, 'sway', 1], ['rear', { kind: 'move', k: F }, 'surge', 1], ['rear', { kind: 'rot', k: S }, 'twist', 1],
    ['front', { kind: 'move', k: L }, 'sway', 1], ['front', { kind: 'move', k: F }, 'surge', 1], ['front', { kind: 'rot', k: S }, 'twist', 1],
    ['top', { kind: 'move', k: L }, 'sway', -1], ['top', { kind: 'rot', k: F }, 'roll', 1],   // top: sway + = up in the picture = -L here
  ];
  for (const [view, motion, axis, sign] of cases) {
    const { d, truth } = derive(view, motion), a = d.axes[axis];
    assert.equal(a.label, 'measured', `${view} ${axis}: ${a.label} conf ${a.conf}`);
    const r = corrAt(Array.from(a.y, (v) => v - 50), truth);
    assert.ok(sign * r > 0.8, `${view} ${axis}: r ${r.toFixed(2)}`);
    assert.ok(a.amp > 3, `${view} ${axis}: amp ${a.amp}`);
    for (const [other, row] of Object.entries(VIEW_TABLE[view])) {
      if (other === axis || row[2] !== 'measured' || d.axes[other].label === 'none') continue;
      assert.ok(Math.abs(corrAt(Array.from(d.axes[other].y, (v) => v - 50), truth)) < 0.5 || d.axes[other].amp < a.amp / 3, `${view}: ${other} follows the ${axis} motion`);
    }
  }
});

test('not seen: sway in a side view (along the camera) and roll in a rear view give no data', () => {
  const side = derive('side', { kind: 'move', k: L }).d.axes;
  assert.ok(side.sway.label === 'none' || side.sway.amp < 1, `side sway ${side.sway.label} ${side.sway.amp}`);
  for (const a of ['surge', 'pitch']) assert.ok(side[a].label === 'none' || side[a].amp < 1, `side ${a} from an out-of-plane move`);
  const rear = derive('rear', { kind: 'rot', k: F }).d.axes;
  assert.equal(rear.roll.label, 'none');
  assert.equal(rear.roll.script.length, 0);
});

test('view: an angle tag wins, POV maps like top, nothing is a guessed side view (estimate at most)', () => {
  assert.deepEqual(viewFor('rear', 'pov'), { view: 'rear', guessed: false });
  assert.equal(viewFor(null, 'pov').view, 'top');
  assert.deepEqual(viewFor(null, 'static'), { view: 'side', guessed: true });
  const { run } = synth('side', { kind: 'move', k: F }), m = measure(run, 0, 1e9, { aspect: 1 });
  const g = deriveShot(m, { view: 'side', guessed: true }).axes.surge;
  assert.notEqual(g.label, 'measured');
  assert.ok(g.amp < deriveShot(m, { view: 'side' }).axes.surge.amp);
});

test('conditioning: centre-returning, clamped to the band, speed-capped, 50 at the edges, flips negate', () => {
  const { d, m } = derive('rear', { kind: 'move', k: L }), a = d.axes.sway, y = a.y, dt = m.dt;
  assert.equal(Math.round(y[0]), 50); assert.equal(Math.round(y[y.length - 1]), 50);
  assert.equal(a.script[0].pos, 50); assert.equal(a.script[a.script.length - 1].pos, 50);
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  assert.ok(Math.abs(mean - 50) < 2, `mean ${mean}`);
  for (const v of y) assert.ok(Math.abs(v - 50) <= BAND.sway + 1e-6);
  for (let i = 1; i < y.length; i++) assert.ok(Math.abs(y[i] - y[i - 1]) <= (SPEED.sway * dt) / 1000 + 1e-3, 'speed cap');
  assert.ok(a.script.length > 6 && a.script.length < y.length / 3, `points ${a.script.length}`);
  const fl = deriveShot(m, { view: 'rear', flips: ['sway'] }).axes.sway;
  assert.ok(corrAt(Array.from(fl.y), Array.from(y)) < -0.99);
  // a ramp (slow drift) is not kept; a gap fades to 50 around it
  const ramp = Float64Array.from({ length: 300 }, (_, i) => i * 0.001);
  assert.ok(Math.max(...condition(ramp, 33).y.slice(60, 240).map(Math.abs)) < 0.005, 'drift removed');
  const gap = Float64Array.from({ length: 300 }, (_, i) => (i >= 140 && i < 170 ? NaN : 1));
  const env = fadeEnvelope(gap, 33);
  assert.equal(env[150], 0); assert.equal(env[0] < 0.1, true); assert.equal(env[80], 1);
  assert.ok(env[136] > 0 && env[136] < 1, 'eases into the gap');
});

test('too short: no measurement; no Bottom / Top pair: the solo reading (paw-jyde.11: the Bottom\'s hips vs the frame); no hips at all: none', () => {
  const { run } = synth('side', { kind: 'move', k: F });
  assert.equal(measure(run, 0, 900, { aspect: 1 }), null);
  const { sem_c2_hips_x: _, ...rest } = run.channels;   // eslint-disable-line no-unused-vars
  const solo = measure({ ...run, channels: rest }, 0, 1e9);
  assert.equal(solo.vsFrame.who, 'c1'); assert.equal(solo.top, null);
  const { sem_c1_hips_x: _b, ...none } = rest;   // eslint-disable-line no-unused-vars
  assert.equal(measure({ ...run, channels: none }, 0, 1e9), null);
  assert.ok(SIX.MIN_MS >= 1000);
});

test('paw-5r1: painted sides decide the mirror: sway / twist (rear, front) and sway / roll (top) come out the same for a scene and its mirror image', () => {
  const run = (proj, view, motion, sides = true) => { const { run: r, truth } = synth(proj, motion, { sides }), m = measure(r, 0, 1e9, { aspect: 1 }); return { d: deriveShot(m, { view }), m, truth }; };
  const r = (a, truth) => corrAt(Array.from(a.y, (v) => v - 50), truth);
  // rear: the Bottom moving to its own left = sway +; the mirror image (the camera in front, the shot still tagged rear) without painted sides reads backwards
  const rear = run('rear', 'rear', { kind: 'move', k: L }), mir = run('rearM', 'rear', { kind: 'move', k: L }), bare = run('rearM', 'rear', { kind: 'move', k: L }, false);
  assert.deepEqual(sideSigns(rear.m, 'rear'), { sway: 1, twist: 1 });
  assert.deepEqual(sideSigns(mir.m, 'rear'), { sway: -1, twist: -1 }, 'the sign flips with the mirror');
  assert.ok(r(rear.d.axes.sway, rear.truth) > 0.8 && r(mir.d.axes.sway, mir.truth) > 0.8, 'sway + = the Bottom’s own left, both ways round');
  assert.ok(r(bare.d.axes.sway, bare.truth) < -0.8, 'without the painted sides the mirror image reads the wrong way');
  assert.equal(rear.d.axes.sway.signFrom, 'sides'); assert.equal(bare.d.axes.sway.signFrom, undefined);
  const tw = run('rear', 'rear', { kind: 'rot', k: S }), twM = run('rearM', 'rear', { kind: 'rot', k: S });
  assert.ok(r(tw.d.axes.twist, tw.truth) > 0.8 && r(twM.d.axes.twist, twM.truth) > 0.8, 'twist the same both ways round');
  assert.ok(r(run('front', 'front', { kind: 'move', k: L }).d.axes.sway, rear.truth) > 0.8, 'a front view agrees with its angle tag');
  // top: sway + = the Bottom's own left (the convention alone read -L here), roll from the handedness of S and L
  for (const proj of ['top', 'topM']) {
    const sw = run(proj, 'top', { kind: 'move', k: L }), rl = run(proj, 'top', { kind: 'rot', k: F });
    assert.ok(r(sw.d.axes.sway, sw.truth) > 0.8, `${proj}: sway + = the Bottom's left`);
    assert.ok(r(rl.d.axes.roll, rl.truth) > 0.8, `${proj}: roll the same sense`);
    assert.equal(rl.d.axes.roll.signFrom, 'sides');
  }
  assert.deepEqual([sideSigns(run('top', 'top', { kind: 'rot', k: F }).m, 'top').roll, sideSigns(run('topM', 'top', { kind: 'rot', k: F }).m, 'top').roll], [1, -1]);
  // side view: L is along the camera, positions cannot tell: the convention stays
  assert.deepEqual(sideSigns(run('side', 'side', { kind: 'move', k: F }).m, 'side'), {});
});
