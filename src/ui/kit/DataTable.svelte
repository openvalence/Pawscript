<!--
  DataTable: sticky header, virtualized body, sortable columns, row selection.
  columns: { key, label, width? (px | '2fr' | 'minmax(…)'), align? ('left'|'right'|'center'), numeric?
  (right-aligned tabular numerals), sortable?, compare?(rowA, rowB), format?(value, row), cell? snippet
  (row, value) }[]
  <DataTable {columns} {rows} bind:sort bind:selected label="Problems" onactivate={(r) => seek(r.at)} />
  Click selects, Ctrl/Cmd toggles, Shift selects a range. Keys: Up / Down, Home / End, PageUp / PageDown
  (Shift extends, Ctrl moves without selecting), Space selects (Ctrl+Space toggles), Ctrl+A all, Enter
  activates. Header buttons sort: ascending, descending, off.
-->
<script>
  import ScrollArea from './ScrollArea.svelte';
  import Icon from './Icon.svelte';
  import { windowRange, scrollToRow, clamp } from './math.js';
  import { nextIndex, nextId } from './focus.js';
  import { cssVar } from './color.js';
  import { onThemeChange } from './tokens.js';
  import { selectRows, sortRows, nextSort, trackOf, minWidthOf } from './data.js';

  let {
    columns = [],
    rows = [],
    rowKey = 'id',
    sort = $bindable(null),
    selected = $bindable(new Set()),
    multiple = true,
    rowHeight,
    overscan = 6,
    label,
    empty,
    onactivate,
    onselect,
    onsort,
    class: cls = '',
    style = '',
    ...rest
  } = $props();

  const uid = nextId('dt');
  let el = $state();
  let scrollTop = $state(0), viewH = $state(0), tokenH = $state(24);
  let activeKey = $state(undefined), anchorKey = $state(undefined);

  const rh = $derived(rowHeight || tokenH);
  const keyOf = $derived(typeof rowKey === 'function' ? rowKey : (r) => r[rowKey]);
  const view = $derived(sortRows(rows, sort, columns));
  const keys = $derived(view.map(keyOf));
  const indexOf = $derived(new Map(keys.map((k, i) => [k, i])));
  const count = $derived(view.length);
  const active = $derived(indexOf.get(activeKey) ?? -1);
  const template = $derived(columns.map((c) => trackOf(c.width)).join(' '));
  const minW = $derived(minWidthOf(columns));

  const bodyH = $derived(Math.max(0, viewH - rh)); // the sticky header covers one row's height
  const first = $derived(Math.floor(scrollTop / rh));
  const range = $derived(windowRange(first * rh, bodyH, rh, count, overscan));
  const win = $derived.by(() => {
    const out = new Array(range.end - range.start);
    for (let i = 0; i < out.length; i++) out[i] = range.start + i;
    return out;
  });
  const activeId = $derived(active >= range.start && active < range.end ? `${uid}-${active}` : undefined);

  const alignOf = (c) => c.align ?? (c.numeric ? 'right' : 'left');

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

  /** Bring row i (display order) fully into view below the header. */
  export function scrollToIndex(i) {
    if (!el || !count) return;
    i = clamp(i, 0, count - 1);
    el.scrollTop = scrollToRow(i, el.scrollTop, el.clientHeight - rh, rh);
    scrollTop = el.scrollTop;
  }

  function apply(next, anchor, e) {
    selected = next;
    anchorKey = keys[anchor];
    onselect?.(next, e);
  }

  function pick(i, e, { toggle = false, range: rng = false } = {}) {
    const anchor = indexOf.get(anchorKey) ?? -1;
    const r = selectRows(selected, keys, i, anchor, { toggle, range: rng, multiple });
    activeKey = keys[i];
    apply(r.selected, r.anchor, e);
  }

  function click(e) {
    const rowEl = e.target.closest?.('[data-index]');
    if (!rowEl) return;
    pick(+rowEl.dataset.index, e, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey });
  }

  function key(e) {
    if (e.target !== el) return; // header buttons keep their own keys
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'a' || e.key === 'A') && multiple) {
      e.preventDefault();
      apply(new Set(keys), active >= 0 ? active : 0, e);
      return;
    }
    if (e.key === 'Enter' && active >= 0) { e.preventDefault(); onactivate?.(view[active], e); return; }
    if (e.key === ' ' && active >= 0) { e.preventDefault(); pick(active, e, { toggle: mod, range: e.shiftKey }); return; }
    if (e.altKey) return;
    const page = Math.max(1, Math.floor(bodyH / rh) - 1);
    const i = nextIndex(count, active, e.key, { loop: false, page });
    if (i === null) return;
    e.preventDefault();
    if (mod && multiple) activeKey = keys[i];      // move the cursor only
    else pick(i, e, { range: e.shiftKey });
    scrollToIndex(i);
  }

  function sortBy(c) {
    sort = nextSort(sort, c.key);
    onsort?.(sort);
  }
</script>

{#snippet header()}
  <div class="kit-data-table-tr kit-data-table-head" role="row" aria-rowindex={1}>
    {#each columns as c (c.key)}
      {@const dir = sort?.key === c.key ? sort.dir : null}
      <div
        class="kit-data-table-th"
        role="columnheader"
        data-align={alignOf(c)}
        aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        {#if c.sortable}
          <button type="button" class="kit-data-table-sort" data-sorted={dir || undefined} onclick={() => sortBy(c)}>
            <span class="kit-data-table-lbl">{c.label}</span>
            <span class="kit-data-table-arrow" aria-hidden="true">{#if dir}<Icon name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} />{/if}</span>
          </button>
        {:else}
          <span class="kit-data-table-lbl">{c.label}</span>
        {/if}
      </div>
    {/each}
  </div>
{/snippet}

<ScrollArea
  class="k-data-table {cls}"
  orientation="both"
  bind:el
  style="--k-cols: {template}; --k-min-w: {minW}px; --k-rh: {rh}px; --k-shade-top: {rh}px; {style}"
  viewport={{
    role: 'grid',
    tabindex: 0,
    'aria-label': label,
    'aria-rowcount': count + 1,
    'aria-colcount': columns.length,
    'aria-multiselectable': multiple || undefined,
    'aria-activedescendant': activeId,
    'data-has-active': active >= 0 || undefined,
    onkeydown: key,
    onclick: click,
    ondblclick: (e) => { const r = e.target.closest?.('[data-index]'); if (r) onactivate?.(view[+r.dataset.index], e); },
  }}
  {...rest}
>
  <div class="kit-data-table-table">
    {@render header()}
    {#if count}
      <div class="kit-data-table-body" style:height="{count * rh}px">
        <div class="kit-data-table-window" style:transform="translateY({range.start * rh}px)">
          {#each win as i (i)}
            {@const r = view[i]}
            <div
              class="kit-data-table-tr"
              role="row"
              id="{uid}-{i}"
              aria-rowindex={i + 2}
              aria-selected={selected.has(keys[i])}
              data-index={i}
              data-active={i === active || undefined}
            >
              {#each columns as c (c.key)}
                {@const v = r[c.key]}
                <div class="kit-data-table-td" role="gridcell" data-align={alignOf(c)} class:k-num={c.numeric}>
                  {#if c.cell}{@render c.cell(r, v)}{:else}<span class="kit-data-table-txt">{c.format ? c.format(v, r) : (v ?? '')}</span>{/if}
                </div>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    {:else if empty}
      <div class="kit-data-table-empty">{@render empty()}</div>
    {/if}
  </div>
</ScrollArea>

<style>
  :global(.k-data-table > .k-scroll-viewport[data-has-active]:focus-visible) { box-shadow: none; }
  .kit-data-table-table { position: relative; min-width: max(100%, var(--k-min-w)); width: 100%; }
  .kit-data-table-tr {
    position: relative; display: grid; grid-template-columns: var(--k-cols); align-items: center;
    height: var(--k-rh); padding-left: var(--space-2); white-space: nowrap; user-select: none; cursor: default;
    color: var(--tx);
  }
  .kit-data-table-head {
    position: sticky; top: 0; z-index: var(--z-sticky);
    background: var(--bg-raised); box-shadow: inset 0 -1px 0 var(--line-2);
  }
  .kit-data-table-th, .kit-data-table-td { min-width: 0; padding: 0 var(--space-4); overflow: hidden; text-overflow: ellipsis; }
  .kit-data-table-td { display: flex; align-items: center; gap: var(--space-3); height: 100%; }
  .kit-data-table-td > :global(*) { min-width: 0; }
  .kit-data-table-txt { overflow: hidden; text-overflow: ellipsis; }
  [data-align='right'] { text-align: right; justify-content: flex-end; }
  [data-align='center'] { text-align: center; justify-content: center; }
  .kit-data-table-td.k-num { color: var(--tx-val); }

  .kit-data-table-lbl {
    font-size: var(--fs-1); font-weight: 500; letter-spacing: var(--caps-track); text-transform: uppercase;
    color: var(--tx-mut); overflow: hidden; text-overflow: ellipsis;
  }
  .kit-data-table-th { display: flex; align-items: center; height: 100%; }
  .kit-data-table-sort {
    display: inline-flex; align-items: center; gap: var(--space-2); max-width: 100%; height: 100%;
    margin: 0; padding: 0; border: 0; background: none; color: inherit; cursor: pointer;
  }
  [data-align='right'] > .kit-data-table-sort { flex-direction: row-reverse; margin-left: auto; }
  [data-align='center'] > .kit-data-table-sort { margin: 0 auto; }
  .kit-data-table-arrow { flex: none; display: grid; place-items: center; width: 12px; color: var(--accent-ink); }
  .kit-data-table-sort:hover .kit-data-table-lbl, .kit-data-table-sort[data-sorted] .kit-data-table-lbl { color: var(--tx); }
  .kit-data-table-sort:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: calc(var(--ring-w) * -1); }

  .kit-data-table-body { position: relative; contain: strict; }
  .kit-data-table-window { position: absolute; top: 0; left: 0; right: 0; will-change: transform; }
  .kit-data-table-body .kit-data-table-tr { box-shadow: inset 0 -1px 0 var(--line-0); }
  .kit-data-table-body .kit-data-table-tr:hover { background: var(--bg-hover); }
  .kit-data-table-body .kit-data-table-tr[aria-selected='true'] { background: var(--sel-bg); color: var(--tx-hi); }
  .kit-data-table-body .kit-data-table-tr[aria-selected='true']:hover { background: var(--sel-bg-hover); }
  .kit-data-table-body .kit-data-table-tr[aria-selected='true'] .kit-data-table-td.k-num { color: var(--tx); }
  :global(.k-data-table > .k-scroll-viewport:focus-visible) .kit-data-table-tr[data-active]::before {
    content: ''; position: absolute; left: 0; top: 2px; bottom: 2px; width: 2px; background: var(--focus);
  }
  .kit-data-table-empty { padding: var(--space-7) var(--space-6); color: var(--tx-mut); text-align: center; }
</style>
