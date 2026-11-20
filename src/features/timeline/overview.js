// overview.js -- the whole-video strip's pure parts: viewport brush maths and an incremental speed-bin cache.
import { clampView, zoomAt, MIN_SPAN } from '../../lib/lane.js';
import { lowerBound } from '../../lib/core/script.js';

// ---- brush: the current view drawn over the whole video [0, dur] mapped onto W px ----
/** Brush rectangle in px; never narrower than minPx (centred) so it stays grabbable when zoomed far in. A view panned past an
 *  end (paw-g56v) shows only its part inside the video. */
export function brushRect(view, dur, W, minPx = 6) {
  let x0 = Math.max(0, (view.start / dur) * W), x1 = Math.min(W, ((view.start + view.span) / dur) * W);
  if (x1 - x0 < minPx) { const c = (x0 + x1) / 2; x0 = Math.max(0, Math.min(W - minPx, c - minPx / 2)); x1 = x0 + minPx; }
  return { x0, x1 };
}
/** 'left' | 'right' | 'body' | null for a pointer at x. */
export function brushHit(x, r, edge = 5) {
  const e = Math.min(edge, (r.x1 - r.x0) / 3);
  if (x >= r.x0 - edge && x <= r.x0 + e) return 'left';
  if (x <= r.x1 + edge && x >= r.x1 - e) return 'right';
  return x > r.x0 && x < r.x1 ? 'body' : null;
}
/** New view while dragging: kind 'body' (pan) | 'left' | 'right' (edges zoom) | 'new' (draw a fresh brush). */
export function brushDrag(kind, v0, x0, x, W, dur) {
  const ms = (px) => (px / W) * dur, end = v0.start + v0.span;
  if (kind === 'body') return clampView({ start: v0.start + ms(x - x0), span: v0.span }, dur);
  if (kind === 'left') { const s = Math.max(0, Math.min(ms(x), end - MIN_SPAN)); return clampView({ start: s, span: end - s }, dur); }
  if (kind === 'right') { const e = Math.min(dur, Math.max(ms(x), v0.start + MIN_SPAN)); return clampView({ start: v0.start, span: e - v0.start }, dur); }
  const a = ms(x0), b = ms(x);
  return clampView({ start: Math.min(a, b), span: Math.max(MIN_SPAN, Math.abs(b - a)) }, dur);
}
/** Wheel over the overview: zoom around the cursor's time, held inside the current view. */
export const brushWheel = (v, tCursor, deltaY, dur) => zoomAt(v, Math.max(v.start, Math.min(v.start + v.span, tCursor)), Math.exp(deltaY * 0.0015), dur);
export const centerOn = (v, t, dur) => clampView({ start: t - v.span / 2, span: v.span }, dur);
/** What a press at x starts: brushHit, except outside the brush or inside a brush that fills the strip -> 'new'. */
export function pressKind(x, r, W) {
  const p = brushHit(x, r);
  return !p || (p === 'body' && r.x1 - r.x0 >= W - 2) ? 'new' : p;
}

// ---- strip layout and layers ----
/** Rows of a strip h px tall (CSS px): chapter band on top, speed bars, plan band, problem ticks at the bottom. */
export function bands(h) {
  const thin = h >= 40 ? 3 : 2, plan = Math.round(Math.max(5, Math.min(12, h * 0.17)));
  const heatY = thin + 1, planY = h - thin - 1 - plan;
  return { chap: { y: 0, h: thin }, heat: { y: heatY, h: planY - 1 - heatY }, plan: { y: planY, h: plan }, marks: { y: h - thin, h: thin } };
}

/**
 * Speed bars into an opaque RGBA buffer Wd x Hd (device px, for putImageData): colour = vals[c] / max on the
 * scale (the device limit is the top colour); the bar rises from the bottom to vals[c] / (headroom * max) of the
 * height (clamped; at least 1 px when moving), so speeds past the limit still stand out by height. Above the bar
 * the same colour mixed into bg at `dim`, so a slow column still shows its hue and silence stays bg.
 */
export const HEADROOM = 2;   // full bar height = 2x the device limit, so the limit sits at mid height
export function heatImage(vals, Wd, Hd, lut, max, bg, out = new Uint8ClampedArray(Wd * Hd * 4), dim = 0.14, headroom = HEADROOM) {
  const row = Wd * 4;
  for (let c = 0; c < Wd; c++) {
    const v = vals[c] > 0 ? vals[c] : 0, k = v > 0 ? lut[Math.round(Math.min(1, v / max) * 255)] : bg;
    const top = v > 0 ? Hd - Math.max(1, Math.round(Math.min(1, v / (headroom * max)) * Hd)) : Hd;
    const r = k[0], g = k[1], b = k[2];
    const dr = bg[0] + (r - bg[0]) * dim, dg = bg[1] + (g - bg[1]) * dim, db = bg[2] + (b - bg[2]) * dim;
    for (let y = 0, i = c * 4; y < Hd; y++, i += row) {
      const on = y >= top;
      out[i] = on ? r : dr; out[i + 1] = on ? g : dg; out[i + 2] = on ? b : db; out[i + 3] = 255;
    }
  }
  return out;
}

export const SEV = { info: 1, warn: 2, error: 3 };
/** Worst problem severity per CSS column (0 none, 1 info, 2 warn, 3 error) for items on `axis` (items without an axis count everywhere). */
export function markerColumns(items, axis, dur, W, out = new Uint8Array(Math.ceil(W))) {
  out.fill(0);
  for (const it of items) {
    if (it.axis && it.axis !== axis) continue;
    const s = SEV[it.severity] || 1;
    const c0 = Math.max(0, Math.round((it.t0 / dur) * W)), c1 = Math.min(out.length - 1, Math.max(c0, Math.round((it.t1 / dur) * W) - 1));
    for (let c = c0; c <= c1; c++) if (s > out[c]) out[c] = s;
  }
  return out;
}

// ---- speed bins ----
const same = (x, y) => x === y || (x.at === y.at && x.pos === y.pos);
/** Changed index window between two scripts: {i, ja, jb} (a[i..ja] became b[i..jb]) or null if equal. */
export function diffWindow(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && same(a[i], b[i])) i++;
  if (i === a.length && i === b.length) return null;
  let ja = a.length - 1, jb = b.length - 1;
  while (ja >= i && jb >= i && same(a[ja], b[jb])) { ja--; jb--; }
  return { i, ja, jb };
}
const atOf = (s, k) => (s.length ? s[Math.max(0, Math.min(s.length - 1, k))].at : NaN);

/**
 * Speed per fine time bin over [0, dur]: mean (distance / bin length, pos/s) and peak (fastest segment touching
 * the bin). update(script, dur) rebuilds only the bins around what changed since the last script: one O(n)
 * compare of the two arrays (no allocation) plus the segments in the changed window.
 */
export class HeatBins {
  constructor(maxBins = 16384, minBinMs = 20) { Object.assign(this, { maxBins, minBinMs, script: null, dur: 0, version: 0 }); }
  /** -> null (nothing changed) | [b0, b1] bins rebuilt (inclusive). */
  update(script, dur) {
    dur = Math.max(1, Math.ceil(Math.max(dur || 0, script.length ? script[script.length - 1].at : 0)));
    if (script === this.script && dur === this.dur) return null;
    if (dur !== this.dur || !this.script) {
      this.dur = dur;
      this.binMs = Math.max(this.minBinMs, dur / this.maxBins);
      this.n = Math.ceil(dur / this.binMs);
      this.mean = new Float32Array(this.n); this.peak = new Float32Array(this.n);
      this.script = script; this.version++;
      this.#fill(script, 0, this.n - 1);
      return [0, this.n - 1];
    }
    const d = diffWindow(this.script, script), old = this.script;
    this.script = script;
    if (!d) return null;
    const lo = Math.min(atOf(old, d.i - 1), atOf(script, d.i - 1)), hi = Math.max(atOf(old, d.ja + 1), atOf(script, d.jb + 1));
    const b0 = Math.max(0, Math.floor((Number.isFinite(lo) ? lo : 0) / this.binMs)), b1 = Math.min(this.n - 1, Math.floor((Number.isFinite(hi) ? hi : dur) / this.binMs));
    this.#fill(script, b0, b1);
    this.version++;
    return [b0, b1];
  }
  #fill(s, b0, b1) {
    const { mean, peak, binMs } = this, w0 = b0 * binMs, w1 = (b1 + 1) * binMs, inv = 1 / binMs;
    mean.fill(0, b0, b1 + 1); peak.fill(0, b0, b1 + 1);
    for (let j = Math.max(1, lowerBound(s, w0)); j < s.length && s[j - 1].at < w1; j++) {
      const a = s[j - 1], b = s[j], v = (Math.abs(b.pos - a.pos) * 1000) / (b.at - a.at);
      const s0 = Math.max(a.at, w0), s1 = Math.min(b.at, w1);
      if (!(s1 > s0)) continue;
      const k1 = Math.min(b1, Math.floor((s1 * inv) - 1e-9));
      for (let k = Math.max(b0, Math.floor(s0 * inv)); k <= k1; k++) {
        const ov = Math.min(s1, (k + 1) * binMs) - Math.max(s0, k * binMs);
        if (ov <= 0) continue;
        mean[k] += v * ov * inv;
        if (v > peak[k]) peak[k] = v;
      }
    }
  }
  /** Per-pixel column over [0, dur] (default: the binned duration): {mean, peak} Float32Arrays of length W (overlap-weighted mean, max peak). */
  columns(W, outMean = new Float32Array(W), outPeak = new Float32Array(W), dur = this.dur) {
    const { mean, peak, n, binMs } = this, per = dur / W;
    for (let c = 0; c < W; c++) {
      const t0 = c * per, t1 = t0 + per;
      let sum = 0, mx = 0;
      for (let k = Math.floor(t0 / binMs), k1 = Math.min(n - 1, Math.floor((t1 - 1e-9) / binMs)); k <= k1; k++) {
        const ov = Math.min(t1, (k + 1) * binMs) - Math.max(t0, k * binMs);
        sum += mean[k] * ov;
        if (peak[k] > mx) mx = peak[k];
      }
      outMean[c] = sum / per; outPeak[c] = mx;
    }
    return { mean: outMean, peak: outPeak };
  }
}
