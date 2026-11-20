// checks.js -- oracle-free self-checks (README §10): the rules verify and the panel. Pure.
// Independence: no check compares the script with the run it was generated from alone (DESIGN §3).
import { turns } from '../edit/strokes.js';
import { RECIPES } from '../gen/recipes.js';

/** Which decision a failed check sends back. */
export const REDO_OF = { agree: 'track', camera: 'track', rate: 'track', review: 'depth' };

/** -> [{id, ok, value, limit}]; value null = not applicable (counts as ok). */
export function verifyChecks({ seg, keep = null, others = [], pairs = [], script = [], loopPeriodMs = null, prominence = 0, review = null }) {
  const subj = others.filter((r) => keep && r.id !== keep.id && r.role === 'subject');
  const match = (a, b) => pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))?.match;
  const ms = subj.map((r) => match(keep.id, r.id)).filter(Number.isFinite);
  const agree = ms.length ? Math.max(...ms) : null;
  const share = keep?.cameraShare ?? null, off = keep?.cameraOffsetMs ?? Infinity;
  let rate = null;
  if (loopPeriodMs > 0 && prominence >= 0.3) {
    const part = script.filter((p) => p.at >= seg.t0 && p.at < seg.t1), n = turns(part, 10, { endpoints: false }).length;
    if (n >= 4) rate = Math.round(((n / 2) / ((seg.t1 - seg.t0) / 1000) / (1000 / loopPeriodMs)) * 100) / 100;
  }
  return [
    { id: 'agree', ok: agree === null || agree >= 0.6, value: agree, limit: '>= 0.6 turn match with another subject run' },
    { id: 'camera', ok: share === null || share < 0.8 || off >= 60, value: share, limit: 'camera share < 0.8 or offset >= 60 ms' },
    { id: 'rate', ok: rate === null || Math.abs(rate - 1) <= 0.15, value: rate, limit: 'stroke rate within 15% of the loop' },
    { id: 'review', ok: !review || review.errors === 0, value: review ? review.errors : null, limit: '0 review errors' },
  ];
}

/** Plan problems: gaps, overlaps, unknown recipes, more than one orgasm. -> strings ([] = fine). */
export function planChecks(plan, dur) {
  const p = [...(plan ?? [])].sort((a, b) => a.t0 - b.t0), out = [];
  if (!p.length) return dur > 0 ? ['empty plan'] : [];
  if (p[0].t0 > 0) out.push(`gap 0-${p[0].t0} ms`);
  for (let i = 1; i < p.length; i++) {
    if (p[i].t0 > p[i - 1].t1) out.push(`gap ${p[i - 1].t1}-${p[i].t0} ms`);
    if (p[i].t0 < p[i - 1].t1) out.push(`overlap ${p[i].t0}-${Math.min(p[i].t1, p[i - 1].t1)} ms`);
  }
  if (Number.isFinite(dur) && p[p.length - 1].t1 < dur) out.push(`gap ${p[p.length - 1].t1}-${dur} ms`);
  for (const s of p) if (s.recipe != null && !RECIPES[s.recipe]) out.push(`unknown recipe "${s.recipe}" at ${s.t0} ms`);
  const cl = p.filter((s, i) => s.kind === 'orgasm' && !(i && p[i - 1].kind === 'orgasm' && p[i - 1].t1 === s.t0)).length;   // touching ones = one orgasm
  if (cl > 1) out.push(`${cl} orgasm windows`);
  return out;
}
