// generate-logic.js -- the pure half of plan generation ("edit the plan, not the points"): the compile context,
// generate / detach as value transforms, the preview ghost's points, import-merge, and the recipe -> form
// schema mapping for the inspector. No DOM, no Svelte, no deps.js: the gen functions are passed in, so node
// tests run them against the real src/lib/gen/plan.js. generate.js wires this to the app.
import { genTargets, stamp, segState, segKey, schemaOf } from './plan.js';
import { remove, sorted } from './intervals.js';
import { hashSeed } from '../../lib/gen/util.js';
import { lowerBound } from '../../lib/core/script.js';
import { COMMON_SCHEMA } from '../../lib/gen/generators.js';
import { coerce } from '../../ui/kit/params.js';
import { effectiveMaxSpeed, getProfile } from '../../lib/analyze/profiles.js';

export const PREVIEW_ID = 'timeline:plan-preview';
export const DEFAULT_MAX_SPEED = 450;

/** The active device profile's speed cap (units/s), resolved like lanes/deps.js profileOf: the review feature's
 *  profile, else the device preview's, else the persisted `review.profile` choice. 0 when the app has none
 *  (no settings: harness / tests), so planCtx falls back to DEFAULT_MAX_SPEED. */
export function activeMaxSpeed(app) {
  const p = app?.review?.profile ?? app?.devicePreview?.profile
    ?? (app?.settings?.get ? getProfile(app.settings.get('review.profile', 'generic'), app.settings.get('review.profiles', []) || []) : null);
  return p ? +effectiveMaxSpeed(p) || 0 : 0;
}

// ---- compile context ----
/** Turning points of a script: [{at, kind: 'top'|'bottom'}] (pos 100 = out = top). A plateau turns at its
 *  first point; the first and last points count as the extremes of the first and last moves. */
export function turnsOf(script) {
  const out = [];
  let dir = 0, ext = 0;   // direction of the last move, index where it ended
  for (let i = 1; i < script.length; i++) {
    const d = Math.sign(script[i].pos - script[i - 1].pos);
    if (!d) continue;
    if (d !== dir) out.push({ at: script[dir ? ext : 0].at, kind: d > 0 ? 'bottom' : 'top' });
    dir = d; ext = i;
  }
  if (dir) out.push({ at: script[ext].at, kind: dir > 0 ? 'top' : 'bottom' });
  return out;
}

// ---- which tracker run a segment follows ----
/** Tracker runs on `axis` in doc order (oldest first): visible ones, or all with `all`. */
export const trackerRuns = (ghosts = [], axis = 'stroke', all = false) =>
  ghosts.filter((g) => g?.source?.kind === 'tracker' && (all || g.visible !== false) && (g.axis ?? 'stroke') === axis && g.script?.length);
/** A run's time range: the tracked range when the run recorded one (source.range), else its first..last point. */
export function runRange(g) {
  const r = g.source?.range, t0 = r?.start ?? r?.start_ms ?? r?.t0, t1 = r?.end ?? r?.end_ms ?? r?.t1;
  return Number.isFinite(t0) && Number.isFinite(t1) ? { t0, t1 } : { t0: g.script[0].at, t1: g.script[g.script.length - 1].at };
}
const overlap = (g, s) => { const r = runRange(g); return Math.min(r.t1, s.t1) - Math.max(r.t0, s.t0); };
/** Runs whose range overlaps the segment. */
export const runsOver = (s, runs) => runs.filter((g) => overlap(g, s) > 0);
/**
 * The run whose turns a segment follows. An explicit `source` (a ghost id) names any tracker run on the axis,
 * hidden or not (null when it is gone); 'auto' / none = the visible run with the largest overlap, newest on ties.
 */
export function chooseRun(s, runs, all = runs) {
  if (s.source && s.source !== 'auto') return all.find((g) => g.id === s.source) ?? null;
  let best = null, bo = 0;
  for (const g of runs) { const o = overlap(g, s); if (o > 0 && o >= bo) { best = g; bo = o; } }
  return best;
}
/** Short label of a run for chips and menus: its name up to the first ':' ("Run 2: flow" -> "Run 2"). */
export const runLabel = (g) => (g ? String(g.name || g.id).split(/:\s/)[0].trim() : '');   // ': ' only: run titles hold m:ss times

const turnCache = new WeakMap(), turnIds = new WeakMap();
let turnSeq = 0;
const cachedTurns = (script) => { let t = turnCache.get(script); if (!t) { turnCache.set(script, (t = turnsOf(script))); turnIds.set(t, ++turnSeq); } return t; };
const firstAt = (t, x) => { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m].at < x) lo = m + 1; else hi = m; } return lo; };

/**
 * ctx for compilePlan/applyPlan: seed stable per video (its file name), the device speed cap, and turns composed
 * per segment: each segment contributes the turns of ITS run (chooseRun) inside its own span, so per-scene
 * tracker runs compose. -> {ctx, pick: Map(segId -> run id | null), turnsFor(seg) (for staleness), key}.
 * `key` changes whenever the output would (a run edited = a new script = new turns identity).
 */
export function planCtx(doc, { maxSpeed = 0, plan = doc.plan ?? [] } = {}) {
  const axis = doc.activeAxis ?? 'stroke', runs = trackerRuns(doc.ghosts, axis), all = trackerRuns(doc.ghosts, axis, true);
  const turns = [], pick = new Map();
  let k = '';
  for (const s of sorted(plan)) {
    const g = chooseRun(s, runs, all);
    pick.set(s.id, g?.id ?? null);
    if (!g) continue;
    const t = cachedTurns(g.script);
    let i = firstAt(t, s.t0);
    const i0 = i;
    for (; i < t.length && t[i].at <= s.t1; i++) if (!turns.length || t[i].at > turns[turns.length - 1].at) turns.push(t[i]);
    k += `${s.id}:${g.id}:${turnIds.get(t)}:${i0}-${i}|`;
  }
  const ctx = { seed: hashSeed(doc.media?.name ?? ''), maxSpeed: maxSpeed > 0 ? maxSpeed : DEFAULT_MAX_SPEED, turns };
  const turnsFor = (s) => { const g = chooseRun(s, runs, all); return g ? cachedTurns(g.script) : null; };
  return { ctx, pick, runs, all, turnsFor, key: `${ctx.seed}|${ctx.maxSpeed}|${k}` };
}

/** What the compile output depends on in the plan (genKey/locked/name excluded). */
export const planSig = (plan) => plan.map((s) => s.id + segKey(s) + (s.source ?? '')).join('|');

// ---- generate / detach as value transforms ----
/**
 * Compile the whole plan (joins between neighbours stay right), write only the targets' spans into `base`.
 * -> {targets, done (ids written), script, plan (targets stamped), issues, res}. Non-target spans -- hand
 * edits, locked and fresh segments -- keep their points; applyPlan blends the joins without removing them.
 * `res` may be passed to reuse a compile of the same plan + ctx (the live preview's).
 */
export function generatePlan(base, plan, { scope = 'needed', sel = [], ctx = {}, gen, res = null }) {
  const targets = genTargets(plan, scope, sel);
  if (!targets.length) return { targets, done: [], script: base, plan, issues: [], res };
  res ??= gen.compilePlan(plan, ctx);
  const ids = new Set(targets.map((s) => s.id));
  const segments = res.segments.filter((s) => ids.has(s.id));
  const done = segments.map((s) => s.id);
  const script = done.length ? gen.applyPlan(base, { ...res, segments }, ctx) : base;
  return { targets, done, script, plan: stamp(plan, done), issues: res.issues.filter((i) => i.id == null || ids.has(i.id)), res };
}

/** Generate `ids` that need it (new / stale, not locked), then drop them from the plan; points stay as points. */
export function detachPlan(base, plan, ids, opts) {
  const want = new Set(ids);
  const need = plan.filter((s) => want.has(s.id) && segState(s) !== 'fresh' && segState(s) !== 'locked').map((s) => s.id);
  const g = need.length ? generatePlan(base, plan, { ...opts, scope: 'selected', sel: need }) : { script: base, issues: [], done: [] };
  return { script: g.script, plan: remove(plan, ids), issues: g.issues, generated: g.done };
}

/** Lock all of `ids` unless every one is already locked (then unlock). */
export function toggleLocked(plan, ids) {
  const want = new Set(ids), sel = plan.filter((s) => want.has(s.id));
  const lock = sel.some((s) => !s.locked);
  return plan.map((s) => {
    if (!want.has(s.id)) return s;
    if (lock) return s.locked ? s : { ...s, locked: true };
    if (!s.locked) return s;
    const { locked, ...rest } = s;
    return rest;
  });
}

/** {new, fresh, stale, locked} counts. */
export function stateCounts(plan) {
  const c = { new: 0, fresh: 0, stale: 0, locked: 0 };
  for (const s of plan) c[segState(s)]++;
  return c;
}

// ---- preview ----
/** The compiled points inside the segments `ids` (in time order, shared boundary instants once). */
export function sliceSegments(res, ids) {
  const want = new Set(ids), out = [];
  for (const s of [...res.segments].sort((a, b) => a.t0 - b.t0)) {
    if (!want.has(s.id)) continue;
    for (let i = lowerBound(res.script, s.t0), e = lowerBound(res.script, s.t1 + 1); i < e; i++) {
      const a = res.script[i];
      if (!out.length || a.at > out[out.length - 1].at) out.push(a);
    }
  }
  return out;
}

/** ghosts with our preview entry replaced (or removed when `ghost` is null); other entries keep identity. */
export function withGhost(ghosts = [], ghost) {
  const i = ghosts.findIndex((g) => g.id === PREVIEW_ID);
  if (!ghost) return i < 0 ? ghosts : ghosts.filter((_, k) => k !== i);
  return i < 0 ? [...ghosts, ghost] : ghosts.map((g, k) => (k === i ? ghost : g));
}

/** Issues grouped by segment id ('' for plan-wide). */
export function issuesById(issues = []) {
  const m = new Map();
  for (const i of issues) { const k = i.id ?? ''; if (!m.has(k)) m.set(k, []); m.get(k).push(i); }
  return m;
}

// ---- import ----
/** Free parts of [t0, t1] not covered by a sorted, non-overlapping list. */
function freeParts(list, t0, t1) {
  const out = [];
  let a = t0;
  for (const x of list) {
    if (x.t1 <= a) continue;
    if (x.t0 >= t1) break;
    if (x.t0 > a) out.push([a, x.t0]);
    a = Math.max(a, x.t1);
    if (a >= t1) break;
  }
  if (a < t1) out.push([a, t1]);
  return out;
}
/** Imported segments clipped into the gaps of `plan` (existing segments win). A segment split by an existing
 *  one becomes several (extra pieces get newId()). -> {plan, added, dropped, trimmed}. */
export function mergeIntoGaps(plan, incoming, { newId, minLen = 1 }) {
  let list = sorted(plan);
  let added = 0, dropped = 0, trimmed = 0;
  for (const s of sorted(incoming)) {
    const parts = freeParts(list, s.t0, s.t1).filter(([a, b]) => b - a >= minLen);
    if (!parts.length) { dropped++; continue; }
    if (parts.length !== 1 || parts[0][0] !== s.t0 || parts[0][1] !== s.t1) trimmed++;
    const pieces = parts.map(([t0, t1], i) => ({ ...s, id: i ? newId() : s.id, t0, t1 }));
    added += pieces.length;
    list = sorted([...list, ...pieces]);
  }
  return { plan: list, added, dropped, trimmed };
}

// ---- inspector form ----
// The form's collapsed 'More' group: the shaping params every generator shares, plus the tracking knobs of
// follow-based recipes and the timing fine print. What stays up front is what a scripter reaches for.
const MORE = new Set([...COMMON_SCHEMA.map((p) => p.key), 'phase', 'inFrac', 'carry', 'gapFactor', 'gapMinMs', 'fallbackRate', 'minHalfMs', 'contextMs', 'timing']);
const FRONT = 8;
const nameOf = (v) => (v && typeof v === 'object' ? v.name : v);
const shortUnit = (u) => (!u ? u : /^x\b/.test(u) ? '×' : u);
/**
 * A recipe's params as a kit ParamForm schema: intensity left out (the inspector has its own slider), json
 * params left out (no control; the `custom` shape's knots), shapes as a choice of names, the shaping and
 * tracking fine print grouped under 'More', long units shortened (the full one goes to the hint).
 */
export function formSchema(recipe) {
  const out = [];
  let front = 0;
  for (const p of schemaOf(recipe)) {
    if (p.key === 'intensity' || p.type === 'json') continue;
    const q = { key: p.key, label: p.label, type: p.type, default: p.default };
    if (p.type === 'shape') Object.assign(q, { type: 'choice', default: nameOf(p.default), choices: p.choices, control: 'select' });
    else if (p.type === 'choice') Object.assign(q, { choices: p.choices, control: p.choices.length > 3 ? 'select' : undefined });
    else for (const k of ['min', 'max', 'step']) if (p[k] != null) q[k] = p[k];
    const u = shortUnit(p.unit);
    if (u) q.unit = u;
    if (u !== p.unit) q.hint = p.unit;
    if (MORE.has(p.key) || ++front > FRONT) q.group = 'More';
    if (p.type === 'shape') q.shape = true;
    out.push(q);
  }
  return out;
}

/** The form's values for a segment: its override, else the recipe default; shapes by name. */
export function formValues(seg, schema = formSchema(seg.recipe)) {
  const v = {};
  for (const p of schema) v[p.key] = p.shape ? nameOf(seg.params?.[p.key] ?? p.default) : seg.params?.[p.key] ?? p.default;
  return v;
}

/** Keys that are overridden in the segment AND differ from the recipe default. */
export function overridden(seg, schema = formSchema(seg.recipe)) {
  const v = formValues(seg, schema);
  return new Set(schema.filter((p) => seg.params?.[p.key] !== undefined && coerce(p, v[p.key]) !== coerce(p, p.default)).map((p) => p.key));
}

/**
 * setParams patch for the keys whose form value changed from `prev`: a value equal to the recipe default
 * removes the override (undefined); a shape keeps an object override when only its name was "re-picked".
 */
export function paramPatch(schema, values, prev, seg) {
  const patch = {};
  for (const p of schema) {
    const v = coerce(p, values[p.key]);   // the form coerces (snaps to step); compare like with like
    if (v === coerce(p, prev[p.key])) continue;
    if (v === coerce(p, p.default)) patch[p.key] = undefined;
    else if (p.shape && nameOf(seg.params?.[p.key]) === v) patch[p.key] = seg.params[p.key];
    else patch[p.key] = v;
  }
  return patch;
}
