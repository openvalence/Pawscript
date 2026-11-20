import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHow, typesOf, wmedian, HOW } from '../src/lib/fusion-how.js';
import { fusedChannel } from '../src/lib/fusion.js';
import { pointsFromChannel } from '../src/lib/runs-channel.js';
import { strokes } from '../src/lib/strokes.js';
import { subProf, PROF } from '../src/lib/stroke-shape.js';
import { track, howRun, layoutScore, ASPECT, FPS } from './how-synth.mjs';

const many = (n, s) => Array.from({ length: n }, () => ({ ...s }));
const fuse = (tr, o) => { const run = howRun(tr, o); return { run, ch: fusedChannel(run, { aspect: ASPECT }) }; };
/** the strokes step's points on the fused channel, with fusion's HOW (how = true) or without it */
const pts = (run, ch, how, strokesOpts = {}) => pointsFromChannel({ ...run, channels: { ...run.channels, fused: how ? ch : { ...ch, how: undefined } } }, 'fused', { strokes: strokesOpts });
const inner = (h) => h.turns.slice(1, -1);

test('evidence per part: a shoulder dwells at the deep turn and not at the top, a sine dwells nowhere', () => {
  const sh = fuse(track(many(12, { kind: 'shoulder', T: 600, rest: 0.4 })), { seed: 2 }).ch.info[0].how;
  const deep = inner(sh).filter((x) => x.kind < 0), top = inner(sh).filter((x) => x.kind > 0);
  assert.ok(deep.every((x) => x.dwell >= 0.45), `deep ${deep.map((x) => x.dwell)}`);
  assert.ok(top.every((x) => x.dwell < 0.32), `top ${top.map((x) => x.dwell)}`);
  assert.ok(deep.every((x) => x.by.length >= 2), 'several parts say the deep rest');
  const si = fuse(track(many(12, { kind: 'sine', T: 700 })), { seed: 2 }).ch.info[0].how;
  const imp = inner(si).map((x) => x.impact).sort((a, b) => a - b);
  assert.ok(inner(si).every((x) => x.dwell < 0.36), `sine ${inner(si).map((x) => x.dwell)}`);
  assert.ok(imp[imp.length >> 1] < 0.1 && imp.filter((x) => x >= 0.5).length <= 1, `sine impacts ${imp}`);
});

test('evidence per part: an impact rings the balls after the deep turn (strength from the swing), the top does not ring', () => {
  const h = fuse(track(many(12, { kind: 'impact', T: 700, rest: 0.45 })), { seed: 3 }).ch.info[0].how;
  const deep = inner(h).filter((x) => x.kind < 0), top = inner(h).filter((x) => x.kind > 0);
  assert.ok(deep.filter((x) => x.ring >= 0.5 && x.impact >= 0.5).length >= deep.length - 1, `deep ring ${deep.map((x) => x.ring)} impact ${deep.map((x) => x.impact)}`);
  assert.ok(deep.every((x) => x.ringBy.some((r) => r.id === 'c2_balls')), 'the balls say it');
  assert.ok(deep.filter((x) => x.strength > 0.1).length >= deep.length - 1);
  assert.ok(top.every((x) => x.ring < 0.3), `top ring ${top.map((x) => x.ring)}`);
  // without the swinging balls the same strokes have no ring, and a smaller impact
  const q = fuse(track(many(12, { kind: 'impact', T: 700, rest: 0.45 })), { seed: 3, ring: 0 }).ch.info[0].how;
  assert.ok(inner(q).filter((x) => x.ring >= 0.25).length <= 1, `no swing: ring ${inner(q).map((x) => x.ring)}`);
  const mean = (L) => L.reduce((s, x) => s + x.impact, 0) / L.length;
  assert.ok(mean(inner(q).filter((x) => x.kind < 0)) < mean(deep));
});

test('dwell: several parts stopping together count, one part stalling alone does not (say-weighted median)', () => {
  const n = 300, t = Array.from({ length: n }, (_, i) => Math.round((i * 1000) / FPS)), v = t.map((ms) => Math.sin((2 * Math.PI * ms) / 700));
  const voice = (id, a) => ({ id, label: id, role: 'core', a: Float64Array.from(a), lag: 0, w: 1, wr: 1, on: new Uint8Array(n).fill(1), fit: new Float64Array(n).fill(1), rx: new Float64Array(n), ry: new Float64Array(n), amp: 0.7 });
  const plain = readHow(t, v, [voice('a', v), voice('b', v), voice('c', v)]);
  // c stalls for 200 ms at every deep turn (only c)
  const stall = v.map((x, i) => { const ph = ((t[i] / 700) % 1 + 1) % 1; return ph > 0.7 && ph < 0.98 ? -1 : x; });
  const one = readHow(t, v, [voice('a', v), voice('b', v), voice('c', stall)]);
  const deep = (h) => inner(h).filter((x) => x.kind < 0).map((x) => x.dwell);
  assert.deepEqual(deep(one), deep(plain));
  const all = readHow(t, v, [voice('a', stall), voice('b', stall), voice('c', v)]);
  assert.ok(deep(all).every((d, k) => d > deep(plain)[k] + 0.1), `${deep(all)} vs ${deep(plain)}`);
  assert.equal(wmedian([0.1, 0.2, 0.9], [1, 1, 1]), 0.2);
  assert.equal(wmedian([0.1, 0.9], [1, 3]), 0.9);
});

test('types: pooled over the whole scene, a returning type is the same type, different strokes are their own type, stable across noise', () => {
  const list = [0, 1, 2, 3].flatMap((q) => many(6, q % 2 ? { kind: 'impact', T: 700, rest: 0.45 } : { kind: 'sine', T: 700 }));
  const counts = [];
  for (const seed of [1, 2, 3, 4, 5]) {
    const h = fuse(track(list), { seed }).ch.info[0].how;
    const big = h.types.filter((y) => y.n >= 4);
    counts.push(big.length);
    // the second sine stretch has the first's types, the second impact stretch the first impact's
    const at = (ms) => h.halves.find((x) => x.t0 <= ms && x.t1 > ms);
    const typeOf = (k, half) => at(300 + k * 700 + half * 350 + 100)?.type;
    assert.equal(typeOf(13, 0), typeOf(1, 0), `seed ${seed}: sine out-moves`);
    assert.equal(typeOf(19, 1), typeOf(7, 1), `seed ${seed}: impact in-moves`);
    assert.notEqual(typeOf(7, 1), typeOf(1, 1), `seed ${seed}: impact vs sine in-moves`);
  }
  assert.ok(counts.every((c) => c === counts[0]), `type counts ${counts}`);
  // typesOf alone: deterministic
  const hs = () => [0, 1, 2, 3, 4, 5].map((k) => ({ t0: k, dir: 1, T: k % 3 ? 300 : 600, A: 1, rest: 0, prof: new Float64Array(PROF).fill(k % 3 ? 0 : -0.2) }));
  const a = hs(), b = hs();
  typesOf(a); typesOf(b);
  assert.deepEqual(a.map((h) => h.type), b.map((h) => h.type));
  assert.equal(new Set(a.map((h) => h.type)).size, 2);
});

test('the Detail reads HOW: holds and midpoints on nearly every stroke that has them, none on those that do not, across seeds', () => {
  const cases = [
    ['sine', many(12, { kind: 'sine', T: 700 }), { holds: 0, mids: 0 }],
    ['impact', many(12, { kind: 'impact', T: 700, rest: 0.45 }), { holds: 10, mids: 10 }],
    ['slow-out', many(12, { kind: 'slowout', T: 800 }), { holds: 0, mids: 10 }],
    ['fast shoulder', many(16, { kind: 'shoulder', T: 500, rest: 0.45 }), { holds: 14, mids: 0 }],
    ['returning', [0, 1, 2, 3].flatMap((q) => many(6, q % 2 ? { kind: 'impact', T: 700, rest: 0.45 } : { kind: 'sine', T: 700 })), { holds: 11, mids: 9 }],
  ];
  for (const [id, list, want] of cases) for (const seed of [1, 2, 3, 4, 5]) {
    const tr = track(list), { run, ch } = fuse(tr, { seed }), r = layoutScore(tr, pts(run, ch, true));
    assert.ok(r.holdHit >= Math.min(want.holds, r.holdWant), `${id} seed ${seed}: holds ${r.holdHit}/${r.holdWant}`);
    assert.ok(r.midHit >= Math.min(want.mids, r.midWant), `${id} seed ${seed}: mids ${r.midHit}/${r.midWant}`);
    assert.ok(r.holdFalse <= 1 && r.midFalse <= 1, `${id} seed ${seed}: false holds ${r.holdFalse}, mids ${r.midFalse}`);
  }
});

test('turns stay exactly where they are: with or without HOW the same turns (a held turn inside its hold)', () => {
  for (const kind of ['impact', 'shoulder', 'sine']) {
    const tr = track(many(12, { kind, T: 700, rest: 0.45 })), { run, ch } = fuse(tr, { seed: 4 });
    const spans = (P) => { const o = []; for (let i = 0; i < P.at.length; i++) if (P.why[i] === 'turn' || P.why[i] === 'clamped') o.push([P.at[i], P.why[i + 1] === 'hold' ? P.at[i + 1] : P.at[i]]); return o; };
    const a = spans(pts(run, ch, true)), b = spans(pts(run, ch, false));
    assert.equal(a.length, b.length, kind);
    a.forEach(([t0, t1], k) => { const [u0, u1] = b[k]; assert.ok((t0 >= u0 && t0 <= u1) || (u0 >= t0 && u0 <= t1), `${kind}: turn ${k} ${t0}-${t1} vs ${u0}-${u1}`); });
  }
});

test('the sensitivity still scales how much evidence earns a point', () => {
  const tr = track(many(12, { kind: 'shoulder', T: 600, rest: 0.3 })), { run, ch } = fuse(tr, { seed: 1 });
  const holds = (sens) => layoutScore(tr, pts(run, ch, true, { sens })).holdHit + layoutScore(tr, pts(run, ch, true, { sens })).holdFalse;
  const h0 = holds(0), h50 = holds(50), h100 = holds(100);
  assert.ok(h0 <= h50 && h50 <= h100 && h0 < h100, `${h0} ${h50} ${h100}`);
});

test('fallback: no secondary part, a single part or no parts at all: the Detail is today\'s, on the signal alone', () => {
  const tr = track(many(10, { kind: 'impact', T: 700, rest: 0.45 }));
  // only the stroking parts: no part without a say in the depth -> HOW is described but not used
  const run = howRun(tr, { seed: 1, parts: ['c2_hips', 'c2_penis', 'c1_hips'] }), ch = fusedChannel(run, { aspect: ASPECT });
  assert.equal(ch.info[0].how.used, false);
  assert.equal(ch.how.turns.length, 0);
  assert.deepEqual(Array.from(pts(run, ch, true).at), Array.from(pts(run, ch, false).at));
  // one part: nothing to fuse
  assert.equal(fusedChannel(howRun(tr, { seed: 1, parts: ['c2_hips'] }), { aspect: ASPECT }), null);
  // a plain signal (a box tracker's) through the strokes step: no how, the same as before
  const v = tr.d.map((x) => x + 0.01 * Math.sin(x * 50));
  assert.deepEqual(strokes(tr.t, v, {}).points, strokes(tr.t, v, { how: { turns: [], halves: [] } }).points);
});

test('loops: the passes of a loop keep one identical layout with HOW', () => {
  // 4 passes of the same 3-stroke loop (impact, sine, shoulder), pictures repeating exactly
  const one = [{ kind: 'impact', T: 700, rest: 0.45 }, { kind: 'sine', T: 700 }, { kind: 'shoulder', T: 700, rest: 0.45 }];
  const tr = track([...one, ...one, ...one, ...one], { lead: 0 }), { run, ch } = fuse(tr, { seed: 2, jitter: 0 });
  const L = Math.round((2100 * FPS) / 1000), picAt = (ms) => Math.round((ms * FPS) / 1000) % L;
  const P = pointsFromChannel({ ...run, channels: { ...run.channels, fused: ch } }, 'fused', { strokes: {}, picAt });
  const pass = (k) => Array.from(P.at, (at, i) => [at - k * 2100, P.why[i]]).filter(([x]) => x >= 200 && x < 1900).map(([x, w]) => `${Math.round(x / 34)}${w}`);
  assert.ok(pass(1).some((x) => /hold|mid/.test(x)), 'the loop has detail');
  assert.deepEqual(pass(2), pass(1));
});

test('subProf: the identity on its own span, a resting end where it reaches past it', () => {
  const pr = Float64Array.from({ length: PROF }, (_, k) => -0.2 * Math.sin((Math.PI * (k + 1)) / (PROF + 1)));
  assert.ok(subProf(pr, 0, 1).every((x, k) => Math.abs(x - pr[k]) < 1e-12));
  const ext = subProf(new Float64Array(PROF), -1, 1);   // a straight move after a rest as long as itself
  assert.ok(ext[6] < -0.4 && Math.abs(ext[14] - (2 * (15 / 16) - 1 - 15 / 16)) < 1e-9);
  assert.equal(subProf(pr, 0.5, 0.5), null);
  assert.ok(HOW.TYPE.shape > 0);
});
