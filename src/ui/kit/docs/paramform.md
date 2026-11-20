# ParamForm

A form generated from a parameter schema (`params.js`). Generators, transforms and tracker settings
describe their parameters once; ParamForm draws them, keeps the values valid, and reports edits in a
shape that maps straight onto undo.

```svelte
<script>
  import ParamForm from '../ui/kit/ParamForm.svelte';   // or { ParamForm } from index.js once exported
  const schema = [
    { key: 'bpm',   label: 'Tempo', type: 'float', default: 120, min: 20, max: 300, step: 0.5, unit: 'bpm', group: 'Timing' },
    { key: 'wave',  label: 'Wave',  type: 'choice', default: 'sine', choices: ['sine', 'saw', 'square', 'bounce'], group: 'Shape' },
    { key: 'depth', label: 'Depth', type: 'int', default: 100, min: 0, max: 100, unit: '%', control: 'slider', group: 'Shape' },
  ];
  let values = $state({});
</script>

<ParamForm {schema} bind:values onchange={(v) => preview(v)} oncommit={(v) => history.push(v)} />
```

Gallery: `/dev/kit.html?demo=paramform` (three schemas; compact at 260, 220 (auto-stacked) and 380 px, stacked; live
values; event log).

## Props

| Prop | Default | |
|---|---|---|
| `schema` | `[]` | `Param[]` (below) |
| `values` | `{}` | bindable. Normalised with `normalizeValues` on mount, whenever the schema changes, and whenever an outside write leaves it incomplete or invalid (no events fire for that). Keys the schema does not know survive. Works unbound too. |
| `compact` | `true` | `true`: one row per param, the label left in a column shared by the whole form (side panels); below 250 px of form width the rows stack on their own (see Look). `false`: label above the control, hint printed under it, at every width. |
| `collapsible` | `true` | named groups render as `Section`s (open). `false`: a static caps head; same rhythm and closing hairline. The unnamed group always comes first, without a head. |
| `onchange(values, key)` | | every change, live (each scrub step, each arrow repeat, each slider move). |
| `oncommit(values, key)` | | once per finished edit: NumberField/Slider `oncommit` (Enter, blur, pointer up, key release), and every Switch, Select, segment and reset. Not fired when a gesture ends where it started, or for a blur with nothing typed. |
| `class`, `...rest` | | appended / spread on the root (`k-param-form`). |

`values` passed to the callbacks is the new object (also what `bind:values` now holds). `key` is the
param's key, or `null` for a group reset (several keys, one change, one commit).

## Schema (`Param`, params.js)

`{ key, label, type, default, min?, max?, step?, unit?, choices?, group?, hint?, control? }`

| Field | |
|---|---|
| `type` | `'float'`, `'number'`, `'int'`, `'bool'`, `'choice'` |
| `default` | the reset target, `coerce`d (an out-of-range default clamps) |
| `min`, `max` | clamp; a slider without them spans 0 to 100 |
| `step` | the edit grid; else `stepOf`: 1 for int, a power of ten near 1/100 of the range, else 0.01. Shown decimals follow the step. |
| `unit` | shown inside the number field (`ms`, `%`, `px`, `bpm`, `×`) |
| `choices` | `value[]` or `{ value, label }[]` |
| `group` | group name; groups appear in first-use order |
| `hint` | compact: in the label's tooltip and the control's accessible description (`aria-describedby`); stacked (and compact below 250 px): printed under the control |
| `control` | numbers: `'field'` (default) or `'slider'`. Choices: `'select'` or `'segmented'`. |

### Short label + hint

A compact row has room for 9–12 characters of label at 260 px (default to compact density). Write the label as the shortest noun that tells
params apart within the form, and put the full sense in `hint`:

```js
{ key: 'simplify', label: 'Tolerance', type: 'float', default: 0, min: 0, max: 10, step: 0.1, unit: '%', control: 'slider',
  hint: 'Simplify tolerance in % of the position range: points closer than this to the line are dropped.' }
```

The hint reaches everyone: the label's tooltip shows label + hint, assistive tech reads it as the control's
description, and stacked layouts print it under the control. The group name usually supplies the rest
("Tolerance" under "Simplify"). No separate short-label field exists or is needed.

Every stored value is `coerce`d: typing 3.7 into an int field stores (and shows) 4; 999 into a 0–300 field stores 300.

### Which widget (`controlOf` in `paramform.js`)

| Param | Widget |
|---|---|
| float / number / int | NumberField filling the control column (type, arrows, scrub) |
| `control: 'slider'` | Slider + NumberField side by side, one value; the field sits in a number column one width for the whole form, the slider takes the rest |
| bool | Switch at the row's right end (also in stacked forms, where the row is label-left) |
| choice with `control` | that control |
| choice, 2–3 choices, choices × longest label ≤ 10 characters (`SEGMENT_BUDGET`) | SegmentedControl (`L0 R0 R1`, `Box Point`, `Left Right`): all options visible, one click |
| any other choice | Select |

The budget is set by the longest label because SegmentedControl's `full` gives segments equal widths.
Force the Select with `control: 'select'` when a choice set will grow.

## Look

- Rows are `--ctl-h` tall with `--gap` between (stacked: `--space-5` between fields).
- The label column is 38% of the form's width, never so wide that the controls get less than 7 × `--ctl-h`,
  held between 3 and 7 × `--ctl-h`. It is resolved once on the form, so every row in every group shares it.
  Controls fill the rest, so they align at both edges; the reset slot is a fixed last column. A switch row
  gives its label everything but the switch and the reset slot.
- Slider rows: the number fields share one column width across the whole form (`numberColumnChars` in
  `paramform.js`: the widest slider param's value text from min/max/step, plus its unit and one character
  for the gap, in the field's own mono `ch`, plus the field's padding and frame). So every slider in a form
  has the same length and every number field ends on the same right edge as the Selects and NumberFields.
- Narrow: below **250 px** of form width (a container query on the form, `container: kit-pf`) compact rows
  stack like `compact = false`: label above the control (wrapping, never cut), control and reset below, the
  hint printed under the control; switch rows keep label left, switch right. Why 250: at default density
  the label column is already at its 3 × `--ctl-h` floor from 260 px down, so narrower forms only squeeze the
  controls (a slider would shrink to a stub); 250 keeps the 258 px content of a 260 px panel side by side
  and stacks the 200–240 px dock widths. Container queries cannot read tokens, so the threshold does not
  move with density (comfortable stays side by side, and tight, from 250 to 300 px).
- Labels: Field's voice (`--fs-2`, `--tx-mut`, `--label-case`), one line; a long label ellipsizes and its
  tooltip carries the full text (and the hint). Stacked, labels wrap instead. Clicking a label focuses its control (a Select does not
  open; a switch's label toggles it; a slider row focuses its number field).
- A value away from its default shows a 4 px `--accent-ink` dot in the reset slot. Hovering the row or
  tabbing onto it turns the dot into a reset button (`refresh`, tooltip "Reset to 120 bpm"); on touch
  screens the button shows outright. A group with any changed value gets a "Reset group" button in its head
  (Section shows head actions on hover / focus).
- Mount it flush in a panel: Sections span the full width; everything outside a Section takes a Section
  body's inset (`--space-4`), so the label column is one column.
- Widths: side by side, everything fits from 260 px at compact and default density, and from 300 px at
  comfortable. Below 250 px the form stacks (above); long Select values may still ellipsize.

## Keyboard

- Tab / Shift+Tab: control to control in schema order. A changed param's reset button is the stop right
  after its control. A Section's head (toggle, then "Reset group" when shown) comes before its rows.
- Each control keeps its own keys: NumberField ArrowUp/Down ±step (Shift ×10, Alt ×0.1), PageUp/Down ×10,
  Enter commits typed text, Escape reverts it; Slider arrows, PageUp/Down, Home/End; Switch Space;
  Select Enter/Space/ArrowDown opens, arrows + Enter pick, letters typeahead (also closed), Escape closes;
  SegmentedControl arrows / Home / End move and select.
- Reset buttons: Enter or Space. A held arrow is one commit when the key is released.

## Notes

- Keys the schema does not know are never dropped, so a preset written by a newer version round-trips.
- Two ParamForms bound to the same object stay in step (the gallery does this).
- `paramform.js` (`controlOf`, `sameValues`, `numberColumnChars`, `SEGMENT_BUDGET`) is tested in
  `test/kit-paramform.test.mjs`.
- Internal class names are `kit-pf-*` (`kit-pf-row`, `kit-pf-label`, `kit-pf-ctl`, …; the ungrouped block is the public `k-param-form-loose`) so a
  host stylesheet's bare `.label` or `.row` never reaches them. They are not API: style the root
  (`k-param-form`, `class`) or select rows by `[data-key]` / `[data-kind]` (stable).
- A host that switched `compact` off by its own width measurement (ToolCard: `compact={!narrow}` below
  260 px) no longer needs to: compact forms stack below 250 px by themselves.
