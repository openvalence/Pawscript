// paw-k8jj: the loosen / tighten dial (loosen.js): SAM's candidates and logits first, then edge-aware steps; pure, on generated pictures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeMap, signedDistance } from '../src/features/tracking/snap.js';
import { makeDial, SUBSTEPS, EDGE_PX, TAU_NOTCHES, MIN_FRAC } from '../src/features/tracking/loosen.js';

const W = 160, H = 120, BG = [40, 60, 90], A = [200, 150, 60], LINE = [20, 25, 30];
function frame(shapes) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = [...BG];
    for (const s of shapes) { const t = Math.min(1, Math.max(0, 0.5 - s.d(x + 0.5, y + 0.5) / 1.5)); for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - t) + s.c[k] * t; }
    data.set([c[0], c[1], c[2], 255], 4 * (y * W + x));
  }
  return { w: W, h: H, data };
}
const rect = (x0, y0, x1, y1, c) => ({ d: (x, y) => Math.max(x0 - x, x - x1, y0 - y, y - y1), c });
const box = (x0, y0, x1, y1) => { const a = new Float32Array(W * H); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * W + x] = 1; return a; };
const logits = (a) => { const s = signedDistance(a, W, H), L = new Float32Array(W * H); for (let i = 0; i < L.length; i++) L[i] = Math.max(-12, Math.min(12, -2 * s[i])); return L; };   // > 0 inside, a soft slope at the edge like SAM's
const px = (a) => a.reduce((s, v) => s + (v >= 0.5), 0);

test('SAM range: sub-part -> part -> whole in SUBSTEPS notches each, then the logits shifted; area monotonic, clamped before a flood', () => {
  const cands = [box(60, 50, 80, 70), box(40, 40, 120, 80), box(30, 30, 140, 90)].map((a) => ({ L: logits(a) }));
  const d = makeDial({ cands, k0: SUBSTEPS, w: W, h: H, pos: [[70, 60]] });   // started at the part
  const { lo, hi } = d.range();
  assert.ok(lo <= -SUBSTEPS && hi >= SUBSTEPS, `walks to both neighbours: ${lo} .. ${hi}`);
  let prev = 0;
  for (let p = lo; p <= hi; p++) { const r = d.mask(p, { margin: 0 }); assert.equal(r.mode, 'sam'); assert.equal(r.p, p); const n = px(r.a); assert.ok(n >= prev * 0.999, `area never shrinks as it loosens: p=${p} ${n} < ${prev}`); prev = n; }
  const base = px(d.mask(0, { margin: 0 }).a);
  assert.ok(Math.abs(base - 80 * 40) < 0.05 * 80 * 40, `p = 0 is the part SAM gave: ${base}`);
  assert.ok(px(d.mask(hi, { margin: 0 }).a) <= 8 * base && px(d.mask(hi, { margin: 0 }).a) < 0.5 * W * H, 'no flood');
  assert.ok(px(d.mask(lo, { margin: 0 }).a) >= 12);
  assert.ok(px(d.mask(-SUBSTEPS, { margin: 0 }).a) < 0.5 * base && px(d.mask(SUBSTEPS, { margin: 0 }).a) > 1.2 * base, 'a candidate away is a big move, a notch is a fine one');
  assert.ok(TAU_NOTCHES >= 3);
});

test('past SAM, and for a hand-painted group: edge-aware notches stop at an edge, an unrelated group, and a minimum size', () => {
  const em = edgeMap(frame([rect(20, 30, 130, 90, A)]));   // the part spans x 20..130
  const base = { w: W, h: H, a: box(26, 36, 100, 84) };   // painted 30 px short on the right
  const d = makeDial({ base, w: W, h: H });
  const ctx = { em, margin: 0, radius: 8 };
  assert.deepEqual(d.mask(0, ctx).a, base.a);
  let prev = px(base.a), reached = 0;
  for (let p = 1; p <= 300; p++) { const r = d.mask(p, ctx); assert.equal(r.mode === 'edge' || r.mode === 'base', true); assert.ok(px(r.a) >= prev, 'monotonic'); if (r.p === p) reached = p; prev = px(r.a); }
  assert.ok(reached >= 3, `grows several notches toward the edge: ${reached}`);
  const last = d.mask(300, ctx), xr = (a) => { let x1 = 0; for (let x = 0; x < W; x++) if (a[60 * W + x] >= 0.5) x1 = x; return x1; };
  assert.ok(last.stuck && xr(last.a) <= 130 && xr(last.a) >= 100 + (reached - 1) * EDGE_PX - 3, `stops at the part's edge (130): x = ${xr(last.a)}, p = ${last.p}`);
  const one = d.mask(1, ctx); assert.ok(xr(one.a) - 100 <= EDGE_PX + 1.5, `one notch moves about EDGE_PX: ${xr(one.a)}`);
  // a dark line across the part: never across it
  const em2 = edgeMap(frame([rect(20, 30, 130, 90, A), rect(110, 30, 113, 90, LINE)]));
  const d2 = makeDial({ base, w: W, h: H });
  assert.ok(xr(d2.mask(300, { em: em2, margin: 0, radius: 8 }).a) < 110, 'stopped at the line');
  // another group: never into it
  const other = { w: W, h: H, a: box(110, 0, W, H) };
  const d3 = makeDial({ base, w: W, h: H }), o = d3.mask(300, { em, margin: 0, radius: 8, others: [other] }).a;
  for (let i = 0; i < o.length; i++) if (other.a[i] >= 0.5) assert.equal(o[i], 0);
  // no picture, or nothing that differs from its surroundings: no blind dilation
  assert.equal(makeDial({ base, w: W, h: H }).mask(5, { em: null, margin: 0 }).p, 0);
  // tighter: toward the core, one piece, never under MIN_FRAC
  const t = makeDial({ base, w: W, h: H }), n0 = px(base.a);
  let pv = n0;
  for (let p = -1; p >= -300; p--) { const r = t.mask(p, ctx); assert.ok(px(r.a) <= pv + 3, `monotone within the smoothing noise: ${px(r.a)} after ${pv}`); pv = px(r.a); }
  assert.ok(pv >= MIN_FRAC * n0 - 1 && pv < 0.6 * n0, `shrunk but not to nothing: ${pv} of ${n0}`);
  assert.ok(t.mask(-1, ctx).p === -1);
});

// ---- the SAM stage: the request built for one notch, and which of SAM's answers is the next one
import { dialRequest, chooseLarger, chooseSmaller, insidePoints, outsidePoints, bandPoints, moved, stepOf, GROW_MIN, SPREAD } from '../src/features/tracking/loosen.js';
const dsc = (cx, cy, r) => { const a = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r ? 1 : 0; return a; };

test('looser request: positives, extra positives just outside where the picture still looks like the part (pointer side first), the mask dilated, the box padded', () => {
  const em = edgeMap(frame([rect(20, 30, 130, 90, A)])), cur = box(26, 36, 100, 84), step = stepOf(cur);
  const req = dialRequest(cur, 1, { w: W, h: H, em, ptr: [101, 60], step, pos0: [[60, 60]] });
  assert.deepEqual(req.pos[0], [60, 60]); assert.ok(req.pos.length >= 2 && req.pos.length <= 4, 'extras added: ' + req.pos.length);
  for (const [x, y] of req.pos.slice(1)) assert.ok(x > 100 && x < 100 + 2.6 * step && y >= 36 && y <= 84, `an extra positive just outside the right edge, on the part: ${x},${y}`);
  assert.ok(Math.hypot(req.pos[1][0] - 101, req.pos[1][1] - 60) < Math.hypot(req.pos.at(-1)[0] - 101, req.pos.at(-1)[1] - 60) + 1e-9, 'nearest the pointer first');
  assert.equal(req.neg.length, 0);
  assert.ok(px(req.mask.a) > px(cur) && req.mask.a[60 * W + 100 + Math.floor(step) - 1] === 1, 'the mask prompt is the current mask dilated by a step');
  assert.deepEqual(req.box, [26 - step, 36 - step, 100 + step, 84 + step]);
  // an edge in the way: no extra positive past the dark line; a pointer on the left pulls the extras to the left side
  const em2 = edgeMap(frame([rect(20, 30, 130, 90, A), rect(101, 30, 106, 90, LINE)]));
  assert.equal(outsidePoints(cur, W, H, { em: em2, step, ptr: [101, 60] }).filter(([x]) => x > 101).length, 0, 'not across the line');
  const left = outsidePoints(cur, W, H, { em, step, ptr: [24, 60] });
  assert.ok(left.length >= 1 && left[0][0] < 26, 'pointer near the left edge: the first extra is on the left: ' + JSON.stringify(left[0]));
  assert.equal(outsidePoints(cur, W, H, { em: null, step }).length, 0, 'no picture: no extras');
});

test('tighter request: positives kept, negatives in the outer band nearest the pointer, the mask eroded, the box shrunk', () => {
  const cur = box(26, 36, 100, 84), step = stepOf(cur), pos0 = [[60, 60]];
  const req = dialRequest(cur, -1, { w: W, h: H, ptr: [99, 60], step, pos0 });
  assert.deepEqual(req.pos, pos0); assert.ok(req.neg.length >= 1 && req.neg.length <= 3);
  for (const [x, y] of req.neg) assert.ok(cur[Math.floor(y) * W + Math.floor(x)] === 1 && (x > 100 - 2 * step - 1 || x < 26 + 2 * step + 1 || y < 36 + 2 * step + 1 || y > 84 - 2 * step - 1), 'inside, in the outer band: ' + [x, y]);
  assert.ok(req.neg[0][0] > 90, 'the side the pointer is nearest comes first: ' + req.neg[0]);
  assert.ok(px(req.mask.a) < px(cur) && req.mask.a[60 * W + 100 - 1] === 0, 'eroded');
  assert.deepEqual(req.box, [26 + step, 36 + step, 100 - step, 84 - step]);
  assert.ok(req.neg.every(([x, y]) => Math.hypot(x - 60, y - 60) >= SPREAD), 'never on a positive');
  assert.equal(dialRequest(cur, 1, { w: W, h: H, step }).pos.length, 3, 'no stored prompts: points sampled inside the mask');
  assert.ok(insidePoints(cur, W, H, 3).every(([x, y]) => x > 26 && x < 100 && y > 36 && y < 84));
  void bandPoints; void moved;
});

test('choosing the answer: the next LARGER holds the current mask, is meaningfully bigger, under the flood guard; the next SMALLER keeps the positives and a minimum', () => {
  const cur = dsc(80, 60, 20), c = (r, cx = 80) => ({ a: dsc(cx, 60, r) });
  const cands = [c(17), c(20.5), c(24), c(40), c(10, 30)];
  assert.equal(chooseLarger(cands, cur, { cap: 9000 }), cands[2], 'not the one only 5 % larger, not the one that misses the mask, the SMALLEST of the rest');
  assert.equal(chooseLarger(cands, cur, { cap: 2000 }), cands[2]); assert.equal(chooseLarger([c(40)], cur, { cap: 2000 }), null, 'a flood is no answer');
  assert.ok(px(cands[2].a) >= (1 + GROW_MIN) * px(cur));
  assert.equal(chooseLarger([c(20.3)], cur, { cap: 9000 }), null, 'SAM says nothing new: null (the caller tries a bigger step, then the logits, then stops)');
  const sm = chooseSmaller([c(24), c(18), c(12), c(3)], cur, { w: W, h: H, pos: [[80, 60]], min: 12 });
  assert.ok(px(sm.a) < 0.92 * px(cur) && px(sm.a) >= 12 && px(sm.a) > px(c(12).a), 'the next one down, not the smallest');
  assert.equal(chooseSmaller([c(12, 60)], cur, { w: W, h: H, pos: [[80, 60]], min: 12 }), null, 'a smaller answer that drops a positive point is refused');
  assert.equal(chooseSmaller([c(3)], cur, { w: W, h: H, pos: [[80, 60]], min: 100 }), null, 'never under the minimum size');
});
