// The learned seeder's pure side in the Groups tool (paw-bn2, PROTOCOL v4.18): suggestions vs painted groups, accepting,
// the seed-frame candidates, the seed library, the retrain key, the requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSuggested, confidenceOf, isTentative, acceptGroup, seedCandidates, seedFolders, paintedKey, suggestedGroups, CONFIDENT, SEED_SPAN } from '../src/features/tracking/groups.js';
import { suggestGroupsRequest, seedTrainRequest } from '../src/lib/protocol.js';

const sq = [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]];

test('suggestions vs painted groups; accepting makes a suggestion a painted (training) group', () => {
  const s = { name: 'c1_penis', poly: sq, source: 'seeder', score: 0.62, tentative: true, outline: 'head' };
  assert.ok(isSuggested(s) && isTentative(s) && confidenceOf(s) === 0.62);
  assert.ok(!isSuggested({ name: 'c1_penis', source: 'user' }) && !isSuggested({ name: 'c1_penis' }) && confidenceOf({ name: 'x', score: 0.5 }) === null);
  assert.ok(!isTentative({ ...s, tentative: undefined, score: 0.9 }) && isTentative({ ...s, tentative: undefined, score: CONFIDENT - 0.01 }));
  assert.ok(!isTentative({ name: 'c1_hips', source: 'tagger', score: 0.3 }), 'a tag probability is not the seeder confidence');
  const a = acceptGroup(s);
  assert.deepEqual(a, { name: 'c1_penis', poly: sq, source: 'user' });
  const painted = { name: 'c1_hips', source: 'user' };
  assert.equal(acceptGroup(painted), painted, 'a painted group is returned as is');
  assert.deepEqual(acceptGroup({ name: 'c2_tail', source: 'tagger', score: 0.4, unconfirmed: true, prior: 'c2_tail' }), { name: 'c2_tail', source: 'user' });
});

test('suggestedGroups keeps source, score and the tentative flag', () => {
  const res = { groups: [{ name: 'c1_penis', poly: sq, score: 0.55, source: 'seeder', part: 'penis', who: 'c1', tentative: true }, { name: 'c2_tail', poly: sq, score: 0.7, source: 'tagger' }] };
  const out = suggestedGroups(res, 1000, [], () => null);
  assert.deepEqual(out.map((g) => [g.name, g.source, g.score, !!g.tentative]), [['c1_penis', 'seeder', 0.55, true], ['c2_tail', 'tagger', 0.7, false]]);
});

test('seed-frame candidates: the frame on screen first, then every 400 ms of the take\'s first 2 s', () => {
  const scenes = [{ start_ms: 1000, end_ms: 9000 }, { start_ms: 9000, end_ms: 9600 }];
  assert.deepEqual(seedCandidates(scenes, 0, 1500), [1500, 1000, 1400, 1800, 2200, 2600]);
  assert.deepEqual(seedCandidates(scenes, 0, 1000 + SEED_SPAN + 1), [], 'further in: the owner chose the frame');
  // 29.97 fps: each candidate on a frame start (whole ms inside the frame), so the playhead can stand on the group's frame
  const f = 1001 / 30, c = seedCandidates(scenes, 0, 1501, f);
  assert.deepEqual(c, [1501, 1001, 1402, 1802, 2203, 2603]);
  assert.ok(c.slice(1).every((x) => x - Math.floor(x / f) * f < 1), c.map((x) => (x / f).toFixed(3)).join(' '));
  assert.deepEqual(seedCandidates(scenes, 1, 9000), [9000, 9400], 'a short shot: only its own frames');
  const painted = [{ ...scenes[0], groups: [{ name: 'c1_hips', poly: sq, t_ms: 1200, source: 'user' }] }, scenes[1]];
  assert.deepEqual(seedCandidates(painted, 0, 1200), [], 'painted groups fix the frame');
  const suggested = [{ ...scenes[0], groups: [{ name: 'c1_hips', poly: sq, t_ms: 1200, source: 'seeder' }] }, scenes[1]];
  assert.equal(seedCandidates(suggested, 0, 1200)[0], 1200, 'only suggestions: Suggest may move them');
});

test('seed library: the setting, else the recent projects\' folders, each once', () => {
  const recent = [{ path: 'W:\\Videos\\a.webm' }, { path: 'w:\\videos\\b.pawproj' }, { path: 'D:\\x\\c.pawproj', missing: true }, { path: '/home/u/v/d.mp4' }];
  assert.deepEqual(seedFolders([], recent), ['W:\\Videos', '/home/u/v']);
  assert.deepEqual(seedFolders(['E:\\lib', 'e:\\LIB'], recent), ['E:\\lib']);
  assert.deepEqual(seedFolders(undefined, undefined), []);
});

test('paintedKey changes with painted groups only', () => {
  const g = { name: 'c1_hips', poly: sq, t_ms: 1000, source: 'user', mask: { w: 2, h: 1, rle: [15, 1, 0, 1] } };
  const k = paintedKey([{ groups: [g] }]);
  assert.equal(paintedKey([{ groups: [g, { name: 'c2_tail', poly: sq, t_ms: 1000, source: 'seeder' }, { name: 'unassigned_1', poly: sq, t_ms: 1000 }] }]), k);
  assert.notEqual(paintedKey([{ groups: [{ ...g, mask: { w: 2, h: 1, rle: [15, 2] } }] }]), k);
  assert.notEqual(paintedKey([{ groups: [{ ...g, name: 'c2_hips' }] }]), k);
});

test('requests: suggest_groups seed / candidates (v4.18), seed_train', () => {
  const r = suggestGroupsRequest({ video: 'v.mp4', t_ms: 1500.4, params: {}, seed: { dir: 'D:\\s', key: 'q1-1' }, candidates: [1500.4, 1000] });
  assert.deepEqual(r.seed, { dir: 'D:\\s', key: 'q1-1' });
  assert.deepEqual(r.candidates, [1500, 1000]);
  const old = suggestGroupsRequest({ video: 'v.mp4', t_ms: 1500, params: {} });
  assert.ok(!('seed' in old) && !('candidates' in old), 'old requests unchanged');
  assert.ok(!('candidates' in suggestGroupsRequest({ video: 'v', start_ms: 0, end_ms: 9, candidates: [1] })), 'candidates only with t_ms');
  assert.deepEqual(seedTrainRequest({ dir: 'D:\\s', folders: ['W:\\Videos'], projects: ['W:\\Videos\\a.pawproj'] }), { cmd: 'seed_train', dir: 'D:\\s', folders: ['W:\\Videos'], projects: ['W:\\Videos\\a.pawproj'] });
  assert.equal(seedTrainRequest({ dir: 'd', force: true }).force, true);
  assert.equal(seedTrainRequest({ dir: 'd', labels: 'D:\s\labels' }).labels, 'D:\s\labels', 'v4.24: the image labels folder');
  assert.ok(!('labels' in seedTrainRequest({ dir: 'd' })));
});
