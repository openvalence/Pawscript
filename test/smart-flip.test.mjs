// paw-s80k: the owner's "smartstroke is sometimes inverted to the rest of the stroke, if I flip the stroke the motion is
// correct and the points are good but the other way its rubbish". (A) Turning Smart stroke on (or picking another source)
// never changes which way up the shot is: the new signal plays like the scene's own channel did, matched by correlation;
// uncorrelated: left as it comes, and said. (B) A flip (F, or a stretch over the scene) gives the exact mirror of the
// points (pos -> 100 - pos, the same times and kinds) for every DEPTH and Detail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelPatch } from '../src/lib/runs-channel.js';
import { channelOf } from '../src/lib/runs.js';
import { deriveClean } from '../src/lib/rederive.js';
import { matchText } from '../src/lib/polarity.js';
import { roundPos } from '../src/lib/strokes.js';
import { track, howRun, ASPECT } from './how-synth.mjs';
import { CASES, DEPTH_CASES } from './fusion-synth.mjs';
import { HOW_CASES, caseRun, DETAILS, RANGES, smartPoints, mirrorDiff } from './mirror-synth.mjs';

const many = (n, s) => Array.from({ length: n }, () => ({ ...s }));
const TR = track([...many(8, { kind: 'impact', T: 800, rest: 0.45 }), ...many(8, { kind: 'slowout', T: 700 })]);
const noise = (seed) => { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5; };
/** The run: parts that fuse (fused reads + = out, oriented by who_pair), and a channel 'inv' the shot plays: the same
 *  motion read the other way up (a relative channel, a camera-removed centroid: their own sign rule), or noise. */
function run(home = 'inv', o = {}) {
  const r = howRun(TR, { seed: 3 }), q = noise(9);
  r.channels.inv = channelOf(TR.t.map((ms, i) => [ms, 1 - TR.d[i] + 0.01 * q()]));
  r.channels.junk = channelOf(TR.t.map((ms, i) => [ms, Math.sin(i / 7.3) * Math.cos(i / 17.1) + 0.3 * q()]));
  return { ...r, channel: home, scenes: [{ start_ms: 0, end_ms: r.range.end, sign: 1 }], points0: { at: new Float64Array(), pos: new Float64Array() }, ...o };
}
const DETAIL = [{ t0: 0, t1: 1e9, shape: 'hold', sens: 50 }];
const comp = (r, d = {}, ctx = {}) => channelPatch(r, r.channel, {}, [], { aspect: ASPECT, derives: [{ detail: DETAIL, ...d }], ...ctx });
const grid = (p) => { const out = []; let j = 0; for (let x = 1000; x < TR.t[TR.N - 1] - 1000; x += 20) { while (j + 1 < p.at.length && p.at[j + 1] <= x) j++; const a = p.at[j], b = p.at[j + 1]; out.push(b > a ? p.pos[j] + ((p.pos[j + 1] - p.pos[j]) * (x - a)) / (b - a) : p.pos[j]); } return out; };
const corr = (a, b) => { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };
const r = (p, q) => corr(grid(p.points0), grid(q.points0));
const pts = (p) => Array.from(p.points0.at, (at, k) => [at, p.points0.pos[k]]);

test('A: Smart stroke on a shot that played another channel comes out the same way up (it came out upside down)', () => {
  const R = run(), off = comp(R), old = comp(R, { smart: true }), now = comp(R, { smart: true, match: true });
  assert.ok(r(old, off) < -0.8, `before: upside down against the shot (r ${r(old, off).toFixed(2)})`);
  assert.ok(r(now, off) > 0.8, `now: the same way up (r ${r(now, off).toFixed(2)})`);
  assert.equal(now.match[0].ref, 'inv'); assert.ok(now.match[0].flip && !now.match[0].weak && now.match[0].r < -0.8);
  assert.match(matchText(now.match[0]), /plays the same way up as inv \(r 0\.\d+, turned over to match\)/);
  // its trace on the lane is the signal as it plays: the same way up as the shot's channel was
  const lt = now.lane, lo = off.lane;
  assert.ok(corr(Array.from(lt.v).filter((x) => x === x), Array.from(lo.v).filter((x) => x === x)) > 0.8);
  // a shot that already played fused: nothing to match, nothing changes
  const F = run('fused');
  assert.deepEqual(pts(comp(F, { smart: true, match: true })), pts(comp(F, { smart: true })));
  assert.equal(comp(F, { smart: true, match: true }).match, null);
});

test('A: the owner\'s flips still flip what he sees, before and after the switch; off and on again: unchanged', () => {
  const R = run(), Rf = run('inv', { flips: [0] });
  const off = comp(Rf), on = comp(Rf, { smart: true, match: true }), on0 = comp(R, { smart: true, match: true });
  assert.ok(r(on, off) > 0.8, 'flipped on its channel, then Smart stroke on: still flipped');
  assert.deepEqual(pts(on), pts(on0).map(([a, p]) => [a, 100 - p]), 'F on Smart stroke: the exact mirror');
  assert.deepEqual(pts(comp(R, deriveClean({ match: true }) || {})), pts(comp(R)), 'Smart stroke off again: as before');
  assert.deepEqual(pts(comp(R, { smart: true, match: true })), pts(on0), 'and on again: the same');
  // a stretch over the whole scene is the same flip
  assert.deepEqual(pts(comp(R, { smart: true, match: true }, { flips: [[0, R.range.end]] })), pts(on));
});

test('A: the source chip keeps the way up too; a sidecar shot keeps its samples\' way up', () => {
  const R = run(), off = comp(R);
  assert.ok(r(comp(R, { source: 'who_pair_proj' }), off) < -0.8, 'before: the pair read + = out against the shot\'s channel');
  const now = comp(R, { source: 'who_pair_proj', match: true });
  assert.ok(r(now, off) > 0.8); assert.ok(now.match[0].flip);
  // the sidecar's points (its samples: signed, here the other way up) and Smart stroke
  const S = run('primary'), side = { at: Float64Array.from(TR.t.filter((_, i) => i % 6 === 0)), pos: Float64Array.from(TR.t.filter((_, i) => i % 6 === 0), (ms) => 0) };
  const samples = { t: Float64Array.from(TR.t), v: Float32Array.from(TR.d, (d) => 1 - d) };
  const P = { ...S, samples, points0: side, points0Primary: side };
  const sOff = comp(P, { strokes: {} }), sNow = comp(P, { smart: true, match: true });
  assert.ok(r(sNow, sOff) > 0.8, `the sidecar's way up kept (r ${r(sNow, sOff).toFixed(2)})`);
  assert.equal(sNow.match[0].ref, 'primary');
  assert.match(matchText(sNow.match[0]), /the tracker's own signal/);
});

test('A: a channel that does not move with the new signal: no guess (its own orientation), and the strip says so', () => {
  const R = run('junk'), old = comp(R, { smart: true }), now = comp(R, { smart: true, match: true });
  assert.deepEqual(pts(now), pts(old));
  assert.ok(now.match[0].weak && !now.match[0].flip, `r ${now.match[0].r}`);
  assert.match(matchText(now.match[0], 'F'), /do not move together \(r -?0\.\d+\), so it is left as it comes: F if it is upside down/);
  assert.equal(matchText(null), '');
});

test('A: a derive written before this change keeps its own orientation (a flip made against it keeps what it showed)', () => {
  const R = run('inv', { flips: [0] });
  assert.deepEqual(pts(comp(R, { smart: true })), pts(comp(run(), { smart: true })).map(([a, p]) => [a, 100 - p]));
  assert.equal(comp(R, { smart: true }).match, null);
  assert.deepEqual(deriveClean({ smart: true, match: true }), { smart: true, match: true });
  assert.deepEqual(deriveClean({ source: 'g1_proj', match: true }), { source: 'g1_proj', match: true });
  assert.equal(deriveClean({ match: true }), null, 'alone it is nothing to keep');
  assert.deepEqual(deriveClean({ fuse: { exclude: ['a'] }, match: true }), { fuse: { exclude: ['a'] } });
});

test('B: pos rounding is mirror-symmetric', () => {
  for (const p of [0, 0.5, 12.5, 37.5, 49.5, 50, 50.5, 62.5, 99.5, 100, 33.2, 66.8]) assert.equal(roundPos(100 - p), 100 - roundPos(p), `${p}`);
});

// ---- B: the mirror property. Every synthetic case x DEPTH (auto, scene, follow, local, shaft: one that follows the stroke,
//      one that does not) x Detail (render, hold, mid, turns); on render also the depth seat (pick / pair), held retime and
//      a stretch over the whole scene instead of F. Tolerance: none (the same times and kinds, depths exactly 100 - pos) ----
const SYN = [...Object.entries(HOW_CASES).map(([id, how]) => [id, { how }]), ...CASES.slice(0, 2).map((c) => [c.id, { fus: c.make }]), [DEPTH_CASES[0].id, { fus: DEPTH_CASES[0].make }]];
for (const [id, make] of SYN) test(`B: a flip is the exact mirror: ${id}, every DEPTH and Detail`, () => {
  const bad = [];
  for (const range of RANGES) for (const shaft of range === 'shaft' || range === undefined ? ['follow', 'noise'] : [null]) {
    const R = caseRun(make, { shaft });
    for (const shape of DETAILS) {
      const vs = shape === 'render' ? [{}, { depth: 'pick' }, { depth: 'pair' }, { held: true }, { flip: 'stretch' }] : [{}];
      for (const v of vs) {
        const o = { shape, range, ...v, flip: false }, a = smartPoints(R, o), b = smartPoints(R, { ...o, flip: v.flip || true }), d = mirrorDiff(b.pts, a.pts);
        if (d.t || d.d || d.kind || d.dMax > 0) bad.push(`${range ?? 'auto'}${shaft ? `(${shaft})` : ''} ${shape} ${JSON.stringify(v)}: time ${d.t}, depth ${d.d} (max ${d.dMax}), kind ${d.kind} of ${d.n}`);
        assert.ok(a.pts.length >= 10, 'points');
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('B: a shaft that follows the stroke sets the depth in both directions (it used to be used one way only)', () => {
  const R = caseRun({ how: HOW_CASES['cusp bottom slow'] }, { shaft: 'follow' });
  const a = smartPoints(R, { shape: 'render' }), b = smartPoints(R, { shape: 'render', flip: true });
  assert.equal(a.depthUsed[0].used, 'shaft'); assert.equal(b.depthUsed[0].used, 'shaft');
  assert.ok(a.depthUsed[0].r > 0.9 && b.depthUsed[0].r < -0.9);
  const lows = a.pts.filter((q) => q.why === 'turn' && q.pos < 50).map((q) => q.pos);
  // paw-4c48: the shaft's smallest recurring visible share (30 %) is its "hilted": the deep turns at 0
  assert.ok(lows.length >= 6 && lows.every((p) => p <= 3), `the deep turns at the shaft's hilted: ${lows}`);
});
