// shots.js -- scenes contain shots (paw-2zy; the field table is docs/SCENES.md). Pure.
// app.doc.scenes is the flat, contiguous list of SHOTS: camera spans in the sidecar's scene shape, so every per-span
// consumer (links, runs, bridges, lanes) keeps working. A SCENE (the act) is a run of shots: `join: true` puts a shot in
// the scene of the shot before it; `join: false` = the owner split the scene there (groupShots never re-joins it);
// absent = a scene starts there. `split: 'camera'` on a joined shot = the same take (the cut before it is a camera
// move: tracked through, no reseed); a joined shot without it starts after a hard cut (reseeded, same scene).
// Scene facts live on every shot of the scene and are kept identical by normScenes (app/doc.svelte.js runs it on every
// write, so a writer may edit any one shot): the act tags in `tags` (where / what / modifier / structure) and ACT_KEYS.
// Shot facts stay per shot: the span, camera, kind, transition, split, describe, loop, cum, sign, the view and camera
// tags, the fill (paw-sxu: a filled shot is not tracked, its strokes come from the shots around it; saved on the scene
// when every shot of it has the same fill, else on each shot). A multi-shot scene's act tags come from its first described shot (`scene_describe`, derived here; acts.js
// autoTags). Saved nested, one entry per scene with its `shots` (toSaved / fromSaved); old flat lists migrate
// (migrateScenes: each old scene becomes a shot, linked or same-act neighbours become one scene).
import { EVENT_KINDS } from '../../lib/fx.js';
import { TAG, sceneTags, migrateScene, tagSpan, isInternal, isBlank, isOffscreen, sceneKind, sceneWheres, sceneWhats, sceneStructure, toggleTag, hasTag, aliasParts, sceneCamera, tagLabel } from './acts.js';
import { continuations, withProposals } from '../../lib/scenes-continue.js';
import { sceneIndexAt, splitAt } from './scenes.js';
import { frameAt, frameTime, frameLen } from '../../lib/lane.js';

/** Scene-level fields besides the act tags: the drawn groups, the Autorange band, the tease mark, what a merge offered
 *  from the later scene ([{t0, t1, tags?, groups?, range?, tease?}]; `fill?` in an offer made before shot fills), and the stroke Detail (scene
 *  default + shot / area overrides, lib/detail.js; paw-izk), the range overrides of the run's signal ({spans: [{t0, t1,
 *  source?, against?, cam?}]}, lib/signal-source.js; paw-9qm). */
export const ACT_KEYS = ['groups', 'range', 'tease', 'offers', 'detail', 'signal'];   // `fill` is a shot fact (paw-sxu)
const ACT_CATS = new Set(['where', 'what', 'modifier', 'structure']);
const DERIVED = new Set(['join', 'scene_describe', 'structure', 'carried', 'positioning']);   // carried: regions.js withCarried (paw-2lp7.4); positioning: withPositioning (paw-2lp7.1)
const idOf = (e) => (typeof e === 'string' ? e : e?.id);
/** Is a tags entry ('anal', '-knotting', {id, t0, t1}) a scene (act) tag? View / camera / unknown entries are the shot's. */
export const isActTag = (e) => ACT_CATS.has(TAG[String(idOf(e) ?? '').replace(/^-/, '')]?.cat);
const actTags = (s) => (s?.tags || []).filter(isActTag);
// modifiers are never scene tags (paw-ef73.20: they live in doc.fx, timeline/mods.js): an event modifier's {id, t0, t1}
// entry is only ever the consumers' projection (mods.js withMods), dropped here on every write and save
const MOD_TAGS = new Set(EVENT_KINDS);
const isModSpan = (e) => typeof e === 'object' && e && MOD_TAGS.has(e.id) && Number.isFinite(e.t0);
/** The list without projected modifier entries in any shot's tags (same list when there are none). */
export function stripMods(list) {
  if (!Array.isArray(list) || !list.some((s) => s?.tags?.some?.(isModSpan))) return list;
  return list.map((s) => (s?.tags?.some?.(isModSpan) ? { ...s, tags: s.tags.filter((e) => !isModSpan(e)) } : s));
}
/** act with every merged shot's stroke Detail kept (lib/detail.js): the overrides of each, and a later scene's default
 *  that differs from the winner's as a span over its shots (under its overrides). */
function withDetail(act, shots) {
  const win = act.detail || {}, key = (d) => `${d?.shape ?? 'hold'}|${d?.sens ?? 50}`, spans = [...(win.spans || [])];
  for (const s of shots) {
    const d = s.detail;
    if (!d || J(d) === J(act.detail)) continue;
    const own = (d.spans || []).map((x) => ({ ...x, t0: Math.max(x.t0, s.start_ms), t1: Math.min(x.t1, s.end_ms) })).filter((x) => x.t1 > x.t0);
    let base = key(d) !== key(win) ? [{ t0: s.start_ms, t1: s.end_ms, shape: d.shape ?? 'hold', sens: d.sens ?? 50 }] : [];
    for (const o of own) base = base.flatMap((b) => (b.t1 <= o.t0 || b.t0 >= o.t1 ? [b] : [...(b.t0 < o.t0 ? [{ ...b, t1: o.t0 }] : []), ...(b.t1 > o.t1 ? [{ ...b, t0: o.t1 }] : [])]));
    for (const x of [...base, ...own]) if (!spans.some((y) => J(y) === J(x))) spans.push(x);
  }
  return spans.length === (win.spans || []).length ? act : { ...act, detail: { ...win, spans: spans.sort((a, b) => a.t0 - b.t0) } };
}
/** act with every merged shot's signal range overrides kept (absolute times, each once; lib/signal-source.js). */
function withSignal(act, shots) {
  const spans = [...(act.signal?.spans || [])];
  for (const s of shots) for (const x of s.signal?.spans || []) if (!spans.some((y) => J(y) === J(x))) spans.push(x);
  return spans.length === (act.signal?.spans || []).length ? act : { ...act, signal: { spans: spans.sort((a, b) => a.t0 - b.t0) } };
}
const ownTags = (s) => (s?.tags || []).filter((e) => !isActTag(e));
const J = (v) => JSON.stringify(v ?? null);
/** Do two shots carry the same scene facts? */
export function sameAct(a, b) {
  if (J(actTags(a)) !== J(actTags(b))) return false;
  return ACT_KEYS.every((k) => a?.[k] === b?.[k] || J(a?.[k]) === J(b?.[k]));
}
/** A shot's scene facts: {tags: act entries, ...ACT_KEYS it has}. */
export function actOf(s) {
  const o = { tags: actTags(s) };
  for (const k of ACT_KEYS) if (s?.[k] !== undefined) o[k] = s[k];
  return o;
}
/** Shot s with its scene facts replaced by act's (its own view / camera tags kept). */
export function withAct(s, act) {
  const out = { ...s };
  for (const k of ACT_KEYS) { if (act[k] !== undefined) out[k] = act[k]; else delete out[k]; }
  const tags = [...(act.tags || []), ...ownTags(s)];
  if (tags.length) out.tags = tags; else delete out.tags;
  return out;
}
/** Shot s with fill f (null / undefined: none). */
function withFill(s, f) {
  if (s.fill === (f ?? undefined)) return s;
  const { fill: _, ...r } = s;   // eslint-disable-line no-unused-vars
  return f == null ? r : { ...r, fill: f };
}
/** Every shot of the scenes that have one of `shots` (a scene-level edit from a shot selection). */
export const sceneShotsOf = (list, shots) => selScenes(list, shots).flatMap(([lo, hi]) => Array.from({ length: hi - lo + 1 }, (_, k) => lo + k));

// ---- cutaways and off-screen shots (paw-ef73.2, paw-2lp7.4) ----
// The owner: "cutaway is to something not action; off screen is not on screen but continuing". Two marks, the shot's view tag
// (acts.js): 'offscreen' = the action goes on unseen: not tracked, bridged from the shots around it (lib/scenes-continue.js
// bridgeRuns / bridgeScript); 'cutaway' = a shot of something that is not the action: not tracked, and carried (bridged
// exactly like off-screen) only while an action region covers it (`carried`, regions.js withCarried), else an intermission:
// nothing carried. Drawing an action across a cutaway is how the owner says "the action goes on here"; un-marking a shot
// tracks it ("script visually"). The bridge's one option: fill 'timing' (tracked for its own turn times, the depth from the
// shots around it). An older fill (before / after / both: the cutaway's "motion from the scene") reads as a cutaway
// (migrateFill, on every write): carried where an action covers it. Accepted points never change.
const VIEW_MARKS = ['internal', 'offscreen', 'cutaway', 'blank'];
const markOf = (s) => (s?.tags?.includes('offscreen') ? 'offscreen' : s?.tags?.includes('cutaway') ? 'cutaway' : null);
/** Is the shot marked off-screen or cutaway (a raised card on the Scenes row)? */
export const isCutaway = (s) => !!markOf(s);
/** Shot i's card: null | 'offscreen' | 'carried' (a cutaway under an action: bridged like off-screen) | 'intermission'. */
export function cutawayMode(list, i) {
  const s = list[i], m = markOf(s);
  return !m ? null : m === 'offscreen' ? 'offscreen' : s.carried ? 'carried' : 'intermission';
}
/** Shot s with mark m ('offscreen' | 'cutaway' | null: none, the timing option goes too): its other view tags replaced. */
function withMark(s, m) {
  const keep = (s.tags || []).filter((e) => !VIEW_MARKS.includes(String(e).replace(/^-/, ''))), tags = m ? [...keep, m] : keep;
  const { tags: _, carried: __, ...r } = m ? s : withFill(s, null);   // eslint-disable-line no-unused-vars
  return tags.length ? { ...r, tags } : r;
}
/** An older fill read in the new model: before / after / both = a cutaway (an off-screen shot keeps its mark), dropped; a
 *  'timing' fill on an unmarked shot = a cutaway with the timing option. Same shot when there is nothing to change. */
export function migrateFill(s) {
  const f = s?.fill;
  if (f !== 'before' && f !== 'after' && f !== 'both' && !(f === 'timing' && !markOf(s))) return s;
  const r = f === 'timing' ? s : withFill(s, null), v = (r.tags || []).some((e) => VIEW_MARKS.includes(e));
  return v ? r : { ...r, tags: [...(r.tags || []), 'cutaway'] };
}
/** Mark the shots `kind` ('cutaway' | 'offscreen'; the other mark is replaced: converting is one step), un-mark them (on
 *  false: back in the action, tracked), or toggle (on undefined: on unless all of them have that mark). -> new list | null. */
export function setCutaway(list, shots, on, kind = 'cutaway') {
  const tg = new Set(shots.filter((k) => list[k]));
  if (!tg.size) return null;
  on ??= ![...tg].every((k) => markOf(list[k]) === kind);
  const out = list.map((s, k) => (!tg.has(k) || (on ? markOf(s) === kind : !markOf(s)) ? s : withMark(s, on ? kind : null)));
  return out.every((s, k) => s === list[k]) ? null : out;
}
/** The bridge's timing option (fill 'timing') on the marked shots among `shots`: on, off, or toggled (undefined: on unless all
 *  have it). -> new list | null. */
export function setTiming(list, shots, on) {
  const tg = shots.filter((k) => markOf(list[k]));
  if (!tg.length) return null;
  on ??= !tg.every((k) => list[k].fill === 'timing');
  const out = list.map((s, k) => (tg.includes(k) ? withFill(s, on ? 'timing' : null) : s));
  return out.every((s, k) => s === list[k]) ? null : out;
}
/**
 * The Scenes row's layers, pure: x(ms) -> px; the Scenes strip is [0, sh), the Shots strip [y1, h). -> {scenes: [{lo,
 * hi, x0, x1}] (one unbroken block per scene, whatever cutaways sit on it), shots: [{i, x0, x1, y0, y1, cut}] (cut =
 * cutawayMode; a cutaway is raised: it rises `lift` px into its scene block and stops `band` px above the strip's
 * bottom, where the scene shows running on underneath), lift, band, top / bottom (the cutaway layer's y span)}.
 */
export function layerRects(list, x, { sh, y1, h, gap = 2 }) {
  const lift = Math.max(3, Math.min(7, Math.round(sh * 0.22))), band = Math.max(3, Math.min(6, Math.round((h - y1) * 0.3))), top = sh - lift, bottom = h - band;
  const scenes = sceneRuns(list).map(([lo, hi]) => ({ lo, hi, x0: x(list[lo].start_ms) + gap, x1: x(list[hi].end_ms) - gap }));
  const shots = list.map((s, i) => {
    const cut = cutawayMode(list, i);
    return { i, x0: x(s.start_ms), x1: x(s.end_ms), y0: cut ? top : y1, y1: cut ? bottom : h, cut };
  });
  return { scenes, shots, lift, band, top, bottom };
}
/** The raised cutaway under (px, py) in layerRects' result, else -1. */
export const cutawayAt = (L, px, py) => L.shots.find((r) => r.cut && px >= r.x0 && px < r.x1 && py >= r.y0 && py < r.y1)?.i ?? -1;

// ---- reading the structure ----
/** [[lo, hi]] shot index runs, one per scene, in order. */
export function sceneRuns(list = []) {
  const out = [];
  list.forEach((s, i) => { if (i && s?.join === true) out[out.length - 1][1] = i; else out.push([i, i]); });
  return out;
}
/** [lo, hi] of the scene that shot i is in, or null. */
export function sceneRange(list = [], i) {
  if (!list[i]) return null;
  let lo = i, hi = i;
  while (lo > 0 && list[lo].join === true) lo--;
  while (hi + 1 < list.length && list[hi + 1].join === true) hi++;
  return [lo, hi];
}
/** Is the cut before shot s a camera move inside one take (no reseed)? */
export const sameTake = (s) => s?.join === true && s.split === 'camera';
/** [lo, hi] of the take (shots joined by camera moves) that shot i is in, or null: one continuous tracking run. */
export function takeRange(list = [], i) {
  if (!list[i]) return null;
  let lo = i, hi = i;
  while (lo > 0 && sameTake(list[lo])) lo--;
  while (hi + 1 < list.length && sameTake(list[hi + 1])) hi++;
  return [lo, hi];
}
/** 0-based scene number of shot i (-1 when out of range). */
export const sceneNo = (list = [], i) => { if (!list[i]) return -1; let n = 0; for (let k = 1; k <= i; k++) if (list[k].join !== true) n++; return n; };
/** Are shots a and b in the same scene? */
export const sameScene = (list = [], a, b) => {
  if (!list[a] || !list[b]) return false;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  for (let k = lo + 1; k <= hi; k++) if (list[k].join !== true) return false;
  return true;
};
/** The shots a selection covers: anchor a .. end b (b < 0: a alone), each end grown to its whole scene unless `shot`
 *  (a shot-level selection). -> [lo, hi] | null. */
export function selShots(list = [], a, b = -1, shot = false) {
  if (!list[a]) return null;
  const e = b >= 0 && list[b] ? b : a, lo = Math.min(a, e), hi = Math.max(a, e);
  return shot ? [lo, hi] : [sceneRange(list, lo)[0], sceneRange(list, hi)[1]];
}
/** paw-o60v.6: the list's cut structure (each shot's start_ms / end_ms / join / split) as one object that keeps its identity
 *  while those stay the same, whatever else changed on the shots (painted groups, tags, who, a shot's settings). A memo of
 *  something computed from the cuts alone keys on it instead of the list, so a paint stroke, a who key or a tag does not
 *  recompute it. -> {key} (compare by identity). */
const CUTS = new WeakMap(), cutsByKey = new Map();
export function cutsOf(list = []) {
  let c = CUTS.get(list);
  if (c) return c;
  let key = '';
  for (const s of list) key += `${s.start_ms},${s.end_ms},${s.join === true ? 1 : s.join === false ? 0 : ''},${s.split ?? ''};`;
  c = cutsByKey.get(key);
  if (!c) { if (cutsByKey.size > 32) cutsByKey.clear(); cutsByKey.set(key, (c = { key })); }   // ponytail: a few structures live at once (the doc, a drag's draft, an undo); cleared past 32
  CUTS.set(list, c);
  return c;
}
/** paw-o60v.6: a token for the list as read by everything but the painted groups: the same object while two lists differ
 *  only in their shots' `groups` (a paint stroke, a who key, Suggest), a new one on any other change (by identity, field by
 *  field). The script (lib/finish.js) never reads the groups: its memo keys on this, so painting does not recompute it. */
const BARE = new WeakMap();
let lastBare = null;
const ownKeys = (s) => Object.keys(s || {}).filter((k) => k !== 'groups');
const sameButGroups = (a, b) => a === b || (!!a && !!b && ownKeys(a).length === ownKeys(b).length && ownKeys(a).every((k) => a[k] === b[k]));
export function groupsAside(list = []) {
  let c = BARE.get(list);
  if (c) return c;
  const p = lastBare, pl = p?.list.deref();   // paw-shgb: held weakly (a closed tab's shots, and what is keyed on them, can go)
  c = pl && pl.length === list.length && list.every((s, i) => sameButGroups(s, pl[i])) ? p.tok : {};
  lastBare = { list: new WeakRef(list), tok: c };
  BARE.set(list, c);
  return c;
}
/** Shot i as people read it: its number through the video, '1', '2', '3' ... (paw-2lp7.5, owner: "shots are just 123"; it was
 *  '3.2', scene 3's second shot, while scenes held shots). '' out of range. */
export const shotLabel = (list = [], i) => (list[i] ? String(i + 1) : '');
/** Camera-handling channels: each shot keeps its own (its camera tag picks proj / proj_cam / pair; runs-channel cameraDefault). */
export const CAMERA_CHANNELS = /^(primary|proj|proj_cam|cam_[xy]|pair|pair_dist|pair_proj)$/;
/** The other shots of shot i's scene that a signal pick of `channel` on a run over [t0, t1) reaches: the run covers more
 *  than half of each; none for a camera-handling channel (each shot keeps its camera handling). The caller drops shots
 *  linked to another run and skipped ones. */
export function inheritTargets(list, i, { t0, t1 }, channel) {
  const r = sceneRange(list, i);
  if (!r || CAMERA_CHANNELS.test(String(channel))) return [];
  const out = [];
  for (let k = r[0]; k <= r[1]; k++) {
    const s = list[k];
    if (k !== i && Math.min(t1, s.end_ms) - Math.max(t0, s.start_ms) > (s.end_ms - s.start_ms) / 2) out.push(k);
  }
  return out;
}
/** The scene as one span-shaped object for tag-edge edits (acts.js setTagStart / setTagEnd): shot i with the scene's edges. */
export function sceneSpanOf(list, i) {
  const r = sceneRange(list, i);
  return r ? { ...list[i], start_ms: list[r[0]].start_ms, end_ms: list[r[1]].end_ms } : null;
}

// ---- the write gate ----
/** Shots k of [lo, hi] whose facts differ from `act`, grouped into the former scenes they came from -> offers. */
function offersFrom(L, lo, hi, act) {
  const out = [];
  for (let k = lo; k <= hi; k++) {
    if (sameAct(L[k], act)) continue;
    const a = actOf(L[k]), last = out[out.length - 1];
    if (last && last.hi === k - 1 && sameAct(L[k - 1], L[k])) { last.hi = k; last.t1 = L[k].end_ms; continue; }
    const o = { hi: k, t0: L[k].start_ms, t1: L[k].end_ms }, at = a.tags, bt = act.tags;
    if (J(at) !== J(bt) && at.length) o.tags = at;
    for (const key of ['groups', 'range', 'tease']) if (a[key] !== undefined && J(a[key]) !== J(act[key])) o[key] = a[key];   // a fill stays on its shot
    o.prior = a.offers;   // the later scene's own offers come along
    out.push(o);
  }
  return out.flatMap(({ hi: _, prior, ...o }) => [...(prior || []), ...(Object.keys(o).length > 2 ? [o] : [])]);   // eslint-disable-line no-unused-vars
}
/**
 * The list with every scene's facts identical on its shots, the first shot not joined, camera splits joined, and
 * `scene_describe` derived. Which shot's facts win when a scene's shots disagree: one edited since `prev` (its facts
 * differ from the shot that started at the same time in prev), else the first; the others' differing facts are kept
 * as the scene's `offers` (a merge never loses the later scene's tags or groups). Same list when nothing changes.
 */
export function normScenes(list, prev = null) {
  if (!Array.isArray(list) || !list.length) return list;
  let out = null;
  const put = (k, s) => { if (!out) out = list.slice(); out[k] = s; };
  if (list[0].join === true || list[0].split === 'camera') { const { join: _, split: __, ...r } = list[0]; put(0, list[0].join === false ? { ...r, join: false } : r); }   // eslint-disable-line no-unused-vars
  for (let k = 1; k < list.length; k++) if (list[k].split === 'camera' && list[k].join !== true) put(k, { ...list[k], join: true });
  for (let k = 0; k < list.length; k++) { const s = (out || list)[k], m = migrateFill(s); if (m !== s) put(k, m); }   // paw-2lp7.4
  let L = out || list;
  const before = prev?.length ? new Map(prev.map((s) => [s.start_ms, s])) : null;
  for (const [lo, hi] of sceneRuns(L)) {
    let agree = true;
    for (let k = lo + 1; k <= hi && agree; k++) agree = sameAct(L[k], L[lo]);
    if (!agree) {
      let w = -1;
      if (before) for (let k = lo; k <= hi && w < 0; k++) { const p = before.get(L[k].start_ms); if (p && !sameAct(p, L[k])) w = k; }
      let act = actOf(L[w < 0 ? lo : w]);
      if (w < 0) {   // a merge: the later facts offered
        act = withSignal(withDetail(act, L.slice(lo, hi + 1)), L.slice(lo, hi + 1));
        const offers = offersFrom(L, lo, hi, act);
        if (offers.length) act.offers = [...(act.offers || []), ...offers];
      }
      for (let k = lo; k <= hi; k++) if (!sameAct(L[k], act)) put(k, withAct(L[k], act));
      L = out || list;
    }
    const sd = hi > lo ? L.slice(lo, hi + 1).find((s) => s.describe)?.describe : undefined;
    for (let k = lo; k <= hi; k++) {
      if (sd ? L[k].scene_describe !== sd : 'scene_describe' in L[k]) {
        const { scene_describe: _, ...r } = L[k];   // eslint-disable-line no-unused-vars
        put(k, sd ? { ...r, scene_describe: sd } : r);
        L = out || list;
      }
    }
  }
  return out || list;
}

// ---- edits (each -> a new normalised list, or null when refused) ----
const clipCam = (cam, t0, t1) => (Array.isArray(cam) ? cam.filter((g) => g.t1 > t0 && g.t0 < t1).map((g) => ({ ...g, t0: Math.max(g.t0, t0), t1: Math.min(g.t1, t1) })) : cam);
const clipCum = (cum, t0, t1) => (Array.isArray(cum) ? cum.filter((p) => p.t >= t0 && p.t < t1) : cum);
function trimTo(s) {
  const o = { ...s }, cam = clipCam(s.camera, s.start_ms, s.end_ms), cum = clipCum(s.cum, s.start_ms, s.end_ms);
  if (cam !== undefined) o.camera = cam;
  if (cum !== undefined) { if (cum.length) o.cum = cum; else delete o.cum; }
  return o;
}
/** Split the shot under t into two shots of the same scene; the new cut is a hard cut (sameTake off: setTake turns it
 *  into a camera move). Each half keeps its part of the camera segments and cum proposals. */
export function splitShot(list, t, minLen = 1) {
  const r = splitAt(list, t, minLen);
  if (!r) return null;
  const i = sceneIndexAt(r, t);
  r[i - 1] = trimTo(r[i - 1]);
  r[i] = trimTo({ ...r[i], join: true });
  return normScenes(r);
}
/** The cut before shot i (in a scene, i > its first shot): a camera move inside one take (on) or a hard cut (off). */
export function setTake(list, i, on) {
  // paw-4wal: a camera move on a scene boundary (each freshly detected shot is its own scene) joins the two scenes first: the
  // boundary menu offered it there, then refused it ("the first shot of a scene has no cut before it")
  if (on && i >= 1 && list[i] && list[i].join !== true) { const j = joinSelected(list, [i - 1, i]); return j?.[i]?.join === true ? setTake(j, i, true) : null; }
  if (!list[i] || list[i].join !== true || sameTake(list[i]) === !!on) return null;
  const { split: _, ...r } = list[i];   // eslint-disable-line no-unused-vars
  return list.map((s, k) => (k === i ? (on ? { ...r, split: 'camera' } : r) : s));
}
/** Index of the shot starting within minLen of t (k >= 1), else -1. */
const cutNear = (list, t, minLen) => list.findIndex((s, k) => k > 0 && Math.abs(s.start_ms - t) < Math.max(1, minLen));
/**
 * Split the scene under t into two scenes. At a shot cut (within minLen) the scenes part there; inside a shot, the
 * shot is split first. Both scenes keep the scene's facts (groups too: each keeps those drawn in it, the frame decides),
 * except where an earlier merge left an offer starting at this cut: the second scene takes it back.
 */
export function splitScene(list, t, minLen = 1) {
  let r = list, i = cutNear(list, t, minLen);
  if (i < 0) { r = splitShot(list, t, minLen); if (!r) return null; i = sceneIndexAt(r, t); }
  if (r[i].join !== true) return null;
  const [lo, hi] = sceneRange(r, i), act = actOf(r[lo]), at = r[i].start_ms;
  const off = (act.offers || []).find((o) => o.t0 === at), rest = (act.offers || []).filter((o) => o !== off);
  const first = { ...act, offers: rest.filter((o) => o.t0 < at) }, second = { ...act, offers: rest.filter((o) => o.t0 >= at) };
  if (off) for (const k of ['tags', 'groups', 'range', 'tease']) if (off[k] !== undefined) second[k] = off[k];
  for (const a of [first, second]) {
    if (!a.offers.length) delete a.offers;
    if (a.groups) { const g = a.groups.filter((x) => !Number.isFinite(x.t_ms) || (a === first ? x.t_ms < at : x.t_ms >= at)); if (g.length) a.groups = g; else delete a.groups; }
  }
  // a group drawn in the other half stays with its frame; with none left in a half, that half keeps the scene's (the clue)
  if (!first.groups && act.groups) first.groups = act.groups;
  if (!second.groups && act.groups && !off?.groups) second.groups = act.groups;
  const out = r.map((s, k) => {
    if (k < lo || k > hi) return s;
    let x = withAct(s, k < i ? first : second);
    if (k === i) { const { split: _, ...y } = x; x = { ...y, join: false }; }   // eslint-disable-line no-unused-vars
    return k >= i && off?.fill !== undefined ? withFill(x, off.fill) : x;   // an old offer's fill: the second scene's shots
  });
  return normScenes(out);
}
/** Merge the scene that shot i is in with the next scene: the earlier scene's facts win, the later one's differing tags
 *  and groups are kept as offers (acceptOffer / dropOffer). */
export function mergeScenes(list, i) {
  const r = sceneRange(list, i);
  if (!r || r[1] + 1 >= list.length) return null;
  return normScenes(list.map((s, k) => (k === r[1] + 1 ? { ...s, join: true } : s)));
}
/** Merge every scene overlapping (t0, t1) into one; null when fewer than two. */
export function mergeScenesIn(list, t0, t1) {
  let out = list, n = 0;
  for (let k = 1; k < list.length; k++) if (list[k].start_ms > t0 && list[k].start_ms < t1 && list[k].join !== true) { out = out.map((s, j) => (j === k ? { ...s, join: true } : s)); n++; }
  return n ? normScenes(out) : null;
}
/** Merge shot i with the next shot of the same scene (the first keeps its shot facts; camera segments and cum
 *  proposals of both). null across a scene cut (merge the scenes first). */
export function mergeShots(list, i) {
  const a = list[i], b = list[i + 1];
  if (!a || !b || b.join !== true) return null;
  const { loop, ...r } = a;   // eslint-disable-line no-unused-vars
  const m = { ...r, end_ms: b.end_ms };
  if (a.camera || b.camera) m.camera = [...(a.camera || []), ...(b.camera || [])];
  if (a.cum || b.cum) m.cum = [...(a.cum || []), ...(b.cum || [])].sort((x, y) => x.t - y.t);
  return normScenes([...list.slice(0, i), m, ...list.slice(i + 2)]);
}
/** The scene of shot i with its offer k applied: tags added over the offer's span (a tag the scene lacks), groups
 *  added (each stays on its own frame), range / tease taken, an old offer's fill on the shots of its span; the offer removed. */
export function acceptOffer(list, i, k) {
  const r = sceneRange(list, i), act = r && actOf(list[r[0]]), o = act?.offers?.[k];
  if (!o) return null;
  const next = { ...act, offers: act.offers.filter((_, j) => j !== k) };
  if (!next.offers.length) delete next.offers;
  if (o.tags) {
    const scene = sceneSpanOf(list, r[0]), on = new Set(sceneTags(scene));
    const add = o.tags.filter((e) => typeof idOf(e) === 'string' && idOf(e)[0] !== '-' && !on.has(idOf(e)) && TAG[idOf(e)]?.cat !== 'structure')
      .map((e) => ({ id: idOf(e), t0: typeof e === 'object' && e.t0 != null ? e.t0 : o.t0, t1: typeof e === 'object' && e.t1 != null ? e.t1 : o.t1 }));
    next.tags = [...next.tags, ...add];
  }
  if (o.groups) next.groups = [...(next.groups || []), ...o.groups];
  for (const key of ['range', 'tease']) if (o[key] !== undefined) next[key] = o[key];
  const mine = (s) => o.fill !== undefined && s.start_ms < o.t1 && s.end_ms > o.t0;
  return list.map((s, j) => (j >= r[0] && j <= r[1] ? (mine(s) ? withFill(withAct(s, next), o.fill) : withAct(s, next)) : s));
}
/** The scene of shot i without its offer k. */
export function dropOffer(list, i, k) {
  const r = sceneRange(list, i), act = r && actOf(list[r[0]]);
  if (!act?.offers?.[k]) return null;
  const next = { ...act, offers: act.offers.filter((_, j) => j !== k) };
  if (!next.offers.length) delete next.offers;
  return list.map((s, j) => (j >= r[0] && j <= r[1] ? withAct(s, next) : s));
}

// ---- joining by evidence (migration, Group shots into scenes) ----
const SCENE_OPTS = { internal: isInternal, kind: sceneKind, blank: isBlank };
const actSet = (s) => sceneTags(s).filter((t) => ACT_CATS.has(TAG[t].cat));
const key2 = (s) => J([sceneWheres(s), sceneWhats(s)]);
/** Same where / what (not empty), neither blank nor a structure scene, same fill / band / tease: one act. */
function sameActs(a, b) {
  if (isBlank(a) || isBlank(b) || sceneStructure(a) || sceneStructure(b)) return false;
  if (!sceneWheres(a).length && !sceneWhats(a).length) return false;
  return key2(a) === key2(b) && ['fill', 'range', 'tease'].every((k) => J(a[k]) === J(b[k]));
}
/**
 * The scene facts of shots [lo, hi] joined into one scene, nothing lost: every act tag any shot had, over the hull of
 * where the shots had it (the whole scene = a bare id), written as a diff against the scene's describe (its first
 * described shot's); the groups of all (each stays on the frame it was drawn on, so each shot keeps its own seeds);
 * fill / band / tease of the first (sameActs keeps tag-joins equal; a link-join's others become offers in normScenes).
 * ponytail: one span per tag (the hull): a tag on shots 1 and 3 but not 2 covers 2 too.
 */
function unionAct(L, lo, hi) {
  const t0 = L[lo].start_ms, t1 = L[hi].end_ms, hull = new Map();
  const one = (id) => !!TAG_CATEGORIES_ONE.has(TAG[id]?.cat);
  for (let k = lo; k <= hi; k++) for (const id of actSet(L[k])) {
    if (one(id) && k > lo) continue;   // structure: the first shot's (it never tag-joins)
    const sp = tagSpan(L[k], id) ?? { t0: L[k].start_ms, t1: L[k].end_ms }, h = hull.get(id);
    hull.set(id, h ? { t0: Math.min(h.t0, sp.t0), t1: Math.max(h.t1, sp.t1) } : sp);
  }
  const sd = L.slice(lo, hi + 1).find((s) => s.describe)?.describe;
  const auto = new Set(sceneTags({ start_ms: t0, end_ms: t1, describe: sd }).filter((t) => ACT_CATS.has(TAG[t].cat)));
  const tags = [];
  for (const [id, h] of hull) {
    const whole = h.t0 <= t0 && h.t1 >= t1;
    if (whole) { if (!auto.has(id)) tags.push(id); } else tags.push({ id, t0: h.t0, t1: h.t1 });
  }
  for (const id of auto) if (!hull.has(id)) tags.push('-' + id);
  const groups = [];
  for (let k = lo; k <= hi; k++) for (const g of L[k].groups || []) if (!groups.some((x) => x === g || J(x) === J(g))) groups.push(g);
  const act = { ...actOf(L[lo]), tags };
  if (groups.length) act.groups = groups; else delete act.groups;
  return act;
}
const TAG_CATEGORIES_ONE = new Set(['structure']);
/** Join the runs flagged in `join` (join[i] = shot i joins i-1) with unionAct, then normalise. */
function joinBy(L, join) {
  const out = L.map((s, i) => (join[i] && i ? { ...s, join: true } : s));
  for (const [lo, hi] of sceneRuns(out)) {
    if (hi === lo || L.slice(lo + 1, hi + 1).every((s) => s.join === true)) continue;   // already one scene before
    const act = unionAct(out, lo, hi);
    for (let k = lo; k <= hi; k++) out[k] = { ...withAct(out[k], { ...act, range: out[k].range, tease: out[k].tease, offers: out[k].offers }) };
    for (const key of ['range', 'tease', 'offers']) for (let k = lo; k <= hi; k++) if (out[k][key] === undefined) delete out[k][key];
    // a link-join's later shots with another fill take the first's and theirs is offered, as when fill was a scene fact
    // (old projects load as they did; paw-sxu)
    const f0 = out[lo].fill, odd = [];
    for (let k = lo + 1; k <= hi; k++) {
      if (out[k].fill === f0) continue;
      const f = out[k].fill, last = odd[odd.length - 1];
      if (f !== undefined) { if (last && last.k === k - 1 && last.fill === f) Object.assign(last, { k, t1: out[k].end_ms }); else odd.push({ k, t0: out[k].start_ms, t1: out[k].end_ms, fill: f }); }
      out[k] = withFill(out[k], f0);
    }
    if (odd.length) out[lo] = { ...out[lo], offers: [...(out[lo].offers || []), ...odd.map(({ k: _, ...o }) => o)] };   // eslint-disable-line no-unused-vars
  }
  return normScenes(out);
}
/** Join neighbouring scenes that show the same act (sameActs; one shot each side's edge) where nothing decided
 *  otherwise (the owner's split: join false). -> new list, or the same list when nothing joins. */
export function groupShots(list) {
  const join = list.map((s, i) => i > 0 && s.join === undefined && sameActs(list[i - 1], s));
  return join.some(Boolean) ? joinBy(list, join) : list;
}
/**
 * An old flat scene list (each entry one scene = one shot; also a Detect scenes result) -> shots with `join`. Joined:
 * a camera split (same take), a stored "continues" link with the cutaways / internal views before it (and the
 * internal-view or off-screen runs between two shots of one act that the old timeline proposed), then neighbours with
 * the same where / what (groupShots). `continues: true` becomes the join; `continues: false` (the owner's "no") stays.
 */
export function migrateScenes(old = []) {
  const L = old.map(migrateScene);
  if (!L.length || L.some((s) => 'join' in s)) return normScenes(L);
  const join = L.map((s, i) => i > 0 && s.split === 'camera');
  for (const c of continuations(withProposals(L, null, SCENE_OPTS), SCENE_OPTS)) for (let k = c.b0; k <= c.c; k++) join[k] = true;
  for (let i = 1; i < L.length; i++) if (!join[i] && L[i].continues !== false && sameActs(L[i - 1], L[i])) join[i] = true;
  const clean = L.map((s) => { if (s.continues !== true && s.continues !== 'auto') return s; const { continues: _, ...r } = s; return r; });   // eslint-disable-line no-unused-vars
  return join.some(Boolean) ? joinBy(clean, join) : normScenes(clean);
}

// ---- saved shape (the .pawproj `scenes` extra) ----
/** The flat shots -> [{start_ms, end_ms, apart?, <scene facts>, fill? (every shot's), shots: [{start_ms, end_ms, <shot facts>, fill? (when they differ)}]}]. */
export function toSaved(list = []) {
  list = stripMods(list);
  return sceneRuns(list).map(([lo, hi]) => {
    const a = actOf(list[lo]), { tags, groups, ...rest } = a;
    const f0 = list[lo].fill, one = list.slice(lo, hi + 1).every((s) => s.fill === f0);   // the same fill on every shot: the scene's
    const facts = { ...(groups !== undefined ? { groups } : {}), ...(one && f0 !== undefined ? { fill: f0 } : {}), ...rest };
    const shots = list.slice(lo, hi + 1).map((s) => {
      const o = {};
      for (const [k, v] of Object.entries(s)) if (!ACT_KEYS.includes(k) && k !== 'tags' && !DERIVED.has(k) && !(one && k === 'fill')) o[k] = v;
      const own = ownTags(s);
      if (own.length) o.tags = own;
      return o;
    });
    return { start_ms: list[lo].start_ms, end_ms: list[hi].end_ms, ...(lo && list[lo].join === false ? { apart: true } : {}), ...facts, ...(tags.length ? { tags } : {}), shots };
  });
}
const validSpan = (s) => s && Number.isFinite(s.start_ms) && Number.isFinite(s.end_ms) && s.start_ms < s.end_ms;
/** Saved scenes -> the flat shots. Entries with `shots` are scenes (this format); without, an old flat list (migrated).
 *  Invalid spans are dropped; a derived `structure` is never kept. */
export function fromSaved(a) {
  if (!Array.isArray(a)) return [];
  const items = a.filter(validSpan);
  if (!items.some((x) => Array.isArray(x.shots) && x.shots.length)) return migrateScenes(items.map(dropStructure));
  const out = [];
  for (const sc of items) {
    if (!(Array.isArray(sc.shots) && sc.shots.length)) { out.push(migrateScene(dropStructure(sc))); continue; }
    const { shots, apart, start_ms: _a, end_ms: _b, ...facts } = sc;   // eslint-disable-line no-unused-vars
    const act = { tags: (facts.tags || []).filter(isActTag) };
    for (const k of ACT_KEYS) if (facts[k] !== undefined) act[k] = facts[k];
    shots.filter(validSpan).forEach((sh, k) => {
      const s = withAct(dropStructure(sh), act);
      if (s.fill === undefined && facts.fill !== undefined) s.fill = facts.fill;   // the scene's fill: every shot without its own (paw-sxu)
      if (k) s.join = true; else if (apart && out.length) s.join = false; else delete s.join;
      out.push(s);
    });
  }
  return normScenes(out);
}
function dropStructure(s) { if (!('structure' in s)) return s; const { structure: _, ...r } = s; return r; }   // eslint-disable-line no-unused-vars

// ---- selection (paw-k2u): shots are first-class. A selection = {active: shot index | -1, shots: sorted shot indices}.
// Click = that shot, Shift+click = the contiguous run of shots from the active one (across scene cuts), Ctrl+click =
// that shot in / out, a drag = the shots it touches (Shift adds, Ctrl takes away), double-click = its whole scene.
export const NO_SEL = Object.freeze({ active: -1, shots: [] });
const span = (a, b) => Array.from({ length: Math.abs(b - a) + 1 }, (_, k) => Math.min(a, b) + k);
const uniq = (xs) => [...new Set(xs)].sort((a, b) => a - b);
/** The selection with indices outside the list dropped (an edit made it shorter); the active one falls back to the last. */
export function cleanSel(list = [], sel = NO_SEL) {
  const shots = uniq((sel?.shots || []).filter((i) => i >= 0 && i < list.length));
  return { active: shots.includes(sel?.active) ? sel.active : shots.length ? shots[shots.length - 1] : -1, shots };
}
/** Click on shot i: just it. */
export const selShot = (i) => (i >= 0 ? { active: i, shots: [i] } : NO_SEL);
/** Shift+click on shot i: every shot from the active one to i (the active one stays), else just i. */
export function selExtend(list, sel, i) {
  const a = cleanSel(list, sel).active;
  return a < 0 ? selShot(i) : { active: a, shots: span(a, i) };
}
/** Ctrl+click on shot i: in or out; it becomes the active one when it comes in. */
export function selToggle(list, sel, i) {
  const s = cleanSel(list, sel);
  if (!s.shots.includes(i)) return { active: i, shots: uniq([...s.shots, i]) };
  const shots = s.shots.filter((k) => k !== i);
  return { active: s.active === i ? (shots[shots.length - 1] ?? -1) : s.active, shots };
}
/** Double-click / Select scene: every shot of shot i's scene (end >= 0: of every scene from i's to end's). */
export function selScene(list, i, end = -1) {
  const a = sceneRange(list, i), b = end >= 0 ? sceneRange(list, end) : a;
  return a && b ? { active: i, shots: span(Math.min(a[0], b[0]), Math.max(a[1], b[1])) } : NO_SEL;
}
/** A drag over [t0, t1): the shots it touches; mode 'add' (Shift) / 'sub' (Ctrl) combine them with sel0. */
export function selBox(list, t0, t1, mode = 'replace', sel0 = NO_SEL) {
  const a = Math.min(t0, t1), b = Math.max(t0, t1), hit = [];
  list.forEach((s, k) => { if (s.end_ms > a && s.start_ms < b) hit.push(k); });
  const base = cleanSel(list, sel0).shots;
  const shots = mode === 'add' ? uniq([...base, ...hit]) : mode === 'sub' ? base.filter((k) => !hit.includes(k)) : hit;
  const active = mode !== 'replace' && shots.includes(sel0?.active) ? sel0.active : shots.length ? shots[0] : -1;
  return { active, shots };
}
/** A / Alt+A / Ctrl+I. */
export const selAll = (list) => (list.length ? { active: 0, shots: span(0, list.length - 1) } : NO_SEL);
export function selInvert(list, sel) {
  const s = cleanSel(list, sel), shots = list.map((_, k) => k).filter((k) => !s.shots.includes(k));
  return { active: shots[0] ?? -1, shots };
}
/** [lo, hi] scene runs that have a selected shot. */
export const selScenes = (list, shots = []) => sceneRuns(list).filter(([lo, hi]) => shots.some((k) => k >= lo && k <= hi));
/** Is the selection whole scenes (every shot of each scene it touches)? */
export const wholeScenes = (list, shots = []) => shots.length > 0 && selScenes(list, shots).every(([lo, hi]) => hi - lo + 1 === shots.filter((k) => k >= lo && k <= hi).length);
/** Contiguous (one unbroken run of shots)? */
export const contiguous = (shots = []) => shots.length > 0 && shots[shots.length - 1] - shots[0] === shots.length - 1;
/** What the selection is, in the quick bar's words (paw-2lp7.5: shots numbered through the video): 'Shot 3', 'Shots 3 to 5',
 *  '4 shots' (not one unbroken run). '' with none. */
export function selText(list, shots = []) {
  if (!shots.length || !list[shots[0]]) return '';
  if (shots.length === 1) return `Shot ${shotLabel(list, shots[0])}`;
  return contiguous(shots) ? `Shots ${shotLabel(list, shots[0])} to ${shotLabel(list, shots[shots.length - 1])}` : `${shots.length} shots`;
}
/** The time hull [t0, t1] of the selection (the range follows it), or null. */
export const selHull = (list, shots = []) => (shots.length && list[shots[0]] && list[shots[shots.length - 1]] ? [list[shots[0]].start_ms, list[shots[shots.length - 1]].end_ms] : null);

// ---- edits on a selection (each -> a new normalised list, or null when it changes nothing) ----
const SHOT_CATS = new Set(['view', 'camera', 'angle']);
/** The shots a tag command writes: a view / camera tag every selected shot, any other tag (or alias) one shot per
 *  touched scene (its scene follows: normScenes). */
export const tagTargets = (list, shots, id) => (SHOT_CATS.has(TAG[id]?.cat) ? shots.filter((k) => list[k]) : selScenes(list, shots).map(([lo, hi]) => shots.find((k) => k >= lo && k <= hi)));
/** Tag (or alias) id on every target of the selection: on unless all of them have it already (then off). */
export function toggleTagOn(list, shots, id) {
  const tg = tagTargets(list, shots, id), parts = aliasParts(id) ?? [id], has = (s) => parts.every((p) => hasTag(s, p));
  if (!tg.length) return null;
  const on = !tg.every((k) => has(list[k]));
  let out = list;
  for (const k of tg) {
    if (has(out[k]) === on) continue;
    if (out === list) out = list.slice();
    const tags = toggleTag(out[k], id), { tags: _, ...r } = out[k];   // eslint-disable-line no-unused-vars
    out[k] = tags?.length ? { ...r, tags } : r;
  }
  return out === list ? null : normScenes(out, list);
}
/** "Same take" on every selected shot that has a cut before it inside its scene: on unless all are (then off). */
export function setTakeOn(list, shots) {
  const tg = shots.filter((k) => list[k]?.join === true);
  if (!tg.length) return null;
  const on = !tg.every((k) => sameTake(list[k]));
  let out = list;
  for (const k of tg) { const r = setTake(out, k, on); if (r) out = r; }
  return out === list ? null : out;
}
/** Make the selected shots their own scene: scene cuts at the selection's first shot and after its last (the hull). */
export function ownScene(list, shots) {
  const h = selHull(list, shots);
  if (!h) return null;
  let out = list;
  for (const t of h) {
    const k = out.findIndex((s) => s.start_ms === t);
    if (k > 0 && out[k].join === true) out = splitScene(out, t, 1) ?? out;
  }
  return out === list ? null : out;
}
/** Join the scenes the selection touches into one (mergeScenesIn over the hull: the first scene's facts win, offers). */
export function joinSelected(list, shots) {
  const h = selHull(list, shots);
  return h ? mergeScenesIn(list, h[0], h[1]) : null;
}
/** Merge the selected shots (their hull) into one shot; across a scene cut the scenes are joined first. */
export function mergeSelected(list, shots) {
  if (shots.length < 2) return null;
  const lo = shots[0], hi = shots[shots.length - 1];
  let out = joinSelected(list, shots) ?? list;
  for (let k = lo; k < hi; k++) { const r = mergeShots(out, lo); if (!r) break; out = r; }
  return out === list ? null : out;
}

/** Move the scene boundary that starts at shot k (a scene cut) to shot j (re-parenting the shots between: they take the
 *  receiving scene's facts; groups drawn on their frames go with them). j stays inside the two scenes (each keeps a
 *  shot); the new boundary keeps the old one's marker (join false = split by you). -> new list | null. */
export function moveSceneCut(list, k, j) {
  if (!(k > 0) || !list[k] || list[k].join === true || j === k || !(j > 0) || j >= list.length) return null;
  const prev = sceneRange(list, k - 1), next = sceneRange(list, k);
  if (j <= prev[0] || j > next[1]) return null;
  const a0 = actOf(list[prev[0]]), b0 = actOf(list[k]), t = list[j].start_ms;
  const all = [...(a0.groups || []), ...(b0.groups || [])].filter((g, n, arr) => arr.indexOf(g) === n);
  const inA = (g) => !Number.isFinite(g.t_ms) ? (a0.groups || []).includes(g) : g.t_ms < t;
  const ga = all.filter(inA), gb = all.filter((g) => !inA(g));
  const A = { ...a0, groups: ga.length ? ga : undefined }, B = { ...b0, groups: gb.length ? gb : undefined };
  const out = list.map((s, i) => {
    if (i < prev[0] || i > next[1]) return s;
    let x = withAct(s, i < j ? A : B);
    if (i === j) { const { split: _, join: __, ...r } = x; x = list[k].join === false ? { ...r, join: false } : r; }   // eslint-disable-line no-unused-vars
    else if (i > prev[0]) x = { ...x, join: true };
    return x;
  });
  return normScenes(out);
}
/** paw-ef73.18: the cut before shot i (i >= 1) goes, whatever it is (M / Shift+M / Delete on a selected cut): the two
 *  shots become one; across a scene boundary the two scenes become one first (mergeScenes: the earlier scene's tags and
 *  groups are kept, the later one's differing ones are offered). -> {list, scenes (a scene boundary went)} | null. */
export function removeCut(list, i) {
  if (!(i >= 1) || !list[i]) return null;
  const scenes = list[i].join !== true, r = scenes ? mergeScenes(list, i - 1) : list, out = r && mergeShots(r, i - 1);
  return out ? { list: out, scenes } : null;
}
/** The cut before shot i moved one frame earlier (dir -1) or later (1), onto that frame's start (lane.js frameTime: as
 *  the player and detection store frames). -> the new list | null (it would leave a shot under a frame). */
export function nudgeCut(list, i, dir, frameMs) {   // frameMs: the frame grid (lane.js: the player's clock)
  if (!(i >= 1) || !list[i] || !frameLen(frameMs)) return null;
  const t = frameTime(frameAt(list[i].start_ms, frameMs) + dir, frameMs);
  if (t <= list[i - 1].start_ms || t >= list[i].end_ms) return null;
  return list.map((s, k) => (k === i - 1 ? { ...s, end_ms: t } : k === i ? { ...s, start_ms: t } : s));
}
/** The cut nearest time t: its shot index (>= 1), or -1 with no cut. */
export function nearestCut(list, t) {
  let best = -1;
  for (let k = 1; k < list.length; k++) if (best < 0 || Math.abs(list[k].start_ms - t) < Math.abs(list[best].start_ms - t)) best = k;
  return best;
}
/** What a boundary (the cut before shot i) is: 'scene' (a scene boundary), 'cut' (a hard cut inside a scene), 'move'
 *  (a camera move inside one take), or '' (shot 0 / none). */
export const boundaryKind = (list, i) => (!(i > 0) || !list[i] ? '' : list[i].join !== true ? 'scene' : sameTake(list[i]) ? 'move' : 'cut');
// paw-p2p0 (owner: "camera moves and cuts are not so easy to distinguish"): every row draws the two apart from these.
/** The boundaries by what they are: {cuts: [t] (hard cuts and scene starts), moves: [t] (camera moves inside one take)}. */
export function boundaryTimes(list = []) {
  const cuts = [], moves = [];
  for (let i = 1; i < list.length; i++) (sameTake(list[i]) ? moves : cuts).push(list[i].start_ms);
  return { cuts, moves };
}
/** Each shot's block shade (0 / 1): it alternates at every cut, never across a camera move, so a take reads as one block. */
export function blockShade(list = []) {
  const out = [];
  for (let i = 0, p = 0; i < list.length; i++) { if (i > 0 && !sameTake(list[i])) p ^= 1; out.push(p); }
  return out;
}
/** The boundary before shot i in a few words: 'camera move (zoom), not a cut' | 'cut' | '' (shot 0 / none). */
export function boundaryWord(list, i) {
  const k = boundaryKind(list, i);
  if (k !== 'move') return k ? 'cut' : '';
  const cam = sceneCamera(list[i]);
  return `camera move${cam && cam !== 'static' ? ` (${tagLabel(cam)})` : ''}, not a cut`;
}
