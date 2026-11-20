// Graph model of the node graph: ids, node definitions, the registry and every graph edit as a pure function
// (contract §1, §3, §4 in src/lib/graph/README.md). Graphs are plain immutable JSON values: every function returns a
// new graph (or the same graph when nothing changed) and never mutates its input.
//
// PROVENANCE: adapted from OpenValence/Phosphor (same owner, Apache-2.0), src/model/graph.js:
//   newId (l.210), GRID/snap (l.351), createHistory (l.359-370, plus clear()), wouldLoop (l.238, rels removed),
//   the planLink/addLink refusal-string shape (l.561-592); applyPreset's id remap follows src/plugins/graph.js l.696.

import { coerce, normalizeValues } from '../../ui/kit/params.js';
import { compat, compatParam, snapRate, TYPES, VALUE_TYPES } from './types.js';

export const GRID = 20;
export const snap = (v, grid = GRID) => Math.round(v / grid) * grid;

let seq = 0;
export const newId = (prefix) => prefix + Date.now().toString(36) + (seq++).toString(36);

// ---------------------------------------------------------------- node definitions

const PORT_TYPES = new Set(['script', 'signal', 'spans', 'number', 'any']);
const NUMERIC = new Set(['number', 'float', 'int']);
const DEFINED = new WeakSet();
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
};
const INFINITE_HALO = () => Infinity;

/** Validates a node definition once and freezes it. Throws Error('defineNode <type>: <problem>'). */
export function defineNode(def) {
  if (DEFINED.has(def)) return def;
  const type = def && def.type;
  const bad = (msg) => { throw new Error(`defineNode ${type}: ${msg}`); };
  if (!def || typeof def !== 'object') throw new Error('defineNode undefined: not an object');
  if (typeof type !== 'string' || !/^[A-Za-z_][\w-]*(\.[\w-]+)+$/.test(type)) bad('type must look like "group.name"');
  if (typeof def.title !== 'string' || !def.title) bad('title is required');
  if (typeof def.group !== 'string' || !def.group) bad('group is required');
  if (typeof def.eval !== 'function') bad('eval must be a function');
  const version = def.version ?? 1;
  if (!Number.isInteger(version) || version < 1) bad('version must be an integer >= 1');
  for (const side of ['ins', 'outs']) {
    if (!Array.isArray(def[side])) bad(`${side} must be an array`);
    const names = new Set();
    for (const p of def[side]) {
      if (!p || typeof p.name !== 'string' || !p.name) bad(`a port in ${side} has no name`);
      if (names.has(p.name)) bad(`duplicate port "${p.name}" in ${side}`);
      names.add(p.name);
      if (!PORT_TYPES.has(p.type)) bad(`port "${p.name}" has unknown type "${p.type}"`);
      // 'where' may be declared explicitly (the contract's out.axis / an.stat do) but only as spans; 'p:' is reserved
      if (side === 'ins' && (p.name.startsWith('p:') || (p.name === 'where' && p.type !== 'spans'))) bad(`input name "${p.name}" is reserved`);
      if (p.accepts && (!Array.isArray(p.accepts) || p.accepts.some((t) => !VALUE_TYPES.includes(t)))) bad(`port "${p.name}" has invalid accepts`);
    }
  }
  if (!Array.isArray(def.params)) bad('params must be an array');
  const keys = new Set();
  for (const p of def.params) {
    if (!p || typeof p.key !== 'string' || !p.key) bad('a param has no key');
    if (keys.has(p.key)) bad(`duplicate param "${p.key}"`);
    keys.add(p.key);
    if (p.mod && p.mod !== 'number' && p.mod !== 'signal') bad(`param "${p.key}" has invalid mod "${p.mod}"`);
    if (p.mod && !NUMERIC.has(p.type)) bad(`param "${p.key}" has mod but is not numeric`);
  }
  for (const f of ['halo', 'reads', 'migrate', 'summary']) if (def[f] != null && typeof def[f] !== 'function') bad(`${f} must be a function`);
  if (def.bypass) {
    const ins = new Set([...def.ins.map((p) => p.name), ...(def.perSpan ? ['where'] : [])]);
    for (const [o, i] of Object.entries(def.bypass)) {
      if (!def.outs.some((p) => p.name === o)) bad(`bypass names unknown output "${o}"`);
      if (!ins.has(i)) bad(`bypass names unknown input "${i}"`);
    }
  }
  if (def.variants != null) {
    if (!Array.isArray(def.variants)) bad('variants must be an array');
    for (const v of def.variants) if (!v || typeof v.id !== 'string' || typeof v.title !== 'string') bad('a variant needs id and title');
  }
  const out = { ...def, version, halo: def.halo || INFINITE_HALO };
  for (const k of ['ins', 'outs', 'params', 'variants', 'aliases']) if (out[k]) out[k] = deepFreeze(out[k].map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? { ...x } : x)));
  if (out.bypass) out.bypass = Object.freeze({ ...out.bypass });
  Object.freeze(out);
  DEFINED.add(out);
  return out;
}

// the engine-added input of perSpan nodes
export const WHERE_PORT = Object.freeze({ name: 'where', type: 'spans', label: 'Only inside', required: false });

const portsCache = new WeakMap();
function portsOfDef(def) {
  let p = portsCache.get(def);
  if (!p) {
    p = Object.freeze({
      ins: Object.freeze(def.perSpan && !def.ins.some((q) => q.name === 'where') ? [...def.ins, WHERE_PORT] : [...def.ins]),
      outs: def.outs,
      params: Object.freeze(def.params.filter((q) => q.mod).map((q) => Object.freeze({
        name: 'p:' + q.key, type: q.mod === 'signal' ? 'signal' : 'number', label: q.label || q.key, param: q.key, mod: q.mod,
      }))),
    });
    portsCache.set(def, p);
  }
  return p;
}

export function createRegistry(defs = []) {
  const map = new Map();
  const reg = {
    add(d) {
      for (const x of Array.isArray(d) ? d : [d]) {
        const def = defineNode(x);
        if (map.has(def.type)) throw new Error(`registry: duplicate node type "${def.type}"`);
        map.set(def.type, def);
      }
      return reg;
    },
    get: (type) => map.get(type) || null,
    has: (type) => map.has(type),
    list: () => [...map.values()],
    groups() {
      const root = { name: '', items: [], groups: [] };
      for (const def of map.values()) {
        let g = root;
        for (const name of def.group.split(' · ').map((s) => s.trim()).filter(Boolean)) {
          let c = g.groups.find((x) => x.name === name);
          if (!c) g.groups.push((c = { name, items: [], groups: [] }));
          g = c;
        }
        g.items.push(def);
      }
      return root.items.length ? [{ name: '', items: root.items, groups: [] }, ...root.groups] : root.groups;
    },
    portsOf(node, graph) {
      const def = map.get(node.type);
      if (def) return portsOfDef(def);
      // unknown type: infer the ports from the links touching it, typed 'any'
      const ins = [], outs = [], params = [];
      for (const l of graph?.links || []) {
        if (l.to === node.id) {
          const list = String(l.in).startsWith('p:') ? params : ins;
          if (!list.some((p) => p.name === l.in)) list.push({ name: l.in, type: 'any' });
        }
        if (l.from === node.id && !outs.some((p) => p.name === l.out)) outs.push({ name: l.out, type: 'any' });
      }
      return { ins, outs, params };
    },
  };
  return reg.add(defs);
}

// ---------------------------------------------------------------- graph basics

export function emptyGraph({ name = 'Graph', rate = 50 } = {}) {
  return { v: 1, id: newId('g'), name, rate: snapRate(rate), nodes: [], links: [] };
}

const nodeById = (g, id) => g.nodes.find((n) => n.id === id) || null;
const replaceNode = (g, id, fn) => {
  let hit = false;
  const nodes = g.nodes.map((n) => {
    if (n.id !== id) return n;
    const m = fn(n);
    if (m !== n) hit = true;
    return m;
  });
  return hit ? { ...g, nodes } : g;
};
const sameVal = (a, b) => a === b || (typeof a === 'object' && typeof b === 'object' && a && b && JSON.stringify(a) === JSON.stringify(b));
// a fresh seed inside the param's own [min, max] (else every seed above max would clamp to the same value)
const freshSeed = (p) => {
  const lo = Number.isFinite(p.min) ? Math.ceil(p.min) : 0;
  const hi = Number.isFinite(p.max) ? Math.floor(p.max) : 0x7ffffffe;
  return hi > lo ? lo + Math.floor(Math.random() * (hi - lo + 1)) : lo;
};

/**
 * Runs def.migrate on a node saved at type version `tv` (an addition to the contract, shared by parseGraph and
 * applyPreset). byKind overrides are migrated too: each one as the diff between migrate(params + override) and
 * migrate(params), keeping its keys that still exist, so a partial override survives a rename.
 * -> { params, byKind, ok, error? }; on a throw nothing changes and ok is false (the caller keeps the old tv).
 */
export function migrateNode(def, params, byKind, tv) {
  if (!def?.migrate || !(tv < (def.version ?? 1))) return { params, byKind, ok: true };
  try {
    const base = { ...def.migrate({ ...params }, tv) };
    let bk = byKind;
    if (byKind && typeof byKind === 'object') {
      bk = {};
      for (const [kind, o] of Object.entries(byKind)) {
        if (!o || typeof o !== 'object') continue;
        const full = def.migrate({ ...params, ...o }, tv) || {};
        const d = {};
        for (const k of Object.keys(full)) if (k in o || !sameVal(full[k], base[k])) d[k] = full[k];
        bk[kind] = d;
      }
    }
    return { params: base, byKind: bk, ok: true };
  } catch (err) {
    return { params, byKind, ok: false, error: err?.message ?? String(err) };
  }
}

/** Known params coerced by the schema, unknown keys kept. */
function coerceKnown(def, patch) {
  const out = { ...patch };
  if (def) for (const p of def.params) if (p.key in out) out[p.key] = coerce(p, out[p.key]);
  return out;
}

function coerceByKind(def, byKind) {
  if (!byKind || typeof byKind !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(byKind)) if (v && typeof v === 'object') out[k] = coerceKnown(def, v);
  return out;
}

/** Full params for a new node: defaults, seeds randomised, then `params` applied, all coerced. */
function fullParams(def, params = {}) {
  const base = {};
  for (const p of def.params) if (p.seed && !(p.key in params)) base[p.key] = freshSeed(p);
  return normalizeValues(def.params, { ...base, ...params });
}

export function addNode(g, reg, type, { x = 0, y = 0, params = {}, byKind, label } = {}) {
  const def = reg.get(type);
  if (!def) throw new Error(`addNode: unknown node type "${type}"`);
  const node = { id: newId('n'), type, tv: def.version, x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0, params: fullParams(def, params) };
  const bk = coerceByKind(def, byKind);
  if (bk && Object.keys(bk).length) node.byKind = bk;
  if (label != null) node.label = label;
  return { graph: { ...g, nodes: [...g.nodes, node] }, id: node.id };
}

export function removeNodes(g, ids) {
  const gone = new Set(ids);
  if (!g.nodes.some((n) => gone.has(n.id))) return g;
  const out = { ...g, nodes: g.nodes.filter((n) => !gone.has(n.id)), links: g.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)) };
  if (g.lastBake && Object.keys(g.lastBake).some((k) => gone.has(k))) {
    out.lastBake = Object.fromEntries(Object.entries(g.lastBake).filter(([k]) => !gone.has(k)));
  }
  return out;
}

export function moveNodes(g, ids, dx, dy) {
  if (!dx && !dy) return g;
  const set = new Set(ids);
  if (!g.nodes.some((n) => set.has(n.id))) return g;
  return { ...g, nodes: g.nodes.map((n) => (set.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) };
}

export function setParams(g, reg, id, patch) {
  return replaceNode(g, id, (n) => {
    const next = coerceKnown(reg.get(n.type), patch);
    if (Object.keys(next).every((k) => sameVal(n.params[k], next[k]))) return n;
    return { ...n, params: { ...n.params, ...next } };
  });
}

/** Per-kind overrides of a perSpan node. patch null removes that kind; {} keeps an empty entry; an undefined value removes that key. */
export function setByKind(g, reg, id, kind, patch) {
  return replaceNode(g, id, (n) => {
    const byKind = { ...(n.byKind || {}) };
    if (patch === null) {
      if (!(kind in byKind)) return n;
      delete byKind[kind];
    } else {
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const entry = { ...(byKind[kind] || {}), ...coerceKnown(reg.get(n.type), defined) };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete entry[k];
      if (kind in byKind && JSON.stringify(entry) === JSON.stringify(byKind[kind])) return n;
      byKind[kind] = entry;
    }
    const m = { ...n, byKind };
    if (!Object.keys(byKind).length) delete m.byKind;
    return m;
  });
}

const PROPS = ['label', 'muted', 'collapsed', 'preview', 'color'];
export function setNodeProps(g, id, props) {
  return replaceNode(g, id, (n) => {
    const m = { ...n };
    let changed = false;
    for (const k of PROPS) {
      if (!(k in props) || m[k] === props[k]) continue;
      changed = true;
      if (props[k] === undefined) delete m[k]; else m[k] = props[k];
    }
    return changed ? m : n;
  });
}

// ---------------------------------------------------------------- reachability

function adjacency(g, dir) {
  const m = new Map();
  for (const l of g.links) {
    const [a, b] = dir === 'down' ? [l.from, l.to] : [l.to, l.from];
    if (!m.has(a)) m.set(a, []);
    m.get(a).push(b);
  }
  return m;
}
function reach(g, ids, dir) {
  const adj = adjacency(g, dir);
  const start = new Set(ids);
  const seen = new Set();
  const stack = [...start];
  while (stack.length) {
    for (const b of adj.get(stack.pop()) || []) if (!seen.has(b)) { seen.add(b); stack.push(b); }
  }
  for (const id of start) seen.delete(id);
  return seen;
}
export const upstreamOf = (g, ids) => reach(g, ids, 'up');
export const downstreamOf = (g, ids) => reach(g, ids, 'down');

/** Would a new link from -> to close a loop (does `to` already reach `from`)? */
export function wouldLoop(g, from, to) {
  if (from === to) return true;
  const adj = adjacency(g, 'down');
  const seen = new Set([to]);
  const stack = [to];
  while (stack.length) {
    for (const b of adj.get(stack.pop()) || []) {
      if (b === from) return true;
      if (!seen.has(b)) { seen.add(b); stack.push(b); }
    }
  }
  return false;
}

// ---------------------------------------------------------------- port types (static resolution of 'any')

/**
 * The type a node's port carries in `g`: its declared type, or for an 'any' port the type fixed by the first
 * connected 'any' input in port order (recursively). Unresolvable -> 'any'. `skipIn` ignores one input (the one
 * being rewired).
 */
export function portType(g, reg, nodeId, port, dir = 'out', skipIn = null, seen = new Set()) {
  const node = nodeById(g, nodeId);
  if (!node) return 'any';
  const ports = reg.portsOf(node, g);
  const list = dir === 'out' ? ports.outs : port.startsWith('p:') ? ports.params : ports.ins;
  const decl = list.find((p) => p.name === port);
  if (!decl) return 'any';
  if (decl.type !== 'any') return decl.type;
  if (seen.has(nodeId)) return 'any';
  seen.add(nodeId);
  for (const p of ports.ins) {
    if (p.type !== 'any' || p.name === skipIn) continue;
    const l = g.links.find((x) => x.to === nodeId && x.in === p.name);
    if (!l) continue;
    const t = portType(g, reg, l.from, l.out, 'out', null, seen);
    if (t !== 'any') return t;
  }
  return 'any';
}

const titleOf = (reg, type) => reg.get(type)?.title || type;

/**
 * What wiring from.out -> to.in would do, or why it cannot.
 * -> { ok: true, replace?: linkId, adapter? } | { ok: false, reason, suggest? }
 */
export function planLink(g, reg, { from, out, to, in: inp }) {
  if (from === to) return { ok: false, reason: 'refused: a node cannot feed itself' };
  const a = nodeById(g, from), b = nodeById(g, to);
  if (!a) return { ok: false, reason: 'refused: that output is gone' };
  if (!b) return { ok: false, reason: 'refused: that input is gone' };
  const pa = reg.portsOf(a, g), pb = reg.portsOf(b, g);
  const op = pa.outs.find((p) => p.name === out);
  if (!op) return { ok: false, reason: `refused: no such output "${out}"` };
  const isParam = typeof inp === 'string' && inp.startsWith('p:');
  const ip = (isParam ? pb.params : pb.ins).find((p) => p.name === inp);
  if (!ip) return { ok: false, reason: `refused: no such input "${inp}"` };
  if (wouldLoop(g, from, to)) return { ok: false, reason: 'refused: would loop' };
  const ft = portType(g, reg, from, out, 'out');
  let c;
  if (isParam) {
    c = ip.mod ? compatParam(ft, ip.mod) : compat(ft, ip.type);
  } else {
    let tt = ip.type;
    if (tt === 'any') {
      if (ip.accepts && ft !== 'any' && !ip.accepts.includes(ft)) {
        return { ok: false, reason: `refused: input "${inp}" takes ${ip.accepts.map((t) => TYPES[t].label.toLowerCase()).join(' or ')}, not ${ft}` };
      }
      // T is fixed by the first connected 'any' input in port order; only an earlier one constrains this input
      for (const p of pb.ins.slice(0, pb.ins.indexOf(ip))) {
        if (p.type !== 'any') continue;
        const l = g.links.find((x) => x.to === to && x.in === p.name);
        const t = l ? portType(g, reg, l.from, l.out, 'out') : 'any';
        if (t !== 'any') { tt = t; break; }
      }
    }
    c = compat(ft, tt);
  }
  if (!c.ok) {
    const s = c.suggest || [];
    const hint = s.length ? ` — insert "${titleOf(reg, s[0])}"` : '';
    return { ok: false, reason: `refused: ${c.reason}${hint}`, suggest: s };
  }
  const res = { ok: true };
  const old = g.links.find((l) => l.to === to && l.in === inp);
  if (old) res.replace = old.id;
  if (c.adapter) res.adapter = c.adapter;
  return res;
}

export function connect(g, reg, link) {
  const plan = planLink(g, reg, link);
  if (!plan.ok) return { graph: g, id: null, reason: plan.reason };
  const old = plan.replace && g.links.find((l) => l.id === plan.replace);
  if (old && old.from === link.from && old.out === link.out) return { graph: g, id: old.id, reason: '' };
  const l = { id: newId('l'), from: link.from, out: link.out, to: link.to, in: link.in };
  return { graph: { ...g, links: [...g.links.filter((x) => x.id !== plan.replace), l] }, id: l.id, reason: '' };
}

export function disconnect(g, linkIds) {
  const gone = new Set(linkIds);
  return g.links.some((l) => gone.has(l.id)) ? { ...g, links: g.links.filter((l) => !gone.has(l.id)) } : g;
}

/** Splices node `nodeId` into link `linkId`: link.from -> node's first compatible input, node's first compatible output -> link.to. */
export function insertOnLink(g, reg, linkId, nodeId) {
  const link = g.links.find((l) => l.id === linkId);
  if (!link) return { graph: g, reason: 'refused: that wire is gone' };
  const node = nodeById(g, nodeId);
  if (!node) return { graph: g, reason: 'refused: that node is gone' };
  if (link.from === nodeId || link.to === nodeId) return { graph: g, reason: 'refused: the node is already on that wire' };
  const ports = reg.portsOf(node, g);
  const g1 = disconnect(g, [linkId]);
  let firstReason = '';
  for (const ip of ports.ins) {
    const r1 = connect(g1, reg, { from: link.from, out: link.out, to: nodeId, in: ip.name });
    if (!r1.id) { firstReason ||= r1.reason; continue; }
    for (const op of ports.outs) {
      const r2 = connect(r1.graph, reg, { from: nodeId, out: op.name, to: link.to, in: link.in });
      if (r2.id) return { graph: r2.graph, reason: '' };
      firstReason ||= r2.reason;
    }
  }
  return { graph: g, reason: firstReason || 'refused: the node has no ports that fit this wire' };
}

/** Removes nodes, reconnecting each bypass pair (the bypassed input's source -> every target of the output). */
export function dissolveNodes(g, reg, ids) {
  let cur = g;
  for (const id of ids) {
    const node = nodeById(cur, id);
    if (!node) continue;
    const def = reg.get(node.type);
    const ports = reg.portsOf(node, cur);
    const pairs = [];
    if (def) {
      for (const op of ports.outs) {
        const inName = def.bypass?.[op.name] ?? ports.ins.find((p) => p.type === op.type)?.name;
        const src = inName && cur.links.find((l) => l.to === id && l.in === inName);
        if (!src) continue;
        for (const t of cur.links.filter((l) => l.from === id && l.out === op.name)) pairs.push([src, t]);
      }
    }
    let next = removeNodes(cur, [id]);
    for (const [src, t] of pairs) next = connect(next, reg, { from: src.from, out: src.out, to: t.to, in: t.in }).graph;
    cur = next;
  }
  return cur;
}

/** Copies nodes (new ids, offset) and the links among them. -> { graph, map: { oldId: newId } } */
export function duplicate(g, ids, { dx = 40, dy = 40 } = {}) {
  const set = new Set(ids);
  const map = {};
  const copies = [];
  for (const n of g.nodes) {
    if (!set.has(n.id)) continue;
    map[n.id] = newId('n');
    copies.push({ ...n, id: map[n.id], x: n.x + dx, y: n.y + dy });
  }
  const links = g.links.filter((l) => map[l.from] && map[l.to]).map((l) => ({ ...l, id: newId('l'), from: map[l.from], to: map[l.to] }));
  if (!copies.length) return { graph: g, map };
  return { graph: { ...g, nodes: [...g.nodes, ...copies], links: [...g.links, ...links] }, map };
}

// ---------------------------------------------------------------- frames

export function addFrame(g, { title = '', x = 0, y = 0, w = 200, h = 120, color = null } = {}) {
  const f = { id: newId('f'), title, x, y, w, h, color };
  return { graph: { ...g, frames: [...(g.frames || []), f] }, id: f.id };
}
export function patchFrame(g, id, patch) {
  const frames = g.frames || [];
  if (!frames.some((f) => f.id === id)) return g;
  return { ...g, frames: frames.map((f) => (f.id === id ? { ...f, ...patch, id } : f)) };
}
export function removeFrames(g, ids) {
  const gone = new Set(ids);
  const frames = g.frames || [];
  return frames.some((f) => gone.has(f.id)) ? { ...g, frames: frames.filter((f) => !gone.has(f.id)) } : g;
}

// ---------------------------------------------------------------- presets (also the clipboard format)

const inFrame = (f, n) => n.x >= f.x && n.y >= f.y && n.x <= f.x + f.w && n.y <= f.y + f.h;

/**
 * A preset copy of nodes `ids`: the nodes (all their fields), the links among them, and the frames whose contained
 * nodes are all copied (a frame "fully inside" the selection).
 */
export function toPreset(g, ids, { name = '' } = {}) {
  const set = new Set(ids);
  const nodes = g.nodes.filter((n) => set.has(n.id)).map((n) => ({ ...n }));
  const links = g.links.filter((l) => set.has(l.from) && set.has(l.to)).map(({ from, out, to, in: i }) => ({ from, out, to, in: i }));
  const frames = (g.frames || []).filter((f) => {
    const inside = g.nodes.filter((n) => inFrame(f, n));
    return inside.length && inside.every((n) => set.has(n.id));
  }).map((f) => ({ ...f }));
  const p = { id: newId('p'), name, description: '', tags: [], rate: g.rate, nodes, links };
  if (frames.length) p.frames = frames;
  return p;
}

/** Places a preset: ids remapped, positions offset so its top-left lands at (x, y), params completed with defaults. */
export function applyPreset(g, reg, preset, { x = 0, y = 0 } = {}) {
  const pn = preset.nodes || [];
  const xs = [...pn.map((n) => n.x || 0), ...(preset.frames || []).map((f) => f.x || 0)];
  const ys = [...pn.map((n) => n.y || 0), ...(preset.frames || []).map((f) => f.y || 0)];
  const ox = xs.length ? x - Math.min(...xs) : x, oy = ys.length ? y - Math.min(...ys) : y;
  const map = {};
  const nodes = pn.map((n) => {
    const id = (map[n.id] = newId('n'));
    const def = reg.get(n.type);
    const node = { ...n, id, x: (n.x || 0) + ox, y: (n.y || 0) + oy };
    if (def) {
      const m = migrateNode(def, n.params || {}, n.byKind, Number.isInteger(n.tv) ? n.tv : def.version);
      node.params = m.ok ? fullParams(def, m.params) : { ...(n.params || {}) }; // failed: raw, retried on load
      node.tv = m.ok ? def.version : n.tv;
      const bk = coerceByKind(def, m.byKind);
      if (bk && Object.keys(bk).length) node.byKind = bk; else delete node.byKind;
    } else {
      node.params = { ...(n.params || {}) };
      if (!Number.isInteger(node.tv)) node.tv = 1;
    }
    return node;
  });
  const byIn = new Map();
  for (const l of preset.links || []) {
    if (!map[l.from] || !map[l.to]) continue;
    byIn.set(`${l.to}\u0000${l.in}`, { id: newId('l'), from: map[l.from], out: l.out, to: map[l.to], in: l.in }); // later wins
  }
  const frames = (preset.frames || []).map((f) => ({ ...f, id: newId('f'), x: (f.x || 0) + ox, y: (f.y || 0) + oy }));
  const graph = { ...g, nodes: [...g.nodes, ...nodes], links: [...g.links, ...byIn.values()] };
  if (frames.length) graph.frames = [...(g.frames || []), ...frames];
  return { graph, ids: nodes.map((n) => n.id), map };
}

// ---------------------------------------------------------------- history (local-undo mode)

/** One undo stack of opaque entries. undo/redo pop an entry and keep swap(entry) — the current state — for the way back. */
export function createHistory(limit = 100) {
  const back = [];
  const fwd = [];
  const trade = (from, to, swap) => { if (!from.length) return null; const e = from.pop(); to.push(swap(e)); return e; };
  return {
    push(e) { back.push(e); if (back.length > limit) back.shift(); fwd.length = 0; },
    undo: (swap) => trade(back, fwd, swap),
    redo: (swap) => trade(fwd, back, swap),
    get canUndo() { return back.length > 0; },
    get canRedo() { return fwd.length > 0; },
    clear() { back.length = 0; fwd.length = 0; },
  };
}
