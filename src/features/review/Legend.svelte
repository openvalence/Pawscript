<script>
  // The heatmap legend bar: speed 0 .. top of scale in the chosen colour scale, with the device limit ticked.
  // Any feature may mount it: <Legend {app} />.
  import { tooltip } from '../../ui/kit/index.js';
  import { SCALES } from '../../lib/analyze/index.js';
  import { heatmapSettings, getReview } from './state.svelte.js';

  let { app } = $props();
  const rv = getReview(app);
  const hs = $derived((app.settings.values, heatmapSettings(app)));
  // the scale's own colours are data (analyze SCALES), not theme colours
  const css = (scale) => `linear-gradient(to right, ${(SCALES[scale] ?? SCALES.heat).map(([r, g, b]) => `rgb(${r},${g},${b})`).join(',')})`;
  const limitF = $derived(Math.min(1, rv.profile.maxSpeed / hs.max));
</script>

<div class="legend" role="img" aria-label="Heatmap legend: speed from 0 to {hs.max} units per second">
  <div class="bar" style:background={css(hs.scale)}>
    <span class="tick" style:left="{limitF * 100}%" {@attach tooltip(`Device limit ${rv.profile.maxSpeed} u/s`)}></span>
  </div>
  <div class="lab k-num"><span>0</span><span>{Math.round(hs.max / 2)}</span><span>{hs.max} u/s</span></div>
</div>

<style>
  .bar { position: relative; height: 12px; border-radius: var(--radius); box-shadow: inset 0 0 0 1px var(--line-2); }
  .tick { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: var(--tx-hi); box-shadow: 0 0 0 1px var(--bg); }
  .lab { display: flex; justify-content: space-between; margin-top: var(--space-2); font-size: var(--fs-1); color: var(--tx-mut); }
</style>
