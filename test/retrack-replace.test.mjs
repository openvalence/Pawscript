// paw-l3ec: each re-track of the same shot added a run and a ghost (#1 … #5). The panel's Track (replace) over an earlier run
// of the same tracker family replaces it, carrying its shot settings (paw-83sq) and discarding it the normal way; Track as a
// new run (replace off) keeps both; a run of another tracker, or one reaching past the new span, stays.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { replacedBy } from '../src/lib/runs.js';
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
const TAP = { id: 'tapnext_points', name: 'TAPNext++', params: [] }, CO = { id: 'cotracker_points', name: 'CoTracker3', params: [] };

function open() {
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 20000, tags: ['handjob'] }], ghosts: [] }, keys: false }), tr = T.trackingFor(app);
  app.loadBlocks({});
  tr.openVideo(app.doc.media?.path || null);
  tr.job = async (label) => (label === 'track' ? { result: { samples: TS.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: 19900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: CH, notes: [] } } : { cancelled: true });
  const toasts = [];
  app.toast = (m) => toasts.push(String(m));
  return { app, tr, toasts };
}
const own = (a) => a.tr.runs.filter((r) => !r.tag).map((r) => r.id);
const track = async (a, { t = TAP, replace = true, range = { start: 0, end: 20000 } } = {}) => (await a.tr.runTrack(t, range, { axis: 'auto' }, null, [], { replace })).run.id;

test('replacedBy: same family inside the span only', () => {
  const r = (id, tracker, s, e, x = {}) => ({ id, tracker, range: { start: s, end: e }, params: {}, ...x });
  const runs = [r('a', 'tap', 0, 5000), r('b', 'tap', 0, 9000), r('c', 'co', 0, 5000), r('d', 'tap', 0, 5000, { tag: 'camera' }), r('e', 'tap', 0, 5000, { params: { box_seed: 'grid' } })];
  assert.deepEqual(replacedBy(r('n', 'tap', 0, 5000), runs, 33), ['a']);
});

test('Track again replaces the earlier run and keeps its settings; Track as a new run keeps both', async () => {
  const a = open(), id1 = await track(a);
  a.tr.setSmart(0, false);
  const id2 = await track(a);
  assert.deepEqual(own(a), [id2], 'one run');
  assert.deepEqual(a.app.doc.ghosts.filter((g) => g.source?.kind === 'tracker' && !g.source.tag).map((g) => g.id), [id2], 'one ghost');
  assert.notEqual(id2, id1);
  assert.equal(a.tr.shotDerive(0, id2)?.smart, false, 'the replaced run\'s Smart stroke off carried over');
  assert.ok(a.tr.links.every((l) => l.run !== id1), 'its links went with it');
  assert.doesNotMatch(a.app.doc.ghosts.find((g) => g.id === id2).name, /#2/, 'the lane legend does not count the replaced run');
  assert.match(a.toasts.at(-1), /replaces the earlier run/);
  const id3 = await track(a, { replace: false });
  assert.deepEqual(own(a), [id2, id3], 'Track as a new run: beside it');
  const id4 = await track(a, { t: CO });
  assert.deepEqual(own(a), [id2, id3, id4], 'another tracker: beside');
  await track(a, { range: { start: 0, end: 10000 } });
  assert.equal(own(a).length, 4, 'a shorter span replaces nothing that reaches past it');
});
