// quickbar.js -- pure logic of the scene quick bar (SceneQuickBar.svelte): which span it is for, which
// run it reads, the tracker order, the group shares and the tag menu (shared with the scenes lane's context menu).
import { sceneIndexAt } from './scenes.js';
import { TAG_CATEGORIES, ALIASES, TAG, autoTags, sceneTags, actText, sceneStructure, partial, tagLabel, needsWhere, sceneCamera } from './acts.js';
import { shownTags } from '../../lib/content.js';
import { cleanSel, sceneRange, selScenes, selText, contiguous, sceneNo, shotLabel, cutawayMode } from './shots.js';
import { takeGroups, isIgnore, isSuggested, trackGroups } from '../tracking/groups.js';
import { fmtClock } from './ticks.js';

/** {lo, hi, t0, t1, shots, shot, one, text} for the shots: lo / hi / t0 / t1 = their hull, shot = the one the bar reads
 *  (its tags, run, signal: the active one, else the first), one = they are in one scene, text = what the chips will hit
 *  (shots.js selText: 'Scene 2 · shots 2.1 to 2.3'). */
function spanOf(list, shots, active, dur) {
  const lo = shots[0], hi = shots[shots.length - 1];
  return { lo, hi, t0: list[lo].start_ms, t1: Math.min(list[hi].end_ms, dur), shots, shot: shots.includes(active) ? active : lo,
    one: selScenes(list, shots).length === 1, contiguous: contiguous(shots), text: selText(list, shots) };
}
/**
 * The selection the bar is for (paw-k2u: a set of shots, sel = {active, shots}): spanOf | null. Shown only while the
 * selection is live: something is selected AND the range is its hull (a click sets it; Esc / another range clears it).
 */
export function barSpan(list, sel, range, dur = Infinity) {
  const s = cleanSel(list, sel);
  if (!range || !s.shots.length) return null;
  const r = spanOf(list, s.shots, s.active, dur);
  return range.t0 === r.t0 && range.t1 === r.t1 ? r : null;
}

/** The selection the bar in the lane toolbar is for: the live selection (barSpan, live: true), else the selection, else
 *  the scene at the playhead t with the shot under it (live: false: Track sets the range to it first). null with no scenes. */
export function currentSpan(list, sel, range, t, dur = Infinity) {
  const b = barSpan(list, sel, range, dur);
  if (b) return { ...b, live: true };
  const s = cleanSel(list, sel);
  if (s.shots.length) return { ...spanOf(list, s.shots, s.active, dur), live: false };
  const p = sceneIndexAt(list, t), r = sceneRange(list, p);
  return r ? { ...spanOf(list, Array.from({ length: r[1] - r[0] + 1 }, (_, k) => r[0] + k), p, dur), live: false } : null;
}

/** paw-yt8q: does Track take the I-O range as it is? Yes when no shot is selected and a range is set: the chips then show the scene at
 *  the playhead, but Track (T, the buttons) tracks the range you set; with nothing set, that scene becomes the range. */
export const tracksRange = (span, range, sel) => !!range && span?.live === false && !sel?.shots?.length;

/** paw-qoo5: Track (T, Ctrl+T, the Track buttons) with action region r selected tracks just its span: the I-O range becomes
 *  [r.t0, r.t1), a range run like any other (the run strip ties the run to it; a re-track replaces only it), and the run is
 *  told and keeps r's tags. -> {t0, t1, tags} | {why} (refused: the toast) | null (no region selected: Track as before). A
 *  region over several shots is a range across their cuts (reseeded at each, as any range). Parts painted in its shots but
 *  none inside it: refused (a range run seeds only on frames inside it). */
export function regionTrack(r, list, dur = Infinity) {
  if (!r) return null;
  if (r.kind === 'positioning') return { why: 'A positioning range is not an action (the bodies move into place): select an action to track it' };
  if (r.kind !== 'act') return { why: `${r.kind[0].toUpperCase()}${r.kind.slice(1)} is not an action: select an action to track it` };
  const t0 = r.t0, t1 = Math.min(r.t1, dur), on = (list || []).filter((s) => s.end_ms > t0 && s.start_ms < t1);
  if (on.length && !trackGroups(list, t0, t1).length && trackGroups(on, on[0].start_ms, on[on.length - 1].end_ms).length) return { why: 'Paint the parts on a frame inside this action first' };
  return { t0, t1, tags: [...(r.tags || [])] };
}

/** paw-iwb7: the track target follows the paint. Parts painted (a stroke, an accept) on frame t of shot k: -1 when what Track
 *  would track holds t (the selected action region, else the selected shots, else the I-O range Track takes as it is, else the
 *  scene at t), else k: that shot becomes the target (the region selection and the range go with it). */
export function paintTarget(list, sel, range, act, k, t, dur = Infinity) {
  if (!list[k]) return -1;
  if (act) return t >= act.t0 && t < Math.min(act.t1, dur) ? -1 : k;
  const p = currentSpan(list, sel, range, t, dur);
  if (!p) return -1;
  if (tracksRange(p, range, sel)) return t >= range.t0 && t < range.t1 ? -1 : k;
  return p.shots.includes(k) ? -1 : k;
}
/** paw-iwb7: a span in words for the Track toasts and its busy task: 'shot 3', 'shots 2 to 4', else its times. */
export function spanText(list, t0, t1) {
  const on = (list || []).flatMap((s, k) => (s.end_ms > t0 + 1 && s.start_ms < t1 - 1 ? [k] : []));
  const lo = on[0], hi = on[on.length - 1];
  const whole = on.length > 0 && Math.abs(list[lo].start_ms - t0) < 1 && (Math.abs(list[hi].end_ms - t1) < 1 || (hi === list.length - 1 && list[hi].end_ms >= t1));
  return !whole ? `${fmtClock(t0)}–${fmtClock(t1)}` : lo === hi ? `shot ${shotLabel(list, lo)}` : `shots ${shotLabel(list, lo)} to ${shotLabel(list, hi)}`;
}

/** paw-rw84: why Track (the point grid, the default Track) cannot run now, as the buttons' toast says it ('' = it can). */
// paw-u0ik: with no point tracker (a CPU-only install), the CPU tracker that works there and how to run it
// paw-ws19: before the tracker list has come there is no telling: never the "needs a GPU" words then
export const gridBlock = (T, key = 'Ctrl+T') => (T.canGrid ? '' : T.gridTracker ? 'Busy: wait for the current tracker job'
  : T.listed === false && !T.trackers?.length ? T.error || 'Loading the trackers…'
  : `Grid needs a point tracker (TAPNext++, which needs a CUDA GPU)${T.trackers?.some((x) => x.id === 'lk_box') ? `. Without one: Optical flow (box) follows a painted part: paint it with Groups (Tab), then ${key || 'Ctrl+T'} (Track ROI)` : ''}`);

/** paw-rw84: the chips row's Groups button for shot k: count = the painted groups of its take (ignore regions and
 *  unaccepted suggestions left out); enabled like the Groups command (a video, the Track tab); pressed = the tool is open. */
export function groupsButton(list, k, { media, mode, on }) {
  const count = k >= 0 && list[k] ? takeGroups(list, k).filter((g) => !isIgnore(g) && !isSuggested(g)).length : 0;
  return { count, enabled: !!media && mode === 'track', pressed: !!on };
}

/** One Track (paw-k2u, paw-t8z): a set of shots that is not one unbroken run tracks exactly those shots (trackShots);
 *  the chip, the quick bar and the Tracker panel all go through here. -> true when it did, false = track the range. */
export function trackPicked(T, span) {
  if (!(span?.shots.length > 1 && !span.contiguous)) return false;
  T.trackShots?.(span.shots);
  return true;
}

/** Motion group k (1..4) of run runId becomes the signal, and shot i's scene is linked to that run's g{k}_proj
 *  (paw-t8z: the quick bar, the Inspector and the Tracker panel's legend pick the same way). */
export function pickGroupFor(T, k, runId, i) {
  T.pickGroup(k, runId);
  if (i >= 0) T.linkScene?.(i, runId, `g${k}_proj`);
}

/** The run the bar reads (shares, signal): the scene's linked run (if it still exists), else the selected run. */
export function runFor(T, i) {
  if (!T) return null;
  const link = T.sceneLink?.(i), linked = link && T.run?.(link.runId);
  return linked || T.selected || null;
}
/** The signal name for the bar: the link's channel, else the run's ('g2_proj' -> 'g2'). */
export function signalOf(T, i, run) {
  const link = T?.sceneLink?.(i), ch = (run && T?.shotSource?.(run, i)) || (link && link.runId === run?.id && link.channel) || run?.channel || '';   // paw-9qm: the shot's own source first
  return String(ch).replace(/_proj$/, '');
}

const isPoint = (t) => t.roi === 'points' || /_points$/.test(t.id);
/** Tracker options, the point trackers first (stable otherwise). */
export const trackerOptions = (trackers = [], off = () => false) => [...trackers.filter(isPoint), ...trackers.filter((t) => !isPoint(t))]
  .map((t) => ({ value: t.id, label: t.name || t.id, ...(off(t) && { disabled: true, hint: 'needs a GPU' }) }));   // off: paw-k97q, the GPU is off

/** Motion-group member shares of a grid run over [t0, t1): [n1..n4] (0..1, NaN = no samples), or null without groups. */
export function groupShares(run, t0, t1) {
  const ch = run?.channels;
  if (!ch?.g1_n) return null;
  return [1, 2, 3, 4].map((k) => {
    const c = ch[`g${k}_n`];
    if (!c) return NaN;
    let s = 0, n = 0;
    for (let j = 0; j < c.t.length; j++) if (c.t[j] >= t0 && c.t[j] < t1 && Number.isFinite(c.v[j])) { s += c.v[j]; n++; }
    return n ? s / n : NaN;
  });
}

/** The tag menu items for scene s: a section per category (or only `cats`), a checkbox per tag ("(detected)" = its
 *  describe gives it; What starts with the aliases: rimming = anal + licking), then "Reset to describe" when the user
 *  changed any (Camera: from Detect scenes). act(id) toggles a tag or alias, act(null) resets. */
export function tagItems(s, act, cats = TAG_CATEGORIES.map((c) => c.id).filter((c) => c !== 'modifier')) {   // a modifier is no scene tag (paw-8b4h)
  const auto = autoTags(s), on = sceneTags(s);
  const aliases = Object.entries(ALIASES).filter(([, p]) => Array.isArray(p))
    .map(([w, p]) => ({ label: `${w} (${p.join(' + ')})`, checked: p.every((x) => on.includes(x)), run: () => act(w) }));
  return [
    ...TAG_CATEGORIES.filter((c) => cats.includes(c.id)).flatMap((c) => [{ section: c.label }, ...(c.id === 'what' ? [...aliases, { separator: true }] : []),
      ...shownTags(c.tags, (id) => on.includes(id)).map((t) => ({ label: auto.includes(t.id) ? `${t.label} (detected)` : t.label, checked: on.includes(t.id), run: () => act(t.id) }))]),
    ...(s.tags?.length ? [{ separator: true }, { label: 'Reset to describe', run: () => act(null) }] : []),
  ];
}

// ---- the toolbar chips (paw-hmn): one-line summaries of what the Scene / Shot chip popovers act on ----
/**
 * {scene: {text, untagged, notes: [..]}, shot: {text, notes: [..]}} for a span (currentSpan): the Scene chip says the
 * scene and its act ('Scene 3 · anal penetration', 'Scene 5 · untagged', 'Scenes 2 to 4'), the Shot chip the
 * shot, its camera and view ('Shot 3.2 · pan · internal') or the selection ('3 shots in Scene 2'). notes = the hints that
 * used to be extra lines ('needs a where', 'cannot fill: ...', '2 offered', '1 group to confirm'): a dot on the chip,
 * the words in its popover and tooltip. extra.fillNeed = fillHint's text when a fill cannot work.
 */
export function chipTexts(list, span, { fillNeed = '' } = {}) {
  if (!span || !list[span.shot]) return null;
  const s = list[span.shot], scenes = selScenes(list, span.shots), r = sceneRange(list, span.shot);
  const S = { ...s, start_ms: list[r[0]].start_ms, end_ms: list[r[1]].end_ms };
  const act = actText(S), st = sceneStructure(S);   // its action only: modifiers are the Modifiers row's (paw-8b4h)
  const head = act || (st ? tagLabel(st) : '');
  const sceneText = scenes.length > 1 ? `Scenes ${sceneNo(list, scenes[0][0]) + 1} to ${sceneNo(list, scenes[scenes.length - 1][0]) + 1}`
    : [`Scene ${sceneNo(list, span.shot) + 1}`, head || 'untagged'].join(' · ');
  const sceneNotes = [...(needsWhere(S) ? ['needs a where'] : []), ...(fillNeed ? [fillNeed] : []), ...(s.offers?.length ? [`${s.offers.length} offered by a merge`] : [])];
  const cam = sceneCamera(s), view = sceneTags(s).find((t) => TAG[t].cat === 'view'), cm = cutawayMode(list, span.shot);
  // paw-unuy: several shots: just how many (the Shots strip shows which; the words stay in the chip's tooltip)
  const shotText = span.shots.length > 1 ? `${span.shots.length} shots` : [`Shot ${shotLabel(list, span.shot)}`, ...(cam && cam !== 'static' ? [tagLabel(cam)] : []), ...(view ? [view === 'internal' ? 'internal' : tagLabel(view)] : []), ...(cm === 'carried' ? ['action continues'] : cm === 'intermission' ? ['intermission'] : []), ...(cm && s.fill === 'timing' ? ['timing from this shot'] : [])].join(' · ');   // paw-2lp7.4: what a cutaway does
  const unconf = span.shots.reduce((n, k) => n + (list[k]?.groups || []).filter((g) => g.unconfirmed && g.t_ms >= list[k].start_ms && g.t_ms < list[k].end_ms).length, 0);
  return { scene: { text: sceneText, untagged: scenes.length === 1 && !head, notes: sceneNotes }, shot: { text: shotText, ...(span.shots.length > 1 ? { tip: selText(list, span.shots) } : {}), notes: unconf ? [`${unconf} group${unconf > 1 ? 's' : ''} found again after a cut: accept or repaint`] : [] } };
}
