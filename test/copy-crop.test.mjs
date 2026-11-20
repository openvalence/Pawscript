// paw-d2d5: Copy from... onto re-framed footage (copy-from.js linkFor / boxXf / cropXf / cropDist, moveGroups' leave-out).
// Pictures: a flat-shaded world rendered at 4x and cut to a window, so a crop is the same picture re-framed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkFor, boxXf, cropXf, cropDist, moveGroups, bestPairs, IN_FRAME } from '../src/features/tracking/copy-from.js';
import { pyramid, resize, matchShots, linkBox } from '../src/lib/crop-match.js';
import { maskSize, newMask, stroke, fitPoly, encodeMask, maskOf } from '../src/features/tracking/groups.js';
import { budget } from './perf.mjs';

const W = 128, H = 72, K = 4, WW = W * K, WH = H * K;
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const r0 = rng(3), shapes = Array.from({ length: 30 }, () => ({ x: r0(), y: r0(), rx: 0.02 + 0.07 * r0(), ry: 0.02 + 0.07 * r0(), v: r0() }));
/** The world at loop phase f: shapes + a bright "body" disc swinging on a 12-frame loop. */
function world(f = 0) {
  const d = new Float32Array(WW * WH), bx = 0.45 + 0.05 * Math.cos((2 * Math.PI * f) / 12), by = 0.5 + 0.06 * Math.sin((2 * Math.PI * f) / 12);
  for (let j = 0; j < WH; j++) for (let i = 0; i < WW; i++) {
    const x = (i + 0.5) / WW, y = (j + 0.5) / WH;
    let v = 0.3 + 0.2 * x;
    for (const s of shapes) if (((x - s.x) / s.rx) ** 2 + ((y - s.y) / s.ry) ** 2 < 1) v = s.v;
    const q = ((x - bx) / 0.07) ** 2 + ((y - by) / 0.12) ** 2;
    if (q < 1) v = q > 0.75 ? 0.05 : 0.9;
    d[j * WW + i] = v;
  }
  return { w: WW, h: WH, d };
}
const view = (wd, x = 0, y = 0, s = 1) => {
  const ww = Math.round(WW / s), wh = Math.round(WH / s), x0 = Math.round(x * WW), y0 = Math.round(y * WH), d = new Float32Array(ww * wh);
  for (let j = 0; j < wh; j++) for (let i = 0; i < ww; i++) d[j * ww + i] = wd.d[(y0 + j) * WW + x0 + i];
  return resize({ w: ww, h: wh, d }, W, H);
};
const SIZE = maskSize(16 / 9);
/** A group: a disc at (cx, cy) radius r (0..1 of the height) on its frame. */
const disc = (name, cx, cy, r, extra = {}) => { const m = newMask(SIZE); stroke(m, [cx * m.w, cy * m.h], [cx * m.w, cy * m.h], r * m.h); return { name, poly: fitPoly(m).poly, mask: encodeMask(m), t_ms: 0, source: 'user', pinned: true, ...extra }; };
const centre = (g) => { const m = maskOf(g, SIZE); let sx = 0, sy = 0, n = 0; for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) if (m.a[j * m.w + i] >= 0.5) { sx += i + 0.5; sy += j + 0.5; n++; } return { x: sx / n / m.w, y: sy / n / m.h, n }; };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('boxXf: wide -> tight magnifies onto the crop, tight -> wide shrinks back (the two are inverse)', () => {
  const box = { x: 0.2, y: 0.3, w: 0.5, h: 0.5 }, f = boxXf(box, true), b = boxXf(box, false);
  const mv = (xf, p) => (p - 0.5) * xf.s + 0.5;
  near(f.s, 2, 1e-9, 'scale'); near(b.s, 0.5, 1e-9, 'scale back');
  near(mv(f, 0.2) + f.dx, 0, 1e-9, 'the crop\'s left edge lands on 0'); near(mv(f, 0.7) + f.dx, 1, 1e-9, 'its right edge on 1');
  near(mv(f, 0.3) + f.dy, 0, 1e-9, 'top'); near(mv(f, 0.8) + f.dy, 1, 1e-9, 'bottom');
  for (const p of [0, 0.37, 1]) near(mv(b, mv(f, p) + f.dx) + b.dx, p, 1e-9, 'round trip');
});

test('moveGroups through a crop: parts land on their place at the crop\'s scale, parts outside are left out, a clipped one keeps its name / who / side', () => {
  const box = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, xf = boxXf(box, true);
  const gs = [
    disc('c1_hips', 0.5, 0.5, 0.05, { who: 'c1', part: 'hips' }),                // the middle: lands in the middle, twice the size
    disc('c1_head', 0.35, 0.4, 0.04, { who: 'c1', part: 'head' }),
    disc('c2_tail', 0.05, 0.1, 0.04, { who: 'c2', part: 'tail' }),               // outside the crop: left out
    disc('c1_thighs_l', 0.255, 0.6, 0.06, { who: 'c1', part: 'thighs', side: 'l' }),   // on the crop's left edge: about half in, clipped
  ];
  const out = moveGroups(gs, xf, 500, (g) => maskOf(g, SIZE));
  assert.deepEqual(out.map((g) => g.name), ['c1_hips', 'c1_head', 'c1_thighs_l']);
  assert.equal(out.lost, 1); assert.equal(out.of, 4);
  const h = centre(out[0]), h0 = centre(gs[0]);
  near(h.x, 0.5, 0.01, 'hips x'); near(h.y, 0.5, 0.01, 'hips y'); near(h.n / h0.n, 4, 0.3, 'area x scale^2');
  const c = centre(out[1]); near(c.x, (0.35 - 0.25) / 0.5, 0.01, 'head x'); near(c.y, (0.4 - 0.25) / 0.5, 0.01, 'head y');
  const t = out[2];
  assert.equal(t.who, 'c1'); assert.equal(t.side, 'l'); assert.equal(t.part, 'thighs'); assert.equal(t.lined, 'moved'); assert.equal(t.t_ms, 500);
  assert.ok(Math.min(...t.poly.map((p) => p[0])) >= 0 && centre(t).x < 0.1, 'clipped at the frame\'s left edge');
  // a sliver under IN_FRAME is left out, just over it is kept
  const edge = (cx) => moveGroups([disc('x', cx, 0.5, 0.04)], xf, 0, (g) => maskOf(g, SIZE));
  const r = (0.04 * SIZE.h) / SIZE.w;   // the disc's radius in width units
  assert.equal(edge(0.25 - r * 0.75).length, 0, 'a sliver (~5 % inside) left out');
  assert.equal(edge(0.25 - r * 0.2).length, 1, '~40 % inside kept');
  assert.ok(IN_FRAME > 0.05 && IN_FRAME < 0.4);
  // tight -> wide: everything shrinks, nothing is left out
  const back = moveGroups(out, boxXf(box, false), 0, (g) => maskOf(g, SIZE));
  assert.equal(back.lost, 0);
  const hb = centre(back[0]); near(hb.x, 0.5, 0.01, 'back x'); near(hb.n / h.n, 0.25, 0.05, 'area / 4');
});

test('linkFor finds the crop link between the source\'s shot and the target\'s, either way round', () => {
  const scenes = [0, 1, 2, 3].map((k) => ({ start_ms: k * 1000, end_ms: (k + 1) * 1000 }));
  const links = [{ a: { start_ms: 0, end_ms: 1000 }, b: { start_ms: 2000, end_ms: 3000 }, kind: 'crop', tighter: 'b', scale: 1.8, score: 0.96, box: { x: 0.1, y: 0.2, w: 0.55, h: 0.55 } }];
  assert.deepEqual(linkFor(links, scenes, 400, 2500), { wideIsSrc: true, box: links[0].box, scale: 1.8, score: 0.96 });
  assert.equal(linkFor(links, scenes, 2400, 300).wideIsSrc, false);
  assert.equal(linkFor(links, scenes, 400, 1500), null, 'no link to shot 1');
  assert.equal(linkFor(links, scenes, 400, 600), null, 'the same shot');
  assert.equal(linkFor([{ ...links[0], kind: 'other' }], scenes, 400, 2500), null);
  assert.equal(linkFor(null, scenes, 400, 2500), null);
});

test('cropXf: through a link (refined on the frames) and by matching the two frames; the same framing / another picture -> null', () => {
  const wd = world(0), A = pyramid(view(wd)), cases = [[1.3, 0.1, 0.15], [1.8, 0.3, 0.2], [2.5, 0.35, 0.4]];
  for (const [s, x, y] of cases) {
    const B = pyramid(view(wd, x, y, s)), want = { x, y, w: 1 / s, h: 1 / s };
    const m = cropXf(A, B);
    assert.ok(m && m.via === 'match' && m.wideIsSrc, `x${s} matched`);
    near(m.scale, s, s * 0.05, `x${s} scale`);
    const wx = boxXf(want, true);
    near(m.xf.dx, wx.dx, 0.03 * s, `x${s} dx`); near(m.xf.dy, wx.dy, 0.03 * s, `x${s} dy`);
    const back = cropXf(B, A);
    assert.ok(back && !back.wideIsSrc && Math.abs(back.xf.s - 1 / s) < 0.05 / s, `x${s} back the other way`);
    // a link from other frames of the shots (4 frames a shot, as tracking's shotLinks: a link exists when one pair is the same
    // drawing, score >= 0.93), used on another loop phase
    const L = matchShots([0, 3, 6, 9].map((f) => pyramid(view(world(f)))), [1, 3, 7, 10].map((f) => pyramid(view(world(f), x, y, s))));
    const viaLink = cropXf(pyramid(view(world(5))), pyramid(view(world(5), x, y, s)), { wideIsSrc: true, box: linkBox(L), scale: L.scale, score: L.score });
    assert.ok(L.score >= 0.93, `x${s} a link: ${L.score}`);
    assert.ok(viaLink?.via === 'link', `x${s} through the link`);
    near(viaLink.scale, s, s * 0.05, `x${s} link scale`);
  }
  assert.equal(cropXf(A, pyramid(view(wd))), null, 'the same framing is not a crop');
  const other = { w: W, h: H, d: new Float32Array(W * H).map((_, i) => ((i * 7919) % 97) / 97) };
  assert.equal(cropXf(A, pyramid(other)), null, 'another picture: no confident match');
  const t0 = performance.now(); for (let k = 0; k < 5; k++) cropXf(A, pyramid(view(wd, 0.3, 0.2, 1.8))); const ms = (performance.now() - t0) / 5;
  budget(ms < 60, `a frame match is cheap enough for a hover: ${ms.toFixed(1)} ms`);
});

test('cropDist pairs the source with the frame of the crop shot showing the same drawing, and ranks it over a mediocre same-framing source', () => {
  const x = 0.25, y = 0.2, s = 1.8, L = matchShots([0, 3, 6, 9].map((f) => pyramid(view(world(f)))), [1, 3, 7, 10].map((f) => pyramid(view(world(f), x, y, s))));
  const link = { wideIsSrc: true, box: linkBox(L) }, src = view(world(6));
  const ds = Array.from({ length: 12 }, (_, f) => cropDist(src, view(world(f), x, y, s), link));
  const best = ds.indexOf(Math.min(...ds));
  assert.ok(Math.abs(best - 6) <= 1, `the source's own phase (6) or its neighbour: ${best} (${ds.map((d) => d.toFixed(3)).join(' ')})`);
  // bestPairs with the strip's distance: the crop-linked painted frame (cropDist) beats an unrelated one (print distance 0.2)
  const targets = new Map(Array.from({ length: 12 }, (_, f) => [f, view(world(f), x, y, s)]));
  const sources = [{ key: 'pc', src: 's0', kind: 'painted', print: 1, big: src, crop: link }, { key: 'po', src: 's3', kind: 'painted', print: 1 }];
  const dist = (c, k) => (c.crop ? cropDist(c.big, targets.get(k), c.crop) : 0.2);
  const pairs = bestPairs(sources, targets, 0, { dist });
  assert.deepEqual(pairs.map((c) => c.key), ['pc', 'po']);
  assert.ok(Math.abs(pairs[0].k - 6) <= 1, 'paired at the same drawing');
});
