// paw-j371: Escape or a pointercancel during a range override end drag (the Track lane's edge band) cleared segDrag but left the
// drag's move / up listeners on the handle; the pointer was still captured, so every later move threw (segDrag.to of null).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/features/tracking/TrackingLane.svelte', import.meta.url), 'utf8');
const seg = src.slice(src.indexOf('function segDown'), src.indexOf('function cancelSeg'));
const cancel = src.match(/function cancelSeg\(\) \{[^\n]*\}/)?.[0] || '';

test('paw-j371: cancelling a range override end drag removes its listeners, and a stray move is a no-op', () => {
  assert.ok(seg && cancel, 'segDown and cancelSeg are there');
  assert.match(cancel, /segDrag\?\.off\(\)/, 'cancelSeg ends the gesture (its listeners), not just the state');
  assert.match(seg, /const off = \(\) => \{[^}]*removeEventListener\('pointermove', mv\)[^}]*removeEventListener\('pointerup', up\)[^}]*removeEventListener\('pointercancel', cancelSeg\)/);
  assert.match(seg, /const mv = \(ev\) => \{\s*if \(!segDrag\) return;/, 'a move after the end finds nothing to do');
  assert.doesNotMatch(seg, /\{ once: true \}/, 'the cancel listener is removed by off, not by once (that left mv and up)');
});