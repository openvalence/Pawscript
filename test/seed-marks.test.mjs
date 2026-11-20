import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTimes, seedMarks, SEED_TIP, seedFrames, seedStep, seedFrom } from '../src/features/tracking/seed-marks.js';
import { indexRepeats, bucketColor } from '../src/features/timeline/repeats.js';

const FM = 1000 / 30;
const run = { range: { start: 1000, end: 9000 }, roi: { t_ms: 1500 } };
const scenes = [{ start_ms: 0, end_ms: 5000, groups: [{ t_ms: 2000 }] }, { start_ms: 5000, end_ms: 20000, groups: [{ t_ms: 12000 }] }];

test('seed time: the groups of each shot the run covers, else the ROI frame', () => {
  assert.deepEqual(seedTimes(run, scenes), [2000]);                       // the second shot's groups are outside the run
  assert.deepEqual(seedTimes({ ...run, range: { start: 1000, end: 15000 } }, scenes), [2000, 12000]);
  assert.deepEqual(seedTimes(run, [{ start_ms: 0, end_ms: 5000, groups: [{ t_ms: 500 }, { t_ms: 1200, off: false }] }]), [1200]);
  assert.deepEqual(seedTimes(run, []), [1500]);
  assert.deepEqual(seedTimes({ range: run.range }, []), []);
});

test('a picture that does not repeat: one plain seed mark', () => {
  const m = seedMarks([2000], indexRepeats({ buckets: [] }), FM, run.range, '#4DA6FF');
  assert.deepEqual(m, [{ t: 2000, label: 'seed', color: '#4DA6FF', tip: SEED_TIP, seed: true }]);
});

test('a repeating picture: seed xN in its bucket hue, a fainter mark on each other occurrence inside the run', () => {
  const f = (ms) => Math.round(ms / FM);
  const occ = [2000, 4000, 6000, 12000].map((t) => ({ f0: f(t), f1: f(t), t_ms: t }));
  const ix = indexRepeats({ frames: 900, buckets: [occ, [{ f0: 1, f1: 1, t_ms: 33 }, { f0: 3, f1: 3, t_ms: 100 }]] });
  const m = seedMarks([f(2000) * FM], ix, FM, run.range, '#4DA6FF');
  assert.deepEqual(m.map((x) => [x.t, x.label, x.seed, x.alpha]), [[f(2000) * FM, 'seed ×4', true, undefined], [4000, 'seed', false, 0.35], [6000, 'seed', false, 0.35]]);   // 12000 is past the run
  assert.ok(m.every((x) => x.color === bucketColor(0)));
  assert.match(m[1].tip, /^Same picture as the seed frame \(0:02\.0\d\d\)$/);
});

// ---- paw-46du: every seed frame of the video, for the timeline (before any run, per run, several, old projects) ----
const shots = [{ start_ms: 0, end_ms: 5000, groups: [] }, { start_ms: 5000, end_ms: 20000, groups: [] }];
const P = (t, name, o = {}) => ({ name, t_ms: t, poly: [[0, 0], [1, 0], [1, 1]], ...o });

test('seed frames: painted parts show with no run at all, one mark per frame, every frame of a shot', () => {
  const sc = [{ ...shots[0], groups: [P(1000, 'c1_torso'), P(1000, 'c2_penis'), P(3000, 'unassigned_1')] }, { ...shots[1], groups: [P(8000, 'c1_hips')] }];
  assert.deepEqual(seedFrames(sc, []), [
    { t: 1000, painted: ['c1_torso', 'c2_penis'], runs: [] },
    { t: 3000, painted: ['unassigned_1'], runs: [] },   // painted, not assigned yet: already a seed frame
    { t: 8000, painted: ['c1_hips'], runs: [] },
  ]);
  // an ignore region and a part turned off are not seeds; a group without a frame is skipped
  assert.deepEqual(seedFrames([{ ...shots[0], groups: [P(500, 'ignore1'), P(700, 'c1_torso', { off: true }), { name: 'c1_hips' }] }], []), []);
  assert.deepEqual(seedFrames([], []), []);
  assert.deepEqual(seedFrames(undefined, undefined), []);
});

test('seed frames: a run adds its own (ROI frame, one-way seed, added seeds) and names itself on the painted ones', () => {
  const sc = [{ ...shots[0], groups: [P(2000, 'c1_torso')] }, shots[1]];
  const run = { n: 3, range: { start: 0, end: 20000 }, roi: { kind: 'box', t_ms: 2000 }, groupSeeds: [{ name: 'c1_torso', t_ms: 2000 }, { name: 'c2_penis', t_ms: 9000 }] };
  assert.deepEqual(seedFrames(sc, [run]), [{ t: 2000, painted: ['c1_torso'], runs: [3] }, { t: 9000, painted: [], runs: [3] }]);
  const oneWay = { n: 4, range: { start: 5000, end: 20000 }, roi: { kind: 'points', points: [[0.5, 0.5]] }, seedMs: 12000, direction: 'forward' };
  assert.deepEqual(seedFrames(sc, [oneWay]).map((m) => [m.t, m.runs]), [[2000, []], [12000, [4]]]);
  // a modifier's own run: its seeds; references, derived ghosts and camera runs have none
  const mod = { n: 5, mod: 'fx1', range: { start: 0, end: 4000 }, seeds: [1500, 2500] };
  const none = [{ id: 'ref', ref: true, range: { start: 0, end: 9e3 }, roi: { t_ms: 100 } }, { id: 'r~surge', derived: true, range: { start: 0, end: 9e3 }, roi: { t_ms: 200 } }, { id: 'cam', tag: 'camera', range: { start: 0, end: 9e3 }, roi: { t_ms: 300 } }];
  assert.deepEqual(seedFrames([], [mod, ...none]), [{ t: 1500, painted: [], runs: [5] }, { t: 2500, painted: [], runs: [5] }]);
});

test('seed frames: an old project (runs, no painted groups left in its shots) still shows its runs seeds; slack merges a frame', () => {
  const old = { n: 1, range: { start: 0, end: 10000 }, roi: { kind: 'box', x: 0.1, y: 0.1, w: 0.5, h: 0.5, t_ms: 4000 } };   // no groupSeeds, no seedMs
  assert.deepEqual(seedFrames(shots.map(({ groups, ...s }) => s), [old]), [{ t: 4000, painted: [], runs: [1] }]);
  assert.deepEqual(seedFrames([], [{ n: 2, range: { start: 0, end: 10000 } }]), []);   // a grid run with no ROI frame: none
  // the run's ROI frame rounded off the painted frame's start by a few ms: one mark with half a frame of slack
  const sc = [{ ...shots[0], groups: [P(1001, 'c1_torso')] }];
  assert.equal(seedFrames(sc, [{ n: 7, range: { start: 0, end: 900 }, roi: { t_ms: 1010 } }], 1000 / 60).length, 1);
  assert.equal(seedFrames(sc, [{ n: 7, range: { start: 0, end: 900 }, roi: { t_ms: 1010 } }]).length, 2);
});

test('previous / next seed frame wrap round the video; the visible range starts at a binary search', () => {
  const F = [{ t: 1000 }, { t: 3000 }, { t: 8000 }];
  assert.equal(seedStep(F, 0, 1), 1000);
  assert.equal(seedStep(F, 1000, 1), 3000);      // on a seed frame: the next one
  assert.equal(seedStep(F, 1000.4, 1), 3000);    // within eps of it: still the next one
  assert.equal(seedStep(F, 8000, 1), 1000);      // past the last: round to the first (the video, not the shot)
  assert.equal(seedStep(F, 3000, -1), 1000);
  assert.equal(seedStep(F, 500, -1), 8000);      // before the first: round to the last
  assert.equal(seedStep([{ t: 2000 }], 2000, 1), 2000);
  assert.equal(seedStep([], 0, 1), null);
  assert.deepEqual([0, 999, 1000, 2000, 8000, 9000].map((t) => seedFrom(F, t)), [0, 0, 0, 1, 2, 3]);
});