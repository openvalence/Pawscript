# Layout and data — `data` family

`SplitPane`, `Splitter`, `ScrollArea`, `VirtualList`, `Tree`, `DataTable`; pure helpers in `data.js`
(tested in `test/kit-data.test.mjs`). Demo: `/dev/kit.html?demo=data` (`&theme=light|contrast`,
`&density=compact|comfortable`).

Shared rules: rows are `--row-h` tall unless you pass `rowHeight` (so density works with no prop); the
selected row is `--sel-bg` (`--sel-bg-hover` under the pointer); the keyboard's row shows the 2 px
`--focus` bar only while the widget has `:focus-visible`; numbers sit in `.k-num`. Every root takes
`class` and spreads the other attributes (`id`, `aria-*`, `style`, `data-*`).

---

## SplitPane

Two panes and a splitter. `size` is the primary pane in px; the other pane takes the rest.

| Prop | Default | |
|---|---|---|
| `direction` | `'horizontal'` | `'horizontal'` side by side, `'vertical'` stacked |
| `size` | `defaultSize` | bindable; what the person asked for. What is drawn is held inside `min`/`max`/`minOther` (`clampSplit`), so the pane grows back when the window does |
| `defaultSize` | `240` | double-click resets to it |
| `min` / `max` | `80` / `Infinity` | the primary pane |
| `minOther` | `80` | the other pane |
| `primary` | `'first'` | **addition**: `'second'` sizes the second pane (a right sidebar, a bottom panel); it stays put as the window resizes |
| `collapsible` | `false` | Enter toggles; a drag under half of `min` closes it, past it reopens |
| `collapsed` | `false` | bindable; a closed pane is `inert` and clips (its content keeps its width, anchored to the outer edge) |
| `label` | `'Resize'` | the splitter's aria-label |
| `onresize(size, e?)` | | on every change, collapse included (read `collapsed` too) — persist here |
| `oncommit(size)` | | once per drag / key / reset |
| `first`, `second` | | snippets; each pane is a one-cell grid, a single child fills it |

The root needs a size from its parent (it is `width/height: 100%`). Only the snap open/closed animates
(`--t-move`); dragging is immediate.

```svelte
<SplitPane bind:size={side} bind:collapsed min={160} max={420} minOther={320} collapsible
           onresize={(px) => localStorage.setItem('side', JSON.stringify({ px, collapsed }))}>
  {#snippet first()}<ProjectPanel />{/snippet}
  {#snippet second()}
    <SplitPane direction="vertical" primary="second" bind:size={bottom} defaultSize={220} min={96}>
      {#snippet first()}<Timeline />{/snippet}
      {#snippet second()}<Problems />{/snippet}
    </SplitPane>
  {/snippet}
</SplitPane>
```

## Splitter

The separator alone, for custom layouts. One hairline (`--line-1`) in the layout; the hit area reaches
4 px past each side (10 px on coarse pointers) with `col-resize` / `row-resize` over all of it; a 3 px
`--highlight` band lights on hover (after `--t-quick`, so passing over does not flash), while dragging and on
keyboard focus. Pointer capture while dragging; during a drag the hit area covers the window, so the cursor
holds and nothing else hovers.

| Prop | Default | |
|---|---|---|
| `orientation` | `'vertical'` | the line's direction (ARIA): `'vertical'` sits between columns |
| `value` | `0` | bindable, px of the pane it resizes; `aria-valuenow` |
| `min` / `max` | `0` / `Infinity` | `aria-valuemin` / `aria-valuemax` (max only when finite) |
| `reverse` | `false` | **addition**: the resized pane comes after the splitter (dragging toward it shrinks it) |
| `step` / `bigStep` | `8` / `40` | **addition**: arrow and Shift+arrow steps |
| `label`, `disabled` | | |
| `onresize(v, e)` | | live (drag and keys) |
| `oncommit(v)` | | **addition**: end of a drag, each key |
| `onreset()` | | double-click |
| `ontoggle(e)` | | Enter (only handled when given) |

Keys: Left/Right (vertical) or Up/Down (horizontal) ±8, Shift ±40; Home → min, End → max; Enter → ontoggle.

## ScrollArea

A scroller with thin scrollbars and Phosphor's scroll recess: on each edge it can scroll toward, the
content fades into `--shade-surface` (default `--bg`; set it to the pane's surface). Shades use the same
2 px / 0.5 px hysteresis as Phosphor's `scrollshade.js` and follow content size changes.

| Prop | Default | |
|---|---|---|
| `orientation` | `'vertical'` | `'vertical' \| 'horizontal' \| 'both'` |
| `shadows` | `true` | |
| `el` | | bindable: the scrolling element (the root itself does not scroll) |
| `viewport` | `{}` | **addition**: attributes / handlers for the scrolling element (`role`, `tabindex`, `aria-*`, `onkeydown`) when it must carry them |
| children | | |

CSS hooks: `--shade-surface`, `--shade-size` (20px), `--k-shade-top` (inset the top shade below a sticky
header). Give it a height (or put it in a grid/flex cell that has one).

```svelte
<ScrollArea style="height: 240px; --shade-surface: var(--bg-card)">…</ScrollArea>
```

## VirtualList

Fixed-height rows; only the visible window plus `overscan` is in the DOM (≈ 20–26 rows for a 300 px list,
at row 0, 50 000 or 99 999 alike); the window is one `translateY` and rows are keyed by index, so
scrolling within a row renders nothing and crossing one adds/removes a row. Ceiling: the browser's maximum
element height (~33 M px), i.e. ~1.4 M rows at 24 px.

| Prop | Default | |
|---|---|---|
| `items` | `[]` | |
| `rowHeight` | `--row-h` | px; re-read on theme/density change |
| `overscan` | `6` | |
| `row` | | snippet `(item, index)`, rendered inside a flex row |
| `selected` | `undefined` | bindable **index** (`-1` none). Given → a single-select `listbox` with `aria-activedescendant`; omitted → a plain `list` |
| `label` | | aria-label |
| `shadows` | `true` | |
| `onselect(item, index, e)` | | |
| `onactivate(item, index, e)` | | Enter or double-click |
| `scrollToIndex(i)` | | export (`bind:this`): brings row i fully into view |

Keys (listbox): Up/Down, Home/End, PageUp/PageDown (a viewport less one row), Enter activates.

```svelte
<VirtualList items={actions} bind:selected bind:this={list} label="Actions" onactivate={(a) => seek(a.at)}>
  {#snippet row(a, i)}<span class="k-num">{clock(a.at)}</span> <span class="k-num">{a.pos}</span>{/snippet}
</VirtualList>
```

## Tree

WAI-ARIA tree with flat DOM (`aria-level`, `aria-setsize`, `aria-posinset`, `aria-expanded`), roving
tabindex, single selection that follows focus. Indent 16 px per level with a faint `--line-1` guide under
each ancestor's chevron; the chevron turns 90° at `--t-move`. Not virtualized (fine to a few thousand
visible nodes).

| Prop | Default | |
|---|---|---|
| `nodes` | `[]` | `{ id, label, icon?, children? }[]` |
| `expanded` | `new Set()` | bindable Set of ids (replaced, not mutated, on change) |
| `selected` | `null` | bindable id |
| `label` | | aria-label |
| `row` | | snippet `(node, { level, open, expandable, setsize, posinset })` replacing icon + label |
| `onselect(node, e)` | | **addition** |
| `onactivate(node, e)` | | Enter, double-click |
| `ontoggle(node, open)` | | **addition** |

Keys: Up/Down, Home/End, PageUp/PageDown; Right opens a closed branch, else moves to its first child; Left
closes an open branch, else moves to the parent; Enter activates; typing jumps to the next label that
starts with it (`createTypeahead`). Mouse: click selects, the chevron toggles, double-click toggles a branch
and activates.

```svelte
<Tree {nodes} bind:expanded bind:selected label="Project" onactivate={(n) => reveal(n.id)} />
```

## DataTable

`role="grid"`, sticky header on `--bg-raised` inside the scroller (it scrolls sideways with the body),
virtualized body (same windowing as VirtualList), a `--line-0` hairline between rows.

| Prop | Default | |
|---|---|---|
| `columns` | `[]` | see below |
| `rows` | `[]` | |
| `rowKey` | `'id'` | a key name or `(row) => key` |
| `sort` | `null` | bindable `{ key, dir: 'asc' \| 'desc' }`; the table sorts a copy (stable; empties last) |
| `selected` | `new Set()` | bindable Set of row keys (replaced on change) |
| `multiple` | `true` | |
| `rowHeight` | `--row-h` | |
| `label` | | aria-label |
| `empty` | | snippet shown under the header when there are no rows |
| `onactivate(row, e)` | | Enter, double-click |
| `onselect(selected, e)` | | **addition** |
| `onsort(sort)` | | **addition** |
| `scrollToIndex(i)` | | **addition**, export: row i in display order into view below the header |

Column: `{ key, label, width?, align?, numeric?, sortable?, compare?, format?, cell? }`.
`width`: a number (px), or any grid track (`'2fr'`, `'minmax(200px, 1fr)'`); none = `minmax(0, 1fr)`. The
table is at least the sum of the fixed widths and minmax minimums wide, then scrolls sideways.
`numeric` (**addition**): right-aligned `.k-num` in `--tx-val`; the sort arrow goes left of the label so the
label keeps the numbers' right edge. `compare(rowA, rowB)` (**addition**): ascending order for this column
(e.g. severity rank). `format(value, row)` → text; `cell` snippet `(row, value)` for anything else. Labels
are written in sentence case; CSS sets them in caps.

Sorting: the header buttons cycle ascending → descending → off; the sorted header has `aria-sort`.

Selection: click selects one; Ctrl/Cmd+click toggles; Shift+click selects from the anchor; Ctrl+Shift+click
adds the range. Keys: Up/Down, Home/End, PageUp/PageDown move and select (Shift extends from the anchor,
Ctrl moves the cursor only), Space selects the cursor row (Ctrl+Space toggles it), Ctrl/Cmd+A selects all,
Enter activates.

```svelte
{#snippet sev(r)}<Icon name={r.sev === 'warn' ? 'warning' : r.sev} label={r.sev} />{/snippet}
<DataTable label="Problems" rows={problems} bind:sort bind:selected onactivate={(p) => seek(p.at)}
  columns={[
    { key: 'sev', label: 'Severity', width: 96, align: 'center', sortable: true, compare: (a, b) => rank[a.sev] - rank[b.sev], cell: sev },
    { key: 'at', label: 'Time', width: 104, numeric: true, sortable: true, format: clock },
    { key: 'axis', label: 'Axis', width: 64, sortable: true },
    { key: 'msg', label: 'Message', width: 'minmax(200px, 1fr)', sortable: true },
  ]} />
```

## data.js

`selectRows(selected, keys, index, anchor, { toggle, range, multiple })` → `{ selected, anchor }` ·
`compareValues(a, b)` · `nextSort(sort, key)` · `sortRows(rows, sort, columns)` · `trackOf(width)` ·
`minWidthOf(columns)` · `flattenTree(nodes, expanded)` → `[{ node, level, setsize, posinset, parent,
expandable, open }]`.
