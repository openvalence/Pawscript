// Synthetic 3-D bodies for the six-axis tests (test/six-axis.test.mjs, test/six-axis-solo.test.mjs): point clouds with a known
// motion, projected orthographically to a view; channels and overlay points as a points run stores them.
export const FPS = 30, SECS = 8, N = FPS * SECS;
// deterministic directions on a sphere
export const dirs = (n, seed) => Array.from({ length: n }, (_, k) => { const a = (k * 2.399963 + seed) % (2 * Math.PI), z = 1 - (2 * (k + 0.5)) / n, r = Math.sqrt(1 - z * z); return [r * Math.cos(a), r * Math.sin(a), z]; });
export const BOT = dirs(16, 0.3).map(([a, b, c]) => [0.09 * a, 0.06 * b, 0.07 * c]);
export const TOPC = dirs(10, 1.1).map(([a, b, c]) => [0.05 * a - 0.2, 0.05 * b, 0.05 * c]);
// rotation of p about unit axis k (0 = S, 1 = F, 2 = L) by th, right-handed
export function rot(p, k, th) {
  const [i, j] = [[1, 2], [2, 0], [0, 1]][k], c = Math.cos(th), s = Math.sin(th), q = [...p];
  q[i] = c * p[i] - s * p[j]; q[j] = s * p[i] + c * p[j];
  return q;
}
// picture projections (orthographic) of body-frame points [S, F, L]: image x right, y down
export const PROJ = { side: (p) => [p[0], -p[1]], rear: (p) => [-p[2], -p[1]], front: (p) => [p[2], -p[1]], top: (p) => [p[0], p[2]],
  topM: (p) => [p[0], -p[2]], rearM: (p) => [p[2], -p[1]] };   // paw-5r1: the mirror images (the camera on the other side)

/** A run with a Bottom hips group (id 4) and a Top hips group (id 5) moving as `motion` says, seen from `view`. sides: the Bottom's
 *  painted thighs too (paw-5r1: c1_thighs_l on its own left, L = +0.06; c1_thighs_r at -0.06), moving with it. */
export function synth(view, motion, { sides = false } = {}) {
  const t = [], ov = [], ch = { sem_c1_hips_x: [], sem_c1_hips_y: [], sem_c2_hips_x: [], sem_c2_hips_y: [], ...(sides ? { sem_c1_thighs_l_x: [], sem_c1_thighs_l_y: [], sem_c1_thighs_r_x: [], sem_c1_thighs_r_y: [] } : {}) }, truth = [];
  for (let f = 0; f < N; f++) {
    const tm = Math.round((f * 1000) / FPS), sec = tm / 1000;
    const stroke = 0.06 * Math.sin((2 * Math.PI * sec) / 0.8), wob = Math.sin((2 * Math.PI * sec) / 1.3 + 0.5);
    truth.push(wob);
    const amt = motion.kind === 'rot' ? 0.12 * wob : 0.02 * wob;
    const bot = BOT.map((p) => { let q = motion.kind === 'rot' ? rot(p, motion.k, amt) : [...p]; if (motion.kind === 'move') q[motion.k] += amt; return q; });
    const top = TOPC.map((p) => [p[0] + stroke, p[1], p[2]]);
    const img = (p) => { const [x, y] = PROJ[view](p); return [0.5 + x, 0.5 + y]; };
    const pts = [...bot.map((p) => [...img(p), 1, 1, 0, 4]), ...top.map((p) => [...img(p), 1, 1, 0, 5])];
    const cen = (a) => [a.reduce((s, q) => s + q[0], 0) / a.length, a.reduce((s, q) => s + q[1], 0) / a.length];
    const cb = cen(pts.slice(0, BOT.length)), ct = cen(pts.slice(BOT.length));
    t.push(tm); ov.push({ pts });
    ch.sem_c1_hips_x.push(cb[0]); ch.sem_c1_hips_y.push(cb[1]); ch.sem_c2_hips_x.push(ct[0]); ch.sem_c2_hips_y.push(ct[1]);
    if (sides) for (const [k, l] of [['l', 0.06], ['r', -0.06]]) {
      let q = motion.kind === 'rot' ? rot([0, 0, l], motion.k, amt) : [0, 0, l];
      if (motion.kind === 'move') q = q.map((v, j) => (j === motion.k ? v + amt : v));
      const [x, y] = img(q); ch[`sem_c1_thighs_${k}_x`].push(x); ch[`sem_c1_thighs_${k}_y`].push(y);
    }
  }
  const channels = Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, { t: Float64Array.from(t), v: Float32Array.from(v) }]));
  const run = { id: 'run1', channels, frames: { t, v: t.map(() => 0.5), ov }, scenes: [{ start_ms: 0, end_ms: t[N - 1] + 34, sign: 1, groups: { sem_c1_hips: { id: 4 }, sem_c2_hips: { id: 5 } } }], params: {} };
  return { run, truth };
}
