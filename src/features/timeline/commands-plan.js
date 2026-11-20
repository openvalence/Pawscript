// commands-plan.js -- plan lane commands (gathered by commands.js).
// Key scoping: every key shared with the point editor or another feature (0-9, Shift+0-9, S, Shift+M, Ctrl+D,
// Delete, Backspace, X, Enter, A, Ctrl+A, Alt+A, Ctrl+I, G, Escape) fires ONLY while the plan lane has keyboard focus (tl.focus mirrors
// DOM focus, CanvasLane) and, where it acts on segments, one is selected; never merely because one is selected.
// P / Alt+PageUp / Alt+PageDown / Shift+N are plan-only keys: they work from anywhere and focus the lane.
// Every edit is ONE app.transact. Pure decisions live in plan-edit.js / intervals.js / plan.js.
import { tl, cutsOf, newId, durOf } from './state.svelte.js';
import { split, merge, remove, move } from './intervals.js';
import { makeSegment, setKind } from './plan.js';
import { KINDS, kindOf, kindFromName } from './kinds.js';
import { addSpan, segmentAt, stepSegment, duplicateSegments, liveSel } from './plan-edit.js';
import { grabRow } from './interact.js';
import { playheadFrameStart } from '../../lib/lane.js';
import { guard, whyOf } from '../../app/commands.js';
import { toggleCmd } from '../../lib/selmodal.js';

const planOf = (app) => app.doc.plan || [];
const sel = (app) => liveSel(planOf(app), tl.segs);
const focused = guard(() => tl.focus === 'plan', 'Click the Plan row first');
const hasSel = guard((app) => focused() && sel(app).length > 0, (app) => whyOf(app, focused) || 'Select a plan segment first');
const AT_SEG = 'Put the playhead on a plan segment', NO_PLAN = 'Add a plan segment first';
const minLen = (app) => Math.round(app.player.frameMs) || 100;
// structure at the playhead lands on the start of the frame on screen, wherever the playhead rests (paw-ef73.14)
const now = (app) => playheadFrameStart(app.player);
const commit = (app, label, next) => app.transact(label, () => { app.doc.plan = next; });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Give the plan lane keyboard focus (its element: tl.focus follows DOM focus). */
export const focusPlanLane = () => document.querySelector('[data-tl-lane="plan"]')?.focus({ preventScroll: true });

function select(app, s, seek = false) {
  focusPlanLane();
  tl.segs = s ? [s.id] : [];
  if (s && seek) app.player.seek(s.t0);
}

// args.t: split there instead of at the playhead (the context menu's "Split here")
function splitAtPlayhead(app, args) {
  const t = Math.round(args?.t ?? now(app)), s = segmentAt(planOf(app), t);
  const next = s && split(planOf(app), s.id, t, { minLen: minLen(app), newId: () => newId('seg') });
  if (!next) return app.toast('Too close to the segment edge to split', 'quiet');
  commit(app, 'Split segment', next);
}

function addAtPlayhead(app, args) {
  const kind = kindFromName(tl.armedKind) ?? 'custom';
  const span = addSpan(planOf(app), Math.round(args?.t ?? now(app)), { range: args?.t != null ? null : app.doc.range, cuts: cutsOf(app), dur: durOf(app), minLen: minLen(app) });
  if (!span) return app.toast(app.doc.range ? 'The range starts inside a segment' : 'The playhead is inside a segment', 'quiet');
  const s = makeSegment({ id: newId('seg'), ...span, kind });
  commit(app, `Add ${kindOf(kind).label}`, [...planOf(app), s].sort((a, b) => a.t0 - b.t0));
  select(app, s);
}

const G = { menu: 'Edit', group: 'Plan' };
const planAll = { id: 'timeline.plan.selectAll', title: 'Plan: select all segments', keys: ['Ctrl+A'], ...G, when: guard(() => focused(), 'Click the Plan row first'),
  run: (app) => { tl.segs = planOf(app).map((s) => s.id); } };
const planNone = { id: 'timeline.plan.selectNone', title: 'Plan: select no segment', keys: ['Alt+A'], ...G, hidden: true, when: () => focused(), run: () => { tl.segs = []; tl.inspector = null; } };
export default [
  { id: 'timeline.plan.split', title: 'Plan: split segment at playhead', keys: ['S'], ...G,
    when: guard((app) => focused() && (!!segmentAt(planOf(app), now(app)) || sel(app).length > 0), (app) => whyOf(app, focused) || AT_SEG), run: splitAtPlayhead },
  { id: 'timeline.plan.merge', title: 'Plan: merge selected segments', keys: ['Shift+M'], ...G,
    when: guard((app) => hasSel(app) && sel(app).length > 1, (app) => whyOf(app, hasSel) || 'Select two segments or more first'),
    run: (app) => { const r = merge(planOf(app), sel(app)); if (!r) return app.toast('Select neighboring segments to merge', 'quiet'); commit(app, 'Merge segments', r.list); tl.segs = r.ids; } },
  { id: 'timeline.plan.duplicate', title: 'Plan: duplicate selected segments', keys: ['Ctrl+D'], ...G, when: hasSel,
    run: (app) => {
      const r = duplicateSegments(planOf(app), sel(app), { dur: durOf(app), newId: () => newId('seg') });
      if (!r) return app.toast('No room after the selection to duplicate it', 'warn');
      commit(app, 'Duplicate segments', r.list); tl.segs = r.ids;
    } },
  { id: 'timeline.plan.delete', title: 'Plan: delete selected segments', keys: ['Delete', 'Backspace', 'X'], ...G, when: hasSel,
    run: (app) => { const n = sel(app).length; commit(app, n > 1 ? 'Delete segments' : 'Delete segment', remove(planOf(app), sel(app))); tl.segs = []; } },
  { id: 'timeline.plan.selectAtPlayhead', title: 'Plan: select segment under playhead', keys: ['P'], ...G,
    when: guard((app) => !!segmentAt(planOf(app), now(app)), AT_SEG), run: (app) => select(app, segmentAt(planOf(app), now(app))) },
  { id: 'timeline.plan.next', title: 'Plan: next segment', keys: ['Alt+PageDown'], ...G, when: guard((app) => planOf(app).length > 0, NO_PLAN),
    run: (app) => { const s = stepSegment(planOf(app), sel(app), now(app), 1); if (s) select(app, s, true); } },
  { id: 'timeline.plan.prev', title: 'Plan: previous segment', keys: ['Alt+PageUp'], ...G, when: guard((app) => planOf(app).length > 0, NO_PLAN),
    run: (app) => { const s = stepSegment(planOf(app), sel(app), now(app), -1); if (s) select(app, s, true); } },
  planAll, planNone,   // paw-qbvj: A toggles all / none (Blender 2.7x), Ctrl+A all, Alt+A none
  toggleCmd({ id: 'timeline.plan.selectToggle', title: 'Plan: select all / no segments (toggle)', ...G, hidden: true, when: guard(() => focused(), 'Click the Plan row first'),
    any: (app) => sel(app).length > 0, all: planAll, none: planNone, empty: (app) => (planOf(app).length ? '' : 'No plan segments to select') }),
  { id: 'timeline.plan.invertSelection', title: 'Plan: invert the segment selection', keys: ['Ctrl+I'], ...G, hidden: true, when: () => focused(),
    run: (app) => { const s = sel(app); tl.segs = planOf(app).map((x) => x.id).filter((id) => !s.includes(id)); } },
  { id: 'timeline.plan.grab', title: 'Plan: grab selected segments (mouse, or type ms)', keys: ['G'], ...G, when: hasSel,
    run: (app) => { const ids = sel(app); tl.inspector = null; grabRow(app, 'plan', 'plan', (base, dt) => move(base, ids, dt, { dur: durOf(app) }), (next) => commit(app, ids.length > 1 ? 'Move segments' : 'Move segment', next)); } },
  { id: 'timeline.plan.add', title: 'Plan: add segment at playhead', keys: ['Shift+N'], ...G, run: addAtPlayhead },
  { id: 'timeline.plan.edit', title: 'Plan: edit selected segment', keys: ['Enter'], ...G, when: hasSel,
    run: (app) => { tl.inspector = { id: sel(app)[0], x: null, y: null }; } },
  { id: 'timeline.plan.escape', title: 'Plan: close inspector / clear segment selection', keys: ['Escape'], ...G, hidden: true,
    when: hasSel,   // (inside the open inspector, the kit Popover takes Esc itself)
    run: () => { if (tl.inspector) tl.inspector = null; else tl.segs = []; } },
  // one per kind: set the selection's kind (digit keys, plan focused) and arm it for drawing
  ...KINDS.map((k) => ({ id: `timeline.plan.kind.${k.id}`, title: `Plan: set kind to ${k.label}`, keys: k.key ? [k.key, 'Shift+' + k.key] : [], when: hasSel,
    run: (app) => { const ids = sel(app); commit(app, `Kind: ${k.label}`, setKind(planOf(app), ids, k.id)); app.toast(`${plural(ids.length, 'segment')} → ${k.label}`, 'quiet'); } })),
  ...KINDS.map((k) => ({ id: `timeline.plan.arm.${k.id}`, title: `Plan: draw ${k.label} segments`,
    run: () => { tl.armedKind = k.id; } })),
];
