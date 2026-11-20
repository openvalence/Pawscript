// record.js -- live recording -> points. Pure.
import { simplify } from '../../lib/edit/density.js';

/**
 * Append a sample {t, pos} in place. When t jumps back by more than `back` ms (loop playback wrapped, or a seek), the
 * samples from t - back on are dropped first (no seam spike against the old pass): the latest pass wins, like a
 * punch-in, instead of every pass merging by time.
 */
export function pushSample(samples, s, back = 50) {
  const last = samples[samples.length - 1];
  if (last && s.t < last.t - back) { let n = samples.length; while (n && samples[n - 1].t > s.t - back) n--; samples.length = n; }
  samples.push(s);
  return samples;
}

/**
 * Dense samples [{t, pos}] (t ms, pos 0..100 floats, one per animation frame while the video plays) -> Script.
 * Times are rounded and de-duplicated (last sample wins), then RDP-simplified so every dropped sample stays within
 * eps pos units of the kept line; turning points survive because they carry the largest error.
 */
export function fitRecording(samples, { eps = 4 } = {}) {
  const byAt = new Map();
  for (const s of samples) if (Number.isFinite(s.t) && Number.isFinite(s.pos) && s.t >= 0) byAt.set(Math.round(s.t), Math.round(Math.max(0, Math.min(100, s.pos))));
  const pts = [...byAt].sort((a, b) => a[0] - b[0]).map(([at, pos]) => ({ at, pos }));
  return simplify(pts, null, { tolerance: eps }).script;
}
