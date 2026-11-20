<!--
  Chip: a compact tag or filter. Clickable when `selected` is given (toggles it, aria-pressed) or `onclick` is;
  a static tag otherwise. `color` (a series key) draws a swatch dot; `removable` adds a × that calls onremove.
  Keyboard: Enter/Space toggle; Delete/Backspace remove (the × itself is not a tab stop on a clickable chip).
  <Chip color="sky" bind:selected={showStroke}>Stroke</Chip>
  <Chip removable label="beat" onremove={() => drop('beat')}>beat</Chip>
-->
<script>
  import Icon from './Icon.svelte';
  import { seriesVar } from './tokens.js';

  let {
    selected = $bindable(),
    icon = '',
    color = '',
    removable = false,
    disabled = false,
    label = '',
    onclick,
    onchange,
    onremove,
    children,
    class: cls = '',
    ...rest
  } = $props();

  const clickable = $derived(selected !== undefined || !!onclick);

  function click(e) {
    if (selected !== undefined) { selected = !selected; onchange?.(selected, e); }
    onclick?.(e);
  }
  function key(e) {
    if (removable && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); onremove?.(e); }
  }
</script>

{#snippet body()}
  {#if color}<span class="kit-chip-dot" style:background={seriesVar(color)}></span>{/if}
  {#if icon}<Icon name={icon} size={14} />{/if}
  <span class="k-chip-label">{#if children}{@render children()}{:else}{label}{/if}</span>
{/snippet}

<span
  class="k-chip {cls}"
  class:kit-chip-clickable={clickable}
  class:kit-chip-selected={!!selected}
  class:kit-chip-removable={removable}
  class:kit-chip-disabled={disabled}
  {...rest}
>
  {#if clickable}
    <button
      type="button"
      class="kit-chip-main"
      {disabled}
      aria-pressed={selected === undefined ? undefined : !!selected}
      onclick={click}
      onkeydown={key}
    >{@render body()}</button>
  {:else}
    <span class="kit-chip-main">{@render body()}</span>
  {/if}
  {#if removable}
    <button
      type="button"
      class="kit-chip-x"
      tabindex={clickable ? -1 : 0}
      aria-label={label ? `Remove ${label}` : 'Remove'}
      {disabled}
      onclick={(e) => onremove?.(e)}
    ><Icon name="close" size={12} /></button>
  {/if}
</span>

<style>
  .k-chip {
    display: inline-flex; align-items: stretch; flex: none; box-sizing: border-box;
    height: var(--ctl-h-sm); max-width: 100%; vertical-align: middle;
    border: var(--bw) solid var(--line-2); border-radius: var(--radius);
    color: var(--tx); font: 500 var(--fs-2) / 1 var(--font);
    transition: color var(--t-quick) var(--ease-out), background-color var(--t-quick) var(--ease-out),
      border-color var(--t-quick) var(--ease-out), opacity var(--t-quick) var(--ease-out);
  }
  .kit-chip-main {
    display: inline-flex; align-items: center; gap: var(--space-3); min-width: 0;
    margin: 0; padding: 0 var(--space-4);
    border: 0; background: none; color: inherit; font: inherit; white-space: nowrap;
  }
  button.kit-chip-main { cursor: pointer; user-select: none; -webkit-user-select: none; }
  .kit-chip-removable .kit-chip-main { padding-right: var(--space-1); }
  .k-chip-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; line-height: var(--lh-tight); }
  .kit-chip-dot { flex: none; width: var(--space-3); height: var(--space-3); border-radius: 50%; }

  .kit-chip-x {
    display: grid; place-items: center; flex: none;
    width: calc(var(--ctl-h-sm) - 2 * var(--bw)); height: 100%; margin: 0; padding: 0;
    border: 0; border-radius: 0 var(--radius) var(--radius) 0; background: none; color: var(--tx-mut);
    cursor: pointer;
    transition: color var(--t-quick) var(--ease-out), background-color var(--t-quick) var(--ease-out);
  }
  .kit-chip-x:hover:not(:disabled) { color: var(--tx-hi); background-color: var(--bg-hover); }
  .kit-chip-x:active:not(:disabled) { color: var(--highlight); }
  .kit-chip-x:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: calc(-1 * var(--ring-w)); }

  .kit-chip-clickable:hover:not(.kit-chip-disabled) { border-color: var(--line-4); }
  .kit-chip-clickable:has(.kit-chip-main:active):not(.kit-chip-disabled) { border-color: var(--highlight); color: var(--highlight); }
  .kit-chip-selected { border-color: var(--reality); color: var(--accent-ink); background-color: rgba(var(--reality-rgb), .12); }
  .kit-chip-selected.kit-chip-clickable:hover:not(.kit-chip-disabled) { border-color: var(--reality); background-color: rgba(var(--reality-rgb), .18); }

  .k-chip:has(.kit-chip-main:focus-visible) { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); }
  .kit-chip-main:focus-visible { outline: none; }

  .kit-chip-disabled { opacity: .45; }
  .kit-chip-disabled, .kit-chip-disabled button { cursor: not-allowed; }
</style>
