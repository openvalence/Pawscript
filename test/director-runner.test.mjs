// The director's runner (src/features/director/runner.js) and its draft hooks (H1), on a plain-object director, a tiny
// app, the fake sidecar world (test/director-fake-sidecar.mjs) and the scripted brain (test/director-mock-brain.mjs).
// Covers: the step list state machine, a full pass, replay, escalation to the user, the verify redo, overrides, cancel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/features/director/runner.js';
import { DIRECTOR_STEPS, STEPS, stepsOf, initSteps, restoreSteps, stepEvent, pending, saveSteps } from '../src/features/draft/logic.js';
import { planCtx, generatePlan } from '../src/features/timeline/generate-logic.js';
import * as gen from '../src/lib/gen/plan.js';
import { makeFakeSidecar, WORLD } from './director-fake-sidecar.mjs';
import { makeMockBrain } from './director-mock-brain.mjs';

// the director library as src/features/director/lib.js puts it together (minus the calib JSON: empty table)
import * as decisions from '../src/lib/director/decisions.js';
import { digest } from '../src/lib/director/digest.js';
import { decide } from '../src/lib/director/decide.js';
import { toRecord } from '../src/lib/director/trace.js';
import { verifyChecks } from '../src/lib/director/checks.js';
import { userBrain } from '../src/features/director/brains/index.js';
const L = { ...decisions, digest, decide, toRecord, verifyChecks, calib: null };
const F = { makeBrains: () => ({ user: userBrain }) };

function world({ brains, settings = {} } = {}) {
  const fake = makeFakeSidecar({ delay: 0 });
  let n = 0, entry = 0;
  const runs = new Map(), tracks = [];
  const app = {
    durationMs: WORLD.media.duration_ms,
    doc: { media: { path: '/fake.mp4', name: 'fake.mp4', durationMs: WORLD.media.duration_ms, fps: WORLD.media.fps, width: 640, height: 360 },
      scenes: WORLD.scenes.map(([a, b]) => ({ start_ms: a, end_ms: b })), plan: [], ghosts: [], axes: { stroke: [] }, activeAxis: 'stroke', project: null },
    labels: [],
    transact(label, fn) { fn(); this.labels.push(label); entry++; },
  };
  const api = {
    trackers: async () => (await fake.sidecar({ cmd: 'list' })).result.trackers,
    async trackRange({ tracker, range, roi, params, tag }) {
      tracks.push({ tracker, tag });
      const r = await fake.sidecar({ cmd: 'track', tracker, start_ms: range.t0, end_ms: range.t1, roi, params });
      if (r.error) return { error: r.error };
      const id = 'run' + ++n, pts = r.result.points, p0 = { at: Float64Array.from(pts, (x) => x.at), pos: Float64Array.from(pts, (x) => x.pos) };
      runs.set(id, { id, samples: { t: Float64Array.from(r.result.samples, (x) => x[0]), v: Float32Array.from(r.result.samples, (x) => x[1]) }, channels: {}, points0: p0, orient: [] });
      app.doc.ghosts = [...app.doc.ghosts, { id, name: '#' + n, script: pts, visible: true, source: { kind: 'tracker', tracker, tag, range: { t0: range.t0, t1: range.t1 } } }];
      return { run: { id, n } };
    },
    setSpanOrientation({ runId, t0, t1, sign }) {
      const run = runs.get(runId);
      if (!run) return false;
      run.orient = [...run.orient.filter((o) => o.t1 <= t0 || o.t0 >= t1), { t0, t1, sign }];
      const script = Array.from(run.points0.at, (at, k) => { const o = run.orient.find((x) => at >= x.t0 && at < x.t1); return { at, pos: o?.sign < 0 ? 100 - run.points0.pos[k] : run.points0.pos[k] }; });
      app.doc.ghosts = app.doc.ghosts.map((g) => (g.id === runId ? { ...g, script } : g));
      return true;
    },
  };
  const D = {
    app, L, records: {}, overrides: {}, queue: [], session: 'dr-test', facts: null, onRecords: null,
    settings: { preset: 'ask', askUser: true, vlmModel: null, agentRoot: null, cdp: false, deadlineMs: 600000, maxRounds: 3, budget: { tracks: 40, gpuS: 900, images: 60 }, ...settings },
    brains: brains || { rules: makeMockBrain(), agent: makeMockBrain({ id: 'agent' }), user: F.makeBrains().user },
    ctx: { signal: new AbortController().signal, service: null, tools: null, note() {}, now: () => Date.now() },
    budget: { tracks: 40, gpuS: 900, images: 60, used: { tracks: 0, gpuS: 0, images: 0 } },
    memo: { stats: null, cands: {}, compare: {}, attempts: {}, priors: {}, force: {} },
    service: { call: (req) => fake.sidecar(req) },
    api, runOf: (id) => runs.get(id) || null, setChannel() {},
  };
  const draft = {
    cancelled: false, moved: false, progress() {}, top: () => 'e' + entry,
    async generate() {
      const { ctx } = planCtx(app.doc, { maxSpeed: 450 });
      const r = generatePlan(app.doc.axes.stroke, app.doc.plan, { scope: 'all', ctx, gen });
      app.transact('Generate whole plan', () => { app.doc.axes = { ...app.doc.axes, stroke: r.script }; app.doc.plan = r.plan; });
      return { note: 'ok', errors: r.issues.filter((x) => x.level === 'error') };
    },
  };
  return { D, draft, app, fake, tracks, runs };
}
/** Draft's describe and loops steps, as their results land in doc.scenes. */
async function described(w) {
  if (w.app.doc.scenes[0].describe) return;
  w.app.doc.scenes = await Promise.all(w.app.doc.scenes.map(async (s) => ({ ...s,
    describe: (await w.fake.sidecar({ cmd: 'describe', start_ms: s.start_ms, end_ms: s.end_ms })).result,
    loop: (await w.fake.sidecar({ cmd: 'loop', start_ms: s.start_ms, end_ms: s.end_ms })).result })));
}
async function pass(w) {
  await described(w);
  const out = {};
  for (const id of ['survey', 'story', 'regions', 'compare', 'direction', 'generate', 'verify']) {
    out[id] = id === 'generate' ? await w.draft.generate() : await R.RUNNERS[id](w.D, w.draft, 0, false);
    if (out[id]?.cancelled) break;
  }
  return out;
}
const assistFacts = (app) => app.doc.project?.extra?.assist?.direction || [];

test('H1: the director step list and the step state machine on it', () => {
  assert.equal(stepsOf('rules'), STEPS);
  assert.deepEqual(stepsOf('director').map((s) => s.id), ['scenes', 'describe', 'loops', 'survey', 'story', 'regions', 'compare', 'direction', 'generate', 'verify', 'assist', 'review']);
  let st = initSteps(DIRECTOR_STEPS);
  assert.equal(st.length, 12);
  st = stepEvent(stepEvent(st, 4, { type: 'start' }), 4, { type: 'done', note: 'plan' });
  st = stepEvent(stepEvent(st, 5, { type: 'start' }), 5, { type: 'done' });
  st = stepEvent(stepEvent(st, 4, { type: 'start' }), 4, { type: 'done' });   // story again: regions is out of date
  assert.equal(st[5].stale, true);
  assert.deepEqual(pending(st).slice(0, 4), [0, 1, 2, 3]);
  // a rules-mode block restored into the director list: matching ids keep their state, the rest start idle
  const saved = saveSteps(stepEvent(stepEvent(initSteps(), 3, { type: 'start' }), 3, { type: 'done', note: 'first plan' }));
  const back = restoreSteps(saved, DIRECTOR_STEPS);
  assert.equal(back.length, 12);
  assert.ok(back.every((s) => s.status === 'idle'));
  assert.equal(restoreSteps(saveSteps(st), DIRECTOR_STEPS)[4].status, 'done');
});

test('a full pass: trace-2 style plan, two runs compared per visible span, the mirrored span flipped, verified', async () => {
  const w = world(), r = await pass(w), { D, app } = w;
  if (process.env.DBG) for (const x of Object.values(D.records)) console.log(x.id, x.status, JSON.stringify(x.chain), JSON.stringify(x.value).slice(0, 300));
  for (const [k, v] of Object.entries(r)) assert.ok(!v?.cancelled && !v?.skip, `${k}: ${JSON.stringify(v)}`);
  assert.deepEqual(app.doc.plan.map((s) => s.kind), ['idle', 'penetration', 'knotting', 'offscreen', 'orgasm', 'outro']);
  assert.deepEqual(app.doc.plan.map((s) => s.id), WORLD.scenes.map(([a], i) => `dir-${i}-${a}`));
  const spans = R.spansOf(D).map((s) => s.key);
  assert.deepEqual(spans, ['s1@4000', 's2@24000']);
  for (const k of spans) {
    assert.ok(R.probeRuns(D, { ...R.spansOf(D).find((s) => s.key === k) }).length >= 2, k + ' has at least two runs');
    const keep = D.records['track:' + k].value.keep;
    assert.ok(keep, k + ' keeps a run');
    assert.equal(app.doc.plan.find((s) => s.t0 === +k.split('@')[1]).source, keep);
    assert.equal(D.records['direction:' + k].value.sign, k === 's2@24000' ? -1 : 1);
    assert.equal(D.records['verify:' + k].value.verdict, 'ok');
  }
  // the offscreen span keeps no run (no region) and is not tracked
  assert.equal(D.records['roi:s3@38000'], undefined);
  assert.equal(app.doc.plan[3].source, undefined);
  // direction facts for assist, both spans; the kept runs visible, the other director runs hidden
  assert.equal(assistFacts(app).length, 2);
  const keeps = new Set(spans.map((k) => D.records['track:' + k].value.keep));
  for (const g of app.doc.ghosts.filter((x) => x.source.tag?.startsWith('director:'))) assert.equal(g.visible, keeps.has(g.id), g.id);
  // one undo entry per writing step
  assert.deepEqual(app.labels, ['Director: story', 'Director: compare trackers', 'Director: direction and depth', 'Generate whole plan']);
  assert.ok(app.doc.axes.stroke.length > 50);
  assert.equal(D.queue.length, 0);
  for (const rec of Object.values(D.records)) assert.equal(L.validate(rec.kind, rec.value), null, rec.id);
  assert.ok(Object.values(D.records).every((x) => x.status === 'decided'), Object.values(D.records).filter((x) => x.status !== 'decided').map((x) => `${x.id}:${x.status}`).join(' '));
});

test('a second pass replays every decision and re-tracks nothing', async () => {
  const w = world();
  await pass(w);
  const n = w.tracks.length, before = JSON.stringify(w.app.doc.plan.map((s) => [s.t0, s.kind, s.source]));
  w.D.memo = { stats: null, cands: {}, compare: {}, attempts: {}, priors: {}, force: {} }; w.D.facts = null;
  await pass(w);
  assert.equal(w.tracks.length, n);
  assert.equal(JSON.stringify(w.app.doc.plan.map((s) => [s.t0, s.kind, s.source])), before);
  const st = new Set(Object.values(w.D.records).map((x) => x.status));
  assert.deepEqual([...st], ['decided'], 'replayed records keep their status');
  assert.ok(Object.values(w.D.records).every((x) => !x.supersedes), 'a replay is not a re-decision: ' + Object.values(w.D.records).filter((x) => x.supersedes).map((x) => x.id + ' ' + JSON.stringify(x.chain)).join(' | '));
});

test('escalation: unsure directions are queued for the user, applied provisionally, and never become assist facts', async () => {
  const w = world({ brains: { rules: makeMockBrain({ unsure: ['direction'] }), agent: makeMockBrain({ id: 'agent', abstain: ['direction'] }), user: F.makeBrains().user } });
  await pass(w);
  const { D, app } = w;
  assert.deepEqual(D.queue.map((q) => q.id).sort(), ['direction:s1@4000', 'direction:s2@24000']);
  assert.equal(D.records['direction:s2@24000'].status, 'queued');
  assert.equal(D.records['direction:s2@24000'].provisional, true);
  assert.equal(D.records['direction:s2@24000'].value.sign, -1, 'the best answer so far is applied');
  assert.equal(assistFacts(app).length, 0);
  // the user answers: an override, the direction step again -> status user, a fact for assist, the queue drains
  D.overrides['direction:s2@24000'] = { value: { sign: -1, pairs: [] }, at: Date.now() };
  await R.direction(D, w.draft, 0, true);
  assert.equal(D.records['direction:s2@24000'].status, 'user');
  assert.deepEqual(D.queue.map((q) => q.id), ['direction:s1@4000']);
  assert.equal(assistFacts(app).length, 1);
});

test('verify redo: the track is re-asked with the prior, skipping the brain that gave it; the next brain answers', async () => {
  // rules decides direction, so the agent verifies (README §5) and asks once per span for the track to be redone
  const agent = makeMockBrain({ id: 'agent', redoOnce: ['track'] });
  const w = world({ brains: { rules: makeMockBrain(), agent, user: F.makeBrains().user } });
  const r = await pass(w), { D } = w;
  assert.match(r.verify.note, /2\/2 verified · 2 redos/, JSON.stringify(r) + Object.values(D.records).map((x) => `${x.id} ${x.status} ${x.brain} ${JSON.stringify(x.value).slice(0, 80)}`).join(' | '));
  for (const k of ['s1@4000', 's2@24000']) {
    const t = D.records['track:' + k];
    assert.equal(t.attempt, 1);
    assert.equal(t.brain, 'agent');
    assert.ok(t.supersedes && t.supersedes.brain === 'rules', 'the rejected answer is kept as supersedes');
    assert.ok(!t.chain.some((c) => c.brain === 'rules' && c.raw != null), 'rules was not asked again');
    assert.equal(D.records['verify:' + k].value.verdict, 'ok');
  }
  assert.ok(agent.log.includes('track:s1@4000'));
});

test('verify keeps the direction brain away from the frame check', async () => {
  const agent = makeMockBrain({ id: 'agent' });
  const w = world({ brains: { rules: makeMockBrain(), agent, user: F.makeBrains().user } });
  await pass(w);
  const v = w.D.records['verify:s1@4000'];
  assert.equal(v.brain, 'agent');
  assert.ok(!v.chain.some((c) => c.brain === 'rules' && c.raw != null), 'rules (it decided the direction) did not verify');
});

test('cancel inside regions stops before tracking more', async () => {
  const w = world();
  await described(w);
  for (const id of ['survey', 'story']) await R.RUNNERS[id](w.D, w.draft, 0);
  const orig = w.D.api.trackRange;
  w.D.api.trackRange = async (o) => { const r = await orig(o); w.draft.cancelled = true; return r; };
  const r = await R.regions(w.D, w.draft, 0);
  assert.equal(r.cancelled, true);
  assert.equal(w.tracks.length, 1);
});

test('no motion.compare: the pipeline still ends with a plan (runs without stats, provisional picks)', async () => {
  const w = world();
  w.fake.knobs.failCmd = 'motion.compare';
  const r = await pass(w);
  assert.ok(!r.compare.cancelled);
  assert.equal(w.app.doc.plan.length, 6);
});
