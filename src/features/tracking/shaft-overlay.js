// shaft-overlay.js -- the shaft on the video (paw-azd; lib/shaft.js shaftOverlay): the visible shaft as measured (a
// capsule of the shaft's width from the base point to the entry edge; dashed = the points fallback), a tick at the base,
// a bar at the entry edge, and the gauge "in 62 %" beside the entry, placed clear of the blobs labels (blobs.js F.labels
// rects). Faint where the measure is not confident. Canvas only; the gauge rect it returns is what a click hits.
// paw-4c48.7: base / entry come from lib/shaft.js shaftGeom (along the penis group, interpolated by time); a frame whose
// reading is unsure or whose geometry is held through a dropout is drawn faint and dashed, its gauge says so.

import { plate } from './plate.js';

const FONT = '600 11px system-ui, sans-serif';
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The gauge's text: 'in 62 %' (+ ' · knot in' / ' · knot at'). */

export function gaugeText(s) {
  const k = s.knot === 1 ? ' · knot in' : s.knot === 0.5 ? ' · knot at' : '';
  const q = s.state === 'held' ? ' · held' : s.state === 'low' ? ' · unsure' : '';
  return `in ${Math.round(100 * s.in)} %${k}${q}`;
}

/** Draw shaft s ({base, entry, w, in, conf, knot, source}, normalized) with E.map; color / ink / back (paint strings);
 *  avoid = label rects to stay clear of. -> the gauge rect {x, y, w, h} (env px). */
export function drawShaft(ctx, E, s, { color, ink, back = plate(.78), avoid = [] } = {}) {
  const [bx, by] = E.map(s.base[0], s.base[1]), [ex, ey] = E.map(s.entry[0], s.entry[1]);
  const [wx, wy] = E.map(s.base[0], s.base[1] + (s.w || 0));
  const dx = ex - bx, dy = ey - by, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const h = Math.max(2, Math.hypot(wx - bx, wy - by) / 2), ang = Math.atan2(uy, ux);
  ctx.save();
  const sure = s.state ? s.state === 'seen' : s.conf >= 0.5;
  ctx.globalAlpha = sure ? 0.95 : 0.4;
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(s.source === 'sam' && sure ? [] : [4, 3]);
  ctx.beginPath();
  ctx.moveTo(bx + nx * h, by + ny * h); ctx.lineTo(ex + nx * h, ey + ny * h);
  ctx.arc(ex, ey, h, ang + Math.PI / 2, ang - Math.PI / 2, true);
  ctx.lineTo(bx - nx * h, by - ny * h);
  ctx.stroke();
  ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.setLineDash([]);
  const bar = (x, y, r, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x + nx * r, y + ny * r); ctx.lineTo(x - nx * r, y - ny * r); ctx.stroke(); };
  bar(bx, by, h + 4, 1.5);
  bar(ex, ey, h + 6, 3);
  // the gauge: beside the entry edge, the first spot clear of the labels
  ctx.font = FONT;
  const text = gaugeText(s), tw = Math.ceil(ctx.measureText(text).width) + 10, th = 17;
  const spots = [[nx, ny], [-nx, -ny], [ux, uy], [-ux, -uy]].map(([ax, ay]) => {
    const cx = ex + ax * (h + 10 + tw / 2 * Math.abs(ax)), cy = ey + ay * (h + 10 + th / 2 * Math.abs(ay));
    return { x: Math.round(cx - tw / 2), y: Math.round(cy - th / 2), w: tw, h: th };
  });
  const r = spots.find((q) => !avoid.some((a) => hit(q, a))) || spots[0];
  ctx.globalAlpha = sure ? 1 : 0.55;
  ctx.fillStyle = back; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  ctx.fillStyle = ink; ctx.textBaseline = 'middle'; ctx.fillText(text, r.x + 5, r.y + r.h / 2 + 0.5);
  ctx.restore();
  return r;
}
