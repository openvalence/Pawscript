// shaft.js (paw-azd): a points run's shaft consumption channels -> depth, direction, the Machine hook; strokes.js range
// 'shaft'; the Groups depth flag; derive marks. Synthetic runs: strokes of KNOWN depth (full, half, quarter) whose
// tracked signal is the same size every stroke (a camera-relative signal that cannot tell), so only the shaft can.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shaftNames, shaftOf, shaftDepth, shaftDirection, insertedAt, shaftOverlay, directionText } from '../src/lib/shaft.js';
import { strokes } from '../src/lib/strokes.js';
import { pointsFromChannel } from '../src/lib/runs-channel.js';
import { channelOf } from '../src/lib/runs.js';
import { deriveClean } from '../src/lib/rederive.js';
import { isShaft, canShaft, toggleShaft, trackGroups } from '../src/features/tracking/groups.js';
import { gaugeText } from '../src/features/tracking/shaft-overlay.js';

const FPS = 30, N = 360;   // 12 s, 1 Hz strokes
const T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / FPS));
const DEPTH = (s) => (s < 4 ? 1 : s < 8 ? 0.5 : 0.25);   // how deep each stroke goes (fraction of the shaft)
// inserted fraction: 0 out .. DEPTH at the bottom of each stroke; the signal: the same full-size wave every stroke (larger = out)
const inserted = (ms) => { const s = ms / 1000; return DEPTH(s) * 0.5 * (1 - Math.cos(2 * Math.PI * s)); };
const signal = (ms) => 0.5 * (1 + Math.cos(2 * Math.PI * (ms / 1000)));
const pairs = (f) => T.map((t) => [t, f(t)]);

function run({ source = 'sam', conf = 1, sign = 1, flips = [], points0 = null } = {}) {
  const ch = {
    sem_c1_penis_in: channelOf(pairs(inserted)), sem_c1_penis_in_conf: channelOf(pairs(() => conf)),
    sem_c1_penis_len: channelOf(pairs((t) => 1 - inserted(t))), sem_c1_penis_knot: channelOf(pairs(() => null)),
    sem_c1_penis_bx: channelOf(pairs(() => 0.3)), sem_c1_penis_by: channelOf(pairs(() => 0.5)),
    sem_c1_penis_ex: channelOf(pairs((t) => 0.3 + 0.3 * (1 - inserted(t)))), sem_c1_penis_ey: channelOf(pairs(() => 0.5)),
    sem_c1_penis_w: channelOf(pairs(() => 0.05)), sig: channelOf(pairs(signal)),
  };
  const p0 = points0 || T.filter((_, i) => i % 15 === 0).map((t) => [t, Math.round(100 * (sign > 0 ? signal(t) : 1 - signal(t)))]);
  return { id: 'run1', channels: ch, scenes: [{ start_ms: 0, end_ms: 12000, sign, shaft: { c1_penis: { source, full: 'seen', conf_share: conf } } }], flips,
    points0: { at: Float64Array.from(p0, (p) => p[0]), pos: Float64Array.from(p0, (p) => p[1]) }, range: { start: 0, end: 12000 },
    // as it plays (paw-vtec: the owner's flip is in the composed points)
    points: { at: Float64Array.from(p0, (p) => p[0]), pos: Float64Array.from(p0, (p) => (flips.includes(0) ? 100 - p[1] : p[1])) } };
}

test('the shaft channels: names, the scene\'s group, depth and the Machine hook', () => {
  const r = run();
  assert.deepEqual(shaftNames(r), ['c1_penis']);
  assert.equal(shaftOf(r, 0).name, 'c1_penis');
  assert.equal(shaftOf(run({ source: 'points' }), 0), null, 'the points fallback never drives depth / direction');
  assert.equal(shaftOf(run({ source: 'points' }), 0, { points: true }).name, 'c1_penis', '... but the overlay draws it');
  const d = shaftDepth(r, 0, T);
  assert.equal(d.share, 1);
  assert.ok(Math.abs(d.depth[45] - (1 - inserted(T[45]))) < 1e-6);
  assert.equal(shaftDepth(run({ conf: 0.2 }), 0, T).share, 0, 'unconfident frames say nothing');
  const m = insertedAt(r, 1500);
  assert.ok(Math.abs(m.in - 1) < 1e-6 && m.conf === 1 && m.source === 'sam');
  const o = shaftOverlay(r, 1500);
  assert.ok(Math.abs(o.base[0] - 0.3) < 1e-6 && o.base[1] === 0.5);
  assert.ok(Math.abs(o.entry[0] - 0.3) < 1e-6);
  assert.equal(gaugeText({ ...o, in: 0.62 }), 'in 62 %');
  assert.equal(gaugeText({ ...o, in: 0.62, knot: 1 }), 'in 62 % · knot in');
});

test('the owner\'s marks re-map the depth: fully out reads 0 % in, hilted 100 %', () => {
  const r = run();
  // the deepest frame of the half-depth strokes (5.5 s: visible 0.5) marked hilted, a fully-out frame (5 s: visible 1) out
  const m = insertedAt(r, 5500, { out: 5000, hilt: 5500 });
  assert.ok(Math.abs(m.in - 1) < 1e-6);
  assert.ok(Math.abs(insertedAt(r, 5000, { out: 5000, hilt: 5500 }).in) < 1e-6);
  assert.ok(Math.abs(shaftDepth(r, 0, [5233], { out: 5000, hilt: 5500 }).depth[0] - (0.5 - inserted(5233)) / 0.5) < 1e-6);
});

// paw-kbou (dev/shaft-check, 2 in 9 shard runs: its fake reading is random): "Fully out here" alone on a frame the reading
// has all in (visible length 0, its own hilted end) collapsed the scale; the fallback [0, 1] dropped the mark and the frame
// still read 100 % in
test('fully out here alone on a frame the reading has all in: that frame reads 0 % in', () => {
  const r = run();
  assert.equal(insertedAt(r, 500).in, 1, 'the deepest frame of a full stroke: all in as read');
  assert.ok(Math.abs(insertedAt(r, 500, { out: 500 }).in) < 1e-6, 'marked fully out: 0 % in');
  assert.ok(Math.abs(shaftDepth(r, 0, [500], { out: 500 }).depth[0] - 1) < 1e-6, 'its depth: fully out');
  assert.ok(Math.abs(insertedAt(r, 1000, { hilt: 1000 }).in - 1) < 1e-6, 'hilted alone on a fully-out frame: 100 % in, as before');
});

test('direction: the shaft agrees with the tracked orientation, says the other way when it is mirrored, the flip counts', () => {
  const ok = shaftDirection(run(), 0);
  assert.equal(ok.sign, 1); assert.ok(ok.confident && ok.agrees && ok.r > 0.5);
  assert.match(directionText(ok), /from the shaft \(confident/);
  const wrong = shaftDirection(run({ sign: -1 }), 0);
  assert.equal(wrong.sign, -1); assert.ok(wrong.confident && !wrong.agrees);
  assert.match(directionText(wrong, 'F'), /other way.*F flips/);
  assert.ok(shaftDirection(run({ sign: -1, flips: [0] }), 0).agrees, 'the owner flipped it back: agrees');
  assert.equal(shaftDirection(run({ conf: 0.1 }), 0).confident, false);
  assert.equal(shaftDirection(run({ source: 'points' }), 0), null);
});

test('strokes range shaft: the same-size signal gets each stroke\'s true depth; timing stays the signal\'s', () => {
  const V = T.map(signal), r = run(), d = shaftDepth(r, 0, T);
  const plain = strokes(T, V).points.filter((p) => p.why === 'turn');
  const deep = strokes(T, V, { range: 'shaft', depth: d.depth }).points.filter((p) => p.why === 'turn');
  const bottoms = (pts, a, b) => pts.filter((p) => p.at > a && p.at < b && p.pos < 90).map((p) => p.pos);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  // the plain path: every stroke as deep as the next; the shaft path: full / half / quarter
  assert.ok(Math.abs(mean(bottoms(plain, 500, 3900)) - mean(bottoms(plain, 8500, 11900))) < 5);
  assert.ok(mean(bottoms(deep, 500, 3900)) < 5, 'full strokes reach 0');
  assert.ok(Math.abs(mean(bottoms(deep, 4500, 7900)) - 50) < 6, 'half-depth strokes stop at 50');
  assert.ok(Math.abs(mean(bottoms(deep, 8500, 11900)) - 75) < 6, 'quarter-depth strokes stop at 75');
  assert.equal(deep.length, plain.length);
  deep.forEach((p, k) => assert.ok(Math.abs(p.at - plain[k].at) <= 1000 / FPS, 'same turn times'));
  // under half confident: the scene range as before
  const half = Float64Array.from(d.depth, (x, i) => (i % 3 ? NaN : x));
  assert.deepEqual(strokes(T, V, { range: 'shaft', depth: half }).points, strokes(T, V).points);
});

test('a scene with a confident SAM shaft defaults to shaft depth when strokes are on; a chosen range wins', () => {
  const r = { ...run(), notes: [] };
  const pos = (o) => Array.from(pointsFromChannel(r, 'sig', o).pos);
  const auto = pos({ strokes: {} }), scene = pos({ strokes: { range: 'scene' } });
  assert.notDeepEqual(auto, scene);
  assert.ok(Math.max(...auto.slice(-6)) - Math.min(...auto.slice(-6)) < 40, 'the quarter-depth strokes stay small');
  const pts = pointsFromChannel({ ...run({ source: 'points' }), notes: [] }, 'sig', { strokes: {} });
  assert.deepEqual(Array.from(pts.pos), scene, 'no SAM shaft: unchanged');
});

test('Groups: the depth glyph defaults on for a penis in a penetration scene with a where; toggles; Track sends it', () => {
  const pen = { name: 'c1_penis', who: 'c1', part: 'penis', poly: [[0, 0], [0.1, 0], [0.1, 0.1]], t_ms: 100 };
  const sex = { start_ms: 0, end_ms: 1000, tags: ['anal', 'penetration'] }, bare = { start_ms: 0, end_ms: 1000, tags: ['penetration'] };
  assert.ok(canShaft(pen) && !canShaft({ ...pen, name: 'c2_hips', part: 'hips' }));
  assert.ok(isShaft(pen, sex));
  assert.ok(!isShaft(pen, bare), 'no where: off');
  assert.ok(!isShaft({ ...pen, name: 'c2_hips', part: 'hips' }, sex));
  const off = toggleShaft(pen, sex);
  assert.equal(off.shaft, false); assert.ok(!isShaft(off, sex));
  assert.ok(!('shaft' in toggleShaft(off, sex)), 'back to the default: no key');
  assert.equal(toggleShaft(pen, bare).shaft, true);
  const req = trackGroups([{ ...sex, groups: [pen, { ...pen, name: 'c2_hips', who: 'c2', part: 'hips' }] }], 0, 1000);
  assert.equal(req[0].shaft, true); assert.ok(!('shaft' in req[1]));
  assert.ok(!('shaft' in trackGroups([{ ...sex, groups: [off] }], 0, 1000)[0]));
});

test('derive: the shaft marks and range shaft survive a file round trip; junk is dropped', () => {
  assert.deepEqual(deriveClean({ shaft: { out: 1200.4, hilt: 'x' }, strokes: { range: 'shaft' } }), { strokes: { range: 'shaft' }, shaft: { out: 1200 } });
  assert.equal(deriveClean({ shaft: { out: -5 } }), null);
});

test('paw-wzxu: two penises measured: the one pointing into the other character, its length moving with the stroke, wins over a more confident one pointing away; no receiver to tell = as before', () => {
  const r = run();   // c1_penis of run() becomes the Top's: c2_penis (base 0.3, entry 0.3..0.6 towards the Bottom's anus at 0.65)
  const ch = {};
  for (const [k, v] of Object.entries(r.channels)) ch[k.replace('sem_c1_penis_', 'sem_c2_penis_')] = v;
  ch.sem_c2_penis_in_conf = channelOf(pairs((t) => (t < 8400 ? 0.9 : 0.2)));   // confident on 70 % of the scene
  Object.assign(ch, {
    // the Bottom's own penis: more confident, a constant length, its tip (0.8, 0.7) further from the Top's hips (0.25, 0.5) than its base (0.7, 0.6)
    sem_c1_penis_in: channelOf(pairs(() => 0)), sem_c1_penis_in_conf: channelOf(pairs(() => 1)), sem_c1_penis_len: channelOf(pairs(() => 1)),
    sem_c1_penis_bx: channelOf(pairs(() => 0.7)), sem_c1_penis_by: channelOf(pairs(() => 0.6)), sem_c1_penis_ex: channelOf(pairs(() => 0.8)), sem_c1_penis_ey: channelOf(pairs(() => 0.7)),
    sem_c1_anus_x: channelOf(pairs(() => 0.65)), sem_c1_anus_y: channelOf(pairs(() => 0.5)), sem_c2_hips_x: channelOf(pairs(() => 0.25)), sem_c2_hips_y: channelOf(pairs(() => 0.5)),
  });
  const shaft = { c1_penis: { source: 'sam', full: 'seen' }, c2_penis: { source: 'sam', full: 'seen' } };
  const two = { ...r, channels: ch, scenes: [{ ...r.scenes[0], shaft }] };
  assert.equal(shaftOf(two, 0).name, 'c2_penis', 'the one actually going in');
  assert.ok(shaftDepth(two, 0, T).name === 'c2_penis');
  const noRecv = { ...two, channels: Object.fromEntries(Object.entries(ch).filter(([k]) => !/anus|hips/.test(k))) };
  assert.equal(shaftOf(noRecv, 0).name, 'c1_penis', 'nothing to point at: the most confident, as before');
  const alone = { ...two, channels: Object.fromEntries(Object.entries(ch).filter(([k]) => !/c2_penis/.test(k))), scenes: [{ ...r.scenes[0], shaft: { c1_penis: shaft.c1_penis } }] };
  assert.equal(shaftOf(alone, 0).name, 'c1_penis', 'a single measured penis stays the shaft (the sidecar measured it)');
});
