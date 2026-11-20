// paw-bz1t: the tracker view (blobs.js) made cheap without changing what it draws. The robust outline fit picks its
// median by selection now (was a comparator sort + Math.hypot: ~90 % of a frame's bodies at 4096 points): the same fit as
// the old code on random pairs with outliers; the dots' scratch-layer box. Pixels old / new: dev/perf/blobs-window.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kth, deviceBox, robustSimilarity, OUT_HYP } from '../src/features/tracking/blobs.js';

let seed = 3;
const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };

test('kth: the k-th smallest, as sorting gives it (duplicates included)', () => {
  for (let t = 0; t < 3000; t++) {
    const n = 1 + Math.floor(rnd() * 70), a = Float64Array.from({ length: n }, () => Math.floor(rnd() * (t % 2 ? 1000 : 4))), s = a.slice().sort(), k = Math.floor(rnd() * n);
    assert.equal(kth(a.slice(), n, k), s[k]);
  }
});

// the fit as it was before paw-bz1t (comparator sort of Math.hypot residuals)
function oldFit(A, B, aspect = 1) {
  const n = A.length;
  if (n < 2) return null;
  const X = (p) => [p[0] * aspect, p[1]], a2 = A.map(X), b2 = B.map(X);
  const lsq = (I) => {
    let ax = 0, ay = 0, bx = 0, by = 0;
    for (const k of I) { ax += a2[k][0]; ay += a2[k][1]; bx += b2[k][0]; by += b2[k][1]; }
    ax /= I.length; ay /= I.length; bx /= I.length; by /= I.length;
    let re = 0, im = 0, den = 0;
    for (const k of I) { const p = a2[k][0] - ax, q = a2[k][1] - ay, u = b2[k][0] - bx, v = b2[k][1] - by; re += p * u + q * v; im += p * v - q * u; den += p * p + q * q; }
    return den > 0 ? { a: re / den, b: im / den, ax, ay, bx, by } : null;
  };
  const res = (m, k) => { const p = a2[k][0] - m.ax, q = a2[k][1] - m.ay; return Math.hypot(m.a * p - m.b * q + m.bx - b2[k][0], m.b * p + m.a * q + m.by - b2[k][1]); };
  const med = (m, h, l) => { const r = []; for (let k = 0; k < n; k++) if (k !== h && k !== l) r.push(res(m, k)); r.sort((x, y) => x - y); return r.length ? r[(r.length - 1) >> 1] : 0; };
  const all = n * (n - 1) / 2, stride = Math.max(1, Math.floor(all / OUT_HYP));
  let best = null, bm = Infinity, c = 0;
  for (let h = 0, e = 0; h < n; h++) for (let l = h + 1; l < n; l++, e++) {
    if (e % stride || c >= OUT_HYP) continue;
    c++;
    const m = lsq([h, l]);
    if (!m) continue;
    const r = med(m, h, l);
    if (r < bm) { bm = r; best = m; }
  }
  if (!best) return null;
  const lim = Math.max(3 * bm, 0.004), I = [];
  for (let k = 0; k < n; k++) if (res(best, k) <= lim) I.push(k);
  const m = (I.length >= 2 && lsq(I)) || best;
  return { f: ([x, y]) => { const p = x * aspect - m.ax, q = y - m.ay; return [(m.a * p - m.b * q + m.bx) / aspect, m.b * p + m.a * q + m.by]; }, n, inl: I.length, scale: Math.hypot(m.a, m.b) };
}

test('robustSimilarity: the same fit as before the speed-up (members that agree, a few strays)', () => {
  for (let t = 0; t < 400; t++) {
    const n = 3 + Math.floor(rnd() * 220), th = rnd() - 0.5, sc = 0.8 + 0.4 * rnd(), dx = 0.1 * (rnd() - 0.5), dy = 0.1 * (rnd() - 0.5);
    const A = Array.from({ length: n }, () => [0.3 + 0.2 * rnd(), 0.3 + 0.3 * rnd()]);
    const B = A.map(([x, y]) => (rnd() < 0.15 ? [rnd(), rnd()] : [sc * (Math.cos(th) * x - Math.sin(th) * y) + dx + 0.002 * rnd(), sc * (Math.sin(th) * x + Math.cos(th) * y) + dy + 0.002 * rnd()]));
    const o = oldFit(A, B, 16 / 9), m = robustSimilarity(A, B, 16 / 9);
    assert.equal(m.inl, o.inl, 'the same pairs agree');
    assert.ok(Math.abs(m.scale - o.scale) < 1e-12);
    for (const p of [[0.3, 0.3], [0.5, 0.6], [0.1, 0.9]]) { const [a, b] = m.f(p), [c, d] = o.f(p); assert.ok(Math.abs(a - c) < 1e-12 && Math.abs(b - d) < 1e-12, `${a},${b} vs ${c},${d}`); }
  }
});

test('deviceBox: the dots\' scratch box, whole device pixels, padded, inside the canvas', () => {
  const T = { a: 1.5, d: 1.5, e: 0, f: 0 };
  assert.deepEqual(deviceBox(new Float64Array([10, 20, 30, 40]), 2, T, 1000, 1000), [12, 27, 36, 36]);
  assert.deepEqual(deviceBox(new Float64Array([-50, -50, 5, 5]), 2, T, 1000, 1000), [0, 0, 11, 11], 'clipped to the canvas');
  assert.equal(deviceBox(new Float64Array([2000, 2000]), 2, T, 1000, 1000), null, 'nothing inside');
});
