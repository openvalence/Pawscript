// editor-item.svelte.js -- paw-5z78: THE editor selection, the one thing the plain arrows nudge. One rule for the whole app:
// when the owner has deliberately selected an item in a direct-manipulation editor (a curve handle, the fusion pad's puck, a
// stroke-window grip, an anchor, the selected modifiers), the arrows nudge it one step (Shift: a finer step); with nothing
// selected they do the app's global actions (frame step, the selected points' nudge). Escape drops it, so the arrows step frames
// again. The keys come through the key map (app/editor-commands.js), never a component's keydown: the key guard and the setting
// keys.arrowsNudgeSelection decide in one place.
//   holdEditorItem(item) -> release   a component's item while it is selected: item {nudge(dx, dy, fine), drop?(), active?()}
//                                     (active() false: focused but not selected, e.g. a toggled-off range override)
//   addEditorSelection(p)             a feature's own selection: p {active(app) -> bool, nudge(app, dx, dy, fine), drop?(app)}
//   editorSelection(app) -> {nudge(dx, dy, fine), drop()} | null   the held item first, else the first active feature selection
// dx / dy: -1 | 0 | 1 (left / right, down / up).

// plain, not $state: read only at key time (app/editor-commands.js), and written from focus / blur listeners that fire inside
// Svelte's block effects when an {#if} removes a focused item (as $state that threw state_unsafe_mutation)
let held = null;
const providers = [];

export function holdEditorItem(item) {
  held = item;
  return () => { if (held === item) held = null; };
}
export function addEditorSelection(p) {
  if (!providers.includes(p)) providers.push(p);
}
export function editorSelection(app) {
  const h = held;
  if (h && h.active?.() !== false) return { nudge: (dx, dy, fine) => h.nudge(dx, dy, fine), drop: () => { if (held === h) held = null; h.drop?.(); } };
  for (const p of providers) {
    let on = false;
    try { on = !!p.active(app); } catch { /* a feature not ready: not its selection */ }
    if (on) return { nudge: (dx, dy, fine) => p.nudge(app, dx, dy, fine), drop: () => p.drop?.(app) };
  }
  return null;
}

/** Attachment for an editor item's element: focused (a click, Tab with keyboard navigation on), it is the editor selection;
 *  blurred or gone, it is not. make() -> the item ({nudge, drop?}); the element is blurred when Escape drops it. */
export const editorItem = (make) => (el) => {
  let release = null;
  const on = () => { release?.(); release = holdEditorItem({ ...make(), drop: () => { release = null; el.blur(); } }); };
  const off = () => { release?.(); release = null; };
  el.dataset.editorItem = '';
  el.addEventListener('focus', on);
  el.addEventListener('blur', off);
  if (el.ownerDocument?.activeElement === el) on();
  return () => { el.removeEventListener('focus', on); el.removeEventListener('blur', off); off(); };
};
