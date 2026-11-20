// paw-do8a: a shot joined to the take by a camera move gets groups of its own only through "New groups for this shot";
// paw-o74b: painting on another frame of the take (another shot too) ADDS groups seeded there; the best frame / fill per shot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normScenes, takeRange, sameTake } from '../src/features/timeline/shots.js';
import { takeGroups } from '../src/features/tracking/groups.js';
import { bestPaintFrame } from '../src/features/tracking/repeat-groups.js';

const S = (a, b, x = {}) => ({ start_ms: a, end_ms: b, ...x });
// one scene: shot 0 (0-10 s), shot 1 (10-20 s) and shot 2 (20-30 s) joined by camera moves: one take
const take3 = () => normScenes([S(0, 10000), S(10000, 20000, { join: true, split: 'camera' }), S(20000, 30000, { join: true, split: 'camera' })]);

async function tool(t0, scenes) {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const M = await server.ssrLoadModule('/dev/mock-app.js'), GS = await server.ssrLoadModule('/src/features/tracking/groups.svelte.js');
  const T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  const doc = { ...M.sampleDoc(), scenes, ghosts: [] };
  const app = M.createMockApp({ doc, keys: false, backend: M.mockBackend() });
  app.tracking = T.trackingFor(app); app.mode = 'track';
  const at = (t) => { app.player.seek?.(t); if (app.player.timeMs !== t) app.player.timeMs = t; };
  at(t0);
  const G = GS.groupsFor(app);
  G.toggle(true);
  const paint = (x = 0.5, y = 0.5, erase = false) => { const ok = G.begin(x, y, erase); if (ok) { G.move(x + 0.05, y); G.end(); } return ok; };
  return { server, app, G, at, paint };
}

test('paw-o74b: a stroke in another shot of the take ADDS groups seeded there: no division, one undo step', async () => {
  const { server, app, G, at, paint } = await tool(12000, take3());
  try {
    assert.ok(paint(), 'painting on the frame on screen of a take without groups');
    const old = takeGroups(app.doc.scenes, 1);
    assert.equal(old.length, 1); assert.ok(old[0].t_ms >= 11900 && old[0].t_ms <= 12100);
    at(25000); G.follow(25000);
    assert.equal(G.onFrame, true, 'every frame of the take paints');
    assert.deepEqual([G.groups.length, G.others.length], [0, 1], 'the frame on screen has none of its own; the other seed is listed');
    assert.deepEqual([G.splitHere.k, G.splitHere.before], [2, true], '"New groups for this shot" is still offered');
    const before = app.doc.scenes, n0 = app._history.entries.length;
    assert.ok(paint(0.2, 0.2), 'the stroke paints');
    assert.equal(app._history.entries.length, n0 + 1, 'one undo step');
    const sc = app.doc.scenes;
    assert.deepEqual(takeRange(sc, 2), [0, 2], 'the take is not divided');
    assert.ok(sameTake(sc[2]) && sameTake(sc[1]));
    const all = takeGroups(sc, 2);
    assert.equal(all.length, 2, 'both groups belong to the one take');
    assert.ok(all.some((g) => g.t_ms >= 24900 && g.t_ms <= 25100) && all.some((g) => g.t_ms === old[0].t_ms), 'each on its own frame');
    assert.notEqual(all[0].name, all[1].name, 'names stay unique in the take');
    assert.deepEqual([G.groups.length, G.others.length], [1, 1]);
    at(old[0].t_ms); G.follow(old[0].t_ms);
    assert.deepEqual(G.groups.map((g) => g.t_ms), [old[0].t_ms], 'back on the first seed frame: its own group');
    app.undo();
    assert.equal(app.doc.scenes, before, 'undo: the added group goes, nothing else changed');
  } finally { await server.close(); }
});

test('paw-o74b: off the seed frame in its own shot painting adds; an erase on nothing does nothing; the button divides alone', async () => {
  const { server, app, G, at, paint } = await tool(12000, take3());
  try {
    paint();
    at(15000); G.follow(15000);
    assert.equal(G.splitHere, null, 'same shot as the other seed: nothing to divide');
    assert.ok(paint(0.2, 0.2), 'a later frame of the same shot adds a group');
    assert.deepEqual(takeGroups(app.doc.scenes, 1).map((g) => Math.round(g.t_ms / 100)).sort(), [120, 150]);
    at(25000); G.follow(25000);
    const n0 = app._history.entries.length;
    assert.equal(paint(0.5, 0.5, true), false, 'an erase stroke where this frame has no group does nothing');
    assert.equal(app._history.entries.length, n0);
    assert.ok(G.newHere());
    assert.equal(app._history.entries.length, n0 + 1); assert.match(app._history.entries.at(-1).label, /new groups for this shot/);
    assert.deepEqual(takeRange(app.doc.scenes, 2), [2, 2]); assert.equal(takeGroups(app.doc.scenes, 2).length, 0);
    assert.equal(G.onFrame, true, 'now the frame on screen is the one to paint');
  } finally { await server.close(); }
});

test('paw-o74b.1: the same part painted on another frame is another seed of it (no refusal); never twice on one frame', async () => {
  const { server, app, G, at, paint } = await tool(25000, take3());
  try {
    G.setWho('c1'); G.pickPart('hips');
    assert.ok(paint());
    at(5000); G.follow(5000);
    assert.ok(G.armed, 'still armed: the next stroke paints c1_hips');
    const n0 = app._history.entries.length;
    assert.ok(paint(), 'c1_hips again on another frame: painted');
    assert.equal(app._history.entries.length, n0 + 1, 'one undo step');
    const hips = takeGroups(app.doc.scenes, 2).filter((g) => g.name === 'c1_hips');
    assert.equal(hips.length, 2, 'one part, two seeds, same name');
    assert.deepEqual(G.seedsOfPart('c1_hips').map((t) => Math.round(t / 1000)), [5, 25], 'its seed frames (the dock chips)');
    assert.deepEqual(G.groups.map((g) => g.name), ['c1_hips']);
    assert.equal(G.othersHere().length, 0, 'a part seeded on this frame is not drawn again dimmed');
    assert.ok(paint(0.52, 0.5), 'painting it again on the same frame edits that seed');
    assert.equal(takeGroups(app.doc.scenes, 2).filter((g) => g.name === 'c1_hips').length, 2, 'never two seeds on one frame');
    G.pickPart('tail');
    assert.ok(paint(0.3, 0.3));
    G.disarm(); assert.ok(paint(0.7, 0.7, false));
    at(25000); G.follow(25000); G.disarm(); assert.ok(paint(0.8, 0.2));
    const names = takeGroups(app.doc.scenes, 2).map((g) => g.name).sort();
    assert.deepEqual(names, ['c1_hips', 'c1_hips', 'c1_tail', 'unassigned_1', 'unassigned_2'], 'unassigned blobs stay unique across the seed frames');
    // deleting one seed leaves the other
    at(5000); G.follow(5000);
    G.remove(G.groups.findIndex((g) => g.name === 'c1_hips'));
    assert.deepEqual(takeGroups(app.doc.scenes, 2).filter((g) => g.name === 'c1_hips').map((g) => Math.round(g.t_ms / 1000)), [25]);
  } finally { await server.close(); }
});

// paw-p42x takes (painted before the second seed) whose frames repeat a part are real multi-seed takes now; their seeds that
// cannot be tracked (a frame outside the scene, one part twice on one frame) are dropped when the tool shows the take
const D = (who, part, t_ms, x = 0.5) => ({ name: `${who}_${part}`, who, part, poly: [[x, 0.4], [x + 0.1, 0.4], [x + 0.1, 0.5], [x, 0.5]], pinned: true, t_ms, source: 'user' });
test('paw-o74b.1: an older take that repeats a part is a multi-seed take; stale frames and same-frame twins dropped once, one undo step', async () => {
  const sc = take3(), gs = [D('c2', 'balls', 12000), D('c1', 'paws_l', 12000, 0.2), D('c2', 'balls', 15000, 0.6), D('c2', 'penis', 15000, 0.3), D('c2', 'penis', 15000, 0.35), D('c1', 'head', 45000)];
  sc[0] = { ...sc[0], groups: gs }; sc[1] = { ...sc[1], groups: gs }; sc[2] = { ...sc[2], groups: gs };
  const { server, app, G, at } = await tool(15000, sc);
  try {
    const left = takeGroups(app.doc.scenes, 1);
    assert.equal(left.length, 4, 'the stale head (45 s, outside the scene) and the earlier of the two penises dropped');
    assert.ok(left.some((g) => g.name === 'c2_penis' && g.poly[0][0] === 0.35), 'the later twin kept');
    assert.match(app._history.entries.at(-1).label, /drop seeds that cannot be tracked/);
    G.follow(15000);
    assert.deepEqual([G.groups.map((g) => g.name).sort(), G.seedFrames], [['c2_balls', 'c2_penis'], [12000, 15000]], 'each frame its own seeds');
    assert.deepEqual(G.othersHere().map((o) => o.g.name), ['c1_paws_l'], 'balls seeded here too: only the paws are dimmed from 12 s');
    at(12000); G.follow(12000);
    assert.deepEqual(G.groups.map((g) => g.name).sort(), ['c1_paws_l', 'c2_balls']);
    assert.deepEqual(G.seedsOfPart('c2_balls'), [12000, 15000]);
    app.undo();
    assert.equal(takeGroups(app.doc.scenes, 1).length, 6, 'Ctrl+Z brings them back');
  } finally { await server.close(); }
});

test('the best frame to paint comes from the selected shot, not another shot of its take', () => {
  const sc = take3();
  // a picture at 5 s (shot 0), 25 s (shot 2) and 45 s (another take); one at 15 s (shot 1) and 40 s
  const occ = (id, t) => ({ id, t });
  const ix = { occ: [occ('a', 5000), occ('b', 15000), occ('a', 25000), occ('b', 40000), occ('a', 45000)], buckets: { a: { occ: [occ('a', 5000), occ('a', 25000), occ('a', 45000)] }, b: { occ: [occ('b', 15000), occ('b', 40000)] } } };   // over the whole take, 'a' (5 s, shot 0) would win: it repeats more
  const b = bestPaintFrame([...sc, S(30000, 50000)], 1, ix);
  assert.ok(b.t >= 10000 && b.t < 20000, `shot 1's own frame (got ${b.t})`);
  const c = bestPaintFrame([...sc, S(30000, 50000)], 2, ix);
  assert.ok(c.t >= 20000 && c.t < 30000);
});
