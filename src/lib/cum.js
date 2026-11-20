// cum.js -- cumshot proposals (sidecar command `cum`, trackers/pawtrack/cum.py): proposed spurt times per scene, kept on
// the scene as scene.cum [{t, score, why?}] and placed only when the owner says so (one undo step). Pure, no app state.
// v4.16 (paw-ol3): the scene's pulse groups (an anus painted with Groups, ...) go along; the sidecar tracks them with SAM
// over the orgasm span and each contraction is a cue; `why` = a proposal's evidence, strongest first.

import { whoName, legacyWho } from '../features/tracking/groups.js';

/** A proposal at or above this score is strong (solid ghost diamond); below it is weak (hollow). */
export const CUM_STRONG = 0.5;
/** The threshold of "hide weak": only strong proposals stay shown. */
export const cumThreshold = (hideWeak) => (hideWeak ? CUM_STRONG : 0);

const spanOf = (s) => ({ t0: s?.t0 ?? s?.start_ms ?? -Infinity, t1: s?.t1 ?? s?.end_ms ?? Infinity });

/**
 * The sidecar's `cum` result -> the proposals [{t, score}] inside the scene (start_ms / end_ms, or t0 / t1; end
 * exclusive), sorted by t, t rounded to ms and score to 3 decimals; two within one frame (frameMs) keep the higher.
 */
export function cumProposals(result, scene, frameMs = 1) {
  const { t0, t1 } = spanOf(scene), fr = Math.max(1, frameMs || 1), out = [];
  const list = (result?.spurts || []).filter((s) => Number.isFinite(s?.t_ms) && Number.isFinite(s?.score) && s.t_ms >= t0 && s.t_ms < t1)
    .map((s) => ({ t: Math.round(s.t_ms), score: Math.round(Math.max(0, Math.min(1, s.score)) * 1000) / 1000, ...(whyOf(s.why) ? { why: whyOf(s.why) } : {}) }))
    .sort((a, b) => a.t - b.t);
  for (const p of list) {
    const last = out[out.length - 1];
    if (last && p.t - last.t < fr) { if (p.score > last.score) out[out.length - 1] = p; } else out.push(p);
  }
  return out;
}

/** A result's `why` kept: [{cue, score?}] with a string cue, score rounded to 2 decimals; null when there is none. */
function whyOf(w) {
  const l = (Array.isArray(w) ? w : []).filter((x) => typeof x?.cue === 'string' && x.cue)
    .map((x) => (Number.isFinite(x.score) ? { cue: x.cue, score: Math.round(x.score * 100) / 100 } : { cue: x.cue }));
  return l.length ? l : null;
}

/** pawtrack/pulse.py MARGIN_MS: the pulse groups are tracked over the orgasm span +- this. */
export const PULSE_MARGIN_MS = 1000;
const who = (w) => (w ? ` (${whoName(w)})` : '');
/** 'sem_c1_balls_scale' -> 'balls (Bottom)', 'sem_balls_scale' -> 'balls'. */
const ballsName = (ch) => { const m = /^sem_(c[12]|x)_/.exec(ch || ''); return 'balls' + who(m?.[1]); };
/**
 * What detect will use on a scene: groups = cumGroups(scene) (groups.js; no pulse group in it = nothing tracked), span =
 * the detect span {t0, t1}, orgasm = the scene's orgasm tag span {t0, t1} | null, ballsCh = the run's balls channel
 * there ('' = none). -> {range: [a, b] the pulse_range to send (the orgasm span inside the detect span, else the detect
 * span) | null without a pulse group, uses: ['anus (Top)', 'balls (Bottom)'], samS: seconds of video SAM tracks (each pulse
 * group over the range +- PULSE_MARGIN_MS)}.
 */
export function pulsePlan(groups, span, orgasm = null, ballsCh = '') {
  const pg = (groups || []).filter((g) => g.pulse), uses = pg.map((g) => `${g.part || g.name}${who(g.who)}`);
  if (ballsCh && !uses.some((u) => u.startsWith('balls'))) uses.push(ballsName(ballsCh));
  let r = [span.t0, span.t1];
  if (orgasm && Math.min(span.t1, orgasm.t1) > Math.max(span.t0, orgasm.t0)) r = [Math.max(span.t0, orgasm.t0), Math.min(span.t1, orgasm.t1)];
  const a = Math.max(0, r[0] - PULSE_MARGIN_MS), b = r[1] + PULSE_MARGIN_MS;   // the margin may reach past the span (pulse.py)
  return { range: pg.length ? r.map(Math.round) : null, uses, samS: pg.length ? (pg.length * (b - a)) / 1000 : 0 };
}
/** pulsePlan as one line: 'uses anus (Top), balls (Bottom) · SAM on 14 s'; '' when it uses no contraction cue. */
export const planText = (p) => (p?.uses?.length ? `uses ${p.uses.join(', ')}${p.samS ? ` · SAM on ${Math.round(p.samS)} s` : ''}` : '');
/** The result's pulse channels (sem_<name>_pulse: [[t, v], ...]) as run channels {name: {t, v, min, max}} (null -> NaN; every
 *  run channel carries its range: the panel's lane picker and the .pawruns read it; no finite value: 0 / 0, paw-wzxu). */
export function pulseChannels(result) {
  const out = {};
  for (const [k, rows] of Object.entries(result?.channels || {})) {
    if (!/^sem_[a-z0-9_]+_pulse$/.test(k) || !Array.isArray(rows)) continue;
    const v = rows.map((r) => (Number.isFinite(r[1]) ? r[1] : NaN)), fin = v.filter(Number.isFinite);
    out[k] = { t: rows.map((r) => r[0]), v, min: fin.length ? Math.min(...fin) : 0, max: fin.length ? Math.max(...fin) : 0 };
  }
  return out;
}

/** Proposals shown at a threshold (score >= threshold). */
export const cumShown = (list, threshold = 0) => (list || []).filter((p) => p.score >= threshold);

/** paw-d1g7: a placed proposal's marker velocity from its score (0.5 at score 0, 1 at 0.5 = strong, 1.5 at 1). */
export const velOfScore = (score) => Math.round(Math.min(1.5, Math.max(0.5, 0.5 + (Number(score) || 0))) * 20) / 20;

/**
 * What placing the proposals adds: one marker per shown proposal (score >= threshold) on its frame (snap), except where
 * a spurt already sits within a frame (or one placed earlier in this call), its velocity from its score (velOfScore;
 * paw-d1g7: the orgasm around it holds the spurt shape). -> [{t0, vel}] in time order.
 */
export function cumPlacement(fx, list, { threshold = 0, frameMs = 1, snap = (t) => t } = {}) {
  const fr = Math.max(1, frameMs || 1), taken = (fx || []).filter((e) => e.kind === 'spurt').map((e) => e.t0);
  const out = [];
  for (const p of cumShown(list, threshold)) {
    const t = Math.round(snap(p.t));
    if (taken.some((x) => Math.abs(x - t) < fr)) continue;
    taken.push(t);
    out.push({ t0: t, vel: velOfScore(p.score) });
  }
  return out;
}

const CUE = { tag: 'spurt tags', cam: 'cum on screen', fluid: 'new fluid', 'balls pulse': 'balls pulse (tracker run)' };
/** A cue as people read it: 'tag' -> 'spurt tags', 'anus (Top)' -> 'anus (Top) contraction' (a stored cue 'anus (C2)' reads the same: legacyWho). */
export const cueText = (c) => CUE[c] || `${legacyWho(c)} contraction`;
/** The hover text of a proposal: its score, whether it is strong, and its evidence (why) when it has one. */
export const cumTipText = (p) => `Proposed cumshot · score ${p.score.toFixed(2)} (${p.score >= CUM_STRONG ? 'strong' : 'weak'})`
  + (p.why?.length ? `\nevidence: ${p.why.map((w) => cueText(w.cue) + (Number.isFinite(w.score) ? ' ' + w.score.toFixed(2) : '')).join(' · ')}` : '')
  + '\nnot placed yet: "place" on the Modifiers row puts a spurt on each shown one';
