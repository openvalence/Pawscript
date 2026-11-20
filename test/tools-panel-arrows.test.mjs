// paw-zbyd: ArrowDown / Up on a Tools panel row walked the list before the key guard (paw-ks21); after it the row's own handler
// never ran and the key map nudged the selected points instead (an edit nobody asked for). The rows are marked data-arrow-nav.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Registry } from '../src/app/commands.js';

const src = readFileSync(new URL('../src/features/inspector/ToolsPanel.svelte', import.meta.url), 'utf8');
const rowTag = src.match(/<button class="pi-item tname".*?data-testid="tool-row-/s)?.[0] || '';

test('paw-zbyd: a Tools panel row is a place that owns its arrows', () => {
  assert.ok(rowTag, 'the row button is there');
  assert.match(rowTag, /\bdata-arrow-nav\b/);
  assert.match(rowTag, /onkeydown=\{\(e\) => rowKey\(e, op\)\}/, 'its own handler walks the list');
});

test('paw-zbyd: ArrowDown on a row marked data-arrow-nav reaches the row, not lanes.nudgeDown', () => {
  const ran = [];
  const r = new Registry({ app: {} });
  r.register([{ id: 'lanes.nudgeDown', keys: ['ArrowDown'], menu: 'Edit', run: () => ran.push('lanes.nudgeDown') }]);
  // the row as the browser sees it: a button inside [data-arrow-nav] (and, in the page, inside no modal)
  const row = { closest: (sel) => (sel.split(',').some((s) => ['button', '[data-arrow-nav]'].includes(s.trim())) ? {} : null), ownerDocument: { querySelector: () => null } };
  const e = { key: 'ArrowDown', code: 'ArrowDown', target: row, timeStamp: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
  assert.equal(r.guardKey(e), false);
  e.defaultPrevented = true;   // rowKey moved focus and prevented the key
  r.handleKey(e);
  assert.deepEqual(ran, []);
});
