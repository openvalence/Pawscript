# features/palette — command palette, shortcut help, keybinding editor

Everything here reads the one command registry (`app.commands`); nothing binds keys itself.

| File | What |
|---|---|
| `commands.js` | `palette.open` (Ctrl+K, Ctrl+Shift+P), `palette.help` (? = `Shift+/`), `palette.keys` (Ctrl+Alt+K; args `{focus: id, slot}` open it capturing keys for that command), `quick.open` (Shift+Q), `palette.close` (Esc, hidden, `when` an overlay is open) |
| `modal.js` | `[{id:'palette', component: Palette}, {id:'palette.help', component: Help}, {id:'palette.keys', component: KeysModal}]` — mount once at top level with `{app}`; KeysModal is the keybinding editor as an overlay where there are no docks (Welcome screen) |
| `panel.js` | `{id:'keys', title:'Shortcuts', dock:'bottom', order:90, component: KeysPanel}` (all modes) |
| `state.svelte.js` | `ui.open` = `'palette' \| 'help' \| null` (one overlay at a time), `ui.query`, focus restore, `ui.focusKeys` |
| `fuzzy.js` | pure scorer: contiguous (300+) > word starts (200+) > scattered; `match` (multi-word, multi-field), `rank` (ties by recency) |
| `logic.js` | pure: menu grouping, prefix modes, time parsing, binding edits, conflict text, the Quick menu lists |
| `quick.js`, `QuickHost.svelte` | the Quick menu and the right-click entries of every `[data-command]` element (below) |
| `Palette.svelte`, `Help.svelte`, `KeysPanel.svelte`, `Keys.svelte` (key caps), `palette.css` (shared `pp-` classes) | UI |

Tests: `test/palette-fuzzy.test.mjs`, `test/palette-logic.test.mjs`, `test/quick-menu.test.mjs`; window check `dev/quick-check.mjs`. Harness: `dev/palette.html` (port 5201).

## Palette

- Empty query: up to 5 recently run commands, then every non-hidden command grouped by menu. Disabled commands
  are listed greyed with their keys; Enter on one only says it is unavailable.
- Typing ranks by `fuzzy.js` over title, menu and id; each space-separated word must match (`edit und`).
- Prefixes: `>` commands (default), `:` go to a time (`:1:23.5`, `:83s`, `:500ms`, `:2m`, `:+5`, `:-1.5s`;
  bare numbers are seconds; clamped to the duration).
  Seeking also scrolls `app.view` when the target is off screen.
- ↑ ↓ PgUp PgDn Home End move, Enter runs (closes first, focus goes back, then runs after a tick), Esc or a click
  outside closes. Keys that are not the palette's own (Ctrl+K etc.) never reach the app's keymap while it is open.

## Help (?)

Every command that has keys, by menu then group, in columns; filter by name, id or key text (`ctrl+z`).
Conflicts are flagged: amber triangle when a user binding is involved, muted info icon when two defaults share
a key (e.g. Esc: `palette.close` and `edit.escape`; their `when` decides).

## Keybinding editor (dock panel `keys`)

- Search (fuzzy over title, menu, id, key text), **Find by key** (press a chord to list what it runs),
  filters All / Changed / Conflicts, **Reset all** (asks via `app.confirm`).
- Click a binding (or `+`) to capture: press a chord, or up to three chords for a sequence (`G G`). Enter or
  leaving the cell saves, Esc cancels, Backspace clears what was typed (with nothing typed it removes that
  binding). A capture-phase window listener stops every key while capturing, so the app never sees it.
  Consequence: plain Esc, Enter and Backspace cannot be captured as bindings (modified ones can).
- Live conflict preview while capturing (same keys, and prefix: `G` vs `G G`), persistent notes after.
- `×` removes a binding, the row's undo button resets it. A result equal to the defaults is stored as no
  override. Overrides persist via `app.commands.setKeys` (settings `keys.overrides`).

## Quick menu (Shift+Q) and the right-click contract

Blender's Quick Favourites in this app's terms. One list of command ids per stage tab and one for the project page (settings
`quick.lists`). Shift+Q opens the list that applies at the pointer (a kit context menu: title, key, a disabled row greyed
with its why as its tip). Anything tied to a command carries `data-command="<id>"` (menu-bar rows via the kit MenuItem
`command`, palette rows, kit buttons whose click runs that command with no arguments) and answers right click with
Add to / Remove from Quick menu and Assign shortcut… / Change shortcut (currently X)… (this editor, capturing for it);
a Quick menu row also Move up / Move down. Where the element has its own context menu these end it (kit `contextExtras`).
A control not tied to a command gets nothing: tie it to one (and add `data-command`) to give it the entries.
A setting drawn by `app/Prop.svelte` is a property instead (kit `property()`): Reset to default, Copy / Paste value, Show in
Settings and Add to / Remove from Quick menu; in the list it is `setting:<key>`, its row shows the value, a boolean's row
toggles it and any other opens Settings at the row (paw-m3b6).

## Needs from the shell

- Mount `src/features/*/modal.js` components once at top level (the plug-in point in ARCHITECTURE.md).
- `app.showPanel(id)` to open the dock tab holding a panel (used by `palette.keys`; without it the command only
  focuses the panel if it is already visible).
- The app's global keydown handler must be a bubble-phase window listener (as in `dev/mock-app.js`), so the
  overlays' `stopPropagation` and the editor's capture-phase listener keep keys away from it.
