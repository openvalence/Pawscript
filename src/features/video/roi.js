// roi.js -- the first overlay clients, ported from the bench's VideoPane: a run's stored ROI and what a tracker saw
// (translucent mask polygons, boxes, points) from stored run frames (paw-x8we: nothing draws an ROI on the video any
// more; Track ROI takes a painted part). Same normalised 0..1 coordinates and shapes as the bench and the sidecar:
//   roi = {kind:'box', x, y, w, h} | {kind:'points', points: [[x, y], ...]} | null
//   overlay frame = {masks?: [[[x, y], ...]], boxes?: [[x, y, w, h]], points?: [[x, y]], pts?: [[x, y, v(, group)]]}
// The tracking feature registers these (see dev/video.js for a working example).

import { pathRect, pathPoly } from './overlays.svelte.js';

export const ROI_COLOR = '#4DA6FF';

/** The ROI: dashed box, or ringed points. */
export function drawRoi(ctx, env, roi, color = ROI_COLOR) {
  if (!roi) return;
  ctx.save(); ctx.lineWidth = 1.5; ctx.strokeStyle = ctx.fillStyle = color;
  if (roi.kind === 'box') {
    ctx.setLineDash([6, 4]); ctx.beginPath(); pathRect(ctx, env, roi.x, roi.y, roi.w, roi.h); ctx.stroke();
  } else if (roi.kind === 'points') {
    for (const [x, y] of roi.points) {
      const [X, Y] = env.map(x, y);
      ctx.beginPath(); ctx.arc(X, Y, 5, 0, 2 * Math.PI); ctx.stroke(); ctx.fillRect(X - 1, Y - 1, 2, 2);
    }
  }
  ctx.restore();
}

/** One stored tracker overlay frame: translucent masks, boxes, filled points. */
export function drawFrameOverlay(ctx, env, ov, color) {
  if (!ov) return;
  ctx.save(); ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = 2;
  for (const poly of ov.masks || []) {
    if (poly.length < 3) continue;
    ctx.beginPath(); pathPoly(ctx, env, poly);
    ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 2;
  }
  for (const b of ov.boxes || []) { ctx.beginPath(); pathRect(ctx, env, b[0], b[1], b[2], b[3]); ctx.stroke(); }
  for (const p of ov.points || []) { const [X, Y] = env.map(p[0], p[1]); ctx.beginPath(); ctx.arc(X, Y, 4, 0, 2 * Math.PI); ctx.fill(); }
  ctx.restore();
}

const FAST = 0.4;   // frame heights per second that count as full speed (bright, saturated)
const JUMP = 0.1;   // ponytail: a point moving > 0.1 frame per step is a re-seed (cut, offline chunk border), not motion; ends its trail
let xs = new Float32Array(64), ys = new Float32Array(64);

/**
 * Motion trails of per-point overlays (ov.pts = [[x, y, v], ...], same index = same point; PROTOCOL v3.1).
 * fr = stored frames {t, ov}, i = head frame index, n = trail length in frames, tMin = no trail before this time
 * (the scene start). Per point: a polyline over the last n frames fading toward its tail, hue = direction of the
 * head-tail displacement, saturation / alpha = its speed (still points nearly invisible), a dot at the head.
 * Occluded points draw nothing; an occluded or missing step ends the trail.
 * groups = [g1, g2, g3, g4, static] colours: points with a group (pts[i][3]) take its colour instead of the
 * direction hue (alpha still = speed; static dimmed, unassigned faint grey). hi = a group (1..4) drawn full,
 * the others dimmed (0 = none).
 */
export function drawTrails(ctx, env, fr, i, n, tMin = -Infinity, groups = null, hi = 0) {
  const head = fr.ov[i]?.pts;
  if (!head) return;
  if (xs.length < n + 1) { xs = new Float32Array(n + 1); ys = new Float32Array(n + 1); }
  const [ax, ay] = env.map(0, 0), [bx, by] = env.map(0, 1), hpx = Math.hypot(bx - ax, by - ay) || 1;
  const k0 = Math.max(0, i - n), th = fr.t[i];
  ctx.save(); ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  for (let j = 0; j < head.length; j++) {
    const p = head[j];
    if (!p[2]) continue;
    let m = 1, px = p[0], py = p[1], tt = th;
    [xs[0], ys[0]] = env.map(px, py);
    for (let k = i - 1; k >= k0 && fr.t[k] >= tMin; k--) {
      const q = fr.ov[k]?.pts?.[j];
      if (!q || !q[2] || Math.abs(q[0] - px) > JUMP || Math.abs(q[1] - py) > JUMP) break;
      [xs[m], ys[m]] = env.map(q[0], q[1]); m++;
      px = q[0]; py = q[1]; tt = fr.t[k];
    }
    const dx = xs[0] - xs[m - 1], dy = ys[0] - ys[m - 1];
    const s = m > 1 && th > tt ? Math.min(1, Math.hypot(dx, dy) / hpx / ((th - tt) / 1000) / FAST) : 0;
    let a = 0.06 + 0.94 * s;
    const g = groups && p.length > 3 ? p[3] : null;
    if (g == null) ctx.strokeStyle = ctx.fillStyle = `hsl(${Math.round((Math.atan2(dy, dx) * 180) / Math.PI)} ${Math.round(25 + 75 * s)}% 60%)`;
    else {
      ctx.strokeStyle = ctx.fillStyle = g > 0 ? groups[g - 1] : groups[4];
      a = g > 0 ? 0.25 + 0.75 * s : g === 0 ? 0.2 + 0.3 * s : 0.12;   // groups stay visible when slow; static dim; unassigned faint
      if (hi) a = g === hi ? 1 : a * 0.15;
    }
    for (let q = 0; q < m - 1; q++) {
      ctx.globalAlpha = a * (1 - q / (m - 1));
      ctx.beginPath(); ctx.moveTo(xs[q], ys[q]); ctx.lineTo(xs[q + 1], ys[q + 1]); ctx.stroke();
    }
    ctx.globalAlpha = a;
    ctx.beginPath(); ctx.arc(xs[0], ys[0], 2, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.restore();
}

/** Convex hull (Andrew's monotone chain) of [[x, y], ...] -> its corners in order; < 3 distinct points -> them. */
export function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Is (x, y) inside the convex polygon h (either winding)? */
export function inHull(h, x, y) {
  if (h.length < 3) return false;
  let s = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], c = Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]));
    if (c && s && c !== s) return false;
    s = s || c;
  }
  return true;
}

/** A labelled dashed box (scene-describe tag boxes): box = [x, y, w, h]. */
export function drawTagBox(ctx, env, box, label, color = '#A78BFA') {
  ctx.save(); ctx.lineWidth = 1.5; ctx.strokeStyle = ctx.fillStyle = color; ctx.font = '11px Chakra Petch, sans-serif';
  ctx.setLineDash([3, 3]); ctx.beginPath(); pathRect(ctx, env, box[0], box[1], box[2], box[3]); ctx.stroke();
  const [X, Y] = env.map(box[0], box[1]);
  if (label) ctx.fillText(label, X + 3, Y - 4);
  ctx.restore();
}
