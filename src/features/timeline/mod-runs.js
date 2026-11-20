// mod-runs.js -- a modifier's own runs (paw-ef73.26, owner: "right click track>sam/tapnext/etc gets its own seed frame";
// "the best seed frame for motion is not the best seed frame for the insertion, so they need to be different runs").
// Pure (test/mod-runs.test.mjs).
//   Its seed: m.seeds = [{t_ms, groups}] on the modifier itself (doc.fx, undoable, saved in the .pawproj), painted with the
//     Groups tool in its modifier mode (groups.svelte.js forMod): seeds[0] is the seed frame (any frame inside the
//     modifier, independent of the shot's groups and seed frame), every later entry a correction of a SAM run on its
//     own frame (each correction is one more SAM prompt: sidecar v4.39 `fixes`). The groups are the Groups tool's own
//     objects (name, poly, mask, who, part, side, t_ms).
//   Its runs: tracker runs over just its range, both ways from seeds[0] (tracking.svelte.js runTrack with these
//     groups; run.mod = the modifier's id, run.tag 'mod', run.seeds = the frames prompted). They never replace the shot's
//     run (their ghost is of kind 'modrun': no shot, plan, link or lane takes them), several may coexist.
// The part to paint per kind: ARM (the first is armed; knotting, its push / pull too, also wants the opening it enters:
// the inside fraction needs both).
import { isBlank, isOffscreen } from './acts.js';

/** [who, part] to paint, per kind: the first is armed when the tool opens, the rest are named in its hint. */
export const ARM = {
  orgasm: [['c2', 'balls'], ['c2', 'penis']],
  throbbing: [['c2', 'penis'], ['c2', 'balls']],
  knotting: [['c2', 'penis'], ['c1', 'anus']],   // paw-njnf: the knot is a section of the penis (K), never a part to arm
};
/** Kinds whose depth is how much of the shaft is inside (a SAM mask of the shaft + the opening measures it). */
export const INSIDE = new Set(['knotting']);
export const SAM = 'sam2_mask';
const WORD = { sam2_mask: 'SAM', tapnext_points: 'TAPNext', cotracker_points: 'CoTracker' };
/** A tracker's short word ('SAM', 'TAPNext', its name up to a bracket). */
export const trackerWord = (t) => WORD[t?.id ?? t] ?? String(t?.name ?? t ?? '').split(/\s*[(:]/)[0];

/** The trackers that make sense for a modifier: SAM mask first (area / inside), then the ones that take a painted seed
 *  (the points trackers: sem_groups); a box-only tracker cannot (no box here). -> [{id, label, tip}]. */
export function trackChoices(trackers = []) {
  const out = [], sam = trackers.find((t) => t.id === SAM);
  if (sam) out.push({ id: SAM, label: 'SAM mask', tip: 'The painted part as a mask, correctable per frame' });
  for (const t of trackers) if (t.id !== SAM && t.params?.some((p) => p.key === 'sem_groups')) out.push({ id: t.id, label: `${trackerWord(t)} points`, tip: `${t.name}: points on the painted parts` });
  return out;
}

/** The frame to paint the seed on: inside the modifier, in the shot under the playhead when it meets it and shows the act
 *  (not blank / off-screen), else its first such shot; the middle of their overlap. snap(t) -> a frame time. -> ms | null. */
export function seedFrameFor(m, scenes = [], here = -1, snap = (t) => t) {
  const ok = (s) => s && s.end_ms > m.t0 && s.start_ms < m.t1 && !isBlank(s) && !isOffscreen(s);
  const s = ok(scenes[here]) ? scenes[here] : scenes.find(ok);
  if (!s) return scenes.length ? null : Math.round(snap((m.t0 + m.t1) / 2));
  return Math.round(snap((Math.max(s.start_ms, m.t0) + Math.min(s.end_ms, m.t1)) / 2));
}

const named = (g) => g && !g.off && g.poly?.length >= 3 && !!g.who && !!g.part;
/** The modifier's seed entries, cleaned (a stored list from a file: entries with a frame and a group list). */
export const seedsOf = (m) => (Array.isArray(m?.seeds) ? m.seeds.filter((s) => Number.isFinite(s?.t_ms) && Array.isArray(s.groups)) : []);
/** Its painted seed is usable: the seed frame has at least one named part. */
export const hasSeed = (m) => !!seedsOf(m)[0]?.groups.some(named);
/** The index of the seed entry on frame t (within tol ms), else -1. */
export const seedAt = (m, t, tol = 20) => seedsOf(m).findIndex((s) => Math.abs(s.t_ms - t) <= tol);
/** The modifier with seed entry k's groups replaced (k = the next index: a new entry on frame t). An emptied correction
 *  goes; an emptied seed frame keeps its frame (the next stroke repaints it). -> modifier. */
export function setSeed(m, k, groups, t) {
  const list = seedsOf(m).slice(), at = groups.find((g) => Number.isFinite(g.t_ms))?.t_ms ?? list[k]?.t_ms ?? Math.round(t);
  if (k > 0 && !groups.length) list.splice(k, 1);
  else list[k] = { t_ms: at, groups };
  const { seeds: _s, ...rest } = m;   // eslint-disable-line no-unused-vars
  return list.length ? { ...rest, seeds: list } : rest;
}

/**
 * The track request's groups (sidecar v4.11 / v4.39) for a modifier: its seed frame's named parts on their frame, each
 * with its corrections (the same group name painted on a later seed entry) as `fixes`. points: the tracker is a points
 * tracker (a penis of an insertion-like modifier then asks for the shaft pass too). -> [{name, poly, pinned, t_ms, who,
 * part, side?, fixes?, shaft?}].
 */
export function modGroups(m, { points = false } = {}) {
  const [seed, ...fixes] = seedsOf(m);
  if (!seed) return [];
  return seed.groups.filter(named).map((g) => {
    const fx = points ? [] : fixes.flatMap((s) => s.groups.filter((q) => q.name === g.name && named(q)).map((q) => ({ t_ms: Math.round(s.t_ms), poly: q.poly })));
    return { name: g.name, poly: g.poly, pinned: true, t_ms: Math.round(seed.t_ms), who: g.who, part: g.part, ...(g.side ? { side: g.side } : {}),
      ...(fx.length ? { fixes: fx } : {}), ...(points && g.part === 'penis' && INSIDE.has(m.kind) ? { shaft: true } : {}) };
  });
}

/** The run a modifier's Track makes: {tracker, range {start, end}, roi (the whole frame, its frame the seed), groups, seed}
 *  | {why} (nothing to track yet). */
export function modTrackPlan(m, trackerId) {
  if (!ARM[m?.kind]) return { why: 'This modifier is generated only' };
  const seed = seedsOf(m)[0];
  if (!hasSeed(m)) return { why: 'Paint its part first' };
  const groups = modGroups(m, { points: trackerId !== SAM });
  const t = Math.min(m.t1 - 1, Math.max(m.t0, Math.round(seed.t_ms)));
  return { tracker: trackerId, range: { start: Math.round(m.t0), end: Math.round(m.t1) }, roi: { kind: 'box', x: 0, y: 0, w: 1, h: 1, t_ms: t }, groups, seed: t, seeds: seedsOf(m).map((s) => Math.round(s.t_ms)) };
}

/** The modifier's own runs (newest last). */
export const ownRuns = (runs = [], m) => runs.filter((r) => r?.mod && r.mod === m?.id);

/** The run's tracked mask polygons of object `name` on its frame nearest t (within 1.5 frames): the correction's start.
 *  run.frames.ov[i] = {masks, mask_of}; the run's groups give the object order. -> [[x, y], ...] (the largest) | null. */
export function maskAt(run, t, name, frameMs = 1000 / 30) {
  const fr = run?.frames, order = run?.modGroups || [];
  if (!fr?.t?.length) return null;
  let i = 0;
  for (let j = 1; j < fr.t.length; j++) if (Math.abs(fr.t[j] - t) < Math.abs(fr.t[i] - t)) i = j;
  if (Math.abs(fr.t[i] - t) > 1.5 * frameMs) return null;
  const ov = fr.ov[i], k = order.indexOf(name);
  if (!ov?.masks?.length || k < 0) return null;
  const area = (p) => Math.abs(p.reduce((s, q, j) => { const r = p[(j + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
  const mine = ov.masks.filter((_, j) => (ov.mask_of?.[j] ?? 0) === k).sort((a, b) => area(b) - area(a));
  return mine[0] ?? null;
}

/** What a modifier's own run measures, as a Tracker-row trace: the shaft's inside fraction drawn as depth (1 - in: pos 0 =
 *  deepest, at the bottom; NaN where SAM is not confident), else the first painted part's area against its seed frame
 *  (vis, scaled to its largest), else its scale channel. -> {ch, t, v (0..1 lane values), label} | null. */
export function modMeasure(run) {
  const C = run?.channels || {}, names = run?.modGroups || [];
  const shaft = names.find((n) => C[`sem_${n}_in`] && C[`sem_${n}_in_conf`]);
  if (shaft) {
    const c = C[`sem_${shaft}_in`], cf = C[`sem_${shaft}_in_conf`];
    return { ch: `sem_${shaft}_in`, t: c.t, v: Float32Array.from(c.v, (x, i) => (x == null || x !== x || !(cf.v[i] >= 0.5) ? NaN : 1 - x)), label: 'inside' };
  }
  for (const [suf, label] of [['vis', 'area'], ['scale', 'scale']]) {
    const n = names.find((q) => C[`sem_${q}_${suf}`]), c = n && C[`sem_${n}_${suf}`];
    if (!c) continue;
    let lo = Infinity, hi = -Infinity;
    for (const x of c.v) if (x != null && x === x) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    return { ch: `sem_${n}_${suf}`, t: c.t, v: Float32Array.from(c.v, (x) => (x == null || x !== x ? NaN : (x - lo) / (hi - lo || 1))), label };
  }
  return null;
}

// ---- stage 4: the modifier's measure into the script (owner: "the sam run + tapnext points would give accurate area +
// motion") ----
// Over a knotting modifier (its push / pull too) with an ASSIGNED source that measures how much of the shaft is inside
// (its own SAM run, or a shaft of the shot's run: src {run, ch: 'sem_<name>_in'}), the shot's signal takes that depth
// where SAM is confident, cross-faded at the modifier's ends and wherever the confidence drops, through the range
// override splice (lib/signal-source.js splice, BLEND_MS; runs-channel channelPatch): the shot's fused stroke signal keeps
// the timing outside, and inside where the measure is weak. The modifier's own curve then stays out of the way (the depth
// is in the points); the owner's own curve settings (any param but mode) win: then it is today's fitted curve instead.
// No assignment (or a default one), muted / baked, under MEASURE_SHARE confident: nothing changes.
export const MEASURE_SHARE = 0.3;
const CONF_LO = 0.3, CONF_HI = 0.6;   // the measure's weight ramps from 0 to 1 over this confidence (CONF_MIN 0.5 inside)
/** The owner set the curve by hand (any param but the knotting mode; a push / pull's `to` is how it was made). */
export const ownCurve = (m) => Object.keys(m?.params || {}).some((k) => k !== 'mode' && !(k === 'to' && m.params.mode === 'none'));
/** Modifier m's measured depth from run (its src.ch, else its first shaft): {t, v (depth: 1 - inside, larger = out),
 *  w (0..1 weight from the confidence)} over [m.t0, m.t1], or null (not a measure, or confident under MEASURE_SHARE). */
export function measureOf(m, run) {
  if (!INSIDE.has(m?.kind) || !run?.channels || m.muted || m.baked || ownCurve(m) || m.params?.mode === 'cycles') return null;
  const name = m.src?.ch && /^sem_.+_in$/.test(m.src.ch) ? m.src.ch : Object.keys(run.channels).find((k) => /^sem_.+_in$/.test(k) && run.channels[k + '_conf']);
  const c = name && run.channels[name], cf = name && run.channels[name + '_conf'];
  if (!c?.t?.length || !cf) return null;
  const t = [], v = [], w = [];
  let ok = 0;
  for (let i = 0; i < c.t.length; i++) {
    if (c.t[i] < m.t0 || c.t[i] >= m.t1) continue;
    const x = c.v[i], q = cf.v[i];
    t.push(c.t[i]); v.push(x == null || x !== x ? NaN : 1 - x);
    const wt = x == null || x !== x || !(q >= 0) ? 0 : Math.min(1, Math.max(0, (q - CONF_LO) / (CONF_HI - CONF_LO)));
    w.push(wt); if (q >= 0.5 && x === x && x != null) ok++;
  }
  return t.length && ok / t.length >= MEASURE_SHARE ? { t: Float64Array.from(t), v: Float32Array.from(v), w: Float32Array.from(w), share: ok / t.length } : null;
}
/** The range overrides the modifiers' measures add to a shot run's signal: [{t0, t1, ch, mod}] (ch as splice takes it;
 *  JSON names the modifier, its run and channel only: the compose key). runs: every run (by id). */
export function measureSpans(fx = [], runs = []) {
  const out = [];
  for (const m of fx) {
    const r = m?.src?.run && runs.find((x) => x.id === m.src.run), ch = r && measureOf(m, r);
    if (!ch) continue;
    const key = { t0: Math.round(m.t0), t1: Math.round(m.t1), mod: m.id, run: r.id, ch: m.src.ch || '', n: ch.t.length };
    out.push({ t0: key.t0, t1: key.t1, ch, mod: m.id, toJSON: () => key });
  }
  return out;
}
