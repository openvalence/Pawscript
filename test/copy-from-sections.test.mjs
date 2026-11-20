// paw-k5kw: "Copy from…" with a move (crop / likeness / carried / re-found) moved the mask but left the penis' knot section and the
// group's erase record where they were: the knot outside its mask (Track sent knot outlines at the old place), the erase record
// cutting strokes at the old place. They move with the mask, as G / S move them (groups.svelte.js endXf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveGroups, refitGroups, sourceGroups } from '../src/features/tracking/copy-from.js';
import { encodeMask, knotOf, erasedOf, maskOf } from '../src/features/tracking/groups.js';

const W = 64, H = 36, size = { w: W, h: H };
const disc = (cx, cy, r) => { const a = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) a[y * W + x] = 1; return a; };
const pen = disc(16, 18, 6), knot = disc(18, 18, 2), er = disc(13, 18, 2);
const g = { name: 'c1 penis', t_ms: 1000, source: 'user', poly: [[0.1, 0.3], [0.4, 0.3], [0.4, 0.7], [0.1, 0.7]], mask: encodeMask({ w: W, h: H, a: pen }), knot: encodeMask({ w: W, h: H, a: knot }), erased: encodeMask({ w: W, h: H, a: er }) };
const cen = (a) => { let sx = 0, n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= 0.5) { sx += i % W; n++; } return n ? sx / n : null; };
const outside = (sec, m) => { let out = 0; for (let i = 0; i < sec.length; i++) if (sec[i] >= 0.5 && !(m[i] >= 0.5)) out++; return out; };
const mf = (x) => maskOf(x, size);

test('paw-k5kw: moveGroups moves the knot section and the erase record with the mask', () => {
  const [c] = moveGroups([g], { s: 1, dx: 0.4, dy: 0 }, 2000, mf);
  const m = mf(c).a, k = knotOf(c, size), e = erasedOf(c, size);
  const shift = cen(m) - cen(pen);
  assert.ok(shift > 20, `the mask moved (${shift.toFixed(1)} px)`);
  assert.ok(k && Math.abs(cen(k) - cen(knot) - shift) < 1.5, `the knot moved with it (${cen(knot)} -> ${k && cen(k)})`);
  assert.equal(outside(k, m), 0, 'the knot stays inside its mask');
  assert.ok(e && Math.abs(cen(e) - cen(er) - shift) < 1.5, `the erase record moved with it (${cen(er)} -> ${e && cen(e)})`);
});

test('paw-k5kw: a scaled move scales the knot about the same centre; the identity keeps the group as it is', () => {
  const [c] = moveGroups([g], { s: 1.5, dx: 0.1, dy: 0 }, 2000, mf);
  assert.equal(outside(knotOf(c, size), mf(c).a), 0);
  const [same] = moveGroups([g], { s: 1, dx: 0, dy: 0 }, 2000, mf);
  assert.equal(same.knot, g.knot);
  assert.equal(same.erased, g.erased);
});

test('paw-k5kw: refitGroups (a re-found copy) moves the sections too', () => {
  const [c] = moveGroups([g], { s: 1, dx: 0.1, dy: 0 }, 2000, mf);
  const [r] = refitGroups([c], [{ prior: c.name, poly: [[0.43, 0.4], [0.47, 0.4], [0.47, 0.6], [0.43, 0.6]] }], size, mf);
  const rm = mf(r).a;
  assert.equal(r.lined, 'refound');
  assert.ok(cen(rm) - cen(mf(c).a) > 5, 'the mask moved to the re-found place');
  assert.equal(outside(knotOf(r, size), rm), 0, 'the knot went with it');
});

test('paw-k5kw: a carried group (sourceGroups) takes its sections along', () => {
  const pts = (x) => [[x, 0.5], [x + 0.01, 0.5]];
  const c = { kind: 'run', t: 3000, seeds: { 'c1 penis': pts(0.55) }, carry: { groups: [g], at: { 'c1 penis': pts(0.25) } } };
  const [s] = sourceGroups(c, size, mf);
  const m = mf(s).a;
  assert.ok(cen(m) - cen(pen) > 15, 'the mask moved by the points\' shift');
  assert.equal(outside(knotOf(s, size), m), 0);
  assert.ok(Math.abs(cen(erasedOf(s, size)) - cen(er) - (cen(m) - cen(pen))) < 1.5);
});
