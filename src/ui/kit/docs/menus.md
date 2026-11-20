# Menus family

`Select`, `ComboBox`, `Menu`, `ContextMenu` / `contextMenu()` / `showContextMenu()`, `MenuBar`.
Demo: `/dev/kit.html?demo=menus` (add `&theme=light|contrast`, `&density=compact|comfortable`).

Shared rules:
- **Focus never moves onto a row.** It stays on the Select button, the ComboBox input or the menu panel
  (`role=menu`, `tabindex=-1`); the keyboard's row is `aria-activedescendant` and carries `data-active`
  (the `--focus` bar + `--bg-hover`). The pointer moves the same active row.
- Every floating box is a `.k-pop` placed by `float()` and closed by `dismiss()` (outside pointerdown,
  window blur). Escape closes the innermost box and is stopped there (an enclosing Dialog stays open).
  Focus returns to the anchor (or to what had focus, for a point-anchored context menu).
- Rows are `.k-item`: check (radio items: dot) · icon · label · shortcut (`shortcutText()`, or an
  option's `hint`) · submenu chevron. The icon column appears only when an item in the tree has an icon,
  and a whole menu tree shares that choice, so columns line up across submenus.
- Types (README §3): `Option = { value, label, icon?, hint?, disabled? }`;
  `MenuItem = { id?, label, icon?, shortcut?, tip?, disabled?, checked?, type?: 'checkbox'|'radio', items?, run?, command? }
  | { separator: true } | { section: 'Title' }`. `tip`: the kit tooltip on the row (keep the label to a few words,
  the explanation goes here). `command`: the app command the row runs, rendered as `data-command` (see `contextExtras`).

## Select

| Prop | Default | |
|---|---|---|
| `options` | `[]` | `Option[]`, or groups `{ label, options: Option[] }` (section titles) |
| `value` | — | bindable; compared with `===` |
| `placeholder` | `'Select…'` | shown in `--tx-mut` when no option matches `value` |
| `size` | `'md'` | `'sm' \| 'md' \| 'lg'`: `--ctl-h-sm/--ctl-h/--ctl-h-lg`, same box as TextField and Button |
| `label` | — | `aria-label` of the button and listbox (wrap in `Field` for a visible label; `id` etc. go to the button) |
| `disabled`, `invalid`, `full` | `false` | `full` = width 100% (default: as wide as the widest option, like a native select) |
| `onchange(value, e)` | | only on a real change |

Keyboard (button focused): Enter / Space / ArrowDown / ArrowUp open with the selected option active and
scrolled into view (centred). Typing while **closed** changes the value like a native select (typeahead,
repeat a letter to cycle). Open: arrows, Home/End, PageUp/PageDown, typeahead move; Enter/Space choose;
Escape closes; Tab takes the active option and moves on (APG). Listbox is at least the button's width and
at most 12 rows tall (it scrolls), and flips above near the bottom edge.

```svelte
<Select options={[{ value: 'frame', label: 'Video frames', hint: '30 fps' }, { value: 'beat', label: 'Beats' }]}
  bind:value={snap} label="Snap" onchange={(v) => history.push('snap', v)} />
```

## ComboBox

| Prop | Default | |
|---|---|---|
| `options` | `[]` | `Option[]` (hints show right-aligned, e.g. a shortcut) |
| `value` | — | bindable |
| `placeholder` | `''` | |
| `allowCustom` | `false` | typed text becomes the value on Enter / blur (an option's value when the text names one) |
| `filter(option, query)` | substring of label | matches; label-prefix matches are listed first |
| `size`, `label`, `disabled`, `invalid`, `full` | | as Select |
| `onchange(value, e)` | | |

Typing filters and makes the first match active (matched text emphasised). ArrowDown/ArrowUp open the
full list (Alt+ArrowDown opens without moving); arrows and PageUp/PageDown move; Home/End stay with the
caret. Enter chooses the active option (or commits custom text). Escape: open → closes and puts the
selected label back; closed → clears the text and the value (`null`, or `''` with `allowCustom`). Tab and
blur close. The chevron button opens the full list without taking focus.

```svelte
<ComboBox options={commands} bind:value={cmd} placeholder="Run a command…" label="Command"
  onchange={(id) => registry.run(id)} />
```

## Menu

| Prop | Default | |
|---|---|---|
| `items` | `[]` | `MenuItem[]`; `items` on an item makes a submenu (any depth) |
| `open` | `false` | bindable |
| `anchor` | — | an Element (the trigger) or a point `{ x, y }` |
| `placement` | `'bottom-start'` | place() placements; flips to the other side when short, and start/end flip at the viewport edge so the menu keeps an edge on its anchor |
| `offset` | `2` | px from the anchor |
| `initial` | `'auto'` | first active row: `'first' \| 'last' \| 'none'`; auto = first when opened from the keyboard, none from the pointer |
| `label` | — | `aria-label` of the panel |
| `onselect(item, e)` | | a leaf was chosen (after the menu closed and `item.run()` ran) |
| `onclose(reason)` | | `'select' \| 'escape' \| 'tab' \| 'outside'` |

The Menu does not toggle `checked` itself: flip it in `run` / `onselect` and pass new items. Disabled
items are skipped by the keyboard and ignore the pointer. Checkbox items are `menuitemcheckbox`, radio
items `menuitemradio`, with `aria-checked`; items with a shortcut get `aria-keyshortcuts`. The trigger
should carry `aria-haspopup="menu"` and `aria-expanded={open}`; a pointerdown on the anchor does not count as outside, so `onclick={() => (open = !open)}` toggles.

Keyboard: arrows, Home/End, PageUp/PageDown (disabled skipped, wraps); typeahead; Enter/Space activate
(a submenu row opens its submenu on the first row); ArrowRight opens a submenu, ArrowLeft / Escape close
the innermost submenu and return to its row; Escape at the top closes and focuses the anchor; Tab closes
and focus moves on from the anchor. Every other key stops at the open panel (an open menu is modal for the
keyboard), so digits or Ctrl chords never reach app shortcuts on `window` behind it.

Pointer: hovering a submenu row opens it level with that row (first rows aligned, frames sharing a
hairline), flipping to the left at the right edge. Moving to another row while a submenu is open waits
300 ms before switching, so a diagonal path into the submenu keeps it open.

```svelte
<Button aria-haspopup="menu" aria-expanded={open} onclick={(e) => { anchor = e.currentTarget; open = !open; }}>Point</Button>
<Menu bind:open {anchor} items={[
  { id: 'cut', label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', run: cut },
  { separator: true },
  { section: 'Show' },
  { label: 'Heatmap', type: 'checkbox', checked: heat, run: () => (heat = !heat) },
  { label: 'Generate', icon: 'wave', items: [{ label: 'Sine', run: sine }] },
]} />
```

### Custom glyphs (added)

An item's `icon` is a kit icon name or a custom glyph object: `{ path: 'M2.75 8h10.5' }` (stroked like the
set), `{ fill: '…' }`, both, and an optional `viewBox` (default `'0 0 16 16'`). Same for every `icon` prop in
the kit. An open Menu marks an Element anchor `aria-expanded="true"` (unless the anchor manages it) and
tooltips never show on an expanded trigger, so no hand-written tooltip suppression is needed.

## Context menus

- `{@attach contextMenu(items | (e) => items, { onselect, onclose })}` on any element: right-click opens at
  the pointer; Shift+F10 or the ContextMenu key opens beside the focused element (inside the top-left of
  a large one). An empty / null list lets the browser's own menu show. Pointer-opened menus start with no
  active row, keyboard-opened ones on the first.
- `showContextMenu(at, items, { onselect, onclose, source })` → `close()`: `at` is a MouseEvent (its
  default is prevented), a point `{ x, y }` or an Element. One context menu at a time; it mounts on
  `<body>` and copies `data-theme` / `data-density` from the element it opened from.
- `contextExtras((el) => items)` → `uninstall()`: entries that end every context menu opened from a right-click on `el`
  (after a separator), however its owner opens it; an element nothing else answers gets a menu of them alone. The app
  uses it once for its command entries on any `[data-command]` element (Quick menu, shortcut; `features/palette/quick.js`).
  A menu opened from inside an open `<dialog>` mounts in that dialog (outside a modal one the page is inert).
- `{@attach property(() => ({ value, default, set, reset?, format?, parse?, disabled?, more? }))}`: the element is a
  property. A right-click on or inside it (the innermost one wins) ends its menu with Reset to default (<default>), Copy
  value, Paste value and `more()`, before the `contextExtras` entries; one it lands in alone gets a menu of them (its
  input's native menu is prevented unless that input is being typed into). `propertyOf(el)`, `resetProperty(el)` (a
  reset button that is the same reset), `propertyEntries(handle)` (pure, tested). NumberField / Slider with a `default`,
  every ParamForm row and the app's `Prop` use it (docs/fields.md).
- `<ContextMenu items onselect onclose>…</ContextMenu>`: a `div.k-context-menu` with the attachment
  (rest props spread onto it, e.g. `tabindex="0"` so Shift+F10 can reach it).

```svelte
<canvas {@attach contextMenu((e) => laneItemsAt(e.clientX), { onselect: (it) => log(it.id) })}></canvas>
```

## MenuBar

| Prop | Default | |
|---|---|---|
| `menus` | `[]` | `{ label, items: MenuItem[] }[]` |
| `label` | `'Menu bar'` | `aria-label` |
| `onselect(item, e)` | | any leaf in any menu |

One tab stop (roving tabindex). Left/Right/Home/End move between top items; Down / Enter / Space open on
the first row, Up on the last. While a menu is open, ArrowLeft (top level) and ArrowRight (on a row
without a submenu) open the neighbouring menu; hovering another top item switches menus. Escape closes and
focuses the top item. Menus hang directly under the bar (`offset 0`).

```svelte
<MenuBar menus={[{ label: 'File', items: [{ id: 'open', label: 'Open…', shortcut: 'Ctrl+O', run: openFile }] }]}
  onselect={(it) => status(it.label)} />
```

## Helpers (`menus.js`, node-tested in `test/kit-menus.test.mjs`)

`flatOptions(options)`, `filterOptions(options, query, filter?)`, `splitMatch(label, query)`,
`treeHas(items, key)`, `isRow(item)`, `autoAlign(placement, anchorRect, width, viewportWidth, padding?)`;
DOM bits `on(type, fn)` (a native-listener attachment) and `reveal(list, row, center?)`.
