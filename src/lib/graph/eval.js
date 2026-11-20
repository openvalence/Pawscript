// Evaluation of the node graph (contract §5, src/lib/graph/README.md): compile (topological order, resolved types,
// adapters, static diagnostics), Merkle cache keys, a byte-budget LRU cache with pinned latest values, and a
// pull-based, memoised, optionally windowed evaluation with fault isolation, mute, cooperative yielding and abort.
// Pure: no DOM, no app. Values are never mutated.
//
// PROVENANCE: the topological sort generalises Phosphor's `topo` (OpenValence/Phosphor src/model/graph.js l.595,
// Apache-2.0, same owner) to every node, with deterministic ties by node id. Phosphor's step snapshot/restore
// pattern (src/plugins/graph.js l.462-542) became the immutable Program + Result values here.

import { coerce, normalizeValues } from '../../ui/kit/params.js';
import { normalize } from '../core/script.js';
import { mulberry32, hashSeed } from '../gen/util.js';
import {
  compat, compatParam, checkValue, normSpans, bytesOf, adapt, gridFor, signalAt, flattenSpans, snapRate,
  typeOfValue, summarize, clipScript, sliceSignal,
} from './types.js';

/** The Error instance a node throws (or the engine records) to abort cooperatively. */
export const ABORT = new Error('graph evaluation aborted');
ABORT.name = 'AbortError';

const now = () => (globalThis.performance ? performance.now() : Date.now());
const OUTPUT_TYPES = new Set(['out.axis', 'out.ghost']);

// ---------------------------------------------------------------- hashing

function canon(part) {
  if (typeof part === 'string') return 's' + part;
  if (typeof part === 'number') return 'n' + String(part);
  if (part === undefined) return 'u';
  return 'j' + stableJSON(part);
}

/** FNV-1a (64-bit, 16-bit limbs) over the parts' canonical strings, folded to 53 bits, base 36. */
export function hashKey(...parts) {
  let h0 = 0x2325, h1 = 0x8422, h2 = 0x9ce4, h3 = 0xcbf2;
  const mix = (c) => {
    h0 ^= c;
    let t0 = h0 * 435, t1 = h1 * 435, t2 = h2 * 435, t3 = h3 * 435;
    t2 += h0 << 8; t3 += h1 << 8;
    t1 += t0 >>> 16; h0 = t0 & 0xffff;
    t2 += t1 >>> 16; h1 = t1 & 0xffff;
    h3 = (t3 + (t2 >>> 16)) & 0xffff; h2 = t2 & 0xffff;
  };
  for (const part of parts) {
    const s = canon(part);
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); mix(c & 0xff); mix(c >>> 8); } // both bytes always: '中' != '-N'
    mix(0x1f); // part separator: ('ab','c') != ('a','bc')
  }
  return (h3 * 2 ** 37 + h2 * 2 ** 21 + h1 * 32 + (h0 >>> 11)).toString(36);
}

/** JSON with sorted object keys (a canonical form for keys). Typed arrays are refused: they never belong in params. */
export function stableJSON(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number') return String(value); // NaN / Infinity stay distinct from null
  if (t === 'string') return JSON.stringify(value);
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'undefined') return 'undefined';
  if (t !== 'object') return JSON.stringify(String(value));
  if (ArrayBuffer.isView(value)) throw new Error('stableJSON: typed arrays are not allowed in params');
  if (Array.isArray(value)) return '[' + value.map((v) => (v === undefined ? 'null' : stableJSON(v))).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableJSON(value[k])).join(',') + '}';
}

const tokens = new WeakMap();
let tokenSeq = 0;
/** Identity token: objects by identity (WeakMap counter), primitives by JSON, undefined by '∅'. */
export function tokenOf(value) {
  if (value === undefined) return '∅';
  const t = typeof value;
  if ((t === 'object' && value !== null) || t === 'function') {
    let k = tokens.get(value);
    if (!k) tokens.set(value, (k = 'o' + (++tokenSeq).toString(36)));
    return k;
  }
  if (t === 'number') return Number.isFinite(value) ? String(value) : 'n' + String(value);
  if (t === 'bigint' || t === 'symbol') return t + String(value);
  return JSON.stringify(value);
}

// ---------------------------------------------------------------- cache

/**
 * LRU over keys against a byte budget, plus pinned keys outside the budget. pinOnly(keys, slot) replaces the pin set
 * of `slot` (default 'default'); the pinned set is the union of every slot, so the latest full and the latest
 * windowed run can both stay pinned (slot is an addition to the contract).
 */
export function createCache({ budgetMB = 64 } = {}) {
  const budget = budgetMB * 1024 * 1024;
  const map = new Map();
  const slots = new Map();
  let pinned = new Set();
  let fresh = new Set(); // set since the last pinOnly: never evicted before the running evaluation can pin them
  let bytes = 0, pinnedBytes = 0, hits = 0, misses = 0;
  const evict = () => {
    let unpinned = bytes - pinnedBytes;
    if (unpinned <= budget) return;
    for (const [k, e] of map) {
      if (unpinned <= budget) break;
      if (pinned.has(k) || fresh.has(k)) continue;
      map.delete(k);
      bytes -= e.bytes;
      unpinned -= e.bytes;
    }
  };
  return {
    get(key) {
      const e = map.get(key);
      if (!e) { misses++; return undefined; }
      hits++;
      map.delete(key);
      map.set(key, e);
      return e;
    },
    set(key, outs, b = 0) {
      const old = map.get(key);
      if (old) { bytes -= old.bytes; if (pinned.has(key)) pinnedBytes -= old.bytes; map.delete(key); }
      const e = { outs, bytes: Math.max(0, b || 0) };
      map.set(key, e);
      bytes += e.bytes;
      if (pinned.has(key)) pinnedBytes += e.bytes;
      fresh.add(key);
      evict();
    },
    pinOnly(keys, slot = 'default') {
      slots.set(slot, new Set(keys));
      pinned = new Set();
      for (const s of slots.values()) for (const k of s) pinned.add(k);
      pinnedBytes = 0;
      for (const k of pinned) pinnedBytes += map.get(k)?.bytes || 0;
      fresh = new Set();
      evict();
    },
    has: (key) => map.has(key),
    clear() { map.clear(); slots.clear(); pinned = new Set(); fresh = new Set(); bytes = pinnedBytes = hits = misses = 0; },
    stats: () => ({ entries: map.size, bytes, pinnedBytes, hits, misses }),
  };
}

// ---------------------------------------------------------------- compile

const diagId = (code, at, port) => `${code}@${at}${port ? ':' + port : ''}`;
const titleOf = (e) => (e ? e.node.label || e.def?.title || e.node.type : '?');

function structureKeyOf(graph) {
  const parts = [];
  for (const n of [...(graph.nodes || [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) parts.push(`${n.id}|${n.type}|${n.tv ?? ''}`);
  parts.push('#');
  for (const l of graph.links || []) parts.push(`${l.id}|${l.from}|${l.out}|${l.to}|${l.in}`);
  return hashKey(...parts);
}

function ancestorsIn(nodes, ids, bad) {
  const seen = new Set();
  const stack = [...ids];
  while (stack.length) {
    const e = nodes.get(stack.pop());
    if (!e) continue;
    for (const l of e.inLinks.values()) if (!bad.has(l.id) && !seen.has(l.from)) { seen.add(l.from); stack.push(l.from); }
  }
  return seen;
}

// diagnostics that depend on params and mute flags (recomputed by withGraph)
function paramDiags(nodes, order, bad) {
  const out = [];
  const axes = new Map();
  for (const id of order) {
    const e = nodes.get(id);
    if (!e.def) continue;
    const params = e.node.params || {};
    for (const p of e.def.params) {
      if (!(p.key in params)) continue;
      const c = coerce(p, params[p.key]);
      if (stableJSON(c) !== stableJSON(params[p.key])) {
        out.push({ id: diagId('param', id, 'p:' + p.key), node: id, port: 'p:' + p.key, severity: 'warn', code: 'param',
          message: `${p.label || p.key}: stored value ${stableJSON(params[p.key])} is out of range, using ${stableJSON(c)}`,
          fix: { label: 'Store the corrected value', kind: 'setParam', args: { node: id, key: p.key, value: c } } });
      }
    }
    if (e.node.type === 'out.axis' && !e.node.muted) {
      const axis = params.axis ?? 'stroke';
      if (!axes.has(axis)) axes.set(axis, []);
      axes.get(axis).push(id);
    }
  }
  for (const [axis, ids] of axes) {
    if (ids.length > 1) {
      for (const id of ids) out.push({ id: diagId('output-collision', id), node: id, severity: 'error', code: 'output-collision',
        message: `${ids.length} outputs write the axis "${axis}": mute all but one`, fix: { label: 'Select the other output', kind: 'select', args: { node: ids.find((x) => x !== id) } } });
    }
    for (const id of ids) {
      const srcs = [...ancestorsIn(nodes, [id], bad)].filter((s) => {
        const e = nodes.get(s);
        return e.node.type === 'src.axis' && (e.node.params?.axis ?? 'stroke') === axis;
      }).sort();
      if (srcs.length) out.push({ id: diagId('self-reference', id), node: id, severity: 'warn', code: 'self-reference',
        message: `reads the axis "${axis}" it writes: the preview changes after every bake`,
        fix: { label: 'Freeze source to ghost', kind: 'freezeSource', args: { node: srcs[0] } } });
    }
  }
  return out;
}

/** Validates and schedules a graph. Runs only when structure changes; see withGraph for param edits. */
export function compile(graph, reg) {
  const diags = [];
  const nodes = new Map();
  for (const node of graph.nodes || []) {
    if (nodes.has(node.id)) {
      diags.push({ id: diagId('note', node.id, 'dup'), node: node.id, severity: 'warn', code: 'note', message: `duplicate node id "${node.id}" ignored` });
      continue;
    }
    const def = reg.get(node.type);
    nodes.set(node.id, { node, def, ports: reg.portsOf(node, graph), inLinks: new Map() });
  }

  // links: drop the dangling, keep one per input (the later wins, as connect does)
  for (const l of graph.links || []) {
    const a = nodes.get(l.from), b = nodes.get(l.to);
    let why = '';
    if (!a || !b) why = `points at a missing node "${!a ? l.from : l.to}"`;
    else if (!a.ports.outs.some((p) => p.name === l.out)) why = `"${titleOf(a)}" has no output "${l.out}"`;
    else if (!(String(l.in).startsWith('p:') ? b.ports.params : b.ports.ins).some((p) => p.name === l.in)) why = `"${titleOf(b)}" has no input "${l.in}"`;
    if (why) { diags.push({ id: diagId('dangling-link', l.id), link: l.id, severity: 'warn', code: 'dangling-link', message: `wire ignored: ${why}` }); continue; }
    const prev = b.inLinks.get(l.in);
    if (prev) diags.push({ id: diagId('dangling-link', prev.id), link: prev.id, severity: 'warn', code: 'dangling-link', message: `wire ignored: input "${l.in}" is fed by a later wire` });
    b.inLinks.set(l.in, l);
  }

  // topological order (Kahn, ties by id); nodes on a cycle are found and their edges cut
  const ids = [...nodes.keys()].sort();
  const succ = new Map(ids.map((id) => [id, []]));
  for (const e of nodes.values()) for (const l of e.inLinks.values()) succ.get(l.from).push(l.to);
  const kahn = (members, skip) => {
    const deg = new Map([...members].map((id) => [id, 0]));
    for (const id of members) for (const t of succ.get(id)) if (deg.has(t) && !skip(id, t)) deg.set(t, deg.get(t) + 1);
    const ready = [...members].filter((id) => deg.get(id) === 0).sort();
    const out = [];
    while (ready.length) {
      const id = ready.shift();
      out.push(id);
      for (const t of succ.get(id)) {
        if (!deg.has(t) || skip(id, t)) continue;
        deg.set(t, deg.get(t) - 1);
        if (deg.get(t) === 0) {
          let lo = 0, hi = ready.length;
          while (lo < hi) { const m = (lo + hi) >> 1; if (ready[m] < t) lo = m + 1; else hi = m; }
          ready.splice(lo, 0, t);
        }
      }
    }
    return out;
  };
  const first = kahn(ids, () => false);
  const cycle = new Set();
  let order = first;
  if (first.length < ids.length) {
    const placed = new Set(first);
    const rest = ids.filter((id) => !placed.has(id));
    const restSet = new Set(rest);
    for (const r of rest) { // on a cycle iff r reaches itself inside the remainder
      const seen = new Set();
      const stack = [r];
      while (stack.length) {
        for (const t of succ.get(stack.pop())) {
          if (t === r) { cycle.add(r); stack.length = 0; break; }
          if (restSet.has(t) && !seen.has(t)) { seen.add(t); stack.push(t); }
        }
      }
    }
    order = first.concat(kahn(rest, (a, b) => cycle.has(a) || cycle.has(b)));
    for (const id of [...cycle].sort()) {
      diags.push({ id: diagId('cycle', id), node: id, severity: 'error', code: 'cycle', message: `"${titleOf(nodes.get(id))}" is part of a loop: remove one of its wires` });
    }
  }

  // types: 'any' fixed per node by the first connected 'any' input with a concrete source type
  const types = new Map();
  const adapters = new Map();
  const bad = new Set();
  const staticError = new Map();
  const srcType = (l) => types.get(`${l.from}:${l.out}`) ?? nodes.get(l.from).ports.outs.find((p) => p.name === l.out)?.type ?? 'any';
  for (const id of order) {
    const e = nodes.get(id);
    let T = null;
    if (!cycle.has(id)) {
      for (const p of e.ports.ins) {
        if (p.type !== 'any') continue;
        const l = e.inLinks.get(p.name);
        if (!l) continue;
        const st = srcType(l);
        if (st !== 'any') { T = st; break; }
      }
    }
    for (const p of e.ports.ins) types.set(`${id}:${p.name}`, p.type === 'any' ? T ?? 'any' : p.type);
    for (const p of e.ports.params) types.set(`${id}:${p.name}`, p.type);
    for (const p of e.ports.outs) types.set(`${id}:${p.name}`, p.type === 'any' ? T ?? 'any' : p.type);
    for (const [port, l] of e.inLinks) {
      const st = srcType(l);
      let c;
      if (port.startsWith('p:')) {
        const pp = e.ports.params.find((p) => p.name === port);
        c = pp.mod ? compatParam(st, pp.mod) : compat(st, pp.type);
      } else {
        const decl = e.ports.ins.find((p) => p.name === port);
        c = compat(st, types.get(`${id}:${port}`));
        if (c.ok && decl.type === 'any' && decl.accepts && st !== 'any' && !decl.accepts.includes(st)) {
          c = { ok: false, reason: `input "${port}" takes ${decl.accepts.join(' or ')}, not ${st}`, suggest: [] };
        }
      }
      if (!c.ok) {
        bad.add(l.id);
        const s = (c.suggest || []).find((t) => reg.has(t));
        const d = { id: diagId('type', l.id), link: l.id, node: id, port, severity: 'error', code: 'type', message: `${c.reason}${s ? ` — insert "${reg.get(s).title}"` : ''}` };
        if (s) d.fix = { label: `Insert "${reg.get(s).title}"`, kind: 'insertBefore', args: { node: id, port, type: s } };
        diags.push(d);
        if (e.ports.ins.find((p) => p.name === port)?.required) staticError.set(id, 'type');
      } else if (c.adapter) adapters.set(l.id, c.adapter);
    }
  }

  // per-node static checks
  for (const id of order) {
    const e = nodes.get(id);
    if (cycle.has(id)) { staticError.set(id, 'cycle'); continue; }
    if (!e.def) {
      staticError.set(id, 'unknown-type');
      diags.push({ id: diagId('unknown-type', id), node: id, severity: 'error', code: 'unknown-type', message: `Missing: ${e.node.type} (not installed, its settings are kept)` });
      continue;
    }
    for (const p of e.ports.ins) {
      if (!p.required || e.inLinks.has(p.name)) continue;
      staticError.set(id, 'missing-input');
      diags.push({ id: diagId('missing-input', id, p.name), node: id, port: p.name, severity: 'error', code: 'missing-input', message: `required input "${p.label || p.name}" is not connected` });
    }
    if (e.def.timeShift) diags.push({ id: diagId('time-shift', id), node: id, severity: 'info', code: 'time-shift', message: 'shifts time, downstream spans are not shifted' });
  }

  const structural = diags;
  return {
    graph, reg, order, nodes, types, adapters,
    outputs: order.filter((id) => OUTPUT_TYPES.has(nodes.get(id).node.type)),
    diags: [...structural, ...paramDiags(nodes, order, bad)],
    structureKey: structureKeyOf(graph),
    // engine internals (not part of the contract; stable for the controller to read)
    badLinks: bad, staticError, structuralDiags: structural, cycle,
  };
}

export const validate = (graph, reg) => compile(graph, reg).diags;

/** The same Program with a new graph whose structure is unchanged (param, mute, label, position edits). */
export function withGraph(program, graph) {
  if (graph === program.graph) return program;
  if (structureKeyOf(graph) !== program.structureKey) throw new Error('withGraph: the graph structure changed; compile it again');
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes = new Map();
  for (const [id, e] of program.nodes) nodes.set(id, byId.get(id) === e.node ? e : { ...e, node: byId.get(id) });
  return { ...program, graph, nodes, diags: [...program.structuralDiags, ...paramDiags(nodes, program.order, program.badLinks)] };
}

// ---------------------------------------------------------------- evaluate

const NOTES = new WeakMap(); // outs object -> notes recorded when it was computed (replayed on cache hits)
let neverAbort = null;
const noAbort = () => (neverAbort ||= typeof AbortController === 'function' ? new AbortController().signal : { aborted: false });

function coerceKnown(def, o) {
  const out = { ...o };
  for (const p of def.params) if (p.key in out) out[p.key] = coerce(p, out[p.key]);
  return out;
}

function* core(program, run, opts = {}) {
  const started = now();
  const { graph, nodes, order } = program;
  const rate = snapRate(graph.rate), dt = 1000 / rate;
  const durationMs = Math.max(0, Number(run.durationMs) || 0);
  const full = { t0: 0, t1: durationMs };
  const window = !!opts.range;
  const range = window ? { t0: Math.floor(opts.range.t0), t1: Math.ceil(opts.range.t1) } : full;
  const media = run.media ?? null;
  const fps = media?.fps > 0 ? media.fps : run.frameMs > 0 ? 1000 / run.frameMs : 30;
  const frameMs = run.frameMs > 0 ? run.frameMs : 1000 / fps;
  // the run environment enters every key: full-timeline grids, adapters, ctx.full/frameMs/media all depend on it
  let mediaKey;
  try { mediaKey = media ? stableJSON(media) : '-'; } catch { mediaKey = tokenOf(media); }
  const envKey = `${durationMs}|${frameMs}|${mediaKey}`;
  const cache = run.cache || createCache();
  const abort = run.abort || noAbort();
  const yieldMs = run.yieldMs ?? 8;
  const res = { values: new Map(), status: new Map(), keys: new Map(), stats: new Map(), diags: [], ms: 0, aborted: false, range, window };
  const diags = new Map(program.diags.map((d) => [d.id, d]));
  const addDiag = (d) => { if (!diags.has(d.id)) diags.set(d.id, d); };
  const origin = new Map(); // failed or output-less node -> its root cause

  // pull: the targets and their ancestors
  const targets = new Set();
  for (const t of opts.targets ?? program.outputs) {
    const s = String(t), i = s.indexOf(':');
    const id = i < 0 ? s : s.slice(0, i);
    if (nodes.has(id)) targets.add(id);
  }
  const needed = new Set(targets);
  for (const id of ancestorsIn(nodes, targets, program.badLinks)) needed.add(id);

  const pCache = new Map();
  const paramsOf = (id) => {
    let p = pCache.get(id);
    if (!p) { const e = nodes.get(id); p = e.def ? normalizeValues(e.def.params, e.node.params || {}) : { ...(e.node.params || {}) }; pCache.set(id, p); }
    return p;
  };
  const goodLinks = (e) => [...e.inLinks.values()].filter((l) => !program.badLinks.has(l.id));

  // windowing: which nodes run on a widened window, and by how much
  const widen = new Map();
  const haloOf = new Map();
  if (window) {
    for (const id of order) {
      if (!needed.has(id)) continue;
      const e = nodes.get(id);
      let h = Infinity;
      if (e.def && !program.staticError.has(id)) {
        if (e.node.muted) h = 0;
        // a linked number param is only known at run time, so the halo (computed from stored params) can't be trusted
        else if (e.def.local && !e.ports.params.some((pp) => pp.mod === 'number' && e.inLinks.has(pp.name))) {
          // the per-span fold runs each span with its byKind overrides, which can need more context than the base
          try {
            h = Number(e.def.halo(paramsOf(id)));
            for (const o of Object.values(e.node.byKind || {})) {
              if (o && typeof o === 'object') h = Math.max(h, Number(e.def.halo({ ...paramsOf(id), ...coerceKnown(e.def, o) })));
            }
          } catch { h = Infinity; }
        }
      }
      if (!(h >= 0)) h = Infinity;
      for (const l of goodLinks(e)) if (haloOf.get(l.from) === Infinity) h = Infinity; // a global ancestor makes it global
      haloOf.set(id, h);
    }
    for (const id of targets) widen.set(id, 0);
    for (let k = order.length - 1; k >= 0; k--) {
      const id = order[k];
      if (!needed.has(id)) continue;
      let w = widen.get(id) ?? Infinity;
      const h = haloOf.get(id);
      if (h === Infinity) w = Infinity;
      widen.set(id, w);
      for (const l of goodLinks(nodes.get(id))) {
        const cand = w === Infinity ? Infinity : w + h;
        widen.set(l.from, Math.max(widen.get(l.from) ?? -Infinity, cand));
      }
    }
  }

  const pins = [];
  let lastYield = now();
  let k = 0;
  for (; k < order.length; k++) {
    const id = order[k];
    if (!needed.has(id)) continue;
    if (!abort.aborted && now() - lastYield >= yieldMs) { yield; lastYield = now(); }
    if (abort.aborted) break;
    let r;
    try { r = evalNode(id); } catch (err) { r = crashed(id, err); }
    if (r === ABORT) break;
  }
  if (abort.aborted || res.aborted) {
    res.aborted = true;
    for (; k < order.length; k++) if (needed.has(order[k]) && !res.status.has(order[k])) res.status.set(order[k], 'skipped');
  }
  cache.pinOnly(pins, window ? 'window' : 'full');
  res.diags = [...diags.values()];
  res.ms = now() - started;
  return res;

  // a throw outside def.eval (reads(), adapters, output typing) fails its node only, never the whole run
  function crashed(id, err) {
    res.keys.delete(id);
    if (err === ABORT || abort.aborted) { res.aborted = true; res.status.set(id, 'skipped'); return ABORT; }
    res.status.set(id, 'error');
    origin.set(id, id);
    addDiag({ id: diagId('throw', id), node: id, severity: 'error', code: 'throw', message: err?.message ?? String(err) });
    for (const op of nodes.get(id).ports.outs) res.values.delete(`${id}:${op.name}`);
  }

  function evalNode(id) {
    const t0 = now();
    const e = nodes.get(id);
    const { node, def, ports } = e;
    if (program.staticError.has(id)) { res.status.set(id, 'error'); origin.set(id, id); return; }
    const w = widen.get(id);
    const win = window && Number.isFinite(w);
    const nrange = win ? { t0: range.t0 - w, t1: range.t1 + w } : full;
    let grid = null;
    const gridOf = () => (grid ||= gridFor(nrange, dt));

    // inputs (raw; adapted lazily on a miss)
    const raw = new Map();
    const parts = [];
    let blockedBy = null;
    for (const port of [...ports.ins, ...ports.params]) {
      const l = e.inLinks.get(port.name);
      if (!l || program.badLinks.has(l.id)) continue;
      const vkey = `${l.from}:${l.out}`;
      const has = res.values.has(vkey);
      const adapter = program.adapters.get(l.id) || '';
      parts.push(port.name, has ? res.keys.get(l.from) : '∅', l.out, adapter);
      if (has) raw.set(port.name, { v: res.values.get(vkey), adapter });
      // a failed gate or modulator must not read as "unconnected" (an 'Only inside' edit would apply everywhere)
      else if ((port.required || port.name === 'where' || port.name.startsWith('p:')) && !blockedBy) blockedBy = origin.get(l.from) ?? l.from;
    }
    // a windowed node needs its inputs only on its range ± its halo: an input computed on more (e.g. a shared source
    // that also feeds a global node) is clipped, so the window saves work whatever ran upstream
    const h = win ? haloOf.get(id) : 0;
    const clip = (v) => {
      if (!win) return v;
      if (Array.isArray(v) && v.length && 'at' in v[0]) return clipScript(v, nrange.t0 - h, nrange.t1 + h);
      if (v && v.v instanceof Float32Array) return sliceSignal(v, nrange.t0 - h, nrange.t1 + h);
      return v;
    };
    const inputOf = (name) => {
      const r = raw.get(name);
      if (!r) return undefined;
      if (!('a' in r)) r.a = r.adapter ? adapt(r.adapter, r.v, h ? gridFor({ t0: nrange.t0 - h, t1: nrange.t1 + h }, dt) : gridOf()) : clip(r.v);
      return r.a;
    };

    if (node.muted) {
      const outs = {};
      const mparts = [];
      for (const op of ports.outs) {
        const inName = def.bypass?.[op.name] ?? ports.ins.find((p) => p.type === op.type)?.name;
        const l = inName && e.inLinks.get(inName);
        const r = inName && raw.get(inName);
        mparts.push(op.name, inName || '', r ? res.keys.get(l.from) : '∅', l ? l.out : '', r ? r.adapter : '', win ? `${nrange.t0},${nrange.t1}` : '');
        if (r) outs[op.name] = inputOf(inName);
      }
      const key = hashKey('mute', envKey, ...mparts);
      if (blockedBy) origin.set(id, blockedBy);
      for (const op of ports.outs) {
        if (op.name in outs) res.values.set(`${id}:${op.name}`, outs[op.name]);
        else if (!origin.has(id)) origin.set(id, id);
      }
      res.status.set(id, 'muted');
      res.keys.set(id, key);
      res.stats.set(id, { ms: now() - t0, bytes: 0, hit: false });
      return;
    }

    if (blockedBy) {
      res.status.set(id, 'blocked');
      origin.set(id, blockedBy);
      addDiag({ id: diagId('upstream', id), node: id, severity: 'info', code: 'upstream', origin: blockedBy, message: `waiting on "${titleOf(nodes.get(blockedBy))}"` });
      return;
    }

    const p = paramsOf(id);
    const fail = (code, message) => {
      res.status.set(id, 'error');
      origin.set(id, id);
      addDiag({ id: diagId(code, id), node: id, severity: 'error', code, message });
      res.stats.set(id, { ms: now() - t0, bytes: 0, hit: false });
    };

    // source reads
    const reads = new Map();
    if (def.reads) {
      let list;
      try { list = def.reads(p) || []; } catch (err) { fail('throw', `reads(): ${err?.message ?? err}`); return; }
      for (const [kind, ref] of list) {
        const v = run.sources?.get?.(kind, ref);
        reads.set(`${kind}\u0000${stableJSON(ref ?? null)}`, v);
        parts.push('read', kind, stableJSON(ref ?? null), tokenOf(v));
      }
    }
    let key;
    try {
      key = hashKey(node.type, node.tv ?? def.version, stableJSON(node.params || {}), stableJSON(node.byKind ?? null), rate, false,
        ...parts, win ? `${nrange.t0},${nrange.t1}` : '', envKey);
    } catch (err) { fail('throw', err?.message ?? String(err)); return; }
    res.keys.set(id, key);
    const notesOut = (notes) => {
      for (const n of notes) {
        const fix = n.fix ? { ...n.fix, args: { node: id, ...(n.fix.args || {}) } } : undefined;
        const d = { id: diagId(n.code, id, n.tag), node: id, severity: n.severity, code: n.code, message: n.message };
        if (fix) d.fix = fix;
        addDiag(d);
      }
    };

    const hit = cache.get(key);
    if (hit) {
      for (const [name, v] of Object.entries(hit.outs)) res.values.set(`${id}:${name}`, v);
      notesOut(NOTES.get(hit.outs) || []);
      res.status.set(id, 'cached');
      res.stats.set(id, { ms: now() - t0, bytes: hit.bytes, hit: true });
      pins.push(key);
      return;
    }

    // modulated params
    const fns = {};
    for (const pp of ports.params) {
      if (!raw.has(pp.name)) continue;
      const schema = def.params.find((q) => q.key === pp.param);
      const v = inputOf(pp.name);
      if (pp.mod === 'number') { if (typeof v === 'number') p[pp.param] = coerce(schema, v); }
      else if (typeof v === 'number') fns[pp.param] = () => v;
      else if (v && v.v) { const c = p[pp.param]; fns[pp.param] = (t) => { const x = signalAt(v, t); return x === x ? x : c; }; }
    }
    const inputs = {};
    for (const port of ports.ins) if (raw.has(port.name)) inputs[port.name] = inputOf(port.name);

    const notes = [];
    const declared = new Set((def.reads ? [...reads.keys()] : []));
    const kindParams = new Map();
    const ctx = {
      range: nrange, full, window: win, durationMs, rate, dt,
      grid: () => ({ ...gridOf() }),
      frameMs, fps, media,
      param(k) {
        if (fns[k]) return fns[k];
        const c = p[k];
        return () => c;
      },
      where: def.perSpan && inputs.where ? flattenSpans(inputs.where) : null,
      paramsFor(span) {
        const o = span && node.byKind?.[span.kind];
        if (!o) return p;
        if (!kindParams.has(span.kind)) kindParams.set(span.kind, { ...p, ...coerceKnown(def, o) });
        return kindParams.get(span.kind);
      },
      read(kind, ref) {
        const rk = `${kind}\u0000${stableJSON(ref ?? null)}`;
        if (!declared.has(rk)) throw new Error(`read("${kind}"${ref != null ? `, ${JSON.stringify(ref)}` : ''}) is not declared by reads()`);
        return reads.get(rk);
      },
      rng: () => mulberry32(hashSeed(p.seed ?? 0, def.type)),
      // `code` (third argument) is an addition: 'source-missing' | 'empty' | 'gaps' | 'note' (default)
      warn(message, fix, code = 'note') { notes.push({ severity: 'warn', code: NOTE_CODES.has(code) ? code : 'note', message: String(message), fix, tag: 'n' + notes.length }); },
      info(message, fix, code = 'note') { notes.push({ severity: 'info', code: NOTE_CODES.has(code) ? code : 'note', message: String(message), fix, tag: 'n' + notes.length }); },
      abort,
    };

    let outs;
    try {
      outs = def.eval(inputs, p, ctx);
    } catch (err) {
      if (err === ABORT || abort.aborted) { res.aborted = true; res.keys.delete(id); res.status.set(id, 'skipped'); return ABORT; }
      fail('throw', err?.message ?? String(err));
      notesOut(notes);
      return;
    }
    if (!outs || typeof outs !== 'object') { fail('invalid-output', 'the node returned no outputs object'); return; }

    const clean = {};
    let bytes = 0;
    for (const op of ports.outs) {
      let v = outs[op.name];
      if (v === undefined) continue;
      let T = program.types.get(`${id}:${op.name}`) || op.type;
      if (T === 'any') T = typeOfValue(v) || 'any';
      const why = checkValue(T, v);
      if (why) {
        if (T === 'script' && Array.isArray(v)) v = normalize(v.filter((a) => a && typeof a === 'object'));
        else if (T === 'spans' && Array.isArray(v)) v = normSpans(v);
        else { fail('invalid-output', `output "${op.name}": ${why}`); notesOut(notes); return; }
        notes.push({ severity: 'warn', code: 'invalid-output', message: `output "${op.name}" was invalid and has been repaired (${why})`, tag: op.name });
      }
      clean[op.name] = v;
      bytes += bytesOf(T, v);
    }
    NOTES.set(clean, notes);
    cache.set(key, clean, bytes);
    pins.push(key);
    for (const [name, v] of Object.entries(clean)) res.values.set(`${id}:${name}`, v);
    notesOut(notes);
    res.status.set(id, 'ok');
    const ms = now() - t0;
    res.stats.set(id, { ms, bytes, hit: false });
    // ponytail: visibility only; the real fix for long tasks is evaluating in a Worker (controller) or chunked nodes
    if (ms >= SLOW_NODE_MS) addDiag({ id: diagId('slow', id), node: id, severity: 'info', code: 'slow', message: `took ${Math.round(ms)} ms in one piece, the editor may stutter while it runs` });
  }
}

const NOTE_CODES = new Set(['note', 'source-missing', 'empty', 'gaps']);
/** A node that runs this long in one synchronous piece gets an info 'slow' diagnostic (an addition to the contract). */
export const SLOW_NODE_MS = 50;

function yieldToLoop() {
  if (globalThis.scheduler && typeof globalThis.scheduler.yield === 'function') return globalThis.scheduler.yield();
  if (typeof MessageChannel === 'function' && typeof window !== 'undefined') {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
      ch.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Evaluates, yielding to the event loop every run.yieldMs (default 8) between nodes. */
export async function evaluate(program, run, opts) {
  const it = core(program, run, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    await yieldToLoop();
  }
}

/** The same evaluation without yielding (tests, bake fallbacks). */
export function evaluateSync(program, run, opts) {
  const it = core(program, run, opts);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

// ---------------------------------------------------------------- previews (additions to the contract)

/** A node's card status line: def.summary(outs, p) or summarize() of its first output with a value. */
export function nodeSummary(program, result, nodeId) {
  const e = program.nodes.get(nodeId);
  if (!e) return '';
  const outs = {};
  for (const op of e.ports.outs) { const v = result.values.get(`${nodeId}:${op.name}`); if (v !== undefined) outs[op.name] = v; }
  if (e.def?.summary && Object.keys(outs).length) {
    try { return String(e.def.summary(outs, e.def ? normalizeValues(e.def.params, e.node.params || {}) : {})); } catch { /* fall through */ }
  }
  const op = e.ports.outs.find((o) => outs[o.name] !== undefined);
  if (!op) return '';
  let T = program.types.get(`${nodeId}:${op.name}`) || op.type;
  if (T === 'any') T = typeOfValue(outs[op.name]) || 'any';
  return summarize(T, outs[op.name]);
}
