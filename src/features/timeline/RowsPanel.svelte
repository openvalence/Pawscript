<script>
  // The bottom tray's Rows tab (paw-idb5): every timeline row of this tab that can be hidden, as a toggle (pressed = shown).
  // It replaces the "Hidden ..." strip that sat under the timeline; a row's own hide chip and right-click menu still work.
  import { Chip, Button } from '../../ui/kit/index.js';
  import { rowsIn } from '../../app/layout.svelte.js';

  let { app } = $props();
  const L = $derived(app.layout);
  const rows = $derived(rowsIn(app.lanes || [], app).filter((r) => r.height !== 'fill'));
  const hidden = $derived(rows.filter((r) => L.row(r.id).collapsed).length);
</script>

<div class="rows" data-testid="tray-rows">
  <p class="k-hint">Timeline rows of this tab{hidden ? ` · ${hidden} hidden` : ''}: click one to hide or show it.</p>
  <div class="chips" role="group" aria-label="Timeline rows">
    {#each rows as r (r.id)}
      <Chip selected={!L.row(r.id).collapsed} onchange={(on) => L.setRow(r.id, { collapsed: !on })}>{r.title}</Chip>
    {/each}
  </div>
  <div><Button size="sm" onclick={() => L.resetRows()}>Reset rows (this tab's default heights, shown / hidden)</Button></div>
</div>

<style>
  .rows { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-4) var(--space-5); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-3); }
</style>
