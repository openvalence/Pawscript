// steps.js -- first-run hints (paw-kxwz): which step of the quick start (docs/guide/quick-start.md) the open document is
// at, the one line that says the next step with its key, and the hint settings. Pure (test/onboard-steps.test.mjs).
//
// Settings: 'onboard.hints' true / false (absent: decided once at boot, on for a profile with no recent projects, so the
// owner's and every existing profile stay quiet), 'onboard.dismissed' [step ids hidden with the hint's x].
import { sceneRange } from '../timeline/shots.js';
import { sceneStatus } from '../timeline/scenes.js';
import { isIgnore, isUnassigned } from '../tracking/groups.js';

const painted = (g) => !!g && !isIgnore(g) && (g.poly?.length >= 3 || !!g.mask);

/** shots: app.doc.scenes; i: the shot in question (tracking's currentScene); script: the active axis; ghost: the run
 *  covering that shot (tracking: tr.ghost(runForScene(...))) or null. -> facts for stepOf. */
export function factsOf(shots = [], i = -1, script = [], ghost = null) {
  const s = shots[i];
  if (!s) return { shots: shots.length };
  const [lo, hi] = sceneRange(shots, i) || [i, i];   // the groups belong to the scene (any of its shots holds them)
  const groups = shots.slice(lo, hi + 1).flatMap((x) => x.groups || []).filter(painted);
  const st = sceneStatus(s, script, ghost).state;
  return { shots: shots.length, named: groups.some((g) => !isUnassigned(g)), unnamed: groups.some(isUnassigned), tracked: st === 'ghost', accepted: st === 'accepted' };
}

/** -> 'cuts' | 'paint' | 'name' | 'track' | 'accept' | 'next' */
export function stepOf(f) {
  if (!f?.shots) return 'cuts';
  if (f.accepted) return 'next';
  if (f.tracked) return 'accept';
  if (f.named) return 'track';
  return f.unnamed ? 'name' : 'paint';
}

// {command id} = its key caps; the rest is text. tab: where the step is done (named with its key when elsewhere).
export const LINES = {
  cuts: ['scenes', 'Check the cuts: Detect (Actions panel) finds them, {timeline.key.cut} cuts here, {timeline.key.mergeNext} merges a false cut. Then the Track tab: {mode.track}.'],
  paint: ['track', 'Click the shot, park where every part shows, {tracking.groups}: paint the penis, the hips and the receiving part.'],
  name: ['track', 'Name each part: {tracking.groupsAssign} over it, {tracking.groupsWho1} Bottom (receives) or {tracking.groupsWho2} Top (gives), then the part. Unnamed parts are not tracked.'],
  track: ['track', 'With the shot selected, {track.gridFrame} tracks it. No shot or range selected: the whole video.'],
  // paw-x7w7: a run plays live, so app.script covers the shot at once and 'accept' shows only while a run covers under half
  // of it; 'next' carries the check, Bake and Publish.
  accept: ['track', 'Tracked, live in your script. Check it: {track.flipAtPlayhead} flips, {tracking.anchorIn} / {tracking.anchorOut} anchor fully in / out here.'],
  next: ['track', 'In your script: {track.flipAtPlayhead} flips a tracked shot, {tracking.bake} bakes it for good. Next shot: click it. {file.publish} publishes the .funscript.'],
};
const TABS = { scenes: ['mode.scenes', 'Scenes tab'], track: ['mode.track', 'Track tab'] };

/** -> [{t} | {keys}] for the step, in the tab `mode`; keysFor(id) -> [binding] (an unbound command's key is left out). */
export function lineOf(step, mode, keysFor) {
  const [tab, text] = LINES[step] || [];
  if (!text) return null;
  const out = [];
  const key = (id) => { const k = keysFor(id)?.[0]; if (k) out.push({ keys: k }); return !!k; };
  if (tab !== mode) { if (key(TABS[tab][0])) out.push({ t: ' ' }); out.push({ t: TABS[tab][1] + ': ' }); }
  for (const part of text.split(/(\{[\w.]+\})/)) {
    const m = part.match(/^\{([\w.]+)\}$/);
    if (!m) { if (part) out.push({ t: part }); }
    else key(m[1]);
  }
  return out;
}

export const hintsOn = (settings) => settings.get('onboard.hints') === true;
export const dismissedOf = (settings) => { const d = settings.get('onboard.dismissed', []); return Array.isArray(d) ? d : []; };
export const dismiss = (settings, step) => settings.set('onboard.dismissed', [...new Set([...dismissedOf(settings), step])]);
/** on: show again from the start (the dismissed ones too); off: none. */
export function setHints(settings, on) {
  settings.set('onboard.hints', !!on);
  if (on) settings.set('onboard.dismissed', []);
}
/** Once per profile (boot): a profile with no recent projects is new and gets the hints; any other keeps quiet. */
export function initHints(settings) {
  if (typeof settings.get('onboard.hints') === 'boolean') return;
  const recent = settings.get('recent', []);
  settings.set('onboard.hints', !(Array.isArray(recent) && recent.length));
}
/** The step the hint shows (null: none). f: factsOf; media: a video is open. */
export function hintStep(settings, f, { media = true, busy = false } = {}) {
  if (!hintsOn(settings) || !media || busy) return null;
  const s = stepOf(f);
  return dismissedOf(settings).includes(s) ? null : s;
}
// F1's overlay: which page it opens on ('start' = the quick start, 'keys' = the shortcut list). The last one picked; never
// picked: the quick start while the hints are on (a new profile), else the shortcuts.
export const helpPage = (settings) => { const p = settings.get('help.page'); return p === 'start' || p === 'keys' ? p : hintsOn(settings) ? 'start' : 'keys'; };

// The empty Projects page's card (paw-a0eg): the whole path in five lines, keys from the registry ({command id}). Dismissed
// with its x ('onboard.card' false); the quick start has the details.
export const CARD = [
  'Open a video: {file.open}, or drop it on the window.',
  'Check the cuts in the Scenes tab {mode.scenes}, then go to the Track tab {mode.track}.',
  'Click a shot, paint the parts on one frame with {tracking.groups}, track it with {track.gridFrame}. Just one part (its size): paint it, {track.run}. No NVIDIA card: paint the moving part, {track.run} (Optical flow follows it).',
  'A tracked shot is in your script at once (live). Check it, {track.flipAtPlayhead} flips it; {tracking.bake} bakes it when it is right. Fix by hand in Refine {mode.refine}: {lanes.mode.stroke} strokes, {lanes.grab} {lanes.scale} {lanes.rotate}, {lanes.extrude} extrude.',
  'Publish the .funscript beside the video: {file.publish} ({file.save} commits a point you can come back to).',
];
/** A CARD line -> [{t} | {keys}] (an unbound command's key left out). */
export const partsOf = (text, keysFor) => text.split(/(\{[\w.]+\})/).flatMap((p) => { const m = p.match(/^\{([\w.]+)\}$/); if (!m) return p ? [{ t: p }] : []; const k = keysFor(m[1])?.[0]; return k ? [{ keys: k }] : []; });
export const cardOn = (settings) => settings.get('onboard.card', true) !== false;
