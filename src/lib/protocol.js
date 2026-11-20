// protocol.js -- the sidecar contract, JS side: line parsing, requests, param schema helpers, frame batching.
// Pure (no DOM, no tauri) so test/protocol.test.mjs can run it under node.

/** One stdout line -> event object. Garbage becomes {type:'bad'} so one stray print never kills a run. */
export function parseLine(line) {
  let e;
  try { e = JSON.parse(line); } catch { return { type: 'bad', raw: String(line).slice(0, 200) }; }
  return e && typeof e === 'object' && typeof e.type === 'string' ? e : { type: 'bad', raw: String(line).slice(0, 200) };
}

export const listRequest = () => ({ cmd: 'list' });
export const probeRequest = (video) => ({ cmd: 'probe', video });
export const loopRequest = (video, start_ms, end_ms, params) => ({ cmd: 'loop', video, start_ms: Math.round(start_ms), end_ms: Math.round(end_ms), params });
export const describeRequest = (video, start_ms, end_ms, params) => ({ cmd: 'describe', video, start_ms: Math.round(start_ms), end_ms: Math.round(end_ms), params });
/** v4.2: several ranges ([[start_ms, end_ms], ...]) in one request, one model load: `described` events per range. */
export const describeAllRequest = (video, ranges, params) => ({ cmd: 'describe', video, ranges: ranges.map(([a, b]) => [Math.round(a), Math.round(b)]), params });
/** Cumshot proposals over a range (lib/cum.js); pulses (optional): contraction peak times (ms) that boost aligned onsets;
 *  v4.16: groups (groups.js cumGroups: the scene's groups, the pulse ones tracked) over pulse_range [a, b] (the orgasm span). */
export const cumRequest = (video, start_ms, end_ms, params = {}, pulses = null, groups = null, pulseRange = null) =>
  ({ cmd: 'cum', video, start_ms: Math.round(start_ms), end_ms: Math.round(end_ms), params, ...(pulses?.length ? { pulses: pulses.map(Math.round) } : {}),
    ...(groups?.length ? { groups, ...(pulseRange ? { pulse_range: pulseRange.map(Math.round) } : {}) } : {}) });
export const scenesRequest = (video, params) => ({ cmd: 'scenes', video, params });
export const trackRequest = ({ video, tracker, start_ms, end_ms, roi, params, spans, tags, cuts, groups, direction, seed_ms, groups_only = false }) =>
  ({ cmd: 'track', video, tracker, start_ms: Math.round(start_ms), end_ms: Math.round(end_ms), roi: roi || null, params, ...(spans?.length ? { spans } : {}), ...(tags?.length ? { tags } : {}), ...(Array.isArray(cuts) ? { cuts } : {}), ...(groups?.length ? { groups } : {}),
    ...(direction === 'forward' || direction === 'backward' ? { direction, seed_ms: Math.round(seed_ms) } : {}),   // v4.15: one way from the seed frame
    ...(groups_only && groups?.length ? { groups_only: true } : {}) });   // v4.45: only the groups' own points, both ways from their frame, stopping where lost
/** v4.11: the groups the points trackers would pin on a frame (t_ms), or on the seed frame params.seed_frame picks in
 *  [start_ms, end_ms) -> {t_ms, frame, groups: [{name, poly, score, source, outline, pinned}], frame_wh, ms}. */
export const suggestGroupsRequest = ({ video, image = '', t_ms = null, start_ms, end_ms, roi = null, params = {}, prior = null, seed = null, candidates = null, candidateBonus = null, ignore = null }) =>
  ({ cmd: 'suggest_groups', ...(image ? { image } : { video }), ...(ignore?.length ? { ignore } : {}),   // v4.31: ignore regions [{w, h, rle}] of the picture: blanked first, nothing proposed inside
     ...(image ? {} : t_ms != null ? { t_ms: Math.round(t_ms) } : { start_ms: Math.round(start_ms), end_ms: Math.round(end_ms) }), ...(roi?.kind === 'box' ? { roi } : {}), params,
    ...(prior?.length ? { prior } : {}),   // v4.13: the previous shot's groups, re-found under the same names (unconfirmed)
    ...(seed?.dir ? { seed: { dir: seed.dir, ...(seed.dataset ? { dataset: seed.dataset } : {}), ...(seed.key ? { key: seed.key } : {}), ...(seed.features === 'hydra' ? { features: 'hydra' } : {}) } } : {}),   // v4.18: the learned part head (seed_train) + the video's key; v4.28: features 'hydra' = forced
    ...(t_ms != null && candidates?.length ? { candidates: candidates.map(Math.round) } : {}),   // v4.18: frames to pick the seed frame from
    // v4.20: a weight per candidate added to its parts (frames that repeat elsewhere, the owner's loop frame)
    ...(t_ms != null && candidates?.length && candidateBonus?.length === candidates.length ? { candidate_bonus: candidateBonus } : {}) });
/** v4.34: names for the blobs the owner painted (the groups' masks; a named one carries part / who as context) on an image or a video frame
 *  -> {blobs: [{part: [{part, p} x 3], conf, auto, who, who_by, named}], model, seen, ms, note?} one per mask. Cached features: tens of ms. */
export const nameGroupsRequest = ({ image = '', video = '', t_ms = 0, masks, seed, ignore = null }) =>
  ({ cmd: 'name_groups', ...(image ? { image } : { video, t_ms: Math.round(t_ms) }), masks, ...(ignore?.length ? { ignore } : {}),
     seed: { dir: seed.dir, ...(seed.dataset ? { dataset: seed.dataset } : {}), key: seed.key, ...(seed.features === 'hydra' ? { features: 'hydra' } : {}) } });
/** v4.40: the tagger on ONE still image: {scores: {tag: p}} (count tags solo / duo / trio / group and the best gender pairings), raw probabilities. */
export const tagImageRequest = ({ image, seqlen = 0 }) => ({ cmd: 'tag_image', image, ...(seqlen ? { seqlen } : {}) });
/** v4.25: prompted SAM 2 on one frame (the Groups grow brush): a video + t_ms or an image path, positive / negative points and an
 *  optional box (0..1 of the frame), an optional prior mask (the groups' {w, h, rle}), v4.35 single (one best mask: SAM's multimask off), v4.35 logits (each mask also carries SAM's 256 x 256 int8 low-res logits), mask_w (the app's mask width) ->
 *  {frame_wh, mask_wh, masks: [{mask {w, h, rle}, score, area}] smallest first, cached, ms: {embed, decode}}. */
export const segmentRequest = ({ video = null, t_ms = null, image = null, pos = [], neg = [], box = null, mask = null, single = false, logits = false, mask_w = 320 }) =>
  ({ cmd: 'segment', ...(image ? { image } : { video, t_ms: Math.round(t_ms) }), pos, ...(neg.length ? { neg } : {}), ...(box ? { box } : {}), ...(mask ? { mask } : {}), ...(single ? { single: true } : {}), ...(logits ? { logits: true } : {}), mask_w });
/** v4.18: (re)train the learned part head under dir from the painted groups of the library (the .pawproj in folders,
 *  plus projects) -> {frames, videos, groups, parts: {part: {labels, videos, use}}, changed, trained_at, s, projects}.
 *  v4.24: labels = the folder of the app's still-image labels (<app data>/seeder/labels): each labelled image is a frame of its
 *  own source (-> + images, negatives). */
export const seedTrainRequest = ({ dir, dataset = '', folders = [], projects = [], labels = '', force = false, features = 'auto', namer = null }) => ({ cmd: 'seed_train', dir, ...(dataset ? { dataset } : {}), folders, projects, ...(labels ? { labels } : {}), ...(force ? { force: true } : {}), ...(features === 'hydra' ? { features } : {}), ...(namer ? { namer } : {}) });   // v4.28: features 'hydra' = never the optional taggerine pack; v4.38: namer = the shared namer's scope (datasets.js namerScope)
/** v4.32: every dataset's head scored on the ACTIVE dataset's labels, never on a picture that head trained on. datasets: [{id, name, dir, labels, projects}]; folders: the project library (read for the datasets that include projects). */
export const seedCompareRequest = ({ dir, active, datasets, folders = [] }) => ({ cmd: 'seed_compare', dir, active, datasets, folders });
/** The track request's `cuts` (v3.1; v4.9 kinds) for a scenes mode (settings 'tracking.scenes'): 'one' -> [] (the range is
 *  one scene), 'detect' -> undefined (the sidecar's cut detector; it adds its own camera soft cuts), 'document' (default)
 *  -> [{t_ms, kind, why}] strictly inside (t0, t1): a document scene start is 'hard' (the tracker restarts from the ROI,
 *  its own normalisation) unless the action continues there: a camera split (split 'camera') or a `continues` scene ->
 *  'soft' (the run goes on with its points and groups, re-seeds and starts a new normalisation segment); plus 'soft' at
 *  each boundary of a scene's own camera segments (scene.camera) where the camera turns progressive or steady again
 *  (CAMERA_MOVES; static <-> reciprocal is no boundary). undefined (detect) when the document has no scenes. */
export function trackCuts(mode, scenes, t0, t1) {
  if (mode === 'one') return [];
  if (mode === 'detect' || !scenes?.length) return undefined;
  const out = new Map(), inside = (t) => t > t0 && t < t1;
  scenes.forEach((s, i) => {
    // a shot joined to its scene after a hard cut (join without split: timeline/shots.js) stays hard: the tracker reseeds
    const t = Math.round(s.start_ms), cont = s.split === 'camera' || !!s.continues;
    if (i && inside(t)) out.set(t, { t_ms: t, kind: cont ? 'soft' : 'hard', why: s.split === 'camera' ? 'camera split' : cont ? 'continues' : 'scene' });
    const cam = s.camera || [];
    for (let k = 1; k < cam.length; k++) {
      const a = cam[k - 1].kind, b = cam[k].kind, c = Math.round(cam[k].t0);
      if ((CAMERA_MOVES.includes(a) || CAMERA_MOVES.includes(b)) && inside(c) && c > s.start_ms && c < s.end_ms && !out.has(c))
        out.set(c, { t_ms: c, kind: 'soft', why: `camera: ${CAMERA_MOVES.includes(b) ? b : `${a} ends`}` });
    }
  });
  return [...out.values()].sort((a, b) => a.t_ms - b.t_ms);
}
/** Camera kinds that travel (pawtrack/camera.py PROGRESSIVE): their start / end inside a scene is a soft cut. */
export const CAMERA_MOVES = ['pan', 'zoom', 'orbit', 'handheld'];
/** candidate / reference: [{at,pos}]; scenes optional [{start_ms,end_ms}]; fps only converts the *_frames fields. */
export const scoreRequest = ({ candidate, reference, start_ms, end_ms, scenes, fps }) =>
  ({ cmd: 'score', candidate, reference, start_ms: Math.round(start_ms), end_ms: Math.round(end_ms), ...(scenes?.length ? { scenes } : {}), ...(fps ? { fps } : {}) });

/** {key: default} for a param schema list. */
export const defaultParams = (schema = []) => Object.fromEntries(schema.map((p) => [p.key, p.default]));

/** An <input> value back to the param's type (never NaN: falls back to the default). */
export function coerceParam(p, raw) {
  if (p.type === 'bool') return !!raw;
  if (p.type === 'choice') return raw;
  const n = p.type === 'int' ? parseInt(raw, 10) : parseFloat(raw);
  if (!Number.isFinite(n)) return p.default;
  const lo = Number.isFinite(p.min) ? p.min : -Infinity, hi = Number.isFinite(p.max) ? p.max : Infinity;
  return Math.min(hi, Math.max(lo, n));
}

const bounded = (p) => Number.isFinite(p.min) && Number.isFinite(p.max);
/** Sidecar PARAMs (PROTOCOL.md: min / max / choices null = unset) -> the kit ParamForm schema (bounded numbers as sliders). */
export const paramSchema = (params, group) => (params || []).map((p) => ({ key: p.key, label: p.label || p.key, type: p.type, default: p.default,
  min: p.min ?? undefined, max: p.max ?? undefined, choices: p.choices ?? undefined, hint: p.hint ?? undefined, group, control: p.type !== 'bool' && p.type !== 'choice' && bounded(p) ? 'slider' : undefined }));

/** paw-0ous: CoTracker3 is an optional user install; its code and weights are CC BY-NC 4.0. */
export const NC_BADGE = 'Non-commercial only';
export const NC_LINE = 'Scripts made with CoTracker cannot be used commercially';
export const NC_LICENSE = 'https://github.com/facebookresearch/co-tracker/blob/main/LICENSE.md';

/** paw-vdr4: the tracker to use for a stored or requested id, from the usable trackers (the caller leaves out those
 *  that need a GPU the machine lacks). A listed id stays; else (CoTracker3 is an optional add-on the user installs, in no
 *  build; or nothing was picked yet) TAPNext++, else Optical flow (box), else the first. note: one plain line when a
 *  CoTracker3 pick was replaced, '' otherwise. -> {id, note}. */
export function trackerFor(trackers = [], id = '') {
  const by = (x) => trackers.find((t) => t.id === x);
  if (id && by(id)) return { id, note: '' };
  const t = by('tapnext_points') || by('lk_box') || trackers[0];
  return { id: t?.id || '', note: t && id === 'cotracker_points' ? `CoTracker3 is not installed: using ${t.name}` : '' };
}

/** Does a tracker with this roi kind ('box'|'points'|'box_or_points'|'none') take an ROI of this shape? */
export const roiAccepts = (kind, shape) => kind === shape || (kind === 'box_or_points' && (shape === 'box' || shape === 'points'));

/** An ROI is usable for a tracker's roi kind? */
export function roiOk(kind, roi) {
  if (kind === 'none') return true;
  if (!roi || !roiAccepts(kind, roi.kind)) return false;
  return roi.kind === 'box' ? roi.w > 0.005 && roi.h > 0.005 : roi.points.length > 0;
}

/**
 * Params into sections for the auto-built form. Only what makes motion is open (the tracker, its model and seeding);
 * the rest is collapsed: re-seeding, the picked signal (the sidecar's pick: the Runs lane / Flip override it per scene),
 * script shaping, the activity gate, the part detectors' inputs, and cut detection (cut_*: the Scenes section's options
 * own them). Empty sections are dropped; order inside a section is the sidecar's. `exclude`: keys shown elsewhere
 * (loop_min_confidence: the Scenes panel's options own it, sent with Track from there).
 */
const PARAM_GROUPS = [
  ['motion', 'Motion', null],
  ['reseed', 'Re-seeding', /^(reseed_every_ms|retire_ms|max_points|min_points)$/],
  ['signal', 'Picked signal (override per scene in Runs)', /^(primary|axis(_[xy][01])?|gap_ms|pipe_invert)$/],
  ['parts', 'Parts (detector inputs)', /^(group_labels|sem_)/],
  ['gate', 'Activity gate', /^pipe_gate/],
  ['shape', 'Script shaping', /^(pipe_|loop_|held_retime$)/],
  ['cut', 'Scene detection', /^cut_/],
];
/** paw-t8z: the script-shaping pipe_* params (the 'shape' section's pipe_*: not the gate or invert). The shot's Adjust (the band under the stroke lane) shows them under Strokes > Advanced, not in the tracker form; their keys,
 *  values and the requests that carry them are unchanged. */
export const isShapePipe = (key) => /^pipe_/.test(key) && !/^pipe_(gate|invert$)/.test(key);
export function groupParams(params = [], exclude = []) {
  const groups = PARAM_GROUPS.map(([id, title]) => ({ id, title, open: id === 'motion', params: [] }));
  for (const p of params) {
    if (exclude.includes(p.key)) continue;
    const k = PARAM_GROUPS.findIndex(([, , re]) => re?.test(p.key));
    groups[k < 0 ? 0 : k].params.push(p);
  }
  // display order: parts and the gate after shaping (match order above is first-match-wins: parts/gate before pipe_*)
  const order = ['motion', 'reseed', 'signal', 'shape', 'gate', 'parts', 'cut'];
  return order.map((id) => groups.find((g) => g.id === id)).filter((g) => g.params.length);
}

/**
 * Collects `frame` events and hands them over in one call per tick, so thousands of events cost one
 * state update. `schedule(fn)` defaults to requestAnimationFrame (a timeout under node).
 * push(e) queues; flush() drains now (call it before the result so no frame is lost).
 */
export function createBatcher(onBatch, schedule = (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16))) {
  let q = [], armed = false;
  const flush = () => { armed = false; if (q.length) { const b = q; q = []; onBatch(b); } };
  return { push(e) { q.push(e); if (!armed) { armed = true; schedule(flush); } }, flush };
}
