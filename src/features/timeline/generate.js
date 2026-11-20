// generate.js -- app-side plan actions: Generate (needed / all / selected), detach, lock, delete, inspector
// edits, the live preview (tl.preview + one ghost), import and export. Every document change is ONE
// app.transact; the pure parts are generate-logic.js.
import { gen } from './deps.js';
import { tl, listOf, newId, durOf } from './state.svelte.js';
import { importTimeline, toDirector, toSpans, setTurns } from './plan.js';
import { remove } from './intervals.js';
import { liveSel } from './plan-edit.js';
import { hashSeed } from '../../lib/gen/util.js';
import { cssVar } from '../../ui/kit/color.js';
import { onThemeChange } from '../../ui/kit/tokens.js';
import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live
import {
  PREVIEW_ID, activeMaxSpeed, planCtx, planSig, generatePlan, detachPlan, toggleLocked, sliceSegments, withGhost, mergeIntoGaps,
} from './generate-logic.js';

// The preview ghost is drawn in the kit's --intent ("pending, ghost") token, resolved for the canvas and
// re-resolved on a theme switch (themeTick is one of the preview loop's inputs).
let themeTick = 0;
if (typeof document !== 'undefined') onThemeChange(() => { themeTick++; });
const previewColor = () => cssVar('--intent') || cssVar('--accent');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// The active device profile's cap (the setting 'device.maxSpeed' this used to read is written by nothing).
export const maxSpeedOf = activeMaxSpeed;
// The tracker turns also feed plan.js staleness (follow segments go stale when the turns they used change).
export const ctxOf = (app) => { const c = planCtx(app.doc, { maxSpeed: maxSpeedOf(app), plan: listOf(app, 'plan') }); setTurns(c.turnsFor); return c; };
export const selectedIds = (app) => liveSel(app.doc.plan ?? [], tl.segs);

// ---- last compile (issues for the panel) ----
// Plain observable: the preview loop and generate() run outside components.
const listeners = new Set();
export const last = { issues: [], ms: 0, at: 0, from: '' };
function publish(issues, ms, from) {
  Object.assign(last, { issues, ms, at: Date.now(), from });
  for (const f of listeners) f(last);
}
export function onCompile(f) { listeners.add(f); f(last); return () => listeners.delete(f); }

// ---- generate ----
/** Generate into the active axis. scope: 'needed' (new + stale) | 'all' | 'selected'. Locked never. */
export function generate(app, scope = 'needed', ids = null) {
  const plan = app.doc.plan ?? [], axis = app.doc.activeAxis;
  const sel = ids ?? selectedIds(app);
  const { ctx, key } = ctxOf(app);
  const reuse = cache.res && cache.sig === planSig(plan) && cache.ctxKey === key ? cache.res : null;
  const t = performance.now();
  const r = generatePlan(scriptOf(app, axis), plan, { scope, sel, ctx, gen, res: reuse });
  if (!r.targets.length) {
    app.toast(scope === 'selected' ? 'No unlocked segment selected' : scope === 'all' ? 'Nothing to generate (every segment is locked)' : 'Plan is up to date: nothing new or stale', 'quiet');
    return r;
  }
  const label = scope === 'all' ? 'Generate whole plan' : r.done.length === 1 ? 'Generate segment' : 'Generate plan';
  app.transact(label, () => {
    app.edit(label, axis, r.script);
    app.doc.plan = r.plan;
  });
  publish(r.res.issues, reuse ? cache.ms : performance.now() - t, 'generate');
  report(app, r, axis);
  return r;
}

function report(app, r, axis) {
  const errs = r.issues.filter((i) => i.level === 'error'), warns = r.issues.filter((i) => i.level !== 'error');
  const msg = `Generated ${plural(r.done.length, 'segment')} into ${axis}`;
  if (errs.length) app.toast(`${msg}; ${plural(errs.length, 'error')}: ${errs[0].msg}`, 'warn');
  else if (warns.length) app.toast(`${msg}; ${plural(warns.length, 'warning')}: ${warns[0].msg}`, 'warn');
  else app.toast(msg, 'ok');
}

/** Generate the ids that need it, then remove them from the plan (their points stay), as one undo step. */
export function detach(app, ids = selectedIds(app)) {
  if (!ids.length) return;
  const axis = app.doc.activeAxis;
  const r = detachPlan(scriptOf(app, axis), app.doc.plan ?? [], ids, { ctx: ctxOf(app).ctx, gen });
  app.transact(ids.length === 1 ? 'Detach segment' : 'Detach segments', () => {
    if (r.generated.length) app.edit('Detach', axis, r.script);
    app.doc.plan = r.plan;
  });
  tl.segs = tl.segs.filter((id) => !ids.includes(id));
  app.toast(`Detached ${plural(ids.length, 'segment')}${r.generated.length ? ` (generated ${r.generated.length} first)` : ''}; the points stay`, 'ok');
}

export function toggleLock(app, ids = selectedIds(app)) {
  if (!ids.length) return;
  const next = toggleLocked(app.doc.plan ?? [], ids);
  const locking = next.some((s) => ids.includes(s.id) && s.locked);
  app.transact(locking ? 'Lock segments' : 'Unlock segments', () => { app.doc.plan = next; });
}

export function deleteSegments(app, ids = selectedIds(app)) {
  if (!ids.length) return;
  app.transact(ids.length === 1 ? 'Delete segment' : 'Delete segments', () => { app.doc.plan = remove(app.doc.plan ?? [], ids); });
  tl.segs = tl.segs.filter((id) => !ids.includes(id));
}

/** One undoable plan edit: fn(plan) -> plan. opts.coalesce merges a slider drag into one entry. */
export function editPlan(app, label, fn, opts) {
  const plan = app.doc.plan ?? [], next = fn(plan);
  if (next === plan) return;
  app.transact(label, () => { app.doc.plan = next; }, opts);
}

// ---- live preview ----
// A 100 ms identity poll (not a component effect) so the preview follows every plan change -- lane drags
// (drafts), undo, imports -- whether or not the Plan panel is mounted. It compiles once the inputs held still
// for one tick (debounce), incrementally (recompileSegment reuses unchanged segments).
// ponytail: one interval per app, never stopped; a shell hook for "plan changed" would replace it.
export const previewOn = (app) => app.settings?.get?.('timeline.planPreview', true) !== false;
const cache = { sig: null, ctxKey: null, res: null, ms: 0 };
const loops = new WeakMap();

export function ensurePreview(app) {
  if (loops.has(app) || typeof window === 'undefined') return;
  const st = { seen: null, done: null, on: null };
  loops.set(app, st);
  const tick = () => {
    try { step(app, st); } catch (e) { console.error('[plan preview]', e); }
  };
  st.timer = setInterval(tick, 100);
  tick();
}

function step(app, st) {
  if (!previewOn(app)) {
    if (st.on !== false) { st.on = false; st.done = null; cache.sig = null; tl.preview = null; setGhost(app, null); }
    return;
  }
  st.on = true;
  const plan = listOf(app, 'plan'), { ctx, key } = ctxOf(app);
  const inputs = [plan, key, tl.segs, app.doc.activeAxis, themeTick];
  const same = (a, b) => a && b && a.every((x, i) => x === b[i]);
  if (same(inputs, st.done)) return;
  if (!same(inputs, st.seen)) { st.seen = inputs; if (st.done) return; }   // changed: wait one quiet tick (not on the first run)
  st.done = inputs;
  const sig = planSig(plan);
  if (sig !== cache.sig || key !== cache.ctxKey) {
    const t = performance.now();
    const res = cache.res && key === cache.ctxKey ? gen.recompileSegment(cache.res, plan, null, ctx) : gen.compilePlan(plan, ctx);
    Object.assign(cache, { sig, ctxKey: key, res, ms: performance.now() - t });
    tl.preview = { script: res.script, key: String(hashSeed(sig, key)) };
    publish(res.issues, cache.ms, 'preview');
  }
  // The point-lane ghost shows only the SELECTED segments: the blocks already draw the whole plan, and a
  // whole-plan ghost floods the lane at full zoom-out. (The lanes renderer LODs dense ghosts into a faint
  // envelope, so no density cut-off is needed here.)
  const sel = liveSel(plan, tl.segs);
  const pts = sel.length ? sliceSegments(cache.res, sel) : [];
  setGhost(app, pts.length ? { id: PREVIEW_ID, name: 'Plan preview', color: previewColor(), script: pts, visible: true, axis: app.doc.activeAxis, source: { kind: 'plan' } } : null);
}

function setGhost(app, ghost) {
  const cur = app.doc.ghosts ?? [], old = cur.find((g) => g.id === PREVIEW_ID);
  if (!ghost && !old) return;
  if (ghost && old && old.script === ghost.script && old.axis === ghost.axis && old.color === ghost.color) return;
  app.doc.ghosts = withGhost(cur, ghost);
}

export function setPreview(app, on) {
  app.settings.set('timeline.planPreview', !!on);
  ensurePreview(app);
}
export const togglePreview = (app) => setPreview(app, !previewOn(app));

// ---- import / export ----
const JSON_FILTER = [{ name: 'Timeline JSON', extensions: ['json'] }];
const stem = (app) => (app.doc.media?.path || app.doc.media?.name || 'plan').replace(/\.[^./\\]+$/, '');

/** Import a director timeline / sidecar spans / track events. mode 'replace' | 'merge' (into the gaps).
 *  -> {warnings, count, format} (throws on unreadable input). */
export function importPlan(app, input, mode = 'replace') {
  const r = importTimeline(input, { dur: durOf(app), newId: () => newId('seg') });
  const warnings = [...r.warnings];
  let next = r.plan, count = r.plan.length;
  if (mode === 'merge') {
    const m = mergeIntoGaps(app.doc.plan ?? [], r.plan, { newId: () => newId('seg') });
    next = m.plan; count = m.added;
    if (m.dropped) warnings.push(`${plural(m.dropped, 'segment')} fell on existing segments, dropped`);
    if (m.trimmed) warnings.push(`${plural(m.trimmed, 'segment')} trimmed to the gaps`);
  }
  app.transact(mode === 'merge' ? 'Import plan (merge)' : 'Import plan', () => { app.doc.plan = next; });
  tl.segs = [];
  app.toast(`Imported ${plural(count, 'segment')} (${r.format})${warnings.length ? `; ${plural(warnings.length, 'warning')}` : ''}`, warnings.length ? 'warn' : 'ok');
  return { warnings, count, format: r.format };
}

export async function importFile(app, mode = 'replace') {
  const path = await app.backend.openDialog({ title: 'Import plan timeline', filters: JSON_FILTER });
  if (!path || Array.isArray(path)) return null;
  return importPlan(app, await app.backend.readText(path), mode);
}

/** 'director' -> [{start_ms, end_ms, kind, intensity, recipe, params}], 'spans' -> {spans: [{start_ms, end_ms, state}]}. */
export function exportText(app, what = 'director') {
  const plan = app.doc.plan ?? [];
  return JSON.stringify(what === 'spans' ? { spans: toSpans(plan) } : toDirector(plan), null, 2);
}

export async function exportPlan(app, what = 'director', to = 'file') {
  const text = exportText(app, what);
  if (to === 'clipboard') {
    await navigator.clipboard.writeText(text);
    app.toast(`${what === 'spans' ? 'Spans' : 'Director timeline'} copied`, 'ok');
    return true;
  }
  const path = await app.backend.saveDialog({ title: what === 'spans' ? 'Export spans' : 'Export plan timeline', defaultPath: `${stem(app)}.${what === 'spans' ? 'spans' : 'plan'}.json`, filters: JSON_FILTER });
  if (!path) return false;
  await app.backend.writeText(path, text);
  app.toast(`Exported ${path.split(/[\\/]/).pop()}`, 'ok');
  return true;
}

// ---- inspector ----
/** Open the Plan panel (shell layout handle when there is one) and focus its inspector. */
export function inspect(app) {
  if (app.layout?.tab) app.layout.tab('right', 'timeline.plan');
  else app.togglePanel?.('timeline.plan');
  setTimeout(() => window.dispatchEvent(new CustomEvent('pawscript:plan-inspect')), 0);
}
