// experiments/fusion/pov.mjs -- paw-5ynj: on a POV shot the contact row 'Bottom head <-> Top penis / hips' averages the camera
// owner's own hips (a sliver at the frame's bottom edge, phase-leading the shaft and partly camera motion) into the penis side,
// so the fused turns land early. Synthetic only (test/fusion-synth.mjs conventions: 20 s at 30 fps, truth = stroke()).
//   node experiments/fusion/pov.mjs            the POV matrix + every synthetic case, before (FUSE.EDGE off) / after
// Turn error = Smart stroke points' turns (strokes.js on the fused v + timing, as the app) minus the truth's, matched one to
// one within 150 ms (same kind); frames at 30 fps; negative = early.
import { fusedChannel, FUSE } from '../../src/lib/fusion.js';
import { strokes as strokesOf, STROKES } from '../../src/lib/strokes.js';
import { T, FPS, CASES, JIT_CASES, CH_CASES, DEPTH_CASES, CAM_CASES, tailScene, povScene } from '../../test/fusion-synth.mjs';
import { polyTurns, mean, med } from './jitter-lib.mjs';

/** One scene -> {err (signed mean, frames), abs (mean |err|, frames), med, F1, n}. */
export function turnErr(s) {
  const d0 = s.derives?.[0] || {}, ch = fusedChannel(s.run, { aspect: s.aspect, derives: [d0] });
  if (!ch) return null;
  const t = Array.from(ch.t), v = Float64Array.from(ch.v), pts = strokesOf(Float64Array.from(t), v, { ...STROKES, conf: ch.conf, timing: Float64Array.from(ch.timing) }).points;
  const ref = s.truth ? T.map((ms, i) => [ms, 50 + 50 * s.truth(i)]) : s.ref;
  const gt = polyTurns(pts.map((p) => p.at), pts.map((p) => p.pos)).map(([k, d]) => [pts[k].at, d]);
  const rt = polyTurns(ref.map((p) => p[0]), ref.map((p) => p[1])).map(([k, d]) => [ref[k][0], d]);
  // orientation: the points may play the other way up; the turn kinds match either all same or all flipped: take the better
  const pair = (flip) => { const P = []; for (let i = 0; i < rt.length; i++) for (let j = 0; j < gt.length; j++) { const dd = gt[j][0] - rt[i][0]; if (Math.abs(dd) <= 150 && rt[i][1] === flip * gt[j][1]) P.push([Math.abs(dd), i, j, dd]); } P.sort((a, b) => a[0] - b[0]); const ui = new Set(), uj = new Set(), e = []; for (const [, i, j, dd] of P) if (!ui.has(i) && !uj.has(j)) { ui.add(i); uj.add(j); e.push(dd); } return e; };
  const a = pair(1), b = pair(-1), e = a.length >= b.length ? a : b, fr = 1000 / FPS;
  return { err: mean(e) / fr, abs: mean(e.map(Math.abs)) / fr, med: med(e) / fr, F1: (2 * e.length) / (rt.length + gt.length), n: e.length, v };
}

const EDGE0 = FUSE.EDGE;
const both = (make) => { FUSE.EDGE = null; const b = turnErr(make()); FUSE.EDGE = EDGE0; const a = turnErr(make()); return [b, a]; };
const f = (x, k = 2) => (Number.isFinite(x) ? (x >= 0 ? ' ' : '') + x.toFixed(k) : '  -  ');
const same = (b, a) => b && a && b.v.length === a.v.length && b.v.every((x, i) => (x !== x && a.v[i] !== a.v[i]) || x === a.v[i]);

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('pov.mjs')) {
  console.log(`FUSE.EDGE = ${JSON.stringify(EDGE0)}  (before = null)\n`);
  console.log('POV matrix: signed turn error (frames, - = early), mean |err|, F1   before -> after');
  const M = [];
  for (const leadMs of [0, 60, 90, 120]) for (const hipsAmp of [0.012, 0.02, 0.03]) for (const seed of [1, 2]) M.push({ leadMs, hipsAmp, seed });
  M.push({ leadMs: 90, hipsAmp: 0.02, seed: 1, hipsY: 0.9, note: 'hips not at the edge (y 0.90)' });
  M.push({ leadMs: 90, hipsAmp: 0.02, seed: 1, acts: ['oral'], note: 'oral only' });
  M.push({ leadMs: 90, hipsAmp: 0.02, seed: 1, parallax: 0, note: 'no parallax' });
  const agg = { b: [], a: [] };
  for (const o of M) {
    const [b, a] = both(() => povScene(o));
    if (o.leadMs && !o.note) { agg.b.push(b); agg.a.push(a); }
    console.log(`lead ${String(o.leadMs).padStart(3)} ms amp ${o.hipsAmp} seed ${o.seed}${o.note ? ' ' + o.note : ''}: err ${f(b.err)} -> ${f(a.err)}  |err| ${f(b.abs)} -> ${f(a.abs)}  F1 ${f(b.F1)} -> ${f(a.F1)}${same(b, a) ? '  (identical)' : ''}`);
  }
  console.log(`\nPOV mean over lead > 0: err ${f(mean(agg.b.map((x) => x.err)))} -> ${f(mean(agg.a.map((x) => x.err)))} frames, |err| ${f(mean(agg.b.map((x) => x.abs)))} -> ${f(mean(agg.a.map((x) => x.abs)))}, F1 ${f(mean(agg.b.map((x) => x.F1)))} -> ${f(mean(agg.a.map((x) => x.F1)))}`);
  console.log('\nEvery other synthetic case (no POV): before -> after');
  let n = 0, ident = 0;
  for (const c of [...CASES, ...JIT_CASES, ...CH_CASES, ...DEPTH_CASES, ...CAM_CASES, { id: 'tail-200', make: () => tailScene(200) }]) {
    if (c.make().idx) continue;   // (a span of the run: not this harness)
    const [b, a] = both(c.make);
    if (!b) continue;
    n++; if (same(b, a)) ident++;
    const dv = Math.max(...Array.from(b.v, (x, i) => (x === x ? Math.abs(x - a.v[i]) : 0)));
    console.log(`${c.id.padEnd(22)} err ${f(b.err)} -> ${f(a.err)}  |err| ${f(b.abs)} -> ${f(a.abs)}  F1 ${f(b.F1)} -> ${f(a.F1)}${same(b, a) ? '  (identical)' : `  max |dv| ${dv.toExponential(1)} (0..1 scale)`}`);
  }
  console.log(`\n${ident} / ${n} non-POV cases bit-identical`);
}
