<!--
  StatusItem: one fact in a StatusBar. The tone colours only the icon (the -ink tokens); text stays quiet.
  With `onclick` it is a button (same metrics, a hover fill, Enter / Space). Numbers: wrap in .k-num.
  <StatusItem icon="warning" tone="warn" tip="Variable frame rate">VFR</StatusItem>
  <StatusItem icon="dot" tone="ok" onclick={openDevice}>Handy connected</StatusItem>
-->
<script>
  import Icon from './Icon.svelte';
  import { tooltip } from './tooltip.js';

  let { icon, tone = 'neutral', tip, onclick, children, class: cls = '', ...rest } = $props();
</script>

{#snippet body()}
  {#if icon}<Icon name={icon} size={12} class="kit-status-item-ico" />{/if}
  {#if children}<span class="kit-status-item-txt">{@render children()}</span>{/if}
{/snippet}

{#if onclick}
  <button type="button" class="k-status-item kit-status-item-t-{tone} {cls}" {onclick} {...rest} {@attach tooltip({ text: tip, placement: 'top' })}>{@render body()}</button>
{:else}
  <span class="k-status-item kit-status-item-t-{tone} {cls}" {...rest} {@attach tooltip({ text: tip, placement: 'top' })}>{@render body()}</span>
{/if}

<style>
  .k-status-item {
    --ink: currentColor;
    display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0;
    padding: 0 var(--space-4);
    color: var(--tx-mut); white-space: nowrap;
  }
  /* a readout (holds a .k-num) keeps its width; a message ellipsizes first */
  .k-status-item:has(:global(.k-num)) { flex-shrink: 0; }
  .k-status-item :global(.kit-status-item-ico) { color: var(--ink); }
  .kit-status-item-t-accent { --ink: var(--accent-ink); }
  .kit-status-item-t-info { --ink: var(--info-ink); }
  .kit-status-item-t-ok { --ink: var(--ok-ink); }
  .kit-status-item-t-warn { --ink: var(--warn-ink); }
  .kit-status-item-t-bad { --ink: var(--bad-ink); }
  .kit-status-item-txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .kit-status-item-txt :global(.k-num) { font-size: var(--fs-1); color: var(--tx-val); }

  button.k-status-item {
    margin: 0; border: 0; border-radius: 0; background-color: transparent; font: inherit; line-height: inherit;
    transition: color var(--t-quick) var(--ease-out), background-color var(--t-quick) var(--ease-out);
  }
  button.k-status-item:hover { color: var(--tx); background-color: var(--bg-hover); }
  button.k-status-item:active { color: var(--highlight); }
  button.k-status-item:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: calc(var(--ring-w) * -1); }
</style>
