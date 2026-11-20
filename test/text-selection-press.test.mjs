// paw-6bkv: a text selection left on the page (a Shift+drag on the stroke lane selected the status bar's text) made every later
// drag on the timeline a native drag of that text: pointerdown, one move, then the browser's pointercancel. A press outside a
// text field drops the selection first; the timeline rows never start one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Registry } from '../src/app/commands.js';

const mkDoc = () => {
  const sel = { type: 'Range', cleared: 0, removeAllRanges() { this.type = 'None'; this.cleared++; } };
  return { sel, doc: { activeElement: null, getSelection: () => sel } };
};
const el = (doc, ...tokens) => ({ ownerDocument: doc, closest: (s) => (s.split(',').some((p) => tokens.some((t) => p.trim().startsWith(t))) ? {} : null) });

test('paw-6bkv: a press on the timeline (or any non-text place) drops a page text selection', () => {
  const r = new Registry({ app: {} }), { sel, doc } = mkDoc();
  r.notePointer({ target: el(doc, 'canvas') });
  assert.equal(sel.cleared, 1);
  assert.equal(sel.type, 'None');
});

test('paw-6bkv: a press in a text field leaves the page alone (its own caret / selection)', () => {
  const r = new Registry({ app: {} }), { sel, doc } = mkDoc();
  r.notePointer({ target: el(doc, 'input:not') });
  assert.equal(sel.cleared, 0);
});

test('paw-6bkv: the timeline rows start no text selection', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /:where\(\[data-tl-lane\]\)\s*\{[^}]*user-select:\s*none/);
});
