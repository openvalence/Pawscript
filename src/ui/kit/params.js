/**
 * params.js -- the parameter schema used across the app (generators, transforms, tracker settings) and the
 * pure helpers ParamForm is built on.
 *
 *   Param = { key, label, type: 'float' | 'number' | 'int' | 'bool' | 'choice', default,
 *             min?, max?, step?, unit?, choices?: (value | {value, label})[], group?, hint?, control? }
 *
 * `control` picks a widget where there is a choice: number -> 'field' (default) | 'slider';
 * choice -> 'select' (default) | 'segmented'.
 */
import { snap, clamp } from './math.js';

export const choiceList = (p) => (p.choices || []).map((c) => (c && typeof c === 'object' ? c : { value: c, label: String(c) }));

const isNum = (p) => p.type === 'float' || p.type === 'number' || p.type === 'int';

/** The step a param edits in: its own, else 1 for int, else a hundredth of its range, else 0.01. */
export function stepOf(p) {
  if (p.step > 0) return p.step;
  if (p.type === 'int') return 1;
  if (Number.isFinite(p.min) && Number.isFinite(p.max) && p.max > p.min) {
    const r = (p.max - p.min) / 100;
    return 10 ** Math.floor(Math.log10(r));
  }
  return 0.01;
}

/** A value made valid for its param (wrong type, out of range, unknown choice -> clamped or default). */
export function coerce(p, v) {
  if (isNum(p)) {
    let n = typeof v === 'string' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) n = Number.isFinite(p.default) ? p.default : clamp(0, p.min, p.max);
    n = snap(n, { min: p.min, max: p.max, step: p.type === 'int' ? Math.max(1, Math.round(p.step || 1)) : 0 });
    return p.type === 'int' ? Math.round(n) : n;
  }
  if (p.type === 'bool') return typeof v === 'boolean' ? v : v == null ? !!p.default : v === 'true' || v === 1 || v === true;
  if (p.type === 'choice') {
    const list = choiceList(p);
    const hit = list.find((c) => c.value === v) ?? list.find((c) => String(c.value) === String(v));
    return hit ? hit.value : (list.some((c) => c.value === p.default) ? p.default : list[0]?.value);
  }
  return v ?? p.default;
}

/** { key: default } for a schema, every default coerced. */
export function defaultsOf(schema) {
  return Object.fromEntries(schema.map((p) => [p.key, coerce(p, p.default)]));
}

/** Every schema key present and valid; keys the schema does not know survive untouched. */
export function normalizeValues(schema, values = {}) {
  const out = { ...values };
  for (const p of schema) out[p.key] = coerce(p, p.key in out ? out[p.key] : p.default);
  return out;
}

/** Params grouped in schema order: [{ name, params }]; ungrouped params form a group named ''. */
export function groupsOf(schema) {
  const groups = [];
  for (const p of schema) {
    const name = p.group || '';
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, params: [] }));
    g.params.push(p);
  }
  return groups;
}

export const isDefault = (p, v) => coerce(p, v) === coerce(p, p.default);
