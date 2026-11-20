// groups.svelte.js -- the Groups tool's state (paw-kkb): which scene and frame it paints on, the active group, the
// brush, the stroke in progress, and the sidecar's suggestions. Masks / polygons / storage are groups.js; drawing and
// the pointer are GroupsOverlay.svelte. The groups live in the document (scene.groups, undoable, saved in the .pawproj);
// one brush stroke, a rename, a delete, a toggle, a character swap or a Suggest is one undo step.
// Characters (paw-emy, PROTOCOL v4.12): the active character (Bottom / Top / Extra, keys 1 / 2 / 3) and a part chip pick the target
// group, who_part_side ('c2_hand_l'): painting edits it when the scene has it, else makes it on the first stroke.
// The playhead is the owner's (paw-1mo): nothing here seeks. Each group keeps its own seed frame (g.t_ms; paw-o74b "the
// second seed": a part that comes into view later in the take): the tool edits the groups seeded on the frame on screen,
// and painting on any other frame of the take (its other shots too: camera moves join them) ADDS groups seeded there; the
// take's other groups are drawn dimmed where a run tracked them on this frame (othersHere), listed with their seed frame
// (go there). paw-o74b.1: a part may be seeded on any number of frames of the take (re-anchoring it where its look changed:
// an orbit, a part that turns, drift): painting a part seeded elsewhere makes another seed of it (same name and colour; a
// stroke over its dimmed tracked outline proposes that part: Enter takes it); never two seeds of one part on one frame.
// Only "New groups for this shot" (paw-do8a) divides a take: the camera move before the shot on screen becomes a cut (a
// new seed), one undo step.
// Paint first, assign after (paw-1mo): with no part armed a stroke that starts on a group adds to it, else it makes a new
// unassigned group (Ctrl+drag: a new one even on top of another); the picker (A, right click, the assign-all pass) or a
// palette label dropped on a group gives it a character and part. Arming a palette part paints that part as before.
// The learned seeder (paw-bn2, PROTOCOL v4.18): Suggest asks the part head trained on the owner's painted groups (the
// seed library: settings 'tracking.seeder.folders', else the folders of recent projects; stored in <app data>/seeder),
// picks the frame with the most confident parts in the take's first 2 s (shown, never sought), and every suggestion
// carries its confidence; accepting / repainting / reassigning one makes it a painted group (a training label). After a
// save whose painted groups changed, the seeder retrains in the background (a Track preempts it).
// Filling from repeats (paw-8mf4, repeat-groups.js): a take without groups, selected with the tool open, is filled from
// a matching frame elsewhere (painted groups copied, or a stored run's seeded points) as one undo step, at most once
// per take (the project remembers it: doc.repeats.filled); setting 'tracking.groups.autoFromRepeats' turns it off (the
// toolbar's "Use groups from" then does it). Copies are not training labels until the owner edits the take (#put).
// Copy from… (paw-lgtx, copy-from.js; key C, a toolbar button): a strip of up to six frames of this video whose groups could
// seed the frame on screen (a run's points here, painted frames by likeness, other tracked frames); hover previews them
// lined up, a click (or 1..6) copies them as one undo step after the sidecar re-finds each named group here. paw-55la: a
// two-way search: each tile is a source at the frame of the shot on screen it matches best; hover peeks there, a click goes there.
import { rooted } from '../../lib/rooted.svelte.js';
import { trackingFor } from './tracking.svelte.js';
import { nameGroupsRequest, suggestGroupsRequest, seedTrainRequest, seedCompareRequest, segmentRequest } from '../../lib/protocol.js';
import { datasetsFor } from '../labelling/datasets.svelte.js';
import { trainScope, namerScope } from '../labelling/datasets.js';
import { sceneIndexAt } from '../timeline/scenes.js';
import { IGNORE, tidySeeds, peekFrames, peekAt, maskFp, GROUP_NAMES, WHOS, PAIRED, pairSide, maskSize, maskOf, cloneMask, stroke, fitPoly, splitMask, eraseIslands, transformMask, groupsAt, maskAt, polyArea, isUnassigned, freeUnassigned, assignGroup, swapAssign, encodeMask, rasterPoly, freeName, isPinned, groupName, splitName, swapWho, takeGroups, setTakeGroups, priorFor, suggestedGroups, splitByConfidence, youngNote, SUGGEST_CONF, SUGGEST_CONF_MIN, canPulse, isPulse, togglePulse, canShaft, isShaft, toggleShaft, canDepth, isDepth, toggleDepth, isSuggested, isCopy, isIgnore, noPoints, acceptGroup, seedCandidates, seedFolders, paintedKey, decodeMask, mayOverlap, partLabel, partWord, whoName, erasedOf, nextErased, clipErased, withErased, foldKnots, knotOf, withKnot } from './groups.js';
import { nameMasks, readProposals, planConfirm, proposedSides, sureWho, NAMED_BY, knotRegion, maskCentre } from './autoname.js';
import { takeRange, setTake, shotLabel } from '../timeline/shots.js';
import { tlFor, scenesOf, durOf } from '../timeline/state.svelte.js';
import { paintTarget } from '../timeline/quickbar.js';
import { edgeMap, snapMask, signedDistance, insetOutline, marginFor, MARGIN_DEFAULT } from './snap.js';
import { hasScore, scoreLine } from './seed-score.js';
import { loopFrom, fillLoop, mergeFill, rasterLoop } from './fill.js';
import { makeDial, decodeLogits, fineStep, moved, NOTCH_AREA, DIAL_FINE, dialRequest, stepOf, chooseLarger, chooseSmaller, insidePoints, STEP_RETRY, LOOSE_CAP, MIN_PX, MIN_FRAC } from './loosen.js';
import { ABSURD_IMAGE, strokePoints, strokeExtent, loopPrompt, toFrac, pickMask, cleanMask, resizeMask, latest } from './grow.js';
import { createFrames } from '../assist/frames.js';
import { repeatsOf, occurrencesOf } from '../timeline/repeats.svelte.js';
import { preferredPictures } from '../timeline/loop-look.svelte.js';   // paw-llaa: the loops' preferred frames
import { repeatTargets, copyGroupsTo, occurrenceAtTime, repeatCandidates, findFill, fillTake, bestPaintFrame, takeKey } from './repeat-groups.js';
import { fmtClock } from '../timeline/ticks.js';
import { seedsOf, setSeed } from '../timeline/mod-runs.js';
import { seedWindow, seedAt, HINT as SEED_HINT } from '../../lib/seed-window.js';
import { transitionsOf } from '../timeline/transitions.svelte.js';
import { FP, THUMB_W, MAX as COPY_MAX, greyN, likeness, IDENTITY, paintedSources, runsHere, trackedSources, sourceGroups, moveGroups, shotFrames, coarseFrames, aroundFrames, bestPairs, tierOf, landCopies, linkFor, boxXf, cropXf, cropDist, regionOf, regionNcc, jointFit, alignRegion } from './copy-from.js';
import { printDist } from '../../lib/scenes-continue.js';
import { grey as greyBig, pyramid, printSize } from '../../lib/crop-match.js';
import { gridOf } from '../../lib/lane.js';
import { createScrubber, UNREADABLE } from '../video/scrub.js';
import { trackedPoly, ownerAt } from '../../lib/runs-add.js';

const DIAL_DELTA = 100, DIAL_IDLE_MS = 400, FILL_NOTCHES = Math.round(6 / DIAL_FINE);   // grow to fill: the same ~12 mask px as before the notch became fine   // wheel delta per notch (a mouse wheel click is 100); the gesture ends this long after the last notch
const REST_MS = 150;   // paw-o60v.6: the stroke's outline (and the edge snap) is fitted once the pen rests this long mid-stroke, and at pen up; never per move
const NAME_IDLE_MS = 1000;   // paw-wzxu: part naming asks once the strokes have stopped this long (pen up), never while painting
const DOUBLE_MS = 350, DOUBLE_R = 0.75;   // two grow dabs this close in time and within this x the brush radius of each other, on a grown group, are grow to fill (paw-k8jj)
/** paw-wzxu: may a SAM prompt go to the sidecar now? Idle, a background retrain (it is cancelled) or a naming call (the prompt waits for it, ~0.3 s). */
const samFree = (tr) => !tr.busy || tr.busy === 'name' || (tr.busy === 'seed' && tr.owner === 'seeder');
const area = (a) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= 0.5) n++; return n; };
const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);
const HIT = 0.15;   // a stroke starting where a group's mask is at least this adds to it (its soft edge: ~0.2 r past the outline)
export const BRUSH = { min: 0.005, max: 0.25, default: 0.04 };   // brush radius, frame heights (settings 'tracking.groups.brush')

class GroupsTool {
  on = $state(false);
  scene = $state(-1);         // the scene painted on (its index in app.doc.scenes)
  active = $state(-1);        // index into the scene's groups (-1: the next stroke starts a new group named nextName)
  nextName = $state('c1_other');
  who = $state('c1');         // the active character: new groups and part chips are its
  nextPart = $state('other'); // the part (and side, the character's own, for a paired part) of the next new group
  nextSide = $state('l');
  busy = $state(false);       // a Suggest is running
  draft = $state.raw(null);   // the stroke in progress: {k, g, mask, poly, blobs, islands, last}
  xf = $state.raw(null);      // a grab (G) / scale (S) of the active group in progress: {kind, k, g, base, c, mask, poly}
  nudge = $state(0);          // a click off the groups' frame: the overlay flashes where they are
  armed = $state(false);      // a palette part is armed: strokes paint nextName (its group, or a new one)
  picker = $state.raw(null);  // the assign picker: {k, at: [x, y] stage px | null (at the group), pass: the assign-all pass}
  growBusy = $state(false);   // a SAM prompt is out (grow, paw-liwk): the overlay shows a busy mark
  growAt = $state.raw(null);  // [nx, ny] where the last grow prompt was made (the busy mark)
  growNote = $state('');      // why grow could not run last time ('' = fine)
  pickHover = $state('');     // the part under the pointer in the picker (a group name): the overlay previews its colour on the group being assigned
  flash = $state.raw(null);   // {name, t0}: a group just assigned (the overlay flashes it in its new colour)
  tick = $state(0);           // the groups as drawn changed (repaint); a stroke's paint is not: onStroke
  onStroke = null;            // paw-o60v.6: () -> void, the overlay's stroke canvas: called per pointer sample (it draws once a frame) and when the outline is fitted
  picked = $state.raw(null);  // Suggest chose another frame of the take: {t, parts, here: parts on the frame on screen, from}
  seeder = $state.raw(null);  // the learned seeder's record (seed_train / head.json): {frames, videos, parts, trained_at} | null
  training = $state(false);   // a seed_train job is queued or running
  lasso = $state.raw(null);   // circle to fill (paw-714j): the thin loop being drawn {pts: [[nx, ny], ...], force}
  lastFill = null;            // {ms, mode, grew, shrank, replaced} of the last circle fill (the check scripts read it)
  overview = $state.raw([]);  // paw-855t: every listed dataset's trained record and score: [{id, name, active, frames, score}] (the seeder row's side-by-side)
  cross = $state.raw(null);   // paw-855t: every head scored on the ACTIVE dataset's labels (seed_compare / <dataset>/cross.json)
  namer = $state.raw(null);   // v4.38: the one namer of every dataset: its summary (seed_train's namer / <seeder>/namer.json): held-out score, what it learned from
  whoSet = $state.raw(new Map());    // paw-cnfg: unassigned group object -> the character the owner gave it (hover + 1 / 2 / 3); Enter confirms its proposal as that
  sideSet = $state.raw(new Map());   // ... and the side the owner flipped it to (hover + F)
  peek = $state.raw(null);           // paw-bsyo: {k (frames from the seed frame), ms} while the peek key is held: the video scrubs around the seed frame, the groups stay where painted, nothing paints
  hoverK = $state(-1);               // the group under the pointer (the overlay keeps it: hint line)
  proposals = $state.raw(new Map());   // paw-p9ve: unassigned group object -> the model's proposed name {parts, conf, auto, who} (tentative: never saved as a name)
  nameJob = null;             // (request) -> the job's result; labelling sets it (the video tool uses the tracker queue)
  labelTarget = null;         // labelling: () => {image, key} of the picture on screen
  #nameTimer = null; #nameRun = null; #nameTok = 0; #namedFor = null; #nameWant = 0; #nameBusy = false;
  labelSuggest = null;        // labelling: the workspace's Suggest for the image on screen
  labelMode = false;          // paw-714j: painting on a still image of the labelling workspace (app = its frame-source facade): no Suggest / repeats / seeder row
  #seedDir = undefined;       // <app data>/seeder (null outside Tauri)
  #lastPainted = null;        // paintedKey at the last retrain request (a save without new labels does not retrain)
  cache = new WeakMap();      // stored group object -> its decoded mask (an undo brings the old objects back: their masks too)
  fits = new WeakMap();       // stored group object -> fitPoly of its mask (its patches: islands)

  constructor(app) { this.app = app; }
  /** paw-855t: the seeder datasets (shared by the Track tab and the labelling workspace: one active dataset, whose head Suggest uses). */
  get datasets() { return datasetsFor(this.app.real || this.app, () => this.seedDir()); }
  /** The active dataset {id, name, projects, dir, labels, seed} (its head, score and labels), or null outside the app. */
  async dataset() { await this.datasets.ready(); return this.datasets.info(); }
  get tr() { return trackingFor(this.app); }
  get scenes() { return this.#split || this.app.doc.scenes || []; }
  #split = null;   // the shots with the take divided before the stroke's shot, while that first stroke is drawn (paw-do8a)
  /** The groups the tool shows and edits: the take's groups seeded on the frame on screen (paw-o74b: each group keeps its
   *  own seed frame, g.t_ms; scenes contain shots: a scene's groups, the ones drawn in this take). A modifier's seed entry k. */
  get groups() { if (this.mod) return seedsOf(this.modObj)[this.mod.k]?.groups ?? []; const all = this.all, t = this.t; return all.filter((g) => this.#onT(g, t)); }
  /** Every group of the take, whatever frame it was seeded on. */
  get all() { return this.mod ? this.groups : takeGroups(this.scenes, this.scene); }
  /** The take's groups seeded on other frames than the one on screen (drawn dimmed, never edited here). */
  get others() { if (this.mod) return []; const all = this.all, t = this.t; return all.filter((g) => !this.#onT(g, t)); }
  /** The take's seed frames (ms), in time order. */
  get seedFrames() { return [...new Set(this.all.map((g) => g.t_ms).filter(Number.isFinite))].sort((a, b) => a - b); }
  /** paw-o74b.1: the take's seed frames of part `name` (ms, time order): the dock's frame chips. */
  seedsOfPart(name) { return [...new Set(this.all.filter((g) => g.name === name).map((g) => g.t_ms).filter(Number.isFinite))].sort((a, b) => a - b); }
  /** Group g belongs to frame t (a group without a frame: to the take's first seed frame). */
  #onT(g, t) { const s = Number.isFinite(g.t_ms) ? g.t_ms : this.seedFrames[0]; return s == null || Math.abs(s - t) <= this.#slack; }
  get #slack() { return Math.max(20, (this.app.player.frameMs || 33) * 0.75); }
  // paw-ef73.26: painting a modifier's seed (timeline/mod-runs.js): {id, k (its seed entry: 0 the seed frame, more =
  // corrections), tracker (what T runs then)}; the strokes go to that modifier, never to the take's groups
  mod = $state.raw(null);
  get modObj() { return this.mod ? (this.app.doc.fx || []).find((e) => e.id === this.mod.id) ?? null : null; }
  get size() { return maskSize(this.tr.aspect); }
  get radius() { return Math.min(BRUSH.max, Math.max(BRUSH.min, +this.app.settings.get('tracking.groups.brush', BRUSH.default) || BRUSH.default)); }
  setRadius(r) { this.app.settings.set('tracking.groups.brush', Math.min(BRUSH.max, Math.max(BRUSH.min, +r.toFixed(4)))); }
  resize(f) { this.setRadius(this.radius * f); }
  get activeGroup() { return this.groups[this.active] || null; }
  maskFor(g) { let m = this.cache.get(g); if (!m) { m = maskOf(g, this.size); this.cache.set(g, m); } return m; }
  /** fitPoly of a stored group's mask (cached): its islands, the patches its polygon leaves out. */
  fitFor(g) { let f = this.fits.get(g); if (!f) { f = fitPoly(this.maskFor(g)); this.fits.set(g, f); } return f; }
  /** What group k looks like right now: the stroke or transform in progress on it, else null (as stored). */
  liveFor(k) { const d = this.draft || this.xf || this.dial; return d && d.k === k ? d : null; }
  /** Ask (the picker) after each stroke that makes a new unassigned group (settings 'tracking.groups.askAfter'). */
  get askAfter() { return !!this.app.settings.get('tracking.groups.askAfter', false); }
  /** Indices of the take's unassigned groups, in painting order. */
  get unassigned() { return this.groups.map((g, k) => (isUnassigned(g) ? k : -1)).filter((k) => k >= 0); }
  /** The group under frame point (nx, ny): the active one when the point is on it (its painted mask, soft edge
   *  included: a small tolerance past the outline), else the smallest one there; -1 for none. Hidden groups never. */
  hitAt(nx, ny) {
    const gs = this.groups, on = (k) => !gs[k].off && maskAt(this.maskFor(gs[k]), nx, ny) >= HIT;
    if (gs[this.active] && on(this.active)) return this.active;
    let best = -1;
    gs.forEach((g, k) => { if (on(k) && (best < 0 || polyArea(g.poly) < polyArea(gs[best].poly))) best = k; });
    return best;
  }
  /** What a stroke starting at (nx, ny) works on: {k} an existing group, or {k: -1, name} a new one. Erase: the group
   *  under it, else the active one. Armed: the armed part's group (force: a new one of it). Else the group under it, a
   *  new unassigned one when there is none (force: always new). */
  strokeTarget(nx, ny, erase = false, force = false) {
    if (erase) { const k = this.hitAt(nx, ny); return { k: k >= 0 ? k : this.active }; }
    if (this.armed) return force || this.active < 0 ? { k: -1, name: freeName(this.groups, this.nextName) } : { k: this.active };
    const k = force ? -1 : this.hitAt(nx, ny);
    return k >= 0 ? { k } : { k: -1, name: freeUnassigned(this.all) };
  }
  /** The shot whose picture frame t shows (the frame's middle: a shot starting a hair after the frame's time, as a
   *  cut list in float ms does, is still the shot of that frame). */
  #sceneAt(t) { return sceneIndexAt(this.scenes, t + (this.app.player.frameMs || 33) / 2); }
  /** Frame time t as a group's t_ms: whole ms inside the take the tool is on (never rounded into the shot before). */
  stampOf(t) {
    const m = this.modObj;
    if (m) return Math.min(Math.ceil(m.t1) - 1, Math.max(Math.ceil(m.t0), Math.round(t)));   // a modifier's seed: inside it
    const r = takeRange(this.scenes, this.scene);
    if (!r) return Math.round(t);
    const lo = Math.ceil(this.scenes[r[0]].start_ms), hi = Math.ceil(this.scenes[r[1]].end_ms) - 1;
    return Math.min(hi, Math.max(lo, Math.round(t)));
  }
  /** The frame (ms) the tool paints on: a seed frame of the take when the frame on screen is one (one frame of slack), else
   *  the frame on screen (paw-o74b: painting there adds groups seeded on it; the tracker seeds each group on its own frame).
   *  A modifier's seed: its entry's frame. Derived from the document, so an undo / redo of a move brings it along. */
  get t() {
    const now = this.app.player.timeMs;
    if (this.mod) { const g = this.groups.find((x) => Number.isFinite(x.t_ms)); return g ? g.t_ms : this.stampOf(now); }
    if (this.peek) return this.peek.base;   // peeking: the groups stay on the frame peeked around
    const s = this.seedFrames.find((x) => Math.abs(x - now) <= this.#slack);
    return s ?? this.stampOf(now);
  }
  // ---- peek (paw-bsyo): hold a key, move the mouse sideways to scrub around the seed frame; release = back on it ----
  /** The take's time span a peek stays in: [first frame, last frame] (a modifier's seed: inside the modifier). */
  peekBounds() {
    const m = this.modObj;
    if (m) return [Math.ceil(m.t0), Math.ceil(m.t1) - 1];
    const r = takeRange(this.scenes, this.scene);
    return r ? [Math.ceil(this.scenes[r[0]].start_ms), Math.ceil(this.scenes[r[1]].end_ms) - 1] : [0, Infinity];
  }
  peekStart() {
    if (!this.on || this.peek || this.draft || this.xf || this.lasso || this.picker || !this.groups.some((g) => Number.isFinite(g.t_ms))) return false;
    this.app.player.pause();
    const t = this.t;   // paw-o74b: the seed frame peeked around (the frame on screen moves while peeking)
    this.peek = { ...peekAt(t, Math.round((this.app.player.timeMs - t) / (this.app.player.frameMs || 33)), this.app.player.frameMs || 33, ...this.peekBounds()), base: t };
    return true;
  }
  peekTo(k) {
    if (!this.peek) return;
    const base = this.peek.base;
    this.peek = { ...peekAt(base, k, this.app.player.frameMs || 33, ...this.peekBounds()), base };
    this.app.player.seek(this.peek.ms);
  }
  /** The drag: `base` (frames from the seed frame when it began) moved by dx px. */
  peekDrag(base, dx, fine = false) { this.peekTo(base + peekFrames(dx, fine)); }
  peekStep(dir) { if (this.peek) this.peekTo(this.peek.k + dir); }
  /** Key released: back on the exact seed frame, painting continues. */
  peekEnd() { if (!this.peek) return false; const base = this.peek.base; this.peek = null; this.app.player.seek(base); return true; }
  /** Is the playhead on the frame the groups are painted on (one frame of slack)? */
  get onFrame() { return Math.abs(this.app.player.timeMs - this.t) <= Math.max(20, (this.app.player.frameMs || 33) * 0.75); }
  /** Suggest put its groups on another frame of the take than the one on screen: that pick ({t, parts, here, from}), else null.
   *  (Since paw-o74b every frame of the take paints, so "off the groups' frame" no longer says it: the notes card asks this.) */
  get pickedAway() { const p = this.picked; return p && p.t !== this.t ? p : null; }
  /** paw-do8a: the frame on screen is in another shot of the take than (the nearest of) its groups' frames (camera moves
   *  join them): -> the shot list with the take divided between the two (the camera move before the shot on screen, or
   *  after it when the groups come later, becomes a cut: a new seed there) -> {list, k (the shot on screen), before}, else
   *  null. paw-o74b: only the explicit "New groups for this shot" divides a take; painting there adds groups to it. */
  get splitHere() {
    const sc = this.app.doc.scenes || [];
    if (this.#split || this.mod || this.peek) return null;
    const now = this.app.player.timeMs, k0 = this.#sceneAt(now);
    const far = this.seedFrames.filter((x) => this.#sceneAt(x) !== k0).sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0];
    if (far == null) return null;
    const k = k0, j = this.#sceneAt(far), r = takeRange(sc, this.scene);
    if (k < 0 || j < 0 || k === j || !r || k < r[0] || k > r[1] || j < r[0] || j > r[1]) return null;
    const list = setTake(sc, k > j ? k : k + 1, false);
    return list && { list, k, before: k > j };
  }
  /** "New groups for this shot": divide the take (splitHere) so the shot on screen paints its own (one undo step). */
  newHere() {
    const l = this.splitHere?.list;
    if (!l) return false;
    this.app.transact('Groups: new groups for this shot (the camera move becomes a cut)', () => { this.app.doc.scenes = l; });
    this.scene = this.#sceneAt(this.app.player.timeMs);
    this.active = -1;
    this.app.usage?.note('tracking:groupsNewHere', { shot: this.scene });
    return true;
  }

  /** key: opened by its key (Tab). paw-iwb7: Tab while hover scrub shows the frame under the pointer on the timeline takes that
   *  frame (the playhead onto exactly the frame shown) and asks GroupsOverlay to put the pointer on the picture (setting
   *  'tracking.groups.tabPointer'). While the tool is open hover scrub moves nothing (player.hoverHold: the lanes read it). */
  toggle(on = !this.on, { key = false } = {}) {
    const app = this.app, tr = this.tr;
    if (on) {
      if (!app.doc.media) return;
      const hovered = key && !this.labelMode && app.player.scrubTime != null && app.settings.get('lanes.hoverScrub', false) === true;
      if (hovered) { const p = app.player; if (p.seekFrame) p.seekFrame(p.frame); else { p.scrubTime = null; p.seek(p.timeMs); } }   // (the plain clock player: no frames of its own)
      const now = app.player.timeMs, at = this.#sceneAt(now), i = at >= 0 ? at : tr.currentScene;
      if ((i < 0 || !this.scenes[i]) && !this.mod) { app.toast('Groups are drawn per scene: detect scenes first (Actions panel)', 'info'); return; }
      tr.toggleAxisTool(false);
      // the frame on screen is the one to paint on; a take that has groups keeps theirs (shown, never jumped to)
      this.scene = i;
      this.#tidy();   // paw-o74b.1: an older project's seeds that cannot be tracked
      // paw-ef73.9: a take without groups, the playhead in its fade in / out or camera lead-in: onto good data (once a hint)
      const w = !this.mod && !this.all.length ? seedWindowOf(app, i) : null, to = w ? seedAt(w, now, app.player.frameMs || 33) : now;
      const why = to > now ? w.why : 'out';
      if (w && Math.abs(to - now) > 1) { app.player.seek(this.stampOf(to)); if (!hinted.has(why)) { hinted.add(why); app.toast(SEED_HINT[why], 'info'); } }
      this.active = this.groups.length ? 0 : -1;
      if (this.activeGroup?.who) this.who = this.activeGroup.who;
      if (this.armed && this.active < 0) this.#target(this.nextPart, this.nextSide);
      app.player.pause();
      app.usage?.note('tracking:groups', i);
      if (!this.seeder) this.loadSeeder();
      this.#prefetchSoon();
      this.#warmCopy();
      if (hovered && app.settings.get('tracking.groups.tabPointer', true) !== false) this.tabTo++;
    } else { this.peekEnd(); this.closeCopy(); this.#cWarm++; if (this.#cf) { this.#cf.scrub?.then((s) => s?.dispose()); this.#cf.scrub = null; }   /* paw-55la: the prints stay (per video), the decoder goes */ if (this.draft?.waiting) { const d = this.draft; this.draft = null; d.snap = false; this.#finish(d); } else if (this.draft) this.end(); this.#frames?.dispose(); this.#frames = null; this.#framesUrl = ''; }   // closing mid-stroke keeps the paint (Esc cancels it first)
    this.commitDial();
    this.xf = null; this.picker = null;
    this.draft = null;
    this.on = on;
    if (!this.labelMode && app.player) app.player.hoverHold = on;
    if (!on) this.mod = null;
  }
  /** Follow the scene under the playhead while the tool is open; with no groups yet the frame follows the playhead too
   *  (the owner picks the frame to paint on), after that it stays where they were painted. */
  follow(t) {
    if (!this.on || this.draft) return;
    if (this.copy && this.#sceneAt(t) !== this.copy.shot) this.closeCopy(false);   // paw-55la: the strip is for the shot it opened on (a hovered tile moves the playhead inside it)
    this.#prefetchSoon();
    if (this.xf) return;
    const i = this.#sceneAt(t), r = takeRange(this.scenes, this.scene);
    if (i >= 0 && r && i >= r[0] && i <= r[1] && i !== this.scene) this.scene = i;   // the same take: same groups, same frame
    else if (i >= 0 && i !== this.scene) { this.scene = i; this.#tidy(); this.active = this.groups.length ? 0 : -1; }
    const ft = this.t;   // paw-o74b: onto another seed frame (or off them): its own groups, the first one active
    if (ft !== this.#followT) { this.#followT = ft; this.active = this.groups.length ? 0 : -1; this.picker = null; if (this.armed && this.active < 0) this.#target(this.nextPart, this.nextSide); }
    if (this.active >= this.groups.length) this.active = this.groups.length - 1;
  }
  #followT = null;
  /** One undo step: the take's groups replaced. An edit makes groups copied from a repeat (paw-8mf4) the owner's: the
   *  take counts as hand-painted from then on (source 'user', a training label). */
  #put(label, groups) {
    const m = this.modObj;
    if (m) { const next = setSeed(m, this.mod.k, groups, this.t); this.app.transact('Modifier seed: ' + label, () => { this.app.doc.fx = (this.app.doc.fx || []).map((e) => (e.id === m.id ? next : e)); }); this.proposeSoon(); return; }
    const i = this.scene, split = !!this.#split, others = this.others;
    // paw-o74b.1: a part seeded on another frame too is another seed of it (no refusal any more): the take may hold one part on
    // any number of frames; this frame's list never holds one part twice (its names are free names of this frame)
    if (groups.some(isCopy)) groups = groups.map((g) => { if (!isCopy(g)) return g; const u = acceptGroup(g); this.cache.set(u, this.maskFor(g)); return u; });
    const next = setTakeGroups(this.scenes, i, [...others, ...groups]);
    this.#split = null;
    const keep = (m) => (m.size ? new Map([...m].filter(([g]) => groups.includes(g))) : m);
    if (this.whoSet.size) this.whoSet = keep(this.whoSet);
    if (this.sideSet.size) this.sideSet = keep(this.sideSet);
    this.app.transact('Groups: ' + label, () => { this.app.doc.scenes = next; });   // a first stroke in another shot: the take's division with it
    if (split) this.app.usage?.note('tracking:groupsNewHere', { shot: i, stroke: true });
    this.proposeSoon();
  }
  // ---- auto-naming (paw-p9ve, autoname.js): a blob painted, then a proposal a moment later ----
  // paw-wzxu: naming is the lowest priority on the sidecar queue. It asks once the strokes have stopped for NAME_IDLE_MS with the pen
  // up (no stroke, dial or grow prompt out), never two at a time; a new stroke / dial drops the pending round, a queued call and the
  // answer of the one in flight (its groups are changing). The call in flight is NOT killed: the resident sidecar only stops a job at
  // its next event and kills the whole process (every loaded model) 5 s later, while a naming call takes ~0.3 s (the owner's log:
  // p50 331 ms, p90 617 ms); SAM prompts queue behind it instead and run the moment it returns.
  /** Ask the model for the unnamed blobs' parts once the groups stopped changing (a stroke, a name, an undo): the named blobs go along as context. */
  proposeSoon(ms = NAME_IDLE_MS) {
    clearTimeout(this.#nameTimer);
    this.#nameTimer = null;
    if (!this.on || !this.unassigned.length) { this.#nameDrop(); if (this.proposals.size) this.proposals = new Map(); return; }
    this.#nameTimer = setTimeout(() => {
      this.#nameTimer = null;
      if (this.draft || this.dial || this.growBusy) { this.proposeSoon(); return; }   // still painting: wait for the pen to rest
      this.#nameGo();
    }, ms);
  }
  /** One naming round, after the one in flight (never two); a round superseded before it starts is skipped. */
  #nameGo() {
    const want = ++this.#nameWant;
    this.#nameRun = Promise.resolve(this.#nameRun).then(async () => {
      if (want !== this.#nameWant) return;
      this.#nameBusy = true;
      try { await this.#propose(); } finally { this.#nameBusy = false; }
    }).catch(this.#failed);
    return this.#nameRun;
  }
  /** The groups are changing: the answer in flight is stale, a queued naming call never starts. */
  #nameDrop() { this.#nameTok++; this.#namedFor = null; this.#realTr.dropQueued?.('name'); }
  /** A stroke / dial gesture starts: a pending or running round is dropped and asked again once the pen rests. */
  #nameHold() { if (!this.#nameTimer && !this.#nameBusy) return; this.#nameDrop(); this.proposeSoon(); }
  /** Resolves when the proposals for the groups as they are now have arrived (Enter waits for them). */
  async proposalsSettled() {
    if (this.#nameTimer) { clearTimeout(this.#nameTimer); this.#nameTimer = null; this.#nameGo(); }
    else if (this.on && this.#namedFor !== this.groups && this.unassigned.some((k) => !this.proposals.has(this.groups[k]))) this.#nameGo();   // an undo brought groups back / a round was dropped: ask now, once
    await this.#nameRun;
  }
  /** A naming round is pending or out (Enter waits for it rather than doing nothing). */
  get naming() { return !!this.#nameTimer || this.#nameBusy; }
  async #propose() {
    const tok = ++this.#nameTok, groups = this.groups, { masks, at } = nameMasks(groups);
    this.#namedFor = groups;
    if (!at.size || !this.onFrame) return;
    const target = this.labelMode ? this.labelTarget?.() : this.tr.videoPath ? { video: this.tr.videoPath, t_ms: this.t, key: await this.mediaKey() } : null;
    const job = this.nameJob || (this.labelMode ? null : (req) => this.tr.job('name', req, { title: 'Naming groups', owner: 'name' }));   // its own label: busy 'groups' is Suggest, and the Groups tool closes for any other job (a track): a proposal round must not close it
    if (!target || !job) return;
    if (!target.key) return this.#said('Part proposals need the video fingerprinted and it could not be read');
    const dir = await this.seedDir(), ds = await this.dataset();
    if (!dir || tok !== this.#nameTok) return;
    const r = await job(nameGroupsRequest({ ...target, masks, ignore: groups.filter(isIgnore).map((g) => g.mask).filter((m) => m?.rle), seed: { dir, dataset: ds?.dir, key: target.key, features: this.app.settings.get('tracking.seeder.features', 'auto') } }));
    if (tok !== this.#nameTok || r?.cancelled) return;
    if (r?.error) return this.#said('Part proposals failed: ' + String(r.error).split(/\r?\n/)[0]);
    // paw-vhcd: the tracker's "no naming model ...: Train" in words a newcomer can act on
    const note = /^no naming model/i.test(r?.result?.note || '') ? 'nothing learned for these part names yet: it learns from the groups you paint, after a save' : r?.result?.note;
    if (note && !r.result.blobs?.some((b) => b.part?.length)) this.#said('No part proposals: ' + note); else this.#nameSaid = '';
    const found = readProposals(r.result, at), keep = new Map();
    for (const g of this.groups) { const own = this.proposals.get(g); if (own?.fixed) keep.set(g, own); else if (found.has(g)) keep.set(g, found.get(g)); }   // a group repainted meanwhile is another object: its proposal waits for the next round; Find knot's stays
    this.proposals = keep;
  }
  #nameSaid = '';
  #failed = (e) => this.#said('Part proposals failed: ' + String(e?.message || e).split(/\r?\n/)[0]);
  /** A proposal that did not come says why, once (a toast), until one arrives or the reason changes. */
  #said(msg) { if (msg !== this.#nameSaid) { this.#nameSaid = msg; this.app.toast?.(msg, 'info'); } }
  /** The video's key for the seeder (its cached features, its painted characters): the saved fingerprint, else the same
   *  fingerprint computed now (a project never saved has none yet: the save stores this very value). '' when unreadable. */
  async mediaKey() {
    const m = this.app.doc.media, be = this.app.backend;
    if (m?.hash?.value) return m.hash.value;
    if (!m?.path || typeof be?.fileFingerprint !== 'function') return '';
    if (this.#fp?.path !== m.path) this.#fp = { path: m.path, value: Promise.resolve(be.fileFingerprint(m.path)).then((f) => f?.fingerprint || '', () => '') };
    return this.#fp.value;
  }
  #fp = null;
  /** The proposal for group g (unassigned, not repainted since), or null. */
  proposalFor(g) { return this.proposals.get(g) || null; }
  /** How many unassigned groups Enter would name now. */
  get confirmable() { return planConfirm(this.groups, this.proposals, this.who, this.mine).length; }
  get mine() { return { whos: this.whoSet, sides: this.sideSet }; }
  /** paw-5r1: the side an unassigned blob with a paired-part proposal would get: {side, how: 'own' | 'pair' | 'default'} | null
   *  (autoname.proposedSides: the owner's F, else the other limb of that character, else the character's L). */
  proposedSide(g) { const k = this.groups.indexOf(g); return k < 0 ? null : proposedSides(this.groups, this.proposals, this.who, this.mine).get(k) || null; }
  /** The character shown on an unassigned blob: the owner's, else the model's appearance guess, else the active one. */
  whoFor(g, p = this.proposalFor(g)) { return this.whoSet.get(g) || sureWho(p) || this.who; }
  /** Confirm every confident proposal as the owner's label (named_by 'auto'; the active character; one undo step) -> how many. */
  confirmProposals() {
    if (this.draft || this.xf || !this.onFrame) return 0;
    const plan = planConfirm(this.groups, this.proposals, this.who, this.mine);
    if (!plan.length) return 0;
    let list = this.groups;
    for (const { k, who, part, side } of plan) {
      const out = assignGroup(list, k, { who, part, side });
      if (out === list) continue;
      list = out;
      list[k] = { ...acceptGroup(list[k]), named_by: NAMED_BY };
    }
    this.#putSame(`name ${plan.length} by proposal`, list);
    this.flash = { name: list[plan[plan.length - 1].k].name, t0: performance.now() };
    this.app.usage?.note('tracking:groupsAutoNamed', { n: plan.length, left: this.unassigned.length });
    return plan.length;
  }

  // ---- the brush ----
  /** Pointer down at (nx, ny) frame coords: a stroke on strokeTarget's group (erase with Shift, force: Ctrl, a new
   *  group); f scales the radius (pen pressure). Off the groups' frame nothing is painted (the overlay offers go there /
   *  move them here), except in another shot of the take (paw-do8a): the stroke starts that shot's own groups, the take
   *  divided before it (splitHere), one undo step with the stroke. */
  begin(nx, ny, erase, f = 1, force = false, flip = false) {
    if (this.peek) return false;   // peeking: no stroke lands, no take is split
    if (this.dial) this.commitDial();
    if (this.xf || this.draft?.waiting) return false;
    if (!this.onFrame) { this.nudge++; return false; }   // paw-o74b: within the take every frame paints (new groups seed there); never divides the take
    this.picker = null;
    this.#lastAt.set(this.#takeKey(), [nx, ny]);
    this.#nameHold();
    if (this.knotBrush) return this.#beginKnot(nx, ny, erase, f);
    const tg = this.strokeTarget(nx, ny, erase, force), g = tg.k >= 0 ? this.groups[tg.k] : null;
    if (!g && erase) return false;
    if (g) this.active = tg.k;
    const mask = g ? cloneMask(this.maskFor(g)) : { ...this.size, a: new Float32Array(this.size.w * this.size.h) };
    const p = [nx * mask.w, ny * mask.h], grow = this.grow && (!erase || (!!g && !!this.#state(g)));   // paw-liwk: a grow stroke is SAM prompts (an erase one only on a group SAM made: it needs a positive to start from)
    this.draft = { k: g ? tg.k : -1, g, name: tg.name, erase, mask, poly: g?.poly || null, blobs: 0, islands: [], last: p, snap: !grow && this.snap !== !!flip, grow, over: force, pts: [p], before: g ? this.maskFor(g) : null, raw: mask, ver: 0, snapVer: -1, foot: { w: mask.w, h: mask.h, a: new Float32Array(mask.w * mask.h) } };   // raw: the paint as brushed; mask: what is shown and kept (the snapped outline while the edge snap is on); foot (paw-yx6q): where this stroke's brush went (an erase's sweep, a paint stroke's own paint)
    stroke(mask, p, p, this.radius * f * mask.h, { erase });
    stroke(this.draft.foot, p, p, this.radius * f * mask.h);
    if (this.draft.snap) this.prefetch();   // usually decoded already (the tool asks when the playhead settles)
    this.#live();
    return true;
  }
  /** The stroke on to (nx, ny); call once per coalesced pointer sample. */
  move(nx, ny, f = 1) {
    const d = this.draft;
    if (!d || d.waiting) return;
    const p = [nx * d.raw.w, ny * d.raw.h];
    stroke(d.raw, d.last, p, this.radius * f * d.raw.h, { erase: d.erase });
    stroke(d.foot, d.last, p, this.radius * f * d.raw.h);
    d.last = p; d.ver++; d.pts.push(p);
    this.#live();
  }
  // paw-o60v.6: a pointer sample touches nothing reactive (the document, the groups' memos, the overlay are as they were):
  // the stroke canvas draws the paint once a frame; the outline (snap, patches) is fitted when the pen rests and at pen up
  #rest = 0;
  #live() {
    this.onStroke?.();
    clearTimeout(this.#rest);
    this.#rest = setTimeout(() => this.#refit(), REST_MS);
  }
  #refit() {
    const d = this.draft;
    if (!d || d.waiting || d.fitVer === d.ver) return;
    this.#shown(d);
    const f = fitPoly(d.mask);
    d.poly = f.poly; d.blobs = f.blobs; d.islands = f.islands; d.fitVer = d.ver;
    this.onStroke?.();
  }
  end() {
    const d = this.draft;
    if (!d || d.waiting) return;
    clearTimeout(this.#rest);
    if (d.grow) { this.#refit(); d.waiting = true; this.#growStroke(d); return; }   // the paint (and its outline) stays on screen while SAM answers
    // paw-ywby: the snap needs the frame's own pixels; not decoded yet (just after a seek): the stroke stays on screen
    // and is stored a moment later, when they are (closing the tool meanwhile stores it as painted; Esc cancels it)
    const wait = d.snap && !this.#bitmap() ? this.prefetch() : null;
    if (wait) {
      this.#refit();
      d.waiting = true;
      wait.then(() => { if (this.draft === d) { this.draft = null; this.#finish(d); } });
      return;
    }
    this.draft = null;
    this.#finish(d);
  }
  /** What the stroke shows and keeps: the brushed paint (snapped while the magnet is on); an erase leaves each patch it cut as one piece (paw-1co9, groups.js eraseIslands: the piece with the SAM prompts, else the largest). */
  #shown(d) {
    if (d.snap) d.mask = this.#snapped(d);
    if (d.erase && d.before && d.raw) d.mask = eraseIslands(d.before, d.snap ? d.mask : d.raw, this.#state(d.g)?.pos);
  }
  /** paw-yx6q: group g's erase record at the tool's mask size (Uint8Array | null), decoded once per group object. */
  #erasedOf(g) {
    if (!g?.erased) return null;
    let e = this.#er.get(g);
    if (e === undefined) { e = erasedOf(g, this.size); this.#er.set(g, e); }
    return e;
  }
  #er = new WeakMap();
  /** paw-yx6q: the erase record a gesture leaves on its group: the group's, plus where an erase stroke's brush went, less where a paint
   *  stroke of the group went (its brush, `d.foot`; a circled loop's inside, `d.painted`; nothing for the dial / fill-to-edge). */
  #erasedAfter(d) {
    const foot = d.foot?.a || null;
    return this.#cutOf(d.g, d.erase ? foot : null, d.painted !== undefined ? d.painted : d.erase ? null : foot);
  }
  /** paw-yx6q: group g's erase record with what a gesture sweeps (an erase) / paints (a paint stroke of g) -> Uint8Array | null. */
  #cutOf(g, swept = null, painted = null) { return g ? nextErased(this.#erasedOf(g), this.size.w * this.size.h, { swept, painted }) : null; }
  /** paw-yx6q: SAM prompts under erase record e: the positives outside it, and up to 3 negatives inside it. */
  #prompts(e, pos, neg) {
    if (!e) return { pos, neg };
    const m = this.size, out = ([x, y]) => !e[Math.min(m.h - 1, Math.max(0, Math.floor(y))) * m.w + Math.min(m.w - 1, Math.max(0, Math.floor(x)))];
    return { pos: pos.filter(out), neg: [...neg, ...insidePoints(e, m.w, m.h, 3)] };
  }
  #finish(d) {
    if (d.knot) { this.#finishKnot(d); return; }
    this.#shown(d);   // already what was shown, unless the frame was not decoded yet (snap.js) or the last sample came after the last frame
    if (d.snap) this.#note(d);
    const er = d.g ? this.#erasedAfter(d) : null;   // paw-yx6q: a hard cut, whatever made the mask
    d.mask = clipErased(d.mask, er);
    const { poly } = fitPoly(d.mask), list = [...this.groups], mask = encodeMask(d.mask);
    // the group by identity: an undo / redo mid-stroke reorders the list, and the paint must not land on another group
    const k = d.g ? list.indexOf(d.g) : -1;
    if (k < 0) {
      if (!poly) { this.#split = null; return; }
      const name = d.g ? (isUnassigned(d.g) ? freeUnassigned([...this.others, ...list]) : freeName(list, d.g.name.replace(/\d+$/, ''))) : freeName(list, d.name);   // its group undone mid-stroke: painted anew under its name
      const q = splitName(name);
      list.push({ name, poly, pinned: isPinned(name), t_ms: this.stampOf(this.t), source: 'user', mask, ...(q.who ? { who: q.who, part: q.part, ...(q.side ? { side: q.side } : {}) } : {}) });
      this.cache.set(list[list.length - 1], d.mask);
      this.#put('paint ' + name, list);
      this.#retarget();
      this.active = list.length - 1;
      const re = isUnassigned(name) && !this.mod ? this.#reanchorGuess(list[list.length - 1], d.mask) : '';   // paw-o74b.1
      if (isUnassigned(name) && this.askAfter && !re) this.picker = { k: this.active, at: null, pass: false };
      return;
    }
    const g = list[k];
    if (!poly) {   // erased away: the group goes
      list.splice(k, 1);
      this.#put('erase ' + g.name, list);
      this.active = Math.min(k, list.length - 1);
      return;
    }
    list[k] = acceptGroup(withErased({ ...noPoints(g), poly, mask }, er, this.size));   // a repaint confirms a re-found group, makes a suggestion painted (run seed points: the mask now)
    const sec = knotOf(g, this.size);   // paw-njnf: the knot section stays inside the penis
    if (sec) { for (let i = 0; i < sec.length; i++) if (d.mask.a[i] < 0.5) sec[i] = 0; list[k] = withKnot(list[k], sec, this.size); }
    this.cache.set(list[k], d.mask);
    if (er) this.#er.set(list[k], er);
    this.active = k;
    this.#put((d.erase ? 'erase ' : 'paint ') + g.name, list);
    if (!d.erase) this.#retarget();
  }
  /** paw-iwb7: the track target follows the paint. Parts painted (a stroke, an accept) on a frame outside what T would track
   *  (timeline/quickbar.js paintTarget) make that frame's shot the target, as a click on it would (the playhead and the points
   *  left alone): selected, its span the range, a region selection dropped, its run picked. No undo step, as any selection. */
  #retarget() {
    if (this.mod || this.labelMode) return;
    const app = this.app, T = tlFor(app), list = scenesOf(app), t = this.t, k = this.#sceneAt(t), dur = durOf(app);
    const act = T.act ? (app.doc.acts || []).find((r) => r.id === T.act) ?? null : null;
    const to = paintTarget(list, { active: T.scene, shots: T.shots }, app.doc.range, act, k, t, dur);
    if (to < 0) return;
    T.act = T.actPop = T.cut = null;
    T.scene = to; T.shots = [to];
    app.doc.range = { t0: list[to].start_ms, t1: Math.min(list[to].end_ms, dur) };
    this.tr.selectSceneRun?.(to);
    app.toast?.(`${app.commands?.keysFor?.('track.gridFrame')?.[0] || 'Track'} now tracks shot ${shotLabel(list, to)}, where you painted`, 'quiet');
  }
  #lastAt = new Map();   // paw-iwb7: take (its first shot's start) -> [nx, ny] where a stroke last began there (Tab puts the pointer there)
  #takeKey() { const r = takeRange(this.scenes, this.scene); return r ? this.scenes[r[0]].start_ms : -1; }
  /** The last point painted in the take on screen ([nx, ny] frame fractions), else null. */
  get lastPaintHere() { return this.#lastAt.get(this.#takeKey()) ?? null; }
  tabTo = $state(0);   // paw-iwb7: bumped when Tab over the timeline opened the tool: GroupsOverlay moves the pointer onto the picture
  cancel() { this.draft = null; this.#split = null; this.#seq.void(); this.growBusy = false; this.tick++; }

  // ---- paw-njnf: the knot brush (K): the knot is a section of the penis, painted on it, never a group of its own ----
  knotBrush = $state(false);
  toggleKnot(on = !this.knotBrush) { this.knotBrush = !!on; this.tick++; return this.knotBrush; }
  /** The penis group a knot stroke at (nx, ny) works on: the group under it, else the active one; -1 when that is no penis. */
  knotTarget(nx, ny) {
    const h = this.hitAt(nx, ny), k = h >= 0 ? h : this.active, g = this.groups[k];
    return g && !g.off && canShaft(g) ? k : -1;
  }
  #beginKnot(nx, ny, erase, f) {
    const k = this.knotTarget(nx, ny);
    if (k < 0) { this.app.toast('The knot brush paints the knot on a penis group: start on one (K: back to the brush)', 'quiet'); return false; }
    const g = this.groups[k], m = this.size, mask = { w: m.w, h: m.h, a: knotOf(g, m)?.slice() || new Float32Array(m.w * m.h) };
    const p = [nx * m.w, ny * m.h];
    this.active = k;
    this.draft = { knot: true, k, g, name: g.name, erase, mask, raw: mask, poly: null, blobs: 0, islands: [], last: p, snap: false, grow: false, over: false, pts: [p], before: null, ver: 0, snapVer: -1, foot: { w: m.w, h: m.h, a: new Float32Array(m.w * m.h) } };
    stroke(mask, p, p, this.radius * f * m.h, { erase });
    stroke(this.draft.foot, p, p, this.radius * f * m.h);
    this.#live();
    return true;
  }
  /** A knot stroke's pen up: the section = the paint inside the penis' own mask (never outside it, never a new group), one undo step. */
  #finishKnot(d) {
    const list = [...this.groups], k = list.indexOf(d.g);
    if (k < 0) return;
    const pen = this.maskFor(d.g), a = d.mask.a.slice();
    for (let i = 0; i < a.length; i++) if (pen.a[i] < 0.5) a[i] = 0;
    list[k] = withKnot(d.g, a, this.size);
    this.cache.set(list[k], pen);
    this.active = k;
    this.#put(`${d.erase ? 'erase' : 'paint'} knot on ${d.g.name}`, list);
  }
  #kn = new WeakMap();
  /** Group g's knot section as a mask at the tool's size ({w, h, a}) | null (drawn a darker shade on the penis). */
  knotFor(g) {
    if (!g?.knot) return null;
    let e = this.#kn.get(g);
    if (e === undefined) { const a = knotOf(g, this.size); e = a ? { ...this.size, a } : null; this.#kn.set(g, e); }
    return e;
  }

  // ---- circle to fill (paw-714j, fill.js): a thin loop round most of a part -> one smooth blob for the group ----
  /** Setting 'tracking.groups.circle' (toolbar toggle, key W): the brush draws a lasso instead of paint; Shift still erases. */
  get circle() { return !!this.app.settings.get('tracking.groups.circle', false); }
  /** Pointer down with circle on: start a lasso (off the groups' frame nothing starts: begin() says where they are). */
  beginLasso(nx, ny, force = false) {
    if (this.xf || this.draft || !this.onFrame) return false;
    this.picker = null;
    this.#lastAt.set(this.#takeKey(), [nx, ny]);
    this.lasso = { pts: [[nx, ny]], force };
    this.tick++;
    return true;
  }
  moveLasso(nx, ny) {
    const l = this.lasso, q = l?.pts[l.pts.length - 1];
    if (!l || Math.hypot(nx - q[0], (ny - q[1]) / (this.size.w / this.size.h || 1)) < 0.002) return;
    l.pts.push([nx, ny]);
    this.tick++;
  }
  cancelLasso() { this.lasso = null; this.tick++; }
  /** Pen up: a loop (ends within 25 % of its length, enclosing an area) becomes the fill; any other stroke is replayed as an
   *  ordinary brush stroke, so the gesture never eats a plain stroke. */
  endLasso() {
    const l = this.lasso;
    this.lasso = null; this.tick++;
    if (!l) return;
    if (l.pts.length < 2) { this.begin(l.pts[0][0], l.pts[0][1], false, 1, l.force); this.end(); return; }
    const m = this.size, loop = loopFrom(l.pts.map(([x, y]) => [x * m.w, y * m.h]));
    if (loop) { if (this.grow) this.#growLoop(loop, l.force); else this.#fillLoop(loop, l.force); return; }
    if (!this.begin(l.pts[0][0], l.pts[0][1], false, 1, l.force)) return;
    for (const p of l.pts.slice(1)) this.move(p[0], p[1]);
    this.end();
  }
  #fillLoop(loop, force) {
    const m = this.size, cx = loop.reduce((s, p) => s + p[0], 0) / loop.length / m.w, cy = loop.reduce((s, p) => s + p[1], 0) / loop.length / m.h;
    const tg = this.strokeTarget(cx, cy, false, force), g = tg.k >= 0 ? this.groups[tg.k] : null;
    const go = () => {
      const em = this.#edges({ w: m.w, h: m.h });   // null without decoded pixels: the loop's own smoothed interior
      const painted = rasterLoop(loop, m.w, m.h), er = this.#cutOf(g, null, painted), others = [...this.#blockers(g, tg.name, force), ...(er ? [{ a: er }] : [])];   // paw-yx6q: a loop round an erased bit paints it again
      const r = fillLoop(loop, m.w, m.h, em, { others, radius: this.radius * m.h, margin: this.margin / 100 });
      const merged = mergeFill(g ? this.maskFor(g) : null, r.mask);   // replaces a shape it overlaps by half or more, else adds
      this.lastFill = { ms: r.ms, mode: r.mode, grew: r.grew, shrank: r.shrank, replaced: merged.replaced };
      if (g) this.active = tg.k;
      this.#finish({ k: g ? tg.k : -1, g, name: tg.name, erase: false, snap: false, mask: { w: m.w, h: m.h, a: merged.a }, painted });
    };
    const wait = this.#bitmap() ? null : this.prefetch();
    if (wait) wait.then(go); else go();
  }
  // ---- grow (paw-liwk): a dab / scribble / circled loop is SAM prompts; the group becomes SAM's smallest mask that holds them ----
  /** Setting 'tracking.groups.grow' (toolbar toggle, key E): strokes made while it is on go to SAM (sidecar `segment`). */
  get grow() { return !!this.app.settings.get('tracking.groups.grow', false); }
  #hist = new WeakMap();   // a group object SAM made -> {pos, neg: the prompts that made it (mask px), raw: SAM's chosen mask (the next dab sends it back as SAM's mask prompt), cands / steps / at: every candidate SAM returned and the ones in play (stepping)}: the next dab on that group adds to the prompts; an undo brings the older object (and its entry) back
  /** The SAM state of group g: what the dabs and the loosen dial re-ask SAM from. A group SAM grew here has its entry; an accepted Suggest proposal
   *  carries its own (g.sam: the prompts Suggest sent and SAM's chosen mask, paw-om3e), used while the group's mask is still the one it came with
   *  (a repaint changes the mask, the fingerprint stops matching, and the group is hand-painted again). */
  #state(g) {
    if (!g) return null;
    const h = this.#hist.get(g);
    if (h) return h;
    const s = g.sam;
    if (!s?.mask || !g.mask || s.fp !== maskFp(g.mask)) return null;
    const m = this.size, d = decodeMask(s.mask), px = (l) => (l || []).map(([x, y]) => [x * m.w, y * m.h]);
    const st = { pos: px(s.pos), neg: px(s.neg), raw: { w: m.w, h: m.h, a: resizeMask(d.a, d.w, d.h, m.w, m.h) }, cands: [], steps: [], at: 0 };
    this.#hist.set(g, st);
    return st;
  }
  #lastDab = null;         // {t, p, g}: the last grow dab, for the double-dab (grow to fill)
  #seq = latest();         // a late answer (the tool closed, another stroke, an undo) is dropped
  /** The tracker store whose sidecar runs `segment` (the labelling workspace's own is a stub: the project's). */
  get #realTr() { return this.app.real ? trackingFor(this.app.real) : this.tr; }
  #growSource() {
    const m = this.app.doc.media;
    if (this.labelMode) return m?.path ? { image: m.path } : null;
    return this.tr.videoPath ? { video: this.tr.videoPath, t_ms: this.t } : null;
  }
  /** A grow stroke's pen up: its points -> prompts. */
  #growStroke(d) {
    const m = this.size, r = Math.max(2, this.radius * m.h), pts = strokePoints(d.pts, r), P = d.erase ? [] : pts, N = d.erase ? pts : [], ext = d.erase ? 0 : strokeExtent(d.pts, r);
    const now = performance.now(), last = this.#lastDab, dab = d.pts.length < 3 || !ext;
    if (dab && !d.erase) this.#lastDab = { t: now, p: d.pts[0], g: d.g };
    // a second dab on the same spot of a grown group, right after the first (not while SAM is busy): grow to fill, no SAM call
    if (dab && !d.erase && d.g && last && now - last.t < DOUBLE_MS && Math.hypot(last.p[0] - d.pts[0][0], last.p[1] - d.pts[0][1]) < DOUBLE_R * r && this.#state(d.g)) {
      this.draft = null; this.tick++; this.#lastDab = null; this.growFill(d.g); return;
    }
    this.#growRun({ g: d.g, name: d.name, pos: P, neg: N, extent: ext, over: d.over, draft: d, swept: d.erase ? d.foot.a : null, painted: d.erase ? null : d.foot.a, plain: () => { this.draft = null; d.grow = false; this.#finish({ ...d, snap: false }); } });
  }
  /** Circle-to-fill with grow on: the loop's box + points inside it. */
  #growLoop(loop, force) {
    const m = this.size, cx = loop.reduce((s, p) => s + p[0], 0) / loop.length / m.w, cy = loop.reduce((s, p) => s + p[1], 0) / loop.length / m.h;
    const tg = this.strokeTarget(cx, cy, false, force), g = tg.k >= 0 ? this.groups[tg.k] : null, lp = loopPrompt(loop, m.w, m.h);
    this.#growRun({ g, name: tg.name, pos: lp.points, neg: [], box: lp.box, extent: Math.hypot(lp.box[2] - lp.box[0], lp.box[3] - lp.box[1]), over: force, draft: null, painted: rasterLoop(loop, m.w, m.h), plain: () => this.#fillLoop(loop, force) });
  }
  async #growRun({ g, name, pos, neg, box, extent = 0, over, draft, plain, swept = null, painted = null }) {
    const m = this.size, base = (g && this.#state(g)) || { pos: [], neg: [] };
    // paw-yx6q: the erased pixels (with what this erase swept, less what this stroke paints) are a hard cut and SAM's negatives;
    // a positive the owner has since erased is dropped, and the mask SAM refines has them at 0 (it was why an erased bit grew back)
    const er = this.#cutOf(g, swept, painted), own = [...base.neg, ...neg], { pos: P, neg: N } = this.#prompts(er, [...base.pos, ...pos], own);
    const refine = !!base.raw;   // a dab on a group SAM made: its mask goes back as SAM's mask prompt, the new points extend it; the box of the first stroke is not repeated
    if (refine) box = null;
    const src = this.#growSource(), tr = this.#realTr, k0 = g ? this.groups.indexOf(g) : -1, n0 = this.groups.length;
    const fail = (why) => { this.growBusy = false; this.growNote = why; this.app.toast(`Grow: ${why}. Painted as usual`, 'warn'); plain(); };
    if (!P.length && !box) { plain(); return; }
    if (!src) { fail('no picture to segment'); return; }
    if (tr.busy === 'seed' && tr.owner === 'seeder') tr.cancelOwner('seeder');   // a background retrain waits for the next save
    if (!samFree(tr)) { fail(tr.busy === 'track' ? 'the card is busy tracking' : `busy (${tr.busy})`); return; }   // a naming call: the prompt queues behind it
    const tok = this.#seq.next(), at = pos[0] || (box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : [0, 0]);
    this.growBusy = true; this.growAt = [at[0] / m.w, at[1] / m.h];
    const t0 = performance.now();
    let r;
    try { r = await tr.job('segment', segmentRequest({ ...src, pos: toFrac(P, m.w, m.h), neg: toFrac(N, m.w, m.h), box: box && [box[0] / m.w, box[1] / m.h, box[2] / m.w, box[3] / m.h], mask: refine ? encodeMask(clipErased(base.raw, er)) : null, single: P.length >= 2 || refine, logits: true, mask_w: m.w }), { task: false, owner: 'grow' }); }
    catch (e) { r = { error: String(e?.message || e) }; }
    const latestTok = this.#seq.ok(tok);
    if (latestTok) this.growBusy = false;
    // stale: a newer prompt, the tool closed, the stroke cancelled, or the group / list changed under it (an undo)
    const stale = !latestTok || !this.on || (draft ? this.draft !== draft : !!this.draft) || (g ? this.groups.indexOf(g) !== k0 : this.groups.length !== n0);
    if (stale) { this.app.usage?.note('tracking:groupsGrow', { stale: true }); if (draft && this.draft === draft) { this.draft = null; this.tick++; } return; }
    const res = r?.result;
    if (r?.cancelled) { if (draft) { this.draft = null; this.tick++; } return; }
    if (r?.error || !res?.masks?.length) { fail(String(r?.error || 'SAM returned nothing').split(/\r?\n/)[0].replace(/^.*?(Error|Exception): /, '').slice(0, 140)); return; }
    this.growNote = '';
    const [mw, mh] = res.mask_wh || [m.w, m.h];
    const masks = res.masks.map((x) => ({ a: resizeMask(decodeMask(x.mask).a, mw, mh, m.w, m.h), score: x.score, L: x.logits ? decodeLogits(x.logits, m.w, m.h) : null }));
    const prev = refine ? base.raw.a.reduce((s, v) => s + (v >= 0.5 ? 1 : 0), 0) : 0, pk = pickMask(masks, P, m.w, m.h, { extent, prev, arms: true }), ms = Math.round(performance.now() - t0);
    this.app.usage?.note('tracking:groupsGrow', { ms, cached: !!res.cached, masks: masks.length, pick: pk.index, why: pk.why, pos: P.length, neg: N.length });
    if (pk.index < 0 || pk.why) {
      if (draft) { this.draft = null; this.tick++; }
      this.app.toast(pk.why === 'large' ? 'Grow: SAM\'s answer took in most of the picture, or several times the part: dab or scribble more of the part' : 'Grow: SAM found nothing under that dab', 'quiet');
      return;
    }
    const clean = cleanMask(masks[pk.index].a, m.w, m.h, P, { margin: this.margin / 100, others: [...this.#blockers(g, name, over), ...(er ? [{ a: er }] : [])], arms: true, stroke: draft && !draft.erase ? draft.foot.a : null }), a = clean.a;   // the erased pixels block like another group: the edge settles round them; paw-yx6q: arms that reach out go, the brushed stroke stays
    if (clean.far) this.app.toast('Grow: a far piece of SAM\'s mask was dropped (one part at a time)', 'quiet');
    if (draft) this.draft = null;
    this.#finish({ k: g ? k0 : -1, g, name, erase: false, snap: false, mask: { w: m.w, h: m.h, a }, foot: swept ? { a: swept } : null, erase: !!swept, painted });
    const g2 = this.groups[this.active];
    if (g2) this.#hist.set(g2, { pos: P, neg: own, raw: clipErased({ w: m.w, h: m.h, a: masks[pk.index].a }, er), cands: masks, steps: pk.steps, at: pk.at });
    this.lastGrow = { ms, ...res.ms, cached: !!res.cached, area: pk.area, picked: pk.index, steps: pk.steps.length, at: pk.at };
  }
  // ---- the loosen / tighten dial (paw-k8jj, loosen.js): Alt + wheel over a group, or Alt + Up / Down. Every notch ASKS SAM AGAIN (a decode against the cached
  // embedding), built from the current mask and the direction; the answers form a ladder, so going back is instant and exact; one undo step per burst. ----
  dial = $state.raw(null);   // the gesture in progress: {k, g, ladder (Map notch -> {a, raw, L}), p, pend, busy, mask, poly, label, at, ...}
  #acc = 0;                  // wheel delta not yet worth a notch
  dialMs = 0;                // the last notch's round trip (the check scripts read it)
  /** A wheel event over the picture at frame point (nx, ny): Alt + wheel up = looser, down = tighter, on the group under the pointer (the topmost). */
  dialWheel(deltaY, deltaMode, nx, ny) {
    this.#acc += deltaY * (deltaMode === 1 ? 33 : 1);
    const n = Math.trunc(Math.abs(this.#acc) / DIAL_DELTA);
    if (!n) return false;
    const dir = this.#acc < 0 ? 1 : -1;
    this.#acc = 0;
    return this.dialNotch(dir * n, [nx, ny]);
  }
  /** `.` (looser) / `,` (tighter): one notch on the group under the pointer, else the active one. */
  dialKey(dir) {
    const k = this.hover ? this.hitAt(this.hover.nx, this.hover.ny) : -1, g = this.groups[k >= 0 ? k : this.active];
    if (!g?.poly?.length) return false;
    const c = g.poly.reduce((s, q) => [s[0] + q[0] / g.poly.length, s[1] + q[1] / g.poly.length], [0, 0]);
    return this.dialNotch(dir, k >= 0 ? [this.hover.nx, this.hover.ny] : c);
  }
  dialNotch(n, [nx, ny]) {
    if (!this.on || this.draft || this.xf || !this.onFrame) return false;
    let D = this.dial;
    if (!D) {
      const k = this.hitAt(nx, ny), g = this.groups[k];
      if (!g || g.off || !(g.poly?.length >= 3)) return false;
      const m = this.size, start = this.maskFor(g), h = this.#state(g);
      this.#seq.void();   // a grow answer still in flight would land on the old group
      this.#nameHold();
      // the notch's raw mask is the group WITHOUT the paint margin (SAM's own, else the shown one grown back by the margin): every answer is cleaned with the margin once, so a notch never loses what the margin took
      const mg = this.margin / 100, er = this.#cutOf(g), raw0 = clipErased({ w: m.w, h: m.h, a: h?.raw?.a && h.raw.a.length === start.a.length ? h.raw.a : mg > 0 ? moved(start.a, m.w, m.h, marginFor(signedDistance(Uint8Array.from(start.a, (v) => (v >= 0.5 ? 1 : 0)), m.w, m.h), mg)) : start.a }, er).a;   // paw-yx6q: the erased pixels out of it
      D = this.dial = { k, g, ladder: new Map([[0, { a: start.a, raw: raw0, L: null }]]), p: 0, pend: 0, busy: false, end: {}, classic: null, pos0: this.#prompts(er, h?.pos || [], []).pos, start0: area(start.a), mask: start, poly: g.poly, label: '', at: [nx, ny], timer: 0, w: m.w, h: m.h };
      this.active = k;
    }
    D.pend += n; D.at = [nx, ny];
    clearTimeout(D.timer);
    this.#dialRun();
    return true;
  }
  #dialShow(D, e, note = '') {
    D.mask = { w: D.w, h: D.h, a: e.a }; D.poly = fitPoly(D.mask).poly;
    const rel = D.p;
    D.label = `${rel > 0 ? 'looser +' + rel : rel < 0 ? 'tighter −' + -rel : 'as drawn'}${note}`;
    this.dial = { ...D };   // a fresh reference: the overlay redraws
    this.tick++;
  }
  async #dialRun() {
    let D = this.dial;
    if (!D || D.busy) return;
    D.busy = true;
    try {
      while (this.dial && this.dial.k === D.k && this.dial.pend) {
        D = this.dial;
        const dir = D.pend > 0 ? 1 : -1, nxt = D.p + dir, hit = D.ladder.get(nxt), t0 = performance.now();
        if (hit) { D.p = nxt; D.pend -= dir; this.#dialShow(D, hit); continue; }
        if (D.end[dir]) { D.pend = 0; this.#dialShow(D, D.ladder.get(D.p), ' (no more)'); break; }
        this.dial = { ...D, label: D.label + ' …' }; this.tick++;   // a busy tick on the readout while SAM answers
        const e = await this.#dialAsk(D, dir);
        if (!this.dial || this.dial.k !== D.k || !this.on) return;   // the gesture ended / the tool closed: the answer is dropped
        D = this.dial; this.dialMs = +(performance.now() - t0).toFixed(1);
        if (!e) { D.end[dir] = true; D.pend = 0; this.#dialShow(D, D.ladder.get(D.p), ' (no more)'); break; }
        D.ladder.set(nxt, e);
        if (Math.sign(D.pend) === dir) { D.p = nxt; D.pend -= dir; }   // the intent may have turned round meanwhile: the answer stays on the ladder
        this.#dialShow(D, D.ladder.get(D.p), e.via === 'sam' ? '' : ` (${e.via})`);
      }
    } finally {
      const E = this.dial;
      if (E) { E.busy = false; clearTimeout(E.timer); E.timer = setTimeout(() => this.commitDial(), DIAL_IDLE_MS); if (E.pend) this.#dialRun(); }
    }
  }
  /** One notch: SAM again; else the kept logits; else (SAM unavailable) the classic edge-aware step. -> {a, raw, L, via} | null (no more). */
  async #dialAsk(D, dir) {
    const m = this.size, cur = D.ladder.get(D.p), er = this.#cutOf(D.g), others = [...this.#blockers(D.g, D.g.name, false), ...(er ? [{ a: er }] : [])], em = this.#edges({ w: m.w, h: m.h });   // paw-yx6q: never into what was erased
    const clean = (raw) => cleanMask(raw, m.w, m.h, D.pos0.length ? D.pos0 : insidePoints(raw, m.w, m.h, 3), { margin: this.margin / 100, others }).a;
    const ptr = [D.at[0] * m.w, D.at[1] * m.h], src = this.#growSource(), tr = this.#realTr;
    const cap = Math.min(ABSURD_IMAGE * m.w * m.h, LOOSE_CAP * Math.max(1, D.start0)), min = Math.max(MIN_PX, MIN_FRAC * D.start0);
    let samOk = false, why = !src ? 'no picture to segment' : !samFree(tr) ? (tr.busy === 'track' ? 'the card is busy tracking' : `busy: ${tr.busy}`) : '';   // samOk: SAM answered at least once this notch: "no more" is its verdict, not a reason for the classic step
    if (!D.classic && !why) {
      if (tr.busy === 'seed' && tr.owner === 'seeder') tr.cancelOwner('seeder');
      for (const f of [1, STEP_RETRY]) {
        const req = dialRequest(cur.raw, dir, { w: m.w, h: m.h, em, others, ptr, step: f * stepOf(cur.raw), pos0: D.pos0 });
        if (er) Object.assign(req, this.#prompts(er, req.pos, req.neg), { mask: clipErased(req.mask, er) });
        let r;
        try { r = await tr.job('segment', segmentRequest({ ...src, pos: toFrac(req.pos, m.w, m.h), neg: toFrac(req.neg, m.w, m.h), box: [req.box[0] / m.w, req.box[1] / m.h, req.box[2] / m.w, req.box[3] / m.h], mask: encodeMask(req.mask), logits: true, mask_w: m.w }), { task: false, owner: 'grow' }); }
        catch (e) { r = { error: String(e?.message || e) }; }
        if (!this.dial || this.dial.k !== D.k) return null;
        if (r?.error || r?.cancelled || !r?.result?.masks?.length) { why = r?.cancelled ? 'cancelled' : String(r?.error || 'SAM returned nothing').split(/\r?\n/)[0].replace(/^.*?(Error|Exception): /, '').slice(0, 140); break; }   // SAM is not there: the classic step below
        samOk = true; this.#dialSaid = '';
        const [mw, mh] = r.result.mask_wh || [m.w, m.h];
        const cands = r.result.masks.map((x) => ({ a: resizeMask(decodeMask(x.mask).a, mw, mh, m.w, m.h), score: x.score, L: x.logits ? decodeLogits(x.logits, m.w, m.h) : null }));
        const pick = dir > 0 ? chooseLarger(cands, cur.raw, { cap }) : chooseSmaller(cands, cur.raw, { w: m.w, h: m.h, pos: req.pos, min });
        if (pick) { const fine = fineStep(cur.raw, cur.L, pick.a, pick.L, dir, m.w, m.h); return { raw: fine.raw, a: clean(fine.raw), L: fine.L, via: 'sam' }; }   // SAM names the region, the notch moves NOTCH_AREA of the way
      }
      if (!D.classic && cur.L) {   // SAM had nothing different to say: its own logits of the current answer, thresholded
        const r = makeDial({ cands: [{ L: cur.L }], k0: 0, w: m.w, h: m.h, pos: D.pos0 }).mask(dir, { others, margin: this.margin / 100 });
        const a0 = area(cur.raw), a1 = area(r.a);
        if (r.p === dir && (dir > 0 ? a1 >= (1 + NOTCH_AREA / 4) * a0 && a1 <= cap : a1 <= (1 - NOTCH_AREA / 4) * a0 && a1 >= min)) return { raw: r.a, a: r.a, L: cur.L, via: 'logits' };
      }
      if (samOk) return null;
    }
    // the classic edge-aware step: the card is busy / no sidecar / SAM failed
    if (!D.classic) {
      D.classic = makeDial({ base: D.ladder.get(0), w: m.w, h: m.h });
      if (why !== this.#dialSaid) { this.#dialSaid = why; this.app.toast(`Loosen / tighten: SAM is not available (${why || 'no answer'}), following the picture's own edges`, 'quiet'); }   // paw-wzxu: why, once until it changes
    }
    const r = D.classic.mask(D.p + dir, { em, others, margin: this.margin / 100, radius: this.radius * m.h });
    return r.p === D.p + dir ? { raw: r.a, a: r.a, L: null, via: 'edges' } : null;
  }
  #dialSaid = '';   // the reason the dial last said SAM was not there
  /** The gesture ends (idle, or another action): ONE undo step with the final mask. */
  commitDial() {
    const E = this.dial;
    if (!E) return;
    clearTimeout(E.timer);
    if (E.busy && E.pend) { E.timer = setTimeout(() => this.commitDial(), 60); return; }   // an answer is still due: wait for it
    this.dial = null; this.tick++;
    if (!E.p) return;
    const k = this.groups.indexOf(E.g);
    if (k < 0) return;
    const m = this.size, h = this.#state(E.g), e = E.ladder.get(E.p);
    this.#finish({ k, g: E.g, name: E.g.name, erase: false, snap: false, mask: { w: m.w, h: m.h, a: e.a } });
    const g2 = this.groups[this.active];
    if (g2) this.#hist.set(g2, { ...(h || {}), pos: E.pos0.length ? E.pos0 : insidePoints(e.raw, m.w, m.h, 3), neg: h?.neg || [], raw: { w: m.w, h: m.h, a: e.raw } });   // the next dab refines this mask (a hand-painted group is SAM-shaped from here on)
  }
  /** Grow to fill (paw-k8jj): the active group takes the strip left at the part's visible edge: FILL_NOTCHES edge-aware notches looser (loosen.js: the picture's own colours and edges, never across a strong edge or into another group), one undo step. No SAM call. */
  growFill(g = this.groups[this.active]) {
    if (!g || !this.on) return false;
    const m = this.size, go = () => {
      const k = this.groups.indexOf(g);
      if (k < 0) return;
      const em = this.#edges({ w: m.w, h: m.h });
      if (!em) { this.app.toast('Grow to fill: the picture is not decoded yet', 'quiet'); return; }
      const old = this.maskFor(g), er = this.#cutOf(g), r = makeDial({ base: old, w: m.w, h: m.h }).mask(FILL_NOTCHES, { em, others: [...this.#blockers(g, g.name, false), ...(er ? [{ a: er }] : [])], margin: this.margin / 100, radius: this.radius * m.h });
      if (r.p < 1) { this.app.toast('Grow to fill: nothing more that looks like this part and is not behind an edge', 'quiet'); return; }
      const a = new Float32Array(m.w * m.h);
      for (let i = 0; i < a.length; i++) a[i] = Math.max(old.a[i], r.a[i]);   // it only takes, never gives back
      this.active = k;
      this.#finish({ k, g, name: g.name, erase: false, snap: false, mask: { w: m.w, h: m.h, a } });
      const g2 = this.groups[this.active], h = this.#state(g);
      if (g2 && h) this.#hist.set(g2, { pos: h.pos, neg: h.neg, raw: { w: m.w, h: m.h, a } });   // the candidates no longer describe it; the next dab refines this
      this.app.toast(`Grow to fill: ${r.p} notches`, 'quiet');
    };
    const wait = this.#bitmap() ? null : this.prefetch();
    if (wait) wait.then(go); else go();
    return true;
  }
  lastGrow = null;   // {ms, embed, decode, cached, area, picked} of the last grow prompt (the check scripts read it)

  /** The masks a group's snap / fill / grow result must not enter: every other shown group, except the ones it may overlap
   *  (a part that lives on another: groups.js ON_PART, either way round: the parent is never cut by its child) and everything when
   *  `over` (Ctrl: paint over, this stroke). g: the group (null: a new one named `name`). */
  #blockers(g, name, over) {
    if (over) return [];
    const nm = g?.name || name;
    return this.groups.filter((x) => x !== g && !x.off && !(nm && mayOverlap(nm, x.name))).map((x) => this.maskFor(x));
  }
  /** Edge snap (paw-ywby, setting 'tracking.groups.snap', off by default; Alt+drag flips it for one stroke). */
  get snap() { return !!this.app.settings.get('tracking.groups.snap', false); }
  /** The magnet's strength, 0..100 % (setting 'tracking.groups.snapStrength', default 50 = the classic reach): how far it reaches, how weak an edge it follows, how firmly it pulls (snap.js snapParams). */
  get snapStrength() { const v = Number(this.app.settings.get('tracking.groups.snapStrength', 50)); return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 50; }
  setSnapStrength(v) { this.app.settings.set('tracking.groups.snapStrength', Math.min(100, Math.max(0, Math.round(v)))); }
  /** The paint margin, 0..100 % (setting 'tracking.groups.margin', default MARGIN_DEFAULT): how far inside the part's edge every aid (magnet, circle to fill, grow) leaves the outline, as a share of the part's own size (snap.js marginFor). Painted groups are never rewritten by it. */
  get margin() { const v = Number(this.app.settings.get('tracking.groups.margin', MARGIN_DEFAULT)); return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : MARGIN_DEFAULT; }
  setMargin(v) {
    this.app.settings.set('tracking.groups.margin', Math.min(100, Math.max(0, Math.round(v))));
    this.marginShow = Date.now(); clearTimeout(this.#mt); this.#mt = setTimeout(() => { this.marginShow = 0; }, 2500);   // the preview shows while it is being changed
  }
  marginShow = $state(0); #mt = 0; #mp = null;
  // ---- the shown confidence (paw-r6t0): Suggest returns every candidate; only those at or above this are in the take, the rest are held here ----
  /** The confidence Suggest shows, 0.3..1 (setting 'tracking.suggest.confidence', default SUGGEST_CONF = 0.8): live, no re-run. */
  get suggestConf() { const v = Number(this.app.settings.get('tracking.suggest.confidence', SUGGEST_CONF)); return Number.isFinite(v) ? Math.min(1, Math.max(SUGGEST_CONF_MIN, Math.round(v * 100) / 100)) : SUGGEST_CONF; }
  held = $state.raw({ ctx: null, items: [] });   // suggestions below the shown confidence: not in the take, never tracked, saved or accepted
  labelCtx = null;                                // labelling: () => the picture on screen (held ones belong to it)
  #ctx() { return this.labelMode ? (this.labelCtx?.() ?? '') : String(this.scene); }
  /** Candidates not shown now (their picture / take is still the one on screen). */
  get heldCount() { return this.held.ctx === this.#ctx() ? this.held.items.length : 0; }
  holdSuggestions(items) { this.held = { ctx: this.#ctx(), items: items || [] }; }
  /** Set the confidence (one tick of a drag, a key, the wheel): the candidates at or above it are shown, the others held. Not an undo step. */
  setSuggestConf(v) {
    this.app.settings.set('tracking.suggest.confidence', Math.min(1, Math.max(SUGGEST_CONF_MIN, Math.round(v * 100) / 100)));
    if (this.held.ctx !== this.#ctx()) { if (this.held.items.length) this.held = { ctx: null, items: [] }; return; }
    const cur = this.groups.filter(isSuggested), { shown, hidden } = splitByConfidence([...cur, ...this.held.items], this.suggestConf);
    if (shown.length === cur.length && shown.every((g, j) => g === cur[j]) && hidden.length === this.held.items.length) return;
    const keep = this.groups.filter((g) => !isSuggested(g)), list = [...keep];
    const names = new Set(keep.map((g) => g.name));
    for (const g of shown) { const n = names.has(g.name) ? freeName(list, g.name) : g.name; names.add(n); list.push(n === g.name ? g : { ...g, name: n }); }
    this.held = { ctx: this.held.ctx, items: hidden };
    this.app.doc.scenes = setTakeGroups(this.scenes, this.scene, [...this.others, ...list]);   // paw-o74b: the other seed frames' groups stay
  }
  /** The live preview of the margin: the active group's outline pulled in by the margin now set (a polygon, 0..1), while it is being changed; null otherwise. Draws only: the painted mask is never touched. */
  marginPreview() {
    if (!this.marginShow) return null;
    const g = this.activeGroup;
    if (!g || g.off || g.points || !this.onFrame) return null;
    const m = this.maskFor(g), key = this.margin;
    if (this.#mp?.a === m.a && this.#mp.key === key) return this.#mp.poly;
    const s = signedDistance(m.a, m.w, m.h), s2 = insetOutline(s, m.w, m.h, marginFor(s, key / 100)), a = new Float32Array(m.w * m.h);
    for (let i = 0; i < a.length; i++) a[i] = Math.min(1, Math.max(0, 0.5 - s2[i]));
    const poly = fitPoly({ w: m.w, h: m.h, a }).poly;
    this.#mp = { a: m.a, key, poly };
    return poly;
  }
  lastSnap = null;   // {ms, moved, near} of the last snapped stroke (the check scripts read it)
  /** The brushed paint's outline made one smooth outline, snapped softly to close picture edges and pulled a little inside
   *  (snap.js; reach and margin scale with the brush; paw-2kdm): what the stroke shows while it goes and what it keeps.
   *  Cached per brushed state; as painted while the frame's pixels are not decoded yet. */
  #snapped(d) {
    if (d.snapVer === d.ver && d.shown) return d.shown;
    const t0 = performance.now(), raw = d.raw, em = this.#edges(raw);
    if (!em) return raw;
    const r = snapMask(raw, d.before, em, { radius: this.radius * raw.h, strength: this.snapStrength / 100, margin: this.margin / 100, others: (d.others ||= this.#blockers(d.g, d.name, d.over)) });
    d.snapVer = d.ver; d.shown = r.mask;
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    d.stat = { n: (d.stat?.n || 0) + 1, msSum: (d.stat?.msSum || 0) + ms, msMax: Math.max(d.stat?.msMax || 0, ms), D: +r.reach.toFixed(2), margin: +r.margin.toFixed(2), mean: +r.mean.toFixed(2) };
    this.lastSnap = { ms, moved: r.moved, near: r.near, updates: d.stat.n, msMean: +(d.stat.msSum / d.stat.n).toFixed(1), msMax: d.stat.msMax, area: +r.area.toFixed(2) };
    return r.mask;
  }
  /** The usage note for a finished snapped stroke: the last update, and the stroke's updates (count, mean / max ms). */
  #note(d) {
    const s = d.stat;
    if (s) this.app.usage?.note('tracking:groupsSnap', { ...this.lastSnap, D: s.D, margin: s.margin, mean: s.mean, updates: s.n, msMean: +(s.msSum / s.n).toFixed(1), msMax: s.msMax });
  }
  #em = null; #emFor = null;
  /** The frame on screen as snap.js's edge map at mask resolution (a downscaled copy, computed once per decoded frame and
   *  cached); null without a video (or pixels the page may not read). */
  #edges(m) {
    const bmp = this.#bitmap();   // the displayed <video> may not be read (asset protocol)
    if (typeof document === 'undefined' || !bmp?.width) return null;
    if (this.#emFor === bmp && this.#em?.w === m.w) return this.#em;
    try {
      const cv = document.createElement('canvas');
      cv.width = m.w; cv.height = m.h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, m.w, m.h);
      this.#em = edgeMap(ctx.getImageData(0, 0, m.w, m.h)); this.#emFor = bmp;
      return this.#em;
    } catch { return null; }
  }
  #frames = null; #framesUrl = ''; #pf = 0;
  /** The decoded pixels of the frame on screen: a still's own bitmap (the labelling workspace's player.frameBitmap, paw-714j), else the hidden video's. */
  #bitmap() { const p = this.app.player; return p.frameBitmap ? p.frameBitmap() : this.#frames?.peek(p.timeMs); }
  /** Decode the frame on screen at its own size in a hidden video the page may read (assist/frames.js), for the snap. */
  prefetch() {
    const v = this.app.player.el;
    if (typeof document === 'undefined' || !v?.currentSrc) return null;
    if (this.#framesUrl !== v.currentSrc) {
      this.#frames?.dispose();
      this.#frames = createFrames({ url: v.currentSrc, frameMs: this.app.player.frameMs || 1000 / 30, maxH: v.videoHeight || 1080, max: 4, workers: 1 });
      this.#framesUrl = v.currentSrc;
    }
    return this.#frames.get(this.app.player.timeMs);
  }
  #prefetchSoon() { clearTimeout(this.#pf); this.#pf = setTimeout(() => { if (this.on) this.prefetch(); }, 150); }

  // ---- the frame the groups belong to ----
  /** "Go there": the playhead to a seed frame (default: the nearest other one; the only seek the tool makes, on the owner's click). */
  goToFrame(t = this.nearestSeed ?? this.t) { this.app.player.seek(t); }
  /** paw-o74b: the take's groups seeded on other frames, as the frame on screen shows them: [{g, poly (where a run tracked it
   *  here: the selected run, else the newest covering this frame; else as painted), tracked, t_ms, run}]. Drawn dimmed and
   *  listed with their seed frame, never edited here: what is already covered, so a part is not painted twice. */
  othersHere() {
    const now = this.app.player.timeMs, fm = this.app.player.frameMs || 1000 / 30, here = new Set(this.groups.map((g) => g.name));
    const os = this.others.filter((g) => !here.has(g.name));   // paw-o74b.1: a part seeded on this frame too is edited here
    if (!os.length) return [];
    const runs = (this.tr.runs || []).filter((r) => r.channels && r.range && now >= r.range.start && now < r.range.end);
    const order = [runs.find((r) => r.id === this.tr.selectedId), ...[...runs].reverse()].filter(Boolean);
    // paw-o74b.1: a part seeded on several other frames shows once: the seed a run's stitch has owning this frame, else the nearest
    const by = new Map();
    for (const g of os) { const key = isUnassigned(g) || isIgnore(g) ? g : g.name; if (!by.has(key)) by.set(key, []); by.get(key).push(g); }
    return [...by.values()].map((l) => {
      const near = l.reduce((b, g) => (Math.abs(g.t_ms - now) < Math.abs(b.t_ms - now) ? g : b), l[0]), seeds = l.map((g) => g.t_ms).sort((a, b) => a - b);
      for (const r of order) {
        const own = l.length > 1 ? ownerAt(r, near.name, now) : null, g = (own && l.find((x) => Math.abs(x.t_ms - own.t_ms) <= this.#slack)) || near;
        const p = trackedPoly(r, g.name, g.poly, g.t_ms, now, fm);
        if (p) return { g, poly: p, tracked: true, t_ms: g.t_ms, run: r.id, seeds };
      }
      return { g: near, poly: near.poly, tracked: false, t_ms: near.t_ms, run: null, seeds };
    });
  }
  /** paw-o74b.1: the other frames' part whose tracked outline (othersHere) covers more than half of mask m here, else null:
   *  painting over it re-anchors that part. */
  trackedUnder(m) {
    let best = null, top = 0.5;
    const here = new Set(this.groups.map((x) => x.name));
    for (const o of this.othersHere()) {
      if (!o.tracked || isUnassigned(o.g) || isIgnore(o.g) || here.has(o.g.name) || !(o.poly?.length >= 3)) continue;
      const r = rasterPoly(o.poly, { w: m.w, h: m.h });
      let inn = 0, tot = 0;
      for (let i = 0; i < m.a.length; i++) if (m.a[i] >= 0.5) { tot++; if (r.a[i] >= 0.5) inn++; }
      if (tot && inn / tot > top) { top = inn / tot; best = o; }
    }
    return best;
  }
  /** paw-o74b.1: a new unassigned group painted over a part's dimmed tracked outline: that part proposed (a re-anchor of it on
   *  this frame; Enter takes it as any confident proposal, the picker / 1 / 2 / 3 still decide). -> the part's name | ''. */
  #reanchorGuess(g, m) {
    const o = this.trackedUnder(m), q = splitName(o?.g.name);
    if (!o || !q.who) return '';
    this.proposals = new Map(this.proposals).set(g, { parts: [{ part: q.part, p: 1 }], conf: 1, auto: true, who: q.who, whoConf: 1, fixed: true, reanchor: o.g.name });
    if (q.side) this.sideSet = new Map(this.sideSet).set(g, q.side);
    this.app.toast?.(`${partLabel(o.g.name)}? Its tracked outline is here: Enter re-anchors it on this frame (another seed of it), or assign another part`, 'quiet');
    this.app.usage?.note('tracking:groupsReanchorGuess', { part: o.g.name, from: Math.round(o.t_ms) });
    return o.g.name;
  }
  /** paw-o74b.1: the take's groups that cannot be seeds (an older project: a frame outside the scene, a part twice on one frame)
   *  dropped when the tool shows the take: one undo step, said once. */
  #tidy() {
    if (this.mod || this.labelMode || this.scene < 0) return;
    const kf = foldKnots(takeGroups(this.scenes, this.scene), this.#slack);   // paw-njnf: an old knot group on a penis becomes its section
    if (kf) {
      this.app.transact('Groups: knot → section of the penis', () => { this.app.doc.scenes = setTakeGroups(this.scenes, this.scene, kf.list); });
      this.app.toast(`The knot is now a section of the penis (${kf.folded.length > 1 ? kf.folded.length + ' knots' : 'painted darker on it'}; K paints it, Ctrl+Z brings the old group back)`, 'info');
      this.app.usage?.note('tracking:groupsKnotFold', { n: kf.folded.length });
    }
    const r = tidySeeds(this.scenes, this.scene, this.#slack);
    if (!r) return;
    this.app.transact('Groups: drop seeds that cannot be tracked', () => { this.app.doc.scenes = setTakeGroups(this.scenes, this.scene, r.list); });
    const what = [r.stale && `${r.stale} group${r.stale === 1 ? '' : 's'} seeded outside its scene`, r.dups && `${r.dups} part${r.dups === 1 ? '' : 's'} painted twice on one frame`].filter(Boolean).join(' and ');
    this.app.toast(`This take had ${what}: dropped (the later copy kept; Ctrl+Z brings them back)`, 'info');
    this.app.usage?.note('tracking:groupsTidy', { stale: r.stale, dups: r.dups });
  }
  /** The take's seed frame nearest the frame on screen, other than it (null: none). */
  get nearestSeed() { const now = this.app.player.timeMs; return this.seedFrames.filter((x) => Math.abs(x - now) > this.#slack).sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0] ?? null; }
  /** "Move them here": the groups seeded on frame `from` (default: the nearest other seed frame) re-stamped onto the frame on
   *  screen (one undo step; outlines kept). A part already seeded on this frame refuses it. */
  moveHere(from = this.nearestSeed) {
    if (this.mod) { const t = this.stampOf(this.app.player.timeMs), old = this.groups, list = old.map((g) => ({ ...g, t_ms: t })); list.forEach((g, k) => this.cache.set(g, this.maskFor(old[k]))); if (old.length) this.#put('move to this frame', list); return; }
    const t = this.stampOf(this.app.player.timeMs), all = this.all, moved = from == null ? [] : all.filter((g) => this.#onT(g, from));
    if (!moved.length || Math.abs(from - t) <= this.#slack) return;
    const base = (g) => (isUnassigned(g) || isIgnore(g) ? '' : g.name.replace(/\d+$/, '')), here = new Set(this.groups.map(base).filter(Boolean));
    const clash = moved.find((g) => base(g) && here.has(base(g)));
    if (clash) { this.app.toast(`${partLabel(clash.name)} is already seeded on this frame: not moved`, 'warn'); return; }
    const list = all.map((g) => { if (!moved.includes(g)) return g; const u = { ...g, t_ms: t }; this.cache.set(u, this.maskFor(g)); return u; });
    this.app.transact('Groups: move to this frame', () => { this.app.doc.scenes = setTakeGroups(this.scenes, this.scene, list); });
    this.proposeSoon();
  }

  // ---- patches: a group whose paint fell apart into pieces tracks only the largest ----
  /** Group k's patches as groups of their own (same character and part: 'c1_tail', 'c1_tail2', ...); drop: the other
   *  patches erased instead. One undo step. */
  split(k = this.active, drop = false) {
    const g = this.groups[k], pieces = g ? splitMask(this.maskFor(g)) : [];
    if (pieces.length < 2) return;
    const list = [...this.groups], put = (x, m) => { this.cache.set(x, m); return x; };
    list[k] = put({ ...noPoints(g), poly: fitPoly(pieces[0]).poly, mask: encodeMask(pieces[0]) }, pieces[0]);
    if (!drop) for (const m of pieces.slice(1)) {
      const poly = fitPoly(m).poly;
      if (!poly) continue;
      const name = freeName(list, g.name.replace(/\d+$/, ''));
      list.push(put({ ...acceptGroup(noPoints(g)), name, poly, mask: encodeMask(m), off: undefined }, m));
    }
    this.#put(`${drop ? 'drop patches of' : 'split'} ${g.name}`, list);
  }

  // ---- grab (G) / scale (S) the active group (the overlay drives the pointer and keys) ----
  beginXf(kind) {
    const g = this.activeGroup;
    if (!g || this.draft || this.xf || !this.onFrame || !(g.poly?.length >= 3)) return false;
    const base = this.maskFor(g), c = g.poly.reduce((s, q) => [s[0] + q[0] / g.poly.length, s[1] + q[1] / g.poly.length], [0, 0]);
    this.xf = { kind, k: this.active, g, base, c, mask: base, poly: g.poly };
    return true;
  }
  /** Preview: moved by (dx, dy) frame units, scaled by s about the group's centre. */
  previewXf({ dx = 0, dy = 0, s = 1 }) {
    const x = this.xf;
    if (!x) return;
    const m = x.base;
    x.t = { dx: dx * m.w, dy: dy * m.h, s, cx: x.c[0] * m.w, cy: x.c[1] * m.h };
    x.mask = transformMask(m, x.t);
    x.poly = fitPoly(x.mask).poly;
    this.tick++;
  }
  endXf(ok) {
    const x = this.xf;
    this.xf = null; this.tick++;
    if (!ok || !x || x.mask === x.base || !x.poly) return;
    const list = [...this.groups], k = list.indexOf(x.g);
    if (k < 0) return;
    const er = this.#erasedOf(x.g), m = this.size;   // paw-yx6q: the erase record moves with the group
    const er2 = er && x.t ? Uint8Array.from(transformMask({ w: m.w, h: m.h, a: Float32Array.from(er) }, x.t).a, (v) => (v >= 0.5 ? 1 : 0)) : er;
    list[k] = acceptGroup(withErased({ ...noPoints(x.g), poly: x.poly, mask: encodeMask(x.mask) }, er2 && er2.some((v) => v) ? er2 : null, m));
    const sec = knotOf(x.g, m);   // paw-njnf: the knot section moves with the penis
    if (sec) list[k] = withKnot(list[k], x.t ? transformMask({ w: m.w, h: m.h, a: sec }, x.t).a : sec, m);
    this.cache.set(list[k], x.mask);
    this.#put(`${x.kind === 'grab' ? 'move' : 'scale'} ${x.g.name}`, list);
  }

  /** Alt+click at (nx, ny): the group under the pointer becomes the active one; again on an overlap: the next one
   *  under it (smallest first). */
  pickAt(nx, ny) {
    const hits = groupsAt(this.groups, nx, ny);
    if (!hits.length) return false;
    this.pick(hits[(hits.indexOf(this.active) + 1) % hits.length]);
    return true;
  }

  /** Decline every pending suggestion of the take (not painted, not accepted, not a copy): one undo step, nothing else touched. Never a
   *  label and never a negative: a suggestion was never written anywhere. */
  declineAll() {
    const keep = this.groups.filter((g) => !isSuggested(g));
    if (keep.length === this.groups.length) return false;
    this.active = Math.min(this.active, keep.length - 1);
    this.held = { ctx: null, items: [] };   // the held ones are suggestions too
    this.#put('decline suggestions', keep);
    this.app.usage?.note('tracking:groupsDecline', { n: this.groups.length });
    return true;
  }
  /** Accept re-found groups and suggestions as they are (k: one, else every unconfirmed / suggested one of the take):
   *  a suggestion becomes a painted group (a training label for the seeder). */
  accept(k = -1) {
    const list = this.groups.map((g, j) => ((k < 0 || j === k) && (!isCopy(g) || g.unconfirmed) ? acceptGroup(g) : g));   // copies: Accept is for suggestions (and a copied group not re-found here, paw-lgtx)
    if (list.every((g, j) => g === this.groups[j])) return;
    list.forEach((g, j) => { if (g !== this.groups[j]) this.cache.set(g, this.maskFor(this.groups[j])); });
    this.#put(k < 0 ? 'accept suggestions' : 'accept ' + this.groups[k].name, list);
    this.#retarget();
    this.app.usage?.note('tracking:groupsAccept', { all: k < 0, suggested: this.groups.filter(isSuggested).length });
  }

  // ---- the chips ----
  pick(k) { this.active = k; this.armed = false; const g = this.groups[k]; if (g?.who) this.who = g.who; }
  newGroup(name = this.nextName) { this.active = -1; this.nextName = name; }
  /** Target the active character's part (side: l | r, the character's own, for a paired part): its group when the scene has one, else a new
   *  one on the next stroke. */
  #target(part, side) {
    const sd = PAIRED.includes(part) ? side || 'l' : null, nm = groupName({ who: this.who, part, side: sd });
    this.nextPart = part; if (sd) this.nextSide = sd;
    const k = this.groups.findIndex((g) => g.name === nm);
    this.active = k;
    if (k < 0) this.nextName = nm;
  }
  /** A palette part: arm it (strokes paint that part of the active character: its group when the take has one, else
   *  a new one); the armed part again: disarm (paint first, assign after). */
  pickPart(part, side) {
    const nm = groupName({ who: this.who, part, side: PAIRED.includes(part) ? side || 'l' : null });
    if (this.armed && this.nextName === nm && this.active < 0) { this.armed = false; return; }
    if (this.armed && this.activeGroup?.name === nm) { this.armed = false; return; }
    this.#target(part, side); this.armed = true;
  }
  disarm() { this.armed = false; }
  /** paw-i5qx: Shift+click on a list row: group k selected and the next strokes paint into it wherever they start (the
   *  palette's arming, for a group that exists); the bar's chip or another pick ends it. */
  armGroup(k) { if (!this.groups[k]) return; this.pick(k); this.armed = true; }
  /** paw-i5qx: the picker's Ignore toggle. On: the group becomes an ignore region (what V then a stroke makes, after the
   *  fact; the assign-all pass moves on). Off: an ignore region becomes an unassigned group again (the picker stays open). */
  setIgnore(on) {
    const p = this.picker, g = this.groups[p?.k];
    if (!g || isIgnore(g) === !!on) return;
    if (on) { this.choose({ who: this.who, part: IGNORE }); return; }
    this.active = p.k; this.name(freeUnassigned(this.groups));
  }
  /** Bottom / Top / Extra (keys 1 / 2 / 3): the palette's character; an armed part follows to the same part of that character. */
  setWho(w) {
    if (!WHOS.includes(w)) return;
    this.who = w;
    if (this.armed) { const q = this.activeGroup ? splitName(this.activeGroup.name) : { part: this.nextPart, side: this.nextSide }; this.#target(q.part || 'other', q.side || this.nextSide); }
  }
  /** Shift + a palette part: assign the active group that part (its character, else the palette's). */
  rename(part, side) {
    const g = this.activeGroup;
    if (!g) { this.pickPart(part, side); return; }
    this.assign(this.active, { who: g.who || this.who, part, side });
  }
  /** list replacing the take's groups, masks carried over to the objects that changed (index for index). */
  #putSame(label, list) {
    const old = this.groups;
    list.forEach((g, j) => { if (g !== old[j] && old[j]) this.cache.set(g, this.maskFor(old[j])); });
    this.#put(label, list);
  }
  /** Group k given a character and part (one undo step); it flashes in its new colour. */
  assign(k, sel) {
    const old = this.groups[k], list = assignGroup(this.groups, k, sel);
    if (!old || list === this.groups) return false;
    const { named_by: _nb, ...own } = acceptGroup(list[k]);   // eslint-disable-line no-unused-vars
    list[k] = own;   // a suggestion given another part / character: fixed, so painted; the owner's own naming is never marked auto
    this.#putSame(`assign ${old.name} → ${list[k].name}`, list);
    this.active = k; this.who = sel.who || this.who;
    this.flash = { name: list[k].name, t0: performance.now() };
    return true;
  }
  /** Groups k and j trade assignments (a group's label dragged onto another; one undo step). */
  swapGroups(k, j) {
    const list = swapAssign(this.groups, k, j);
    if (list === this.groups) return;
    list[k] = acceptGroup(list[k]); list[j] = acceptGroup(list[j]);
    this.#putSame(`swap ${this.groups[k].name} ↔ ${this.groups[j].name}`, list);
    this.active = j;
    this.flash = { name: list[j].name, t0: performance.now() };
  }

  // ---- the picker ----
  /** Open the picker on group k (at: stage px to show it at, else next to the group). */
  openPicker(k = this.active, at = null, pass = false) {
    if (!this.groups[k] || this.draft || this.xf || !this.onFrame) return false;   // off the groups' frame they are ghosts of another picture: never assigned from here (paw-r0wp)
    this.active = k; this.picker = { k, at, pass };
    return true;
  }
  /** The picker's choice: assign, then (assign-all pass) on to the next unassigned group. */
  choose(sel) {
    const p = this.picker;
    if (!p) return;
    this.assign(p.k, sel);
    const next = p.pass ? this.unassigned[0] : undefined;
    this.picker = next != null ? { k: next, at: null, pass: true } : null;
    if (next != null) this.active = next;
  }
  closePicker() { this.picker = null; this.pickHover = ''; }
  /** The pass: leave this group unassigned, on to the next one after it. */
  skip() {
    const p = this.picker;
    if (!p) return;
    const u = this.unassigned, next = u.find((k) => k > p.k);
    this.picker = next != null ? { k: next, at: null, pass: true } : null;
    if (next != null) this.active = next;
  }
  /** A (assign): the picker on the group under the pointer; elsewhere the assign-all pass when groups are unassigned,
   *  else the picker on the active group. hover = {nx, ny, x, y} (the overlay's pointer), or null. */
  assignKey(hover) {
    if (!this.onFrame) { this.nudge++; return false; }   // paw-r0wp: the overlay flashes where the groups' frame is
    const k = hover ? this.hitAt(hover.nx, hover.ny) : -1;
    if (k >= 0) return this.openPicker(k, [hover.x, hover.y]);
    if (this.unassigned.length) return this.startPass();
    return this.openPicker(this.active, hover ? [hover.x, hover.y] : null);
  }
  /** "Assign all": the picker on each unassigned group in turn (Esc stops). */
  startPass() { const k = this.unassigned[0]; return k != null && this.openPicker(k, null, true); }
  /** A name for the active group (v4.11 names, scripts): renames it, or names the next new one. */
  name(name) {
    const g = this.activeGroup;
    if (!g) { this.nextName = name; return; }
    if (g.name === name) return;
    const list = [...this.groups], nm = freeName(list.filter((x) => x !== g), name), q = splitName(nm);
    const { who: _w, part: _p, side: _s, ...rest } = g;   // eslint-disable-line no-unused-vars
    list[this.active] = { ...rest, name: nm, pinned: isPinned(nm), ...(q.who ? { who: q.who, part: q.part, ...(q.side ? { side: q.side } : {}) } : {}) };
    this.cache.set(list[this.active], this.maskFor(g));
    this.#put(`rename ${g.name} → ${nm}`, list);
  }
  /** paw-dgtr: Find knot on shaft group k, from the shaft's own shape (autoname.knotRegion). paw-njnf: it is the penis' knot SECTION (one undo
   *  step), never a group: the knot brush (K) adjusts it, Ctrl+Z takes it back. */
  findKnot(k = this.keyTargets()[0] ?? this.active) {
    const g = this.groups[k], q = splitName(g?.name);
    if (!g || q.part !== 'penis' || !this.onFrame || this.draft || this.xf) return false;
    const cues = this.groups.filter((x) => { const s = splitName(x.name); return s.who === q.who && ['balls', 'sheath', 'hips'].includes(s.part); }).map((x) => maskCentre(this.maskFor(x))).filter(Boolean);
    const m = knotRegion(this.maskFor(g), cues);
    if (!m || !fitPoly(m).poly) { this.app.toast?.('No bulge on this shaft: paint the knot with the knot brush (K)', 'quiet'); return false; }
    const list = [...this.groups];
    list[k] = withKnot(g, m.a, this.size);
    this.cache.set(list[k], this.maskFor(g));
    this.#put('find knot', list);
    this.active = k;
    this.app.toast?.('Knot section found on the shaft (darker): the knot brush (K) adjusts it, Ctrl+Z takes it back', 'quiet');
    return true;
  }
  // ---- hover keys (paw-cnfg): 1 / 2 / 3 set the character of the group under the pointer, F flips its side ----
  /** The groups a hover key acts on: [the one under the pointer] (hitAt: what a click takes; Alt+click cycling moves it), else the selected one
   *  when the pointer is on the picture off every group (the labelling workspace: whenever no group is under it), else []. */
  keyTargets() {
    if (!this.onFrame || this.draft || this.xf || this.picker) return [];
    const h = this.hover, k = h ? this.hitAt(h.nx, h.ny) : -1;
    if (k >= 0) return [k];
    const a = this.activeGroup;
    return a && !a.off && (h || this.labelMode) ? [this.active] : [];
  }
  /** Keys 1 / 2 / 3: the targeted groups to character w (-> true), else (nothing under the pointer) the character painted next, as before. */
  whoKey(w) {
    const ks = this.keyTargets();
    if (!ks.length) { this.setWho(w); return false; }
    this.setWhoFor(ks, w);
    if (!(this.hover && this.hitAt(this.hover.nx, this.hover.ny) >= 0)) this.setWho(w);   // the selection, not a hovered group: the next paint follows too
    return true;
  }
  /** Groups ks to character w: an assigned one is renamed (part and side kept, a free repeat on a clash), an unassigned one remembers it for
   *  Enter. One undo step for the renames. -> how many changed. */
  setWhoFor(ks, w) {
    if (!WHOS.includes(w)) return 0;
    const old = this.groups, whos = new Map(this.whoSet);
    let list = [...old], n = 0, last = '', renamed = false;
    for (const k of ks) {
      const g = list[k];
      if (!g || isIgnore(g)) continue;
      if (isUnassigned(g)) {
        // an unlabelled blob with a proposal: the key APPLIES it as that character at once (the owner: "pressing 1 or 2 on a
        // unlabelled region should apply the suggestion"), its top part, doubtful or not: pointing at it and pressing is the confirmation
        const part = this.onFrame ? this.proposalFor(g)?.parts?.[0]?.part : null;
        if (part) {
          const used = new Set(list.filter((x) => x !== g && !isUnassigned(x)).map((x) => x.name.replace(/\d+$/, '')));
          const side = PAIRED.includes(part) ? this.sideSet.get(g) || pairSide(used, w, part) : null;   // paw-5r1: the character's own side
          const out = assignGroup(list, k, { who: w, part, side });
          if (out !== list) { list = out; list[k] = { ...acceptGroup(list[k]), named_by: NAMED_BY }; renamed = true; n++; last = list[k].name; continue; }
        }
        if (whos.get(g) !== w) { whos.set(g, w); n++; }
        last = g.name; continue;
      }
      const q = splitName(g.name);
      if (!(g.who || q.who) || (g.who || q.who) === w) continue;
      const nm = freeName(list.filter((x) => x !== g), groupName({ who: w, part: q.part, side: q.side }));
      const { named_by: _nb, ...own } = acceptGroup({ ...g, name: nm, who: w, part: q.part, ...(q.side ? { side: q.side } : {}) });   // eslint-disable-line no-unused-vars
      list[k] = own; renamed = true; n++; last = nm;
    }
    if (!n) return 0;
    if (renamed) this.#putSame(ks.length > 1 ? `${ks.length} groups → ${whoName(w)}` : `${old[ks[0]].name} → ${last}`, list);
    this.whoSet = whos;
    if (ks.includes(this.active)) this.who = w;
    this.flash = { name: last, t0: performance.now() };
    this.app.toast?.(`${ks.length > 1 ? ks.length + ' groups' : partLabel(last)} → ${whoName(w)}`, 'quiet');
    return n;
  }
  /** F: group k's side l <-> r (the character's own left / right, paw-5r1; a paired part only: shoulder, forearm, hand, thighs, shin, paws; an
   *  unassigned blob with a proposal for one: the side Enter will use). The twin (the other side of the same character's part) trades sides
   *  with it: one undo step. -> 'l' | 'r' (the new side) | false (no sides). */
  flipSide(k = this.active) {
    const g = this.groups[k];
    if (!g || isIgnore(g)) return false;
    if (isUnassigned(g)) {
      const part = this.proposalFor(g)?.parts[0]?.part;
      if (!PAIRED.includes(part)) return false;
      const cur = this.proposedSide(g)?.side || 'l', to = cur === 'l' ? 'r' : 'l';
      this.sideSet = new Map(this.sideSet).set(g, to);
      this.flash = { name: g.name, t0: performance.now() };
      this.app.toast?.(`${partWord(part)} → ${to.toUpperCase()}`, 'quiet');
      return to;
    }
    const q = splitName(g.name), who = g.who || q.who;
    if (!who || !PAIRED.includes(q.part)) return false;
    const cur = q.side || 'l', to = cur === 'l' ? 'r' : 'l', list = [...this.groups], base = (x) => x.name.replace(/\d+$/, '');
    const twin = list.findIndex((x, j) => j !== k && !isUnassigned(x) && base(x) === groupName({ who, part: q.part, side: to }));
    const rest = list.filter((x, j) => j !== k && j !== twin);
    const put = (j, side) => {
      const nm = freeName(rest, groupName({ who, part: q.part, side })), { named_by: _nb, ...own } = acceptGroup({ ...list[j], name: nm, who, part: q.part, side });   // eslint-disable-line no-unused-vars
      list[j] = own; rest.push(own);
    };
    put(k, to);
    if (twin >= 0) put(twin, cur);
    this.#putSame(twin >= 0 ? `swap sides of ${partLabel(g.name)} and ${partLabel(this.groups[twin].name)}` : `${g.name} → ${list[k].name}`, list);
    this.flash = { name: list[k].name, t0: performance.now() };
    this.app.toast?.(`${partLabel(list[k].name)}${twin >= 0 ? ' (the other swapped)' : ''}`, 'quiet');
    return to;
  }
  /** Group k to character `to` (default the other of Bottom / Top; its part and side kept; a free name there). */
  moveWho(k, to) {
    const g = this.groups[k];
    if (!g) return;
    const q = splitName(g.name), who = to || ((g.who || this.who) === 'c2' ? 'c1' : 'c2'), list = [...this.groups];
    const nm = freeName(list.filter((x) => x !== g), groupName({ who, part: q.part, side: q.side }));
    list[k] = acceptGroup({ ...g, name: nm, who, part: q.part, ...(q.side ? { side: q.side } : {}) });
    this.cache.set(list[k], this.maskFor(g));
    this.#put(`${g.name} → ${nm}`, list);
    if (k === this.active) this.who = who;
  }
  /** Swap Bottom and Top for every group of the scene (one undo step); Extra is untouched. */
  swap() {
    if (!this.groups.some((g) => g.who)) return;
    const list = swapWho(this.groups);
    list.forEach((g, k) => this.cache.set(g, this.maskFor(this.groups[k])));
    this.#put('swap Bottom and Top', list);
    this.who = { c1: 'c2', c2: 'c1' }[this.who] || this.who;
    if (this.armed && this.active < 0) this.#target(this.nextPart, this.nextSide);
  }
  remove(k = this.active) {
    const g = this.groups[k];
    if (!g) return;
    this.#put('delete ' + g.name, this.groups.filter((_, j) => j !== k));
    this.active = Math.min(k, this.groups.length - 1);
  }
  /** Pulse parts (groups.js canPulse): flag / unflag group k as a spurt cue (detect cumshots tracks it). */
  togglePulse(k) {
    const g = this.groups[k];
    if (!g || !canPulse(g)) return;
    const list = [...this.groups];
    list[k] = togglePulse(g);
    this.cache.set(list[k], this.maskFor(g));
    this.#put(`${isPulse(list[k]) ? 'pulse' : 'no pulse'} ${g.name}`, list);
  }
  /** Penis groups (groups.js canShaft): measure / stop measuring how much of group k is inside (Track's shaft pass). */
  toggleShaft(k) {
    const g = this.groups[k], s = this.scenes[this.scene];
    if (!g || !canShaft(g)) return;
    const list = [...this.groups];
    list[k] = toggleShaft(g, s);
    this.cache.set(list[k], this.maskFor(g));
    this.#put(`${isShaft(list[k], s) ? 'depth' : 'no depth'} ${g.name}`, list);
  }
  /** paw-4c48.19: any other part (groups.js canDepth): measure / stop measuring its depth with SAM on the next Track. */
  toggleDepth(k) {
    const g = this.groups[k];
    if (!g || !canDepth(g)) return;
    const list = [...this.groups];
    list[k] = toggleDepth(g);
    this.cache.set(list[k], this.maskFor(g));
    this.#put(`${isDepth(list[k]) ? 'depth' : 'no depth'} ${g.name}`, list);
  }
  toggleOff(k) {
    const g = this.groups[k];
    if (!g) return;
    const list = [...this.groups];
    list[k] = { ...g, off: !g.off || undefined };
    this.cache.set(list[k], this.maskFor(g));
    this.#put(`${g.off ? 'use' : 'skip'} ${g.name}`, list);
  }

  // ---- Suggest (sidecar suggest_groups) ----
  /** What the tagger would pin on this frame (the groups' frame, which is the frame on screen: off it, nothing runs):
   *  replaces the previous suggestions (groups the owner has not painted on). Never seeks. */
  async suggest() {
    if (this.labelMode) return this.labelSuggest?.();   // a still image of the labelling workspace (workspace.svelte.js)
    const app = this.app, tr = this.tr, s = this.scenes[this.scene];
    if (!s || this.busy || !tr.videoPath) return;
    if (!this.onFrame) { this.nudge++; return; }
    if (tr.busy === 'seed' && tr.owner === 'seeder') tr.cancelOwner('seeder');   // a background retrain waits for the next save
    const pv = tr.params, params = { ...(pv.sem_shape ? { sem_shape: pv.sem_shape } : {}), head_shape: app.settings.get('tracking.seeder.sam') ? 'sam' : 'head', paint_margin: this.margin };
    const box = tr.roi?.kind === 'box' ? tr.roi : null, i = this.scene;
    this.busy = true;
    try {
      // scenes contain shots: after a hard cut inside the scene, the groups drawn in its other takes are the clue (v4.13)
      const prior = priorFor(this.scenes, i);
      // v4.18: the learned head + the video's key (its painted characters name Bottom / Top); the seed frame from the take's start
      const dir = await this.seedDir(), ds = await this.dataset(), key = await this.mediaKey(), seed = dir ? { dir, ...(ds ? { dataset: ds.dir } : {}), key, features: app.settings.get('tracking.seeder.features', 'auto') } : null;
      // paw-8yip: frames that repeat elsewhere weigh more (and are added), the owner's loop frame most (v4.20)
      const win = seedWindowOf(app, i);   // paw-ef73.9: candidates after a fade in / past a lead-in only
      const chosen = preferredPictures(app), bestF = prior.length ? null : bestPaintFrame(this.scenes, i, repeatsOf(app), chosen, win);   // paw-8mf4: and the take's best frame to paint
      const rc = repeatCandidates(repeatsOf(app), prior.length || this.others.length ? [] : seedCandidates(this.scenes, i, this.t, app.player.frameMs || 0, win), gridOf(app.player), chosen, undefined, bestF);
      const candidates = this.others.length ? [] : rc.candidates, here = this.t;   // paw-o74b: adding groups to a seeded take: on this very frame
      const req = suggestGroupsRequest({ video: tr.videoPath, t_ms: this.t, roi: box && { kind: 'box', x: box.x, y: box.y, w: box.w, h: box.h }, params, prior, seed, candidates, candidateBonus: rc.bonus });
      const r = await tr.job('groups', req, { title: 'Suggesting groups', scene: i, range: { t0: s.start_ms, t1: s.end_ms } });
      if (r.cancelled) return;
      if (r.error) { app.toast('Suggest groups failed: ' + String(r.error).split(/\r?\n/)[0], 'error'); return; }
      if (this.scenes[i] !== s || i !== this.scene) return;   // the scene changed meanwhile
      const res = r.result || {};
      if ('seeder' in res) this.seeder = res.seeder ? { ...(this.seeder || {}), ...res.seeder } : null;
      const best = res.frame === 'best' && Number.isFinite(res.t_ms), t = best ? this.stampOf(res.t_ms) : this.t;   // v4.18: Suggest picked another frame
      const nOf = (x) => res.candidates?.find((c) => c.t_ms === x)?.parts;
      this.picked = best && t !== here ? { t, parts: nOf(res.t_ms), here: nOf(Math.round(here)), from: here, ...(rc.why[res.t_ms] || {}) } : null;   // repeats / loop: why it won
      const keep = this.groups.filter((g) => !isSuggested(g));
      let all = suggestedGroups(res, t, keep, (poly) => encodeMask(rasterPoly(poly, this.size)));   // v4.12: who_part_side; v4.13: re-found ones keep their names
      // paw-o74b.1: a part seeded on another frame may be proposed again (a re-anchor); where a part's tracked outline lies under a
      // suggestion, the suggestion takes that part's name
      if (t === here && this.others.length) for (let k = 0; k < all.length; k++) {
        const g = all[k];
        if (isUnassigned(g) || g.unconfirmed || isIgnore(g)) continue;
        const o = this.trackedUnder(rasterPoly(g.poly, this.size)), q = splitName(o?.g.name);
        if (!o || o.g.name === g.name || !q.who || [...keep, ...all].some((x) => x.name === o.g.name)) continue;
        all = assignGroup(all, k, { who: q.who, part: q.part, side: q.side });
      }
      const { shown, hidden } = splitByConfidence(all, this.suggestConf), list = [...keep, ...shown];   // paw-r6t0: only what is at or above the shown confidence goes in the take
      this.holdSuggestions(hidden);
      this.#put('suggest', list);
      this.active = list.length > keep.length ? keep.length : this.active;
      const refound = list.filter((g) => g.unconfirmed).length;
      if (prior.length) app.usage?.note('tracking:groupsRefind', { prior: prior.length, refound, missing: res.missing?.length || 0 });
      const n = list.length - keep.length, learned = list.slice(keep.length).filter((g) => g.source === 'seeder').length;
      app.usage?.note('tracking:groupsSuggest', { n, learned, best: !!this.picked, seeder: res.seeder?.frames || 0 });
      app.toast(prior.length ? `Re-found ${refound} of ${prior.length} groups from the scene's other shot (dashed: unconfirmed, Accept or repaint)${res.missing?.length ? ` · not found: ${res.missing.join(', ')}` : ''}`
        : `${n} suggested group${n === 1 ? '' : 's'}${hidden.length ? ` · ${hidden.length} more below ${Math.round(this.suggestConf * 100)} %` : ''}${learned ? ` (${learned} learned)` : ''}${this.picked ? ` on frame ${Math.round(t / (app.player.frameMs || 33.367))}, ${this.picked.parts ?? '?'} parts vs ${this.picked.here ?? '?'} here${this.picked.loop ? ', your loop frame' : ''}${this.picked.repeats ? `, repeats ${this.picked.repeats}×` : ''}: Go there in the toolbar` : ''}${res.ms != null ? ` (${(res.ms / 1000).toFixed(1)} s)` : ''}${(() => { const y = youngNote(res.seeder, (this.datasets?.info?.() || {}).name); return y ? ` · ${y}` : ''; })()}`,
        (prior.length && res.missing?.length) || this.picked ? 'info' : 'quiet');
    } finally { this.busy = false; }
  }

  // ---- filling from repeats (paw-8mf4) ----
  #filled = new Set();   // takes auto-filled this session (media path + take key): an undo of a fill never re-fills it
  /** The take the tool is on is selected (or the repeats / runs it needs arrived): fill it when it has no groups, the
   *  setting is on and it was never filled (or dropped) before. */
  maybeAutoFill() {
    const app = this.app, i = this.scene;
    if (!this.on || this.labelMode || this.mod || i < 0 || !autoFill(app) || this.all.length || this.draft) return;   // paw-o74b: a take seeded on another frame is not empty
    const key = takeKey(this.scenes, i), mem = `${app.doc.media?.path}|${key}`;
    if (key == null || this.#filled.has(mem) || filledTakes(app).includes(key)) return;
    const f = fillFor(app, i);
    if (!f) return;
    this.#filled.add(mem);
    applyFill(app, i, f, true);
  }

  // ---- Copy from… (paw-lgtx, copy-from.js; paw-55la: the two-way search) ----
  copy = $state.raw(null);      // the strip: {t (the frame on screen, stamped), home (the playhead when it opened), k (its frame), shot, items: [tile {key, kind, t, k (the frame of this shot it matches), at (its stamp), d, src?, run?, thumb?}], busy, hover: key | ''}
  copyWait = $state.raw(null);  // (paw-trxk: never set now: a pick lines the set up at once, no sidecar re-find)
  #cf = null;                   // {path, scrub, shots: Map frame index -> {p: Promise<{print, big, thumb}>, thumb}, queue, dead (the decoder could not be made), why (its error), still (frames came from the player's stills)}: one decoder per video, prints / thumbnails cached
  #cTok = 0; #cWarm = 0;
  copyFramesWhy = $state('');   // paw-wfd2.3: why Copy from… reads the player's stills (no decoder of its own for this video), '' = it does not: the health slot's "Frame reader degraded"
  #cx = null;                   // the open search: {targets: Map frame index -> print, big: Map frame index -> PRINT_W print, xf: Map 'key@k' -> move, relink}
  /** The lined-up groups to preview: the picked one's while it is re-found, else the hovered one's (on ITS frame of the shot, which the video shows); null for none. */
  get copyPreview() {
    if (this.copyWait) return this.copyWait;
    const c = this.copy?.hover ? this.copy.items.find((x) => x.key === this.copy.hover) : null;
    return c ? this.#moved(c) : null;
  }
  #fk(ms) { const p = this.app.player; return p.clock?.frameAt ? p.clock.frameAt(ms) : Math.floor((ms + 0.6) / (p.frameMs || 1000 / 30)); }
  #ft(k) { const p = this.app.player; return p.clock?.timeOf ? p.clock.timeOf(k) : k * (p.frameMs || 1000 / 30); }
  /** The move that lines tile c's source up on its frame of the shot, cached per pair: paw-d2d5, a re-framed source through
   *  the crop (copy-from.js cropXf: the shots' crop link refined on the two frames, else a crop match of the two frames;
   *  ~1 / ~6 ms, computed on the first hover), else the print move (likeness); a run here: none. A crop move carries
   *  `crop` {scale, score, via}; a pair checked and not re-framed carries `crop: null`. */
  #xfOf(c) {
    if (c.kind === 'here') return IDENTITY;
    const cx = this.#cx, id = `${c.key}@${c.k}`, p = cx?.targets.get(c.k);
    if (cx && (!c.print || !p) && c.crop) {   // paw-trxk: a linked source that could not be read: through the link's box as it is
      if (!cx.xf.has(id)) cx.xf.set(id, { ...boxXf(c.crop.box, c.crop.wideIsSrc), crop: { scale: c.crop.scale, score: c.crop.score, via: c.crop.via === 'loops' ? 'loops' : 'link', box: c.crop.box, wideIsSrc: c.crop.wideIsSrc } });
      return cx.xf.get(id);
    }
    if (!cx || !c.print || !p) return IDENTITY;
    if (!cx.xf.has(id)) {
      const bt = cx.big.get(c.k), same = !c.crop && printDist(c.print, p) <= 0.02;   // an exact repeat (d ~ 0) stays put
      const r = c.big && bt && !same ? cropXf(pyramid(c.big), pyramid(bt), c.crop || null) : null;
      const cr = r ? { ...r.xf, crop: { scale: r.scale, score: r.score, via: c.crop?.via === 'loops' ? 'loops' : r.via, box: r.box, wideIsSrc: r.wideIsSrc } } : null;
      let xf;
      if (same) xf = { ...IDENTITY, crop: null };
      else if (!c.big || !bt) xf = cr || { ...likeness(c.print, p).xf, crop: null };   // no full prints: the print move
      else {
        // paw-trxk + paw-vnlj: ONE move for the whole set over the pixels the groups cover: the global search (scale, shift,
        // turn), against the crop's own move refined (re-framed footage past the search's x1.5) when there is one; the better NCC wins
        const R = regionOf(sourceGroups(c, this.size, (g) => this.maskFor(g)), c.big.w, c.big.h, (g) => this.maskFor(g));
        const a = alignRegion(c.big, bt, R), j = cr ? jointFit(c.big, bt, R, cr) : null;
        const nccOf = (x) => x.ncc ?? regionNcc(c.big, bt, R, x);
        xf = j && nccOf(j) >= nccOf(a) ? { ...j, crop: cr.crop } : { ...a, crop: null };
      }
      cx.xf.set(id, xf);
    }
    return cx.xf.get(id);
  }
  #moved(c) {
    const xf = this.#xfOf(c);
    if (c.moved?.xf !== xf) c.moved = { xf, gs: moveGroups(sourceGroups(c, this.size, (g) => this.maskFor(g)), xf, c.at, (g) => this.maskFor(g)) };
    return c.moved.gs;
  }
  /** Frame k decoded once (WebCodecs, its own decoder, one request at a time; asked at the frame's middle): {print (FP x FP
   *  grey), thumb (ImageBitmap THUMB_W wide, when asked for)}, both null when unreadable. shown: the frame on screen, decoded already. */
  #shot(k, { thumb = false, shown = null } = {}) {
    const app = this.app, path = this.tr.videoPath;
    if (this.#cf?.path !== path) { this.#cf?.scrub?.then((s) => s?.dispose()); this.#cf = { path, scrub: null, shots: new Map(), queue: Promise.resolve() }; this.copyFramesWhy = ''; }
    const cf = this.#cf, hit = cf.shots.get(k);
    if (hit && (hit.thumb || !thumb)) return hit.p;
    const none = { print: null, thumb: null };
    const draw = (f) => {
      const w = THUMB_W, h = Math.max(1, Math.round(w / (this.tr.aspect || 16 / 9))), tc = new OffscreenCanvas(w, h), tg = tc.getContext('2d');
      tg.imageSmoothingQuality = 'high'; tg.drawImage(f, 0, 0, w, h);
      const pc = new OffscreenCanvas(FP, FP), pg = pc.getContext('2d', { willReadFrequently: true });
      pg.imageSmoothingQuality = 'high'; pg.drawImage(tc, 0, 0, FP, FP);
      const { w: bw, h: bh } = printSize(f.displayWidth || f.width, f.displayHeight || f.height), bc = new OffscreenCanvas(bw, bh), bg = bc.getContext('2d', { willReadFrequently: true });
      bg.imageSmoothingQuality = 'high'; bg.drawImage(f, 0, 0, bw, bh);   // paw-d2d5: the crop matcher's print (lib/crop-match.js, 128 px)
      return { print: greyN(pg.getImageData(0, 0, FP, FP).data), big: greyBig(bg.getImageData(0, 0, bw, bh).data, bw, bh), thumb: thumb ? tc.transferToImageBitmap() : null };
    };
    if (shown && typeof OffscreenCanvas !== 'undefined') { let r = none; try { r = draw(shown); } catch { r = none; } if (r.print) { const p = Promise.resolve(r); cf.shots.set(k, { p, thumb }); return p; } }   // the frame on screen, decoded already (the snap's)
    const p = cf.queue.then(async () => {
      if (typeof OffscreenCanvas === 'undefined' || !path || !this.on) return none;   // the tool closed meanwhile: no new decoder
      const old = cf.scrub && (await cf.scrub);
      if (old?.error) { old.dispose(); cf.scrub = null; }   // paw-d2d5: a decoder that failed (or the browser reclaimed) answers null to every frame: a new one
      cf.scrub ??= createScrubber({ url: app.player?.url || app.backend?.mediaUrl?.(path) || path, path, fps: app.doc.media?.fps || 30, ringS: 0.5, backend: app.backend,
        alts: app.player?.frameFiles?.(path) || [], task: (l, o) => app.task?.(l, o) })   // paw-b88b: a WebM / VP8 source reads the scrub cache or a proxy, else a transcode
        .catch((e) => { console.info('[groups] copy from: no frames:', e?.message || e); cf.dead = true; cf.plain = e?.plain; cf.why = String(e?.message || e).replace(/^scrub: /, '').slice(0, 80); return null; });
      const s = await cf.scrub;
      if (s) { const f = await s.frameAt(this.#ft(k) + (app.player.frameMs || 33) / 2); return f ? draw(f) : none; }
      // paw-trxk: no decoder of its own for this file: the player's stills (the scrub cache's decoder, else the hidden <video>)
      const b = await Promise.resolve(app.player.still?.(k, 360)).catch(() => null);
      if (!b) return none;
      cf.still = true; this.copyFramesWhy = cf.why || 'no decoder for this file';
      return draw(b);   // never closed: the player's hidden-<video> frames are its own LRU's
    }).catch(() => none);
    const e = { p, thumb };
    cf.queue = p;
    cf.shots.set(k, e);
    p.then((r) => { if (!r.print && cf.shots.get(k) === e) cf.shots.delete(k); });   // unreadable now (a decoder closed meanwhile): asked again next time
    return p;
  }
  /** What the search compares for the frame on screen: every frame of the I-O range inside this take, else of the shot
   *  under the playhead (copy-from.js shotFrames: away from the cuts; the owner: "search all frames in the current
   *  selected range / shot"), and the sources (other takes' painted frames, runs' tracked frames elsewhere)
   *  -> {k0, k1, shot, painted, tracked} or null. */
  #copyPlan(now = this.app.player.timeMs) {
    if (!this.on || this.labelMode || this.mod || this.scene < 0 || !this.tr.videoPath) return null;
    const app = this.app, fm = app.player.frameMs || 1000 / 30, si = this.#sceneAt(now), sh = this.scenes[si], r = takeRange(this.scenes, this.scene);
    if (!sh || !r) return null;
    const io = app.doc.range, ta = this.scenes[r[0]].start_ms, tb = this.scenes[r[1]].end_ms;
    const [a, b] = io && Math.min(io.t1, tb) - Math.max(io.t0, ta) >= fm ? [Math.max(io.t0, ta), Math.min(io.t1, tb)] : [sh.start_ms, sh.end_ms];
    let [k0, k1] = shotFrames(a, b, gridOf(app.player) || fm);
    if (k0 > k1) k0 = k1 = this.#fk(now);
    const painted = paintedSources(this.scenes, this.scene);
    return { k0, k1, shot: si, painted, tracked: trackedSources(this.tr.runs, this.scenes[r[0]].start_ms, this.scenes[r[1]].end_ms, fm, { scenes: this.scenes, painted }) };
  }
  /** The prints the strip needs, decoded in the background a moment after the tool opens (cached per video): painted frames,
   *  the shot under the playhead (coarse), runs' frames; the strip then opens at once. An open search stops it. */
  #warmCopy() {
    clearTimeout(this.#cw);
    const tok = ++this.#cWarm;
    this.#cw = setTimeout(async () => {
      // paw-o60v.6: never while a stroke is in progress (each frame's decode + read is one task of up to ~60 ms): it waits for the pen up
      const go = async () => { while (this.draft && tok === this.#cWarm && this.on) await new Promise((r) => setTimeout(r, 100)); return tok === this.#cWarm && this.on; };
      const pl = this.#copyPlan();
      if (!pl) return;
      for (const c of pl.painted) { if (!(await go())) return; await this.#shot(this.#fk(c.t), { thumb: true }); }
      for (const k of coarseFrames(pl.k0, pl.k1)) { if (!(await go())) return; await this.#shot(k); }
      for (const c of pl.tracked) { if (!(await go())) return; await this.#shot(this.#fk(c.t), { thumb: true }); }
    }, 1500);
  }
  #cw = 0;
  /** C / the toolbar's "Copy from…": open the strip (again: close it). The two-way search (paw-55la): the frames of the shot
   *  under the playhead against the sources' frames, every pair by print distance; each tile is a source at the frame of the
   *  shot it matches (copy-from.js bestPairs). Progressive: tiles for the frame on screen first, then better pairs as the
   *  shot's frames (coarse, then every frame around the best pairs) and the runs' frames decode. "Tracked here" stays first. */
  async openCopy() {
    const app = this.app, tr = this.tr;
    if (this.copy) { this.closeCopy(); return false; }
    if (this.busy) return false;
    const now = app.player.timeMs, plan = this.#copyPlan(now);
    if (!plan) return false;
    app.player.pause();
    this.#cWarm++;   // the search does the warm-up's work, first things first
    if (this.#cf?.dead) { this.#cf.scrub = null; this.#cf.dead = false; }   // paw-trxk: a decoder that could not be made is tried again once per search
    const fm = app.player.frameMs || 1000 / 30, t = this.stampOf(now), kNow = this.#fk(now), { k0, k1, painted, tracked } = plan;
    const tok = ++this.#cTok, live = () => tok === this.#cTok && !!this.copy, t0 = performance.now();
    const here = runsHere(tr.runs, t, fm).map((c) => ({ ...c, k: kNow, at: t, d: 0 }));
    const sources = [...painted, ...tracked], targets = new Map(), big = new Map(), ds = new Map();   // ds: source key -> Map frame -> print distance
    // paw-d2d5: a source in a shot crop-linked to this one (tracking shotLinks) is ranked by the crop matcher under the
    // link's box (copy-from.js cropDist: the frame showing its drawing) and placed through the crop; links that arrive
    // later (they follow Detect) re-rank the open strip (copyRelink)
    const link = (links) => { for (const c of sources) c.crop = linkFor(links, this.scenes, c.t, now); };
    link(tr.shotLinks?.links);
    this.#cx = { targets, big, xf: new Map(), links: tr.shotLinks, relink: (l) => { this.#cx.links = l; link(l?.links); ds.clear(); this.#cx.xf.clear(); this.copy = { ...this.copy, re: {} }; show(!!this.copy.busy, true); } };
    const dist = (c, k) => {
      let m = ds.get(c.key); if (!m) ds.set(c.key, (m = new Map()));
      let d = m.get(k);
      if (d === undefined) m.set(k, (d = c.crop && c.big && big.get(k) ? cropDist(c.big, big.get(k), c.crop) : printDist(c.print, targets.get(k))));
      return d;
    };
    let shown = 0, first = 0;
    // paw-trxk: the tiles, in the owner's order: sources in a shot linked to this one (crop / loop links: the same footage),
    // the run on this frame, painted frames, runs' frames; one per take for the six numbered ones; after them EVERY other
    // painted frame (they are few), the ones the decoder could not read last ('not compared'), so the one he means is
    // always in the strip
    const show = (busy = true, force = false) => {
      if (!live() || (!force && performance.now() - shown < 80)) return;
      shown = performance.now();
      const pairs = bestPairs(sources, targets, kNow, { max: COPY_MAX, dist });
      if (pairs.length && !first) first = Math.round(performance.now() - t0);
      const top = [...pairs.filter((c) => tierOf(c) === 0), ...here, ...pairs.filter((c) => tierOf(c) > 0)].slice(0, COPY_MAX), seen = new Set(top.map((c) => c.key));
      const rest = painted.filter((c) => !seen.has(c.key));
      const more = [...bestPairs(rest.map((c) => ({ ...c, src: c.key })), targets, kNow, { max: Infinity, dist }).map((c) => ({ ...c, src: painted.find((x) => x.key === c.key)?.src })),
        ...rest.filter((c) => !c.print && !busy).map((c) => ({ ...c, k: kNow, d: null, unread: true }))].map((c) => ({ ...c, more: true }));
      const was = this.copy.hover && this.copy.items.find((x) => x.key === this.copy.hover)?.k;
      this.copy = { ...this.copy, busy, items: [...top, ...more].map((c) => ({ ...c, at: c.at ?? this.stampOf(this.#ft(c.k)) })) };   // new objects every time (the strip redraws)
      const hv = this.copy.hover && this.copy.items.find((x) => x.key === this.copy.hover);
      if (hv && hv.k !== was) app.player.scrub(this.#ft(hv.k) + fm / 2);   // the hovered tile found a better frame: the peek follows
    };
    this.copy = { t, home: now, k: kNow, shot: plan.shot, items: [], busy: true, hover: '' };
    show(true, true);
    const cur = await this.#shot(kNow, { thumb: true, shown: this.#bitmap() });
    if (!live()) return false;
    for (const c of here) c.thumb = cur.thumb;
    if (cur.print) { targets.set(kNow, cur.print); big.set(kNow, cur.big); }
    show(true, true);
    const srcs = async (list) => {   // time order: the decoder walks forward
      for (const c of [...list].sort((a, b) => a.t - b.t)) {
        const sh = await this.#shot(this.#fk(c.t), { thumb: true });
        if (!live()) return false;
        c.thumb = sh.thumb; c.print = sh.print; c.big = sh.big;
        show();
      }
      show(true, true); return true;
    };
    const frames = async (ks) => {
      for (const k of ks) {
        if (targets.has(k)) continue;
        const sh = await this.#shot(k);
        if (!live()) return false;
        if (sh.print) { targets.set(k, sh.print); big.set(k, sh.big); }
        show();
      }
      show(true, true); return true;
    };
    // painted frames, the shot coarse, every frame around the best pairs (the painted ranking is final), then the runs' frames
    // (their decode walks every frame of their spans: the slow part) and every frame around their best pairs
    const co = coarseFrames(k0, k1), lap = [], mark = () => lap.push(Math.round(performance.now() - t0));
    const refine = () => frames(aroundFrames(bestPairs(sources, targets, kNow, { dist }).map((c) => c.k), co.stride - 1, k0, k1, targets));
    if (!(await srcs(painted)) || (mark(), !(await frames(co))) || (mark(), !(await refine()))) return false;
    mark(); show(true, true);
    if (!(await srcs(tracked)) || (mark(), !(await refine()))) return false;
    const sp = this.#cf?.scrub, dec = await sp, cf = this.#cf;   // paw-qv00: why a search printed only the frame on screen
    if (!live()) return false;
    // paw-trxk: say so when the search could not look properly (it used to show poor candidates silently)
    const unread = painted.filter((c) => !c.print).length, few = k1 > k0 && targets.size <= 1;
    // paw-b88b: no frame reader for this video at all: one plain line and, once per video, the fix; the reasons (ffmpeg's own
    // words among them) go to the console and the usage log only
    const none = !!cf?.dead && (few || unread > 0);
    if (none) app.player?.framesUnreadable?.(cf.plain || UNREADABLE);
    const warn = none ? cf.plain || UNREADABLE : few || unread ? `${few ? 'Compared only the frame on screen: the frame decoder is not responding' : ''}${few && unread ? ' · ' : ''}${unread ? `${unread} painted frame${unread === 1 ? '' : 's'} could not be read: listed, not compared` : ''}` : '';
    this.copy = { ...this.copy, warn };
    show(false, true);
    const ms = Math.round(performance.now() - t0);
    this.copyStats = { first, ms, frames: targets.size, sources: sources.length, lap, unread, warn };
    app.usage?.note('tracking:groupsCopyFrom', { here: here.length, painted: painted.length, tracked: tracked.length, frames: targets.size, shot: k1 - k0 + 1, first, painted_ms: lap[2], ms, prints: !!cur.print,
      decoder: dec ? (dec.error ? String(dec.error?.message || dec.error).slice(0, 80) : 'ok') : sp ? `failed${cf?.why ? ': ' + cf.why : ''}${cf?.still ? ' (stills)' : ''}` : 'none', crop: sources.filter((c) => c.crop).length, unread,
      linked: sources.filter((c) => c.crop && c.kind === 'painted').length, top: (this.copy.items || []).slice(0, COPY_MAX).map((c) => `${c.kind[0]}${c.crop ? (c.crop.via === 'loops' ? 'L' : 'C') : ''}`).join('') });
    return true;
  }
  copyStats = null;   // the last search's timing {first (ms to the first pair tile), ms (the final ranking), frames, sources, lap: ms at [painted, shot coarse, painted ranking final, runs' frames]} (the check scripts read it)
  /** Close the strip; back (default): a hovered tile's frame is left, the video returns to the frame the owner was on. */
  closeCopy(back = true) {
    const cp = this.copy;
    if (!cp) return;
    this.#cTok++; this.copy = null; this.#cx = null;
    if (back && cp.hover) this.app.player.scrub(cp.home);
  }
  /** paw-d2d5: the crop links changed while the strip is open (they arrive after Detect): re-rank it. */
  copyRelink(links) { if (this.copy && this.#cx && this.#cx.links !== links) this.#cx.relink(links); }
  /** Hover = peek: the video shows the tile's frame of the shot through the player's scrub path (decoded frames over the
   *  <video>), the groups lined up on it; leaving the tile goes back to the frame the owner was on. */
  copyHover(key = '') {
    const cp = this.copy;
    if (!cp || cp.hover === key) return;
    const c = key ? cp.items.find((x) => x.key === key) : null;
    const xf = c && c.kind !== 'here' ? this.#xfOf(c) : null;   // paw-d2d5: computed here, on the hover (cached per pair): re = what the strip says of each tile
    this.copy = { ...cp, hover: c ? key : '', ...(xf && 'crop' in xf ? { re: { ...cp.re, [key]: xf.crop } } : {}) };
    this.app.player.scrub(c ? this.#ft(c.k) + (this.app.player.frameMs || 33) / 2 : cp.home);
  }
  /** A tile picked (click, 1..6): the playhead goes to its frame of the shot and the groups land there as the hover showed
   *  them: paw-trxk, ONE move for the whole set (the crop / print move refined over all the groups' pixels together, copy-from.js
   *  jointFit), never part by part (the sidecar's per-part re-find scattered the set: the owner's "lining up needs to be all
   *  points grouped"), each a dotted '?' copy to Accept, nudge or repaint; ONE undo step puts them in the take on that frame
   *  (copy-from.js landCopies). A run's points here go in as they are. Suggest still re-finds parts one by one when he asks. */
  async copyPick(key) {
    const app = this.app, cp = this.copy, c = cp?.items.find((x) => x.key === key);
    if (!c || this.busy) return false;
    const src = cp.items.indexOf(c), moved = this.#moved(c), xf = this.#xfOf(c), t = c.at, i = this.scene, s0 = this.scenes[i];
    this.closeCopy(false);
    if (c.k !== cp.k) app.player.seek(this.#ft(c.k));   // that frame becomes the seed frame of the copies
    if (!moved.length) { app.toast(xf.crop ? `Nothing to copy: none of the ${moved.of} parts are in this framing` : 'Nothing to copy: those groups fall outside this picture', 'info'); return false; }
    if (!this.on || this.scenes[i]?.start_ms !== s0?.start_ms) return false;
    const list = c.kind === 'here' ? moved : moved.map((g) => ({ ...g, unconfirmed: true })), why = '';
    const all = this.all, land = landCopies(all, list, (g) => this.#onT(g, t));
    app.transact(`Groups: copy from ${c.kind === 'painted' ? 'a painted frame' : 'tracked points'} at ${msClock(c.t)}`, () => { app.doc.scenes = setTakeGroups(this.scenes, i, land.groups); });
    this.active = list.length ? 0 : -1;
    const n = list.length, un = list.filter((g) => g.unconfirmed).length;
    const again = list.filter((g) => all.some((x) => x.name === g.name && !this.#onT(x, t))).length;   // paw-o74b.1: parts the take has elsewhere: another seed
    const crop = xf.crop;   // paw-d2d5: placed through the crop (scale, via 'link' | 'match'), or null / undefined
    app.usage?.note('tracking:groupsCopyPick', { kind: c.kind, rank: src, n, unconfirmed: un, lost: moved.lost || 0, d: c.d ?? null, moved: xf.s !== 1 || !!xf.dx || !!xf.dy, dk: c.k - cp.k, again, crop: crop ? crop.scale : null, via: crop?.via ?? null,
      joint: xf.joint ? { s: xf.s, ncc: xf.ncc, from: xf.from } : null, tier: c.kind === 'here' ? 'here' : tierOf(c), more: !!c.more, unread: !!c.unread, shown: cp.items.length });
    const left = moved.lost ? (crop ? ` · ${moved.of - moved.lost} of ${moved.of} parts are in this framing` : ` · ${moved.lost} fell outside the picture`) : '';
    app.toast(c.kind === 'here' ? `${n} group${n === 1 ? '' : 's'} from the run's points on this frame (Track seeds exactly those points)`
      : `Copied ${n} group${n === 1 ? '' : 's'} from ${msClock(c.t)} onto frame ${c.k}${crop ? ` (re-framed: ${crop.via === 'loops' ? 'same loop, ' : ''}crop ×${crop.scale.toFixed(1)}${crop.wideIsSrc ? '' : ', the wider shot'})` : ''}, lined up as one set (dotted '?': Accept, nudge or repaint)${again ? ` · ${again} of them seeded on other frames too: another seed of ${again === 1 ? 'that part' : 'those parts'} (re-anchored here)` : ''}${why}${left}`, again || left ? 'info' : 'quiet');
    return true;
  }
  // ---- the learned seeder (seed_train) ----
  /** <app data>/seeder, or null outside the app (the browser mock has no data folder). */
  async seedDir() {
    if (this.#seedDir !== undefined) return this.#seedDir;
    let d = null;
    try { const p = await this.app.backend?.appPaths?.(); if (p?.data_dir) d = p.data_dir.replace(/[\\/]+$/, '') + (p.data_dir.includes('\\') ? '\\' : '/') + 'seeder'; } catch { d = null; }
    return (this.#seedDir = d);
  }
  /** The stored head's record (head.json) for the toolbar; null when none is trained yet. */
  async loadSeeder() {
    const ds = await this.dataset(), dir = ds?.dir;
    if (!dir) return;
    const rd = async (d, f) => { try { return JSON.parse(await this.app.backend.readText(d + (d.includes('\\') ? '\\' : '/') + f)); } catch { return null; } };
    this.seeder = await rd(dir, 'head.json');
    if (this.seeder) await this.refreshScore();
    this.cross = await rd(dir, 'cross.json');
    this.namer = ds.seed ? await rd(ds.seed, 'namer.json') : null;
    this.overview = await Promise.all((this.datasets.reg?.datasets || []).filter((d) => !d.archived || d.id === ds.id).map(async (d) => {
      const i = this.datasets.infoOf(d.id), h = await rd(i.dir, 'head.json'), sc = (await rd(i.dir, 'score.json'))?.latest;
      return { id: d.id, name: d.name, active: d.id === ds.id, frames: h?.frames || 0, trained: !!h, score: sc && h && sc.fingerprint === h.fingerprint ? sc : null };
    }));
  }
  /** v4.27: the held-out score (score.json beside head.json: written by Train, or a moment later when it was slow) -> this.seeder.score.
   *  While Train said {pending} the file is re-read every few seconds (a dozen times at most) until the score of this head arrives. */
  async refreshScore(tries = 0) {
    const dir = (await this.dataset())?.dir;
    if (!dir || !this.seeder) return;
    let latest = null;
    try { latest = JSON.parse(await this.app.backend.readText(dir + (dir.includes('\\') ? '\\' : '/') + 'score.json')).latest; } catch { latest = null; }
    if (latest && latest.fingerprint === this.seeder.fingerprint) this.seeder = { ...this.seeder, score: latest };
    else if (this.seeder.score?.pending && tries < 12) setTimeout(() => this.refreshScore(tries + 1), 8000);
  }
  /** paw-855t: every dataset's head scored on the ACTIVE dataset's labels (sidecar seed_compare: CPU, a few seconds, cached by a fingerprint of
   *  the labels and the heads); also stored in <dataset>/cross.json (loadSeeder reads it back). Needs two trained datasets. */
  async refreshCompare() {
    const ds = await this.dataset(), reg = this.datasets.reg;
    if (!ds || !reg) return null;
    await this.loadSeeder();
    if (this.overview.filter((o) => o.trained).length < 2) return this.cross;
    try {
      const list = reg.datasets.filter((d) => !d.archived || d.id === ds.id).map((d) => this.datasets.infoOf(d.id));
      const r = await this.tr.job('seed', seedCompareRequest({ dir: ds.seed, active: ds.id, datasets: list, folders: this.seedFolders }), { title: 'Comparing the datasets', owner: 'seeder' });
      if (r.result) this.cross = r.result;
    } catch { /* a comparison is never worth an error */ }
    return this.cross;
  }
  /** The seed library's folders (settings 'tracking.seeder.folders', else the recent projects' folders). */
  get seedFolders() { return seedFolders(this.app.settings.get('tracking.seeder.folders', []), this.app.settings.get('recent', [])); }
  /** Retrain from the library (a no-op in the sidecar when its painted groups did not change; force: always). auto: after
   *  a save, in the background (a Track preempts it), quiet unless it learned something. */
  async retrain({ force = false, auto = false, images = false } = {}) {
    const app = this.app, tr = this.tr, dir = await this.seedDir(), ds = await this.dataset();
    if (!dir || this.training) return null;
    if (auto && ds && !ds.projects) return null;   // paw-855t: a dataset that does not learn from projects is not retrained by a project save
    // paw-714j: the still-image labels are the third source, in EVERY request (the sidecar's no-change check counts them); paw-855t: the ACTIVE dataset's, and projects only when it learns from them
    const { folders, projects, labels, dataset } = trainScope(ds, { folders: this.seedFolders, projectPath: app.project?.path || '', seed: dir });
    const all = (this.datasets.reg?.datasets || []).filter((d) => !d.archived || d.id === ds?.id).map((d) => this.datasets.infoOf(d.id));   // v4.38: the namer learns from every dataset
    const namer = all.length ? namerScope(all, { folders: this.seedFolders, projectPath: app.project?.path || '' }) : null;
    if (!folders.length && !projects.length && !images) { if (!auto) app.toast('Nothing to learn from yet: paint groups and save the project, or label images (File menu)', 'info'); return null; }
    this.training = true;
    try {
      const r = await tr.job('seed', seedTrainRequest({ dir, dataset, folders, projects, labels, force, namer, features: app.settings.get('tracking.seeder.features', 'auto') }), { title: 'Training the seeder', owner: auto ? 'seeder' : '', task: !auto });
      if (r.cancelled) return null;
      if (r.error) { if (!auto) app.toast('Seeder training failed: ' + String(r.error).split(/\r?\n/)[0], 'error'); return null; }
      const res = r.result || {};
      this.seeder = res.frames ? res : null;
      if (res.namer !== undefined) this.namer = res.namer;
      if (res.score?.pending) setTimeout(() => this.refreshScore(), 8000);
      this.refreshCompare();   // paw-855t: the other datasets' heads on these labels (not awaited: the Train is done)
      app.usage?.note('tracking:seederTrain', { frames: res.frames || 0, videos: res.videos || 0, images: res.images || 0, changed: !!res.changed, s: res.s, auto });
      if (!auto || res.changed) app.toast(res.frames ? `Seeder ${res.changed ? 'trained' : 'up to date'}: ${res.frames} painted frames from ${res.videos} source${res.videos === 1 ? '' : 's'}${res.images ? ` (${res.images} image${res.images === 1 ? '' : 's'}${res.negatives ? `, ${res.negatives} with nothing to label` : ''})` : ''}${usedParts(res)}${res.changed && res.s != null ? ` (${res.s} s)` : ''}${hasScore(res.score) ? `; ${scoreLine(res.score)}` : ''}` : 'Seeder: no painted groups in the library yet', 'quiet');
      return res;
    } finally { this.training = false; }
  }
  /** After a project save: retrain in the background when the document's painted groups changed since the last request. */
  afterSave() {
    const key = paintedKey(this.scenes);
    if (key === this.#lastPainted || !(this.app.doc.scenes || []).some((s) => (s.groups || []).some((g) => !isSuggested(g) && !isUnassigned(g)))) return;
    this.#lastPainted = key;
    this.retrain({ auto: true });
  }
}

/** ', learned: head 32, tail 7' from a seed_train record's parts (the usable ones: >= 5 painted from >= 2 sources). */
export const usedParts = (res) => { const u = Object.entries(res?.parts && !Array.isArray(res.parts) ? res.parts : {}).filter(([, v]) => v.use).map(([p, v]) => `${p} ${v.labels}`); return u.length ? `; learned ${u.join(', ')}` : ''; };

export { GROUP_NAMES };
const stores = new WeakMap();
export function groupsFor(app) {
  let s = stores.get(app);
  if (!s) { s = rooted(() => new GroupsTool(app), app); stores.set(app, s); }   // paw-b7da: its own root, never the asking component's
  return s;
}
export const peekGroups = (app) => stores.get(app) || null;

// ---- repeated frames (paw-8yip, repeat-groups.js): groups painted on a frame fit its exact repeats unchanged ----
const fmOf = (app) => gridOf(app.player) || 1000 / 30;   // the frame grid (lane.js; paw-kxz4)
const shotAt = (app, t) => sceneIndexAt(app.doc.scenes || [], t + (app.player.frameMs || 1000 / 30) / 2);
/** Copying the groups of the take at time t to the repeats of their frame: {shot, groups, targets, skipped} when the take
 *  has groups and their frame repeats in other takes (targets: those without groups), else null. */
export function repeatCopyAt(app, t) {
  const scenes = app.doc.scenes || [], i = shotAt(app, t), ix = repeatsOf(app);
  const groups = i >= 0 ? takeGroups(scenes, i) : [], g = groups.find((x) => Number.isFinite(x.t_ms));
  const o = g && occurrenceAtTime(ix, g.t_ms, fmOf(app));
  if (!o) return null;
  const r = repeatTargets(scenes, i, occurrencesOf(ix, o.id).filter((x) => x !== o));
  return r.targets.length || r.skipped.length ? { shot: i, groups, ...r } : null;
}
/** Copy them (one undo step); takes that have groups keep theirs. */
export function copyGroupsToRepeats(app, t) {
  const c = repeatCopyAt(app, t);
  if (!c?.targets.length) return;
  const n = c.targets.length;
  const keys = c.targets.map((x) => takeKey(app.doc.scenes, x.shot)).filter((k) => k != null && !filledTakes(app).includes(k));   // a copied take cleared later is not auto-filled again
  app.transact(`Groups: copy to ${n} repeat${n === 1 ? '' : 's'}`, () => {
    app.doc.scenes = copyGroupsTo(app.doc.scenes, c.groups, c.targets);
    if (keys.length) app.doc.repeats = { ...(app.doc.repeats || {}), filled: [...filledTakes(app), ...keys] };
  });
  app.usage?.note('tracking:groupsCopyRepeats', { groups: c.groups.length, takes: n, skipped: c.skipped.length });
  app.toast(`Groups copied to ${n} repeat${n === 1 ? '' : 's'} of this frame${c.skipped.length ? ` (${c.skipped.length} with groups of their own left as they are)` : ''}`, 'quiet');
}
// ---- filling a take from a matching frame (paw-8mf4, repeat-groups.js findFill / fillTake) ----
/** The automatic fill on selecting an empty take (setting 'tracking.groups.autoFromRepeats', default on). */
export const autoFill = (app) => app.settings?.get?.('tracking.groups.autoFromRepeats', true) !== false;
/** Takes (repeat-groups.js takeKey) filled once or dropped: never filled automatically again (saved with the project). */
export const filledTakes = (app) => app.doc.repeats?.filled || [];
const chosenOf = (app) => preferredPictures(app);
/** What fills take i (findFill over this video's repeats and the session's stored runs), or null. */
export function fillFor(app, i) {
  return findFill(app.doc.scenes || [], i, repeatsOf(app), fmOf(app), { runs: trackingFor(app).runs, chosen: chosenOf(app) });
}
const msClock = (t) => `${Math.floor(t / 60000)}:${((t % 60000) / 1000).toFixed(3).padStart(6, '0')}`;   // 1:23.456 (the toolbar's)
const whereFrom = (f) => (f.kind === 'run' ? `the run at ${msClock(f.from)}` : msClock(f.from));
/** Fill take i from f (one undo step; auto: remembered so it never fills again). */
export function applyFill(app, i, f, auto = false) {
  const key = takeKey(app.doc.scenes || [], i), size = maskSize(trackingFor(app).aspect);
  app.transact(`Groups: ${auto ? 'auto ' : ''}from ${whereFrom(f)}`, () => {
    app.doc.scenes = fillTake(app.doc.scenes, i, f, size);
    if (key != null && !filledTakes(app).includes(key)) app.doc.repeats = { ...(app.doc.repeats || {}), filled: [...filledTakes(app), key] };
  });
  app.usage?.note('tracking:groupsFill', { kind: f.kind, auto, parts: f.parts, from: Math.round(f.from), t: f.t, loop: f.loop });
}
/** Drop the take's filled groups (one undo step); the take is not filled automatically again. */
export function dropFill(app, i) {
  const scenes = app.doc.scenes || [], gs = takeGroups(scenes, i), key = takeKey(scenes, i);
  if (!gs.length || !gs.every(isCopy)) return;
  app.transact('Groups: drop the filled groups', () => {
    app.doc.scenes = setTakeGroups(app.doc.scenes, i, []);
    if (key != null && !filledTakes(app).includes(key)) app.doc.repeats = { ...(app.doc.repeats || {}), filled: [...filledTakes(app), key] };
  });
  app.usage?.note('tracking:groupsFillDrop', { kind: gs[0].source, parts: gs.length });
}
/** The take at time t has no groups and a matching frame fills it: findFill's result + {into: the shot}. */
export function twinGroupsAt(app, t) {
  const scenes = app.doc.scenes || [], i = shotAt(app, t);
  if (i < 0 || takeGroups(scenes, i).length) return null;
  const f = fillFor(app, i);
  return f ? { ...f, into: i } : null;
}
/** Fill the take at time t from its match now (the toolbar's "Use groups from", the tick menu). */
export function useTwinGroups(app, t) {
  const tw = twinGroupsAt(app, t);
  if (tw) applyFill(app, tw.into, tw, false);
}
/** The best frame to paint on in the Groups tool's take (bestPaintFrame) while the tool is open on a take without
 *  groups; null otherwise (the ruler's marker reads it without creating the tool). */
export function bestPaintMark(app) {
  const G = peekGroups(app);
  if (!G?.on || G.scene < 0 || G.all.length) return null;
  return bestPaintFrame(app.doc.scenes || [], G.scene, repeatsOf(app), chosenOf(app), seedWindowOf(app, G.scene));
}
/** paw-ef73.9: take i's seed window (lib/seed-window.js) with the current fades. */
function seedWindowOf(app, i) { return seedWindow(app.doc.scenes || [], i, transitionsOf(app), app.player?.frameMs || 1000 / 30, app.durationMs || Infinity); }
const hinted = new Set();   // the seed hints shown this session
/** The ruler tick's right-click items for frame t (Ruler.svelte through timeline/deps.js). */
export function repeatGroupsMenu(app, t) {
  const c = repeatCopyAt(app, t), tw = twinGroupsAt(app, t), out = [];
  if (c?.targets.length) out.push({ label: `Copy groups to ${c.targets.length} repeat${c.targets.length === 1 ? '' : 's'}`, run: () => copyGroupsToRepeats(app, t) });
  if (tw) out.push({ label: tw.kind === 'run' ? `Use points from the run at ${fmtClock(tw.from)}` : `Use groups from ${fmtClock(tw.from)}`, run: () => useTwinGroups(app, t) });
  return out;
}
