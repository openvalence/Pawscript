// paw-zvos: dragging a flipped stretch's end on the run strip. The stretches were keyed by their own bounds and the handle held
// the pointer: the first move's preview changed the bounds, Svelte re-made the element, the capture went with it, pointerup never
// ran and tr.flipPreview (which feeds the live script, so Publish and Bake) stayed set. The behaviour is checked in the real
// window (dev/runranges-check.mjs 4c); this pins the three things the fix rests on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/features/tracking/RunRangeStrip.svelte', import.meta.url), 'utf8');
const edge = src.slice(src.indexOf('function polEdgeDown'), src.indexOf('$effect(() => () => polEnd?.())'));

test('paw-zvos: a stretch keeps its element while its bounds move (keyed by index, not by its bounds)', () => {
  assert.match(src, /\{#each stretchesIn\(r\) as st, j \(j\)\}/);
  assert.doesNotMatch(src, /as st \(st\[2\] \+ ':' \+ st\[3\]\)/);
});

test('paw-zvos: the strip itself holds the pointer during an end drag, and every way out drops the preview', () => {
  assert.ok(edge.length > 0, 'polEdgeDown and its unmount cleanup are there');
  assert.match(edge, /el\.setPointerCapture\(/, 'the capture is on the strip, which outlives the stretch elements');
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) assert.match(edge, new RegExp(`addEventListener\\('${ev}'`), ev);
  assert.match(edge, /key === 'Escape'/, 'Escape cancels');
  assert.match(edge, /tr\.flipPreview = null/, 'a drag that is not released over the strip writes nothing and leaves no preview');
  assert.match(src, /\$effect\(\(\) => \(\) => polEnd\?\.\(\)\)/, 'the strip going away (a tab switch) ends the drag');
});
