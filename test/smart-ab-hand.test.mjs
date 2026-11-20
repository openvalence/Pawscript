// paw-89bd: the grey "Without Smart stroke" A/B ghost compares only on a shot the owner switched Smart stroke on by hand in
// this session (tracking.svelte.js smartABRun, read by #publishSmartAB), not on every new run arriving with it on (paw-lji3).
// Effects do not run under SSR: the gate the ghost reads is asserted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
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

test('a new run arrives with Smart stroke on and no A/B ghost; a switch on by hand brings it', async () => {
  const sc = CASES.find((c) => c.id === 'handjob').make();
  const CH = Object.fromEntries(Object.entries(sc.run.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
  const TS = CH.who_pair_proj.map(([t]) => t);
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 20000, tags: ['handjob'] }], ghosts: [] }, keys: false }), tr = T.trackingFor(app);
  app.loadBlocks({});
  tr.openVideo(app.doc.media?.path || null);
  tr.job = async (label) => (label === 'track' ? { result: { samples: TS.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: 19900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: CH, notes: [] } } : { cancelled: true });
  const id = (await tr.runTrack({ id: 'tapnext_points', name: 'TAPNext++', params: [] }, { start: 0, end: 20000 }, { axis: 'auto' }, null, [], { check: false })).run.id;
  assert.equal(tr.shotDerive(0, id)?.smart, true, 'arrived with Smart stroke on');
  assert.equal(tr.smartABRun(0), null, 'no comparison ghost for an arrival');
  tr.setSmart(0, false);
  assert.equal(tr.smartABRun(0), null);
  tr.setSmart(0, true);
  assert.equal(tr.smartABRun(0)?.id, id, 'switched on by hand: the ghost compares');
  tr.setSmart(0, false);
  assert.equal(tr.shotDerive(0, id)?.smart, false, 'off again (the ghost needs smart on as well)');
});
