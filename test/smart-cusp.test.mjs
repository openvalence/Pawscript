// paw-6t7d: Smart stroke on a clean lopsided trace (the owner's 'anal penetration' shot: ~2.15 strokes / s, full range, a
// sharp deep turn and a round top) gave a bare triangle wave: Detail by render fitted its points blind to the speed cap and
// then left out every one that broke it (0 of 42). Also: shaft depth from a shaft that does not follow the signal, the shaft
// anchored after the clip, the direction sentence that said "unsure ... 100 % confident".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strokes, STROKES } from '../src/lib/strokes.js';
import { fitLeg, renderScript } from '../src/lib/stroke-shape.js';
import { depthR, directionText, shaftDepth } from '../src/lib/shaft.js';
import { pointsFromChannel } from '../src/lib/runs-channel.js';
import { channelOf } from '../src/lib/runs.js';

const FPS = 24, P = 465;   // the owner's shot: 24 fps, 465 ms strokes
/** A cusp / basin trace: larger = out (pos 100). cusp 'bottom': full speed into and out of the deep turn, a round top. */
function cuspTrace({ cusp = 'bottom', n = 14, period = P, noise = 0.004, seed = 7 } = {}) {
  let s = seed;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
  const t = [], v = [], lead = 300, end = lead + n * period;
  for (let ms = 0; ms <= end + lead; ms += 1000 / FPS) {
    const x = Math.min(Math.max(ms - lead, 0), n * period), u = (x % period) / period, h = u < 0.5 ? 2 * u : 2 - 2 * u;   // h: 0 at the deep turn, 1 at the top
    const y = cusp === 'bottom' ? 1 - (1 - h) ** 2 : h * h;
    t.push(Math.round(ms)); v.push(y + noise * r());
  }
  return { t, v };
}
const rmsAgainst = (pts, tr, t0, t1) => {
  const ts = [], ys = [];
  for (let i = 0; i < tr.t.length; i++) if (tr.t[i] >= t0 && tr.t[i] <= t1) { ts.push(tr.t[i]); ys.push(tr.pos[i]); }
  const R = renderScript(pts, ts);
  return Math.sqrt(ys.reduce((a, y, i) => a + (R[i] - y) ** 2, 0) / ys.length);
};

test('fitLeg: vmax bounds every segment of the layout it picks; without it the same target takes a steeper point', () => {
  const N = 33, target = Float64Array.from({ length: N }, (_, k) => { const u = k / (N - 1); return u * u; });   // slow, then full speed
  const free = fitLeg(target, { du: 0.27, price: 0.04 }), capped = fitLeg(target, { du: 0.27, price: 0.04, vmax: 1.2 });
  const steep = (ks) => { let pu = 0, pd = 0, m = 0; for (const [u, d] of [...ks, [1, 1]]) { m = Math.max(m, (d - pd) / (u - pu)); pu = u; pd = d; } return m; };
  assert.ok(free.knots.length && steep(free.knots) > 1.2, 'the free fit goes faster than 1.2 x the average somewhere');
  assert.ok(steep(capped.knots) <= 1.2 + 1e-6, 'the capped fit never does');
  assert.ok(capped.err <= free.err0 && capped.err >= free.err - 1e-9);
});

for (const cusp of ['bottom', 'top']) test(`Smart stroke on a fast full-range cusp-${cusp} trace: points placed within the cap, the render follows the trace`, () => {
  const tr0 = cuspTrace({ cusp });
  const trace = [], turnsTrace = [];
  const CAP = 500;   // a cap these ~430 pos / s strokes run into (the default is 600 since the owner raised it)
  const r = strokes(tr0.t, tr0.v, { ...STROKES, maxSpeed: CAP, shape: 'render', sens: 50, trace });
  const plain = strokes(tr0.t, tr0.v, { ...STROKES, maxSpeed: CAP, shape: 'turns', trace: turnsTrace }).points;
  const pts = r.points, turns = pts.filter((q) => q.why === 'turn' || q.why === 'clamped');
  const extra = pts.filter((q) => /mid|shoulder|hold/.test(q.why));
  assert.deepEqual(turns.map((q) => [q.at, q.pos]), plain.filter((q) => q.why === 'turn' || q.why === 'clamped').map((q) => [q.at, q.pos]), 'turns unchanged (time and depth)');
  assert.ok(extra.length >= 0.5 * (turns.length - 1), `points on most half-strokes (${extra.length} on ${turns.length - 1})`);
  for (let i = 1; i < pts.length; i++) assert.ok(Math.abs(pts[i].pos - pts[i - 1].pos) <= (CAP * (pts[i].at - pts[i - 1].at)) / 1000 + 1, 'no step over the speed cap');
  assert.ok(pts.some((q) => q.cap), 'the halves the cap limited are flagged');
  const t0 = turns[1].at, t1 = turns[turns.length - 2].at, before = rmsAgainst(plain, trace[0], t0, t1), after = rmsAgainst(pts, trace[0], t0, t1);
  assert.ok(after < 0.75 * before, `rendered rms ${after.toFixed(2)} clearly below the bare triangle's ${before.toFixed(2)}`);
  // the cusp stays brief, the round turn dwells: time within 15 pos of the cusp's level, render vs trace
  const ts = []; for (let x = t0; x <= t1; x += 2) ts.push(x);
  const R = renderScript(pts, ts), Rp = renderScript(plain, ts), lin = (x) => { const T = trace[0]; let i = 0; while (i + 1 < T.t.length && T.t[i + 1] < x) i++; return T.pos[i] + ((T.pos[i + 1] - T.pos[i]) * (x - T.t[i])) / (T.t[i + 1] - T.t[i]); };
  const near = (c, f) => c.filter((y) => (cusp === 'bottom' ? y <= 15 : y >= 85) === f).length / c.length;
  const dTr = near(ts.map(lin), true), dAfter = near(Array.from(R), true), dBefore = near(Array.from(Rp), true);
  assert.ok(Math.abs(dAfter - dTr) < Math.abs(dBefore - dTr), `dwell at the cusp ${(100 * dAfter).toFixed(0)} % closer to the trace's ${(100 * dTr).toFixed(0)} % than the triangle's ${(100 * dBefore).toFixed(0)} %`);
});

test('a slow cusp trace (the cap far off) still gets its points and no cap flag', () => {
  const tr0 = cuspTrace({ period: 1000, n: 8 });
  const pts = strokes(tr0.t, tr0.v, { ...STROKES, shape: 'render', sens: 50 }).points;
  assert.ok(pts.filter((q) => /mid|shoulder|hold/.test(q.why)).length >= 8);
  assert.ok(!pts.some((q) => q.cap));
});

// ---- the shaft ----
const T = Array.from({ length: 300 }, (_, i) => Math.round((i * 1000) / 30)), sig = (ms) => 0.5 * (1 + Math.cos((2 * Math.PI * ms) / 900));
function shaftRun(len) {
  const pairs = (f) => T.map((t) => [t, f(t)]);
  return { id: 'run1', notes: [], range: { start: 0, end: 10000 }, flips: [],
    channels: { sem_c1_penis_in: channelOf(pairs((t) => 1 - len(t))), sem_c1_penis_in_conf: channelOf(pairs(() => 1)), sem_c1_penis_len: channelOf(pairs(len)), sig: channelOf(pairs(sig)) },
    scenes: [{ start_ms: 0, end_ms: 10000, sign: 1, shaft: { c1_penis: { source: 'sam', full: 'seen', conf_share: 1 } } }],
    points0: { at: Float64Array.from([0, 450, 900]), pos: Float64Array.from([100, 0, 100]) } };
}

test('depthR: a shaft that follows the signal reads high, one that does not near 0, the sign counts', () => {
  const v = T.map(sig);
  assert.ok(depthR(v, T.map((t) => 0.6 + 0.4 * sig(t)), 1) > 0.99);
  assert.ok(depthR(v, T.map((t) => 0.6 + 0.4 * sig(t)), -1) < -0.99);
  assert.ok(Math.abs(depthR(v, T.map((t) => 0.82 + 0.04 * Math.sin(t / 37)), 1)) < 0.3);
  assert.equal(depthR([1, 2, 3], [1, 2, 3]), 0, 'under 10 pairs: 0');
});

test('a confident shaft whose depth does not follow the signal is not used: scene depth, said in depthUsed', () => {
  const noise = shaftRun((t) => 0.82 + 0.05 * Math.sin(t / 37) * Math.cos(t / 91));   // confident on every frame, unrelated
  const follows = shaftRun((t) => 0.3 + 0.7 * sig(t));
  const a = pointsFromChannel(noise, 'sig', { strokes: {} }), b = pointsFromChannel(noise, 'sig', { strokes: { range: 'scene' } });
  assert.deepEqual(Array.from(a.pos), Array.from(b.pos), 'auto: the scene range, not the noise extremes');
  assert.equal(a.depthUsed[0].want, 'auto'); assert.equal(a.depthUsed[0].used, 'scene'); assert.ok(Math.abs(a.depthUsed[0].r) < 0.3);
  const c = pointsFromChannel(noise, 'sig', { strokes: { range: 'shaft' } });
  assert.deepEqual(Array.from(c.pos), Array.from(b.pos), 'chosen shaft falls back too');
  assert.equal(c.depthUsed[0].want, 'shaft'); assert.equal(c.depthUsed[0].used, 'scene');
  const d = pointsFromChannel(follows, 'sig', { strokes: {} });
  assert.equal(d.depthUsed[0].used, 'shaft'); assert.ok(d.depthUsed[0].r > 0.9);
  // paw-4c48: its own recurring extremes (30 % .. 100 % visible) are hilted and fully out
  assert.ok(Math.min(...Array.from(d.pos)) <= 5 && Math.max(...Array.from(d.pos)) >= 95, `a following shaft sets the depth from its own extremes (${Math.min(...d.pos)}..${Math.max(...d.pos)})`);
});

test('shaft depth: anchored before the clip, the render fit sees the stroke past 0 / 100 with its shape', () => {
  const tr0 = cuspTrace({ period: 1000, n: 8 });
  const depth = tr0.v.map((x) => 0.3 + 0.7 * x);   // follows: tops 100, bottoms 30
  const pts = strokes(tr0.t, tr0.v, { ...STROKES, shape: 'render', sens: 50, range: 'shaft', depth }).points;
  assert.ok(pts.filter((q) => /mid|shoulder|hold/.test(q.why)).length >= 8, 'the shape survives the anchoring');
  const lows = pts.filter((q) => q.why === 'turn' && q.pos < 60).map((q) => q.pos);
  assert.ok(lows.length >= 6 && lows.every((p) => Math.abs(p - 30) <= 3), 'bottoms at the shaft\'s 30');
});

test('the direction sentence never says unsure and confident at once', () => {
  const t = directionText({ confident: false, r: -0.11, share: 1, agrees: false });
  assert.match(t, /shaft not used: its depth does not follow this signal \(r -0.11\)/);
  assert.doesNotMatch(t, /confident/);
  assert.match(directionText({ confident: false, r: 0.7, share: 0.2 }), /shaft not used: read on only 20 % of the frames/);
  assert.equal(typeof shaftDepth, 'function');
});
