// paw-jyde.11: the solo reading of lib/six-axis.js (one character's hips against the frame, in its own body frame). A synthetic
// lone dancer (hips cloud + torso centre + painted L / R thighs) moving with a known motion, seen from a view; the reading must
// put each motion on the axis the header's solo table names, with the documented sign; and the two-character reading must be
// exactly what it was before (test/fixtures/six-axis-pair-head.json, made by the code at 1c18a5b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measure, deriveShot, corrAt, sideSigns, SIX } from '../src/lib/six-axis.js';
import { dirs, rot } from './six-axis-synth.mjs';
import { digest } from './six-axis-pair-snapshot.mjs';

const FPS = 30, N = FPS * 8;
// body frame [x forward, y left, z up] (metres-ish, frame heights): the hips cloud, its torso 0.25 above, thighs at y = +-0.06
const HIPS = dirs(20, 0.7).map(([a, b, c]) => [0.06 * a, 0.09 * b, 0.07 * c]);
// camera views: picture x right, y down, of body points [x, y, z]
const VIEW = {
  rear: (p) => [-p[1], -p[2]],   // behind it: its left on the picture's left
  rearM: (p) => [p[1], -p[2]],   // the mirror image
  front: (p) => [p[1], -p[2]],
  side: (p) => [p[0], -p[2]],    // facing picture-right
  top: (p) => [p[0], p[1]],      // from above, forward = picture right
  lying: (p) => [p[2], -p[1]],   // rear view of a body lying on its side: its up = picture right
  tilt: (p) => { const [x, y] = [-p[1], -p[2]], c = Math.cos(TILT), s = Math.sin(TILT); return [c * x - s * y, s * x + c * y]; },   // rear, leaning 30 deg
};
const TILT = Math.PI / 6;
const W = (sec, per, ph = 0) => Math.sin((2 * Math.PI * sec) / per + ph);

/**
 * A one-character run: hips (group id 4), and as asked a torso / head centre and painted thighs, seen from `view`. motion(sec) ->
 * {x, y, z (translations), rx, ry, rz (rotations about forward / left / up, radians)}. cam(sec) -> [dx, dy]: a camera pan
 * (picture units) added to everything seen; camPath: the run stores cam_x / cam_y and the centres camera-removed (as the sidecar).
 */
function soloRun(view, motion, { torso = true, head = false, sides = true, thigh = [0.06, -0.05], cam = null, camPath = false } = {}) {
  const t = [], ov = [], ch = {}, put = (k, x, y) => { (ch[k + '_x'] ||= []).push(x); (ch[k + '_y'] ||= []).push(y); };
  for (let f = 0; f < N; f++) {
    const tm = Math.round((f * 1000) / FPS), sec = tm / 1000, M = motion(sec), K = cam ? cam(sec) : [0, 0];
    const pose = (p) => { let q = rot(p, 0, M.rx || 0); q = rot(q, 1, M.ry || 0); q = rot(q, 2, M.rz || 0); return [q[0] + (M.x || 0), q[1] + (M.y || 0), q[2] + (M.z || 0)]; };
    const img = (p) => { const [x, y] = VIEW[view](pose(p)); return [0.5 + x + K[0], 0.5 + y + K[1]]; };
    const pts = HIPS.map((p) => [...img(p), 1, 1, 0, 4]);
    const cen = [mean(pts.map((q) => q[0])), mean(pts.map((q) => q[1]))];
    const store = (k, [x, y]) => put(k, camPath ? x - K[0] : x, camPath ? y - K[1] : y);   // stored centres: background frame
    store('sem_c1_hips', cen);
    if (torso) store('sem_c1_torso', img([0, 0, 0.25]));
    if (head) store('sem_c1_head', img([0, 0, 0.45]));
    if (sides) { store('sem_c1_thighs_l', img([0, thigh[0], thigh[1]])); store('sem_c1_thighs_r', img([0, -thigh[0], thigh[1]])); }
    if (camPath) { (ch.cam_x ||= []).push(K[0]); (ch.cam_y ||= []).push(K[1]); }
    t.push(tm); ov.push({ pts });
  }
  const channels = Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, { t: Float64Array.from(t), v: Float32Array.from(v) }]));
  return { id: 'solo', channels, frames: { t, v: t.map(() => 0.5), ov }, scenes: [{ start_ms: 0, end_ms: t[N - 1] + 34, groups: { sem_c1_hips: { id: 4 } } }], params: {} };
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const times = Array.from({ length: N }, (_, f) => Math.round((f * 1000) / FPS) / 1000);
const r = (a, truth) => corrAt(Array.from(a.y, (v) => v - 50), truth);
// opts.tag: the view tag reaches measure too (as axes-derive passes viewFor's result)
const read = (run, view, opts = {}) => { const m = measure(run, 0, 1e9, { aspect: 1, ...(opts.cam ? { cam: opts.cam } : {}), ...(opts.tag ? { view: { view } } : {}) }); assert.ok(m, 'measured'); return { m, d: deriveShot(m, { view, ...opts }) }; };
const NUMS = {};
const note = (k, v) => { NUMS[k] = v; };

// the dancer: hips sway +-30 px (of 1080: 0.028 frame heights) at 1.3 s, a hip roll (tilt side to side) +-8 deg at 1.7 s, a small bounce at 0.65 s
const sway = (s) => W(s, 1.3), roll = (s) => W(s, 1.7, 0.4), bounce = (s) => W(s, 0.65, 1);
// roll + = its right hip up (tilting toward its own left: counter-clockwise on screen seen from behind); rx + lifts its LEFT hip
const rollT = (s) => -roll(s);
const DANCE = (s) => ({ y: 0.028 * sway(s), rx: (8 * Math.PI / 180) * roll(s), z: 0.006 * bounce(s) });

test('rear view, a lone dancer: sway and roll measured with the right signs (the character\'s own left = +), the bounce is the stroke proxy', () => {
  for (const view of ['rear', 'rearM', 'front']) {
    const { m, d } = read(soloRun(view, DANCE), view === 'rearM' ? 'rear' : view);
    assert.equal(m.vsFrame.ref, 'torso'); assert.equal(m.top, null); assert.equal(d.frame.who, 'c1');
    const s = d.axes.sway, ro = d.axes.roll, rs = r(s, times.map(sway)), rr = r(ro, times.map(rollT));
    note(`${view} sway`, rs); note(`${view} roll`, rr);
    assert.equal(s.label, 'measured', `${view} sway ${s.label} ${s.conf}`); assert.equal(ro.label, 'measured', `${view} roll ${ro.label} ${ro.conf}`);
    assert.ok(rs > 0.9, `${view} sway r ${rs}`); assert.ok(rr > 0.9, `${view} roll r ${rr}`);
    assert.equal(s.signFrom, 'sides'); assert.equal(ro.signFrom, 'sides');
    assert.ok(d.axes.twist.label !== 'measured', 'twist is out of plane from behind');
    const rb = corrAt(Array.from(m.s), times.map(bounce));
    note(`${view} bounce (s)`, rb);
    assert.ok(rb > 0.9, `${view} s vs the bounce ${rb}`);
  }
  // without painted sides the mirror reads backwards (the convention: seen from behind)
  const bare = read(soloRun('rearM', DANCE, { sides: false }), 'rear').d;
  assert.ok(r(bare.axes.sway, times.map(sway)) < -0.9 && r(bare.axes.roll, times.map(rollT)) < -0.9, 'mirror without sides');
  assert.equal(bare.axes.sway.signFrom, undefined);
});

test('side view: the bounce is the stroke proxy, the hips rocking forward / back is pitch (measured), forward / back is surge', () => {
  const rock = (s) => W(s, 1.1, 0.3), fwd = (s) => W(s, 1.9, 1.2);
  const { m, d } = read(soloRun('side', (s) => ({ z: 0.012 * bounce(s), ry: 0.12 * rock(s), x: 0.02 * fwd(s) }), { sides: false }), 'side');
  const rp = r(d.axes.pitch, times.map(rock)), rs = r(d.axes.surge, times.map(fwd)), rb = corrAt(Array.from(m.s), times.map(bounce));
  note('side pitch', rp); note('side surge', rs); note('side bounce (s)', rb);
  assert.equal(d.axes.pitch.label, 'measured'); assert.equal(d.axes.surge.label, 'measured');
  // pitch + = counter-clockwise on screen; ry + (about its left, right-handed) turns forward (picture right) up = clockwise on screen
  assert.ok(Math.abs(rp) > 0.9, `pitch r ${rp}`); assert.ok(rp < 0, 'pitch sign: the documented screen convention');
  // surge + = n = picture-left for an upright body: this dancer faces picture right, so its forward reads negative (a flip fixes it)
  assert.ok(rs < -0.9, `surge r ${rs}`);
  assert.ok(rb > 0.9, `s vs the bounce ${rb}`);
});

test('a dancer lying on its side (its up = picture right): sideways in its own frame is still sway', () => {
  const { m, d } = read(soloRun('lying', DANCE, { sides: false }), 'rear');
  assert.ok(Math.abs(m.u[0] - 1) < 0.05, `up ${m.u}`);
  const rs = r(d.axes.sway, times.map(sway)), rb = corrAt(Array.from(m.s), times.map(bounce));
  note('lying sway', rs); note('lying bounce (s)', rb); note('lying roll', r(d.axes.roll, times.map(rollT)));
  assert.equal(d.axes.sway.label, 'measured');
  assert.ok(rs > 0.9, `lying sway r ${rs}`); assert.ok(rb > 0.9, `lying bounce ${rb}`);
  assert.ok(r(d.axes.roll, times.map(rollT)) > 0.9, 'roll: the in-plane turn, whatever way it lies');
});

test('top view: the in-plane turn is twist (measured), sideways is sway', () => {
  const tw = (s) => W(s, 1.5, 0.2);
  const { d } = read(soloRun('top', (s) => ({ y: 0.028 * sway(s), rz: 0.12 * tw(s) }), { torso: false, head: true }), 'top');
  // a head straight above the hips seen from above sits on them: no direction there (the reading falls back, see below)
  note('top twist', r(d.axes.twist, times.map(tw)));
  assert.equal(d.axes.twist.label, 'measured');
  assert.ok(Math.abs(r(d.axes.twist, times.map(tw))) > 0.9);
  assert.equal(d.axes.roll.label, 'none');
});

const near = (u, e) => u[0] * e[0] + u[1] * e[1];   // cosine of two unit vectors

test('paw-jyde.13: hips only, a wide cloud seen from behind, the view tagged rear: up = the hips\' short axis, sway is sway', () => {
  // the cloud is wider than tall (its long axis horizontal): the old reading took that as the up and swapped sway / bounce
  const w = read(soloRun('rear', DANCE, { torso: false, sides: false }), 'rear', { tag: true });
  assert.equal(w.m.vsFrame.ref, 'short axis'); assert.equal(w.m.vsFrame.refGuess, true);
  const rs = r(w.d.axes.sway, times.map(sway)), rb = corrAt(Array.from(w.m.s), times.map(bounce));
  note('wide rear-tagged sway', rs); note('wide rear-tagged bounce (s)', rb);
  assert.ok(near(w.m.u, [0, -1]) > 0.99, `up ${w.m.u}`);
  assert.ok(rs > 0.95, `sway r ${rs}`); assert.ok(rb > 0.9, `bounce ${rb}`);
  assert.equal(w.d.axes.sway.label, 'estimate', 'a guessed up stays capped');
  assert.equal(w.d.axes.roll.label, 'measured', 'roll (the in-plane turn) needs no up');
  // tagged side: the long axis is not trusted there either: the picture vertical
  assert.equal(read(soloRun('rear', DANCE, { torso: false, sides: false }), 'side', { tag: true }).m.vsFrame.ref, 'vertical');
});

test('paw-jyde.13: hips + two thighs agreeing below them, no view tag: up from the thighs (upright and lying)', () => {
  const low = { torso: false, thigh: [0.03, -0.12] };   // 14 deg either side of straight down: they agree
  const a = read(soloRun('rear', DANCE, low), 'side');
  assert.equal(a.m.vsFrame.ref, 'legs'); assert.ok(near(a.m.u, [0, -1]) > 0.99, `up ${a.m.u}`);
  const rf = corrAt(Array.from(a.m.m.fside), times.map(sway));
  note('thighs fside vs sway', rf);
  assert.ok(rf > 0.95, `fside vs sway ${rf}`);
  const b = read(soloRun('lying', DANCE, low), 'side');
  assert.equal(b.m.vsFrame.ref, 'legs'); assert.ok(near(b.m.u, [1, 0]) > 0.99, `lying up ${b.m.u}`);
  // spread thighs (50 deg either side) disagree: not the legs (the left / right line takes over)
  assert.equal(read(soloRun('rear', DANCE, { torso: false }), 'side').m.vsFrame.ref, 'sides');
});

test('paw-jyde.13: hips + painted left / right parts: up across the left -> right line (a body leaning 30 deg)', () => {
  const { m } = read(soloRun('tilt', DANCE, { torso: false }), 'side');
  const e = [Math.sin(TILT), -Math.cos(TILT)];   // the body's up, leaning with it
  note('sides up cos', near(m.u, e));
  assert.equal(m.vsFrame.ref, 'sides'); assert.ok(near(m.u, e) > 0.99, `up ${m.u} vs ${e}`);
  const rf = corrAt(Array.from(m.m.fside), times.map(sway));
  note('sides fside vs sway', rf);
  assert.ok(Math.abs(rf) > 0.95, `fside vs sway ${rf}`);
});

test('paw-jyde.13: hips only, no tag: the picture vertical, labelled a guess; torso / head still win', () => {
  const v = read(soloRun('rear', DANCE, { torso: false, sides: false }), 'rear');
  assert.equal(v.m.vsFrame.ref, 'vertical'); assert.equal(v.m.vsFrame.refGuess, true);
  note('vertical-guess sway', r(v.d.axes.sway, times.map(sway)));
  assert.equal(v.d.axes.sway.label, 'estimate');
  assert.ok(r(v.d.axes.sway, times.map(sway)) > 0.9, 'upright: the vertical guess is right, only the label is capped');
  // a round hips cloud tagged rear: no short axis either -> the picture vertical
  const round = dirs(20, 0.7).map(([a, b, c]) => [0.07 * a, 0.07 * b, 0.07 * c]);
  const rr = soloRun('rear', DANCE, { torso: false, sides: false });
  rr.frames.ov.forEach((o, f) => { const sec = f / FPS, M = DANCE(sec); o.pts = round.map((p) => { let q = rot(p, 0, M.rx); return [0.5 - (q[1] + M.y), 0.5 - (q[2] + M.z), 1, 1, 0, 4]; }); });
  assert.equal(read(rr, 'rear', { tag: true }).m.vsFrame.ref, 'vertical');
  const head = read(soloRun('rear', DANCE, { torso: false, head: true }), 'rear', { tag: true });
  assert.equal(head.m.vsFrame.ref, 'head'); assert.equal(head.d.axes.sway.label, 'measured');
  assert.equal(read(soloRun('rear', DANCE), 'rear', { tag: true }).m.vsFrame.ref, 'torso');
});

test('paw-jyde.13: the dancer lying on its side with its thighs painted (no torso): still sway', () => {
  for (const tag of [true, false]) {
    const { m, d } = read(soloRun('lying', DANCE, { torso: false }), 'rear', { tag });
    assert.equal(m.vsFrame.ref, 'sides'); assert.ok(near(m.u, [1, 0]) > 0.99, `up ${m.u}`);
    const rs = r(d.axes.sway, times.map(sway)), rb = corrAt(Array.from(m.s), times.map(bounce));
    note(`lying thighs sway${tag ? ' (tagged)' : ''}`, rs); note(`lying thighs bounce${tag ? ' (tagged)' : ''}`, rb);
    assert.ok(rs > 0.95, `sway r ${rs}`); assert.ok(rb > 0.9, `bounce ${rb}`);
  }
});

test('camera: a pan in the picture is removed via the stored camera path; without removal on a pan-tagged shot, confidence drops', () => {
  const pan = (s) => [0.05 * W(s, 1.3, 2), 0.01 * W(s, 2.3)];   // a pan at the sway's own period, out of phase
  const clean = read(soloRun('rear', DANCE), 'rear').d.axes.sway;
  const removed = read(soloRun('rear', DANCE, { cam: pan, camPath: true }), 'rear');
  assert.equal(removed.m.vsFrame.removed, true);
  note('pan removed sway', r(removed.d.axes.sway, times.map(sway)));
  assert.ok(r(removed.d.axes.sway, times.map(sway)) > 0.9 && Math.abs(removed.d.axes.sway.conf - clean.conf) < 0.05, 'the same as without the pan');
  // camera removal off (the shot's setting): the image positions; tagged pan -> CAM_W and the frame says so
  const raw = soloRun('rear', DANCE, { cam: pan });
  const off = read(raw, 'rear', { cam: { run: raw, removed: false, tag: 'pan' } });
  note('pan kept sway', r(off.d.axes.sway, times.map(sway)));
  assert.equal(off.d.frame.camLeak, true);
  assert.ok(off.d.axes.sway.conf < clean.conf * 0.6, `conf ${off.d.axes.sway.conf} vs ${clean.conf}`);
  assert.ok(r(off.d.axes.sway, times.map(sway)) < 0.8, 'the pan leaks in');
  // the camera re-handled by the shot's setting (cam.run = fusionInput's): a run with the pan removed reads clean again
  const rm = soloRun('rear', DANCE, { cam: pan, camPath: true });
  const via = read(raw, 'rear', { cam: { run: () => rm, removed: true, tag: 'pan' } });
  assert.ok(r(via.d.axes.sway, times.map(sway)) > 0.9 && via.d.frame.camLeak === false);
  assert.ok(SIX.CAM_W < 1);
});

test('two characters with hips: the pair reading, unchanged to the bit (the fixtures at 1c18a5b); one painted character: solo, labelled', () => {
  const head = JSON.parse(readFileSync(new URL('./fixtures/six-axis-pair-head.json', import.meta.url), 'utf8'));
  const now = JSON.parse(JSON.stringify(digest()));
  assert.deepEqual(Object.keys(now).sort(), Object.keys(head).sort());
  for (const k of Object.keys(head)) assert.deepEqual(now[k], head[k], k);
  // the Top painted with only a head (no hips / torso / penis): the Bottom's hips solo, the frame naming the other character
  const run = soloRun('rear', DANCE);
  const T = run.channels.sem_c1_torso_x;
  run.channels.sem_c2_head_x = { t: T.t, v: Float32Array.from(T.v, () => 0.7) }; run.channels.sem_c2_head_y = { t: T.t, v: Float32Array.from(T.v, () => 0.3) };
  const { d } = read(run, 'rear');
  assert.deepEqual(d.frame.others, ['c2']); assert.equal(d.axes.sway.label, 'measured');
  // a pair whose Top is never seen in this shot: solo too (it was all 'none' / the Bottom's turn alone before)
  run.channels.sem_c2_hips_x = { t: T.t, v: Float32Array.from(T.v, () => NaN) }; run.channels.sem_c2_hips_y = run.channels.sem_c2_hips_x;
  assert.equal(measure(run, 0, 1e9, { aspect: 1 }).vsFrame.who, 'c1');
  // a lone Top (c2) masturbating: its hips, its painted sides
  const top = soloRun('rear', DANCE);
  for (const k of Object.keys(top.channels)) if (k.startsWith('sem_c1_')) { top.channels[k.replace('sem_c1_', 'sem_c2_')] = top.channels[k]; delete top.channels[k]; }
  top.scenes[0].groups = { sem_c2_hips: { id: 4 } };
  const dt = read(top, 'rear').d;
  assert.equal(dt.frame.who, 'c2'); assert.ok(r(dt.axes.sway, times.map(sway)) > 0.9 && dt.axes.sway.signFrom === 'sides');
});

test('POV with no angle reads like rear: estimate at most unless the painted sides say which way it faces', () => {
  const run = soloRun('rear', DANCE, { sides: false });
  const m = measure(run, 0, 1e9, { aspect: 1 });
  const d = deriveShot(m, { view: 'top', pov: true });
  assert.equal(d.frame.view, 'rear'); assert.equal(d.frame.facing, true);
  assert.notEqual(d.axes.sway.label, 'measured');
  const ds = deriveShot(measure(soloRun('rear', DANCE), 0, 1e9, { aspect: 1 }), { view: 'top', pov: true });
  assert.equal(ds.axes.sway.label, 'measured'); assert.equal(ds.axes.roll.label, 'measured');
  assert.deepEqual(sideSigns(m, 'side'), {});
});

test('numbers (printed for the report)', () => { console.log('solo synthetic r:', JSON.stringify(Object.fromEntries(Object.entries(NUMS).map(([k, v]) => [k, +v.toFixed(3)])))); });
