// paw-4c48.10: the shaft's measured entry (the position bar's hollow diamond) as a shot's stroke source: lib/shaft-source.js
// (shaftScene / shaftChannel / shaftDisagrees / shaftChipText), lib/shaft.js railPos, and the source through channelPatch. The
// synthetic shot of video-posbar-shaft.test.mjs: an oblique shaft (-40 deg) of full length 0.3 frame heights thrusting into a
// fixed entry, visible share vis(t) = 0.6 + 0.3 cos (1 s strokes), stored channels only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { railContext, railAt, railPos, depthScale, shaftState, stateText, shaftDepth, stateIndex } from '../src/lib/shaft.js';
import { shaftScene, shaftChannel, shaftDisagrees, shaftChipText, periodicity, HINT } from '../src/lib/shaft-source.js';
import { channelPatch, stitchPoints } from '../src/lib/runs-channel.js';
import { canSource } from '../src/lib/signal-source.js';
import { shaftBar, posOn, onTrimmed, barPoint, LOOK_DEFAULT } from '../src/features/video/posbar.js';
import { deriveClean } from '../src/lib/rederive.js';
import { channelOf } from '../src/lib/runs.js';

const A = 16 / 9, N = 120, T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / 30));
const ANG = (-40 * Math.PI) / 180, U = [Math.cos(ANG), Math.sin(ANG)], LF = 0.3, E = [0.62 * A, 0.38];
const vis = (t) => 0.6 + 0.3 * Math.cos((2 * Math.PI * t) / 1000);
const base = (t) => [E[0] - vis(t) * LF * U[0], E[1] - vis(t) * LF * U[1]];   // square units
const ch = (f) => channelOf(T.map((t, i) => { const v = f(t, i); return [t, v === v && v != null ? v : null]; }));

function run({ conf = () => 1, gap = () => false, fused = null, flips = [] } = {}) {
  const P = 'sem_c2_penis_';
  return { id: 'r', range: { start: 0, end: 4000 }, flips, scenes: [{ start_ms: 0, end_ms: 4000, sign: 1, shaft: { c2_penis: { source: 'sam', full: 'seen', l_full_w: 5 } } }],
    points0: { at: Float64Array.from([0, 4000]), pos: Float64Array.from([50, 50]) },
    channels: {
      [P + 'len']: ch((t, i) => (gap(i) ? NaN : vis(t))), [P + 'in']: ch((t, i) => (gap(i) ? NaN : 1 - vis(t))), [P + 'in_conf']: ch((t, i) => (gap(i) ? 0 : conf(t, i))),
      [P + 'bx']: ch((t, i) => (gap(i) ? NaN : base(t)[0] / A)), [P + 'by']: ch((t, i) => (gap(i) ? NaN : base(t)[1])),
      [P + 'ex']: ch((t, i) => (gap(i) ? NaN : E[0] / A)), [P + 'ey']: ch((t, i) => (gap(i) ? NaN : E[1])), [P + 'w']: ch((t, i) => (gap(i) ? NaN : 0.05)),
      // the stroke as another channel would read it (larger = out), for the fallback and the sidecar pick
      proj: ch((t) => vis(t)),
      ...(fused ? { fused: ch(fused) } : {}),
    } };
}
/** The diamond's reading at t as PosBar computes it: posOn on the (untrimmed, unflipped) shaft bar, clamped as it is drawn. */
const diamond = (ctx, t) => { const r = railAt(ctx, t, A), b = shaftBar(r, LOOK_DEFAULT, false, A); return Math.max(0, Math.min(100, posOn(b, b.entry, A))); };

test('measured frames: the source IS the diamond (railPos = posOn on the shaft bar), with and without the owner\'s marks', () => {
  for (const calib of [null, { hilt: 500, out: 0 }]) {
    const R = run(), ctx = railContext(R, 0, calib, { aspect: A }), s = shaftScene(R, 0, { calib, aspect: A });
    assert.equal(s.share, 1);
    assert.equal(s.how, null, 'nothing to fill');
    assert.equal(s.source, 'sam');
    for (let i = 0; i < s.t.length; i++) {
      assert.ok(Math.abs(100 * s.v[i] - diamond(ctx, s.t[i])) < 1e-9, `t ${s.t[i]}: ${100 * s.v[i]} vs the diamond ${diamond(ctx, s.t[i])}`);
      assert.ok(Math.abs(railPos(railAt(ctx, s.t[i], A), A) - diamond(ctx, s.t[i])) < 1e-9);
    }
    if (!calib) assert.ok(Math.abs(s.v[15] - (vis(s.t[15]) - 0.3) / 0.6) < 0.005, 'unmarked: between the smallest (0.3) and largest (0.9) recurring visible share');
    else { assert.ok(Math.abs(s.v[15]) < 0.01, 'the hilted mark reads 0'); assert.ok(Math.abs(s.v[0] - 1) < 0.01, 'fully out reads 1'); }
  }
});

test('a gap (unsure frames) is filled from fusion seated on the shaft\'s level and size, and joins without a jump', () => {
  const gap = (i) => i >= 40 && i < 62;
  // fusion reads the same strokes upside down, at another level and size (and a little noise): the seat turns it back
  const R = run({ conf: (t, i) => (gap(i) ? 0.2 : 1), fused: (t, i) => 3 - 2 * vis(t) + 0.01 * Math.sin(i) });
  const ctx = railContext(R, 0, null, { aspect: A }), s = shaftScene(R, 0, { aspect: A, fused: R.channels.fused });
  assert.equal(s.how, 'fusion');
  assert.ok(Math.abs(s.share - (N - 22) / N) < 1e-9, `measured share ${s.share}`);
  let worst = 0, step = 0;
  for (let i = 0; i < N; i++) {
    if (!gap(i)) assert.ok(Math.abs(100 * s.v[i] - diamond(ctx, s.t[i])) < 1e-9, 'measured frames untouched');
    else worst = Math.max(worst, Math.abs(s.v[i] - (vis(s.t[i]) - 0.3) / 0.6));
    if (i) step = Math.max(step, Math.abs(s.v[i] - s.v[i - 1]));
  }
  assert.ok(worst < 0.05, `inside the gap the seated fusion follows the strokes (worst ${worst.toFixed(3)})`);
  const motion = Math.max(...T.slice(1).map((t, i) => Math.abs(vis(t) - vis(T[i])) / 0.6));
  assert.ok(step <= motion * 1.25, `no jump: the largest frame step ${step.toFixed(3)} vs the strokes' own ${motion.toFixed(3)}`);
  // no fusion: a straight line between the gap's ends (continuous at both)
  const L = shaftScene(R, 0, { aspect: A }), a = 39, b = 62;
  assert.equal(L.how, 'line');
  for (let i = a + 1; i < b; i++) assert.ok(Math.abs(L.v[i] - (L.v[a] + ((L.v[b] - L.v[a]) * (L.t[i] - L.t[a])) / (L.t[b] - L.t[a]))) < 1e-9);
});

test('offered only where the rail reads the shaft; the reasons in words; the chip says measured vs filled', () => {
  const low = shaftScene(run({ conf: (t) => (t < 1000 ? 1 : 0.2) }), 0, { aspect: A });
  assert.match(low.why, /no shaft read in this shot \(confident on \d+ % of it\)/);
  assert.match(low.why, /no visible-points reading here/, 'both readings say why');
  // confident but not repeating (a slow drift, no strokes): not offered, however sure SAM is (paw-72z)
  const flat = (() => { const R = run(); const P = 'sem_c2_penis_', v2 = (t) => 0.4 + 0.4 * (t / 4000);
    for (const [k, f] of [['len', v2], ['in', (t) => 1 - v2(t)], ['bx', (t) => (E[0] - v2(t) * LF * U[0]) / A], ['by', (t) => E[1] - v2(t) * LF * U[1]]]) R.channels[P + k] = ch(f);
    return shaftScene(R, 0, { aspect: A }); })();
  assert.match(flat.why || `offered, q ${flat.q}`, /does not repeat with the strokes here \(periodicity/, flat.why);
  const none = { id: 'x', range: { start: 0, end: 1000 }, scenes: [], channels: { proj: ch((t) => t) } };
  assert.equal(shaftChannel(none, { aspect: A }).t, undefined, 'no scene reads it: only the reasons');
  assert.match(shaftChannel(none, { aspect: A }).info[0].why, /no shaft read/);
  assert.equal(canSource(none, 'shaft'), false);
  assert.equal(canSource(run(), 'shaft'), true);
  const c = shaftChannel(run({ conf: (t, i) => (i >= 40 && i < 58 ? 0.2 : 1) }), { aspect: A });
  assert.ok(c.absolute && c.signed && c.min === 0 && c.max === 1 && c.scaled === c.v);
  assert.equal(c.info[0].ok, true);
  assert.equal(shaftChipText(c.info[0]), 'shaft 85 % · filled 15 %');
  assert.equal(shaftChipText({ ok: true, share: 1 }), 'shaft 100 %');
  assert.equal(shaftChipText({ ok: false, why: 'x' }), 'Shaft (not read here)');
});

test('through channelPatch: the trace is the diamond, the points sit on it, a flip mirrors it, nothing matches it away', () => {
  const R = run(), ctx = railContext(R, 0, null, { aspect: A });
  const derives = [{ source: 'shaft', match: true }];
  const p = channelPatch(R, 'proj', {}, [], { aspect: A, derives });
  assert.deepEqual(p.sceneChannels, ['shaft']);
  assert.equal(p.shaftSrc[0].ok, true);
  assert.equal(p.match, null, 'the shaft is never flipped to match the scene\'s channel');
  // the lane trace (0..1) = the diamond / 100, frame for frame
  let n = 0;
  for (let j = 0; j < p.lane.t.length; j++) { const v = p.lane.v[j]; if (v !== v) continue; n++; assert.ok(Math.abs(100 * v - diamond(ctx, p.lane.t[j])) < 1e-3, `lane at ${p.lane.t[j]}`); }
  assert.ok(n >= N - 1);
  // every point (turns: the classic fit's extremes) sits on the diamond at its time: depth absolute, not re-ranged
  const P = p.points0;
  assert.ok(P.at.length >= 6);
  for (let j = 0; j < P.at.length; j++) assert.ok(Math.abs(P.pos[j] - diamond(ctx, P.at[j])) <= 1, `point ${P.at[j]}: ${P.pos[j]} vs ${diamond(ctx, P.at[j]).toFixed(1)}`);
  assert.ok(Math.min(...P.pos) <= 2 && Math.max(...P.pos) >= 98, 'the shaft\'s recurring extremes are hilted and fully out: 0..100');
  // the flip (F) still works: pos -> 100 - pos
  const f = channelPatch(run({ flips: [0] }), 'proj', {}, [], { aspect: A, derives, flips: [] });
  assert.equal(f.points0.at.length, P.at.length);
  for (let j = 0; j < P.at.length; j++) assert.ok(Math.abs(f.points0.pos[j] - (100 - P.pos[j])) <= 1, `flipped ${f.points0.pos[j]} vs ${100 - P.pos[j]}`);
  // Smart stroke reads it like any other source (the strokes step, depth as it reads)
  const sm = channelPatch(R, 'proj', {}, [], { aspect: A, derives: [{ source: 'shaft', smart: true }] });
  assert.ok(sm.points0.at.length >= 6 && Math.min(...sm.points0.pos) <= 5 && Math.max(...sm.points0.pos) >= 95, `smart: ${Array.from(sm.points0.pos).join(' ')}`);
  // a run scene that cannot read the shaft keeps its own channel
  const lo = channelPatch(run({ conf: (t) => (t < 1000 ? 1 : 0.2) }), 'proj', {}, [], { aspect: A, derives });
  assert.deepEqual(lo.sceneChannels, ['proj']);
  assert.equal(lo.shaftSrc[0].ok, false);
  // no shaft picked: nothing built
  assert.equal(channelPatch(R, 'proj', {}, [], { aspect: A, derives: [] }).shaftSrc, null);
});

test('stitching never carries a level into a shaft scene', () => {
  const two = { range: { start: 0, end: 4000 }, scenes: [{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 4000 }], channels: { x: { t: [0, 33], v: [0, 0] } } };
  const pts = { at: Float64Array.from([200, 700, 1200, 1700, 2200, 2700, 3200, 3700]), pos: Float64Array.from([10, 30, 10, 30, 70, 90, 70, 90]) };
  const doc = [{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 4000, join: true }];
  const carried = stitchPoints(pts, { ...two, sceneChannels: ['proj', 'proj'] }, [], {}, { scenes: doc }).points;
  const kept = stitchPoints(pts, { ...two, sceneChannels: ['proj', 'shaft'] }, [], {}, { scenes: doc }).points;
  assert.ok(carried.pos.at(-1) < 60, `a plain scene carries the level (${Array.from(carried.pos).join(' ')})`);
  assert.equal(kept.pos.at(-1), 90, `the shaft scene keeps its own (${Array.from(kept.pos).join(' ')})`);
});

test('the quiet hint: measured over most of the shot and the current points read it differently', () => {
  const s = shaftScene(run(), 0, { aspect: A }), at = Float64Array.from(T), same = { at, pos: Float64Array.from(T, (t) => (100 * (vis(t) - 0.3)) / 0.6) };
  assert.equal(shaftDisagrees(s, same, 0, 4000), null, 'agrees: no mark');
  const inv = shaftDisagrees(s, { at, pos: Float64Array.from(same.pos, (x) => 100 - x) }, 0, 4000);
  assert.ok(inv && inv.r < -0.9, `upside down: r ${inv?.r}`);
  const big = shaftDisagrees(s, { at, pos: Float64Array.from(same.pos, (x) => 50 + (1.5 * (x - 50))) }, 0, 4000);
  assert.equal(big, null, '1.5x the size: within the band');
  const huge = shaftDisagrees(s, { at, pos: Float64Array.from(same.pos, (x) => 50 + (x - 50) / 3) }, 0, 4000);
  assert.ok(huge && huge.size > HINT.SIZE, `the current strokes a third of the shaft's: size ${huge?.size}`);
  const unsure = shaftScene(run({ conf: (t, i) => (i % 2 ? 0.2 : 1) }), 0, { aspect: A });
  assert.equal(shaftDisagrees(unsure, { at, pos: Float64Array.from(same.pos, (x) => 100 - x) }, 0, 4000), null, 'measured on half the shot: no mark');
});

/** The same shot with the penis group's points: 12 members along the shaft (5 %..95 % of it from the base), each visible while it
 *  is outside the entry (its place <= the visible share); SAM reads the strokes upside down at full confidence (paw-72z). */
function membersRun({ samInverted = true } = {}) {
  const R = run(), id = 4, places = Array.from({ length: 12 }, (_, j) => 0.05 + (0.9 * j) / 11);
  R.scenes[0].groups = { sem_c2_penis: { id } };
  R.frames = { t: T, ov: T.map((t) => ({ pts: places.map((p) => { const b = base(t); return [(b[0] + p * LF * U[0]) / A, b[1] + p * LF * U[1], p <= vis(t) ? 1 : 0, 1, 0, id]; }) })) };
  if (samInverted) { const P = 'sem_c2_penis_', w = (t) => 1.2 - vis(t); R.channels[P + 'len'] = ch(w); R.channels[P + 'in'] = ch((t) => 1 - w(t)); R.channels[P + 'bx'] = ch((t) => (E[0] - w(t) * LF * U[0]) / A); R.channels[P + 'by'] = ch((t) => E[1] - w(t) * LF * U[1]); }
  return R;
}

test('two readings: the visible points are chosen first; the diamond draws the one the source uses', () => {
  const R = membersRun(), s = shaftScene(R, 0, { aspect: A });
  assert.equal(s.reading, 'points', `chosen: ${s.reading} (other ${JSON.stringify(s.other)})`);
  assert.equal(s.other.reading, 'sam');
  assert.ok(s.q >= 0.5, `the points repeat with the strokes (q ${s.q})`);
  // the points reading follows the stroke (count share, quantised in 1/12 steps): within a step of the truth
  let worst = 0;
  for (let i = 0; i < s.t.length; i++) if (s.m[i]) worst = Math.max(worst, Math.abs(s.v[i] - Math.floor(12 * Math.min(1, (vis(s.t[i]) - 0.05) / 0.9 * 11 / 12 + 1 / 12) + 1e-9) / 12));
  const r = (() => { let a = 0, b = 0, c = 0, d = 0, e = 0, n = 0; for (let i = 0; i < s.t.length; i++) if (s.m[i]) { const x = s.v[i], y = vis(s.t[i]); n++; a += x; b += y; c += x * y; d += x * x; e += y * y; } return (c - (a * b) / n) / Math.sqrt((d - (a * a) / n) * (e - (b * b) / n)); })();
  assert.ok(r > 0.95, `the points reading follows the stroke: r ${r.toFixed(3)}`);
  // the source is the diamond of the points rail, frame for frame (the store hands PosBar this context while Shaft plays)
  const ctx = railContext(R, 0, null, { aspect: A, reading: 'points' });
  for (let i = 0; i < s.t.length; i++) if (s.m[i]) assert.ok(Math.abs(100 * s.v[i] - diamond(ctx, s.t[i])) < 1e-9);
  // SAM inverted and fully confident: still offered only as the other reading, never chosen on its confidence
  const sam = shaftScene(R, 0, { aspect: A, reading: 'sam' });
  assert.ok(sam.t && sam.reading === 'sam');
  const rs = (() => { let a = 0, b = 0, c = 0, d = 0, e = 0, n = 0; for (let i = 0; i < sam.t.length; i++) if (sam.m[i]) { const x = sam.v[i], y = vis(sam.t[i]); n++; a += x; b += y; c += x * y; d += x * x; e += y * y; } return (c - (a * b) / n) / Math.sqrt((d - (a * a) / n) * (e - (b * b) / n)); })();
  assert.ok(rs < -0.9, `SAM reads it upside down here (r ${rs.toFixed(2)}): the reason it is not chosen on confidence`);
  assert.ok(periodicity(s.t, s.v).q >= 0.5);
});

test('picking Shaft clears an earlier flip (derive.unflip): the run scene plays unflipped, F after it flips again, other sources ignore it', () => {
  const ctx = { aspect: A, derives: [{ source: 'shaft' }] };
  const plain = channelPatch(run(), 'proj', {}, [], ctx).points0;
  const cleared = channelPatch(run({ flips: [0] }), 'proj', {}, [], { aspect: A, derives: [{ source: 'shaft', unflip: true }] }).points0;
  assert.deepEqual(Array.from(cleared.pos), Array.from(plain.pos), 'flipped before the pick: plays as the shaft reads');
  const again = channelPatch(run(), 'proj', {}, [], { aspect: A, derives: [{ source: 'shaft', unflip: true }] }).points0;
  for (let j = 0; j < plain.pos.length; j++) assert.ok(Math.abs(again.pos[j] - (100 - plain.pos[j])) <= 1, 'F pressed after the pick (the run flip gone): flipped');
  assert.equal(deriveClean({ source: 'shaft', unflip: true }).unflip, true);
  assert.equal(deriveClean({ source: 'fused', unflip: true })?.unflip, undefined, 'kept only beside the shaft source');
  const fz = channelPatch(run({ flips: [0] }), 'proj', {}, [], { aspect: A, derives: [{ source: 'proj', unflip: true }] });
  assert.ok(fz.dir.whole.includes(0), 'another source keeps the run\'s flip');
});

test('a trimmed shaft bar: the marker goes through the same trim as the measured entry, so they still meet', () => {
  const R = run(), ctx = railContext(R, 0, null, { aspect: A });
  for (const look of [{ ...LOOK_DEFAULT, trim0: 0.2, trim1: 0.1 }, { ...LOOK_DEFAULT, trim0: -0.3, trim1: 0.25 }]) for (const t of [100, 450, 1300]) {
    const r = railAt(ctx, t, A), bar = shaftBar(r, look, false, A), p = railPos(r, A);   // the script = the reading
    const m = posOn(bar, bar.entry, A), mk = onTrimmed(p, look);
    assert.ok(Math.abs(m - mk) < 1e-6, `trims ${look.trim0}/${look.trim1} at ${t}: diamond ${m.toFixed(2)} vs marker ${mk.toFixed(2)} along the drawn bar`);
    assert.ok(Math.hypot((barPoint(bar, mk)[0] - barPoint(bar, m)[0]) * A, barPoint(bar, mk)[1] - barPoint(bar, m)[1]) < 1e-6, 'drawn on the same pixel (both kept to the ends of the bar, as PosBar paints them)');
  }
});

// ---- paw-4c48: the depth scale from the extremes that agree with the motion (lib/shaft.js depthScale) ----
const TT = Array.from({ length: 300 }, (_, i) => Math.round((i * 1000) / 30)), wave = (t) => 0.55 + 0.35 * Math.cos((2 * Math.PI * t) / 900);
test('the depth scale: the largest / smallest that recur; a spike and a collapsed stretch do not set it', () => {
  const x = TT.map(wave), s0 = depthScale(TT, x);
  assert.ok(Math.abs(s0.a - 0.2) < 0.01 && Math.abs(s0.b - 0.9) < 0.01 && s0.from === 'turns', JSON.stringify(s0));
  const spike = x.map((v, i) => (i === 100 ? 0.02 : i === 200 ? 1.4 : v));
  const s1 = depthScale(TT, spike);
  assert.ok(Math.abs(s1.a - 0.2) < 0.01 && Math.abs(s1.b - 0.9) < 0.01, `one-frame spikes ignored: ${JSON.stringify(s1)}`);
  const collapsed = x.map((v, i) => (i >= 150 && i < 180 ? 0.05 + 0.02 * Math.cos(i) : v));   // the mask crushed for one stroke
  const s2 = depthScale(TT, collapsed);
  assert.ok(Math.abs(s2.a - 0.2) < 0.02, `a collapsed stroke (once) does not set hilted: ${JSON.stringify(s2)}`);
  const held = depthScale(TT, collapsed, (i) => !(i >= 150 && i < 180));
  assert.ok(Math.abs(held.a - 0.2) < 0.01, 'unsure frames are not read');
});

test('the depth scale with a motion signal: extremes at the wrong phase are ignored', () => {
  // the reading's every other bottom falls where the motion is at a TOP (wrong phase): a deep false minimum each time
  const motion = { t: Float64Array.from(TT), v: Float64Array.from(TT, (t) => Math.cos((2 * Math.PI * t) / 900)) };
  const x = TT.map((t) => { const ph = ((t % 1800) + 1800) % 1800; return wave(t) - (Math.abs(ph - 0) < 60 || Math.abs(ph - 1800) < 60 ? 0.15 : 0); });
  const own = depthScale(TT, x), withMotion = depthScale(TT, x, () => true, { motion });
  assert.equal(withMotion.from, 'motion');
  assert.ok(withMotion.b <= own.b + 1e-9 && Math.abs(withMotion.a - 0.2) < 0.02, `with the motion: ${JSON.stringify(withMotion)} (alone: ${JSON.stringify(own)})`);
  // every other stroke a bump OUT where the motion is at its bottom (the reading says out where the motion says in): alone it
  // recurs and would set "fully out" at 1.2; against the motion it is the wrong phase and does not count
  const bump = TT.map((t, i) => (Math.abs((i % 27) - 13) <= 4 && Math.floor(i / 27) % 2 ? wave(t) + (1 - Math.abs((i % 27) - 13) / 5) : wave(t)));
  const alone = depthScale(TT, bump), agree = depthScale(TT, bump, () => true, { motion });
  assert.ok(alone.b > 1.1, `alone the bumps set fully out: ${JSON.stringify(alone)}`);
  assert.ok(Math.abs(agree.b - 0.9) < 0.01 && Math.abs(agree.a - 0.2) < 0.01, `against the motion they do not: ${JSON.stringify(agree)}`);
});

test('a breathing scale no longer cancels the stroke: the diamond follows the stroke while the points fit swells with it', () => {
  // the penis points spread with the stroke (their fit scale = 1 + 0.4 x the visible share): the old rail divided by it
  const R = membersRun({ samInverted: false }), id = 4, places = Array.from({ length: 12 }, (_, j) => 0.05 + (0.9 * j) / 11);
  R.frames.ov = T.map((t) => ({ pts: places.map((p) => { const b = base(t), k = 1 + 0.4 * vis(t); return [(b[0] + k * p * LF * U[0]) / A, b[1] + k * p * LF * U[1], p <= vis(t) ? 1 : 0, 1, 0, id]; }) }));
  const ctx = railContext(R, 0, null, { aspect: A, reading: 'sam' }), d = T.map((t) => { const r = railAt(ctx, t, A); return r && !r.low ? railPos(r, A) : NaN; });
  const ok = d.map((v, i) => [v, (vis(T[i]) - 0.3) / 0.6 * 100]).filter(([v]) => Number.isFinite(v));
  assert.ok(ok.length > 60 && ok.every(([v, w]) => Math.abs(v - w) < 3), `the diamond on the stroke: worst ${Math.max(...ok.map(([v, w]) => Math.abs(v - w))).toFixed(1)} pos`);
});

test('paw-4c48.15: a rail context draws each reading at its own length (what the data view and the depth scale read)', () => {
  const R = membersRun({ samInverted: false });
  for (const reading of ['points', 'sam']) {
    const c = railContext(R, 0, null, { aspect: A, reading });
    assert.ok(c.G, reading);
    for (let i = 0; i < c.G.t.length; i += 7) {
      const own = reading === 'points' ? c.G.n[i] / c.G.nMax : NaN, len = c.G.L[i] / (c.Lf * c.G.sc[i]);
      if (reading === 'points') assert.ok(Math.abs(len - own) < 1e-9, `points frame ${i}: ${len} vs ${own}`);
      else if (Number.isFinite(len)) assert.ok(len > 0.2 && len < 1.01, `sam frame ${i}: ${len}`);
    }
  }
});

test('paw-4c48.17: the sidecar\'s per-frame reason (v4.50): bound / hidden / lost frames are unsure and never set the depth scale', () => {
  const R = run(), P = 'sem_c2_penis_', code = (i) => (i >= 20 && i < 36 ? 2 : i >= 50 && i < 56 ? 5 : i >= 70 && i < 73 ? 3 : 0);
  // bound: SAM prompted from too few points reads far too short (0.05) at in_conf x 0.3; lost: no reading; hidden: a paw at the entry
  R.channels[P + 'why'] = ch((t, i) => code(i));
  R.channels[P + 'len'] = ch((t, i) => (code(i) === 2 ? 0.05 : code(i) === 5 ? NaN : vis(t)));
  R.channels[P + 'in'] = ch((t, i) => (code(i) === 2 ? 0.95 : code(i) === 5 || code(i) === 3 ? NaN : 1 - vis(t)));
  R.channels[P + 'in_conf'] = ch((t, i) => (code(i) === 2 ? 0.27 : code(i) === 5 ? 0 : 0.9));
  const st = shaftState(R, 0, { aspect: A }), q = (i) => stateIndex(st, T[i]);
  assert.equal(st.state[q(25)], 'low'); assert.match(st.why[q(25)], /too few of the penis points/);
  assert.match(stateText(st, q(25)), /why unsure: SAM prompted from too few/);
  assert.ok(q(52) < 0 || (st.state[q(52)] === 'lost' && /SAM found no mask/.test(st.why[q(52)])), 'lost: no reading (or said why)');
  assert.equal(st.state[q(71)], 'lost'); assert.match(st.why[q(71)], /hand \/ paw \/ tail/);
  const ctx = railContext(R, 0, null, { aspect: A, reading: 'sam' });
  assert.ok(Math.abs(ctx.a - 0.3) < 0.01, `the bound frames' 0.05 never sets "hilted" (${ctx.a})`);
  assert.ok(railAt(ctx, T[25], A).low && railAt(ctx, T[71], A).low, 'bound and hidden frames draw unsure');
  const d = shaftDepth(R, 0, T.slice(0, 40), null, { aspect: A });
  assert.ok(Number.isNaN(d.depth[25]) && Math.abs(d.depth[10] - (vis(T[10]) - 0.3) / 0.6) < 0.02, 'the depth chip: bound unread, the scale from the rest');
  // a run before v4.50 (no channel) reads as before
  { const s0 = shaftState(run(), 0, { aspect: A }); assert.equal(s0.state[stateIndex(s0, T[25])], 'seen'); }
});
