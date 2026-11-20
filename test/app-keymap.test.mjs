import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChord, parseKeys, eventChord, fmtKeys, allowedWhileTyping, Matcher, conflicts } from '../src/app/keymap.js';
import { Registry, keyRoute } from '../src/app/commands.js';

const ev = (key, code, mods = {}) => ({ key, code, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, metaKey: !!mods.meta, target: null, preventDefault() { this.prevented = true; }, timeStamp: mods.t ?? 0 });

test('parseChord normalises modifiers, aliases and shifted symbols', () => {
  assert.equal(parseChord('shift+ctrl+z'), 'Ctrl+Shift+Z');
  assert.equal(parseChord('Ctrl+Left'), 'Ctrl+ArrowLeft');
  assert.equal(parseChord('del'), 'Delete');
  assert.equal(parseChord('esc'), 'Escape');
  assert.equal(parseChord('?'), 'Shift+/');
  assert.equal(parseChord('Ctrl++'), 'Ctrl+Shift+=');
  assert.equal(parseChord('space'), 'Space');
  assert.equal(parseChord('f5'), 'F5');
  assert.equal(parseChord('Meta+Alt+k'), 'Alt+Meta+K');
  assert.equal(parseChord('Ctrl+Shift'), null);
  assert.equal(parseChord('A+B'), null);
  assert.equal(parseChord(''), null);
});

test('parseKeys handles sequences', () => {
  assert.equal(parseKeys('g g'), 'G G');
  assert.equal(parseKeys('ctrl+k  ctrl+s'), 'Ctrl+K Ctrl+S');
  assert.equal(parseKeys('ctrl+k bogus+x'), null);
});

test('eventChord reads physical digits and punctuation, letters by layout', () => {
  assert.equal(eventChord(ev('!', 'Digit1', { shift: true })), 'Shift+1');
  assert.equal(eventChord(ev('5', 'Numpad5')), '5');
  assert.equal(eventChord(ev('?', 'Slash', { shift: true })), 'Shift+/');
  assert.equal(eventChord(ev(' ', 'Space')), 'Space');
  assert.equal(eventChord(ev('z', 'KeyZ', { ctrl: true })), 'Ctrl+Z');
  assert.equal(eventChord(ev('Z', 'KeyZ', { ctrl: true, shift: true })), 'Ctrl+Shift+Z');
  assert.equal(eventChord(ev('ArrowLeft', 'ArrowLeft', { shift: true })), 'Shift+ArrowLeft');
  assert.equal(eventChord(ev('Shift', 'ShiftLeft', { shift: true })), null);
  assert.equal(eventChord(ev('å', 'KeyA', { alt: true })), 'Alt+A');   // mac Option changes key
  assert.equal(eventChord(ev('Escape', 'Escape')), 'Escape');
});

test('fmtKeys shows friendly names', () => {
  assert.equal(fmtKeys('Shift+/'), '?');
  assert.equal(fmtKeys('Ctrl+ArrowLeft'), 'Ctrl+←');
  assert.equal(fmtKeys('G G'), 'G G');
  assert.equal(fmtKeys('Shift+1'), 'Shift+1');
  assert.equal(fmtKeys('Delete'), 'Del');
});

test('typing rules: single keys never fire in a text field; Esc and app chords do', () => {
  assert.equal(allowedWhileTyping('A'), false);
  assert.equal(allowedWhileTyping('Space'), false);
  assert.equal(allowedWhileTyping('Shift+ArrowLeft'), false);
  assert.equal(allowedWhileTyping('Escape'), true);
  assert.equal(allowedWhileTyping('Ctrl+S'), true);
  assert.equal(allowedWhileTyping('Ctrl+K'), true);
  assert.equal(allowedWhileTyping('Ctrl+Z'), false);   // the field's own undo
  assert.equal(allowedWhileTyping('Ctrl+V'), false);
  assert.equal(allowedWhileTyping('F1'), true);
});

test('Matcher: single chords, sequences, timeout, broken sequence restart', () => {
  const m = new Matcher([['a', 'G G'], ['b', 'Space'], ['c', 'G']], 1000);
  assert.deepEqual(m.feed('Space', 0), { ids: ['b'] });
  assert.deepEqual(m.feed('G', 0), { pending: true, ids: ['c'] });
  assert.deepEqual(m.feed('G', 500), { ids: ['a'] });
  m.feed('G', 1000);
  assert.deepEqual(m.feed('G', 3000), { pending: true, ids: ['c'] });   // timed out: a fresh G
  assert.deepEqual(m.feed('Space', 3100), { ids: ['b'] });              // broken: Space alone matches
  assert.equal(m.feed('X', 4000), null);
});

test('conflicts: same keys and prefixes', () => {
  const c = conflicts([['a', 'Ctrl+K'], ['b', 'ctrl+k'], ['c', 'Ctrl+K Ctrl+S'], ['a', 'Ctrl+K']]);
  assert.ok(c.some((x) => x.kind === 'same' && x.keys === 'Ctrl+K' && x.ids.join() === 'a,b'));
  assert.ok(c.some((x) => x.kind === 'prefix' && x.longer === 'Ctrl+K Ctrl+S'));
});

test('Registry: priority, when, overrides, reset, errors', () => {
  let overrides = {};
  const ran = [], errors = [];
  const app = { busy: false };
  const r = new Registry({ app, getOverrides: () => overrides, setOverrides: (o) => (overrides = o), onError: (e) => errors.push(e.message) });
  r.register([{ id: 'track.cancel', keys: ['Esc'], when: (a) => a.busy, run: () => ran.push('cancel') }], 'tracking');
  r.register([{ id: 'edit.escape', keys: ['Escape'], run: () => ran.push('escape') }, { id: 'x.boom', keys: ['B'], run: () => { throw new Error('bad'); } }], 'core');
  r.register([{ id: 'edit.escape', run() {} }], 'dup');   // duplicate id skipped
  assert.equal(r.list().length, 3);
  r.handleKey(ev('Escape', 'Escape')); app.busy = true; r.handleKey(ev('Escape', 'Escape'));
  assert.deepEqual(ran, ['escape', 'cancel']);
  r.handleKey(ev('b', 'KeyB'));
  assert.deepEqual(errors, ['bad']);
  r.setKeys('edit.escape', ['Ctrl+E']);
  assert.deepEqual(r.keysFor('edit.escape'), ['Ctrl+E']);
  assert.equal(r.isOverridden('edit.escape'), true);
  app.busy = false;
  const e = ev('e', 'KeyE', { ctrl: true }); r.handleKey(e);
  assert.equal(ran.at(-1), 'escape'); assert.equal(e.prevented, true);
  r.setKeys('edit.escape', null);
  assert.deepEqual(r.keysFor('edit.escape'), ['Escape']);
  r.setKeys('edit.escape', []);   // unbind
  assert.equal(r.handleKey(ev('Escape', 'Escape')), false);
  r.resetAll(); assert.deepEqual(overrides, {});
  assert.deepEqual(r.recent.slice(0, 1), ['edit.escape']);
});

test('Registry: focus rules for text fields and mouse-focused buttons', () => {
  const ran = [];
  const r = new Registry({ app: {} });
  r.register([{ id: 'p', keys: ['Space'], run: () => ran.push('p') }, { id: 's', keys: ['Ctrl+S'], run: () => ran.push('s') }]);
  const input = { closest: (sel) => (sel.startsWith('input:not') ? input : null) };
  const button = { closest: (sel) => (sel.includes('button') && !sel.startsWith('input') ? button : null) };
  assert.equal(r.handleKey({ ...ev(' ', 'Space'), target: input }), false);
  r.handleKey({ ...ev('s', 'KeyS', { ctrl: true }), target: input });
  assert.equal(r.handleKey({ ...ev(' ', 'Space'), target: button }), true);    // Space is always the app's, however the button got focus
  r.notePointer({ target: button });
  assert.equal(r.handleKey({ ...ev(' ', 'Space'), target: button }), true);
  assert.deepEqual(ran, ['s', 'p', 'p']);
});

test('paw-ks21 keyRoute: Space / Tab / arrows are the key map\'s everywhere but a text entry; arrows stay with menus, popups and dialogs', () => {
  const table = {
    ' ': { other: 'app', nav: 'app', text: 'pass' },
    Tab: { other: 'app', nav: 'app', text: 'pass' },
    ArrowLeft: { other: 'app', nav: 'pass', text: 'pass' },
    ArrowDown: { other: 'app', nav: 'pass', text: 'pass' },
    Enter: { other: 'pass', nav: 'pass', text: 'pass' },
    Escape: { other: 'pass', nav: 'pass', text: 'pass' },
    a: { other: 'pass', nav: 'pass', text: 'pass' },
  };
  for (const [key, kinds] of Object.entries(table)) for (const [kind, want] of Object.entries(kinds)) assert.equal(keyRoute(key, kind), want, `${JSON.stringify(key)} on ${kind}`);
});

test('paw-ks21 guardKey: a focused button, slider, select or checkbox never sees Space / Tab / arrows; the key map does', () => {
  const ran = [];
  const r = new Registry({ app: {} });
  r.register([{ id: 'play', keys: ['Space'], keyUp: true, run: () => ran.push('play') }, { id: 'step', keys: ['ArrowRight'], run: () => ran.push('step') }]);
  // a control (button / range / select / checkbox / summary): matches no text-entry or arrow-owning selector
  const control = { closest: (sel) => (sel.includes('button') && !sel.startsWith('input') ? control : null) };
  const field = { closest: (sel) => (sel.startsWith('input:not') ? field : null) };
  const menu = { closest: (sel) => (sel.includes('[role=menu]') ? menu : null) };
  const key = (k, code, target) => ({ ...ev(k, code), target, stopPropagation() { this.stopped = true; } });
  const space = key(' ', 'Space', control);
  assert.equal(r.guardKey(space), true);
  assert.equal(space.prevented && space.stopped, true, 'Space on a button: prevented (no click on release) and stopped (no element handler)');
  r.handleKeyUp({ key: ' ', code: 'Space', preventDefault() {} });
  assert.deepEqual(ran, ['play']);
  const right = key('ArrowRight', 'ArrowRight', control);
  assert.equal(r.guardKey(right), true);
  assert.equal(right.prevented && right.stopped, true, 'an arrow on a slider: its value does not change');
  assert.deepEqual(ran, ['play', 'step'], 'the app\'s arrow action ran');
  const tab = key('Tab', 'Tab', control);
  assert.equal(r.guardKey(tab), true);
  assert.equal(tab.prevented, true, 'Tab never moves focus');
  // in a text entry everything passes untouched, and the key map ignores plain keys there
  for (const [k, c] of [[' ', 'Space'], ['ArrowRight', 'ArrowRight'], ['Tab', 'Tab']]) {
    const e = key(k, c, field);
    assert.equal(r.guardKey(e), false);
    assert.equal(!!(e.prevented || e.stopped), false, `${c} in a text field types / moves the caret`);
    assert.equal(r.handleKey(e), false);
  }
  // an open menu keeps its arrows; Space still plays
  const down = key('ArrowDown', 'ArrowDown', menu);
  assert.equal(r.guardKey(down), false);
  assert.equal(!!down.stopped, false);
  assert.equal(r.guardKey(key(' ', 'Space', menu)), true);
  assert.deepEqual(ran, ['play', 'step']);
});

test('Registry: keyUp commands fire on release, not after a pointer drag, once per press', () => {
  const ran = [];
  const r = new Registry({ app: {} });
  r.register([{ id: 'play', keys: ['Space'], keyUp: true, run: () => ran.push('play') }]);
  const down = () => ({ ...ev(' ', 'Space'), target: null }), up = () => ({ key: ' ', code: 'Space', preventDefault() {} });
  assert.equal(r.handleKey(down()), true);
  assert.equal(r.handleKey(down()), true);   // auto-repeat swallowed
  assert.deepEqual(ran, []);
  r.handleKeyUp(up());
  assert.deepEqual(ran, ['play']);
  r.handleKey(down()); r.notePointer({ target: null }); r.handleKeyUp(up());   // Space-drag: no play
  assert.deepEqual(ran, ['play']);
  assert.equal(r.handleKeyUp(up()), false);
});

test('Registry: shared keys guarded by when are not conflicts; unguarded pairs and overrides are', () => {
  let overrides = {};
  const r = new Registry({ app: {}, getOverrides: () => overrides, setOverrides: (o) => (overrides = o) });
  r.register([{ id: 'pal.close', keys: ['Escape'], when: () => false, run() {} }, { id: 'sel.clear', keys: ['Escape'], run() {} },
    { id: 'a', keys: ['X'], run() {} }, { id: 'b', keys: ['X'], run() {} }]);
  assert.deepEqual(r.conflicts().map((c) => c.keys), ['X']);
  assert.deepEqual(r.conflicts({ all: true }).map((c) => c.kind).sort(), ['same', 'shared']);
  r.setKeys('pal.close', ['Escape', 'F2']);   // keeping a default key while adding another: still just shared
  assert.deepEqual(r.conflicts().map((c) => c.keys), ['X']);
  r.setKeys('pal.close', ['Y']); r.register([{ id: 'y', keys: ['Y'], when: () => true, run() {} }]);
  assert.deepEqual(r.conflicts().map((c) => c.keys).sort(), ['X', 'Y']);   // a key the user added that collides: reported
  // shared only with hidden overlay helpers (assist.swallow): not listed even with {all}
  r.register([{ id: 'nav', keys: ['K'], when: () => true, run() {} }, { id: 'swallow', keys: ['K'], hidden: true, when: () => false, run() {} }]);
  assert.ok(!r.conflicts({ all: true }).some((c) => c.keys === 'K'));
});

test('from a text field: the field keeps Ctrl+Shift+V; Edit-menu commands never fire; navigation chords still do', async () => {
  const { Registry } = await import('../src/app/commands.js');
  const ran = [];
  const r = new Registry();
  r.register([
    { id: 'lanes.pasteMerge', keys: ['Ctrl+Shift+V'], menu: 'Edit', run: () => ran.push('paste') },
    { id: 'lanes.duplicate', keys: ['Ctrl+D'], menu: 'Edit', run: () => ran.push('dup') },
    { id: 'quick.invert', keys: ['Alt+I'], menu: 'Edit', run: () => ran.push('inv') },
    { id: 'edit.special', keys: ['Ctrl+Alt+E'], menu: 'Edit', whileTyping: true, run: () => ran.push('special') },
    { id: 'file.save', keys: ['Ctrl+S'], menu: 'File', run: () => ran.push('save') },
    { id: 'edit.escape', keys: ['Escape'], menu: 'Edit', run: () => ran.push('esc') },
  ]);
  const field = { closest: (sel) => (sel.includes('input:not') ? {} : null) };
  const ev = (key, code, mods = {}) => ({ key, code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: false, target: field, preventDefault() {} });
  r.handleKey(ev('V', 'KeyV', { ctrl: true, shift: true }));
  r.handleKey(ev('d', 'KeyD', { ctrl: true }));
  r.handleKey(ev('i', 'KeyI', { alt: true }));
  r.handleKey(ev('e', 'KeyE', { ctrl: true, alt: true }));
  r.handleKey(ev('s', 'KeyS', { ctrl: true }));
  r.handleKey(ev('Escape', 'Escape'));
  assert.deepEqual(ran, ['special', 'save', 'esc']);
  r.handleKey({ ...ev('d', 'KeyD', { ctrl: true }), target: { closest: () => null } });   // outside a field it runs
  assert.deepEqual(ran.at(-1), 'dup');
});

test('a key whose command is off says its why (paw-vhcd: Ctrl+Alt+S with nothing to publish), and runs nothing', () => {
  const said = [], app = { ready: false };
  let ran = 0;
  const r = new Registry({ app, onWhy: (why, c) => said.push([why, c.id]) });
  r.register([
    { id: 'file.publish', keys: ['Ctrl+Alt+S'], when: (a) => a.ready, why: () => 'Nothing to publish yet: no axis has points', run: () => ran++ },
    { id: 'quiet.off', keys: ['Ctrl+Alt+Q'], when: () => false, run: () => ran++ },
  ]);
  const e = ev('s', 'KeyS', { ctrl: true, alt: true });
  assert.equal(r.handleKey(e), true);
  assert.ok(e.prevented);
  assert.deepEqual(said, [['Nothing to publish yet: no axis has points', 'file.publish']]);
  assert.equal(r.handleKey(ev('q', 'KeyQ', { ctrl: true, alt: true })), false, 'no why: nothing said, the key is not taken');
  app.ready = true;
  r.handleKey(ev('s', 'KeyS', { ctrl: true, alt: true }));
  assert.equal(ran, 1); assert.equal(said.length, 1);
});