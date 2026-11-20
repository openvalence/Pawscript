// paw-otoh: a Detail level is ONE rule over the strokes that qualify. Owner: "detail is pretty much broken, idk, it just
// produces rubbish, instead of applying uniform stroke modification over strokes that qualify".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeFit, shapeAt, dressPoints } from '../src/lib/stroke-shape.js';
import { strokes } from '../src/lib/strokes.js';
import { simplifyScript, setDetail, detailSpans } from '../src/lib/detail.js';
import { runDerives } from '../src/lib/rederive.js';
import { channelPatch } from '../src/lib/runs-channel.js';

const DT = 1000 / 30;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
/** A signal of half-strokes (30 fps): half q lasts ms(q), reaches g(q) of its move at knee(q) of its time (smoothed
 *  knee), up / down alternating between 10 and 90, noise ±noise; and its turns as points [{at, pos}]. */
function signal(n, { ms = () => 500, g = () => 0.5, knee = () => 0.5, noise = 0 } = {}) {
  const t = [], v = [], pts = [];
  let t0 = 0;
  for (let q = 0; q < n; q++) {
    const T = ms(q), lo = q % 2 ? 90 : 10, hi = q % 2 ? 10 : 90, k = knee(q), G = g(q);
    pts.push({ at: Math.round(t0), pos: lo });
    for (; t.length * DT < t0 + T; ) {
      const u = (t.length * DT - t0) / T, y = u < k ? (G * u) / k : G + ((1 - G) * (u - k)) / (1 - k);
      t.push(t.length * DT); v.push(lo + (hi - lo) * y + noise * rnd());
    }
    t0 += T;
  }
  pts.push({ at: Math.round(t0), pos: n % 2 ? 90 : 10 });
  for (; t.length * DT <= t0 + 200; ) { t.push(t.length * DT); v.push(n % 2 ? 90 : 10); }
  return { t: Float64Array.from(t), v: Float64Array.from(v), pts };
}
const L = (shape, sens = 50) => shapeAt({ shape, sens });
/** per half-stroke (turn to turn) of a dressed list: null (plain) or {u, df} of its one midpoint */
function layout(out) {
  const T = out.map((p, i) => [p, i]).filter(([p]) => p.why === 'turn' || p.why === 'end');
  const res = [];
  for (let k = 0; k + 1 < T.length; k++) {
    const [a, ia] = T[k], [b, ib] = T[k + 1], dep = out[ia + 1]?.why === 'hold' ? out[ia + 1] : a, mid = out.slice(ia + 1, ib).filter((p) => p.why === 'mid');
    assert.ok(mid.length <= 1, 'at most one midpoint per half-stroke');
    res.push(mid.length ? { u: (mid[0].at - dep.at) / (b.at - dep.at), df: (mid[0].pos - dep.pos) / (b.pos - dep.pos) } : null);
  }
  return res;
}
const close = (x, y, e = 1e-6) => Math.abs(x - y) <= e;

test('near-identical strokes with noise: every one gets the same midpoint, at the same phase and relative level', () => {
  const s = signal(24, { ms: (q) => 480 + 40 * rnd(), g: () => 0.8, knee: () => 0.35, noise: 3 });
  for (const lv of ['mid', 'hold']) {
    const lay = layout(dressPoints(s.pts, s.t, s.v, L(lv, 50))).slice(1, -1);   // the halves next to the ends are partial
    for (const dir of [0, 1]) {
      const own = lay.filter((_, k) => k % 2 === dir);
      assert.ok(own.every(Boolean), `${lv}: a midpoint on every half-stroke (${own.filter(Boolean).length} of ${own.length})`);
      for (const x of own) assert.ok(close(x.u, own[0].u, 0.005) && close(x.df, own[0].df, 0.005), `${lv}: one layout: ${JSON.stringify(x)} vs ${JSON.stringify(own[0])}`);
    }
    assert.ok(close(lay[0].u, lay[1].u, 0.07) && close(lay[0].df, lay[1].df, 0.07), 'in and out mirrored (the same knee both ways)');
  }
});

test('a mixed run: uniform within each section, the layout changes at the boundary only', () => {
  // 12 slow lopsided strokes, then 12 fast symmetric ones
  const s = signal(24, { ms: (q) => (q < 12 ? 700 : 350) + 20 * rnd(), g: (q) => (q < 12 ? 0.8 : 0.5), knee: (q) => (q < 12 ? 0.3 : 0.5), noise: 2 });
  const lay = layout(dressPoints(s.pts, s.t, s.v, L('mid', 50)));
  assert.ok(lay.slice(1, 12).every(Boolean), `slow section: all ${lay.slice(1, 12).map((x) => (x ? 'M' : '.')).join('')}`);
  assert.ok(lay.slice(12, 23).every((x) => !x), `fast section: none ${lay.slice(12, 23).map((x) => (x ? 'M' : '.')).join('')}`);
});

test('a borderline run: all or none, never half of it (borderline with nothing before = the simpler layout)', () => {
  // evidence ~0.2 at a 0.2 threshold (sensitivity 50): per stroke the noise would flip it
  for (const [g, want] of [[0.69, false], [0.85, true]]) {
    const s = signal(30, { ms: () => 500 + 30 * rnd(), g: () => g, knee: () => 0.5, noise: 4 });
    const lay = layout(dressPoints(s.pts, s.t, s.v, L('mid', 50))).slice(1, -1);
    assert.ok(lay.every((x) => !!x === want), `g ${g}: ${lay.map((x) => (x ? 'M' : '.')).join('')}`);
  }
});

test('an S-shaped move (slow at both ends) never gets one lopsided midpoint, at any sensitivity, wherever on its rest the turn sits', () => {
  // 1 s moves, smootherstep (both ends slow), a 150 ms rest at each turn; the turn marked at the rest's start on every
  // other stroke and at its end on the others (a tracker's turn wanders along a flat top): the farthest sample of each
  // move then jumps from one end to the other stroke by stroke (it made alternating midpoints)
  const t = [], v = [], pts = [], S = (u) => u * u * u * (10 - 15 * u + 6 * u * u);
  for (let q = 0, ms = 0; q < 16; q++) {
    const lo = q % 2 ? 90 : 10, hi = q % 2 ? 10 : 90;
    for (let x = 0; x < 150; x += DT) { t.push(ms + x); v.push(lo + 0.5 * rnd()); }
    pts.push({ at: Math.round(ms + (q % 4 < 2 ? 0 : 150)), pos: lo });
    ms += 150;
    for (let x = 0; x < 1000; x += DT) { t.push(ms + x); v.push(lo + (hi - lo) * S(x / 1000) + 0.5 * rnd()); }
    ms += 1000;
  }
  pts.push({ at: Math.round(t.at(-1)), pos: 10 });
  for (const sens of [50, 80, 100]) {
    const lay = layout(dressPoints(pts, t, v, L('mid', sens))).slice(1, -1), up = lay.filter((_, k) => k % 2 === 0), down = lay.filter((_, k) => k % 2 === 1);
    for (const own of [up, down]) assert.ok(own.every((x) => JSON.stringify(x) === JSON.stringify(own[0])), `sens ${sens}: one layout per direction ${own.map((x) => (x ? x.u.toFixed(2) : '.')).join(' ')}`);
  }
});

test('changing the level never moves the turns; switching back and forth is lossless', () => {
  const s = signal(20, { ms: (q) => 500 + 60 * rnd(), g: () => 0.82, knee: () => 0.35, noise: 2 });
  const turnsOf = (out) => out.filter((p) => p.why === 'turn' || p.why === 'end').map((p) => `${p.at}:${p.pos}`);
  const want = s.pts.map((p) => `${p.at}:${p.pos}`);
  const runs = ['turns', 'mid', 'hold', 'free', 'mid', 'turns', 'hold'].map((lv) => dressPoints(s.pts, s.t, s.v, L(lv, 70)));
  for (const r of runs) assert.deepEqual(turnsOf(r), want, 'the turns, time and depth, as given');
  assert.deepEqual(runs[4], runs[1], 'mid -> ... -> mid: the same points');
  assert.deepEqual(runs[6], runs[2], 'hold again: the same points');
  assert.ok(runs[1].some((p) => p.why === 'mid') && !runs[0].some((p) => p.why !== 'turn' && p.why !== 'end'), 'the levels do differ');
});

test('the app path: a Detail on a shot that is not on the strokes step keeps its points\' turns (it used to re-make them)', () => {
  const s = signal(20, { ms: (q) => 500 + 60 * rnd(), g: () => 0.82, knee: () => 0.35, noise: 2 });
  const P = { at: Float64Array.from(s.pts, (p) => p.at), pos: Float64Array.from(s.pts, (p) => p.pos) };
  const run = { id: 'r', channel: 'primary', channels: {}, params: {}, range: { start: 0, end: s.pts.at(-1).at }, samples: { t: s.t, v: s.v }, points0Primary: P, points0: P };
  const shots = [{ start_ms: 0, end_ms: 20000 }];
  const ghost = (lv) => {
    const list = lv ? setDetail(shots, 0, { shape: lv, sens: 70 }) : shots;
    const p = channelPatch(run, 'primary', {}, [], { derives: runDerives(run, list) });
    const why = p.whys ? [...p.points0.at].map((x) => p.whys.why[p.whys.at.indexOf(x)] || '') : [...p.points0.at].map(() => 'turn');
    return [...p.points0.at].map((x, k) => ({ at: x, pos: p.points0.pos[k], why: why[k] }));
  };
  const turns = (g) => g.filter((p) => p.why === 'turn' || p.why === 'end').map((p) => `${p.at}:${p.pos}`);
  const base = s.pts.map((p) => `${p.at}:${p.pos}`), seq = ['mid', 'hold', 'free', 'hold', 'turns', 'mid'].map(ghost);
  for (const g of seq) assert.deepEqual(turns(g), base, 'the sidecar\'s turns stay');
  assert.deepEqual(seq[5], seq[0], 'lossless');
  assert.ok(seq[0].filter((p) => p.why === 'mid').length >= 12, 'the midpoints are there');
  assert.deepEqual(detailSpans(setDetail(shots, 0, { shape: 'mid', sens: 70 })), [{ t0: 0, t1: 20000, shape: 'mid', sens: 70 }]);
});

test('the accepted script and the live run agree: a ghost written at a level already fits it (Simplify keeps it as is)', () => {
  const s = signal(20, { ms: (q) => 500 + 60 * rnd(), g: () => 0.82, knee: () => 0.35, noise: 2 });
  for (const lv of ['turns', 'mid', 'hold']) {
    const ghost = dressPoints(s.pts, s.t, s.v, L(lv, 70)).map((p) => ({ at: Math.round(p.at), pos: Math.round(p.pos) }));
    assert.equal(simplifyScript(ghost, 0, 1e9, L(lv, 70), { minProm: 20 }), ghost, lv);
  }
  // and the strokes step's own points (a shot on Smart / Strokes)
  const pts = strokes(Array.from(s.t), Array.from(s.v), { shape: 'mid', sens: 70, maxSpeed: 0 }).points.map(({ at, pos }) => ({ at, pos }));
  assert.ok(pts.length > 20);
  assert.equal(simplifyScript(pts, 0, 1e9, L('mid', 70), { minProm: 20 }), pts);
});

test('shapeFit: a midpoint carries its group\'s phase / level, so callers can place it off the sample grid', () => {
  const s = signal(16, { g: () => 0.85, knee: () => 0.3, noise: 1 });
  const idx = s.pts.map((p) => Math.round(p.at / DT)), turn = new Set(idx.slice(1, -1));
  const p = Array.from(s.v), mids = shapeFit(Array.from(s.t), p, idx, turn, L('mid', 50)).filter((q) => q.why === 'mid');
  assert.ok(mids.length >= 10);
  for (const m of mids) assert.ok(Number.isFinite(m.u) && Number.isFinite(m.df) && (m.u === mids[0].u || m.u === mids[1].u), 'one phase per direction');
});

test('dressPoints: a flat pair at a reversal (a hold already in the points) still counts as that turn', () => {
  const s = signal(10, { g: () => 0.5, knee: () => 0.5 });
  const pts = s.pts.flatMap((p, k) => (k === 4 ? [p, { at: p.at + 150, pos: p.pos }] : [p]));
  const out = dressPoints(pts, s.t, s.v, L('turns'));
  assert.deepEqual(out.filter((p) => p.why === 'turn' || p.why === 'end').map((p) => p.at), s.pts.map((p) => p.at));
});

// paw-w7wr: where the video repeats its pictures (a loop), every pass of the loop gets the identical layout
test('a loop: every pass gets the same layout on the same pictures; the levels stay each pass\'s own', async () => {
  const { pictureAt, indexRepeats } = await import('../src/features/timeline/repeats.js');
  // one pass = 4 half-strokes of 15 frames (500 ms): a lopsided up, a plain down, a borderline up, a plain down; 6 passes,
  // each its own depth and its own noise
  const F = 15, PASS = 4 * F, N = 6 * PASS + 1, t = [], v = [], pic = [], pts = [];
  const g = [0.84, 0.5, 0.72, 0.5], knee = [0.35, 0.5, 0.4, 0.5];
  for (let i = 0; i < N; i++) {
    const pass = Math.floor(i / PASS), q = Math.floor((i % PASS) / F), u = (i % F) / F, lo = 10 + 2 * pass, hi = pass % 2 ? 48 : 90;   // the passes' depths differ by half: likeness alone splits them
    const G = q === 2 ? (pass % 2 ? 0.8 : 0.6) : g[q];   // the same pictures, measured differently pass by pass (it alone would come and go)
    const up = q % 2 === 0, y = u < knee[q] ? (G * u) / knee[q] : G + ((1 - G) * (u - knee[q])) / (1 - knee[q]);
    t.push(Math.round(i * DT)); v.push(up ? lo + (hi - lo) * y : hi - (hi - lo) * y); v[i] += 3 * rnd(); pic.push(i % PASS);
    if (i % F === 0) pts.push({ at: t[i], pos: up ? lo : hi });
  }
  pts.push({ at: t[N - 1], pos: 10 + 2 * 6 });
  const lay = (o) => { const out = dressPoints(pts, t, v, L('mid', 50), o), mids = out.filter((p) => p.why === 'mid'); return { out, mids, by: Array.from({ length: 24 }, (_, h) => mids.find((m) => m.at > pts[h].at && m.at < pts[h + 1].at) || null) }; };
  const P = lay({ pic });
  for (let q = 0; q < 4; q++) {
    const each = Array.from({ length: 6 }, (_, k) => P.by[4 * k + q]).slice(1, 5);   // the passes away from the ends
    assert.ok(each.every((m) => !!m === !!each[0]), `half ${q}: all passes or none ${each.map((m) => (m ? 'M' : '.')).join('')}`);
    if (each[0]) assert.ok(each.every((m) => pic[t.indexOf(m.at)] === pic[t.indexOf(each[0].at)]), 'on the same picture in every pass');
    if (each[0]) assert.ok(new Set(each.map((m) => Math.round(m.pos))).size > 1, 'its level follows the pass (not made equal)');
  }
  assert.ok(P.mids.length >= 4, 'the lopsided stroke has its midpoint');
  // the app's lookup: time -> picture
  const ix = indexRepeats({ frames: 100, buckets: [[{ f0: 3, f1: 4, t_ms: 100 }, { f0: 40, f1: 40, t_ms: 1333 }]] }), at = pictureAt(ix, 1000 / 30);
  assert.deepEqual([at(100), at(150), at(1333), at(1345), at(1300), at(200), at(1380)], [0, 0, 0, 0, -1, -1, -1]);
  assert.equal(pictureAt(indexRepeats({ frames: 10, buckets: [] })), null);
});
