// runs.js -- the run store's pure parts: colors, run records, stored overlay frames, reference script,
// loop cycle marks, funscript export.
// A run = one finished track: tracker + params + range + roi + signal (+channels) + points + the frames it drew.

import { lowerBound } from './lane.js';
import { fmtSpanTime } from './time-format.js';

// Theme series tokens (the colour follows the theme); canvas code resolves them with paint() (tracking/colors.js).
export const PALETTE = ['sky', 'violet', 'pink', 'green', 'yellow', 'blue', 'orange', 'lime'].map((k) => `var(--series-${k})`);
export const REF_COLOR = '#E8D8A0';
export const nextColor = (runs) => PALETTE.find((c) => !runs.some((r) => r.color === c)) ?? PALETTE[runs.length % PALETTE.length];

/** Live frame store: parallel arrays so the lane can draw it as it grows. */
export const newFrames = () => ({ t: [], v: [], ov: [] });
export function appendFrames(fr, batch) {
  // kept in rising time: a both-ways run sends its backward half first, in chunks, so arrival order steps back in
  // time (the live trace drew as a saw, and overlayIndex's binary search needs sorted times). A repeated time replaces.
  for (const e of batch) {
    const t = e.t_ms, v = typeof e.value === 'number' ? e.value : NaN, ov = e.overlay || null, n = fr.t.length;
    if (!Number.isFinite(t)) continue;
    const i = n && t <= fr.t[n - 1] ? lowerBound(fr.t, t) : n;
    const cut = fr.t[i] === t ? 1 : 0;
    fr.t.splice(i, cut, t); fr.v.splice(i, cut, v); fr.ov.splice(i, cut, ov);
  }
}

/** frames {t, v, ov} in rising time (in place; a run saved before appendFrames kept order holds its backward half in
 *  arrival order, so overlayIndex found no overlay on most frames). A repeated time keeps its last row. -> fr */
export function orderFrames(fr) {
  if (!fr?.t?.length) return fr;
  let ok = true;
  for (let i = 1; i < fr.t.length && ok; i++) ok = fr.t[i] > fr.t[i - 1];
  if (ok) return fr;
  const idx = Array.from(fr.t, (_, i) => i).filter((i) => Number.isFinite(fr.t[i])).sort((x, y) => fr.t[x] - fr.t[y] || x - y);
  const keep = idx.filter((i, k) => k === idx.length - 1 || fr.t[idx[k + 1]] !== fr.t[i]);
  const t = keep.map((i) => fr.t[i]), v = keep.map((i) => fr.v[i]), ov = keep.map((i) => fr.ov[i]);
  fr.t = t; fr.v = v; fr.ov = ov;
  return fr;
}

/** Index of the overlay stored at or just before t (ms), if within maxGap; else -1. */
export function overlayIndex(fr, t, maxGap = 250) {
  if (!fr || !fr.t.length) return -1;
  const i = lowerBound(fr.t, t + 1) - 1;   // last frame with t_ms <= t
  return i >= 0 && t - fr.t[i] <= maxGap ? i : -1;
}
/** The overlay stored at or just before t (ms), if within maxGap; else null. */
export function overlayAt(fr, t, maxGap = 250) { const i = overlayIndex(fr, t, maxGap); return i >= 0 ? fr.ov[i] : null; }

/** Pairs [[t, ...]] in strictly rising time: as given when they already are (the sidecar's rows always are), else the
 *  finite times stably sorted with a repeated time dropped. A polyline over a time array that steps back is a saw
 *  (the lane draws in array order), so no run array is ever built from an unordered one. */
export function inTimeOrder(pairs) {
  let ok = true;
  for (let i = 0; i < pairs.length && ok; i++) ok = Number.isFinite(pairs[i][0]) && (!i || pairs[i][0] > pairs[i - 1][0]);
  if (ok) return pairs;
  const s = pairs.filter((x) => Number.isFinite(x[0])).sort((a, b) => a[0] - b[0]);
  return s.filter((x, i) => !i || x[0] > s[i - 1][0]);
}

/** [[t, v|null], ...] -> {t, v} typed arrays; null becomes NaN (a gap). Rows out of time order are put in order. */
export const series = (pairs = []) => {
  const p = inTimeOrder(pairs);
  return { t: Float64Array.from(p, (x) => x[0]), v: Float32Array.from(p, (x) => (typeof x[1] === 'number' ? x[1] : NaN)) };
};

/** A scene's (or a whole channel's) stray samples: [lo, hi] (3 IQR beyond the quartiles) when only a few (<= 3 or 1 %) lie outside it, else
 *  null. A frame of the next shot at a cut is one; a deep section of strokes is many samples and is never one. */
export function strayFence(v) {
  // (typed values: a typed sort, numeric, NaN last, no comparator calls; paw-o60v.5: the comparator sort was most of a
  // run's decode. The same quartiles: only the order of -0 / 0 differs, which no result here can see)
  let s, n;
  if (ArrayBuffer.isView(v)) { s = Float64Array.from(v).sort(); n = s.length; while (n && s[n - 1] !== s[n - 1]) n--; }
  else { s = Array.from(v).filter((y) => y === y).sort((a, b) => a - b); n = s.length; }
  if (n < 8) return null;
  const q1 = s[n >> 2], q3 = s[(3 * n) >> 2], k = 3 * (q3 - q1);
  if (!(k > 0)) return null;
  let c = 0;
  for (const y of s) if (y < q1 - k || y > q3 + k) c++;
  return c && c <= Math.max(3, n / 100) ? [q1 - k, q3 + k] : null;
}

/** paw-2lp7.1: run with every tracked value inside spans ([[t0, t1]] ms: positioning ranges) a gap (NaN) in its channels and
 *  samples, so what reads them to set a range, level or calibration (fusion, the depth seat, body scale, held drawings, the
 *  strokes step, six-axis) never sees the move into position. The camera (cam_*) stays: it is not the bodies. Tracking keeps
 *  every frame; only this copy has the gaps. The same run when no span touches it; masked channels memoised per channel
 *  (fusion's analysis cache keys on the channel object). */
const MASKED = new WeakMap();
export function maskRun(run, spans) {
  const r0 = run?.range?.start ?? -Infinity, r1 = run?.range?.end ?? Infinity, sp = (spans || []).filter(([a, b]) => b > r0 && a < r1);
  if (!sp.length || !run?.channels) return run;
  const key = JSON.stringify(sp);
  const cut = (c) => {
    if (!c?.t?.length || !c.v) return c;
    const m = MASKED.get(c);
    if (m?.key === key) return m.c;
    let v = null, s = null;
    for (const [a, b] of sp) for (let j = lowerBound(c.t, a); j < c.t.length && c.t[j] < b; j++) { (v ??= c.v.slice())[j] = NaN; if (c.scaled) (s ??= c.scaled.slice())[j] = NaN; }
    const out = v ? { ...c, v, ...(s ? { scaled: s } : {}) } : c;
    MASKED.set(c, { key, c: out });
    return out;
  };
  const channels = Object.fromEntries(Object.entries(run.channels).map(([k, c]) => [k, k.startsWith('cam_') ? c : cut(c)]));
  return { ...run, channels, ...(run.samples?.t ? { samples: cut(run.samples) } : {}) };
}
/** paw-2lp7.1: points {at, pos} without those inside spans (the script there is the positioning ease). Same object when none. */
export function cutPoints(p, spans) {
  if (!spans?.length || !p?.at?.length) return p;
  const keep = [];
  for (let j = 0; j < p.at.length; j++) if (!spans.some(([a, b]) => p.at[j] >= a && p.at[j] < b)) keep.push(j);
  return keep.length === p.at.length ? p : { ...p, at: Float64Array.from(keep, (j) => p.at[j]), pos: Float64Array.from(keep, (j) => p.pos[j]) };
}

/** A raw channel: series plus its real min/max and a 0..1 copy for drawing at lane height. */
export function channelOf(pairs) {
  const s = series(pairs), f = strayFence(s.v);
  if (f) for (let j = 0; j < s.v.length; j++) if (s.v[j] < f[0] || s.v[j] > f[1]) s.v[j] = NaN;   // a cut's stray frame: a gap for every reader (fusion, the lane, the fit)
  let min = Infinity, max = -Infinity;
  for (const y of s.v) if (y === y) { if (y < min) min = y; if (y > max) max = y; }
  if (min > max) min = max = 0;
  const span = max - min || 1;
  return { ...s, min, max, scaled: Float32Array.from(s.v, (y) => (y - min) / span) };
}

/** A layer for the lane renderer: the run's per-scene composed channel trace (r.lane, runs-channel.js channelPatch), else
 *  its chosen channel (auto-scaled), else its primary signal + points. */
export function layerOf(r) {
  const ch = r.channel !== 'primary' && r.channels[r.channel];
  const base = { id: r.id, color: r.color, ref: !!r.ref, dim: false };
  if (r.lane) return { ...base, t: r.lane.t, v: r.lane.v };
  return ch ? { ...base, t: ch.t, v: ch.scaled } : { ...base, t: r.samples.t, v: flippedTrace(r), pat: r.points.at, ppos: r.points.pos };
}
/** The sidecar's samples as the scenes play (paw-vtec): a flipped scene (r.dir.whole, channelPatch's) mirrored about its
 *  range there, like a composed trace. */
function flippedTrace(r) {
  const W = r.dir?.whole, t = r.samples.t, v = r.samples.v;
  if (!W?.length || !t.length) return v;
  const out = Float32Array.from(v), sc = r.scenes || [];
  for (const k of W) {
    const a = sc.length ? sc[k]?.start_ms ?? Infinity : -Infinity, b = sc.length && k + 1 < sc.length ? sc[k + 1].start_ms : Infinity;
    let L = Infinity, H = -Infinity;
    for (let j = 0; j < t.length; j++) if (t[j] >= a && t[j] < b && v[j] === v[j]) { L = Math.min(L, v[j]); H = Math.max(H, v[j]); }
    for (let j = 0; j < t.length; j++) if (t[j] >= a && t[j] < b) out[j] = L + H - v[j];
  }
  return out;
}

export function makeRun({ n, tracker, params, range, roi, result, frames, runs }) {
  const p = result.points || [];
  const po = inTimeOrder(p.map((x) => [x.at, x.pos]));
  const pts = { at: Float64Array.from(po, (x) => x[0]), pos: Float64Array.from(po, (x) => x[1]) };
  return {
    id: 'run' + n, n, color: nextColor(runs), visible: true, ref: false,
    tracker: tracker.id, name: tracker.name, params: { ...params }, range: { ...range }, roi: roi ? structuredClone(roi) : null,
    samples: series(result.samples),
    points: pts, points0: pts,
    scenes: result.scenes || [], flips: [],
    channels: Object.fromEntries(Object.entries(result.channels || {}).map(([k, v]) => [k, channelOf(v)])),
    channel: 'primary',
    confidence: result.confidence?.length ? series(result.confidence) : null,
    events: result.events || [],
    notes: result.notes || [],   // sidecar info notes [{code, message, scene_index?}]
    frames,
  };
}

/** A pinned, read-only run from a parsed funscript (funscript.js parseFunscript: pos 0..1). */
export function makeReference(script, name) {
  const refPts = { at: Float64Array.from(script.at), pos: Float64Array.from(script.pos, (p) => Math.round(p * 100)) };
  return {
    id: 'ref', n: 0, color: REF_COLOR, visible: true, ref: true, tracker: 'reference', name: 'Reference ' + name, params: {},
    range: { start: script.at[0], end: script.durationMs }, roi: null,
    samples: series([]), points: refPts, points0: refPts,
    scenes: [], flips: [], channels: {}, channel: 'primary', confidence: null, events: [], frames: null,
  };
}

/** paw-kv4y: what a finished run gives, for its toast and the panel: the script points it makes now (run.points after the
 *  arrival's compose: Smart stroke's fused stroke where it is on) and the painted groups it tracked. */
export function runSummary(run) {
  const k = run?.points?.at?.length || 0, g = new Set((run?.groupSeeds || []).map((s) => s.name)).size;
  return `${k ? `${k} script point${k === 1 ? '' : 's'}` : 'no script points'}${g ? ` from ${g} tracked group${g === 1 ? '' : 's'}` : ''}`;
}

/** paw-l3ec: the earlier runs a re-track replaces: the owner's own (not tagged, a modifier's, the reference or derived), of
 *  the same tracker family (the tracker, a grid or not), lying inside the new run's span (tol ms). -> their ids */
export function replacedBy(run, runs, tol = 0) {
  const fam = (r) => `${r.tracker}|${r.params?.box_seed === 'grid'}`;
  return runs.filter((r) => r.id !== run.id && !r.tag && !r.mod && !r.ref && !r.derived && fam(r) === fam(run)
    && r.range.start >= run.range.start - tol && r.range.end <= run.range.end + tol).map((r) => r.id);
}

/** [{at,pos}] from a run's typed point arrays (request shape). */
export const pointsList = (pts) => Array.from(pts.at, (at, i) => ({ at, pos: pts.pos[i] }));

/** Index of the scene containing t (before the first: 0; past the last: the last). -1 if there are none. */
export function sceneAt(scenes, t) {
  let k = scenes.length ? 0 : -1;
  for (let i = 0; i < scenes.length; i++) if (scenes[i].start_ms <= t) k = i;
  return k;
}
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
/** The doc scenes a run's range overlaps, as text: 'S4', 'S3–S5', '' (no scenes / none overlapped). */
const sceneSpan = (r, scenes) => {
  const ix = scenes.flatMap((s, i) => (overlap(r.range.start, r.range.end, s.start_ms, s.end_ms) > 0 ? [i + 1] : []));
  return !ix.length ? '' : ix.length > 1 ? `S${ix[0]}–S${ix[ix.length - 1]}` : `S${ix[0]}`;
};
/** A run's title, e.g. 'S4 · 1:12.3–1:40.0 · #2': the current doc scenes its range overlaps, its range, and #k = its
 *  1-based place by n among `runs` over the same scenes. Pure: recomputed from the scenes as they are (re-cuts too). */
export function runTitle(run, scenes = [], runs = []) {
  const sc = sceneSpan(run, scenes), t = fmtSpanTime;   // a span's end, m:ss.s
  const k = runs.filter((r) => r !== run && r.n < run.n && sceneSpan(r, scenes) === sc).length + 1;
  return [sc, `${t(run.range.start)}–${t(run.range.end)}`, `#${k}`].filter(Boolean).join(' · ');
}
/** The span a ghost covers: its run's range (source.range {t0,t1}), else its script's extent; null = unknown. */
const ghostSpan = (g) => g.source?.range || (g.script?.length ? { t0: g.script[0].at, t1: g.script[g.script.length - 1].at } : null);
/** The ghosts (runs) overlapping scene {start_ms, end_ms}; no scene: all of them. A ghost with no known span stays. */
export const runsForScene = (runs, scene) => (!scene ? runs : runs.filter((g) => { const r = ghostSpan(g); return !r || overlap(r.t0, r.t1, scene.start_ms, scene.end_ms) > 0; }));
/** The tracker run a scene selection goes to: the scene's linked run (`links`, its ghost still there), else the newest
 *  tracker ghost overlapping the scene (doc order: the last one), else null. -> ghost id | null. */
export function runForScene(scene, links = [], ghosts = []) {
  if (!scene) return null;
  const l = links[linkFor(links, scene)];
  if (l && ghosts.some((g) => g.id === l.run)) return l.run;
  const over = runsForScene(ghosts.filter((g) => g?.source?.kind === 'tracker'), scene).filter((g) => ghostSpan(g));
  return over.length ? over[over.length - 1].id : null;
}
/** Index of the scene link ({t0, t1, ...}) belonging to scene s: the one overlapping it most, by more than half of the
 *  shorter of the two (a link survives small cut edits and splits), else -1. */
export function linkFor(links, s) {
  let best = -1, bo = 0;
  links.forEach((l, k) => {
    const o = overlap(l.t0, l.t1, s.start_ms, s.end_ms);
    if (o > bo && o > 0.5 * Math.min(l.t1 - l.t0, s.end_ms - s.start_ms)) { best = k; bo = o; }
  });
  return best;
}
/** The scene a channel pick on a run {t0, t1} links to: `selected` if the run overlaps it, else the scene it overlaps most; -1 none. */
export function sceneForRun(scenes, range, selected = -1) {
  const s = scenes[selected];
  if (s && overlap(range.t0, range.t1, s.start_ms, s.end_ms) > 0) return selected;
  let best = -1, bo = 0;
  scenes.forEach((x, i) => { const o = overlap(range.t0, range.t1, x.start_ms, x.end_ms); if (o > bo) { best = i; bo = o; } });
  return best;
}

/** Sign of a scene as the user now sees it: the sidecar's sign, times -1 per client-side flip. */
export const effSign = (run, i) => (run.scenes[i]?.sign ?? 1) * (run.flips.includes(i) ? -1 : 1);
/** Run patch after toggling one scene's flip (or every scene's: all flipped -> none, else all): {flips}. The points are
 *  recomposed with it (paw-vtec: the flip is applied to the signal, runs-channel.js channelPatch; the store does it). */
export function flipPatch(run, i) {
  const n = run.scenes.length;
  const flips = i == null ? (run.flips.length === n ? [] : run.scenes.map((_, k) => k))
    : run.flips.includes(i) ? run.flips.filter((k) => k !== i) : [...run.flips, i].sort((a, b) => a - b);
  return { flips };
}

// ---- user span labels (state sent as track `spans`) ----
export const SPAN_STATES = ['active', 'idle', 'carry', 'climax', 'orgasm'];   // climax = the fast run-in, orgasm = the pulses (sidecar v3.1)
/** Adds s, replacing whatever it overlaps (partly covered spans are trimmed). Sorted by start. */
export function addSpan(spans, s) {
  const out = [];
  for (const x of spans) {
    if (x.end_ms <= s.start_ms || x.start_ms >= s.end_ms) { out.push(x); continue; }
    if (x.start_ms < s.start_ms) out.push({ ...x, end_ms: s.start_ms });
    if (x.end_ms > s.end_ms) out.push({ ...x, start_ms: s.end_ms });
  }
  out.push({ start_ms: s.start_ms, end_ms: s.end_ms, state: s.state });
  return out.sort((a, b) => a.start_ms - b.start_ms);
}
/** The spans touching [a, b), in request shape. */
export const spansForRequest = (spans, a, b) => spans.filter((x) => x.start_ms < b && x.end_ms > a).map(({ start_ms, end_ms, state }) => ({ start_ms, end_ms, state }));

/** Loop cycle starts as lane marks: scenes[i] with infos[i].loop {period_ms, cycles}. */
export function cycleMarks(scenes, infos) {
  const out = [];
  scenes.forEach((s, i) => {
    const l = infos[i]?.loop;
    if (!l || !l.period_ms || !(l.cycles > 0)) return;
    for (let k = 0; k < l.cycles; k++) out.push({ t: s.start_ms + k * l.period_ms, label: 'c' + (k + 1) });
  });
  return out;
}

/**
 * Where an export goes. A same-name funscript is never replaced unless `overwrite`: the default is
 * `<name>.pawscript.funscript`. Whatever file is the target gets a .bak (first free name) before it is replaced.
 */
export function exportTarget(videoPath, origExists, overwrite) {
  const base = videoPath.replace(/\.[^.\\/]+$/, '');
  const alt = origExists && !overwrite;
  const script = base + (alt ? '.pawscript' : '') + '.funscript';
  return { script, bak: script + '.bak', orig: base + '.funscript', alt };
}

/**
 * The funscript object to write: `existing` (parsed JSON or null) with only `actions` replaced, so unknown
 * keys (metadata, chapters, other axes...) survive. An `inverted: true` file keeps its flag, so positions flip.
 */
export function funscriptDoc(existing, points) {
  const keep = existing && typeof existing === 'object' && !Array.isArray(existing);
  const doc = keep ? { ...existing } : { version: '1.0', inverted: false, range: 100 };
  const flip = doc.inverted === true;
  doc.actions = Array.from(points.at, (at, i) => {
    const pos = Math.round(Math.min(100, Math.max(0, points.pos[i])));
    return { at: Math.round(at), pos: flip ? 100 - pos : pos };
  });
  return doc;
}
