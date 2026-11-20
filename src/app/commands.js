// commands.js -- the command registry: every user action, its default keys, user overrides, key dispatch.
// Pure apart from reading a DOM event (test/app-commands.test.mjs). The keymap, palette, menus, buttons and
// the help overlay all read this one registry.
//
// Command = { id: 'area.verb', title, keys?: ['Ctrl+Z'], when?: (app) => bool, run: (app, args?) => void, keyUp?: bool,
//             menu?: 'File'|'Edit'|..., group?: string (menu section), hidden?: bool (not in palette/menus), tip?: string (the menu item's kit tip),
//             aliases?: string[] (extra words the palette finds it by),
//             why?: (app) => string (why `when` is false: the palette's hint and status line for a disabled command),
//             checked?: (app) => bool (a toggle's state: the pressed look of a control bound to it, app/cmd.js),
//             keyWhen?: (app) => bool (where its keys reach it, on top of `when`: Blender's keymap context. Its button, menu row and
//             palette row run it wherever `when` holds: T tracks from the Track tab only, the Track button works in Refine too),
//             whileTyping?: bool (may its chord fire from a text field; default: every command outside the Edit menu),
//             repeat?: false (a held key's auto-repeat does not run it again: a toggle on a key, Tab = Groups),
//             anywhere?: bool (a safety control: its key runs it from anywhere, modal dialogs and text fields included;
//             no gate or tab scope turns it off),
//             presetKeys?: {ofs: ['5']} (paw-5zpf: its default keys in another keymap preset, setting keys.preset; `keys` is the
//             Blender preset's, the default. A user override wins over both, so switching preset never loses one) }
// Priority: commands registered earlier win a shared key (features register before the shell's own core
// commands, so a feature can specialise a key with `when`).

import { Matcher, eventChord, numpadChord, allowedWhileTyping, parseKeys, conflicts as findConflicts } from './keymap.js';

/** paw-5zpf: the keymap presets (setting keys.preset). blender: the number row picks the lane's selection mode, E extrudes, R
 *  rotates, . is the pivot; ofs: OpenFunscripter's number-row point placement, R record, , / . previous / next point. */
export const PRESETS = ['blender', 'ofs'];
export const presetOf = (v) => (PRESETS.includes(v) ? v : 'blender');
const norm = (ks) => (ks || []).map((k) => parseKeys(k) || k);

// a text entry: typing goes to it (a number field too). A <select>, a slider, a checkbox are controls, not text entries.
const TEXT_ENTRY = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=range]):not([type=color]):not([type=file]):not([type=image]), textarea, [contenteditable]:not([contenteditable=false])';
export const isTextField = (el) => !!el?.closest?.(TEXT_ENTRY);
const isButton = (el) => !!el?.closest?.('button, [role=button], summary, a[href]');
// where the arrows are the place's own on purpose: open menus, list popups, an open Select, dialogs, and regions that say so
// (the project page's cards: data-arrow-nav)
const ARROW_NAV = '[role=menu], [role=listbox], [role=dialog], dialog[open], [role=combobox][aria-expanded=true], [data-arrow-nav]';
// paw-g3zk: what takes a press itself (focus, or a popup's own items): the focused element is left alone
const TAKES_PRESS = `button, [role=button], summary, a[href], input, select, textarea, [tabindex], [contenteditable]:not([contenteditable=false]), [role^=menuitem], [role=option], ${ARROW_NAV}`;
const NAV_KEYS =new Set([' ', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
// an open menu, list popup or Select: where Space may pick (setting keys.spaceInMenus 'pick')
const MENU = '[role=menu], [role=listbox], [role=combobox][aria-expanded=true]';
// what a Space press presses when keyboard navigation is on (setting keys.uiNavigation): the focused control, not play / pause
const TAKES_SPACE = 'button, [role=button], summary, a[href], select, input[type=checkbox], input[type=radio], [role=switch], [role=checkbox], [role=radio], [role=tab], [role^=menuitem], [role=option], [role=slider]';
/** paw-ks21: what the focus guard does with a keydown. kind: 'text' (a text entry has focus) | 'menu' (an open menu, list
 *  popup or Select, MENU) | 'nav' (another place that owns its arrows, ARROW_NAV) | 'other'. -> 'app' (only the key map gets
 *  it: no focus move, no control pressed, nothing scrolls) | 'pass' (the browser and the focused element get it as before).
 *  Space and Tab are the app's everywhere but a text entry. paw-5z78, the settings: uiNav (keys.uiNavigation) passes them
 *  all (Tab and the arrows move focus, Space presses the focused control); spacePick (keys.spaceInMenus 'pick') passes Space
 *  in an open menu (it picks the highlighted item). */
export function keyRoute(key, kind, { uiNav = false, spacePick = false } = {}) {
  if (uiNav || !NAV_KEYS.has(key) || kind === 'text') return 'pass';
  if (key === ' ' && spacePick && kind === 'menu') return 'pass';
  return (kind === 'nav' || kind === 'menu') && key.startsWith('Arrow') ? 'pass' : 'app';
}
const kindOf = (el) => (isTextField(el) ? 'text' : el?.closest?.(MENU) ? 'menu' : el?.closest?.(ARROW_NAV) ? 'nav' : 'other');
// paw-pj8l: an open modal dialog holds the keyboard: nothing behind it acts on a key. A passKeys dialog (the assist overlay,
// whose keys are commands) is marked data-pass-keys and routes as the rest of the app does.
const MODAL = 'dialog:modal:not([data-pass-keys]), [aria-modal=true]:not([data-pass-keys])';

/** paw-m3b6: a `when` predicate that carries why it is false: why = 'Select points first' or (app) => string. The guard
 *  returns exactly what pred returns; whyNot reads its reason when the command has no `why` of its own. */
export const guard = (pred, why) => Object.assign((...a) => pred(...a), { why });
/** The reason of the first guard that is false for app ('' when none is): a composite guard's `why`. */
export function whyOf(app, ...guards) {
  for (const g of guards) if (!g(app)) return String((typeof g.why === 'function' ? g.why(app) : g.why) || '');
  return '';
}

export class Registry {
  cmds = [];          // in priority order
  byId = new Map();
  recent = [];        // ids, most recent first (palette)
  gate = null;        // (cmd) => bool: when set, only the commands it admits are enabled
  scope = null;       // the same, for the tabs (app.svelte.js): the home tab hides the editor, so its commands are off

  /** app: what run/when receive. getOverrides(): {id: ['Keys', ...]} (persisted by the caller). onError(e, cmd).
   *  getSetting(key, fallback): the keyboard settings (keys.uiNavigation, keys.spaceInMenus), read at every key. */
  constructor({ app = null, getOverrides = () => ({}), setOverrides = () => {}, onChange = () => {}, onError = (e) => console.error(e), onRun = () => {}, getSetting = (k, d) => d, onWhy = () => {} } = {}) {
    Object.assign(this, { app, getOverrides, setOverrides, onChange, onError, onRun, getSetting, onWhy });
    this.matcher = new Matcher();
    this.pendingTimer = 0;
    this.pointerTarget = null;
  }

  /** Adds commands (a list, or a list of lists). A duplicate id is skipped with a warning; returns the ids added. */
  register(list, source = '') {
    const added = [];
    for (const c of [list].flat(Infinity)) {
      if (!c || typeof c.id !== 'string' || typeof c.run !== 'function') { console.warn('[commands] bad command from', source, c); continue; }
      if (this.byId.has(c.id)) { console.warn('[commands] duplicate id', c.id, 'from', source, '(kept the first)'); continue; }
      // descriptors, not a spread: a `get title()` stays live ('Back to <file>')
      const cmd = Object.defineProperties({}, Object.getOwnPropertyDescriptors(c));
      Object.assign(cmd, { source, keys: norm(c.keys) });
      if (c.presetKeys) cmd.presetKeys = Object.fromEntries(Object.entries(c.presetKeys).map(([p, ks]) => [p, norm(ks)]));
      this.cmds.push(cmd); this.byId.set(c.id, cmd); added.push(c.id);
    }
    this.rebuild();
    return added;
  }
  unregister(ids) {
    const s = new Set(ids);
    this.cmds = this.cmds.filter((c) => !s.has(c.id));
    for (const id of s) this.byId.delete(id);
    this.rebuild();
  }

  get(id) { return this.byId.get(id) || null; }
  /** paw-5zpf: the active keymap preset (setting keys.preset). */
  get preset() { return presetOf(this.getSetting('keys.preset', 'blender')); }
  /** The command's default keys in the active preset. */
  defaultKeys(id) {
    const c = this.byId.get(id);
    return c?.presetKeys?.[this.preset] ?? c?.keys ?? [];
  }
  /** Effective keys: the user's override if there is one, else the command's defaults (in the active preset). */
  keysFor(id) {
    const o = this.getOverrides()[id];
    return Array.isArray(o) ? o : this.defaultKeys(id);
  }
  isOverridden(id) { return Array.isArray(this.getOverrides()[id]); }
  enabled(id) {
    const c = this.byId.get(id);
    if (!c) return false;
    if (!c.anywhere && this.gate && !this.gate(c)) return false;   // a modal workspace (image labelling, paw-714j) keeps the rest of the app's keys off
    if (!c.anywhere && this.scope && !this.scope(c)) return false;
    try { return !c.when || !!c.when(this.app); } catch { return false; }
  }
  /** Do its keys reach it here (its keyWhen)? enabled() is the rest. */
  keyOk(id) {
    const c = this.byId.get(id);
    try { return !c?.keyWhen || !!c.keyWhen(this.app); } catch { return false; }
  }
  /** Why the command is off right now (its `why`, else its guarded `when`'s), '' when it is on or says nothing. */
  whyNot(id) {
    const c = this.byId.get(id);
    if (!c || this.enabled(id)) return '';
    return this.#say(c.why) || this.#say(c.when?.why);
  }
  #say(w) {
    try { return String((typeof w === 'function' ? w(this.app) : w) || ''); } catch { return ''; }
  }
  /** [{id, title, keys, enabled, menu, group, source, hidden}] in registration order. {enabled: false} skips the
   *  `when` predicates (enabled is then undefined): menu builders call enabled(id) lazily instead. */
  list({ enabled = true } = {}) { return this.cmds.map((c) => ({ id: c.id, title: c.title || c.id, keys: this.keysFor(c.id), enabled: enabled ? this.enabled(c.id) : undefined, menu: c.menu, group: c.group, source: c.source, hidden: !!c.hidden, tip: c.tip, aliases: c.aliases })); }
  bindings() { return this.cmds.flatMap((c) => this.keysFor(c.id).map((k) => [c.id, k])); }
  /**
   * Key collisions. A key shared by commands that all but one guard with `when` is by design (Esc closes the
   * palette, cancels a job, else clears the selection; the first enabled one in priority order runs): it is
   * reported only with {all: true}, as kind 'shared'. Real conflicts: two or more unguarded commands on one key
   * (the later ones can never run), any collision involving a user override, and sequence prefixes.
   */
  conflicts({ all = false } = {}) {
    const out = [];
    for (const c of findConflicts(this.bindings())) {
      if (c.kind !== 'same') { out.push(c); continue; }
      const unguarded = c.ids.filter((id) => !this.byId.get(id)?.when).length;
      // a user conflict is a key the user ADDED (an override that keeps a default key collides as before: shared)
      const user = c.ids.some((id) => this.isOverridden(id) && !this.defaultKeys(id).includes(c.keys));
      if (unguarded > 1 || user) out.push(c);
      // shared with nothing but hidden, guarded helpers (an overlay swallowing keys while it is open): not worth a flag
      else if (all && c.ids.filter((id) => !this.byId.get(id)?.hidden).length > 1) out.push({ ...c, kind: 'shared' });
    }
    return out;
  }

  /** Runs a command if its `when` allows. Returns true if it ran. Errors go to onError, never up. */
  run(id, args) {
    const c = this.byId.get(id);
    if (!c) { console.warn('[commands] unknown', id); return false; }
    if (!this.enabled(id)) return false;
    this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, 30);
    try {
      const r = c.run(this.app, args);
      if (r && typeof r.catch === 'function') r.catch((e) => this.onError(e, c));
    } catch (e) { this.onError(e, c); }
    this.onRun(c, this.via || '');
    return true;
  }

  /** Which command a key would run right now: the first enabled one bound to it, in priority order (ids in `skip` ignored). */
  winner(keys, skip = []) {
    const k = parseKeys(keys);
    return this.cmds.find((c) => !skip.includes(c.id) && this.keysFor(c.id).includes(k) && this.enabled(c.id) && this.keyOk(c.id))?.id || null;
  }

  /** Rebind: keys = ['Ctrl+K'] (or [] to unbind); null resets to the default. */
  setKeys(id, keys) {
    const o = { ...this.getOverrides() };
    if (keys == null) delete o[id];
    else o[id] = keys.map((k) => parseKeys(k)).filter(Boolean);
    this.setOverrides(o);
    this.rebuild();
  }
  resetAll() { this.setOverrides({}); this.rebuild(); }

  rebuild() { this.built = this.preset; this.matcher.set(this.bindings()); this.onChange(); }

  // ---- dispatch ----
  /** Call from a capture-phase pointerdown: Space/Enter on a button the mouse just clicked goes to the app, not the button.
   *  paw-g3zk: a press on an area makes it the key context. A press outside the focused element, on nothing that takes
   *  focus or the click itself, blurs that element: the browser would, but a handler that prevents the press's default
   *  (the video's tools do) keeps a timeline row focused, whose lane-scoped `when`s then refuse the area's keys (G).
   *  A focused text entry keeps its focus (a popup that keeps the caret prevents the press on purpose). */
  notePointer(e) {
    const t = e.target;
    this.pointerTarget = t?.closest?.('button, [role=button], summary') || null;
    if (this.held) this.held.dragged = true;
    // paw-6bkv: a text selection left on the page would make the next drag on the timeline a native drag of that text (the
    // browser cancels the pointer): a press outside a text field drops it (a new selection starts as usual)
    const sel = t?.ownerDocument?.getSelection?.();
    if (sel?.type === 'Range' && !isTextField(t)) sel.removeAllRanges();
    const a = t?.ownerDocument?.activeElement;
    if (a?.blur && !isTextField(a) && !a.contains?.(t) && !t.closest?.(TAKES_PRESS)) a.blur();
  }

  /** paw-ks21: call from a capture-phase keydown on document (window-capture listeners, which observe or own keys such
   *  as Space-held or a key-capture cell, have run). Space, Tab and the arrows outside a text entry go to the key map
   *  and nowhere else: the focused button / checkbox / select / slider / summary never sees them, focus never moves, no
   *  panel scrolls. Returns true when it took the key. */
  guardKey(e) {
    if (e.isComposing) return false;
    if (this.#anywhere(e)) return true;
    // paw-pj8l: a key inside a modal is the dialog's (Enter, Escape, Tab between its fields, Space on its focused button,
    // typing in its fields); its own fence (kit Dialog, the palette overlays) keeps it from the key map. With a modal open
    // and focus outside it (on the page body), the key goes nowhere: only Escape still reaches the dialog's cancel.
    const t = e.target;
    if (t?.closest?.(MODAL)) {
      // a chord on Space / Tab is no dialog key either: Ctrl+Shift+Space (the device preview) would press its focused button
      if ((e.key === ' ' || e.key === 'Tab') && (e.ctrlKey || e.altKey || e.metaKey)) e.preventDefault();
      return false;
    }
    if (t?.ownerDocument?.querySelector?.(MODAL)) {
      e.stopPropagation();
      if (e.key !== 'Escape') e.preventDefault();
      return true;
    }
    if (keyRoute(e.key, kindOf(t), this.#keyOpts()) !== 'app') return false;
    e.stopPropagation();
    this.handleKey(e);
    e.preventDefault();
    return true;
  }

  #keyOpts() { return { uiNav: this.getSetting('keys.uiNavigation', false) === true, spacePick: this.getSetting('keys.spaceInMenus', 'play') === 'pick' }; }
  /** paw-pj8l: a command marked `anywhere` (the device panic stop) runs from wherever its key is pressed: a text field, a
   *  modal dialog, the project page, a modal workspace. Checked first, before any fence. */
  #anywhere(e) {
    const chord = eventChord(e);
    const c = chord && this.cmds.find((x) => x.anywhere && this.keysFor(x.id).includes(chord) && this.enabled(x.id) && this.keyOk(x.id));
    if (!c) return false;
    e.preventDefault();
    e.stopPropagation();
    this.via = 'key'; try { this.run(c.id); } finally { this.via = ''; }
    return true;
  }

  /** Call from window keydown. Returns true if a command handled it (the event is then prevented). */
  handleKey(e) {
    if (e.isComposing || e.defaultPrevented) return false;
    const chord = eventChord(e);
    if (!chord) return false;
    const t = e.target;
    const typing = isTextField(t);
    if (typing && !allowedWhileTyping(chord)) return false;
    // paw-90gd: Ctrl+C with page text selected (the crash screen's error, a toast) is the browser's copy, not a command's
    if (chord === 'Ctrl+C' && !typing && String(globalThis.getSelection?.() || '').trim()) return false;
    // Space is the app's (play / pause), not the focused control's; Enter still activates a focused button. paw-5z78: with
    // keyboard navigation on, Space presses the focused control instead; with keys.spaceInMenus 'pick', an open menu's Space
    // picks its item (the guard passed it on); neither also plays
    if (chord === 'Space') {
      const o = this.#keyOpts();
      if ((o.uiNav && t?.closest?.(TAKES_SPACE)) || (o.spacePick && t?.closest?.(MENU))) return false;
    }
    // keyboard navigation on: a native slider or select keeps its arrows (the kit's own roving controls prevent theirs)
    if (/^Arrow/.test(chord) && t?.closest?.('input[type=range], select') && this.#keyOpts().uiNav) return false;
    if (isButton(t) && chord === 'Enter' && t.closest('button, [role=button], summary, a[href]') !== this.pointerTarget) return false;
    if (this.held && e.code === this.held.code) { e.preventDefault(); return true; }   // auto-repeat of a key-up command
    clearTimeout(this.pendingTimer);
    if (this.built !== this.preset) this.rebuild();   // the preset changed (Settings, a Prop): its defaults are the bindings now
    // paw-5zpf: a NumPad digit reaches a binding on its own chord ('Num5') first, else the number row's digit as before
    const np = numpadChord(e), mn = np && this.matcher.feed(np, e.timeStamp || Date.now());
    if (mn && !mn.pending && mn.ids.some((id) => this.enabled(id) && this.keyOk(id) && (!typing || this.typingOk(id)))) return this.#first(mn.ids, e);
    const m = this.matcher.feed(chord, e.timeStamp || Date.now());
    if (!m) return false;
    if (m.pending) {
      // a prefix of a longer sequence: wait; if nothing follows, run what the prefix alone is bound to
      if (m.ids.length) this.pendingTimer = setTimeout(() => { this.matcher.reset(); this.#first(m.ids, e); }, this.matcher.timeout);
      e.preventDefault();
      return true;
    }
    return this.#first(typing && chord !== 'Escape' ? m.ids.filter((id) => this.typingOk(id)) : m.ids, e);
  }
  /** From a text field only navigation / overlay chords run: never a document edit (an Edit-menu command, unless
   *  it sets whileTyping: true), nor a command that sets whileTyping: false. */
  typingOk(id) {
    const c = this.byId.get(id);
    return !!c && (c.whileTyping ?? c.menu !== 'Edit');
  }
  #first(ids, e) {
    for (const id of ids) if (this.enabled(id) && this.keyOk(id)) {
      e.preventDefault?.();
      if (e.repeat && this.byId.get(id).repeat === false) return true;   // held: the press already ran it once
      // keyUp commands (Space = play) fire on release, and not at all if the pointer was used while the key
      // was held (Space-drag pans a lane)
      if (this.byId.get(id).keyUp && e.code) this.held = { id, code: e.code, dragged: false };
      else { this.via = 'key'; try { this.run(id); } finally { this.via = ''; } }
      return true;
    }
    // paw-vhcd: nothing ran; a key whose command says why it is off (Ctrl+Alt+S with nothing to publish) says it, as its
    // menu item does, instead of doing nothing silently. Only a command's own `why`: a guard's reason (no selection) stays
    // off the keys, else every arrow / Escape press with nothing selected would toast
    for (const id of ids) {
      const c = this.byId.get(id);
      if (!c?.why || !this.keyOk(id) || (!c.anywhere && ((this.gate && !this.gate(c)) || (this.scope && !this.scope(c))))) continue;
      const why = this.#say(c.why);
      if (why) { e.preventDefault?.(); this.onWhy(why, c); return true; }
    }
    return false;
  }
  /** Call from window keyup. */
  handleKeyUp(e) {
    const h = this.held;
    if (!h || e.code !== h.code) return false;
    this.held = null;
    if (!h.dragged) { this.via = 'key'; try { this.run(h.id); } finally { this.via = ''; } }
    e.preventDefault?.();
    return true;
  }
}
