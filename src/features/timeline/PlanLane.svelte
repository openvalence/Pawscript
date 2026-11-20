<script>
  // The plan lane: segments as blocks (plan-draw.js). Drag empty space = new segment of the armed kind, drag a
  // body = move (the whole selection), drag an edge = resize (interact.js intervalDrag: Shift no snap, Ctrl push,
  // Alt detach). Click selects (Ctrl toggles, Shift extends); click on empty space clears and seeks.
  // Double-click opens the inspector popover; a kind dragged from the Plan panel drops into the gap or onto a
  // segment (sets its kind). Keys: commands-plan.js.
  import { xToMs } from '../../lib/lane.js';
  import { fmtMs } from '../../lib/video.js';
  import { Popover, contextMenu } from '../../ui/kit/index.js';
  import CanvasLane from './CanvasLane.svelte';
  import PlanInspector from './PlanInspector.svelte';
  import { tl, listOf, cutsOf, newId, durOf, scenesOf } from './state.svelte.js';
  import { boundaryTimes } from './shots.js';
  import { hitInterval, intervalDrag, localX } from './interact.js';
  import { spansIn, combineIds } from './intervals.js';
  import { makeSegment, setKind, segState, intensityOf, recipeLabel } from './plan.js';
  import { kindOf, kindFromName, KINDS } from './kinds.js';
  import { X } from './draw.js';
  import { drawPlan, hasIntensity } from './plan-draw.js';
  import { clickSelect, fillSpan, segmentAt, liveSel, planMenu } from './plan-edit.js';
  import { ensurePreview } from './generate.js';
  import { trackerRuns, chooseRun, runsOver, runLabel } from './generate-logic.js';
  import { RECIPES } from '../../lib/gen/recipes.js';

  let { app } = $props();
  $effect.pre(() => ensurePreview(app));   // the compiled-motion ghost inside the blocks starts with the lane, not only with the Plan panel

  const KIND_MIME = 'application/x-pawscript-kind';
  const STATE_TEXT = { new: 'not generated', fresh: 'generated', stale: 'changed since generated', locked: 'locked' };

  let root = $state();
  let hover = $state.raw(null);        // {id, part} under the pointer
  let drop = $state.raw(null);         // {t0, t1} a kind drop would fill
  let moving = $state(false);
  let drag = null, press = null, anchor = null;

  const plan = $derived(listOf(app, 'plan'));
  const sel = $derived(new Set(tl.segs));
  // B / C (lib/selmodal.js): the segments the box touches (the row has no box drag of its own: a drag on empty space makes one)
  const select = { box: (t0, _y0, t1, _y1, mode) => { tl.segs = combineIds(liveSel(plan, tl.segs), spansIn(plan, t0, t1).map((s) => s.id), mode); } };
  const armed = $derived(kindFromName(tl.armedKind) ?? 'custom');
  const minLen = () => Math.round(app.player.frameMs) || 100;
  const cursor = $derived(moving ? (press?.hit?.part === 'body' ? 'grabbing' : press?.hit ? 'ew-resize' : 'crosshair')
    : hover?.part === 't0' || hover?.part === 't1' ? 'ew-resize' : hover ? 'default' : 'crosshair');

  // run chips: for segments that follow tracker turns, name the chosen run when several runs overlap or one is pinned
  const runChips = $derived.by(() => {
    const axis = app.doc.activeAxis ?? 'stroke', vis = trackerRuns(app.doc.ghosts, axis), all = trackerRuns(app.doc.ghosts, axis, true), m = new Map();
    if (!all.length) return m;
    for (const s of plan) {
      if (!['follow', 'knot'].includes(RECIPES[s.recipe]?.gen)) continue;
      const pinned = s.source && s.source !== 'auto';
      if (!pinned && runsOver(s, vis).length < 2) continue;
      const g = chooseRun(s, vis, all);
      m.set(s.id, g ? (pinned ? '⌖ ' : '') + runLabel(g) : 'no run');
    }
    return m;
  });

  function paint(ctx, w, h) {
    drawPlan(ctx, w, h, app.view, plan, {
      sel, hover, drop, preview: tl.preview?.script ?? null, cuts: boundaryTimes(scenesOf(app)).cuts, range: app.doc.range, runs: runChips,
      hint: `Plan: drag to add ${kindOf(armed).label} · drop a kind from the Plan panel · Shift+N adds one at the playhead`,
    });
  }

  function hoverText(t) {
    const s = segmentAt(plan, t);
    if (!s) return `Empty: drag to add ${kindOf(armed).label}`;
    const bits = [s.name || kindOf(s.kind).label, recipeLabel(s.recipe)];
    if (hasIntensity(s)) bits.push(Math.round(intensityOf(s) * 100) + '%');
    if (runChips.has(s.id)) bits.push('follows ' + runChips.get(s.id).replace('⌖ ', '') + (s.source && s.source !== 'auto' ? ' (pinned)' : ''));
    return `${bits.join(' · ')}\n${fmtMs(s.t0)}–${fmtMs(s.t1)} (${((s.t1 - s.t0) / 1000).toFixed(1)} s) · ${STATE_TEXT[segState(s)]}`;
  }

  function hitAt(e) {
    const el = e.currentTarget;
    return hitInterval(plan, app.view, el.clientWidth, localX(e, el));
  }

  function down(e) {
    if (e.button !== 0) return;
    const el = e.currentTarget, w = el.clientWidth, hit = hitAt(e), mods = { toggle: e.ctrlKey || e.metaKey, extend: e.shiftKey };
    let ids = [];
    if (hit) {
      const id = hit.item.id;
      if (!tl.segs.includes(id) && !mods.toggle && !mods.extend) { tl.segs = [id]; anchor = id; }
      ids = tl.segs.includes(id) ? liveSel(plan, tl.segs) : [id];
    }
    const nid = newId('seg'), kind = armed;
    const label = !hit ? 'Add segment' : hit.part !== 'body' ? 'Resize segment' : ids.length > 1 ? 'Move segments' : 'Move segment';
    drag = intervalDrag({ app, key: 'plan', el, e, hit, ids, w, minLen: minLen(), label, make: (t0, t1) => makeSegment({ id: nid, t0, t1, kind }) });
    press = { hit, nid, mods, t: xToMs(app.view, w, localX(e, el)) };
    el.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    if (drag) { drag.move(e); moving = true; return; }
    const h = hitAt(e), next = h ? { id: h.item.id, part: h.part } : null;
    if (next?.id !== hover?.id || next?.part !== hover?.part) hover = next;
  }
  function up(e) {
    if (!drag) return;
    const r = drag.end(e), { hit, nid, mods, t } = press;
    drag = null; moving = false;
    if (r === 'click') {
      if (hit) ({ sel: tl.segs, anchor } = clickSelect(plan, liveSel(plan, tl.segs), anchor, hit.item.id, mods.toggle ? 'toggle' : mods.extend ? 'extend' : 'replace'));
      else { tl.segs = []; app.player.seek(t, { exact: true }); }
    } else if (r === 'edit' && !hit && app.doc.plan.some((s) => s.id === nid)) { tl.segs = [nid]; anchor = nid; }
    press = null;
  }
  function cancel() { drag?.cancel(); drag = null; press = null; moving = false; }
  function dbl(e) {
    const h = hitAt(e);
    if (h) { tl.segs = [h.item.id]; anchor = h.item.id; openAt(h.item.id); }
  }

  // ---- inspector popover (kit Popover, anchored to a DOM stand-in for the block) ----
  let lw = $state(0), anchorEl = $state();
  /** Visible part of a segment's block in lane px ({x, w}), clamped to an edge when off screen. */
  function blockSpan(id) {
    const s = plan.find((x) => x.id === id);
    if (!s || !lw) return null;
    const x0 = Math.max(0, Math.min(lw - 1, X(app.view, lw, s.t0))), x1 = Math.max(x0 + 1, Math.min(lw, X(app.view, lw, s.t1)));
    return { x: x0, w: x1 - x0 };
  }
  function openAt(id) {
    const b = blockSpan(id), r = root?.getBoundingClientRect();
    tl.inspector = { id, x: b && r ? r.left + b.x : null, y: r ? r.bottom : null };
  }
  const insId = $derived(tl.inspector?.id ?? null);
  const insSpan = $derived(insId ? blockSpan(insId) : null);
  // the id the inspector body renders: never null while it is mounted (it outlives tl.inspector by one flush on close)
  let lastId = null;
  const shownId = $derived.by(() => (insId ? (lastId = insId) : lastId));
  // float() re-places on window scroll (capture) and anchor resizes; a pan only moves the anchor, so nudge it.
  $effect(() => { insSpan; anchorEl?.dispatchEvent(new Event('scroll')); });
  // Close when the segment goes away (deleted, undone).
  $effect(() => { const ins = tl.inspector; if (ins && !app.doc.plan.some((s) => s.id === ins.id)) tl.inspector = null; });
  const focusLane = () => root?.querySelector('[data-tl-lane]')?.focus({ preventScroll: true });

  // ---- context menu (kit), acting on the selection or the right-clicked segment ----
  const registry = { has: (id) => !!app.commands.get(id), enabled: (id) => app.commands.enabled(id), keys: (id) => app.commands.keysFor(id), run: (id, args) => app.commands.run(id, args) };
  function menuItems(e) {
    let t = null;
    if (e?.type === 'contextmenu' && (e.clientX || e.clientY)) {
      const r = root.getBoundingClientRect();
      t = xToMs(app.view, r.width, e.clientX - r.left);
      const s = segmentAt(plan, t);
      if (!s) return planMenu(registry, [], KINDS, { t, empty: true, armedLabel: kindOf(armed).label });
      if (!tl.segs.includes(s.id)) { tl.segs = [s.id]; anchor = s.id; }
    }
    const ids = new Set(liveSel(plan, tl.segs));
    return planMenu(registry, plan.filter((s) => ids.has(s.id)), KINDS, { t });
  }

  // ---- kind drops from the Plan panel ----
  const kindDrag = (e) => [...(e.dataTransfer?.types || [])].includes(KIND_MIME);
  function dropTarget(e) {
    const r = root.getBoundingClientRect(), t = xToMs(app.view, r.width, e.clientX - r.left);
    const s = segmentAt(plan, t);
    return s ? { seg: s, t0: s.t0, t1: s.t1 } : fillSpan(plan, t, { cuts: cutsOf(app), dur: durOf(app), minLen: minLen() });
  }
  function dragover(e) {
    if (!kindDrag(e)) return;
    const d = dropTarget(e);
    if (!d) { drop = null; e.dataTransfer.dropEffect = 'none'; return; }
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    if (d.t0 !== drop?.t0 || d.t1 !== drop?.t1) drop = { t0: d.t0, t1: d.t1 };
  }
  function ondrop(e) {
    if (!kindDrag(e)) return;
    e.preventDefault();
    const d = dropTarget(e), kind = kindFromName(e.dataTransfer.getData(KIND_MIME));
    drop = null;
    if (!d || !kind) return;
    focusLane();
    if (d.seg) { app.transact(`Kind: ${kindOf(kind).label}`, () => { app.doc.plan = setKind(app.doc.plan, [d.seg.id], kind); }); tl.segs = [d.seg.id]; return; }
    const s = makeSegment({ id: newId('seg'), t0: d.t0, t1: d.t1, kind });
    app.transact(`Add ${kindOf(kind).label}`, () => { app.doc.plan = [...app.doc.plan, s].sort((a, b) => a.t0 - b.t0); });
    tl.segs = [s.id]; anchor = s.id;
  }
  function dragleave(e) { if (!root.contains(e.relatedTarget)) drop = null; }
</script>

<div class="plan" bind:this={root} bind:clientWidth={lw} role="presentation" onpointerleave={() => (hover = null)} ondragover={dragover} {ondrop} ondragleave={dragleave}
  {@attach contextMenu(menuItems, { onclose: (r) => { if (r === 'escape') focusLane(); } })}>
  <CanvasLane {app} lane="plan" label="Plan" tag={plan.length ? 'Plan' : null} {paint} {cursor} {hoverText} {select}
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} ondblclick={dbl} />
  {#if insSpan}<div class="anchor" bind:this={anchorEl} style:left="{insSpan.x}px" style:width="{insSpan.w}px"></div>{/if}
</div>
{#if anchorEl && insId}
  <Popover open={true} anchor={anchorEl} label="Segment inspector" class="plan-pop" data-plan-pop
    onclose={() => { tl.inspector = null; focusLane(); }}>
    {#key shownId}<PlanInspector {app} id={shownId} />{/key}
  </Popover>
{/if}

<style>
  .plan { position: absolute; inset: 0; }
  .anchor { position: absolute; top: 0; bottom: 0; pointer-events: none; }
  :global(.k-popover.plan-pop) { padding: var(--space-4); min-width: 260px; max-width: min(420px, calc(100vw - 16px)); }
</style>
