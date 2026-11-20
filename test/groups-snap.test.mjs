// paw-ywby / paw-2kdm: the Groups brush's edge snap on synthetic pictures. A painted blob becomes one smooth outline that
// follows a close clear edge, stays inside it, ignores far / absent edges, never collapses a thin shape, never touches the
// rest of the group, never paints into another group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newMask, cloneMask, stroke } from '../src/features/tracking/groups.js';
import { edgeMap, snapMask, marginPx, MARGIN_DEFAULT, insetOutline, signedDistance, SNAP_REACH } from '../src/features/tracking/snap.js';

const insideMargin = (r) => marginPx(MARGIN_DEFAULT / 100, (4 * r) / 3);   // the default paint margin of a disc of radius r (width 4r/3)
const MW = 160, MH = 120, S = 2;   // mask 160 x 120, picture 2x
const picture = (colour) => {
  const w = MW * S, h = MH * S, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = colour(x / S, y / S), i = 4 * (y * w + x); data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; }
  return edgeMap({ w, h, data });
};
const RED = [200, 80, 70], BLUE = [60, 70, 200];
const disc = (cx, cy, r) => (x, y) => (Math.hypot(x - cx, y - cy) < r ? RED : BLUE);
const blob = (cx, cy, r) => { const before = newMask({ w: MW, h: MH }), m = cloneMask(before); stroke(m, [cx, cy], [cx, cy], r); return { before, m }; };
const cov = (m, x, y) => { const fx = x - 0.5, fy = y - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy, g = (X, Y) => m.a[Math.min(MH - 1, Math.max(0, Y)) * MW + Math.min(MW - 1, Math.max(0, X))]; return (g(ix, iy) * (1 - u) + g(ix + 1, iy) * u) * (1 - v) + (g(ix, iy + 1) * (1 - u) + g(ix + 1, iy + 1) * u) * v; };
/** The outline's radius from (cx, cy) at angle th: the outermost 0.5 crossing along the ray. */
const radius = (m, cx, cy, th) => { let r = 0; for (let t = 0; t < 60; t += 0.05) if (cov(m, cx + Math.cos(th) * t, cy + Math.sin(th) * t) >= 0.5) r = t; return r; };
const radii = (m, cx, cy) => Array.from({ length: 72 }, (_, k) => radius(m, cx, cy, (k / 72) * 2 * Math.PI));

test('a too-large blob over a disc comes out within ~1.5 px (margin cap) +-0.7 sampling inside the disc edge all the way round', () => {
  const R = 20, em = picture(disc(80, 60, R)), { before, m } = blob(80, 60, 24);   // painted 4 px past the edge
  const r = snapMask(m, before, em, { radius: 24 }), rs = radii(r.mask, 80, 60);
  assert.ok(r.moved > 0);
  const lo = Math.min(...rs), hi = Math.max(...rs);
  assert.ok(hi <= R + 0.2 && lo >= R - 2.2, `radius ${lo.toFixed(2)}..${hi.toFixed(2)} vs the disc's ${R}`);
});

test('a too-small blob grows onto a close edge, still a little inside it', () => {
  const R = 20, em = picture(disc(80, 60, R)), { before, m } = blob(80, 60, 17.5);   // 2.5 px short, brush 17.5: reach 5.25
  const rs = radii(snapMask(m, before, em, { radius: 17.5 }).mask, 80, 60);
  assert.ok(Math.max(...rs) <= R + 0.2 && Math.min(...rs) >= R - 2.2, `radius ${Math.min(...rs).toFixed(2)}..${Math.max(...rs).toFixed(2)} vs ${R}`);
});

test('a blob over a flat area comes out as its own boundary shrunk by the margin (round, smooth)', () => {
  const em = picture(() => RED), { before, m } = blob(80, 60, 12), M = insideMargin(12);
  const rs = radii(snapMask(m, before, em, { radius: 12 }).mask, 80, 60);
  assert.ok(Math.min(...rs) >= 12 - M - 0.4 && Math.max(...rs) <= 12 - M + 0.4, `radius ${Math.min(...rs).toFixed(2)}..${Math.max(...rs).toFixed(2)} vs ${(12 - M).toFixed(2)}`);
});

test('a strong edge beyond the reach does not move the outline (it is only shrunk by the margin)', () => {
  const r0 = 10, M = insideMargin(r0), far = r0 + SNAP_REACH * r0 + 3;
  const em = picture(disc(80, 60, far)), { before, m } = blob(80, 60, r0);
  const rs = radii(snapMask(m, before, em, { radius: r0 }).mask, 80, 60);
  assert.ok(Math.min(...rs) >= r0 - M - 0.5 && Math.max(...rs) <= r0 - M + 0.5, `radius ${Math.min(...rs).toFixed(2)}..${Math.max(...rs).toFixed(2)}, edge at ${far.toFixed(1)}`);
});

test('a faint edge barely moves it', () => {
  const faint = (x, y) => (Math.hypot(x - 80, y - 60) < 12 ? [120, 120, 120] : [126, 120, 120]);
  const { before, m } = blob(80, 60, 14), M = insideMargin(14);
  const rs = radii(snapMask(m, before, picture(faint), { radius: 14 }).mask, 80, 60);
  assert.ok(Math.max(...rs) >= 14 - M - 0.4, `radius ${Math.max(...rs).toFixed(2)} stays near the painted ${(14 - M).toFixed(2)}`);
});

test('a thin bar does not collapse', () => {
  const before = newMask({ w: MW, h: MH }), m = cloneMask(before);
  for (let y = 58; y < 61; y++) for (let x = 40; x < 120; x++) m.a[y * MW + x] = 1;   // 3 px thick, 80 long
  const out = snapMask(m, before, picture(() => RED), { radius: 10 }).mask;
  let thick = 0;
  for (let y = 50; y < 70; y++) thick += out.a[y * MW + 80];
  assert.ok(thick >= 2.4, `the bar is ${thick.toFixed(2)} px thick at its middle`);
  for (let x = 45; x < 115; x++) assert.ok(out.a[59 * MW + x] > 0.5, 'unbroken along its length');
});

test('insetOutline: a thick square loses the margin, a thin bar keeps its width', () => {
  const w = 60, h = 60, a = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) a[y * w + x] = 1;
  for (let y = 29; y < 31; y++) for (let x = 5; x < 55; x++) b[y * w + x] = 1;   // 2 px
  const sa = insetOutline(signedDistance(a, w, h), w, h, 1.2), sb = insetOutline(signedDistance(b, w, h), w, h, 1.2);
  assert.ok(Math.abs(sa[30 * w + 10] - (-0.5 + 1.2)) < 0.5, 'square edge moved in by ~margin');
  assert.ok(sb[29 * w + 30] < 0 && sb[30 * w + 30] < 0, 'the 2 px bar is still inside');
});

test('adding to an existing group leaves the rest of its outline exactly as it was', () => {
  const before = newMask({ w: MW, h: MH });
  for (let y = 30; y < 60; y++) for (let x = 20; x < 60; x++) before.a[y * MW + x] = 1;
  const m = cloneMask(before);
  stroke(m, [75, 45], [90, 45], 6);   // a stroke well to the right
  const out = snapMask(m, before, picture(() => RED), { radius: 6 }).mask;
  for (let y = 0; y < MH; y++) for (let x = 0; x < 50; x++) assert.equal(out.a[y * MW + x], m.a[y * MW + x], `(${x}, ${y}) untouched`);
});

test('an erase stroke over a part snaps its new edge', () => {
  const em = picture((x) => (x < 76 ? RED : BLUE)), before = newMask({ w: MW, h: MH });
  for (let y = 40; y < 80; y++) for (let x = 60; x < 100; x++) before.a[y * MW + x] = 1;
  const m = cloneMask(before);
  stroke(m, [84, 30], [84, 90], 7, { erase: true });   // new edge at ~77; the picture edge at 76
  const out = snapMask(m, before, em, { radius: 7 }).mask;
  let x = 90;
  while (x > 60 && out.a[60 * MW + x] < 0.5) x--;
  assert.ok(x + 1 >= 74.6 && x + 1 <= 76.4, `the erased edge ends at ${x + 1} (edge 76, inside it)`);
});

test('never paints into another group', () => {
  const { before, m } = blob(80, 60, 8), other = newMask({ w: MW, h: MH });
  for (let y = 0; y < MH; y++) for (let x = 84; x < MW; x++) other.a[y * MW + x] = 1;
  const r = snapMask(m, before, picture(disc(80, 60, 11)), { radius: 8, others: [other] });
  for (let i = 0; i < m.a.length; i++) if (other.a[i] >= 0.5) assert.ok(r.mask.a[i] <= m.a[i] + 1e-6);
});

test('the outline stays one piece: no islands or spikes toward an edge inside the reach on one side', () => {
  const em = picture((x, y) => (Math.abs(y - 60) < 1 && x > 90 ? BLUE : RED));   // a thin line sticking out to the right
  const { before, m } = blob(80, 60, 12), out = snapMask(m, before, em, { radius: 12 }).mask;
  const rs = radii(out, 80, 60);
  for (let k = 0; k < 72; k++) assert.ok(Math.abs(rs[k] - rs[(k + 1) % 72]) < 1.2, `neighbouring angles agree at ${k}`);
});

// ---- paw-m2cg: strength, and a magnet that follows SHAPE (contour solved as a whole, parallel edges only, outer silhouette)
import { snapParams, contours } from '../src/features/tracking/snap.js';
const DARK = [20, 20, 25];
const minMax = (rs) => `${Math.min(...rs).toFixed(2)}..${Math.max(...rs).toFixed(2)}`;

test('a strong line crossing a disc (a diameter) does not dent the outline', () => {
  const R = 20, em = picture((x, y) => (Math.abs(y - 60) < 1.2 ? DARK : Math.hypot(x - 80, y - 60) < R ? RED : BLUE));
  const { before, m } = blob(80, 60, 22), M = insideMargin(22);
  const rs = radii(snapMask(m, before, em, { radius: 22 }).mask, 80, 60);
  assert.ok(Math.min(...rs) >= R - M - 0.7 && Math.max(...rs) <= R + 0.2, `radius ${minMax(rs)} vs disc ${R}, margin ${M}`);
  for (let k = 0; k < 72; k++) assert.ok(Math.abs(rs[k] - rs[(k + 1) % 72]) < 1, `no step at ${k}`);
});

test('a concentric shading ring just inside the edge: the outline goes to the OUTER edge, not the ring', () => {
  const R = 20, em = picture((x, y) => { const r = Math.hypot(x - 80, y - 60); return r >= 14.5 && r < 16 ? DARK : r < R ? RED : BLUE; });
  const { before, m } = blob(80, 60, 21.5), M = insideMargin(21.5);
  const rs = radii(snapMask(m, before, em, { radius: 21.5 }).mask, 80, 60);
  assert.ok(Math.min(...rs) >= R - M - 0.8 && Math.max(...rs) <= R + 0.2, `radius ${minMax(rs)}: ring at 14.5..16, edge at ${R}`);
});

test('a blob over two touching discs (a dark line between) stays on the disc it mostly covers', () => {
  const em = picture((x, y) => (Math.abs(x - 83) < 0.8 ? DARK : x < 83 && Math.hypot(x - 65, y - 60) < 18 ? RED : x > 83 && Math.hypot(x - 101, y - 60) < 18 ? [60, 190, 90] : BLUE));
  const { before, m } = blob(72, 60, 16);   // x 56..88: mostly the red disc (x < 83), 5 px over the green one
  const r = snapMask(m, before, em, { radius: 16, strength: 0.7 }).mask;
  let right = 0;
  for (let x = 60; x < 100; x++) if (r.a[60 * MW + x] >= 0.5) right = x + 1;
  assert.ok(right <= 83.2, `the blob ends at x=${right}: the line is at 83, the blob was painted to 88`);
  assert.ok(right >= 80, 'and still reaches the line');
});

test('strength 0 = the smoothed blob minus the margin; 50 is the classic reach; 100 reaches an edge 0.9 radii away that 50 does not', () => {
  assert.equal(snapParams(0).reachFrac, 0);
  assert.ok(Math.abs(snapParams(0.5).reachFrac - SNAP_REACH) < 1e-9);
  assert.ok(Math.abs(snapParams(1).reachFrac - 1) < 1e-9);
  assert.ok(snapParams(1).edgeMin < snapParams(0.5).edgeMin && snapParams(0).edgeMin > snapParams(0.5).edgeMin);
  const r0 = 12, M = insideMargin(r0), R = 0.9 * r0 + r0, em = picture(disc(80, 60, R)), { before, m } = blob(80, 60, r0);
  const at = (st) => radii(snapMask(m, before, em, { radius: r0, strength: st }).mask, 80, 60);
  const z = at(0), half = at(0.5), full = at(1);
  assert.ok(Math.min(...z) >= r0 - M - 0.4 && Math.max(...z) <= r0 - M + 0.4, `strength 0: ${minMax(z)} vs ${(r0 - M).toFixed(2)}`);
  assert.ok(Math.max(...half) <= r0 - M + 0.5, `strength 50 does not reach the edge at ${R}: ${minMax(half)}`);
  assert.ok(Math.min(...full) >= R - M - 1.2 && Math.max(...full) <= R + 0.2, `strength 100 reaches it: ${minMax(full)} vs ${R}`);
});

test('a single strong edge pixel (a speck) does not carve a notch, and a faint edge needs strength', () => {
  const em = picture((x, y) => (Math.abs(x - 90.5) < 0.4 && Math.abs(y - 60) < 0.4 ? DARK : RED)), { before, m } = blob(80, 60, 12), M = insideMargin(12);
  const rs = radii(snapMask(m, before, em, { radius: 12 }).mask, 80, 60);
  assert.ok(Math.min(...rs) >= 12 - M - 0.5 && Math.max(...rs) <= 12 - M + 0.5, `radius ${minMax(rs)}`);
  const faint = picture((x, y) => (Math.hypot(x - 80, y - 60) < 15 ? [120, 120, 120] : [136, 120, 120])), b2 = blob(80, 60, 12);
  const lo = radii(snapMask(b2.m, b2.before, faint, { radius: 12, strength: 0.5 }).mask, 80, 60), hi = radii(snapMask(b2.m, b2.before, faint, { radius: 12, strength: 1 }).mask, 80, 60);
  assert.ok(Math.max(...hi) > Math.max(...lo) + 0.8, `strength 100 follows the faint edge (${minMax(hi)}) strength 50 does not (${minMax(lo)})`);
});

test('the solved contour is closed and continuous (no jump between the first and last point; any start)', () => {
  const R = 18, em = picture((x, y) => (Math.hypot((x - 80) * 1.2, y - 60) < R ? RED : BLUE)), { before, m } = blob(80, 60, 20);
  const r = snapMask(m, before, em, { radius: 20, strength: 0.8 });
  const [c] = contours(r.mask.a.map((v) => 0.5 - v), MW, MH).filter((q) => q.closed);
  assert.ok(c, 'one closed outline');
  const n = c.p.length;
  for (let i = 0; i < n; i++) assert.ok(Math.hypot(c.p[i][0] - c.p[(i + 1) % n][0], c.p[i][1] - c.p[(i + 1) % n][1]) < 1.6, `no gap at ${i}`);
  const rs = radii(r.mask, 80, 60);
  for (let k = 0; k < 72; k++) assert.ok(Math.abs(rs[k] - rs[(k + 1) % 72]) < 1.2, `smooth at ${k}`);
});

test('a painted blob in a flat region keeps its area ratio (no growth, no collapse) at full strength', () => {
  const { before, m } = blob(80, 60, 14), r = snapMask(m, before, picture(() => RED), { radius: 14, strength: 1 });
  let a0 = 0, a1 = 0;
  for (let i = 0; i < m.a.length; i++) { a0 += m.a[i] >= 0.5; a1 += r.mask.a[i] >= 0.5; }
  assert.ok(a1 / a0 > 0.6 && a1 / a0 <= 1.0, `area ratio ${(a1 / a0).toFixed(2)}`);
});
