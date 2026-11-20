// clipboard.js -- copy/paste of graph fragments as text. A fragment is a Preset (lib/graph contract §8: nodes
// with preset-local ids, links among them, frames fully inside), wrapped as a .pawgraph file
// { format: 'pawgraph', version: 1, graph } so it pastes into any graph, another document, or a text editor.
// Pure (test/graph-editor-clipboard.test.mjs).

export const FORMAT = 'pawgraph';

/** Fragment -> clipboard text. */
export const writeClip = (preset) => JSON.stringify({ format: FORMAT, version: 1, graph: preset });

/**
 * Clipboard text -> a fragment { nodes, links, frames? } or null when the text is not one. Accepts a .pawgraph
 * wrapper (a whole graph too) or a bare { nodes, links }. Nodes without a type, and links whose ends are not in
 * the fragment, are dropped; nothing else is touched (params are completed by applyPreset).
 */
export function readClip(text) {
  let o;
  try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const g = o.format === FORMAT ? o.graph : o;
  if (!g || typeof g !== 'object' || !Array.isArray(g.nodes)) return null;
  const nodes = g.nodes.filter((n) => n && typeof n === 'object' && typeof n.type === 'string' && n.id != null);
  if (!nodes.length && !(Array.isArray(g.frames) && g.frames.length)) return null;
  const ids = new Set(nodes.map((n) => n.id));
  const links = (Array.isArray(g.links) ? g.links : []).filter((l) => l && ids.has(l.from) && ids.has(l.to) && l.out && l.in);
  return { ...g, nodes, links, frames: Array.isArray(g.frames) ? g.frames : [] };
}

/** Top-left of a fragment (paste anchors it at the pointer). */
export function fragmentOrigin(frag) {
  const xs = [...frag.nodes, ...(frag.frames || [])].map((n) => +n.x || 0), ys = [...frag.nodes, ...(frag.frames || [])].map((n) => +n.y || 0);
  return xs.length ? { x: Math.min(...xs), y: Math.min(...ys) } : { x: 0, y: 0 };
}

/**
 * Where a paste anchored at (x, y) lands. Repeating a paste at the same anchor steps each copy `step` further
 * down-right (like duplicate), so copies never hide each other exactly. state: the previous call's state or null.
 */
export function pasteSpot(state, x, y, step) {
  const key = `${x},${y}`, n = state?.key === key ? state.n + 1 : 0;
  return { x: x + n * step, y: y + n * step, state: { key, n } };
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
