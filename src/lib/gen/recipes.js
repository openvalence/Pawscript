// Recipes: named presets = a generator + default params. THE table to edit by hand is RECIPES below;
// KINDS maps each plan segment kind to its default recipe. pos 0 = deepest, 100 = out (lo = deep end).
//
// Param precedence when a segment is compiled: generator schema default < recipe params < segment params.

import { GENERATORS } from './generators.js';

const TWO_SPEED_SOMETIMES = { name: 'two-speed', ratio: 2, at: 0.5, prob: 0.25 }; // ~20% of points mid-stroke, as in the owner's scripts

// id: { gen, label, description, params }
export const RECIPES = {
  hold:                  { gen: 'hold',    label: 'Hold',                     params: { pos: 100 } },
  'fade-in':             { gen: 'ramp',    label: 'Fade in',                  params: { lo: 0, hi: 90, rate0: 1.2, rate1: 2.4, amp0: 0.15, amp1: 1, curve: 'ease-in-out', shape: 'sine', anchor: 'hi' } },
  'smooth-small':        { gen: 'smooth',  label: 'Small smooth motion',      params: { lo: 55, hi: 95, amp: 14, rate: 1.4, driftMs: 9000 } },
  tease:                 { gen: 'tease',   label: 'Tease',                    params: { lo: 0, hi: 95, rate: 2, edge: 0.3, every: 3, dip: 0.7, pauseMs: 350, full: 0.15 } },
  'tease-top':           { gen: 'tease-top', label: 'Tease at the top (dead-gap fill)', params: { lo: 80, hi: 100, rate: 0.67 } },   // Autorange's fill for scenes with nothing going on
  oral:                  { gen: 'follow',  label: 'Oral (follow)',            params: { lo: 40, hi: 95, shape: 'sine', fallbackRate: 2.0, anchor: 'hi' } },
  'oral-strokes':        { gen: 'strokes', label: 'Oral (steady)',            params: { lo: 40, hi: 95, rate: 2.0, shape: 'sine', anchor: 'hi' } },
  penetration:           { gen: 'follow',  label: 'Penetration (follow)',     params: { lo: 0, hi: 85, shape: TWO_SPEED_SOMETIMES, fallbackRate: 2.4, anchor: 'hi' } },
  'penetration-strokes': { gen: 'strokes', label: 'Penetration (steady)',     params: { lo: 0, hi: 85, rate: 2.4, shape: TWO_SPEED_SOMETIMES, anchor: 'hi' } },
  'knot-pop-stroke':     { gen: 'knot-stroke', label: 'Knot on every stroke', params: { lo: 0, hi: 80, knotOut: 17, popTo: 64, knotIn: 30, press: 20, popSpeed: 600 } }, // fitted from the owner's own knot scripting
  'knot-pop-held':       { gen: 'knot',    label: 'Knot pop (held back)',     params: { lo: 0, hi: 85, knotLevel: 30, between: 4 } },
  'knot-tied':           { gen: 'knot',    label: 'Knot, gets tied',          params: { lo: 0, hi: 85, knotLevel: 30, between: 3, tied: true, popsBeforeTie: 1 } },
  climax:                { gen: 'ramp',    label: 'Climax run-in (fast full strokes)', params: { lo: 10, hi: 90, rate0: 4.0, rate1: 5.5, amp0: 1, amp1: 1, curve: 'linear', shape: 'linear', anchor: 'lo' } }, // fitted: the strokes right before the orgasm
  orgasm:                { gen: 'tremor',  label: 'Orgasm tremor + pulses',   params: { lo: 0, hi: 40 } }, // fitted from the reference (TREMOR_FIT)
  'orgasm-pulses':       { gen: 'pulses',  label: 'Orgasm pulses (classic)',  params: { rate: 6.8, rateEnd: 4.2, decayMs: 15000, lo: 1, hi: 34, amp: 23, ampEnd: 20 } }, // the old `climax` recipe; old projects map here
  afterglow:             { gen: 'ramp',    label: 'Slow ending',              params: { lo: 0, hi: 90, rate0: 2.0, rate1: 0.6, amp0: 0.8, amp1: 0, curve: 'ease-out', shape: 'sine', anchor: 'hi' } },
  'afterglow-follow':    { gen: 'follow',  label: 'Slow ending (follow)',     params: { lo: 0, hi: 90, shape: 'sine', fadeFrom: 1, fadeTo: 0, fadeCurve: 'ease-out', anchor: 'hi' } },
  carry:                 { gen: 'follow',  label: 'Carry the rhythm',         params: { lo: 0, hi: 85, shape: 'sine', anchor: 'hi' } },
  accelerando:           { gen: 'ramp',    label: 'Speed up',                 params: { lo: 0, hi: 85, rate0: 1.2, rate1: 3.2, amp0: 1, amp1: 1, curve: 'exp' } },
  ritardando:            { gen: 'ramp',    label: 'Slow down',                params: { lo: 0, hi: 85, rate0: 3.2, rate1: 1.2, amp0: 1, amp1: 1, curve: 'exp' } },
  'fade-out':            { gen: 'ramp',    label: 'Fade out',                 params: { lo: 0, hi: 90, rate0: 2.4, rate1: 1.2, amp0: 1, amp1: 0, curve: 'ease-in-out', shape: 'sine', anchor: 'hi' } },
  strokes:               { gen: 'strokes', label: 'Steady strokes',           params: {} },
  beats:                 { gen: 'beats',   label: 'Taps / beats',             params: {} },
};

/** The finale as the reference scripts play it (README "Climax, orgasm, afterglow"): a fast run-in of full strokes,
 *  the orgasm (deep tremor + pulses), then the afterglow. Median durations over the reference orgasms, in ms. */
export const CLIMAX_FIT = Object.freeze({ runInMs: 6500, orgasmMs: 24000, afterglowMs: 30000 });

// kind: { label, recipe (default), color (hint for the plan lane) }
export const KINDS = {
  idle:        { label: 'Title / idle',            recipe: 'hold',         color: '#5b6270' },
  'fade-in':   { label: 'Fade-in',                 recipe: 'fade-in',      color: '#6f8fb3' },
  foreplay:    { label: 'Foreplay',                recipe: 'smooth-small', color: '#7aa889' },
  oral:        { label: 'Oral',                    recipe: 'oral',         color: '#b39a5e' },
  penetration: { label: 'Penetration',             recipe: 'penetration',  color: '#c0745a' },
  knotting:    { label: 'Knotting',                recipe: 'knot-pop-stroke', color: '#a45d8f' },
  climax:      { label: 'Climax (fast run-in)',    recipe: 'climax',       color: '#d0525c' },
  orgasm:      { label: 'Orgasm',                  recipe: 'orgasm',       color: '#e04c9c' },
  afterglow:   { label: 'Afterglow / slow ending', recipe: 'afterglow',    color: '#8a79b8' },
  outro:       { label: 'Outro',                   recipe: 'hold',         color: '#5b6270' },
  offscreen:   { label: 'Off-screen (carry)',      recipe: 'carry',        color: '#6b7f86' },
  custom:      { label: 'Custom',                  recipe: 'strokes',      color: '#8c8c8c' },
};

/** UI form schema of a recipe: its generator's schema with the recipe's defaults filled in.
 *  [{ key, label, type: 'number'|'int'|'bool'|'choice'|'shape'|'json', default, min, max, step, choices, unit }] */
export function recipeSchema(recipeId) {
  const r = RECIPES[recipeId];
  if (!r) throw new Error(`unknown recipe ${JSON.stringify(recipeId)}`);
  return GENERATORS[r.gen].schema.map((s) => (s.key in r.params ? { ...s, default: r.params[s.key] } : s));
}

/** Recipe ids usable for a kind (its default first, then every other recipe). */
export const recipesFor = (kind) => {
  const d = KINDS[kind]?.recipe;
  return d ? [d, ...Object.keys(RECIPES).filter((id) => id !== d)] : Object.keys(RECIPES);
};

/** Segment -> { recipeId, genId, gen, params } with defaults merged, or throws on unknown kind / recipe. */
export function resolveSegment(seg) {
  const recipeId = seg.recipe || KINDS[seg.kind]?.recipe;
  if (!recipeId) throw new Error(`unknown kind ${JSON.stringify(seg.kind)} and no recipe`);
  const r = RECIPES[recipeId];
  if (!r) throw new Error(`unknown recipe ${JSON.stringify(recipeId)}`);
  const g = GENERATORS[r.gen];
  if (!g) throw new Error(`recipe ${recipeId}: unknown generator ${JSON.stringify(r.gen)}`);
  return { recipeId, genId: r.gen, gen: g.gen, params: { ...r.params, ...(seg.params || {}) } };
}
