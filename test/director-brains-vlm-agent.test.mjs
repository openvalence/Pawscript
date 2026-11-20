// The VLM brain against a fake director.ask service, and the agent brain over CDP and an in-memory mailbox with
// fake tools (fake frame descriptors, no pixels).
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeVlmBrain, Q, CHOICES, windows, kindLogp, factLine } from '../src/features/director/brains/vlm.js';
import { makeAgentBrain, primer, signFromPairs, fileOf, complete } from '../src/features/director/brains/agent.js';
import { makeBrains } from '../src/features/director/brains/index.js';
import { decide } from '../src/lib/director/decide.js';
import { DEFAULT_SETTINGS, validate } from '../src/lib/director/decisions.js';
import { STORY_NAMES } from '../src/lib/director/story.js';
import { SCENES, VIDEO, DUR, RUNS_S0, PICK_S0, sc, R, fakeFrames } from './director-brains-fixtures.mjs';

// ---- fake director.ask: penetration in s0/s1, a cutaway in s2, orgasm from 56 s to 66 s
function fakeService() {
  const calls = [];
  const kindP = (t) => (t >= 56222 && t < 66000 ? 'h' : t >= 40444 && t < 56222 ? 'g' : t >= 84800 ? 'j' : 'e');
  return {
    calls,
    async call(req) {
      calls.push(req);
      assert.equal(req.cmd, 'director.ask'); assert.equal(req.video, VIDEO.path);
      const first = new Set(req.choices.map((c) => c[0])); assert.equal(first.size, req.choices.length);   // first tokens differ
      const probs = req.items.map((it) => {
        assert.equal(it.frames.length, 1); assert.ok(Number.isFinite(it.frames[0].t_ms));
        const t = it.frames[0].t_ms;
        if (req.choices.length === 10) { const top = kindP(t); return { ...Object.fromEntries(req.choices.map((c) => [c, c === top ? 0.82 : 0.02])), _mass: 0.9 }; }
        if (req.choices.length === 4) return { a: 0.05, b: 0.15, c: 0.5, d: 0.3, _mass: 0.9 };
        const yes = it.text.endsWith(Q.vis) ? (t >= 40444 && t < 56222 ? 0.1 : 0.8) : 0.85;
        return { yes, no: 1 - yes, _mass: 0.95 };
      });
      return { result: { probs, s: 0.1, model: req.model } };
    },
  };
}
const ctxWith = (service, o = {}) => ({ signal: new AbortController().signal, service, tools: null, note: () => {}, now: () => Date.now(), settings: DEFAULT_SETTINGS, ...o });
const storyReq = (i) => R('story', sc(i), { scene: SCENES[i], video: VIDEO, scenes: SCENES });

test('vlm: question texts and choices are the stage DOMAIN.adult ones; keyframes per 5 s window', () => {
  assert.match(Q.kind, /^Which best describes what is happening at this moment\?/);
  assert.deepEqual(CHOICES.kind, [...'abcdefghij']);
  assert.deepEqual(windows({ t0: 0, t1: 26489 }).map((w) => w.t).slice(0, 2), [2649, 7947]);
  assert.match(factLine(SCENES[3], 56222, 61222), /cum-tag onset/);
  const lp = kindLogp({ e: 0.9, a: 0.1 }, 0.9, true);
  assert.equal(STORY_NAMES[lp.indexOf(Math.max(...lp))], 'penetration');
});

test('vlm story: one director.ask per question over all scenes, fine re-asks, per-second evidence', async () => {
  const svc = fakeService(), vlm = makeVlmBrain({ model: 'qwen3.5-2b' });
  const reqs = [0, 2].map(storyReq), out = await vlm.decide(reqs, ctxWith(svc));
  const coarse = svc.calls.slice(0, 4);
  assert.deepEqual(coarse.map((c) => c.choices.length), [10, 2, 2, 4]);
  assert.equal(coarse[0].items.length, windows(sc(0)).length + windows(sc(2)).length);   // batched over both scenes
  assert.match(coarse[0].items[0].text, /^This is one frame of an adult animated video at 0:02 of 1:43\.\nAutomatic measurements/);
  assert.ok(svc.calls.length <= 6, String(svc.calls.length));
  for (const [i, a] of out.entries()) assert.equal(validate('story', a.value, reqs[i]), null);
  assert.deepEqual(out[0].value.segments.map((s) => s.kind), ['penetration', 'penetration']);
  assert.deepEqual(out[1].value.segments.map((s) => [s.kind, s.visible]), [['offscreen', false]]);
  assert.equal(out[1].value.evidence.logp.length, 16); assert.equal(out[1].value.evidence.vis[0], 0.1);
  const n = svc.calls.length;
  await vlm.decide([storyReq(0)], ctxWith(svc));
  assert.equal(svc.calls.length, n);   // cached per brain instance
});

test('vlm climax: relative rule over windows after 40% of the video, peak second from 1 fps re-asks', async () => {
  const svc = fakeService(), vlm = makeVlmBrain();
  const [a] = await vlm.decide([R('climax', { scene: null, t0: 0, t1: DUR }, { video: VIDEO, scenes: SCENES })], ctxWith(svc));
  assert.equal(validate('climax', a.value), null);
  assert.ok(a.value.window.t0 >= 51000 && a.value.window.t0 <= 57000, JSON.stringify(a.value));
  assert.equal(a.value.window.t1 - a.value.window.t0, 10000);
  assert.ok(a.raw > 0.5 && a.raw <= 0.9);
});

test('vlm: service errors become abstentions; never asked for direction', async () => {
  const vlm = makeVlmBrain(), bad = { call: async () => ({ error: 'director.ask: no VLM (install the vlm extra or set PAWSCRIPT_VLM_PYTHON)' }) };
  const [s, d] = await vlm.decide([storyReq(0), R('direction', sc(0), {})], ctxWith(bad));
  assert.match(s.abstain, /no VLM/); assert.match(d.abstain, /does not answer direction/);
  assert.equal(vlm.kinds.includes('direction'), false);
});

test('decide with makeBrains(vlmModel): rules + vlm combine end to end on the fake service', async () => {
  const brains = makeBrains({ vlmModel: 'qwen3.5-2b' }), svc = fakeService();
  const camera = { mode: 'move', p95Px: 17, rateHz: 1.5, phaseMs: null, moveSpans: [[40500, 50000]], valid: ['relative', 'rate'] };
  const req = R('story', sc(2), { scene: SCENES[2], video: VIDEO, scenes: SCENES, camera });
  const [d] = await decide([req], { brains, settings: { ...DEFAULT_SETTINGS, preset: 'rules+vlm' }, calib: null, records: {}, overrides: {}, ctx: ctxWith(svc), enqueue: () => {} });
  assert.equal(d.brain, 'rules+vlm'); assert.equal(d.value.segments[0].kind, 'offscreen'); assert.equal(d.status, 'decided');
});

// ---- agent
const fakeTools = () => {
  const calls = [];
  let images = 0;
  return { calls, async run(call, o) {
    calls.push([call.tool, o.round]);
    if (call.tool === 'track') return { evidence: [], result: { error: 'budget' } };
    const times = call.times ?? (call.tool === 'pairs' ? [5100, 5670] : [call.t0 ?? 0]);
    images += times.length;
    return { evidence: fakeFrames({ times }, `req/${fileOf(o.reqId)}`).map((e) => (call.tool === 'pairs' ? { ...e, data: { order: ['B', 'A'] } } : e)), result: { images } };
  } };
};
const until = async (f, ms = 2000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); } };

test('agent primers: what the good run looked at first', () => {
  assert.equal(primer(storyReq(0))[0].tool, 'frames');
  assert.equal(primer(R('roi', sc(0), {}))[0].grid, 0.1);
  assert.deepEqual(primer(R('direction', sc(0), { keep: 'run25' }))[0], { tool: 'pairs', run: 'run25', t0: 0, t1: 26489, k: 6 });
  assert.equal(primer(R('track', sc(0), { runs: RUNS_S0 })).length, 3);
  assert.equal(primer(R('verify', sc(0), {}))[0].run, 'script');
});

test('agent over CDP: pending -> need -> tools -> round 1 -> value; blind order withheld; sign read from pairs', async () => {
  const agent = makeAgentBrain({ cdp: true }), tools = fakeTools();
  const req = R('direction', sc(0), { keep: 'run25', runs: RUNS_S0, pickPairs: PICK_S0 });
  const p = agent.decide([req], ctxWith(null, { tools }));
  await until(() => agent.pending().length === 1);
  const r0 = agent.pending()[0];
  assert.equal(r0.round, 0); assert.equal(r0.evidence.length, 2); assert.equal(r0.evidence[0].data.order, undefined);   // primer: blind pairs
  assert.equal(agent.answer(req.id, { round: 0 }), 'exactly one of value | need | abstain');
  assert.equal(agent.answer(req.id, { round: 0, need: [{ tool: 'frames', times: [9860, 10320] }] }), null);
  await until(() => agent.pending()[0]?.round === 1);
  assert.equal(agent.pending()[0].evidence.length, 4);
  assert.match(agent.answer(req.id, { round: 0, value: { pairs: [] } }), /stale round/);
  assert.match(agent.answer(req.id, { round: 1, value: { sign: 1, pairs: [{ deep: 99999, shallow: 1 }] } }), /scope/);
  assert.equal(agent.answer(req.id, { round: 1, value: { pairs: [{ deep: 5100, shallow: 5670 }, { deep: 6700, shallow: 7130 }, { deep: 10320, shallow: 9860 }] }, rationale: 'hip pressed forward' }), null);
  const [a] = await p;
  assert.equal(a.value.sign, 1); assert.equal(a.raw, 0.95);
  assert.deepEqual(a.tools.map((t) => [t.call.tool, t.round]), [['pairs', 0], ['frames', 0]]);
  assert.equal(agent.pending().length, 0);
});

test('agent: rounds and budget bound the need loop; deadline and cancel abstain', async () => {
  const agent = makeAgentBrain({ cdp: true }), tools = fakeTools();
  const req = R('roi', sc(0), { scene: SCENES[0] }, { maxRounds: 2 });
  let p = agent.decide([req], ctxWith(null, { tools }));
  await until(() => agent.pending().length);
  agent.answer(req.id, { need: [{ tool: 'track', tracker: 'cotracker_points', roi: null, t0: 0, t1: 1000 }] });
  assert.equal((await p)[0].abstain, 'budget');   // the only tool is over budget
  p = agent.decide([req], ctxWith(null, { tools }));
  await until(() => agent.pending().length);
  agent.answer(req.id, { need: [{ tool: 'frames', times: [1000] }] });
  await until(() => agent.pending()[0]?.round === 1);
  agent.answer(req.id, { need: [{ tool: 'frames', times: [2000] }] });
  assert.equal((await p)[0].abstain, 'budget');   // out of rounds
  const [d] = await agent.decide([req], ctxWith(null, { settings: { ...DEFAULT_SETTINGS, deadlineMs: 30 } }));
  assert.equal(d.abstain, 'deadline');
  const ac = new AbortController(), q = agent.decide([req], ctxWith(null, { signal: ac.signal }));
  await until(() => agent.pending().length); ac.abort();
  assert.equal((await q)[0].abstain, 'cancelled');
});

test('agent mailbox: req file written, invalid answer -> .error.json, valid answer read and cleaned up', async () => {
  const files = new Map(), io = {
    writeText: async (p, s) => { files.set(p, s); }, readText: async (p) => { if (!files.has(p)) throw new Error('nf'); return files.get(p); },
    remove: async (p) => { files.delete(p); },
    listDir: async (d) => [...files.keys()].filter((p) => p.startsWith(d + '/') && !p.slice(d.length + 1).includes('/')).map((p) => ({ name: p.slice(d.length + 1), path: p })),
  };
  const agent = makeAgentBrain({ io, root: 'C:/data/director/', session: 'dr-20261106-120000', pollMs: 5 });
  assert.equal(await agent.available(), true);
  const req = R('camera', sc(3), { scene: SCENES[3] }), base = 'C:/data/director/dr-20261106-120000';
  const p = agent.decide([req], ctxWith(null));
  await until(() => files.has(`${base}/req/camera_s3.json`));
  assert.equal(JSON.parse(files.get(`${base}/req/camera_s3.json`)).id, 'camera:s3');
  files.set(`${base}/ans/camera_s3.json`, JSON.stringify({ id: 'camera:s3', round: 0, value: { mode: 'wobble' } }));
  await until(() => files.has(`${base}/ans/camera_s3.error.json`));
  assert.match(JSON.parse(files.get(`${base}/ans/camera_s3.error.json`)).error, /camera.mode/);
  files.set(`${base}/ans/camera_s3.json.tmp`, 'partial');   // ignored
  files.set(`${base}/ans/camera_s3.json`, JSON.stringify({ id: 'camera:s3', round: 0, value: { mode: 'sway', p95Px: 7, rateHz: null, phaseMs: null, moveSpans: [], valid: ['relative', 'rate'] }, raw: 0.9, rationale: 'bench leg and penis share every turn' }));
  const [a] = await p;
  assert.deepEqual([a.value.mode, a.raw], ['sway', 0.9]);
  assert.equal(files.has(`${base}/req/camera_s3.json`), false); assert.equal(files.has(`${base}/ans/camera_s3.json`), false);
});

test('signFromPairs / complete: blind pairs -> sign or verify verdict', () => {
  assert.deepEqual(signFromPairs([{ deep: 5100, shallow: 5670 }, { deep: 7130, shallow: 6700 }], PICK_S0), { sign: 0, share: 0.5, n: 2, up: 1 });
  assert.equal(signFromPairs([{ deep: 5670, shallow: 5100 }, { deep: 7130, shallow: 6700 }, { deep: 9860, shallow: 10320 }], PICK_S0).sign, -1);
  assert.equal(signFromPairs([{ deep: 1, shallow: 2 }], PICK_S0), null);
  const v = complete(R('verify', sc(0), { pickPairs: PICK_S0, checks: [] }), { pairs: [{ deep: 5670, shallow: 5100 }] });
  assert.deepEqual([v.value.verdict, v.value.redo, v.value.checks[0].id], ['redo', 'direction', 'frames']);
});
