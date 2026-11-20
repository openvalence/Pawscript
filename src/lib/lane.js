// lane.js -- the lane's view math and canvas renderer. Pure except drawLane, which only needs a 2D context.
// A view is {start, span} in ms. Time arrays (layer.t) are ascending numbers (Array or Float64Array);
// values are 0..1 (NaN = no value). Only the visible slice is ever touched, so 100k samples stay cheap.

import { rational, TOL_MS } from '../features/video/frames.js';
import { thin, textW, fitText } from '../features/timeline/lod.js';

export const MIN_SPAN = 200;

/** paw-g56v: the view may pan half a view past either end (time 0 / the end can sit mid-lane: the loop's join, the last
 *  points against the first); the span never exceeds the video. Outside 0..dur every row shows the out-of-range background. */
export function clampView(v, dur) {
  const max = Math.max(dur, MIN_SPAN);
  const span = Math.min(max, Math.max(MIN_SPAN, v.span));
  return { start: Math.min(max - span / 2, Math.max(-span / 2, v.start)), span };
}
/** Zoom by `factor` (<1 in) keeping the time under the cursor where it is. Zooming out never shows more out-of-range than
 *  the view already did, so a view inside the video zooms out to exactly 0..dur (only a pan goes past the ends). */
export function zoomAt(v, anchorMs, factor, dur) {
  const span = v.span * factor, f = (anchorMs - v.start) / v.span;
  let start = anchorMs - f * span;
  if (factor > 1) { const lo = Math.min(0, v.start), hi = Math.max(dur, v.start + v.span); start = Math.max(lo, Math.min(hi - span, start)); }
  return clampView({ start, span }, dur);
}
export const panBy = (v, dxPx, wPx, dur) => clampView({ start: v.start - (dxPx / wPx) * v.span, span: v.span }, dur);
// ---- the frame grid (paw-kxz4): ONE grid, the player's clock (frames.js makeClock: the video's real frames: an exact rational
// rate, or the file's own frame table when its frames are not where the probed rate puts them, e.g. a first frame 66 ms in and a
// dropped frame: an owner clip whose pictures sat up to 3 frames off n x 1000 / fps). `grid` is that clock, or a frame
// length in ms (a CFR clock from 0: tests, no video); 0 / null = no grid. Nothing here counts frames as n x frameMs any more.
let gridMemo = [NaN, null];
const cfrOf = (ms) => (gridMemo[0] === ms ? gridMemo[1] : (gridMemo = [ms, cfrClock(ms)])[1]);
function cfrClock(ms) {
  const r = rational(1000 / ms);
  return r ? { frameAt: (t) => Math.floor(((t + TOL_MS) * r.num) / (1000 * r.den)), timeOf: (n) => (n * 1000 * r.den) / r.num }
    : { frameAt: (t) => Math.floor((t + TOL_MS) / ms), timeOf: (n) => n * ms };
}
/** A grid's (average) frame length in ms, 0 without one. */
export const frameLen = (grid) => (grid && typeof grid === 'object' ? grid.frameMs : grid > 0 ? grid : 0);
/** The clock of a grid (null without one). */
export const clockOf = (grid) => (grid && typeof grid === 'object' ? grid : grid > 0 ? cfrOf(grid) : null);
/** Where frame n starts (integer ms, as stored: cuts, edges, the player's snap). Always inside frame n (frameAt below: the clock
 *  accepts TOL_MS early, more than the rounding). Past the clock's last frame: its end, then whole frames of its average length. */
export const frameTime = (n, grid) => Math.round(frameStart(n, grid));
/** Where frame n starts, unrounded (the clock's own time: exact rational / table). */
export function frameStart(n, grid) {
  const c = clockOf(grid);
  return c.kind === 'table' && n > c.count - 1 ? c.endOf(c.count - 1) + (n - c.count) * c.frameMs : c.timeOf(n);
}
/** A time inside frame n at fraction frac (0 <= frac < 1) of ITS span on the clock: for anything measured per frame at a sub-frame
 *  position (paw-kxz4: a point keeps its place in the real frame it was measured in, on any clock). Points are stored as plain
 *  ms and never snapped by the frame grid; the sidecar dates its samples by the file's pts, already on the clock. */
export const timeInFrame = (n, frac, grid) => frameStart(n, grid) + frac * (frameStart(n + 1, grid) - frameStart(n, grid));
/** The frame that contains time t: the player clock's own rule (TOL_MS early accepted), so the ruler, the grey frame cursor, the
 *  hover tip and snapping name the frame the picture shows (paw-bf4o). Not clamped to the video's frames. */
export function frameAt(t, grid) {
  const c = clockOf(grid);
  if (c?.kind === 'table' && t >= c.endOf(c.count - 1) - TOL_MS) return c.count + Math.floor((t + TOL_MS - c.endOf(c.count - 1)) / c.frameMs);
  return c.kind === 'cfr' ? Math.floor(((t - (c.t0 || 0) + TOL_MS) * c.num) / (1000 * c.den)) : c.frameAt(t);
}
/** paw-ef73.14: where structure lands (cuts, scene / shot / loop edges, chapters, bookmarks, ranges, spans): the start of
 *  the frame containing t; no grid: t rounded to ms. */
export const frameStartOf = (t, grid) => (clockOf(grid) ? frameTime(frameAt(t, grid), grid) : Math.round(t));
/** The player's grid: its clock (no video: the default 30 fps clock). */
export const gridOf = (p) => p?.clock || p?.frameMs || 0;
/** Where structure at the playhead lands: the start of the frame on screen (the player's own frame index: its timeMs is
 *  the video's presentation time, which can sit a hair under the frame's start), wherever the playhead rests. */
export const playheadFrameStart = (p) => (Number.isInteger(p?.frame) && typeof p.timeOfFrame === 'function' && p.frameMs > 0 && !p.playing ? Math.round(p.timeOfFrame(p.frame)) : frameStartOf(p?.timeMs ?? 0, gridOf(p)));

/** The out-of-range parts of a view in % of its width (paw-g56v): before 0 = [0, pre), past the end = [post, 100]. */
export function oobBands(v, dur) {
  if (!(dur > 0) || !(v?.span > 0)) return { pre: 0, post: 100 };
  const pct = (t) => Math.max(0, Math.min(100, ((t - v.start) / v.span) * 100));
  return { pre: pct(0), post: pct(dur) };
}
export const xToMs = (v, w, x) => v.start + (x / w) * v.span;
export const msToX = (v, w, t) => ((t - v.start) / v.span) * w;
/** Where the playhead is drawn (paw-ef73.7): moving smoothly with the clock while playing, with the pointer during a scrub
 *  (the unsnapped scrubTime), else where it rests (playheadMs: between frames after a smooth scrub, else the frame's). */
export const headMs = (p) => (p?.playing && typeof p.now === 'function' ? p.now() : p?.scrubTime ?? p?.playheadMs ?? p?.timeMs ?? 0);
/** While playing: if the playhead left the view, scroll so it sits 10% in. */
export const followView = (v, t, dur) => (t < v.start || t > v.start + v.span ? clampView({ start: Math.max(0, Math.min(dur - v.span, t - v.span * 0.1)), span: v.span }, dur) : v);   // never into the out-of-range by itself

/** First index i with a[i] >= x. */
export function lowerBound(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return lo;
}
/** [i0, i1) covering [a, b] plus one neighbour each side, so lines run off the edge. */
export function visibleSlice(t, a, b) {
  return [Math.max(0, lowerBound(t, a) - 1), Math.min(t.length, lowerBound(t, b) + 1)];
}

/** Per-pixel-column min/max of v[i0..i1) (NaN-skipping). Returns {min, max} Float32Arrays, NaN where a column is empty. */
export function envelope(t, v, i0, i1, view, w) {
  const min = new Float32Array(w).fill(NaN), max = new Float32Array(w).fill(NaN);
  for (let i = i0; i < i1; i++) {
    const y = v[i];
    if (y !== y) continue;
    const c = Math.floor(msToX(view, w, t[i]));
    if (c < 0 || c >= w) continue;
    if (!(y >= min[c])) min[c] = y;
    if (!(y <= max[c])) max[c] = y;
  }
  return { min, max };
}

const STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000];
/** A "nice" tick step (ms) so ticks are at least minPx apart. */
export const tickStep = (span, w, minPx = 80) => STEPS.find((s) => (s / span) * w >= minPx) ?? STEPS[STEPS.length - 1];

const cssVar = (name, fallback) => (typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback : fallback);

/**
 * layers: [{color, t, v, pat, ppos, dim, ref, lw?, alpha?, dash?}] (lw/alpha/dash: the raw signal's line width,
 * opacity and dash; default 1.25 / 1 / solid); o: {playhead, range:{start,end}|null,
 * marks:[{t,label,color,alpha?}], bands:[{t0,t1,label,color}] (spans: idle/carry/...), confidence:{t,v,color}|null}. NaN values are gaps: a line never crosses them.
 * w/h are CSS px; the caller has set the context transform for devicePixelRatio.
 */
/** y (CSS px) of a 0..1 value in a drawLane lane of height h. */
export const laneY = (h, x) => 14 + (1 - x) * (h - 26);
// paw-unuy: o.bare = a transparent layer over another lane (the Track tab's combined lane: the axis lane draws the background, grid,
// range and playhead); o.y = that lane's 0..1 -> y mapping, so the traces sit on its points
export function drawLane(ctx, w, h, view, layers, o) {
  const padT = 14, padB = 12, Y = o.y || ((x) => laneY(h, x));
  ctx.clearRect(0, 0, w, h);
  if (!o.bare) drawGround(ctx, w, h, view, o, Y);
  drawLayers(ctx, w, h, view, layers, o, Y, padT, padB);
  if (o.bare) return;
  const px = msToX(view, w, o.playhead);
  if (px >= 0 && px <= w) { ctx.fillStyle = cssVar('--highlight', '#FF5CB3'); ctx.fillRect(Math.round(px), 0, 1, h); }
}
function drawGround(ctx, w, h, view, o, Y) {
  ctx.fillStyle = cssVar('--bg-sunken', '#040507'); ctx.fillRect(0, 0, w, h);
  if (o.range) {
    const x0 = Math.max(0, msToX(view, w, o.range.start)), x1 = Math.min(w, msToX(view, w, o.range.end));
    if (x1 > x0) { ctx.fillStyle = 'rgba(77,166,255,.07)'; ctx.fillRect(x0, 0, x1 - x0, h); }
    ctx.fillStyle = 'rgba(77,166,255,.6)';
    for (const t of [o.range.start, o.range.end]) { const x = msToX(view, w, t); if (x >= 0 && x <= w) ctx.fillRect(x, 0, 1, h); }
  }
  // grid: pos 0/25/50/75/100 and time ticks
  ctx.lineWidth = 1; ctx.strokeStyle = cssVar('--line-1', '#1D2026');
  ctx.beginPath();
  for (const g of [0, 0.25, 0.5, 0.75, 1]) { const y = Math.round(Y(g)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
  const step = tickStep(view.span, w), labels = [];
  for (let t = Math.ceil(view.start / step) * step; t <= view.start + view.span; t += step) {
    const x = msToX(view, w, t) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); labels.push([x, t]);
  }
  ctx.stroke();
  ctx.fillStyle = cssVar('--tx-ghost', '#5C626C'); ctx.font = '10px ' + cssVar('--mono', 'monospace');
  for (const [x, t] of labels) if (t >= 0 && !(t > o.dur)) ctx.fillText(step >= 1000 ? t / 1000 + 's' : t + 'ms', x + 3, 10);   // no labels out of range (paw-g56v)
}
/** paw-bg90: the marks' labels by their own width (lod.js thin, 4 px apart): a forced mark's (the selected run's seed) always,
 *  the rest left to right while they do not overlap. -> [[mark, x, labelled]] in the marks' order. */
export function markLabels(ctx, marks, xOf) {
  const xs = marks.map((m) => xOf(m.t)), keep = thin(marks.map((m, i) => ({ x0: xs[i] + 3, x1: xs[i] + 3 + textW(ctx, m.label || ''), force: !!m.force, skip: !m.label })), 4);
  return marks.map((m, i) => [m, xs[i], keep[i]]);
}
function drawLayers(ctx, w, h, view, layers, o, Y, padT, padB) {
  const a = view.start, b = view.start + view.span;
  // spans as labelled translucent bands behind the lines
  ctx.font = '10px ' + cssVar('--mono', 'monospace');
  for (const bd of o.bands || []) {
    if (bd.t1 < a || bd.t0 > b) continue;
    const x0 = Math.max(0, msToX(view, w, bd.t0)), x1 = Math.min(w, msToX(view, w, bd.t1));
    ctx.fillStyle = bd.color; ctx.globalAlpha = 0.14; ctx.fillRect(x0, padT, x1 - x0, h - padT - padB);
    ctx.globalAlpha = 0.9; ctx.fillRect(x0, padT, x1 - x0, 2);
    const lx = Math.max(x0, o.left || 0);   // o.left: px a gutter covers at the left (the combined lane's name gutter)
    const txt = fitText(ctx, bd.label, x1 - lx - 6);   // paw-bg90: the label ellipsised to its band, else none
    if (txt) ctx.fillText(txt, lx + 3, h - padB - 3);
  }
  ctx.globalAlpha = 1;
  for (const L of layers) {
    const base = L.dim ? 0.35 : 1;
    ctx.strokeStyle = ctx.fillStyle = L.color;
    if (L.pat && L.pat.length) {   // ghost points
      const [p0, p1] = visibleSlice(L.pat, a, b);
      ctx.globalAlpha = base * (L.ref ? 0.95 : 0.5); ctx.lineWidth = L.ref ? 1.75 : 1; ctx.setLineDash(L.ref ? [7, 4] : []); ctx.beginPath();
      for (let i = p0; i < p1; i++) { const x = msToX(view, w, L.pat[i]), y = Y(L.ppos[i] / 100); i === p0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke(); ctx.setLineDash([]);
      if (p1 - p0 < w / 3) for (let i = p0; i < p1; i++) {
        ctx.beginPath(); ctx.arc(msToX(view, w, L.pat[i]), Y(L.ppos[i] / 100), L.ref ? 3.5 : 3, 0, 6.2832); L.ref ? ctx.fill() : ctx.stroke();
      }
    }
    if (L.t && L.t.length) {   // raw signal
      const [i0, i1] = visibleSlice(L.t, a, b);
      ctx.globalAlpha = base * (L.alpha ?? 1); ctx.lineWidth = L.lw ?? 1.25; ctx.setLineDash(L.dash || []); ctx.beginPath();
      if (i1 - i0 > 2 * w) {
        const { min, max } = envelope(L.t, L.v, i0, i1, view, w);
        for (let c = 0; c < w; c++) if (min[c] === min[c]) { ctx.moveTo(c + 0.5, Y(min[c])); ctx.lineTo(c + 0.5, Y(max[c]) - 0.5); }
      } else {
        let pen = false;
        for (let i = i0; i < i1; i++) {
          const y = L.v[i];
          if (y !== y) { pen = false; continue; }
          const x = msToX(view, w, L.t[i]);
          pen ? ctx.lineTo(x, Y(y)) : ctx.moveTo(x, Y(y));
          pen = true;
        }
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
  }
  ctx.globalAlpha = 1;
  // marks (run events, loop cycles): labelled ticks; labels only where there is room
  ctx.font = '10px ' + cssVar('--mono', 'monospace'); ctx.lineWidth = 1;
  const shown = markLabels(ctx, (o.marks || []).filter((m) => m.t >= a && m.t <= b), (t) => msToX(view, w, t) + 0.5);
  for (const [m, x, label] of shown) {
    ctx.strokeStyle = ctx.fillStyle = m.color || '#A78BFA'; ctx.globalAlpha = 0.7 * (m.alpha ?? 1);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
    if (label) { ctx.globalAlpha = m.alpha ?? 1; ctx.fillText(m.label, x + 3, padT + 10); }
  }
  ctx.globalAlpha = 1;
  // confidence strip under the lane: per-pixel-column minimum, brightness = confidence
  const cf = o.confidence;
  if (cf && cf.t.length) {
    const [c0, c1] = visibleSlice(cf.t, a, b), cw = Math.ceil(w), lo = new Float32Array(cw).fill(NaN);
    for (let i = c0; i < c1; i++) { const c = Math.floor(msToX(view, w, cf.t[i])); if (c >= 0 && c < cw && !(cf.v[i] >= lo[c])) lo[c] = cf.v[i]; }
    ctx.fillStyle = cf.color;
    for (let c = 0; c < cw; c++) if (lo[c] === lo[c]) { ctx.globalAlpha = 0.12 + 0.88 * lo[c]; ctx.fillRect(c, h - 7, 1, 5); }
    ctx.globalAlpha = 1;
  }
}
