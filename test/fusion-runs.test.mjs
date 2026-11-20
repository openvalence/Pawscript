// paw-orm2: "the fused behaviour is buggy when a second run is done, or when multiple shots exist for the same scene".
// (1) A run is composed per RUN scene with the derive of the shot under its middle (rederive.js runDerives) and the link
// overlapping it most (runs-channel.js sceneChannels); a run scene often holds several shots (camera splits: his "S16–S22").
// The panel read and wrote the selected shot's own settings: a pad drag on shot 16 did nothing, one on shot 20 moved all
// seven, and the panel on 16 still showed its own. (2) Discard + Track again gave a new run1 that met run1's old links and
// compose memo: never composed (the sidecar's pick played, the chip said Fused). (3) A second run beside the first took no
// link and was never composed: no fusion. The store is a .svelte.js module, loaded through vite's SSR transform (effects do
// not run: what the compose reads is asserted, and the composes the store makes itself).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runDerives } from '../src/lib/rederive.js';
import { CASES } from './fusion-synth.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
});
after(() => server?.close());

const sc = CASES.find((c) => c.id === 'handjob').make();
const CH = Object.fromEntries(Object.entries(sc.run.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
const TS = CH.who_pair_proj.map(([t]) => t);
// one take of three shots (camera splits: joined, soft), one run scene for the sidecar
const SHOTS = [{ start_ms: 0, end_ms: 4000, tags: ['handjob'] }, { start_ms: 4000, end_ms: 9000, join: true, split: 'camera', tags: ['handjob'] }, { start_ms: 9000, end_ms: 20000, join: true, split: 'camera', tags: ['handjob'] }];
const TRACKER = { id: 'tapnext_points', name: 'TAPNext++', params: [] };

function open() {
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), scenes: SHOTS.map((s) => ({ ...s })), ghosts: [] }, keys: false }), tr = T.trackingFor(app);
  app.loadBlocks({});
  tr.openVideo(app.doc.media?.path || null);   // (its effect, under SSR called by hand)
  // the sidecar: one run scene over the take, the painted parts' centres; any other job (score) cancelled
  tr.job = async (label) => (label === 'track' ? { result: { samples: TS.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: 19900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: CH, notes: [] } } : { cancelled: true });
  return { app, tr };
}
const track = async (a) => (await a.tr.runTrack(TRACKER, { start: 0, end: 20000 }, { axis: 'auto' }, null, [], { check: false })).run.id;
const composedFuse = (a, id) => runDerives(a.tr.run(id), a.app.doc.scenes)[0]?.fuse || null;

test('several shots in one run scene: every shot reads and writes the settings the run scene is composed with', async () => {
  const a = open(), id = await track(a);
  assert.deepEqual(a.tr.composedWith(0, id).shots, [0, 1, 2]);
  assert.equal(a.tr.composedWith(0, id).k, 2, 'the run scene\'s middle (10 s) is in shot 3');
  const n0 = a.app.history.index;
  a.tr.setFuse(0, { pad: { x: 1, y: -1 } }, { run: id });   // the first shot, not the one under the middle
  assert.equal(a.app.history.index, n0 + 1, 'one undo step');
  assert.deepEqual(composedFuse(a, id), { pad: { x: 1, y: -1 } }, 'the edit on shot 1 reaches the compose (it went to shot 1 only)');
  for (const i of [0, 1, 2]) assert.deepEqual(a.tr.fuseControls(i, null, id), { pad: { x: 1, y: -1 } }, `the panel on shot ${i + 1} shows it`);
  a.app.undo();
  assert.equal(composedFuse(a, id), null, 'undo: back on every shot');
  assert.deepEqual(a.tr.fuseControls(0, null, id), {});
  // an older project: the shots' own settings differ; the panel shows what plays, an edit makes them one
  a.app.doc.scenes = a.app.doc.scenes.map((s, i) => ({ ...s, derives: { [id]: { fuse: { pad: { x: i / 4, y: 0 } } } } }));
  assert.deepEqual(a.tr.fuseControls(0, null, id), { pad: { x: 0.5, y: 0 } }, 'shot 3 (under the middle) is what plays');
  a.tr.setFuse(1, { prior: 0.2 }, { run: id });
  for (const i of [0, 1, 2]) assert.deepEqual(a.app.doc.scenes[i].derives[id].fuse, { pad: { x: 0.5, y: 0 }, prior: 0.2 });
  // a source picked on one of them (the Signal row) reaches the run scene, and a drag's preview covers it
  a.tr.setDerive(0, { cam: { strength: 40 } }, { commit: false, run: id });
  assert.ok(a.tr.derivePreview.t0 <= 10000 && a.tr.derivePreview.t1 > 10000, 'the preview covers the run scene\'s middle');
  a.tr.cancelDerive();
});

test('a channel picked on one shot of the run scene is the one its run scene is composed from', async () => {
  const a = open(), id = await track(a);
  assert.equal(a.tr.shotDerive(1, id)?.smart, true, 'paw-lji3: the new run arrives with Smart stroke on (it plays fused over any link)');
  a.tr.setDerive(0, { smart: false }, { run: id });   // off: the link decides again
  a.tr.setChannel(id, 'who_pair_proj', 0);   // a camera-handling channel (each shot of a scene keeps its own: not inherited)
  assert.ok(a.tr.links.filter((l) => l.run === id).every((l) => l.channel === 'who_pair_proj'), 'every shot of the run scene takes it');
  assert.deepEqual(a.tr.run(id).sceneChannels, ['who_pair_proj']);
  for (const i of [0, 1, 2]) assert.equal(a.tr.channelFor(a.tr.run(id), i), 'who_pair_proj');
});

test('discard + Track again: the new run (a new number, paw-1fd3) is composed, fused, its old links gone', async () => {
  const a = open(), id = await track(a);
  const r1 = a.tr.run(id), fused = a.tr.ghost(id).script;
  assert.deepEqual(r1.sceneChannels, ['fused']);
  a.tr.remove(id);
  assert.equal(a.tr.links.filter((l) => l.run === id).length, 0, 'its links go with it');
  const id2 = await track(a);
  assert.notEqual(id2, id, 'paw-1fd3: a discarded run number is never given again');
  const r2 = a.tr.run(id2);
  assert.deepEqual(r2.sceneChannels, ['fused'], 'composed (it was not: the sidecar\'s pick played)');
  assert.ok(r2.lane, 'its lane trace');
  assert.equal(a.tr.shotSource(r2, 0), 'fused');
  assert.ok(a.tr.fuseInfo(0), 'the fusion panel has its record');
  assert.deepEqual(a.tr.ghost(id2).script, fused, 'the same tracks, the same script');
});

test('paw-lji3 / paw-83sq: a new run arrives with Smart stroke on (no undo step); off by hand is one step and a re-track keeps it, with the camera', async () => {
  const a = open(), n0 = a.app.history.index, id = await track(a);
  assert.equal(a.app.history.index, n0, 'tracking is no undo step (nor a fix-log entry)');
  for (const i of [0, 1, 2]) assert.equal(a.tr.shotDerive(i, id)?.smart, true, `shot ${i + 1}: Smart stroke on`);
  assert.equal(a.tr.shotSource(a.tr.run(id), 0), 'fused');
  assert.ok(a.tr.run(id).whys?.why?.length, 'composed through the strokes step (Smart stroke)');
  a.tr.setSmart(0, false); a.tr.setSignalCam({ mode: 'off' });
  assert.equal(a.app.history.index, n0 + 2, 'off and the camera: one undo step each');
  assert.equal(a.app.history.entries.at(-2).label, 'Smart stroke off');
  const off = a.tr.shotDerive(0, id);
  assert.equal(off.smart, false); assert.equal(off.cam.mode, 'off');
  assert.equal(runDerives(a.tr.run(id), a.app.doc.scenes)[0].smart, false, 'what the compose reads: the classic path again');
  // Track again (the same span, beside it): the shots' settings carry over to the new run
  const id2 = await track(a);
  assert.notEqual(id2, id);
  for (const i of [0, 1, 2]) { const d = a.tr.shotDerive(i, id2); assert.equal(d?.smart, false, `shot ${i + 1} still off`); assert.equal(d?.cam?.mode, 'off'); }
  assert.equal(a.app.history.index, n0 + 2);
  // turned back on, then re-tracked: on
  a.tr.select(id2); a.tr.setSmart(0, true);
  const id3 = await track(a);
  assert.equal(a.tr.shotDerive(0, id3)?.smart, true);
  // undo / redo of the manual switch
  a.app.undo(); assert.equal(a.tr.shotDerive(0, id2)?.smart, false); a.app.redo(); assert.equal(a.tr.shotDerive(0, id2)?.smart, true);
});

test('a second run beside the first: composed fused too; the shots keep playing the first', async () => {
  const a = open(), id = await track(a), id2 = await track(a);
  assert.notEqual(id2, id);
  const r2 = a.tr.run(id2);
  assert.deepEqual(r2.sceneChannels, ['fused'], 'the second run is fused (it played the sidecar\'s pick)');
  a.tr.select(id2);
  assert.equal(a.tr.shotSource(r2, 1), 'fused');
  assert.ok(a.tr.fuseInfo(1), 'the panel of the selected second run has a fusion record');
  assert.ok(a.tr.links.every((l) => l.run === id), 'no shot link taken from the first run');
  assert.deepEqual(a.tr.ghost(id2).script, a.tr.ghost(id).script);
});
