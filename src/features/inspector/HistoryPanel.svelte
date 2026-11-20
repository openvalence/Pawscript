<script>
  import './inspector.css';
  import Toolbar from '../../ui/kit/Toolbar.svelte';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import VirtualList from '../../ui/kit/VirtualList.svelte';
  import EmptyState from '../../ui/kit/EmptyState.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  let { app } = $props();
  const h = $derived(app.history);
  const entries = $derived(h.entries);       // [{id,label,time,size,applied}] oldest first
  const index = $derived(h.index);           // entries[0..index) are applied
  const items = $derived([{ id: 'base', label: 'Original', base: true }, ...entries]);
  let now = $state(Date.now()), list = $state();
  $effect(() => { const t = setInterval(() => (now = Date.now()), 5000); return () => clearInterval(t); });
  // keep the current state in view
  $effect(() => { list?.scrollToIndex(index); });

  const ago = (t) => { const s = Math.max(0, Math.round((now - t) / 1000)); return s < 5 ? 'now' : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`; };
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour12: false });
  const keys = (id, d) => app.commands?.keysFor?.(id)?.[0] ?? d;
  async function clear() {
    if (!entries.length) return;
    if (await app.confirm({ title: 'Clear undo history?', message: `${entries.length} steps will be forgotten. Your script stays as it is now.`, ok: 'Clear history', danger: true })) h.reset();
  }
</script>

<div class="pi">
  <div class="pi-bar line">
    <span class="k-hint k-num">{entries.length ? `Step ${index} of ${entries.length}` : ''}</span>
    <Toolbar label="History">
      <IconButton icon="undo" size="sm" label={h.canUndo ? `Undo ${h.undoLabel ?? ''}`.trim() : 'Undo'} shortcut={keys('edit.undo', 'Ctrl+Z')} disabled={!h.canUndo} onclick={() => h.undo()} />
      <IconButton icon="redo" size="sm" label={h.canRedo ? `Redo ${h.redoLabel ?? ''}`.trim() : 'Redo'} shortcut={keys('edit.redo', 'Ctrl+Y')} disabled={!h.canRedo} onclick={() => h.redo()} />
      <span class="k-sep"></span>
      <IconButton icon="delete" size="sm" label="Clear history" disabled={!entries.length} onclick={clear} />
    </Toolbar>
  </div>
  {#if entries.length}
    <VirtualList class="hist" bind:this={list} {items} selected={index} label="Undo history" onselect={(_, i) => h.goto(i)} data-testid="history">
      {#snippet row(e, i)}
        <span class="lab" class:redo={!e.base && !e.applied} class:base={e.base} {@attach tooltip(e.base ? 'The document as loaded' : `Jump to this state (${clock(e.time)})`)}>{e.label}</span>
        {#if !e.base}<span class="k-num meta tm">{ago(e.time)}</span>{/if}
      {/snippet}
    </VirtualList>
  {:else}
    <EmptyState icon="history" title="No edits yet" description="Every change appears here; click one to jump back to it." />
  {/if}
</div>

<style>
  .pi > :global(.hist) { flex: 1; min-height: 0; }
  .lab { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .lab.base { color: var(--tx-mut); }
  .lab.redo { color: var(--tx-mut); font-style: italic; }
  .meta { flex: none; font-size: var(--fs-1); color: var(--tx-mut); }
  .tm { width: 3ch; text-align: right; }
</style>
