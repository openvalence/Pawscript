// paw-na9u: Detail by render (lib/stroke-shape.js renderScript / fitLeg / flatTest, the 'render' shape through strokes.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScript, fitLeg, flatTest, RENDER, SHAPE } from '../src/lib/stroke-shape.js';
import { strokes } from '../src/lib/strokes.js';
import { loadKinetic, renderKinetic } from '../src/lib/analyze/kinetic/driver.js';
import { getProfile } from '../src/lib/analyze/profiles.js';
import { rng } from './how-synth.mjs';

const ss = (u) => u * u * (3 - 2 * u), N = RENDER.N;
const tg = (f) => Float64Array.from({ length: N }, (_, k) => f(k / (N - 1)));
const FPS = 30;
/** a periodic signal f(phase 0..1) over ms at 30 fps with uniform noise (share of the range) */
const sig = (P, f, ms = 9000, noise = 0.004, seed = 1) => { const r = rng(seed), t = [], v = []; for (let i = 0; i < (ms * FPS) / 1000; i++) { const x = Math.round((i * 1000) / FPS); t.push(x); v.push(f((x % P) / P) + noise * 2 * (r() - 0.5)); } return { t, v }; };
const run = (s, o = {}) => strokes(s.t, s.v, { shape: 'render', ...o }).points;
const kinds = (pts) => pts.reduce((m, p) => ((m[p.why] = (m[p.why] || 0) + 1), m), {});

test('the generic device: a move from rest to rest is a smoothstep, a point inside a move is passed smoothly, a flat stays flat', () => {
  const R = renderScript([{ at: 0, pos: 0 }, { at: 400, pos: 100 }, { at: 800, pos: 0 }], [0, 100, 200, 300, 400, 600]);
  [0, 100, 200, 300, 400].forEach((t, k) => assert.ok(Math.abs(R[k] - 100 * ss(t / 400)) < 1e-9, `${t}`));
  assert.ok(Math.abs(R[5] - 50) < 1e-9);
  const M = renderScript([{ at: 0, pos: 0 }, { at: 200, pos: 25 }, { at: 400, pos: 100 }, { at: 800, pos: 0 }], [200, 199, 201]);
  assert.ok(Math.abs(M[0] - 25) < 1e-9 && M[1] < 25 && M[2] > 25, 'through the inner point, still moving');
  const H = renderScript([{ at: 0, pos: 0 }, { at: 300, pos: 80 }, { at: 600, pos: 80 }, { at: 900, pos: 0 }], [350, 450, 550]);
  assert.ok(H.every((x) => Math.abs(x - 80) < 1e-9), 'a flat pair is a flat');
});

test('the generic device is close to the Capstan\'s own planner (Kinetic2) where the planner is within its limits', async () => {
  await loadKinetic();
  const k = getProfile('nucleus-capstan').kinematics;
  const scripts = [
    [{ at: 0, pos: 10 }, { at: 1000, pos: 10 }, { at: 1500, pos: 90 }, { at: 2000, pos: 10 }, { at: 3000, pos: 10 }],
    [{ at: 0, pos: 10 }, { at: 1000, pos: 10 }, { at: 1300, pos: 30 }, { at: 1600, pos: 90 }, { at: 2100, pos: 10 }, { at: 3000, pos: 10 }],
    [{ at: 0, pos: 10 }, { at: 1000, pos: 10 }, { at: 1400, pos: 82 }, { at: 1600, pos: 90 }, { at: 2100, pos: 10 }, { at: 3000, pos: 10 }],
  ];
  for (const s of scripts) {
    const r = renderKinetic(s, { v: k.vMax, a: k.aMax, j: k.jMax }, 200), ts = [];
    for (let t = 1000; t <= 2100; t += 10) ts.push(t);
    const G = renderScript(s, ts);
    let e = 0;
    ts.forEach((t, q) => { const p = r.pos[Math.round(t - r.first)] / 2; e += (p - G[q]) ** 2; });
    assert.ok(Math.sqrt(e / ts.length) < 2.5, `rms ${Math.sqrt(e / ts.length).toFixed(2)} for ${JSON.stringify(s.map((p) => p.pos))}`);
  }
});

test('fitLeg: rounded -> nothing, a flat end -> a point where it starts at the turn level, slow then fast -> one point on the knee; deterministic; the price', () => {
  assert.deepEqual(fitLeg(tg((u) => 0.5 - 0.5 * Math.cos(Math.PI * u))).knots, [], 'a sine half: the S already is it');
  const flat = fitLeg(tg((u) => (u < 0.7 ? ss(u / 0.7) : 1)), { du: 0.1 }).knots;
  assert.equal(flat.length, 1);
  assert.ok(Math.abs(flat[0][0] - 0.7) < 0.02 && flat[0][1] === 1, JSON.stringify(flat));
  const knee = fitLeg(tg((u) => (u < 0.5 ? 0.2 * ss(u / 0.5) * 0.5 + 0.1 * (u / 0.5) : 0.2 + 0.8 * Math.sin(((u - 0.5) / 0.5) * Math.PI / 2))), { du: 0.1 }).knots;
  assert.ok(knee.length >= 1 && knee.some(([u, d]) => Math.abs(u - 0.5) < 0.12 && Math.abs(d - 0.2) < 0.15), `the knee: ${JSON.stringify(knee)}`);
  const t = tg((u) => 0.25 * u + 0.75 * u ** 3);
  assert.deepEqual(fitLeg(t), fitLeg(Float64Array.from(t)), 'deterministic');
  const cheap = fitLeg(t, { price: 0.001 }).knots.length, dear = fitLeg(t, { price: 0.5 }).knots.length;
  assert.ok(cheap > dear && dear === 0, `${cheap} points cheap, ${dear} dear`);
});

test('flatTest: a level dwell is flat, a slow slope is not, at the noise floor of 1 pos', () => {
  const ts = [0, 33, 67, 100, 133, 167, 200, 233];
  assert.equal(flatTest(ts, 2, 0.2).flat, true, 'drifting 2 pos/s');
  assert.equal(flatTest(ts, 60, 0.2).flat, false, 'a slow transition: 60 pos/s');
  assert.equal(flatTest([0], 0, 0.2).flat, false, 'one sample says nothing');
});

test('By render on strokes: rounded strokes get nothing, the turns are exactly the turns-only ones', () => {
  const s = sig(700, (x) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x));
  const a = run(s), b = strokes(s.t, s.v, { shape: 'turns' }).points;
  assert.deepEqual(kinds(a), kinds(b));
  assert.deepEqual(a.map((p) => [p.at, p.pos]), b.map((p) => [p.at, p.pos]));
  // a noisier rounded bump: still nothing
  const n = run(sig(600, (x) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x), 9000, 0.02, 3));
  assert.ok(n.filter((p) => !/turn|end/.test(p.why)).length <= 2, `noisy: ${JSON.stringify(kinds(n))}`);
});

test('By render: a flat top of 300 ms gets a hold whose ends are within a frame of the flat\'s, the turn kept', () => {
  // 1 s strokes: rise 350 ms, flat 300 ms, fall 350 ms (the turn sits somewhere inside the flat)
  const s = sig(1000, (x) => (x < 0.35 ? ss(x / 0.35) : x < 0.65 ? 1 : 1 - ss((x - 0.65) / 0.35)), 9000, 0.002);
  const pts = run(s), holds = pts.filter((p) => p.why === 'hold');
  assert.ok(holds.length >= 5, JSON.stringify(kinds(pts)));
  for (const h of holds) {
    const ph = (h.at % 1000) / 1000;
    assert.ok(Math.abs(ph - 0.35) * 1000 <= 34 || Math.abs(ph - 0.65) * 1000 <= 34, `a hold point at phase ${ph.toFixed(3)}`);
    const k = pts.indexOf(h);
    assert.ok([pts[k - 1], pts[k + 1]].some((p) => p?.why === 'turn' && p.pos === h.pos), 'level with its turn');
  }
  assert.deepEqual(pts.filter((p) => p.why === 'turn').map((p) => p.at), strokes(s.t, s.v, { shape: 'turns' }).points.filter((p) => p.why === 'turn').map((p) => p.at), 'turns never move');
});

test('By render: slow then fast puts a point low on the rise; a shoulder before the top a point on the rise, the curve then follows', () => {
  const sf = run(sig(900, (x) => (x < 0.5 ? (x < 0.25 ? 0.15 * ss(x / 0.25) : 0.15 + 0.85 * Math.sin(((x - 0.25) / 0.25) * Math.PI / 2)) : 1 - ss((x - 0.5) / 0.5))));
  const lows = sf.filter((p) => /mid|shoulder/.test(p.why) && p.pos < 40);
  assert.ok(lows.length >= 6, `low points on the rise: ${JSON.stringify(kinds(sf))}`);
  // a rise that is nearly there early and creeps to the top (a shoulder): a point on the rise, and the device's curve
  // follows the trace at least twice as closely as from the turns alone
  const S = sig(1000, (x) => (x >= 0.5 ? 1 - ss((x - 0.5) / 0.5) : x < 0.35 ? 0.88 * ss(x / 0.35) : 0.88 + 0.12 * Math.sin(((x - 0.35) / 0.15) * Math.PI / 2)));
  const tr = [], sh = strokes(S.t, S.v, { shape: 'render', trace: tr }).points, tu = strokes(S.t, S.v, { shape: 'turns' }).points;
  assert.ok(sh.filter((p) => /mid|shoulder/.test(p.why) && p.pos > 40).length >= 6, `points on the rise: ${JSON.stringify(kinds(sh))}`);
  const err = (P) => { const R = renderScript(P, Array.from(tr[0].t)); let e = 0, n = 0; tr[0].t.forEach((t, i) => { if (t > 1000 && t < 8000) { e += (R[i] - tr[0].pos[i]) ** 2; n++; } }); return Math.sqrt(e / n); };
  assert.ok(err(sh) < 0.5 * err(tu), `rendered error ${err(sh).toFixed(2)} vs turns only ${err(tu).toFixed(2)}`);
});

test('the default is By render; + Midpoint + Hold stays one chip away', () => {
  assert.equal(SHAPE.shape, 'render');
});

test('By render on a loop: every pass of the same pictures gets the identical layout', async () => {
  const { track, howRun, ASPECT, FPS: F } = await import('./how-synth.mjs');
  const { fusedChannel } = await import('../src/lib/fusion.js');
  const { pointsFromChannel } = await import('../src/lib/runs-channel.js');
  const one = [{ kind: 'impact', T: 700, rest: 0.45 }, { kind: 'slowout', T: 700 }, { kind: 'shoulder', T: 700, rest: 0.45 }];
  const tr = track([...one, ...one, ...one, ...one], { lead: 0 }), run = howRun(tr, { seed: 2, jitter: 0 }), ch = fusedChannel(run, { aspect: ASPECT });
  const L = Math.round((2100 * F) / 1000), picAt = (ms) => Math.round((ms * F) / 1000) % L;
  const P = pointsFromChannel({ ...run, channels: { ...run.channels, fused: ch } }, 'fused', { strokes: { shape: 'render' }, picAt });
  const pass = (k) => Array.from(P.at, (at, i) => [at - k * 2100, P.why[i]]).filter(([x]) => x >= 200 && x < 1900).map(([x, w]) => `${Math.round(x / 34)}${w}`);
  assert.ok(pass(1).some((x) => /hold|mid|shoulder/.test(x)), `the loop has detail: ${pass(1)}`);
  assert.deepEqual(pass(2), pass(1));
});
