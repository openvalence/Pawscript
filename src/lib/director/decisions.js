// decisions.js -- the director contract in code (src/lib/director/README.md §1-5): decision kinds, policy, presets,
// defaults, validation and the request builder. Pure; no app, no Svelte. pos 0 = deepest, 100 = out.
import { RECIPES, KINDS as GEN_KINDS } from '../gen/recipes.js';
import { digest } from './digest.js';

export const SCHEMA = 'pawscript.director/1';
/** Bumped when a brain's logic changes, so stored answers stop replaying (part of every request digest). */
export const BRAINS_VERSION = 'brains/2';   // 2: climax split into the run-in (climax) and the orgasm
export const KINDS = ['camera', 'climax', 'story', 'roi', 'track', 'direction', 'depth', 'verify'];
/** Story segment kinds (plan kinds). */
export const KIND_IDS = ['idle', 'fade-in', 'foreplay', 'oral', 'penetration', 'knotting', 'climax', 'orgasm', 'afterglow', 'outro', 'offscreen', 'custom'];
/** Kinds with sexual action going on (visible or not). */
export const ACTIVE = new Set(['foreplay', 'oral', 'penetration', 'knotting', 'climax', 'orgasm', 'afterglow', 'offscreen', 'custom']);
const SPAN_KINDS = new Set(['roi', 'track', 'direction', 'depth', 'verify']);

export const POLICY = {
  camera: { tau: 0.80, chain: ['rules', 'agent', 'user'] },
  climax: { tau: 0.85, chain: ['rules', 'vlm', 'agent', 'user'] },
  story: { tau: 0.75, chain: ['rules', 'vlm', 'agent', 'user'] },
  roi: { tau: 0.70, chain: ['rules', 'agent', 'user'] },
  track: { tau: 0.75, chain: ['rules', 'agent', 'user'] },
  direction: { tau: 0.90, chain: ['rules', 'agent', 'user'] },
  depth: { tau: 0.60, chain: ['rules'] },
  verify: { tau: 0.80, chain: ['rules', 'agent', 'user'] },
};
export const PRESETS = { rules: ['rules'], 'rules+vlm': ['rules', 'vlm'], 'rules+vlm+agent': ['rules', 'vlm', 'agent'], ask: ['rules', 'vlm', 'agent', 'user'] };
export const DEFAULT_SETTINGS = Object.freeze({
  preset: 'rules+vlm', askUser: true, vlmModel: null, agentRoot: null, cdp: false, override: {},
  deadlineMs: 600000, maxRounds: 3, budget: { tracks: 12, gpuS: 900, images: 60 },
});

/** Brains to try for a kind, in order. 'replay' passes only when an override chain names it (fixtures, tests). */
export function chainFor(kind, settings = {}) {
  const over = settings.override?.[kind]?.chain, base = over ?? POLICY[kind]?.chain ?? [];
  const ok = new Set([...(PRESETS[settings.preset] ?? PRESETS.rules), ...(settings.askUser !== false ? ['user'] : []), ...(over?.includes('replay') ? ['replay'] : [])]);
  return base.filter((b) => ok.has(b));
}
export const tauFor = (kind, settings = {}) => settings.override?.[kind]?.tau ?? POLICY[kind]?.tau ?? 1;

// ---- channels ----
/** Channel classes for camera.valid: relative = camera-invariant two-body / shape measures; single = the rest. */
export const RELATIVE = new Set(['dist01', 'area', 'len_over_width']);
export const channelClass = (c) => (RELATIVE.has(c) ? 'relative' : 'single');
export const channelOk = (channel, valid) => !channel || !Array.isArray(valid) || valid.includes(channelClass(channel));

// ---- ids, requests ----
export const scopeId = (kind, scope) => (kind === 'climax' || scope?.scene == null ? 'v' : SPAN_KINDS.has(kind) ? `s${scope.scene}@${scope.t0}` : `s${scope.scene}`);
export const idOf = (kind, scope) => `${kind}:${scopeId(kind, scope)}`;
/** Probe id: digest of what makes a tracking run. */
export const probeId = ({ tracker, roi, params }, t0, t1) => digest({ tracker, roi: roi ?? null, params: params ?? {}, t0, t1 });
export const clock = (ms) => { const s = Math.max(0, ms) / 1000, m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };
const span = (sc) => `${clock(sc.t0)}–${clock(sc.t1)}`;
const where = (sc) => (sc.scene == null ? `the video (${span(sc)})` : `scene ${sc.scene} (${span(sc)})`);

/** Plain-language question per kind (self-contained, for the agent mailbox and the user cards). */
export function questionFor(kind, scope) {
  const w = where(scope);
  switch (kind) {
    case 'camera': return `In ${w}, is the camera static, riding with the strokes (the frame bumps in time with them), moving (pan / zoom / push-in) or swaying? Which tracker channels stay valid (single-body, relative two-body, rate only)?`;
    case 'climax': return 'Where is the orgasm (ejaculation, cum spurting) in this video, if anywhere? Give its window {t0, t1} in ms (first spurt to where it fades; the fast climax strokes before it are added by code) and where the afterglow ends (afterglowTo), or window null.';
    case 'story': return `Split ${w} into segments that tile it: kind (idle, fade-in, foreplay, oral, penetration, knotting, climax = the fast full strokes right before the orgasm, orgasm, afterglow, outro, offscreen, custom), whether the contact is visible, whether the action continues, intensity 0..1.`;
    case 'roi': return `In ${w}, what should be tracked to follow the strokes? Up to 3 subject probes (tracker, box or points, params) plus 1 reference probe on a static background, or none (offscreen / camera / still).`;
    case 'track': return `In ${w}, which tracker run follows the strokes? Keep one run (and its channel) or none with a fallback recipe; list the runs that agree and why the others are rejected.`;
    case 'direction': return `In ${w}, compare the blind A/B frame pairs from the kept run: in each pair, which frame is DEEPER (more inserted / bodies pressed together)? Answer {pairs:[{deep, shallow}]} in ms, or sign 0 if it cannot be seen.`;
    case 'depth': return `In ${w}, what depth range does the action use (lo = deep end, hi = out end, 0..100) and how intense is it (0..1)?`;
    case 'verify': return `Does the generated script match the video in ${w}? Check the frames at its extremes (blind A/B pairs): ok, or which decision to redo (story, roi, track, direction, depth).`;
    default: return `Decide ${kind} for ${w}.`;
  }
}

const plain = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
/** A DecisionRequest with the contract's fields filled in. o: {attempt, maxRounds, frames, deps, prior, choices, question}. */
export function makeRequest(kind, scope, facts = {}, o = {}) {
  return plain({
    schema: SCHEMA, id: idOf(kind, scope), kind, scope, attempt: o.attempt ?? 0, round: 0, maxRounds: o.maxRounds ?? 3,
    question: o.question ?? questionFor(kind, scope), facts, frames: o.frames, deps: o.deps ?? [], prior: o.prior,
    evidence: o.evidence ?? [], choices: o.choices,
  });
}

// ---- defaults (status 'fallback') ----
const segOf = (req) => req.facts?.segment ?? null;
const recipeOf = (req) => segOf(req)?.recipe ?? GEN_KINDS[segOf(req)?.kind]?.recipe ?? 'penetration';
export const WHOLE = Object.freeze({ kind: 'box', x: 0, y: 0, w: 1, h: 1 });
/** Story default: one segment over the scope. brains/rules.js replaces `kindOf` with draft's RULES table on import
 *  (lib never imports features). */
export const storyDefault = { kindOf: () => 'penetration' };

export const DEFAULTS = {
  camera: () => ({ mode: 'static', p95Px: 0, rateHz: null, phaseMs: null, moveSpans: [], valid: ['single', 'relative', 'rate'] }),
  climax: () => ({ window: null, afterglowTo: null }),
  story: (req) => {
    const kind = storyDefault.kindOf(req.facts?.scene ?? null) ?? 'penetration', { t0, t1 } = req.scope;
    return { segments: [{ t0, t1, kind, visible: kind !== 'offscreen', action: ACTIVE.has(kind) ? 'continues' : 'stops', intensity: 1, name: kind }] };
  },
  roi: (req) => {
    const boxes = req.facts?.scene?.describe?.boxes ?? [], b = [...boxes].sort((x, y) => y.score - x.score)[0];
    const roi = b ? { kind: 'box', ...b.box } : { ...WHOLE }, params = { axis: 'auto' }, { t0, t1 } = req.scope;
    return { probes: [{ id: probeId({ tracker: 'lk_box', roi, params }, t0, t1), tracker: 'lk_box', roi, params, role: 'subject', part: b?.tag ?? 'frame' }] };
  },
  track: (req) => ({ keep: null, agree: [], reject: {}, fallback: { recipe: recipeOf(req), params: {} } }),
  direction: () => ({ sign: 0, pairs: [] }),
  depth: (req) => {
    const p = RECIPES[recipeOf(req)]?.params ?? {};
    return { lo: p.lo ?? p.pos ?? 0, hi: p.hi ?? p.pos ?? 100, intensity: 1 };
  },
  verify: () => ({ verdict: 'ok', checks: [], note: 'unchecked' }),
};

// ---- validation (every trust boundary: agent answers, user overrides, replay) ----
const isObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const in01 = (x) => num(x) && x >= 0 && x <= 1;
const isBox = (b) => isObj(b) && [b.x, b.y, b.w, b.h].every(in01) && b.w > 0 && b.h > 0;
function isRoi(r) {
  if (r === null) return true;
  if (!isObj(r)) return false;
  if (r.kind === 'box') return isBox(r);
  return r.kind === 'points' && Array.isArray(r.points) && r.points.length > 0 && r.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(in01));
}

/** -> the first problem found, or null. `req` (optional) enables the scope / run-id / camera.valid checks. */
export function validate(kind, v, req = null) {
  if (!isObj(v)) return `${kind}: value must be an object`;
  const sc = req?.scope, inScope = (t) => !sc || (t >= sc.t0 && t <= sc.t1);
  const valid = req?.facts?.camera?.valid;
  switch (kind) {
    case 'camera': {
      if (!['static', 'rides', 'move', 'sway'].includes(v.mode)) return 'camera.mode must be static|rides|move|sway';
      if (!num(v.p95Px) || v.p95Px < 0) return 'camera.p95Px must be a number >= 0';
      if (v.rateHz !== null && !num(v.rateHz)) return 'camera.rateHz must be a number or null';
      if (v.phaseMs !== null && !num(v.phaseMs)) return 'camera.phaseMs must be a number or null';
      if (!Array.isArray(v.moveSpans) || !v.moveSpans.every((s) => Array.isArray(s) && num(s[0]) && num(s[1]) && s[0] < s[1])) return 'camera.moveSpans must be [[t0,t1],...]';
      if (v.moveSpans.some((s) => !inScope(s[0]) || !inScope(s[1]))) return 'camera.moveSpans outside the scope';
      if (!Array.isArray(v.valid) || !v.valid.length || !v.valid.every((c) => ['single', 'relative', 'rate'].includes(c))) return 'camera.valid must list single|relative|rate';
      return null;
    }
    case 'climax': {
      if (v.window !== null) {
        if (!isObj(v.window) || !num(v.window.t0) || !num(v.window.t1) || v.window.t0 >= v.window.t1) return 'climax.window must be {t0 < t1} or null';
        if (!inScope(v.window.t0) || !inScope(v.window.t1)) return 'climax.window outside the video';
      }
      if (v.afterglowTo !== null && !num(v.afterglowTo)) return 'climax.afterglowTo must be a number or null';
      if (v.afterglowTo !== null && v.window && v.afterglowTo < v.window.t1) return 'climax.afterglowTo before the window end';
      if (v.afterglowTo !== null && !inScope(v.afterglowTo)) return 'climax.afterglowTo outside the video';
      return null;
    }
    case 'story': {
      const s = v.segments;
      if (!Array.isArray(s) || !s.length) return 'story.segments must be a non-empty array';
      for (const [i, g] of s.entries()) {
        if (!isObj(g) || !num(g.t0) || !num(g.t1)) return `story.segments[${i}]: t0/t1 must be numbers`;
        if (g.t1 - g.t0 < 250) return `story.segments[${i}]: shorter than 250 ms`;
        if (!KIND_IDS.includes(g.kind)) return `story.segments[${i}]: unknown kind "${g.kind}"`;
        if (typeof g.visible !== 'boolean') return `story.segments[${i}]: visible must be a boolean`;
        if (!['continues', 'stops', 'unknown'].includes(g.action)) return `story.segments[${i}]: action must be continues|stops|unknown`;
        if (!in01(g.intensity)) return `story.segments[${i}]: intensity must be 0..1`;
        if (g.recipe != null && !RECIPES[g.recipe]) return `story.segments[${i}]: unknown recipe "${g.recipe}"`;
        if (g.params != null && !isObj(g.params)) return `story.segments[${i}]: params must be an object`;
        if (typeof g.name !== 'string') return `story.segments[${i}]: name must be a string`;
        if (i && g.t0 !== s[i - 1].t1) return `story.segments[${i}]: gap or overlap at ${g.t0} ms`;
      }
      if (sc && (s[0].t0 !== sc.t0 || s[s.length - 1].t1 !== sc.t1)) return `story.segments must tile ${sc.t0}-${sc.t1}`;
      return null;
    }
    case 'roi': {
      if (!Array.isArray(v.probes) || v.probes.length > 5) return 'roi.probes must be an array of at most 5';
      if (v.none != null && !['offscreen', 'camera', 'still'].includes(v.none)) return 'roi.none must be offscreen|camera|still';
      if (!v.probes.length && v.none == null) return 'roi: no probes and no `none` reason';
      for (const [i, p] of v.probes.entries()) {
        if (!isObj(p) || typeof p.id !== 'string' || typeof p.tracker !== 'string') return `roi.probes[${i}]: id and tracker must be strings`;
        if (!isRoi(p.roi)) return `roi.probes[${i}]: bad roi`;
        if (!isObj(p.params)) return `roi.probes[${i}]: params must be an object`;
        if (!['subject', 'reference'].includes(p.role)) return `roi.probes[${i}]: role must be subject|reference`;
        if (typeof p.part !== 'string') return `roi.probes[${i}]: part must be a string`;
        if (p.channel != null && (typeof p.channel !== 'string' || (p.role === 'subject' && !channelOk(p.channel, valid)))) return `roi.probes[${i}]: channel "${p.channel}" not allowed by camera.valid`;
      }
      return null;
    }
    case 'track': {
      const runs = req?.facts?.runs, known = (id) => !runs || runs.some((r) => r.id === id);
      if (v.keep !== null && typeof v.keep !== 'string') return 'track.keep must be a run id or null';
      if (v.keep !== null && !known(v.keep)) return `track.keep "${v.keep}" is not among the runs`;
      if (v.channel != null && typeof v.channel !== 'string') return 'track.channel must be a string';
      if (v.keep !== null && !channelOk(v.channel ?? runs?.find((r) => r.id === v.keep)?.channel, valid)) return `track: channel not allowed by camera.valid (${valid})`;
      if (!Array.isArray(v.agree) || !v.agree.every((id) => typeof id === 'string' && known(id))) return 'track.agree must list run ids among the runs';
      if (!isObj(v.reject) || !Object.entries(v.reject).every(([id, why]) => known(id) && typeof why === 'string')) return 'track.reject must map run ids (among the runs) to reasons';
      if (v.fallback != null && (!isObj(v.fallback) || !RECIPES[v.fallback.recipe] || !isObj(v.fallback.params ?? {}))) return 'track.fallback must be {recipe (known), params}';
      return null;
    }
    case 'direction': {
      if (![1, -1, 0].includes(v.sign)) return 'direction.sign must be 1, -1 or 0';
      if (!Array.isArray(v.pairs)) return 'direction.pairs must be an array';
      for (const [i, p] of v.pairs.entries()) {
        if (!isObj(p) || !num(p.deep) || !num(p.shallow) || p.deep === p.shallow) return `direction.pairs[${i}] must be {deep, shallow} (ms, different)`;
        if (!inScope(p.deep) || !inScope(p.shallow)) return `direction.pairs[${i}] outside the scope`;
      }
      return null;
    }
    case 'depth': {
      if (!num(v.lo) || !num(v.hi) || v.lo < 0 || v.hi > 100 || v.lo > v.hi) return 'depth: need 0 <= lo <= hi <= 100';
      if (!in01(v.intensity)) return 'depth.intensity must be 0..1';
      return null;
    }
    case 'verify': {
      if (!['ok', 'redo'].includes(v.verdict)) return 'verify.verdict must be ok|redo';
      if (v.verdict === 'redo' && !['story', 'roi', 'track', 'direction', 'depth'].includes(v.redo)) return 'verify.redo must be story|roi|track|direction|depth';
      if (!Array.isArray(v.checks) || !v.checks.every((c) => isObj(c) && typeof c.id === 'string' && typeof c.ok === 'boolean' && (c.value === null || num(c.value) || typeof c.value === 'string') && typeof c.limit === 'string')) return 'verify.checks must be [{id, ok, value, limit}]';
      if (typeof v.note !== 'string') return 'verify.note must be a string';
      return null;
    }
    default: return `unknown decision kind "${kind}"`;
  }
}
