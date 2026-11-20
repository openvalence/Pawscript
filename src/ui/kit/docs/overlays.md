# Overlays family

`Popover` `Dialog` `confirm()` `toast()` / `ToastHost` and the shared `tooltip` attachment.
Demo: `/dev/kit.html?demo=overlays` (`&theme=light|contrast`, `&density=compact|comfortable`, `&motion=reduce`).
Logic test: `test/kit-overlays.test.mjs` (the toast store).

All of them follow README §2. `class` is appended to the root, and any other prop (`id`, `aria-*`, `data-*`, `style`)
is spread onto it. Everything floating uses the browser top layer (`showModal`, `showPopover`). There are no portals and
no z-index fights, and each overlay takes the theme of the subtree it lives in. Escape closes the innermost overlay and
is stopped there, so Escape in a Popover inside a Dialog closes only the Popover.

## Popover

A non-modal dialog (`role="dialog"`) next to its trigger, placed by `float()`. Use it for small forms and settings
(loop range, snapping). Content renders only while open.

```svelte
<Popover title="Loop settings">
  {#snippet trigger({ props })}<Button {...props} icon="loop">Loop settings</Button>{/snippet}
  <Switch bind:checked={loop} label="Loop playback" />
</Popover>

<!-- controlled; any button that has aria-controls={id} is the anchor -->
<IconButton icon="magnet" label="Snapping" onclick={() => (open = !open)} aria-expanded={open} aria-controls="snap-pop" />
<Popover bind:open id="snap-pop" placement="bottom" label="Snapping">…</Popover>
```

| Prop | Default | |
|---|---|---|
| `open` | `false` | bindable |
| `anchor` | `null` | Element to float next to. If not set, it is the element with `aria-controls` equal to the popover's `id` (the trigger) |
| `placement` | `'bottom-start'` | any `place()` placement; it flips and shifts to stay in the viewport, and its height is capped to the room left (then it scrolls) |
| `offset` | `6` | addition: px between the anchor and the popover |
| `title` | `''` | addition: a visible heading (`--fs-4`, `--tx-hi`), wired to `aria-labelledby` |
| `label` | `''` | `aria-label` when there is no `title` |
| `id` | auto | addition: the popover element's id (and its `aria-controls` target) |
| `trigger` | | snippet `({ props })`: spread `props` (`aria-haspopup`, `aria-expanded`, `aria-controls`, `onclick` toggle) on your button |
| `onclose(reason)` | | `'escape'` · `'outside'` (a press outside, or the window losing focus) · `'blur'` (Tab out) · `'toggle'` (the trigger again) |
| children | | the content (padding `--space-5`) |

Keyboard: opening moves focus to `[autofocus]`/`[data-autofocus]`, else the first tabbable control, else the popover.
Escape closes it and returns focus to the trigger. Tab out of it closes it, and focus goes where Tab sent it. A press
outside closes it. Any close while focus is inside returns focus to the trigger.

## Dialog

A native `<dialog>` opened with `showModal()`: it is in the top layer, the page is inert, and `::backdrop` is `--scrim`.
Tab and Shift+Tab wrap inside (`trapFocus`). The surface is `--bg-card` with a `--line-2` frame, `.k-brackets` corners
and `--shadow-3`. It has a header (title `--fs-5` `--tx-hi`, plus a × IconButton with tip "Close Esc"), a body that
scrolls (`.k-scroll`), and a footer row of right-aligned buttons above a `--line-1` hairline. Put the primary action
last (rightmost). The height is capped at the viewport minus `--space-6` on each side, and only the body scrolls. On
open and close it fades with a 4px rise over `--t-move`, which reduced motion turns off.

```svelte
<Dialog bind:open title="Export funscript" onclose={(r) => log(r)}>
  <TextField bind:value={name} label="File name" full />
  {#snippet footer({ close })}
    <Button onclick={() => close('cancel')}>Cancel</Button>
    <Button variant="primary" icon="export" onclick={() => { save(); close('export'); }}>Export</Button>
  {/snippet}
</Dialog>
```

| Prop | Default | |
|---|---|---|
| `open` | `false` | bindable. Setting it `false` yourself closes the dialog without calling `onclose` |
| `title` | `''` | the heading (`aria-labelledby`). Write it in sentence case, as a question for confirms |
| `size` | `'md'` | `sm` 400px · `md` 480px · `lg` 720px, never wider than the viewport minus 32px |
| `dismissible` | `true` | `false`: Escape, the backdrop and the × do nothing (there is no ×). Close it from the footer |
| `onclose(reason)` | | user closes only: `'escape'` · `'backdrop'` · `'close'` (the ×) · whatever you pass to the footer's `close(reason)` · an action's `value` |
| `footer` | | snippet `({ close })`: the button row |
| children | | the body |
| `message` | `''` | addition: a plain-text body paragraph (`aria-describedby`), shown before any children |
| `actions` | `null` | addition: `{ label, value?, variant?, autofocus? }[]`, a footer of Buttons when there is no `footer` snippet. A click closes with `reason = value ?? label` |
| `modal` | `true` | addition: `false` shows it in place, with no backdrop and no trap, and does not move focus (previews, the demo's pinned dialog). Position it yourself |
| `passKeys` | `false` | addition: a modal dialog stops every keydown at itself, so app shortcuts on `window` cannot act behind it. `true` lets keys bubble on, for an overlay whose own keys are app commands |

Initial focus goes to `[autofocus]`/`[data-autofocus]` inside, else the first tabbable control in the body, else the
rightmost footer button (the primary action), else the dialog itself. Focus returns to the opener on close. A backdrop
click only counts when the press starts and ends outside the box, so dragging a selection out of a field does not
close it. Pressing the backdrop does not move focus. Content mounts on first open and then stays mounted, so form state
survives a close.

Keyboard: Tab / Shift+Tab wrap. Escape closes the dialog if it is dismissible. Enter activates the focused button.
A modal dialog is modal for the keyboard too: no keydown propagates past it (fields inside still type, nothing is
prevented), unless `passKeys`.

## confirm()

```js
import { confirm } from '../ui/kit/dialog.js';
if (await confirm({ title: 'Discard unsaved changes?', message: 'Edits since the last save will be lost.', confirmLabel: 'Discard', danger: true })) discard();
if (await confirm({ title: 'Overwrite video.funscript?', message: 'A backup is kept.', confirmLabel: 'Overwrite' })) save();
```

`confirm({ title = 'Are you sure?', message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) →
Promise<boolean>`. It mounts a small `role="alertdialog"` Dialog into `document.body` and unmounts it after the exit
transition. The footer is Cancel, then the confirm button (primary, or danger when `danger`). It resolves `true` only
on the confirm button. Cancel, Escape, the × and the backdrop resolve `false`. Focus starts on the confirm button, so
Enter confirms. When `danger` it starts on Cancel instead (WAI-ARIA APG: the least destructive action first), so
destroying takes Tab, Enter or a click. The dialog takes the `data-theme` of the element that had focus (falling back
to the document's), and focus returns to that element.

## toast() and ToastHost

```js
import { toast, dismissToast } from '../ui/kit/toast.svelte.js';
toast('Saved video.funscript', { kind: 'ok' });
toast('Video is VFR — frame snapping is approximate', { kind: 'warn' });
const id = toast('Tracker crashed', { kind: 'bad', action: { label: 'Show log', run: openLog } });
dismissToast(id);
```

```svelte
<ToastHost />   <!-- once, near the app root -->
```

`toast(message, { kind = 'info', timeout, action }) → id`. `kind` is a Tone (`info` `ok` `warn` `bad` `neutral`
`accent`). Every kind except `bad` times out after `timeout` ms (default 4000). `timeout: 0` keeps a toast until it is
dismissed. `bad` lives `BAD_MS` (a minute) unless you give it another timeout; `0` does not make it stay. The same
message and kind again while it shows is counted on it (`count`, drawn "×3") and its countdown starts over. Over
`MAX_TOASTS` the oldest timed one goes, else the oldest. `action: { label, run }` adds a ghost sm Button,
and pressing it runs `run()` and dismisses the toast. `dismissToast(id)` removes a toast (an unknown id is a no-op),
`dismissAll()` every one (the host's "Dismiss all", shown from two up). `--toast-bottom` on the root lifts the stack, `--toast-room` caps its height (the oldest are cut).
Also exported: `toasts` (the `$state` list of `{ id, message, kind, action, count }`), `pauseToasts(on)`, `MAX_TOASTS` (4),
`RESUME_MS` (1500) and `BAD_MS`.

ToastHost draws the stack bottom-right in the top layer (above the page, below a modal opened later), newest at the
bottom, at most 4 visible. When a fifth arrives, the oldest toast that would time out anyway goes at once. Persistent
ones are never dropped and wait behind the four shown. While the pointer is over the stack or focus is in it, every
countdown is frozen. On resume each one keeps the time it had left, with at least `RESUME_MS`. Each toast is
`--bg-card` with a `--line-2` frame, a 3px left bar in the tone's `-ink`, the icon in the same ink and the message in
`--tx`. Screen readers hear new toasts through two hidden live regions: polite, and assertive for `bad`.

| ToastHost prop | Default | |
|---|---|---|
| `items` | `null` | addition: render this list instead of the store (previews) |
| `inline` | `false` | addition: in-flow and static (no top layer, no live regions, no pausing) |

Keyboard: the stack's buttons follow the page in tab order (the action, then Dismiss). Focusing one pauses the timers.

## tooltip (shared, `tooltip.js`)

```svelte
<button {@attach tooltip('Play', 'Space')}>…</button>
<span tabindex="0" {@attach tooltip({ text: 'Snap to frames', shortcut: 'S', placement: 'top' })}>…</span>
<Button tip="Export" shortcut="Ctrl+E" …/>   <!-- buttons take tip / shortcut; IconButton's tip defaults to its label -->
```

`tooltip(text, shortcut?)` or `tooltip({ text, shortcut, placement = 'bottom', delay = 500 })`. There is one shared
`.k-tip` element in the top layer, placed with `place()`: it flips to the other side and shifts inside the viewport
(4px margin). It shows after `delay` on hover and at once on keyboard focus. While another tip was visible within the
last 400 ms it shows at once, so sweeping a toolbar reads every button. It never takes the pointer, never shows for touch or
while a pointer button is held, and never outlives its reason: it hides on leave, blur, any press, Escape anywhere,
scroll of anything, window blur or resize, the tab going hidden and the attachment's teardown, and while shown a
watchdog (every 120 ms) hides it once the trigger is removed, hidden (`display: none` or `visibility: hidden` on it
or an ancestor), disabled (`:disabled` / `aria-disabled`: a disabled control gets no pointerleave and its `:hover` can
stick) or no longer hovered — `:hover` and the last pointer position over its box (focused, for a keyboard-shown tip) —
the cases of a close button that closes its own panel under a still pointer and of a Track button that turns into a
disabled one while hovered. Pure rules: `mayShowTip()` and `keepTip()` (tooltip.js, tested in
`test/kit-logic.test.mjs`; the browser cases in `test/kit-e2e.test.mjs`). The shortcut renders as a muted `<kbd>` in platform form (`Ctrl+Shift+Z` /
`⇧⌘Z`) and sets `aria-keyshortcuts`. Multi-line text wraps at 280px and keeps `\n`. A tip copies `data-theme` from
the anchor's nearest themed ancestor.

Native `title=` attributes are adopted: the first hover of an element with a `title` moves it to `aria-description`
and gives the element this tooltip, so the WebView never draws its own (WebView2 leaves those up after the pointer
leaves, until another titled control is hovered). Prefer `tooltip()` in new code; a stray `title` is still safe.

Keyboard: Tab to the element shows its tip. Escape hides it, and focus stays put.
