// quick.js -- the Quick menu (Blender's Quick Favourites, in this app's terms) and the one right-click contract for anything
// bound to a command. Lists: logic.js (settings 'quick.lists', one per stage tab, 'home' for the project page).
//  - quick.open (Shift+Q) opens the list of the tab you are in at the pointer, as a kit context menu: title and current key,
//    a disabled one greyed with its why (its tip), Enter / click runs, first letter and arrows move.
//  - Any [data-command] element (a menu-bar row, a palette row, a kit button tied to a command, a Quick menu row) answers right
//    click with: Add to / Remove from Quick menu, Assign shortcut… / Change shortcut (currently X)… (the keybinding editor,
//    capturing for that command); a Quick menu row also Move up / Move down (the menu opens again where it was). Where the
//    element already has a context menu these end it (kit contextExtras); nothing is converted to a command here.
//  - A setting is in a list as 'setting:<key>' (paw-m3b6: a Prop's right click adds it): its row shows the value; a boolean's
//    row toggles it, any other opens the Settings panel at the row. Its right click: Remove, Move up / down (no shortcut).
import { showContextMenu, contextExtras } from '../../ui/kit/contextmenu.js';
import { fmtKeys } from '../../app/keymap.js';
import { metaOf } from '../../app/settings.svelte.js';
import { quickKey, quickIds, quickEdit, quickAdd, quickRemove, quickMove, valueText } from './logic.js';
import { openSettingAt, toggleSetting } from '../settings/logic.js';

const KEY = 'quick.lists';
const NAMES = { home: 'Projects', scenes: 'Scenes', track: 'Track', refine: 'Refine', review: 'Review' };
const LABEL = 'Quick menu';
let pointer = null;   // the last pointer position: the menu opens there
let last = null;      // where the Quick menu last opened: an edit made in it opens it there again

const listKey = (app) => quickKey(!!app.tabs?.home, app.mode);
const SET = 'setting:';
/** A 'setting:<key>' id's schema entry (with its choices as options), else null. */
const settingOf = (id) => (id.startsWith(SET) ? metaOf(id.slice(SET.length)) : null);
const known = (app) => (id) => !!app.commands.get(id) || !!settingOf(id);
/** The commands of the list that applies now, in order (ids the registry does not know left out). */
export const quickList = (app) => quickIds(app.settings.get(KEY), listKey(app)).filter(known(app));
const edit = (app, f) => app.settings.set(KEY, quickEdit(app.settings.get(KEY), listKey(app), known(app), f));
/** Is the setting in the Quick menu of the tab you are in? */
export const quickHas = (app, key) => quickList(app).includes(SET + key);
/** Add the setting to the Quick menu of the tab you are in, or take it out. */
export const quickToggle = (app, key) => edit(app, (l) => (l.includes(SET + key) ? quickRemove(l, SET + key) : quickAdd(l, SET + key)));

/** Opens the Quick menu at `at` (a point; default the pointer, else the upper middle of the window). -> close() */
export function openQuick(app, at = pointer) {
  last = at ?? { x: innerWidth / 2, y: innerHeight / 3 };
  const ids = quickList(app);
  const items = ids.map((id) => {
    const m = settingOf(id);
    if (m) {
      const key = id.slice(SET.length), v = app.settings.get(key), flip = m.type === 'boolean' && !m.readonly;
      return { label: `${m.label} (${valueText(m, v)})`, command: id, ...(flip ? { type: 'checkbox', checked: v === true } : {}), tip: m.doc,
        run: () => (flip ? toggleSetting(app, key) : openSettingAt(app, key)) };
    }
    const c = app.commands.get(id), k = app.commands.keysFor(id)[0], on = app.commands.enabled(id);
    return { label: c.title || id, command: id, shortcut: k ? fmtKeys(k) : undefined, disabled: !on, tip: (!on && app.commands.whyNot(id)) || c.tip, run: () => app.commands.run(id) };
  });
  if (!items.length) items.push({ label: 'Empty: right-click any button or menu item to add', disabled: true });
  return showContextMenu(last, [{ section: `${LABEL} · ${NAMES[listKey(app)] || listKey(app)}` }, ...items], { label: LABEL, source: document.activeElement });
}

/** The right-click entries for the [data-command] element el is in (none when it is in none, or its command is unknown). */
export function commandEntries(app, el) {
  const id = el.closest?.('[data-command]')?.dataset.command;
  const c = id && (app.commands.get(id) || settingOf(id));
  if (!c) return [];
  const ids = quickList(app), i = ids.indexOf(id), k = app.commands.keysFor(id)[0];
  const inMenu = !!el.closest(`[role=menu][aria-label="${LABEL}"]`);
  const again = () => { if (inMenu) openQuick(app, last); };   // an edit made in the Quick menu: it stays open
  const out = [i < 0
    ? { label: 'Add to Quick menu', run: () => edit(app, (l) => quickAdd(l, id)) }
    : { label: 'Remove from Quick menu', run: () => { edit(app, (l) => quickRemove(l, id)); again(); } }];
  if (inMenu && i >= 0) out.push(
    { label: 'Move up', disabled: i === 0, run: () => { edit(app, (l) => quickMove(l, id, -1)); again(); } },
    { label: 'Move down', disabled: i === ids.length - 1, run: () => { edit(app, (l) => quickMove(l, id, 1)); again(); } });
  if (!settingOf(id)) out.push({ label: k ? `Change shortcut (currently ${fmtKeys(k)})…` : 'Assign shortcut…', run: () => app.commands.run('palette.keys', { focus: id, slot: k ? 0 : -1 }) });
  return out;
}

/** Once per shown app (QuickHost.svelte): the right-click contract and the pointer. -> uninstall */
export function installQuick(app) {
  const off = contextExtras((el) => commandEntries(app, el));
  const at = (e) => { pointer = { x: e.clientX, y: e.clientY }; };
  addEventListener('pointermove', at, { capture: true, passive: true });
  addEventListener('pointerdown', at, { capture: true, passive: true });
  return () => { off(); removeEventListener('pointermove', at, { capture: true }); removeEventListener('pointerdown', at, { capture: true }); };
}
