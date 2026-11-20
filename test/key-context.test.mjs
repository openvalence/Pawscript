// paw-g3zk: a pointer press on an area makes it the key context. A timeline row (role=application) keeps the focus
// when the press's own handler prevents its default (the video's tools do); Registry.notePointer blurs it so the
// area's keys (G) are not refused by the row's lane-scoped `when`s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Registry } from '../src/app/commands.js';

// a minimal element: `sel` lists the selectors it (or an ancestor) matches, `inside` the elements it contains
const el = (sel = [], inside = []) => {
  const e = { blurred: 0, blur() { this.blurred++; doc.activeElement = doc.body; }, contains: (t) => t === e || inside.includes(t),
    closest: (q) => (q.split(',').some((s) => sel.includes(s.trim())) ? e : null) };
  return e;
};
const doc = { body: null, activeElement: null };
doc.body = el();
const press = (target) => { target.ownerDocument = doc; new Registry().notePointer({ target }); };

test('a press on the video blurs the focused timeline row', () => {
  const row = el(['[role=application]']);
  doc.activeElement = row;
  press(el());   // the video's overlay canvas: takes no focus
  assert.equal(row.blurred, 1);
  assert.equal(doc.activeElement, doc.body);
});

test('a press inside the focused row, on a button, or on a focusable area leaves the focus alone', () => {
  const inner = el(), row = el(['[role=application]'], [inner]);
  for (const t of [inner, el(['button']), el(['[tabindex]']), el(['[role^=menuitem]'])]) {
    doc.activeElement = row;
    press(t);
  }
  assert.equal(row.blurred, 0);
});

test('a focused text entry keeps its focus', () => {
  const input = el(['textarea']);
  doc.activeElement = input;
  press(el());
  assert.equal(input.blurred, 0);
});
