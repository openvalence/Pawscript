<!--
  StatusBar: the bottom row on --bg-raised with a top hairline. StatusItems (or any elements) in `children`
  line up from the left, those in `end` from the right; adjacent items get a quiet separator. With `middle` the two sides
  share the width equally and the middle sits exactly centred between them (each side clips its own overflow).
  <StatusBar aria-label="Status">
    <StatusItem icon="clock" tip="Cursor"><span class="k-num">01:23.456</span></StatusItem>
    {#snippet end()}<StatusItem icon="dot" tone="ok">Handy connected</StatusItem>{/snippet}
  </StatusBar>
-->
<script>
  let { children, middle, end, class: cls = '', ...rest } = $props();
</script>

<div class="k-status-bar {cls}" class:kit-status-bar-split={!!middle} {...rest}>
  <div class="kit-status-bar-grp">{@render children?.()}</div>
  {#if middle}<div class="kit-status-bar-middle">{@render middle()}</div>{/if}
  {#if end}<div class="kit-status-bar-grp kit-status-bar-end">{@render end()}</div>{/if}
</div>

<style>
  .k-status-bar {
    display: flex; align-items: stretch; gap: var(--space-6); min-width: 0; overflow: hidden;
    height: var(--ctl-h-sm); padding: 0 var(--space-1);
    background: var(--bg-raised); border-top: 1px solid var(--line-1);
    color: var(--tx-mut); font-size: var(--fs-2); line-height: 1; white-space: nowrap;
  }
  .kit-status-bar-grp { display: flex; align-items: stretch; min-width: 0; }
  .kit-status-bar-end { flex: none; margin-left: auto; }
  .kit-status-bar-split > .kit-status-bar-grp { flex: 1 1 0; overflow: hidden; }
  .kit-status-bar-split > .kit-status-bar-end { margin-left: 0; justify-content: flex-end; }
  .kit-status-bar-middle { flex: none; display: flex; align-items: stretch; }
  /* the separator: the app's one bar (theme.css .k-sep), a --line-1 hairline the bar's height, at the left edge of every
     item after the first */
  .kit-status-bar-grp > :global(* + *) {
    background-image: linear-gradient(var(--line-1), var(--line-1));
    background-size: var(--bw) 100%; background-position: left center; background-repeat: no-repeat;
  }
</style>
