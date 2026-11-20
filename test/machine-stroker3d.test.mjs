// The Stroker mode's 3D view (paw-ttky, paw-n2ms; src/features/machine/stroker3d.js): the screen-space handles projected
// from the model (each drags along its own on-screen direction, from any camera angle), hit testing, and the in-place
// meshes (finite, the right sizes, the anatomy's top / bottom, the heat painted per station, the closed end pushed out,
// the mound dented under a pressed case, the clear sleeve tinted where it presses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../src/features/machine/stroker3d.js';
import * as K from '../src/features/machine/stroker.js';
import { viewOf } from '../src/features/machine/camera.js';
import { project, keepScene } from '../src/features/machine/gl3d.js';

const W = 800, H = 500, L = 140;
const cams = [V.strokerCam('side', L), V.strokerCam('quarter', L), V.strokerCam('top', L), { az: 230, el: -35, zoom: 1.6, pan: [10, 60, 5], shift: 0 }];
const model = { L, glansMm: 30, R: 19, rig: { downMm: 0, upMm: 125 }, outer: 40 };

test('stroker3d: a handle dragged along its projected direction moves its value by the same mm, at any angle', () => {
  for (const c of cams) {
    const v = viewOf(c, 900, W, H), hs = V.handles3d(model, v, W, H);
    assert.equal(hs.length, 6, `all six handles in front of the camera (az ${c.az})`);
    for (const h of hs) {
      // the screen point 7 mm further along the handle's own direction, in px, gives back 7 mm (to within the projection's
      // curvature over 7 mm)
      const dir = { tip: [0, 1, 0], glans: [0, -1, 0], pad: [0, -1, 0], down: [0, 1, 0], up: [0, 1, 0], girth: V.sideOf(v.up) }[h.key];
      const q = project(v.vp, h.at.map((x, i) => x + 7 * dir[i]), W, H);
      if (Math.hypot(h.a[0], h.a[1]) < 0.05) continue;   // edge-on (looking along it): no drag
      const mm = V.dragMm(h.a, q[0] - h.x, q[1] - h.y);
      assert.ok(Math.abs(mm - 7) < 0.5, `${h.key} at az ${c.az} el ${c.el}: ${mm.toFixed(2)} mm`);
    }
  }
  // edge-on: nothing
  assert.equal(V.dragMm([0.01, 0.01], 40, 40), 0);
});

test('stroker3d: the girth handle is on the side facing up the screen; the rail markers under the model; hit testing', () => {
  const v = viewOf(V.strokerCam('side', L), 900, W, H), hs = V.handles3d(model, v, W, H), by = Object.fromEntries(hs.map((h) => [h.key, h]));
  const axis = project(v.vp, [0, L * 0.42, 0], W, H);
  assert.ok(by.girth.y < axis[1] - 5, 'girth above the axis on screen');
  assert.ok(by.down.y > axis[1] + 20 && by.up.y > axis[1] + 20, 'markers below');
  assert.ok(by.up.x > by.down.x + 50, 'pos 100 further along the shaft than pos 0 (side view: base left)');
  assert.ok(by.tip.x > by.girth.x, 'the tip at the far end');
  assert.equal(V.hitHandle(hs, by.tip.x + 3, by.tip.y - 2)?.key, 'tip');
  assert.equal(V.hitHandle(hs, by.tip.x + 40, by.tip.y + 40), null);
  // past the hilt: the down marker lies before the body
  const past = V.handles3d({ ...model, rig: { downMm: -30, upMm: 60 } }, v, W, H).find((h) => h.key === 'down');
  assert.ok(past.x < project(v.vp, [0, 0, 0], W, H)[0], 'a marker past the hilt sits on the body side');
});

test('stroker3d: meshes fill in place: finite, in range, the anatomy, heat per station, closed end out, mound dent, clear tint', () => {
  const sl = K.sleeveFor('closed-short'), geo = K.geometry(K.BODY_DEFAULT, sl), M = V.meshesFor(L, K.BODY_DEFAULT.padMm, sl.open, false);
  for (const m of [M.pm, M.mm, M.im, M.om]) { const nv = m.pos.length / 3; assert.ok(Math.max(...m.idx) < nv && nv < 65536); }
  const sc = []; for (let k = 0; k < 10; k++) sc.push({ at: k * 1000, pos: 100 }, { at: k * 1000 + 500, pos: 0 });
  const colors = { skin: [0.5, 0.5, 0.5], glans: [0.55, 0.45, 0.47], heat: [1, 0.6, 0.2], sleeve: [0.7, 0.7, 0.8], tint: [0.9, 0.9, 0.95], body: [0.5, 0.5, 0.5], thick: [0.4, 0.4, 0.5] };
  const s = K.stateAt(sc, 4520, { downMm: 0, upMm: 100 }, geo);   // near pos 0: the 130 mm closed sleeve pressed in by the tip
  const pos0 = M.pm.pos.slice();
  const info = V.fillMeshes(M, geo, s, 2, colors, sl);
  for (const m of [M.pm, M.mm, M.im, M.om]) assert.ok([...m.pos, ...m.nor, ...(m.col || [])].every(Number.isFinite));
  assert.notDeepEqual(M.pm.pos, pos0, 'written in place');
  assert.ok(info.outer > 15 && info.outer < 60);
  assert.ok(s.endMm > 0, `the end is pressed in (${s.endMm.toFixed(1)} mm)`);
  // the inner end wall (its last ring) is not inside the penis: at or past its tip
  const yEnd = M.im.pos[V.SL_RINGS * (V.SEG + 1) * 3 + 1];
  assert.ok(yEnd >= info.tipY - 0.01, `end wall ${yEnd.toFixed(1)} vs tip ${info.tipY.toFixed(1)}`);
  // the anatomy has a top and a bottom: the urethral ridge on the shaft's underside, the frenulum's notch under the corona
  const ringAt = (z) => Math.round(((z + info.c) / (L + info.c)) * (M.pm.rings - 2));
  const bottom = (3 * V.SEG) / 4, top = V.SEG / 4, shaft = ringAt(50), cor = ringAt(L - 28);
  // (radius about the ring's centre height, its side vertex at theta 0)
  const rad = (i, j) => { const k = (i * (V.SEG + 1) + j) * 3, c0 = M.pm.pos[(i * (V.SEG + 1)) * 3 + 2]; return Math.hypot(M.pm.pos[k], M.pm.pos[k + 2] - c0); };
  assert.ok(rad(shaft, bottom) > rad(shaft, top) * 1.02, 'the ridge underneath');
  assert.ok(rad(cor, bottom) < rad(cor, top) * 0.95, 'the frenulum notch under the corona');
  // a pressed station is more orange than an untouched one
  const hot = s.heat.reduce((m, x, i) => (x > s.heat[m] ? i : m), 0), ci = ringAt(L - hot);
  assert.ok(s.heat[hot] === 0 || M.pm.col[(ci * (V.SEG + 1) + top) * 4 + 2] < 0.45);
  // the inner wall tinted where it presses: some rings brighter than the plain sleeve
  const blue = Array.from({ length: V.SL_RINGS + 1 }, (_, i) => M.im.col[i * (V.SEG + 1) * 4 + 2]);
  assert.ok(Math.max(...blue) > colors.sleeve[2] + 0.02, "tinted where it presses");
  // pressed past the hilt: the root shows (rings below 0), the mound dented under the rim down to the case front
  const s2 = K.stateAt(sc, 4520, { downMm: -40, upMm: 60 }, geo);
  const info2 = V.fillMeshes(M, geo, s2, 0, colors, sl);
  assert.ok(s2.padMm > 10 && info2.c > 10);
  assert.ok(M.pm.pos[1] < -10 && M.pm.pos[1] >= -K.BODY_DEFAULT.padMm - 1e-6, `the penis shows from y ${M.pm.pos[1].toFixed(1)}`);
  assert.ok(Math.abs(M.mm.pos[1] - info2.caseFront) < 0.5, `the mound at the rim follows the case front (${M.mm.pos[1].toFixed(1)} vs ${info2.caseFront.toFixed(1)})`);
  assert.ok(V.dentedY(30, 20, 40, 5) === V.moundY(30, 20), 'no dent while the case front is clear of the mound');
  assert.ok(V.dentedY(30, 20, 40, -12) <= -12 + 1e-9 && V.dentedY(80, 20, 40, -12) > V.dentedY(50, 20, 40, -12) - 20, 'a dent under the rim, easing out past it');
  // an open product with its case, far past the tip: finite
  const op = K.sleeveFor('fl-quickshot'), g2 = K.geometry(K.BODY_DEFAULT, op), M2 = V.meshesFor(L, K.BODY_DEFAULT.padMm, true, true);
  V.fillMeshes(M2, g2, K.stateAt(sc, 4400, { downMm: 200, upMm: 200 }, g2), 0, colors, op);
  for (const m of Object.values(M2)) assert.ok([...m.pos].every(Number.isFinite));
  assert.ok(V.caseRadius(op, op.caseMm / 2) > V.caseRadius(op, 2), 'the middle band of the Quickshot');
  const cl = K.sleeveFor('fl-standard');
  assert.ok(V.caseRadius(cl, 5) > V.caseRadius(cl, cl.caseMm * 0.8) * 1.2, 'the flared entrance end of the classic');
});

test('stroker3d: the heat colour is one hue, monotonic in the stimulation', () => {
  const a = [0.4, 0.4, 0.42], b = [0.96, 0.65, 0.2];
  let prev = -1;
  for (let v = 0; v <= 1.2; v += 0.1) { const c = V.heatColor(a, b, v), d = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]); assert.ok(d >= prev); prev = d; }
  assert.deepEqual(V.heatColor(a, b, 0), a);
  assert.deepEqual(V.heatColor(a, b, 5), b);
});

test('stroker3d: the sway is still while paused and bounded while playing', () => {
  const sw = new V.Sway();
  assert.equal(sw.step(300, 16, false), 0);
  let m = 0;
  for (let i = 0; i < 300; i++) m = Math.max(m, Math.abs(sw.step(i % 30 < 15 ? 400 : -400, 16, true)));
  assert.ok(m > 0.2 && m <= 6, `sway ${m.toFixed(2)} mm`);
});

// paw-avu6: the Machine's and the Stroker's 3D scene: retried while the GPU comes up, rebuilt on a restored context
// without destroy() on the lost one (its loseContext() would lose the restored context again), torn down once
test('gl3d keepScene: retries a failing make, rebuilds on webglcontextrestored, gives up after the tries', async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms)), until = async (f) => { for (let i = 0; i < 500 && !f(); i++) await wait(10); };   // (timers run late under load)
  const canvas = new EventTarget(), got = [];
  let fails = 2, made = 0, destroyed = 0;
  const make = () => { if (fails-- > 0) throw new Error('not yet'); made++; return { id: made, destroy: () => destroyed++ }; };
  const stop = keepScene(canvas, make, (s, e) => got.push(s ? s.id : 'gave up: ' + e.message), { waitMs: 5 });
  await until(() => got.length);
  assert.deepEqual(got, [1], 'two failures, then a scene');
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.deepEqual(got, [1, 2], 'a restored context: a new scene');
  assert.equal(destroyed, 0, 'the lost scene is not destroyed (no loseContext on the restored context)');
  stop();
  assert.equal(destroyed, 1, 'teardown destroys the live scene');
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(made, 2, 'no rebuild after teardown');
  const out = [];
  keepScene(new EventTarget(), () => { throw new Error('no WebGL'); }, (s, e) => out.push(s || e.message), { tries: 3, waitMs: 2 });
  await until(() => out.length);
  await wait(20);
  assert.deepEqual(out, ['no WebGL'], 'gives up once, after the tries');
});

test('stroker3d: upright, the axis runs up the screen: the girth handle and the rail go sideways, pos 100 above pos 0', () => {
  for (const k of ['front', 'quarter', 'side']) {
    const c = V.strokerCam(k, L, 'up'), v = V.orientView(viewOf(c, 900, W, H), 'up'), hs = V.handles3d(model, v, W, H), by = Object.fromEntries(hs.map((h) => [h.key, h]));
    const base = project(v.vp, [0, 0, 0], W, H), tip = project(v.vp, [0, L, 0], W, H);
    assert.ok(tip[1] < base[1] - 50, `${k}: the tip above the base on screen`);
    assert.ok(by.up.y < by.down.y - 30, `${k}: pos 100 (out) above pos 0 (deep)`);
    assert.ok(Math.abs(by.down.x - base[0]) > 25, `${k}: the rail beside the model`);
    const axisX = project(v.vp, [0, L * 0.42, 0], W, H)[0];
    assert.ok(Math.abs(by.girth.x - axisX) > 8, `${k}: the girth handle to the side`);
  }
  // fitting: the model fills the canvas in both orientations
  const pts = [[0, -100, 0], [0, 100, 0], [50, 0, 0], [-50, 0, 0]];
  for (const o of ['up', 'side']) { const d = V.fitView(V.strokerCam('quarter', L, o), pts, W, H, o); assert.ok(d > 100 && d < 3000, `${o}: ${d.toFixed(0)}`); }
});

test('stroker3d: the soft sleeve: the wall bulges and thins where stretched, the inner wall lags graded, the end balloons, the pad fades', () => {
  const sl = { ...K.sleeveFor('closed-short'), soft: 0.8 }, geo = K.geometry(K.BODY_DEFAULT, sl), M = V.meshesFor(L, K.BODY_DEFAULT.padMm, false, false);
  const colors = { skin: [0.5, 0.5, 0.5], glans: [0.5, 0.4, 0.4], heat: [1, 0.6, 0.2], sleeve: [0.7, 0.7, 0.8], tint: [0.9, 0.9, 0.95], body: [0.5, 0.5, 0.5], thick: [0.4, 0.4, 0.5] };
  const sc = []; for (let k = 0; k < 10; k++) sc.push({ at: k * 1000, pos: 100 }, { at: k * 1000 + 500, pos: 0 });
  const s = K.stateAt(sc, 4500, { downMm: 0, upMm: 100 }, geo);   // at pos 0: pressed onto the tip
  const info = V.fillMeshes(M, geo, s, 0, colors, sl);
  const R = (m, i) => Math.hypot(m.pos[i * (V.SEG + 1) * 3], m.pos[i * (V.SEG + 1) * 3 + 2] - m.pos[(i * (V.SEG + 1) + V.SEG / 4) * 3 + 2] * 0);
  // a ring over the shaft: the channel stretched to the penis, the outer wall out past its rest, but thinner than at rest
  const i = Math.round(V.SL_RINGS * 0.4), rc = K.channelAt(sl, sl.lengthMm * 0.4), ri = R(M.im, i), ro = R(M.om, i + 1);
  assert.ok(ri > rc + 3, `stretched ${ri.toFixed(1)} over ${rc}`);
  assert.ok(ro > rc + V.WALL + 0.5 && ro - ri < V.WALL, `bulged ${ro.toFixed(1)}, wall ${(ro - ri).toFixed(1)} thinner than ${V.WALL}`);
  assert.ok(info.balloon > 0, 'the closed end balloons when pressed');
  // the pad's rim is clear, its middle solid
  const a0 = M.mm.col[3], aN = M.mm.col[((V.MOUND_RINGS - 1) * (V.SEG + 1)) * 4 + 3];
  assert.equal(a0, 1); assert.ok(aN < 0.01);
  // softness 0: rigid (no bulge past today's)
  const rig0 = { ...sl, soft: 0 }, g0 = K.geometry(K.BODY_DEFAULT, rig0);
  V.fillMeshes(M, g0, K.stateAt(sc, 4500, { downMm: 0, upMm: 100 }, g0), 0, colors, rig0);
  assert.ok(R(M.om, i + 1) <= ro + 1e-6);
  // the channel's spring-back overshoots a little and settles (playing); paused it rests on the target
  const d = new V.RingDyn(4); d.ok = true; d.frame(16, true);
  d.radius(0, 19, 1);
  let min = 19; for (let k = 0; k < 40; k++) { d.frame(16, true); min = Math.min(min, d.radius(0, 8, 1)); }
  assert.ok(min < 8 && min > 5, `overshoot to ${min.toFixed(2)} below the rest 8`);
  d.frame(16, false); assert.equal(d.radius(0, 8, 1), 8);
});
