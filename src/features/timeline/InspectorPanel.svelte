<script>
  // The Inspector: the docked twin of the timeline's popovers. It shows the body for what was clicked last in the
  // timeline (inspect.js): a modifier's curve (FxEditor; Refine; elsewhere one line), plan segments (PlanInspector), the scene's quick controls
  // (SceneQuickBar), a loop or the selected tracker run as one line. The popovers stay.
  import { tl, listOf, scenesOf, durOf, selOf } from './state.svelte.js';
  import { liveSel } from './plan-edit.js';
  import { barSpan } from './quickbar.js';
  import { trackingOf } from './deps.js';
  import { inspectKind, touched, LANE_KIND } from './inspect.js';
  import { fmtMs } from '../../lib/video.js';
  import { loopsInWords } from './loop-actions.js';
  import FxEditor from './FxEditor.svelte';
  import { FX_KINDS } from '../../lib/fx.js';
  import PlanInspector from './PlanInspector.svelte';
  import SceneQuickBar from './SceneQuickBar.svelte';
  import RegionChips from './RegionChips.svelte';

  let { app } = $props();
  const byId = (list, id) => (id == null ? null : (list || []).find((x) => x.id === id) ?? null);
  const fx = $derived(byId(app.doc.fx, tl.fx));
  const segs = $derived(liveSel(listOf(app, 'plan'), tl.segs));
  const loop = $derived(byId(listOf(app, 'loops'), tl.loop));
  const loopText = $derived(loop ? loopsInWords(app).get(loop.id)?.long ?? '' : '');   // paw-ef73.7: what it is, where from
  const span = $derived(barSpan(scenesOf(app), selOf(), app.doc.range, durOf(app)));
  const run = $derived(trackingOf(app)?.selectedGhost ?? null);
  const act = $derived(byId(app.doc.acts, tl.act));   // paw-2lp7.5: the selected action region
  const sel = $derived({ fx: fx?.id, plan: segs, loop: loop?.id, act: act?.id, scene: span ? span.lo : -1, run: run?.id });

  // last touched: a selection that changed, or a press in a lane (re-clicking the selected scene changes nothing)
  let last = $state(null), prev = null;
  $effect(() => { const s = sel, t = touched(prev, s); prev = s; if (t.length) last = t[0]; });
  $effect(() => { const k = LANE_KIND[tl.focus]; if (k) last = k; });
  const kind = $derived(inspectKind(sel, last));
  const when = (a, b) => (b == null || b === a ? fmtMs(a) : `${fmtMs(a)} – ${fmtMs(b)}`);
</script>

<div class="insp">
  {#if kind === 'fx' && app.mode === 'refine'}
    {#key fx.id}<FxEditor {app} id={fx.id} />{/key}
  {:else if kind === 'fx'}
    <p class="line"><b>{FX_KINDS[fx.kind]?.label ?? fx.kind}{fx.muted ? ' (muted)' : ''}</b><span class="k-num">{when(fx.t0, fx.t1)}</span></p>
    <p class="hint">Drag its ends on the Modifiers row; its curve is shaped in Refine.</p>
  {:else if kind === 'plan'}
    <PlanInspector {app} id={segs[0]} />
  {:else if kind === 'loop'}
    <p class="line"><b>Loop</b><span class="k-num">{when(loop.t0, loop.t1)}</span></p>
    <p class="desc">{loopText || 'Double-click the loop on its shot (the Shots row) for its options.'}</p>
  {:else if kind === 'act'}
    {#key act.id}<RegionChips {app} id={act.id} />{/key}
  {:else if kind === 'scene'}
    <p class="line"><b>{span.text}</b><span class="k-num">{when(span.t0, span.t1)}</span></p>
    <SceneQuickBar {app} />
  {:else if kind === 'run'}
    <p class="line"><b>{run.name || 'Tracker run'}</b><span class="dim">selected run</span></p>
    <p class="hint">Its signal picker and baseline are in the band under the stroke lane (Track tab; the Tracker row in Refine / Review).</p>
  {:else}
    <p class="hint">Click a modifier, an action, a shot or a plan segment.</p>
  {/if}
</div>

<style>
  .insp { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) 0; min-width: 0; }
  /* FxEditor sizes itself for the popover (360 px): in the dock it takes the dock's width, its header wraps */
  .insp :global(.fxe) { width: auto; max-width: none; }
  .insp :global(.fxe .head) { flex-wrap: wrap; }
  .line { display: flex; align-items: baseline; gap: var(--space-3); margin: 0 var(--space-4); font-size: var(--fs-ui); min-width: 0; }
  .line b { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--tx-hi); }
  .line .k-num, .dim { font-size: var(--fs-1); color: var(--tx-mut); white-space: nowrap; }
  .hint { margin: 0 var(--space-4); font-size: var(--fs-2); color: var(--tx-mut); }
  .desc { margin: var(--space-2) var(--space-4) 0; font-size: var(--fs-2); color: var(--tx-val); line-height: 1.45; }
</style>
