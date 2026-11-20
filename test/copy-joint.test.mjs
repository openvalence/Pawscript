// paw-trxk: Copy from... ranks the linked shot first and lines the copied groups up as ONE set (copy-from.js tierOf /
// bestPairs, regionOf / regionNcc / jointFit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestPairs, tierOf, regionOf, regionNcc, jointFit, alignRegion, IDENTITY, moveGroups } from '../src/features/tracking/copy-from.js';
import { maskSize, newMask, fitPoly, encodeMask, maskOf } from '../src/features/tracking/groups.js';

test('ranking: a source in a linked shot first, then painted frames, then runs\' frames, whatever the distances', () => {
  const targets = new Map([[0, 'a'], [1, 'b']]);
  const D = { link: 0.3, paint: 0.1, run: 0.01 };
  const src = [
    { key: 'r', kind: 'tracked', src: 's9', print: 1, want: 'run' },
    { key: 'p', kind: 'painted', src: 's5', print: 1, want: 'paint' },
    { key: 'l', kind: 'painted', src: 's3', print: 1, crop: { scale: 1.4, box: { x: 0.1, y: 0.1, w: 0.7 }, wideIsSrc: true }, want: 'link' },
  ];
  const r = bestPairs(src, targets, 0, { dist: (c) => D[c.want] });
  assert.deepEqual(r.map((c) => c.key), ['l', 'p', 'r']);
  assert.deepEqual(src.map(tierOf), [2, 1, 0]);
  // one take: its painted frame always beats its runs' frames; in a linked take (both re-framed) unless a run's frame is clearly closer
  assert.equal(bestPairs([{ key: 'p', kind: 'painted', src: 's3', print: 1 }, { key: 't', kind: 'tracked', src: 's3', print: 1 }], targets, 0, { dist: (c) => (c.key === 'p' ? 0.3 : 0.01) })[0].key, 'p');
  const crop = { scale: 1.4 }, take = [{ key: 'p', kind: 'painted', src: 's3', print: 1, crop }, { key: 't', kind: 'tracked', src: 's3', print: 1, crop }];
  assert.equal(bestPairs(take, targets, 0, { dist: (c) => (c.key === 'p' ? 0.105 : 0.1) })[0].key, 'p');
  assert.equal(bestPairs(take, targets, 0, { dist: (c) => (c.key === 'p' ? 0.2 : 0.1) })[0].key, 't');
});

// a textured ground with two bright blobs (the characters); the target is the same picture with the blobs (and the
// ground) moved by (dx, dy) and zoomed by s about the centre
const W = 128, H = 72;
const tex = (x, y) => 0.35 + 0.15 * Math.sin(17 * x + 3 * Math.sin(9 * y)) * Math.cos(13 * y);
const blobs = [[0.4, 0.5, 0.08, 0.16], [0.62, 0.55, 0.06, 0.12]];
function picture(move = { s: 1, dx: 0, dy: 0 }) {
  const d = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const X = (i + 0.5) / W, Y = (j + 0.5) / H, x = (X - 0.5 - move.dx) / move.s + 0.5, y = (Y - 0.5 - move.dy) / move.s + 0.5;   // the source point shown here
    let v = tex(x, y);
    for (const [bx, by, rx, ry] of blobs) { const q = ((x - bx) / rx) ** 2 + ((y - by) / ry) ** 2; if (q < 1) v = q > 0.7 ? 0.05 : 0.85 + 0.1 * Math.sin(40 * x); }
    d[j * W + i] = v;
  }
  return { w: W, h: H, d };
}
const SIZE = maskSize(16 / 9);
const groupOf = (name, [bx, by, rx, ry]) => {
  const m = newMask(SIZE);
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) if ((((i + 0.5) / m.w - bx) / rx) ** 2 + (((j + 0.5) / m.h - by) / ry) ** 2 < 1) m.a[j * m.w + i] = 1;
  return { name, poly: fitPoly(m).poly, mask: encodeMask(m), t_ms: 0, source: 'user' };
};

test('regionOf: the union of the groups, grown; regionNcc: 1 for the same picture', () => {
  const gs = blobs.map((b, k) => groupOf('g' + k, b)), mf = (g) => maskOf(g, SIZE);
  const R0 = regionOf(gs, W, H, mf, 0), R = regionOf(gs, W, H, mf);
  assert.ok(R0.n > 0.05 * W * H && R0.n < 0.15 * W * H, 'the two blobs: ' + R0.n);
  assert.ok(R.n > R0.n, 'grown');
  assert.ok(R[Math.floor(0.5 * H) * W + Math.floor(0.4 * W)] === 1 && R[2 * W + 2] === 0);
  const P = picture();
  assert.ok(regionNcc(P, P, R, { s: 1, dx: 0, dy: 0 }) > 0.999);
});

test('jointFit: ONE move for the whole set recovers a shift + zoom the start missed, and every group moves by it', () => {
  const gs = blobs.map((b, k) => groupOf('g' + k, b)), mf = (g) => maskOf(g, SIZE), S = picture();
  const truth = { s: 1.08, dx: 0.04, dy: -0.03 }, T = picture(truth), R = regionOf(gs, W, H, mf);
  const start = { s: 1, dx: 0.01, dy: 0 };
  const xf = jointFit(S, T, R, start);
  assert.ok(xf.joint, 'refined');
  assert.ok(Math.abs(xf.dx - truth.dx) < 0.012 && Math.abs(xf.dy - truth.dy) < 0.012 && Math.abs(xf.s - truth.s) < 0.03, JSON.stringify(xf));
  assert.ok(xf.ncc > xf.from + 0.05);
  // the groups land where the blobs are on the target: one move, the same for all of them
  const moved = moveGroups(gs, xf, 0, mf);
  for (const [k, [bx, by]] of blobs.entries()) {
    const m = maskOf(moved[k], SIZE);
    let sx = 0, sy = 0, n = 0;
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) if (m.a[j * m.w + i] >= 0.5) { sx += (i + 0.5) / m.w; sy += (j + 0.5) / m.h; n++; }
    const want = [(bx - 0.5) * truth.s + 0.5 + truth.dx, (by - 0.5) * truth.s + 0.5 + truth.dy];
    assert.ok(Math.hypot(sx / n - want[0], sy / n - want[1]) < 0.015, `g${k} at ${(sx / n).toFixed(3)},${(sy / n).toFixed(3)} want ${want.map((v) => v.toFixed(3))}`);
  }
  // nothing better to find: the move is kept as it came (no drift)
  assert.equal(jointFit(S, S, R, { s: 1, dx: 0, dy: 0 }).joint, undefined);
  assert.equal(jointFit(S, T, regionOf([], W, H, mf), start), start, 'no groups: as it came');
});

// paw-vnlj: the global search -- a move far past jointFit's reach, turned as well (owner: "scale, translate or rotate")
function turned(m) {
  const d = new Float32Array(W * H), A = W / H, c = Math.cos(-m.rot), q = Math.sin(-m.rot);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = ((i + 0.5) / W - 0.5 - m.dx) * A, v = (j + 0.5) / H - 0.5 - m.dy, su = (u * c - v * q) / m.s, sv = (u * q + v * c) / m.s;
    const x = su / A + 0.5, y = sv + 0.5;
    let val = tex(x, y);
    for (const [bx, by, rx, ry] of blobs) { const k = ((x - bx) / rx) ** 2 + ((y - by) / ry) ** 2; if (k < 1) val = k > 0.7 ? 0.05 : 0.85 + 0.1 * Math.sin(40 * x); }
    d[j * W + i] = val;
  }
  return { w: W, h: H, d };
}
test('alignRegion: finds a big shift + zoom + turn the local fit cannot reach, and the groups land on the blobs', () => {
  const gs = blobs.map((b, k) => groupOf('g' + k, b)), mf = (g) => maskOf(g, SIZE), S = picture(), R = regionOf(gs, W, H, mf);
  const truth = { s: 1.2, rot: 0.25, dx: 0.14, dy: -0.09 }, T = turned(truth);
  const t0 = performance.now(), xf = alignRegion(S, T, R), ms = performance.now() - t0;
  assert.ok(xf.joint && Math.abs(xf.dx - truth.dx) < 0.015 && Math.abs(xf.dy - truth.dy) < 0.015 && Math.abs(xf.s - truth.s) < 0.04 && Math.abs(xf.rot - truth.rot) < 0.03, JSON.stringify(xf));
  assert.ok(ms < 1500, `search took ${ms.toFixed(0)} ms`);
  const A = W / H, moved = moveGroups(gs, xf, 0, mf);
  for (const [k, [bx, by]] of blobs.entries()) {
    const m = maskOf(moved[k], SIZE);
    let sx = 0, sy = 0, n = 0;
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) if (m.a[j * m.w + i] >= 0.5) { sx += (i + 0.5) / m.w; sy += (j + 0.5) / m.h; n++; }
    const u = (bx - 0.5) * A, v = by - 0.5, c = Math.cos(truth.rot) * truth.s, q = Math.sin(truth.rot) * truth.s;
    const want = [(u * c - v * q) / A + 0.5 + truth.dx, u * q + v * c + 0.5 + truth.dy];
    assert.ok(Math.hypot(sx / n - want[0], sy / n - want[1]) < 0.02, `g${k} at ${(sx / n).toFixed(3)},${(sy / n).toFixed(3)} want ${want.map((x) => x.toFixed(3))}`);
  }
  assert.deepEqual(alignRegion(S, S, R), IDENTITY, 'the same picture stays put');
});
