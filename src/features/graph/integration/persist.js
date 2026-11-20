// persist.js -- what the shell's project code calls so graphs ride in the .pawproj (block key `graphs`,
// value { v: 1, items: Graph[] }, lib/io getBlock/setBlock) and graph preview ghosts never get saved.
// Pure. pd = the lib/io project doc shape (projectDoc / appDocFrom in src/app/project-logic.js).
//
//   projectDoc:  pd = graphsToProject(pd, d.graphs); pd.ghosts = withoutGraphGhosts(pd.ghosts)
//   appDocFrom:  const { graphs, extra, diags } = graphsFromProject(pd, registry)   (extra = pd.extra minus the block)

import { serializeGraphs, parseGraphs } from '../../../lib/graph/serialize.js';
import { getBlock, setBlock } from '../../../lib/io/project.js';
import { GRAPH_GHOST } from '../../../lib/graph/doc.js';

export const GRAPHS_BLOCK = 'graphs';

/** pd with the graphs block set (removed when there are no graphs). */
export const graphsToProject = (pd, graphs) => setBlock(pd, GRAPHS_BLOCK, graphs?.length ? serializeGraphs(graphs) : undefined);

/**
 * -> { graphs, extra (pd.extra without the block), diags }. Never throws for a malformed block (diags say why).
 * Without `reg` the graphs are returned raw (the controller parses graphs it did not make when it sees them).
 */
export function graphsFromProject(pd, reg = null) {
  const block = getBlock(pd, GRAPHS_BLOCK, null);
  const { [GRAPHS_BLOCK]: _drop, ...extra } = pd?.extra || {};
  if (!reg) return { graphs: Array.isArray(block?.items) ? block.items : [], extra, diags: [] };
  try {
    const { graphs, diags } = parseGraphs(block, reg);
    return { graphs, extra, diags };
  } catch (e) {
    // keep the unreadable block in extra so saving does not destroy it
    return { graphs: [], extra: pd?.extra || {}, diags: [{ id: 'note@graphs', severity: 'error', code: 'note', message: 'graphs block unreadable: ' + (e?.message || e) }] };
  }
}

/** Ghosts minus the graph's live previews (they are recomputed; saving them would only bloat the file). */
export const withoutGraphGhosts = (ghosts) => (ghosts || []).filter((g) => g?.source?.kind !== GRAPH_GHOST);
