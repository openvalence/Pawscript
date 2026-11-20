// paw-s63m: the paint margin. ONE setting (0..100 %) maps to the inside margin every painting aid applies, as a share of the
// PART's own size (small parts lose little), never past a ceiling; the default sits almost on the edge; small parts keep a smooth
// outline (the polygon fitted to the soft mask's sub-pixel iso-line, not the thresholded pixels).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newMask, cloneMask, stroke, fitPoly, polyArea } from '../src/features/tracking/groups.js';
import { snapMask, edgeMap, signedDistance, partWidth, marginPx, marginFor, MARGIN_DEFAULT, MARGIN_FRAC, MARGIN_MAX } from '../src/features/tracking/snap.js';
import { cleanMask } from '../src/features/tracking/grow.js';
import { fillLoop } from '../src/features/tracking/fill.js';

const W = 160, H = 120;
const discMask = (R, cx = 80, cy = 60) => { const a = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = Math.min(1, Math.max(0, R + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy))); return a; };
const area = (a) => a.reduce((s, v) => s + v, 0);
const flat = () => { const data = new Uint8ClampedArray(W * H * 4).fill(180); return edgeMap({ w: W, h: H, data }); };
const loop = (R, n = 90) => Array.from({ length: n }, (_, k) => [80 + R * Math.cos((2 * Math.PI * k) / n), 60 + R * Math.sin((2 * Math.PI * k) / n)]);
const sd = (a) => signedDistance(a, W, H);

test('the mapping: share of the part, a small part loses less, 0 is the edge, the ceiling holds, the default is a low value', () => {
  assert.ok(MARGIN_DEFAULT > 0 && MARGIN_DEFAULT <= 25, 'a low default');
  assert.equal(marginPx(0, 40), 0, '0 = exactly at the snapped edge');
  const small = marginPx(1, 8), large = marginPx(1, 60);
  assert.ok(Math.abs(small - MARGIN_FRAC * 8) < 1e-9 && small < large, 'at the same setting a small part gets less');
  assert.equal(marginPx(1, 1000), MARGIN_MAX, 'the ceiling');
  assert.ok(marginPx(1, 1000) <= MARGIN_MAX && marginPx(0.5, 1000) === 0.5 * MARGIN_MAX, 'linear in the setting up to it');
  assert.equal(marginPx(5, 60), marginPx(1, 60), 'the setting is clamped to 0..1');
  // measured on real fields: the width is the part's own (4 x mean depth)
  const wS = partWidth(sd(discMask(4))), wL = partWidth(sd(discMask(30)));
  assert.ok(Math.abs(wL - (4 * 30) / 3) < 2.5 && wS < wL, `disc widths ${wS.toFixed(1)} / ${wL.toFixed(1)}`);
  const dl = marginFor(sd(discMask(30)), MARGIN_DEFAULT / 100), ds = marginFor(sd(discMask(4)), MARGIN_DEFAULT / 100);
  assert.ok(dl > 0.3 && dl < 0.8, `the default on a large part: ${dl.toFixed(2)} mask px (~${(dl * 6).toFixed(1)} px at 1080p)`);
  assert.ok(ds < dl && ds / 4 < 0.05, `on a small part (R 4): ${ds.toFixed(2)} px, ${((100 * ds) / 4).toFixed(1)} % of its radius`);
  assert.equal(marginFor(sd(discMask(30)), 1), MARGIN_MAX, 'the most: the ceiling');
});

test('a small part keeps most of its area and a smooth outline at the default (polygon from the soft mask)', () => {
  const before = newMask({ w: W, h: H }), m = cloneMask(before);
  stroke(m, [80, 60], [80, 60], 4);   // a part ~8 mask px across (~48 px at 1080p)
  const painted = area(m.a);
  const r = snapMask(m, before, flat(), { radius: 4 });
  assert.ok(area(r.mask.a) >= 0.8 * painted, `area kept ${(area(r.mask.a) / painted).toFixed(3)} (the old fixed margin kept 0.54; the rest is the smoothing's own small bias on a tiny convex part)`);
  const { poly } = fitPoly(r.mask);
  assert.ok(poly.length >= 12, `${poly.length} vertices: a circle, not an octagon`);
  const P = poly.map(([x, y]) => [x * W, y * H]);
  let worst = 0;
  for (let i = 0; i < P.length; i++) { const a = P[(i + P.length - 1) % P.length], b = P[i], c = P[(i + 1) % P.length]; let t = Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])); t = Math.min(t, 2 * Math.PI - t); worst = Math.max(worst, t); }
  assert.ok((worst * 180) / Math.PI <= 40, `sharpest turn ${((worst * 180) / Math.PI).toFixed(0)} degrees`);
  assert.ok(Math.abs((polyArea(poly) * W * H) / area(r.mask.a) - 1) < 0.12, 'the polygon covers what the mask holds');
});

test('a part a few pixels wide is not turned into a square by the polygon fit (the cause of the angular small parts)', () => {
  for (const R of [2.5, 3.5]) {
    const { poly } = fitPoly({ w: W, h: H, a: discMask(R) });
    assert.ok(poly.length >= 12, `R ${R}: ${poly.length} vertices (the thresholded-pixel ring gave 4 and 8)`);
    assert.ok((polyArea(poly) * W * H) / (Math.PI * R * R) > 0.9, `R ${R}: area kept`);
  }
});

test('all four aids give the same margin on the same part (magnet, circle to fill, grow / cleanMask; the sidecar port is checked in test_seedsam.py)', () => {
  const R = 24;
  const edgeR = (a) => Math.sqrt(area(a) / Math.PI);   // the equivalent radius (sub-pixel: the coverage is soft)
  for (const setting of [0, 15, 100]) {
    const s = setting / 100, want = marginFor(sd(discMask(R)), s);
    const before = newMask({ w: W, h: H }), m = cloneMask(before);
    stroke(m, [80, 60], [80, 60], R);
    const snap = snapMask(m, before, flat(), { radius: R, margin: s }).mask.a;
    const fill = fillLoop(loop(R), W, H, null, { margin: s }).mask.a;
    const grow = cleanMask(Float32Array.from(discMask(R), (v) => (v >= 0.5 ? 1 : 0)), W, H, [[80, 60]], { margin: s }).a;
    const radii = { snap: edgeR(snap), fill: edgeR(fill), grow: edgeR(grow) };
    for (const [k, r] of Object.entries(radii)) assert.ok(Math.abs(r - (R - want)) < 0.6, `${k} at ${setting} %: radius ${r.toFixed(2)} vs ${(R - want).toFixed(2)}`);
    const v = Object.values(radii);
    assert.ok(Math.max(...v) - Math.min(...v) < 0.7, `the aids agree to ${(Math.max(...v) - Math.min(...v)).toFixed(2)} px at ${setting} %: ${JSON.stringify(radii)}`);
  }
});

test('0 % is at the snapped edge and 100 % pulls in by the ceiling on a large part; more margin never grows the part', () => {
  const R = 40, before = newMask({ w: W, h: H }), m = cloneMask(before);
  stroke(m, [80, 60], [80, 60], R);
  const a0 = area(snapMask(m, before, flat(), { radius: R, margin: 0 }).mask.a), a15 = area(snapMask(m, before, flat(), { radius: R, margin: 0.15 }).mask.a), a100 = area(snapMask(m, before, flat(), { radius: R, margin: 1 }).mask.a);
  assert.ok(a0 > a15 && a15 > a100);
  const r0 = Math.sqrt(a0 / Math.PI), r100 = Math.sqrt(a100 / Math.PI);
  assert.ok(Math.abs(r0 - R) < 0.8, `0 %: radius ${r0.toFixed(2)} vs the painted ${R}`);
  assert.ok(Math.abs(R - r100 - MARGIN_MAX) < 0.8, `100 %: ${(R - r100).toFixed(2)} px in vs the ceiling ${MARGIN_MAX}`);
});
