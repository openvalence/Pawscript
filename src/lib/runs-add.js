// runs-add.js -- groups added to a finished points run (paw-o74b, "the second seed"), and a part seeded on several frames
// (paw-o74b.1). Pure (test/runs-add.test.mjs, test/runs-seeds.test.mjs).
// A shot starts with some parts in view; later the camera moves and more come in. The owner paints those on a later frame
// of the same take (each group keeps its own seed frame, g.t_ms) and Track tracks ONLY them (sidecar v4.45 groups_only:
// their own points, both ways from their frame, each way stopping where their points are lost), then merges them into the
// run that already covers the shot. Nothing already tracked is recomputed or changed: the run's channels, frames and
// points stay the same objects; the new groups' channels are aligned to the run's frame times (NaN where a group was not
// tracked: absent, never zero), their centres re-expressed against the run's camera (image position = centre + the call's
// camera; minus the run's camera), their _proj recomputed per run scene from those (rederive.js strokeProj, the run's axis),
// their points appended to the run scene's frames with fresh pinned ids, their records added to run.scenes[k].groups.
// "New for this run": run.groupSeeds [{name, t_ms, fp, span?}] (what each track seeded: name, frame, outline fingerprint);
// a run tracked before it: its sem_<name>_x channels (frame / outline unknown: a same name counts as tracked). A seed the
// run has on the same frame with another outline is "changed": not added (Track tracks everything again instead).
//
// paw-o74b.1, one part on several frames (an orbit / turntable shot, a part that turns, drift): the same name painted on
// another frame of the take is ANOTHER SEED of that part. Tracked alone (groups_only, the same call as a late group), it is
// merged as a seed: the part keeps ONE set of channels sem_<name>_*, stitched across its seeds in that run scene
// (seed-stitch.js: each seed owns the frames nearest its seed frame, the centres / scales aligned at each handover and
// cross-faded, never a step), its points under their own pinned id, drawn only where that seed owns the frames (`own`).
// Every seed's own track is KEPT in its groupSeeds entry (`track`: {t0, ch: {sfx: [v | null]}} over the frames it holds,
// 7 significant digits like the file), so deleting a seed in the Groups tool re-stitches from what the run has, no tracking
// (restitch: the stitch is a function of the run's seed tracks and the seeds the document still has; an undo brings it
// back), and with one seed left the part is that seed's own track again. groupSeeds entry: {name, t_ms, fp, span?, id?
// (pinned id of its points), track?, own? ([[a, b], ...] ms: the stretches it owns; null = not drawn / not used: deleted in
// the document)}.
import { lowerBound } from './lane.js';
import { channelOf, sceneAt } from './runs.js';
import { strokeProj, axisDir, trackedAxis } from './rederive.js';
import { sceneGroups } from './runs-channel.js';
import { stitch } from './seed-stitch.js';

const MAX_SEM = 32;   // blobs.js MAX_SEM: pinned ids 1..32
const fin = Number.isFinite;

/** A group's outline fingerprint (its polygon and v4.21 seed points, rounded): a repainted mask is another group. */
export function groupFp(g) {
  const r = (a) => (a || []).map(([x, y]) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`).join(';');
  let h = 2166136261 >>> 0;
  const er = (g?.erased?.length ? '|' + g.erased.map(r).join('/') : '') + (g?.knot?.length ? '|k' + g.knot.map(r).join('/') : '');   // paw-yx6q: an erase inside the outline is a change too; paw-njnf: so is the knot section (absent: the old fingerprint)
  for (const c of r(g?.poly) + '|' + r(g?.points) + er) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36);
}
/** The request groups as seeds a run keeps: [{name, t_ms, fp}]. */
export const seedsOf = (groups) => (groups || []).map((g) => ({ name: g.name, t_ms: Math.round(g.t_ms), fp: groupFp(g) }));
/** A seed's key (the document's group and the run's entry match on it): name and frame, and the outline fingerprint when
 *  given (the store passes it: a seed repainted since it was tracked is not the seed the run holds). */
export const seedKey = (name, t, fp = '') => `${name}@${Math.round(t)}${fp ? '#' + fp : ''}`;
const isOn = (active, e) => active.has(seedKey(e.name, e.t_ms, e.fp)) || active.has(seedKey(e.name, e.t_ms));

/** What run seeded: [{name, t_ms | null, fp | null, ...entry}] (groupSeeds; a run tracked before it: its sem_<name>_x
 *  channels, frame / outline unknown). */
export function runSeedList(run) {
  const out = Array.isArray(run?.groupSeeds) ? run.groupSeeds.filter((s) => s?.name).map((s) => ({ ...s, t_ms: fin(s.t_ms) ? s.t_ms : null, fp: s.fp || null })) : [];
  const named = new Set(out.map((s) => s.name));
  for (const k of Object.keys(run?.channels || {})) {
    const m = /^sem_([a-z0-9_]+)_x$/.exec(k);
    if (m && !named.has(m[1])) { named.add(m[1]); out.push({ name: m[1], t_ms: null, fp: null }); }
  }
  return out;
}
/** What run tracked: Map name -> its first seed {t_ms | null, fp | null, span?} (one entry per part). */
export function runGroups(run) {
  const out = new Map();
  for (const s of runSeedList(run)) if (!out.has(s.name)) out.set(s.name, { t_ms: s.t_ms, fp: s.fp, span: s.span || null });
  return out;
}

/** Request groups (groups.js trackGroups shape) against a run: {fresh (not in it: a new part, or another seed of a part it
 *  has: paw-o74b.1), changed (a seed it has on the same frame with another outline), kept}. tol: ms within which two seed
 *  frames are the same frame. */
export function newForRun(groups, run, tol = 1) {
  const have = runSeedList(run), fresh = [], changed = [], kept = [];
  for (const g of groups || []) {
    const same = have.filter((s) => s.name === g.name);
    if (!same.length) { fresh.push(g); continue; }
    if (same.some((s) => s.t_ms == null)) { kept.push(g); continue; }   // a run from before groupSeeds: a same name counts as tracked
    const at = same.find((s) => Math.abs(s.t_ms - g.t_ms) <= tol);
    if (!at) fresh.push(g);
    else if (at.fp && at.fp !== groupFp(g)) changed.push(g);
    else kept.push(g);
  }
  return { fresh, changed, kept };
}

/** A fresh track's groups by seed frame: per segment between hard cuts (ms), the groups on the earliest frame seed the run
 *  (`main`), the others are tracked from their own frames after it, in time order, and merged (`later`): a late part, or
 *  another seed of a part (paw-o74b.1). */
export function splitSeeds(groups, hardCuts = [], tol = 1) {
  const seg = (t) => hardCuts.filter((c) => c <= t).length, first = new Map();
  for (const g of groups || []) { const k = seg(g.t_ms); if (!first.has(k) || g.t_ms < first.get(k)) first.set(k, g.t_ms); }
  const main = [], later = [];
  for (const g of groups || []) (Math.abs(g.t_ms - first.get(seg(g.t_ms))) <= tol ? main : later).push(g);
  later.sort((a, b) => a.t_ms - b.t_ms);
  return { main, later };
}

/** The names the sidecar gives request groups (cli.parse_groups): who_part_side from who / part / side (a repeat in the
 *  same request gets 2, 3, ...), else the cleaned name. -> [sidecar name] in request order. */
export function sidecarNames(groups) {
  const clean = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''), seen = new Set();
  return (groups || []).map((g) => {
    const base = g.who || g.part ? [g.who, clean(g.part) || clean(g.name) || 'other', g.side].filter(Boolean).join('_') : clean(g.name) || 'other';
    let n = base, k = 2;
    while (seen.has(n)) n = base + k++;
    seen.add(n);
    return n;
  });
}

/** The index in sorted times T of the frame at t (within half a frame), else -1. */
function frameIx(T, t, half) {
  const i = lowerBound(T, t - half);
  return i < T.length && Math.abs(T[i] - t) <= half ? i : -1;
}
/** [i0, i1) of run scene k on the frame times T, inside take [a, b) ms when given (a run scene may span takes). */
function sliceOf(scenes, k, T, take = null) {
  let i0 = 0, i1 = T.length;
  if (k >= 0 && scenes?.length) { i0 = k === 0 ? 0 : lowerBound(T, scenes[k].start_ms); i1 = k + 1 < scenes.length ? lowerBound(T, scenes[k + 1].start_ms) : T.length; }
  if (Array.isArray(take) && fin(take[0]) && fin(take[1])) { i0 = Math.max(i0, lowerBound(T, take[0])); i1 = Math.min(i1, lowerBound(T, take[1])); }
  return [i0, i1];
}
const inTake = (take, t) => !Array.isArray(take) || (t >= take[0] && t < take[1]);
const sig = (x) => (fin(x) ? +x.toPrecision(7) : null);
/** A seed's track from per-frame values {sfx: ArrayLike on T} over [i0, i1): the frames with any value. null: none. */
function packTrack(T, vals, i0, i1) {
  let a = Infinity, b = -1;
  for (const v of Object.values(vals)) for (let i = i0; i < i1; i++) if (fin(v[i])) { a = Math.min(a, i); b = Math.max(b, i); }
  if (b < 0) return null;
  return { t0: T[a], ch: Object.fromEntries(Object.entries(vals).map(([s, v]) => [s, Array.from({ length: b - a + 1 }, (_, j) => sig(v[a + j]))])) };
}
/** A stored track back on T: {sfx: Float64Array (NaN outside)}. */
function unpackTrack(T, tr, half) {
  const out = {}, j0 = tr ? frameIx(T, tr.t0, half) : -1;
  for (const [s, a] of Object.entries(tr?.ch || {})) {
    const v = new Float64Array(T.length).fill(NaN);
    if (j0 >= 0) a.forEach((x, j) => { if (j0 + j < T.length && x != null) v[j0 + j] = x; });
    out[s] = v;
  }
  return out;
}
/** _proj of centres X / Y (on T) per run scene, as rederive.js does from a stored centre (the run's axis, PCA when auto). */
function projOf(run, T, X, Y, aspect) {
  const n = T.length, pj = new Float64Array(n).fill(NaN), per = new Map(), scenes = run.scenes || [];
  const u = axisDir(trackedAxis(run), aspect), gapMs = fin(run.params?.gap_ms) ? run.params.gap_ms : 1000;
  for (let j = 0; j < n; j++) { const k = sceneAt(scenes, T[j]); if (!per.has(k)) per.set(k, []); per.get(k).push(j); }
  for (const idx of per.values()) {
    const p = strokeProj(idx.map((j) => T[j]), idx.map((j) => X[j] * aspect), idx.map((j) => Y[j]), u, gapMs);
    idx.forEach((j, q) => { pj[j] = p[q]; });
  }
  return pj;
}

/**
 * Part `name` in run scene k from its seeds' tracks (entries with `track`; on = the ones in use). -> {vals: {sfx:
 * Float64Array on T, NaN outside the slice}, own: per entry [a, b] | null} | null (none in use).
 * One seed: its own track as it was. Several: stitched (seed-stitch.js) over the suffixes all of them have, _proj
 * recomputed from the stitched centre; a suffix only some have (a shaft measure from the first track) from the earliest.
 */
function partFrom(run, T, k, entries, on, aspect, half) {
  const [i0, i1] = sliceOf(run.scenes, k, T, entries[0]?.take), act = entries.filter((e, j) => on[j]);
  if (!act.length) return null;
  const tracks = entries.map((e) => unpackTrack(T, e.track, half)), all = new Set(entries.flatMap((e) => Object.keys(e.track?.ch || {})));
  const vals = {}, nanv = () => new Float64Array(T.length).fill(NaN), whole = [T[i0], T[i1 - 1]];
  if (act.length === 1) {
    const tr = tracks[entries.indexOf(act[0])];
    for (const s of all) vals[s] = tr[s] || nanv();
    return { vals, own: entries.map((e) => (e === act[0] ? [whole] : null)) };
  }
  const idx = entries.map((e, j) => j).filter((j) => on[j]).sort((p, q) => entries[p].t_ms - entries[q].t_ms);
  const Ts = Array.prototype.slice.call(T, i0, i1), sl = (v) => Array.prototype.slice.call(v, i0, i1);
  const common = [...all].filter((s) => s !== 'proj' && idx.every((j) => tracks[j][s]));
  const st = stitch(Ts, idx.map((j) => ({ t: entries[j].t_ms, v: Object.fromEntries(common.map((s) => [s, sl(tracks[j][s])])) })), { sfx: common });
  for (const s of all) {
    const v = nanv();
    if (st.v[s]) st.v[s].forEach((x, q) => { v[i0 + q] = x; });
    else if (s !== 'proj') { const j = idx.find((q) => tracks[q][s]); if (j != null) for (let i = i0; i < i1; i++) v[i] = tracks[j][s][i]; }
    vals[s] = v;
  }
  if (all.has('proj') && vals.x && vals.y) { const p = projOf(run, T, vals.x, vals.y, aspect); vals.proj = nanv(); for (let i = i0; i < i1; i++) vals.proj[i] = p[i]; }
  const own = entries.map(() => null);
  idx.forEach((j, q) => { own[j] = st.own[q]; });
  return { vals, own };
}
/** Channels `C` with part `name`'s suffixes replaced inside run scene k's slice by vals (outside it: as they were). */
function putPart(C, run, T, k, name, vals, take = null) {
  const [i0, i1] = sliceOf(run.scenes, k, T, take), out = {};
  for (const [s, v] of Object.entries(vals)) {
    const key = `sem_${name}_${s}`, old = C[key], w = new Float64Array(T.length).fill(NaN);
    for (let i = 0; i < T.length; i++) w[i] = i >= i0 && i < i1 ? v[i] : old && old.t.length === T.length ? old.v[i] : NaN;
    out[key] = channelOf(Array.from(T, (t, i) => [t, w[i] === w[i] ? w[i] : null]));
  }
  return out;
}
const gridOfRun = (run) => (run?.channels?.cam_x || run?.channels?.centroid_x || Object.values(run?.channels || {})[0])?.t || null;

/**
 * Merge a groups_only result into run. add = {result (the sidecar's), frames ({t, v, ov}: its frame events), groups (the
 * request's: app names), t_ms (their frame), frameMs, aspect, active (optional Set of seedKey: the seeds the document
 * has; default all), take (optional [a, b) ms: the take of t_ms; a part's seeds are stitched inside it, never across a cut)}. A group whose part the run already has in that run scene (seeded on other frames) is another seed of
 * it: stitched (paw-o74b.1). -> {patch (channels, frames, scenes, groupSeeds, notes), names (added), span [t0, t1] (what
 * was tracked), seeds (names added as another seed)} | {error}. The run's own channel objects and frames rows are reused.
 */
export function mergeAdded(run, { result, frames, groups, t_ms, frameMs = 1000 / 30, aspect = 16 / 9, active = null, take = null }) {
  const C = run?.channels || {}, ref = C.cam_x || C.centroid_x || Object.values(C)[0];
  if (!ref?.t?.length) return { error: 'the run has no stored channels' };
  if (!run.frames?.t?.length) return { error: 'the run has no stored frames' };
  const T = ref.t, n = T.length, half = frameMs / 2, R = result?.channels || {};
  const S = sidecarNames(groups), names = (groups || []).map((g) => g.name), scenes = run.scenes || [];
  const k = sceneAt(scenes, t_ms), have = runSeedList(run), inK = (s) => s.t_ms != null && sceneAt(scenes, s.t_ms) === k && inTake(take, s.t_ms);
  const asSeed = new Map();   // name -> the part's seeds in run scene k (it is another seed of them)
  for (const nm of names) {
    const mine = have.filter((s) => s.name === nm && inK(s));
    if (mine.some((s) => Math.abs(s.t_ms - t_ms) <= half)) return { error: `the run already has ${nm} on that frame` };
    if (!C[`sem_${nm}_x`]) continue;
    if (!mine.length) return { error: 'the run already has ' + nm };
    if (mine.filter((s) => !s.track).length > 1) return { error: `the run's ${nm} has seeds it cannot tell apart (an older run): Track everything again` };
    asSeed.set(nm, mine);
  }
  // the call's channels as per-frame values on the run's grid
  const onGrid = (pairs) => {
    const v = new Float64Array(n).fill(NaN);
    for (const [t, x] of pairs || []) { const j = frameIx(T, t, half); if (j >= 0 && typeof x === 'number' && fin(x)) v[j] = x; }
    return v;
  };
  const camA = R.cam_x && R.cam_y ? [onGrid(R.cam_x), onGrid(R.cam_y)] : null, camR = C.cam_x && C.cam_y ? [C.cam_x.v, C.cam_y.v] : null;
  const order = S.map((s, i) => [s, names[i]]).sort((a, b) => b[0].length - a[0].length);   // the longest sidecar name first
  const owner = (key) => order.find(([s]) => key.startsWith(`sem_${s}_`));
  const raw = Object.fromEntries(names.map((nm) => [nm, {}])), scOut = run.scenes || [];
  let t0 = Infinity, t1 = -Infinity;
  for (const [key, pairs] of Object.entries(R)) {
    const o = owner(key);
    if (!o) continue;
    const sfx = key.slice(5 + o[0].length);
    if (sfx === 'proj' || (!asSeed.has(o[1]) && C[`sem_${o[1]}_${sfx}`])) continue;   // never overwrite; _proj is recomputed below from the merged centre
    let v = onGrid(pairs);
    if ((sfx === 'x' || sfx === 'y') && camA && camR) {   // the call's background frame -> the run's
      const a = camA[sfx === 'x' ? 0 : 1], r = camR[sfx === 'x' ? 0 : 1];
      v = v.map((x, j) => x + a[j] - r[j]);
    }
    if (sfx === 'x') for (let j = 0; j < n; j++) if (v[j] === v[j]) { t0 = Math.min(t0, T[j]); t1 = Math.max(t1, T[j]); }
    raw[o[1]][sfx] = v;
  }
  if (!names.some((nm) => raw[nm].x)) return { error: 'the sidecar returned no centre for ' + names.join(', ') };
  for (const nm of names) if (raw[nm].x && raw[nm].y) raw[nm].proj = projOf(run, T, raw[nm].x, raw[nm].y, aspect);
  // pinned ids: the call's (4, 5, ... in its request order) -> free ids of the run
  const sc = scenes[k], recs = result?.scenes?.[0]?.groups || {};
  const used = new Set();
  scenes.forEach((_, i) => { for (const [key, r] of Object.entries(sceneGroups(run, i))) if (key.startsWith('sem_') && Number.isInteger(r?.id)) used.add(r.id); });
  for (const s of have) if (Number.isInteger(s.id)) used.add(s.id);
  for (const ov of run.frames.ov) for (const q of ov?.pts || []) if (Number.isInteger(q[5])) used.add(q[5]);
  const idMap = new Map(), recOut = {}, idOf = new Map();
  let next = 4;   // 1..3 are the tagger's penis / balls / hips (cli.SEM_IDS); user groups start at 4, as the sidecar numbers them
  for (let i = 0; i < S.length; i++) {
    const r = recs[`sem_${S[i]}`];
    if (!Number.isInteger(r?.id)) continue;
    while (used.has(next)) next++;
    if (next > MAX_SEM) return { error: `no free pinned group id (the run has ${MAX_SEM})` };
    idMap.set(r.id, next); used.add(next); idOf.set(names[i], next);
    if (!asSeed.has(names[i])) recOut[`sem_${names[i]}`] = { ...r, id: next, label: names[i], added: { t_ms: Math.round(t_ms) } };
  }
  // channels: a new part as tracked; another seed of a part: the part stitched across its seeds in run scene k
  const channels = { ...C }, [i0, i1] = sliceOf(scenes, k, T, take), span = fin(t0) ? [t0, t1] : null, fps = seedsOf(groups);
  let prior = Array.isArray(run.groupSeeds) ? run.groupSeeds.slice() : have.map(({ name, t_ms: tm, fp }) => ({ name, t_ms: tm, fp }));
  const added = [];
  names.forEach((nm, i) => {
    const entry = { ...fps[i], span, ...(idOf.has(nm) ? { id: idOf.get(nm) } : {}), ...(asSeed.has(nm) && take ? { take: [Math.round(take[0]), Math.round(take[1])] } : {}) };
    if (!asSeed.has(nm)) {
      for (const [s, v] of Object.entries(raw[nm])) channels[`sem_${nm}_${s}`] = channelOf(Array.from(T, (t, j) => [t, v[j] === v[j] ? v[j] : null]));
      added.push(entry);
      return;
    }
    // the part's earlier seeds in this run scene; the one whose data the channels hold (no track yet) keeps them as its track
    const ents = prior.filter((s) => s?.name === nm && inK(s)).map((s) => {
      if (s.track) return s;
      const vals = {};
      for (const key of Object.keys(C)) if (key.startsWith(`sem_${nm}_`) && C[key].t.length === n) vals[key.slice(5 + nm.length)] = C[key].v;
      const id = sceneGroups(run, k)[`sem_${nm}`]?.id;
      return { ...s, track: packTrack(T, vals, i0, i1), ...(Number.isInteger(id) && !Number.isInteger(s.id) ? { id } : {}), ...(entry.take ? { take: entry.take } : {}) };
    });
    const mine = { ...entry, track: packTrack(T, raw[nm], i0, i1) }, all = [...ents, mine];
    const on = all.map((e) => !active || isOn(active, e) || e === mine);
    const part = partFrom(run, T, k, all, on, aspect, half);
    Object.assign(channels, putPart(C, run, T, k, nm, part.vals, entry.take));
    const withOwn = all.map((e, j) => ({ ...e, own: part.own[j] })), earlier = withOwn.slice(0, -1);
    prior = prior.map((s) => earlier.find((e) => e.name === s?.name && e.t_ms === s?.t_ms) || s);
    added.push(withOwn[withOwn.length - 1]);
  });
  // the call's points onto the run scene's frames (same index every frame: placeholders, invisible, where it has no row)
  const A = frames?.t?.length ? frames : null, F = run.frames, ov = F.ov.slice();
  const lo = sc ? sc.start_ms : -Infinity, hi = k + 1 < scenes.length ? scenes[k + 1].start_ms : Infinity;
  const mine = (i) => (A?.ov[i]?.pts || []).filter((q) => idMap.has(q[5])).map((q) => [q[0], q[1], q[2] ? 1 : 0, -1, 0, idMap.get(q[5])]);
  const rowsA = A ? A.t.map((_, i) => mine(i)) : [], withPts = rowsA.map((r, i) => (r.length ? i : -1)).filter((i) => i >= 0);
  const D = 0.006, r4 = (x) => Math.round(x * 1e4) / 1e4;
  if (withPts.length) {
    const width = rowsA[withPts[0]].length;
    for (let i = 0; i < F.t.length; i++) {
      const t = F.t[i];
      if (t < lo || t >= hi || !ov[i]) continue;
      const j = frameIx(A.t, t, half);
      let add = j >= 0 && rowsA[j].length === width ? rowsA[j] : null;
      if (!add) {   // not tracked on this frame: the nearest tracked frame's points, invisible (a constant point index per frame)
        const near = withPts.reduce((b, x) => (Math.abs(A.t[x] - t) < Math.abs(A.t[b] - t) ? x : b), withPts[0]);
        add = rowsA[near].map((q) => [q[0], q[1], 0, -1, 0, q[5]]);
      }
      const o = ov[i], pts = Array.isArray(o.pts) ? [...o.pts, ...add] : add;
      const next2 = { ...o, pts };
      if (Array.isArray(o.points)) next2.points = [...o.points, ...add.filter((q) => q[2]).map((q) => [q[0], q[1]])];
      if (Array.isArray(o.boxes)) next2.boxes = [...o.boxes, ...add.filter((q) => !q[2]).map((q) => [r4(q[0] - D), r4(q[1] - D), 2 * D, 2 * D])];
      ov[i] = next2;
    }
  }
  const scenesOut = sc && Object.keys(recOut).length ? scOut.map((s, i) => (i === k ? { ...s, groups: { ...sceneGroups(run, i), ...recOut } } : s)) : scOut;
  const seeds = [...prior, ...added], again = names.filter((nm) => asSeed.has(nm));
  const note = { code: 'groups_added', message: `added ${names.map((nm) => (asSeed.has(nm) ? nm + ' (another seed)' : nm)).join(', ')} from ${Math.round(t_ms)} ms${span ? `, tracked ${Math.round(span[0])}–${Math.round(span[1])} ms` : ''}`, data: { names, t_ms: Math.round(t_ms), span, ...(again.length ? { seeds: again } : {}) } };
  return { patch: { channels, frames: { ...F, ov }, scenes: scenesOut, groupSeeds: seeds, notes: [...(run.notes || []), note] }, names, span, seeds: again };
}

/**
 * paw-o74b.1: the run's multi-seed parts re-stitched for the seeds the document has now (active: Set of seedKey, with or
 * without the outline fingerprint; with it, a seed repainted since it was tracked does not count: T tracks it again). A seed
 * deleted (or hidden) in the Groups tool stops counting (its track stays in the run: an undo brings it back); a part left
 * with one seed is that seed's own track. -> {channels, groupSeeds} | null (nothing changes). frameMs: one frame.
 */
export function restitch(run, active, { aspect = 16 / 9, frameMs = 1000 / 30 } = {}) {
  const T = gridOfRun(run), list = run?.groupSeeds;
  if (!T?.length || !Array.isArray(list) || !list.some((s) => s?.track)) return null;
  const scenes = run.scenes || [], parts = new Map();
  list.forEach((s, j) => { if (s?.track && fin(s.t_ms)) { const key = `${s.name}|${sceneAt(scenes, s.t_ms)}|${s.take || ''}`; if (!parts.has(key)) parts.set(key, []); parts.get(key).push(j); } });
  let channels = null, seeds = null;
  for (const js of parts.values()) {
    const ents = js.map((j) => list[j]), on = ents.map((e) => isOn(active, e));
    if (on.every((x, q) => x === (ents[q].own !== null))) continue;   // as it is
    const k = sceneAt(scenes, ents[0].t_ms), part = partFrom(run, T, k, ents, on, aspect, frameMs / 2);
    if (!part) continue;   // none of its seeds is in the document: the part stays as tracked
    channels = { ...(channels || run.channels), ...putPart(run.channels, run, T, k, ents[0].name, part.vals, ents[0].take) };
    seeds ||= list.slice();
    js.forEach((j, q) => { seeds[j] = { ...list[j], own: part.own[q] }; });
  }
  return channels ? { channels, groupSeeds: seeds } : null;
}

/** paw-o74b.1: pinned id -> [{name, t_ms, own, k (its run scene)}] for the seeds with an id of their own (cached per run). */
const idCache = new WeakMap();
export function seedIds(run) {
  if (!run) return new Map();
  let m = idCache.get(run);
  if (!m) {
    m = new Map();
    for (const s of run.groupSeeds || []) if (Number.isInteger(s?.id) && fin(s.t_ms)) { if (!m.has(s.id)) m.set(s.id, []); m.get(s.id).push({ name: s.name, t_ms: s.t_ms, own: s.own, k: sceneAt(run.scenes || [], s.t_ms) }); }
    idCache.set(run, m);
  }
  return m;
}
/** Does pinned id `id`'s seed own frame t (paw-o74b.1: a multi-seed part's points are drawn where their seed owns the
 *  frames)? Ids without a seed entry, or none in t's run scene, or no ownership yet: yes. */
export function ownsAt(run, id, t) {
  const l = seedIds(run).get(id);
  if (!l) return true;
  const k = sceneAt(run.scenes || [], t), here = l.filter((s) => s.k === k);
  return !here.length || here.some((s) => s.own === undefined || inOwn(s.own, t));
}
const inOwn = (own, t) => Array.isArray(own) && own.some((r) => Array.isArray(r) && t >= r[0] - 1 && t <= r[1] + 1);
/** The seed of part `name` owning frame t in run (an entry of groupSeeds), else null. */
export function ownerAt(run, name, t) {
  const k = sceneAt(run?.scenes || [], t), l = (run?.groupSeeds || []).filter((s) => s?.name === name && fin(s.t_ms) && sceneAt(run.scenes || [], s.t_ms) === k);
  return l.find((s) => inOwn(s.own, t)) || null;
}

/** A group's painted outline where run tracked it at time `to`: the polygon moved by the group's image-space displacement
 *  (its centre sem_<name>_x / _y + the camera cam_x / _y) from its seed frame `from` to `to`. -> poly | null (the run does
 *  not have the group, or has no centre near `from` or `to`). */
export function trackedPoly(run, name, poly, from, to, frameMs = 1000 / 30) {
  const C = run?.channels || {}, X = C[`sem_${name}_x`], Y = C[`sem_${name}_y`];
  if (!X || !Y || !(poly?.length >= 3)) return null;
  const at = (c, t) => { const j = frameIx(c.t, t, frameMs * 0.75); return j >= 0 ? c.v[j] : NaN; };
  const img = (t) => [at(X, t) + (C.cam_x ? at(C.cam_x, t) : 0), at(Y, t) + (C.cam_y ? at(C.cam_y, t) : 0)];
  const a = img(from), b = img(to);
  if (![...a, ...b].every((v) => v === v)) return null;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return poly.map(([x, y]) => [x + dx, y + dy]);
}
