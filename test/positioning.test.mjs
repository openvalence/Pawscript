// paw-2lp7.1: a positioning range ("a character moving into position before starting the action") is still tracked, kept out
// of every range / level calibration, and the script eases through it. Nothing is stored but the region.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normScenes, toSaved } from '../src/features/timeline/shots.js';
import { normActs, addRegion, projectScenes, withCarried, withPositioning, positioningOf } from '../src/features/timeline/regions.js';
import { makeRun, newFrames, maskRun, cutPoints } from '../src/lib/runs.js';
import { channelPatch } from '../src/lib/runs-channel.js';
import { easeScript } from '../src/lib/scenes-continue.js';
import { strokes } from '../src/lib/strokes.js';
import { turnStats, rangePlan } from '../src/lib/autorange.js';
import { envOf } from '../src/lib/autorange-env.js';
import { deriveShot } from '../src/lib/six-axis.js';

const R = (kind, t0, t1, layer = 0, tags = [], x = {}) => ({ id: `${kind}${layer}_${t0}`, kind, t0, t1, layer, tags, ...x });
const SH = (lens) => { let t = 0; return normScenes(lens.map((n) => { const s = { start_ms: t, end_ms: t + n }; t += n; return s; })); };
/** What Doc's acts setter does (app/doc.svelte.js). */
const write = (L, acts) => { const a = normActs(acts); return { acts: a, scenes: withPositioning(withCarried(projectScenes(L, a), a), a) }; };

test('marking: a positioning range sits inside a shot under a main-line action without fighting it; the shots carry it, derived only', () => {
  const L = SH([6000, 6000]), act = R('act', 0, 12000, 0, ['anal', 'penetration']);
  const acts = addRegion([act], R('positioning', 1000, 3500));
  assert.equal(acts.length, 2);
  assert.deepEqual(acts.find((r) => r.kind === 'act'), act, 'the action keeps its whole span and layer');
  const w = write(L, acts);
  assert.deepEqual(w.scenes.map((s) => s.positioning ?? null), [[[1000, 3500]], null]);
  assert.deepEqual(positioningOf(w.scenes), [[1000, 3500]]);
  // a range across a cut: clipped per shot
  assert.deepEqual(write(L, [act, R('positioning', 5000, 7000)]).scenes.map((s) => s.positioning), [[[5000, 6000]], [[6000, 7000]]]);
  // a proposal does nothing until accepted
  assert.equal(write(L, [act, R('positioning', 1000, 3500, 0, [], { auto: true })]).scenes.some((s) => s.positioning), false);
  // unmarking clears it; nothing of it is saved
  assert.equal(write(w.scenes, [act]).scenes.some((s) => s.positioning), false);
  assert.ok(!JSON.stringify(toSaved(w.scenes)).includes('positioning'), 'never saved: only the region is');
  // no positioning anywhere: the very same list (every reader sees exactly what it saw before)
  const plain = write(L, [act]).scenes;
  assert.equal(withPositioning(plain, [act]), plain);
});

test('maskRun / cutPoints: gaps inside the ranges, the camera kept, the stored run untouched; none = the same objects', () => {
  const t = Array.from({ length: 100 }, (_, i) => i * 10);
  const ch = (f) => ({ t: Float64Array.from(t), v: Float32Array.from(t, f), scaled: Float32Array.from(t, () => 0.5) });
  const run = { range: { start: 0, end: 1000 }, channels: { g1_proj: ch((x) => x), cam_x: ch(() => 1) }, samples: { t: Float64Array.from(t), v: Float32Array.from(t, () => 2) } };
  assert.equal(maskRun(run, []), run);
  assert.equal(maskRun(run, [[2000, 3000]]), run, 'a range outside the run: the same run');
  const m = maskRun(run, [[200, 400]]);
  assert.ok(Number.isNaN(m.channels.g1_proj.v[25]) && Number.isNaN(m.channels.g1_proj.scaled[25]) && Number.isNaN(m.samples.v[30]));
  assert.equal(m.channels.g1_proj.v[19], 190); assert.equal(m.channels.g1_proj.v[40], 400);
  assert.equal(m.channels.cam_x, run.channels.cam_x, 'the camera is not the bodies');
  assert.equal(run.channels.g1_proj.v[25], 250, 'the stored channel stays as tracked');
  assert.equal(maskRun(run, [[200, 400]]).channels.g1_proj, m.channels.g1_proj, 'memoised per channel (fusion caches on it)');
  const p = { at: Float64Array.from([100, 250, 500]), pos: Float64Array.from([1, 2, 3]) };
  assert.equal(cutPoints(p, null), p);
  assert.deepEqual([...cutPoints(p, [[200, 400]]).at], [100, 500]);
});

// a lead-in: 3 s of a slow move into position (a 4-swing drift: 8 units down to the stroke's level), then 9 s of a uniform
// 1 Hz stroke of swing 2 (sin, +-1), 30 fps
const dt = 1000 / 30, pairs = [];
for (let ms = 0; ms < 12000; ms = Math.round(ms + dt)) {
  const lead = ms < 3000 ? 8 * (1 + Math.cos((Math.PI * ms) / 3000)) / 2 : 0;
  pairs.push([ms, lead + (ms >= 3000 ? Math.sin((2 * Math.PI * (ms - 3000)) / 1000) : 0)]);
}
const RUN = makeRun({ n: 1, tracker: { id: 'tapnext_points', name: 'TAPNext' }, params: { primary: 'auto' }, range: { start: 0, end: 12000 }, roi: null,
  result: { samples: pairs.map(([t]) => [t, 0.5]), points: [{ at: 0, pos: 50 }], scenes: [{ start_ms: 0, end_ms: 12000, sign: 1 }], channels: { g1_proj: pairs } }, frames: newFrames(), runs: [] });
/** Turn-to-turn swings of points after t (median), and how many points fall in [a, b). */
const swing = (p, t) => { const s = []; for (let j = 1; j < p.at.length; j++) if (p.at[j - 1] >= t) s.push(Math.abs(p.pos[j] - p.pos[j - 1])); s.sort((x, y) => x - y); return s[s.length >> 1]; };
const inside = (p, a, b) => [...p.at].filter((x) => x >= a && x < b).length;

test('composition: the lead-in no longer squashes the strokes after it; no point inside; no mask = bit for bit as before', () => {
  for (const [label, ctx] of [['as tracked (fit run)', {}], ['the strokes step', { derives: [{ strokes: {} }] }]]) {
    const off = channelPatch(RUN, 'g1_proj', {}, [], ctx).points0, on = channelPatch(RUN, 'g1_proj', {}, [], { ...ctx, mask: [[0, 3000]] }).points0;
    const same = channelPatch(RUN, 'g1_proj', {}, [], { ...ctx, mask: [] }).points0;
    assert.deepEqual([[...same.at], [...same.pos]], [[...off.at], [...off.pos]], `${label}: an empty mask changes nothing`);
    assert.equal(inside(on, 0, 3000), 0, `${label}: no point inside the range (the ease goes there)`);
    assert.ok(swing(on, 3300) >= swing(off, 3300), `${label}: strokes after the lead-in ${swing(off, 3300)} -> ${swing(on, 3300)}`);
    if (!ctx.derives) assert.ok(swing(on, 3300) >= 2 * swing(off, 3300), `${label}: the run's range no longer spans the lead-in (${swing(off, 3300)} -> ${swing(on, 3300)})`);
  }
  // the sidecar's own points (scene on 'primary'): kept, only the ones inside go
  const pr = channelPatch(RUN, 'primary', {}, [], { mask: [[0, 3000]] }).points0;
  assert.equal(pr.at.length, 0);
  assert.equal(channelPatch(RUN, 'primary', {}, [], {}).points0, RUN.points0);
});

test('paw-2lp7.15: the stretches either side of a positioning range keep ONE calibration (real size kept); any other gap keeps its own', () => {
  const t = [], v = [];
  for (let ms = 0; ms < 12000; ms = Math.round(ms + 1000 / 30)) { t.push(ms); v.push(ms >= 3000 && ms < 6000 ? NaN : (ms < 3000 ? 1 : 0.5) * Math.sin((2 * Math.PI * ms) / 1000)); }
  const sw = (pts, a, b) => { const q = pts.filter((p) => p.at >= a && p.at < b && p.why === 'turn'); const s = q.slice(1).map((p, i) => Math.abs(p.pos - q[i].pos)).sort((x, y) => x - y); return s[s.length >> 1]; };
  const own = strokes(t, v).points, one = strokes(t, v, { mask: [[3000, 6000]] }).points;
  assert.ok(sw(own, 300, 2900) >= 90 && sw(own, 6300, 12000) >= 90, `a plain gap: each side to full (${sw(own, 300, 2900)} / ${sw(own, 6300, 12000)})`);
  const r = sw(one, 6300, 12000) / sw(one, 300, 2900);
  assert.ok(Math.abs(r - 0.5) < 0.1, `over a positioning range: the half strokes stay half (${sw(one, 300, 2900)} / ${sw(one, 6300, 12000)})`);
  assert.deepEqual(strokes(t, v, { mask: [[20000, 21000]] }).points, own, 'a range elsewhere changes nothing');
});

test('easeScript: one slow move from the level before to the first stroke start, strictly inside, monotone', () => {
  const e = easeScript(1000, 4000, 20, 80);
  assert.ok(e.length >= 3 && e[0].at > 1000 && e.at(-1).at < 4000);
  assert.deepEqual([e[0].pos, e.at(-1).pos], [20, 80]);
  for (let k = 1; k < e.length; k++) assert.ok(e[k].pos >= e[k - 1].pos && e[k].at > e[k - 1].at);
  assert.deepEqual(easeScript(1000, 4000, null, 60).map((p) => p.pos), [60, 60], 'nothing before: held at the level after');
  assert.deepEqual(easeScript(1000, 4000, 30, null).map((p) => p.pos), [30, 30]);
  assert.deepEqual(easeScript(1000, 4000, null, null), []);
  assert.deepEqual(easeScript(1000, 1030, 10, 90), [], 'too short');
});

test('autorange and six-axis read no depth inside a positioning range', () => {
  const s = [];
  for (let t = 100, k = 0; t < 6000; t += 250, k++) s.push({ at: t, pos: t < 2000 ? (k % 2 ? 100 : 0) : k % 2 ? 70 : 30 });
  const all = turnStats(s, 0, 6000), sk = turnStats(s, 0, 6000, [[0, 2000]]);
  assert.deepEqual([all.min, all.max], [0, 100]);
  assert.deepEqual([sk.min, sk.max], [30, 70]);
  assert.deepEqual([envOf(s, 0, 6000, [[0, 2000]]).b, envOf(s, 0, 6000, [[0, 2000]]).T], [30, 70]);
  // a shot without positioning: its plan row has no skip key (the plan is what it was)
  const L = normScenes([{ start_ms: 0, end_ms: 6000, tags: ['anal', 'penetration'] }]);
  assert.ok(!('skip' in rangePlan(L, s)[0]));
  assert.deepEqual(rangePlan([{ ...L[0], positioning: [[0, 2000]] }], s)[0].skip, [[0, 2000]]);
  // six-axis: the range is a gap; coverage counts the rest of the shot
  const n = 300, t = Float64Array.from({ length: n }, (_, i) => i * dt), m = Float64Array.from(t, (x) => (x < 3000 ? 0.2 * x / 3000 : 0.01 * Math.sin((2 * Math.PI * x) / 1000)));
  const meas = { t, dt, s: Float64Array.from(t, (x) => Math.sin((2 * Math.PI * x) / 1000)), m: { across: m, horiz: m, vert: m, rot: m, scale: m, prof: m, aniso: m, anisoXY: m } };
  const a = deriveShot(meas, { view: 'side' }), b = deriveShot(meas, { view: 'side', skip: [[0, 3000]] });
  assert.ok(b.axes.surge.amp >= a.axes.surge.amp, `surge amplitude after the move: ${a.axes.surge.amp} -> ${b.axes.surge.amp}`);
  assert.deepEqual(deriveShot(meas, { view: 'side', skip: [] }), a, 'no range: the same');
});
