// time-format.js -- one written form per kind of time in the UI (paw-p8o2):
//   a time (the playhead, a point, a seek target)  fmtTime      0:05.000   the transport's own readout (m:ss.mmm, h:mm:ss.mmm)
//   a span (a range, a scene, a run)                fmtSpan      0:05.0–0:12.5   both ends to a tenth: run labels carry it and
//                                                                the fix log reads it back (app/fixlog.js), so it keeps its form
//   a length (a range's length, the visible span,   fmtDuration  250 ms · 1.5 s · 40 s · 1:30 · 1:02:03
//     a video's length, time elapsed)
import { fmtMs } from './video.js';

export const fmtTime = fmtMs;

/** One end of a span: m:ss.d (the tenth cut, never rounded up past the span). */
export const fmtSpanTime = (ms) => fmtMs(ms).slice(0, -2);

/** A span: m:ss.d–m:ss.d (en dash, no spaces). */
export const fmtSpan = (t0, t1) => `${fmtSpanTime(t0)}–${fmtSpanTime(t1)}`;

/** A length: ms under a second, seconds under a minute (a tenth under 10 s), a clock from a minute. '' for none. */
export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 59_500) return ms < 9_950 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;
  const s = Math.round(ms / 1000), p = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
}
