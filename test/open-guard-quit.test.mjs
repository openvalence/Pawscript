// paw-wra0: a clean quit within STABLE_MS of a start-up reopen is not a crash: the "opening" mark goes with the close, so
// the next start reopens the document.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGuarded, wasOpening } from '../src/app/open-guard.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, W;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  W = await server.ssrLoadModule('/src/app/writing.svelte.js');
});
after(() => server?.close());

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('quitting 1 s after a start-up reopen clears its mark; a close held by unwritten work keeps it', async () => {
  const st = memStorage(), P = 'C:/clips/gen.pawproj';
  assert.equal(await openGuarded(st, P, async () => true, { stableMs: 60000 }), true);
  assert.equal(wasOpening(st, P), true, 'held for STABLE_MS');
  let all = false, closed = 0;
  const app = { settings: { storage: st }, backend: { windowCloseNow: async () => { closed++; } }, tabs: { apps: [], closeAll: async () => all } };
  await W.closeApp(app);   // a document could not be written: the app stays, nothing is cleared
  assert.equal(closed, 0);
  assert.equal(wasOpening(st, P), true);
  all = true;
  await W.closeApp(app);
  assert.equal(closed, 1);
  assert.equal(wasOpening(st, P), false, 'the next start reopens it');
});
