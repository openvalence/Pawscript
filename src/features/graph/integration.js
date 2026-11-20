// integration.js -- the graph feature's document integration (contract: src/lib/graph/README.md §10).
//
//   import { graphController, integrationCommands } from './integration.js';
//   const ctl = graphController(app);      // one per app; reactive getters (Svelte runes inside)
//
// The editor's commands.js must spread `integrationCommands` into its default export (the shell discovers only
// features/*/commands.js). Persistence helpers for the shell / io owners: integration/persist.js (import it directly; it needs
// lib/graph/serialize.js, which this entry point deliberately does not load statically).

export { graphController, peekGraphController, graphEngine } from './integration/controller.svelte.js';
export { integrationCommands } from './integration/commands.js';
export { resolveSlot } from './integration/core.js';
