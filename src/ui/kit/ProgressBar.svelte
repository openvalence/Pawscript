<!--
  ProgressBar: a thin track with a tone fill. value 0..1, or null for an indeterminate sweep (still under
  reduced motion). `label` and `showValue` add a row above the track.
  <ProgressBar value={done / total} label="Exporting funscript" showValue />  <ProgressBar value={null} label="Analysing video" />
-->
<script>
  import { clamp } from './math.js';

  let { value = null, tone = 'accent', label = '', showValue = false, class: cls = '', ...rest } = $props();

  const ind = $derived(value == null || !Number.isFinite(value));
  const v = $derived(ind ? 0 : clamp(value, 0, 1));
  const pct = $derived(Math.round(v * 100));
</script>

<div
  class="k-progress-bar kit-progress-bar-t-{tone} {cls}"
  class:kit-progress-bar-ind={ind}
  role="progressbar"
  aria-label={label || undefined}
  aria-valuemin="0"
  aria-valuemax="100"
  aria-valuenow={ind ? undefined : pct}
  {...rest}
>
  {#if label || (showValue && !ind)}
    <div class="kit-progress-bar-head">
      <span class="kit-progress-bar-label">{label}</span>
      {#if showValue && !ind}<span class="kit-progress-bar-val k-num">{pct}%</span>{/if}
    </div>
  {/if}
  <div class="kit-progress-bar-track"><div class="kit-progress-bar-fill" style:width={ind ? null : v * 100 + '%'}></div></div>
</div>

<style>
  .k-progress-bar { --c: var(--accent); display: flex; flex-direction: column; gap: var(--space-2); width: 100%; min-width: 0; }
  .kit-progress-bar-t-neutral { --c: var(--tx-mut); }
  .kit-progress-bar-t-ok { --c: var(--ok); }
  .kit-progress-bar-t-warn { --c: var(--warn); }
  .kit-progress-bar-t-bad { --c: var(--bad); }
  .kit-progress-bar-t-info { --c: var(--info); }

  .kit-progress-bar-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); font-size: var(--fs-2); line-height: var(--lh-tight); }
  .kit-progress-bar-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx-mut); }
  .kit-progress-bar-val { flex: none; color: var(--tx-val); }

  .kit-progress-bar-track { position: relative; height: calc(var(--space-1) + var(--bw)); overflow: hidden; background: var(--line-2); border-radius: var(--radius); }
  .kit-progress-bar-fill { height: 100%; background: var(--c); }
  /* Indeterminate: a third of the track sweeping across; with motion off the base pose (centred) stays. */
  .kit-progress-bar-ind .kit-progress-bar-fill { width: 30%; translate: 117% 0; animation: sweep calc(var(--t-slow) * 4) var(--ease-out) infinite; }
  @keyframes sweep { from { translate: -100% 0; } to { translate: 334% 0; } }
</style>
