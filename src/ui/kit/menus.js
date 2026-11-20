/**
 * menus.js -- the pure parts of the menus family (Select, ComboBox, Menu, MenuBar): option lists, the
 * ComboBox filter and its match emphasis, and which way a menu aligns so it stays beside its anchor.
 */

/** Option[] or groups { label, options } -> the selectable options, in order. */
export const flatOptions = (options = []) => options.flatMap((o) => (o && Array.isArray(o.options) ? o.options : [o]));

/** The default ComboBox filter: case-insensitive substring of the label. */
export const defaultFilter = (o, q) => String(o.label).toLowerCase().includes(q.toLowerCase());

/**
 * Options matching `query`, those whose label starts with it first (then the rest, each in list order).
 * An empty query keeps every option.
 */
export function filterOptions(options, query, filter = defaultFilter) {
  const q = String(query ?? '').trim();
  if (!q) return options.slice();
  const hits = options.filter((o) => filter(o, q));
  const lq = q.toLowerCase(), starts = (o) => String(o.label).toLowerCase().startsWith(lq);
  return [...hits.filter(starts), ...hits.filter((o) => !starts(o))];
}

/** Split `label` around the first case-insensitive occurrence of `query`: [before, match, after]. */
export function splitMatch(label, query) {
  const s = String(label ?? ''), q = String(query ?? '').trim();
  const i = q ? s.toLowerCase().indexOf(q.toLowerCase()) : -1;
  return i < 0 ? [s, '', ''] : [s.slice(0, i), s.slice(i, i + q.length), s.slice(i + q.length)];
}

/** True when any item in the tree (submenus included) has `key` set (e.g. 'icon'). */
export const treeHas = (items = [], key) => items.some((it) => it && (it[key] || (Array.isArray(it.items) && treeHas(it.items, key))));

/** A menu row (not a separator or a section title). */
export const isRow = (it) => !!it && !it.separator && it.section == null;

// ---- DOM bits (not node-tested) ----

/** Attachment: a native listener (not Svelte's delegated one), so stopPropagation keeps Escape from enclosing dialogs. */
export const on = (type, fn) => (node) => {
  node.addEventListener(type, fn);
  return () => node.removeEventListener(type, fn);
};

/** Scroll `list` so `row` is visible: just enough, or centred (a listbox opening on its selected option). */
export function reveal(list, row, center = false) {
  if (!list || !row) return;
  const pad = parseFloat(getComputedStyle(list).paddingTop) || 0;
  const top = row.offsetTop, h = row.offsetHeight, view = list.clientHeight;
  if (center) list.scrollTop = top - (view - h) / 2;
  else if (top - pad < list.scrollTop) list.scrollTop = top - pad;
  else if (top + h + pad > list.scrollTop + view) list.scrollTop = top + h + pad - view;
}

/**
 * A vertical placement's alignment flipped when the box would run past the viewport on that side but fits
 * on the other (a menu at the right edge opens leftwards from its anchor, as native menus do).
 * place() only shifts; this keeps the menu's edge on the anchor's.
 */
export function autoAlign(placement, anchor, width, viewportWidth, padding = 8) {
  const [side, align] = placement.split('-');
  if (side !== 'top' && side !== 'bottom') return placement;
  const startFits = anchor.x + width <= viewportWidth - padding;
  const endFits = anchor.x + anchor.width - width >= padding;
  if (align === 'start' && !startFits && endFits) return side + '-end';
  if (align === 'end' && !endFits && startFits) return side + '-start';
  return placement;
}
