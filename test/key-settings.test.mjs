// paw-5z78: the keyboard settings, each in its two states, in the key routing table (commands.js keyRoute / guardKey /
// handleKey) and the editor selection (ui/kit/editor-item.svelte.js, app/editor-commands.js):
//   keys.uiNavigation (off): Tab / arrows / Space are the app's | on: they move focus and Space presses the focused control
//   keys.spaceInMenus (play): Space plays with a menu open, Enter picks | pick: Space picks the menu's item, no play
//   keys.arrowsNudgeSelection (on): plain arrows nudge the selected editor item, Esc drops it | off: arrows always step frames
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';

registerHooks({
  load(url, ctx, next) {
    if (!url.startsWith('file:') || url.includes('node_modules') || !url.endsWith('.svelte.js')) return next(url, ctx);
    const file = fileURLToPath(url);
    return { format: 'module', shortCircuit: true, source: compileModule(readFileSync(file, 'utf8'), { filename: file, generate: 'server' }).js.code };
  },
});
const { Registry, keyRoute } = await import('../src/app/commands.js');
const { SCHEMA } = await import('../src/app/settings.svelte.js');
const { default: editorCommands } = await import('../src/app/editor-commands.js');
const { holdEditorItem, addEditorSelection, editorSelection } = await import('../src/ui/kit/editor-item.svelte.js');

test('paw-5z78: the three settings are declared (Keyboard group, defaults = the owner\'s choices, valid values)', () => {
  const s = (k) => SCHEMA[k];
  assert.equal(s('keys.arrowsNudgeSelection').default, true);
  assert.equal(s('keys.spaceInMenus').default, 'play');
  assert.equal(s('keys.uiNavigation').default, false);
  for (const k of ['keys.arrowsNudgeSelection', 'keys.spaceInMenus', 'keys.uiNavigation']) { assert.equal(s(k).group, 'Keyboard'); assert.ok(s(k).doc.length > 20); }
  assert.equal(s('keys.spaceInMenus').valid('pick'), true);
  assert.equal(s('keys.spaceInMenus').valid('select'), false);
});

test('paw-5z78 keyRoute, keys.uiNavigation off / on', () => {
  const off = {}, on = { uiNav: true };
  for (const [key, kind, wantOff] of [[' ', 'other', 'app'], ['Tab', 'other', 'app'], ['ArrowLeft', 'other', 'app'], ['ArrowDown', 'nav', 'pass'], ['ArrowDown', 'menu', 'pass'], [' ', 'menu', 'app'], [' ', 'text', 'pass']]) {
    assert.equal(keyRoute(key, kind, off), wantOff, `off: ${JSON.stringify(key)} on ${kind}`);
    assert.equal(keyRoute(key, kind, on), 'pass', `on: ${JSON.stringify(key)} on ${kind} goes to the focused control`);
  }
});

test('paw-5z78 keyRoute, keys.spaceInMenus play / pick', () => {
  assert.equal(keyRoute(' ', 'menu', { spacePick: false }), 'app', 'play: Space plays with a menu open');
  assert.equal(keyRoute(' ', 'menu', { spacePick: true }), 'pass', 'pick: Space reaches the menu');
  assert.equal(keyRoute(' ', 'other', { spacePick: true }), 'app', 'pick: outside a menu Space still plays');
  assert.equal(keyRoute(' ', 'nav', { spacePick: true }), 'app', 'a data-arrow-nav region is not a menu');
});

// a fake element: closest(sel) matches when a comma-separated part of sel starts with one of its tokens
const el = (...tokens) => ({ closest: (sel) => (sel.split(',').some((s) => tokens.some((t) => s.trim().startsWith(t))) ? {} : null), ownerDocument: { querySelector: () => null } });
const ev = (key, target, mods = {}) => ({ key, code: key === ' ' ? 'Space' : key, target, timeStamp: 0, ctrlKey: false, altKey: false, metaKey: false, shiftKey: !!mods.shift,
  defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } });
function setup(settings = {}) {
  const ran = [], app = { settings: { get: (k, d) => (k in settings ? settings[k] : d) } };
  const r = new Registry({ app, getSetting: (k, d) => app.settings.get(k, d) });
  r.register(editorCommands, 'app');
  r.register([
    { id: 'player.toggle', keys: ['Space'], keyUp: true, run: () => ran.push('play') },
    { id: 'player.stepFwd', keys: ['ArrowRight'], run: () => ran.push('step') },
    { id: 'edit.escape', keys: ['Escape'], run: () => ran.push('escape') },
  ]);
  // the window: guard at document capture, then the bubble listener unless stopped / prevented by the element
  const press = (e, elementTakes = false) => { r.guardKey(e); if (elementTakes && !e.stopped) e.preventDefault(); if (!e.stopped) r.handleKey(e); r.handleKeyUp({ code: e.code, preventDefault() {} }); };
  return { r, ran, app, press };
}

test('paw-5z78 Space on a focused button: plays (uiNavigation off) / presses the button and does not play (on)', () => {
  const button = el('button');
  const a = setup({ 'keys.uiNavigation': false }), e1 = ev(' ', button);
  a.press(e1);
  assert.deepEqual(a.ran, ['play']);
  assert.equal(e1.defaultPrevented, true, 'off: the button is not pressed');
  const b = setup({ 'keys.uiNavigation': true }), e2 = ev(' ', button);
  b.press(e2);
  assert.deepEqual(b.ran, [], 'on: no play');
  assert.equal(e2.defaultPrevented, false, 'on: the browser presses the button');
  // Tab moves focus only with it on
  const t1 = ev('Tab', button); setup().r.guardKey(t1);
  assert.equal(t1.defaultPrevented, true);
  const t2 = ev('Tab', button); setup({ 'keys.uiNavigation': true }).r.guardKey(t2);
  assert.equal(t2.defaultPrevented, false);
});

test('paw-5z78 Space in an open menu: plays (spaceInMenus play) / picks the item, no play (pick)', () => {
  const item = el('[role=menu]', '[role^=menuitem]');
  const a = setup(); a.press(ev(' ', item));
  assert.deepEqual(a.ran, ['play']);
  const b = setup({ 'keys.spaceInMenus': 'pick' }), e = ev(' ', item);
  b.press(e, true);   // the menu's own handler picks and prevents the key
  assert.deepEqual(b.ran, [], 'pick: Space did not play');
  assert.equal(b.r.guardKey(ev(' ', item)), false, 'pick: the guard passed it to the menu');
});

test('paw-5z78 arrows with an editor item selected: nudge it, Esc drops it (arrowsNudgeSelection on) / frame step (off)', () => {
  const body = el('body'), nudged = [];
  let release = holdEditorItem({ nudge: (dx, dy, fine) => nudged.push([dx, dy, fine]) });
  const a = setup();
  a.press(ev('ArrowRight', body));
  a.press(ev('ArrowRight', body, { shift: true }));
  assert.deepEqual(nudged, [[1, 0, false], [1, 0, true]]);
  assert.deepEqual(a.ran, [], 'no frame step while an editor item is selected');
  a.press(ev('Escape', body));
  assert.equal(editorSelection(a.app), null, 'Esc dropped it');
  assert.deepEqual(a.ran, [], 'Esc went to the editor selection, not the next Escape command');
  a.press(ev('ArrowRight', body));
  assert.deepEqual(a.ran, ['step'], 'the arrows step frames again');
  // setting off: the arrows step frames even with an item selected
  release = holdEditorItem({ nudge: (dx) => nudged.push(['off', dx]) });
  const b = setup({ 'keys.arrowsNudgeSelection': false });
  b.press(ev('ArrowRight', body));
  assert.deepEqual(b.ran, ['step']);
  assert.equal(nudged.length, 2);
  release();
  assert.equal(editorSelection(b.app), null);
});

test('paw-5z78 a feature selection (the selected modifiers) is an editor selection while active; a held item that is not active is not', () => {
  let on = false; const moved = [];
  addEditorSelection({ active: () => on, nudge: (app, dx) => moved.push(dx), drop: () => { on = false; } });
  const a = setup(), body = el('body');
  a.press(ev('ArrowRight', body));
  assert.deepEqual(a.ran, ['step'], 'not active: frame step');
  on = true;
  a.press(ev('ArrowRight', body));
  assert.deepEqual(moved, [1]);
  a.press(ev('Escape', body));
  assert.equal(on, false, 'Esc dropped the feature selection');
  const release = holdEditorItem({ active: () => false, nudge: () => moved.push('held') });
  a.press(ev('ArrowRight', body));
  assert.deepEqual(moved, [1], 'a focused item that is not selected takes no arrow');
  release();
});
