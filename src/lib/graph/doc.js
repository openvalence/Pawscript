// doc.js -- the node graph's document adapters (contract: src/lib/graph/README.md §9). Pure: no DOM, no Svelte,
// no `app`. The integration (src/features/graph/integration/) builds a plain Snapshot of the document and
// hands it here; everything below works on plain values, so it is tested in node.
//
//   makeSources(snapshot)          what source nodes read (identity preserved: the engine keys by identity)
//   previewList / mergeGhosts      the graph's outputs as preview ghosts in doc.ghosts
//   bakePlan / markBaked / ...     what a bake writes, and the bake-status bookkeeping
//   freezePlan                     the 'freezeSource' fix (src.axis -> pinned ghost + src.ghost)
//
// Additions beyond the contract (add, never change): previewList opts.activeAxis; bakePlan result fields
// `range`, `axisOf`; freezePlan's optional 4th argument { reg, now }; makeSources list('tag');
// list('run') also offers tracker ghosts whose run is gone; bakePlan result field `wipes`;
// stabilize() (content-equal snapshot values keep their old identity, so the cache keeps hitting).

import { replaceRange, slice } from '../core/script.js';
import { AXES } from '../funscript.js';
import { KINDS } from '../gen/recipes.js';

export const GRAPH_GHOST = 'graph';

/** Every named (non T-code) axis id, in AXES order: stroke, surge, sway, twist, roll, pitch, vib, ... */
const NAMED_AXES = Object.keys(AXES).filter((k) => k && !/^[lrva]\d$/.test(k));
const isGraphGhost = (g) => g?.source?.kind === GRAPH_GHOST;

// ---------------------------------------------------------------- sources

/**
 * Sources over a Snapshot. get() returns the snapshot's value itself (never a copy), so the engine's identity
 * tokens are exact: a value that did not change keeps hitting the cache. Ghosts the graph published itself
 * (source.kind 'graph') are invisible here: a graph never reads its own previews.
 */
export function makeSources(snapshot = {}) {
  const s = snapshot || {};
  const ghosts = (s.ghosts || []).filter((g) => !isGraphGhost(g));
  const runs = s.runs || [];
  const lists = new Map();
  const memo = (key, f) => (lists.has(key) ? lists.get(key) : (lists.set(key, f()), lists.get(key)));

  function get(kind, ref) {
    switch (kind) {
      case 'axis': return s.axes?.[ref];
      case 'ghost': return ghosts.find((g) => g.id === ref) ?? ghosts.find((g) => g.name === ref);
      case 'run': return runs.find((r) => r.id === ref);
      case 'plan': case 'chapters': case 'loops': case 'bookmarks': case 'range': case 'selection': case 'media':
      case 'scenes': case 'trackSpans': case 'audio': case 'tags': case 'durationMs': case 'frameMs': case 'fx':
        return s[kind];
      default: return undefined;
    }
  }

  function list(kind, ref) {
    return memo(kind + '\u0000' + (ref ?? ''), () => {
      switch (kind) {
        case 'axis': {
          const have = Object.keys(s.axes || {});
          const ids = [...new Set(['stroke', ...have, ...NAMED_AXES])];
          return ids.map((id) => ({ id, name: id, detail: s.axes?.[id] ? `${s.axes[id].length} pts` : 'empty' }));
        }
        case 'ghost':
          return ghosts.map((g) => ({ id: g.id, name: g.name || g.id, detail: `${g.script?.length ?? 0} pts${g.pinned ? ' · reference' : g.source?.kind === 'tracker' ? ' · tracker' : ''}` }));
        case 'run': {
          // live runs, then tracker ghosts whose run is gone (runs are session-only; src.run falls back to the
          // ghost with the run's id, so a reloaded project can still bind them)
          const live = runs.map((r) => ({ id: r.id, name: r.name || r.id, detail: r.tracker || '' }));
          const have = new Set(runs.map((r) => r.id));
          const gone = ghosts.filter((g) => g.source?.kind === 'tracker' && !have.has(g.id))
            .map((g) => ({ id: g.id, name: g.name || g.id, detail: 'ghost only (run not in this session)' }));
          return [...live, ...gone];
        }
        case 'kind': {
          const out = Object.entries(KINDS).map(([id, k]) => ({ id, name: k.label }));
          for (const p of s.plan || []) if (p?.kind && !out.some((o) => o.id === p.kind)) out.push({ id: p.kind, name: p.kind });
          return out;
        }
        case 'channel': {
          const r = runs.find((x) => x.id === ref);
          if (!r) return [{ id: 'primary', name: 'primary' }];
          return [{ id: 'primary', name: 'primary', detail: `${r.samples?.t?.length ?? 0} smp` },
            ...Object.keys(r.channels || {}).map((id) => ({ id, name: id, detail: `${r.channels[id]?.t?.length ?? 0} smp` }))];
        }
        case 'tag':
          return [...new Set((s.tags || []).map((t) => t.tag))].map((id) => ({ id, name: id }));
        default: return [];
      }
    });
  }

  return { get, list, snapshot: s };
}

// Content keys for the small snapshot values whose arrays/objects are rebuilt without their content changing
// (a range re-set to the same {t0,t1}, a selection replaced by an equal one). Scripts, runs and audio are not
// keyed by content: their identity only changes with their content, and hashing them every frame would cost.
const SMALL = ['plan', 'chapters', 'loops', 'bookmarks', 'range', 'media', 'scenes', 'trackSpans', 'tags', 'fx'];
function contentKey(kind, v) {
  if (v == null) return 'null';
  if (kind === 'selection') return (v.axis ?? '') + ':' + [...(v.ats || [])].sort((a, b) => a - b).join(',');
  try { return JSON.stringify(v); } catch { return null; }
}

/**
 * next with every value that is content-equal to prev's replaced by prev's (identity kept), so the engine's
 * identity tokens do not miss on rebuilt-but-equal values. Returns prev itself when nothing changed at all.
 * `keys` (a Map, mutated) caches content keys by object identity across calls.
 */
export function stabilize(next, prev, keys = new Map()) {
  if (!prev) return next;
  const out = { ...next };
  let same = true;
  for (const k of Object.keys(out)) {
    const a = out[k], b = prev[k];
    if (a === b) continue;
    if (SMALL.includes(k) || k === 'selection') {
      const ka = keyOf(keys, k, a), kb = keyOf(keys, k, b);
      if (ka !== null && ka === kb) { out[k] = b; continue; }
    } else if (k === 'axes' && a && b) {
      const ak = Object.keys(a), bk = Object.keys(b);
      if (ak.length === bk.length && ak.every((id) => a[id] === b[id])) { out[k] = b; continue; }
    } else if (k === 'ghosts' && a && b) {
      const ga = a.filter((g) => !isGraphGhost(g)), gb = b.filter((g) => !isGraphGhost(g));
      if (ga.length === gb.length && ga.every((g, i) => g === gb[i])) { out[k] = b; continue; }
    }
    same = false;
  }
  if (Object.keys(prev).length !== Object.keys(out).length) same = false;
  return same ? prev : out;
}
function keyOf(cache, kind, v) {
  if (v == null || typeof v !== 'object') return contentKey(kind, v);
  if (!cache.has(v)) { cache.set(v, contentKey(kind, v)); if (cache.size > 256) cache.delete(cache.keys().next().value); }
  return cache.get(v);
}

// ---------------------------------------------------------------- hashing

const hashMemo = new WeakMap();
/** FNV-1a over every at/pos (two lanes, 53 bits), base 36. Memoised by identity (Scripts are immutable). */
export function scriptHash(script) {
  if (!Array.isArray(script)) return 'none';
  const hit = hashMemo.get(script);
  if (hit) return hit;
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ script.length;
  for (let i = 0; i < script.length; i++) {
    const a = script[i].at | 0, p = script[i].pos | 0;
    h1 = Math.imul(h1 ^ a, 16777619); h1 = Math.imul(h1 ^ p, 16777619);
    h2 = Math.imul(h2 ^ (a + 0x9e3779b9), 2246822519); h2 = Math.imul(h2 ^ (p * 31 + i), 3266489917);
  }
  const out = ((h1 >>> 0) * 2097152 + ((h2 >>> 0) & 0x1fffff)).toString(36);
  hashMemo.set(script, out);
  return out;
}

/** Identity, else same length and every action equal. */
export function sameScript(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].at !== b[i].at || a[i].pos !== b[i].pos) return false;
  return true;
}

// ---------------------------------------------------------------- preview ghosts

/** `graph:<graphId>:<key>`, key = nodeId | 'A' | 'B' | `snap${n}` | 'probe'. */
export const ghostId = (graphId, key) => `${GRAPH_GHOST}:${graphId}:${key}`;

const firstOut = (program, node) => program?.nodes?.get(node)?.ports?.outs?.[0]?.name ?? program?.nodes?.get(node)?.def?.outs?.[0]?.name;
const titleOf = (program, id) => {
  const e = program?.nodes?.get(id);
  return e?.node?.label || e?.def?.title || e?.node?.type || id;
};

/**
 * The preview entries for one evaluation, in this order: unmuted out.axis with preview !== false (on its axis),
 * out.ghost, pins A/B, probe (scripts only), snapshots. Entries without a script value are left out.
 * opts: { pins: {A, B}: {node, port}|null, probe: {node, port}|null, snapshots: [{id, name, node, port, script}],
 *   colors: (seriesKey) => css colour | { [key]: css } (default: the key itself), activeAxis = 'stroke' }.
 * -> [{ id, name, axis, color, script, source: { kind: 'graph', graph, node, role, port? } }]
 */
export function previewList(program, result, { pins = null, probe = null, snapshots = [], colors = null, activeAxis = 'stroke' } = {}) {
  const gid = program?.graph?.id ?? 'g';
  const paint = typeof colors === 'function' ? colors : colors ? (k) => colors[k] ?? k : (k) => k;
  const values = result?.values;
  const out = [];
  const push = (key, name, axis, color, script, source) => {
    if (!Array.isArray(script)) return;
    out.push({ id: ghostId(gid, key), name, axis, color: paint(color), script, source: { kind: GRAPH_GHOST, graph: gid, ...source } });
  };
  for (const id of program?.outputs || []) {
    const e = program.nodes.get(id), n = e?.node;
    if (!n || n.muted) continue;
    const st = result?.status?.get(id);
    if (st && st !== 'ok' && st !== 'cached') continue;
    const v = values?.get(`${id}:result`);
    if (n.type === 'out.axis') {
      if (n.preview === false) continue;
      const axis = n.params?.axis || 'stroke';
      push(id, `${n.label || 'Graph'} → ${axis}`, axis, n.color || 'violet', v, { node: id, role: 'output' });
    } else if (n.type === 'out.ghost') {
      push(id, n.params?.name || n.label || 'Graph ghost', activeAxis, n.params?.color || n.color || 'pink', v, { node: id, role: 'output' });
    }
  }
  for (const [k, color] of [['A', 'sky'], ['B', 'orange']]) {
    const p = pins?.[k];
    if (!p?.node) continue;
    const port = p.port || firstOut(program, p.node);
    push(k, `${k}: ${titleOf(program, p.node)}`, activeAxis, color, values?.get(`${p.node}:${port}`), { node: p.node, port, role: 'pin' });
  }
  if (probe?.node) {
    const port = probe.port || firstOut(program, probe.node);
    push('probe', `Probe: ${titleOf(program, probe.node)}`, activeAxis, 'grey', values?.get(`${probe.node}:${port}`), { node: probe.node, port, role: 'probe' });
  }
  for (const s of snapshots || []) {
    const key = String(s.id).startsWith(GRAPH_GHOST + ':') ? String(s.id).split(':').slice(2).join(':') : s.id;
    push(key, s.name || 'Snapshot', s.axis || activeAxis, s.color || 'yellow', s.script, { node: s.node, port: s.port, role: 'snapshot' });
  }
  return out;
}

const sameGhost = (a, b) => a.id === b.id && a.script === b.script && a.name === b.name && a.color === b.color
  && a.axis === b.axis && a.visible === b.visible && a.source?.node === b.source?.node && a.source?.role === b.source?.role;

/**
 * docGhosts with every kind-'graph' ghost replaced by `mine` (appended after the others, in mine's order).
 * A ghost already shown under the same id keeps its `visible` flag (the user may have hidden it in a lane).
 * Returns docGhosts itself when nothing changed, so assigning it back is a no-op for Svelte and autosave.
 */
export function mergeGhosts(docGhosts = [], mine = []) {
  const docs = docGhosts || [];
  const old = docs.filter(isGraphGhost);
  const byId = new Map(old.map((g) => [g.id, g]));
  const next = mine.map((g) => {
    const prev = byId.get(g.id);
    const visible = prev ? prev.visible !== false : g.visible !== false;
    const ghost = { ...g, visible, source: { ...(g.source || {}), kind: GRAPH_GHOST } };
    return prev && sameGhost(prev, ghost) ? prev : ghost;
  });
  const others = docs.filter((g) => !isGraphGhost(g));
  const tailIsOld = old.length === next.length && next.every((g, i) => g === old[i]);
  // unchanged only if the graph ghosts already sit after the others, in this order
  if (tailIsOld && docs.slice(others.length).every((g, i) => g === old[i])) return docs;
  return [...others, ...next];
}

// ---------------------------------------------------------------- bake

const OKS = new Set(['ok', 'cached']);

/** ' (<the blocking node's error>)' for a blocked node, from its 'upstream' diag's origin; '' when unknown. */
function rootCause(program, result, id) {
  const all = [...(result?.diags || []), ...(program?.diags || [])];
  const origin = all.find((d) => d.node === id && d.code === 'upstream')?.origin;
  const cause = origin && all.find((d) => d.node === origin && d.severity === 'error');
  return cause ? ` (${cause.message})` : '';
}

/**
 * What a bake writes: per unmuted out.axis (or the `only` ids) its 'result' value, exactly. A node must be
 * ok|cached and have a value; a windowed result throws (bake must never use preview values). With `range`,
 * only [t0, t1] of the axis is replaced. Unchanged axes are skipped. Two outputs writing one axis are an error
 * and neither is written.
 * -> { writes: {axis: Script}, changed: axis[], skipped: [{node, axis, reason}], diags, hashes: {nodeId: hash},
 *      range, axisOf: {nodeId: axis}, wipes: axis[] }   wipes = changed axes the bake would empty or collapse
 *      (fewer than 2 actions left, fewer than now): callers must ask before writing those. hashes covers every node whose axis now equals its result (written or
 *      already equal), so markBaked can record both.
 */
export function bakePlan(program, result, axes = {}, { only = null, range = null } = {}) {
  if (result?.window) throw new Error('bakePlan: a windowed (preview) result cannot be baked; run a full evaluation');
  const want = only ? new Set(only) : null;
  const skipped = [], diags = [], cands = [];
  for (const id of program?.outputs || []) {
    const n = program.nodes.get(id)?.node;
    if (!n || n.type !== 'out.axis' || (want && !want.has(id))) continue;
    const axis = n.params?.axis || 'stroke';
    if (n.muted) { if (want) skipped.push({ node: id, axis, reason: 'muted' }); continue; }
    const st = result?.status?.get(id);
    if (!OKS.has(st)) {
      skipped.push({ node: id, axis, reason: st === 'blocked' ? `waiting on an upstream error${rootCause(program, result, id)}` : st === 'error' ? 'has an error' : `not evaluated (${st ?? 'no result'})` });
      continue;
    }
    const v = result.values?.get(`${id}:result`);
    if (!Array.isArray(v)) { skipped.push({ node: id, axis, reason: 'no result value' }); continue; }
    cands.push({ id, axis, v, label: n.label });
  }
  const byAxis = new Map();
  for (const c of cands) byAxis.set(c.axis, [...(byAxis.get(c.axis) || []), c]);
  const writes = {}, changed = [], hashes = {}, axisOf = {}, wipes = [];
  for (const [axis, list] of byAxis) {
    if (list.length > 1) {
      for (const c of list) {
        diags.push({ id: `output-collision@${c.id}`, node: c.id, severity: 'error', code: 'output-collision',
          message: `${list.length} outputs write ${axis}: mute all but one, or give them different axes` });
        skipped.push({ node: c.id, axis, reason: `another output also writes ${axis}` });
      }
      continue;
    }
    const c = list[0], cur = axes?.[axis] || [];
    const next = range ? replaceRange(cur, range.t0, range.t1, slice(c.v, range.t0, range.t1)) : c.v;
    axisOf[c.id] = axis;
    if (sameScript(cur, next)) { hashes[c.id] = scriptHash(cur); skipped.push({ node: c.id, axis, reason: 'unchanged' }); continue; }
    writes[axis] = next; changed.push(axis); hashes[c.id] = scriptHash(next);
    if (next.length < 2 && cur.length > next.length) wipes.push(axis);
  }
  return { writes, changed, skipped, diags, hashes, range: range ? { t0: range.t0, t1: range.t1 } : null, axisOf, wipes };
}

/** Outputs whose axis no longer holds what they last baked: [{ node, axis }] (nodes still in the graph only). */
export function axisDiffersFromBake(graph, axes = {}) {
  const out = [], have = new Set((graph?.nodes || []).map((n) => n.id));
  for (const [node, b] of Object.entries(graph?.lastBake || {})) {
    if (!have.has(node) || !b) continue;
    if (b.hash !== scriptHash(axes?.[b.axis] || [])) out.push({ node, axis: b.axis });
  }
  return out;
}

/**
 * graph with lastBake set for every node in plan.hashes: { axis, key: result.keys.get(node), hash, time: now }.
 * A range bake records key + '@t0-t1': the axis only holds the result inside the range, so the card shows
 * "stale" rather than claiming the whole output is baked.
 */
export function markBaked(graph, result, plan, now = 0) {
  const ids = Object.keys(plan?.hashes || {});
  if (!ids.length) return graph;
  const lastBake = { ...(graph.lastBake || {}) };
  for (const id of ids) {
    const key = String(result?.keys?.get(id) ?? '') + (plan.range ? `@${plan.range.t0}-${plan.range.t1}` : '');
    const axis = plan.axisOf?.[id] ?? graph.nodes.find((n) => n.id === id)?.params?.axis ?? 'stroke';
    lastBake[id] = { axis, key, hash: plan.hashes[id], time: now };
  }
  return { ...graph, lastBake };
}

/**
 * The 'freezeSource' fix: a pinned ghost holding a copy of the axis that src.axis `nodeId` reads, and the graph
 * with that node turned into a src.ghost bound to it (same id, so every link survives: both output `script`).
 * opts.reg: fills src.ghost's other param defaults. Throws when nodeId is not a src.axis.
 */
export function freezePlan(graph, nodeId, snapshot, { reg = null, now = 0 } = {}) {
  const node = graph?.nodes?.find((n) => n.id === nodeId);
  if (!node || node.type !== 'src.axis') throw new Error(`freezePlan: ${nodeId} is not an axis source`);
  const axis = node.params?.axis || 'stroke';
  const script = snapshot?.axes?.[axis] || [];
  const id = `frozen-${axis}-${scriptHash(script)}`;
  const ghost = { id, name: `Frozen ${axis} (${script.length} pts)`, color: '#E8D8A0', script, visible: false, pinned: true, axis,
    source: { kind: 'frozen', axis, graph: graph.id, time: now } };
  const def = reg?.get?.('src.ghost');
  const defaults = Object.fromEntries((def?.params || []).map((p) => [p.key, p.default]));
  const nodes = graph.nodes.map((n) => (n.id === nodeId
    ? { ...n, type: 'src.ghost', tv: def?.version ?? 1, params: { ...defaults, ghost: id }, label: n.label ?? null }
    : n));
  return { ghost, graph: { ...graph, nodes } };
}
