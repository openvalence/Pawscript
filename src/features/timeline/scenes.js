// scenes.js -- pure scene-list ops and chip text. A list is contiguous: [{start_ms, end_ms, sign?, loop?, describe?, tags?, continues?,
// camera?, split?, kind?, transition?}] (camera = pawtrack camera.py segments; split 'camera' = this start is a camera move inside one
// shot, not a cut; kind 'blank' | 'still' and transition {in, out, in_ms?, out_ms?} = pawtrack scenes.py, PROTOCOL v4.5),
// first start 0, each start = previous end, last end = duration. Ops return a new list, or null when refused.
import { lowerBound } from '../../lib/core/script.js';
import { playheadFrameStart, frameStartOf, frameLen } from '../../lib/lane.js';
import { speciesShown } from '../../lib/content.js';

/** paw-kxz4: stored structure put on the start of the real frame it meant (grid: the player's clock, lane.js): an edge already on a
 *  frame start stays; one placed on the old n x frameMs grid meant the picture that grid's frame showed, the one at its middle
 *  (the player asked there), so it goes to the start of the real frame holding t + frameMs / 2. Edges:
 *  cuts (each interior shot start = the previous end; the first start and the last end stay), the modifiers' edges and the
 *  loops' edges (an untouched automatic loop's auto.t0 / t1 / end with them, so it stays automatic; a tiled loop stays: its tiles
 *  were made with its period). Points, runs and groups are not touched. -> {scenes, fx, loops, moved (edges), maxMs} with only the lists that changed, or null (all on frames). */
export function edgesOnFrames(doc, grid) {
  let moved = 0, maxMs = 0;
  const half = frameLen(grid) / 2, snap = (t) => (!Number.isFinite(t) || frameStartOf(t, grid) === t ? t : frameStartOf(t + half, grid));
  const on = (t) => { const s = snap(t); if (s !== t) { moved++; maxMs = Math.max(maxMs, Math.abs(s - t)); } return s; };
  const out = {}, sc = doc.scenes || [];
  const starts = sc.map((s, i) => (i ? snap(s.start_ms) : s.start_ms));
  if (starts.every((t, i) => !i || t > starts[i - 1]) && starts.some((t, i) => t !== sc[i].start_ms)) {   // two cuts in one frame: left as they are
    for (let i = 1; i < sc.length; i++) on(sc[i].start_ms);   // counted
    out.scenes = sc.map((s, i) => ({ ...s, start_ms: starts[i], end_ms: i < sc.length - 1 ? starts[i + 1] : s.end_ms }));
  }
  const fx = (doc.fx || []).map((f) => { const t0 = on(f.t0), t1 = on(f.t1); return t0 === f.t0 && t1 === f.t1 ? f : { ...f, t0, t1: f.t1 === f.t0 ? t0 : Math.max(t1, t0 + 1) }; });   // a spurt marker stays one instant
  if (fx.some((f, i) => f !== doc.fx[i])) out.fx = fx;
  const acts = (doc.acts || []).map((r) => { const t0 = on(r.t0), t1 = on(r.t1); return t0 === r.t0 && t1 === r.t1 ? r : { ...r, t0, t1: Math.max(t1, t0 + 1) }; });   // paw-2lp7.2: the action regions
  if (acts.some((r, i) => r !== doc.acts[i])) out.acts = acts;
  const loops = (doc.loops || []).map((l) => {
    if (l.tiledTo > l.t1) return l;
    const auto = !!l.auto && l.t0 === l.auto.t0 && l.t1 === l.auto.t1, t0 = on(l.t0), t1 = on(l.t1);
    if (t0 === l.t0 && t1 === l.t1) return l;
    return { ...l, t0, t1: Math.max(t1, t0 + 1), ...(auto ? { auto: { ...l.auto, t0, t1: Math.max(t1, t0 + 1), end: snap(l.auto.end) } } : {}) };
  });
  if (loops.some((l, i) => l !== doc.loops[i])) out.loops = loops;
  return Object.keys(out).length ? { ...out, moved, maxMs } : null;
}

/** Index of the scene containing t (the last scene owns the end), -1 if none. */
export function sceneIndexAt(list, t) {
  for (let i = 0; i < list.length; i++) if (t >= list[i].start_ms && t < list[i].end_ms) return i;
  return list.length && t >= list[list.length - 1].end_ms ? list.length - 1 : -1;
}

/** paw-p52k: index of the shot / scene on screen at the player's playhead: by the playhead's frame start (lane.js playheadFrameStart), so
 *  a cut belongs to the shot that starts there whatever float the video reported. Every "at the playhead" lookup goes through it. */
export const sceneAtPlayhead = (list, player) => sceneIndexAt(list, playheadFrameStart(player));

/** Split scene containing t: both halves keep describe/sign/camera, the loop result is dropped (it was for the whole);
 *  `continues` (lib/scenes-continue.js) and `split` stay with the first half (the one right after the cutaway / camera
 *  move): the new cut is the user's. */
export function splitAt(list, t, minLen = 1) {
  const i = sceneIndexAt(list, t), s = list[i];
  if (!s || t - s.start_ms < minLen || s.end_ms - t < minLen) return null;
  const { loop, continues, split, ...rest } = s;   // eslint-disable-line no-unused-vars
  return [...list.slice(0, i), { ...rest, ...(continues != null && { continues }), ...(split && { split }), end_ms: t }, { ...rest, start_ms: t }, ...list.slice(i + 1)];
}

/** Remove the cut between scene i and i+1: the merged scene keeps the first's info. */
export function mergeNext(list, i) {
  if (i < 0 || i >= list.length - 1) return null;
  return [...list.slice(0, i), { ...list[i], end_ms: list[i + 1].end_ms }, ...list.slice(i + 2)];
}

/** Indices [i, j] of the first and last scene overlapping (t0, t1), or null when none does. */
export function scenesIn(list, t0, t1) {
  const i = list.findIndex((s) => s.start_ms < t1 && s.end_ms > t0);
  if (i < 0) return null;
  let j = i;
  while (j + 1 < list.length && list[j + 1].start_ms < t1) j++;
  return [i, j];
}

/** Merge every scene overlapping (t0, t1) into one (keeps the first's info, like mergeNext); null when < 2 overlap. */
export function mergeRange(list, t0, t1) {
  const r = scenesIn(list, t0, t1);
  if (!r || r[1] === r[0]) return null;
  const [i, j] = r;
  return [...list.slice(0, i), { ...list[i], end_ms: list[j].end_ms }, ...list.slice(j + 1)];
}

/** paw-jfwv: a dragged cut stops this far (ms) from its neighbouring cut: a drag past it left a 1-frame shot. */
export const MIN_SHOT_MS = 250;   // ponytail: one fixed floor; a per-fps or setting value if 250 ms ever blocks a real flash cut
/** Move the cut at the start of scene i (i >= 1) to t, clamped so both neighbours keep >= minLen, and neither is made
 *  shorter than MIN_SHOT_MS by the move (one already shorter keeps its length at most: it never jumps). */
export function moveCut(list, i, t, minLen = 1) {
  if (i < 1 || i >= list.length) return null;
  const a = list[i - 1], b = list[i];
  const ma = Math.max(minLen, Math.min(MIN_SHOT_MS, b.start_ms - a.start_ms)), mb = Math.max(minLen, Math.min(MIN_SHOT_MS, b.end_ms - b.start_ms));
  t = Math.round(Math.max(a.start_ms + ma, Math.min(b.end_ms - mb, t)));
  if (t === b.start_ms) return list;
  if (a.start_ms + ma > b.end_ms - mb) return null;
  return list.map((s, k) => (k === i - 1 ? { ...s, end_ms: t } : k === i ? { ...s, start_ms: t } : s));
}

/** Set scene i's tags diff (acts.js: ['knotting', '-anal']), or clear it with null / [] (back to the describe's).
 *  Same list when nothing changes, null when i is out of range. */
export function setTags(list, i, tags) {
  const s = list[i];
  if (!s) return null;
  if (JSON.stringify(s.tags ?? []) === JSON.stringify(tags ?? [])) return list;
  const { tags: _, ...rest } = s;   // eslint-disable-line no-unused-vars
  return list.map((x, k) => (k === i ? (tags?.length ? { ...rest, tags } : rest) : x));
}

/** The scene's soft edges as words: 'fade in 0.6 s', 'dissolve out 0.5 s' ([] for hard cuts). A blank's own fades
 *  read from its side: 'fade from scene' (in) / 'fade into scene' (out). */
export function transitionText(s) {
  const t = s?.transition, out = [], sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
  if (!t) return out;
  const blank = s.kind === 'blank';
  if (t.in === 'fade' || t.in === 'dissolve') out.push(`${t.in === 'fade' ? (blank ? 'faded out of the scene before' : 'fade in') : 'dissolve in'}${t.in_ms ? ' ' + sec(t.in_ms) : ''}`);
  if (t.out === 'fade' || t.out === 'dissolve') out.push(`${t.out === 'fade' ? (blank ? 'fades into the next scene' : 'fade out') : 'dissolve out'}${t.out_ms ? ' ' + sec(t.out_ms) : ''}`);
  return out;
}

export const FILL_GLYPH = { timing: 'timing ⌁' };   // paw-2lp7.4: the bridge's one option (the fills before / after / both are gone)
/** Short chips for a scene, most important first: [{text, tone: 'loop'|'describe'|'sign'|'knot'}]. */
export function chipsOf(s) {
  const out = [], L = s.loop;
  if (FILL_GLYPH[s.fill]) out.push({ text: FILL_GLYPH[s.fill], tone: 'loop' });   // the bridge's timing option
  if (L) {
    if (L.kind === 'exact' || (L.kind === 'periodic' && L.period_frames)) out.push({ text: `loop ${L.period_frames ?? Math.round(L.period_ms)} ${L.period_frames ? 'f' : 'ms'}`, tone: 'loop' });
    else if (L.motion_period_ms) out.push({ text: `≈ ${(L.motion_period_ms / 1000).toFixed(2)} s`, tone: 'loop' });
  }
  const d = s.describe?.summary;
  if (d) {
    const txt = [speciesShown() ? d.species?.join('+') : '', d.acts?.join('+')].filter(Boolean).join(' · ');   // paw-43vn: no species words with furry items off
    if (txt) out.push({ text: txt, tone: 'describe' });
    if (d.knot) out.push({ text: '◆', tone: 'knot' });
  }
  if (s.kind === 'still') out.push({ text: '‖ still', tone: 'describe' });
  // only a notable direction: reversed, or the user's sign differs from the detected one
  const sign = s.sign ?? s.auto_sign;
  if (sign === -1 || (s.auto_sign != null && s.sign != null && s.sign !== s.auto_sign)) out.push({ text: sign > 0 ? '↑' : '↓', tone: 'sign' });
  return out;
}

/** The share (0..1) of [t0, t1) a script covers: the time between consecutive points at most `gap` ms apart. */
export function coverage(script = [], t0, t1, gap = 2000) {
  if (!(t1 > t0)) return 0;
  let cov = 0;
  for (let k = Math.max(1, lowerBound(script, t0)); k < script.length; k++) {
    const a = script[k - 1].at, b = script[k].at;
    if (b - a <= gap) cov += Math.max(0, Math.min(b, t1) - Math.max(a, t0));
    if (b >= t1) break;
  }
  return Math.min(1, cov / (t1 - t0));
}
/** A scene's run status for the Scenes panel: 'accepted' (the axis script covers half of it or more), else 'ghost' (a
 *  tracker run covers it: `ghost` = that run's ghost, the caller resolves it), else 'none'; cover = that coverage. */
export function sceneStatus(scene, script, ghost = null) {
  const a = coverage(script, scene.start_ms, scene.end_ms);
  if (a >= 0.5) return { state: 'accepted', cover: a };
  if (ghost) return { state: 'ghost', cover: coverage(ghost.script, scene.start_ms, scene.end_ms) };
  return { state: 'none', cover: a };
}
