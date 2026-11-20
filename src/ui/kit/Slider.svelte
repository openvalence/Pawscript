<!--
  Slider: one value on a hairline track. Custom (not a native range) so it matches RangeSlider exactly.
  <Slider bind:value min={0} max={1} step={0.01} label="Smoothing" showValue oncommit={pushUndo} />
  Keys: arrows ±step (Shift ×10, Alt ×0.1), PageUp/Down ×10, Home/End. One `oncommit` per drag or key hold.
  showValue: the readout types: click it (or Enter on the thumb) and type; Enter or leaving commits (parsed, clamped,
  snapped), Escape cancels. `default`: right click offers Reset to default, Copy value, Paste value (contextmenu.js).
-->
<script>
  import { tick } from 'svelte';
  import SliderTrack from './SliderTrack.svelte';
  import { formatNumber, parseNumber, snap } from './math.js';
  import { numberChars, typedValue } from './fields.js';
  import { property } from './contextmenu.js';

  let {
    value = $bindable(0), min = 0, max = 100, step = 1, ticks, label = '', format, showValue = false, disabled = false,
    size = 'md', full = false, default: dflt, onchange, oncommit, class: cls = '', ...rest
  } = $props();

  const fmt = $derived(format || ((v) => formatNumber(v, { step })));
  const chars = $derived(numberChars({ min, max, step, format: fmt }));

  /** One whole gesture to v (typed, reset, paste): clamped and snapped, onchange then oncommit. */
  function gesture(v) {
    v = snap(v, { min, max, step });
    if (!Number.isFinite(v) || v === value) return;
    value = v;
    onchange?.(v);
    oncommit?.(v);
  }

  // ---- typing into the readout ------------------------------------------------
  let typing = $state(false), text = $state(''), input = $state();
  async function startTyping() {
    if (disabled || !showValue) return;
    text = formatNumber(value, { step });
    typing = true;
    await tick();
    input?.focus();
    input?.select();
  }
  function stopTyping(commit) {
    if (!typing) return;
    typing = false;
    if (commit) gesture(typedValue(text, { min, max, step }));
  }
  function typeKey(e) {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); stopTyping(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopTyping(false); }
  }
  const thumbKey = (e) => { if (e.key === 'Enter' && showValue) { e.preventDefault(); startTyping(); } };

  const asProperty = (node) => (dflt === undefined ? undefined : property(() => ({
    value, default: dflt, disabled, set: gesture, parse: parseNumber, format: (v) => (Number.isFinite(v) ? fmt(v) : String(v)),
  }))(node));
</script>

<div class="k-slider {cls}" data-size={size} class:kit-slider-full={full} {@attach asProperty}>
  <SliderTrack
    bind:values={() => [value], (vs) => (value = vs[0])}
    {min} {max} {step} {ticks} {disabled} {size}
    format={fmt}
    thumbAttrs={[{ 'aria-label': label || undefined, onkeydowncapture: thumbKey, ...rest }]}
    onchange={(vs, e) => onchange?.(vs[0], e)}
    oncommit={(vs) => oncommit?.(vs[0])}
  />
  {#if showValue}
    {#if typing}
      <input bind:this={input} bind:value={text} class="k-num kit-slider-value kit-slider-input" style:--chars={chars} type="text" inputmode="decimal"
        spellcheck="false" autocomplete="off" aria-label={label ? `${label}: type a value` : 'Type a value'} onkeydown={typeKey} onblur={() => stopTyping(true)} />
    {:else}
      <!-- the readout is a pointer target only: the keyboard types from the thumb (Enter) -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <output class="k-num kit-slider-value" class:kit-slider-disabled={disabled} class:kit-slider-typeable={!disabled} style:--chars={chars}
        onclick={startTyping}>{fmt(value)}</output>
    {/if}
  {/if}
</div>

<style>
  .k-slider {
    display: inline-flex; align-items: center; gap: var(--space-4); vertical-align: middle;
    width: calc(var(--space-8) * 6); min-width: 0; max-width: 100%; font-size: var(--fs-ui);
  }
  .k-slider[data-size='sm'] { font-size: var(--fs-2); gap: var(--space-3); }
  .kit-slider-full { display: flex; width: 100%; }
  .kit-slider-value { flex: none; min-width: calc(var(--chars) * 1ch); color: var(--tx-val); text-align: right; white-space: nowrap; }
  .kit-slider-value.kit-slider-disabled { opacity: .45; }
  .kit-slider-typeable { cursor: text; }
  .kit-slider-typeable:hover { color: var(--tx-hi); }
  .kit-slider-input {
    width: calc(var(--chars) * 1ch + 2 * var(--space-2)); height: var(--ctl-h-sm); margin: 0; padding: 0 var(--space-2);
    background: var(--bg-sunken); border: var(--bw) solid var(--focus); border-radius: var(--radius); box-shadow: var(--recess);
    outline: none; font-size: inherit; color: var(--tx-hi);
  }
</style>
