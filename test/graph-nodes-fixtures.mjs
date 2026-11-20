// Shared fixtures for the node-catalogue tests (not a test file itself): seeded random scripts, signals and spans,
// a synthetic document snapshot, a minimal Sources over it, fixture source nodes and an engine runner.
import { mulberry32 } from '../src/lib/gen/util.js';
import { normalize } from '../src/lib/core/script.js';
import { defineNode, emptyGraph, addNode, connect } from '../src/lib/graph/model.js';
import { compile, evaluateSync, createCache } from '../src/lib/graph/eval.js';
import { clipScript, sliceSignal, makeSignal, sampleScript, gridFor, normSpans } from '../src/lib/graph/types.js';
import { createCatalogue } from '../src/lib/graph/nodes/index.js';
import { compilePlan } from '../src/lib/gen/plan.js';

export const DUR = 60000;
export const KINDS = ['foreplay', 'oral', 'penetration', 'knotting', 'climax', 'afterglow'];

/** A stroke-like script over [t0, t1]: turns every 150..600 ms with random depth, some mid-stroke points. */
export function randomScript(rng, t0 = 0, t1 = DUR, { gaps = true } = {}) {
  const out = [];
  let t = t0 + Math.floor(rng() * 200), up = rng() < 0.5;
  while (t < t1) {
    const lo = Math.floor(rng() * 30), hi = 60 + Math.floor(rng() * 40);
    out.push({ at: t, pos: up ? hi : lo });
    const half = 150 + Math.floor(rng() * 450);
    if (rng() < 0.3) out.push({ at: t + Math.floor(half / 2), pos: Math.floor((hi + lo) / 2 + (rng() - 0.5) * 20) });
    t += half;
    if (gaps && rng() < 0.03) t += 2000 + Math.floor(rng() * 3000); // a pause
    up = !up;
  }
  return normalize(out);
}

/** A tracker-like signal on the grid of [0, DUR] at dt: script + noise, with NaN dropouts. */
export function randomSignal(rng, dt = 20, base = randomScript(rng)) {
  const g = gridFor({ t0: 0, t1: DUR }, dt), sig = sampleScript(base, g);
  let gap = 0;
  for (let k = 0; k < sig.v.length; k++) {
    if (gap > 0) { sig.v[k] = NaN; gap--; continue; }
    if (rng() < 0.002) gap = 5 + Math.floor(rng() * 40);
    if (sig.v[k] === sig.v[k]) sig.v[k] += (rng() - 0.5) * 4;
  }
  return sig;
}

/** Random spans: kinds from KINDS, some overlapping, some points, some with values. */
export function randomSpans(rng, n = 8, { pointsShare = 0.15 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = Math.floor(rng() * (DUR - 4000));
    const point = rng() < pointsShare;
    const t1 = point ? t0 : t0 + 500 + Math.floor(rng() * 12000);
    out.push({ t0, t1, kind: KINDS[Math.floor(rng() * KINDS.length)], value: Math.round((rng() * 2 - 1) * 100) / 100, label: `s${i}` });
  }
  return normSpans(out);
}

export function fakeRun(rng, id = 'run1') {
  const base = randomScript(rng);
  const t = [], v = [], ct = [], cv = [], xt = [], xv = [];
  for (let ms = 0; ms <= DUR; ms += 33) {
    const lost = (ms > 20000 && ms < 21500) || (ms > 40000 && ms < 40400);
    t.push(ms); v.push(lost ? NaN : (base.length ? Math.max(0, Math.min(100, posLin(base, ms))) / 100 : 0.5));
    ct.push(ms); cv.push(lost ? 0 : 0.4 + 0.6 * rng());
    xt.push(ms); xv.push(200 + 50 * Math.sin(ms / 700));
  }
  const pts = base.filter((_, i) => i % 2 === 0);
  const unit = (f) => ({ t: Float64Array.from(xt), v: Float32Array.from(xt, f), min: 0, max: 1 });   // grid-run channels (0..1)
  return {
    id, n: 1, name: 'Fake tracker', tracker: 'fake', color: '#4DA6FF',
    samples: { t: Float64Array.from(t), v: Float32Array.from(v) },
    confidence: { t: Float64Array.from(ct), v: Float32Array.from(cv) },
    channels: { x: { t: Float64Array.from(xt), v: Float32Array.from(xv), min: 150, max: 250 },
      g1_proj: unit((ms) => 0.5 + 0.5 * Math.sin(ms / 400)), g2_proj: unit((ms) => 0.5 + 0.2 * Math.sin(ms / 400 + 1)),
      pair_proj: unit((ms) => 0.5 - 0.5 * Math.sin(ms / 400)) },
    points: { at: Float64Array.from(pts, (a) => a.at), pos: Float64Array.from(pts, (a) => a.pos) },
    events: [{ t_ms: 5000, kind: 'still', label: 'still' }, { t_ms: 50000, end_ms: 58000, kind: 'orgasm', label: 'orgasm' }],
    scenes: [{ start_ms: 0, end_ms: 30000, sign: 1 }, { start_ms: 30000, end_ms: DUR, sign: -1 }], flips: [],
  };
}
function posLin(s, t) {
  let lo = 0, hi = s.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (s[m].at < t) lo = m + 1; else hi = m; }
  if (lo === 0) return s[0].pos;
  if (lo === s.length) return s[s.length - 1].pos;
  const a = s[lo - 1], b = s[lo];
  return a.pos + ((b.pos - a.pos) * (t - a.at)) / (b.at - a.at);
}

/** A synthetic document snapshot (contract §9 Snapshot shape). */
export function makeSnapshot(seed = 1) {
  const rng = mulberry32(seed);
  const stroke = randomScript(rng), tracker = randomScript(rng), tracker2 = randomScript(rng);
  return {
    axes: { stroke, roll: randomScript(rng) },
    ghosts: [
      { id: 'g1', name: 'Tracker', script: tracker, source: { kind: 'tracker' } },
      { id: 'g2', name: 'Tracker B', script: tracker2, source: { kind: 'tracker' } },
      { id: 'ref', name: 'Reference', script: stroke, pinned: true, source: { kind: 'reference' } },
    ],
    plan: [
      { id: 'p1', t0: 0, t1: 8000, kind: 'foreplay' },
      { id: 'p2', t0: 8000, t1: 20000, kind: 'oral' },
      { id: 'p3', t0: 20000, t1: 38000, kind: 'penetration' },
      { id: 'p4', t0: 38000, t1: 46000, kind: 'knotting' },
      { id: 'p5', t0: 46000, t1: 54000, kind: 'orgasm' },
      { id: 'p6', t0: 54000, t1: 60000, kind: 'afterglow' },
    ],
    chapters: [{ id: 'c1', t0: 0, t1: 30000, name: 'Part 1' }, { id: 'c2', t0: 30000, t1: 60000, name: 'Part 2' }],
    loops: [{ id: 'l1', t0: 10000, t1: 10800, tiledTo: { t0: 10000, t1: 16000 } }],
    bookmarks: [1000, 2000, 2500, 9000, 31000].map((at, i) => ({ id: 'b' + i, at, note: 'beat ' + i })),
    range: { t0: 12000, t1: 24000 },
    selection: { axis: 'stroke', ats: new Set(stroke.slice(10, 20).map((a) => a.at)) },
    media: { durationMs: DUR, fps: 30, isVfr: false, width: 1920, height: 1080 },
    runs: [fakeRun(rng, 'run1'), fakeRun(rng, 'run2')],
    scenes: [{ start_ms: 0, end_ms: 25000, sign: 1 }, { start_ms: 25000, end_ms: DUR, sign: -1 }],
    trackSpans: [{ start_ms: 1000, end_ms: 9000, state: 'idle' }, { start_ms: 20000, end_ms: 38000, state: 'active' }, { start_ms: 46000, end_ms: 54000, state: 'orgasm' }],
    audio: { i0: 0, dt: 10, v: Float32Array.from({ length: DUR / 10 + 1 }, (_, k) => 0.5 + 0.5 * Math.sin(k / 37)) },
    tags: [{ t0: 3000, t1: 9000, tag: 'kiss', score: 0.8 }],
    durationMs: DUR, frameMs: 1000 / 30,
    fx: {},
  };
}

/** Minimal Sources over a snapshot (doc.js semantics: identity preserved; ghosts by id then name). */
export function sourcesOf(s) {
  return {
    get(kind, ref) {
      if (kind === 'axis') return s.axes?.[ref];
      if (kind === 'ghost') return (s.ghosts || []).find((g) => g.id === ref) ?? (s.ghosts || []).find((g) => g.name === ref);
      if (kind === 'run') return (s.runs || []).find((r) => r.id === ref);
      if (kind === 'fx') return s.fx?.[ref];
      return s[kind];
    },
    list: () => [],
  };
}

// fixture source nodes: a value of any type from snapshot.fx[key], windowed like the real sources
const fx = (type, T) => defineNode({
  type, title: type, group: 'Test', ins: [], outs: [{ name: 'value', type: T }],
  params: [{ key: 'key', label: 'Key', type: 'text', default: '' }],
  reads: (p) => [['fx', p.key]], halo: () => 0, local: true,
  eval(_in, p, ctx) {
    const v = ctx.read('fx', p.key);
    if (v === undefined) throw new Error(`no fixture "${p.key}"`);
    if (!ctx.window) return { value: v };
    if (T === 'script') return { value: clipScript(v, ctx.range.t0, ctx.range.t1) };
    if (T === 'signal') return { value: sliceSignal(v, ctx.range.t0, ctx.range.t1) };
    return { value: v };
  },
});
export const FX = { script: fx('fx.script', 'script'), signal: fx('fx.signal', 'signal'), spans: fx('fx.spans', 'spans'), number: fx('fx.number', 'number') };

export function testRegistry() {
  return createCatalogue({ compilePlan }).add(Object.values(FX));
}

/**
 * Build a graph: specs = [{ id, type, params?, byKind? }], links = [[fromId, out, toId, in]]. Ids are the spec ids.
 * -> graph (throws on a refused link)
 */
export function buildGraph(reg, specs, links = [], { rate = 50 } = {}) {
  let g = emptyGraph({ rate });
  const ids = {};
  for (const s of specs) {
    const r = addNode(g, reg, s.type, { params: s.params || {}, byKind: s.byKind });
    g = r.graph; ids[s.id] = r.id;
  }
  // rename to the spec ids so tests can refer to them
  g = { ...g, nodes: g.nodes.map((n) => ({ ...n, id: Object.keys(ids).find((k) => ids[k] === n.id) })) };
  for (const [from, out, to, inp] of links) {
    const r = connect(g, reg, { from, out, to, in: inp });
    if (r.reason) throw new Error(`link ${from}.${out} -> ${to}.${inp}: ${r.reason}`);
    g = r.graph;
  }
  return g;
}

export function run(reg, graph, snapshot, { range = null, targets, cache = createCache() } = {}) {
  const program = compile(graph, reg);
  const res = evaluateSync(program, { sources: sourcesOf(snapshot), durationMs: snapshot.durationMs, media: snapshot.media, frameMs: snapshot.frameMs, cache }, { targets, range });
  return { program, res };
}

export const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o) && !ArrayBuffer.isView(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};

export { makeSignal };
