// paw-24b8 (the owner: "when adjusting the positioning ease, update fusion in realtime"): a positioning range dragged on the
// Actions strip (its draft, tl.draft.acts) moves the ease and the runs' mask on every step; nothing is written until the
// release, which is one undo step; Esc (the draft dropped) gives back exactly what was there. The store is a .svelte.js
// module, loaded through vite's SSR transform.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resizeRegion } from '../src/features/timeline/regions.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T, ST, A;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  ST = await server.ssrLoadModule('/src/features/timeline/state.svelte.js');
  A = await server.ssrLoadModule('/src/features/timeline/acts-edit.js');
});
after(() => server?.close());

// one 15 s shot, 1 Hz strokes 0-2 s at a low level and 9-15 s at a high one (nothing baked between); a positioning range over 3-6 s
const pts = [];
for (let t = 100; t < 2000; t += 500) pts.push({ at: t, pos: (t / 500) % 2 < 1 ? 10 : 30 });
for (let t = 9100; t < 15000; t += 500) pts.push({ at: t, pos: (t / 500) % 2 < 1 ? 90 : 70 });
const ACTS = [{ id: 'a1', kind: 'act', t0: 0, t1: 15000, layer: 0, tags: ['anal', 'penetration'] }, { id: 'p1', kind: 'positioning', t0: 3000, t1: 6000, layer: 0, tags: [] }];

test('a positioning range\'s drag: the ease follows every step from the draft, Esc restores it, the release is one undo step', () => {
  const app = M.createMockApp({ doc: { ...M.sampleDoc({ minutes: 1 }), axes: { stroke: pts }, activeAxis: 'stroke', ghosts: [], scenes: [{ start_ms: 0, end_ms: 15000 }], acts: ACTS }, keys: false, backend: M.mockBackend() });
  const tr = T.trackingFor(app), tl = ST.tlFor(app);
  const ease = () => tr.bridges.filter((b) => b.mode === 'positioning').map((b) => [b.t0, b.t1, b.script]);
  const live = (a, b) => (tr.liveOf('stroke')?.script || []).filter((p) => p.at > a && p.at < b).map((p) => [p.at, p.pos]);
  const e0 = ease(), l0 = live(2000, 9000), n0 = app._history.entries.length;
  assert.deepEqual(e0.map(([a, b]) => [a, b]), [[3000, 6000]], 'the committed range eases');
  // the end edge dragged to 7 s, 8 s (no release): each step moves the ease and the live script; nothing written
  const seen = [];
  for (const t1 of [7000, 8000]) {
    tl.draft = { ...tl.draft, acts: resizeRegion(app.doc.acts, 'p1', 3000, t1) };
    tr.actsDrag();
    assert.deepEqual(ease().map(([a, b]) => [a, b]), [[3000, t1]], `step to ${t1}: the ease spans the dragged range`);
    assert.notDeepEqual(live(2000, 9000), seen.at(-1) ?? l0, `step to ${t1}: the live points changed`);
    assert.ok(tr.fuseLive, 'the runs compose for the trace between rests');
    seen.push(live(2000, 9000));
  }
  assert.equal(app._history.entries.length, n0, 'no history while dragging');
  assert.deepEqual(app.doc.acts.find((r) => r.id === 'p1').t1, 6000, 'nothing written while dragging');
  // Esc: the draft dropped -> exactly as before
  tl.draft = {};
  tr.actsDrag(true);
  assert.equal(tr.fuseLive, null);
  assert.deepEqual(ease(), e0, 'Esc: the ease as it was');
  assert.deepEqual(live(2000, 9000), l0, 'Esc: the live script as it was');
  // a drag that moves only the action (no positioning change): the runs stay exact
  tl.draft = { acts: resizeRegion(app.doc.acts, 'a1', 0, 14000) };
  tr.actsDrag();
  assert.equal(tr.fuseLive, null, 'an ordinary action drag leaves the runs alone');
  tl.draft = {};
  // the drag again to 8 s, released (ScenesLane actUp: draft cleared, then commitActs): one undo step, the ease kept
  const res = resizeRegion(app.doc.acts, 'p1', 3000, 8000);
  tl.draft = { acts: res };
  const dragged = ease();
  tl.draft = {};
  tr.actsDrag(true);
  A.commitActs(app, 'Resize action region', res);
  assert.equal(app._history.entries.length, n0 + 1, 'the release: one undo step');
  assert.deepEqual(ease(), dragged, 'the release keeps what the drag showed');
  assert.deepEqual(live(2000, 9000), seen.at(-1));
  app.undo();
  assert.deepEqual(ease(), e0, 'undo: back as before');
});
