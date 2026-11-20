// paw-bsyo: peek-scrub while painting (hold Space + move the mouse; Tab opens / closes the tool, nothing else): the frame mapping is pure; the store scrubs inside the take, paints nothing, and releasing
// seeks back to the exact seed frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { peekFrames, peekAt, PEEK_PX, PEEK_FINE } from '../src/features/tracking/groups.js';

test('peekTime: whole frames from the mouse move, Shift finer, clamped to the take', () => {
  const f = 1000 / 30;
  const at = (dx, lo = 0, hi = 9999, fine = false) => peekAt(2000, peekFrames(dx, fine), f, lo, hi);
  assert.deepEqual(at(0), { k: 0, ms: 2000 }, 'no drag: the seed frame');
  assert.deepEqual(at(PEEK_PX * 3), { k: 3, ms: Math.round(2000 + 3 * f) }, '3 frames right');
  assert.deepEqual(at(-PEEK_PX * 3), { k: -3, ms: Math.round(2000 - 3 * f) }, '3 frames left');
  assert.equal(at(PEEK_PX * PEEK_FINE * 2, 0, 9999, true).k, 2, 'Shift: PEEK_FINE x more px per frame');
  assert.equal(at(PEEK_PX * 0.4).k, 0, 'a sub-frame wobble stays on the frame');
  assert.ok(at(1e6, 0, 5000).ms <= 5000 && at(1e6, 0, 5000).ms > 5000 - f, 'clamped to the take end');
  assert.ok(at(-1e6, 1500, 5000).ms >= 1500 && at(-1e6, 1500, 5000).ms < 1500 + f, 'clamped to the take start');
  assert.equal(peekAt(2000, 90, f, 0, 9999).ms, 5000, 'no drift: from the seed, not the last stop');
});

test('store: peeking scrubs inside the take, nothing paints or splits, release returns to the seed frame', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js'), GS = await server.ssrLoadModule('/src/features/tracking/groups.svelte.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    const doc = { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 10000 }, { start_ms: 10000, end_ms: 20000 }], ghosts: [] };
    const app = M.createMockApp({ doc, keys: false, backend: M.mockBackend() });
    app.tracking = T.trackingFor(app); app.mode = 'track';
    const at = (t) => { app.player.seek?.(t); if (app.player.timeMs !== t) app.player.timeMs = t; };
    at(4000);
    const G = GS.groupsFor(app);
    G.toggle(true);
    assert.equal(G.peekStart(), false, 'no groups yet: nothing to peek against');
    assert.ok(G.begin(0.5, 0.5, false)); G.move(0.55, 0.5); G.end();
    const seed = G.t, scenes = app.doc.scenes, n0 = app._history.entries.length, f = app.player.frameMs || 33;
    assert.ok(G.peekStart());
    G.peekDrag(G.peek.k, PEEK_PX * 5);
    assert.equal(app.player.timeMs, Math.round(seed + 5 * f), 'the video moved 5 frames');
    assert.equal(G.begin(0.2, 0.2, false), false, 'no stroke lands while peeking');
    G.peekStep(-1); assert.equal(app.player.timeMs, Math.round(seed + 4 * f), 'Left: one frame');
    G.peekDrag(0, 1e7); assert.ok(app.player.timeMs <= 9999 && app.player.timeMs > 9999 - f, 'clamped to the take (the next take is not shown)');
    G.peekDrag(0, -1e7); assert.ok(app.player.timeMs >= 0 && app.player.timeMs < f);
    assert.equal(app.doc.scenes, scenes, 'no take split'); assert.equal(app._history.entries.length, n0, 'no undo step');
    assert.ok(G.peekEnd());
    assert.equal(app.player.timeMs, seed, 'released: the exact seed frame');
    assert.equal(G.peek, null);
    assert.ok(G.begin(0.2, 0.2, false), 'painting continues'); G.end();
  } finally { await server.close(); }
});

test('the peek key is Space by physical key (e.code), never Tab: Tab has one purpose (tracking.groups)', () => {
  const src = readFileSync(new URL('../src/features/tracking/GroupsOverlay.svelte', import.meta.url), 'utf8');
  assert.match(src, /const PEEK_CODE = 'Space'/);
  const pk = src.slice(src.indexOf('const pk = (e) =>'), src.indexOf('const pb = () =>'));
  assert.ok(pk.length > 100 && /e\.code === PEEK_CODE/.test(pk), 'the peek listener matches e.code');
  assert.doesNotMatch(pk, /'Tab'/, 'the peek listener never looks at Tab');
});
