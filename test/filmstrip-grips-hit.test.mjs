// paw-7gwt: zoomed out on a long video (shots a few px wide) the filmstrip hit-tested a grip on every cut, 5 px either side, so a
// press anywhere grabbed a cut (and a drag moved it) instead of selecting shots; drawing shows those crowded cuts as plain lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { grippable, shownGrips } from '../src/features/timeline/lod.js';
import { gripAt } from '../src/features/timeline/scenes-hit.js';

const g = { y0: 0, y1: 40 };
const comb = (n, step, sel = -1) => Array.from({ length: n }, (_, k) => ({ i: k + 1, x: 10 + k * step, force: k + 1 === sel }));

test('paw-7gwt: a press in a run of crowded cuts takes no grip; it is a shot press', () => {
  const cuts = comb(60, 4);   // a cut every 4 px: every x is within 5 px of one
  for (let x = 30; x < 200; x += 1.5) assert.equal(gripAt(grippable(cuts), x, 20, g), -1, `x ${x}`);
  assert.ok(gripAt(cuts, 100, 20, g) > 0, 'before: every cut was hit-tested');
});

test('paw-7gwt: what can be grabbed is what is drawn as a grip (plus the selected cut)', () => {
  const cuts = comb(60, 4, 30), shown = shownGrips(cuts);
  for (const c of grippable(cuts)) assert.ok(shown.has(c.i), `cut ${c.i} is grabbable and drawn`);
  assert.equal(gripAt(grippable(cuts), cuts[29].x + 1, 20, g), 30, 'the selected cut keeps its grip');
  // sparse cuts all keep theirs
  const wide = comb(5, 40);
  assert.equal(grippable(wide).length, 5);
  assert.equal(gripAt(grippable(wide), 52, 20, g), 2);
});

test('paw-7gwt: the filmstrip hit-tests through grippable', () => {
  const src = readFileSync(new URL('../src/features/timeline/FilmstripLane.svelte', import.meta.url), 'utf8');
  assert.match(src, /const gripUnder = [^\n]*gripAt\(grippable\(/);
});
