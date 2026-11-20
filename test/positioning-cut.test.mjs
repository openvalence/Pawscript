// paw-d9pz (owner feedback: "I want it to stay at 100% not go down then back up"): a positioning range that crosses a cut is
// split per shot (regions.js withPositioning); its ease is ONE move over the whole range, not one per piece from the same
// start (a climb, a drop at the cut, a climb again). The store is a .svelte.js module, loaded through vite's SSR transform.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
});
after(() => server?.close());

// the reported shape: strokes ending at 63 before the range, strokes from 99 after it; the range 17733..20433 crosses the cut at 18100
const pts = [];
for (let t = 14000; t < 17700; t += 400) pts.push({ at: t, pos: (t / 400) % 2 < 1 ? 63 : 30 });
pts.push({ at: 17700, pos: 63 });
for (let t = 20500; t < 24000; t += 400) pts.push({ at: t, pos: ((t - 20500) / 400) % 2 < 1 ? 99 : 60 });
const ACTS = [{ id: 'a1', kind: 'act', t0: 0, t1: 30000, layer: 0, tags: ['anal', 'penetration'] }, { id: 'p1', kind: 'positioning', t0: 17733, t1: 20433, layer: 0, tags: [] }];

test('a positioning range across a cut eases once: no drop at the cut', () => {
  const app = M.createMockApp({ doc: { ...M.sampleDoc({ minutes: 1 }), axes: { stroke: pts }, activeAxis: 'stroke', ghosts: [], scenes: [{ start_ms: 0, end_ms: 18100 }, { start_ms: 18100, end_ms: 30000 }], acts: ACTS }, keys: false, backend: M.mockBackend() });
  const tr = T.trackingFor(app);
  const ease = tr.bridges.filter((b) => b.mode === 'positioning');
  assert.deepEqual(ease.map((b) => [b.t0, b.t1]), [[17733, 18100], [18100, 20433]], 'one piece per shot');
  const all = ease.flatMap((b) => b.script);
  assert.ok(all.every((p, k) => k === 0 || (p.at > all[k - 1].at && p.pos >= all[k - 1].pos)), `one rising move: ${JSON.stringify(all)}`);
  assert.ok(ease[0].script.at(-1).pos > 63 && ease[0].script.at(-1).pos < 99, 'the first piece stops partway up');
  assert.ok(all[0].pos <= 66 && all.at(-1).pos >= 96, 'from the level before to the level after');
  const live = (tr.liveOf('stroke')?.script || []).filter((p) => p.at > 17733 && p.at < 20433);
  assert.ok(live.every((p, k) => k === 0 || p.pos >= live[k - 1].pos), `the live script rises without a dip: ${JSON.stringify(live)}`);
});
