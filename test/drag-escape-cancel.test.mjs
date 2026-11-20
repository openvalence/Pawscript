// paw-k8rq: Escape during a drag cleared the drag's state, but the gesture's move handler set it again on the next move and its
// release wrote it anyway: a range override drawn on the Track lane's edge band, a shaft mark dragged on the shaft strip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/features/tracking/${p}`, import.meta.url), 'utf8');
const lane = read('TrackingLane.svelte'), shaft = read('ShaftStrip.svelte');
const escOf = (src) => src.match(/<svelte:window onkeydowncapture=\{[^\n]*\n/)?.[0] || '';

test('paw-k8rq: Escape ends the override draw on the edge band whole (listeners off, nothing written on release)', () => {
  const rail = lane.slice(lane.indexOf('function railDown'), lane.indexOf('let railCancel = null;'));
  assert.ok(rail, 'railDown is there');
  assert.match(rail, /railCancel = \(\) => \{ off\(\); rubber = null; \}/);
  assert.match(rail, /const off = \(\) => \{[^}]*removeEventListener\('pointermove', mv\)[^}]*removeEventListener\('pointerup', done\)/);
  assert.match(escOf(lane), /else if \(rubber\) \{ railCancel\?\.\(\);/, 'the window Escape calls it');
});

test('paw-k8rq: Escape ends a shaft mark drag whole', () => {
  const mark = shaft.slice(shaft.indexOf('function markDown'), shaft.indexOf('let markCancel = null;'));
  assert.ok(mark, 'markDown is there');
  assert.match(mark, /markCancel = \(\) => \{ off\(\); markDrag = null; \}/);
  assert.match(escOf(shaft), /if \(knotDrag \|\| markDrag\) \{ markCancel\?\.\(\);/);
});