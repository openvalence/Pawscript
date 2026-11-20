// deps.js -- sibling graph code this editor uses only when present (import.meta.glob of a missing file is {}),
// so the editor never breaks the app while the integration and presets land. Browser/Vite only: pure modules
// and node tests must not import this.
//
// The controller: src/features/graph/integration.js graphController(app) (lib/graph/README.md §10). A harness
// may install a stand-in with useController(fn) before mounting (dev/graph.js does when integration is absent).

const ctlMods = import.meta.glob('./integration.js', { eager: true });
const presetMods = import.meta.glob('../../lib/graph/presets.js', { eager: true });
const first = (mods, name) => Object.values(mods).map((m) => m?.[name]).find((v) => v != null);

const real = first(ctlMods, 'graphController') ?? null;
const realPeek = first(ctlMods, 'peekGraphController') ?? null;
let factory = real;
const made = new WeakMap();
export const realController = !!real;
/** The integration's own commands (bake, enable, live…), spread into commands.js. */
export const integrationCommands = first(ctlMods, 'integrationCommands') ?? [];
/** The integration's preset-slot rule (tracker ghost, first run…), reused to bind sources placed from the palette. */
export const resolveSlot = first(ctlMods, 'resolveSlot') ?? null;
/** Install a controller factory (harness stand-in). */
export function useController(fn) { factory = fn; }
/** The app's GraphController (created on first call, inside a component), or null when there is none. */
export function ctlOf(app) {
  if (!factory || !app) return null;
  const c = factory(app);
  made.set(app, c);
  return c;
}
/** The controller if one was already created; never creates (commands' `when`). */
export const peekCtl = (app) => (app ? made.get(app) ?? (factory === real && realPeek ? realPeek(app) : null) : null);

export const PRESETS = first(presetMods, 'PRESETS') ?? [];
