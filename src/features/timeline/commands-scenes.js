// Scene and shot commands (scenes contain shots: shots.js). Alt+S / Alt+K are taken by the inspector, so these use
// Alt+Shift chords, which work in every tab. paw-ef73.18: the Scenes tab has no point editing, so there plain keys act on
// the shot / cut at the playhead or the selection (timeline.key.*: K cut, M / Shift+M merge right / left, N new scene,
// [ ] cuts, Shift+[ ] scenes, , . nudge a cut a frame; Alt+C cutaway and Delete as before); in Track / Refine / Review those
// letters keep their meanings (K shuttle stop, M simulator, N snap, [ ] speed, , . points).
// paw-2lp7.5: scenes are gone from the timeline (owner: "shots, which are marked as cuts, actions which are what is happening
// at any moment, not bound to cuts"): the scene commands that remain here edit shots and cuts, and leave the action regions as
// they are (setScenes cuts); the scene structure ones (new scene, merge scenes, group, join, own scene, select scene) are
// re-pointed at the regions in commands-acts.js under their old ids, or gone (timeline.shot.own, timeline.scene.joinSelected,
// timeline.key.newScene: N is a region over the selection now).
import { tl, scenesOf, listOf, setScenes, setSceneTags, toggleSceneTag, toggleTagOnShots, durOf, targetShot, targetShots, setSel, selOf, selectedShots } from './state.svelte.js';
import { sceneIndexAt } from './scenes.js';
import { TAG_CATEGORIES, ALIASES, TAG, hasTag, aliasParts, tagLabel, setTagStart, setTagEnd } from './acts.js';
import { tagShown } from '../../lib/content.js';
import { splitShot, splitScene, mergeScenes, mergeScenesIn, mergeShots, setTake, sameTake, sceneRange, sceneSpanOf, groupShots, acceptOffer, dropOffer, shotLabel, sceneNo, sceneRuns,
  selShot, selScene, selAll, selInvert, selHull, selText, setTakeOn, ownScene, joinSelected, mergeSelected, cleanSel, NO_SEL,
  cutawayMode, setCutaway, setTiming, removeCut, nudgeCut, nearestCut } from './shots.js';
import { trackingOf, peekGroups } from './deps.js';
import { seedFrames, seedStep } from '../tracking/seed-marks.js';
import { actsAt, addRegion, deleteRegion, actsFromScenes, toggleRegionTag, regionWords } from './regions.js';
import { selectedAct, setTags as setRegionTagsCmd } from './acts-edit.js';
import { landAt } from './transitions.svelte.js';
import { playheadFrameStart, gridOf } from '../../lib/lane.js';
import { guard, whyOf } from '../../app/commands.js';
import { toggleCmd } from '../../lib/selmodal.js';

const has = guard((app) => scenesOf(app).length > 0, 'Detect scenes first');
/** paw-m3b6: why the Scenes tab / Actions and shots row keys are off (has is false first: no scenes). */
export const KEYS_WHY = 'Only in the Scenes tab or the Actions and shots row';
// structure at the playhead lands on the start of the frame on screen, wherever the playhead rests (paw-ef73.14)
const now = (app) => playheadFrameStart(app.player);
/**
 * Select (paw-k2u) and let the range follow: the selection's hull becomes the range (playback / loop / Track work on
 * it), the points inside are the axis selection, the active shot's run the selected run; seek = the playhead to the
 * hull's start. how = the usage note's kind ('click', 'shift', 'ctrl', 'box', 'scene', 'all', ...).
 */
export function applySel(app, sel, how = 'click', { seek = true } = {}) {
  const l = scenesOf(app), s = cleanSel(l, sel);
  setSel(s);
  const h = selHull(l, s.shots);
  if (!h) return s;
  const t0 = h[0], t1 = Math.min(h[1], durOf(app));
  app.doc.range = { t0, t1 };
  app.select?.(app.script.filter((p) => p.at >= t0 && p.at < t1).map((p) => p.at));
  if (s.active >= 0) trackingOf(app)?.selectSceneRun?.(s.active);
  if (seek) app.player.seek(landAt(app, t0, t1));   // paw-ef73.13: a shot that fades in lands on its first clean frame
  app.usage?.note?.('scenes:select', { how, shots: s.shots.length, scenes: sceneRuns(l).filter(([lo, hi]) => s.shots.some((k) => k >= lo && k <= hi)).length });
  return s;
}
/** The shot a tag command acts on (state targetShot): a scene tag written there reaches its whole scene. */
const tagTarget = (app) => targetShot(app);
const TAG_KEYS = { internal: 'Alt+Shift+I' };
const frameOf = (app) => Math.max(1, Math.round(app.player.frameMs || 1));
/** One undoable scene-structure edit with its usage note; false (and a quiet toast) when refused. cuts: an edit of the cuts
 *  only (the action regions stay: setScenes). */
function edit(app, label, r, why, usage, facts, cuts = false) {
  if (!r) { app.toast(why, 'quiet'); return false; }
  app.transact(label, () => setScenes(app, r, { cuts }));
  app.usage?.note?.(usage, facts);
  return true;
}
/** Scene / shot structure edits (the commands below and the Scenes row's right-click): split at t, merge with the
 *  next / previous, the cut before a shot (same take / hard cut), group by tags, a merge's offers. */
export const structure = {
  splitScene: (app, t = now(app)) => { const r = splitScene(scenesOf(app), t, frameOf(app)); if (edit(app, 'New scene', r, 'Cannot start a new scene here', 'scenes:splitScene', { t })) applySel(app, selScene(r, sceneIndexAt(r, t)), 'split', { seek: false }); },
  splitShot: (app, t = now(app)) => { const r = splitShot(scenesOf(app), t, frameOf(app)); if (edit(app, 'Cut', r, 'Cannot cut the shot here', 'scenes:splitShot', { t }, true)) applySel(app, selShot(sceneIndexAt(r, t)), 'split', { seek: false }); },
  mergeScene: (app, i, dir = 1) => {
    const l = scenesOf(app), r0 = sceneRange(l, i);
    if (!r0) return;
    const at = dir > 0 ? i : r0[0] - 1, r = at >= 0 ? mergeScenes(l, at) : null;
    const offered = !!r && (r[at]?.offers?.length || 0) > (l[at]?.offers?.length || 0);
    if (edit(app, 'Merge scenes', r, dir > 0 ? 'No next scene' : 'No previous scene', 'scenes:mergeScenes', { dir, offered })) {
      const [lo] = sceneRange(r, Math.max(0, at));
      applySel(app, selScene(r, lo), 'merge', { seek: false });   // the merged scene, the range follows
      if (offered) app.toast("Merged: the first scene's tags and groups are kept, the second scene's are offered (Actions panel: Accept / Drop)", 'info');
    }
  },
  /** paw-2lp7.5: any two neighbouring shots (no scene in the way any more): the cut between them goes (removeCut). */
  mergeShot: (app, i, dir = 1) => {
    const l = scenesOf(app), c = dir > 0 ? i + 1 : i;
    if (!(c >= 1 && c < l.length)) return app.toast(dir > 0 ? 'No next shot' : 'No previous shot', 'quiet');
    structure.removeCut(app, c);
  },
  take: (app, i, on) => {
    const l = scenesOf(app), want = on ?? !sameTake(l[i]), r = setTake(l, i, want);
    if (edit(app, want ? 'Boundary: camera move' : 'Boundary: cut', r, 'The first shot of a scene has no cut before it in the scene', 'scenes:take', { on: want }, true))
      app.toast(`Before shot ${shotLabel(r, i)}: ${want ? 'a camera move, not a cut (same take: tracked through, no reseed)' : 'a cut (reseeded)'}`, 'quiet');
  },
  group: (app) => {
    const l = scenesOf(app), r = groupShots(l), n = sceneRuns(l).length - sceneRuns(r).length;
    if (edit(app, 'Group shots into scenes', n ? r : null, 'No neighboring scenes with the same where and what', 'scenes:group', { joined: n })) app.toast(`${n} scene cut${n === 1 ? '' : 's'} removed: same where / what`, 'quiet');
  },
  /** The selection's own edits (paw-k2u): each acts on the selected shots, else the shot at the playhead. */
  ownScene: (app, shots = targetShots(app)) => {
    const l = scenesOf(app), r = ownScene(l, shots);
    if (edit(app, 'Make the shots their own scene', r, 'They are a scene of their own already', 'scenes:ownScene', { shots: shots.length })) applySel(app, { active: shots[0], shots }, 'own', { seek: false });
  },
  joinSelected: (app, shots = targetShots(app)) => {
    const l = scenesOf(app), r = joinSelected(l, shots);
    if (edit(app, 'Join into one scene', r, 'The selection is one scene already', 'scenes:joinSelected', { shots: shots.length })) applySel(app, selScene(r, shots[0]), 'join', { seek: false });
  },
  mergeSelected: (app, shots = targetShots(app)) => {
    const l = scenesOf(app), r = mergeSelected(l, shots);
    if (edit(app, 'Merge shots', r, 'Select two shots or more to merge them', 'scenes:mergeSelected', { shots: shots.length }, true)) applySel(app, selShot(shots[0]), 'merge', { seek: false });
  },
  takeSelected: (app, shots = targetShots(app)) => {
    const l = scenesOf(app), r = setTakeOn(l, shots), on = !!r && shots.some((k) => sameTake(r[k]));
    if (edit(app, on ? 'Boundaries: camera moves' : 'Boundaries: cuts', r, 'The first shot of a scene has no cut before it in the scene', 'scenes:take', { on, shots: shots.length }, true))
      app.toast(`${selText(r, shots)}: ${on ? 'camera moves before them, not cuts (tracked through)' : 'cuts before them (reseeded)'}`, 'quiet');
  },
  /** Delete / X in the Scenes row: the cuts go, not the time (shots tile the video): two or more selected shots merge
   *  into one; one shot merges into the shot before it. */
  removeCuts: (app, shots = targetShots(app)) => {
    if (shots.length > 1) return structure.mergeSelected(app, shots);
    const i = shots[0];
    if (!(i > 0)) return app.toast('The first shot has no cut before it', 'quiet');
    structure.removeCut(app, i);
  },
  offer: (app, i, k, accept) => {
    const r = (accept ? acceptOffer : dropOffer)(scenesOf(app), i, k);
    edit(app, accept ? 'Accept offered tags / groups' : 'Drop offered tags / groups', r, 'Nothing offered', 'scenes:offer', { accept });
  },
  /** paw-2lp7.4: the shots marked `kind` ('cutaway' | 'offscreen'; the other mark is replaced: converting is one step), back in
   *  the action (on false: tracked), or toggled (undefined). One undo step. */
  cutaway: (app, shots = targetShots(app), on, kind = 'cutaway') => {
    const l = scenesOf(app), r = setCutaway(l, shots, on, kind), up = !!r && shots.some((k) => r[k]?.tags?.includes(kind));
    const what = kind === 'offscreen' ? 'Off-screen' : 'Cutaway';
    if (!edit(app, up ? what : 'Back in the action (tracked)', r, on === false ? 'Not marked' : `${what} already`, 'scenes:cutaway', { on: up, kind, shots: shots.length })) return;
    const now = scenesOf(app), k = shots.find((x) => now[x]), m = k == null ? null : cutawayMode(now, k);
    app.toast(`${selText(now, shots)}: ${!up ? 'back in the action (tracked)' : MARK_WORDS[m] ?? what}`, 'quiet');
  },
  /** paw-2lp7.4: the bridge's one option on the marked shots: timing from the shot's own tracked motion (toggle). */
  timing: (app, shots = targetShots(app), on) => {
    const r = setTiming(scenesOf(app), shots, on), up = !!r && shots.some((k) => r[k]?.fill === 'timing');
    edit(app, up ? 'Bridge: timing from this shot' : 'Bridge: carried from the shots around', r, 'Only an off-screen shot or a cutaway has a bridge', 'scenes:cutawayMode', { mode: up ? 'track' : 'scene', shots: shots.length });
  },
  /** paw-ef73.18: the cut before shot i goes (M / Shift+M, Delete on a selected cut): one shot; across a scene boundary
   *  the scenes become one too (the earlier scene's tags and groups kept, the later one's offered). One undo step. */
  removeCut: (app, i) => {
    const l = scenesOf(app), r = removeCut(l, i);
    if (!edit(app, 'Merge shots', r?.list, 'No cut there', 'scenes:removeCut', { scenes: !!r?.scenes }, true)) return;
    tl.cut = null;
    applySel(app, selShot(i - 1), 'merge', { seek: false });
    // paw-2lp7.5: the action regions stay; an action that changed at that cut now changes inside the merged shot (its marker)
    const inside = (app.doc.acts || []).some((x) => x.layer === 0 && x.kind !== 'positioning' && Math.abs(x.t0 - l[i].start_ms) < 0.5);
    if (inside) app.toast(`Shots ${shotLabel(l, i - 1)} and ${shotLabel(l, i)} are one shot: the action still changes there, inside the shot (tracked as one shot)`, 'quiet');
  },
  /** M / Shift+M: the shot at the playhead (or the active selected one) merged with the shot to its right (dir 1) / left (-1). */
  mergeAt: (app, dir) => {
    const l = scenesOf(app), i = targetShot(app), c = dir > 0 ? i + 1 : i;
    if (!(i >= 0 && c >= 1 && c < l.length)) return app.toast(dir > 0 ? 'No shot to the right' : 'No shot to the left', 'quiet');
    structure.removeCut(app, c);
  },
  /** N: the cut at / before the playhead (the start of the shot there) becomes a scene boundary; when that shot starts its
   *  scene already: cut at the playhead and start a scene there. */
  newSceneAt: (app, t = now(app)) => {
    const l = scenesOf(app), i = sceneIndexAt(l, t);
    structure.splitScene(app, i > 0 && l[i].join === true ? l[i].start_ms : t);
  },
  /** , / .: the selected cut (else the one nearest the playhead) one frame earlier / later, the playhead on its new frame. */
  nudgeCut: (app, dir) => {
    const l = scenesOf(app), sel = selectedCut(app), i = sel >= 1 ? sel : nearestCut(l, now(app)), r = nudgeCut(l, i, dir, gridOf(app.player));
    if (!edit(app, 'Nudge cut', r, i < 1 ? 'No cut' : 'The cut cannot move further: a shot would be under a frame', 'scenes:nudgeCut', { dir }, true)) return;
    if (sel >= 1) tl.cut = r[i].start_ms;
    app.player.seek(r[i].start_ms);
  },
};
/** paw-2lp7.4: what a marked shot does, in words, per shots.js cutawayMode. */
export const MARK_WORDS = {
  offscreen: 'off-screen: the action goes on unseen, bridged from the shots around it (not tracked)',
  carried: 'a cutaway under an action: the action continues through it, bridged like off-screen (not tracked)',
  intermission: 'a cutaway with no action over it: an intermission, nothing carried (not tracked; draw an action across it to carry it)',
};

const scenesFocused = guard((app) => tl.focus === 'scenes' && has(app), (app) => (tl.focus !== 'scenes' ? 'Click the Actions and shots row first' : whyOf(app, has)));
/** The playhead to the next (dir 1) / previous (-1) cut, or scene boundary (scenes); a shot that fades in: its first clean
 *  frame (paw-ef73.13). */
export function jumpCut(app, dir, scenes = false) {
  const t = app.player.timeMs, eps = 1, what = scenes ? 'scene' : 'cut', cuts = scenesOf(app).slice(1).filter((s) => !scenes || s.join !== true).map((s) => landAt(app, s.start_ms, s.end_ms));
  const c = dir > 0 ? cuts.find((x) => x > t + eps) : [...cuts].reverse().find((x) => x < t - eps);
  if (c == null) { app.toast(dir > 0 ? `No later ${what}` : `No earlier ${what}`, 'quiet'); return; }
  app.player.seek(c);
}
// paw-46du: the seed frames (painted parts, the runs' seeds: tracking/seed-marks.js seedFrames), for the marks on the Shots
// strip and the previous / next seed frame keys; recomputed only when the shots (the stored list or a drag's draft, not
// scenesOf's derived copy, which is new on every call) or the runs change
let seedMemo = null;
export function seedsOf(app) {
  const s = listOf(app, 'scenes'), r = trackingOf(app)?.runs ?? [], fm = app.player?.frameMs || 1000 / 30;
  if (seedMemo?.s !== s || seedMemo?.r !== r || seedMemo?.fm !== fm) seedMemo = { s, r, fm, v: seedFrames(s, r, fm / 2) };
  return seedMemo.v;
}
/** The playhead to the next (dir 1) / previous (-1) seed frame, round the video (not the shot), on that exact frame. */
export function jumpSeed(app, dir) {
  const t = seedStep(seedsOf(app), app.player.timeMs, dir, Math.max(1, (app.player.frameMs || 1000 / 30) / 2));
  if (t == null) return;
  app.player.seek(t, { exact: true });
}
const hasSeeds = guard((app) => !!app.doc.media && seedsOf(app).length > 0, (app) => (!app.doc.media ? 'Open a video first' : 'No seed frames: paint the parts with Groups (Tab) in the Track tab, or track a shot'));
// the keys (Shift+[ / Shift+]: the action edges' keys in the Scenes tab, the Suggest confidence's while the Groups tool is open)
// reach these everywhere else; the palette and the menus run them in every tab
const seedKeys = (app) => app.mode !== 'scenes' && !peekGroups?.(app)?.on;
/** paw-ef73.18: the plain keys' scope: the Scenes tab, with scenes (test/app-keys-scopes.test.mjs). */
export const scenesTab = guard((app) => app.mode === 'scenes' && has(app), (app) => (app?.mode !== 'scenes' ? 'Only in the Scenes tab' : whyOf(app, has)));
/** The selected cut (tl.cut) as the index of the shot after it, else -1. */
export const selectedCut = (app) => (tl.cut == null ? -1 : scenesOf(app).findIndex((s, k) => k > 0 && Math.abs(s.start_ms - tl.cut) < 1));

// ---- the bridge's timing option (lib/scenes-continue.js fillScript; the tracking store's `fills`, shown in the bridge ghost) ----
export const FILL_TEXT = { timing: 'timing from this shot' };
/** Plain words for a timing option that has nothing to show ({need} from the tracking store's `fills`): '' when it has. */
export function fillHint(f) {
  if (!f?.need) return '';
  return f.need === 'timing' ? 'Timing from this shot: no tracked motion in it yet (track it: a shot with this option is tracked for its turn times)'
    : 'Timing from this shot: the shots around it have too few strokes for the depth (needs 3 turns within 10 s)';
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** paw-2lp7.2: the action region commands (regions.js; the shim projects the regions onto the shots). */
export const actions = {
  over: (app) => {
    const l = scenesOf(app), sh = targetShots(app), h = selHull(l, sh);
    if (!h) return app.toast('No shot selected', 'quiet');
    const s = l[sh[0]], b = actsAt(app.doc.acts, (s.start_ms + s.end_ms) / 2).find((r) => r.layer === 0 && r.kind !== 'positioning');
    const r = addRegion(app.doc.acts, { kind: b?.kind ?? 'act', t0: h[0], t1: h[1], layer: 0, tags: b?.tags ?? [], ...(b?.range !== undefined ? { range: b.range } : {}), ...(b?.tease !== undefined ? { tease: b.tease } : {}) });
    app.transact('Action region', () => { app.doc.acts = r; });
    app.toast(`Action region over ${selText(l, sh)}: ${b?.tags?.join(' + ') || b?.kind || 'no act yet'}`, 'quiet');
  },
  removeHere: (app) => {
    const top = actsAt(app.doc.acts, now(app)).at(-1);
    if (!top) return app.toast('No action region here', 'quiet');
    app.transact('Remove action region', () => { app.doc.acts = deleteRegion(app.doc.acts, top.id); });
    app.toast(`Removed the action region ${top.tags.join(' + ') || top.kind}${top.layer ? ` (layer ${top.layer})` : ''}`, 'quiet');
  },
  fromScenes: (app) => {
    const a = actsFromScenes(app.doc.scenes);
    app.transact('Scene tags to action regions', () => { app.doc.acts = a; });
    app.toast(`Scenes converted to ${plural(a.length, 'action region')}`, 'quiet');
  },
};
const shotsAll = { id: 'timeline.scene.selectAll', title: 'Select all shots', keys: ['Ctrl+A'], group: 'scenes', hidden: true, when: scenesFocused, run: (app) => applySel(app, selAll(scenesOf(app)), 'all', { seek: false }) };
const shotsNone = { id: 'timeline.scene.selectNone', title: 'Select no shot', keys: ['Alt+A'], group: 'scenes', hidden: true, when: scenesFocused, run: (app) => { setSel(NO_SEL); app.usage?.note?.('scenes:select', { how: 'none' }); } };
export default [
  // Blender keys while the scenes lane has the keyboard; paw-qbvj: A toggles all / none, Ctrl+A all, Alt+A none
  shotsAll, shotsNone,
  toggleCmd({ id: 'timeline.scene.selectToggle', title: 'Select all / no shots (toggle)', group: 'scenes', hidden: true, when: scenesFocused, any: () => tl.shots.length > 0, all: shotsAll, none: shotsNone }),
  { id: 'timeline.scene.invertSelection', title: 'Invert the shot selection', keys: ['Ctrl+I'], group: 'scenes', hidden: true, when: scenesFocused, run: (app) => applySel(app, selInvert(scenesOf(app), selOf()), 'invert', { seek: false }) },
  { id: 'timeline.scene.delete', title: 'Remove the selected cuts (merge the shots)', keys: ['Delete', 'Backspace', 'X'], group: 'scenes', hidden: true,
    when: (app) => scenesFocused(app) || (scenesTab(app) && selectedCut(app) >= 1), run: (app) => (selectedCut(app) >= 1 ? structure.removeCut(app, selectedCut(app)) : structure.removeCuts(app)) },
  { id: 'timeline.shot.mergeSelected', title: 'Merge the selected shots into one', group: 'scenes', when: guard((app) => has(app) && selectedShots(scenesOf(app)).length > 1, (app) => whyOf(app, has) || 'Select two shots or more first'), run: (app) => structure.mergeSelected(app) },
  { id: 'timeline.shot.split', title: 'Cut the shot at the playhead (a cut inside the scene)', menu: 'Edit', group: 'scenes', when: has, run: (app) => structure.splitShot(app) },
  { id: 'timeline.shot.merge', title: 'Merge shot with next', group: 'scenes', when: guard((app) => has(app) && targetShot(app) >= 0 && targetShot(app) < scenesOf(app).length - 1, (app) => whyOf(app, has) || 'No shot after this one'), run: (app) => structure.mergeShot(app, targetShot(app), 1) },
  { id: 'timeline.shot.mergePrev', title: 'Merge shot with previous', group: 'scenes', when: guard((app) => has(app) && targetShot(app) > 0, (app) => whyOf(app, has) || 'No shot before this one'), run: (app) => structure.mergeShot(app, targetShot(app), -1) },
  { id: 'timeline.shot.take', title: 'Camera move or cut before the selected shots', group: 'scenes', when: has, run: (app) => structure.takeSelected(app) },
  { id: 'timeline.scene.offer.accept', title: "Accept the merged scene's tags and groups", group: 'scenes', hidden: true, when: has,
    run: (app, args) => structure.offer(app, args?.i ?? targetShot(app), args?.k ?? 0, true) },
  { id: 'timeline.scene.offer.drop', title: 'Drop what a merge offered', group: 'scenes', hidden: true, when: has,
    run: (app, args) => structure.offer(app, args?.i ?? targetShot(app), args?.k ?? 0, false) },
  // timeline.scene.tag.<id>: toggle a tag (or alias) on the selected scene (else the one at the playhead); a view tag replaces the other
  // (the modifier kinds are modifiers, not scene tags: their one command each is commands-mods timeline.mod.toggle.<kind>)
  ...[...TAG_CATEGORIES.filter((c) => c.id !== 'modifier').flatMap((c) => c.tags.map((t) => t.id)), ...Object.keys(ALIASES).filter((w) => Array.isArray(ALIASES[w]))].map((id) => ({
    id: `timeline.scene.tag.${id.replace(/ /g, '-')}`, title: `Scene tag: ${aliasParts(id) ? `${id} (${aliasParts(id).join(' + ')})` : tagLabel(id)}`, keys: TAG_KEYS[id] ? [TAG_KEYS[id]] : [],
    group: 'scenes', when: guard((app) => has(app) && tagShown(id), (app) => whyOf(app, has) || 'Show furry items to use this tag'),   // paw-43vn: a tag furry items off does not offer is not in the palette
    run: (app) => {
      const ra = selectedAct(app), ww = ['where', 'what'].includes(TAG[id]?.cat) || (!!aliasParts(id) && !TAG[id]);
      if (ra?.kind === 'act' && ww) { const t = toggleRegionTag(ra.tags, id); setRegionTagsCmd(app, ra.id, t, `Action tag: ${tagLabel(id)}`); return app.toast(regionWords({ ...ra, tags: t }), 'quiet'); }   // paw-2lp7.5: the selected region
      const sh = targetShots(app), i = sh[0];
      if (!scenesOf(app)[i]) return;
      toggleTagOnShots(app, sh, id);   // paw-k2u: every selected shot (view / camera) or every scene with one (the rest)
      const l = scenesOf(app), on = (aliasParts(id) ?? [id]).every((p) => hasTag(l[i], p));
      const what = sh.length > 1 ? selText(l, sh) : `Shot ${shotLabel(l, i)}`;
      app.toast(`${what}: ${tagLabel(id)} ${on ? 'on' : 'off'}`, 'quiet');
    } })),
  // paw-2lp7.2: action regions (app.doc.acts) until the Actions strip draws them (stage 2); one undo step each
  { id: 'timeline.acts.over', title: 'Action region over the selected shots', group: 'scenes', when: has, run: (app) => actions.over(app) },
  { id: 'timeline.acts.removeHere', title: 'Remove action region here (the top one at the playhead)', group: 'scenes', when: guard((app) => actsAt(app.doc.acts, now(app)).length > 0, 'Put the playhead on an action region'), run: (app) => actions.removeHere(app) },
  { id: 'timeline.acts.fromScenes', title: 'Rebuild action regions from the scene tags', group: 'scenes', when: has, run: (app) => actions.fromScenes(app) },
  // paw-2lp7.4: cutaway (Alt+C; C is circle select since paw-qbvj) and off-screen (Shift+C) in the Scenes tab or while the Scenes row
  // has the keyboard; the buttons on the shot
  { id: 'timeline.shot.cutaway', title: 'Cutaway on / off', keys: ['Alt+C'], group: 'scenes', when: guard((app) => scenesFocused(app) || scenesTab(app), (app) => whyOf(app, has) || KEYS_WHY),
    run: (app, args) => structure.cutaway(app, args?.shots ?? targetShots(app), args?.on) },
  { id: 'timeline.shot.offscreen', title: 'Off-screen on / off', keys: ['Shift+C'], group: 'scenes', when: guard((app) => scenesFocused(app) || scenesTab(app), (app) => whyOf(app, has) || KEYS_WHY),
    run: (app, args) => structure.cutaway(app, args?.shots ?? targetShots(app), args?.on, 'offscreen') },
  { id: 'timeline.shot.bridge.timing', title: 'Bridge: timing from this shot on / off', group: 'scenes', when: has,
    run: (app, args) => structure.timing(app, args?.shots ?? targetShots(app), args?.on) },
  // paw-ef73.18: the Scenes tab's single keys (scenesTab); one undo step each, structure on frame starts
  { id: 'timeline.key.cut', title: 'Scenes tab: cut here (split the shot at the playhead)', keys: ['K'], group: 'scenes', when: scenesTab, run: (app) => structure.splitShot(app) },
  { id: 'timeline.key.mergeNext', title: 'Scenes tab: merge with the shot to the right', keys: ['M'], group: 'scenes', when: scenesTab, run: (app) => structure.mergeAt(app, 1) },
  { id: 'timeline.key.mergePrev', title: 'Scenes tab: merge with the shot to the left', keys: ['Shift+M'], group: 'scenes', when: scenesTab, run: (app) => structure.mergeAt(app, -1) },
  { id: 'timeline.key.prevCut', title: 'Scenes tab: previous cut', keys: ['['], group: 'scenes', when: scenesTab, run: (app) => jumpCut(app, -1) },
  { id: 'timeline.key.nextCut', title: 'Scenes tab: next cut', keys: [']'], group: 'scenes', when: scenesTab, run: (app) => jumpCut(app, 1) },
  { id: 'timeline.key.prevSeed', title: 'Go to previous seed frame', tip: 'A painted or seeded frame, round the video', aliases: ['seed', 'painted frame', 'groups frame'],
    keys: ['Shift+['], group: 'scenes', keyWhen: seedKeys, when: hasSeeds, run: (app) => jumpSeed(app, -1) },
  { id: 'timeline.key.nextSeed', title: 'Go to next seed frame', tip: 'A painted or seeded frame, round the video', aliases: ['seed', 'painted frame', 'groups frame'],
    keys: ['Shift+]'], group: 'scenes', keyWhen: seedKeys, when: hasSeeds, run: (app) => jumpSeed(app, 1) },
  { id: 'timeline.key.nudgeEarlier', title: 'Scenes tab: move the cut one frame earlier', keys: [','], group: 'scenes', when: scenesTab, run: (app) => structure.nudgeCut(app, -1) },
  { id: 'timeline.key.nudgeLater', title: 'Scenes tab: move the cut one frame later', keys: ['.'], group: 'scenes', when: scenesTab, run: (app) => structure.nudgeCut(app, 1) },
  // a tag's span inside its scene: the quick bar chip last pointed at (tl.sceneTag)
  ...[['tagStart', 'Tag starts at playhead', setTagStart], ['tagEnd', 'Tag ends at playhead', setTagEnd], ['tagWhole', 'Tag covers the whole scene', null]].map(([k, title, set]) => ({
    id: `timeline.scene.${k}`, title, group: 'scenes', when: guard((app) => has(app) && !!tl.sceneTag, (app) => whyOf(app, has) || 'Point at a tag chip of the scene first'),
    run: (app) => {
      const i = tagTarget(app), s = scenesOf(app)[i] && sceneSpanOf(scenesOf(app), i), id = tl.sceneTag;   // the scene's edges, not the shot's
      if (!s || !hasTag(s, id)) return app.toast('Point at a tag chip of the selected scene first', 'quiet');
      const tags = set ? set(s, id, now(app)) : setTagEnd({ ...s, tags: setTagStart(s, id, null) }, id, null);
      if (tags === s.tags) return app.toast(`${tagLabel(id)} would be empty`, 'quiet');
      setSceneTags(app, i, tags, title);
    } })),
];
