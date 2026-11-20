// seed-marks.js -- where a run's painted groups were seeded, as Tracker-row marks (pure). The frame is the groups' t_ms
// (scene.groups[].t_ms) of each shot the run covers, else the run's ROI frame. When that picture repeats exactly
// elsewhere (timeline/repeats.js), the same mark, fainter, sits on every other occurrence inside the run's span.
import { occurrenceAt, occurrencesOf, bucketColor } from '../timeline/repeats.js';
import { fmtMs } from '../../lib/video.js';
import { frameAt, frameLen } from '../../lib/lane.js';

/** The seed frame times of a run: per doc scene it overlaps, its groups' first t_ms inside the scene and the run; none
 *  there: roi.t_ms. Sorted, one per frame. */
export function seedTimes(run, scenes = []) {
  if (Array.isArray(run.seeds)) return [...new Set(run.seeds)].sort((a, b) => a - b);   // a modifier's own run: its own seed frame and corrections (paw-ef73.26)
  const { start, end } = run.range, out = [];
  for (const s of scenes) {
    if (!(s.end_ms > start && s.start_ms < end)) continue;
    const g = (s.groups || []).find((q) => !q.off && Number.isFinite(q.t_ms) && q.t_ms >= Math.max(s.start_ms, start) && q.t_ms < Math.min(s.end_ms, end));
    if (g) out.push(g.t_ms);
  }
  if (!out.length && Number.isFinite(run.roi?.t_ms)) out.push(run.roi.t_ms);
  return [...new Set(out)].sort((a, b) => a - b);
}

/** paw-46du: every seed frame of the video, for the timeline's marks and the previous / next seed frame keys. Painted parts
 *  (scene.groups[].t_ms: there as soon as a frame is painted, no run needed; ignore regions and parts turned off are not
 *  seeds) and each tracker run's own (seedTimes: its groups' frame per shot, else its ROI frame, a modifier run's seeds; a
 *  one-way run's seedMs; the extra seeds tracked into it, groupSeeds), so a project with runs and no painted groups left
 *  still shows them. References, derived ghosts and camera runs have none. Frames within `slack` ms are one.
 *  -> [{t, painted: [names], runs: [run numbers]}] sorted by t. */
export function seedFrames(scenes = [], runs = [], slack = 1) {
  const all = [];
  for (const s of scenes || []) for (const g of s?.groups || []) if (Number.isFinite(g?.t_ms) && !g.off && !/^ignore\d*$/.test(g.name || '')) all.push({ t: g.t_ms, name: g.name || '' });
  for (const r of runs || []) {
    if (!r?.range || r.ref || r.derived || r.tag === 'camera') continue;
    const ts = [...seedTimes(r, scenes), ...(Number.isFinite(r.seedMs) ? [r.seedMs] : []), ...(Array.isArray(r.groupSeeds) ? r.groupSeeds.map((q) => q?.t_ms).filter(Number.isFinite) : [])];
    for (const t of ts) all.push({ t, run: r.n ?? r.id });
  }
  all.sort((a, b) => a.t - b.t);
  const out = [];
  for (const x of all) {
    let m = out.at(-1);
    if (!m || x.t - m.t > slack) out.push((m = { t: x.t, painted: [], runs: [] }));
    if (x.name != null && !m.painted.includes(x.name)) m.painted.push(x.name);
    if (x.run != null && !m.runs.includes(x.run)) m.runs.push(x.run);
  }
  return out;
}
/** The seed frame after (dir 1) / before (-1) time t, wrapping round the video; frames within eps ms of t are skipped.
 *  -> t | null (no seed frame). */
export function seedStep(frames, t, dir, eps = 1) {
  if (!frames?.length) return null;
  const f = dir > 0 ? frames.find((m) => m.t > t + eps) : frames.findLast((m) => m.t < t - eps);
  return (f ?? (dir > 0 ? frames[0] : frames.at(-1))).t;
}
/** The index of the first frame at or after t (binary search: the timeline draws only the marks in view). */
export function seedFrom(frames, t) {
  let lo = 0, hi = frames.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (frames[m].t < t) lo = m + 1; else hi = m; }
  return lo;
}

export const SEED_TIP = 'Groups painted on this frame';
export const twinTip = (t) => `Same picture as the seed frame (${fmtMs(t)})`;

/** Seed times + the repeats index -> marks for drawLane's o.marks: {t, label, color, alpha?, tip, seed (the frame
 *  itself, else a twin)}. label 'seed', 'seed ×N' on the frame itself when its picture occurs N > 1 times; the twins
 *  (every other occurrence inside run.range) are faint. color: the picture's bucket hue (as the ruler's ticks), else `color`. */
export function seedMarks(times, ix, frameMs, range, color, light = false) {
  const out = [];
  for (const t of times) {
    const o = frameLen(frameMs) && ix ? occurrenceAt(ix, frameAt(t, frameMs)) : null;   // frameMs: the grid the index is on (paw-kxz4)
    const occ = o ? occurrencesOf(ix, o.id) : [], col = o ? bucketColor(o.id, light) : color;
    out.push({ t, label: occ.length > 1 ? `seed ×${occ.length}` : 'seed', color: col, tip: SEED_TIP, seed: true });
    for (const q of occ) if (q !== o && q.f0 !== o.f0 && q.t >= range.start && q.t < range.end) out.push({ t: q.t, label: 'seed', color: col, alpha: 0.35, tip: twinTip(t), seed: false });
  }
  return out.sort((a, b) => a.t - b.t);
}
