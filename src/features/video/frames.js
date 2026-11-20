// frames.js -- pure frame/time maths for the player: frame index <-> media time for constant frame rate (exact
// rational fps such as 30000/1001, computed per index so nothing drifts) and variable frame rate (a sorted table
// of presentation times), where to seek to land on a frame, timecode formatting/parsing, loop boundaries and the
// interpolated playback clock.
//
// Times are media ms (float). A frame "at" t is the frame whose presentation interval [pts, next pts) contains t.

/** Integer-ms timestamps (funscript actions) round a frame's time by up to 0.5 ms: accept that much early. */
export const TOL_MS = 0.6;

const STANDARD = [[24000, 1001], [30000, 1001], [60000, 1001], [120000, 1001], [48000, 1001]];

/** fps (number, or 'num/den' string) -> {num, den}. Recognises the NTSC rationals; else an integer or /1000 ratio. */
export function rational(fps) {
  if (typeof fps === 'string' && fps.includes('/')) {
    const [n, d] = fps.split('/').map(Number);
    if (n > 0 && d > 0) return { num: n, den: d };
    fps = NaN;
  }
  fps = Number(fps);
  if (!(fps > 0)) return null;
  for (const [n, d] of STANDARD) if (Math.abs(fps - n / d) < 2e-3) return { num: n, den: d };
  if (Math.abs(fps - Math.round(fps)) < 2e-3) return { num: Math.round(fps), den: 1 };
  return { num: Math.round(fps * 1000), den: 1000 };
}

const COMMON = [12, 15, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 144, 240];
/** A measured rate (from frame deltas) snapped to a common rate within 0.6 %, else as measured. */
export function snapFps(fps) {
  if (!(fps > 0)) return fps;
  let best = null;
  for (const r of COMMON) if (Math.abs(fps - r) / r < 0.006 && (best == null || Math.abs(fps - r) < Math.abs(fps - best))) best = r;
  return best == null ? fps : rational(best).num / rational(best).den;
}

/** First index i with a[i] > x. */
function upperBound(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * A frame clock. cfr: {fps, durationMs?, t0?} (t0 = first frame's pts, normally 0); table: {times: sorted pts ms,
 * durationMs?}. `exact` says frame indices are trustworthy (CFR with a known rate, or a full table).
 */
export function makeClock({ fps, times, durationMs = NaN, t0 = 0 } = {}) {
  if (times && times.length) {
    const ts = Float64Array.from(times);
    const last = ts.length - 1;
    const endMs = durationMs > ts[last] ? durationMs : ts[last] + (last ? ts[last] - ts[last - 1] : 1000 / 30);
    let minMs = Infinity;
    for (let i = 1; i < ts.length; i++) minMs = Math.min(minMs, ts[i] - ts[i - 1]);
    return {
      kind: 'table', exact: true, count: ts.length, durationMs: endMs,
      frameMs: last ? (ts[last] - ts[0]) / last : 1000 / 30, minFrameMs: Number.isFinite(minMs) ? minMs : 1000 / 30,
      frameAt: (ms) => Math.max(0, upperBound(ts, ms + TOL_MS) - 1),
      timeOf: (k) => ts[Math.max(0, Math.min(last, k))],
      endOf: (k) => (k >= last ? endMs : ts[Math.max(0, k) + 1]),
    };
  }
  const r = rational(fps) || { num: 30, den: 1 };
  const exact = !!rational(fps);
  const k1000 = (1000 * r.den) / r.num;          // ms per frame, as one rational
  const count = durationMs > 0 ? Math.max(1, Math.round(((durationMs - t0) * r.num) / (1000 * r.den))) : Infinity;
  const timeOf = (k) => t0 + (k * 1000 * r.den) / r.num;   // per index: no accumulated drift
  return {
    kind: 'cfr', exact, count, durationMs, t0, num: r.num, den: r.den, frameMs: k1000, minFrameMs: k1000,
    frameAt: (ms) => Math.max(0, Math.min(count - 1, Math.floor(((ms - t0 + TOL_MS) * r.num) / (1000 * r.den)))),
    timeOf, endOf: (k) => timeOf(k + 1),
  };
}

/** paw-kxz4: the file's frame table (pts ms from the file's start, frames.rs frame_times) as a clock's times when the frames are NOT
 *  where the CFR clock puts them (by more than tolMs: a first frame 66 ms in, a dropped frame, a probed rate that is an average),
 *  else null (the CFR clock is exact). The first picture shows from 0 (the <video> paints it before its pts), so the table's frame
 *  0 starts at 0. */
export function offGridTable(times, cfr, tolMs = 1) {
  if (!times?.length || !cfr) return null;
  let off = false;
  for (let i = 0; i < times.length && !off; i++) off = Math.abs(times[i] - cfr.timeOf(i)) > tolMs;
  return off ? [Math.min(0, times[0]), ...times.slice(1)] : null;
}

/** Where to set currentTime (ms) to show frame k: the middle of its interval, safe from container rounding. */
export const seekTimeOf = (clock, k) => {
  k = Math.max(0, Math.min(clock.count - 1, k));
  const a = clock.timeOf(k), b = clock.endOf(k);
  return a + Math.min(b - a, 4 * clock.frameMs) / 2;
};

/**
 * Probing step for VFR files without a frame table: the n-th probe (n = 1, 2, ...) after the frame at curMs.
 * With delta <= the shortest frame, probe n lands on the next frame or still on the current one, never past
 * the next: the previous probe saw the current frame, so next pts > cur + (n - .5)·delta, and the frame after it
 * starts at least delta later, past this probe. Backward needs one probe: the previous frame starts <= cur - delta.
 */
export const probeForward = (curMs, delta, n) => curMs + (n + 0.5) * delta;
export const probeBack = (curMs, delta) => Math.max(0, curMs - 0.5 * delta);

// ---- loops and play-range stops ----

/**
 * While playing with loop {t0,t1} (frames with pts in [t0, t1) play): true when the frame just presented at
 * tMs is the loop's last (or playback already ran past t1), so the wrap seek goes out now and lands while that
 * frame is still on screen. aheadMs = how far the next presented frame may be (stopLookahead). Frames well
 * before t0 or past the end never wrap (the user seeked out of the loop).
 */
export function loopShouldWrap(tMs, aheadMs, loop) {
  if (!loop || !(loop.t1 > loop.t0)) return false;
  return tMs + aheadMs >= loop.t1 - TOL_MS && tMs < loop.t1 + 3 * aheadMs && tMs >= loop.t0 - TOL_MS;
}
/**
 * How far (media ms) past the frame just seen (frame k at tMs, in an rVFC callback) playback may get before a
 * seek issued now takes effect: the frame of the next callback -- the end of frame k (its real length: VFR frames
 * differ from the clock's average) or the media advance between the last two callbacks (advMs: the compositor
 * skips frames at fast rates; jumps over 4 frames x rate were seeks and are ignored) -- plus the frame Chromium
 * has already committed for the next vsync, which it still presents after the seek is issued: rate x leadMs
 * (leadMs = the display's refresh interval). Above 1x one more vsync covers a callback the
 * browser drops when the main thread is late; at 1x nothing extra, so a loop never loses its last frame.
 */
export function stopLookahead(clock, k, tMs, advMs = 0, rate = 1, leadMs = 0) {
  const own = clock.endOf(k) - tMs;
  const next = advMs > 0 && advMs <= 4 * clock.frameMs * Math.max(1, rate) ? Math.max(own, advMs) : own;
  return next + Math.max(rate, 2 * rate - 1) * Math.max(0, Math.min(50, leadMs));
}
/** Where play() starts with a loop on: inside the loop stays put, outside jumps to its start. */
export const loopStart = (tMs, loop) => (!loop || (tMs >= loop.t0 - TOL_MS && tMs < loop.t1) ? tMs : loop.t0);

// ---- the interpolated clock (smooth consumers: simulator, playheads) ----

/**
 * Media ms "now" between presented frames. anchor = {ms, perf (when that frame was displayed), rate, playing}.
 * Paused: the frame's own time, exactly. Playing: advanced by wall time, but never more than maxAheadMs past the
 * frame (a stalled decoder must not run the clock away).
 */
export function interpolate(anchor, perfNow, maxAheadMs) {
  if (!anchor) return 0;
  if (!anchor.playing) return anchor.ms;
  const d = Math.max(0, (perfNow - anchor.perf) * anchor.rate);
  return anchor.ms + Math.min(d, maxAheadMs);
}

// ---- timecode ----

const p2 = (n, w = 2) => String(n).padStart(w, '0');

/** m:ss.mmm (h:mm:ss.mmm past an hour). */
export function fmtMs(ms) {
  const t = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0)), s = Math.floor(t / 1000);
  const body = p2(Math.floor(s / 60) % 60) + ':' + p2(s % 60) + '.' + p2(t % 1000, 3);
  return s >= 3600 ? Math.floor(s / 3600) + ':' + body : body.replace(/^0/, '');
}

/** Frame-count timecode hh:mm:ss:ff with ff counted at the nominal (rounded) rate; non-drop. */
export function fmtTimecode(frame, fps) {
  const n = Math.max(1, Math.round(fps || 30)), f = Math.max(0, Math.floor(frame || 0));
  const s = Math.floor(f / n);
  return p2(Math.floor(s / 3600)) + ':' + p2(Math.floor(s / 60) % 60) + ':' + p2(s % 60) + ':' + p2(f % n);
}

/** Readout for a format id: 'ms' | 'frames' | 'tc' | 'sec'. */
export function fmtTime(fmt, ms, clock) {
  if (fmt === 'frames') return String(clock.frameAt(ms));
  if (fmt === 'tc') return fmtTimecode(clock.frameAt(ms), clock.num ? clock.num / clock.den : 1000 / clock.frameMs);
  if (fmt === 'sec') return (Math.max(0, ms) / 1000).toFixed(3) + 's';
  return fmtMs(ms);
}

/**
 * A typed time -> {ms} or {frame}, or null. Accepts 1:23.456, 1:02:03.5, 83.4, 83.4s, 1200ms, #120 or 120f
 * (frame), hh:mm:ss:ff (timecode, needs fps). A leading + or - makes it relative: {rel: true, ...}.
 */
export function parseTime(text, fps) {
  let s = String(text).trim().toLowerCase().replace(/,/g, '.');
  let rel = 0;
  if (/^[+-]/.test(s)) { rel = s[0] === '-' ? -1 : 1; s = s.slice(1).trim(); }
  const out = (o) => (rel ? { ...o, rel: true, ...(o.ms != null ? { ms: rel * o.ms } : { frame: rel * o.frame }) } : o);
  let m;
  if ((m = s.match(/^#\s*(\d+)$/) || s.match(/^(\d+)\s*f$/))) return out({ frame: +m[1] });
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*ms$/))) return out({ ms: +m[1] });
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*s?$/))) return out({ ms: +m[1] * 1000 });
  if ((m = s.match(/^(\d+):(\d{1,2}):(\d{1,2}):(\d{1,3})$/))) {
    const n = Math.max(1, Math.round(fps || 30));
    return out({ frame: ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * n + +m[4] });
  }
  if ((m = s.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/))) return out({ ms: (((+m[1] || 0) * 60 + +m[2]) * 60 + +m[3]) * 1000 });
  return null;
}

/** Frame duration (ms) from two rVFC metadata one presented frame apart; keeps the smallest seen (null = none yet). */
export function frameMsFrom(prevMeta, meta, prev) {
  if (!prevMeta || meta.presentedFrames - prevMeta.presentedFrames !== 1) return prev;
  const d = (meta.mediaTime - prevMeta.mediaTime) * 1000;
  return d > 1 && d < 200 ? (prev == null ? d : Math.min(prev, d)) : prev;
}
