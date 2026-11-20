<!--
  Kbd: a shortcut as key caps, one <kbd> per cap, in the platform's notation (keys.js formatShortcut).
  <Kbd keys="Ctrl+Shift+Z" />  <Kbd keys="Ctrl+K Ctrl+S" />  <Kbd keys="Ctrl+S" platform="mac" />
-->
<script>
  import { formatShortcut } from './keys.js';

  let { keys = '', platform = undefined, class: cls = '', ...rest } = $props();
  const chords = $derived(formatShortcut(keys, platform));
</script>

<kbd class="k-kbd {cls}" {...rest}>
  {#each chords as chord, i}
    {#if i}<span class="kit-kbd-then">&thinsp;</span>{/if}
    <span class="kit-kbd-chord">{#each chord as cap}<kbd>{cap}</kbd>{/each}</span>
  {/each}
</kbd>

<style>
  .k-kbd { display: inline-flex; align-items: center; flex: none; vertical-align: middle; font: inherit; }
  .kit-kbd-chord { display: inline-flex; gap: var(--space-1); }
  .kit-kbd-then { width: var(--space-3); overflow: hidden; }
  kbd kbd {
    display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
    height: var(--space-6); min-width: var(--space-6); padding: 0 var(--space-2);
    border: var(--bw) solid var(--line-2); border-bottom-width: calc(2 * var(--bw)); border-bottom-color: var(--line-3);
    border-radius: var(--radius);
    background: var(--bg-raised); color: var(--tx-mut);
    font: 400 var(--fs-1) / 1 var(--mono); font-variation-settings: 'wdth' 90;
    white-space: nowrap;
  }
</style>
