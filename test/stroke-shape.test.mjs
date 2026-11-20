// stroke-shape.js through strokes.js: at most one midpoint per half-stroke and one hold per turn (paw-izk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strokes } from '../src/lib/strokes.js';
import { shapeFit, shapeAt, midThr, SHAPES } from '../src/lib/stroke-shape.js';

const FPS = 30, N = 30 * 20;
const T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / FPS));
const sine = (hz) => T.map((ms) => Math.sin(2 * Math.PI * hz * ms / 1000));
/** Halves of `ms` each, alternating up / down, each shaped by f (0..1 -> 0..1). */
const halves = (ms, f) => T.map((t) => { const k = Math.floor(t / ms), u = (t % ms) / ms, y = f(u); return k % 2 ? 1 - y : y; });
const between = (pts, a, b) => pts.filter((p) => p.at > a && p.at < b);
const interior = (pts) => pts.filter((p) => p.at > 1500 && p.at < T[N - 1] - 1500);
/** Per half-stroke (consecutive turn / end points): the points strictly between. maxSpeed 0 so no turn is relabelled. */
function perHalf(pts) {
  const A = pts.map((p, i) => [p, i]).filter(([p]) => p.why === 'turn' || p.why === 'end').map(([, i]) => i), out = [];
  for (let q = 1; q < A.length; q++) out.push(pts.slice(A[q - 1] + 1, A[q]));
  return out;
}

test('symmetric strokes stay two points per half; turn timing as with turns only', () => {
  for (const hz of [0.5, 1, 2]) {
    const def = strokes(T, sine(hz), { maxSpeed: 0 }).points, tur = strokes(T, sine(hz), { maxSpeed: 0, shape: 'turns' }).points;
    assert.equal(def.filter((p) => p.why === 'mid' || p.why === 'hold').length, 0, `${hz} Hz: nothing between turns`);
    assert.deepEqual(def, tur);
  }
});

test('slow-in fast-out: exactly one midpoint near the knee of every half', () => {
  const knee = (u) => (u < 0.7 ? 0.25 * (u / 0.7) : 0.25 + 0.75 * ((u - 0.7) / 0.3));   // 25 % of the way in 70 % of the time
  const pts = strokes(T, halves(1000, knee), { maxSpeed: 0, smoothMs: 60 }).points;
  const H = perHalf(pts).slice(1, -1);
  assert.ok(H.length >= 15);
  for (const h of H) {
    assert.equal(h.length, 1, JSON.stringify(h));
    assert.equal(h[0].why, 'mid');
  }
  for (const p of interior(pts).filter((x) => x.why === 'mid')) { const u = (p.at % 1000) / 1000; assert.ok(Math.abs(u - 0.7) < 0.08, `mid at ${p.at} (phase ${u.toFixed(2)})`); }
  assert.equal(strokes(T, halves(1000, knee), { maxSpeed: 0, smoothMs: 60, shape: 'turns' }).points.filter((p) => p.why === 'mid').length, 0);
});

test('a dwell at the bottom: turn + hold at the same level, the hold where motion resumes', () => {
  // 2 s cycle: 0.5 s in, held 1 s deep (pos 0), 0.5 s out (cosine moves)
  const v = T.map((ms) => { const u = (ms % 2000) / 1000; return u < 0.5 ? 0.5 + 0.5 * Math.cos(Math.PI * u / 0.5) : u < 1.5 ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * (u - 1.5) / 0.5); });
  const pts = strokes(T, v, { maxSpeed: 0 }).points, holds = interior(pts).filter((p) => p.why === 'hold');
  assert.ok(holds.length >= 6, 'a hold per held bottom');
  for (const h of holds) {
    const k = pts.indexOf(h), turn = pts[k - 1];
    assert.equal(turn.why, 'turn');
    assert.ok(Math.abs(turn.pos - h.pos) <= 1, 'same level');
    assert.ok(h.pos < 10, 'at the bottom');
    const u = (h.at % 2000) / 1000, a = (turn.at % 2000) / 1000;
    assert.ok(Math.abs(u - 1.5) < 0.12 && Math.abs(a - 0.5) < 0.12, `arrive ${a.toFixed(2)} s, resume ${u.toFixed(2)} s`);
  }
  assert.equal(strokes(T, v, { maxSpeed: 0, shape: 'mid' }).points.filter((p) => p.why === 'hold').length, 0, '+ Midpoint never holds');
});

test('wobble and noise add no points; a double pump stays two strokes', () => {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  const noisy = sine(1).map((y) => y + 0.06 * rnd());
  const pts = strokes(T, noisy, { maxSpeed: 0 }).points;
  assert.equal(pts.filter((p) => p.why === 'mid' || p.why === 'hold').length, 0, JSON.stringify(pts.filter((p) => p.why !== 'turn')));
  // a double pump: in, half out, in again, out (two strokes in one second)
  const K = [[0, 1], [0.5, -1], [0.625, 0.2], [0.75, -1], [1, 1]];   // 2 s cycle: out, in, half out, in again, out
  const dp = T.map((ms) => { const u = (ms % 2000) / 2000, j = K.findIndex((k, i) => K[i + 1] && u < K[i + 1][0]), [a, ya] = K[j], [b, yb] = K[j + 1]; return ya + (yb - ya) * (1 - Math.cos(Math.PI * (u - a) / (b - a))) / 2; });
  const q = strokes(T, dp, { maxSpeed: 0 }).points, turns = between(q, 1900, 3900).filter((p) => p.why === 'turn');
  assert.equal(turns.length, 4, `the pump is its own stroke: ${JSON.stringify(between(q, 1900, 3900))}`);
  assert.equal(between(q, 1900, 3900).length, 4, 'and nothing else');
});

test('property: in every non-Free mode a half-stroke holds at most one midpoint and one hold (right after its turn), monotonic', () => {
  let s = 12345;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 40; trial++) {
    // random strokes: random half lengths, depths, shapes (knees, dwells), noise
    const knots = [];
    for (let t = 0, up = 1; t < T[N - 1] + 2000; up = -up) {
      const d = 150 + rnd() * 1400, dw = rnd() < 0.3 ? rnd() * 900 : 0, kn = rnd();
      knots.push({ t, d, dw, kn, lv: up > 0 ? 0.6 + 0.4 * rnd() : 0.4 * rnd() });
      t += d + dw;
    }
    const v = T.map((ms) => {
      let k = knots.findIndex((x, i) => i + 1 >= knots.length || knots[i + 1].t > ms);
      const a = knots[k], b = knots[k + 1] || a, prev = knots[k - 1] || a, u = Math.min(1, (ms - a.t) / a.d);
      const y = ms - a.t > a.d ? b.lv : prev.lv + (a.lv - prev.lv) * (a.kn < 0.5 ? u ** (1 + 3 * a.kn) : 1 - (1 - u) ** (1 + 3 * (a.kn - 0.5)));
      return y + 0.02 * (rnd() - 0.5);
    });
    for (const shape of ['turns', 'mid', 'hold']) for (const sens of [0, 50, 100]) {
      const pts = strokes(T, v, { maxSpeed: 0, shape, sens }).points;
      for (const h of perHalf(pts)) {
        const mids = h.filter((p) => p.why === 'mid'), holds = h.filter((p) => p.why === 'hold');
        assert.ok(mids.length <= (shape === 'turns' ? 0 : 1) && holds.length <= (shape === 'hold' ? 1 : 0) && h.length === mids.length + holds.length, `${shape}/${sens}: ${JSON.stringify(h)}`);
        if (holds.length) assert.equal(h[0], holds[0], 'the hold comes right after its turn');
      }
      // monotonic halves: every point between two turns lies between their levels
      const A = pts.filter((p) => p.why === 'turn' || p.why === 'end');
      for (const p of pts) {
        if (p.why !== 'mid') continue;
        const a = A.findLast((x) => x.at < p.at), b = A.find((x) => x.at > p.at);
        assert.ok((p.pos - a.pos) * (b.pos - p.pos) >= 0, `mid ${p.pos} between ${a.pos} and ${b.pos}`);
      }
      for (let i = 1; i < pts.length; i++) assert.ok(pts[i].at - pts[i - 1].at >= 60, 'min interval');
    }
  }
});

test('guards: a midpoint that barely changes the speeds, or asks for one over the cap, is not made; Free can make many', () => {
  const t = Array.from({ length: 31 }, (_, i) => i * 33.3);
  const lin = (f, g) => t.map((x) => { const u = x / t[30]; return 100 * (u < f ? (g * u) / f : g + ((1 - g) * (u - f)) / (1 - f)); });
  const fit = (p, o, sens = 100) => shapeFit(t, p, [0, 30], new Set([0, 30]), shapeAt({ shape: 'mid', sens }), { minIntervalMs: 60, ...o }).filter((q) => q.why === 'mid');
  assert.equal(fit(lin(0.5, 0.55), {}).length, 0, 'speeds 1.1 vs 0.9: no point');
  assert.equal(fit(lin(0.5, 0.8), {}).length, 1, 'speeds 1.6 vs 0.4: a midpoint');
  assert.equal(fit(lin(0.5, 0.8), { maxSpeed: 100 }).length, 0, 'over the cap: no point');
  assert.equal(fit(lin(0.5, 0.65), {}, 50).length, 0, 'deviation 0.15 < 0.20 at sensitivity 50');
  assert.ok(midThr(50) > 0.105, 'a sine half (0.105) stays two points at the default');
  assert.deepEqual(SHAPES, ['turns', 'mid', 'hold', 'render', 'free']);   // paw-na9u: + By render
  const knee = (u) => (u < 0.7 ? 0.25 * (u / 0.7) : 0.25 + 0.75 * ((u - 0.7) / 0.3));
  const wav = halves(1000, knee).map((y, i) => y + 0.05 * Math.sin(i / 2));
  const free = perHalf(strokes(T, wav, { maxSpeed: 0, shape: 'free', sens: 100 }).points);
  assert.ok(free.some((h) => h.length > 2), 'Free is not capped');
  assert.deepEqual(strokes(T, wav, { shape: 'hold' }), strokes(T, wav, { shape: 'hold' }), 'deterministic');
});

test('per-time settings: shapes spans pick the setting per half-stroke (later wins)', () => {
  const knee = (u) => (u < 0.7 ? 0.25 * (u / 0.7) : 0.25 + 0.75 * ((u - 0.7) / 0.3));
  const v = halves(1000, knee);
  const pts = strokes(T, v, { maxSpeed: 0, smoothMs: 60, shape: 'mid', shapes: [{ t0: 0, t1: 20000, shape: 'mid', sens: 50 }, { t0: 5000, t1: 10000, shape: 'turns', sens: 50 }] }).points;
  assert.equal(between(pts, 5000, 10000).filter((p) => p.why === 'mid').length, 0, 'the area override: turns only');
  assert.ok(between(pts, 11000, 19000).filter((p) => p.why === 'mid').length >= 6, 'the rest: midpoints');
});

// paw-e82: alike strokes get one layout; it changes with the motion, for the whole run of alike strokes
const DT = 10, HALF = 100;   // 10 ms samples, 1 s half-strokes
/** Halves with knees: half q reaches g(q) of its move at knee(q) of its time (straight segments), alternating up / down. */
function knees(g, knee = () => 0.5, n = 20) {
  const t = [], p = [];
  for (let i = 0; i <= n * HALF; i++) {
    const q = Math.min(n - 1, Math.floor(i / HALF)), u = (i - q * HALF) / HALF, k = knee(q), y = u < k ? (g(q) * u) / k : g(q) + ((1 - g(q)) * (u - k)) / (1 - k);
    t.push(i * DT); p.push(q % 2 ? 90 - 80 * y : 10 + 80 * y);
  }
  const anchors = Array.from({ length: n + 1 }, (_, q) => q * HALF);
  return { t, p, anchors, turn: new Set(anchors.slice(1, -1)) };
}
const midsOf = (fit, t) => fit.filter((q) => q.why === 'mid').map((q) => ({ q: Math.floor(t[q.i] / (HALF * DT)), u: (t[q.i] % (HALF * DT)) / (HALF * DT) }));

test('uniform detail: alike strokes either side of the threshold get the same layout at the same phase', () => {
  // every half deviates 0.17 / 0.23 / 0.19 / 0.21 (the threshold at sensitivity 50 is 0.20): each alone would flip
  const dev = [0.17, 0.23, 0.19, 0.21], { t, p, anchors, turn } = knees((q) => 0.5 + dev[Math.floor(q / 2) % 4]);
  const mids = midsOf(shapeFit(t, p, anchors, turn, shapeAt({ shape: 'mid', sens: 50 }), { minIntervalMs: 60, quant: false }), t);
  const inner = Array.from({ length: 18 }, (_, k) => k + 1);   // the first and last half are next to the ends
  for (const odd of [0, 1]) {   // per direction (in-moves and out-moves are judged apart)
    const has = inner.filter((q) => q % 2 === odd).map((q) => mids.some((m) => m.q === q));
    assert.ok(has.every((x) => x === has[0]), `one layout: ${has.join(' ')}`);
  }
  for (const m of mids) assert.ok(Math.abs(m.u - mids[0].u) <= 0.011, `same phase: ${m.u} vs ${mids[0].u}`);
  // deterministic
  assert.deepEqual(shapeFit(t, p, anchors, turn, shapeAt({ shape: 'mid', sens: 50 }), { quant: false }), shapeFit(t, p, anchors, turn, shapeAt({ shape: 'mid', sens: 50 }), { quant: false }));
});

test('uniform detail: one borderline stroke never flips its group; a real change of motion changes the layout for all of it', () => {
  // ten symmetric-ish strokes, one of them borderline (0.21), then ten strongly kneed ones (0.3)
  const g = (q) => (q < 10 ? 0.5 + (q === 4 ? 0.21 : 0.02) : 0.8);
  const { t, p, anchors, turn } = knees(g);
  const mids = midsOf(shapeFit(t, p, anchors, turn, shapeAt({ shape: 'mid', sens: 50 }), { minIntervalMs: 60, quant: false }), t);
  assert.ok(!mids.some((m) => m.q >= 1 && m.q <= 8 && m.q !== 4), 'the symmetric strokes stay two points');
  assert.ok(!mids.some((m) => m.q === 4), 'the one borderline stroke follows its group (it alone would pass)');
  for (let q = 11; q < 19; q++) assert.ok(mids.some((m) => m.q === q), `kneed stroke ${q} has its midpoint`);
});

test('uniform detail: holds on dwells either side of the hold time are all made or all left', () => {
  // 2 s cycles: 0.5 s in, a dwell of 200 / 300 ms at the bottom (alone, every other one would hold), out, a short top
  const t = [], v = [];
  for (let ms = 0, c = 0; c < 12; c++) {
    const dwell = c % 2 ? 300 : 200, seg = [[500, 1, 0], [dwell, 0, 0], [500, 0, 1], [200, 1, 1]];
    for (const [d, a, b] of seg) for (let x = 0; x < d; x += 10, ms += 10) { t.push(ms); v.push(a + (b - a) * (1 - Math.cos((Math.PI * x) / d)) / 2); }
  }
  const pts = strokes(t, v, { maxSpeed: 0, shape: 'hold', sens: 50 }).points;
  const held = pts.flatMap((q, i) => (q.why === 'turn' && q.pos < 20 && i + 1 < pts.length - 1 ? [pts[i + 1].why === 'hold'] : []));
  assert.ok(held.length >= 10 && held.every((x) => x === held[0]), `one layout at every bottom: ${held.join(' ')}`);
});
