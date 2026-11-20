<!--
  VirtualList: fixed-height rows, only the visible window (+ overscan) in the DOM, smooth at 100 000.
  Row height defaults to the density's --row-h. Pass `selected` (an index, -1 = none) to make it a
  single-select listbox: arrows / Home / End / PageUp / PageDown move the selection, Enter or a
  double-click activates. Without it, a plain list.
  <VirtualList {items} bind:selected label="Actions" onactivate={(a) => seek(a.at)} bind:this={list}>
    {#snippet row(a, i)}<span class="k-num">{fmt(a.at)}</span>{/snippet}
  </VirtualList>
  list.scrollToIndex(i) brings row i into view.
-->
<script>
  import ScrollArea from './ScrollArea.svelte';
  import { windowRange, scrollToRow, clamp } from './math.js';
  import { nextIndex, nextId } from './focus.js';
  import { cssVar } from './color.js';
  import { onThemeChange } from './tokens.js';

  let {
    items = [],
    rowHeight,
    overscan = 6,
    row,
    selected = $bindable(),
    label,
    shadows = true,
    onselect,
    onactivate,
    class: cls = '',
    ...rest
  } = $props();

  const uid = nextId('vl');
  let el = $state();
  let scrollTop = $state(0), viewH = $state(0), tokenH = $state(24);
  const rh = $derived(rowHeight || tokenH);
  const count = $derived(items.length);
  const listbox = $derived(selected !== undefined);

  // Only a crossed row boundary changes `first`, so scrolling within a row re-renders nothing.
  const first = $derived(Math.floor(scrollTop / rh));
  const range = $derived(windowRange(first * rh, viewH, rh, count, overscan));
  const rows = $derived.by(() => {
    const out = new Array(range.end - range.start);
    for (let i = 0; i < out.length; i++) out[i] = range.start + i;
    return out;
  });
  const sel = $derived(listbox && selected >= 0 && selected < count ? selected : -1);
  const activeId = $derived(sel >= range.start && sel < range.end ? `${uid}-${sel}` : undefined);

  $effect(() => {
    const node = el;
    if (!node) return;
    const read = () => { tokenH = parseFloat(cssVar('--row-h', node)) || 24; };
    read();
    const ro = new ResizeObserver(() => { viewH = node.clientHeight; });
    ro.observe(node);
    const onScroll = () => { scrollTop = node.scrollTop; };
    node.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    const off = onThemeChange(read);
    return () => { ro.disconnect(); node.removeEventListener('scroll', onScroll); off(); };
  });

  /** Bring row i fully into view (no change when it already is). */
  export function scrollToIndex(i) {
    if (!el || !count) return;
    i = clamp(i, 0, count - 1);
    el.scrollTop = scrollToRow(i, el.scrollTop, el.clientHeight, rh);
    scrollTop = el.scrollTop;
  }

  function choose(i, e) {
    if (i === selected) return;
    selected = i;
    scrollToIndex(i);
    onselect?.(items[i], i, e);
  }

  function key(e) {
    if (!listbox || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); onactivate?.(items[sel], sel, e); return; }
    const page = Math.max(1, Math.floor(viewH / rh) - 1);
    const i = nextIndex(count, sel, e.key, { loop: false, page });
    if (i === null) return;
    e.preventDefault();
    choose(i, e);
  }

  function rowAt(e) {
    const r = e.target.closest?.('[data-index]');
    return r ? +r.dataset.index : -1;
  }
</script>

<ScrollArea
  class="k-virtual-list {cls}"
  {shadows}
  bind:el
  viewport={{
    role: listbox ? 'listbox' : 'list',
    tabindex: listbox ? 0 : undefined,
    'aria-label': label,
    'aria-activedescendant': activeId,
    'data-has-active': sel >= 0 || undefined,
    onkeydown: key,
    onclick: (e) => { const i = rowAt(e); if (listbox && i >= 0) choose(i, e); },
    ondblclick: (e) => { const i = rowAt(e); if (i >= 0) onactivate?.(items[i], i, e); },
  }}
  {...rest}
>
  <div class="kit-virtual-list-spacer" style:height="{count * rh}px">
    <div class="kit-virtual-list-window" style:transform="translateY({range.start * rh}px)">
      {#each rows as i (i)}
        <div
          class="kit-virtual-list-row"
          id="{uid}-{i}"
          role={listbox ? 'option' : 'listitem'}
          aria-selected={listbox ? i === sel : undefined}
          aria-setsize={count}
          aria-posinset={i + 1}
          data-index={i}
          data-active={i === sel || undefined}
          style:height="{rh}px"
        >
          {@render row?.(items[i], i)}
        </div>
      {/each}
    </div>
  </div>
</ScrollArea>

<style>
  :global(.k-virtual-list > .k-scroll-viewport[data-has-active]:focus-visible) { box-shadow: none; }
  .kit-virtual-list-spacer { position: relative; contain: strict; width: 100%; }
  .kit-virtual-list-window { position: absolute; top: 0; left: 0; right: 0; will-change: transform; }
  .kit-virtual-list-row {
    position: relative; display: flex; align-items: center; gap: var(--space-4);
    padding: 0 var(--space-4) 0 var(--space-5); overflow: hidden; white-space: nowrap;
    color: var(--tx); cursor: default; user-select: none;
  }
  .kit-virtual-list-row:hover { background: var(--bg-hover); }
  .kit-virtual-list-row[aria-selected='true'] { background: var(--sel-bg); color: var(--tx-hi); }
  .kit-virtual-list-row[aria-selected='true']:hover { background: var(--sel-bg-hover); }
  :global(.k-virtual-list .k-scroll-viewport:focus-visible) .kit-virtual-list-row[data-active]::before {
    content: ''; position: absolute; left: 0; top: 2px; bottom: 2px; width: 2px; background: var(--focus);
  }
</style>
