<!--
  ToyPicker: the Machine panel's toy dropdown. The button shows the current toy's picture and name; the popover is a
  grid of picture tiles with a filter field (type to filter by name), arrow keys move between tiles, Enter picks.
  The owner's own toys (owner.js) come first as "My toys"; the owner's imported toys are a group of their own at the end,
  each with a remove button.
  <ToyPicker {list} current={entry} onpick={(key) => …} onremove={(entry) => …} />
-->
<script>
  import { Popover, TextField, IconButton, Icon } from '../../ui/kit/index.js';
  import { tooltip } from '../../ui/kit/tooltip.js';

  let { list = [], current, onpick, onremove } = $props();
  let open = $state(false), q = $state(''), grid = $state(), field = $state();
  $effect(() => { if (open) setTimeout(() => field?.focus(), 30); });   // type to filter as soon as it opens
  const match = (e) => !q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase());
  const shop = $derived(list.filter((e) => e.kind !== 'custom' && e.kind !== 'owner' && match(e)));
  const theirs = $derived(list.filter((e) => e.kind === 'owner' && match(e)));
  const mine = $derived(list.filter((e) => e.kind === 'custom' && match(e)));

  function pick(e) { onpick?.(e.key); open = false; q = ''; }
  /** Arrows move between tiles (the grid's column count from the layout), Home / End jump. */
  function nav(e) {
    const tiles = [...grid.querySelectorAll('button.tile')], i = tiles.indexOf(document.activeElement);
    if (!tiles.length) return;
    const cols = Math.max(1, Math.round(grid.clientWidth / (tiles[0].offsetWidth || 1)));
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i < 0 ? 0 : i + cols, ArrowUp: i - cols, Home: 0, End: tiles.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    tiles[Math.max(0, Math.min(tiles.length - 1, to))]?.focus();
  }
  function fieldKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); grid?.querySelector('button.tile')?.focus(); }
    else if (e.key === 'Enter') { const first = theirs[0] || shop[0] || mine[0]; if (first) pick(first); }
  }
</script>

<Popover bind:open title="Toy" placement="bottom-start" class="toy-pop">
  {#snippet trigger({ props })}
    <button type="button" class="cur" {...props} aria-label="Toy: {current?.name}">
      {#if current?.thumb}<img src={current.thumb} alt="" draggable="false" />{:else}<span class="gen">{current?.name?.slice(0, 2)}</span>{/if}
      <span class="nm">{current?.name}</span>
      <Icon name="chevron-down" size={14} />
    </button>
  {/snippet}
  <div class="body">
    <TextField size="sm" full clearable icon="search" placeholder="Filter toys" label="Filter toys" bind:value={q} bind:inputEl={field} onkeydown={fieldKey} />
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="grid" bind:this={grid} role="listbox" tabindex="-1" aria-label="Toys" onkeydown={nav}>
      {#if theirs.length}
        <div class="grp" role="presentation">My toys</div>
        {#each theirs as e (e.key)}
          <button type="button" class="tile" role="option" aria-selected={e.key === current?.key} onclick={() => pick(e)} {@attach tooltip(e.name)}>
            <img src={e.thumb} alt="" draggable="false" /><span class="lbl">{e.name}</span>
          </button>
        {/each}
        <div class="grp" role="presentation">Library</div>
      {/if}
      {#each shop as e (e.key)}
        <button type="button" class="tile" role="option" aria-selected={e.key === current?.key} onclick={() => pick(e)} {@attach tooltip(e.name + (e.kind === 'generic' ? ' (generic shape)' : ''))}>
          {#if e.thumb}<img src={e.thumb} alt="" draggable="false" />{:else}<span class="gen">{e.name.slice(0, 2)}</span>{/if}
          <span class="lbl">{e.name}</span>
        </button>
      {/each}
      {#if mine.length}
        <div class="grp" role="presentation">Your toys</div>
        {#each mine as e (e.key)}
          <div class="own">
            <button type="button" class="tile" role="option" aria-selected={e.key === current?.key} onclick={() => pick(e)}>
              <span class="gen">{e.name.slice(0, 2)}</span><span class="lbl">{e.name}</span>
            </button>
            <IconButton size="sm" icon="delete" label="Remove {e.name}" onclick={() => onremove?.(e)} />
          </div>
        {/each}
      {/if}
      {#if !shop.length && !mine.length && !theirs.length}<div class="none">No toy matches "{q}".</div>{/if}
    </div>
  </div>
</Popover>

<style>
  .cur { display: inline-flex; align-items: center; gap: var(--space-2); height: var(--ctl-h-sm); max-width: 230px; padding: 0 var(--space-2) 0 2px;
    border: var(--bw) solid var(--line-ctl); border-radius: var(--radius); background: var(--bg-sunken); color: var(--tx); cursor: pointer; font: inherit; font-size: var(--fs-2); }
  .cur:hover { border-color: var(--line-ctl-hover); }
  .cur:focus-visible { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: 1px; }
  .cur img { height: calc(var(--ctl-h-sm) - 4px); width: 20px; object-fit: contain; }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .body { display: flex; flex-direction: column; gap: var(--space-3); width: min(440px, 80vw); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: var(--space-2); max-height: 360px; overflow: auto; outline: none; }
  .tile { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: var(--space-2) 2px; border: var(--bw) solid transparent; border-radius: var(--radius);
    background: var(--bg-sunken); color: var(--tx-mut); cursor: pointer; font: inherit; min-width: 0; }
  .tile:hover { border-color: var(--line-3); color: var(--tx); }
  .tile:focus-visible { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: 1px; }
  .tile[aria-selected='true'] { border-color: var(--accent); color: var(--tx); }
  .tile img { height: 54px; width: 100%; object-fit: contain; }
  .lbl { font-size: var(--fs-1); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gen { display: grid; place-items: center; height: 54px; font-size: var(--fs-2); color: var(--tx-mut); text-transform: uppercase; }
  .cur .gen { height: auto; width: 20px; }
  .grp { grid-column: 1 / -1; font-size: var(--fs-1); color: var(--tx-mut); text-transform: uppercase; letter-spacing: var(--caps-track); padding-top: var(--space-2); }
  .own { position: relative; }
  .own .tile { width: 100%; }
  .own :global(.k-icon-button) { position: absolute; top: 0; right: 0; }
  .none { grid-column: 1 / -1; color: var(--tx-mut); font-size: var(--fs-2); padding: var(--space-3); }
</style>
