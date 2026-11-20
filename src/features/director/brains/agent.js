// agent.js -- the external-agent brain (DESIGN §4.4, README §7): requests go to a file mailbox and/or the CDP
// surface, an Opus-class agent (or a human, or tools/director-agent/answer.mjs) answers. The agent may answer
// {need:[ToolCall]} instead of a value; this brain runs the tools (ctx.tools), adds the evidence and re-asks with
// round+1, bounded by maxRounds and the tools' budget. Round 0 is primed with the evidence the good director run
// looked at first (contact sheets, a 10% grid, overlays, blind A/B extreme pairs).
import { KINDS, validate } from '../../../lib/director/decisions.js';

export const AGENT_KINDS = KINDS.filter((k) => k !== 'depth');
/** Decision id -> mailbox file stem (ids hold ':', which Windows file names cannot). */
export const fileOf = (id) => String(id).replace(/[^\w@.-]/g, '_');
const msg = (e) => String(e?.message ?? e).split(/\r?\n/)[0].slice(0, 200);
const spread = (t0, t1, n) => Array.from({ length: n }, (_, i) => Math.round(t0 + ((i + 0.5) * (t1 - t0)) / n));

/** The first evidence for a request, before the agent asks for anything (trace 2's first looks per decision). */
export function primer(req) {
  const { t0, t1 } = req.scope, f = req.facts ?? {}, mid = Math.round((t0 + t1) / 2), dur = f.video?.dur ?? t1;
  switch (req.kind) {
    case 'camera': return [{ tool: 'frames', times: spread(t0, t1, 4), cols: 4, height: 240 }];
    case 'story': return [{ tool: 'frames', t0, t1, stepMs: Math.max(1000, Math.ceil((t1 - t0) / 16 / 500) * 500), cols: 4, height: 240 }];
    case 'climax': {
      const w = req.prior?.value?.window, a = w ? Math.max(0, w.t0 - 4000) : Math.round(0.4 * dur), b = w ? Math.min(dur, w.t1 + 4000) : dur;
      return [{ tool: 'frames', t0: a, t1: b, stepMs: w ? 500 : Math.max(1000, Math.ceil((b - a) / 16 / 500) * 500), cols: 4, height: 240 }];
    }
    case 'roi': return [{ tool: 'frames', times: [t0 + 500, mid], grid: 0.1, cols: 2, height: 360 }];
    case 'track': return (f.runs ?? []).filter((r) => r.role === 'subject').slice(0, 3).map((r) => ({ tool: 'overlay', run: r.id, times: [mid] }));
    case 'direction': return f.keep ? [{ tool: 'pairs', run: f.keep, t0, t1, k: 6 }] : [];
    case 'verify': return [{ tool: 'pairs', run: 'script', t0, t1, k: 4 }];
    default: return [];
  }
}

/** Blind-pair answers [{deep, shallow}] read against the pairs' known positions (facts.pickPairs): -> {sign, share, n}
 *  (sign 0 below 75% agreement) or null when no answered pair matches a known one (within 60 ms). */
export function signFromPairs(pairs, pickPairs, tol = 60) {
  let up = 0, n = 0;
  for (const p of pairs ?? []) {
    const k = (pickPairs ?? []).find(({ a, b }) => (Math.abs(a.at - p.deep) <= tol && Math.abs(b.at - p.shallow) <= tol) || (Math.abs(b.at - p.deep) <= tol && Math.abs(a.at - p.shallow) <= tol));
    if (!k || k.a.pos === k.b.pos) continue;
    const deep = Math.abs(k.a.at - p.deep) <= tol ? k.a : k.b, shallow = deep === k.a ? k.b : k.a;
    n++;
    if (deep.pos < shallow.pos) up++;
  }
  if (!n) return null;
  const share = Math.max(up, n - up) / n;
  return { sign: share >= 0.75 ? (up > n - up ? 1 : -1) : 0, share, n, up };
}

/** Fill what a pair-based answer leaves out: direction.sign, or a verify verdict from blind pairs. */
export function complete(req, value, raw) {
  if (!value || typeof value !== 'object') return { value, raw };
  if (req.kind === 'direction' && value.sign === undefined && Array.isArray(value.pairs)) {
    const s = signFromPairs(value.pairs, req.facts?.pickPairs);
    return { value: { ...value, sign: s?.sign ?? 0 }, raw: raw ?? (s ? Math.round(s.share * 95) / 100 : 0.5) };
  }
  if (req.kind === 'verify' && value.verdict === undefined && Array.isArray(value.pairs)) {
    const s = signFromPairs(value.pairs, req.facts?.pickPairs), agree = s ? s.up / s.n : null, ok = agree === null || agree >= 0.75;
    const check = { id: 'frames', ok, value: agree === null ? null : Math.round(agree * 100) / 100, limit: '>= 0.75 of blind pairs agree with the script' };
    return { value: { verdict: ok ? 'ok' : 'redo', ...(ok ? {} : { redo: 'direction' }), checks: [...(req.facts?.checks ?? []), check],
      note: s ? `${s.up}/${s.n} blind pairs agree` : 'no blind pair matched' }, raw: raw ?? (s ? Math.round(Math.max(agree, 1 - agree) * 95) / 100 : 0.5) };
  }
  return { value, raw };
}

/**
 * o: {io: {writeText, readText, listDir, remove, mkdir?} (app.backend-like; writeText must be atomic), root, session,
 *     cdp, pollMs}. Mailbox at <root>/<session>/{req,ans}. pending()/answer() are the CDP surface's agent half.
 */
export function makeAgentBrain({ io = null, root = null, session = null, cdp = false, pollMs = 500 } = {}) {
  const dir = io && root && session ? `${String(root).replace(/[\\/]+$/, '')}/${session}` : null;
  const waiting = new Map();   // id -> {req, resolve}
  let timer = null;
  const forAgent = (req) => ({ ...req, evidence: (req.evidence ?? []).map((e) => (e?.data?.order === undefined ? e : { ...e, data: { ...e.data, order: undefined } })) });
  const quiet = (p) => p?.catch?.(() => {});

  function answer(id, a) {
    const w = waiting.get(id);
    if (!w) return `no pending request "${id}"`;
    if (!a || typeof a !== 'object' || Array.isArray(a)) return 'answer must be an object';
    if (a.id != null && a.id !== id) return `answer id "${a.id}" does not match "${id}"`;
    if (a.round != null && a.round !== w.req.round) return `stale round ${a.round} (current round ${w.req.round})`;
    if (['value', 'need', 'abstain'].filter((k) => a[k] !== undefined).length !== 1) return 'exactly one of value | need | abstain';
    if (a.need !== undefined && !(Array.isArray(a.need) && a.need.length && a.need.every((c) => c && typeof c.tool === 'string'))) return 'need must be a non-empty array of tool calls';
    const out = { ...a, id };
    if (a.value !== undefined) {
      const c = complete(w.req, a.value, Number.isFinite(a.raw) ? a.raw : undefined), err = validate(w.req.kind, c.value, w.req);
      if (err) return err;
      Object.assign(out, { value: c.value, raw: c.raw ?? 0.8 });
    }
    w.resolve(out);
    return null;
  }

  const path = (sub, f) => `${dir}/${sub}/${f}`;
  async function poll() {
    timer = null;
    if (!dir || !waiting.size) return;
    let list = [];
    try { list = await io.listDir(`${dir}/ans`); } catch { /* not there yet */ }
    for (const e of list ?? []) {
      const name = e.name ?? String(e.path ?? '').split(/[\\/]/).pop();
      if (!name.endsWith('.json') || name.endsWith('.error.json') || name.startsWith('.')) continue;
      const stem = name.slice(0, -5), w = [...waiting.values()].find((x) => fileOf(x.req.id) === stem);
      if (!w) continue;
      let a, err;
      try { a = JSON.parse(await io.readText(e.path ?? path('ans', name))); } catch (x) { err = 'not JSON: ' + msg(x); }
      if (!err && a?.round != null && a.round !== w.req.round) { await quiet(io.remove(path('ans', name))); continue; }   // stale round: ignored
      err ??= answer(w.req.id, a);
      await quiet(io.remove(path('ans', name)));
      if (err) await quiet(io.writeText(path('ans', `${stem}.error.json`), JSON.stringify({ id: w.req.id, round: w.req.round, error: err })));
    }
    if (waiting.size && !timer) timer = setTimeout(poll, pollMs);
  }

  function wait(req, ctx) {
    return new Promise((resolve) => {
      let t = null;
      const finish = (a) => {
        if (!waiting.has(req.id)) return;
        clearTimeout(t); ctx.signal?.removeEventListener?.('abort', onAbort); waiting.delete(req.id);
        if (dir) quiet(io.remove(path('req', `${fileOf(req.id)}.json`)));
        resolve(a);
      };
      const onAbort = () => finish({ id: req.id, abstain: 'cancelled' });
      if (ctx.signal?.aborted) return resolve({ id: req.id, abstain: 'cancelled' });
      t = setTimeout(() => finish({ id: req.id, abstain: 'deadline' }), ctx.settings?.deadlineMs ?? 600000);
      ctx.signal?.addEventListener?.('abort', onAbort, { once: true });
      waiting.set(req.id, { req, resolve: finish });
      if (!dir) return;
      (async () => {
        await io.mkdir?.(`${dir}/req`); await io.mkdir?.(`${dir}/ans`);
        await quiet(io.remove(path('ans', `${fileOf(req.id)}.error.json`)));
        await io.writeText(path('req', `${fileOf(req.id)}.json`), JSON.stringify(forAgent(req), null, 1));
        if (!timer) timer = setTimeout(poll, pollMs);
      })().catch((e) => { if (!cdp) finish({ id: req.id, abstain: 'mailbox: ' + msg(e) }); else ctx.note?.(`mailbox: ${msg(e)}`); });
    });
  }

  async function one(req, ctx) {
    const evidence = [...(req.evidence ?? [])], tools = [];
    let round = req.round ?? 0;
    const run = async (call) => {
      const t = Date.now();
      let res;
      try { res = await ctx.tools.run(call, { reqId: req.id, round }); } catch (e) { res = { evidence: [], result: { error: msg(e) } }; }
      tools.push({ call, result: res?.result ?? {}, ms: Date.now() - t, round });
      evidence.push(...(res?.evidence ?? []));
      return !res?.result?.error;
    };
    if (ctx.tools && !evidence.length) for (const c of primer(req)) await run(c);
    for (;;) {
      const a = await wait({ ...req, round, evidence: [...evidence] }, ctx);
      if (a.need === undefined) return { ...a, tools };
      if (!ctx.tools) return { id: req.id, abstain: 'need: no tools in this session', tools };
      if (round + 1 >= (req.maxRounds ?? ctx.settings?.maxRounds ?? 3)) return { id: req.id, abstain: 'budget', rationale: 'out of rounds', tools };
      let ok = 0;
      for (const c of a.need) if (await run(c)) ok++;
      if (!ok) return { id: req.id, abstain: 'budget', rationale: 'every requested tool failed or is over budget', tools };
      round++;
    }
  }

  return {
    id: 'agent', kinds: AGENT_KINDS, dir,
    available: async () => !!dir || !!cdp,
    decide: (reqs, ctx) => Promise.all(reqs.map((r) => one(r, ctx))),
    /** Agent-routed requests waiting now (current round; the blind-pair order withheld). */
    pending: () => [...waiting.values()].map((w) => forAgent(w.req)),
    answer,
  };
}
