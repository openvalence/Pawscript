// Clipboard. A snippet is { origin, duration, actions: [{at relative to origin, pos}] } - a plain value, safe to keep and re-paste.
import { selInfo, mergeWin, sortDedupe, tile, rnd, O } from './util.js';
import { deletePoints } from './points.js';
import { rippleDelete } from './time.js';

/** Copy the selected actions. Range selection: origin = t0, duration = t1 - t0; action selection: origin = first, duration = last - first.
 *  Returns a snippet (not {script, ats}). */
export function copy(script, sel) {
  const info = selInfo(script, sel);
  if (!info.n) return { origin: info.t0 ?? 0, duration: info.isRange ? info.t1 - info.t0 : 0, actions: [] };
  const origin = info.isRange ? info.t0 : script[info.idx[0]].at;
  return { origin, duration: info.t1 - origin, actions: info.idx.map((i) => ({ at: script[i].at - origin, pos: script[i].pos })) };
}

/** Copy then delete. ripple closes the gap (time range first..last selected / the range). -> { script, ats: [], snippet }. */
export function cut(script, sel, opts) {
  const snippet = copy(script, sel);
  const r = O(opts).ripple ? rippleDelete(script, sel) : deletePoints(script, sel);
  return { script: r.script, ats: [], snippet };
}

const place = (script, pts, mode, t0, t1, shiftBy) => {
  let base = script;
  if (mode === 'replace') base = script.filter((a) => a.at < t0 || a.at > t1);
  else if (mode === 'insert' && shiftBy > 0) base = script.map((a) => (a.at >= t0 ? { at: a.at + shiftBy, pos: a.pos } : a));
  return mergeWin(base, pts);
};

/** Paste at time `at`. mode 'replace' (clear [at, at+duration] first) | 'merge' (pasted points win ties) | 'insert' (ripple: everything at/after
 *  `at` moves later by the snippet duration). -> ats = the pasted actions' times. */
export function paste(script, snippet, at, opts) {
  const mode = O(opts).mode || 'replace';
  if (!snippet || !snippet.actions.length || !Number.isFinite(at)) return { script, ats: [] };
  const pts = sortDedupe(snippet.actions.map((a) => ({ at: Math.max(0, rnd(at + a.at)), pos: a.pos })));
  const dur = rnd(snippet.duration);
  return { script: place(script, pts, mode, rnd(at), rnd(at) + dur, dur), ats: pts.map((a) => a.at) };
}

/** Paste with the snippet's time axis scaled so it spans exactly [t0, t1]. */
export function pasteScaled(script, snippet, opts) {
  const { t0 = 0, t1 = 1000, mode = 'replace' } = O(opts);
  if (!snippet || !snippet.actions.length) return { script, ats: [] };
  const f = snippet.duration > 0 ? (t1 - t0) / snippet.duration : 1;
  const pts = sortDedupe(snippet.actions.map((a) => ({ at: Math.max(0, rnd(t0 + a.at * f)), pos: a.pos })));
  return { script: place(script, pts, mode, rnd(t0), rnd(t1), rnd(t1 - t0)), ats: pts.map((a) => a.at) };
}

/** Duplicate the selection `count` times, each copy starting gapMs after the previous end (default: the selection's own average
 *  point spacing, so the rhythm carries on). ats = the new copies' actions. */
export function duplicate(script, sel, opts) {
  const { count = 1, gapMs, mode = 'merge' } = O(opts);
  const snip = copy(script, sel);
  if (!snip.actions.length) return { script, ats: [] };
  const gap = Number.isFinite(gapMs) ? gapMs : Math.max(1, rnd(snip.duration / Math.max(1, snip.actions.length - 1)));
  let cur = script, end = snip.origin + snip.duration;
  const ats = [];
  for (let k = 0; k < count; k++) {
    const r = paste(cur, snip, end + gap, { mode });
    cur = r.script; ats.push(...r.ats); end += gap + snip.duration;
  }
  return { script: cur, ats };
}

/** Fill the destination range (sel: {t0,t1}, or the span of selected actions) with the snippet repeated back to back (period default: the
 *  snippet duration), cutting the last copy at t1. Source: opts.snippet, or opts.source = {t0,t1} taken from the script. Replaces the range. */
export function patternFill(script, sel, opts) {
  const { snippet, source, period, seam = 'next' } = O(opts), info = selInfo(script, sel);
  const snip = snippet || (source ? copy(script, { t0: source.t0, t1: source.t1 }) : null);
  if (!snip || !snip.actions.length || info.t0 == null) return { script, ats: [] };
  const per = period > 0 ? period : snip.duration;
  const pts = tile(snip.actions, per, info.t0, info.t1, { seam });
  if (!pts.length) return { script, ats: [] };
  return { script: place(script, pts, 'replace', info.t0, info.t1, 0), ats: pts.map((a) => a.at) };
}

export { place };
