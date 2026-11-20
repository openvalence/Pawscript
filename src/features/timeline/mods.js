// mods.js -- modifiers on the timeline (paw-ef73.20, owner: "two places you can mark knotting, two places you can mark
// orgasm, they need to be one"). Pure. A modifier is ONE object in doc.fx (lib/fx.js: {id, kind, t0, t1, params?, ...}):
// marked in the Scenes tab, shaped in Refine, the same object in every tab. A timeline-level object, not a scene fact
// (owner: "drag modifiers across scenes and shots, as they are no longer tied to a scene"): free over cuts and scene
// boundaries (snap targets, not walls), as short as a frame, any number; cutting, merging or moving a boundary never
// touches them. The scene-level consumers see them through withMods: the scenes with each event modifier written
// as a {id: kind, t0, t1} tag over the scenes it meets (never stored: shots.js stripMods drops them on every write), so
// Autorange's bands, the sidecar's climax / idle labels (acts.js tagSpans), "over a whole shot the shot is idle" and the
// derived structure (an orgasm makes a scene busy) read them as before. A scene never has a modifier of its own
// (paw-8b4h): the scene controls make one over the scene (toggleModOver); the tagger's detection is a suggestion (modHints).
// Inner events: the spurts inside an orgasm (one per cumshot, on its frame) move and go with it (fx-edit innerOf).
import { FX_KINDS, EVENT_KINDS, isPointFx, knotModeParams, tagIdOf } from '../../lib/fx.js';
import { sceneRuns } from './shots.js';
import { detectedMods } from './acts.js';
import { onTurns } from './fx-edit.js';

/** The event kinds, in picker order. */
export const MODS = EVENT_KINDS;
/** Default length of a modifier started at the playhead (a chip or key with no range): ms, clipped to its scene. */
export const DEFAULT_MS = 4000;
/** The kind's word ('Orgasm', 'Pull-out'). */
export const modLabel = (kind) => FX_KINDS[kind]?.label ?? kind;
const ranged = (e) => !!e && !!FX_KINDS[e.kind] && !isPointFx(e) && e.t1 > e.t0;
/** The ranged modifiers (of `kind`; event kinds only with `events`), in list order. */
export const modsOf = (fx, kind = null, events = false) => (Array.isArray(fx) ? fx : []).filter((e) => ranged(e) && (!kind || e.kind === kind) && (!events || FX_KINDS[e.kind].event));
/** [[t0, t1], ...] of `kind` (sorted, touching / overlapping ones merged): the consumers' view. */
export function spansOf(fx, kind) {
  const out = [];
  for (const [a, b] of modsOf(fx, kind).map((e) => [e.t0, e.t1]).sort((x, y) => x[0] - y[0])) {
    const l = out[out.length - 1];
    if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]);
  }
  return out;
}
/** The ranged modifier of `kind` (any: null) under t, the latest-starting one when they overlap, or null. */
export const modAt = (fx, t, kind = null) => modsOf(fx, kind).filter((e) => t >= e.t0 && t < e.t1).sort((a, b) => b.t0 - a.t0)[0] ?? null;
/** "Is there an orgasm / knotting over this span": the first modifier of `kind` overlapping [t0, t1), or null. */
export const modOver = (fx, kind, t0, t1) => modsOf(fx, kind).find((e) => e.t0 < t1 && e.t1 > t0) ?? null;

const PROJ = new WeakMap();
/** The scenes as the scene-level consumers read them: every event modifier as a {id: kind, t0, t1} tag on each shot of
 *  each scene it meets (the consumers clip). Same list when there is none; cached per (list, fx). */
export function withMods(list, fx) {
  if (!Array.isArray(list) || !list.length) return list;
  const ms = modsOf(fx, null, true);
  if (!ms.length) return list;
  const c = PROJ.get(list);
  if (c && c.fx === fx) return c.out;
  const out = list.slice();
  for (const [lo, hi] of sceneRuns(list)) {
    const a = list[lo].start_ms, b = list[hi].end_ms, add = ms.filter((e) => e.t1 > a && e.t0 < b).map((e) => ({ id: tagIdOf(e), t0: Math.round(e.t0), t1: Math.round(e.t1) }));
    if (add.length) for (let k = lo; k <= hi; k++) out[k] = { ...list[k], tags: [...(list[k].tags || []), ...add] };
  }
  PROJ.set(list, { fx, out });
  return out;
}
/** [[t0, t1], ...] of modifier `id` over the scenes (each scene's projected {id, t0, t1} entries clipped to it), merged:
 *  Autorange's overlays read the projected scenes (withMods). */
export function sceneSpans(list = [], id) {
  const s = [], out = [];
  for (const [lo, hi] of sceneRuns(list)) {
    const a = list[lo].start_ms, b = list[hi].end_ms;
    for (const e of list[lo].tags || []) if (e?.id === id && Number.isFinite(e.t0)) { const x = Math.max(a, e.t0), y = Math.min(b, e.t1); if (y > x) s.push([x, y]); }
  }
  s.sort((x, y) => x[0] - y[0]);
  for (const [a, b] of s) { const l = out[out.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]); }
  return out;
}

/** The scene (run of shots) around t: {t0, t1} or null. */
function sceneAround(scenes, t) {
  const r = sceneRuns(scenes || []).find(([lo, hi]) => t >= scenes[lo].start_ms && t < scenes[hi].end_ms);
  return r ? { t0: scenes[r[0]].start_ms, t1: scenes[r[1]].end_ms } : null;
}
/** A new modifier. A knotting stores its mode now (paw-afoe, lib/fx knotModeParams on `base`, the stroke's points when the
 *  caller has them): edge drags never flip it. */
export function makeMod(id, kind, t0, t1, params = null, base = null) {
  const p = params ?? (kind === 'knotting' ? knotModeParams(base, t0, t1) : {});
  return { id, kind, t0: Math.round(t0), t1: Math.round(t1), params: p };
}
const byT0 = (a, b) => a.t0 - b.t0;
/**
 * The chip / key for kind: with a range (the I / O range, a scene click) the modifier is exactly that range (one already
 * covering exactly it goes off); else the one of the kind under t goes off; else a new one starts at t (DEFAULT_MS long,
 * to dur; scenes and cuts are no walls), to be dragged from. -> {list, did: 'add' | 'remove', mod} | null.
 */
export function toggleMod(fx, kind, { t, range = null, id, dur = Infinity, defaultMs = DEFAULT_MS, turns = [], base = null } = {}) {
  const list = Array.isArray(fx) ? fx : [];
  if (!FX_KINDS[kind]?.event) return null;
  if (range && range.t1 > range.t0) {
    const a = Math.round(range.t0), b = Math.round(range.t1), hit = modsOf(list, kind).find((e) => e.t0 === a && e.t1 === b);
    if (hit) return { list: list.filter((e) => e !== hit), did: 'remove', mod: hit };
    const m = makeMod(id, kind, a, b, null, base);
    return { list: [...list, m].sort(byT0), did: 'add', mod: m };
  }
  const under = modAt(list, t, kind);
  if (under) return { list: list.filter((e) => e !== under), did: 'remove', mod: under };
  const end = Math.min(dur, Math.round(t) + defaultMs);
  if (!(end > Math.round(t))) return null;
  // paw-r9nh: the edges on the stroke's nearest turns (turns: [{at}]); the start never after t, so the key again at t finds it
  const g = onTurns({ t0: Math.round(t), t1: end }, turns, 400);
  const m = makeMod(id, kind, Math.min(g.t0, Math.round(t)), Math.min(dur, g.t1), null, base);
  return { list: [...list, m].sort(byT0), did: 'add', mod: m };
}
/**
 * The scene controls (paw-8b4h: the chip, the key, the Scenes row's menu, the tagger's suggestion: "the controls say the
 * same, the what it does differs"): kind over each span (a scene each, or the I / O range). When every span has one of
 * the kind spanning exactly it (what this made), those go off; else each span with none of the kind over it gets one,
 * and one already overlapping a span (trimmed, moved, edited) is picked instead: never replaced, never doubled.
 * newId() -> a fresh id. -> {list (same array when nothing changes), did: 'add' | 'remove' | 'pick', ids (to select)} | null.
 */
export function toggleModOver(fx, kind, spans, newId, base = null) {
  const list = Array.isArray(fx) ? fx : [];
  const sp = spans.map((s) => ({ t0: Math.round(s.t0), t1: Math.round(s.t1) })).filter((s) => s.t1 > s.t0);
  if (!FX_KINDS[kind]?.event || !sp.length) return null;
  const exact = sp.map((s) => modsOf(list, kind).find((e) => e.t0 === s.t0 && e.t1 === s.t1));
  if (exact.every(Boolean)) { const gone = new Set(exact); return { list: list.filter((e) => !gone.has(e)), did: 'remove', ids: [] }; }
  const add = [], ids = [];
  for (const s of sp) {
    const o = modOver(list, kind, s.t0, s.t1);
    if (o) { if (!ids.includes(o.id)) ids.push(o.id); continue; }
    const m = makeMod(newId(), kind, s.t0, s.t1, null, base);
    add.push(m); ids.push(m.id);
  }
  return add.length ? { list: [...list, ...add].sort(byT0), did: 'add', ids } : { list, did: 'pick', ids };
}
/** The tagger's detected modifiers (acts.js detectedMods: orgasm, knotting) with none of the kind over their scene yet:
 *  [{kind, t0, t1}] whole scenes, the Modifiers row's dashed suggestions (paw-ef73.24). Never applied by itself. */
export function modHints(scenes, fx) {
  const out = [];
  for (const [lo, hi] of sceneRuns(scenes || [])) {
    const t0 = scenes[lo].start_ms, t1 = scenes[hi].end_ms;
    for (const kind of new Set(scenes.slice(lo, hi + 1).flatMap(detectedMods))) if (!modOver(fx, kind, t0, t1)) out.push({ kind, t0, t1 });
  }
  return out;
}
/** A spurt placed at t outside every orgasm: the orgasm the hint offers (the nearest one in its scene grown to t, else a
 *  DEFAULT_MS one around t, inside the scene), or null when t is inside one already. -> {grow: modifier | null, t0, t1}. */
export function spurtHint(fx, scenes, t) {
  if (modAt(fx, t, 'orgasm')) return null;
  const S = sceneAround(scenes, t) ?? { t0: t - DEFAULT_MS / 2, t1: t + DEFAULT_MS / 2 };
  const d = (e) => Math.min(Math.abs(e.t0 - t), Math.abs(e.t1 - t));
  const near = modsOf(fx, 'orgasm').filter((e) => e.t1 > S.t0 && e.t0 < S.t1).sort((a, b) => d(a) - d(b))[0];
  return near ? { grow: near, t0: Math.min(near.t0, Math.round(t) - 500), t1: Math.max(near.t1, Math.round(t) + 500) }
    : { grow: null, t0: Math.max(S.t0, Math.round(t) - DEFAULT_MS / 2), t1: Math.min(S.t1, Math.round(t) + DEFAULT_MS / 2) };
}
