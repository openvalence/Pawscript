<!--
  ColorSwatch: pick a series colour by key (stored in documents; the colour follows the theme).
  <ColorSwatch bind:value label="Chapter colour" />            a swatch button that opens a grid popover
  <ColorSwatch bind:value label="Chapter colour" showName />   the button also names the colour
  <ColorSwatch bind:value label="Lane colour" inline />        the grid itself, no popover
  A palette entry { key, label, color? }: color (any CSS colour) instead of the theme's series colour for key.
  Grid keys: arrows move in 2D, Home/End within the row, Enter/Space pick, Escape closes and returns focus.
-->
<script>
  import { tooltip } from './tooltip.js';
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { SERIES, seriesVar } from './tokens.js';
  import { float, dismiss } from './position.js';
  import { gridMove, listen } from './fields.js';

  let {
    value = $bindable(), palette = SERIES, label = 'Colour', inline = false, showName = false, size = 'md',
    columns = 5, disabled = false, onchange, class: cls = '', ...rest
  } = $props();

  const current = $derived(palette.find((s) => s.key === value));
  let open = $state(false);
  let button = $state(), pop = $state();
  const cells = $state([]);
  let focusIdx = $state(0);

  $effect(() => {
    if (!open || !pop) return;
    const f = float(pop, button, { placement: 'bottom-start', offset: 4 });
    const off = dismiss(pop, (e) => close(e.type === 'keydown'), [button]);
    return () => { off(); f.destroy(); };
  });

  async function show() {
    if (disabled) return;
    focusIdx = Math.max(0, palette.findIndex((s) => s.key === value));
    open = true;
    await tick();
    cells[focusIdx]?.focus();
  }
  function close(refocus = true) {
    open = false;
    if (refocus) button?.focus();
  }
  function pick(s, e) {
    if (value !== s.key) { value = s.key; onchange?.(s.key, e); }
    if (!inline) close();
  }
  function gridKey(e) {
    if (e.key === 'Tab' && !inline) { close(false); return; }
    if (e.key === 'Escape' && !inline) { e.preventDefault(); e.stopPropagation(); close(); return; }
    const to = gridMove(focusIdx, e.key, columns, palette.length);
    if (to === null) return;
    e.preventDefault();
    focusIdx = to;
    cells[to]?.focus();
  }
  function buttonKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(); }
  }
</script>

{#snippet grid()}
  <div class="kit-color-swatch-grid" role="radiogroup" aria-label={label} style:--cols={columns} {@attach listen('keydown', gridKey)}>
    {#each palette as s, i (s.key)}
      <button
        bind:this={cells[i]}
        type="button"
        class="kit-color-swatch-cell"
        role="radio"
        aria-checked={s.key === value}
        aria-label={s.label}
        {@attach tooltip(s.label)}
        tabindex={i === focusIdx ? 0 : -1}
        {disabled}
        style:--sw={s.color ?? seriesVar(s.key)}
        onfocus={() => (focusIdx = i)}
        onclick={(e) => pick(s, e)}
      ></button>
    {/each}
  </div>
{/snippet}

{#if inline}
  <div class="k-color-swatch kit-color-swatch-inline {cls}" data-size={size} class:kit-color-swatch-disabled={disabled} {...rest}>{@render grid()}</div>
{:else}
  <div class="k-color-swatch {cls}" data-size={size} class:kit-color-swatch-disabled={disabled}>
    <button
      bind:this={button}
      type="button"
      class="kit-color-swatch-trigger"
      class:kit-color-swatch-named={showName}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={showName ? undefined : `${label}: ${current?.label ?? 'none'}`}
      {disabled}
      {...rest}
      onclick={() => (open ? close() : show())}
      onkeydown={buttonKey}
    >
      <span class="kit-color-swatch-chip" class:kit-color-swatch-empty={!current} style:--sw={current ? (current.color ?? seriesVar(current.key)) : undefined}></span>
      {#if showName}
        <span class="kit-color-swatch-name">{current?.label ?? 'None'}</span>
        <Icon name="chevron-down" size={size === 'sm' ? 12 : 14} class="kit-color-swatch-chev" />
      {/if}
    </button>
    {#if open}
      <div bind:this={pop} class="k-pop kit-color-swatch-pop" role="dialog" aria-label={label}>{@render grid()}</div>
    {/if}
  </div>
{/if}

<style>
  .k-color-swatch {
    --cell: var(--ctl-h-sm);
    --chip: calc(var(--ctl-h) - 12px);
    display: inline-flex; vertical-align: middle; min-width: 0; max-width: 100%;
  }
  .k-color-swatch[data-size='sm'] { --chip: calc(var(--ctl-h-sm) - 10px); }
  .k-color-swatch[data-size='lg'] { --chip: calc(var(--ctl-h-lg) - 14px); }
  .kit-color-swatch-trigger {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--space-3);
    width: var(--ctl-h); height: var(--ctl-h); min-width: 0; max-width: 100%; padding: 0;
    background: var(--bg-sunken); border: var(--bw) solid var(--line-ctl); border-radius: var(--radius);
    box-shadow: var(--recess); color: var(--tx-val); font: inherit; font-size: var(--fs-ui); cursor: pointer;
    transition: border-color var(--t-quick) var(--ease-out), color var(--t-quick) var(--ease-out);
  }
  [data-size='sm'] .kit-color-swatch-trigger { width: var(--ctl-h-sm); height: var(--ctl-h-sm); font-size: var(--fs-2); }
  [data-size='lg'] .kit-color-swatch-trigger { width: var(--ctl-h-lg); height: var(--ctl-h-lg); }
  .kit-color-swatch-trigger.kit-color-swatch-named { width: auto; justify-content: flex-start; padding: 0 var(--space-3) 0 var(--pad-x); }
  .kit-color-swatch-trigger:hover { border-color: var(--line-ctl-hover); }
  .kit-color-swatch-trigger:active, .kit-color-swatch-trigger[aria-expanded='true'] { border-color: var(--highlight); }
  .kit-color-swatch-trigger:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); }
  .kit-color-swatch-trigger:disabled { cursor: not-allowed; }
  .kit-color-swatch-chip {
    flex: none; width: var(--chip); height: var(--chip); border-radius: var(--radius);
    background: var(--sw); box-shadow: inset 0 0 0 1px rgba(var(--shade-rgb), .25);
  }
  .kit-color-swatch-chip.kit-color-swatch-empty { background: none; border: var(--bw) dashed var(--line-ctl); box-shadow: none; }
  .kit-color-swatch-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  .kit-color-swatch-trigger :global(.kit-color-swatch-chev) { flex: none; color: var(--tx-mut); }
  .kit-color-swatch-disabled { opacity: .45; }
  .kit-color-swatch-disabled .kit-color-swatch-trigger:hover { border-color: var(--line-ctl); }

  .kit-color-swatch-pop { min-width: 0; padding: var(--space-3); }
  .kit-color-swatch-grid { display: grid; grid-template-columns: repeat(var(--cols), var(--cell)); gap: var(--space-2); }
  .kit-color-swatch-cell {
    width: var(--cell); height: var(--cell); padding: 0; cursor: pointer;
    background: var(--sw); border: 0; border-radius: var(--radius);
    box-shadow: inset 0 0 0 1px rgba(var(--shade-rgb), .25);
    transition: box-shadow var(--t-quick) var(--ease-out);
  }
  .kit-color-swatch-cell:hover { box-shadow: inset 0 0 0 1px var(--tx-hi); }
  .kit-color-swatch-cell[aria-checked='true'] { box-shadow: inset 0 0 0 1px var(--tx-hi), inset 0 0 0 3px var(--bg-card); }
  .kit-color-swatch-inline .kit-color-swatch-cell[aria-checked='true'] { box-shadow: inset 0 0 0 1px var(--tx-hi), inset 0 0 0 3px var(--bg); }
  .kit-color-swatch-cell:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); }
  .kit-color-swatch-cell:disabled { cursor: not-allowed; }
</style>
