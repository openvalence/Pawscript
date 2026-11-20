import assert from 'node:assert/strict';
import { clampView, zoomAt, panBy, xToMs, msToX, followView, lowerBound, visibleSlice, envelope, tickStep, drawLane, markLabels } from '../src/lib/lane.js';
import { budget } from './perf.mjs';

const D = 60000;
assert.deepEqual(clampView({ start: -5, span: 1e9 }, D), { start: -5, span: D });   // paw-g56v: up to half a view past either end
assert.deepEqual(clampView({ start: -1e9, span: 1e9 }, D), { start: -D / 2, span: D });
assert.deepEqual(clampView({ start: 59000, span: 5000 }, D), { start: 57500, span: 5000 });
assert.deepEqual(clampView({ start: -9000, span: 5000 }, D), { start: -2500, span: 5000 });
assert.equal(clampView({ start: 0, span: 1 }, D).span, 200);

// zoom keeps the anchor under the cursor
let v = { start: 10000, span: 20000 };
const z = zoomAt(v, 15000, 0.5, D);
assert.equal(z.span, 10000);
assert.ok(Math.abs((15000 - z.start) / z.span - 0.25) < 1e-9);
assert.equal(zoomAt({ start: 0, span: D }, 30000, 2, D).span, D);   // cannot zoom out past the video
assert.deepEqual(zoomAt({ start: 1000, span: 10000 }, 2000, 100, D), { start: 0, span: D });   // a view inside the video zooms out to exactly 0..end
assert.deepEqual(zoomAt({ start: 58000, span: 4000 }, 61000, 1.5, D), { start: 56000, span: 6000 });   // zooming out never shows more out-of-range
assert.ok(zoomAt({ start: -2000, span: 4000 }, 0, 0.5, D).start === -1000);   // zooming in on time 0 mid-view keeps it there

// pan: dragging right moves the view earlier; clamped
assert.equal(panBy({ start: 10000, span: 10000 }, 100, 1000, D).start, 9000);
assert.equal(panBy({ start: 500, span: 10000 }, 100, 1000, D).start, -500);
assert.equal(panBy({ start: 500, span: 10000 }, 900, 1000, D).start, -5000);   // time 0 at most mid-view
assert.equal(xToMs({ start: 1000, span: 2000 }, 400, 200), 2000);
assert.equal(msToX({ start: 1000, span: 2000 }, 400, 2000), 200);
assert.equal(followView({ start: 0, span: 1000 }, 500, D).start, 0);
assert.equal(followView({ start: 0, span: 1000 }, 5000, D).start, 4900);
assert.equal(followView({ start: 5000, span: 1000 }, 50, D).start, 0);   // following never pans into the out-of-range
assert.equal(followView({ start: 5000, span: 1000 }, 59990, D).start, 59000);

// slices
const t = Float64Array.from({ length: 100000 }, (_, i) => i * 10);   // 100k samples over 1000 s
assert.equal(lowerBound(t, 55), 6);
assert.deepEqual(visibleSlice(t, 1000, 2000), [99, 201]);
assert.deepEqual(visibleSlice(t, -500, 5), [0, 2]);
assert.deepEqual(visibleSlice([], 0, 1), [0, 0]);

// envelope
const vals = Float32Array.from(t, (_, i) => (i % 2 ? 1 : 0));
const e = envelope(t, vals, 0, 1000, { start: 0, span: 10000 }, 100);   // 10 samples per column
assert.equal(e.min[0], 0); assert.equal(e.max[0], 1);
const gap = envelope([0, 10], [NaN, NaN], 0, 2, { start: 0, span: 100 }, 10);
assert.ok(Number.isNaN(gap.min[0]));

assert.ok(tickStep(10000, 1000) >= 800 && tickStep(10000, 1000) <= 1000);

// renderer: 100k samples through a recording context; only the visible slice is touched
let calls = 0;
const ctx = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => { calls++; }), set: () => true });
const layer = { color: '#fff', t, v: vals, pat: [], ppos: [] };
const t0 = performance.now();
for (let i = 0; i < 20; i++) drawLane(ctx, 1200, 200, { start: 500000, span: 60000 }, [layer, { ...layer, color: '#f0f' }], { playhead: 510000, range: { start: 500000, end: 520000 } });
const ms = (performance.now() - t0) / 20;
budget(ms < 20, 'frame took ' + ms.toFixed(1) + ' ms');
// zoomed out over all 100k samples: column envelope keeps path ops ~ width, not samples
calls = 0;
drawLane(ctx, 1200, 200, { start: 0, span: 1000000 }, [layer], { playhead: 0, range: null });
assert.ok(calls < 5000, 'ops ' + calls);
// gaps: NaN breaks the polyline (no lineTo across a null run), marks and confidence draw without error
const ops = [];
const rec = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 0 }) : (...a) => { ops.push([k, a]); }), set: () => true });
drawLane(rec, 100, 100, { start: 0, span: 100 }, [{ color: '#fff', t: [0, 10, 20, 30, 40], v: [0, 0.5, NaN, 0.5, 1] }], { playhead: 0, range: null });
const names = ops.map((x) => x[0]);
const lanePath = ops.filter((x) => x[0] === 'moveTo' || x[0] === 'lineTo').slice(-4).map((x) => x[0]);
assert.deepEqual(lanePath, ['moveTo', 'lineTo', 'moveTo', 'lineTo']);   // two segments, none over the gap
ops.length = 0;
drawLane(rec, 100, 100, { start: 0, span: 100 }, [], { playhead: 0, range: null, marks: [{ t: 10, label: 'c1' }, { t: 500, label: 'off' }], confidence: { t: [0, 50], v: [1, 0.2], color: '#fff' } });
assert.ok(ops.some((x) => x[0] === 'fillText' && x[1][0] === 'c1') && !ops.some((x) => x[0] === 'fillText' && x[1][0] === 'off'));
assert.ok(ops.filter((x) => x[0] === 'fillRect').length >= 3);
console.log('lane ok (frame ' + ms.toFixed(2) + ' ms)');

{   // paw-bg90: mark labels are thinned by their own width, a forced one (the selected run's seed) always shows
  const ctx = { font: '10px mono', measureText: (s) => ({ width: s.length * 6 }) };
  const marks = [{ t: 0, label: 'seed (forward)' }, { t: 50, label: 'seed' }, { t: 100, label: 'climax' }, { t: 60, label: 'seed (backward)', force: true }];
  const got = markLabels(ctx, marks, (t) => t).map(([m, , on]) => [m.label, on]);
  // 'seed (forward)' at 3..87 overlaps the forced one at 63..153 and 'seed' at 53..77; 'climax' at 103 overlaps the forced one too
  assert.deepEqual(got, [['seed (forward)', false], ['seed', false], ['climax', false], ['seed (backward)', true]]);
  const apart = markLabels(ctx, [{ t: 0, label: 'seed' }, { t: 40, label: 'seed' }, { t: 80, label: 'x' }], (t) => t).map(([, , on]) => on);
  assert.deepEqual(apart, [true, true, true], '"seed" is 24 px: 40 px apart both show (the old fixed 44 px gap hid the second)');
}
