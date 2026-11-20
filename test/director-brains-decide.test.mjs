// decide(): override, replay by digest, chains with acceptance, the rules+vlm story combine, user queue,
// provisional / fallback, validation at the boundary, agent confidence cap, skip (verify redo).
import assert from 'node:assert/strict';
import test from 'node:test';
import { decide, combineStory, AGENT_CAP } from '../src/lib/director/decide.js';
import { DEFAULT_SETTINGS } from '../src/lib/director/decisions.js';
import { toRecord } from '../src/lib/director/trace.js';
import { STORY_NAMES, logSoftmax } from '../src/lib/director/story.js';
import { rulesBrain } from '../src/features/director/brains/rules.js';
import { userBrain } from '../src/features/director/brains/user.js';
import { makeReplayBrain } from '../src/features/director/brains/replay.js';
import { SCENES, VIDEO, DUR, RUNS_S0, PAIRS_S0, sc, R } from './director-brains-fixtures.mjs';

const settings = (o = {}) => ({ ...DEFAULT_SETTINGS, ...o });
const ctx = { signal: new AbortController().signal, service: null, tools: null, note: () => {}, now: () => Date.now() };
const fake = (id, fn, kinds) => ({ id, kinds, calls: 0, available: async () => true, async decide(reqs) { this.calls++; return reqs.map((r) => ({ id: r.id, ...fn(r) })); } });
const run = (reqs, o = {}) => { const q = []; return decide(reqs, { brains: { rules: rulesBrain, user: userBrain }, settings: settings(), calib: null, records: {}, overrides: {}, ctx, budget: null, enqueue: (r, d) => q.push([r.id, d.status]), ...o }).then((d) => Object.assign(d, { q })); };
const cam = (i) => R('camera', sc(i), { scene: SCENES[i] });

test('rules above tau -> decided; below tau with user -> queued + provisional value; without user -> provisional', async () => {
  const d = await run([cam(1), cam(3)]);
  assert.deepEqual(d.map((x) => [x.value.mode, x.status, x.brain]), [['rides', 'decided', 'rules'], ['sway', 'queued', 'rules']]);
  assert.deepEqual(d.q, [['camera:s3', 'queued']]);
  assert.deepEqual(d[1].chain.map((c) => c.brain), ['rules', 'user']);
  const p = await run([cam(3)], { settings: settings({ askUser: false }) });
  assert.equal(p[0].status, 'provisional'); assert.equal(p[0].calibrated, false); assert.match(p[0].digest, /^[0-9a-f]{14}$/);
});

test('override first, then replay by digest; a changed fact misses the replay', async () => {
  const req = cam(3), value = { mode: 'static', p95Px: 1, rateHz: null, phaseMs: null, moveSpans: [], valid: ['single', 'relative', 'rate'] };
  const o = await run([req], { overrides: { 'camera:s3': { value, at: 1 } } });
  assert.deepEqual([o[0].status, o[0].conf, o[0].brain, o[0].value.mode], ['user', 1, 'user', 'static']);
  const bad = await run([req], { overrides: { 'camera:s3': { value: { mode: 'zoom' }, at: 1 } } });
  assert.equal(bad[0].status, 'queued');   // invalid stored answer ignored
  const first = await run([cam(1)]), rec = toRecord(first[0], { session: 's' });
  const again = await run([cam(1)], { records: { 'camera:s1': rec }, brains: {} });
  assert.deepEqual([again[0].status, again[0].value.mode], ['replayed', 'rides']);
  const changed = R('camera', sc(1), { scene: { ...SCENES[1], camera: { ...SCENES[1].camera, p95Px: 33 } } });
  assert.equal((await run([changed], { records: { 'camera:s1': rec } }))[0].status, 'decided');
  const dep = R('story', sc(0), { scene: SCENES[0] }, { deps: ['camera:s1'] }), r1 = await run([dep]);
  const r2 = await run([dep], { records: { 'camera:s1': { ...rec, value: { ...rec.value, mode: 'sway' } } } });
  assert.notEqual(r1[0].digest, r2[0].digest);   // a dependency's value changed
});

test('nothing answers and no user -> DEFAULTS with status fallback', async () => {
  const d = await run([R('direction', sc(0), { keep: 'nope', runs: RUNS_S0 })], { settings: settings({ askUser: false }) });
  assert.deepEqual([d[0].status, d[0].brain, d[0].conf, d[0].value.sign], ['fallback', 'default', 0, 0]);
  assert.equal(d[0].chain[0].abstain, 'no kept run');
});

test('invalid answers count as abstentions; unavailable / missing brains are recorded as skipped', async () => {
  const liar = fake('agent', () => ({ value: { keep: 'run99', agree: [], reject: {} }, raw: 0.99 }));
  const off = { ...fake('vlm', () => ({})), available: async () => false };
  const req = R('track', sc(0), { scene: SCENES[0], runs: RUNS_S0, pairs: [] });
  const d = await run([req], { brains: { rules: fake('rules', () => ({ abstain: 'x' })), agent: liar, vlm: off }, settings: settings({ preset: 'ask', askUser: false }) });
  assert.match(d[0].chain.find((c) => c.brain === 'agent').abstain, /invalid: .*not among/);
  assert.equal(d[0].status, 'fallback');
  const noCum = SCENES.map((x) => ({ ...x, describe: x.describe && { ...x.describe, cumOnsetMs: null } }));
  const s = await run([R('climax', { scene: null, t0: 0, t1: DUR }, { video: VIDEO, scenes: noCum })],{ brains: { rules: rulesBrain, vlm: off }, settings: settings({ preset: 'rules+vlm', askUser: false }) });
  assert.deepEqual(s[0].chain.map((c) => c.skipped ?? 'answered'), ['answered', 'unavailable']);
  const m = await run([cam(3)], { brains: { rules: rulesBrain }, settings: settings({ preset: 'ask', askUser: true }) });
  assert.ok(m[0].chain.some((c) => c.brain === 'user' && c.skipped === 'missing'));
});

test('agent answers are uncalibrated and capped at 0.95; calibration applies to rules', async () => {
  const agent = fake('agent', () => ({ value: { mode: 'sway', p95Px: 7, rateHz: null, phaseMs: null, moveSpans: [], valid: ['relative', 'rate'] }, raw: 1 }));
  const d = await run([cam(3)], { brains: { rules: rulesBrain, agent, user: userBrain }, settings: settings({ preset: 'rules+vlm+agent' }) });
  assert.deepEqual([d[0].brain, d[0].status, d[0].conf, d[0].calibrated], ['agent', 'decided', AGENT_CAP, false]);
  const calib = { rules: { camera: { a: 1, b: 3, n: 40 } } };   // pushes the sway 0.75 above tau
  const c = await run([cam(3)], { calib });
  assert.deepEqual([c[0].status, c[0].calibrated], ['decided', true]); assert.ok(c[0].conf > 0.95);
});

test('skip: a verify redo skips the brain that produced the prior answer', async () => {
  const agent = fake('agent', () => ({ value: { verdict: 'ok', checks: [], note: 'frames ok' }, raw: 0.9 }));
  const req = R('verify', sc(0), { checks: [{ id: 'agree', ok: true, value: 0.9, limit: '' }, { id: 'camera', ok: true, value: 0.1, limit: '' }] }, { attempt: 1 });
  const d = await run([req], { brains: { rules: rulesBrain, agent }, settings: settings({ preset: 'rules+vlm+agent', askUser: false }), skip: { [req.id]: ['rules'] } });
  assert.equal(d[0].brain, 'agent'); assert.deepEqual(d[0].chain.map((c) => c.brain), ['agent']);
});

test('story: rules + vlm per-second evidence summed and decoded once', async () => {
  const req = R('story', sc(2), { scene: SCENES[2], video: VIDEO, scenes: SCENES, camera: { mode: 'move', p95Px: 17, rateHz: 1.5, phaseMs: null, moveSpans: [[40500, 50000]], valid: ['relative', 'rate'] } });
  const n = Math.ceil((56222 - 40444) / 1000), off = STORY_NAMES.indexOf('offscreen');
  const vlmLogp = Array.from({ length: n }, () => logSoftmax(STORY_NAMES.map((_, k) => (k === off ? 3 : 0))));
  const vlm = fake('vlm', () => ({ value: { segments: [{ t0: 40444, t1: 56222, kind: 'offscreen', visible: false, action: 'continues', intensity: 1, name: 'o' }], evidence: { t0: 40444, stepMs: 1000, names: STORY_NAMES, logp: vlmLogp, vis: new Array(n).fill(0.1) } }, raw: 0.7 }), ['story']);
  const d = await run([req], { brains: { rules: rulesBrain, vlm, user: userBrain }, settings: settings({ preset: 'rules+vlm' }) });
  assert.equal(d[0].brain, 'rules+vlm'); assert.equal(d[0].status, 'decided');
  assert.deepEqual(d[0].chain.map((c) => c.brain), ['rules', 'vlm', 'rules+vlm']);
  assert.deepEqual(d[0].value.segments.map((s) => [s.kind, s.recipe, s.params?.rate]), [['offscreen', 'penetration-strokes', 3]]);
  assert.equal('evidence' in d[0].value, false);   // per-second scores stay out of the trace
  assert.ok(d[0].conf > (await run([req], { settings: settings({ preset: 'rules', askUser: false }) }))[0].conf);
  // vlm abstains -> the rules answer alone
  const quiet = fake('vlm', () => ({ abstain: 'no VLM' }), ['story']);
  const q = await run([req], { brains: { rules: rulesBrain, vlm: quiet }, settings: settings({ preset: 'rules+vlm', askUser: false }) });
  assert.equal(q[0].brain, 'rules'); assert.deepEqual(q[0].chain.map((c) => c.brain), ['vlm', 'rules']);
  assert.equal(combineStory(req, { value: {} }, { value: {} }), null);
});

test('replay brain through an override chain (trace-2 fixture route), story:v sliced per scene', async () => {
  const replay = makeReplayBrain({ 'track:s0': { value: { keep: 'run25', agree: ['run23'], reject: { run8: 'whole frame' } }, conf: 0.8 },
    'story:v': { value: { segments: [{ t0: 0, t1: 4500, kind: 'penetration', visible: true, action: 'continues', intensity: 0.75, name: 'a' }, { t0: 4500, t1: 30000, kind: 'penetration', visible: true, action: 'continues', intensity: 1, name: 'b' }] }, conf: 0.7 } });
  const s = settings({ preset: 'rules', askUser: false, override: { track: { chain: ['replay'], tau: 0.5 }, story: { chain: ['replay'], tau: 0.5 } } });
  const d = await run([R('track', { scene: 0, t0: 0, t1: 26489 }, { runs: RUNS_S0, pairs: PAIRS_S0 }), R('story', sc(0), {})], { brains: { replay }, settings: s });
  assert.deepEqual([d[0].brain, d[0].value.keep, d[0].status], ['replay', 'run25', 'decided']);
  assert.deepEqual(d[1].value.segments.map((x) => [x.t0, x.t1]), [[0, 4500], [4500, 26489]]);
});

test('abort stops the chain; the rest resolve provisional / fallback', async () => {
  const ac = new AbortController(); ac.abort();
  const d = await run([cam(1)], { ctx: { ...ctx, signal: ac.signal } });
  assert.equal(d[0].status, 'fallback');
});
