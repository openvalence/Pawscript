// paw-wg2d: anchors in the tracking store: the key at the playhead (one undo step, again = off), a drag's steps write no
// history and the release is one step, the shots carry them through a .pawproj round trip (no run involved: a re-track keeps
// them), the commands are on free keys. The store is a .svelte.js module, loaded through vite's SSR transform.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { projectDoc, appDocFrom } from '../src/app/project-logic.js';
import { anchorsOf } from '../src/lib/anchors.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T, C;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  C = (await server.ssrLoadModule('/src/features/tracking/commands.js')).default;
});
after(() => server?.close());

const SHOTS = [{ start_ms: 0, end_ms: 4000 }, { start_ms: 4000, end_ms: 8000 }];
function open() {
  const app = M.createMockApp({ backend: M.mockBackend(), doc: { ...M.sampleDoc(), project: { path: 'C:/v/a.pawproj' }, scenes: SHOTS }, keys: false });
  app.loadBlocks({});
  return { app, tr: T.trackingFor(app) };
}

test('Alt+0 / Alt+Shift+0 / Alt+M: an anchor at the playhead, one undo step; the same key there again takes it off', () => {
  const { app, tr } = open(), n0 = app.history.index;
  app.player.seek(5000);
  assert.ok(tr.anchorAt(0));
  assert.equal(app.history.index, n0 + 1);
  const at = anchorsOf(app.doc);
  assert.equal(at.length, 1); assert.equal(at[0].shot, 1); assert.equal(at[0].pos, 0);
  assert.ok(tr.anchorAt(100, 6000));
  assert.ok(tr.anchorAt(0, at[0].ms));   // the same kind on its frame: off
  assert.deepEqual(anchorsOf(app.doc).map((a) => a.pos), [100]);
  app.undo();
  assert.deepEqual(anchorsOf(app.doc).map((a) => a.pos), [0, 100]);
  const keys = Object.fromEntries(C.filter((c) => /^tracking\.anchor/.test(c.id)).map((c) => [c.id, c.keys[0]]));
  assert.deepEqual(keys, { 'tracking.anchorIn': 'Alt+0', 'tracking.anchorOut': 'Alt+Shift+0', 'tracking.anchorMid': 'Alt+M' });
});

test('a drag moves an anchor frame by frame: its steps write no history, the release one step; Delete = moveAnchor(a, null)', () => {
  const { app, tr } = open();
  tr.anchorAt(50, 1000);
  const a = tr.anchors[0], n0 = app.history.index;
  tr.moveAnchor(a, 1510, { commit: false });
  assert.equal(app.history.index, n0);
  assert.equal(tr.anchors[0].ms, app.player.snap(1510), 'the preview draws the moved mark');
  assert.equal(anchorsOf(app.doc)[0].ms, a.ms, 'nothing written yet');
  tr.moveAnchor(a, 1510);
  assert.equal(app.history.index, n0 + 1);
  assert.equal(tr.detailPreview, null);
  assert.equal(anchorsOf(app.doc)[0].ms, app.player.snap(1510));
  tr.moveAnchor(anchorsOf(app.doc)[0], null);
  assert.equal(anchorsOf(app.doc).length, 0);
});

test('anchors live on the shots: a .pawproj round trip keeps them, no run needed', () => {
  const { app, tr } = open();
  tr.anchorAt(0, 1000); tr.anchorAt(100, 1400); tr.anchorAt(50, 6000);
  const d = app.doc, back = appDocFrom(JSON.parse(JSON.stringify(projectDoc({ media: d.media, axes: d.axes, scenes: d.scenes, ghosts: d.ghosts, project: d.project }))), { path: 'C:/v/a.pawproj' });
  assert.deepEqual(anchorsOf(back), anchorsOf(app.doc));
  assert.equal(anchorsOf(back).length, 3);
});
