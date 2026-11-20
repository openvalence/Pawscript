// rules.js -- the rules brain: pure JS over the fact sheet, one function per decision kind (DESIGN §4.2). Each rule
// names the trace-2 decision it reproduces. Synchronous; no app, no Svelte (runs in the browser and under node).
// Thresholds are starting points; trackers/eval fits them and the calibration table maps raw -> conf.
import { RULES, kindForSummary, MOTION_KIND } from '../../draft/logic.js';
import { RECIPES, KINDS as GEN_KINDS, CLIMAX_FIT } from '../../../lib/gen/recipes.js';
import { ACTIVE, KINDS, channelOk, probeId, storyDefault, clock } from '../../../lib/director/decisions.js';
import { STORY_NAMES, buildStory, energyPerStep, logSoftmax, median, quantile, stepsOf, STEP_MS } from '../../../lib/director/story.js';
import { REDO_OF } from '../../../lib/director/checks.js';

const r2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ALL_VALID = ['single', 'relative', 'rate'];
const someone = (d) => d?.count && d.count !== 'unknown';

/** describe facts -> draft RULES verdict {kind, why} | null. */
const tagRule = (d) => (d ? kindForSummary({ acts: d.acts ?? [], count: d.count, rating: d.rating }) : null);
/** describe facts -> plan kind via draft's RULES table (null = nothing recognisable). */
export const tagKind = (d) => tagRule(d)?.kind ?? null;
/** The two RULES rows that fire without any act tag: weak evidence. */
const WEAK = new Set(['not explicit, someone in frame', 'explicit, no known act']);
const strongAct = (d) => { const r = tagRule(d); return !!r && !WEAK.has(r.why) && ACTIVE.has(r.kind); };
storyDefault.kindOf = (scene) => { const d = scene?.describe; return tagKind(d) ?? (d && !d.acts?.length && !someone(d) ? 'idle' : MOTION_KIND); };

// ---------------------------------------------------------------- camera (trace 2: s0 static, s1 rides, s2 move, s3 sway)
export function camera(req) {
  const sc = req.facts?.scene, c = sc?.camera;
  if (!c) return { abstain: 'no motion.stats for this scene' };
  const loopHz = sc.loop?.periodMs > 0 && sc.loop.prominence >= 0.3 ? 1000 / sc.loop.periodMs : null, lock = c.strokeLock;
  const longest = Math.max(0, ...(c.moveSpans ?? []).map(([a, b]) => b - a));
  let mode, raw, why;
  if (c.p95Px < 2) { mode = 'static'; raw = 0.95 - 0.1 * c.p95Px; why = `global motion p95 ${c.p95Px} px < 2 px`; }
  else if (Math.abs(c.zoomPct ?? 0) > 3 || longest >= 3000) {
    mode = 'move'; raw = 0.7 + 0.2 * Math.min(1, Math.max(longest / 10000, Math.abs(c.zoomPct ?? 0) / 10));
    why = `zoom ${c.zoomPct}% / translation for ${(longest / 1000).toFixed(1)} s`;
  } else if (lock && lock.cv < 0.25 && (loopHz == null || Math.abs(lock.rateHz - loopHz) / loopHz <= 0.15)) {
    mode = 'rides'; raw = 0.7 + (loopHz ? 0.15 : 0) + 0.1 * (1 - lock.cv / 0.25);
    why = `frame moves ${c.p95Px} px periodically at ${lock.rateHz} Hz (cv ${lock.cv})${loopHz ? `, loop ${r2(loopHz)} Hz` : ''}`;
  } else if (c.mode === 'sway') { mode = 'sway'; raw = 0.75; why = 'motion.stats: tiles share their turns with the global motion'; }
  else { mode = c.mode === 'static' ? 'sway' : c.mode; raw = 0.5; why = `p95 ${c.p95Px} px with no clear pattern`; }
  if (mode !== c.mode) raw -= 0.1;
  return {
    value: { mode, p95Px: c.p95Px, rateHz: lock?.rateHz ?? c.rateHz ?? null, phaseMs: lock?.phaseMs ?? c.phaseMs ?? null,
      moveSpans: mode === 'move' ? (c.moveSpans ?? []).map(([a, b]) => [Math.max(a, req.scope.t0), Math.min(b, req.scope.t1)]).filter(([a, b]) => b > a) : [],
      valid: mode === 'static' ? ALL_VALID : ['relative', 'rate'] },
    raw: r2(clamp(raw, 0, 1)), rationale: `${mode}: ${why}${mode === 'static' ? '' : '; only camera-invariant (relative) channels and rate stay valid'}`,
  };
}

// ---------------------------------------------------------------- climax (trace 2: first spurt 0.6 s after the cut at 56.2 s)
const series = (scenes) => scenes.flatMap((s) => (s.energy?.t ?? []).map((t, i) => [t, s.energy.v[i]])).filter(([, v]) => Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
const meanIn = (E, a, b) => { const v = E.filter(([t]) => t >= a && t < b).map(([, x]) => x); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };

export function climax(req) {
  const f = req.facts ?? {}, scenes = f.scenes ?? (f.scene ? [f.scene] : []), dur = f.video?.dur ?? req.scope.t1;
  if (!scenes.length) return { abstain: 'no scenes' };
  const E = series(scenes), vMed = median(E.map(([, v]) => v));
  const onsets = scenes.map((s) => s.describe?.cumOnsetMs).filter((t) => Number.isFinite(t) && t >= 0.4 * dur).sort((a, b) => a - b);
  let onset = onsets[0] ?? null, src = 'cum-tag onset', snapped = false;
  if (onset != null) {
    const cut = scenes.map((s) => s.t0).filter((t) => t > 0 && Math.abs(t - onset) <= 1500).sort((a, b) => Math.abs(a - onset) - Math.abs(b - onset))[0];
    if (cut != null) { onset = cut; snapped = true; }
  } else {   // burst then decay in 1 Hz energy, after 40% of the video
    let best = null;
    for (const [t] of E) {
      if (t < 0.4 * dur) continue;
      const hi = meanIn(E, t, t + 5000), lo = meanIn(E, t + 10000, t + 20000), d = hi - (Number.isFinite(lo) ? lo : 0);
      if (hi >= 1.3 * vMed && d > 0 && (!best || d > best.d)) best = { t, d };
    }
    if (best) { onset = best.t; src = 'energy burst then decay'; }
  }
  if (onset == null) {
    const described = scenes.some((s) => s.describe);
    return { value: { window: null, afterglowTo: null }, raw: described ? 0.6 : 0.4, rationale: 'no cum-tag onset after 40% of the video and no energy burst' };
  }
  const cMed = meanIn(E, onset, onset + 6000), m3 = (t) => meanIn(E, t - 1000, t + 2000);
  let t1 = null, ag = null;
  if (cMed > 0) {
    for (let t = onset + 4000; t <= Math.min(dur, onset + 15000); t += 1000) if (m3(t) < 0.6 * cMed) { t1 = t; break; }
    const stills = scenes.flatMap((s) => s.still ?? []).map(([a]) => a), dark = scenes.flatMap((s) => s.seconds ?? []).filter((x) => x.black || x.creditsLike >= 0.5).map((x) => x.t);
    const from = t1 ?? onset + 10000;
    for (let t = from + 1000; t <= Math.min(dur, from + 20000); t += 1000) if (m3(t) < 0.3 * cMed || stills.some((a) => a <= t && a > from) || dark.some((x) => x <= t && x > from)) { ag = t; break; }
  }
  const decay = t1 != null;
  t1 = Math.min(dur, t1 ?? onset + 10000);
  if (ag != null) ag = Math.min(dur, Math.max(ag, t1));
  const raw = src === 'cum-tag onset' ? 0.6 + (decay ? 0.15 : 0) + (snapped ? 0.1 : 0) : 0.45 + (decay ? 0.1 : 0);
  return {
    value: { window: { t0: Math.round(onset), t1: Math.round(t1) }, afterglowTo: ag == null ? null : Math.round(ag) }, raw: r2(raw),
    rationale: `${src} at ${clock(onset)}${snapped ? ' (snapped to the cut)' : ''}; ${decay ? 'energy falls below 60% of the climax level' : 'no energy decay: 10 s window'} at ${clock(t1)}${ag != null ? `, afterglow to ${clock(ag)}` : ''}`,
  };
}

// ---------------------------------------------------------------- story (per-second scores; the VLM adds its own before Viterbi)
const IX = Object.fromEntries(STORY_NAMES.map((k, i) => [k, i]));
const actScene = (s) => strongAct(s.describe);

/** Offscreen stroke rate (turns/s): this scene's stroke-locked wobble, else a sibling scene whose camera rides. */
export function strokeRate(f) {
  const own = f.camera?.rateHz ?? f.scene?.camera?.strokeLock?.rateHz;
  if (own > 0) return r2(2 * own);
  const sib = (f.scenes ?? []).map((s) => s.camera).find((c) => c?.mode === 'rides' && c.strokeLock?.rateHz > 0);
  return sib ? r2(2 * sib.strokeLock.rateHz) : null;
}

/** -> {logp (steps x STORY_NAMES, log-softmax), energy, rate, why[]} or null without a scene. */
export function storyEvidence(req) {
  const f = req.facts ?? {}, sc = f.scene;
  if (!sc) return null;
  const scope = req.scope, n = stepsOf(scope), dur = f.video?.dur ?? scope.t1, scenes = f.scenes ?? [sc];
  const e = energyPerStep(sc, scope);
  const ref = quantile((f.scenes ?? [sc]).flatMap((s) => s.energy?.v ?? []), 0.75);
  const d = sc.describe, tk = tagKind(d), weak = !!tk && !strongAct(d), why = [];
  const groups = d ? new Set(RULES.filter(([k, , t]) => ['knotting', 'oral', 'penetration'].includes(k) && t({ acts: d.acts ?? [], count: d.count, rating: d.rating }, d.acts ?? [])).map(([k]) => k)) : new Set();
  const periodic = sc.loop?.periodMs > 0 && sc.loop.prominence >= 0.3;
  const iAct = scenes.map(actScene), me = scenes.findIndex((s) => s === sc || s.i === sc.i);
  const head = me >= 0 && !iAct.slice(0, me + 1).some(Boolean), tail = me >= 0 && !iAct.slice(me).some(Boolean);
  const inside = me >= 0 && !iAct[me] && !head && !tail;
  const cam = f.camera ?? sc.camera, cl = f.climax;
  const moveFrac = cam?.mode === 'move' ? Math.min(1, (cam.moveSpans ?? []).reduce((s, [a, b]) => s + Math.max(0, Math.min(b, scope.t1) - Math.max(a, scope.t0)), 0) / (scope.t1 - scope.t0)) : 0;
  if (tk) why.push(`tags → ${tk}${weak ? ' (no act tag: weak)' : ''}${groups.size > 1 ? ` (contradicting acts: ${[...groups].join(' + ')})` : ''}`);
  else if (!d) why.push(periodic ? 'no describe; periodic motion' : 'no describe');
  else why.push(inside ? 'nothing recognisable between act scenes → offscreen' : 'nothing recognisable in frame');
  if (moveFrac >= 0.5) why.push('camera moves → offscreen');
  const logp = [];
  for (let s = 0; s < n; s++) {
    const row = new Array(STORY_NAMES.length).fill(0), add = (k, v) => { row[IX[k]] += v; };
    const t = scope.t0 + s * STEP_MS, sx = (sc.seconds ?? []).find((x) => x.t <= t + 500 && t + 500 < x.t + 1000);
    if (tk) { add(tk, weak ? 1 : groups.size > 1 ? 2 : 3.5); if (tk === 'foreplay' && periodic) add('penetration', 1.5); }
    else if (!d) { if (periodic) add('penetration', 2); else if (e[s] >= 0.3 * ref) { add('penetration', 1); add('offscreen', 0.5); } }
    else add(inside ? 'offscreen' : tail ? 'outro' : 'idle', 2);
    if (!sx?.black && (periodic || e[s] >= 0.3 * ref)) for (const k of ACTIVE) add(k, 1);
    if (Number.isFinite(e[s]) && e[s] < 0.15 * ref) add(tail ? 'outro' : 'idle', 1.5);
    if (sx?.black) add(tail ? 'outro' : 'idle', 6);
    if (sx?.creditsLike >= 0.5) add(t >= 0.6 * dur ? 'outro' : 'idle', t >= 0.6 * dur ? 5.5 : 2);
    if ((sc.still ?? []).some(([a, b]) => b - a >= 3000 && a <= t + 500 && t + 500 < b)) add('idle', 3);
    if (moveFrac >= 0.5) add('offscreen', 4);
    if (cl?.window && t + 500 >= cl.window.t0 && t + 500 < cl.window.t1) add('orgasm', 6);   // the decision window is the orgasm
    else if (cl?.window && t + 500 >= cl.window.t0 - CLIMAX_FIT.runInMs && t + 500 < cl.window.t0 && !sx?.black) add('climax', 6);   // the fast run-in before it (fit)
    else if (cl?.window && cl.afterglowTo != null && t + 500 >= cl.window.t1 && t + 500 < cl.afterglowTo) add('afterglow', 5);
    else if (cl?.window && t + 500 >= cl.window.t1 && !strongAct(d) && !(e[s] < 0.15 * ref)) add('afterglow', 2);   // something still moves after the orgasm
    logp.push(logSoftmax(row));
  }
  return { logp, energy: e, rate: strokeRate(f), why };
}

export function story(req) {
  const ev = storyEvidence(req);
  if (!ev) return { abstain: 'no scene facts' };
  const { segments, raw } = buildStory(req, ev.logp, { energy: ev.energy, rate: ev.rate });
  return {
    value: { segments, evidence: { t0: req.scope.t0, stepMs: STEP_MS, names: STORY_NAMES, logp: ev.logp, rate: ev.rate } },
    raw, rationale: `${ev.why.join('; ')} → ${segments.map((s) => `${s.kind}${s.intensity < 1 ? ' ' + s.intensity : ''}`).join(', ')}`,
  };
}

// ---------------------------------------------------------------- roi (trace 2: a background reference every time; clicks on the mover)
const PART = /knot|penis|sheath|balls|testic|pussy|vagina|anus|dildo|toy/i;
/** The lowest-energy tile of the 8x8 heat map's border ring -> Box. */
export function referenceTile(heat) {
  if (!Array.isArray(heat) || heat.length !== 8) return null;
  let best = null;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (r > 0 && r < 7 && c > 0 && c < 7) continue;
    const v = heat[r]?.[c];
    if (Number.isFinite(v) && (!best || v < best.v)) best = { r, c, v };
  }
  return best && { x: best.c / 8, y: best.r / 8, w: 1 / 8, h: 1 / 8 };
}
const inBox = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

export function roi(req) {
  const f = req.facts ?? {}, sc = f.scene, seg = f.segment, { t0, t1 } = req.scope;
  const cam = f.camera ?? { mode: 'static', valid: ALL_VALID }, valid = cam.valid ?? ALL_VALID;
  if (seg && seg.visible === false) return { value: { probes: [], none: 'offscreen' }, raw: 0.8, rationale: 'segment is offscreen: nothing to track' };
  if (seg && !ACTIVE.has(seg.kind)) return { value: { probes: [], none: 'still' }, raw: 0.8, rationale: `segment kind ${seg.kind}: no strokes` };
  const stillMs = (sc?.still ?? []).reduce((s, [a, b]) => s + Math.max(0, Math.min(b, t1) - Math.max(a, t0)), 0);
  if (stillMs >= 0.8 * (t1 - t0)) return { value: { probes: [], none: 'still' }, raw: 0.75, rationale: 'the span is still' };
  const mk = (tracker, roi, params, role, part, channel) => ({ id: probeId({ tracker, roi, params }, t0, t1), tracker, roi, params, role, part, ...(channel ? { channel } : {}) });
  const subj = [], why = [], boxes = sc?.describe?.boxes ?? [];
  const cands = [...(f.candidates ?? [])].filter((c) => (c.camCorr ?? 0) < 0.5).sort((a, b) => b.power - a.power);
  const inFigure = (c) => !boxes.length || boxes.some((b) => inBox(b.box, c.box.x + c.box.w / 2, c.box.y + c.box.h / 2));
  const top = cands.find(inFigure) ?? cands[0];
  for (const c of [top, ...cands.filter((x) => x !== top && inFigure(x))].filter(Boolean).slice(0, 2)) {
    if (valid.includes('single') && c.points?.length) {
      const [x0, y0, x1, y1] = c.axis;
      subj.push(mk('tapnext_points', { kind: 'points', points: c.points }, { primary: 'proj', axis: 'custom', axis_x0: x0, axis_y0: y0, axis_x1: x1, axis_y1: y1 }, 'subject', 'mover', 'proj'));
      why.push(`tapnext proj on the proposed axis (power ${c.power})`);
    }
    if (valid.includes('relative') && c.pair && (!valid.includes('single') || cam.mode === 'rides')) {
      subj.push(mk('tapnext_points', { kind: 'points', points: c.pair }, { primary: 'dist01' }, 'subject', 'pair', 'dist01'));
      why.push('tapnext dist01 on the anti-phase pair (camera-invariant)');
    }
  }
  const part = [...boxes].filter((b) => PART.test(b.tag)).sort((a, b) => b.score - a.score)[0];
  if (part && valid.includes('relative')) { subj.push(mk('sam2_mask', { kind: 'box', ...part.box }, { primary: 'area' }, 'subject', part.tag, 'area')); why.push(`sam2 area on the ${part.tag} box (second opinion)`); }
  if (!cands.length && valid.includes('single')) {
    const act = [...boxes].sort((a, b) => b.score - a.score)[0], box = act ? { kind: 'box', ...act.box } : { kind: 'box', x: 0, y: 0, w: 1, h: 1 };
    subj.push(mk('lk_box', box, { axis: 'auto' }, 'subject', act?.tag ?? 'frame'));
    why.push(`no motion candidate: lk_box on the ${act ? act.tag + ' box' : 'whole frame'}`);
  }
  const probes = subj.slice(0, 3);
  if (!probes.length) return { value: { probes: [], none: cam.mode === 'static' ? 'offscreen' : 'camera' }, raw: 0.5, rationale: `nothing trackable with camera ${cam.mode}` };
  const rt = referenceTile(sc?.heat);
  if (rt) probes.unshift(mk('lk_box', { kind: 'box', ...rt }, { axis: 'auto' }, 'reference', 'background'));
  const strong = top && top.power >= 0.3 && (top.camCorr ?? 0) < 0.3;
  return { value: { probes }, raw: top ? (strong ? 0.75 : 0.65) : 0.5, rationale: (rt ? 'reference lk_box on the stillest border tile; ' : '') + why.join('; ') };
}

// ---------------------------------------------------------------- track (trace 2: keep run25 / run21, reject lk_box and whole frame)
const cameraLike = (r) => r.cameraShare != null && r.cameraShare >= 0.8 && (r.cameraOffsetMs ?? 0) < 60;
const matchOf = (pairs, a, b) => pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));

export function track(req) {
  const f = req.facts ?? {}, runs = f.runs ?? [], pairs = f.pairs ?? [], cam = f.camera, loop = f.scene?.loop, seg = f.segment;
  const rate = strokeRate(f), kindRecipe = GEN_KINDS[seg?.kind]?.recipe ?? 'penetration';
  const fallback = rate ? { recipe: 'penetration-strokes', params: { rate } } : { recipe: RECIPES[kindRecipe] ? kindRecipe : 'penetration-strokes', params: {} };
  const loopHz = loop?.periodMs > 0 && loop.prominence >= 0.3 ? 1000 / loop.periodMs : null;
  const reject = {}, ok = [];
  for (const r of runs) {
    if (r.role === 'reference') continue;
    if (r.role === 'base') { reject[r.id] = 'whole-frame base run'; continue; }
    const big = (r.gaps ?? []).find(([a, b]) => b - a > 1000);
    if (cameraLike(r)) reject[r.id] = `measures the camera (share ${r.cameraShare}, offset ${r.cameraOffsetMs} ms)`;
    else if (r.coverage < 0.9) reject[r.id] = `coverage ${r2(r.coverage)}`;
    else if (big) reject[r.id] = `lost ${clock(big[0])}–${clock(big[1])}`;
    else if (loopHz && Math.abs(r.turnsPerS / 2 - loopHz) / loopHz > 0.25) reject[r.id] = `rate ${r2(r.turnsPerS / 2)} Hz vs loop ${r2(loopHz)} Hz`;
    else if (!channelOk(r.channel, cam?.valid)) reject[r.id] = `channel ${r.channel} not valid with camera ${cam?.mode}`;
    else ok.push(r);
  }
  const others = (r) => runs.filter((o) => o.id !== r.id && o.role === 'subject' && !cameraLike(o));
  const best = (r) => others(r).map((o) => matchOf(pairs, r.id, o.id)).filter(Boolean).sort((a, b) => b.match - a.match)[0] ?? null;
  const scored = ok.map((r) => {
    const rm = loopHz ? Math.max(0, 1 - Math.abs(r.turnsPerS / 2 / loopHz - 1) / 0.25) : 0.5, b = best(r);
    return { r, b, score: 0.4 * (1 - clamp(r.halfCv, 0, 1)) + 0.3 * (b?.match ?? 0) + 0.3 * rm };
  }).sort((a, b) => b.score - a.score);
  if (!scored.length) {
    const allCam = runs.some((r) => r.role === 'subject') && runs.filter((r) => r.role === 'subject').every(cameraLike);
    return { value: { keep: null, agree: [], reject, fallback }, raw: allCam ? 0.75 : runs.length ? 0.55 : 0.6,
      rationale: `${runs.length ? (allCam ? 'every subject run measures the camera' : 'no run passes the gates') : 'no runs'}; fallback ${fallback.recipe}${rate ? ` at ${rate} turns/s (stroke-locked camera)` : ''}` };
  }
  const k = scored[0], agree = others(k.r).filter((o) => { const p = matchOf(pairs, k.r.id, o.id); return p && p.match >= 0.75 && Math.abs(p.medianOffsetMs) <= 120; }).map((o) => o.id);
  for (const s of scored.slice(1)) reject[s.r.id] = `lower score (${r2(s.score)} vs ${r2(k.score)})`;
  for (const id of agree) delete reject[id];
  const bm = Math.max(0, ...agree.map((id) => matchOf(pairs, k.r.id, id).match));
  return {
    value: { keep: k.r.id, channel: k.r.channel, agree, reject }, raw: r2(agree.length ? Math.min(0.95, 0.8 + 0.15 * clamp((bm - 0.75) / 0.25, 0, 1)) : Math.min(0.7, 0.55 + 0.15 * k.score)),
    rationale: `keep ${k.r.id} ${k.r.tracker}/${k.r.channel}: ${k.r.turnsPerS} turns/s, half-cycle cv ${k.r.halfCv}, score ${r2(k.score)}${agree.length ? `; agrees with ${agree.join(', ')} (match ${r2(bm)})` : '; no independent run agrees'}`,
  };
}

// ---------------------------------------------------------------- direction (trace 2: run25 / run21 sign +1 on 8 and 6 pairs)
/** pickPairs [{a:{at,pos}, b:{at,pos}}] -> [{deep, shallow}] for a sign (+1: lower pos is deeper). */
export const pairsForSign = (pp, sign) => (sign ? (pp ?? []).map(({ a, b }) => (sign * (a.pos - b.pos) < 0 ? { deep: a.at, shallow: b.at } : { deep: b.at, shallow: a.at })) : []);

export function direction(req) {
  const f = req.facts ?? {}, keep = f.keep ?? null, run = (f.runs ?? []).find((r) => r.id === keep) ?? (keep ? null : f.runs?.[0]);
  if (!run) return { abstain: 'no kept run' };
  const facts = (f.assist ?? []).filter((x) => x.agrees === true || x.agrees === false);
  let sign = 0, raw = 0, why;
  if (facts.length) {
    const yes = facts.filter((x) => x.agrees).length, no = facts.length - yes;
    if (yes !== no) { sign = yes > no ? 1 : -1; raw = 0.98 * (Math.max(yes, no) / facts.length); why = `assist direction facts: ${yes} agree, ${no} disagree`; }
  }
  if (!sign) {
    if (run.channel === 'dist01') { sign = 1; raw = 0.92; why = 'dist01: the smallest two-body distance is the deepest point (geometry)'; }
    else if (run.channel === 'len_over_width') { sign = 1; raw = 0.75; why = 'len_over_width: shorter visible length = deeper (tracker convention)'; }
    else if (run.channel === 'proj') { sign = 1; raw = 0.7; why = 'proj on the proposed axis (x0,y0 → x1,y1 = in): prior only'; }
    else return { abstain: `channel ${run.channel} has no direction geometry` };
  }
  const pairs = pairsForSign(f.pickPairs, sign).filter((p) => [p.deep, p.shallow].every((t) => t >= req.scope.t0 && t <= req.scope.t1));
  return { value: { sign, pairs }, raw: r2(raw), rationale: `${run.id} sign ${sign > 0 ? '+1' : '-1'}: ${why}` };
}

// ---------------------------------------------------------------- depth (trace 2: penetration 0-85 at 0.75, then 0-90)
export function depth(req) {
  const f = req.facts ?? {}, seg = f.segment, recipe = seg?.recipe ?? GEN_KINDS[seg?.kind]?.recipe, p = RECIPES[recipe]?.params ?? {};
  const lo = seg?.params?.lo ?? p.lo ?? p.pos ?? 0, hi = seg?.params?.hi ?? p.hi ?? p.pos ?? 100, x = f.excursion;
  const intensity = x?.max2s > 0 ? r2(clamp(x.median2s / x.max2s, 0, 1)) : clamp(seg?.intensity ?? 1, 0, 1);
  return { value: { lo: Math.min(lo, hi), hi: Math.max(lo, hi), intensity }, raw: 0.65,
    rationale: `${recipe ?? 'default'} range ${lo}–${hi}; intensity ${intensity} ${x?.max2s > 0 ? '(median 2 s excursion / scene max)' : '(story)'}` };
}

// ---------------------------------------------------------------- verify (independent numeric checks only)
export function verify(req) {
  const checks = req.facts?.checks ?? [], appl = checks.filter((c) => c.value !== null);
  if (!appl.length) return { abstain: 'no independent evidence: needs a frame check' };
  const bad = appl.filter((c) => !c.ok);
  if (bad.length) return { value: { verdict: 'redo', redo: REDO_OF[bad[0].id] ?? 'track', checks, note: bad.map((c) => `${c.id} ${c.value} (${c.limit})`).join('; ') }, raw: 0.85, rationale: `failed: ${bad.map((c) => c.id).join(', ')}` };
  return { value: { verdict: 'ok', checks, note: `${appl.length} independent checks pass` }, raw: appl.length >= 2 ? 0.85 : 0.75, rationale: appl.map((c) => `${c.id} ${c.value}`).join(', ') };
}

const BY_KIND = { camera, climax, story, roi, track, direction, depth, verify };
/** One request -> BrainAnswer (a throw becomes an abstention). */
export function answer(req) {
  try { return { id: req.id, ...(BY_KIND[req.kind]?.(req) ?? { abstain: `unknown kind ${req.kind}` }) }; }
  catch (e) { return { id: req.id, abstain: 'error: ' + String(e?.message ?? e).slice(0, 200) }; }
}

export const rulesBrain = {
  id: 'rules', kinds: KINDS,
  available: async () => true,
  decide: async (reqs) => reqs.map((r) => { const t = Date.now(), a = answer(r); return { ...a, cost: { ms: Date.now() - t } }; }),
};
