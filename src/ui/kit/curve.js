// curve.js -- the pure half of CurveEditor.svelte: handle picking, relative drag with a gain, value snapping and label
// placement beside handles, clear of the drawn lines. The editing idiom (handle shape = drag axis, labels beside their
// handle, half-gain drag with Shift fine, one write per release, numeric twins on request) follows the owner's own
// Phosphor pattern card (OpenValence/Phosphor plugins/factory/advanced-penetration, same owner); the code is new.

export const HIT = 24;            // px: pointer radius that picks a handle
export const GAIN = 0.5;          // handle travel per pointer travel
export const FINE = GAIN / 10;    // Shift

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** A value held to [min, max] and its step grid. */
export function snapTo(v, { min = -Infinity, max = Infinity, step = 0 } = {}) {
  if (!Number.isFinite(v)) return v;
  const base = Number.isFinite(min) ? min : 0;
  const s = step > 0 ? +(base + Math.round((v - base) / step) * step).toFixed(6) : v;
  return clamp(s, min, max);
}

/** Index of the handle nearest the pointer within HIT px (positions in px), else -1. */
export function nearestHandle(pts, x, y, hit = HIT) {
  let best = -1, bd = hit;
  pts.forEach((p, i) => { if (!p) return; const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = i; } });
  return best;
}

/** A polyline with no gap over `step` px, so a point test cannot slip between samples. */
export function densify(poly, step = 3) {
  const out = [];
  poly.forEach((p, i) => {
    const q = poly[i + 1];
    out.push(p);
    if (!q) return;
    const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step);
    for (let j = 1; j < n; j++) out.push([p[0] + ((q[0] - p[0]) * j) / n, p[1] + ((q[1] - p[1]) * j) / n]);
  });
  return out;
}

const SIDES = [[1, -1], [1, 1], [-1, -1], [-1, 1], [1, 0], [-1, 0], [0, -1], [0, 1]];
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const clearOf = (pts, r, pad) => pts.every(([x, y]) => x < r.x - pad || x > r.x + r.w + pad || y < r.y - pad || y > r.y + r.h + pad);

/**
 * Label boxes beside their handles, px. items [{x, y, w, h}] (handle centre, label size), lines: polylines in px,
 * W x H the box. Each label tries eight sides at gap G, then farther out; it takes the first inside the box, clear of
 * the lines, the handles and the labels already placed; none clear: the first inside. -> [{x, y}] (label top-left).
 */
export function placeLabels(items, lines, W, H, G = 8) {
  const pts = lines.flatMap((l) => densify(l)), marks = items.map((it) => [it.x, it.y]), placed = [];
  return items.map((it) => {
    let first = null;
    for (const far of [0, 1, 2]) {
      for (const [ux, uy] of SIDES) {
        const gx = G + far * it.w * 0.5, gy = G + far * it.h;
        const r = { x: it.x + (ux > 0 ? gx : ux < 0 ? -gx - it.w : -it.w / 2), y: it.y + (uy > 0 ? gy : uy < 0 ? -gy - it.h : -it.h / 2), w: it.w, h: it.h };
        const inside = r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;
        if (!inside) continue;
        first ??= r;
        if (clearOf(pts, r, 1) && clearOf(marks, r, 7) && !placed.some((q) => overlap(q, r))) { placed.push(r); return { x: r.x, y: r.y }; }
      }
    }
    const r = first ?? { x: clamp(it.x + G, 0, Math.max(0, W - it.w)), y: clamp(it.y - G - it.h, 0, Math.max(0, H - it.h)), w: it.w, h: it.h };
    placed.push(r);
    return { x: r.x, y: r.y, bg: true };
  });
}
