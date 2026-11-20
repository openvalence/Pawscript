<!--
  PanelHeader: a panel's head band on --bg-raised with a bottom hairline: caps title (Phosphor's ▸ marker
  when there is no icon or chevron), optional icon, `actions` at the right. Pass `collapsed` (bindable) to
  make the title a toggle with a chevron; `controls` = id of the body it hides (aria-controls).
  <PanelHeader title="Inspector" icon="settings">{#snippet actions()}<IconButton size="sm" …/>{/snippet}</PanelHeader>
  <PanelHeader title="History" bind:collapsed controls="history-body" />
-->
<script>
  import Icon from './Icon.svelte';

  let { title = '', icon, collapsed = $bindable(), controls, level = 2, actions, onchange, class: cls = '', ...rest } = $props();

  const collapsible = $derived(collapsed !== undefined);

  function toggle(e) {
    collapsed = !collapsed;
    onchange?.(collapsed, e);
  }
</script>

{#snippet name()}
  {#if collapsible}<Icon name="chevron-right" size={14} class="kit-panel-header-chev" />{/if}
  {#if icon}<Icon name={icon} size={14} class="kit-panel-header-ico" />{/if}
  {#if !icon && !collapsible}<span class="kit-panel-header-mark" aria-hidden="true">&#9656;</span>{/if}
  <span class="kit-panel-header-title">{title}</span>
{/snippet}

<header class="k-panel-header {cls}" {...rest}>
  <div class="kit-panel-header-h" role="heading" aria-level={level}>
    {#if collapsible}
      <button type="button" class="kit-panel-header-lead" aria-expanded={!collapsed} aria-controls={controls} onclick={toggle}>{@render name()}</button>
    {:else}
      <div class="kit-panel-header-lead">{@render name()}</div>
    {/if}
  </div>
  {#if actions}<div class="kit-panel-header-actions">{@render actions()}</div>{/if}
</header>

<style>
  .k-panel-header {
    display: flex; align-items: center; gap: var(--space-2); min-width: 0;
    height: var(--ctl-h); padding-right: var(--space-2);
    background: var(--bg-raised); box-shadow: inset 0 -1px var(--line-1);
  }
  .kit-panel-header-h { flex: 1 1 auto; min-width: 0; align-self: stretch; display: flex; }
  .kit-panel-header-lead {
    flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: var(--space-3);
    margin: 0; padding: 0 var(--space-2) 0 var(--space-3);
    border: 0; border-radius: 0; background: none; text-align: left;
    color: var(--tx-hi); line-height: 1;
  }
  .kit-panel-header-lead :global(.kit-panel-header-ico) { color: var(--tx-mut); }
  button.kit-panel-header-lead { transition: color var(--t-quick) var(--ease-out); }
  button.kit-panel-header-lead :global(.kit-panel-header-chev) {
    color: var(--tx-mut);
    transition: transform var(--t-move) var(--ease-out), color var(--t-quick) var(--ease-out);
  }
  button.kit-panel-header-lead[aria-expanded='true'] :global(.kit-panel-header-chev) { transform: rotate(90deg); }
  button.kit-panel-header-lead:hover { color: var(--tx-hi); }
  button.kit-panel-header-lead:hover :global(.kit-panel-header-chev) { color: var(--tx); }
  button.kit-panel-header-lead:active { color: var(--highlight); }
  button.kit-panel-header-lead:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: calc(var(--ring-w) * -1); }

  .kit-panel-header-title {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--font-head); font-size: var(--fs-1); font-weight: 500;
    text-transform: uppercase; letter-spacing: var(--caps-track);
  }
  /* Phosphor's ▸ marker, in the icon's slot so every variant's title starts at the same x */
  .kit-panel-header-mark { flex: none; width: 14px; text-align: center; font-size: var(--fs-2); color: var(--line-4); }

  .kit-panel-header-actions { flex: none; display: flex; align-items: center; gap: var(--space-1); }
</style>
