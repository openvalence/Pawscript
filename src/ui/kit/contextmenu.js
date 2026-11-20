/**
 * contextmenu.js -- the context menu: an attachment for any element, and a programmatic opener.
 *
 *   <div {@attach contextMenu([{ label: 'Delete', shortcut: 'Del', run: del }])}>…</div>
 *   <canvas {@attach contextMenu((e) => itemsAt(e), { onselect })}></canvas>
 *   showContextMenu(event, items, { onselect, onclose })   // -> close()
 *
 * Opens on a right-click at the pointer, and on Shift+F10 / the ContextMenu key at the focused element.
 * One context menu at a time. It mounts a Menu on <body> that takes the theme and density of the element it
 * was opened from; focus returns to what had it on close.
 */
import { mount, unmount } from 'svelte';
import Menu from './Menu.svelte';

let closeCurrent = null;
let extras = null;     // contextExtras(): (el) -> MenuItem[] that end every context menu opened on el
let hit = null;        // the right-click being answered: {el, opened}
let taken = null;      // a right-click whose element's own handler took it (prevented it): {el, t}; its menu may open late
let openedAt = -1e9;
let openEl = null;     // the element the open menu was opened beside (a dropdown's button); null for a point / right-click
let listening = false; // the page-wide contextmenu listener (contextExtras, property)
const props = new WeakMap();   // property(): element -> () => its handle
let clip;              // the last value Copy value took (Paste value's fallback when the system clipboard says no)

/**
 * Open a context menu. `at`: a MouseEvent (opens at the pointer, its default menu prevented), a point
 * {x, y}, or an Element (opens beside it). opts: onselect(item, e), onclose(reason), source (the element
 * whose theme it takes; default the event target / element), label (the panel's aria-label), initial ('first': the first row
 * active, as from the keyboard), onactive(item | null) (the row the pointer / keys are on). Nothing to show (no items and
 * no contextExtras entries): nothing opens. -> close()
 */
export function showContextMenu(at, items, { onselect, onclose, source, label = 'Context menu', initial = 'auto', onactive } = {}) {
  // a second click on the button its menu hangs from closes it (the anchor is exempt from the outside-press dismiss)
  if (at instanceof Element && closeCurrent && openEl === at) { closeCurrent(); return () => {}; }
  let anchor = at, on = at instanceof Element ? at : null;
  if (at instanceof Element) source ??= at;
  else if (at && 'clientX' in at) {
    at.preventDefault?.();
    anchor = { x: at.clientX, y: at.clientY };
    source ??= at.target;
    on = at.target;
  }
  // the right-click in flight (a handler may open its menu at a point, or from an effect a moment later) names the element
  if (hit) { on = hit.el; hit.opened = true; }
  // an owner that opens its menu from an effect after the click is done (seen under load): still that click's element
  else if (taken && performance.now() - taken.t < 500) { on = taken.el; taken = null; }
  for (const more of on instanceof Element ? [propertyEntries(propertyOf(on)), extras?.(on) || []] : []) {
    if (more.length) items = [...items, ...(items.length ? [{ separator: true }] : []), ...more];
  }
  if (!items.length) return () => {};
  closeCurrent?.();
  openedAt = performance.now();
  const near = (attr) => (source instanceof Element ? source.closest(`[${attr}]`)?.getAttribute(attr) : undefined) ?? undefined;
  let app = null;
  const el = at instanceof Element ? at : null;
  const close = () => {
    if (!app) return;
    const a = app;
    app = null;
    if (closeCurrent === close) { closeCurrent = null; openEl = null; }
    unmount(a);
  };
  app = mount(Menu, {
    // inside an open (modal) dialog when opened from one: outside it the page is inert
    target: (source instanceof Element && source.closest('dialog[open]')) || document.body,
    props: {
      items, anchor, open: true, offset: at instanceof Element ? 2 : 0, label, initial, onactive,
      'data-theme': near('data-theme'), 'data-density': near('data-density'),
      onselect,
      onclose: (reason) => { queueMicrotask(close); onclose?.(reason); },
    },
  });
  closeCurrent = close; openEl = el;
  return close;
}

/**
 * One right-click contract for the whole page: fn(el) -> MenuItem[] for the element a right-click landed on (the app: the
 * command entries of a [data-command] control). They end every context menu opened from that click, after a separator, however
 * its owner opens it (at the event, at a point, from an effect); an element nothing else answers gets a menu of them alone.
 * A property's entries (property() below) come first, then these. One at a time (a second call replaces the first). -> uninstall
 */
export function contextExtras(fn) {
  extras = fn;
  listen();
  return () => { if (extras === fn) extras = null; };
}

function listen() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('contextmenu', (e) => {
    if (performance.now() - openedAt < 300) return;   // Chromium's own contextmenu after a key-opened menu (as contextMenu())
    const t = e.target;
    if (t instanceof Element && t.matches('input, textarea') && t === document.activeElement) return;   // typing: the native cut / copy / paste
    const h = hit = { el: t, opened: false };
    const fromKey = e.button !== 2 && !e.clientX && !e.clientY;   // Shift+F10 / the ContextMenu key: beside the element
    // after the click's handlers and the effects they start: nothing opened a menu -> the entries alone
    setTimeout(() => {
      if (!h.opened && !h.taken && h.el instanceof Element && h.el.isConnected) showContextMenu(fromKey ? keyAnchor(h.el) : e, []);
      if (hit === h) hit = null;
    }, 0);
  }, true);
  // as it bubbles to the document, before the app's window-wide preventDefault (boot.js): an element's own right click that
  // opened something else (the Track button's tracker popover) prevented it, so no menu of the entries alone; a property
  // prevents it here (its own menu, never the input's native one)
  document.addEventListener('contextmenu', (e) => {
    if (hit?.el !== e.target) return;
    if (e.defaultPrevented) { hit.taken = true; if (!hit.opened) taken = { el: e.target, t: performance.now() }; }
    else if (e.target instanceof Element && propertyOf(e.target)) e.preventDefault();
  });
}

/**
 * Attachment: the element is a property, one value with a default (Blender's RNA property: the same right click everywhere).
 * get() -> { value, default, set(v), reset?(), format?(v), parse?(text), disabled?, more?() } is read when the menu opens.
 * A right-click on it or inside it ends its context menu with: Reset to default (<default>) (when it has one; off at the
 * default), Copy value, Paste value, then more() (the app's own: Show in Settings, Quick menu). The innermost property wins.
 * NumberField and Slider attach one when given a `default`; ParamForm rows and the app's Prop always do.
 */
export function property(get) {
  return (node) => {
    props.set(node, get);
    listen();
    return () => props.delete(node);
  };
}

/** The handle of the innermost property el is in, or null. */
export function propertyOf(el) {
  for (let n = el; n; n = n.parentElement) { const g = props.get(n); if (g) return g(); }
  return null;
}

/** Reset the property el is in to its default (ParamForm's reset dot: the same reset as the menu's). -> done */
export function resetProperty(el) {
  const h = propertyOf(el);
  if (!h || h.default === undefined || h.disabled) return false;
  h.reset ? h.reset() : h.set(h.default);
  return true;
}

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
/** A value as the menu and the clipboard write it: format(v) for the label, the bare value for Copy. */
const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
/** Clipboard text back to a value of the kind `like` is: a number parsed (1,5 / 40 ms), true / false, a string as is. */
export function parseValue(text, like, parse) {
  if (parse) return parse(text);
  const t = String(text ?? '').trim();
  if (!t) return undefined;   // an empty clipboard is no value (Number('') would be 0)
  if (typeof like === 'number') { const n = Number(t.replace(',', '.').replace(/^(-?[\d.]+(?:e[-+]?\d+)?).*$/i, '$1')); return Number.isFinite(n) ? n : undefined; }
  if (typeof like === 'boolean') return /^(true|on|1)$/i.test(t) ? true : /^(false|off|0)$/i.test(t) ? false : undefined;
  if (typeof like === 'string') return t;
  try { return JSON.parse(t); } catch { return undefined; }
}

/** A property handle's menu entries (pure but for the clipboard). */
export function propertyEntries(h) {
  if (!h) return [];
  const fmt = (v) => (h.format ? h.format(v) : asText(v));
  const out = [];
  if (h.default !== undefined) out.push({ label: `Reset to default (${fmt(h.default)})`, disabled: !!h.disabled || same(h.value, h.default), run: () => (h.reset ? h.reset() : h.set(h.default)) });
  out.push(
    { label: 'Copy value', run: () => { clip = h.value; navigator.clipboard?.writeText(asText(h.value)).catch(() => {}); } },
    { label: 'Paste value', disabled: !!h.disabled, run: async () => {
      let v;
      // (a clipboard that never answers, e.g. a permission prompt left open, falls back after a moment)
      const read = Promise.race([navigator.clipboard.readText(), new Promise((_, no) => setTimeout(() => no(new Error('no answer')), 1500))]);
      try { v = parseValue(await read, h.value, h.parse); } catch { /* no clipboard permission */ }
      if (v === undefined && clip !== undefined) v = parseValue(asText(clip), h.value, h.parse);
      if (v !== undefined && !same(v, h.value)) h.set(v);
    } },
  );
  return [...out, ...(h.more?.() || [])];
}

/** Where a keyboard-opened menu goes: beside a small element, inside the top-left corner of a large one. */
function keyAnchor(el) {
  const r = el.getBoundingClientRect();
  return r.height <= 64 ? el : { x: r.left + 8, y: r.top + 8 };
}

/**
 * Attachment: `items` is MenuItem[] or (event) => MenuItem[] (empty / null = no menu, the browser's own
 * shows). opts: onselect(item, e), onclose(reason).
 */
export function contextMenu(items, opts = {}) {
  return (node) => {
    let keyedAt = -1e9;
    const list = (e) => (typeof items === 'function' ? items(e) : items);
    const open = (at, e) => {
      const its = list(e);
      if (!its?.length) return false;
      showContextMenu(at, its, { ...opts, source: node });
      return true;
    };
    const onctx = (e) => {
      // Chromium may still send its own contextmenu after the key opened ours.
      if (performance.now() - keyedAt < 500) { e.preventDefault(); return; }
      const fromKey = e.button !== 2 && !e.clientX && !e.clientY;
      if (open(fromKey ? keyAnchor(e.target instanceof Element ? e.target : node) : e, e)) e.preventDefault();
    };
    const onkey = (e) => {
      if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
      if (open(keyAnchor(e.target instanceof Element && node.contains(e.target) ? e.target : node), e)) {
        e.preventDefault();
        e.stopPropagation();
        keyedAt = performance.now();
      }
    };
    node.addEventListener('contextmenu', onctx);
    node.addEventListener('keydown', onkey);
    return () => {
      node.removeEventListener('contextmenu', onctx);
      node.removeEventListener('keydown', onkey);
    };
  };
}
