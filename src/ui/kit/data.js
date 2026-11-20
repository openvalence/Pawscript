/**
 * data.js -- the pure parts of the data family (DataTable, Tree): row selection (click, Ctrl toggle,
 * Shift range), sorting, column templates and tree flattening. No DOM.
 */

/**
 * The selection after a click or key on row `index` of `keys` (the row keys in display order).
 * mods: toggle (Ctrl/Cmd) flips one row, range (Shift) selects anchor..index; with both the range is added.
 * -> { selected: Set, anchor } (a new Set; the anchor stays put on a range).
 */
export function selectRows(selected, keys, index, anchor, { toggle = false, range = false, multiple = true } = {}) {
  const key = keys[index];
  if (multiple && range && anchor >= 0 && anchor < keys.length) {
    const out = toggle ? new Set(selected) : new Set();
    const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
    for (let i = a; i <= b; i++) out.add(keys[i]);
    return { selected: out, anchor };
  }
  if (multiple && toggle) {
    const out = new Set(selected);
    if (out.has(key)) out.delete(key); else out.add(key);
    return { selected: out, anchor: index };
  }
  return { selected: new Set(key === undefined ? [] : [key]), anchor: index };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Ascending order for table cells: numbers numerically, text naturally ('a2' < 'a10'), empty last. */
export function compareValues(a, b) {
  const ea = a == null || a === '', eb = b == null || b === '';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  return collator.compare(String(a), String(b));
}

/** The next sort after clicking column `key`: ascending, then descending, then off (null). */
export function nextSort(sort, key) {
  if (!sort || sort.key !== key) return { key, dir: 'asc' };
  return sort.dir === 'asc' ? { key, dir: 'desc' } : null;
}

/**
 * Rows in `sort` order (a stable sorted copy; the same array when unsorted). A column's own
 * `compare(rowA, rowB)` wins over comparing `row[key]`. Empty values stay last in both directions.
 */
export function sortRows(rows, sort, columns = []) {
  if (!sort?.key) return rows;
  const col = columns.find((c) => c.key === sort.key);
  const k = sort.key, sign = sort.dir === 'desc' ? -1 : 1;
  const cmp = col?.compare
    ? (a, b) => sign * col.compare(a, b)
    : (a, b) => {
      const x = a[k], y = b[k];
      const ex = x == null || x === '', ey = y == null || y === '';
      return ex || ey ? compareValues(x, y) : sign * compareValues(x, y);
    };
  return rows.slice().sort(cmp);
}

/** A column `width` as a CSS grid track: 120 -> '120px'; '2fr' / 'minmax(…)' as given; none -> 'minmax(0, 1fr)'. */
export const trackOf = (w) => (w == null || w === '' ? 'minmax(0, 1fr)' : typeof w === 'number' ? `${w}px` : String(w));

/** The narrowest the columns can be (px): fixed widths and minmax() minimums; fr tracks count 0. */
export function minWidthOf(columns) {
  let sum = 0;
  for (const c of columns) {
    const w = c.width;
    if (typeof w === 'number') sum += w;
    else if (typeof w === 'string') {
      const m = w.match(/^\s*(?:minmax\(\s*)?(\d+(?:\.\d+)?)px/);
      if (m) sum += +m[1];
    }
  }
  return sum;
}

/**
 * The visible rows of a tree: depth-first through `expanded` (a Set of ids).
 * -> [{ node, level (1-based), setsize, posinset, parent (row index or -1), expandable, open }]
 */
export function flattenTree(nodes, expanded) {
  const out = [];
  const walk = (list, level, parent) => {
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const node = list[i];
      const expandable = !!node.children?.length;
      const open = expandable && expanded.has(node.id);
      out.push({ node, level, setsize: n, posinset: i + 1, parent, expandable, open });
      if (open) walk(node.children, level + 1, out.length - 1);
    }
  };
  walk(nodes || [], 1, -1);
  return out;
}
