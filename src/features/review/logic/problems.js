// Problem list logic (pure): stable ids, incremental recompute, filter/sort, ignore rules, navigation.
// Problem = { id, axis, severity:'error'|'warn'|'info', kind, t0, t1, ats:int[], message, fix? }
import { lowerBound } from '../../../lib/core/script.js';

export const SEVERITIES = ['error', 'warn', 'info'];
const SEV_ALIAS = { error: 'error', err: 'error', high: 'error', critical: 'error', warning: 'warn', warn: 'warn', medium: 'warn', info: 'info', low: 'info', hint: 'info' };
export const normSeverity = (s) => SEV_ALIAS[String(s ?? '').toLowerCase()] ?? 'warn';
const SEV_RANK = { error: 0, warn: 1, info: 2 };
/** Display name of a problem kind: 'speed-limit' -> 'Speed limit'. One name everywhere (filter, rows, footer tips). */
export const kindLabel = (k) => { const t = String(k ?? '').replaceAll('-', ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

/** Ids derive from axis, kind and start time so they survive edits elsewhere in the script. */
export function normalizeProblems(raw, axis) {
  const seen = new Map(), out = [];
  for (const p of raw) {
    const t0 = Math.round(p.t0 ?? p.ats?.[0] ?? 0), t1 = Math.round(p.t1 ?? t0);
    const base = `${axis}:${p.kind}@${t0}`, n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    // the finder writes 'units/s'; everywhere else in the editor speeds read 'u/s'
    const message = typeof p.message === 'string' ? p.message.replaceAll('units/s', 'u/s') : p.message;
    out.push({ ...p, axis, kind: String(p.kind), message, severity: normSeverity(p.severity), t0, t1: Math.max(t0, t1), ats: p.ats ? [...p.ats] : [t0], id: n ? `${base}#${n}` : base });
  }
  return out.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
}

export function diffProblems(prev, next) {
  const pi = new Set(prev.map((p) => p.id)), ni = new Set(next.map((p) => p.id));
  return { added: next.filter((p) => !pi.has(p.id)), removed: prev.filter((p) => !ni.has(p.id)), kept: next.filter((p) => pi.has(p.id)) };
}

const same = (x, y) => x === y || (x.at === y.at && x.pos === y.pos);

/** Time span covered by differences between two scripts (plus the surviving neighbours), or null if equal. */
export function changedRange(a, b) {
  const n = Math.min(a.length, b.length);
  let p = 0;
  while (p < n && same(a[p], b[p])) p++;
  if (p === a.length && p === b.length) return null;
  let s = 0;
  while (s < n - p && same(a[a.length - 1 - s], b[b.length - 1 - s])) s++;
  const ts = [];
  if (p < a.length - s) ts.push(a[p].at, a[a.length - s - 1].at);
  if (p < b.length - s) ts.push(b[p].at, b[b.length - s - 1].at);
  if (a[p - 1]) ts.push(a[p - 1].at);
  if (a[a.length - s]) ts.push(a[a.length - s].at);
  return [Math.min(...ts), Math.max(...ts)];
}

/** Per-axis problem cache. `find(script, profile, ctx)` returns raw problems; edits recompute only near the change. */
export class ProblemIndex {
  constructor(find, { pad = 5000, fullFraction = 0.35, minPartial = 2000 } = {}) {
    Object.assign(this, { find, pad, fullFraction, minPartial });
    this.cache = new Map();
    this.stats = { full: 0, partial: 0 };
  }
  clear(axis) { axis == null ? this.cache.clear() : this.cache.delete(axis); }
  update(axis, script, profile, key, ctx) {
    const c = this.cache.get(axis);
    if (c && c.script === script && c.key === key) return c.problems;
    let problems = null;
    if (c && c.key === key && script.length >= this.minPartial) {
      const r = changedRange(c.script, script);
      if (!r) problems = c.problems;
      else {
        const W0 = r[0] - this.pad, W1 = r[1] + this.pad;
        const first = script[0].at, last = script[script.length - 1].at;
        if (W0 > first && W1 < last && W1 - W0 < this.fullFraction * (last - first)) {
          const i0 = Math.max(0, lowerBound(script, W0 - this.pad) - 1), i1 = Math.min(script.length, lowerBound(script, W1 + this.pad + 1) + 1);
          const slice = script.slice(i0, i1), s0 = slice[0].at, s1 = slice[slice.length - 1].at;
          const fresh = normalizeProblems(this.find(slice, profile, ctx), axis).filter((p) => p.t1 >= W0 && p.t0 <= W1 && p.t0 >= s0 && p.t1 <= s1);
          const kept = c.problems.filter((p) => p.t1 < W0 || p.t0 > W1);
          problems = normalizeProblems([...kept, ...fresh], axis);
          this.stats.partial++;
        }
      }
    }
    if (!problems) { problems = normalizeProblems(this.find(script, profile, ctx), axis); this.stats.full++; }
    this.cache.set(axis, { script, key, problems });
    return problems;
  }
}

// ---- ignore rules: { ids: string[], kinds: string[] } (kept in the project) ----
export const emptyIgnore = () => ({ ids: [], kinds: [] });
export const isIgnored = (p, r) => !!r && (r.ids.includes(p.id) || r.kinds.includes(p.kind) || r.kinds.includes(`${p.axis}:${p.kind}`));
const toggled = (list, v, on) => (on ? (list.includes(v) ? list : [...list, v]) : list.filter((x) => x !== v));
export const ignoreId = (r, id, on = true) => ({ ...r, ids: toggled(r.ids, id, on) });
export const ignoreKind = (r, kind, on = true) => ({ ...r, kinds: toggled(r.kinds, kind, on) });
/** Drop ignored ids that no longer exist so the project file does not grow forever. */
export function pruneIgnore(r, problems) {
  const live = new Set(problems.map((p) => p.id));
  return r.ids.every((i) => live.has(i)) ? r : { ...r, ids: r.ids.filter((i) => live.has(i)) };
}

// ---- filter / sort ----
export const defaultFilter = () => ({ severities: [...SEVERITIES], kinds: [], q: '', showIgnored: false, sort: 'time', dir: 1 });

export function filterProblems(list, f, ignore) {
  const q = (f.q ?? '').trim().toLowerCase(), sev = new Set(f.severities), kinds = f.kinds?.length ? new Set(f.kinds) : null;
  return list.filter((p) => sev.has(p.severity) && (!kinds || kinds.has(p.kind)) && (f.showIgnored || !isIgnored(p, ignore)) &&
    (!q || p.message?.toLowerCase().includes(q) || p.kind.toLowerCase().includes(q) || kindLabel(p.kind).toLowerCase().includes(q) || p.axis.toLowerCase().includes(q)));
}

const CMP = {
  time: (a, b) => a.t0 - b.t0,
  severity: (a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.t0 - b.t0,
  kind: (a, b) => a.kind.localeCompare(b.kind) || a.t0 - b.t0,
  length: (a, b) => (b.t1 - b.t0) - (a.t1 - a.t0) || a.t0 - b.t0,
};
export const sortProblems = (list, sort = 'time', dir = 1) => [...list].sort((a, b) => dir * (CMP[sort] ?? CMP.time)(a, b));

export function countBy(list, ignore) {
  const out = { total: 0, error: 0, warn: 0, info: 0, kinds: {} };
  for (const p of list) {
    if (isIgnored(p, ignore)) continue;
    out.total++; out[p.severity]++; out.kinds[p.kind] = (out.kinds[p.kind] ?? 0) + 1;
  }
  return out;
}

/** Next (dir=1) or previous (dir=-1) problem relative to time t, wrapping. `list` must be sorted by time. */
export function neighbour(list, t, dir = 1, eps = 1) {
  if (!list.length) return null;
  if (dir > 0) return list.find((p) => p.t0 > t + eps) ?? list[0];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].t0 < t - eps) return list[i];
  return list[list.length - 1];
}
