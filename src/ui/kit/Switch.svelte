<!--
  Switch: Phosphor's square switch, scaled with density. A native checkbox with role="switch" underneath.
  <Switch bind:checked label="Invert" onchange={(on) => …} />
-->
<script>
  let {
    checked = $bindable(false), label = '', disabled = false, size = 'md', onchange, children, class: cls = '', ...rest
  } = $props();
</script>

<label class="k-switch {cls}" data-size={size} class:kit-switch-disabled={disabled}>
  <input
    bind:checked
    type="checkbox"
    role="switch"
    class="kit-switch-input"
    {disabled}
    onchange={(e) => onchange?.(checked, e)}
    {...rest}
  />
  <span class="kit-switch-track" aria-hidden="true"><span class="kit-switch-thumb"></span></span>
  {#if children}<span class="kit-switch-text">{@render children()}</span>{:else if label}<span class="kit-switch-text">{label}</span>{/if}
</label>

<style>
  .k-switch {
    /* track h about 54% of the control height on the 2px grid: 14 (12 compact, 16 comfortable); w = 2h - 2 */
    --sw-h: round(calc(var(--ctl-h) * .54), 2px);
    position: relative; display: inline-flex; align-items: center; gap: var(--space-4);
    min-width: 0; max-width: 100%; min-height: var(--ctl-h); vertical-align: middle;
    color: var(--tx); font-size: var(--fs-ui); line-height: var(--lh-tight);
    cursor: pointer; user-select: none;
  }
  .k-switch[data-size='sm'] { --sw-h: round(calc(var(--ctl-h-sm) * .54), 2px); min-height: var(--ctl-h-sm); font-size: var(--fs-2); }
  .k-switch[data-size='lg'] { min-height: var(--ctl-h-lg); }
  .kit-switch-input { position: absolute; left: 0; top: 50%; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
  .kit-switch-track {
    flex: none; position: relative; width: calc(var(--sw-h) * 2 - 2px); height: var(--sw-h);
    background: var(--bg-sunken); border: var(--bw) solid var(--line-ctl); border-radius: var(--radius);
    transition: border-color var(--t-quick) var(--ease-out), box-shadow var(--t-quick) var(--ease-out);
  }
  .kit-switch-thumb {
    position: absolute; left: var(--space-1); top: var(--space-1);
    width: calc(var(--sw-h) - 6px); height: calc(var(--sw-h) - 6px);
    background: var(--tx-mut); border-radius: var(--radius);
    /* the slide is the switch's meaning; reduced motion zeroes it */
    transition: translate var(--t-quick) var(--ease-out), background-color var(--t-quick) var(--ease-out), box-shadow var(--t-quick) var(--ease-out);
  }
  .k-switch:hover .kit-switch-track { border-color: var(--line-ctl-hover); }
  .k-switch:active .kit-switch-track { border-color: var(--highlight); }
  .kit-switch-input:checked + .kit-switch-track { border-color: var(--reality); box-shadow: var(--glow-reality); }
  .kit-switch-input:checked + .kit-switch-track .kit-switch-thumb { translate: calc(var(--sw-h) - 2px) 0; background: var(--reality); }
  .k-switch:active .kit-switch-input:checked + .kit-switch-track { border-color: var(--highlight); }
  .kit-switch-input:focus-visible + .kit-switch-track { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); }
  .kit-switch-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kit-switch-disabled { opacity: .45; cursor: not-allowed; }
  .kit-switch-disabled:hover .kit-switch-track, .kit-switch-disabled:active .kit-switch-track { border-color: var(--line-ctl); }
  .kit-switch-disabled .kit-switch-input:checked + .kit-switch-track { border-color: var(--reality); }
</style>
