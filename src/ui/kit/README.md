# Pawscript UI kit (`src/ui/kit`)

Design tokens and reusable Svelte 5 components for every Pawscript surface. A sibling of Phosphor's
look (`PROVENANCE.md`): dark by default, square 2 px corners, hairline frames, Chakra Petch for words and
Martian Mono (tabular) for numbers, pink focus/selection (`--highlight`), blue active state (`--reality`).

```js
import { Button, IconButton, NumberField, Icon, tooltip } from '../ui/kit/index.js'; // also imports theme.css
```

Status: **everything below is published** (exported from `index.js`; API frozen: add props, never rename or
remove). Each family's full reference — every prop, callback, keyboard map, example — is in `docs/`:
[buttons](docs/buttons.md) · [fields](docs/fields.md) · [paramform](docs/paramform.md) · [menus](docs/menus.md) ·
[overlays](docs/overlays.md) · [data](docs/data.md) · [chrome](docs/chrome.md) · [icons](docs/icons.md) ·
[gallery](docs/gallery.md). The tables in §3 are the summary; the docs win where they say more.

Import from `index.js`, or a component file directly (`../ui/kit/Button.svelte`). Svelte's compiled
components carry module-level side effects (event delegation), so a bundler keeps every component re-exported
by `index.js` unless told the kit is side-effect free. Measured (vite lib build, minified): one `Button` via
`index.js` = 38 KB JS + all 112 KB kit CSS by default; with the rule below, 26 KB JS + theme and button CSS
only. Recommended for `vite.config.js` (shell agent; affects only `src/ui/kit/`):

```js
build: { rollupOptions: { treeshake: {
  moduleSideEffects: (id) => !id.includes('/src/ui/kit/') || /\.css($|\?)|type=style|\/kit\/index\.js$/.test(id),
} } },
```

The gallery: `npx vite --port 5181 --strictPort`, open `/dev/kit.html` (full gallery) or
`/dev/kit.html?demo=buttons` (one family). Add `&theme=light|contrast`, `&density=compact|comfortable`.

---

## 1. Tokens (`theme.css`)

Load once (index.js imports it). Theme: `data-theme="light" | "contrast"` on `<html>` or any subtree
(`setTheme(id)`); none = dark. Density: `data-density="compact" | "comfortable"` (`setDensity`).
Reduced motion: the OS setting or `data-motion="reduce"` zeroes every duration.

| Group | Tokens |
|---|---|
| Surfaces (low → high) | `--bg-sunken` (lanes, inputs, video well) · `--bg` (page, panels) · `--bg-raised` (top/status bars, panel heads) · `--bg-card` (cards, popovers, dialogs) · `--bg-hover` · `--bg-active` · `--bg-overlay` · `--scrim` |
| Lines | `--line-0..4` hairlines (decoration, dividers; 1 = default divider, 2 = button frame, 4 = hover frame) · `--line-ctl` a control's own boundary (3:1) · `--line-ctl-hover` |
| Text | `--tx-hi` titles/focused values · `--tx` body · `--tx-val` numerals at rest · `--tx-mut` labels, hints, shortcuts (4.5:1) · `--tx-ghost` **disabled/decorative only** · `--tx-faint` watermarks, never text |
| Accent | `--reality` / `--accent` active, on, primary · `--accent-ink` accent as text · `--on-accent` glyph on an accent fill · `--intent` pending, ghost · `--highlight` / `--focus` focus ring, selection, playhead · `*-rgb` triples for tints |
| Semantic | `--ok` `--warn` `--bad` `--info` (fills, tints) and `--ok-ink` `--warn-ink` `--bad-ink` `--info-ink` (text, icons, meaning-bearing frames) |
| Selection | `--sel-bg` `--sel-bg-hover` `--sel-line` (selected rows), `--text-sel` |
| Series | `--series-{sky,orange,green,yellow,blue,vermilion,pink,grey,violet,lime}`; `SERIES` in tokens.js (store the key, not a hex; entries 9+ draw dashed) |
| Elevation | `--shadow-1` (tooltip) `--shadow-2` (popover, menu) `--shadow-3` (dialog) · `--recess` (inset for sunken fields) · `--glow-reality` `--glow-highlight` `--glow-bad` |
| Focus | `--ring-w` (2px; 3px in contrast) `--ring-offset` · `--bw` border width |
| Shape | `--radius` 2px (everything; the instrument look is square) · `--radius-pill` for deliberate pills and round-ended bars |
| Space | `--space-1..8` = 2 4 6 8 12 16 24 32 px · `--pad-x` (inside a control) · `--gap` (between controls) |
| Type | `--font` `--mono` `--font-head` · `--fs-1..7` = 11 12 13 14 16 20 28 px · `--fs-ui` (control text; 12px compact) · `--lh` `--lh-tight` · `--caps-track` · `--label-case` · `--num-wght` |
| Density | `--ctl-h` 26 (22 compact, 30 comfortable) · `--ctl-h-sm` · `--ctl-h-lg` · `--row-h` 24 (menu/list/table rows) |
| Layers | `--z-raised` `--z-sticky` `--z-overlay` `--z-drag` `--z-popover` `--z-toast` `--z-tooltip` (floating things use the browser top layer first) |
| Motion | `--t-quick` 120ms (colour, border) `--t-move` 200ms (position, size) `--t-slow` 320ms · `--ease-out` · `--ease-settle` |

Shared global classes: `.k-sr` (visually hidden), `.k-num` (tabular mono numerals), `.k-caps` (small caps
label), `.k-hint`, `.k-sep` (toolbar separator; `data-orient="h"` for menus), `.k-scroll` (thin
scrollbars), `.k-ring` (standard focus ring), `.k-brackets` (Phosphor corner brackets), `.k-pop` (floating
surface), `.k-item` (menu/listbox row: columns check · icon · label · keys · chevron; `data-active`,
`aria-disabled`, `aria-selected`), `.k-item-label` `.k-item-hint` `.k-item-keys`, `.k-menu-sep`,
`.k-menu-sec`, `.k-tip`.

**Public vs internal class names.** Public, frozen, safe to target from feature CSS: every component's root
class `k-<name>` (`k-button`, `k-section`, …), the shared globals above, and these parts:
`k-button-label`, `k-chip-label`, `k-dialog-body`, `k-empty-state-icon`, `k-number-field-unit`,
`k-section-body`, `k-param-form-loose`, `k-item*` rows; the custom property `--icon-stroke` (an Icon's
stroke in viewBox units) and `--field-label-w`. Everything else inside a component is internal and prefixed
`kit-` (`kit-tab`, `kit-pf-row`, …): it may change at any time, and host stylesheets must never use the
`k-`/`kit-` prefixes. Internal parts are additionally scoped by Svelte, so a host's bare `.label` or `.title`
rule cannot reach into a kit component. Prefer the component's props (`grow`, `full`, `size`,
`actionsVisible`) and data attributes (`[data-key]`, `[data-kind]`, ARIA roles) over styling internals.

Measured contrast: `node test/kit-theme.test.mjs --report`.

### Do / don't
- Never hard-code a colour, size, radius, duration or shadow in a component: use a token.
- `--tx-ghost` is never a label. Disabled controls use `opacity: .45` (Phosphor) and `cursor: not-allowed`.
- `--warn`/`--bad` are fills; their text and meaning-bearing borders use `--warn-ink`/`--bad-ink`.
- Hairlines (`--line-1/2`) separate; `--line-ctl` frames anything you type into or toggle.
- Canvas: read tokens with `cssVar('--series-sky')` and re-read in `onThemeChange()`.
- Over the picture, and every Popover: `background: var(--glass); backdrop-filter: var(--glass-blur)` (see-through,
  opaque in contrast). The picture's own surroundings: `--media-bg`, `--media-scrim`, `--on-media` (the same in every theme).
- One control size per toolbar row (`size="sm"` in the transport and the lane toolbar). test/ui-uniform.test.mjs holds it,
  and holds the files with literal colours or raw `<button>`s to their current count.
- No key handling outside the component's own element; app shortcuts belong to the command registry.

---

## 2. Component conventions (all components follow these)

- **Files**: one component per `PascalCase.svelte` file in `src/ui/kit/`; pure helpers in `.js` with
  node tests in `test/kit-*.test.mjs`. Root element has class `k-<kebab-name>`; styles are scoped.
- **Props**: `$props()` with defaults; `class` is accepted and appended; remaining props (`...rest`:
  `id`, `aria-*`, `data-*`, `style`) are spread onto the root (or the native control for inputs).
- **Bindable state** uses the natural name: `value`, `checked`, `pressed`, `open`, `selected`,
  `expanded`, `size`, `collapsed`. Always `$bindable()`; the component also works uncontrolled.
- **Callbacks** are lowercase props with the value first, the DOM event second (optional):
  `onchange(value, e)` on every user change (live, while dragging too), `oncommit(value)` once when a
  gesture ends (pointer up, Enter, blur — use it for undo entries), `onselect(item)`, `onclose()`,
  `onactivate(item)` (double-click / Enter on a row). Never `on:` directives (Svelte 5).
- **Sizes**: `size = 'sm' | 'md' | 'lg'` → height `--ctl-h-sm` / `--ctl-h` / `--ctl-h-lg`; text `--fs-ui`
  (sm: `--fs-2`). Density is a token change, never a prop.
- **Labels**: every control takes `label`. When there is no visible label (icon-only) it becomes
  `aria-label`; `IconButton` requires it. Long labels ellipsize (`min-width: 0`, `text-overflow`), never wrap
  a control's height.
- **Tooltips**: buttons accept `tip` and `shortcut`; elsewhere use `{@attach tooltip(text, shortcut)}`.
  An IconButton's tip defaults to its label.
  Never a native `title=`: WebView2 draws its own OS tooltip for it and leaves it up after the pointer goes.
  test/no-native-title.test.mjs fails on one in `src/**/*.svelte`; dev/test builds strip any that appears at
  runtime and warn. A closed popover is never painted (theme.css `[popover]:not(:popover-open)`).
- **States** (identical everywhere):
  - rest: frame `--line-2` (buttons) or `--line-ctl` (fields, boxes, tracks); text `--tx`
  - hover: frame `--line-4` / `--line-ctl-hover`; ghost controls get `--bg-hover`
  - pressed (`:active`): frame and text `--highlight` (Phosphor)
  - on / selected / primary: frame and text `--reality`, fill `rgba(var(--reality-rgb), .12)` where it
    needs weight; `box-shadow: var(--glow-reality)` only on primary hover and Switch-on
  - focus: buttons and boxes `outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset)`
    on `:focus-visible` only, and never after a pointer press (`html[data-input='pointer']`, focus.js
    `trackInputModality`, clears `--focus` on the focused control); text inputs `border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus)`
    on `:focus` (no outline); list/menu rows `[data-active]` (left 2px `--focus` bar + `--bg-hover`)
  - invalid: frame `--bad-ink`, message below in `--bad-ink`
  - disabled: `opacity: .45; cursor: not-allowed`, no hover change
- **Fields** (TextField, NumberField, Select button, ComboBox): `--bg-sunken` fill, `--line-ctl` frame,
  `box-shadow: var(--recess)`, text `--tx-val` at rest and `--tx-hi` focused; numbers in `.k-num`.
- **Motion**: transitions only on `color, background-color, border-color, box-shadow, opacity` at
  `var(--t-quick) var(--ease-out)`; size/position only for expand/collapse at `--t-move`. No layout shift:
  states never change a box's size (loading keeps the label's width).
- **Floating**: `float(el, anchor, { placement, offset, matchWidth })` + `dismiss(el, close, [anchor])` from
  position.js; the element carries `class="k-pop"` and lives inside the component's DOM (it inherits the
  theme of its subtree; `showPopover` lifts it to the top layer — no portals). Focus returns to the anchor
  on close.
- **Keyboard** (WAI-ARIA APG): lists and menus `nextIndex()` + `createTypeahead()`; roving tabindex for
  radio groups, segmented controls, tabs, toolbars, trees; Escape closes the innermost floating thing and
  is stopped there.
- **Icons**: `<Icon name size={16} />` only from `ICON_NAMES`; 16px in controls (14 in `sm`). Need a new
  glyph? Ask the kit owner; do not inline SVG.

---

## 3. API (contract)

Types: `Option = { value, label, icon?, hint?, disabled? }` · `MenuItem = { id?, label, icon?, shortcut?,
disabled?, checked?: boolean, type?: 'checkbox'|'radio', items?: MenuItem[], run?: () => void } | { separator:
true } | { section: 'Title' }` · `Tone = 'neutral'|'accent'|'ok'|'warn'|'bad'|'info'`.

### Buttons — `buttons` family
| Component | Props | Notes |
|---|---|---|
| `Button` | `variant='default'\|'primary'\|'danger'\|'ghost'`, `size`, `icon`, `iconRight`, `loading`, `disabled`, `type='button'`, `tip`, `shortcut`, `full` (width 100%), `onclick`, children | loading shows Spinner in place of the icon, `aria-busy` |
| `IconButton` | `icon` (req), `label` (req), `variant='ghost'\|'default'\|'primary'\|'danger'`, `size`, `pressed` (renders aria-pressed when not undefined), `tip`, `shortcut`, `disabled`, `onclick` | square `--ctl-h` |
| `ToggleButton` | `pressed` (bindable), `icon`, `label`, `variant='ghost'\|'default'`, `size`, `tip`, `shortcut`, `onchange(pressed)`, children | `aria-pressed`; icon-only when no children |
| `SegmentedControl` | `options: Option[]` (+`tip`), `value` (bindable), `size`, `label` (aria), `disabled`, `full`, `onchange(value)` | radiogroup, roving tabindex, arrows select |
| `Badge` | `tone`, `variant='soft'\|'solid'\|'outline'`, children | counts, states; `.k-num` for numbers |
| `Chip` | `selected` (bindable), `icon`, `color` (series key: swatch dot), `removable`, `disabled`, `onclick`, `onremove`, children | filter chips, tags |
| `Kbd` | `keys` ('Ctrl+Shift+Z'), `platform?` | one `<kbd>` per cap, chords separated |
| `Spinner` | `size=16`, `label='Loading'` | |
| `ProgressBar` | `value` (0..1, `null` = indeterminate), `tone`, `label`, `showValue` | role progressbar |
| `Skeleton` | `width`, `height`, `lines` | shimmer off under reduced motion |

Also: Button `grow` (takes the free space of a flex row; use it instead of a host `.grow` class, which the kit's own `flex` outranks), `label` (text without children), `pressed` (aria-pressed + on look); IconButton `tip=''` turns the tooltip off, `loading`; ToggleButton `onchange(pressed, e)`; SegmentedControl `iconOnly`; Badge `num` (mono numerals, no caps); Chip `label`, `onchange(selected)`; a Chip is a toggle when `selected` is defined, a button with `onclick`, else a static tag.

### Fields — `fields` family
| Component | Props | Notes |
|---|---|---|
| `Checkbox` | `checked` (bindable), `indeterminate`, `label`, `disabled`, `onchange(checked)`, children (label content) | native input, drawn box |
| `Switch` | `checked` (bindable), `label`, `disabled`, `onchange(checked)` | `role="switch"` |
| `RadioGroup` | `options`, `value` (bindable), `label`, `orientation='vertical'\|'horizontal'`, `disabled`, `onchange(value)` | native radios |
| `TextField` | `value` (bindable), `placeholder`, `icon`, `clearable`, `type='text'`, `invalid`, `size`, `disabled`, `readonly`, `oninput(value)`, `onchange(value)` (on Enter/blur), `onenter(value)`, `inputEl` (bindable) | |
| `NumberField` | `value` (bindable), `min`, `max`, `step=1`, `decimals?`, `unit`, `scrub=true`, `size`, `disabled`, `invalid`, `label`, `onchange(value)` (live), `oncommit(value)` | arrows ±step, Shift ×10, Alt ×0.1, PageUp/Down ×10, drag horizontally to scrub (pointer lock), Enter commits, Esc reverts, clamp + step snap (math.js) |
| `Slider` | `value` (bindable), `min=0`, `max=100`, `step=1`, `ticks` (number[] \| count \| true = every step), `label`, `format(v)`, `showValue`, `disabled`, `onchange`, `oncommit` | role slider; arrows, Shift ×10, PageUp/Down, Home/End |
| `RangeSlider` | `value` ([lo, hi], bindable), same as Slider + `minGap=0` | two thumbs, each a role slider |
| `Field` | `label`, `hint`, `error`, `inline` (label left, control right), `required`, `for?`, children(`{ id, describedby }`) | label in `--label-case` |
| `ColorSwatch` | `value` (series key, bindable), `palette=SERIES`, `label`, `inline` (grid, no popover), `size`, `onchange(key)` | button opens a swatch grid (arrow keys) |
| `ParamForm` | `schema: Param[]` (params.js), `values` (bindable), `compact`, `collapsible=true` (groups as Sections), `onchange(values, key)`, `oncommit(values, key)` | int/float/number → NumberField (`control:'slider'` → Slider), bool → Switch, choice → Select (`control:'segmented'` → SegmentedControl); per-field reset to default when changed |
| `CurveEditor` | `lines: [{pts, kind?: 'curve'\|'guide'\|'ghost', color?}]` (viewBox `W`×`H`), `handles: [{key, label, x, y, shape: 'dot'\|'vpill'\|'hpill'\|'diamond', axis: 'x'\|'y'\|'xy', text, value, min, max, step, toValue(x, y), color?}]`, `twins` (numeric fields), `showInputs` (bindable), `height`, `onpreview(key, v)`, `oncommit(key)`, `oncancel(key)` | direct manipulation (curve.js): a handle's shape is its drag axis; relative drag at half gain, Shift fine; preview on every move, one commit per release / key-up, Esc cancels; arrows 5 steps (Shift 1), PageUp/Down 20, Home/End; labels beside handles clear of the lines; numeric twins hidden until asked. The idiom of the owner's Phosphor pattern card |

Also: Checkbox/Switch/RadioGroup `size`; Checkbox `invalid`, `indeterminate` bindable; RadioGroup `name`; TextField `label`, `full`; NumberField `full`, `readonly`, `pxPerStep=4`, `inputEl` (a held arrow key = one `oncommit`; Esc reverts, then passes through so a dialog can close); Slider/RangeSlider `size`, `full`; Field children receive `{ id, describedby, labelledby }`, inline label column `--field-label-w`; ColorSwatch `showName`, `columns=5`, `disabled`. ParamForm: compact rows stack (label above) automatically below 250 px of form width (container query); slider rows share one number-column width so every slider is one length; write long labels short + `hint` ("Tolerance" + hint); `compact` defaults to true; a choice with 2–3 short options (choices × longest label ≤ 10 chars) becomes a SegmentedControl automatically, `control: 'select'` forces a Select, an explicit `segmented` that does not fit takes the row under its label; group reset reports `key` null.

### Menus and lists — `menus` family
| Component | Props | Notes |
|---|---|---|
| `Select` | `options` (Option[], or groups `{ label, options }`), `value` (bindable), `placeholder`, `size`, `label`, `disabled`, `invalid`, `full`, `onchange(value)` | button `role=combobox` + listbox popover; typeahead closed and open |
| `ComboBox` | `options`, `value` (bindable), `placeholder`, `allowCustom`, `filter(option, query)?`, `size`, `label`, `disabled`, `onchange(value)` | input + filtered listbox, `aria-activedescendant`, matched text emphasised |
| `Menu` | `items: MenuItem[]`, `open` (bindable), `anchor` (Element \| {x,y}), `placement='bottom-start'`, `onselect(item)`, `onclose()` | nested submenus, shortcut column, checkable items, typeahead |
| `ContextMenu` / `contextMenu(items \| (e) => items)` attachment, `showContextMenu(e, items, { onselect })` | right-click or Shift+F10 / ContextMenu key | |
| `MenuBar` | `menus: { label, items: MenuItem[] }[]`, `onselect(item)` | arrows between menus, hover switches while one is open |

Also: an item's `icon` may be a kit name or a custom glyph `{ path }` / `{ fill }` (+ optional `viewBox`) — so may every `icon` prop in the kit (Icon `name`). An open Menu sets `aria-expanded="true"` on an Element anchor that does not manage it itself, and tooltips never show on an expanded trigger. Focus stays on the Select button / ComboBox input / menu panel, the keyboard row is `aria-activedescendant` + `data-active`. Select sizes to its widest option (like a native select; `full` = 100%). ComboBox `invalid`, `full` (no option groups). Menu `offset=2`, `initial='auto'|'first'|'last'|'none'`, `label`, `onclose(reason)` with reason `'select'|'escape'|'tab'|'outside'`; a leaf closes the menu, then runs `item.run()`, then `onselect`; checked state is the consumer's to flip. `showContextMenu(at, items, { onselect, onclose, source })` returns `close()`.

### Overlays — `overlays` family
| Component | Props | Notes |
|---|---|---|
| `Popover` | `open` (bindable), `anchor` (Element), `placement`, `label`, `onclose`, children; or `trigger` snippet (`{ props }` to spread on your button) | non-modal dialog, outside click / Esc close |
| `Dialog` | `open` (bindable), `title`, `size='sm'\|'md'\|'lg'`, `dismissible=true`, `onclose(reason)`, children, `footer` snippet | native `<dialog>` modal, focus trap, Esc, corner brackets |
| `confirm({ title, message, confirmLabel, cancelLabel, danger })` → `Promise<boolean>` | | mounts a Dialog |
| `toast(message, { kind: Tone, timeout=4000, action?: { label, run } })` → id; `dismissToast(id)`; `ToastHost` (mount once) | | aria-live; errors stay until dismissed |

Also: Popover `title`, `offset=6`, `id` (with no `anchor` it anchors to the element whose `aria-controls` is its id), `onclose(reason)`. Dialog `footer` snippet receives `{ close }`; `onclose(reason)` only on user closes; `message`, `actions` (data-driven footer), `modal=false` renders in place, `passKeys` lets a modal's keydowns reach `window` (by default none do). confirm() with `danger` starts on Cancel. `toasts` (the list) and `pauseToasts(on)` are exported; ToastHost `items`, `inline` for static previews.

### Layout and data — `data` family
| Component | Props | Notes |
|---|---|---|
| `SplitPane` | `direction='horizontal'\|'vertical'`, `size` (bindable px of first pane), `defaultSize`, `min=80`, `max`, `minOther=80`, `collapsible`, `collapsed` (bindable), `onresize(size)` (persist), snippets `first`, `second` | double-click splitter resets, Enter toggles collapse, arrows ±8 (Shift ±40) |
| `Splitter` | `orientation`, `value`, `min`, `max`, `label`, `onresize`, `onreset`, `ontoggle` | the separator alone, for custom layouts |
| `ScrollArea` | `orientation='vertical'\|'horizontal'\|'both'`, `shadows=true`, children; `el` (bindable) | thin scrollbars, edge shades when scrollable |
| `VirtualList` | `items`, `rowHeight` (px), `overscan=6`, `row` snippet `(item, index)`, `selected`?, `scrollToIndex(i)` (export) | fixed rows, smooth at 100 000 |
| `Tree` | `nodes: { id, label, icon?, children? }[]`, `expanded` (bindable Set), `selected` (bindable id), `row?` snippet, `onactivate(node)` | WAI tree keys |
| `DataTable` | `columns: { key, label, width?, align?, sortable?, format?(v,row), cell? snippet }[]`, `rows`, `rowKey='id'`, `sort` (bindable `{ key, dir }`), `selected` (bindable Set), `multiple=true`, `rowHeight`, `onactivate(row)`, `empty` snippet | sticky header, virtualized, click / Ctrl / Shift selection, arrow keys |

Also: `rowHeight` defaults to `--row-h` (re-read on theme/density change). SplitPane `primary='first'|'second'` (which pane keeps its size on window resize), `oncommit(size)`, a drag under half of `min` collapses. Splitter `reverse`, `step=8`, `bigStep=40`, `disabled`, `oncommit`; `orientation` is ARIA's ('vertical' = a line between columns). ScrollArea `viewport={…}` (attributes for the scrolling element). VirtualList `selected` (index → single-select listbox), `label`, `shadows`, `onselect`, `onactivate`. Tree `label`, `onselect`, `ontoggle(node, open)`. DataTable column `numeric`, `compare(a, b)`; `rowKey` may be a function; `onselect`, `onsort`, `overscan`, `label`, `scrollToIndex`; sort cycles asc → desc → off.

### Chrome — `chrome` family
| Component | Props | Notes |
|---|---|---|
| `Tabs` | `tabs: { id, label, icon?, badge?, disabled? }[]`, `value` (bindable), `size`, `label`, children(`activeId`) | roving, automatic activation |
| `Section` | `title`, `open` (bindable, true), `count`, `actions` snippet, children | collapsible group (accordion = stacked Sections) |
| `PanelHeader` | `title`, `icon`, `collapsed` (bindable, optional), `actions` snippet | panel head on `--bg-raised` |
| `Toolbar` | `label`, `orientation`, children | `role=toolbar`, arrows rove; `.k-sep` separators |
| `StatusBar` | children | `--bg-raised` row |
| `StatusItem` | `icon`, `tone`, `tip`, `onclick?`, children | button when clickable |
| `EmptyState` | `icon`, `title`, `description`, `actions` snippet | |

Also: Tabs `onchange(id)`, tab `badgeTone`, `overflow='menu'|'scroll'` (default menu: a trailing "More tabs" button lists every tab when the strip overflows; it also scrolls with edge fades); Section `actionsVisible='hover'|'always'` (hover mode also shows them whenever focus is inside the Section), and an open body never widens the Section (content shrinks; what cannot is clipped at the inline edges); Section `level=3`, `onchange(open)`, closed body is inert, a Section inside a Section takes the lighter sub-group voice; PanelHeader `controls` (aria-controls id), `level=2`, `onchange(collapsed)`; StatusBar `end` snippet (right group); EmptyState children.

Each family documents its components in `docs/<family>.md` (props, examples, keyboard).

---

## 4. Icons

158 glyphs on a 16-unit grid, 1.5 stroke, quarter-unit alignment so they rasterise crisply at 1x and 2x
(rules at the top of `icons.js`; every name with its meaning in [docs/icons.md](docs/icons.md); the review sheet
is `/dev/kit.html?demo=icons`, `&mode=grid` for the pixel grid). Names are frozen; aliases exist (`trash`,
`plus`, `minus`, `x`, `sliders`, `drag`). Highlights: transport (`play pause stop record step-back step-forward
skip-back skip-forward rewind fast-forward loop speed volume mute play-circle stop-circle`), edit (`undo redo
cut copy paste add remove delete duplicate pen pointer select move hand magnet magnet-off snap split flip
flip-h wand bolt brush eraser cursor-text`), script (`wave stroke smooth simplify normalize repeat-stroke
random axis keyframe bezier heart-rate ghost`), view (`zoom-in zoom-out zoom-fit eye eye-off lock unlock
maximize fullscreen exit-fullscreen expand collapse pip panel-left panel-right panel-bottom layers grid list
frame sun moon contrast`), timeline (`timeline chapters bookmark flag marker loop-in loop-out heatmap ruler
clock timer stopwatch history pin`), tracking/devices (`target roi crosshair film image device plug link
unlink bluetooth wifi usb battery power cpu gpu`), status (`info warning error success help check dot bell bug
log terminal`), files (`file folder folder-open save export import download upload refresh`), chrome
(`settings tune gear search filter close menu more more-v grip grip-h chevron-* chevrons-up-down arrow-*
keyboard command external hash percent`).

## 5. Verification

- `npm run check`: `kit-theme` (contrast of every token pair on every surface, all three themes; series
  palette distinct under protan/deutan/tritan simulation), `kit-logic` (placement, keyboard, typeahead,
  shortcuts, number maths, windowing, params), `kit-icons`, `kit-fields`, `kit-menus`, `kit-overlays`,
  `kit-data`, `kit-paramform`.
- `KIT_E2E=1 node --test test/kit-e2e.test.mjs`: real-browser checks (menus, menubar, tabs, slider,
  dialog focus trap, NumberField scrub, splitter, 100 000-row list).
- Gallery: `/dev/kit.html` (Consistency page measures every control's height per size; Editor mock).

## 6. Known rough edges

- Menu submenu grace is a timer, not pointer-direction prediction; no inline submenus for touch.
- Tree is not virtualized (fine to a few thousand visible nodes); DataTable's sticky header is one row.
- `⇧` in Kbd comes from a fallback font (Martian Mono lacks it).
- `magnet-off`, `layers`, `hand`, `usb` are dense at 16px; prefer a pressed/unpressed `magnet` toggle.
- Disabled controls in the contrast theme are dim by design (`opacity: .45`; WCAG exempts disabled).
