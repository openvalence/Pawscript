// paw-ef73.33, the tracking store (real shell store, dev/mock-app.js): a loop tracked in shot 1 fills shot 3 by itself (a
// derived run with its ghost and its shot link, one toast); it follows the source (a flip); Shift+A accepts it; detach /
// dismiss / refill are one undo step each; a following derived run is never written to the .pawruns, a detached one is;
// an older build reading the project sees a plain ghost (no channels to rebuild: no crash).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const FM = 1000 / 30, F = 20;
const truth = (p) => 50 + 40 * Math.sin((2 * Math.PI * p) / F);
const ms = (f) => Math.round(f * FM);

async function setup() {
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  const R = await server.ssrLoadModule('/src/features/timeline/repeats.svelte.js'), RS = await server.ssrLoadModule('/src/features/timeline/repeat-scenes.js');
  const RF = await server.ssrLoadModule('/src/lib/runs-file.js'), RU = await server.ssrLoadModule('/src/lib/runs.js'), RC = await server.ssrLoadModule('/src/lib/runs-channel.js');
  const RP = await server.ssrLoadModule('/src/features/timeline/repeats.js');
  // pictures: the loop 5 passes in shot 1 (frames 30-129), shot 3 replays it from picture 7 for 90 frames (the last pass cut)
  const pic = new Array(420).fill(-1);
  for (let f = 30; f < 130; f++) pic[f] = (f - 30) % F;
  for (let f = 300, k = 0; f < 390; f++, k++) pic[f] = (7 + k) % F;
  const buckets = Array.from({ length: F }, () => []);
  for (let f = 0; f < 420; f++) if (pic[f] >= 0) buckets[pic[f]].push({ f0: f, f1: f, t_ms: ms(f) });
  const raw = { frames: 420, exact: 4, buckets };
  const scenes = [[0, 150], [150, 300], [300, 420]].map(([a, b]) => ({ start_ms: ms(a), end_ms: ms(b) }));
  const doc = { ...M.sampleDoc({ minutes: 1 }), axes: { stroke: [] }, scenes, ghosts: [], loops: [], media: { ...M.sampleDoc().media, path: 'C:/v/loop.mp4', fps: 30, durationMs: ms(420), width: 640, height: 360 } };
  const backend = { ...M.mockBackend(), frameRepeats: () => ({ promise: Promise.resolve(raw), cancel() {} }) };
  const app = M.createMockApp({ doc, keys: false, backend });
  app.mode = 'track';
  const toasts = [];
  const toast0 = app.toast.bind(app);
  app.toast = (m, k, o) => { toasts.push(m); return toast0(m, k, o); };
  const tr = T.trackingFor(app);
  tr.path = doc.media.path;
  R.loadRepeats(app);
  await new Promise((r) => setTimeout(r, 10));
  const ix = R.repeatsOf(app);
  assert.ok(ix, 'repeats loaded');
  app.doc.loops = RS.autoLoops(ix, FM, FM).map((c, k) => ({ id: 'lp' + k, t0: c.t0, t1: c.t1, auto: { key: c.key, t0: c.t0, t1: c.t1, end: c.end, n: c.n } }));
  // the source run: tracked over shot 1, channel proj = the picture's truth
  const pairs = Array.from({ length: 150 }, (_, f) => [ms(f), pic[f] >= 0 ? truth(pic[f]) + Math.sin(f * 12.9898) : 20]);
  const turns = []; for (let f = 31; f < 129; f++) if (pic[f] === 5 || pic[f] === 15) turns.push({ at: ms(f), pos: pic[f] === 5 ? 90 : 10 });
  const S = RU.makeRun({ n: 1, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: {}, range: { start: 0, end: ms(150) }, roi: null, frames: null, runs: [],
    result: { samples: pairs, points: turns, scenes: [{ start_ms: 0, end_ms: ms(150), sign: 1 }], channels: { proj: pairs } } });
  S.channel = 'proj';
  tr.runs = [S];
  app.doc.ghosts = [tr.ghostOf(S)];
  return { server, app, tr, S, toasts, RF, RC, RP, pic };
}
const fillOf = (tr) => tr.runs.find((r) => r.derived);

test('a loop tracked in shot 1 fills shot 3 by itself; follows a flip; plays live, Bake; detach / dismiss / refill are undo steps; storage', async () => {
  const { server, app, tr, S, toasts, RF, RC, RP, pic } = await setup();
  try {
    tr.syncFills();
    const F3 = fillOf(tr), id = 'fill-' + ms(300);
    assert.ok(F3, 'derived run made');
    assert.equal(F3.id, id); assert.equal(F3.derived.from, S.id); assert.equal(F3.name, 'looped from shot 1');   // shots 1..3, no scenes: plain numbers
    assert.match(F3.derived.what, /4\.5 passes · exact repeats/);
    const g = tr.ghost(id);
    assert.ok(g && g.script.length >= 6, 'its ghost carries the points');
    assert.deepEqual(g.source.derived, { from: S.id, kind: 'exact', j: 0 });
    assert.equal(g.source.keep, undefined, 'no channels kept on the ghost');
    assert.equal(tr.sceneLink(2)?.runId, id, 'the shot links it: the script lane shows it as the shot\'s suggestion');
    assert.equal(toasts.filter((m) => /filled from shot 1/.test(m)).length, 1);
    assert.match(toasts.find((m) => /filled/.test(m)), /^Shot 3 filled from shot 1/);
    // the derived signal = the picture's value at every frame of the replayed loop
    const ch = F3.channels.proj;
    let worst = 0; ch.v.forEach((y, x) => { if (y === y) worst = Math.max(worst, Math.abs(y - truth(pic[Math.round(ch.t[x] / FM)]))); });
    assert.ok(worst < 1.5, `derived vs truth ${worst}`);
    // idempotent: a second pass changes nothing (no new ghost object, no toast)
    const ghosts0 = app.doc.ghosts;
    tr.syncFills();
    assert.equal(app.doc.ghosts, ghosts0); assert.equal(toasts.filter((m) => /filled/.test(m)).length, 1);
    // follows the source: S flipped -> T's points mirrored
    const before = Array.from(tr.run(id).points.pos);
    tr.applyRunPatch(tr.run(S.id), { flips: [0] });
    tr.syncFills();
    const after = Array.from(tr.run(id).points.pos);
    assert.ok(tr.run(id).derived.dirMap.length === 1, 'the whole shot flipped');
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    assert.ok(Math.abs(mean(before) + mean(after) - 100) < 12 && before.some((p, k) => p !== after[k]), `mirrored: ${mean(before)} -> ${mean(after)}`);
    // paw-x7w7: shot 3 plays the fill live (no Accept); Bake of the run makes ordinary points, one undo step
    tr.select(id);
    const live = tr.liveOf('stroke')?.script || [];
    assert.ok(live.filter((p) => p.at >= ms(300) && p.at < ms(420)).length >= 6, 'live in the script');
    assert.ok(tr.bake({ run: id }) > 0);
    assert.ok(app.doc.axes.stroke.length >= 6 && app.doc.axes.stroke.every((p) => p.at >= ms(300) && p.at < ms(420)));
    app.undo();
    assert.equal(app.doc.axes.stroke.length, 0, 'one undo step');
    // storage: following = not in the .pawruns
    await tr.autosaveRuns('D:/auto');
    let saved = RF.decodeRuns(await app.backend.readBytes('D:/auto/runs.pawruns'));
    assert.deepEqual(saved.map((r) => r.id), [S.id]);
    // detach: one undo step; written to the .pawruns; no longer follows
    assert.ok(tr.detachFill(id));
    assert.equal(app.doc.scenes[2].linkfill, 'detached');
    tr.syncFills();
    assert.ok(!tr.isLiveFill(tr.run(id)));
    const frozen = Array.from(tr.run(id).points.pos);
    tr.applyRunPatch(tr.run(S.id), { flips: [] });
    tr.syncFills();
    assert.deepEqual(Array.from(tr.run(id).points.pos), frozen, 'detached: does not follow');
    tr.runsDirty = true;
    await tr.autosaveRuns('D:/auto');
    saved = RF.decodeRuns(await app.backend.readBytes('D:/auto/runs.pawruns'));
    assert.deepEqual(saved.map((r) => r.id).sort(), [S.id, id].sort(), 'a detached copy is stored like a run');
    app.undo();
    assert.equal(app.doc.scenes[2].linkfill, undefined);
    tr.syncFills();
    assert.ok(tr.isLiveFill(tr.run(id)), 'undo: following again');
    assert.notDeepEqual(Array.from(tr.run(id).points.pos), frozen, 'and it took the source\'s current direction');
    // dismiss: one undo step; the shot stays empty, not refilled
    assert.ok(tr.dismissFill(id));
    tr.syncFills();
    assert.equal(tr.run(id), null); assert.equal(tr.ghost(id), null); assert.equal(tr.sceneLink(2), null);
    tr.syncFills();
    assert.equal(tr.run(id), null, 'not refilled');
    app.undo();
    tr.syncFills();
    assert.ok(tr.run(id) && tr.ghost(id), 'undo of the dismiss: back');
    tr.dismissFill(id); tr.syncFills();
    // refill ("Fill from shot 1"): one undo step
    assert.ok(tr.refill(2));
    assert.equal(app.doc.scenes[2].linkfill, 'on');
    tr.syncFills();
    assert.ok(tr.run(id));
    // an older build: the ghost has no keep -> no run rebuilt from it, just the ghost (no crash)
    assert.equal(RC.runFromGhost(JSON.parse(JSON.stringify(tr.ghost(id))), [], {}), null);
    // the source gone: the fill goes too
    tr.remove(S.id);
    tr.syncFills();
    assert.equal(tr.run(id), null);
    assert.ok(RP);
  } finally { await server.close(); }
});

// paw-3xif: reopening a saved project: a fill pass while its runs file is still being read (no source run yet) dropped the
// saved fill, and announced it again ("Shot 3 filled from shot 1") once the runs landed
test('reopening a project: the saved fill stays, no "filled from" toast while or after its runs file is read', async () => {
  const { server, app, tr, S, toasts } = await setup();
  try {
    const id = 'fill-' + ms(300);
    tr.syncFills();
    app.doc.project = { ...(app.doc.project || {}), path: 'C:/v/loop.pawproj' };
    await tr.saveRunsFile('C:/v/loop.pawproj');
    const ghosts = app.doc.ghosts;
    assert.ok(ghosts.some((g) => g.id === id) && ghosts.some((g) => g.id === S.id));
    // opened again: the ghosts from the .pawproj, the runs not read yet
    toasts.length = 0; tr.runs = [];
    tr.loadRunsFile();
    tr.syncFills();   // a pass while the file is read (the effects queue one on every change)
    assert.ok(tr.ghost(id), 'the saved fill is kept while the runs file is read');
    await tr.runsLoad;
    tr.syncFills();
    assert.ok(tr.run(S.id) && tr.run(id)?.derived && tr.ghost(id), 'the source run read, the fill derived again');
    assert.deepEqual(toasts.filter((m) => /filled from/.test(m)), [], 'nothing new: no toast');
  } finally { await server.close(); }
});

// paw-3xif (the toast missing at fill time): the store outlives a document; a fill id is its shot's start, so a fill already
// announced in an earlier document kept the next document's fill at that start from being announced
test('another document opened: its new fill is announced even when an earlier document had a fill at the same start', async () => {
  const { server, app, tr, S, toasts } = await setup();
  try {
    tr.syncFills();
    assert.equal(toasts.filter((m) => /filled from/.test(m)).length, 1);
    // the next document (the same footage, nothing filled yet): its load reads its runs file
    tr.runs = [S]; app.doc.ghosts = [tr.ghostOf(S)];
    tr.loadRunsFile();
    tr.syncFills();
    assert.ok(tr.run('fill-' + ms(300)));
    assert.equal(toasts.filter((m) => /filled from/.test(m)).length, 2, 'announced in the new document');
  } finally { await server.close(); }
});

// paw-uzlr: with run ranges (the track took shot 1's), the fill must take shot 3 or it plays nothing there
test('with run ranges a linked shot\'s fill takes its shot: fill, re-derive, load of a project saved without its range', async () => {
  const { server, app, tr, S } = await setup();
  try {
    const id = 'fill-' + ms(300), T3 = [ms(300), ms(420)], onlyS = [{ id: 'rs', run: S.id, t0: 0, t1: ms(150), layer: 0 }];
    const fillRange = () => tr.runRanges.filter((x) => x.run === id).map((x) => [x.t0, x.t1]);
    app.doc.runRanges = onlyS;
    // the fill: takes shot 3, plays live there, Shift+B (the shot under the playhead) bakes it
    tr.syncFills();
    assert.deepEqual(fillRange(), [T3], 'the fill took shot 3');
    assert.ok((tr.liveOf('stroke')?.script || []).filter((p) => p.at >= T3[0] && p.at < T3[1]).length >= 6, 'shot 3 plays live');
    app.player.seek(ms(330));
    assert.ok(tr.bake() > 0, 'Shift+B bakes shot 3');
    app.undo();
    const rr = app.doc.runRanges;
    tr.syncFills();
    assert.equal(app.doc.runRanges, rr, 'a second pass writes nothing');
    // re-derive (the source flipped) of a fill saved without its range: takes it
    app.doc.runRanges = onlyS;
    tr.applyRunPatch(tr.run(S.id), { flips: [0] });
    tr.syncFills();
    assert.deepEqual(fillRange(), [T3], 're-derived: took shot 3');
    // load: a detached fill saved without its range takes its shot; the baked points never change
    assert.ok(tr.detachFill(id));
    tr.syncFills();
    app.doc.runRanges = onlyS;
    app.doc.axes = { ...app.doc.axes, stroke: [{ at: ms(10), pos: 20 }, { at: ms(320), pos: 80 }] };
    const axes = app.doc.axes, links = { v: 1, scenes: tr.links };
    tr.syncFills();
    assert.deepEqual(fillRange(), [], 'detached: syncFills leaves its ranges alone');
    app.blocks.get('links').load(app, links, {});
    assert.deepEqual(fillRange(), [T3], 'load repaired it');
    assert.equal(app.doc.axes, axes, 'the points untouched');
    // another run plays its shot: the repair leaves it
    app.doc.runRanges = [...onlyS, { id: 'o', run: S.id, t0: T3[0], t1: T3[1], layer: 0 }];
    app.blocks.get('links').load(app, links, {});
    assert.deepEqual(fillRange(), [], 'its shot is played by another run: left as it is');
  } finally { await server.close(); }
});

test('paw-qvg8: with run ranges a new fill takes its shot once; the owner\'s range edit there survives the next fill sync and undo / redo', async () => {
  const { server, app, tr, S } = await setup();
  try {
    app.doc.runRanges = [];   // a project with ranges
    tr.syncFills(); tr.syncFills();
    const id = 'fill-' + ms(300), t0 = ms(300), t1 = ms(420), here = () => app.doc.runRanges.filter((r) => r.t1 > t0 && r.t0 < t1).map((r) => [r.run, r.t0, r.t1]);
    assert.deepEqual(here(), [[id, t0, t1]], 'the new fill took its shot');
    // the owner: Use run here, the source run over the second half of shot 3 (one undo step)
    tr.useRun(S.id, t0 + 1000, t1);
    const mine = [[id, t0, t0 + 1000], [S.id, t0 + 1000, t1]];
    assert.deepEqual(here(), mine);
    // an unrelated change later: the fills sync again (a scene edit, a new run...)
    app.transact('Rename', () => { app.doc.bookmarks = [{ id: 'b', at: 10, note: 'x' }]; });
    tr.syncFills();
    assert.deepEqual(here(), mine, 'the owner\'s range stays (it snapped back to the fill over the whole shot)');
    app.undo(); app.undo();
    assert.deepEqual(here(), [[id, t0, t1]], 'undo of the range edit: the fill\'s range');
    app.redo();
    assert.deepEqual(here(), mine, 'redo: the owner\'s range again');
    // a shot left with no range at all: the fill takes it again
    app.doc.runRanges = app.doc.runRanges.filter((r) => !(r.t1 > t0 && r.t0 < t1));
    tr.syncFills();
    assert.deepEqual(here(), [[id, t0, t1]]);
  } finally { await server.close(); }
});
