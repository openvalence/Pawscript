import assert from 'node:assert/strict';
import test from 'node:test';
import { indexRepeats } from '../src/features/timeline/repeats.js';
import { repeatTargets, copyGroupsTo, repeatCandidates, stampIn, findFill, runSeeds, seedGroups, fillTake, bestPaintFrame, takeKey } from '../src/features/tracking/repeat-groups.js';
import { takeGroups, isCopy, isSuggested, acceptGroup, paintedKey, trackGroups, maskSize } from '../src/features/tracking/groups.js';

// 4 shots of 1 s at 25 fps (40 ms a frame); one picture at frames 1 (shot 0) and 77 (shot 3), another at 5-6 and 20
// (shot 0), 30 (shot 1), 55 and 60 (shot 2)
const FM = 40;
const ix = indexRepeats({ frames: 100, buckets: [
  [{ f0: 1, f1: 1, t_ms: 40 }, { f0: 77, f1: 77, t_ms: 3080 }],
  [{ f0: 5, f1: 6, t_ms: 200 }, { f0: 20, f1: 20, t_ms: 800 }, { f0: 30, f1: 30, t_ms: 1200 }, { f0: 55, f1: 55, t_ms: 2200 }, { f0: 60, f1: 60, t_ms: 2400 }],
] });
const G = (t, name = 'c1_hips') => ({ name, poly: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]], t_ms: t, source: 'user', mask: { w: 4, h: 4, rle: [16] } });
const shots = (groups = {}) => [0, 1, 2, 3].map((k) => ({ start_ms: k * 1000, end_ms: (k + 1) * 1000, ...(groups[k] ? { groups: groups[k] } : {}) }));

test('targets: one per other take on its first repeat; a take with groups of its own is skipped, never overwritten', () => {
  const sc = shots({ 0: [G(200)], 2: [G(2500, 'c2_penis')] });
  const occ = ix.buckets[1].occ.filter((o) => o.f0 !== 5);
  const r = repeatTargets(sc, 0, occ);
  assert.deepEqual(r.targets, [{ shot: 1, t: 1200 }]);   // shot 0's own repeat (800) is not a target; 1200 is shot 1's first
  assert.deepEqual(r.skipped, [{ shot: 2, t: 2200 }]);
  const out = copyGroupsTo(sc, takeGroups(sc, 0), r.targets);
  assert.deepEqual(takeGroups(out, 1).map((g) => [g.name, g.t_ms, g.mask.rle[0]]), [['c1_hips', 1200, 16]]);
  assert.equal(takeGroups(out, 2)[0].name, 'c2_penis');   // untouched
  assert.deepEqual(takeGroups(out, 0), takeGroups(sc, 0));
  assert.equal(stampIn(2033.333), 2034);   // a frame's time -> a whole ms inside that frame
});

// a stored run over shot 1 that seeded the owner's c1_hips (pinned id 4) and the tagger's hips (id 3); frame 30 (1200 ms)
// is the picture of bucket 1. pts: [x, y, visible, label, part, pinned id]
const RUN = { id: 'r1', range: { start: 1000, end: 2000 }, scenes: [{ start_ms: 1000, groups: { sem_c1_hips: { source: 'user', id: 4 }, sem_hips: { source: 'grabcut', id: 3 } } }],
  frames: { t: [1160, 1200, 1240], v: [0, 0, 0], ov: [{ pts: [] }, { pts: [[0.1, 0.1, 1, -1, 0, 4], [0.2, 0.1, 1, -1, 0, 4], [0.15, 0.2, 1, -1, 0, 4], [0.5, 0.5, 0, -1, 0, 4], [0.9, 0.9, 1, -1, 0, 3], [0.3, 0.3, 1, 2]] }, { pts: [] }] } };

test('copies are marked: source repeat + from, never training labels; an edit makes them the owner’s', () => {
  const sc = shots({ 0: [G(200)] }), out = copyGroupsTo(sc, takeGroups(sc, 0), [{ shot: 1, t: 1200 }]), c = takeGroups(out, 1)[0];
  assert.equal(c.source, 'repeat'); assert.equal(c.from, 200); assert.ok(isCopy(c) && !isSuggested(c));
  assert.equal(paintedKey(out), paintedKey(sc));   // the seeder's labels did not change
  const u = acceptGroup(c);
  assert.equal(u.source, 'user'); assert.equal('from' in u, false);
  assert.equal(takeGroups(copyGroupsTo(out, [c], [{ shot: 2, t: 2200 }]), 2)[0].from, 200);   // a copy of a copy: the painted frame
});

test('fill from a painted frame: a frame of the empty take repeats the frame another take’s groups are on', () => {
  const sc = shots({ 0: [G(201)] });   // painted on frame 5 (bucket 1)
  const f = findFill(sc, 2, ix, FM);
  assert.equal(f.kind, 'repeat'); assert.equal(f.t, 2200); assert.equal(f.from, 201); assert.equal(f.shot, 0);   // the first of 2200 / 2400
  const out = fillTake(sc, 2, f, maskSize(16 / 9)), gs = takeGroups(out, 2);
  assert.deepEqual(gs.map((g) => [g.name, g.t_ms, g.source, g.from, g.mask.rle[0]]), [['c1_hips', 2200, 'repeat', 201, 16]]);
  assert.deepEqual(gs[0].poly, G(201).poly);   // the same pixels: the outline unchanged
  assert.equal(findFill(sc, 0, ix, FM), null);   // its own take
  assert.equal(findFill(sc, 3, ix, FM), null);   // shot 3 only shows bucket 0, painted nowhere
  assert.equal(findFill(sc, 2, null, FM), null);
});

test('fill from a stored run: the seeded points of the owner’s groups on the matching frame, visible ones only', () => {
  assert.deepEqual(runSeeds(RUN, 1200, FM), { c1_hips: [[0.1, 0.1], [0.2, 0.1], [0.15, 0.2]] });   // occluded and the tagger's left out
  const f = findFill(shots(), 2, ix, FM, { runs: [RUN] });
  assert.equal(f.kind, 'run'); assert.equal(f.t, 2200); assert.equal(f.from, 1200); assert.equal(f.parts, 1);
  const g = seedGroups(f.seeds, f.t, f.from, maskSize(16 / 9))[0];
  assert.deepEqual([g.name, g.who, g.part, g.source, g.from, g.t_ms, g.pinned], ['c1_hips', 'c1', 'hips', 'run', 1200, 2200, true]);
  assert.deepEqual(g.points, [[0.1, 0.1], [0.2, 0.1], [0.15, 0.2]]);
  assert.ok(g.poly.length >= 3 && g.poly.every(([x, y]) => x > 0.03 && x < 0.27 && y > 0.03 && y < 0.27));   // a footprint, not the frame
  assert.deepEqual(trackGroups(fillTake(shots(), 2, f, maskSize(16 / 9)), 0, 4000)[0].points, g.points);   // Track seeds them (v4.21)
  assert.equal(findFill(shots(), 1, ix, FM, { runs: [RUN] }), null);   // the run's own take
  assert.equal(findFill(shots(), 2, ix, FM, { runs: [{ ...RUN, restored: true }] }), null);
});

test('fill ranking: the picked loop frame, then nearest the take start, then painted over a run, then more parts', () => {
  const sc = shots({ 3: [G(3080)], 2: [G(2200, 'c2_penis')] });   // bucket 0 painted in shot 3, bucket 1 in shot 2
  assert.equal(findFill(sc, 0, ix, FM).t, 40);                                     // bucket 0's frame is first in shot 0
  assert.equal(findFill(sc, 0, ix, FM, { chosen: new Set([1]) }).t, 200);          // the owner's loop frame wins
  const both = findFill(shots({ 0: [G(201)] }), 2, ix, FM, { runs: [RUN] });
  assert.equal(both.kind, 'repeat');                                               // same frame: painted over the run
});

test('best frame to paint: most empty takes covered, then the loop frame, then repeats, then earlier', () => {
  assert.deepEqual(bestPaintFrame(shots(), 0, ix), { t: 200, id: 1, covers: 2, repeats: 5, loop: false });   // shots 1 and 2
  assert.equal(bestPaintFrame(shots({ 1: [G(1200)], 2: [G(2200)] }), 0, ix).t, 40);   // bucket 1's takes have groups: 0 reaches shot 3
  const all = shots({ 1: [G(1200)], 2: [G(2200)], 3: [G(3080)] });
  assert.equal(bestPaintFrame(all, 0, ix).id, 1);                                  // nothing to cover: the most repeats
  assert.equal(bestPaintFrame(all, 0, ix, new Set([0])).id, 0);                    // the loop frame over more repeats
  const two = indexRepeats({ frames: 100, buckets: [[{ f0: 10, f1: 10, t_ms: 400 }, { f0: 60, f1: 60, t_ms: 2400 }], [{ f0: 3, f1: 3, t_ms: 120 }, { f0: 70, f1: 70, t_ms: 2800 }]] });
  assert.equal(bestPaintFrame(shots(), 0, two).t, 120);                            // a tie: the earlier
  assert.equal(bestPaintFrame(shots(), 1, two), null);                             // nothing repeats: the old behaviour
  assert.equal(takeKey(shots(), 2), 2000);
});

test('seed priority: repeating frames weigh more and are added, the owner\'s loop frame most', () => {
  const r = repeatCandidates(ix, [0, 400, 800], FM);
  assert.deepEqual(r.candidates, [0, 400, 800, 200, 40]);   // + the most repeated picture's frame, then the other
  assert.deepEqual(r.bonus, [0, 0, 1.16, 1.16, 0.5]);       // 5 repeats: 0.5 log2 5; 2 repeats: 0.5
  assert.deepEqual(r.why[200], { repeats: 5, loop: false });
  const l = repeatCandidates(ix, [0, 400, 800], FM, new Set([0]));
  assert.equal(l.candidates[3], 40);                        // the chosen loop frame first
  assert.equal(l.bonus[3], 2.5);
  assert.deepEqual(repeatCandidates(null, [0, 400], FM), { candidates: [0, 400], bonus: [], why: {} });
  assert.deepEqual(repeatCandidates(ix, [], FM).candidates, []);
  // paw-8mf4: the take's best frame to paint joins the candidates, worth the empty takes it covers
  const b = repeatCandidates(ix, [0, 400], FM, new Set(), 2000, { t: 2200, covers: 3 });
  assert.equal(b.candidates.at(-1), 2200); assert.equal(b.bonus.at(-1), 2.66); assert.equal(b.why[2200].covers, 3);
});
