// Side-effecting helpers that act on the `app` object (still plain JS, node-testable with a mock app).
import { resolveScope, runOp, diffScripts, coerceParams, batchEdit, movePoint, placeSnippet } from './logic.js';
import { cssVar } from '../../ui/kit/color.js';
import { scriptOf, axesOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live

export const PREVIEW = 'inspector-preview';
// --intent is the kit's "pending / ghost" colour, read per call so the theme in force is used (previews are
// recomputed on every edit). Node tests have no document: the dark theme's value stands in.
const ghostColor = () => (typeof document !== 'undefined' && cssVar('--intent')) || '#A78BFA';

/** Replace our preview ghosts in doc.ghosts (others untouched). Empty list removes them. */
export function setPreview(app, list) {
  const keep = (app.doc.ghosts || []).filter((g) => g.source !== PREVIEW);
  const color = list.length ? ghostColor() : '';
  const mine = list.map(({ axis, script }) => ({ id: `${PREVIEW}:${axis}`, name: 'Preview', color, script, visible: true, source: PREVIEW, axis }));
  if (!mine.length && keep.length === (app.doc.ghosts || []).length) return;
  app.doc.ghosts = [...keep, ...mine];
}

export const select = (app, axis, ats) => { app.doc.selection = { axis, ats: new Set(ats) }; };

/** Run `op` over a scope WITHOUT touching the document. -> {sc, results:[{axis, before, script, ats}], error?} */
export function computeScope(app, op, params, scopeId) {
  const d = app.doc, sc = resolveScope({ activeAxis: d.activeAxis, axes: axesOf(app), selection: d.selection, range: d.range, chapters: d.chapters }, scopeId, app.player?.timeMs ?? 0);
  if (sc.empty) return { sc, results: [] };
  const results = [];
  for (const t of sc.targets) {
    if (!t.ats.size) continue;
    const before = scriptOf(app, t.axis);
    const r = runOp(op, before, t.sel, params);
    if (r.error) return { sc, results: [], error: `${op.title}: ${r.error}` };
    results.push({ axis: t.axis, before, script: r.script, ats: r.ats });
  }
  return { sc, results };
}

const isChange = (r) => { const d = diffScripts(r.before, r.script); return d.added || d.removed || d.moved; };

/** Apply a transform as ONE undo entry. -> {ok, changed, message} */
export function applyTransform(app, op, rawParams, scopeId, label = op.title) {
  const params = coerceParams(op, rawParams);
  const { sc, results, error } = computeScope(app, op, params, scopeId);
  if (error) return { ok: false, changed: false, message: error };
  if (sc.empty) return { ok: false, changed: false, message: `${op.title}: ${sc.why}` };
  if (op.selection) { // result is a new selection, the script is untouched
    const r = results.find((x) => x.axis === app.doc.activeAxis) ?? results[0];
    select(app, r.axis, r.ats);
    return { ok: true, changed: false, message: `${r.ats.length} point${r.ats.length === 1 ? '' : 's'} selected` };
  }
  const changed = results.filter(isChange);
  if (!changed.length) return { ok: true, changed: false, message: `${op.title}: no change` };
  app.transact(label, () => {
    for (const r of changed) app.edit(label, r.axis, r.script);
    const mine = changed.find((r) => r.axis === app.doc.activeAxis);
    if (scopeId === 'selection' && mine && mine.ats.length) select(app, mine.axis, mine.ats);
  });
  return { ok: true, changed: true, message: `${label}${scopeId === 'all' ? ` (${changed.length} axes)` : ''}` };
}

/** Select every point of the active axis inside the doc range. */
export function selectRange(app) {
  const r = app.doc.range, ax = app.doc.activeAxis;
  if (!r) return 0;
  const ats = scriptOf(app, ax).filter((a) => a.at >= r.t0 && a.at <= r.t1).map((a) => a.at);
  select(app, ax, ats);
  return ats.length;
}

/**
 * Edit the selection (or points in the range) with a batch op. coalesce: scrubbing folds into one undo entry.
 * -> new ats or null.
 */
export function applyBatch(app, kind, v, { coalesce = false } = {}) {
  const ax = app.doc.activeAxis, script = scriptOf(app, ax);
  let ats = app.doc.selection?.axis === ax ? new Set(app.doc.selection.ats) : new Set();
  if (!ats.size && app.doc.range) ats = new Set(script.filter((a) => a.at >= app.doc.range.t0 && a.at <= app.doc.range.t1).map((a) => a.at));
  if (!ats.size) return null;
  const res = batchEdit(script, ats, kind, v);
  if (res.script === script) return null;
  const label = { set: 'Set position', offset: 'Offset position', scale: 'Scale position', shift: 'Shift time', tscale: 'Scale time' }[kind];
  app.transact(label, () => { app.edit(label, ax, res.script); select(app, ax, res.ats); }, { coalesce });
  return res.ats;
}

/** Edit one point's time and/or pos. */
export function applyPoint(app, at, change, { coalesce = false } = {}) {
  const ax = app.doc.activeAxis, script = scriptOf(app, ax);
  const res = movePoint(script, at, change);
  if (res.script === script) return at;
  const label = change.pos != null && change.at == null ? 'Set point position' : 'Move point';
  app.transact(label, () => { app.edit(label, ax, res.script); select(app, ax, res.ats); }, { coalesce });
  return res.ats[0];
}

/**
 * One undo entry per gesture (a scrub, a held arrow key, a typed value): every edit made through step() lands in
 * one history group opened on the first step; end() records it (call it from the control's oncommit and from the
 * end of the pointer / key gesture, since a scrub that returns to its start value fires no oncommit). Without
 * app.begin the edits fall back to coalescing.
 */
export function gesture(app) {
  let g = null;
  return {
    step(label, fn) { if (!g && app.begin) g = app.begin(label); return fn({ coalesce: !app.begin }); },
    end() { const open = g; g = null; open?.commit(); },
    get open() { return !!g; },
  };
}

/** Paste a snippet at the playhead (or `atMs`). -> count. */
export function pasteSnippet(app, snip, opts = {}, atMs = app.player?.timeMs ?? 0) {
  const ax = app.doc.activeAxis, script = scriptOf(app, ax);
  const fitMs = opts.fit && app.doc.range ? app.doc.range.t1 - app.doc.range.t0 : 0;
  const at = opts.fit && app.doc.range ? app.doc.range.t0 : Math.round(atMs);
  const res = placeSnippet(script, snip, at, { ...opts, fitMs });
  const label = `Paste "${snip.name}"`;
  app.transact(label, () => { app.edit(label, ax, res.script); select(app, ax, res.ats); });
  return res.ats.length;
}
