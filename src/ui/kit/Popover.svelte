<!--
  Popover: a non-modal dialog floating next to its trigger (Phosphor's ui-sheet popover form). Focus moves in
  on open; Escape, a press outside, or Tab out of it closes it; Escape (and any close while focus is inside)
  returns focus to the trigger. Content renders only while open.

  <Popover title="Loop settings">
    {#snippet trigger({ props })}<Button {...props} icon="loop">Loop</Button>{/snippet}
    …form…
  </Popover>
  <Popover bind:open anchor={el} label="Snap">…</Popover>   (controlled, anchored to any element)
-->
<script>
  import { float, dismiss } from './position.js';
  import { tabbables, nextId } from './focus.js';

  let {
    open = $bindable(false), anchor = null, placement = 'bottom-start', offset = 6, label = '', title = '',
    id = nextId('k-popover'), onclose, trigger, children, class: cls = '', ...rest
  } = $props();

  let el = $state(null);

  // The trigger snippet spreads these on its button; aria-controls also finds the anchor when none is given.
  const props = $derived({
    'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': id,
    onclick: () => (open ? close('toggle') : (open = true)),
  });
  const anchorEl = () => anchor ?? document.querySelector(`[aria-controls="${id}"]`);

  function close(reason) {
    if (!open) return;
    open = false;
    onclose?.(reason);
  }

  let shownAt = null; // the anchor while open

  // Before the content unmounts (it would take focus with it): focus inside goes back to the anchor.
  $effect.pre(() => {
    if (!open && shownAt && el?.contains(document.activeElement)) shownAt.focus({ preventScroll: true });
  });

  $effect(() => {
    if (!open || !el) return;
    const a = (shownAt = anchorEl());
    const f = float(el, a, { placement, offset });
    const off = dismiss(el, (e) => close(e.type === 'keydown' ? 'escape' : 'outside'), [a, inMenu]);
    (el.querySelector('[autofocus], [data-autofocus]') ?? tabbables(el)[0] ?? el).focus({ preventScroll: true });
    return () => {
      off();
      f.destroy();
      shownAt = null;
    };
  });

  // a kit menu opened from inside it (a picker's ▾ in the popover, paw-k8pe) is part of it: pressing or focusing its items keeps it
  const inMenu = (t) => t instanceof Element && !!t.closest('.k-menu');

  // Tab (or a click) to something outside closes it; a press outside is dismiss()'s.
  function onfocusout(e) {
    const t = e.relatedTarget;
    if (open && t instanceof Node && !el.contains(t) && !anchorEl()?.contains(t) && !inMenu(t)) close('blur');
  }
</script>

{@render trigger?.({ props })}
<div
  bind:this={el}
  {id}
  class="k-pop k-popover {cls}"
  popover="manual"
  role="dialog"
  tabindex="-1"
  aria-label={title ? undefined : label || undefined}
  aria-labelledby={title ? id + '-t' : undefined}
  {onfocusout}
  {...rest}
>
  {#if open}
    {#if title}<h2 class="kit-popover-title" id={id + '-t'}>{title}</h2>{/if}
    {@render children?.()}
  {/if}
</div>

<style>
  /* see-through like everything else that opens over the work (theme.css --glass) */
  .k-popover { padding: var(--space-5); min-width: 12rem; background: var(--glass); backdrop-filter: var(--glass-blur); }
  .kit-popover-title {
    margin: 0 0 var(--space-4);
    font: 500 var(--fs-4) / var(--lh-tight) var(--font-head);
    color: var(--tx-hi);
  }
</style>
