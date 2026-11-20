// cum.svelte.js -- "detect cumshots" (lib/cum.js; sidecar `cum`): the job, the proposals kept on the scene
// (scene.cum [{t, score}], saved with the project, outside undo like describe's tags), placing them as an orgasm's
// markers (one undo step through commands-fx commitFx; paw-d1g7) and the ghost diamonds the Modifiers row draws (FxLane:
// drawCum / cumTip / CumBar).
import { scenesOf, newId, durOf } from './state.svelte.js';
import { sceneIndexAt, sceneAtPlayhead } from './scenes.js';
import { modAt, modOver, spansOf, spurtHint, makeMod } from './mods.js';
import { addFx } from './fx-edit.js';
import { commitFx, ballsSpurts } from './commands-fx.js';
import { ballsRun } from './balls.js';
import { cumGroups } from '../tracking/groups.js';
import { sceneRange } from './shots.js';
import { trackingOf } from './deps.js';
import { X } from './draw.js';
import { cumRequest } from '../../lib/protocol.js';
import { cumProposals, cumShown, cumPlacement, cumThreshold, cumTipText, CUM_STRONG, pulsePlan, planText, pulseChannels } from '../../lib/cum.js';

export const cumUi = $state({ hideWeak: false, busy: '' });   // busy = the span key of the running job

const key = (s) => `${s.t0}-${s.t1}`;
const frameOf = (app) => Math.max(1, Math.round(app.player.frameMs) || 1);
const DESCRIBE_TIMEOUT_S = 180;

/** Where detect runs: args {index} (a scene), args {t0, t1}, else the selected range, else the orgasm span at the
 *  playhead (timeline/mods.js), else the shot at the playhead. */
export function cumSpan(app, args) {
  const l = scenesOf(app);
  if (Number.isInteger(args?.index) && l[args.index]) return { t0: l[args.index].start_ms, t1: l[args.index].end_ms };
  if (args?.t1 > args?.t0) return { t0: Math.round(args.t0), t1: Math.round(args.t1) };
  const r = app.doc.range;
  if (r && r.t1 > r.t0) return { t0: Math.round(r.t0), t1: Math.round(r.t1) };
  const o = modAt(app.doc.fx, app.player.timeMs, 'orgasm');   // the Orgasm modifier under the playhead, else its shot
  if (o) return { t0: o.t0, t1: o.t1 };
  const s = l[sceneAtPlayhead(l, app.player)];
  return s ? { t0: s.start_ms, t1: s.end_ms } : null;
}
/** The shot at the playhead when an Orgasm modifier meets it or it holds proposals (the Modifiers row's button), else null. -> {i, scene}. */
export function cumScene(app, t = app.player.timeMs) {
  const l = scenesOf(app), i = sceneIndexAt(l, t), s = l[i];
  return s && (s.cum?.length || modOver(app.doc.fx, 'orgasm', s.start_ms, s.end_ms)) ? { i, scene: s } : null;
}
/** The doc scenes with the proposals of [t0, t1) replaced by `list` (each scene keeps its own, sorted). */
function withCum(scenes, { t0, t1 }, list) {
  return scenes.map((s) => {
    if (s.end_ms <= t0 || s.start_ms >= t1) return s;
    const keep = (s.cum || []).filter((p) => p.t < t0 || p.t >= t1), add = list.filter((p) => p.t >= s.start_ms && p.t < s.end_ms);
    const cum = [...keep, ...add].sort((a, b) => a.t - b.t);
    if (cum.length) return { ...s, cum };
    const { cum: _, ...rest } = s;   // eslint-disable-line no-unused-vars
    return rest;
  });
}

/** Can detect run on args (cumSpan) now? -> {enabled, reason, short} (reason: the palette's / button's why). */
export function cumWhy(app, args) {
  const tr = trackingOf(app), span = cumSpan(app, args);
  const off = (reason, short) => ({ enabled: false, reason, short });
  if (!tr?.videoPath) return off('open a video first', 'no video');
  if (!tr.describeParams) return off('it needs the shot tagger (the describe extra and a CUDA GPU)', 'no tagger');
  if (cumUi.busy) return off('a detection is running', 'running');
  if (!span) return off('select a range or detect scenes first', 'no scene');
  if (!(app.doc.scenes || []).some((s) => s.end_ms > span.t0 && s.start_ms < span.t1)) return off('detect scenes first (the proposals are kept on the scene)', 'no scenes');
  return { enabled: true, reason: '', short: '' };
}

/** What detect uses on args' span (paw-ol3): the scene there, its groups for the request (groups.js cumGroups: the pulse
 *  ones tracked with SAM over its orgasm span), the run's balls pulses, and the plan (lib/cum pulsePlan: what it uses,
 *  how many seconds SAM tracks). -> {span, scene, groups, balls, plan, text} | null. */
export function cumUses(app, args) {
  const span = cumSpan(app, args);
  if (!span) return null;
  const l = scenesOf(app), i = sceneIndexAt(l, (span.t0 + span.t1) / 2), s = l[i] || null, r = s ? sceneRange(l, i) : null;
  const groups = cumGroups(r ? l.slice(r[0], r[1] + 1) : []), balls = ballsSpurts(app, (span.t0 + span.t1) / 2);
  // the Orgasm modifiers (mods.js spansOf) that meet the span: SAM runs over their hull
  // ponytail: one hull; per-span pulse ranges if a scene ever holds orgasms far apart
  const os = spansOf(app.doc.fx, 'orgasm').filter(([a, b]) => b > span.t0 && a < span.t1), orgasm = os.length ? { t0: os[0][0], t1: os[os.length - 1][1] } : null;
  const plan = pulsePlan(groups, span, orgasm, balls?.times?.length ? balls.ch : '');
  return { span, scene: s, groups, balls, plan, text: planText(plan) };
}

/** Run the detector over a span (cumSpan); a balls contraction channel of a tracker run there is sent as `pulses`, the
 *  scene's pulse groups as `groups` (v4.16); their contraction signals land on the run under the scene as channels
 *  sem_<name>_pulse (viewable as a lane). */
export async function detectCum(app, args) {
  const tr = trackingOf(app), w = cumWhy(app, args);
  if (!w.enabled) return app.toast(`Detect cumshots: ${w.reason}`, 'quiet');
  const u = cumUses(app, args), span = u.span;
  const pulses = (u.balls?.times || []).filter((t) => t >= span.t0 && t < span.t1), path = tr.videoPath;
  cumUi.busy = key(span);
  app.usage?.note?.('timeline:cum.detect', { groups: u.groups.filter((g) => g.pulse).length, samS: Math.round(u.plan.samS) });
  try {
    const r = await tr.job('cum', cumRequest(path, span.t0, span.t1, {}, pulses, u.groups, u.plan.range), { title: 'Detecting cumshots', range: span,
      timeoutMs: 1000 * (+app.settings?.get?.('tracking.describeTimeoutS', DESCRIBE_TIMEOUT_S) || DESCRIBE_TIMEOUT_S) });
    if (r.cancelled) return app.toast('Detect cumshots canceled', 'quiet');
    if (r.error) return app.toast(`Detect cumshots failed: ${String(r.error).split(/\r?\n/)[0]}`, 'error');
    if (tr.videoPath !== path) return;
    const list = cumProposals(r.result, span, frameOf(app)), strong = list.filter((p) => p.score >= CUM_STRONG).length;
    app.doc.scenes = withCum(app.doc.scenes || [], span, list);
    const shown = pulseLane(app, tr, span, r.result), fell = (r.result?.pulse || []).filter((p) => p.source !== 'sam').map((p) => p.label);
    const extra = [pulses.length && `${pulses.length} balls pulses used`, (r.result?.pulse || []).length && `${(r.result.pulse).map((p) => `${p.label} ${p.events?.length || 0} contractions`).join(', ')}`,
      fell.length && `no SAM for ${fell.join(', ')}: points fallback`, shown === false && 'no run here to show the pulse lane on'].filter(Boolean).join(', ');
    app.toast(list.length ? `${list.length} proposed cumshot${list.length === 1 ? '' : 's'} (${strong} strong${extra ? `; ${extra}` : ''}): check them on the Modifiers row, then place spurts` : `No cumshots found in this range${extra ? ` (${extra})` : ''}`, list.length ? 'info' : 'quiet');
  } finally { cumUi.busy = ''; }
}

/** The result's pulse signals (sem_<name>_pulse) put on the tracker run under the span as channels, so the owner can pick
 *  them as a lane and see the contractions against the video. -> true | false (no run there) | null (no pulse groups). */
function pulseLane(app, tr, span, result) {
  const ch = pulseChannels(result);
  if (!Object.keys(ch).length) return null;
  const at = ballsRun(app, (span.t0 + span.t1) / 2, (id) => tr.run?.(id), scenesOf(app));
  if (!at?.run || !tr.patchRun) return false;
  tr.patchRun(at.run.id, { channels: { ...(at.run.channels || {}), ...ch } });
  return true;
}

/** The proposals of scene i still to place (shown at the threshold, no spurt on their frame yet). */
export function cumPending(app, i) {
  const s = scenesOf(app)[i];
  if (!s?.cum?.length) return [];
  const snap = (t) => (app.player.snap ? app.player.snap(t) : t);
  const todo = new Set(cumPlacement(app.doc.fx || [], s.cum, { threshold: cumThreshold(cumUi.hideWeak), frameMs: frameOf(app), snap }).map((e) => e.t0));
  return cumShown(s.cum, cumThreshold(cumUi.hideWeak)).filter((p) => todo.has(Math.round(snap(p.t))));
}

/** Place the scene's shown proposals as markers of an orgasm (paw-d1g7): one undo step; frames that have a spurt are
 *  skipped; each marker's velocity from its score (lib/cum velOfScore); one outside every orgasm grows the nearest one in
 *  its scene to it, else an orgasm is marked around it (mods.js spurtHint). -> placed count. */
export function placeCum(app, i) {
  const s = scenesOf(app)[i];
  if (!s?.cum?.length) return 0;
  const snap = (t) => (app.player.snap ? app.player.snap(t) : t);
  const add = cumPlacement(app.doc.fx || [], s.cum, { threshold: cumThreshold(cumUi.hideWeak), frameMs: frameOf(app), snap });
  if (!add.length) { app.toast('Spurts are already on those frames', 'quiet'); return 0; }
  let list = app.doc.fx || [];
  for (const e of add) {
    const h = spurtHint(list, scenesOf(app), e.t0);
    if (h) list = (h.grow ? list.map((x) => (x.id === h.grow.id ? { ...x, t0: h.t0, t1: h.t1 } : x)) : [...list, makeMod(newId('fx'), 'orgasm', h.t0, h.t1)]).sort((a, b) => a.t0 - b.t0);
    const id = newId('fx');
    list = addFx(list, { id, kind: 'spurt', t0: e.t0, t1: e.t0, dur: durOf(app) }).map((x) => (x.id === id ? { ...x, params: { vel: e.vel } } : x));
  }
  commitFx(app, `Add ${add.length} spurt${add.length === 1 ? '' : 's'} (proposed cumshots)`, list);
  app.usage?.note?.('timeline:cum.place', add.length);
  return add.length;
}
/** Drop scene i's proposals (the placed spurts stay). */
export function clearCum(app, i) {
  const s = scenesOf(app)[i];
  if (s) app.doc.scenes = withCum(app.doc.scenes || [], { t0: s.start_ms, t1: s.end_ms }, []);
}

/** Ghost diamonds of the scene at the playhead's pending proposals on the Modifiers row: strong solid, weak hollow. */
export function drawCum(ctx, app, w, h, color) {
  const c = cumScene(app);
  if (!c) return;
  const cy = h / 2, r = Math.max(3, Math.min(6, h / 2 - 1)), v = app.view;
  ctx.save();
  ctx.globalAlpha = 0.75; ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = 1.25;
  for (const p of cumPending(app, c.i)) {
    const x = X(v, w, p.t);
    if (x < -6 || x > w + 6) continue;
    ctx.beginPath(); ctx.moveTo(x, cy - r); ctx.lineTo(x + r, cy); ctx.lineTo(x, cy + r); ctx.lineTo(x - r, cy); ctx.closePath();
    if (p.score >= CUM_STRONG) ctx.fill(); else { ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]); }
  }
  ctx.restore();
}
/** Hover text of the proposal under x (within 5 px), or null. */
export function cumTip(app, x, w) {
  const c = cumScene(app);
  const p = c && cumPending(app, c.i).find((q) => Math.abs(X(app.view, w, q.t) - x) <= 5);
  return p ? cumTipText(p) : null;
}
