// paw-3zfx: a baseline knot dragged on the combined Track lane clamped to the lane's height, not its plot: the 19 px band under
// the plot maps below 0, so a knot dragged to the bottom got a baseline below the channel's range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posToY, yToPos } from '../src/features/lanes/geom.js';

const src = readFileSync(new URL('../src/features/tracking/TrackingLane.svelte', import.meta.url), 'utf8');
const drag = src.slice(src.indexOf('function dragKnot'), src.indexOf('function up(e)'));

test('paw-3zfx: the band under the plot is below the channel range (why the clamp must be the plot height)', () => {
  const h = 120, ph = h - 19;
  assert.ok(yToPos(ph, h) < 0, 'the lane bottom maps below 0 on the plot scale');
  assert.ok(Math.abs(yToPos(ph, posToY(ph, 0))) < 1e-6);
});

test('paw-3zfx: dragKnot clamps to the plot height when embedded', () => {
  assert.ok(drag, 'dragKnot is there');
  assert.match(drag, /Math\.min\(embedded \? ph : h, Math\.max\(0, p\.y\)\)/);
});