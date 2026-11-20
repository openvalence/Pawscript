// run-ranges.js -- which run plays where (paw-1ysd). Pure.
//
// A run range = {id, run, t0, t1, layer} ("run `run` plays over [t0, t1)"). The document holds them (doc.runRanges: undoable,
// saved in the .pawproj extra `runRanges`, in checkpoints / commits); null = a project from before ranges: the ranges are
// derived from the shots' links (fromLinks), exactly what played then, and written at the first range edit. On one layer
// ranges never overlap: putting one over another trims or splits it (its run and data stay: nothing is discarded by being
// covered). `layer` is 0 today (overlapping layers mixed together is not built; the field keeps room for it). Time with no
// range plays no run: the baked points, the fills, or nothing, as an untracked span.

let seq = 0;
const newId = () => `rr${Date.now().toString(36)}${(seq++).toString(36)}`;
const ok = (r) => r && typeof r.run === 'string' && Number.isFinite(r.t0) && Number.isFinite(r.t1) && r.t1 > r.t0;

/** Clean a stored list: valid entries, integer ms, layer 0 by default, sorted; overlaps on a layer resolved by order (later wins). */
export function normRanges(list) {
  if (!Array.isArray(list)) return null;
  let out = [];
  for (const r of list) if (ok(r)) out = putRange(out, { id: typeof r.id === 'string' ? r.id : newId(), run: r.run, t0: Math.round(r.t0), t1: Math.round(r.t1), layer: r.layer | 0 });
  return out;
}

/** Ranges from the shots' links (a project before ranges): per shot its linked run over the shot, neighbours of one run merged. */
export function fromLinks(shots, runOf) {
  const out = [];
  (shots || []).forEach((s, i) => {
    const run = runOf(i);
    if (!run || !(s.end_ms > s.start_ms)) return;
    const last = out[out.length - 1];
    if (last && last.run === run && last.t1 === s.start_ms) last.t1 = s.end_ms;
    else out.push({ id: `rr-${s.start_ms}`, run, t0: s.start_ms, t1: s.end_ms, layer: 0 });
  });
  return out;
}

/** list with r put in on its layer: the ranges it covers are trimmed or split (pieces keep their run, get new ids). Sorted. */
export function putRange(list, r) {
  const L = r.layer | 0, out = [];
  for (const x of list || []) {
    if ((x.layer | 0) !== L || x.t1 <= r.t0 || x.t0 >= r.t1 || x.id === r.id) { if (x.id !== r.id) out.push(x); continue; }
    if (x.t0 < r.t0) out.push({ ...x, t1: r.t0 });
    if (x.t1 > r.t1) out.push({ ...x, id: x.t0 < r.t0 ? newId() : x.id, t0: r.t1 });
  }
  out.push({ layer: 0, ...r, id: r.id || newId() });
  return out.sort((a, b) => (a.layer | 0) - (b.layer | 0) || a.t0 - b.t0);
}

/** The range playing at t (layer 0), else null. */
export const rangeAt = (list, t) => (list || []).find((r) => !(r.layer | 0) && t >= r.t0 && t < r.t1) || null;
/** The ranges overlapping [t0, t1) (layer 0), clipped to it: [{...range, a, b}]. */
export const rangesIn = (list, t0, t1) => (list || []).filter((r) => !(r.layer | 0) && r.t1 > t0 && r.t0 < t1).map((r) => ({ ...r, a: Math.max(t0, r.t0), b: Math.min(t1, r.t1) }));
/** Run `run` plays all of [t0, t1) (layer 0: its pieces end to end, nothing else). No range there is not playing (paw-uzlr). */
export function playsAll(list, run, t0, t1) {
  let t = t0;
  for (const r of rangesIn(list, t0, t1)) { if (r.run !== run || r.a !== t) return false; t = r.b; }
  return t >= t1;
}

/** One end of range id moved to t (end 0 = start, 1 = end), clamped to [lo, hi] (its run's tracked extent) and to at least
 *  minMs long; growing over a neighbour trims it. -> list (the same array when nothing changes). */
export function moveEnd(list, id, end, t, { lo = -Infinity, hi = Infinity, minMs = 1 } = {}) {
  const r = (list || []).find((x) => x.id === id);
  if (!r) return list;
  const v = Math.round(Math.max(lo, Math.min(hi, t)));
  const n = end ? { ...r, t1: Math.max(r.t0 + minMs, v) } : { ...r, t0: Math.min(r.t1 - minMs, v) };
  if (n.t0 === r.t0 && n.t1 === r.t1) return list;
  return putRange(list, n);
}
/** list without range id. */
export const removeRange = (list, id) => (list || []).filter((r) => r.id !== id);
/** Ranges whose run is gone (no ghost) left out: what plays. */
export const liveRanges = (list, has) => (list || []).filter((r) => has(r.run));
