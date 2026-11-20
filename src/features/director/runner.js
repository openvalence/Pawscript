// runner.js -- what the director's draft steps do (DESIGN §2 steps 4–8 and 10; contract README §9), without Svelte so
// node can drive it (test/director-runner.test.mjs). Every function takes the director D, duck-typed:
//   D.app (doc, transact), D.L (lib.js: decide, toRecord, validate, digest, verifyChecks, DEFAULTS, chainFor),
//   D.settings, D.records {id: TraceRecord}, D.overrides, D.queue [DecisionRequest], D.session, D.brains, D.ctx,
//   D.budget, D.memo {stats, cands, compare, attempts, priors, force}, D.facts, D.service.call(req),
//   D.api (tracking api: trackers, trackRange, setSpanOrientation), D.runOf(id) (full run record | null),
//   D.setChannel(id, ch), D.onRecords?(records)
// and the draft store (progress, cancelled, moved, top(), generate()). Doc writes: one app.transact per step.
import { importTimeline, setParams } from '../timeline/plan.js';
import { RECIPES } from '../../lib/gen/recipes.js';
import { pickPairs, readBlock, withDecision, decisionFor } from '../assist/model.js';
import { getBlock, setBlock } from '../../lib/io/project.js';
import { plural, firstLine } from '../draft/logic.js';
import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live

export const STEP_OF = { camera: 'survey', climax: 'story', story: 'story', roi: 'regions', track: 'compare', direction: 'direction', depth: 'direction', verify: 'verify' };
const SCHEMA = 'pawscript.director/1';
const MAX_REDO = 2;
const s1 = (ms) => (ms / 1000).toFixed(1);
const span = (t0, t1) => `${s1(t0)}–${s1(t1)} s`;
const tally = (xs) => { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) || 0) + 1); return [...m].map(([k, n]) => (n > 1 ? `${n} ${k}` : k)).join(', '); };
const camel = (o) => (Array.isArray(o) ? o.map(camel) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), camel(v)])) : o);
const stop = (draft) => draft.cancelled || draft.moved;
const video = (app) => app.doc.media?.path || '';
const dur = (app) => Math.max(1, Math.round(app.durationMs || app.doc.media?.durationMs || 1));

// ---- facts (SceneFacts / FactSheet, README §2) --------------------------------------------------------------
const CUM = /cum|ejacul|orgasm/;
function cumOnset(perFrame = []) {
  for (const f of perFrame || []) if (Object.entries(f.scores || {}).some(([k, v]) => CUM.test(k) && v >= 0.4)) return f.t_ms;
  return null;
}
const box = (b) => (Array.isArray(b) ? { x: b[0], y: b[1], w: b[2], h: b[3] } : b);
export function sceneFacts(sc, i, st = null) {
  const d = sc.describe, s = d?.summary, l = sc.loop;
  return {
    i, t0: Math.round(sc.start_ms), t1: Math.round(sc.end_ms),
    describe: s ? { acts: s.acts || [], parts: s.visible_parts || [], knot: !!s.knot, count: s.count ?? 'unknown', views: s.views || [], rating: s.rating ?? null,
      boxes: (d.tags || []).filter((t) => t.box).map((t) => ({ tag: t.tag, box: box(t.box), score: t.score })), cumOnsetMs: cumOnset(d.per_frame) } : null,
    loop: l ? { periodMs: l.period_ms ?? l.motion_period_ms ?? null, prominence: l.prominence ?? 0, confidence: l.confidence ?? 0, held: l.held?.ratio ?? 0 } : null,
    camera: st?.camera ? camel(st.camera) : null,
    energy: st?.energy || { t: [], v: [] }, still: st?.still || [], heat: st?.heat || [],
    seconds: (st?.seconds || []).map((x) => ({ t: x.t, bright: x.bright, black: !!x.black, creditsLike: x.credits_like ?? 0 })),
  };
}
export function factSheet(app, stats = []) {
  const m = app.doc.media || {};
  return { video: { path: m.path || '', dur: dur(app), fps: m.fps || 30, w: m.width || 0, h: m.height || 0 }, scenes: (app.doc.scenes || []).map((sc, i) => sceneFacts(sc, i, stats[i])) };
}
/** motion.stats over every scene once per run (facts survive only in memory: a reopened project measures again). */
export async function ensureFacts(D, draft, i) {
  if (D.facts && D.memo.stats) return D.facts;
  const app = D.app, scenes = app.doc.scenes || [];
  draft.progress?.(i, 0, 1, 'motion survey');
  const r = await D.service.call({ cmd: 'motion.stats', video: video(app), ranges: scenes.map((s) => ({ start_ms: Math.round(s.start_ms), end_ms: Math.round(s.end_ms) })),
    params: { width: 320, fps: 15, grid: 8, border: 0.12, boxes: null } });
  if (r.cancelled || stop(draft)) return null;
  D.memo.stats = r.result?.ranges || [];
  D.memo.statsError = r.error ? firstLine(r.error) : '';
  D.facts = factSheet(app, D.memo.stats);
  return D.facts;
}
const keyframes = (t0, t1, n = 3) => Array.from({ length: n }, (_, k) => ({ t: Math.round(t0 + ((k + 0.5) / n) * (t1 - t0)) }));

// ---- requests and decisions -----------------------------------------------------------------------------------
const recOf = (D, id) => D.records[id] || null;
const valOf = (D, id) => D.overrides[id]?.value ?? recOf(D, id)?.value ?? null;
/** A DecisionRequest. attempt / prior come from a redo in flight (memo) or from the stored record (a reopened project). */
export function makeReq(D, kind, scopeKey, scope, o = {}) {
  const id = `${kind}:${scopeKey}`, rec = recOf(D, id);
  const attempt = D.memo.attempts[id] ?? rec?.attempt ?? 0;
  const prior = D.memo.priors[id] ?? (attempt && rec?.supersedes ? { value: rec.supersedes.value, brain: rec.supersedes.brain } : null);
  return { schema: SCHEMA, id, kind, scope, attempt, round: 0, maxRounds: D.settings.maxRounds ?? 3, question: o.question || '', facts: o.facts || {},
    frames: o.frames || [], deps: o.deps || [], ...(prior ? { prior } : {}), evidence: [], ...(o.choices ? { choices: o.choices } : {}) };
}
/** Brains decide() must skip for a request: a forced re-decide (all but that brain), a redo's prior brain, and for
 *  verify the brain that decided that span's direction (README §5). */
function skipOf(D, req) {
  const out = new Set();
  const f = D.memo.force?.[req.id];
  if (f) for (const b of D.L.chainFor(req.kind, D.settings)) if (b !== f) out.add(b);
  if (req.prior?.brain) out.add(req.prior.brain);
  if (req.kind === 'verify') { const b = recOf(D, 'direction:' + req.id.slice(7))?.brain; if (b && b !== 'default' && b !== 'user') out.add(b); }
  return [...out];
}
/** decide() + the records (README §6): one TraceRecord per decision, replacing the one with its id. */
export async function decideWith(D, reqs) {
  if (!reqs.length) return [];
  const skip = {};
  for (const r of reqs) { const s = skipOf(D, r); if (s.length) skip[r.id] = s; }
  const ds = await D.L.decide(reqs, { brains: D.brains, settings: D.settings, calib: D.L.calib ?? null, records: D.records, overrides: D.overrides, skip, ctx: D.ctx,
    budget: D.budget, enqueue: (req) => { D.queue = [...D.queue.filter((q) => q.id !== req.id), req]; } });
  const recs = { ...D.records }, fresh = [];
  for (const d of ds) {
    const r = D.L.toRecord(d, { session: D.session, prev: D.records[d.req.id] || null });
    recs[d.req.id] = r; fresh.push(r);
    if (D.memo.force?.[d.req.id]) delete D.memo.force[d.req.id];
  }
  D.records = recs;
  // a decision that no longer waits for the user leaves the queue (answered, or decided on a re-run)
  const waiting = new Set(ds.filter((d) => d.status === 'queued' || (d.status === 'replayed' && recs[d.req.id].status === 'queued')).map((d) => d.req.id));
  if (D.queue.some((q) => reqs.some((r) => r.id === q.id) && !waiting.has(q.id))) D.queue = D.queue.filter((q) => !reqs.some((r) => r.id === q.id) || waiting.has(q.id));
  D.onRecords?.(fresh);
  return ds;
}
/** Mark the records a step's transact applied. */
function applied(D, ids, a) {
  const recs = { ...D.records };
  for (const id of ids) if (recs[id]) recs[id] = { ...recs[id], applied: a };
  D.records = recs;
}

// ---- spans: plan segments that follow tracked turns --------------------------------------------------------
const sceneAt = (scenes, t) => { const i = scenes.findIndex((s) => s.start_ms <= t && t < s.end_ms); return i < 0 ? Math.max(0, scenes.length - 1) : i; };
const follows = (s) => ['follow', 'knot-stroke'].includes(RECIPES[s.recipe]?.gen);
/** Visible segments whose recipe follows a tracked run -> [{i, t0, t1, seg, key, kind, recipe}]. only: keys to keep. */
export function spansOf(D, only = null) {
  const scenes = D.app.doc.scenes || [];
  return (D.app.doc.plan || []).filter(follows).map((s) => {
    const i = sceneAt(scenes, s.t0), st = valOf(D, 'story:s' + i)?.segments?.find((x) => x.t0 === s.t0);
    return { i, t0: s.t0, t1: s.t1, seg: s.id, key: `s${i}@${s.t0}`, kind: s.kind, recipe: s.recipe, visible: st ? st.visible !== false : true, name: s.name || s.kind };
  }).filter((x) => x.visible && (!only || only.includes(x.key)));
}
const scopeOf = (sp) => ({ scene: sp.i, t0: sp.t0, t1: sp.t1, seg: sp.seg });
const segFacts = (D, sp) => (D.app.doc.plan || []).find((s) => s.id === sp.seg) || null;
const segmentOf = (D, sp) => valOf(D, 'story:s' + sp.i)?.segments?.find((x) => x.t0 === sp.t0) || (({ t0, t1, kind }) => ({ t0, t1, kind, visible: true, action: 'unknown', intensity: 1, name: kind }))(sp);

// ---- step 4: survey (camera per scene) -------------------------------------------------------------------------
export async function survey(D, draft, i) {
  const app = D.app, scenes = app.doc.scenes || [];
  if (!scenes.length) return { skip: 'No scenes' };
  D.facts = null; D.memo.stats = null;
  const F = await ensureFacts(D, draft, i);
  if (!F) return { cancelled: true };
  const reqs = F.scenes.map((sf) => makeReq(D, 'camera', 's' + sf.i, { scene: sf.i, t0: sf.t0, t1: sf.t1 }, {
    question: `Scene ${sf.i + 1} (${span(sf.t0, sf.t1)}): is the camera static, riding the strokes (the frame bumps with them), moving (pan / zoom) or swaying?`,
    facts: { scene: sf, video: F.video }, frames: keyframes(sf.t0, sf.t1) }));
  const ds = await decideWith(D, reqs);
  if (stop(draft)) return { cancelled: true };
  return { note: `${plural(ds.length, 'scene')} · camera ${tally(ds.map((d) => d.value.mode))}${D.memo.statsError ? ` · motion.stats failed: ${D.memo.statsError}` : ''}`, facts: { surveyed: ds.length } };
}

// ---- step 5: story (climax, then segments per scene; writes the plan) --------------------------------------------
export async function story(D, draft, i) {
  const app = D.app, F = await ensureFacts(D, draft, i);
  if (!F) return { cancelled: true };
  if (!F.scenes.length) return { skip: 'No scenes' };
  const [cd] = await decideWith(D, [makeReq(D, 'climax', 'v', { scene: null, t0: 0, t1: F.video.dur }, {
    question: `Where is the orgasm of this ${s1(F.video.dur)} s video (the first spurt to where it fades), if there is one? Afterglow lasts until the motion settles. (The fast climax strokes before it are added from the reference fit.)`,
    facts: { video: F.video, scenes: F.scenes }, deps: F.scenes.map((sf) => 'camera:s' + sf.i) })]);
  if (stop(draft)) return { cancelled: true };
  const reqs = F.scenes.map((sf) => makeReq(D, 'story', 's' + sf.i, { scene: sf.i, t0: sf.t0, t1: sf.t1 }, {
    question: `Scene ${sf.i + 1} (${span(sf.t0, sf.t1)}): what happens, as segments (kind, visible or off-screen, does the action continue, intensity 0..1)?`,
    facts: { scene: sf, video: F.video, camera: valOf(D, 'camera:s' + sf.i), climax: cd.value }, deps: ['camera:s' + sf.i, 'climax:v'], frames: keyframes(sf.t0, sf.t1, 4) }));
  const ds = await decideWith(D, reqs);
  if (stop(draft)) return { cancelled: true };
  const rows = ds.flatMap((d) => d.value.segments.map((s) => ({ start_ms: s.t0, end_ms: s.t1, kind: s.kind, intensity: s.intensity, ...(s.recipe ? { recipe: s.recipe } : {}), ...(s.params ? { params: s.params } : {}), name: s.name })));
  const scenes = app.doc.scenes || [];
  const { plan, warnings } = importTimeline(rows, { dur: F.video.dur, newId: () => 'tmp' });
  // stable ids (scene + start): the span ids and digests downstream stay the same across re-runs
  const next = plan.map((s) => ({ ...s, id: `dir-${sceneAt(scenes, s.t0)}-${s.t0}` }));
  if (!next.length) throw new Error('The story came out empty.');
  app.transact('Director: story', () => { app.doc.plan = next; });
  const entry = draft.top();
  applied(D, ['climax:v', ...ds.map((d) => d.req.id)], { label: 'Director: story', entry, effects: [`plan: ${plural(next.length, 'segment')}`] });
  const cl = cd.value.window ? `orgasm ${span(cd.value.window.t0, cd.value.window.t1)}` : 'no orgasm';
  return { note: `${plural(next.length, 'segment')} · ${tally(next.map((s) => s.kind))} · ${cl}${warnings.length ? ` · ${warnings[0]}` : ''}`, facts: { segments: next.length }, entry };
}

// ---- step 6: regions (propose, choose probes, track them) ---------------------------------------------------------
const WHOLE = { kind: 'box', x: 0, y: 0, w: 1, h: 1 };
/** The probes a roi value names, with ids, plus a whole-frame reference when it names fewer than two (every visible
 *  tracked span gets at least two runs to compare). */
export function probesOf(D, sp, value, trackers = []) {
  if (!value || value.none) return [];
  const list = (value.probes || []).map((p) => ({ ...p, params: p.params || {}, role: p.role || 'subject' }));
  if (list.length < 2) {
    const t = trackers.find((x) => x.id === 'lk_box') || trackers.find((x) => x.roi === 'box' || x.roi === 'box_or_points');
    if (t && !list.some((p) => p.tracker === t.id && JSON.stringify(p.roi) === JSON.stringify(WHOLE))) list.push({ tracker: t.id, roi: { ...WHOLE }, params: {}, role: 'reference', part: 'frame' });
  }
  return list.map((p) => ({ ...p, id: p.id || D.L.digest({ tracker: p.tracker, roi: p.roi, params: p.params, t0: sp.t0, t1: sp.t1 }) }));
}
/** The sidecar's tracker list (kept in memo: probesOf must see the same list in every step). */
async function trackersOf(D) {
  if (!D.memo.trackers) { try { D.memo.trackers = await D.api.trackers(); } catch (e) { D.memo.trackers = null; throw e; } }
  return D.memo.trackers;
}
const ghostByTag = (D, tag) => (D.app.doc.ghosts || []).find((g) => g.source?.tag === tag && g.script?.length) || null;
export async function regions(D, draft, i, single = false, only = null) {
  const app = D.app, spans = spansOf(D, only);
  if (!spans.length) return { skip: 'No visible span follows a tracked run' };
  const F = await ensureFacts(D, draft, i);
  if (!F) return { cancelled: true };
  let trackers;
  try { trackers = await trackersOf(D); } catch (e) { if (stop(draft)) return { cancelled: true }; throw e; }
  if (stop(draft)) return { cancelled: true };
  const reqs = [];
  for (const [k, sp] of spans.entries()) {
    const sf = F.scenes[sp.i];
    if (!D.memo.cands[sp.key]) {
      draft.progress?.(i, k, spans.length, `propose ${span(sp.t0, sp.t1)}`);
      const figs = (sf?.describe?.boxes || []).filter((b) => b.score >= 0.3).map((b) => b.box);
      const r = await D.service.call({ cmd: 'motion.propose', video: video(app), start_ms: sp.t0, end_ms: sp.t1, period_ms: sf?.loop?.periodMs ?? null, boxes: figs.length ? figs : null, params: { width: 256, max: 3 } });
      if (r.cancelled || stop(draft)) return { cancelled: true };
      D.memo.cands[sp.key] = camel(r.result?.candidates || []);
    }
    reqs.push(makeReq(D, 'roi', sp.key, scopeOf(sp), {
      question: `${sp.name} at ${span(sp.t0, sp.t1)}: which part moves with the strokes, and which trackers should follow it (1–5 probes, or none if it cannot be seen)?`,
      facts: { scene: sf, camera: valOf(D, 'camera:s' + sp.i), segment: segmentOf(D, sp), candidates: D.memo.cands[sp.key] },
      deps: ['camera:s' + sp.i, 'story:s' + sp.i], frames: keyframes(sp.t0, sp.t1) }));
  }
  const ds = await decideWith(D, reqs);
  if (stop(draft)) return { cancelled: true };
  let tracked = 0, reused = 0;
  const failed = [], B = D.budget, total = ds.reduce((n, d, k) => n + probesOf(D, spans[k], d.value, trackers).length, 0);
  let done = 0;
  for (const [k, d] of ds.entries()) {
    const sp = spans[k], effects = [];
    for (const p of probesOf(D, sp, d.value, trackers)) {
      if (stop(draft)) return { cancelled: true, note: `Cancelled after ${tracked} runs` };
      draft.progress?.(i, done++, total, `${p.tracker} · ${span(sp.t0, sp.t1)}`);
      const tag = 'director:' + p.id;
      if (ghostByTag(D, tag)) { reused++; effects.push(`reused ${tag}`); continue; }
      if (!trackers.some((t) => t.id === p.tracker)) { failed.push(`${p.tracker}: not installed`); continue; }
      if (B && B.used.tracks >= B.tracks) { failed.push(`${p.tracker}: track budget used up`); continue; }
      const t = Date.now();
      const r = await D.api.trackRange({ tracker: p.tracker, range: { t0: sp.t0, t1: sp.t1 }, roi: p.roi, params: p.params, tag });
      if (r.cancelled) return { cancelled: true, note: `Cancelled after ${tracked} runs` };
      if (r.error) { failed.push(`${p.tracker}: ${firstLine(r.error)}`); continue; }
      if (B) { B.used.tracks++; B.used.gpuS += (Date.now() - t) / 1000; }
      tracked++; effects.push(`${r.run.id} = ${tag}`);
    }
    applied(D, [d.req.id], { label: 'Director: regions', entry: null, effects });
  }
  const none = ds.filter((d) => d.value.none).length;
  return { note: `${plural(tracked, 'run')} tracked${reused ? `, ${reused} reused` : ''}${none ? ` · ${none} without a region` : ''}${failed.length ? ` · ${failed.length} failed (${failed[0]})` : ''}`, facts: { tracked, reused } };
}

// ---- step 7: compare (motion.compare, keep one run or none, pin seg.source) ------------------------------------
/** The probes of a span with the run each one made (a ghost tagged director:<probe id>). */
export function probeRuns(D, sp) {
  return probesOf(D, sp, valOf(D, 'roi:' + sp.key), D.memo.trackers || []).map((p) => ({ ...p, runId: ghostByTag(D, 'director:' + p.id)?.id || null })).filter((p) => p.runId);
}
export function seriesOf(D, p) {
  const run = D.runOf(p.runId), ch = run && p.channel && run.channels?.[p.channel] ? run.channels[p.channel] : run?.samples;
  if (ch?.t?.length) return { t: Array.from(ch.t), v: Array.from(ch.v, (x) => (Number.isFinite(x) ? +x.toFixed(4) : null)) };
  const g = (D.app.doc.ghosts || []).find((x) => x.id === p.runId);
  return { t: (g?.script || []).map((a) => a.at), v: (g?.script || []).map((a) => a.pos / 100) };
}
export function cameraSeries(D, i) {
  const g = D.memo.stats?.[i]?.global, sc = (D.app.doc.scenes || [])[i];
  if (!g?.hz || !g.dx?.length || !sc) return null;
  return { t: g.dx.map((_, k) => Math.round(sc.start_ms + (k * 1000) / g.hz)), dx: g.dx, dy: g.dy };
}
export async function compareSpan(D, sp) {
  const probes = probeRuns(D, sp), sf = D.facts?.scenes?.[sp.i];
  if (!probes.length) return { runs: [], pairs: [] };
  const r = await D.service.call({ cmd: 'motion.compare', t0: sp.t0, t1: sp.t1, loop_period_ms: sf?.loop?.periodMs ?? null, match_ms: 120,
    series: probes.map((p) => ({ id: p.runId, role: p.role, tracker: p.tracker, channel: p.channel || p.params?.primary || 'primary', ...seriesOf(D, p) })), camera: cameraSeries(D, sp.i) });
  if (r.cancelled) return null;
  const by = new Map((r.result?.series || []).map((s) => [s.id, camel(s)]));
  const runs = probes.map((p) => ({ turns: 0, turnsPerS: 0, halfCv: 1, coverage: 0, gaps: [], cycleMs: null, vsLoop: null, cameraShare: null, cameraOffsetMs: null,
    ...by.get(p.runId), id: p.runId, role: p.role, tracker: p.tracker, channel: p.channel || p.params?.primary || 'primary' }));
  return { runs, pairs: camel(r.result?.pairs || []), error: r.error ? firstLine(r.error) : '' };
}
export async function compare(D, draft, i, single = false, only = null) {
  const app = D.app, spans = spansOf(D, only);
  if (!spans.length) return { skip: 'No visible span follows a tracked run' };
  if (!(await ensureFacts(D, draft, i))) return { cancelled: true };
  try { await trackersOf(D); } catch { /* compare works on the runs that exist */ }
  const reqs = [];
  for (const [k, sp] of spans.entries()) {
    draft.progress?.(i, k, spans.length, `compare ${span(sp.t0, sp.t1)}`);
    const st = await compareSpan(D, sp);
    if (!st || stop(draft)) return { cancelled: true };
    D.memo.compare[sp.key] = st;
    reqs.push(makeReq(D, 'track', sp.key, scopeOf(sp), {
      question: `${sp.name} at ${span(sp.t0, sp.t1)}: which tracker run follows the strokes (not the camera)? Keep one, or none and fall back to a recipe.`,
      facts: { camera: valOf(D, 'camera:s' + sp.i), segment: segmentOf(D, sp), runs: st.runs, pairs: st.pairs }, deps: ['roi:' + sp.key, 'camera:s' + sp.i],
      frames: keyframes(sp.t0, sp.t1, 2).map((f) => ({ ...f, overlay: st.runs[0]?.id })) }));
  }
  const ds = await decideWith(D, reqs);
  if (stop(draft)) return { cancelled: true };
  const pick = new Map(ds.map((d, k) => [spans[k].seg, d.value]));
  const plan = (app.doc.plan || []).map((s) => {
    const v = pick.get(s.id);
    if (!v) return s;
    const { source, ...rest } = s;
    if (v.keep) return { ...rest, source: v.keep };
    return v.fallback?.recipe && RECIPES[v.fallback.recipe] ? { ...rest, recipe: v.fallback.recipe, params: { ...(s.params?.intensity != null ? { intensity: s.params.intensity } : {}), ...(v.fallback.params || {}) } } : rest;
  });
  app.transact('Director: compare trackers', () => { app.doc.plan = plan; });
  const entry = draft.top();
  // the kept run stays visible, the span's other director runs are hidden (one ghost update, not an undo step)
  const keep = new Set(ds.map((d) => d.value.keep).filter(Boolean)), mine = new Set(spans.flatMap((sp) => probeRuns(D, sp).map((p) => p.runId)));
  const ghosts = app.doc.ghosts || [];
  if (ghosts.some((g) => mine.has(g.id) && g.visible !== keep.has(g.id))) app.doc.ghosts = ghosts.map((g) => (mine.has(g.id) ? { ...g, visible: keep.has(g.id) } : g));
  for (const d of ds) if (d.value.keep && d.value.channel) D.setChannel(d.value.keep, d.value.channel);
  ds.forEach((d) => applied(D, [d.req.id], { label: 'Director: compare trackers', entry, effects: [d.value.keep ? `source = ${d.value.keep}` : d.value.fallback ? `recipe ${d.value.fallback.recipe}` : 'no run'] }));
  const kept = ds.filter((d) => d.value.keep).length;
  return { note: `${kept}/${ds.length} spans keep a run${kept < ds.length ? ` · ${ds.length - kept} on a recipe` : ''}`, facts: { kept, spans: ds.length }, entry };
}

// ---- step 8: direction and depth --------------------------------------------------------------------------------
/** The kept run's points as tracked (no span orientation): what direction is judged on, so a flip it caused never
 *  changes its own inputs. */
export function rawScript(D, runId) {
  const run = D.runOf(runId);
  if (run?.points0) return Array.from(run.points0.at, (at, k) => ({ at, pos: run.points0.pos[k] }));
  return (D.app.doc.ghosts || []).find((g) => g.id === runId)?.script || [];
}
const posNear = (script, t) => { let b = null; for (const a of script) if (!b || Math.abs(a.at - t) < Math.abs(b.at - t)) b = a; return b?.pos ?? null; };
/** Sign from {deep, shallow} time pairs against the run as tracked: deep at the lower pos = +1. Majority; 0 on a tie. */
export function signFromPairs(script, pairs = []) {
  let n = 0;
  for (const p of pairs) { const a = posNear(script, p.deep), b = posNear(script, p.shallow); if (a != null && b != null && a !== b) n += a < b ? 1 : -1; }
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}
export async function direction(D, draft, i, single = false, only = null) {
  const app = D.app, spans = spansOf(D, only).filter((sp) => valOf(D, 'track:' + sp.key)?.keep);
  if (!spans.length) return { skip: 'No span keeps a run' };
  const frameMs = 1000 / (app.doc.media?.fps || 30), block = readBlock(getBlock({ extra: app.doc.project?.extra }, 'assist'));
  const reqs = [];
  for (const sp of spans) {
    const keep = valOf(D, 'track:' + sp.key).keep, script = rawScript(D, keep), pp = pickPairs(script, sp.t0, sp.t1, { k: 5, frameMs });
    const fact = decisionFor(block.direction, sp.t0, sp.t1, (x) => x.by !== 'director'), stat = D.memo.compare[sp.key]?.runs?.filter((r) => r.id === keep) || [];
    reqs.push(makeReq(D, 'direction', sp.key, scopeOf(sp), {
      question: `${sp.name} at ${span(sp.t0, sp.t1)}: which frame of the pair is deeper (bodies pressed together)? The app turns that into the sign of run ${keep}: +1 as tracked, -1 mirrored, 0 can't tell.`,
      facts: { segment: segmentOf(D, sp), keep, runs: stat, camera: valOf(D, 'camera:s' + sp.i), pickPairs: pp.map(({ a, b }) => ({ a, b })), ...(fact ? { assist: { direction: fact } } : {}) },
      deps: ['track:' + sp.key], frames: pp.slice(0, 3).flatMap((p) => [{ t: p.a.at }, { t: p.b.at }]) }));
    reqs.push(makeReq(D, 'depth', sp.key, scopeOf(sp), {
      question: `${sp.name} at ${span(sp.t0, sp.t1)}: how deep does it go (lo..hi, 0 = deepest) and how intense is it?`,
      facts: { segment: segmentOf(D, sp), runs: stat, scene: D.facts?.scenes?.[sp.i] }, deps: ['track:' + sp.key, 'story:s' + sp.i] }));
  }
  const ds = await decideWith(D, reqs);
  if (stop(draft)) return { cancelled: true };
  const by = new Map(ds.map((d) => [d.req.id, d])), effects = new Map();
  let plan = app.doc.plan || [], next = block, flipped = 0, facts = 0;
  for (const sp of spans) {
    const dir = by.get('direction:' + sp.key), dep = by.get('depth:' + sp.key), keep = valOf(D, 'track:' + sp.key).keep, eff = [];
    if (dir?.value.sign) {
      if (D.api.setSpanOrientation({ runId: keep, t0: sp.t0, t1: sp.t1, sign: dir.value.sign })) { eff.push(`${keep} sign ${dir.value.sign}`); if (dir.value.sign < 0) flipped++; }
      else eff.push(`${keep}: run record gone, orientation not applied`);
      // a settled direction is an assist fact (assist then does not ask it again); a guess is not. by:'director' keeps
      // the director's own facts out of its next direction request (else every re-run would re-decide)
      if (['decided', 'user'].includes(dir.status) || (dir.status === 'replayed' && !recOf(D, dir.req.id)?.provisional)) {
        const raw = rawScript(D, keep), p = dir.value.pairs?.[0], q = dir.req.facts.pickPairs?.[0];
        const pair = p || (q && (((q.a.pos < q.b.pos) === (dir.value.sign > 0)) ? { deep: q.a.at, shallow: q.b.at } : { deep: q.b.at, shallow: q.a.at }));
        if (pair && raw.length) { next = withDecision(next, 'direction', { t0: sp.t0, t1: sp.t1, deep: pair.deep, shallow: pair.shallow, by: 'director' }); facts++; eff.push('assist direction fact'); }
      }
    }
    if (dep) { plan = setParams(plan, [sp.seg], { lo: dep.value.lo, hi: dep.value.hi, intensity: dep.value.intensity }); effects.set(dep.req.id, [`lo ${dep.value.lo} hi ${dep.value.hi} intensity ${dep.value.intensity}`]); }
    if (dir) effects.set(dir.req.id, eff);
  }
  app.transact('Director: direction and depth', () => {
    app.doc.plan = plan;
    if (next !== block) { const p = app.doc.project || { path: null, extra: {} }; app.doc.project = { ...p, extra: setBlock({ extra: p.extra }, 'assist', next).extra }; }
  });
  const entry = draft.top();
  for (const [id, eff] of effects) applied(D, [id], { label: 'Director: direction and depth', entry, effects: eff });
  const unsure = ds.filter((d) => d.req.kind === 'direction' && !d.value.sign).length;
  return { note: `${plural(spans.length, 'span')} · ${flipped} mirrored${unsure ? ` · ${unsure} can't tell` : ''}${facts ? ` · ${plural(facts, 'assist fact')}` : ''}`, facts: { flipped, unsure }, entry };
}

// ---- step 10: verify (independent checks; a redo re-runs regions..generate for that span) -------------------------
const NEXT = { roi: [regions, compare, direction], track: [compare, direction], direction: [direction], depth: [direction] };
function verifyReq(D, sp) {
  const app = D.app, keep = valOf(D, 'track:' + sp.key)?.keep, st = D.memo.compare[sp.key] || { runs: [], pairs: [] }, sf = D.facts?.scenes?.[sp.i];
  const script = scriptOf(app, 'stroke');
  const checks = D.L.verifyChecks({ seg: { t0: sp.t0, t1: sp.t1 }, keep: st.runs.find((r) => r.id === keep) || null, others: st.runs.filter((r) => r.id !== keep), pairs: st.pairs,
    script: script.filter((a) => a.at >= sp.t0 && a.at < sp.t1), loopPeriodMs: sf?.loop?.periodMs ?? null, prominence: sf?.loop?.prominence ?? 0, review: null });
  const pp = pickPairs(script, sp.t0, sp.t1, { k: 2, frameMs: 1000 / (app.doc.media?.fps || 30) });
  return makeReq(D, 'verify', sp.key, scopeOf(sp), {
    question: `${sp.name} at ${span(sp.t0, sp.t1)}: does the generated script match the video? Look at the two frames: the script says one is deep and one is out.`,
    facts: { segment: segmentOf(D, sp), keep, runs: st.runs, pairs: st.pairs, checks, pickPairs: pp.map(({ a, b }) => ({ a, b })) }, deps: ['track:' + sp.key, 'direction:' + sp.key, 'depth:' + sp.key],
    frames: pp.flatMap((p) => [{ t: p.a.at }, { t: p.b.at }]) });
}
export async function verify(D, draft, i) {
  const spans = spansOf(D).filter((sp) => valOf(D, 'track:' + sp.key)?.keep);
  if (!spans.length) return { skip: 'No span keeps a run' };
  if (!(await ensureFacts(D, draft, i))) return { cancelled: true };
  try { await trackersOf(D); } catch { /* verify works on the runs that exist */ }
  let todo = spans, ok = 0, redone = 0, queued = 0;
  while (todo.length) {
    for (const sp of todo) if (!D.memo.compare[sp.key]) { const st = await compareSpan(D, sp); if (!st) return { cancelled: true }; D.memo.compare[sp.key] = st; }
    const ds = await decideWith(D, todo.map((sp) => verifyReq(D, sp)));
    if (stop(draft)) return { cancelled: true };
    const again = [];
    for (const [k, d] of ds.entries()) {
      const sp = todo[k], v = d.value;
      if (d.status === 'queued') { queued++; continue; }
      if (v.verdict !== 'redo') { if (d.status !== 'fallback') { ok++; markVerified(D, sp, d.req.id); } continue; }
      const target = NEXT[v.redo] ? v.redo : null;
      if (!target || (d.req.attempt || 0) >= MAX_REDO) {
        // out of redos (or a story redo, which is not per span): the user decides
        D.memo.force[d.req.id] = 'user';
        D.memo.attempts[d.req.id] = d.req.attempt;
        const [u] = await decideWith(D, [verifyReq(D, sp)]);
        if (u?.status === 'queued') queued++;
        continue;
      }
      const tid = `${target}:${sp.key}`, tr = recOf(D, tid);
      D.memo.priors[tid] = { value: tr?.value ?? null, brain: tr?.brain || '' };
      D.memo.attempts[tid] = (tr?.attempt || 0) + 1;
      D.memo.attempts[d.req.id] = (d.req.attempt || 0) + 1;
      redone++;
      for (const step of NEXT[target]) { const r = await step(D, draft, i, true, [sp.key]); if (r?.cancelled) return r; }
      delete D.memo.compare[sp.key];
      const g = await draft.generate();
      if (g?.cancelled || stop(draft)) return { cancelled: true };
      again.push(sp);
    }
    todo = again;
  }
  for (const k of Object.keys(D.memo.attempts)) if (k.startsWith('verify:')) delete D.memo.attempts[k];
  return { note: `${ok}/${spans.length} verified${redone ? ` · ${plural(redone, 'redo')}` : ''}${queued ? ` · ${queued} to you` : ''}`, facts: { verified: ok, redone, queued }, entry: draft.top() };
}
function markVerified(D, sp, vid) {
  const recs = { ...D.records };
  for (const k of ['track', 'direction', 'depth']) { const id = `${k}:${sp.key}`; if (recs[id]) recs[id] = { ...recs[id], verifiedBy: vid }; }
  D.records = recs;
}

export const RUNNERS = { survey, story, regions, compare, direction, verify };
