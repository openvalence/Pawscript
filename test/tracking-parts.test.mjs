// The pinned groups in the frontend: parts in the picker, group names, camera-dependence, presence, the balls -> spurts
// peak rule (src/lib/runs-channel.js). paw-57dw: the motion groups g1..g4 / g{k}p{j} are no channels any more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerChannels, chipVariants, groupOfChannel, camChannel, groupPresence, sceneGroups, labelOf, labelText, ballsScale, scalePeaks, candidateRows, keepOf } from '../src/lib/runs-channel.js';
import { channelOf } from '../src/lib/runs.js';

const names = (list) => ({ channels: Object.fromEntries(list.map((n) => [n, {}])) });
const GROUPS = {
  sem_balls: { label: 'balls', source: 'sam', score: 0.12, tags: { balls: 0.6, penis: 0.2 }, frames: 5, stable: 0.8 },
  sem_hips: { label: 'hips', source: 'user', points: 9 },
};

test('groupOfChannel: a pinned group only (g1_proj, g1p1_rel, pair_proj are plain channels now)', () => {
  for (const c of ['g1_scale', 'g4p2_rel', 'pair_proj', 'cam_x']) assert.equal(groupOfChannel(c), null, c);
  assert.deepEqual(pickerChannels(names(['g1_proj', 'pair_proj', 'cam_x'])), ['primary', 'cam_x']);
});

test('v4.6 pinned groups: chips (hips, balls, penis), defaults _proj / balls _scale, variants', () => {
  const sem = ['sem_penis_proj', 'sem_penis_rel', 'sem_penis_scale', 'sem_penis_x', 'sem_penis_n', 'sem_balls_proj', 'sem_balls_rel', 'sem_balls_scale', 'sem_hips_scale', 'sem_hips_proj', 'sem_hips_rel', 'sem_hips_y'];
  const run = names(['cam_x', ...sem]);
  assert.deepEqual(pickerChannels(run), ['primary', 'sem_hips_proj', 'sem_balls_scale', 'sem_penis_proj', 'cam_x']);
  assert.deepEqual(groupOfChannel('sem_balls_scale'), { key: 'sem_balls', sem: 'balls', kind: 'scale' });
  assert.equal(groupOfChannel('sem_tail_proj').sem, 'tail');   // v4.11: user groups of any name (was null before)
  assert.deepEqual(chipVariants(run, 'sem_hips_proj'), ['sem_hips_proj', 'sem_hips_rel', 'sem_hips_scale']);
  assert.deepEqual(chipVariants(run, 'sem_balls_scale'), ['sem_balls_scale', 'sem_balls_proj', 'sem_balls_rel']);
  assert.deepEqual(pickerChannels(names(['sem_hips_proj', 'sem_hips_n'])), ['primary', 'sem_hips_proj']);   // alone: still the set
  // names: "hips (seeded)" with or without the scene record; its evidence; presence greys below 50 %
  assert.equal(labelOf({}, 'sem_hips_proj'), 'hips (seeded)');
  assert.equal(labelOf({ sem_balls: { label: 'balls', source: 'cam' } }, 'sem_balls_scale'), 'balls (seeded)');
  assert.equal(labelText({ label: 'hips', source: 'cam', score: 0.62, points: 6 }), 'seeded from the tagger (CAM) · tag 62% · 6 points');
  const pr = { channels: { sem_hips_n: channelOf([[0, 0.1], [10, 0], [20, 0], [30, 0.1], [40, 0], [50, 0]]) } };
  assert.equal(groupPresence(pr, groupOfChannel('sem_hips_proj').key), 2 / 6);
  // why panel: "sem_hips_proj · hips (seeded)", presence in the numbers
  const d = { chosen: 'sem_hips_proj', candidates: { proj: { std: 0.1 }, sem_hips_proj: { std: 0.2, valid: 0.8, share: 0.05, present: 0.78 } } };
  const rows = candidateRows(d, {});
  assert.deepEqual(rows.map((r) => [r.id, r.label, r.chosen]), [['sem_hips_proj', 'hips (seeded)', true], ['proj', '', false]]);
  assert.match(rows[0].text, /present 78%$/);
});

test('camChannel: a pinned group\'s _proj / _rel and a character\'s center rest on the camera; scale does not', () => {
  for (const c of ['proj_cam', 'who_c1_proj']) assert.ok(camChannel(c), c);
  for (const c of ['primary', 'cam_x', 'g1_proj', 'pair_proj', 'g3p2_rel']) assert.ok(!camChannel(c), c);
  for (const c of ['sem_hips_proj', 'sem_balls_rel', 'sem_penis_proj']) assert.ok(camChannel(c), c);   // v4.6 pinned groups
  for (const c of ['sem_balls_scale', 'sem_hips_n', 'sem_hips_x']) assert.ok(!camChannel(c), c);
});

test('groupPresence: share of the span\'s frames with _n > 0 (null = absent); no _n: 1', () => {
  const run = { channels: { sem_c1_tail_n: channelOf([[0, null], [10, 0.02], [20, 0.03], [30, null], [40, 0], [50, 0.01]]) } };
  assert.equal(groupPresence(run, 'sem_c1_tail'), 3 / 6);
  assert.equal(groupPresence(run, 'sem_c1_tail', 10, 30), 1);
  assert.equal(groupPresence(run, 'sem_c1_tail', 30, 60), 1 / 3);
  assert.equal(groupPresence(run, 'sem_hips'), 1);
});

test('sceneGroups / labelOf / labelText: records from scenes[].groups, else the group_labels note', () => {
  const run = { scenes: [{ start_ms: 0, end_ms: 1000, groups: GROUPS }, { start_ms: 1000, end_ms: 2000 }, { start_ms: 2000, end_ms: 3000, groups: {} }],
    notes: [{ code: 'group_labels', scene_index: 1, message: 'group labels: sem_tail = tail', data: { groups: { sem_tail: { label: 'tail', source: 'user' } } } }] };
  assert.equal(sceneGroups(run, 0), GROUPS);
  assert.equal(labelOf(sceneGroups(run, 1), 'sem_tail_proj'), 'tail (drawn)');   // note fallback
  assert.deepEqual(sceneGroups(run, 2), {});
  assert.deepEqual(sceneGroups({ scenes: [] }, -1), {});
  assert.equal(labelOf(GROUPS, 'sem_balls_scale'), 'balls (seeded)');
  assert.equal(labelOf(GROUPS, 'cam_x'), '');
  assert.equal(labelText(GROUPS.sem_balls), 'named balls · tags balls 60%, penis 20% · margin 0.12 · stable 80% of 5 frames');
  assert.equal(labelText(GROUPS.sem_hips), 'drawn on the video (Groups) · 9 points');
  assert.equal(labelText(undefined), '');
});

test('candidateRows: the candidate\'s group name', () => {
  const d = { chosen: 'sem_hips_proj', candidates: { proj: { std: 0.1 }, sem_hips_proj: { std: 0.2 }, sem_balls_scale: { std: 0.05 } } };
  const rows = candidateRows(d, GROUPS);
  assert.deepEqual(rows.map((r) => [r.id, r.label]), [['sem_hips_proj', 'hips (drawn)'], ['proj', ''], ['sem_balls_scale', 'balls (seeded)']]);
});

test('ballsScale: the pinned balls group\'s contraction where it has a value in the scene, else none (no motion-group part fallback)', () => {
  const sem = { scenes: [{ start_ms: 0, end_ms: 10 }, { start_ms: 10, end_ms: 20, groups: { g1p1: { label: 'balls' } } }], channels: { g1p1_scale: {}, sem_balls_scale: channelOf([[0, 0.01], [5, null], [12, null], [15, null]]) } };
  assert.equal(ballsScale(sem, 0), 'sem_balls_scale');
  assert.equal(ballsScale(sem, 1), '');   // all null in scene 2; a part named balls is not read any more
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
  const run = { channels: { sem_balls_rel: channelOf([[0, 0.1], [33, 0.2]]) }, points0Primary: { at: [0], pos: [50] }, scenes: [{ start_ms: 0, end_ms: 100, sign: 1, groups: GROUPS }, { start_ms: 100, end_ms: 200 }] };
  const k = keepOf(run, ['sem_balls_rel']);
  assert.equal(k.scenes[0].groups, GROUPS);
  assert.ok(!('groups' in k.scenes[1]));
});
