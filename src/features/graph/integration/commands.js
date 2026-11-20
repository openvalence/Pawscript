// commands.js -- the integration's commands: bake, bake range, bake and disable, enable/disable, evaluate now,
// live previews. The shell only discovers features/graph/commands.js (the editor's), which spreads these in
// (`import { integrationCommands } from './integration.js'`). Ids are under `graph.doc.*` so they cannot
// collide with the editor's own `graph.*` commands. No default keys: the editor owns the graph key map.

import { graphController, peekGraphController } from './controller.svelte.js';
import { guard, whyOf } from '../../../app/commands.js';

const ctl = (app) => { try { return graphController(app); } catch (e) { app.toast?.(String(e.message || e), 'error'); return null; } };
const hasGraph = guard((app) => !!peekGraphController(app)?.graph, 'Open the node graph first');
const enabled = guard((app) => !!peekGraphController(app)?.enabled, (app) => whyOf(app, hasGraph) || 'Enable the graph first');
const M = { menu: 'Track', group: 'Graph' };

async function bake(app, opts) {
  const c = ctl(app);
  if (!c) return;
  if (!c.graph) { app.toast?.('No graph to bake', 'warn'); return; }
  return c.bake(opts);
}

export const integrationCommands = [
  { id: 'graph.doc.bake', title: 'Graph: Bake all outputs', ...M, when: hasGraph,
    run: (app, args) => bake(app, { nodes: args?.nodes ?? null }) },
  { id: 'graph.doc.bakeRange', title: 'Graph: Bake outputs inside the range (I/O)', ...M,
    when: guard((app) => hasGraph(app) && !!app.doc.range, (app) => whyOf(app, hasGraph) || 'Set a range first (I / O)'),
    run: (app, args) => {
      const r = app.doc.range;
      if (!r) { app.toast?.('Set a range first (I and O)', 'warn'); return; }
      return bake(app, { nodes: args?.nodes ?? null, range: { t0: Math.min(r.t0, r.t1), t1: Math.max(r.t0, r.t1) } });
    } },
  { id: 'graph.doc.bakeDisable', title: 'Graph: Bake and disable', ...M, when: enabled,
    run: (app, args) => bake(app, { nodes: args?.nodes ?? null, disable: true }) },
  { id: 'graph.doc.enable', title: 'Graph: Enable (evaluate and preview)', ...M,
    when: guard((app) => hasGraph(app) && !enabled(app), (app) => whyOf(app, hasGraph) || 'The graph is already enabled'), run: (app) => ctl(app)?.setEnabled(undefined, true) },
  { id: 'graph.doc.disable', title: 'Graph: Disable (stop evaluating, remove previews)', ...M,
    when: enabled, run: (app) => ctl(app)?.setEnabled(undefined, false) },
  { id: 'graph.doc.toggleEnabled', title: 'Graph: Toggle enabled', ...M, when: hasGraph, hidden: true,
    run: (app) => { const c = ctl(app); c?.setEnabled(undefined, !c.enabled); } },
  { id: 'graph.doc.evaluate', title: 'Graph: Evaluate now', ...M, when: enabled,
    run: async (app) => {
      const c = ctl(app), r = await c?.evaluateNow();
      if (!r) return;
      const errs = c.diags.filter((d) => d.severity === 'error');
      if (errs.length) c.notify(`Graph has ${errs.length} problem${errs.length > 1 ? 's' : ''}: ${errs[0].message}`, 'warn');
      else c.notify(`Graph evaluated in ${Math.round(r.ms)} ms`, 'quiet');
    } },
  { id: 'graph.doc.live', title: 'Graph: Live preview ghosts on/off', ...M, when: hasGraph,
    run: (app) => { const c = ctl(app); c?.setLive(!c.live); app.toast?.(`Graph previews ${c?.live ? 'on' : 'off'}`, 'quiet'); } },
  { id: 'graph.doc.clearSnapshots', title: 'Graph: Clear snapshots', ...M,
    when: guard((app) => !!peekGraphController(app)?.snapshots.length, 'Snapshot a node first'), run: (app) => ctl(app)?.clearSnapshots() },
];
