/**
 * focus.js -- keyboard plumbing shared by the kit: which item an arrow key moves to (roving tabindex and
 * active-descendant lists), typeahead, and a focus trap. nextIndex() and createTypeahead() are pure.
 */

/**
 * The index an arrow / Home / End key moves to in a list of `count` items, skipping disabled ones.
 * Returns null when the key is not a navigation key for this orientation (let it through).
 * @param {number} count
 * @param {number} current  -1 when nothing is active yet
 * @param {string} key      KeyboardEvent.key
 * @param {{orientation?: 'vertical'|'horizontal'|'both', loop?: boolean, disabled?: (i:number)=>boolean, page?: number}} [o]
 */
export function nextIndex(count, current, key, o = {}) {
  const { orientation = 'vertical', loop = true, disabled = () => false, page = 10 } = o;
  const fwd = { vertical: ['ArrowDown'], horizontal: ['ArrowRight'], both: ['ArrowDown', 'ArrowRight'] }[orientation];
  const back = { vertical: ['ArrowUp'], horizontal: ['ArrowLeft'], both: ['ArrowUp', 'ArrowLeft'] }[orientation];
  if (count <= 0) return null;
  const firstFrom = (i, dir) => {
    for (let n = 0; n < count; n++, i += dir) {
      if (i < 0 || i >= count) {
        if (!loop) return null;
        i = (i + count) % count;
      }
      if (!disabled(i)) return i;
    }
    return null;
  };
  const clampFrom = (i, dir) => {
    i = Math.max(0, Math.min(count - 1, i));
    for (; i >= 0 && i < count; i += dir) if (!disabled(i)) return i;
    return null;
  };
  if (key === 'Home') return firstFrom(0, 1);
  if (key === 'End') return clampFrom(count - 1, -1);
  if (key === 'PageDown' && orientation !== 'horizontal') return clampFrom(current < 0 ? page - 1 : current + page, -1) ?? clampFrom(count - 1, -1);
  if (key === 'PageUp' && orientation !== 'horizontal') return clampFrom(current < 0 ? 0 : current - page, 1) ?? clampFrom(0, 1);
  if (fwd.includes(key)) return current < 0 ? firstFrom(0, 1) : (firstFrom(current + 1, 1) ?? current);
  if (back.includes(key)) return current < 0 ? clampFrom(count - 1, -1) : (firstFrom(current - 1, -1) ?? current);
  return null;
}

/**
 * Typeahead: type the start of a label to jump to it. Keys within `timeout` ms build one search string;
 * pressing the same letter again cycles through the items starting with it.
 * -> (key, labels, current) => index | null
 */
export function createTypeahead({ timeout = 600, now = () => Date.now() } = {}) {
  let buf = '', last = 0;
  return (key, labels, current = -1, disabled = () => false) => {
    const t = now();
    if (t - last > timeout) buf = '';
    // A space only continues a search ("New f…"); on its own it is the activation key.
    if (key.length !== 1 || (key === ' ' && !buf)) return null;
    buf += key.toLowerCase();
    last = t;
    const n = labels.length;
    const same = [...buf].every((c) => c === buf[0]);
    const q = same ? buf[0] : buf;
    // A fresh search or a repeated letter starts after the current item; a longer word keeps it if it matches.
    const start = same || buf.length === 1 ? current + 1 : Math.max(current, 0);
    for (let k = 0; k < n; k++) {
      const i = (start + k + n) % n;
      if (!disabled(i) && String(labels[i] ?? '').toLowerCase().trimStart().startsWith(q)) return i;
    }
    return null;
  };
}

export const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Focusable, visible descendants of `root` in tab order. */
export function tabbables(root) {
  return [...root.querySelectorAll(TABBABLE)].filter((el) => !el.closest('[inert]') && el.getClientRects().length > 0);
}

/**
 * Keep Tab inside `root` (wraps at both ends). Focus moves to `initial`, the first [autofocus], or the first
 * tabbable; on release focus returns to `returnTo` (what had focus at the call). -> release()
 */
export function trapFocus(root, initial, returnTo = document.activeElement) {
  const before = returnTo;
  const key = (e) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;   // paw-pj8l: Ctrl+Tab is no field move in a dialog
    const list = tabbables(root);
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  root.addEventListener('keydown', key);
  (initial || root.querySelector('[autofocus]') || tabbables(root)[0] || root).focus({ preventScroll: true });
  return () => {
    root.removeEventListener('keydown', key);
    if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
  };
}

/** A stable unique id for aria wiring. */
let uid = 0;
export const nextId = (prefix = 'k') => `${prefix}-${(++uid).toString(36)}`;

/** Keys that move focus (Tab between fields, the arrows in a list or a roving group). */
const FOCUS_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
/**
 * paw-hdxk: html[data-input] = 'pointer' after a press, 'keys' once one of FOCUS_KEYS actually moves focus; theme.css hides
 * the focus ring under 'pointer'. Chromium paints :focus-visible on a clicked button as soon as ANY key goes down (Escape
 * closing a popover and handing focus back to its button, a shortcut), and the app takes Tab and the arrows for itself
 * (commands.js guardKey), so "a key went down" says nothing; "focus moved during a focus key" does, whoever moved it (a
 * dialog's Tab trap, a list's arrows). Capture listeners: nothing that stops the key hides it. Returns the uninstaller.
 */
export function trackInputModality(win = window) {
  let nav = false;
  const set = (v) => { win.document.documentElement.dataset.input = v; };
  const ls = [
    ['pointerdown', () => { nav = false; set('pointer'); }],
    ['keydown', (e) => { nav = FOCUS_KEYS.has(e.key); }],
    ['keyup', () => { nav = false; }],
    ['focusin', () => { if (nav) set('keys'); }],
  ];
  for (const [t, f] of ls) win.addEventListener(t, f, true);
  return () => { for (const [t, f] of ls) win.removeEventListener(t, f, true); };
}
