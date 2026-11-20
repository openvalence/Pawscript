// paw-3uyu: the crop matcher (lib/crop-match.js), the proposal rules that use it (lib/scenes-continue.js proposeSpans /
// withProposals) and its offer (repeat-scenes cropOffers). Pictures are flat-shaded shapes rendered at 3x and cut to a
// window, so a crop is the same picture re-framed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resize, pyramid, matchFrames, matchShots, cropLink, linkShots, loopPhase, loopLinks, linkBox, printSize, grey, CROP_MATCH } from '../src/lib/crop-match.js';
import { proposeSpans, proposeContinues, withProposals, continuations } from '../src/lib/scenes-continue.js';
import { cropOffers } from '../src/features/timeline/repeat-scenes.js';

const W = 128, H = 72, K = 3;
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
/** A flat-shaded world (W*K x H*K): a ground, shapes, and a "character" disc at (cx, cy) moving with phase. */
function world(seed, { phase = 0, period = 12, overlay = false } = {}) {
  const r = rng(seed), w = W * K, h = H * K, d = new Float32Array(w * h).fill(0.3 + 0.2 * r());
  const shapes = Array.from({ length: 10 }, () => ({ x: r() * w, y: r() * h, rx: 15 + r() * 80, ry: 15 + r() * 60, v: r() }));
  const cx = w * 0.45 + 20 * Math.cos((2 * Math.PI * phase) / period), cy = h * 0.55 + 25 * Math.sin((2 * Math.PI * phase) / period);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    for (const s of shapes) if (((x - s.x) / s.rx) ** 2 + ((y - s.y) / s.ry) ** 2 < 1) d[y * w + x] = s.v;
    const q = ((x - cx) / 40) ** 2 + ((y - cy) / 55) ** 2;
    if (q < 1) d[y * w + x] = q > 0.8 ? 0.05 : 0.85;
  }
  return { w, h, d, overlay };
}
/** The world seen through a window (top-left x, y in 0..1, scale s), as a W x H print; overlay: a white box stamped
 *  at the same screen place whatever the window (a logo). */
function view(wd, x = 0, y = 0, s = 1) {
  const ww = Math.round(wd.w / s), wh = Math.round(wd.h / s), x0 = Math.round(x * wd.w), y0 = Math.round(y * wd.h), d = new Float32Array(ww * wh);
  for (let j = 0; j < wh; j++) for (let i = 0; i < ww; i++) d[j * ww + i] = wd.d[(y0 + j) * wd.w + x0 + i];
  const p = resize({ w: ww, h: wh, d }, W, H);
  if (wd.overlay) for (let j = H - 14; j < H - 2; j++) for (let i = W - 40; i < W - 2; i++) p.d[j * W + i] = 1;
  return p;
}
const P = (p) => pyramid(p);

test('a crop is found at its scale and offset (x1.3, x2, x3), the wider frame first or second', () => {
  const A = world(1);
  for (const [s, x, y] of [[1.3, 0.1, 0.12], [2, 0.25, 0.3], [3, 0.4, 0.35]]) {
    const m = matchFrames(P(view(A)), P(view(A, x, y, s)));
    assert.ok(m.score > 0.95, `x${s} score ${m.score}`);
    assert.ok(Math.abs(m.scale - s) / s < 0.05, `scale ${m.scale} vs ${s}`);
    assert.ok(Math.abs(m.x - x) < 0.03 && Math.abs(m.y - y) < 0.03, `offset ${m.x}, ${m.y}`);
    const r = matchShots([P(view(A, x, y, s))], [P(view(A))]);
    assert.equal(r.tighter, 'a');
    assert.deepEqual(linkBox(r), { x: r.x, y: r.y, w: r.w, h: r.w });
  }
});

test('unrelated pictures, a different world of the same kind, and the same framing do not make a crop link', () => {
  const A = P(view(world(1))), B = P(view(world(2))), C = P(view(world(3), 0.2, 0.2, 2));
  assert.ok(matchShots([A], [B]).score < CROP_MATCH.score);
  assert.equal(cropLink([A], [C]), null);
  assert.equal(matchShots([A], [A]).tighter, 'same');
  assert.equal(cropLink([A], [A]), null, 'the same framing is not a crop');
});

test('frame sets: a looping crop at another phase matches some frame of the wide shot', () => {
  const FA = [0, 3, 6, 9].map((ph) => P(view(world(1, { phase: ph })))), FB = [13, 6].map((ph) => P(view(world(1, { phase: ph }), 0.2, 0.25, 1.8)));
  const one = matchShots([FA[0]], [FB[0]]), all = matchShots(FA, FB);
  assert.ok(all.score >= one.score && all.score > CROP_MATCH.score, `${one.score} -> ${all.score}`);
  assert.ok(Math.abs(all.scale - 1.8) < 0.1);
});

test('mask: an overlay at the same screen place in both shots is ignored when masked', () => {
  const A = world(1, { overlay: true }), mask = { w: 32, h: 18, d: Uint8Array.from({ length: 32 * 18 }, (_, i) => +(i % 32 >= 21 && Math.floor(i / 32) >= 13)) };
  const plain = matchShots([P(view(A))], [P(view(A, 0.2, 0.25, 2))]), masked = matchShots([P(view(A))], [P(view(A, 0.2, 0.25, 2))], { mask });
  assert.ok(masked.score > plain.score, `${plain.score} -> ${masked.score}`);
  assert.ok(Math.abs(masked.scale - 2) < 0.1);
});

test('loopPhase: the crop\'s cycle against the wide one, its period twice the wide\'s', () => {
  const PA = Array.from({ length: 6 }, (_, k) => P(view(world(4, { phase: k, period: 6 }))));
  const PB = Array.from({ length: 12 }, (_, k) => P(view(world(4, { phase: k + 2, period: 6 }), 0.15, 0.2, 1.6)));
  const m = matchShots(PA, PB), r = loopPhase(PA, PB, m);
  assert.equal(r.shift, 2);
  assert.equal(r.ratio, 2);
  assert.ok(r.score > r.runnerUp);
  const L = loopLinks(m, [{ key: 'a1', frames: PA }], [{ key: 'b9', frames: PB }]);
  assert.deepEqual(L.map((x) => [x.a, x.b, x.periodA, x.periodB, x.shift, x.ratio]), [['a1', 'b9', 6, 12, 2, 2]]);
});

test('linkShots: pairs within the gap, cached by key, stops when step says so', async () => {
  const A = world(1), F = [[P(view(A))], [P(view(world(2)))], [P(view(A, 0.2, 0.2, 2))], [P(view(world(3)))], [P(view(world(5)))]];
  const cache = new Map();
  let n = 0;
  const L = await linkShots(F, { cache, step: async () => { n++; return true; } });
  assert.deepEqual([...L.keys()], ['0:2']);
  assert.equal(n, 9, '5 shots, gap 3: 3 + 3 + 2 + 1 pairs');
  await linkShots(F, { cache, step: async () => { n++; return true; } });
  assert.equal(n, 9, 'all cached');
  assert.equal(await linkShots(F, { step: async () => false }), null);
  // paw-o60v.1: the comparison elsewhere (a Worker): an async match gives the same links, cached the same way
  const c2 = new Map(), L2 = await linkShots(F, { cache: c2, match: async (a, b, o) => cropLink(a, b, o) });
  assert.deepEqual([...L2], [...L]);
  assert.deepEqual([...c2], [...cache]);
});

test('printSize keeps the aspect; grey is luma', () => {
  assert.deepEqual(printSize(1280, 720), { w: 128, h: 72 });
  assert.deepEqual(printSize(640, 480), { w: 128, h: 96 });
  assert.ok(Math.abs(grey(Uint8Array.from([255, 255, 255, 255]), 1, 1).d[0] - 1) < 1e-6);
});

// ---- the proposal rules ----
const sc = (n) => Array.from({ length: n }, (_, i) => ({ start_ms: i * 1000, end_ms: (i + 1) * 1000 }));
/** dist from a table of "same" pairs (i last ≈ j first): 0 there, 0.3 elsewhere. */
const distOf = (same = []) => (i, j) => (same.some(([a, b]) => a === i && b === j) ? 0 : 0.3);

test('the owner\'s case: A B A\'(crop of A) B\'(= B) C -> A\' continues A across B; B\' is not proposed across A\'', () => {
  const L = sc(5), dist = distOf([[1, 3]]), crop = (i, j) => (i === 0 && j === 2 ? { scale: 1.97, score: 0.97 } : null);
  assert.deepEqual(proposeSpans(L, null, { dist }).map((p) => [p.a, p.c]), [[1, 3]], 'before: the face shots matched, the crop called a cutaway');
  assert.deepEqual(proposeSpans(L, null, { dist, crop }).map((p) => [p.a, p.c, p.crop?.scale]), [[0, 2, 1.97]]);
  assert.deepEqual(proposeContinues(L, null, { dist, crop }), [2000]);
});

test('a shot that re-frames a shot before the action is never the cutaway', () => {
  const L = sc(4), dist = distOf([[1, 3]]), crop = (i, j) => (i === 0 && j === 2 ? { scale: 2, score: 0.96 } : null);
  L[2] = { ...L[2], continues: false };   // the owner said no to 0 [1] 2
  assert.deepEqual(proposeSpans(L, null, { dist, crop }).map((p) => [p.a, p.c]), [], '2 is the action re-framed: 1 [2] 3 not offered');
  assert.deepEqual(proposeSpans(L, null, { dist }).map((p) => [p.a, p.c]), [[1, 3]], 'without the link it was');
});

test('an insert linked to either side is not an insert; two inserts between a crop pair', () => {
  const L = sc(5), dist = distOf();
  assert.deepEqual(proposeSpans(L, null, { dist, crop: (i, j) => (i === 0 && j === 2 ? {} : i === 1 && j === 2 ? {} : null) }), []);
  const two = proposeSpans(L, null, { dist, crop: (i, j) => (i === 0 && j === 3 ? { scale: 1.5 } : null) });
  assert.deepEqual(two.map((p) => [p.a, p.c]), [[0, 3]]);
  const live = withProposals(L, new Map([[3000, 0]]));
  assert.equal(live[3].continues, 'auto');
  assert.ok(live[1].tags.includes('offscreen') && live[2].tags.includes('offscreen'));
  assert.deepEqual(continuations(live).map((c) => [c.a, c.b0, c.b1, c.c]), [[0, 1, 2, 3]]);
  assert.equal(withProposals(L, new Set([2000]))[1].tags[0], 'offscreen', 'a Set still means one insert');
});

test('cropOffers: "same footage as shot N · crop" on the later shot\'s scene boundary, taken like same footage', () => {
  const L = sc(4), offers = cropOffers(L, [{ a: { start_ms: 0 }, b: { start_ms: 2000 }, scale: 1.97, score: 0.97, tighter: 'b' }]);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].t, 2000);
  assert.match(offers[0].text, /^Same footage as shot 1 · crop ×2\.0/);
  const r = offers[0].run(L);
  assert.equal(r[1].join, true);
  assert.equal(r[2].join, true);
  const joined = L.map((s, k) => (k === 1 || k === 2 ? { ...s, join: true } : s)), none = cropOffers(joined, [{ a: { start_ms: 0 }, b: { start_ms: 2000 }, scale: 2, score: 0.97, tighter: 'b' }]);
  assert.equal(none.length, 0, 'already one scene');
});
