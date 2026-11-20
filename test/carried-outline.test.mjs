// paw-rrtw: a pinned group's drawn outline (blobs.js carriedOutline) follows its LIVE members robustly, never sits off them,
// and says when it is unsure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carriedOutline, robustSimilarity } from '../src/features/tracking/blobs.js';

const S = 4, A = 16 / 9;
const poly = [[0.3, 0.3], [0.5, 0.3], [0.5, 0.6], [0.3, 0.6]];
const seed = Array.from({ length: 10 }, (_, k) => [0.33 + 0.035 * (k % 5), 0.36 + 0.18 * Math.floor(k / 5)]);   // two rows inside the painting
const move = ([x, y]) => [x + 0.2, y - 0.05];
// frames 0 (seed, t 0) and 1: members [x, y, visible, group 0, part 0, sem S]
const run = (now) => ({ t: [0, 40], ov: [{ pts: seed.map(([x, y]) => [x, y, 1, 0, 0, S]) }, { pts: now }] });
const near = (P, Q, tol = 1e-6) => P.every((p, k) => Math.hypot(p[0] - Q[k][0], p[1] - Q[k][1]) < tol);
const cen = (P) => P.reduce((a, p) => [a[0] + p[0] / P.length, a[1] + p[1] / P.length], [0, 0]);

test('all members moved together: the painting moved with them, sure', () => {
  const o = carriedOutline(run(seed.map((p) => [...move(p), 1, 0, 0, S])), 1, S, poly, 0, A);
  assert.equal(o.sure, true);
  assert.ok(near(o.poly, poly.map(move)));
});

test('half the members dead and one flown off: on the survivors, unsure', () => {
  const now = seed.map((p, k) => (k % 2 ? [p[0], p[1], 0, 0, 0, S] : k === 4 ? [0.95, 0.9, 1, 0, 0, S] : [...move(p), 1, 0, 0, S]));
  const o = carriedOutline(run(now), 1, S, poly, 0, A);
  assert.ok(near(o.poly, poly.map(move), 1e-3), 'the four that agree carry it: ' + JSON.stringify(o.poly));
  assert.equal(o.sure, false);
  assert.match(o.why, /of its 10 seeded points left/);
});

test('four of ten pairs wrong (slots re-seeded elsewhere): the least-median fit keeps the six', () => {
  const B = seed.map((p, k) => (k < 4 ? [0.1 + 0.05 * k, 0.9 - 0.1 * k] : move(p)));
  const m = robustSimilarity(seed, B, A);
  assert.equal(m.inl, 6);
  assert.ok(near(poly.map(m.f), poly.map(move), 1e-6));
});

test('never off its members: a painting that would hold under half of them gives way to their own hull, unsure', () => {
  // the paired members say "moved right", but most live members (new ones, not on the seed frame) are elsewhere
  const now = [...seed.slice(0, 4).map((p) => [...move(p), 1, 0, 0, S]), ...seed.slice(4).map((p) => [p[0], p[1], 0, 0, 0, S]), ...Array.from({ length: 8 }, (_, k) => [0.1 + 0.01 * k, 0.8 + 0.01 * (k % 3), 1, 0, 0, S])];
  const o = carriedOutline(run(now), 1, S, poly, 0, A);
  assert.equal(o.sure, false);
  assert.match(o.why, /their own outline/);
  const live = now.filter((p) => p[2]), c = cen(o.poly), lc = cen(live);
  assert.ok(Math.hypot(c[0] - lc[0], c[1] - lc[1]) < 0.15, 'drawn round the live members');
});

test('no live members: nothing drawn', () => {
  assert.equal(carriedOutline(run(seed.map(([x, y]) => [x, y, 0, 0, 0, S])), 1, S, poly, 0, A), null);
});
