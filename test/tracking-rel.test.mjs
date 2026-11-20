// Relative channels built on the frontend (src/lib/runs-channel.js relChannel): 'rel:<a>:<b>' = group a's centroid
// minus group b's on the stroke axis, 0..1 per scene, closer = deeper; composed, kept and restored like any channel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeRun, newFrames } from '../src/lib/runs.js';
import { relChannel, relParse, relSources, relLabel, relSuggestions, relPairOf, pairBodies, channelPatch, keepOf, runFromGhost, pickerChannels, pointsFromChannel } from '../src/lib/runs-channel.js';
import { serialize, parse } from '../src/lib/io/project.js';
import { groupCentroid } from '../src/features/tracking/blobs.js';

const REL = 'rel:sem_penis:sem_hips';
/** 2 s at 30 fps, one run scene: the penis comes down from y 0.2 to 0.55 onto the hips at 0.6 (screen y down), both
 *  riding the same camera wobble; the penis is lost on frames 20..24. sign -1 (the sidecar's) on the scene. */
function fixture({ deg = 90, params = {}, n = 60 } = {}) {
  const ch = { sem_penis_x: [], sem_penis_y: [], sem_hips_x: [], sem_hips_y: [], g1_n: [], g2_n: [], pair_proj: [] };
  for (let i = 0; i < n; i++) {
    const t = Math.round((i * 1000) / 30), cam = 0.05 * Math.sin(i / 3), lost = i >= 20 && i < 25;
    ch.sem_penis_x.push([t, lost ? null : 0.5 + cam]); ch.sem_penis_y.push([t, lost ? null : 0.2 + (0.35 * i) / (n - 1) + cam]);
    ch.sem_hips_x.push([t, 0.5 + cam]); ch.sem_hips_y.push([t, 0.6 + cam]);
    ch.g1_n.push([t, 0.5]); ch.g2_n.push([t, 0.3]); ch.pair_proj.push([t, 0.5]);
  }
  const notes = deg == null ? [] : [{ code: 'primary', scene_index: 0, message: 'proj', data: { chosen: 'proj', axis: { mode: 'auto', deg } } }];
  return makeRun({ n: 5, tracker: { id: 'cotracker_points', name: 'CoTracker' }, params, range: { start: 0, end: 2000 }, roi: null, frames: newFrames(), runs: [],
    result: { samples: ch.g1_n.map(([t]) => [t, 0.5]), points: [{ at: 0, pos: 50 }, { at: 1500, pos: 60 }], scenes: [{ start_ms: 0, end_ms: 2000, sign: -1 }], channels: ch, notes } });
}
const fin = (v) => Array.from(v).filter((x) => x === x);

test('relChannel: two groups approaching -> the value falls (closer = deeper), the camera cancels, NaN where one is lost', () => {
  const run = fixture(), c = relChannel(run, 'sem_penis', 'sem_hips');
  assert.equal(c.t.length, 60);
  assert.ok(Math.abs(c.v[0] - 1) < 1e-6 && Math.abs(c.v[59]) < 1e-6);   // farthest first, closest last
  for (let i = 1; i < 60; i++) if (c.v[i] === c.v[i] && c.v[i - 1] === c.v[i - 1]) assert.ok(c.v[i] < c.v[i - 1]);   // wobble cancelled: strictly falling
  for (let i = 20; i < 25; i++) assert.ok(Number.isNaN(c.v[i]));
  assert.deepEqual(c.axes[0], { kind: 'sidecar', deg: 90 });
  assert.equal(c.min, 0); assert.equal(c.max, 1);
  // a distance: the order of the two does not change it (flip a scene to get farther = deeper)
  assert.deepEqual(fin(relChannel(run, 'sem_hips', 'sem_penis').v), fin(c.v));
  // missing group: null
  assert.equal(relChannel(run, 'sem_penis', 'g3'), null);
});

test('relChannel axis: custom (opts or run params) > sidecar axis.deg > PCA of the difference', () => {
  // horizontal axes see no motion: flat 0.5
  const side = relChannel(fixture({ deg: 0 }), 'sem_penis', 'sem_hips');
  assert.equal(side.axes[0].kind, 'sidecar');
  assert.ok(fin(side.v).every((x) => x === 0.5));
  const cu = relChannel(fixture(), 'sem_penis', 'sem_hips', { axis: { x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.5 } });
  assert.equal(cu.axes[0].kind, 'custom');
  assert.ok(fin(cu.v).every((x) => x === 0.5));
  const pr = relChannel(fixture({ params: { axis: 'custom', axis_x0: 0.5, axis_y0: 0.2, axis_x1: 0.5, axis_y1: 0.8 } }), 'sem_penis', 'sem_hips');
  assert.equal(pr.axes[0].kind, 'custom');
  assert.ok(pr.v[0] > 0.99 && pr.v[59] < 0.01);
  // no axis anywhere: the difference's principal axis, same answer
  const pca = relChannel(fixture({ deg: null }), 'sem_penis', 'sem_hips');
  assert.equal(pca.axes[0].kind, 'PCA');
  assert.ok(pca.v[0] > 0.99 && pca.v[59] < 0.01);
  // the aspect matters on oblique axes only: vertical stays the same
  assert.deepEqual(fin(relChannel(fixture(), 'sem_penis', 'sem_hips', { aspect: 1 }).v), fin(relChannel(fixture(), 'sem_penis', 'sem_hips').v));
});

test('ids, labels, suggestions, pair, picker', () => {
  assert.deepEqual(relParse(REL), { a: 'sem_penis', b: 'sem_hips' });
  assert.deepEqual(relParse('rel:g1p2:g2'), { a: 'g1p2', b: 'g2' });
  for (const bad of ['rel:g1:g1', 'rel:g5:g1', 'rel:g1', 'g1_proj', 'rel:sem_:g1', 'rel:sem_C1:g1', null]) assert.equal(relParse(bad), null);
  assert.deepEqual(relParse('rel:sem_c1_penis:sem_c2_hips'), { a: 'sem_c1_penis', b: 'sem_c2_hips' }, 'v4.12: any pinned group, a character\'s too');
  assert.equal(relLabel({}, 'rel:sem_c1_penis:sem_c2_hips'), 'Bottom penis ↔ Top hips (seeded)');
  assert.deepEqual(relSources(REL), ['sem_penis_x', 'sem_penis_y', 'sem_hips_x', 'sem_hips_y']);
  assert.equal(relLabel({}, REL), 'penis ↔ hips (seeded)');
  assert.equal(relLabel({ g1p2: { label: 'penis' }, g2: { label: 'body' } }, 'rel:g1p2:g2'), 'penis ↔ g2');
  const run = fixture();
  assert.deepEqual(relSuggestions(run), [REL]);
  const noSem = { channels: { g1p2_x: {}, sem_hips_x: {} } };
  assert.deepEqual(relSuggestions(noSem, { g1p2: { label: 'penis' } }), ['rel:g1p2:sem_hips']);   // a part named penis stands in
  assert.deepEqual(relSuggestions(noSem, {}), []);
  assert.deepEqual(pairBodies(run), ['g1', 'g2']);
  assert.equal(relPairOf(run, 'rel:g2:g1'), 'pair_proj');
  assert.equal(relPairOf(run, REL), '');
  // a materialised rel channel never becomes a picker chip of its own
  assert.deepEqual(pickerChannels({ channels: { [REL]: {}, foo: {} } }), ['primary', 'foo']);
});

test('channelPatch resolves a rel: link (the sidecar sign is not applied; a flip is), keepOf keeps its sources, a ghost round trip rebuilds it', () => {
  const run = fixture(), links = [{ t0: 0, t1: 2000, run: 'run5', channel: REL }];
  const p = channelPatch(run, 'primary', {}, links);
  assert.deepEqual(p.sceneChannels, [REL]);
  assert.ok(p.channels[REL] && p.channels.sem_penis_x);   // the run gets the channel (r.channels[...] checks keep working)
  const pos = Array.from(p.points0.pos);
  assert.equal(pos[0], 100); assert.equal(pos[pos.length - 1], 0);   // far = out, close = deep, despite the scene's sign -1
  assert.deepEqual(Array.from(pointsFromChannel({ ...run, channels: p.channels }, REL).pos), pos);
  assert.deepEqual(Array.from(channelPatch({ ...run, flips: [0] }, 'primary', {}, links).points0.pos), pos.map((x) => 100 - x));   // flippable like any channel
  // the default channel may be a rel id too
  assert.deepEqual(channelPatch(run, REL).sceneChannels, [REL]);
  // keepOf: the _x / _y sources (not the derived series) and the sidecar's axis per scene
  const r = { ...run, ...p, points: p.points0 };
  const keep = keepOf(r, [REL]);
  assert.deepEqual(Object.keys(keep.channels).sort(), ['sem_hips_x', 'sem_hips_y', 'sem_penis_x', 'sem_penis_y']);
  assert.equal(keep.scenes[0].axis_deg, 90);
  const ghost = { id: 'run5', name: '#5 CoTracker', color: r.color, script: Array.from(r.points.at, (at, i) => ({ at, pos: r.points.pos[i] })),
    source: { kind: 'tracker', tracker: r.tracker, runId: 'run5', range: { t0: 0, t1: 2000 }, params: {}, keep } };
  const doc = parse(serialize({ axes: { stroke: [] }, ghosts: [ghost], extra: { links: { v: 1, scenes: links } } }, { ghostScripts: true }));
  assert.deepEqual(doc.extra.links.scenes[0].channel, REL);
  const back = runFromGhost(doc.ghosts[0], doc.extra.links.scenes);   // no notes after a reload: the kept axis_deg stands in
  assert.deepEqual(back.sceneChannels, [REL]);
  assert.deepEqual(back.channels[REL].axes[0], { kind: 'sidecar', deg: 90 });
  assert.deepEqual(Array.from(back.points0.pos), pos);
  // its groups gone: the link is ignored, the scene falls back to the run's default
  assert.deepEqual(channelPatch({ ...run, channels: { g1_n: run.channels.g1_n } }, 'primary', {}, links).sceneChannels, ['primary']);
});

test('blobs groupCentroid: body, part, pinned group', () => {
  const F = { G: [{ c: [0.1, 0.2], parts: [null, { c: [0.3, 0.4] }] }, null, null, null], S: [{ c: [0.5, 0.6] }, null, { c: [0.7, 0.8] }] };
  assert.deepEqual(groupCentroid(F, 'g1'), [0.1, 0.2]);
  assert.deepEqual(groupCentroid(F, 'g1p2'), [0.3, 0.4]);
  assert.equal(groupCentroid(F, 'g1p1'), null);
  assert.equal(groupCentroid(F, 'g2'), null);
  assert.deepEqual(groupCentroid(F, 'sem_penis'), [0.5, 0.6]);
  assert.deepEqual(groupCentroid(F, 'sem_hips'), [0.7, 0.8]);
});

// ---- the store: a rel pick on a scene, saved (links block + .pawruns + ghost keep) and reopened ----
const root = fileURLToPath(new URL('..', import.meta.url));
const PROJ = 'C:/videos/sample.pawproj', RUNS = 'C:/videos/sample.pawruns';
let server, M, T;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
});
after(() => server?.close());
function open(be, { ghosts = null, blocks = {} } = {}) {
  const doc = { ...M.sampleDoc(), project: { path: PROJ }, scenes: [{ start_ms: 0, end_ms: 2000 }] };
  if (ghosts) doc.ghosts = ghosts;
  const app = M.createMockApp({ backend: be, doc, keys: false }), tr = T.trackingFor(app);
  app.loadBlocks(blocks);
  return { app, tr };
}

test('store: pick rel on a scene -> lane channel, ghost keep; save + reopen (from .pawruns, then from the ghost alone) gives it back', async () => {
  const be = M.mockBackend();
  const a = open(be);
  await a.tr.runsLoad;
  const run = fixture();
  a.tr.runs = [run];
  a.app.doc.ghosts = [...a.app.doc.ghosts, a.tr.ghostOf(run)];
  assert.equal(a.tr.linkScene(0, 'run5', REL), true);
  const r = a.tr.run('run5');
  assert.equal(a.tr.channelFor(r, 0), REL);
  assert.ok(r.channels[REL]);
  const pos = Array.from(r.points0.pos);
  assert.equal(pos[0], 100);
  const keep = a.tr.ghost('run5').source.keep;
  assert.ok(keep.channels.sem_penis_y && !keep.channels[REL]);
  const blocks = a.app.saveBlocks();
  assert.equal(blocks.links.scenes[0].channel, REL);
  await a.app.blocksSaved(PROJ);
  const ghosts = a.app.doc.ghosts;

  const b = open(be, { ghosts, blocks });
  await b.tr.runsLoad;
  const rb = b.tr.run('run5');
  assert.ok(rb && !rb.restored);
  assert.equal(b.tr.channelFor(rb, 0), REL);
  assert.deepEqual(Array.from(rb.points0.pos), pos);

  be.files.delete(RUNS);   // the runs file lost: the ghost's keep rebuilds the pick
  const c = open(be, { ghosts, blocks });
  await c.tr.runsLoad;
  const rc = c.tr.run('run5');
  assert.ok(rc?.restored);
  assert.equal(c.tr.channelFor(rc, 0), REL);
  assert.deepEqual(Array.from(rc.points0.pos), pos);
});
