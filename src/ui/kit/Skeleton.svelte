<!--
  Skeleton: a placeholder block, or `lines` text bars (the last one shorter), with a shimmer that stops under
  reduced motion. width / height take a number (px) or any CSS length. Decorative (aria-hidden): put
  aria-busy on the region that is loading.
  <Skeleton width={160} height={90} />  <Skeleton lines={3} width="60%" />
-->
<script>
  let { width = '100%', height = undefined, lines = 0, class: cls = '', ...rest } = $props();
  const len = (v) => (typeof v === 'number' ? v + 'px' : v);
</script>

{#if lines > 0}
  <div class="k-skeleton kit-skeleton-stack {cls}" style:width={len(width)} aria-hidden="true" {...rest}>
    {#each { length: lines } as _, i}
      <div class="kit-skeleton-bar kit-skeleton-line" style:height={len(height)} style:width={lines > 1 && i === lines - 1 ? '60%' : null}></div>
    {/each}
  </div>
{:else}
  <div class="k-skeleton kit-skeleton-bar {cls}" style:width={len(width)} style:height={len(height)} aria-hidden="true" {...rest}></div>
{/if}

<style>
  .kit-skeleton-stack { display: flex; flex-direction: column; gap: var(--space-3); max-width: 100%; }
  .kit-skeleton-bar {
    height: var(--ctl-h); max-width: 100%; border-radius: var(--radius);
    background-color: var(--bg-hover);
    background-image: linear-gradient(90deg, transparent, var(--bg-active), transparent);
    background-size: 200% 100%; background-repeat: no-repeat; background-position: 200% 0;
    animation: shimmer calc(var(--t-slow) * 5) linear infinite;
  }
  .kit-skeleton-line { height: var(--space-5); }
  @keyframes shimmer { from { background-position: 200% 0; } to { background-position: -100% 0; } }
</style>
