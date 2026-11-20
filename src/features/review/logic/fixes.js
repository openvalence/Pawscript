// Automatic fixes (pure). A problem from analyze's findProblems carries `fix: {op, opts, sel?}`; `op` is an export
// of src/lib/edit (called op(script, sel, opts) -> {script, ats}) or `normalize` from core/script.js.
import * as edit from '../../../lib/edit/index.js';
import { normalize, lowerBound } from '../../../lib/core/script.js';

const OPS = { ...edit, normalize: (s) => ({ script: normalize(s) }) };

export const OP_LABELS = { normalize: 'Clean up', capSpeed: 'Slow to limit', thinMinGap: 'Merge close points', simplify: 'Remove redundant points',
  removeMicroReversals: 'Remove jitter', cleanMicro: 'Clean micro glitch', limitRange: 'Clamp to range', deletePoints: 'Trim to media' };

export const hasFix = (p) => !!p?.fix && typeof OPS[p.fix.op] === 'function';
export const fixLabel = (p) => OP_LABELS[p?.fix?.op] ?? 'Fix';

/** Pull-capping only re-checks selected points, so keep growing the selection while the point after it is still too fast. */
function capCascade(script, sel, opts) {
  let s = sel, out = script;
  for (let k = 0; k < 200; k++) {
    out = edit.capSpeed(script, s, opts).script;
    const t1 = s.t1 ?? Infinity, i = lowerBound(out, t1 + 1);
    if (i <= 0 || i >= out.length) break;
    const a = out[i - 1], b = out[i];
    if (Math.abs(b.pos - a.pos) * 1000 / (b.at - a.at) <= opts.maxSpeed + 1e-9) break;
    s = { ...s, t1: b.at };
  }
  return out;
}

/** Applies one problem's fix and returns the new Script (the same array if nothing changed). `all`: whole script (fix every problem of that kind at once). */
export function applyFix(script, problem, { all = false } = {}) {
  const f = problem.fix;
  if (!f || typeof OPS[f.op] !== 'function') return script;
  const sel = all ? null : f.sel ?? null;
  const out = f.op === 'capSpeed' && sel && (f.opts?.method ?? 'pull') === 'pull' ? capCascade(script, sel, f.opts) : OPS[f.op](script, sel, f.opts ?? {}).script;
  return out.length === script.length && out.every((a, i) => a === script[i] || (a.at === script[i].at && a.pos === script[i].pos)) ? script : out;
}
