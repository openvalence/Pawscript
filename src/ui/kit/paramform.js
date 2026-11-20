/**
 * paramform.js -- the pure rules behind ParamForm.svelte.
 */
import { choiceList, stepOf } from './params.js';
import { numberChars } from './fields.js';

/** Auto-segmented budget: choices x longest label, in characters. Segments share the width equally, so the
 * longest label sets the need; 10 fits the control column of a 260 px compact form at every density. */
export const SEGMENT_BUDGET = 10;

/**
 * The widget a param renders as: 'number' | 'slider' | 'switch' | 'select' | 'segmented'.
 * An explicit `control` wins. A choice with no `control` is segmented when it has 2-3 choices and
 * choices x longest label <= SEGMENT_BUDGET (L0|R0|R1, Box|Point: every option visible, one click); else a Select.
 */
/** Whether a choice's segments fit the control column (see SEGMENT_BUDGET). */
export function segmentsFit(p) {
  const list = choiceList(p);
  return list.length * Math.max(0, ...list.map((c) => String(c.label).length)) <= SEGMENT_BUDGET;
}

export function controlOf(p) {
  if (p.type === 'bool') return 'switch';
  if (p.type === 'choice') {
    if (p.control === 'segmented' || p.control === 'select') return p.control;
    const n = choiceList(p).length;
    return n >= 2 && n <= 3 && segmentsFit(p) ? 'segmented' : 'select';
  }
  return p.control === 'slider' ? 'slider' : 'number';
}

/**
 * Width, in characters, of the number-field column every slider row in a form shares: the widest slider
 * param's NumberField text (numberChars, same min/max/step as the field) plus its unit and one for the gap
 * between them. 0 when no param is a slider. One column for the form = every slider the same length.
 */
export function numberColumnChars(schema) {
  let n = 0;
  for (const p of schema) {
    if (controlOf(p) !== 'slider') continue;
    const unit = p.unit ? String(p.unit).length + 1 : 0;
    n = Math.max(n, numberChars({ min: p.min, max: p.max, step: stepOf(p) }) + unit);
  }
  return n;
}

/** Same keys, every value identical (===). */
export function sameValues(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.is(a[k], b[k]));
}
