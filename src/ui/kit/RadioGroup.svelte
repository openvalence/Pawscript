<!--
  RadioGroup: native radios (arrow keys move and select within the group, Tab enters at the checked one)
  drawn as 14 px circles, so a radio never reads as a checkbox.
  <RadioGroup label="Interpolation" options={[{ value: 'linear', label: 'Linear' }, …]} bind:value />
-->
<script>
  import { nextId } from './focus.js';

  let {
    options = [], value = $bindable(), label = '', orientation = 'vertical', disabled = false, size = 'md',
    name = nextId('k-radio'), onchange, class: cls = '', ...rest
  } = $props();
</script>

<div
  class="k-radio-group {cls}"
  role="radiogroup"
  aria-label={label || undefined}
  aria-orientation={orientation}
  aria-disabled={disabled || undefined}
  data-orient={orientation}
  data-size={size}
  {...rest}
>
  {#each options as o (o.value)}
    {@const off = disabled || o.disabled}
    <label class="kit-radio-group-opt" class:kit-radio-group-off={off}>
      <input
        type="radio"
        class="kit-radio-group-input"
        {name}
        value={o.value}
        checked={value === o.value}
        disabled={off}
        onchange={(e) => { value = o.value; onchange?.(o.value, e); }}
      />
      <span class="kit-radio-group-dot" aria-hidden="true"></span>
      <span class="kit-radio-group-text">{o.label}</span>
      {#if o.hint}<span class="kit-radio-group-hint">{o.hint}</span>{/if}
    </label>
  {/each}
</div>

<style>
  .k-radio-group { --box: 14px; display: flex; flex-direction: column; min-width: 0; }
  .k-radio-group[data-orient='horizontal'] { flex-direction: row; flex-wrap: wrap; column-gap: var(--space-6); }
  .kit-radio-group-opt {
    position: relative; display: flex; align-items: center; gap: var(--space-4);
    min-width: 0; min-height: var(--ctl-h);
    color: var(--tx); font-size: var(--fs-ui); line-height: var(--lh-tight);
    cursor: pointer; user-select: none;
  }
  [data-size='sm'] { --box: 12px; }
  [data-size='sm'] .kit-radio-group-opt { min-height: var(--ctl-h-sm); font-size: var(--fs-2); }
  [data-size='lg'] .kit-radio-group-opt { min-height: var(--ctl-h-lg); }
  .kit-radio-group-input { position: absolute; left: 0; top: 50%; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
  .kit-radio-group-dot {
    flex: none; position: relative; width: var(--box); height: var(--box);
    background: var(--bg-sunken); border: var(--bw) solid var(--line-ctl); border-radius: 50%;
    transition: border-color var(--t-quick) var(--ease-out);
  }
  .kit-radio-group-dot::after {
    content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--accent);
    opacity: 0; transition: opacity var(--t-quick) var(--ease-out);
  }
  .kit-radio-group-opt:hover .kit-radio-group-dot { border-color: var(--line-ctl-hover); }
  .kit-radio-group-opt:active .kit-radio-group-dot { border-color: var(--highlight); }
  .kit-radio-group-input:checked + .kit-radio-group-dot { border-color: var(--accent); }
  .kit-radio-group-input:checked + .kit-radio-group-dot::after { opacity: 1; }
  .kit-radio-group-opt:active .kit-radio-group-input:checked + .kit-radio-group-dot { border-color: var(--highlight); }
  .kit-radio-group-input:focus-visible + .kit-radio-group-dot { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); }
  .kit-radio-group-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kit-radio-group-hint { flex: none; color: var(--tx-mut); font-size: var(--fs-2); }
  .kit-radio-group-off { opacity: .45; cursor: not-allowed; }
  .kit-radio-group-off:hover .kit-radio-group-dot, .kit-radio-group-off:active .kit-radio-group-dot { border-color: var(--line-ctl); }
  .kit-radio-group-off .kit-radio-group-input:checked + .kit-radio-group-dot { border-color: var(--accent); }
</style>
