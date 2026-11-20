// xform.js -- Blender-style modal transforms (G grab, S scale). A pure state machine (begin / key / amounts / hint,
// node-tested in test/xform.test.mjs) and a DOM driver, run(), that owns the keyboard and the pointer until Enter or a
// left click confirms, Esc or a right click cancels. The driver shows its hint line through a window event
// ('pawscript:xform', detail {hint} | null at the end) that the status bar listens to.
//
// Grab: the mouse moves the selection (dx = time, dy = position); X / Y constrain to time / position (again: free);
// typing a number gives an exact offset along the constraint (none = time, Blender's X first): `G Y 1 0` = +10 pos.
// Scale: the mouse distance to the pivot sets the factor; typing gives it (`S 1 . 5` = ×1.5). paw-5zpf: with axes 'xy' (the lane's
// points) it scales time and level; X / Y lock it to one (`S X 2` doubles the duration, `S Y .5` halves the height); autoLock: the
// first 8 px of mouse travel pick the lock from their direction (sideways time, up / down level) unless X / Y / a number came first.
// Rotate (kind 'rotate', the lane's R): the mouse's angle about the pivot sets a slope; a typed value is the level change at the far end.
// Holding the middle button and dragging picks the lock from the drag's direction (Blender), in any transform with two axes.
import { eventChord } from '../app/keymap.js';
import { edgeFollow } from './edge-scroll.js';

/** kind 'grab' | 'scale' | 'rotate'; axes: the constraints that exist ('xy' points, 'x' intervals: time only, 'y' scale, '' rotate). */
export function begin(kind, { axes = kind === 'scale' ? 'y' : kind === 'rotate' ? '' : 'xy', autoLock = false } = {}) {
  return { kind, axes, con: axes.length === 1 ? axes : null, typed: '', auto: autoLock && axes.length > 1, mouse: kind === 'scale' ? { f: 1 } : kind === 'rotate' ? { slope: 0 } : { dt: 0, dp: 0 } };
}
/** paw-5zpf: lock to the dominant direction of a pointer travel (dx, dy px) once it is `min` px long; m unchanged before that. */
export function lockFrom(m, dx, dy, min = 8) {
  if (m.axes.length < 2 || Math.hypot(dx, dy) < min) return m;
  return { ...m, con: Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y', auto: false };
}

/** One key (an eventChord without modifiers) -> {m, done: 'confirm' | 'cancel' | null}. Unknown keys change nothing. */
export function key(m, k) {
  if (k === 'Enter') return { m, done: 'confirm' };
  if (k === 'Escape') return { m, done: 'cancel' };
  let n = m;
  if ((k === 'X' || k === 'Y') && m.axes.length > 1) { const c = k.toLowerCase(); n = { ...m, con: m.con === c ? null : c, auto: false }; }
  else if (/^[0-9]$/.test(k) || (k === '.' && !m.typed.includes('.'))) n = { ...m, typed: m.typed + k, auto: false };
  else if (k === '-') n = { ...m, typed: m.typed.startsWith('-') ? m.typed.slice(1) : '-' + m.typed };
  else if (k === 'Backspace') n = { ...m, typed: m.typed.slice(0, -1) };
  return { m: n, done: null };
}

/** The typed number, or null while nothing usable is typed ('', '-', '.'). */
export const typedValue = (m) => { const v = parseFloat(m.typed); return Number.isFinite(v) ? v : null; };

/** What to apply now: grab {dt (ms), dp (pos)}, scale {f} (axes 'xy': + {fx, fy}, the time and level factors), rotate {d} (typed:
 *  the level change at the far end) | {slope} (the mouse). A typed value wins over the mouse. */
export function amounts(m) {
  const n = typedValue(m);
  if (m.kind === 'rotate') return n != null ? { d: n } : { slope: m.mouse.slope };
  if (m.kind === 'scale') { const f = n ?? m.mouse.f; return m.axes.length > 1 ? { f, fx: m.con === 'y' ? 1 : f, fy: m.con === 'x' ? 1 : f } : { f }; }
  if (n != null) return m.con === 'y' ? { dt: 0, dp: n } : { dt: n, dp: 0 };
  return { dt: m.con === 'y' ? 0 : m.mouse.dt, dp: m.con === 'x' ? 0 : m.mouse.dp };
}

const sg = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v));
/** The status line. a = what was actually applied (after clamping), default amounts(m); its `clamped` (count of levels held at 0 /
 *  100) and `pivot` (its name) are said when given. */
export function hint(m, a = amounts(m)) {
  const typed = m.typed ? `  [${m.typed}]` : '', piv = a.pivot ? ` · pivot ${a.pivot}` : '', cl = a.clamped ? ` · ${a.clamped} clamped at 0 / 100` : '';
  if (m.kind === 'rotate') return `Rotate: far end ${sg(a.d ?? 0)}${piv}${cl}${typed} | type the far end's change, Enter / click confirm, Esc cancel`;
  if (m.kind === 'scale' && m.axes.length > 1) {
    const lock = m.con === 'x' ? 'time' : m.con === 'y' ? 'level' : m.auto ? 'move to pick time / level' : 'time and level';
    return `Scale ${lock}: ×${(+(m.con === 'y' ? a.fy : a.fx ?? a.f)).toFixed(2)}${piv}${cl}${typed} | X time, Y level (again: both), middle-drag picks, type a factor, Enter confirm, Esc cancel`;
  }
  if (m.kind === 'scale') return `Scale: ×${(+a.f).toFixed(2)}${typed} | type a factor, Enter confirm, Esc cancel`;
  if (m.axes === 'x') return `Grab: dt ${sg(a.dt)} ms${typed} | type ms, Enter confirm, Esc cancel`;
  const con = m.con === 'x' ? ' (time only)' : m.con === 'y' ? ' (position only)' : '';
  return `Grab: dx ${sg(a.dt)} ms, dy ${sg(a.dp)}${con}${typed} | X/Y constrain (or middle-drag), type a value, Enter confirm, Esc cancel`;
}

/**
 * Run a modal transform in the window. o = {
 *   kind, axes, origin?: [clientX, clientY] (the pointer when it started; else the first move sets it),
 *   mouse(origin, [x, y], event) -> m.mouse ({dt, dp} | {f}),
 *   preview(amounts) -> the applied amounts (clamped) or nothing, confirm(amounts), cancel() }.
 * Returns stop(): cancels it from outside.
 */
export function run(o) {
  let m = begin(o.kind, o), origin = o.origin || null, live = true, lastE = null, mmb = null;   // mmb: where a middle drag began
  // o.follow {app, el (the row)}: a grab held near / past the row's edge pans the view (lib/edge-scroll.js) and keeps the time under
  // the pointer: the pan counts as pointer travel (the origin moves back by the px the view moved since the start)
  const f = o.follow, start0 = f?.app.view.start, edge = f ? edgeFollow({ app: f.app, el: f.el, step: () => lastE && pm(lastE) }) : null;
  const emit = (hint) => window.dispatchEvent(new CustomEvent('pawscript:xform', { detail: hint == null ? null : { hint } }));
  const show = () => { const a = amounts(m); emit(hint(m, o.preview(a) || a)); };
  const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const end = (ok) => {
    if (!live) return;
    live = false;
    window.removeEventListener('keydown', kd, true); window.removeEventListener('pointermove', pm, true);
    window.removeEventListener('pointerdown', pd, true); window.removeEventListener('blur', bl);
    window.removeEventListener('pointerup', pu, true); window.removeEventListener('auxclick', swallow, true);
    edge?.stop(!ok);   // cancelled: the view back to where the grab began
    emit(null);
    if (ok) o.confirm(amounts(m)); else o.cancel();
  };
  const kd = (e) => {
    swallow(e);
    const c = eventChord(e);
    if (!c || /^(Ctrl|Alt|Meta)\+/.test(c)) return;
    const r = key(m, c.replace(/^Shift\+/, ''));
    m = r.m;
    if (r.done) end(r.done === 'confirm'); else show();
  };
  const pm = (e) => {
    const p = [e.clientX, e.clientY];
    if (!origin) origin = p;
    let o0 = origin;
    if (edge) {
      const v = f.app.view, w = f.el.getBoundingClientRect().width;
      o0 = [origin[0] - ((v.start - start0) / v.span) * w, origin[1]];
      lastE = e; edge.move(e.clientX);
    }
    m = { ...m, mouse: o.mouse(o0, p, e) };
    if (mmb) m = lockFrom(m, p[0] - mmb[0], p[1] - mmb[1]);   // paw-5zpf: the middle drag's direction is the lock (Blender)
    else if (m.auto && !m.typed) m = lockFrom(m, p[0] - origin[0], p[1] - origin[1]);
    show();
  };
  const pu = (e) => { if (e.button === 1 && mmb) { swallow(e); mmb = null; } };
  const pd = (e) => {
    if (e.button === 1) { swallow(e); mmb = [e.clientX, e.clientY]; return; }   // never the lane's middle-button pan
    if (e.button !== 0 && e.button !== 2) return;
    swallow(e);
    if (e.button === 2) {   // the context menu that follows a right click must not open
      const cm = (ev) => { swallow(ev); window.removeEventListener('contextmenu', cm, true); };
      window.addEventListener('contextmenu', cm, true);
      setTimeout(() => window.removeEventListener('contextmenu', cm, true), 1500);
    }
    end(e.button === 0);
  };
  const bl = () => end(false);
  window.addEventListener('keydown', kd, true); window.addEventListener('pointermove', pm, true);
  window.addEventListener('pointerdown', pd, true); window.addEventListener('blur', bl);
  window.addEventListener('pointerup', pu, true); window.addEventListener('auxclick', swallow, true);
  show();
  return () => end(false);
}
