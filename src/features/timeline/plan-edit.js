// plan-edit.js -- pure plan-lane decisions: click selection, drop / add-at-playhead gaps, segment navigation,
// duplicate without generation stamps. No DOM, no Svelte (node-tested in test/timeline-planlane.test.mjs).
import { sorted, gapAt, itemAt, create, duplicate } from './intervals.js';

/**
 * Selection after a click on segment `id`. mode: 'replace' | 'toggle' (Ctrl) | 'extend' (Shift: every segment
 * between the anchor and id, in time order). -> {sel: ids, anchor}.
 */
export function clickSelect(plan, sel, anchor, id, mode = 'replace') {
  if (mode === 'toggle') return sel.includes(id) ? { sel: sel.filter((x) => x !== id), anchor } : { sel: [...sel, id], anchor: id };
  if (mode === 'extend') {
    const L = sorted(plan), a = L.findIndex((s) => s.id === anchor), b = L.findIndex((s) => s.id === id);
    if (a < 0 || b < 0) return { sel: [id], anchor: id };
    return { sel: L.slice(Math.min(a, b), Math.max(a, b) + 1).map((s) => s.id), anchor };
  }
  return { sel: [id], anchor: id };
}

/** Nearest cut strictly before / at-or-after t (0 and dur when none). */
function cutBounds(cuts, t, dur) {
  let lo = 0, hi = dur;
  for (const c of cuts) { if (c <= t && c > lo) lo = c; if (c > t && c < hi) hi = c; }
  return { lo, hi };
}

/**
 * The span a new segment at t should fill: the free gap around t, bounded by the scene cuts around t; with no
 * cuts, `fallback` ms starting at t (slid back inside the gap if it hits the next segment). null if t is inside
 * a segment or the span would be shorter than minLen.
 */
export function fillSpan(plan, t, { cuts = [], dur, fallback = 10000, minLen = 1 } = {}) {
  t = Math.max(0, Math.min(dur, Math.round(t)));
  const g = gapAt(sorted(plan), t, dur);
  if (!g) return null;
  let t0, t1;
  if (cuts.length) { const b = cutBounds(cuts, t, dur); t0 = Math.max(g.t0, b.lo); t1 = Math.min(g.t1, b.hi); }
  else { t1 = Math.min(g.t1, t + fallback); t0 = Math.max(g.t0, t1 - fallback); }
  return t1 - t0 >= minLen ? { t0, t1 } : null;
}

/**
 * Where "add segment at playhead" goes: the range when one is set (confined to the free gap containing its
 * start), else fillSpan around t. -> {t0, t1} | null.
 */
export function addSpan(plan, t, { range = null, ...o } = {}) {
  if (range && range.t1 > range.t0) {
    const L = create(plan, { id: '\0', t0: range.t0, t1: range.t1 }, { dur: o.dur, minLen: o.minLen ?? 1 });
    const s = L?.find((x) => x.id === '\0');
    return s ? { t0: s.t0, t1: s.t1 } : null;
  }
  return fillSpan(plan, t, o);
}

/** The segment under t, or null. */
export const segmentAt = (plan, t) => itemAt(plan, t);

/**
 * Next (dir > 0) / previous segment relative to the current selection (its first id), or to t when nothing
 * is selected: the first segment starting after t / the last one starting before t (a segment containing t
 * counts as "previous" so Alt+PageUp first goes to the start of the current one).
 */
export function stepSegment(plan, sel, t, dir) {
  const L = sorted(plan);
  if (!L.length) return null;
  const i = sel.length ? L.findIndex((s) => s.id === sel[0]) : -1;
  if (i >= 0) return L[Math.max(0, Math.min(L.length - 1, i + dir))];
  if (dir > 0) return L.find((s) => s.t0 > t) ?? null;
  for (let k = L.length - 1; k >= 0; k--) if (L[k].t0 <= t) return L[k];
  return null;
}

/** intervals.duplicate, but the copies are new (no genKey) and unlocked. -> {list, ids} | null. */
export function duplicateSegments(plan, ids, { dur, newId }) {
  const r = duplicate(plan, ids, { dur, newId });
  if (!r) return null;
  const c = new Set(r.ids);
  return { list: r.list.map((s) => (c.has(s.id) && (s.genKey != null || s.locked) ? (({ genKey, locked, ...x }) => x)(s) : s)), ids: r.ids };
}

/** Ids of `sel` that still exist in plan (selection survives undo as stale ids). */
export const liveSel = (plan, sel) => { const have = new Set(plan.map((s) => s.id)); return sel.filter((id) => have.has(id)); };

/**
 * The segment context menu as kit MenuItems. Every entry runs a registry command, so its keys and enabled
 * state are the registry's. cmds: {has(id), enabled(id), keys(id) -> [chord], run(id, args)}; segs: the
 * segments it acts on (the selection); kinds: [{id, label, key}]; t: the time right-clicked (null from the
 * keyboard); empty: true when the click was on empty space.
 */
export function planMenu(cmds, segs, kinds, { t = null, empty = false, armedLabel = '' } = {}) {
  const it = (id, label, icon, args) => cmds.has(id)
    ? { id, label, icon, shortcut: cmds.keys(id)[0], disabled: !cmds.enabled(id), run: () => cmds.run(id, args) } : null;
  if (empty) return [it('timeline.plan.add', `Add ${armedLabel || 'segment'} here`, 'add', t == null ? undefined : { t }), it('timeline.plan.selectAll', 'Select all segments', 'select')].filter(Boolean);
  if (!segs.length) return [];
  const kind = segs.every((s) => s.kind === segs[0].kind) ? segs[0].kind : null, locked = segs.every((s) => s.locked);
  const kindItems = kinds.map((k) => { const x = it(`timeline.plan.kind.${k.id}`, k.label); return x && { ...x, type: 'radio', checked: k.id === kind }; }).filter(Boolean);
  return [
    it('timeline.plan.split', t == null ? 'Split at playhead' : 'Split here', 'split', t == null ? undefined : { t }),
    it('timeline.plan.merge', 'Merge', 'link'),
    it('timeline.plan.duplicate', 'Duplicate', 'duplicate'),
    kindItems.length ? { label: 'Kind', icon: 'layers', items: kindItems } : null,
    { separator: true },
    it('timeline.plan.generateSelected', 'Generate', 'wand'),
    it('timeline.plan.detach', 'Detach (keep the points)', 'unlink'),
    it('timeline.plan.lock', locked ? 'Unlock' : 'Lock', locked ? 'unlock' : 'lock'),
    { separator: true },
    it('timeline.plan.edit', 'Edit…', 'sliders'),
    it('timeline.plan.delete', segs.length > 1 ? `Delete ${segs.length} segments` : 'Delete', 'trash'),
  ].filter(Boolean);
}
