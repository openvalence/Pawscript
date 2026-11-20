// balls.js -- is the "balls contraction peaks -> place spurts" suggestion on at t, and if not, why (the Modifiers row, the
// scene's right-click menu and the palette all say the same). Pure: no runes, no deps.js; the caller passes the run
// lookup (tracking store run(id)) and the scenes.
import { sceneIndexAt } from './scenes.js';
import { trackerRuns, chooseRun } from './generate-logic.js';
import { ballsScale, groupPresence } from '../../lib/runs-channel.js';
import { sceneAt } from '../../lib/runs.js';

/** The pinned balls group must be seen on at least this share of the scene's frames (sem_balls_n > 0).
 *  ponytail: one fixed floor; tune it on real runs if good scenes get refused. */
export const MIN_BALLS = 0.25;

/** The tracker run under the scene at t (the visible run covering most of it, generate-logic chooseRun) and the run's own
 *  scene there. -> {run, k, t0, t1} | null (no run, or a run without scenes). */
export function ballsRun(app, t, runOf, scenes = app?.doc?.scenes || []) {
  const s = scenes[sceneIndexAt(scenes, t)], axis = app?.doc?.activeAxis ?? 'stroke', ghosts = app?.doc?.ghosts || [];
  const span = s ? { t0: s.start_ms, t1: s.end_ms } : { t0: t, t1: t + 1 };
  const g = chooseRun(span, trackerRuns(ghosts, axis), trackerRuns(ghosts, axis, true));
  const run = g && runOf?.(g.id);
  if (!run?.scenes?.length) return null;
  const k = Math.max(0, sceneAt(run.scenes, s ? (span.t0 + span.t1) / 2 : t)), rs = run.scenes[k];
  return { run, k, t0: s ? Math.max(span.t0, rs.start_ms) : rs.start_ms, t1: s ? Math.min(span.t1, rs.end_ms ?? Infinity) : rs.end_ms ?? Infinity };
}

/** Did the sidecar that made the run know the pinned groups (PROTOCOL v4.6)? Any sem_* channel or scene group, or a
 *  `primary` note whose seed record has v4.6's `layout`. */
const seededRun = (run) => Object.keys(run.channels || {}).some((c) => c.startsWith('sem_'))
  || (run.scenes || []).some((s) => Object.keys(s?.groups || {}).some((g) => g.startsWith('sem_')))
  || (run.notes || []).some((n) => n?.data?.seed?.layout != null);

const off = (reason, short) => ({ enabled: false, reason, short });
const CHAR_BALLS = /^sem_c[12]_balls\d*_scale$/;
/** Run scene k's balls contraction channel over [t0, t1): runs-channel ballsScale (the plain pinned group, else a part
 *  named balls), else a character's balls group (paw-x99, PROTOCOL v4.12: sem_c1_balls_scale, sem_c2_balls_scale): the
 *  one present on most of the span; '' when there is none. */
export function ballsChannel(run, k, t0 = -Infinity, t1 = Infinity) {
  const ch = ballsScale(run, k);
  if (ch) return ch;
  const seen = Object.keys(run?.channels || {}).filter((c) => CHAR_BALLS.test(c)).map((c) => [c, groupPresence(run, c.slice(0, -6), t0, t1)]).filter(([, p]) => p > 0);
  return seen.sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
/**
 * The balls suggestion at t: {enabled, reason, short, ch?, at?}. On: the run's balls contraction channel in the scene
 * (runs-channel ballsScale) and, for the pinned group, seen on >= MIN_BALLS of its frames; ch / at = the channel and
 * ballsRun's result. Off: reason (tip, status line, menu) and short (the row's inline hint).
 */
export function ballsReason(app, t, { runOf = (id) => app?.tracking?.run?.(id), scenes } = {}) {
  const at = ballsRun(app, t, runOf, scenes);
  if (!at) return off('no run under this scene', 'no run');
  const { run, k, t0, t1 } = at, ch = ballsChannel(run, k, t0, t1), key = /^sem_.+_scale$/.test(ch) ? ch.slice(0, -6) : 'sem_balls';
  const p = run.channels?.[key + '_n']?.v ? groupPresence(run, key, t0, t1) : null;
  if (ch && (!ch.startsWith('sem_') || p == null || p >= MIN_BALLS)) return { enabled: true, reason: '', short: '', ch, at };
  if (p > 0) return off(`balls seen on ${Math.round(p * 100)} % of frames only`, `balls ${Math.round(p * 100)} %`);
  if (!seededRun(run)) return off('run predates seeded groups (PROTOCOL < 4.6): re-track with the current sidecar', 'old run');
  if (run.channels?.sem_balls_n || Object.keys(run.channels || {}).some((c) => /^sem_c[12]_balls\d*_n$/.test(c))) return off('no balls in this scene (the tagger found none on its seed frame): place spurts with U', 'no balls here');
  return off('no balls group in this run: re-track with the current sidecar (seeded groups)', 'no balls group');
}
