// Marking modifiers (paw-ef73.20; timeline/mods.js, lib/fx.js). One command per kind, in every tab: an event kind
// (orgasm, knotting, throbbing, idle, insertion, pull-out) toggles over the selected scenes (one each), an I / O range the
// owner set, else the scene at the playhead (paw-8b4h: a scene's tags are its action only, the modifier goes on the
// Modifiers row; one already there is selected, not doubled); Shift+O / Shift+K mark orgasm / knotting in at the playhead and, pressed again, out (live while
// playing). A Refine kind (Reshape, Climax run-in) adds over the range, else the scene at the playhead, in Refine only:
// elsewhere it is greyed with its reason (lib/fx REFINE_WHY). Spurt is U (commands-fx). Every edit is one undo step on
// doc.fx (commands-fx commitFx).
import { tl, scenesOf, newId, selectedShots, selectedHull, durOf } from './state.svelte.js';
import { toggleMod, toggleModOver, modLabel, spurtHint, makeMod, MODS, DEFAULT_MS } from './mods.js';
import { baseTurns } from '../../lib/fx.js';
import { sceneRuns } from './shots.js';
import { sceneAtPlayhead } from './scenes.js';
import { FX_KINDS, REFINE_KINDS, REFINE_WHY, isPointFx } from '../../lib/fx.js';
import { commitFx, addModifier } from './commands-fx.js';
import { playheadFrameStart } from '../../lib/lane.js';

// structure at the playhead lands on the start of the frame on screen, wherever the playhead rests (paw-ef73.14)
const now = (app) => playheadFrameStart(app.player);
const sec = (ms) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, '0')}`;
const fxOf = (app) => app.doc.fx || [];
/** The in / out keys of the kinds that have one. */
export const MARK_KEYS = { orgasm: 'Shift+O', knotting: 'Shift+K' };
/** The toggle keys (over the scenes or the range). */
const TOGGLE_KEYS = { orgasm: 'Alt+Shift+O', knotting: 'Alt+Shift+N' };

/** The spans the scene controls act on (paw-8b4h): args {t0, t1}; else an I / O range the owner set (not the one a
 *  selection put there); else every scene with a selected shot, else the scene at the playhead (one span per scene). */
function targetSpans(app, args) {
  if (args.t1 > args.t0) return [{ t0: args.t0, t1: args.t1 }];
  const l = scenesOf(app), sel = selectedShots(l), h = selectedHull(l), r = app.doc.range, dur = durOf(app);
  const near = (a, b) => Math.abs(a - b) <= 1;
  if (r?.t1 > r?.t0 && !(h && near(r.t0, h[0]) && near(r.t1, Math.min(h[1], dur)))) return [{ t0: r.t0, t1: r.t1 }];
  const ks = sel.length ? sel : [sceneAtPlayhead(l, app.player)].filter((k) => k >= 0);
  return sceneRuns(l).filter(([lo, hi]) => ks.some((k) => k >= lo && k <= hi)).map(([lo, hi]) => ({ t0: l[lo].start_ms, t1: Math.min(l[hi].end_ms, dur) }));
}
/** The chip / key / menu toggle for an event kind: over the scenes or the range (mods.js toggleModOver, one undo step,
 *  what it made or found selected); args {t, here} = the Modifiers row's own pick at that time (mods.js toggleMod: from t,
 *  or off where one is). No scenes: the range, else from the playhead (toggleMod). */
export function toggleModCmd(app, kind, args = {}) {
  const spans = args.here ? [] : targetSpans(app, args);
  if (spans.length) {
    const r = toggleModOver(fxOf(app), kind, spans, () => newId('fx'), app.doc.axes?.stroke);
    if (!r) return app.toast(`No room here to mark ${modLabel(kind)}`, 'quiet');
    if (r.list !== fxOf(app)) commitFx(app, `${r.did === 'add' ? 'Mark' : 'Remove'} ${modLabel(kind)}`, r.list);
    app.usage?.note?.(`mods:${r.did}`, { kind, how: 'scenes', n: spans.length });
    tl.modKind = kind;
    tl.fx = r.ids[0] ?? null; tl.fxSel = r.ids.length > 1 ? r.ids : [];
    const n = r.ids.length, what = modLabel(kind);
    return app.toast(r.did === 'remove' ? `${what} removed` : r.did === 'pick' ? `${what} already here: selected (drag its ends on the Modifiers row)` : `${what} over ${spans.length > 1 ? `${spans.length} scenes (${n} selected)` : `${sec(spans[0].t0)}–${sec(spans[0].t1)}`}: drag its ends on the Modifiers row`, 'quiet');
  }
  const range = args.here ? null : app.doc.range, t = args.t ?? now(app);
  const r = toggleMod(fxOf(app), kind, { t, range, id: newId('fx'), dur: app.durationMs || Infinity, turns: baseTurns(app.doc.axes?.stroke || [], t - 1000, t + DEFAULT_MS + 1000), base: app.doc.axes?.stroke });
  if (!r) return app.toast(`No room here to mark ${modLabel(kind)}`, 'quiet');
  commitFx(app, `${r.did === 'add' ? 'Mark' : 'Remove'} ${modLabel(kind)}`, r.list);
  app.usage?.note?.(r.did === 'add' ? 'mods:add' : 'mods:remove', { kind, how: range ? 'range' : 'playhead', ms: r.mod.t1 - r.mod.t0 });
  tl.modKind = kind;
  tl.fx = r.did === 'add' ? r.mod.id : null; tl.fxSel = [];
  app.toast(`${modLabel(kind)} ${sec(r.mod.t0)}–${sec(r.mod.t1)}${r.did === 'add' ? (range ? '' : ' (drag its ends on the Modifiers row)') : ' removed'}`, 'quiet');
}
/** Shift+O / Shift+K: the first press marks the kind in at the playhead, the second (same kind) out; Esc forgets it. */
export function markModCmd(app, kind) {
  const t = now(app), m = tl.modMark;
  if (!m || m.id !== kind) {
    tl.modMark = { id: kind, t };
    app.usage?.note?.('mods:markIn', { kind });
    return app.toast(`${modLabel(kind)} from ${sec(t)} · ${MARK_KEYS[kind] || 'the same key'} again at its end`, 'quiet');
  }
  tl.modMark = null;
  if (Math.abs(t - m.t) < 1) return app.toast(`${modLabel(kind)}: mark out at another frame`, 'quiet');
  const a = Math.min(m.t, t), b = Math.max(m.t, t), mod = makeMod(newId('fx'), kind, a, b, null, app.doc.axes?.stroke);
  commitFx(app, `Mark ${modLabel(kind)}`, [...fxOf(app), mod].sort((x, y) => x.t0 - y.t0));
  app.usage?.note?.('mods:add', { kind, how: 'mark', ms: b - a });
  tl.modKind = kind; tl.fx = mod.id; tl.fxSel = [];
  app.toast(`${modLabel(kind)} ${sec(a)}–${sec(b)}`, 'quiet');
}

/** After a spurt at t outside every orgasm: a quiet hint offering to grow / make the orgasm around it. */
export function spurtOrgasmHint(app, t) {
  const h = spurtHint(fxOf(app), scenesOf(app), t);
  if (!h) return;
  app.toast(h.grow ? 'Spurt outside the orgasm' : 'Spurt, no orgasm marked here', 'quiet', { timeout: 5000, action: { label: h.grow ? 'Grow the orgasm to it' : 'Mark orgasm around it', run: () => {
    const cur = fxOf(app), g = h.grow && cur.find((e) => e.id === h.grow.id);
    commitFx(app, h.grow ? 'Grow orgasm' : 'Mark orgasm', g ? cur.map((e) => (e === g ? { ...e, t0: h.t0, t1: h.t1 } : e)) : [...cur, makeMod(newId('fx'), 'orgasm', h.t0, h.t1)].sort((x, y) => x.t0 - y.t0));
    app.usage?.note?.('mods:add', { kind: 'orgasm', how: 'spurtHint' });
  } } });
}

const inRefine = (app) => app.mode === 'refine';
export default [
  ...MODS.filter((k) => MARK_KEYS[k]).map((k) => ({
    id: `timeline.mod.mark.${k}`, title: `Mark ${modLabel(k).toLowerCase()}: in at the playhead, again: out`, keys: [MARK_KEYS[k]], group: 'scenes',
    run: (app) => markModCmd(app, k) })),
  ...MODS.map((k) => ({
    id: `timeline.mod.toggle.${k}`, title: `${modLabel(k)} over the selection or scene (again: off)`, keys: TOGGLE_KEYS[k] ? [TOGGLE_KEYS[k]] : [], group: 'scenes',
    run: (app, args) => toggleModCmd(app, k, args) })),
  ...REFINE_KINDS.filter((k) => !isPointFx({ kind: k })).map((k) => ({
    id: `timeline.mod.add.${k}`, title: `${FX_KINDS[k].label} over the range or scene`, group: 'scenes',
    when: inRefine, why: () => REFINE_WHY, run: (app, args) => addModifier(app, k, args) })),
  { id: 'timeline.mod.cancelMark', title: 'Forget the pending modifier mark-in', keys: ['Escape'], group: 'scenes', hidden: true, when: () => !!tl.modMark, run: (app) => { tl.modMark = null; app.toast('Mark-in forgotten', 'quiet'); } },
];
