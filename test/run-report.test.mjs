// paw-kv4y: a finished run's toast and panel line gave the sidecar's primary points ("0 points" for a groups run) while
// the run plays its composed stroke (Smart stroke's fused one) with points. They report the script points it makes now.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runSummary } from '../src/lib/runs.js';
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

test('runSummary: the script points, the groups tracked, and an empty run says so', () => {
  assert.equal(runSummary({ points: { at: [1, 2, 3] }, groupSeeds: [{ name: 'shaft' }, { name: 'hips' }, { name: 'shaft' }] }), '3 script points from 2 tracked groups');
  assert.equal(runSummary({ points: { at: [] } }), 'no script points');
});

test('the toast and the panel count the composed (fused) points, not the sidecar\'s primary ones', async () => {
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 20000, tags: ['handjob'] }], ghosts: [] }, keys: false }), tr = T.trackingFor(app);
  app.loadBlocks({});
  tr.openVideo(app.doc.media?.path || null);
  const toasts = [];
  app.toast = (m) => toasts.push(String(m));
  // the sidecar's primary has no points at all (a groups run); its painted parts fuse into a stroke
  tr.job = async (label) => (label === 'track' ? { result: { samples: TS.map((t) => [t, NaN]), points: [], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: CH, notes: [] } } : { cancelled: true });
  const { run } = await tr.runTrack({ id: 'tapnext_points', name: 'TAPNext++', params: [] }, { start: 0, end: 20000 }, { axis: 'auto' }, null, []);
  const n = tr.ghost(run.id).script.length;
  assert.ok(n > 2, `the fused stroke has points (${n})`);
  const t = toasts.find((m) => m.includes('TAPNext++'));
  assert.ok(t?.includes(`${n} script points`), t);
});
