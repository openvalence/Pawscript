// plot.js -- canvas drawing of any graph value over a time range, shared by the card sparklines, the
// inspector's big plot and the probe lane. Browser only (reads theme tokens). Up = out (pos 100), as the lanes.
import { scriptColumns, signalColumns, signalRange, visibleSpans } from './decimate.js';
import { cssVar } from '../../../ui/kit/color.js';
import { kindOf } from '../../timeline/kinds.js';

const cache = new Map();
/** A theme token's colour, cached until clearColors() (call it on a theme change). */
export function tok(name) {
  let c = cache.get(name);
  if (c == null) { c = cssVar(name) || '#888'; cache.set(name, c); }
  return c;
}
export const clearColors = () => cache.clear();
export const TYPE_COLOR = { script: 'sky', signal: 'green', spans: 'yellow', number: 'grey', any: 'violet' };
export const seriesHex = (key) => tok(`--series-${key || 'grey'}`);

/** Prepare a canvas for CSS size w x h at the device pixel ratio; returns its 2d context (transform set). */
export function fitCanvas(cv, w, h) {
  const d = window.devicePixelRatio || 1, W = Math.max(1, Math.round(w * d)), H = Math.max(1, Math.round(h * d));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/**
 * Draw `value` of `type` on ctx inside (0, 0, w, h) for times [t0, t1].
 * o: { color (css), dim (alpha), pad (px top/bottom), range ([lo, hi] for signals), fill (band alpha) }.
 */
export function drawValue(ctx, w, h, type, value, t0, t1, o = {}) {
  if (value == null || !(t1 > t0)) return;
  if ((type === 'signal') !== !!value.v) return;   // a value of another shape than `type`: draw nothing rather than throw
  const pad = o.pad ?? 3, color = o.color || seriesHex(TYPE_COLOR[type]);
  const X = (t) => ((t - t0) / (t1 - t0)) * w;
  ctx.save();
  ctx.globalAlpha = o.dim ?? 1;
  ctx.lineJoin = 'round';
  if (type === 'script') {
    const Y = (p) => pad + (1 - p / 100) * (h - 2 * pad);
    const cols = Math.max(1, Math.round(w));
    const r = scriptColumns(value, t0, t1, cols);
    ctx.strokeStyle = color; ctx.lineWidth = o.width ?? 1.25;
    ctx.beginPath();
    if (r.pts) {
      r.pts.forEach(([t, p], i) => (i ? ctx.lineTo(X(t), Y(p)) : ctx.moveTo(X(t), Y(p))));
      ctx.stroke();
      if (o.dots && r.pts.length < w / 4) { ctx.fillStyle = color; for (const [t, p] of r.pts) ctx.fillRect(X(t) - 1.5, Y(p) - 1.5, 3, 3); }
    } else band(ctx, r.min, r.max, Y, cols, w, color, o);
  } else if (type === 'signal') {
    const [lo, hi] = o.range || signalRange(value);
    const Y = (v) => pad + (1 - (v - lo) / (hi - lo || 1)) * (h - 2 * pad);
    const cols = Math.max(1, Math.round(w));
    const r = signalColumns(value, t0, t1, cols);
    band(ctx, r.min, r.max, Y, cols, w, color, o);
  } else if (type === 'spans') {
    const vis = visibleSpans(value, t0, t1);
    for (const s of vis) {
      const k = s.kind ? kindOf(s.kind) : null, c = k?.color || color;
      const x0 = X(s.t0), x1 = X(s.t1);
      if (s.t1 === s.t0) {
        ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(Math.round(x0) + 0.5, pad); ctx.lineTo(Math.round(x0) + 0.5, h - pad); ctx.stroke();
        ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x0, pad); ctx.lineTo(x0 + 3, pad + 3); ctx.lineTo(x0, pad + 6); ctx.lineTo(x0 - 3, pad + 3); ctx.fill();
      } else {
        ctx.fillStyle = c; ctx.globalAlpha = (o.dim ?? 1) * 0.28;
        ctx.fillRect(x0, pad, Math.max(1, x1 - x0), h - 2 * pad);
        ctx.globalAlpha = o.dim ?? 1;
        ctx.fillRect(x0, h - pad - 2, Math.max(1, x1 - x0), 2);
        if (o.labels && x1 - x0 > 40 && (s.label || s.kind)) {
          ctx.fillStyle = tok('--tx-mut'); ctx.font = '10px ' + tok('--font');
          ctx.fillText(String(s.label || s.kind).slice(0, Math.floor((x1 - x0) / 6)), Math.max(0, x0) + 3, pad + 10);
        }
      }
    }
  } else if (type === 'number') {
    ctx.fillStyle = tok('--tx-val'); ctx.font = '600 13px ' + tok('--mono'); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(fmtNum(value), w / 2, h / 2);
  }
  ctx.restore();
}

function band(ctx, min, max, Y, cols, w, color, o) {
  const sx = w / cols;
  // a translucent min/max area with its two edges: dense data reads as an envelope, smooth data as one line
  ctx.fillStyle = color;
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * 0.3;
  for (let c = 0; c < cols; c++) {
    const lo = min[c], hi = max[c];
    if (lo !== lo) continue;
    const y0 = Y(hi), y1 = Y(lo);
    ctx.fillRect(c * sx, y0, sx + 0.5, Math.max(1, y1 - y0));
  }
  ctx.globalAlpha = a;
  ctx.strokeStyle = color; ctx.lineWidth = o.width ?? 1.25;
  for (const edge of [max, min]) {
    ctx.beginPath();
    let pen = false;
    for (let c = 0; c < cols; c++) {
      const v = edge[c];
      if (v !== v) { pen = false; continue; }
      const x = (c + 0.5) * sx;
      if (!pen) { ctx.moveTo(x, Y(v)); pen = true; } else ctx.lineTo(x, Y(v));
    }
    ctx.stroke();
  }
}

export function fmtNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  return a >= 1000 ? Math.round(v).toLocaleString('en-US').replace(/,/g, ' ') : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
}

/** m:ss.t */
export function fmtT(ms) {
  if (!Number.isFinite(ms)) return '–';
  const s = Math.max(0, ms) / 1000, m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** A readout of a value at time t: 'pos 62', 'span climax', '0.41' ('' when unknown). */
export function readout(type, v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? fmtNum(v) : 'gap';
  if (typeof v === 'object') return v.kind || v.label || (v.t0 === v.t1 ? 'point' : 'span');
  return String(v);
}
