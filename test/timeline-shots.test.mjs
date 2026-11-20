// Scenes contain shots (paw-2zy): src/features/timeline/shots.js and the libs that read scene membership.
import assert from 'node:assert/strict';
import test from 'node:test';
import { sceneRuns, sceneRange, takeRange, sceneNo, sameScene, normScenes, splitShot, splitScene, mergeScenes, mergeScenesIn, mergeShots, setTake,
  acceptOffer, dropOffer, groupShots, migrateScenes, toSaved, fromSaved, isActTag, sceneSpanOf } from '../src/features/timeline/shots.js';
import { sceneTags, tagSpan, setTagStart } from '../src/features/timeline/acts.js';
import { setTags } from '../src/features/timeline/scenes.js';
import { cleanScenes } from '../src/app/project-logic.js';
import { continuations } from '../src/lib/scenes-continue.js';
import { planTracks } from '../src/lib/track-plan.js';
import { trackCuts } from '../src/lib/protocol.js';
import { stitchPoints } from '../src/lib/runs-channel.js';
import { trackGroups } from '../src/features/tracking/groups.js';
import { parse as parseProject, serialize as serializeProject } from '../src/lib/io/index.js';
import { appDocFrom, projectDoc } from '../src/app/project-logic.js';

const S = (a, b, o = {}) => ({ start_ms: a, end_ms: b, ...o });
const spans = (l) => l.map((s) => [s.start_ms, s.end_ms]);
const grp = (name, t) => ({ name, poly: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]], pinned: true, t_ms: t });

test('runs, ranges, takes, scene numbers', () => {
  const l = [S(0, 10), S(10, 20, { join: true }), S(20, 30, { join: true, split: 'camera' }), S(30, 40), S(40, 50, { join: false })];
  assert.deepEqual(sceneRuns(l), [[0, 2], [3, 3], [4, 4]]);
  assert.deepEqual(sceneRange(l, 1), [0, 2]); assert.deepEqual(takeRange(l, 2), [1, 2]); assert.deepEqual(takeRange(l, 0), [0, 0]);
  assert.deepEqual(l.map((_, i) => sceneNo(l, i)), [0, 0, 0, 1, 2]);
  assert.ok(sameScene(l, 0, 2)); assert.ok(!sameScene(l, 2, 3));
  assert.deepEqual(spans([sceneSpanOf(l, 1)]), [[0, 30]]);
  assert.ok(isActTag('anal') && isActTag('-knotting') && isActTag({ id: 'orgasm', t0: 1 }) && !isActTag('pan') && !isActTag('internal') && !isActTag('zzz'));
});

test('normScenes: one shot edited -> its scene follows; view / camera tags stay per shot; same list when consistent', () => {
  const l = normScenes([S(0, 10, { tags: ['anal', 'penetration'] }), S(10, 20, { join: true, tags: ['anal', 'penetration', 'pan'] }), S(20, 30, { tags: ['oral'] })]);
  assert.equal(normScenes(l, l), l);
  const edited = setTags(l, 1, ['anal', 'penetration', 'kissing', 'pan']);   // a writer that only knows shot 1
  const n = normScenes(edited, l);
  assert.ok(sceneTags(n[0]).includes('kissing') && sceneTags(n[1]).includes('kissing') && !sceneTags(n[2]).includes('kissing'));
  assert.ok(sceneTags(n[1]).includes('pan') && !sceneTags(n[0]).includes('pan'), 'the camera tag is the shot\'s');
  // groups written on one shot belong to the scene
  const g = normScenes(l.map((s, k) => (k === 0 ? { ...s, groups: [grp('c1_penis', 5)] } : s)), l);
  assert.equal(g[1].groups, g[0].groups); assert.equal(g[2].groups, undefined);
  // the first shot never joins; a camera split always does
  assert.deepEqual(normScenes([S(0, 10, { join: true }), S(10, 20, { split: 'camera' })]).map((s) => s.join), [undefined, true]);
});

test('scene_describe: a multi-shot scene takes its acts from the first described shot, views stay the shot\'s', () => {
  const dA = { summary: { acts: ['anal_penetration'] }, tags: [] }, dX = { summary: { acts: ['fellatio'], views: ['x-ray_view'] }, tags: [] };
  const l = normScenes([S(0, 10, { describe: dA }), S(10, 20, { join: true, describe: dX })]);
  assert.equal(l[1].scene_describe, dA);
  assert.deepEqual(sceneTags(l[1]).filter((t) => t !== 'internal'), sceneTags(l[0]));
  assert.ok(sceneTags(l[1]).includes('internal') && !sceneTags(l[0]).includes('internal'));
  assert.equal(normScenes([S(0, 10, { describe: dA, scene_describe: dX })])[0].scene_describe, undefined, 'a one-shot scene uses its own');
});

test('split / merge shots and scenes', () => {
  const base = normScenes([S(0, 1000, { tags: ['anal', 'penetration'], camera: [{ t0: 0, t1: 400, kind: 'static' }, { t0: 400, t1: 1000, kind: 'pan' }] }), S(1000, 2000, { tags: ['oral'] })]);
  const a = splitShot(base, 400, 10);
  assert.deepEqual(spans(a), [[0, 400], [400, 1000], [1000, 2000]]);
  assert.equal(a[1].join, true); assert.equal(a[1].split, undefined, 'a hard cut until setTake');
  assert.deepEqual(a[0].camera.map((g) => g.kind), ['static']); assert.deepEqual(a[1].camera.map((g) => g.kind), ['pan']);
  assert.equal(setTake(a, 1, true)[1].split, 'camera'); assert.equal(setTake(a, 0, true), null);
  assert.deepEqual(spans(mergeShots(a, 0)), [[0, 1000], [1000, 2000]]);
  assert.equal(mergeShots(a, 1), null, 'not across a scene cut');
  // split scene at a shot cut and inside a shot
  const b = splitScene(a, 400, 10);
  assert.equal(b[1].join, false); assert.deepEqual(sceneRuns(b), [[0, 0], [1, 1], [2, 2]]);
  assert.ok(sceneTags(b[1]).includes('anal'), 'both halves keep the scene\'s tags');
  const c = splitScene(base, 700, 10);
  assert.deepEqual(spans(c), [[0, 700], [700, 1000], [1000, 2000]]); assert.deepEqual(sceneRuns(c), [[0, 0], [1, 1], [2, 2]]);
  assert.equal(splitScene(base, 1000, 10), null, 'already a scene cut');
});

test('merge scenes: the earlier scene wins, the later one is offered (and comes back on a split there)', () => {
  const l = normScenes([S(0, 1000, { tags: ['anal', 'penetration'], groups: [grp('c1_penis', 500)] }), S(1000, 2000, { tags: ['oral', 'penetration'], groups: [grp('c1_penis', 1500)], fill: 'timing' })]);   // paw-2lp7.4: 'timing', the one fill left
  const m = mergeScenes(l, 0);
  assert.deepEqual(sceneRuns(m), [[0, 1]]);
  assert.ok(sceneTags(m[1]).includes('anal') && !sceneTags(m[1]).includes('oral'));
  assert.equal(m[1].groups.length, 1); assert.equal(m[1].groups[0].t_ms, 500, 'the earlier scene\'s groups are THE groups');
  assert.equal(m[0].offers.length, 1);
  const o = m[0].offers[0];
  assert.deepEqual([o.t0, o.t1, o.tags, o.groups.length, o.fill], [1000, 2000, ['oral', 'penetration'], 1, undefined]);
  assert.deepEqual([m[0].fill, m[1].fill], [undefined, 'timing'], 'paw-sxu: a fill is a shot fact: a merge keeps it there, nothing offered');
  // split back at the cut: the offer returns to the second scene
  const s = splitScene(m, 1000, 10);
  assert.ok(sceneTags(s[1]).includes('oral') && s[1].fill === 'timing' && s[1].groups[0].t_ms === 1500 && !s[0].offers && !s[1].offers);
  // accept: tags over the offer's span, groups added; drop: gone
  const acc = acceptOffer(m, 1, 0);
  assert.equal(acc[0].offers, undefined); assert.equal(acc[1].groups.length, 2);
  assert.deepEqual(tagSpan(acc[1], 'oral'), { t0: 1000, t1: 2000 }); assert.equal(tagSpan(acc[0], 'oral'), null);
  assert.equal(dropOffer(m, 0, 0)[1].offers, undefined);
  assert.equal(mergeScenes(l, 1), null);
  assert.deepEqual(sceneRuns(mergeScenesIn(normScenes([S(0, 10), S(10, 20), S(20, 30)]), 5, 25)), [[0, 2]]);
});

test('a tag edge set in a later shot is a scene span (setTagStart on the scene span)', () => {
  const l = normScenes([S(0, 1000, { tags: ['anal', 'penetration', 'kissing'] }), S(1000, 2000, { join: true })]);
  const tags = setTagStart(sceneSpanOf(l, 1), 'kissing', 1500);
  const n = normScenes(setTags(l, 1, tags), l);
  assert.equal(tagSpan(n[0], 'kissing'), null); assert.deepEqual(tagSpan(n[1], 'kissing'), { t0: 1500, t1: 2000 });
  // back at the scene's start: the whole scene again
  const S1 = sceneSpanOf(n, 1);
  assert.deepEqual(tagSpan({ ...S1, tags: setTagStart(S1, 'kissing', 0) }, 'kissing'), { t0: 0, t1: 2000 });
});

test('migration: links and same-act neighbours become one scene, nothing lost', () => {
  const old = [
    S(0, 1000, { tags: ['intro'] }),
    S(1000, 2000, { tags: ['anal', 'penetration'], groups: [grp('c1_penis', 1200)] }),
    S(2000, 3000, { tags: ['offscreen'] }),                                                  // a cutaway
    S(3000, 4000, { tags: ['anal', 'penetration', 'static'], continues: true, groups: [grp('c1_penis', 3500)] }),
    S(4000, 5000, { tags: ['anal', 'penetration', 'pan'], split: 'camera', continues: true }),
    S(5000, 6000, { tags: ['anal', 'penetration'], continues: false }),                       // the owner said no
    S(6000, 7000, { tags: ['oral', 'penetration'] }),
    S(7000, 8000, { tags: ['oral', 'penetration'], fill: 'after' }),                          // a fill differs: not one act
  ];
  const l = migrateScenes(old);
  assert.deepEqual(spans(l), spans(old), 'each old scene is a shot');
  assert.deepEqual(sceneRuns(l), [[0, 0], [1, 4], [5, 5], [6, 6], [7, 7]]);
  assert.ok(l.every((s) => s.continues !== true), 'continues true became the join'); assert.equal(l[5].continues, false);
  assert.equal(l[4].split, 'camera');
  // tags: the camera / view tags per shot
  assert.ok(sceneTags(l[3]).includes('static') && !sceneTags(l[1]).includes('static'));
  assert.ok(sceneTags(l[2]).includes('offscreen') && !sceneTags(l[1]).includes('offscreen') && sceneTags(l[4]).includes('pan'));
  for (const k of [1, 2, 3, 4]) assert.ok(sceneTags(l[k]).includes('anal'), `shot ${k} is the anal scene`);
  // groups: both kept, each on its frame -> each shot still seeds from its own
  assert.equal(l[1].groups.length, 2);
  assert.deepEqual(trackGroups(l, 3000, 4000).map((g) => g.t_ms), [3500]); assert.deepEqual(trackGroups(l, 1000, 2000).map((g) => g.t_ms), [1200]);
  // the cutaway inside the scene is still a cutaway (bridged), the tracker reseeds at the hard cut, runs through the pan
  assert.deepEqual(continuations(l).map((c) => [c.a, c.b0, c.b1, c.c]), [[1, 2, 2, 3]]);
  assert.deepEqual(trackCuts('document', l, 0, 8000).filter((c) => c.t_ms > 1000 && c.t_ms < 6000).map((c) => [c.t_ms, c.kind]), [[2000, 'hard'], [3000, 'hard'], [4000, 'soft'], [5000, 'hard']]);
  // idempotent through save / load
  assert.deepEqual(fromSaved(toSaved(l)), l);
});

test('migration of a linked join whose later shot differs in fill: the later fill is offered', () => {
  const l = migrateScenes([S(0, 1000, { tags: ['anal'] }), S(1000, 2000, { split: 'camera', continues: true, fill: 'both' })]);
  assert.deepEqual(sceneRuns(l), [[0, 1]]);
  assert.equal(l[1].fill, undefined); assert.equal(l[0].offers[0].fill, 'both');
});

test('groupShots joins same-act neighbours but never across the owner\'s split', () => {
  const l = normScenes([S(0, 10, { tags: ['vaginal', 'penetration'] }), S(10, 20, { tags: ['vaginal', 'penetration'] }), S(20, 30, { tags: ['vaginal', 'penetration'], join: false }), S(30, 40, { tags: [] })]);
  assert.deepEqual(sceneRuns(groupShots(l)), [[0, 1], [2, 2], [3, 3]]);
  const plain = normScenes([S(0, 10), S(10, 20)]);
  assert.equal(groupShots(plain), plain, 'no tags: no evidence');
});

test('saved shape: nested scenes with their shots; old projects load and round-trip', () => {
  const l = migrateScenes([S(0, 1000, { tags: ['anal', 'penetration'] }), S(1000, 2000, { tags: ['anal', 'penetration', 'zoom'], describe: { tags: [{ tag: 'x', score: 1 }] } }), S(2000, 3000, { tags: ['oral'] })]);
  const saved = toSaved(l);
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[0].tags, ['anal', 'penetration']); assert.equal(saved[0].shots.length, 2);
  assert.deepEqual(saved[0].shots[1].tags, ['zoom']); assert.ok(saved[0].shots[1].describe && !('scene_describe' in saved[0].shots[1]) && !('join' in saved[0].shots[1]));
  assert.deepEqual(fromSaved(saved), l);
  const apart = splitScene(normScenes([S(0, 10, { tags: ['anal'] }), S(10, 20, { join: true })]), 10, 1);
  assert.equal(toSaved(apart)[1].apart, true); assert.equal(fromSaved(toSaved(apart))[1].join, false);
  // through the project file: an old flat project, then this format
  const pd = parseProject(serializeProject({ axes: { stroke: [] }, extra: { scenes: [S(0, 900, { tags: ['anal', 'penetration'] }), S(900, 1800, { tags: ['anal', 'penetration'] })] } }));
  const doc = appDocFrom(pd);
  assert.deepEqual(sceneRuns(doc.scenes), [[0, 1]]);
  const again = appDocFrom(parseProject(serializeProject(projectDoc({ ...doc, axes: { stroke: [] }, chapters: [], bookmarks: [], loops: [], plan: [], ghosts: [], project: null }))));
  assert.deepEqual(again.scenes, doc.scenes);
  assert.deepEqual(cleanScenes([S(0, 0), S(0, 900)]), [S(0, 900)]);
});

test('Track tagged scenes: one item per scene, its shots in one segment, cutaways skipped inside it', () => {
  const l = migrateScenes([S(0, 1000, { tags: ['anal', 'penetration'] }), S(1000, 2000, { tags: ['anal', 'penetration'] }), S(2000, 3000, { tags: ['offscreen'] }),
    S(3000, 4000, { tags: ['anal', 'penetration'], continues: true }), S(4000, 5000, { tags: ['oral', 'penetration'] })]);
  assert.deepEqual(sceneRuns(l), [[0, 3], [4, 4]]);
  const p = planTracks(l, { trackerId: 't', trackers: [{ id: 't', roi: 'none' }] });
  const items = p.filter((x) => x.action === 'track');
  assert.deepEqual(items.map((x) => x.sceneIdx), [[0, 1, 3], [4]]);
  assert.deepEqual(items[0].segments, [[0, 2000], [3000, 4000]]);
  assert.equal(p.find((x) => x.action === 'skip').sceneIdx[0], 2);
  // a scene boundary is a new item even with the same tags
  const two = normScenes([S(0, 1000, { tags: ['anal'] }), S(1000, 2000, { tags: ['anal'], join: false })]);
  assert.equal(planTracks(two, { trackerId: 't', trackers: [{ id: 't', roi: 'none' }] }).length, 2);
});

test('stitching carries the level across a hard cut inside a scene, not across a scene cut', () => {
  const strokes = (t0, t1, lo, hi) => { const o = []; for (let t = t0 + 250, k = 0; t < t1 - 40; t += 500, k++) o.push({ at: t, pos: k % 2 ? lo : hi }); return o; };
  const P = (...p) => { const a = p.flat(); return { at: Float64Array.from(a, (q) => q.at), pos: Float64Array.from(a, (q) => q.pos) }; };
  const run = { scenes: [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 10000 }], channels: {} };
  const pts = P(strokes(0, 5000, 10, 50), strokes(5000, 10000, 55, 95));
  const lvl = (p) => { const r = Array.from(p.at, (at, i) => ({ at, pos: p.pos[i] })).filter((q) => q.at >= 5300); return r.reduce((s, q) => s + q.pos, 0) / r.length; };
  const joined = stitchPoints(pts, run, [], {}, { scenes: [S(0, 5000), S(5000, 10000, { join: true })] });
  const apart = stitchPoints(pts, run, [], {}, { scenes: [S(0, 5000), S(5000, 10000)] });
  assert.ok(Math.abs(lvl(joined.points) - 30) < 8, `carried to the level before (${lvl(joined.points)})`);
  assert.ok(Math.abs(lvl(apart.points) - 75) < 8, `a scene cut keeps its own centre (${lvl(apart.points)})`);
  assert.ok(joined.stitches[0].carry && !apart.stitches[0].carry);
});

test('groups per take: the Groups tool sees the groups drawn in its take, writes keep the other takes', async () => {
  const { takeGroups, setTakeGroups, otherTakeGroups } = await import('../src/features/tracking/groups.js');
  const l = normScenes([S(0, 1000, { groups: [grp('c1_penis', 500), grp('c1_penis', 2500)] }), S(1000, 2000, { join: true, split: 'camera' }), S(2000, 3000, { join: true })]);
  assert.deepEqual(takeGroups(l, 1).map((g) => g.t_ms), [500], 'shots 1-2 are one take');
  assert.deepEqual(takeGroups(l, 2).map((g) => g.t_ms), [2500], 'after the hard cut: its own');
  assert.deepEqual(otherTakeGroups(l, 2).map((g) => g.t_ms), [500]);
  const n = setTakeGroups(l, 2, [grp('c2_hips', 2600)]);
  assert.deepEqual(normScenes(n, l)[0].groups.map((g) => g.t_ms).sort(), [2600, 500].sort());
});

test('a signal pick reaches the scene\'s other shots on the run, not a camera-handling channel', async () => {
  const { inheritTargets } = await import('../src/features/timeline/shots.js');
  const l = normScenes([S(0, 1000), S(1000, 2000, { join: true }), S(2000, 3000, { join: true }), S(3000, 4000)]);
  assert.deepEqual(inheritTargets(l, 0, { t0: 0, t1: 2600 }, 'sem_c1_penis_proj'), [1, 2]);
  assert.deepEqual(inheritTargets(l, 0, { t0: 0, t1: 2400 }, 'g2_proj'), [1], 'the run covers less than half of shot 3');
  assert.deepEqual(inheritTargets(l, 0, { t0: 0, t1: 4000 }, 'proj_cam'), [], 'camera handling stays per shot');
  assert.deepEqual(inheritTargets(l, 3, { t0: 0, t1: 4000 }, 'g1_proj'), [], 'another scene');
});

test('stabilised preview: the camera drift at t, and the picture matrix shifted by it', async () => {
  const { cameraDrift } = await import('../src/features/tracking/blobs.js');
  const { shifted, apply } = await import('../src/features/video/view.js');
  const ch = (pairs) => ({ t: Float64Array.from(pairs.map((p) => p[0])), v: Float64Array.from(pairs.map((p) => p[1])) });
  const run = { channels: { cam_x: ch([[0, 0], [100, 0.1], [200, NaN], [300, 0.3]]), cam_y: ch([[0, 0], [100, -0.05], [200, NaN], [300, 0]]) } };
  const d = cameraDrift(run, 100);
  assert.ok(Math.abs(d.x - 0.1) < 1e-9 && Math.abs(d.y + 0.05) < 1e-9);
  assert.equal(cameraDrift({ channels: {} }, 100), null, 'no camera path');
  const m = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20, s: 2 };
  assert.deepEqual(apply(shifted(m, -64, 18), 64, -18), apply(m, 0, 0), 'a point that drifted by the camera lands where it started');
  assert.equal(shifted(m, 0, 0), m);
});

test('after a hard cut: the other take\'s groups are the prior; re-found ones keep their names, unconfirmed', async () => {
  const { priorFor, suggestedGroups, confirmGroup } = await import('../src/features/tracking/groups.js');
  const { suggestGroupsRequest } = await import('../src/lib/protocol.js');
  const g = (name, t, extra = {}) => ({ ...grp(name, t), ...extra });
  const l = normScenes([S(0, 1000, { groups: [g('c1_penis', 500, { who: 'c1', part: 'penis' }), g('c2_hand_l', 600, { who: 'c2', part: 'hand', side: 'l' }), g('c2_tail', 700, { off: true })] }), S(1000, 2000, { join: true })]);
  assert.deepEqual(priorFor(l, 1).map((p) => [p.name, p.who, p.part, p.side]).sort(), [['c1_penis', 'c1', 'penis', undefined], ['c2_hand_l', 'c2', 'hand', 'l']], 'a group toggled off is no clue');
  assert.deepEqual(priorFor(l, 0), [], 'the take with the groups needs none');
  assert.deepEqual(priorFor(normScenes([S(0, 1000, { groups: [g('c1_penis', 500)] }), S(1000, 2000, { join: true, split: 'camera' })]), 1), [], 'the same take: tracked through');
  const res = { groups: [{ name: 'c1_penis', who: 'c1', part: 'penis', poly: grp('', 0).poly, unconfirmed: true, prior: 'c1_penis' }, { name: 'c1_penis', poly: grp('', 0).poly }] };
  const out = suggestedGroups(res, 1200, [], () => ({ w: 1, h: 1, rle: [0, 1] }));
  assert.deepEqual(out.map((x) => [x.name, !!x.unconfirmed, x.t_ms]), [['c1_penis', true, 1200], ['c1_penis2', false, 1200]], 'a re-found one keeps its name; a fresh one gets a free name');
  assert.equal(confirmGroup(out[0]).unconfirmed, undefined); assert.equal(confirmGroup(out[1]), out[1]);
  assert.deepEqual(suggestGroupsRequest({ video: 'v', t_ms: 1, prior: priorFor(l, 1) }).prior.length, 2);
  assert.equal('prior' in suggestGroupsRequest({ video: 'v', t_ms: 1 }), false);
});

// ---- paw-k2u: shots are first-class in the selection ----
test('selection reducer: click, Shift range across scenes, Ctrl toggle, box, scene, all / invert', async () => {
  const M = await import('../src/features/timeline/shots.js');
  const l = normScenes([S(0, 10), S(10, 20, { join: true }), S(20, 30, { join: true }), S(30, 40), S(40, 50, { join: true })]);
  let sel = M.selShot(1);
  assert.deepEqual(sel, { active: 1, shots: [1] });
  sel = M.selExtend(l, sel, 4);
  assert.deepEqual(sel, { active: 1, shots: [1, 2, 3, 4] }, 'Shift: across the scene cut, the active one stays');
  sel = M.selToggle(l, sel, 3);
  assert.deepEqual(sel, { active: 1, shots: [1, 2, 4] });
  sel = M.selToggle(l, sel, 1);
  assert.deepEqual(sel, { active: 4, shots: [2, 4] }, 'the active one went out: the last one is active');
  assert.deepEqual(M.selToggle(l, M.NO_SEL, 0), { active: 0, shots: [0] });
  assert.deepEqual(M.selExtend(l, M.NO_SEL, 2), { active: 2, shots: [2] }, 'Shift with nothing selected: that shot');
  assert.deepEqual(M.selBox(l, 15, 35), { active: 1, shots: [1, 2, 3] });
  assert.deepEqual(M.selBox(l, 45, 41, 'add', { active: 0, shots: [0] }).shots, [0, 4]);
  assert.deepEqual(M.selBox(l, 0, 25, 'sub', { active: 1, shots: [1, 2, 3] }), { active: 3, shots: [3] });
  assert.deepEqual(M.selScene(l, 1), { active: 1, shots: [0, 1, 2] });
  assert.deepEqual(M.selScene(l, 1, 4).shots, [0, 1, 2, 3, 4]);
  assert.deepEqual(M.selAll(l).shots, [0, 1, 2, 3, 4]); assert.deepEqual(M.selInvert(l, { active: 0, shots: [0, 1] }).shots, [2, 3, 4]);
  assert.deepEqual(M.cleanSel(l.slice(0, 2), { active: 4, shots: [1, 4] }), { active: 1, shots: [1] }, 'an edit shortened the list');
});

test('what the selection is called and which shots each edit hits', async () => {
  const M = await import('../src/features/timeline/shots.js');
  const l = normScenes([S(0, 10, { tags: ['anal'] }), S(10, 20, { join: true }), S(20, 30, { join: true }), S(30, 40, { tags: ['oral'] }), S(40, 50, { join: true })]);
  // paw-2lp7.5: shots are numbered 1, 2, 3 through the video (owner: "shots are just 123"), no scene in the words
  assert.equal(M.selText(l, [0, 1, 2]), 'Shots 1 to 3'); assert.equal(M.selText(l, [0, 1, 2, 3, 4]), 'Shots 1 to 5');
  assert.equal(M.selText(l, [1]), 'Shot 2'); assert.equal(M.selText(l, [1, 2]), 'Shots 2 to 3');
  assert.equal(M.selText(l, [0, 2]), '2 shots'); assert.equal(M.selText(l, [2, 3]), 'Shots 3 to 4');
  assert.deepEqual(l.map((_, k) => M.shotLabel(l, k)), ['1', '2', '3', '4', '5']); assert.equal(M.shotLabel(l, 9), '');
  // tags: camera on every selected shot, a where on every scene with a selected shot
  assert.deepEqual(M.tagTargets(l, [1, 2, 4], 'pan'), [1, 2, 4]);
  assert.deepEqual(M.tagTargets(l, [1, 2, 4], 'vaginal'), [1, 4]);
  const t = M.toggleTagOn(l, [1, 4], 'vaginal');
  assert.ok([0, 1, 2, 3, 4].every((k) => sceneTags(t[k]).includes('vaginal')), 'both scenes, all their shots');
  const off = M.toggleTagOn(t, [1, 4], 'vaginal');
  assert.ok(off.every((s) => !sceneTags(s).includes('vaginal')), 'all had it: off');
  const cam = M.toggleTagOn(l, [1, 2], 'zoom');
  assert.deepEqual(cam.map((s) => sceneTags(s).includes('zoom')), [false, true, true, false, false]);
  // structure edits
  assert.deepEqual(sceneRuns(M.ownScene(l, [1, 2])), [[0, 0], [1, 2], [3, 4]], 'make these shots their own scene');
  assert.deepEqual(sceneRuns(M.ownScene(l, [1])), [[0, 0], [1, 1], [2, 2], [3, 4]]);
  assert.equal(M.ownScene(l, [0, 1, 2]), null, 'already their own scene');
  assert.deepEqual(spans(M.mergeSelected(l, [1, 2])), [[0, 10], [10, 30], [30, 40], [40, 50]]);
  const across = M.mergeSelected(l, [2, 3]);
  assert.deepEqual(spans(across), [[0, 10], [10, 20], [20, 40], [40, 50]]); assert.deepEqual(sceneRuns(across), [[0, 3]], 'across a scene cut: joined first');
  assert.ok(across[0].offers?.length, 'the later scene\'s tags are offered');
  assert.equal(M.mergeSelected(l, [1]), null);
  assert.deepEqual(sceneRuns(M.joinSelected(l, [2, 3])), [[0, 4]]);
  const tk = M.setTakeOn(l, [0, 1, 2]);
  assert.deepEqual(tk.map((s) => s.split), [undefined, 'camera', 'camera', undefined, undefined], 'the scene\'s first shot has no cut before it');
  assert.deepEqual(M.setTakeOn(tk, [1, 2]).map((s) => s.split ?? null), [null, null, null, null, null]);
});

test('Track a selection of shots: exactly those', () => {
  const l = normScenes([S(0, 10, { tags: ['anal'] }), S(10, 20, { join: true }), S(20, 30, { join: true }), S(30, 40, { tags: ['oral'] })]);
  const p = planTracks(l, { trackerId: 't', trackers: [{ id: 't', roi: 'none' }], only: [0, 2, 3] }).filter((x) => x.action === 'track');
  assert.deepEqual(p.map((x) => x.sceneIdx), [[0, 2], [3]]);
  assert.deepEqual(p[0].segments, [[0, 10], [20, 30]], 'shot 1.2 is not tracked');
});

test('moving a scene boundary re-parents the shots between; boundary kinds', async () => {
  const M = await import('../src/features/timeline/shots.js');
  const l = normScenes([S(0, 10, { tags: ['anal'], groups: [grp('c1_penis', 15)] }), S(10, 20, { join: true }), S(20, 30, { join: true, split: 'camera' }), S(30, 40, { tags: ['oral'] }), S(40, 50, { join: true })]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => M.boundaryKind(l, i)), ['', 'cut', 'move', 'scene', 'cut']);
  const back = M.moveSceneCut(l, 3, 2);   // shot 1.3 goes to scene 2
  assert.deepEqual(sceneRuns(back), [[0, 1], [2, 4]]);
  assert.ok(sceneTags(back[2]).includes('oral') && !sceneTags(back[2]).includes('anal'), 'it takes the receiving scene\'s tags');
  assert.equal(back[2].split, undefined, 'a scene boundary is no camera move');
  assert.equal(back[0].groups.length, 1, 'the group drawn at 15 s stays with shot 1.2 in scene 1');
  const fwd = M.moveSceneCut(l, 3, 4);   // shot 2.1 goes to scene 1
  assert.deepEqual(sceneRuns(fwd), [[0, 3], [4, 4]]);
  assert.ok(sceneTags(fwd[3]).includes('anal'));
  assert.equal(M.moveSceneCut(l, 3, 5), null, 'scene 2 would lose every shot');
  assert.equal(M.moveSceneCut(l, 2, 1), null, 'not a scene boundary');
  const g2 = M.moveSceneCut(normScenes([S(0, 10, { tags: ['anal'] }), S(10, 20, { join: true }), S(20, 30, { tags: ['oral'], groups: [grp('c2_hips', 12)] })]), 2, 1);
  assert.deepEqual(g2[1].groups.map((g) => g.t_ms), [12], 'a group drawn on a moved shot moves with it');
});
