<script>
  // paw-g56v: a lane's controls without a header bar (the owner: "the bar between goes away"). Over the lane's canvas: a narrow
  // left gutter with the axis colour and its name written upwards (click = edit this lane, drag = reorder, double-click =
  // collapse, right-click = the lane menu) and, at the right edge, the lane's buttons (layers, solo, hide, lock, collapse): faint
  // until the lane is hovered, except one whose state is not the default (soloed, hidden, locked, ghosts off), which always
  // shows. The header's words (points, selection, ghosts) are drawn faintly behind the curve (LaneView / render.js drawInfo).
  // A collapsed lane is a thin strip (the same controls), so it can be opened again. Drops: LaneStack (the whole lane row).
  import Icon from '../../ui/kit/Icon.svelte';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import ToggleButton from '../../ui/kit/ToggleButton.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { seriesVar } from '../../ui/kit/tokens.js';
  import { fmtKeys } from '../../app/keymap.js';
  import { lanes } from './state.svelte.js';
  import { axisSeries } from './render.js';
  import { laneItems } from './commands.js';
  import { GUTTER_W } from './geom.js';
  import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live

  let { app, axis } = $props();
  const L = $derived(lanes(app));
  const focused = $derived(app.doc.activeAxis === axis);
  const count = $derived(scriptOf(app, axis).length ?? 0);
  const hasGhosts = $derived((app.doc.ghosts || []).some((g) => (g.axis ?? 'stroke') === axis));
  const collapsed = $derived(L.flag('collapsed', axis));
  const hidden = $derived(L.flag('hidden', axis));
  const locked = $derived(L.flag('locked', axis));
  const soloed = $derived(L.solo === axis);
  const ghostsOn = $derived(!L.flag('ghostsOff', axis));

  const run = (id) => app.commands.run(id, { axis });
  const keys = (id) => fmtKeys(app.commands.keysFor?.(id)?.[0] || '');
  const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const ghostNames = $derived(L.ghostsFor(axis).map((g) => g.name || g.id));   // paw-unuy: no longer written over the lane
  const tip = $derived(`${axis}: ${group(count)} point${count === 1 ? '' : 's'}${hidden ? ' · hidden' : ''}${locked ? ' · locked' : ''}${soloed ? ' · solo' : ''}`
    + `${ghostNames.length ? ` · ghosts: ${ghostNames.join(', ')}` : ''}. `
    + (collapsed ? 'Click to expand' : 'Click: edit this lane · double-click: collapse')
    + ` · drag: reorder (${keys('lanes.moveLaneUp')} / ${keys('lanes.moveLaneDown')}) · right-click: lane menu`);

  function menu(e) {
    e.preventDefault();
    app.setActiveAxis(axis);
    L.menu = { x: e.clientX, y: e.clientY, items: laneItems(app, axis) };
  }
  function dragstart(e) {
    e.dataTransfer.setData('text/x-pawscript-lane', axis);
    e.dataTransfer.effectAllowed = 'move';
    const row = e.currentTarget.closest('.lrow');
    if (row) e.dataTransfer.setDragImage(row, 8, 10);
  }
</script>

{#snippet buttons()}
  <div class="btns">
    {#if hasGhosts}
      <ToggleButton size="sm" class={ghostsOn ? '' : 'pin'} icon="layers" label="Ghosts on this lane" shortcut={keys('lanes.toggleLaneGhosts')} data-command="lanes.toggleLaneGhosts" bind:pressed={() => ghostsOn, () => run('lanes.toggleLaneGhosts')} />
    {/if}
    <ToggleButton size="sm" class={soloed ? 'solo pin' : 'solo'} aria-label="Solo" tip="Solo: only this lane is editable" shortcut={keys('lanes.toggleSolo')} data-command="lanes.toggleSolo" bind:pressed={() => soloed, () => run('lanes.toggleSolo')}>S</ToggleButton>
    <IconButton size="sm" class={hidden ? 'pin' : ''} icon={hidden ? 'eye-off' : 'eye'} label={hidden ? 'Show lane' : 'Hide lane'} shortcut={keys('lanes.toggleVisible')} data-command="lanes.toggleVisible" onclick={() => run('lanes.toggleVisible')} />
    <ToggleButton size="sm" class={locked ? 'pin' : ''} icon={locked ? 'lock' : 'unlock'} label="Lock lane" shortcut={keys('lanes.toggleLock')} data-command="lanes.toggleLock" bind:pressed={() => locked, () => run('lanes.toggleLock')} />
    {#if !collapsed}
      <IconButton size="sm" icon="chevron-up" label="Collapse {axis}" shortcut={keys('lanes.toggleCollapse')} aria-expanded="true" data-command="lanes.toggleCollapse" onclick={() => run('lanes.toggleCollapse')} />
    {/if}
  </div>
{/snippet}

{#if collapsed}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="strip" class:focused data-axis={axis} draggable="true" ondragstart={dragstart} oncontextmenu={menu} onclick={(e) => { if (!e.target.closest('button')) run('lanes.toggleCollapse'); }} {@attach tooltip(tip)}>
    <IconButton size="sm" icon="chevron-right" label="Expand {axis}" shortcut={keys('lanes.toggleCollapse')} aria-expanded="false" data-command="lanes.toggleCollapse" onclick={() => run('lanes.toggleCollapse')} />
    <span class="sw" style:background={seriesVar(axisSeries(axis))}></span>
    <span class="name">{axis}</span>
    <span class="k-hint">{count ? group(count) : 'empty'}</span>
    {@render buttons()}
  </div>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="gutter" class:focused data-axis={axis} style:width="{GUTTER_W}px" draggable="true" ondragstart={dragstart}
    onpointerdown={() => app.setActiveAxis(axis)} ondblclick={() => run('lanes.toggleCollapse')} oncontextmenu={menu} {@attach tooltip(tip)}>
    <span class="sw" style:background={seriesVar(axisSeries(axis))}></span>
    <span class="name">{axis}</span>
  </div>
  {@render buttons()}
{/if}

<style>
  .gutter {
    position: absolute; left: 0; top: 0; bottom: 0; z-index: 2; display: flex; flex-direction: column-reverse; align-items: center; gap: 3px;
    padding: 4px 0; overflow: hidden; cursor: grab; user-select: none; color: var(--tx-mut);
    background: color-mix(in srgb, var(--bg-raised) 85%, transparent); border-right: var(--bw) solid var(--line-1);
  }
  .gutter:hover { color: var(--tx); }
  .gutter.focused { color: var(--tx-hi); box-shadow: inset 2px 0 0 var(--focus); }
  /* upwards (the mock-up): vertical, turned so it reads bottom to top from the colour square; cut with an ellipsis */
  .gutter .name { writing-mode: vertical-rl; transform: rotate(180deg); flex: 0 1 auto; min-height: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-1); line-height: 1; }
  .sw { width: 8px; height: 8px; flex: none; border-radius: var(--radius); }
  .btns { position: absolute; top: 2px; right: 4px; z-index: 2; display: flex; align-items: center; gap: 2px; pointer-events: none; }
  .btns > :global(*) { pointer-events: auto; visibility: hidden; background: color-mix(in srgb, var(--bg-raised) 88%, transparent); }
  .btns > :global(.pin), :global(.lrow:hover) .btns > :global(*), .btns:has(:focus-visible) > :global(*) { visibility: visible; }
  .strip {
    position: relative; height: 100%; display: flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-2) 0 0;
    background: var(--bg-raised); color: var(--tx-mut); cursor: pointer; user-select: none; overflow: hidden; white-space: nowrap; font-size: var(--fs-1);
  }
  .strip.focused { box-shadow: inset 2px 0 0 var(--focus); }
  .strip .name { color: var(--tx); }
  .strip .btns { top: 0; }
</style>
