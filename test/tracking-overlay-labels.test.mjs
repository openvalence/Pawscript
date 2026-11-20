// The blobs overlay's labels on a dense scene (owner 2026-11-09, "kinda hard to see"): de-collided plates inside the
// picture, short by default, the primary's value on its own thing's label, everything in full in detail mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBlobsView, blobOpts } from '../src/features/tracking/blobs.js';
import { series, channelOf } from '../src/lib/runs.js';

// a crowded frame: four bodies and four pinned groups packed into the middle third, a camera, a pair, a primary
function dense() {
  const pts = [], cl = (cx, cy, n, f) => { for (let k = 0; k < n; k++) pts.push(f(cx + 0.04 * Math.cos(k), cy + 0.04 * Math.sin(k * 1.3))); };
  [[0.45, 0.4], [0.55, 0.42], [0.5, 0.55], [0.4, 0.6]].forEach(([x, y], g) => cl(x, y, 12, (a, b) => [a, b, 1, g + 1]));
  [[0.5, 0.35], [0.5, 0.45], [0.47, 0.5], [0.55, 0.6]].forEach(([x, y], s) => cl(x, y, 10, (a, b) => [a, b, 1, -1, 0, s + 4]));
  const fr = { t: [0, 33, 67], v: [0, 0, 0], ov: [{ pts }, { pts }, { pts }] }, ch = (v) => channelOf([[0, v], [33, v], [67, v]]);
  const groups = {}, channels = { cam_x: ch(0), cam_y: ch(0), cam_conf: ch(0.04), pair_dist: ch(0.3) };
  ['c1_tail', 'c1_hips', 'c1_balls', 'c2_balls'].forEach((n, k) => { groups['sem_' + n] = { label: n, source: 'user', id: k + 4 }; channels[`sem_${n}_proj`] = ch(0.5); channels[`sem_${n}_fit`] = ch(k === 3 ? 0.4 : 0.9); });
  const run = { name: 'r', params: { primary: 'sem_c1_hips_proj' }, samples: series([[0, 0.15], [33, 0.15], [67, 0.15]]), notes: [],
    scenes: [{ start_ms: 0, end_ms: 100, groups, camera: [{ t0: 0, t1: 100, kind: 'handheld' }] }], channels };
  return { fr, run };
}
const ctxOf = (texts) => new Proxy({ measureText: (s) => ({ width: s.length * 6.5 }) }, { get: (o, k) => (k in o ? o[k] : k === 'fillText' ? (s) => texts.push(s) : () => {}), set: (o, k, v) => { o[k] = v; return true; } });

test('blobs labels on a dense scene: no two plates overlap, all inside the picture, short by default', () => {
  const { fr, run } = dense(), texts = [];
  const env = { map: (x, y) => [20 + x * 800, 10 + y * 560] };
  const draw = (opts) => drawBlobsView(ctxOf(texts), env, fr, 1, { colors: ['a', 'b', 'c', 'd', 'e'], ink: { text: 'w', axis: 'o', pair: 'p', grid: 'g' }, opts, run, aspect: 1.43 });
  const F = draw({ ...blobOpts((k, d) => d), heat: false });
  const L = F.labels;
  assert.ok(L.length >= 6, L.length);
  for (const a of L) {
    assert.ok(a.x >= 20 && a.y >= 10 && a.x + a.w <= 820 && a.y + a.h <= 570, 'inside the picture');
    for (const b of L) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${JSON.stringify(a.key)} overlaps ${JSON.stringify(b.key)}`);
  }
  assert.ok(texts.includes('Bottom hips · primary 0.15'), texts.join('|'));   // one label for the primary's thing
  assert.ok(texts.includes('Top balls · fit 40%') && texts.includes('Bottom tail'), 'a low rigid fit shows even when short');
  assert.ok(!texts.some((s) => /^primary ·/.test(s)), 'no separate primary tag for a pinned group');
  texts.length = 0;
  draw({ ...blobOpts((k, d) => d), heat: false, detail: true });
  assert.ok(texts.some((s) => /^Bottom tail · 10 pts · fit 90%$/.test(s)), texts.join('|'));   // detail (Alt): everything in full
});
