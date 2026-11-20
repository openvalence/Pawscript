<!--
  Section: a collapsible group with a caps head (an accordion = stacked Sections). The head row toggles on
  click, Enter or Space; `actions` sit at its right: with actionsVisible='hover' (default) they show on hover
  and whenever focus is anywhere inside the Section (always focusable); 'always' keeps them shown.
  The open body never widens the Section: wide content shrinks to the Section's width, and what cannot
  shrink is clipped at the inline edges, so a Section never pushes its dock wider.
  Closed, the body animates to zero height and is inert (out of the tab order and the a11y tree).
  <Section title="Timing" count={4} bind:open>
    {#snippet actions()}<IconButton size="sm" icon="refresh" label="Reset timing" />{/snippet}
    …rows…
  </Section>
-->
<script>
  import Icon from './Icon.svelte';
  import { nextId } from './focus.js';

  let { title = '', open = $bindable(true), count, level = 3, actions, actionsVisible = 'hover', onchange, children, class: cls = '', ...rest } = $props();

  const uid = nextId('k-section');

  function toggle(e) {
    open = !open;
    onchange?.(open, e);
  }
</script>

<section class="k-section {cls}" data-open={open || undefined} data-actions={actionsVisible} {...rest}>
  <div class="kit-section-head">
    <div class="kit-section-h" role="heading" aria-level={level}>
      <button type="button" class="kit-section-trigger" aria-expanded={open} aria-controls="{uid}-b" onclick={toggle}>
        <Icon name="chevron-right" size={14} class="kit-section-chev" />
        <span class="kit-section-title">{title}</span>
        {#if count != null && count !== ''}<span class="kit-section-count k-num">{count}</span>{/if}
      </button>
    </div>
    {#if actions}<div class="kit-section-actions">{@render actions()}</div>{/if}
  </div>
  <div class="kit-section-body" id="{uid}-b" inert={!open}>
    <div class="kit-section-clip"><div class="k-section-body">{@render children?.()}</div></div>
  </div>
</section>

<style>
  .k-section { min-width: 0; }
  /* stacked Sections (an accordion): one hairline between neighbours, none at the ends */
  :global(.k-section + .k-section) { border-top: 1px solid var(--line-1); }

  .kit-section-head { display: flex; align-items: center; gap: var(--space-2); height: var(--ctl-h); padding-right: var(--space-2); }
  .kit-section-h { flex: 1 1 auto; min-width: 0; align-self: stretch; display: flex; }
  .kit-section-trigger {
    flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: var(--space-3);
    margin: 0; padding: 0 var(--space-2) 0 var(--space-3);
    border: 0; border-radius: 0; background: none; text-align: left;
    color: var(--tx-val); line-height: 1;
    transition: color var(--t-quick) var(--ease-out);
  }
  .kit-section-trigger :global(.kit-section-chev) {
    color: var(--tx-mut);
    transition: transform var(--t-move) var(--ease-out), color var(--t-quick) var(--ease-out);
  }
  .kit-section-trigger[aria-expanded='true'] :global(.kit-section-chev) { transform: rotate(90deg); }
  .kit-section-trigger:hover { color: var(--tx-hi); }
  .kit-section-trigger:hover :global(.kit-section-chev) { color: var(--tx); }
  .kit-section-trigger:active { color: var(--highlight); }
  .kit-section-trigger:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: calc(var(--ring-w) * -1); }
  /* the head voice: Phosphor's .dash-title */
  .kit-section-title {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--font-head); font-size: var(--fs-1); font-weight: 500;
    text-transform: uppercase; letter-spacing: var(--caps-track);
  }
  .kit-section-count { flex: none; font-size: var(--fs-1); color: var(--tx-mut); }
  /* A Section inside a Section is a sub-group: sentence case in the label voice, so panel head, section and
     sub-group read as three levels. */
  :global(.k-section) .k-section .kit-section-title {
    font-size: var(--fs-2); text-transform: none; letter-spacing: .02em; color: var(--tx-mut);
  }
  :global(.k-section) .k-section .kit-section-trigger:hover .kit-section-title { color: var(--tx); }

  .kit-section-actions {
    flex: none; display: flex; align-items: center; gap: var(--space-1);
    opacity: 0; transition: opacity var(--t-quick) var(--ease-out);
  }
  .kit-section-head:hover .kit-section-actions, .k-section:focus-within > .kit-section-head .kit-section-actions, [data-actions='always'] > .kit-section-head .kit-section-actions { opacity: 1; }
  @media (hover: none) { .kit-section-actions { opacity: 1; } }

  /* 0fr -> 1fr: the body's own height, animated, nothing measured. Overflow comes back once it is open, so
     focus rings and shadows inside are not clipped at rest. */
  .kit-section-body { display: grid; grid-template-rows: 0fr; grid-template-columns: minmax(0, 1fr); min-width: 0; transition: grid-template-rows var(--t-move) var(--ease-out); }
  [data-open] > .kit-section-body { grid-template-rows: 1fr; }
  .kit-section-clip { min-height: 0; min-width: 0; overflow: clip; }
  [data-open] > .kit-section-body > .kit-section-clip { animation: k-unclip 0s var(--t-move) forwards; }
  /* open: block-axis overflow comes back (focus rings, shadows); the inline axis stays clipped so content
     that cannot shrink never widens the Section (the inset keeps focus rings of children inside). */
  @keyframes k-unclip { to { overflow-y: visible; } }
  .k-section-body { min-width: 0; padding: var(--space-1) var(--space-4) var(--space-5); }
</style>
