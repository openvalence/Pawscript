// Scene quick bar logic (features/timeline/quickbar.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { barSpan, currentSpan, runFor, signalOf, trackerOptions, groupShares, tagItems, trackPicked, pickGroupFor, gridBlock, groupsButton, regionTrack } from '../src/features/timeline/quickbar.js';

const L = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 3000 }, { start_ms: 3000, end_ms: 4000 }];

const pick = (o) => (({ lo, hi, t0, t1, shots, shot, one, live }) => ({ lo, hi, t0, t1, shots, shot, one, ...(live !== undefined ? { live } : {}) }))(o);
const SEL = (active, shots) => ({ active, shots });

test('barSpan: only while the range is the hull of the selection (paw-k2u: a set of shots)', () => {
  assert.deepEqual(pick(barSpan(L, SEL(1, [1]), { t0: 1000, t1: 3000 })), { lo: 1, hi: 1, t0: 1000, t1: 3000, shots: [1], shot: 1, one: true });
  assert.deepEqual(pick(barSpan(L, SEL(2, [0, 1, 2]), { t0: 0, t1: 4000 })), { lo: 0, hi: 2, t0: 0, t1: 4000, shots: [0, 1, 2], shot: 2, one: false }, 'several shots, three scenes');
  assert.deepEqual(pick(barSpan(L, SEL(2, [2]), { t0: 3000, t1: 3900 }, 3900)), { lo: 2, hi: 2, t0: 3000, t1: 3900, shots: [2], shot: 2, one: true }, 'end clamped to the duration');
  assert.equal(barSpan(L, SEL(1, [1]), null), null, 'range cleared (Esc) hides it');
  assert.equal(barSpan(L, SEL(1, [1]), { t0: 1000, t1: 2000 }), null, 'another range hides it');
  assert.equal(barSpan(L, SEL(-1, []), { t0: 0, t1: 1000 }), null, 'nothing selected');
  assert.equal(barSpan(L, SEL(5, [5]), { t0: 0, t1: 1000 }), null, 'stale index');
  assert.equal(barSpan(L, SEL(0, [0, 2]), { t0: 0, t1: 4000 }).text, '2 shots');   // paw-2lp7.5: shots numbered through the video
});

test('currentSpan: the live selection, else the selection, else the scene at the playhead', () => {
  const L = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 3000 }, { start_ms: 3000, end_ms: 5000 }];
  assert.deepEqual(pick(currentSpan(L, SEL(1, [1]), { t0: 1000, t1: 3000 }, 4000)), { lo: 1, hi: 1, t0: 1000, t1: 3000, shots: [1], shot: 1, one: true, live: true });
  assert.deepEqual(pick(currentSpan(L, SEL(1, [1]), null, 4000)), { lo: 1, hi: 1, t0: 1000, t1: 3000, shots: [1], shot: 1, one: true, live: false }, 'selected, range elsewhere');
  assert.deepEqual(pick(currentSpan(L, SEL(-1, []), null, 4000)), { lo: 2, hi: 2, t0: 3000, t1: 5000, shots: [2], shot: 2, one: true, live: false }, 'the playhead');
  assert.deepEqual(pick(currentSpan(L, SEL(-1, []), null, 9000, 4500)), { lo: 2, hi: 2, t0: 3000, t1: 4500, shots: [2], shot: 2, one: true, live: false }, 'past the end: the last scene, clipped');
  assert.equal(currentSpan([], SEL(-1, []), null, 0), null);
  // scenes contain shots: nothing selected = the scene at the playhead, the shot under it is the one the bar reads
  const M = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 3000, join: true }, { start_ms: 3000, end_ms: 5000 }];
  assert.deepEqual(pick(currentSpan(M, SEL(-1, []), null, 1500)), { lo: 0, hi: 1, t0: 0, t1: 3000, shots: [0, 1], shot: 1, one: true, live: false });
  const two = currentSpan(M, SEL(1, [0, 1]), { t0: 0, t1: 3000 }, 0);
  assert.deepEqual([two.shot, two.text, two.live], [1, 'Shots 1 to 2', true], 'the whole scene selected');
  assert.equal(currentSpan(M, SEL(1, [1]), { t0: 1000, t1: 3000 }, 0).text, 'Shot 2');
});

test('runFor: the linked run, else the selected run', () => {
  const runs = { run1: { id: 'run1', channel: 'primary' }, run2: { id: 'run2', channel: 'g2_proj' } };
  const T = (links, selected) => ({ sceneLink: (i) => links[i] ?? null, run: (id) => runs[id] ?? null, selected: selected ? runs[selected] : null });
  assert.equal(runFor(T({ 0: { runId: 'run2', channel: 'g3_proj' } }, 'run1'), 0).id, 'run2', 'linked wins');
  assert.equal(runFor(T({}, 'run1'), 0).id, 'run1', 'no link: selected');
  assert.equal(runFor(T({ 0: { runId: 'gone' } }, 'run1'), 0).id, 'run1', 'link to a removed run: selected');
  assert.equal(runFor(T({}, null), 0), null);
  assert.equal(runFor({ selected: runs.run1 }, 0).id, 'run1', 'store without sceneLink (before it lands)');
  assert.equal(runFor(null, 0), null);
  assert.equal(signalOf(T({ 0: { runId: 'run2', channel: 'g3_proj' } }), 0, runs.run2), 'g3', 'the channel of the link');
  assert.equal(signalOf(T({}), 0, runs.run2), 'g2', 'else the channel of the run');
  assert.equal(signalOf(T({}), 0, null), '');
});

test('tracker options: point trackers first', () => {
  const o = trackerOptions([{ id: 'lk_box', name: 'LK', roi: 'box' }, { id: 'cotracker_points', name: 'Co', roi: 'box' }, { id: 'pips', name: 'P', roi: 'points' }, { id: 'sam2_mask', name: 'SAM', roi: 'box' }]);
  assert.deepEqual(o.map((x) => x.value), ['cotracker_points', 'pips', 'lk_box', 'sam2_mask']);
  assert.deepEqual(o[0], { value: 'cotracker_points', label: 'Co' });
});

test('group shares: mean member share over the span', () => {
  const ch = (v) => ({ t: [0, 500, 1000, 1500, 2000], v });
  const run = { channels: { g1_n: ch([1, 0.5, 0.25, NaN, 0]), g2_n: ch([0, 0.5, 0.75, 0.5, 1]), g3_n: ch([0, 0, 0, 0, 0]) } };
  const s = groupShares(run, 500, 2000);
  assert.equal(s[0], 0.375); assert.ok(Math.abs(s[1] - 1.75 / 3) < 1e-12); assert.equal(s[2], 0); assert.ok(Number.isNaN(s[3]));
  assert.equal(groupShares({ channels: {} }, 0, 1), null, 'not a grid run');
  assert.equal(groupShares(null, 0, 1), null);
});

test('tag items: a section per category, aliases first under What, (detected) from the describe, ids routed, Reset only after a change', () => {
  const got = [], s = { start_ms: 0, end_ms: 1, describe: { tags: [{ tag: 'anal_penetration', score: 0.9 }] } };
  const items = tagItems(s, (id) => got.push(id));
  assert.deepEqual(items.filter((x) => x.section).map((x) => x.section), ['View', 'Where', 'What', 'Camera', 'Angle', 'Structure'], 'no Modifiers: never a scene tag (paw-8b4h); Angle: paw-2pcf');
  const anal = items.find((x) => x.label === 'anal (detected)');
  assert.equal(anal.checked, true);
  anal.run(); items.find((x) => x.label === 'fingering').run(); items.find((x) => x.label?.startsWith('rimming')).run();
  assert.deepEqual(got, ['anal', 'fingering', 'rimming']);
  assert.equal(items.some((x) => x.label === 'Reset to describe'), false);
  const what = tagItems({ ...s, tags: ['licking'] }, (id) => got.push(id), ['what']);
  assert.deepEqual(what.filter((x) => x.section).map((x) => x.section), ['What']);
  assert.equal(what.find((x) => x.label?.startsWith('rimming')).checked, true);              // anal (describe) + licking
  what.at(-1).run();
  assert.equal(got.at(-1), null);
});

test('the toolbar chips: what the Scene and Shot chips say, and their notes (paw-hmn)', async () => {
  const { chipTexts } = await import('../src/features/timeline/quickbar.js');
  // a Knotting modifier over scene 1 (mods.js withMods projects it): the chip says the action only (paw-8b4h)
  const K = { id: 'knotting', t0: 0, t1: 20 };
  const L = [{ start_ms: 0, end_ms: 10, tags: ['anal', 'penetration', K], offers: [{ t0: 0, t1: 10, tags: ['oral'] }] },
    { start_ms: 10, end_ms: 20, join: true, tags: ['anal', 'penetration', K, 'pan', 'internal'], offers: [{ t0: 0, t1: 10, tags: ['oral'] }],
      groups: [{ name: 'c1_penis', t_ms: 15, unconfirmed: true, poly: [[0, 0], [1, 0], [1, 1]] }] },
    { start_ms: 20, end_ms: 30 }, { start_ms: 30, end_ms: 40, tags: ['fingering'] }];
  const c = chipTexts(L, currentSpan(L, SEL(1, [1]), null, 0));
  assert.equal(c.scene.text, 'Scene 1 · anal penetration'); assert.equal(c.shot.text, 'Shot 2 · pan · internal');
  assert.deepEqual(c.scene.notes, ['1 offered by a merge']); assert.equal(c.shot.notes.length, 1, 'a group to confirm');
  const u = chipTexts(L, currentSpan(L, SEL(2, [2]), null, 0));
  assert.deepEqual([u.scene.text, u.scene.untagged, u.shot.text], ['Scene 2 · untagged', true, 'Shot 3']);
  assert.deepEqual(chipTexts(L, currentSpan(L, SEL(3, [3]), null, 0), { fillNeed: 'Cannot fill: x' }).scene.notes, ['needs a where', 'Cannot fill: x']);
  const m = chipTexts(L, currentSpan(L, SEL(0, [0, 1, 2]), null, 0));
  assert.deepEqual([m.scene.text, m.shot.text, m.shot.tip], ['Scenes 1 to 2', '3 shots', 'Shots 1 to 3'], 'several shots: how many (paw-unuy: the Shots strip shows which), the words in the tooltip');
  assert.equal(chipTexts(L, currentSpan(L, SEL(0, [0, 1]), null, 0)).shot.text, '2 shots');
  assert.equal(chipTexts(L, null), null);
});

test('trackPicked: one Track (paw-t8z): only a set of shots that is not one unbroken run goes to trackShots', () => {
  const got = [], T = { trackShots: (s) => got.push(s) };
  assert.equal(trackPicked(T, barSpan(L, SEL(0, [0, 2]), { t0: 0, t1: 4000 })), true);
  assert.deepEqual(got, [[0, 2]]);
  assert.equal(trackPicked(T, barSpan(L, SEL(0, [0, 1]), { t0: 0, t1: 3000 })), false);   // unbroken: the range
  assert.equal(trackPicked(T, barSpan(L, SEL(1, [1]), { t0: 1000, t1: 3000 })), false);
  assert.equal(trackPicked(T, null), false);
  assert.equal(got.length, 1);
});

test('pickGroupFor: the group becomes the signal and the shot\'s scene is linked to it (paw-t8z: quick bar and panel legend alike)', () => {
  const calls = [], T = { pickGroup: (k, id) => calls.push(['pick', k, id]), linkScene: (i, id, ch) => calls.push(['link', i, id, ch]) };
  pickGroupFor(T, 2, 'r1', 4);
  pickGroupFor(T, 1, 'r1', -1);   // no scene: the pick only
  assert.deepEqual(calls, [['pick', 2, 'r1'], ['link', 4, 'r1', 'g2_proj'], ['pick', 1, 'r1']]);
});

test('paw-rw84: Track (grid) says why it cannot run; the Groups button: enabled, pressed, the take\'s painted groups', () => {
  assert.equal(gridBlock({ canGrid: true, gridTracker: {} }), '');
  assert.equal(gridBlock({ canGrid: false, gridTracker: { id: 'tapnext_points' } }), 'Busy: wait for the current tracker job');
  assert.equal(gridBlock({ canGrid: false, gridTracker: null }), 'Grid needs a point tracker (TAPNext++, which needs a CUDA GPU)');
  // paw-u0ik: with the CPU tracker listed, how to use it instead
  assert.match(gridBlock({ canGrid: false, gridTracker: null, trackers: [{ id: 'lk_box' }] }, 'Ctrl+T'), /Optical flow \(box\) follows a painted part: paint it with Groups \(Tab\), then Ctrl\+T \(Track ROI\)$/);
  const poly = [[0, 0], [1, 0], [1, 1]];
  const g = (name, t_ms, extra = {}) => ({ name, t_ms, poly, ...extra });
  // shot 0 and shot 1 are one take (a camera move: join + take): its groups count on both; shot 2 is its own take
  const list = [
    { start_ms: 0, end_ms: 1000, groups: [g('c1_hips', 100), g('c2_penis', 100), g('ignore', 100), g('c1_mouth', 200, { source: 'seeder' }), g('unassigned_1', 150)] },
    { start_ms: 1000, end_ms: 2000, join: true, take: true, groups: [g('c1_hips', 100), g('c2_penis', 100), g('ignore', 100), g('c1_mouth', 200, { source: 'seeder' }), g('unassigned_1', 150)] },
    { start_ms: 2000, end_ms: 3000, groups: [] },
  ];
  const on = { media: { path: 'x.mp4' }, mode: 'track', on: false };
  assert.deepEqual(groupsButton(list, 0, on), { count: 3, enabled: true, pressed: false }, 'ignore regions and suggestions are not counted');
  assert.equal(groupsButton(list, 2, on).count, 0);
  assert.equal(groupsButton(list, -1, on).count, 0);
  assert.equal(groupsButton(list, 0, { ...on, mode: 'refine' }).enabled, false, 'the Track tab only, as G');
  assert.equal(groupsButton(list, 0, { ...on, media: null }).enabled, false);
  assert.equal(groupsButton(list, 0, { ...on, on: true }).pressed, true);
});

test('regionTrack: a selected action region is the range, told its tags; a positioning range or parts painted only outside refuse (paw-qoo5)', () => {
  const SQ = [[0.3, 0.3], [0.4, 0.3], [0.4, 0.4]], G = (t) => ({ name: 'c1_hips', who: 'c1', part: 'hips', poly: SQ, t_ms: t });
  const shot = [{ start_ms: 0, end_ms: 12000 }];
  const a = { id: 'a', kind: 'act', t0: 2000, t1: 4500, layer: 0, tags: ['slit', 'masturbation'] }, b = { ...a, id: 'b', t0: 6000, t1: 8500, tags: ['slit', 'penetration'] };
  assert.equal(regionTrack(null, shot), null, 'none selected: Track as before');
  assert.deepEqual(regionTrack(b, shot), { t0: 6000, t1: 8500, tags: ['slit', 'penetration'] }, 'its span and its own tags');
  assert.deepEqual(regionTrack({ ...b, t1: 15000 }, shot, 12000), { t0: 6000, t1: 12000, tags: ['slit', 'penetration'] }, 'end held to the video');
  assert.deepEqual(regionTrack({ ...b, layer: 1, mix: 'mix', tags: ['handjob'] }, shot).tags, ['handjob'], 'a secondary layer region: its own tags');
  assert.match(regionTrack({ ...b, kind: 'positioning', tags: [] }, shot).why, /positioning range is not an action/);
  assert.match(regionTrack({ ...b, kind: 'rest', tags: [] }, shot).why, /^Rest is not an action/);
  const painted = [{ ...shot[0], groups: [G(1000)] }];
  assert.equal(regionTrack(b, painted).why, 'Paint the parts on a frame inside this action first', 'parts painted in the shot, none inside the region');
  assert.deepEqual(regionTrack(b, [{ ...shot[0], groups: [G(1000), G(7000)] }]).t0, 6000, 'a painted frame inside it: tracked');
  assert.deepEqual(regionTrack(b, shot).t1, 8500, 'nothing painted anywhere: the grid alone, as for any range');
  assert.deepEqual(regionTrack({ ...a, t1: 9000 }, [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 12000 }]), { t0: 2000, t1: 9000, tags: ['slit', 'masturbation'] }, 'over a cut: one range across it (reseeded there, as any range)');
});
