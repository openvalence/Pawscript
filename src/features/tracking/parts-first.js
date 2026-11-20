// Parts-first tracking (paw-ym1, PROTOCOL v4.14): the owner's finding (2026-11-09) that a sparse grid plus well-seeded
// groups at 16 points each tracks best. The preset sets only what is measured (the owner's runs); group_seed corners and
// group_fit stay separate params until the gold measurement (trackers/experiments/partsfirst/measure.py) says they win.
export const PARTS_FIRST = { box_points: 64, group_points: 16 };
export const PARTS_FIRST_TIP = 'Parts-first: a sparse 64-point grid for the background and the camera, plus 16 points of its own for every group you painted (or the tagger found). Few points, well seeded, track best. The other settings stay as they are.';

/** Points a box run seeds with k groups: the grid plus k x group_points (0: the groups take a share of the grid). */
export const pointTotal = (p, k) => (+p.box_points || 0) + k * (+p.group_points || 0);

/** group_points 0 (sidecar v4.46 group_counts, paw-9qim): k groups share n box points: the groups' total = 10 % of n
 *  each, at most 3/4 of n, at least 16 each while that fits; each gets `base` (16, or an even share of a smaller
 *  total), the rest by sqrt(area). -> {base, avg, total} (k = 0: null). */
export function groupShare(n, k) {
  if (!(k > 0)) return null;
  const total = Math.min(Math.floor(0.75 * n), Math.max(16 * k, k * Math.round(0.1 * n)));
  return { base: Math.max(1, Math.min(16, Math.floor(total / k))), avg: Math.round(total / k), total };
}

/** TAPNext++'s VRAM cap, GB: the sidecar's tapnext_points.need_gb (paw-s9ns: the fitted measured peak + 15 % + 0.5). */
const PEAK = { 256: [1.43, 0.104, 5.3e-5, 1.37e-4], 512: [1.72, 0.53, 3.1e-4, 1.05e-4] };
export function tapnextGb(model, chunk, n) {
  const [a, b, c, d] = PEAK[model === '512' ? 512 : 256];
  return 1.15 * (a + b * chunk + n * (c + d * chunk)) + 0.5;
}

/** The tracker process's VRAM cap for n points, GB: the sidecar's own defaults (measured peak + headroom; tapnext_points /
 *  cotracker_points track() cap_vram). null for other trackers. The tagger adds 1.8 GB while it runs. TAPNext++ `auto`
 *  (sidecar v4.55): the 256 figure (it runs 512 only for a small painted part: vramGb(id, {...p, model: '512'}, n)). */
export function vramGb(id, p, n) {
  if (id === 'tapnext_points') return tapnextGb(p.model, p.chunk ?? 8, n);
  if (id === 'cotracker_points') return p.mode === 'offline' ? 1.15 * (3.2 + 0.045 * (p.chunk_frames ?? 32)) : 2.2;
  return null;
}
