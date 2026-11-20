// paw-j3to: "Tile loop" stops where the loop's pictures stop showing its cycle (an owner clip, shot 65: 29 tiles ran
// 7.8 s past the repeated pictures, through an orgasm), never crosses a modifier or a spurt marker, offers to continue when the
// same cycle goes on at another phase, and a drag of the tiles' end goes where it is dragged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passMatch, fxStop, buildTiles } from '../src/features/timeline/loops.js';
import * as gen from '../src/lib/gen/index.js';

// a picture = 32 cells 0..1; the cycle's 8 pictures random; after pass 4 the same cycle ONE FRAME LATER and redrawn (a quarter of
// the cells +0.1); after frame 90 other pictures. 10 fps, the loop from frame 10.
const F = 8, F0 = 10, rnd = (k) => { let s = (k * 2654435761) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const cyc = Array.from({ length: F }, (_, p) => { const r = rnd(p + 1); return Float32Array.from({ length: 32 }, () => (r() < 0.5 ? 0 : 1)); });
const other = (f) => { const r = rnd(1000 + f); return Float32Array.from({ length: 32 }, () => r()); };
function pic(f) {
  if (f < F0 || f >= 90) return other(f);
  if (f < F0 + 5 * F) return cyc[(f - F0) % F];
  const p = cyc[(((f - F0 - 1) % F) + F) % F];
  return Float32Array.from(p, (x, i) => (i % 4 === 0 ? Math.min(1, x + 0.1) : x));
}
const dist = (a, b) => { const A = pic(a), B = pic(b); let s = 0; for (let i = 0; i < 32; i++) s += Math.abs(A[i] - B[i]); return (255 * s) / 32; };

test('passMatch: the exact passes match, the pass one frame late does not, and is found at shift +1; it continues there', () => {
  const m = passMatch(F0, F, 80, dist);
  assert.deepEqual([m.end, m.passes, m.shift, m.known], [5 * F, 4, 1, true]);
  const c = passMatch(F0, F, 80, dist, undefined, { k0: 5, s0: 1 });
  assert.equal(c.end, 80);   // the shifted passes to frame 90 (80 frames after the loop's start)
  assert.equal(passMatch(F0, F, 80, () => null).known, false);
});

test('fxStop: the first modifier boundary or spurt marker after the cycle', () => {
  assert.equal(fxStop([{ kind: 'spurt', t0: 3500, t1: 3500 }, { kind: 'knotting', t0: 500, t1: 7000 }], 1800), 3500);
  assert.equal(fxStop([{ kind: 'knotting', t0: 500, t1: 7000 }], 1800), 7000);
  assert.equal(fxStop([], 1800), Infinity);
});

test('buildTiles: a shifted continuation tiles the cycle on a grid shifted from its point on', () => {
  const script = [{ at: 1000, pos: 10 }, { at: 1400, pos: 90 }], loop = { id: 'l', t0: 1000, t1: 1800, shifted: { at: 5000, ms: 100 } };
  const r = buildTiles(script, loop, 9000, gen, { frameMs: 100 });
  const at = (t) => r.script.find((a) => a.at === t)?.pos;
  assert.equal(at(4200), 10); assert.equal(at(4600), 90);   // before the shift: on the loop's grid (1000 / 1400 + 4 x 800)
  assert.equal(at(5100), 10); assert.equal(at(5500), 90);   // after: 100 ms later (1100 + 5 x 800, 1500 + 5 x 800)
  assert.equal(at(5000 + 400), undefined);
});

test('app: Tile loop stops at the 5th pass, offers the shifted continuation, stops at a spurt marker, a drag overrides, a re-tile stays matched', async () => {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js');
    const A = await server.ssrLoadModule('/src/features/timeline/loop-actions.js');
    const S = (f0, f1) => ({ start_ms: f0 * 100, end_ms: f1 * 100 });
    const doc = { ...M.sampleDoc({ minutes: 1 }), media: { path: 'v.mp4', durationMs: 20000, fps: 10 }, scenes: [S(0, 100), S(100, 200)], fx: [], ghosts: [],
      axes: { stroke: [{ at: 1000, pos: 10 }, { at: 1400, pos: 90 }] }, activeAxis: 'stroke', loops: [{ id: 'l', t0: 1000, t1: 1800 }] };
    const app = M.createMockApp({ doc, keys: false });
    app.player.frameMs = 100;
    Object.defineProperty(app, 'tracking', { value: { printAt: async (ms) => ({ w: 32, h: 1, d: pic(Math.floor(ms / 100)) }) }, configurable: true });
    const loop = () => app.doc.loops.find((l) => l.id === 'l');
    await A.tileLoop(app, 'l');
    assert.equal(loop().tiledTo, 5000, 'tiles stop where the pictures stop (5 passes)');
    assert.equal(loop().cont?.shift, 1, 'the shifted continuation is offered');
    await A.continueShifted(app, 'l');
    assert.equal(loop().tiledTo, 9000, 'continued over the shifted passes, not past them');
    assert.deepEqual(loop().shifted, { at: 5000, ms: 100 });
    // a re-tile (the cycle edited) keeps that extent; with a neighbouring loop deleted it does not run to the shot's end
    A.removeTiles(app, 'l');
    app.doc.loops = [...app.doc.loops, { id: 'n', t0: 9400, t1: 9800 }];
    await A.tileLoop(app, 'l');
    A.deleteLoop(app, 'n');
    await A.retileLoop(app, 'l');
    assert.equal(loop().tiledTo, 5000, 'after deleting the neighbour: still only the matching passes');
    // a spurt marker inside stops the tiles there
    A.removeTiles(app, 'l');
    app.doc.fx = [{ id: 's', kind: 'spurt', t0: 3500, t1: 3500, params: {} }];
    await A.tileLoop(app, 'l');
    assert.equal(loop().tiledTo, 3500, 'stops at the spurt marker');
    // by hand: where it is dragged, past the marker and the pictures
    A.setTiledEnd(app, 'l', 9600);
    assert.equal(loop().tiledTo, 9600);
    assert.equal(loop().tiledHand, true);
    await A.retileLoop(app, 'l');
    assert.equal(loop().tiledTo, 9600, 'a hand-dragged end is kept on a re-tile');
  } finally { await server.close(); }
});
