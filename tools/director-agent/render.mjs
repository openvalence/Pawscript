#!/usr/bin/env node
// render.mjs -- plan + tracker runs -> stroke script through the APP's generator (planCtx + generatePlan), so the eval
// scores what the app would write (README §7.4). No deps.
//   node tools/director-agent/render.mjs plan.json runs.json [--max-speed 450] > {script, issues}
// plan.json: plan segments as importTimeline returns them ({id?, t0, t1, kind, recipe, params, source?}), or director rows
//            ({start_ms, end_ms, kind, ...}; `source` kept). runs.json: [{id, script:[{at,pos}], range:{t0,t1}}].
import { readFileSync } from 'node:fs';
import { planCtx, generatePlan } from '../../src/features/timeline/generate-logic.js';
import { importTimeline } from '../../src/features/timeline/plan.js';
import * as gen from '../../src/lib/gen/index.js';

const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const [planPath, runsPath] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!planPath || !runsPath) { process.stderr.write('usage: render.mjs plan.json runs.json [--max-speed 450]\n'); process.exit(2); }

let n = 0;
const newId = () => `seg${++n}`;
function render(rows, runs, maxSpeed = 450) {
  const director = rows.some((r) => r.start_ms != null);
  const plan = director ? importTimeline(rows, { newId }).plan.map((s) => { const src = rows.find((r) => Math.round(r.start_ms) === s.t0)?.source; return src ? { ...s, source: src } : s; }) : rows.map((s) => ({ ...s, id: s.id ?? newId() }));
  const ghosts = runs.map((r) => ({ id: r.id, axis: 'stroke', visible: true, script: r.script, source: { kind: 'tracker', range: r.range } }));
  const { ctx } = planCtx({ plan, ghosts, activeAxis: 'stroke', media: { name: '' } }, { maxSpeed });
  const res = generatePlan([], plan, { scope: 'all', ctx, gen });
  return { script: res.script, issues: res.issues };
}
const out = render(JSON.parse(readFileSync(planPath, 'utf8')), JSON.parse(readFileSync(runsPath, 'utf8')), Number(opt('--max-speed') ?? 450));
process.stdout.write(JSON.stringify(out) + '\n');
