// wave-logic.js -- pure helpers for the waveform lane and the hover tip.

/** Tip box (w x h) near the pointer (x, y) inside a W x H window: right/below by default, flipped left/above near an edge, never off-screen. */
export function placeTip(x, y, w, h, W, H, gx = 14, gy = 16, pad = 4) {
  let left = x + gx, top = y + gy;
  if (left + w > W - pad) left = x - gx - w;
  if (top + h > H - pad) top = y - gy - h;
  return { left: Math.max(pad, Math.min(left, W - pad - w)), top: Math.max(pad, Math.min(top, H - pad - h)) };
}

/** Thumbnail CSS size from the media aspect (fallback 16:9), `w` px wide. */
export function thumbSize(media, w = 144) {
  const a = media?.width > 0 && media?.height > 0 ? media.width / media.height : 16 / 9;
  return { w, h: Math.max(1, Math.round(w / Math.min(Math.max(a, 0.4), 3))) };
}

/** Largest |sample| in a pyramid's coarsest level (the waveform's normaliser; 1 if silent). */
export function pyramidPeak(pyr) {
  const l = pyr?.levels?.[pyr.levels.length - 1];
  if (!l) return 1;
  let m = 0;
  for (let i = 0; i < l.min.length; i++) m = Math.max(m, -l.min[i], l.max[i]);
  return m > 1e-4 ? m : 1;
}
