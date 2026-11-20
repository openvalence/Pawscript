<!--
  SliderTrack (internal): the track, fill, ticks and one or two thumbs that Slider and RangeSlider share.
  `values` is [v] or [lo, hi]. Pixel positions are computed in whole pixels so the 1 px frames stay crisp.
  Press on the track: the (nearest) thumb jumps there and drags; press on a thumb: it drags from where it is.
-->
<script>
  import { fraction, nudge } from './math.js';
  import { tickValues, thumbLeft, valueAt, setRange, nearestThumb, tidy } from './fields.js';

  let {
    values = $bindable([0]), min = 0, max = 100, step = 1, minGap = 0, ticks, disabled = false, size = 'md',
    format, thumbAttrs = [], onchange, oncommit,
  } = $props();

  let track;
  const thumbs = $state([]);
  let width = $state(0);
  let thumbW = $state(0);
  let active = $state(-1);
  const range = $derived(values.length === 2);
  const left = (v) => thumbLeft(fraction(v, min, max), width, thumbW);
  const centre = (v) => left(v) + Math.floor(thumbW / 2);
  const tickXs = $derived(width ? tickValues(ticks, { min, max, step }).map(centre) : []);
  const fillFrom = $derived(range ? centre(values[0]) : 0);
  const fillTo = $derived(centre(values[values.length - 1]));

  function setAt(i, v, e) {
    const next = range ? setRange(values, i, v, { min, max, minGap }) : [Math.min(max, Math.max(min, v))];
    if (next[0] === values[0] && next[1] === values[1]) return;
    values = next;
    onchange?.(next, e);
  }
  const changed = (from) => from.some((v, i) => v !== values[i]);

  // ---- pointer ----------------------------------------------------------------
  let g = null; // { id, i, grab, from, x0, pending }
  const at = (clientX) => clientX - track.getBoundingClientRect().left;
  function pointerdown(e) {
    if (disabled || g || e.button !== 0) return;
    e.preventDefault();
    const x = at(e.clientX);
    const hits = values.map((v, i) => (x >= left(v) - 1 && x <= left(v) + thumbW + 1 ? i : -1)).filter((i) => i >= 0);
    g = { id: e.pointerId, from: [...values], x0: x, grab: 0, i: 0, pending: false };
    if (hits.length) {
      // On a thumb: drag it from where it is. On two overlapping thumbs: the first move picks the side.
      g.i = hits.length === 2 ? (thumbs[1] === document.activeElement ? 1 : 0) : hits[0];
      g.pending = hits.length === 2;
      g.grab = x - centre(values[g.i]);
    } else {
      const v = valueAt(x, width, thumbW, { min, max, step });
      g.i = range ? nearestThumb(values, v) : 0;
      setAt(g.i, v, e);
    }
    active = g.i;
    thumbs[g.i]?.focus({ preventScroll: true });
    try { track.setPointerCapture(e.pointerId); } catch { /* gone */ }
  }
  function pointermove(e) {
    if (!g || e.pointerId !== g.id) return;
    if (g.pending) {
      const x = at(e.clientX);
      if (x === g.x0) return;
      g.pending = false;
      g.i = active = x < g.x0 ? 0 : 1;
      g.grab = g.x0 - centre(values[g.i]);
      thumbs[g.i]?.focus({ preventScroll: true });
    }
    setAt(g.i, valueAt(at(e.clientX) - g.grab, width, thumbW, { min, max, step }), e);
  }
  function pointerup(e) {
    if (!g || e.pointerId !== g.id) return;
    const from = g.from;
    g = null;
    active = -1;
    if (changed(from)) oncommit?.(values);
  }

  // ---- keys -------------------------------------------------------------------
  let held = null;
  const DIR = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 1, PageDown: -1 };
  function keydown(e, i) {
    if (disabled) return;
    const dir = DIR[e.key];
    let v;
    if (dir) v = tidy(nudge(values[i], dir, { min, max, step }, e.key.startsWith('Page') ? { coarse: true } : e), { min, step });
    else if (e.key === 'Home') v = min;
    else if (e.key === 'End') v = max;
    else return;
    e.preventDefault();
    held ??= [...values];
    setAt(i, v, e);
  }
  function keyup(e) {
    if (!held || !(e.key in DIR || e.key === 'Home' || e.key === 'End')) return;
    if (changed(held)) oncommit?.(values);
    held = null;
  }
  const blur = () => { if (held && changed(held)) oncommit?.(values); held = null; };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions (the pointer surface; the thumbs are the role=slider controls) -->
<div
  bind:this={track}
  bind:clientWidth={width}
  class="k-slider-track"
  data-size={size}
  class:kit-slider-track-disabled={disabled}
  onpointerdown={pointerdown}
  onpointermove={pointermove}
  onpointerup={pointerup}
  onpointercancel={pointerup}
>
  <span class="kit-slider-track-rail"></span>
  <span class="kit-slider-track-fill" style:left="{fillFrom}px" style:width="{Math.max(0, fillTo - fillFrom)}px"></span>
  {#each tickXs as x}<span class="kit-slider-track-tick" style:left="{x}px"></span>{/each}
  {#each values as v, i}
    {@const a = thumbAttrs[i] || {}}
    <span
      bind:this={thumbs[i]}
      class="kit-slider-track-thumb"
      role="slider"
      tabindex={disabled ? -1 : 0}
      aria-valuenow={v}
      aria-valuemin={range && i === 1 ? values[0] + minGap : min}
      aria-valuemax={range && i === 0 ? values[1] - minGap : max}
      aria-valuetext={format ? format(v) : undefined}
      aria-orientation="horizontal"
      aria-disabled={disabled || undefined}
      data-active={active === i || undefined}
      style:left="{left(v)}px"
      {...a}
      onkeydown={(e) => keydown(e, i)}
      onkeyup={keyup}
      onblur={blur}
    ></span>
  {/each}
  <!-- measures the thumb width the CSS decides (density) -->
  <span class="kit-slider-track-thumb kit-slider-track-probe" aria-hidden="true" bind:offsetWidth={thumbW}></span>
</div>

<style>
  .k-slider-track {
    /* Phosphor's rectangular thumb: 9 x 16 at the default density, from the control height */
    --thumb-h: calc(var(--ctl-h) - 10px);
    --thumb-w: round(calc(var(--thumb-h) * .56), 1px);
    position: relative; flex: 1 1 auto; min-width: 0; height: var(--ctl-h);
    cursor: pointer; touch-action: pan-y; user-select: none;
  }
  .k-slider-track[data-size='sm'] { --thumb-h: calc(var(--ctl-h-sm) - 8px); height: var(--ctl-h-sm); }
  .k-slider-track[data-size='lg'] { --thumb-h: calc(var(--ctl-h-lg) - 12px); height: var(--ctl-h-lg); }
  .kit-slider-track-rail, .kit-slider-track-fill { position: absolute; top: calc(50% - 1px); height: 2px; }
  .kit-slider-track-rail { left: 0; right: 0; background: var(--line-ctl); }
  .kit-slider-track-fill { background: var(--accent); }
  .kit-slider-track-tick { position: absolute; top: calc(50% + 3px); width: 1px; height: var(--space-2); background: var(--line-3); }
  .kit-slider-track-thumb {
    position: absolute; top: calc(50% - var(--thumb-h) / 2); width: var(--thumb-w); height: var(--thumb-h);
    background: var(--bg); border: var(--bw) solid var(--tx-val); border-radius: 0;
    box-shadow: 0 0 0 2px var(--bg); outline: none;
    transition: border-color var(--t-quick) var(--ease-out), box-shadow var(--t-quick) var(--ease-out);
  }
  .kit-slider-track-probe { visibility: hidden; left: 0; pointer-events: none; }
  .k-slider-track:hover .kit-slider-track-thumb:not(:focus-visible, [data-active]) { border-color: var(--tx-hi); }
  .kit-slider-track-thumb:focus-visible, .kit-slider-track-thumb[data-active] { z-index: 1; border-color: var(--highlight); box-shadow: 0 0 0 2px var(--bg), var(--glow-highlight); }
  /* the keyboard also gets the kit's ring: the glow alone is gone in the contrast theme */
  .kit-slider-track-thumb:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); }
  .kit-slider-track-thumb:focus { z-index: 1; }
  .kit-slider-track-disabled { opacity: .45; cursor: not-allowed; }
  .kit-slider-track-disabled:hover .kit-slider-track-thumb { border-color: var(--tx-val); }
</style>
