<!--
  Button: the kit's push button (Phosphor .og-btn). IconButton and ToggleButton are thin wrappers over it,
  so every button in the app shares one box model, one set of states and one height per size.
  <Button variant="primary" icon="export" onclick={save}>Export funscript</Button>
  <Button icon="add" tip="Add point" shortcut="A" aria-label="Add point" />   (icon-only = square)
  Layout: `full` = width 100% (its own row); `grow` = takes the free space of a flex row (flex: 1 1 0,
  shrinks below its label, which ellipsizes). Use these, not a host class: the kit's own flex wins.
-->
<script>
  import Icon from './Icon.svelte';
  import Spinner from './Spinner.svelte';
  import { tooltip } from './tooltip.js';

  let {
    variant = 'default',
    size = 'md',
    icon = '',
    iconRight = '',
    label = '',
    loading = false,
    disabled = false,
    type = 'button',
    tip = '',
    shortcut = '',
    full = false,
    grow = false,
    pressed = undefined,
    onclick,
    children,
    class: cls = '',
    ...rest
  } = $props();

  const isz = $derived(size === 'sm' ? 14 : 16);
  const text = $derived(!!children || !!label);
  // paw-z0ym: a disabled control bound to a command (app/cmd.js: data-command) stays hoverable, focusable and right-clickable
  // (its tooltip says why it is off; its right click offers the Quick menu / a shortcut): aria-disabled, the press ignored
  const soft = $derived(!!disabled && rest['data-command'] != null);

  function click(e) {
    // Busy buttons keep focus and their tooltip but do nothing (no double submit).
    if (loading || soft) { e.preventDefault(); return; }
    onclick?.(e);
  }
</script>

<button
  {type}
  class="k-button kit-button-v-{variant} kit-button-s-{size} {cls}"
  class:kit-button-square={!text}
  class:kit-button-full={full}
  class:kit-button-grow={grow}
  class:kit-button-busy={loading && !icon}
  disabled={disabled && !soft}
  aria-disabled={soft || undefined}
  aria-busy={loading || undefined}
  aria-pressed={pressed === undefined ? undefined : !!pressed}
  onclick={click}
  {...rest}
  {@attach tooltip(tip, shortcut)}
>
  {#if icon}
    {#if loading}<Spinner size={isz} label="" />{:else}<Icon name={icon} size={isz} />{/if}
  {/if}
  {#if text}<span class="k-button-label">{#if children}{@render children()}{:else}{label}{/if}</span>{/if}
  {#if iconRight}<Icon name={iconRight} size={isz} />{/if}
  {#if loading && !icon}<span class="kit-button-spin"><Spinner size={isz} label="" /></span>{/if}
</button>

<style>
  .k-button {
    --h: var(--ctl-h);
    --px: calc(var(--pad-x) + var(--space-1));
    position: relative;
    display: inline-flex; align-items: center; justify-content: center; gap: var(--space-3);
    flex: none; box-sizing: border-box;
    height: var(--h); min-width: var(--h); max-width: 100%;
    margin: 0; padding: 0 var(--px);
    border: var(--bw) solid var(--line-2); border-radius: var(--radius);
    background: transparent; color: var(--tx);
    font: 500 var(--fs-ui) / 1 var(--font);
    white-space: nowrap; vertical-align: middle;
    cursor: pointer; user-select: none; -webkit-user-select: none; touch-action: manipulation;
    transition: color var(--t-quick) var(--ease-out), background-color var(--t-quick) var(--ease-out),
      border-color var(--t-quick) var(--ease-out), box-shadow var(--t-quick) var(--ease-out),
      opacity var(--t-quick) var(--ease-out);
  }
  .kit-button-s-sm { --h: var(--ctl-h-sm); --px: var(--pad-x); font-size: var(--fs-2); }
  .kit-button-s-lg { --h: var(--ctl-h-lg); --px: calc(var(--pad-x) + var(--space-2)); }
  .kit-button-square { width: var(--h); padding: 0; }
  .kit-button-full { display: flex; width: 100%; flex: 1 1 100%; }
  .kit-button-grow { flex: 1 1 0; min-width: 0; }

  .k-button-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; line-height: var(--lh-tight); }
  .kit-button-busy > :not(.kit-button-spin) { visibility: hidden; }
  .kit-button-spin { position: absolute; inset: 0; display: grid; place-items: center; }

  /* default (Phosphor .og-btn) */
  .k-button:hover:not(:disabled):not([aria-disabled='true']) { border-color: var(--line-4); }
  .k-button:active:not(:disabled):not([aria-disabled='true']) { border-color: var(--highlight); color: var(--highlight); }

  .kit-button-v-primary { border-color: var(--reality); color: var(--accent-ink); background-color: rgba(var(--reality-rgb), .12); }
  .kit-button-v-primary:hover:not(:disabled):not([aria-disabled='true']) { border-color: var(--reality); box-shadow: var(--glow-reality); }

  .kit-button-v-danger { border-color: var(--bad-ink); color: var(--bad-ink); }
  .kit-button-v-danger:hover:not(:disabled):not([aria-disabled='true']) { border-color: var(--bad-ink); box-shadow: var(--glow-bad); }

  /* ghost: the toolbar button. The frame is kept transparent so it measures like the others. */
  .kit-button-v-ghost { border-color: transparent; }
  .kit-button-v-ghost:hover:not(:disabled):not([aria-disabled='true']) { border-color: transparent; background-color: var(--bg-hover); color: var(--tx-hi); }
  .kit-button-v-ghost:active:not(:disabled):not([aria-disabled='true']) { border-color: transparent; background-color: var(--bg-active); color: var(--highlight); }

  /* on (ToggleButton / IconButton pressed): reality text on a tint; framed variants get the reality frame */
  .k-button[aria-pressed='true'] { color: var(--accent-ink); background-color: rgba(var(--reality-rgb), .12); }
  .k-button[aria-pressed='true']:hover:not(:disabled):not([aria-disabled='true']) { color: var(--accent-ink); background-color: rgba(var(--reality-rgb), .18); }
  .kit-button-v-default[aria-pressed='true'], .kit-button-v-default[aria-pressed='true']:hover:not(:disabled):not([aria-disabled='true']) { border-color: var(--reality); }
  .k-button[aria-pressed='true']:active:not(:disabled):not([aria-disabled='true']) { color: var(--highlight); }

  .k-button:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); z-index: var(--z-raised); }
  .k-button:disabled, .k-button[aria-disabled='true'] { opacity: .45; cursor: not-allowed; }
  .k-button[aria-busy='true'] { cursor: progress; }
</style>
