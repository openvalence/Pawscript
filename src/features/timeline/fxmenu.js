// fxmenu.js -- the modifier kinds as menu items, ONE list everywhere (paw-ef73.20, owner: "it reduces confusion, grey em
// out and say used to modify existing strokes"): the event kinds first (made in any tab), then the kinds that only
// modify existing strokes, greyed outside Refine with the reason in the tip. Pure.
import { FX_KINDS, EVENT_KINDS, REFINE_KINDS, REFINE_WHY } from '../../lib/fx.js';

/** Can a modifier of kind k be made / picked in tab? */
export const kindHere = (k, tab) => !!FX_KINDS[k]?.event || tab === 'refine';
/** Menu items, one per kind: pick(kind) runs it. checked = the current kind (a kind picker); points: false leaves Spurt
 *  out (a ranged modifier cannot become a point). */
export function modItems(tab, pick, { checked = null, points = true } = {}) {
  const row = (k) => ({ label: FX_KINDS[k].label, tip: kindHere(k, tab) ? FX_KINDS[k].tip : `${FX_KINDS[k].label}: ${REFINE_WHY}`, disabled: !kindHere(k, tab),
    ...(checked ? { checked: k === checked } : {}), run: () => pick(k) });
  return [...EVENT_KINDS.map(row), { separator: true }, ...REFINE_KINDS.filter((k) => points || !FX_KINDS[k].point).map(row)];
}
