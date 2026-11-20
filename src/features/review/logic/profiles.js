// Device profile editing helpers (pure). The data shape and built-ins belong to src/lib/analyze/profiles.js:
//   { id, name, maxSpeed (u/s), minIntervalMs, range:[lo,hi], latencyMs, verified, note }
// Custom profiles live in the setting `review.profiles` (array); built-ins are never edited, only duplicated.
import { BUILTIN_PROFILES, GENERIC, listProfiles, getProfile, withStroke, effectiveMaxSpeed } from '../../../lib/analyze/profiles.js';

export { BUILTIN_PROFILES, GENERIC, listProfiles, getProfile };

export const PROFILE_FIELDS = Object.freeze([
  { key: 'maxSpeed', label: 'Max speed', unit: 'u/s', min: 1, max: 5000, step: 10 },
  { key: 'minIntervalMs', label: 'Min interval', unit: 'ms', min: 0, max: 10000, step: 5 },
  { key: 'rangeLo', label: 'Range low', unit: '', min: 0, max: 99, step: 1 },
  { key: 'rangeHi', label: 'Range high', unit: '', min: 1, max: 100, step: 1 },
  { key: 'latencyMs', label: 'Latency offset', unit: 'ms', min: -5000, max: 5000, step: 5 },
]);

/** Flat form values for the editor. */
export const toForm = (p) => ({ name: p.name, maxSpeed: p.maxSpeed, minIntervalMs: p.minIntervalMs, rangeLo: p.range[0], rangeHi: p.range[1], latencyMs: p.latencyMs, note: p.note ?? '' });

/** form -> { ok, errors: {field: msg}, value } ; `value` is always a usable profile (bad numbers fall back to the base, then clamp). */
export function validateForm(form, base = GENERIC) {
  const errors = {}, v = { id: base.id, name: String(form.name ?? '').trim(), note: String(form.note ?? ''), verified: false };
  if (!v.name) errors.name = 'Name required';
  const baseForm = toForm(base);
  for (const f of PROFILE_FIELDS) {
    const raw = form[f.key], n = Number(raw);
    if (raw === '' || raw == null || !Number.isFinite(n)) { errors[f.key] = 'Number required'; v[f.key] = baseForm[f.key]; continue; }
    if (n < f.min || n > f.max) errors[f.key] = `${f.min} to ${f.max}`;
    v[f.key] = Math.min(f.max, Math.max(f.min, Math.round(n)));
  }
  if (v.rangeLo >= v.rangeHi) { errors.rangeHi = 'Must be above range low'; v.rangeHi = Math.min(100, v.rangeLo + 1); v.rangeLo = Math.min(v.rangeLo, v.rangeHi - 1); }
  const { rangeLo, rangeHi, ...rest } = v;
  return { ok: !Object.keys(errors).length, errors, value: { ...rest, range: [rangeLo, rangeHi] } };
}

export function uniqueId(base, taken) {
  const slug = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';
  let id = slug, n = 2;
  while (taken.has(id)) id = `${slug}-${n++}`;
  return id;
}

export function duplicateProfile(p, all) {
  const name = `${p.name} copy`;
  return { ...p, id: uniqueId(name, new Set(all.map((x) => x.id))), name, range: [...p.range], verified: false };
}

export const newProfile = (all) => ({ ...GENERIC, id: uniqueId('custom', new Set(all.map((x) => x.id))), name: 'Custom', range: [...GENERIC.range], verified: false, note: '' });

export const isBuiltin = (id) => BUILTIN_PROFILES.some((p) => p.id === id);
/** Stable string for cache invalidation: changes iff something problems depend on changes. */
export const profileKey = (p) => `${p.maxSpeed}|${p.minIntervalMs}|${p.range[0]}|${p.range[1]}|${p.kinematics?.strokeMm ?? ''}`;

/** [lo, hi] mm when the profile's stroke window is a working parameter (kinematics.strokeRange), else null. */
export const strokeRangeOf = (p) => p?.kinematics?.strokeRange ?? null;

/** The profile as run: kinematics.strokeMm set to `mm` (clamped to strokeRange; null = the profile's default),
 *  and a derived maxSpeed recomputed from it (rounded u/s). Profiles without a stroke range come back unchanged. */
export function withStrokeMm(p, mm) {
  const r = strokeRangeOf(p);
  if (!r || mm == null || !Number.isFinite(+mm)) return p;
  const a = withStroke(p, Math.min(r[1], Math.max(r[0], Math.round(+mm))));
  return p.maxSpeedDerived ? { ...a, maxSpeed: Math.round(effectiveMaxSpeed(a)) } : a;
}

/** The active profile from settings: `review.profile` (id), `review.profiles` (custom), `review.strokeMm` ({id: mm}). */
export function activeProfile(settings) {
  const p = getProfile(settings.get('review.profile', GENERIC.id), settings.get('review.profiles', []));
  return withStrokeMm(p, settings.get('review.strokeMm', {})?.[p.id]);
}
