// modes.js -- the tabs, stages of the job in order (paw-ef73.1): Scenes (timeline hygiene: scenes, cuts, shots, loops),
// Track (seed and track), Refine (for now the old Script mode's tools), Review. A panel / overlay lists the tabs it
// shows in (`modes`); the layout keeps one arrangement per tab (layout.svelte.js); Ctrl+1..4 follow this order.
export const MODES = ['scenes', 'track', 'refine', 'review'];

/** A stored mode as a tab: 'script' (before the stage tabs) is 'refine'; anything unknown is the first tab. */
export const modeOf = (m) => (m === 'script' ? 'refine' : MODES.includes(m) ? m : MODES[0]);

/** Once at start: the stored 'mode' as a tab, written back when it changed, and a rebinding of the old Script mode
 *  command (mode.script) moved to mode.refine. Every other setting is left as it is. -> the tab to open. */
export function migrateMode(settings) {
  const saved = settings.get('mode'), mode = modeOf(saved);
  if (saved !== mode) settings.set('mode', mode);
  const ko = settings.get('keys.overrides');
  if (ko && typeof ko === 'object' && 'mode.script' in ko) {
    const { 'mode.script': keys, ...rest } = ko;
    settings.set('keys.overrides', { ...('mode.refine' in rest ? {} : { 'mode.refine': keys }), ...rest });
  }
  return mode;
}
