<!--
  EmptyState: what an empty panel says, centred in its box: icon, title, a short description, actions.
  <EmptyState icon="film" title="No video loaded" description="Open a video to start scripting.">
    {#snippet actions()}<Button variant="primary" icon="folder-open">Open video</Button>{/snippet}
  </EmptyState>
-->
<script>
  import Icon from './Icon.svelte';

  let { icon, title = '', description = '', actions, children, class: cls = '', ...rest } = $props();
</script>

<div class="k-empty-state {cls}" {...rest}>
  {#if icon}<Icon name={icon} size={32} class="k-empty-state-icon" />{/if}
  {#if title}<p class="kit-empty-state-title">{title}</p>{/if}
  {#if description}<p class="kit-empty-state-desc">{description}</p>{/if}
  {@render children?.()}
  {#if actions}<div class="kit-empty-state-actions">{@render actions()}</div>{/if}
</div>

<style>
  .k-empty-state {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: var(--space-3); min-width: 0; height: 100%; padding: var(--space-7) var(--space-6);
    text-align: center; color: var(--tx-mut);
  }
  .k-empty-state :global(.k-empty-state-icon) { margin-bottom: var(--space-3); }
  /* 32 px from a 16-unit glyph would double the stroke; hold it near the 16 px weight (2 px). */
  .k-empty-state :global(.k-empty-state-icon) { --icon-stroke: 1; }
  .kit-empty-state-title { margin: 0; font-size: var(--fs-5); font-weight: 500; line-height: var(--lh-tight); color: var(--tx-hi); }
  .kit-empty-state-desc { margin: 0; max-width: 48ch; font-size: var(--fs-ui); line-height: var(--lh); }
  .kit-empty-state-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--gap); margin-top: var(--space-4); }
</style>
