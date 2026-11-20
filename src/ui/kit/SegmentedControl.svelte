<!--
  SegmentedControl: one framed row of mutually exclusive options (a radiogroup). Roving tabindex: Tab enters
  on the selected segment, arrows / Home / End move and select, disabled options are skipped.
  <SegmentedControl label="Stroke axis" options={[{ value: 'L0', label: 'Stroke' }, …]} bind:value={axis} />
  iconOnly: show only each option's icon; its label becomes aria-label and tooltip.
  An option may carry `tip`, `shortcut` (shown in its tooltip) and `command` (data-command: the app's right-click contract).
-->
<script>
  import Icon from './Icon.svelte';
  import { nextIndex } from './focus.js';
  import { tooltip } from './tooltip.js';

  let {
    options = [],
    value = $bindable(),
    size = 'md',
    label = '',
    disabled = false,
    full = false,
    iconOnly = false,
    onchange,
    class: cls = '',
    ...rest
  } = $props();

  const isz = $derived(size === 'sm' ? 14 : 16);
  const sel = $derived(options.findIndex((o) => o.value === value));
  const off = (i) => disabled || !!options[i]?.disabled;
  const stop = $derived(sel >= 0 && !off(sel) ? sel : options.findIndex((_, i) => !off(i)));

  function pick(i, e) {
    if (off(i) || options[i].value === value) return;
    value = options[i].value;
    onchange?.(value, e);
  }

  function key(e, i) {
    const n = nextIndex(options.length, i, e.key, { orientation: 'both', disabled: off });
    if (n == null) return;
    e.preventDefault();
    e.currentTarget.parentElement.children[n]?.focus();
    pick(n, e);
  }
</script>

<div
  class="k-segmented-control kit-segmented-control-s-{size} {cls}"
  class:kit-segmented-control-full={full}
  class:kit-segmented-control-disabled={disabled}
  class:kit-segmented-control-icons={iconOnly}
  role="radiogroup"
  aria-label={label || undefined}
  aria-disabled={disabled || undefined}
  {...rest}
>
  {#each options as o, i}
    <button
      type="button"
      role="radio"
      class="kit-segmented-control-seg"
      aria-checked={i === sel}
      aria-label={iconOnly ? o.label : undefined}
      tabindex={i === stop ? 0 : -1}
      disabled={off(i)}
      onclick={(e) => pick(i, e)}
      onkeydown={(e) => key(e, i)}
      data-command={o.command}
      {@attach tooltip(o.tip ?? (iconOnly ? o.label : ''), o.shortcut)}
    >
      {#if o.icon}<Icon name={o.icon} size={isz} />{/if}
      {#if !iconOnly}<span class="kit-segmented-control-label">{o.label}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .k-segmented-control {
    --h: var(--ctl-h);
    --px: calc(var(--pad-x) + var(--space-1));
    display: inline-flex; flex: 0 1 auto; box-sizing: border-box;   /* shrinks only below its labels' width when a host sets min-width: 0 */
    height: var(--h); max-width: 100%; vertical-align: middle;
    border: var(--bw) solid var(--line-2); border-radius: var(--radius);
    font: 500 var(--fs-ui) / 1 var(--font);
  }
  .kit-segmented-control-s-sm { --h: var(--ctl-h-sm); --px: var(--pad-x); font-size: var(--fs-2); }
  .kit-segmented-control-s-lg { --h: var(--ctl-h-lg); --px: calc(var(--pad-x) + var(--space-2)); }
  /* min-width 0: beside a label in a flex row it shrinks with it (its segments ellipsize) instead of overflowing the row */
  .kit-segmented-control-full { display: flex; width: 100%; min-width: 0; }

  .kit-segmented-control-seg {
    position: relative;
    display: inline-flex; align-items: center; justify-content: center; gap: var(--space-3);
    flex: 0 1 auto; min-width: 0; height: 100%;
    margin: 0; padding: 0 var(--px);
    border: 0; border-radius: 0; background: transparent; color: var(--tx-mut);
    font: inherit; white-space: nowrap;
    cursor: pointer; user-select: none; -webkit-user-select: none; touch-action: manipulation;
    transition: color var(--t-quick) var(--ease-out), background-color var(--t-quick) var(--ease-out);
  }
  .kit-segmented-control-seg + .kit-segmented-control-seg { border-left: var(--bw) solid var(--line-2); }
  .kit-segmented-control-full .kit-segmented-control-seg { flex: 1 1 auto; }
  .kit-segmented-control-icons .kit-segmented-control-seg { min-width: calc(var(--h) - 2 * var(--bw)); padding: 0; }
  .kit-segmented-control-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; line-height: var(--lh-tight); }

  .kit-segmented-control-seg:hover:not(:disabled) { background-color: var(--bg-hover); color: var(--tx); }
  .kit-segmented-control-seg:active:not(:disabled) { color: var(--highlight); }

  /* selected: reality text on a tint, framed in reality over the group frame and the hairlines */
  .kit-segmented-control-seg[aria-checked='true'] { color: var(--accent-ink); background-color: rgba(var(--reality-rgb), .12); z-index: var(--z-raised); }
  .kit-segmented-control-seg[aria-checked='true']:hover:not(:disabled) { color: var(--accent-ink); background-color: rgba(var(--reality-rgb), .18); }
  .kit-segmented-control-seg[aria-checked='true']::after {
    content: ''; position: absolute; inset: calc(-1 * var(--bw)); pointer-events: none;
    border: var(--bw) solid var(--reality); border-radius: var(--radius);
  }
  .kit-segmented-control-seg[aria-checked='true']:active:not(:disabled) { color: var(--highlight); }

  .kit-segmented-control-seg:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); z-index: calc(var(--z-raised) + 1); }
  .kit-segmented-control-seg:disabled { cursor: not-allowed; }
  .k-segmented-control:not(.kit-segmented-control-disabled) .kit-segmented-control-seg:disabled { opacity: .45; }
  .kit-segmented-control-disabled { opacity: .45; }
</style>
