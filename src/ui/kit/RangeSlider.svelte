<!--
  RangeSlider: [lo, hi] on one track, two thumbs (each a role slider). Thumbs never cross and stay `minGap`
  apart; a press on the track moves the nearer thumb.
  <RangeSlider bind:value={range} min={0} max={100} label="Range" showValue />
-->
<script>
  import SliderTrack from './SliderTrack.svelte';
  import { formatNumber } from './math.js';
  import { numberChars } from './fields.js';
  import { nextId } from './focus.js';

  let {
    value = $bindable([0, 100]), min = 0, max = 100, step = 1, minGap = 0, ticks, label = '', format, showValue = false,
    disabled = false, size = 'md', full = false, onchange, oncommit, class: cls = '', id, ...rest
  } = $props();

  const fmt = $derived(format || ((v) => formatNumber(v, { step })));
  const chars = $derived(numberChars({ min, max, step, format: fmt }));
  // `id` goes to the low thumb (a Field's label points at it); aria-labelledby / -describedby to both thumbs
  // (each adds its own "minimum" / "maximum"); everything else to the root.
  const uid = $derived(id || nextId('k-range'));
  const { 'aria-labelledby': labelledby, 'aria-describedby': describedby, ...rootRest } = $derived(rest);
  const thumb = (end, extra) => labelledby
    ? { 'aria-labelledby': `${labelledby} ${uid}-${end}`, 'aria-describedby': describedby, ...extra }
    : { 'aria-label': label ? `${label} ${end}` : end, 'aria-describedby': describedby, ...extra };
</script>

<div class="k-range-slider {cls}" data-size={size} class:kit-range-slider-full={full} {...rootRest}>
  <SliderTrack
    bind:values={() => value, (vs) => (value = vs)}
    {min} {max} {step} {minGap} {ticks} {disabled} {size}
    format={fmt}
    thumbAttrs={[thumb('minimum', { id: uid }), thumb('maximum')]}
    onchange={(vs, e) => onchange?.(vs, e)}
    oncommit={(vs) => oncommit?.(vs)}
  />
  {#if labelledby}<span class="k-sr" id="{uid}-minimum">minimum</span><span class="k-sr" id="{uid}-maximum">maximum</span>{/if}
  {#if showValue}
    <output class="k-num kit-range-slider-value" class:kit-range-slider-disabled={disabled} style:--chars={chars * 2 + 3}>{fmt(value[0])} – {fmt(value[1])}</output>
  {/if}
</div>

<style>
  .k-range-slider {
    display: inline-flex; align-items: center; gap: var(--space-4); vertical-align: middle;
    width: calc(var(--space-8) * 6); min-width: 0; max-width: 100%; font-size: var(--fs-ui);
  }
  .k-range-slider[data-size='sm'] { font-size: var(--fs-2); gap: var(--space-3); }
  .kit-range-slider-full { display: flex; width: 100%; }
  .kit-range-slider-value { flex: none; min-width: calc(var(--chars) * 1ch); color: var(--tx-val); text-align: right; white-space: nowrap; }
  .kit-range-slider-value.kit-range-slider-disabled { opacity: .45; }
</style>
