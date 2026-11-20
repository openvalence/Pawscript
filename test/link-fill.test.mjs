// paw-ef73.33: linked shots fill each other (src/lib/link-fill.js): the phase mapping (exact repeats, crop links with a
// 2:1 period ratio both ways), another start phase, a cut-short last pass, twos, a flipped stretch, a variable frame rate,
// the averaging order (S's own loop decision; T never averaged again), the level carry, the guard.
import assert from 'node:assert/strict';
import test from 'node:test';
import { indexRepeats } from '../src/features/timeline/repeats.js';
import { autoLoops } from '../src/features/timeline/repeat-scenes.js';
import { fillTargets, deriveFill, cropIdx, carryLevel, levelRef, fillWords, fillId } from '../src/lib/link-fill.js';
import { makeClock } from '../src/features/video/frames.js';
import { frameTime } from '../src/lib/lane.js';

const FM = 1000 / 30, F = 20;
const truth = (p) => 50 + 40 * Math.sin((2 * Math.PI * p) / F);
const noise = (f) => Math.sin(f * 12.9898) * 2;   // the tracker's noise: +-2

/** A video: pic[f] = the picture frame f shows (-1 = a picture of its own). -> repeats index (bucket id = picture). */
function video(pic, grid = FM) {
  const n = Math.max(...pic) + 1, occ = Array.from({ length: n }, () => []);
  for (let f = 0; f < pic.length; f++) {
    const p = pic[f];
    if (p < 0) continue;
    const L = occ[p].at(-1);
    if (L && L.f1 === f - 1 && pic[f - 1] === p) L.f1 = f; else occ[p].push({ f0: f, f1: f, t_ms: frameTime(f, grid) });
  }
  for (let p = 0; p < n; p++) if (!occ[p].length) occ[p].push({ f0: 5000 + p, f1: 5000 + p, t_ms: frameTime(5000 + p, grid) });   // ids without a showing: a bucket far away
  return indexRepeats({ frames: pic.length, buckets: occ }, grid);
}
const loopsOf = (ix, grid = FM) => autoLoops(ix, FM, grid).map((c, k) => ({ id: 'lp' + k, t0: c.t0, t1: c.t1, auto: { key: c.key, t0: c.t0, t1: c.t1, end: c.end, n: c.n } }));
/** A tracked run over [a, b) frames: channel proj = the picture's truth + noise (other pictures: 20), sem parts too. */
function runOver(pic, a, b, grid = FM, { sign = 1, value = truth } = {}) {
  const t = [], v = [], hx = [], px = [];
  for (let f = a; f < b; f++) { t.push(frameTime(f, grid)); const y = pic[f] >= 0 ? value(pic[f]) + noise(f) : 20; v.push(y); hx.push(y / 100); px.push(0.5); }
  const ch = (vals) => { const vv = Float32Array.from(vals); let lo = Infinity, hi = -Infinity; for (const y of vv) { lo = Math.min(lo, y); hi = Math.max(hi, y); } return { t: Float64Array.from(t), v: vv, min: lo, max: hi, scaled: Float32Array.from(vv, (y) => (y - lo) / (hi - lo || 1)) }; };
  const turns = { at: [], pos: [] };
  for (let f = a + 1; f < b - 1; f++) { const p = pic[f]; if (p === 5 || p === 15) { turns.at.push(frameTime(f, grid)); turns.pos.push(p === 5 ? 90 : 10); } }
  const pts = { at: Float64Array.from(turns.at), pos: Float64Array.from(turns.pos) };
  return { id: 'run1', n: 1, range: { start: frameTime(a, grid), end: frameTime(b, grid) }, scenes: [{ start_ms: frameTime(a, grid), end_ms: frameTime(b, grid), sign }], flips: [], channel: 'proj',
    channels: { proj: ch(v), sem_hips_x: ch(hx), sem_hips_y: ch(px) }, samples: { t: Float64Array.from(t), v: Float32Array.from(v) }, points0Primary: pts, points0: pts, points: pts, notes: [] };
}
const shotsOf = (cuts, grid = FM) => cuts.slice(0, -1).map((f, k) => ({ start_ms: frameTime(f, grid), end_ms: frameTime(cuts[k + 1], grid) }));
/** frames: shot 0 = 30 unique, the loop 5 passes (frames 30-129), 20 unique; shot 1 = 150 unique; shot 2 = the loop from
 *  picture `start` for `len` frames (twos: each picture held 2 frames), then unique to 420. */
function story({ start = 7, len = 90, twos = false } = {}) {
  const pic = new Array(420).fill(-1);
  for (let f = 30; f < 130; f++) pic[f] = (f - 30) % F;
  for (let f = 300, k = 0; f < 300 + len; f++, k++) pic[f] = (start + (twos ? Math.floor(k / 2) : k)) % F;
  if (twos) for (let f = 30, k = 0; f < 130; f++, k++) pic[f] = Math.floor(k / 2) % F;   // the source on twos too (the same drawings)
  let u = 100; for (let f = 0; f < 420; f++) if (pic[f] < 0) pic[f] = u++;   // unique pictures: buckets of one occurrence
  const ix = video(pic.map((p) => (p >= 100 ? -1 : p)));
  return { pic: pic.map((p) => (p >= 100 ? -1 : p)), ix };
}
const err = (d, pic) => { let m = 0, n = 0; d.channels.proj.v.forEach((y, x) => { if (y !== y) return; const f = Math.round(d.ts[x] / FM), p = pic[f]; if (p < 0) return; m = Math.max(m, Math.abs(y - truth(p))); n++; }); return { m, n }; };

test('exact repeats: shot 2 (another start phase, last pass cut short) filled from shot 0; equals truth within the tracker noise at every phase', () => {
  const { pic, ix } = story(), loops = loopsOf(ix), shots = shotsOf([0, 150, 300, 420]), S = runOver(pic, 0, 150);
  const want = fillTargets({ shots, ix, loops, runs: [S] });
  assert.equal(want.length, 1);
  assert.equal(want[0].i, 2); assert.equal(want[0].j, 0); assert.equal(want[0].plan.kind, 'exact');
  const d = deriveFill(S, want[0], { shots, ix, loops });
  const e = err(d, pic);
  assert.equal(e.n, 90, 'every frame of the replayed loop has a value');
  assert.ok(e.m < 2.5, `max error ${e.m.toFixed(2)} (noise 2; averaged passes)`);
  assert.ok(d.info.avg, '5 clean passes: the average (S\'s own loop decision)');
  assert.equal(d.range.start, frameTime(300, FM)); assert.equal(d.range.end, frameTime(390, FM));
  assert.ok(d.channels.proj.v.slice(-25).every((y) => y !== y), 'the non-loop frames after it stay empty');
  // the sidecar's points: S's turns at the same pictures (5 = 90, 15 = 10)
  for (let q = 0; q < d.points0Primary.at.length; q++) { const f = Math.round(d.points0Primary.at[q] / FM); assert.equal(pic[f], d.points0Primary.pos[q] === 90 ? 5 : 15, `point ${q} at frame ${f}`); }
  assert.ok(d.points0Primary.at.length >= 8);
  assert.equal(d.info.n, 4.5);
  assert.equal(fillWords(d.info, '1').name, 'looped from shot 1');
  assert.match(fillWords(d.info, '1').what, /4\.5 passes · exact repeats · averaged/);
});

// paw-mawd (dev/linkfill-check.mjs): the fake tracker's lost frames cost its points a turn in some passes; when the cleanest
// pass by the signal was one of them, the fill took one point per pass (all one depth: a flat line, 2 points composed)
test('the pass whose points go to the fill has the usual number of them (a pass missing a turn is not taken)', () => {
  const { pic, ix } = story(), loops = loopsOf(ix), shots = shotsOf([0, 150, 300, 420]), S0 = runOver(pic, 0, 150);
  const w = fillTargets({ shots, ix, loops, runs: [S0] })[0], k0 = deriveFill(S0, w, { shots, ix, loops }).info.pass, p = w.plan.passes[k0];
  // the cleanest pass loses its first turn (the signal unchanged: it stays the cleanest by the signal)
  const drop = S0.points0Primary.at.findIndex((t) => t >= p.t0 && t < p.t1);
  const keep = (a) => Float64Array.from(Array.from(a).filter((_, q) => q !== drop)), pts = { at: keep(S0.points0Primary.at), pos: keep(S0.points0Primary.pos) };
  const S = { ...S0, points0Primary: pts, points0: pts, points: pts };
  const d = deriveFill(S, w, { shots, ix, loops });
  assert.notEqual(d.info.pass, k0, 'another pass gives the points');
  assert.ok(d.points0Primary.at.length >= 8, `two turns a pass (${d.points0Primary.at.length} points)`);
  assert.ok(new Set(d.points0Primary.pos).size === 2, 'both depths, not a flat line');
});

test('both directions: if shot 2 is tracked and shot 0 is not, shot 0 fills from shot 2; both tracked: neither', () => {
  const { pic, ix } = story(), loops = loopsOf(ix), shots = shotsOf([0, 150, 300, 420]);
  const S2 = { ...runOver(pic, 300, 420), id: 'run2', n: 2 };
  const w = fillTargets({ shots, ix, loops, runs: [S2] });
  assert.deepEqual(w.map((x) => [x.i, x.j]), [[0, 2]]);
  const d = deriveFill(S2, w[0], { shots, ix, loops });
  assert.ok(err(d, pic).m < 2.5);
  assert.equal(fillTargets({ shots, ix, loops, runs: [S2, runOver(pic, 0, 150)] }).length, 0);
  assert.equal(fillTargets({ shots: shots.map((s, k) => (k === 0 ? { ...s, linkfill: 'off' } : s)), ix, loops, runs: [S2] }).length, 0, 'dismissed: not refilled');
  // a live link of the target to another run: it has its own
  assert.equal(fillTargets({ shots, ix, loops, runs: [S2], linkOf: (i) => (i === 0 ? 'run9' : '') }).length, 0);
});

test('twos: the drawings held two frames each (source and target): the phase stalls on each, values right', () => {
  const { pic, ix } = story({ twos: true, len: 100 }), loops = loopsOf(ix), shots = shotsOf([0, 150, 300, 420]), S = runOver(pic, 0, 150);
  const w = fillTargets({ shots, ix, loops, runs: [S] });
  assert.equal(w.length, 1);
  const d = deriveFill(S, w[0], { shots, ix, loops });
  const e = err(d, pic);
  assert.ok(e.n >= 98 && e.m < 6, `twos: max error ${e.m.toFixed(2)} over ${e.n}`);
});

test('a flipped stretch in the source maps by phase onto every pass of the target', () => {
  const { pic, ix } = story(), loops = loopsOf(ix), shots = shotsOf([0, 150, 300, 420]);
  // S flipped over pictures 0-9 of its second pass (frames 50-59): an averaged loop's stretch applies in every pass (loopFlips)
  const S = { ...runOver(pic, 0, 150), dir: { whole: new Set(), partial: [[frameTime(50, FM), frameTime(60, FM)]] } };
  const d = deriveFill(S, fillTargets({ shots, ix, loops, runs: [S] })[0], { shots, ix, loops });
  assert.ok(d.dirMap.length >= 4, `stretches on the target: ${JSON.stringify(d.dirMap)}`);
  for (const [a, b] of d.dirMap) for (let t = a; t < b; t += FM) { const p = pic[Math.round(t / FM)]; assert.ok(p >= 0 && p <= 9, `flipped frame shows picture ${p}`); }
  // a whole-scene flip: the whole target
  const W = { ...S, dir: { whole: new Set([0]), partial: [] } }, dw = deriveFill(W, fillTargets({ shots, ix, loops, runs: [W] })[0], { shots, ix, loops });
  assert.deepEqual(dw.dirMap, [[dw.range.start, dw.range.end]]);
});

test('variable frame rate: sampled on the target\'s real frame times', () => {
  const times = Array.from({ length: 420 }, (_, f) => Math.round(f * FM + (f % 3 === 1 ? 7 : 0)));
  const grid = makeClock({ times, durationMs: 420 * FM });
  const pic = story().pic, ix = video(pic, grid), loops = loopsOf(ix, grid), shots = shotsOf([0, 150, 300, 420], grid), S = runOver(pic, 0, 150, grid);
  const w = fillTargets({ shots, ix, loops, grid, runs: [S] });
  assert.equal(w.length, 1);
  const d = deriveFill(S, w[0], { shots, ix, loops, grid });
  for (let x = 0; x < d.ts.length; x++) assert.equal(d.ts[x], times[300 + x], 'frame times = the clock\'s');
  let m = 0; d.channels.proj.v.forEach((y, x) => { if (y === y) m = Math.max(m, Math.abs(y - truth(pic[300 + x]))); });
  assert.ok(m < 2.5, `VFR max error ${m.toFixed(2)}`);
});

test('crop link: periods 2:1 both ways (cropIdx), and a derived crop fill with a shift', () => {
  // T = B with twice A's period: B's 18 frames take A's 9-frame cycle twice
  assert.deepEqual(Array.from({ length: 18 }, (_, c) => cropIdx(c, { pS: 9, pT: 18, shift: 7, tIsB: true })[0]), Array.from({ length: 18 }, (_, c) => (c + 7) % 9));
  // T = A (9) from S = B (18): T's frame takes the mean of B's two frames that show it
  assert.deepEqual(cropIdx(0, { pS: 18, pT: 9, shift: 7, tIsB: false }), [2, 11]);
  // T = B (9) from S = A (18): A's frames (k + shift) and (k + 9 + shift)
  assert.deepEqual(cropIdx(3, { pS: 18, pT: 9, shift: 2, tIsB: true }), [5, 14]);
  // a derived crop fill: S = shot 0 (A, the 20-frame loop), T = shot 2's re-framed copy: its own pictures (no exact repeat
  // of S's), period 20, starting at S's picture 7
  const pic = new Array(420).fill(-1);
  for (let f = 30; f < 130; f++) pic[f] = (f - 30) % F;
  for (let f = 300; f < 390; f++) pic[f] = 20 + ((f - 300) % F);   // other pictures: the crop
  const ix = video(pic), loops = loopsOf(ix), shots = shotsOf([0, 150, 300, 420]), S = runOver(pic, 0, 150);
  const lA = loops.find((l) => l.t0 < 150 * FM), lB = loops.find((l) => l.t0 >= 300 * FM);
  const crops = [{ a: { start_ms: shots[0].start_ms, end_ms: shots[0].end_ms }, b: { start_ms: shots[2].start_ms, end_ms: shots[2].end_ms }, kind: 'crop', scale: 1.8, tighter: 'b',
    loops: [{ a: lA.auto.key, b: lB.auto.key, periodA: 20, periodB: 20, shift: 7, ratio: 1, score: 0.95 }] }];
  const w = fillTargets({ shots, ix, loops, crops, runs: [S] });
  assert.equal(w.length, 1); assert.equal(w[0].plan.kind, 'crop');
  const d = deriveFill(S, w[0], { shots, ix, loops });
  let m = 0, n = 0; d.channels.proj.v.forEach((y, x) => { if (y !== y) return; n++; const f = Math.round(d.ts[x] / FM); m = Math.max(m, Math.abs(y - truth((f - 300 + 7) % F))); });
  assert.ok(n >= 85 && m < 2.5, `crop: max error ${m.toFixed(2)} over ${n}`);
  assert.match(fillWords(d.info, '1').what, /cropped ×1\.8/);
});

test('averaging order: a source whose passes differ gives its cleanest pass and the guard holds the fill back', () => {
  const { pic, ix } = story(), loops = loopsOf(ix), shots = shotsOf([0, 150, 300, 420]);
  // every pass of the source a different action (the same pictures, another phase of motion): passes differ, nothing averaged
  const pass = (f) => Math.max(0, Math.floor((f - 37) / F)), act = (f, p) => truth((p + 6 * pass(f)) % F);
  const S = runOver(pic, 0, 150);
  S.channels.proj.v = Float32Array.from(S.channels.proj.v, (y, x) => (pic[x] >= 0 ? act(x, pic[x]) + noise(x) : y));
  const d = deriveFill(S, fillTargets({ shots, ix, loops, runs: [S] })[0], { shots, ix, loops });
  assert.equal(d.info.avg, false);
  assert.equal(d.info.ok, false, 'held back: offered, not filled');
  assert.match(d.info.why, /passes differ/);
  // one of the source's own passes, as it is (never a mix of them)
  let m = 0; d.channels.proj.v.forEach((y, x) => { if (y === y) m = Math.max(m, Math.abs(y - truth((pic[300 + x] + 6 * d.info.pass) % F))); });
  assert.ok(m < 2.5, `pass ${d.info.pass}: ${m.toFixed(2)}`);
});

test('level carry: T\'s points sit at S\'s depth level and range', () => {
  const ref = levelRef({ at: [0, 1, 2, 3, 4, 5], pos: [20, 60, 20, 60, 20, 60] }, -Infinity, Infinity);
  const out = carryLevel({ at: Float64Array.from([0, 1, 2, 3, 4, 5]), pos: Float64Array.from([0, 100, 0, 100, 0, 100]) }, ref);
  assert.deepEqual(Array.from(out.pos), [20, 60, 20, 60, 20, 60]);
  const same = { at: Float64Array.from([0, 1, 2, 3]), pos: Float64Array.from([20, 60, 20, 60]) };
  assert.equal(carryLevel(same, ref), same);
  assert.equal(fillId({ start_ms: 1234.4 }), 'fill-1234');
});

test('crop 1:2 end to end: the target (period 10) takes the mean of the source\'s two halves (period 20, the second drawn +6)', () => {
  const pic = new Array(420).fill(-1);
  for (let f = 30; f < 130; f++) pic[f] = 20 + ((f - 30) % 20);   // S = B (period 20) in shot 0: other pictures than A's
  for (let f = 330; f < 420; f++) pic[f] = (f - 330) % 10;         // T = A (period 10) in shot 2
  const ix = video(pic), loops = loopsOf(ix), shots = shotsOf([0, 150, 300, 420]);
  const mA = (p) => 50 + 40 * Math.sin((2 * Math.PI * p) / 10), shift = 3;
  const S = runOver(pic, 0, 150, FM, { value: (p) => mA((p - 20 + shift) % 10) + ((p - 20) >= 10 ? 6 : 0) });
  const lA = loops.find((l) => l.t0 >= 300 * FM), lB = loops.find((l) => l.t0 < 150 * FM);
  const crops = [{ a: shots[2], b: shots[0], kind: 'crop', scale: 1.8, loops: [{ a: lA.auto.key, b: lB.auto.key, periodA: 10, periodB: 20, shift, ratio: 2, score: 0.95 }] }];
  const w = fillTargets({ shots, ix, loops, crops, runs: [S] });
  assert.equal(w.length, 1); assert.equal(w[0].plan.tIsB, false);
  const d = deriveFill(S, w[0], { shots, ix, loops });
  let m = 0, n = 0; d.channels.proj.v.forEach((y, x) => { if (y !== y) return; n++; m = Math.max(m, Math.abs(y - (mA(pic[Math.round(d.ts[x] / FM)]) + 3))); });
  assert.ok(n >= 85 && m < 2.5, `1:2 mean: max error ${m.toFixed(2)} over ${n}`);
});

test('loop-average fixes: a cut-short last pass keeps the period; a drawing shown twice per cycle never slides the phase a cycle', async () => {
  const { loopPasses, phaseMap } = await import('../src/lib/loop-average.js');
  // auto loop: one cycle 600 ms, 5 passes counted but the pictures stop 7 frames into the 5th
  const l = { id: 'a', t0: 1000, t1: 1667, auto: { key: '1:0', t0: 1000, t1: 1667, end: 4233, n: 5 } };
  const ps = loopPasses(l, FM);
  assert.equal(ps.length, 4); assert.ok(ps.every((p) => Math.abs(p.t1 - p.t0 - 667) <= 1), JSON.stringify(ps));
  // a 12-frame cycle reusing picture 1 at its 7th frame (0 1 2 3 4 5 1 6 7 8 9 10), 4 passes from frame 0
  const cyc = [0, 1, 2, 3, 4, 5, 1, 6, 7, 8, 9, 10], pic = Array.from({ length: 48 }, (_, f) => cyc[f % 12]);
  const ix = video(pic), ref = { t0: 0, t1: frameTime(12, FM) };
  const m = phaseMap(ix, ref, { t0: frameTime(12, FM), t1: frameTime(48, FM) }, FM);
  for (let f = 12; f < 48; f++) { const y = m.at(frameTime(f, FM)), want = frameTime(f - 12, FM); assert.ok(Math.abs(y - want) < 2, `frame ${f}: phase ${y} vs ${want}`); }
});
