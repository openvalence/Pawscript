// [review] the Clean size estimate is each app's own (one tab's estimate never shows on another tab's File menu).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, C;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  C = await server.ssrLoadModule('/src/app/clean.svelte.js');
});
after(() => server?.close());

const appWith = (bytes) => ({ doc: { media: { path: `C:/v/${bytes}.mp4` } }, player: {}, settings: { get: () => [] }, project: { path: null },
  backend: { mediaCacheOf: async () => [{ kind: 'scrub', bytes }] } });

test('two tabs, two estimates', async () => {
  const a = appWith(100), b = appWith(5000);
  C.refreshEstimate(a, true); C.refreshEstimate(b, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(C.estimateOf(a).items, [{ kind: 'scrub', bytes: 100 }]);
  assert.deepEqual(C.estimateOf(b).items, [{ kind: 'scrub', bytes: 5000 }]);
  assert.equal(C.estimateOf(null).items, null);
});
