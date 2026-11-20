// fix.svelte.js -- "Fix a goofed section", the app side. Every fix works on fixRange (I/O range, else the selected
// points' span), builds a new piece for that span and splices it in with clean seams (logic.js), as ONE undo entry.
// Re-track reuses the tracking feature (retrack = Track mode + range, the region a painted part's bounds; trackRange = the job + live overlay + ghost);
// regenerate reuses the plan compiler through timeline/generate-logic.js; flip / scale / retime are lib/edit OPS.
import { fixRange, spliceRange, piece, flipPiece, scalePiece, retimePiece, regenerateSpan, overlapping } from './logic.js';
import { profileOf } from '../lanes/deps.js';
import { effectiveMaxSpeed } from '../../lib/analyze/profiles.js';
import { findProblems } from '../../lib/analyze/index.js';
import { trackerRuns, chooseRun, runsOver, runLabel } from '../timeline/generate-logic.js';
import { newId } from '../timeline/state.svelte.js';
import { trackingFor } from '../tracking/tracking.svelte.js';
import { trackingApi } from '../tracking/api.js';
import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live

/** Panel state: the recipe picked for regenerate, a focus request for the picker, the re-track waiting for its ROI. */
export const fixUI = $state({ recipe: '', focusPicker: 0, shown: false, pending: null, busy: '' });

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const keyOf = (app, id) => app.commands.keysFor?.(id)?.[0] || '';
/** Device limits for seams: the active profile's speed cap and minimum interval. Generated spans (regenerate) respect
 *  both; spliced measured / edited points (re-track, flip, scale, retime) only the interval: capping their seams would
 *  delete the user's points wherever the original already ran fast (the panel lists speed problems; Cap speed fixes them). */
export function limits(app) {
  try { const p = profileOf(app); return { maxSpeed: +effectiveMaxSpeed(p) || 0, minGapMs: Math.max(1, +p.minIntervalMs || 20) }; } catch { return { maxSpeed: 0, minGapMs: 20 }; }
}
export const rangeOf = (app) => fixRange(app.doc);
function needRange(app) {
  const r = rangeOf(app);
  if (!r) app.toast('Set a range (I / O) or select points first', 'quiet');
  return r;
}

/** Write a new script for the span (plus an optional plan) as one undo entry; select what landed; toast with Undo. */
function commit(app, label, axis, script, { plan, r, note = '' } = {}) {
  app.transact(label, () => {
    app.edit(label, axis, script);
    if (plan) app.doc.plan = plan;
  });
  const ats = piece(script, r).map((a) => a.at);
  if (axis === app.doc.activeAxis) app.select(ats, axis);
  app.toast(`${label}: ${plural(ats.length, 'point')} in ${((r.t1 - r.t0) / 1000).toFixed(1)} s${note}`, 'ok',
    { action: { label: 'Undo', run: () => app.undo() } });
  return true;
}

// ---- flip / scale / retime: the span's own points through an edit op, spliced back ----
function inPlace(app, label, make) {
  const r = needRange(app);
  if (!r) return false;
  const axis = app.doc.activeAxis, base = scriptOf(app, axis), p = piece(base, r);
  if (!p.length) { app.toast('No points in the range', 'quiet'); return false; }
  return commit(app, label, axis, spliceRange(base, r.t0, r.t1, make(p, r), { minGapMs: limits(app).minGapMs }), { r });
}
export const flip = (app) => inPlace(app, 'Fix: flip direction', (p) => flipPiece(p));
export const scale = (app, factor) => inPlace(app, `Fix: depth ×${factor}`, (p) => scalePiece(p, factor));
export const retime = (app, { factor = 1, dt = 0 }) => inPlace(app, 'Fix: retime', (p, r) => retimePiece(p, r.t0, { factor, dt }));

// ---- regenerate ----
/** The recipe of the plan segment under the range, if any (the picker's starting value). */
export function currentRecipe(app) {
  const r = rangeOf(app);
  return (r && overlapping(app.doc.plan, r.t0, r.t1)[0]?.recipe) || 'penetration';
}
export function regenerate(app, recipe = fixUI.recipe || currentRecipe(app)) {
  const r = needRange(app);
  if (!r) return false;
  const axis = app.doc.activeAxis, lim = limits(app);
  const out = regenerateSpan({ axes: { [axis]: scriptOf(app, axis) }, plan: app.doc.plan }, axis, r, { recipe, ...lim, ids: { seg: newId('s'), right: newId('s') } });
  if (out.error) { app.toast(out.error, 'warn'); return false; }
  const warn = out.issues.find((i) => i.level !== 'error');
  return commit(app, `Fix: regenerate (${recipe})`, axis, out.script, { plan: out.plan, r, note: (out.plan ? ' · plan segment split' : '') + (warn ? ` · ${warn.msg}` : '') });
}

// ---- re-track ----
/**
 * First press: Track mode with the range preset (tracking.retrack). Once a part is painted in the range (its bounds are the
 * region; or the tracker takes none), the next press tracks only the range with the current tracker and stroke axis
 * (trackRange: live overlay, the run stays as a ghost to compare) and splices its points in.
 */
export async function retrack(app) {
  if (fixUI.busy) { app.toast('A re-track is already running', 'quiet'); return false; }
  const r = needRange(app);
  if (!r) return false;
  if (!app.doc.media) { app.toast('Open a video first', 'quiet'); return false; }
  const T = trackingFor(app), api = trackingApi(app);
  try { await api.trackers(); } catch (e) { app.toast(String(e?.message || e), 'warn'); return false; }
  // paw-x8we: the region is a painted part's bounds (nothing is drawn on the video any more), else a box set by code
  const t = T.tracker, roi = T.roi || T.partRoiIn(r.t0, r.t1) || T.trackRoi;
  if (!t) { app.toast('Pick a tracker in the Track panel first', 'quiet'); return false; }
  // ready: the tracker takes no region, or a part is painted in the range
  if (!(t.roi === 'none' || roi)) {
    fixUI.pending = { ...r, axis: app.doc.activeAxis, mode: app.mode };
    T.retrack(r);
    app.toast(`Paint the part with Groups (${keyOf(app, 'tracking.groups') || 'Tab'}; ${keyOf(app, 'tracking.axisDraw') || 'X'} for the stroke axis), then press ${keyOf(app, 'fix.retrack')} to re-track and splice`, 'info');
    return false;
  }
  const pend = fixUI.pending || { axis: app.doc.activeAxis, mode: '' };
  fixUI.busy = 'retrack';
  let res;
  try { res = await api.trackRange({ tracker: t.id, range: r, roi: t.roi === 'none' ? null : JSON.parse(JSON.stringify(roi)), params: JSON.parse(JSON.stringify(T.params || {})), tag: 'fix' }); }
  finally { fixUI.busy = ''; }
  if (res.cancelled) { app.toast('Re-track canceled', 'quiet'); return false; }
  if (res.error) { app.toast('Re-track failed: ' + res.error, 'error'); return false; }
  fixUI.pending = null;
  const g = app.doc.ghosts.find((x) => x.id === res.run.id), pts = piece(g?.script || [], r);
  if (!pts.length) { app.toast(`${g?.name || 'The run'} has no points in the range: nothing spliced (the run stays as a ghost)`, 'warn'); return false; }
  const axis = pend.axis, base = scriptOf(app, axis);
  const ok = commit(app, `Fix: re-track (${g.name})`, axis, spliceRange(base, r.t0, r.t1, pts, { minGapMs: limits(app).minGapMs }), { r, note: ` · ${g.name} kept as a ghost to compare` });
  if (pend.mode && pend.mode !== app.mode) app.setMode(pend.mode);
  return ok;
}

// ---- what the panel shows ----
/** {r, n, sources: [label], problems: [{severity, message, t0}]} for the current span, or null. */
export function info(app) {
  const r = rangeOf(app);
  if (!r) return null;
  const doc = app.doc, axis = doc.activeAxis, base = scriptOf(app, axis);
  const runs = trackerRuns(doc.ghosts, axis), all = trackerRuns(doc.ghosts, axis, true);
  const segs = overlapping(doc.plan, r.t0, r.t1);
  const sources = segs.length
    ? segs.map((s) => `${s.kind} (${s.recipe})${(() => { const g = chooseRun(s, runs, all); return g ? ' · follows ' + runLabel(g) : ''; })()}`)
    : runsOver(r, runs).map((g) => 'tracked by ' + runLabel(g));
  let problems = [];
  try {
    const pad = 2000, around = base.filter((a) => a.at >= r.t0 - pad && a.at <= r.t1 + pad);
    problems = findProblems(around, profileOf(app)).filter((p) => p.t0 <= r.t1 && p.t1 >= r.t0);
  } catch { /* no profile in a bare harness */ }
  return { r, n: piece(base, r).length, sources, problems };
}
