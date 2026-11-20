// commands-range.js -- Autorange (lib/autorange.js) in the app: the live final pass of the finishing stack
// (lib/finish.js). Its settings are data in the project: doc.finish {autorange (on / off), policy (its strength and keep drive the pass)} and each
// scene's own band (scene.range); the plan is recomputed from the scenes, the stroke's points, the effects, the device
// profile and the policy whenever any of them changes, so nothing is ever applied per scene, baked or un-baked.
// The Range lane (RangeLane.svelte) draws and drags the bands. Flatten is the one explicit write of the final into the
// points. Every write is ONE undo step (a drag: app.begin on the first move, commit on release).
import { tl, scenesOf, setScenes, modScenesOf } from './state.svelte.js';
import { trackingOf, activeProfile, acceptGhost } from './deps.js';
import { trackedOf } from './commands-fx.js';
import { POLICY, rangePlan, setSceneRange, gapScript, gapRows } from '../../lib/autorange.js';
import { transitionsOf } from './transitions.svelte.js';
import { envelope, fadeEnvelopes, setFadeEnv, splitAt, splitAll, mergeWith, setPiece, resetSpan, orphans, cornersOf, setCorners, moveSide, moveKeys, deleteKeys, duplicateKeys, keyId } from '../../lib/autorange-env.js';
import { run as runXform } from '../../lib/xform.js';
import { finishOf, finalOf, layersOf } from '../../lib/finish.js';
import { liveFx, markBaked } from '../../lib/fx.js';
import { lowerBound } from '../../lib/core/script.js';
import { shaftOf } from '../../lib/shaft.js';
import { sceneAt } from '../../lib/runs.js';
import { gridOf } from '../../lib/lane.js';
import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live
import { guard } from '../../app/commands.js';

const lastUsed = (app) => app.settings?.get?.('autorange.policy', null) || {};
/** The policy: defaults < the app's last-used (settings) < the project's own (doc.finish.policy). */
export const policyOf = (app) => ({ ...POLICY, ...lastUsed(app), ...(app.doc.finish?.policy || {}) });
/** Inside an open group / transact: the project's finish settings patched (one undoable value). */
export const patchFinish = (app, patch) => { app.doc.finish = { ...finishOf(app.doc), ...patch }; };
/** Inside an open group: policy keys into the project (and the app's last-used, the start for a new project). */
export function setPolicy(app, p) {
  const next = { ...policyOf(app), ...p };
  patchFinish(app, { policy: next });
  app.settings?.set?.('autorange.policy', next);
}
const speedMax = (app) => +app.settings?.get?.('lanes.speedMax', 400) || 400;
export const profileOf = (app) => { try { return activeProfile?.(app.settings) ?? null; } catch { return null; } };
/** What the pass needs from the app (lib/finish.js finalOf reads it through app.finishEnv). */
export const finishEnv = (app) => { const sh = shaftsOf(app); return { profile: profileOf(app), policy: lastUsed(app), maxSpeed: speedMax(app), shafts: sh?.byShot ?? null, shaftsId: sh?.id ?? 0, mods: trackedOf(app), fades: fadesOf(app), grid: gridOf(app.player) }; };
/** paw-ef73.9: the fade envelopes (soft start / stop) of the shots now (lib/autorange-env.js fadeEnvelopes). */
export const fadesOf = (app) => fadeEnvelopes(app.doc.scenes || [], transitionsOf(app), app.player?.frameMs || 1000 / 30, app.durationMs || Infinity, app.doc.finish?.fades);
/** Fade envelope key's share / off set (patch), or back to its default (null): one undo step (coalesced while dragging). */
export function editFadeEnv(app, key, patch, { coalesce = false } = {}) {
  app.transact(patch?.off != null ? (patch.off ? 'Remove fade envelope' : 'Fade envelope back') : 'Fade envelope height', () => patchFinish(app, { fades: setFadeEnv(app.doc.finish?.fades, key, patch) }), { coalesce });
}
/** Per shot, its run's SAM shaft (lib/shaft.js shaftOf: confident share, the confidence channel): where the shot's
 *  strokes took their depth from the shaft (range 'shaft'), the pass keeps it (paw-b28). Cached per scenes / runs. */
const shaftCache = new WeakMap();
let shaftSeq = 0;
export function shaftsOf(app) {
  const tr = trackingOf(app), sc = app.doc.scenes || [];
  if (!tr?.sceneLink || !tr.run) return null;
  const c = shaftCache.get(sc);
  if (c && c.runs === tr.runs) return c.res;
  const byShot = {};
  sc.forEach((s, i) => {
    const l = tr.sceneLink(i), r = l && tr.run(l.runId);
    if (!r?.channels) return;
    const sh = shaftOf(r, sceneAt(r.scenes || [], (s.start_ms + s.end_ms) / 2));
    if (sh) byShot[i] = { share: sh.share, conf: r.channels[`sem_${sh.name}_in_conf`] ?? null };
  });
  const res = Object.keys(byShot).length ? { byShot, id: ++shaftSeq } : null;
  shaftCache.set(sc, { runs: tr.runs, res });
  return res;
}

/** The plan for the document as it is (scenes may be a drag draft; policy may be a policy-drag draft). */
export function planOf(app, { scenes = modScenesOf(app), policy = tl.rangePolicy ?? policyOf(app) } = {}) {
  const tr = trackingOf(app);
  // a scene whose tracked run barely moved (tracking lowMotion): its strokes are noise, a tease fills it
  const lowMotion = (i) => { const l = tr?.sceneLink?.(i); return !!(l && tr.run?.(l.runId)?.lowMotion?.low); };
  return rangePlan(scenes, scriptOf(app, 'stroke'), { profile: profileOf(app), policy, fx: app.doc.fx || [],
    linked: (i) => !!tr?.sceneLink?.(i), lowMotion, maxSpeed: speedMax(app), shafts: shaftsOf(app)?.byShot ?? null });
}

/** Is the live pass on? */
export const autorangeOn = (app) => !!app.doc.finish?.autorange;

/** Autorange on / off (the live pass; off = the points as they are, instantly). Turning it on keeps the policy it
 *  starts with in the project (the pass is the same whatever the app settings say later). One undo step. */
export function setAutorange(app, on = !autorangeOn(app)) {
  if (on) {
    const plan = planOf(app);
    if (!plan.some((r) => r.source !== 'none' || r.tease?.length)) { app.toast('Autorange: nothing to range, detect scenes and track a shot first', 'quiet'); return false; }
    tl.range = true;
  }
  app.transact(on ? 'Autorange on' : 'Autorange off', () => patchFinish(app, { autorange: on, ...(on && { applied: false, policy: policyOf(app) }) }));
  app.toast(on ? 'Autorange live: the stroke plays and exports through the bands' : 'Autorange off: the points play as they are', 'quiet');
  app.usage?.note?.(on ? 'timeline:autorange' : 'timeline:autorange-off');
  return true;
}
/** Kept for callers of the old "re-plan": the pass is live, so this just makes sure it is on. */
export const replan = (app) => (autorangeOn(app) ? true : setAutorange(app, true));

/** Inside an open group: scene i's band and / or strength set by hand ({lo, hi, lo1, hi1} / {strength}: merged with
 *  what it has; null = back to the policy, {off: true} = not ranged). Steering a band turns the pass on. */
export function writeSceneRange(app, i, range) {
  const cur = (app.doc.scenes || [])[i]?.range;
  setScenes(app, setSceneRange(app.doc.scenes || [], i, range && !range.off && cur && !cur.off ? { ...cur, ...range } : range));
  if (!autorangeOn(app)) patchFinish(app, { autorange: true, applied: false, policy: policyOf(app) });
}
export function resetSceneRange(app, i) { app.transact('Autorange: back to the policy', () => writeSceneRange(app, i, null)); }
/** Lock: the band the policy gives scene i now becomes its own (a policy change leaves it). */
export function lockSceneRange(app, i) {
  const r = planOf(app).find((q) => q.i === i);
  if (r) app.transact(`Autorange: lock S${i + 1}`, () => writeSceneRange(app, i, { lo: r.lo, hi: r.hi, lo1: r.lo1, hi1: r.hi1 }));
}
/** Leave scene i alone: its points play as they are (double-click / reset: back to the policy). */
export function clearSceneRange(app, i) {
  app.transact(`Autorange: leave S${i + 1} as it is`, () => setScenes(app, setSceneRange(app.doc.scenes || [], i, { off: true })));
}


/** Inside an open group: the policy (a policy-handle drag previews through here; the pass follows live). */
export const writePolicy = (app, policy) => patchFinish(app, { policy });

/**
 * Flatten: the final (autorange + live effects) written into the points, the layers cleared there -- the one explicit
 * bake, for hand-finishing. The I/O range (snapped out to whole scenes, and to every live effect reaching into it)
 * when set: that stretch becomes a hand piece the pass leaves alone and the effects in it are marked baked; else the
 * whole stroke: autorange off, every live effect baked. paw-x7w7: the live runs / fills are in the points it reads
 * (scriptOf); a live shot the final changes is baked by the write (app.edit), one it leaves as it is stays live. One undo
 * step; what plays does not change. -> points written.
 */
export function flatten(app, range = app.doc.range) {
  const base0 = scriptOf(app, 'stroke'), L = layersOf(app.doc);
  const sc = scenesOf(app);
  let span = null;
  if (range && range.t1 > range.t0) {
    span = { t0: range.t0, t1: range.t1 };
    for (let k = 0; k < 4; k++) {   // out to whole scenes and to the live effects reaching in, until it holds still
      const was = `${span.t0}|${span.t1}`;
      for (const e of liveFx(app.doc.fx)) if (e.t0 < span.t1 && e.t1 > span.t0) span = { t0: Math.min(span.t0, e.t0), t1: Math.max(span.t1, e.t1) };
      for (const s of sc) if (s.start_ms < span.t1 && s.end_ms > span.t0) span = { t0: Math.min(span.t0, s.start_ms), t1: Math.max(span.t1, s.end_ms) };
      if (`${span.t0}|${span.t1}` === was) break;
    }
  }
  const F = { n: 0 }, base = base0;
  if (!L.autorange && !L.effects) { app.toast('Flatten: nothing to flatten, the points are already what plays', 'quiet'); return 0; }
  const fin = finalOf(app);
  const a = span ? lowerBound(base, span.t0) : 0, b = span ? lowerBound(base, span.t1) : base.length;
  const fa = span ? lowerBound(fin, span.t0) : 0, fb = span ? lowerBound(fin, span.t1) : fin.length;
  const script = span ? [...base.slice(0, a), ...fin.slice(fa, fb), ...base.slice(b)] : fin;
  const inSpan = span ? sc.map((s, i) => (s.start_ms >= span.t0 && s.end_ms <= span.t1 ? i : -1)).filter((i) => i >= 0) : [];
  const label = (span && inSpan.length ? `Flatten S${inSpan[0] + 1}${inSpan.length > 1 ? `–S${inSpan[inSpan.length - 1] + 1}` : ''} (the final into the points)` : 'Flatten (the final into the points)')
    + (F.n ? ` + ${F.n} fill${F.n === 1 ? '' : 's'}` : '');
  app.transact(label, () => {
    if (script !== base0) app.edit(label, 'stroke', script);
    if (!L.autorange && !L.effects) return;
    app.doc.fx = markBaked(app.doc.fx || [], span);
    if (!span) patchFinish(app, { autorange: false, applied: true });
    else if (L.autorange) writeOv(app, setPiece(ovOf(app), envOf(app), { t0: span.t0, t1: span.t1 - 1 }, { off: true }));
  });
  app.toast(`${label}: ${fb - fa} point${fb - fa === 1 ? '' : 's'}; ${F.n ? 'the fills now play as they showed' : 'what plays is unchanged'}`, 'ok', { action: { label: 'Undo', run: () => app.undo() } });
  app.usage?.note?.('timeline:flatten', { range: !!span, points: fb - fa, fills: F.n });
  return fb - fa;
}

// ---- the band envelope (lib/autorange-env.js): pieces finer than a scene, corners, keys; every edit one undo step ----
/** The envelope the pass uses for the document as it is (scenes may be a drag draft). */
export const envOf = (app, plan = planOf(app)) => envelope(plan, scriptOf(app, 'stroke'), { scenes: modScenesOf(app), bands: app.doc.finish?.bands || [], keys: app.doc.finish?.keys || [], fades: fadesOf(app) });
/** The owner's overrides now: {bands, keys}. */
export const ovOf = (app) => ({ bands: app.doc.finish?.bands || [], keys: app.doc.finish?.keys || [] });
/** Inside an open group / transact: the overrides written (steering the band turns the pass on). */
export function writeOv(app, ov) {
  patchFinish(app, { bands: ov.bands || [], keys: ov.keys || [], ...(!autorangeOn(app) && { autorange: true, applied: false, policy: policyOf(app) }) });
}
/** One undoable edit of the overrides: fn(ov, env) -> new ov (the same = nothing to do). -> changed? */
export function editOv(app, label, fn) {
  const ov = ovOf(app), next = fn(ov, envOf(app));
  if (!next || next === ov || (next.bands === ov.bands && next.keys === ov.keys)) return false;
  app.transact(label, () => writeOv(app, next));
  return true;
}
/** The depth piece holding t (null outside every tracked piece). */
export const pieceAt = (env, t) => env.pieces.find((p) => t >= p.t0 && t <= p.t1) ?? null;
const pname = (p) => `${p.why[0]} (${(p.t0 / 1000).toFixed(1)}–${(p.t1 / 1000).toFixed(1)} s)`;
/** Split the band piece at t (the playhead by default) into two that move apart. */
export function splitBand(app, t = Math.round(app.player.timeMs)) {
  const env = envOf(app), p = pieceAt(env, t);
  if (!p) { app.toast('Range: no band piece there to split (a tracked scene with Autorange)', 'quiet'); return false; }
  return editOv(app, 'Range: split band', (ov) => splitAt(ov, env, p, t)) || (app.toast('Range: too close to the piece\'s edge to split', 'quiet'), false);
}
/** One band piece per shot of the piece's scene part. */
export function splitByShots(app, p) {
  const ts = scenesOf(app).map((s) => s.start_ms).filter((t) => t > p.t0 && t < p.t1);
  if (!ts.length) { app.toast('Range: this piece is one shot', 'quiet'); return false; }
  return editOv(app, 'Range: split by shots', (ov, env) => splitAll(ov, env, env.pieces.find((q) => q.t0 === p.t0) ?? p, ts));
}
/** A band piece per modifier span edge inside the piece. */
export function splitBySpans(app, p) {
  const env = envOf(app), ts = env.mods.flatMap((m) => [m.t0, m.t1]).filter((t) => t > p.t0 && t < p.t1);
  if (!ts.length) { app.toast('Range: no modifier span inside this piece', 'quiet'); return false; }
  return editOv(app, 'Range: split by modifier spans', (ov) => splitAll(ov, env, p, ts));
}
export const mergeBand = (app, p, side) => editOv(app, 'Range: merge with the neighbor', (ov, env) => mergeWith(ov, env, env.pieces.find((q) => q.t0 === p.t0 && q.t1 === p.t1) ?? p, side));
export const setBandPiece = (app, p, patch, label = 'Range: piece') => editOv(app, label, (ov, env) => setPiece(ov, env, env.pieces.find((q) => q.t0 === p.t0 && q.t1 === p.t1) ?? p, patch));
/** Back to auto: one piece, its scene (and the scene's old whole-scene band), or everything. */
export function resetBand(app, scope, p = null) {
  const sc = scenesOf(app);
  if (scope === 'all') {
    app.transact('Range: everything back to auto', () => { writeOv(app, { bands: [], keys: [] }); setScenes(app, (app.doc.scenes || []).map((s) => { if (!s.range) return s; const { range: _r, ...r } = s; return r; })); });
    return true;
  }
  let [t0, t1] = [p.t0, p.t1];
  if (scope === 'scene') [t0, t1] = p.bounds ?? [p.t0, p.t1];
  app.transact(scope === 'scene' ? 'Range: scene back to auto' : `Range: ${pname(p)} back to auto`, () => {
    writeOv(app, resetSpan(ovOf(app), t0, t1, envOf(app)));
    if (scope === 'scene') { let l = app.doc.scenes || []; sc.forEach((s, i) => { if (s.range && s.start_ms >= t0 - 2 && s.end_ms <= t1 + 2) l = setSceneRange(l, i, null); }); setScenes(app, l); }
  });
  return true;
}
/** Hand pieces / keys whose scene is gone: dropped as one undo step, with a toast that can undo it. -> count. */
export function dropOrphans(app) {
  const r = orphans(ovOf(app), app.doc.scenes || []);
  if (!r.dropped) return 0;
  app.transact('Range: drop hand edits of a deleted scene', () => writeOv(app, r.ov));
  app.toast(`Range: ${r.dropped} hand-made piece${r.dropped === 1 ? '' : 's'} / key${r.dropped === 1 ? '' : 's'} dropped (their scene is gone)`, 'warn', { action: { label: 'Undo', run: () => app.undo() } });
  return r.dropped;
}

// the selection on the Range row: tl.rangeSel = [{type: 'key', id} | {type: 'corner', t0, t1, corner}]
const selPieces = (env) => (tl.rangeSel || []).filter((s) => s.type === 'corner').map((s) => ({ s, p: env.pieces.find((q) => q.t0 === s.t0 && q.t1 === s.t1) })).filter((x) => x.p);
const selKeys = () => (tl.rangeSel || []).filter((s) => s.type === 'key').map((s) => s.id);
export const rangeSelected = () => (tl.rangeSel || []).length > 0;
/** The selection's handles moved by dt (ms: a corner's side, a key's time) and dp (pos), from ov / env at the start. */
export function moveSelection(ov, env, dt, dp) {
  let o = ov;
  const byPiece = new Map();
  for (const { s, p } of selPieces(env)) { const a = byPiece.get(p) ?? []; a.push(s.corner); byPiece.set(p, a); }
  for (const [p, cs] of byPiece) {
    if (dp) { const c = cornersOf(env, p); o = setCorners(o, env, p, Object.fromEntries(cs.map((k) => [k, c[k] + dp]))); }
    if (dt) for (const side of new Set(cs.map((k) => (k.endsWith('1') ? 't1' : 't0')))) o = moveSide(o, env, p, side, (side === 't0' ? p.t0 : p.t1) + dt);
  }
  const ks = selKeys();
  if (ks.length) o = moveKeys(o, env, ks, dt, dp).ov;
  return o;
}
/** G / S on the selection (lib/xform.js: X / Y constrain, typed values, Enter / Esc). */
export function xformSelection(app, kind) {
  const ov0 = ovOf(app), env = envOf(app), el = document.querySelector('[data-tl-lane="range"]'), w = el?.clientWidth || 1000, h = el?.clientHeight || 80, fms = app.player.frameMs || 0;
  const group = app.begin(kind === 'grab' ? 'Range: move handles' : 'Range: scale handles');
  const levels = selPieces(env).map(({ s, p }) => cornersOf(env, p)[s.corner]), mid = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : 50;
  runXform({ kind, axes: kind === 'grab' ? 'xy' : 'y', origin: tl.hover?.lane === 'range' ? [tl.hover.x, tl.hover.y] : null, follow: kind === 'grab' && el ? { app, el } : null,
    mouse: (o, q, e) => {
      if (kind === 'scale') return { f: Math.max(0, 1 + (o[1] - q[1]) / 80) };
      const dt = ((q[0] - o[0]) / w) * app.view.span;
      return { dt: fms && !e.shiftKey ? Math.round(dt / fms) * fms : dt, dp: (-(q[1] - o[1]) / Math.max(1, h - 8)) * 100 };
    },
    preview: (a) => {
      if (kind === 'scale') {
        let o = ov0;
        const byPiece = new Map();
        for (const { s, p } of selPieces(env)) { const c = byPiece.get(p) ?? {}; const v = cornersOf(env, p)[s.corner]; c[s.corner] = mid + (v - mid) * a.f; byPiece.set(p, c); }
        for (const [p, c] of byPiece) o = setCorners(o, env, p, c);
        const ks = new Set(selKeys());
        o = { ...o, keys: (o.keys || []).map((k) => (ks.has(keyId(k)) ? { ...k, d: Math.round(k.d * a.f) } : k)) };
        writeOv(app, o);
        return a;
      }
      writeOv(app, moveSelection(ov0, env, Math.round(a.dt), a.dp));
      return a;
    },
    cancel: () => group.cancel(),
    confirm: () => group.commit() });
}
/** X: the selected keys deleted, the selected corners back to the auto level. */
export function deleteSelection(app) {
  const ks = selKeys(), env = envOf(app);
  const done = editOv(app, 'Range: delete handles', (ov) => {
    let o = deleteKeys(ov, ks);
    for (const { s, p } of selPieces(env)) { const a = env.auto(s.corner.endsWith('1') ? p.t1 : p.t0); if (a) o = setCorners(o, env, p, { [s.corner]: s.corner.startsWith('hi') ? a[1] : a[0] }); }
    return o;
  });
  tl.rangeSel = [];
  return done;
}
/** Shift+D: copies of the selected keys, then grab them. */
export function duplicateSelection(app) {
  const ks = selKeys();
  if (!ks.length) return false;
  // the copies one frame on (keys on one edge never share a time), then G moves them
  const r = duplicateKeys(ovOf(app), envOf(app), ks, Math.max(1, Math.round(app.player.frameMs || 1)));
  app.transact('Range: duplicate keys', () => writeOv(app, r.ov));
  tl.rangeSel = r.ids.map((id) => ({ type: 'key', id }));
  xformSelection(app, 'grab');
  return true;
}

/** Gap suggestions: [{row, script}] -- act scenes with no points (their act's recipe) and dead gaps (a tease at the
 *  top of the band); row.t0 / t1 = the span filled (lib/autorange gapRows / gapScript). */
export function gapsOf(app, plan = planOf(app)) {
  const ctx = { maxSpeed: speedMax(app), minGapMs: Math.max(1, Math.round(profileOf(app)?.minIntervalMs || 20)) };
  return gapRows(plan).map((row) => ({ row, script: gapScript(row, scriptOf(app, 'stroke'), ctx) })).filter((g) => g.script.length);
}
/** Accept gap fills into the stroke (all, or the scenes in `only`): one undo step. A scene teased whole is marked
 *  (scene.tease: no act, no reshape) so it is not offered again. -> points accepted. */
export function acceptGaps(app, only = null) {
  const gaps = gapsOf(app).filter((g) => !only || only.includes(g.row.i));
  if (!gaps.length) { app.toast('Autorange: no gaps to fill', 'quiet'); return 0; }
  let script = scriptOf(app, 'stroke'), n = 0;
  for (const g of gaps) { const r = acceptGhost(script, g.script, { range: { t0: g.row.t0 + 1, t1: g.row.t1 - 1 }, mode: 'replace' }); script = r.script; n += r.ats.length; }
  const whole = new Set(gaps.filter((g) => g.row.whole).map((g) => g.row.i)), ids = [...new Set(gaps.map((g) => g.row.i))];
  const label = ids.length === 1 ? `Autorange: fill gap S${ids[0] + 1}` : `Autorange: fill ${gaps.length} gaps`;
  app.transact(label, () => {
    app.edit(label, 'stroke', script);
    if (whole.size) app.doc.scenes = (app.doc.scenes || []).map((s, k) => (whole.has(k) ? { ...s, tease: true } : s));
  });
  app.toast(`${label} (${n} points)`, 'ok');
  return n;
}

const G = { menu: 'Edit', group: 'Modifiers' };
export default [
  { id: 'timeline.autorange', title: 'Autorange on / off', keys: ['Ctrl+Alt+R'], ...G, run: (app) => setAutorange(app) },
  { id: 'timeline.flatten', title: 'Flatten: write what plays into the points', ...G,
    when: guard((app) => { const L = layersOf(app.doc); return L.autorange || L.effects > 0; }, 'Turn on Autorange or add a modifier first'), run: (app) => flatten(app) },
  // the Range row's own keys (only while it has focus): K splits the band at the playhead (Blender's knife; the video's
  // K = shuttle stop wins while playing), G / S / X / Shift+D on the selected corners and keys
  { id: 'timeline.range.split', title: 'Range: split the band at the playhead', keys: ['K'], ...G, when: guard((app) => tl.focus === 'range' && !app.player.playing, () => (tl.focus !== 'range' ? 'Click the Range row first' : 'Pause playback first')), run: (app) => splitBand(app) },
  { id: 'timeline.range.grab', title: 'Range: move the selected corners / keys', keys: ['G'], ...G, hidden: true, when: () => tl.focus === 'range' && rangeSelected(), run: (app) => xformSelection(app, 'grab') },
  { id: 'timeline.range.scale', title: 'Range: scale the selected corners / keys', keys: ['S'], ...G, hidden: true, when: () => tl.focus === 'range' && rangeSelected(), run: (app) => xformSelection(app, 'scale') },
  { id: 'timeline.range.delete', title: 'Range: delete keys, corners back to auto', keys: ['X', 'Delete', 'Backspace'], ...G, hidden: true, when: () => tl.focus === 'range' && rangeSelected(), run: (app) => deleteSelection(app) },
  { id: 'timeline.range.duplicate', title: 'Range: duplicate the selected keys and move them (Shift+D)', keys: ['Shift+D'], ...G, hidden: true, when: () => tl.focus === 'range' && (tl.rangeSel || []).some((s) => s.type === 'key'), run: (app) => duplicateSelection(app) },
  { id: 'timeline.range.selectNone', title: 'Range: select no handle', keys: ['Escape'], ...G, hidden: true, when: () => tl.focus === 'range' && rangeSelected(), run: () => { tl.rangeSel = []; } },
  { id: 'timeline.range.resetAll', title: 'Range: everything back to auto', ...G, when: guard((app) => (app.doc.finish?.bands?.length || app.doc.finish?.keys?.length || (app.doc.scenes || []).some((s) => s.range)) > 0, 'Nothing to reset: every band is auto'), run: (app) => resetBand(app, 'all') },
  { id: 'timeline.autorange.gaps', title: 'Autorange: accept every gap fill', ...G, when: guard(() => tl.range, 'Show the Range row first'), run: (app) => acceptGaps(app) },
  { id: 'timeline.autorange.toggle', title: 'Show / hide the Range row', menu: 'View', group: 'timeline', run: () => { tl.range = !tl.range; } },
];
