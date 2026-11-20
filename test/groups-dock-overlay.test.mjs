// paw-trjh: opening Groups (G) docked its toolbar beside the video and shrank / moved the picture under the pointer. The dock
// now lies over the stage's left edge (absolutely placed in the stage), taking no room. paw-i5qx: it is a slim translucent bar
// (no wide panel, no Arm palette) that fades and lets the pointer through while a stroke is in progress. The real-window
// geometry check is dev/groups-dock-check.mjs ("the picture stays put"); this guards the compiled CSS and the placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';

const src = readFileSync(new URL('../src/features/tracking/GroupsOverlay.svelte', import.meta.url), 'utf8');
const css = compile(src, { filename: 'GroupsOverlay.svelte', css: 'external' }).css.code;
const rule = (sel) => css.match(new RegExp(sel + '\\.svelte-[\\w-]+\\s*\\{([^}]*)\\}'))?.[1] || '';

test('the Groups bar is absolutely placed (takes no room beside the stage), slim and see-through', () => {
  const r = rule('\\.gdock');
  assert.match(r, /position:\s*absolute/);
  assert.match(r, /left:\s*0/);
  assert.ok(+r.match(/width:\s*(\d+)px/)?.[1] <= 44, 'at most 44 px wide');
  assert.match(r, /background:\s*color-mix\([^;]*transparent\)/, 'a translucent background');
});

test('while a stroke is in progress it fades and lets the pointer through', () => {
  assert.match(css, /\.painting[^{]*\.gdock[^{]*\{[^}]*opacity:\s*\.\d+;\s*pointer-events:\s*none/);
  assert.match(src, /const painting = \$derived\(!!G\.draft/);
});

test('it is moved onto the stage, not into the stage row before it; no Arm palette', () => {
  assert.doesNotMatch(src, /insertBefore\(node, st\)/);
  assert.match(src, /\?\.append\(node\)/);
  assert.doesNotMatch(src, /data-testid="groups-parts"|'Arm'/);
});

test('paw-q3ad: a short stage wraps the bar into columns (never a hidden scroll); the cards and the hint keep clear of it', () => {
  const r = rule('\.gdock');
  assert.match(r, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(r, /overflow:[^;]*auto/, 'no scrolling bar');
  assert.match(rule('\.gside'), /left:\s*calc\(var\(--gdock-w/, 'the cards start after the bar, however wide');
  const ns = readFileSync(new URL('../src/features/onboard/NextStep.svelte', import.meta.url), 'utf8');
  assert.match(ns, /--ob-h/, 'the hint publishes its height on the stage');
  assert.match(ns, /:has\(> \.gtools\)\) \.ob \{ top: auto; bottom: 8px; left: calc\(var\(--gdock-w/, 'and goes to the foot, right of the bar, while the tool is open');
});
