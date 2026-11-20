// fxmenu.js -- the modifier kinds as menu items, ONE list everywhere (paw-ef73.20, owner: "it reduces confusion, grey em
// out and say used to modify existing strokes"): the event kinds first (made in any tab), then the kinds that only
// modify existing strokes, greyed outside Refine with the reason in the tip. Pure. paw-ajvq: with `push`, Push and Pull
// (a knotting in mode 'none', lib/fx KNOT_PUSH / KNOT_PULL) follow Knotting: pick('knotting', params).
import { FX_KINDS, EVENT_KINDS, REFINE_KINDS, REFINE_WHY, KNOT_PUSH, KNOT_PULL } from '../../lib/fx.js';

/** Can a modifier of kind k be made / picked in tab? */
export const kindHere = (k, tab) => !!FX_KINDS[k]?.event || tab === 'refine';
/** The Push and Pull rows (a knotting with no pop). */
export const PUSH_ROWS = [{ label: 'Push', tip: 'Push: one slow push to full depth, no pop', params: KNOT_PUSH }, { label: 'Pull', tip: 'Pull: one slow pull out, no pop', params: KNOT_PULL }];
/** Menu items, one per kind: pick(kind, params?) runs it. checked = the current kind (a kind picker); points: false leaves
 *  Spurt out (a ranged modifier cannot become a point); push: the Push and Pull rows after Knotting. */
export function modItems(tab, pick, { checked = null, points = true, push = false } = {}) {
  const row = (k) => ({ label: FX_KINDS[k].label, tip: kindHere(k, tab) ? FX_KINDS[k].tip : `${FX_KINDS[k].label}: ${REFINE_WHY}`, disabled: !kindHere(k, tab),
    ...(checked ? { checked: k === checked } : {}), run: () => pick(k) });
  const ev = EVENT_KINDS.flatMap((k) => [row(k), ...(push && k === 'knotting' ? PUSH_ROWS.map((r) => ({ label: r.label, tip: r.tip, run: () => pick('knotting', r.params) })) : [])]);
  return [...ev, { separator: true }, ...REFINE_KINDS.filter((k) => points || !FX_KINDS[k].point).map(row)];
}
