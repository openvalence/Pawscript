// strokes.js: one signal -> script points, the sidecar's to_points ported live, with the owner's range policy (paw-e3i part 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strokes, savgol, peaks } from '../src/lib/strokes.js';

const FPS = 30, N = 600;
const T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / FPS));
// 1 Hz strokes, a double pump at 6-7 s (two turns more), a shallow section (30 %) at 12-15 s, small tracker jitter
function sig(ms, jitter = 0.01) {
  const s = ms / 1000;
  const base = s >= 12 && s < 15 ? 0.3 * Math.sin(2 * Math.PI * s) : s >= 6 && s < 7 ? 0.6 * Math.sin(2 * Math.PI * 2 * s) + 0.4 * Math.sin(2 * Math.PI * s) : Math.sin(2 * Math.PI * s);
  return base + jitter * Math.sin(ms / 7.3) * Math.cos(ms / 3.1);
}
const V = T.map((ms) => sig(ms));

test('savgol keeps a quadratic exactly and peaks follow scipy\'s prominence rule', () => {
  const q = Array.from({ length: 21 }, (_, i) => 0.5 * i * i - 3 * i + 2), s = savgol(q, 4);
  for (let i = 4; i < 17; i++) assert.ok(Math.abs(s[i] - q[i]) < 1e-9);
  assert.deepEqual(peaks([0, 1, 0, 0.2, 0.1, 3, 0], 0.5), [1, 5]);
  assert.deepEqual(peaks([0, 1, 0, 0.2, 0.1, 3, 0], 0.05), [1, 3, 5]);
});

test('turns within a frame of the truth; jitter never becomes a stroke; the double pump stays', () => {
  const { points } = strokes(T, V);
  const turns = points.filter((p) => p.why === 'turn');
  for (const p of turns.filter((x) => x.at > 300 && x.at < 5800)) { const ph = ((p.at / 1000) % 1 + 1) % 1, d = Math.min(Math.abs(ph - 0.25), Math.abs(ph - 0.75)) * 1000; assert.ok(d <= 1000 / FPS, `turn at ${p.at} is ${d.toFixed(0)} ms off`); }
  assert.equal(turns.filter((p) => p.at > 300 && p.at < 5800).length, 11, 'one turn per half stroke, no jitter turns');
  assert.ok(turns.filter((p) => p.at >= 6000 && p.at < 7000).length >= 3, 'the double pump keeps its extra turns');
  const alt = turns.every((p, i) => i === 0 || Math.sign(p.pos - turns[i - 1].pos) !== 0);
  assert.ok(alt);
});

test('the shallow section stays shallow (scene range, never renormalised per stroke); local renormalises it', () => {
  const amp = (pts, a, b) => { const q = pts.filter((p) => p.at >= a && p.at < b).map((p) => p.pos); return Math.max(...q) - Math.min(...q); };
  const sc = strokes(T, V).points, loc = strokes(T, V, { range: 'local' }).points;
  const r = amp(sc, 12500, 14500) / amp(sc, 1300, 5700);
  assert.ok(r > 0.22 && r < 0.4, 'scene range keeps 30 %: ' + r);
  assert.ok(amp(loc, 13000, 14500) / amp(loc, 1300, 5700) > r + 0.1, 'local range blows it up (the sidecar habit)');
});

test('min stroke duration and min stroke size drop small strokes; direction sign mirrors', () => {
  const tiny = T.map((ms) => sig(ms, 0) + (ms > 2000 && ms < 2200 ? 0.5 * Math.sin(((ms - 2000) / 200) * 2 * Math.PI) : 0));
  const a = strokes(T, tiny, { minMs: 0, smoothMs: 0 }).points.filter((p) => p.why === 'turn').length;
  const b = strokes(T, tiny, { minMs: 250, smoothMs: 0 }).points.filter((p) => p.why === 'turn').length;
  assert.ok(b < a, `a 100 ms wiggle goes with minMs (${a} -> ${b})`);
  const up = strokes(T, V).points, dn = strokes(T, V, { sign: -1 }).points;
  assert.equal(up.length, dn.length);
  up.forEach((p, i) => assert.ok(Math.abs(p.pos + dn[i].pos - 100) <= 1));
});

test("paw-dnrv: a held level stays where it is (no undrift) and a hold's jitter makes no turns (minAmp)", () => {
  const held = T.map((ms) => (ms < 10000 ? Math.sin((2 * Math.PI * ms) / 1000) : -0.6 + 0.02 * Math.sin((2 * Math.PI * ms) / 300)));
  const tail = (P) => P.points.filter((p) => p.at > 11000 && p.at < 19500);
  const on = tail(strokes(T, held)), off = tail(strokes(T, held, { minAmp: 0 }));
  assert.ok(off.filter((p) => p.why === 'turn').length >= 20, `without the floor the jitter is strokes: ${off.length}`);
  assert.equal(on.filter((p) => p.why === 'turn').length, 0, 'with it the hold has no turns');
  const lv = (P) => P.points.filter((p) => p.at > 11000).reduce((s, p, _, a) => s + p.pos / a.length, 0);
  assert.ok(lv(strokes(T, held)) < 30 && lv(strokes(T, held, { undrift: true })) > 40, 'the hold stays low; undrift pulls it to the middle');
});

test('paw-d323: small strokes among full ones stay (minAmp only where the signal holds beside them); the hold after them stays still', () => {
  // full 1 Hz strokes; at the top 4.25-5.45 s three small strokes (0.08 of a full one); a jittering hold from 10 s
  const v = T.map((ms) => { const s = ms / 1000; return s >= 10 ? -0.6 + 0.02 * Math.sin((2 * Math.PI * ms) / 300) : s >= 4.25 && s < 5.45 ? 0.92 + 0.08 * Math.cos((2 * Math.PI * (s - 4.25)) / 0.4) : Math.sin(2 * Math.PI * (s >= 5.45 ? s - 1.2 : s)); });
  const turnsIn = (P, a, b) => P.points.filter((p) => p.why === 'turn' && p.at > a && p.at < b).length;
  const fix = strokes(T, v), piece = strokes(T, v, { stillRange: Infinity });   // Infinity = minAmp against the piece median alone
  assert.equal(turnsIn(piece, 4300, 5400), 0, 'the piece median alone takes the small strokes');
  assert.ok(turnsIn(fix, 4300, 5400) >= 4, `the small strokes stay: ${turnsIn(fix, 4300, 5400)}`);
  assert.equal(turnsIn(fix, 11000, 19500), 0, 'the hold has no turns');
});

test('speed clamp shortens depth, keeps time; detail adds points between turns by tolerance; deterministic', () => {
  const fast = T.map((ms) => Math.sin(2 * Math.PI * 4 * ms / 1000));   // 4 Hz full strokes: 800 pos/s
  const c = strokes(T, fast, { maxSpeed: 400, shape: 'turns' }).points, free = strokes(T, fast, { maxSpeed: 0, shape: 'turns' }).points;   // (a midpoint over the cap is not made at all: stroke-shape.test)
  assert.deepEqual(c.map((p) => p.at), free.map((p) => p.at), 'times unchanged');
  assert.ok(c.some((p) => p.why === 'clamped'));
  for (let i = 1; i < c.length; i++) assert.ok(Math.abs(c[i].pos - c[i - 1].pos) <= (400 * (c[i].at - c[i - 1].at)) / 1000 + 1);
  const ramp = T.map((ms) => (ms % 2000 < 1500 ? (ms % 2000) / 1500 : 1 - ((ms % 2000) - 1500) / 500) ** 2);   // slow in, fast out
  const n0 = strokes(T, ramp).points.length, n1 = strokes(T, ramp, { detail: 3 }).points.length;
  assert.ok(n1 > n0, `detail adds points (${n0} -> ${n1})`);
  assert.deepEqual(strokes(T, V, { detail: 3 }), strokes(T, V, { detail: 3 }));
});

test('timing series moves each turn to its own extremum; low confidence spans are marked and emptied; gaps split', () => {
  const late = T.map((ms) => sig(ms - 40, 0));
  const t1 = strokes(T, V, { timing: late }).points.filter((p) => p.why === 'turn' && p.at > 300 && p.at < 5800);
  assert.ok(t1.every((p) => { const ph = (((p.at - 40) / 1000) % 1 + 1) % 1; return Math.min(Math.abs(ph - 0.25), Math.abs(ph - 0.75)) * 1000 <= 1000 / FPS; }));
  const conf = T.map((ms) => (ms >= 8000 && ms < 10000 ? 0.1 : 0.9));
  const r = strokes(T, V, { conf });
  assert.deepEqual(r.low.map((l) => [Math.round(l.t0 / 100), Math.round(l.t1 / 100)]), [[80, 100]]);
  assert.ok(!r.points.some((p) => p.at > 8100 && p.at < 9900));
  const gap = V.map((v, i) => (T[i] >= 4000 && T[i] < 5000 ? NaN : v));
  assert.ok(!strokes(T, gap).points.some((p) => p.at > 4000 && p.at < 4990));
});

// paw-woz5 range 'compress': a long run with a few big strokes and a drift (the owner's handheld / POV runs)
test('compress: a few big strokes and a drift do not set the scale, the order of stroke sizes is kept, no step', async () => {
  const { compressCurve, signalTurns } = await import('../src/lib/strokes.js');
  for (let x = 0.05; x < 8; x += 0.05) assert.ok(compressCurve(x + 0.05) > compressCurve(x), 'strictly increasing: a bigger stroke stays bigger');
  assert.ok(Math.abs(compressCurve(1) - 1) < 1e-12 && compressCurve(4) < 3, 'unchanged under the knee, squeezed above it');
  let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // turn levels (+A/2 / -A/2), cosine-eased between: 2 min of 20..30 strokes, three of 90, a 4 s drift of 60 at 60 s
  const K = []; let ms = 0;
  for (let k = 0; ms < 120000; k++) { const A = [30, 70, 100].includes(k) ? 90 : 20 + 10 * rnd(), P = 900 + 200 * rnd(); K.push([ms, A / 2], [ms + P / 2, -A / 2]); ms += P; }
  const tt = [], clean = [];
  for (let i = 0, k = 0; i < (ms - 1000) / (1000 / FPS); i++) { const t = (i * 1000) / FPS; while (K[k + 1][0] <= t) k++; const u = (t - K[k][0]) / (K[k + 1][0] - K[k][0]); tt.push(Math.round(t)); clean.push(K[k][1] + ((K[k + 1][1] - K[k][1]) * (1 - Math.cos(Math.PI * u))) / 2); }
  const drift = tt.map((t) => (t > 60000 && t < 64000 ? 30 * (1 - Math.cos((2 * Math.PI * (t - 60000)) / 4000)) : 0));
  const v = clean.map((x, i) => (x + drift[i]) / 100);
  const run = (range) => { const trace = []; strokes(tt, v, { range, maxSpeed: 0, trace }); return trace[0].pos; };
  const { y, turns } = signalTurns(tt, v), D = run('compress'), Sc = run('scene');
  const hs = (Z) => turns.slice(1).map(([b], q) => Math.abs(Z[b] - Z[turns[q][0]]));
  const hin = hs(Array.from(y, (x) => 100 * x)), hout = hs(D), at = turns.slice(1).map(([b]) => tt[b]);
  const far = (q) => at[q] < 50000 || at[q] > 74000, med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
  // the order of stroke sizes, every pair exactly, away from the drift (within the slow level's reach of it, 10 s, its half-strokes carry it)
  const idx = hin.map((_, q) => q).filter(far).sort((p, q) => hin[p] - hin[q]);
  for (let j = 1; j < idx.length; j++) assert.ok(hout[idx[j]] >= hout[idx[j - 1]] - 1e-9, `stroke ${idx[j]} (${hin[idx[j]].toFixed(2)} in) stays bigger than ${idx[j - 1]} (${hin[idx[j - 1]].toFixed(2)})`);
  // the ordinary strokes are felt (the big ones and the drift do not set the scale) and the big ones stay bigger, unclipped
  const ord = med(hout.filter((_, q) => hin[q] < 32 && far(q))), big = hout.filter((_, q) => hin[q] > 50);
  assert.ok(ord > 38, `ordinary strokes ${ord.toFixed(1)} pos tall`);
  assert.ok(Math.min(...big) > Math.max(...hout.filter((_, q) => hin[q] < 32 && far(q))) && Math.max(...D) <= 100 && Math.min(...D) >= 0);
  assert.ok(Math.max(...hs(Sc).filter((_, q) => hin[q] > 50)) >= 99, '(the scene range clips them: what compress is for)');
  // no step anywhere: the biggest frame-to-frame change stays under the input's at the same make-up gain
  const jump = (a) => Math.max(...a.slice(1).map((x, i) => Math.abs(x - a[i])));
  assert.ok(jump(D) <= jump(Array.from(v, (x) => 100 * x)) * (ord / med(hin.filter((_, q) => hin[q] < 32 && far(q)))) + 0.5, `max jump ${jump(D).toFixed(2)}`);
  // a uniform run: nothing but the make-up gain (every half-stroke scaled alike)
  const U = tt.slice(0, 1800).map((t) => 0.125 * Math.cos((2 * Math.PI * t) / 1000) + 0.002 * Math.sin(t / 7.3)), tr = [];
  strokes(tt.slice(0, 1800), U, { range: 'compress', maxSpeed: 0, trace: tr });
  const tu = signalTurns(tt.slice(0, 1800), U), r = tu.turns.slice(2, -2).map(([b], q) => Math.abs(tr[0].pos[b] - tr[0].pos[tu.turns[q + 1][0]]) / Math.abs(tu.y[b] - tu.y[tu.turns[q + 1][0]]));
  assert.ok(Math.max(...r) / Math.min(...r) < 1 + 1e-9, 'one gain for every stroke');
});
