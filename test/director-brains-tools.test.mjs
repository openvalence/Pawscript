// tools/director-agent: brain.mjs (JSONL runner), render.mjs (the app's generator), answer.mjs (mailbox answerer,
// round trip against the real agent brain over the file system).
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { makeAgentBrain } from '../src/features/director/brains/agent.js';
import { decide } from '../src/lib/director/decide.js';
import { DEFAULT_SETTINGS } from '../src/lib/director/decisions.js';
import { makeVlmBrain, Q } from '../src/features/director/brains/vlm.js';
import { SCENES, VIDEO, sc, R } from './director-brains-fixtures.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const tool = (name) => join(ROOT, 'tools', 'director-agent', name);
const node = (name, args, input) => spawnSync(process.execPath, [tool(name), ...args], { input, encoding: 'utf8', timeout: 30000 });
const jsonl = (s) => s.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const tmp = () => mkdtempSync(join(tmpdir(), 'pawdir-'));

test('brain.mjs --brain rules: one {id, decision} per request, same order', () => {
  const reqs = [R('camera', sc(1), { scene: SCENES[1] }), R('camera', sc(3), { scene: SCENES[3] })];
  const r = node('brain.mjs', ['--brain', 'rules'], reqs.map((x) => JSON.stringify(x)).join('\n'));
  assert.equal(r.status, 0, r.stderr);
  const out = jsonl(r.stdout);
  assert.deepEqual(out.map((o) => [o.id, o.decision.value.mode, o.decision.status]), [['camera:s1', 'rides', 'decided'], ['camera:s3', 'sway', 'provisional']]);
});

test('brain.mjs --chain rules,vlm with cached director.ask answers runs the real VLM brain', async () => {
  const req = R('story', sc(2), { scene: SCENES[2], video: VIDEO, scenes: SCENES, camera: { mode: 'move', p95Px: 17, rateHz: 1.5, phaseMs: null, moveSpans: [[40500, 50000]], valid: ['relative', 'rate'] } });
  const asks = {};   // record what the VLM brain asks, answered by a fake model (cutaway everywhere)
  const svc = { call: async (q) => {
    const probs = q.items.map((it) => (q.choices.length === 10 ? Object.fromEntries(q.choices.map((c) => [c, c === 'g' ? 0.8 : 0.02])) : q.choices.length === 4 ? { a: 0.1, b: 0.2, c: 0.5, d: 0.2 } : { yes: it.text.endsWith(Q.vis) ? 0.1 : 0.9, no: 0.1 }));
    q.items.forEach((it, i) => { asks[`${q.video}|${q.choices.length === 10 ? 'kind' : q.choices.length === 4 ? 'int' : it.text.endsWith(Q.vis) ? 'vis' : 'cont'}|${it.frames[0].t_ms}`] = probs[i]; });
    return { result: { probs } };
  } };
  await makeVlmBrain().decide([req], { service: svc, signal: new AbortController().signal });
  const d = tmp(), f = join(d, 'asks.json');
  writeFileSync(f, JSON.stringify({ asks }));
  const r = node('brain.mjs', ['--chain', 'rules,vlm', '--vlm-answers', f], JSON.stringify(req));
  assert.equal(r.status, 0, r.stderr);
  const [o] = jsonl(r.stdout);
  assert.equal(o.decision.brain, 'rules+vlm'); assert.equal(o.decision.value.segments[0].kind, 'offscreen');
  // BrainAnswers by id (stub) also work; a miss falls back to rules alone
  writeFileSync(f, JSON.stringify({}));
  assert.equal(jsonl(node('brain.mjs', ['--chain', 'rules,vlm', '--vlm-answers', f], JSON.stringify(req)).stdout)[0].decision.brain, 'rules');
  rmSync(d, { recursive: true, force: true });
});

test('render.mjs: plan rows with source -> script through the app generator, 0 issues', () => {
  const d = tmp(), run = [];
  for (let t = 0; t <= 10000; t += 400) run.push({ at: t, pos: (t / 400) % 2 ? 90 : 5 });
  writeFileSync(join(d, 'plan.json'), JSON.stringify([
    { start_ms: 0, end_ms: 10000, kind: 'penetration', recipe: 'penetration', source: 'run21' },
    { start_ms: 10000, end_ms: 20000, kind: 'offscreen', recipe: 'penetration-strokes', params: { rate: 3 } },
    { start_ms: 20000, end_ms: 25000, kind: 'outro', recipe: 'hold' }]));
  writeFileSync(join(d, 'runs.json'), JSON.stringify([{ id: 'run21', script: run, range: { t0: 0, t1: 10000 } }]));
  const r = node('render.mjs', [join(d, 'plan.json'), join(d, 'runs.json'), '--max-speed', '450']);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.deepEqual(o.issues, []);
  const first = o.script.filter((p) => p.at < 10000).length, strokes = o.script.filter((p) => p.at >= 10000 && p.at < 20000).length;
  assert.ok(first >= 20, String(first)); assert.ok(strokes >= 28 && strokes <= 45, String(strokes));   // 3 turns/s for 10 s, plus two-speed mid points
  rmSync(d, { recursive: true, force: true });
});

// node fs as the app.backend surface the agent brain needs
const fsIo = {
  writeText: async (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p + '.w', s); renameSync(p + '.w', p); },
  readText: async (p) => readFileSync(p, 'utf8'),
  listDir: async (d) => readdirSync(d).map((name) => ({ name, path: join(d, name) })),
  remove: async (p) => rmSync(p, { force: true }),
  mkdir: async (d) => mkdirSync(d, { recursive: true }),
};

test('answer.mjs --policy rules answers the agent brain through the file mailbox (round trip with decide)', async () => {
  const root = tmp(), session = 'dr-20261106-120000', sdir = join(root, session);
  mkdirSync(sdir, { recursive: true });
  writeFileSync(join(sdir, 'session.json'), JSON.stringify({ schema: 'pawscript.director/1', session, status: 'running' }));
  const child = spawn(process.execPath, [tool('answer.mjs'), sdir, '--policy', 'rules', '--poll', '50'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; child.stderr.on('data', (x) => { err += x; });
  try {
    const agent = makeAgentBrain({ io: fsIo, root, session, pollMs: 50 });
    const reqs = [R('camera', sc(3), { scene: SCENES[3] }), R('story', sc(0), { scene: SCENES[0], video: VIDEO, scenes: SCENES })];
    const ctx = { signal: new AbortController().signal, tools: null, note: () => {}, now: () => Date.now() };
    const out = await decide(reqs, { brains: { agent }, settings: { ...DEFAULT_SETTINGS, preset: 'rules+vlm+agent', askUser: false, override: { camera: { chain: ['agent'] }, story: { chain: ['agent'] } } }, calib: null, records: {}, overrides: {}, ctx, enqueue: () => {} });
    assert.deepEqual(out.map((d) => [d.brain, d.calibrated]), [['agent', false], ['agent', false]], err);
    assert.equal(out[0].value.mode, 'sway'); assert.equal(out[1].value.segments[0].kind, 'penetration');
    assert.equal(readdirSync(join(sdir, 'req')).filter((f) => f.endsWith('.json')).length, 0);   // consumed
  } finally {
    writeFileSync(join(sdir, 'session.json'), JSON.stringify({ session, status: 'stopped' }));
    await new Promise((r) => { child.on('exit', r); setTimeout(() => { child.kill(); r(); }, 3000); });
    rmSync(root, { recursive: true, force: true });
  }
  assert.ok(!existsSync(root));
});

test('answer.mjs --policy replay --once answers from a trace and exits', () => {
  const d = tmp(), sdir = join(d, 's');
  mkdirSync(join(sdir, 'req'), { recursive: true });
  const req = R('track', { scene: 0, t0: 0, t1: 26489 }, { runs: [{ id: 'run25', role: 'subject', tracker: 'cotracker_points', channel: 'proj' }] });
  writeFileSync(join(sdir, 'req', 'track_s0@0.json'), JSON.stringify(req));
  writeFileSync(join(d, 't.json'), JSON.stringify({ trace: [{ stage: 'tracking.compare.s0', decision: { keep: 'run25 (whole scene)', agree: [], reject: [] }, confidence: 0.8 }] }));
  const r = spawnSync(process.execPath, [tool('answer.mjs'), sdir, '--policy', 'replay', join(d, 't.json'), '--once', '--poll', '20'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  const a = JSON.parse(readFileSync(join(sdir, 'ans', 'track_s0@0.json'), 'utf8'));
  assert.deepEqual([a.id, a.round, a.value.keep, a.raw], ['track:s0@0', 0, 'run25', 0.8]);
  rmSync(d, { recursive: true, force: true });
});
