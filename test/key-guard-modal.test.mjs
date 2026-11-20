// paw-pj8l: an open modal dialog holds the keyboard. The key guard (commands.js guardKey, document capture) ran the key map
// before the dialog's own fence, so with a confirm open Space played the video behind it, Ctrl+Tab switched the document
// tab and Ctrl+Shift+Space moved the device. The panic stop (Shift+Esc / Pause) still runs from anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry } from '../src/app/commands.js';

// a fake element: closest(sel) matches when a comma-separated part of sel starts with one of its tokens
const el = (tokens, doc = null) => ({ closest: (sel) => (sel.split(',').some((s) => tokens.some((t) => s.trim().startsWith(t))) ? {} : null), ownerDocument: doc });
const docWith = (modal) => ({ querySelector: () => (modal ? {} : null) });
const ev = (key, target, mods = {}) => ({ key, code: key === ' ' ? 'Space' : key === 'Pause' ? 'Pause' : key, target, timeStamp: 0,
  ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: false, metaKey: false,
  defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } });

function setup({ scopeOff = false } = {}) {
  const ran = [];
  const r = new Registry({ app: {} });
  r.register([
    { id: 'player.toggle', keys: ['Space'], keyUp: true, run: () => ran.push('player.toggle') },
    { id: 'tabs.next', keys: ['Ctrl+Tab'], run: () => ran.push('tabs.next') },
    { id: 'playback.preview', keys: ['Ctrl+Shift+Space'], run: () => ran.push('playback.preview') },
    { id: 'playback.panic', keys: ['Shift+Escape', 'Pause'], anywhere: true, run: () => ran.push('playback.panic') },
    { id: 'edit.escape', keys: ['Escape'], run: () => ran.push('edit.escape') },
  ]);
  if (scopeOff) r.scope = () => false;   // the project page: the editor's commands are off
  // what the window sees after the document-capture guard: the dialog's fence stops a key from inside a modal
  const press = (e, fenced = false) => {
    r.guardKey(e);
    if (!e.stopped && !fenced) r.handleKey(e);
    r.handleKeyUp({ code: e.code, preventDefault() {} });
  };
  return { r, ran, press };
}

test('paw-pj8l: inside a modal dialog Space, Ctrl+Tab and Ctrl+Shift+Space reach nothing behind it', () => {
  const { r, ran, press } = setup();
  const okButton = el(['button', 'dialog:modal']);
  for (const [what, e] of [
    ['Space on the OK button', ev(' ', okButton)],
    ['Ctrl+Tab', ev('Tab', okButton, { ctrl: true })],
    ['Ctrl+Shift+Space', ev(' ', okButton, { ctrl: true, shift: true })],
  ]) {
    ran.length = 0;
    assert.equal(r.guardKey(e), false, `${what}: the guard leaves it to the dialog`);
    // plain Space presses the focused button; a chord (Ctrl+Tab, Ctrl+Shift+Space) presses nothing, not even in the dialog
    assert.equal(e.defaultPrevented, e.ctrlKey, `${what}: ${e.ctrlKey ? 'prevented' : 'not prevented'}`);
    assert.deepEqual(ran, [], `${what}: no app command ran`);
    press(ev(e.key, okButton, { ctrl: e.ctrlKey, shift: e.shiftKey }), true);
    assert.deepEqual(ran, [], `${what}: nothing ran behind the dialog`);
  }
  // Tab between the commit dialog's fields: untouched (the dialog's focus trap moves it)
  const tab = ev('Tab', el(['input:not', 'dialog:modal']));
  assert.equal(r.guardKey(tab), false);
  assert.equal(tab.defaultPrevented || tab.stopped, false);
});

test('paw-pj8l: with a modal open and focus lost to the page, a key acts on nothing; Escape still reaches the dialog', () => {
  const { r, ran } = setup();
  const body = el(['body'], docWith(true));
  const space = ev(' ', body);
  assert.equal(r.guardKey(space), true);
  assert.equal(space.stopped && space.defaultPrevented, true);
  const esc = ev('Escape', body);
  r.guardKey(esc);
  assert.equal(esc.stopped, true, 'Escape does not clear the selection behind');
  assert.equal(esc.defaultPrevented, false, 'Escape still cancels the dialog');
  assert.deepEqual(ran, []);
  // no modal open: the page's keys are the app's as before
  const plain = ev(' ', el(['body'], docWith(false)));
  assert.equal(r.guardKey(plain), true);
  r.handleKeyUp({ code: 'Space', preventDefault() {} });
  assert.deepEqual(ran, ['player.toggle']);
});

test('paw-pj8l: a passKeys dialog (assist) is not a fence: its Space is a command', () => {
  const { r, ran } = setup();
  // the assist dialog carries data-pass-keys: it matches no part of the guard's modal selector
  const inAssist = { closest: (sel) => (sel.includes('button') && !sel.startsWith('input') && !sel.includes(':modal') ? {} : null), ownerDocument: docWith(false) };
  assert.equal(r.guardKey(ev(' ', inAssist)), true);
  r.handleKeyUp({ code: 'Space', preventDefault() {} });
  assert.deepEqual(ran, ['player.toggle']);
});

test('paw-pj8l: the panic stop runs from anywhere: a modal, a text field, the project page', () => {
  for (const [what, target, opts] of [
    ['a modal dialog button', el(['button', 'dialog:modal']), {}],
    ['a modal with focus lost', el(['body'], docWith(true)), {}],
    ['a text field', el(['input:not']), {}],
    ['the project page (tab scope off)', el(['body'], docWith(false)), { scopeOff: true }],
  ]) {
    for (const [key, mods] of [['Escape', { shift: true }], ['Pause', {}]]) {
      const { r, ran } = setup(opts);
      const e = ev(key, target, mods);
      assert.equal(r.guardKey(e), true, `${key} in ${what}`);
      assert.equal(e.stopped && e.defaultPrevented, true, `${key} in ${what}: the dialog does not also close`);
      assert.deepEqual(ran, ['playback.panic'], `${key} in ${what}`);
    }
  }
});
