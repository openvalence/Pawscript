<script>
  // paw-g56v: the view can pan half a view past either end of the video (lib/lane.js clampView). Every row on the time axis
  // puts this over its canvas: a hatched band before 0 and after the end, a boundary line at each, never taking the pointer.
  // Percent of the row's own width, so it lines up with any row that spans the shared x-axis.
  import { oobBands } from '../../lib/lane.js';
  let { app } = $props();
  const b = $derived(oobBands(app.view, app.durationMs));
</script>

{#if b.pre > 0}<div class="oob pre" data-oob="pre" style:width="{b.pre}%" aria-hidden="true"></div>{/if}
{#if b.post < 100}<div class="oob post" data-oob="post" style:left="{b.post}%" aria-hidden="true"></div>{/if}

<style>
  .oob {
    position: absolute; top: 0; bottom: 0; pointer-events: none;
    background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--line-3) 45%, transparent) 0 1px, transparent 1px 6px),
      color-mix(in srgb, var(--bg-raised) 40%, transparent);
  }
  .pre { left: 0; border-right: 1px solid var(--line-4); }
  .post { right: 0; border-left: 1px solid var(--line-4); }
</style>
