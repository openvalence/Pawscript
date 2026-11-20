// PROTOCOL v3.3 / v3.4 in the frontend: parts in the picker, group names, camera-dependence, presence, the
// balls -> spurts peak rule (src/lib/runs-channel.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerChannels, chipVariants, groupOfChannel, camChannel, groupPresence, sceneGroups, labelOf, labelText, partsLeftOut, ballsScale, scalePeaks, candidateRows, keepOf } from '../src/lib/runs-channel.js';
import { channelOf } from '../src/lib/runs.js';

const names = (list) => ({ channels: Object.fromEntries(list.map((n) => [n, {}])) });
const GROUPS = {
  g1: { label: 'body', score: 0, tags: { penis: 0.21, balls: 0.05, tail: 0 }, frames: 5, stable: 1 },
  g1p1: { label: 'balls', score: 0.12, tags: { balls: 0.6, penis: 0.2 }, frames: 5, stable: 0.8 },
  g1p2: { label: 'penis', score: 0.3, tags: { penis: 0.7 }, frames: 4, stable: 1 },
  g2: { label: 'body', score: 0, tags: {}, frames: 5, stable: 1, suspect: 'penis' },
};

test('groupOfChannel: bodies, parts, others', () => {
  assert.deepEqual(groupOfChannel('g1_scale'), { key: 'g1', body: 1, part: 0, kind: 'scale' });
  assert.deepEqual(groupOfChannel('g4p2_rel'), { key: 'g4p2', body: 4, part: 2, kind: 'rel' });
  assert.equal(groupOfChannel('pair_proj'), null);
  assert.equal(groupOfChannel('g5_proj'), null);
  assert.equal(groupOfChannel('g1p3_rel'), null);
});

test('pickerChannels: a chip per body (default _proj) then its parts (default _rel); variants per chip', () => {
  const all = ['g2_proj', 'g1p1_scale', 'g1_rot', 'g1p1_proj', 'g1_scale', 'g1p1_rel', 'g1p1_x', 'g1p1_n', 'g1_proj', 'pair_proj', 'cam_x', 'proj_cam', 'g2p1_proj', 'g2p1_scale', 'g1_n'];
  const run = names(all);
  assert.deepEqual(pickerChannels(run), ['primary', 'proj_cam', 'g1_proj', 'g1p1_rel', 'g2_proj', 'g2p1_proj', 'pair_proj', 'cam_x']);
  assert.deepEqual(chipVariants(run, 'g1_proj'), ['g1_proj', 'g1_scale', 'g1_rot']);
  assert.deepEqual(chipVariants(run, 'g1p1_rel'), ['g1p1_rel', 'g1p1_proj', 'g1p1_scale']);
  assert.deepEqual(chipVariants(run, 'g2p1_proj'), ['g2p1_proj', 'g2p1_scale']);   // no _rel: the first that exists is the default
  assert.deepEqual(chipVariants(run, 'g1p1_x'), ['g1p1_x']);   // not a picker channel: itself
  assert.deepEqual(chipVariants(run, 'pair_proj'), ['pair_proj']);
  assert.deepEqual(pickerChannels(names(['g3_scale', 'g3_rot'])), ['primary', 'g3_scale']);   // a body without _proj still gets a chip
  // the old v3.1 set is unchanged
  assert.deepEqual(pickerChannels(names(['cam_y', 'g2_proj', 'g1_n', 'pair_proj', 'g1_proj', 'cam_x', 'pair_dist'])), ['primary', 'g1_proj', 'g2_proj', 'pair_proj', 'cam_x', 'cam_y']);
});

test('v4.6 pinned groups: chips after the bodies and parts (hips, balls, penis), defaults _proj / balls _scale, variants', () => {
  const sem = ['sem_penis_proj', 'sem_penis_rel', 'sem_penis_scale', 'sem_penis_x', 'sem_penis_n', 'sem_balls_proj', 'sem_balls_rel', 'sem_balls_scale', 'sem_hips_scale', 'sem_hips_proj', 'sem_hips_rel', 'sem_hips_y'];
  const run = names(['g1_proj', 'g1p1_rel', 'g2_proj', 'pair_proj', 'cam_x', ...sem]);
  assert.deepEqual(pickerChannels(run), ['primary', 'g1_proj', 'g1p1_rel', 'g2_proj', 'sem_hips_proj', 'sem_balls_scale', 'sem_penis_proj', 'pair_proj', 'cam_x']);
  assert.deepEqual(groupOfChannel('sem_balls_scale'), { key: 'sem_balls', body: 0, part: 0, sem: 'balls', kind: 'scale' });
  assert.equal(groupOfChannel('sem_tail_proj').sem, 'tail');   // v4.11: user groups of any name (was null before)
  assert.deepEqual(chipVariants(run, 'sem_hips_proj'), ['sem_hips_proj', 'sem_hips_rel', 'sem_hips_scale']);
  assert.deepEqual(chipVariants(run, 'sem_balls_scale'), ['sem_balls_scale', 'sem_balls_proj', 'sem_balls_rel']);
  assert.deepEqual(pickerChannels(names(['sem_hips_proj', 'sem_hips_n'])), ['primary', 'sem_hips_proj']);   // alone: still the set
  // names: "hips (seeded)" with or without the scene record; its evidence; presence greys below 50 %
  assert.equal(labelOf({}, 'sem_hips_proj'), 'hips (seeded)');
  assert.equal(labelOf({ sem_balls: { label: 'balls', source: 'cam' } }, 'sem_balls_scale'), 'balls (seeded)');
  assert.equal(labelText({ label: 'hips', source: 'cam', score: 0.62, points: 6 }), 'seeded from the tagger (CAM) · tag 62% · 6 points');
  assert.equal(partsLeftOut(GROUPS, 'sem_hips_proj'), '');
  const pr = { channels: { sem_hips_n: channelOf([[0, 0.1], [10, 0], [20, 0], [30, 0.1], [40, 0], [50, 0]]) } };
  assert.equal(groupPresence(pr, groupOfChannel('sem_hips_proj').key), 2 / 6);
  // why panel: "sem_hips_proj · hips (seeded)", presence in the numbers
  const d = { chosen: 'sem_hips_proj', candidates: { proj: { std: 0.1 }, sem_hips_proj: { std: 0.2, valid: 0.8, share: 0.05, present: 0.78 } } };
  const rows = candidateRows(d, {});
  assert.deepEqual(rows.map((r) => [r.id, r.label, r.chosen]), [['sem_hips_proj', 'hips (seeded)', true], ['proj', '', false]]);
  assert.match(rows[0].text, /present 78%$/);
});

test('camChannel: a part\'s _proj / _rel rest on the camera; scale / rot do not', () => {
  for (const c of ['proj_cam', 'g1_proj', 'pair_proj', 'g1p1_proj', 'g3p2_rel']) assert.ok(camChannel(c), c);
  for (const c of ['primary', 'cam_x', 'g1_scale', 'g1_rot', 'g1p1_scale', 'g1p1_n']) assert.ok(!camChannel(c), c);
  for (const c of ['sem_hips_proj', 'sem_balls_rel', 'sem_penis_proj']) assert.ok(camChannel(c), c);   // v4.6 pinned groups
  for (const c of ['sem_balls_scale', 'sem_hips_n', 'sem_hips_x']) assert.ok(!camChannel(c), c);
});

test('groupPresence: share of the span\'s frames with _n > 0 (null = absent); no _n: 1', () => {
  const run = { channels: { g1p1_n: channelOf([[0, null], [10, 0.02], [20, 0.03], [30, null], [40, 0], [50, 0.01]]) } };
  assert.equal(groupPresence(run, 'g1p1'), 3 / 6);
  assert.equal(groupPresence(run, 'g1p1', 10, 30), 1);
  assert.equal(groupPresence(run, 'g1p1', 30, 60), 1 / 3);
  assert.equal(groupPresence(run, 'g2'), 1);
});

test('sceneGroups / labelOf / labelText / partsLeftOut: names from scenes[].groups, else the group_labels note', () => {
  const run = { scenes: [{ start_ms: 0, end_ms: 1000, groups: GROUPS }, { start_ms: 1000, end_ms: 2000 }, { start_ms: 2000, end_ms: 3000, groups: {} }],
    notes: [{ code: 'group_labels', scene_index: 1, message: 'group labels: g1 = tail', data: { groups: { g1: { label: 'tail' } }, s: 0.3 } }] };
  assert.equal(sceneGroups(run, 0), GROUPS);
  assert.equal(labelOf(sceneGroups(run, 1), 'g1_proj'), 'tail');   // note fallback
  assert.deepEqual(sceneGroups(run, 2), {});
  assert.deepEqual(sceneGroups({ scenes: [] }, -1), {});
  assert.equal(labelOf(GROUPS, 'g1p1_scale'), 'balls');
  assert.equal(labelOf(GROUPS, 'g3_proj'), '');
  assert.equal(labelOf(GROUPS, 'cam_x'), '');
  assert.equal(labelText(GROUPS.g1p1), 'named balls · tags balls 60%, penis 20% · margin 0.12 · stable 80% of 5 frames');
  assert.match(labelText(GROUPS.g2), /penis won but the group is too big for it/);
  assert.equal(labelText(undefined), '');
  assert.equal(partsLeftOut(GROUPS, 'g1_proj'), "g1's signal already leaves out its penis (g1p2): a part's points are not in its body's channels");
  assert.equal(partsLeftOut({ g1: {}, g1p1: { label: 'tail' }, g1p2: { label: 'penis' } }, 'g1_scale'), "g1's signal already leaves out its tail (g1p1) and penis (g1p2): a part's points are not in its body's channels");
  assert.equal(partsLeftOut(GROUPS, 'g1p2_rel'), '');   // only on a body
  assert.equal(partsLeftOut(GROUPS, 'g2_proj'), '');
});

test('candidateRows: the candidate\'s group name', () => {
  const d = { chosen: 'g1_proj', candidates: { proj: { std: 0.1 }, g1_proj: { std: 0.2 }, g1p1_rel: { std: 0.05 } } };
  const rows = candidateRows(d, GROUPS);
  assert.deepEqual(rows.map((r) => [r.id, r.label]), [['g1_proj', 'body'], ['proj', ''], ['g1p1_rel', 'balls']]);
  assert.equal(candidateRows(d)[0].label, '');
});

test('ballsScale: the scene\'s part named balls with a _scale channel', () => {
  const run = { scenes: [{ start_ms: 0, end_ms: 10, groups: GROUPS }, { start_ms: 10, end_ms: 20, groups: { g2p2: { label: 'balls' } } }], channels: { g1p1_scale: {} } };
  assert.equal(ballsScale(run, 0), 'g1p1_scale');
  assert.equal(ballsScale(run, 1), '');   // named, but no _scale channel
  assert.equal(ballsScale({ ...run, scenes: [{ start_ms: 0, end_ms: 10, groups: { g1: { label: 'balls' } } }] }, 0), '');   // a body is not a part
  // v4.6: the pinned balls group's contraction wins where it has a value in the scene; else the part's
  const sem = { ...run, channels: { g1p1_scale: {}, sem_balls_scale: channelOf([[0, 0.01], [5, null], [12, null], [15, null]]) } };
  assert.equal(ballsScale(sem, 0), 'sem_balls_scale');
  assert.equal(ballsScale({ ...sem, scenes: [{ start_ms: 0, end_ms: 10, groups: {} }] }, 0), 'sem_balls_scale');   // no part needed
  assert.equal(ballsScale({ ...sem, scenes: [sem.scenes[0], { start_ms: 10, end_ms: 20, groups: GROUPS }] }, 1), 'g1p1_scale');   // all null in scene 2
});

test('scalePeaks: contraction peaks of a synthetic _scale, robust to noise, min gap, the scene window', () => {
  // 30 fps, 12 s: small noise, contractions (negative dips, 120 ms wide) at 2.0, 2.8, 3.7, 4.7, 6.0 s; a double dip 150 ms apart at 8 s
  const shots = [2000, 2800, 3700, 4700, 6000, 8000, 8150], pairs = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let t = 0; t < 12000; t += 1000 / 30) {
    let v = 0.004 * rnd();
    for (const s of shots) v -= (s === 8150 ? 0.03 : 0.05) * Math.exp(-(((t - s) / 60) ** 2));
    pairs.push([Math.round(t), v]);
  }
  pairs[100][1] = null;   // a gap
  const ch = channelOf(pairs);
  const near = (got, want) => { assert.equal(got.length, want.length, `${got} vs ${want}`); got.forEach((t, i) => assert.ok(Math.abs(t - want[i]) <= 34, `${t} vs ${want[i]}`)); };
  near(scalePeaks(ch, 0, 12000), [2000, 2800, 3700, 4700, 6000, 8000]);   // 8150 is within 300 ms of the taller 8000
  near(scalePeaks(ch, 0, 12000, { minGapMs: 100 }), shots);
  near(scalePeaks(ch, 2500, 5000), [2800, 3700, 4700]);   // only inside the window
  assert.deepEqual(scalePeaks(ch, 0, 12000, { sign: 1 }).filter((t) => shots.some((s) => Math.abs(s - t) < 100)), [], 'swelling peaks are not the dips');
  assert.deepEqual(scalePeaks(channelOf(pairs.map(([t]) => [t, 0])), 0, 12000), [], 'flat: no peaks');
  assert.deepEqual(scalePeaks(channelOf([[0, 1], [33, 2]]), 0, 100), [], 'too short');
  assert.deepEqual(scalePeaks(null, 0, 1), []);
});

test('keepOf: a run kept on its ghost keeps its scenes\' group names', () => {
  const run = { channels: { g1p1_rel: channelOf([[0, 0.1], [33, 0.2]]) }, points0Primary: { at: [0], pos: [50] }, scenes: [{ start_ms: 0, end_ms: 100, sign: 1, groups: GROUPS }, { start_ms: 100, end_ms: 200 }] };
  const k = keepOf(run, ['g1p1_rel']);
  assert.equal(k.scenes[0].groups, GROUPS);
  assert.ok(!('groups' in k.scenes[1]));
});
