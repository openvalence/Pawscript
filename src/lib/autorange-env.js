// autorange-env.js -- the Autorange band as an ENVELOPE over time (paw-2ud), and the live pass that maps the stroke
// into it. Pure. Owner: "it's per scene, sometimes I want more granular" / "let me edit the rect so all 4 corners".
//
// The band at time t (pos 0 = deepest, 100 = out) = auto (the plan: rangePlan's per-shot bands, sliding lo -> lo1 /
// hi -> hi1, knot carve, tie, ease-in) -> modifier overlays (an orgasm span gets the orgasm band, an idle span the
// rest band at the top, a knotting span in a knot-heavy run may use the reserve; the pass eases a span's edges like any piece edge) -> the owner's overrides:
//   bands [{t0, t1, dlo?, dhi?, dlo1?, dhi1?, strength?, keep?, off?, merge?}]  hand pieces (absolute ms, sorted, never
//          overlapping). Their four corners are OFFSETS from the auto band at the piece's ends (dhi = start-top, dlo =
//          start-bottom, dhi1 / dlo1 = end-top / end-bottom); once set, the piece is a straight trapezoid between its
//          corners (it can ramp, narrow or widen), each corner anchored to the auto band at its end, so a re-plan
//          (re-tagged scene, moved cut, new ladder) moves the corners with the auto band and the owner's correction
//          rides on top. A piece with only t0 / t1 is a split (the auto band runs through). merge = maps as one.
//   keys  [{t, edge: 'hi' | 'lo', d, ease?: 'hold' | 'linear' | 'smooth'}]  extra handles inside a piece: deltas on
//          that edge, 0 at the piece's ends (the corners), interpolated key to key (ease = the segment leaving the key).
// Overrides live in doc.finish (undoable project data) anchored to ABSOLUTE time: a key belongs to a moment of the
// video, so re-detecting / moving cuts does not move it; one whose scene is gone is dropped (orphans, with a toast).
// Pieces never cross a scene boundary (sides clip at the scene's edges, like modifier spans).
//
// Depth pieces (what one depth map b..T covers): the auto pieces of one scene are merged unless there is a reason to
// keep them apart -- a shot whose own stroke depth is clearly unlike the rest of its scene (another framing), a
// modifier span, a knot / tie / ease piece, a hand split. Each piece says why it exists (why[]).
import { lowerBound } from './core/script.js';
import { baseTurns } from './fx.js';
import { clamp } from './gen/util.js';
import { sceneRuns } from '../features/timeline/shots.js';
import { sceneSpans, MODS } from '../features/timeline/mods.js';
import { lowerBound as lowerBoundT } from './lane.js';
import { CONF_MIN } from './shaft.js';
import { shotFades } from '../features/timeline/transitions.js';

/** Edge ease between two touching pieces (ms each side; at most a quarter of either piece); also a modifier overlay's ramp. */
export const EASE_MS = 400;
/** Top stays at least this far above the bottom. */
export const MIN_GAP = 2;
const KNEE = 8;   // soft knee (pos): a value past a band edge is squeezed into at most this much beyond it
const r0 = Math.round;
const smoothstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const quantile = (v, q) => { if (!v.length) return NaN; const s = [...v].sort((x, y) => x - y), k = (s.length - 1) * q, i = Math.floor(k); return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (k - i); };
/** v squeezed softly into [lo, hi]: unchanged inside, at most KNEE past an edge (tanh), monotonic. */
const soft = (v, lo, hi) => { const k = Math.min(KNEE, Math.max(1, (hi - lo) / 4)); return v < lo ? lo - k * Math.tanh((lo - v) / k) : v > hi ? hi + k * Math.tanh((v - hi) / k) : v; };
/** paw-2lp7.1: turns outside the skip spans ([[t0, t1]]: a shot's positioning ranges: no depth is read from them). */
export const outside = (T, skip) => (skip?.length ? T.filter((x) => !skip.some(([a, b]) => x.at >= a && x.at < b)) : T);
/** Robust envelopes of base's turns in [t0, t1] (none inside skip: positioning ranges, paw-2lp7.1): {b (10th pct of bottoms), T (90th of tops), n} | null. */
export function envOf(base, t0, t1, skip = null) {
  const turns = outside(baseTurns(base, t0, t1), skip);
  if (turns.length < 2) return null;
  const bots = turns.filter((x) => x.kind === 'bottom').map((x) => x.pos), tops = turns.filter((x) => x.kind === 'top').map((x) => x.pos), all = turns.map((x) => x.pos);
  return { b: bots.length ? quantile(bots, 0.1) : Math.min(...all), T: tops.length ? quantile(tops, 0.9) : Math.max(...all), n: turns.length };
}

/**
 * One piece's map, depth-aware: b / T = the robust bottom / top envelopes of the piece's turns; the full map sends
 * [b, T] onto the band at each time (bandAt(t) -> [lo, hi]: one monotonic linear map per time, so a shallow stroke stays
 * proportionally shallow, the path between turns keeps its shape, order never inverts), softly kneed past the band.
 * keep (0..1) = how much of the base's OWN depth stays where it already sits well in the band: trust x fit. strength
 * blends with the base. -> {t0, t1, b, T, keep, strength, at(v, t)} | null (fewer than two turns or no depth to read).
 */
export function pieceMap(base, p, { trust = 1, strength = 1, bandAt = null, measured = null } = {}) {
  const sk = p.rows?.flatMap((r) => r.skip || []), e = envOf(base, p.t0, p.t1, sk?.length ? sk : null);
  if (!e || !(e.T - e.b >= 1)) return null;
  const { b, T } = e, span = Math.max(1, p.t1 - p.t0);
  const band = bandAt ?? ((t) => { const u = clamp((t - p.t0) / span, 0, 1); return [p.lo + (p.lo1 - p.lo) * u, p.hi + (p.hi1 - p.hi) * u]; });
  let loA = 0, hiA = 0;
  for (let k = 0; k < 5; k++) { const [l, h] = band(p.t0 + (span * k) / 4); loA += l / 5; hiA += h / 5; }
  const W = Math.max(1, hiA - loA);
  const overlap = clamp((Math.min(T, hiA) - Math.max(b, loA)) / W, 0, 1), outside = (Math.max(0, loA - b) + Math.max(0, T - hiA)) / W;
  const keep = clamp(trust, 0, 1) * smoothstep(0.4, 0.8, overlap) * (1 - smoothstep(0, 0.25, outside));
  const s = clamp(strength, 0, 1);
  const at = (v, t) => {
    const [lo, hi] = band(t);
    const full = soft(lo + ((v - b) * (hi - lo)) / (T - b), lo, hi), own = soft(v, lo, hi);
    let m = full + keep * (own - full);
    // measured depth (the shaft): kept as it is, the band only a limit (soft-clipped at its edges); eased where unsure
    if (measured) { const w = measured(t); if (w > 0) m += w * (own - m); }
    return clamp(v + s * (m - v), 0, 100);
  };
  return { t0: p.t0, t1: p.t1, b, T, keep: measured ? 1 : keep, strength: s, at, measured: !!measured };
}

// ---- the envelope ----
const covering = (list, t) => { let lo = 0, hi = list.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m].t0 <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
const lerp = (a, b, u) => a + (b - a) * u;
/** Has the owner set this hand piece's corners (else it is a split only: the auto band runs through it)? */
const shaped = (m) => m.dlo != null || m.dhi != null || m.dlo1 != null || m.dhi1 != null;
/** An override piece's offsets at time t: [dlo, dhi]. */
const offAt = (m, t) => { const u = clamp((t - m.t0) / Math.max(1, m.t1 - m.t0), 0, 1); return [lerp(m.dlo ?? 0, m.dlo1 ?? 0, u), lerp(m.dhi ?? 0, m.dhi1 ?? 0, u)]; };
const EASE = { hold: () => 0, linear: (u) => u, smooth: (u) => u * u * (3 - 2 * u) };

/**
 * The envelope for plan rows (rangePlan) over base, with the owner's overrides. opts: scenes (the shot list: groups
 * shots into scenes and gives the modifier spans; without it every row is its own scene), bands, keys, policy-free.
 * -> {pieces, auto(t) (auto + overlays, no hand offsets), bandAt(t) (everything but keys), edgeAt(t, piece) (with the
 * piece's keys), keysIn(piece)} -- pieces [{t0, t1, rows, scene, why[], hand (the override piece over it or null), off,
 * trust, strength, cap}], sorted.
 */
export function envelope(plan = [], base = [], { scenes = null, bands = [], keys = [], fades = [] } = {}) {
  // auto segments: every tracked row's pieces, in time order
  const segs = [];
  for (const r of plan) if (r.source === 'tracked' && (r.stats?.turns ?? 0) >= 2) for (const p of r.pieces) segs.push({ ...p, row: r });
  segs.sort((a, b) => a.t0 - b.t0);
  const runs = scenes ? sceneRuns(scenes) : null, sceneOf = new Map();
  if (runs) runs.forEach(([a, b], k) => { for (let i = a; i <= b; i++) sceneOf.set(i, k); });
  const scOf = (r) => (sceneOf.has(r.i) ? sceneOf.get(r.i) : `r${r.i}`);
  const bounds = new Map();   // scene key -> [t0, t1] (a piece's sides clip here)
  if (runs) runs.forEach(([a, b], k) => bounds.set(k, [scenes[a].start_ms, scenes[b].end_ms]));
  // modifier overlays (the scenes carry the event modifiers: timeline/mods.js withMods) -> [{id, t0, t1}]
  const mods = scenes ? MODS.flatMap((id) => sceneSpans(scenes, id).map(([t0, t1]) => ({ id, t0, t1 }))) : [];
  const auto = (t) => {
    const k = covering(segs, t);
    if (k < 0) return null;
    const s = segs[k], u = clamp((t - s.t0) / Math.max(1, s.t1 - s.t0), 0, 1);
    let lo = lerp(s.lo, s.lo1, u), hi = lerp(s.hi, s.hi1, u);
    if (!s.tie) for (const m of mods) {
      if (t < m.t0 || t >= m.t1) continue;
      if (m.id === 'orgasm' && s.row.orgasm) [lo, hi] = s.row.orgasm;   // a clean piece: the pass eases its edges (EASE_MS)
      else if (m.id === 'knotting' && s.row.knotFloor) lo = s.row.deep;
      else if (m.id === 'idle') [lo, hi] = [100 - MIN_GAP, 100];   // an idle stretch rests at the top (paw-f0u)
    }
    for (const f of fades) if (!f.off && t >= f.t0 && t <= f.t1) lo = hi - (hi - lo) * fadeShare(f, t);   // paw-ef73.9: the soft start / stop
    return [lo, hi];
  };
  const B = [...bands].sort((a, b) => a.t0 - b.t0), handAt = (t) => { const k = covering(B, t); return k >= 0 && t <= B[k].t1 ? B[k] : null; };
  const floorOf = (t) => { const k = covering(segs, t); return k >= 0 ? segs[k].row.deep ?? 0 : 0; };
  const fix = (lo, hi, t) => { const F = floorOf(t); lo = clamp(lo, F, 100 - MIN_GAP); hi = clamp(hi, lo + MIN_GAP, 100); return [lo, hi]; };
  const bandAt = (t) => {
    const a = auto(t);
    if (!a) return null;
    const m = handAt(t);
    if (!m) return fix(a[0], a[1], t);
    if (!shaped(m)) return fix(a[0], a[1], t);
    // a hand piece with corners: a straight trapezoid between its corners (each anchored to the auto band at its end)
    const a0 = auto(m.t0) ?? a, a1 = auto(m.t1) ?? a, u = clamp((t - m.t0) / Math.max(1, m.t1 - m.t0), 0, 1);
    return fix(lerp(a0[0] + (m.dlo ?? 0), a1[0] + (m.dlo1 ?? 0), u), lerp(a0[1] + (m.dhi ?? 0), a1[1] + (m.dhi1 ?? 0), u), t);
  };
  // depth pieces: per scene, auto pieces merged unless a reason keeps them apart
  const rowEnv = new Map(), sceneEnv = new Map();
  for (const r of plan) if (r.source === 'tracked') { const e = envOf(base, r.t0, r.t1, r.skip); if (e) rowEnv.set(r.i, e); }
  for (const r of plan) { const e = rowEnv.get(r.i); if (!e) continue; const k = scOf(r), a = sceneEnv.get(k) ?? []; a.push(e); sceneEnv.set(k, a); }
  const pooled = (k) => { const a = sceneEnv.get(k) || []; return a.length ? { b: quantile(a.map((e) => e.b), 0.5), T: quantile(a.map((e) => e.T), 0.5) } : null; };
  const ownDepth = (r) => {   // a shot clearly unlike its scene: another framing / stroke depth
    const e = rowEnv.get(r.i), s = pooled(scOf(r));
    if (!e || !s || e.n < 4 || (sceneEnv.get(scOf(r)) || []).length < 2) return null;
    const w = e.T - e.b, W = Math.max(1, s.T - s.b), ov = (Math.min(e.T, s.T) - Math.max(e.b, s.b)) / Math.max(1, Math.min(w, W));
    return w / W < 0.5 || w / W > 2 || ov < 0.5 ? `its own depth: shot strokes ${r0(e.b)}–${r0(e.T)} vs the scene's ${r0(s.b)}–${r0(s.T)}` : null;
  };
  let pieces = [];
  for (const s of segs) {
    const prev = pieces[pieces.length - 1], why = ownDepth(s.row), kind = s.tie ? 'tie after the knot' : s.ease ? 'eases in from the run before' : null;
    const same = prev && !prev.lock && !kind && !why && scOf(s.row) === prev.scene && s.t0 - prev.t1 <= 2 && s.row.rule === prev.rule && (s.row.rule !== 'unseen' || prev.rows.includes(s.row)) && !!s.row.shaft === !!prev.rows[0].shaft;
    if (same) { prev.t1 = s.t1; if (!prev.rows.includes(s.row)) prev.rows.push(s.row); continue; }
    pieces.push({ t0: s.t0, t1: s.t1, rows: [s.row], scene: scOf(s.row), rule: s.row.rule, lock: !!(kind || why), why: [kind ?? why ?? (s.row.rule === 'unseen' ? s.row.reason : null) ?? (s.row.shaft ? 'depth measured from the shaft' : null) ?? `scene ${typeof scOf(s.row) === 'number' ? `S${scOf(s.row) + 1}` : `shot ${s.row.i + 1}`}`] });
  }
  // split at modifier span edges and hand-piece edges (strictly inside a piece); a part inside a span says so
  const cuts = [...mods.flatMap((m) => [m.t0, m.t1]), ...B.flatMap((m) => [m.t0, m.t1 + 1])].sort((a, b) => a - b);
  for (const t of cuts) {
    const k = pieces.findIndex((p) => t > p.t0 + 1 && t < p.t1 - 1);
    if (k >= 0) pieces.splice(k, 1, { ...pieces[k], t1: t - 1 }, { ...pieces[k], t0: t });
  }
  for (const p of pieces) { const m = mods.find((x) => p.t0 >= x.t0 - 1 && p.t1 <= x.t1 + 1); if (m) p.why = [`${m.id} span`]; }
  // a hand piece with merge: its pieces map as one (touching ones)
  pieces = pieces.reduce((out, p) => {
    const q = out[out.length - 1], m = handAt((p.t0 + p.t1) / 2);
    if (q && m?.merge && q.hand === m && p.t0 - q.t1 <= 2) { q.t1 = p.t1; q.rows = [...new Set([...q.rows, ...p.rows])]; return out; }
    out.push({ ...p, hand: m });
    return out;
  }, []);
  for (const p of pieces) {
    const r = p.rows[0], m = p.hand;
    if (m) p.why = [...p.why, m.merge ? 'merged / moved by hand' : 'hand piece'];
    p.off = !!m?.off;
    p.trust = m?.keep ?? r.trust ?? 1;
    p.strength = clamp((r.policyStrength ?? 1) * (m?.strength ?? r.sceneStrength ?? 1), 0, 1);
    p.cap = r.cap ?? 0;
    p.bounds = bounds.get(p.scene) ?? [r.t0, r.t1];
  }
  const K = { hi: keys.filter((k) => k.edge === 'hi').sort((a, b) => a.t - b.t), lo: keys.filter((k) => k.edge === 'lo').sort((a, b) => a.t - b.t) };
  const keysIn = (p) => ({ hi: K.hi.filter((k) => k.t > p.t0 && k.t < p.t1), lo: K.lo.filter((k) => k.t > p.t0 && k.t < p.t1) });
  /** The key delta on an edge at t inside piece p: 0 at the corners, key to key with the left key's ease. */
  const deltaAt = (ks, p, t) => {
    if (!ks.length) return 0;
    const pts = [{ t: p.t0, d: 0 }, ...ks, { t: p.t1, d: 0 }];
    let j = 0;
    while (j + 1 < pts.length - 1 && pts[j + 1].t <= t) j++;
    const a = pts[j], b = pts[j + 1], u = clamp((t - a.t) / Math.max(1, b.t - a.t), 0, 1);
    return a.d + (b.d - a.d) * (EASE[a.ease] ?? EASE.linear)(u);
  };
  const keyed = new Map(pieces.map((p) => [p, keysIn(p)]));
  /** The band with the piece's keys: [lo, hi] at t (p = the piece holding t; found when not given). */
  const edgeAt = (t, p = pieces[covering(pieces, t)]) => {
    const b = bandAt(t);
    if (!b || !p || t < p.t0 || t > p.t1) return b;
    const k = keyed.get(p);
    if (!k.hi.length && !k.lo.length) return b;
    return fix(b[0] + deltaAt(k.lo, p, t), b[1] + deltaAt(k.hi, p, t), t);
  };
  return { pieces, auto, bandAt, edgeAt, keysIn: (p) => keyed.get(p) ?? keysIn(p), segs, mods };
}

// ---- the soft start / stop over a fade (paw-ef73.9): a shot that fades in gets its stroke amplitude ramped from a share
// of its band up to the whole band over the fade (the fade's own ramp: from the end of the black to the first clean
// frame), mirrored for a fade out. Live like the other envelopes: the span follows the fade's handles; the owner's
// edits (doc.finish.fades {[key]: {share?, off?}}, key = side + the shot's cut, so they survive a moved fade handle).
/** The starting share by default (a fade through black starts at 25 % of the band). */
export const FADE_SHARE = 0.25;
/** Which fades get one by default: through black (a dissolve is offered, off until the owner turns it on). */
const FROM_BLACK = new Set(['fade-in', 'fade-out', 'through-black']);
/** The amplitude share 0..1 of fade envelope f at t (linear over its span). */
export const fadeShare = (f, t) => { const u = clamp((t - f.t0) / Math.max(1, f.t1 - f.t0), 0, 1); return f.side === 'in' ? f.share + (1 - f.share) * u : 1 - (1 - f.share) * u; };
/** The fade envelopes of the shots: [{key, side: 'in' | 'out', t0, t1, share, off, kind}] (sorted). shots: the flat list;
 *  list: the transitions (transitions.js); edits: doc.finish.fades. */
export function fadeEnvelopes(shots = [], list = [], fm = 1000 / 30, dur = Infinity, edits = {}) {
  if (!list.length) return [];
  const out = [];
  shotFades(shots, list, fm, dur).forEach((f, i) => {
    const s = shots[i], add = (side, x, t0, t1, cut) => {
      if (!x || !(t1 - t0 >= fm / 2)) return;
      const key = `${side}:${Math.round(cut)}`, e = edits?.[key] || {};
      out.push({ key, side, t0: Math.round(t0), t1: Math.round(t1), share: clamp(e.share ?? FADE_SHARE, 0, 1), off: e.off ?? !FROM_BLACK.has(x.kind), kind: x.kind });
    };
    if (f.in && f.in.x.kind !== 'fade-out' && f.in.clean != null) add('in', f.in.x, Math.max(s.start_ms, f.in.x.b1 ?? f.in.x.ts), f.in.clean, s.start_ms);
    if (f.out && f.out.x.kind !== 'fade-in' && f.out.clean != null) add('out', f.out.x, f.out.clean, Math.min(s.end_ms, f.out.x.b0 ?? (f.out.x.t1 ?? dur)), s.end_ms);
  });
  return out.sort((a, b) => a.t0 - b.t0);
}
/** doc.finish.fades with envelope key's edit patched ({share} | {off}); null patch = back to the default. */
export function setFadeEnv(edits = {}, key, patch) {
  const next = { ...(edits || {}) };
  if (patch == null) delete next[key]; else next[key] = { ...(next[key] || {}), ...patch };
  return next;
}

/** The shaft's confidence channel {t, v} -> w(t) 0..1: the share of confident frames (>= CONF_MIN) within +-250 ms,
 *  eased (null channel = confident throughout). */
const SHAFT_WIN = 250;
function confidence(c) {
  if (!c?.t?.length) return () => 1;
  return (t) => {
    let i = lowerBoundT(c.t, t - SHAFT_WIN), n = 0, ok = 0;
    for (; i < c.t.length && c.t[i] <= t + SHAFT_WIN; i++) { n++; if (c.v[i] >= CONF_MIN) ok++; }
    return n ? smoothstep(0.3, 0.7, ok / n) : 0;
  };
}

/** Every depth piece's map, in time order: [{...pieceMap, i (its first row's shot), piece}] (the Range hover reads them). */
export function pieceMaps(base = [], plan = [], ov = {}, env = envelope(plan, base, ov)) {
  const out = [];
  for (const p of env.pieces) {
    if (p.off) continue;
    const sh = p.rows[0].shaft;
    const m = pieceMap(base, p, { trust: p.trust, strength: p.strength, bandAt: (t) => env.edgeAt(t, p) ?? [0, 100], measured: sh ? confidence(sh.conf) : null });
    if (m) out.push({ ...m, i: p.rows[0].i, piece: p });
  }
  return out;
}

/**
 * The live pass: base -> every depth piece remapped into its band (pieceMap over the envelope), eased across a touching
 * boundary (EASE_MS each side), so a continuous base gets no step (a detached side leaves the stretch between to the auto
 * band: a piece of its own, eased on both sides).
 * Then the speed limit: a step the pass made faster than the plan's cap (and than the base's own step) is shortened in
 * depth, its time kept. Points outside every piece (knot spans, unranged scenes, gaps) stay. -> Script (base itself
 * when nothing changes).
 */
export function rangePass(base = [], plan = [], ov = {}) {
  const env = envelope(plan, base, ov), maps = pieceMaps(base, plan, ov, env);
  if (!maps.length) return base;
  let out = null;
  const set = (k, pos) => { if (pos !== (out ?? base)[k].pos) { out ??= base.slice(); out[k] = { at: base[k].at, pos }; } };
  for (let j = 0; j < maps.length; j++) {
    const m = maps[j], prev = maps[j - 1], next = maps[j + 1];
    const touchP = prev && m.t0 - prev.t1 <= 2, touchN = next && next.t0 - m.t1 <= 2;
    const eP = touchP ? Math.min(EASE_MS, (m.t1 - m.t0) / 4, (prev.t1 - prev.t0) / 4) : 0, eN = touchN ? Math.min(EASE_MS, (m.t1 - m.t0) / 4, (next.t1 - next.t0) / 4) : 0;
    for (let k = lowerBound(base, m.t0); k < base.length && base[k].at <= m.t1; k++) {
      const a = base[k], v = m.at(a.pos, a.at);
      let w = v;
      // the boundary at m.t0: from the mean of both maps there to m's own map eP later (and mirrored at m.t1)
      if (eP > 0 && a.at < m.t0 + eP) w = v + (1 - smoothstep(m.t0 - eP, m.t0 + eP, a.at)) * (prev.at(a.pos, a.at) - v);
      else if (eN > 0 && a.at > m.t1 - eN) w = v + smoothstep(m.t1 - eN, m.t1 + eN, a.at) * (next.at(a.pos, a.at) - v);
      set(k, r0(w));
    }
  }
  if (!out) return base;
  // speed: never faster than the cap where the pass sped a step up (depth shortened, time kept)
  const cap = Math.max(0, ...maps.map((m) => m.piece.cap || 0));
  if (cap > 0) for (let k = 1; k < out.length; k++) {
    if (out[k] === base[k] && out[k - 1] === base[k - 1]) continue;
    const dt = out[k].at - out[k - 1].at;
    if (!(dt > 0)) continue;
    const lim = Math.max(cap, (Math.abs(base[k].pos - base[k - 1].pos) * 1000) / dt) * dt / 1000, d = out[k].pos - out[k - 1].pos;
    if (Math.abs(d) > lim + 0.5) out[k] = { at: out[k].at, pos: r0(out[k - 1].pos + Math.sign(d) * lim) };
  }
  return out;
}

// ---- the owner's edits: pure reducers on ov = {bands, keys} (doc.finish), given env = envelope(...) ----
// Every reducer returns a new ov (the same object when nothing changes). Levels are absolute pos; what is stored is
// the offset from the auto band (so a re-plan carries the correction along).
export const MIN_LEN = 100;   // a piece is at least this long (ms)
export const keyId = (k) => `${k.edge}:${r0(k.t)}`;
const sortB = (l) => l.sort((a, b) => a.t0 - b.t0);
function clean(m) {
  const o = { t0: r0(m.t0), t1: r0(m.t1) };
  if (shaped(m) && ['dlo', 'dhi', 'dlo1', 'dhi1'].some((k) => Math.abs(m[k] ?? 0) >= 0.5)) for (const k of ['dlo', 'dhi', 'dlo1', 'dhi1']) o[k] = r0(m[k] ?? 0);
  for (const k of ['strength', 'keep']) if (m[k] != null) o[k] = Math.round(clamp(m[k], 0, 1) * 100) / 100;
  if (m.off) o.off = true;
  if (m.merge) o.merge = true;
  return o;
}
/** bands with an exact hand piece over [t0, t1] (overlapping ones split there: a shaped one keeps its straight edges,
 *  its new corners re-anchored to the auto band; an empty one made when none covers) -> {bands, m (that piece)}.
 *  auto = env.auto. */
function carve(bands = [], t0, t1, auto = () => null) {
  const out = [];
  let m = null;
  const part = (b, a, z) => {
    if (!shaped(b)) return { ...b, t0: a, t1: z };
    const A0 = auto(b.t0) ?? [0, 100], A1 = auto(b.t1) ?? [0, 100];
    const lv = (t) => { const u = clamp((t - b.t0) / Math.max(1, b.t1 - b.t0), 0, 1); return [lerp(A0[0] + (b.dlo ?? 0), A1[0] + (b.dlo1 ?? 0), u), lerp(A0[1] + (b.dhi ?? 0), A1[1] + (b.dhi1 ?? 0), u)]; };
    const d = (t) => { const L = lv(t), A = auto(t) ?? L; return [L[0] - A[0], L[1] - A[1]]; };
    const [l0, h0] = d(a), [l1, h1] = d(z);
    return { ...b, t0: a, t1: z, dlo: l0, dhi: h0, dlo1: l1, dhi1: h1 };
  };
  for (const b of bands) {
    if (b.t1 < t0 || b.t0 > t1) { out.push(b); continue; }
    if (b.t0 < t0) out.push(part(b, b.t0, t0 - 1));
    if (b.t1 > t1) out.push(part(b, t1 + 1, b.t1));
    m ??= b;
  }
  m = m ? part(m, t0, t1) : { t0, t1 };
  out.push(m);
  return { bands: sortB(out), m };
}
const put = (ov, bands, keys = ov.keys || []) => ({ ...ov, bands: sortB(bands.map(clean)), keys });

/** The piece's corners now (absolute, without keys): {lo0, hi0, lo1, hi1}. */
export function cornersOf(env, p) {
  const b0 = env.bandAt(p.t0) ?? [0, 100], b1 = env.bandAt(p.t1) ?? [0, 100];
  return { lo0: b0[0], hi0: b0[1], lo1: b1[0], hi1: b1[1] };
}
/** Set a piece's corners to absolute levels: c = {lo0?, hi0?, lo1?, hi1?} (start / end, bottom / top). The top stays
 *  MIN_GAP above the bottom (the corner being dragged gives way), everything inside 0..100. */
export function setCorners(ov, env, p, c) {
  const { bands, m } = carve(ov.bands, p.t0, p.t1, env.auto), a0 = env.auto(p.t0) ?? [0, 100], a1 = env.auto(p.t1) ?? [0, 100], now = cornersOf(env, p);
  const v = { ...now, ...Object.fromEntries(Object.entries(c).filter(([, x]) => x != null)) };
  for (const e of ['0', '1']) {
    let lo = clamp(v['lo' + e], 0, 100 - MIN_GAP), hi = clamp(v['hi' + e], MIN_GAP, 100);
    if (hi < lo + MIN_GAP) { if (c['lo' + e] != null && c['hi' + e] == null) lo = hi - MIN_GAP; else hi = lo + MIN_GAP; }
    v['lo' + e] = lo; v['hi' + e] = hi;
  }
  const n = { ...m, dlo: v.lo0 - a0[0], dhi: v.hi0 - a0[1], dlo1: v.lo1 - a1[0], dhi1: v.hi1 - a1[1] };
  return put(ov, bands.map((b) => (b === m ? n : b)));
}
/** Move part of a piece in level by dv: 'hi' / 'lo' (an edge: both its corners), 'body' (all four), or one corner
 *  ('lo0' | 'hi0' | 'lo1' | 'hi1'). */
export function moveLevel(ov, env, p, part, dv) {
  const c = cornersOf(env, p), ks = part === 'body' ? ['lo0', 'hi0', 'lo1', 'hi1'] : part === 'hi' ? ['hi0', 'hi1'] : part === 'lo' ? ['lo0', 'lo1'] : [part];
  if (part === 'body') dv = clamp(dv, -Math.min(c.lo0, c.lo1), 100 - Math.max(c.hi0, c.hi1));
  return setCorners(ov, env, p, Object.fromEntries(ks.map((k) => [k, c[k] + dv])));
}
/** The piece touching p's side ('t0' | 't1') in the same scene, or null. */
export const neighbourOf = (env, p, side) => env.pieces.find((q) => q !== p && q.scene === p.scene && (side === 't0' ? Math.abs(q.t1 - p.t0) <= 2 : Math.abs(q.t0 - p.t1) <= 2)) ?? null;
/** Move a side of a piece ('t0' | 't1') in time to t, clipped to the scene and MIN_LEN; the neighbour's shared boundary
 *  goes along unless detach (then a gap the pass eases across). Both become merged hand pieces (their extent is the
 *  owner's now). */
export function moveSide(ov, env, p, side, t, { detach = false } = {}) {
  const q = detach ? null : neighbourOf(env, p, side), [s0, s1] = p.bounds ?? [p.t0, p.t1];
  t = side === 't0' ? clamp(r0(t), q ? q.t0 + MIN_LEN : s0, p.t1 - MIN_LEN) : clamp(r0(t), p.t0 + MIN_LEN, q ? q.t1 - MIN_LEN : s1);
  let { bands, m } = carve(ov.bands, p.t0, p.t1, env.auto), n = null;
  if (q) { const r = carve(bands, q.t0, q.t1, env.auto); bands = r.bands; n = r.m; }
  const me = side === 't0' ? { ...m, t0: t, merge: true } : { ...m, t1: t, merge: true };
  const nb = n && (side === 't0' ? { ...n, t1: t - 1, merge: true } : { ...n, t0: t + 1, merge: true });
  const lo = Math.min(me.t0, nb?.t0 ?? Infinity), hi = Math.max(me.t1, nb?.t1 ?? -Infinity);
  const rest = bands.filter((b) => b !== m && b !== n && (b.t1 < lo || b.t0 > hi));   // a hand piece the move runs over gives way
  return put(ov, [...rest, me, ...(nb ? [nb] : [])]);
}
/** Split the piece at t (two hand pieces, each with its own corners from here on). */
export function splitAt(ov, env, p, t) {
  t = r0(t);
  if (t - p.t0 < MIN_LEN || p.t1 - t < MIN_LEN) return ov;
  const a = carve(ov.bands, p.t0, t - 1, env.auto), b = carve(a.bands, t, p.t1, env.auto);
  return put(ov, b.bands);
}
/** Split the piece at each of times (inside it). */
export function splitAll(ov, env, p, times) {
  const ts = [...new Set(times.map(r0))].filter((t) => t >= p.t0 + MIN_LEN && t <= p.t1 - MIN_LEN).sort((x, y) => x - y);
  let o = ov, lo = p.t0;
  for (const t of ts) { o = splitAt(o, env, { ...p, t0: lo }, t); lo = t; }
  return o;
}
/** Merge a piece with its neighbour on side ('t0' | 't1'): one hand piece (start corners from the left one, end corners
 *  from the right one, strength / keep from p). -> ov (unchanged when there is none). */
export function mergeWith(ov, env, p, side) {
  const q = neighbourOf(env, p, side);
  if (!q) return ov;
  const [L, R] = side === 't0' ? [q, p] : [p, q];
  const c = carve(ov.bands, L.t0, L.t1, env.auto), d = carve(c.bands, R.t0, R.t1, env.auto), lm = d.bands.find((b) => b.t0 === L.t0 && b.t1 === L.t1) ?? c.m, own = side === 't0' ? d.m : lm;
  const m = { t0: L.t0, t1: R.t1, dlo: lm.dlo, dhi: lm.dhi, dlo1: d.m.dlo1, dhi1: d.m.dhi1, strength: own.strength, keep: own.keep, off: own.off, merge: true };
  return put(ov, [...d.bands.filter((b) => b !== d.m && b !== lm), m]);
}
/** Patch a piece's own settings ({strength, keep, off}: null clears one). */
export function setPiece(ov, env, p, patch) {
  const { bands, m } = carve(ov.bands, p.t0, p.t1, env.auto), n = { ...m };
  for (const [k, v] of Object.entries(patch)) if (v == null) delete n[k]; else n[k] = v;
  return put(ov, bands.map((b) => (b === m ? n : b)));
}
/** Back to auto over [t0, t1]: hand pieces there go (ones reaching past keep their outside parts), keys there go. */
export function resetSpan(ov, t0, t1, env = null) {
  const bands = [];
  for (const b of ov.bands || []) {
    if (b.t1 < t0 || b.t0 > t1) { bands.push(b); continue; }
    if (b.t0 < t0) bands.push(carve([b], b.t0, t0 - 1, env?.auto).m);
    if (b.t1 > t1) bands.push(carve([b], t1 + 1, b.t1, env?.auto).m);
  }
  return put(ov, bands, (ov.keys || []).filter((k) => k.t < t0 || k.t > t1));
}

// keys: extra handles on an edge inside a piece (deltas; a selection = keyId strings)
/** Add a key on edge at t (delta d) -> {ov, id}; a key already there is kept. */
export function addKey(ov, edge, t, d = 0) {
  const k = { t: r0(t), edge, d: r0(d) }, id = keyId(k);
  if ((ov.keys || []).some((x) => keyId(x) === id)) return { ov, id };
  return { ov: { ...ov, keys: [...(ov.keys || []), k].sort((a, b) => a.t - b.t) }, id };
}
/** Move the selected keys by dt (ms) and dd (pos), each kept inside its piece and off the others' times. -> {ov, ids}. */
export function moveKeys(ov, env, ids, dt = 0, dd = 0) {
  const sel = new Set(ids), ks = ov.keys || [], taken = new Set(ks.filter((k) => !sel.has(keyId(k))).map(keyId)), out = [], nid = [];
  for (const k of ks) {
    if (!sel.has(keyId(k))) { out.push(k); continue; }
    const p = env.pieces.find((q) => k.t > q.t0 && k.t < q.t1);
    let t = r0(k.t + dt);
    if (p) t = clamp(t, p.t0 + 1, p.t1 - 1);
    while (taken.has(`${k.edge}:${t}`)) t++;
    const n = { ...k, t, d: r0(k.d + dd) };
    taken.add(keyId(n)); out.push(n); nid.push(keyId(n));
  }
  return { ov: { ...ov, keys: out.sort((a, b) => a.t - b.t) }, ids: nid };
}
export const deleteKeys = (ov, ids) => { const s = new Set(ids); return { ...ov, keys: (ov.keys || []).filter((k) => !s.has(keyId(k))) }; };
export const setEase = (ov, ids, ease) => {
  const s = new Set(ids);
  return { ...ov, keys: (ov.keys || []).map((k) => { if (!s.has(keyId(k))) return k; const { ease: _e, ...r } = k; return ease === 'linear' ? r : { ...r, ease }; }) };
};
/** Copies of the selected keys dt later -> {ov, ids (the copies)}. */
export function duplicateKeys(ov, env, ids, dt = 300) {
  const s = new Set(ids), copies = (ov.keys || []).filter((k) => s.has(keyId(k))).map((k) => ({ ...k, t: r0(k.t + dt) }));
  let o = ov; const out = [];
  for (const c of copies) { const r = addKey(o, c.edge, c.t, c.d); o = r.ov; if (c.ease) o = setEase(o, [r.id], c.ease); out.push(r.id); }
  return { ov: o, ids: out };
}
/** Hand pieces and keys in no scene any more (the scene was deleted / the list re-detected) -> {ov, dropped (count)}. */
export function orphans(ov, scenes = []) {
  const runs = sceneRuns(scenes).map(([a, b]) => [scenes[a].start_ms, scenes[b].end_ms]);
  const inside = (t0, t1) => runs.some(([a, b]) => t0 >= a - 2 && t1 <= b + 2);
  const bands = (ov.bands || []).filter((b) => inside(b.t0, b.t1)), keys = (ov.keys || []).filter((k) => inside(k.t, k.t));
  const dropped = (ov.bands || []).length - bands.length + (ov.keys || []).length - keys.length;
  return { ov: dropped ? { ...ov, bands, keys } : ov, dropped };
}
