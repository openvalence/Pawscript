// draw.js -- canvas helpers every timeline lane uses, so they all look and align alike.
//
// Pixel rule (paw-ef73.7, the owner: "every pixel interpolated to the motion"): a time t is at X(view, w, t), the ONE
// time -> x mapping of every row, overlay and playhead, continuous (sub-pixel, never rounded, so things at one time move
// together while panning, zooming or playing). A line at t is centred on X (the playhead, cut and scene lines: fillRect(X - lw / 2, y,
// lw, h)); older grid strokes sit at X + 0.5; a block [t0, t1) fills X(t0) .. X(t1). Frame N starts at frameTime(N, grid) (lane.js: the player clock's start of frame N in integer ms; paw-kxz4), the ms
// the player, the cuts and every stored frame time use; the frame shown at time t is frameAt(t). w is the lane's CSS
// width (every row has the same content width), the context is scaled for devicePixelRatio.
import { msToX } from '../../lib/lane.js';
import { cssVar } from '../../ui/kit/color.js';
import { onThemeChange } from '../../ui/kit/tokens.js';
import { kindOf } from './kinds.js';

export const X = (view, w, t) => msToX(view, w, t);
export { frameTime, frameAt, frameStartOf } from '../../lib/lane.js';

/** Size the canvas backing store for w x h CSS px at the device ratio; returns a context in CSS px, or null. */
export function fitCanvas(canvas, w, h) {
  if (!canvas || !(w > 0) || !(h > 0)) return null;
  const d = window.devicePixelRatio || 1, W = Math.round(w * d), H = Math.round(h * d);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return ctx;
}

// Theme colours, read once and re-read on a theme switch.
let T = null;
if (typeof document !== 'undefined') onThemeChange(() => { T = null; });
export function theme() {
  if (T) return T;
  const v = (n, f) => cssVar(n) || f;
  return (T = {
    bg: v('--bg-sunken', '#040507'), raised: v('--bg-raised', '#0D0F13'), card: v('--bg-card', '#111318'),
    line0: v('--line-0', '#121419'), line1: v('--line-1', '#1D2026'), line2: v('--line-2', '#272B31'), line3: v('--line-3', '#33373E'), line4: v('--line-4', '#454A54'),
    txHi: v('--tx-hi', '#ECEFF4'), tx: v('--tx', '#C3C8D1'), txVal: v('--tx-val', '#A8AEB9'), txMut: v('--tx-mut', '#848A96'),   // no --tx-ghost here: it is for disabled glyphs, never canvas text
    reality: v('--reality', '#4DA6FF'), intent: v('--intent', '#A78BFA'), highlight: v('--highlight', '#FF5CB3'),
    ok: v('--ok', '#3DD68C'), warn: v('--warn', '#F5B94D'), warnInk: v('--warn-ink', '#F5B94D'), bad: v('--bad', '#FF4757'),
    mono: v('--mono', 'monospace'), font: v('--font', 'system-ui'),
    // the picture's surroundings (a thumbnail's label and its plate, a black band): the same in every theme (paw-p8o2)
    onMedia: v('--on-media', '#fff'), mediaBg: v('--media-bg', '#000'), mediaScrim: v('--media-scrim', 'rgba(0, 0, 0, .6)'),
    // lane grid lines: --line-1, but --line-0 in the contrast theme (its line ramp runs brighter)
    grid: document.documentElement.dataset.theme === 'contrast' ? v('--line-0', '#121419') : v('--line-1', '#1D2026'),
    series: (key, f) => v('--series-' + key, f),
  });
}
export const font = (px, mono = false, weight = 400) => `${weight} ${px}px ${mono ? theme().mono : theme().font}`;

/** The document range selection, shaded the way the lanes shade it (lib/lane.js drawLane). */
export function drawRange(ctx, view, w, h, range) {
  if (!range) return;
  const x0 = Math.max(0, X(view, w, range.t0)), x1 = Math.min(w, X(view, w, range.t1));
  ctx.fillStyle = theme().reality;   // alpha, not a parsed hex: any token format keeps the theme's hue
  if (x1 > x0) { ctx.globalAlpha = 0.07; ctx.fillRect(x0, 0, x1 - x0, h); }
  ctx.globalAlpha = 0.6;
  for (const t of [range.t0, range.t1]) { const x = X(view, w, t); if (x >= 0 && x <= w) ctx.fillRect(x, 0, 1, h); }
  ctx.globalAlpha = 1;
}

/** A running tracker job over [t0, t1]: a sweep to frac in `color` across y0..y0+bh, its leading edge solid, and (text)
 *  the progress words on a backing at the visible start of the span. */
export function drawProgress(ctx, view, w, { t0, t1, frac, text }, color, y0, bh) {
  const x0 = X(view, w, t0), x1 = X(view, w, t1), xf = X(view, w, t0 + frac * (t1 - t0));
  if (x1 < 0 || x0 > w) return;
  const a = Math.max(0, x0), b = Math.min(w, xf);
  ctx.fillStyle = color;
  if (b > a) { ctx.globalAlpha = 0.35; ctx.fillRect(a, y0, b - a, bh); ctx.globalAlpha = 1; }
  if (xf >= 0 && xf <= w) ctx.fillRect(xf - 1, y0, 2, bh);
  if (!text) return;
  ctx.font = font(10, true); ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width, tx = Math.min(Math.max(a, 0) + 4, Math.max(0, Math.min(w, x1) - tw - 8)), ty = y0 + bh / 2;
  ctx.fillStyle = theme().bg; ctx.globalAlpha = 0.8; ctx.fillRect(tx - 3, ty - 7, tw + 6, 14); ctx.globalAlpha = 1;
  ctx.fillStyle = theme().txHi; ctx.fillText(text, tx, ty + 0.5);
}

/** A lane's empty-state line: muted (a hint is text, so --tx-mut, 4.5:1), vertically centred. */
export function drawHint(ctx, h, text, x = 8) {
  ctx.font = font(11); ctx.fillStyle = theme().txMut; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, Math.round(h / 2) + 0.5);
  ctx.textBaseline = 'alphabetic';
}

/** Text cut to maxW with an ellipsis ('' if not even one character fits). */
export function ellipsize(ctx, text, maxW) {
  if (!text || maxW <= 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1; }
  return lo ? text.slice(0, lo) + '…' : '';
}

// Kind icons: 16x16 stroke paths (kinds.js) drawn at any size.
const paths = new Map();
export function drawKindIcon(ctx, kind, x, y, size, color, lineWidth = 1.6) {
  const k = kindOf(kind);
  let p = paths.get(k.id);
  if (!p) paths.set(k.id, (p = new Path2D(k.icon)));
  ctx.save();
  ctx.translate(x, y); ctx.scale(size / 16, size / 16);
  ctx.strokeStyle = color; ctx.lineWidth = (lineWidth * 16) / size; ctx.lineJoin = ctx.lineCap = 'round';
  if (k.dash) ctx.setLineDash([3, 2.5]);
  ctx.stroke(p);
  ctx.restore();
}

/** Scene cuts as thin full-height lines (dim), the shared look for cut markers in strips. */
export function drawCuts(ctx, view, w, h, cuts, color = 'rgba(236,239,244,.16)') {
  ctx.fillStyle = color;
  for (const t of cuts) { const x = X(view, w, t); if (x >= 0 && x <= w) ctx.fillRect(x, 0, 1, h); }
}
/** A boundary's grip (the pill p: scenes-hit.js pillOf). paw-p2p0 (owner: "camera moves and cuts are not so easy to
 *  distinguish"): a cut's is filled (col, a dark rim), a camera move's the same shape hollow (a 1 px outline in col on the
 *  row's background, col defaulting to the muted ink). Filled = cut, hollow = move. */
export function drawGrip(ctx, p, { hollow = false, col } = {}) {
  const T = theme();
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(p.x, p.y, p.w, p.h, 1.5); else ctx.rect(p.x, p.y, p.w, p.h);
  if (!hollow) { ctx.fillStyle = col ?? '#C9CDD4'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 1; ctx.stroke(); return; }
  ctx.fillStyle = T.bg; ctx.fill();
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1, 1.5); else ctx.rect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
  ctx.strokeStyle = col ?? T.txMut; ctx.lineWidth = 1; ctx.stroke();
}
