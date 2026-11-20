// autorange.js -- "how much of the range each scene uses", pure. rangePlan() walks the scenes, groups them into act
// runs and gives every scene a depth band (lo = deep end, hi = out end; pos 0 = deepest, 100 = out) from a small policy
// table (RULES, first match wins): build-up over a run, shallower oral / handjob, the knot's reserve (by how much of
// the run is knotting), the deepest band for the orgasm, rest for structure scenes, a high rest band for exposed (dick out,
// no act: the Throb rides on it). rangePass() is the live pass of the finishing stack (lib/finish.js): every tracked
// piece of a scene (the scene minus its knotting effects; after a single knot the tie holds deep) remapped into its
// band (sliding lo -> lo1 / hi -> hi1 over the scene), depth-aware (pieceMap: the strokes' own depth is signal),
// recomputed from the current points whenever anything changes; nothing is ever baked. Gaps (an act scene with no points and no run) get a suggestion from the act's recipe inside
// its band (gapScript), never applied by itself.
// The user's own band for a scene is scene.range {lo, hi, lo1?, hi1?} (lo1 / hi1 = at the scene's end): it wins.
// scene.range {off: true} = flattened (Flatten wrote the final into its points): the pass leaves it alone.
import { lowerBound } from './core/script.js';
import { baseTurns, fxParams, knotMode } from './fx.js';
import { resolveSegment } from './gen/recipes.js';
import { clamp, median, hashSeed } from './gen/util.js';
import { sceneTags, tagSpan, tagSpansIn, actKind, sceneStructure, sceneView } from '../features/timeline/acts.js';
import { FILL_MODES } from './scenes-continue.js';
import { SHARE_MIN } from './shaft.js';
import { outside } from './autorange-env.js';
import { shotAnchors } from './anchors.js';

/** The tool's knobs (app settings 'autorange.policy'). buildUp = share of an act run before it reaches full depth (0 =
 *  no build-up); knotReserve = the bottom kept for the knot in a knot-heavy run (the maximum: a run gets a share of it by
 *  its knotting density); floor = the machine's insertion limit (pos); device 'stroker' | 'machine'. */
export const POLICY = Object.freeze({ device: 'stroker', buildUp: 0.6, knotReserve: 15, floor: 20, ...CONTROLS_DEFAULT() });
/** The finer controls (the policy editor's handles; every default leaves the plan as it was): width = band amplitude
 *  scale (0.5..1.2), offset = every act band slid up (+) / down (-), ease = strokes a new run takes to ease in from the
 *  band before (0..2), orgasmLo / orgasmHi = the orgasm band, tie = the tie's out end after a single knot (null = the
 *  knot reserve), ladders = per family {lo0, hi0, lo1, hi1, at} (start band, full band, build-up share; unset = the
 *  table / buildUp), teaseShare / teasePeriod = the dead-gap tease (share of the band from its top, ms per stroke),
 *  strength = the live pass's strength (0 = the points as they are, 1 = the full remap; a scene's range.strength
 *  scales it), keep = how much of a tracked scene's own depth stays where it already sits well in its band (rangePass). */
function CONTROLS_DEFAULT() { return { width: 1, offset: 0, ease: 0, orgasmLo: 0, orgasmHi: 45, tie: null, ladders: null, teaseShare: 0.2, teasePeriod: 3000, strength: 1, keep: 0.8 }; }
/** A dead span longer than this inside a tracked scene gets a tease offered (shorter: a pause, it stays). */
export const HOLE_MS = 5000;
/** Knotting density (share of a run's time in knotting) below LOW: no reserve; above HIGH: the full reserve. */
export const KNOT_DENSITY = Object.freeze({ low: 0.1, high: 0.4 });
export const DEVICE = {
  stroker: { amp: 1, speed: 1, reach: 1 },          // full 0-100, generous amplitude
  machine: { amp: 0.85, speed: 0.8, reach: 1.5 },   // insertion-limited: floor, tighter bands, slower to the floor
};
// build-up ladders [progress, lo, hi, stage]: progress 0..1 through the run (after policy.buildUp's stretch)
export const LADDERS = {
  penetration: [[0, 65, 100, 'tip only'], [1 / 3, 40, 95, 'lower in'], [2 / 3, 10, 90, 'deep'], [1, 0, 100, 'full']],
  oral: [[0, 70, 100, 'tip'], [0.5, 55, 98, 'halfway'], [1, 40, 95, 'deep throat']],
  foreplay: [[0, 55, 95, 'hand']],
};
const ORGASM = [0, 45], REST = 100, EXPOSED = [85, 100], INSERT_TO = fxParams({ kind: 'insertion' }).to;
// gap fill: act family -> plan kind (gen/recipes.js KINDS -> its recipe)
const GAP_KIND = { penetration: 'penetration', oral: 'oral', foreplay: 'foreplay', knotting: 'knotting', orgasm: 'orgasm' };
const r0 = Math.round;

/** A ladder at progress p (0..1): {lo, hi, stage} (linear between its rungs). */
export function ladderAt(L, p) {
  let k = 0;
  while (k + 1 < L.length && L[k + 1][0] <= p) k++;
  const a = L[k], b = L[k + 1];
  if (!b) return { lo: a[1], hi: a[2], stage: a[3] };
  const u = (p - a[0]) / (b[0] - a[0]);
  return { lo: a[1] + (b[1] - a[1]) * u, hi: a[2] + (b[2] - a[2]) * u, stage: a[3] };
}

/** The family's ladder with the policy's handles (policy.ladders[fam] {lo0, hi0, lo1, hi1}: the start / full band):
 *  every rung moves by the blend of the start and full changes (the table's shape kept). -> ladder rungs. */
export function ladderOf(fam, P = POLICY) {
  const L = LADDERS[fam], o = P?.ladders?.[fam];
  if (!L || !o) return L;
  const a = L[0], z = L[L.length - 1], R = L.length > 1 ? L : [...L, [1, a[1], a[2], a[3]]];
  const dl0 = (o.lo0 ?? a[1]) - a[1], dl1 = (o.lo1 ?? z[1]) - z[1], dh0 = (o.hi0 ?? a[2]) - a[2], dh1 = (o.hi1 ?? z[2]) - z[2];
  return R.map(([p, lo, hi, st]) => {
    const l = clamp(lo + dl0 * (1 - p) + dl1 * p, 0, 100), h = clamp(hi + dh0 * (1 - p) + dh1 * p, 0, 100);
    return [p, Math.min(l, h), Math.max(l, h), st];
  });
}
/** The share of a run before the family reaches full depth (its ladder's own `at`, else policy.buildUp). */
export const buildUpOf = (fam, P = POLICY) => P?.ladders?.[fam]?.at ?? P?.buildUp ?? POLICY.buildUp;

/** The scene's act family: 'oral' | 'foreplay' | 'penetration' (any other act, knotting) | 'exposed' (dick out, no act:
 *  in no run) | null (no act). */
function familyOf(s) {
  const k = actKind(s), tags = sceneTags(s);
  if (k === 'exposed') return 'exposed';
  if (k === 'oral') return 'oral';
  if (k === 'foreplay') return 'foreplay';
  return k || tags.includes('knotting') || tags.includes('orgasm') ? 'penetration' : null;
}
const hasPoints = (script, t0, t1) => { const k = lowerBound(script, t0 + 1); return k < script.length && script[k].at < t1; };

/** Turn statistics of script inside [t0, t1] (skip: spans left out): {turns, min, max, median, amp (median |Δpos| turn to turn), halfMs}. */
export function turnStats(script, t0, t1, skip = null) {
  const T = outside(baseTurns(script, t0, t1), skip), pos = T.map((x) => x.pos);
  if (!T.length) return { turns: 0 };
  const d = T.slice(1).map((x, i) => Math.abs(x.pos - T[i].pos)), h = T.slice(1).map((x, i) => x.at - T[i].at);
  return { turns: T.length, min: Math.min(...pos), max: Math.max(...pos), median: median(pos), amp: d.length ? median(d) : 0, halfMs: h.length ? median(h) : 0 };
}

/** Length of the union of [t0, t1] intervals clipped to [a, b]. */
function covered(iv, a, b) {
  const s = iv.map(([x, y]) => [Math.max(a, x), Math.min(b, y)]).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
  let tot = 0, end = -Infinity;
  for (const [x, y] of s) { if (y <= end) continue; tot += y - Math.max(x, end); end = y; }
  return tot;
}
/** Knotting spans of the list: knotting effects (cycles count in full, a single knot its own span) and knotting tag
 *  spans holding no single knot. -> [[t0, t1]] */
function knotSpans(scenes, script, fx) {
  const eff = (fx || []).filter((e) => e?.kind === 'knotting' && !e.muted && e.t1 > e.t0);
  const single = eff.filter((e) => knotMode(fxParams(e), script, e.t0, e.t1) === 'single');
  const tags = scenes.map((s) => tagSpan(s, 'knotting')).filter((sp) => sp && !single.some((e) => e.t0 < sp.t1 && e.t1 > sp.t0));
  return [...eff.map((e) => [e.t0, e.t1]), ...tags.map((sp) => [sp.t0, sp.t1])];
}

/**
 * The policy table: the first rule whose `test` holds sets the scene's band. c = {s, tags, fam, run, u0, u1, prev, P, dev}
 * -> band {lo, hi, lo1?, hi1?} in ladder space (0..100 before the machine's floor; final: true = already on the device's
 * scale: the user's own, the scene before's), reason text. `apply: false` = no
 * effect (the bridge / hold decides).
 */
export const RULES = [
  { id: 'manual', test: (c) => c.s.range?.lo != null, band: (c) => ({ ...c.s.range, final: true }), reason: () => 'manual (double-click resets to the policy)' },
  // an off-screen shot with points (an accepted fill or bridge) or a fill set: the act goes on unseen -- ranged, its band
  // eased from the band before to the band after (rangePlan's last pass), the depth map leaning on the band (copied depth)
  { id: 'unseen', test: (c) => c.view === 'offscreen' && (c.pts || FILL_MODES.includes(c.s.fill)), band: (c) => ({ ...(c.prev ?? { lo: REST, hi: REST }), final: true }),
    reason: (c) => (c.s.fill === 'timing' ? 'off-screen, timing from its own motion' : 'off-screen, bridged') },
  { id: 'inherit', test: (c) => c.view === 'offscreen' || c.view === 'blank', apply: false, band: (c) => ({ ...(c.prev ?? { lo: REST, hi: REST }), final: true }),
    reason: (c) => `${c.view}: inherits (the bridge / hold decides)` },
  { id: 'rest-after', test: (c) => c.st === 'after' || c.st === 'outro', band: (c) => (c.prev ? { lo: c.prev.lo1, hi: c.prev.hi1, lo1: REST, hi1: REST, final: true } : { lo: 60, hi: REST, lo1: REST, hi1: REST }),
    reason: (c) => `${c.st}: eases to rest (100) and holds` },
  { id: 'rest', test: (c) => c.st === 'intro' || c.st === 'idle', band: () => ({ lo: REST, hi: REST }), reason: (c) => `${c.st}: rest (100)` },
  { id: 'insertion', test: (c) => c.tags.includes('insertion'), apply: false, band: (c) => ({ lo: c.prev?.lo1 ?? REST, hi: c.prev?.hi1 ?? REST, lo1: INSERT_TO, hi1: INSERT_TO, final: true }),
    reason: () => 'insertion: one push, no strokes to range (its depth is the Insertion modifier)' },
  { id: 'pullout', test: (c) => c.tags.includes('pullout'), apply: false, band: (c) => ({ lo: c.prev?.lo1 ?? REST, hi: c.prev?.hi1 ?? REST, lo1: REST, hi1: REST, final: true }),
    reason: () => 'pull-out: one pull, no strokes to range (its depth is the Pull-out modifier)' },
  { id: 'orgasm', test: (c) => c.tags.includes('orgasm'), band: (c) => ({ lo: c.P.orgasmLo ?? ORGASM[0], hi: c.P.orgasmHi ?? ORGASM[1] }), reason: () => 'orgasm: the deepest band of the run (spurts ride on it untouched)' },
  { id: 'exposed', test: (c) => c.fam === 'exposed', band: () => ({ lo: EXPOSED[0], hi: EXPOSED[1] }),
    reason: () => `exposed: rest band ${EXPOSED[0]}–${EXPOSED[1]} (no strokes; the Throb sits on top)` },
  { id: 'build-up', test: (c) => !!LADDERS[c.fam], band: (c) => {
    const bu = buildUpOf(c.fam, c.P), L = ladderOf(c.fam, c.P);
    const reach = bu > 0 ? Math.min(1, bu * c.dev.reach) : 0, p = (u) => (reach > 0 ? Math.min(1, u / reach) : 1);
    const a = ladderAt(L, p(c.u0)), b = ladderAt(L, p(c.u1));
    c.stage = a.stage === b.stage ? a.stage : `${a.stage} → ${b.stage}`;
    return { lo: a.lo, hi: a.hi, lo1: b.lo, hi1: b.hi };
  }, reason: (c) => `${c.fam === 'penetration' ? (c.untagged ? 'untagged (penetration ladder)' : 'penetration') : c.fam}: ${c.stage} (scene ${c.run.n + 1} of ${c.run.k} in the run)` },
];

/**
 * Per scene: {i, t0, t1, lo, hi, lo1, hi1 (the band at the scene's end), reason, rule, tags, family, source: 'tracked'
 * | 'gap' | 'none', stats, run: {id, n, k, family, density, floor}, pieces: [{t0, t1, lo, hi, lo1, hi1}] (the Reshape
 * spans: the scene minus its knotting effects; after a single knot the tie holds deep)}. Deterministic.
 * opts: profile (device profile: range, maxSpeed, device?), policy (POLICY keys), fx (doc.fx: knotting effects),
 * linked(i) (scene i has a tracker run: not a gap), maxSpeed (pos/s, default the profile's, else 400), shafts (shot index
 * -> {share, conf: channel {t, v}} from the shot's run: lib/shaft.js; the app's finishEnv gives it).
 */
export function rangePlan(scenes, script = [], { profile = null, policy = {}, fx = [], linked = () => false, lowMotion = () => false, maxSpeed, shafts = null } = {}) {
  const P = { ...POLICY, ...policy }, devId = profile?.device === 'machine' || profile?.device === 'stroker' ? profile.device : P.device === 'machine' ? 'machine' : 'stroker';
  const dev = DEVICE[devId], cap = maxSpeed ?? profile?.maxSpeed ?? 400;
  const F = devId === 'machine' ? clamp(Math.max(P.floor ?? 0, profile?.range?.[0] ?? 0), 0, 90) : 0;
  const squash = (v) => F + (v * (100 - F)) / 100;   // ladder space -> the device's usable 0..100
  // ---- runs: same act family in a row; cutaways (off-screen / blank) are transparent, a structure scene or an orgasm
  // ends one, a continuing scene always rejoins
  const info = scenes.map((s, i) => {
    const t0 = s.start_ms, t1 = s.end_ms, pts = hasPoints(script, t0, t1);
    return { s, i, t0, t1, pts, tags: sceneTags(s), view: sceneView(s), st: sceneStructure(s), fam: s.tease ? null : familyOf(s), stats: turnStats(script, t0, t1, s.positioning) };
  });
  const runs = [];
  let cur = null;
  for (const c of info) {
    if (c.view === 'offscreen' || c.view === 'blank' || c.s.tease) continue;   // a teased dead gap is no act either
    if (c.st) { cur = null; continue; }
    if (c.fam === 'exposed') continue;   // dick out, no act: in no run, and transparent like a cutaway
    if (!c.fam && c.pts) { c.fam = cur?.family ?? 'penetration'; c.untagged = true; }
    if (!c.fam) continue;
    if (!cur || (cur.family !== c.fam && !c.s.continues)) runs.push((cur = { id: runs.length, family: c.fam, members: [] }));
    c.run = cur; cur.members.push(c);
    if (c.tags.includes('orgasm')) cur = null;
  }
  const kn = knotSpans(scenes, script, fx);
  for (const r of runs) {
    const k = r.members.length, span = r.members.reduce((a, c) => a + c.t1 - c.t0, 0);
    r.density = span > 0 ? r.members.reduce((a, c) => a + covered(kn, c.t0, c.t1), 0) / span : 0;
    const f = clamp((r.density - KNOT_DENSITY.low) / (KNOT_DENSITY.high - KNOT_DENSITY.low), 0, 1);
    r.reserve = f * P.knotReserve;
    r.floor = f > 0 ? r.reserve + 5 * f : 0;   // the ordinary strokes stay above the reserve: each pop reads deeper
    r.amp = median(r.members.filter((c) => c.stats.turns >= 3).map((c) => c.stats.amp));
    r.members.forEach((c, n) => { c.n = n; c.u0 = n / k; c.u1 = (n + 1) / k; });
  }
  // ---- bands
  const out = [];
  let prev = null;
  for (const c of info) {
    // an orgasm span over part of the shot: the shot keeps its own rule, the span is an overlay (autorange-env envelope)
    const og = c.tags.includes('orgasm') ? tagSpansIn(c.s, 'orgasm') : [], ogPart = og.length > 0 && covered(og.map((x) => [x.t0, x.t1]), c.t0, c.t1) < c.t1 - c.t0 - 50;
    const ctx = { ...c, tags: ogPart ? c.tags.filter((t) => t !== 'orgasm') : c.tags, run: c.run ? { ...c.run, n: c.n, k: c.run.members.length } : null, prev, P, dev };
    const rule = RULES.find((r) => r.test(ctx)) ?? null;
    const gap = !c.pts && !!c.run && !c.untagged && !linked(c.i) && rule?.id !== 'manual';
    const off = !!c.s.range?.off;   // flattened: its points are final
    const source = !off && rule && rule.apply !== false && (c.pts || gap) ? (c.pts ? 'tracked' : 'gap') : 'none';
    let b = rule ? rule.band(ctx) : { ...(prev ?? { lo: REST, hi: REST }), final: true };
    const final = !!b.final;
    b = { lo: b.lo, hi: b.hi, lo1: b.lo1 ?? b.lo, hi1: b.hi1 ?? b.hi };
    const notes = off ? ['left as it is: its points play unranged (flattened or cleared; double-click: back to the policy)'] : [];
    const auto = !!rule && !final;
    if (auto && c.run && c.run.floor > 0 && rule.id === 'build-up') {   // knot-heavy run: ordinary strokes above the reserve
      for (const k of ['lo', 'lo1']) b[k] = Math.max(b[k], c.run.floor);
      notes.push(`knotting ${r0(100 * c.run.density)} % of this run → floor ${r0(c.run.floor)}`);
    } else if (auto && c.run && c.run.density > 0 && rule.id === 'build-up') notes.push(`knotting ${r0(100 * c.run.density)} % of this run → no reserve`);
    if (auto && rule.id !== 'rest' && rule.id !== 'rest-after' && rule.id !== 'exposed') {
      const st = c.stats, anchor = (lo, hi, w) => [hi - w, hi];   // shrink from the deep end (the out end stays)
      let w = 1;
      if (st.turns >= 3 && c.run?.amp > 0 && st.amp < 0.6 * c.run.amp) { w = clamp(st.amp / (0.6 * c.run.amp), 0.4, 1); notes.push(`small strokes (${r0(st.amp)} vs ${r0(c.run.amp)} in the run): band ×${w.toFixed(2)}`); }
      w *= dev.amp * clamp(P.width ?? 1, 0.5, 1.2);
      for (const [lo, hi] of [['lo', 'hi'], ['lo1', 'hi1']]) {
        let width = (b[hi] - b[lo]) * w;
        if (st.turns >= 3 && st.halfMs > 0 && cap > 0) {
          const max = (cap * st.halfMs * dev.speed) / 1000;
          if (width > max) { width = max; if (lo === 'lo') notes.push(`fast (${r0(st.halfMs)} ms half-strokes): band ${r0(max)} wide for ${cap}/s`); }
        }
        [b[lo], b[hi]] = anchor(b[lo], b[hi], width);
      }
      // slide the band (each value clamped to 0..100 on its own: a scene still ends where the next begins)
      if (P.offset) for (const k of ['lo', 'hi', 'lo1', 'hi1']) b[k] = clamp(b[k] + P.offset, 0, 100);
    }
    // paw-wg2d / paw-ze8n: the owner's anchors (lib/anchors.js) are a known depth AROUND them, not the policy's guess: the pieces
    // near a cluster of anchors (ANCHOR_REACH) reach 0 / 100 at that end (the machine's floor still applies), the rest of the
    // shot keeps its band. A hand-set band (manual) still wins
    const an = !final ? shotAnchors(c.s) : [];
    if (an.some((a) => a.pos === 0)) notes.push('anchored fully in around its anchors');
    if (an.some((a) => a.pos === 100)) notes.push('anchored fully out around its anchors');
    if (!final) for (const k of ['lo', 'hi', 'lo1', 'hi1']) b[k] = squash(b[k]);
    for (const k of ['lo', 'hi', 'lo1', 'hi1']) b[k] = clamp(r0(b[k]), r0(F), 100);   // a machine's floor holds even for a dragged band
    // pieces: the scene minus its knotting effects; after a single knot the tie holds deep (floor .. floor + reserve)
    const pieces = [];
    const last = out[out.length - 1];
    if (source === 'tracked' && c.s.tease) notes.push('teased (a dead gap filled): no reshape');
    if (source === 'tracked' && !c.s.tease) {
      const bandAt = (t) => { const u = (t - c.t0) / Math.max(1, c.t1 - c.t0); return [r0(b.lo + (b.lo1 - b.lo) * u), r0(b.hi + (b.hi1 - b.hi) * u)]; };
      const knots = (fx || []).filter((e) => e?.kind === 'knotting' && !e.muted && e.t0 < c.t1 && e.t1 > c.t0).sort((x, y) => x.t0 - y.t0);
      let t = c.t0, tie = false;
      // a new run eases in from the band before over policy.ease strokes (its first piece split)
      let easeMs = P.ease > 0 && c.n === 0 && rule?.id === 'build-up' && last?.source === 'tracked' && last.t1 >= c.t0 - 1 && last.run?.id !== c.run?.id
        ? Math.min(P.ease * 2 * (c.stats.halfMs || 500), (c.t1 - c.t0) / 2) : 0;
      if (easeMs >= 2) notes.push(`eases in from S${last.i + 1} over ${+P.ease.toFixed(1)} stroke${P.ease === 1 ? '' : 's'}`);
      const push = (a, z) => {
        if (z - a < 2) return;
        if (tie) { const lo = r0(squash(0)), hi = r0(squash(P.tie ?? P.knotReserve)); pieces.push({ t0: a, t1: z, lo, hi, lo1: lo, hi1: hi, tie: true }); return; }
        if (easeMs >= 2 && a === c.t0 && z - a > easeMs + 2) {
          const e = r0(a + easeMs), [lo1, hi1] = bandAt(e);
          pieces.push({ t0: a, t1: e, lo: last.lo1, hi: last.hi1, lo1, hi1, ease: true });
          a = e + 1;
        }
        easeMs = 0;
        const [lo, hi] = bandAt(a), [lo1, hi1] = bandAt(z);
        pieces.push({ t0: a, t1: z, lo, hi, lo1, hi1 });
      };
      for (const e of knots) { push(t, Math.min(c.t1, e.t0)); t = Math.max(t, e.t1 + 1); tie = knotMode(fxParams(e), script, e.t0, e.t1) === 'single'; }
      push(t, c.t1 - 1);
      if (knots.length) notes.push(`knot span${knots.length > 1 ? 's' : ''} left to the Knotting modifier`);
      if (an.length) pieces.splice(0, pieces.length, ...anchorPieces(pieces, an, c.t0, c.t1 - 1, r0(squash(0)), 100));
    }
    const row = { i: c.i, t0: c.t0, t1: c.t1, ...b, rule: rule?.id ?? null, reason: [rule ? rule.reason(ctx) : 'nothing to range', ...notes].join('; '),
      tags: c.tags, family: c.fam, source, stats: c.stats, manual: c.s.range?.lo != null, off, pieces,
      // the pass: a filled scene's depth is not tracked (lean on the band); the scene's own strength scales the policy's
      shaft: shaftOfShot(c.s, shafts?.[c.i]),
      trust: c.s.fill || c.view === 'offscreen' ? 0 : clamp(P.keep ?? 0.8, 0, 1), strength: clamp((P.strength ?? 1) * (c.s.range?.strength ?? 1), 0, 1),
      policyStrength: clamp(P.strength ?? 1, 0, 1), sceneStrength: clamp(c.s.range?.strength ?? 1, 0, 1), cap,
      // the envelope's overlays: the orgasm band (squashed), the deepest the device goes, a knot-heavy run's reserve
      orgasm: [r0(squash(P.orgasmLo ?? ORGASM[0])), r0(squash(P.orgasmHi ?? ORGASM[1]))], deep: r0(F), knotFloor: !!(c.run && c.run.floor > 0),
      run: c.run ? { id: c.run.id, n: c.n, k: c.run.members.length, family: c.run.family, density: c.run.density, floor: r0(squash(c.run.floor)) } : null,
      ...(c.s.positioning ? { skip: c.s.positioning } : {}) };   // paw-2lp7.1: the depth pieces read no turn there (autorange-env.js envOf)
    if (source === 'gap') { row.kind = c.tags.includes('orgasm') ? 'orgasm' : c.tags.includes('knotting') ? 'knotting' : GAP_KIND[c.fam]; row.recipe = resolveSegment({ kind: row.kind }).recipeId; }
    // dead gaps -> a tease at the top of the band: a scene with no act and no points, a run with almost no motion,
    // and long spans of a tracked scene with no points (act gaps keep their act recipe)
    row.tease = [];
    if (!c.s.tease && c.view !== 'offscreen' && c.view !== 'blank' && source !== 'gap' && rule?.id !== 'insertion') {   // a slow push has long point gaps: no tease
      const why = lowMotion(c.i) ? 'almost no motion' : !c.pts && !c.run && !c.fam && !linked(c.i) ? 'no act' : null;
      if (why) row.tease.push({ t0: c.t0, t1: c.t1, why, whole: true });
      // paw-2lp7.1: a hole over a positioning range is no dead gap (the ease goes there)
      else if (c.pts) row.tease.push(...holesOf(script, c.t0, c.t1).filter((h) => !c.s.positioning?.some(([a, b]) => a < h.t1 && b > h.t0)));
    }
    if (row.tease.length) {
      const wide = row.source !== 'none' && Math.max(row.hi, row.hi1) - Math.min(row.lo, row.lo1) >= 20;
      const hi = wide ? (row.hi + row.hi1) / 2 : 100, lo = wide ? (row.lo + row.lo1) / 2 : r0(F);
      row.teaseHi = r0(hi); row.teaseLo = r0(hi - clamp(P.teaseShare ?? 0.2, 0.05, 0.6) * (hi - lo));
      row.teaseRate = 2000 / clamp(P.teasePeriod || 3000, 1000, 8000);
    }
    out.push(row);
    if (rule && rule.id !== 'inherit' && rule.id !== 'unseen') prev = b;
  }
  // unseen shots (off-screen, filled / bridged): the band eases from the ranged shot before to the one after, so the
  // fill is continuous with both; a fill from one side holds that side's band and eases to the other near the far end
  const ranged = (r) => r.source !== 'none' && r.rule !== 'unseen' && r.rule !== 'inherit';
  for (let k = 0; k < out.length; k++) {
    const r = out[k];
    if (r.rule !== 'unseen') continue;
    const before = out.slice(0, k).reverse().find(ranged), after = out.slice(k + 1).find(ranged), mode = info[k].s.fill ?? 'both';
    const A = before ? [before.lo1, before.hi1] : after ? [after.lo, after.hi] : [REST - 2, REST], Z = after ? [after.lo, after.hi] : A;
    const t0 = r.t0, t1 = r.t1 - 1, e = Math.min(1500, (t1 - t0) / 4);
    r.lo = A[0]; r.hi = A[1]; r.lo1 = Z[0]; r.hi1 = Z[1];
    const piece = (a, z, L0, L1) => ({ t0: a, t1: z, lo: L0[0], hi: L0[1], lo1: L1[0], hi1: L1[1] });
    r.pieces = r.source !== 'tracked' ? [] : mode === 'before' && after ? [piece(t0, t1 - e - 1, A, A), piece(t1 - e, t1, A, Z)]
      : mode === 'after' && before ? [piece(t0, t0 + e, A, Z), piece(t0 + e + 1, t1, Z, Z)] : [piece(t0, t1, A, Z)];
    const nm = (x) => (x ? `S${x.i + 1}` : '');
    r.reason = `${r.reason}: band ${mode === 'before' ? `held from ${nm(before)}, eased to ${nm(after)}` : mode === 'after' ? `eased from ${nm(before)}, held at ${nm(after)}` : `eased ${nm(before) || '?'} → ${nm(after) || '?'}`}`;
  }
  return out;
}

/** paw-ze8n: anchors this close (ms) are one cluster; a cluster's depth reaches this far either side of it. */
export const ANCHOR_REACH = { gap: 6000, reach: 3000 };
/** The pieces with each anchor cluster's span (its anchors +- reach, inside [t0, t1]) cut out as pieces of their own whose deep
 *  end is `deep` (an in-anchor there) and out end `out` (an out-anchor there); a tie piece (after a single knot) is left as it is. */
function anchorPieces(pieces, an, t0, t1, deep, out) {
  const cl = [];
  for (const a of an) { const c = cl[cl.length - 1]; if (c && a.ms - c.z <= ANCHOR_REACH.gap) { c.z = a.ms; c.pos.add(a.pos); } else cl.push({ a: a.ms, z: a.ms, pos: new Set([a.pos]) }); }
  let list = pieces;
  for (const c of cl) {
    const u = Math.max(t0, c.a - ANCHOR_REACH.reach), w = Math.min(t1, c.z + ANCHOR_REACH.reach), next = [];
    for (const p of list) {
      if (p.tie || p.t1 < u || p.t0 > w) { next.push(p); continue; }
      const at = (t) => { const f = (t - p.t0) / Math.max(1, p.t1 - p.t0); return [Math.round(p.lo + (p.lo1 - p.lo) * f), Math.round(p.hi + (p.hi1 - p.hi) * f)]; };
      const part = (a, z, lo, hi) => { if (z - a < 2) return; const [l0, h0] = at(a), [l1, h1] = at(z); next.push({ ...p, t0: a, t1: z, lo: lo ?? l0, hi: hi ?? h0, lo1: lo ?? l1, hi1: hi ?? h1 }); };
      part(p.t0, u - 1);
      part(Math.max(p.t0, u), Math.min(p.t1, w), c.pos.has(0) ? deep : null, c.pos.has(100) ? out : null);
      part(w + 1, p.t1);
    }
    list = next;
  }
  return list;
}

/** Did the shot's depth come from the shaft (paw-azd: lib/strokes.js range 'shaft', its strokes pinned to the measured
 *  inserted fraction)? The shot's own choice (derive.strokes.range) wins; unset = the default, which is 'shaft' where the
 *  run's SAM shaft is confident over most of the shot (share >= SHARE_MIN). -> {conf (the run's confidence channel
 *  {t, v} | null = confident throughout)} | null. */
function shaftOfShot(s, sh) {
  const r = s?.derive?.strokes?.range;
  if (r === 'shaft') return { conf: sh?.conf ?? null };
  return r == null && sh && sh.share >= SHARE_MIN ? { conf: sh.conf ?? null } : null;
}

/** Spans of [t0, t1] with no point for over HOLE_MS (a margin kept at both ends for the join). -> [{t0, t1, why}] */
function holesOf(script, t0, t1) {
  const ats = [t0];
  for (let k = lowerBound(script, t0 + 1); k < script.length && script[k].at < t1; k++) ats.push(script[k].at);
  ats.push(t1);
  const out = [];
  for (let k = 1; k < ats.length; k++) {
    const a = ats[k - 1], z = ats[k], m = Math.min(800, (z - a) / 6);
    if (z - a > HOLE_MS) out.push({ t0: r0(a + m), t1: r0(z - m), why: `${((z - a) / 1000).toFixed(1)} s without points` });
  }
  return out;
}

/** The gap list of a plan: act gaps (source 'gap': their act's recipe) and the dead-gap teases as rows of their own
 *  ({...scene row, t0, t1 = the span, kind 'tease', recipe 'tease-top', lo / hi = the tease band, rate, why, whole}). */
export const gapRows = (plan) => plan.flatMap((r) => [
  ...(r.source === 'gap' ? [r] : []),
  ...(r.tease || []).map((s) => ({ ...r, ...s, source: 'gap', kind: 'tease', recipe: 'tease-top', lo: r.teaseLo, hi: r.teaseHi, lo1: r.teaseLo, hi1: r.teaseHi, rate: r.teaseRate })),
]);

export const AUTO_LABEL = 'autorange';
export const isAuto = (e) => !!e?.auto && e.label === AUTO_LABEL;
const byT0 = (a, b) => a.t0 - b.t0;
const inScene = (e, r) => e.t0 >= r.t0 && e.t1 <= r.t1;

/**
 * doc.fx with the plan's autorange effects: one Reshape per piece, {id, kind 'shape', t0, t1, label 'autorange', auto
 * true, params {lo, hi, loEnd?, hiEnd?}}. only = scene indices to redo (a bar drag: their autorange effects go, baked
 * ones too, and come back live); else every live autorange effect is replaced and scenes holding a baked one are left
 * alone (already in the axis). The user's effects are never touched; autorange goes first at an equal t0 (theirs win
 * on top). -> new fx list.
 */
export function applyRangePlan(fx = [], plan = [], { only = null } = {}) {
  const pick = only ? new Set(only) : null, rows = plan.filter((r) => !pick || pick.has(r.i));
  const keep = fx.filter((e) => !isAuto(e) || (pick ? !rows.some((r) => inScene(e, r)) : e.baked));
  const mine = [];
  for (const r of rows) {
    if (r.source !== 'tracked' || (r.stats?.turns ?? 0) < 2 || keep.some((e) => isAuto(e) && inScene(e, r))) continue;
    for (const p of r.pieces) {
      const params = { lo: p.lo, hi: p.hi, ...(p.lo1 !== p.lo && { loEnd: p.lo1 }), ...(p.hi1 !== p.hi && { hiEnd: p.hi1 }) };
      mine.push({ id: `ar${p.t0}`, kind: 'shape', t0: p.t0, t1: p.t1, label: AUTO_LABEL, auto: true, params });
    }
  }
  return [...mine, ...keep].sort(byT0);
}

/** The scene's band moved by hand: scene.range {lo, hi, lo1, hi1, strength?} ({off: true} = left as it is; {strength}
 *  alone = the policy's band at that strength; null clears it = back to the policy). -> new list. */
export function setSceneRange(scenes, i, range) {
  return scenes.map((s, k) => {
    if (k !== i) return s;
    const { range: _, ...rest } = s;   // eslint-disable-line no-unused-vars
    if (!range) return rest;
    if (range.off) return { ...rest, range: { off: true } };
    const q = (v) => clamp(r0(v), 0, 100), r = {};
    if (range.lo != null) Object.assign(r, { lo: q(range.lo), hi: q(range.hi), lo1: q(range.lo1 ?? range.lo), hi1: q(range.hi1 ?? range.hi) });
    if (Number.isFinite(range.strength) && range.strength < 1) r.strength = Math.round(clamp(range.strength, 0, 1) * 100) / 100;
    return Object.keys(r).length ? { ...rest, range: r } : rest;
  });
}

/**
 * A gap's suggestion: the act's recipe (row.kind -> gen/recipes.js) inside the scene's band, timed by the neighbours'
 * turns (follow carries their cadence like the bridge). -> Script strictly inside (t0, t1), [] when the recipe gives none.
 */
export function gapScript(row, script = [], { maxSpeed = 400, minGapMs = 20, contextMs = 10000, seed = 0 } = {}) {
  if (row?.source !== 'gap' || !(row.t1 > row.t0)) return [];
  const lo = r0((row.lo + row.lo1) / 2), hi = r0((row.hi + row.hi1) / 2);
  const turns = [...baseTurns(script, row.t0 - contextMs, row.t0), ...baseTurns(script, row.t1, row.t1 + contextMs)];
  try {
    const r = row.kind === 'tease' ? resolveSegment({ recipe: 'tease-top', params: { lo, hi, ...(row.rate > 0 && { rate: row.rate }) } })
      : resolveSegment({ kind: row.kind, params: { lo, hi, carry: true, gapFactor: 1.5, gapMinMs: 800 } });
    const s = r.gen(row.t0, row.t1, r.params, { turns, maxSpeed, minGapMs, seed: hashSeed(seed, row.t0) });
    return s.filter((p) => p.at > row.t0 && p.at < row.t1).map((p) => ({ at: r0(p.at), pos: clamp(r0(p.pos), 0, 100) }))
      .filter((p, k, a) => !k || p.at > a[k - 1].at);
  } catch { return []; }
}

/** "gap: S7 oral — fill with oral recipe at 55–95" | "gap: S12 (no act) — tease at 80–100". */
export const gapText = (row) => (row.kind === 'tease' ? `gap: S${row.i + 1} (${row.why}) — tease at ${row.lo}–${row.hi}`
  : `gap: S${row.i + 1} ${row.kind} — fill with ${row.recipe} recipe at ${Math.min(row.lo, row.lo1)}–${Math.max(row.hi, row.hi1)}`);

// the live pass and the band envelope (per-piece corners, keys, modifier overlays): lib/autorange-env.js
export { rangePass, pieceMaps, pieceMap, envelope, EASE_MS } from './autorange-env.js';
