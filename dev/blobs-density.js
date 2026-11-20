// dev/blobs-density.js -- the blobs view (src/features/tracking/blobs.js drawBlobsView) on a dense synthetic scene like the
// owner's 2026-11-09 screenshot: two characters (C1 / C2 centres), four pinned groups (c1_tail, c1_hips, c1_balls,
// c2_balls), four moving bodies (two of them a character's), a static grid, a handheld camera, the pair, the primary
// (sem_c1_hips_proj) and the axis, over a procedural background (no footage).
//   ?w=1100&h=780   canvas size (CSS px)      ?bg=bright | noisy   the background      ?t=<frame>   the frame drawn
//   ?hover=s5 | g2  a hovered pinned group (id) / body      ?detail=1   every label in full (the Alt key's view)
// window.ready = true once painted (headless Edge screenshots).
import '../src/ui/kit/theme.css';
import '../src/style.css';
import { drawBlobsView, blobOpts } from '../src/features/tracking/blobs.js';
import { series, channelOf } from '../src/lib/runs.js';
import { GROUP_COLORS, STATIC_COLOR, INK_COLOR, AXIS_COLOR, PAIR_COLOR, GRID_COLOR, paint } from '../src/features/tracking/colors.js';

const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 1100), H = +(q.get('h') || 780), BG = q.get('bg') || 'noisy', FI = +(q.get('t') || 30);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// background: bright (pale skin / sheets, white highlights) or noisy (dark fur strokes)
const bg = document.getElementById('bg'), ov = document.getElementById('ov'), d = window.devicePixelRatio || 1;
for (const c of [bg, ov]) { c.width = W * d; c.height = H * d; c.style.width = W + 'px'; c.style.height = H + 'px'; c.getContext('2d').setTransform(d, 0, 0, d, 0, 0); }
const b = bg.getContext('2d');
if (BG === 'bright') {
  const g = b.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#f4e6d8'); g.addColorStop(1, '#e8cdb6'); b.fillStyle = g; b.fillRect(0, 0, W, H);
  for (let k = 0; k < 60; k++) { b.fillStyle = `rgba(255,255,255,${0.2 + 0.5 * rnd()})`; b.beginPath(); b.ellipse(rnd() * W, rnd() * H, 20 + 120 * rnd(), 10 + 60 * rnd(), rnd() * 3, 0, 7); b.fill(); }
} else {
  b.fillStyle = '#3a2c22'; b.fillRect(0, 0, W, H);
  for (let k = 0; k < 9000; k++) {
    const x = rnd() * W, y = rnd() * H, a = 1.2 + 0.4 * rnd(), L = 8 + 26 * rnd(), v = Math.floor(60 + 150 * rnd());
    b.strokeStyle = `rgba(${v},${Math.floor(v * 0.8)},${Math.floor(v * 0.65)},${0.25 + 0.5 * rnd()})`; b.lineWidth = 1 + 1.5 * rnd();
    b.beginPath(); b.moveTo(x, y); b.lineTo(x + L * Math.cos(a), y + L * Math.sin(a)); b.stroke();
  }
}

// the scene: 60 frames at 30 fps
const T = 60, t = Array.from({ length: T }, (_, k) => Math.round(k * 33.37));
const cluster = (cx, cy, rx, ry, n) => Array.from({ length: n }, () => { const a = rnd() * 7, r = Math.sqrt(rnd()); return [cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a)]; });
const bodies = [[0.5, 0.64, 0.09, 0.07, 22], [0.42, 0.37, 0.06, 0.08, 24], [0.8, 0.33, 0.05, 0.07, 20], [0.25, 0.68, 0.05, 0.03, 12]]
  .map(([x, y, rx, ry, n], g) => ({ g: g + 1, P: cluster(x, y, rx, ry, n), ph: g }));
const sems = [['c1_tail', 4, 0.5, 0.1, 0.06, 0.09, 18], ['c1_hips', 5, 0.6, 0.31, 0.25, 0.1, 19], ['c1_balls', 6, 0.53, 0.47, 0.08, 0.08, 19], ['c2_balls', 7, 0.56, 0.77, 0.08, 0.06, 19]]
  .map(([name, id, x, y, rx, ry, n]) => ({ name, id, P: cluster(x, y, rx, ry, n) }));
const grid = [];
for (let i = 0; i < 9; i++) for (let j = 0; j < 7; j++) grid.push([0.05 + i * 0.112, 0.06 + j * 0.145]);
const mv = (k, ph, a = 0.02) => [a * Math.sin(k / 5 + ph), 0.6 * a * Math.cos(k / 5 + ph)];
const cam = (k) => [0.004 * Math.sin(k / 9), 0.003 * Math.cos(k / 7)];
const ovs = [];
for (let k = 0; k < T; k++) {
  const [cx, cy] = cam(k), pts = [];
  for (const B of bodies) { const [dx, dy] = mv(k, B.ph); for (const [x, y] of B.P) pts.push([x + dx + cx, y + dy + cy, 1, B.g]); }
  for (const S of sems) { const [dx, dy] = mv(k, S.id, 0.012); for (const [x, y] of S.P) pts.push([x + dx + cx, y + dy + cy, 1, -1, 0, S.id]); }
  for (const [x, y] of grid) pts.push([x + cx, y + cy, 1, 0]);
  ovs.push({ pts });
}
const fr = { t, v: t.map((_, k) => 0.5 + 0.4 * Math.sin(k / 5)), ov: ovs };
const ch = (f) => channelOf(t.map((tt, k) => [tt, f(k)]));
const mean = (P) => [P.reduce((s, p) => s + p[0], 0) / P.length, P.reduce((s, p) => s + p[1], 0) / P.length];
const channels = { cam_x: ch((k) => cam(k)[0]), cam_y: ch((k) => cam(k)[1]), cam_conf: ch(() => 0.04), pair_dist: ch((k) => 0.29 + 0.02 * Math.sin(k / 5)),
  proj: ch((k) => 0.5 + 0.4 * Math.sin(k / 5)), proj_cam: ch((k) => 0.5 + 0.3 * Math.sin(k / 5)), n_groups: ch(() => 4), vis_frac: ch(() => 0.96) };
for (const B of bodies) {
  const [x, y] = mean(B.P);
  channels[`g${B.g}_x`] = ch((k) => x + mv(k, B.ph)[0]); channels[`g${B.g}_y`] = ch((k) => y + mv(k, B.ph)[1]); channels[`g${B.g}_n`] = ch(() => B.P.length / 200);
}
for (const S of sems) {
  const [x, y] = mean(S.P), n = `sem_${S.name}`;
  channels[n + '_x'] = ch((k) => x + mv(k, S.id, 0.012)[0]); channels[n + '_y'] = ch((k) => y + mv(k, S.id, 0.012)[1]);
  channels[n + '_proj'] = ch((k) => 0.5 + 0.45 * Math.sin(k / 5 + S.id)); channels[n + '_n'] = ch(() => 0.09); channels[n + '_fit'] = ch(() => (S.id === 7 ? 0.42 : 0.91));
}
for (const [w, g] of [['c1', 2], ['c2', 1]]) {
  const [x, y] = mean(bodies[g - 1].P);
  channels[`who_${w}_x`] = ch((k) => x + 0.01 + mv(k, g - 1)[0]); channels[`who_${w}_y`] = ch((k) => y - 0.02 + mv(k, g - 1)[1]);
}
const groups = { g1: { label: 'body' }, g2: { label: 'body' }, g3: { label: 'body' }, g4: { label: 'body' } };
for (const S of sems) groups['sem_' + S.name] = { label: S.name, source: 'user', id: S.id };
const run = { name: 'TAPNext++ points (clicks or box)', params: { primary: 'auto' }, samples: series(t.map((tt, k) => [tt, 0.15 + 0.1 * Math.sin(k / 5)])),
  scenes: [{ start_ms: 0, end_ms: 2100, groups, camera: [{ t0: 0, t1: 2100, kind: 'handheld' }] }],
  notes: [{ code: 'primary', scene_index: 0, data: { chosen: 'sem_c1_hips_proj', rule: 'auto: pinned c1_hips found on 100 % of frames → sem_c1_hips_proj', sign: { applied: 1, mode: 'keep' }, axis: { mode: 'auto', deg: 105 } } }],
  confidence: series(t.map((tt) => [tt, 0.23])), channels };

// the picture: a 1.4 : 1 video fitted into the canvas
const A = 1.4, fw = Math.min(W, H * A), fh = fw / A, fx = (W - fw) / 2, fy = (H - fh) / 2;
const env = { map: (x, y) => [fx + x * fw, fy + y * fh], unmap: (x, y) => [(x - fx) / fw, (y - fy) / fh], f: { x: fx, y: fy, w: fw, h: fh } };
const hv = q.get('hover') || '', hover = /^s\d+$/.test(hv) ? { s: +hv.slice(1) } : /^g\d$/.test(hv) ? { g: +hv.slice(1) } : null;
const opts = { ...blobOpts((k, dflt) => dflt), detail: q.get('detail') === '1' };
drawBlobsView(ov.getContext('2d'), env, fr, FI, { colors: [...GROUP_COLORS, STATIC_COLOR].map(paint),
  ink: { text: paint(INK_COLOR), axis: paint(AXIS_COLOR), pair: paint(PAIR_COLOR), grid: paint(GRID_COLOR) },
  opts, run, lane: q.get('lane') || 'sem_c1_hips_proj', hi: hover?.g || 0, hiSem: hover?.s || 0, tMin: 0, tMax: 2100, nextMs: 2000, aspect: A });
window.ready = true;
