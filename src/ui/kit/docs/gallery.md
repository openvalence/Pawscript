# Kit gallery, editor mock and e2e checks

## Run the gallery

```sh
npx vite --port 5181 --strictPort        # any free port
# open http://localhost:5181/dev/kit.html
```

- Top bar: theme (dark / light / contrast), density (compact / default / comfortable), reduced motion,
  side by side (the selected section rendered three times, one column per theme via `data-theme`).
  The choices are mirrored into the query string, so a reload or a shared link keeps them.
- Left nav: every `src/ui/kit/_demo/*Demo.svelte` (found by `dev/kit.js`), then the gallery's own pages:
  - **Consistency** — every control of every family in one row per size, on a guide band of the exact
    `--ctl-h*` height, each control's measured height printed under it (red = off by more than 0.5 px).
    Rows for disabled, invalid, a Toolbar composition, truncation (140 px boxes) and labelled Fields.
  - **Editor mock** — a full Pawscript editor composed only from kit components (menu bar, modes, video
    well with ROI boxes in the Track tab, inspector with Tabs / Sections / ParamForm, heatmap overview, lanes
    with ghosts, playhead and box selection, transport, status bar). Play works (fake clock).
  - **E2E fixtures** — the components `test/kit-e2e.test.mjs` drives.
- Deep links (URL hash): `#menus`, `#mock`, `#consistency` … Flags after a slash: `#mock/full` (no gallery
  chrome: use this for screenshots at 1280×800 / 1920×1080), `#buttons/sbs` (side by side).
  Query: `?theme=light&density=compact&motion=reduce`. One family alone: `?demo=buttons`.
- Until a family lands, the gallery pages show a dashed placeholder named after the missing component
  (red dashed = its file exists but failed to load; hover for the error). The nav footer counts the
  loaded components and names the failed ones.

Files: `src/ui/kit/_gallery/` — `Gallery.svelte` (shell), `Consistency.svelte`, `EditorMock.svelte`,
`MockCanvas.svelte` (lane / ruler / overview canvases: tokens via `cssVar()`, redraw on `onThemeChange()`),
`mockdata.js` (deterministic fake scripts), `E2E.svelte`, `Kit.svelte` + `kit.svelte.js` (late-bound
component lookup so a half-written family cannot break the gallery — gallery-only; app code imports
components by path).

## Screenshots

From a script outside the repo:

```js
import { chromium } from 'file:///C:/path/to/Pawscript/node_modules/playwright/index.mjs';
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:5181/dev/kit.html?theme=light&density=compact&motion=reduce#mock/full');
await p.waitForFunction(() => window.__kitReady);
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: 'mock-light-compact@2x.png' });
```

## Run the e2e checks

```sh
KIT_E2E=1 node --test test/kit-e2e.test.mjs          # bash
$env:KIT_E2E='1'; node --test test/kit-e2e.test.mjs  # PowerShell
```

The test starts its own Vite dev server on a free port (vite JS API) and Edge via Playwright, opens
`dev/kit.html#e2e/full`, and checks: Menu keyboard (arrows, submenu in/out, Enter, Esc returns focus),
MenuBar (arrows between menus, ArrowDown opens, Esc returns focus), Tabs (arrows, automatic activation,
disabled skipped, wrap), Slider (arrows, Shift ×0.1, Ctrl round values, Home/End), Dialog (focus starts inside, Tab wraps,
Esc closes with reason `escape`, focus returns to the opener), NumberField (drag scrub changes the value,
exactly one `oncommit`), SplitPane (drag resizes, holds `min` and `minOther`), VirtualList (100 000 rows,
fewer than 60 rows in the DOM, last row reachable). Without `KIT_E2E=1` the suite is skipped, so
`npm run check` stays fast.

Add a check: put the component in `E2E.svelte` with `data-testid`s and an `<output>` that logs what its
callbacks reported, then assert on those outputs (not on component internals).
