// follow.js -- what the machine follows (pure, paw-rtby): spans put into a script as a replace over each (followBase), the
// span at a time (followAt), a running track's frames as points (liveScript). paw-x7w7: the runs, fills and bridges are
// live in the script itself (lib/script-of.js); what is left here is the running track's trace (follow.svelte.js).
import { acceptGhost } from '../features/tracking/accept.js';
import { lowerBound } from './core/script.js';


/** A live track's frames {t, v (0..1, 1 = out)} as points (finite values only). */
export function liveScript(fr) {
  const out = [];
  if (!fr?.t?.length) return out;
  for (let i = 0; i < fr.t.length; i++) {
    const v = fr.v[i];
    if (Number.isFinite(v) && Number.isFinite(fr.t[i])) out.push({ at: Math.round(fr.t[i]), pos: Math.max(0, Math.min(100, v * 100)) });
  }
  return out;
}

const inSpan = (s, t0, t1) => { const a = lowerBound(s, t0); let b = a; while (b < s.length && s[b].at <= t1) b++; return s.slice(a, b); };
const same = (a, b) => a.length === b.length && a.every((p, k) => p.at === b[k].at && p.pos === b[k].pos);

/** spans applied onto base in order (Accept replace over [t0, t1]; tol / clean as Accept passes them).
 *  -> {script (base itself when nothing changes), spans (the ones that changed it)} */
export function followBase(base, spans, { tol = 0, clean = null } = {}) {
  let out = base || [];
  const used = [];
  for (const s of spans) {
    if (!s?.script?.length || !(s.t1 >= s.t0)) continue;
    const r = acceptGhost(out, s.script, { range: { t0: s.t0, t1: s.t1 }, mode: 'replace', tol, clean }).script;
    if (r === out || same(inSpan(r, s.t0, s.t1), inSpan(out, s.t0, s.t1))) continue;
    out = r; used.push(s);
  }
  return { script: out, spans: used };
}

/** The span the machine follows at t (the last applied one covering t), else null (the script itself). */
export function followAt(spans, t) {
  for (let k = (spans?.length || 0) - 1; k >= 0; k--) if (t >= spans[k].t0 && t <= spans[k].t1) return spans[k];
  return null;
}
