// areas.js -- the Blender-style area tree the shell lays out: pure tree operations, pixel layout, drop zones
// (test/app-areas.test.mjs). Every operation returns a new tree (untouched subtrees keep their identity) or null
// when it is not allowed; nothing a user can do loses a panel or the video / timeline.
//
//   split: { dir: 'row' | 'col', pin: 0 | 1, size: px, kids: [a, b] }   'row' = side by side; kids[pin] keeps
//          `size` px (its leaf's sizes[active tab] when it has one), the other kid takes the rest
//   leaf:  { id, kind?: 'video' | 'timeline', tabs?: [panelId], tab?, collapsed?, home?: 'left'|'right'|'bottom', sizes? }
//          a leaf with `home` takes the panels whose dock is that name and no leaf lists (Layout resolves them)

export const GAP = 1;      // the border hairline between two areas (kit Splitter)
export const RAIL = 24;    // a collapsed area: its tab rail
const MIN = { video: [360, 200], timeline: [320, 120], panel: [180, 120] };
const HOMES = ['left', 'right', 'bottom'];

const isLeaf = (n) => !n.kids;
const isPanel = (n) => isLeaf(n) && !n.kind;
const gone = (n, hidden) => (isLeaf(n) ? hidden(n) : n.kids.every((k) => gone(k, hidden)));
export const minOf = (n, row, hidden = () => false) => {
  if (isLeaf(n)) return hidden(n) ? 0 : n.collapsed && !n.kind ? RAIL : MIN[n.kind || 'panel'][row ? 0 : 1];
  const [a, b] = n.kids.map((k) => minOf(k, row, hidden)), [ga, gb] = n.kids.map((k) => gone(k, hidden));
  if (ga || gb) return ga ? b : a;
  return n.dir === (row ? 'row' : 'col') ? a + b + GAP : Math.max(a, b);
};
/** Every leaf, depth first. */
export const leaves = (n, out = []) => { if (isLeaf(n)) out.push(n); else n.kids.forEach((k) => leaves(k, out)); return out; };
/** A leaf's place: {leaf, parent, index (in parent.kids), path ('0.1': kid indices from the root)}, or null. */
export function find(n, id, parent = null, index = -1, path = '') {
  if (isLeaf(n)) return n.id === id ? { leaf: n, parent, index, path } : null;
  for (let i = 0; i < 2; i++) { const r = find(n.kids[i], id, n, i, path ? path + '.' + i : String(i)); if (r) return r; }
  return null;
}
export const at = (n, path) => (path === '' ? n : String(path).split('.').reduce((m, i) => m?.kids?.[+i], n));
/** The tree with the node at `path` replaced by fn(node). */
export function setAt(n, path, fn) {
  if (path === '' || path == null) return fn(n);
  const [i, ...rest] = String(path).split('.');
  const kids = [...n.kids];
  kids[+i] = setAt(kids[+i], rest.join('.'), fn);
  return { ...n, kids };
}
const parentPath = (p) => (p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '');
export const mapLeaf = (t, id, fn) => { const f = find(t, id); return f ? setAt(t, f.path, fn) : t; };

let seq = 0;
export const newId = () => 'a' + Date.now().toString(36) + (seq++).toString(36);

/** The leaf `id` split in two: `leaf` goes on `side` ('left' | 'right' | 'top' | 'bottom') with `size` px. */
export function split(t, id, side, leaf, size) {
  const f = find(t, id);
  if (!f) return null;
  const first = side === 'left' || side === 'top';
  return setAt(t, f.path, (old) => ({ dir: side === 'left' || side === 'right' ? 'row' : 'col', pin: first ? 0 : 1, size: Math.max(RAIL, Math.round(size)), kids: first ? [leaf, old] : [old, leaf] }));
}
/** The leaf taken out; its sibling takes the parent's place (Blender: the neighbour fills the gap). */
export function remove(t, id) {
  const f = find(t, id);
  if (!f?.parent) return null;
  return setAt(t, parentPath(f.path), (p) => p.kids[1 - f.index]);
}
const withTabs = (leaf, add, tab) => ({ ...leaf, tabs: [...(leaf.tabs || []).filter((x) => !add.includes(x)), ...add], tab: tab ?? leaf.tab, collapsed: false });
const leafOfTab = (t, pid) => leaves(t).find((l) => l.tabs?.includes(pid));
const emptied = (l) => isPanel(l) && !l.home && !l.tabs?.length;   // a dragged-out area without a dock name goes away

/** Panel `pid` moved to leaf `to`: zone 'center' = one more tab there; an edge = that half of `to` becomes a new
 *  area holding it (`size` px). A non-dock area left empty is removed. */
export function moveTab(t, pid, to, zone = 'center', size = 300) {
  const src = leafOfTab(t, pid), dst = find(t, to)?.leaf;
  if (!dst) return null;
  if (zone === 'center' && (dst.kind || src?.id === to)) return null;
  if (src?.id === to && src.tabs.length < 2) return null;   // its only tab: nothing would be left behind
  let out = src ? mapLeaf(t, src.id, (l) => ({ ...l, tabs: l.tabs.filter((x) => x !== pid), tab: l.tab === pid ? undefined : l.tab })) : t;
  if (zone === 'center') out = mapLeaf(out, to, (l) => withTabs(l, [pid], pid));
  else out = split(out, to, zone, { id: newId(), tabs: [pid], tab: pid }, size);
  const left = src && find(out, src.id)?.leaf;
  return left && emptied(left) ? remove(out, src.id) : out;
}
/** Two leaves trade places. */
export function swap(t, a, b) {
  const fa = find(t, a), fb = find(t, b);
  if (!fa || !fb || a === b) return null;
  return setAt(setAt(t, fa.path, () => fb.leaf), fb.path, () => fa.leaf);
}
/** A whole area moved: 'center' swaps it with `to`, an edge docks it into that half of `to`. */
export function moveArea(t, id, to, zone, size = 300) {
  if (id === to) return null;
  if (zone === 'center') return swap(t, id, to);
  const f = find(t, id), out = remove(t, id);
  return f && out ? split(out, to, zone, f.leaf, size) : null;
}
/** Blender's Join: `keep` grows over its direct neighbour `gone` (same parent split); gone's tabs join keep's.
 *  Not allowed: removing the video or the timeline, or a non-empty area into one of them (no tabs there). */
export function join(t, keep, gone) {
  const fk = find(t, keep), fg = find(t, gone);
  if (!fk || !fg || fk.parent !== fg.parent || !fk.parent || fg.leaf.kind) return null;
  if (fk.leaf.kind && fg.leaf.tabs?.length) return null;
  const k = fk.leaf.kind ? fk.leaf : { ...withTabs(fk.leaf, fg.leaf.tabs || []), home: fk.leaf.home || fg.leaf.home, sizes: fk.leaf.sizes || fg.leaf.sizes };
  return setAt(t, parentPath(fk.path), () => k);
}
/** Close an area: its tabs go to the nearest panel area (in its sibling first). The video / timeline never close. */
export function close(t, id) {
  const f = find(t, id);
  if (!f?.parent || f.leaf.kind) return null;
  const tabs = f.leaf.tabs || [];
  const near = leaves(f.parent.kids[1 - f.index]).find(isPanel) || leaves(t).find((l) => isPanel(l) && l.id !== id);
  if (!near && tabs.length) return null;
  const out = remove(t, id);
  return near && tabs.length ? mapLeaf(out, near.id, (l) => withTabs(l, tabs)) : out;
}
/** The leaf across `edge` of leaf id when Blender would join them: its direct sibling, sharing that whole edge. */
export function neighbour(t, id, edge) {
  const f = find(t, id);
  if (!f?.parent) return null;
  const want = { right: ['row', 0], left: ['row', 1], bottom: ['col', 0], top: ['col', 1] }[edge];
  if (!want || f.parent.dir !== want[0] || f.index !== want[1]) return null;
  const o = f.parent.kids[1 - f.index];
  return isLeaf(o) ? o : null;
}

/** A stored tree checked and repaired: sizes clamped, tabs unique, exactly one video and one timeline leaf.
 *  -> the tree, or null (the caller falls back to the default). */
export function normalise(t) {
  const ids = new Set(), tabs = new Set(), kinds = { video: 0, timeline: 0 };
  const walk = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > 24) return null;
    if (Array.isArray(n.kids)) {
      if (n.kids.length !== 2 || (n.dir !== 'row' && n.dir !== 'col')) return null;
      const kids = n.kids.map((k) => walk(k, depth + 1));
      if (!kids[0] || !kids[1]) return null;
      const s = Number(n.size);
      return { dir: n.dir, pin: n.pin === 0 ? 0 : 1, size: Number.isFinite(s) ? Math.max(RAIL, Math.min(8000, Math.round(s))) : 300, kids };
    }
    if (typeof n.id !== 'string' || !n.id || ids.has(n.id)) return null;
    ids.add(n.id);
    if (n.kind) {
      if (!(n.kind in kinds) || kinds[n.kind]++) return null;
      return { id: n.id, kind: n.kind };
    }
    const l = { id: n.id, tabs: (Array.isArray(n.tabs) ? n.tabs : []).filter((x) => typeof x === 'string' && !tabs.has(x) && tabs.add(x)) };
    if (typeof n.tab === 'string' && n.tab) l.tab = n.tab;
    if (n.collapsed === true) l.collapsed = true;
    if (HOMES.includes(n.home)) l.home = n.home;
    if (n.sizes && typeof n.sizes === 'object') l.sizes = Object.fromEntries(Object.entries(n.sizes).filter(([, v]) => Number.isFinite(v) && v >= RAIL));
    return l;
  };
  const out = walk(t, 0);
  return out && kinds.video === 1 && kinds.timeline === 1 ? out : null;
}

/** The pre-areas frame as a tree: [left | video | right] over the timeline, the bottom dock under both.
 *  c = {left: {size, collapsed, tab}, right: {...}, bottom: {size, collapsed, tab, sizes}, timeline: {size}}. */
export function defaultTree(c) {
  const dock = (home, d) => ({ id: home, home, tabs: [], ...(d.tab ? { tab: d.tab } : {}), ...(d.collapsed ? { collapsed: true } : {}), ...(home === 'bottom' ? { sizes: { ...(d.sizes || {}) } } : {}) });
  return {
    dir: 'col', pin: 1, size: c.bottom.size, kids: [
      { dir: 'col', pin: 1, size: c.timeline.size, kids: [
        { dir: 'row', pin: 0, size: c.left.size, kids: [dock('left', c.left), { dir: 'row', pin: 1, size: c.right.size, kids: [{ id: 'video', kind: 'video' }, dock('right', c.right)] }] },
        { id: 'timeline', kind: 'timeline' }] },
      dock('bottom', c.bottom)] };
}

/** Growing the timeline past what the video's minimum allows: the excess comes out of the bottom dock (px `dock`, never under its
 *  minimum). -> {size: the timeline size to keep, take: px to take from the dock}. */
export const dockTake = (v, max, dock) => { const take = Math.max(0, Math.min(v - max, dock - MIN.panel[1])); return { size: Math.min(v, max + take), take }; };

/** Stacked parts sharing a fixed height (the timeline's rows, the lanes; paw-3lmy). The splitter between parts i and i+1 moved by
 *  d px: the side it moves into gives the room, nearest part first, each down to its minimum; the neighbour on the other side takes
 *  it. The total never changes, so a drag never makes anything scroll. -> new px per part. */
export function share(sizes, mins, i, d) {
  const s = [...sizes];
  const give = (k, step, want) => { let got = 0; for (; got < want && k >= 0 && k < s.length; k += step) { const t = Math.min(want - got, Math.max(0, s[k] - mins[k])); s[k] -= t; got += t; } return got; };
  if (d > 0) s[i] += give(i + 1, 1, d); else if (d < 0) s[i + 1] += give(i, -1, -d);
  return s;
}
/** What parts a..b-1 can give before they all sit at their minimums. */
export const roomOf = (sizes, mins, a, b) => { let t = 0; for (let k = Math.max(0, a); k < Math.min(b, sizes.length); k++) t += Math.max(0, sizes[k] - mins[k]); return t; };
/** Rows fitted into `avail` px: fixed rows keep their preferred px, the fill row (pref null) takes the rest down to its minimum;
 *  past that the fixed rows give way in proportion to what they have above their minimums. Only when the minimums alone do not fit
 *  does the total pass `avail` (the one case the stack scrolls). -> px per row. */
export function fit(pref, mins, avail) {
  const out = pref.map((p, k) => p ?? mins[k]), f = pref.indexOf(null);
  let over = out.reduce((a, b) => a + b, 0) - avail;
  if (over <= 0) { if (f >= 0) out[f] -= over; return out; }
  const room = out.map((p, k) => (pref[k] == null ? 0 : Math.max(0, p - mins[k]))), R = room.reduce((a, b) => a + b, 0);
  over = Math.min(over, R);
  let left = over;
  room.forEach((r, k) => { const t = Math.floor((over * r) / (R || 1)); out[k] -= t; left -= t; });
  for (let k = out.length - 1; left > 0 && k >= 0; k--) { const t = Math.min(left, pref[k] == null ? 0 : out[k] - mins[k]); out[k] -= t; left -= t; }
  return out;
}

/** The px size a split keeps for its pinned kid (a leaf's own size for its active tab first). */
export const pinnedSize = (n, activeOf = (l) => l.tab) => { const k = n.kids[n.pin]; return (isLeaf(k) && k.sizes?.[activeOf(k)]) || n.size; };

/**
 * Pixel layout of the tree in rect r ({x, y, w, h}). hidden(leaf): leaves left out (their sibling takes the room);
 * activeOf(leaf): its shown tab (per-tab sizes). -> {rects: {leafId: rect}, borders: [{path, dir, x, y, w, h,
 * value, min, max, reverse}], edges: {leafId: 'left'|'right'|'top'|'bottom'|''} (the side of its parent split it
 * sits on: a collapsed area folds toward it)}.
 */
export function place(t, r, { hidden = () => false, activeOf } = {}) {
  const out = { rects: {}, borders: [], edges: {} };
  const walk = (n, r, path, edge) => {
    if (isLeaf(n)) { if (!hidden(n)) { out.rects[n.id] = r; out.edges[n.id] = edge; } return; }
    const row = n.dir === 'row', total = row ? r.w : r.h, [a, b] = n.kids;
    const kidPath = (i) => (path ? path + '.' + i : String(i));
    const sides = row ? ['left', 'right'] : ['top', 'bottom'];
    if (gone(a, hidden) || gone(b, hidden)) { const i = gone(a, hidden) ? 1 : 0; walk(n.kids[i], r, kidPath(i), edge); return; }
    const fold = (k) => isLeaf(k) && k.collapsed && !k.kind;
    let sa, gap = GAP;
    if (fold(a) || fold(b)) { gap = 0; sa = fold(a) ? RAIL : Math.max(0, total - RAIL); }
    else {
      const p = n.pin, mn = minOf(n.kids[p], row, hidden), mo = minOf(n.kids[1 - p], row, hidden);
      const max = Math.max(0, total - gap - mo), min = Math.min(mn, Math.max(0, total - gap));
      const s = Math.max(min, Math.min(max, pinnedSize(n, activeOf)));
      sa = p === 0 ? s : Math.max(0, total - gap - s);
      const bx = row ? r.x + sa : r.x, by = row ? r.y : r.y + sa;
      out.borders.push({ path, dir: n.dir, x: bx, y: by, w: row ? gap : r.w, h: row ? r.h : gap, value: s, min, max: Math.max(min, max), reverse: p === 1 });
    }
    const sb = Math.max(0, total - gap - sa);
    walk(a, row ? { x: r.x, y: r.y, w: sa, h: r.h } : { x: r.x, y: r.y, w: r.w, h: sa }, kidPath(0), sides[0]);
    walk(b, row ? { x: r.x + sa + gap, y: r.y, w: sb, h: r.h } : { x: r.x, y: r.y + sa + gap, w: r.w, h: sb }, kidPath(1), sides[1]);
  };
  walk(t, r, '', '');
  return out;
}

/** paw-idb5: the px the open bottom tray (the leaf with home 'bottom') takes from the timeline instead of the video: its height
 *  plus the border, when it is pinned right under the section whose own split pins the timeline (the default frame); else 0.
 *  rects: place()'s rects. The timeline split's kept size then means timeline + tray, so the tray never moves the video. */
export function trayGive(t, rects) {
  const d = leaves(t).find((l) => l.home === 'bottom'), fd = d && !d.collapsed && rects[d.id] ? find(t, d.id) : null, ft = find(t, 'timeline');
  if (!fd?.parent || !ft?.parent) return 0;
  const pd = fd.parent, pt = ft.parent, dp = parentPath(fd.path);
  if (pd.dir !== 'col' || fd.index !== 1 || pd.pin !== 1 || pt.dir !== 'col' || pt.kids[pt.pin] !== ft.leaf) return 0;
  return parentPath(ft.path) === (dp ? dp + '.0' : '0') ? rects[d.id].h + GAP : 0;
}
/** place() with the open tray's px taken from the timeline (trayGive). -> place()'s result plus {give}. */
export function placeTray(t, r, o = {}) {
  const g = place(t, r, o), give = trayGive(t, g.rects);
  if (!give) return { ...g, give };
  return { ...place(setAt(t, parentPath(find(t, 'timeline').path), (n) => ({ ...n, size: n.size - give })), r, o), give };
}

export const inside = (r, x, y) => !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
/** Blender's docking zones over an area: the middle fifth each way is 'center', else the nearest edge's half. */
export function hitZone(r, x, y) {
  const nx = (x - r.x) / (r.w || 1), ny = (y - r.y) / (r.h || 1);
  if (Math.abs(nx - 0.5) < 0.2 && Math.abs(ny - 0.5) < 0.2) return 'center';
  const d = { left: nx, right: 1 - nx, top: ny, bottom: 1 - ny };
  return Object.keys(d).reduce((m, k) => (d[k] < d[m] ? k : m));
}
/** Where a drop in `zone` of rect r lands (the translucent preview). */
export function zoneRect(r, zone) {
  const hw = Math.round(r.w / 2), hh = Math.round(r.h / 2);
  return { center: r, left: { ...r, w: hw }, right: { ...r, x: r.x + r.w - hw, w: hw }, top: { ...r, h: hh }, bottom: { ...r, y: r.y + r.h - hh, h: hh } }[zone];
}
