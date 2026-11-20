// references.js -- the owner's reference stretches (paw-qynw): a stretch of ONE tracker run the owner vouches for, with the
// regions where the tracking (or the script, not right yet) was bad struck out. Saved by Track › right-click › Use as a
// reference… (features/tracking/ReferenceStrip.svelte) as one JSON file per record in <app data folder>/references/
// (nothing beside the video); read by experiments/fusion/score.mjs as an unbiased score set, and the seed of the dataset
// for a later learned fusion (paw-iasp), so each record describes itself: which parts / channels the run has, the act tags.
// Pure; node-tested (test/references.test.mjs).

const fin = Number.isFinite;
export const REF_VERSION = 1;
export const REF_DIR = 'references';

/** Merge [a, b] into the struck list (sorted, overlaps / touches joined), clipped to [t0, t1]. */
export function strike(struck, a, b, t0 = -Infinity, t1 = Infinity) {
  const lo = Math.max(t0, Math.min(a, b)), hi = Math.min(t1, Math.max(a, b));
  if (!(hi > lo)) return struck;
  const out = [];
  let cur = [lo, hi];
  for (const s of [...struck].sort((x, y) => x[0] - y[0])) {
    if (s[1] < cur[0] || s[0] > cur[1]) out.push(s);
    else cur = [Math.min(cur[0], s[0]), Math.max(cur[1], s[1])];
  }
  return [...out, cur].sort((x, y) => x[0] - y[0]);
}
/** The struck list without the region over t (a click on it). */
export const unstrike = (struck, t) => struck.filter(([a, b]) => !(t >= a && t < b));
/** ms of [t0, t1) not struck. */
export function keptOf(t0, t1, struck = []) {
  let k = t1 - t0;
  for (const [a, b] of struck) k -= Math.max(0, Math.min(b, t1) - Math.max(a, t0));
  return Math.max(0, k);
}

/**
 * A record from what the app knows: {project (the .pawproj path), runsFile (its .pawruns), mediaHash, run (the run, its
 * id / tracker / channels / scenes), t0, t1, struck, points (the stroke script [[at, pos]] over the span), axis, tags (the
 * shots' act tags), shots ([{t0, t1, tags}])} -> the record (JSON-ready).
 */
export function referenceRecord({ project = '', runsFile = '', mediaHash = '', run, t0, t1, struck = [], points = [], axis = 'stroke', tags = [], shots = [], savedAt = new Date().toISOString() }) {
  const ch = Object.keys(run?.channels || {});
  const groups = [...new Set(ch.map((k) => /^sem_([a-z0-9_]+?)_x$/.exec(k)?.[1]).filter(Boolean))].sort();
  return {
    kind: 'pawscript-reference', v: REF_VERSION, savedAt, project, runsFile, mediaHash,
    run: run?.id || '', tracker: run?.tracker?.id || run?.tracker || '', runRange: run?.range ? [run.range.start, run.range.end] : null,
    t0: Math.round(t0), t1: Math.round(t1), struck: struck.map(([a, b]) => [Math.round(a), Math.round(b)]),
    axis, points: points.filter(([at]) => at >= t0 && at <= t1).map(([at, pos]) => [Math.round(at), +(+pos).toFixed(2)]),
    tags: [...new Set(tags)], shots: shots.map((s) => ({ t0: Math.round(s.t0), t1: Math.round(s.t1), tags: [...(s.tags || [])] })),
    groups, channels: ch.sort(), scenes: (run?.scenes || []).filter((s) => s.end_ms > t0 && s.start_ms < t1).map((s) => [Math.round(s.start_ms), Math.round(s.end_ms)]),
  };
}
/** A record read back (score.mjs, the list) -> the record with its numbers checked, or null (not one). */
export function referenceClean(r) {
  if (!r || r.kind !== 'pawscript-reference' || typeof r.run !== 'string' || !r.run || !fin(+r.t0) || !fin(+r.t1) || !(+r.t1 > +r.t0)) return null;
  const t0 = +r.t0, t1 = +r.t1;
  const struck = (Array.isArray(r.struck) ? r.struck : []).filter((s) => Array.isArray(s) && fin(+s[0]) && fin(+s[1])).reduce((acc, s) => strike(acc, +s[0], +s[1], t0, t1), []);
  const points = (Array.isArray(r.points) ? r.points : []).filter((p) => Array.isArray(p) && fin(+p[0]) && fin(+p[1])).map((p) => [+p[0], +p[1]]).sort((a, b) => a[0] - b[0]);
  return { ...r, t0, t1, struck, points, project: String(r.project || ''), runsFile: String(r.runsFile || ''), tags: Array.isArray(r.tags) ? r.tags : [] };
}
/** The file name of a record: media hash (or the project's name), run, span; unique per stretch. */
export function referenceName(r) {
  const base = (r.mediaHash || (r.project || 'project').replace(/^.*[\\/]/, '').replace(/\.pawproj$/i, '')).replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 16) || 'project';
  return `${base}_${String(r.run).replace(/[^a-zA-Z0-9_-]+/g, '')}_${Math.round(r.t0)}-${Math.round(r.t1)}.json`;
}
