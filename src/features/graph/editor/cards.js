// cards.js -- what a node card shows, decided from its NodeDef: inline params, icon, title, port labels, and the
// palette item for a def. Pure (test/graph-editor-cards.test.mjs).

import { typeOfValue } from '../../../lib/graph/types.js';

const NUMERIC = new Set(['number', 'float', 'int']);

/** Params shown on the card: those flagged `inline`; with none flagged, the first two numeric (never hidden). */
export function inlineParams(def) {
  const ps = (def.params || []).filter((p) => !p.hidden);
  const flagged = ps.filter((p) => p.inline === true);
  if (flagged.length) return flagged;
  if (ps.some((p) => p.inline === false)) return ps.filter((p) => p.inline !== false && NUMERIC.has(p.type) && !p.editor).slice(0, 2);
  return ps.filter((p) => NUMERIC.has(p.type) && !p.editor).slice(0, 2);
}

const GROUP_ICON = [
  [/^source/i, 'import'], [/^out/i, 'export'], [/^gen/i, 'wave'], [/^edit/i, 'pen'], [/^select/i, 'select'],
  [/^signal/i, 'heart-rate'], [/^spans/i, 'layers'], [/^flow/i, 'split'], [/^analy/i, 'heatmap'], [/^amp/i, 'sliders'],
  [/^script/i, 'stroke'], [/^const/i, 'hash'],
];
/** The def's icon when the kit has it, else one for its group. */
export function iconFor(def, known) {
  if (def?.icon && known.has(def.icon)) return def.icon;
  if (!def) return 'warning';
  return GROUP_ICON.find(([re]) => re.test(def.group || ''))?.[1] || 'dot';
}

export const titleOf = (node, def) => node.label || def?.title || `Missing: ${node.type}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const portLabel = (p) => p.label || cap(String(p.name).replace(/^p:/, ''));

export const BAKE_TEXT = { never: 'not baked yet', baked: 'baked', stale: 'changed since bake', 'axis-differs': 'axis edited since bake', error: 'cannot bake' };

/**
 * Palette items for a registry's defs: one per def, plus one per variant. key = type | 'type#variantId'.
 * Item = { key, type, title, group, aliases, help, params (labels), ins, outs (type ids), def, variant? }.
 */
export function paletteItems(defs) {
  const out = [];
  for (const def of defs) {
    const base = {
      type: def.type, group: def.group || 'Other', help: def.help || '', def,
      params: (def.params || []).filter((p) => !p.hidden).map((p) => p.label || p.key),
      ins: (def.ins || []).map((p) => p.type), outs: (def.outs || []).map((p) => p.type),
    };
    out.push({ ...base, key: def.type, title: def.title, aliases: [...(def.aliases || []), def.type] });
    for (const v of def.variants || []) {
      out.push({ ...base, key: `${def.type}#${v.id}`, title: v.title, aliases: [...(v.aliases || []), def.title], variant: v });
    }
  }
  return out;
}

/** Nest items by their ' · ' group path: [{ name, items, groups }], first-seen order. */
export function nestItems(items) {
  const root = { groups: [] };
  for (const it of items) {
    let at = root;
    for (const name of String(it.group).split(' · ')) {
      let g = at.groups.find((x) => x.name === name);
      if (!g) at.groups.push((g = { name, items: [], groups: [] }));
      at = g;
    }
    at.items.push(it);
  }
  return root.groups;
}

/**
 * Link-drag-search filter. from = { side: 'out' | 'in', type }: keeps items with a port that can take (or give)
 * that type. compat(from, to) is lib/graph types.js compat. Returns [{ item, port, adapter, convert }] where
 * convert = the item turns the dragged type into another (listed first: they are what a refusal suggests).
 */
export function compatibleItems(items, from, compat) {
  const out = [];
  for (const it of items) {
    const def = it.def;
    const list = from.side === 'out' ? [...(def.ins || []), ...(def.perSpan ? [{ name: 'where', type: 'spans' }] : [])] : def.outs || [];
    let best = null;
    for (const p of list) {
      const accepts = p.type === 'any' ? p.accepts || ['script', 'signal', 'spans', 'number'] : null;
      const ok = accepts ? (from.side === 'out' ? accepts.includes(from.type) : true) : (from.side === 'out' ? compat(from.type, p.type) : compat(p.type, from.type)).ok;
      if (!ok) continue;
      const adapter = accepts ? null : (from.side === 'out' ? compat(from.type, p.type) : compat(p.type, from.type)).adapter || null;
      if (!best || (best.adapter && !adapter) || (p.name === from.port && !adapter)) best = { port: p.name, adapter };
      if (!adapter && p.name === from.port) break;
    }
    if (!best) continue;
    const outT = (def.outs || []).map((p) => p.type), inT = (def.ins || []).map((p) => p.type);
    const convert = from.side === 'out' ? outT.length > 0 && !outT.includes(from.type) && !outT.includes('any') : inT.length > 0 && !inT.includes(from.type);
    out.push({ item: it, ...best, convert });
  }
  // native takers before ones that need an automatic conversion (so "Smooth" from a script picks the script op,
  // not the signal one), then deliberate converters (script.sample) first among those
  return out.sort((a, b) => !!a.adapter - !!b.adapter || b.convert - a.convert);
}

/** Source pickers bound on placement, with the preset-slot rule they share (integration resolveSlot). */
const AUTO_SLOT = { ghost: 'tracker', run: 'run' };
/**
 * Params to set when a node is placed from the palette, so a source starts bound instead of in error
 * ("pick a ghost"): each empty ghost / run picker gets resolve(auto, sources) (the integration's resolveSlot:
 * the tracker ghost, the first run). Nothing when the document has none, or resolve is missing.
 */
export function autoBindParams(def, sources, resolve) {
  const out = {};
  if (!def || !sources || typeof resolve !== 'function') return out;
  for (const p of def.params || []) {
    const auto = AUTO_SLOT[p.editor];
    if (!auto || p.default) continue;
    let v = '';
    try { v = resolve(auto, sources); } catch { v = ''; }
    if (v) out[p.key] = v;
  }
  return out;
}

/**
 * The type a port's VALUE is shown as (summary, plot, value table). A linked input shows its upstream output's
 * raw value: adapters ('sample', 'const') apply only inside evaluation, so a script wired into a signal port is
 * still a script here. upstream = that output's resolved type (null for outputs and unlinked inputs); then the
 * value's own shape; then the declared type.
 */
export function shownType(declared, upstream, value) {
  if (upstream && upstream !== 'any') return upstream;
  return typeOfValue(value) ?? declared;
}
