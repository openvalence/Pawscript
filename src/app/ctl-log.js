// ctl-log.js -- paw-r73w: which control was used, from which surface. An attachment on a surface's root logs every press inside it
// as ui:ctl {c, s}: c = the control's data-ctl, else its aria-label (up to a ':'), else its words; a radio gets its group's label in
// front; digits become '#' (names only: never a run's times, a file or a value). s = the nearest [data-surface] inside the root (the
// Tracker panel's Adjust / Fusion parts), else the surface given. after(c) runs once logged (a popover's time to first action).
const CTL = 'button, [role="slider"], [role="combobox"], input, select, textarea, summary', SLIDE = '[role="slider"], .k-slider-track';

/** The control el is in, as a name ('' when it is not in one). */
export function ctlName(el) {
  const c = el?.closest?.(CTL);
  if (!c) return '';
  const own = c.dataset?.ctl || (c.getAttribute('aria-label') || '').split(':')[0] || c.textContent;
  const g = c.getAttribute('role') === 'radio' ? c.closest('[role="radiogroup"]')?.getAttribute('aria-label') : '';
  return ((g ? g + ': ' : '') + own).replace(/\d+([.,]\d+)?/g, '#').replace(/\s+/g, ' ').trim().slice(0, 48);
}

/** {@attach ctlLog(app, 'panel')} on a surface's root. */
export const ctlLog = (app, surface, after) => (root) => {
  const on = (e) => {
    const sl = e.target.closest?.(SLIDE);
    if (e.type === 'click' ? !!sl : !sl) return;   // a slider / pad on its press (a drag may never click), the rest on click (keys too)
    const c = ctlName(sl?.matches('.k-slider-track') ? sl.querySelector('[role="slider"]') || sl : e.target);
    if (!c) return;
    const sub = e.target.closest('[data-surface]');
    app.usage?.note?.('ui:ctl', { c, s: sub && root.contains(sub) ? sub.dataset.surface : surface });
    after?.(c);
  };
  root.addEventListener('click', on, true);
  root.addEventListener('pointerdown', on, true);
  return () => { root.removeEventListener('click', on, true); root.removeEventListener('pointerdown', on, true); };
};
