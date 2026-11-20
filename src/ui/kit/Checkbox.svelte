<!--
  Checkbox: a native checkbox (keyboard, form and label behaviour for free) under a drawn 14 px box.
  <Checkbox bind:checked label="Snap to frames" />   <Checkbox checked indeterminate>Some lanes</Checkbox>
  `indeterminate` is bindable: a click clears it (native behaviour) and reports the new `checked`.
-->
<script>
  import Icon from './Icon.svelte';

  let {
    checked = $bindable(false), indeterminate = $bindable(false), label = '', disabled = false, invalid = false,
    size = 'md', onchange, children, class: cls = '', ...rest
  } = $props();

  let input;
  $effect(() => { input.indeterminate = indeterminate; });

  function change(e) {
    indeterminate = false;
    onchange?.(checked, e);
  }
</script>

<label class="k-checkbox {cls}" data-size={size} class:kit-checkbox-disabled={disabled}>
  <input
    bind:this={input}
    bind:checked
    type="checkbox"
    class="kit-checkbox-input"
    {disabled}
    aria-invalid={invalid || undefined}
    onchange={change}
    {...rest}
  />
  <span class="kit-checkbox-box" aria-hidden="true">
    <span class="kit-checkbox-dash"></span>
    <Icon name="check" size={size === 'sm' ? 10 : 12} class="kit-checkbox-tick" />
  </span>
  {#if children}<span class="kit-checkbox-text">{@render children()}</span>{:else if label}<span class="kit-checkbox-text">{label}</span>{/if}
</label>

<style>
  .k-checkbox {
    --box: 14px; /* ponytail: proposed token --box (checkbox/radio size) */
    position: relative; display: inline-flex; align-items: center; gap: var(--space-4);
    min-width: 0; max-width: 100%; min-height: var(--ctl-h); vertical-align: middle;
    color: var(--tx); font-size: var(--fs-ui); line-height: var(--lh-tight);
    cursor: pointer; user-select: none;
  }
  .k-checkbox[data-size='sm'] { --box: 12px; min-height: var(--ctl-h-sm); font-size: var(--fs-2); }
  .k-checkbox[data-size='lg'] { min-height: var(--ctl-h-lg); }
  .kit-checkbox-input { position: absolute; left: 0; top: 50%; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
  .kit-checkbox-box {
    flex: none; display: grid; place-items: center; width: var(--box); height: var(--box);
    background: var(--bg-sunken); border: var(--bw) solid var(--line-ctl); border-radius: var(--radius);
    color: var(--on-accent);
    transition: background-color var(--t-quick) var(--ease-out), border-color var(--t-quick) var(--ease-out);
  }
  .kit-checkbox-box > :global(*) { grid-area: 1 / 1; opacity: 0; transition: opacity var(--t-quick) var(--ease-out); }
  .kit-checkbox-dash { width: var(--space-4); height: var(--space-1); background: currentColor; }
  .kit-checkbox-box :global(.kit-checkbox-tick) { --icon-stroke: 2; }
  .k-checkbox:hover .kit-checkbox-box { border-color: var(--line-ctl-hover); }
  .k-checkbox:active .kit-checkbox-box { border-color: var(--highlight); }
  .kit-checkbox-input:is(:checked, :indeterminate) + .kit-checkbox-box { background: var(--accent); border-color: var(--accent); }
  .kit-checkbox-input:checked:not(:indeterminate) + .kit-checkbox-box > :global(.kit-checkbox-tick),
  .kit-checkbox-input:indeterminate + .kit-checkbox-box > .kit-checkbox-dash { opacity: 1; }
  .k-checkbox:active .kit-checkbox-input:is(:checked, :indeterminate) + .kit-checkbox-box { border-color: var(--highlight); }
  .kit-checkbox-input[aria-invalid] + .kit-checkbox-box { border-color: var(--bad-ink); }
  .kit-checkbox-input:focus-visible + .kit-checkbox-box { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); }
  .kit-checkbox-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kit-checkbox-disabled { opacity: .45; cursor: not-allowed; }
  .kit-checkbox-disabled:hover .kit-checkbox-box, .kit-checkbox-disabled:active .kit-checkbox-box { border-color: var(--line-ctl); }
  .kit-checkbox-disabled .kit-checkbox-input:is(:checked, :indeterminate) + .kit-checkbox-box { border-color: var(--accent); }
</style>
