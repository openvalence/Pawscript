#!/usr/bin/env node
// brain.mjs -- run the director brains on DecisionRequest JSONL (README §7.4; the eval's driver). No deps.
//   node tools/director-agent/brain.mjs --brain rules < requests.jsonl > answers.jsonl
//   node tools/director-agent/brain.mjs --chain rules,vlm --calib calib.json --vlm-answers asks.json < requests.jsonl
// stdout: one {id, decision} per request, same order.
// --brain X          every kind's chain is [X] (rules | vlm | replay)
// --chain a,b        every kind's chain is this list (decide() as in the app: story combines rules + vlm)
// --calib F          calib.json {[brain]:{[kind]:{a,b,n,ci95}}}
// --vlm-answers F    cached VLM: {"asks": {"<video>|<q>|<t_ms>": {choice: p}}} replayed through the real VLM brain
//                    (q = kind|cont|vis|int), or BrainAnswers by id ({[id]: answer} or [answer]) for a stub brain
// --vlm-live "W..."  live director.ask through a one-shot sidecar launcher (e.g. "uv run --project trackers pawtrack");
//                    GPU: wrap this whole command in trackers/gpu_lock.py
// --save-asks F      write the director.ask answers seen (the --vlm-answers "asks" format)
// --vlm-model M      default qwen3.5-2b;  --replay F  a trace-2 JSON for the replay brain
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { decide } from '../../src/lib/director/decide.js';
import { KINDS, DEFAULT_SETTINGS } from '../../src/lib/director/decisions.js';
import { fromTrace2 } from '../../src/lib/director/trace.js';
import { makeBrains, makeVlmBrain } from '../../src/features/director/brains/index.js';
import { Q } from '../../src/features/director/brains/vlm.js';

const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const qOf = (req, item) => (req.choices.length === 10 ? 'kind' : req.choices.length === 4 ? 'int' : item.text.endsWith(Q.vis) ? 'vis' : 'cont');
const askKey = (req, item) => `${req.video}|${qOf(req, item)}|${item.frames[0].t_ms}`;

/** One-shot sidecar per call: request on stdin, JSONL events, result | error. */
const liveService = (words) => ({
  call: (request) => new Promise((resolve) => {
    const [cmd, ...rest] = words.split(/\s+/).filter(Boolean), p = spawn(cmd, rest, { stdio: ['pipe', 'pipe', 'inherit'] });
    let buf = '', done = null;
    p.stdout.on('data', (d) => { buf += d; for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) { try { const e = JSON.parse(buf.slice(0, i)); if (e.type === 'result') done = { result: e }; else if (e.type === 'error') done = { error: e.message }; } catch { /* not JSON */ } } });
    p.on('close', (code) => resolve(done ?? { error: `sidecar exited ${code}` }));
    p.on('error', (e) => resolve({ error: e.message }));
    p.stdin.end(JSON.stringify(request) + '\n');
  }),
});
/** Replays cached asks; a miss is an error (the VLM brain abstains). */
const cachedService = (asks) => ({
  call: async (req) => {
    const probs = req.items.map((it) => asks[askKey(req, it)]);
    return probs.every(Boolean) ? { result: { probs } } : { error: `director.ask: ${probs.filter((x) => !x).length} answers not in the cache` };
  },
});
const recording = (svc, store) => ({
  call: async (req, o) => { const r = await svc.call(req, o); if (r.result?.probs) req.items.forEach((it, i) => { store[askKey(req, it)] = r.result.probs[i]; }); return r; },
});

async function main() {
  const reqs = readFileSync(0, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  const chain = opt('--chain')?.split(',') ?? [opt('--brain') ?? 'rules'];
  const model = opt('--vlm-model') ?? 'qwen3.5-2b';
  const brains = makeBrains({ replay: opt('--replay') ? fromTrace2(readJson(opt('--replay'))).replay : {} });
  const asks = {};
  let service = null;
  if (opt('--vlm-live')) service = liveService(opt('--vlm-live'));
  const cached = opt('--vlm-answers') ? readJson(opt('--vlm-answers')) : null;
  if (cached?.asks) service = cachedService(cached.asks);
  if (service && opt('--save-asks')) service = recording(service, asks);
  if (service) brains.vlm = makeVlmBrain({ model });
  else if (cached) {
    const byId = Array.isArray(cached) ? Object.fromEntries(cached.map((a) => [a.id, a])) : cached;
    brains.vlm = { id: 'vlm', kinds: ['story', 'climax'], available: async () => true, decide: async (rs) => rs.map((r) => byId[r.id] ?? { id: r.id, abstain: 'no cached answer' }) };
  }
  const preset = chain.includes('agent') ? 'rules+vlm+agent' : chain.includes('vlm') ? 'rules+vlm' : 'rules';
  const settings = { ...DEFAULT_SETTINGS, preset, askUser: chain.includes('user'), vlmModel: model, override: Object.fromEntries(KINDS.map((k) => [k, { chain }])) };
  const ctx = { signal: new AbortController().signal, service, tools: null, note: (t) => process.stderr.write(t + '\n'), now: () => Date.now() };
  const calib = opt('--calib') ? readJson(opt('--calib')) : null;
  const out = await decide(reqs, { brains, settings, calib, records: {}, overrides: {}, ctx, budget: null, enqueue: () => {} });
  for (const d of out) process.stdout.write(JSON.stringify({ id: d.req.id, decision: d }) + '\n');
  if (opt('--save-asks')) writeFileSync(opt('--save-asks'), JSON.stringify({ asks }, null, 0));
}
main().catch((e) => { process.stderr.write(String(e?.stack ?? e) + '\n'); process.exit(1); });
