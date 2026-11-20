# Buttons family

`Button` `IconButton` `ToggleButton` `SegmentedControl` `Badge` `Chip` `Kbd` `Spinner` `ProgressBar` `Skeleton`.
Demo: `/dev/kit.html?demo=buttons` (`&theme=light|contrast`, `&density=compact|comfortable`, `&motion=reduce`).

All of them follow README §2. `class` is appended to the root. Any other prop (`id`, `aria-*`, `data-*`, `style`,
`title`) is spread onto the root element. Sizes `sm | md | lg` map to `--ctl-h-sm | --ctl-h | --ctl-h-lg`. Controls of
the same size have the same height, so a Button, IconButton, ToggleButton, SegmentedControl, TextField and Select
line up in a row.

States: rest frame `--line-2`. Hover frame `--line-4` (ghost: `--bg-hover`). Press (`:active`) frame and text
`--highlight` (ghost: text only, on `--bg-active`). On, pressed or selected: `--accent-ink` text on a reality tint, and
the reality frame on framed variants. Disabled: `opacity .45`. Focus: a `--focus` outline on `:focus-visible` only.

## Button

```svelte
<Button variant="primary" icon="export" loading={exporting} onclick={exportScript}>Export funscript</Button>
<Button variant="ghost" icon="play" tip="Play" shortcut="Space">Play</Button>
<Button iconRight="chevron-down">Speed 1×</Button>
```

| Prop | Default | |
|---|---|---|
| `variant` | `'default'` | `default` (hairline frame), `primary` (reality frame and text on a faint tint, glows on hover), `danger` (`--bad-ink`), `ghost` (no frame; the toolbar button) |
| `size` | `'md'` | `sm` uses `--fs-2` and 14px icons |
| `icon`, `iconRight` | `''` | icon names from `ICON_NAMES` |
| `label` | `''` | text to show when there are no children |
| `loading` | `false` | Spinner in place of `icon` (or centred over the hidden label when there is no icon). Sets `aria-busy`. The width does not change. Clicks are ignored; the button stays focusable |
| `disabled` | `false` | native `disabled` |
| `type` | `'button'` | |
| `tip`, `shortcut` | `''` | tooltip via `tooltip(tip, shortcut)`; also sets `aria-keyshortcuts` |
| `full` | `false` | width 100%; a long label ellipsizes |
| `pressed` | `undefined` | addition: renders `aria-pressed` and the "on" look when not undefined (used by IconButton and ToggleButton) |
| `onclick(e)` | | native click event |
| children | | the label |

A Button with an icon and no text is square (`--ctl-h` × `--ctl-h`). Give it an `aria-label`, or use IconButton.

Keyboard: native (Enter and Space activate). Disabled buttons are skipped by Tab.

### Layout props (added)

- `full`: width 100% (its own row). `grow`: takes the free space of a flex row (`flex: 1 1 0`, the label
  ellipsizes). Use these instead of a host class: the kit's own `flex: none` outranks a host `.grow`.
- The label span is the public part `k-button-label`.

## IconButton

```svelte
<IconButton icon="undo" label="Undo" shortcut="Ctrl+Z" onclick={undo} />
<IconButton icon="eye" label="Show heatmap" pressed={heatmap} onclick={() => (heatmap = !heatmap)} />
```

`icon` (required), `label` (required: `aria-label`, and the tooltip unless `tip` is given; `tip=''` turns the tooltip
off), `variant='ghost'|'default'|'primary'|'danger'`, `size`, `pressed`, `tip`, `shortcut`, `disabled`, `loading`,
`onclick(e)`. Square at the size's control height. Root class `k-button k-icon-button`.

## ToggleButton

```svelte
<ToggleButton icon="magnet" label="Snap to frames" shortcut="S" bind:pressed={snap} />
<ToggleButton variant="default" icon="loop" bind:pressed={loop}>Loop</ToggleButton>
```

`pressed` (bindable, default `false`), `icon`, `label`, `variant='ghost'|'default'`, `size`, `tip`, `shortcut`,
`disabled`, `onchange(pressed, e)`, `onclick(e)`, children. With no children and an icon it is icon-only: `label` becomes
`aria-label` and the default tooltip. With no children and no icon, `label` is shown as text. It always renders
`aria-pressed`. When pressed it gets reality text on a tint, plus a reality frame on `default`.

Keyboard: Enter or Space toggles.

## SegmentedControl

```svelte
<SegmentedControl label="Stroke axis" bind:value={axis}
  options={[{ value: 'L0', label: 'Stroke' }, { value: 'L1', label: 'Surge' }, { value: 'R0', label: 'Twist' }]} />
<SegmentedControl label="Tool" iconOnly bind:value={tool}
  options={[{ value: 'pointer', label: 'Select', icon: 'pointer', tip: 'Select (V)' }, { value: 'pen', label: 'Draw', icon: 'pen' }]} />
```

| Prop | Default | |
|---|---|---|
| `options` | `[]` | `{ value, label, icon?, tip?, disabled? }` |
| `value` | (bindable) | the selected option's `value`; when nothing matches, no segment is selected |
| `size` | `'md'` | |
| `label` | `''` | `aria-label` of the radiogroup (or pass `aria-labelledby`) |
| `disabled` | `false` | the whole control |
| `full` | `false` | 100% wide, equal segments, labels ellipsize |
| `iconOnly` | `false` | addition: square icon segments; each `label` becomes `aria-label` and the default tooltip |
| `onchange(value, e)` | | on every change, from a click or the keyboard |

The segments share one frame, separated by hairlines. The selected segment gets reality text, a tint and a reality
frame drawn over the hairlines.

Keyboard (radiogroup, roving tabindex): Tab enters on the selected segment (or the first enabled one) and leaves
with one more press. ← → ↑ ↓ move and select, wrapping and skipping disabled options. Home and End go to the first
and last.

## Badge

```svelte
<Badge tone="ok">Saved</Badge>  <Badge tone="warn">Modified</Badge>  <Badge tone="accent" variant="solid" num>12</Badge>
```

`tone='neutral'|'accent'|'ok'|'warn'|'bad'|'info'`, `variant='soft'|'solid'|'outline'`, `num` (addition: tabular mono
numerals, `.k-num`, without the caps voice), children. Badges are 16px tall, `--fs-1`, uppercase and tracked, and
ellipsize. `soft` is a tone tint with `-ink` text. `solid` is the tone fill with `--on-accent`; in the light theme the
ok and warn fills take the darkest ink instead, because white on them is under 4.5:1. `outline` is an `-ink` frame and
`-ink` text.

## Chip

```svelte
<Chip color="sky" bind:selected={showStroke}>Stroke</Chip>
<Chip removable label="beat" onremove={() => removeTag('beat')}>beat</Chip>
```

| Prop | |
|---|---|
| `selected` | bindable. When it is not `undefined`, the chip is a filter: a click toggles it, and it renders `aria-pressed` |
| `icon` | 14px icon |
| `color` | series key (`SERIES`): a swatch dot |
| `removable` | adds a × button (`aria-label` "Remove {label}") |
| `label` | names the chip for the × `aria-label`; it is shown if there are no children |
| `disabled` | |
| `onclick(e)` | makes the chip clickable even without `selected` |
| `onchange(selected, e)` | addition: after a toggle |
| `onremove(e)` | × clicked, or Delete / Backspace on a clickable chip |

`--ctl-h-sm` tall, `--fs-2`. When selected it gets the reality frame and text on a tint. A chip that is neither
selectable nor clickable is a static tag (a `<span>`).

Keyboard: a clickable chip is one tab stop. Enter or Space toggles or clicks it, and Delete or Backspace removes it.
The × is not a tab stop on a clickable chip; on a static removable tag the × is the tab stop. Removing a chip
destroys its focus target, so move focus to a neighbour in `onremove` if the list stays open.

## Kbd

```svelte
<Kbd keys="Ctrl+Shift+Z" />   <Kbd keys="Ctrl+K Ctrl+S" />   <Kbd keys="Ctrl+S" platform="mac" />
```

`keys` is a shortcut string in the command registry's syntax. `platform` (`'pc'|'mac'`) defaults to the running
platform. The output is `<kbd class="k-kbd">` with one inner `<kbd>` per cap (keys.js `formatShortcut`), and chords
are separated by a thin space. Each cap is 16px, `--fs-1` mono on `--bg-raised`, with a `--line-2` frame and a heavier
`--line-3` bottom edge.

## Spinner

```svelte
<Spinner />   <Spinner size={12} label="" />
```

`size=16` (px), `label='Loading'` (`role="img"` + `aria-label`; `''` makes it decorative). It is a 1.5px arc in
`currentColor` over a 20% track, and one turn takes `--t-slow` × 2.5. Under reduced motion the arc is static.

## ProgressBar

```svelte
<ProgressBar value={done / total} label="Exporting funscript" showValue />
<ProgressBar value={null} label="Analysing video" />
```

`value` takes 0..1 (clamped), or `null` for indeterminate. `tone='accent'` also accepts any Tone. `label` is shown
above the track and is also the `aria-label`. `showValue` adds a `.k-num` percentage at the right. The track is 3px
of `--line-2`, and the bar is 100% wide. It renders `role="progressbar"` with `aria-valuenow` from 0 to 100, which is
omitted when indeterminate. The indeterminate bar is a third-width sweep; under reduced motion it holds still in the
centre.

## Skeleton

```svelte
<Skeleton width={160} height={90} />   <Skeleton lines={3} width="60%" />
```

`width='100%'` and `height` take px numbers or CSS lengths. The default height is `--ctl-h`, or 12px per line.
`lines` draws N text bars with the last one at 60%. The shimmer stops under reduced motion. Skeletons are
`aria-hidden`, so put `aria-busy="true"` on the region that is loading.
