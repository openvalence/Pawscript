// paw-o74b, lib/runs-add.js: groups painted later on an already tracked shot, tracked alone (sidecar v4.45 groups_only)
// and merged into the run; fusion's join where such a part comes into view; the .pawruns round trip and restored runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupFp, seedsOf, runGroups, newForRun, splitSeeds, sidecarNames, mergeAdded, trackedPoly } from '../src/lib/runs-add.js';
import { channelOf } from '../src/lib/runs.js';
import { encodeRuns, decodeRuns } from '../src/lib/runs-file.js';
import { keepOf, runFromGhost } from '../src/lib/runs-channel.js';
import { fuseScene } from '../src/lib/fusion.js';
import { trackRequest } from '../src/lib/protocol.js';

const SQ = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const G = (name, t_ms, poly = SQ(0.1, 0.1, 0.2, 0.2), extra = {}) => ({ name, poly, pinned: true, t_ms, ...extra });

test('new for a run: by name, seed frame (another frame = another seed) and outline; a run tracked before groupSeeds counts its channels', () => {
  const hips = G('c1_hips', 1000), run = { groupSeeds: seedsOf([hips]), channels: {} };
  const r = newForRun([hips, G('c2_penis', 2500), G('c1_hips', 1000, SQ(0.1, 0.1, 0.3, 0.3))], run);
  assert.deepEqual(r.fresh.map((g) => g.name), ['c2_penis']);
  assert.deepEqual(r.kept.map((g) => g.name), ['c1_hips']);
  assert.deepEqual(r.changed.map((g) => g.poly[1][0]), [0.3], 'a repainted outline is changed, not new');
  assert.deepEqual(newForRun([G('c1_hips', 1400)], run).fresh.map((g) => g.t_ms), [1400], 'paw-o74b.1: another seed frame of the part: another seed, added');
  assert.equal(groupFp(hips), groupFp({ ...hips, t_ms: 9 }), 'the outline fingerprint ignores the frame');
  const old = { channels: { sem_c1_hips_x: {}, sem_c1_hips_y: {}, proj: {} } };   // no groupSeeds: frame / outline unknown
  assert.deepEqual([...runGroups(old).keys()], ['c1_hips']);
  assert.deepEqual(newForRun([G('c1_hips', 5000), G('c1_tail', 5000)], old).fresh.map((g) => g.name), ['c1_tail']);
});

test('a fresh track seeds each take on its earliest groups frame; the later frames are added after', () => {
  const gs = [G('a', 1000), G('b', 2500), G('c', 1000), G('d', 7000), G('e', 6000)];
  const { main, later } = splitSeeds(gs, [5000]);   // a hard cut at 5 s: two takes
  assert.deepEqual(main.map((g) => g.name), ['a', 'c', 'e']);
  assert.deepEqual(later.map((g) => g.name), ['b', 'd']);
  assert.deepEqual(splitSeeds([G('a', 10), G('b', 10)]).later, []);
});

test('the sidecar names (cli.parse_groups) for the request groups', () => {
  assert.deepEqual(sidecarNames([{ name: 'c1_tail2', who: 'c1', part: 'tail' }, { name: 'c2_hand_l', who: 'c2', part: 'hand', side: 'l' }, { name: 'Tail!' }, { name: 'c1_tail', who: 'c1', part: 'tail' }]),
    ['c1_tail', 'c2_hand_l', 'tail', 'c1_tail2']);
});

// ---- a synthetic run: 0..4 s at 30 fps, two run scenes (0-3 s, 3-4 s), one painted part (c1_torso, pinned id 4) ----
const FM = 1000 / 30, T = Array.from({ length: 120 }, (_, i) => Math.round(i * FM));
const camR = (t) => [0.01 * Math.sin(t / 700), 0.005 * Math.cos(t / 500)];
function baseRun() {
  const ch = (f) => channelOf(T.map((t) => [t, f(t)]));
  const channels = {
    cam_x: ch((t) => camR(t)[0]), cam_y: ch((t) => camR(t)[1]), centroid_x: ch(() => 0.5), centroid_y: ch((t) => 0.5 + 0.02 * Math.sin(t / 160)),
    sem_c1_torso_x: ch(() => 0.4), sem_c1_torso_y: ch((t) => 0.4 + 0.01 * Math.sin(t / 160)), sem_c1_torso_proj: ch((t) => 0.5 + 0.5 * Math.sin(t / 160)),
  };
  const ov = T.map((t) => ({ points: [[0.4, 0.4]], boxes: [], pts: [[0.4, 0.4, 1, 1, 0, 4]] }));
  return {
    id: 'run1', n: 1, tracker: 'tapnext_points', params: { axis: 'auto', gap_ms: 1000 }, range: { start: 0, end: 4000 }, channels, channel: 'primary',
    scenes: [{ start_ms: 0, end_ms: 3000, groups: { sem_c1_torso: { label: 'c1_torso', source: 'user', id: 4, points: 1 } } }, { start_ms: 3000, end_ms: 4000 }],
    frames: { t: [...T], v: T.map(() => 0.5), ov }, groupSeeds: seedsOf([G('c1_torso', 300)]), notes: [], samples: { t: Float64Array.from(T), v: new Float32Array(T.length) },
    points: { at: new Float64Array(0), pos: new Float64Array(0) }, points0: null,
  };
}
// the groups_only call's answer for c2_penis seeded at 2000 ms, kept 1500..2700 ms (lost before / after), its own camera estimate
const camA = (t) => [0.03, -0.02 + 0.001 * t / 1000];
const penis = (t) => [0.6 + 0.01 * Math.cos(t / 160), 0.7 + 0.03 * Math.sin(t / 160)];   // image position
function addResult() {
  const kept = T.filter((t) => t >= 1500 && t <= 2700);
  return {
    result: {
      channels: {
        cam_x: kept.map((t) => [t, camA(t)[0]]), cam_y: kept.map((t) => [t, camA(t)[1]]),
        sem_c2_penis_x: kept.map((t) => [t, penis(t)[0] - camA(t)[0]]), sem_c2_penis_y: kept.map((t) => [t, penis(t)[1] - camA(t)[1]]),
        sem_c2_penis_n: kept.map((t) => [t, 1]), sem_c2_penis_proj: kept.map((t) => [t, 0.5]), proj: kept.map((t) => [t, 0.3]),
      },
      scenes: [{ start_ms: 1500, end_ms: 2734, groups: { sem_c2_penis: { label: 'c2_penis', source: 'user', id: 4, points: 2 } } }],
    },
    frames: { t: kept, v: kept.map(() => 0.5), ov: kept.map((t) => ({ pts: [[penis(t)[0], penis(t)[1], 1, 1, 0, 4], [penis(t)[0] + 0.01, penis(t)[1], t < 2600 ? 1 : 0, 1, 0, 4]] })) },
    groups: [{ name: 'c2_penis', poly: SQ(0.55, 0.65, 0.65, 0.75), pinned: true, t_ms: 2000, who: 'c2', part: 'penis' }],
    t_ms: 2000, frameMs: FM, aspect: 16 / 9,
  };
}

test('the merge: aligned to the run frames, absent outside its span, the camera re-expressed, nothing else touched', () => {
  const run = baseRun(), before = Object.fromEntries(Object.entries(run.channels).map(([k, c]) => [k, Float32Array.from(c.v)]));
  const ov0 = run.frames.ov.slice(), m = mergeAdded(run, addResult());
  assert.ok(!m.error, m.error);
  const p = m.patch, C = p.channels;
  assert.deepEqual(m.names, ['c2_penis']);
  assert.deepEqual(m.span, [1500, T.filter((t) => t <= 2700).at(-1)]);
  for (const [k, c] of Object.entries(run.channels)) {
    assert.equal(C[k], c, `${k}: the same channel object`);
    assert.deepEqual(Array.from(c.v), Array.from(before[k]), `${k}: bit for bit`);
  }
  assert.equal(C.proj, undefined, "the call's own run-wide channels are not taken");
  for (const s of ['x', 'y', 'n', 'proj']) {
    const c = C['sem_c2_penis_' + s];
    assert.ok(c, s);
    assert.deepEqual(Array.from(c.t), T, `${s}: the run's frame times`);
    T.forEach((t, j) => assert.equal(Number.isFinite(c.v[j]), t >= 1500 && t <= 2700, `${s} at ${t}: ${c.v[j]}`));
  }
  const j = T.indexOf(T.find((t) => t >= 2000));
  assert.ok(Math.abs(C.sem_c2_penis_x.v[j] + C.cam_x.v[j] - penis(T[j])[0]) < 1e-5, 'image position = merged centre + the run camera');
  assert.ok(Math.abs(C.sem_c2_penis_y.v[j] + C.cam_y.v[j] - penis(T[j])[1]) < 1e-5);
  const pj = Array.from(C.sem_c2_penis_proj.v).filter((x) => x === x);
  assert.ok(Math.min(...pj) === 0 && Math.max(...pj) === 1, '_proj recomputed 0..1 over its span, not the call\'s 0.5');
  // points: fresh pinned id (4 is the torso's), appended in the run scene, the same count every frame there
  assert.equal(p.scenes[0].groups.sem_c2_penis.id, 5);
  assert.equal(p.scenes[0].groups.sem_c1_torso.id, 4);
  assert.equal(p.scenes[1], run.scenes[1]);
  T.forEach((t, i) => {
    const o = p.frames.ov[i];
    if (t >= 3000) { assert.equal(o, ov0[i], 'another run scene: untouched'); return; }
    assert.equal(o.pts.length, 3);
    assert.deepEqual(o.pts[0], ov0[i].pts[0], 'the run\'s own point first, as it was');
    assert.ok(o.pts.slice(1).every((q) => q[5] === 5 && q.length === 6));
    if (t < 1500 || t > 2700) assert.ok(o.pts.slice(1).every((q) => q[2] === 0), `${t}: not tracked here: invisible placeholders`);
    assert.equal(o.points.length + o.boxes.length, 3, 'points / boxes follow pts');
  });
  assert.equal(ov0[0].pts.length, 1, 'the old frames are never mutated');
  assert.deepEqual(p.groupSeeds.map((s) => [s.name, s.t_ms, !!s.span]), [['c1_torso', 300, false], ['c2_penis', 2000, true]]);
  assert.equal(p.notes.at(-1).code, 'groups_added');
  assert.match(mergeAdded({ ...run, ...p }, addResult()).error, /already has c2_penis/);
  assert.match(mergeAdded({ ...run, frames: null }, addResult()).error, /no stored frames/);
});

test('the merged run through the .pawruns file and as a restored run', () => {
  const run = baseRun(), m = mergeAdded(run, addResult()), merged = { ...run, ...m.patch, points0: run.points };
  const [back] = decodeRuns(encodeRuns([merged]));
  for (const k of Object.keys(merged.channels)) {
    const a = merged.channels[k], b = back.channels[k];
    assert.deepEqual(Array.from(b.t), Array.from(a.t), k);
    a.v.forEach((x, j) => assert.ok(x !== x ? b.v[j] !== b.v[j] : Math.abs(b.v[j] - x) < 1e-6 * Math.max(1, Math.abs(x)), `${k}[${j}]`));
  }
  assert.deepEqual(back.groupSeeds, merged.groupSeeds);
  assert.equal(back.scenes[0].groups.sem_c2_penis.id, 5);
  const i = T.indexOf(T.find((t) => t >= 2000));
  assert.deepEqual(back.frames.ov[i].pts.map((q) => q[5] ?? 0), [4, 5, 5], 'pinned ids survive the file');
  const g = { id: 'run1', name: '#1 TAPNext', source: { kind: 'tracker', tracker: 'tapnext_points', range: { t0: 0, t1: 4000 }, keep: keepOf(merged, ['sem_c2_penis_proj']) }, script: [] };
  const r = runFromGhost(g, []);
  assert.ok(r.restored);
  const c = r.channels.sem_c2_penis_proj;
  assert.ok(c && T.every((t, j) => Number.isFinite(c.v[j]) === (t >= 1500 && t <= 2700)), 'the restored run reads the added channel, absent outside its span');
  assert.ok(r.scenes[0].groups.sem_c2_penis);
});

test('fusion: a part that comes into view half way joins without a step (paw-o74b join ramp)', () => {
  const FPS = 30, N = 600, A = 16 / 9, TT = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / FPS));
  const stroke = (ms) => Math.sin((2 * Math.PI * ms * 1.1) / 1000);
  const mk = (app, spans, withPenis = true) => {
    const ch = {}, put = (name, f, from = 0) => { ch[`sem_${name}_x`] = channelOf(TT.map((ms) => [ms, ms < from ? null : f(ms)[0]])); ch[`sem_${name}_y`] = channelOf(TT.map((ms) => [ms, ms < from ? null : f(ms)[1]])); };
    put('c1_hips', (ms) => [0.4, 0.4 - 0.02 * stroke(ms) + 0.003 * Math.sin(ms / 400)]);
    put('c2_hips', (ms) => [0.55, 0.7 + 0.02 * stroke(ms) - 0.004 * Math.sin(ms / 700)]);
    if (withPenis) put('c2_penis', (ms) => [0.5 + 0.01 * Math.sin(ms / 900), 0.6 + 0.04 * stroke(ms - 150)], app);
    return { id: 'r', params: { axis: 'auto' }, scenes: [], channels: ch, notes: [], groupSeeds: spans ? [{ name: 'c2_penis', span: [app, TT[N - 1]] }] : undefined };
  };
  const idx = TT.map((_, i) => i);
  for (const app of [7333, 10000]) {
    // (paw-0sn8: fusion's smoothing off here, it would soften the step this compares against)
    const raw0 = { aspect: A, fuse: { jit: { refine: 0 } } }, base = fuseScene(mk(app, false, false), idx, raw0).v, j = TT.findIndex((t) => t >= app);
    const jumps = (sp) => { const v = fuseScene(mk(app, sp), idx, raw0).v, d = v.map((x, i) => x - base[i]); return d.map((x, i) => (i ? Math.abs(x - d[i - 1]) : 0)); };
    const raw = jumps(false), ramp = jumps(true), calm = Math.max(...ramp.slice(j + 30));
    assert.ok(Math.max(...raw.slice(j - 2, j + 14)) > 1.15 * calm, `without the ramp the part steps in at ${app} ms`);
    assert.ok(Math.max(...ramp.slice(j - 2, j + 14)) <= calm, `with it: no change bigger than the calm frames' at the join (${app} ms)`);
  }
  // runs without spans are unchanged bit for bit
  const plain = mk(10000, false), a = fuseScene(plain, idx, { aspect: A }).v, b = fuseScene({ ...plain, groupSeeds: [{ name: 'c1_hips', t_ms: 0 }] }, idx, { aspect: A }).v;
  assert.deepEqual(Array.from(a), Array.from(b));
});

test('a seeded group drawn where a run tracked it on another frame', () => {
  const run = baseRun(), m = mergeAdded(run, addResult()), merged = { ...run, ...m.patch };
  const poly = SQ(0.55, 0.65, 0.65, 0.75), t1 = T.find((t) => t >= 2500), moved = trackedPoly(merged, 'c2_penis', poly, 2000, t1, FM);
  const d = [penis(t1)[0] - penis(T.find((t) => t >= 2000))[0], penis(t1)[1] - penis(T.find((t) => t >= 2000))[1]];
  assert.ok(moved.every((q, k) => Math.abs(q[0] - poly[k][0] - d[0]) < 1e-5 && Math.abs(q[1] - poly[k][1] - d[1]) < 1e-5), 'moved by its image-space displacement');
  assert.equal(trackedPoly(merged, 'c2_penis', poly, 2000, 500, FM), null, 'not tracked there');
  assert.equal(trackedPoly(merged, 'c1_tail', poly, 2000, 2500, FM), null);
});

test('the groups-only request (sidecar v4.45)', () => {
  const g = [{ name: 'c2_penis', poly: SQ(0, 0, 1, 1), t_ms: 2000 }];
  assert.equal(trackRequest({ video: 'v', tracker: 'x', start_ms: 0, end_ms: 10, roi: null, params: {}, groups: g, groups_only: true }).groups_only, true);
  assert.equal('groups_only' in trackRequest({ video: 'v', tracker: 'x', start_ms: 0, end_ms: 10, roi: null, params: {}, groups: [], groups_only: true }), false);
  assert.equal('groups_only' in trackRequest({ video: 'v', tracker: 'x', start_ms: 0, end_ms: 10, roi: null, params: {}, groups: g }), false);
});
