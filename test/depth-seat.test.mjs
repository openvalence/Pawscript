// paw-gy1r: the fused stroke's motion seated on a depth reference's level and size (lib/depth-seat.js), and what carries it
// downstream (fusion.js fusedChannel, strokes.js keepLevel, runs-channel.js carriers / the owner's knots, rederive fuseClean).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seatDepth, slowStats, bodyScale, CAM } from '../src/lib/depth-seat.js';
import { fusedChannel } from '../src/lib/fusion.js';
import { strokes } from '../src/lib/strokes.js';
import { pointsFromChannel, carriers } from '../src/lib/runs-channel.js';
import { fuseClean } from '../src/lib/rederive.js';
import { channelOf } from '../src/lib/runs.js';
import { DEPTH_CASES, CAM_CASES, T } from './fusion-synth.mjs';

const fin = Number.isFinite;
const N = 900, t = Array.from({ length: N }, (_, i) => (i * 1000) / 30);
const ph = (i) => (2 * Math.PI * t[i]) / 800;   // a stroke every 0.8 s
/** truth: big strokes about 0.5 to 15 s, then small ones at the deep end */
const truth = (i) => (t[i] < 15000 ? 0.5 + 0.5 * Math.sin(ph(i)) : 0.1 + 0.08 * Math.sin(ph(i)));
/** the fused motion: the same timing, its level gone and every stroke the same size (what fusion makes of it) */
const fused = Float64Array.from({ length: N }, (_, i) => Math.sin(ph(i)));
const stat = (x, a, b) => { const s = Array.from(x).slice(a, b).filter(fin).sort((p, q) => p - q), q = (p) => s[Math.floor(p * (s.length - 1))]; return { mid: q(0.5), size: q(0.95) - q(0.05) }; };
const peaksOf = (x) => { const out = []; for (let i = 1; i + 1 < x.length; i++) if (x[i] > x[i - 1] && x[i] >= x[i + 1]) out.push(i); return out; };

test('seated: the level and size of the reference, the timing of the fused motion', () => {
  const ref = Float64Array.from({ length: N }, (_, i) => truth(i));
  const s = seatDepth(t, fused, ref, { periodMs: 800 });
  assert.ok(s.v && s.used > 0.95 && s.r > 0.7, `used ${s.used} r ${s.r}`);
  const late = stat(s.v, 600, 900), early = stat(s.v, 60, 360);
  assert.ok(Math.abs(late.mid - 0.1) < 0.03, `small strokes sit at the deep end: ${late.mid}`);
  assert.ok(Math.abs(late.size - 0.16) < 0.05, `and stay small: ${late.size}`);
  assert.ok(Math.abs(early.mid - 0.5) < 0.05 && Math.abs(early.size - 1) < 0.15, `big strokes keep theirs: ${early.mid} ${early.size}`);
  // the turns stay where the fused motion has them (a slow affine map), away from the change
  const a = peaksOf(fused).filter((i) => i < 400 || i > 520), b = new Set(peaksOf(s.v));
  assert.ok(a.every((i) => b.has(i) || b.has(i - 1) || b.has(i + 1)), 'turns kept within a frame');
});

test("the reference's spikes, clipped floor and jitter do not come through (slow, robust statistics)", () => {
  const clean = Float64Array.from({ length: N }, (_, i) => truth(i));
  const rough = Float64Array.from(clean, (x, i) => Math.max(0.06, x) + (i % 21 === 0 ? 0.3 : 0) + 0.01 * Math.sin(i * 2.7));
  const a = seatDepth(t, fused, clean, { periodMs: 800 }), b = seatDepth(t, fused, rough, { periodMs: 800 });
  let worst = 0;
  for (let i = 0; i < N; i++) worst = Math.max(worst, Math.abs(a.v[i] - b.v[i]));
  assert.ok(worst < 0.12, `a spike every 0.7 s moves the seated signal by at most ${worst.toFixed(3)}`);
  // and the seated signal has no spike of its own: its frame-to-frame step stays the fused motion's
  const step = (x) => { let m = 0; for (let i = 1; i < N; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
  assert.ok(step(b.v) < step(a.v) + 0.02, `largest step ${step(b.v).toFixed(3)} vs ${step(a.v).toFixed(3)} on the clean reference`);
});

test('a reference that does not move with the stroke is not used, and says why; one that drops out is cross-faded', () => {
  const noise = Float64Array.from({ length: N }, (_, i) => 0.5 + 0.3 * Math.sin(i * 0.013) + 0.05 * Math.sin(i * 1.3));
  const s = seatDepth(t, fused, noise, { periodMs: 800 });
  assert.ok(!s.v && /does not move with the stroke/.test(s.why));
  assert.match(seatDepth(t, fused, new Float64Array(N).fill(NaN)).why, /seen on 0 %/);
  const gap = Float64Array.from({ length: N }, (_, i) => (i >= 300 && i < 500 ? NaN : truth(i)));
  const g = seatDepth(t, fused, gap, { periodMs: 800 });
  assert.ok(g.v.every(fin), 'no hole where the reference is gone');
  assert.ok(g.used > 0.6 && g.used < 0.9, `used ${g.used}`);
});

test('slowStats: median / p90-p10 / coverage, slow', () => {
  const x = Float64Array.from({ length: 600 }, (_, i) => (i < 300 ? 2 : 5) + Math.sin(i / 2));
  const s = slowStats(x, 90);
  assert.ok(Math.abs(s.mid[100] - 2) < 0.2 && Math.abs(s.mid[500] - 5) < 0.2);
  assert.ok(Math.abs(s.size[100] - 1.9) < 0.3 && s.cov[100] > 0.99);
});

/** level and size of points (pos, larger = out) per 4 s window against the truth (D -1..1 -> pos 0..100) */
function errVsTruth(P, D) {
  const w = [], at = Array.from(P.at), pos = Array.from(P.pos);
  const ip = (x) => { let k = 0; while (k + 1 < at.length && at[k + 1] <= x) k++; return k + 1 < at.length ? pos[k] + ((pos[k + 1] - pos[k]) * (x - at[k])) / (at[k + 1] - at[k] || 1) : NaN; };
  for (let a = 1000; a + 4000 <= T[T.length - 1]; a += 1000) {
    const g = [], h = [];
    for (let i = 0; i < T.length; i++) if (T[i] >= a && T[i] < a + 4000) { g.push(ip(T[i])); h.push(50 + 50 * D(i)); }
    const A = stat(g, 0, g.length), B = stat(h, 0, h.length);
    if (fin(A.mid)) w.push([Math.abs(A.mid - B.mid), Math.abs(A.size - B.size)]);
  }
  return { level: w.reduce((s, x) => s + x[0], 0) / w.length, size: w.reduce((s, x) => s + x[1], 0) / w.length };
}
const turnsOf = (P) => { const out = []; for (let i = 1; i + 1 < P.pos.length; i++) if ((P.pos[i] - P.pos[i - 1]) * (P.pos[i + 1] - P.pos[i]) < 0) out.push(P.at[i]); return out; };
function smart(s, depth) {
  const derives = [{ acts: ['anal', 'penetration'], ...(depth ? { fuse: { depth } } : {}) }];
  const f = fusedChannel(s.run, { aspect: s.aspect, derives });
  return { f, P: pointsFromChannel({ ...s.run, channels: { ...s.run.channels, fused: f } }, 'fused', { strokes: {} }) };
}

test('synthetic depth cases (fusion-synth DEPTH_CASES): level and size from the pair, the turns from fusion', () => {
  const C = Object.fromEntries(DEPTH_CASES.map((c) => [c.id, c.make()]));
  for (const id of ['d-knot-depth', 'd-drift', 'd-dropout']) {
    const s = C[id], a = smart(s, null), b = smart(s, 'pair'), ea = errVsTruth(a.P, s.truth), eb = errVsTruth(b.P, s.truth);
    assert.ok(b.f.depth[0].used > (id === 'd-dropout' ? 0.6 : 0.95), `${id}: used ${b.f.depth[0].used}`);
    assert.ok(eb.level < 0.6 * ea.level, `${id}: level error ${ea.level.toFixed(1)} -> ${eb.level.toFixed(1)}`);
    assert.ok(eb.size <= ea.size + (id === 'd-dropout' ? 3 : 1), `${id}: size error ${ea.size.toFixed(1)} -> ${eb.size.toFixed(1)}`);   // d-dropout: seated on 60 % of its frames
    // the turns: as many, each within 50 ms of the fused one
    const ta = turnsOf(a.P), tb = turnsOf(b.P), near = ta.filter((x) => tb.some((y) => Math.abs(x - y) <= 50)).length;
    assert.ok(Math.abs(ta.length - tb.length) <= 2 && near >= ta.length - 2, `${id}: turns ${ta.length} / ${tb.length}, ${near} kept`);
  }
  const k = errVsTruth(smart(C['d-knot-depth'], 'pair').P, C['d-knot-depth'].truth);
  assert.ok(k.level < 6, `knot scene level within ${k.level.toFixed(1)} pos`);
  // nothing to seat on: fusion's own, bit for bit, and the reason in the info
  const r = C['d-relative-only'], a = smart(r, null), b = smart(r, 'pair');
  assert.deepEqual(Array.from(b.P.pos), Array.from(a.P.pos));
  assert.match(b.f.info[0].depth.why, /no pair tracked/);
  assert.equal(b.f.depth[0].used, undefined);
});

test('strokes: a level step stays in the depth (keepLevel, and the default since paw-dnrv); undrift takes it out as drift', () => {
  const tt = Array.from({ length: 600 }, (_, i) => (i * 1000) / 30), v = tt.map((x, i) => (i < 300 ? 0.6 : 0.15) + (i < 300 ? 0.35 : 0.08) * Math.sin((2 * Math.PI * x) / 900));
  const lv = (P, a, b) => { const q = P.points.filter((p) => p.at >= a && p.at < b).map((p) => p.pos); return q.reduce((s, x) => s + x, 0) / q.length; };
  const keep = strokes(tt, v, { keepLevel: true, undrift: true }), plain = strokes(tt, v), drift = strokes(tt, v, { undrift: true });
  assert.ok(lv(keep, 12000, 19000) < 25, `kept deep: ${lv(keep, 12000, 19000)}`);
  assert.ok(lv(plain, 12000, 19000) < 25, `default keeps it: ${lv(plain, 12000, 19000)}`);
  assert.ok(lv(drift, 12000, 19000) > 35, `undrift re-centers: ${lv(drift, 12000, 19000)}`);
});

test("carriers: a seated fused scene shows its level (baseline off too); the owner's knots move it", () => {
  const s = DEPTH_CASES[0].make(), f = smart(s, 'pair').f, run = { ...s.run, channels: { ...s.run.channels, fused: f } };
  const link = { t0: 0, t1: T[T.length - 1] + 1, run: 'r', channel: 'fused' };
  const c = carriers(run, [link]);
  assert.equal(c.length, 1);
  assert.ok(c[0].level && c[0].mid.length >= 15, 'the level, one knot a second');
  const late = c[0].mid.filter(([ms]) => ms > 12000).map((k) => k[1]), early = c[0].mid.filter(([ms]) => ms < 8000).map((k) => k[1]);
  assert.ok(Math.max(...late) < Math.min(...early), 'the deep stretch has the lower level');
  assert.equal(carriers(s.run, [link]).length, 0, 'not seated: nothing drawn without a baseline');
  // knots at 0.9 (out) over the whole scene: the classic points ride there instead of the reference's level
  const knots = [[0, 0.9], [20000, 0.9]], P = pointsFromChannel(run, 'fused', { baseline: { mode: 'knots', knots } }), P0 = pointsFromChannel(run, 'fused', {});
  const mean = (Q) => { const q = Array.from(Q.pos).filter((_, j) => Q.at[j] > 12000); return q.reduce((a, b) => a + b, 0) / q.length; };
  assert.ok(mean(P0) < 35 && mean(P) > 60, `level ${mean(P0).toFixed(0)} -> ${mean(P).toFixed(0)} with the knots`);
  // baseline auto on a seated scene keeps the level (it would otherwise flatten it)
  const A = pointsFromChannel(run, 'fused', { baseline: { mode: 'auto' } });
  assert.ok(Math.abs(mean(A) - mean(P0)) < 5);
});

test('fuseClean keeps derive.fuse.depth (pick / pair / shaft), drops anything else', () => {
  assert.deepEqual(fuseClean({ depth: 'pair' }), { depth: 'pair' });
  assert.deepEqual(fuseClean({ depth: 'shaft', jit: { dir: true } }), { jit: { dir: true }, depth: 'shaft' });
  assert.equal(fuseClean({ depth: 'fusion' }), null);
  assert.equal(fuseClean({ depth: 7 }), null);
  void channelOf;
});

// ---- camera moves (owner: "during camera moves relativity and core needs to kinda re-calibrate") ----
/** level (median) and swing (p95 - p5) of points over [a, b), sampled at 30 Hz */
function stretchOf(P, a, b) {
  const at = Array.from(P.at), pos = Array.from(P.pos), x = [];
  for (let t2 = a; t2 < b; t2 += 1000 / 30) { let k = 0; while (k + 1 < at.length && at[k + 1] <= t2) k++; if (k + 1 < at.length) x.push(pos[k] + ((pos[k + 1] - pos[k]) * (t2 - at[k])) / (at[k + 1] - at[k] || 1)); }
  const s = stat(x, 0, x.length);
  return { level: s.mid, swing: s.size };
}
const around = (c, s, P) => [stretchOf(P, 1000, c.move[0] - 500), stretchOf(P, c.move[1] + 500, T[T.length - 1] - 1000)];

test('camera moves: a push-in changes neither the level nor the swing; a pan nothing; a zoom at depth stays at depth', () => {
  const C = Object.fromEntries(CAM_CASES.map((c) => [c.id, c]));
  const z = C['c-zoom'], s = z.make();
  const bs = bodyScale(s.run, T.map((_, i) => i), T, s.aspect);
  assert.ok(bs.s && bs.zoom > 1.35 && bs.zoom < 1.65, `body unit sees the 1.5x push-in: ${bs.zoom.toFixed(2)}`);
  assert.ok(bs.move.some((x) => x > 0.9) && bs.move.slice(0, 200).every((x) => x < 0.1), 'move = the push-in only');
  const [fa, fb] = around(z, s, smart(s, null).P);
  assert.ok(Math.abs(fb.swing / fa.swing - 1) < 0.15, `fused swing across the push-in ${fa.swing.toFixed(0)} -> ${fb.swing.toFixed(0)}`);
  const [la, lb] = around(z, s, smart(s, 'pair').P);
  assert.ok(Math.abs(lb.level - la.level) < 8 && Math.abs(lb.swing / la.swing - 1) < 0.2, `seated on the pair: level ${la.level.toFixed(0)} -> ${lb.level.toFixed(0)}, swing ${la.swing.toFixed(0)} -> ${lb.swing.toFixed(0)}`);
  // without the body units (the push-in read as the bodies moving apart): what it was
  const keep = { ...CAM }; CAM.ZOOM = Infinity; CAM.ABS_MOVE = 0;
  try { const [oa, ob] = around(z, s, smart(z.make(), 'pair').P); assert.ok(Math.abs(ob.level - oa.level) > 40, `old: ${oa.level.toFixed(0)} -> ${ob.level.toFixed(0)}`); } finally { Object.assign(CAM, keep); }
  const p = C['c-pan'], ps = p.make(), [pa, pb] = around(p, ps, smart(ps, 'pair').P);
  assert.ok(Math.abs(pb.level - pa.level) < 8 && Math.abs(pb.swing / pa.swing - 1) < 0.15, `pan: level ${pa.level.toFixed(0)} -> ${pb.level.toFixed(0)}, swing ${pa.swing.toFixed(0)} -> ${pb.swing.toFixed(0)}`);
  const d = C['c-zoom-depth'], ds = d.make(), [, db] = around(d, ds, smart(ds, 'pair').P);
  assert.ok(db.level < 35 && db.swing < 30, `zoom during the small strokes: they stay deep and small (level ${db.level.toFixed(0)}, swing ${db.swing.toFixed(0)})`);
  // nothing moves the camera in the depth cases: no body unit, nothing changes
  assert.equal(bodyScale(DEPTH_CASES[0].make().run, T.map((_, i) => i), T, 16 / 9).s, null);
});
