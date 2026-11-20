// Tracking commands (menu: Track). `when` predicates only peek at an existing store (never create one).
import { trackingFor, peekTracking } from './tracking.svelte.js';
import { SPAN_STATES } from '../../lib/runs.js';
import { toSpans } from '../timeline/plan.js';
import { tl, scenesOf, selOf, durOf } from '../timeline/state.svelte.js';
import { currentSpan, trackPicked, gridBlock, tracksRange, regionTrack } from '../timeline/quickbar.js';
import { selectedAct } from '../timeline/acts-edit.js';
import { groupsFor as groupsOf, peekGroups as peekGroupsOf } from './groups.svelte.js';
import { isSuggested, partLabel, splitName, isUnassigned, canPulse, isPulse, canDepth, isDepth, canShaft, isShaft } from './groups.js';
import { nextLabelMode, LABEL_MODE_NAMES } from './group-labels.js';
import { nextFill, FILL_NAMES } from './group-look.js';
import { modTrackKey, trackMod } from './mod-track.js';
import { REACTS } from '../timeline/mods-tracked.js';
import { deriveCommand, addLanesCommand, flipAxisCommand, hasAxesGhosts } from './axes-derive.js';   // paw-2pcf
import { shaftNames } from '../../lib/shaft.js';
import { pickOrder } from './roi-part.js';
import { guard, whyOf } from '../../app/commands.js';

const T = trackingFor, P = peekTracking;
const track = guard((app) => app.mode === 'track', 'Only in the Track tab');
const selRun = guard((app) => { const s = P(app); return !!(s && s.selectedId && s.selected?.scenes.length); }, 'Select a run first');
// the graph feature is optional: read its focus flag only if it is there
const G = Object.values(import.meta.glob('../graph/ui.svelte.js', { eager: true }))[0];
const graphFocused = (app) => !!G?.graphUI?.(app)?.focused;
// paw-714j: while the image-labelling workspace is open its Groups keys paint on ITS tool (app.labelling.app), not the project's
const lab = (app) => (app.labelling?.on ? app.labelling.app : app);
const groupsFor = (app) => groupsOf(lab(app)), peekGroups = (app) => peekGroupsOf(lab(app));
const groupsOn = guard((app) => !!peekGroups(app)?.on && (app.mode === 'track' || !!app.labelling?.on), 'Open the Groups tool first');
/** paw-c1m1: which part the per-part commands act on (GroupsOverlay sets row while a list row is hovered). */
export const groupTarget = { row: -1 };
function target(app, args) {
  const G = peekGroups(app);
  if (!G?.on || !G.onFrame) return null;
  const k = args?.k ?? (G.picker ? G.picker.k : groupTarget.row >= 0 ? groupTarget.row : G.hoverK >= 0 ? G.hoverK : G.active), g = G.groups[k];
  return g ? { G, k, g } : null;
}
const partWhy = (app, ok, no) => { const w = whyOf(app, groupsOn); if (w) return w; const t = target(app); if (!t) return peekGroups(app)?.onFrame === false ? 'Not the groups’ frame: go to it first' : 'Point at a painted part, or select one'; if (isUnassigned(t.g)) return `Assign ${partLabel(t.g.name)} a part first`; return ok(t.g) ? '' : no(t.g); };
const canMeasure = guard((app) => groupsOn(app) && !!target(app) && (canDepth(target(app).g) || canShaft(target(app).g)), (app) => partWhy(app, (g) => canDepth(g) || canShaft(g), (g) => `${partLabel(g.name)} has no depth to measure`));
const canCue = guard((app) => groupsOn(app) && !!target(app) && canPulse(target(app).g), (app) => partWhy(app, canPulse, () => 'Only the anus, balls, sheath and penis are spurt cues'));
// F belongs to the Groups tool only while a group is under the pointer (or selected in the labelling workspace)
export const groupsFlipOn = (app) => { const g = groupsOn(app) && peekGroups(app); return !!g && g.keyTargets().length > 0; };
// paw-iphl: [key, id] of another command that would take a key of tracking.groups right now (its effective keys: a user's override wins)
const groupsKeyTaken = (app) => { const c = app.commands; for (const k of c?.keysFor?.('tracking.groups') || []) { const w = c.winner?.(k, ['tracking.groups']); if (w) return [k, w]; } return null; };
const groupsXfOk = (app) => { const g = groupsOn(app) && peekGroups(app); return !!g && !!g.activeGroup && !g.draft && !g.xf && g.onFrame; };
// paw-25g one Track: a selection of shots that is not one unbroken run tracks exactly those shots (as the panel, chip, quick bar)
// paw-yt8q: T / Ctrl+T and the chips' / quick bar's Track buttons are one path: they track what the chips name (currentSpan:
// the live selection, else the selected shots, else an I-O range you set, else the scene at the playhead), which becomes the range
// first (own)
const picked = (app) => currentSpan(scenesOf(app), selOf(), app.doc.range, app.player?.timeMs ?? 0, durOf(app));
// paw-qoo5: an action region selected: the range is that region (its run is told its tags: tracking.svelte.js runTrack), or a
// plain reason why not (actWhy: a positioning range, painted parts only outside it); none selected: as before
const actSpan = (app) => regionTrack(selectedAct(app), scenesOf(app), durOf(app));
const actWhy = (app) => { const w = actSpan(app)?.why; if (w) app.toast(w, 'quiet'); return !!w; };
const own = (app) => {
  const a = actSpan(app);
  if (a && a.t1 > a.t0) { if (app.doc.range?.t0 !== a.t0 || app.doc.range?.t1 !== a.t1) app.doc.range = { t0: a.t0, t1: a.t1 }; return; }
  const p = picked(app); if (p?.live === false && !tracksRange(p, app.doc.range, selOf())) app.doc.range = { t0: p.t0, t1: p.t1 };
};
const shotsOnly = (app) => { const p = picked(app); return !!p && p.shots.length > 1 && !p.contiguous; };
// the Track buttons show in every tab but Scenes (SceneChips trackerOn, SceneQuickBar !scenesTab): their commands run there too;
// the keys T / Ctrl+T stay in the Track tab (paw-ef73.1: keyWhen)
const tracks = guard((app) => app.mode !== 'scenes', 'Not in the Scenes tab: Track, Refine or Review');
// paw-ws19: Track pressed while the tracker list is still loading (right after start) waits for it, the button showing it busy,
// then tracks; "needs a point tracker" only once the list came without one
async function grid(app) {
  if (actWhy(app)) return;
  own(app);
  const s = T(app), why = () => app.toast(gridBlock(s, app.commands?.keysFor?.('track.run')?.[0]), 'quiet');
  if (s.canGrid) return s.gridFrame();
  if (s.listed || s.trackers.length || s.error) return why();
  if (s.queued) return;
  s.queued = 'grid';
  app.toast('Loading the trackers: Track starts when they are in', 'quiet');
  try { s.ensureListed(); await s.listingNow(); } finally { s.queued = ''; }
  return s.canGrid ? s.gridFrame() : why();
}
// effects are live (lib/finish.js): nothing else to take; a fill waiting under the playhead / range is enough (paw-essc)
// paw-ef73.26: T (and Ctrl+T) tracks a modifier: the one whose seed the Groups tool paints, else the selected modifier while the
// Modifiers row has the focus (its own run: SAM unless opened for another tracker)
const modSel = (app) => (tl.focus === 'fx' && tl.fx ? (app.doc.fx || []).find((e) => e.id === tl.fx && REACTS[e.kind]) ?? null : null);
const modKey = (app) => (!!peekGroups(app)?.on && !!peekGroups(app)?.mod) || !!modSel(app);
const modSelTrack = (app) => { const m = modSel(app); if (!m) return false; trackMod(app, m.id); return true; };
// paw-x7w7: something live to bake / a baked shot a run could play again
const anyLive = guard((app) => { const s = P(app); return !!s && [...s.liveAll.values()].some(Boolean); }, 'Nothing live to bake: track a shot first');
// paw-j89h: a video with no shots is one piece (bakeState(0) = the whole video, as unbake() scopes it): Unbake was never enabled there
const anyUnbake = guard((app) => { const s = P(app); return !!s && (s.scenes.length ? s.scenes : [0]).some((_, k) => s.bakeState(k).canUnbake); }, 'No baked shot a run could play again');
// paw-m3b6: reasons only (never a `when`): the first thing missing
const vid = guard((app) => !!app.doc.media, 'Open a video first');
const BUSY = 'Wait for the tracker job to finish';
const trackWhy = (app) => { const s = P(app); return !s?.videoPath ? 'Open a video first' : !s.listed ? 'Start the tracker first' : !s.tracker ? 'Pick a tracker first' : s.locked && !s.preempt ? BUSY : !(s.span?.t1 > s.span?.t0) ? 'Set a range first (I / O)' : 'Paint the part with Groups (Tab) first'; };
// ---- paw-x8we Track ROI: one painted part (roi-part.js). One part in the range: it; the Groups tool open on a part: that one;
// several: a menu at the pointer asks which (the part under the pointer, else the one tracked last on that shot, first and
// outlined on the video while the menu points at it); none: a box set by code (Describe, a plan, Fix), else the selected run's
// stored box (an old box run, re-tracked as it was), else what to do. args: {part} = that one, {all} = the old panel Track (every
// painted part / the box, the picked tracker)
let ptr = null;   // the pointer (the menu opens there; a key press has no position of its own)
if (typeof window !== 'undefined') window.addEventListener('pointermove', (e) => { ptr = { x: e.clientX, y: e.clientY }; }, { passive: true, capture: true });
const wholeFrame = (r) => r.x <= 0.01 && r.y <= 0.01 && r.w >= 0.98 && r.h >= 0.98;
function trackRoi(app, a) {
  const s = T(app);
  if (a?.all) return trackPicked(s, picked(app)) || (own(app), s.track());
  own(app);
  const parts = s.paintedParts?.() || [], g = peekGroups(app), on = g?.on ? g.groups?.[g.active]?.name : '';
  const name = (a?.part && parts.some((p) => p.name === a.part) && a.part) || (on && parts.some((p) => p.name === on) && on) || (parts.length === 1 && parts[0].name) || '';
  if (name) return s.trackPart(name);
  if (parts.length > 1) return pickPart(app, s, parts, g?.on ? g.groups?.[g.hover]?.name : '');
  if (s.canTrack && s.trackRoi) return s.track();   // a box set by code / an internal view's
  const sel = s.selected, box = sel?.roi?.kind === 'box' && !wholeFrame(sel.roi) ? sel.roi : null, tk = box && s.trackers.find((t) => t.id === (sel.tracker?.id ?? sel.tracker));
  if (tk) { s.selectTracker(tk.id, false); s.roi = { ...box }; app.toast(`No part painted here: ${sel.name || 'the selected run'} re-tracked with its stored box`, 'quiet'); return s.track(); }
  app.toast(`Track ROI tracks a painted part: paint it with Groups (${app.commands?.keysFor?.('tracking.groups')?.[0] || 'Tab'}) first`, 'info',
    { action: { label: 'Open Groups', run: () => app.commands.run('tracking.groups') } });
}
async function pickPart(app, s, parts, under) {
  const { showContextMenu } = await import('../../ui/kit/contextmenu.js');
  const { groupColor } = await import('./colors.js');
  const shot = (p) => s.scenes.find((x) => p.group.t_ms >= x.start_ms && p.group.t_ms < x.end_ms);
  const at = (p) => s.lastPart.get(shot(p)?.start_ms);
  const order = pickOrder(parts, { first: under, last: parts.map(at).find(Boolean) || '' });
  const stage = document.querySelector('[data-testid="video-stage"]')?.getBoundingClientRect();
  const where = ptr || (stage ? { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 } : { x: 200, y: 200 });
  showContextMenu(where, [{ section: 'Track ROI: which part?' },
    ...order.map((p) => ({ label: partLabel(p.name), part: p.name, color: groupColor(p.name), tip: `Painted at ${(p.group.t_ms / 1000).toFixed(2)} s: its run covers that shot`, run: () => app.commands.run('track.run', { part: p.name }) })),
    { separator: true },
    { label: `Every painted part (${s.tracker?.name || 'the picked tracker'})`, run: () => app.commands.run('track.run', { all: true }) }],
  { label: 'Track ROI: which part', initial: 'first', onactive: (it) => { s.partHover = it?.part || null; }, onclose: () => { s.partHover = null; } });
}
const sidecarWhy = (app, has, what) => { const s = P(app); return !s?.videoPath ? 'Open a video first' : !s.listed ? 'Start the tracker first' : !has(s) ? `${what} is not installed` : ''; };

export default [
  // paw-u6s5: titled by what it does for you (the selected shots, else the I-O range, else the whole video), how in its tip
  // paw-rw84: the point grid is THE Track (the owner's most pressed button): T. A modifier the Groups tool is painting (or the
  // selected one in a focused Modifiers row) still tracks that modifier on T, as before
  // paw-u0ik: with a video and no grid (no point tracker installed: a CPU-only install; a job running) T says why, as the Track button does
  { id: 'track.gridFrame', title: 'Track the selected shot or range', tip: 'Points over the whole frame; your painted parts ride along', keys: ['T'], menu: 'Track', group: 'track', keyWhen: track, when: guard((app) => tracks(app) && (modKey(app) || !!P(app)?.canGrid || !!P(app)?.videoPath), (app) => whyOf(app, tracks) || 'Open a video first'), run: (app) => modTrackKey(app) || modSelTrack(app) || grid(app) },
  // paw-x8we: one painted part (trackRoi above), Ctrl+T; args {part} / {all}
  { id: 'track.run', title: 'Track ROI: one painted part', tip: 'Paint the part (Tab); several painted: a menu asks which', keys: ['Ctrl+T'], menu: 'Track', group: 'track', keyWhen: track,
    when: guard((app) => tracks(app) && (modKey(app) || shotsOnly(app) || !!P(app)?.canTrack || !!P(app)?.canPart || (!!P(app)?.stopping && P(app)?.busy === 'track')), (app) => whyOf(app, tracks) || trackWhy(app)),
    run: (app, a) => modTrackKey(app) || modSelTrack(app) || actWhy(app) || trackRoi(app, a) },
  // paw-o74b: a Track of every painted part on a tracked shot with groups painted since adds only those to its run; this tracks everything again (a new run)
  { id: 'track.full', title: 'Track every painted part again (a new run)', menu: 'Track', group: 'track', when: guard((app) => track(app) && !!P(app)?.canTrack, (app) => whyOf(app, track) || trackWhy(app)), run: (app) => T(app).track({}, { full: true }) },
  // paw-l3ec: a Track over a run of the same tracker replaces it; paw-1ysd: this one takes no range (the earlier run keeps
  // playing; the new one is listed, to compare or to use over a stretch from the run strip)
  { id: 'track.beside', title: 'Track as a new run, not playing yet', menu: 'Track', group: 'track', when: guard((app) => track(app) && (!!P(app)?.canGrid || !!P(app)?.canTrack), (app) => whyOf(app, track) || trackWhy(app)), run: (app) => (P(app).canGrid ? T(app).gridFrame({ beside: true }) : T(app).track({}, { beside: true })) },
  // the plan from the scene tags (lib/track-plan.js): a dialog lists it, Run tracks the scenes that need it
  { id: 'track.plan', title: 'Track tagged scenes…', keys: ['Shift+T'], menu: 'Track', group: 'track', when: guard((app) => !!app.doc.media && !P(app)?.planBusy, (app) => whyOf(app, vid) || 'Wait for the tagged scenes to finish tracking'), run: (app) => T(app).openPlan() },
  { id: 'track.cancel', title: 'Cancel tracker job', keys: ['Escape'], menu: 'Track', group: 'track', when: guard((app) => { const s = P(app); return !!s && ((!!s.busy && s.owner !== 'api') || !!s.batch || !!s.planBusy); }, 'No tracker job running'), run: (app) => T(app).cancel() },
  // the Groups tool's X / Delete (before the axis tool's X: while the tool is open with a group picked, X deletes it)
  { id: 'tracking.groupsDelete', title: 'Groups: delete the active group', keys: ['X', 'Delete', 'Backspace'], hidden: true, when: (app) => groupsOn(app) && !!peekGroups(app)?.activeGroup && !peekGroups(app)?.draft, run: (app) => groupsFor(app).remove() },
  // stroke axis (axis.js). X is also graph.swapAB while the graph has focus: tracking registers first, so it yields there
  { id: 'tracking.axisDraw', title: 'Draw stroke axis', keys: ['X'], menu: 'Track', group: 'track', when: guard((app) => track(app) && !!app.doc.media && !graphFocused(app), (app) => whyOf(app, track, vid) || 'Not while the graph has focus'), run: (app) => T(app).toggleAxisTool() },
  // the Groups tool (groups.svelte.js): paint the groups the tracker pins, on the scene's seed frame; its keys only while open
  // grab / scale the active group, Blender's G / S (the overlay drives the pointer: click / Enter keeps, Esc / right click
  // cancels). G is move, always: it never opens or closes the tool (Tab does, below)
  { id: 'tracking.groupsGrab', title: 'Groups: move the active group (G, Blender grab)', keys: ['G'], hidden: true, when: (app) => groupsXfOk(app), run: (app) => groupsFor(app).beginXf('grab') },
  { id: 'tracking.groupsScale', title: 'Groups: scale the active group (S)', keys: ['S'], hidden: true, when: (app) => groupsXfOk(app), run: (app) => groupsFor(app).beginXf('scale') },
  // Tab opens / closes it on the press, as Blender's Edit mode (a held Tab does not toggle again: repeat false). With keyboard
  // navigation on (keys.uiNavigation) Tab moves the focus instead: the menu and the palette still open it
  { id: 'tracking.groups', title: 'Groups: paint the tracked parts', keys: ['Tab'], repeat: false, menu: 'Track', group: 'track', tip: 'Keyboard navigation on: Tab moves focus; open it here', when: guard((app) => track(app) && !!app.doc.media && (groupsOn(app) || !groupsKeyTaken(app)), (app) => whyOf(app, track, vid)), run: (app) => groupsFor(app).toggle(undefined, { key: app.commands?.via === 'key' }),   // paw-iwb7: Tab over the timeline takes the hovered frame
    why: (app) => { const w = track(app) && app.doc.media && groupsKeyTaken(app); return w ? `${w[0]} goes to ${app.commands.get(w[1])?.title || w[1]} here` : ''; } },   // paw-iphl: another command that applies on the tool's key (its own key, a user's G say: lanes.grab on selected points, a focused row's, the graph's) keeps it
  { id: 'tracking.groupsSuggest', title: 'Groups: suggest (learned seeder + tagger)', menu: 'Track', group: 'track', when: guard((app) => groupsOn(app) && !groupsFor(app).busy, (app) => whyOf(app, groupsOn) || 'Wait for Suggest to finish'), run: (app) => groupsFor(app).suggest() },
  // paw-lgtx: Copy from… — a strip of frames of this video whose groups could seed the frame on screen (C again / Esc closes it; the graph keeps its C)
  { id: 'tracking.groupsCopyFrom', title: 'Groups: copy from a similar frame…', keys: ['C'], menu: 'Track', group: 'track', when: guard((app) => { const g = groupsOn(app) && peekGroups(app); return !!g && !g.labelMode && !g.mod && !g.busy && !graphFocused(app); }, (app) => { const g = peekGroups(app); return whyOf(app, groupsOn) || (g?.labelMode ? 'Not in image labeling' : g?.mod ? 'Not while painting a modifier' : g?.busy ? 'Wait for Suggest to finish' : 'Not while the graph has focus'); }), run: (app) => groupsFor(app).openCopy() },
  // the active character (paw-emy, paw-uzzr): 1 Bottom / 2 Top / 3 Extra while the tool is open (else they stay "set point 10 / 20 / 30")
  { id: 'tracking.groupsWho1', title: 'Groups: Bottom (under the pointer, else next)', keys: ['1'], hidden: true, when: groupsOn, run: (app) => groupsFor(app).whoKey('c1') },
  { id: 'tracking.groupsWho2', title: 'Groups: Top (under the pointer, else next)', keys: ['2'], hidden: true, when: groupsOn, run: (app) => groupsFor(app).whoKey('c2') },
  { id: 'tracking.groupsWho3', title: 'Groups: Extra (under the pointer, else next)', keys: ['3'], hidden: true, when: groupsOn, run: (app) => groupsFor(app).whoKey('x') },
  // paw-cnfg: F over a group (the labelling workspace: or with one selected) flips its side l <-> r; everywhere else F is the stroke-direction flip below
  { id: 'tracking.groupsFlip', title: 'Groups: flip the side (L / R) of the group under the pointer', keys: ['F'], hidden: true, when: groupsFlipOn, run: (app) => { const g = groupsFor(app), k = g.keyTargets()[0]; if (!g.flipSide(k)) app.toast(`${partLabel(g.groups[k].name)} has no sides`, 'quiet'); } },
  // paw-dgtr: Shift+K over a shaft (penis) group: a tentative knot on it (Enter takes it); elsewhere Shift+K stays the knotting mark
  { id: 'tracking.groupsFindKnot', title: 'Groups: find the knot on the shaft (Enter keeps it)', keys: ['Shift+K'], hidden: true, when: (app) => { const g = groupsOn(app) && peekGroups(app); return !!g && g.keyTargets().some((k) => splitName(g.groups[k]?.name).part === 'penis'); }, run: (app) => { const g = groupsFor(app); g.findKnot(g.keyTargets()[0]); } },
  { id: 'tracking.groupsSwap', title: 'Groups: swap Bottom and Top', menu: 'Track', group: 'track', when: guard((app) => groupsOn(app) && !!peekGroups(app)?.groups.some((g) => g.who), (app) => whyOf(app, groupsOn) || 'Make a group Bottom or Top first'), run: (app) => groupsFor(app).swap() },
  { id: 'tracking.groupsSmaller', title: 'Groups: smaller brush', keys: ['['], hidden: true, when: groupsOn, run: (app) => groupsFor(app).resize(1 / 1.25) },
  { id: 'tracking.groupsBigger', title: 'Groups: bigger brush', keys: [']'], hidden: true, when: groupsOn, run: (app) => groupsFor(app).resize(1.25) },
  { id: 'tracking.groupsCircle', title: 'Groups: circle to fill on / off', keys: ['W'], menu: 'Track', group: 'track', when: groupsOn, run: (app) => { const s = app.settings, on = !s.get('tracking.groups.circle', false); s.set('tracking.groups.circle', on); app.toast(on ? 'Circle to fill: loop most of a part' : 'Circle to fill off: the brush paints', 'quiet'); } },
  // paw-6m6o: the labels on the picture, Smart -> All -> None (setting tracking.groups.labels; group-labels.js)
  { id: 'tracking.groupsLabels', title: 'Groups: labels smart / all / none', keys: ['Shift+H'], menu: 'Track', group: 'track', when: groupsOn, run: (app) => { const s = app.settings, m = nextLabelMode(s.get('tracking.groups.labels')); s.set('tracking.groups.labels', m); app.toast(`Labels: ${LABEL_MODE_NAMES[m]}${m === 'smart' ? ', names for the selected, hovered and unsure' : m === 'none' ? ', hover a group for its name' : ''}`, 'quiet'); } },
  // paw-c1m1: how the painted parts look, Hatch -> Gradient -> Flat (setting tracking.groups.fill; group-look.js)
  { id: 'tracking.groupsFill', title: 'Groups: fill dither / hatch / gradient / flat', keys: ['Shift+J'], menu: 'Track', group: 'track', when: groupsOn, run: (app) => { const s = app.settings, m = nextFill(s.get('tracking.groups.fill')); s.set('tracking.groups.fill', m); app.toast(`Fill: ${FILL_NAMES[m]}${m === 'dither' ? ', dots dense at the body end, thinning toward the next limb' : m === 'hatch' ? ', lines along each limb from the body out' : ''}`, 'quiet'); } },
  // paw-c1m1: the two per-part switches of the list rows' icons, as commands (the picker a right click opens, the rows' icons, the palette):
  // the part they act on is groupTarget's (the picker's group, else the hovered list row, else the part under the pointer, else the selected one)
  { id: 'tracking.groupsDepth', title: 'Groups: measure its depth with SAM on the next Track', menu: 'Track', group: 'track', when: canMeasure, checked: (app) => { const t = target(app); return !!t && (canShaft(t.g) ? isShaft(t.g, t.G.scenes?.[t.G.scene]) : isDepth(t.g)); }, run: (app, args) => { const t = target(app, args); if (t) (canShaft(t.g) ? t.G.toggleShaft(t.k) : t.G.toggleDepth(t.k)); } },
  { id: 'tracking.groupsPulse', title: 'Groups: use its contractions as spurt cues', menu: 'Track', group: 'track', when: canCue, checked: (app) => { const t = target(app); return !!t && canPulse(t.g) && isPulse(t.g); }, run: (app, args) => { const t = target(app, args); if (t) t.G.togglePulse(t.k); } },
  { id: 'tracking.groupsMagnetWeaker', title: 'Groups: magnet weaker (-10 %)', keys: [';'], hidden: true, when: groupsOn, run: (app) => { const g = groupsFor(app); g.setSnapStrength(g.snapStrength - 10); app.toast(`Magnet strength ${g.snapStrength} %`, 'quiet'); } },
  { id: 'tracking.groupsMagnetStronger', title: 'Groups: magnet stronger (+10 %)', keys: ["'"], hidden: true, when: groupsOn, run: (app) => { const g = groupsFor(app); g.setSnapStrength(g.snapStrength + 10); app.toast(`Magnet strength ${g.snapStrength} %`, 'quiet'); } },
  { id: 'tracking.groupsMarginLess', title: 'Groups: paint margin less (-5 %)', keys: [':'], hidden: true, when: groupsOn, run: (app) => { const g = groupsFor(app); g.setMargin(g.margin - 5); app.toast(`Paint margin ${g.margin} %`, 'quiet'); } },
  { id: 'tracking.groupsMarginMore', title: 'Groups: paint margin more (+5 %)', keys: ['"'], hidden: true, when: groupsOn, run: (app) => { const g = groupsFor(app); g.setMargin(g.margin + 5); app.toast(`Paint margin ${g.margin} %`, 'quiet'); } },
  { id: 'tracking.suggestConfLess', title: 'Suggest: show more (confidence -5 %)', keys: ['{'], hidden: true, when: groupsOn, run: (app) => { const g = groupsFor(app); g.setSuggestConf(g.suggestConf - 0.05); app.toast(`Suggest shows ${Math.round(g.suggestConf * 100)} % and up (${g.heldCount} held back)`, 'quiet'); } },
  { id: 'tracking.suggestConfMore', title: 'Suggest: show fewer (confidence +5 %)', keys: ['}'], hidden: true, when: groupsOn, run: (app) => { const g = groupsFor(app); g.setSuggestConf(g.suggestConf + 0.05); app.toast(`Suggest shows ${Math.round(g.suggestConf * 100)} % and up (${g.heldCount} held back)`, 'quiet'); } },
  { id: 'tracking.groupsGrow', title: 'Groups: grow on / off', keys: ['E'], menu: 'Track', group: 'track', when: groupsOn, run: (app) => { const s = app.settings, on = !s.get('tracking.groups.grow', false); s.set('tracking.groups.grow', on); app.toast(on ? 'Grow: dab or scribble on a part, SAM finds its outline' : 'Grow off: the brush paints', 'quiet'); } },
  // paw-k8jj: Alt + wheel over a group loosens / tightens it (the overlay's wheel); Alt + Up / Down are the keyboard twin (exactly one notch; ahead of the lane / axis cycling only while a group is targeted), one notch on the group under the pointer (else the active one); Shift+E grows the active group to the visible edge of the part
  { id: 'tracking.groupsKnot', title: 'Groups: knot brush on / off', keys: ['K'], menu: 'Track', group: 'track', when: groupsOn, run: (app) => { const on = groupsFor(app).toggleKnot(); app.toast(on ? 'Knot brush: paint the knot on the penis (Shift erases it; K: back to the brush)' : 'Knot brush off: the brush paints groups', 'quiet'); } },   // paw-njnf; paw-k393: the image painter too
  { id: 'tracking.groupsLooser', title: 'Groups: looser (Alt+wheel up)', keys: ['Alt+ArrowUp'], hidden: true, when: (app) => groupsOn(app) && !!peekGroups(app)?.groups[peekGroups(app).active], run: (app) => groupsFor(app).dialKey(1) },
  { id: 'tracking.groupsTighter', title: 'Groups: tighter (Alt+wheel down)', keys: ['Alt+ArrowDown'], hidden: true, when: (app) => groupsOn(app) && !!peekGroups(app)?.groups[peekGroups(app).active], run: (app) => groupsFor(app).dialKey(-1) },
  { id: 'tracking.groupsGrowFill', title: 'Groups: grow to fill up to the part edge', keys: ['Shift+E'], menu: 'Track', group: 'track', when: guard((app) => groupsOn(app) && !!peekGroups(app)?.groups[peekGroups(app).active], (app) => whyOf(app, groupsOn) || 'Pick a group first'), run: (app) => groupsFor(app).growFill() },
  { id: 'tracking.groupsIgnore', title: 'Groups: paint an ignore region (watermark, inset)', keys: ['V'], hidden: true, when: groupsOn, run: (app) => groupsFor(app).pickPart('ignore') },
  { id: 'tracking.groupsDecline', title: 'Groups: decline all suggestions (the pair of Accept: Enter)', keys: ['Shift+Enter'], hidden: true, when: (app) => { const g = groupsOn(app) && peekGroups(app); return !!g && g.groups.some(isSuggested); }, run: (app) => groupsFor(app).declineAll() },
  { id: 'tracking.groupsClose', title: 'Groups: close the tool', keys: ['Escape'], hidden: true, when: (app) => groupsOn(app) && (!P(app)?.busy || !!peekGroups(app)?.xf || !!peekGroups(app)?.draft || !!peekGroups(app)?.picker || !!peekGroups(app)?.lasso), run: (app) => { const g = groupsFor(app); if (g.picker) g.closePicker(); else if (g.xf) g.endXf(false); else if (g.draft) g.cancel(); else if (g.lasso) g.cancelLasso(); else if (!app.labelling?.on) g.toggle(false); } },
  // Enter: keep a grab / scale, else accept the re-found groups
  { id: 'tracking.groupsConfirm', title: 'Groups: keep suggestions and confident names', keys: ['Enter'], hidden: true, when: (app) => { const g = groupsOn(app) && peekGroups(app); return !!g && (!!g.xf || g.groups.some((x) => x.unconfirmed || isSuggested(x)) || g.confirmable > 0 || (g.naming && g.unassigned.length > 0)); }, run: async (app) => { const g = groupsFor(app); if (g.xf) g.endXf(true); else { const sug = g.groups.some((x) => x.unconfirmed || isSuggested(x)); if (sug) g.accept(); if (app.labelling?.on && !sug) app.labelling.done(); else { if (g.naming) await g.proposalsSettled(); g.confirmProposals(); } } } },   // paw-wzxu: Enter before the (debounced) proposals came asks now and names what they say   // the labelling workspace's Enter is its own Done (which confirms proposals first)   // paw-p9ve: Enter also names the confident proposals
  // the learned seeder (paw-bn2): retrain now from the painted groups of the seed library (it also retrains after a save)
  // paw-8mf4: fill a take without groups from an exact repeat elsewhere when the Groups tool selects it (toggle)
  { id: 'tracking.groupsAutoFill', title: 'Groups: fill empty takes from repeated frames (toggle)', menu: 'Track', group: 'track', when: guard((app) => !!app.doc.media, 'Open a video first'), run: (app) => { const on = app.settings.get('tracking.groups.autoFromRepeats', true) === false; app.settings.set('tracking.groups.autoFromRepeats', on); app.toast(on ? 'Groups: empty takes fill from repeated frames' : 'Groups: no automatic fill (Use groups from, in the toolbar)', 'quiet'); } },
  { id: 'tracking.groupsRetrain', title: 'Groups: retrain the seeder from my painted groups', menu: 'Track', group: 'track', when: guard((app) => !!app.doc.media && !peekGroups(app)?.training, (app) => whyOf(app, vid) || 'Wait for the seeder to finish training'), run: (app) => groupsFor(app).retrain({ force: true }) },
  // paint first, assign after (paw-1mo): A opens the picker on the group under the pointer (else the assign-all pass)
  { id: 'tracking.groupsAssign', title: 'Groups: assign the group under the pointer', keys: ['A'], hidden: true, when: (app) => { const g = groupsOn(app) && peekGroups(app); return !!g && g.groups.length > 0 && !g.draft && !g.xf && !g.picker; }, run: (app) => { const g = groupsFor(app); g.assignKey(g.hover); } },   // off the groups' frame assignKey only flashes where it is (paw-r0wp),
  { id: 'tracking.axisClear', title: 'Clear stroke axis', menu: 'Track', group: 'track', when: guard((app) => !!P(app)?.axis, 'No stroke axis to clear'), run: (app) => { T(app).toggleAxisTool(false); T(app).setAxis(null); } },
  { id: 'tracking.axisCancel', title: 'Cancel stroke axis drawing', keys: ['Escape'], hidden: true, when: (app) => !!P(app)?.axisOn, run: (app) => { const s = T(app); if (!s.axisPointer.cancel()) s.toggleAxisTool(false); } },
  { id: 'tracking.axisDelete', title: 'Delete stroke axis', keys: ['Delete'], hidden: true, when: (app) => !!P(app)?.axisOn && !!P(app)?.axis, run: (app) => { T(app).toggleAxisTool(false); T(app).setAxis(null); } },
  // a baseline knot clicked in the Tracker row, while that row has focus (else Delete stays the lanes' point delete)
  { id: 'tracking.knotDelete', title: 'Delete baseline knot', keys: ['Delete', 'Backspace'], hidden: true, when: (app) => { const s = P(app); return !!s?.laneFocused && !!s.knotSel; }, run: (app) => T(app).deleteKnot() },
  // paw-hiq5: a range override of the signal, by hand: over the I-O range (else the shot at the playhead); Delete removes the selected one
  { id: 'track.signalOverride', title: 'Signal override over the range or shot', menu: 'Track', group: 'run', when: guard((app) => track(app) && !!P(app)?.signalRun, (app) => whyOf(app, track) || 'Select a run or a tracked shot first'), run: (app) => { if (!T(app).addSignalSpanHere()) app.toast('No range to override here: set an I-O range inside the run, or put the playhead in a shot it covers', 'warn'); } },
  { id: 'tracking.signalDelete', title: 'Delete range override', keys: ['Delete', 'Backspace'], hidden: true, when: (app) => { const s = P(app); return !!s?.laneFocused && !s.knotSel && !!s.sigSel && !!s.spanOver(s.sigSel); }, run: (app) => { const s = T(app); s.setSpan(s.sigSel, null, { label: 'Signal: remove a range override' }); } },
  { id: 'tracking.checkCamera', title: 'Check camera motion of the run', menu: 'Track', group: 'run', when: guard((app) => { const s = P(app); return !!s?.selected && !s.locked; }, (app) => (!P(app)?.selected ? 'Select a run first' : BUSY)), run: (app) => { const s = T(app); s.checkCamera(s.selectedId); } },
  { id: 'track.flipAtPlayhead', title: 'Flip scene at playhead', keys: ['F'], menu: 'Track', group: 'direction', when: guard((app) => tracks(app) && !!P(app)?.videoPath, (app) => whyOf(app, tracks) || 'Open a video first'), run: (app) => T(app).flipAtPlayhead() },
  // paw-57ve: a stretch flipped relative to the rest of its run scene (lib/polarity.js); no default key (Shift+F is Follow)
  { id: 'track.flipToEnd', title: 'Flip from the playhead to the end of the shot', menu: 'Track', group: 'direction', when: selRun, run: (app) => { if (T(app).flipToEnd() === null) app.toast('Nothing to flip here: put the playhead inside the selected run', 'warn'); } },
  { id: 'track.flipRange', title: 'Flip the I-O range', menu: 'Track', group: 'direction', when: guard((app) => selRun(app) && !!app.doc.range, (app) => whyOf(app, selRun) || 'Set a range first (I / O)'), run: (app) => { if (T(app).flipRange() === null) app.toast('The I-O range is outside the selected run', 'warn'); } },
  ...['forward', 'backward', 'both'].map((d) => ({ id: 'track.' + d, title: { forward: 'Track forward from the seed frame (the picked tracker)', backward: 'Track backward from the seed frame (the picked tracker)', both: 'Track both ways from the seed frame (the picked tracker)' }[d],
    menu: 'Track', group: 'track', when: guard((app) => track(app) && (!!P(app)?.canTrack || (!!P(app)?.stopping && P(app)?.busy === 'track')), (app) => whyOf(app, track) || trackWhy(app)), run: (app) => T(app).trackDir(d) })),
  { id: 'tracking.followPlayhead', title: 'Overlay: follow the playhead on / off', menu: 'Track', group: 'run', when: guard((app) => !!app.doc.media, 'Open a video first'), run: (app) => { const on = app.settings.get('tracking.blobs.follow') !== 'playhead'; app.settings.set('tracking.blobs.follow', on ? 'playhead' : 'selection'); app.toast(on ? 'Overlay follows the playhead: every scene\'s trackers' : 'Overlay: the selected shots\' trackers only', 'quiet'); } },
  { id: 'track.stabilise', title: 'Stabilized preview on / off', menu: 'Track', group: 'run', when: guard((app) => !!app.doc.media && !!P(app), (app) => whyOf(app, vid) || 'Open the Track tab first'), checked: (app) => !!P(app)?.stabilised, run: (app) => T(app).toggleStabilise() },
  { id: 'track.flipRun', title: 'Flip whole run', menu: 'Track', group: 'direction', when: selRun, run: (app) => T(app).flipRun() },
  // paw-izk: existing points re-fitted to the stroke-shape model (lib/detail.js): the selected points, else the selected shots, else the scene
  { id: 'track.simplifyDetail', title: 'Simplify to this detail (preview)', menu: 'Track', group: 'run', when: guard((app) => (app.script?.length ?? 0) > 2, 'Add at least 3 points first'), run: (app) => T(app).simplifyPreview() },
  { id: 'track.simplifyAccept', title: 'Use the simplified points', menu: 'Track', group: 'run', when: guard((app) => !!P(app)?.simplify, 'Preview a simplify first'), run: (app) => T(app).simplifyAccept() },
  { id: 'track.simplifyCancel', title: 'Drop the simplify preview', keys: ['Escape'], hidden: true, when: (app) => !!P(app)?.simplify, run: (app) => T(app).simplifyCancel() },
  // paw-wg2d: anchors at the playhead's frame (lib/anchors.js): fusion solves the shot backwards to them; the same key on that
  // frame again takes the anchor off (the Tracker row's marks: drag = move frame by frame, Delete = remove)
  ...[[0, 'anchorIn', 'fully in (pos 0)', 'Alt+0'], [100, 'anchorOut', 'fully out (pos 100)', 'Alt+Shift+0'], [50, 'anchorMid', 'the middle (pos 50)', 'Alt+M']].map(([pos, id, label, key]) => (
    { id: `tracking.${id}`, title: `Anchor: ${label} on this frame (again: off)`, keys: [key], menu: 'Track', group: 'direction',
      when: guard((app) => !!app.doc.media && (app.doc.scenes || []).some((s) => s.start_ms <= app.player.timeMs && s.end_ms > app.player.timeMs), (app) => whyOf(app, vid) || 'Put the playhead inside a shot'), run: (app) => T(app).anchorAt(pos) })),
  // paw-2ntn: where the shot's strokes shorter than the range sit (the run row's anchor chips); no default key
  { id: 'tracking.cycleStrokeAnchor', title: 'Anchor strokes: middle / in / out / full', tip: 'Where a shorter stroke sits, in the shot at the playhead', menu: 'Track', group: 'direction',
    when: guard((app) => { const s = P(app), t = app.player.timeMs, i = s ? s.scenes.findIndex((x) => x.start_ms <= t && x.end_ms > t) : -1; return i >= 0 && !s.anchorBlock(i, undefined, 'full'); },
      (app) => { const s = P(app), t = app.player.timeMs, i = s ? s.scenes.findIndex((x) => x.start_ms <= t && x.end_ms > t) : -1; return i < 0 ? 'Put the playhead inside a tracked shot' : s.anchorBlock(i, undefined, 'full'); }),
    run: (app) => T(app).cycleAnchor() },
  // paw-azd: the shaft depth's calibration marks on the shot at the playhead (also on the video: click the "in" gauge)
  { id: 'tracking.shaftOut', title: 'Shaft: fully out here (depth mark)', keys: ['Alt+1'], menu: 'Track', group: 'direction', when: guard((app) => !!P(app)?.shaftRun(app.player.timeMs), 'Put the playhead in a shot tracked with a shaft'), run: (app) => T(app).markShaft('out') },
  { id: 'tracking.shaftHilt', title: 'Shaft: hilted here (depth mark)', keys: ['Alt+2'], menu: 'Track', group: 'direction', when: guard((app) => !!P(app)?.shaftRun(app.player.timeMs), 'Put the playhead in a shot tracked with a shaft'), run: (app) => T(app).markShaft('hilt') },
  // paw-4c48: the owner's truth marks at the frame on screen (the shaft strip's ticks; stored per shot, read by the scorecard only)
  ...[['wentIn', 'went in', 'Alt+3'], ['knotIn', 'knot in', 'Alt+4'], ['knotOut', 'knot out', 'Alt+5'], ['pulledOut', 'pulled out', 'Alt+6']].map(([k, label, key]) => (
    { id: `tracking.shaftMark.${k}`, title: `Shaft mark: ${label} here (truth, for the scorecard)`, keys: [key], menu: 'Track', group: 'direction', when: guard((app) => track(app) && !!P(app)?.shaftRun(app.player.timeMs), (app) => whyOf(app, track) || 'Put the playhead in a shot tracked with a shaft'), run: (app) => T(app).markTruth(k) })),
  // paw-4c48.15: the shaft's data under the Tracker lane (ShaftData.svelte): off by default, no room when off
  { id: 'tracking.shaftData', title: 'Shaft: show / hide its data', menu: 'Track', group: 'direction', when: guard((app) => !!P(app)?.runs.some((r) => !r.restored && shaftNames(r).length), 'Track a shot with a shaft first'), run: (app) => app.settings.set('tracking.shaftData', !app.settings.get('tracking.shaftData', false)) },
  { id: 'tracking.shaftScorecard', title: 'Shaft scorecard: all shots (summary; the table copied)', menu: 'Track', group: 'direction', when: guard((app) => !!P(app)?.runs.some((r) => !r.restored && shaftNames(r).length), 'Track a shot with a shaft first'), run: (app) => T(app).shaftScoreAll() },
  // for other features (see api.js): args {runId, t0, t1, sign} / {t0, t1}
  { id: 'tracking.setSpanOrientation', title: 'Set a run span direction', hidden: true, when: (app) => !!P(app)?.runs.length, run: (app, a) => a && T(app).setSpanOrientation(a) },
  { id: 'tracking.retrack', title: 'Re-track a range', menu: 'Track', group: 'run', when: guard((app) => !!app.doc.media, 'Open a video first'), run: (app, a) => { const r = a?.t1 > a?.t0 ? a : app.doc.range; if (r) T(app).retrack(r); else app.toast('Set a range (I / O) first', 'quiet'); } },
  // paw-x7w7: no Accept. A tracked shot plays its run live (lib/script-of.js); Bake = make permanent: no run, fusion or derive
  // change alters those points after; Unbake = the run plays there live again. One undo step each, never required.
  // args (scripts, the Track page's control): {shots: [i]} | {run: ghostId} | {all: true} | {range: {t0, t1}}; none = the
  // selected shots, else the I/O range, else the shot under the playhead. State: tracking store bakeState(i) / liveOf(axis).
  { id: 'tracking.bake', title: 'Bake: make the live points permanent', keys: ['Shift+B'], menu: 'Track', group: 'bake', when: anyLive, run: (app, a) => T(app).bake(a || {}) },
  { id: 'tracking.bakeRun', title: 'Bake the selected run (every shot it plays live)', menu: 'Track', group: 'bake', when: guard((app) => anyLive(app) && !!P(app)?.selectedId, (app) => whyOf(app, anyLive) || 'Select a run first'), run: (app) => T(app).bake({ run: P(app).selectedId }) },
  { id: 'tracking.bakeAll', title: 'Bake the whole script', menu: 'Track', group: 'bake', when: anyLive, run: (app) => T(app).bake({ all: true }) },
  { id: 'tracking.unbake', title: 'Unbake: the run plays live again', menu: 'Track', group: 'bake', when: anyUnbake, run: (app, a) => T(app).unbake(a || {}) },
  { id: 'track.export', title: 'Export run to funscript', menu: 'Track', group: 'bake', when: guard((app) => { const s = P(app); return !!s && !s.locked && !s.exportBlock(s.selectedGhost); }, (app) => { const s = P(app); return s?.locked ? BUSY : (!s?.selectedGhost ? '' : String(s.exportBlock?.(s.selectedGhost) || '').replace(/\.$/, '')) || 'Select a run first'; }), run: (app) => T(app).exportGhost() },
  { id: 'track.detectScenes', title: 'Detect scenes', menu: 'Track', group: 'scenes', when: guard((app) => { const s = P(app); return !!s && !!s.videoPath && !s.locked && s.listed; }, (app) => { const s = P(app); return !s?.videoPath ? 'Open a video first' : s.locked ? BUSY : 'Start the tracker first'; }), run: (app) => T(app).detectScenes() },
  // args {index}: that scene; none: the scene at the playhead. Hidden (no key, no menu): the timeline's scene context menu runs it.
  { id: 'track.describeScene', title: 'Describe scene', hidden: true, when: (app) => { const s = P(app); return !!s && !!s.describeParams && s.scenes.length > 0; },   // queues behind a running job
    run: (app, args) => { const t = T(app), i = args?.index ?? t.scenes.findIndex((s) => app.player.timeMs >= s.start_ms && app.player.timeMs < s.end_ms); if (i >= 0) return t.describeScene(i); } },
  { id: 'track.describeAll', title: 'Describe all scenes', menu: 'Track', group: 'scenes', when: guard((app) => { const s = P(app); return !!s && !!s.describeParams && s.scenes.length > 0 && !s.locked; }, (app) => sidecarWhy(app, (s) => !!s.describeParams, 'Scene describing') || (!P(app)?.scenes?.length ? 'Detect scenes first' : BUSY)), run: (app) => T(app).describeAll() },
  // paw-2lp7.3: a second way beside Describe all (trackers/experiments/descranges/RESULTS.md: somewhat fewer edits to the owner's
  // tagging, not decisively; Describe all keeps the per-shot facts: views, POV, boxes)
  { id: 'track.describeRanges', title: 'Describe by ranges: propose action regions', menu: 'Track', group: 'scenes', when: guard((app) => { const s = P(app); return !!s && !!s.describeParams && !!s.videoPath && !s.locked; }, (app) => sidecarWhy(app, (s) => !!s.describeParams, 'Scene describing') || BUSY), run: (app) => T(app).describeRanges() },
  // paw-ef73.10: the Scenes panel's Loop buttons went (the search runs by itself after Detect); the palette keeps it
  { id: 'track.loopScene', title: 'Look for a loop in the shot', menu: 'Track', group: 'scenes', when: guard((app) => { const s = P(app); return !!s && s.loopParams.length > 0 && s.currentScene >= 0 && !!s.scenes[s.currentScene]; }, (app) => sidecarWhy(app, (s) => !!s.loopParams?.length, 'Loop search') || 'Put the playhead inside a shot'), run: (app) => { const s = T(app); s.searchLoopAt(s.currentScene, { owner: '' }).then((l) => app.toast(l && !l.cancelled ? 'Loop found: on the shot' : 'No loop found in this shot', 'quiet')); } },
  { id: 'track.searchLoops', title: 'Look for loops in every shot without one (loop search)', menu: 'Track', group: 'scenes', when: guard((app) => { const s = P(app); return !!s && s.loopParams.length > 0 && s.scenes.length > 0 && !s.loopSearching; }, (app) => sidecarWhy(app, (s) => !!s.loopParams?.length, 'Loop search') || (!P(app)?.scenes?.length ? 'Detect scenes first' : 'Already looking for loops')), run: (app) => T(app).searchLoops() },
  { id: 'track.rangeToScene', title: 'Range to scene at playhead', menu: 'Track', group: 'scenes', when: guard((app) => (P(app)?.scenes.length || 0) > 0, 'Detect scenes first'), run: (app) => T(app).rangeToSceneAtPlayhead() },
  // span labels now derive from the scene tags at Track time (acts.js tagSpans). The manual ones stay as hidden commands
  // (no menu, no keys) so scripts and old projects keep working; a manual label still wins where it overlaps.
  { id: 'track.spans.fromPlan', title: 'Span labels from the plan', hidden: true, when: (app) => !!P(app)?.videoPath && toSpans(app.doc.plan).length > 0,
    run: (app) => { const sp = toSpans(app.doc.plan); T(app).saveSpans(sp); app.toast(`${sp.length} span label${sp.length === 1 ? '' : 's'} from the plan`, 'quiet'); } },
  { id: 'track.listTrackers', title: 'Reload tracker list', menu: 'Track', group: 'track', when: guard((app) => !P(app)?.locked, (app) => (P(app)?.busy === 'list' ? 'Already reloading the tracker list' : BUSY)), run: (app) => T(app).list() },   // paw-m3b6: not while a job runs (the panel's reload never did)
  ...SPAN_STATES.map((st) => ({ id: 'track.span.' + st, title: `Label range: ${st}`, hidden: true,
    when: (app) => track(app) && !!app.doc.range && !!P(app)?.videoPath, run: (app) => T(app).markSpan(st) })),
  // paw-2pcf: the secondary axes (surge, sway, twist, roll, pitch) measured from a run (features/tracking/axes-derive.js)
  { id: 'tracking.deriveAxes', title: 'Secondary axes from the run (surge, sway, twist ...)', menu: 'Track', group: 'axes', when: guard((app) => (P(app)?.runs.length || 0) > 0, 'Track a shot first'), run: (app) => deriveCommand(app, T(app)) },
  { id: 'tracking.addAxisLanes', title: 'Add the secondary axis lanes that have data', menu: 'Track', group: 'axes', when: guard((app) => hasAxesGhosts(app), 'Derive the secondary axes first'), run: (app) => addLanesCommand(app) },
  // paw-ef73.33: linked shots fill each other (tracking.svelte.js syncFills): the shot under the playhead (or the timeline's)
  { id: 'tracking.fillFromLink', title: 'Fill this shot from its linked loop shot', menu: 'Track', group: 'run', when: guard((app) => { const s = P(app), i = s?.currentScene ?? -1; return i >= 0 && (s.scenes[i]?.linkfill === 'off' || s.scenes[i]?.linkfill === 'detached' || s.fillOffers.some((o) => o.i === i)); }, 'Put the playhead in a shot with a linked loop'), run: (app) => { const s = T(app); s.refill(s.currentScene); } },
  { id: 'tracking.fillDismiss', title: 'Dismiss this shot\'s looped run (not refilled until asked)', menu: 'Track', group: 'run', when: guard((app) => { const s = P(app), i = s?.currentScene ?? -1; return i >= 0 && !!s.runs.find((r) => r.derived && s.fillShot(r) === i); }, 'Put the playhead in a shot with a looped run'), run: (app) => { const s = T(app), r = s.runs.find((x) => x.derived && s.fillShot(x) === s.currentScene); if (r) s.dismissFill(r.id); } },
  { id: 'tracking.fillDetach', title: 'Detach this shot\'s looped run', menu: 'Track', group: 'run', when: guard((app) => { const s = P(app), i = s?.currentScene ?? -1; return i >= 0 && !!s.runs.find((r) => s.isLiveFill(r) && s.fillShot(r) === i); }, 'Put the playhead in a shot with a looped run'), run: (app) => { const s = T(app), r = s.runs.find((x) => s.isLiveFill(x) && s.fillShot(x) === s.currentScene); if (r) s.detachFill(r.id); } },
  { id: 'tracking.flipAxis', title: 'Flip the secondary axis of this lane in this shot', menu: 'Track', group: 'axes', when: guard((app) => !!P(app) && ['surge', 'sway', 'twist', 'roll', 'pitch'].includes(app.doc.activeAxis), (app) => (!P(app) ? 'Open the Track tab first' : 'Pick a secondary axis lane first')), run: (app, a) => flipAxisCommand(app, T(app), a?.axis, a?.index) },
];
