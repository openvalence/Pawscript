// paw-r73w: ui:ctl names the control (names only, digits as #) and the surface it was used on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctlName, ctlLog } from '../src/app/ctl-log.js';

/** A stand-in element: closest(CTL) finds the control, closest('[role="radiogroup"]') its group, closest('[data-surface]') a sub-surface. */
const el = ({ ctl, label, text = '', role = '', group = null, surface = null, control = true } = {}) => {
  const me = {
    dataset: ctl ? { ctl } : {}, textContent: text,
    getAttribute: (k) => (k === 'aria-label' ? label ?? null : k === 'role' ? role || null : null),
    closest: (sel) => (sel.includes('radiogroup') ? group : sel.includes('data-surface') ? surface : sel.includes('k-slider-track') ? (role === 'slider' ? me : null) : control ? me : null),
    matches: () => false,
  };
  return me;
};
const grp = (label) => ({ getAttribute: (k) => (k === 'aria-label' ? label : null) });

test('a control is named by data-ctl, else its aria-label up to a colon, else its words; digits are #', () => {
  assert.equal(ctlName(el({ ctl: 'run remove', label: 'Remove S1 · 0:00.0–0:20.0' })), 'run remove');
  assert.equal(ctlName(el({ label: 'Signal source: rel:sem_c1_penis:sem_c2_hips' })), 'Signal source');
  assert.equal(ctlName(el({ text: '  Accept + 2 fills ' })), 'Accept + # fills');
  assert.equal(ctlName(el({ text: 'Strokes · 56 pts' })), 'Strokes · # pts');
  assert.equal(ctlName(el({ text: 'auto', role: 'radio', group: grp('Camera removal') })), 'Camera removal: auto');
  assert.equal(ctlName(el({ control: false, text: 'a label' })), '');
});

test('ctlLog notes ui:ctl with the surface (a [data-surface] inside the root wins); a slider on its press, a button on its click', () => {
  const notes = [], after = [];
  const app = { usage: { note: (k, d) => notes.push([k, d]) } };
  const on = {};
  const root = { addEventListener: (t, f) => (on[t] = f), removeEventListener: (t) => delete on[t], contains: () => true };
  const off = ctlLog(app, 'panel', (c) => after.push(c))(root);
  const sub = { dataset: { surface: 'panel.fusion' } };
  const btn = el({ text: 'Accept' }), pin = el({ ctl: 'relationship pin', surface: sub }), pad = el({ label: 'Fusion pad: centre', role: 'slider', surface: sub });
  on.click({ type: 'click', target: btn });
  on.pointerdown({ type: 'pointerdown', target: btn });   // a button logs on its click only
  on.click({ type: 'click', target: pin });
  on.pointerdown({ type: 'pointerdown', target: pad });
  on.click({ type: 'click', target: pad });               // a slider logs on its press only
  assert.deepEqual(notes, [['ui:ctl', { c: 'Accept', s: 'panel' }], ['ui:ctl', { c: 'relationship pin', s: 'panel.fusion' }], ['ui:ctl', { c: 'Fusion pad', s: 'panel.fusion' }]]);
  assert.deepEqual(after, ['Accept', 'relationship pin', 'Fusion pad']);
  off();
  assert.deepEqual(Object.keys(on), []);
});
