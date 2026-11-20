# Kit provenance

What `src/ui/kit` takes from Phosphor (OpenValence/Phosphor, the owner's own app,
Apache-2.0). Ideas and values were carried over; the code is new unless a line says "copied".

## Tokens (`theme.css`)
- Dark theme = Phosphor's default chassis (`src/style.css` `:root`): surfaces `--bg --bg-raised --bg-card
  --bg-sunken`, hairlines `--line-0..4`, text ramp `--tx-hi --tx --tx-val --tx-ghost --tx-faint`, accents
  `--reality --intent --highlight` and their meanings, `--warn #F5B94D` / `--bad #FF4757`, `--radius 2px`,
  motion `--t-quick --t-move --t-slow --ease-out --ease-settle` (values copied).
- `--tx-mut #848A96`: lifted from Phosphor's `#666C78` (3.5:1) toward its `html.hivis` step so labels clear
  4.5:1; `--line-ctl` is new (Phosphor's control frames are hairlines below 3:1).
- Light theme = Phosphor's "Paper" variant (`themes/phosphor/manifest.js`), derived with Phosphor's own
  `model/theme.js deriveTokens()`; labels, the accent ink and safety inks darkened to 4.5:1; the pink
  highlight darkened as Phosphor does on light chassis (`--neutrino`).
- Contrast theme = Phosphor's Contrast theme, dark variant (`themes/contrast/manifest.js`): surfaces, text
  and line values copied; highlight changed from white to yellow so focus and text differ; 3px ring.
- Fonts: Chakra Petch and Martian Mono, referenced from `src/fonts/` (copied there by the shell agent from
  Phosphor `src/fonts/`).
- Not from Phosphor: the series palette (optimised for colour-vision deficiencies), density tokens, the px
  type and space scales, z layers, `--sel-*`.

## Control language
- Buttons: `.og-btn` (transparent, hairline frame, hover `--line-4`, `:active` highlight, primary = reality
  frame + text + glow, danger = bad ink); disabled `opacity .45`.
- Segmented control: `.og-seg` active state (reality frame + text + glow), joined into one frame here.
- Switch: `.og-switch` square track and thumb, reality when on.
- Fields: `.og-num` / `.value-input` recess (sunken fill, inset shadow, mono numerals with `'wdth' 90`),
  focus = highlight frame; `.field-label` quiet lowercase label voice (`--label-case`); unit suffix style.
- NumberField drag-to-scrub and step modifiers: `plugins/kit.js stepper()` and `drag()` (behaviour idea).
- Slider: Phosphor's 2px hairline track and rectangular thumb with highlight + glow while dragged.
- Menus: `plugins/kit.js menu()` and `.ui-menu*` (submenu beside its row, the pointer-wander grace timer,
  checked rows, sections, Escape/Tab behaviour).
- Tooltip: `#ph-tip` (framed card with an outline held off it, never takes the pointer, one shared element).
- Dialog: `.og-panel` corner brackets (`--og-brackets`), redrawn from tokens as `.k-brackets`.
- Section / PanelHeader: `.dash-title` head voice with the ▸ marker, `.ui-caret` rotation.
- Tabs: `.ui-seg[role=tablist]` (Phosphor marks the open tab with highlight; Pawscript uses reality, the
  kit's one "selected" colour).
- Status bar tone bar and toasts' left tone bar: `.foot-status`.
- Scroll edge shades: `[data-shade]` / `ui/scrollshade.js`; splitter: `.ui-split`.
- Popovers in the top layer (`popover="manual"`) and the rise-in motion: `style.css [popover]` rules.
- Icons: Phosphor's icon style (`ui/navIcons.js`: 16-unit viewBox, 1.5 open stroke, round caps); the
  `wave`, `settings`, `link`, `plug` and `chapters`-style glyphs started from Phosphor paths, the rest are new.
- Colour maths (`color.js`): WCAG contrast as in `model/theme.js contrast()`; OKLab and the CVD simulation
  (Machado 2009 matrices) are new.
