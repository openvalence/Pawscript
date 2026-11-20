// track-plan.js -- "Track tagged scenes": what to run per scene, read from the scene tags. Pure.
// off-screen (or a cutaway under an action, paw-2lp7.4) -> skip (no run spans it, so the bridge fills it from the
// neighbours) unless it has the timing option (tracked for its turn times); a cutaway with no action -> skip (an
// intermission); blank -> skip (held); a structure
// tag (intro / idle / after / outro) -> skip (generated) unless exposed; insertion -> skip (one generated push); `skip` (timeline/acts.js skipReason) says why; exposed (dick
// out, no act) -> a points tracker on the whole-frame grid, so the seeded penis / balls groups exist (sem_penis_scale is
// the throb signal); internal view -> SAM area
// (scenes-continue.js INTERNAL_TRACK) with the box drawn on that scene, else describe's shaft box, else it needs a box;
// any other scene (tags or not) -> the panel's tracker / params / ROI. Shots of one scene (join, timeline/shots.js: the
// entries here are shots) and scenes that continue each other (continues true or 'auto', camera splits) are ONE item: one row, its pieces tracked in `segments` (each a contiguous run of scenes =
// one track request; the document cuts inside it still re-seed and normalise per scene, protocol.js trackCuts, camera
// splits excepted). Cutaways and internal views between pieces are never inside a segment. A scene already linked to a
// live run, or wholly covered by a tracker run, is done unless `force`.
// What is internal / off-screen / the camera comes from the caller (timeline/acts.js); the defaults read the raw tags.
import { roiOk } from './protocol.js';
import { INTERNAL_TRACK, shaftBox } from './scenes-continue.js';
import { linkFor } from './runs.js';
import { CAMERA_SIGNAL } from './runs-channel.js';

const raw = (s) => (s?.tags || []).map((t) => t?.id ?? t);
const CAMERAS = ['static', 'reciprocal', 'pan', 'zoom', 'orbit', 'handheld', 'pov'];
const STRUCTURE = ['intro', 'idle', 'after', 'outro'];
const DEFAULTS = {
  internal: (s) => raw(s).includes('internal'),
  offscreen: (s) => raw(s).includes('offscreen') || (!!s?.carried && raw(s).includes('cutaway')),   // paw-2lp7.4: a cutaway under an action
  exposed: (s) => raw(s).includes('exposed'),
  skip: (s) => {
    const r = raw(s), st = r.find((t) => STRUCTURE.includes(t)) ?? s?.structure;
    if (r.includes('cutaway') && !s?.carried) return 'cutaway: an intermission, nothing carried';   // paw-2lp7.4 (acts.js skipReason)
    if (r.includes('blank') || (s?.kind === 'blank' && !r.includes('-blank'))) return 'blank: hold';
    return st && !r.includes('exposed') ? `${st}: nothing to track, generated` : '';
  },
  camera: (s) => raw(s).find((t) => CAMERAS.includes(t)) ?? null,
};
// paw-x8we: no box is drawn on the video any more: a painted part's bounds are the box (tracking.svelte.js plan)
const ROI_ASK = { box: 'paint the part with Groups (Tab)', points: 'paint the part with Groups (Tab)', box_or_points: 'paint the part with Groups (Tab)' };

/** 'S3', 'S3–S4 + S6' for 0-based scene indices (sorted). */
export function scenesLabel(ix) {
  const out = [];
  for (let k = 0; k < ix.length; k++) {
    let j = k;
    while (j + 1 < ix.length && ix[j + 1] === ix[j] + 1) j++;
    out.push(j > k ? `S${ix[k] + 1}–S${ix[j] + 1}` : `S${ix[k] + 1}`);
    k = j;
  }
  return out.join(' + ');
}

/**
 * scenes: the document scenes as drawn (continues / split / tags). Options: skip(scene) -> why it is not tracked ('' =
 * tracked; off-screen too unless `offscreen` says so), runs [{id, t0, t1, tag?}] (live tracker
 * runs / ghosts), links (tracking links), roi (the panel's pending or last ROI, roi.t_ms = where it was drawn),
 * trackerId / params (the panel's: the user's tracker, not an internal-view auto pick), trackers [{id, name, roi}],
 * range {t0, t1} (only the scenes it touches, clipped; with no scenes it is the one item), only (shot indices: just
 * those shots, a selection), force (re-track done
 * scenes), panelOnly (manual T: every piece takes the panel's tracker, internal views too).
 * -> [{sceneIdx, t0, t1, segments: [[t0, t1]], action: 'track'|'skip'|'needs-roi'|'done', tracker, roi, params, name,
 *  signal, cameras, reason, label, seekMs}] in time order. tracker '' = no tracker yet (needs-roi does not apply).
 */
export function planTracks(scenes = [], o = {}) {
  const { runs = [], links = [], roi = null, trackerId = '', params = {}, trackers = [], range = null, force = false, panelOnly = false, grid = null } = o;
  const only = o.only ? new Set(o.only) : null;   // paw-k2u: a selection of shots: just those (the others are out of range)
  const internal = o.internal || DEFAULTS.internal, offscreen = o.offscreen || DEFAULTS.offscreen, exposed = o.exposed || DEFAULTS.exposed, camera = o.camera || DEFAULTS.camera, skip = o.skip || DEFAULTS.skip;
  const skipWhy = (s) => (offscreen(s) && s?.fill !== 'timing' ? 'off-screen: bridged from the neighbors' : skip(s) || '');   // the timing option: tracked
  const T = (id) => trackers.find((t) => t.id === id);
  const kindOf = (id) => T(id)?.roi ?? 'none';
  const sam = !panelOnly && (!trackers.length || !!T(INTERNAL_TRACK.tracker));   // no SAM installed: internal views take the panel's tracker
  // no box drawn and the tracker takes one: the whole-frame grid (the owner's "grid track everything"; the Grid button's
  // params), so a plan never stops for a box a grid would do. grid = {points} from settings 'tracking.gridPoints'.
  const gridBox = (k) => grid && (k === 'box' || k === 'box_or_points') ? { kind: 'box', x: 0, y: 0, w: 1, h: 1 } : null;
  const gridParams = (id) => ({ box_seed: 'grid', box_points: Math.min(4096, Math.max(4, Math.round(grid?.points) || 512)), ...(id === 'cotracker_points' ? { mode: 'offline' } : {}) });
  const panelItem = (base) => {
    const k = kindOf(trackerId), ok = k === 'none' || roiOk(k, roi), g = !ok && gridBox(k);
    if (trackerId && g) return { ...base, action: 'track', tracker: trackerId, roi: g, params: { ...params, ...gridParams(trackerId) }, name: '', grid: true,
      reason: ['whole-frame grid (no box drawn)', base.reason].filter(Boolean).join(' · ') };
    return { ...base, action: !trackerId || ok ? 'track' : 'needs-roi', tracker: trackerId, roi: k === 'none' ? null : ok ? roi : null, params: { ...params }, name: '',
      reason: trackerId && !ok ? `${T(trackerId)?.name || trackerId}: ${ROI_ASK[k] || 'paint the part with Groups (Tab)'}` : base.reason || '' };
  };
  // exposed: the panel's tracker when it is a points tracker, else TAPNext++ (else the first one installed), on the whole frame (a box ROI:
  // the seeded groups need one); no points tracker that takes a box -> the panel's item
  const POINTS = /_points$/, pid = POINTS.test(trackerId) ? trackerId : (trackers.find((t) => t.id === 'tapnext_points') || trackers.find((t) => POINTS.test(t.id)))?.id;   // TAPNext++ first (paw-vdr4)
  const exposedItem = (base) => (!pid || kindOf(pid) === 'points' ? panelItem(base) : { ...base, action: 'track', tracker: pid, roi: { kind: 'box', x: 0, y: 0, w: 1, h: 1 },
    params: { ...(pid === trackerId ? params : {}), ...gridParams(pid) }, name: '', grid: true, reason: ['exposed: track for the throb (penis/balls scale)', base.reason].filter(Boolean).join(' · ') });
  if (!scenes.length) {
    if (!(range?.t1 > range?.t0)) return [];
    return [panelItem({ sceneIdx: [], t0: range.t0, t1: range.t1, segments: [[range.t0, range.t1]], signal: '', cameras: [], label: 'Whole range', seekMs: Math.round((range.t0 + range.t1) / 2) })];
  }
  const lo = (i) => Math.max(scenes[i].start_ms, range ? range.t0 : -Infinity), hi = (i) => Math.min(scenes[i].end_ms, range ? range.t1 : Infinity);
  const inRange = scenes.map((_, i) => hi(i) > lo(i) && (!only || only.has(i)));
  const why0 = scenes.map(skipWhy), off = (i) => !!why0[i], int = (i) => sam && internal(scenes[i]);
  // groups: a continuing scene joins its action (the scene before its cutaways / internal views; a camera split: the
  // scene right before it); internal views join a continuing internal view right before them
  const groupOf = new Map(), groups = [];
  for (let i = 0; i < scenes.length; i++) {
    if (!inRange[i] || off(i)) continue;
    const s = scenes[i], cont = !!s.continues || s.split === 'camera' || s.join === true;
    let j = -1;
    if (cont && int(i)) j = i - 1 >= 0 && int(i - 1) && !off(i - 1) ? i - 1 : -1;
    else if (cont) {   // a joined shot (timeline/shots.js) only walks back over its own scene's skipped / internal shots
      j = i - 1;
      while (j >= 0 && (off(j) || int(j) || (only && !only.has(j)))) { if (!s.continues && s.split !== 'camera' && scenes[j].join !== true) { j = -1; break; } j--; }   // a shot left out of a selection is walked over like a skipped one
    }
    const g = j >= 0 && groupOf.has(j) && int(j) === int(i) ? groupOf.get(j) : null;
    if (g) g.push(i); else groups.push([i]);
    groupOf.set(i, g || groups[groups.length - 1]);
  }
  const live = new Set(runs.map((r) => r.id));
  const doneBy = (i) => {
    const s = scenes[i], l = links[linkFor(links, s)];
    if (l && live.has(l.run)) return `linked to ${l.run}`;
    const r = runs.findLast((x) => !x.tag && x.t0 <= s.start_ms && x.t1 >= s.end_ms);   // a camera reference (tag) tracks no scene
    return r ? `covered by ${r.id}` : '';
  };
  const items = [];
  for (let i = 0; i < scenes.length; i++) {
    if (inRange[i] && off(i)) items.push({ sceneIdx: [i], t0: lo(i), t1: hi(i), segments: [], action: 'skip', tracker: '', roi: null, params: {}, name: '', signal: '', cameras: [],
      reason: why0[i], label: scenesLabel([i]), seekMs: Math.round((lo(i) + hi(i)) / 2) });
  }
  for (const g of groups) {
    const why = force ? [] : g.map(doneBy), todo = g.filter((_, k) => !why[k]);
    const segments = [];
    for (const i of todo) { const last = segments[segments.length - 1]; if (last && last.end === i - 1) { last.end = i; last.t1 = hi(i); } else segments.push({ end: i, t0: lo(i), t1: hi(i) }); }
    const cams = todo.map((i) => camera(scenes[i])).filter(Boolean);
    const signal = [...new Set(cams.map((c) => CAMERA_SIGNAL[c]).filter(Boolean))].join(', ');
    const gaps = []; for (let i = g[0] + 1; i < g[g.length - 1]; i++) if (!g.includes(i)) gaps.push(i);
    const across = gaps.length ? `continues across ${gaps.map((i) => `S${i + 1} (${off(i) ? why0[i].split(':')[0] : int(i) ? 'internal' : 'own row'})`).join(', ')}` : '';
    const partly = why.some(Boolean) && todo.length ? `${scenesLabel(g.filter((_, k) => why[k]))} already done` : '';
    const first = todo[0] ?? g[0];
    const base = { sceneIdx: g, t0: lo(g[0]), t1: hi(g[g.length - 1]), segments: segments.map((x) => [x.t0, x.t1]), signal, cameras: cams, label: scenesLabel(g),
      seekMs: Math.round((lo(first) + hi(first)) / 2), reason: [across, partly].filter(Boolean).join(' · ') };
    if (!todo.length) { items.push({ ...base, action: 'done', tracker: '', roi: null, params: {}, name: '', reason: why[0] + (g.length > 1 ? ` (+${g.length - 1})` : '') }); continue; }
    if (!int(g[0])) { items.push(todo.every((i) => exposed(scenes[i])) ? exposedItem(base) : panelItem(base)); continue; }
    // internal view: SAM area; the box drawn on one of its scenes, else describe's shaft box, else ask for one
    const drawn = roi?.kind === 'box' && roi.t_ms != null && g.some((i) => roi.t_ms >= scenes[i].start_ms && roi.t_ms < scenes[i].end_ms) ? roi : null;
    const box = drawn || g.map((i) => shaftBox(scenes[i].describe)).find(Boolean) || null, k = kindOf(INTERNAL_TRACK.tracker);
    const ok = k === 'none' || roiOk(k, box);
    if (!ok && trackerId && gridBox(kindOf(trackerId))) {   // no box for SAM: the grid with the panel's tracker (paint the inserted part for SAM area)
      items.push({ ...base, action: 'track', tracker: trackerId, roi: gridBox(kindOf(trackerId)), params: { ...params, ...gridParams(trackerId) }, name: '', grid: true,
        reason: ['internal view, no box: whole-frame grid (paint the inserted part for SAM area)', base.reason].filter(Boolean).join(' · ') });
      continue;
    }
    items.push({ ...base, action: ok ? 'track' : 'needs-roi', tracker: INTERNAL_TRACK.tracker, roi: ok && k !== 'none' ? box : null, params: { ...INTERNAL_TRACK.params }, name: INTERNAL_TRACK.label,
      reason: [ok ? `internal view: ${INTERNAL_TRACK.label}, ${drawn ? 'the bounds of the painted part' : 'box from describe'}` : 'internal view: paint the inserted part with Groups (Tab)', base.reason].filter(Boolean).join(' · ') });
  }
  // a box drawn on an internal view is for the inserted part, not for the scenes around it
  if (sam && roi?.t_ms != null) {
    const at = scenes.findIndex((s) => roi.t_ms >= s.start_ms && roi.t_ms < s.end_ms);
    if (at >= 0 && internal(scenes[at])) for (const it of items) if (it.tracker === trackerId && it.action === 'track' && it.roi === roi && kindOf(trackerId) !== 'none') {
      const g = gridBox(kindOf(trackerId));
      Object.assign(it, g ? { roi: g, params: { ...it.params, ...gridParams(trackerId) }, grid: true, reason: 'whole-frame grid (the part is painted on an internal view)' }
        : { action: 'needs-roi', roi: null, reason: `${T(trackerId)?.name || trackerId}: ${ROI_ASK[kindOf(trackerId)]} (the part is painted on an internal view)` });
    }
  }
  return items.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
}

/** '12 to track · 3 skipped · 2 need a box · 4 done' (zero counts left out; '' for an empty plan). */
export function planSummary(plan = []) {
  const n = (a) => plan.filter((x) => x.action === a).length, parts = [];
  const t = n('track'), s = n('skip'), r = n('needs-roi'), d = n('done');
  if (t) parts.push(`${t} to track`);
  if (s) parts.push(`${s} skipped`);
  if (r) parts.push(`${r} need${r === 1 ? 's' : ''} a box`);
  if (d) parts.push(`${d} done`);
  return parts.join(' · ');
}
