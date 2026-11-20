// paw-w3u9: Ctrl+L on the first tile of a fresh clip read its frames for ~1.5 s with nothing on screen. loop-actions.js busyHint:
// a toast that stays while the work runs, only when it takes longer than a moment, gone when it ends (or throws).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, A;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  A = await server.ssrLoadModule('/src/features/timeline/loop-actions.js');
});
after(() => server?.close());

const fakeApp = () => { const log = []; return { log, toast: (msg, kind, o) => { log.push(['toast', msg, o?.timeout]); return 7; }, dismiss: (id) => log.push(['dismiss', id]) }; };
const wait = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

test('a slow read shows a staying hint and removes it; a quick one shows nothing; a failure removes it too', async () => {
  const slow = fakeApp();
  assert.equal(await A.busyHint(slow, 'Reading…', () => wait(120, 'done'), 30), 'done');
  assert.deepEqual(slow.log, [['toast', 'Reading…', 0], ['dismiss', 7]]);
  const quick = fakeApp();
  assert.equal(await A.busyHint(quick, 'Reading…', () => wait(5, 1), 80), 1);
  await wait(100);
  assert.deepEqual(quick.log, [], 'no flash for a quick answer');
  const bad = fakeApp();
  await assert.rejects(A.busyHint(bad, 'Reading…', async () => { await wait(60); throw new Error('x'); }, 20));
  assert.deepEqual(bad.log.map((x) => x[0]), ['toast', 'dismiss']);
});
