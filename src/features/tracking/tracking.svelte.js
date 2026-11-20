// tracking.svelte.js -- the tracking feature's state, one store per app (trackingFor(app)).
// Migrated from the bench (src/lib/bench.svelte.js): tracker list, params, ROI, scenes (+ describe / loop),
// span labels, runs, scores. The video, transport, range and undo come from the app.
// Every finished run is kept here in full (samples, channels, frames, scenes, flips) and mirrored into
// app.doc.ghosts as {id, name, color, script, visible, source:{kind:'tracker', ...}} -- the doc is replaced, never
// mutated. A project keeps every run beside its .pawproj in <stem>.pawruns (lib/runs-file.js): written after each
// save, read on open; a run only goes when the user removes it. Every sidecar process goes through job(): one at a time, in order (the Rust side allows only one).

import { rooted } from '../../lib/rooted.svelte.js';
import { untrack } from 'svelte';
import { playheadFrameStart, gridOf, frameAt } from '../../lib/lane.js';
import { suggestGroupsRequest, listRequest, scenesRequest, loopRequest, describeRequest, describeAllRequest, trackRequest, trackCuts, scoreRequest, defaultParams, roiOk, roiAccepts, trackerFor } from '../../lib/protocol.js';
import { PALETTE, newFrames, appendFrames, makeRun, cycleMarks, pointsList, sceneAt, flipPatch, addSpan, spansForRequest, effSign, linkFor, sceneForRun, runForScene, runTitle, runSummary, replacedBy } from '../../lib/runs.js';
import { channelPatch, keepOf, runFromGhost, carrierClean, stitchPoints, decisionsOf, relParse, relSources, ANCHORS } from '../../lib/runs-channel.js';
import { tlFor } from '../timeline/state.svelte.js';
import { normalize, lowerBound } from '../../lib/core/script.js';
import { withProposals, continuations, bridgeRuns, proposeSpans, printTimes, grey16, bridgeScript, holdScript, afterScript, easeScript, REST, defaultTrackerFor, INTERNAL_TRACK, fillSpans, fillScript } from '../../lib/scenes-continue.js';
import { createScrubber } from '../video/scrub.js';
import { linkShots, loopLinks, linkBox, pyramid, grey, printSize } from '../../lib/crop-match.js';   // paw-3uyu
import { matchCycles, cycleOk, spotPicks, spotCheck, counterpart, loopShotLinks, mergeLinks, loopStore, LOOP_MATCH } from '../../lib/crop-match.js';   // paw-0zwb
import { CROP_MATCH, framePrint } from '../../lib/crop-match.js'; import { printDist } from '../../lib/scenes-continue.js'; import { offMain, scanCacheGet, scanCachePut } from './shot-scan.js';   // paw-o60v.1
import { loopGroup } from '../timeline/loop-info.js';
import { autoLoops } from '../timeline/repeat-scenes.js';
import { progressText, rateStep, shownDone, stageClock } from '../../lib/progress.js';
import { isInternal, isOffscreen, isBlank, isExposed, sceneKind, sceneStructure, skipReason, withStructure, tagSpans } from '../timeline/acts.js';
import { withMods } from '../timeline/mods.js';
import { planTracks, planSummary } from '../../lib/track-plan.js';
import { sceneRuns, inheritTargets, takeRange, sceneRange, joinSelected, setTake } from '../timeline/shots.js';
import { runDerives, deriveClean, deriveOf, withDerive, arrivalShots, deriveBlock, deriveChannels, cameraAtT, trackedAxis, camTagDefault, effectiveCam } from '../../lib/rederive.js';
import { sceneDetail, detailAt, detailClean, detailSpans, setDetail, spanShot, simplifyScript } from '../../lib/detail.js';
import { shapeAt, SHAPE_NAMES, layoutOf, dressScript } from '../../lib/stroke-shape.js';
import { picturesOf } from '../timeline/repeats.svelte.js';
import { STROKES } from '../../lib/strokes.js';
import { overlayPick, selectionSpan } from './overlay-pick.js';
import { canFuse, fusionGroups } from '../../lib/fusion.js';
import { signalSpans, setSignalSpan, spanAt, pairOf, resolveSource, canSource, AGAINST_KEY } from '../../lib/signal-source.js';
import { partLabel, whoName } from './groups.js';
import { paintedParts, partBox, partRange, roiTracker } from './roi-part.js';   // paw-x8we
import { heldScenes, heldText, heldOn, HELD } from '../../lib/held.js';
import { shaftOverlay, insertedAt, shaftDirection, shaftState, railContext, shaftScore, scoreOverall, scoreTable, partOf, partSource, partWord, isShaftSource, TRUTH_KINDS, EVENT_KINDS, KIND_TEXT } from '../../lib/shaft.js';
import { shaftScene, shaftDisagrees, PERIOD } from '../../lib/shaft-source.js';
import { directionSpan, throughCuts, DIRECTIONS } from './direction.js';
import { sceneCamera, sceneWheres, sceneWhats } from '../timeline/acts.js';   // camera tag -> default signal (#cameraDefaults); act tags (references)
import { strike, unstrike, referenceRecord, referenceClean, referenceName, REF_DIR } from '../../lib/references.js';   // paw-qynw
import { defaultSignal } from '../../lib/runs-channel.js';
import { measureSpans } from '../timeline/mod-runs.js';
import { positioningOf, withPositioning } from '../timeline/regions.js';
import { proposeRanges, gridRequest, refineRequest, withRangeProposals, DEFAULTS as RANGE_DEFAULTS } from '../timeline/describe-ranges.js';   // paw-2lp7.3
const SCENE_OPTS = { internal: isInternal, kind: sceneKind, blank: isBlank };   // lib/scenes-continue.js: internal views and kinds as the timeline sees them
import { acceptGhost } from './accept.js';
import { liveSpans, composeLive, bakeSpans, unbakeRanges, hasIn, scriptOf, emptyIn, unmarkEmpty } from '../../lib/script-of.js';
import { fromLinks, liveRanges, putRange, moveEnd, removeRange, rangesIn, rangeAt, playsAll } from '../../lib/run-ranges.js';   // paw-1ysd   // paw-x7w7: the live script, Bake / Unbake
import { cleanMicroOpts } from '../../app/settings.svelte.js';
import { liveFx, insertionScript } from '../../lib/fx.js';
import { addOrientation } from './orient.js';
import { flipsClean, xorFlips, directionOf } from '../../lib/polarity.js';
import { repeatsOf, repeatsPending } from '../timeline/repeats.svelte.js';
import { loopStates } from '../../lib/loop-average.js';
import { searchTargets, searchLoop } from '../timeline/loop-search.js';
import { newId } from '../timeline/state.svelte.js';
import { landAt } from '../timeline/transitions.svelte.js';
import { directionFromRepeats } from '../../lib/repeat-direction.js';
import { joinLoopMoves, markAutoLoops } from '../timeline/repeat-offers.svelte.js';
import { exportFunscript } from './export.js';
import { cleanScenes, pathKey } from '../../app/project-logic.js';
import { encodeRunsAsync, decodeRunsAsync, drive, runsPath, runsFileKey, lazyFrames, runsFileState, verifyRuns, decodeRecords, lightenFrames } from '../../lib/runs-file.js';
import { cowShell, writeRunsCow, withoutBad, readInParts } from '../../lib/runs-cow.js';
import { startWrite } from '../../app/writing.svelte.js';
import { axisClean, axisParams, axisTool } from './axis.js';
import { cameraMotion, lowMotion, motionStats, statWindows } from './motion.js';
import { pickTracker } from '../draft/logic.js';
import { trackGroups, priorFor, suggestedGroups, setTakeGroups, encodeMask, rasterPoly, maskSize } from './groups.js';
import { newForRun, splitSeeds, seedsOf, mergeAdded, restitch, seedKey, groupFp } from '../../lib/runs-add.js';   // paw-o74b, paw-o74b.1
import { deriveAxes, refreshAxes, isAxesGhost } from './axes-derive.js';   // paw-2pcf: the secondary axes as ghosts
import { fillTargets, deriveFill, carryLevel, fillWords, fillId, inheritShots } from '../../lib/link-fill.js';   // paw-ef73.33: linked shots fill each other
import { nextColor } from '../../lib/runs.js';
import { shotLabel } from '../timeline/shots.js';
import { spanText } from '../timeline/quickbar.js';   // paw-iwb7: the busy task names what is tracked
import { anchorsOf, putAnchor, moveAnchor, shotAnchors, anchorEffect, ANCHOR_WORD } from '../../lib/anchors.js';
import { fmtTime } from '../../lib/funscript.js';
/** paw-wg2d: the command of each anchor kind (its key goes in the toast). */
export const ANCHOR_CMD = { 0: 'tracking.anchorIn', 50: 'tracking.anchorMid', 100: 'tracking.anchorOut' };
import { frameLen } from '../../lib/lane.js';

const railMemo = new WeakMap();   // paw-4c48.8: run -> Map(run scene | marks | aspect -> railContext)
const hintMemo = new WeakMap();
/** paw-4c48: the stroke the shaft's depth scale must agree with: the run's fused channel when it has one (lib/shaft.js depthScale). */
const motionOf = (r) => (r?.channels?.fused?.t?.length ? r.channels.fused : null);   // paw-4c48.10: run -> Map(run scene | marks | aspect -> shaftScene, measured frames only)
const basename = (p) => p.split(/[\\/]/).pop();
const stem = (p) => p.replace(/\.[^.\\/]+$/, '');
const firstLine = (s) => String(s).split(/\r?\n/)[0];
const TITLES = { list: 'Listing trackers', scenes: 'Detecting scenes', track: 'Tracking', describe: 'Describing scene', loop: 'Looking for a loop', camera: 'Checking camera motion', seed: 'Training the seeder', segment: 'Grow (SAM)', name: 'Naming groups' };
const LIST_TIMEOUT_MS = 120_000;   // the first start may install the trackers' packages (uv); longer than that is a hang
// paw-shgb: every tab's store (one app each) shares the one sidecar process. live: the stores of this window (a job started in
// one tab while another tab's job runs is refused, its tab named); per backend (one per window): the trackers listed once, the
// leftover-sidecar cancel done once
const live = new Set(), listedFor = new WeakMap(), swept = new WeakSet();
const tabName = (app) => app.project?.name || app.doc?.media?.name || 'another tab';
const TOASTED = new Set(['scenes', 'track', 'describe', 'loop']);   // failures / cancels worth a toast (list and score show in place)
const DESCRIBE_TIMEOUT_S = 180;    // settings 'tracking.describeTimeoutS': describe with no progress this long fails (a busy GPU can hang it)
const START_TIMEOUT_S = 180;       // settings 'tracking.startTimeoutS': a job whose sidecar prints nothing (not even a stderr line) this long fails
// paw-eeod: settings 'tracking.stallTimeoutS': a Track with no event (progress, frame, log line) this long fails. Events come at
// least every chunk (TAPNext++ 256, 8 frames: under 1 s on the GPU; the longest silent steps are a cold model read, ~1 min);
// on the CPU (sidecar v4.56 device "cpu") the limit is CPU_STALL_X times longer
const STALL_TIMEOUT_S = 600, CPU_STALL_X = 4;
/** paw-k97q: the sidecar's `list.gpu` (v4.56) in plain words, '' when the GPU is fine or the sidecar is older. */
export function gpuNote(gpu) {
  if (gpu?.state === 'unsupported') {
    const card = String(gpu.name || '').replace(/^NVIDIA\s+(GeForce\s+)?/i, '') || 'this graphics card';
    return `This graphics card (${card}) is ${gpu.reason === 'old' ? 'too old for this build' : 'not supported by this build yet'}. Trackers that need a GPU are off; the CPU trackers still work.`;
  }
  if (gpu?.state === 'none' && gpu.reason === 'torch') {   // paw-1dt4: torch did not load (a DLL: no VC++ runtime, antivirus)
    const why = String(gpu.probe || '').replace(/^\w+:\s*/, '').slice(0, 120);
    return `The tracker's PyTorch could not load${why ? ` (${why})` : ''}. Trackers that need a GPU are off; the CPU trackers still work. Install the Microsoft Visual C++ Redistributable or check your antivirus quarantine, then restart Pawscript.`;
  }
  if (gpu?.state === 'none') return 'No graphics card the trackers can use was found. Trackers that need a GPU are off; the CPU trackers still work.';
  return '';
}
const GRID_TRACKERS = new Set(['tapnext_points', 'cotracker_points']);
const REST_MS = 120;   // paw-o60v.2: a fusion drag resting this long composes everything (Detail, HOW, linked fills) as the release will
const BRIDGE = 'scene-bridge';
const WHY_SHORT = { turn: 'a turn', mid: 'the half-stroke\'s midpoint (Detail)', shoulder: 'a shoulder: a slow transition at the turn (Detail by render)', hold: 'a hold at the turn (Detail)', detail: 'a Free detail point', clamped: 'a turn shortened by max speed', end: 'the signal\'s end' };
const SIMPLIFY = 'detail-simplify';   // paw-izk: Simplify to this detail's preview (a preview ghost, never saved)
const SMART_AB = 'smart-ab';    // paw-e3i: the shot's points without Smart stroke, drawn over them for an A/B (a preview, never saved)   // the bridge ghost (source kind 'bridge-preview': drawn as a preview, never saved)
/** paw-x7w7: two live span lists equal by content (scripts by identity first: a ghost keeps its script while it does not change). */
const sameSpans = (a, b) => a.length === b.length && a.every((s, k) => s.t0 === b[k].t0 && s.t1 === b[k].t1 && s.kind === b[k].kind && s.id === b[k].id
  && (s.script === b[k].script || (s.script.length === b[k].script.length && s.script.every((p, j) => p.at === b[k].script[j].at && p.pos === b[k].script[j].pos))));
/** A run of the whole frame (the camera reference itself): no camera check for it. */
const wholeFrame = (r) => r.tag === 'camera' || (!r.roi && r.tracker !== 'reference') || (r.roi?.kind === 'box' && r.roi.x <= 0.01 && r.roi.y <= 0.01 && r.roi.w >= 0.98 && r.roi.h >= 0.98);

/** paw-rxr3: a track's shaft pass shown on the video. event(e) for every sidecar event: a "shaft" progress event with
 *  t_ms (sidecar v4.44) shows that frame through the player's scrub path (decoded frames over the <video>, at most
 *  `every` ms apart; `slow` when the scrubber is unavailable and each call would seek), the first one remembering the
 *  playhead; any other stage, or end(), puts the playhead back there. Nothing while the video plays. */
export function stageFollow(player, { now = () => performance.now(), every = 1000 / 15, slow = 250 } = {}) {
  let home = null, last = -Infinity;
  const end = () => { if (home == null) return; const t = home; home = null; player.scrub(t); };
  return {
    event(e) {
      if (e?.type !== 'progress') return;
      if (e.stage !== 'shaft' || !Number.isFinite(e.t_ms)) { if (e.stage && e.stage !== 'shaft') end(); return; }
      if (player.playing) return;
      if (home == null) home = player.timeMs;
      const n = now();
      if (n - last < (player.scrubStats?.error ? slow : every)) return;
      last = n;
      player.scrub(e.t_ms);
    },
    end,
  };
}

class Tracking {
  // trackers
  trackers = $state.raw([]);
  listed = $state(false);          // a list request succeeded
  queued = $state('');             // paw-ws19: 'grid' while a Track (T) pressed before the list came waits for it
  bandOpen = $state(false);        // paw-p8o2: the stroke lane's inspector band unfolded (the shot's Adjust lives there only)
  runBar = $state.raw(null);       // paw-k8pe: the Track lane's run controls, drawn by the lane toolbar (RunBar.svelte): {on, chip, pol, groups}
  sceneParams = $state.raw([]);
  loopParams = $state.raw([]);
  loopSearching = false;   // paw-ef73.10: the background loop search is running
  #joinFor = null;   // paw-fc0r: the video whose Detect ran before its repeated frames: its loop joins are still to do
  describeParams = $state.raw(null);   // null = describe not installed
  gpu = $state.raw(null);          // paw-k97q: the sidecar's list.gpu (v4.56) {state, name?, reason?}; null from an older sidecar
  cpu = $state(false);             // paw-eeod: the running job said it runs on the CPU (v4.56 progress device "cpu")
  trackerId = $state('');
  paramsBy = $state({});           // trackerId -> {key: value}
  sceneVals = $state({});
  loopVals = $state({});
  describeVals = $state({});
  // the PENDING roi, set by code only (an internal-view plan, Fix's re-track, a selected run's stored box, scripts; paw-x8we: nothing
  // draws one on the video any more, Track ROI takes a painted part): cleared when a run starts, each run keeps its own.
  // {kind:'box',x,y,w,h,t_ms?} | {kind:'points',points:[[x,y]]} | null (0..1 video coords)
  roi = $state.raw(null);
  partHover = $state(null);        // paw-x8we: the painted part the Track ROI pick menu points at (outlined on the video)
  lastPart = new Map();            // paw-x8we: shot start -> the part last tracked there (the pick menu's default row)
  // stroke axis (axis.js), per video (settings 'tracking.axis:<path>') and in the project (block 'tracking')
  axis = $state.raw(null);         // {x0,y0,x1,y1}: out end -> in end, 0..1 | null
  axisMode = $state('');           // '' (tracker default) | auto | vertical | horizontal | custom
  axisOn = $state(false);          // the axis tool owns the pointer on the video
  axisTarget = $state(-1);         // -1: the tool edits the next Track's axis; a shot index: that shot's axis after tracking (paw-a3n)
  deriveScope = $state('shot');    // an adjustment after tracking reaches 'shot' or the whole 'scene' (DeriveStrip)
  camPeek = $state(false);         // a camera control is being dragged: the lane draws the signal without camera removal too
  axisTick = $state(0);            // the tool's draft changed (repaint)
  axisMap = null;                  // env.map of the last overlay paint (the tool's px hit test)

  // scenes live in the document (app.doc.scenes: [{start_ms, end_ms, sign?, loop?, describe?}], undoable, saved in
  // the .pawproj; the timeline edits the cuts); only the per-scene job state is local: sceneUi[i] = {busy, error}
  sceneUi = $state.raw([]);
  get scenes() { return this.app.doc.scenes || []; }
  get sceneInfo() { return this.scenes.map((s, i) => ({ describe: s.describe, loop: s.loop, ...(this.sceneUi[i] || {}) })); }
  shownBoxes = $state.raw({});     // "sceneIdx:tag" -> true: draw that tag's box on the video
  batch = $state.raw(null);        // {done,total} while "Describe all" runs

  // work
  busy = $state('');               // '' | 'list' | 'scenes' | 'track' | 'describe' | 'loop' | 'score'
  owner = '';                      // who started the current job: '' = the panel, 'api' = api.js (another feature)
  epochs = {};                     // owner -> n; cancelOwner bumps it, so that owner's queued jobs never start
  progress = $state.raw({ done: 0, total: 0, stage: '', rate: 0 });   // the sidecar's last progress event (+ the rate EMA, lib/progress.js)
  busyRange = $state.raw(null);    // {t0, t1} the running job covers (a track's range, a scene job's scene), else null
  clock = $state(0);               // Date.now(), every second while a job runs (time left / elapsed)
  error = $state('');
  notice = $state('');
  stopping = $state(false);        // cancel() was asked; the job has not ended yet
  startedAt = $state(0);           // Date.now() when the current job started (elapsed time in the panel)
  lastLog = $state('');            // the current job's latest sidecar stderr line (uv installing, waiting for the GPU, ...)

  // runs: full records; their ghosts live in app.doc.ghosts under the same id
  runs = $state.raw([]);
  selectedId = $state('');         // a ghost id (any ghost: tracker run, reference, imported)
  live = $state.raw(null);         // {frames} while a track is running
  tick = $state(0);                // bumped when live frames arrive
  hoverGroup = $state(0);          // a legend chip under the pointer: that motion group is highlighted on the overlay (0 = none)
  spans = $state.raw([]);          // old manual span labels for this video: [{start_ms,end_ms,state}]; no UI now (spans derive from the tags, spansFor), still sent, winning where they overlap
  scores = $state.raw({});         // ghostId -> {busy} | {overall, scenes} | {error} (against the reference)
  // scene -> run channel links (project block 'links' {v:1, scenes}): [{t0, t1, run: ghostId, channel, fit?}], never
  // dropped when a run / ghost goes (a link whose ghost is gone is just not live)
  links = $state.raw([]);
  // "Track tagged scenes" (lib/track-plan.js): the dialog, its force toggle, and the batch while it runs ({stop, k, n})
  planOpen = $state(false);
  planForce = $state(false);
  planBusy = $state.raw(null);
  origExists = $state(false);      // a same-name .funscript sits next to the video
  // the project's runs file (<stem>.pawruns): fileRuns = its runs (restoreRuns merges them in), runsFile = {path, ok}
  // (ok: read cleanly or absent, or written by us: replacing it needs no copy), runsLoad = the read in flight
  fileRuns = [];
  runsFile = null;
  runsLoad = null;
  runsSeq = 0;
  runsDirty = false;               // runs changed since the last runs write (project or autosave): the next autosave writes them

  chain = Promise.resolve();
  stop = false;
  scoreSeq = 0;
  timers = {};
  path = null;                     // the video the state above belongs to

  #offWin = [];
  constructor(app) {
    this.app = app;
    live.add(this);
    // the axis tool edits the next Track's axis, or (axisTarget = a shot, paw-a3n) that shot's axis after tracking: live
    // while dragged (derivePreview), one undo step on release
    const shotAxis = () => { const a = this.shotAxis(this.axisTarget); return a?.mode === 'custom' ? { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 } : null; };
    this.axisPointer = axisTool({
      get: () => (this.axisTarget >= 0 ? shotAxis() : this.axis),
      set: (a) => (this.axisTarget >= 0 ? this.setDerive(this.axisTarget, { axis: { mode: 'custom', ...a } }, { scope: this.deriveScope, label: 'Stroke axis (after tracking)' }) : this.setAxis(a)),
      done: () => { this.axisOn = false; this.axisTarget = -1; },
      editable: () => this.axisEditable, map: () => this.axisMap,
      changed: () => {
        this.axisTick++;
        if (this.axisTarget < 0) return;
        const a = this.axisPointer?.state().axis, cur = shotAxis();
        if (a && axisClean(a) && JSON.stringify(axisClean(a)) !== JSON.stringify(cur && axisClean(cur))) this.setDerive(this.axisTarget, { axis: { mode: 'custom', ...a } }, { commit: false, scope: this.deriveScope });
        else this.cancelDerive();
      },
    });
    app.liveOf ??= (axis) => this.liveOf(axis);   // paw-x7w7: lib/script-of.js scriptOf (and app.edit's settle) read the live script here
    // paw-zu4h: no undo / redo while a track runs: its landing is a new step that would drop the redo branch (a held Ctrl+Z lost work)
    app.undoBlock ??= () => (this.busy === 'track' || this.planBusy ? 'a track is running (it lands first, then undo works again)' : '');
    app.beforeWrite ??= () => this.dropPreviews();   // paw-cfaz: what is written never reads a drag's preview
    const hint = this.axisPointer.hint;
    this.axisPointer.hint = () => (this.axisTick, hint());   // reactive for the video pane's hint line
    this._stop = $effect.root(() => {
      $effect(() => { const p = app.doc.media?.path || null; untrack(() => this.openVideo(p)); });
      $effect(() => { void app.doc.scenes; void app.doc.media?.path; void repeatsOf(app); untrack(() => this.#queueProposals()); });   // repeats: the loops a crop link joins (paw-3uyu)
      // the stitching reads continues / kinds / views (and the proposals): composed runs re-stitch when they change
      // (only where the points change: opening a project must not dirty it)
      $effect(() => { void app.doc.scenes; void this.proposed; untrack(() => { for (const r of this.runs) if (r.lane && r.points0) {
        const s = stitchPoints(r.points0, r, this.links, this.channelFit, { scenes: this.liveScenes(), internal: isInternal, clean: cleanMicroOpts(this.app.settings) });
        if (s.points.at.length !== r.points.at.length || s.points.at.some((t, k) => t !== r.points.at[k] || s.points.pos[k] !== r.points.pos[k])) this.applyRunPatch(r, { points0: r.points0 });
      } }); });
      // paw-a3n: a shot's derive (camera / axis after tracking) or a drag's preview changed: the runs under it recompose
      $effect(() => { void app.doc.scenes; void app.doc.fx; void this.derivePreview; void this.detailPreview; void this.signalPreview; void this.flipPreview; void this.fuseLive; void this.posScenes; void picturesOf(app); void app.doc.loops; untrack(() => this.#rederive()); });
      $effect(() => { void app.doc.scenes; untrack(() => this.restitchSeeds()); });   // paw-o74b.1: a part's seed deleted / back (undo): its runs re-stitched
      $effect(() => { void app.doc.scenes; untrack(() => refreshAxes(app, this)); });   // paw-2pcf: a view / axis flip changed: re-derive
      $effect(() => this.#publishSimplify());
      $effect(() => this.#publishSmartAB());
      $effect(() => { const plan = this.internalPlan, id = this.trackerId; untrack(() => this.#autoPick(plan, id)); });
      // paw-ef73.33: a run, the shots, the loops, the repeats or the crop links changed: the linked shots' derived runs follow
      $effect(() => { void this.runs; void app.doc.scenes; void app.doc.loops; void repeatsOf(app); void this.shotLinks; void this.links; void this.derivePreview; void this.detailPreview; void this.flipPreview; void this.signalPreview; void this.fuseLive; untrack(() => this.#queueFills()); });
    });
    if (typeof window !== 'undefined') {   // paw-o60v.1: the shot-link scan waits while a pointer is down (a drag, a scrub)
      const down = (v) => () => { this.#down = v; };
      for (const [t, v] of [['pointerdown', true], ['pointerup', false], ['pointercancel', false], ['blur', false]]) {
        const f = down(v);
        window.addEventListener(t, f, true);
        this.#offWin.push(() => window.removeEventListener(t, f, true));
      }
    }
    app.registerBlock?.('tracking', {
      save: () => (this.axis || this.axisMode || this.runSeq ? { axis: this.axis, axisMode: this.axisMode, ...(this.runSeq ? { runSeq: this.runSeq } : {}) } : null),
      load: (_, v) => { if (v) this.#putAxis(axisClean(v.axis), typeof v.axisMode === 'string' ? v.axisMode : ''); this.runSeq = Number.isInteger(v?.runSeq) && v.runSeq > 0 ? v.runSeq : 0; },   // paw-1fd3
    });
    // no block in the .pawproj: the runs live in <stem>.pawruns beside it (read on every load, written after every save);
    // registered before 'links', whose load runs restoreRuns(): the previous project's file runs are gone by then
    // paw-abi2: saving = before the .pawproj is written (every run it can name, discarded ones too), saved = after (o.keep:
    // the ghost ids of the text just written: a run discarded since it was taken stays in the file until the next write)
    app.registerBlock?.('runs', { save: () => null, load: (_, __, ctx) => this.loadRunsFile(ctx?.autosaveDir), saving: (_, p) => this.saveRunsFile(p, { keep: true }), saved: (_, p, o) => this.saveRunsFile(p, o), autosaved: (_, dir) => this.autosaveRuns(dir),
      refs: () => this.runRefs(), revive: (refs) => this.reviveRuns(refs), compact: () => this.compactRunsFile(),   // paw-ee14 / paw-s49h
      copyTo: (p) => this.copyRunsTo(p) });   // paw-f4i2: Save a copy to…
    // no block either: after each save the learned seeder retrains in the background when the painted groups changed
    app.registerBlock?.('seeder', { save: () => null, load: () => {}, saved: () => { import('./groups.svelte.js').then((m) => m.groupsFor(app).afterSave()).catch(() => {}); } });
    app.registerBlock?.('links', {
      save: () => (this.links.length ? { v: 1, scenes: this.links } : null),
      load: (_, v) => {
        const ok = (l) => l && Number.isFinite(l.t0) && Number.isFinite(l.t1) && l.t1 > l.t0 && typeof l.run === 'string' && typeof l.channel === 'string';
        this.links = v?.v === 1 && Array.isArray(v.scenes) ? v.scenes.filter(ok).map(carrierClean) : [];
        this.knotSel = null;
        this.restoreRuns();
        this.#repairFillRanges();
      },
    });
    // paw-0zwb: the loop-pair crop links found and the loops compared (crop-match.js loopStore); null = none (old projects)
    app.registerBlock?.('loopLinks', {
      save: () => (this.#far.pairs.length || this.#far.done.size ? { v: 1, done: [...this.#far.done], pairs: this.#far.pairs } : null),
      load: (_, v) => { const s = loopStore(v); this.#far = { path: '', pairs: s.pairs, done: s.done, cache: new Map(s.pairs.map((p) => [`${p.A.id}|${p.B.id}`, p.r])) }; },
    });
  }

  // ---- derived ----
  get videoPath() { return this.app.doc.media?.path || null; }
  get tracker() { return this.trackers.find((t) => t.id === this.trackerId) || null; }
  get params() { return this.paramsBy[this.trackerId] || {}; }
  get locked() { return !!this.busy || !!this.batch || !!this.planBusy; }
  /** How a track splits its range into scenes (settings 'tracking.scenes'): document | detect | one (protocol.js trackCuts). */
  get scenesMode() { return this.app.settings.get('tracking.scenes', 'document') || 'document'; }
  /** The range a track / span uses: app.doc.range, else the whole video. */
  get span() { const r = this.app.doc.range; return r ? { t0: r.t0, t1: r.t1 } : { t0: 0, t1: this.app.durationMs }; }
  get axisEditable() { return this.app.mode === 'track' && !!this.app.doc.media && this.busy !== 'track'; }
  /** Does this tracker take a stroke axis (its schema has `axis`)? */
  hasAxis(t = this.tracker) { return !!t?.params?.some((p) => p.key === 'axis'); }
  get aspect() { const m = this.app.doc.media; return m?.width && m?.height ? m.width / m.height : 16 / 9; }
  /** The params a run of tracker t sends: params + the Scenes section's cut_* options (their one home: the tracker panel
   *  shows no copy) + the stroke axis (axis.js axisParams). */
  withAxis(t, params) {
    const lmc = this.loopVals.loop_min_confidence, own = lmc != null && t.params?.some((p) => p.key === 'loop_min_confidence');   // the Scenes panel's loop option (loop_fold auto)
    return { ...params, ...$state.snapshot(this.sceneVals), ...(own ? { loop_min_confidence: lmc } : {}), ...axisParams(t.params, this.axisMode, this.axis, params, this.aspect) };
  }
  /** The span labels a Track over [a, b) sends: derived from the scene tags (acts.js tagSpans: structure / blank -> idle,
   *  off-screen inside a continuation -> carry, orgasm -> climax), the old manual span labels winning where they overlap. */
  spansFor(a, b) { const list = this.liveScenes(); return spansForRequest(tagSpans(list, continuations(list, SCENE_OPTS), this.spans), a, b); }
  get cycleMarks() { return cycleMarks(this.scenes, this.sceneInfo); }
  get ghosts() { return (this.app.doc.ghosts || []).filter((g) => g.source !== 'device-preview' && g.id !== BRIDGE && g.id !== SMART_AB && g.source?.kind !== 'autorange-preview'); }   // the machine preview, the bridge and the Autorange gap fills are not runs
  ghost(id) { return this.ghosts.find((g) => g.id === id) || null; }
  run(id) { return this.runs.find((r) => r.id === id) || null; }
  get selectedGhost() { return this.ghost(this.selectedId); }
  /** The selected ghost's full run record (tracker runs made in this session), else null. */
  get selected() { return this.selectedGhost ? this.run(this.selectedId) : null; }
  /** The pinned reference ghost (scoring target). */
  get reference() { return this.ghosts.find((g) => g.source?.kind === 'reference') || null; }
  get canTrack() {
    const t = this.tracker, s = this.span;
    return !!(this.videoPath && t && (!this.locked || this.preempt) && s.t1 > s.t0 && roiOk(t.roi, this.trackRoi));
  }
  /** The roi the next panel Track uses: the pending one (set by code), else an internal view's box, else the whole frame when
   *  groups are painted (they carry the seeding). */
  get trackRoi() {
    const plan = this.internalPlan, box = plan && this.trackerId === plan.tracker ? plan.box : null;
    return this.roi || box || this.groupsBox;
  }
  /** paw-x8we: the parts painted in the range (roi-part.js paintedParts). */
  paintedParts() { const s = this.span; return paintedParts(this.scenes, s.t0, s.t1); }
  /** Track ROI can start (what is tracked is decided when it runs: a painted part, else a box set by code). */
  get canPart() { return !!(this.videoPath && this.listed && this.trackers.length && (!this.locked || this.preempt) && this.span.t1 > this.span.t0); }
  /** The bounds box (+ its frame) of the earliest part painted in [t0, t1), for the code paths that want a box: Fix's re-track,
   *  Track tagged scenes' internal views. */
  partRoiIn(t0, t1) { const p = paintedParts(this.scenes, t0, t1)[0], b = p && partBox(p.group.poly); return b ? { ...b, t_ms: p.group.t_ms } : null; }
  /** Groups drawn in the range and nothing drawn: the whole frame is the box (the groups carry the seeding). */
  get groupsBox() {
    const t = this.tracker, s = this.span;
    return (t?.params?.some((x) => x.key === 'sem_groups') || t?.id === 'sam2_mask') && roiAccepts(t.roi, 'box') && trackGroups(this.scenes, s.t0, s.t1).length ? { kind: 'box', x: 0, y: 0, w: 1, h: 1 } : null;   // paw-ef73.26: SAM tracks the painted outlines (sidecar v4.39)
  }
  /** Drop the pending roi (Re-track, another video). */
  clearRoi() { this.roi = null; }
  /** The panel's own camera check runs: a new Track may stop it. */
  get preempt() { return ((this.busy === 'camera' && !this.owner) || this.#seederBusy) && !this.batch && !this.planBusy; }
  /** The background seeder training after a save (groups.svelte.js retrain auto): any panel job preempts it. */
  get #seederBusy() { return this.busy === 'seed' && this.owner === 'seeder'; }
  /** Why Track is disabled ('' = it is not). */
  get trackBlock() {
    const t = this.tracker;
    if (!this.videoPath) return 'Open a video first.';
    if (!t) return this.listed ? 'No tracker selected.' : 'Trackers not loaded.';
    if (this.locked && !this.preempt) return 'Busy: ' + (this.planBusy ? 'tracking tagged scenes' : TITLES[this.busy] || this.busy || 'describing') + '.';
    if (!roiOk(t.roi, this.trackRoi) && this.internalPlan?.tracker === t.id) return 'Internal view: paint the inserted part with Groups (Tab) first.';
    if (!roiOk(t.roi, this.trackRoi)) return 'Paint the part with Groups (Tab) first.';
    return '';
  }

  // ---- sidecar jobs ----
  /** Runs `request` as the next sidecar process. busy names it; a status-bar task shows progress. */
  busyScene = $state(-1);          // the scene index of the running scene job (describe / loop), -1 otherwise
  /** The running job's progress in words ('43 % · 1:20 left', 'reading the model weights', ...): panel, status bar, timeline. */
  get progressLabel() { const p = this.progress, t = progressText({ ...p, startedAt: this.startedAt, now: this.clock || Date.now(), lastLog: this.lastLog, busy: this.busy }); return this.cpu ? `running on CPU: slow · ${t}` : t; }
  /** paw-k97q: the GPU state in plain words ('' = nothing to say). */
  get gpuNote() { return gpuNote(this.gpu); }
  /** A tracker the GPU state turns off (greyed in the pickers, with gpuNote as the reason). */
  gpuOff(t) { return !!(t?.gpu && this.gpuNote); }
  /** The tracker pickers' options: the GPU-only ones greyed when the GPU is off. */
  get trackerChoices() { return this.trackers.map((x) => ({ value: x.id, label: x.name, ...(this.gpuOff(x) && { disabled: true, hint: 'needs a GPU' }) })); }
  /** 0..1 of the running job (0 before its first frame); while the shaft pass shows a frame (v4.44 t_ms): where that
   *  frame sits in the job's range, so the lanes' band moves through the scene with the picture. */
  get progressFrac() {
    const p = this.progress, r = this.busyRange;
    if (p.at != null && r && r.t1 > r.t0) return Math.min(0.99, Math.max(0, (p.at - r.t0) / (r.t1 - r.t0)));
    return p.total ? shownDone(p.done, p.total) / p.total : 0;
  }
  job(label, request, { onFrames, onEvent, title = TITLES[label] || label, task = true, owner = '', timeoutMs = 0, scene = -1, range = null } = {}) {
    const app = this.app, epoch = this.epochs[owner] || 0;
    // paw-shgb: the panel's own job while another tab's runs: refused (one sidecar job at a time per process); a background
    // job (owner set: seeder, grow, api ...) waits in the sidecar queue instead
    const other = label !== 'list' && !owner ? [...live].find((t) => t !== this && t.app?.tabs && t.app.tabs === app.tabs && t.busy && t.busy !== 'list') : null;
    if (other) {
      app.toast(`${TITLES[other.busy] || 'A tracker job'} is running in ${tabName(other.app)}: start this when it ends, or stop it there`, 'warn');
      return Promise.resolve({ result: null, error: null, cancelled: true, busyIn: other.app });
    }
    // paw-xfg6: the video file is missing (the player may show a cached copy): the sidecar reads the original, so say so
    // paw-zo60: asked again first (the drive may be back since the load): there now, the job runs
    if (request?.video && app.player?.missing) {
      const opts = arguments[2];
      return Promise.resolve(app.player.recheckMissing?.()).then((still) => {
        if (still === false) return this.job(label, request, opts);
        const error = 'video file not found: Locate video… first (bottom of the video pane)';
        if (task) app.toast(`${title}: ${error}`, 'warn', { action: { label: 'Locate video…', run: () => app.player.relink() } });
        return { result: null, error, cancelled: false };
      });
    }
    const p = this.chain.then(async () => {
      if (this.#dead || (owner && (this.epochs[owner] || 0) !== epoch)) return { result: null, error: null, cancelled: true };   // cancelled while queued; paw-vt22: or its tab closed
      this.busy = label; this.owner = owner; this.busyScene = scene; this.progress = { done: 0, total: 0, stage: '', rate: 0 }; this.startedAt = this.clock = Date.now(); this.lastLog = '';
      this.busyRange = range; this.cpu = false; let ema = null;
      // paw-eeod: every Track has a stall watchdog (a hung GPU kernel sends nothing for ever); x CPU_STALL_X on the CPU
      const stallS = label === 'track' && !timeoutMs ? +app.settings?.get?.('tracking.stallTimeoutS', STALL_TIMEOUT_S) || STALL_TIMEOUT_S : 0;
      if (stallS) timeoutMs = 1000 * stallS;
      const clock = stageClock(this.startedAt);   // paw-mhme: each label's time, into the usage log at the end
      const tk = task ? app.task(title, { cancel: () => this.cancel() }) : null;
      let tkText = '';
      const tick = () => { this.clock = Date.now(); const t = `${title} · ${this.progressLabel}`; if (tk && t !== tkText) tk.label((tkText = t)); };
      const clockTimer = setInterval(tick, 1000);
      app.sidecar = 'busy';
      let timer = 0, end;
      // a hung sidecar must not lock tracking until a restart: with timeoutMs, no event for that long kills it and
      // fails the job; a cancel() the sidecar does not answer resolves the job as cancelled after a grace period
      const ended = new Promise((res) => { end = res; });
      const span = () => { const m = Math.round(timeoutMs / 60_000), s = Math.round(timeoutMs / 1000); return m >= 1 ? `${m} minute${m === 1 ? '' : 's'}` : `${s} second${s === 1 ? '' : 's'}`; };
      const msg = () => label === 'describe' ? `describe made no progress for ${Math.round(timeoutMs / 1000)} s (the GPU may be busy with another job), so it was stopped. The limit is the setting tracking.describeTimeoutS.`
        : stallS ? `Tracking made no progress for ${span()}, so it was stopped. Try again, or track a shorter range.\nThe limit is the setting tracking.stallTimeoutS.`
        : `the tracker sidecar did not answer within ${Math.round(timeoutMs / 1000)} s (the first start can install packages; try again)`;
      // paw-shgb: the clock starts when the run does (it may wait in the sidecar queue behind another tab's job)
      let waiting = !!app.backend.isTauri;
      const alive = () => { if (!timeoutMs) return; clearTimeout(timer); timer = setTimeout(() => { if (waiting) return alive(); Promise.resolve(app.backend.cancelSidecar(this)).catch(() => {}); end({ result: null, error: msg(), cancelled: false }); }, timeoutMs); };
      this.abort = () => end({ result: null, error: null, cancelled: true });
      try {
        alive();
        const run = app.backend.sidecar(request, {
          onEvent: (e) => {
            if (e.device === 'cpu' && !this.cpu) { this.cpu = true; if (stallS) timeoutMs *= CPU_STALL_X; }   // paw-eeod: said in the progress label
            alive();
            if (e.type === 'progress') {
              ema = rateStep(ema, e, Date.now()); clock.mark(e.stage);
              this.progress = { done: e.done, total: e.total, stage: e.stage || '', rate: ema.rate, range: e.range ?? -1, ranges: e.ranges || 0,
                at: Number.isFinite(e.t_ms) ? e.t_ms : null, outline: Array.isArray(e.outline) ? e.outline : null };   // v4.44: the shaft pass's frame + outline
              tk?.update(shownDone(e.done, e.total), e.total); tick();
            }
            else if (e.type === 'result') { this.progress = { ...this.progress, stage: 'read' }; clock.mark('read'); tick(); }   // paw-iyl3: the app reads it (a track builds its run) before the job ends
            else if (e.type === 'log' && typeof e.line === 'string') this.lastLog = e.line.replace(/^pawtrack[\w.]*: (info: )?/, '').trim().slice(0, 120);
            onEvent?.(e);
          },
          onFrames: (b) => { alive(); onFrames?.(b); },
          owner: this, onStart: () => { waiting = false; alive(); },
          startTimeoutMs: 1000 * (+app.settings?.get('tracking.startTimeoutS', START_TIMEOUT_S) || START_TIMEOUT_S),
        });
        const r = await Promise.race([run, ended]);
        app.sidecar = r.error && !r.cancelled ? 'error' : 'idle';
        if (r.error && !r.cancelled && TOASTED.has(label)) this.#failed(label, r.error);
        if (r.cancelled && TOASTED.has(label) && owner !== 'api') app.toast(`${TITLES[label]} cancelled`, 'quiet');
        return r;
      } catch (e) {
        app.sidecar = 'error';
        if (TOASTED.has(label)) this.#failed(label, e?.message || e);
        return { result: null, error: String(e?.message || e), cancelled: false };
      } finally {
        app.usage?.note('tracking:stages', { label, ms: Date.now() - this.startedAt, stages: clock.text() });   // usage-<day>.jsonl
        clearTimeout(timer); clearInterval(clockTimer); clearTimeout(this.abortTimer); this.abort = null; tk?.end(); this.busy = ''; this.owner = ''; this.busyScene = -1; this.busyRange = null; this.stopping = false; this.startedAt = 0; this.lastLog = ''; this.cpu = false; }
    });
    this.chain = p.catch(() => {});
    return p;
  }
  /** One toast per failed job, with a way back to the panel (the error line there is easy to miss). */
  #failed(label, error) {
    this.app.toast(`${TITLES[label] || label} failed: ${firstLine(error)}`, 'error', { action: { label: 'Show', run: () => this.app.showPanel?.('tracking') } });
  }
  /** now: kill the running job even inside Track tagged scenes (another video was opened). */
  cancel(now = false) {
    // Track tagged scenes: the first cancel lets the running scene finish (its run is kept), the second kills it
    if (this.planBusy && !this.planBusy.stop) {
      this.planBusy = { ...this.planBusy, stop: true };
      if (!now) { this.app.toast(`Track tagged scenes stops after this scene · ${this.app.commands?.keysFor?.('track.cancel')?.[0] || 'Esc'} again to stop now`, 'quiet'); return; }
    }
    this.stop = true; if (this.busy) { this.stopping = true; this.#kill(); }
  }
  /** Kill the sidecar; a process that ignores the kill must not keep the job open: give up on it after 3 s. */
  #kill() {
    Promise.resolve(this.app.backend.cancelSidecar(this)).catch(() => {});   // paw-shgb: this store's run only, never another tab's
    clearTimeout(this.abortTimer);
    this.abortTimer = setTimeout(() => this.abort?.(), 3000);
  }
  /** Kill the current job only if `owner` started it, and drop that owner's queued jobs (the panel's are untouched). */
  cancelOwner(owner) {
    this.epochs[owner] = (this.epochs[owner] || 0) + 1;
    if (this.busy && this.owner === owner) this.#kill();
  }
  /** paw-wzxu: drop `owner`'s queued jobs (they resolve as cancelled, never start); its running job goes on. */
  dropQueued(owner) { this.epochs[owner] = (this.epochs[owner] || 0) + 1; }

  // ---- video ----
  openVideo(path) {
    if (path === this.path) return;
    // a job on the previous video would keep Track blocked and show its progress on this one: stop it
    if (this.busy && this.busy !== 'list' && this.path) { this.cancel(true); this.app.toast(`${TITLES[this.busy] || 'The tracker job'} on ${basename(this.path)} was stopped: ${path ? 'another video was opened' : 'its video was closed'}`, 'info'); }
    this.path = path;
    Object.assign(this, { sceneUi: [], shownBoxes: {}, runs: [], selectedId: '', roi: null, partHover: null, error: '', notice: '', origExists: false, scores: {}, live: null });
    this.restoreRuns();
    this.spans = (path && this.app.settings.get('tracking.spans:' + path, [])) || [];
    const ax = (path && this.app.settings.get('tracking.axis:' + path, null)) || null;
    this.axis = axisClean(ax?.axis); this.axisMode = typeof ax?.mode === 'string' ? ax.mode : ''; this.axisOn = false; this.axisPointer?.cancel();
    if (path) this.app.backend.exists(stem(path) + '.funscript').then((x) => { if (this.path === path) this.origExists = !!x; }, () => {});
  }

  // ---- stroke axis ----
  #putAxis(axis, mode) {
    this.axis = axis; this.axisMode = mode;
    if (this.path) this.app.settings.set('tracking.axis:' + this.path, axis || mode ? { axis, mode } : null);
  }
  /** The drawn arrow ({x0,y0,x1,y1}, out -> in, 0..1) or null. Drawing one selects custom; clearing it leaves custom. */
  setAxis(a) {
    const axis = axisClean(a);
    this.#putAxis(axis, axis ? 'custom' : this.axisMode === 'custom' ? '' : this.axisMode);
  }
  setAxisMode(mode) { this.#putAxis(this.axis, mode || ''); }
  /** Axis tool on / off (Track mode, a video). */
  toggleAxisTool(on = !this.axisOn, target = -1) {
    if (on && !this.axisEditable) { this.app.toast(this.app.mode !== 'track' ? 'The stroke axis is drawn in the Track tab' : 'Open a video first', 'quiet'); return; }
    this.axisPointer.cancel();
    this.cancelDerive();
    this.axisTarget = on ? target : -1;
    this.axisOn = on;
  }

  // ---- trackers ----
  /** First use: ask the sidecar once (the panel and the commands call this). */
  ensureListed() { if (!this.listed && this.busy !== 'list' && !this._listing) this.list(); }
  #listP = null;
  /** paw-ws19: settles when the list request in flight (if any) has ended. */
  listingNow() { return this.#listP ?? Promise.resolve(); }
  list() { return (this.#listP ??= this.#list().finally(() => { this.#listP = null; })); }
  async #list() {
    this._listing = true;
    try {
      const be = this.app.backend;
      let res = listedFor.get(be);   // paw-shgb: listed by another tab already (it may be tracking now: no wait behind it)
      if (!res) {
        // a reload can leave a sidecar running: once per window, and never while another tab's job runs
        if (!swept.has(be)) { swept.add(be); if (![...live].some((t) => t.app?.backend === be && t.busy && t.busy !== 'list')) { try { await be.cancelSidecar(); } catch { /* nothing running */ } } }
        this.error = '';
        const r = await this.job('list', listRequest(), { timeoutMs: LIST_TIMEOUT_MS });
        if (r.cancelled) return;   // not listed: the next use asks again
        if (r.error) { this.error = 'Could not list trackers: ' + r.error; return; }
        res = r.result || {};
        if (res.trackers?.length) listedFor.set(be, res);
      }
      this.error = '';
      this.trackers = res.trackers || [];
      this.sceneParams = res.scene_params || [];
      this.loopParams = res.loop_params || [];
      this.describeParams = res.describe_params ?? null;
      this.gpu = res.gpu && typeof res.gpu === 'object' ? res.gpu : null;   // v4.56; an older sidecar sends none
      this.sceneVals = defaultParams(this.sceneParams);
      this.loopVals = defaultParams(this.loopParams);
      this.describeVals = defaultParams(this.describeParams || []);
      const by = {};
      for (const t of this.trackers) by[t.id] = { ...defaultParams(t.params), ...this.#prefs(t), ...(this.paramsBy[t.id] || {}) };
      this.paramsBy = by;
      this.listed = true;
      const last = this.app.settings.get('tracking.lastTracker');
      const on = this.trackers.filter((t) => !this.gpuOff(t)), pick = on.length ? on : this.trackers;   // paw-k97q: not a greyed one
      if ((!this.tracker || this.gpuOff(this.tracker)) && pick.length) {   // paw-vdr4: a pick not listed (CoTracker3 not installed) or none yet: TAPNext++
        const f = trackerFor(pick, last);
        this.selectTracker(f.id, false);
        if (f.note) this.app.settings.set('tracking.lastTracker', f.id);   // the note once, not at every start
        this.#fellBack(f.note);
      }
    } finally { this._listing = false; }
  }
  /** The settings' defaults for a tracker's own params (tracking.model, tracking.boxPoints), where it has that param and the
   *  value is one it takes. -> {model?, box_points?} */
  #prefs(t) {
    const S = this.app.settings, out = {};
    for (const [key, param] of [['tracking.model', 'model'], ['tracking.boxPoints', 'box_points']]) {
      const p = t.params?.find((x) => x.key === param), v = S.get(key);
      if (!p) continue;
      if (p.choices ? p.choices.includes(v) : Number.isFinite(v) && v >= (p.min ?? -Infinity) && v <= (p.max ?? Infinity)) out[param] = v;
    }
    return out;
  }
  /** A tracking setting changed in the Settings panel: the tracker pick, or the params' defaults on every listed tracker. */
  applyPrefs(key) {
    if (key === 'tracking.lastTracker') { const id = this.app.settings.get(key); if (this.trackers.some((t) => t.id === id)) this.selectTracker(id, false); return; }
    for (const t of this.trackers) if (this.paramsBy[t.id]) Object.assign(this.paramsBy[t.id], this.#prefs(t));
  }
  #noted = false;
  /** paw-vdr4: the one plain note when a CoTracker3 pick (a setting, an old project, a plan) runs on another tracker. */
  #fellBack(note) { if (note && !this.#noted) { this.#noted = true; this.app.toast(note, 'info'); } }
  selectTracker(id, remember = true) {
    this.trackerId = id;
    if (remember) {   // the user's pick: it also wins over an internal-view default for the current scene
      this.app.settings.set('tracking.lastTracker', id);
      const s = this.scenes[this.currentScene];
      if (s && !this.pickedFor.has(s.start_ms)) this.pickedFor = new Set([...this.pickedFor, s.start_ms]);
      this.#autoFrom = null;
    }
    if (this.roi && !roiAccepts(this.tracker?.roi, this.roi.kind)) this.roi = null;
  }

  // ---- range ----
  setRange(t0, t1) { this.app.doc.range = t1 > t0 ? { t0: Math.round(t0), t1: Math.round(t1) } : null; }
  rangeToScene(s) { this.setRange(s.start_ms, s.end_ms); this.app.player.seek(landAt(this.app, s.start_ms, s.end_ms)); }   // a shot that fades in: its first clean frame
  /** Range = the detected scene under the playhead. */
  rangeToSceneAtPlayhead() { const i = sceneAt(this.scenes, playheadFrameStart(this.app.player)); if (i >= 0) this.rangeToScene(this.scenes[i]); }

  // ---- scenes ----
  /** -> {scenes, media} | {error} | {cancelled} (the panel ignores it; api.js hands it to other features). */
  async detectScenes({ owner = '' } = {}) {
    if (!this.videoPath) return { error: 'Open a video first.' };
    // the panel refuses while anything runs; api callers queue behind other jobs and only wait out Describe all
    if (owner ? this.batch : this.locked) return { error: 'Busy: ' + (TITLES[this.busy] || this.busy || 'describing') + '.' };
    this.error = '';
    const path = this.videoPath;
    const r = await this.job('scenes', scenesRequest(path, { ...this.sceneVals }), { owner });
    if (this.path !== path) return { error: 'The video changed.' };
    if (r.cancelled) return { cancelled: true };
    if (r.error) { this.error = 'Scene detection failed: ' + r.error; return { error: r.error }; }
    if (!r.result) return { error: 'No result.' };
    const list = cleanScenes(r.result.scenes).map((s) => ({ ...s }));
    this.app.transact('Detect scenes', () => { this.app.doc.scenes = list; });
    this.sceneUi = []; this.shownBoxes = {};
    const nScenes = sceneRuns(this.scenes).length;
    this.app.toast(nScenes === this.scenes.length ? `${nScenes} scenes` : `${this.scenes.length} shots in ${nScenes} scenes (camera moves joined)`, 'quiet');
    // paw-fc0r: with the repeated frames still being computed the join below finds nothing; it runs again once they are
    // ready (searchLoops). On the owner's 9e6c video 19 camera moves inside one loop stayed split that way.
    const joined = joinLoopMoves(this.app);   // paw-ef73.4: a camera move inside one loop (the cycle goes on across it) is joined, one undo step
    this.#joinFor = repeatsPending(this.app) ? path : null;
    if (!owner) this.searchLoops();   // paw-ef73.10: the loop search by itself, in the background (not for api callers: Draft runs its own)
    return { scenes: joined ? this.app.doc.scenes : list, media: r.result.media || null };
  }
  /** describe / loop results go into the document's scene; busy / error stay local. */
  patchScene(i, { describe, loop, ...ui }) {
    if (Object.keys(ui).length) { const u = [...this.sceneUi]; u[i] = { ...(u[i] || {}), ...ui }; this.sceneUi = u; }
    if (describe !== undefined || loop !== undefined) {
      this.app.doc.scenes = this.scenes.map((s, k) => (k === i ? { ...s, ...(describe !== undefined && { describe }), ...(loop !== undefined && { loop }) } : s));
    }
  }
  /** -> {result} | {error} | {cancelled}. write false: the result is only returned (api.js), the document is
   *  left alone and the scene's busy / error badges are not touched. */
  async sceneJob(i, kind, { write = true, owner = '' } = {}) {
    const s = this.scenes[i];
    if (!s) return { error: 'No scene ' + i + '.' };
    if (kind === 'describe' && !this.describeParams) return { error: 'describe is not installed (needs the describe extra and a CUDA GPU).' };
    const path = this.videoPath, vals = kind === 'describe' ? this.describeVals : this.loopVals;
    if (write) this.patchScene(i, { busy: kind, error: '' });
    const req = (kind === 'describe' ? describeRequest : loopRequest)(path, s.start_ms, s.end_ms, { ...vals });
    const r = await this.job(kind, req, { owner, scene: i, range: { t0: s.start_ms, t1: s.end_ms }, timeoutMs: kind === 'describe' ? 1000 * (+this.app.settings.get('tracking.describeTimeoutS', DESCRIBE_TIMEOUT_S) || DESCRIBE_TIMEOUT_S) : 0 });
    const out = r.cancelled ? { cancelled: true } : r.error ? { error: r.error } : { result: r.result };
    if (this.path !== path || this.scenes[i] !== s) return { error: 'The scenes changed.' };
    if (!write) return out;
    if (r.cancelled) this.patchScene(i, { busy: '' });
    else if (r.error) this.patchScene(i, { busy: '', error: r.error });
    else this.patchScene(i, { busy: '', [kind]: r.result });
    return out;
  }
  /** Queued behind whatever runs (the job chain is serial); a scene already waiting or running is not queued twice. */
  describeScene(i) { this.app.usage?.note('tracking:describe', i); return this.sceneUi[i]?.busy === 'describe' ? Promise.resolve({ error: 'already queued' }) : this.sceneJob(i, 'describe'); }
  loopScene(i) { return this.sceneJob(i, 'loop'); }
  /** paw-ef73.10: the loop search in shot i; a find goes in the Loops row as an automatic, approximate loop (never over
   *  a loop already there). -> the loop added, or null. */
  async searchLoopAt(i, { owner = 'loops' } = {}) {
    const app = this.app, s = this.scenes[i], path = this.videoPath;
    if (!s || !this.loopParams.length) return null;
    const r = await this.sceneJob(i, 'loop', { owner });
    if (r.cancelled) return { cancelled: true };
    if (!r.result || this.path !== path) return null;
    const l = searchLoop(s, r.result, { minConfidence: +(this.loopVals.loop_min_confidence ?? 0.5), id: newId('lp') });
    if (!l || app.doc.loops.some((x) => x.t0 < l.auto.end && l.t0 < Math.max(x.t1, x.tiledTo || 0, x.auto?.end || 0))) return null;
    app.transact('Loop found by the loop search', () => { app.doc.loops = [...app.doc.loops, l].sort((a, b) => a.t0 - b.t0); });
    app.usage?.note?.('scenes:loopSearch', { shot: i, n: l.auto.n, conf: l.auto.confidence });
    return l;
  }
  /** After Detect scenes: once the repeated frames have marked their loops, the loop search in every shot they left
   *  without one (loop-search.js searchTargets), one shot at a time behind whatever else is queued (describe, a Track);
   *  Cancel / Esc stops the rest. Shots searched before (a result on the shot) or whose loop the owner removed are skipped. */
  async searchLoops() {
    const app = this.app, path = this.videoPath;
    if (!path || !this.loopParams.length || this.loopSearching) return;
    this.loopSearching = true;
    try {
      for (let k = 0; k < 600 && repeatsPending(app); k++) await new Promise((res) => setTimeout(res, 1000));
      if (this.path !== path) return;
      if (this.#joinFor === path) { this.#joinFor = null; joinLoopMoves(app); }   // Detect ran before the repeats (paw-fc0r)
      markAutoLoops(app);
      let found = 0;
      for (const i of searchTargets(this.scenes, app.doc.loops, app.doc.repeats?.off || [])) {
        if (this.path !== path) return;
        const l = await this.searchLoopAt(i);
        if (l?.cancelled) return;
        if (l) found++;
      }
      if (found) app.toast(`${found} loop${found > 1 ? 's' : ''} found by the loop search (on their shots, approximate)`, 'quiet', { timeout: 6000 });
    } finally { this.loopSearching = false; }
  }
  /** Describe every scene in one sidecar request (one model load, PROTOCOL v4.2 `ranges`): each scene's tags land as
   *  soon as it is done; Esc / Cancel stops the rest. A scene edited meanwhile (its range changed) is left alone. */
  async describeAll() {
    if (this.locked || !this.describeParams || !this.scenes.length) return;
    const path = this.videoPath, list = this.scenes.map((s) => ({ start_ms: s.start_ms, end_ms: s.end_ms })), n = list.length;
    const same = (i) => this.path === path && this.scenes[i]?.start_ms === list[i].start_ms && this.scenes[i]?.end_ms === list[i].end_ms;
    const at = (i) => { this.busyScene = i; this.busyRange = { t0: list[i].start_ms, t1: list[i].end_ms }; };
    this.stop = false; this.batch = { done: 0, total: n };
    list.forEach((_, i) => { this.app.usage?.note('tracking:describe', i); this.patchScene(i, { busy: 'describe', error: '' }); });
    const r = await this.job('describe', describeAllRequest(path, list.map((s) => [s.start_ms, s.end_ms]), { ...this.describeVals }), {
      title: 'Describing scenes', scene: 0, range: { t0: list[0].start_ms, t1: list[0].end_ms },
      timeoutMs: 1000 * (+this.app.settings.get('tracking.describeTimeoutS', DESCRIBE_TIMEOUT_S) || DESCRIBE_TIMEOUT_S),
      onEvent: (e) => {
        if (!Number.isInteger(e.range) || e.range < 0 || e.range >= n) return;
        if (e.type === 'progress' && e.range !== this.busyScene) { at(e.range); this.batch = { done: e.range, total: n }; }
        if (e.type !== 'described') return;
        const { type, range: i, error, ...res } = e;
        if (same(i)) this.patchScene(i, error ? { busy: '', error } : { busy: '', describe: res });
        this.batch = { done: i + 1, total: n };
      },
    });
    for (let i = 0; i < n; i++) if (this.sceneUi[i]?.busy === 'describe') this.patchScene(i, r.error && !r.cancelled && same(i) ? { busy: '', error: r.error } : { busy: '' });
    this.batch = null;
  }
  /** paw-2lp7.3 Describe by ranges: the tagger on a time grid over the whole video (PROTOCOL v4.49, the shots' cuts as sample
   *  boundaries), then one request for at most 4 frames per open edge, then describe-ranges.js proposeRanges against the
   *  accepted regions as they are when it lands; write (default): they replace the earlier proposals in app.doc.acts (auto:
   *  true, dashed on the Actions strip; one undo step). knobs: DEFAULTS' (step, on, off, bridge, minMs, carryMs, cover,
   *  calibrated) and refine (false = no second request). -> {regions, mods (modifier ranges, not written), samples, refined} |
   *  {error} | {cancelled}; a failed refine keeps the first pass's edges. */
  async describeRanges({ owner = '', refine = true, write = true, ...knobs } = {}) {
    if (!this.videoPath) return { error: 'Open a video first.' };
    if (!this.describeParams) return { error: 'describe is not installed (needs the describe extra and a CUDA GPU).' };
    const app = this.app, path = this.videoPath, o = { ...RANGE_DEFAULTS, ...knobs }, params = { ...this.describeVals };
    const opts = { owner, title: 'Describing by ranges', timeoutMs: 1000 * (+app.settings.get('tracking.describeTimeoutS', DESCRIBE_TIMEOUT_S) || DESCRIBE_TIMEOUT_S) };
    const a = await this.job('describe', gridRequest(path, { step: o.step, shots: this.scenes.map((s) => [s.start_ms, s.end_ms]), params }), opts);
    if (this.path !== path) return { error: 'The video changed.' };
    if (a.cancelled || a.error || !a.result) return a.cancelled ? { cancelled: true } : { error: a.error || 'No result.' };
    const samples = a.result.samples || [];
    const base = () => ({ ...o, shots: this.scenes, accepted: (app.doc.acts || []).filter((r) => !r.auto), fx: app.doc.fx || [], thresholds: a.result.thresholds, grid: gridOf(app.player) });
    const first = proposeRanges(samples, base());
    let refined = [];
    if (refine && first.refine.length) {
      const b = await this.job('describe', refineRequest(path, first.refine, params), opts);
      if (this.path !== path) return { error: 'The video changed.' };
      refined = b.result?.samples || [];
    }
    const res = { ...proposeRanges(samples, { ...base(), refined }), samples, refined };   // against the regions as they are now
    if (write && (res.regions.length || (app.doc.acts || []).some((r) => r.auto))) {
      app.transact('Describe by ranges', () => { app.doc.acts = withRangeProposals(app.doc.acts, res.regions); });
      app.toast?.(res.regions.length ? `${res.regions.length} proposed action region${res.regions.length === 1 ? '' : 's'} (dashed): click one or Enter to accept, Delete to dismiss` : 'Describe by ranges found no action outside the accepted regions', 'info');
    }
    app.usage?.note?.('acts:describeRanges', { n: res.regions.length, mods: res.mods.length, samples: samples.length, refined: refined.length, step: o.step });
    return res;
  }
  // ---- scenes that continue behind a cutaway (lib/scenes-continue.js) ----
  proposed = $state.raw(new Set());   // start_ms of the scenes proposed to continue (fingerprints): session-only, never saved
  // paw-3uyu: links between nearby shots that show the same footage re-framed (lib/crop-match.js), session-only, keyed
  // by span so a later model can read them directly: {links: [{a, b: {start_ms, end_ms}, kind 'crop', score, scale,
  // tighter 'a' | 'b', box {x, y, w, h} (the tighter frame inside the wider, 0..1), loops: crop-match.js loopLinks}],
  // inserts: [{a, c (start_ms of the shots the insert sits between), shots: [start_ms of each insert], crop: scale | null}]}
  shotLinks = $state.raw({ links: [], inserts: [] });
  #prints = new Map(); #printsPath = null; #scrub = null; #scrubRe = 0; #links = new Map();
  framesWhy = $state('');   // paw-trxk: why the shot links' frames come from the player's stills (no WebCodecs decoder for this file), '' = they do not
  /** The scenes with the proposals applied (continues 'auto', the cutaway offscreen) and their structure (acts.js
   *  withStructure): what the lane draws and bridges. */
  /** The scenes as tracking reads them: proposals applied, the event modifiers in them (mods.js withMods: the sidecar's
   *  climax / idle labels, an idle shot), structure derived. Never written back. */
  liveScenes(list = this.scenes) {
    const fx = this.app.doc.fx, pr = this.proposed, m = this.#liveScenesMemo;   // paw-3ga3: the same inputs -> the same list (every live-script compose asks)
    if (m && m.list === list && m.fx === fx && m.pr === pr) return m.out;
    const out = withStructure(withProposals(withMods(list, fx), pr, SCENE_OPTS));
    this.#liveScenesMemo = { list, fx, pr, out };
    return out;
  }
  #liveScenesMemo = null;
  #queueProposals() { clearTimeout(this.timers.continues); this.timers.continues = setTimeout(() => this.#propose(), 600); }
  /** Fingerprint every scene's first / last frame (cached per video), link nearby shots that are the same footage
   *  re-framed (paw-3uyu: 4 frames a shot, crop-match.js), and propose where A ≈ A' (or A' re-frames A) around a different B. */
  // paw-o60v.1: the scan never competes with playback or a drag (#idle before every frame read and every comparison), compares
  // in a Worker (shot-scan.js offMain) and keeps its results per video in IndexedDB (scanCacheGet / Put), keyed by the shots'
  // spans: #links = linkShots' cache, #dist = each pair's fingerprint distance (i's last vs j's first print), #loopsAt = each
  // linked pair's loop links. A shot whose pairs are all known is not decoded at all; a shot with a frame missing is not saved.
  #dist = new Map(); #loopsAt = new Map(); #partial = new Set(); #cacheKey = null; #down = false;
  // The saved results' key. SCAN_ALG: bump when lib/crop-match.js, printTimes / grey16 or what the scan keeps change (older
  // results are then ignored). ponytail: the video is known by its path and size; another file put at the same path keeps
  // the old results (key on media.hash if that ever happens)
  #scanKey(path) { const SCAN_ALG = 1, m = this.app.doc.media; return `${SCAN_ALG}|${path}|${m?.width}x${m?.height}`; }
  /** Resolves in a background-priority task (after input and painting) once the video is not playing and no pointer is down
   *  (polls every 200 ms meanwhile). -> live() */
  #idle(live = () => true) {
    return new Promise((r) => {
      const go = () => (live() && (this.app.player?.playing || this.#down) ? setTimeout(go, 200) : r(live()));
      if (globalThis.scheduler?.postTask) globalThis.scheduler.postTask(go, { priority: 'background' }); else setTimeout(go, 0);
    });
  }
  /** The frame reader and everything read with it belong to video `path` (another video's prints are keyed by ms too). */
  #framesFor(path) {
    this.#prints.clear(); this.#links = new Map(); this.#dist = new Map(); this.#loopsAt = new Map(); this.#partial = new Set(); this.#cacheKey = null; this.#printsPath = path; this.#scrub?.then((x) => x?.dispose()); this.#scrub = null; this.#scrubRe = 0; this.framesWhy = '';
    if (this.shotLinks.links.length || this.shotLinks.inserts.length) this.shotLinks = { links: [], inserts: [] };   // paw-o60v.1: the other video's, not shown while this one's scan runs (it may wait for playback)
    if (this.proposed.size) this.proposed = new Set();
  }
  async #propose() {
    const list = this.scenes, path = this.videoPath, live = () => this.scenes === list && this.videoPath === path, t0 = performance.now();
    if (this.#printsPath !== path) this.#framesFor(path);
    if (list.length < 3 || !path) { if (this.proposed.size) this.proposed = new Set(); this.shotLinks = { links: [], inserts: [] }; return; }
    const farNow = this.#farLinks(list, path);   // paw-0zwb: the saved loop links are there before anything is decoded
    if (farNow.length && !this.shotLinks.links.length) this.shotLinks = { links: farNow, inserts: this.shotLinks.inserts };
    const ck = this.#scanKey(path);
    if (this.#cacheKey !== ck) {   // this video's saved results, read once
      const got = await scanCacheGet(ck);
      if (!live()) return;
      this.#cacheKey = ck;
      for (const [mine, saved] of [[this.#links, got?.links], [this.#dist, got?.dist], [this.#loopsAt, got?.loops]]) if (saved instanceof Map) for (const [k, v] of saved) if (!mine.has(k)) mine.set(k, v);
    }
    const key = (i) => `${list[i].start_ms}-${list[i].end_ms}`, pk = (i, j) => `${key(i)}|${key(j)}`, pairs = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j <= Math.min(list.length - 1, i + CROP_MATCH.gap); j++) pairs.push([i, j]);
    const dists = this.#dist, known0 = this.#links.size + dists.size + this.#loopsAt.size, need = new Set();
    for (const [i, j] of pairs) if (!this.#links.has(pk(i, j)) || !dists.has(pk(i, j))) need.add(i).add(j);
    const prints = [], frames = [];
    for (let i = 0; i < list.length; i++) {
      if (!need.has(i)) { prints.push(null); frames.push([]); continue; }   // every pair it is in is known
      const got = [];
      for (const t of printTimes(list[i], 4)) {
        const f = await this.#print(t, path);
        if (!live() || f === undefined) return;   // edited meanwhile (the next run takes over) / no frame access
        got.push(f);
      }
      if (!got.every(Boolean)) this.#partial.add(key(i));
      prints.push(got[0] && got[3] ? { first: got[0].g16, last: got[3].g16 } : null);
      frames.push(got.filter(Boolean).map((f) => f.pyr));
    }
    for (const [i, j] of pairs) if (!dists.has(pk(i, j))) dists.set(pk(i, j), printDist(prints[i]?.last, prints[j]?.first));
    const links = await linkShots(frames, { key, cache: this.#links, step: () => this.#idle(live), match: (a, b, o) => offMain('cropLink', [a, b, o]) });
    if (!links || !live()) return;
    const spans = proposeSpans(list, prints, { ...SCENE_OPTS, crop: (i, j) => links.get(`${i}:${j}`) || null, dist: (i, j) => dists.get(pk(i, j)) ?? NaN });
    const next = new Map(spans.map((p) => [list[p.c].start_ms, list[p.a].start_ms])), had = this.proposed, fresh = [...next.keys()].filter((t) => !had.has(t)).length;
    if (fresh || next.size !== had.size) this.proposed = next;
    if (fresh) this.app.usage?.note('scenes:continuesProposed', fresh);
    const out = await this.#linkLoops(list, links, path, live);
    if (!out || !live()) return;
    if (this.#links.size + dists.size + this.#loopsAt.size !== known0) {   // something new compared: saved for the next session
      const bad = (k) => k.split(/[|#]/).some((s) => this.#partial.has(s)), keep = (m) => new Map([...m].filter(([k]) => !bad(k)));
      scanCachePut(ck, { links: keep(this.#links), dist: keep(dists), loops: keep(this.#loopsAt) });
    }
    const inserts = spans.map((p) => ({ a: list[p.a].start_ms, c: list[p.c].start_ms, shots: list.slice(p.a + 1, p.c).map((s) => s.start_ms), crop: p.crop?.scale ?? null }));
    this.shotLinks = { links: mergeLinks(out, this.#farLinks(list, path)), inserts };
    const far = await this.#loopCrops(list, path, live);   // paw-0zwb
    if (!far || !live()) return;
    this.shotLinks = { links: mergeLinks(out, far), inserts };
    // paw-o60v.1: how long the scan took (wall time, its waits for playback / a drag included) and how much it had to read
    this.scanInfo = { ms: Math.round(performance.now() - t0), shots: list.length, decoded: need.size, compared: this.#links.size + dists.size + this.#loopsAt.size - known0 };
    if (need.size) this.app.usage?.note?.('tracking:shotScan', this.scanInfo);
  }
  scanInfo = null;
  // ---- paw-0zwb: loops matched as whole cycles, anywhere in the video (crop-match.js matchCycles). The owner's rule: loops of
  // the SAME frame count only; every frame of one pass of each matched under one transform over every phase shift; seeded
  // random frames of every other pass spot-checked. Saved in the project (block 'loopLinks': the loop pairs found and the
  // loops compared), so a reopened project has its links (and its fills) at once and only new loops are compared. ----
  #far = { path: null, pairs: [], done: new Set(), cache: new Map() };   // path '' = loaded with the project, the next video's
  /** The saved / found loop links whose two shots are still shots of `list`. */
  #farLinks(list, path) {
    const F = this.#far;
    if (F.path !== path && F.path !== '') return [];
    const has = (sp) => list.some((s) => Math.abs(s.start_ms - sp.start_ms) < 1 && Math.abs(s.end_ms - sp.end_ms) < 1);
    return loopShotLinks(F.pairs.filter((p) => has(p.A.shot) && has(p.B.shot)));
  }
  /** Every pair of automatic loops of one period in different shots (not the same footage), matched once per pair (cached
   *  by the loops' identity), the matches spot-checked. -> the loop links (shotLinks.links entries, via 'loops') | null. */
  async #loopCrops(list, path, live) {
    const F = this.#far;
    if (F.path !== path) { if (F.path !== '') Object.assign(F, { pairs: [], done: new Set(), cache: new Map() }); F.path = path; }
    const ix = repeatsOf(this.app), grid = gridOf(this.app.player), fm = this.app.player?.frameMs || 1000 / (this.app.doc.media?.fps || 30);
    if (!ix) return this.#farLinks(list, path);
    const span = (s) => ({ start_ms: s.start_ms, end_ms: s.end_ms });
    const L = autoLoops(ix, fm, grid).map((l) => {
      const f0 = Math.round(l.t0 / fm), shot = list.find((s) => l.t0 + fm / 2 >= s.start_ms && l.t0 + fm / 2 < s.end_ms);
      return { l, key: l.key, id: `${l.key}@${f0}`, P: Math.round((l.t1 - l.t0) / fm), shot, fam: loopGroup(ix, { auto: { key: l.key } }, fm) };
    }).filter((x) => x.shot && x.P >= LOOP_MATCH.minFrames && x.P <= LOOP_MATCH.maxFrames);
    // ponytail: the first passes of a run's loops stay in memory for that run (~50 KB a frame; ~40 MB on the owner's video)
    const pyrAt = async (X, k) => { const f = await this.#print(Math.round(X.l.t0 + k * fm + fm / 2), path, false); return !live() || f === undefined ? undefined : f?.pyr || null; };
    const firstPass = async (X) => {
      if (X.first) return X.first;
      const fr = [];
      for (let k = 0; k < X.P; k++) { const p = await pyrAt(X, k); if (p === undefined) return undefined; if (!p) return (X.first = []); fr.push(p); }
      return (X.first = fr);
    };
    const found = [];
    for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) {
      const A = L[a], B = L[b], k = `${A.id}|${B.id}`;
      if (A.P !== B.P || A.shot === B.shot || (A.fam >= 0 && A.fam === B.fam)) continue;
      if (!F.cache.has(k)) {
        if (F.done.has(A.id) && F.done.has(B.id)) { F.cache.set(k, null); continue; }   // compared before (saved): no link
        if (!(await this.#idle(live))) return null;   // paw-o60v.1
        const PA = await firstPass(A), PB = PA && await firstPass(B);
        if (PA === undefined || PB === undefined) return null;
        let r = PA.length === A.P && PB.length === B.P ? await offMain('matchCycles', [PA, PB]) : null;
        if (!live()) return null;
        if (cycleOk(r)) {   // seeded frames of every later pass of both loops vs their counterparts in the other's first pass
          const pairs = [];
          for (const [X, Y, ofA] of [[A, B, true], [B, A, false]]) {
            for (const { pass, k: q } of spotPicks(X.id, X.l.n, X.P, { ok: (p, q2) => X.l.t0 + (p * X.P + q2 + 1) * fm <= X.l.end + fm / 2 })) {
              const me = await pyrAt(X, pass * X.P + q);
              if (me === undefined) return null;
              const other = (ofA ? PB : PA)[counterpart(q, r.shift, X.P, ofA)];
              if (me && other) pairs.push(ofA ? { A: me, B: other } : { A: other, B: me });
            }
          }
          const c = await offMain('spotCheck', [r, pairs]);
          if (!live()) return null;
          this.app.usage?.note?.('loops:cropPair', { n: A.P, score: Math.round(r.score * 100), margin: Math.round(r.margin * 100), spot: `${c.ok}/${c.n}` });
          r = c.agree ? { ...r, checks: { n: c.n, ok: c.ok } } : null;
        } else r = null;
        F.cache.set(k, r);
      }
      const r = F.cache.get(k);
      if (r) found.push({ A: { key: A.key, id: A.id, shot: span(A.shot) }, B: { key: B.key, id: B.id, shot: span(B.shot) }, r });
    }
    for (const X of L) F.done.add(X.id);
    F.pairs = found;
    return loopShotLinks(found);
  }
  /** The crop links as data (shotLinks.links), with the loops each joins (the repeats' back-to-back loops inside each
   *  shot, one period of frames each, crop-match.js loopLinks). -> [...] | null (stopped). */
  async #linkLoops(list, links, path, live) {
    const ix = repeatsOf(this.app), fm = this.app.player?.frameMs || 1000 / (this.app.doc.media?.fps || 30), loops = ix ? autoLoops(ix, fm, gridOf(this.app.player)) : [];
    const inShot = (s) => loops.filter((l) => l.t0 >= s.start_ms && l.t1 <= s.end_ms && l.t1 - l.t0 <= 48 * fm).slice(0, 3);
    const sk = (s) => `${s.start_ms}-${s.end_ms}`, ids = (Ls) => Ls.map((L) => `${L.key}@${L.t0}-${L.t1}`).join(',');
    const framesOf = async (s) => {
      const out = [];
      for (const L of inShot(s)) {
        const fr = [];
        for (let t = L.t0; t < L.t1 - fm / 2; t += fm) { const f = await this.#print(Math.round(t + fm / 2), path); if (!live() || f === undefined) return null; if (f) fr.push(f.pyr); else this.#partial.add(sk(s)); }
        out.push({ key: L.key, frames: fr });
      }
      return out;
    };
    const out = [], cache = this.#loopsAt;   // paw-o60v.1: per linked pair and the loops in its shots
    for (const [k, m] of links) {
      const [i, j] = k.split(':').map(Number), ck = `${sk(list[i])}|${sk(list[j])}#${fm}#${ids(inShot(list[i]))}#${ids(inShot(list[j]))}`;
      if (!cache.has(ck)) {
        const LA = await framesOf(list[i]), LB = LA && await framesOf(list[j]);
        if (!LB || !(await this.#idle(live))) return null;
        const lp = await offMain('loopLinks', [m, LA, LB]);
        if (!live()) return null;
        cache.set(ck, lp);
      }
      const span = (s) => ({ start_ms: s.start_ms, end_ms: s.end_ms });
      out.push({ a: span(list[i]), b: span(list[j]), kind: 'crop', score: m.score, scale: m.scale, tighter: m.tighter, box: linkBox(m), loops: cache.get(ck) });
    }
    return out;
  }
  /** The frame shown at ms (WebCodecs scrubber, cached): {g16 (grey16), pyr (crop-match.js pyramid of its PRINT_W
   *  print)}; null = not decoded, undefined = frames cannot be read. */
  /** paw-j3to: the picture shown at ms as a grey print ({w, h, d}: crop-match.js PRINT_W wide, 0..1), for "Tile loop"'s match;
   *  null = not decoded, undefined = frames cannot be read. Not kept in the shot links' cache. */
  async printAt(ms) { if (this.#printsPath !== this.videoPath) this.#framesFor(this.videoPath); const p = await this.#print(Math.round(ms), this.videoPath, false); return p ? p.pyr[0] : p; }
  async #print(ms, path, keep = true) {
    if (this.#prints.has(ms)) return this.#prints.get(ms);
    await this.#idle();   // paw-o60v.1: not while the video plays or a pointer is down
    if (path !== this.videoPath) return undefined;   // the video changed meanwhile: the caller stops
    if (this.#prints.has(ms)) return this.#prints.get(ms);
    const why = (e) => String(e?.message || e).replace(/^scrub: /, '').slice(0, 120);
    const app = this.app;
    // paw-b88b: a WebM / VP8 source reads the scrub cache or a proxy, else a transcode; why it could not stays out of the toast
    this.#scrub ??= createScrubber({ url: app.player?.url || app.backend.mediaUrl?.(path) || path, path, fps: app.doc.media?.fps || 30, ringS: 0.5, backend: app.backend, alts: app.player?.frameFiles?.(path) || [], task: (l, o) => app.task?.(l, o) })
      .catch((e) => { console.info('[tracking] shot links read the player stills:', e?.message || e); this.framesWhy = why(e); app.usage?.note('tracking:framesFailed', { why: this.framesWhy, src: 'create' }); app.toast?.('Shot links: frames read the slow way', 'quiet'); return null; });
    let s = await this.#scrub;
    if (s?.error && this.#scrubRe < 3) {   // paw-trxk: a decoder that died mid-session (an error, the browser reclaimed it) is made again, 3 times at most
      this.app.usage?.note('tracking:framesFailed', { why: why(s.error), src: 'decoder', again: ++this.#scrubRe });
      s.dispose(); this.#scrub = null;
      return this.#print(ms, path, keep);
    }
    if (s?.error) s = null;
    let p = null;
    try {
      // paw-trxk: no WebCodecs decoder for this file (or it keeps dying): the player's stills (the scrub cache's decoder, else
      // the hidden <video>): slower, never "no frames" (an editor's '©TIM' box once cost a video all its links)
      const pl = this.app.player, f = s ? await s.frameAt(ms) : await Promise.resolve(pl?.still?.(pl.clock?.frameAt ? pl.clock.frameAt(ms) : Math.floor(ms / (pl.frameMs || 1000 / 30)), 180)).catch(() => null);
      if (!s && !f && !pl?.url) return undefined;   // nothing can read frames
      if (f) {
        // paw-o60v.1: a decoded frame is drawn and read in the Worker (a clone, transferred: the ring keeps its own); a still here
        const { w, h } = printSize(this.app.doc.media?.width, this.app.doc.media?.height), vf = typeof VideoFrame !== 'undefined' && f instanceof VideoFrame ? f.clone() : null;
        const r = vf ? await offMain('framePrint', [vf, w, h, true], [vf]) : framePrint(f, w, h);
        p = { g16: grey16(r.rgba16), pyr: r.pyr };
      }
    } catch { p = null; }
    if (keep && (p || s) && path === this.#printsPath) this.#prints.set(ms, p);   // paw-0zwb: a loop pass's frames are not kept (the pair cache is); a still that did not come (superseded) is asked again
    return p;
  }
  /** Bridges on the active axis ($derived): [{t0, t1, script, mode}] with no linked run and no points of the axis inside:
   *  each continuation of cutaways only (no internal view; mode 'carry' = carried strokes, 'hold' when every cutaway is
   *  blank: the viewer sees nothing), then each other blank scene ('hold': the level before, easing into the next) and
   *  structure scene (mode = its tag: intro holds at rest and eases into the next scene's first point, idle holds at
   *  rest, outro eases to rest and holds, after = the afterglow recipe) and an untracked scene with an Insertion / Pull-out
   *  modifier (mode 'insertion': ONE push / pull over its span from where the scene before left the script, else 100,
   *  held; a Knotting modifier over an insertion makes it one knot-in; lib/fx.js insertionScript). A neighbour's points:
   *  the axis's where it has some in that scene, else its linked run's. A filled span (`fills`) is mode 'fill' and wins
   *  over every other bridge that touches it. paw-2lp7.1: and each positioning range (mode 'positioning': easeScript, one slow
   *  move from the level before to the first stroke after). */
  bridges = $derived(this.bridgesOn('stroke'));   // paw-x7w7: on the stroke, live in the script (lib/script-of.js)
  bridgesOn(axis) {
    const sc = this.liveScenes(this.posScenes), base = this.app.doc.axes[axis] || [], out = [];   // paw-24b8: an Actions-strip drag's positioning ranges
    const fl = axis === 'stroke' ? this.fills : this.fillsOn(axis), filled = (t0, t1) => fl.some((f) => f.t0 < t1 && f.t1 > t0);
    for (const f of fl) if (f.script.length) out.push({ t0: f.t0, t1: f.t1, script: f.script, mode: 'fill', fill: f.mode });
    const has = (s, t0, t1) => { const k = lowerBound(s, t0); return k < s.length && s[k].at < t1; };
    const src = (i) => { const l = this.sceneLink(i)?.ghost; return has(base, sc[i].start_ms, sc[i].end_ms) || !l || (l.axis ?? 'stroke') !== axis ? base : l.script || []; };
    const linked = (k0, k1) => { for (let k = k0; k <= k1; k++) if (this.sceneLink(k)) return true; return false; };
    // paw-2lp7.4: bridgeRuns = the continuations, one-sided where the action ends at a cut or at the video's edge
    for (const { a, b0, b1, c, internal } of bridgeRuns(sc, SCENE_OPTS)) {
      const t0 = sc[b0].start_ms, t1 = sc[b1].end_ms, A = a >= 0 ? src(a) : [], C = c >= 0 ? src(c) : [];
      if (internal.length || has(base, t0 + 1, t1) || filled(t0, t1)) continue;   // ponytail: a span with an internal view is not bridged at all (its motion is tracked); per-cutaway bridges inside it if mixed spans show up
      const hold = sc.slice(b0, b1 + 1).every(isBlank);
      let script = linked(b0, b1) ? [] : bridgeScript(A, C, t0, t1, { from: a >= 0 ? sc[a].start_ms : t0, to: c >= 0 ? sc[c].end_ms : t1, mode: hold ? 'hold' : 'carry' });
      if (!hold) script = this.#dress(script, [A, C], t0, t1);
      if (script.length) out.push({ t0, t1, script, mode: hold ? 'hold' : 'carry' });
    }
    // the last point of scene i-1 / the first of scene i+1 (their own points or linked run), else null
    const lastOf = (i) => { if (i < 0) return null; const s = src(i), k = lowerBound(s, sc[i].end_ms) - 1; return k >= 0 && s[k].at >= sc[i].start_ms ? s[k].pos : null; };
    const firstOf = (i) => { if (i >= sc.length) return null; const s = src(i), k = lowerBound(s, sc[i].start_ms); return k < s.length && s[k].at < sc[i].end_ms ? s[k].pos : null; };
    const fx = liveFx(this.app.doc.fx), spans = (s) => base.length && base[0].at <= s.start_ms && base[base.length - 1].at >= s.end_ms;
    const pushOf = (s) => fx.find((x) => (x.kind === 'insertion' || x.kind === 'pullout') && x.t0 < s.end_ms && x.t1 > s.start_ms);
    const insertion = (s, before) => {
      const e = pushOf(s), knot = e.kind === 'insertion' ? fx.find((x) => x.kind === 'knotting' && x.t0 < e.t1 && x.t1 > e.t0) : null;
      if (axis === 'stroke' && spans(s)) return [];   // the live modifier does it on the stroke itself (lib/finish.js): not twice
      return insertionScript(s.start_ms, s.end_ms, e.t0, e.t1, { params: e.params, knot: knot ? knot.params ?? {} : null, from: before ?? REST, kind: e.kind });
    };
    const open = (k) => !filled(sc[k].start_ms, sc[k].end_ms) && !has(base, sc[k].start_ms + 1, sc[k].end_ms) && !this.sceneLink(k);
    for (let i = 0; i < sc.length; i++) {
      const s0 = sc[i], st = sceneStructure(s0), blank = isBlank(s0), ins = !blank && !st && !!pushOf(s0);
      if ((!blank && !st && !ins) || !open(i) || out.some((b) => b.t0 <= s0.start_ms && b.t1 >= s0.end_ms)) continue;
      // scenes contain shots: an insertion / structure scene of several shots is generated ONCE over them (one push, one
      // hold); a blank is a shot's own view (held per shot)
      let j = i;
      if (!blank) while (j + 1 < sc.length && sc[j + 1].join === true && !isBlank(sc[j + 1]) && sceneStructure(sc[j + 1]) === st && !!pushOf(sc[j + 1]) === ins && open(j + 1)) j++;
      const s = j > i ? { ...s0, end_ms: sc[j].end_ms } : s0;
      const before = lastOf(i - 1), next = firstOf(j + 1);
      const script = ins ? insertion(s, before) : blank ? (before ?? next) == null ? [] : holdScript(s.start_ms, s.end_ms, { level: before ?? next, end: next })
        : st === 'after' ? afterScript(s.start_ms, s.end_ms)
          : holdScript(s.start_ms, s.end_ms, { start: st === 'intro' ? null : before, level: REST, end: st === 'outro' ? null : next });
      if (script.length) out.push({ t0: s.start_ms, t1: s.end_ms, script, mode: ins ? 'insertion' : blank ? 'hold' : st });
      i = j;
    }
    // paw-2lp7.1: a positioning range (shot.positioning): one slow move from where the script is before it to the first
    // stroke's start after it (the run's own points there are left out: runs-channel.js channelPatch). Only where the axis
    // has no points inside: the owner's points there never change. Neighbours: the shot's points (src), else a visible run
    // ghost over the shot; none before it in the shot: the shot before's last point, none after: the next shot's first
    const own = (i) => { const s = src(i); return has(s, sc[i].start_ms, sc[i].end_ms) ? s : this.ghosts.find((g) => g.source?.kind === 'tracker' && g.visible !== false && (g.axis ?? 'stroke') === axis && has(g.script || [], sc[i].start_ms, sc[i].end_ms))?.script || s; };
    sc.forEach((s, i) => {
      for (const [t0, t1] of s.positioning || []) {
        if (has(base, t0 + 1, t1) || filled(t0, t1) || out.some((b) => b.t0 < t1 && b.t1 > t0)) continue;
        const p = own(i), k = lowerBound(p, t0), j = lowerBound(p, t1);
        const script = easeScript(t0, t1, k > 0 && p[k - 1].at >= s.start_ms ? p[k - 1].pos : lastOf(i - 1), j < p.length && p[j].at < s.end_ms ? p[j].pos : firstOf(i + 1));
        if (script.length) out.push({ t0, t1, script, mode: 'positioning' });
      }
    });
    return out.sort((x, y) => x.t0 - y.t0);
  }
  /** Fills on the stroke axis ($derived, the shots' `fill`): [{lo, hi, a, c, t0, t1, mode, script, need}] per run of shots
   *  with the same fill (lib/scenes-continue.js fillSpans / fillScript), from the script of the shots a / c around the run:
   *  the axis's points there, else its linked run's, else a visible run ghost's. script [] when a side has too few turns
   *  (need) or Accept would change nothing (the fill is in). Points inside the span do not hide it: Accept replaces them. */
  fills = $derived.by(() => this.fillsOn('stroke'));
  /** Generated strokes over [t0, t1] dressed like the points around them (paw-uiu, paw-e82: lib/stroke-shape.js
   *  layoutOf / dressScript): their midpoint / hold layout, where the Detail there allows it. */
  #dress(script, sides, t0, t1, ctx = 10000) {
    if (script.length < 3) return script;
    const near = (s) => s.filter((p) => (p.at >= t0 - ctx && p.at <= t0) || (p.at >= t1 && p.at <= t1 + ctx));
    return dressScript(script, layoutOf(sides.map(near)), shapeAt({ shapes: detailSpans(this.scenes, t0, t1 + 1) }), { minGapMs: STROKES.minIntervalMs });
  }
  /** The fills for `axis` (see fills). 'timing' (paw-b26): its own points are the span's linked run's (else the run
   *  covering it), the signal the owner picked under the run. */
  fillsOn(axis) {
    const sc = this.liveScenes(), base = this.app.doc.axes[axis] || [], clean = cleanMicroOpts(this.app.settings);
    const inS = (s, i) => { const k = lowerBound(s, sc[i].start_ms); return k < s.length && s[k].at < sc[i].end_ms; };
    const src = (i) => {
      if (!sc[i] || inS(base, i)) return base;
      const l = this.sceneLink(i)?.ghost;
      if (l && (l.axis ?? 'stroke') === axis) return l.script || [];
      return this.ghosts.find((g) => g.visible !== false && (g.axis ?? 'stroke') === axis && inS(g.script || [], i))?.script || base;
    };
    const same = (a, b) => a.length === b.length && a.every((p, k) => p.at === b[k].at && p.pos === b[k].pos);
    return fillSpans(sc).map(({ lo, hi, a, c, mode }) => {   // a, c: the nearest shots around that are not filled (paw-sxu)
      const t0 = sc[lo].start_ms, t1 = sc[hi].end_ms;
      const own = mode === 'timing' ? this.#ownPoints(lo, hi, axis) : null;
      let { script, need } = fillScript(src(a), src(c), t0, t1, { mode, from: sc[a]?.start_ms, to: sc[c]?.end_ms, own });
      script = this.#dress(script, [src(a), src(c)], t0, t1);
      if (script.length && same(acceptGhost(base, script, { range: { t0, t1 }, mode: 'replace', clean }).script, base)) script = [];
      return { lo, hi, a, c, t0, t1, mode, script, need };
    });
  }
  /** Shots lo..hi's tracked points on `axis`: each shot's linked run ghost, else the run covering it (deriveRun). */
  #ownPoints(lo, hi, axis) {
    const out = [];
    for (let k = lo; k <= hi; k++) {
      const s = this.scenes[k], l = this.sceneLink(k)?.ghost, r = !l && this.deriveRun(k), g = l || (r && this.ghost(r.id));
      if (!s || !g || (g.axis ?? 'stroke') !== axis) continue;
      for (const p of g.script || []) if (p.at >= s.start_ms && p.at < s.end_ms) out.push(p);
    }
    return out;
  }
  /** script with every fill of `axis` that has something to write (inside [t0, t1) when given) accepted into it, as
   *  Accept does (Flatten bakes them, paw-b26). -> {script, n (fills), ats}. */
  withFills(script, axis = 'stroke', t0 = -Infinity, t1 = Infinity) {
    const clean = cleanMicroOpts(this.app.settings), fs = this.fillsOn(axis).filter((f) => f.script.length && f.t0 < t1 && f.t1 > t0);
    let ats = [];
    for (const f of fs) { const r = acceptGhost(script, f.script, { range: { t0: f.t0, t1: f.t1 }, mode: 'replace', clean }); script = r.script; ats = [...ats, ...r.ats]; }
    return { script, n: fs.length, ats };
  }
  // ---- paw-x7w7: the live script, Bake / Unbake (lib/script-of.js is the rule) ----
  // ---- paw-1ysd: run ranges, which run plays where (lib/run-ranges.js is the rule) ----
  /** The ranges from the shots' links: what a project before ranges played (no selection: what plays on open). */
  #linkRanges = $derived.by(() => fromLinks(this.scenes, (i) => this.sceneLink(i)?.runId || null));
  /** Which run plays where: doc.runRanges, else (a project before ranges) the links' ranges; ranges of a removed run left out. */
  get runRanges() { return this.#runRanges; }
  #runRanges = $derived.by(() => { const d = this.app.doc.runRanges, ids = new Set(this.ghosts.map((g) => g.id)); return liveRanges(d ?? this.#linkRanges, (id) => ids.has(id)); });   // paw-3ga3: once per change, not per shot
  /** Ranges written (one undo step). The first write of a project before ranges starts from the links' ranges. */
  setRanges(next, label = 'Run range') {
    const app = this.app, cur = app.doc.runRanges;
    if (next === cur) return;
    app.transact(label, () => { app.doc.runRanges = next; });
    app.usage?.note('tracking:ranges', { label, n: next.length });
  }
  /** paw-05cg: a project from before ranges with no shots played (and Save / Export / Publish wrote) the run selected in the
   *  Runs list. At open (project.svelte.js #resume, once the selection is back) it gets ranges once from what reopening it
   *  played: runId (the run the resume entry selects) over what it tracked, else nothing; from then on only ranges decide.
   *  Not an undo step and not a change (the output is the same); the next save writes them. */
  adoptOldRanges(runId = '') {
    const d = this.app.doc;
    if (d.runRanges != null || this.scenes.length || !this.ghosts.some((g) => g.source?.kind === 'tracker')) return;
    const ext = runId && this.ghost(runId) && this.runExtent(runId);
    d.runRanges = ext ? putRange([], { run: runId, t0: Math.round(ext.t0), t1: Math.round(ext.t1), layer: 0 }) : [];
  }
  /** The stored list to edit (a project before ranges: its links' ranges, materialised). */
  get #rangesToEdit() { return this.app.doc.runRanges ?? this.#linkRanges; }
  rangeSel = $state('');   // the selected range's id (the strip)
  /** Run id plays over [t0, t1) (trims / splits what was there). -> the new range. */
  useRun(id, t0, t1, label = 'Use run here') {
    if (!this.ghost(id) || !(t1 > t0)) return null;
    const r = { run: id, t0: Math.round(t0), t1: Math.round(t1), layer: 0 }, next = putRange(this.#rangesToEdit, r);
    this.setRanges(next, label);
    return next.find((x) => x.run === id && x.t0 === r.t0 && x.t1 === r.t1) || null;
  }
  /** A range a track or a fill takes: no undo step (the run is none), and folded into every state the history holds
   *  (history.rebase), so undoing an earlier range edit never drops it. Already playing all of it: nothing written. */
  takeRange(id, t0, t1) {
    const r = { run: id, t0: Math.round(t0), t1: Math.round(t1), layer: 0 };
    if (!(r.t1 > r.t0) || playsAll(this.#rangesToEdit, id, r.t0, r.t1)) return;
    this.app.doc.runRanges = putRange(this.#rangesToEdit, r);
    const links = this.#linkRanges;   // a state from before ranges: its links' ranges (as they are now) with this one in
    this.app.history?.rebase?.('runRanges', (v) => putRange(Array.isArray(v) ? v : links, r));
    this.app.history?.markDirty?.();
  }
  /** One end of a range moved (end 0 / 1), never past what its run tracked (its ghost's points). */
  moveRangeEnd(rid, end, t, { label = 'Resize run range' } = {}) {
    const cur = this.#rangesToEdit, r = cur.find((x) => x.id === rid), ext = r && this.runExtent(r.run);
    if (!r || !ext) return;
    this.setRanges(moveEnd(cur, rid, end, t, { lo: ext.t0, hi: ext.t1, minMs: Math.max(1, Math.round(this.app.player?.frameMs || 33)) }), label);
  }
  /** Range rid (or [t0, t1) of it) played the other way round: its run's stretches toggled there (xor; one undo step). */
  invertRange(rid, t0 = null, t1 = null) {
    const R = this.runRanges.find((x) => x.id === rid), r = R && this.run(R.run);
    if (!r?.scenes?.length) { this.app.toast?.('Nothing to invert here', 'quiet'); return null; }
    const a0 = t0 ?? R.t0, b0 = t1 ?? R.t1;
    let list = this.flipsOf(r), any = false;
    for (const s of r.scenes) { const a = Math.max(a0, s.start_ms, r.range.start), b = Math.min(b0, s.end_ms, r.range.end); if (b > a) { list = xorFlips(list, a, b); any = true; } }
    return any ? this.setRunFlips(r.id, list, { label: 'Invert run range' }) : null;
  }
  removeRange(rid) { const cur = this.#rangesToEdit; if (cur.some((x) => x.id === rid)) { this.setRanges(removeRange(cur, rid), 'Remove run range'); if (this.rangeSel === rid) this.rangeSel = ''; } }
  /** What run id tracked: [first point, last point + 1) of its ghost, else its range. */
  runExtent(id) {
    const g = this.ghost(id), s = g?.script;
    if (s?.length) return { t0: s[0].at, t1: s[s.length - 1].at + 1 };
    const r = this.run(id);
    return r ? { t0: r.range.start, t1: r.range.end } : null;
  }
  /** The runs not playing anywhere (no range left): "not in use". */
  get unusedRuns() { const used = new Set(this.runRanges.map((r) => r.run)); return this.runs.filter((r) => !used.has(r.id) && !r.tag); }
  /** The live spans on `axis` (script-of.js liveSpans): the stroke and every axis that has a lane. */
  liveSpansOn(axis) {
    const app = this.app, base = app.doc.axes[axis] || [];
    if (axis !== 'stroke' && !(axis in app.doc.axes)) return [];
    const bridges = axis === 'stroke' ? this.bridges : [], empty = this.#emptyOn(axis);
    // no shots: the ranges over the whole timeline (paw-05cg: never the Runs list's selection; adoptOldRanges)
    const shots = this.#shotsOrWhole(), rr = this.runRanges, gs = this.ghosts;   // paw-3ga3: read once, not per shot
    return liveSpans({ shots, base, runOf: (i) => this.#piecesIn(shots[i], axis, rr, gs), bridges, empty });
  }
  /** paw-q8jh: axis's baked-empty spans (doc.bakedEmpty). */
  #emptyOn(axis) { return (this.app.doc.bakedEmpty || []).filter((m) => m.axis === axis); }
  /** The shots; none: one shot over the whole timeline (the run ranges decide what plays there). */
  #shotsOrWhole() { return this.scenes.length ? this.scenes : [{ start_ms: 0, end_ms: Math.max(this.app.durationMs || 0, ...this.runRanges.map((r) => r.t1)) }]; }
  #piecesIn(s, axis, rr = this.runRanges, gs = this.ghosts) { return rangesIn(rr, s.start_ms, s.end_ms).map((r) => { let g = gs.find((x) => x.id === r.run) || null; if (g && (g.axis ?? 'stroke') !== axis) g = gs.find((x) => isAxesGhost(x) && x.source.runId === g.id && x.axis === axis) || null; return g ? { t0: Math.round(r.a), t1: Math.round(r.b), g } : null; }).filter(Boolean); }   // integer ms, as liveSpans
  #liveMemo = new Map();   // axis -> {base, ck, spans, out}: the same object while the inputs are equal by content
  /** Every axis's live script ($derived): Map axis -> {script, spans} | null. */
  liveAll = $derived.by(() => {
    const m = new Map(), ck = JSON.stringify(cleanMicroOpts(this.app.settings));
    for (const axis of new Set(['stroke', ...Object.keys(this.app.doc.axes)])) {
      const base = this.app.doc.axes[axis] || [], spans = this.liveSpansOn(axis), c = this.#liveMemo.get(axis);
      if (c && c.base === base && c.ck === ck && sameSpans(c.spans, spans)) { m.set(axis, c.out); continue; }
      const r = spans.length ? composeLive(base, spans, JSON.parse(ck)) : null, out = r?.spans.length ? r : null;
      this.#liveMemo.set(axis, { base, ck, spans, out });
      m.set(axis, out);
    }
    return m;
  });
  /** {script, spans} on `axis` | null (nothing live): what app.liveOf / scriptOf read. */
  liveOf(axis = this.app.doc.activeAxis) { return this.liveAll.get(axis) ?? null; }
  /** paw-40ps: shot s's pieces whose run has points there on `axis`: [{t0, t1, run, state: 'baked' (the axis has points in
   *  it, or it is baked empty) | 'live'}]. A project before ranges: one piece, the whole shot. */
  #pieceStates(s, axis, rr = this.runRanges, gs = this.ghosts) {
    const base = this.app.doc.axes[axis] || [], empty = this.#emptyOn(axis);
    return this.#piecesIn(s, axis, rr, gs).filter((x) => hasIn(x.g.script || [], x.t0, x.t1)).map((x) => ({ t0: x.t0, t1: x.t1, run: x.g.id, state: hasIn(base, x.t0, x.t1) || emptyIn(empty, x.t0, x.t1) ? 'baked' : 'live' }));
  }
  /** Shot i on `axis`: 'baked' (the axis has points in it and no piece of it is live), 'live' (a run, fill... plays there),
   *  '' (neither). canUnbake: a piece is baked and its run still has points there. pieces: #pieceStates (the Scenes row
   *  draws each piece's line). */
  bakeState(i, axis = this.app.doc.activeAxis) {
    const s = this.#shotsOrWhole()[i];   // paw-j89h: no shots: 0 = the whole video (as bake / unbake scope it)
    if (!s) return { state: '', canUnbake: false, pieces: [] };
    const base = this.app.doc.axes[axis] || [], pieces = this.#pieceStates(s, axis), run = (pieces[0]?.run ?? this.#piecesIn(s, axis)[0]?.g?.id) || '';
    const canUnbake = pieces.some((p) => p.state === 'baked'), livePiece = pieces.some((p) => p.state === 'live');
    if (!livePiece && (hasIn(base, s.start_ms, s.end_ms) || emptyIn(this.#emptyOn(axis), s.start_ms, s.end_ms))) return { state: 'baked', canUnbake, run, pieces };
    return { state: (this.liveOf(axis)?.spans || []).some((x) => x.t0 < s.end_ms && x.t1 > s.start_ms) ? 'live' : '', canUnbake, run, pieces };
  }
  /** The shots a Bake / Unbake scope names: {shots: [i]} | {run: id} | {all: true} | {range: {t0, t1}} | none = the selected
   *  shots (timeline), else the I/O range, else the shot under the playhead. -> [{t0, t1}] time ranges. */
  #bakeScope(scope = {}) {
    if (scope.all) return [{ t0: -Infinity, t1: Infinity }];
    const sc = this.scenes, of = (ks) => ks.filter((k) => sc[k]).map((k) => ({ t0: sc[k].start_ms, t1: sc[k].end_ms }));
    if (Array.isArray(scope.shots)) return of(scope.shots);
    if (scope.range?.t1 > scope.range?.t0) return [scope.range];
    if (scope.run) return null;   // by run id (below)
    const tl = tlFor(this.app);
    if (tl.shots?.length) return of(tl.shots);
    const r = this.app.doc.range;
    if (r?.t1 > r?.t0) return [r];
    const k = sceneAt(sc, this.app.player.timeMs);
    return k >= 0 ? of([k]) : sc.length ? [] : [{ t0: -Infinity, t1: Infinity }];
  }
  /** Bake: the live points in scope become permanent (doc.axes, what Accept wrote before), on every axis, one undo step.
   *  -> the number of live spans baked. */
  bake(scope = {}) {
    this.dropPreviews();   // paw-cfaz
    const app = this.app, ranges = this.#bakeScope(scope), axes = [...new Set(['stroke', ...Object.keys(app.doc.axes)])], writes = [];
    const hit = (s) => (ranges ? ranges.some((r) => s.t0 < r.t1 && s.t1 > r.t0) : s.id === scope.run || s.id?.startsWith(scope.run + '~'));
    for (const axis of axes) {
      const live = this.liveOf(axis), spans = (live?.spans || []).filter(hit), base = app.doc.axes[axis] || [];
      const next = bakeSpans(base, live, spans);
      if (next !== base) writes.push([axis, next, spans]);
    }
    if (!writes.length) { app.toast?.('Nothing live to bake here', 'quiet'); return 0; }
    // paw-vhcd: counted in shots (one shot carried by three run pieces is one shot), else in spans
    const all = writes.flatMap((w) => w[2]), n = all.length, inShots = !!this.scenes.length && all.every((s) => s.shot >= 0);   // paw-40ps: no shots: spans
    const units = inShots ? [...new Set(all.map((s) => s.shot))] : [...new Set(all.map((s) => s.t0))];
    const what = scope.all ? 'the script' : scope.run ? (this.ghost(scope.run)?.name || 'the run') : inShots && units.length === 1 ? `shot ${shotLabel(this.scenes, units[0])}` : `${units.length} ${inShots ? 'shot' : 'span'}${units.length === 1 ? '' : 's'}`;
    app.transact(`Bake ${what}`, () => { for (const [axis, next] of writes) app.doc.axes = { ...app.doc.axes, [axis]: next }; });
    app.usage?.note('tracking:bake', { spans: n, axes: writes.map((w) => w[0]).join(','), scope: scope.all ? 'all' : scope.run ? 'run' : 'shots' });
    return n;
  }
  /** Unbake: the baked points of the pieces in scope go where their run still has points, so the run plays there live
   *  again (paw-40ps: per piece; a project before ranges: per shot); one undo step. -> the number of shots unbaked. */
  unbake(scope = {}) {
    const app = this.app, ranges = this.#bakeScope(scope), writes = [], ks = new Set();
    let empty = app.doc.bakedEmpty || [];
    for (const axis of [...new Set(['stroke', ...Object.keys(app.doc.axes)])]) {
      const spans = [], base = app.doc.axes[axis] || [], rr = this.runRanges, gs = this.ghosts;
      this.#shotsOrWhole().forEach((s, k) => {
        for (const p of this.#pieceStates(s, axis, rr, gs)) {
          const inScope = ranges ? ranges.some((r) => p.t0 < r.t1 && p.t1 > r.t0) : p.run === scope.run || p.run.startsWith(scope.run + '~');
          if (inScope && p.state === 'baked') { spans.push(p); ks.add(k); }
        }
      });
      const next = unbakeRanges(base, spans);
      if (next !== base) writes.push([axis, next]);
      empty = unmarkEmpty(empty, axis, spans);   // paw-q8jh: a piece baked empty plays its run again
    }
    const dropEmpty = empty !== (app.doc.bakedEmpty || []);
    if (!writes.length && !dropEmpty) { app.toast?.('No baked shot with a run here', 'quiet'); return 0; }
    const k0 = [...ks][0];
    app.transact(`Unbake ${!this.scenes.length ? 'the script' : ks.size === 1 ? `shot ${shotLabel(this.scenes, k0)}` : `${ks.size} shots`}`, () => { for (const [axis, next] of writes) app.doc.axes = { ...app.doc.axes, [axis]: next }; if (dropEmpty) app.doc.bakedEmpty = empty; });
    app.usage?.note('tracking:unbake', { shots: ks.size, axes: writes.map((w) => w[0]).join(',') });
    return ks.size;
  }

  // ---- internal views track with SAM area (lib/scenes-continue.js defaultTrackerFor) ----
  pickedFor = $state.raw(new Set());   // start_ms of scenes the user picked a tracker for (session): no internal default there
  #autoFrom = null;                    // the tracker an internal-view default replaced (back to it after the scene)
  /** The internal-view default for the range: {tracker, params, label, box} when the range is inside one internal-view
   *  scene the user picked no tracker for and sam2_mask is installed; else null. */
  get internalPlan() {
    const sp = this.span, s = this.scenes[sceneAt(this.scenes, sp.t0)];
    if (!s || sp.t0 < s.start_ms || sp.t1 > s.end_ms || this.pickedFor.has(s.start_ms)) return null;
    const d = defaultTrackerFor(s, { internal: isInternal });
    return d && this.trackers.some((t) => t.id === d.tracker) ? d : null;
  }
  /** The tracker the user picked (an internal-view auto pick does not count): what Track tagged scenes uses for the action scenes. */
  get userTrackerId() { return this.#autoFrom ?? this.trackerId; }
  #autoPick(plan, id) {
    if (plan && id !== plan.tracker) {
      this.#autoFrom = id; this.selectTracker(plan.tracker, false);
      this.notice = `Internal view: ${plan.label} (more mask pixels = deeper)${plan.box ? ', box from describe' : ': paint the inserted part with Groups (Tab), then Track ROI'}. Pick another tracker to override.`;
    } else if (!plan && this.#autoFrom != null && id === INTERNAL_TRACK.tracker) { const back = this.#autoFrom; this.#autoFrom = null; this.selectTracker(back, false); }
  }

  toggleBox(i, tag) { const k = i + ':' + tag; this.shownBoxes = { ...this.shownBoxes, [k]: !this.shownBoxes[k] }; }

  // ---- tracking ----
  /** over: params that win over the panel's for this run only (gridFrame). */
  // ---- track direction (paw-bh2, direction.js; sidecar v4.15): both / forward / backward from the seed frame ----
  get direction() { const d = this.app.settings.get('tracking.direction', 'both'); return DIRECTIONS.includes(d) ? d : 'both'; }
  setDirection(d) { if (DIRECTIONS.includes(d)) this.app.settings.set('tracking.direction', d); }
  trackJob = $state.raw(null);     // {dir, seed, t0, t1} while a one-way track runs (the lane's band grows from the seed)
  /** Track in direction d (commands track.forward / backward / both): the panel's Track with that direction. */
  trackDir(d) { this.setDirection(d); return this.track(); }
  /** One-way Track: the seed = the frame the ROI was drawn on, else the playhead; the span from direction.js (an I / O
   *  range, or a selection of two shots or more, is the owner's limit). */
  async #trackOneWay(t, dir, roi, params, replace = false) {
    const app = this.app, seed = Math.round(roi?.t_ms ?? app.player.timeMs);
    const tl = tlFor(app), sel = tl.shots.length > 1 ? selectionSpan(this.scenes, tl.shots) : null, r = app.doc.range ? { t0: app.doc.range.t0, t1: app.doc.range.t1 } : sel;
    const sp = directionSpan(this.scenes, seed, dir, { range: r, duration: app.durationMs });
    // sidecar v4.22: every tracker runs backward (the video played in reverse from the seed); before, only the points trackers
    if (!(sp.t1 - sp.t0 > 2 * (app.player.frameMs || 33))) { this.notice = `Nothing to track ${dir} from ${(seed / 1000).toFixed(2)} s inside the limits.`; return; }
    this.trackJob = { dir, seed, t0: sp.t0, t1: sp.t1 };
    let res;
    try {
      res = await this.runTrack(t, { start: sp.t0, end: sp.t1 }, params, roi ? { ...roi, t_ms: seed } : roi, this.spansFor(sp.t0, sp.t1), { scenes: this.scenesMode, direction: dir, seed, replace, take: replace });
    } finally { this.trackJob = null; }
    if (res.moved) return;
    if (res.cancelled) { this.notice = 'Track cancelled.'; return; }
    if (res.error) { this.error = 'Tracking failed: ' + res.error; return; }
    const run = res.run, lost = run.notes?.find((n) => n.code === 'lost');
    this.selectedId = run.id;
    this.notice = `Run ${run.n}: ${dir} from ${(seed / 1000).toFixed(2)} s, ${((run.range.end - run.range.start) / 1000).toFixed(1)} s tracked${lost ? ' (stopped where the points were lost)' : ''}.`;
    // the cuts it tracked through: offered as camera moves (the same take), never applied silently
    const crossed = sp.crossed.filter((i) => this.scenes[i] && this.scenes[i].start_ms > run.range.start && this.scenes[i].start_ms < run.range.end);
    if (crossed.length) {
      const at = crossed.map((i) => (this.scenes[i].start_ms / 1000).toFixed(1) + ' s').join(', ');
      app.toast(`Tracked through the cut${crossed.length > 1 ? 's' : ''} at ${at}: one take for this run. Make ${crossed.length > 1 ? 'them camera moves' : 'it a camera move'} (same scene, tracked through)?`, 'info',
        { timeout: 0, action: { label: 'Camera move', run: () => this.markCameraMoves(crossed) } });
    }
  }
  /** The cuts before shots `idx` become camera moves (their shots join the scene before them): one undo step. -> done. */
  markCameraMoves(idx) {
    let list = this.scenes;
    for (const i of [...idx].sort((a, b) => b - a)) {
      if (!list[i] || i < 1) continue;
      if (list[i].join !== true) list = joinSelected(list, [i - 1, i]) || list;
      list = setTake(list, i, true) || list;
    }
    if (list === this.scenes) return false;
    this.app.transact('Cuts tracked through: camera moves', () => { this.app.doc.scenes = list; });
    this.app.usage?.note('tracking:cameraMoves', { n: idx.length });
    return true;
  }
  /** full: a new run of everything (the command track.full), never only the groups painted since (addPlan). */
  async track(over = {}, { full = false, beside = false } = {}) {
    // Esc then T (or T while a background score runs): wait for that job to end instead of dropping the new run
    // (or T during a camera check: drop the check, the new run gets its own)
    if (this.busy === 'camera' && !this.owner) this.cancelOwner('');
    if (this.#seederBusy) this.cancelOwner('seeder');   // its features so far are cached: the next save resumes
    if (this.stopping || this.busy === 'score' || this.busy === 'camera' || this.busy === 'seed') await this.chain;
    if (!this.canTrack) return;
    const add = !full && !beside && this.direction === 'both' && !Object.keys(over).length ? this.addPlan() : null;
    if (add) return this.#trackAdded(add);
    if (this.direction !== 'both') {
      const t = this.tracker, roi = t.roi === 'none' ? null : this.trackRoi, plan = this.internalPlan?.tracker === t.id ? this.internalPlan : null;
      this.error = ''; this.notice = ''; this.roi = null;
      this.app.usage?.note('tracking:track', this.tracker.id);
      return this.#trackOneWay(t, this.direction, roi, this.withAxis(t, { ...$state.snapshot(this.params), ...plan?.params, ...over }), !beside);
    }
    this.app.usage?.note('tracking:track', this.tracker.id);
    const t = this.tracker, s = this.span, range = { start: s.t0, end: s.t1 }, roi = t.roi === 'none' ? null : this.trackRoi, plan = this.internalPlan?.tracker === t.id ? this.internalPlan : null;
    this.error = ''; this.notice = '';
    this.roi = null;   // the box belongs to this run now (run.roi)
    // a range over an off-screen scene: that scene is left out (no run spans it, the bridge fills it); the action pieces
    // around it run one by one with the panel's tracker (lib/track-plan.js, panelOnly). Scenes mode 'one': as drawn.
    if (this.scenesMode !== 'one') {
      const items = this.plan({ range: { t0: s.t0, t1: s.t1 }, force: true, panelOnly: true });
      const skipped = items.filter((x) => x.action === 'skip');
      if (skipped.length) {
        const work = items.filter((x) => x.action === 'track').map((x) => ({ ...x, tracker: t.id, roi, params: { ...plan?.params, ...over } }));
        const what = skipped.map((x) => `${x.label} (${x.reason.split(':')[0]})`).join(', ');
        if (!work.length) { this.notice = `Nothing tracked: ${what} is generated from the neighbours. Remove that tag or fill to track it.`; this.app.toast(this.notice, 'quiet'); return; }
        this.app.toast(`Left out ${what}: generated from the neighbors`, 'quiet');
        const res = await this.runPlan(work, { title: TITLES.track });
        if (!res) return;
        if (res.made.length) this.selectedId = res.made[res.made.length - 1].id;
        this.notice = `${res.made.length} of ${res.total} piece${res.total === 1 ? '' : 's'} tracked · ${what} left out${res.stopped ? ' · stopped' : ''}.`;
        return;
      }
    }
    const r = await this.runTrack(t, range, this.withAxis(t, { ...$state.snapshot(this.params), ...plan?.params, ...over }), roi, this.spansFor(range.start, range.end), { scenes: this.scenesMode, name: plan?.label, replace: !beside, take: !beside });
    if (r.moved) return;
    if (r.cancelled) { this.notice = 'Track cancelled.'; return; }
    if (r.error) { this.error = 'Tracking failed: ' + r.error; return; }
    this.selectedId = r.run.id;
    this.notice = `Run ${r.run.n}: ${runSummary(this.run(r.run.id) || r.run)} (${r.run.samples.t.length} samples).`;   // paw-kv4y: as composed, not as it arrived
  }
  /** Grid -- a point grid over the whole picture (settings 'tracking.gridPoints'), offline,
   *  through the panel's Track (range, spans, ghost, overlays). Selects the tracker and sets the whole-frame box. */
  get canGrid() { return !!(this.videoPath && this.gridTracker && (!this.locked || this.preempt) && this.span.t1 > this.span.t0); }
  /** The point tracker a grid run uses: the selected one if it is one, else TAPNext++ (paw-vdr4: never CoTracker3 by default).
   *  paw-l64q: none the GPU state turns off (it would run on the CPU at under a frame a second): then null, and T says why
   *  and names the CPU route (quickbar.js gridBlock). */
  get gridTracker() {
    const ok = (t) => (t && !this.gpuOff(t) ? t : null);
    return ok(GRID_TRACKERS.has(this.tracker?.id) && this.tracker) || ok(this.trackers.find((x) => x.id === 'tapnext_points'));
  }
  gridFrame({ beside = false } = {}) {
    if (!this.canGrid) return;
    this.app.usage?.note('tracking:gridFrame');
    const t = this.gridTracker;
    this.selectTracker(t.id);
    this.roi = { kind: 'box', x: 0, y: 0, w: 1, h: 1 };
    const n = Math.round(+this.app.settings.get('tracking.gridPoints', 512)) || 512;
    return this.track({ box_seed: 'grid', box_points: Math.min(4096, Math.max(4, n)), ...(t.id === 'cotracker_points' ? { mode: 'offline' } : {}) }, { beside });
  }
  /** paw-x8we Track ROI: one painted part (name) in the range, over the shot its seed is on. The tracker: roi-part.js roiTracker
   *  (SAM by default: its painted mask seeds it, the run's signal is the part's size against the seed frame); the box any tracker
   *  needs is the painting's bounds. Lands as the grid's run does: takes the range it covers, replaces a run of the same family
   *  left with none, selected. -> the run | undefined. */
  async trackPart(name) {
    if (this.busy === 'camera' && !this.owner) this.cancelOwner('');
    if (this.#seederBusy) this.cancelOwner('seeder');
    if (this.stopping || this.busy === 'score' || this.busy === 'camera' || this.busy === 'seed') await this.chain;
    if (!this.canPart) return;
    const s = this.span, p = paintedParts(this.scenes, s.t0, s.t1).find((x) => x.name === name);
    if (!p) { this.app.toast(`${partLabel(name)} is not painted in the range`, 'quiet'); return; }
    const t = roiTracker(this.trackers, this.trackerId, (x) => this.gpuOff(x));
    if (!t) { this.app.toast(`No tracker installed takes a part${this.gpuNote ? ` (${this.gpuNote})` : ''}`, 'warn'); return; }
    const range = partRange(this.scenes, p.group.t_ms, s), roi = { ...partBox(p.group.poly), t_ms: p.group.t_ms };
    if (!(range.end > range.start)) return;
    const sc = this.scenes.find((x) => p.group.t_ms >= x.start_ms && p.group.t_ms < x.end_ms);
    if (sc) this.lastPart.set(sc.start_ms, name);
    const plan = this.internalPlan?.tracker === t.id ? this.internalPlan : null, seeds = t.id === 'sam2_mask' || t.params?.some((x) => x.key === 'sem_groups');
    this.error = ''; this.notice = ''; this.roi = null;
    this.app.usage?.note('tracking:trackPart', { tracker: t.id, part: name });
    const r = await this.runTrack(t, range, this.withAxis(t, { ...$state.snapshot(this.paramsBy[t.id] || {}), ...plan?.params }), roi, this.spansFor(range.start, range.end),
      { scenes: this.scenesMode, name: `${partLabel(name)} · ${t.id === 'sam2_mask' ? 'SAM' : t.name.split(/\s*[(:]/)[0]}`, groups: seeds ? [p.group] : [], replace: true, take: true });
    if (r.moved) return;
    if (r.cancelled) { this.notice = 'Track cancelled.'; return; }
    if (r.error) { this.error = 'Tracking failed: ' + r.error; return; }
    this.selectedId = r.run.id;
    this.notice = `Run ${r.run.n}: ${partLabel(name)}, ${runSummary(this.run(r.run.id) || r.run)}.`;
    return r.run;
  }
  /**
   * Programmatic track (api.js trackRange): tracker id, range {t0,t1}, roi, params (sparse: the sidecar fills the
   * defaults), spans [{start_ms,end_ms,state}]. Leaves the panel's tracker / range / ROI / params / span labels and
   * selection alone; the run is kept and shown as a ghost like any other. -> {run} | {error} | {cancelled}.
   * Cancel: the job's status-bar task, or cancel(). tag (a string) goes into the ghost's source, so the caller can
   * tell its own runs from the user's later. owner: see job(). scenes: document | detect | one (default: the panel's setting).
   */
  async trackRange({ tracker, range, roi = null, params = {}, spans = [], tag = '', owner = '', scenes = this.scenesMode }) {
    let t = this.trackers.find((x) => x.id === tracker);
    if (!t && tracker === 'cotracker_points' && this.listed) {   // paw-vdr4: CoTracker3 not installed: TAPNext++ (its own params only)
      const f = trackerFor(this.trackers.filter((x) => !this.gpuOff(x)), tracker);
      t = this.trackers.find((x) => x.id === f.id);
      if (t) { this.#fellBack(f.note); params = Object.fromEntries(Object.entries(params).filter(([k]) => t.params?.some((p) => p.key === k))); }
    }
    if (!this.videoPath) return { error: 'Open a video first.' };
    if (!t) return { error: 'Unknown tracker ' + tracker + '.' };
    if (!(range?.t1 > range?.t0)) return { error: 'Empty range.' };
    if (!roiOk(t.roi, roi)) return { error: `Tracker ${t.id} needs a ${t.roi} ROI.` };
    const a = Math.round(range.t0), b = Math.round(range.t1);
    const p = { ...axisParams(t.params, this.axisMode, this.axis, params, this.aspect), ...params };   // the caller's params win
    const r = await this.runTrack(t, { start: a, end: b }, p, t.roi === 'none' ? null : roi, spansForRequest(spans, a, b), { tag, owner, scenes });
    return r.moved ? { error: 'The video changed.' } : r;
  }
  /** describe tags (strong ones, from the scenes' describe results) of the scenes the range touches: enables sidecar knot events. */
  rangeTags(range) {
    return [...new Set(this.scenes.filter((s) => s.start_ms < range.end && s.end_ms > range.start).flatMap((s) => (s.describe?.tags || []).map((x) => x.tag)))];
  }
  async runTrack(t, range, params, roi, spans, { tag = '', owner = '', label = 'track', visible = true, check = true, scenes = 'detect', name = '', task = true, onEvent = null, quiet = false, direction = 'both', seed = null, groups: own = null, mod = null, replace = false, take = true } = {}) {
    const app = this.app, path = this.videoPath, frames = newFrames(), began = Date.now();
    const defs = { ...defaultParams(this.sceneParams || []), ...defaultParams(t.params || []) }, diff = Object.fromEntries(Object.entries(params || {}).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(defs[k])));
    app.usage?.note('tracking:runStart', { tracker: t.id, label, t0: Math.round(range.start), t1: Math.round(range.end), scenes, roi: roi?.kind || null, tag: tag || undefined, owner: owner || undefined, name: name || undefined, params: JSON.stringify(diff).slice(0, 400), ...(direction !== 'both' ? { direction, seed } : {}) });
    this.live = { frames, roi };
    app.player.pause();
    // the owner's groups (Groups tool, groups.js) of the scenes in range: the points trackers pin them instead of the tagger's;
    // a take after a hard cut inside a scene with groups drawn elsewhere first gets them re-found (v4.13, unconfirmed)
    const pins = t.params?.some((x) => x.key === 'sem_groups');
    if (pins && !tag) await this.refindGroups(range.start, range.end, { owner });
    if (this.videoPath !== path) return { moved: true };
    const all = own ?? (pins || t.id === 'sam2_mask' ? trackGroups(this.scenes, range.start, range.end) : []);   // own: a modifier's painted seed (paw-ef73.26)
    const oneWay = direction === 'forward' || direction === 'backward';
    // a one-way run tracks through every cut in its span (v4.15: soft); no document scenes: one scene
    const cuts = oneWay ? (scenes === 'one' ? [] : throughCuts(trackCuts('document', this.scenes, range.start, range.end))) : trackCuts(scenes, this.scenes, range.start, range.end);
    // paw-o74b: groups painted on several frames of one take: the run seeds on each take's earliest of them, the others are
    // tracked from their own frames afterwards (groups only, both ways) and merged into it (#addGroups)
    const hard = (cuts ?? trackCuts('document', this.scenes, range.start, range.end) ?? []).filter((c) => c.kind === 'hard').map((c) => c.t_ms);
    const { main: groups, later } = !own && pins && !oneWay ? splitSeeds(all, hard) : { main: all, later: [] };
    const follow = stageFollow(app.player);   // paw-rxr3: the shaft pass shows its frames, the playhead comes back after
    const parked = app.player.timeMs;
    let followed = null;   // paw-d8eo: where the frame follow last put the playhead
    // paw-qoo5: a Track over exactly the selected action region's span is that region's run: its tags go to the tracker beside the
    // describe's (before, a shot's facts came from the action at its middle) and stay on the run (run.act)
    const sa = !tag && !mod ? (app.doc.acts || []).find((x) => x.id === tlFor(app).act && x.kind === 'act') : null;
    const act = sa && Math.abs(sa.t0 - range.start) < 1 && Math.abs(Math.min(sa.t1, app.durationMs || Infinity) - range.end) < 1 ? sa : null;
    const tags = act ? [...new Set([...this.rangeTags(range), ...act.tags])] : this.rangeTags(range);
    const r = await this.job(label, trackRequest({ video: path, tracker: t.id, start_ms: range.start, end_ms: range.end, roi, params, spans, tags, cuts, groups, direction, seed_ms: seed }), {
      owner, range: { t0: range.start, t1: range.end }, task, title: label === 'track' && !tag && !mod ? `${TITLES.track} ${spanText(this.scenes, range.start, range.end)}` : undefined, onEvent: (e) => { if (this.path === path) follow.event(e); onEvent?.(e); },
      onFrames: (batch) => {
        if (this.path !== path) return;
        appendFrames(frames, batch);
        this.tick++;
        // follow the tracker: show the frame it is looking at (paused video, one seek at a time)
        if (!app.player.playing && !app.player.el?.seeking) app.player.seek((followed = batch[batch.length - 1].t_ms));
      },
    });
    if (this.path !== path) return { moved: true };
    follow.end();   // a cancel / error / the result in the middle of the pass: back where the owner was
    // paw-d8eo: and the frame follow's walk undone (unless the video plays, or the owner took the playhead out of the span)
    const fmF = app.player.frameMs || 1000 / 30, atF = app.player.timeMs;
    if (followed != null && !app.player.playing && atF >= range.start - fmF && atF <= range.end + fmF) app.player.seek(parked);
    this.live = null;
    if (r.cancelled || r.error) app.usage?.note('tracking:runEnd', { tracker: t.id, ms: Date.now() - began, ...(r.cancelled ? { cancelled: true } : { error: String(r.error).slice(0, 200) }) });
    if (r.cancelled) return { cancelled: true };
    if (r.error) return { error: r.error };
    let run = makeRun({ n: this.nextRunNumber(), tracker: t, params, range, roi, result: r.result, frames, runs: [{ color: PALETTE[0] }, ...this.ghosts] });   // PALETTE[0] is the editor's own script colour
    this.runSeq = Math.max(this.runSeq, run.n);   // paw-1fd3: its number is taken for good
    if (tag) run.tag = tag;
    if (name) run.name = name;
    if (act) run.act = { id: act.id, tags: [...act.tags] };   // paw-qoo5 (saved in the .pawruns as any other key)
    if (mod) Object.assign(run, mod);   // paw-ef73.26: a modifier's own run {mod, seeds, modGroups}
    if (pins && !own && groups.length) run.groupSeeds = seedsOf(groups);   // paw-o74b: what it seeded (name, frame, outline): Track later adds only what is new
    if (oneWay) {   // the seed and the span it really covers (the sidecar stops where the points are lost)
      run.seedMs = seed; run.direction = direction;
      const st = run.samples.t, fm = app.player.frameMs || 1000 / 30;
      if (st.length) run.range = { start: Math.max(range.start, st[0]), end: Math.min(range.end, st[st.length - 1] + fm) };
    }   // 'SAM · area': what drove an internal-view run
    run.lowMotion = lowMotion(run, app.doc.media || {});
    this.runs = [...this.runs, run];
    this.app.doc.ghosts = [...this.ghosts.filter((g) => g.id !== run.id), this.ghostOf(run, visible)];
    if (!tag && !mod) this.#arrive(run);   // paw-lji3 / paw-83sq: Smart stroke on, a re-track's shot settings carried over
    // paw-l3ec: the panel's Track over the span of an earlier run of the same tracker family replaces it (its settings were
    // carried over just above), through the normal discard (the next write checkpoints before it); Track as a new run keeps it
    // paw-1ysd: a track takes the range it covered (trimming / splitting what played there; Track as a new run takes none). An
    // earlier run of the same tracker family over that span is discarded only when it has no range left (06d8bc1's replace);
    // any other run stays, playing wherever its range is left (none: listed as not in use)
    // (no undo step, as the run itself: a track is never one)
    if (!tag && !mod && take) this.takeRange(run.id, run.range.start, run.range.end);
    const playing = new Set(this.runRanges.map((x) => x.run));
    const gone = replace && !tag && !mod && app.settings.get('tracking.retrackKeep') !== true ? replacedBy(run, this.runs, app.player.frameMs || 1000 / 30).filter((id) => !playing.has(id)) : [];
    if (gone.length) { for (const id of gone) this.remove(id); this.patchGhost(run.id, { name: this.titleOf(run) }); }
    if (!tag && !mod) deriveAxes(app, this, [run.id]);   // paw-2pcf: its secondary axes, ghosts on their lanes
    const dirNote = check && !tag ? this.#repeatDirection(run) : '';   // the owner's own runs only (never a tagged / internal one)
    if (dirNote) run = this.run(run.id);
    const decs = decisionsOf(run.notes);
    app.usage?.note('tracking:runEnd', { tracker: t.id, run: run.id, title: this.titleOf(run), ms: Date.now() - began, points: run.points.at.length,
      picked: decs.map((d) => d?.chosen ?? null).join(','), candidates: decs.map((d) => Object.keys(d?.candidates || {}).length).join(','), lowMotion: !!run.lowMotion?.low });
    this.#cameraDefaults(run);
    app.history?.markDirty?.();   // a new run is unsaved work: Save writes it to the .pawruns
    this.runsDirty = true;
    if (later.length) {   // paw-o74b: the groups seeded on later frames of their take, each from its own frame
      const a = await this.#addGroups(run, later, { owner });
      if (a.moved) return { moved: true };
      run = this.run(run.id) || run;
      if (a.failed || a.cancelled) app.toast(`${this.titleOf(run)}: ${a.cancelled ? 'cancelled' : 'failed'} adding the groups painted on later frames (${later.map((g) => partLabel(g.name)).join(', ')})${a.failed ? ': ' + a.failed : ''}; T adds them`, 'warn');
    }
    this.scoreGhost(run.id);
    if (check) {
      run = this.run(run.id) || run;   // paw-kv4y: its points as composed on arrival (Smart stroke's fused stroke), not the sidecar's primary
      const lm = run.lowMotion?.low ? ` · almost no motion (${run.lowMotion.px.toFixed(1)} px): do not trust it` : '';
      const swap = gone.length ? ` · replaces the earlier run (Track menu: Track as a new run keeps both)` : '';
      if (!quiet || lm || dirNote) app.toast(`${this.titleOf(run)} (${run.name}): ${runSummary(run)}${swap}${dirNote}${lm}`, lm ? 'warn' : 'ok');
      if (!wholeFrame(run)) this.checkCamera(run.id, { owner });
    }
    return { run };
  }
  // ---- paw-o74b: groups painted later on an already tracked shot ("the second seed", lib/runs-add.js) ----
  /** Runs groups can be added to: points runs with stored frames and a camera path (this session's or the .pawruns'), not
   *  restored, tagged, a modifier's or the reference. */
  get #addable() {
    const pts = (id) => !!this.trackers.find((x) => x.id === id)?.params?.some((p) => p.key === 'sem_groups');
    return this.runs.filter((r) => !r.restored && !r.tag && !r.mod && !r.ref && r.frames?.t?.length && r.channels?.cam_x && r.scenes?.length && pts(r.tracker));
  }
  /** The run a group seeded at t goes into: the selected run, else the one linked to the shot there, else the newest one, covering t. */
  #runAt(t, list) {
    const on = (r) => r && t >= r.range.start && t < r.range.end;
    const l = this.links[linkFor(this.links, this.scenes[sceneAt(this.scenes, t)] || { start_ms: t, end_ms: t + 1 })];
    return [list.find((r) => r.id === this.selectedId), l && list.find((r) => r.id === l.run), ...[...list].reverse()].find(on) || null;
  }
  /**
   * What Track over span adds instead of a new run: {items: [{run, groups}], n} when every group painted there is in a run
   * covering its frame except some new ones (lib/runs-add.js newForRun: not in that run; none changed), and those runs
   * cover span; else null (Track makes a new run, as before). Points trackers only.
   */
  addPlan(span = this.span) {
    if (!this.tracker?.params?.some((x) => x.key === 'sem_groups')) return null;
    const groups = trackGroups(this.scenes, span.t0, span.t1), list = this.#addable;
    if (!groups.length || !list.length) return null;
    const by = new Map();
    for (const g of groups) {
      const r = this.#runAt(g.t_ms, list), st = r ? newForRun([g], r) : null;
      if (!r || st.changed.length) return null;
      if (st.fresh.length) { if (!by.has(r.id)) by.set(r.id, { run: r, groups: [] }); by.get(r.id).groups.push(g); }
    }
    if (!by.size) return null;
    const tol = 3 * (this.app.player.frameMs || 1000 / 30);
    let cur = span.t0;
    for (const r of list.filter((x) => x.range.end > span.t0 && x.range.start < span.t1).sort((a, b) => a.range.start - b.range.start)) if (r.range.start <= cur + tol) cur = Math.max(cur, r.range.end);
    if (cur < span.t1 - tol) return null;
    const items = [...by.values()];
    return { items, n: items.reduce((s, x) => s + x.groups.length, 0) };
  }
  /** Track only the new groups (addPlan) and merge them into their runs; a failed or cancelled add leaves its run as it was. */
  async #trackAdded(plan) {
    const app = this.app;
    this.error = ''; this.notice = '';
    app.usage?.note('tracking:trackAdded', { runs: plan.items.length, groups: plan.n });
    const names = [], fails = [], again = [];
    let last = null, stopped = false;
    for (const it of plan.items) {
      const r = await this.#addGroups(it.run, it.groups);
      if (r.moved) return;
      names.push(...(r.added || [])); again.push(...(r.again || []));
      if (r.added?.length) last = r.run;
      if (r.failed) fails.push(r.failed);
      if (r.cancelled) { stopped = true; break; }
    }
    if (last) this.selectedId = last.id;
    const re = new Set(again.map((a) => a.name)), grid = gridOf(app.player);
    const what = [...new Set(names)].map((n) => (re.has(n) ? `${partLabel(n)} (re-anchored at frame ${again.filter((a) => a.name === n).map((a) => frameAt(a.t_ms, grid)).join(', ')}: one part, stitched)` : partLabel(n))).join(', ');
    this.notice = names.length ? `Added ${what} to ${last ? this.titleOf(last) : 'the run'}: tracked from ${names.length === 1 ? 'its' : 'their'} own frame both ways, the rest of the run unchanged${stopped ? ' · stopped' : ''}.` : stopped ? 'Track cancelled: the run is as it was.' : '';
    if (fails.length) this.error = 'Adding the groups failed: ' + fails.join('; ') + ' (the run is as it was)';
    if (names.length) app.toast(this.notice, 'ok');
  }
  /** paw-o74b.1: the seeds the document has in run's range (seedKey): what its multi-seed parts are stitched from. */
  #activeSeeds(run) { return new Set(trackGroups(this.scenes, run.range.start, run.range.end).map((g) => seedKey(g.name, g.t_ms, groupFp(g)))); }
  /** paw-o74b.1: the runs' multi-seed parts follow the seeds the document has: a seed deleted or hidden in the Groups tool
   *  (or brought back by an undo) re-stitches the part from the tracks the run keeps (lib/runs-add.js restitch), no tracking. */
  restitchSeeds() {
    const fm = this.app.player.frameMs || 1000 / 30;
    for (const r of this.runs) {
      if (r.restored || !r.groupSeeds?.some?.((s) => s?.track)) continue;
      const p = restitch(r, this.#activeSeeds(r), { aspect: this.aspect, frameMs: fm });
      if (!p) continue;
      this.patchRun(r.id, p);
      this.#recompose(r.id);
      deriveAxes(this.app, this, [r.id]);
      this.app.usage?.note('tracking:restitch', { run: r.id });
    }
  }
  /** Track groups (one sidecar call per run scene and seed frame: v4.45 groups_only over that run scene) and merge each into
   *  run (lib/runs-add.js mergeAdded; a part the run has: another seed, stitched). -> {run, added: [names], again: [names
   *  re-anchored], failed, cancelled} | {moved}. */
  async #addGroups(run0, groups, { owner = '' } = {}) {
    const app = this.app, path = this.videoPath, t = this.trackers.find((x) => x.id === run0.tracker), fm = app.player.frameMs || 1000 / 30;
    const home = app.player.timeMs;   // the calls show the frames they track; the playhead comes back after (as a full Track's does)
    if (!t) return { run: run0, added: [], failed: `${run0.tracker} is not installed` };
    const by = new Map();
    for (const g of [...groups].sort((a, b) => a.t_ms - b.t_ms)) {   // in time order: a part's seeds join it one by one
      const k = sceneAt(run0.scenes || [], g.t_ms), key = `${k}:${Math.round(g.t_ms)}`;
      if (!by.has(key)) by.set(key, { k, t_ms: Math.round(g.t_ms), groups: [] });
      by.get(key).groups.push(g);
    }
    let run = run0, failed = '';
    const added = [], again = [];
    for (const b of by.values()) {
      const sc = run.scenes, a = Math.round(Math.max(run.range.start, sc[b.k]?.start_ms ?? run.range.start)), e = Math.round(Math.min(run.range.end, b.k + 1 < sc.length ? sc[b.k + 1].start_ms : run.range.end));
      if (!(b.t_ms >= a && b.t_ms < e)) { failed = `${b.groups.map((g) => g.name).join(', ')}: their frame is outside the run`; continue; }
      const frames = newFrames();
      this.live = { frames, roi: null };
      app.usage?.note('tracking:addStart', { run: run.id, t_ms: b.t_ms, groups: b.groups.map((g) => g.name).join(','), t0: a, t1: e });
      const r = await this.job('track', trackRequest({ video: path, tracker: t.id, start_ms: a, end_ms: e, roi: { kind: 'box', x: 0, y: 0, w: 1, h: 1, t_ms: b.t_ms }, params: run.params, tags: this.rangeTags({ start: a, end: e }),
        cuts: throughCuts(trackCuts('document', this.scenes, a, e)), groups: b.groups, groups_only: true }), {
        owner, range: { t0: a, t1: e },
        onFrames: (batch) => { if (this.path !== path) return; appendFrames(frames, batch); this.tick++; if (!app.player.playing && !app.player.el?.seeking) app.player.seek(batch[batch.length - 1].t_ms); },
      });
      this.live = null;
      if (this.path !== path) return { moved: true };
      if (r.cancelled) { if (!app.player.playing) app.player.seek(home); return { run, added, again, failed, cancelled: true }; }
      if (r.error) { failed = String(r.error).split(/\r?\n/)[0]; break; }
      const cur = this.run(run.id) || run, tk = takeRange(this.scenes, sceneAt(this.scenes, b.t_ms)), take = tk ? [this.scenes[tk[0]].start_ms, this.scenes[tk[1]].end_ms] : null;
      const m = mergeAdded(cur, { result: r.result, frames, groups: b.groups, t_ms: b.t_ms, frameMs: fm, aspect: this.aspect, active: this.#activeSeeds(cur), take });
      if (m.error) { failed = m.error; break; }
      this.patchRun(run.id, m.patch);
      run = this.run(run.id);
      added.push(...m.names); again.push(...(m.seeds || []).map((nm) => ({ name: nm, t_ms: b.t_ms })));
      app.usage?.note('tracking:addEnd', { run: run.id, added: m.names.join(','), span: m.span, ...(m.seeds?.length ? { seeds: m.seeds.join(',') } : {}) });
    }
    if (this.path === path && !app.player.playing) app.player.seek(home);
    if (added.length) {
      // a shot still on the run's old default signal takes the new default (fused once two painted parts have data there)
      this.scenes.forEach((s, i) => {
        const l = this.links[linkFor(this.links, s)];
        if (l?.run !== run.id) return;
        const was = defaultSignal(sceneCamera(s), run0, s.start_ms, s.end_ms) || 'primary', now = defaultSignal(sceneCamera(s), run, s.start_ms, s.end_ms) || 'primary';
        if (l.channel === was && now !== was) this.#putLink(i, run.id, now);
      });
      this.#recompose(run.id);
      run = this.run(run.id);
      deriveAxes(app, this, [run.id]);   // paw-2pcf
      app.history?.markDirty?.();
    }
    return { run, added, again, failed };
  }
  // ---- Track tagged scenes (lib/track-plan.js) ----
  /** The plan over the whole video (or `range`), from the scenes as drawn (proposals applied) and the panel's tracker,
   *  params and ROI (pending, else a part painted on an internal view). */
  plan({ force = false, range = { t0: 0, t1: this.app.durationMs }, panelOnly = false, only = null } = {}) {
    const id = this.userTrackerId, live = this.liveScenes();
    const runs = this.ghosts.filter((g) => g.source?.kind === 'tracker' && g.source.range).map((g) => ({ id: g.id, t0: g.source.range.t0, t1: g.source.range.t1, tag: g.source.tag }));
    // paw-x8we: no box is drawn any more: the bounds of a part painted on an internal view stand in for it there (only there: elsewhere
    // a plan with no box still takes the whole-frame grid, as before)
    const iv = live.filter((s) => isInternal(s) && s.end_ms > range.t0 && s.start_ms < range.t1);
    const part = this.roi ? null : iv.map((s) => this.partRoiIn(s.start_ms, s.end_ms)).find(Boolean) || null;
    return planTracks(live, { runs, links: this.links, roi: this.roi || part, trackerId: id, params: this.paramsBy[id] || {}, trackers: this.trackers,
      range, force, panelOnly, only, internal: isInternal, offscreen: isOffscreen, exposed: isExposed, skip: skipReason, camera: sceneCamera,
      grid: { points: Math.round(+this.app.settings.get('tracking.gridPoints', 512)) || 512 } });   // no box: the whole-frame grid, never "needs a box"
  }
  /** Track exactly these shots (a selection that is not one unbroken run, paw-k2u): the plan over them, re-tracked
   *  (force), each scene's shots inheriting its groups as Track tagged scenes does. -> runPlan's result | null. */
  async trackShots(shots) {
    const items = this.plan({ force: true, only: shots }).filter((x) => x.action === 'track');
    this.app.usage?.note('tracking:trackShots', { shots: shots.length, items: items.length });
    if (!items.length) { this.app.toast('Nothing to track in the selection (off-screen, blank, filled or generated shots only)', 'quiet'); return null; }
    return this.runPlan(items, { title: `Track ${shots.length} selected shots` });
  }
  openPlan() {
    this.ensureListed(); this.planOpen = true;
    try {
      const items = this.plan(), by = {};
      for (const x of items) by[x.action] = (by[x.action] || 0) + 1;
      this.app.usage?.note('tracking:planOpen', { ...by, skipped: items.filter((x) => x.action !== 'track').map((x) => `${x.action}: ${x.reason || x.label || ''}`.slice(0, 80)).slice(0, 12).join(' | ') });
    } catch { /* the log never blocks the plan */ }
  }
  /** A needs-roi row's "Go there": Track mode, range = its first scene still to do, playhead on its middle frame, the
   *  tracker panel shown (an internal view picks SAM by itself there: paint the inserted part, its bounds are the box). */
  goToItem(it) {
    const app = this.app, i = it.sceneIdx.find((k) => this.scenes[k]?.start_ms <= it.seekMs && this.scenes[k].end_ms > it.seekMs) ?? it.sceneIdx[0];
    this.planOpen = false;
    app.setMode?.('track');
    if (this.scenes[i]) this.setRange(this.scenes[i].start_ms, this.scenes[i].end_ms);
    app.player.pause(); app.player.seek(it.seekMs);
    app.showPanel?.('tracking');
    app.toast(`${it.label}: ${it.reason}, then ${app.commands?.keysFor?.('track.plan')?.[0] || 'Track tagged scenes'} again`, 'info');
  }
  /** Run the plan's `track` items one by one (one request per segment, queued on the job chain; the resident sidecar
   *  keeps the model loaded), one status-bar task. Each run is linked to its scenes (with the camera default signal),
   *  so the bridges, the done check and the scene selection see it. Cancel once: stop after the running segment;
   *  twice: kill it. A failed segment stops the batch (its toast says why); finished runs are kept.
   *  -> {made: runs, total: segments, stopped, failed} | null (nothing to run, or a batch already runs). */
  async runPlan(items, { title = 'Track tagged scenes' } = {}) {
    const work = items.filter((x) => x.action === 'track').flatMap((it) => it.segments.map((seg) => ({ it, seg })));
    if (!work.length || this.planBusy || !this.videoPath) return null;
    const app = this.app, path = this.videoPath, made = [], n = work.length;
    let stopped = false, failed = '';
    this.planBusy = { stop: false, k: 0, n };
    const tk = app.task(title, { cancel: () => this.cancel() });
    try {
      for (let k = 0; k < n; k++) {
        if (this.planBusy.stop || this.path !== path) { stopped = true; break; }
        const { it, seg } = work[k], t = this.trackers.find((x) => x.id === it.tracker);
        if (!t) { failed = `${it.tracker || 'no tracker'} is not installed`; break; }
        this.planBusy = { ...this.planBusy, k };
        const head = `${title} · ${n > 1 ? `scene ${k + 1}/${n} · ` : ''}${it.label}`;
        tk.label(head); tk.update(0, 0);
        const params = this.withAxis(t, { ...$state.snapshot(this.paramsBy[t.id] || {}), ...it.params });
        const r = await this.runTrack(t, { start: seg[0], end: seg[1] }, params, t.roi === 'none' ? null : it.roi, this.spansFor(seg[0], seg[1]), {
          scenes: this.scenesMode, name: it.name, task: false, quiet: true,
          onEvent: (e) => { if (e.type === 'progress') tk.update(shownDone(e.done, e.total), e.total); if (e.type === 'progress' || e.type === 'result') tk.label(`${head} · ${this.progressLabel}`); },
        });
        if (r.moved || r.cancelled) { stopped = true; break; }
        if (r.error) { failed = r.error; break; }
        this.#linkPlanned(r.run);
        made.push(r.run);
      }
    } finally { tk.end(); this.planBusy = null; }
    if (this.roi && made.length && work.some((w) => w.it.roi === this.roi)) this.roi = null;   // the box belongs to its run now
    return { made, total: n, stopped, failed };
  }
  /** The dialog's Run: the plan, then a toast with what is left; the dialog comes back while scenes still need a box. */
  async runPlanned(items) {
    this.planOpen = false;
    this.app.usage?.note('tracking:plan', items.filter((x) => x.action === 'track').length);
    const res = await this.runPlan(items);
    if (!res) return;
    const left = this.plan();
    const head = res.stopped ? `stopped after ${res.made.length} of ${res.total}` : res.failed ? `failed after ${res.made.length} of ${res.total}` : `${res.made.length} run${res.made.length === 1 ? '' : 's'}`;
    this.app.toast(`Track tagged scenes: ${head} · ${planSummary(left)}`, res.failed ? 'warn' : 'ok');
    if (!res.stopped && !res.failed && left.some((x) => x.action === 'needs-roi')) this.planOpen = true;
  }
  /** A planned run takes the scenes it covers (more than half of each): each scene's link points at it, on the camera
   *  default signal (defaultSignal: fused with two painted parts or more, else the camera tag's) else primary; a scene's previous run goes back to its own default there. */
  #linkPlanned(run) {
    const a = run.range.start, b = run.range.end, prevs = new Set();
    this.scenes.forEach((s, i) => {
      if (Math.min(b, s.end_ms) - Math.max(a, s.start_ms) <= (s.end_ms - s.start_ms) / 2 || this.links[linkFor(this.links, s)]?.run === run.id) return;
      const prev = this.#putLink(i, run.id, defaultSignal(sceneCamera(s), run, s.start_ms, s.end_ms) || 'primary');
      if (prev && prev !== run.id) prevs.add(prev);
    });
    for (const p of prevs) this.#recompose(p);
    this.#recompose(run.id);
  }
  /** paw-lji3 / paw-83sq: the owner's new run on the shots it covers (rederive.js arrivalShots): Smart stroke on where it can
   *  fuse, and a re-track takes each shot's settings on the run it re-tracks (the one Adjust showed there: deriveRun, the
   *  selected run else the linked one; else the newest other run over it). Not an undo step, like the run and its links
   *  (tracking never was one), so not a fix either; a later Smart stroke off is both. paw-c61g: folded into every state the
   *  history holds (as takeRange does for ranges), so undo / redo of an earlier scene edit keeps them. */
  #arrive(run) {
    const live = this.liveScenes(), own = (r) => r && r.id !== run.id && !r.tag && !r.mod && !r.ref && !r.derived;
    const prev = (i) => {
      const s = this.scenes[i], m = (s.start_ms + s.end_ms) / 2, d = this.deriveRun(i);
      return (own(d) ? d : this.runs.findLast((r) => own(r) && m >= r.range.start && m < r.range.end))?.id ?? null;
    };
    const smart = this.app.settings.get('tracking.smartStroke') !== false;   // setting: a new run arrives with Smart stroke on where it can fuse
    const list = arrivalShots(this.scenes, run, { prev, fuse: smart && canFuse(run), source: (x) => canSource(run, x, canFuse), skip: (i) => !!skipReason(live[i]) });
    if (list === this.scenes) return;
    const key = (s) => `${s.start_ms}|${s.end_ms}`, add = new Map();
    list.forEach((s, i) => { if (s !== this.scenes[i] && s.derives?.[run.id]) add.set(key(s), s.derives[run.id]); });
    this.app.doc.scenes = list;
    const put = (v) => (Array.isArray(v) && v.some((s) => add.has(key(s)) && !s.derives?.[run.id]) ? v.map((s) => (add.has(key(s)) && !s.derives?.[run.id] ? withDerive(s, run.id, add.get(key(s))) : s)) : v);
    this.app.history?.rebase?.('scenes', put);
  }
  /** The new run's signal per scene (runs-channel.js defaultSignal: fused where two painted parts or more have data, paw-iasp;
   *  else the camera tag's: pan / zoom / handheld -> proj_cam, turntable -> pair or g1, rides the stroke -> proj), as a scene
   *  link, only where the scene has no link yet. */
  #cameraDefaults(run) {
    if (run.tag) return;   // a hidden camera reference never takes a scene
    let taken = false;
    const live = this.liveScenes();
    this.scenes.forEach((s, i) => {
      // an off-screen / blank / structure scene never takes a run: a link there would hide the bridge or hold over it
      if (s.end_ms <= run.range.start || s.start_ms >= run.range.end || skipReason(live[i])) return;
      const k = linkFor(this.links, s);
      if (k >= 0 && this.ghost(this.links[k].run)) { taken = true; return; }   // a link to a run that is gone is free
      const ch = defaultSignal(sceneCamera(s), run, s.start_ms, s.end_ms);
      if (ch) this.#putLink(i, run.id, ch);
    });
    // paw-orm2: a run over shots another run already plays (a second run beside the first) takes no link, so it was never
    // composed: the sidecar's pick, no fusion panel, where the first run had been fused. It is composed now, by default
    // fused where its painted parts can be (defaultSignal); the shots keep playing the run they are linked to until a pick
    // on this one links them (setSource / setChannel), as before.
    const fz = taken && run.channel === 'primary' && defaultSignal(null, run, run.range.start, run.range.end) === 'fused';
    this.#recompose(run.id, fz ? 'fused' : undefined);
  }
  patchRun(id, patch) { this.runs = this.runs.map((x) => (x.id === id ? { ...x, ...patch } : x)); this.runsDirty = true; }

  // ---- camera motion: does a run follow the whole frame? (motion.js cameraMotion) ----
  /** The reference is a whole-frame run covering the run's range (the draft's base track is one), else a new
   *  whole-frame run (draft/logic.js pickTracker: lk_box), kept as a hidden ghost tagged 'camera' and reused.
   *  -> run.cameraMotion = {flag, score, together, n, refId} | {skipped: reason} | {error}; {pending: true} meanwhile. */
  async checkCamera(id, { owner = '' } = {}) {
    const run = this.run(id), put = (cameraMotion) => { this.patchRun(id, { cameraMotion }); return cameraMotion; };
    if (!run) return null;
    if (!run.samples.v.some(Number.isFinite)) return put({ skipped: 'no primary signal' });
    if (wholeFrame(run)) return put({ skipped: 'whole-frame run' });
    const a = run.range.start, b = run.range.end;
    let ref = this.runs.find((r) => r.id !== id && wholeFrame(r) && r.range.start <= a && r.range.end >= b && r.samples.t.length);
    if (!ref) {
      const pick = pickTracker(this.trackers), t = pick && this.trackers.find((x) => x.id === pick.tracker);
      if (!t) return put({ skipped: 'no whole-frame tracker' });
      put({ pending: true });
      const auto = t.params?.find((p) => p.key === 'axis')?.choices?.includes('auto');   // a pan can go any way
      const r = await this.runTrack(t, { start: a, end: b }, auto ? { axis: 'auto' } : {}, pick.roi, [], { tag: 'camera', owner, label: 'camera', visible: false, check: false });
      if (r.moved || !this.run(id)) return null;
      if (r.cancelled) return put(null);
      if (r.error) return put({ error: firstLine(r.error) });
      ref = r.run;
    }
    const cm = cameraMotion(this.run(id), ref);
    if (cm?.flag) this.app.toast(`${this.titleOf(run)} (${run.name}) tracks the camera (${cm.score.toFixed(2)}): it follows the whole picture, not the moving part`, 'warn');
    return put(cm ? { flag: cm.flag, score: cm.score, together: cm.together, n: cm.n, refId: ref.id } : { skipped: 'too few frames' });
  }
  /** paw-1fd3: the highest run number this project ever gave (the 'tracking' block keeps it): a discarded run's number is never
   *  given again, so nothing that still names it (its ranges in an undo step, a history entry's runs) meets a new run. */
  runSeq = 0;
  /** Run numbers continue past runSeq, every 'runN' ghost and run here or in the runs file, and every run a history entry
   *  keeps (its record in the copy-on-write runs file: a restore brings it back under its id). */
  nextRunNumber() {
    let n = this.runSeq;
    const see = (id) => { const m = /^run(\d+)$/.exec(id || ''); if (m) n = Math.max(n, +m[1]); };
    for (const g of this.ghosts) see(g.id);
    for (const r of [...this.runs, ...this.fileRuns]) { see(r.id); if (Number.isFinite(r.n)) n = Math.max(n, r.n); }
    for (const id of Object.keys(this.runRefs())) see(id);
    for (const c of this.app.project?.checkpoints || []) for (const id of Object.keys(c.runRefs || {})) see(id);
    return n + 1;
  }
  /** The run's title (lib/runs.js runTitle: scenes · range · #k among the non-camera runs over the same scenes). */
  titleOf(run) { return runTitle(run, this.scenes, this.runs.filter((r) => r.tag !== 'camera')); }
  // ponytail: the ghost's name is the title when the ghost is made (lane legend, accept labels); the panel recomputes it
  ghostOf(run, visible = true) {
    return {
      id: run.id, name: this.titleOf(run), color: run.color, script: run.mod ? [] : normalize(pointsList(run.points)), visible,
      source: { kind: run.mod ? 'modrun' : 'tracker', ...(run.mod ? { mod: run.mod } : {}), tracker: run.tracker, runId: run.id, range: { t0: run.range.start, t1: run.range.end }, params: run.params, ...(run.tag ? { tag: run.tag } : {}), ...(run.derived ? { derived: { from: run.derived.from, kind: run.derived.kind, j: run.derived.j } } : {}) },   // paw-ef73.33: derived: its link; a modifier's run: no shot / plan / lane takes it
    };
  }
  patchGhost(id, patch) { this.app.doc.ghosts = this.ghosts.map((g) => (g.id === id ? { ...g, ...patch } : g)); }

  // ---- score against the reference (sidecar `score`, no video decode) ----
  /** Scores a ghost's script (flips included) against the reference, over its run's range (or its own extent). */
  async scoreGhost(id) {
    const ref = this.reference, g = this.ghost(id);
    if (!ref || !g || g.id === ref.id || !g.script?.length || !ref.script?.length) return;
    const run = this.run(id), a = run ? run.range.start : g.script[0].at, b = run ? run.range.end : g.script[g.script.length - 1].at;
    const seq = ++this.scoreSeq;
    this.scores = { ...this.scores, [id]: { busy: true, seq } };
    const req = scoreRequest({ candidate: g.script, reference: ref.script, start_ms: a, end_ms: b, fps: this.app.doc.media?.fps,
      scenes: this.scenes.map((s) => ({ start_ms: s.start_ms, end_ms: s.end_ms })) });
    const r = await this.job('score', req, { task: false });
    if (this.scores[id]?.seq !== seq) return;   // a newer score of this ghost superseded this one
    this.scores = { ...this.scores, [id]: r.cancelled ? undefined : r.error ? { error: firstLine(r.error) } : { overall: r.result.overall, scenes: r.result.scenes || [] } };
  }
  /** Rescore soon (a burst of flips costs one sidecar call). */
  queueScore(id) {
    clearTimeout(this.timers[id]);
    this.timers[id] = setTimeout(() => this.scoreGhost(id), 300);
  }

  // ---- direction: flip a scene (its signal, at the next compose: paw-vtec), no re-track ----
  // Flips are not undo steps (ghosts are not undoable): flipping again restores the points, and the toast says so.
  flipScene(i, r = this.selected) {
    if (!r || i < 0 || i >= r.scenes.length) return;
    this.applyRunPatch(r, flipPatch(r, i));
    this.app.usage?.note('tracking:flip', { run: r.id, scene: i, t0: Math.round(r.scenes[i].start_ms), t1: Math.round(r.scenes[i].end_ms) });   // the fix log (not an undo step)
    this.app.toast(`Flipped scene ${i + 1} of ${this.titleOf(r)}: flip again to undo (${this.app.commands.keysFor?.('track.flipAtPlayhead')?.[0] || 'F'})`, 'quiet');
  }
  flipRun() {
    const r = this.selected;
    if (!r || !r.scenes.length) return;
    this.applyRunPatch(r, flipPatch(r, null));
    this.app.usage?.note('tracking:flip', { run: r.id, all: true, t0: Math.round(r.range.start), t1: Math.round(r.range.end) });
    this.app.toast(`Flipped every scene of ${this.titleOf(r)}: flip again to undo`, 'quiet');
  }
  /** paw-3cbm: F flips the scene of the run that PLAYS at the playhead (its run range), whatever is selected. -> done */
  flipAtPlayhead() {
    const t = playheadFrameStart(this.app.player), at = rangeAt(this.runRanges, t), r = at && this.run(at.run), i = r ? sceneAt(r.scenes, t) : -1;
    if (i < 0) { this.app.toast('No run plays here: nothing to flip', 'quiet'); return false; }
    this.flipScene(i, r);
    return true;
  }
  // ---- paw-57ve: polarity stretches (lib/polarity.js): [t0, t1) of a run scene flipped relative to the rest of it, at the
  //      signal (channelPatch ctx.flips: mirrored, the joins continuous). Stored on the shots per run (shot.polarity =
  //      {[runId]: [[t0, t1]]}, each stretch on the shot under its middle): undoable, in the .pawproj. flipPreview = a
  //      drag's live list (no history) ----
  flipPreview = $state.raw(null);   // {run, list} | null
  #flipSeen = new Map();
  /** Run r's stretches (a drag's preview wins), clean, split at its scene cuts. */
  flipsOf(r) {
    if (!r) return [];
    if (this.flipPreview?.run === r.id) return this.flipPreview.list;
    return flipsClean(this.scenes.flatMap((s) => s.polarity?.[r.id] || []), (r.scenes || []).slice(1).map((s) => s.start_ms));
  }
  /** Run id's stretches = list. commit false: a drag's live step (preview only); true: one undo step. -> false = nowhere to keep them. */
  setRunFlips(id, list, { commit = true, label = 'Flip a stretch' } = {}) {
    const r = this.run(id), sc = this.scenes;
    if (!r) return false;
    const next = flipsClean(list, (r.scenes || []).slice(1).map((s) => s.start_ms));
    if (!commit) { this.flipPreview = { run: id, list: next }; return true; }
    this.flipPreview = null;
    if (!sc.length) { if (next.length) this.app.toast('A flipped stretch is kept on its shot: detect scenes first', 'warn'); return false; }
    const by = sc.map(() => []);
    for (const s of next) by[Math.max(0, sceneAt(sc, (s[0] + s[1]) / 2))].push(s);
    const shots = sc.map((s, k) => {
      const { [id]: _, ...rest } = s.polarity || {}, pol = by[k].length ? { ...rest, [id]: by[k] } : rest;   // eslint-disable-line no-unused-vars
      if (JSON.stringify(pol) === JSON.stringify(s.polarity || {})) return s;
      const { polarity: _p, ...base } = s;   // eslint-disable-line no-unused-vars
      return Object.keys(pol).length ? { ...base, polarity: pol } : base;
    });
    if (shots.some((s, k) => s !== sc[k])) this.app.transact(label, () => { this.app.doc.scenes = shots; });
    this.app.usage?.note('tracking:flipStretch', { run: id, n: next.length, ms: next.reduce((a, [u, v]) => a + v - u, 0) });
    return true;
  }
  /** [t0, t1) of the selected run toggled (xor), clipped to the run scene at t0. */
  flipStretch(t0, t1, { label = 'Flip a stretch' } = {}) {
    const r = this.selected, k = r?.scenes?.length ? sceneAt(r.scenes, t0) : -1;
    if (!r || k < 0) return null;
    const a = Math.max(r.scenes[k].start_ms, r.range.start, Math.min(t0, t1)), b = Math.min(r.scenes[k].end_ms, r.range.end, Math.max(t0, t1));
    return b > a ? this.setRunFlips(r.id, xorFlips(this.flipsOf(r), a, b), { label }) : null;
  }
  /** The usual fix: from the playhead (its frame) to the end of the run scene there is upside down. These three -> null =
   *  nothing of the run there; false = nowhere to keep it (toasted). */
  flipToEnd() { const t = playheadFrameStart(this.app.player); return this.flipStretch(t, Infinity, { label: 'Flip from the playhead to the end of the shot' }); }
  /** The I-O range, in every run scene of the selected run it touches: one undo step. */
  flipRange() {
    const r = this.selected, g = this.app.doc.range;
    if (!r?.scenes?.length || !g) return null;
    let list = this.flipsOf(r), any = false;
    for (const s of r.scenes) { const a = Math.max(g.t0, s.start_ms, r.range.start), b = Math.min(g.t1, s.end_ms, r.range.end); if (b > a) { list = xorFlips(list, a, b); any = true; } }
    return any ? this.setRunFlips(r.id, list, { label: 'Flip the range' }) : null;
  }
  /** paw-zl3n (part 1): a scene of a new run that shows >= 3 of the same pictures as a decided span (the editor's script
   *  outside the run: accepted or scripted; or a scene the owner flipped in another run) takes that span's direction:
   *  flipped here where the shared pictures disagree (lib/repeat-direction.js, experiments/repeat-consistency). Only ever
   *  at the run's arrival: a flip by the owner always wins (F flips it back), and an automatic flip is never a source.
   *  Logged for the fix log. -> the toast's addition ('' = nothing decided). */
  #repeatDirection(run) {
    const ix = repeatsOf(this.app), a = run.range.start, b = run.range.end, outside = (s) => s.end_ms <= a || s.start_ms >= b;
    if (!ix?.occ?.length || !run.scenes?.length) return '';
    const doc = scriptOf(this.app);
    const at = Float64Array.from(doc, (p) => p.at), pos = Float64Array.from(doc, (p) => p.pos), src = [];
    this.scenes.forEach((s, k) => { if (outside(s)) src.push({ label: `S${k + 1}`, at, pos, spans: [{ t0: s.start_ms, t1: s.end_ms }] }); });
    for (const r of this.runs) {
      if (r.id === run.id) continue;
      for (const k of r.flips || []) { const s = r.scenes[k]; if (s && outside(s)) src.push({ label: `${this.titleOf(r)} (flipped)`, at: r.points.at, pos: r.points.pos, spans: [{ t0: s.start_ms, t1: s.end_ms }] }); }
    }
    const dec = directionFromRepeats(ix, run.scenes, run.points, src).filter((d) => d.sign < 0);
    if (!dec.length) return '';
    this.applyRunPatch(run, { flips: dec.map((d) => d.scene) });
    for (const d of dec) this.app.usage?.note('tracking:repeatDirection', { run: run.id, scene: d.scene, t0: Math.round(run.scenes[d.scene].start_ms), t1: Math.round(run.scenes[d.scene].end_ms), from: d.from, n: d.n, r: d.r });
    const key = this.app.commands?.keysFor?.('track.flipAtPlayhead')?.[0] || 'F', d = dec[0];
    return ` · ${run.scenes.length > 1 ? `scene ${d.scene + 1}${dec.length > 1 ? ` +${dec.length - 1}` : ''}: ` : ''}direction from ${d.from} · same frames (${d.n}), ${key} flips it back`;
  }
  applyRunPatch(r, patch, { live = false } = {}) {
    // paw-vtec: scene flips and span orientations are part of the run's direction, applied to its signal when it is composed
    // (runs-channel.js channelPatch, lib/polarity.js directionOf): a change recomposes the run; points0 plays as it is
    if (patch.flips || patch.orient) { const n = { ...r, ...patch }; patch = { ...patch, ...channelPatch(n, n.channel, this.channelFit, this.links, this.#ctx(n)) }; }
    if (patch.points0 && r.derived) patch = { ...patch, points0: carryLevel(patch.points0, r.derived.levelRef) };   // paw-ef73.33: the source's level
    if (patch.points0) patch = { ...patch, points: patch.points0 };
    // a composed run (a scene on a channel of its own: lane set) is stitched at its cuts, after the flips (runs-channel.js stitchPoints)
    if (patch.points && (patch.lane !== undefined ? patch.lane : r.lane)) { const s = stitchPoints(patch.points, { ...r, ...patch }, this.links, this.channelFit, { scenes: this.liveScenes(), internal: isInternal, clean: cleanMicroOpts(this.app.settings) }); patch = { ...patch, points: s.points, stitches: s.stitches }; }
    else if (patch.points) patch = { ...patch, stitches: null };
    const next = { ...r, ...patch };
    this.runs = this.runs.map((x) => (x.id === r.id ? next : x));
    this.runsDirty = true;
    const keep = live ? null : this.#keepPatch(next);   // paw-o60v.2: a drag between rests leaves the ghost (the script lane) alone
    if (patch.points || keep) this.patchGhost(r.id, { ...(patch.points && !r.mod && { script: normalize(pointsList(next.points)) }), ...keep });
    if (patch.points) this.queueScore(r.id);
  }
  /** Ghost patch keeping what rebuilds the run after a reload (runs-channel.js keepOf), while it has a channel picked
   *  or a scene link; dropped (undefined) when neither is left. null = nothing to change. */
  #keepPatch(run) {
    const g = this.ghost(run.id), linked = this.links.filter((l) => l.run === run.id);
    if (g?.source?.kind !== 'tracker' || run.derived) return null;   // paw-ef73.33: a derived run keeps no channels on its ghost
    const names = [...new Set([run.channel, ...linked.map((l) => l.channel)])].filter((n) => n !== 'primary');
    if (!names.length && !linked.length && !g.source.keep) return null;
    return { source: { ...g.source, keep: names.length || linked.length ? keepOf(run, names, this.channelFit) : undefined } };
  }
  /** Pin the direction of [t0, t1) of a run: sign +1 = as tracked, -1 = mirrored. Survives later scene flips. */
  setSpanOrientation({ runId = this.selectedId, t0, t1, sign }) {
    const r = this.run(runId);
    if (!r || !(t1 > t0)) return false;
    this.applyRunPatch(r, { orient: addOrientation(r.orient || [], { t0, t1, sign }) });
    this.app.usage?.note('tracking:orient', { run: r.id, t0: Math.round(t0), t1: Math.round(t1), sign });
    return true;
  }
  /** Re-track a span: Track mode, range preset, ROI cleared, the tracker panel shown, playhead at t0. */
  retrack({ t0, t1 }) {
    const app = this.app;
    app.setMode('track');
    app.doc.range = { t0, t1 };
    this.clearRoi();
    app.player.pause(); app.player.seek(t0);
    app.showPanel?.('tracking');
    app.toast('Paint the part with Groups (' + (app.commands.keysFor('tracking.groups')[0] || 'Tab') + '), then press ' + (app.commands.keysFor('track.run')[0] || 'Ctrl+T') + ' (Track ROI)', 'info');
    app.usage?.note('tracking:retrack', { t0: Math.round(t0), t1: Math.round(t1) });
  }
  /** Finished runs of this session, for other features (src/features/tracking/api.js). */
  runsInfo() {
    return this.runs.filter((r) => !r.restored && !r.derived).map((r) => ({   // (paw-ef73.33: derived runs have no frames) runs restored from a project's ghosts lack frames / samples / events
      id: r.id, n: r.n, name: r.name, tracker: r.tracker, range: { t0: r.range.start, t1: r.range.end }, roi: r.roi,
      scenes: r.scenes.map((s, i) => ({ t0: s.start_ms, t1: s.end_ms, sign: effSign(r, i), autoSign: s.auto_sign ?? null })),
      orient: r.orient || [], flipSpans: r.flipSpans || [], events: r.events, frames: r.frames, confidence: r.confidence, tag: r.tag || '',
      cameraMotion: r.cameraMotion ?? null, lowMotion: r.lowMotion ?? null, notes: r.notes || [], decisions: decisionsOf(r.notes),
      motion: motionStats(r.points, statWindows(this.scenes, r.range.start, r.range.end)),
    }));
  }
  /**
   * The channel a run's points come from, per scene (runs-channel.js channelPatch composes them; sidecar's back on
   * 'primary'). scene i >= 0: only scene i changes -- its link (project block 'links') now says run `id`, `channel`
   * (a scene has one link: the run it pointed at before goes back to its default there). No scene (undefined / -1):
   * the run's default `channel`, used by every scene of it without a link (the Director sets whole runs this way).
   * The ghost keeps what rebuilding needs, so both survive a reload.
   */
  setChannel(id, channel, scene) {
    const r = this.run(id);
    if (!r) return;
    // a user override of the sidecar's primary pick (or the Director's): what it was, what it is now
    this.app.usage?.note('tracking:setChannel', { run: id, tracker: r.tracker, scene: scene ?? -1, from: scene >= 0 ? this.channelFor(r, scene) : r.channel, to: channel, sidecar: decisionsOf(r.notes)[scene >= 0 ? scene : 0]?.chosen ?? null });
    if (!(scene >= 0 && this.scenes[scene])) { this.#recompose(id, channel); return; }
    const prevs = new Set([this.#putLink(scene, id, channel)]);
    // scenes contain shots: the pick is the scene's, so its other shots on this run take it too (a camera-handling
    // channel stays per shot: proj / proj_cam / cam / primary follow each shot's camera)
    for (const j of this.inheritShots(scene, r, channel)) prevs.add(this.#putLink(j, id, channel));
    for (const p of prevs) if (p && p !== id) this.#recompose(p);
    this.#recompose(id);
  }
  /** The other shots of shot i's scene a pick of `channel` on run r reaches (shots.js inheritTargets). */
  inheritShots(i, r, channel) {
    const live = this.liveScenes();
    // paw-orm2: + the shots of the run scene shot i is in (any channel: that run scene is composed from one link)
    const own = (this.composedWith(i, r.id)?.shots || []).filter((j) => j !== i);
    return [...new Set([...inheritTargets(this.scenes, i, { t0: r.range.start, t1: r.range.end }, channel), ...own])]
      .filter((j) => !skipReason(live[j]) && (this.links[linkFor(this.links, this.scenes[j])]?.run ?? r.id) === r.id);
  }
  /** A pick in the panel / on the video: for the run's scene (sceneOf; paw-9qm: that scene's source, one undo step),
   *  else the run's default. */
  pickChannel(id, channel, via = 'code') { const r = this.run(id); if (!r) return; const i = this.sceneOf(r); if (i >= 0) this.setSource(channel, null, id, via); else this.setChannel(id, channel, i); }

  // ---- paw-9qm: the signal row under the run (TrackingLane): source, pair, what it is measured against; per shot (its
  // derive: source / against / cam, undoable) or per range inside the run (the scene fact `signal`, lib/signal-source.js).
  // API for other features (the video overlay, paw-ufv): setPair(a, b, span?) and signalState(t); pairPick /
  // pickPairPart(key) for picking the pair by clicking two trackers on the video.
  signalPreview = $state.raw(null);   // the range overrides while one's end is dragged (no history); the release writes once
  sigSel = $state.raw(null);          // the override segment last clicked {t0, t1}: the row's pickers and Delete / X act on it
  pairPick = $state.raw(null);        // null | {first: '' | group key, span: {t0, t1} | null}: the next two tracker clicks pick a pair
  /** Every range override of the document (clipped to its scene), or the drag's preview. */
  get signalSpans() { return this.signalPreview ?? signalSpans(this.scenes); }
  /** The run the row is about: the selected one, else the one linked to the current scene. */
  get signalRun() { return this.selected || this.run(this.sceneLink(this.currentScene)?.runId ?? '') || null; }
  /** The source shot i takes from run r (before any range override): its derive's source, Smart = fused, else its link /
   *  the run's default channel. */
  shotSource(r, i) {
    const d = this.shotDerive(i, r?.id);
    if (d?.source && canSource(r, d.source, canFuse)) return d.source;
    return d?.smart && r && canFuse(r) ? 'fused' : this.channelFor(r, i);
  }
  /** The override exactly over span ({t0, t1, source?, against?, cam?}) or null. */
  spanOver(span) { return span ? this.signalSpans.find((s) => s.t0 === span.t0 && s.t1 === span.t1) || null : null; }
  /** Write a range override: patch merged into the one exactly over `span` (else a new one there); null patch = remove;
   *  to = its new extent (an end dragged). commit false: a live preview, no history; true: one undo step. -> changed? */
  setSpan(span, patch, { to = null, commit = true, label = 'Signal: range override' } = {}) {
    if (!span || !(span.t1 > span.t0)) return false;
    const cur = signalSpans(this.scenes).find((x) => x.t0 === span.t0 && x.t1 === span.t1) || null;   // the stored one (not a drag's preview)
    const value = patch === null ? null : { ...(cur || {}), ...patch };
    const list = setSignalSpan(this.scenes, to || span, value, cur ? span : null);
    if (!commit) { this.signalPreview = signalSpans(list); return true; }
    this.signalPreview = null;
    if (list === this.scenes) return false;
    this.app.transact(label, () => { this.app.doc.scenes = list; });
    const ext = to || span;
    if (cur && this.sigSel?.t0 === span.t0 && this.sigSel?.t1 === span.t1) this.sigSel = value ? { t0: Math.round(ext.t0), t1: Math.round(ext.t1) } : null;
    return true;
  }
  /** patch (keys of a derive) on every shot of shot i's scene, each keeping its own other settings: one undo step.
   *  paw-orm2: and on every shot composed with them (composedWith), which take the settings their run scene is composed with. */
  #putScene(i, patch, label, run) {
    const [lo, hi] = sceneRange(this.scenes, i) || [i, i], J = JSON.stringify;
    const reach = new Set(this.#withComposed(Array.from({ length: hi - lo + 1 }, (_, k) => lo + k), run));
    const list = this.scenes.map((x, k) => {
      if (!reach.has(k)) return x;
      const base = this.scenes[this.composedWith(k, run, false)?.k ?? k];
      const next = deriveClean({ ...(deriveClean(deriveOf(base, run)) || {}), ...patch, match: true });   // paw-s80k (setDerive)
      return J(next) === J(deriveClean(deriveOf(x, run))) ? x : withDerive(x, run, next);
    });
    if (list.every((x, k) => x === this.scenes[k])) return false;
    this.app.transact(label, () => { this.app.doc.scenes = list; });
    return true;
  }
  /** The shot a row edit on run id reaches (the run's scene: sceneOf), -1 none. */
  #sigShot(id) { const r = id ? this.run(id) : this.signalRun; return r ? this.sceneOf(r) : -1; }
  /** Scene i is linked to run id (keeping the channel it uses now), so a source set on it is this run's. */
  #linkRun(id, i) { const r = this.run(id); if (r && this.scenes[i] && this.sceneLink(i)?.runId !== id) this.setChannel(id, this.channelFor(r, i), i); }
  /** The signal source (a channel id, 'fused', 'rel:a:b') for span (a range override) or, with no span, for the run's
   *  scene (every shot of it). One undo step. */
  setSource(channel, span = null, id = this.signalRun?.id, via = 'code') {
    this.app.usage?.note('tracking:sourcePick', { via, range: !!span, to: channel });   // paw-r73w: which surface picked it
    if (span) return this.setSpan(span, { source: channel }, { label: 'Signal: source of a range' });
    const i = this.#sigShot(id);
    if (i < 0) return false;
    this.#linkRun(id, i);
    // paw-4c48.10: picking Shaft clears the shot's earlier flip (the shaft has a direction of its own), in the same undo step:
    // derive.unflip when its run scene is flipped now (the owner's F, Assist's span over all of it); any other pick drops it
    const r = this.run(id), s = this.scenes[i], k = r && s ? Math.max(0, sceneAt(r.scenes || [], (s.start_ms + s.end_ms) / 2)) : -1;
    const unflip = isShaftSource(channel) && k >= 0 && directionOf(r, this.flipsOf(r)).whole.has(k) ? true : undefined;   // paw-4c48.19: a depth part too
    return this.#putScene(i, { source: channel, unflip }, isShaftSource(channel) && unflip ? `Signal: source ${partOf(channel) ? partWord(partOf(channel)) : 'Shaft'} (its earlier flip cleared)` : 'Signal: source', id);
  }
  /** What the signal is measured against: 'camera' (the camera removal as set) | 'none' | a group key. One undo step. */
  setAgainst(against, span = null, id = this.signalRun?.id) {
    if (span) return this.setSpan(span, { against }, { label: 'Signal: measured against (range)' });
    const i = this.#sigShot(id);
    if (i < 0) return false;
    this.#linkRun(id, i);
    return this.#putScene(i, { against: against === 'camera' ? undefined : against }, 'Signal: measured against', id);
  }
  /** Camera removal ({mode?, strength?, smoothMs?, source?}) for span, else the row's shot (Adjust's scope); patch null = back to
   *  the default (the shot's camera tag's, else auto). A choice is explicit: it beats the Adjust setting and the tag default
   *  (rederive.js effectiveCam), 'auto' included. One undo step. */
  setSignalCam(patch, span = null) {
    if (span) {
      if (patch === null) return this.setSpan(span, { cam: undefined }, { label: 'Signal: camera of a range back to default' });
      const i = sceneAt(this.scenes, span.t0), { tag: _t, ...base } = effectiveCam(camTagDefault(this.scenes[i]), this.shotDerive(i, this.signalRun?.id), this.spanOver(span)).cam;   // eslint-disable-line no-unused-vars
      return this.setSpan(span, { cam: { ...base, ...patch, explicit: true } }, { label: 'Signal: camera of a range' });
    }
    const i = this.#sigShot();
    if (i >= 0) this.setDerive(i, { cam: patch }, { scope: this.deriveScope, label: 'Signal: camera removal' });
    return i >= 0;
  }
  /** Shot i's camera removal as it applies (rederive.js effectiveCam): {cam, from: 'override' | 'adjust' | 'tag' | 'tracked', tag}.
   *  span = the range override over it (null = the shot's own). */
  camState(i, span = null, run) { return effectiveCam(camTagDefault(this.scenes[i]), this.shotDerive(i, run), span); }
  /** The override the row's pickers act on: the one clicked (sigSel), else the one under the playhead inside the run. null = the shot's own. */
  get activeSpan() {
    const r = this.signalRun;
    if (!r) return null;
    const sel = this.sigSel && this.spanOver(this.sigSel);
    if (sel) return sel;
    const t = this.app.player.timeMs;
    return t >= r.range.start && t < r.range.end ? spanAt(this.signalSpans, t) : null;
  }
  /** A new range override over [t0, t1) of the row's run (frame-snapped, inside the run), a copy of the shot's source / against /
   *  explicit camera so it starts equal to what it overrides; it is then selected. One undo step. -> the span | null. */
  addSignalSpan(t0, t1) {
    const r = this.signalRun;
    if (!r?.range) return null;
    const sn = (t) => this.app.player.snap(t), a = sn(Math.max(r.range.start, Math.min(t0, t1))), b = sn(Math.min(r.range.end, Math.max(t0, t1)));
    if (!(b > a)) return null;
    const i = sceneAt(this.scenes, (a + b) / 2), d = i >= 0 ? this.shotDerive(i, r.id) : null;
    if (i < 0 || !this.setSpan({ t0: a, t1: b }, { source: this.shotSource(r, i), ...(d?.against ? { against: d.against } : {}), ...(d?.cam ? { cam: d.cam } : {}) }, { label: 'Signal: add a range override' })) return null;
    const sp = this.signalSpans.find((s) => s.t1 > a && s.t0 < b && s.t0 <= (a + b) / 2 && s.t1 > (a + b) / 2) || null;
    this.sigSel = sp ? { t0: sp.t0, t1: sp.t1 } : null;
    return sp;
  }
  /** The command: an override over the I-O range (inside the run), else over the shot at the playhead. */
  addSignalSpanHere() {
    const r = this.signalRun, g = this.app.doc.range;
    if (!r) return null;
    if (g && g.t1 > r.range.start && g.t0 < r.range.end) return this.addSignalSpan(g.t0, g.t1);
    const s = this.scenes[sceneAt(this.scenes, this.app.player.timeMs)];
    return s ? this.addSignalSpan(s.start_ms, s.end_ms) : null;
  }
  /**
   * API (paw-ufv): the pair a (the moving part) against b (the part it moves against), group keys as in the run's
   * channels ('sem_c1_penis', 'sem_c2_hips': signalState().parts[].key). No span: the row's run's scene; span {t0, t1}:
   * a range override there. One undo step. -> false when a === b or the run has no centre for either.
   */
  setPair(a, b, span = null, via = 'video') {
    const r = this.signalRun, id = `rel:${a}:${b}`;
    if (!r || !pairOf(id) || !canSource(r, id)) return false;
    return this.setSource(id, span, r.id, via);
  }
  /** API (paw-ufv): one tracker click while pairPick is on: the first sets the moving part, the second picks the pair. */
  pickPairPart(key) {
    const p = this.pairPick;
    if (!p || !AGAINST_KEY.test(key || '')) return false;
    if (!p.first) { this.pairPick = { ...p, first: key }; return true; }
    this.pairPick = null;
    return p.first !== key && this.setPair(p.first, key, p.span);
  }
  /**
   * API (paw-ufv): the row's run's signal at t (default: the playhead) -> null | {runId, shot, source, pair: {a, b} | null,
   * against ('camera' | 'none' | a group key), override (the range override over t) | null, parts: [{key, label, who,
   * part}], fusion: null | {candidates, windows, weightsAt: {id: share}} (lib/fusion.js info of the run scene, when fused)}.
   */
  signalState(t = this.app.player.timeMs) {
    const r = this.signalRun;
    if (!r) return null;
    const i = sceneAt(this.scenes, t), shot = this.scenes[i] && this.scenes[i].start_ms <= t && this.scenes[i].end_ms > t ? i : this.sceneOf(r);
    const d = shot >= 0 ? this.shotDerive(shot, r.id) : null, ov = t >= r.range.start && t < r.range.end ? spanAt(this.signalSpans, t) : null;
    const source = ov?.source && canSource(r, ov.source, canFuse) ? ov.source : shot >= 0 ? this.shotSource(r, shot) : r.channel;
    const against = ov?.against || d?.against || 'camera';
    const built = resolveSource(r, source === 'primary' && shot >= 0 ? this.sceneSignal(r, shot) : source, against);
    const parts = fusionGroups(r).filter((g) => r.channels[g.key + '_x'].v.some((x) => x === x && x != null)).map((g) => ({ key: g.key, label: partLabel(g.name), who: g.who, part: g.part }));
    let fusion = null;
    if (source === 'fused') {
      const inf = r.channels.fused?.info?.[Math.max(0, sceneAt(r.scenes || [], t))];
      if (inf) {
        const mid = (x) => Math.abs(t - (x.t + x.t1) / 2), w = inf.windows.filter((x) => t >= x.t && t <= x.t1).sort((x, y) => mid(x) - mid(y))[0];
        fusion = { candidates: inf.candidates, windows: inf.windows, weightsAt: w?.w || {} };
      }
    }
    return { runId: r.id, shot, source, pair: pairOf(built), against, override: ov, parts, fusion };
  }
  // ---- re-derive after tracking (paw-a3n): a shot's camera handling and stroke axis, recomputed from the stored points ----
  // Stored on the shot (app.doc.scenes[i].derive, lib/rederive.js deriveClean shape): undoable, saved in the .pawproj.
  // While a control is dragged, derivePreview {t0, t1, derive} stands in (no history); the release writes once.
  derivePreview = $state.raw(null);
  #deriveKeys = new Map();
  /** Every run whose run scenes' derives changed since the last look recomposes (the stored channels, no sidecar). */
  #rederive() {
    const la = this.loopAvg;
    for (const r of this.runs) {
      if (r.ref || this.isLiveFill(r)) continue;   // paw-ef73.33: a derived run that follows recomposes in syncFills
      // paw-ef73.33: a run rebuilt from its ghost (restored: no stored tracks) recomposes only for the loops averaged over
      // it (a switch flipped, a loop moved / added / removed), through the same channelPatch; never for a derive
      if (r.restored) {
        const on = new Set(loopStates(r, la.loops, la.ix, la.fm).filter((s) => s.on).map((s) => s.id));
        const mk = this.#maskOf(r).mask, k = (on.size ? JSON.stringify(la.loops.filter((l) => on.has(l.id)).map((l) => [l.id, l.t0, l.t1, l.tiledTo, l.auto?.end])) + (la.ix ? '|pictures' : '') : '[]') + (mk ? JSON.stringify(mk) : '');   // paw-2lp7.1: + its positioning ranges
        // paw-57ve: and when its polarity stretches change (not at load: its ghost's script already has them)
        const fk = JSON.stringify(this.flipsOf(r)), seen = this.#flipSeen.get(r.id);
        this.#flipSeen.set(r.id, fk);
        if ((this.#deriveKeys.get(r.id) ?? '[]') !== k || (seen != null && seen !== fk)) { this.#deriveKeys.set(r.id, k); this.#recompose(r.id); }
        continue;
      }
      const dv =runDerives(r, this.detailPreview || this.scenes, this.derivePreview), sp = this.#spansOf(r), fl = this.flipsOf(r), mk = this.#maskOf(r).mask, k = JSON.stringify(sp.length ? [dv, sp] : dv) + (fl.length ? JSON.stringify(fl) : '') + (picturesOf(this.app) ? '|pictures' : '') + JSON.stringify((this.app.doc.loops || []).filter((l) => l.t0 < r.range.end && Math.max(l.t1, l.tiledTo || 0, l.auto?.end || 0) > r.range.start).map((l) => [l.t0, l.t1, l.tiledTo, l.avg, l.auto?.end])) + (mk ? '|pos' + JSON.stringify(mk) : '') + (this.#liveFor(r) ? '|live' : '');   // paw-o60v.2: the drag's rest composes again, exactly
      if ((this.#deriveKeys.get(r.id) ?? '[]') === k) continue;
      this.#deriveKeys.set(r.id, k);
      this.#recompose(r.id);
    }
  }
  /** paw-orm2: run `id` is composed per RUN scene (runs-channel.js channelPatch), with the derive of the shot under that run
   *  scene's middle (rederive.js runDerives) and the link overlapping it most (sceneChannels). A run scene often holds several
   *  shots (camera splits, a cut added after tracking: "S16–S22", one take): -> {shots: every shot whose middle lies in the
   *  run scene shot i is in, k: the shot whose derive composes it, scene: that run scene {start_ms, end_ms}}; null = shot i
   *  is outside the run (or no run). Reading shot i's settings reads shots[k]'s; a settings edit on any of them writes all. */
  composedWith(i, id, all = true) {
    const r = id ? this.run(id) : null, s = this.scenes[i];
    if (!r?.range || !s) return null;
    const mid = (x) => (x.start_ms + x.end_ms) / 2, m = mid(s);
    if (m < r.range.start || m >= r.range.end) return null;
    const sc = r.scenes?.length ? r.scenes : [{ start_ms: r.range.start, end_ms: r.range.end }], q = sceneAt(sc, m);
    const c = mid(sc[q]), j = sceneAt(this.scenes, c), k = this.scenes[j] && this.scenes[j].start_ms <= c && this.scenes[j].end_ms > c ? j : i;
    if (!all) return { k, scene: sc[q] };   // (the hot readers: shotDerive, channelFor)
    const shots = this.scenes.flatMap((x, n) => { const t = mid(x); return n === k || (t >= r.range.start && t < r.range.end && sceneAt(sc, t) === q) ? [n] : []; });
    return { shots, k, scene: sc[q] };
  }
  /** Shots `list` plus every shot composed with one of them on run `id` (composedWith), sorted. */
  #withComposed(list, id) { return [...new Set(list.flatMap((j) => this.composedWith(j, id)?.shots || [j]))].sort((a, b) => a - b); }
  /** Shot i's derive (the drag preview over it wins), or null = as tracked. paw-orm2: inside a run scene of several shots,
   *  the derive that scene is composed with (composedWith k), the same on every shot of it. */
  shotDerive(i, run = this.deriveRun(i)?.id) {
    const s = this.scenes[this.composedWith(i, run, false)?.k ?? i], pv = this.derivePreview;
    if (!s) return null;
    const m = (s.start_ms + s.end_ms) / 2;
    return pv && m >= pv.t0 && m < pv.t1 && (!pv.run || pv.run === run) ? deriveClean(pv.derive) : deriveClean(deriveOf(s, run));
  }
  /** The derive at time t (the shot there) for run id. */
  deriveAt(t, run) { return this.shotDerive(sceneAt(this.scenes, t), run); }
  // ---- shaft consumption (paw-azd, lib/shaft.js): how much is inside, the owner's marks ----
  /** The run whose shaft shows at t: the selected run if it has one there, else the shot's linked run. */
  shaftRun(t) {
    const ok = (r) => r && !r.restored && t >= r.range.start && t < r.range.end && Object.keys(r.channels || {}).some((k) => /^sem_[a-z0-9_]+_in$/.test(k));
    const sel = this.selected, l = this.sceneLink(sceneAt(this.scenes, t)), lr = l && this.run(l.runId);
    return ok(sel) ? sel : ok(lr) ? lr : null;
  }
  /** The shaft at t for the overlay (lib/shaft.js shaftOverlay, with the shot's marks) | null. */
  shaftAt(t) { const r = this.shaftRun(t); return r ? shaftOverlay(r, t, this.deriveAt(t)?.shaft, { aspect: this.aspect, motion: motionOf(r), part: this.#partAt(r, t) }) : null; }
  /** paw-4c48.19: the depth part shot i of run r plays as its source ('part:<name>' -> name) | null. */
  shotPart(r, i) { return r && i >= 0 ? partOf(this.shotSource(r, i)) : null; }
  #partAt(r, t) { return this.shotPart(r, sceneAt(this.scenes, t)); }
  /** paw-4c48.8: the position bar on the shaft at t: {ctx (lib/shaft.js railContext: the shot's run scene, its marks), shot (the
   *  shot's start ms: the per-shot flip's key)} | {why}. The context is kept per run, run scene, marks and aspect. */
  railFor(t) {
    const r = this.shaftRun(t), i = sceneAt(this.scenes, t);
    if (!r) return { why: 'no shaft read in this shot (no run with a shaft pass here)' };
    // paw-4c48.10 / .11: the diamond draws the better-founded reading, the one the Shaft source would use (lib/shaft-source.js
    // shaftScene: the points unless SAM repeats clearly better), picked or not; where neither qualifies it is drawn unsure (faint,
    // as on a held frame): never a confident diamond from a reading that does not follow the strokes
    const k = Math.max(0, sceneAt(r.scenes || [], t)), R = this.shaftReadings(r, k, i);   // paw-4c48.19: a depth part's rail while the shot plays it
    return { ctx: R.ctx, shot: this.scenes[i]?.start_ms ?? 0, reading: R.reading, ...(R.part ? { part: R.part } : {}), ...(R.unsure ? { unsure: R.unsure } : {}) };
  }
  /** Run r's shaft readings in run scene k (the shot i calibrates it: its marks; default the shot under the scene's middle):
   *  {points, sam (each its rail context | {why}), reading (the one the diamond / the Shaft source use: the source's while the
   *  shot plays it, else the automatic choice) | null, ctx (the rail the diamond draws: that reading's, or an unsure one), unsure
   *  (why neither qualifies) | undefined, q (its periodicity)}. paw-4c48.15: the shaft's data view reads the same. */
  shaftReadings(r, k, i = -1) {
    const sc = r?.scenes?.[k], shot = i >= 0 ? i : sceneAt(this.scenes, sc ? (sc.start_ms + sc.end_ms) / 2 : (r.range.start + r.range.end) / 2);
    // paw-4c48.19: while the shot plays a depth part ('part:<name>'), its readings (the same functions, the part by name)
    const part = this.shotPart(r, shot), P = part ? { part } : {};
    const calib = (shot >= 0 ? this.shotDerive(shot, r.id)?.shaft : null) || null, points = this.#railCtx(r, k, calib, 'points', undefined, undefined, part), sam = this.#railCtx(r, k, calib, 'sam', undefined, undefined, part);
    const src = shot >= 0 ? (part ? r.partSrc?.[part]?.[k] : this.shotSource(r, shot) === 'shaft' ? r.shaftSrc?.[k] : null) : null, auto = src?.ok ? null : this.#autoScene(r, k, calib, part);
    const reading = src?.ok ? src.reading : auto.t ? auto.reading : null;
    if (reading) return { points, sam, reading, ctx: reading === 'points' ? points : sam, q: src?.ok ? src.q : auto.q, ...P };
    const base = points.G ? points : sam;
    return { points, sam, reading: null, ctx: base.G ? { ...base, conf: new Float64Array(base.conf.length), unsure: auto.why } : base, unsure: auto.why, ...P };
  }
  /** Run r's shaft source in run scene k with the marks calib, the reading chosen automatically (lib/shaft-source.js shaftScene),
   *  kept like the rail. */
  #autoScene(r, k, calib, part = null) { return this.#railCtx(r, k, calib, 'auto', hintMemo, () => shaftScene(r, k, { calib, aspect: this.aspect, fused: r.channels?.fused, part }), part); }
  /** Run r's rail context in run scene k with the marks calib and a reading (lib/shaft.js railContext), kept per run, scene,
   *  marks, reading and aspect (memo / make: another per-scene record kept the same way). */
  #railCtx(r, k, calib, reading = 'sam', memo = railMemo, make = () => railContext(r, k, calib, { aspect: this.aspect, reading, motion: motionOf(r), part }), part = null) {
    const key = `${k}|${calib?.out ?? ''}|${calib?.hilt ?? ''}|${reading}|${this.aspect.toFixed(4)}|${part ?? ''}`;
    let m = memo.get(r);
    if (!m) memo.set(r, (m = new Map()));
    if (!m.has(key)) m.set(key, make());
    return m.get(key);
  }
  /** paw-4c48.10: can shot i of run r play the shaft (lib/shaft-source.js: a reading of the shaft that repeats with the strokes)
   *  as its source? -> {ok, k (the run scene), scene (shaftScene: the reading chosen, its share and periodicity), info (the
   *  composed record while it plays)} | {ok: false, why}. Never on SAM's confidence alone (paw-72z). */
  shaftOffer(r, i, part = null) {
    const s = this.scenes[i], W = part ? partWord(part) : 'Shaft';
    if (!r || !s) return { ok: false, why: `${W} belongs to a shot: detect scenes first` };
    if (r.restored || r.mod || !canSource(r, part ? partSource(part) : 'shaft')) {
      // paw-vhcd: a penis that was painted and passed over but not measured says why (the tracker's note), not "paint the penis"
      const tried = !part && (r.scenes || []).flatMap((x) => Object.values(x?.shaft || {})).find((rec) => rec && rec.role !== 'part' && rec.source === 'none');
      return { ok: false, why: part ? `no ${W} measured in this run: turn it on in the Groups tool and track again` : tried ? `the penis was not measured in this run${tried.note ? `: ${tried.note}` : ''}` : 'no shaft pass in this run: paint the penis and track again' };
    }
    const k = Math.max(0, sceneAt(r.scenes || [], (s.start_ms + s.end_ms) / 2)), calib = this.shotDerive(i, r.id)?.shaft || null;
    const sc = this.#autoScene(r, k, calib, part);   // paw-4c48.19: a depth part offered by the same rules
    return sc.t ? { ok: true, k, scene: sc, info: (part ? r.partSrc?.[part] : r.shaftSrc)?.[k] || null } : { ok: false, why: sc.why };
  }
  /** paw-4c48.10: the quiet hint on the source chip: shot i's shaft reading repeats with the strokes (periodicity >= PERIOD.HINT)
   *  over most of the shot and run r's points (its current source, as they play) read it differently (lib/shaft-source.js
   *  shaftDisagrees) -> {r, size, share, q, reading} | null. A suggestion to look, never a verdict. */
  shaftHint(r, i) {
    const o = this.shaftOffer(r, i), s = this.scenes[i];
    if (!o.ok || !(o.scene.q >= PERIOD.HINT) || this.shotSource(r, i) === 'shaft' || !r.points?.at?.length) return null;
    const d = shaftDisagrees(o.scene, r.points, Math.max(s.start_ms, r.range.start), Math.min(s.end_ms, r.range.end));
    return d && { ...d, q: o.scene.q, reading: o.scene.reading };
  }
  /** The inserted fraction at t (lib/shaft.js insertedAt): the Machine panel's hook (api.js insertedAt). */
  insertedAt(t) { const r = this.shaftRun(t); return r ? insertedAt(r, t, this.deriveAt(t)?.shaft, null, { aspect: this.aspect, motion: motionOf(r) }) : null; }   // (the penis's: the Machine panel's hook)
  /** insertedAt on many times (ascending), each run scene's shaft looked up once (api.js insertedSeries). */
  insertedSeries(times) { const memo = new Map(); return Array.from(times, (t) => { const r = this.shaftRun(t); return r ? insertedAt(r, t, this.deriveAt(t)?.shaft, memo, { aspect: this.aspect, motion: motionOf(r) }) : null; }); }
  /** Run r's shaft direction in shot i (lib/shaft.js shaftDirection) | null. */
  shaftDirection(r, i) { const s = this.scenes[i]; return r && s ? shaftDirection(r, sceneAt(r.scenes || [], (s.start_ms + s.end_ms) / 2), { aspect: this.aspect }) : null; }
  /** Mark the frame at t as where the shaft is fully out ('out') or hilted ('hilt') on its shot; null clears both. One undo step. */
  markShaft(kind, t = playheadFrameStart(this.app.player)) {
    const i = sceneAt(this.scenes, t);
    if (i < 0) return;
    // paw-4c48: clearing keeps the shot's knot place (its own line on the shaft strip)
    this.setDerive(i, { shaft: kind ? { [kind]: Math.round(t) } : { out: undefined, hilt: undefined } }, { label: kind ? `Shaft: ${kind === 'out' ? 'fully out' : 'hilted'} here` : 'Shaft: clear the marks' });
  }
  // ---- paw-4c48: the shaft strip (lib/shaft.js shaftState): the knot line per shot, the owner's truth marks, the scorecard.
  //      Nothing that makes the script reads any of it (derive.shaft.knot / scene.shaftTruth). ----
  /** Run r's shaft reading in its run scene k, with the calibration of the shot under the scene's middle | null. */
  shaftStateOf(r, k) {
    const sc = r?.scenes?.[k], m = sc ? (sc.start_ms + sc.end_ms) / 2 : (r?.range.start + r?.range.end) / 2, i = sceneAt(this.scenes, m);
    return r ? shaftState(r, k, { calib: i >= 0 ? this.shotDerive(i, r.id)?.shaft : null, aspect: this.aspect, grid: gridOf(this.app.player), part: this.shotPart(r, i) }) : null;   // paw-4c48.19
  }
  /** Shot i's truth marks for run id: [{k, t}] (out / hilt = the calibration marks, then scene.shaftTruth), by time. */
  shaftTruth(i, run = this.deriveRun(i)?.id) {
    const s = this.scenes[i], sh = i >= 0 ? this.shotDerive(i, run)?.shaft : null;
    if (!s) return [];
    return [...['out', 'hilt'].filter((k) => Number.isFinite(sh?.[k])).map((k) => ({ k, t: sh[k] })), ...(s.shaftTruth || [])].sort((a, b) => a.t - b.t);
  }
  /** The knot place on shot i (a raw share of the full length, lib/shaft.js knotAt; null = automatic). One undo step. */
  setShaftKnot(i, at, run = this.deriveRun(i)?.id) {
    return this.setDerive(i, { shaft: { knot: at == null ? undefined : at } }, { run, label: at == null ? 'Shaft: knot place automatic' : 'Shaft: knot place' });
  }
  /** A truth mark on the shot under t: kind (TRUTH_KINDS), at t (frame start; null = remove), replacing the one of that kind at
   *  `from` (a drag; null = add). out / hilt are the calibration marks (markShaft's). One undo step. */
  setShaftMark(kind, t, from = null, run = undefined) {
    const at = t ?? from, i = sceneAt(this.scenes, at);
    if (i < 0 || !TRUTH_KINDS.includes(kind)) return false;
    const label = `Shaft mark: ${KIND_TEXT[kind]}${t == null ? ' removed' : from != null ? ' moved' : ''}`;
    if (kind === 'out' || kind === 'hilt') { this.setDerive(i, { shaft: { [kind]: t == null ? undefined : Math.round(t) } }, { label, ...(run ? { run } : {}) }); return true; }
    const s = this.scenes[i], cur = s.shaftTruth || [];
    const rest = from == null ? cur : cur.filter((m) => !(m.k === kind && m.t === from));
    if (t != null && rest.some((m) => m.k === kind && m.t === Math.round(t))) return false;
    const list = [...rest, ...(t != null ? [{ k: kind, t: Math.round(t) }] : [])].sort((a, b) => a.t - b.t);
    const { shaftTruth: _, ...bare } = s;   // eslint-disable-line no-unused-vars
    const next = list.length ? { ...bare, shaftTruth: list } : bare, scenes = this.scenes.map((x, j) => (j === i ? next : x));
    this.app.transact(label, () => { this.app.doc.scenes = scenes; });
    return true;
  }
  /** The six marks' entry point (commands, the strip): kind at the frame on screen. */
  markTruth(kind) { return this.setShaftMark(kind, playheadFrameStart(this.app.player)); }
  /** Every shot a run covers: [{i, label, card}] + overall (lib/shaft.js shaftScore / scoreOverall). */
  shaftScorecards() {
    const rows = [], script = scriptOf(this.app, 'stroke');
    this.scenes.forEach((s, i) => {
      const m = (s.start_ms + s.end_ms) / 2, r = this.shaftRun(m) || this.deriveRun(i);
      if (!r || r.restored) return;
      const k = Math.max(0, sceneAt(r.scenes || [], m)), st = this.shaftStateOf(r, k);
      rows.push({ i, label: `shot ${i + 1}`, card: shaftScore(st, { t0: s.start_ms, t1: s.end_ms, script, truth: this.shaftTruth(i, r.id), calib: this.shotDerive(i, r.id)?.shaft }) });
    });
    return { rows, overall: scoreOverall(rows.map((x) => x.card)) };
  }
  /** "Shaft scorecard: all shots": a toast-sized summary, the table on the clipboard. */
  async shaftScoreAll() {
    const { rows, overall } = this.shaftScorecards(), text = scoreTable(rows, overall);
    if (!overall.withShaft) { this.app.toast?.('Shaft scorecard: no shot has a shaft pass (paint the penis and track)', 'quiet'); return text; }
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch { /* no clipboard here */ }
    const ev = EVENT_KINDS.reduce((a, k) => a + overall.events[k].truth, 0), hit = EVENT_KINDS.reduce((a, k) => a + overall.events[k].matched, 0);
    this.app.toast?.(`Shaft scorecard, ${overall.withShaft} of ${overall.shots} shots: ${Math.round(100 * overall.seen)} % seen, ${Math.round(100 * overall.hidden)} % hidden, ${Math.round(100 * overall.lost)} % lost; r ${overall.medianR ?? '–'}; marks matched ${hit} / ${ev}${copied ? ' (table copied)' : ''}`, 'info', { timeout: 10000 });
    return text;
  }
  /** The run shot i's signal comes from: its scene link's run, else the selected run if it covers the shot, else null. */
  deriveRun(i) {
    const s = this.scenes[i];
    if (!s) return null;
    // paw-1ysd: the run whose range plays here: the selected range (the strip), else the one under the playhead (read only when
    // the shot has several), else the one covering most of the shot; else the shot's link. Selecting a run in Runs only selects.
    const R = rangesIn(this.runRanges, s.start_ms, s.end_ms);
    let pick = (this.rangeSel && R.find((x) => x.id === this.rangeSel)) || null;
    if (!pick && R.length > 1) { const t = this.app.player?.timeMs; if (t >= s.start_ms && t < s.end_ms) pick = R.find((x) => t >= x.a && t < x.b) || null; }
    if (!pick && R.length) pick = R.reduce((m, x) => (x.b - x.a > m.b - m.a ? x : m));
    const r = pick && this.run(pick.run);
    if (r) return r;
    const l = this.sceneLink(i);
    return (l && this.run(l.runId)) || null;
  }
  /** Why shot i cannot be adjusted ('' = it can). needPts: a camera mode that needs the point tracks. */
  deriveBlockFor(i, needPts = false) {
    const r = this.deriveRun(i), s = this.scenes[i];
    if (!s) return 'Select a shot';
    if (!r) return 'No run covers this shot: track it with TAPNext++ first';
    return deriveBlock(r, { needPts, k: sceneAt(r.scenes || [], (s.start_ms + s.end_ms) / 2) });
  }
  /** The shots a derive edit on shot i reaches: scope 'shot' = [i], 'scene' = every shot of its scene. */
  #deriveShots(i, scope) { const r = scope === 'scene' ? sceneRange(this.scenes, i) : null; return r ? Array.from({ length: r[1] - r[0] + 1 }, (_, k) => r[0] + k) : [i]; }
  /**
   * Change shot i's derive: patch {cam?: partial (merged; null = auto), axis?: {...} | null (as tracked)}; patch null =
   * both back to as tracked. commit false = a drag's live step (preview only, no history); true = one undo step
   * (app.transact) that writes it to the shot(s) and drops the preview. scope 'scene': every shot of the scene. -> derive.
   */
  setDerive(i, patch, { commit = true, scope = 'shot', label = 'Adjust after tracking', run = this.deriveRun(i)?.id } = {}) {
    const s = this.scenes[i];
    if (!s) return null;
    const cur = this.shotDerive(i, run) || {};
    // patch null (Reset): back to as tracked, the shot's Smart stroke on / off kept (its own button; paw-lji3: a new run has it on)
    const next = patch === null ? deriveClean(typeof cur.smart === 'boolean' ? { smart: cur.smart, match: true } : null) : deriveClean({
      cam: 'cam' in patch ? (patch.cam === null ? null : { ...(cur.cam || camTagDefault(s)?.cam || {}), ...patch.cam, ...(camTagDefault(s) ? { explicit: true } : {}) }) : cur.cam,   // paw-hiq5: a choice beats the tag default, 'auto' too
      axis: 'axis' in patch ? patch.axis : cur.axis,
      fuse: 'fuse' in patch ? patch.fuse : cur.fuse,
      smart: 'smart' in patch ? patch.smart : cur.smart,
      held: 'held' in patch ? patch.held : cur.held,   // paw-rnv1
      anchorTo: 'anchorTo' in patch ? patch.anchorTo : cur.anchorTo,   // paw-2ntn
      strokes: 'strokes' in patch ? (patch.strokes === null ? null : { ...(cur.strokes || {}), ...patch.strokes }) : cur.strokes,
      shaft: 'shaft' in patch ? (patch.shaft === null ? null : { ...(cur.shaft || {}), ...patch.shaft }) : cur.shaft,   // paw-azd marks
      source: 'source' in patch ? patch.source : cur.source, against: 'against' in patch ? patch.against : cur.against,   // paw-9qm
      unflip: 'source' in patch ? patch.unflip : cur.unflip,   // paw-3atc: picking Shaft cleared the shot's flip; a later Adjust edit keeps that
      match: true,   // paw-s80k: its signal plays the same way up as the scene's own channel (runs-channel.js channelPatch)
    });
    const shots = this.#withComposed(this.#deriveShots(i, scope), run);   // paw-orm2: the run scene's other shots too
    if (!commit) { this.derivePreview = { t0: this.scenes[shots[0]].start_ms, t1: this.scenes[shots[shots.length - 1]].end_ms, derive: next, run }; return next; }
    this.derivePreview = null;
    const same = (x) => JSON.stringify(deriveClean(deriveOf(x, run))) === JSON.stringify(next);
    if (shots.some((k) => !same(this.scenes[k]))) {
      const list = this.scenes.map((x, k) => (shots.includes(k) ? withDerive(x, run, next) : x));
      this.app.transact(label, () => { this.app.doc.scenes = list; });
    }
    this.app.usage?.note('tracking:derive', { shot: i, scope, cam: next?.cam?.mode ?? 'auto', strength: next?.cam?.strength ?? 100, axis: next?.axis?.mode ?? 'tracked' });
    return next;
  }
  /** The channel run r's scene i signal is built from: its link / default, 'primary' resolved to the sidecar's pick there. */
  sceneSignal(r, i) {
    const c = this.shotSource(r, i), s = this.scenes[i];
    if (c !== 'primary' || !s) return c;
    const k = Math.max(0, sceneAt(r.scenes || [], (s.start_ms + s.end_ms) / 2));
    return decisionsOf(r.notes)[k]?.chosen || r.params?.primary || 'primary';
  }
  /** While a camera control is dragged (camPeek): the current shot's signal with no camera removal, {t, v} 0..1, for the
   *  lane (raw beside camera-removed, paw-bxo). null otherwise. */
  get camCompare() {
    if (!this.camPeek) return null;
    const i = this.currentScene, s = this.scenes[i], r = this.deriveRun(i);
    if (!s || !r || deriveBlock(r)) return null;
    const name = this.sceneSignal(r, i), off = { ...(this.shotDerive(i) || {}), cam: { mode: 'off' } };
    const c = deriveChannels(r, runDerives(r, this.scenes, { t0: s.start_ms, t1: s.end_ms, derive: off }), { aspect: this.aspect }).channels[name];
    if (!c) return null;
    const t = [], v = [];
    for (let j = 0; j < c.t.length; j++) if (c.t[j] >= s.start_ms && c.t[j] < s.end_ms) { t.push(c.t[j]); v.push(c.v[j]); }
    return t.length ? { t, v } : null;
  }
  /** paw-e3i: the fusion record of shot i's run scene when its signal is 'fused' (lib/fusion.js info: candidates with
   *  share / sign / lag, per-window weights), else null. paw-439e: inside a range override (span, default: fuseSpan(i)) the
   *  override's own record (runs-channel.js fuseSpans), null when the override is not fused. */
  fuseInfo(i, span = this.fuseSpan(i)) {
    const r = this.deriveRun(i), s = this.scenes[i];
    if (!r || !s) return null;
    if (span) return r.fuseSpans?.find((x) => x.t0 === span.t0 && x.t1 === span.t1)?.info || null;
    if (this.sceneSignal(r, i) !== 'fused') return null;
    return r.channels.fused?.info?.[Math.max(0, sceneAt(r.scenes || [], (s.start_ms + s.end_ms) / 2))] || null;
  }
  /** paw-439e: the range override the fusion controls of shot i act on (the panel, the pad): the row's active one (selected,
   *  else under the playhead: activeSpan) when it lies in shot i, else null (the shot's own). */
  fuseSpan(i) { const sp = this.activeSpan, s = this.scenes[i]; return sp && s && sp.t0 < s.end_ms && sp.t1 > s.start_ms ? sp : null; }
  /** Pin / exclude one fusion candidate in shot i (kind 'pin' | 'exclude'; again = release), of span (a range override) or
   *  the shot: one undo step. */
  toggleFusePart(i, id, kind, span = null) {
    const f = this.fuseControls(i, span), other = kind === 'pin' ? 'exclude' : 'pin';
    const has = (f[kind] || []).includes(id), next = { [kind]: has ? (f[kind] || []).filter((x) => x !== id) : [...(f[kind] || []), id], [other]: (f[other] || []).filter((x) => x !== id) };
    this.setFuse(i, { [kind]: next[kind].length ? next[kind] : null, [other]: next[other].length ? next[other] : null }, { span, label: `Fusion: ${has ? 'release' : kind} a part` });
  }
  /** paw-iasp: the fusion controls (lib/fusion.js derive.fuse: pad, prior, w, pin, exclude) of span (a range override) or,
   *  with none, of shot i for run id. */
  fuseControls(i, span = null, run = this.deriveRun(i)?.id) { return (span ? this.spanOver(span)?.fuse : this.shotDerive(i, run)?.fuse) || {}; }
  /** Merge patch into those controls (a key set to null goes back to its default): commit false = a drag's live step (the
   *  trace follows, no history), true = one undo step. Inside a range override the override is edited (paw-hiq5). */
  setFuse(i, patch, { commit = true, span = null, run = this.deriveRun(i)?.id, label = 'Fusion' } = {}) {
    if (commit) this.#liveEnd(); else this.#liveDrag(run);
    const next = { ...this.fuseControls(i, span, run) };
    for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
    if (span) return this.setSpan(span, { fuse: Object.keys(next).length ? next : undefined }, { commit, label });
    return !!this.setDerive(i, { fuse: next }, { commit, scope: this.deriveScope, label, run }) || commit;
  }
  /** paw-o60v.2: a fusion control (the pad, the panel's sliders) dragged and moved within the last REST_MS: {run} (that run;
   *  null id = any) composes for the trace only (runs-channel.js ctx.live: no HOW, no Detail) and the linked fills wait.
   *  The pointer resting REST_MS, the release or a cancel compose everything exactly, as a direct set would. */
  fuseLive = $state.raw(null);
  #liveDrag(run) {
    clearTimeout(this.timers.live);
    if (!this.fuseLive || this.fuseLive.run !== (run ?? null)) this.fuseLive = { run: run ?? null };
    this.timers.live = setTimeout(() => { this.fuseLive = null; }, REST_MS);
  }
  #liveEnd() { clearTimeout(this.timers.live); if (this.fuseLive) this.fuseLive = null; }
  #liveFor(r) { const l = this.fuseLive; return !!l && (l.run == null || l.run === r?.id); }
  /** paw-24b8: the shots with the positioning ranges of an Actions-strip drag (tl.draft.acts: a positioning range drawn,
   *  resized or moved) in, else the shots: the ease (bridgesOn) and the runs' mask (#maskOf) follow every drag step; the
   *  release writes the regions once (one undo step), Esc drops the draft. */
  get posScenes() {
    const d = tlFor(this.app).draft.acts, L = this.scenes, m = this.#posMemo;
    if (!d) return L;
    if (m?.d !== d || m.L !== L) this.#posMemo = { d, L, out: withPositioning(L, d) };
    return this.#posMemo.out;
  }
  #posMemo = null;
  /** paw-24b8: an Actions-strip drag stepped (done false) or ended / cancelled (true). While it moves a positioning range the
   *  runs compose for the trace only between rests, as a fusion drag (#liveDrag: a long run's full compose is ~0.5 s); the
   *  ease itself follows every step. */
  actsDrag(done = false) { if (done) this.#liveEnd(); else if (this.posScenes !== this.scenes) this.#liveDrag(null); }
  /** paw-439e: the standing fusion pad pinned as a small floating pad (TrackingLane): null = not pinned, else {x, y} (px). */
  fusePadPin = $state.raw(null);

  // ---- paw-qynw: reference stretches (lib/references.js): Tracker row right-click › Use as a reference… opens a review
  // strip over the stretch (ReferenceStrip.svelte); drag strikes out bad regions, Enter saves the record to
  // <data folder>/references/ (nothing beside the video), Esc cancels. score.mjs reads them as an unbiased score set. ----
  refEdit = $state.raw(null);   // {runId, t0, t1, struck} while the strip is open
  refList = $state.raw([]);     // this video's saved records [{path, rec}]
  /** The folder the records live in (null outside the app). */
  async refDir() {
    try { const d = (await this.app.backend?.appPaths?.())?.data_dir; return d ? d.replace(/[\\/]+$/, '') + (d.includes('\\') ? '\\' : '/') + REF_DIR : null; } catch { return null; }
  }
  /** The stretch a reference at t covers: the I-O range when t is inside it, else the shot at t, clipped to the ONE run
   *  linked over it -> {run, t0, t1} | {why}. */
  referenceStretch(t) {
    const g = this.app.doc.range, s = this.scenes[sceneAt(this.scenes, t)], inR = g && t >= g.t0 && t < g.t1;
    const a = inR ? g.t0 : s && s.start_ms <= t && s.end_ms > t ? s.start_ms : null, b = inR ? g.t1 : s?.end_ms;
    if (a == null || !(b > a)) return { why: 'Use as a reference: right-click a shot (or inside the I-O range)' };
    const ids = new Set();
    this.scenes.forEach((x, k) => { if (x.end_ms > a && x.start_ms < b) { const l = this.sceneLink(k); if (l?.runId) ids.add(l.runId); } });
    if (ids.size !== 1) return { why: ids.size ? 'Use as a reference: these shots use more than one tracker run (pick shots of one run)' : 'Use as a reference: no tracker run is linked here' };
    const run = this.run([...ids][0]), t0 = Math.max(a, run?.range.start ?? a), t1 = Math.min(b, run?.range.end ?? b);
    return run && t1 - t0 >= 1000 ? { run, t0, t1 } : { why: 'Use as a reference: less than a second of the run here' };
  }
  /** Open the reference strip at t (the stretch above). -> true | false (why toasted). */
  startReference(t) {
    const st = this.referenceStretch(t);
    if (st.why) { this.app.toast(st.why, 'warn'); return false; }
    this.refEdit = { runId: st.run.id, t0: st.t0, t1: st.t1, struck: [] };
    this.loadReferences();
    return true;
  }
  strikeRef(a, b) { const e = this.refEdit; if (e) this.refEdit = { ...e, struck: strike(e.struck, a, b, e.t0, e.t1) }; }
  unstrikeRef(t) { const e = this.refEdit; if (e) this.refEdit = { ...e, struck: unstrike(e.struck, t) }; }
  cancelReference() { this.refEdit = null; }
  /** The open strip -> its record (lib/references.js referenceRecord: self-describing), null when none. */
  referenceOf(e = this.refEdit) {
    const run = e && this.run(e.runId), proj = this.app.doc.project?.path || '';
    if (!run) return null;
    const shots = this.scenes.filter((x) => x.end_ms > e.t0 && x.start_ms < e.t1).map((x) => ({ t0: x.start_ms, t1: x.end_ms, tags: [...sceneWheres(x), ...sceneWhats(x)] }));
    return referenceRecord({ project: proj, runsFile: proj ? runsPath(proj) : '', mediaHash: this.app.doc.media?.hash?.value || '', run, t0: e.t0, t1: e.t1, struck: e.struck,
      points: scriptOf(this.app, 'stroke').map((q) => [q.at, q.pos]), axis: 'stroke', tags: shots.flatMap((x) => x.tags), shots });
  }
  /** Enter: write the record to <data folder>/references/<name>.json. -> its path | null. */
  async saveReference() {
    const rec = this.referenceOf(), be = this.app.backend, dir = await this.refDir();
    if (!rec) return null;
    if (!dir || typeof be?.writeText !== 'function') { this.app.toast('References are saved by the app (its data folder)', 'warn'); return null; }
    if (!rec.project) { this.app.toast('Save the project first: a reference points at its .pawproj and .pawruns', 'warn'); return null; }
    try {
      if (typeof be.makeDir === 'function') await be.makeDir(dir);
      const path = dir + (dir.includes('\\') ? '\\' : '/') + referenceName(rec);
      await be.writeText(path, JSON.stringify(rec, null, 1));
      this.refEdit = null;
      const kept = Math.round((rec.t1 - rec.t0 - rec.struck.reduce((x, [a, b]) => x + b - a, 0)) / 100) / 10;
      this.app.toast(`Reference saved: ${kept} s kept of run #${this.run(rec.run)?.n ?? '?'}${this.runsDirty ? ' (save the project too: the run must be in its .pawruns)' : ''}`, 'quiet');
      this.app.usage?.note('tracking:reference', { run: rec.run, t0: rec.t0, t1: rec.t1, struck: rec.struck.length });
      await this.loadReferences();
      return path;
    } catch (err) { this.app.toast('Could not save the reference: ' + (err?.message || err), 'error'); return null; }
  }
  /** This video's saved records (by media hash, else by project) -> refList. */
  async loadReferences() {
    const be = this.app.backend, dir = await this.refDir();
    if (!dir || typeof be?.listDir !== 'function') { this.refList = []; return []; }
    const hash = this.app.doc.media?.hash?.value || '', proj = this.app.doc.project?.path || '', out = [];
    try {
      if (!(await be.exists(dir))) { this.refList = []; return []; }
      for (const f of await be.listDir(dir, { ext: '.json' })) {
        try { const rec = referenceClean(JSON.parse(await be.readText(f.path))); if (rec && ((hash && rec.mediaHash === hash) || (proj && rec.project === proj))) out.push({ path: f.path, rec }); } catch { /* not a record */ }
      }
    } catch { /* no folder yet */ }
    this.refList = out.sort((x, y) => x.rec.t0 - y.rec.t0);
    return this.refList;
  }
  /** Remove a saved record (its file). */
  async removeReference(path) {
    try { await this.app.backend.remove(path); this.app.toast('Reference removed', 'quiet'); } catch (err) { this.app.toast('Could not remove the reference: ' + (err?.message || err), 'error'); }
    return this.loadReferences();
  }
  /** paw-e3i A/B: while the current shot has Smart stroke on, its points without it (the run recomposed with smart /
   *  strokes off there) as the preview ghost 'smart-ab', so both show over each other in the script lane. paw-89bd: only
   *  on a shot the owner switched on by hand in this session (smartABRun), not on every new run arriving with it on. */
  #publishSmartAB() {
    const i = this.currentScene, s = this.scenes[i], d = s ? this.shotDerive(i) : null, r = d?.smart ? this.smartABRun(i) : null;
    void this.runs; void this.links;
    if (this.fuseLive) return;   // paw-o60v.2: a fusion drag between rests: the A/B follows at the rest
    untrack(() => {
      const app = this.app, rest = (app.doc.ghosts || []).filter((g) => g.id !== SMART_AB);
      let script = [];
      if (r) {
        const off = { ...d }; delete off.smart; delete off.strokes;
        const p = channelPatch(r, r.channel, this.channelFit, this.links, { aspect: this.aspect, derives: runDerives(r, this.scenes, { t0: s.start_ms, t1: s.end_ms, derive: off }), flips: this.flipsOf(r) });
        script = pointsList(p.points0).filter((q) => q.at >= s.start_ms && q.at < s.end_ms);
      }
      const cur = (app.doc.ghosts || []).find((g) => g.id === SMART_AB), key = JSON.stringify(script);
      if ((!cur && !script.length) || (cur && cur.key === key)) return;
      app.doc.ghosts = script.length ? [...rest, { id: SMART_AB, key, name: 'Without Smart stroke', color: '#9AA3B2', axis: app.doc.activeAxis, script, visible: true, source: { kind: 'bridge-preview' } }] : rest;
    });
  }
  /** Smart stroke on shot i (fused parts + new strokes) on / off: one undo step. paw-lji3: off is kept (false), so it sticks
   *  on a run that arrived with it on. */
  setSmart(i, on) {
    const r = this.deriveRun(i), s = this.scenes[i];
    if (on && r && s) this.#smartHand = new Set(this.#smartHand).add(`${r.id}@${s.start_ms}`);   // paw-89bd: the A/B ghost may show
    this.setDerive(i, { smart: !!on },{ scope: this.deriveScope, label: on ? 'Smart stroke on' : 'Smart stroke off' });
  }
  /** paw-2ntn: where run id's strokes shorter than the range sit on shot i (runs-channel.js ANCHORS): 'full' while the shot's
   *  link stretches them (its envelope), else the shot's derive anchorTo ('in' / 'out'), else 'middle'. */
  anchorOf(i, id = this.deriveRun(i)?.id) {
    const s = this.scenes[i], l = s ? this.links[linkFor(this.links, s)] : null;
    return l?.run === id && l.envelope?.mode === 'auto' ? 'full' : this.shotDerive(i, id)?.anchorTo || 'middle';
  }
  /** '' or why shot i's anchor cannot become m (as the run row's carrier: the sidecar's own points have no channel; in / out:
   *  not where the depth is measured, which already says where the strokes sit). */
  anchorBlock(i, id = this.deriveRun(i)?.id, m = 'in') {
    const r = this.run(id);
    if (!this.scenes[i]) return 'Put the playhead inside a shot';
    if (!r) return 'No run plays this shot';
    const c = this.shotSource(r, i);
    if (c === 'primary' || !r.channels[c]) return "Pick a channel first (the sidecar's own points have no raw channel here)";
    if (m !== 'in' && m !== 'out') return '';
    return isShaftSource(c) ? 'The shaft measures the depth here: it already says where the strokes sit'
      : this.fuseInfo(i, null)?.depth?.used ? 'The depth chip seats the strokes on a measured level here' : '';
  }
  /** Shot i's anchor for run id to m: 'in' / 'out' / 'middle' = the shot's derive (one undo step), 'full' = the link's envelope
   *  (a carrier edit: not an undo step, as before). -> false when it cannot (anchorBlock). */
  setAnchor(i, m, id = this.deriveRun(i)?.id) {
    if (!ANCHORS.includes(m) || this.anchorBlock(i, id, m)) return false;
    const cur = this.anchorOf(i, id), want = m === 'in' || m === 'out' ? m : null;
    if (cur === m) return true;
    if ((this.shotDerive(i, id)?.anchorTo ?? null) !== want) this.setDerive(i, { anchorTo: want }, { run: id, label: `Anchor strokes: ${m}` });
    if ((cur === 'full') !== (m === 'full')) this.setCarrier(id, i, { envelope: { mode: m === 'full' ? 'auto' : 'off' } });
    this.app.usage?.note('tracking:anchor-strokes', { shot: i, from: cur, to: m });
    return true;
  }
  /** The shot at the playhead: its anchor to the next one (middle -> in -> out -> full -> middle), said in a toast. */
  cycleAnchor(t = this.app.player.timeMs) {
    const i = this.scenes.findIndex((s) => s.start_ms <= t && s.end_ms > t), why = i < 0 ? 'Put the playhead inside a shot' : this.anchorBlock(i, undefined, 'full');
    if (why) { this.app.toast(`Anchor: ${why}`, 'quiet'); return false; }
    let k = ANCHORS.indexOf(this.anchorOf(i)), m;
    do m = ANCHORS[(k = (k + 1) % ANCHORS.length)]; while (this.anchorBlock(i, undefined, m));   // (middle / full are never blocked here)
    this.setAnchor(i, m);
    this.app.toast(`Anchor strokes: ${m} (shot ${shotLabel(this.scenes, i)})`, 'quiet');
    return true;
  }
  /** paw-89bd: shot i's run when Smart stroke was switched on there by hand in this session (the grey "Without Smart
   *  stroke" ghost compares against it), else null: a new run arrives with it on (paw-lji3) and shows no ghost. */
  smartABRun(i) {
    const r = this.deriveRun(i), s = this.scenes[i];
    return r && s && this.#smartHand.has(`${r.id}@${s.start_ms}`) ? r : null;
  }
  #smartHand = $state(new Set());   // run id @ shot start, switched on by hand (not saved)
  /** paw-rnv1: shot i's characters drawn on twos / threes (lib/held.js) in its run scene: {text (plain words, '' = none
   *  found), on (the retime applies), own (chosen on this shot)} | null (no run). */
  heldAt(i) {
    const r = this.deriveRun(i), s = this.scenes[i];
    if (!r || !s || r.restored) return null;
    const k = Math.max(0, sceneAt(r.scenes || [], (s.start_ms + s.end_ms) / 2)), d = this.shotDerive(i, r.id);
    const sc = heldScenes(r, this.aspect).find((x) => x.k === k);
    return { text: heldText(sc?.chars, (w) => (w.startsWith('sem_') ? partLabel(w.slice(4)) : whoName(w))), on: heldOn(d), own: typeof d?.held === 'boolean' };
  }
  /** The twos / threes retime on shot i on / off (the default writes nothing): one undo step. */
  setHeld(i, on) { this.setDerive(i, { held: on === HELD.DEFAULT ? undefined : on }, { scope: this.deriveScope, label: `Twos / threes retime ${on ? 'on' : 'off'}` }); }
  /** Points of the selected / shot run: why each exists at `at` ('turn' | 'detail' | 'end' | 'clamped'), '' unknown. */
  whyAt(r, at) { const w = r?.whys; if (!w) return ''; const k = w.at.indexOf(at); return k >= 0 ? w.why[k] : ''; }
  /** Why the run point at `at` exists, as a short phrase for the script lane's hover ('' when no strokes-step run made a
   *  point there): the run linked to the shot at `at`, else the selected run. */
  pointWhyText(at) {
    const k = sceneAt(this.scenes, at), r = (k >= 0 ? this.deriveRun(k) : null) || this.selected, w = this.whyAt(r, at);
    return w ? `from the run: ${WHY_SHORT[w] || w}` : '';
  }
  /** Drop a drag's preview (Esc / a cancelled drag). */
  cancelDerive() { if (this.derivePreview) this.derivePreview = null; if (this.detailPreview) this.detailPreview = null; this.#liveEnd(); }
  /** paw-cfaz: nothing that writes (Save / Publish / Export / pack: lib/finish.js finalAxes through app.beforeWrite; Bake)
   *  reads a drag's preview (flip, derive, Detail, signal override, fusion): every one is dropped and the runs recompose
   *  without them, now. -> true when one was set. */
  dropPreviews() {
    if (!(this.flipPreview || this.derivePreview || this.detailPreview || this.signalPreview || this.fuseLive)) return false;
    this.flipPreview = null; this.signalPreview = null;
    this.cancelDerive();
    this.#deriveKeys.clear();   // every run composes again (a run composed straight from a preview has no key of it)
    this.#rederive();
    this.syncFills();
    return true;
  }

  // ---- stroke Detail (paw-izk, lib/detail.js): a scene default, shot and area overrides, stored on the scene ----
  detailPreview = $state.raw(null);   // the scenes as a Detail drag would leave them (no history); the release writes once
  detailLevel = $state('scene');      // what the Strokes section edits: 'scene' (default) | 'shot' | 'area'
  /** The area an area override of shot i's scene covers: the I-O range, else the loop under the playhead, clipped to the
   *  scene; null when there is none (or it misses the scene). */
  detailArea(i) {
    const d = sceneDetail(this.scenes, i), app = this.app, now = app.player.timeMs;
    const r = app.doc.range || (app.doc.loops || []).find((l) => now >= l.t0 && now < l.t1);
    if (!d || !r) return null;
    const t0 = Math.max(d.t0, Math.round(r.t0)), t1 = Math.min(d.t1, Math.round(r.t1));
    return t1 > t0 ? { t0, t1 } : null;
  }
  /** The span `level` means on shot i: null (the scene default), the shot, or the area (null when there is none). */
  detailSpan(i, level) { const s = this.scenes[i]; return !s || level === 'scene' ? null : level === 'shot' ? { t0: s.start_ms, t1: s.end_ms } : this.detailArea(i); }
  /** The setting shown at `level` on shot i: the override there if one covers it all, else what it inherits. */
  detailShown(i, level = this.detailLevel) {
    const L = this.detailPreview || this.scenes, d = sceneDetail(L, i), sp = this.detailSpan(i, level);
    if (!d) return null;
    if (!sp) return { shape: d.shape, sens: d.sens, own: !!detailClean(L[d.lo].detail)?.shape };
    const o = d.spans.findLast((x) => x.t0 <= sp.t0 && x.t1 >= sp.t1), m = detailAt(L, (sp.t0 + sp.t1) / 2);
    return o ? { shape: o.shape, sens: o.sens, own: o.t0 === sp.t0 && o.t1 === sp.t1 } : { shape: m.shape, sens: m.sens, own: false };
  }
  /**
   * Set the Detail at `level` on shot i (setting null = clear there: back to what it inherits). commit false = a drag's
   * live step (detailPreview); true = one undo step. Only the Detail changes: the shots keep the path their points come
   * from, and so their turns (paw-otoh: it used to turn the strokes step on, which re-made every stroke). -> whether
   * anything changed.
   */
  setDetailAt(i, level, setting, { commit = true, span = undefined } = {}) {
    const sp = span !== undefined ? span : this.detailSpan(i, level);
    if (level === 'area' && !sp) return false;
    const list = setDetail(this.scenes, i, setting, sp);
    if (!commit) { this.detailPreview = list; return true; }
    this.detailPreview = null;
    if (list === this.scenes || JSON.stringify(list) === JSON.stringify(this.scenes)) return false;
    const where = sp ? (level === 'shot' ? 'shot' : 'area') : 'scene';
    this.app.transact(setting ? `Detail: ${SHAPE_NAMES[setting.shape] || setting.shape} (${where})` : `Detail: back to the scene default (${where})`, () => { this.app.doc.scenes = list; });
    this.app.usage?.note('tracking:detail', { shot: i, level: where, shape: setting?.shape ?? 'clear', sens: setting?.sens ?? null });
    return true;
  }
  /** Overrides of shot i's scene: [{t0, t1, shape, sens, shot (index or -1)}]. */
  detailOverrides(i) { const d = sceneDetail(this.scenes, i); return d ? d.spans.map((s) => ({ ...s, shot: spanShot(this.scenes, s) })) : []; }
  /** Every override in the document (for the Tracker row's marker strip). */
  get allDetailOverrides() { return sceneRuns(this.scenes).flatMap(([lo]) => this.detailOverrides(lo)); }

  // ---- paw-wg2d: anchors (lib/anchors.js): a frame of a shot marked fully in / fully out / middle; fusion solves the shot
  // backwards to them. Stored on the shot (undoable, kept through a re-track). A drag's steps go through detailPreview (the
  // scenes as the drag leaves them) with the fusion drag's trace-only compose; the release is one undo step ----
  /** The anchors as drawn (a drag's preview while one moves): [{shot, ms, pos}]. */
  get anchors() { return anchorsOf({ scenes: this.detailPreview || this.scenes }); }
  /** An anchor of pos at the playhead's frame; the same kind there again takes it off. One undo step. */
  anchorAt(pos, t = playheadFrameStart(this.app.player)) {
    const app = this.app, r = putAnchor(this.scenes, t, pos, (app.player.frameMs || 1000 / 30) / 2);
    if (!r) { app.toast('Anchors go on a shot: detect scenes first, then park on a frame inside one', 'warn'); return false; }
    const word = ANCHOR_WORD[pos], n = shotAnchors(r.list[r.shot]).length, key = app.commands?.keysFor?.(ANCHOR_CMD[pos])?.[0] || '';
    app.transact(r.did === 'remove' ? `Anchor removed (${word})` : `Anchor: ${word}`, () => { app.doc.scenes = r.list; });
    app.usage?.note('tracking:anchor', { pos, did: r.did, shot: r.shot, n });
    const fused = this.deriveRun(r.shot) && this.shotSource(this.deriveRun(r.shot), r.shot) === 'fused';
    // paw-tymw: anchors act per section and change nothing where the automatic mix already agrees (paw-ze8n): composed now
    // (the effect then finds it done), so the toast says when this one changed nothing, and why
    let why = '';
    if (r.did !== 'remove' && !fused) why = pos === 50 ? ' · this shot is not playing Fused: a middle anchor waits until it does' : ' · this shot is not playing Fused: anchors only set its depth';
    else if (r.did !== 'remove') { this.#rederive(); why = anchorEffect(this.fuseInfo(r.shot)?.anchors, t, (app.player.frameMs || 1000 / 30) / 2); }
    app.toast(r.did === 'remove' ? `Anchor taken off (${n} left on shot ${shotLabel(this.scenes, r.shot)})` : `${word[0].toUpperCase() + word.slice(1)} at ${fmtTime(t)} · ${n} anchor${n === 1 ? '' : 's'} on shot ${shotLabel(this.scenes, r.shot)}${why}${key ? ` · ${key} here again takes it off` : ''}`, 'quiet');
    return true;
  }
  /** Anchor a ({ms, pos}) moved to toMs (frame-snapped, inside its shot): commit false = a drag's step (the fused trace follows,
   *  no history), true = one undo step. null toMs = removed. */
  moveAnchor(a, toMs, { commit = true } = {}) {
    const ms = toMs == null ? null : this.app.player.snap(toMs), list = moveAnchor(this.scenes, a, ms);
    if (!commit) { this.detailPreview = list; this.#liveDrag(null); return; }
    this.detailPreview = null; this.#liveEnd();
    if (list === this.scenes || JSON.stringify(list) === JSON.stringify(this.scenes)) return;
    this.app.transact(ms == null ? `Anchor removed (${ANCHOR_WORD[a.pos]})` : `Anchor moved (${ANCHOR_WORD[a.pos]})`, () => { this.app.doc.scenes = list; });
  }
  /** Every anchor of shot i off: one undo step. */
  clearAnchors(i) {
    const s = this.scenes[i];
    if (!s?.anchors) return;
    const { anchors: _, ...rest } = s;   // eslint-disable-line no-unused-vars
    this.app.transact('Anchors of the shot removed', () => { this.app.doc.scenes = this.scenes.map((x, k) => (k === i ? rest : x)); });
  }

  // Simplify to this detail: existing points re-fitted to the stroke-shape model (lib/detail.js simplifyScript),
  // previewed as a ghost, one undo step on accept
  simplify = $state.raw(null);   // {t0, t1, what, axis, n0, n1} while the preview shows
  /** The span Simplify acts on: the selected points (3 or more), else the selected shots, else the current scene. */
  simplifyScope() {
    const app = this.app, sel = app.doc.selection, ats = sel?.axis === app.doc.activeAxis ? [...(sel.ats || [])] : [];
    if (ats.length >= 3) return { t0: Math.min(...ats), t1: Math.max(...ats), what: `${ats.length} selected points` };
    const L = this.scenes, sh = (tlFor(this.app).shots || []).filter((k) => L[k]);
    if (sh.length) return { t0: L[sh[0]].start_ms, t1: L[sh[sh.length - 1]].end_ms, what: sh.length === 1 ? 'the selected shot' : `${sh.length} selected shots` };
    const i = this.currentScene, r = i >= 0 ? sceneRange(L, i) : null;
    return r ? { t0: L[r[0]].start_ms, t1: L[r[1]].end_ms, what: 'this scene' } : null;
  }
  /** The active axis with [t0, t1] simplified to the Detail there. */
  #simplified(t0, t1) {
    const cur = scriptOf(this.app);
    return simplifyScript(cur, t0, t1, shapeAt({ shapes: detailSpans(this.scenes, t0, t1 + 1) }), { minIntervalMs: STROKES.minIntervalMs, maxSpeed: STROKES.maxSpeed });
  }
  /** Show the preview (a ghost) for the scope. -> the preview or null (nothing to do). */
  simplifyPreview(scope = this.simplifyScope()) {
    const app = this.app;
    if (!scope) { app.toast('Simplify: select points, shots or a scene first', 'quiet'); return null; }
    const cur = scriptOf(app), next = this.#simplified(scope.t0, scope.t1);
    const n0 = cur.filter((p) => p.at >= scope.t0 && p.at <= scope.t1).length, n1 = next.filter((p) => p.at >= scope.t0 && p.at <= scope.t1).length;
    if (next === cur) { app.toast(`Simplify: ${scope.what} already fit this detail (it only takes points away; a live shot plays the run at its detail already)`, 'quiet'); this.simplify = null; return null; }
    this.simplify = { t0: scope.t0, t1: scope.t1, what: scope.what, axis: app.doc.activeAxis, n0, n1 };
    app.toast(`Simplify ${scope.what}: ${n0} → ${n1} points (the gold ghost)`, 'quiet', { action: { label: 'Use', run: () => this.simplifyAccept() } });
    return this.simplify;
  }
  /** Write the simplified points (recomputed from the axis as it is now): one undo step. -> points written. */
  simplifyAccept() {
    const s = this.simplify, app = this.app;
    if (!s) return 0;
    this.simplify = null;
    const cur = scriptOf(app, s.axis), next = s.axis === app.doc.activeAxis ? this.#simplified(s.t0, s.t1) : cur;
    if (next === cur) return 0;
    app.edit(`Simplify to this detail (${s.what})`, s.axis, next);
    app.usage?.note('tracking:simplify', { n0: s.n0, n1: s.n1 });
    return next.length;
  }
  simplifyCancel() { this.simplify = null; }
  #publishSimplify() {
    const s = this.simplify, app = this.app;
    void app.doc.axes; void app.doc.scenes; void app.doc.activeAxis;
    untrack(() => {
      const rest = (app.doc.ghosts || []).filter((g) => g.id !== SIMPLIFY);
      const script = s ? this.#simplified(s.t0, s.t1).filter((p) => p.at >= s.t0 && p.at <= s.t1) : [];
      const cur = (app.doc.ghosts || []).find((g) => g.id === SIMPLIFY), key = JSON.stringify(script);
      if ((!cur && !script.length) || (cur && cur.key === key)) return;
      app.doc.ghosts = script.length ? [...rest, { id: SIMPLIFY, key, name: 'Simplified to the detail', color: '#E0B04A', axis: s.axis, script, visible: true, source: { kind: 'bridge-preview' } }] : rest;
    });
  }
  /** The stroke axis shot i uses now: its derive's, else its run's as tracked ({mode, x0..y1}), else null. */
  shotAxis(i) { const d = this.shotDerive(i), r = this.deriveRun(i); return d?.axis || (r ? trackedAxis(r) : null); }
  // ---- the video overlay's run frame (overlay-pick.js): only data of the frame on show ----
  /** {run, fr, i, tMin, tMax} the overlay draws at t, or null. Selected shots (tl.shots) limit it unless settings
   *  tracking.blobs.follow is 'playhead'. */
  overlayFrame(t) {
    const tl = tlFor(this.app), k = sceneAt(this.scenes, t), l = k >= 0 && this.scenes[k].start_ms <= t && this.scenes[k].end_ms > t ? this.sceneLink(k) : null;
    return overlayPick({ runs: this.runs, selected: this.selected, linked: l ? this.run(l.runId) : null, visible: (r) => this.ghost(r.id)?.visible !== false,
      t, frameMs: this.app.player.frameMs, follow: this.app.settings.get('tracking.blobs.follow', 'selection'), span: selectionSpan(this.scenes, tl.shots.length ? tl.shots : tl.scene >= 0 ? [tl.scene] : []) });
  }

  // ---- the stabilised preview (paw-2zy): the video plays with the camera's drift removed (player.stab) ----
  stabilised = $state(false);
  /** The run whose camera path stabilises t: the one linked to the shot at t, else the selected run, else a visible run
   *  covering t; each must have cam_x / cam_y (points trackers). null when none. */
  stabRun(t) {
    const has = (r) => r && r.range.start <= t && r.range.end > t && r.channels?.cam_x && r.channels?.cam_y;
    const i = sceneAt(this.scenes, t), l = i >= 0 ? this.sceneLink(i) : null, linked = l && this.run(l.runId);
    if (has(linked)) return linked;
    if (has(this.selected)) return this.selected;
    return this.runs.findLast((r) => !r.tag && this.ghost(r.id)?.visible !== false && has(r)) ?? null;
  }
  /** Stabilised preview on / off (track.stabilise). -> on. */
  toggleStabilise(on = !this.stabilised) {
    const app = this.app, t = app.player.timeMs;
    if (on && !this.stabRun(t)) { app.toast('Stabilize: no camera path here, track this shot with a point tracker first', 'info'); return false; }
    this.stabilised = on;
    // the shot's camera settings (paw-a3n: mode, strength, smoothing; zoom / rotation too) drive what is taken out
    app.player.stab = on ? (u) => { const r = this.stabRun(u); return r ? cameraAtT(r, this.deriveAt(u, r.id), u, this.aspect) : null; } : null;
    app.usage?.note('tracking:stabilise', { on });
    if (on) app.toast('Stabilized preview: camera motion removed (path of ' + this.stabRun(t).id + ')', 'quiet');
    return on;
  }
  /** Scenes contain shots: each take in [a, b) that follows a hard cut inside a scene whose groups were drawn in another
   *  take gets them re-found on its first frame (suggest_groups with prior, PROTOCOL v4.13): same names (so the channels
   *  continue), stored unconfirmed (the Groups tool shows them dotted: Accept or repaint). Needs the tagger (GPU); a
   *  failure only means the take is tracked without them. -> number of takes re-found. */
  async refindGroups(a, b, { owner = '' } = {}) {
    let n = 0;
    for (let i = 0; i < this.scenes.length; i++) {
      const s = this.scenes[i], tk = takeRange(this.scenes, i);
      if (!tk || tk[0] !== i || s.end_ms <= a || s.start_ms >= b) continue;
      const prior = priorFor(this.scenes, i), last = this.scenes[tk[1]];
      if (!prior.length || skipReason(this.liveScenes()[i])) continue;
      const r = await this.job('groups', suggestGroupsRequest({ video: this.videoPath, start_ms: s.start_ms, end_ms: last.end_ms, params: { seed_frame: this.params?.seed_frame || 'first' }, prior }),
        { owner, title: 'Finding the groups again after a cut', scene: i, range: { t0: s.start_ms, t1: last.end_ms } });
      if (r.cancelled || r.error) { if (r.error) console.info('[tracking] re-find groups:', r.error); this.app.usage?.note('tracking:groupsRefind', { auto: true, error: !!r.error }); continue; }
      const res = r.result || {}, t = Number.isFinite(res.t_ms) ? res.t_ms : s.start_ms, size = maskSize(this.aspect);
      const found = suggestedGroups(res, t, [], (poly) => encodeMask(rasterPoly(poly, size))).filter((g) => g.unconfirmed);
      this.app.usage?.note('tracking:groupsRefind', { auto: true, prior: prior.length, refound: found.length, missing: res.missing?.length || 0 });
      if (!found.length) continue;
      this.app.transact('Groups: re-found after a cut', () => { this.app.doc.scenes = setTakeGroups(this.scenes, i, found); });
      n++;
      this.app.toast(`Shot at ${(s.start_ms / 1000).toFixed(1)} s: ${found.length} of ${prior.length} groups found again after the cut (unconfirmed)${res.missing?.length ? `, not found: ${res.missing.join(', ')}` : ''}`, 'quiet');
    }
    return n;
  }
  /** The scene a pick on run r goes to: the current scene if r overlaps it, else the scene r overlaps most; -1 none. */
  sceneOf(r) { return sceneForRun(this.scenes, { t0: r.range.start, t1: r.range.end }, this.currentScene); }
  /** The channel run r uses in scene i (default: sceneOf(r)): that scene's link if it is r's, else r's default. */
  channelFor(r, i = r ? this.sceneOf(r) : -1) {
    if (!r) return 'primary';
    // paw-orm2: the link its run scene is composed from (runs-channel.js sceneChannels: the one overlapping the run scene most)
    const s = this.scenes[i] && (this.composedWith(i, r.id, false)?.scene || this.scenes[i]), mine = s ? this.links.filter((l) => l.run === r.id) : [], l = s && mine[linkFor(mine, s)];
    return l && (l.channel === 'primary' || r.channels[l.channel]) ? l.channel : r.channel;
  }
  #recompose(id, channel) {
    const r = this.run(id), cx = r && this.#ctx(r);
    if (!r) return;
    const p = channelPatch(r, channel ?? r.channel, this.channelFit, this.links, cx);
    if (cx.live) { const { points0: _a, points0Primary: _b, whys: _c, low: _d, depthUsed: _e, ...trace } = p; this.applyRunPatch(r, trace, { live: true }); return; }   // paw-o60v.2: the drag paints the trace; its points wait for the rest
    this.applyRunPatch(r, p);
  }
  /** channelPatch's ctx for run r: the aspect and its run scenes' shot derives (lib/rederive.js runDerives). */
  #ctx(r) { if (r?.derived) return this.#fillCtx(r); return { aspect: this.aspect, derives: runDerives(r, this.detailPreview || this.scenes, this.derivePreview), spans: this.#spansOf(r), picAt: picturesOf(this.app), loopAvg: this.loopAvg, flips: this.flipsOf(r), ...this.#maskOf(r), ...(this.#liveFor(r) ? { live: true } : {}) }; }
  /** paw-2lp7.1: the positioning ranges over run r ({mask: [[t0, t1]]} | {}): channelPatch leaves them out of every calibration. */
  #maskOf(r) { const m = r?.range ? positioningOf(this.posScenes).filter(([a, b]) => b > r.range.start && a < r.range.end) : []; return m.length ? { mask: m } : {}; }
  /** paw-ef73.5: what averaging a loop's passes needs (lib/loop-average.js averagedRun / loopStates). */
  get loopAvg() { return { loops: this.app.doc.loops || [], ix: repeatsOf(this.app), fm: gridOf(this.app.player) || 1000 / 30 }; }
  /** paw-9qm: the range overrides over run r's range (the drag preview while an end is dragged). */
  #spansOf(r) { return r?.range ? [...this.signalSpans, ...(r.mod ? [] : measureSpans(this.app.doc.fx, this.runs))].filter((s) => s.t1 > r.range.start && s.t0 < r.range.end) : []; }   // + the modifiers' measures (paw-ef73.26)
  /** -> the run id the scene's link pointed at before (or undefined). The scene's carrier (baseline / envelope) stays on
   *  a re-pick of the same run: knots only with the same channel (they are in its units), auto with any channel. */
  #putLink(i, run, channel) {
    const s = this.scenes[i], k = linkFor(this.links, s), fit = this.channelFit, old = this.links[k], prev = old?.run;
    const same = old?.run === run, e = same && old.envelope;
    const b = same && old.baseline && (old.channel === channel ? old.baseline : old.baseline.mode === 'auto' ? { mode: 'auto' } : null);
    const link = { t0: s.start_ms, t1: s.end_ms, run, channel, ...(channel !== 'primary' && Object.keys(fit).length ? { fit: { ...fit } } : {}),
      ...(channel !== 'primary' && b ? { baseline: b } : {}), ...(channel !== 'primary' && e ? { envelope: e } : {}) };
    this.links = k >= 0 ? this.links.map((l, j) => (j === k ? link : l)) : [...this.links, link].sort((a, b) => a.t0 - b.t0);
    if (k < 0) this.knotSel = null;   // a link was inserted: the knot's link index {k, j} may now point at another run's link
    this.app.history?.markDirty?.();
    return prev;
  }
  // ---- carrier: a scene link's baseline / envelope (runs-channel.js carriers); not undo steps, like channel picks ----
  knotSel = $state.raw(null);      // {k: link index, j: knot index}: the knot the Tracker row last clicked (Delete removes it)
  laneFocused = $state(false);     // the Tracker row's canvas has DOM focus (the knot keys only fire then)
  /** Scene i of run id: patch its link's carrier ({baseline?, envelope?}; mode 'off' drops the field). No link yet: one is
   *  made with the channel the scene uses (a channel of the run's own; not 'primary'). -> the link index, or -1. */
  setCarrier(id, i, patch) {
    const r = this.run(id), s = this.scenes[i];
    if (!r || !s) return -1;
    let k = linkFor(this.links, s);
    if (this.links[k]?.run !== id) {
      const ch = this.channelFor(r, i);
      if (ch === 'primary' || !r.channels[ch]) return -1;
      const prev = this.#putLink(i, id, ch);
      if (prev && prev !== id) this.#recompose(prev);
      k = linkFor(this.links, s);
    }
    if (this.links[k].channel === 'primary') return -1;
    this.patchLink(k, patch);
    return k;
  }
  /** Link k's carrier fields: {baseline?, envelope?} (mode 'off' with no kept knots = removed). commit false: a drag's live preview (the store
   *  and the points follow; the document is marked dirty on the release). */
  patchLink(k, patch, commit = true) {
    const l = this.links[k];
    if (!l) return;
    const next = { ...l, ...patch };
    for (const f of ['baseline', 'envelope']) if (next[f] == null || (next[f].mode === 'off' && !next[f].knots?.length)) delete next[f];
    this.links = this.links.map((x, j) => (j === k ? next : x));
    if (commit) {
      this.app.history?.markDirty?.();
      // paw-r73w: baseline / envelope / knot edits (knots before -> after says added, removed or moved)
      const b = patch.baseline, e = patch.envelope;
      this.app.usage?.note('tracking:carrier', { ...(b ? { baseline: b.mode, knots: b.knots?.length ?? 0, was: l.baseline?.knots?.length ?? 0 } : {}), ...(e ? { envelope: e.mode } : {}) });
    }
    this.#recompose(l.run);
  }
  /** Delete the selected knot (tracking.knotDelete); the last one turns the baseline back to auto. */
  deleteKnot(sel = this.knotSel) {
    const knots = this.links[sel?.k]?.baseline?.knots;
    if (!knots?.[sel.j]) return;
    this.knotSel = null;
    const rest = knots.filter((_, j) => j !== sel.j);
    this.patchLink(sel.k, { baseline: rest.length ? { mode: 'knots', knots: rest } : { mode: 'auto' } });
  }
  /** The live link of scene i: {runId, channel, ghost} (its ghost exists), else null. */
  sceneLink(i) {
    const s = this.scenes[i], k = s ? linkFor(this.links, s) : -1;
    const l = this.links[k], ghost = l && this.ghost(l.run);
    return ghost ? { runId: l.run, channel: l.channel, ghost } : null;
  }
  /** Scene i uses channel `channel` of run runId (setChannel with a scene: only scene i changes). -> false when the
   *  scene, the run (this session's or restored from its ghost) or the channel does not exist. */
  linkScene(i, runId, channel) {
    const r = this.run(runId);
    if (!this.scenes[i] || !r || (channel !== 'primary' && !r.channels[channel] && !(channel === 'fused' && canFuse(r)) && !(relParse(channel) && relSources(channel).every((n) => r.channels[n])))) return false;
    this.setChannel(runId, channel, i);
    return true;
  }
  /** Runs with no record yet: the project's .pawruns runs (fileRuns; they replace ghost-rebuilt ones), then runs rebuilt
   *  from ghosts that kept a channel pick (ghost.source.keep). A file run whose ghost is missing gets it back. */
  restoreRuns() {
    const fileIds = new Set(this.fileRuns.map((r) => r.id));
    let runs = this.runs.filter((r) => !(r.restored && fileIds.has(r.id) && !this.fileRuns.includes(r)));
    const have = new Set(runs.map((r) => r.id)), fromFile = this.fileRuns.filter((r) => !have.has(r.id));
    runs = [...runs, ...fromFile];
    const ids = new Set(runs.map((r) => r.id));
    runs = [...runs, ...this.ghosts.filter((g) => !ids.has(g.id)).map((g) => runFromGhost(g, this.links, { aspect: this.aspect, loopAvg: this.loopAvg, flips: this.flipsOf({ id: g.id, scenes: g.source?.keep?.scenes }) })).filter(Boolean)];
    if (runs.length !== this.runs.length || runs.some((r, i) => r !== this.runs[i])) this.runs = runs;
    const lost = fromFile.filter((r) => !r.ref && !this.ghost(r.id));
    if (lost.length) this.app.doc.ghosts = [...this.ghosts, ...lost.map((r) => this.ghostOf(r, r.visible !== false))];
  }
  /** Read the open project's <stem>.pawruns (project block 'runs' load: every open / restore / close). Restored from an
   *  autosave (autosaveDir): its runs.pawruns wins when it is at least as new as the project's file. */
  loadRunsFile(autosaveDir = null) {
    const proj = this.app.doc.project?.path, be = this.app.backend, seq = ++this.runsSeq;
    this.fileRuns = [];
    this.runsFile = proj ? { path: runsPath(proj), ok: false } : null;
    this.runsLoad = null;
    this.runsDirty = false;
    this.#runsPending = false;
    this.#gone = new Map();
    this.#fillSeen = new Set();   // another document: its fills are announced as new (a fill id is only its shot's start)
    if ((!proj && !autosaveDir) || typeof be.readBytes !== 'function') return;
    this.#runsPending = true;   // paw-3xif: the linked shots' fills wait for the source runs (syncFills)
    // (paw-o60v.5: read in byte ranges, decoded and composed a run per slice: the document is up meanwhile, the runs land
    // together, no step holds the main thread for long)
    const file = this.runsFile, read = async (path) => { try { return { runs: await decodeRunsAsync(await readInParts(be, path)) }; } catch (e) { return { error: e }; } };
    const mtime = async (path) => { try { return (await be.stat(path))?.mtime_ms ?? 0; } catch { return 0; } };
    // (the picture first: the range reads share the asset protocol with the video's own, so they start once it has its
    // metadata, or after 5 s)
    const ranged = /^(https?|asset):/.test(be.mediaUrl?.(file?.path || autosaveDir) || ''), pl = this.app.player;
    this.runsLoad = (async () => { try {
      for (const t0 = performance.now(); ranged && pl && this.app.doc.media && !pl.ready && !pl.error && seq === this.runsSeq && performance.now() - t0 < 5000;) await new Promise((r) => setTimeout(r, 30));
      let runs = null;
      if (file) {
        const at = await mtime(file.path), r = await read(file.path), key = r.runs && runsFileKey(r.runs);
        // paw-v9qp: the file as read is what this session last wrote there (the first write skips runs that encode to it)
        if (key && at && seq === this.runsSeq) this.#written.set(pathKey(file.path), { key, mtime: at });
        // paw-ee14: a copy-on-write file's blocks checked against their names; a damaged run is said, never the file
        if (r.runs) r.runs = await this.#checkRuns(file.path, r.runs, seq);
        if (r.runs || r.error?.code === 'not_found') { file.ok = true; runs = r.runs || null; }
        // kept: the next save copies it aside before writing (saveRunsFile)
        else if (seq === this.runsSeq) this.app.toast(`${basename(file.path)}: ${r.error?.message || r.error}. The file is kept; the next save copies it aside first.`, 'warn', { timeout: 0 });
      }
      if (autosaveDir) {
        const p = autosaveDir + '/runs.pawruns', a = await read(p);
        // unsaved runs: runsDirty, so the next autosave (maybe into a new folder) keeps them
        if (a.runs && (!runs || (await mtime(p)) >= (await mtime(file.path)))) { runs = a.runs; this.runsDirty = true; }
      }
      if (seq !== this.runsSeq || !runs) return;
      // (composed a run per slice, paw-o60v.5; another document loaded meanwhile: dropped)
      const patched = await drive((function* (T) { const out = []; for (const r of runs) { out.push(T.#fileRun(r)); yield; } return out; })(this));
      if (seq !== this.runsSeq) return;
      this.fileRuns = patched;
      this.restoreRuns();
      this.#rederive();   // paw-otoh: composed now as the document says (its Detail, overrides), not only at the first edit
    } finally { if (seq === this.runsSeq && this.#runsPending) { this.#runsPending = false; this.#queueFills(); } } })();
  }
  // paw-3xif: while a project's runs file is read, its source runs are missing (or only rebuilt from their ghosts): a fill pass
  // then dropped the saved fills (no source) and announced them again once the runs landed
  #runsPending = false;
  /** A run read from the runs file, composed: lane (and rel: channels) derived, not stored; paw-vtec: a run with a
   *  direction takes points0 as composed (a file from before kept it unflipped, the flips applied after), its points as saved. */
  #fileRun(r) {
    const p = channelPatch(r, r.channel, this.channelFit, this.links, this.#ctx(r)), d = r.flips?.length || r.orient?.length;
    return { ...r, lane: p.lane, dir: p.dir, flipSpans: p.flipSpans, ...(d ? { points0: p.points0, points0Primary: p.points0Primary } : {}), ...(p.channels ? { channels: p.channels } : {}) };
  }
  /** After an autosave snapshot (block 'runs' autosaved): every run -> <autosave dir>/runs.pawruns, only when the runs
   *  changed since the last runs write (runsDirty). A fixed name: the snapshot pruning (13-digit names) never touches it,
   *  and the newest runs are the whole state. autosave_clear removes it with the folder. */
  async autosaveRuns(dir) {
    const be = this.app.backend, seq = this.runsSeq;
    await this.runsLoad;
    if (typeof be.writeBytes !== 'function') return;
    return this.#queueRuns(async () => {
      if (!this.runsDirty || seq !== this.runsSeq) return;   // another document loaded meanwhile: never its runs into this folder
      this.runsDirty = false;
      try { await this.#writeRuns(dir + '/runs.pawruns', this.#runsToWrite()); }
      catch (e) { if (seq === this.runsSeq) this.runsDirty = true; throw e; }
    });
  }
  // paw-o60v.3: runs writes one at a time (an older snapshot never lands after a newer one), each encoded in slices and
  // skipped when the file there is the one this session last wrote and the runs encode to it again
  #runsWrites = Promise.resolve();
  #written = new Map();   // pathKey -> {key, mtime}
  #gone = new Map();      // paw-abi2: id -> a run discarded since the .pawruns was last written without it (saveRunsFile keep)
  #queueRuns(job) { const p = this.#runsWrites.then(job); this.#runsWrites = p.catch(() => {}); return p; }
  async #writeRuns(path, runs, { cow = false, compact = false } = {}) {
    const be = this.app.backend, k = pathKey(path);
    // paw-ee14: the project's runs file copy-on-write when the shell can (a change writes its new blocks and a commit);
    // else version 1 whole, as before
    if (cow && cowShell(be)) {
      const job = startWrite(basename(path));
      try {
        const keep = this.app.project?.runRefsKept?.() || [];
        const st = await writeRunsCow(be, path, runs, this.#cow.get(k) || null, { keep, compact, onProgress: (d, t) => job.progress(d, t) });
        if (st) { this.#cow.set(k, { ...st, ids: runs.map((r) => r.id) }); this.#written.delete(k); }
        return st;
      } finally { job.end(); this.#lighten(runs); }
    }
    const w = this.#written.get(k), stat = async () => { try { const st = await be.stat(path); return st?.exists === false ? null : st?.mtime_ms ?? null; } catch { return null; } };
    const { key, bytes } = await encodeRunsAsync(runs, w?.mtime != null && (await stat()) === w.mtime ? w.key : null);
    if (bytes) {
      this.#written.delete(k);
      this.#cow.delete(k);
      const job = startWrite(basename(path));
      try { const res = await be.writeBytes(path, bytes); this.#written.set(k, { key, mtime: res?.mtime_ms ?? (await stat()) }); }
      finally { job.end(); }
    }
    if (cow) this.#lighten(runs);
    return null;
  }
  #cow = new Map();   // pathKey -> what is known of a copy-on-write runs file there (runs-cow.js state + ids: the runs' ids)
  /** paw-d1sq: runs tracked this session hold their points as arrays until a reopen; once written, every frame that decodes
   *  from its packed section to the same numbers reads from those bytes instead (in place, in the background). */
  #lighten(runs) {
    const todo = runs.filter((r) => r.frames?.ov?.length && !lazyFrames(r.frames));
    if (todo.length) queueMicrotask(async () => { for (const r of todo) await lightenFrames(r.frames).catch(() => 0); });
  }
  /** At open: a copy-on-write file's blocks checked against their names (async); a run whose record is gone or bad is said
   *  (the others open), a run whose frames are damaged opens without them. -> the runs to use */
  async #checkRuns(path, runs, seq) {
    const st = runsFileState(runs);
    if (!st) return runs;
    // paw-acfc: ids line up with st.runs (a record left out as unreadable has no run here: its id is null)
    const out = new Set(st.damaged?.filter((d) => !d.frames).map((d) => d.k) || []);
    let j = 0;
    const ids = st.v === 2 ? st.runs.map((_, k) => (out.has(k) ? null : runs[j++]?.id ?? null)) : null;
    if (seq === this.runsSeq) this.#cow.set(pathKey(path), { ...st, ids });
    if (st.v !== 2) return runs;
    const bad = await verifyRuns(runs), lost = [...st.damaged.map((d) => d.id || `#${d.k + 1}`), ...[...bad].filter(([, w]) => w === 'record').map(([id]) => id)];
    const noFrames = [...st.damaged.filter((d) => d.frames).map((d) => d.id), ...[...bad].filter(([, w]) => w === 'frames').map(([id]) => id)];
    if (seq === this.runsSeq && (lost.length || noFrames.length)) {
      const parts = [lost.length && `${lost.filter((id) => !noFrames.includes(id)).join(', ')} could not be read`, noFrames.length && `${noFrames.join(', ')} opened without frames`].filter(Boolean);
      // paw-acfc: the state stays (the records the history keeps stay in the file) without the bad blocks; the next write
      // rewrites the file and keeps the damaged one in the rolling backups first (never the only copy destroyed)
      for (const d of st.damaged) if (!d.frames) bad.bad.add(d.hash);
      if (bad.bad.size) this.#cow.set(pathKey(path), { ...withoutBad(st, bad.bad), ids });
      this.app.toast(`${basename(path)} is damaged: ${parts.join('; ')}. The other runs are fine; the damaged file is kept in the backups at the next write`, 'warn', { timeout: 0 });
    }
    return runs.map((r) => (bad.get(r.id) === 'frames' ? { ...r, frames: null } : r));
  }
  /** paw-s49h: {run id: record hash} of the runs in the project's runs file as last written or read (a history entry keeps
   *  them, so a restore can bring a gone run back whole). {} when the file is not copy-on-write. */
  runRefs() {
    const proj = this.app.doc.project?.path, st = proj && this.#cow.get(pathKey(runsPath(proj)));
    if (st?.v !== 2 || !st.ids) return {};
    return Object.fromEntries(st.ids.map((id, i) => [id, st.runs[i]]).filter(([id, h]) => id && h));
  }
  /** paw-s49h: a history entry's runs that are not here (or only as their ghost's points) read back from the runs file,
   *  frames and all. -> the ids brought back */
  async reviveRuns(refs) {
    const proj = this.app.doc.project?.path, be = this.app.backend, seq = this.runsSeq;
    const want = Object.entries(refs || {}).filter(([id]) => { const r = this.run(id); return !r || r.restored; });
    if (!proj || !want.length || typeof be.readBytes !== 'function') return [];
    await this.runsLoad;
    let got = [];
    try { got = await decodeRecords(await be.readBytes(runsPath(proj)), want.map(([, h]) => h)); } catch { return []; }
    if (seq !== this.runsSeq || !got.length) return [];
    const ids = new Set(got.map((r) => r.id));
    this.fileRuns = [...this.fileRuns.filter((r) => !ids.has(r.id)), ...got.map((r) => this.#fileRun(r))];
    this.runs = this.runs.filter((r) => !(ids.has(r.id) && r.restored));
    this.restoreRuns();
    this.#rederive();
    this.runsDirty = true;
    return [...ids];
  }
  /** Clean project (paw-ee14 GC): the runs file written whole with only what the runs and the history use. -> bytes freed */
  async compactRunsFile() {
    const proj = this.app.doc.project?.path, be = this.app.backend, seq = this.runsSeq;
    if (!proj || !cowShell(be)) return 0;
    await this.runsLoad;
    return this.#queueRuns(async () => {
      const path = runsPath(proj), before = this.#cow.get(pathKey(path))?.size ?? (await be.stat(path).catch(() => null))?.size ?? 0;
      if (seq !== this.runsSeq || !before || !this.runsFile?.ok) return 0;
      const st = await this.#writeRuns(path, this.#runsToWrite(), { cow: true, compact: true });
      return st ? Math.max(0, before - st.size) : 0;
    });
  }
  // paw-wzxu: a deleted modifier's own runs are not written (orphans: kept in memory until then, so an undo of the delete
  // brings them back with it and the next save writes them again). A run with a ghost: its visible / color, the same
  // record while they and the run stay the same (the encoder keeps each record's encoding)
  #merged = new WeakMap();
  /** The runs a save writes to the .pawruns (app/pack.js packs them, app/clean.svelte.js strips their frames). */
  runsToSave() { return this.#runsToWrite(); }
  /** paw-f4i2 Save a copy to…: every run, whole, beside a copy of the project (its own runs file and state untouched). */
  async copyRunsTo(projectPath) {
    const be = this.app.backend;
    await this.runsLoad;
    const runs = this.#runsToWrite();
    if (!runs.length || typeof be.writeBytes !== 'function') return;
    await be.writeBytes(runsPath(projectPath), (await encodeRunsAsync(runs)).bytes);
  }
  #runsToWrite() {
    const mods = new Set((this.app.doc.fx || []).map((e) => e.id));
    return this.runs.filter((r) => !r.ref && !(r.mod && !mods.has(r.mod)) && !this.isLiveFill(r)).map((r) => {
      const g = this.ghost(r.id);
      if (!g) return r;
      const visible = g.visible !== false, color = g.color ?? r.color, m = this.#merged.get(r);
      if (m?.visible === visible && m.color === color) return m;
      const out = { ...r, visible, color };
      this.#merged.set(r, out);
      return out;
    });
  }
  /** After a save of the .pawproj (block 'runs' saved): every run of this store -> <stem>.pawruns. A file this session did
   *  not read cleanly or write (unreadable, or another project's under this name) is copied to <name>.<ms>.bak first;
   *  a failure throws, so the save reports it and the document stays dirty. No runs and no file: nothing is written.
   *  paw-abi2: keep = the runs discarded since (#gone) that are still written: true all of them (before the .pawproj is
   *  written: the one on disk may still name them), a Set of ghost ids those the new .pawproj names; else none. */
  async saveRunsFile(projectPath, { keep = null } = {}) {
    const be = this.app.backend, seq = this.runsSeq;
    if (typeof be.writeBytes !== 'function') return;
    await this.runsLoad;   // never replace a file that is still being read
    return this.#queueRuns(async () => {
      if (seq !== this.runsSeq) return;   // another project loaded since this save began: its runs never go under this name
      const path = runsPath(projectPath);
      let runs = this.#runsToWrite();
      const ids = new Set(runs.map((r) => r.id)), gone = [...this.#gone].filter(([id]) => !ids.has(id));
      const kept = gone.filter(([id]) => keep === true || keep?.has?.(id));
      if (kept.length) runs = [...runs, ...kept.map(([, r]) => r)];
      const ours = this.runsFile?.ok && pathKey(this.runsFile.path) === pathKey(path), exists = await be.exists(path);
      if (!runs.length && !exists) return;
      if (exists && !ours) await be.writeBytes(`${path}.${Date.now()}.bak`, await be.readBytes(path));
      const dirty = this.runsDirty;
      if (seq === this.runsSeq) this.runsDirty = false;
      try { await this.#writeRuns(path, runs, { cow: true }); } catch (e) { if (seq === this.runsSeq) this.runsDirty ||= dirty; throw e; }
      if (seq === this.runsSeq) { this.runsFile = { path, ok: true }; for (const [id] of gone) if (!kept.some(([k]) => k === id)) this.#gone.delete(id); }
    });
  }
  /** The scene the panel and the quick bar work on: the timeline's selected scene, else the one at the playhead; -1 none. */
  get currentScene() { const tl = tlFor(this.app); return this.scenes[tl.scene] ? tl.scene : sceneAt(this.scenes, playheadFrameStart(this.app.player)); }
  get channelFit() { return this.app.settings.get('tracking.channelFit', {}) || {}; }
  /** The channel-fit controls changed: the default and every channel link take the new fit, every run using a channel
   *  rebuilds. ponytail: one fit for all (per-link fits differ only in older files); a per-scene fit form if ever wanted. */
  setChannelFit(patch) {
    this.app.settings.set('tracking.channelFit', { ...this.channelFit, ...patch });
    this.links = this.links.map((l) => (l.channel !== 'primary' ? { ...l, fit: { ...this.channelFit } } : l));
    for (const r of this.runs) if (r.channel !== 'primary' || r.sceneChannels?.some((c) => c !== 'primary')) this.#recompose(r.id);
  }
  /** Motion group k (1..4) of a grid run becomes its lane channel (g{k}_proj, sidecar v3.1). */
  pickGroup(k, id = this.selectedId) {
    const r = this.run(id), ch = `g${k}_proj`;
    if (!r) return;
    if (!r.channels[ch]) { this.notice = `No ${ch} channel in this run (re-track with the current sidecar).`; return; }
    this.app.usage?.note('tracking:pickGroup', `g${k}`);
    this.pickChannel(id, ch, 'video');
    this.notice = `signal: g${k}`;
  }

  // ---- span labels (persisted per video in settings 'tracking.spans:<path>') ----
  saveSpans(spans) { this.spans = spans; if (this.path) this.app.settings.set('tracking.spans:' + this.path, spans); }
  markSpan(state) {
    const r = this.app.doc.range;
    if (!this.path || !r || r.t1 <= r.t0) { this.app.toast('Set a range (I / O) to label it', 'quiet'); return; }
    this.saveSpans(addSpan(this.spans, { start_ms: r.t0, end_ms: r.t1, state }));
    this.app.toast(`Labeled ${((r.t1 - r.t0) / 1000).toFixed(1)} s as ${state}`, 'quiet');
  }
  setSpanState(i, state) { this.saveSpans(this.spans.map((s, k) => (k === i ? { ...s, state } : s))); }
  removeSpan(i) { this.saveSpans(this.spans.filter((_, k) => k !== i)); }

  // ---- ghosts / runs ----
  select(id) { this.selectedId = id; }
  /** A scene was selected (scenes lane click, quick bar): its linked run, else the newest run covering it, becomes the
   *  selected run, so the panel, the lane picker and Shift+A act on it. -> the run id | null (selection unchanged). */
  selectSceneRun(i) { const id = runForScene(this.scenes[i], this.links, this.ghosts); if (id) this.select(id); return id; }
  toggleVisible(id) { const g = this.ghost(id); if (g) this.patchGhost(id, { visible: !g.visible }); }
  /** Removes a ghost (and its run record). Pinned ghosts (the reference) are never removed. */
  remove(id) {
    const g = this.ghost(id);
    if (g?.pinned) return;
    this.app.usage?.note('tracking:discard', { run: id, tracker: this.run(id)?.tracker || g?.source?.kind || '' });
    this.runSeq = Math.max(this.runSeq, this.nextRunNumber() - 1);   // paw-1fd3: its number stays taken (an old project's too)
    // paw-1fd3: its run ranges go with it, from every state the undo history holds too (not an undo step, like the discard)
    const rr = this.app.doc.runRanges, mine = (v) => (Array.isArray(v) && v.some((r) => r.run === id) ? v.filter((r) => r.run !== id) : v);
    if (rr?.some((r) => r.run === id)) { this.app.doc.runRanges = mine(rr); this.app.history?.rebase?.('runRanges', mine); this.app.history?.markDirty?.(); }
    this.app.doc.ghosts = this.ghosts.filter((x) => x.id !== id && !(isAxesGhost(x) && x.source.runId === id));   // its secondary axes go with it
    const was = this.runs.find((r) => r.id === id);
    if (was && !was.ref) this.#gone.set(id, was);   // paw-abi2: in the .pawruns until a written .pawproj no longer names it
    this.runs = this.runs.filter((r) => r.id !== id);
    this.fileRuns = this.fileRuns.filter((r) => r.id !== id);   // gone from the .pawruns at the next save
    // paw-orm2: its shot links and its compose memo go with it. The next run took the freed number then (no more, paw-1fd3): with
    // them left, a discard + Track again got a run1 that met run1's old links (Track's defaults skipped every linked shot,
    // so it was never composed: the sidecar's pick played while the source chip said Fused) and #rederive's memo of the
    // old run1 (equal keys: no recompose either). The shots' own settings for it (derives[id]) stay, as before.
    if (this.links.some((l) => l.run === id)) { this.links = this.links.filter((l) => l.run !== id); this.knotSel = null; this.app.history?.markDirty?.(); }
    this.#deriveKeys.delete(id); this.#flipSeen.delete(id);
    this.runsDirty = true;
    if (this.selectedId === id) this.selectedId = '';
    const { [id]: _, ...rest } = this.scores; this.scores = rest;
  }

  /** Why a ghost cannot be exported ('' = it can). */
  exportBlock(g) {
    if (!g) return 'Nothing selected.';
    if (!this.videoPath) return 'No video: the export goes next to it.';
    if (g.source?.kind === 'reference') return 'The reference script is read-only.';
    if (!g.script?.length) return 'This run has no points.';
    return '';
  }
  /** Writes the ghost's points next to the video (policy: export.js -- never replaces a file without a .bak). */
  async exportGhost(id = this.selectedId, overwrite = false) {
    const app = this.app, g = this.ghost(id), block = this.exportBlock(g), video = this.videoPath;
    if (block) { app.toast(block, 'warn'); return null; }
    try {
      const { path, note } = await exportFunscript(app.backend, video, g.script, overwrite, app.doc.project?.path ? basename(app.doc.project.path) : null);
      if (path === stem(video) + '.funscript') this.origExists = true;
      this.notice = `Exported ${g.name} to ${basename(path)}${note}`; this.error = '';
      app.toast(this.notice, 'ok');
      return path;
    } catch (e) { this.error = 'Export failed: ' + (e?.message || e); app.toast(this.error, 'error'); return null; }
  }
  async exportOverwrite(id = this.selectedId) {
    const name = this.videoPath ? basename(stem(this.videoPath)) + '.funscript' : 'the original';
    const ok = await this.app.confirm({ title: 'Overwrite ' + name + '?', message: 'The current file is copied to a .bak first and its other keys are kept.', ok: 'Overwrite', danger: true });
    if (ok) return this.exportGhost(id, true);
    return null;
  }

  // ==== paw-ef73.33: linked shots fill each other (lib/link-fill.js) ==================================================
  // A shot that holds the same loop footage as a tracked shot (exact repeats; a crop link's loop pair) gets a derived run,
  // id fill-<shot start>, "looped from shot 42": its signals are the source's over one cycle laid over the shot's frames by
  // phase, composed like any run (its shot's Adjust settings, else the source shot's), its level and range carried. It is
  // recomputed here whenever its source changes and never written to the .pawruns while it follows (its ghost and its shot's
  // link keep it in the project). The only state the owner sets is the shot's `linkfill` flag (undoable): 'off' = dismissed
  // (not refilled until asked), 'on' = asked (fills past the guard), 'detached' = an independent copy, stored like a run.
  fillOffers = $state.raw([]);   // [{i, j, why}]: shots the guard held back (passes that differ...): the palette offers them
  #fillKeys = new Map(); #fillStamp = new WeakMap(); #fillN = 0; #fillSeen = new Set();
  #stamp(o) { if (!o || typeof o !== 'object') return 0; let n = this.#fillStamp.get(o); if (!n) this.#fillStamp.set(o, (n = ++this.#fillN)); return n; }
  #queueFills() { clearTimeout(this.timers.fills); if (!this.fuseLive) this.timers.fills = setTimeout(() => this.syncFills(), 30); }   // paw-o60v.2: not while a fusion drag moves (its rest re-queues)
  /** The shot whose derived run is r (or id), else -1. */
  fillShot(r) { const id = typeof r === 'string' ? r : r?.id; return id ? this.scenes.findIndex((s) => fillId(s) === id) : -1; }
  /** A derived run that follows its source (not detached). */
  isLiveFill(r) { return !!r?.derived && this.scenes[this.fillShot(r)]?.linkfill !== 'detached'; }
  /** The shots as derived run r composes them (link-fill.js inheritShots: its shot's own Adjust / Detail, else the source
   *  shot's while it follows). */
  #fillShots(r) {
    const shots = this.detailPreview || this.scenes, S = this.run(r.derived.from);
    return S && this.isLiveFill(r) ? inheritShots(shots, this.fillShot(r), sceneAt(shots, (S.range.start + S.range.end) / 2), S.id, r.id) : shots;
  }
  /** channelPatch's ctx for a derived run: its shot settings (or the source's), the source's direction xor its own flips,
   *  never averaged again (its passes are one cycle already). */
  #fillCtx(r) {
    let flips = this.flipsOf(r);
    for (const [a, b] of r.derived.dirMap || []) flips = xorFlips(flips, a, b);
    return { aspect: this.aspect, derives: runDerives(r, this.#fillShots(r), this.derivePreview), spans: this.#spansOf(r), picAt: picturesOf(this.app), loopAvg: null, exactLoops: this.app.doc.loops || [], flips, ...this.#maskOf(r) };
  }
  /** Compose derived run r into the store (its ghost patched only when its points change: a project opens clean). */
  #composeFill(r) {
    const p = channelPatch(r, r.channel, this.channelFit, this.links, this.#fillCtx(r)), points = carryLevel(p.points0, r.derived.levelRef);
    const next = { ...r, ...p, points0: points, points, stitches: null };
    this.runs = this.runs.some((x) => x.id === r.id) ? this.runs.map((x) => (x.id === r.id ? next : x)) : [...this.runs, next];
    const script = normalize(pointsList(next.points)), g = this.ghost(r.id), ghost = this.ghostOf(next, g ? g.visible !== false : true);
    const same = g && g.source?.derived?.from === r.derived.from && g.script?.length === script.length && g.script.every((q, k) => q.at === script[k].at && q.pos === script[k].pos);
    if (!g) this.app.doc.ghosts = [...this.ghosts, ghost];
    else if (!same) this.patchGhost(r.id, { script, source: ghost.source, name: ghost.name });
    return next;
  }
  /** paw-uzlr, on load: a fill saved while a linked shot's fill took no range (it played nothing) takes its shot, when it has
   *  no range anywhere and nothing else plays there (a detached one too: syncFills skips it). Ranges only: no point changes. */
  #repairFillRanges() {
    for (const g of this.ghosts) {
      const s = g.source?.derived && this.scenes[this.fillShot(g.id)], rr = this.app.doc.runRanges;
      if (s && rr && !rr.some((x) => x.run === g.id) && !rangesIn(rr, s.start_ms, s.end_ms).length) this.takeRange(g.id, s.start_ms, s.end_ms);
    }
  }
  /** A derived run, its ghost and its link gone (not an undo step: the flag that caused it is). */
  #dropFill(id) {
    if (this.ghost(id)) this.app.doc.ghosts = this.ghosts.filter((g) => g.id !== id);
    if (this.run(id)) this.runs = this.runs.filter((r) => r.id !== id);
    this.fileRuns = this.fileRuns.filter((r) => r.id !== id);
    if (this.links.some((l) => l.run === id)) this.links = this.links.filter((l) => l.run !== id);
    if (this.selectedId === id) this.selectedId = '';
    this.#fillKeys.delete(id);
  }
  /** Every linked shot without a run of its own gets / keeps / loses its derived run; one toast per batch of new ones. */
  syncFills() {
    if (this.#runsPending) return;   // paw-3xif: not before the project's runs are read (loadRunsFile queues one after)
    const app = this.app, shots = this.scenes, ix = repeatsOf(app), loops = app.doc.loops || [], grid = gridOf(app.player) || 1000 / 30;
    const crops = this.shotLinks?.links || [];
    const autos = crops.length && ix ? autoLoops(ix, app.player?.frameMs || 1000 / 30, gridOf(app.player)) : [];
    const want = fillTargets({ shots, ix, loops, grid, crops, autos, runs: this.runs, linkOf: (i) => this.sceneLink(i)?.runId || '' });
    const byId = new Map(want.map((w) => [fillId(shots[w.i]), w])), offers = [], fresh = [];
    // derived runs no longer wanted: dismissed ('off'), their shot gone, or (following) no source any more
    for (const r of this.runs) {
      if (!r.derived) continue;
      const i = this.fillShot(r), flag = shots[i]?.linkfill;
      if (i < 0 || flag === 'off' || (flag !== 'detached' && !byId.has(r.id))) this.#dropFill(r.id);
    }
    if (ix) for (const g of this.ghosts) if (g.source?.derived && !this.run(g.id) && !byId.has(g.id)) this.#dropFill(g.id);   // a saved fill whose link went
    for (const w of want) {
      const T = shots[w.i], id = fillId(T), cur = this.run(id), flag = T.linkfill, known = !!cur || !!this.ghost(id);
      if (cur && flag === 'detached') continue;
      const dataKey = [this.#stamp(w.src), this.#stamp(ix), this.#stamp(loops), this.#stamp(crops), T.start_ms, T.end_ms, flag || '', w.plan.kind, w.plan.loop?.id, frameLen(grid)].join('|');
      let r = cur;
      if (!cur || this.#fillKeys.get(id)?.data !== dataKey) {
        const d = deriveFill(w.src, w, { shots, ix, loops, grid, flips: this.flipsOf(w.src) });
        if (!d || (!d.info.ok && flag !== 'on')) { if (d) offers.push({ i: w.i, j: w.j, why: d.info.why }); if (cur || this.ghost(id)) this.#dropFill(id); continue; }
        const words = fillWords(d.info, shotLabel(shots, w.j)), had = !!this.ghost(id);
        r = { id, n: 0, color: cur?.color ?? this.ghost(id)?.color ?? nextColor([{ color: PALETTE[0] }, ...this.ghosts]), visible: true, ref: false, tracker: w.src.tracker, name: words.name, params: { ...(w.src.params || {}) },
          range: d.range, roi: null, samples: d.samples, scenes: d.scenes, flips: cur?.flips || [], orient: cur?.orient || [], channels: d.channels, channel: this.channelFor(w.src, w.j),
          points0Primary: d.points0Primary, points: d.points0Primary, points0: d.points0Primary, confidence: null, events: [], notes: d.notes, frames: null,
          derived: { from: w.src.id, j: w.j, what: words.what, dirMap: d.dirMap, levelRef: d.levelRef, ...d.info } };
        if (!had && !this.#fillSeen.has(id)) fresh.push(w);
        this.#fillSeen.add(id);
        this.#fillKeys.set(id, { data: dataKey, comp: '' });
      }
      const cx = this.#fillCtx(r), compKey = JSON.stringify([cx.derives, cx.flips, cx.spans.map(({ ch: _, ...s }) => s), this.channelFit, this.#stamp(this.links.find((l) => l.run === id)), ...(cx.mask ? [cx.mask] : [])]);
      if (r !== cur || this.#fillKeys.get(id).comp !== compKey) { r = this.#composeFill(r); this.#fillKeys.get(id).comp = compKey; this.runsDirty = true; }
      if (this.sceneLink(w.i)?.runId !== id) { this.#putLink(w.i, id, r.channel); this.#fillKeys.get(id).comp = ''; this.#queueFills(); }
      // paw-1ysd: a linked shot's fill plays there: with run ranges, it takes the shot (no undo step: the fill is automatic, as its link)
      // (paw-uzlr: a shot with no range at all is taken too; takeRange writes only when the fill does not play all of it)
      // paw-qvg8: a fill that was there already never re-takes a shot that has ranges: the owner's range edits stay (and stay undoable)
      const sh = this.scenes[w.i], rr = this.app.doc.runRanges;
      if (rr && sh && (!known || !rangesIn(rr, sh.start_ms, sh.end_ms).length)) this.takeRange(id, sh.start_ms, sh.end_ms);
    }
    if (JSON.stringify(offers) !== JSON.stringify(this.fillOffers)) this.fillOffers = offers;
    if (fresh.length) {
      const by = new Map();
      for (const w of fresh) by.set(w.j, [...(by.get(w.j) || []), w.i]);
      app.toast([...by].map(([j, is]) => `${is.length === 1 ? `Shot ${shotLabel(shots, is[0])}` : `${is.length} shots`} filled from shot ${shotLabel(shots, j)}`).join(' · ') + ': same loop footage', 'ok');
      app.usage?.note('tracking:linkFill', { n: fresh.length, from: [...by.keys()].map((j) => j + 1).join(','), to: fresh.map((w) => w.i + 1).join(',') });
    }
  }
  /** Shot i's flag (one undo step): 'off' dismiss, 'on' fill (past the guard), 'detached', null automatic. */
  setFillFlag(i, flag, label) {
    const s = this.scenes[i];
    if (!s || (s.linkfill ?? null) === (flag ?? null)) return false;
    const { linkfill: _, ...rest } = s;   // eslint-disable-line no-unused-vars
    this.app.transact(label, () => { this.app.doc.scenes = this.scenes.map((x, k) => (k === i ? (flag ? { ...rest, linkfill: flag } : rest) : x)); });
    this.app.usage?.note('tracking:linkFillFlag', { shot: i + 1, flag: flag || 'auto' });
    this.#queueFills();
    return true;
  }
  /** The Runs list ×: a derived run is dismissed (its shot stays empty until "Fill from shot N"). */
  dismissFill(id) { const i = this.fillShot(id), r = this.run(id); return i >= 0 && this.setFillFlag(i, 'off', `Dismiss the run looped from shot ${r ? shotLabel(this.scenes, r.derived.j) : ''}`.trim()); }
  /** Detach: the derived run becomes an independent copy (stored in the .pawruns, no longer follows its source). */
  detachFill(id) {
    const i = this.fillShot(id);
    if (i < 0 || !this.run(id)?.derived) return false;
    this.runsDirty = true;
    return this.setFillFlag(i, 'detached', 'Detach the looped run');
  }
  /** "Fill from shot N": shot i fills again (past the guard, or after a dismiss / detach), following its source. */
  refill(i) { const j = this.fillSourceOf(i); return this.setFillFlag(i, 'on', j >= 0 ? `Fill from shot ${shotLabel(this.scenes, j)}` : 'Fill from its linked shot'); }
  /** The shot shot i fills (or could fill) from, else -1: the hook for the chain's menu ("Fill from shot 42") and, for the
   *  action regions' later stages, "extend the action from shot 42" (nothing here creates regions). */
  fillSourceOf(i) { const r = this.run(fillId(this.scenes[i] || { start_ms: NaN })); return r?.derived ? r.derived.j : this.fillOffers.find((o) => o.i === i)?.j ?? -1; }
  // ==== end paw-ef73.33 =================================================================================================

  /** paw-shgb: about how much of the heap its runs hold (MB): their per-frame points at ~120 bytes a point, what a window with
   *  the owner's 24 runs measured (1.73 GB for 14.7 M points, paw-o60v.4). The tabs park a hidden document past their budget.
   *  Frames read from the .pawruns keep their points in the file's bytes (lib/runs-file.js lazyFrames): not counted. */
  get heapMB() {
    let n = 0;
    for (const r of this.runs) { const ov = r.frames?.ov, k = ov?.length || 0; if (k) n += k * ((lazyFrames(r.frames) ? 0 : ov[k >> 1]?.pts?.length ?? ov[k >> 1]?.points?.length ?? 0) + 8); }
    return Math.round((n * 120) / 2 ** 20);
  }
  /** Its tab closed (paw-shgb) or a test is done: its job stops (only its own: the sidecar queue's owner), its effects, timers and
   *  window listeners end, so the closed document's runs can go. */
  #dead = false;   // paw-vt22: destroyed: a job still queued in the chain never starts
  destroy() {
    this.#dead = true;
    live.delete(this);
    if (this.busy) this.cancel(true);
    this._stop?.(); for (const k in this.timers) clearTimeout(this.timers[k]); this.#scrub?.then((x) => x?.dispose());
    for (const f of this.#offWin.splice(0)) f();
  }
}

const stores = new WeakMap();
/** The tracking store of an app (created on first use). */
export function trackingFor(app) {
  let s = stores.get(app);
  if (!s) { s = rooted(() => new Tracking(app), app); stores.set(app, s); }   // paw-b7da: its own root (boot makes it; a test or a facade may ask first)
  return s;
}
/** Give an app-like object (the labelling workspace's still-image facade, paw-714j) a stand-in store instead of a real one. */
export const adoptTracking = (app, store) => { stores.set(app, store); return store; };
/** The store if it exists (cheap, never creates: for command `when` predicates). */
export const peekTracking = (app) => stores.get(app) || null;
