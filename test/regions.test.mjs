// paw-2lp7.2: action regions (src/features/timeline/regions.js): the stored list, its edits, and the shim that keeps every
// scene reader working. The proof: test/fixtures/regions-head.json (the scenes-only code's digest of test/regions-snapshot.mjs
// DOCS) equals the digest of the same documents converted to regions and projected back onto shots stripped of every fact the
// regions own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOCS, digest, converted } from './regions-snapshot.mjs';
import { normScenes, sceneRuns, mergeScenes, splitScene, toggleTagOn, mergeShots } from '../src/features/timeline/shots.js';
import { normActs, actsOver, actsAt, addRegion, moveRegion, resizeRegion, splitRegionAt, deleteRegion, setRegionLayer, project, projectScenes, syncActs, actsFromScenes, splitActs, withCarried } from '../src/features/timeline/regions.js';

const HEAD = JSON.parse(readFileSync(new URL('./fixtures/regions-head.json', import.meta.url), 'utf8'));
const R = (kind, t0, t1, layer = 0, tags = [], x = {}) => ({ id: `${kind}${layer}_${t0}`, kind, t0, t1, layer, tags, ...x });

test('the proof: every consumer sees the same on every fixture after conversion to regions', async () => {
  for (const [name, d] of Object.entries(DOCS)) assert.deepEqual(digest(await converted(d)), HEAD[name], name);
  // and as the app loads it: the stored shots synced from none (Doc.load), then the regions projected onto them
  for (const [name, d] of Object.entries(DOCS)) { const s = syncActs(d.scenes, []); assert.deepEqual(digest({ ...d, scenes: withCarried(projectScenes(s.scenes, s.acts), s.acts) }), HEAD[name], name + ' (load)'); }
});

test('conversion: one layer-0 region per scene, secondary acts above, structure kinds, bands on layer 0', () => {
  const a = actsFromScenes(DOCS.twoActs.scenes).map(({ kind, t0, t1, layer, tags, mix }) => ({ kind, t0, t1, layer, tags, mix }));
  assert.deepEqual(a, [
    { kind: 'act', t0: 0, t1: 5000, layer: 0, tags: ['anal', 'penetration'], mix: undefined },
    { kind: 'act', t0: 5000, t1: 9000, layer: 0, tags: ['handjob'], mix: undefined },
    { kind: 'act', t0: 9000, t1: 13000, layer: 0, tags: ['slit', 'penetration'], mix: undefined },
    { kind: 'act', t0: 13000, t1: 22000, layer: 0, tags: ['anal', 'penetration'], mix: undefined },
    { kind: 'act', t0: 0, t1: 5000, layer: 1, tags: ['handjob'], mix: 'mix' },
    { kind: 'act', t0: 5000, t1: 9000, layer: 1, tags: ['exposed'], mix: 'mix' },
    { kind: 'act', t0: 9000, t1: 13000, layer: 1, tags: ['grinding'], mix: 'mix' },
    { kind: 'act', t0: 14500, t1: 16000, layer: 1, tags: ['handjob'], mix: 'mix' },
  ]);
  const st = actsFromScenes(DOCS.structure.scenes).filter((r) => r.layer === 0).map((r) => `${r.kind}:${r.tags.join('+')}`);
  assert.deepEqual(st, ['intro:', 'act:anal+penetration', 'idle:', 'act:vaginal+penetration', 'after:']);
  const exposed = actsFromScenes(DOCS.structure.scenes).find((r) => r.layer === 1);
  assert.deepEqual([exposed.kind, exposed.tags, exposed.t0], ['act', ['exposed'], 17000]);
  const rg = actsFromScenes(DOCS.range.scenes);
  assert.deepEqual(rg.map((r) => [r.t0, r.range ?? null, r.tease ?? null]), [[0, { lo: 20, hi: 70 }, null], [8000, null, true], [12000, { off: true }, null]]);
  // an untagged single shot is a gap: no region; a joined run with no act still has its (empty) region
  assert.equal(actsFromScenes(DOCS.plain.scenes).length, 3);
  assert.ok(actsFromScenes(DOCS.cutaways.scenes).some((r) => r.t0 === 0 && r.t1 === 14500 && r.layer === 0));
});

test('splitActs: the in-a-where acts are one action, each other what its own', () => {
  assert.deepEqual(splitActs(['oral', 'penetration']), [['oral', 'penetration']]);
  assert.deepEqual(splitActs(['anal', 'vaginal', 'penetration']), [['anal', 'vaginal', 'penetration']]);
  assert.deepEqual(splitActs(['anal', 'penetration', 'handjob']), [['anal', 'penetration'], ['handjob']]);
  assert.deepEqual(splitActs(['handjob', 'exposed']), [['handjob'], ['exposed']]);
  assert.deepEqual(splitActs(['oral', 'penetration', 'licking']), [['oral', 'penetration', 'licking']]);
});

test('normActs: cleaned, sorted, a later region wins its layer, other layers overlap freely', () => {
  const a = normActs([R('act', 0, 5000, 0, ['anal', 'penetration', 'bogus']), R('act', 3000, 8000, 0, ['oral']), R('act', 1000, 9000, 1, ['handjob']), { kind: 'nope', t0: 0, t1: 1 }, R('act', 5, 5)]);
  assert.deepEqual(a.map((r) => [r.layer, r.t0, r.t1, r.tags.join('+'), r.mix ?? '']), [[0, 0, 3000, 'anal+penetration', ''], [0, 3000, 8000, 'oral', ''], [1, 1000, 9000, 'handjob', 'mix']]);
  assert.equal(normActs(a), a, 'already normal: the same list');
  const inside = normActs([R('act', 0, 9000), R('idle', 3000, 4000)]);
  assert.deepEqual(inside.map((r) => [r.kind, r.t0, r.t1]), [['act', 0, 3000], ['idle', 3000, 4000], ['act', 4000, 9000]]);
  assert.notEqual(inside[0].id, inside[2].id);
});

test('actsOver / actsAt: layer 0 first, with coverage', () => {
  const a = normActs([R('act', 0, 4000, 0, ['anal']), R('act', 4000, 8000, 0, ['oral']), R('act', 2000, 6000, 1, ['handjob'])]);
  assert.deepEqual(actsOver(a, 3000, 5000).map((r) => [r.layer, r.t0, r.cover]), [[0, 0, 0.5], [0, 4000, 0.5], [1, 2000, 1]]);
  assert.deepEqual(actsAt(a, 4000).map((r) => r.tags[0]), ['oral', 'handjob']);
  assert.deepEqual(actsAt(a, 9000), []);
});

test('edits: add / move / resize / split / delete / change layer, with the non-overlap rule', () => {
  let a = normActs([R('act', 0, 4000, 0, ['anal']), R('act', 4000, 8000, 0, ['oral'])]);
  a = addRegion(a, { kind: 'act', t0: 3000, t1: 5000, layer: 0, tags: ['vaginal'] });
  assert.deepEqual(a.map((r) => [r.t0, r.t1, r.tags[0]]), [[0, 3000, 'anal'], [3000, 5000, 'vaginal'], [5000, 8000, 'oral']]);
  const v = a[1].id;
  a = moveRegion(a, v, 2000);
  assert.deepEqual(a.map((r) => [r.t0, r.t1, r.tags[0]]), [[0, 3000, 'anal'], [5000, 7000, 'vaginal'], [7000, 8000, 'oral']]);
  a = resizeRegion(a, v, 4000, 7500);
  assert.deepEqual(a.map((r) => [r.t0, r.t1]), [[0, 3000], [4000, 7500], [7500, 8000]]);
  assert.equal(resizeRegion(a, v, 4000, 7500), null);
  assert.equal(resizeRegion(a, v, 5000, 5000), null);
  a = splitRegionAt(a, v, 6000);
  assert.deepEqual(a.map((r) => [r.t0, r.t1, r.tags[0]]), [[0, 3000, 'anal'], [4000, 6000, 'vaginal'], [6000, 7500, 'vaginal'], [7500, 8000, 'oral']]);
  assert.equal(splitRegionAt(a, v, 4000), null);
  a = setRegionLayer(a, v, 1);
  assert.deepEqual(a.map((r) => [r.layer, r.t0, r.mix ?? '']), [[0, 0, ''], [0, 6000, ''], [0, 7500, ''], [1, 4000, 'mix']]);
  a = setRegionLayer(a, v, 0);
  assert.deepEqual(a.map((r) => [r.layer, r.t0, r.t1]), [[0, 0, 3000], [0, 4000, 6000], [0, 6000, 7500], [0, 7500, 8000]]);
  assert.equal(a.find((r) => r.id === v).mix, undefined);
  a = deleteRegion(a, v);
  assert.equal(a.length, 3);
  assert.equal(deleteRegion(a, 'nope'), null);
});

const SH = (lens, facts = []) => { let t = 0; return normScenes(lens.map((n, i) => { const s = { start_ms: t, end_ms: t + n, ...(facts[i] || {}) }; t += n; return s; })); };

test('projection: covering by the middle, join under one layer-0 region, secondary spans, gaps without acts, rest as idle, ignore', () => {
  const L = SH([4000, 4000, 4000, 4000], [{ describe: { summary: { acts: ['fellatio'], positions: [], views: [] }, tags: [] } }, {}, {}, { split: 'camera', join: true }]);
  const acts = normActs([R('act', 0, 6500, 0, ['anal', 'penetration']), R('act', 3000, 5000, 1, ['handjob']), R('rest', 8000, 12000), R('act', 0, 16000, 2, ['kissing'], { mix: 'ignore' })]);
  const P = projectScenes(L, acts);
  assert.deepEqual(sceneRuns(P), [[0, 1], [2, 3]], 'the region over shots 1-2 (middles 2000, 6000) joins them; the camera split stays joined');
  assert.deepEqual(P[0].tags, ['anal', 'penetration', { id: 'handjob', t0: 3000, t1: 5000 }, '-oral'], 'the describe\'s oral removed; handjob as a span; kissing ignored');
  assert.deepEqual(P[2].tags, ['idle'], 'rest reads as idle');
  const gap = projectScenes(SH([4000], [{ describe: { summary: { acts: ['fellatio'], positions: [], views: [] }, tags: [] } }]), []);
  assert.deepEqual(gap[0].tags, ['-oral', '-penetration'], 'no region: no act');
  assert.equal(project(P, acts), P, 'nothing to change: the same list');
});

test('the shim: an old scene command edits regions underneath; the shots stay as written', () => {
  let L = DOCS.joined.scenes, acts = actsFromScenes(L);
  const base0 = acts.find((r) => r.layer === 0 && r.t0 === 0).id;
  // tag the first scene: its region's tags change, same id
  let W = toggleTagOn(L, [0], 'handjob'), r = syncActs(W, acts);
  assert.equal(r.scenes, W);
  assert.deepEqual(r.acts.filter((x) => x.t0 === 0).map((x) => [x.id === base0, x.layer, x.tags.join('+')]), [[true, 0, 'vaginal+penetration'], [false, 1, 'handjob']]);
  // merge scenes 2 and 3 (joined fixture: runs [0-2] [3-4] [5]): one layer-0 region over both, extending the first
  L = r.scenes; acts = r.acts;
  const b3 = acts.find((x) => x.layer === 0 && x.t0 === 8000).id;
  W = mergeScenes(L, 3); r = syncActs(W, acts);
  assert.equal(r.scenes, W);
  assert.deepEqual(r.acts.filter((x) => x.layer === 0).map((x) => [x.t0, x.t1]), [[0, 8000], [8000, 19000]]);
  assert.equal(r.acts.find((x) => x.layer === 0 && x.t0 === 8000).id, b3, 'extended: the same region');
  // split a scene at a cut: two regions, the first keeps its id
  L = r.scenes; acts = r.acts;
  W = splitScene(L, 3000); r = syncActs(W, acts);
  assert.deepEqual(r.acts.filter((x) => x.layer === 0).map((x) => [x.t0, x.t1]), [[0, 3000], [3000, 8000], [8000, 19000]]);
  assert.equal(r.acts.find((x) => x.layer === 0 && x.t0 === 0).id, base0);
  // a shot merge inside a scene changes no region
  L = r.scenes; acts = r.acts;
  W = mergeShots(L, 1); r = syncActs(normScenes(W), acts);
  assert.equal(r.acts, acts);
  // the regions edited: the shots follow (projectScenes), and syncing that back is a no-op
  const P = projectScenes(r.scenes, deleteRegion(r.acts, b3));
  assert.deepEqual(sceneRuns(P).length, sceneRuns(r.scenes).length + 2, 'the merged scene (three shots) is three gap shots again');
  assert.equal(syncActs(P, deleteRegion(r.acts, b3)).scenes, P);
});

test('the shim keeps what the shots cannot show: ignored and positioning regions, a rest kind, mix', () => {
  const L = DOCS.plain.scenes;
  let acts = actsFromScenes(L);
  const id = acts.find((r) => r.t0 === 9000)?.id;
  acts = normActs([...acts, R('act', 0, 18000, 1, ['kissing'], { mix: 'ignore' }), R('positioning', 1000, 2000, 2), R('rest', 9000, 12000)]);
  assert.equal(id, undefined, 'the untagged shot had no region');
  const P = projectScenes(L, acts);
  const W = toggleTagOn(P, [0], 'licking'), r = syncActs(W, acts);
  assert.ok(r.acts.some((x) => x.mix === 'ignore' && x.tags[0] === 'kissing'));
  assert.ok(r.acts.some((x) => x.kind === 'positioning'));
  assert.ok(r.acts.some((x) => x.kind === 'rest' && x.t0 === 9000));
});
