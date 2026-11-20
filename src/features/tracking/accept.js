// accept.js -- put a ghost's actions into a script (replace / merge, the join cleanup). Pure. paw-x7w7: no Accept command any
// more; lib/script-of.js composes the live runs / fills with it (each a replace over its shot) and Bake writes the result.
import { normalize, slice, nearest, replaceRange, cleanJoins } from '../../lib/core/script.js';
import { liveFx, fxParams, spurtKeys } from '../../lib/fx.js';
import { DEFAULTS } from '../../lib/gen/util.js';

/**
 * script: the axis's Script; ghost: the ghost's actions (normalised here: ghosts come from other files/agents).
 * range: {t0, t1} | null (null = the whole ghost). tol: merge distance in ms (half a frame).
 * mode 'replace': the span (range, or the ghost's own first..last) is cleared, the ghost's actions go in.
 * mode 'merge':   existing actions stay; ghost actions within `tol` of an existing one are skipped.
 * clean: the join cleanup (core/script.js cleanJoins options, e.g. settings cleanMicroOpts; null = off), run around the
 *   span's edges (replace) or over the merged span (merge: every taken point is a join), plus clean.joins (more join
 *   times / spans, e.g. joinsOfFx) and never inside clean.keep ranges.
 * Returns { script, ats }: the new Script (the same array when nothing changes) and the accepted timestamps (minus any
 * the cleanup removed).
 */
export function acceptGhost(script, ghost, { range = null, mode = 'replace', tol = 0, clean = null } = {}) {
  const g = normalize(ghost || []);
  const take = range ? slice(g, range.t0, range.t1) : g;
  if (!take.length) return { script, ats: [] };
  let out, ats, joins;
  if (mode === 'merge') {
    const add = take.filter((a) => nearest(script, a.at, tol) < 0);
    if (!add.length) return { script, ats: [] };
    out = normalize([...script, ...add]); ats = add.map((a) => a.at); joins = [[ats[0], ats[ats.length - 1]]];
  } else {
    const t0 = range ? range.t0 : take[0].at, t1 = range ? range.t1 : take[take.length - 1].at;
    out = replaceRange(script, t0, t1, take); ats = take.map((a) => a.at); joins = [t0, t1];
  }
  return cleaned(out, ats, [...joins, ...(clean?.joins || [])], clean);
}

/** cleanJoins on an edit's result, its selected timestamps kept in step. -> { script, ats } */
export function cleaned(script, ats, joins, clean) {
  const out = cleanJoins(script, joins, clean);
  if (out === script) return { script, ats };
  const left = new Set(out.map((a) => a.at));
  return { script: out, ats: ats.filter((t) => left.has(t)) };
}

/** The live effects as join cleanup input: their ends are joins, their own spans are kept (a spurt's ringing, a small
 *  knot's steps are the effect, not glitches). A spurt's span is its ringing window (its keys at the speed cap). */
export function joinsOfFx(fx, maxSpeed = DEFAULTS.maxSpeed) {
  const keep = liveFx(fx).map((e) => {
    if (e.kind !== 'spurt') return [e.t0, e.t1];
    const K = spurtKeys(fxParams(e), maxSpeed);
    return [e.t0 + K[0][0], e.t1 + K[K.length - 1][0]];
  });
  return { joins: keep.flat(), keep };
}
