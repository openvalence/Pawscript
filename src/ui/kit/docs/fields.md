# Fields (`fields` family)

`Checkbox` `Switch` `RadioGroup` `TextField` `NumberField` `Slider` `RangeSlider` `Field` `ColorSwatch`.
Demo: `/dev/kit.html?demo=fields` (`&theme=light|contrast`, `&density=compact|comfortable`).
Pure helpers: `fields.js` (tested in `test/kit-fields.test.mjs`); all numbers go through `math.js`.

Shared rules (README §2): `size = 'sm'|'md'|'lg'` sets the height to `--ctl-h-sm` / `--ctl-h` / `--ctl-h-lg`, so a
TextField, NumberField, ColorSwatch, Button, Slider, Checkbox and Switch of one size line up in a row. `class` is
appended to the root; other props (`id`, `aria-*`, `data-*`, `title`) go to the native control (the input, the
slider thumb, the swatch button). `onchange(value, e)` fires on every change (live while dragging);
`oncommit(value)` fires once per gesture (pointer up, Enter, blur, release of a held key): use it for undo.

**Properties (Blender's rule: a value has a default, can be typed, reset, copied and pasted, and answers right click the
same way everywhere).** `NumberField` and `Slider` take an optional `default`. With one, a right click on the field
(Shift+F10 / the ContextMenu key on its focused control too) offers **Reset to default (<default>)** (off while it is at
the default), **Copy value** and **Paste value** (the system clipboard; the last Copy value when it says no), through
`contextmenu.js` `property()` — the same entries as a `ParamForm` row (whose reset dot runs that same reset) and the
app's settings (`app/Prop.svelte`, which adds Show in Settings and the Quick menu). Each is one gesture: `onchange` then
`oncommit`. A right click in a field being typed into keeps the native cut / copy / paste menu. Not done: Blender's
Backspace over a hovered field to reset (Backspace deletes points and groups app-wide: it would clash) and Ctrl+C / Ctrl+V
over a hovered field (copy / paste of points).

---

## Checkbox
| Prop | Default | |
|---|---|---|
| `checked` | `false` | bindable |
| `indeterminate` | `false` | bindable; a click clears it (native) |
| `label` / children | | text after the box (children win); ellipsizes |
| `disabled`, `invalid` | `false` | invalid = `--bad-ink` frame |
| `size` | `'md'` | |
| `onchange(checked, e)` | | |

Keys: Space toggles (native checkbox). The box is 14 px (12 in `sm`).
```svelte
<Checkbox bind:checked={snap} label="Snap to frames" />
<Checkbox bind:checked={all} bind:indeterminate={some}>All lanes</Checkbox>
```

## Switch
Props: `checked` (bindable), `label` / children, `disabled`, `size`, `onchange(checked, e)`. Native checkbox with
`role="switch"`; Space toggles. Track scales with density (26×14 default, 22×12 compact, 30×16 comfortable).
```svelte
<Switch bind:checked={loop} label="Loop playback" />
```

## RadioGroup
| Prop | Default | |
|---|---|---|
| `options` | `[]` | `Option[]` (`{ value, label, hint?, disabled? }`) |
| `value` | | bindable |
| `label` | | `aria-label` of the group (or pass `aria-labelledby`, e.g. from Field) |
| `orientation` | `'vertical'` | or `'horizontal'` (wraps) |
| `disabled`, `size`, `name` | | `name` is generated |
| `onchange(value, e)` | | |

Keys (native radios): Tab enters at the checked option, arrows move and select, skipping disabled ones, wrapping.
```svelte
<RadioGroup label="Interpolation" options={opts} bind:value={interp} orientation="horizontal" />
```

## TextField
| Prop | Default | |
|---|---|---|
| `value` | `''` | bindable |
| `placeholder`, `type` | `'text'` | |
| `icon` | | leading icon name (`search`) |
| `clearable` | `false` | × button when not empty; Escape clears too |
| `invalid`, `disabled`, `readonly` | `false` | readonly = hairline frame |
| `size`, `full` | `'md'`, `false` | 192 px wide by default; `full` = 100% |
| `label` | | `aria-label` when no Field labels it |
| `inputEl` | | bindable `<input>` |
| `oninput(value, e)` | | every keystroke |
| `onchange(value, e)` | | Enter or blur, only when the text changed |
| `onenter(value, e)` | | Enter |

Keys: Enter commits (`onchange` + `onenter`); Escape clears a clearable field (stopped there), else passes through.
```svelte
<TextField bind:value={q} placeholder="Search actions" icon="search" clearable oninput={filter} />
```

## NumberField
| Prop | Default | |
|---|---|---|
| `value` | `0` | bindable |
| `min`, `max` | `±Infinity` | clamp |
| `step` | `1` | keyboard / scrub step and snap grid |
| `decimals` | step's | display decimals (else the step's, one more after an Alt nudge) |
| `unit` | | suffix in `--tx-mut` at the right edge (`ms`, `×`, `%`) |
| `scrub` | `true` | drag to scrub |
| `pxPerStep` | `4` | scrub rate |
| `size`, `full`, `disabled`, `readonly`, `invalid`, `label`, `inputEl` | | width fits the widest value of [min, max] |
| `default` | | the value Reset to default restores (right click); none = no property menu |
| `onchange(value, e)` | | live (typing commits, nudges, scrubbing) |
| `oncommit(value)` | | once per gesture |

Pointer: at rest the field shows `ew-resize`. Press and drag sideways more than 3 px to scrub (`clientX`; no pointer lock, which the webview
announces with a "press Esc to show your cursor" banner), Shift ×0.1 fine, Ctrl snaps to round values, changing a
modifier mid-drag continues from the current value; past `min`/`max` the end becomes the new start so turning back
moves at once. One `oncommit` at release. A press without a drag focuses and selects the text. While focused, the
pointer edits text normally. The wheel does nothing (it belongs to timeline zoom).

Keys: ArrowUp/Down ±step (Shift ×0.1, Ctrl to the next round value), PageUp/PageDown ×10 — `onchange` per press, one `oncommit` when
the key is released. Typing then Enter or blur commits: `parseNumber` (accepts `1,5`, `−2`, `40 ms`), clamp, snap to
the step; unparseable text shows the invalid frame while typing and reverts. Enter keeps focus and selects the
text. Escape reverts typed text and keeps focus (stopped); with nothing typed it passes through (a dialog closes).
`role="spinbutton"` with `aria-valuenow/min/max`.
```svelte
<NumberField bind:value={speed} min={0.05} max={4} step={0.05} unit="×" label="Speed" oncommit={pushUndo} />
```

## Slider
| Prop | Default | |
|---|---|---|
| `value` | `0` | bindable |
| `min`, `max`, `step` | `0`, `100`, `1` | |
| `ticks` | | `number[]` values, a count (n evenly spaced, ends included), or `true` (every step; ends only past 200) |
| `label` | | thumb `aria-label` (or pass `aria-labelledby`) |
| `format(v)` | `formatNumber` | readout and `aria-valuetext` |
| `showValue` | `false` | readout on the right, width reserved for the widest value; click it to type |
| `default` | | the value Reset to default restores (right click); none = no property menu |
| `size`, `full`, `disabled` | | 192 px wide by default |
| `onchange(value, e)`, `oncommit(value)` | | |

Custom track (not a native range): 2 px rail in `--line-ctl`, `--accent` fill from `min` to the thumb, Phosphor's
rectangular thumb (9×16 default; `--bg` fill, `--tx-val` frame; dragging: `--highlight` frame + glow; keyboard
focus adds the kit ring). Positions are whole pixels. Pointer: a press on the track jumps there and drags; a press
on the thumb drags from where it is. Keys: Arrow Right/Up +step, Left/Down −step (Shift ×0.1, Ctrl to the next round value),
PageUp/PageDown ×10, Home/End; one `oncommit` per drag or key hold. Typing (with `showValue`, so a Slider alone is
enough and never needs a NumberField beside it): click the readout, or press Enter on the thumb; the readout becomes a
text field with the bare number selected; Enter or leaving it commits (`parseNumber`, clamp, snap; unparseable text
changes nothing), Escape cancels (stopped). One `onchange` + `oncommit`. The wheel does nothing here either.
```svelte
<Slider bind:value={smoothing} min={0} max={1} step={0.01} label="Smoothing" showValue />
```

## RangeSlider
As Slider, with `value = [lo, hi]` (bindable) and `minGap = 0`. Two thumbs, each `role="slider"` ("minimum" /
"maximum", with `aria-valuemin/max` limited by the other thumb). Thumbs never cross and stay `minGap` apart. A press
on the track moves the nearer thumb; a press where both thumbs overlap picks by the first move (left = low, right =
high). `id` goes to the low thumb; `aria-labelledby` / `aria-describedby` to both. Readout: `lo – hi`.
```svelte
<RangeSlider bind:value={range} min={0} max={100} minGap={5} label="Range" showValue ticks={11} />
```

## Field
| Prop | Default | |
|---|---|---|
| `label` | | `--fs-2`, 500, `--tx-mut`, `--label-case`; ellipsizes |
| `hint` | | below the control, `--tx-mut` |
| `error` | | below the control, `--bad-ink` with the warning icon (shown before the hint) |
| `inline` | `false` | label in a fixed left column (`--field-label-w`, default 96 px), control right |
| `required` | `false` | `*` and "(required)" for screen readers |
| `for` | generated | the control's id |
| children(`{ id, describedby, labelledby }`) | | put `id` + `aria-describedby` on the control; custom controls (Slider, RangeSlider, RadioGroup) also take `aria-labelledby` |

A label click focuses native controls (`<label for>`) and custom ones (slider thumb, checked radio).
Set the column on a container: `style="--field-label-w: 120px"`.
```svelte
<Field inline label="Offset" hint="Positive delays every action">
  {#snippet children({ id, describedby })}
    <NumberField {id} aria-describedby={describedby} bind:value={offset} unit="ms" full />
  {/snippet}
</Field>
<Field inline label="Smoothing">
  {#snippet children({ id, labelledby })}<Slider {id} aria-labelledby={labelledby} bind:value={s} full />{/snippet}
</Field>
```

## ColorSwatch
| Prop | Default | |
|---|---|---|
| `value` | | bindable series key (`'orange'`); store the key, never a hex |
| `palette` | `SERIES` | `{ key, label }[]` |
| `label` | `'Colour'` | names the button / grid |
| `showName` | `false` | the button shows the colour's name + chevron (else a square swatch button) |
| `inline` | `false` | the grid itself, no popover |
| `columns` | `5` | grid columns |
| `size`, `disabled` | | |
| `onchange(key, e)` | | |

Button: Enter / Space / click / ArrowDown opens the grid popover (`k-pop`, placed by `float()`, closed by
`dismiss()`), focused on the selected swatch. Grid: arrows move in 2D (no wrap), Home/End within the row, Enter /
Space / click picks (and closes), Escape closes and returns focus to the button, Tab closes and moves on, an outside
press closes. Inline grid: roving tabindex, the same keys, picking keeps it open. Swatches are `role="radio"`.
```svelte
<ColorSwatch bind:value={chapter.color} label="Chapter colour" showName />
<ColorSwatch bind:value={lane.color} label="Lane colour" inline />
```
