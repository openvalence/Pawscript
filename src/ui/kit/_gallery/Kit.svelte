<script>
  import { tooltip } from '../tooltip.js';
  // <Kit is="Button" variant="primary">Go</Kit> renders kit.Button when it exists, else a labelled placeholder
  // that still renders the snippets it was given (children, first, second, actions), so layouts hold.
  import { kit, failed } from './kit.svelte.js';
  let { is, ...rest } = $props();
  const C = $derived(kit[is]);
</script>

{#if C}
  <C {...rest} />
{:else}
  <div class="ph" class:bad={failed[is]} data-ph={is} {@attach tooltip(failed[is] || `${is} (not landed yet)`)}
    style:flex-direction={rest.direction === 'vertical' ? 'column' : null}>
    <span class="name">{is}{#if rest.label && typeof rest.label === 'string'}: {rest.label}{/if}</span>
    {#if rest.first}<div class="pane">{@render rest.first()}</div>{/if}
    {#if rest.second}<div class="pane">{@render rest.second()}</div>{/if}
    {#if rest.children}{@render rest.children(rest.value)}{/if}
    {#if rest.actions}{@render rest.actions()}{/if}
  </div>
{/if}

<style>
  .ph {
    display: flex; align-items: center; gap: var(--space-2); min-width: 0; min-height: var(--ctl-h);
    padding: 0 var(--space-2); border: var(--bw) dashed var(--line-3); border-radius: var(--radius);
    color: var(--tx-mut);
  }
  .ph.bad { border-color: var(--bad-ink); }
  .name { font-size: var(--fs-1); white-space: nowrap; }
  .pane { flex: 1; min-width: 0; min-height: 0; align-self: stretch; display: flex; flex-direction: column; }
</style>
