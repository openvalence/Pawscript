// paw-5nsv: a timeline row's hide chip ("Modifiers ‹", top right) was transparent until the row was hovered but kept taking
// presses: a press there folded the row while nothing was drawn. Rule: visible whenever hittable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/app/Timeline.svelte', import.meta.url), 'utf8');
const rule = (sel) => src.match(new RegExp(`\\n\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] || '';

test('paw-5nsv: hidden, the fold chip takes no press; shown (row hovered, focused), it does', () => {
  const base = rule('.fold'), shown = rule('.row:hover .fold, .fold:focus-visible');
  assert.match(base, /opacity:\s*0/);
  assert.match(base, /pointer-events:\s*none/, 'transparent and not hittable');
  assert.match(shown, /opacity:\s*1/);
  assert.match(shown, /pointer-events:\s*auto/, 'drawn and hittable together');
});
