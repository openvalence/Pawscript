// detail.js: the Detail scope (scene default, shot / area overrides), migration, merge / split, Simplify (paw-izk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailAt, detailSpans, setDetail, migrateDetail, sceneDetail, simplifyScript, spanShot } from '../src/lib/detail.js';
import { shapeAt } from '../src/lib/stroke-shape.js';
import { normScenes, mergeScenes, splitScene, toSaved, fromSaved } from '../src/features/timeline/shots.js';
import { runDerives } from '../src/lib/rederive.js';
import { turns } from '../src/lib/edit/strokes.js';

const shots = () => normScenes([{ start_ms: 0, end_ms: 10000 }, { start_ms: 10000, end_ms: 20000, join: true }, { start_ms: 20000, end_ms: 30000 }]);

test('scene default, shot override, area override: what governs each time', () => {
  let L = shots();
  assert.deepEqual(detailAt(L, 5000), { shape: 'render', sens: 50, level: 'scene', t0: 0, t1: 20000, lo: 0, hi: 1 }, 'defaults (paw-na9u: By render)');
  L = setDetail(L, 1, { shape: 'mid', sens: 70 });                                       // scene 1 default
  assert.equal(L[0].detail.shape, 'mid'); assert.deepEqual(L[0].detail, L[1].detail, 'on every shot of the scene');
  assert.equal(L[2].detail, undefined, 'the other scene keeps its own');
  L = setDetail(L, 1, { shape: 'turns' }, { t0: 10000, t1: 20000 });                    // shot 1.2 override
  L = setDetail(L, 0, { shape: 'free', sens: 90 }, { t0: 4000, t1: 6000 });              // an area in shot 1.1
  assert.equal(detailAt(L, 1000).level, 'scene'); assert.equal(detailAt(L, 1000).shape, 'mid');
  assert.deepEqual([detailAt(L, 5000).level, detailAt(L, 5000).shape], ['area', 'free']);
  assert.deepEqual([detailAt(L, 15000).level, detailAt(L, 15000).shape], ['shot', 'turns']);
  assert.equal(spanShot(L, { t0: 10000, t1: 20000 }), 1);
  assert.deepEqual(detailSpans(L, 0, 30000).map((s) => [s.t0, s.t1, s.shape]), [[0, 20000, 'mid'], [20000, 30000, 'render'], [4000, 6000, 'free'], [10000, 20000, 'turns']]);
  // an override over a span replaces what was under it; clipped at the scene
  const L2 = setDetail(L, 0, { shape: 'mid', sens: 10 }, { t0: 5000, t1: 25000 });
  assert.deepEqual(sceneDetail(L2, 0).spans.map((s) => [s.t0, s.t1, s.shape]), [[4000, 5000, 'free'], [5000, 20000, 'mid']]);
  assert.equal(detailAt(L2, 22000).level, 'scene', 'not into the next scene');
  // clearing: an area back to the scene default; the scene default back to the defaults
  const L3 = setDetail(L, 0, null, { t0: 0, t1: 10000 });
  assert.equal(detailAt(L3, 5000).level, 'scene'); assert.equal(detailAt(L3, 15000).level, 'shot');
  assert.equal(setDetail(L3, 0, null).every((s, k) => k === 2 || s.detail.shape === undefined), true);
  assert.equal(setDetail(L, 0, { shape: 'mid', sens: 70 }), L, 'no change: the same list');
});

test('save / load keeps it on the scene; a split gives each half its part; a merge keeps both scenes\' detail', () => {
  let L = setDetail(shots(), 0, { shape: 'turns' });
  L = setDetail(L, 2, { shape: 'free', sens: 0 }, { t0: 22000, t1: 24000 });
  const saved = toSaved(L);
  assert.deepEqual(saved[0].detail, { shape: 'turns', sens: 50 }); assert.equal(saved[0].shots[0].detail, undefined, 'saved once on the scene');
  assert.deepEqual(fromSaved(saved), L);
  const sp = splitScene(L, 15000);
  assert.equal(detailAt(sp, 16000).shape, 'turns', 'the split-off scene keeps the default');
  const m = mergeScenes(L, 0);   // scene 2 into scene 1: its default (hold) becomes a span over its shot, its area kept
  assert.ok(m, 'merged');
  assert.equal(detailAt(m, 5000).shape, 'turns');
  assert.deepEqual([detailAt(m, 21000).shape, detailAt(m, 23000).shape], ['hold', 'free']);
});

test('migration: an old shot Detail tolerance becomes its shot override; shots without follow the scene', () => {
  const L = migrateDetail(normScenes([{ start_ms: 0, end_ms: 1000, derive: { strokes: { detail: 8, minMs: 200 } } }, { start_ms: 1000, end_ms: 2000, join: true, derive: { strokes: { minMs: 100 } } }, { start_ms: 2000, end_ms: 3000, join: true, derive: { strokes: { detail: 0 } } }]));
  assert.deepEqual([detailAt(L, 500).level, detailAt(L, 500).shape, detailAt(L, 500).sens], ['shot', 'free', 76]);
  assert.equal(detailAt(L, 1500).level, 'scene');
  assert.deepEqual([detailAt(L, 2500).level, detailAt(L, 2500).shape], ['shot', 'turns']);
  assert.deepEqual(L[0].derive, { strokes: { minMs: 200 } }, 'the tolerance moved off the shot, the rest stays (strokes still on)');
  assert.deepEqual(L[2].derive, { strokes: {} });
  assert.equal(migrateDetail(L), L, 'idempotent');
});

test('runDerives hands every run scene the Detail over its time (strokes step or not: paw-otoh)', () => {
  let L = shots().map((s) => ({ ...s, derive: { strokes: {} } }));
  L = setDetail(L, 0, { shape: 'mid', sens: 50 }, { t0: 2000, t1: 3000 });
  const run = { scenes: [{ start_ms: 0, end_ms: 20000 }, { start_ms: 20000, end_ms: 30000 }] };
  const d = runDerives(run, L);
  assert.deepEqual(d[0].detail.map((s) => s.shape), ['render', 'mid']);
  assert.deepEqual(d[1].detail, [{ t0: 20000, t1: 30000, shape: 'render', sens: 50 }]);
  assert.deepEqual(runDerives(run, shots()).map((d) => d.detail.map((s) => s.shape)), [['render'], ['render']], 'the classic path too (the default)');
  assert.deepEqual(runDerives(run, []), [], 'no shots: nothing');
});

test('Simplify to this detail: a dense, wobbly script back to turns + at most one midpoint per half + holds', () => {
  // 1 s halves: slow-in fast-out moves, a 1 s rest at the bottom every other stroke, a point every 33 ms with wobble
  const dense = [];
  for (let at = 0; at <= 12000; at += 33) {
    const c = Math.floor(at / 3000), u = (at % 3000) / 1000;
    let y = u < 1 ? (u < 0.7 ? 0.25 * u / 0.7 : 0.25 + 0.75 * (u - 0.7) / 0.3) : u < 2 ? 1 - (u - 1) : c % 2 ? 0 : 0;
    y = u >= 2 ? 0 : y;
    dense.push({ at, pos: Math.round(100 * y + 2 * Math.sin(at / 40)) });
  }
  const at = shapeAt({ shape: 'hold', sens: 50 });
  const out = simplifyScript(dense, 0, 12000, at);
  assert.ok(out.length < dense.length / 8, `${dense.length} -> ${out.length}`);
  const T = turns(out, 10).map((x) => x.i);
  for (let q = 1; q < T.length; q++) assert.ok(T[q] - T[q - 1] - 1 <= 2, `at most a hold + a midpoint between turns: ${JSON.stringify(out.slice(T[q - 1], T[q] + 1))}`);
  // the turns stay exactly where they were (time and depth): every top of the original is in the output; a held bottom
  // sits at its arrival (the first point of the rest) at the level of the original turn
  for (const t of turns(dense, 10).slice(1, -1)) {
    const o = dense[t.i];
    if (t.kind === 'top') assert.ok(out.some((p) => p.at === o.at && p.pos === o.pos), `top ${o.at}`);
    else assert.ok(out.some((p) => Math.abs(p.at - o.at) < 1200 && p.pos === o.pos), `bottom ${o.at}`);
  }
  assert.ok(out.some((p, k) => k && p.pos === out[k - 1].pos && p.at - out[k - 1].at > 600), 'the rest is turn + hold');
  assert.equal(simplifyScript(out, 0, 12000, at), out, 'idempotent');
  assert.deepEqual(simplifyScript(dense, 3000, 6000, at).filter((p) => p.at < 3000 || p.at > 6000), dense.filter((p) => p.at < 3000 || p.at > 6000), 'outside the span untouched');
  const tOnly = simplifyScript(dense, 0, 12000, shapeAt({ shape: 'turns' }));
  assert.ok(tOnly.length <= T.length + 2);
});

test('what plays: the finishing pass (Autorange on, a spurt) keeps the count and the monotonic halves of a shaped script', async () => {
  const { finalScript } = await import('../src/lib/finish.js');
  const base = [];   // per 1.6 s stroke: bottom, a midpoint (slow then fast), top, a hold at the top, then down
  for (let t = 0; t + 1600 <= 60000; t += 1600) base.push({ at: t, pos: 15 }, { at: t + 450, pos: 30 }, { at: t + 600, pos: 85 }, { at: t + 1200, pos: 85 });
  const sc = (a, b, tags) => ({ start_ms: a, end_ms: b, tags });
  const doc = { axes: { stroke: base }, scenes: [sc(0, 20000, ['anal', 'penetration']), sc(20000, 40000, ['anal', 'penetration']), sc(40000, 60000, ['anal', 'penetration'])], fx: [{ id: 'o', kind: 'orgasm', t0: 40000, t1: 60000, muted: true }], finish: { autorange: true } };   // a muted Orgasm modifier: Autorange's band, nothing played
  const out = finalScript(doc);
  assert.equal(out.length, base.length, 'no point added or dropped');
  assert.deepEqual(out.map((p) => p.at), base.map((p) => p.at), 'times kept');
  for (let k = 0; k + 3 < out.length; k += 4) {
    const [b, m, t, h] = out.slice(k, k + 4);
    assert.ok(b.pos <= m.pos && m.pos <= t.pos, `the in-move stays monotonic at ${b.at}: ${b.pos} ${m.pos} ${t.pos}`);
    if (Math.floor(t.at / 20000) === Math.floor(h.at / 20000)) assert.ok(Math.abs(h.pos - t.pos) <= 2, `the hold stays flat at ${t.at}: ${t.pos} -> ${h.pos}`);   // (across a scene cut the band may differ)
  }
});
