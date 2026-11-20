// geometry.js -- canvas maths for the graph editor: view transforms, cursor-anchored zoom, fit, Bézier wires,
// knife hit tests, box selection, visibility culling. Pure (test/graph-editor-geometry.test.mjs).
//
// A view is { x, y, k }: screen = world * k + (x, y). World units are the graph's canvas units (node.x/y).
//
// PROVENANCE: adapted from OpenValence/Phosphor (same owner, Apache-2.0) src/ui/graph/GraphEditor.svelte:
// zoomAt (l.201), fit with the "an axis that fits is centred" rule (l.208-225), the backward-link Bézier
// `curve` (l.300-305) and the marquee intersection (l.402-411).

export const K_MIN = 0.2;
export const K_MAX = 2;
export const clampK = (k, lo = K_MIN, hi = K_MAX) => Math.min(hi, Math.max(lo, k));

export const toWorld = (v, sx, sy) => [(sx - v.x) / v.k, (sy - v.y) / v.k];
export const toScreen = (v, wx, wy) => [wx * v.k + v.x, wy * v.k + v.y];

/** Zoom by `factor` keeping the world point under screen (sx, sy) fixed. */
export function zoomAt(v, sx, sy, factor, lo = K_MIN, hi = K_MAX) {
  const k = clampK(v.k * factor, lo, hi);
  return { x: sx - ((sx - v.x) * k) / v.k, y: sy - ((sy - v.y) * k) / v.k, k };
}

/** Wheel delta -> zoom factor (Phosphor: exp(-dy * 0.0015)); deltaMode 1 = lines. */
export const wheelFactor = (dy, mode = 0) => Math.exp(-(mode === 1 ? dy * 16 : dy) * 0.0015);

/** {x0,y0,x1,y1} around rects ({x,y,w,h}), or null for none. */
export function boundsOf(rects) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    if (!r) continue;
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/**
 * The view that shows bounds b in a w x h viewport. An axis that fits is centred; one that does not starts at
 * the content's top-left (never its empty middle). kMax keeps a lone node from filling the screen.
 */
export function fitView(b, w, h, { pad = 40, kMin = K_MIN, kMax = 1.25 } = {}) {
  if (!b || w <= 0 || h <= 0) return { x: pad, y: pad, k: 1 };
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  const k = clampK(Math.min(kMax, (w - 2 * pad) / bw, (h - 2 * pad) / bh), kMin, kMax);
  const axis = (size, lo, hi) => ((hi - lo) * k <= size - 2 * pad ? (size - (hi - lo) * k) / 2 : pad) - lo * k;
  return { k, x: axis(w, b.x0, b.x1), y: axis(h, b.y0, b.y1) };
}

/** Pan so world point (wx, wy) sits at the viewport centre. */
export const centerOn = (v, wx, wy, w, h) => ({ ...v, x: w / 2 - wx * v.k, y: h / 2 - wy * v.k });

/** The world rect the viewport shows, grown by `margin` screen px on each side. */
export function visibleWorld(v, w, h, margin = 0) {
  const [x0, y0] = toWorld(v, -margin, -margin), [x1, y1] = toWorld(v, w + margin, h + margin);
  return { x0, y0, x1, y1 };
}

export const overlaps = (r, b) => r.x < b.x1 && r.x + r.w > b.x0 && r.y < b.y1 && r.y + r.h > b.y0;
export const inside = (r, b) => r.x >= b.x0 && r.x + r.w <= b.x1 && r.y >= b.y0 && r.y + r.h <= b.y1;
/** Normalise a dragged box (any corner order). */
export const boxOf = (ax, ay, bx, by) => ({ x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) });

/**
 * Marquee: ids of rects touching box (world). mode 'replace' | 'add' (Shift) | 'toggle' (Ctrl).
 * base: the selection when the drag started.
 */
export function boxSelect(rects, box, base = new Set(), mode = 'replace') {
  const hit = rects.filter((r) => overlaps(r, box)).map((r) => r.id);
  if (mode === 'replace') return new Set(hit);
  const out = new Set(base);
  for (const id of hit) {
    if (mode === 'toggle' && base.has(id)) out.delete(id);
    else out.add(id);
  }
  return out;
}

// ---- wires -------------------------------------------------------------------------------------------------

/**
 * Horizontal handle length of the wire p1 (an output) -> p2 (an input). A link running backward exits right and
 * re-enters left: its handles grow with the rise so the curve clears both nodes.
 */
export function handle(p1, p2) {
  const back = Math.min(1, Math.max(0, (p1[0] + 80 - p2[0]) / 80));
  return Math.max(40, Math.abs(p2[0] - p1[0]) / 2, (back * Math.abs(p2[1] - p1[1])) / 2);
}
const r1 = (n) => Math.round(n * 10) / 10;
export function wirePath(p1, p2) {
  const c = handle(p1, p2);
  return `M${r1(p1[0])} ${r1(p1[1])}C${r1(p1[0] + c)} ${r1(p1[1])} ${r1(p2[0] - c)} ${r1(p2[1])} ${r1(p2[0])} ${r1(p2[1])}`;
}
/** Point at parameter t on the wire. */
export function wireAt(p1, p2, t) {
  const c = handle(p1, p2), u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return [a * p1[0] + b * (p1[0] + c) + d * (p2[0] - c) + e * p2[0], a * p1[1] + b * p1[1] + d * p2[1] + e * p2[1]];
}
export function wirePolyline(p1, p2, n = 20) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(wireAt(p1, p2, i / n));
  return pts;
}
const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
/** Do segments ab and cd properly intersect (touching counts)? */
export function segmentsCross(a, b, c, d) {
  const d1 = cross(c[0], c[1], d[0], d[1], a[0], a[1]), d2 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = cross(a[0], a[1], b[0], b[1], c[0], c[1]), d4 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p, q, r) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  return (d1 === 0 && on(c, d, a)) || (d2 === 0 && on(c, d, b)) || (d3 === 0 && on(a, b, c)) || (d4 === 0 && on(a, b, d));
}
/** Knife: does the stroke (a polyline of world points) cross the wire p1 -> p2? */
export function strokeCutsWire(stroke, p1, p2) {
  if (stroke.length < 2) return false;
  const w = wirePolyline(p1, p2, 24);
  for (let i = 1; i < stroke.length; i++) {
    for (let j = 1; j < w.length; j++) if (segmentsCross(stroke[i - 1], stroke[i], w[j - 1], w[j])) return true;
  }
  return false;
}
/** Squared distance from point p to the wire (sampled); for drop-on-wire splicing. */
export function distToWire(p, p1, p2) {
  const w = wirePolyline(p1, p2, 24);
  let best = Infinity;
  for (let j = 1; j < w.length; j++) best = Math.min(best, distToSeg(p, w[j - 1], w[j]));
  return Math.sqrt(best);
}
function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/** Grid background for the viewport: cell size in screen px (coarsens when tiny) and its offset. */
export function gridOf(v, grid = 20) {
  let cell = grid * v.k;
  while (cell < 10) cell *= 5;
  return { cell, x: v.x, y: v.y, major: cell * 5 };
}
