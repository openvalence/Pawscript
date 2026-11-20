#!/usr/bin/env node
// answer.mjs -- reference answerer for the director mailbox (README §7.2; protocol in ./README.md). No deps.
//   node tools/director-agent/answer.mjs <session dir> --policy rules
//   node tools/director-agent/answer.mjs <session dir> --policy replay DIRECTOR-TRACE-2.json
//   node tools/director-agent/answer.mjs <session dir> --policy prompt        (prints the request, reads one JSON line)
// Options: --once (exit when nothing is left to answer), --poll <ms> (500). Exits when session.json says stopped / done.
import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { answer as rulesAnswer } from '../../src/features/director/brains/rules.js';
import { lookup } from '../../src/features/director/brains/replay.js';
import { fromTrace2, factsLine } from '../../src/lib/director/trace.js';

const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const dir = args[0], policy = opt('--policy') ?? 'rules', once = args.includes('--once'), pollMs = Number(opt('--poll') ?? 500);
if (!dir || !['rules', 'replay', 'prompt'].includes(policy)) { process.stderr.write('usage: answer.mjs <session dir> --policy rules|replay <trace.json>|prompt [--once]\n'); process.exit(2); }
const replay = policy === 'replay' ? fromTrace2(JSON.parse(readFileSync(args[args.indexOf('--policy') + 2], 'utf8'))).replay : null;
const log = (s) => process.stderr.write(s + '\n');
const ls = (d) => { try { return readdirSync(d); } catch { return []; } };
const lines = policy === 'prompt' ? createInterface({ input: process.stdin })[Symbol.asyncIterator]() : null;

async function decideOne(req) {
  if (policy === 'rules') {
    const a = rulesAnswer(req);
    if (a.value?.evidence) { const { evidence, ...v } = a.value; a.value = v; }
    return a;
  }
  if (policy === 'replay') { const h = lookup(replay, req); return h ? { value: h.value, raw: h.conf ?? 0.9, rationale: 'replay: ' + (h.rationale ?? '') } : { abstain: 'not in the trace' }; }
  log(`\n=== ${req.id} (round ${req.round}/${req.maxRounds}, attempt ${req.attempt})\n${req.question}\nfacts: ${factsLine(req)}`);
  if (req.prior) log(`prior (rejected by verify): ${JSON.stringify(req.prior.value)}`);
  for (const e of req.evidence ?? []) log(`  [${e.type}] ${e.what}${e.path ? ' -> ' + join(dir, e.path) : ''}${e.tiles ? ' tiles ' + e.tiles.map((t) => `${t.label}@${t.t}`).join(' ') : ''}`);
  log('answer as one JSON line: {"value": ...} | {"need": [ToolCall]} | {"abstain": "why"}  (+ "raw", "rationale")');
  const { value: line, done } = await lines.next();
  if (done) return { abstain: 'no input' };
  try { return JSON.parse(line); } catch (e) { log('not JSON: ' + e.message); return decideOne(req); }
}

const seen = new Map();   // req file -> its content when answered (a rewritten request is answered again)
async function scan() {
  const reqDir = join(dir, 'req'), ansDir = join(dir, 'ans');
  let left = 0;
  for (const f of ls(reqDir)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    let text, req;
    try { text = readFileSync(join(reqDir, f), 'utf8'); req = JSON.parse(text); } catch { continue; }   // mid-write
    const stem = f.slice(0, -5), errFile = join(ansDir, `${stem}.error.json`);
    if (seen.get(f) === text) {
      if (existsSync(errFile) && statSync(errFile).mtimeMs > (seen.get(f + '#at') ?? 0)) {
        log(`${req.id}: answer refused: ${JSON.parse(readFileSync(errFile, 'utf8')).error}`);
        seen.set(f + '#at', statSync(errFile).mtimeMs);
        if (policy === 'prompt') seen.delete(f);
      }
      continue;
    }
    left++;
    const a = await decideOne(req);
    mkdirSync(ansDir, { recursive: true });
    const tmp = join(ansDir, `${stem}.json.tmp`);
    writeFileSync(tmp, JSON.stringify({ ...a, id: req.id, round: req.round }));
    renameSync(tmp, join(ansDir, `${stem}.json`));
    seen.set(f, text); seen.set(f + '#at', Date.now());
    log(`${req.id} round ${req.round}: ${a.value !== undefined ? 'value' : a.need ? `need ${a.need.map((c) => c.tool).join(',')}` : 'abstain ' + a.abstain}`);
  }
  for (const k of [...seen.keys()]) if (!k.includes('#') && !existsSync(join(reqDir, k))) { seen.delete(k); seen.delete(k + '#at'); }
  return left;
}

for (;;) {
  try { const s = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')); if (s.status === 'stopped' || s.status === 'done') { log(`session ${s.status}`); break; } } catch { /* no session.json yet */ }
  const n = await scan();
  if (once && !n) break;
  await new Promise((r) => setTimeout(r, pollMs));
}
process.exit(0);
