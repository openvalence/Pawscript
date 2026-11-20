// paw-vtec: a run's direction is applied to its SIGNAL (polarity.js directionOf, runs-channel.js channelPatch), never to
// its finished points. A run tracked upside down and flipped (F / a strip click / flipRun = run.flips, Assist's span
// orientation, a stretch over the whole scene) composes exactly like the same run tracked the right way up: holds, mids,
// extremes, fusion's HOW, stroke types, a shaft's depth, loop-averaged passes, the Autorange plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelPatch } from '../src/lib/runs-channel.js';
import { channelOf } from '../src/lib/runs.js';
import { strokes } from '../src/lib/strokes.js';
import { directionOf, loopFlips, signAt } from '../src/lib/polarity.js';
import { rangePlan } from '../src/lib/autorange.js';
import { indexRepeats } from '../src/features/timeline/repeats.js';
import { track, howRun, ASPECT } from './how-synth.mjs';

const many = (n, s) => Array.from({ length: n }, () => ({ ...s }));
const pts = (p) => Array.from(p.points0.at, (at, k) => `${at}:${p.points0.pos[k]}`);
const whys = (p) => (p.whys ? p.whys.at.map((a, k) => `${a}:${p.whys.why[k]}`) : []);

// ---- asymmetric strokes with a secondary part: impacts (fast in, a dead stop, a rest at the deep turn, the balls ringing
//      after it), slow-out strokes (a midpoint on the out-move), shoulders (a rest at the deep turn only) ----
const TR = track([...many(8, { kind: 'impact', T: 800, rest: 0.45 }), ...many(8, { kind: 'slowout', T: 700 }), ...many(6, { kind: 'shoulder', T: 900, rest: 0.4 })]);
/** the run tracked the right way up, or upside down (fusion orients by who_pair: inverted, every stroke reads mirrored) */
function fusedRun(inv, o = {}) {
  const run = howRun(TR, { seed: 3 });
  if (inv) run.channels.who_pair_proj = channelOf(TR.t.map((ms, i) => [ms, 1 - TR.d[i]]));
  return { ...run, scenes: [{ start_ms: 0, end_ms: run.range.end, sign: 1 }], channel: 'primary', points0: { at: new Float64Array(), pos: new Float64Array() }, ...o };
}
const SMART = [{ smart: true, detail: [{ t0: 0, t1: 1e9, shape: 'hold', sens: 50 }] }];
const smart = (run, ctx = {}) => channelPatch(run, 'primary', {}, [], { aspect: ASPECT, derives: SMART, ...ctx });

test('Smart stroke + Detail: upside down + a whole-scene flip = the right way up (points, holds, mids); a stretch over the scene and Assist\'s span are the same flip', () => {
  const good = smart(fusedRun(false)), flipped = smart(fusedRun(true, { flips: [0] }));
  assert.deepEqual(pts(flipped), pts(good));
  assert.deepEqual(whys(flipped), whys(good));
  // the holds are at the deep end (pos 0 side) in both, the impacts' and shoulders' rests
  const at = new Map(Array.from(good.points0.at, (a, k) => [a, good.points0.pos[k]]));
  const holds = good.whys.at.filter((a, k) => good.whys.why[k] === 'hold');
  assert.ok(holds.length >= 10 && holds.every((a) => at.get(a) < 50), `holds at ${holds.map((a) => at.get(a))}`);
  assert.ok(good.whys.why.filter((w) => w === 'mid').length >= 10, 'midpoints on the lopsided moves');
  // a stretch covering the whole run scene IS the scene flip; Assist's orientation over it too
  const end = fusedRun(true).range.end;
  assert.deepEqual(pts(smart(fusedRun(true), { flips: [[0, end]] })), pts(good));
  assert.deepEqual(pts(smart(fusedRun(true, { orient: [{ t0: 0, t1: end, sign: -1 }] }))), pts(good));
  // flipped twice (the scene flip and the stretch): as tracked
  assert.deepEqual(pts(smart(fusedRun(true, { flips: [0] }), { flips: [[0, end]] })), pts(smart(fusedRun(true))));
});

test('fusion\'s HOW: the same turns, dwell, impact, ring, shapes and stroke types; "deep" is the same turn after the flip', () => {
  const good = smart(fusedRun(false)), r1 = fusedRun(true, { flips: [0] }), flipped = smart(r1);
  const a = good.channels.fused.how, b = flipped.channels.fused.how;
  assert.equal(a.turns.length, b.turns.length);
  const run1 = { ...r1, dir: flipped.dir }, run0 = { ...fusedRun(false), dir: good.dir };
  a.turns.forEach((x, k) => {
    const y = b.turns[k];
    assert.equal(y.t, x.t);
    for (const f of ['dwell', 'fs', 'fe', 'hit', 'ring', 'impact', 'strength', 'conf']) assert.ok(Math.abs(y[f] - x[f]) < 1e-9, `turn ${k} ${f}: ${y[f]} vs ${x[f]}`);
    assert.equal(y.kind * signAt(run1, y.t), x.kind * signAt(run0, x.t), `turn ${k}: deep / out the same`);
  });
  a.halves.forEach((x, k) => {
    const y = b.halves[k];
    assert.equal(y.type, x.type); assert.equal(y.dir, -x.dir);
    x.prof.forEach((q, j) => assert.ok(Math.abs(y.prof[j] - q) < 1e-9));
  });
  // the impacts ring at the deep turns
  const deep = a.turns.filter((x) => x.kind * signAt(run0, x.t) < 0 && x.impact >= 0.5);
  assert.ok(deep.length >= 6, `impacts at deep turns: ${deep.length}`);
});

test('Autorange reads the same plan from both', () => {
  const sc = [{ start_ms: 0, end_ms: TR.t[TR.N - 1] + 1, tags: [{ cat: 'act', id: 'anal' }] }];
  const s = (p) => Array.from(p.points0.at, (at, k) => ({ at, pos: p.points0.pos[k] }));
  assert.deepEqual(rangePlan(sc, s(smart(fusedRun(true, { flips: [0] })))), rangePlan(sc, s(smart(fusedRun(false)))));
});

// ---- the classic fit and the Detail on turns made elsewhere (the classic fit's, the sidecar's) ----
const FPS = 30, GRID = (ms) => Array.from({ length: Math.round((ms * FPS) / 1000) }, (_, i) => Math.round((i * 1000) / FPS));
/** a stroke with a long rest at the deep turn and a fast in / slow out: larger = out */
const shape = (ms) => { const u = (ms % 1000) / 1000; return u < 0.35 ? 0 : u < 0.8 ? ((u - 0.35) / 0.45) ** 0.5 : 1 - ((u - 0.8) / 0.2) ** 2; };
test('the classic fit with a Detail, and the sidecar\'s points with a Detail: flipped = the right way up', () => {
  const T = GRID(10000), D = [{ detail: [{ t0: 0, t1: 1e9, shape: 'hold', sens: 50 }] }];
  const run = (inv, o = {}) => ({ id: 'r', params: {}, notes: [], range: { start: 0, end: 10000 }, scenes: [{ start_ms: 0, end_ms: 10000, sign: 1 }], channel: 'sig',
    channels: { sig: channelOf(T.map((t) => [t, inv ? 1 - shape(t) : shape(t)])) }, points0: { at: new Float64Array(), pos: new Float64Array() }, ...o });
  const c = (r) => channelPatch(r, 'sig', {}, [], { derives: D });
  assert.deepEqual(pts(c(run(true, { flips: [0] }))), pts(c(run(false))));
  assert.deepEqual(whys(c(run(true, { flips: [0] }))), whys(c(run(false))));
  assert.ok(whys(c(run(false))).some((w) => w.endsWith(':hold')), 'the Detail added holds');
  // the sidecar's own points (the classic fit's turns of the signal as its points, the samples its signal)
  const sidecar = (inv, o) => { const r = run(inv, o), p = channelPatch(run(inv), 'sig', {}, []).points0; return { ...r, channel: 'primary', channels: {}, points0: p, points0Primary: p, samples: { t: Float64Array.from(T), v: Float32Array.from(T, (t) => (inv ? 1 - shape(t) : shape(t))) } }; };
  const sp = (r) => channelPatch(r, 'primary', {}, [], { derives: D });
  assert.deepEqual(pts(sp(sidecar(true, { flips: [0] }))), pts(sp(sidecar(false))));
  assert.deepEqual(whys(sp(sidecar(true, { flips: [0] }))), whys(sp(sidecar(false))));
  // the lane trace is the signal as it plays: the flipped scene's trace is the right-way-up one
  const la = c(run(true, { flips: [0] })).lane, lb = c(run(false)).lane;
  la.v.forEach((y, j) => assert.ok(y !== y ? lb.v[j] !== lb.v[j] : Math.abs(y - lb.v[j]) < 1e-6));
});

// ---- the shaft's depth (paw-azd: strokes range 'shaft', a confident SAM shaft): absolute, so a mirror after cannot keep it ----
test('a shaft scene: the turns take the shaft\'s depth on the right end after a flip', () => {
  const N = 360, T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / FPS)), P = (f) => T.map((t) => [t, f(t)]);
  const DEPTH = (s) => (s < 4 ? 1 : s < 8 ? 0.5 : 0.25), ins = (ms) => { const s = ms / 1000; return DEPTH(s) * 0.5 * (1 - Math.cos(2 * Math.PI * s)); };
  const sig = (ms) => 0.5 * (1 + Math.cos(2 * Math.PI * (ms / 1000))) + 0.004 * Math.sin(ms * 12.9898);   // (a little noise: no exact ties)
  const run = (inv, o = {}) => ({ id: 'run1', params: {}, notes: [], range: { start: 0, end: 12000 }, channel: 'sig', points0: { at: new Float64Array(), pos: new Float64Array() },
    scenes: [{ start_ms: 0, end_ms: 12000, sign: 1, shaft: { c1_penis: { source: 'sam', full: 'seen', conf_share: 1 } } }],
    channels: { sem_c1_penis_in: channelOf(P(ins)), sem_c1_penis_in_conf: channelOf(P(() => 1)), sem_c1_penis_len: channelOf(P((t) => 1 - ins(t))), sig: channelOf(P((t) => (inv ? 1 - sig(t) : sig(t)))) }, ...o });
  const c = (r) => channelPatch(r, 'sig', {}, [], { derives: [{ strokes: {} }] });
  const good = c(run(false)), flipped = c(run(true, { flips: [0] }));
  assert.deepEqual(pts(flipped), pts(good));
  // the deep turns at 1 - DEPTH (full, half, quarter), the out turns fully out
  const bottoms = Array.from(good.points0.pos).filter((_, k) => good.whys.why[k] === 'turn' && good.points0.pos[k] < 90);
  assert.ok(bottoms.some((p) => p <= 5) && bottoms.some((p) => Math.abs(p - 50) <= 6) && bottoms.some((p) => Math.abs(p - 75) <= 6), `${bottoms}`);
});

// ---- the sidecar's own sign is applied once: its samples carry it already ----
test('a scene the sidecar signed -1: the strokes step on its samples plays like its points (the sign is not applied twice)', () => {
  const T = GRID(8000), s = (t) => 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / 800);
  const side = T.filter((_, i) => i % 3 === 0).map((t) => [t, Math.round(100 * s(t))]);   // the sidecar's points and samples: signed already
  const r = { id: 'r', params: {}, notes: [], range: { start: 0, end: 8000 }, scenes: [{ start_ms: 0, end_ms: 8000, sign: -1 }], channel: 'primary', channels: {},
    points0: { at: Float64Array.from(side, (x) => x[0]), pos: Float64Array.from(side, (x) => x[1]) }, samples: { t: Float64Array.from(T), v: Float32Array.from(T, s) } };
  const p = channelPatch(r, 'primary', {}, [], { derives: [{ strokes: {} }] }).points0;
  const top = Array.from(p.at).filter((_, k) => p.pos[k] > 80);
  assert.ok(top.length >= 8 && top.every((a) => s(a) > 0.8), 'its tops are the samples\' tops');
});

test('the strokes step\'s timing series is the same extremum under either scene sign', () => {
  const t = GRID(10000), v = t.map((ms) => Math.sin((2 * Math.PI * ms) / 700)), late = t.map((ms) => Math.sin((2 * Math.PI * (ms - 40)) / 700));
  const at = (o) => strokes(t, v, { timing: late, ...o }).points.filter((p) => p.why === 'turn').map((p) => p.at);
  assert.deepEqual(at({ sign: -1 }), at({ sign: 1 }));
  assert.notDeepEqual(at({ sign: 1 }), strokes(t, v, {}).points.filter((p) => p.why === 'turn').map((p) => p.at), 'the series moved them');
});

// ---- loop averaging (paw-403x): a flip applies to every pass of an averaged loop ----
const fm = 1000 / 30, F = 20, P0 = 30, NP = 5, TT = (f) => f * fm;
const occ = Array.from({ length: F }, () => []);
for (let k = 0; k < NP; k++) for (let p = 0; p < F; p++) { const f = P0 + k * F + p; occ[p].push({ f0: f, f1: f, t_ms: TT(f) }); }
const ix = indexRepeats({ frames: 400, buckets: occ });
const loop = { id: 'lp1', t0: Math.round(TT(P0)), t1: Math.round(TT(P0 + F)), avg: true, auto: { key: 'k', t0: Math.round(TT(P0)), t1: Math.round(TT(P0 + F)), end: Math.round(TT(P0 + NP * F)), n: NP } };
const LA = { loops: [loop], ix, fm };
/** each pass: one stroke with a rest at its deep turn (larger = out), a little per-pass noise; outside the loop, steady strokes */
const lval = (f, inv) => { const k = Math.floor((f - P0) / F), p = f - P0 - k * F, x = k >= 0 && k < NP ? shape((p / F) * 1000) + 0.02 * Math.sin(k * 12.9898 + p * 78.233) : shape((f * fm * 1.5) % 1000); return inv ? 1 - x : x; };
const lrun = (inv, o = {}) => ({ id: 'r', params: {}, notes: [], range: { start: 0, end: TT(400) }, scenes: [{ start_ms: 0, end_ms: TT(400), sign: 1 }], channel: 'sig',
  channels: { sig: channelOf(Array.from({ length: 400 }, (_, f) => [TT(f), lval(f, inv)])) }, points0: { at: new Float64Array(), pos: new Float64Array() }, samples: { t: [], v: [] }, ...o });
test('loop averaging: the averaged passes flipped like the rest of the scene', () => {
  const c = (r, ctx = {}) => channelPatch(r, 'sig', {}, [], { loopAvg: LA, derives: [{ strokes: {}, detail: [{ t0: 0, t1: 1e9, shape: 'hold', sens: 50 }] }], ...ctx });
  assert.deepEqual(pts(c(lrun(true, { flips: [0] }))), pts(c(lrun(false))));
  assert.deepEqual(whys(c(lrun(true, { flips: [0] }))), whys(c(lrun(false))));
});
test('loop averaging: a stretch in one averaged pass flips the same phase in every pass (their one signal)', () => {
  const a = Math.round(TT(P0 + 2 * F + 5)), b = Math.round(TT(P0 + 2 * F + 12));   // inside pass 3
  const c = (ctx) => channelPatch(lrun(false), 'sig', {}, [], { loopAvg: LA, ...ctx });
  const one = c({ flips: [[a, b]] });
  // the same pictures in every pass (by the phase maps: within a ms of each pass's frames 5..12)
  assert.equal(one.dir.partial.length, NP);
  one.dir.partial.forEach(([u, v], k) => assert.ok(Math.abs(u - TT(P0 + k * F + 5)) < 1.5 && Math.abs(v - TT(P0 + k * F + 12)) < 1.5, `pass ${k + 1}: ${u}..${v}`));
  assert.deepEqual(one.flipSpans, [[a, b]], 'the owner\'s stretch is what the strip shows');
  assert.equal(one.dir.partial.length, NP);
  // every pass's points inside the loop are the same, pass after pass
  const inPass = (p, k) => Array.from(p.points0.at).map((x, j) => [x, p.points0.pos[j]]).filter(([x]) => x >= TT(P0 + k * F) + 50 && x < TT(P0 + (k + 1) * F) - 50).map(([x, y]) => [x - k * TT(F), y]);
  const p0 = inPass(one, 0);
  for (let k = 1; k < NP; k++) { const q = inPass(one, k); assert.equal(q.length, p0.length, `pass ${k + 1}`); q.forEach(([x, y], j) => assert.ok(Math.abs(x - p0[j][0]) <= 1.5 && y === p0[j][1], `pass ${k + 1} point ${j}: ${x}:${y} vs ${p0[j]}`)); }
  // not averaged: only where it was drawn
  const raw = channelPatch(lrun(false), 'sig', {}, [], { loopAvg: { ...LA, loops: [{ ...loop, avg: false }] }, flips: [[a, b]] });
  assert.equal(raw.dir.partial.length, 1);
  assert.deepEqual(loopFlips([[a, b]], []), [[a, b]]);
});

test('directionOf: one map from scene flips, Assist\'s spans and stretches', () => {
  const sc = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 2000 }], r = (o) => ({ scenes: sc, range: { start: 0, end: 2000 }, flips: [], orient: [], ...o });
  const d = (o, st) => { const x = directionOf(r(o), st); return [[...x.whole], x.partial]; };
  assert.deepEqual(d({}, []), [[], []]);
  assert.deepEqual(d({ flips: [1] }), [[1], []]);
  assert.deepEqual(d({}, [[1000, 2000]]), [[1], []], 'a stretch over a whole scene = its flip');
  assert.deepEqual(d({ flips: [1] }, [[1000, 2000]]), [[], []], 'both: as tracked');
  assert.deepEqual(d({ flips: [1] }, [[1200, 1500]]), [[1], [[1200, 1500]]], 'a flipped scene with a stretch: the stretch un-flips against it');
  assert.deepEqual(d({}, [[200, 500]]), [[], [[200, 500]]]);
  assert.deepEqual(d({ flips: [0], orient: [{ t0: 500, t1: 1500, sign: 1 }] }), [[0], [[500, 1000]]], 'an override over a flip, across the cut');
  assert.deepEqual(d({ orient: [{ t0: 500, t1: 1500, sign: -1 }] }), [[], [[500, 1000], [1000, 1500]]]);
  assert.deepEqual(d({ flips: [0, 'x', 7] }, [['bad'], [3000, 4000]]), [[0], []], 'junk never crashes');
  assert.equal(signAt({ scenes: [{ start_ms: 0, end_ms: 1000, sign: -1 }], dir: { whole: [0], partial: [[200, 300]] } }, 250), -1);
});
