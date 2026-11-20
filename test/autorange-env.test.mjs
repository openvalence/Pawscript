// The Autorange band envelope (paw-2ud, src/lib/autorange-env.js): pieces finer than a scene, four corners per piece,
// keys, splits / merges, automatic pieces with a reason, overrides that survive a re-plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangePlan } from '../src/lib/autorange.js';
import { envelope, rangePass, pieceMaps, cornersOf, setCorners, moveLevel, moveSide, splitAt, splitAll, mergeWith, setPiece, resetSpan, addKey, moveKeys, deleteKeys, setEase, duplicateKeys, orphans, neighbourOf, MIN_GAP } from '../src/lib/autorange-env.js';
import { snapLevel, snapTime } from '../src/features/timeline/range-edit.js';
import { budget } from './perf.mjs';

const strokes = (t0, t1, half = 400, lo = 20, hi = 80) => { const s = []; let k = 0; for (let t = t0; t < t1; t += half) s.push({ at: t, pos: k++ % 2 ? hi : lo }); return s; };
const PEN = ['anal', 'penetration'];
// one scene of three joined shots (10 s each), the tags on every shot (as normScenes keeps them)
const scene3 = (tags = PEN) => [0, 1, 2].map((k) => ({ start_ms: k * 10000, end_ms: (k + 1) * 10000, tags, ...(k && { join: true }) }));
const base = strokes(0, 30000);
const ctx = (scenes, script = base, ov = {}, policy = {}) => { const plan = rangePlan(scenes, script, { policy }); return { plan, env: envelope(plan, script, { scenes, ...ov }) }; };
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

test('no overrides: the envelope is the plan (each shot\'s sliding band); one scene of alike shots = one depth piece', () => {
  const sc = scene3(), { plan, env } = ctx(sc);
  for (const r of plan) { const [lo, hi] = env.bandAt(r.t0 + 1); assert.ok(near(lo, r.lo) && near(hi, r.hi), `S${r.i + 1} ${lo}-${hi} vs ${r.lo}-${r.hi}`); }
  assert.equal(env.pieces.length, 1);
  assert.match(env.pieces[0].why[0], /scene S1/);
  assert.equal(env.pieces[0].rows.length, 3);
  // without overrides nothing hand-made shows, and no scenes = the old per-shot pieces
  assert.equal(envelope(plan, base).pieces.length, 3);
});

test('auto pieces: a shot with clearly other stroke depth maps alone (its own b..T), with the reason', () => {
  const sc = scene3(), s = [...strokes(0, 10000), ...strokes(10000, 20000, 400, 45, 55), ...strokes(20000, 30000)];
  const { env, plan } = ctx(sc, s);
  const own = env.pieces.find((p) => p.why[0].startsWith('its own depth'));
  assert.ok(own && own.t0 === 10000, JSON.stringify(env.pieces.map((p) => [p.t0, p.t1, p.why])));
  const maps = pieceMaps(s, plan, { scenes: sc });
  assert.equal(maps.find((m) => m.t0 === 10000).b, 45, 'the shallow shot measured on its own');
  // never without a reason: a little variation stays one piece
  const calm = [...strokes(0, 10000), ...strokes(10000, 20000, 400, 25, 75), ...strokes(20000, 30000)];
  assert.equal(ctx(sc, calm).env.pieces.length, 1);
});

test('auto pieces: an orgasm span inside a shot is its own piece with the orgasm band (eased in), the shot keeps its own', () => {
  const sc = scene3([...PEN, { id: 'orgasm', t0: 24000, t1: 28000 }]), { plan, env } = ctx(sc);
  assert.notEqual(plan[2].rule, 'orgasm', 'the shot keeps its build-up rule');
  const p = env.pieces.find((q) => q.t0 === 24000);
  assert.ok(p && p.why.includes('orgasm span'), JSON.stringify(env.pieces.map((q) => [q.t0, q.t1, q.why])));
  const [lo, hi] = env.bandAt(26000);
  assert.deepEqual([Math.round(lo), Math.round(hi)], plan[2].orgasm);
  const out = rangePass(base, plan, { scenes: sc });
  assert.ok(out.filter((q) => q.at > 25000 && q.at < 27500).every((q) => q.pos <= 47), 'inside the orgasm band (the knee)');
});

test('auto pieces: an idle span over part of a shot rests at the top (paw-f0u)', () => {
  const sc = scene3([...PEN, { id: 'idle', t0: 12000, t1: 16000 }]), { plan, env } = ctx(sc);
  assert.ok(env.pieces.some((p) => p.t0 === 12000 && p.why.includes('idle span')), JSON.stringify(env.pieces.map((q) => [q.t0, q.t1, q.why])));
  assert.ok(env.bandAt(14000)[0] >= 97);
  const out = rangePass(base, plan, { scenes: sc });
  assert.ok(out.filter((q) => q.at > 12500 && q.at < 15500).every((q) => q.pos >= 90), 'resting near the top');
});

test('four corners: each one moves alone, edges move two, the body four; the top stays above the bottom', () => {
  const sc = scene3(), { env } = ctx(sc), p = env.pieces[0], ov = { bands: [], keys: [] }, c = cornersOf(env, p);
  for (const k of ['lo0', 'hi0', 'lo1', 'hi1']) {
    const target = k.startsWith('hi') ? c[k] - 10 : c[k] + 10;
    const o = setCorners(ov, env, p, { [k]: target }), e2 = envelope(ctx(sc).plan, base, { scenes: sc, ...o }), c2 = cornersOf(e2, e2.pieces[0]);
    for (const j of ['lo0', 'hi0', 'lo1', 'hi1']) assert.ok(near(c2[j], j === k ? target : c[j]), `${k}: ${j} ${c2[j]} vs ${j === k ? target : c[j]}`);
  }
  // a ramp: start 60..100, end 20..90 (the owner's example)
  const o = setCorners(ov, env, p, { lo0: 60, hi0: 100, lo1: 20, hi1: 90 }), e = envelope(ctx(sc).plan, base, { scenes: sc, ...o });
  assert.deepEqual(Object.values(cornersOf(e, e.pieces[0])).map(Math.round), [60, 100, 20, 90]);
  const [lo, hi] = e.bandAt(15000);
  assert.ok(near(lo, 40, 1) && near(hi, 95, 1), `linear across the piece: ${lo}-${hi}`);
  // the bottom dragged past the top gives way under it, MIN_GAP below
  const x = setCorners(ov, env, p, { lo0: 99 }), ex = envelope(ctx(sc).plan, base, { scenes: sc, ...x }), cx = cornersOf(ex, ex.pieces[0]);
  assert.ok(cx.hi0 - cx.lo0 >= MIN_GAP - 0.01 && cx.hi0 <= 100);
  // body: all four by dv, stopped at 0 / 100
  const b = moveLevel(ov, env, p, 'body', -500), eb = envelope(ctx(sc).plan, base, { scenes: sc, ...b }), cb = cornersOf(eb, eb.pieces[0]);
  assert.ok(Math.min(cb.lo0, cb.lo1) <= 0.5 && cb.hi0 - cb.lo0 >= c.hi0 - c.lo0 - 1, 'shifted to the bottom, width kept');
});

test('split, drag the halves apart, merge back; sides move the shared boundary (Alt: a gap), clipped to the scene', () => {
  const sc = scene3(), { plan, env } = ctx(sc), p = env.pieces[0];
  let ov = splitAt({ bands: [], keys: [] }, env, p, 12000);
  let e = envelope(plan, base, { scenes: sc, ...ov });
  assert.deepEqual(e.pieces.map((q) => [q.t0, q.t1]), [[0, 11999], [12000, 29999]]);
  ov = moveLevel(ov, e, e.pieces[1], 'hi', -20); e = envelope(plan, base, { scenes: sc, ...ov });
  assert.ok(e.bandAt(20000)[1] < e.auto(20000)[1] - 19 && near(e.bandAt(5000)[1], e.auto(5000)[1]), 'only the right half moved');
  // side: the shared boundary goes along
  const s1 = moveSide(ov, e, e.pieces[0], 't1', 15000), es = envelope(plan, base, { scenes: sc, ...s1 });
  assert.deepEqual(es.pieces.map((q) => [q.t0, q.t1]), [[0, 15000], [15001, 29999]]);
  // detached: a gap, the pass eases across it (no point left unmapped there)
  const d = moveSide(ov, e, e.pieces[0], 't1', 9000, { detach: true }), ed = envelope(plan, base, { scenes: sc, ...d });
  assert.deepEqual(ed.pieces.map((q) => [q.t0, q.t1, !!q.hand]), [[0, 9000, true], [9001, 11999, false], [12000, 29999, true]], 'the stretch left behind is the auto band again, a piece of its own');
  const out = rangePass(base, plan, { scenes: sc, ...d }), mid = out.filter((q) => q.at > 9200 && q.at < 11800);
  assert.ok(mid.some((q, k) => q.pos !== base.filter((x) => x.at > 9200 && x.at < 11800)[k].pos), 'still mapped (eased on both sides)');
  // clipped at the scene end
  const c = moveSide(ov, e, e.pieces[1], 't1', 99999), ec = envelope(plan, base, { scenes: sc, ...c });
  assert.ok(ec.pieces[ec.pieces.length - 1].t1 <= 30000);
  // merge: one piece again, start corners from the left, end corners from the right
  const m = mergeWith(ov, e, e.pieces[0], 't1'), em = envelope(plan, base, { scenes: sc, ...m });
  assert.equal(em.pieces.length, 1);
  assert.ok(near(cornersOf(em, em.pieces[0]).hi1, cornersOf(e, e.pieces[1]).hi1));
  assert.equal(neighbourOf(em, em.pieces[0], 't1'), null);
});

test('split by shots / by spans, per-piece strength / keep / off, reset to auto', () => {
  const sc = scene3(), { plan, env } = ctx(sc), p = env.pieces[0];
  const ov = splitAll({ bands: [], keys: [] }, env, p, [10000, 20000]), e = envelope(plan, base, { scenes: sc, ...ov });
  assert.equal(e.pieces.length, 3);
  const st = setPiece(ov, e, e.pieces[1], { strength: 0 }), outS = rangePass(base, plan, { scenes: sc, ...st });
  assert.deepEqual(outS.filter((q) => q.at > 10600 && q.at < 19400), base.filter((q) => q.at > 10600 && q.at < 19400), 'strength 0: the points as they are');
  const off = setPiece(ov, e, e.pieces[2], { off: true }), eo = envelope(plan, base, { scenes: sc, ...off });
  assert.ok(eo.pieces[2].off && pieceMaps(base, plan, { scenes: sc, ...off }).length === 2);
  const r = resetSpan(st, 0, 30000);
  assert.deepEqual(r.bands, []);
});

test('keys: extra handles on an edge, 0 at the corners, eased per segment, moved / duplicated / deleted', () => {
  const sc = scene3(), { plan, env } = ctx(sc), p = env.pieces[0];
  let { ov, id } = addKey({ bands: [], keys: [] }, 'hi', 15000);
  ({ ov } = moveKeys(ov, env, [id], 0, -20));
  let e = envelope(plan, base, { scenes: sc, ...ov });
  assert.ok(near(e.edgeAt(15000)[1], e.bandAt(15000)[1] - 20), 'the key pulls the top down');
  assert.ok(near(e.edgeAt(p.t0)[1], e.bandAt(p.t0)[1]) && near(e.edgeAt(p.t1)[1], e.bandAt(p.t1)[1]), 'corners untouched');
  assert.ok(near(e.edgeAt(7500)[1], e.bandAt(7500)[1] - 10, 1), 'linear from the corner');
  const h = setEase(ov, ['hi:0'].concat([`hi:15000`]), 'hold'), eh = envelope(plan, base, { scenes: sc, ...h });
  assert.ok(near(eh.edgeAt(20000)[1], eh.bandAt(20000)[1] - 20), 'hold: flat after the key');
  const dup = duplicateKeys(ov, env, ['hi:15000'], 3000);
  assert.deepEqual(dup.ids, ['hi:18000']);
  assert.equal(deleteKeys(dup.ov, dup.ids).keys.length, 1);
  const out = rangePass(base, plan, { scenes: sc, ...ov });
  assert.ok(Math.max(...out.filter((q) => q.at > 14000 && q.at < 16000).map((q) => q.pos)) < Math.max(...rangePass(base, plan, { scenes: sc }).filter((q) => q.at > 14000 && q.at < 16000).map((q) => q.pos)));
});

test('overrides survive a re-plan (offsets ride on the new auto band); orphans are dropped and counted', () => {
  const sc = scene3(), { env } = ctx(sc), p = env.pieces[0];
  const ov = moveLevel({ bands: [], keys: [] }, env, p, 'hi', -15);
  const re = ctx(sc, base, ov, { offset: -10 });   // another policy: the auto band slides
  const q = re.env.pieces[0];
  for (const t of [q.t0, q.t1]) { const before = re.env.auto(t)[1], after = re.env.bandAt(t)[1]; assert.ok(near(after, Math.min(100, before - 15)), `the corner rides on the new auto band: ${after} vs ${before}`); }
  assert.notEqual(re.env.auto(q.t0)[1], env.auto(q.t0)[1], 'the auto band did move');
  const k = addKey(ov, 'lo', 5000).ov;
  const gone = orphans(k, [{ start_ms: 20000, end_ms: 30000, tags: PEN }]);
  assert.equal(gone.dropped, 2);
  assert.deepEqual(orphans(k, sc).dropped, 0);
});

test('snapping: frames (Shift off), cuts / span ends in reach, neighbour corner levels and round levels', () => {
  assert.equal(snapTime(10012, { frameMs: 33.3, targets: [10000], tolMs: 30 }), 10000);
  assert.equal(snapTime(10200, { frameMs: 40, targets: [10000], tolMs: 30 }), 10200);
  assert.equal(snapTime(10213, { frameMs: 40, targets: [], tolMs: 30 }), 10200);
  assert.equal(snapTime(10213, { frameMs: 40, targets: [], tolMs: 30, off: true }), 10213);
  assert.equal(snapLevel(61.2, { targets: [63], tol: 3 }), 63);
  assert.equal(snapLevel(49, { targets: [], tol: 3 }), 50);
  assert.equal(snapLevel(47.4, { targets: [], tol: 1.5 }), 47);
});

test('fast: an hour, 120 scenes of 3 shots, a key drag re-evaluates in well under a frame budget', () => {
  const s = []; for (let t = 0, k = 0; t < 3600000; t += 240, k++) s.push({ at: t, pos: k % 2 ? 60 + (k % 5) * 8 : 10 + (k % 3) * 7 });
  const sc = []; for (let t = 0, i = 0; t < 3600000; t += 10000, i++) sc.push({ start_ms: t, end_ms: t + 10000, tags: PEN, ...(i % 3 && { join: true }) });
  const plan = rangePlan(sc, s), ov = { bands: [], keys: [{ t: 15000, edge: 'hi', d: -10 }] };
  rangePass(s, plan, { scenes: sc, ...ov });
  const a = performance.now(); for (let k = 0; k < 5; k++) rangePass(s, plan, { scenes: sc, bands: [], keys: [{ t: 15000, edge: 'hi', d: -k }] });
  const ms = (performance.now() - a) / 5;
  budget(ms < 60, `${ms.toFixed(1)} ms per pass`);
});
