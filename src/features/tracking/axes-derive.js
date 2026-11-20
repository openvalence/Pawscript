// axes-derive.js -- paw-2pcf: a run's secondary axes (surge, sway, twist, roll, pitch; lib/six-axis.js does the maths) as
// ghosts, one per axis that has data: {id: '<run>~<axis>', axis, script, source: {kind: 'axes', runId, axis, label, segs,
// sig}}. segs = per shot of the run [{t0, t1, view, guessed, label, conf, amp, from}]. They sit on their axis's lane when it
// exists (lanes/state ghostsFor), play live on that lane where its shot is not baked (paw-x7w7, lib/script-of.js; Bake makes
// them permanent), are never saved (project-logic PREVIEW_GHOST: re-derived on demand) and never in the run list. A shot's view comes from
// its angle tag (timeline/acts.js), else its POV camera tag, else a guessed side view; shot.axflip = [axis] negates an
// axis there (an undoable shot edit). The derivation runs after every track and on the command; a view / flip change
// re-derives the runs that have axes ghosts (refreshAxes, from the store's scene effect).
import { measure, deriveShot, viewFor, SECONDARY, FROM } from '../../lib/six-axis.js';
import { sceneAngle, sceneCamera } from '../timeline/acts.js';
import { sceneAt, runForScene, maskRun } from '../../lib/runs.js';
import { positioningOf } from '../timeline/regions.js';
import { runDerives, withAgainst, deriveBlock, deriveOf } from '../../lib/rederive.js';
import { camInput } from '../../lib/runs-channel.js';
import { heldRun } from '../../lib/held.js';
import { WHO_NAME } from './groups.js';

export const KIND = 'axes';
export const isAxesGhost = (g) => g?.source?.kind === KIND;
const RANK = { none: 0, estimate: 1, measured: 2 };
// the sidecar's group names (pawtrack/cli.py parse_groups, as fake-pawtrack): who_part_side, else the cleaned name
const clean = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const keyOf = (g) => (g.who || g.part ? [g.who, clean(g.part) || clean(g.name) || 'other', g.side].filter(Boolean).join('_') : clean(g.name));

/** The run's shots: each run scene cut by the document's shots inside it. -> [{t0, t1, shot | null}] */
export function segmentsOf(run, shots = []) {
  const r0 = run.range?.start ?? -Infinity, r1 = run.range?.end ?? Infinity, out = [];
  for (const sc of run.scenes?.length ? run.scenes : [{ start_ms: r0, end_ms: r1 }]) {
    const a = Math.max(sc.start_ms, r0), b = Math.min(sc.end_ms, r1), inside = shots.filter((s) => s.end_ms > a && s.start_ms < b);
    if (!inside.length) out.push({ t0: a, t1: b, shot: null });
    for (const s of inside) out.push({ t0: Math.max(a, s.start_ms), t1: Math.min(b, s.end_ms), shot: s });
  }
  return out.filter((x) => x.t1 > x.t0 && Number.isFinite(x.t0) && Number.isFinite(x.t1));
}
/** Painted groups for a run without pinned ids: the shot's own (seeded inside it), else any inside the run. */
function polysFor(shots, t0, t1, run) {
  const out = {}, all = shots.flatMap((s) => s.groups || []).filter((g) => g?.poly?.length > 2 && Number.isFinite(g.t_ms));
  for (const [a, b] of [[t0, t1], [run.range?.start ?? t0, run.range?.end ?? t1]]) for (const g of all) if (g.t_ms >= a - 50 && g.t_ms < b + 50) out[keyOf(g)] ||= g;
  return out;
}
const viewOf = (shot) => viewFor(shot ? sceneAngle(shot) : null, shot ? sceneCamera(shot) : null);
/** What a re-derive depends on beyond the run: each shot's view and flips. */
export const sigOf = (run, shots) => segmentsOf(run, shots).map((s) => [s.t0, s.t1, viewOf(s.shot).view, viewOf(s.shot).guessed ? 1 : 0, (s.shot?.axflip || []).join(','), s.shot ? [sceneCamera(s.shot) || '', JSON.stringify(deriveOf(s.shot, run.id)?.cam || null), deriveOf(s.shot, run.id)?.against || '', deriveOf(s.shot, run.id)?.held ?? ''].join('/') : '', ...(s.shot?.positioning ? [JSON.stringify(s.shot.positioning)] : [])].join(':')).join('|');   // paw-jyde.11: + the camera (a solo reading reads it); paw-rnv1: + the held switch; paw-2lp7.1: + its positioning ranges

/** paw-jyde.11: the solo reading's camera for the shot at t0: removed = the run's centres there have the camera taken out (the
 *  shot's camera setting as fusion applies it: off / strength 0 = not; move / zoom / full = re-estimated; auto / as tracked = the
 *  sidecar's path, if the run has one), tag = the shot's camera tag. */
function camOf(run, dv, t0, shot) {
  const k = sceneAt(run.scenes || [], t0), c = withAgainst(dv[k] ?? (k < 0 ? dv[0] : null) ?? null)?.cam, has = !!run.channels?.cam_x;
  const removed = deriveBlock(run) || !c ? has : c.mode === 'off' || c.strength === 0 ? false : c.mode === 'auto' ? has : true;
  return { removed, tag: shot ? sceneCamera(shot) : null };
}
/** One run's secondary axes. -> {segs: [{t0, t1, view, guessed, pov, frame (a solo reading: hips vs frame), axes: {axis: {label,
 *  conf, amp, from, kind}}}], scripts: {axis: [{at, pos}]}} */
export function deriveRun(run, shots = [], { aspect = 16 / 9 } = {}) {
  const segs = [], scripts = Object.fromEntries(SECONDARY.map((a) => [a, []]));
  const dv = runDerives(run, shots);
  run = maskRun(run, positioningOf(shots));   // paw-2lp7.1: positioning ranges are gaps for the held check and the centres (deriveShot skips the fits there)
  run = heldRun(run, dv, aspect)?.run || run;   // paw-rnv1: characters drawn on twos / threes, retimed (lib/held.js)
  let framed = null;
  const camRun = () => (framed ||= camInput(run, dv, aspect));   // only a solo reading needs it (a pair cancels the camera)
  for (const sg of segmentsOf(run, shots)) {
    const v = viewOf(sg.shot), m = measure(run, sg.t0, sg.t1, { aspect, polys: polysFor(shots, sg.t0, sg.t1, run), cam: { run: camRun, ...camOf(run, dv, sg.t0, sg.shot) }, view: v });
    const d = m ? deriveShot(m, { ...v, flips: sg.shot?.axflip || [], skip: sg.shot?.positioning }) : null;
    segs.push({ t0: sg.t0, t1: sg.t1, view: v.view, guessed: v.guessed, pov: !!v.pov, ...(d?.frame ? { frame: d.frame } : {}),
      axes: Object.fromEntries(SECONDARY.map((a) => { const x = d?.axes[a]; return [a, { label: x?.label || 'none', conf: +(x?.conf || 0).toFixed(2), amp: x?.amp || 0, from: x?.from || null, kind: x?.kind || null, ...(x?.signFrom ? { signFrom: x.signFrom } : {}) }]; })) });
    if (d) for (const a of SECONDARY) for (const p of d.axes[a].script) { const s = scripts[a]; if (!s.length || p.at > s[s.length - 1].at) s.push(p); }
  }
  return { segs, scripts };
}

/** The ghosts of one run (axes with data only). name: the run's title; vis: {id: visible} kept from before. */
export function ghostsOf(run, shots, { aspect, name = run.id, color = run.color, vis = {} } = {}) {
  const { segs, scripts } = deriveRun(run, shots, { aspect }), sig = sigOf(run, shots);
  return SECONDARY.filter((a) => scripts[a].length).map((axis) => {
    const best = segs.reduce((b, s) => (RANK[s.axes[axis].label] > RANK[b] ? s.axes[axis].label : b), 'none'), id = `${run.id}~${axis}`;
    const vs = segs.some((s) => s.frame && s.axes[axis].label !== 'none') ? ' (hips vs frame)' : '';   // paw-jyde.11
    return { id, name: `${name} · ${axis} ${best}${vs}`, color, axis, script: scripts[axis], visible: vis[id] ?? true,
      source: { kind: KIND, runId: run.id, axis, label: best, sig, segs: segs.map((s) => ({ t0: s.t0, t1: s.t1, view: s.view, guessed: s.guessed, pov: s.pov, ...(s.frame ? { frame: s.frame } : {}), ...s.axes[axis] })) } };
  });
}

const derivable = (r) => !r.tag && !r.mod && !!r.frames && !!r.channels;
/** Re-derive the axes ghosts of runs `ids` (default: every run of the store). -> the number of ghosts made. */
export function deriveAxes(app, tr, ids = null) {
  const runs = tr.runs.filter((r) => (!ids || ids.includes(r.id)) && derivable(r)), done = new Set(runs.map((r) => r.id));
  if (!runs.length) return 0;
  const old = app.doc.ghosts || [], vis = Object.fromEntries(old.filter(isAxesGhost).map((g) => [g.id, g.visible !== false]));
  const made = runs.flatMap((r) => { try { return ghostsOf(r, tr.scenes, { aspect: tr.aspect, name: tr.titleOf?.(r) || r.id, vis }); } catch (e) { console.warn('[axes] derive failed', r.id, e); return []; } });
  app.doc.ghosts = [...old.filter((g) => !(isAxesGhost(g) && done.has(g.source.runId))), ...made];
  return made.length;
}
/** After a scene edit: the runs whose axes ghosts were made for other views / flips are derived again; a run gone takes
 *  its ghosts with it. */
export function refreshAxes(app, tr) {
  const gs = (app.doc.ghosts || []).filter(isAxesGhost);
  if (!gs.length) return;
  const by = new Map(gs.map((g) => [g.source.runId, g])), stale = [];
  for (const [id, g] of by) { const r = tr.runs.find((x) => x.id === id); if (!r) stale.push(id); else if (g.source.sig !== sigOf(r, tr.scenes)) stale.push(id); }
  if (!stale.length) return;
  const live = stale.filter((id) => tr.runs.some((r) => r.id === id));
  if (live.length) deriveAxes(app, tr, live);
  const gone = new Set(stale.filter((id) => !live.includes(id)));
  if (gone.size) app.doc.ghosts = app.doc.ghosts.filter((g) => !(isAxesGhost(g) && gone.has(g.source.runId)));
}

/** The run a shot's axes come from: the shot's linked / newest run that has axes ghosts, else the selected one's. */
function runOfShot(app, tr, i) {
  const s = tr.scenes[i], gs = (app.doc.ghosts || []).filter(isAxesGhost), has = (id) => !!id && gs.some((g) => g.source.runId === id);
  const linked = s ? tr.sceneLink?.(i)?.runId || runForScene(s, tr.links, tr.ghosts) : null;
  if (has(linked)) return linked;
  const sel = tr.selectedGhost, selRun = isAxesGhost(sel) ? sel.source.runId : sel?.id;
  if (has(selRun)) return selRun;
  const over = s ? gs.filter((g) => g.source.segs.some((x) => x.t0 < s.end_ms && x.t1 > s.start_ms)) : [];
  return over.length ? over[over.length - 1].source.runId : null;
}
/**
 * The Shot popover's line for shot i: {view, guessed, pov, runId, axes: {axis: {label, conf, amp, from (words), sides (paw-5r1: its
 * sign from the Bottom's painted left / right), flipped,
 * ghost}}, missing (axes with data but no lane), frame (paw-jyde.11: a solo reading, hips vs frame: {who, ref, refGuess, removed,
 * tag, camLeak, others, facing}) | null}.
 */
export function shotAxes(app, tr, i) {
  const s = tr.scenes[i];
  if (!s) return null;
  const v = viewOf(s), runId = runOfShot(app, tr, i), gs = (app.doc.ghosts || []).filter((g) => isAxesGhost(g) && g.source.runId === runId);
  const over = (x) => x.t0 < s.end_ms && x.t1 > s.start_ms;
  const axes = Object.fromEntries(SECONDARY.map((a) => {
    const g = gs.find((x) => x.axis === a), seg = g?.source.segs.find((x) => over(x) && x.label !== 'none');
    return [a, { label: seg?.label || 'none', conf: seg?.conf || 0, amp: seg?.amp || 0, from: seg?.from ? FROM[seg.from] : '', sides: seg?.signFrom === 'sides', flipped: !!s.axflip?.includes(a), ghost: seg ? g.id : null }];
  }));
  const frame = gs.flatMap((g) => g.source.segs).find((x) => over(x) && x.frame)?.frame || null;
  return { ...v, runId, axes, frame, missing: SECONDARY.filter((a) => axes[a].ghost && !(a in app.doc.axes)) };
}
/** paw-jyde.11: the words for a solo reading (the view chip's "vs frame" and its tooltip). */
export function frameWords(f) {
  if (!f) return '';
  const who = f.who ? `${WHO_NAME[f.who]}'s hips` : 'The hips';
  const up = { torso: 'its up = hips → torso', head: 'its up = hips → head', legs: 'its up GUESSED: up from the thighs (they lie below the hips; paint the torso or head)', sides: 'its up GUESSED: up from the painted left / right (across the left → right line; paint the torso or head)', 'short axis': 'its up GUESSED: the hips’ short axis (seen from behind / in front their width is left-right; paint the torso or head)', vertical: 'its up = picture vertical (guess; paint the torso or head)' }[f.ref] || '';
  const cam = f.camLeak ? `camera NOT removed on a ${f.tag} shot: every axis weaker (turn camera removal on in Adjust)` : f.removed ? 'camera removed' : 'camera not removed';
  const others = f.others?.length ? ` · ${f.others.map((w) => WHO_NAME[w]).join(' / ')} painted but no pair (no hips / torso / penis to read against)` : '';
  return `${who} vs frame (one character, no partner): ${up}; ${cam}${f.facing ? ' · POV: facing unknown without painted left / right sides, so estimates only' : ''}${others}`;
}

/** Add the lanes of every secondary axis that has an axes ghost and no lane yet, as one undo step. -> the axes added. */
export function addAxisLanes(app) {
  const want = [...new Set((app.doc.ghosts || []).filter(isAxesGhost).map((g) => g.axis))].filter((a) => !(a in app.doc.axes));
  want.sort((a, b) => SECONDARY.indexOf(a) - SECONDARY.indexOf(b));
  if (want.length) app.transact(`Add ${want.join(', ')} lane${want.length > 1 ? 's' : ''}`, () => { for (const a of want) app.edit(`Add ${a} axis`, a, []); });
  return want;
}
/** shot.axflip with `axis` toggled: the new scene list (the caller writes it in a transaction). */
export const withAxisFlip = (list, i, axis) => list.map((s, k) => {
  if (k !== i) return s;
  const f = new Set(s.axflip || []);
  if (f.has(axis)) f.delete(axis); else f.add(axis);
  const { axflip: _, ...rest } = s;   // eslint-disable-line no-unused-vars
  return f.size ? { ...rest, axflip: SECONDARY.filter((a) => f.has(a)) } : rest;
});

/** The selected run's visible axes ghosts (the six-axis preview reads their shot segments). */
export function followedAxesGhosts(app, tr) {
  const sel = tr?.selectedGhost, runId = isAxesGhost(sel) ? sel.source.runId : sel?.id;
  return (app.doc.ghosts || []).filter((x) => isAxesGhost(x) && x.source.runId === runId && x.visible !== false);
}
/** The shot under the playhead (index into tr.scenes) or -1. */
export const shotAtPlayhead = (app, tr) => (tr?.scenes?.length ? sceneAt(tr.scenes, app.player.timeMs) : -1);

// ---- the commands' bodies (tracking/commands.js) ----
const shotOf = (app, tr) => (tr.currentScene >= 0 ? tr.currentScene : shotAtPlayhead(app, tr));
/** Derive secondary axes: the selected run, else the runs over the range, else over the current shot, else all. */
export function deriveCommand(app, tr) {
  const sel = tr.selectedGhost, selRun = isAxesGhost(sel) ? sel.source.runId : sel?.source?.kind === 'tracker' ? sel.id : null;
  const s = tr.scenes[shotOf(app, tr)], span = app.doc.range?.t1 > app.doc.range?.t0 ? app.doc.range : s ? { t0: s.start_ms, t1: s.end_ms } : null;
  const over = (r) => !span || (r.range?.start < span.t1 && r.range?.end > span.t0);
  const ids = selRun ? [selRun] : tr.runs.filter(derivable).filter(over).map((r) => r.id);
  const n = ids.length ? deriveAxes(app, tr, ids) : 0;
  const axes = [...new Set((app.doc.ghosts || []).filter((g) => isAxesGhost(g) && ids.includes(g.source.runId)).map((g) => g.axis))];
  app.toast(n ? `Secondary axes from ${ids.length} run${ids.length > 1 ? 's' : ''}: ${axes.join(', ')}${axes.some((a) => !(a in app.doc.axes)) ? ' (Add the axis lanes to see them)' : ''}` : 'No secondary axes here: they need a run with hips painted (the Bottom\'s against a Top group, or one character\'s against the frame)', n ? 'ok' : 'quiet');
  return n;
}
export function addLanesCommand(app) {
  const a = addAxisLanes(app);
  app.toast(a.length ? `Added ${a.join(', ')}` : 'Every secondary axis with data has its lane', 'quiet');
  return a;
}
/** Flip `axis` (default: the active lane's) in the current shot: one undo step; the ghosts re-derive. */
export function flipAxisCommand(app, tr, axis = app.doc.activeAxis, i = shotOf(app, tr)) {
  if (!SECONDARY.includes(axis) || !tr.scenes[i]) { app.toast('Flip works on a secondary axis lane (surge, sway, twist, roll, pitch) over a shot', 'quiet'); return false; }
  const list = withAxisFlip(tr.scenes, i, axis), on = !!list[i].axflip?.includes(axis);
  app.transact(`Flip ${axis} (shot ${i + 1})`, () => { app.doc.scenes = list; });
  app.toast(`${axis} ${on ? 'flipped' : 'back the right way'} in shot ${i + 1}`, 'quiet');
  return true;
}
export const hasAxesGhosts = (app) => (app.doc.ghosts || []).some(isAxesGhost);
