// paw-d9pz (owner feedback: "tiling continues a scene through an orgasm"): an automatic loop's tiles stop at its detected
// end (loop.auto.end), at a Detect cumshots proposal and at a shot the tagger saw an orgasm in; a drag of the tiles' end still
// goes where it is dragged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const CUM = { tags: [{ tag: 'cum', score: 0.9 }] };

test('app: an automatic loop tiles to its detected end, stops at an orgasm, a drag goes past', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js');
    const A = await server.ssrLoadModule('/src/features/timeline/loop-actions.js');
    const S = (f0, f1, x = {}) => ({ start_ms: f0 * 100, end_ms: f1 * 100, ...x });
    const doc = { ...M.sampleDoc({ minutes: 1 }), media: { path: 'v.mp4', durationMs: 20000, fps: 10 }, scenes: [S(0, 150), S(150, 200)], fx: [], ghosts: [],
      axes: { stroke: [{ at: 1000, pos: 10 }, { at: 1400, pos: 90 }] }, activeAxis: 'stroke',
      loops: [{ id: 'l', t0: 1000, t1: 1800, auto: { key: 'k', t0: 1000, t1: 1800, end: 5000, n: 5 } }] };
    const app = M.createMockApp({ doc, keys: false });
    app.player.frameMs = 100;
    // every frame shows the cycle: only the stops end the tiles
    Object.defineProperty(app, 'tracking', { value: { printAt: async () => ({ w: 4, h: 1, d: Float32Array.from([0, 1, 0, 1]) }) }, configurable: true });
    const loop = () => app.doc.loops.find((l) => l.id === 'l');
    await A.tileLoop(app, 'l');
    assert.equal(loop().tiledTo, 5000, 'stops at the detected end, not the shot end (15 s)');
    await A.retileLoop(app, 'l');
    assert.equal(loop().tiledTo, 5000, 'a re-tile too');
    A.setTiledEnd(app, 'l', 9800);
    assert.equal(loop().tiledTo, 9800, 'a drag goes past the detected end');
    await A.retileLoop(app, 'l');
    assert.equal(loop().tiledTo, 9800, 'a hand-dragged end is kept on a re-tile');
    // an owner loop (no auto): a cumshot proposal stops it
    A.removeTiles(app, 'l');
    app.doc.loops = [{ id: 'l', t0: 1000, t1: 1800 }];
    app.doc.scenes = [S(0, 150, { cum: [{ t: 4200, score: 0.3 }] }), S(150, 200)];
    await A.tileLoop(app, 'l');
    assert.equal(loop().tiledTo, 4200, 'stops at the cumshot proposal');
    // the tagger saw an orgasm in the next shot: the tiles stop at its cut
    A.removeTiles(app, 'l');
    app.doc.scenes = [S(0, 80), S(80, 150, { describe: CUM }), S(150, 200)];
    assert.equal(A.orgasmStop(app.doc.scenes, 1800, 1000), 8000);
    assert.equal(A.orgasmStop([S(0, 80, { describe: CUM }), S(80, 150, { describe: CUM })], 1800, 1000), Infinity, 'not when the cycle\'s own shot shows one');
  } finally { await server.close(); }
});
