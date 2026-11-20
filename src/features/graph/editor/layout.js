// layout.js -- align, distribute, auto-arrange and free-spot placement for graph nodes. Pure
// (test/graph-editor-layout.test.mjs). Rects are { id, x, y, w, h } in world units; results are
// [{ id, x, y }] for the nodes that move (snapped to the grid).

const snapTo = (v, g) => Math.round(v / g) * g;

/**
 * Align rects: 'left' | 'right' | 'top' | 'bottom' | 'hcenter' (centres on one vertical line) | 'vcenter'.
 * Not grid-snapped: card sizes are measured, so snapping would undo exact edges and centres.
 */
export function align(rects, mode) {
  if (rects.length < 2) return [];
  const minX = Math.min(...rects.map((r) => r.x)), maxX = Math.max(...rects.map((r) => r.x + r.w));
  const minY = Math.min(...rects.map((r) => r.y)), maxY = Math.max(...rects.map((r) => r.y + r.h));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const f = {
    left: (r) => [minX, r.y], right: (r) => [maxX - r.w, r.y],
    top: (r) => [r.x, minY], bottom: (r) => [r.x, maxY - r.h],
    hcenter: (r) => [cx - r.w / 2, r.y], vcenter: (r) => [r.x, cy - r.h / 2],
  }[mode];
  if (!f) throw new Error('align: unknown mode ' + mode);
  return moved(rects, rects.map((r) => { const [x, y] = f(r); return { id: r.id, x: Math.round(x), y: Math.round(y) }; }));
}

/** Equal gaps between rects along 'x' or 'y' (the outermost two stay put; not snapped, as align). */
export function distribute(rects, axis = 'x') {
  if (rects.length < 3) return [];
  const pos = axis === 'x' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h';
  const s = [...rects].sort((a, b) => a[pos] - b[pos]);
  const span = s[s.length - 1][pos] + s[s.length - 1][size] - s[0][pos];
  const gap = (span - s.reduce((n, r) => n + r[size], 0)) / (s.length - 1);
  let at = s[0][pos];
  const out = s.map((r) => { const p = at; at += r[size] + gap; return { id: r.id, x: r.x, y: r.y, [pos]: Math.round(p) }; });
  return moved(rects, out);
}

const moved = (rects, next) => {
  const was = new Map(rects.map((r) => [r.id, r]));
  return next.filter((n) => was.get(n.id).x !== n.x || was.get(n.id).y !== n.y);
};

/**
 * Layered auto-arrange (Sugiyama-lite): layer = longest path from a source; within a layer, order by the mean
 * row of each node's predecessors (two sweeps, ties by current y); columns as wide as their widest node.
 * rects: the nodes to arrange; links: [{from, to}] (links touching other nodes are ignored).
 * The arranged block keeps the top-left of the original selection.
 */
export function autoLayout(rects, links, { gapX = 80, gapY = 30, grid = 20 } = {}) {
  if (!rects.length) return [];
  const ids = new Set(rects.map((r) => r.id)), byId = new Map(rects.map((r) => [r.id, r]));
  const L = links.filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to);
  const preds = new Map(rects.map((r) => [r.id, []])), succs = new Map(rects.map((r) => [r.id, []]));
  for (const l of L) { preds.get(l.to).push(l.from); succs.get(l.from).push(l.to); }
  // longest-path layering on a DAG; nodes on a cycle (a lying file) fall back to layer 0
  const layer = new Map(), indeg = new Map(rects.map((r) => [r.id, preds.get(r.id).length]));
  const queue = rects.filter((r) => !indeg.get(r.id)).map((r) => r.id).sort((a, b) => byId.get(a).y - byId.get(b).y);
  for (const id of queue) layer.set(id, 0);
  while (queue.length) {
    const id = queue.shift();
    for (const s of succs.get(id)) {
      layer.set(s, Math.max(layer.get(s) ?? 0, layer.get(id) + 1));
      indeg.set(s, indeg.get(s) - 1);
      if (!indeg.get(s)) queue.push(s);
    }
  }
  for (const r of rects) if (!layer.has(r.id)) layer.set(r.id, 0);
  // sinks pulled right next to their consumers is the default; pull sources right too so a source feeding a
  // deep node does not sit far left alone
  for (const r of [...rects].sort((a, b) => layer.get(b.id) - layer.get(a.id))) {
    const ss = succs.get(r.id);
    if (ss.length && !preds.get(r.id).length) layer.set(r.id, Math.max(layer.get(r.id), Math.min(...ss.map((s) => layer.get(s))) - 1));
  }
  const nL = Math.max(...layer.values()) + 1;
  const cols = Array.from({ length: nL }, () => []);
  for (const r of rects) cols[layer.get(r.id)].push(r.id);
  for (const c of cols) c.sort((a, b) => byId.get(a).y - byId.get(b).y || byId.get(a).x - byId.get(b).x);
  const rowOf = () => { const m = new Map(); cols.forEach((c) => c.forEach((id, i) => m.set(id, i))); return m; };
  for (let sweep = 0; sweep < 2; sweep++) {
    let row = rowOf();
    for (let i = 1; i < nL; i++) {
      const bary = (id) => { const p = preds.get(id); return p.length ? p.reduce((n, q) => n + row.get(q), 0) / p.length : row.get(id); };
      cols[i].sort((a, b) => bary(a) - bary(b));
      row = rowOf();
    }
  }
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const out = [];
  let x = x0;
  for (const c of cols) {
    if (!c.length) continue;
    let y = y0;
    for (const id of c) { out.push({ id, x: snapTo(x, grid), y: snapTo(y, grid) }); y += byId.get(id).h + gapY; }
    x += Math.max(...c.map((id) => byId.get(id).w)) + gapX;
  }
  return moved(rects, out);
}

/** First spot at or below (x, y) where a w x h box overlaps none of rects, stepping by `step`. */
export function freeSpot(rects, x, y, w, h, step = 20, pad = 10) {
  for (let i = 0; i < 400; i++) {
    const hit = rects.find((r) => x < r.x + r.w + pad && x + w + pad > r.x && y < r.y + r.h + pad && y + h + pad > r.y);
    if (!hit) return { x, y };
    y = Math.ceil((hit.y + hit.h + pad) / step) * step;
  }
  return { x, y };
}
