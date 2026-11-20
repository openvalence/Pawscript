// [review] a section restore must not leave two run ranges with one id (RunRangeStrip keys its #each by r.id)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
let server, H;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  H = await server.ssrLoadModule('/src/app/history-diff.js');
});
after(() => server?.close());
test('restoreSection: a range that grew past the section and was smaller inside it then: ids stay unique', () => {
  const now = { axes: {}, runRanges: [{ id: 'X', run: 'r1', t0: 0, t1: 20000, layer: 0 }] };
  const then = { axes: {}, runRanges: [{ id: 'X', run: 'r1', t0: 6000, t1: 7000, layer: 0 }] };
  const out = H.restoreSection(now, then, { t0: 5000, t1: 8000 });
  const ids = out.runRanges.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, JSON.stringify(out.runRanges));
  // paw-rhrt: every piece kept, as normalised ranges (sorted, no overlap)
  assert.deepEqual(out.runRanges.map((r) => [r.t0, r.t1]), [[0, 5000], [6000, 7000], [8000, 20000]]);
});
