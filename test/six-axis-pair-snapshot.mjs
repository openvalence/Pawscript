// paw-jyde.11: the two-character reading's full output on the six-axis test fixtures (test/six-axis-synth.mjs), as a digest:
// measure()'s series (hashed) and every deriveShot field. test/fixtures/six-axis-pair-head.json holds it as made by the code
// before the solo reading (commit 1c18a5b); test/six-axis-solo.test.mjs asserts today's code gives exactly the same.
// Re-make (only on purpose): node test/six-axis-pair-snapshot.mjs > test/fixtures/six-axis-pair-head.json
import { createHash } from 'node:crypto';
import { measure, deriveShot } from '../src/lib/six-axis.js';
import { synth } from './six-axis-synth.mjs';

const S = 0, F = 1, L = 2;
const hash = (a) => (a ? createHash('sha256').update(Buffer.from(Float64Array.from(a).buffer)).digest('hex').slice(0, 24) : null);
const CASES = [];
for (const view of ['side', 'rear', 'front', 'top', 'rearM', 'topM']) for (const motion of [{ kind: 'move', k: S }, { kind: 'move', k: F }, { kind: 'move', k: L }, { kind: 'rot', k: S }, { kind: 'rot', k: F }, { kind: 'rot', k: L }]) for (const sides of [false, true]) CASES.push({ view, motion, sides });

export function digest() {
  const out = {};
  for (const { view, motion, sides } of CASES) {
    const { run } = synth(view, motion, { sides }), m = measure(run, 0, 1e9, { aspect: 1 });
    const key = `${view}/${motion.kind}${motion.k}/${sides ? 'sides' : 'bare'}`;
    if (!m) { out[key] = null; continue; }
    const meas = { s: hash(m.s), m: Object.fromEntries(Object.entries(m.m).map(([k, v]) => [k, hash(v)])), bottom: m.bottom, top: m.top, solo: m.solo, axis: m.axis, u: m.u, n: m.n, lside: m.lside, d: m.d, members: m.members, keys: Object.keys(m).sort() };
    const tv = view.replace('M', '');
    const runs = [[tv, false, []], ['side', true, []], [tv, false, ['sway', 'pitch']]].map(([v, guessed, flips]) => {
      const d = deriveShot(m, { view: v, guessed, flips });
      return { view: d.view, guessed: d.guessed, keys: Object.keys(d).sort(), axes: Object.fromEntries(Object.entries(d.axes).map(([a, x]) => [a, { ...x, y: hash(x.y) }])) };
    });
    out[key] = { meas, runs };
  }
  // too short / no pair: null at the time
  const { run } = synth('side', { kind: 'move', k: F });
  out.short = measure(run, 0, 900, { aspect: 1 });
  return out;
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) process.stdout.write(JSON.stringify(digest()) + '\n');
