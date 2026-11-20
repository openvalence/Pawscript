// paw-3cbm: F flips the scene of the run that PLAYS at the playhead (its run range), whatever run is selected; with nothing
// selected (a reopened project) F still works; where no run plays it says so.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeRun } from '../src/lib/runs.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
});
after(() => server?.close());

const run = (n, t0, t1) => makeRun({ n, tracker: { id: 'lk_box', name: 'Optical flow' }, params: {}, range: { start: t0, end: t1 }, roi: null, frames: null, runs: [],
  result: { samples: [[t0, 0.2], [t1 - 1, 0.8]], points: [{ at: t0, pos: 10 }, { at: t1 - 100, pos: 90 }], scenes: [{ start_ms: t0, end_ms: t1, sign: 1 }] } });

test('F flips the run playing at the playhead, not the selected one; works with nothing selected; says so where no run plays', async () => {
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), axes: { stroke: [] }, scenes: [{ start_ms: 0, end_ms: 7000 }], runRanges: [{ id: 'a', run: 'run4', t0: 0, t1: 2467, layer: 0 }, { id: 'b', run: 'run6', t0: 2467, t1: 4500, layer: 0 }] }, keys: false, backend: M.mockBackend() });
  const toasts = []; app.toast = (m) => toasts.push(m);
  const tr = T.trackingFor(app);
  const r4 = run(4, 0, 7000), r6 = run(6, 1500, 4500);
  tr.runs = [r4, r6]; app.doc.ghosts = [tr.ghostOf(r4), tr.ghostOf(r6)];
  tr.select('run6');                                    // the newest run is selected
  await app.player.seek(2233);
  tr.flipAtPlayhead();
  assert.deepEqual([tr.run('run4').flips, tr.run('run6').flips], [[0], []], 'run #4 plays at 2.233 s: its scene flips');
  tr.select('');                                        // a reopened project: nothing selected
  tr.flipAtPlayhead();
  assert.deepEqual(tr.run('run4').flips, [], 'flipped back with nothing selected');
  await app.player.seek(6000);                          // no range there
  const n = toasts.length;
  tr.flipAtPlayhead();
  assert.deepEqual([tr.run('run4').flips, tr.run('run6').flips], [[], []]);
  assert.match(toasts.slice(n).join(' '), /No run plays here/);
  tr.destroy();
});
