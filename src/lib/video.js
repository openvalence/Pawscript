// video.js -- pure helpers for the video pane and transport.

/** Where a video of vw x vh sits inside a cw x ch box with object-fit: contain. */
export function fitRect(cw, ch, vw, vh) {
  if (!(vw > 0 && vh > 0 && cw > 0 && ch > 0)) return { x: 0, y: 0, w: cw, h: ch };
  const k = Math.min(cw / vw, ch / vh), w = vw * k, h = vh * k;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/**
 * Seek target (seconds) that lands exactly one frame away. A seek shows the frame with pts <= target, so aim
 * 1.5 frames ahead or half a frame behind the frame on screen (mediaTime). frameMs is the estimate below.
 */
export function stepTarget(mediaSec, frameMs, dir) {
  return Math.max(0, mediaSec + (dir > 0 ? 1.5 : -0.5) * (frameMs / 1000));
}

/**
 * Frame duration (ms) from two consecutive rVFC metadata exactly one presented frame apart. A seek also counts as
 * 'one frame' with a big mediaTime jump, so keep the smallest delta seen. prev = null while unknown.
 */
export function frameMsFrom(prevMeta, meta, prev) {
  if (!prevMeta || meta.presentedFrames - prevMeta.presentedFrames !== 1) return prev;
  const d = (meta.mediaTime - prevMeta.mediaTime) * 1000;
  return d > 1 && d < 200 ? (prev == null ? d : Math.min(prev, d)) : prev;
}

/** m:ss.mmm (h:mm:ss.mmm past an hour) */
export function fmtMs(ms) {
  const t = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0)), s = Math.floor(t / 1000), p = (n, w = 2) => String(n).padStart(w, '0');
  const body = p(Math.floor(s / 60) % 60) + ':' + p(s % 60) + '.' + p(t % 1000, 3);
  return s >= 3600 ? Math.floor(s / 3600) + ':' + body : body.replace(/^0/, '');
}
