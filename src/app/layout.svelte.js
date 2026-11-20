// layout.svelte.js -- the Blender-style area tree of each mode (= stage tab: scenes / track / refine / review; src/app/areas.js
// does the tree work) and the timeline rows, persisted in settings 'layout' as {mode: {tree, rows}}. Modes change which
// panels show (panel.modes); each mode remembers its own arrangement. The default trees reproduce the old frame: [left | video | right] / timeline / bottom.
import { at, setAt, find, leaves, mapLeaf, newId, split, moveTab, moveArea, join, close, normalise, defaultTree, pinnedSize, RAIL } from './areas.js';

const DEFAULT = {
  left: { size: 300, collapsed: false, tab: '' },
  right: { size: 330, collapsed: false, tab: '' },
  // the bottom tray (paw-idb5): folded by default, and folded it takes no height (hidden()); open, a fifth of the window
  bottom: { size: typeof innerHeight === 'number' ? Math.round(Math.max(160, innerHeight * 0.2)) : 200, collapsed: true, tab: '', sizes: {} },   // sizes: panelId -> px
  // + the folded dock's old rail (paw-idb5: the folded tray takes no height; its px are the timeline's, not the video's)
  timeline: { size: (typeof innerHeight === 'number' ? Math.round(Math.max(360, innerHeight * 0.45)) : 420) + RAIL },
  rows: { 'timeline.plan': { collapsed: true } },   // laneId -> {height, collapsed}; the legacy Plan row starts hidden
};
const LIMITS = { left: [240, 640], right: [240, 680], bottom: [120, 1400], timeline: [120, 900] };
// first-run arrangement per mode: what each mode is for stays in view, the rest starts folded (one click away)
const DEFAULT_BY_MODE = {
  // Scenes (paw-ef73.1): timeline hygiene, the Scenes panel open. Its rows are the lanes' own choice (lane.js `modes`,
  // paw-ef73.7): the ruler, the Scenes / Shots strips, the filmstrip taking the leftover height, the chips; no other row at all
  scenes: { left: { collapsed: false, tab: 'tracking.scenes' }, right: { tab: 'timeline.inspector' } },
  refine: { left: { collapsed: true }, right: { tab: 'timeline.inspector' }, rows: { 'timeline.scenes': { collapsed: true }, 'timeline.waveform': { collapsed: true }, tracking: { collapsed: true }, 'graph.probe': { collapsed: true } } },
  review: { left: { collapsed: false }, right: { tab: 'review.problems' }, rows: { 'timeline.plan': { collapsed: true }, 'timeline.scenes': { collapsed: true }, tracking: { collapsed: true }, 'graph.probe': { collapsed: true } } },
  track: { right: { tab: 'timeline.inspector' }, rows: { 'timeline.plan': { collapsed: true }, 'timeline.loops': { collapsed: true }, 'timeline.waveform': { collapsed: true }, 'graph.probe': { collapsed: true } } },
};

// per-mode default dock of a panel (the user's move wins): Review spreads its panels over both sides, so no tab
// strip holds nine tabs in 300 px
const DOCK_BY_MODE = { review: { 'review.stats': 'left', 'review.compare': 'left', 'review.device': 'left' } };

// layout format: v7 = the stage tabs (paw-ef73.1): the Script mode's layout is Refine's, the new Scenes tab starts from
// Track's area tree (its dock sizes; its own default rows); v2 = the Tracker row under Range, the Plan row hidden by default; v3 = the right dock opens on the
// timeline Inspector in Script and Track; v4 = the docks become a Blender area tree per mode (migrateLayout); v5 = the
// Scenes row has two strips (paw-k2u): a stored height at the old one-strip default (22-26 px) goes, so the new 46 applies;
// v6 = a third strip, Modifiers (paw-8qb): a stored height at the v5 default (44-48 px) goes too, so the new 56 applies;
// v8 = the bottom of the window (paw-idb5, paw-1w0x): no rail under the folded bottom dock (now the tray, no height when folded),
// no hidden-rows strip, no Chapters row; their px go to the timeline and the Tracker row ("more room ... to the tracker"): a tree
// with the tray folded gives its timeline split the rail's px, a stored Tracker height grows by the strip and the Chapters row
export const LAYOUT_V = 8;
/** px each removed piece took (v8): the folded dock's rail, the hidden-rows strip, the Chapters row and its splitter. */
export const FREED = { rail: RAIL, strip: 20, chapters: 27 };
// what each mode showed of the moved rows before v2 (collapsed?): a stored entry saying just that is no customisation
const V1_COLLAPSED = { 'timeline.plan': { review: true, track: true }, tracking: { refine: true, review: true } };
// the right-dock tabs v3 moves off (the rarely used ones the dock sat on), per mode
const V2_TABS = { refine: ['timeline.plan'], track: ['timeline.plan', 'inspector.selection'] };
/** Stored layouts from format `from` up to LAYOUT_V. v1 -> v2: per mode, a stored entry for the Plan / Tracker row that
 *  only repeats the old default (no height of its own, the old collapsed state) goes, so the new default applies; a
 *  resized or explicitly toggled row stays. v2 -> v3: a right dock left on Plan (Track: also the point Inspector) drops
 *  its tab, so it opens on the timeline Inspector; its size and collapsed state stay. v3 -> v4: the left / right /
 *  bottom / timeline entries become that mode's area tree (same sizes, folds, tabs, the bottom's per-panel sizes);
 *  panels moved to another dock (settings layout.docks) keep going there. Rows stay as they are. */
export function migrateLayout(all, from = 1) {
  const out = {};
  const { script, ...rest } = all || {};   // v7 first: the old Script mode is Refine (so the older steps go by the new names)
  if (from < 7 && script && !rest.refine) all = { ...rest, refine: script };
  for (const [m, lay] of Object.entries(all || {})) {
    let l = lay;
    if (from < 2 && l?.rows && typeof l.rows === 'object') {
      const rows = { ...l.rows };
      for (const [id, old] of Object.entries(V1_COLLAPSED)) {
        const e = rows[id];
        if (e && e.height == null && !!e.collapsed === !!old[m]) delete rows[id];
      }
      l = { ...l, rows };
    }
    if (from < 3 && V2_TABS[m]?.includes(l?.right?.tab)) { const { tab: _, ...right } = l.right; l = { ...l, right }; }
    if (from < 4 && l && typeof l === 'object') {
      const { left: _l, right: _r, bottom: _b, timeline: _t, ...rest } = l;
      l = { ...rest, tree: defaultTree(docksFor(m, l)) };
    }
    if (from < 8 && l && typeof l === 'object') {
      const ft = l.tree && find(l.tree, 'timeline'), tray = l.tree && leaves(l.tree).find((x) => x.home === 'bottom');
      if (tray?.collapsed && ft?.parent && ft.parent.kids[ft.parent.pin] === ft.leaf) l = { ...l, tree: setAt(l.tree, up(ft.path), (n) => ({ ...n, size: n.size + FREED.rail })) };
      const th = l.rows?.tracking?.height;
      if (typeof th === 'number') {
        const rows = { ...DEFAULT.rows, ...DEFAULT_BY_MODE[m]?.rows, ...l.rows };
        const more = (Object.values(rows).some((r) => r?.collapsed) ? FREED.strip : 0) + (rows['timeline.chapters']?.collapsed ? 0 : FREED.chapters);
        l = { ...l, rows: { ...l.rows, tracking: { ...l.rows.tracking, height: th + more } } };
      }
    }
    const sh = l?.rows?.['timeline.scenes']?.height;
    if ((from < 5 && sh >= 22 && sh <= 26) || (from < 6 && sh >= 44 && sh <= 48)) { const { height: _, ...e } = l.rows['timeline.scenes']; l = { ...l, rows: { ...l.rows, 'timeline.scenes': e } }; }   // eslint-disable-line no-unused-vars
    out[m] = l;
  }
  if (from < 7 && out.track?.tree && !out.scenes) out.scenes = { tree: out.track.tree };
  return out;
}

const merge = (a, b) => {
  const o = { ...a };
  for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(a[k] || {}), ...v } : v;
  return o;
};
/** A mode's dock settings (defaults, then a stored v3 entry), sizes back inside their limits. */
function docksFor(mode, stored) {
  const c = merge(merge(DEFAULT, DEFAULT_BY_MODE[mode]), stored);
  for (const [d, [lo, hi]] of Object.entries(LIMITS)) {
    if (!c[d] || typeof c[d] !== 'object') c[d] = { ...DEFAULT[d] };
    const v = Number(c[d].size);
    if (!Number.isFinite(v) || v < lo || v > hi) c[d] = { ...c[d], size: Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : DEFAULT[d].size };
  }
  return c;
}
/** The timeline rows of the current tab: lanes (features' lane.js) that belong to it and do not hide themselves, in order.
 *  Timeline.svelte stacks them; the bottom tray's Rows tab (paw-idb5) lists the ones that can be hidden. */
export function rowsIn(lanes, app) {
  const orderOf = (r) => r.orderIn?.[app.mode] ?? r.order ?? 100;
  return lanes.filter((r) => { try { return (!r.modes || r.modes.includes(app.mode)) && (!r.visible || r.visible(app) !== false); } catch { return true; } })   // a row may hide itself (no audio track, ...) or belong to other tabs (modes)
    .sort((a, b) => orderOf(a) - orderOf(b));
}
const up = (path) => (path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : '');

export class Layout {
  // paw-shgb: read through the settings (one object for every tab), so a layout changed in one tab is the one the next shows
  get #all() { const a = this.app.settings.get('layout'); return a && typeof a === 'object' && !Array.isArray(a) ? a : {}; }
  set #all(v) { this.app.settings.set('layout', v); }
  get #docks() { return this.app.settings.get('layout.docks') || {}; }   // panelId -> dock the user moved it to before v4 (all modes): where unplaced panels go
  set #docks(v) { this.app.settings.set('layout.docks', v); }
  #max = $state.raw(null);   // {mode, id}: the area shown full-window (Toggle Maximize Area), not persisted
  hover = null;              // the leaf under the pointer (the shell keeps it; Toggle Maximize Area acts on it)

  constructor(app) {
    this.app = app;
    const v = +app.settings.get('layout.v', 1) || 1;
    if (v < LAYOUT_V) {   // once: older layouts get the new defaults
      if (Object.keys(this.#all).length) { this.#all = migrateLayout(this.#all, v); app.settings.set('layout', this.#all); }
      app.settings.set('layout.v', LAYOUT_V);
    }
  }
  get #mine() { return this.#all[this.app.mode] || {}; }
  #save(patch) { const m = this.app.mode; this.#all = { ...this.#all, [m]: { ...this.#mine, ...patch } }; this.app.settings.set('layout', this.#all); }
  #note(op, d = {}) { this.app.usage?.note('ui:area', { op, mode: this.app.mode, ...d }); }

  /** This mode's area tree (a corrupt or hand-edited one falls back to the default: the video is never lost). */
  get tree() {
    const src = this.#mine.tree, m = this.app.mode, c = this.#memo;
    if (c && c.src === src && c.mode === m) return c.out;
    this.#memo = { src, mode: m, out: normalise(src) || defaultTree(docksFor(m, {})) };
    return this.#memo.out;
  }
  #memo = null;   // the last tree (same stored object, same mode: same tree object, so views keyed on it hold still)
  /** The dock a panel goes to when no area lists it. */
  #home(p) { return this.#docks[p.id] || DOCK_BY_MODE[this.app.mode]?.[p.id] || p.dock; }
  /** Panels of this mode per leaf id, in tab order: the ones a leaf lists, then unplaced ones by their dock. */
  get placed() {
    const ls = leaves(this.tree).filter((l) => !l.kind), out = Object.fromEntries(ls.map((l) => [l.id, []]));
    const avail = (this.app.panels || []).filter((p) => !p.modes || p.modes.includes(this.app.mode));
    const listed = new Map(ls.flatMap((l) => (l.tabs || []).map((id, i) => [id, [l.id, i]])));
    const rank = (p) => listed.get(p.id)?.[1] ?? 1e9;
    for (const p of [...avail].sort((a, b) => rank(a) - rank(b))) {
      const id = listed.get(p.id)?.[0] || ls.find((l) => l.home === this.#home(p))?.id || ls[0]?.id;
      if (id) out[id].push(p);
    }
    return out;
  }
  /** A leaf left out of the layout: a dock with nothing to show in this mode, an area whose panels are all gone, or the folded
   *  bottom tray (paw-idb5: no rail; the status bar's centred button and Ctrl+J open it). */
  hidden(leaf, placed = this.placed) { return !leaf.kind && ((leaf.home === 'bottom' && !!leaf.collapsed) || (!placed[leaf.id]?.length && (!!leaf.home || !!leaf.tabs?.length))); }
  /** Is the bottom tray open (this mode)? */
  get trayOpen() { const l = this.#leaf('bottom'); return !!l && l.home === 'bottom' && !l.collapsed; }
  /** The shown panel of a leaf. */
  active(leaf, placed = this.placed) { const ps = placed[leaf.id] || []; return ps.find((p) => p.id === leaf.tab) || ps[0]; }
  /** A leaf by id, else the leaf with that dock name ('left' | 'right' | 'bottom'), else the 'timeline' / 'video' one. */
  #leaf(where, t = this.tree) { const ls = leaves(t); return ls.find((l) => l.id === where) || ls.find((l) => l.home === where) || ls.find((l) => l.kind === where); }
  /** The id of the area a panel is in (this mode). */
  dockOf(p) { const pl = this.placed; return Object.keys(pl).find((id) => pl[id].some((x) => x.id === p.id)); }
  panelsIn(where) { const l = this.#leaf(where); return (l && this.placed[l.id]) || []; }
  /** Is the panel the shown tab of an unfolded area? */
  shows(id) { const pl = this.placed, l = this.#leaf(this.dockOf({ id }) || ''); return !!l && !l.collapsed && this.active(l, pl)?.id === id; }

  /** The tree with every leaf listing the panels it shows (so tree ops can move them). */
  #explicit() {
    const pl = this.placed;
    let t = this.tree;
    for (const l of leaves(t)) if (!l.kind) t = mapLeaf(t, l.id, (x) => ({ ...x, tabs: [...new Set([...pl[x.id].map((p) => p.id), ...(x.tabs || [])])] }));
    return t;
  }
  #setTree(t, op, d) { if (!t) return false; this.#save({ tree: t }); this.#note(op, d); return true; }

  /** Panel `id` into leaf `to`: 'center' = one more tab there, an edge = a new area on that side (size px). */
  moveTab(id, to, zone = 'center', size) { return this.#setTree(moveTab(this.#explicit(), id, to, zone, size), 'dock', { id, to, zone }); }
  /** A whole area onto leaf `to`: 'center' swaps them, an edge docks it on that side. */
  moveArea(id, to, zone, size) { return this.#setTree(moveArea(this.#explicit(), id, to, zone, size), zone === 'center' ? 'swap' : 'move', { id, to, zone }); }
  /** Split leaf `id`: a new empty area on `side` with `size` px (it opens on the panel picker). -> its id, or null. */
  split(id, side, size) { const nid = newId(); return this.#setTree(split(this.#explicit(), id, side, { id: nid, tabs: [] }, size), 'split', { id, side }) ? nid : null; }
  join(keep, gone) { return this.#setTree(join(this.#explicit(), keep, gone), 'join', { keep, gone }); }
  canJoin(keep, gone) { return !!join(this.#explicit(), keep, gone); }
  close(id) { return this.#setTree(close(this.#explicit(), id), 'close', { id }); }
  /** Swap the two sides of the split at `path` (a border's Swap Areas); the kept size stays with its side. */
  swapSides(path) { const t = this.tree; return !!at(t, path)?.kids && this.#setTree(setAt(t, path, (x) => ({ ...x, pin: 1 - x.pin, kids: [x.kids[1], x.kids[0]] })), 'swap', { path }); }
  /** A border dragged: the pinned side's px (for the shown tab, where that area keeps a size per panel). */
  resize(path, px) {
    const t = this.tree, n = at(t, path);
    if (!n?.kids) return;
    const k = n.kids[n.pin], v = Math.max(RAIL, Math.round(px));
    const tab = !k.kids && k.sizes ? this.active(k)?.id : null;
    this.#save({ tree: tab ? mapLeaf(t, k.id, (l) => ({ ...l, tab, sizes: { ...l.sizes, [tab]: v } })) : setAt(t, path, (x) => ({ ...x, size: v })) });
  }
  /** The timeline's top border double-clicked: its default height. */
  resetTimelineSize() { this.size('timeline', DEFAULT.timeline.size); }
  get maximized() { const m = this.#max; return m && m.mode === this.app.mode && find(this.tree, m.id) ? m.id : null; }
  /** Blender's Toggle Maximize Area: that area full-window; again (anywhere) back. */
  toggleMax(id = this.hover) {
    if (this.maximized) { this.#max = null; this.#note('unmax'); return true; }
    if (!id || !find(this.tree, id)) return false;
    this.#max = { mode: this.app.mode, id };
    this.#note('max', { id });
    return true;
  }

  // ---- the pre-areas API (commands, features, scripts): a dock name means the leaf with that home ----
  /** The current mode's docks as before areas ({left, right, bottom: {size, collapsed, tab, sizes?}, timeline: {size}}),
   *  plus the tree and the timeline rows. */
  get cur() {
    const t = this.tree, out = { tree: t, rows: this.rows };
    for (const d of ['left', 'right', 'bottom', 'timeline']) {
      const l = this.#leaf(d, t), f = l && find(t, l.id), own = f?.parent?.kids[f.parent.pin] === l;
      out[d] = l ? { size: own ? pinnedSize(f.parent, () => '') : null, collapsed: !!l.collapsed, tab: l.tab || '', ...(l.sizes ? { sizes: l.sizes } : {}) } : { size: null, collapsed: true, tab: '' };
    }
    return out;
  }
  move(id, where) { const l = this.#leaf(where); return !!l && this.moveTab(id, l.id, 'center'); }
  /** Resize the area named `where`; panelId: its size for that panel only (the bottom dock keeps one per panel). */
  size(where, px, panelId) {
    const t = this.tree, l = this.#leaf(where, t), f = l && find(t, l.id);
    if (!f?.parent) return;
    const [lo, hi] = LIMITS[where] || [RAIL, 8000], v = Math.round(Math.max(lo, Math.min(hi, px)));
    if (panelId && l.sizes) this.#save({ tree: mapLeaf(t, l.id, (x) => ({ ...x, sizes: { ...x.sizes, [panelId]: v } })) });
    else this.#save({ tree: setAt(t, up(f.path), (x) => ({ ...x, size: v })) });
  }
  sizeOf(where, panelId) { const d = this.cur[where]; return (panelId && d?.sizes?.[panelId]) || d?.size; }
  /** Fold / unfold an area (on: true = unfold). The video and the timeline never fold. */
  toggle(where, on) {
    const t = this.tree, l = this.#leaf(where, t);
    if (!l || l.kind) return;
    const collapsed = on == null ? !l.collapsed : !on;
    this.#save({ tree: mapLeaf(t, l.id, (x) => ({ ...x, collapsed })) });
    this.app.usage?.note('ui:dock', { dock: l.home || l.id, collapsed, mode: this.app.mode });
  }
  /** Show panel `id` (in whatever area holds it; `where` when none does): its tab, its area unfolded. */
  tab(where, id) {
    const t = this.tree, l = this.#leaf(this.dockOf({ id }) || where, t);
    if (!l || l.kind) return;
    if (this.maximized && this.maximized !== l.id) this.#max = null;
    this.#save({ tree: mapLeaf(t, l.id, (x) => ({ ...x, tab: id, collapsed: false })) });
    this.app.usage?.note('ui:panel', { dock: l.home || l.id, id, mode: this.app.mode });
  }

  // ---- timeline rows ----
  get rows() { const r = this.#mine.rows; return { ...DEFAULT.rows, ...DEFAULT_BY_MODE[this.app.mode]?.rows, ...(r && typeof r === 'object' ? r : {}) }; }
  row(id) { return { height: null, collapsed: false, ...(this.rows[id] || {}) }; }
  setRow(id, p) { this.setRows({ [id]: p }); }
  /** Several rows at once ({id: {height?, collapsed?}}): one save for a splitter drag that moves two or more rows. */
  setRows(patch) { if (!Object.keys(patch).length) return; const rows = { ...(this.#mine.rows || {}) }; for (const [id, p] of Object.entries(patch)) rows[id] = { ...this.row(id), ...p }; this.#save({ rows }); }
  /** Every timeline row back to this mode's default height and shown / hidden state. */
  resetRows() { const m = this.app.mode, { rows: _, ...mine } = this.#mine; this.#all = { ...this.#all, [m]: mine }; this.app.settings.set('layout', this.#all); }
  /** This mode's areas and rows back to the default (and every panel back to its own dock). */
  reset() { const { [this.app.mode]: _, ...rest } = this.#all; this.#all = rest; this.app.settings.set('layout', rest); this.#docks = {}; this.app.settings.set('layout.docks', {}); this.#max = null; }
}
