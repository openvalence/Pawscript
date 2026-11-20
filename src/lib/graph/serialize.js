// Versioned load/save of graphs (contract §6, src/lib/graph/README.md): tolerant parsing with migrations, the .pawproj
// feature block `graphs: { v: 1, items }`, and standalone .pawgraph files. Unknown node types, unknown keys and
// parameters survive a load/save untouched; only dangling links are dropped (with a diagnostic).
//
// PROVENANCE: load-time filtering follows OpenValence/Phosphor src/model/graph.js loadLocal (l.719-735, Apache-2.0,
// same owner), changed to KEEP nodes of unknown type.

import { coerce, normalizeValues } from '../../ui/kit/params.js';
import { newId, migrateNode } from './model.js';
import { snapRate } from './types.js';

export const GRAPH_VERSION = 1;
/** { [v]: (obj) => obj of version v + 1 }. Empty while the format is at version 1. */
export const MIGRATIONS = {};

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const fin = (x, d = 0) => (Number.isFinite(x) ? x : Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : d);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Tolerant parse of one graph. Never throws for content problems; throws Error('not a graph: ...') when raw is not an object. */
export function parseGraph(raw, reg) {
  if (!isObj(raw)) throw new Error(`not a graph: expected an object, got ${raw === null ? 'null' : Array.isArray(raw) ? 'an array' : typeof raw}`);
  const diags = [];
  const note = (id, message, extra = {}) => diags.push({ id, severity: 'warn', code: 'note', message, ...extra });

  let obj = raw;
  let v = Number.isInteger(raw.v) ? raw.v : GRAPH_VERSION;
  while (v < GRAPH_VERSION && MIGRATIONS[v]) { obj = MIGRATIONS[v](obj); v++; }
  if (v > GRAPH_VERSION) note('note@graph:version', `saved by a newer version (format ${v}); unknown parts are kept`);

  const g = { ...obj, v: Math.max(v, GRAPH_VERSION) };
  g.id = typeof obj.id === 'string' && obj.id ? obj.id : newId('g');
  g.name = typeof obj.name === 'string' ? obj.name : 'Graph';
  g.rate = snapRate(obj.rate);

  // nodes
  const ids = new Set();
  g.nodes = [];
  for (const rn of Array.isArray(obj.nodes) ? obj.nodes : []) {
    if (!isObj(rn)) continue;
    const n = { ...rn };
    if (typeof n.id !== 'string' || !n.id || ids.has(n.id)) {
      const was = n.id;
      n.id = newId('n');
      if (was != null) note(`note@${n.id}:renamed`, `duplicate node id "${was}" renamed to "${n.id}"`, { node: n.id });
    }
    ids.add(n.id);
    n.type = typeof n.type === 'string' ? n.type : String(n.type ?? '');
    n.x = fin(n.x);
    n.y = fin(n.y);
    n.params = isObj(n.params) ? { ...n.params } : {};
    const def = reg?.get(n.type);
    let tv = Number.isInteger(n.tv) && n.tv >= 1 ? n.tv : 1;
    if (def) {
      const m = migrateNode(def, n.params, isObj(n.byKind) ? n.byKind : undefined, tv);
      if (!m.ok) {
        // keep the old tv and the raw params: the migration is retried on the next load instead of being lost
        note(`note@${n.id}:migrate`, `could not migrate "${n.type}" from version ${tv}: ${m.error}`, { node: n.id });
      } else {
        n.params = m.params;
        if (m.byKind !== undefined) n.byKind = m.byKind;
      }
      if (tv > def.version) note(`note@${n.id}:tv`, `"${n.type}" was saved by a newer version (${tv} > ${def.version})`, { node: n.id });
      else if (m.ok) {
        const before = n.params;
        n.params = normalizeValues(def.params, before);
        for (const p of def.params) {
          if (p.key in before && !same(before[p.key], n.params[p.key])) {
            diags.push({ id: `param@${n.id}:p:${p.key}`, node: n.id, port: 'p:' + p.key, severity: 'warn', code: 'param',
              message: `${p.label || p.key}: stored value ${JSON.stringify(before[p.key])} was invalid, using ${JSON.stringify(n.params[p.key])}` });
          }
        }
        tv = def.version;
      }
      if (n.byKind !== undefined) {
        if (isObj(n.byKind)) {
          const bk = {};
          for (const [kind, o] of Object.entries(n.byKind)) {
            if (!isObj(o)) continue;
            const e = { ...o };
            for (const p of def.params) if (p.key in e) e[p.key] = coerce(p, e[p.key]);
            bk[kind] = e;
          }
          n.byKind = bk;
        } else delete n.byKind;
      }
    }
    n.tv = tv;
    g.nodes.push(n);
  }

  // links: endpoints must exist; ids filled and unique; one link per input (the later wins)
  const lids = new Set();
  const byIn = new Map();
  for (const rl of Array.isArray(obj.links) ? obj.links : []) {
    if (!isObj(rl)) continue;
    const l = { ...rl };
    if (typeof l.id !== 'string' || !l.id || lids.has(l.id)) l.id = newId('l');
    lids.add(l.id);
    if (!ids.has(l.from) || !ids.has(l.to) || typeof l.out !== 'string' || typeof l.in !== 'string') {
      diags.push({ id: `dangling-link@${l.id}`, link: l.id, severity: 'warn', code: 'dangling-link',
        message: `dropped a wire whose ${!ids.has(l.from) ? 'source' : !ids.has(l.to) ? 'target' : 'port'} is missing` });
      continue;
    }
    const k = `${l.to}\u0000${l.in}`;
    if (byIn.has(k)) diags.push({ id: `dangling-link@${byIn.get(k).id}`, link: byIn.get(k).id, severity: 'warn', code: 'dangling-link', message: `dropped a second wire into input "${l.in}"` });
    byIn.set(k, l);
  }
  g.links = [...byIn.values()];

  // frames
  if (obj.frames !== undefined) {
    const fids = new Set();
    g.frames = (Array.isArray(obj.frames) ? obj.frames : []).filter(isObj).map((rf) => {
      const f = { ...rf };
      if (typeof f.id !== 'string' || !f.id || fids.has(f.id)) f.id = newId('f');
      fids.add(f.id);
      f.title = typeof f.title === 'string' ? f.title : '';
      f.x = fin(f.x); f.y = fin(f.y); f.w = Math.max(0, fin(f.w, 200)); f.h = Math.max(0, fin(f.h, 120));
      f.color = typeof f.color === 'string' ? f.color : null;
      return f;
    });
  }
  if (obj.lastBake !== undefined && !isObj(obj.lastBake)) delete g.lastBake;
  return { graph: g, diags };
}

// plain JSON: drops undefined fields only
function plain(x) {
  if (Array.isArray(x)) return x.map((v) => (v === undefined ? null : plain(v)));
  if (isObj(x)) {
    const o = {};
    for (const [k, v] of Object.entries(x)) if (v !== undefined) o[k] = plain(v);
    return o;
  }
  return x;
}

export const serializeGraph = (graph) => plain(graph);

/** The .pawproj block value { v: 1, items } -> graphs. null/undefined -> []. Graph ids are made unique. */
export function parseGraphs(block, reg) {
  if (block == null) return { graphs: [], diags: [] };
  const items = Array.isArray(block) ? block : Array.isArray(block.items) ? block.items : [];
  const graphs = [], diags = [];
  const ids = new Set();
  for (const item of items) {
    let r;
    try { r = parseGraph(item, reg); } catch (err) {
      diags.push({ id: `note@graphs:${diags.length}`, severity: 'warn', code: 'note', message: `skipped an entry: ${err.message}` });
      continue;
    }
    if (ids.has(r.graph.id)) r.graph.id = newId('g');
    ids.add(r.graph.id);
    graphs.push(r.graph);
    diags.push(...r.diags.map((d) => ({ ...d, graph: r.graph.id })));
  }
  return { graphs, diags };
}

export const serializeGraphs = (graphs) => ({ v: 1, items: (graphs || []).map(serializeGraph) });

export function stringifyGraphFile(graphOrPreset) {
  return JSON.stringify({ format: 'pawgraph', version: 1, graph: serializeGraph(graphOrPreset) }, null, 2);
}

export function parseGraphFile(text, reg) {
  let obj;
  try { obj = JSON.parse(text); } catch (err) { throw new Error(`not a .pawgraph file: ${err.message}`); }
  if (!isObj(obj) || obj.format !== 'pawgraph') throw new Error('not a .pawgraph file: the "format" field is missing');
  if (!isObj(obj.graph)) throw new Error('not a .pawgraph file: it holds no graph');
  return parseGraph(obj.graph, reg);
}
