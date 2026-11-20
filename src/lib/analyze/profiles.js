// Device profiles: plain data, user-editable. A profile never changes a script; it only tells the problem
// finder (and the export presets) what a device can follow.
//
//   maxSpeed       pos units per second the device can follow (1 unit = 1% of stroke)
//   minIntervalMs  shortest time between two consecutive points a device can honour
//   range          [lo, hi] usable position window (0 = deepest, 100 = out)
//   latencyMs      typical command-to-motion delay (informational; the shell's sync offset is separate)
//   verified       false = number is from memory / a conservative guess, NOT checked against a datasheet
//
// Optional kinematics (additive): kinematics = { strokeMm, vMax (mm/s), aMax (mm/s^2), jMax (mm/s^3), strokeRange? }.
// Position units map to mm through the stroke length: units/s = mm/s / strokeMm * 100 (same factor for a and j).
// When kinematics is present and maxSpeed is not set explicitly, maxSpeed is DERIVED (maxSpeedDerived: true) from vMax.
// strokeMm is a WORKING parameter (the rail window the user runs, e.g. 100-300 mm); `kinematics.strokeRange: [lo, hi]` hints a slider.
// `limits: 'hard' | 'planner'` (default 'hard'): 'planner' = the device runs a planner that reshapes illegal input predictably, so
// over-limit findings are informational (kind planner-reshaped; speed-limit/too-close flagged `planner: true`), never errors or fixes.
//
// UNVERIFIED: every named device figure below is a rough recollection of public specs and community
// folklore, not a measurement. Treat them as starting points; users are expected to edit them.

export const GENERIC = Object.freeze({
  id: 'generic', name: 'Generic stroker (conservative)', maxSpeed: 250, minIntervalMs: 80, range: Object.freeze([0, 100]),
  latencyMs: 0, verified: false, note: 'Deliberately conservative default; fits most strokers.',
});

export const BUILTIN_PROFILES = Object.freeze([
  GENERIC,
  { id: 'generic-fast', name: 'Generic stroker (fast)', maxSpeed: 400, minIntervalMs: 50, range: [0, 100], latencyMs: 0, verified: false, note: 'Optimistic ceiling; most hardware cannot keep up.' },
  // UNVERIFIED: The Handy is marketed at roughly 400 mm/s over ~110 mm => ~360 units/s. Real-world command
  // rate limits make ~50-100 ms intervals the practical floor.
  { id: 'handy', name: 'The Handy', maxSpeed: 360, minIntervalMs: 60, range: [0, 100], latencyMs: 100, verified: false, note: 'From memory of marketing figures.' },
  // UNVERIFIED: Kiiroo Keon/Onyx class; figure is a guess in line with other linear strokers.
  { id: 'keon', name: 'Kiiroo Keon', maxSpeed: 300, minIntervalMs: 80, range: [0, 100], latencyMs: 150, verified: false, note: 'Guess.' },
  // UNVERIFIED: Fleshlight Launch is notably slower than modern devices.
  { id: 'launch', name: 'Fleshlight Launch', maxSpeed: 200, minIntervalMs: 100, range: [0, 100], latencyMs: 150, verified: false, note: 'Guess; older, slower hardware.' },
  // UNVERIFIED: OSR2 / SR6 are DIY; speed depends entirely on servos and power supply.
  { id: 'osr2', name: 'OSR2 / SR6 (DIY)', maxSpeed: 330, minIntervalMs: 60, range: [0, 100], latencyMs: 50, verified: false, note: 'Servo dependent; tune to your build.' },
  // Nucleus Capstan: v/a/j are OWNER-SUPPLIED (verified); strokeMm is a working parameter (default 200, runs 100-300).
  // Runs the owner's Kinetic2 planner, hence limits: 'planner'. minIntervalMs / latencyMs are guesses.
  { id: 'nucleus-capstan', name: 'Nucleus Capstan', maxSpeed: 600, maxSpeedDerived: true, minIntervalMs: 20, range: [0, 100], latencyMs: 0, verified: true,
    kinematics: { strokeMm: 200, vMax: 1200, aMax: 100000, jMax: 20000000, strokeRange: [100, 300] }, limits: 'planner',
    note: 'v/a/j supplied by the owner. Kinetic2 planner reshapes over-limit input.' },
].map((p) => Object.freeze({ ...p, range: Object.freeze([...p.range]), ...(p.kinematics ? { kinematics: Object.freeze({ ...p.kinematics, strokeRange: p.kinematics.strokeRange && Object.freeze([...p.kinematics.strokeRange]) }) } : {}) })));

/** mm-based kinematics -> pos units: { v, a, j } (units/s, units/s^2, units/s^3). Throws if the profile has none. */
export function toUnits(profile) {
  const k = profile && profile.kinematics;
  if (!k) throw new Error('profile has no kinematics');
  const f = 100 / k.strokeMm;
  return { v: k.vMax * f, a: k.aMax * f, j: k.jMax * f, strokeMm: k.strokeMm };
}
/** Copy of a profile with another stroke length (maxSpeed follows when it was derived). Cheap: for live sliders. */
export function withStroke(profile, strokeMm) {
  if (!profile.kinematics) throw new Error('profile has no kinematics');
  return { ...profile, kinematics: { ...profile.kinematics, strokeMm } };
}
/** 'hard' (default) | 'planner'. */
export const limitsMode = (profile) => (profile && profile.limits === 'planner' ? 'planner' : 'hard');
/** Max speed in units/s: derived from kinematics.vMax when present and maxSpeed is unset/derived, else maxSpeed, else the generic default. */
export function effectiveMaxSpeed(profile) {
  const k = profile && profile.kinematics;
  if (k && (profile.maxSpeedDerived || profile.maxSpeed == null)) return (k.vMax / k.strokeMm) * 100;
  return profile && profile.maxSpeed != null ? profile.maxSpeed : GENERIC.maxSpeed;
}

/** Fill defaults and validate a user-supplied partial profile; throws Error with a precise message if unusable. */
export function makeProfile(p = {}) {
  const out = { ...GENERIC, verified: false, note: '', ...p };
  const num = (k, lo, hi) => {
    if (!(typeof out[k] === 'number' && Number.isFinite(out[k]) && out[k] >= lo && out[k] <= hi)) {
      throw new Error(`profile.${k} must be a number in ${lo}..${hi}, got ${JSON.stringify(p[k])}`);
    }
  };
  if (out.kinematics) {
    const k = out.kinematics;
    for (const f of ['strokeMm', 'vMax', 'aMax', 'jMax']) {
      if (!(typeof k[f] === 'number' && Number.isFinite(k[f]) && k[f] > 0)) throw new Error(`profile.kinematics.${f} must be a positive number, got ${JSON.stringify(k[f])}`);
    }
    if (k.strokeRange && !(Array.isArray(k.strokeRange) && k.strokeRange.length === 2 && k.strokeRange[0] > 0 && k.strokeRange[0] < k.strokeRange[1])) throw new Error(`profile.kinematics.strokeRange must be [lo, hi] mm, got ${JSON.stringify(k.strokeRange)}`);
    out.kinematics = { ...k };
    if (p.maxSpeed == null || p.maxSpeedDerived) { out.maxSpeed = effectiveMaxSpeed({ ...out, maxSpeed: null }); out.maxSpeedDerived = true; }
  }
  num('maxSpeed', 1, 100000); num('minIntervalMs', 0, 10000); num('latencyMs', -5000, 5000);
  if (!Array.isArray(out.range) || out.range.length !== 2 || !(out.range[0] >= 0 && out.range[1] <= 100 && out.range[0] < out.range[1])) {
    throw new Error(`profile.range must be [lo, hi] with 0 <= lo < hi <= 100, got ${JSON.stringify(p.range)}`);
  }
  out.range = [out.range[0], out.range[1]];
  if (out.limits !== undefined && out.limits !== 'hard' && out.limits !== 'planner') throw new Error(`profile.limits must be 'hard' or 'planner', got ${JSON.stringify(out.limits)}`);
  if (typeof out.id !== 'string' || !out.id) throw new Error('profile.id must be a non-empty string');
  if (typeof out.name !== 'string') out.name = out.id;
  return out;
}

/** Built-ins then user profiles (a user profile with a built-in id overrides it). */
export function listProfiles(user = []) {
  const m = new Map(BUILTIN_PROFILES.map((p) => [p.id, p]));
  for (const u of user) m.set(u.id, u);
  return [...m.values()];
}

/** Profile by id (falls back to GENERIC). */
export const getProfile = (id, user = []) => listProfiles(user).find((p) => p.id === id) || GENERIC;
