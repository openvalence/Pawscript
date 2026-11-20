<!--
  Dialog: a native <dialog> opened with showModal() (top layer, page inert, ::backdrop = --scrim), Tab wrapped
  inside by focus.js trapFocus. Focus starts on [autofocus]/[data-autofocus], else the first field in the
  body, else the rightmost footer button (the primary action), and returns to the opener on close. Escape,
  the close button and a press on the backdrop close it when `dismissible`. Content mounts on first open.

  <Dialog bind:open title="Export funscript" size="md">
    …body…
    {#snippet footer({ close })}
      <Button onclick={() => close('cancel')}>Cancel</Button>
      <Button variant="primary" onclick={exportIt}>Export</Button>
    {/snippet}
  </Dialog>

  onclose(reason) fires on user closes only: 'escape' | 'backdrop' | 'close' (the × button) | whatever the
  footer passes to close(reason) | an action's value. Setting `open = false` yourself closes without it.
  `message` + `actions` render a plain text body and a button row without snippets (dialog.js confirm()).
  `modal={false}` shows it in place with show(): no backdrop, no trap, focus is not moved.
  A modal dialog is modal for the keyboard too: no keydown leaves it, so app shortcuts on window cannot edit what is
  behind it (fields inside still type: nothing is prevented). `passKeys` lets keys bubble on, for an overlay whose
  own keys are app commands (marked data-pass-keys: the app's key guard, commands.js, routes it as the rest of the app).
-->
<script>
  import Button from './Button.svelte';
  import IconButton from './IconButton.svelte';
  import { trapFocus, tabbables, nextId } from './focus.js';

  let {
    open = $bindable(false), title = '', size = 'md', dismissible = true, modal = true, passKeys = false,
    message = '', actions = null, onclose, children, footer, class: cls = '', ...rest
  } = $props();

  const id = nextId('k-dialog');
  let el = $state(null), body = $state(null), foot = $state(null);
  let mounted = $state(false);
  let downOutside = false;

  $effect.pre(() => { if (open) mounted = true; });

  function close(reason = 'close') {
    if (!open) return;
    open = false;
    onclose?.(reason);
  }

  const initial = () => el.querySelector('[autofocus], [data-autofocus]')
    ?? (body && tabbables(body)[0]) ?? (foot && tabbables(foot).at(-1)) ?? el;

  $effect(() => {
    if (!open || !el) return;
    const opener = document.activeElement;
    let release = null;
    // Non-modal: the attribute, not show(), which would run the dialog focusing steps and take focus.
    if (modal) { el.showModal(); release = trapFocus(el, initial()); } else el.open = true;
    return () => {
      if (el.open) el.close();
      if (!release) return;
      release();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  });

  // Handling Escape on keydown (not just `cancel`) keeps a non-dismissible dialog open on a repeated Escape.
  function onkeydown(e) {
    if (modal && !passKeys) e.stopPropagation();   // Tab still wraps: trapFocus listens on this element
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    if (dismissible) close('escape');
  }

  function oncancel(e) {
    e.preventDefault();
    if (dismissible) close('escape');
  }

  // A press that starts and ends outside the box is a backdrop click (a drag out of a field is not).
  const outside = (e) => {
    const r = el.getBoundingClientRect();
    return modal && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
  };
  function onpointerdown(e) {
    downOutside = e.target === el && outside(e);
    if (downOutside) e.preventDefault(); // keep focus where it was (a non-dismissible dialog would lose it)
  }
  function onclick(e) {
    if (downOutside && e.target === el && outside(e) && dismissible) close('backdrop');
    downOutside = false;
  }
</script>

<dialog
  bind:this={el}
  class="k-dialog k-brackets {cls}"
  data-size={size}
  data-pass-keys={passKeys ? '' : undefined}
  aria-labelledby={title ? id + '-t' : undefined}
  aria-describedby={message ? id + '-m' : undefined}
  {onkeydown}
  {oncancel}
  onclose={() => close('close')}
  {onpointerdown}
  {onclick}
  {...rest}
>
  {#if mounted}
    <header class="kit-dialog-head">
      <h2 class="kit-dialog-title" id={id + '-t'}>{title}</h2>
      {#if dismissible}
        <IconButton icon="close" label="Close" size="sm" shortcut="Escape" onclick={() => close('close')} />
      {/if}
    </header>
    <div class="k-dialog-body k-scroll" bind:this={body}>
      {#if message}<p class="kit-dialog-msg" id={id + '-m'}>{message}</p>{/if}
      {@render children?.()}
    </div>
    {#if footer || actions?.length}
      <footer class="kit-dialog-foot" bind:this={foot}>
        {#if footer}
          {@render footer({ close })}
        {:else}
          {#each actions as a (a.value ?? a.label)}
            <Button variant={a.variant ?? 'default'} data-autofocus={a.autofocus ? '' : undefined}
              onclick={() => close(a.value ?? a.label)}>{a.label}</Button>
          {/each}
        {/if}
      </footer>
    {/if}
  {/if}
</dialog>

<style>
  .k-dialog {
    --k-dialog-w: 480px;
    width: min(var(--k-dialog-w), calc(100vw - 2 * var(--space-6)));
    max-width: none;
    max-height: calc(100dvh - 2 * var(--space-6));
    margin: auto;
    padding: 0;
    overflow: hidden;
    color: var(--tx);
    background-color: var(--bg-card);
    border: var(--bw) solid var(--line-2);
    border-radius: var(--radius);
    box-shadow: var(--shadow-3);
    font: var(--fs-3) / var(--lh) var(--font);
    outline: none;
    /* opening and closing: opacity and a 4px rise (zero under reduced motion: the tokens are 0ms) */
    opacity: 0;
    translate: 0 4px;
    transition: opacity var(--t-move) var(--ease-out), translate var(--t-move) var(--ease-out),
      overlay var(--t-move) allow-discrete, display var(--t-move) allow-discrete;
  }
  .k-dialog[data-size='sm'] { --k-dialog-w: 400px; }
  .k-dialog[data-size='lg'] { --k-dialog-w: 720px; }
  .k-dialog[open] { display: flex; flex-direction: column; opacity: 1; translate: 0 0; }
  .k-dialog::backdrop {
    background: var(--scrim);
    opacity: 0;
    transition: opacity var(--t-move) var(--ease-out), overlay var(--t-move) allow-discrete, display var(--t-move) allow-discrete;
  }
  .k-dialog[open]::backdrop { opacity: 1; }
  @starting-style {
    .k-dialog[open] { opacity: 0; translate: 0 4px; }
    .k-dialog[open]::backdrop { opacity: 0; }
  }

  .kit-dialog-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: calc(var(--ctl-h-sm) + 2 * var(--space-5));
    padding: var(--space-5) var(--space-5) var(--space-5) var(--space-6);
  }
  .kit-dialog-title {
    flex: 1;
    min-width: 0;
    margin: 0;
    font: 500 var(--fs-5) / var(--lh-tight) var(--font-head);
    color: var(--tx-hi);
    overflow-wrap: anywhere;
  }
  .k-dialog-body {
    flex: 1 1 auto;
    min-height: 0;
    padding: 0 var(--space-6) var(--space-6);
  }
  .kit-dialog-msg { margin: 0; color: var(--tx); }
  .kit-dialog-foot {
    flex: none;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--gap);
    padding: var(--space-5) var(--space-6);
    border-top: var(--bw) solid var(--line-1);
  }
</style>
