// inspect.js -- what the Inspector panel (InspectorPanel.svelte) shows: the timeline selection the user touched last,
// else the first set one in priority order. Selections are sticky across lanes (a scene stays selected while an
// effect is clicked), so priority alone would pin the panel on whatever ranks highest.
export const ORDER = ['fx', 'plan', 'loop', 'act', 'scene', 'run'];   // act: paw-2lp7.5, an action region
/** The lane (tl.focus) a press landed in -> the kind it selects. */
export const LANE_KIND = { fx: 'fx', plan: 'plan', loops: 'loop', scenes: 'scene' };

const key = (sel, k) => (k === 'plan' ? (sel?.plan ?? []).join(',') : k === 'scene' ? sel?.scene ?? -1 : sel?.[k] ?? null);
const isSet = (sel, k) => (k === 'plan' ? sel.plan?.length > 0 : k === 'scene' ? sel.scene >= 0 : sel[k] != null);

/** sel: {fx, plan: ids[], loop, act (region id), scene: index | -1, run} -> the set kinds, by priority. */
export const setKinds = (sel) => ORDER.filter((k) => isSet(sel, k));
/** The kinds that changed from prev to next and are set in next, by priority (prev null = all set ones). */
export const touched = (prev, next) => ORDER.filter((k) => isSet(next, k) && (!prev || key(prev, k) !== key(next, k)));
/** -> the kind to show ('fx' | 'plan' | 'loop' | 'act' | 'scene' | 'run') or null: `last` while it is still set. */
export function inspectKind(sel, last) { const on = setKinds(sel); return on.includes(last) ? last : on[0] ?? null; }
