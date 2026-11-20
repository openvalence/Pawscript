<script>
  // The Scenes tab's chip bar (paw-ef73.7): the Scene and Shot chips (SceneChips) at the foot of the timeline, where the
  // lane toolbar has them in the other tabs (the Scenes tab shows no point lanes).
  import SceneChips from './SceneChips.svelte';
  let { app } = $props();
</script>

<div class="bar" role="toolbar" aria-label="Scene and shot"><SceneChips {app} /></div>

<style>
  .bar { height: 100%; display: flex; align-items: center; padding: 0 var(--space-3); background: var(--bg-raised); border-top: 1px solid var(--line-0); }
</style>
