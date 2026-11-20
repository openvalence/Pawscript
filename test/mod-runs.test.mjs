// paw-ef73.26: a modifier's own runs (its own seed frame and tracker, layered over the shot's run) and the assignment
// after the fact (timeline/mod-runs.js, mods-tracked.js sourcesOf / assignedOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureOf, measureSpans, trackChoices, seedFrameFor, setSeed, seedsOf, hasSeed, seedAt, modGroups, modTrackPlan, maskAt, ownRuns, modMeasure, trackerWord } from '../src/features/timeline/mod-runs.js';
import { sourcesOf, assignedOf, resolveTracked, sourceText } from '../src/features/timeline/mods-tracked.js';
import { seedTimes } from '../src/features/tracking/seed-marks.js';
import { overlayPick } from '../src/features/tracking/overlay-pick.js';
import { encodeRuns, decodeRuns } from '../src/lib/runs-file.js';
import { channelOf } from '../src/lib/runs.js';
import { splice } from '../src/lib/signal-source.js';

const M = (id, kind, t0, t1, o = {}) => ({ id, kind, t0, t1, params: {}, ...o });
const G = (name, t, o = {}) => { const [who, part] = name.split('_'); return { name, who, part, poly: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3]], t_ms: t, source: 'user', ...o }; };
const push = (t0, t1, a, b) => { const t = [], v = [], c = []; for (let x = t0; x < t1; x += 33) { t.push(x); v.push(x < a ? 0 : x > b ? 1 : (x - a) / (b - a)); c.push(1); } return { in: channelOf(t.map((x, i) => [x, v[i]])), conf: channelOf(t.map((x) => [x, 1])) }; };
const shaftRun = (id, o = {}) => { const p = push(0, 6000, 2000, 4000); return { id, tracker: 'sam2_mask', channels: { sem_c2_penis_in: p.in, sem_c2_penis_in_conf: p.conf }, modGroups: ['c2_penis', 'c1_anus'], ...o }; };

test('Track ▸ lists SAM first, then the trackers that take a painted seed; never a box-only one', () => {
  const ts = [{ id: 'lk_box', name: 'LK box', params: [] }, { id: 'tapnext_points', name: 'TAPNext++ points', params: [{ key: 'sem_groups' }] }, { id: 'sam2_mask', name: 'SAM', params: [] }];
  assert.deepEqual(trackChoices(ts).map((c) => c.id), ['sam2_mask', 'tapnext_points']);
  assert.equal(trackerWord('sam2_mask'), 'SAM');
});

test('the seed frame: the middle of the visible part of the modifier in the shot under the playhead, else its first such shot', () => {
  const sc = [{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 5000, tags: [{ id: 'blank' }] }, { start_ms: 5000, end_ms: 9000 }];
  const m = M('i', 'insertion', 1000, 7000);
  assert.equal(seedFrameFor(m, sc, 2), 6000);
  assert.equal(seedFrameFor(m, sc, 0), 1500);
  assert.equal(seedFrameFor(m, [], -1), 4000, 'no scenes: its middle');
});

test('its seed lives on the modifier: the seed frame, then corrections; an emptied correction goes', () => {
  let m = M('i', 'insertion', 1000, 4000);
  assert.equal(hasSeed(m), false);
  m = setSeed(m, 0, [G('c2_penis', 2000), G('c1_anus', 2000)], 2000);
  assert.equal(hasSeed(m), true);
  m = setSeed(m, 1, [G('c2_penis', 3000)], 3000);
  assert.deepEqual(seedsOf(m).map((s) => s.t_ms), [2000, 3000]);
  assert.equal(seedAt(m, 3010), 1);
  const req = modGroups(m);
  assert.deepEqual(req.map((g) => g.name), ['c2_penis', 'c1_anus']);
  assert.deepEqual(req[0].fixes, [{ t_ms: 3000, poly: G('c2_penis', 0).poly }], 'a correction of the same part = a fix');
  assert.equal(req[1].fixes, undefined);
  assert.equal(modGroups(m, { points: true })[0].shaft, true, 'a points run of an insertion asks for the shaft pass');
  assert.equal(modGroups(m, { points: true })[0].fixes, undefined, 'points trackers take one seed frame');
  assert.deepEqual(seedsOf(setSeed(m, 1, [], 0)).map((s) => s.t_ms), [2000]);
  const plan = modTrackPlan(m, 'sam2_mask');
  assert.deepEqual(plan.range, { start: 1000, end: 4000 });
  assert.deepEqual(plan.roi, { kind: 'box', x: 0, y: 0, w: 1, h: 1, t_ms: 2000 });
  assert.deepEqual(plan.seeds, [2000, 3000]);
  assert.ok(modTrackPlan(M('x', 'insertion', 0, 1), 'sam2_mask').why, 'nothing painted: nothing to track');
  assert.ok(modTrackPlan(M('x', 'idle', 0, 1, { seeds: m.seeds }), 'sam2_mask').why, 'idle is generated only');
});

test('unassigned (unnamed) paint is never sent; the groups keep their own frame', () => {
  const m = setSeed(M('i', 'insertion', 0, 4000), 0, [G('c2_penis', 1000), { name: 'unassigned1', poly: G('c2_penis', 0).poly, t_ms: 1000 }], 1000);
  assert.deepEqual(modGroups(m).map((g) => g.name), ['c2_penis']);
});

test('assignment: its own run, a part of the shot run, or none; deleting a run unassigns; the default is the one candidate', () => {
  const m = M('i', 'insertion', 1000, 5000), own = shaftRun('run7', { mod: 'i' }), shot = shaftRun('run2');
  assert.equal(sourcesOf(m, [own], shot).length, 2);
  assert.equal(assignedOf(m, [own], shot), null, 'two candidates, nothing chosen: generated');
  assert.equal(assignedOf(m, [], shot).auto, true, 'one candidate: today\'s default');
  const a = assignedOf({ ...m, src: { run: 'run7', ch: 'sem_c2_penis_in' } }, [own], shot);
  assert.equal(a.run, 'run7'); assert.equal(a.own, true);
  assert.equal(sourceText(a, trackerWord), 'tracked: SAM shaft · own run');
  const b = assignedOf({ ...m, src: { run: 'run2', ch: 'sem_c2_penis_in' } }, [own], shot);
  assert.equal(sourceText(b), 'tracked: penis · shot run');
  assert.equal(assignedOf({ ...m, src: 'none' }, [own], shot), null, 'none: generated');
  assert.equal(assignedOf({ ...m, src: { run: 'gone', ch: 'x' } }, [], shot).run, 'run2', 'its run deleted: back to the default');
  const r = resolveTracked([{ ...m, src: { run: 'run7' } }], () => shot, [], (x) => ownRuns([own, shot], x));
  assert.equal(r.by.get('i').run, 'run7');
  assert.equal(r.by.get('i').measured, true, 'an assigned shaft measure: the depth goes into the shot run points (stage 4)');
  assert.equal(r.list[0].muted, true, '... and its generated curve stays out of the way');
  const own2 = resolveTracked([{ ...m, params: { to: 5 }, src: { run: 'run7' } }], () => shot, [], (x) => ownRuns([own, shot], x));
  assert.ok(!own2.by.get('i').measured && !own2.list[0].muted && own2.list[0].params.to === 5, 'the owner own curve wins: fitted timing under it, as before');
  const auto = resolveTracked([m], () => shot, [], () => []);
  assert.ok(auto.by.get('i').auto && !auto.by.get('i').measured, 'a default (unassigned) source changes nothing: fitted timing as before');
});

test('the run\'s masks: the correction starts from the tracked outline of that part on that frame', () => {
  const big = [[0, 0], [0.5, 0], [0.5, 0.5]], small = [[0, 0], [0.1, 0], [0.1, 0.1]], other = [[0.6, 0.6], [0.9, 0.6], [0.9, 0.9]];
  const run = { modGroups: ['c2_penis', 'c1_anus'], frames: { t: [0, 33, 66], ov: [null, { masks: [small, big, other], mask_of: [0, 0, 1] }, null] } };
  assert.deepEqual(maskAt(run, 40, 'c2_penis'), big);
  assert.deepEqual(maskAt(run, 40, 'c1_anus'), other);
  assert.equal(maskAt(run, 200, 'c2_penis'), null);
});

test('its trace on the Tracker row: the inside fraction as depth; its seed marks are its own frames', () => {
  const mm = modMeasure(shaftRun('r', { mod: 'i' }));
  assert.equal(mm.label, 'inside');
  assert.equal(mm.v[0], 1); assert.equal(mm.v.at(-1), 0);
  assert.deepEqual(seedTimes({ seeds: [3000, 2000], range: { start: 0, end: 1 } }, [{ start_ms: 0, end_ms: 9, groups: [{ t_ms: 5 }] }]), [2000, 3000]);
});

test('the overlay shows a modifier run only while it is selected (its masks)', () => {
  const r = { id: 'm', tag: 'mod', mod: 'i', range: { start: 0, end: 1000 }, frames: { t: [0, 33], ov: [{ masks: [] }, { masks: [] }] }, scenes: [] };
  assert.equal(overlayPick({ runs: [r], t: 10 }), null);
  assert.equal(overlayPick({ runs: [r], selected: r, t: 10 }).run, r);
});

test('.pawruns keeps a modifier run\'s masks (they are what the owner sees and corrects), drops the others\'', () => {
  const base = { n: 1, color: '#fff', samples: { t: [0], v: [1] }, points: { at: new Float64Array(0), pos: new Float64Array(0) }, channels: {}, range: { start: 0, end: 33 } };
  const poly = [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]];
  const fr = () => ({ t: [0], v: [1], ov: [{ masks: [poly], mask_of: [0], boxes: [] }] });
  const [a, b] = decodeRuns(encodeRuns([{ ...base, id: 'a', mod: 'i', frames: fr() }, { ...base, id: 'b', frames: fr() }]));
  assert.deepEqual(a.frames.ov[0].masks, poly.length && [poly]);
  assert.equal(b.frames.ov[0].masks, undefined);
});

test('stage 4: the measure is the depth where SAM is confident, the shot signal elsewhere, cross-faded', () => {
  const m = M('i', 'insertion', 1000, 5000, { src: { run: 'run7', ch: 'sem_c2_penis_in' } }), run = shaftRun('run7', { mod: 'i' });
  const lowConf = { ...run, channels: { ...run.channels, sem_c2_penis_in_conf: channelOf(Array.from(run.channels.sem_c2_penis_in_conf.t, (t) => [t, t < 3000 ? 0.1 : 1])) } };
  const ch = measureOf(m, lowConf);
  assert.ok(ch.w[0] === 0 && ch.w.at(-1) === 1 && ch.v.at(-1) === 0, 'weight 0 where SAM is unsure, depth = 1 - inside');
  assert.equal(measureOf({ ...m, muted: true }, run), null);
  assert.equal(measureOf({ ...m, params: { mode: 'cycles' }, kind: 'knotting' }, run), null, 'knotting in cycles follows the strokes');
  const sp = measureSpans([m, M('o', 'orgasm', 0, 1)], [run]);
  assert.equal(sp.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(sp[0])), { t0: 1000, t1: 5000, mod: 'i', run: 'run7', ch: 'sem_c2_penis_in', n: sp[0].ch.t.length });
  // a base stroke (a 1 Hz sine) and the measure spliced: inside the confident part it follows the depth (sign aligned),
  // where the weight is 0 the base is untouched, outside the span the base sample for sample
  const t = [], v = [];
  for (let x = 0; x < 6000; x += 33) { t.push(x); v.push(Math.sin((2 * Math.PI * x) / 1000)); }
  const base = { t: Float64Array.from(t), v: Float32Array.from(v) };
  const out = splice(base, [{ t0: 1000, t1: 5000, ch: measureOf(m, lowConf) }], { lo: 0, hi: 6000 });
  const at = (x) => out.v[t.findIndex((q) => q >= x)], b = (x) => Math.fround(v[t.findIndex((q) => q >= x)]);
  assert.equal(at(500), b(500)); assert.equal(at(2000), b(2000), 'weight 0: the base');
  assert.ok(Math.abs(at(4500) - (-1)) < 0.05 || Math.abs(at(4500) - 1) < 0.05, `fully in: the base range's end (${at(4500)})`);
  assert.equal(at(5500), b(5500));
});
