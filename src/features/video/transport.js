// transport.js -- pure readout formatting for the transport bar and HUD, the typed-time resolver, and the
// focus hook commands use to open the time field (Ctrl+G): `focusTimeField(text?)`.
import { parseTime } from './frames.js';

export const TIME_FMTS = [
  { id: 'ms', label: 'Minutes : seconds', short: 'ms' },
  { id: 'frames', label: 'Frames', short: 'frm' },
  { id: 'tc', label: 'Timecode', short: 'tc' },
  { id: 'sec', label: 'Seconds', short: 'sec' },
];
export const nextFmt = (id) => TIME_FMTS[(TIME_FMTS.findIndex((f) => f.id === id) + 1) % TIME_FMTS.length].id;

/** 0.025 -> '0.025', 1 -> '1', 1.25 -> '1.25'. */
export const fmtNum = (x) => String(+(+x).toFixed(3));

/** Speed button text: '1×', '0.5×', '◂ 2×' (reverse shuttle). */
export const fmtRate = (rate, shuttle = 0) => (shuttle < 0 ? '◂ ' + fmtNum(-shuttle) : fmtNum(shuttle > 0 ? shuttle : rate)) + '×';

/** 29.97002997 -> '29.97', 30 -> '30', 23.976 -> '23.976'. */
export const fmtFps = (fps) => (fps > 0 ? fmtNum(fps) : '--');

/** Frame count of a loop and its length text. */
export function loopInfo(loop, frameMs) {
  if (!loop) return null;
  const ms = loop.t1 - loop.t0;
  return { ms, frames: Math.max(1, Math.round(ms / frameMs)), text: (ms / 1000).toFixed(2) + ' s' };
}

/**
 * Typed text -> where to go, or null when it doesn't parse.
 * p = { timeMs, frame, fps, durationMs, last } -> { ms } | { frame } (absolute, clamped)
 */
export function resolveTime(text, p) {
  const r = parseTime(text, p.fps);
  if (!r) return null;
  if (r.frame != null) {
    const k = r.rel ? p.frame + r.frame : r.frame;
    return { frame: Math.max(0, Math.min(p.last ?? Infinity, Math.round(k))) };
  }
  const ms = r.rel ? p.timeMs + r.ms : r.ms;
  return { ms: Math.max(0, Math.min(p.durationMs || Infinity, ms)) };
}

/** Proxy progress 0..1 from error.progress, else the "… NN %" in error.message; null = unknown. */
export function proxyProgress(err) {
  if (Number.isFinite(err?.progress)) return Math.max(0, Math.min(1, err.progress));
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(err?.message || '');
  return m ? Math.max(0, Math.min(1, +m[1] / 100)) : null;
}

/** paw-nydn: proxy heights offered for a source `height` px tall, tallest first: its own height and 1080 / 720 / 480, none above it
 *  (media.rs proxy never scales up; it takes 144..2160, even). Unknown height: 1080 / 720 / 480. */
export function proxySizes(height) {
  const H = height > 0 ? Math.min(2160, Math.floor(height / 2) * 2) : 0;   // what proxy_args' scale gives an odd height
  return [...new Set([H, 1080, 720, 480])].filter((h) => h >= 144 && (!H || h <= H)).sort((a, b) => b - a);
}
/** The size made when none is named: `want` (settings video.proxyHeight, default 720: transcode_preview's), else the largest
 *  below it, else the smallest offered. */
export const defaultProxy = (sizes, want = 720) => sizes.find((h) => h <= want) ?? sizes.at(-1) ?? want;
/** Settings key of a video's proxies ({use, of, made}), by the video's path like the position bar's. */
export const proxyKey = (path) => (path ? 'video.proxy:' + path : '');

const CODEC ="The webview can't play this file (codec or container not supported). H.264/AAC in MP4, VP9 or AV1 in WebM play everywhere; HEVC needs the Windows HEVC extension.";
/**
 * The error card for a failed media element -> {code, message, canProxy, canLocate}. code = MediaError code;
 * o.probed = the probe found a video stream (or there is no file to probe); o.stat = backend.stat of the file
 * ({exists, size}) when known; o.proxy / o.locate = the backend can make a proxy / open a file dialog.
 * The webview reports a missing, an empty and an undecodable file alike (code 4): the stat and the probe tell
 * them apart, and a proxy is only offered for a file whose video stream ffprobe could read.
 */
export function mediaError(code, { path = '', probed = true, stat = null, proxy = false, locate = false, detail = '' } = {}) {
  if (stat && !stat.exists) return { code: 'missing', message: `File not found: ${path}`, canProxy: false, canLocate: locate };
  // paw-tjy6: a file that is there but cannot be read is not a moved one: no "Locate video…"
  if (stat && !stat.size) return { code: 'empty', message: `Empty file (0 bytes), can't be read as a video: ${path}`, canProxy: false, canLocate: false };
  if (stat?.exists) locate = false;
  const canProxy = proxy && probed && !!path;
  const msg = code === 4 ? (probed ? CODEC : "This file can't be read as a video")
    : code === 3 ? 'The video failed to decode (damaged file or unsupported profile).'
    : code === 2 ? 'The video could not be read (file moved or unreadable).' : 'Playback failed: ' + (detail || code);
  return { code, message: msg + (canProxy ? ' A playable proxy can be made.' : ''), canProxy, canLocate: locate && !probed && !!path };
}

/** paw-yh6y: the element loaded and plays the sound but shows no picture (HEVC / AV1 / ProRes without a decoder) -> the
 *  card, with a proxy offered as for a decode error when ffprobe read a video stream (o as mediaError). */
export function noPicture({ path = '', probed = true, proxy = false } = {}) {
  const canProxy = proxy && probed && !!path;
  return { code: 0, message: 'No video track Pawscript can show' + (canProxy ? ', a playable proxy can be made' : ''), canProxy };
}

// ---- the time-field hook: the mounted Transport registers, commands call ----
let hook = null;
export function setTimeFieldHook(fn) { hook = fn; return () => { if (hook === fn) hook = null; }; }
/** Open the transport's time field for typing (optional prefill). false when no transport is mounted. */
export const focusTimeField = (text) => (hook ? (hook(text), true) : false);
