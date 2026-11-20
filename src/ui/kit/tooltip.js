/**
 * tooltip.js -- the one tooltip, as a Svelte attachment.
 *
 *   <button {@attach tooltip('Play', 'Space')}>…</button>
 *   <div {@attach tooltip({ text: 'Snap to frames', shortcut: 'S', placement: 'bottom' })}>…</div>
 *
 * Shows after `delay` (500 ms) on hover and at once on keyboard focus; while one tip was shown in the last
 * 400 ms the next shows at once (sweeping a toolbar reads every button). Never takes the pointer. Sets
 * aria-keyshortcuts for the shortcut. A single shared top-layer element (.k-tip in theme.css), placed by
 * position.js, so opening one tip closes any other.
 *
 * A tip must never outlive the reason it is shown. Events alone miss cases (a button that closes its own
 * panel is removed or hidden under a still pointer, so no pointerleave ever comes), so besides the events
 * (leave, blur, any press, Escape, scroll of anything, window blur or resize, tab hidden, the attachment's
 * teardown) a watchdog re-checks keepTip() while one is shown: the trigger still connected, still rendered,
 * and still hovered (or still focused, for a keyboard-shown tip). Nothing shows while a pointer button is down,
 * nor on a trigger whose menu or popover is open (aria-expanded="true"; kit Menu sets it on its anchor).
 * Any native title= is turned into one of these tips on its first hover (adoptTitle below); dev and test builds strip
 * every title= the moment it appears and warn (guardTitles), and test/no-native-title.test.mjs keeps them out of src.
 *
 * Hide rules on top of the events, because over a remote-desktop stream (Sunshine) the cursor jumps and :hover
 * sticks: any pointermove/pointerover whose target is not inside the trigger, or whose position is off its box;
 * the pointer leaving the window (pointerout with no relatedTarget, mouseleave of the document); pointercancel,
 * contextmenu, dragstart; the trigger or an ancestor detached, display:none, visibility/opacity hidden, inert or
 * [hidden]; and a hard cap: a hover tip lives MAX_HOVER_MS after the last pointer move inside its trigger.
 *
 * And it must not stay *painted*: theme.css hides [popover]:not(:popover-open) with !important, because .k-tip's
 * display:flex outranks the UA rule and a hidden tip used to stay drawn at its last place.
 */
import { place } from './position.js';
import { formatShortcut } from './keys.js';

const WARM_MS = 400;
const WATCH_MS = 120;
export const MAX_HOVER_MS = 8000;   // a hover tip with no pointer move inside its trigger for this long goes away

/** Pure: may a tip open for this pointer? Never for touch, never while a button is held. */
export function mayShowTip({ pointerType = 'mouse', buttons = 0, pressed = false } = {}) {
  return pointerType !== 'touch' && !buttons && !pressed;
}

/**
 * Pure: does the shown tip still have its reason? via 'hover' needs the pointer on it, 'focus' the focus. A trigger
 * that became disabled loses its tip (a disabled control gets no pointerleave, and its :hover can stick); `inside`
 * (the last known pointer position is over the trigger's box) is required too when given, for the same reason.
 */
export function keepTip({ connected, visible, via, hovered, focused, expanded = false, disabled = false, inside = true, idle = 0 }) {
  return !!connected && !!visible && !expanded && !disabled
    && (via === 'focus' ? !!focused : !!hovered && !!inside && idle < MAX_HOVER_MS);
}

let tipEl = null, current = null, timer = 0, watch = 0, lastHide = 0, pressed = false, wired = false;
let pending = null;   // the trigger whose hover delay `timer` is counting (paw-6nf7)
let px = NaN, py = NaN;   // last pointer position (document-wide pointermove)

function el() {
  if (tipEl?.isConnected) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'k-tip';
  tipEl.id = 'k-tip';
  tipEl.setAttribute('popover', 'manual');
  tipEl.setAttribute('role', 'tooltip');
  document.body.append(tipEl);
  return tipEl;
}

// rendered: not display:none / content-visibility-skipped / visibility:hidden / opacity:0 (itself or an ancestor), not
// under [inert] or [hidden], and (an HTML element that is not position:fixed) has an offsetParent
function visible(node) {
  if (node.closest('[inert], [hidden]')) return false;
  if (node.checkVisibility ? !node.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true }) : !node.getClientRects().length) return false;
  return !(node instanceof HTMLElement && node.offsetParent === null && getComputedStyle(node).position !== 'fixed');
}
const stateOf = (c) => ({
  connected: c.node.isConnected,
  visible: c.node.isConnected && visible(c.node),
  via: c.via,
  hovered: c.node.matches(':hover'),
  focused: c.node === document.activeElement || c.node.contains(document.activeElement),
  expanded: isExpanded(c.node),
  // paw-kxwz: only a natively disabled control (no pointerleave, sticky :hover); an aria-disabled one (a greyed menu row) keeps
  // its tip, which then says why it is greyed
  disabled: c.node.matches(':disabled'),
  inside: Number.isNaN(px) || inRect(c.node.getBoundingClientRect(), px, py),
  idle: c.via === 'hover' ? performance.now() - c.armed : 0,
});
const inRect = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
const isExpanded = (node) => node.getAttribute('aria-expanded') === 'true';

function show(node, o, via) {
  clearTimeout(timer); pending = null;
  if (!node.isConnected || !visible(node) || isExpanded(node) || node.matches(':disabled') || (via === 'hover' && pressed)) return;
  const t = el();
  t.replaceChildren();
  const span = document.createElement('span');
  span.textContent = o.text;
  t.append(span);
  if (o.shortcut) {
    const k = document.createElement('kbd');
    k.textContent = formatShortcut(o.shortcut).map((c) => c.join(c.some((x) => x.length > 1) ? '+' : '')).join(' ');
    t.append(k);
  }
  // Inherit the theme of the subtree the anchor lives in (the gallery shows themes side by side).
  const themed = node.closest('[data-theme]');
  if (themed) t.setAttribute('data-theme', themed.getAttribute('data-theme')); else t.removeAttribute('data-theme');
  if (!t.matches(':popover-open')) t.showPopover();
  current = { node, via, o, at: '', armed: performance.now() };
  reposition();
  clearInterval(watch);
  // the watchdog also follows the trigger: a layout change under a still pointer must not leave the tip floating
  watch = setInterval(() => { if (!current || !keepTip(stateOf(current))) hide(); else reposition(); }, WATCH_MS);
}

function reposition() {
  const { node, o } = current, t = tipEl;
  const a = node.getBoundingClientRect(), key = `${a.left},${a.top},${a.width},${a.height}`;
  if (key === current.at) return;
  current.at = key;
  const r = t.getBoundingClientRect();
  const p = place({
    anchor: { x: a.left, y: a.top, width: a.width, height: a.height }, float: { width: r.width, height: r.height },
    viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
    placement: o.placement || 'bottom', offset: 6, padding: 4,
  });
  t.style.left = p.x + 'px';
  t.style.top = p.y + 'px';
}

/** Hide the tip (only if it belongs to `node`, when given). */
function hide(node) {
  // paw-6nf7: a trigger hides only its own tip or its own pending delay. Its teardown (a component re-rendering, a reactive
  // tip text re-attaching: some do every second) or its leave used to clear the delay of the trigger under the pointer, whose
  // tip then never came on that hover
  if (node && (current ? current.node !== node : pending !== node)) return;
  clearTimeout(timer); pending = null;
  clearInterval(watch);
  if (tipEl?.matches(':popover-open')) { tipEl.hidePopover(); lastHide = performance.now(); }
  current = null;
}

/** Document-wide reasons to hide, installed once on first use (importing the kit has no side effects). */
function wire() {
  if (wired) return;
  wired = true;
  const any = () => hide();
  // the pointer is the truth, not :hover (it sticks when the cursor leaves the window without a mouseleave, and a
  // remote-desktop cursor jumps): any move or over whose target is not inside the trigger, or whose position is off
  // its box, hides the tip at once, a focus-shown one too (a window re-activation or a focus restore re-shows it on
  // the focused trigger while the pointer is elsewhere); a move inside a hover-shown trigger re-arms MAX_HOVER_MS
  const track = (e) => {
    px = e.clientX; py = e.clientY;
    adoptTitle(e);
    if (!current) return;
    if (!current.node.contains(e.target) || !inRect(current.node.getBoundingClientRect(), px, py)) hide();
    else if (e.type === 'pointermove') current.armed = performance.now();
  };
  document.addEventListener('pointermove', track, { capture: true, passive: true });
  // pointerover also comes before the WebView reads a title= for its own tooltip (adoptTitle in track)
  document.addEventListener('pointerover', track, { capture: true, passive: true });
  // left the window: pointerout to nowhere, or the document's own leave events
  const gone = () => { px = py = NaN; hide(); };
  document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) gone(); }, true);
  document.documentElement.addEventListener('pointerleave', gone);
  document.documentElement.addEventListener('mouseleave', gone);
  document.addEventListener('pointerdown', () => { pressed = true; hide(); }, true);
  const up = () => { pressed = false; };
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', () => { up(); hide(); }, true);
  document.addEventListener('contextmenu', any, true);
  document.addEventListener('dragstart', any, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }, true);
  document.addEventListener('scroll', any, true);
  document.addEventListener('visibilitychange', any);
  window.addEventListener('blur', () => { pressed = false; hide(); });
  window.addEventListener('resize', any);
  if (GUARD) guardTitles();
}

// Dev and test builds: no title attribute survives a microtask. Anything that writes one (a leftover in markup, a
// third-party node) is adopted at once and named in the console, so the native WebView tooltip never gets a chance.
const GUARD = typeof import.meta.env === 'object' && !!(import.meta.env.DEV || import.meta.env.VITE_TEST_ID);
const warned = new WeakSet();
export function guardTitles(root = document.documentElement) {
  const fix = (n) => {
    if (!(n instanceof HTMLElement) || !n.hasAttribute('title')) return;
    if (!warned.has(n)) { warned.add(n); console.warn('[pawscript] native title= stripped (use the kit tooltip):', n); }
    adopt(n);
  };
  const sweep = (n) => { if (n instanceof Element) { fix(n); n.querySelectorAll('[title]').forEach(fix); } };
  new MutationObserver((ms) => {
    for (const m of ms) if (m.type === 'attributes') fix(m.target); else m.addedNodes.forEach(sweep);
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
  sweep(root);
}

// Native title= tooltips are drawn by the WebView, not by us, and in WebView2 they linger after the pointer leaves,
// until another titled control is hovered (none of the hide rules above can reach them). So the first hover of any
// element carrying a title turns it into a kit tip: the attribute moves to aria-description (screen readers keep it)
// and the element gets the tooltip() attachment. A later title= written by the component is adopted again.
const adopted = new WeakMap();
function adoptTitle(e) {
  const n = e.target.closest?.('[title]');
  if (n && !(n instanceof SVGElement)) adopt(n);
}
function adopt(n) {
  const text = n.getAttribute('title');
  n.removeAttribute('title');
  adopted.get(n)?.();
  if (text) n.setAttribute('aria-description', text); else n.removeAttribute('aria-description');
  adopted.set(n, tooltip(text)(n) || null);   // its pointerenter for this very move is still to come
}

/** Attachment factory: tooltip(text, shortcut?) or tooltip({ text, shortcut, placement, delay }). */
export function tooltip(content, shortcut) {
  const o = typeof content === 'object' && content ? { ...content } : { text: content, shortcut };
  return (node) => {
    if (!o.text) return;
    wire();
    const delay = o.delay ?? 500;
    if (o.shortcut) node.setAttribute('aria-keyshortcuts', o.shortcut);
    const enter = (e) => {
      if (!mayShowTip({ pointerType: e.pointerType, buttons: e.buttons, pressed })) return;
      clearTimeout(timer);
      const warm = performance.now() - lastHide < WARM_MS || (current && current.node !== node);
      if (warm) show(node, o, 'hover');
      // :hover alone can be stale (remote cursor, left the window): the last pointer position must agree
      else {
        pending = node;
        timer = setTimeout(() => { pending = null; if (node.matches(':hover') && (Number.isNaN(px) || inRect(node.getBoundingClientRect(), px, py))) show(node, o, 'hover'); }, delay);
      }
    };
    const leave = () => hide(node);
    const focus = () => { if (node.matches(':focus-visible') && !pressed) show(node, o, 'focus'); };
    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('focus', focus);
    node.addEventListener('blur', leave);
    return () => {
      hide(node);
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('focus', focus);
      node.removeEventListener('blur', leave);
      if (o.shortcut) node.removeAttribute('aria-keyshortcuts');
    };
  };
}
