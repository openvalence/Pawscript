// logic.js -- the pure half of "Draft script": the step list and its state machine, the describe-summary -> kind
// rule table, scenes -> first plan, the tracker pick for a no-ROI base track, and the summary line. No DOM, no
// Svelte (test/draft-logic.test.mjs). draft.svelte.js runs the steps against the app.
import { makeSegment } from '../timeline/plan.js';

export const STEPS = [
  { id: 'scenes', title: 'Probe and detect scenes' },
  { id: 'describe', title: 'Describe scenes' },
  { id: 'loops', title: 'Loop check' },
  { id: 'plan', title: 'First plan' },
  { id: 'track', title: 'Base tracking (no region)' },
  { id: 'generate', title: 'Generate' },
  { id: 'assist', title: 'Hand-off to assist' },
  { id: 'review', title: 'Review' },
];
// Director mode (src/features/director, contract src/lib/director/README.md §9.2): draft's own steps plus the
// director's, which draft runs through useSteps(ext).
export const DIRECTOR_STEPS = [
  {id:'scenes',title:'Probe and detect scenes'},{id:'describe',title:'Describe scenes'},{id:'loops',title:'Loop check'},
  {id:'survey',title:'Camera and motion survey'},{id:'story',title:'Director: story'},{id:'regions',title:'Director: regions'},
  {id:'compare',title:'Director: compare trackers'},{id:'direction',title:'Director: direction and depth'},
  {id:'generate',title:'Generate'},{id:'verify',title:'Director: verify'},{id:'assist',title:'Hand-off to assist'},
  {id:'review',title:'Review'}];
export const stepsOf = (mode) => (mode === 'director' ? DIRECTOR_STEPS : STEPS);

// ---- describe summary -> kind ----------------------------------------------------------------------------
// Tag names are the describe tagger's (trackers/pawtrack/describe.py ACTS / KNOT). Edit by hand.
const KNOT_ACTS = ['knotting', 'anal_knotting', 'vaginal_knotting', 'oral_knotting'];
const ORAL = ['oral', 'oral_penetration', 'fellatio', 'deep_throat', 'irrumatio', 'cunnilingus', 'rimming', 'ball_lick', 'penis_lick'];
const PENETRATION = ['sex', 'penetration', 'anal', 'anal_penetration', 'vaginal', 'vaginal_penetration', 'double_penetration', 'spitroast',
  'dildo_insertion', 'sex_toy_insertion', 'thrusting', 'fisting', 'humping'];
const STROKING = ['handjob', 'footjob', 'tailjob', 'titfuck', 'thigh_sex', 'masturbation', 'fingering', 'anal_fingering', 'vaginal_fingering'];
const LIGHT = ['kissing', 'licking', 'grinding', 'frottage', 'tribadism'];
const any = (acts, list) => acts.find((a) => list.includes(a)) ?? null;
const someone = (s) => s.count && s.count !== 'unknown';

/** [kind, why, test(summary, acts) -> truthy (a string = the act that matched, used as a custom segment's name)].
 *  First match wins. Climax is never chosen: that is the user's call. summary.knot is NOT a rule: describe sets it
 *  for anatomy tags too ('knot', 'knotted_penis'), visible in plenty of ordinary thrusting, and a knotting segment
 *  puts a knot pop on every stroke. Order is by kind, not by the act's score: spitroast (vaginal + fellatio) is oral. */
export const RULES = [
  ['knotting', 'knotting act', (s, a) => any(a, KNOT_ACTS)],
  ['oral', 'oral act', (s, a) => any(a, ORAL)],
  ['penetration', 'penetration act', (s, a) => any(a, PENETRATION)],
  ['custom', 'stroking act', (s, a) => any(a, STROKING)],
  ['foreplay', 'kissing / licking / grinding', (s, a) => any(a, LIGHT)],
  ['foreplay', 'not explicit, someone in frame', (s, a) => !a.length && s.rating !== 'explicit' && someone(s)],
  ['custom', 'explicit, no known act', (s, a) => a[0] || (s.rating === 'explicit' && someone(s) && 'unlabelled')],
];
/** The kind for scenes with no describe result: the plain tracked-strokes kind (sidecar span "active"). */
export const MOTION_KIND = 'penetration';

/** describe summary -> {kind, why, name?} or null (no summary, or nothing recognisable in frame: motion decides). */
export function kindForSummary(summary) {
  if (!summary || typeof summary !== 'object') return null;
  const acts = Array.isArray(summary.acts) ? summary.acts : [];
  for (const [kind, why, test] of RULES) {
    const hit = test(summary, acts);
    if (hit) return kind === 'custom' && typeof hit === 'string' ? { kind, why, name: hit.replace(/_/g, ' ') } : { kind, why };
  }
  return null;
}

// ---- scenes -> plan ----------------------------------------------------------------------------------------
// ponytail: "quiet" is a heuristic from what the earlier steps measured (no motion track exists yet): describe saw
// nobody (black / title card), or the loop result says the picture is static (loop.static: true). A loop result
// with no period (kind null, prominence 0) is NOT quiet: loops.py returns that same dict for a static scene, a
// scene under 10 frames and any motion without a clear rhythm (most real footage). Until loops.py reports
// `static`, only describe makes a scene quiet. A motion-energy probe per scene would be the upgrade.
/** Why a scene counts as black / low-motion ('' = it does not). Only asked when describe gave no kind. */
export function quietWhy(scene) {
  const d = scene?.describe?.summary, l = scene?.loop;
  if (d && !(d.acts?.length) && !someone(d) && !(d.species?.length)) return 'nothing in frame';
  if (l?.static === true) return 'no motion';
  return '';
}

/** Scenes [{start_ms, end_ms, describe?, loop?}] -> rows [{t0, t1, kind, why, name?}] (touching equal kinds merged).
 *  A describe kind wins; else quiet scenes at the head and tail -> idle, quiet scenes inside -> offscreen (carry);
 *  else MOTION_KIND. Overlapping scenes are clipped to the previous one. No scenes -> one MOTION_KIND row. */
export function planRows(scenes = [], dur = Infinity) {
  const end = Number.isFinite(dur) ? dur : Math.max(0, ...scenes.map((s) => s.end_ms));
  if (!scenes.length) return end > 0 ? [{ t0: 0, t1: Math.round(end), kind: MOTION_KIND, why: 'no scenes: motion only' }] : [];
  let prev = 0;
  const rows = [...scenes].sort((a, b) => a.start_ms - b.start_ms).map((s) => {
    const k = kindForSummary(s.describe?.summary), t0 = Math.max(prev, Math.round(s.start_ms)), t1 = Math.min(Math.round(end), Math.round(s.end_ms));
    if (t1 > t0) prev = t1;
    return { t0, t1, k, quiet: k ? '' : quietWhy(s) };
  }).filter((r) => r.t1 > r.t0);
  let a = 0, b = rows.length;
  while (a < b && rows[a].quiet) a++;
  while (b > a && rows[b - 1].quiet) b--;
  const out = [];
  rows.forEach((r, i) => {
    const row = r.quiet ? { kind: i < a || i >= b ? 'idle' : 'offscreen', why: r.quiet + (i < a ? ' (head)' : i >= b ? ' (tail)' : ' (inside)') }
      : r.k ? { kind: r.k.kind, why: r.k.why, ...(r.k.name ? { name: r.k.name } : {}) } : { kind: MOTION_KIND, why: 'motion only' };
    const last = out[out.length - 1];
    if (last && last.kind === row.kind && last.name === row.name && last.t1 === r.t0) last.t1 = r.t1;
    else out.push({ t0: r.t0, t1: r.t1, ...row });
  });
  return out;
}
/** planRows -> plan segments (timeline plan.js makeSegment: the kind's default recipe). */
export const planFromScenes = (scenes, { dur, newId }) => planRows(scenes, dur).map((r) => makeSegment({ id: newId(), t0: r.t0, t1: r.t1, kind: r.kind, name: r.name }));

/** "3 penetration, 2 oral, 1 idle" (most first). */
export function kindTally(plan) {
  const n = new Map();
  for (const s of plan) n.set(s.kind, (n.get(s.kind) || 0) + 1);
  return [...n].sort((x, y) => y[1] - x[1]).map(([k, c]) => `${c} ${k}`).join(', ');
}

// ---- base tracking without a region ------------------------------------------------------------------------
/** Whole frame as a box ROI (every real tracker needs a box or points). */
export const WHOLE_FRAME = Object.freeze({ kind: 'box', x: 0, y: 0, w: 1, h: 1 });
/** A tracker that runs with no user region: one with roi 'none' (fake.none), else lk_box (or any box tracker) on
 *  the whole frame. -> {tracker, name, roi} | null. */
export function pickTracker(trackers = []) {
  const none = trackers.find((t) => t.roi === 'none');
  if (none) return { tracker: none.id, name: none.name, roi: null };
  const box = trackers.find((t) => t.id === 'lk_box') || trackers.find((t) => t.roi === 'box' || t.roi === 'box_or_points');
  return box ? { tracker: box.id, name: box.name, roi: { ...WHOLE_FRAME } } : null;
}

// ---- step state machine ------------------------------------------------------------------------------------
// step = {id, status: 'idle'|'running'|'done'|'skipped'|'failed', note, ms, stale, user, progress, facts, entry}
//   user: skipped by the user (Run all leaves it skipped)   stale: done, but an earlier step ran again since
//   entry: id of the undo entry the step made (not persisted: history starts empty on open)
export const initSteps = (list = STEPS) => list.map((s) => ({ id: s.id, status: 'idle', note: '', ms: 0, stale: false, user: false, progress: null, facts: null }));
export const firstLine = (e) => String(e?.message ?? e ?? '').split(/\r?\n/)[0].slice(0, 200);

/** One transition, returns a new list. ev.type: start | progress | done | skip | fail | cancel | reset. */
export function stepEvent(steps, i, ev) {
  if (!steps[i]) return steps;
  const s = steps[i];
  let next;
  switch (ev.type) {
    case 'start': next = { ...s, status: 'running', note: '', ms: 0, stale: false, user: false, progress: null }; break;
    case 'progress': if (s.status !== 'running') return steps; next = { ...s, progress: { done: ev.done, total: ev.total, label: ev.label || '' } }; break;
    case 'done': next = { ...s, status: 'done', note: ev.note || '', ms: ev.ms || 0, progress: null, facts: ev.facts ?? null, entry: ev.entry ?? null }; break;
    case 'skip': next = { ...s, status: 'skipped', note: ev.reason || '', ms: ev.ms || 0, user: !!ev.user, stale: false, progress: null, facts: null }; break;
    case 'fail': next = { ...s, status: 'failed', note: firstLine(ev.error) || 'failed', ms: ev.ms || 0, progress: null }; break;
    case 'cancel': next = { ...s, status: 'idle', note: ev.note || 'Cancelled', ms: ev.ms || 0, progress: null }; break;
    case 'reset': next = { ...s, status: 'idle', note: '', ms: 0, stale: false, user: false, progress: null, facts: null }; break;
    default: return steps;
  }
  const out = steps.map((x, k) => (k === i ? next : x));
  // a step that (re)did its work -- or wrote part of it before a cancel / failure -- outdates the finished steps after it
  if (ev.type === 'done' || (ev.type === 'skip' && !ev.user) || ev.wrote) for (let k = i + 1; k < out.length; k++) if (out[k].status === 'done') out[k] = { ...out[k], stale: true };
  return out;
}

/** The steps as the document stands: the first done step whose undo entry is no longer applied (live(id) false), or
 *  whose result is gone (gone(step) true: the track step's ghost), is marked undone, it and the done steps after it
 *  stale. Returns the same list when nothing changed. */
export function withDoc(steps, { live = () => true, gone = () => false } = {}) {
  const i = steps.findIndex((s) => s.status === 'done' && !s.stale && ((s.entry && !live(s.entry)) || gone(s)));
  if (i < 0) return steps;
  return steps.map((s, k) => (k < i || s.status !== 'done' ? s : { ...s, stale: true, undone: k === i }));
}

/** Indices Run all should run, in order: everything not done (or done but stale), except user skips. When
 *  nothing is left, a full re-run (still without the user skips). */
export function pending(steps) {
  const want = steps.map((s, i) => (s.status === 'skipped' && s.user) || (s.status === 'done' && !s.stale) ? -1 : i).filter((i) => i >= 0);
  return want.length ? want : steps.map((s, i) => (s.status === 'skipped' && s.user ? -1 : i)).filter((i) => i >= 0);
}
export const isComplete = (steps) => steps.every((s) => (s.status === 'done' && !s.stale) || s.status === 'skipped');
/** A restored block: 'running' became 'idle' (the run was interrupted), unknown ids dropped, missing ones idle. */
export function restoreSteps(saved, list = STEPS) {
  const by = new Map((Array.isArray(saved) ? saved : []).filter((s) => s && typeof s.id === 'string').map((s) => [s.id, s]));
  return initSteps(list).map((s) => {
    const v = by.get(s.id);
    if (!v || !['idle', 'running', 'done', 'skipped', 'failed'].includes(v.status)) return s;
    const status = v.status === 'running' ? 'idle' : v.status;
    return { ...s, status, note: v.status === 'running' ? 'Interrupted' : String(v.note || ''), ms: +v.ms || 0, stale: !!v.stale, user: !!v.user, facts: v.facts ?? null };
  });
}
export const saveSteps = (steps) => steps.map(({ id, status, note, ms, stale, user, facts }) => ({ id, status, note, ms, stale, user, facts }));

// ---- formatting ----------------------------------------------------------------------------------------------
export const plural = (n, w) => `${fmtCount(n)} ${w}${n === 1 ? '' : 's'}`;
/** 1847 -> "1 847" (narrow no-break space). */
export const fmtCount = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export function fmtMs(ms) {
  if (!(ms > 0)) return '';
  if (ms < 1000) return Math.round(ms) + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}
/** facts by step id -> "12 scenes · 2 exact loops · plan 9 segments · 1 847 points · 14 questions waiting".
 *  A part is left out when its step did not produce it. */
export function summaryLine(f = {}) {
  const out = [];
  if (f.scenes) out.push(plural(f.scenes.scenes, 'scene'));
  if (f.loops) out.push(plural(f.loops.exact, 'exact loop'));
  if (f.plan) out.push('plan ' + plural(f.plan.segments, 'segment'));
  if (f.generate) out.push(plural(f.generate.points, 'point'));
  if (f.assist) out.push(f.assist.questions ? `${plural(f.assist.questions, 'question')} waiting` : 'no questions waiting');
  return out.join(' · ') || 'Nothing done yet';
}
/** Steps -> {id: facts} of the steps whose result still stands (done, not stale). */
export const factsOf = (steps) => Object.fromEntries(steps.filter((s) => s.status === 'done' && !s.stale && s.facts).map((s) => [s.id, s.facts]));
