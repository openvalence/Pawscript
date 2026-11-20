// fusion-view.js -- how each tracked part feeds the fused stroke, over the video (paw-ufv; settings tracking.blobs.fusion,
// the dock's Fusion toggle). Shown while the shot's signal is 'fused' (lib/fusion.js). Per part: a ring sized by its
// weight there now (the fusion's per-window weights, cross-faded as fuseScene does), its points drawn bigger / fainter by
// weight (drawBlobsView o.weight), its share, and its motion on the stroke axis as an arrow, sign-aligned the way the
// fusion aligns it: parts that agree point the same way, a part pulling against the stroke points back. The pairs the
// fusion uses join their two parts (thicker = more say). The fused result: the weighted arrow at the weighted centre,
// with a 0..1 gauge of the fused value. paw-0sn8: the axis is the scene's stroke direction fusion read (info.dir: the stroke
// axis tool's, else the leading relationship's), drawn as a double arrow at the contact (between the two sides of that
// relationship), and each part's motion ACROSS it as a thin tick beside its along arrow (across motion is not stroke).
// Pure parts node-tested (test/tracking-fusion-view.test.mjs): fuseWeightsAt,
// partWeights, frameParts, partNear.
import { inHull } from '../video/roi.js';
import { MAX_SEM, sampleAt, anchoredPath } from './blobs.js';

const fin = (v) => typeof v === 'number' && v === v;

/** The fusion's candidate weights at t from a scene's info.windows [{t, t1, w: {id: share}}]: each window covering t
 *  counts with its triangular cross-fade (as fuseScene blends them) -> {id: weight} summing to 1 ({} = none). */
export function fuseWeightsAt(info, t) {
  const out = {}, ws = info?.windows || [];
  let tot = 0;
  for (const w of ws) {
    if (w.t > t) break;
    if (!(t <= w.t1)) continue;
    const half = (w.t1 - w.t) / 2 || 1, tri = 1 + 1e-3 - Math.abs(t - (w.t + half)) / half;
    if (!(tri > 0)) continue;
    for (const id in w.w) { const x = w.w[id] * tri; out[id] = (out[id] || 0) + x; tot += x; }
  }
  if (tot > 0) for (const id in out) out[id] /= tot;
  return out;
}

/**
 * Each part's say at t: {name: {w (share of the fused stroke, all parts sum to 1), sign (-1..1: how the fusion turns
 * its motion, a pair's second part counting against its first)}}. A single part's weight is its own; a pair's is split
 * between its two parts.
 */
export function partWeights(info, t) {
  const W = fuseWeightsAt(info, t), out = {};
  const add = (name, w, s) => { const o = out[name] || (out[name] = { w: 0, sign: 0 }); o.w += w; o.sign += w * s; };
  for (const c of info?.candidates || []) {
    const w = W[c.id];
    if (!(w > 0) || !c.parts?.length) continue;
    const s = c.sign < 0 ? -1 : 1;
    if (c.split?.length) for (const x of c.split) add(x.name, w * x.w, x.s);   // paw-iasp: a relationship's sides are bodies: each part by its say there
    else if (c.parts.length === 1) add(c.parts[0], w, s);
    else { add(c.parts[0], w / 2, s); add(c.parts[1], w / 2, -s); }
  }
  for (const k in out) out[k].sign = out[k].w > 0 ? out[k].sign / out[k].w : 0;
  return out;
}

/**
 * The pinned parts on frame i: [{name, c ([x, y] image space: the run's seed-anchored centre, sem_<name>_x / _y + camera,
 * else the members' anchored centre), hull (its members' hull, [] when the frame's points carry no pinned ids: a run read
 * back from a .pawruns file)}]. F = frameBodies of the frame; names = the run's pinned groups with a centre channel.
 */
export function frameParts(fr, i, run, F) {
  const out = [], seen = new Set();
  for (const b of F?.S || []) if (b) { out.push({ name: b.name, c: b.c, hull: b.hull || [] }); seen.add(b.name); }
  const ch = run?.channels || {};
  for (const k in ch) {
    if (!k.startsWith('sem_') || !k.endsWith('_x')) continue;
    const name = k.slice(4, -2);
    if (seen.has(name) || !ch['sem_' + name + '_y']) continue;
    const P = anchoredPath(fr, run, 'sem_' + name), x = P?.x[i], y = P?.y[i];
    if (fin(x) && fin(y)) out.push({ name, c: [x, y], hull: [] });
  }
  for (const p of out) if (!p.c) { const P = anchoredPath(fr, run, 'sem_' + p.name), x = P?.x[i], y = P?.y[i]; if (fin(x) && fin(y)) p.c = [x, y]; }
  return out;
}

/** The pinned part under (x, y) (px; env {map, unmap}) of parts (frameParts): inside its hull, else its centre within r
 *  px (the nearest) -> its name | null. */
export function partNear(parts, env, x, y, r = 24) {
  const S = parts || [], [nx, ny] = env.unmap(x, y);
  for (const b of S) if (b && b.hull?.length >= 3 && inHull(b.hull, nx, ny)) return b.name;
  let best = r * r, name = null;
  for (const b of S) {
    if (!b?.c) continue;
    const [X, Y] = env.map(b.c[0], b.c[1]), d = (X - x) ** 2 + (Y - y) ** 2;
    if (d <= best) { best = d; name = b.name; }
  }
  return name;
}

/** The weights by pinned id for drawBlobsView (o.weight[id] 0..1, relative to the strongest part), filled in place. */
export function weightById(P, sn, out) {
  out.fill(0);
  let mx = 0;
  for (const k in P) mx = Math.max(mx, P[k].w);
  if (!(mx > 0)) return null;
  for (let id = 1; id <= MAX_SEM; id++) { const p = P[sn[id - 1]]; out[id] = p ? p.w / mx : 0; }
  return out;
}

function arrow(ctx, x0, y0, x1, y1, head = 7) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  if (L < 1) return;
  const ux = (x1 - x0) / L, uy = (y1 - y0) / L, h = Math.min(head, L / 2);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - ux * h - uy * h * 0.55, y1 - uy * h + ux * h * 0.55); ctx.lineTo(x1 - ux * h + uy * h * 0.55, y1 - uy * h - ux * h * 0.55); ctx.closePath(); ctx.fill();
}
const UNDER = 'rgba(0, 0, 0, .7)';
/** Stroke the current path dark and wide, then in colour (legible on fur and bright skin). */
function duo(ctx, w, col) { ctx.strokeStyle = UNDER; ctx.lineWidth = w + 2.5; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); }
function text(ctx, s, x, y, col) { ctx.lineWidth = 3; ctx.strokeStyle = UNDER; ctx.strokeText(s, x, y); ctx.fillStyle = col; ctx.fillText(s, x, y); }

const TRAVEL_S = 0.3, VEL_MS = 120;   // arrows: 0.3 s of travel; velocity over the last 120 ms

/**
 * Draw the contribution view. parts = frameParts of the frame, P = partWeights at t,
 * o = {run, info, t, u ([ux, uy] stroke axis, square units: dock.js axisUnit), aspect, color(name) -> paint, ink (accent),
 * text (label ink), alpha, hidden(name) -> true: a part the dock hides (not drawn), label (the gauge's own 'fused'
 * label: off when the blobs axis already tags the lane's value)}. Allocates nothing per point.
 */
export function drawFusion(ctx, env, parts, P, o) {
  const { run, info, t, aspect = 1, color, ink, alpha = 1, hidden = () => false, label = true } = o, ch = run?.channels || {}, u = info?.dir?.u || o.u, n = [-u[1], u[0]];
  let mx = 0;
  for (const k in P) mx = Math.max(mx, P[k].w);
  if (!(mx > 0)) return;
  const byName = {};
  for (const b of parts || []) if (b?.c && !hidden(b.name)) byName[b.name] = b;
  ctx.save(); ctx.lineCap = ctx.lineJoin = 'round'; ctx.font = '600 11px Chakra Petch, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  // pairs first (under the rings): a line between the two parts, its width the pair's say
  const W = fuseWeightsAt(info, t);
  let pmx = 0;
  for (const c of info?.candidates || []) if (c.parts?.length === 2) pmx = Math.max(pmx, W[c.id] || 0);
  for (const c of info?.candidates || []) {
    const w = W[c.id] || 0, a = byName[c.parts?.[0]], b = byName[c.parts?.[1]];
    if (c.parts?.length !== 2 || !a || !b || !(w > 0.02 * pmx)) continue;
    const [x0, y0] = env.map(a.c[0], a.c[1]), [x1, y1] = env.map(b.c[0], b.c[1]);
    ctx.globalAlpha = alpha * (0.25 + 0.5 * (w / pmx)); ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); duo(ctx, 1 + 4 * (w / pmx), ink); ctx.setLineDash([]);
  }
  // parts: ring by weight, share, sign-aligned motion on the axis; the fused arrow is their weighted mean
  let sx = 0, sy = 0, sw = 0, sa = 0;
  for (const name in P) {
    const p = P[name], b = byName[name];
    if (!b || !(p.w > 0)) continue;
    const wn = p.w / mx, [cx, cy] = env.map(b.c[0], b.c[1]), col = color(name);
    const X = ch[`sem_${name}_x`], Y = ch[`sem_${name}_y`], x1 = sampleAt(X, t), y1 = sampleAt(Y, t), x0 = sampleAt(X, t - VEL_MS), y0 = sampleAt(Y, t - VEL_MS);
    const v = fin(x1) && fin(x0) && fin(y1) && fin(y0) ? (((x1 - x0) * aspect * u[0] + (y1 - y0) * u[1]) / (VEL_MS / 1000)) * p.sign : NaN;
    ctx.globalAlpha = alpha * (0.45 + 0.55 * wn);
    ctx.beginPath(); ctx.arc(cx, cy, 7 + 15 * wn, 0, 2 * Math.PI); duo(ctx, 1.5 + 2 * wn, col);
    if (fin(v)) {
      const [ex, ey] = env.map(b.c[0] + (u[0] / aspect) * v * TRAVEL_S, b.c[1] + u[1] * v * TRAVEL_S);
      ctx.fillStyle = col; ctx.strokeStyle = UNDER; ctx.lineWidth = 2 + 2.5 * wn + 2.5; arrow(ctx, cx, cy, ex, ey, 8);
      ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 2 + 2.5 * wn; arrow(ctx, cx, cy, ex, ey, 7);
      sa += p.w * v;
      const vn = ((x1 - x0) * aspect * n[0] + (y1 - y0) * n[1]) / (VEL_MS / 1000);   // paw-0sn8: its motion across the stroke direction
      if (Math.abs(vn) * TRAVEL_S > 0.004) {
        const [nx, ny] = env.map(b.c[0] + (n[0] / aspect) * vn * TRAVEL_S, b.c[1] + n[1] * vn * TRAVEL_S);
        ctx.globalAlpha = alpha * 0.7; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(nx, ny); duo(ctx, 1.5, o.text || ink);
      }
    }
    ctx.globalAlpha = alpha;
    text(ctx, `${Math.round(p.w * 100)}%`, cx + 9 + 15 * wn, cy - 9 - 6 * wn, col);
    sx += p.w * b.c[0]; sy += p.w * b.c[1]; sw += p.w;
  }
  // paw-0sn8: the scene's stroke direction at the contact: a double arrow through the middle of the leading relationship's sides
  const cOf = (L) => { let x = 0, y = 0, k = 0; for (const nm of L || []) { const b = byName[nm]; if (b) { x += b.c[0]; y += b.c[1]; k++; } } return k ? [x / k, y / k] : null; };
  const ca = cOf(info?.dir?.contact?.a), cb = cOf(info?.dir?.contact?.b), cc = ca && cb ? [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2] : ca || cb;
  if (cc && info?.dir) {
    const [d0x, d0y] = env.map(cc[0] - (u[0] / aspect) * 0.07, cc[1] - u[1] * 0.07), [d1x, d1y] = env.map(cc[0] + (u[0] / aspect) * 0.07, cc[1] + u[1] * 0.07), [mx, my] = env.map(cc[0], cc[1]);
    ctx.globalAlpha = alpha; ctx.fillStyle = ink; ctx.strokeStyle = UNDER; ctx.lineWidth = 5.5; arrow(ctx, mx, my, d1x, d1y, 10); arrow(ctx, mx, my, d0x, d0y, 10);
    ctx.strokeStyle = ctx.fillStyle = ink; ctx.lineWidth = 3; arrow(ctx, mx, my, d1x, d1y, 9); arrow(ctx, mx, my, d0x, d0y, 9);
    if (label) text(ctx, 'stroke', d1x + 6, d1y, ink);
  }
  // the fused result at the weighted centre: its arrow (the parts' weighted motion) and the fused value 0..1
  if (sw > 0) {
    const fx = sx / sw, fy = sy / sw, [cx, cy] = env.map(fx, fy), va = sa / sw;
    const [ax0, ay0] = env.map(fx - (u[0] / aspect) * 0.12, fy - u[1] * 0.12), [ax1, ay1] = env.map(fx + (u[0] / aspect) * 0.12, fy + u[1] * 0.12);
    ctx.globalAlpha = alpha * 0.8; ctx.setLineDash([8, 4]); ctx.beginPath(); ctx.moveTo(ax0, ay0); ctx.lineTo(ax1, ay1); duo(ctx, 1.5, ink); ctx.setLineDash([]);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 2 * Math.PI); ctx.fill();
    if (fin(va)) {
      const [ex, ey] = env.map(fx + (u[0] / aspect) * va * TRAVEL_S, fy + u[1] * va * TRAVEL_S);
      ctx.fillStyle = ink; ctx.strokeStyle = UNDER; ctx.lineWidth = 7.5; arrow(ctx, cx, cy, ex, ey, 11);
      ctx.strokeStyle = ctx.fillStyle = ink; ctx.lineWidth = 5; arrow(ctx, cx, cy, ex, ey, 10);
    }
    // gauge: a short scale along the axis beside the centre, the fused value as a dot on it (0 = one end, 1 = the other)
    const fv = sampleAt(ch.fused, t), D = Math.hypot(ax1 - ax0, ay1 - ay0) || 1, px = (ax1 - ax0) / D, py = (ay1 - ay0) / D, off = 26, L = 46;   // px: the axis on screen (zoom, rotation, flips)
    const gx = cx - py * off, gy = cy + px * off, g0x = gx - px * L / 2, g0y = gy - py * L / 2, g1x = gx + px * L / 2, g1y = gy + py * L / 2;
    ctx.beginPath(); ctx.moveTo(g0x, g0y); ctx.lineTo(g1x, g1y); duo(ctx, 3, o.text || ink);
    if (fin(fv)) { const f = Math.max(0, Math.min(1, fv)); ctx.beginPath(); ctx.arc(g0x + (g1x - g0x) * f, g0y + (g1y - g0y) * f, 5, 0, 2 * Math.PI); ctx.fillStyle = ink; ctx.fill(); ctx.strokeStyle = UNDER; ctx.lineWidth = 1.5; ctx.stroke(); }
    if (label) text(ctx, fin(fv) ? `fused ${fv.toFixed(2)}` : 'fused', g1x + 6, g1y, ink);
  }
  ctx.restore();
}

/**
 * Pick-a-pair mode (TrackingOverlay, tr.pairPick): every pickable part ringed thin, the one under the pointer thick
 * with what a click makes it ("moving part" / "moves against"), the first pick solid and tagged "1 moving", a dashed
 * line from it to the hovered one. parts = frameParts; o = {first (part name | ''), hover (part name | null), color(name)
 * -> paint, label(name) -> text}.
 */
export function drawPairPick(ctx, env, parts, o) {
  const { first = '', hover = null, color, label = (n) => n } = o;
  ctx.save(); ctx.lineCap = ctx.lineJoin = 'round'; ctx.font = '600 12px Chakra Petch, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const at = {};
  for (const p of parts || []) if (p?.c) at[p.name] = env.map(p.c[0], p.c[1]);
  if (first && hover && hover !== first && at[first] && at[hover]) {
    ctx.globalAlpha = 0.9; ctx.setLineDash([7, 5]); ctx.beginPath(); ctx.moveTo(...at[first]); ctx.lineTo(...at[hover]); duo(ctx, 2.5, color(hover)); ctx.setLineDash([]);
  }
  for (const p of parts || []) {
    const q = at[p.name];
    if (!q) continue;
    const on = p.name === hover, one = p.name === first, col = color(p.name);
    ctx.globalAlpha = on || one ? 1 : 0.75;
    ctx.beginPath(); ctx.arc(q[0], q[1], on || one ? 16 : 11, 0, 2 * Math.PI); duo(ctx, on || one ? 3 : 1.5, col);
    if (one) { ctx.globalAlpha = 0.35; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; }
    if (on || one) text(ctx, `${label(p.name)} · ${one ? '1 moving' : first ? 'moves against' : 'moving part'}`, q[0] + 20, q[1] - 14, col);
  }
  ctx.restore();
}
