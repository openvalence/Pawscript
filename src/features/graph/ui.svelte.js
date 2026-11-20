import { rooted } from '../../lib/rooted.svelte.js';
// ui.svelte.js -- the graph editor's own UI state, one per app: focus (scopes the graph's keys), selection,
// panel chrome (maximised, inspector), palette history, and the mounted editor's methods (commands call
// them). None of it is in the graph (lib/graph README §1: view and selection never create undo entries).
// The canvas view per graph is persisted in app.settings 'graph.view.<graphId>' by the editor.


const uis = new WeakMap();

export class GraphUI {
  focused = $state(false);       // focus is inside the graph panel: graph keys are live
  sel = $state.raw(new Set());   // selected node and frame ids
  wire = $state(null);           // selected link id
  maximised = $state(false);
  inspector = $state(true);
  said = $state('');             // aria-live status (refusals, results)
  diff = $state.raw(new Set());  // node ids showing the "what changed" overlay (D)
  /** The mounted GraphEditor's methods ({ openPalette, fit, frameSelection, ... }), or null. */
  editor = $state.raw(null);
  #app;

  constructor(app) {
    this.#app = app;
    this.inspector = app.settings?.get?.('graph.inspector') ?? true;
  }
  get recent() { return this.#app.settings?.get?.('graph.palette.recent') || []; }
  get favs() { return this.#app.settings?.get?.('graph.palette.favs') || []; }
  noteRecent(key) { this.#app.settings?.set?.('graph.palette.recent', [key, ...this.recent.filter((k) => k !== key)].slice(0, 12)); }
  toggleFav(key) {
    const f = this.favs;
    this.#app.settings?.set?.('graph.palette.favs', f.includes(key) ? f.filter((k) => k !== key) : [...f, key]);
  }
  setInspector(on) { this.inspector = on; this.#app.settings?.set?.('graph.inspector', on); }
  select(ids) { this.sel = new Set(ids); this.wire = null; }
  say(text) { this.said = ''; queueMicrotask(() => { this.said = text; }); }
  /** The single selected node id, or null. */
  get one() { return this.sel.size === 1 ? [...this.sel][0] : null; }
}

/** The app's GraphUI (created on first use). */
export function graphUI(app) {
  let u = uis.get(app);
  if (!u) { u = rooted(() => new GraphUI(app), app); uis.set(app, u); }   // paw-b7da: its own root, never the asking component's
  return u;
}

/** Fragments copied with Ctrl+C live here too (so a paste works without clipboard permission), across graphs. */
export const clip = { text: '' };
