// Rhythm: stroke rate, repeating strokes and selections.
import { lowerBound } from '../core/script.js';
import { selInfo, compose, mergeWin, sortDedupe, tile, rnd, O, fin } from './util.js';
import { turns } from './strokes.js';
import { place } from './clipboard.js';

const selected = (script, info) => info.idx.map((i) => script[i]);

/** Rebuild the selected series S: head before the first turn stays, `unit(S, T, k)` rewrites consecutive groups of turns, tail stays. */
function cycleOp(script, sel, minProminence, step, perUnit) {
  const info = selInfo(script, sel);
  if (info.n < 3) return { script, ats: info.idx.map((i) => script[i].at) };
  const S = selected(script, info), T = turns(S, minProminence).map((t) => t.i);
  const out = [];
  if (T.length < 3) return { script, ats: S.map((a) => a.at) };
  for (let q = 0; q < T[0]; q++) out.push(S[q]);
  let cur = T[0];
  for (let k = 0; k + step <= T.length - 1; k += step) { perUnit(S, T, k, out); cur = T[k + step]; }
  for (let q = cur; q < S.length; q++) out.push(S[q]);
  return compose(script, info.m, out);
}

/** Double time (factor 2) or n-times: every full cycle (bottom-top-bottom) is replaced by `factor` copies, each 1/factor as long.
 *  Total duration is unchanged. minProminence filters the turning points that define cycles. */
export function doubleTime(script, sel, opts) {
  const { factor = 2, minProminence = 0 } = O(opts), F = Math.max(2, Math.floor(factor));
  return cycleOp(script, sel, minProminence, 2, (S, T, k, out) => {
    const ia = T[k], ic = T[k + 2], a = S[ia].at, L = S[ic].at - a;
    for (let r = 0; r < F; r++) for (let q = ia; q < ic; q++) out.push({ at: a + (r * L) / F + (S[q].at - a) / F, pos: S[q].pos });
  });
}

/** Half time: every group of `factor` cycles keeps only one (keep 'first' | 'last') stretched to fill the group's time. */
export function halfTime(script, sel, opts) {
  const { factor = 2, keep = 'first', minProminence = 0 } = O(opts), F = Math.max(2, Math.floor(factor));
  return cycleOp(script, sel, minProminence, 2 * F, (S, T, k, out) => {
    const a = S[T[k]].at, e = S[T[k + 2 * F]].at;
    const from = keep === 'last' ? T[k + 2 * F - 2] : T[k], to = keep === 'last' ? T[k + 2 * F] : T[k + 2];
    const f0 = S[from].at, len = S[to].at - f0, g = len > 0 ? (e - a) / len : 1;
    for (let q = from; q < to; q++) out.push({ at: a + (S[q].at - f0) * g, pos: S[q].pos });
  });
}

/** Change stroke rate keeping amplitude: times scale by 1/factor (factor 2 = twice as fast). The selection's old span is then filled:
 *  fill 'repeat' (tile the changed pattern over the old span, cut at its end), 'ripple' (later actions follow, script gets shorter/longer),
 *  'none' (leave the gap / overlap). */
export function changeStrokeRate(script, sel, opts) {
  const { factor = 2, fill = 'repeat', seam = 'next' } = O(opts), f = Math.max(0.01, fin(factor, 1));
  const info = selInfo(script, sel);
  if (!info.n) return { script, ats: [] };
  const first = script[info.idx[0]].at, last = script[info.idx[info.n - 1]].at, span = last - first;
  const rel = info.idx.map((i) => ({ at: (script[i].at - first) / f, pos: script[i].pos }));
  if (fill === 'repeat' && span > 0) {
    const pts = tile(rel, span / f, first, last, { seam });
    return compose(script, info.m, pts);
  }
  const pts = sortDedupe(rel.map((a) => ({ at: rnd(first + a.at), pos: a.pos })));
  if (fill === 'ripple' && span > 0) {
    const d = rnd(span / f) - span;
    const rest = sortDedupe(script.filter((_, i) => !info.m[i]).map((a) => (a.at > last ? { at: a.at + d, pos: a.pos } : a.at > first ? { at: rnd(first + (a.at - first) / f), pos: a.pos } : a)));
    return { script: mergeWin(rest, pts), ats: pts.map((a) => a.at) };
  }
  return compose(script, info.m, pts);
}

/** "Q": copy the last up/down pair (shape 'cycle', or a single 'stroke') that ends at or before the playhead `at` so it starts at the
 *  playhead; `count` copies back to back. mode 'replace' clears the pasted span first | 'merge' | 'insert' (ripple). Returns the script
 *  unchanged (ats []) if there is no complete pair before the playhead. */
export function repeatLastStroke(script, sel, opts) {
  const { at, count = 1, shape = 'cycle', mode = 'replace', minProminence = 0, seam = 'next' } = O(opts);
  if (!Number.isFinite(at)) return { script, ats: [] };
  const prefix = script.slice(0, lowerBound(script, at + 1)), T = turns(prefix, minProminence);
  // turns() appends the last point as an endpoint turn; after a trailing hold it has the same pos as the real last turn: not a stroke.
  if (T.length > 1 && prefix[T[T.length - 1].i].pos === prefix[T[T.length - 2].i].pos) T.pop();
  const need = shape === 'stroke' ? 2 : 3;
  if (T.length < need) return { script, ats: [] };
  let i0 = T[T.length - need].i;
  const i1 = T[T.length - 1].i;
  while (i0 + 1 < i1 && prefix[i0 + 1].pos === prefix[i0].pos) i0++; // turns() gives a plateau's first index: start at its last
  const base = prefix[i0].at, span = prefix[i1].at - base;
  if (!(span > 0)) return { script, ats: [] };
  const rel = prefix.slice(i0, i1 + 1).map((a) => ({ at: a.at - base, pos: a.pos }));
  const n = Math.max(1, Math.floor(count)), pts = tile(rel, span, rnd(at), Infinity, { copies: n, seam });
  const end = pts[pts.length - 1].at;
  return { script: place(script, pts, mode, rnd(at), end, end - rnd(at)), ats: pts.map((a) => a.at) };
}

/** Repeat the selection (a snippet from its first to last action; or the range). period default = its span, so the last action
 *  of a copy is the first of the next; set period for a different loop length (longer holds, shorter overlaps and merges).
 *  Give count (extra copies) or until (time T: copies are cut there with an interpolated point). seam ('next' | 'prev' | 'mean')
 *  resolves the shared boundary point when first and last pos differ. mode 'replace' (clear what the copies cover) | 'merge' | 'insert'. */
export function repeatSelection(script, sel, opts) {
  const { count = 1, until, period, seam = 'next', mode = 'replace' } = O(opts);
  const info = selInfo(script, sel);
  if (!info.n) return { script, ats: [] };
  const first = info.isRange ? info.t0 : script[info.idx[0]].at, last = script[info.idx[info.n - 1]].at;
  const span = (info.isRange ? info.t1 : last) - first, per = period > 0 ? period : span;
  if (!(per > 0)) return { script, ats: [] };
  const rel = info.idx.map((i) => ({ at: script[i].at - first, pos: script[i].pos }));
  const hasUntil = Number.isFinite(until);
  const pts = tile(rel, per, first, hasUntil ? until : Infinity, { copies: hasUntil ? Infinity : Math.max(0, Math.floor(count)) + 1, seam });
  if (!pts.length) return { script, ats: [] };
  const end = pts[pts.length - 1].at;
  let out;
  if (mode === 'insert') {
    const by = Math.max(0, end - last), shifted = script.map((a) => (a.at > last ? { at: a.at + by, pos: a.pos } : a));
    out = mergeWin(shifted.filter((a, i) => !info.m[i]), pts);
  } else if (mode === 'merge') out = mergeWin(script.filter((a, i) => !info.m[i]), pts);
  else out = mergeWin(script.filter((a, i) => !info.m[i] && (a.at < first || a.at > end)), pts);
  return { script: out, ats: pts.map((a) => a.at) };
}
