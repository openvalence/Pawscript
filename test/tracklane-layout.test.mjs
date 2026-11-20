// paw-unuy: the Track tab's combined lane (the stroke lane is the tracker lane): its pure helpers and the bare tracker layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { seedHit, spanItems } from '../src/features/tracking/lane-layout.js';
import { drawLane } from '../src/lib/lane.js';
import { posToY } from '../src/features/lanes/geom.js';

registerHooks({ load: (url, ctx, next) => (url.startsWith('file:') && url.endsWith('.svelte') ? { format: 'module', shortCircuit: true, source: 'export default function Stub() {}' } : next(url, ctx)) });
const { default: laneRow } = await import('../src/features/tracking/lane.js');

test('a seed mark is hit by its label row only: the rest of the lane stays the lane\'s', () => {
  const marks = [{ t: 1000 }, { t: 5000 }], X = (t) => t / 10;
  assert.equal(seedHit(marks, 102, 20, X)?.t, 1000, 'within 4 px of its line, in the label row');
  assert.equal(seedHit(marks, 102, 60, X), null, 'below the label row: the lane (a point, a box select, seek)');
  assert.equal(seedHit(marks, 110, 20, X), null, 'too far from the line');
  assert.equal(seedHit(marks, 498, 5, X, { maxY: 10 })?.t, 5000);
});

test('the span labels\' ranges are the lane\'s right-click there (no strip of their own)', () => {
  const spans = [{ start_ms: 0, end_ms: 4000, state: 'active' }, { start_ms: 4000, end_ms: 9000, state: 'idle' }];
  let got = null;
  const it = spanItems(spans, 5000, (a, b) => (got = [a, b]));
  assert.equal(it.length, 1);
  assert.match(it[0].label, /idle span/);
  it[0].run();
  assert.deepEqual(got, [4000, 9000]);
  assert.deepEqual(spanItems(spans, 9500, () => {}), []);
  assert.deepEqual(spanItems(null, 0, () => {}), []);
});

/** A 2D context that records what is drawn. */
function recorder() {
  const log = [];
  const ctx = new Proxy({ log }, { get: (o, k) => (k in o ? o[k] : (...a) => log.push([k, ...a])), set: (o, k, v) => { o[k] = v; return true; } });
  return { ctx, log };
}

test('the tracker layer on the combined lane is bare (no background, grid or playhead) and uses the lane\'s pos -> y', () => {
  const view = { start: 0, span: 1000 }, w = 100, h = 200;
  const layers = [{ color: '#f00', t: [0, 500, 1000], v: [0, 1, 0] }];
  const own = recorder();
  drawLane(own.ctx, w, h, view, layers, { dur: 1000, playhead: 500 });
  assert.ok(own.log.some(([k, x, y, ww, hh]) => k === 'fillRect' && x === 0 && y === 0 && ww === w && hh === h), 'the Tracker row paints its background');
  const bare = recorder();
  const Y = (x) => posToY(h, x * 100);
  drawLane(bare.ctx, w, h, view, layers, { dur: 1000, playhead: 500, bare: true, y: Y });
  assert.ok(!bare.log.some(([k, , , ww, hh]) => k === 'fillRect' && ww === w && hh === h), 'no background over the lane');
  assert.ok(!bare.log.some(([k, x, , ww]) => k === 'fillRect' && ww === 1 && x === 50), 'no second playhead (the lane draws its own)');
  const pts = bare.log.filter(([k]) => k === 'moveTo' || k === 'lineTo').map(([, x, y]) => [x, y]);
  assert.deepEqual(pts, [[0, Y(0)], [50, Y(1)], [100, Y(0)]], 'the trace on the lane\'s own scale (its points sit on it)');
  assert.equal(Y(1), 10, 'pos 100 at the lane\'s top padding');
});

test('the Tracker row is not on the Track tab (the stroke lane is it there); Refine / Review keep it', () => {
  assert.deepEqual(laneRow.modes, ['refine', 'review']);
});
