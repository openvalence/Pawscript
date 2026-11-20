// dev/perf/synth-runs.mjs -- paw-o60v: synthetic tracker runs at the owner's size (a TAPNext-like grid of P points a frame with
// pinned group ids, the per-group channels the points trackers send), for the runs-file / heap benchmarks and the big project.
import { makeRun } from '../../src/lib/runs.js';
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const NAMES = ['c1_hips', 'c2_penis', 'c1_tail', 'c2_balls', 'c1_head', 'c2_hand', 'c1_torso', 'c2_torso'];   // pinned groups as the app names them (who_part)
// spans: [[t0 ms, frames, groups], ...] instead of runs x frames back to back
export function synthRuns({ runs = 24, frames = 600, points = 1024, groups = 6, fps = 30, gap = 0, spans = null } = {}) {
  const out = [], side = Math.ceil(Math.sqrt(points)), dt = 1000 / fps;
  const plan = spans || Array.from({ length: runs }, (_, r) => [Math.round(r * (frames * dt + gap)), frames, groups]);
  for (let r = 0; r < plan.length; r++) {
    const [t0, frames, groups] = plan[r], fr = { t: [], v: [], ov: [] }, samples = [], ch = {}, put = (k, t, v) => (ch[k] ||= []).push([t, v]);
    for (let i = 0; i < frames; i++) {
      const t = Math.round(t0 + i * dt), s = Math.sin((2 * Math.PI * t) / 1000), pts = new Array(points);
      for (let j = 0; j < points; j++) { const x = ((j % side) + 0.5) / side, y = (Math.floor(j / side) + 0.5) / side, g = j % 37 === 0 ? 1 + (j % groups) : 0;
        pts[j] = g ? [+(x + 0.01 * s).toFixed(4), +(y + 0.02 * s).toFixed(4), j % 11 ? 1 : 0, -1, 0, g] : [+(x + 0.01 * s).toFixed(4), +(y + 0.02 * s).toFixed(4), j % 11 ? 1 : 0, 0]; }
      fr.t.push(t); fr.v.push(0.5 + 0.5 * s); fr.ov.push({ points: pts.filter((q) => q[2]).map((q) => [q[0], q[1]]), boxes: pts.filter((q) => !q[2]).map((q) => [r4(q[0] - 0.006), r4(q[1] - 0.006), 0.012, 0.012]), pts });   // as the grid trackers send it
      samples.push([t, 0.5 + 0.5 * s]);
      for (let g = 1; g <= groups; g++) for (const c of ['x', 'y', 'n', 'proj']) put(`sem_${NAMES[g - 1]}_${c}`, t, 0.5 + 0.1 * Math.sin(t / 300 + g));
      for (const c of ['cam_x', 'cam_y', 'centroid_x', 'centroid_y', 'proj']) put(c, t, 0.5 + 0.01 * s);
    }
    const pointsOut = []; for (let i = 15; i < frames; i += 15) pointsOut.push({ at: Math.round(t0 + i * dt), pos: (i / 15) % 2 ? 100 : 0 });
    const run = makeRun({ n: r + 1, tracker: { id: 'tapnext_points', name: 'TAPNext' }, params: {}, range: { start: t0, end: Math.round(t0 + frames * dt) }, roi: null,
      result: { samples, points: pointsOut, channels: ch, confidence: samples.map(([t]) => [t, 0.9]), scenes: [{ start_ms: t0, end_ms: Math.round(t0 + frames * dt), sign: 1, groups: Object.fromEntries(Array.from({ length: groups }, (_, g) => [`sem_${NAMES[g]}`, { label: NAMES[g], source: 'user', id: g + 1, points: 3 }])) }] }, frames: fr, runs: out });
    out.push(run);
  }
  return out;
}
