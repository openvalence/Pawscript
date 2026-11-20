// scenes-continue.js -- "the action continues behind a cutaway", pure. A scene with `continues` (true = set by hand,
// false = the user said no, 'auto' = a proposal, never stored) continues the action of the last scene before the run
// of member scenes right before it: cutaways (tag 'offscreen': nothing to track, bridged) and internal views (x-ray /
// cross-section: the act itself, tracked). A, B (offscreen), A' (continues) = one action, B a cutaway.
// Proposals: a scene right after a member run with an off-screen scene in it (the user said so: no fingerprint needed),
// or after an internal-view run between two scenes of the same act; else a 16x16 grey fingerprint of each scene's
// first / last frame (A's end ≈ A''s start, B differs from both) or A' the same footage as A re-framed (a crop link,
// lib/crop-match.js, paw-3uyu: then B, not A', is the cutaway). The bridge fills a cutaway with `follow` strokes
// carried from the turns on both sides (gen README). A blank cutaway (view 'blank': a black / white screen, Detect
// scenes) is a member too, but the viewer sees nothing there: its bridge holds (holdScript) instead of carrying strokes,
// and a proposal never turns it off-screen. Structure scenes (intro / idle / after / outro, timeline/acts.js) get a
// generated ghost the same way: holdScript (intro, idle, outro) or afterScript (after).
// What is internal / which act a scene shows comes from the caller (timeline/acts.js isInternal / sceneKind); the
// defaults read the raw `tags` (the user's diff, acts.js). 'offscreen' is never detected, so the raw tag is the truth.
// A camera split (scene.split 'camera', continues true: pawtrack camera.py) is the same shot: no member between, so no
// cutaway and no bridge; runs-channel.js carries the level across it.
// Scenes contain shots (paw-2zy, timeline/shots.js): a list entry is a shot and `join: true` puts it in the scene
// before. A scene's off-screen / blank / internal shots between two of its visible shots are a continuation exactly
// like the old `continues` link (which stays: proposals still write continues 'auto' on the live list, never stored).
// paw-2lp7.4 (the owner: "cutaway is to something not action; off screen is not on screen but continuing"): ONE bridge. An
// off-screen shot is bridged; a cutaway (view 'cutaway') is bridged exactly the same only while an action region covers it
// (`carried`, set by timeline/regions.js withCarried: OFF reads it), else it is an intermission and nothing is carried.
// ponytail: knows the view ids 'internal' / 'offscreen' / 'cutaway' and the camera ids by name; the vocabulary is timeline/acts.js TAG_CATEGORIES.
import { GENERATORS, finish } from './gen/generators.js';
import { resolveSegment, CLIMAX_FIT } from './gen/recipes.js';
import { turns } from './edit/strokes.js';

const CAMERA = new Set(['static', 'reciprocal', 'pan', 'zoom', 'orbit', 'handheld', 'pov']);
const VIEWS = new Set(['internal', 'offscreen', 'cutaway', 'blank']);
const INTERNAL = (s) => !!s?.tags?.includes('internal');
const KIND = (s) => s?.tags?.map((t) => t?.id ?? t).find((t) => t[0] !== '-' && !VIEWS.has(t) && !CAMERA.has(t)) ?? null;   // entries may be {id, t0, t1}
// paw-2lp7.4: a cutaway with an action region over it (`carried`, timeline/regions.js withCarried) is off-screen here: one bridge
const OFF = (s) => !!s?.tags?.includes('offscreen') || (!!s?.carried && !!s?.tags?.includes('cutaway'));
const BLANK = (s) => (s?.kind === 'blank' && !s?.tags?.some((t) => t === '-blank' || t === 'offscreen' || t === 'cutaway' || t === 'internal')) || !!s?.tags?.includes('blank');
/** Has the user tagged scene s with something of its own (not a view; a cutaway mark is his decision too)? Fingerprints
 *  never make such a scene off-screen. */
const own = (s) => !!s.tags?.some((t) => t[0] !== '-' && t !== 'offscreen' && t !== 'internal' && t !== 'blank' && !CAMERA.has(t?.id ?? t));
/** s tagged off-screen (and not removed): as the user wrote it. */
const offscreen = (s) => ({ ...s, tags: [...(s.tags || []).filter((t) => t !== '-offscreen' && t !== 'offscreen'), 'offscreen'] });
const member = (s, internal, blank = BLANK) => internal(s) || OFF(s) || blank(s);

/** The continuation ending at scene i: {a, b0, b1, c, internal: [member indices that are internal views]} (action,
 *  first / last member, continuing scene), else null (i does not continue, or no member / no action before it). */
export function cutawaySpan(scenes, i, { internal = INTERNAL, blank = BLANK } = {}) {
  const s = scenes[i];
  if (!s?.continues && s?.join !== true) return null;
  let j = i - 1;
  // a shot joined to its scene (timeline/shots.js): the cutaways are the scene's own shots, so each must be joined too
  while (j >= 0 && member(scenes[j], internal, blank)) { if (!s.continues && scenes[j].join !== true) return null; j--; }
  if (j < 0 || j === i - 1) return null;
  const ins = [];
  for (let k = j + 1; k < i; k++) if (internal(scenes[k])) ins.push(k);
  return { a: j, b0: j + 1, b1: i - 1, c: i, internal: ins };
}
/** Every continuation of the list, in order. */
export const continuations = (scenes, o) => scenes.map((_, i) => cutawaySpan(scenes, i, o)).filter(Boolean);
/**
 * paw-2lp7.4: what the bridge fills, {a, b0, b1, c, internal} with a / c = -1 for a side it does not read: every continuation
 * (both sides, as off-screen always was: reading only the action the shot sits in lost on the owner's shots,
 * experiments/cutaway/RESULTS.md), then each run of off-screen shots no continuation holds, from the shots around it that
 * exist (an off-screen shot that starts an action region joined to the shot after it, at the video's start or end; not
 * from a shot the owner said does not continue). Before paw-2lp7.4 those had no bridge at all (paw-ef73.8; the old fills
 * 'before' / 'after' stood in). A one-sided bridge carries that side's rate on.
 */
export function bridgeRuns(scenes, o = {}) {
  const internal = o.internal ?? INTERNAL, blank = o.blank ?? BLANK, isMember = (s) => member(s, internal, blank);
  const out = continuations(scenes, o);
  const held = new Set(out.flatMap((x) => Array.from({ length: x.b1 - x.b0 + 1 }, (_, k) => x.b0 + k)));
  for (let i = 0; i < scenes.length; i++) {
    if (held.has(i) || !OFF(scenes[i])) continue;
    let j = i;
    while (j + 1 < scenes.length && OFF(scenes[j + 1]) && !held.has(j + 1)) j++;
    const a = i > 0 && !isMember(scenes[i - 1]) ? i - 1 : -1, n = scenes[j + 1], c = n && !isMember(n) && n.continues !== false ? j + 1 : -1;
    if (a >= 0 || c >= 0) out.push({ a, b0: i, b1: j, c, internal: [] });
    i = j;
  }
  return out.sort((x, y) => x.b0 - y.b0);
}

/** Scene i continues the previous action (on) or not: on writes true and makes scene i-1 a cutaway (tag offscreen)
 *  unless it is an internal view; off writes false (a "no" a later proposal respects). -> a new list, or null when i < 2. */
export function setContinues(scenes, i, on, { internal = INTERNAL, blank = BLANK } = {}) {
  if (!(i >= 2 && i < scenes.length)) return null;
  return scenes.map((s, k) => (k === i ? { ...s, continues: !!on } : on && k === i - 1 && !member(s, internal, blank) ? offscreen(s) : s));
}
/** Scenes lo..hi are one action: the inner ones cutaways (offscreen) unless internal views (kept, tracked), their own
 *  `continues` dropped; hi continues. -> a new list, or null when there is no inner scene. */
export function markAction(scenes, lo, hi, { internal = INTERNAL, blank = BLANK } = {}) {
  if (!(lo >= 0 && hi < scenes.length && hi - lo >= 2)) return null;
  return scenes.map((s, k) => {
    if (k === hi) return { ...s, continues: true };
    if (k <= lo || k > hi) return s;
    const { continues, ...rest } = s;   // eslint-disable-line no-unused-vars
    return internal(s) || blank(s) ? rest : offscreen(rest);
  });
}

// ---- proposals ----

/** RGBA bytes of a 16x16 picture -> Float32Array(256) of luma 0..1. */
export function grey16(rgba) {
  const out = new Float32Array(256);
  for (let i = 0; i < 256; i++) out[i] = (0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2]) / 255;
  return out;
}
/** Mean absolute difference of two fingerprints (0 = same picture, 1 = black vs white); NaN if one is missing. */
export function printDist(a, b) {
  if (!a || !b) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}
/** Where a scene's fingerprints are taken: a little inside it (cuts and fades sit on the edges). -> [first, last] ms;
 *  k > 2: k times evenly from first to last (the crop matcher's frame set, paw-3uyu). */
export function printTimes(s, k = 2) {
  const inset = Math.min(120, (s.end_ms - s.start_ms) / 4), a = s.start_ms + inset, b = s.end_ms - inset;
  return Array.from({ length: k }, (_, i) => Math.round(a + ((b - a) * i) / (k - 1)));
}

// paw-3uyu: measured on the owner's projects (experiments/cropscene/RESULTS.md); kept as they were.
export const CONTINUE_FIT = { same: 0.1, differ: 0.15 };
/**
 * prints[i] = {first, last} (grey16) per scene. -> start_ms of every scene c that looks like it continues a scene a
 * across the inserts between (1 .. gap - 1 of them): c's start ≈ a's end (<= same) or c and a are the same footage
 * re-framed (crop(a, c): lib/crop-match.js cropLink, paw-3uyu), the inserts differ from both (>= differ, and no crop
 * link with a / c). An insert that is itself a crop of a shot before a is the action going on, never a cutaway (the
 * owner: "this is not a cutaway, it's a crop on the prev scene"). Left to right, nearest a first; a proposed scene is
 * never the cutaway of the next. Only where the user has not decided (continues == null) and no insert has a tag of
 * its own (an off-screen tag is fine) or is an internal view. crop(i, j) (i < j) -> a link | null; without it (and
 * gap 2) this is the first / last print rule alone. dist(i, j): i's last print vs j's first (the experiment's hook).
 * -> [{a, c, crop (the a-c link when that is what matched, else null)}].
 */
export function proposeSpans(scenes, prints, { same = CONTINUE_FIT.same, differ = CONTINUE_FIT.differ, internal = INTERNAL, crop = null, gap = crop ? 3 : 2,
  dist = (i, j) => printDist(prints[i]?.last, prints[j]?.first) } = {}) {
  const out = [], link = (i, j) => crop?.(Math.min(i, j), Math.max(i, j)) || null;
  const before = (k, a) => { for (let j = Math.max(0, k - gap); j < a; j++) if (link(j, k)) return true; return false; };   // k re-frames a shot before a
  const apart = (x, y) => dist(x, y) >= differ;   // NaN (no print): not apart
  for (let c = 2; c < scenes.length; c++) {
    if (scenes[c].continues != null) continue;
    for (let a = c - 2; a >= Math.max(0, c - gap); a--) {
      const ins = Array.from({ length: c - a - 1 }, (_, n) => a + 1 + n);
      if (ins.some((k) => own(scenes[k]) || internal(scenes[k]))) break;   // never demote an internal view
      const L = link(a, c);
      if (!(dist(a, c) <= same || L) || !apart(a, a + 1) || !apart(c - 1, c) || ins.some((k) => link(a, k) || link(k, c) || before(k, a))) continue;
      out.push({ a, c, crop: dist(a, c) <= same ? null : L });
      c++;   // c+1's cutaway would be c: A W A W proposes once, A W A W A twice
      break;
    }
  }
  return out;
}
/** proposeSpans as the start_ms of each continuing scene (the older shape). */
export const proposeContinues = (scenes, prints, o) => proposeSpans(scenes, prints, o).map((p) => scenes[p.c].start_ms);
/** The scenes as drawn and bridged, proposals applied as continues 'auto' (never stored: the document keeps only the
 *  user's decisions): a scene after a member run that has an off-screen scene in it, or after a run of internal views
 *  whose act (non-null) is the scene's before them; then each fingerprint proposal (a start_ms in `starts`) with its
 *  cutaway off-screen. Same list when none applies. */
export function withProposals(scenes, starts, { internal = INTERNAL, kind = KIND, blank = BLANK } = {}) {
  let out = scenes;
  for (let c = 1; c < scenes.length; c++) {
    if (scenes[c].continues != null || scenes[c].join === true || member(scenes[c], internal, blank)) continue;   // joined: already one scene
    let j = c - 1, off = false;
    while (j >= 0 && member(scenes[j], internal, blank)) { off ||= OFF(scenes[j]); j--; }   // a blank is detected, not the user's word: needs the same act
    if (j < 0 || j === c - 1) continue;
    const k = kind(scenes[j]);
    if (!off && (!k || kind(scenes[c]) !== k)) continue;
    if (out === scenes) out = [...scenes];
    out[c] = { ...scenes[c], continues: 'auto' };
  }
  if (!starts?.size) return out;
  for (let c = 2; c < scenes.length; c++) {
    if (!starts.has(scenes[c].start_ms) || out[c].continues != null || scenes[c].join === true) continue;
    const ta = starts.get?.(scenes[c].start_ms), a = ta == null ? c - 2 : scenes.findIndex((s) => s.start_ms === ta);   // a Map: start_ms -> the action's start (paw-3uyu: 1-2 inserts)
    const ins = a >= 0 && a < c - 1 ? scenes.slice(a + 1, c) : [];
    if (!ins.length || ins.some((b, n) => own(b) || internal(b) || out[a + 1 + n].continues)) continue;
    if (out === scenes) out = [...scenes];
    out[c] = { ...out[c], continues: 'auto' };
    ins.forEach((b, n) => { if (!OFF(b) && !blank(b)) out[a + 1 + n] = offscreen(b); });
  }
  return out;
}

// ---- the bridge ----

/** Turning points ({at, pos, kind 'top'|'bottom'}) of a Script with at in [t0, t1]; a hold counts once (its arrival).
 *  paw-uiu: a reversal counts once the script has turned back by `minProm` pos (default 10 % of the span's p5..p95, at
 *  least 4; lib/edit/strokes.js turns), so a dense, wobbly script gives its strokes' turns, not every wiggle. */
export function turnsIn(script, t0, t1, minProm = null) {
  let a = script.findIndex((p) => p.at >= t0), b = script.findLastIndex((p) => p.at <= t1);
  if (a < 0 || b < a) return [];
  a = Math.max(0, a - 1); b = Math.min(script.length - 1, b + 1);   // a turn at the window's edge needs its neighbours
  const seg = script.slice(a, b + 1), ps = seg.map((p) => p.pos).sort((x, y) => x - y);
  const P = minProm ?? Math.max(4, 0.1 * (ps[Math.floor(0.95 * (ps.length - 1))] - ps[Math.floor(0.05 * (ps.length - 1))]));
  return turns(seg, P, { endpoints: false }).map((x) => ({ at: seg[x.i].at, pos: seg[x.i].pos, kind: x.kind })).filter((x) => x.at >= t0 && x.at <= t1);
}
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * mode 'hold' (a blank cutaway): holdScript at the last position of `before` (within contextMs), easing into the first
 * of `after`; [] when neither side has points. mode 'carry' (default, off-screen):
 * Strokes for a cutaway [t0, t1]: the `follow` generator with `carry` over the turns of `before` (inside [from, t0],
 * at most contextMs back) and of `after` (inside [t1, to]), depth = the median top / bottom there. The gap between
 * the last turn before and the first after is filled at the local rate with the parity that lands on that turn, so it
 * runs phase-continuous into A'; with no turns after, the rate is carried forward. -> Script strictly inside (t0, t1)
 * ([] when fewer than two turns are near or the gap is shorter than a stroke).
 */
export function bridgeScript(before, after, t0, t1, { from = -Infinity, to = Infinity, contextMs = 10000, maxSpeed = 450, minGapMs = 20, mode = 'carry' } = {}) {
  if (mode === 'hold') {   // the viewer sees nothing (a blank): ease to the level before, stay, ease into the level after
    const b = (before || []).filter((p) => p.at <= t0 && p.at >= Math.max(from, t0 - contextMs)), a = (after || []).filter((p) => p.at >= t1 && p.at <= Math.min(to, t1 + contextMs));
    const lvl = b.length ? b[b.length - 1].pos : a.length ? a[0].pos : null;
    return lvl == null ? [] : holdScript(t0, t1, { level: lvl, end: a.length ? a[0].pos : null, minGapMs });
  }
  const turns = [...turnsIn(before || [], Math.max(from, t0 - contextMs), t0), ...turnsIn(after || [], t1, Math.min(to, t1 + contextMs))];
  if (turns.length < 2 || !(t1 > t0)) return [];
  const tops = turns.filter((x) => x.kind === 'top').map((x) => x.pos), bots = turns.filter((x) => x.kind === 'bottom').map((x) => x.pos);
  const all = turns.map((x) => x.pos), hi = Math.round(tops.length ? median(tops) : Math.max(...all)), lo = Math.round(bots.length ? median(bots) : Math.min(...all));
  // gapFactor 1.5 / gapMinMs 800 (the schema's defaults are 3 / 1500): a short cutaway still gets its strokes
  const s = GENERATORS.follow.gen(t0, t1, { lo, hi, carry: true, gapFactor: 1.5, gapMinMs: 800, contextMs }, { turns, maxSpeed, minGapMs });
  return s.filter((p) => p.at > t0 && p.at < t1);
}

// ---- the bridge's one option: timing from the shot's own motion (paw-b26) ----
// paw-2lp7.4: the fills before / after / both are gone (one bridge: bridgeScript carries the action across, one-sided at an
// edge; measured on the owner's shots, experiments/cutaway/RESULTS.md). What is left of `fill` is the option 'timing' on an
// off-screen shot (or a cutaway under an action): tracked for its turn times only (an off-screen cut to a flapping dick:
// the timing is right there, the depth is not), the depth from the shots around it.
export const FILL_MODES = ['timing'];
/** Turns a side needs: three = two half-strokes, so a rate and a depth both come from it. */
export const FILL_MIN_TURNS = 3;
/** Runs of consecutive off-screen shots with the timing option -> [{lo, hi, a, c, mode: 'timing'}]; a, c = the nearest shots
 *  before lo / after hi without it (-1 / scenes.length when none). A timing option on a shot that is not bridged (an
 *  intermission cutaway, a shot back in the action) does nothing. */
export function fillSpans(scenes) {
  const out = [], filled = (k) => scenes[k]?.fill === 'timing' && OFF(scenes[k]);
  scenes.forEach((s, i) => {
    if (!filled(i)) return;
    const last = out[out.length - 1];
    if (last && last.hi === i - 1) last.hi = i; else out.push({ lo: i, hi: i, mode: 'timing' });
  });
  for (const f of out) {
    let a = f.lo - 1, c = f.hi + 1;
    while (a >= 0 && filled(a)) a--;
    while (c < scenes.length && filled(c)) c++;
    Object.assign(f, { a, c });
  }
  return out;
}
/** A side's turns -> {h (median half-stroke ms), hi, lo (median top / bottom)}. */
function sideOf(turns) {
  const d = turns.slice(1).map((x, i) => x.at - turns[i].at), tops = turns.filter((x) => x.kind === 'top').map((x) => x.pos), bots = turns.filter((x) => x.kind === 'bottom').map((x) => x.pos);
  const all = turns.map((x) => x.pos);
  return { h: Math.max(1, median(d)), hi: tops.length ? median(tops) : Math.max(...all), lo: bots.length ? median(bots) : Math.min(...all) };
}
const lerp = (a, b, f) => a + (b - a) * Math.min(1, Math.max(0, f));
/**
 * The timing option over [t0, t1]: the turns of `own` (the span's tracked points) keep their times and kinds; a top takes
 * the before side's median top (turns of `before` inside [from, t0], at most contextMs back) easing to the after side's
 * (`after` inside [t1, to]) across the span, a bottom the same, so both ends join without a jump; one side alone gives
 * both. -> {script (strictly inside (t0, t1)), need: '' | 'timing' (fewer than two turns of its own) | 'both' (no side with
 * FILL_MIN_TURNS turns)}.
 */
export function fillScript(before, after, t0, t1, { from = -Infinity, to = Infinity, contextMs = 10000, maxSpeed = 450, minGapMs = 20, own = null } = {}) {
  const tb = turnsIn(before || [], Math.max(from, t0 - contextMs), t0), ta = turnsIn(after || [], t1, Math.min(to, t1 + contextMs));
  const o = (own || []).filter((p) => p.at > t0 && p.at < t1), ps = o.map((p) => p.pos).sort((x, y) => x - y);   // its ends are turns too (the shot's first / last stroke)
  const T = o.length < 2 ? [] : turns(o, Math.max(4, 0.1 * (ps[Math.floor(0.95 * (ps.length - 1))] - ps[Math.floor(0.05 * (ps.length - 1))]))).map((x) => ({ at: o[x.i].at, kind: x.kind })), okB = tb.length >= FILL_MIN_TURNS, okA = ta.length >= FILL_MIN_TURNS;
  const need = T.length < 2 ? 'timing' : !okB && !okA ? 'both' : '';
  if (need || !(t1 > t0)) return { script: [], need };
  const B = okB ? sideOf(tb) : sideOf(ta), A = okA ? sideOf(ta) : B, f = (t) => (t - t0) / (t1 - t0);
  const keys = T.map((x) => ({ t: x.at, p: x.kind === 'top' ? lerp(B.hi, A.hi, f(x.at)) : lerp(B.lo, A.lo, f(x.at)) }));
  const hi = Math.max(...keys.map((x) => x.p)), lo = Math.min(...keys.map((x) => x.p));
  const s = finish(keys, t0, t1, { lo, hi, anchor: 'hi', shape: 'linear' }, { maxSpeed, minGapMs });
  return { script: s.filter((p) => p.at > t0 && p.at < t1), need: '' };
}

/** Rest = out (pos 100): the old idle recipe's hold (gen/recipes.js RECIPES.hold). */
export const REST = 100;
/**
 * A hold over [t0, t1]: from `start` (where the motion before it ends; null = none) ease to `level` over easeMs, stay,
 * then ease to `end` (where the motion after it starts; null = none) over the last easeMs. -> Script strictly inside
 * (t0, t1); [] when the span is shorter than 3 frames' worth (minGapMs x 3). Positions rounded.
 */
export function holdScript(t0, t1, { start = null, level = REST, end = null, easeMs = 600, minGapMs = 20 } = {}) {
  if (!(t1 - t0 >= 3 * minGapMs) || !Number.isFinite(level)) return [];
  const e = Math.min(easeMs, (t1 - t0) / 3), out = [], put = (at, pos) => { at = Math.round(at); if (at > t0 && at < t1 && (!out.length || at > out[out.length - 1].at)) out.push({ at, pos: Math.round(pos) }); };
  if (Number.isFinite(start) && Math.round(start) !== Math.round(level)) put(t0 + 1, start);
  put(t0 + e, level);
  put(t1 - e, level);
  if (Number.isFinite(end) && Math.round(end) !== Math.round(level)) put(t1 - 1, end);
  return out;
}
/**
 * paw-2lp7.1: a positioning range [t0, t1]: one slow move (smoothstep, a point every ~stepMs) from `from` (the level the
 * script is at before it; null = none: `to` held) to `to` (the first stroke's start level after it; null = none: `from` held).
 * No strokes. -> Script strictly inside (t0, t1); [] when neither level is known or the span is under 3 x minGapMs.
 */
export function easeScript(t0, t1, from, to, { stepMs = 400, minGapMs = 20 } = {}) {
  const a = Number.isFinite(from) ? from : to, b = Number.isFinite(to) ? to : from;
  if (!Number.isFinite(a) || !(t1 - t0 >= 3 * minGapMs)) return [];
  const n = Math.round(a) === Math.round(b) ? 1 : Math.max(2, Math.round((t1 - t0) / stepMs)), out = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n, at = Math.round(t0 + 1 + u * (t1 - t0 - 2)), pos = Math.round(a + (b - a) * u * u * (3 - 2 * u));
    if (at > t0 && at < t1 && (!out.length || at > out[out.length - 1].at)) out.push({ at, pos });
  }
  return out;
}
/** The old afterglow recipe (gen/recipes.js KINDS.afterglow: slow, shallow strokes easing to rest) over the first
 *  CLIMAX_FIT.afterglowMs of [t0, t1], then a hold where it ends. -> Script strictly inside (t0, t1). */
export function afterScript(t0, t1, { maxMs = CLIMAX_FIT.afterglowMs } = {}) {
  if (!(t1 > t0)) return [];
  const r = resolveSegment({ kind: 'afterglow' }), te = Math.min(t1, t0 + maxMs);
  const s = r.gen(t0, te, r.params, {}).filter((p) => p.at > t0 && p.at < t1);
  if (s.length && te < t1 - 1) s.push({ at: Math.round(t1 - 1), pos: s[s.length - 1].pos });
  return s;
}

// ---- internal views: what tracks them ----
// An x-ray / cross-section shows the inserted part of the shaft inside the body: more mask pixels = deeper. SAM's
// `area` (mask pixels / frame) is oriented larger = higher = out (PROTOCOL.md), so the sign is flipped: pipe_sign keep
// (no auto guess first), pipe_invert true.
export const INTERNAL_TRACK = { tracker: 'sam2_mask', params: { primary: 'area', pipe_sign: 'keep', pipe_invert: true }, label: 'SAM · area' };
// describe.py LOCALIZABLE tags that box the shaft, best first; then the internal view itself (its box covers the x-ray)
const SHAFT_RUNGS = [['penis', '*_penis'], ['knot'], ['internal*', 'x-ray*', 'cross_section', 'cutaway_view']];
const like = (pat, n) => (pat.endsWith('*') ? n.startsWith(pat.slice(0, -1)) : pat.startsWith('*') ? n.endsWith(pat.slice(1)) : n === pat);
/** describe -> the ROI box ({kind:'box', x, y, w, h}, 0..1) of the best-scoring shaft tag with a box on the first rung
 *  that has one (score >= minScore), else null. */
export function shaftBox(describe, minScore = 0.5) {
  const tags = (describe?.tags || []).filter((t) => t?.box?.length === 4 && t.score >= minScore).sort((a, b) => b.score - a.score);
  for (const rung of SHAFT_RUNGS) {
    const t = tags.find((x) => rung.some((p) => like(p, x.tag)));
    if (t) return { kind: 'box', x: t.box[0], y: t.box[1], w: t.box[2], h: t.box[3] };
  }
  return null;
}
/** The tracker an internal-view scene defaults to: {tracker, params, label, box (shaftBox | null)}; null for any other scene. */
export function defaultTrackerFor(scene, { internal = INTERNAL, minScore = 0.5 } = {}) {
  if (!scene || !internal(scene)) return null;
  return { ...INTERNAL_TRACK, params: { ...INTERNAL_TRACK.params }, box: shaftBox(scene.describe, minScore) };
}
