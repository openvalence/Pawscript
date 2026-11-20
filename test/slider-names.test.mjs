// Every kit Slider / RangeSlider the app draws has an accessible name: a `label`, an `aria-label` or an `aria-labelledby`.
// A role=slider <span> is not labelled by a Field's <label for> (only native controls are): the device panels' Range and
// Stroke window sliders had no name at all (keys-focus-check: "a slider with no aria-label").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (/^(_demo|_gallery|docs)$/.test(e.name) ? [] : files(join(d, e.name))) : e.name.endsWith('.svelte') ? [join(d, e.name)] : []));

test('every <Slider> / <RangeSlider> in src has a label, aria-label or aria-labelledby', () => {
  const bad = [];
  for (const f of files(root)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/<(Slider|RangeSlider)\b(.*?)\/>/gs)) {
      if (!/\blabel=|aria-label=|aria-labelledby=/.test(m[2])) bad.push(`${f.slice(root.length)}: ${m[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(bad, []);
});
