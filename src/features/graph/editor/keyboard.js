// keyboard.js -- the keyboard chain: spatial node navigation, following wires, reading order, and ranking
// connect targets for the C picker. Pure (test/graph-editor-keyboard.test.mjs).

/** Ids in reading order: rows (centres within `rowTol` of each other) top to bottom, then left to right. */
export function readingOrder(rects, rowTol = 40) {
  const s = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const r of s) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(r.y - row[0].y) <= rowTol) row.push(r); else rows.push([r]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x)).map((r) => r.id);
}

const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];
/**
 * The nearest rect from `fromId` in direction 'left' | 'right' | 'up' | 'down', scored by distance along the
 * direction plus twice the sideways offset.
 */
export function neighbour(rects, fromId, dir) {
  const from = rects.find((r) => r.id === fromId);
  if (!from) return rects[0]?.id ?? null;
  const [fx, fy] = centre(from);
  const [ax, ay] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir] || [0, 0];
  // first within a cone of about +-63 degrees around the direction, else anywhere in its half-plane
  for (const cone of [0.5, 0]) {
    let best = null, bs = Infinity;
    for (const r of rects) {
      if (r.id === fromId) continue;
      const [cx, cy] = centre(r), dx = cx - fx, dy = cy - fy;
      const along = dx * ax + dy * ay, side = Math.abs(dx * ay - dy * ax);
      if (along <= 0 || along < side * cone) continue;
      const s = along + 2 * side;
      if (s < bs) { bs = s; best = r.id; }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Follow a wire from node `id`: 'down' -> the target of its first outgoing link (by target y), 'up' -> the
 * source of its first incoming link (in the order of `portOrder(id)`), `index` cycles when several exist.
 * Returns { node, link } or null.
 */
export function followWire(graph, id, dir, { index = 0, posOf = () => [0, 0], portOrder = () => [] } = {}) {
  let ls;
  if (dir === 'down') {
    ls = graph.links.filter((l) => l.from === id).sort((a, b) => posOf(a.to)[1] - posOf(b.to)[1] || posOf(a.to)[0] - posOf(b.to)[0]);
  } else {
    const order = portOrder(id);
    const rank = (l) => { const i = order.indexOf(l.in); return i < 0 ? order.length : i; };
    ls = graph.links.filter((l) => l.to === id).sort((a, b) => rank(a) - rank(b));
  }
  if (!ls.length) return null;
  const l = ls[((index % ls.length) + ls.length) % ls.length];
  return { node: dir === 'down' ? l.to : l.from, link: l.id };
}

/** Siblings: other nodes fed by the same upstream nodes (Alt+Up/Down walks them in y order). */
export function siblings(graph, id, posOf = () => [0, 0]) {
  const ups = new Set(graph.links.filter((l) => l.to === id).map((l) => l.from));
  const s = new Set();
  for (const l of graph.links) if (ups.has(l.from) && l.to !== id) s.add(l.to);
  s.add(id);
  return [...s].sort((a, b) => posOf(a)[1] - posOf(b)[1] || posOf(a)[0] - posOf(b)[0]);
}

/**
 * Ranked connect targets for a socket. from = { node, port, side: 'out' | 'in' }.
 * portsOf(nodeId) -> { ins, outs, params } (Port[]); plan({from, out, to, in}) -> planLink result;
 * posOf(nodeId) -> [x, y] (centre). Returns [{ node, port, side, adapter, replace, dist, label }] with valid
 * targets only, ordered: no adapter before adapter, then by distance.
 */
export function connectTargets({ graph, from, portsOf, plan, posOf }) {
  const out = [];
  const [fx, fy] = posOf(from.node);
  for (const n of graph.nodes) {
    if (n.id === from.node) continue;
    const ports = portsOf(n.id);
    const list = from.side === 'out' ? [...ports.ins, ...ports.params] : ports.outs;
    const [x, y] = posOf(n.id);
    for (const p of list) {
      const link = from.side === 'out' ? { from: from.node, out: from.port, to: n.id, in: p.name } : { from: n.id, out: p.name, to: from.node, in: from.port };
      const r = plan(link);
      if (!r.ok) continue;
      out.push({ node: n.id, port: p.name, side: from.side === 'out' ? 'in' : 'out', adapter: r.adapter || null, replace: r.replace || null, dist: Math.hypot(x - fx, y - fy), type: p.type, label: p.label || p.name });
    }
  }
  return out.sort((a, b) => !!a.adapter - !!b.adapter || a.dist - b.dist);
}
