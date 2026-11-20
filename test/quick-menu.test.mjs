// The Quick menu (features/palette/quick.js, logic.js): one list per stage tab and one for the project page, kept in the settings
// ('quick.lists'); add / remove / move; unknown ids never shown and never lost; an old settings file without the key loads; the
// right-click entries every [data-command] element gets. The .svelte / .svelte.js modules compile for the server on load.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, compileModule } from 'svelte/compiler';

// (quick.js reaches features/settings/logic.js, whose imports use vite's import.meta.glob: an empty set here)
const noGlob = (s) => s.replace(/import\.meta\.glob\(/g, '((..._) => ({}))(');
registerHooks({
  load(url, ctx, next) {
    if (!url.startsWith('file:') || url.includes('node_modules')) return next(url, ctx);
    const file = fileURLToPath(url), src = () => readFileSync(file, 'utf8');
    if (url.endsWith('.svelte.js')) return { format: 'module', shortCircuit: true, source: noGlob(compileModule(src(), { filename: file, generate: 'server' }).js.code) };
    if (url.endsWith('.svelte')) return { format: 'module', shortCircuit: true, source: noGlob(compile(src(), { filename: file, generate: 'server' }).js.code) };
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
    if (url.endsWith('.json')) return { format: 'module', shortCircuit: true, source: 'export default ' + src() };
    if (url.endsWith('.js') && src().includes('import.meta.glob')) return { format: 'module', shortCircuit: true, source: noGlob(src()) };
    return next(url, ctx);
  },
});
const { quickKey, quickIds, quickEdit, quickAdd, quickRemove, quickMove } = await import('../src/features/palette/logic.js');
const { Settings, SCHEMA } = await import('../src/app/settings.svelte.js');
const { quickList, commandEntries } = await import('../src/features/palette/quick.js');

test('one list per stage tab, its own on the project page; an old or unknown mode reads as modes.js does', () => {
  assert.deepEqual(['scenes', 'track', 'refine', 'review'].map((m) => quickKey(false, m)), ['scenes', 'track', 'refine', 'review']);
  assert.equal(quickKey(true, 'track'), 'home');
  assert.equal(quickKey(false, 'script'), 'refine');
  assert.equal(quickKey(false, 'nonsense'), 'scenes');
});

test('add / remove / move: each once, in order; an end or a missing id leaves the list as it is', () => {
  let l = quickAdd(quickAdd(quickAdd([], 'a'), 'b'), 'a');
  assert.deepEqual(l, ['a', 'b']);
  l = quickAdd(l, 'c');
  assert.deepEqual(quickMove(l, 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(quickMove(l, 'a', 1), ['b', 'a', 'c']);
  assert.equal(quickMove(l, 'a', -1), l);
  assert.equal(quickMove(l, 'c', 1), l);
  assert.equal(quickMove(l, 'zz', 1), l);
  assert.deepEqual(quickRemove(l, 'b'), ['a', 'c']);
  assert.deepEqual(quickRemove(l, 'zz'), l);
});

test('stored lists: malformed ones read empty; an edit touches its own list only and keeps unknown ids after the known ones', () => {
  for (const bad of [undefined, null, 5, 'x', [], { track: 'a' }, { track: { a: 1 } }]) assert.deepEqual(quickIds(bad, 'track'), []);
  assert.deepEqual(quickIds({ track: ['a', 7, '', 'a', null, 'b'] }, 'track'), ['a', 'b']);
  const known = (id) => id !== 'gone';
  const lists = { track: ['a', 'gone', 'b'], home: ['file.open'] };
  const next = quickEdit(lists, 'track', known, (l) => quickMove(l, 'b', -1));
  assert.deepEqual(next, { track: ['b', 'a', 'gone'], home: ['file.open'] });
  assert.deepEqual(lists.track, ['a', 'gone', 'b'], 'the stored object is not changed in place');
  assert.deepEqual(quickEdit(undefined, 'scenes', known, (l) => quickAdd(l, 'x')), { scenes: ['x'] });
  assert.deepEqual(quickEdit(['junk'], 'scenes', known, (l) => quickAdd(l, 'x')), { scenes: ['x'] });
});

const storage = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('settings round trip; an old settings file without the key loads with empty lists; a wrong type falls back', () => {
  assert.deepEqual(SCHEMA['quick.lists'].default, {});
  const st = storage({ 'pawscript.settings': JSON.stringify({ mode: 'track', 'keys.overrides': { 'edit.undo': ['Ctrl+Z'] } }) });
  const a = new Settings(st);
  assert.deepEqual(a.get('quick.lists'), {});
  assert.deepEqual(quickIds(a.get('quick.lists'), 'track'), []);
  a.set('quick.lists', quickEdit(a.get('quick.lists'), 'track', () => true, (l) => quickAdd(quickAdd(l, 'track.run'), 'edit.undo')));
  a.flush();
  const b = new Settings(st);
  assert.deepEqual(b.get('quick.lists'), { track: ['track.run', 'edit.undo'] });
  assert.deepEqual(b.get('keys.overrides'), { 'edit.undo': ['Ctrl+Z'] }, 'the other settings are as they were');
  const c = new Settings(storage({ 'pawscript.settings': JSON.stringify({ 'quick.lists': ['not', 'an', 'object'] }) }));
  assert.deepEqual(quickIds(c.get('quick.lists'), 'track'), []);
});

// a fake app: registry calls only, the settings real (in memory)
function fakeApp({ home = false, mode = 'track', lists = {} } = {}) {
  const cmds = { 'edit.undo': { id: 'edit.undo', title: 'Undo' }, 'track.run': { id: 'track.run', title: 'Track ROI' }, 'lanes.toggleSolo': { id: 'lanes.toggleSolo', title: 'Solo' } };
  const keys = { 'edit.undo': ['Ctrl+Z'], 'track.run': ['Ctrl+T'] }, ran = [];
  const settings = new Settings(null);
  settings.set('quick.lists', lists);
  return { ran, settings, mode, tabs: { home },
    commands: { get: (id) => cmds[id] || null, keysFor: (id) => keys[id] || [], enabled: () => true, whyNot: () => '', run: (id, args) => ran.push([id, args]) } };
}
/** An element as the right-click sees it: inside a [data-command] (or not), inside the Quick menu (or not). */
const el = (cmd, inQuick = false) => ({ closest: (sel) => (sel === '[data-command]' ? (cmd ? { dataset: { command: cmd } } : null) : /Quick menu/.test(sel) && inQuick ? {} : null) });
const labels = (items) => items.map((i) => i.label + (i.disabled ? ' (off)' : ''));

test('the right-click entries: Add / Remove, Assign / Change shortcut; Move up / down only in the Quick menu itself', () => {
  const app = fakeApp({ lists: { track: ['track.run', 'gone.cmd', 'edit.undo'], home: ['edit.undo'] } });
  assert.deepEqual(quickList(app), ['track.run', 'edit.undo'], 'unknown ids are not listed');
  assert.deepEqual(commandEntries(app, el(null)), [], 'no command: nothing');
  assert.deepEqual(commandEntries(app, el('nope.cmd')), [], 'an unknown command: nothing');
  assert.deepEqual(labels(commandEntries(app, el('lanes.toggleSolo'))), ['Add to Quick menu', 'Assign shortcut…']);
  assert.deepEqual(labels(commandEntries(app, el('edit.undo'))), ['Remove from Quick menu', 'Change shortcut (currently Ctrl+Z)…']);
  assert.deepEqual(labels(commandEntries(app, el('track.run', true))), ['Remove from Quick menu', 'Move up (off)', 'Move down', 'Change shortcut (currently Ctrl+T)…', 'undefined', 'Custom box track…', 'Custom point track…'], 'Track ROI: the standard entries, then the custom tracks (paw-bunr)');
  commandEntries(app, el('track.run')).at(-1).run();
  assert.deepEqual(app.ran.pop(), ['track.customPoints', undefined]);
  assert.deepEqual(labels(commandEntries(app, el('edit.undo', true))), ['Remove from Quick menu', 'Move up', 'Move down (off)', 'Change shortcut (currently Ctrl+Z)…']);

  commandEntries(app, el('lanes.toggleSolo'))[0].run();
  assert.deepEqual(app.settings.get('quick.lists').track, ['track.run', 'edit.undo', 'lanes.toggleSolo', 'gone.cmd'], 'added at the end; the unknown id kept, after the known ones');
  commandEntries(app, el('track.run'))[0].run();
  assert.deepEqual(quickList(app), ['edit.undo', 'lanes.toggleSolo']);
  assert.deepEqual(app.settings.get('quick.lists').home, ['edit.undo'], 'the project page list is untouched');
  // the shortcut entries open the keybinding editor on the command: a new binding, or the first one
  commandEntries(app, el('lanes.toggleSolo')).at(-1).run();
  commandEntries(app, el('edit.undo')).at(-1).run();
  assert.deepEqual(app.ran, [['palette.keys', { focus: 'lanes.toggleSolo', slot: -1 }], ['palette.keys', { focus: 'edit.undo', slot: 0 }]]);
});

test('the project page edits its own list', () => {
  const app = fakeApp({ home: true, lists: { track: ['track.run'] } });
  assert.deepEqual(quickList(app), []);
  commandEntries(app, el('edit.undo'))[0].run();
  assert.deepEqual(app.settings.get('quick.lists'), { track: ['track.run'], home: ['edit.undo'] });
});

// paw-m3b6: a setting (a Prop's right click: Add to Quick menu) is a row of the list too, as 'setting:<key>'
test('settings in the Quick menu: add / remove from a Prop, listed while the schema knows them, no shortcut entry', async () => {
  const { quickHas, quickToggle } = await import('../src/features/palette/quick.js');
  const app = fakeApp({ lists: { track: ['edit.undo', 'setting:no.such.key'] } });
  assert.equal(quickHas(app, 'lanes.latencyMs'), false);
  quickToggle(app, 'lanes.latencyMs');
  assert.equal(quickHas(app, 'lanes.latencyMs'), true);
  assert.deepEqual(quickList(app), ['edit.undo', 'setting:lanes.latencyMs'], 'an unknown setting is not listed (and kept)');
  assert.deepEqual(app.settings.get('quick.lists').track, ['edit.undo', 'setting:lanes.latencyMs', 'setting:no.such.key']);
  assert.deepEqual(labels(commandEntries(app, el('setting:lanes.latencyMs'))), ['Remove from Quick menu']);
  assert.deepEqual(labels(commandEntries(app, el('setting:lanes.latencyMs', true))), ['Remove from Quick menu', 'Move up', 'Move down (off)']);
  quickToggle(app, 'lanes.latencyMs');
  assert.deepEqual(quickList(app), ['edit.undo']);
});
