// selmodal.js -- Blender's selection keys (the 2.7x logic) for every timeline editor with a multi-selection (paw-qbvj):
// A toggles all / none, B box select, C circle (brush) select. Each editor registers a target (selTarget) whose box(...) is
// its own box hit (the one its plain drag on empty space uses), so there is one hit test per editor. The drivers own the
// keyboard and the pointer while a mode is on, as lib/xform.js does, and say so on the status line ('pawscript:xform').
//   B  press, then drag with the left button: the box adds to the selection; Shift-drag or a middle drag takes it out.
//      Release applies and ends; Esc or a right click cancels (nothing was applied). A drag near an edge pans the view.
//   C  a circle follows the pointer; a left drag paints into the selection, Shift / middle drag paints out; the wheel and
//      [ / ] change the radius (the wheel does not zoom the timeline while C is on); Esc, Enter or a right click end it.
// A press outside every target ends either mode. Space (play / pause) and the panic stop pass through.
import { eventChord } from '../app/keymap.js';
import { edgeFollow } from './edge-scroll.js';
import { xToMs, msToX } from './lane.js';

// ---- pure (test/selmodal.test.mjs) ----
/** A, Blender 2.7x: anything selected -> 'none'; else 'all', or the reason there is nothing to select. */
export const toggleAll = (any, why = '') => (any ? 'none' : why || 'all');
/** The A command of an editor: c = {id, title, when, ...}, any(app), all / none = the editor's own select all / none commands
 *  (they do the work), empty(app) = why there is nothing to select ('' when there is). */
export const toggleCmd = ({ any, all, none, empty = () => '', ...c }) => ({ keys: ['A'], ...c,
  run: (app) => { const r = toggleAll(any(app), empty(app)); if (r === 'none') none.run(app); else if (r === 'all') all.run(app); else app.toast?.(r, 'quiet'); } });
/** Of items [{x, y}] (px) those inside the circle (cx, cy, r): what C paints on a row of points. */
export const inCircle = (items, cx, cy, r) => items.filter((p) => (p.x - cx) ** 2 + (p.y - cy) ** 2 <= r * r);
/** The circle's bounding box [x0, y0, x1, y1]: on a row of intervals the circle selects what it touches (the box hit of it). */
export const circleBox = (cx, cy, r) => [cx - r, cy - r, cx + r, cy + r];
export const RADIUS_MIN = 4, RADIUS_MAX = 200;
export const clampRadius = (r) => Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, Math.round(+r || 24)));
/** One wheel notch (deltaY < 0: up = bigger) or one [ / ] press (dir -1 / +1). */
export const stepRadius = (r, dir) => clampRadius(dir > 0 ? Math.max(r + 1, r * 1.15) : Math.min(r - 1, r / 1.15));

// ---- targets ----
/** t = {el (the row: its rect is the visible time), box(x0, y0, x1, y1, mode 'add' | 'sub') in el px at the current view,
 *  circle?(cx, cy, r, mode) (default: box of circleBox)}. -> unregister. */
const targets = new Set();
export function selTarget(t) { targets.add(t); return () => targets.delete(t); }
function targetAt(x, y) {
  for (const t of targets) { const r = t.el?.getBoundingClientRect?.(); if (r && r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return t; }
  return null;
}
let ptr = null;   // the last pointer position: where C's circle shows first
if (typeof window !== 'undefined') window.addEventListener('pointermove', (e) => { ptr = [e.clientX, e.clientY]; }, { capture: true, passive: true });

// ---- the driver ----
let live = null;   // the running mode's stop()
export const modalOn = () => !!live;
const PASS = new Set(['Space', 'Pause', 'Shift+Escape']);   // play / pause and the panic stop stay theirs

/** Start mode kind 'box' | 'circle'. o = {app, radius, setRadius(r)}. Returns stop(). */
export function run(kind, { app, radius = 24, setRadius = () => {} }) {
  live?.();
  const box = kind === 'box';
  let r = clampRadius(radius), drag = null, edge = null, lastE = null;
  const el = document.createElement('div');
  el.dataset.selModal = kind;
  el.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;display:none;box-sizing:border-box;border:1px solid var(--tx-hi);'
    + (box ? 'background:color-mix(in srgb, var(--tx-hi) 10%, transparent)' : 'border-radius:50%;box-shadow:0 0 0 1px var(--bg-sunken)');
  document.body.append(el);
  document.documentElement.classList.add('sel-modal');
  const hint = () => (box
    ? `Box select: ${drag ? `release ${drag.mode === 'sub' ? 'removes' : 'adds'}` : 'drag adds, Shift / middle drag removes'} | Esc / right click cancel`
    : `Circle select r ${r} px: drag paints in, Shift / middle drag paints out | wheel or [ ] radius (the wheel does not zoom while C is on) | Esc / Enter / right click done`);
  const show = () => window.dispatchEvent(new CustomEvent('pawscript:xform', { detail: { hint: hint(), icon: 'pointer', tip: box ? 'Box select (B)' : 'Circle select (C)' } }));
  const place = (x0, y0, x1, y1) => Object.assign(el.style, { display: 'block', left: `${x0}px`, top: `${y0}px`, width: `${Math.max(1, x1 - x0)}px`, height: `${Math.max(1, y1 - y0)}px` });
  const ring = () => { if (ptr) place(ptr[0] - r, ptr[1] - r, ptr[0] + r, ptr[1] + r); };
  const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const local = (t, e) => { const b = t.el.getBoundingClientRect(); return { b, x: e.clientX - b.left, y: e.clientY - b.top }; };

  // B: the box from the press (pinned in time, so it survives the edge pan) to the pointer, inside the row
  function boxMove(e) {
    const { b, x, y } = local(drag.t, e), cx = Math.max(0, Math.min(b.width, x)), cy = Math.max(0, Math.min(b.height, y));
    const x0 = msToX(app.view, b.width, drag.t0);
    drag.rect = [Math.min(x0, cx), Math.min(drag.y0, cy), Math.max(x0, cx), Math.max(drag.y0, cy)];
    place(b.left + Math.max(0, drag.rect[0]), b.top + drag.rect[1], b.left + Math.min(b.width, drag.rect[2]), b.top + drag.rect[3]);
  }
  // C: paint what the circle covers on the row the drag began on
  function paint(e) {
    const { x, y } = local(drag.t, e);
    if (drag.t.circle) drag.t.circle(x, y, r, drag.mode); else drag.t.box(...circleBox(x, y, r), drag.mode);
  }
  function end(apply = true) {
    if (!live) return;
    live = null;
    removeEventListener('keydown', kd, true); removeEventListener('pointerdown', pd, true); removeEventListener('pointermove', pm, true);
    removeEventListener('pointerup', pu, true); removeEventListener('wheel', wh, true); removeEventListener('blur', bl); removeEventListener('auxclick', swallow, true);
    edge?.stop(!apply); edge = null;
    el.remove();
    document.documentElement.classList.remove('sel-modal');
    window.dispatchEvent(new CustomEvent('pawscript:xform', { detail: null }));
  }
  function kd(e) {
    const c = eventChord(e);
    if (!c || PASS.has(c)) return;
    swallow(e);
    const k = c.replace(/^Shift\+/, '');
    if (k === 'Escape') return end(false);
    if (k === 'Enter') return end(true);
    if (!box && (k === '[' || k === ']')) { r = stepRadius(r, k === ']' ? 1 : -1); setRadius(r); ring(); show(); }
  }
  function pd(e) {
    swallow(e);
    if (e.button === 2) {   // the context menu that follows a right click must not open
      const cm = (ev) => { swallow(ev); removeEventListener('contextmenu', cm, true); };
      addEventListener('contextmenu', cm, true);
      setTimeout(() => removeEventListener('contextmenu', cm, true), 1500);
      return end(!box);
    }
    if (e.button !== 0 && e.button !== 1) return;
    const t = targetAt(e.clientX, e.clientY);
    if (!t) return end(!box);   // a press outside the timeline's editors ends the mode
    (t.el.closest?.('[data-tl-lane]') || t.el).focus?.({ preventScroll: true });   // its keys (G, X, A) go there after
    const mode = e.button === 1 || e.shiftKey ? 'sub' : 'add', { b, x, y } = local(t, e);
    drag = { t, mode, t0: xToMs(app.view, b.width, x), y0: Math.max(0, Math.min(b.height, y)) };
    if (box) { edge = edgeFollow({ app, el: t.el, step: () => lastE && boxMove(lastE), x0: e.clientX }); boxMove(e); } else paint(e);
    show();
  }
  function pm(e) {
    ptr = [e.clientX, e.clientY];
    if (!box) ring();
    if (!drag) return;
    swallow(e);
    lastE = e;
    if (box) { edge?.move(e.clientX); boxMove(e); } else paint(e);
  }
  function pu(e) {
    if (!drag) return;
    swallow(e);
    const d = drag;
    drag = null;
    if (!box) { show(); return; }
    edge?.stop(false); edge = null;
    if (d.rect) d.t.box(...d.rect, d.mode);
    end(true);
  }
  function wh(e) {
    swallow(e);   // the rule "the wheel belongs to the timeline" is off while C is on: it sizes the circle
    if (box || !e.deltaY) return;
    r = stepRadius(r, e.deltaY < 0 ? 1 : -1); setRadius(r); ring(); show();
  }
  const bl = () => end(!box);
  addEventListener('keydown', kd, true); addEventListener('pointerdown', pd, true); addEventListener('pointermove', pm, true);
  addEventListener('pointerup', pu, true); addEventListener('wheel', wh, { capture: true, passive: false }); addEventListener('blur', bl); addEventListener('auxclick', swallow, true);
  live = () => end(false);
  if (!box) ring();
  show();
  return live;
}
