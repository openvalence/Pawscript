// commands.js -- palette, shortcut help, keybinding editor. Registered before the shell's core commands, so
// palette.close takes Escape while an overlay is open (and only then).
import { ui, show, hide, toggle } from './state.svelte.js';
import { openQuick } from './quick.js';
import { paletteContext } from './logic.js';
import { tl } from '../timeline/state.svelte.js';

export default [
  // paw-m3b6: the context (tab, focused row, area under the pointer, tool) is read here, while the row still has focus
  { id: 'palette.open', title: 'Command palette', keys: ['Ctrl+K', 'Ctrl+Shift+P'], menu: 'Help', group: 'Keyboard', run: (app) => (ui.open === 'palette' ? hide() : show('palette', '', paletteContext(app, tl.focus))) },
  // F1 (paw-idb5): the shortcuts moved here from the bottom of the window; its top section is what applies right now
  { id: 'palette.help', title: 'Keyboard shortcuts', keys: ['F1', 'Shift+/'], menu: 'Help', group: 'Keyboard', run: () => toggle('help') },
  // an overlay (paw-idb5: the Shortcuts tab left the bottom of the window; F1's overlay has the Edit shortcuts button)
  // args {focus: id, slot}: open on that command, capturing new keys for binding `slot` (-1 = a new one): the right-click
  // "Assign shortcut… / Change shortcut…" (quick.js)
  { id: 'palette.keys', title: 'Edit keyboard shortcuts', keys: ['Ctrl+Alt+K'], menu: 'Help', group: 'Keyboard', run: async (app, args) => {
    await hide();
    ui.focusKeys = args?.focus ? { id: args.focus, slot: args.slot ?? -1 } : true;   // KeysPanel focuses its search (or that command) when it sees this
    show('keys');
  } },
  // Blender's Quick Favourites (Q there; Q is Repeat last stroke here): your own commands for the tab you are in, at the pointer
  { id: 'quick.open', title: 'Quick menu', keys: ['Shift+Q'], menu: 'Help', group: 'Keyboard', tip: 'Your commands for this tab (right-click a button to add)', run: (app) => { openQuick(app); } },
  { id: 'palette.close', title: 'Close palette, help or shortcut editor', keys: ['Escape'], menu: 'Help', group: 'Keyboard', hidden: true, when: () => !!ui.open, run: () => hide() },
];
