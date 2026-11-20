// "Circle to fill" for the Groups brush (paw-714j, fill.js): synthetic images (soft-edged shapes), the loop gesture, the merge rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeMap, marginPx, MARGIN_DEFAULT } from '../src/features/tracking/snap.js';
import { loopFrom, fillLoop, mergeFill, rasterLoop, TRAVEL } from '../src/features/tracking/fill.js';
const insideMargin = (r) => marginPx(MARGIN_DEFAULT / 100, (4 * r) / 3);   // the default paint margin of a disc of radius r (width 4r/3)

const W = 160, H = 120, BRUSH = 8;
const BG = [40, 60, 90], FG = [220, 180, 60];
/** An RGBA frame: bg, then each shape {d(x, y) -> signed distance (< 0 inside, px), c: [r, g, b]} anti-aliased over 1.5 px. */
function frame(shapes, bg = BG, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = [...bg];
    for (const s of shapes) { const t = Math.min(1, Math.max(0, 0.5 - s.d(x + 0.5, y + 0.5) / 1.5)); for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - t) + s.c[k] * t; }
    data.set([c[0], c[1], c[2], 255], 4 * (y * w + x));
  }
  return { w, h, data };
}
const disc = (cx, cy, r, c = FG) => ({ d: (x, y) => Math.hypot(x - cx, y - cy) - r, c });
const rect = (x0, y0, x1, y1, c) => ({ d: (x, y) => Math.max(x0 - x, x - x1, y0 - y, y - y1), c });
const circle = (cx, cy, r, n = 28, a0 = 0, sweep = 2 * Math.PI) => Array.from({ length: n + 1 }, (_, k) => [cx + r * Math.cos(a0 + (sweep * k) / n), cy + r * Math.sin(a0 + (sweep * k) / n)]);
const stat = (m, f) => { let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, rmax = 0; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.a[y * m.w + x] >= 0.5) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); if (f) rmax = Math.max(rmax, f(x + 0.5, y + 0.5)); } return { n, x0, x1, y0, y1, rmax }; };

test('a soft disc circled at 70 % of its radius grows to the disc minus the margin all round', () => {
  const em = edgeMap(frame([disc(80, 60, 30)]));
  const r = fillLoop(circle(80, 60, 21), W, H, em, { radius: BRUSH });
  assert.equal(r.mode, 'picture'); assert.ok(r.grew > 300, 'grew past the loop: ' + r.grew);
  const m = insideMargin(BRUSH), st = stat(r.mask, (x, y) => Math.hypot(x - 80, y - 60));
  assert.ok(st.rmax <= 30 - 0.2 && st.rmax >= 30 - m - 2.2, `edge at ${st.rmax.toFixed(2)} px: inside the disc by 0.2 .. ${(m + 2.2).toFixed(1)} px`);
  const full = Math.PI * 30 * 30;
  assert.ok(st.n > 0.8 * full && st.n < 0.99 * full, `area ${st.n} of the disc's ${full.toFixed(0)}`);
  // all round: every direction reaches within 3 px of the disc edge
  for (let a = 0; a < 8; a++) { const t = (a * Math.PI) / 4; let rr = 0; for (let q = 0; q < 40; q += 0.5) if (r.mask.a[Math.floor(60 + q * Math.sin(t)) * W + Math.floor(80 + q * Math.cos(t))] >= 0.5) rr = q; assert.ok(rr >= 30 - m - 2.5 && rr <= 30, `direction ${a}: ${rr}`); }
  console.log(`# circle-fill ${W}x${H}: disc ${r.ms} ms (grew ${r.grew}, mode ${r.mode})`);
});

test('a loop overshooting one side comes back in to the edge there, and still grows where it falls short', () => {
  const em = edgeMap(frame([disc(80, 60, 30)]));
  const r = fillLoop(circle(88, 60, 30), W, H, em, { radius: BRUSH });   // 8 px too far right: its left edge is 8 px inside the disc
  const st = stat(r.mask);
  assert.ok(st.x1 <= 110 && st.x1 >= 106, 'right edge back at the disc edge: ' + st.x1);
  assert.ok(st.x0 <= 53 && st.x0 >= 49, 'left edge grown out to the disc edge: ' + st.x0);
  assert.ok(r.shrank > 100 && r.grew > 100, `dropped ${r.shrank}, grew ${r.grew}`);
});

test('a part next to a similar-coloured neighbour, split by a dark line, stops at the line', () => {
  const A = [200, 150, 60], A2 = [205, 148, 62], LINE = [20, 25, 30];
  const em = edgeMap(frame([rect(20, 30, 80, 100, A), rect(80, 30, 83, 100, LINE), rect(83, 30, 140, 100, A2)]));
  const r = fillLoop([[24, 35], [74, 35], [74, 95], [24, 95], [24, 35]], W, H, em, { radius: BRUSH });
  const st = stat(r.mask);
  assert.ok(st.x1 < 80, 'never past the line: ' + st.x1);
  assert.ok(st.x1 >= 76 && st.x0 <= 22, `grown to the line and the left edge: ${st.x0}..${st.x1}`);
  assert.ok(st.y0 <= 32 && st.y1 >= 97, `and the top and bottom: ${st.y0}..${st.y1}`);
});

test('a flat frame gives the loop\'s own smoothed interior: no flood', () => {
  const em = edgeMap(frame([], BG));
  const loop = circle(80, 60, 20), area = Math.PI * 400, r = fillLoop(loop, W, H, em, { radius: BRUSH });
  const st = stat(r.mask);
  assert.ok(r.mode === 'flat' && r.grew === 0, r.mode);
  assert.ok(st.n > 0.8 * area && st.n < 1.02 * area, `area ${st.n} vs the loop's ${area.toFixed(0)}`);
  assert.ok(st.x0 >= 60 && st.x1 <= 100);
  const none = fillLoop(loop, W, H, null, { radius: BRUSH });
  assert.equal(none.mode, 'loop'); assert.ok(Math.abs(stat(none.mask).n - st.n) < 40, 'without a picture: the same');
});

test('never into another group; one component; holes filled', () => {
  const em = edgeMap(frame([disc(80, 60, 30), disc(80, 60, 6, BG)]));   // a hole in the part
  const other = { w: W, h: H, a: new Float32Array(W * H) };
  for (let y = 0; y < H; y++) for (let x = 95; x < W; x++) other.a[y * W + x] = 1;
  const r = fillLoop(circle(80, 60, 21), W, H, em, { radius: BRUSH, others: [other] });
  assert.equal(stat(r.mask).x1 < 95, true, 'stops at the other group');
  assert.ok(r.mask.a[60 * W + 80] >= 0.5, 'the small hole is filled');
  const bin = Uint8Array.from(r.mask.a, (v) => (v >= 0.5 ? 1 : 0));
  let comps = 0; const seen = new Uint8Array(bin.length);
  for (let s = 0; s < bin.length; s++) if (bin[s] && !seen[s]) { comps++; const st = [s]; seen[s] = 1; while (st.length) { const i = st.pop(); for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < bin.length && bin[j] && !seen[j] && Math.abs((j % W) - (i % W)) <= 1) { seen[j] = 1; st.push(j); } } }
  assert.equal(comps, 1);
});

test('the loop gesture: a gap of 20 % closes; a straight, back-and-forth or gentle stroke stays a brush stroke', () => {
  const R = 20, arc = circle(80, 60, R, 40, 0.3, 2 * Math.PI * 0.8);   // 80 % of a circle: a 20 % gap
  const l = loopFrom(arc);
  assert.ok(l && l.length === arc.length, '20 % gap closes');
  assert.ok(loopFrom(circle(80, 60, R, 40)), 'a closed loop');
  assert.equal(loopFrom(circle(80, 60, R, 40, 0, 2 * Math.PI * 0.6)), null, 'a 40 % gap does not');
  assert.equal(loopFrom(Array.from({ length: 30 }, (_, k) => [20 + k * 4, 60 + (k % 2)])), null, 'a straight stroke');
  assert.equal(loopFrom([...Array.from({ length: 15 }, (_, k) => [20 + k * 4, 60]), ...Array.from({ length: 15 }, (_, k) => [76 - k * 4, 61])]), null, 'back and forth');
  assert.equal(loopFrom(circle(80, 60, R, 20, 0, Math.PI / 2)), null, 'a gentle arc');
  assert.equal(loopFrom([[1, 1], [2, 1], [3, 2], [2, 3]]), null, 'a dab');
  assert.equal(rasterLoop([[10, 10], [30, 10], [30, 30], [10, 30]], 40, 40).reduce((a, b) => a + b, 0), 400);
});

test('a second loop REPLACES the shape when it overlaps most of it, else ADDS', () => {
  const sq = (x0, x1) => { const a = new Float32Array(W * H); for (let y = 40; y < 80; y++) for (let x = x0; x < x1; x++) a[y * W + x] = 1; return { w: W, h: H, a }; };
  const old = sq(40, 80), over = mergeFill(old, sq(45, 90)), apart = mergeFill(old, sq(100, 140));
  assert.ok(over.replaced && over.a[50 * W + 85] === 1 && over.a[50 * W + 42] === 0, 'overlaps most: replaced');
  assert.ok(!apart.replaced && apart.a[50 * W + 42] === 1 && apart.a[50 * W + 120] === 1, 'elsewhere: added');
  assert.equal(mergeFill(null, sq(0, 10)).replaced, false);
  assert.equal(TRAVEL, 0.5);
});

// ---- paw-k8jj: grow to fill starts from a group's own mask (raster) and takes the strip it left, within GROW_TRAVEL
const GROW_TRAVEL = 0.3;
test('grow to fill: a mask that stops short of the part gets the strip, bounded by GROW_TRAVEL and by a strong edge', () => {
  const A = [200, 150, 60], LINE = [20, 25, 30];
  const em = edgeMap(frame([rect(20, 30, 120, 90, A)]));
  const strip = (x1) => { const r = new Uint8Array(W * H); for (let y = 36; y < 84; y++) for (let x = 26; x < x1; x++) r[y * W + x] = 1; return r; };   // 6 px short on every side but one is enough
  const short = strip(100);   // stops 20 px before the part's right edge (x = 120)
  const R = Math.sqrt(short.reduce((s, v) => s + v, 0) / Math.PI);
  const r = fillLoop(null, W, H, em, { raster: short, radius: BRUSH, travel: GROW_TRAVEL });
  assert.equal(r.mode, 'picture'); assert.ok(r.grew > 100, 'took the strip: ' + r.grew);
  let x1 = 0; for (let x = 0; x < W; x++) if (r.mask.a[60 * W + x] >= 0.5) x1 = x;
  assert.ok(x1 > 105 && x1 <= 120, `right edge moved out toward 120, never past it: ${x1}`);
  assert.ok(x1 <= 100 + GROW_TRAVEL * R + 1, `within GROW_TRAVEL x radius (${(GROW_TRAVEL * R).toFixed(1)} px) of the old edge: ${x1}`);
  // a dark line across the strip stops it
  const em2 = edgeMap(frame([rect(20, 30, 120, 90, A), rect(106, 30, 109, 90, LINE)]));
  const r2 = fillLoop(null, W, H, em2, { raster: short, radius: BRUSH, travel: GROW_TRAVEL });
  let x2 = 0; for (let x = 0; x < W; x++) if (r2.mask.a[60 * W + x] >= 0.5) x2 = x;
  assert.ok(x2 < 106, `stopped at the line: ${x2}`);
  // never into another group
  const other = { w: W, h: H, a: new Float32Array(W * H) }; for (let y = 0; y < H; y++) for (let x = 106; x < W; x++) other.a[y * W + x] = 1;
  const r3 = fillLoop(null, W, H, em, { raster: short, radius: BRUSH, travel: GROW_TRAVEL, others: [other] });
  for (let i = 0; i < r3.mask.a.length; i++) if (other.a[i] >= 0.5) assert.equal(r3.mask.a[i], 0);
  void LINE;
});
