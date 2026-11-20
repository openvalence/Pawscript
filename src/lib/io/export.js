// Export presets: per-axis export options applied to a Script before it is written.
//
//   options per axis: { simplifyTolerance: pos units (0 = off), speedCap: units/s | null, range: [lo, hi] | null
//                       (remap 0..100 into lo..hi), invert: bool }
//   preset: { id, name, default: options, axes: { roll: options (override), ... } }
//
// Order of application: simplify -> remap range -> speed cap (so the cap holds in FINAL device units) -> invert.
//
// Steps run through the edit-lib ops (src/lib/edit/): simplify (density.js), limitRange 'compress' (amplitude.js),
// capSpeed 'pull' (speed.js), invert (amplitude.js). `ops` can override any step (functions of (script, opts) -> Script).
import { normalize } from '../core/script.js';
import { simplify } from '../edit/density.js';
import { capSpeed } from '../edit/speed.js';
import { invert, limitRange } from '../edit/amplitude.js';
import { GENERIC, effectiveMaxSpeed } from '../analyze/profiles.js';

export const DEFAULT_OPTIONS = Object.freeze({ simplifyTolerance: 0, speedCap: null, range: null, invert: false });

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

/** Validate options; throws Error naming the bad field. Returns a complete options object. */
export function makeOptions(o = {}) {
  const out = { ...DEFAULT_OPTIONS, ...o };
  if (!(typeof out.simplifyTolerance === 'number' && out.simplifyTolerance >= 0 && out.simplifyTolerance <= 50)) throw new Error(`simplifyTolerance must be 0..50, got ${JSON.stringify(o.simplifyTolerance)}`);
  if (!(out.speedCap === null || (typeof out.speedCap === 'number' && out.speedCap > 0))) throw new Error(`speedCap must be null or a positive number, got ${JSON.stringify(o.speedCap)}`);
  if (!(out.range === null || (Array.isArray(out.range) && out.range.length === 2 && out.range[0] >= 0 && out.range[1] <= 100 && out.range[0] < out.range[1]))) throw new Error(`range must be null or [lo, hi] with 0 <= lo < hi <= 100, got ${JSON.stringify(o.range)}`);
  out.invert = !!out.invert;
  return out;
}

export function makePreset(p = {}) {
  if (typeof p.id !== 'string' || !p.id) throw new Error('preset.id must be a non-empty string');
  const axes = {};
  for (const [k, v] of Object.entries(isObj(p.axes) ? p.axes : {})) axes[k] = { ...v };
  for (const [k, v] of Object.entries(axes)) makeOptions({ ...p.default, ...v }); // validates
  return { id: p.id, name: p.name ?? p.id, default: makeOptions(p.default), axes };
}

/** Options for one axis: preset.default overlaid by preset.axes[axis]. */
export const optionsFor = (preset, axis) => makeOptions({ ...(preset.default || {}), ...((preset.axes || {})[axis] || {}) });

/** 'device-safe' preset for a device profile (lib/analyze shape): light simplify, speed cap = the profile's effective max speed,
 *  range remap when the profile's usable window is narrower than 0..100. No profile -> GENERIC. */
export function devicePreset(profile = GENERIC) {
  const p = profile || GENERIC, cap = Math.round(effectiveMaxSpeed(p));
  const r = Array.isArray(p.range) && (p.range[0] > 0 || p.range[1] < 100) ? [p.range[0], p.range[1]] : null;
  const what = [`${cap} u/s`, r && `range ${r[0]}-${r[1]}`, 'light simplify'].filter(Boolean).join(', ');
  return makePreset({ id: 'device-safe', name: `Device safe (${what})`,
    default: { simplifyTolerance: 1, speedCap: cap, range: r } });
}

export const BUILTIN_PRESETS = [
  makePreset({ id: 'as-is', name: 'As edited' }),
  devicePreset(GENERIC),
];

// ---- edit-lib adapters: whole script (sel = null) in, Script out ----
export const EDIT_OPS = Object.freeze({
  simplify: (s, { tolerance }) => simplify(s, null, { tolerance }).script,
  remapRange: (s, { min, max }) => limitRange(s, null, { lo: min, hi: max, mode: 'compress' }).script,
  limitSpeed: (s, { maxSpeed }) => capSpeed(s, null, { maxSpeed, method: 'pull' }).script,
  invert: (s) => invert(s, null).script,
});

/** Apply export options to one Script. `ops` overrides steps (see EDIT_OPS for names and shapes). */
export function applyExport(script, options, ops = {}) {
  const o = makeOptions(options), f = { ...EDIT_OPS, ...ops };
  let s = script;
  if (o.simplifyTolerance > 0) s = f.simplify(s, { tolerance: o.simplifyTolerance });
  if (o.range) s = f.remapRange(s, { min: o.range[0], max: o.range[1] });
  if (o.speedCap) s = f.limitSpeed(s, { maxSpeed: o.speedCap });
  if (o.invert) s = f.invert(s);
  return s === script ? script : normalize(s);
}

/** { axis: Script } through a preset -> { axis: Script } ready to hand to serializeFunscript. */
export function buildExports(axes, preset, ops) {
  return Object.fromEntries(Object.entries(axes).map(([id, s]) => [id, applyExport(s, optionsFor(preset, id), ops)]));
}
