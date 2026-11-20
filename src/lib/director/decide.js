// decide.js -- route decision requests through the brain chains (README §5). Pure orchestration: brains, the
// calibration table, stored records and user overrides all come in through `o`.
import { chainFor, tauFor, DEFAULTS, validate, BRAINS_VERSION } from './decisions.js';
import { requestDigest } from './digest.js';
import { calibrate } from './calib.js';
import { STORY_NAMES, buildStory, logSoftmax } from './story.js';

const UNCALIBRATED = new Set(['agent', 'user']);
export const AGENT_CAP = 0.95;
const REPLAYABLE = new Set(['decided', 'replayed', 'provisional', 'queued', 'user']);
const msg = (e) => String(e?.message ?? e).split(/\r?\n/)[0].slice(0, 200);
const withoutEvidence = (kind, v) => { if (kind !== 'story' || !v?.evidence) return v; const { evidence, ...rest } = v; return rest; };

/** rules + vlm story answers -> one answer: per-second log scores summed, decoded once. null if they don't line up. */
export function combineStory(req, ra, va) {
  const R = ra?.value?.evidence, V = va?.value?.evidence;
  const same = (E) => E?.logp?.length && (!E.names || E.names.join() === STORY_NAMES.join());
  if (!same(R) || !same(V) || R.logp.length !== V.logp.length) return null;
  const logp = R.logp.map((row, i) => logSoftmax(row.map((x, k) => x + V.logp[i][k])));
  const { segments, raw } = buildStory(req, logp, { vis: V.vis, int: V.int, rate: R.rate ?? V.rate });
  return { value: { segments }, raw, rationale: `rules + vlm evidence summed per second, one Viterbi pass (${segments.map((s) => s.kind).join(', ')})` };
}

export async function decide(reqs, o = {}) {
  const { brains = {}, settings = {}, calib = null, records = {}, overrides = {}, skip = {}, ctx = {}, budget = null, enqueue = () => {} } = o;
  const now = ctx.now ?? (() => Date.now());
  const bctx = { ...ctx, settings, budget };
  const out = new Array(reqs.length), st = [];

  reqs.forEach((req, i) => {
    const t = now(), kind = req.kind;
    const chain = chainFor(kind, settings).filter((b) => !(skip[req.id] ?? []).includes(b));
    const deps = Object.fromEntries((req.deps ?? []).map((d) => [d, records[d]?.value ?? null]));
    const dg = requestDigest(req, deps, `${BRAINS_VERSION}|${settings.preset ?? ''}|${chain.join(',')}`);
    const base = { req, tools: [], digest: dg, ms: 0 };
    // 1. override
    const ov = overrides[req.id], ovErr = ov ? validate(kind, ov.value, req) : 'none';
    if (!ovErr) { out[i] = { ...base, value: ov.value, conf: 1, calibrated: false, brain: 'user', status: 'user', chain: [], rationale: 'answered by the user' }; return; }
    if (ov) ctx.note?.(`${req.id}: stored user answer ignored (${ovErr})`);
    // 2. replay
    const rec = records[req.id];
    if (rec && rec.digest === dg && REPLAYABLE.has(rec.status) && !validate(kind, rec.value, req)) {
      const status = rec.status === 'queued' || rec.status === 'provisional' ? rec.status : 'replayed';
      out[i] = { ...base, value: rec.value, conf: rec.conf, calibrated: !!rec.calibrated, brain: rec.brain, status, chain: rec.chain ?? [], rationale: rec.rationale ?? '', tools: rec.tools ?? [] };
      if (status === 'queued') enqueue(req, out[i]);
      return;
    }
    st.push({ i, req, chain, pos: 0, log: [], best: null, decided: null, queued: false, story: null, dg, t });
  });

  const consider = (s, bid, a) => {
    const kind = s.req.kind, raw = Number.isFinite(a.raw) ? Math.max(0, Math.min(1, a.raw)) : 0.5;
    const c = UNCALIBRATED.has(bid) ? { conf: Math.min(raw, AGENT_CAP), calibrated: false } : calibrate(calib, bid, kind, raw);
    s.log.push({ brain: bid, raw, conf: c.conf, ms: a._ms ?? 0 });
    const cand = { value: withoutEvidence(kind, a.value), conf: c.conf, calibrated: c.calibrated, brain: bid, rationale: a.rationale ?? '', tools: a.tools ?? [] };
    if (!s.best || cand.conf > s.best.conf) s.best = cand;
    if (c.conf >= tauFor(kind, settings)) s.decided = cand;
  };
  const flushStory = (s, va = null) => {
    if (!s.story) return;
    const ra = s.story;
    s.story = null;
    const both = va && combineStory(s.req, ra, va);
    if (both) { s.log.push({ brain: 'rules', raw: ra.raw ?? 0.5, ms: ra._ms ?? 0 }, { brain: 'vlm', raw: va.raw ?? 0.5, ms: va._ms ?? 0 }); consider(s, 'rules+vlm', both); }
    else { consider(s, 'rules', ra); if (va) consider(s, 'vlm', va); }
  };
  const take = (s, bid, a) => {
    const kind = s.req.kind;
    if (bid === 'user' && a.abstain === 'queued') { s.queued = true; s.log.push({ brain: bid, abstain: 'queued', ms: a._ms ?? 0 }); return; }
    if (a.need) a = { ...a, need: undefined, abstain: 'need: only the agent brain runs tools' };
    let err = a.abstain != null ? a.abstain : a.value === undefined ? 'no value' : null;
    if (!err) { const v = validate(kind, a.value, s.req); if (v) err = 'invalid: ' + v; }
    if (err) {
      s.log.push({ brain: bid, abstain: err, ms: a._ms ?? 0 });
      if (bid === 'vlm') flushStory(s);
      return;
    }
    if (kind === 'story' && bid === 'rules' && a.value.evidence && s.chain.slice(s.pos).includes('vlm')) { s.story = a; return; }
    if (kind === 'story' && bid === 'vlm' && s.story) { flushStory(s, a); return; }
    consider(s, bid, a);
  };

  // 3. the chains: each round, every unresolved request's next brain; one batch per brain
  for (;;) {
    if (ctx.signal?.aborted) break;
    const live = st.filter((s) => !s.decided && !s.queued && s.pos < s.chain.length);
    if (!live.length) break;
    const groups = new Map();
    for (const s of live) { const b = s.chain[s.pos++]; if (!groups.has(b)) groups.set(b, []); groups.get(b).push(s); }
    for (const [bid, group] of groups) {
      const brain = brains[bid];
      let avail = false;
      try { avail = !!brain && (await brain.available(bctx)); } catch { avail = false; }
      const ask = avail ? group.filter((s) => !brain.kinds || brain.kinds.includes(s.req.kind)) : [];
      for (const s of group) if (!ask.includes(s)) { s.log.push({ brain: bid, skipped: !brain ? 'missing' : !avail ? 'unavailable' : 'kind', ms: 0 }); if (bid === 'vlm') flushStory(s); }
      if (!ask.length) continue;
      const t = now();
      let answers;
      try { answers = await brain.decide(ask.map((s) => s.req), bctx); } catch (e) { answers = ask.map(() => ({ abstain: 'error: ' + msg(e) })); }
      const ms = now() - t;
      ask.forEach((s, j) => take(s, bid, { ...(answers?.[j] ?? { abstain: 'no answer' }), _ms: ms }));
    }
  }

  // 4./5. resolve
  for (const s of st) {
    flushStory(s);
    const { req } = s, kind = req.kind, best = s.decided ?? s.best;
    const d = { req, chain: s.log, digest: s.dg, ms: now() - s.t, tools: best?.tools ?? [] };
    if (s.decided) Object.assign(d, s.decided, { status: 'decided' });
    else if (best) Object.assign(d, best, { status: s.queued ? 'queued' : 'provisional' });
    else {
      let value = DEFAULTS[kind]?.(req) ?? null;
      const err = value && validate(kind, value, req);
      if (err) { ctx.note?.(`${req.id}: default invalid (${err})`); value = null; }
      Object.assign(d, { value, conf: 0, calibrated: false, brain: 'default', rationale: 'no brain answered: default', status: s.queued ? 'queued' : 'fallback' });
    }
    out[s.i] = d;
    if (s.queued) enqueue(req, d);
  }
  return out;
}
