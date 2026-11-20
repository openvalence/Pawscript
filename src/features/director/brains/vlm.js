// vlm.js -- the local VLM brain: single-token fixed-choice questions over keyframes through the sidecar's
// `director.ask` (README §8.5), assembled by code as in trackers/experiments/stage/stage_director.py (the pattern
// that worked in experiments/vlm/story.py "small" mode). Answers `story` (per-second evidence that decide() adds to
// the rules' before one Viterbi pass) and `climax` (through the relative rule only). Never direction, depth,
// verify, roi or track: measured worse than flow (DESIGN §1.4).
import { ACTIVE, clock } from '../../../lib/director/decisions.js';
import { STORY_NAMES, STEP_MS, buildStory, energyPerStep, logSoftmax, median, stepsOf } from '../../../lib/director/story.js';

// stage_director.py DOMAIN.adult, verbatim
export const Q = {
  kind: 'Which best describes what is happening at this moment?\n'
    + 'a = black screen, logo or title card\nb = characters, no sexual activity yet (story, intro)\n'
    + 'c = foreplay: kissing, licking, rimming, touching, handjob\nd = oral sex (blowjob, cunnilingus)\n'
    + 'e = penetration (vaginal or anal sex)\nf = knotting: the knot at the base of the penis is pushed in, '
    + 'pulled out or tied\ng = face close-up or cutaway while sex continues off-screen\n'
    + 'h = orgasm: ejaculation, cum spurting\ni = after sex, resting, slowing down\nj = end credits or end card\n'
    + 'Answer with the letter.',
  cont: 'Is sexual activity going on at this moment, even if it is not visible in this frame? Answer yes or no.',
  vis: 'Is the sexual contact itself (genitals, penetration or oral contact) visible in this frame? Answer yes or no.',
  int: 'How intense is the sexual action at this moment? a = none, b = slow and gentle, c = moderate, d = fast and intense. Answer with the letter.',
};
export const CHOICES = { kind: [...'abcdefghij'], cont: ['yes', 'no'], vis: ['yes', 'no'], int: [...'abcd'] };
/** KIND letter -> story kinds it supports (fade-in / custom have no letter of their own). */
export const LETTER_KINDS = { a: ['idle', 'fade-in'], b: ['idle'], c: ['foreplay', 'custom'], d: ['oral'], e: ['penetration'], f: ['knotting'],
  g: ['offscreen'], h: ['orgasm'], i: ['afterglow'], j: ['outro'] };   // h asks about the orgasm; the run-in (climax) has no letter
const INT_W = { a: 0, b: 0.33, c: 0.66, d: 1 };
export const WINDOW_MS = 5000, UNSURE = 0.45, RATE_JUMP = 1.6, BLACK_PENALTY = 3, MAX_FINE = 20;
export const CLIMAX_S = 10, CLIMAX_MIN_P = 0.15;

const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };

/** Keyframes the good director run used for story: one per 5 s window (its middle) of the scope. */
export function windows({ t0, t1 }) {
  const n = Math.max(1, Math.round((t1 - t0) / WINDOW_MS)), w = (t1 - t0) / n;
  return Array.from({ length: n }, (_, i) => ({ a: Math.round(t0 + i * w), b: Math.round(t0 + (i + 1) * w), t: Math.round(t0 + (i + 0.5) * w) }));
}
const secAt = (sc, t) => (sc?.seconds ?? []).find((x) => x.t <= t && t < x.t + 1000);
/** The window's fact line (stage survey.fact_line, from SceneFacts). */
export function factLine(sc, a, b) {
  const E = (sc?.energy?.t ?? []).map((t, i) => [t, sc.energy.v[i]]).filter(([t, v]) => t >= a && t < b && Number.isFinite(v)).map(([, v]) => v);
  const black = (sc?.seconds ?? []).some((x) => x.t >= a && x.t < b && x.black), d = sc?.describe;
  const cum = d?.cumOnsetMs != null && d.cumOnsetMs >= a && d.cumOnsetMs < b;
  return [`${Math.round(a / 1000)}-${Math.round(b / 1000)}s`, black ? 'BLACK' : '', E.length ? `motion ${mean(E).toFixed(2)}` : '',
    sc?.loop?.periodMs ? `loop ${sc.loop.periodMs} ms (prominence ${r2(sc.loop.prominence)})` : '',
    d ? (d.acts?.length ? `tags: ${d.acts.slice(0, 4).join(', ')}` : 'tags: none') : '', cum ? 'cum-tag onset' : ''].filter(Boolean).join('; ');
}
const itemText = (q, t, dur, fact) => `This is one frame of an adult animated video at ${clock(t).replace(/\.\d$/, '')} of ${clock(dur).replace(/\.\d$/, '')}.\n`
  + (fact ? `Automatic measurements for this part of the video (may be wrong): ${fact}\n` : '') + q;

/** P over letters + P(cont) -> log scores over STORY_NAMES (log-softmax). Not black where the picture is not dark. */
export function kindLogp(pk, pc, notBlack = false) {
  const p = Object.fromEntries(STORY_NAMES.map((k) => [k, 0]));
  for (const [l, ks] of Object.entries(LETTER_KINDS)) for (const k of ks) p[k] += (pk?.[l] ?? 0) * (l === 'a' && notBlack ? Math.exp(-BLACK_PENALTY) : 1);
  const lc = Math.log(Math.max(pc ?? 0.5, 1e-4)), ln = Math.log(Math.max(1 - (pc ?? 0.5), 1e-4));
  return logSoftmax(STORY_NAMES.map((k) => Math.log(Math.max(p[k], 1e-4)) + (ACTIVE.has(k) ? lc : ln)));
}

export function makeVlmBrain({ model = 'qwen3.5-2b', quant = 'nf4', res = 448 } = {}) {
  const cache = new Map();   // ponytail: per brain instance, unbounded (one director run); key video|q|t
  async function ask(ctx, video, q, items) {   // items [{t, fact, dur}] -> [{choice: p}]
    const key = (it) => `${video}|${q}|${it.t}`, miss = [...new Map(items.filter((it) => !cache.has(key(it))).map((it) => [key(it), it])).values()];
    if (miss.length) {
      const r = await ctx.service.call({ cmd: 'director.ask', model, quant, res, video, items: miss.map((it) => ({ frames: [{ t_ms: it.t, roi: null }], text: itemText(Q[q], it.t, it.dur, it.fact) })),
        choices: CHOICES[q], groups: false, context: null }, { signal: ctx.signal });
      if (r?.cancelled) throw new Error('cancelled');
      if (r?.error || !Array.isArray(r?.result?.probs)) throw new Error(r?.error || 'director.ask: no probs');
      miss.forEach((it, i) => cache.set(key(it), r.result.probs[i] ?? {}));
      ctx.note?.(`vlm ${q}: ${miss.length} questions${r.result.s ? ` in ${r.result.s} s` : ''}`);
    }
    return items.map((it) => cache.get(key(it)));
  }
  // sequential: one VLM job at a time on the shared GPU
  const askAll = async (ctx, video, qs, items) => { const o = {}; for (const q of qs) o[q] = await ask(ctx, video, q, items); return o; };
  /** One director.ask per question over every plan of a video (fills the cache; per-plan asks then hit it). */
  const warm = async (ctx, plans, qs, itemsOf) => {
    const by = new Map();
    for (const p of plans) by.set(p.video, [...(by.get(p.video) ?? []), ...itemsOf(p)]);
    for (const [video, items] of by) if (items.length) await askAll(ctx, video, qs, items);
  };

  async function story(reqs, ctx) {
    const plans = reqs.map((req) => {
      const sc = req.facts?.scene, dur = req.facts?.video?.dur ?? req.scope.t1;
      return { req, sc, dur, video: req.facts?.video?.path, wins: windows(req.scope).map((w) => ({ ...w, fact: factLine(sc, w.a, w.b), dur })) };
    });
    // coarse: KIND, CONT, VIS, INT per window keyframe, one director.ask per question over every scene
    const QS = ['kind', 'cont', 'vis', 'int'];
    await warm(ctx, plans, QS, (p) => p.wins);
    for (const p of plans) p.coarse = await askAll(ctx, p.video, QS, p.wins);
    // investigate: re-ask KIND + CONT at 1 fps where the coarse path changes, is unsure, has a cum onset or a rate jump
    for (const p of plans) {
      const { wins, coarse, sc } = p, top = (pk) => Object.entries(pk ?? {}).filter(([k]) => k.length === 1).sort((a, b) => b[1] - a[1])[0] ?? ['?', 0];
      const E = energyPerStep(sc, p.req.scope), eWin = wins.map((w) => mean(E.slice(Math.floor((w.a - p.req.scope.t0) / STEP_MS), Math.ceil((w.b - p.req.scope.t0) / STEP_MS))));
      const flag = new Set();
      wins.forEach((w, i) => {
        const [l, pmax] = top(coarse.kind[i]);
        if (pmax < UNSURE || l === 'h' || factLine(sc, w.a, w.b).includes('cum-tag')) flag.add(i);
        if (i + 1 < wins.length) {
          const jump = Math.max(eWin[i], eWin[i + 1]) >= RATE_JUMP * Math.max(Math.min(eWin[i], eWin[i + 1]), 1e-6);
          if (top(coarse.kind[i + 1])[0] !== l || jump) { flag.add(i); flag.add(i + 1); }
        }
      });
      const secs = [...new Set([...flag].flatMap((i) => { const out = []; for (let t = wins[i].a; t < wins[i].b; t += STEP_MS) out.push(t + 500); return out; }))].sort((a, b) => a - b).slice(0, MAX_FINE);
      p.fineT = secs;
      p.fineItems = secs.map((t) => { const w = wins.find((x) => t >= x.a && t < x.b) ?? wins[0]; return { t, fact: w.fact, dur: p.dur }; });
    }
    await warm(ctx, plans, ['kind', 'cont'], (p) => p.fineItems);
    for (const p of plans) p.fine = p.fineItems.length ? await askAll(ctx, p.video, ['kind', 'cont'], p.fineItems) : { kind: [], cont: [] };
    return plans.map((p) => {
      const { req, wins, coarse, sc } = p, n = stepsOf(req.scope), logp = [], vis = [], int = [];
      for (let s = 0; s < n; s++) {
        const t = req.scope.t0 + s * STEP_MS + 500, i = Math.max(0, wins.findIndex((w) => t >= w.a && t < w.b)), notBlack = !secAt(sc, t)?.black;
        let row = kindLogp(coarse.kind[i], coarse.cont[i]?.yes, notBlack);
        const j = p.fineT.indexOf(t);
        if (j >= 0) { const f = kindLogp(p.fine.kind[j], p.fine.cont[j]?.yes, notBlack); row = logSoftmax(row.map((x, k) => 0.5 * x + 0.5 * f[k])); }
        logp.push(row);
        vis.push(coarse.vis[i]?.yes ?? null);
        int.push(coarse.int[i] ? Object.entries(INT_W).reduce((s2, [l, w]) => s2 + w * (coarse.int[i][l] ?? 0), 0) : null);
      }
      const { segments, raw } = buildStory(req, logp, { vis, int });
      const mass = mean(coarse.kind.map((x) => x?._mass));
      return { id: req.id, value: { segments, evidence: { t0: req.scope.t0, stepMs: STEP_MS, names: STORY_NAMES, logp, vis, int } }, raw,
        rationale: `${model}: ${wins.length} keyframes + ${p.fineT.length} fine seconds → ${segments.map((s) => s.kind).join(', ')}${Number.isFinite(mass) ? ` (answer mass ${r2(mass)})` : ''}`,
        cost: { ms: 0, questions: 4 * wins.length + 2 * p.fineT.length, frames: wins.length + p.fineT.length } };
    });
  }

  async function climax(req, ctx) {   // relative rule (story.py): small models rarely put P(orgasm) on top
    const f = req.facts ?? {}, scenes = f.scenes ?? [], dur = f.video?.dur ?? req.scope.t1, video = f.video?.path;
    const wins = scenes.flatMap((sc) => windows(sc).map((w) => ({ ...w, sc, fact: factLine(sc, w.a, w.b), dur })));
    if (!wins.length) return { id: req.id, abstain: 'no scenes' };
    const { kind, cont } = await askAll(ctx, video, ['kind', 'cont'], wins);
    const ph = kind.map((k) => k?.h ?? 0), med = median(ph);
    const active = (i) => { const top = Object.entries(kind[i] ?? {}).filter(([l]) => l.length === 1).sort((a, b) => b[1] - a[1])[0]?.[0]; return !['a', 'b', 'j'].includes(top) || (cont[i]?.yes ?? 0) > 0.5; };
    const score = (i) => ph[i] * ((wins[i].sc.describe?.cumOnsetMs != null && wins[i].sc.describe.cumOnsetMs < wins[i].b + 5000 && wins[i].sc.describe.cumOnsetMs >= wins[i].a - 5000 ? 1 : 0) + 0.1);
    const cand = wins.map((w, i) => i).filter((i) => active(i) && wins[i].a >= 0.4 * dur);
    const i = cand.sort((a, b) => score(b) - score(a))[0];
    if (i == null || ph[i] < Math.max(CLIMAX_MIN_P, 2 * med)) {
      return { id: req.id, value: { window: null, afterglowTo: null }, raw: 0.55, rationale: `${model}: no window clears P(orgasm) >= ${CLIMAX_MIN_P} and 2x the clip median (${r2(med)})`, cost: { ms: 0, questions: 2 * wins.length } };
    }
    const w = wins[i], fineT = [];
    for (let t = Math.max(0, w.a - 5000); t < Math.min(dur, w.b + 5000); t += STEP_MS) fineT.push(t + 500);
    const fine = await ask(ctx, video, 'kind', fineT.map((t) => ({ t, fact: w.fact, dur })));
    const bi = fine.reduce((b, x, j) => ((x?.h ?? 0) > (fine[b]?.h ?? 0) ? j : b), 0), t0 = Math.max(0, fineT[bi] - 500);
    return { id: req.id, value: { window: { t0, t1: Math.min(dur, t0 + CLIMAX_S * 1000) }, afterglowTo: null }, raw: r2(Math.min(0.9, 0.5 + ph[i])),
      rationale: `${model}: P(orgasm) ${r2(ph[i])} at ${clock(w.t)} (clip median ${r2(med)}); peak second ${clock(t0)}`, cost: { ms: 0, questions: 2 * wins.length + fineT.length } };
  }

  return {
    id: 'vlm', model, kinds: ['story', 'climax'],
    available: async (ctx) => !!ctx?.service?.call,
    async decide(reqs, ctx) {
      const t = Date.now(), out = new Map();
      const fail = (r, e) => out.set(r, { id: r.id, abstain: 'vlm: ' + String(e?.message ?? e).split('\n')[0] });
      const st = reqs.filter((r) => r.kind === 'story' && r.facts?.scene && r.facts?.video?.path);
      try { (await story(st, ctx)).forEach((a, i) => out.set(st[i], a)); } catch (e) { st.forEach((r) => fail(r, e)); }
      for (const r of reqs.filter((x) => x.kind === 'climax')) { try { out.set(r, await climax(r, ctx)); } catch (e) { fail(r, e); } }
      const ms = Date.now() - t;
      return reqs.map((r) => { const a = out.get(r) ?? { id: r.id, abstain: r.kind === 'story' ? 'vlm: no scene or video path' : `vlm: does not answer ${r.kind}` }; return a.cost ? { ...a, cost: { ...a.cost, ms } } : a; });
    },
  };
}
