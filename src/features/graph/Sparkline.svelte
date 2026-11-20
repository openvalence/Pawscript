<!--
  Sparkline: one graph value plotted over a time range on a canvas (decimated per column). The canvas repaints
  only when the value or the range changes. The playhead and the shared hover cursor are CSS lines placed by
  the variables --ph / --hv (fractions of the range) set once on an ancestor, so playback never repaints 200
  cards. Hovering shows a readout ("@1:23.4 → 62") and reports the time; a click seeks.
  <Sparkline type="script" {value} t0 t1 width={190} height={30} onhover={(t|null) => …} onseek={(t) => …}
             overlay={inputValue} overlayType="script" />
-->
<script>
  import { drawValue, fitCanvas, tok, fmtT, readout } from './editor/plot.js';
  import { valueAt } from '../../lib/graph/types.js';

  let {
    type, value, t0, t1, width = 190, height = 30, overlay = null, overlayType = null, color = null, labels = false, dots = false,
    onhover, onseek, label = 'Preview', class: cls = '',
  } = $props();

  let cv = $state();
  let at = $state(null);   // local hover time
  let raf = 0;
  $effect(() => {
    void type; void value; void t0; void t1; void width; void height; void overlay; void color;
    if (!raf) raf = requestAnimationFrame(paint);
    return () => { cancelAnimationFrame(raf); raf = 0; };
  });
  function paint() {
    raf = 0;
    if (!cv || !(t1 > t0)) return;
    const ctx = fitCanvas(cv, width, height);
    if (overlay != null && overlayType) drawValue(ctx, width, height, overlayType, overlay, t0, t1, { color: tok('--tx-mut'), width: 1, dim: 0.7 });
    if (value != null) drawValue(ctx, width, height, type, value, t0, t1, { color, labels, dots });
  }
  function safeAt(t) { try { return valueAt(type, value, t); } catch { return null; } }
  const text = $derived(at != null && value != null ? readout(type, safeAt(at)) : '');
  const tOf = (e) => t0 + ((e.clientX - e.currentTarget.getBoundingClientRect().left) / width) * (t1 - t0);
</script>

<div class="gspark {cls}" style:width={width + 'px'} style:height={height + 'px'}>
  <canvas bind:this={cv} style:width={width + 'px'} style:height={height + 'px'} aria-label={label}
          onpointermove={(e) => { at = tOf(e); onhover?.(at); }} onpointerleave={() => { at = null; onhover?.(null); }}
          onclick={(e) => onseek?.(tOf(e))}></canvas>
  <i class="gspark-ph" aria-hidden="true"></i>
  <i class="gspark-hv" aria-hidden="true"></i>
  {#if value == null}<span class="gspark-none">no value yet</span>{/if}
  {#if text}<span class="gspark-at k-num">@{fmtT(at)} → {text}</span>{/if}
</div>

<style>
  .gspark { position: relative; flex: none; background: var(--bg-sunken); border-radius: var(--radius); box-shadow: var(--recess); overflow: hidden; }
  canvas { display: block; cursor: crosshair; }
  .gspark-ph, .gspark-hv { position: absolute; top: 0; bottom: 0; width: 0; pointer-events: none; }
  .gspark-ph { left: clamp(-4px, calc(var(--ph, -1) * 100%), calc(100% + 4px)); border-left: 1px solid rgba(var(--highlight-rgb), .75); }
  .gspark-hv { left: clamp(-4px, calc(var(--hv, -1) * 100%), calc(100% + 4px)); border-left: 1px dashed var(--tx-mut); }
  .gspark-none { position: absolute; inset: 0; display: grid; place-items: center; font-size: var(--fs-1); color: var(--tx-ghost); pointer-events: none; }
  .gspark-at { position: absolute; right: 2px; top: 1px; padding: 0 3px; font-size: var(--fs-1); line-height: 13px; color: var(--tx-hi);
    background: color-mix(in srgb, var(--bg-sunken) 82%, transparent); border-radius: var(--radius); pointer-events: none; }
</style>
