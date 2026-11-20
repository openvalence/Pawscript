// core-commands.js -- the shell's own commands: transport, undo/redo, point basics, range, view, axis, mode.
// Registered AFTER every feature's commands, so a feature can claim one of these keys with a narrower `when`.
// Feature commands live in src/features/*/commands.js.

import { lowerBound, upsert, removeAt, nearest, normalize, slice } from '../lib/core/script.js';
import { zoomAt } from '../lib/lane.js';
import { MODES } from './modes.js';
import { THEMES, DENSITIES, setTheme, setDensity } from '../ui/kit/tokens.js';
import { buildLine, machine, copyBugReport, CONTACT } from './bug-report.js';
import { SOURCE_URL } from './release.js';
import { scriptOf } from '../lib/script-of.js';   // paw-x7w7: baked + live
import { guard } from './commands.js';

/** Apply the persisted theme and density (boot and the View commands). */
export function applyLook(app) {
  if (typeof document === 'undefined') return;
  setTheme(app.settings.get('ui.theme', 'dark'));
  setDensity(app.settings.get('ui.density', 'default'));
}

const hasVideoOrScript = guard((app) => !!app.doc.media || Object.keys(app.doc.axes).length > 0, 'Open a video or script first');
const sel = (app) => (app.doc.selection.axis === app.doc.activeAxis ? app.doc.selection.ats : new Set());
const hasSel = guard((app) => sel(app).size > 0, 'Select points first');
const RANGE_WHY = 'Set a range first (I / O)';
const t = (app) => Math.round(app.player.timeMs);
// a point at the playhead (paw-ef73.14): where it rests, between frames after a smooth scrub; Snap to frames snaps it
const ph = (app) => app.player.playheadMs ?? app.player.timeMs;
const snapT = (app) => (app.settings.get('edit.snapFrames') ? app.player.snap(ph(app)) : Math.round(ph(app)));
const frameT = (app) => Math.round(app.player.snap ? app.player.snap(app.player.timeMs) : app.player.timeMs);   // structure: the frame's start

/** Set (insert or replace) a point at the playhead on the active axis. A point within half a frame is replaced. */
export function setPointAt(app, pos, at = snapT(app)) {
  const axis = app.doc.activeAxis, s = scriptOf(app, axis);
  const near = nearest(s, at, app.player.frameMs / 2);
  const base = near >= 0 ? removeAt(s, [s[near].at]) : s;
  const keepAt = near >= 0 ? s[near].at : at;
  app.edit(near >= 0 ? 'Set point' : 'Add point', axis, upsert(base, [{ at: keepAt, pos }]));
  app.select([keepAt], axis);
}

/** Move the selected points by dt ms / dp pos; refuses (returns false) if they would cross a neighbour. */
export function nudge(app, dt, dp) {
  const axis = app.doc.activeAxis, s = scriptOf(app, axis), ats = sel(app);
  if (!ats.size) return false;
  const next = s.map((a) => (ats.has(a.at) ? { at: a.at + dt, pos: Math.max(0, Math.min(100, a.pos + dp)) } : a));
  for (let i = 0; i < next.length; i++) if (next[i].at < 0 || (i && next[i].at <= next[i - 1].at)) { app.toast('Points would cross a neighbor', 'quiet'); return false; }
  app.edit(dt ? 'Nudge time' : 'Nudge position', axis, next, { coalesce: true });
  if (dt) app.select([...ats].map((x) => x + dt), axis);
  return true;
}

function seekPoint(app, dir) {
  const s = app.script, now = t(app);
  if (!s.length) return;
  const i = lowerBound(s, dir > 0 ? now + 1 : now) + (dir > 0 ? 0 : -1);
  if (i < 0 || i >= s.length) return;
  app.player.pause();
  app.player.seek(s[i].at);
  app.select([s[i].at]);
}

/** Copy the last two points before the playhead (one up/down stroke) to the playhead. */
function repeatStroke(app) {
  const axis = app.doc.activeAxis, s = scriptOf(app, axis), now = snapT(app);
  const i = lowerBound(s, now) - 1;
  if (i < 1) { app.toast('Needs two points before the playhead', 'quiet'); return; }
  const q = s[i - 1], p = s[i], d = p.at - q.at;
  const add = [{ at: now, pos: q.pos }, { at: now + d, pos: p.pos }];
  app.edit('Repeat stroke', axis, upsert(s, add));
  app.select(add.map((a) => a.at), axis);
  app.player.seek(now + d);
}

let clip = null;   // [{dt, pos}] relative to the first copied point
function copy(app) { const s = app.script, ats = sel(app); const c = s.filter((a) => ats.has(a.at)); if (!c.length) return false; clip = c.map((a) => ({ dt: a.at - c[0].at, pos: a.pos })); return c; }
function paste(app) {
  if (!clip?.length) return;
  const axis = app.doc.activeAxis, s = scriptOf(app, axis), at0 = snapT(app), end = at0 + clip[clip.length - 1].dt;
  const add = clip.map((c) => ({ at: at0 + c.dt, pos: c.pos }));
  app.edit('Paste', axis, normalize([...s.filter((a) => a.at < at0 || a.at > end), ...add]));
  app.select(add.map((a) => a.at), axis);
}

async function about(app) {
  let paths = null;
  try { paths = await app.backend.appPaths?.(); } catch { /* not in Tauri */ }
  const probs = app.pluginProblems?.length ? '\n\nFeatures that failed to load:\n' + app.pluginProblems.join('\n') : '';
  const m = await machine(app);   // paw-frhy: the build, the GPU in one line, where the data lives, where to send a report
  await app.choose({
    title: 'Pawscript',
    message: `${buildLine()}\nGPU: ${m.gpus.join('; ')}\n${paths?.data_dir ? `Your data: ${paths.data_dir}\n` : ''}\n`
      + 'Funscript editor and semi-automatic scripter.\nNo telemetry: online only when you ask, to download models or check for an update.\n'
      + 'For adults (18+) only.\n'
      + `Free software under the GPL (GPL-3.0-or-later), published by OpenValence. Source: ${SOURCE_URL}\n`
      + `Found a problem? Help › Copy bug report, then: ${CONTACT}.\n\n`
      + `Features: ${(app.features || []).join(', ') || 'none'}\nCommands: ${app.commands.list().length}`,
    detail: (paths ? 'Where Pawscript writes:\n' + Object.entries(paths).map(([k, v]) => `${k}: ${v}`).join('\n') : '') + probs,
    choices: [{ id: 'ok', label: 'Close', kind: 'primary' }],
  });
}

let loopIn = null;
function markLoop(app) {
  const now = frameT(app);   // a loop edge is structure: always on a frame
  if (loopIn == null || now <= loopIn) { loopIn = now; app.toast('Loop in at ' + (now / 1000).toFixed(3) + ' s, press L again at the end of the cycle', 'quiet'); return; }
  const l = { id: 'loop' + Date.now().toString(36), t0: loopIn, t1: now };
  loopIn = null;
  app.transact('Mark loop', () => { app.doc.loops = [...app.doc.loops, l].sort((a, b) => a.t0 - b.t0); });
  app.player.setLoop(l);
  const f = Math.round((l.t1 - l.t0) / app.player.frameMs);
  // the second L already turns loop playback on: say so, and that Shift+L is what stops it
  const stop = app.commands.keysFor?.('loop.playToggle')?.[0] || 'Shift+L';
  app.toast(`Loop ${((l.t1 - l.t0) / 1000).toFixed(3)} s = ${f} frames, looping (${stop} stops)`, 'ok');
}

const zoom = (app, f) => app.setView(zoomAt(app.view, app.player.timeMs >= app.view.start && app.player.timeMs <= app.view.start + app.view.span ? app.player.timeMs : app.view.start + app.view.span / 2, f, app.durationMs));

const axisIds = (app) => Object.keys(app.doc.axes);
function cycleAxis(app, dir) {
  const ids = axisIds(app);
  if (ids.length < 2) return;
  const i = ids.indexOf(app.doc.activeAxis);
  app.setActiveAxis(ids[(i + dir + ids.length) % ids.length]);
  app.toast('Editing ' + app.doc.activeAxis, 'quiet');
}

/** Core commands that features/lanes implements better (lane locks, clamping, multi-lane): dropped when lanes is present. */
export const LANES_OWN = new Set(['edit.cut', 'edit.copy', 'edit.paste', 'edit.delete', 'edit.point100', 'edit.repeatStroke', 'edit.prevPoint', 'edit.nextPoint',
  'edit.nudgeUp', 'edit.nudgeDown', 'edit.nudgeUpFine', 'edit.nudgeDownFine', 'edit.nudgeLeft', 'edit.nudgeRight', 'axis.next', 'axis.prev',
  ...Array.from({ length: 10 }, (_, k) => 'edit.point' + k)]);
/** The core list for a set of registered feature names. */
export const coreFor = (features) => (features.includes('lanes') ? CORE.filter((c) => !LANES_OWN.has(c.id)) : CORE);

const CORE = [
  // ---- Play ----
  { id: 'player.toggle', title: 'Play / pause', keys: ['Space'], keyUp: true, menu: 'Play', when: hasVideoOrScript, run: (app) => app.player.toggle() },
  { id: 'player.stepBack', title: 'Previous frame', keys: ['ArrowLeft'], menu: 'Play', group: 'step', run: (app) => app.player.step(-1) },
  { id: 'player.stepFwd', title: 'Next frame', keys: ['ArrowRight'], menu: 'Play', group: 'step', run: (app) => app.player.step(1) },
  { id: 'player.back', title: 'Jump back', tip: 'As far as the Shift+arrow jump setting', keys: ['Shift+ArrowLeft'], menu: 'Play', group: 'step', run: (app) => app.player.seek(app.player.timeMs - app.settings.get('view.seekStepMs')) },
  { id: 'player.fwd', title: 'Jump forward', tip: 'As far as the Shift+arrow jump setting', keys: ['Shift+ArrowRight'], menu: 'Play', group: 'step', run: (app) => app.player.seek(app.player.timeMs + app.settings.get('view.seekStepMs')) },
  { id: 'player.start', title: 'Go to start', keys: ['Home'], menu: 'Play', group: 'jump', run: (app) => app.player.seek(0) },
  { id: 'player.end', title: 'Go to end', keys: ['End', 'Shift+G'], menu: 'Play', group: 'jump', run: (app) => app.player.seek(app.mediaMs || app.durationMs) },
  { id: 'player.slower', title: 'Slower', keys: ['['], menu: 'Play', group: 'rate', run: (app) => { const r = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3]; const i = r.findIndex((x) => x >= app.player.rate); app.player.setRate(r[Math.max(0, i - 1)]); app.settings.set('player.rate', app.player.rate); app.toast('Speed ' + app.player.rate + 'x', 'quiet'); } },
  { id: 'player.faster', title: 'Faster', keys: [']'], menu: 'Play', group: 'rate', run: (app) => { const r = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3]; const i = r.findIndex((x) => x > app.player.rate); app.player.setRate(r[i < 0 ? r.length - 1 : i]); app.settings.set('player.rate', app.player.rate); app.toast('Speed ' + app.player.rate + 'x', 'quiet'); } },
  { id: 'player.rate1', title: 'Normal speed', keys: ['\\'], menu: 'Play', group: 'rate', run: (app) => { app.player.setRate(1); app.settings.set('player.rate', 1); app.toast('Speed 1x', 'quiet'); } },
  { id: 'loop.mark', title: 'Mark loop in / out', keys: ['L'], menu: 'Play', group: 'loop', when: hasVideoOrScript, run: markLoop },
  { id: 'loop.playToggle', title: 'Loop playback on / off (range or loop)', keys: ['Shift+L'], menu: 'Play', group: 'loop', run: (app) => {
    if (app.player.loop) { app.player.setLoop(null); app.toast('Loop playback off', 'quiet'); return; }
    // paw-llaa: anywhere in a loop's passes (it is drawn over them on its shot) loops its cycle, at the same phase
    const now = app.player.timeMs, inPass = (x) => now >= x.t0 && now < Math.max(x.t1, x.tiledTo || 0, x.auto?.end || 0);
    const l = app.doc.loops.find((x) => now >= x.t0 && now < x.t1) || app.doc.loops.find(inPass) || app.doc.range;
    if (l) { app.player.setLoop(l); if (l !== app.doc.range && now >= l.t1) app.player.seek(l.t0 + ((now - l.t0) % (l.t1 - l.t0))); app.toast('Looping ' + ((l.t1 - l.t0) / 1000).toFixed(2) + ' s', 'quiet'); } else app.toast('Set a range (I/O) or stand inside a loop', 'quiet');
  } },

  // ---- Edit ----
  { id: 'edit.undo', title: 'Undo', keys: ['Ctrl+Z'], menu: 'Edit', group: 'history', when: guard((app) => (app.labelling?.on ? app.labelling.canUndo : app.history.canUndo), 'Nothing to undo'), run: (app) => (app.labelling?.on ? app.labelling.undo() : app.undo()) },
  { id: 'edit.redo', title: 'Redo', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], menu: 'Edit', group: 'history', when: guard((app) => (app.labelling?.on ? app.labelling.canRedo : app.history.canRedo), 'Nothing to redo'), run: (app) => (app.labelling?.on ? app.labelling.redo() : app.redo()) },
  { id: 'edit.cut', title: 'Cut points', keys: ['Ctrl+X'], menu: 'Edit', group: 'clip', when: hasSel, run: (app) => { if (copy(app)) app.edit('Cut', app.doc.activeAxis, removeAt(app.script, sel(app))); } },
  { id: 'edit.copy', title: 'Copy points', keys: ['Ctrl+C'], menu: 'Edit', group: 'clip', when: hasSel, run: (app) => { const c = copy(app); if (c) app.toast(`Copied ${c.length} points`, 'quiet'); } },
  { id: 'edit.paste', title: 'Paste points at playhead', keys: ['Ctrl+V'], menu: 'Edit', group: 'clip', when: () => !!clip?.length, run: paste },
  { id: 'edit.delete', title: 'Delete selected points', keys: ['Delete', 'Backspace'], menu: 'Edit', group: 'clip', when: hasSel, run: (app) => app.edit('Delete points', app.doc.activeAxis, removeAt(app.script, sel(app))) },
  ...Array.from({ length: 10 }, (_, k) => ({ id: 'edit.point' + k, title: `Set point ${k * 10} at playhead`, keys: [String(k)], menu: 'Edit', group: 'points', hidden: k > 0 && k < 9 && k !== 5,
    when: hasVideoOrScript, run: (app) => setPointAt(app, k * 10) })),
  { id: 'edit.point100', title: 'Set point 100 at playhead', keys: ['Shift+0'], menu: 'Edit', group: 'points', when: hasVideoOrScript, run: (app) => setPointAt(app, 100) },
  { id: 'edit.repeatStroke', title: 'Repeat last stroke at playhead', keys: ['Q'], menu: 'Edit', group: 'points', when: hasVideoOrScript, run: repeatStroke },
  { id: 'edit.prevPoint', title: 'Previous point', keys: [','], menu: 'Edit', group: 'nav', run: (app) => seekPoint(app, -1) },
  { id: 'edit.nextPoint', title: 'Next point', keys: ['.'], menu: 'Edit', group: 'nav', run: (app) => seekPoint(app, 1) },
  { id: 'edit.nudgeUp', title: 'Nudge selected up', keys: ['ArrowUp'], menu: 'Edit', group: 'nudge', when: hasSel, run: (app) => nudge(app, 0, app.settings.get('edit.posStep')) },
  { id: 'edit.nudgeDown', title: 'Nudge selected down', keys: ['ArrowDown'], menu: 'Edit', group: 'nudge', when: hasSel, run: (app) => nudge(app, 0, -app.settings.get('edit.posStep')) },
  { id: 'edit.nudgeUpFine', title: 'Nudge selected up 1', keys: ['Shift+ArrowUp'], menu: 'Edit', group: 'nudge', when: hasSel, run: (app) => nudge(app, 0, 1) },
  { id: 'edit.nudgeDownFine', title: 'Nudge selected down 1', keys: ['Shift+ArrowDown'], menu: 'Edit', group: 'nudge', when: hasSel, run: (app) => nudge(app, 0, -1) },
  { id: 'edit.nudgeLeft', title: 'Nudge selected 1 frame earlier', keys: ['Ctrl+ArrowLeft'], menu: 'Edit', group: 'nudge', when: hasSel, run: (app) => nudge(app, -Math.round(app.player.frameMs), 0) },
  { id: 'edit.nudgeRight', title: 'Nudge selected 1 frame later', keys: ['Ctrl+ArrowRight'], menu: 'Edit', group: 'nudge', when: hasSel, run: (app) => nudge(app, Math.round(app.player.frameMs), 0) },
  { id: 'edit.selectAll', title: 'Select all points', keys: ['Ctrl+A'], menu: 'Edit', group: 'select', run: (app) => app.select(app.script.map((a) => a.at)) },
  { id: 'edit.selectInRange', title: 'Select points in range', keys: ['Ctrl+Shift+A'], menu: 'Edit', group: 'select', when: guard((app) => !!app.doc.range, RANGE_WHY), run: (app) => app.select(slice(app.script, app.doc.range.t0, app.doc.range.t1).map((a) => a.at)) },
  { id: 'edit.escape', title: 'Clear selection, then range', keys: ['Escape'], menu: 'Edit', group: 'select', when: guard((app) => hasSel(app) || !!app.doc.range, 'Nothing selected and no range'), run: (app) => { if (hasSel(app)) app.select([]); else app.doc.range = null; } },

  // ---- Range (I/O) ----
  { id: 'range.in', title: 'Range in at playhead', keys: ['I'], menu: 'Edit', group: 'range', when: hasVideoOrScript, run: (app) => { const now = frameT(app), r = app.doc.range; app.doc.range = { t0: now, t1: r && r.t1 > now ? r.t1 : Math.max(now, app.mediaMs || app.durationMs) }; } },
  { id: 'range.out', title: 'Range out at playhead', keys: ['O'], menu: 'Edit', group: 'range', when: hasVideoOrScript, run: (app) => { const now = frameT(app), r = app.doc.range; app.doc.range = { t0: r && r.t0 < now ? r.t0 : 0, t1: now }; } },
  { id: 'range.clear', title: 'Clear range', menu: 'Edit', group: 'range', when: guard((app) => !!app.doc.range, RANGE_WHY), run: (app) => (app.doc.range = null) },

  // ---- View ----
  { id: 'view.zoomIn', title: 'Zoom in', keys: ['='], menu: 'View', group: 'zoom', run: (app) => zoom(app, 0.6) },
  { id: 'view.zoomOut', title: 'Zoom out', keys: ['-'], menu: 'View', group: 'zoom', run: (app) => zoom(app, 1 / 0.6) },
  { id: 'view.fit', title: 'Zoom to fit', keys: ['Ctrl+0'], menu: 'View', group: 'zoom', run: (app) => app.setView({ start: 0, span: app.durationMs }) },
  { id: 'view.fitRange', title: 'Zoom to range', keys: ['Shift+R'], menu: 'View', group: 'zoom', when: guard((app) => !!app.doc.range, RANGE_WHY), run: (app) => { const r = app.doc.range, pad = (r.t1 - r.t0) * 0.05; app.setView({ start: r.t0 - pad, span: r.t1 - r.t0 + 2 * pad }); } },
  { id: 'view.follow', title: 'Follow playhead', keys: ['Shift+F'], menu: 'View', group: 'zoom', run: (app) => { app.follow = !app.follow; app.toast('Follow ' + (app.follow ? 'on' : 'off'), 'quiet'); } },
  { id: 'axis.next', title: 'Next axis', keys: ['Alt+ArrowDown'], menu: 'View', group: 'axis', when: (app) => axisIds(app).length > 1, run: (app) => cycleAxis(app, 1) },
  { id: 'axis.prev', title: 'Previous axis', keys: ['Alt+ArrowUp'], menu: 'View', group: 'axis', when: (app) => axisIds(app).length > 1, run: (app) => cycleAxis(app, -1) },
  ...MODES.map((m, i) => ({ id: 'mode.' + m, title: `${m[0].toUpperCase() + m.slice(1)} tab`, keys: ['Ctrl+' + (i + 1)], menu: 'View', group: 'mode', run: (app) => app.setMode(m) })),
  // the bottom dock is the bottom tray (paw-idb5): folded it takes no height at all, the status bar's centred button opens it
  ...[['Left', 'Ctrl+B'], ['Right', 'Ctrl+Alt+B'], ['Bottom', 'Ctrl+J']].map(([d, k]) => ({ id: 'layout.toggle' + d, title: d === 'Bottom' ? 'Toggle bottom tray' : `Toggle ${d.toLowerCase()} dock`, keys: [k], menu: 'View', group: 'layout',
    when: guard((app) => !!app.layout && app.panelsIn(d.toLowerCase()).length > 0, d === 'Bottom' ? 'No panel in the bottom tray' : `No panel in the ${d.toLowerCase()} dock`), run: (app) => app.layout.toggle(d.toLowerCase()) })),
  // Blender's Toggle Maximize Area is Ctrl+Space; here that is Play range, so the chord of Blender's fullscreen area
  { id: 'layout.maximize', title: 'Toggle maximize area (the one under the pointer)', keys: ['Ctrl+Alt+Space'], menu: 'View', group: 'layout',
    when: guard((app) => !!(app.layout?.maximized || app.layout?.hover), 'Point at an area first'), run: (app) => app.layout.toggleMax() },
  ...THEMES.map((t) => ({ id: 'view.theme.' + (t.id ?? t), title: `Theme: ${t.label ?? t}`, menu: 'View', group: 'theme', run: (app) => { app.settings.set('ui.theme', t.id ?? t); applyLook(app); } })),
  ...DENSITIES.map((d) => ({ id: 'view.density.' + d, title: `Density: ${d}`, menu: 'View', group: 'density', run: (app) => { app.settings.set('ui.density', d); applyLook(app); } })),
  // paw-43vn: furry items (settings content.furry; lib/content.js): live, no restart
  { id: 'view.furry', title: 'Furry items: show / hide', menu: 'View', group: 'theme', tip: 'Off: no tails, sheaths or animal tags, paws read as feet',
    run: (app) => { const on = app.settings.get('content.furry') === false; app.settings.set('content.furry', on); app.toast(on ? 'Furry items shown' : 'Furry items hidden: human parts and bodies only (the knot stays)', 'quiet'); } },
  { id: 'view.machinePreview', title: 'Machine preview (device kinematics)', menu: 'View', group: 'preview', when: guard((app) => !!app.devicePreview?.available, 'Pick a device profile with kinematics first'),
    run: (app) => { app.devicePreview.toggle(); app.toast('Machine preview ' + (app.devicePreview.on ? 'on' : 'off'), 'quiet'); } },
  { id: 'help.about', title: 'About Pawscript', menu: 'Help', group: 'about', run: about },
  { id: 'help.bugReport', title: 'Copy bug report (no file names in it)', menu: 'Help', group: 'about', run: copyBugReport },
  // paw-m3b6: an area's options (Area.svelte) as commands: the area args.id, else the one under the pointer
  ...[['Right', 'right', 'left / right'], ['Bottom', 'bottom', 'top / bottom']].map(([d, side, words]) => ({ id: 'area.split' + d, title: 'Split area ' + words, menu: 'View', group: 'layout',
    when: guard((app) => !!app.layout, 'Open a document first'), run: (app, a) => { const id = a?.id ?? app.layout.hover; if (id) app.layout.splitHalf?.(id, side); } })),
  { id: 'area.close', title: 'Close area (its tabs move to its neighbor)', menu: 'View', group: 'layout', when: guard((app) => !!app.layout, 'Open a document first'), run: (app, a) => { const id = a?.id ?? app.layout.hover; if (id) app.layout.close(id); } },
  { id: 'layout.reset', title: 'Reset layout for this tab', menu: 'View', group: 'layout', when: guard((app) => !!app.layout, 'Open a document first'), run: (app) => app.layout.reset() },
];
export default CORE;
