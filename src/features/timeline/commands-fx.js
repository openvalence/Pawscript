// commands-fx.js -- the Modifiers row (doc.fx, lib/fx.js; FxLane.svelte): its edits, the fits, spurts / a single throb at
// the playhead, the balls -> spurts suggestion. Delete / G / S / Escape fire only while the row has keyboard focus and a
// modifier is selected. Every edit is ONE app.transact on app.doc.fx. Marking (the kinds' commands): commands-mods.js.
import { tl, scenesOf, newId, durOf, setDraft, clearDraft, listOf } from './state.svelte.js';
import { remove } from './intervals.js';
import { grabRow } from './interact.js';
import { spurtOrgasmHint } from './commands-mods.js';
import { sceneAtPlayhead } from './scenes.js';
import { playheadFrameStart, gridOf, frameStartOf, frameAt, frameTime, clockOf } from '../../lib/lane.js';
import { addFx, setFxKind, toggleMute, duplicateFx, linkFx, unlinkFx, linkMembers, addSpurt, withInner } from './fx-edit.js';
import { FX_KINDS, FX_KIND_IDS, REFINE_WHY, fitProfile, fitKnotIn, fitKnotOut, fitInsertion, knotMode, fxParams, throbPeriod, isPointFx, singleThrob } from '../../lib/fx.js';
import { run as runXform } from '../../lib/xform.js';
import { trackerRuns, chooseRun } from './generate-logic.js';
import { scalePeaks } from '../../lib/runs-channel.js';
import { ballsReason } from './balls.js';
import { modAt, makeMod } from './mods.js';
import { trackingOf } from './deps.js';
import { resolveTracked } from './mods-tracked.js';
import { ownRuns } from './mod-runs.js';
import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live
import { addEditorSelection } from '../../ui/kit/editor-item.svelte.js';
import { guard, whyOf } from '../../app/commands.js';
import { toggleCmd } from '../../lib/selmodal.js';

/**
 * "Fit from motion" for a Reshape over [t0, t1]: the tracker run under the span (the visible run covering most of it,
 * generate-logic chooseRun), its own track (the per-scene channel composition `lane` when a channel is picked, else
 * the sidecar's samples) against its keyframes. -> Reshape params | null (no run with samples there).
 */
export function fitShape(app, t0, t1) {
  const { g, track } = runUnder(app, t0, t1);
  return g && track?.t?.length ? fitProfile(track, g.script, t0, t1) : null;
}
/** The tracker run under [t0, t1] (generate-logic chooseRun) and its own track (channel lane, else samples). -> {g, track}. */
function runUnder(app, t0, t1) {
  const axis = app.doc.activeAxis ?? 'stroke', g = chooseRun({ t0, t1 }, trackerRuns(app.doc.ghosts, axis), trackerRuns(app.doc.ghosts, axis, true));
  const run = g && trackingOf(app)?.run?.(g.id);
  return { g, run, track: run?.lane?.t?.length ? run.lane : run?.samples };
}
/** The shot's run under [t0, t1] (what a modifier there reads from "the original track"), or null. */
export const shotRun = (app, t0, t1) => runUnder(app, t0, t1).run ?? null;
/** "Fit" for a throb over [t0, t1]: the beat period off the run's balls / penis scale-channel peaks there (the pulses are
 *  the throb), else off the small dips of its track (lib/fx throbPeriod; runs-channel scalePeaks). -> {period} | null. */
export function fitThrob(app, t0, t1) {
  const { run, track } = runUnder(app, t0, t1), peaks = (ch, sign = -1) => (ch?.t?.length ? scalePeaks(ch, t0, t1, { sign, minGapMs: 200 }) : []);
  const own = Object.keys(run?.channels || {}).filter((c) => /^sem_c[12]_(balls|penis)\d*_scale$/.test(c));   // paw-x99: a character's balls / penis too
  for (const k of ['sem_balls_scale', 'sem_penis_scale', ...own.sort((a, b) => b.includes('_balls') - a.includes('_balls'))]) { const p = throbPeriod(peaks(run?.channels?.[k])); if (p) return { period: p }; }
  const p = throbPeriod(peaks(track)) ?? throbPeriod(peaks(track, 1));   // the track's sign is the tracker's
  return p ? { period: p } : null;
}
/** "Fit" for a single knot over [t0, t1]: push / pop timing off the run's track (lib/fx fitKnotIn). -> params | null. */
export function fitKnot(app, t0, t1) {
  const { track } = runUnder(app, t0, t1);
  return track?.t?.length ? fitKnotIn(track, t0, t1) : null;
}
/** "Fit" for an unknot over [t0, t1]: pull / pop timing off the run's track (lib/fx fitKnotOut). -> params | null. */
export function fitUnknot(app, t0, t1) {
  const { track } = runUnder(app, t0, t1);
  return track?.t?.length ? fitKnotOut(track, t0, t1) : null;
}
/** "Fit" for an insertion over [t0, t1]: push timing off the run's track (lib/fx fitInsertion). -> params | null. */
export function fitInsert(app, t0, t1) {
  const { track } = runUnder(app, t0, t1);
  return track?.t?.length ? fitInsertion(track, t0, t1) : null;
}
const tmemos = new WeakMap();   // paw-shgb: per app (a tab each): two tabs never evict each other's, a closed tab's runs go with it
/** The modifiers as they act (mods-tracked.js resolveTracked: a modifier whose reacting part has a tracked run over it
 *  takes its timing from it), for doc.fx as it is: {of: doc.fx, list, by: Map(id -> what drives it)}. Cached on the
 *  modifiers, the runs, the ghosts and the stroke's points (lib/finish.js finalScript reads it through finishEnv). */
export function trackedOf(app) {
  // paw-r9nh: a modifier drag's draft too (`of` stays doc.fx: lib/finish.js plays `list` while it is drawn), so the final
  // follows the drag; tracked spurts on the start of their frame
  const of = app.doc.fx || [], fx = listOf(app, 'fx'), runs = trackingOf(app)?.runs, ghosts = app.doc.ghosts, base = scriptOf(app, 'stroke');
  const tmemo = tmemos.get(app);
  if (tmemo && tmemo.fx === fx && tmemo.of === of && tmemo.runs === runs && tmemo.ghosts === ghosts && tmemo.base === base) return tmemo.res;
  const grid = gridOf(app.player), snap = (t) => frameStartOf(t, grid);
  const res = { of, ...resolveTracked(fx, (t0, t1) => runUnder(app, t0, t1).run, base, (m) => ownRuns(runs, m), snap) };
  tmemos.set(app, { fx, of, runs, ghosts, base, res });
  return res;
}
/** A knotting modifier's mode as applyFx resolves it (its own, else auto from the run's turns under it). */
export function knotModeOf(app, e) {
  return knotMode(fxParams(e), runUnder(app, e.t0, e.t1).g?.script ?? [], e.t0, e.t1);
}

const fxOf = (app) => app.doc.fx || [];
const selected = (app, args) => fxOf(app).find((e) => e.id === (args?.id ?? tl.fx)) ?? null;
const focusedSel = guard((app) => tl.focus === 'fx' && !!selected(app), () => (tl.focus !== 'fx' ? 'Click the Modifiers row first' : 'Select a modifier first'));
const minLen = (app) => Math.round(app.player.frameMs) || 100;
export const UNBAKED = 'Un-baked: the modifier is live again, on top of the points it was baked into (Flatten bakes again)';
export const commitFx = (app, label, next, opts) => {
  const was = new Map(fxOf(app).map((e) => [e.id, e]));
  app.transact(label, () => { app.doc.fx = next; }, opts);
  if (next.some((e) => !e.baked && was.get(e.id)?.baked)) app.toast(UNBAKED);   // an edit of a baked effect (fx-edit) un-bakes it
};
export const focusFxLane = () => document.querySelector('[data-tl-lane="fx"]')?.focus({ preventScroll: true });

/** Where a new modifier goes: args {t0, t1}, else the I/O range (a scene click sets it), else the scene at the playhead,
 *  else 10 s from the playhead. Modifiers stack: one already there stays under the new one. */
function spanFor(app, args) {
  if (args?.t1 > args?.t0) return { t0: args.t0, t1: args.t1 };
  const r = app.doc.range;
  if (r && r.t1 > r.t0) return { t0: r.t0, t1: r.t1 };
  const l = scenesOf(app), t = playheadFrameStart(app.player), s = l[sceneAtPlayhead(l, app.player)];
  if (s) return { t0: s.start_ms, t1: Math.min(s.end_ms, durOf(app)) };
  return { t0: t, t1: Math.min(durOf(app), t + 10000) };
}

/** The frame under the playhead (ms). */
const frameNow = (app) => Math.round(app.player.snap ? app.player.snap(app.player.timeMs) : app.player.timeMs);

/** A spurt (one cumshot) at the playhead's frame, while watching: each press is one more spurt. It joins the recipe of
 *  the spurt before it (fx-edit addSpurt / recipeSpurt: same link, same params; an unlinked one with its own params gets linked with it);
 *  unlinked = a plain spurt at the defaults (Alt+U). */
export function spurtAtPlayhead(app, t = frameNow(app), { unlinked = false } = {}) {
  if (fxOf(app).some((e) => e.kind === 'spurt' && e.t0 === t)) return app.toast('A spurt is already on this frame', 'quiet');
  const id = newId('fx'), r = addSpurt(fxOf(app), { id, t, dur: durOf(app), scenes: scenesOf(app), unlinked, newLink: () => newId('link') });
  commitFx(app, r.linked ? 'Add spurt (linked)' : 'Add spurt', r.list);
  tl.fx = id;
  app.usage?.note?.('timeline:fx.spurt');
  spurtOrgasmHint(app, t);   // outside every orgasm, a quiet offer to mark / grow one
}
/** A single throb (Shift+U): a throbbing range one beat long with its dip on the playhead's frame (lib/fx singleThrob). */
export function throbAtPlayhead(app, t = frameNow(app)) {
  const s = singleThrob(t), id = newId('fx');
  commitFx(app, 'Add a single throb', [...fxOf(app), { id, kind: 'throbbing', ...s }].sort((a, b) => a.t0 - b.t0));
  tl.fx = id; tl.fxSel = [];
  app.usage?.note?.('timeline:fx.throb');
}

/** balls.js ballsReason with the app's tracking store and the drawn scenes: is the balls suggestion on at t, else why. */
export const ballsWhy = (app, t = app.player.timeMs) => ballsReason(app, t, { runOf: (id) => trackingOf(app)?.run?.(id), scenes: scenesOf(app) });
/**
 * The balls -> spurts suggestion at t (a suggestion only: nothing is placed until placeSpurts). When ballsWhy is on: the
 * tracker run under the scene at t (the doc scene, else the run's own scene there) with a balls contraction channel
 * (runs-channel ballsScale: the pinned group's sem_balls_scale, v4.6, else a part named 'balls' with a _scale channel,
 * v3.3 / v3.4) -> {ch, seeded, t0, t1, times} (seeded = the channel is the pinned group's; times = runs-channel
 * scalePeaks of that channel over the scene, sign -1 = contraction peaks, +1 = swelling), else null.
 */
export function ballsSpurts(app, t, sign = -1) {
  const w = ballsWhy(app, t);
  if (!w.enabled) return null;
  const { run, t0, t1 } = w.at;
  return { ch: w.ch, seeded: w.ch.startsWith('sem_'), t0, t1, times: scalePeaks(run.channels[w.ch], t0, t1, { sign }) };
}
/** Palette / scene menu: spurts on the balls contraction peaks of the scene at args.t (else the playhead), placed at once
 *  (one undo step); off = the reason on the status line. */
export function spurtsFromBalls(app, args) {
  const t = args?.t ?? app.player.timeMs, w = ballsWhy(app, t);
  if (!w.enabled) return app.toast(`Spurts from balls: ${w.reason}`, 'info');
  const sug = ballsSpurts(app, t);
  if (!sug?.times.length) return app.toast(`Spurts from balls: no clear contraction peaks in this scene (${sug?.ch})`, 'info');
  placeSpurts(app, sug.times);
}
/** Spurts on the frames of `times` (one undo step; a frame that already has a spurt is skipped). -> placed count. */
export function placeSpurts(app, times) {
  const fr = Math.max(1, Math.round(app.player.frameMs) || 1), snap = (t) => Math.round(app.player.snap ? app.player.snap(t) : t);
  let list = fxOf(app), n = 0;
  for (const t of times.map(snap)) {
    if (list.some((e) => e.kind === 'spurt' && Math.abs(e.t0 - t) < fr)) continue;
    list = addFx(list, { id: newId('fx'), kind: 'spurt', t0: t, t1: t, dur: durOf(app) });
    n++;
  }
  if (!n) { app.toast('Spurts are already on those frames', 'quiet'); return 0; }
  commitFx(app, n === 1 ? 'Add spurt' : `Add ${n} spurts (balls contraction peaks)`, list);
  app.usage?.note?.('timeline:fx.ballsSpurts', n);
  return n;
}

/** "+ a modifier" of `kind` (every add goes here): a spurt on the playhead's frame; an event kind with no span given
 *  acts on the one of its kind under the playhead when there is one (selects it; Refine opens its curve); else a new
 *  one over args {t0, t1}, else the range, else the scene at the playhead (knotting 8 s or less: one knot). */
export function addModifier(app, kind, args) {
  if (FX_KINDS[kind]?.point) {   // a spurt goes on the playhead's frame (inside the span when one is given, else its start)
    const t = frameNow(app);
    return spurtAtPlayhead(app, args?.t1 > args?.t0 && (t < args.t0 || t > args.t1) ? Math.round(args.t0) : t);
  }
  const here = !(args?.t1 > args?.t0) && FX_KINDS[kind]?.event ? modAt(fxOf(app), app.player.timeMs, kind) : null;
  if (here) { tl.fx = here.id; tl.fxSel = []; if (app.mode === 'refine') tl.fxPop = here.id; return; }
  const span = spanFor(app, args), id = newId('fx');
  if (!(span.t1 - span.t0 >= minLen(app))) return app.toast('Too short for a modifier', 'quiet');
  let next = [...fxOf(app), makeMod(id, kind, Math.max(0, span.t0), Math.min(durOf(app), span.t1), args?.mode ? { mode: args.mode } : null, app.doc.axes?.stroke)].sort((a, b) => a.t0 - b.t0);
  if (kind === 'shape') {   // a Reshape starts from the motion's own profile (then it is adjustable)
    const e = next.find((x) => x.id === id), fit = fitShape(app, e.t0, e.t1);
    if (fit) next = next.map((x) => (x.id === id ? { ...x, params: fit } : x));
    else app.toast('Reshape: no tracked samples to fit, drag the handles or track the scene', 'quiet');
  }
  commitFx(app, `Add ${FX_KINDS[kind].label}`, next);
  tl.fx = id; tl.fxSel = [];
  app.usage?.note?.('timeline:fx.add', kind);
}

/** The multi-selection (Shift+click / a box on the Modifiers row), else the selected modifier. */
export const selIds = (app) => (tl.fxSel?.length ? tl.fxSel : tl.fx ? [tl.fx] : []).filter((id) => fxOf(app).some((e) => e.id === id));
const canLink = (app) => { const k = selIds(app).map((id) => fxOf(app).find((e) => e.id === id).kind); return k.some((x, i) => k.indexOf(x) !== i); };
/** What Unlink acts on: args.id's whole group, else the linked modifiers of the selection. */
const linkedSel = (app, args) => (args?.id ? linkMembers(fxOf(app), args.id).filter((e) => e.link).map((e) => e.id) : selIds(app).filter((id) => fxOf(app).find((e) => e.id === id)?.link));

/** Shift a group of modifiers (and their inner events: an orgasm's spurts) by one dt, clamped so none leaves 0..dur
 *  (others never move: layers). -> {list, dt}. */
export function shiftFx(list, ids, dt, dur = Infinity) {
  ids = withInner(list, ids);
  const g = list.filter((e) => ids.includes(e.id));
  if (!g.length) return { list, dt: 0 };
  const d = Math.max(-Math.min(...g.map((e) => e.t0)), Math.min(dur - Math.max(...g.map((e) => e.t1)), Math.round(dt)));
  return { list: d ? list.map((e) => (ids.includes(e.id) ? { ...e, t0: e.t0 + d, t1: e.t1 + d } : e)) : list, dt: d };
}
/** Scale the ranged modifiers `ids` about each one's own centre by f (at least minMs long; spurts stay). */
export function scaleFx(list, ids, f, minMs = 1) {
  return list.map((e) => {
    if (!ids.includes(e.id) || isPointFx(e)) return e;
    const c = (e.t0 + e.t1) / 2, h = Math.max(minMs / 2, ((e.t1 - e.t0) * Math.abs(f)) / 2);
    return { ...e, t0: Math.round(c - h), t1: Math.round(c + h) };
  }).sort((a, b) => a.t0 - b.t0);
}
const fxFocused = guard(() => tl.focus === 'fx', 'Click the Modifiers row first');
/** paw-m3b6: why a command on the focused row's selection is off. */
const selWhy = (app) => whyOf(app, fxFocused) || 'Select a modifier first';
const pickFx = (ids) => { tl.fxSel = ids; tl.fx = ids[0] ?? null; };
/** S on the selection: each ranged modifier scales about its centre (mouse or a typed factor), one undo step. */
function scaleSel(app) {
  const ids = selIds(app), base = fxOf(app), w = document.querySelector('[data-tl-lane="fx"]')?.clientWidth || 1000;
  let out = base;
  runXform({ kind: 'scale', axes: 'y', origin: tl.hover?.lane === 'fx' ? [tl.hover.x, tl.hover.y] : null,
    mouse: (o, p) => ({ f: Math.max(0.05, 1 + (p[0] - o[0]) / (w / 4)) }),
    preview: (a) => { out = scaleFx(base, ids, a.f, minLen(app)); setDraft('fx', out); return a; },
    cancel: () => clearDraft('fx'),
    confirm: () => { clearDraft('fx'); if (out !== base) commitFx(app, ids.length > 1 ? 'Scale modifiers' : 'Scale modifier', out); } });
}
/** G (dup: Shift+D, copies right after their originals first) on the selection: they follow the mouse in time. */
function grabSel(app, dup = false) {
  let ids = selIds(app);
  if (dup) {
    let l = fxOf(app);
    const copies = [];
    for (const id of ids) { const r = duplicateFx(l, id, { dur: durOf(app), minLen: minLen(app), newId: () => newId('fx') }); if (r) { l = r.list; copies.push(r.id); } }
    if (!copies.length) return app.toast('No room after them to duplicate', 'warn');
    commitFx(app, copies.length > 1 ? 'Duplicate modifiers' : 'Duplicate modifier', l);
    ids = copies; pickFx(copies);
  }
  tl.fxPop = null;
  // the video shows the first one's start as it moves (as a drag on the row does: player.dragTo, one seek at rest)
  const show = (r) => { const t = r.list.find((x) => x.id === ids[0])?.t0; if (Number.isFinite(t)) app.player.dragTo(Math.max(0, t), { snap: true }); return r; };
  let moved = false;   // G alone (before the mouse moves) leaves the playhead where it is
  grabRow(app, 'fx', 'fx', (base, dt) => { const r = shiftFx(base, ids, dt, durOf(app)); return (moved ||= !!dt) ? show(r) : r; }, (next) => { app.player.scrubEnd?.(); commitFx(app, ids.length > 1 ? 'Move modifiers' : 'Move modifier', next); });
}
/** Delete the modifiers `ids` and their inner events (an orgasm's spurts go with it). */
const deleteFx = (app, ids, label) => { commitFx(app, label, remove(fxOf(app), withInner(fxOf(app), ids))); if (ids.includes(tl.fx)) tl.fx = tl.fxPop = null; tl.fxSel = []; };
/** Can the selected modifier take kind k here (a Refine kind only in Refine)? */
const kindOk = (app, k) => FX_KINDS[k].event || app.mode === 'refine';

/** The selected modifiers a frame earlier (s -1) / later (1), onto the frame's start (no drift off the grid); rapid presses one undo step. */
function nudgeFxSel(app, s) {
  const ids = selIds(app), g = gridOf(app.player), t0 = Math.min(...fxOf(app).filter((e) => ids.includes(e.id)).map((e) => e.t0));
  const dt = clockOf(g) ? frameTime(frameAt(t0, g) + s, g) - t0 : s * 33;
  const r = shiftFx(fxOf(app), ids, dt, durOf(app));
  if (r.dt) commitFx(app, 'Nudge modifier', r.list, { coalesce: true });
}
// paw-5z78: the modifiers selected on the focused Modifiers row are an editor selection (ui/kit/editor-item.svelte.js): plain
// left / right nudge them a frame, Escape drops the selection
addEditorSelection({ active: (app) => fxFocused() && selIds(app).length > 0, nudge: (app, dx) => { if (dx) nudgeFxSel(app, dx); }, drop: () => { pickFx([]); tl.fxPop = null; } });

const G = { menu: 'Edit', group: 'Modifiers' };
const fxAll = { id: 'timeline.fx.selectAll', title: 'Select all modifiers', keys: ['Ctrl+A'], ...G, hidden: true, when: (app) => fxFocused() && fxOf(app).length > 0, run: (app) => pickFx(fxOf(app).map((e) => e.id)) };
const fxNone = { id: 'timeline.fx.selectNone', title: 'Select no modifier', keys: ['Alt+A'], ...G, hidden: true, when: fxFocused, run: () => { pickFx([]); tl.fxPop = null; } };
export default [
  { id: 'fx.spurtAtPlayhead', title: 'Spurt at the playhead (one cumshot on this frame)', keys: ['U'], ...G, run: (app) => spurtAtPlayhead(app) },
  { id: 'fx.spurtUnlinked', title: 'Spurt at the playhead, unlinked, default params', keys: ['Alt+U'], ...G, run: (app) => spurtAtPlayhead(app, undefined, { unlinked: true }) },
  { id: 'fx.throbAtPlayhead', title: 'Single throb at the playhead (one beat long)', keys: ['Shift+U'], ...G, run: (app) => throbAtPlayhead(app) },
  { id: 'fx.spurtsFromBalls', title: 'Spurts from the balls contraction peaks in this scene', ...G,
    when: (app) => ballsWhy(app).enabled, why: (app) => ballsWhy(app).reason, run: (app, args) => spurtsFromBalls(app, args) },
  { id: 'timeline.fx.delete', title: 'Delete the selected modifiers (an orgasm takes its spurts)', keys: ['Delete', 'Backspace', 'X'], ...G, when: guard((app) => fxFocused() && selIds(app).length > 0, selWhy),
    run: (app) => { const ids = selIds(app); deleteFx(app, ids, ids.length > 1 ? 'Delete modifiers' : 'Delete modifier'); } },
  // Blender keys while the Modifiers row has the keyboard (the axis editor's own A / Alt+A / Ctrl+I / G / S yield then);
  // paw-qbvj: A toggles all / none, Ctrl+A all, Alt+A none
  fxAll, fxNone,
  toggleCmd({ id: 'timeline.fx.selectToggle', title: 'Select all / no modifiers (toggle)', ...G, hidden: true, when: fxFocused,
    any: (app) => selIds(app).length > 0, all: fxAll, none: fxNone, empty: (app) => (fxOf(app).length ? '' : 'No modifiers to select') }),
  { id: 'timeline.fx.invertSelection', title: 'Invert the modifier selection', keys: ['Ctrl+I'], ...G, hidden: true, when: fxFocused,
    run: (app) => { const s = selIds(app); pickFx(fxOf(app).map((e) => e.id).filter((id) => !s.includes(id))); } },
  { id: 'timeline.fx.grab', title: 'Grab the selected modifiers (mouse, or type ms)', keys: ['G'], ...G, when: guard((app) => fxFocused() && selIds(app).length > 0, selWhy), run: (app) => grabSel(app) },
  // paw-r9nh: Ctrl+arrows nudge the selection a frame (as points do), rapid presses one undo step; through the key map, so
  // the focus guard's arrows reach it. paw-5z78: the selected modifiers are an editor selection too (below): plain arrows nudge
  // them as well while setting keys.arrowsNudgeSelection is on
  ...[['Left', -1], ['Right', 1]].map(([d, s]) => ({ id: `timeline.fx.nudge${d}`, title: `Nudge the selected modifiers 1 frame ${s < 0 ? 'earlier' : 'later'}`, keys: [`Ctrl+Arrow${d}`], ...G,
    when: guard((app) => fxFocused() && selIds(app).length > 0, selWhy), run: (app) => nudgeFxSel(app, s) })),
  { id: 'timeline.fx.scale', title: 'Scale the selected modifiers about their centers', keys: ['S'], ...G, when: guard((app) => fxFocused() && selIds(app).length > 0, selWhy), run: (app) => scaleSel(app) },
  { id: 'timeline.fx.duplicateGrab', title: 'Duplicate the selected modifiers and move the copies', keys: ['Shift+D'], ...G, when: guard((app) => fxFocused() && selIds(app).length > 0, selWhy), run: (app) => grabSel(app, true) },
  // context-menu twins (a menu click takes lane focus away, so these act on args.id or the selection)
  { id: 'timeline.fx.remove', title: 'Delete modifier', ...G, hidden: true, when: (app) => !!selected(app),
    run: (app, args) => { const e = selected(app, args); deleteFx(app, [e.id], `Delete ${FX_KINDS[e.kind]?.label ?? 'modifier'}`); } },
  { id: 'timeline.fx.mute', title: 'Mute / unmute the selected modifier', ...G, when: guard((app) => !!selected(app), 'Select a modifier first'),
    run: (app, args) => { const e = selected(app, args); commitFx(app, e.muted ? 'Unmute modifier' : 'Mute modifier', toggleMute(fxOf(app), e.id)); } },
  { id: 'timeline.fx.unbake', title: 'Un-bake modifier (live again: it was taken into the axis)', ...G, when: guard((app) => !!selected(app)?.baked, 'Select a baked modifier first'),
    run: (app, args) => { const e = selected(app, args); commitFx(app, 'Un-bake modifier', fxOf(app).map((x) => (x.id === e.id ? (({ baked: _, ...r }) => r)(x) : x))); } },
  { id: 'timeline.fx.link', title: 'Link the selected modifiers (one set of params)', ...G, when: guard((app) => canLink(app), 'Select two modifiers of the same kind first'),
    run: (app) => commitFx(app, 'Link modifiers', linkFx(fxOf(app), selIds(app), { primary: tl.fx, newLink: () => newId('link') })) },
  { id: 'timeline.fx.unlink', title: 'Unlink modifiers (each keeps its params)', ...G, when: guard((app) => fxOf(app).some((e) => e.link), 'Link two modifiers first'),
    run: (app, args) => { const ids = linkedSel(app, args); if (ids.length) commitFx(app, 'Unlink modifiers', unlinkFx(fxOf(app), ids)); } },
  { id: 'timeline.fx.duplicate', title: 'Duplicate the selected modifier', ...G, when: guard((app) => !!selected(app), 'Select a modifier first'),
    run: (app, args) => {
      const e = selected(app, args), r = duplicateFx(fxOf(app), e.id, { dur: durOf(app), minLen: minLen(app), newId: () => newId('fx') });
      if (!r) return app.toast('No room after the modifier to duplicate it', 'warn');
      commitFx(app, 'Duplicate modifier', r.list); tl.fx = r.id;
    } },
  ...FX_KIND_IDS.filter((k) => !isPointFx({ kind: k })).map((k) => ({ id: `timeline.fx.kind.${k}`, title: `Modifier kind: ${FX_KINDS[k].label}`, ...G, hidden: true,
    when: (app) => !!selected(app) && !isPointFx(selected(app)) && kindOk(app, k), why: () => REFINE_WHY,
    run: (app, args) => { const e = selected(app, args); if (e.kind !== k) commitFx(app, `Modifier kind: ${FX_KINDS[k].label}`, setFxKind(fxOf(app), e.id, k)); } })),
  { id: 'timeline.fx.edit', title: 'Edit the selected modifier\'s curve (Refine)', keys: ['Enter'], ...G, when: guard((app) => focusedSel(app) && !tl.fxPop && app.mode === 'refine', (app) => whyOf(app, focusedSel) || (tl.fxPop ? 'Close the curve editor first' : 'Only in the Refine tab')),
    run: () => { tl.fxPop = tl.fx; } },
  { id: 'timeline.fx.escape', title: 'Clear the modifier selection', keys: ['Escape'], ...G, hidden: true, when: focusedSel,
    run: () => { tl.fx = tl.fxPop = null; tl.fxSel = []; } },
];
