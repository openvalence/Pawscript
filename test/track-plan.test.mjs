// "Track tagged scenes": the plan read from the scene tags (lib/track-plan.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTracks, planSummary, scenesLabel } from '../src/lib/track-plan.js';
import { isInternal, isOffscreen, sceneCamera } from '../src/features/timeline/acts.js';
import { trackCuts } from '../src/lib/protocol.js';

const sc = (...xs) => { let t = 0; return xs.map((x) => { const s = { start_ms: t, end_ms: t + 1000, ...x }; t += 1000; return s; }); };
const trackers = [{ id: 'tapnext_points', name: 'TAPNext', roi: 'box_or_points' }, { id: 'sam2_mask', name: 'SAM', roi: 'box' }, { id: 'lk_box', name: 'LK', roi: 'box' }];
const box = { kind: 'box', x: 0.2, y: 0.2, w: 0.3, h: 0.3, t_ms: 500 };
const base = { trackers, trackerId: 'tapnext_points', params: { box_points: 1024 }, roi: box };
const brief = (p) => p.map((x) => [x.label, x.action, x.tracker, x.segments]);

test('A, B (off-screen), A\' (continues): one item over A and A\' with B out of every segment; B skipped', () => {
  const s = sc({}, { tags: ['offscreen'] }, { continues: true });
  const p = planTracks(s, base);
  assert.deepEqual(brief(p), [['S1 + S3', 'track', 'tapnext_points', [[0, 1000], [2000, 3000]]], ['S2', 'skip', '', []]]);
  assert.equal(p[0].roi, box);
  assert.deepEqual(p[0].params, { box_points: 1024 });   // the panel's params (TAPNext 512 / 1024 lives there)
  assert.match(p[0].reason, /continues across S2 \(off-screen\)/);
  assert.equal(p[1].reason, 'off-screen: bridged from the neighbors');
  // no continues: A and A' are two items, B still skipped
  assert.deepEqual(brief(planTracks(sc({}, { tags: ['offscreen'] }, {}), base)).map((x) => x[0]), ['S1', 'S2', 'S3']);
});

test('camera splits merge into one contiguous segment; trackCuts drops the split, keeps the real cut', () => {
  const s = sc({}, { continues: true, split: 'camera' }, {});
  const p = planTracks(s, base);
  assert.deepEqual(brief(p), [['S1–S2', 'track', 'tapnext_points', [[0, 2000]]], ['S3', 'track', 'tapnext_points', [[2000, 3000]]]]);
  assert.deepEqual(trackCuts('document', s, 0, 2000), [{ t_ms: 1000, kind: 'soft', why: 'camera split' }]);   // one run through the split
  const t = sc({}, { continues: true, split: 'camera' }, { continues: true }, {});   // S3 continues S2 directly (a straight continuation, real cut)
  assert.deepEqual(brief(planTracks(t, base))[0], ['S1–S3', 'track', 'tapnext_points', [[0, 3000]]]);
  assert.deepEqual(trackCuts('document', t, 0, 3000).map((c) => [c.t_ms, c.kind]), [[1000, 'soft'], [2000, 'soft']]);   // the action continues: the run keeps its points and groups, re-seeds there
  const u = sc({}, {}, {});   // no continuation: real cuts restart the tracker
  assert.deepEqual(trackCuts('document', u, 0, 3000).map((c) => c.kind), ['hard', 'hard']);
});

test('internal view in the middle of an action: SAM area item of its own, the action around it is one item', () => {
  const desc = { tags: [{ tag: 'penis', score: 0.9, box: [0.4, 0.4, 0.2, 0.2] }] };
  const s = sc({}, { tags: ['internal'], describe: desc }, { continues: true });
  const p = planTracks(s, base);
  assert.deepEqual(brief(p), [['S1 + S3', 'track', 'tapnext_points', [[0, 1000], [2000, 3000]]], ['S2', 'track', 'sam2_mask', [[1000, 2000]]]]);
  assert.deepEqual(p[1].roi, { kind: 'box', x: 0.4, y: 0.4, w: 0.2, h: 0.2 });
  assert.deepEqual(p[1].params, { primary: 'area', pipe_invert: true });
  assert.equal(p[1].name, 'SAM · area');
  assert.match(p[1].reason, /box from describe/);
  assert.match(p[0].reason, /S2 \(internal\)/);
  // no describe box: it needs one; the action still tracks
  const q = planTracks(sc({}, { tags: ['internal'] }, { continues: true }), base);
  assert.equal(q[1].action, 'needs-roi');
  assert.equal(q[1].reason, 'internal view: paint the inserted part with Groups (Tab)');
  assert.equal(q[1].seekMs, 1500);
  // a box drawn on the internal view: SAM takes it, the action scenes now need their own
  const drawn = { ...box, t_ms: 1200 };
  const r = planTracks(sc({}, { tags: ['internal'] }, { continues: true }), { ...base, roi: drawn });
  assert.deepEqual(r.map((x) => [x.label, x.action]), [['S1 + S3', 'needs-roi'], ['S2', 'track']]);
  assert.equal(r[1].roi, drawn);
  assert.match(r[0].reason, /painted on an internal view/);
  // SAM not installed: the internal view is tracked like any scene (S3 continues it directly)
  const noSam = planTracks(sc({}, { tags: ['internal'] }, { continues: true }), { ...base, trackers: trackers.filter((t) => t.id !== 'sam2_mask') });
  assert.deepEqual(brief(noSam), [['S1', 'track', 'tapnext_points', [[0, 1000]]], ['S2–S3', 'track', 'tapnext_points', [[1000, 3000]]]]);
});

test('needs-roi: the panel tracker needs one and none is drawn; a roi-less tracker never does', () => {
  const p = planTracks(sc({}, {}), { ...base, roi: null });
  assert.deepEqual(p.map((x) => x.action), ['needs-roi', 'needs-roi']);
  assert.match(p[0].reason, /TAPNext: paint the part with Groups \(Tab\)/);
  const none = planTracks(sc({}), { ...base, trackers: [{ id: 'flow', name: 'Flow', roi: 'none' }], trackerId: 'flow', roi: null });
  assert.equal(none[0].action, 'track');
  assert.equal(none[0].roi, null);
  // a points ROI for a box tracker: not usable
  assert.equal(planTracks(sc({}), { ...base, trackerId: 'lk_box', roi: { kind: 'points', points: [[0.5, 0.5]] } })[0].action, 'needs-roi');
});

test('done: a scene linked to a live run, or wholly covered by a tracker run (not a camera reference); force re-tracks', () => {
  const s = sc({}, { tags: ['offscreen'] }, { continues: true }, {});
  const links = [{ t0: 0, t1: 1000, run: 'run3', channel: 'primary' }, { t0: 3000, t1: 4000, run: 'gone', channel: 'primary' }];
  const p = planTracks(s, { ...base, links, runs: [{ id: 'run3', t0: 0, t1: 1000 }] });
  assert.deepEqual(brief(p), [['S1 + S3', 'track', 'tapnext_points', [[2000, 3000]]], ['S2', 'skip', '', []], ['S4', 'track', 'tapnext_points', [[3000, 4000]]]]);   // a link to a gone run does not count
  assert.match(p[0].reason, /S1 already done/);
  const all = planTracks(s, { ...base, links, runs: [{ id: 'run3', t0: 0, t1: 1000 }, { id: 'run5', t0: 1000, t1: 4000 }, { id: 'cam', t0: 0, t1: 4000, tag: 'camera' }] });
  assert.deepEqual(all.map((x) => [x.label, x.action]), [['S1 + S3', 'done'], ['S2', 'skip'], ['S4', 'done']]);
  assert.equal(all[0].reason, 'linked to run3 (+1)');
  assert.equal(all[2].reason, 'covered by run5');
  assert.deepEqual(planTracks(s, { ...base, links, runs: [{ id: 'run3', t0: 0, t1: 4000 }], force: true }).map((x) => x.action), ['track', 'skip', 'track']);
});

test('camera tags: the item\'s default signal (runs-channel.js cameraDefault picks it after the run)', () => {
  const p = planTracks(sc({ tags: ['pan'] }, { tags: ['offscreen'] }, { continues: true, tags: ['orbit'] }, { tags: ['static'] }), base);
  assert.deepEqual(p.map((x) => [x.label, x.signal]), [['S1 + S3', 'proj_cam, who_pair_proj / fused'], ['S2', ''], ['S4', '']]);
  assert.deepEqual(p[0].cameras, ['pan', 'orbit']);
});

test('no tags, no describe: every scene is tracked on its own; no scenes: one item over the range', () => {
  assert.deepEqual(planTracks(sc({}, {}, {}), base).map((x) => [x.label, x.action]), [['S1', 'track'], ['S2', 'track'], ['S3', 'track']]);
  assert.deepEqual(brief(planTracks([], { ...base, range: { t0: 0, t1: 9000 } })), [['Whole range', 'track', 'tapnext_points', [[0, 9000]]]]);
  assert.deepEqual(planTracks([], base), []);
});

test('range + panelOnly (manual T): only the scenes the range touches, clipped; every piece takes the panel tracker', () => {
  const s = sc({}, { tags: ['offscreen'] }, { tags: ['internal'] }, { continues: true }, {});
  const p = planTracks(s, { ...base, range: { t0: 500, t1: 3500 }, panelOnly: true, force: true });
  // panelOnly: the internal view is an ordinary scene here, so S4 (continues) joins it
  assert.deepEqual(brief(p), [['S1', 'track', 'tapnext_points', [[500, 1000]]], ['S2', 'skip', '', []], ['S3–S4', 'track', 'tapnext_points', [[2000, 3500]]]]);
  assert.deepEqual([p[1].t0, p[1].t1], [1000, 2000]);
});

test('the timeline\'s tag readers and continues \'auto\' (a proposal) plan the same', () => {
  const o = { ...base, internal: isInternal, offscreen: isOffscreen, camera: sceneCamera };
  const p = planTracks(sc({ tags: ['zoom'] }, { tags: ['offscreen', 'zoom'] }, { continues: 'auto' }), o);
  assert.deepEqual(brief(p), [['S1 + S3', 'track', 'tapnext_points', [[0, 1000], [2000, 3000]]], ['S2', 'skip', '', []]]);
  assert.equal(p[0].signal, 'proj_cam');
  // the user removed the view tag ('-offscreen' after a describe said so): tracked
  assert.equal(planTracks(sc({}, { tags: ['offscreen', '-offscreen'] }), o)[1].action, 'track');
});

test('planSummary and scenesLabel', () => {
  const p = [...Array(12)].map(() => ({ action: 'track' })).concat([...Array(3)].map(() => ({ action: 'skip' })), [{ action: 'needs-roi' }, { action: 'needs-roi' }], [...Array(4)].map(() => ({ action: 'done' })));
  assert.equal(planSummary(p), '12 to track · 3 skipped · 2 need a box · 4 done');
  assert.equal(planSummary([{ action: 'needs-roi' }]), '1 needs a box');
  assert.equal(planSummary([]), '');
  assert.equal(scenesLabel([0, 1, 2, 5, 7, 8]), 'S1–S3 + S6 + S8–S9');
});

test('grid: with grid points given, a missing box becomes the whole-frame grid instead of needs-roi (action and internal scenes; points-only trackers still ask)', () => {
  const trackers = [{ id: 'tapnext_points', roi: 'box_or_points' }, { id: 'cotracker_points', roi: 'box_or_points' }, { id: 'sam2_mask', roi: 'box' }, { id: 'lk_two_point', roi: 'points' }];
  const scenes = [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 9000, tags: ['internal'] }];
  const p = planTracks(scenes, { trackers, trackerId: 'tapnext_points', params: { model: '512' }, grid: { points: 1024 } });
  assert.deepEqual(p.map((x) => [x.action, x.tracker, x.roi.w, x.params.box_points, x.params.model, !!x.grid]), [['track', 'tapnext_points', 1, 1024, '512', true], ['track', 'tapnext_points', 1, 1024, '512', true]]);
  assert.match(p[1].reason, /internal view, no box: whole-frame grid/);
  const q = planTracks(scenes, { trackers, trackerId: 'cotracker_points', grid: { points: 9999 } });   // capped at 4096, offline for CoTracker
  assert.equal(q[0].params.box_points, 4096); assert.equal(q[0].params.mode, 'offline');
  assert.equal(planTracks(scenes, { trackers, trackerId: 'lk_two_point', grid: { points: 512 } })[0].action, 'needs-roi');
  assert.equal(planTracks(scenes, { trackers, trackerId: 'tapnext_points' })[0].action, 'needs-roi');   // no grid option: the old rule
});

test('exposed: tracked (not skipped, even as an intro) with a points tracker on the whole-frame grid, for the seeded penis / balls groups', async () => {
  const { skipReason, isExposed } = await import('../src/features/timeline/acts.js');
  const s = sc({ tags: ['exposed'] }, { tags: ['exposed'], structure: 'intro' }, { tags: ['intro'] });
  const p = planTracks(s, { ...base, trackerId: 'lk_box', exposed: isExposed, skip: skipReason, grid: { points: 768 } });
  assert.deepEqual(p.map((x) => [x.label, x.action, x.tracker, !!x.grid]), [['S1', 'track', 'tapnext_points', true], ['S2', 'track', 'tapnext_points', true], ['S3', 'skip', '', false]]);
  assert.deepEqual(p[0].roi, { kind: 'box', x: 0, y: 0, w: 1, h: 1 });   // the whole frame even with a box drawn elsewhere
  assert.equal(p[0].params.box_points, 768);
  assert.match(p[0].reason, /^exposed: track for the throb \(penis\/balls scale\)/);
  // the panel's points tracker keeps its params; the defaults (raw tags) plan the same
  const q = planTracks(s, base);
  assert.deepEqual(q.map((x) => x.action), ['track', 'track', 'skip']);
  assert.equal(q[0].params.box_points, 512);   // no grid option: the grid's default point count
  assert.equal(q[0].params.box_seed, 'grid');
});
