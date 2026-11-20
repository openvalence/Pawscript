// paw-57ve: polarity stretches in the tracking store: kept on the shots per run (one undo step; a drag's preview none),
// the run recomposed with them, the .pawproj (shots) and .pawruns round trips, restored runs, the commands' helpers.
// The store is a .svelte.js module: loaded through vite's SSR transform (effects do not run: recomposes are explicit).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeRun } from '../src/lib/runs.js';
import { runFromGhost } from '../src/lib/runs-channel.js';
import { projectDoc, appDocFrom } from '../src/app/project-logic.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const PROJ = 'C:/videos/sample.pawproj';
let server, M, T;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
});
after(() => server?.close());

const SHOTS = [{ start_ms: 0, end_ms: 4000 }, { start_ms: 4000, end_ms: 8000 }];
function open(be, ghosts, scenes = SHOTS) {
  const doc = { ...M.sampleDoc(), project: { path: PROJ }, scenes };
  if (ghosts) doc.ghosts = ghosts(doc.ghosts);
  const app = M.createMockApp({ backend: be, doc, keys: false }), tr = T.trackingFor(app);
  app.loadBlocks({});
  return { app, tr };
}
// a stroke every 0.8 s whose measured sense flops at 4 s (the second shot)
const TS = Array.from({ length: 240 }, (_, i) => Math.round((i * 1000) / 30));
const flop = (t) => (t < 4000 ? 1 : -1) * Math.sin((2 * Math.PI * t) / 800);
function strokeRun(n) {
  return makeRun({ n, tracker: { id: 'lk_box', name: 'LK box' }, params: {}, range: { start: 0, end: 8000 }, roi: null, frames: null, runs: [],
    result: { samples: TS.map((t) => [t, 0.5 + 0.5 * flop(t)]), points: [{ at: 0, pos: 50 }, { at: 200, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 4000 }, { start_ms: 4000, end_ms: 8000 }], channels: { sig: TS.map((t) => [t, flop(t)]) } } });
}
function add(a, run) {
  a.tr.runs = [...a.tr.runs, run];
  a.app.doc.ghosts = [...a.app.doc.ghosts, a.tr.ghostOf(run)];
  a.tr.select(run.id);
  a.tr.setChannel(run.id, 'sig');   // composed on its own channel (the ghost keeps it)
}
const script = (a, id) => a.tr.ghost(id).script.map((p) => `${p.at}:${p.pos}`);

test('a stretch: one undo step on its shot, the run recomposed with it, a preview writes nothing', async () => {
  const a = open(M.mockBackend());
  await a.tr.runsLoad;
  add(a, strokeRun(4));
  const plain = script(a, 'run4'), n0 = a.app.history.index;
  assert.equal(a.tr.setRunFlips('run4', [[4500, 6000]], { commit: false }), true);
  assert.equal(a.app.history.index, n0, 'a drag step: no history');
  assert.deepEqual(a.tr.flipsOf(a.tr.run('run4')), [[4500, 6000]], 'the preview is what the run uses');
  assert.equal(a.app.doc.scenes[1].polarity, undefined);
  assert.ok(a.tr.setRunFlips('run4', [[4500, 6000]]));
  assert.equal(a.tr.flipPreview, null);
  assert.equal(a.app.history.index, n0 + 1, 'the release: one undo step');
  assert.deepEqual(a.app.doc.scenes[1].polarity, { run4: [[4500, 6000]] }, 'kept on the shot under it, per run');
  a.tr.setChannel('run4', 'sig');   // the store's recompose (its effect, under SSR called by hand)
  const r = a.tr.run('run4');
  assert.deepEqual(r.flipSpans, [[4500, 6000]]);
  const s = script(a, 'run4'), far = (x) => +x.split(':')[0] < 4500 - 600 || +x.split(':')[0] > 6000 + 600;
  assert.deepEqual(s.filter(far), plain.filter(far), 'outside the stretch (+ its joins): the same points');
  assert.notDeepEqual(s, plain, 'inside: flipped');
  // undo: gone in one step; redo: back
  a.app.undo();
  assert.equal(a.app.doc.scenes[1].polarity, undefined);
  assert.deepEqual(a.tr.flipsOf(a.tr.run('run4')), []);
  a.app.redo();
  assert.deepEqual(a.tr.flipsOf(a.tr.run('run4')), [[4500, 6000]]);
  // a stretch over the cut is split there, each half on its own shot
  a.tr.setRunFlips('run4', [[3000, 5000]]);
  assert.deepEqual(a.app.doc.scenes[0].polarity, { run4: [[3000, 4000]] });
  assert.deepEqual(a.app.doc.scenes[1].polarity, { run4: [[4000, 5000]] });
  a.tr.setRunFlips('run4', []);
  assert.ok(!('polarity' in a.app.doc.scenes[0]) && !('polarity' in a.app.doc.scenes[1]), 'none left: the key goes');
});

test('flip to the end of the shot, flip the range, a drag xor (the store\'s helpers)', async () => {
  const a = open(M.mockBackend());
  await a.tr.runsLoad;
  add(a, strokeRun(5));
  a.app.player.seek(5000);
  const t = a.tr.run('run5') && Math.round(a.app.player.timeMs);
  a.tr.flipToEnd();
  const [st] = a.tr.flipsOf(a.tr.run('run5'));
  assert.ok(st && Math.abs(st[0] - t) <= 34 && st[1] === 8000, `from the playhead's frame to the end of its scene: ${st}`);
  a.tr.flipToEnd();
  assert.deepEqual(a.tr.flipsOf(a.tr.run('run5')), [], 'again: un-flipped (xor)');
  assert.equal(a.tr.flipStretch(9000, 9500), null, 'outside the run: nothing');
  a.tr.flipStretch(1000, 2000);
  a.tr.flipStretch(1500, 2500);
  assert.deepEqual(a.tr.flipsOf(a.tr.run('run5')), [[1000, 1500], [2000, 2500]]);
  const n0 = a.app.history.index;
  a.app.doc.range = { t0: 3000, t1: 5000 };
  a.tr.flipRange();
  assert.deepEqual(a.tr.flipsOf(a.tr.run('run5')), [[1000, 1500], [2000, 2500], [3000, 4000], [4000, 5000]], 'split at the run\'s cut');
  assert.equal(a.app.history.index, n0 + 1, 'over two shots: still one undo step');
});

test('save / load: the shots keep the stretches in the .pawproj, the .pawruns keeps the run as flipped; restored runs flip too', async () => {
  const be = M.mockBackend();
  const a = open(be);
  await a.tr.runsLoad;
  add(a, strokeRun(6));
  a.tr.setRunFlips('run6', [[4000, 8000]]);
  a.tr.setChannel('run6', 'sig');
  const flipped = script(a, 'run6');
  // .pawproj: the shots (extra.scenes) round trip with their polarity
  const d = a.app.doc, pd = JSON.parse(JSON.stringify(projectDoc({ media: d.media, axes: d.axes, scenes: d.scenes, ghosts: d.ghosts, project: d.project })));
  const back = appDocFrom(pd, { path: PROJ });
  assert.deepEqual(back.scenes[1].polarity, { run6: [[4000, 8000]] });
  // .pawruns: the reopened run is the flipped one
  await a.app.blocksSaved(PROJ);
  const b = open(be, () => back.ghosts, back.scenes);
  await b.tr.runsLoad;
  const r = b.tr.run('run6');
  assert.ok(r && !r.restored);
  assert.deepEqual(r.flipSpans, [[4000, 8000]]);
  assert.deepEqual(script(b, 'run6'), flipped);
  b.tr.setChannel('run6', 'sig');
  assert.deepEqual(script(b, 'run6'), flipped, 'recomposed after the load: the same points');
  // a run rebuilt from its ghost (no .pawruns): flipped from the shots
  const g = back.ghosts.find((x) => x.id === 'run6');
  const plain = runFromGhost(g, [], {}), res = runFromGhost(g, [], { flips: [[4000, 8000]] });
  assert.deepEqual(res.flipSpans, [[4000, 8000]]);
  const after = (p) => Array.from(p.pos).filter((_, k) => p.at[k] > 4600);
  assert.notDeepEqual(after(res.points0), after(plain.points0));
  const c = open(M.mockBackend(), () => back.ghosts, back.scenes);   // no runs file: the ghost rebuild, its stretches from the shots
  await c.tr.runsLoad;
  assert.equal(c.tr.run('run6')?.restored, true);
  assert.deepEqual(c.tr.run('run6').flipSpans, [[4000, 8000]]);
});

test('a malformed polarity from a file is ignored, never a crash', async () => {
  const a = open(M.mockBackend());
  await a.tr.runsLoad;
  add(a, strokeRun(8));
  a.app.doc.scenes = [{ ...SHOTS[0], polarity: 5 }, { ...SHOTS[1], polarity: { run8: [[5000, 'x'], 'bad', [6000, 5500]] } }];
  assert.deepEqual(a.tr.flipsOf(a.tr.run('run8')), [[5500, 6000]]);
  a.tr.setChannel('run8', 'sig');
  assert.deepEqual(a.tr.run('run8').flipSpans, [[5500, 6000]]);
});

// paw-vtec: F (flipScene) / flipRun act on the signal: the run recomposed with the flip, not its points mirrored
const shape = (t) => { const u = (t % 1000) / 1000; return u < 0.35 ? 0 : u < 0.8 ? ((u - 0.35) / 0.45) ** 0.5 : 1 - ((u - 0.8) / 0.2) ** 2; };   // a rest at the deep turn, fast in / slow out
function shapeRun(n, inv) {
  return makeRun({ n, tracker: { id: 'lk_box', name: 'LK box' }, params: {}, range: { start: 0, end: 8000 }, roi: null, frames: null, runs: [],
    result: { samples: TS.map((t) => [t, 0.5]), points: [{ at: 0, pos: 50 }, { at: 200, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 8000 }], channels: { sig: TS.map((t) => [t, inv ? 1 - shape(t) : shape(t)]) } } });
}
test('F: upside down + F = the right way up (the run recomposed with it); F again = as tracked; a stretch over the scene = F', async () => {
  const a = open(M.mockBackend(), undefined, [{ start_ms: 0, end_ms: 8000 }]);
  await a.tr.runsLoad;
  add(a, shapeRun(11, false));
  add(a, shapeRun(12, true));
  const good = script(a, 'run11'), tracked = script(a, 'run12');
  assert.notDeepEqual(tracked, good);
  a.tr.select('run12');
  a.tr.flipScene(0);
  assert.deepEqual(a.tr.run('run12').flips, [0]);
  assert.deepEqual(script(a, 'run12'), good, 'flipped = tracked the right way up');
  assert.deepEqual(a.tr.run('run12').dir.whole, [0]);
  a.tr.flipScene(0);
  assert.deepEqual(script(a, 'run12'), tracked, 'flip again: back');
  a.tr.flipRun();
  assert.deepEqual(script(a, 'run12'), good, 'flipRun: every scene');
  a.tr.flipRun();
  // the whole scene as a stretch (a drag over it, or flip to the end from its start): the same thing downstream
  a.tr.setRunFlips('run12', [[0, 8000]]);
  a.tr.setChannel('run12', 'sig');
  assert.deepEqual(script(a, 'run12'), good, 'a stretch over the whole scene = F');
  a.app.undo();
  a.tr.setChannel('run12', 'sig');
  assert.deepEqual(script(a, 'run12'), tracked, 'undo: as tracked');
});
test('a .pawruns from before (points0 as tracked, the flip applied to its points after) reopens with the same direction', async () => {
  const be = M.mockBackend(), a = open(be, undefined, [{ start_ms: 0, end_ms: 8000 }]);
  await a.tr.runsLoad;
  add(a, shapeRun(11, false));
  add(a, shapeRun(13, true));
  const good = script(a, 'run11'), r = a.tr.run('run13');
  // the old store: flips kept, points0 unflipped, points = points0 mirrored (and its ghost)
  const old = { at: r.points0.at, pos: Float64Array.from(r.points0.pos, (p) => 100 - p) };
  a.tr.runs = a.tr.runs.map((x) => (x.id === 'run13' ? { ...x, flips: [0], points: old } : x));
  a.tr.patchGhost('run13', { script: Array.from(old.at, (at, k) => ({ at, pos: old.pos[k] })) });
  const before = script(a, 'run13');
  const d = a.app.doc, back = appDocFrom(JSON.parse(JSON.stringify(projectDoc({ media: d.media, axes: d.axes, scenes: d.scenes, ghosts: d.ghosts, project: d.project }))), { path: PROJ });
  await a.app.blocksSaved(PROJ);
  const b = open(be, () => back.ghosts, back.scenes);
  await b.tr.runsLoad;
  // as saved: same times; depths within half a position (a mid point no longer clamped by the 600 / s cap is rounded once
  // on the signal path and mirrored unrounded on the old path: 51 vs 50.625)
  const near = (x, y) => { const f = (q) => q.map((e) => String(e).split(':').map(Number)), A = f(x), B = f(y); return A.length === B.length && A.every(([at, pos], k) => at === B[k][0] && Math.abs(pos - B[k][1]) <= 0.5); };
  assert.ok(near(script(b, 'run13'), before), 'as saved');
  const q = b.tr.run('run13');
  assert.deepEqual(Array.from(q.points0.pos), Array.from(old.pos), 'points0 recomposed with the flip at the load');
  b.tr.setChannel('run13', 'sig');
  assert.deepEqual(script(b, 'run13'), good, 'recomposed: the flip takes the signal path, the same direction');
  b.tr.select('run13');
  b.tr.flipScene(0);
  assert.notDeepEqual(script(b, 'run13'), good, 'and F still flips it back');
});
