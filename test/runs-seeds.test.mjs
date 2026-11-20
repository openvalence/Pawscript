// paw-o74b.1, lib/runs-add.js: a part seeded again on another frame of a tracked take is merged as another seed of it and
// stitched (one group, no step at the handover); deleting a seed re-stitches from the tracks the run keeps; the .pawruns
// round trip and its size; fusion across a handover; who draws which frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedsOf, seedKey, mergeAdded, restitch, newForRun, ownsAt, ownerAt, splitSeeds } from '../src/lib/runs-add.js';
import { channelOf } from '../src/lib/runs.js';
import { encodeRuns, decodeRuns } from '../src/lib/runs-file.js';
import { fuseScene } from '../src/lib/fusion.js';

const SQ = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const G = (name, t_ms, poly = SQ(0.3, 0.3, 0.5, 0.5), extra = {}) => ({ name, poly, pinned: true, t_ms, who: 'c1', part: name.split('_')[1], ...extra });
const FM = 1000 / 30, T = Array.from({ length: 180 }, (_, i) => Math.round(i * FM)), A = 16 / 9;   // 0..6 s, one run scene
const stroke = (t) => Math.sin((2 * Math.PI * t * 1.1) / 1000);
const hips = (t) => [0.4 + 0.004 * Math.sin(t / 700), 0.45 - 0.03 * stroke(t)];   // the true image position
const OFF_A = [0.012, -0.01], OFF_B = [-0.02, 0.015];   // two paintings: their centroids sit a little apart
const cam = (t) => [0.002 * Math.sin(t / 900), 0];
function baseRun() {
  const ch = (f) => channelOf(T.map((t) => [t, f(t)]));
  const channels = {
    cam_x: ch((t) => cam(t)[0]), cam_y: ch((t) => cam(t)[1]),
    sem_c1_torso_x: ch(() => 0.4), sem_c1_torso_y: ch((t) => 0.3 + 0.01 * stroke(t)),
    sem_c1_hips_x: ch((t) => hips(t)[0] + OFF_A[0] - cam(t)[0]), sem_c1_hips_y: ch((t) => hips(t)[1] + OFF_A[1] - cam(t)[1]),
    sem_c1_hips_n: ch(() => 1), sem_c1_hips_scale: ch(() => 1), sem_c1_hips_proj: ch((t) => 0.5 + 0.5 * stroke(t)),
    sem_c2_hips_x: ch(() => 0.55), sem_c2_hips_y: ch((t) => 0.7 + 0.02 * stroke(t)),
  };
  const ov = T.map((t) => ({ points: [], boxes: [], pts: [[0.4, 0.3, 1, 1, 0, 4], [hips(t)[0], hips(t)[1], t < 3500 ? 1 : 0, 1, 0, 5]] }));
  return {
    id: 'run1', n: 1, tracker: 'tapnext_points', params: { axis: 'auto', gap_ms: 1000 }, range: { start: 0, end: 6000 }, channels, channel: 'primary',
    scenes: [{ start_ms: 0, end_ms: 6000, groups: { sem_c1_torso: { label: 'c1_torso', source: 'user', id: 4 }, sem_c1_hips: { label: 'c1_hips', source: 'user', id: 5 } } }],
    frames: { t: [...T], v: T.map(() => 0.5), ov }, groupSeeds: seedsOf([G('c1_torso', 500), G('c1_hips', 500)]), notes: [],
    samples: { t: Float64Array.from(T), v: new Float32Array(T.length) }, points: { at: new Float64Array(0), pos: new Float64Array(0) }, points0: null,
  };
}
// the groups_only call for c1_hips seeded again at 4000 ms (another painting), its points lost before 1500 ms
function seedResult(t_ms = 4000, from = 1500, off = OFF_B) {
  const kept = T.filter((t) => t >= from);
  return {
    result: {
      channels: {
        cam_x: kept.map((t) => [t, 0]), cam_y: kept.map((t) => [t, 0]),
        sem_c1_hips_x: kept.map((t) => [t, hips(t)[0] + off[0]]), sem_c1_hips_y: kept.map((t) => [t, hips(t)[1] + off[1]]),
        sem_c1_hips_n: kept.map((t) => [t, 0.8]), sem_c1_hips_scale: kept.map((t) => [t, 1.25]), sem_c1_hips_proj: kept.map((t) => [t, 0.5]),
      },
      scenes: [{ start_ms: from, end_ms: 6000, groups: { sem_c1_hips: { label: 'c1_hips', source: 'user', id: 4, points: 2 } } }],
    },
    frames: { t: kept, v: kept.map(() => 0.5), ov: kept.map((t) => ({ pts: [[hips(t)[0] + off[0], hips(t)[1] + off[1], 1, 1, 0, 4]] })) },
    groups: [G('c1_hips', t_ms, SQ(0.32, 0.31, 0.5, 0.52))], t_ms, frameMs: FM, aspect: A,
  };
}
const R = (own) => own && own.map((r) => r.map(Math.round));
const vel = (v, i) => Math.abs(v[i + 1] - v[i - 1]);

test('another seed of a part: one group, stitched without a step, the rest of the run untouched', () => {
  const run = baseRun(), m = mergeAdded(run, seedResult());
  assert.ok(!m.error, m.error);
  const p = m.patch, C = p.channels;
  assert.deepEqual(m.seeds, ['c1_hips']);
  for (const k of ['cam_x', 'cam_y', 'sem_c1_torso_x', 'sem_c1_torso_y', 'sem_c2_hips_x', 'sem_c2_hips_y']) assert.equal(C[k], run.channels[k], `${k}: the same object`);
  assert.equal(Object.keys(C).filter((k) => k.startsWith('sem_c1_hips')).length, 5, 'one hips group, no c1_hips2');
  const hs = p.groupSeeds.filter((s) => s.name === 'c1_hips');
  assert.deepEqual(hs.map((s) => [s.t_ms, s.id]), [[500, 5], [4000, 6]], 'the base seed keeps the points it had (id 5), the new one gets a free id');
  assert.ok(hs.every((s) => s.track?.ch?.x?.length), 'each seed keeps its own track');
  assert.deepEqual(hs.map((s) => R(s.own)), [[[0, 2233]], [[2267, T.at(-1)]]], 'handover half way between 500 and 4000 ms');
  assert.equal(p.scenes, run.scenes, 'no new record: one group');
  // no step: the centre's speed at the handover is no larger than elsewhere, and it stays on the first painting's track
  for (const s of ['x', 'y']) {
    const v = C['sem_c1_hips_' + s].v, j = T.findIndex((t) => t >= 2250);
    const at = Math.max(...Array.from({ length: 31 }, (_, q) => vel(v, j - 15 + q)));
    let rest = 0;
    for (let i = 1; i < T.length - 1; i++) if (Math.abs(T[i] - 2250) > 1000) rest = Math.max(rest, vel(v, i));
    assert.ok(at <= rest * 1.02 + 1e-7, `${s}: ${at} at the handover vs ${rest} elsewhere`);
    T.forEach((t, i) => assert.ok(Math.abs(v[i] + cam(t)[s === 'x' ? 0 : 1] - (hips(t)[s === 'x' ? 0 : 1] + OFF_A[s === 'x' ? 0 : 1])) < 2e-6, `${s} at ${t}`));
  }
  T.forEach((t, i) => assert.ok(Math.abs(C.sem_c1_hips_scale.v[i] - 1) < 1e-6, 'the scale aligned by its ratio'));
  const pj = Array.from(C.sem_c1_hips_proj.v);
  assert.ok(pj.every(Number.isFinite) && Math.min(...pj) === 0 && Math.max(...pj) === 1, '_proj recomputed from the stitched centre');
  // the points: the new seed's under id 6, drawn only where it owns the frames
  const merged = { ...run, ...p };
  assert.equal(ownsAt(merged, 6, 1000), false); assert.equal(ownsAt(merged, 6, 5000), true);
  assert.equal(ownsAt(merged, 5, 1000), true); assert.equal(ownsAt(merged, 5, 5000), false);
  assert.equal(ownsAt(merged, 4, 5000), true, 'a single-seed part: always');
  assert.equal(ownerAt(merged, 'c1_hips', 5000).t_ms, 4000);
  assert.equal(merged.frames.ov[150].pts.at(-1)[5], 6);
  assert.match(p.notes.at(-1).message, /c1_hips \(another seed\)/);
});

test('incremental: a third seed shrinks its neighbours\' spans; a failed add leaves the run as it was', () => {
  const run = baseRun(), r2 = { ...run, ...mergeAdded(run, seedResult()).patch };
  const m3 = mergeAdded(r2, seedResult(2000, 0, [0.005, 0.005]));
  assert.ok(!m3.error, m3.error);
  const hs = m3.patch.groupSeeds.filter((s) => s.name === 'c1_hips');
  assert.deepEqual(hs.map((s) => [s.t_ms, R(s.own)]), [[500, [[0, 1233]]], [4000, [[3033, T.at(-1)]]], [2000, [[1267, 3000]]]]);
  for (const k of ['sem_c1_torso_x', 'sem_c2_hips_y', 'cam_x']) assert.equal(m3.patch.channels[k], run.channels[k]);
  const before = JSON.stringify(r2.groupSeeds), ch0 = r2.channels.sem_c1_hips_x;
  assert.match(mergeAdded(r2, seedResult(4000)).error, /already has c1_hips on that frame/);
  assert.equal(JSON.stringify(r2.groupSeeds), before); assert.equal(r2.channels.sem_c1_hips_x, ch0);
  // the store's plan: another frame of a part the run has is new for it; the same frame is kept
  assert.deepEqual(newForRun([G('c1_hips', 500), G('c1_hips', 2000)], r2).fresh.map((g) => g.t_ms), [2000]);
});

test('deleting a seed re-stitches from the kept tracks: one seed left = its own track again; undo brings it back', () => {
  const run = baseRun(), merged = { ...run, ...mergeAdded(run, seedResult()).patch };
  const both = new Set([seedKey('c1_hips', 500), seedKey('c1_hips', 4000), seedKey('c1_torso', 500)]);
  assert.equal(restitch(merged, both, { aspect: A, frameMs: FM }), null, 'as it is: nothing to do');
  const one = restitch(merged, new Set([seedKey('c1_hips', 500), seedKey('c1_torso', 500)]), { aspect: A, frameMs: FM });
  for (const s of ['x', 'y', 'n', 'scale', 'proj']) {
    const a = run.channels['sem_c1_hips_' + s].v, b = one.channels['sem_c1_hips_' + s].v;
    a.forEach((x, i) => assert.ok(Math.abs(b[i] - x) <= 1e-6 * Math.max(1, Math.abs(x)), `${s}[${i}]: the single-seed signal`));
  }
  for (const k of ['sem_c1_torso_x', 'sem_c2_hips_x', 'cam_x']) assert.equal(one.channels[k], run.channels[k]);
  const back = { ...merged, ...one };
  assert.deepEqual(back.groupSeeds.filter((s) => s.name === 'c1_hips').map((s) => R(s.own)), [[[0, T.at(-1)]], null]);
  assert.equal(ownsAt(back, 6, 5000), false, 'the deleted seed\'s points are not drawn');
  const again = restitch(back, both, { aspect: A, frameMs: FM });
  merged.channels.sem_c1_hips_x.v.forEach((x, i) => assert.ok(Math.abs(again.channels.sem_c1_hips_x.v[i] - x) < 1e-6, 'undo: the stitch again'));
  // only the later seed: its own track (nothing before 1500 ms: a gap, never invented)
  const late = restitch(merged, new Set([seedKey('c1_hips', 4000)]), { aspect: A, frameMs: FM });
  T.forEach((t, i) => assert.equal(Number.isFinite(late.channels.sem_c1_hips_x.v[i]), t >= 1500, `${t}`));
});

test('.pawruns: the seeds and their tracks survive the file; what keeping the tracks costs', () => {
  const run = baseRun(), merged = { ...run, ...mergeAdded(run, seedResult()).patch, points0: run.points };
  const [back] = decodeRuns(encodeRuns([merged]));
  assert.deepEqual(back.groupSeeds, merged.groupSeeds);
  const one = restitch(back, new Set([seedKey('c1_hips', 500)]), { aspect: A, frameMs: FM });
  run.channels.sem_c1_hips_x.v.forEach((x, i) => assert.ok(Math.abs(one.channels.sem_c1_hips_x.v[i] - x) < 1e-6), 'a reopened run re-stitches from its file');
  // size: the tracks (5 suffixes, 180 + 135 frames) next to the run without them
  const bare = { ...merged, groupSeeds: merged.groupSeeds.map(({ track: _, ...s }) => s) };   // eslint-disable-line no-unused-vars
  const full = encodeRuns([merged]).length, without = encodeRuns([bare]).length, per = (full - without) / ((180 + 135) * 5);
  assert.ok(per < 12, `${per.toFixed(1)} bytes per stored value`);
  console.log(`# .pawruns: ${full} bytes with the seed tracks, ${without} without (+${full - without}: ${per.toFixed(1)} bytes per frame and suffix)`);
});

test('fusion reads the stitched part as one part: no step at the handover', () => {
  const run = baseRun(), merged = { ...run, ...mergeAdded(run, seedResult()).patch }, idx = T.map((_, i) => i);
  const a = fuseScene(run, idx, { aspect: A }).v, b = fuseScene(merged, idx, { aspect: A }).v;
  const d = Array.from(a, (x, i) => Math.abs(x - b[i]));
  assert.ok(Math.max(...d) < 0.02, `the fused stroke matches the single-seed one (max ${Math.max(...d)})`);
});

test('a fresh track: each take seeds on its earliest frame, every other seed (a part again too) added after, in time order', () => {
  const { main, later } = splitSeeds([G('c1_hips', 4000), G('c1_hips', 500), G('c1_torso', 500), G('c1_hips', 2000)]);
  assert.deepEqual(main.map((g) => [g.name, g.t_ms]), [['c1_hips', 500], ['c1_torso', 500]]);
  assert.deepEqual(later.map((g) => g.t_ms), [2000, 4000]);
});

test('six-axis: a group seeded twice is fitted per seed and stitched: the handover is no turn', async () => {
  const { measure } = await import('../src/lib/six-axis.js');
  const th = (t) => 0.25 * Math.sin(t / 450), ring = (r, a0, n = 8) => Array.from({ length: n }, (_, k) => [r, a0 + (2 * Math.PI * k) / n]);
  const RA = ring(0.05, 0), RB = ring(0.035, 0.3), RT = ring(0.04, 0.1);
  const at = (c, [r, a], ang) => [c[0] + (r * Math.cos(a + ang)) / A, c[1] + r * Math.sin(a + ang)];
  const cB = (t) => [0.4, 0.45 - 0.03 * stroke(t)], cT = () => [0.6, 0.6];
  const ov = T.map((t) => ({ pts: [
    ...RA.map((p) => [...at(cB(t), p, th(t)), t < 3500 ? 1 : 0, 1, 0, 5]),
    ...RB.map((p) => [...at(cB(t), p, th(t)), t >= 1500 ? 1 : 0, 1, 0, 6]),
    ...RT.map((p) => [...at(cT(t), p, 0), 1, 2, 0, 7]),
  ] }));
  const ch = (f) => channelOf(T.map((t) => [t, f(t)]));
  const run = { id: 'r', params: {}, frames: { t: [...T], v: T.map(() => 0), ov }, scenes: [{ start_ms: 0, end_ms: 6000, groups: { sem_c1_hips: { id: 5 }, sem_c2_hips: { id: 7 } } }],
    channels: { sem_c1_hips_x: ch((t) => cB(t)[0]), sem_c1_hips_y: ch((t) => cB(t)[1]), sem_c2_hips_x: ch(() => 0.6), sem_c2_hips_y: ch(() => 0.6) },
    groupSeeds: [{ name: 'c1_hips', t_ms: 500, id: 5, own: [[0, 2233]] }, { name: 'c1_hips', t_ms: 4000, id: 6, own: [[2267, 6000]] }, { name: 'c2_hips', t_ms: 500 }] };
  const m = measure(run, 0, 6000, { aspect: A }), rot = m.m.rot;
  assert.ok(Array.from(rot).every(Number.isFinite), 'measured over both seeds\' spans');
  const d = (i) => Math.abs(rot[i + 1] - rot[i]), j = m.t.findIndex((t) => t >= 2250);
  let rest = 0;
  for (let i = 0; i < rot.length - 1; i++) if (Math.abs(m.t[i] - 2250) > 800) rest = Math.max(rest, d(i));
  assert.ok(Math.max(...Array.from({ length: 30 }, (_, q) => d(j - 15 + q))) <= rest * 1.05, 'no jump at the handover');
  T.forEach((t, i) => assert.ok(Math.abs(rot[i] + th(t) - (rot[0] + th(0))) < 1e-6, `rot follows the turn at ${t}`));
  const one = measure({ ...run, groupSeeds: [] }, 0, 6000, { aspect: A }).m.rot;   // one point set (the record's id): blind once those points are gone
  assert.ok(Array.from(one).some((x) => !Number.isFinite(x)));
});

test('the blobs view: a part\'s seeds share its name; each seed\'s points drawn where it owns the frames, its own painting carried', async () => {
  const { frameBodies, semNames } = await import('../src/features/tracking/blobs.js');
  const run = baseRun(), merged = { ...run, ...mergeAdded(run, seedResult()).patch };
  const sn = semNames(merged);
  assert.equal(sn[4], 'c1_hips'); assert.equal(sn[5], 'c1_hips');
  const paint = [{ name: 'c1_hips', poly: SQ(0.3, 0.3, 0.5, 0.5), t_ms: 500 }, { name: 'c1_hips', poly: SQ(0.32, 0.31, 0.5, 0.52), t_ms: 4000 }];
  const at = (t) => frameBodies(merged.frames, T.indexOf(T.find((x) => x >= t)), { run: merged, paint, aspect: A }).S;
  const early = at(1000), late = at(5000);
  assert.ok(early[4] && !early[5], 'before the handover: the first seed\'s points');
  assert.ok(!late[4] && late[5], 'after it: the second seed\'s');
  assert.equal(late[5].name, 'c1_hips');
});

test('a part\'s seeds are stitched inside their take: never across a cut, even when one run scene spans both takes', () => {
  const run = { ...baseRun(), groupSeeds: [...seedsOf([G('c1_torso', 500), G('c1_hips', 500)]), ...seedsOf([G('c1_hips', 5000)])] };   // hips seeded in another take too
  assert.match(mergeAdded(run, seedResult(2000, 0, [0.005, 0.005])).error, /cannot tell apart/, 'without the take: two candidates');
  const m = mergeAdded(run, { ...seedResult(2000, 0, [0.005, 0.005]), take: [0, 3000] });
  assert.ok(!m.error, m.error);
  const hs = m.patch.groupSeeds.filter((s) => s.name === 'c1_hips');
  assert.deepEqual(hs.map((s) => [s.t_ms, !!s.track, s.take || null]), [[500, true, [0, 3000]], [5000, false, null], [2000, true, [0, 3000]]]);
  const a = run.channels.sem_c1_hips_x.v, b = m.patch.channels.sem_c1_hips_x.v;
  T.forEach((t, i) => { if (t >= 3000) assert.equal(b[i], a[i], `the other take untouched at ${t}`); });
  assert.ok(hs[2].own.every((r) => r[1] < 3000));
});

test('the track request never holds one part twice on one frame (an older project\'s twins: the later one)', async () => {
  const { trackGroups } = await import('../src/features/tracking/groups.js');
  const gs = [G('c1_hips', 500), G('c1_hips', 500, SQ(0.31, 0.3, 0.5, 0.5)), G('c1_hips', 4000), G('c1_tail', 500)];
  const r = trackGroups([{ start_ms: 0, end_ms: 6000, groups: gs }], 0, 6000);
  assert.deepEqual(r.map((g) => `${g.name}@${g.t_ms}:${g.poly[0][0]}`), ['c1_hips@500:0.31', 'c1_hips@4000:0.3', 'c1_tail@500:0.3']);
});
