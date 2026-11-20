// loop-actions.js -- app-side loop actions (the pure maths is loops.js). Each user action is ONE app.transact:
// script edit on the loop's axis + the doc.loops update together, so a single undo reverts both.
import { gen, trackingOf } from './deps.js';
import { tl, scenesOf, newId, durOf } from './state.svelte.js';
import * as L from './loops.js';
import { activeMaxSpeed } from './generate-logic.js';
import { fmtMs } from '../../lib/video.js';
import { gridOf, frameAt, frameTime, frameLen } from '../../lib/lane.js';
import { repeatsOf, picturesOf } from './repeats.svelte.js';
import { shotLabel } from './shots.js';
import { firstSeen, loopWords } from './loop-info.js';
import { loopLooks } from './loop-look.svelte.js';
import { scriptOf as axisScript } from '../../lib/script-of.js';   // paw-x7w7: baked + live
import { detectedMods } from './acts.js';

/** The frame grid loops sit on (lane.js gridOf: the player's clock; paw-kxz4). */
export const fmOf = (app) => gridOf(app.player);
export const getLoop = (app, id) => (id == null ? null : app.doc.loops.find((l) => l.id === id) ?? null);
export const periodFor = (app, loop) => L.periodOf(loop, fmOf(app));
/** Tiles live on the axis they were made on; untiled loops tile onto the active axis. */
export const axisOf = (app, loop) => (loop.axis && app.doc.axes[loop.axis] ? loop.axis : app.doc.activeAxis);
export const scriptOf = (app, loop) => axisScript(app, axisOf(app, loop));
export const isStale = (app, loop) => L.needsRetile(scriptOf(app, loop), loop, periodFor(app, loop));
/** paw-ef73.7: every loop's footage colour and words (loop-info.js), by id: {group, color (paw-llaa: its palette colour,
 *  loop-look.svelte.js), short, long, origin}. Shots by the Shot chip's numbering (shots.js shotLabel). */
export function loopsInWords(app, light) {
  const ix = repeatsOf(app), fm = fmOf(app) || 1000 / 30, list = scenesOf(app), looks = loopLooks(app, light);
  const shotAt = (t) => { const i = list.findIndex((s) => t >= s.start_ms && t < s.end_ms); return i >= 0 ? shotLabel(list, i) : ''; };
  const gs = [...looks.values()];
  return new Map(gs.map(({ l, group, color, pick }) => [l.id, { group, color, ...loopWords(l, {
    frameMs: fm, P: periodFor(app, l), group, pick, auto: !!l.auto && l.t0 === l.auto.t0 && l.t1 === l.auto.t1 && !(l.tiledTo > l.t1),
    others: gs.filter((o) => o.l !== l).map((o) => ({ t0: o.l.t0, group: o.group })), seen: firstSeen(ix, group), shotAt }) }]));
}
export const isLooping = (app, loop) => !!app.player.loop && app.player.loop.t0 === loop.t0 && app.player.loop.t1 === loop.t1;

/** The loop commands act on: the selected one, else the one whose cycle or tiles hold the playhead. */
export function targetLoop(app) {
  const sel = getLoop(app, tl.loop);
  if (sel) return sel;
  const t = app.player.timeMs;
  return app.doc.loops.find((l) => t >= l.t0 && t < Math.max(l.t1, l.tiledTo || 0)) ?? null;
}

const put = (app, loop) => { app.doc.loops = app.doc.loops.map((l) => (l.id === loop.id ? loop : l)).sort((a, b) => a.t0 - b.t0); };
const untiled = ({ tiledTo, srcKey, tiledHand, cont, shifted, ...rest }) => rest;

/** Tile `loop` (+ option patch) up to `end` and store tiledTo / srcKey. quiet: no toasts (batch). -> result or null. */
export function applyTiles(app, loop, end, label = 'Tile loop', patch = {}, quiet = false) {
  const lp = { ...loop, ...patch }, axis = axisOf(app, lp);
  const r = L.buildTiles(axisScript(app, axis), lp, end, gen, { frameMs: fmOf(app), join: lp.join, vary: lp.variation, maxSpeed: activeMaxSpeed(app) || undefined });
  if (r.error) { app.toast(r.error, 'warn'); return null; }
  app.transact(label, () => {
    app.edit(label, axis, r.script);
    put(app, r.tiles.length ? { ...lp, axis, tiledTo: r.end, srcKey: r.key } : untiled(lp));
  });
  if (!quiet) report(app, lp, r);
  return r;
}

function report(app, loop, r) {
  const sp = r.warn || (r.seam?.spike && r.seam);
  if (sp) {
    const dpos = sp.dpos ?? Math.abs(sp.toPos - sp.fromPos), dt = sp.dt ?? sp.gapMs;
    app.toast(`Loop seam jumps ${dpos} in ${Math.round(dt)} ms (${Math.round(sp.speed)} pos/s)`, 'warn', loop.join === 'meet' ? {} : { action: { label: 'Close join', run: () => setOptions(app, loop.id, { join: 'meet' }) } });
  } else if (r.tiles.length) app.toast(`Tiled ${r.tiles.length} repetition${r.tiles.length > 1 ? 's' : ''} to ${fmtMs(r.end)}`, 'ok');
  for (const x of r.issues) if (x.level === 'warn' && !/seam/.test(x.msg)) app.toast(x.msg, 'warn');
}

/** "Tile across range": range end, else scene end, else ask. */
export async function tileLoop(app, id) {
  const loop = getLoop(app, id);
  if (!loop) return app.toast('Select a loop (or stand in one) first', 'quiet');
  let end = L.tileTarget(loop, { range: app.doc.range, scenes: scenesOf(app), loops: app.doc.loops, dur: durOf(app) })?.end;
  if (end == null) {
    const P = periodFor(app, loop), { hi } = L.roomOf(app.doc.loops, loop, durOf(app));
    const n = await app.choose({
      title: 'Tile loop', message: 'No range or scene end after the loop: tile how far?',
      choices: [{ id: '4', label: '4 more cycles' }, { id: '16', label: '16 more cycles', kind: 'primary' }, { id: 'all', label: hi < durOf(app) ? 'Up to the next loop' : 'To the end' }],
    });
    if (!n) return;
    end = n === 'all' ? hi : Math.min(hi, Math.round(loop.t0 + (1 + +n) * P));
  }
  return tileMatched(app, id, end, 'Tile loop');
}

// ---- paw-j3to: tiles end where the loop ends (an owner clip, shot 65: 29 tiles ran 7.8 s past the repeated pictures,
// through the orgasm). Up to the target, only over passes whose pictures still show the cycle at its phase (loops.js passMatch on
// the frames' prints, else on the repeated pictures), never across a modifier boundary or a spurt marker (loops.js fxStop); a
// drag of the tiles' end goes where it is dragged (tiledHand). Passes that go on at another phase: an offer on the tiles' end.
const MATCH_FRAMES = 1200;   // frames read at most (50 s at 24 fps)
/** paw-d9pz: the first orgasm after c the tiles would run into: a Detect cumshots proposal, or the start of a shot the tagger
 *  saw an orgasm in when the shot holding t0 (the cycle) shows none. -> ms, else Infinity. */
export function orgasmStop(scenes, c, t0) {
  const org = (s) => detectedMods(s).includes('orgasm'), own = (scenes || []).find((s) => s.start_ms <= t0 && t0 < s.end_ms);
  let e = Infinity;
  for (const s of scenes || []) {
    if (s.start_ms > c && s.start_ms < e && !(own && org(own)) && org(s)) e = s.start_ms;
    for (const p of s.cum || []) if (p.t > c && p.t < e) e = p.t;
  }
  return e;
}
/** -> {end, why: null | 'differs' | 'modifier' | 'orgasm' | 'end', shift (frames: the cycle goes on that much later; 0 = no), k (the pass it goes on from)}.
 *  paw-d9pz: an automatic loop stops at its detected end (loop.auto.end); only a drag of the tiles' end goes past it. */
export async function matchedEnd(app, loop, end, { k0 = 1, s0 = 0, look = end } = {}) {
  const grid = fmOf(app), fm = frameLen(grid) || 1000 / 30, P = periodFor(app, loop), c1 = L.cycleEnd(loop, P);
  const stops = [['modifier', L.fxStop(app.doc.fx, c1)], ['orgasm', orgasmStop(scenesOf(app), c1, loop.t0)], ['end', loop.auto?.end > c1 ? loop.auto.end : Infinity]];
  const [kind, stop] = stops.reduce((a, b) => (b[1] < a[1] ? b : a));
  const e = Math.min(end, stop), why = stop < end ? kind : null, at = (f) => (frameLen(grid) ? frameTime(f, grid) : Math.round(f * fm));
  const f0 = frameLen(grid) ? frameAt(loop.t0, grid) : Math.round(loop.t0 / fm), F = Math.max(1, Math.round(P / fm));
  // the passes are read up to `look` (past a loop the repeats marked right after: the shifted passes often are one), tiled up to e
  const L1 = Math.min(Math.max(e, look), stop), maxFrames = Math.min(MATCH_FRAMES, (frameLen(grid) ? frameAt(L1 - 1, grid) : Math.floor((L1 - 1) / fm)) - f0 + 1);
  let d = null;
  const tr = trackingOf(app);
  if (tr?.printAt) {
    // (null = not decoded yet: the frame reader starts on its first use; asked again a few times)
    const read = async (f) => { for (let k = 0; k < 4; k++) { const p = await tr.printAt(at(f) + fm / 2); if (p !== null) return p; await new Promise((r) => setTimeout(r, 150)); } return null; };
    const prints = new Map(), get = async (f) => { if (!prints.has(f)) prints.set(f, await read(f)); return prints.get(f); };
    if (await get(f0)) {
      for (let f = f0 - 1; f < f0 + maxFrames; f++) await get(f);
      d = (a, b) => { const A = prints.get(a), B = prints.get(b); if (!A || !B || A.d.length !== B.d.length) return null; let x = 0; for (let i = 0; i < A.d.length; i++) x += Math.abs(A.d[i] - B.d[i]); return (255 * x) / A.d.length; };
    }
  }
  if (!d) { const pic = picturesOf(app); if (pic) d = (a, b) => { const pa = pic(at(a) + 1); return pa >= 0 && pa === pic(at(b) + 1) ? 0 : 1; }; }
  if (!d || maxFrames <= F) return { end: e, why, shift: 0 };
  const m = L.passMatch(f0, F, maxFrames, d, L.TILE_MATCH, { k0, s0 });
  const mEnd = at(f0 + m.end);
  return m.known && mEnd < e ? { end: mEnd, why: 'differs', shift: m.shift, k: m.from ?? Math.floor(m.end / F) } : { end: e, why, shift: 0 };
}
/** The end the passes may be read up to: the target with only the owner's own loops in the way (not the repeats' marks). */
function lookEnd(app, loop) {
  const own = app.doc.loops.filter((l) => l.id === loop.id || !l.auto);
  return L.tileTarget(loop, { range: null, scenes: scenesOf(app), loops: own, dur: durOf(app) })?.end ?? L.roomOf(own, loop, durOf(app)).hi;
}
async function tileMatched(app, id, end, label) {
  const l0 = getLoop(app, id), m = l0 ? await busyHint(app, "Reading the loop's frames…", () => matchedEnd(app, l0, end, { look: Math.max(end, Math.min(lookEnd(app, l0), end + 3 * periodFor(app, l0))) })) : null, loop = getLoop(app, id);
  if (!loop || !m) return null;
  const cont = m.shift && !loop.shifted ? { at: m.end, shift: m.shift, k: m.k } : undefined;
  if (m.end <= L.cycleEnd(loop, periodFor(app, loop))) { app.toast(m.why === 'modifier' ? 'Not tiled: a modifier or spurt marker right after the cycle' : m.why === 'orgasm' ? 'Not tiled: an orgasm right after the cycle' : 'Not tiled: the next pass already differs from the cycle', 'quiet'); return null; }
  const r = applyTiles(app, loop, m.end, label, { tiledHand: undefined, cont, ...(loop.shifted && m.end <= loop.shifted.at ? { shifted: undefined } : {}) }, !!m.why);
  if (r && m.why) {
    const where = `Tiled ${r.tiles.length} repetition${r.tiles.length > 1 ? 's' : ''} to ${fmtMs(r.end)}`;
    const sh = cont ? ` (the same cycle ${Math.abs(cont.shift)} frame${Math.abs(cont.shift) > 1 ? 's' : ''} ${cont.shift > 0 ? 'later' : 'earlier'}: click the tiles' end to continue)` : '';
    if (m.why === 'modifier') app.toast(`${where}: a modifier or spurt marker starts there (drag the tiles' end to go past it)`, 'ok');
    else if (m.why === 'orgasm') app.toast(`${where}: an orgasm starts there (drag the tiles' end to go past it)`, 'ok');
    else if (m.why === 'end') app.toast(`${where}: the detected loop ends there (drag the tiles' end to go past it)`, 'ok');
    else app.toast(`${where}: the pictures differ from the cycle after that${sh}`, 'ok', cont ? { action: { label: 'Continue shifted', run: () => continueShifted(app, id) } } : {});
  }
  return r;
}
/** paw-w3u9: a toast that stays while work() runs, shown only when it takes over `after` ms (the first tile of a fresh clip
 *  reads its frames for a second or two and showed nothing). -> work()'s result. */
export async function busyHint(app, msg, work, after = 250) {
  let id = null;
  const t = setTimeout(() => { id = app.toast(msg, 'info', { timeout: 0 }); }, after);
  try { return await work(); } finally { clearTimeout(t); if (id != null) app.dismiss?.(id); }
}
/** paw-j3to: the loop's footage goes on at another phase (loop.cont {at, shift}): the tiles continue from there with the cycle
 *  shifted (loop.shifted), as far as those passes still show it. */
export async function continueShifted(app, id) {
  const loop = getLoop(app, id);
  if (!loop?.cont) return null;
  const fm = frameLen(fmOf(app)) || 1000 / 30, { at, shift, k } = loop.cont;
  // (the repeats may have marked the shifted passes as a loop of their own: only the owner's loops bound the continuation)
  const end = lookEnd(app, loop);
  const m = await busyHint(app, "Reading the loop's frames…", () => matchedEnd(app, loop, end, { k0: k, s0: shift }));
  if (!(m.end > at)) { app.toast('The shifted passes do not match either', 'quiet'); return null; }
  const r = applyTiles(app, getLoop(app, id), m.end, 'Continue the loop shifted', { shifted: { at, ms: shift * fm }, cont: undefined, tiledHand: undefined }, true);
  if (r) app.toast(`Continued ${Math.abs(shift)} frame${Math.abs(shift) > 1 ? 's' : ''} ${shift > 0 ? 'later' : 'earlier'} to ${fmtMs(r.end)}`, 'ok');
  return r;
}

export async function retileLoop(app, id) {
  const loop = getLoop(app, id);
  if (!loop) return;
  if (!L.isTiled(loop)) return tileLoop(app, id);
  // a hand-dragged end or a shifted continuation keeps its extent; else only the passes that still match
  return loop.tiledHand || loop.shifted ? applyTiles(app, loop, loop.tiledTo, 'Re-tile loop') : tileMatched(app, id, loop.tiledTo, 'Re-tile loop');
}
/** Re-tile every stale loop in one undo entry (each over its matching extent, as retileLoop). */
export async function retileStale(app) {
  const stale = app.doc.loops.filter((l) => isStale(app, l));
  if (!stale.length) return app.toast('All tiled loops are up to date', 'quiet');
  const ends = new Map();
  for (const l of stale) ends.set(l.id, l.tiledHand || l.shifted ? l.tiledTo : (await matchedEnd(app, l, l.tiledTo)).end);
  app.transact(`Re-tile ${stale.length} loop${stale.length > 1 ? 's' : ''}`, () => { for (const l of stale) { const q = getLoop(app, l.id); if (q) applyTiles(app, q, ends.get(l.id), 'Re-tile loop', {}, true); } });
  app.toast(`Re-tiled ${stale.length} loop${stale.length > 1 ? 's' : ''}`, 'ok');
}

export function removeTiles(app, id) {
  const loop = getLoop(app, id);
  if (!loop || !L.isTiled(loop)) return;
  const axis = axisOf(app, loop);
  app.transact('Remove loop tiles', () => {
    app.edit('Remove loop tiles', axis, L.withoutTiles(axisScript(app, axis), loop, periodFor(app, loop)));
    put(app, untiled(loop));
  });
}
/** Drag of the tiled-end handle: end <= cycle end removes the tiles. */
export function setTiledEnd(app, id, end) {
  const loop = getLoop(app, id);
  if (!loop || end === loop.tiledTo) return;
  if (end <= L.cycleEnd(loop, periodFor(app, loop))) return removeTiles(app, id);
  applyTiles(app, loop, end, 'Tile loop', { tiledHand: true, cont: undefined });   // paw-j3to: by hand: where it is dragged
}

export function deleteLoop(app, id) {
  const loop = getLoop(app, id);
  if (!loop) return;
  app.transact('Delete loop', () => {
    app.doc.loops = app.doc.loops.filter((l) => l.id !== id);
    // paw-ef73.4: a loop marked from the repeated frames is not marked again for this project
    if (loop.auto?.key) app.doc.repeats = { ...(app.doc.repeats || {}), off: [...(app.doc.repeats?.off || []), loop.auto.key] };
  });
  if (isLooping(app, loop)) app.player.setLoop(null);
  if (tl.loop === id) tl.loop = null;
  app.toast(L.isTiled(loop) ? 'Loop deleted (its tiles stay in the script)' : 'Loop deleted', 'quiet');
}

/** Replace a loop's region (keeps tiles + options); refuses overlaps. */
function setRegion(app, loop, t0, t1, label, opts) {
  if (t0 === loop.t0 && t1 === loop.t1) return false;
  if (L.overlaps(app.doc.loops, t0, t1, loop.id)) { app.toast('Loops cannot overlap', 'quiet'); return false; }
  const looping = isLooping(app, loop);
  app.transact(label, () => put(app, { ...loop, t0, t1 }), opts);
  if (looping) app.player.setLoop({ t0, t1 });
  return true;
}
export function nudgeLoop(app, id, edge, dir) {
  const loop = getLoop(app, id);
  if (!loop) return;
  const { lo, hi } = L.roomOf(app.doc.loops, loop, durOf(app));
  const n = L.nudgeEdge(loop, edge, dir, fmOf(app), { lo, hi });
  if (n) setRegion(app, loop, n.t0, n.t1, 'Nudge loop', { coalesce: true });
}
export function snapLoop(app, id) {
  const loop = getLoop(app, id);
  if (!loop) return;
  const n = L.snapToFrames(loop, fmOf(app));
  if (!setRegion(app, loop, n.t0, n.t1, 'Snap loop to frames') && n.t0 === loop.t0 && n.t1 === loop.t1) app.toast('Already on frames', 'quiet');
}

/** The detection suggestion for the scene holding the loop (or null). */
export function detectedFor(app, loop) {
  const sc = scenesOf(app).find((s) => s.start_ms <= loop.t0 && loop.t0 < s.end_ms);
  return sc ? L.suggestions([sc])[0] ?? null : null;
}
export function useDetected(app, id) {
  const loop = getLoop(app, id), sug = loop && detectedFor(app, loop);
  if (!sug) return app.toast('No detected period for this scene', 'quiet');
  const r = L.regionAt(loop.t0, L.sugPeriod(sug, fmOf(app)), fmOf(app));
  setRegion(app, loop, loop.t0, r.t1, 'Use detected loop period');
}
/** Click on a detected-period outline: a new frame-snapped loop region. */
export function acceptSuggestion(app, sug) {
  const fm = fmOf(app), r = L.regionAt(sug.t0, L.sugPeriod(sug, fm), fm);
  if (L.overlaps(app.doc.loops, r.t0, r.t1)) return app.toast('A loop is already there', 'quiet');
  const loop = { id: newId('lp'), ...r };
  app.transact('Add loop', () => { app.doc.loops = [...app.doc.loops, loop].sort((a, b) => a.t0 - b.t0); });
  tl.loop = loop.id;
  app.toast(`Loop ${L.loopLabel(loop, fm)} from detection`, 'ok');
  return loop;
}

/** Change join / variation; a tiled loop is re-tiled in the same undo entry. */
/** paw-ef73.5: average the loop's passes on the tracker runs over it (on / off; one undo step, stored on the loop). */
export function setLoopAvg(app, id, on) {
  const loop = getLoop(app, id);
  if (loop) app.transact(on ? 'Average the loop passes' : 'Stop averaging the loop passes', () => put(app, { ...loop, avg: !!on }));
}
export function setOptions(app, id, patch) {
  const loop = getLoop(app, id);
  if (!loop) return;
  if (L.isTiled(loop)) applyTiles(app, loop, loop.tiledTo, 'Loop options', patch);
  else app.transact('Loop options', () => put(app, { ...loop, ...patch }));
}

export function togglePlayback(app, id) {
  const loop = getLoop(app, id);
  if (!loop) return;
  if (isLooping(app, loop)) { app.player.setLoop(null); return; }
  app.player.setLoop(loop);
  if (app.player.timeMs < loop.t0 || app.player.timeMs >= loop.t1) app.player.seek(loop.t0);
}

/** Select the next / previous loop from the playhead, seek to it and keep it in view. */
export function gotoLoop(app, dir) {
  const t = app.player.timeMs, list = app.doc.loops;
  const l = dir > 0 ? list.find((x) => x.t0 > t + 1) : [...list].reverse().find((x) => x.t0 < t - 1);
  if (!l) return app.toast(dir > 0 ? 'No loop after the playhead' : 'No loop before the playhead', 'quiet');
  tl.loop = l.id;
  // focus the Shots row the loop is drawn on (tl.focus follows DOM focus) so Enter / Delete / Alt+arrows act on the loop next
  if (typeof document !== 'undefined') document.querySelector('[data-tl-lane="scenes"]')?.focus({ preventScroll: true });
  app.player.seek(l.t0);
  const v = app.view;
  if (l.t0 < v.start || l.t1 > v.start + v.span) app.setView({ start: l.t0 - v.span * 0.2, span: Math.max(v.span, (l.t1 - l.t0) * 1.5) });
}
