<script>
  // One binding as key caps: 'Ctrl+Shift+Z' -> [Ctrl][Shift][Z], 'G G' -> [G] [G], 'Shift+/' -> [?].
  import { fmtKeys } from '../../app/keymap.js';
  let { keys } = $props();
  const chords = $derived(fmtKeys(keys).split(' ').map((c) => (c === '+' || !c.includes('+') ? [c] : c.split('+'))));
</script>

<span class="pk" aria-label={fmtKeys(keys)}>{#each chords as ch, i (i)}{#if i}<span class="then"></span>{/if}{#each ch as k, j (j)}<kbd>{k}</kbd>{/each}{/each}</span>

<style>
  .pk { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; vertical-align: middle; }
  .then { width: 4px; }
  kbd {
    display: inline-block; min-width: 18px; padding: 2px 4px; text-align: center;
    font: 500 var(--fs-1) / 1 var(--mono); color: inherit;
    background: var(--bg-sunken); border: 1px solid var(--line-2); border-bottom-width: 2px; border-radius: var(--radius);
  }
</style>
