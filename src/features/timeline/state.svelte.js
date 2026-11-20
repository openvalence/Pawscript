// state.svelte.js -- the timeline's own UI state, shared by its lanes, panels and commands (one instance per app, `tl` the
// shown app's: the lanes are separate components the shell mounts). Document data lives in app.doc; this holds
// only what is not saved: selections, focus, hover, snap feedback, drag drafts, previews, lane options.
//
// Drafts: while a drag is in progress a lane writes the would-be list to tl.draft[key] ('plan' |
// 'loops' | 'scenes') and commits ONE app.transact on release. Every surface draws
// listOf(app, key), so the overview, the plan lane and the panels all follow the drag live.
import { repairIntervals } from './intervals.js';
import { unknownRecipes } from './plan.js';
import { setTags } from './scenes.js';
import { fromSaved, cleanSel, selScene, selShot, selHull, toggleTagOn, tagTargets, NO_SEL, stripMods } from './shots.js';
import { sceneIndexAt, sceneAtPlayhead, edgesOnFrames } from './scenes.js';
import { gridOf } from '../../lib/lane.js';
import { toggleTag, sceneTags, tagLabel, aliasParts, withStructure, TAG } from './acts.js';
import { finishEnv } from './commands-range.js';
import { withMods } from './mods.js';
import { splitAt } from './loop-marks.js';
import { followCut } from './regions.js';
import { shown } from '../../lib/shown.svelte.js';

class TimelineState {
  // selection (ids). Plan segments can be multi-selected; the rest are single.
  segs = $state.raw([]);            // selected plan segment ids
  loop = $state(null);              // selected loop id
  // paw-llaa: where a set of pictures plays, highlighted (a click on a caret, a loop, a chain): {spans: [{t0, t1}], color,
  // text, shots?: [indices]} until Esc or a click elsewhere
  match = $state.raw(null);
  seek = $state.raw(null);          // paw-llaa: the last "same frame" step {t, text, at}: the ruler's readout
  scene = $state(-1);               // the active shot (index in app.doc.scenes; the anchor of a Shift+click run), -1 = none
  shots = $state.raw([]);           // the selected shots, sorted indices (paw-k2u: shots are first-class; shots.js selShot / selExtend / ...)
  act = $state(null);               // paw-2lp7.5: the selected action region (its id in app.doc.acts), null = none
  actPop = $state(null);            // paw-2lp7.5: the region whose tag chips are open in place (its id)
  actLayers = $state(0);            // paw-2lp7.5: the secondary layers the Actions strip shows (the row grows for them: lane.js extra)
  cut = $state(null);               // paw-ef73.18: the selected cut (a click on its grip): its time (the start of the shot after it), null = none
  hint = $state.raw(null);          // paw-ef73.18: the Scenes tab's hint line {lane, text}: what a click and a drag do on the thing under the pointer
  modMark = $state.raw(null);       // a pending mark-in {id, t} (Shift+O / Shift+K once; again = mark out)
  modKind = $state('orgasm');       // the kind a modifier drawn on the Modifiers row gets (the last used)
  sceneTag = $state(null);          // the scene tag chip last pointed at (quick bar): what "Tag starts / ends at playhead" moves
  fx = $state(null);                // selected modifier id (the Modifiers row, doc.fx)
  fxPop = $state(null);             // modifier id whose curve popover is open (Refine)
  fxSel = $state([]);               // modifiers multi-selection (Shift+click / a box on the Modifiers row; Link / Unlink act on it)
  range = $state(false);            // the Autorange row is shown (also while the live pass is on: doc.finish.autorange)
  rangePolicy = $state.raw(null);   // the Autorange policy while its curve is dragged (null = the project's, doc.finish.policy)
  rangeSel = $state.raw([]);        // the Range row's selected handles: [{type: 'key', id} | {type: 'corner', t0, t1, corner}]

  /** Which timeline lane last took a pointer press ('plan', 'loops', 'scenes', 'ruler', ...) or null
   *  when the press landed elsewhere. Commands that reuse a core key (Delete, 1-9, Ctrl+D) check it in `when`. */
  focus = $state(null);

  hover = $state.raw(null);         // {t, x, y, lane} while the pointer is over a timeline lane (x, y: client px)
  snap = $state.raw(null);          // {t, label} while a drag is snapped: every lane draws the guide line
  draft = $state.raw({});           // {plan?, loops?, scenes?} during a drag

  timeMode = $state('time');        // ruler labels: 'time' | 'frames'
  armedKind = $state('main');       // kind a drag on empty plan space creates
  preview = $state.raw(null);       // {script, key} compiled plan motion: ghost curve in the blocks (generate.js)
  inspector = $state(null);         // {id, x, y} popover open on a plan segment, else null
  loopMark = $state(null);          // pending loop in-point (ms) between the two presses of the mark command
  themeTick = $state(0);            // bumped on a theme / density switch: every CanvasLane repaints
}
// paw-shgb: one state per app (a tab each). `tl` is the shown app's (lib/shown.svelte.js): the lanes, panels and key commands
// read it; what runs for a document that may be hidden (its load, its write, a track landing) uses tlFor(app).
const per = new WeakMap(), loose = new TimelineState();   // loose: no app (pure helpers in tests)
export const tlFor = (app) => { if (!app) return loose; let s = per.get(app); if (!s) per.set(app, (s = new TimelineState())); return s; };
export const tl = new Proxy({}, {
  get: (_, k) => tlFor(shown.app)[k],
  set: (_, k, v) => { tlFor(shown.app)[k] = v; return true; },
});

/** The list to draw for an undoable doc key: the drag draft if one is active, else the document's. */
export const listOf = (app, key) => tlFor(app).draft[key] ?? app.doc[key] ?? [];
export const setDraft = (key, list) => { tl.draft = { ...tl.draft, [key]: list }; };
export const clearDraft = (key) => { if (key in tl.draft) { const d = { ...tl.draft }; delete d[key]; tl.draft = d; } };

/** Scenes [{start_ms, end_ms, sign?, loop?, describe?}] (sidecar shape): the undoable app.doc.scenes (drafts while dragging),
 *  each with its derived `structure` (acts.js withStructure: intro / after / outro; recomputed, a stored one is ignored;
 *  read with the modifiers in: an orgasm makes a scene busy). */
export const scenesOf = (app) => { const l = tlFor(app).draft.scenes ?? app.doc.scenes ?? []; return withStructure(l, withMods(l, listOf(app, 'fx'))); };
/** The scenes as Autorange and the Range row read them: the event modifiers in them (mods.js withMods; a modifier drag's
 *  draft too), structure derived. Never written back. */
export const modScenesOf = (app) => withStructure(withMods(tlFor(app).draft.scenes ?? app.doc.scenes ?? [], listOf(app, 'fx')));
/** Replace the scenes. Call inside app.transact (or an app.begin group) so the gesture is one undo step. Modifiers are
 *  never scene tags: a projected list (mods.js withMods) written back loses them (shots.js stripMods).
 *  paw-2lp7.5: { cuts: true } for an edit of the cuts only (cut, merge shots, move / nudge a cut, camera move or cut): the
 *  action regions stay as they are and the shots read their facts from them (the regions are free of cuts); without it a
 *  write of the scene facts edits the regions underneath (regions.js syncActs), as every older scene command does. */
export const setScenes = (app, list, { cuts = false } = {}) => {
  // paw-2lp7.5: a cut that moved (dragged, nudged, snapped by an offer) takes the action edges that sat on it along
  const prev = app.doc.scenes || [], next = stripMods(list);
  if (prev.length === next.length && prev.length > 1 && app.doc.acts?.length) {
    const moved = next.map((s, k) => [prev[k].start_ms, s.start_ms]).filter(([a, b], k) => k > 0 && a !== b);
    if (moved.length === 1) { const a = followCut(app.doc.acts, moved[0][0], moved[0][1]); if (a) app.doc.acts = a; }
  }
  const keep = cuts ? app.doc.acts : null;
  app.doc.scenes = next;
  if (keep && app.doc.acts !== keep) app.doc.acts = keep;
  // paw-llaa: an automatic loop over a cut (one added or moved inside it) becomes one per shot, in the same undo step
  const loops = splitAt(app.doc.loops || [], app.doc.scenes.slice(1).map((s) => s.start_ms), gridOf(app.player));
  if (loops !== app.doc.loops) app.doc.loops = loops;
};

const onFramesFor = new Map();   // media path -> the clock its edges were put on
/** paw-kxz4: once per video, when the player's clock becomes the file's frame table (its frames are not where the probed rate
 *  puts them: a start offset, a dropped frame, VFR), the stored cuts / modifier / loop edges onto the real frames' starts
 *  (scenes.js edgesOnFrames; points untouched): one undo step and one toast. -> edges moved. */
export function edgesToFrames(app) {
  const p = app.player, path = app.doc?.media?.path;
  // only on a frame-table clock: the grid the file's frames are on differs from n x 1000 / fps there (a regular file's grid never
  // changed, its edges stay as stored: an effect may sit off the frames on purpose, Shift)
  if (!path || !p?.url || p.clock?.kind !== 'table' || (p.media?.proxyOf || p.media?.path) !== path || onFramesFor.get(path) === p.clock) return 0;
  onFramesFor.set(path, p.clock);
  const r = edgesOnFrames(app.doc, gridOf(p));
  if (!r?.moved) return 0;
  app.transact('Edges onto the real frames', () => { if (r.loops) app.doc.loops = r.loops; if (r.scenes) setScenes(app, r.scenes); if (r.acts) app.doc.acts = r.acts; if (r.fx) app.doc.fx = r.fx; });
  app.usage?.note?.('timeline:edgesOnFrames', { n: r.moved, maxMs: Math.round(r.maxMs * 10) / 10, clock: p.clock.kind });
  app.toast(`${r.moved} edge${r.moved === 1 ? '' : 's'} moved onto real frames (up to ${Math.round(r.maxMs)} ms)`, 'info', { timeout: 8000, action: { label: 'Undo', run: () => app.undo() } });
  return r.moved;
}
/** The selection as {active, shots} (shots.js). */
export const selOf = () => ({ active: tl.scene, shots: tl.shots });
/** Replace the selection ({active, shots}: shots.js selShot / selExtend / selToggle / selScene / selBox ...). */
export const setSel = (sel = NO_SEL) => { tl.scene = sel.active; tl.shots = sel.shots; };
/** Select shot i alone (shot = true), or the whole scene of shot i (with end >= 0: every scene up to end's). */
export function pickScene(i, end = -1, shot = false, list = null) {
  if (!(i >= 0)) return setSel(NO_SEL);
  setSel(shot || !list ? selShot(i) : selScene(list, i, end));
}
/** The selected shots that exist in `list` (sorted). */
export const selectedShots = (list) => cleanSel(list, selOf()).shots;
/** [lo, hi] of the selection's first and last shot in `list`, or null. */
export const selected = (list) => { const s = selectedShots(list); return s.length ? [s[0], s[s.length - 1]] : null; };
/** Is shot i selected? */
export const sceneSelected = (i) => tl.shots.includes(i);
/** The selection's time hull [t0, t1] in `list`, or null. */
export const selectedHull = (list) => selHull(list, selectedShots(list));
/** The shot a single-shot command acts on: the active shot, else the shot at the playhead (-1: none). */
export function targetShot(app, t = null) {
  const l = scenesOf(app), T = tlFor(app);
  return l[T.scene] && T.shots.includes(T.scene) ? T.scene : t == null ? sceneAtPlayhead(l, app.player) : sceneIndexAt(l, Math.round(t));
}
/** The shots a command acts on: the selection, else the shot at the playhead ([] with no scenes). Scene facts written on
 *  one of a scene's shots reach the whole scene (Doc normScenes). */
export function targetShots(app, t = null) {
  const l = scenesOf(app), s = selectedShots(l);
  if (s.length) return s;
  const p = t == null ? sceneAtPlayhead(l, app.player) : sceneIndexAt(l, Math.round(t));
  return p >= 0 ? [p] : [];
}
/** Scene i's tags diff (acts.js toggleTag; null = back to the describe's) in one undo step. */
export function setSceneTags(app, i, tags, label = 'Scene tags') {
  const l = scenesOf(app), r = setTags(l, i, tags);
  if (!r || r === l) return;
  app.transact(label, () => setScenes(app, r));
  try {   // usage log: each tag that came on / went off, with its category
    const a = sceneTags(l[i]), b = sceneTags(r[i]);
    for (const t of b) if (!a.includes(t)) app.usage?.note?.('scenes:tag', { scene: i, tag: t, cat: TAG[t]?.cat, on: true });
    for (const t of a) if (!b.includes(t)) app.usage?.note?.('scenes:tag', { scene: i, tag: t, cat: TAG[t]?.cat, on: false });
  } catch { /* best-effort */ }
}
/** Toggle tag / alias `id` on scene i (acts.js toggleTag) in one undo step; a toast names what came along with it
 *  (knotting brings penetration; dropping penetration drops knotting). */
export function toggleSceneTag(app, i, id) {
  const l = scenesOf(app), s = l[i];
  if (!s) return;
  const before = sceneTags(s), after = sceneTags({ ...s, tags: toggleTag(s, id) }), own = aliasParts(id) ?? [id];
  setSceneTags(app, i, toggleTag(s, id), `Scene tag: ${tagLabel(id)}`);
  const quiet = new Set(['internal', 'offscreen', 'blank', 'intro', 'idle', 'after', 'outro']);   // one-tag categories: replacing is the point
  const also = [...after.filter((t) => !before.includes(t) && !own.includes(t)).map((t) => '+ ' + tagLabel(t)), ...before.filter((t) => !after.includes(t) && !own.includes(t) && !quiet.has(t)).map((t) => tagLabel(t) + ' off')];
  if (also.length) app.toast?.(`${tagLabel(id)}: ${also.join(', ')}`, 'quiet');
}
/** Toggle tag / alias `id` on a selection of shots (paw-k2u): a view / camera tag on every shot, any other on every
 *  scene that has one of them (shots.js toggleTagOn: on unless all have it). One shot: toggleSceneTag (its toast). */
export function toggleTagOnShots(app, shots, id) {
  if (shots.length <= 1) return toggleSceneTag(app, shots[0] ?? -1, id);
  const l = scenesOf(app), r = toggleTagOn(l, shots, id);
  if (!r) return;
  app.transact(`Tag: ${tagLabel(id)} (${shots.length} shots)`, () => setScenes(app, r));
  const tg = tagTargets(l, shots, id), on = tg.every((k) => sceneTags(r[k]).includes((aliasParts(id) ?? [id])[0]));
  app.usage?.note?.('scenes:tag', { tag: id, cat: TAG[id]?.cat ?? 'alias', on, shots: shots.length, targets: tg.length });
}
/** Is tag / alias id on every target of the selection (the chip's pressed state)? */
export const tagOnAll = (list, shots, id) => { const tg = tagTargets(list, shots, id); return tg.length > 0 && tg.every((k) => (aliasParts(id) ?? [id]).every((p) => sceneTags(list[k]).includes(p))); };
/** Cut times (scene starts after the first). */
export const cutsOf = (app) => scenesOf(app).slice(1).map((s) => s.start_ms);

let seq = 0;
/** Fresh id with a prefix: 'seg', 'ch', 'bm', 'lp'. */
export const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

// ---- per-project persistence (app.registerBlock: a top-level `timeline` block in the .pawproj) ----
// plan / loops (and chapters and bookmarks, kept but unused: paw-1w0x, paw-qbvj) are core doc fields (saved by the shell, locked + genKey included).
// Scenes are the core doc.scenes now, the Autorange policy is doc.finish.policy (older blocks' rangePolicy moves there on
// load: app/project-logic appDocFrom). This block keeps what is timeline-only: the ruler mode. Older blocks also
// carried scene boundaries: those migrate into doc.scenes on load when the document has none.
const validScene = (s) => s && Number.isFinite(s.start_ms) && Number.isFinite(s.end_ms) && s.end_ms > s.start_ms;
export const blockSave = (app) => { const T = tlFor(app); return T.timeMode !== 'time' ? { v: 2, timeMode: T.timeMode } : null; };
export function blockLoad(app, v) {
  const old = Array.isArray(v?.scenes) ? v.scenes.filter(validScene).sort((a, b) => a.start_ms - b.start_ms) : [];
  if (old.length && !app.doc.scenes?.length) app.doc.scenes = fromSaved(old);   // load-time migration, not an undo step
  const tl = tlFor(app);   // the document's own: a tab opened in the background never resets the shown one's
  tl.timeMode = v?.timeMode === 'frames' ? 'frames' : 'time';
  tl.rangePolicy = null;
  tl.range = !!app.doc.finish?.autorange;
  tl.segs = []; tl.loop = tl.fx = tl.fxPop = null; tl.fxSel = []; tl.scene = -1; tl.shots = []; tl.act = tl.actPop = null; tl.rangeSel = []; tl.modMark = null; tl.inspector = null; tl.draft = {};
  const notes = repairLoaded(app);
  if (notes.length) app.toast?.(`Repaired on open: ${notes.join('; ')}`, 'warn', { timeout: 12000 });
  const conv = app.doc.project?.converted;   // app/project-logic.js modsFromV2: what an older project's effects and spans became
  if (conv) app.toast?.(`This project was ${conv}`, 'warn', { timeout: 20000 });
  const made = app.doc.project?.regionsMade;   // paw-2lp7.2: app/project-logic.js appDocFrom
  if (made) app.toast?.(`Scenes converted to ${plural(made, 'action region')}`, 'info', { timeout: 8000 });
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** Load-time repair of the interval lists every timeline surface assumes valid (sorted, t0 < t1, no overlaps):
 *  the project parser only rejects t1 < t0. Not an undo step (like the scene migration). -> notes for a toast. */
export function repairLoaded(app) {
  const notes = [];
  // not chapters (paw-1w0x): kept exactly as loaded, nothing shows them
  for (const [key, what] of [['plan', 'plan segment'], ['loops', 'loop']]) {
    const cur = app.doc[key];
    if (!Array.isArray(cur)) continue;
    const r = repairIntervals(cur);
    if (r.list === cur) continue;
    app.doc[key] = r.list;
    if (r.dropped) notes.push(`removed ${plural(r.dropped, `empty or covered ${what}`)}`);
    if (r.trimmed) notes.push(`trimmed ${plural(r.trimmed, `overlapping ${what}`)}`);
  }
  const bad = unknownRecipes(app.doc.plan);
  if (bad.length) notes.push(`unknown recipe${bad.length === 1 ? '' : 's'} ${bad.map((r) => JSON.stringify(r)).join(', ')} in the plan (pick another in the segment inspector)`);
  return notes;
}
const bound = new WeakSet();
/** Register the block once per app (called by every lane on mount). */
export function bindApp(app) {
  if (!app || bound.has(app) || typeof app.registerBlock !== 'function') return;
  bound.add(app);
  app.registerBlock('timeline', { save: blockSave, load: blockLoad });
  app.finishEnv ??= () => finishEnv(app);   // what lib/finish.js finalOf needs from the app (profile, policy, speed limit)
}

/** Duration to lay things out against. */
export const durOf = (app) => Math.max(1, Math.round(app.durationMs || app.doc.media?.durationMs || 1));
