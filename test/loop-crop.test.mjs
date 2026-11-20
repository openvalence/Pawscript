// paw-0zwb: the loop-pair crop search (src/lib/crop-match.js): one pass of each loop matched under one shared transform over
// every phase shift (matchCycles, cycleShift), spot checks of the later passes (spotPicks, spotCheck), the links' shape and
// the merge with the neighbour-shot links, the project block read back (loopStore), and the fill consuming a far loop link
// (link-fill.js: the shift's meaning, a weak link only offered).
import assert from 'node:assert/strict';
import test from 'node:test';
import { resize, pyramid, matchCycles, cycleOk, cycleShift, spotPicks, spotCheck, counterpart, loopShotLinks, mergeLinks, loopStore, LOOP_MATCH } from '../src/lib/crop-match.js';
import { indexRepeats } from '../src/features/timeline/repeats.js';
import { autoLoops } from '../src/features/timeline/repeat-scenes.js';
import { fillTargets, deriveFill } from '../src/lib/link-fill.js';
import { frameTime } from '../src/lib/lane.js';

// ---- generated pictures: a flat world (grey rectangles) with two blobs moving on a loop of N frames, drawn at 3x and
// cut to a window, so a crop is the same picture re-framed ----
const HW = 384, HH = 216, N = 12;
function rand(seed) { let h = seed >>> 0; return () => ((h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296); }
function world(seed) {
  const r = rand(seed), d = new Float32Array(HW * HH).fill(0.3 + 0.2 * r());
  for (let k = 0; k < 14; k++) {
    const x0 = Math.floor(r() * HW), y0 = Math.floor(r() * HH), w = 20 + Math.floor(r() * 120), h = 20 + Math.floor(r() * 80), v = r();
    for (let y = y0; y < Math.min(HH, y0 + h); y++) for (let x = x0; x < Math.min(HW, x0 + w); x++) d[y * HW + x] = v;
  }
  return d;
}
function frame(bg, phase, { win = [0, 0, 1], motion = 'circle' } = {}) {
  const d = Float32Array.from(bg), a = (2 * Math.PI * phase) / N;
  const blobs = motion === 'circle' ? [[170 + 40 * Math.cos(a), 110 + 30 * Math.sin(a), 22, 0.95], [230 + 25 * Math.sin(a), 120, 14, 0.05]] : [[170 + 60 * Math.sin(2 * a), 110, 22, 0.95], [230, 120 + 25 * Math.cos(a), 14, 0.05]];
  for (const [cx, cy, R, v] of blobs) for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(HH, cy + R); y++) for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(HW, cx + R); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R) d[y * HW + x] = v;
  const [wx, wy, s] = win, ww = Math.round(HW / s), wh = Math.round(HH / s), x0 = Math.round(wx * HW), y0 = Math.round(wy * HH), c = new Float32Array(ww * wh);
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) c[y * ww + x] = d[(y0 + y) * HW + x0 + x];
  return pyramid(resize({ w: ww, h: wh, d: c }, 128, 72));
}
const pass = (bg, o = {}, start = 0) => Array.from({ length: N }, (_, k) => frame(bg, start + k, o));
const BG = world(7), A = pass(BG);

test('a crop x1.8 at another phase: one transform, the exact shift, a clear margin; both orientations agree', () => {
  const B = pass(BG, { win: [0.2, 0.25, 1.8] }, 3);
  const r = matchCycles(A, B);
  assert.ok(cycleOk(r), JSON.stringify(r));
  assert.equal(r.tighter, 'b');
  assert.ok(Math.abs(r.scale - 1.8) / 1.8 < 0.04, `scale ${r.scale}`);
  assert.equal(r.shift, 3, 'B\'s first frame shows A\'s frame 3');
  assert.ok(r.margin >= LOOP_MATCH.strong, `margin ${r.margin}`);
  // A the crop: tighter 'a', and the shift read the same way (B's first frame = A's frame shift)
  const q = matchCycles(B, A);
  assert.ok(cycleOk(q)); assert.equal(q.tighter, 'a'); assert.equal(q.shift, (N - 3) % N);
});

test('must not link: another motion over the same picture, an unrelated world, the same framing', () => {
  const other = matchCycles(A, pass(BG, { win: [0.15, 0.2, 1.5], motion: 'sway' }));
  assert.ok(!cycleOk(other), `another motion: ${JSON.stringify(other)}`);
  assert.ok(!cycleOk(matchCycles(A, pass(world(99), { win: [0.1, 0.1, 1.4] }))), 'unrelated');
  assert.equal(matchCycles(A, pass(BG, {}, 5)), null, 'the same framing is the exact repeats\' business (scale ~1)');
  assert.equal(matchCycles(A, A.slice(0, 10)), null, 'other periods: not compared');
});

test('cycleShift: best shift, margin over shifts two or more away, a motion that comes round twice is not its own rival', () => {
  const n = 8, S = Array.from({ length: n }, (_, k) => Array.from({ length: n }, (_, j) => (j === (k + 3) % n ? 0.9 : j === (k + 4) % n ? 0.6 : 0.1)));
  const c = cycleShift(S);
  assert.equal(c.shift, 3); assert.ok(Math.abs(c.margin - 0.8) < 1e-9, 'shift 4 is one frame off: not the rival'); assert.equal(c.sub, 1);
  const H = Array.from({ length: n }, (_, k) => Array.from({ length: n }, (_, j) => (j % 4 === (k + 1) % 4 ? 0.9 : 0.1)));
  const h = cycleShift(H);
  assert.equal(h.sub, 2); assert.ok(h.margin > 0.7, `half-cycle equivalent excluded: ${h.margin}`);
});

test('spot checks: seeded (stable), every later pass, capped, inside the loop; agreement rule', () => {
  const a = spotPicks('12:0@40', 6, 12), b = spotPicks('12:0@40', 6, 12);
  assert.deepEqual(a, b, 'the same frames every time');
  assert.deepEqual([...new Set(a.map((p) => p.pass))], [1, 2, 3, 4, 5]);
  assert.equal(a.length, 10);
  assert.ok(spotPicks('x', 40, 12).length <= LOOP_MATCH.cap);
  assert.ok(spotPicks('x', 4.5, 12, { ok: (p, k) => p < 4 || k < 6 }).every((p) => p.pass < 4 || p.k < 6), 'a cut-short last pass: only its frames');
  assert.equal(counterpart(5, 3, 12, true), 2); assert.equal(counterpart(11, 3, 12, false), 2);
  const B = pass(BG, { win: [0.2, 0.25, 1.8] }, 3), r = matchCycles(A, B);
  // A's later pass frame k vs B's counterpart; a panned pass fails
  const good = [1, 5, 9].map((k) => ({ A: frame(BG, 12 + k), B: B[counterpart(k, r.shift, N, true)] }));
  assert.deepEqual(spotCheck(r, good), { n: 3, ok: 3, agree: true });
  const panned = [1, 5, 9].map((k) => ({ A: frame(BG, k, { win: [0.12, 0.1, 1.15] }), B: B[counterpart(k, r.shift, N, true)] }));
  assert.equal(spotCheck(r, panned).agree, false);
});

const R = (o = {}) => ({ score: 0.9, margin: 0.5, frames: 0.95, shift: 7, n: 20, scale: 1.8, x: 0.2, y: 0.25, w: 1 / 1.8, tighter: 'b', mean: 0.97, checks: { n: 14, ok: 14 }, ...o });
const sp = (a, b) => ({ start_ms: a, end_ms: b });

test('loop links: one per pair of shots (the best pair\'s transform), via loops, weak when the margin is small; merged over the neighbour links', () => {
  const pairs = [
    { A: { key: '3:0', id: '3:0@30', shot: sp(0, 5000) }, B: { key: '9:0', id: '9:0@900', shot: sp(30000, 35000) }, r: R() },
    { A: { key: '4:0', id: '4:0@60', shot: sp(0, 5000) }, B: { key: '10:0', id: '10:0@930', shot: sp(30000, 35000) }, r: R({ score: 0.95, scale: 1.7, margin: 0.1 }) },
    { A: { key: '5:0', id: '5:0@200', shot: sp(5000, 9000) }, B: { key: '11:0', id: '11:0@990', shot: sp(40000, 45000) }, r: R({ margin: 0.12 }) },
  ];
  const L = loopShotLinks(pairs);
  assert.equal(L.length, 2);
  assert.equal(L[0].via, 'loops'); assert.equal(L[0].kind, 'crop'); assert.equal(L[0].loops.length, 2);
  assert.equal(L[0].scale, 1.7, 'the best pair\'s transform'); assert.equal(L[0].frames, 20); assert.deepEqual(L[0].checks, { n: 14, ok: 14 });
  assert.deepEqual(L[0].box, { x: 0.2, y: 0.25, w: 1 / 1.8, h: 1 / 1.8 });
  assert.equal(L[0].loops[0].shift, 7); assert.equal(L[0].loops[0].ratio, 1); assert.equal(L[0].loops[0].periodA, 20);
  assert.ok(!L[0].weak && L[0].loops[1].weak, 'a small margin marks its loop pair weak');
  assert.ok(L[1].weak);
  const near = [{ a: sp(0, 5000), b: sp(30000, 35000), kind: 'crop', score: 0.94, scale: 1.75, loops: [{ a: '3:0', b: '9:0', shift: 6 }, { a: '7:0', b: '12:0', shift: 2 }] }, { a: sp(9000, 12000), b: sp(12000, 15000), kind: 'crop', score: 0.96, scale: 1.5, loops: [] }];
  const M = mergeLinks(near, L);
  assert.equal(M.length, 3);
  assert.equal(M[0].via, 'loops'); assert.equal(M[0].scale, 1.7, 'the cycle wins');
  assert.deepEqual(M[0].loops.map((p) => p.a), ['3:0', '4:0', '7:0'], 'the neighbour\'s other loop pair kept');
  assert.equal(M[1], near[1]);
});

test('the project block reads back what was saved; old projects and junk give nothing', () => {
  const pairs = [{ A: { key: '3:0', id: '3:0@30', shot: sp(0, 5000) }, B: { key: '9:0', id: '9:0@900', shot: sp(30000, 35000) }, r: R() }];
  const saved = JSON.parse(JSON.stringify({ v: 1, done: ['3:0@30', '9:0@900', '5:0@1'], pairs }));
  const s = loopStore(saved);
  assert.deepEqual(s.pairs, pairs); assert.deepEqual([...s.done], ['3:0@30', '9:0@900', '5:0@1']);
  assert.deepEqual(loopShotLinks(s.pairs), loopShotLinks(pairs));
  assert.deepEqual(loopStore(null), { pairs: [], done: new Set() });
  assert.equal(loopStore({ v: 1, pairs: [{ A: pairs[0].A, B: { key: 'x' }, r: R() }, { ...pairs[0], r: R({ shift: 25 }) }, { ...pairs[0], r: R({ tighter: 'same' }) }] }).pairs.length, 0);
});

// ---- the fill consumes a far loop link ----
const FM = 1000 / 30, F = 20, truth = (p) => 50 + 40 * Math.sin((2 * Math.PI * p) / F);
function video(pic) {
  const n = Math.max(...pic) + 1, occ = Array.from({ length: n }, () => []);
  for (let f = 0; f < pic.length; f++) { const p = pic[f]; if (p < 0) continue; const L = occ[p].at(-1); if (L && L.f1 === f - 1 && pic[f - 1] === p) L.f1 = f; else occ[p].push({ f0: f, f1: f, t_ms: frameTime(f, FM) }); }
  for (let p = 0; p < n; p++) if (!occ[p].length) occ[p].push({ f0: 5000 + p, f1: 5000 + p, t_ms: frameTime(5000 + p, FM) });
  return indexRepeats({ frames: pic.length, buckets: occ }, FM);
}
function run(pic, a, b) {
  const t = [], v = [];
  for (let f = a; f < b; f++) { t.push(frameTime(f, FM)); v.push(pic[f] >= 0 && pic[f] < F ? truth(pic[f]) : 20); }
  const ch = { t: Float64Array.from(t), v: Float32Array.from(v), min: 10, max: 90, scaled: Float32Array.from(v, (y) => (y - 10) / 80) }, pts = { at: new Float64Array(0), pos: new Float64Array(0) };
  return { id: 'run1', n: 1, range: { start: frameTime(a, FM), end: frameTime(b, FM) }, scenes: [{ start_ms: frameTime(a, FM), end_ms: frameTime(b, FM) }], flips: [], channel: 'proj', channels: { proj: ch }, samples: { t: ch.t, v: ch.v }, points0Primary: pts, points0: pts, points: pts, notes: [] };
}

test('the fill: a tracked loop fills its re-framed copy 11 shots away (B\'s first frame shows A\'s frame shift); a weak link is only offered', () => {
  const pic = new Array(480).fill(-1);
  for (let f = 30; f < 130; f++) pic[f] = (f - 30) % F;               // shot 0: the loop, 5 passes
  for (let f = 360; f < 450; f++) pic[f] = F + ((f - 360) % F);       // shot 11: the re-framed copy (its own pictures), 4.5 passes
  const ix = video(pic), loops = autoLoops(ix, FM, FM).map((c, k) => ({ id: 'lp' + k, t0: c.t0, t1: c.t1, auto: { key: c.key, t0: c.t0, t1: c.t1, end: c.end, n: c.n } }));
  const cuts = [0, 150, ...Array.from({ length: 9 }, (_, k) => 170 + k * 20), 360, 480], shots = cuts.slice(0, -1).map((f, k) => ({ start_ms: frameTime(f, FM), end_ms: frameTime(cuts[k + 1], FM) }));
  const lA = loops.find((l) => l.t0 < 150 * FM), lB = loops.find((l) => l.t0 >= 360 * FM), T = shots.length - 1;
  const link = (r) => loopShotLinks([{ A: { key: lA.auto.key, id: 'a', shot: shots[0] }, B: { key: lB.auto.key, id: 'b', shot: shots[T] }, r }]);
  const S = run(pic, 0, 150);
  const w = fillTargets({ shots, ix, loops, crops: link(R()), runs: [S] });
  assert.equal(w.length, 1); assert.equal(w[0].i, T); assert.equal(w[0].j, 0); assert.equal(w[0].plan.kind, 'crop');
  const d = deriveFill(S, w[0], { shots, ix, loops });
  let m = 0, n = 0;
  d.channels.proj.v.forEach((y, x) => { if (y !== y) return; n++; const f = Math.round(d.ts[x] / FM); m = Math.max(m, Math.abs(y - truth((f - 360 + 7) % F))); });
  assert.ok(n >= 85 && m < 1e-3, `max error ${m} over ${n}`);
  assert.ok(d.info.ok);
  const weak = fillTargets({ shots, ix, loops, crops: link(R({ margin: 0.1 })), runs: [S] });
  const dw = deriveFill(S, weak[0], { shots, ix, loops });
  assert.equal(dw.info.ok, false); assert.match(dw.info.why, /weak/);
});
