// commands.js -- the lane editor's keyboard commands (discovered by the shell; registered before core-commands.js,
// so a lanes command wins a shared key whenever its `when` is true). Every edit respects lanes(app).editable(axis).
// Also exports contextItems(app, axis): the right-click menu for a lane.
import * as E from '../../lib/edit/index.js';
import { nearest, removeAt, lowerBound } from '../../lib/core/script.js';
import { lanes, KNOWN_AXES } from './state.svelte.js';
import { acceptGhost, posAtInt, seekIndex } from './ops.js';
import { EMPTY, indices, connected } from './select.js';
import { moveLimits, applyMove } from './drag.js';
import { PAD, posToY, snapFrame } from './geom.js';
import { gridOf, frameLen } from '../../lib/lane.js';
import { run as runXform } from '../../lib/xform.js';
import { toggleCmd } from '../../lib/selmodal.js';
import { pointTime, nudgeBlock, timeSpan, fitSpan, frameStep, playheadMs, sameScript, clipToEnd, extrudeFrom } from './cmdlogic.js';
import { startRecording, stopRecording, recordKey } from './recorder.svelte.js';
import { acceptableGhost, ghostKind } from './render.js';
import { trackedGhostId, groupsOpen } from './deps.js';
import { cleaned } from '../tracking/accept.js';
import { cleanMicroOpts } from '../../app/settings.svelte.js';
import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live
import { guard, whyOf } from '../../app/commands.js';
import { MODES, MODE_LABEL, convertSelection, carryActive, activeIdx } from './elements.js';
import { PIVOTS, PIVOT_LABEL, pivotOf, pivots, scalePoints, rotatePoints } from './pivot.js';

const L = lanes;
const selOf = (app, axis = app.doc.activeAxis) => (app.doc.selection.axis === axis ? app.doc.selection.ats : EMPTY);
const hasSel = guard((app) => selOf(app).size > 0, 'Select points first');
/** The selection, else the I/O range, else null: what transforms work on. */
const target = (app) => (hasSel(app) ? { ats: selOf(app) } : app.doc.range ? { t0: app.doc.range.t0, t1: app.doc.range.t1 } : null);
const spanOfTarget = (t) => (!t ? null : t.ats ? timeSpan(t.ats) : { t0: t.t0, t1: t.t1 });
const axisArg = (app, args) => args?.axis || app.doc.activeAxis;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** A document is open (a video or a script): the Welcome screen has neither, and keys there must not create one. */
const hasDoc = guard((app) => !!app.doc.media || Object.keys(app.doc.axes).length > 0, 'Open a video or script first');
/** The video's end (ms): new points never go past it. 0 = no video (script-only editing has no hard end). */
const videoEnd = (app) => (app.doc.media ? app.durationMs : 0);

function editable(app, axis = app.doc.activeAxis) {
  const st = L(app);
  if (st.editable(axis)) return true;
  app.toast(st.flag('locked', axis) ? axis + ' is locked' : `Solo ${st.solo}: ${axis} is not editable`, 'quiet');
  return false;
}
/** Time for a new point: the playhead as shown (minus latency while playing), frame-snapped if snapping is on. */
const nowAt = (app) => pointTime(playheadMs(app.player), { playing: app.player.playing, latency: L(app).latency, frameMs: L(app).snap.frames ? gridOf(app.player) : 0 });

// Points placed from the keyboard are selected (Up/Down/Enter/Delete act on them) but Left/Right keep stepping
// frames: the manual loop is "step, key, step, key". Any other selection (click, box, paste, Ctrl+A) nudges.
// The flag lives on the selection value itself, so undo/redo (which restore stored selections) keep it; every
// other way of selecting (app.select) makes a selection without it.
// paw-5zpf: keep = the edit moved the selected points one to one (a move, scale, rotate, nudge): the active element follows them
function select(app, ats, axis, placed = false, keep = false) {
  const prev = app.doc.selection, active = keep && prev.axis === axis ? carryActive(prev, ats) : undefined;
  if (placed) app.doc.selection = { axis, ats: new Set(ats), placed: true };
  else if (active) app.doc.selection = { axis, ats: new Set(ats), active };
  else app.select(ats, axis);
}
const nudgeable = guard((app) => hasSel(app) && !app.doc.selection.placed, (app) => whyOf(app, hasSel) || 'Select points by click or box first');

/**
 * Apply an edit and the selection that goes with it as ONE undo entry (redo restores both). An edit that changes
 * nothing adds no entry; points it put past the video's end are dropped. ats = the selection after (null: leave
 * it). -> {ats (those that survived), dropped}.
 */
function commit(app, label, axis, next, ats, { placed = false, coalesce = false, keep = false } = {}) {
  const prev = scriptOf(app, axis), c = clipToEnd(next, prev, videoEnd(app)), sel0 = app.doc.selection;
  if (ats) ats = [...ats];
  if (ats && c.dropped) ats = ats.filter((t) => { const i = lowerBound(c.script, t); return i < c.script.length && c.script[i].at === t; });
  app.transact(label, () => {
    if (!sameScript(c.script, prev)) app.edit(label, axis, c.script);
    if (ats) { app.doc.selection = sel0; select(app, ats, axis, placed, keep); }   // the selection before the edit: app.edit trims it
  }, { coalesce });
  return { ats, dropped: c.dropped };
}

// ---- points ----
function setPoint(app, pos) {
  if (L(app).rec) return recordKey(app, pos);
  const axis = app.doc.activeAxis;
  if (!editable(app, axis)) return;
  const s = scriptOf(app, axis), r = E.setPointAt(s, null, { at: nowAt(app), pos, tolerance: app.player.frameMs / 2 });
  commit(app, r.script.length > s.length ? 'Add point' : 'Set point', axis, r.script, r.ats, { placed: true });
}

function seekPoint(app, dir) {
  // in frame space: the player lands on the frame start (1291.67), not on the point's integer ms (1292)
  const p = app.player, s = app.script, f = p.frameMs;
  const frameOf = typeof p.frameAt === 'function' ? (ms) => p.frameAt(ms) : (ms) => Math.round(ms / f);
  const i = seekIndex(s, playheadMs(p), dir, frameOf);
  if (i < 0) return;
  app.player.pause();
  app.player.seek(s[i].at);
}

/** Time nudge by one frame: frame-accurate from the first selected point when snapping, else round(frameMs). */
function nudgeFrame(app, dir) {
  const f = app.player.frameMs, first = timeSpan(selOf(app))?.t0;
  if (first == null) return;
  nudge(app, L(app).snap.frames ? frameStep(first, dir, f) - first : dir * Math.round(f), 0);
}

function nudge(app, dt, dp) {
  const axis = app.doc.activeAxis;
  if (!editable(app, axis)) return;
  const r = nudgeBlock(scriptOf(app, axis), selOf(app, axis), dt, dp, app.durationMs);
  if (!r.dt && !r.dp) { app.toast(dt ? 'Blocked by a neighbor' : 'At the limit', 'quiet'); return; }
  commit(app, dt ? 'Nudge time' : 'Nudge position', axis, r.script, r.dt ? r.ats : null, { coalesce: true, keep: true });
}

function repeatStroke(app) {
  const axis = app.doc.activeAxis;
  if (!editable(app, axis)) return;
  const r = E.repeatLastStroke(scriptOf(app, axis), null, { at: nowAt(app), shape: 'cycle', mode: 'replace' });
  if (!r.ats.length) { app.toast('Needs a full stroke (down-up-down) before the playhead', 'quiet'); return; }
  const end = videoEnd(app);
  if (end && r.ats[0] > end) { app.toast('No room before the end of the video', 'quiet'); return; }
  const c = commit(app, 'Repeat stroke', axis, r.script, r.ats, { placed: true });
  if (c.dropped) app.toast('Stroke cut at the end of the video', 'quiet');
  if (!app.player.playing && c.ats.length) app.player.seek(c.ats[c.ats.length - 1]);   // Q again tiles on; while playing the video keeps its time
}

function addPoint(app) {
  const axis = app.doc.activeAxis;
  if (!editable(app, axis)) return;
  const s = scriptOf(app, axis), at = nowAt(app), r = E.setPointAt(s, null, { at, pos: posAtInt(s, at), tolerance: app.player.frameMs / 2 });
  commit(app, 'Add point', axis, r.script, r.ats, { placed: true });
}

const pointUnderPlayhead = (app) => nearest(app.script, nowAt(app), app.player.frameMs / 2);
function del(app) {
  const axis = app.doc.activeAxis;
  if (!editable(app, axis)) return;
  const s = scriptOf(app, axis);
  if (hasSel(app)) { const n = selOf(app).size; app.edit('Delete points', axis, E.deletePoints(s, { ats: selOf(app) }).script, { empty: true }); app.toast('Deleted ' + plural(n, 'point'), 'quiet'); return; }
  const i = pointUnderPlayhead(app);
  if (i >= 0) app.edit('Delete point', axis, removeAt(s, [s[i].at]), { empty: true });
}

// ---- clipboard ----
function copy(app) {
  const t = target(app);
  if (!t) return null;
  const snip = E.copy(app.script, t);
  if (!snip.actions.length) { app.toast('Nothing to copy', 'quiet'); return null; }
  L(app).clip = snip;
  return snip;
}
function paste(app, mode) {
  const axis = app.doc.activeAxis, clip = L(app).clip;
  if (!clip?.actions.length || !editable(app, axis)) return;
  const r = E.paste(scriptOf(app, axis), clip, nowAt(app), { mode });
  const c = commit(app, mode === 'replace' ? 'Paste' : mode === 'merge' ? 'Paste (merge)' : 'Paste (insert)', axis, r.script, r.ats);
  app.toast('Pasted ' + plural(c.ats.length, 'point') + (c.dropped ? `; ${plural(c.dropped, 'point')} past the end of the video dropped` : ''), c.dropped ? 'warn' : 'quiet');
}

// ---- transforms on the selection / range ----
/** Run a lib/edit op on the target; the selection follows the op's ats when the target was a selection. */
function transform(app, label, fn, coalesce = false) {
  const axis = app.doc.activeAxis, t = target(app);
  if (!t) { app.toast('Select points first', 'quiet'); return; }
  if (!editable(app, axis)) return;
  const r = fn(scriptOf(app, axis), t);
  const c = commit(app, label, axis, r.script, t.ats ? r.ats : null, { coalesce, keep: true });
  if (c.dropped) app.toast(`${plural(c.dropped, 'point')} past the end of the video dropped`, 'warn');
}

// ---- Blender-style modal transforms (lib/xform.js): G grab, S scale, Shift+D duplicate + grab ----
/** The Blender keys (A, Alt+A, G, S, X, Shift+D; B / C: timeline/commands-select.js) belong to the axis editor unless another editor holds keyboard focus
 *  (a timeline row or the graph canvas: role=application), whose own lane-scoped bindings then take them. */
const axisKeys = guard((app) => hasDoc(app) && !globalThis.document?.activeElement?.closest?.('[role=application]'), (app) => whyOf(app, hasDoc) || 'Click a lane first');
const canXform = guard((app) => axisKeys(app) && hasSel(app) && !L(app).xform && !L(app).rec,
  (app) => whyOf(app, axisKeys, hasSel) || (L(app)?.rec && !L(app)?.xform ? 'Stop recording first' : 'Finish the current transform first'));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const selNone = { id: 'lanes.selectNone', title: 'Select none', keys: ['Alt+A'], menu: 'Edit', group: 'select', when: axisKeys, run: (app) => app.select([]) };
const selAll = { id: 'lanes.selectAll', title: 'Select all points on the lane', menu: 'Edit', group: 'select', when: axisKeys, run: (app) => app.select(app.script.map((a) => a.at)) };

function xform(app, kind, { dup = false } = {}) {
  const st = L(app), axis = app.doc.activeAxis;
  if (st.xform || !editable(app, axis)) return;
  const s0 = scriptOf(app, axis), idx = indices(s0, selOf(app, axis));
  if (!idx.length) return;
  const el = st.els[axis], rect = () => el?.getBoundingClientRect() || { left: 0, top: 0, width: 1000, height: 200 };
  const mode = dup ? 'dup' : 'clamp', lim = moveLimits(s0, idx, mode, 1, app.durationMs), a0 = s0[idx[0]].at, fms = gridOf(app.player);
  // paw-5zpf: S and R work about the pivot (setting lanes.pivot, pivot.js); on screen the mouse distance / angle is taken about
  // the whole selection's pivot (Individual origins: its middle)
  const pk = pivotOf(app.settings.get('lanes.pivot', 'middle')), pname = PIVOT_LABEL[pk];
  const groups = kind === 'grab' ? [] : pivots(s0, idx, pk, { playhead: playheadMs(app.player), active: activeIdx(s0, app.doc.selection) });
  const g0 = kind === 'grab' ? null : pk === 'individual' ? pivots(s0, idx, 'middle')[0] : groups[0];
  const pivot = () => { const r = rect(), v = app.view; return [r.left + ((g0.t - v.start) / v.span) * r.width, r.top + posToY(r.height, g0.pos)]; };
  let out = { script: s0, idx };
  const preview = (a) => {
    if (kind === 'scale') {
      const r = scalePoints(s0, groups, { fx: a.fx, fy: a.fy, dur: videoEnd(app) || Infinity });
      out = { script: r.script, idx: r.idx };
      st.xform = { axis, ...out, clamped: r.clamped };
      return { ...a, fx: r.fx, pivot: pname, clamped: r.clamped.length };
    } else if (kind === 'rotate') {
      const r = rotatePoints(s0, groups, a);
      out = { script: r.script, idx: r.idx };
      st.xform = { axis, ...out, clamped: r.clamped };
      return { d: r.d, pivot: pname, clamped: r.clamped.length };
    } else {
      const dt = clamp(Math.round(a.dt), lim.dtMin, lim.dtMax), dp = clamp(Math.round(a.dp), lim.dpMin, lim.dpMax);
      let script = applyMove(s0, idx, dt, dp, mode);
      if (dup) {   // the copies replace what lies under them (like a paste), but never the originals (Blender keeps them)
        const have = new Set(script.map((x) => x.at)), lost = idx.map((i) => s0[i]).filter((x) => !have.has(x.at));
        if (lost.length) script = [...script, ...lost].sort((x, y) => x.at - y.at);
      }
      out = { script, idx: dup ? idx.map((i) => lowerBound(script, s0[i].at + dt)) : idx };
      a = { dt, dp };
    }
    st.xform = { axis, ...out };
    return a;
  };
  const mouse = (o, p, e) => {
    if (kind === 'scale') { const c = pivot(), d0 = Math.hypot(o[0] - c[0], o[1] - c[1]); return { f: d0 < 2 ? 1 : Math.hypot(p[0] - c[0], p[1] - c[1]) / d0 }; }
    if (kind === 'rotate') {   // the angle swept about the pivot -> a slope (pos per ms) at this zoom
      const c = pivot(), r = rect(), ang = (q) => Math.atan2(c[1] - q[1], q[0] - c[0]);
      let th = ang(p) - ang(o);
      th = clamp(Math.atan2(Math.sin(th), Math.cos(th)), -1.45, 1.45);
      return { slope: (Math.tan(th) * (r.width / app.view.span)) / (Math.max(1, r.height - 2 * PAD) / 100) };
    }
    const r = rect();
    let dt = ((p[0] - o[0]) / r.width) * app.view.span;
    if (st.snap.frames && !e.shiftKey) dt = snapFrame(a0 + dt, fms) - a0;   // Shift: off the frame grid, like a drag
    return { dt, dp: -((p[1] - o[1]) / Math.max(1, r.height - 2 * PAD)) * 100 };
  };
  const h = st.hover?.axis === axis ? st.hover : null, r = h && rect();
  // S: time and level, X / Y lock one; its first 8 px of mouse travel pick the lock (a script's timing is not scaled by a slip)
  runXform({ kind, axes: kind === 'rotate' ? '' : 'xy', autoLock: kind === 'scale', origin: h ? [r.left + h.x, r.top + h.y] : null, follow: kind === 'grab' && el ? { app, el } : null, mouse, preview,
    cancel: () => { st.xform = null; },
    confirm: () => {
      st.xform = null;
      const n = out.idx.length, label = kind === 'scale' ? 'Scale points' : kind === 'rotate' ? 'Rotate points' : dup ? `Duplicate ${plural(n, 'point')}` : `Move ${plural(n, 'point')}`;
      if (scriptOf(app, axis) === s0) commit(app, label, axis, out.script, out.idx.map((i) => out.script[i].at), { keep: true });
    } });
  if (dup) app.toast('Duplicate: move it, click or Enter places it, Esc drops it', 'quiet');
}

// ---- selection modes (paw-5zpf, elements.js) ----
const MODE_TIP = {
  point: 'A click takes a point',
  segment: 'A click takes the line between two points',
  stroke: 'A click takes a run in one direction',
  cycle: 'A click takes a cycle: low, high, low',
};
/** Switch the mode; the selection converts (up: only complete elements stay; down: all their points). */
function setSelMode(app, m) {
  const st = L(app), from = st.selMode;
  if (from === m) return;
  app.settings.set('lanes.selectMode', m);
  const sel = app.doc.selection, s = scriptOf(app, sel.axis);
  if (sel.ats.size) { const next = convertSelection(s, sel.ats, from, m); if (next !== sel.ats) app.select(next, sel.axis); }
  app.toast(`Select mode: ${MODE_LABEL[m]}`, 'quiet');
}

// ---- the pivot (paw-5zpf stage 2, pivot.js) ----
const PIVOT_TIP = {
  start: 'About the first selected point',
  middle: 'About the middle of the selection',
  end: 'About the last selected point',
  playhead: 'About the playhead (the line\'s level there)',
  active: 'About the active element (the last clicked)',
  individual: 'Each selected part about its own middle',
};
/** The pivot choices as a menu at the pointer (Blender's . pie), over the lane under it, else the focused lane's middle. */
function pivotMenu(app) {
  const st = L(app), h = st.hover, el = h && st.els[h.axis], r = el?.getBoundingClientRect();
  const p = r ? { x: r.left + h.x, y: r.top + h.y } : st.screenPoint(app.doc.activeAxis, app.view.start + app.view.span / 2, 50) || { x: innerWidth / 2, y: innerHeight / 2 };
  const cur = pivotOf(app.settings.get('lanes.pivot', 'middle'));
  st.menu = { x: p.x, y: p.y, items: [{ section: 'Pivot (S, R)' }, ...PIVOTS.map((q) => ({ label: PIVOT_LABEL[q], cmd: 'lanes.pivot.' + q, type: 'radio', checked: q === cur, tip: PIVOT_TIP[q] }))] };
}

// ---- E extrude (paw-5zpf stage 3) ----
/** The point E pulls a new one out of: the active element's last point, else the last selected, else the one at / just before the playhead. */
function extrudeSource(app) {
  const s = scriptOf(app), sel = app.doc.selection, a = sel.axis === app.doc.activeAxis ? activeIdx(s, sel) : null;
  if (a) return s[a[1]];
  const idx = indices(s, selOf(app));
  if (idx.length) return s[idx[idx.length - 1]];
  const i = lowerBound(s, nowAt(app) + 1) - 1;
  return i >= 0 ? s[i] : null;
}
const canExtrude = guard((app) => axisKeys(app) && !L(app).xform && !L(app).rec && !!extrudeSource(app),
  (app) => whyOf(app, axisKeys) || (L(app)?.xform ? 'Finish the current transform first' : L(app)?.rec ? 'Stop recording first' : 'No point to extrude from: place one first (NumPad, Insert or a double-click)'));
/** E: a new point comes out of the source point and follows the pointer as a grab (X / Y, typed values, frame snapping); a click or
 *  Enter keeps it (selected and active, so E again chains), Esc or a right click removes it. One undo step. */
function extrude(app) {
  const st = L(app), axis = app.doc.activeAxis, p = extrudeSource(app);
  if (!p || st.xform || !editable(app, axis)) return;
  const s0 = scriptOf(app, axis), el = st.els[axis], fms = gridOf(app.player), minDt = Math.max(1, Math.round(frameLen(fms) || app.player.frameMs || 1));
  const rect = () => el?.getBoundingClientRect() || { left: 0, top: 0, width: 1000, height: 200 };
  const dur = videoEnd(app) || Infinity;
  let out = null;
  const preview = (a) => {
    const r = extrudeFrom(s0, p, a.dt, a.dp, { dur, minDt });
    out = r.at == null ? null : r;
    st.xform = out ? { axis, script: out.script, idx: [lowerBound(out.script, out.at)] } : null;
    return out ? { dt: out.at - p.at, dp: out.script[lowerBound(out.script, out.at)].pos - p.pos } : a;
  };
  const mouse = (o, q, e) => {
    const r = rect();
    let dt = ((q[0] - o[0]) / r.width) * app.view.span;
    if (st.snap.frames && !e.shiftKey) dt = snapFrame(p.at + dt, fms) - p.at;
    return { dt, dp: -((q[1] - o[1]) / Math.max(1, r.height - 2 * PAD)) * 100 };
  };
  const h = st.hover?.axis === axis ? st.hover : null, r = h && rect();
  runXform({ kind: 'grab', axes: 'xy', origin: h ? [r.left + h.x, r.top + h.y] : null, follow: el ? { app, el } : null, mouse, preview,
    cancel: () => { st.xform = null; },
    confirm: () => {
      st.xform = null;
      if (!out || scriptOf(app, axis) !== s0) return;
      app.transact('Extrude point', () => { app.edit('Extrude point', axis, out.script); app.doc.selection = { axis, ats: new Set([out.at]), active: [out.at] }; });
    } });
  app.toast('Extrude: move it, click or Enter keeps it, Esc drops it', 'quiet');
}

// ---- lanes ----
function cycleLane(app, dir) {
  const ids = L(app).ids(), i = ids.indexOf(app.doc.activeAxis);
  focusLane(app, ids[(i + dir + ids.length) % ids.length]);
}
function focusLane(app, axis) {
  if (!axis) return;
  app.setActiveAxis(axis);
  app.toast('Editing ' + axis, 'quiet');
}
function toggleSetting(app, key, def, name) {
  const v = L(app).toggle(key, def);
  app.toast(`${name} ${v ? 'on' : 'off'}`, 'quiet');
}
function toggleLaneFlag(app, args, flag, name, invert = false) {
  const axis = axisArg(app, args);
  L(app).toggleFlag(flag, axis);
  const on = L(app).flag(flag, axis) !== invert;
  app.toast(`${axis}: ${name} ${on ? 'on' : 'off'}`, 'quiet');
}

async function removeAxis(app, args) {
  const axis = axisArg(app, args), axes = app.doc.axes;
  if (!(axis in axes)) return;
  if (Object.keys(axes).length < 2) { app.toast('Cannot remove the last axis', 'quiet'); return; }
  const n = axes[axis].length;
  if (n && !(await app.confirm({ title: `Remove the ${axis} axis?`, message: `Its ${plural(n, 'point')} go with it (Undo brings them back).`, ok: 'Remove', danger: true }))) return;
  if (!(axis in app.doc.axes)) return;
  app.transact('Remove axis', () => { const a = { ...app.doc.axes }; delete a[axis]; app.doc.axes = a; });
  if (L(app).solo === axis) L(app).solo = null;
  if (app.doc.activeAxis === axis) app.setActiveAxis(L(app).ids()[0]);
}

// ---- ghosts ----
/** Ghosts on this lane whose points may be copied in (paw-x7w7: a hand tool, the copy bakes what it covers): tracker runs
 *  and the reference, never previews or the machine preview. */
const acceptable = (app, axis) => L(app).ghostsFor(axis).filter((g) => acceptableGhost(g));   // the final is a preview (Flatten writes it)
/** Which ghost Ctrl+Enter takes: the one last interacted with, else the tracking feature's selected run, else the
 *  newest tracker run, else the reference. */
function pickGhost(app, axis) {
  const gs = acceptable(app, axis);
  const by = (id) => id && gs.find((g) => g.id === id);
  return by(L(app).lastGhost) || by(trackedGhostId(app)) || [...gs].reverse().find((g) => ghostKind(g) === 'run') || gs[0] || null;
}
function takeGhost(app, args, mode) {
  const axis = app.doc.activeAxis;
  const g = args?.ghostId ? acceptable(app, axis).find((x) => x.id === args.ghostId) : pickGhost(app, axis);
  if (!g?.script?.length) { app.toast(args?.ghostId ? 'That ghost cannot be copied (a preview)' : 'No tracker run or reference to copy', 'quiet'); return; }
  L(app).lastGhost = g.id;
  if (!editable(app, axis)) return;
  const span = spanOfTarget(target(app));
  let r = acceptGhost(scriptOf(app, axis), span, { ghost: g.script, mode });
  if (!r.ats.length) { app.toast('The ghost has no points there', 'quiet'); return; }
  const label = `Copy ${g.name || g.id} in${mode === 'merge' ? ' (merge)' : ''}`;
  // the run's own points go into the base (effects and Autorange stay live on top: lib/finish.js); the joins clean
  // themselves (settings edit.cleanMicro): the span's edges (merge: all of it)
  const clean = cleanMicroOpts(app.settings);
  if (clean) {
    const a = r.ats[0], b = r.ats[r.ats.length - 1], lo = span?.t0 ?? a, hi = span?.t1 ?? b;
    r = cleaned(r.script, r.ats, mode === 'merge' ? [[a, b]] : [lo, hi], { ...clean, keep: null });
  }
  app.transact(label, () => commit(app, label, axis, r.script, r.ats));
  app.toast(`Took ${plural(r.ats.length, 'point')} from ${g.name || 'ghost'}`, 'quiet');
}

// ---- context menu ----
function openMenu(app) {
  const st = L(app), axis = app.doc.activeAxis, s = app.script, sel = selOf(app);
  let p = null;
  if (sel.size) { const first = timeSpan(sel).t0, a = s.find((x) => x.at === first); if (a) p = st.screenPoint(axis, a.at, a.pos); }
  if (!p) p = st.screenPoint(axis, app.view.start + app.view.span / 2, 50);
  const x = p?.x ?? (typeof innerWidth === 'number' ? innerWidth / 2 : 0), y = p?.y ?? (typeof innerHeight === 'number' ? innerHeight / 2 : 0);
  st.menu = { x, y, items: contextItems(app, axis) };
}

const menuItem = (app, cmd, label, extra = {}) => ({ label, cmd, keys: app.commands.keysFor(cmd)[0], disabled: !app.commands.enabled(cmd), ...extra });
/** A submenu row: disabled when none of its items can run. */
const submenu = (label, items) => ({ label, items, disabled: items.every((x) => x.sep || x.disabled) });

/** One lane's own items (flags, order, removal): the header's menu, and the canvas menu's "Lane" submenu. */
export function laneItems(app, axis = app.doc.activeAxis) {
  const st = L(app), ids = st.ids(), i = ids.indexOf(axis);
  const it = (cmd, label, extra) => menuItem(app, cmd, label, { args: { axis }, ...extra });
  return [
    it('lanes.toggleLock', 'Locked', { checked: st.flag('locked', axis) }),
    it('lanes.toggleVisible', 'Visible', { checked: !st.flag('hidden', axis) }),
    it('lanes.toggleCollapse', 'Collapsed', { checked: st.flag('collapsed', axis) }),
    it('lanes.toggleSolo', 'Solo', { checked: st.solo === axis }),
    it('lanes.toggleLaneGhosts', 'Ghosts on this lane', { checked: !st.flag('ghostsOff', axis) }),
    { sep: true },
    it('lanes.moveLaneUp', 'Move lane up', { disabled: i <= 0 }),
    it('lanes.moveLaneDown', 'Move lane down', { disabled: i < 0 || i >= ids.length - 1 }),
    { sep: true },
    it('lanes.removeAxis', `Remove ${axis} axis`, { disabled: Object.keys(app.doc.axes).length < 2 || !(axis in app.doc.axes) }),
  ];
}

/** Right-click menu items for a lane (edit commands act on the focused lane: focus it before opening). */
export function contextItems(app, axis = app.doc.activeAxis) {
  const has = !!target(app);
  const it = (cmd, label, extra) => menuItem(app, cmd, label, extra);
  const tf = (cmd, label) => it(cmd, label, { disabled: !has || !app.commands.enabled(cmd) });
  const ghosts = acceptable(app, axis).map((g) => it('lanes.acceptGhost', 'Copy ' + (g.name || g.id) + ' in', { args: { ghostId: g.id }, keys: undefined }));
  return [
    it('lanes.copy', 'Copy'), it('lanes.cut', 'Cut'), it('lanes.paste', 'Paste'),
    submenu('Paste special', [it('lanes.pasteMerge', 'Paste (merge)'), it('lanes.pasteInsert', 'Paste (insert, ripple)')]),
    it('lanes.duplicate', 'Duplicate'), it('lanes.delete', 'Delete'),
    { sep: true },
    submenu('Transform', [tf('lanes.invert', 'Invert'), tf('lanes.simplify', 'Simplify'), { sep: true }, tf('lanes.scaleUp', 'Scale up'), tf('lanes.scaleDown', 'Scale down'),
      tf('lanes.stretch', 'Stretch'), tf('lanes.compress', 'Compress'), { sep: true }, it('lanes.grab', 'Grab'), it('lanes.scale', 'Scale'), it('lanes.rotate', 'Rotate'), it('lanes.extrude', 'Extrude')]),
    submenu('Pivot', PIVOTS.map((p) => it('lanes.pivot.' + p, PIVOT_LABEL[p], { type: 'radio', checked: pivotOf(app.settings.get('lanes.pivot', 'middle')) === p }))),
    tf('lanes.zoomSelection', 'Zoom to selection'),
    ...(ghosts.length ? [{ sep: true }, ...(ghosts.length > 2 ? [submenu('Copy a ghost in', ghosts)] : ghosts)] : []),
    { sep: true },
    it('lanes.selectAll', 'Select all'), it('lanes.invertSelection', 'Invert selection'), it('lanes.selectConnected', 'Select connected'),
    { sep: true },
    submenu('Lane', laneItems(app, axis)),
  ];
}

/** Swap a lane with its neighbour in the stack order. */
function moveLane(app, args, dir) {
  const st = L(app), axis = axisArg(app, args), ids = st.ids(), i = ids.indexOf(axis), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  // moving the lane's DOM blurs its canvas: give the focus back once the stack has re-rendered
  const el = st.els[axis], had = typeof document !== 'undefined' && !!el && document.activeElement === el;
  st.setLayout({ order: ids });
  if (had) requestAnimationFrame(() => el.focus({ preventScroll: true }));
}

// ---- the commands ----
const point = (id, title, keys, pos, hidden) => ({ id, title, keys, menu: 'Edit', group: 'points', hidden, when: hasDoc, run: (app) => setPoint(app, pos) });
const recording = guard((app) => !!L(app).rec, 'Start a recording first');
const canPaste = guard((app) => hasDoc(app) && !!L(app).clip?.actions.length, (app) => whyOf(app, hasDoc) || 'Nothing to paste: copy first');
const noTarget = (app) => whyOf(app, hasDoc) || 'Select points or set a range first';
const oneLane = (app) => whyOf(app, hasDoc) || 'Add another axis first';
const noGhost = (app) => whyOf(app, hasDoc) || 'Run the tracker or load a reference first';
const tapping = (app) => L(app).rec?.mode === 'tap';

export default [
  // recording first: in tap mode Up/Down are taps, not nudges
  { id: 'lanes.recTop', title: 'Tap 100 (tap recording)', keys: ['ArrowUp'], hidden: true, when: tapping, run: (app) => recordKey(app, 100) },
  { id: 'lanes.recBottom', title: 'Tap 0 (tap recording)', keys: ['ArrowDown'], hidden: true, when: tapping, run: (app) => recordKey(app, 0) },
  // paw-5zpf: R rotates in the Blender keymap; recording is V there (OFS: R)
  { id: 'lanes.record', title: 'Record live (mouse / number keys)', keys: ['V'], presetKeys: { ofs: ['R'] }, keyWhen: (app) => !groupsOpen(app), menu: 'Edit', group: 'record', when: guard((app) => recording(app) || hasDoc(app), 'Open a video or script first'), run: (app) => (recording(app) ? stopRecording(app) : startRecording(app, 'live')) },
  { id: 'lanes.recordTap', title: 'Record by tapping extremes', keys: ['Alt+Shift+R'], menu: 'Edit', group: 'record', when: guard((app) => recording(app) || hasDoc(app), 'Open a video or script first'), run: (app) => (recording(app) ? stopRecording(app) : startRecording(app, 'tap')) },
  { id: 'lanes.recordCancel', title: 'Discard recording', keys: ['Escape'], menu: 'Edit', group: 'record', when: recording, run: (app) => stopRecording(app, { commit: false }) },

  // points. paw-5zpf: the number row places them in the OFS keymap; in the Blender one it picks the selection mode (below) and the
  // NumPad digits place them (Num5 is the NumPad's own key: a keyboard without one places points with E, Insert or the pointer)
  ...Array.from({ length: 10 }, (_, k) => ({ ...point('lanes.point' + k, `Point ${k * 10} at playhead`, ['Num' + k], k * 10, ![0, 5, 9].includes(k)), presetKeys: { ofs: [String(k), 'Num' + k] } })),
  { ...point('lanes.point100', 'Point 100 at playhead', [], 100, false), presetKeys: { ofs: ['Shift+0'] } },
  ...Array.from({ length: 9 }, (_, i) => ({ ...point('lanes.pointHalf' + (i + 1), `Point ${(i + 1) * 10 + 5} at playhead`, [], (i + 1) * 10 + 5, true), presetKeys: { ofs: ['Shift+' + (i + 1)] } })),
  // paw-5zpf: the selection modes (elements.js), Blender's 1 / 2 / 3 vertex / edge / face; a mode change converts the selection
  ...MODES.map((m, i) => ({ id: 'lanes.mode.' + m, title: `Select mode: ${MODE_LABEL[m]}`, tip: MODE_TIP[m], keys: [String(i + 1)], presetKeys: { ofs: [] }, menu: 'Edit', group: 'selmode',
    when: hasDoc, keyWhen: (app) => axisKeys(app) && !groupsOpen(app), checked: (app) => L(app).selMode === m, run: (app) => setSelMode(app, m) })),
  { id: 'lanes.addPoint', title: 'Add point on the line at playhead', keys: ['Insert'], menu: 'Edit', group: 'points', when: hasDoc, run: addPoint },
  { id: 'lanes.repeatStroke', title: 'Repeat last stroke at playhead', keys: ['Q'], menu: 'Edit', group: 'points', when: hasDoc, run: repeatStroke },
  { id: 'lanes.delete', title: 'Delete selected (or the point at the playhead)', keys: ['Delete', 'Backspace'], menu: 'Edit', group: 'points', when: guard((app) => hasSel(app) || pointUnderPlayhead(app) >= 0, (app) => whyOf(app, hasDoc) || 'Select points or put the playhead on one'), run: del },
  { id: 'lanes.editPoint', title: 'Edit point values', keys: ['Enter'], menu: 'Edit', group: 'points', when: guard((app) => selOf(app).size === 1, 'Select one point first'),
    run: (app) => { L(app).popover = { axis: app.doc.activeAxis, at: [...selOf(app)][0] }; } },

  // navigation (no selection change, so Left/Right keep stepping frames)
  // paw-5zpf: . is the pivot in the Blender keymap: point to point is W / Shift+W there (the left hand); OFS keeps , / .
  { id: 'lanes.prevPoint', title: 'Previous point', keys: ['Shift+W'], presetKeys: { ofs: [','] }, menu: 'Play', group: 'points', keyWhen: (app) => !groupsOpen(app), run: (app) => seekPoint(app, -1) },
  { id: 'lanes.nextPoint', title: 'Next point', keys: ['W'], presetKeys: { ofs: ['.'] }, menu: 'Play', group: 'points', keyWhen: (app) => !groupsOpen(app), run: (app) => seekPoint(app, 1) },

  // nudges
  { id: 'lanes.nudgeLeft', title: 'Nudge selected 1 frame earlier', keys: ['ArrowLeft', 'Ctrl+ArrowLeft'], menu: 'Edit', group: 'nudge', when: nudgeable, run: (app) => nudgeFrame(app, -1) },
  { id: 'lanes.nudgeRight', title: 'Nudge selected 1 frame later', keys: ['ArrowRight', 'Ctrl+ArrowRight'], menu: 'Edit', group: 'nudge', when: nudgeable, run: (app) => nudgeFrame(app, 1) },
  { id: 'lanes.nudgeUp', title: 'Nudge selected up', keys: ['ArrowUp'], menu: 'Edit', group: 'nudge', when: hasSel, run: (app) => nudge(app, 0, +app.settings.get('edit.posStep', 5) || 5) },
  { id: 'lanes.nudgeDown', title: 'Nudge selected down', keys: ['ArrowDown'], menu: 'Edit', group: 'nudge', when: hasSel, run: (app) => nudge(app, 0, -(+app.settings.get('edit.posStep', 5) || 5)) },
  { id: 'lanes.nudgeUpFine', title: 'Nudge selected up 1', keys: ['Shift+ArrowUp'], menu: 'Edit', group: 'nudge', when: hasSel, run: (app) => nudge(app, 0, 1) },
  { id: 'lanes.nudgeDownFine', title: 'Nudge selected down 1', keys: ['Shift+ArrowDown'], menu: 'Edit', group: 'nudge', when: hasSel, run: (app) => nudge(app, 0, -1) },

  // selection / clipboard
  { id: 'lanes.invertSelection', title: 'Invert selection', keys: ['Ctrl+I'], menu: 'Edit', group: 'select', when: axisKeys, run: (app) => app.select(E.invertSelection(app.script, { ats: selOf(app) }).ats) },
  selNone, selAll,   // paw-qbvj: A toggles (Blender 2.7x), Alt+A none, Ctrl+A all (edit.selectAll)
  toggleCmd({ id: 'lanes.selectToggle', title: 'Select all / none (toggle)', menu: 'Edit', group: 'select', when: axisKeys, keyWhen: (app) => !groupsOpen(app),
    any: hasSel, all: selAll, none: selNone, empty: (app) => (app.script.length ? '' : 'No points on this lane to select') }),
  { id: 'lanes.selectConnected', title: 'Select connected strokes', menu: 'Edit', group: 'select', when: hasSel,
    run: (app) => app.select(connected(app.script, selOf(app))) },

  // Blender modal transforms (lib/xform.js): one undo step each; Esc / right click puts everything back
  { id: 'lanes.grab', title: 'Grab (X / Y constrain, or type a value)', keys: ['G'], menu: 'Edit', group: 'xform', when: canXform, run: (app) => xform(app, 'grab') },
  // paw-5zpf: S scales time and level about the pivot (X time, Y level; the first mouse travel picks one); R tilts the levels
  { id: 'lanes.scale', title: 'Scale time and level about the pivot', tip: 'X time, Y level; the first move or a middle drag picks',
    keys: ['S'], menu: 'Edit', group: 'xform', when: canXform, run: (app) => xform(app, 'scale') },
  { id: 'lanes.rotate', title: 'Rotate: tilt the levels about the pivot', tip: 'Time stays, levels tilt; type the far end\'s change',
    keys: ['R'], presetKeys: { ofs: [] }, menu: 'Edit', group: 'xform', when: canXform, run: (app) => xform(app, 'rotate') },
  // the pivot (Blender's . pie): a menu at the pointer; each choice a command
  { id: 'lanes.pivotMenu', title: 'Pivot…', tip: 'What S and R work about, as a menu at the pointer',
    keys: ['.'], presetKeys: { ofs: [] }, menu: 'Edit', group: 'pivot', when: hasDoc, keyWhen: axisKeys, run: pivotMenu },
  ...PIVOTS.map((p) => ({ id: 'lanes.pivot.' + p, title: `Pivot: ${PIVOT_LABEL[p]}`, tip: PIVOT_TIP[p], menu: 'Edit', group: 'pivot', when: hasDoc,
    checked: (app) => pivotOf(app.settings.get('lanes.pivot', 'middle')) === p, run: (app) => { app.settings.set('lanes.pivot', p); app.toast(`Pivot: ${PIVOT_LABEL[p]}`, 'quiet'); } })),
  // paw-5zpf stage 3: E pulls a new point out of the active one (the Groups tool's E and an action region's E come first: they
  // register earlier and hold only in their own context)
  { id: 'lanes.extrude', title: 'Extrude a point from the active one', tip: 'It follows the pointer; click keeps it, E again chains',
    keys: ['E'], menu: 'Edit', group: 'xform', when: canExtrude, keyWhen: (app) => app.mode !== 'scenes' && !groupsOpen(app), run: extrude },
  { id: 'lanes.duplicateGrab', title: 'Duplicate and grab', keys: ['Shift+D'], menu: 'Edit', group: 'xform', when: canXform, run: (app) => xform(app, 'grab', { dup: true }) },
  { id: 'lanes.deleteSelected', title: 'Delete selected points (Blender X)', keys: ['X'], menu: 'Edit', group: 'xform', hidden: true,
    when: guard((app) => axisKeys(app) && hasSel(app) && app.mode !== 'track', (app) => whyOf(app, axisKeys, hasSel) || 'X is the stroke-axis tool in the Track tab'), run: del },
  { id: 'lanes.copy', title: 'Copy points', keys: ['Ctrl+C'], menu: 'Edit', group: 'clip', when: guard((app) => !!target(app), noTarget), run: (app) => { const c = copy(app); if (c) app.toast('Copied ' + plural(c.actions.length, 'point'), 'quiet'); } },
  { id: 'lanes.cut', title: 'Cut points', keys: ['Ctrl+X'], menu: 'Edit', group: 'clip', when: guard((app) => !!target(app), noTarget),
    run: (app) => { const axis = app.doc.activeAxis; if (!editable(app, axis)) return; const c = copy(app); if (!c) return; app.edit('Cut', axis, E.deletePoints(scriptOf(app, axis), target(app)).script, { empty: true }); app.toast('Cut ' + plural(c.actions.length, 'point'), 'quiet'); } },
  { id: 'lanes.paste', title: 'Paste at playhead (replace)', keys: ['Ctrl+V'], menu: 'Edit', group: 'clip', when: canPaste, run: (app) => paste(app, 'replace') },
  { id: 'lanes.pasteMerge', title: 'Paste at playhead (merge)', keys: ['Ctrl+Shift+V'], menu: 'Edit', group: 'clip', when: canPaste, run: (app) => paste(app, 'merge') },
  { id: 'lanes.pasteInsert', title: 'Paste at playhead (insert, ripple)', keys: ['Ctrl+Alt+V'], menu: 'Edit', group: 'clip', when: canPaste, run: (app) => paste(app, 'insert') },
  { id: 'lanes.duplicate', title: 'Duplicate selection', keys: ['Ctrl+D'], menu: 'Edit', group: 'clip', when: hasSel,
    run: (app) => { const axis = app.doc.activeAxis; if (!editable(app, axis)) return; const r = E.duplicate(scriptOf(app, axis), { ats: selOf(app) }, { mode: 'replace' }); const c = commit(app, 'Duplicate', axis, r.script, r.ats); if (c.dropped) app.toast(`${plural(c.dropped, 'point')} past the end of the video dropped`, 'warn'); } },

  // transforms
  { id: 'lanes.invert', title: 'Invert positions', keys: ['Shift+I'], menu: 'Edit', group: 'transform', run: (app) => transform(app, 'Invert', (s, t) => E.invert(s, t)) },
  { id: 'lanes.simplify', title: 'Simplify', keys: ['Shift+S'], menu: 'Edit', group: 'transform',
    run: (app) => transform(app, 'Simplify', (s, t) => E.simplify(s, t, { tolerance: +app.settings.get('lanes.simplifyTol', 2) || 2 })) },
  { id: 'lanes.scaleUp', title: 'Scale amplitude up', keys: ['Ctrl+ArrowUp'], menu: 'Edit', group: 'transform', run: (app) => transform(app, 'Scale', (s, t) => E.scale(s, t, { factor: 1.1, pivot: 'mid' }), true) },
  { id: 'lanes.scaleDown', title: 'Scale amplitude down', keys: ['Ctrl+ArrowDown'], menu: 'Edit', group: 'transform', run: (app) => transform(app, 'Scale', (s, t) => E.scale(s, t, { factor: 1 / 1.1, pivot: 'mid' }), true) },
  { id: 'lanes.stretch', title: 'Stretch in time', keys: ['Ctrl+Shift+ArrowRight'], menu: 'Edit', group: 'transform', run: (app) => transform(app, 'Stretch', (s, t) => E.stretch(s, t, { factor: 1.1, anchor: 'start', collide: 'clamp' }), true) },
  { id: 'lanes.compress', title: 'Compress in time', keys: ['Ctrl+Shift+ArrowLeft'], menu: 'Edit', group: 'transform', run: (app) => transform(app, 'Stretch', (s, t) => E.stretch(s, t, { factor: 1 / 1.1, anchor: 'start', collide: 'clamp' }), true) },

  // lanes / view
  { id: 'lanes.nextLane', title: 'Next lane', keys: ['Alt+ArrowDown'], menu: 'View', group: 'axis', when: guard((app) => L(app).ids().length > 1, oneLane), run: (app) => cycleLane(app, 1) },
  { id: 'lanes.prevLane', title: 'Previous lane', keys: ['Alt+ArrowUp'], menu: 'View', group: 'axis', when: guard((app) => L(app).ids().length > 1, oneLane), run: (app) => cycleLane(app, -1) },
  ...Array.from({ length: 9 }, (_, i) => ({ id: 'lanes.focusLane' + (i + 1), title: `Focus lane ${i + 1}`, keys: ['Alt+' + (i + 1)], menu: 'View', group: 'axis', hidden: i > 0,
    when: guard((app) => app.mode !== 'track' && L(app).ids().length > i, (app) => (app?.mode === 'track' ? 'Leave the Track tab first' : oneLane(app))), run: (app) => focusLane(app, L(app).ids()[i]) })),
  { id: 'lanes.zoomSelection', title: 'Zoom to selection', keys: ['Z'], menu: 'View', group: 'zoom',
    run: (app) => { const sp = spanOfTarget(target(app)); if (!sp) { app.toast('Select points first', 'quiet'); return; } app.setView(fitSpan(sp.t0, sp.t1)); } },
  { id: 'lanes.toggleSnap', title: 'Snap to frames', keys: ['N'], menu: 'View', group: 'snap', run: (app) => toggleSetting(app, 'edit.snapFrames', true, 'Snap to frames') },
  { id: 'lanes.toggleSnapGhosts', title: 'Snap to ghost extremes', menu: 'View', group: 'snap', run: (app) => toggleSetting(app, 'lanes.snapGhosts', false, 'Snap to ghosts') },
  { id: 'lanes.toggleSnapCuts', title: 'Snap to scene cuts', menu: 'View', group: 'snap', run: (app) => toggleSetting(app, 'lanes.snapCuts', true, 'Snap to cuts') },
  { id: 'lanes.toggleDragScrub', title: 'Scrub while dragging (video follows the dragged point)', menu: 'View', group: 'snap', run: (app) => toggleSetting(app, 'lanes.dragScrub', true, 'Scrub while dragging') },
  { id: 'lanes.toggleHoverScrub', title: 'Scrub on hover', menu: 'View', group: 'snap', run: (app) => toggleSetting(app, 'lanes.hoverScrub', false, 'Scrub on hover') },
  { id: 'lanes.toggleHoverThumb', title: 'Frame thumbnail on hover', menu: 'View', group: 'lanes', run: (app) => toggleSetting(app, 'lanes.hoverThumb', true, 'Hover thumbnail') },
  { id: 'lanes.toggleSpeedColors', title: 'Speed colors', keys: ['H'], menu: 'View', group: 'lanes', run: (app) => toggleSetting(app, 'lanes.speedColors', true, 'Speed colors') },
  { id: 'lanes.toggleGhosts', title: 'Show ghosts', keys: ['Alt+G'], menu: 'View', group: 'lanes', run: (app) => toggleSetting(app, 'lanes.ghosts', true, 'Ghosts') },
  { id: 'lanes.togglePush', title: 'Push mode for drags', keys: ['Shift+P'], menu: 'Edit', group: 'drag', run: (app) => { L(app).push = !L(app).push; app.toast('Push mode ' + (L(app).push ? 'on' : 'off'), 'quiet'); } },
  { id: 'lanes.toggleLock', title: 'Lock lane', menu: 'View', group: 'lane', run: (app, args) => toggleLaneFlag(app, args, 'locked', 'locked') },
  { id: 'lanes.toggleVisible', title: 'Show / hide lane', menu: 'View', group: 'lane', run: (app, args) => toggleLaneFlag(app, args, 'hidden', 'visible', true) },
  { id: 'lanes.toggleCollapse', title: 'Collapse lane', menu: 'View', group: 'lane', run: (app, args) => toggleLaneFlag(app, args, 'collapsed', 'collapsed') },
  { id: 'lanes.toggleLaneGhosts', title: 'Ghosts on this lane', menu: 'View', group: 'lane', run: (app, args) => toggleLaneFlag(app, args, 'ghostsOff', 'ghosts', true) },
  { id: 'lanes.moveLaneUp', title: 'Move lane up', keys: ['Alt+Shift+ArrowUp'], menu: 'View', group: 'lane', when: guard((app) => L(app).ids().length > 1, oneLane), run: (app, args) => moveLane(app, args, -1) },
  { id: 'lanes.moveLaneDown', title: 'Move lane down', keys: ['Alt+Shift+ArrowDown'], menu: 'View', group: 'lane', when: guard((app) => L(app).ids().length > 1, oneLane), run: (app, args) => moveLane(app, args, 1) },
  { id: 'lanes.toggleSolo', title: 'Solo lane (only it is editable)', menu: 'View', group: 'lane',
    run: (app, args) => { const axis = axisArg(app, args), st = L(app); st.solo = st.solo === axis ? null : axis; app.toast(st.solo ? 'Solo ' + axis : 'Solo off', 'quiet'); } },
  { id: 'lanes.addAxis', title: 'Add axis', menu: 'Edit', group: 'axis', when: hasDoc,
    run: (app, args) => {
      const axis = args?.axis || KNOWN_AXES.find((id) => !(id in app.doc.axes));
      if (!axis) return;
      if (!(axis in app.doc.axes)) app.edit('Add ' + axis + ' axis', axis, []);
      if (L(app).flag('hidden', axis)) L(app).toggleFlag('hidden', axis, false);
      focusLane(app, axis);
    } },
  { id: 'lanes.removeAxis', title: 'Remove axis', menu: 'Edit', group: 'axis', run: removeAxis },

  // ghosts
  { id: 'lanes.acceptGhost', title: 'Copy the ghost in (replace; bakes what it covers)', keys: ['Ctrl+Enter'], menu: 'Edit', group: 'ghost', when: guard((app) => acceptable(app, app.doc.activeAxis).length > 0, noGhost), run: (app, args) => takeGhost(app, args, 'replace') },
  { id: 'lanes.acceptGhostMerge', title: 'Copy the ghost in (merge; bakes what it covers)', keys: ['Ctrl+Shift+Enter'], menu: 'Edit', group: 'ghost', when: guard((app) => acceptable(app, app.doc.activeAxis).length > 0, noGhost), run: (app, args) => takeGhost(app, args, 'merge') },

  { id: 'lanes.contextMenu', title: 'Lane context menu', keys: ['Shift+F10'], menu: 'Edit', group: 'menu', when: hasDoc, run: openMenu },
];
