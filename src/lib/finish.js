// finish.js -- what plays and exports, as a small stack evaluated in a fixed order; nothing in it is ever baked:
//   1. base       the stroke as lib/script-of.js scriptOf gives it (paw-x7w7): the baked points (doc.axes.stroke: what Bake,
//                 Smart stroke, insertion pushes and hand edits write; a lane drag edits it) with the live runs, fills and
//                 bridges in where nothing is baked
//   2. autorange  a live depth pass over the whole stroke (lib/autorange rangePass), from the scenes' bands (scene.range)
//                 and doc.finish {autorange: on, policy (strength, keep, ...)}; recomputed from the current base, scenes, effects
//   3. modifiers  doc.fx, live (lib/fx applyFx) on top of the ranged trace: a spurt rings around it, a knot keeps the
//                 reserve the pass left below its strokes (the pass leaves knot spans to the Knotting modifier)
// The pass reads the scenes with the event modifiers in them (timeline/mods.js withMods: orgasm / knotting / idle bands).
// finalScript(doc, axis, env) is memoised on its inputs' identities (the scenes' apart from their painted groups, paw-o60v.6); save / export, playback, the device preview and the
// Machine read it (finalOf(app)). Other axes have no layers: their points are final. Flatten (timeline.flatten) is the
// one explicit write of the final into the base.
import { applyFx, liveFx } from './fx.js';
import { rangePlan, rangePass } from './autorange.js';
import { withStructure } from '../features/timeline/acts.js';
import { withMods } from '../features/timeline/mods.js';
import { groupsAside } from '../features/timeline/shots.js';
import { frameLen } from './lane.js';
import { scriptOf } from './script-of.js';

/** doc.finish defaults: the pass off, the project's policy (null = env / defaults; its strength / keep drive the pass),
 *  the owner's hand pieces and keys on the band envelope (lib/autorange-env.js). */
export const FINISH = Object.freeze({ autorange: false, policy: null, bands: [], keys: [] });
export const finishOf = (doc) => ({ ...FINISH, ...(doc?.finish || {}) });
/** The scenes the pass reads: the event modifiers in them (mods.js withMods), structure derived. */
const scenesFor = (doc) => withStructure(withMods(doc?.scenes || [], doc?.fx));

const memo = new WeakMap();
const envKey = (e) => { const p = e.profile; return `${p?.device ?? ''}|${p?.range?.[0] ?? ''}|${p?.maxSpeed ?? ''}|${p?.minIntervalMs ?? ''}|${e.maxSpeed ?? ''}|${frameLen(e.grid)}|${e.policy ? JSON.stringify(e.policy) : ''}|${e.shaftsId ?? 0}|${e.fades?.length ? JSON.stringify(e.fades) : ''}`; };
/** paw-r9nh: the modifiers under the machine's speed limit and minimum interval, their events on the player's frames. */
export const fxCtxOf = (env = {}) => ({ maxSpeed: env.maxSpeed, minGapMs: env.profile?.minIntervalMs || undefined, grid: env.grid || undefined });

/** The pass's overrides (lib/autorange-env.js): the shots (scenes, modifiers) and the owner's hand pieces / keys. */
export const overridesOf = (doc, f = finishOf(doc)) => ({ scenes: scenesFor(doc), bands: f.bands || [], keys: f.keys || [] });

/** The autorange plan the pass uses (lib/autorange rangePlan) for doc as it is. env: {profile, policy (under the
 *  project's own), maxSpeed, shafts (shot -> the run's shaft: measured depth, lib/autorange shaftOfShot), shaftsId}. */
export function finishPlan(doc, env = {}, f = finishOf(doc)) {
  return rangePlan(scenesFor(doc), doc?.axes?.stroke || [], { profile: env.profile ?? null, policy: { ...(env.policy || {}), ...(f.policy || {}) },
    fx: doc?.fx || [], maxSpeed: env.maxSpeed, shafts: env.shafts ?? null });
}

/** The script that plays and exports for an axis: base -> autorange (when on) -> live modifiers. Same array back while
 *  nothing changes it (the base itself when no layer acts). env.mods = {of, list}: the modifiers as they act when `of`
 *  is doc.fx (timeline/mods-tracked.js: a tracked one with its fitted timing). */
export function finalScript(doc, axis = 'stroke', env = {}) {
  const base = doc?.axes?.[axis] || [];
  if (axis !== 'stroke' || base.length < 2) return base;
  const fx = env.mods && env.mods.of === doc.fx ? env.mods.list : doc.fx || [], sc = groupsAside(doc.scenes || []), fin = doc.finish || null, k = envKey(env), c = memo.get(base);
  if (c && c.fx === fx && c.scenes === sc && c.fin === fin && c.k === k) return c.out;
  const f = finishOf(doc);
  let out = base;
  if (f.autorange && doc.scenes?.length) out = rangePass(base, finishPlan(doc, env, f), { ...overridesOf(doc, f), fades: env.fades || [] });   // env.fades: paw-ef73.9 soft starts
  if (liveFx(fx).length) out = applyFx(out, fx, fxCtxOf(env));   // paw-r9nh: it used to ignore the machine's cap (a spurt at 883 pos/s under 150)
  memo.set(base, { fx, scenes: sc, fin, k, out });
  return out;
}

/**
 * A preview ghost of points not yet in the base (the scene fills, bridges and holds: tracking's 'scene-bridge'), seen
 * the way Accept + play will give it: its points merged into the base and the whole stack evaluated, the ghost's own
 * times read back. The same ghost object while nothing changes it; the ghost itself when the pass is off.
 */
const gmemo = new WeakMap();
export function rangedGhost(app, g, env = app.finishEnv?.() ?? {}) {
  const d = app.doc, base = scriptOf(app, 'stroke');
  if (!d.finish?.autorange || !g?.script?.length || (g.axis ?? 'stroke') !== 'stroke') return g;
  const k = envKey(env), c = gmemo.get(g);
  if (c && c.base === base && c.fx === d.fx && c.scenes === groupsAside(d.scenes || []) && c.fin === d.finish && c.k === k) return c.out;
  const ats = new Set(g.script.map((p) => p.at)), merged = [...base.filter((p) => !ats.has(p.at)), ...g.script].sort((a, b) => a.at - b.at);
  const fin = finalScript({ axes: { stroke: merged }, fx: d.fx, scenes: d.scenes, finish: d.finish }, 'stroke', env), byAt = new Map(fin.map((p) => [p.at, p.pos]));
  const out = { ...g, name: `${g.name} (as it will play)`, script: g.script.map((p) => ({ at: p.at, pos: byAt.get(p.at) ?? p.pos })) };
  gmemo.set(g, { base, fx: d.fx, scenes: groupsAside(d.scenes || []), fin: d.finish, k, out });
  return out;
}

/** The document as the layers read it: its axis = scriptOf (baked + live, paw-x7w7). */
export const docOf = (app, axis = 'stroke') => { const d = app.doc; return { axes: { ...d.axes, [axis]: scriptOf(app, axis) }, fx: d.fx, scenes: d.scenes, finish: d.finish }; };
/** The app's final script: env from app.finishEnv() (the timeline feature registers it: device profile, the app's
 *  last-used policy, the lanes' speed limit). Over scriptOf: the live runs play and export like points. */
export const finalOf = (app, axis = 'stroke') => finalScript(docOf(app, axis), axis, app.finishEnv?.() ?? {});
/** Every axis's final (what a save / export / pack writes): the document's axes, plus the stroke when only live points
 *  make it (a tracked video never baked). */
export function finalAxes(app) {
  app.beforeWrite?.();   // paw-cfaz: the tracking store drops any drag preview first (what is written never reads one)
  const ids = new Set(Object.keys(app.doc.axes || {}));
  if (scriptOf(app, 'stroke').length) ids.add('stroke');
  return Object.fromEntries([...ids].map((a) => [a, finalOf(app, a)]));
}

/** What the layers do to the stroke right now: {autorange: bool, effects: n live modifiers}. */
export function layersOf(doc) {
  const f = finishOf(doc);
  return { autorange: !!f.autorange, effects: liveFx(doc?.fx).length };
}

