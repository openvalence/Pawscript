// paw-iwb7: "I'll paint a shot and hit T and I am tracking what was selected before" / "if I press Tab on a frame it's because I
// scrubbed to it and I wanna start painting, so move my cursor to the paint area". The track target follows the paint
// (quickbar.js paintTarget, groups.svelte.js #retarget); Tab over the timeline takes the hovered frame and asks for the pointer
// on the picture (groups-room.js pictureTarget).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintTarget, spanText } from '../src/features/timeline/quickbar.js';
import { pictureTarget } from '../src/features/tracking/groups-room.js';

// three shots, three scenes: A [0, 10 s), B [10, 20 s), C [20, 30 s)
const L = [{ start_ms: 0, end_ms: 10000 }, { start_ms: 10000, end_ms: 20000, cut: 'hard' }, { start_ms: 20000, end_ms: 30000, cut: 'hard' }];
const sel = (...shots) => ({ active: shots[0] ?? -1, shots });
const NONE = sel();

test('paintTarget: each stale input loses to the painted frame; the target holding it keeps', () => {
  // the shot selection (live: the range is its hull; or not live: a range set since)
  assert.equal(paintTarget(L, sel(0), { t0: 0, t1: 10000 }, null, 1, 12000), 1, 'shot A selected (live), painted in B: B');
  assert.equal(paintTarget(L, sel(0), null, null, 1, 12000), 1, 'shot A selected, no range: B');
  assert.equal(paintTarget(L, sel(0), { t0: 0, t1: 10000 }, null, 0, 4000), -1, 'painted inside the selected shot: as it is');
  assert.equal(paintTarget(L, sel(0, 2), null, null, 1, 12000), 1, 'A and C selected (not one run), painted in B: B');
  assert.equal(paintTarget(L, sel(0, 2), null, null, 2, 25000), -1, '... painted in C: the selection stays');
  // an action region selected (it wins over the range in own())
  const act = { id: 'a', kind: 'act', t0: 2000, t1: 6000, layer: 0, tags: ['anal'] };
  assert.equal(paintTarget(L, NONE, { t0: 2000, t1: 6000 }, act, 1, 12000), 1, 'a region in A selected, painted in B: B');
  assert.equal(paintTarget(L, NONE, { t0: 2000, t1: 6000 }, act, 0, 8000), 0, 'painted in A outside the region: A');
  assert.equal(paintTarget(L, NONE, { t0: 2000, t1: 6000 }, act, 0, 3000), -1, 'painted inside the region: the region stays ("track just this action")');
  assert.equal(paintTarget(L, NONE, null, { ...act, t1: 99999 }, 2, 29000, 30000), -1, 'a region past the end: clipped to the video, still holds');
  // a stale I-O range, nothing selected (Track takes it as it is)
  assert.equal(paintTarget(L, NONE, { t0: 1000, t1: 5000 }, null, 1, 12000), 1, 'an I-O range in A, painted in B: B');
  assert.equal(paintTarget(L, NONE, { t0: 1000, t1: 5000 }, null, 0, 3000), -1, 'painted inside the range: the range stays');
  assert.equal(paintTarget(L, NONE, { t0: 1000, t1: 5000 }, null, 0, 7000), 0, 'painted in A outside the range: A');
  // nothing selected, no range: T tracks the scene at the playhead, which is where the paint is
  assert.equal(paintTarget(L, NONE, null, null, 1, 12000), -1);
  assert.equal(paintTarget(L, NONE, null, null, -1, 12000), -1, 'no shot under the frame: nothing');
  // one scene of two shots (a camera move): a selection of its first shot, painted in its second: that shot
  const S = [{ start_ms: 0, end_ms: 10000 }, { start_ms: 10000, end_ms: 20000, cut: 'soft' }];
  assert.equal(paintTarget(S, sel(0), { t0: 0, t1: 10000 }, null, 1, 12000), 1);
});

test('spanText names a span by its shots, else by its times', () => {
  assert.equal(spanText(L, 10000, 20000), 'shot 2');
  assert.equal(spanText(L, 0, 20000), 'shots 1 to 2');
  assert.equal(spanText(L, 20000, 29500), 'shot 3', 'the last shot clipped to the video');
  assert.match(spanText(L, 2000, 6000), /–/);
});

test('pictureTarget: the last painted point while it is on the picture, else the middle of the visible picture', () => {
  const st = { left: 100, top: 50, width: 800, height: 450 };
  const fit = (nx, ny) => [80 + nx * 640, ny * 360 + 45];   // a 640 x 360 picture centred on the stage
  assert.deepEqual(pictureTarget(st, fit), [100 + 400, 50 + 225], 'nothing painted: the middle');
  assert.deepEqual(pictureTarget(st, fit, [0.25, 0.5]), [100 + 80 + 160, 50 + 45 + 180], 'the last painted point');
  const zoom = (nx, ny) => [-400 + nx * 1600, -200 + ny * 900];   // zoomed in: the picture overflows the stage
  assert.deepEqual(pictureTarget(st, zoom), [100 + 400, 50 + 225], 'zoomed: the middle of what is on the stage');
  assert.deepEqual(pictureTarget(st, zoom, [0.05, 0.05]), [100 + 400, 50 + 225], 'the painted point is off the stage: the middle');
  const half = (nx, ny) => [400 + nx * 800, ny * 450];   // panned: only the left half of the picture on the right of the stage
  assert.deepEqual(pictureTarget(st, half), [100 + 600, 50 + 225]);
  assert.equal(pictureTarget(st, (nx, ny) => [900 + nx * 100, ny * 100]), null, 'none of the picture on the stage');
});

async function tool() {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const M = await server.ssrLoadModule('/dev/mock-app.js'), GS = await server.ssrLoadModule('/src/features/tracking/groups.svelte.js');
  const T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js'), ST = await server.ssrLoadModule('/src/features/timeline/state.svelte.js');
  const doc = { ...M.sampleDoc(), scenes: L.map((s) => ({ ...s })), ghosts: [] };
  doc.media = { ...(doc.media || {}), path: 'C:\\clip.mp4', durationMs: 30000 };
  const app = M.createMockApp({ doc, keys: false, backend: M.mockBackend() });
  app.tracking = T.trackingFor(app); app.mode = 'track';
  const toasts = []; app.toast = (m) => toasts.push(String(m));
  const G = GS.groupsFor(app), tl = ST.tlFor(app);
  const paintAt = (t) => { app.player.seek(t); G.toggle(true); assert.ok(G.begin(0.5, 0.5, false), 'a stroke starts'); G.move(0.55, 0.5); G.end(); G.toggle(false); };
  return { server, app, G, tl, toasts, paintAt };
}

test('the Groups tool: painting in shot B with shot A, a region in A or a stale range selected makes B the target; inside a selected region it stays', async () => {
  const t = await tool();
  try {
    const { app, tl, toasts, paintAt } = t;
    // the reproduction: shot A selected, paint in B
    tl.scene = 0; tl.shots = [0]; app.doc.range = { t0: 0, t1: 10000 };
    paintAt(12000);
    assert.deepEqual([tl.scene, [...tl.shots]], [1, [1]], 'the selection moved to B');
    assert.deepEqual(app.doc.range, { t0: 10000, t1: 20000 }, 'the range is B');
    assert.match(toasts.join(' | '), /tracks shot 2, where you painted/);
    assert.match(app.undo()?.label || '', /^Groups: paint/, 'the undo step is the stroke');
    assert.equal(app.history.canUndo, false, 'and nothing else: the selection is no undo step');
    assert.deepEqual([tl.scene, app.doc.range], [1, { t0: 10000, t1: 20000 }], 'an undo leaves the selection');
    // painted again in B: nothing changes, no toast
    paintAt(12000);
    toasts.length = 0; paintAt(12000);
    assert.equal(toasts.filter((m) => /now tracks/.test(m)).length, 0);
    // a region in A selected, paint in C
    app.doc.acts = [{ id: 'r1', kind: 'act', t0: 2000, t1: 6000, layer: 0, tags: ['anal'] }, { id: 'r2', kind: 'act', t0: 21000, t1: 25000, layer: 0, tags: ['oral'] }];
    tl.act = 'r1'; tl.scene = -1; tl.shots = []; app.doc.range = { t0: 2000, t1: 6000 };
    paintAt(22000);
    assert.equal(tl.act, null, 'the region selection went');
    assert.deepEqual([tl.scene, app.doc.range], [2, { t0: 20000, t1: 30000 }]);
    // a region in C selected, painted inside it: the region stays the target
    tl.act = 'r2'; tl.scene = -1; tl.shots = []; app.doc.range = { t0: 21000, t1: 25000 };
    paintAt(22500);
    assert.deepEqual([tl.act, tl.scene, app.doc.range], ['r2', -1, { t0: 21000, t1: 25000 }]);
    // a stale I-O range in A, nothing selected
    tl.act = null; app.doc.range = { t0: 1000, t1: 5000 };
    paintAt(15000);
    assert.deepEqual([tl.scene, app.doc.range], [1, { t0: 10000, t1: 20000 }]);
  } finally { await t.server.close(); }
});

test('Tab over the timeline with hover scrub: the frame shown is taken, the pointer asked onto the picture, hover scrub held while open', async () => {
  const t = await tool();
  try {
    const { app, G } = t, p = app.player;
    app.settings.set('lanes.hoverScrub', true);
    // the mock's plain clock player (the video player's own frame commit, seekFrame(frame), is the window check's: paint-target-check)
    p.seek(14000);
    p.scrubTime = 14000 + (p.frameMs || 33) * 0.6;   // the pointer over a lane
    G.toggle(undefined, { key: true });
    assert.equal(p.timeMs, 14000, 'the frame shown is the one painted on');
    assert.equal(p.scrubTime, null, 'the hover is committed');
    assert.equal(G.tabTo, 1, 'the pointer is asked onto the picture');
    assert.equal(p.hoverHold, true, 'hover scrub moves nothing while the tool is open');
    G.toggle(undefined, { key: true });
    assert.equal(p.hoverHold, false);
    // the menu / a click (not the key), or the pointer not over the timeline: as before
    p.scrubTime = 14100; G.toggle(true); G.toggle(false);
    p.scrubTime = null; G.toggle(undefined, { key: true }); G.toggle(false);
    assert.equal(G.tabTo, 1);
    // the setting off: the frame is still taken, the pointer stays
    app.settings.set('tracking.groups.tabPointer', false);
    p.scrubTime = 14100; G.toggle(undefined, { key: true });
    assert.equal(G.tabTo, 1);
    assert.equal(p.scrubTime, null, 'the hovered frame was committed');
  } finally { await t.server.close(); }
});
