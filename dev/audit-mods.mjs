// audit-mods.mjs -- paw-r9nh: numbers for the modifiers' fit / timing on generated strokes (node dev/audit-mods.mjs)
import { applyFx, baseTurns, FX_KIND_IDS, singleThrob, throbBeat, fxParams } from '../src/lib/fx.js';
import { finalScript } from '../src/lib/finish.js';
import { posAt } from '../src/lib/core/script.js';

function tracked() {   // as test/fx.test.mjs: 0..20 s half-strokes ~500 ms, 20..40 s ~180 ms; bottoms ~5, tops ~90
  const out = []; let t = 0, top = false, k = 0;
  while (t <= 40000) { out.push({ at: Math.round(t), pos: top ? 88 + (k % 3) : 4 + (k % 2) }); t += t < 20000 ? 500 + (k % 4) * 10 : 180 + (k % 3) * 5; top = !top; k++; }
  return out;
}
const BASE = tracked();
const speed = (s, a, b) => { let m = 0; for (let i = 1; i < s.length; i++) if (s[i].at >= a && s[i - 1].at <= b) m = Math.max(m, Math.abs(s[i].pos - s[i - 1].pos) * 1000 / (s[i].at - s[i - 1].at)); return m; };
// edge: |out - base| at the edge, and the speed excess of the out over the base within 150 ms of it
const edge = (out, te) => ({ gap: Math.abs(posAt(out, te) - posAt(BASE, te)), dv: Math.round(speed(out, te - 150, te + 150) - speed(BASE, te - 150, te + 150)) });
const turnErr = (out, a, b) => { const o = baseTurns(out, a - 400, b + 400).map((x) => x.at); return Math.max(0, ...baseTurns(BASE, a, b).map((x) => Math.min(...o.map((t) => Math.abs(t - x.at))))); };
const SPANS = { slow: [3250, 13250], fast: [22090, 32000] };   // mid-stroke edges (not on turns)
for (const kind of FX_KIND_IDS) {
  if (kind === 'spurt') continue;
  for (const [nm, [t0, t1]] of Object.entries(SPANS)) {
    const out = applyFx(BASE, [{ id: 'e', kind, t0, t1, params: kind === 'shape' ? { lo: 20, hi: 70 } : {} }]);
    const a = edge(out, t0), b = edge(out, t1);
    console.log(kind.padEnd(10), nm, 'edge t0 gap', a.gap.toFixed(1), 'dv', a.dv, '| t1 gap', b.gap.toFixed(1), 'dv', b.dv, '| turn err ms', ['orgasm', 'climax', 'shape', 'knotting'].includes(kind) ? turnErr(out, t0 + 500, t1 - 500) : '-');
  }
}
// speed cap: the final with the machine's 150 pos/s limit
const doc = { axes: { stroke: [{ at: 0, pos: 50 }, { at: 40000, pos: 50 }] }, fx: [{ id: 's', kind: 'spurt', t0: 25000, t1: 25000, params: { amount: 40 } }, { id: 't', kind: 'throbbing', t0: 5000, t1: 9000, params: { amount: 30 } }], scenes: [], finish: null };
const fin = finalScript(doc, 'stroke', { maxSpeed: 150 });
console.log('final under a 150 pos/s machine cap: max speed in the spurt window', Math.round(speed(fin, 24500, 25600)), 'throb window', Math.round(speed(fin, 5000, 9000)));
// single throb under a cap: its dip should sit on the frame
const s = singleThrob(2000, { amount: 30 }), flat = [{ at: 0, pos: 100 }, { at: 30000, pos: 100 }];
const th = applyFx(flat, [{ id: 'th', kind: 'throbbing', ...s }], { maxSpeed: 300 });
console.log('single throb amount 30 cap 300: dip at', th.find((x) => x.pos === 70)?.at, 'want 2000');
