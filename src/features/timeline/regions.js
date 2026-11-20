// regions.js -- action regions (paw-2lp7.2: stage 1 of the owner's "scenes go away completely, you have cuts and shots and
// camera moves, and action regions"). Pure. app.doc.acts is a list of regions, free of cuts:
//   {id, kind, t0, t1, layer, tags, mix?, range?, tease?, auto?, roles?}
// kind: 'act' (an action: tags = its where / what ids, acts.js; one action per region, a combined act the vocabulary treats as
// one, e.g. oral + penetration, stays one), 'positioning' (characters moving into / changing position: paw-2lp7.1: still tracked, kept out of every range / level calibration, the script eases through it: withPositioning),
// and the no-action kinds the owner marks: 'intro', 'idle', 'after', 'outro', 'rest' (a breather inside the session).
// layer: 0 = the main line (the primary driver), 1, 2 ... = secondary actions drawn above; regions on one layer never overlap
// (the later edit wins, trimming the other), different layers overlap freely. mix (layer > 0 only, default 'mix'): 'mix' |
// 'layer' | 'ignore' (the owner's pick after tracking). range / tease (the depth band settings) are read from layer 0.
// Times: ms on frame starts, like the modifiers (state.svelte.js edgesToFrames snaps them with the cuts).
// paw-2lp7.5 (stage 2): 'positioning' has a lane of its own (stored on layer 0): it overlaps any action and only trims other
// positioning ranges; a proposal (auto: true: the dev command, the stage-3 detector) is drawn but not projected until accepted.
//
// THE SHIM (project / syncActs; app/doc.svelte.js runs them on every write): every reader still reads the shots
// (app.doc.scenes) with their scene facts, now projected from the regions:
//   covering  the layer-0 region holding a shot's middle covers that shot (whole-shot facts); a region over part of a shot
//             only reaches it as a span (layer >= 1, below)
//   join      consecutive shots under the same layer-0 region are one scene; a camera split (same take) stays joined
//   tags      a run's act tags = its layer-0 region's (bare: the whole run) + every layer >= 1 'act' region over it that is not
//             mix 'ignore' (bare where it covers the whole run, else an {id, t0, t1} span clipped to the run: the readers that
//             honour spans inside a scene see its edges); written as a diff against the run's describe, so a run with no region
//             has no act tag at all (the describe's are removed: "no action is actionless")
//   structure intro / idle / after / outro from the layer-0 region's kind; 'rest' is written as 'idle' (stage 1: a breather
//             reads as idle everywhere); a removed derived structure ('-intro') stays on the shots as written
//   range / tease  from the run's layer-0 region
// The other way, an old writer (a scene command, Detect scenes, Describe) still writes the shots: syncActs compares each
// scene run it wrote with what the regions project there and rebuilds the regions of every run that differs from the facts
// written (liftRun), reusing the id / kind / mix of a region at the same place; the shots keep exactly what was written.
// So every scene command edits regions underneath, and loading a project without regions is the same step from none.
import { TAG, sceneTags, tagSpansIn, tagsOf, toggleTag, actText, WHERE_WHATS } from './acts.js';
import { normScenes, sceneRuns, isActTag } from './shots.js';

export const KINDS = ['act', 'positioning', 'intro', 'idle', 'after', 'outro', 'rest'];
export const MIXES = ['mix', 'layer', 'ignore'];
/** The structure tag each no-action kind is projected as. */
export const STRUCT = { intro: 'intro', idle: 'idle', after: 'after', outro: 'outro', rest: 'idle' };
const J = (v) => JSON.stringify(v ?? null);
const isWW = (id) => TAG[id]?.cat === 'where' || TAG[id]?.cat === 'what';
const ORDER = Object.fromEntries(Object.keys(TAG).map((id, i) => [id, i]));
let seq = 0;
/** A fresh region id. */
export const newActId = () => `ar${Date.now().toString(36)}${(seq++).toString(36)}`;

// ---- the stored list ----
/** A clean region (kind known, t0 < t1, integer layer >= 0, tags only where / what ids on an 'act'), or null. */
function clean(r) {
  if (!r || !KINDS.includes(r.kind) || !Number.isFinite(r.t0) || !Number.isFinite(r.t1) || !(r.t1 > r.t0)) return null;
  const layer = r.kind === 'positioning' ? 0 : Math.max(0, Math.round(+r.layer || 0));
  const o = { id: typeof r.id === 'string' ? r.id : '', kind: r.kind, t0: r.t0, t1: r.t1, layer, tags: r.kind === 'act' && Array.isArray(r.tags) ? [...new Set(r.tags.filter(isWW))] : [] };
  if (layer > 0) o.mix = MIXES.includes(r.mix) ? r.mix : 'mix';
  for (const k of ['range', 'tease']) if (r[k] !== undefined) o[k] = r[k];
  if (r.auto !== undefined && r.auto !== false) o.auto = r.auto;
  o.roles = Array.isArray(r.roles) ? r.roles : [];
  return o;
}
/** Region r without [a, b): 0, 1 or 2 pieces (the second piece of a split gets a new id). */
function cutOut(r, a, b) {
  if (r.t1 <= a || r.t0 >= b) return [r];
  const out = [];
  if (r.t0 < a) out.push({ ...r, t1: a });
  if (r.t1 > b) out.push({ ...r, t0: b, id: out.length ? newActId() : r.id });
  return out;
}
/** Do a and b share a lane (positioning ranges have their own; the rest by layer)? */
const sameLane = (a, b) => (a.kind === 'positioning') === (b.kind === 'positioning') && a.layer === b.layer;
/** list with r placed: the regions in r's lane that overlap it are trimmed (r wins). */
const place = (list, r) => [...list.flatMap((x) => (sameLane(x, r) && x.id !== r.id ? cutOut(x, r.t0, r.t1) : x.id === r.id ? [] : [x])), r];
/** paw-2lp7.9: the layers above the main line renumbered 1, 2 ... in their order, closing any layer left empty (document-wide;
 *  the main line stays layer 0, empty or not: nothing is promoted onto it; no region is packed onto a lower layer in use). */
const compact = (list) => {
  const to = new Map([...new Set(list.map((r) => r.layer).filter((n) => n > 0))].sort((a, b) => a - b).map((n, i) => [n, i + 1]));
  return list.map((r) => (r.layer > 0 && to.get(r.layer) !== r.layer ? { ...r, layer: to.get(r.layer) } : r));
};
const sortActs = (list) => compact(list).sort((a, b) => a.layer - b.layer || (a.kind === 'positioning') - (b.kind === 'positioning') || a.t0 - b.t0);
/** The regions cleaned, ids unique, overlaps on a layer resolved (a later entry wins), empty layers closed, sorted by layer then time. The
 *  same list when it is already that. */
export function normActs(list) {
  if (!Array.isArray(list)) return [];
  let out = [];
  const ids = new Set();
  for (const x of list) {
    const r = clean(x);
    if (!r) continue;
    if (!r.id || ids.has(r.id)) r.id = newActId();
    ids.add(r.id);
    out = place(out, r);
  }
  out = sortActs(out);
  return J(out) === J(list) ? list : out;
}

// ---- reading ----
const byLayer = (a, b) => a.layer - b.layer || a.t0 - b.t0;
/** The regions overlapping [t0, t1), layer 0 first, each with `cover` = the share of the span it covers (0..1]. */
export function actsOver(acts, t0, t1) {
  const n = t1 - t0;
  return (acts || []).filter((r) => r.t1 > t0 && r.t0 < t1).sort(byLayer).map((r) => ({ ...r, cover: n > 0 ? (Math.min(r.t1, t1) - Math.max(r.t0, t0)) / n : 1 }));
}
/** The regions at time t (t0 <= t < t1), layer 0 first. */
export const actsAt = (acts, t) => (acts || []).filter((r) => t >= r.t0 && t < r.t1).sort(byLayer);

// ---- edits (each -> the new list | null when it changes nothing or is refused; the caller makes it one undo step) ----
const find = (acts, id) => (acts || []).find((r) => r.id === id);
const put = (acts, r) => { const c = clean(r); return c ? sortActs(place((acts || []).filter((x) => x.id !== c.id), c)) : null; };
/** Add region r (an id is made when it has none); the regions on its layer under it are trimmed. */
export const addRegion = (acts, r) => put(acts, { ...r, id: r?.id || newActId() });
/** Move region id by dt ms (it wins over its layer where it lands). */
export const moveRegion = (acts, id, dt) => { const r = find(acts, id); return r && dt ? put(acts, { ...r, t0: r.t0 + dt, t1: r.t1 + dt }) : null; };
/** Region id over [t0, t1) (t0 < t1). */
export const resizeRegion = (acts, id, t0, t1) => { const r = find(acts, id); return r && t1 > t0 && (r.t0 !== t0 || r.t1 !== t1) ? put(acts, { ...r, t0, t1 }) : null; };
/** Region id split at t into two (the second a new id, the same facts). */
export function splitRegionAt(acts, id, t) {
  const r = find(acts, id);
  if (!r || !(t > r.t0 && t < r.t1)) return null;
  return sortActs([...acts.filter((x) => x !== r), { ...r, t1: t }, { ...r, t0: t, id: newActId() }]);
}
/** Without region id. */
export const deleteRegion = (acts, id) => (find(acts, id) ? sortActs(acts.filter((r) => r.id !== id)) : null);
/** paw-2lp7.9: the highest layer region id may go to (a new region: no id): one above the layers in use, not counting id's own
 *  layer when it is alone there (leaving it closes that layer). The owner: "if one layer allow 2 if 2 allow 3". */
export function layerCap(acts, id) {
  const a = (acts || []).filter((x) => x.kind !== 'positioning'), r = id == null ? null : a.find((x) => x.id === id);
  return a.reduce((n, x) => Math.max(n, x.layer), 0) + (r && r.layer > 0 && !a.some((x) => x !== r && x.layer === r.layer) ? 0 : 1);
}
/** Region id on layer n (at most layerCap; it wins there; a mix of 'mix' when it becomes a secondary one, none on the main line). */
export function setRegionLayer(acts, id, n) {
  const r = find(acts, id), layer = Math.min(layerCap(acts, id), Math.max(0, Math.round(+n || 0)));
  if (!r || r.layer === layer) return null;
  const { mix: _, ...x } = r;   // eslint-disable-line no-unused-vars
  return put(acts, { ...x, layer });
}

/** paw-2lp7.5, a region dragged (the Actions strip): moved by dt ms and onto layer n in one step. What lay under it on layer n
 *  swaps to the layer it came from (only the part it covered; owner: "if a handjob is the primary driver it goes on the main
 *  line"); on its own layer it wins as everywhere. n is held to layerCap (paw-2lp7.9). A positioning range only moves in
 *  time. -> acts | null (no change) */
export function moveToLayer(acts, id, n, dt = 0) {
  const r = find(acts, id), layer = r?.kind === 'positioning' ? 0 : Math.min(layerCap(acts, id), Math.max(0, Math.round(+n || 0)));
  if (!r || (layer === r.layer && !dt)) return null;
  const t0 = r.t0 + dt, t1 = r.t1 + dt;
  let out = acts.filter((x) => x !== r);
  if (layer !== r.layer) {
    for (const u of out.filter((x) => x.layer === layer && x.kind !== 'positioning' && x.t0 < t1 && x.t1 > t0)) {
      const full = u.t0 >= t0 && u.t1 <= t1, { mix: _, ...v } = u;   // eslint-disable-line no-unused-vars
      out = [...out.filter((x) => x !== u), ...cutOut(u, t0, t1)];
      out = place(out, clean({ ...v, t0: Math.max(u.t0, t0), t1: Math.min(u.t1, t1), layer: r.layer, id: full ? u.id : newActId(), ...(r.layer > 0 ? { mix: r.mix } : {}) }));
    }
  }
  const { mix: m, ...x } = r;
  return put(out, { ...x, t0, t1, layer, ...(layer > 0 ? { mix: r.layer > 0 ? m : 'mix' } : {}) });
}
/** paw-2lp7.5: tags = where / what ids (one action); none = an untagged region. */
export function setRegionTags(acts, id, tags) {
  const r = find(acts, id), t = [...new Set((tags || []).filter(isWW))].sort((a, b) => ORDER[a] - ORDER[b]);
  return r && r.kind === 'act' && J(t) !== J(r.tags) ? put(acts, { ...r, tags: t }) : null;
}
/** A secondary region's mix: 'mix' | 'layer' | 'ignore' (the main line has none). */
export const setRegionMix = (acts, id, mix) => { const r = find(acts, id); return r && r.layer > 0 && MIXES.includes(mix) && r.mix !== mix ? put(acts, { ...r, mix }) : null; };
/** The region as another kind (a no-action kind drops its tags; out of the positioning lane it takes the lowest layer free
 *  over it, so it never cuts the action it sat over). */
export function setRegionKind(acts, id, kind) {
  const r = find(acts, id);
  if (!r || !KINDS.includes(kind) || r.kind === kind) return null;
  let layer = r.layer;
  if (r.kind === 'positioning') { layer = 0; while (acts.some((x) => x !== r && x.kind !== 'positioning' && x.layer === layer && x.t0 < r.t1 && x.t1 > r.t0)) layer++; }
  return put(acts, { ...r, kind, layer, tags: kind === 'act' ? r.tags : [] });
}
/** The tags with where / what `id` (a tag or an alias: acts.js toggleTag; knotting brings penetration ...) toggled. */
export const toggleRegionTag = (tags, id) => sceneTags({ tags: toggleTag({ tags: [...(tags || [])] }, id) }).filter(isWW);
/** A region's words: its action ('anal penetration'), 'untagged', or its kind ('rest', 'positioning'). */
export const regionWords = (r) => (!r ? '' : r.kind === 'act' ? actText({ tags: r.tags }) || 'untagged' : r.kind);
const plain = (r) => { const { auto: _, ...x } = r; return x; };   // eslint-disable-line no-unused-vars
/** The proposal accepted (auto cleared). */
export const acceptRegion = (acts, id) => { const r = find(acts, id); return r?.auto ? put(acts, plain(r)) : null; };
/** Every proposal accepted (null: none). */
export const acceptAll = (acts) => ((acts || []).some((r) => r.auto) ? normActs(acts.map((r) => (r.auto ? plain(r) : r))) : null);
/** Region id merged with its neighbour in its lane (the next one there, dir 1; the one before, -1; 0: right, else left) when
 *  that one is the same action (kind and tags): one region over both and the gap between. */
export function mergeRegion(acts, id, dir = 0) {
  const r = find(acts, id);
  if (!r) return null;
  const lane = acts.filter((x) => sameLane(x, r)).sort((a, b) => a.t0 - b.t0), i = lane.indexOf(r);
  const same = (x) => !!x && x.kind === r.kind && J(x.tags) === J(r.tags);
  const n = (dir >= 0 && same(lane[i + 1]) ? lane[i + 1] : null) ?? (dir <= 0 && same(lane[i - 1]) ? lane[i - 1] : null);
  return n ? put(acts.filter((x) => x !== n), { ...r, t0: Math.min(r.t0, n.t0), t1: Math.max(r.t1, n.t1) }) : null;
}
/** Every neighbouring pair in a lane that is the same action merged (the old "group shots into scenes"); null: none. */
export function mergeAllSame(acts) {
  let out = acts, did = false;
  for (let again = true; again;) {
    again = false;
    for (const r of out) { const m = mergeRegion(out, r.id, 1); if (m) { out = m; did = again = true; break; } }
  }
  return did ? out : null;
}
/** Every region edge at cut time a moved with the cut to b (a cut dragged / nudged); null when none sits there. */
export function followCut(acts, a, b) {
  if (!(Math.abs(a - b) >= 0.5) || !(acts || []).some((r) => Math.abs(r.t0 - a) < 0.5 || Math.abs(r.t1 - a) < 0.5)) return null;
  const out = acts.map((r) => { const t0 = Math.abs(r.t0 - a) < 0.5 ? b : r.t0, t1 = Math.abs(r.t1 - a) < 0.5 ? b : r.t1; return t0 === r.t0 && t1 === r.t1 ? r : { ...r, t0, t1 }; });
  return out.some((r) => !(r.t1 > r.t0)) ? null : normActs(out);
}
/** paw-2lp7.5: a same-footage / crop offer taken (repeat-offers.svelte.js) = the action at shot a (the one starting at ta)
 *  extended across to the end of shot b (starting at tb): its main-line region grows to there (what lay between on the main
 *  line gives way), or an untagged one is made over a..b when none is at a. The shots between join it through the shim, so
 *  the proposed cutaways between show as before. -> (acts, shots) => acts | null */
export const extendTo = (ta, tb) => (acts, list) => {
  const a = list.find((s) => Math.abs(s.start_ms - ta) < 1), b = list.find((s) => Math.abs(s.start_ms - tb) < 1);
  if (!a || !b || b.end_ms <= a.start_ms) return null;
  const m = (a.start_ms + a.end_ms) / 2, r = baseOf(acts).find((x) => x.t0 <= m && m < x.t1);
  if (r) return r.t1 >= b.end_ms ? null : resizeRegion(acts, r.id, r.t0, b.end_ms);
  return addRegion(acts || [], { kind: 'act', t0: a.start_ms, t1: b.end_ms, layer: 0, tags: [] });
};
/** The stretches of [0, dur) no main-line region covers (positioning does not count; a proposal does): [{t0, t1}], each
 *  longer than `min` ms. */
export function gapsOf(acts, dur, min = 1) {
  const out = [];
  let t = 0;
  for (const r of baseOf(acts, true).sort((a, b) => a.t0 - b.t0)) { if (r.t0 - t > min) out.push({ t0: t, t1: r.t0 }); t = Math.max(t, r.t1); }
  if (dur - t > min) out.push({ t0: t, t1: dur });
  return out;
}
/** The simple proposal (the design study's rule, until the stage-3 detector): runs of neighbouring shots whose described
 *  acts (the tagger's where / what) are the same and not none, each one region (the main action on layer 0, any other
 *  action above it), all auto: true; only where no main-line region is (the gaps), earlier proposals replaced. null: none. */
export function proposeFromShots(shots, acts) {
  const keep = (acts || []).filter((r) => !r.auto), out = [], runs = [];
  const key = (s) => J(tagsOf(s.describe).filter(isWW).sort());
  (shots || []).forEach((s, i) => { const k = key(s); if (k === '[]') return; const p = runs.at(-1); if (p && p.k === k && p.hi === i - 1) p.hi = i; else runs.push({ k, lo: i, hi: i }); });
  const gaps = gapsOf(keep, Infinity, 0);
  for (const { k, lo, hi } of runs) {
    const [main, ...more] = splitActs(JSON.parse(k));
    for (const g of gaps) {
      const t0 = Math.max(g.t0, shots[lo].start_ms), t1 = Math.min(g.t1, shots[hi].end_ms);
      if (!(t1 > t0) || !shots.some((s, i) => i >= lo && i <= hi && mid(s) >= t0 && mid(s) < t1)) continue;   // a sliver: no shot's middle in it
      out.push({ kind: 'act', t0, t1, layer: 0, tags: main, auto: true });
      for (const tags of more) {
        let n = 1;
        while ([...keep, ...out].some((r) => r.layer === n && r.kind !== 'positioning' && r.t0 < t1 && r.t1 > t0)) n++;
        out.push({ kind: 'act', t0, t1, layer: n, tags, mix: 'mix', auto: true });
      }
    }
  }
  return out.length || keep.length !== (acts || []).length ? normActs([...keep, ...out]) : null;
}

// ---- the shim: regions -> the shots' scene facts ----
const mid = (s) => (s.start_ms + s.end_ms) / 2;
/** The main-line regions the shots read (a proposal too with `auto`: the gaps list counts it). */
const baseOf = (acts, auto = false) => (acts || []).filter((r) => r.layer === 0 && r.kind !== 'positioning' && (auto || !r.auto));
const idOf = (e) => String((typeof e === 'string' ? e : e?.id) ?? '');
/** Tag entries the regions own: where / what (added, or a describe's removed), a structure tag set. */
const owned = (e) => { const id = idOf(e), c = TAG[id.replace(/^-/, '')]?.cat; return c === 'where' || c === 'what' || (c === 'structure' && id[0] !== '-'); };
const regionIds = (r) => (r.kind === 'act' ? r.tags : STRUCT[r.kind] ? [STRUCT[r.kind]] : []);
/** Does the region feed the shots' tags as a secondary (layer >= 1) one? */
const secondary = (r) => r.layer > 0 && r.kind === 'act' && r.mix !== 'ignore' && !r.auto;
/** Is the region read by the projection at all (a layer-0 one, or a secondary one)? */
const projected = (r) => (r.layer === 0 && r.kind !== 'positioning' && !r.auto) || secondary(r);
const sameFacts = (a, b) => J(a.tags) === J(b.tags) && J(a.range) === J(b.range) && J(a.tease) === J(b.tease) && (a.join ?? null) === (b.join ?? null);

/** The shots with their scene facts (join, act tags, range, tease) projected from the regions; every other field as it was.
 *  Not normalised (projectScenes); the same list when nothing changes. */
export function project(L, acts) {
  if (!Array.isArray(L) || !L.length) return L;
  acts = acts || [];
  const base = baseOf(acts), cov = L.map((s) => { const m = mid(s); return base.find((r) => r.t0 <= m && m < r.t1) ?? null; });
  const joined = L.map((s, i) => i > 0 && (s.split === 'camera' || (!!cov[i] && cov[i] === cov[i - 1])));
  const runs = [];
  joined.forEach((j, i) => { if (j) runs[runs.length - 1][1] = i; else runs.push([i, i]); });
  let out = null;
  for (const [lo, hi] of runs) {
    const t0 = L[lo].start_ms, t1 = L[hi].end_ms, ent = new Map();   // id -> true (the whole run) | [spans]
    for (let k = lo; k <= hi; k++) if (cov[k]) for (const id of regionIds(cov[k])) ent.set(id, true);
    for (const r of acts) {
      if (!secondary(r) || r.t1 <= t0 || r.t0 >= t1) continue;
      for (const id of r.tags) {
        if (r.t0 <= t0 && r.t1 >= t1) ent.set(id, true);
        else if (ent.get(id) !== true) ent.set(id, [...(ent.get(id) || []), { id, t0: Math.max(t0, r.t0), t1: Math.min(t1, r.t1) }]);
      }
    }
    const tags = [...ent].sort(([a], [b]) => ORDER[a] - ORDER[b]).flatMap(([id, v]) => (v === true ? [id] : v.sort((x, y) => x.t0 - y.t0)));
    const sd = hi > lo ? L.slice(lo, hi + 1).find((s) => s.describe)?.describe : L[lo].describe;
    for (const a of tagsOf(sd)) if (isWW(a) && !ent.has(a)) tags.push('-' + a);   // the describe's acts no region has
    const keep = (L[lo].tags || []).filter((e) => isActTag(e) && !owned(e));   // the run's own: a removed derived structure, modifier spans
    const b = cov[lo] ?? cov.slice(lo, hi + 1).find(Boolean);
    for (let k = lo; k <= hi; k++) {
      const s = L[k], n = { ...s }, nt = [...tags, ...keep, ...(s.tags || []).filter((e) => !isActTag(e))];
      if (nt.length) n.tags = nt; else delete n.tags;
      for (const key of ['range', 'tease']) { if (b?.[key] !== undefined) n[key] = b[key]; else delete n[key]; }
      if (joined[k]) n.join = true; else if (s.join !== undefined && (k > 0 || s.join === false)) n.join = false; else delete n.join;   // a region split = the owner's
      if (!sameFacts(s, n)) { if (!out) out = L.slice(); out[k] = n; }
    }
  }
  return out || L;
}
/** project, then normalised (shots.js normScenes: a newly joined run's other facts agree, the later ones offered). */
export function projectScenes(L, acts) {
  const p = project(L, acts);
  return p === L ? L : normScenes(p);
}

// ---- the shim: the shots -> regions ----
/** What the readers see of a run's region-owned facts (where / what with their spans, the structure set, range, tease). */
function runKey(L, lo, hi) {
  const { structure: _, ...s } = { ...L[lo], end_ms: L[hi].end_ms };   // eslint-disable-line no-unused-vars
  const ww = sceneTags(s).filter(isWW).map((id) => [id, tagSpansIn(s, id).map((x) => [x.t0, x.t1])]);
  const st = [...new Set((L[lo].tags || []).filter((e) => owned(e) && TAG[idOf(e)]?.cat === 'structure').map(idOf))].sort();
  return J([ww, st, L[lo].range, L[lo].tease]);
}
/** The runs of A that B does not reproduce (another run there, or other facts). */
function dirtyRuns(A, B) {
  const rb = new Map(sceneRuns(B));
  return sceneRuns(A).filter(([lo, hi]) => rb.get(lo) !== hi || runKey(A, lo, hi) !== runKey(B, lo, hi));
}
/** A tag set as actions (one region each): the wheres with the whats that happen in one (penetration, licking, fingering ...)
 *  are one action; every other what (handjob, grinding, exposed ...) its own. First = the main one. */
export function splitActs(ids) {
  const inWhere = ids.filter((id) => TAG[id]?.cat === 'where' || WHERE_WHATS.has(id) || TAG[id]?.needsWhere);
  return [...(inWhere.length ? [inWhere] : []), ...ids.filter((id) => !inWhere.includes(id)).map((id) => [id])];
}
/** The regions that give shots [lo, hi] (one scene run) exactly its facts: the main action (or its structure kind) on layer 0
 *  over the run with its range / tease (an empty 'act' one holds a multi-shot run, or a band, with no act); the other
 *  actions over the run on layers 1, 2 ...; each part-of-the-run tag span its own region on the lowest free layer >= 1. */
export function liftRun(L, lo, hi) {
  const t0 = L[lo].start_ms, t1 = L[hi].end_ms, { structure: _, ...s } = { ...L[lo], end_ms: t1 };   // eslint-disable-line no-unused-vars
  const whole = [], part = new Map();
  for (const id of sceneTags(s).filter(isWW)) for (const x of tagSpansIn(s, id)) {
    if (x.t0 <= t0 && x.t1 >= t1) whole.push(id);
    else part.set(J([x.t0, x.t1]), [...(part.get(J([x.t0, x.t1])) || []), id]);
  }
  const st = (L[lo].tags || []).filter((e) => owned(e) && TAG[idOf(e)]?.cat === 'structure').map(idOf).sort((a, b) => ORDER[a] - ORDER[b])[0];
  const out = [], acts = splitActs(whole), band = {};
  for (const k of ['range', 'tease']) if (L[lo][k] !== undefined) band[k] = L[lo][k];
  if (st) out.push({ kind: st, t0, t1, layer: 0, tags: [], ...band });
  else if (acts.length || hi > lo || Object.keys(band).length) out.push({ kind: 'act', t0, t1, layer: 0, tags: acts.shift() ?? [], ...band });
  const free = (a, b) => { let n = 1; while (out.some((r) => r.layer === n && r.t0 < b && r.t1 > a)) n++; return n; };
  for (const g of acts) out.push({ kind: 'act', t0, t1, layer: free(t0, t1), tags: g, mix: 'mix' });
  for (const [k, ids] of part) { const [a, b] = JSON.parse(k); for (const g of splitActs(ids)) out.push({ kind: 'act', t0: a, t1: b, layer: free(a, b), tags: g, mix: 'mix' }); }
  return out;
}
/** acts with run [lo, hi] of L rebuilt from its facts: the projected regions there cut out (a layer-0 piece left over that
 *  covers no shot's middle goes), liftRun's placed; a new region takes the id (and mix, roles, auto, a 'rest' kind) of the old
 *  one on its layer with the same span, else the same start, else the same end. Ignored, positioning and non-projected regions stay. */
function relift(acts, L, lo, hi) {
  const t0 = L[lo].start_ms, t1 = L[hi].end_ms, old = acts.filter((r) => projected(r) && r.t0 < t1 && r.t1 > t0);
  const coversMid = (r) => L.some((s) => r.t0 <= mid(s) && mid(s) < r.t1);
  let next = acts.flatMap((r) => (old.includes(r) ? cutOut(r, t0, t1).filter((x) => x.layer > 0 || coversMid(x)) : [r]));
  const used = new Set(), ok = (o, r) => !used.has(o) && o.layer === r.layer && (o.kind === r.kind || (o.kind === 'rest' && r.kind === 'idle'));
  for (const r of liftRun(L, lo, hi)) {
    const o = old.find((x) => ok(x, r) && x.t0 === r.t0 && x.t1 === r.t1) ?? old.find((x) => ok(x, r) && x.t0 === r.t0) ?? old.find((x) => ok(x, r) && x.t1 === r.t1);
    if (o) used.add(o);
    const keep = o ? { id: o.id, ...(o.kind === 'rest' ? { kind: 'rest' } : {}), ...(o.mix && r.layer > 0 ? { mix: o.mix } : {}), ...(o.auto !== undefined ? { auto: o.auto } : {}), roles: o.roles ?? [] } : { id: newActId() };
    next = place(next.map((x) => (x.id === keep.id ? { ...x, id: newActId() } : x)), clean({ ...r, ...keep }));   // a piece left outside the run: its own id
  }
  return sortActs(next);
}
/**
 * The shim for a write of the shots (app/doc.svelte.js, after normScenes): -> {scenes, acts}. The runs whose facts the
 * regions already project: nothing changes. Each run written with other facts gets its regions rebuilt from them (relift),
 * and the shots stay as written; when the regions still cannot give a run what was written, the projection wins there.
 */
export function syncActs(L, acts) {
  acts = acts || [];
  if (!Array.isArray(L) || !L.length) return { scenes: L, acts };
  const dirty = dirtyRuns(L, projectScenes(L, acts));
  if (!dirty.length) return { scenes: L, acts };
  let next = acts;
  for (const [lo, hi] of dirty) next = relift(next, L, lo, hi);
  const P = projectScenes(L, next);
  return { scenes: dirtyRuns(L, P).length ? P : L, acts: next };
}
/** The regions an old project's scenes make (loading one without doc.acts; "Convert scene tags to action regions"). */
export const actsFromScenes = (L) => syncActs(L, []).acts;
/** paw-2lp7.4: the shots with `carried` (derived like join, never saved: shots.js DERIVED) on every cutaway (view tag
 *  'cutaway') whose middle an accepted main-line action region covers: the action goes on there, so it is bridged exactly
 *  like off-screen (acts.js sceneView); without one it is an intermission. The same list when nothing changes. */
export function withCarried(L, acts) {
  if (!Array.isArray(L) || !L.some((s) => s?.carried || s?.tags?.includes('cutaway'))) return L;
  const base = baseOf(acts).filter((r) => r.kind === 'act');
  let out = null;
  L.forEach((s, i) => {
    const want = !!s.tags?.includes('cutaway') && base.some((r) => r.t0 <= mid(s) && mid(s) < r.t1);
    if (!!s.carried === want) return;
    out ??= L.slice();
    if (want) out[i] = { ...s, carried: true }; else { const { carried: _, ...r } = s; out[i] = r; }   // eslint-disable-line no-unused-vars
  });
  return out || L;
}
/** paw-2lp7.1: the shots with `positioning` (derived like carried, never saved: shots.js DERIVED) = the accepted positioning
 *  ranges over each, clipped to it: [[t0, t1]] (ms). Every reader that sets a range, level or calibration from tracked motion
 *  leaves these stretches out (runs.js maskRun, autorange, six-axis); the script there eases (tracking bridges). Absolute times,
 *  so a range's edges reach the readers wherever they fall in the shot (not through the shim's middle rule, paw-2lp7.7). The
 *  same list when nothing changes. */
export function withPositioning(L, acts) {
  const P = (acts || []).filter((r) => r.kind === 'positioning' && !r.auto);
  if (!Array.isArray(L) || (!P.length && !L.some((s) => s?.positioning))) return L;
  let out = null;
  L.forEach((s, i) => {
    const want = P.filter((r) => r.t0 < s.end_ms && r.t1 > s.start_ms).map((r) => [Math.max(r.t0, s.start_ms), Math.min(r.t1, s.end_ms)]);
    if (J(want.length ? want : null) === J(s.positioning)) return;
    out ??= L.slice();
    if (want.length) out[i] = { ...s, positioning: want }; else { const { positioning: _, ...r } = s; out[i] = r; }   // eslint-disable-line no-unused-vars
  });
  return out || L;
}
/** paw-2lp7.1: every shot's positioning ranges, one list (withPositioning). */
export const positioningOf = (L) => (L || []).flatMap((s) => s?.positioning || []);
/** paw-2lp7.4: the action next to shot i drawn across it (the owner marks a shot off-screen / cutaway that no action covers:
 *  one click carries the action through it): the main-line action covering the shot before (else after) grows over shot i;
 *  when the shots on both sides show the same action, it becomes one region across. -> acts | null (an action covers i
 *  already, or none is next to it). */
export function carryAcross(acts, list, i) {
  const at = (k) => (list[k] ? baseOf(acts).find((r) => r.kind === 'act' && r.t0 <= mid(list[k]) && mid(list[k]) < r.t1) ?? null : null);
  const s = list[i], A = at(i - 1), C = at(i + 1);
  if (!s || at(i) || (!A && !C)) return null;
  if (A && C && A !== C && J(A.tags) === J(C.tags)) return put(acts.filter((r) => r !== C), { ...A, t1: C.t1 });
  return A ? resizeRegion(acts, A.id, A.t0, Math.max(A.t1, s.end_ms)) : resizeRegion(acts, C.id, Math.min(C.t0, s.start_ms), C.t1);
}
