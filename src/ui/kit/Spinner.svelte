<!--
  Spinner: a 1.5px arc turning over a faint track, in currentColor. Static under reduced motion (the
  duration is a --t-* token, which reduced motion zeroes). label='' makes it decorative (inside a busy button).
  <Spinner />  <Spinner size={12} label="" />
-->
<script>
  let { size = 16, label = 'Loading', class: cls = '', ...rest } = $props();
  const c = $derived(size / 2);
  const r = $derived((size - 1.5) / 2);
  const len = $derived(2 * Math.PI * r);
</script>

<svg
  class="k-spinner {cls}"
  width={size}
  height={size}
  viewBox="0 0 {size} {size}"
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
  {...rest}
>
  <circle class="kit-spinner-track" cx={c} cy={c} {r} />
  <circle class="kit-spinner-arc" cx={c} cy={c} {r} stroke-dasharray="{len * 0.3} {len}" transform="rotate(-90 {c} {c})" />
</svg>

<style>
  .k-spinner {
    flex: none; display: block;
    animation: spin calc(var(--t-slow) * 2.5) linear infinite;
  }
  circle { fill: none; stroke: currentColor; stroke-width: 1.5; }
  .kit-spinner-track { opacity: .2; }
  .kit-spinner-arc { stroke-linecap: round; }
  @keyframes spin { to { rotate: 360deg; } }
</style>
