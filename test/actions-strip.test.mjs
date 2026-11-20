// paw-2lp7.5 (regions stage 2): the Actions strip's geometry, hit-testing and snapping (actions-strip.js), the region edits it
// needs (regions.js: tags / mix / kind, drag onto a layer with the swap, merge, proposals, accept, gaps, a cut taking its edges
// along), the keyboard path's edits, and the repeat / crop offers now extending the action (repeat-offers.svelte.js extendTo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripLayout, layersIn, bandsIn, extraFor, regionRects, laneAt, actHit, mixChip, regionTargets, snapAt, coverOf, midShotEdges, partOfShot, pushMru, regionOverShots, edgeTo, extendRegion, LAYER_H, POS_H } from '../src/features/timeline/actions-strip.js';
import { normActs, setRegionTags, setRegionMix, setRegionKind, toggleRegionTag, regionWords, acceptRegion, acceptAll, mergeRegion, mergeAllSame, followCut, gapsOf, proposeFromShots, moveToLayer, project, actsFromScenes } from '../src/features/timeline/regions.js';
import { normScenes } from '../src/features/timeline/shots.js';

const R = (kind, t0, t1, layer = 0, tags = [], x = {}) => ({ id: x.id ?? `${kind}${layer}_${t0}`, kind, t0, t1, layer, tags, ...x });
const ids = (acts) => acts.map((r) => `${r.layer}:${r.kind}:${r.t0}-${r.t1}:${r.tags.join('+')}${r.auto ? '?' : ''}${r.mix && r.mix !== 'mix' ? `:${r.mix}` : ''}`);
const SH = (lens, facts = []) => { let t = 0; return normScenes(lens.map((n, i) => { const s = { start_ms: t, end_ms: t + n, ...(facts[i] || {}) }; t += n; return s; })); };

test('layout: main line over the positioning lane, secondary bands above, the row grows a band per layer in view', () => {
  const L0 = stripLayout(56, 0);
  assert.deepEqual([L0.sh, L0.y1, L0.pos, L0.main, L0.layers], [32, 33, { y0: 32 - POS_H, y1: 32 }, { y0: 1, y1: 32 - POS_H - 1 }, []]);
  const L1 = stripLayout(56 + extraFor(1), 1);
  assert.equal(L1.sh - L0.sh, LAYER_H, 'the Shots strip keeps its height');
  assert.equal(56 + extraFor(1) - L1.y1, 56 - L0.y1);
  assert.deepEqual(L1.layers, [{ y0: 1, y1: LAYER_H }]);
  assert.equal(L1.main.y0, 1 + LAYER_H, 'the main line under the band');
  const L2 = stripLayout(56 + extraFor(2), 2);
  assert.ok(L2.layers[1].y1 < L2.layers[0].y0 + 1, 'layer 2 above layer 1');
  assert.ok(stripLayout(50, 3).lh >= 7, 'a squeezed row: the bands share what there is');
  { const T = stripLayout(200, 1), r = T.lh / (T.main.y1 - T.main.y0); assert.ok(r > 0.25 && r < 0.4, `a tall row: a band is about a third of the main line (${r})`); }
  const acts = [R('act', 0, 1000), R('act', 2000, 3000, 2, ['handjob']), R('positioning', 0, 500, 0)];
  assert.equal(layersIn(acts, 0, 1500), 0, 'the layer-2 region is out of view; positioning is no layer');
  assert.equal(layersIn(acts, 0, 2500), 2);
  assert.equal(bandsIn(acts, 0, 2500), 3, 'one empty band above the used ones');
  assert.equal(bandsIn([], 0, 2500), 0, 'no region in view: no band');
});

test('hit-testing: the mix chip, an edge (inside a third of a narrow one), the body, an empty lane, a new layer above, the Shots strip', () => {
  const L = stripLayout(56 + extraFor(1), 1), x = (t) => t / 10;   // 10 ms per px
  const acts = [R('act', 0, 3000, 0, ['anal', 'penetration']), R('act', 1000, 2500, 1, ['handjob'], { mix: 'mix' }), R('positioning', 3000, 3600), R('act', 5000, 5060, 0, ['oral'])];
  const rects = regionRects(acts, x, L, 1000);
  const mid = (b) => (b.y0 + b.y1) / 2;
  assert.equal(actHit(rects, L, 150, mid(L.main)).kind, 'actBody');
  assert.deepEqual([actHit(rects, L, 2, mid(L.main)).kind, actHit(rects, L, 2, mid(L.main)).side], ['actEdge', 't0']);
  assert.deepEqual([actHit(rects, L, 299, mid(L.main)).kind, actHit(rects, L, 299, mid(L.main)).side], ['actEdge', 't1']);
  const chip = mixChip(rects.find((q) => q.r.layer === 1), 1000);
  assert.ok(chip, 'a long enough band has its mix chip');
  assert.equal(actHit(rects, L, chip.x0 + 2, mid(L.layers[0])).kind, 'actMix');
  assert.equal(actHit(rects, L, 120, mid(L.layers[0])).kind, 'actBody');
  assert.equal(actHit(rects, L, 120, mid(L.layers[0])).r.layer, 1);
  assert.deepEqual(actHit(rects, L, 400, mid(L.main)), { kind: 'actEmpty', layer: 0, positioning: false });
  assert.deepEqual(actHit(rects, L, 400, mid(L.pos)), { kind: 'actEmpty', layer: 0, positioning: true });
  assert.equal(actHit(rects, L, 320, mid(L.pos)).r.kind, 'positioning');
  assert.equal(actHit(rects, L, 400, mid(L.layers[0])).layer, 1);
  assert.deepEqual(laneAt(L, -6), { layer: 2, positioning: false }, 'dragged above the strip: a new layer');
  assert.equal(actHit(rects, L, 150, L.y1 + 2), null, 'the Shots strip');
  // a 6 px region: its edges inside a third, the middle stays the body
  assert.equal(actHit(rects, L, 503, mid(L.main)).kind, 'actBody');
  assert.equal(actHit(rects, L, 500.5, mid(L.main)).kind, 'actEdge');
});

test('snapping: to cuts / other regions / the playhead within tol, Shift = frames only; always a frame start, on a frame table too', () => {
  const targets = regionTargets([R('act', 1000, 2000, 0, [], { id: 'a' }), R('act', 4000, 5000, 0, [], { id: 'b' })], 'b', [{ t: 3000, label: 'cut' }, { t: 3500, label: 'playhead' }]);
  assert.deepEqual(targets.map((q) => q.t), [1000, 2000, 3000, 3500], 'the dragged region\'s own edges are no target');
  assert.deepEqual(snapAt(2990, targets, 30, 1000 / 30), { t: 3000, hit: { t: 3000, label: 'cut' } });
  assert.equal(snapAt(2990, targets, 30, 1000 / 30, true).t, 2967, 'Shift: the frame start (frame 89 at 30 fps)');
  assert.equal(snapAt(3460, targets, 30, 1000 / 30).t, 3433, 'nothing near: the frame it is in');
  // a VFR / offset file: the frames are where its table puts them, not n x 1000 / fps
  const starts = [0, 40, 75, 120, 160, 205, 240, 290];
  const table = { kind: 'table', count: starts.length, frameMs: 40, frameAt: (t) => { let i = 0; while (i + 1 < starts.length && starts[i + 1] <= t + 0.5) i++; return i; }, timeOf: (n) => starts[n], endOf: (n) => starts[n + 1] ?? starts[n] + 40 };
  assert.equal(snapAt(118, [], 0, table).t, 75, 'inside frame 2 [75, 120): its start');
  assert.equal(snapAt(121, [], 0, table).t, 120);
  assert.equal(snapAt(250, [{ t: 205, label: 'cut' }], 50, table, false).t, 205, 'a target wins inside tol');
  assert.equal(snapAt(250, [{ t: 205, label: 'cut' }], 50, table, true).t, 240, 'Shift: the table\'s frame start');
});

test('reading: shots tinted by the main-line action at their middle; a main-line edge inside a shot is marked', () => {
  const shots = SH([1000, 1000, 1000]), acts = [R('act', 0, 1500, 0, ['anal', 'penetration']), R('act', 1500, 3000, 0, ['oral', 'penetration']), R('act', 0, 3000, 1, ['handjob']), R('act', 2200, 2600, 2, ['x'], { auto: true })];
  assert.deepEqual(coverOf(shots, normActs(acts)).map((r) => r?.tags.join('+') ?? null), ['anal+penetration', 'oral+penetration', 'oral+penetration']);
  assert.deepEqual(midShotEdges(shots, acts).map((m) => [m.i, m.t]), [[1, 1500]], 'one edge inside shot 2; the secondary and the cut-aligned edges are not');
});

test('region edits: tags (one action, aliases), mix, kind, accept, merge, the gaps', () => {
  let a = normActs([R('act', 0, 1000, 0, ['anal', 'penetration'], { id: 'm' }), R('act', 200, 800, 1, ['handjob'], { id: 's' }), R('act', 1000, 2000, 0, ['anal', 'penetration'], { id: 'n', auto: true })]);
  assert.deepEqual(toggleRegionTag(['anal'], 'rimming'), ['anal', 'licking'], 'an alias brings its parts');
  assert.deepEqual(toggleRegionTag(['anal', 'penetration'], 'penetration'), ['anal']);
  assert.deepEqual(setRegionTags(a, 'm', ['penetration', 'oral', 'camera-pan-not-a-tag']).find((r) => r.id === 'm').tags, ['oral', 'penetration'], 'where / what only, table order');
  assert.equal(setRegionTags(a, 'm', ['anal', 'penetration']), null, 'no change');
  assert.equal(setRegionMix(a, 'm', 'ignore'), null, 'the main line has no mix');
  assert.equal(setRegionMix(a, 's', 'ignore').find((r) => r.id === 's').mix, 'ignore');
  assert.equal(setRegionMix(a, 's', 'nonsense'), null);
  const idle = setRegionKind(a, 'm', 'rest').find((r) => r.id === 'm');
  assert.deepEqual([idle.kind, idle.tags], ['rest', []], 'a no-action kind drops the tags');
  const p = setRegionKind(normActs([...a, R('positioning', 100, 300, 0, [], { id: 'p' })]), 'p', 'act').find((r) => r.id === 'p');
  assert.equal(p.layer, 2, 'out of the positioning lane: the lowest layer free over it (never cutting the action under it)');
  assert.equal(regionWords(a[0]), 'anal penetration'); assert.equal(regionWords(R('act', 0, 1)), 'untagged'); assert.equal(regionWords(R('rest', 0, 1)), 'rest');
  assert.equal(acceptRegion(a, 'm'), null, 'not a proposal');
  assert.equal(acceptRegion(a, 'n').find((r) => r.id === 'n').auto, undefined);
  assert.deepEqual(ids(acceptAll(a)), ['0:act:0-1000:anal+penetration', '0:act:1000-2000:anal+penetration', '1:act:200-800:handjob']);
  a = acceptAll(a);
  assert.deepEqual(ids(mergeRegion(a, 'm', 1)), ['0:act:0-2000:anal+penetration', '1:act:200-800:handjob'], 'M: the same action next to it');
  assert.equal(mergeRegion(a, 's', 0), null, 'nothing the same on its layer');
  const three = normActs([R('act', 0, 1000, 0, ['oral']), R('act', 1000, 2000, 0, ['oral']), R('act', 2500, 3000, 0, ['oral']), R('act', 3000, 4000, 0, ['anal'])]);
  assert.deepEqual(ids(mergeAllSame(three)), ['0:act:0-3000:oral', '0:act:3000-4000:anal'], 'the old "group shots into scenes"');
  assert.deepEqual(gapsOf([R('act', 1000, 2000), R('positioning', 2000, 2500), R('act', 3000, 4000, 1)], 5000), [{ t0: 0, t1: 1000 }, { t0: 2000, t1: 5000 }], 'positioning and secondary regions are no main-line cover');
});

test('positioning has its own lane: it lies over an action and only trims positioning', () => {
  const a = normActs([R('act', 0, 3000, 0, ['anal', 'penetration'], { id: 'm' }), R('positioning', 1000, 1500, 3, [], { id: 'p' }), R('positioning', 1400, 2000, 0, [], { id: 'q' })]);
  assert.deepEqual(ids(a), ['0:act:0-3000:anal+penetration', '0:positioning:1000-1400:', '0:positioning:1400-2000:']);
  assert.deepEqual(project(SH([3000]), a)[0].tags, ['anal', 'penetration'], 'the shots read the action under it');
});

test('a drag onto another layer: what lay there swaps to the layer it came from; positioning only moves in time', () => {
  const a = normActs([R('act', 0, 3000, 0, ['anal', 'penetration'], { id: 'm' }), R('act', 1000, 2000, 1, ['handjob'], { id: 's', mix: 'ignore' })]);
  assert.deepEqual(ids(moveToLayer(a, 's', 0)), ['0:act:0-1000:anal+penetration', '0:act:1000-2000:handjob', '0:act:2000-3000:anal+penetration', '1:act:1000-2000:anal+penetration:ignore'],
    'the handjob is the main line there; the anal under it goes up to layer 1');
  assert.deepEqual(ids(moveToLayer(a, 's', 2, 500)), ['0:act:0-3000:anal+penetration', '1:act:1500-2500:handjob:ignore'], 'moved, its mix kept; alone on layer 1 it cannot open layer 2 (paw-2lp7.9)');
  assert.deepEqual(ids(moveToLayer(a, 'm', 1)), ['0:act:1000-2000:handjob', '1:act:0-3000:anal+penetration'], 'the main action up: the handjob comes down where it was under it');
  assert.equal(moveToLayer(a, 's', 1), null, 'nowhere: no change');
  const p = normActs([R('positioning', 0, 500, 0, [], { id: 'p' })]);
  assert.deepEqual(ids(moveToLayer(p, 'p', 3, 100)), ['0:positioning:100-600:']);
});

test('a moved cut takes the action edges on it along', () => {
  const a = normActs([R('act', 0, 1000, 0, ['oral']), R('act', 1000, 2000, 0, ['anal']), R('act', 500, 1000, 1, ['handjob'])]);
  assert.deepEqual(ids(followCut(a, 1000, 1033)), ['0:act:0-1033:oral', '0:act:1033-2000:anal', '1:act:500-1033:handjob']);
  assert.equal(followCut(a, 1500, 1533), null, 'no edge there');
  assert.equal(followCut(a, 1000, 1000), null);
});

test('proposals: neighbouring shots with the same described acts, only in the gaps, auto until accepted, not read by the shots', () => {
  const d = (tags) => ({ describe: { tags: tags.map((tag) => ({ tag, score: 0.9 })) } });
  const shots = SH([1000, 1000, 1000, 1000, 1000], [d(['anal_sex']), d(['anal_sex']), d([]), d(['fellatio']), d(['fellatio'])]);
  const kept = [R('act', 3000, 4000, 0, ['vaginal', 'penetration'], { id: 'v' })];
  const p = proposeFromShots(shots, kept);
  const auto = p.filter((r) => r.auto);
  assert.ok(auto.length >= 2, ids(p).join(' | '));
  assert.ok(auto.every((r) => r.layer === 0 || r.mix === 'mix'));
  assert.ok(!auto.some((r) => r.layer === 0 && r.t0 < 4000 && r.t1 > 3000), 'never over a region already there');
  assert.ok(auto.some((r) => r.layer === 0 && r.t0 === 0 && r.t1 === 2000), 'shots 1 and 2: one region');
  assert.ok(auto.some((r) => r.layer === 0 && r.t0 === 4000 && r.t1 === 5000), 'shot 5, in the gap after the kept region');
  assert.deepEqual(ids(p.filter((r) => !r.auto)), ids(kept), 'the kept region as it was');
  const before = project(shots, kept), after = project(shots, p);
  assert.deepEqual(after.map((s) => s.tags ?? null), before.map((s) => s.tags ?? null), 'proposals are not facts until accepted');
  assert.deepEqual(ids(proposeFromShots(shots, p).filter((r) => r.auto)), ids(auto), 'proposing again replaces the earlier proposals');
  assert.equal(proposeFromShots(SH([1000]), []), null, 'nothing described: nothing');
});

test('the keyboard path: a region over the selected shots (one per unbroken run), the recent actions, [ / ], extend', () => {
  const shots = SH([1000, 1000, 1000, 1000]);
  assert.deepEqual(ids(regionOverShots([], shots, [0, 1, 3], ['oral', 'penetration'])), ['0:act:0-2000:oral+penetration', '0:act:3000-4000:oral+penetration']);
  assert.equal(regionOverShots([], shots, []), null);
  let m = pushMru([], ['anal', 'penetration']);
  m = pushMru(m, ['oral', 'penetration']);
  m = pushMru(m, ['penetration', 'anal']);
  assert.deepEqual(m, [['penetration', 'anal'], ['oral', 'penetration']], 'the same action once, newest first');
  assert.equal(pushMru(Array.from({ length: 9 }, (_, k) => [`t${k}`]), ['new']).length, 9);
  assert.deepEqual(pushMru(m, []), m);
  const a = normActs([R('act', 1000, 1600, 0, ['oral'], { id: 'o' })]);
  assert.deepEqual(ids(edgeTo(a, 'o', 't0', 900)), ['0:act:900-1600:oral']);
  assert.equal(edgeTo(a, 'o', 't1', 800), null, 'an end before its start: refused');
  assert.deepEqual(ids(extendRegion(a, shots, a[0], 1200)), ['0:act:1000-2000:oral'], 'to the end of the shot under the playhead');
  const b = extendRegion(a, shots, a[0], 1200);
  assert.deepEqual(ids(extendRegion(b, shots, b[0], 1200)), ['0:act:1000-3000:oral'], 'again: through the next cut');
});

test('converted data draws: an empty main-line region that held a multi-shot scene is an untagged region', () => {
  const L = SH([1000, 1000, 1000], [{}, { join: true }, { tags: ['oral', 'penetration'] }]);
  const a = actsFromScenes(L);
  assert.deepEqual(ids(a), ['0:act:0-2000:', '0:act:2000-3000:oral+penetration']);
  assert.equal(regionWords(a[0]), 'untagged');
  assert.equal(regionRects(a, (t) => t / 10, stripLayout(56), 1000).length, 2);
});

test('the repeat / crop offers extend the action across to the shot with the same footage', async () => {
  const { extendTo } = await import('../src/features/timeline/regions.js');
  const shots = SH([1000, 1000, 1000, 1000]);
  const a = normActs([R('act', 0, 1000, 0, ['anal', 'penetration'], { id: 'a' }), R('act', 1000, 2000, 0, ['kissing'], { id: 'k' })]);
  assert.deepEqual(ids(extendTo(0, 2000)(a, shots)), ['0:act:0-3000:anal+penetration'], 'shot 1\'s action to the end of shot 3 (what lay between gives way)');
  assert.deepEqual(ids(extendTo(3000, 3000)([], shots)), ['0:act:3000-4000:'], 'no action at a: an untagged one');
  assert.equal(extendTo(0, 0)(a, shots), null, 'already there');
});

test('paw-2lp7.9: exactly one layer more than in use; empty layers close (document-wide), the main line never filled', async () => {
  const { layerCap, setRegionLayer, deleteRegion, addRegion, splitRegionAt } = await import('../src/features/timeline/regions.js');
  const { withRangeProposals } = await import('../src/features/timeline/describe-ranges.js');
  const m = R('act', 0, 9000, 0, ['anal', 'penetration'], { id: 'm' });
  // the clamp: 1, 2, 3 layers in use
  const one = normActs([m, R('act', 9000, 12000, 0, ['oral'], { id: 'o' })]);
  assert.equal(layerCap(one, null), 1);
  assert.deepEqual(ids(moveToLayer(one, 'o', 7)), ['0:act:0-9000:anal+penetration', '1:act:9000-12000:oral'], 'only the main line: a far drag lands on layer 1');
  const two = normActs([m, R('act', 1000, 2000, 1, ['handjob'], { id: 'h' }), R('act', 3000, 4000, 1, ['handjob'], { id: 'h2' })]);
  assert.equal(layerCap(two, null), 2);
  assert.equal(moveToLayer(two, 'h', 5).find((r) => r.id === 'h').layer, 2, 'two in use: up to layer 2');
  const three = normActs([...two, R('act', 1000, 2000, 2, ['kissing'], { id: 'k' }), R('act', 5000, 6000, 2, ['kissing'], { id: 'k2' })]);
  assert.equal(layerCap(three, null), 3);
  assert.equal(setRegionLayer(three, 'h2', 9).find((r) => r.id === 'h2').layer, 3);
  // the lone region on its layer: it cannot open a new one
  const lone = normActs([m, R('act', 1000, 2000, 1, ['handjob'], { id: 'h' })]);
  assert.equal(layerCap(lone, 'h'), 1);
  assert.equal(moveToLayer(lone, 'h', 2), null, 'dragged up: stays on layer 1');
  assert.equal(setRegionLayer(lone, 'h', 4), null);
  // swap still works within the range
  assert.deepEqual(ids(moveToLayer(two, 'h', 0)), ['0:act:0-1000:anal+penetration', '0:act:1000-2000:handjob', '0:act:2000-9000:anal+penetration', '1:act:1000-2000:anal+penetration', '1:act:3000-4000:handjob']);
  // compaction: delete the middle layer's last region -> the one above drops; move it off; the order of layers kept
  const mid = normActs([m, R('act', 1000, 2000, 1, ['handjob'], { id: 'h' }), R('act', 1000, 2000, 2, ['kissing'], { id: 'k' }), R('act', 1500, 2500, 3, ['grinding'], { id: 'g' })]);
  assert.deepEqual(ids(deleteRegion(mid, 'h')), ['0:act:0-9000:anal+penetration', '1:act:1000-2000:kissing', '2:act:1500-2500:grinding']);
  assert.deepEqual(ids(moveToLayer(mid, 'h', 0, 8000)).slice(-2), ['1:act:1000-2000:kissing', '2:act:1500-2500:grinding'], 'moved down to the main line: layer 1 closes');
  assert.equal(mid.find((r) => r.id === 'h').layer, 1, 'the edits never touch the list they were given (undo restores it exactly)');
  // a project saved with gaps loads compacted, the same list when already compact
  assert.deepEqual(ids(normActs([m, R('act', 1000, 2000, 2, ['handjob']), R('act', 3000, 4000, 5, ['kissing'])])), ['0:act:0-9000:anal+penetration', '1:act:1000-2000:handjob', '2:act:3000-4000:kissing']);
  assert.equal(normActs(mid), mid);
  assert.deepEqual(ids(addRegion(one, { kind: 'act', t0: 0, t1: 500, layer: 6, tags: [] })).at(-1), '1:act:0-500:', 'added far above: the next free layer');
  // the main line stays the main line when it empties: nothing is promoted onto it
  const sec = normActs([R('act', 1000, 2000, 0, ['oral'], { id: 'o' }), R('act', 1000, 2000, 1, ['handjob'], { id: 'h' })]);
  assert.deepEqual(ids(deleteRegion(sec, 'o')), ['1:act:1000-2000:handjob']);
  assert.deepEqual(ids(normActs([R('act', 0, 1000, 2, ['handjob'])])), ['1:act:0-1000:handjob']);
  assert.equal(splitRegionAt(mid, 'g', 2000).filter((r) => r.layer === 3).length, 2);
  // proposals: same rule (withRangeProposals goes through normActs)
  const prop = withRangeProposals([m], [{ kind: 'act', t0: 0, t1: 1000, layer: 0, tags: ['oral'] }, { kind: 'act', t0: 0, t1: 1000, layer: 3, tags: ['handjob'], mix: 'mix' }]);
  assert.deepEqual(prop.map((r) => r.layer), [0, 0, 1]);
});

test('partOfShot: an action over part of one shot (the Track tab selects it on a click, paw-qoo5)', () => {
  const shots = [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 12000 }];
  const r = (t0, t1, x = {}) => ({ id: 'r', kind: 'act', t0, t1, layer: 0, tags: [], ...x });
  assert.equal(partOfShot(r(6000, 8500), shots), true, 'inside shot 2');
  assert.equal(partOfShot(r(9400, 12000), shots), true, 'from inside to its end');
  assert.equal(partOfShot(r(5000, 12000), shots), false, 'the whole shot: a click still selects the shot');
  assert.equal(partOfShot(r(3000, 8000), shots), false, 'across a cut');
  assert.equal(partOfShot(r(6000, 8500, { kind: 'positioning' }), shots), false, 'positioning');
  assert.equal(partOfShot(r(6000, 8500, { auto: true }), shots), false, 'a proposal');
  assert.equal(partOfShot(r(6000, 8500, { layer: 1, mix: 'mix' }), shots), true, 'a secondary action');
});
