// config.js -- settings + device profile + device -> the scheduler's config (pure; test/playback-config.test.mjs).
// Hard profiles clamp speed and space commands by minIntervalMs; a 'planner' profile (Nucleus Capstan) is never
// clamped for speed: its overspeed is a signal for the planner, not a blocker. The device's own message gap
// always applies. The user's range sits inside the profile's range.
import { DEFAULT_CONFIG } from './scheduler.js';
import { limitsMode, effectiveMaxSpeed } from '../../lib/analyze/profiles.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** The settings-derived config the scheduler runs with (pure; exported for tests). */
export function configFor(settings, profile, dev) {
  const hard = limitsMode(profile) === 'hard';
  const [ulo, uhi] = rangeOf(settings), [plo, phi] = profile.range || [0, 100];
  return {
    ...DEFAULT_CONFIG,
    offsetMs: clamp(+settings.get('playback.offsetMs', 0) || 0, -500, 500),
    latencyMs: profile.latencyMs || 0,
    lo: plo + (ulo / 100) * (phi - plo), hi: plo + (uhi / 100) * (phi - plo),
    invert: !!settings.get('playback.invert', false),
    scrub: settings.get('playback.scrub', true) !== false,
    maxSpeed: hard ? effectiveMaxSpeed(profile) : 0,
    minIntervalMs: Math.max(hard ? profile.minIntervalMs || 0 : 0, dev?.gap_ms || 0),
  };
}
export function rangeOf(settings) {
  const r = settings.get('playback.range', [0, 100]);
  const lo = clamp(Array.isArray(r) ? +r[0] || 0 : 0, 0, 95), hi = clamp(Array.isArray(r) ? +r[1] || 100 : 100, lo + 5, 100);
  return [lo, hi];
}
