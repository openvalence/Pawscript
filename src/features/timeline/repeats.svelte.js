// repeats.svelte.js -- repeated frames (paw-6dno) for the rest of the app: the current video's buckets (frames that
// show exactly the same picture as another frame elsewhere), computed once per video by the backend in the background
// (media_repeats: one 160 px grey ffmpeg pass, 4 threads, cached in the media cache) and re-read on reopen.
//
//   repeatsOf(app)            -> index | null    (repeats.js indexRepeats: {frames, buckets: [{id, occ}], occ, loops})
//   bucketOf(ix, frame)       -> bucket id | -1  (the frame's picture repeats elsewhere when >= 0)
//   occurrencesOf(ix, id)     -> [{f0, f1, t}]   (each occurrence: a run of held frames f0..f1 starting at t ms)
//   loopOfBucket(ix, id)      -> {key, members, n} | null   (paw-8yip: the loop the bucket is a frame of)
// The loops' preferred frames, carets and links: loop-look.svelte.js (paw-llaa); setting timeline.repeats hides them on the
// ruler (and skips the pass).
import { indexRepeats, pictureAt } from './repeats.js';
import { adoptTransitions, keepTransitions } from './transitions.svelte.js';

export { bucketOf, occurrencesOf, occurrenceAt, bucketColor, loopOfBucket } from './repeats.js';

// paw-shgb: per video path (several tabs open): a hidden tab's tracking keeps reading its own video's repeats while another
// tab's video loads. {path: {raw, state}}, state: loading | ready | failed; raw: the backend's result
let st = $state.raw({});
let job = null, jobPath = null;
const put = (p, e) => { st = { ...st, [p]: e }; };

/** The strip is shown (setting timeline.repeats, default on). */
export const repeatsShown = (app) => app.settings?.get?.('timeline.repeats', true) !== false;

/** The current video's index, or null (none yet, still computing, or no backend). */
/** The current video's pass is still running (paw-ef73.10: the loop search waits for the loops it marks). */
export const repeatsPending = (app) => st[app.doc.media?.path]?.state === 'loading';
const ixms = new WeakMap();   // app -> {raw, clock, ix}
/** The index on the player's frames (repeats.js indexRepeats with its clock; paw-kxz4), the same object until the result or the
 *  clock changes (a frame table adopted after the probe: the occurrences move onto the real frames). */
export const repeatsOf = (app) => {
  const raw = st[app.doc.media?.path]?.raw;
  if (!raw) return null;
  const clock = app.player?.clock || null, m = ixms.get(app);
  if (m?.raw === raw && m.clock === clock) return m.ix;
  const ix = indexRepeats(raw, clock);
  ixms.set(app, { raw, clock, ix });
  return ix;
};

const pms = new WeakMap();   // app -> {ix, fm, f}
/** paw-w7wr: the current video's time -> repeated picture id (repeats.js pictureAt), or null; the same function until
 *  the index or the frame duration changes (reactive on the index). */
export function picturesOf(app) {
  const ix = repeatsOf(app), fm = app.player?.frameMs || 1000 / 30, m = pms.get(app);
  if (m?.ix === ix && m.fm === fm) return m.f;
  const f = ix ? pictureAt(ix, fm) : null;   // ix is on the clock's frames: pictureAt by time
  pms.set(app, { ix, fm, f });
  return f;
}

/** paw-gw8y: the results of videos no open tab holds go (repeats and fades; a pass still running for one is cancelled). Run when
 *  a tab's app ends (app.cleanups) and when an app loads another video. */
export function pruneVideos(app) {
  const held = new Set((app.tabs?.apps || [app]).map((a) => a.doc?.media?.path).filter(Boolean));
  if (job && jobPath && !held.has(jobPath)) job.cancel();
  const gone = Object.keys(st).filter((p) => !held.has(p));
  if (gone.length) st = Object.fromEntries(Object.entries(st).filter(([p]) => held.has(p)));
  keepTransitions(held);
}
const watched = new WeakSet();

/** Start (or take from the media cache) the current video's pass; one at a time, a new video cancels the old one (its next
 *  showing starts it again). */
export function loadRepeats(app) {
  const p = app.doc.media?.path, be = app.backend;
  if (p && !watched.has(app)) { watched.add(app); (app.cleanups ??= []).push(() => pruneVideos(app)); }
  if (!p || !be?.frameRepeats || st[p]) return;
  pruneVideos(app);
  if (job) { const was = jobPath; job.cancel(); if (st[was]?.state === 'loading') { const { [was]: _, ...rest } = st; st = rest; } }
  put(p, { raw: null, state: 'loading' });
  let task = null;
  const j = (job = be.frameRepeats(p, { onProgress: (f) => {
    if (job !== j) return;
    task ??= app.task?.('Repeated frames', { cancel: () => j.cancel() });   // quiet: the status bar's task line; none when cached
    task?.update(Math.round(f * 100), 100);
  } }));
  jobPath = p;
  j.promise.then((r) => {
    if (job !== j) return;
    put(p, { raw: r, state: 'ready' });
    adoptTransitions(p, r?.transitions);   // paw-ef73.3: the same pass finds the fades and dissolves
  }, (e) => {
    if (job !== j) return;
    if (e?.code !== 'cancelled') { put(p, { raw: null, state: 'failed' }); console.info('[repeats] not available:', e?.message || e); }
    else { const { [p]: _, ...rest } = st; st = rest; }   // cancelled (the task's ×): the next open of this video tries again
  }).finally(() => { task?.end(); if (job === j) { job = null; jobPath = null; } });
}
