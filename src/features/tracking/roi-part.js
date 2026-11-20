// roi-part.js -- Track ROI = track ONE painted part (paw-x8we, pure). The part is said with the Groups tool (Tab), never with a
// box or clicks on the video: the painted group seeds the run (sam2_mask takes its mask, sidecar v4.39 `groups`), and the
// trackers that need a box get its bounds.
//   paintedParts(scenes, t0, t1)        the parts painted in [t0, t1): one per name, its earliest painting the seed
//   partBox(poly, margin)               the painting's bounds as a box ROI, `margin` of its size added each side, inside 0..1
//   partRange(scenes, t, span)          what a part's run covers: the shot its seed is on, inside the span
//   pickOrder(parts, {first, last})     the pick menu's order: the part under the pointer, the last pick, then the rest
//   roiTracker(trackers, panelId, off)  the tracker a part's run takes
import { trackGroups } from './groups.js';

export const SAM = 'sam2_mask';
export const GRID = new Set(['tapnext_points', 'cotracker_points']);

/** -> [{name, group}] in time order of the seeds (group = trackGroups' entry: name, poly, t_ms, who, part ...). */
export function paintedParts(scenes, t0, t1) {
  const by = new Map();
  for (const g of trackGroups(scenes, t0, t1)) if (!by.has(g.name) || g.t_ms < by.get(g.name).t_ms) by.set(g.name, g);
  return [...by.values()].sort((a, b) => a.t_ms - b.t_ms).map((group) => ({ name: group.name, group }));
}

// ponytail: 10 % of the part's size each side (the old drag box had none: it was what the owner drew); a knob if a tracker wants more context
export function partBox(poly, margin = 0.1) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const [x, y] of poly || []) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (!(x1 > x0 && y1 > y0)) return null;
  const mx = (x1 - x0) * margin, my = (y1 - y0) * margin, c = (v) => Math.min(1, Math.max(0, v));
  const x = c(x0 - mx), y = c(y0 - my);
  return { kind: 'box', x, y, w: c(x1 + mx) - x, h: c(y1 + my) - y };
}

// ponytail: one seed, so one shot: SAM follows the mask from its frame and a hard cut loses it; a multi-shot part run (a seed per
// take, as the grid's splitSeeds) when the owner asks for it
export function partRange(scenes, t, span) {
  const s = (scenes || []).find((x) => t >= x.start_ms && t < x.end_ms);
  return s ? { start: Math.max(s.start_ms, span.t0), end: Math.min(s.end_ms, span.t1) } : { start: span.t0, end: span.t1 };
}

export function pickOrder(parts, { first = '', last = '' } = {}) {
  const rank = (p) => (p.name === first ? 0 : p.name === last ? 1 : 2);
  return parts.map((p, i) => [p, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
}

/** The panel's tracker when the owner picked one that takes a box (not the grid's, which T selects), else SAM (a single part's
 *  size: its mask's area against the seed's), else any other box tracker (a CPU install: optical flow), else a grid tracker. */
export function roiTracker(trackers = [], panelId = '', off = () => false) {
  const ok = (t) => !!t && !off(t) && (t.roi === 'box' || t.roi === 'box_or_points');
  const panel = trackers.find((t) => t.id === panelId);
  if (ok(panel) && !GRID.has(panel.id)) return panel;
  return trackers.find((t) => t.id === SAM && ok(t)) || trackers.find((t) => ok(t) && !GRID.has(t.id)) || trackers.find(ok) || null;
}
