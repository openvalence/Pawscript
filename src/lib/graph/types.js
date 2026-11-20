// Port types, compatibility, adapters and the pure value helpers of the node graph (contract §2,
// src/lib/graph/README.md). No DOM, no dependencies beyond core/script.js. Nothing here mutates its input.
//
// Values on wires:
//   script  Action[] (core/script.js)
//   signal  { i0: int, dt: int, v: Float32Array, range?: [lo, hi] }   sample k at t = (i0 + k) * dt; NaN = unknown
//   spans   Span[] = { t0, t1, kind?, label?, value?, data? }, sorted by t0 then t1, half-open, t0 === t1 = point
//   number  finite JS number (booleans as 0/1)

import { posAt, lowerBound } from '../core/script.js';

export const TYPES = Object.freeze({
  script: Object.freeze({ label: 'Script', color: 'sky' }),
  signal: Object.freeze({ label: 'Signal', color: 'green' }),
  spans: Object.freeze({ label: 'Spans', color: 'yellow' }),
  number: Object.freeze({ label: 'Number', color: 'grey' }),
  any: Object.freeze({ label: 'Any', color: 'violet' }),
});

/** The four concrete types (everything but 'any'). */
export const VALUE_TYPES = Object.freeze(['script', 'signal', 'spans', 'number']);

/** Signal grid rates the graph accepts (Hz). */
export const RATES = Object.freeze([25, 50, 100, 200]);
/** A rate snapped to the nearest allowed value (default 50). */
export function snapRate(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return 50;
  return RATES.reduce((best, x) => (Math.abs(x - r) < Math.abs(best - r) ? x : best), 50);
}

// ---------------------------------------------------------------- compatibility

const REFUSE = {
  'signal>script': ['sig.toScript', 'sig.sampleAt'],
  'script>spans': ['script.turns', 'script.strokes'],
  'signal>spans': ['spans.threshold'],
  'spans>signal': ['spans.toSignal', 'spans.kindValue'],
  'script>number': ['an.stat'],
  'signal>number': ['an.stat'],
  'spans>script': ['flow.switch', 'script.splice'],
};

const label = (t) => (TYPES[t] ? TYPES[t].label.toLowerCase() : String(t));

/**
 * Can a value of type `from` feed a port of type `to`?
 * -> { ok: true } | { ok: true, adapter: 'sample' | 'const' } | { ok: false, reason, suggest: string[] }
 */
export function compat(from, to) {
  if (from === to || from === 'any' || to === 'any') return { ok: true };
  if (from === 'script' && to === 'signal') return { ok: true, adapter: 'sample' };
  if (from === 'number' && to === 'signal') return { ok: true, adapter: 'const' };
  const suggest = REFUSE[`${from}>${to}`];
  return { ok: false, reason: `${label(from)} cannot feed ${label(to)}`, suggest: suggest ? [...suggest] : [] };
}

/**
 * Compatibility of a value of type `from` with a param port (`p:<key>`) of a `mod` param.
 * mod 'signal' accepts signal, number (no adapter) and script (adapter 'sample'); mod 'number' accepts number only.
 * (Addition to the contract: the rule of §2.1 "Param ports" as a function.)
 */
export function compatParam(from, mod) {
  if (from === 'any') return { ok: true };
  if (mod === 'signal') {
    if (from === 'signal' || from === 'number') return { ok: true };
    if (from === 'script') return { ok: true, adapter: 'sample' };
    return { ok: false, reason: `${label(from)} cannot drive a time-varying parameter`, suggest: from === 'spans' ? ['spans.kindValue', 'spans.toSignal'] : [] };
  }
  if (from === 'number') return { ok: true };
  return { ok: false, reason: `${label(from)} cannot drive a number parameter`, suggest: from === 'script' || from === 'signal' ? ['an.stat'] : [] };
}

// ---------------------------------------------------------------- signals

/** The sample grid covering [t0, t1] at spacing dt: { i0, n, dt }. */
export function gridFor(range, dt) {
  const i0 = Math.floor(range.t0 / dt);
  const n = Math.max(0, Math.floor(range.t1 / dt) - i0 + 1);
  return { i0, n, dt };
}

export function makeSignal(i0, n, dt, fill = NaN) {
  const v = new Float32Array(Math.max(0, n));
  if (fill !== 0) v.fill(fill);
  return { i0, dt, v };
}

/** Linear between samples; NaN outside the signal or where a needed neighbour is NaN. */
export function signalAt(sig, t) {
  if (!sig || !sig.v) return NaN;
  const x = t / sig.dt - sig.i0;
  const n = sig.v.length;
  if (!(x >= 0) || x > n - 1) return NaN;
  const k = Math.floor(x);
  const f = x - k;
  if (f === 0) return sig.v[k];
  const a = sig.v[k], b = sig.v[k + 1];
  return a + (b - a) * f; // NaN propagates
}

/** A view of `sig` covering [t0, t1] (shares the buffer; values are immutable). */
export function sliceSignal(sig, t0, t1) {
  const n = sig.v.length;
  const k0 = Math.min(n, Math.max(0, Math.floor(t0 / sig.dt) - sig.i0));
  const k1 = Math.min(n, Math.max(k0, Math.ceil(t1 / sig.dt) - sig.i0 + 1));
  if (k0 === 0 && k1 === n) return sig;
  const out = { i0: sig.i0 + k0, dt: sig.dt, v: sig.v.subarray(k0, k1) };
  if (sig.range) out.range = sig.range;
  return out;
}

/** The 'sample' adapter: linear posAt on the grid, NaN outside [first.at, last.at], all-NaN for an empty script. */
export function sampleScript(script, grid) {
  const { i0, n, dt } = grid;
  const sig = makeSignal(i0, n, dt, NaN);
  const m = script.length;
  if (!m) return sig;
  const v = sig.v;
  const first = script[0].at, last = script[m - 1].at;
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = (i0 + k) * dt;
    if (t < first || t > last) continue;
    while (j < m - 1 && script[j + 1].at <= t) j++;
    const a = script[j];
    if (a.at === t || j === m - 1) { v[k] = a.pos; continue; }
    const b = script[j + 1];
    v[k] = a.pos + ((b.pos - a.pos) * (t - a.at)) / (b.at - a.at);
  }
  return sig;
}

/**
 * An irregular series (e.g. tracker samples, `t` sorted ascending ms) resampled onto `grid`, as v*scale+offset.
 * NaN outside the series, where a bracketing source sample is NaN, or where the bracketing gap exceeds maxGapMs.
 */
export function resampleSeries(t, v, grid, { maxGapMs = Infinity, scale = 1, offset = 0 } = {}) {
  const { i0, n, dt } = grid;
  const sig = makeSignal(i0, n, dt, NaN);
  const m = Math.min(t.length, v.length);
  if (!m) return sig;
  const out = sig.v;
  let j = 0;
  for (let k = 0; k < n; k++) {
    const tg = (i0 + k) * dt;
    if (tg < t[0] || tg > t[m - 1]) continue;
    while (j < m - 1 && t[j + 1] <= tg) j++;
    let x;
    if (t[j] === tg || j === m - 1) x = v[j];
    else {
      const gap = t[j + 1] - t[j];
      if (gap > maxGapMs) continue;
      x = v[j] + ((v[j + 1] - v[j]) * (tg - t[j])) / gap;
    }
    out[k] = x * scale + offset; // NaN stays NaN
  }
  return sig;
}

// ---------------------------------------------------------------- scripts

/** Actions with t0 <= at <= t1 plus the nearest action outside on each side (keeps interpolation exact). */
export function clipScript(script, t0, t1) {
  const a = Math.max(0, lowerBound(script, t0) - 1);
  const b = Math.min(script.length, lowerBound(script, t1 + 1) + 1);
  return a === 0 && b === script.length ? script : script.slice(a, b);
}

// ---------------------------------------------------------------- spans

const bySpan = (a, b) => a.t0 - b.t0 || a.t1 - b.t1;
const isPoint = (s) => s.t0 === s.t1;

/** Any list of span-likes -> valid Spans: integer ends, t0 <= t1 (swapped), sorted; non-finite entries dropped. */
export function normSpans(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    let t0 = Math.round(Number(s.t0)), t1 = Math.round(Number(s.t1));
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
    if (t0 > t1) [t0, t1] = [t1, t0];
    out.push(s.t0 === t0 && s.t1 === t1 ? s : { ...s, t0, t1 });
  }
  return out.sort(bySpan); // stable: equal spans keep their input order
}

/**
 * Disjoint spans: where two overlap, the one that starts later owns the overlap (plan semantics); on an equal start
 * the one listed later wins. A span keeps the parts of itself nobody later owns. Points are kept as they are.
 */
export function flattenSpans(spans) {
  const list = normSpans(spans);
  const ivs = [], points = [];
  list.forEach((s, i) => (isPoint(s) ? points.push(s) : ivs.push({ s, i })));
  if (!ivs.length) return list;
  // Sweep over boundaries; the owner of each elementary piece is the covering span with the greatest (t0, index).
  const cuts = [...new Set(ivs.flatMap(({ s }) => [s.t0, s.t1]))].sort((a, b) => a - b);
  const active = [];
  let next = 0;
  const pieces = [];
  for (let c = 0; c < cuts.length - 1; c++) {
    const a = cuts[c], b = cuts[c + 1];
    while (next < ivs.length && ivs[next].s.t0 <= a) active.push(ivs[next++]);
    for (let k = active.length - 1; k >= 0; k--) if (active[k].s.t1 <= a) active.splice(k, 1);
    if (!active.length) continue;
    let own = active[0];
    for (const x of active) if (x.s.t0 > own.s.t0 || (x.s.t0 === own.s.t0 && x.i > own.i)) own = x;
    const last = pieces[pieces.length - 1];
    if (last && last.own === own && last.t1 === a) last.t1 = b;
    else pieces.push({ own, t0: a, t1: b });
  }
  const out = pieces.map(({ own, t0, t1 }) => (own.s.t0 === t0 && own.s.t1 === t1 ? own.s : { ...own.s, t0, t1 }));
  return out.concat(points).sort(bySpan);
}

/** Disjoint union (touching spans merge); a merged span keeps the kind/label of its earliest member. Points inside a span are absorbed. */
export function unionSpans(a, b = []) {
  const list = normSpans([...(a || []), ...(b || [])]);
  const ivs = [];
  for (const s of list) {
    if (isPoint(s)) continue;
    const last = ivs[ivs.length - 1];
    if (last && s.t0 <= last.t1) { if (s.t1 > last.t1) last.t1 = s.t1; } else ivs.push({ ...s });
  }
  const points = [];
  for (const s of list) {
    if (!isPoint(s)) continue;
    if (spanIndexAt(ivs, s.t0) >= 0) continue;
    if (points.length && points[points.length - 1].t0 === s.t0) continue;
    points.push(s);
  }
  return ivs.concat(points).sort(bySpan);
}

/** Disjoint intersection; kind/label (and the other fields) from `a`. Points survive where the other side covers them. */
export function intersectSpans(a, b) {
  const fa = flattenSpans(a), ub = unionSpans(b);
  const ia = fa.filter((s) => !isPoint(s)), ib = ub.filter((s) => !isPoint(s));
  const out = [];
  let j = 0;
  for (const s of ia) {
    while (j < ib.length && ib[j].t1 <= s.t0) j++;
    for (let k = j; k < ib.length && ib[k].t0 < s.t1; k++) {
      const t0 = Math.max(s.t0, ib[k].t0), t1 = Math.min(s.t1, ib[k].t1);
      if (t0 < t1) out.push(t0 === s.t0 && t1 === s.t1 ? s : { ...s, t0, t1 });
    }
  }
  const seen = new Set();
  for (const p of fa) if (isPoint(p) && (spanIndexAt(ib, p.t0) >= 0 || ub.some((q) => isPoint(q) && q.t0 === p.t0))) { out.push(p); seen.add(p.t0); }
  for (const q of ub) {
    if (!isPoint(q) || seen.has(q.t0)) continue;
    const k = spanIndexAt(ia, q.t0);
    if (k >= 0) { out.push({ ...ia[k], t0: q.t0, t1: q.t0 }); seen.add(q.t0); }
  }
  return out.sort(bySpan);
}

/** The gaps inside [t0, t1) not covered by any (non-point) span. */
export function invertSpans(spans, t0, t1) {
  const u = unionSpans(spans).filter((s) => !isPoint(s));
  const out = [];
  let at = t0;
  for (const s of u) {
    if (s.t1 <= at) continue;
    if (s.t0 >= t1) break;
    if (s.t0 > at) out.push({ t0: at, t1: s.t0 });
    at = Math.max(at, s.t1);
  }
  if (at < t1) out.push({ t0: at, t1 });
  return out;
}

// binary search over disjoint, sorted, non-point spans: index of the one containing t, else -1
function spanIndexAt(ivs, t) {
  let lo = 0, hi = ivs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, s = ivs[mid];
    if (t < s.t0) hi = mid - 1; else if (t >= s.t1) lo = mid + 1; else return mid;
  }
  return -1;
}

const flatMemo = new WeakMap();
function flatParts(spans) {
  let f = flatMemo.get(spans);
  if (!f) {
    const flat = flattenSpans(spans);
    f = { ivs: flat.filter((s) => !isPoint(s)), points: flat.filter(isPoint) };
    flatMemo.set(spans, f);
  }
  return f;
}

/** The span at time t on the flattened list (an interval first, else a point exactly at t), or null. */
export function spanAt(spans, t) {
  if (!Array.isArray(spans) || !spans.length) return null;
  const { ivs, points } = flatParts(spans);
  const k = spanIndexAt(ivs, t);
  if (k >= 0) return ivs[k];
  let lo = 0, hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t0 < t) lo = mid + 1; else if (points[mid].t0 > t) hi = mid - 1; else return points[mid];
  }
  return null;
}

/** The `at`s of `script` inside any span ([t0, t1); a point matches at === t0). */
export function spansToAts(script, spans) {
  const out = new Set();
  for (const s of spans || []) {
    let i = lowerBound(script, s.t0);
    if (s.t0 === s.t1) { if (i < script.length && script[i].at === s.t0) out.add(s.t0); continue; }
    for (; i < script.length && script[i].at < s.t1; i++) out.add(script[i].at);
  }
  return out;
}

/** Sorted, de-duplicated points at the given times. */
export function atsToSpans(ats, kind) {
  const ts = [...new Set([...(ats || [])].map((x) => Math.round(x)).filter(Number.isFinite))].sort((a, b) => a - b);
  return ts.map((t) => (kind === undefined ? { t0: t, t1: t } : { t0: t, t1: t, kind }));
}

// ---------------------------------------------------------------- readouts, checks, sizes

/** Time-cursor readout: script -> posAt, signal -> signalAt, spans -> spanAt, number -> value. */
export function valueAt(type, value, t) {
  if (value == null) return null;
  if (type === 'script') return posAt(value, t);
  if (type === 'signal') return signalAt(value, t);
  if (type === 'spans') return spanAt(value, t);
  if (type === 'number') return value;
  return null;
}

const group3 = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
const fmtNum = (x, spread = Math.abs(x)) => (spread < 2 ? String(+x.toFixed(2)) : spread < 20 ? String(+x.toFixed(1)) : String(Math.round(x)));

/** The default card status line of a value. */
export function summarize(type, value) {
  if (value === undefined || value === null) return '—';
  if (type === 'script') {
    if (!value.length) return '0 pts';
    let lo = 100, hi = 0;
    for (const a of value) { if (a.pos < lo) lo = a.pos; if (a.pos > hi) hi = a.pos; }
    return `${group3(value.length)} pts · ${fmtTime(value[0].at)}–${fmtTime(value[value.length - 1].at)} · ${lo}–${hi}`;
  }
  if (type === 'signal') {
    const v = value.v, n = v.length;
    let lo = Infinity, hi = -Infinity, gaps = 0;
    for (let k = 0; k < n; k++) { const x = v[k]; if (x !== x) gaps++; else { if (x < lo) lo = x; if (x > hi) hi = x; } }
    if (!n) return '0 smp';
    if (gaps === n) return `${group3(n)} smp · all gaps`;
    const spread = hi - lo || Math.abs(hi);
    const g = gaps ? ` · ${Math.max(1, Math.round((gaps * 100) / n))}% gaps` : '';
    return `${group3(n)} smp · ${fmtNum(lo, spread)}–${fmtNum(hi, spread)}${g}`;
  }
  if (type === 'spans') {
    const pts = value.filter(isPoint).length;
    const noun = pts === value.length && pts ? (pts === 1 ? 'point' : 'points') : value.length === 1 ? 'span' : 'spans';
    const counts = new Map();
    for (const s of value) if (s.kind != null && s.kind !== '') counts.set(s.kind, (counts.get(s.kind) || 0) + 1);
    const kinds = [...counts].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const shown = kinds.slice(0, 4).map(([k, c]) => `${k} ${c}`).join(', ');
    return `${group3(value.length)} ${noun}${shown ? ' · ' + shown + (kinds.length > 4 ? ', …' : '') : ''}`;
  }
  if (type === 'number') {
    if (typeof value !== 'number') return String(value);
    const a = Math.abs(value);
    return String(+value.toFixed(a >= 1000 ? 0 : a >= 10 ? 1 : 3));
  }
  return String(value);
}

/** '' when `value` is a valid value of `type`, else a reason. Used by the engine on every node output. */
export function checkValue(type, value) {
  if (type === 'script') {
    if (!Array.isArray(value)) return 'expected a script (an array of actions)';
    let prev = -1;
    for (let i = 0; i < value.length; i++) {
      const a = value[i];
      if (!a || !Number.isInteger(a.at) || a.at < 0) return `action ${i} has an invalid time`;
      if (!Number.isInteger(a.pos) || a.pos < 0 || a.pos > 100) return `action ${i} has an invalid position`;
      if (a.at <= prev) return `actions are not strictly increasing in time at ${a.at} ms`;
      prev = a.at;
    }
    return '';
  }
  if (type === 'signal') {
    if (!value || typeof value !== 'object') return 'expected a signal';
    if (!Number.isInteger(value.i0)) return 'signal i0 is not an integer';
    if (!Number.isInteger(value.dt) || value.dt <= 0) return 'signal dt is not a positive integer';
    if (!(value.v instanceof Float32Array)) return 'signal samples are not a Float32Array';
    return '';
  }
  if (type === 'spans') {
    if (!Array.isArray(value)) return 'expected spans (an array)';
    for (let i = 0; i < value.length; i++) {
      const s = value[i];
      if (!s || !Number.isInteger(s.t0) || !Number.isInteger(s.t1)) return `span ${i} has invalid ends`;
      if (s.t0 > s.t1) return `span ${i} ends before it starts`;
      if (i && bySpan(value[i - 1], s) > 0) return `spans are not sorted at span ${i}`;
    }
    return '';
  }
  if (type === 'number') {
    if (typeof value !== 'number') return 'expected a number';
    if (!Number.isFinite(value)) return `the number is not finite (${value})`;
    return '';
  }
  if (type === 'any') {
    for (const t of VALUE_TYPES) if (!checkValue(t, value)) return '';
    return 'not a script, signal, spans or number';
  }
  return `unknown type "${type}"`;
}

/** The concrete type of a value, or null (used to resolve 'any' at run time). */
export function typeOfValue(value) {
  if (typeof value === 'number') return 'number';
  if (value && value.v instanceof Float32Array) return 'signal';
  if (Array.isArray(value)) { const f = value[0]; return f && typeof f === 'object' ? ('at' in f ? 'script' : 't0' in f ? 'spans' : null) : null; }
  return null;
}

/** Cache size estimate in bytes. */
export function bytesOf(type, value) {
  if (value == null) return 0;
  if (type === 'script') return 40 * value.length + 16;
  if (type === 'signal') return 4 * (value.v ? value.v.length : 0) + 32;
  if (type === 'spans') return 64 * value.length + 16;
  if (type === 'number') return 8;
  const t = typeOfValue(value);
  return t ? bytesOf(t, value) : 64;
}

/** Applies an adapter: 'sample' (script -> signal on grid) | 'const' (number -> filled signal on grid). */
export function adapt(adapter, value, grid) {
  if (adapter === 'sample') return sampleScript(value, grid);
  if (adapter === 'const') return makeSignal(grid.i0, grid.n, grid.dt, value);
  return value;
}
