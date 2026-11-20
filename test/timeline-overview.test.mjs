import assert from 'node:assert/strict';
import test from 'node:test';
import { brushRect, brushHit, brushDrag, brushWheel, centerOn, diffWindow, HeatBins } from '../src/features/timeline/overview.js';
import { replaceRange, normalize } from '../src/lib/core/script.js';

test('brush maths', () => {
  const v = { start: 10000, span: 20000 }, D = 100000, W = 1000;
  assert.deepEqual(brushRect(v, D, W), { x0: 100, x1: 300 });
  const tiny = brushRect({ start: 50000, span: 200 }, D, W);
  assert.equal(tiny.x1 - tiny.x0, 6);
  assert.equal(brushHit(102, brushRect(v, D, W)), 'left');
  assert.equal(brushHit(200, brushRect(v, D, W)), 'body');
  assert.equal(brushHit(299, brushRect(v, D, W)), 'right');
  assert.equal(brushHit(500, brushRect(v, D, W)), null);
  assert.deepEqual(brushDrag('body', v, 200, 250, W, D), { start: 15000, span: 20000 });
  assert.deepEqual(brushDrag('body', v, 200, 0, W, D), { start: -10000, span: 20000 });   // paw-g56v: half a view past the start
  assert.deepEqual(brushDrag('left', v, 100, 50, W, D), { start: 5000, span: 25000 });
  assert.deepEqual(brushDrag('right', v, 300, 400, W, D), { start: 10000, span: 30000 });
  assert.deepEqual(brushDrag('right', v, 300, 0, W, D), { start: 10000, span: 200 });
  assert.deepEqual(brushDrag('new', v, 600, 500, W, D), { start: 50000, span: 10000 });
  const z = brushWheel(v, 20000, -500, D);
  assert.ok(z.span < v.span && z.start > v.start);
  assert.deepEqual(centerOn(v, 95000, D), { start: 85000, span: 20000 });
  assert.deepEqual(centerOn(v, 100000, D), { start: 90000, span: 20000 });   // the end mid-view
  assert.deepEqual(brushRect({ start: -10000, span: 20000 }, D, W), { x0: 0, x1: 100 });   // only the part inside the video
});

// reference: straightforward full computation
function fullBins(script, dur, binMs) {
  const n = Math.ceil(dur / binMs), mean = new Float64Array(n), peak = new Float64Array(n);
  for (let j = 1; j < script.length; j++) {
    const a = script[j - 1], b = script[j], v = (Math.abs(b.pos - a.pos) * 1000) / (b.at - a.at);
    for (let k = 0; k < n; k++) {
      const ov = Math.min(b.at, (k + 1) * binMs) - Math.max(a.at, k * binMs);
      if (ov > 0) { mean[k] += (v * ov) / binMs; peak[k] = Math.max(peak[k], v); }
    }
  }
  return { mean, peak };
}
function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); }
const randScript = (r, n, dur) => normalize(Array.from({ length: n }, () => ({ at: Math.floor(r() * dur), pos: Math.floor(r() * 101) })));

test('heat bins: incremental updates equal a full rebuild', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed), dur = 30000;
    const H = new HeatBins(600);
    let s = randScript(r, 200, dur);
    H.update(s, dur);
    for (let e = 0; e < 15; e++) {
      const t0 = Math.floor(r() * dur), t1 = t0 + Math.floor(r() * 4000);
      const op = r();
      s = op < 0.4 ? replaceRange(s, t0, t1, randScript(r, 8, 4000).map((a) => ({ at: t0 + a.at % Math.max(1, t1 - t0 + 1), pos: a.pos })))
        : op < 0.7 ? s.filter((a) => a.at < t0 || a.at > t1)
        : normalize([...s, { at: Math.floor(r() * dur), pos: Math.floor(r() * 101) }]);
      H.update(s, dur);
      const ref = fullBins(s, H.dur, H.binMs);
      for (let k = 0; k < H.n; k++) {
        assert.ok(Math.abs(H.mean[k] - ref.mean[k]) < 1e-2 * (1 + ref.mean[k]), `seed ${seed} edit ${e} bin ${k}: ${H.mean[k]} vs ${ref.mean[k]}`);
        assert.ok(Math.abs(H.peak[k] - ref.peak[k]) < 1e-2 * (1 + ref.peak[k]), `seed ${seed} edit ${e} bin ${k} peak`);
      }
    }
  }
  assert.equal(diffWindow([{ at: 1, pos: 2 }], [{ at: 1, pos: 2 }]), null);
  assert.deepEqual(diffWindow([{ at: 1, pos: 2 }, { at: 5, pos: 0 }], [{ at: 1, pos: 2 }, { at: 3, pos: 9 }, { at: 5, pos: 0 }]), { i: 1, ja: 0, jb: 1 });
});

test('heat bins at 100 000 actions: one-point edit is cheap and touches few bins', () => {
  const s = Array.from({ length: 100000 }, (_, i) => ({ at: i * 100, pos: i % 2 ? 90 : 10 }));
  const H = new HeatBins();
  let t = performance.now();
  H.update(s, 10000000);
  const full = performance.now() - t;
  const s2 = s.slice(); s2[50000] = { at: 5000000, pos: 50 };
  t = performance.now();
  const ch = H.update(s2, 10000000);
  const inc = performance.now() - t;
  assert.ok(ch[1] - ch[0] <= 2, `rebuilt ${ch}`);
  const cols = H.columns(1500);
  assert.equal(cols.mean.length, 1500);
  assert.ok(Math.abs(cols.mean[10] - 800) < 1, `mean ${cols.mean[10]}`);   // 80 pos per 100 ms = 800 pos/s
  console.log(`heat bins 100k: full ${full.toFixed(2)} ms, one-point edit ${inc.toFixed(2)} ms`);
});

import { pressKind, bands, heatImage, markerColumns } from '../src/features/timeline/overview.js';

test('press kind: outside or a full-width brush draws a new view', () => {
  const W = 1000;
  assert.equal(pressKind(500, { x0: 100, x1: 300 }, W), 'new');
  assert.equal(pressKind(200, { x0: 100, x1: 300 }, W), 'body');
  assert.equal(pressKind(101, { x0: 100, x1: 300 }, W), 'left');
  assert.equal(pressKind(500, { x0: 0, x1: 1000 }, W), 'new');
  assert.equal(pressKind(998, { x0: 0, x1: 1000 }, W), 'right');
});

test('bands tile the strip from 32 to 80 px', () => {
  for (let h = 32; h <= 80; h++) {
    const b = bands(h);
    assert.ok(b.heat.h >= 18, `heat ${h}`);
    assert.equal(b.chap.y + b.chap.h + 1, b.heat.y);
    assert.equal(b.heat.y + b.heat.h + 1, b.plan.y);
    assert.equal(b.plan.y + b.plan.h + 1, b.marks.y);
    assert.equal(b.marks.y + b.marks.h, h);
  }
});

test('heat image: bar height follows speed, silence is bg, all opaque', () => {
  const lut = Array.from({ length: 256 }, (_, i) => [i, 0, 0]), bg = [4, 5, 7];
  const img = heatImage(Float32Array.from([0, 200, 400, 800]), 4, 10, lut, 400, bg, undefined, 0.14, 1);
  const px = (c, y) => Array.from(img.slice((y * 4 + c) * 4, (y * 4 + c) * 4 + 4));
  assert.deepEqual(px(0, 0), [4, 5, 7, 255]);
  assert.deepEqual(px(0, 9), [4, 5, 7, 255]);
  assert.deepEqual(px(1, 9), [128, 0, 0, 255]);   // half speed: lower half solid
  assert.deepEqual(px(1, 5), [128, 0, 0, 255]);
  assert.notDeepEqual(px(1, 4), [128, 0, 0, 255]); // above it: dimmed
  assert.deepEqual(px(2, 0), [255, 0, 0, 255]);   // at max: full height
  assert.deepEqual(px(3, 0), [255, 0, 0, 255]);   // past max: clamped
});

test('marker columns: worst severity per column, filtered by axis', () => {
  const items = [
    { axis: 'stroke', t0: 100, t1: 100, severity: 'info' },
    { axis: 'stroke', t0: 100, t1: 300, severity: 'error' },
    { axis: 'roll', t0: 500, t1: 600, severity: 'error' },
    { axis: 'stroke', t0: 900, t1: 990, severity: 'warn' },
  ];
  const m = markerColumns(items, 'stroke', 1000, 10);
  assert.deepEqual(Array.from(m), [0, 3, 3, 0, 0, 0, 0, 0, 0, 2]);
});

test('columns over a shorter duration than the bins', () => {
  const s = [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, { at: 3000, pos: 100 }];
  const H = new HeatBins(300);
  H.update(s, 3000);
  const c = H.columns(2, undefined, undefined, 2000);
  assert.ok(Math.abs(c.mean[0] - 100) < 1 && c.mean[1] < 1, `${c.mean}`);
});

test('heat image headroom: past the limit is taller, same top colour', () => {
  const lut = Array.from({ length: 256 }, (_, i) => [i, 0, 0]), bg = [0, 0, 0];
  const img = heatImage(Float32Array.from([400, 800]), 2, 10, lut, 400, bg, undefined, 0.14, 2);
  const px = (c, y) => Array.from(img.slice((y * 2 + c) * 4, (y * 2 + c) * 4 + 4));
  assert.deepEqual(px(0, 5), [255, 0, 0, 255]);
  assert.notDeepEqual(px(0, 4), [255, 0, 0, 255]);
  assert.deepEqual(px(1, 0), [255, 0, 0, 255]);
});
