<!--
  ToastHost: draws toast.svelte.js's `toasts`, bottom-right, newest at the bottom, at most MAX_TOASTS. Mount
  once near the app root (it lifts itself into the top layer). Hovering or focusing the stack pauses every
  countdown. Screen readers hear new toasts through two hidden live regions: polite, assertive for 'bad'.

  <ToastHost />
  <ToastHost inline items={[…]} />   a static, in-flow stack (previews, screenshots)
-->
<script>
  import { flip } from 'svelte/animate';
  import Icon from './Icon.svelte';
  import Button from './Button.svelte';
  import IconButton from './IconButton.svelte';
  import { tooltip } from './tooltip.js';
  import { toasts, dismissToast, dismissAll, pauseToasts, MAX_TOASTS } from './toast.svelte.js';

  let { items = null, inline = false, class: cls = '', ...rest } = $props();

  const ICON = { info: 'info', ok: 'success', warn: 'warning', bad: 'error', neutral: 'bell', accent: 'info' };
  const list = $derived((items ?? toasts).slice(-MAX_TOASTS));
  let el = $state(null);
  let hover = $state(false), focused = $state(false);

  $effect(() => { if (!inline && !el.matches(':popover-open')) el.showPopover(); });
  // An emptied stack cannot stay hovered (the toast under the pointer went away with it).
  $effect(() => { if (!list.length) hover = focused = false; });
  $effect(() => { if (!inline) pauseToasts(hover || focused); });

  const ms = (node, token) => parseFloat(getComputedStyle(node).getPropertyValue(token)) || 0;
  const move = (node, rects) => flip(node, rects, { duration: ms(node, '--t-move') });
  const leave = (node) => ({ duration: ms(node, '--t-quick'), css: (t) => `opacity: ${t}` });

  function run(t, a = t.action) {
    a.run?.();
    dismissToast(t.id);
  }
</script>

<div
  bind:this={el}
  class="k-toast-host {cls}"
  class:kit-toast-host-inline={inline}
  popover={inline ? undefined : 'manual'}
  role="region"
  aria-label="Notifications"
  onpointerenter={() => (hover = true)}
  onpointerleave={() => (hover = false)}
  onfocusin={() => (focused = true)}
  onfocusout={(e) => (focused = el.contains(e.relatedTarget))}
  {...rest}
>
  {#each list as t (t.id)}
    <div class="k-toast" class:kit-toast-host-more={t.actions?.length} data-kind={t.kind} animate:move out:leave>
      <span class="kit-toast-host-tone"><Icon name={ICON[t.kind] ?? 'info'} /></span>
      <p class="kit-toast-host-msg" {@attach tooltip(t.tip)}>{t.message}{#if t.count > 1}<span class="kit-toast-host-count k-num">×{t.count}</span>{/if}</p>
      <!-- several actions: a row of their own under the message (the message keeps the width) -->
      <span class="kit-toast-host-acts">
        {#if t.action}
          <Button variant="ghost" size="sm" onclick={() => run(t)}>{t.action.label}</Button>
        {/if}
        {#each t.actions || [] as a (a.label)}<Button variant="ghost" size="sm" onclick={() => run(t, a)}>{a.label}</Button>{/each}
      </span>
      <IconButton icon="close" label="Dismiss" size="sm" onclick={() => dismissToast(t.id)} />
    </div>
  {/each}
  {#if !inline && list.length > 1}
    <Button variant="ghost" size="sm" class="kit-toast-host-all" onclick={dismissAll}>Dismiss all</Button>
  {/if}
</div>
{#if !inline}
  <div class="k-sr" aria-live="polite">
    {#each toasts.filter((t) => t.kind !== 'bad') as t (t.id)}<p>{t.message}</p>{/each}
  </div>
  <div class="k-sr" aria-live="assertive">
    {#each toasts.filter((t) => t.kind === 'bad') as t (t.id)}<p>{t.message}</p>{/each}
  </div>
{/if}

<style>
  .k-toast-host {
    position: fixed;
    /* paw-ky2g: the app lifts it over the timeline when there is room (--toast-bottom) and cuts it to that room, oldest first */
    inset: auto var(--space-6) var(--toast-bottom, var(--space-6)) auto;
    max-height: var(--toast-room, none);
    justify-content: flex-end;
    width: min(360px, calc(100vw - 2 * var(--space-6)));
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    overflow: visible clip;
    pointer-events: none;
    z-index: var(--z-toast);
  }
  .k-toast-host:popover-open, .k-toast-host.kit-toast-host-inline { display: flex; flex-direction: column; gap: var(--space-3); }
  .k-toast-host.kit-toast-host-inline { position: static; }

  .k-toast {
    --tone: var(--line-4);
    flex: none;   /* a stack cut to its room (max-height) clips the oldest, never squeezes them */
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: calc(var(--ctl-h-sm) + 2 * var(--space-3) + 2px);
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
    color: var(--tx);
    background: var(--bg-card);
    border: var(--bw) solid var(--line-2);
    border-left: 3px solid var(--tone);
    border-radius: var(--radius);
    box-shadow: var(--shadow-2);
    font: var(--fs-3) / var(--lh-tight) var(--font);
    transition: opacity var(--t-move) var(--ease-out), translate var(--t-move) var(--ease-out);
  }
  @starting-style { .k-toast { opacity: 0; translate: 0 4px; } }
  .k-toast[data-kind='info'] { --tone: var(--info-ink); }
  .k-toast[data-kind='accent'] { --tone: var(--accent-ink); }
  .k-toast[data-kind='ok'] { --tone: var(--ok-ink); }
  .k-toast[data-kind='warn'] { --tone: var(--warn-ink); }
  .k-toast[data-kind='bad'] { --tone: var(--bad-ink); }
  .kit-toast-host-tone { flex: none; display: flex; color: var(--tone); }
  .k-toast[data-kind='neutral'] .kit-toast-host-tone { color: var(--tx-mut); }
  .kit-toast-host-msg { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; }
  .kit-toast-host-acts { display: contents; }
  .k-toast.kit-toast-host-more { flex-wrap: wrap; }
  .kit-toast-host-more .kit-toast-host-acts { order: 3; flex-basis: 100%; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
  .kit-toast-host-count { margin-left: var(--space-2); color: var(--tx-mut); white-space: nowrap; }
  .k-toast-host :global(.kit-toast-host-all) { flex: none; align-self: flex-end; pointer-events: auto; background: var(--bg-card); box-shadow: var(--shadow-1); }
</style>
