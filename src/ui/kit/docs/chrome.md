# Chrome family

The frame of the editor: tab strips, collapsible groups, panel heads, toolbars, the status bar and empty
panels. Demo: `/dev/kit.html?demo=chrome` (`&theme=light|contrast`, `&density=compact|comfortable`).

All of them take `class` (added to the root) and pass any other attribute (`id`, `aria-*`, `data-*`,
`style`) to the root element. Head heights match: Tabs (md), Section and PanelHeader are all `--ctl-h`, so
they line up next to each other and above each other.

```js
import Tabs from '../ui/kit/Tabs.svelte';           // and Section, PanelHeader, Toolbar, StatusBar, StatusItem, EmptyState
```

---

## Tabs

A line-style tab list with an optional panel. Text `--tx-mut`, `--tx` on hover, the active tab `--tx-hi`
with a 2px `--reality` underline (the kit's one selected colour) that sits on the bar's bottom hairline.

| Prop | Type | Default | |
|---|---|---|---|
| `tabs` | `{ id, label, icon?, badge?, badgeTone?, disabled? }[]` | `[]` | `badge`: number (tabular) or short text; `badgeTone`: a Badge `Tone` |
| `value` | id, bindable | first enabled tab | the active tab. Works without a bound value too |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | bar height `--ctl-h-sm / --ctl-h / --ctl-h-lg` |
| `label` | string | | `aria-label` of the tablist (and of the overflow menu) |
| `overflow` | `'menu' \| 'scroll'` | `'menu'` | what too many tabs get: a "More tabs" menu plus scrolling, or scrolling alone |
| `onchange(id, e)` | | | when the user activates another tab (a click, the arrow keys or the overflow menu) |
| `children(activeId)` | snippet | | the panel content (`role=tabpanel`, labelled by the active tab). Leave it out for a bare tab bar |

Keyboard: Left/Right move and activate at once (automatic activation), skipping disabled tabs and wrapping
around; Home/End go to the first/last enabled tab; only the active tab is a tab stop (roving tabindex), so
Tab moves on to the overflow button (when shown), then the panel.
Overflow: when the tabs don't fit, the list scrolls sideways (the mouse wheel works too), fades at the
clipped edge, and keeps the active tab in view. The page itself never scrolls. With `overflow='menu'` a
square `chevron-down` IconButton ("More tabs", the bar's height, a hairline left of it) appears at the
bar's end only while the tabs are wider than the whole bar; nothing is reserved otherwise, and the test
ignores the button's own width, so the strip never flickers at the threshold. It opens a Menu (aligned to
the button's right edge) listing every tab as a radio item: the active one checked, disabled ones
disabled, icons kept, a badge appended as `Label (12)`. Choosing one is a click on that tab: `value`
updates, `onchange(id)` fires, the tab scrolls into view and takes focus. The button is a normal tab stop
after the tablist (outside its roving); Esc closes the menu and returns focus to it; its tooltip stays
off while the menu is open.

Internal class names are `kit-` prefixed (`kit-tab`, `kit-tab-list`, ...) so a host's bare `.label` or
`.tab` rule cannot reach them; select by role (`[role=tab]`, `[role=tablist]`), not by class.

```svelte
<Tabs label="Side panel" bind:value={tab} tabs={[
  { id: 'inspector', label: 'Inspector', icon: 'settings' },
  { id: 'problems', label: 'Problems', icon: 'warning', badge: 12, badgeTone: 'warn' },
  { id: 'history', label: 'History', icon: 'history' },
]}>
  {#snippet children(id)}
    {#if id === 'inspector'}<Inspector />{:else if id === 'problems'}<Problems />{:else}<History />{/if}
  {/snippet}
</Tabs>
```

## Section

A collapsible group with a head in the caps voice. Stack several of them to make an accordion: neighbours
get one hairline between them and none at the ends.

| Prop | Type | Default | |
|---|---|---|---|
| `title` | string | `''` | caps head voice in `--tx-val`; ellipsizes when too long |
| `open` | boolean, bindable | `true` | |
| `count` | number \| string | | a quiet `.k-num` after the title |
| `level` | number | `3` | `aria-level` of the head |
| `actions` | snippet | | buttons at the head's right (use `IconButton size="sm"`). Shown on hover / focus-within (always on touch), always focusable |
| `onchange(open, e)` | | | when the user toggles it |
| `children` | snippet | | the body |

Keyboard: the head is a button (`aria-expanded`, `aria-controls`), so Enter or Space toggles it. The
chevron turns and the body slides open or shut (`grid-template-rows` 0fr↔1fr at `--t-move`; instant under
reduced motion). A closed body is `inert`: out of the tab order and hidden from screen readers.

```svelte
<Section title="Timing" count={4} bind:open={timingOpen}>
  {#snippet actions()}<IconButton size="sm" icon="refresh" label="Reset timing" onclick={reset} />{/snippet}
  <NumberField label="Start" bind:value={start} />
</Section>
```

### Containment and actions (added)

- `actionsVisible = 'hover' | 'always'` (default `'hover'`). Hover mode shows the actions on hover of the head
  and whenever focus is anywhere inside the Section; `'always'` keeps them shown (Clear selection, Export…).
- An open body never widens the Section: its grid column is `minmax(0, 1fr)`, so content shrinks to the
  Section's width, and what cannot shrink is clipped at the inline edges (the inset keeps children's focus
  rings inside). Workarounds such as `contain: inline-size` on `.k-section .inner` are no longer needed.
- The body element is the public part `k-section-body`.

## PanelHeader

A panel's head: a `--bg-raised` band with a bottom hairline `--line-1` and a caps title. With no icon and no
chevron, the title gets Phosphor's ▸ marker. Every variant puts the title at the same x position.

| Prop | Type | Default | |
|---|---|---|---|
| `title` | string | `''` | ellipsizes |
| `icon` | icon name | | 14px, `--tx-mut` |
| `collapsed` | boolean, bindable, optional | `undefined` | when set (true/false), the title becomes a toggle with a chevron (`aria-expanded = !collapsed`) |
| `controls` | id | | `aria-controls` of the toggle: the id of the body it hides |
| `level` | number | `2` | `aria-level` of the head |
| `actions` | snippet | | buttons at the right (`IconButton size="sm"`) |
| `onchange(collapsed, e)` | | | when the user toggles it |

Keyboard: the toggle is a button, so Enter or Space flips `collapsed`. Hiding the body is up to you
(`hidden={collapsed}`, or a SplitPane).

```svelte
<PanelHeader title="History" icon="history" bind:collapsed controls="history-body">
  {#snippet actions()}<IconButton size="sm" icon="delete" label="Clear history" />{/snippet}
</PanelHeader>
<div id="history-body" hidden={collapsed}>…</div>
```

## Toolbar

`role=toolbar` around buttons. The whole toolbar is one tab stop. Items are spaced `--space-1` apart;
separate groups with `<span class="k-sep"></span>` (in a vertical toolbar the separators turn horizontal on
their own).

| Prop | Type | Default | |
|---|---|---|---|
| `label` | string | | `aria-label` (required in practice) |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | arrow axis, and the layout direction |
| `children` | snippet | | anything focusable, at any depth (wrapper divs and `role=group` are fine) |

Keyboard: Left/Right (Up/Down when vertical) move focus to the next or previous enabled item and wrap
around; Home/End go to the first/last item. Tab leaves the toolbar, and coming back lands on the item you
left. The item list is read fresh on every key press, so items added, removed or disabled later just work.
A nested composite (SegmentedControl, Tabs) counts as one item. Arrows inside it belong to it, so you
leave it with Tab or click (or arrows from a neighbour reach it). Text fields, selects, sliders and number
fields keep their own arrow keys.

```svelte
<Toolbar label="Edit tools">
  <ToggleButton icon="pointer" label="Select" shortcut="V" pressed={tool === 'select'} onchange={() => (tool = 'select')} />
  <ToggleButton icon="pen" label="Pen" shortcut="P" pressed={tool === 'pen'} onchange={() => (tool = 'pen')} />
  <span class="k-sep"></span>
  <ToggleButton icon="magnet" label="Snap to frames" shortcut="S" bind:pressed={snap} />
  <span class="k-sep"></span>
  <IconButton icon="zoom-out" label="Zoom out" /> <IconButton icon="zoom-fit" label="Zoom to fit" /> <IconButton icon="zoom-in" label="Zoom in" />
</Toolbar>
```

## StatusBar / StatusItem

The bottom row: `--bg-raised`, a top hairline, `--ctl-h-sm` tall, text `--fs-2` in `--tx-mut`. Items from
`children` start at the left and items from `end` sit at the right. Neighbouring items get a short, quiet
hairline between them.

StatusBar props: `children` (left group), `end` (snippet, right group). Pass `aria-label`.

| StatusItem prop | Type | Default | |
|---|---|---|---|
| `icon` | icon name | | 12px. Only the icon takes the tone colour |
| `tone` | `Tone` | `'neutral'` | `ok/warn/bad/info/accent` → `--*-ink` on the icon; the text stays `--tx-mut` |
| `tip` | string | | tooltip, shown above the item |
| `onclick(e)` | | | makes the item a button: same metrics, a `--bg-hover` fill on hover |
| `children` | snippet | | the text. Put numbers in `<span class="k-num">` (they show in `--tx-val`) |

Truncation: an item holding a `.k-num` (a readout) keeps its full width, and text-only items ellipsize first.
Keyboard: a clickable item is a native button (Tab, Enter, Space).

```svelte
<StatusBar aria-label="Status">
  <StatusItem icon="clock" tip="Cursor time"><span class="k-num">01:23.456</span></StatusItem>
  <StatusItem icon="film" tip="Frame rate"><span class="k-num">29.97</span> fps</StatusItem>
  <StatusItem icon="warning" tone="warn" tip="Variable frame rate">VFR</StatusItem>
  {#snippet end()}
    <StatusItem icon="select"><span class="k-num">12</span> points</StatusItem>
    <StatusItem icon="dot" tone="ok" tip="Device settings" onclick={openDevice}>Handy connected</StatusItem>
  {/snippet}
</StatusBar>
```

## EmptyState

What an empty panel says, centred in its box (it fills the parent's height).

| Prop | Type | | |
|---|---|---|---|
| `icon` | icon name | | 32px in `--tx-mut`, stroke held at 2px |
| `title` | string | | `--fs-5`, `--tx-hi` |
| `description` | string | | `--tx-mut`, at most 48ch wide |
| `actions` | snippet | | a centred row of buttons |
| `children` | snippet | | extra content between the description and the actions |

```svelte
<EmptyState icon="film" title="No video loaded" description="Open a video or drop one here to start scripting.">
  {#snippet actions()}<Button variant="primary" icon="folder-open" onclick={open}>Open video</Button>{/snippet}
</EmptyState>
```
