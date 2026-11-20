// api.js -- the tracking feature's stable surface for other features (assist, review, graph, draft):
//   import { trackingApi } from '../tracking/api.js'   (or import.meta.glob it, to stay optional)
//   const t = trackingApi(app);
//   t.selectedId()               id of the run / ghost selected in the tracker panel, or null
//   t.runs()                     [{id, n, name, tracker, tag, range:{t0,t1}, roi, scenes:[{t0,t1,sign}],
//                                  orient:[{t0,t1,sign}], flipSpans:[[t0,t1]] (paw-57ve, relative to the scene), events, frames (overlay store, lib/runs.js), confidence,
//                                  cameraMotion: {flag, score, together, n, refId} | {pending} | {skipped} | {error} | null,
//                                  notes: [{code, message, scene_index?, data?}] (sidecar info: low_motion, primary, held_input),
//                                  decisions: [{message, chosen?, rule?, candidates?, axis?, sign?, camera?, ...}] by run scene
//                                    (the sidecar's primary decision record, PROTOCOL notes; lib/runs-channel.js decisionsOf),
//                                  lowMotion: {px, low, source} | null    (low: the region moved < 3 px: do not trust it),
//                                  motion: [{t0, t1, turns, strokesPerMin, regularity (0..1|null), idle:[{t0,t1}], idleMs}]
//                                    per app.doc.scenes range inside the run (or the run's range)}]
//                                tag 'camera' = a whole-frame reference run (hidden ghost) made by the camera check
//   t.getAxis()                  the stroke axis {x0,y0,x1,y1} (out end -> in end, 0..1) or null
//   t.setAxis(axis | null)       set / clear it (drawing one selects custom; trackRange and Track send it to every
//                                tracker whose schema has `axis`, axis_x0..y1 and primary proj where they exist)
//   await t.checkCamera(id)      compare a run with the whole-frame motion -> its cameraMotion (runs after each track too)
//   t.setSpanOrientation({runId, t0, t1, sign})   pin a span's direction (+1 as tracked, -1 mirrored); one ghost update
//   t.retrack({t0, t1})          Track mode with the range preset (paint the part, then Track ROI)
//   t.currentScene()             index of the scene the panel works on (timeline selection, else the playhead), -1 none
//   t.sceneLink(i)               scene i's live run link {runId, channel, ghost} | null (project block 'links'; a link
//                                whose ghost was removed is kept but not live)
//   t.linkScene(i, runId, channel)   scene i uses channel `channel` ('primary' | 'sem_c1_hips_proj' | ...) of run runId; only that
//                                scene's points change (channels are per scene; the ghost keeps every linked channel's series,
//                                so it survives a reload) -> bool
// Programmatic jobs (no panel state touched: tracker, range, ROI, params, span labels, selection stay as they are).
// Each is one sidecar process queued behind any other (owner 'api'), with a status-bar task whose cancel kills it.
// Esc (track.cancel) leaves api jobs alone; t.cancel() kills only an api job and drops the queued ones.
//   await t.trackers()           the sidecar's tracker list (lists once on first use) -> [{id, name, roi, params, ...}]
//   t.canDescribe()              describe is installed (after trackers())
//   await t.detectScenes()       -> {scenes, media} | {error} | {cancelled}; writes app.doc.scenes as ONE undo entry
//   await t.describeScene(i)     -> {result} | {error} | {cancelled}; the result is NOT written into the document
//   await t.loopScene(i)         -> {result} | {error} | {cancelled}; idem (the caller writes it, in its own transact)
//   await t.trackRange({tracker, range:{t0,t1}, roi, params, spans, tag, scenes})   -> {run} | {error} | {cancelled}; the run
//                                is kept and shown as a ghost (ghosts are not undoable); run = lib/runs.js makeRun
//                                record; tag (string) lands in the ghost's source.tag; scenes 'document' | 'detect' | 'one'
//                                (default settings 'tracking.scenes': how the range splits into scenes, README)
//   t.progress()                 {done, total} of the current sidecar job (reactive)
//   await t.score(scoreRequest)  sidecar `score` (protocol.js scoreRequest) -> {result:{overall, scenes}} | {error} | {cancelled}
//   t.cancel()                   kill the current api job (never the panel's) and drop queued api jobs
//   t.removeRun(id)              drop a run and its ghost (never a pinned one)
//   t.select(id)                 select a run / ghost in the tracker panel (what assist and the panel work on)
//   t.insertedAt(t)              how much of the shaft is inside at t (paw-azd, lib/shaft.js insertedAt; a run tracked with
//                                a penis group's depth glyph on): {in 0..1, conf 0..1, name, knot (0 out / 0.5 entrance /
//                                1 in | null), source 'sam' | 'points'} | null. The Machine's stroke window: inserted mm =
//                                in x the toy's length (trust it where conf >= 0.5 and source 'sam')
//   t.insertedSeries(times)      insertedAt on many times (ascending ms) at once -> [same | null] (the Machine's depth from
//                                video samples a whole script; each run scene's shaft is looked up once)
// The same actions are commands too: tracking.setSpanOrientation / tracking.retrack (args as above).
import { trackingFor } from './tracking.svelte.js';

const API = 'api';

export const trackingApi = (app) => {
  const T = trackingFor(app);
  return {
    selectedId: () => T.selectedId || null, runs: () => T.runsInfo(), setSpanOrientation: (o) => T.setSpanOrientation(o), retrack: (o) => T.retrack(o),
    trackers: async () => { if (!T.listed) await T.list(); return T.listed ? T.trackers : Promise.reject(new Error(T.error || 'Could not list trackers.')); },
    canDescribe: () => !!T.describeParams,
    detectScenes: () => T.detectScenes({ owner: API }),
    describeScene: (i) => T.sceneJob(i, 'describe', { write: false, owner: API }),
    loopScene: (i) => T.sceneJob(i, 'loop', { write: false, owner: API }),
    trackRange: (o) => T.trackRange({ ...o, owner: API }),
    progress: () => T.progress,
    cancel: () => T.cancelOwner(API),
    removeRun: (id) => T.remove(id),
    select: (id) => T.select(id),
    currentScene: () => T.currentScene, sceneLink: (i) => T.sceneLink(i), linkScene: (i, runId, channel) => T.linkScene(i, runId, channel),
    getAxis: () => T.axis, setAxis: (a) => T.setAxis(a),
    checkCamera: (id) => T.checkCamera(id, { owner: API }),
    score: (request) => T.job('score', request, { owner: API, task: false }),
    insertedAt: (t) => T.insertedAt(t),
    insertedSeries: (times) => T.insertedSeries(times),
  };
};
