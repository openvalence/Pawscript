// commands.js -- every graph editor action as a Command (ARCHITECTURE: keys only through the registry).
// Graph-internal keys are scoped with `when: focused` (focus is inside the graph panel, ui.svelte.js), so they
// take shared keys only while the graph has focus. Priority is registration order (src/app/boot.js FIRST):
// graph must register ahead of tracking, timeline, review and inspector (and of nav.goto, which has no `when`),
// or their commands take F8 / Shift+F8, Ctrl+G, Shift+A, F2 … while the graph has focus; it registers before
// video, lanes and the core (so it wins lanes' point keys, core undo, …).
// The one global key is Ctrl+Alt+Shift+G (show the graph): Ctrl+Shift+G (DESIGN 8.6) is
// timeline.plan.generate and Ctrl+Alt+G is timeline.plan.generateAll.
// The integration's commands (graph.doc.*: bake range, enable/disable, live, evaluate) are spread in at the end.
import { graphUI } from './ui.svelte.js';
import { peekCtl, ctlOf, integrationCommands } from './deps.js';
import { guard, whyOf } from '../../app/commands.js';

const U = graphUI;
const C = peekCtl;
const graphWhy = (app) => (C(app)?.graph ? 'Click the node graph first' : 'Open the node graph first');
const focused = guard((app) => U(app).focused && !!C(app)?.graph, graphWhy);
const E = (app) => (focused(app) ? U(app).editor : null);
const one = (app) => { const ed = E(app); return ed?.current?.() || U(app).one; };
const hasSel = guard((app) => focused(app) && U(app).sel.size > 0, (app) => whyOf(app, focused) || 'Select nodes first');
const hasOne = guard((app) => focused(app) && !!one(app), (app) => whyOf(app, focused) || 'Select one node first');
const M = { menu: 'Track', group: 'Graph' };
const H = { hidden: true };

function show(app) {
  app.showPanel?.('graph');
  // the editor UI loads on first open (LazyPanel.svelte): wait for the canvas, up to ~2 s
  let tries = 0;
  const focus = () => { const el = document.querySelector('[data-graph-panel] .gview'); if (el) el.focus({ preventScroll: true }); else if (++tries < 40) setTimeout(focus, 50); };
  setTimeout(focus, 30);
}
function problem(app, dir) {
  const ctl = C(app), ui = U(app), list = (ctl?.diags || []).filter((d) => d.node && d.severity !== 'info');
  if (!list.length) { ui.say('no problems'); return; }
  const order = [...list.filter((d) => d.severity === 'error'), ...list.filter((d) => d.severity === 'warn')];
  const at = order.findIndex((d) => d.node === ui.one);
  const d = order[(at + dir + order.length) % order.length] || order[0];
  ui.select([d.node]);
  ui.editor?.revealNode(d.node);
  ui.editor?.focusNode(d.node);
  ui.say(d.message);
}
async function bake(app, all) {
  const ctl = C(app), ui = U(app);
  if (!ctl?.graph) return;
  const sel = all ? [] : [...ui.sel].filter((id) => ctl.graph.nodes.find((n) => n.id === id)?.type === 'out.axis');
  const r = await ctl.bake({ nodes: sel.length ? sel : null });
  if (r?.message) ui.say(r.message);
}
function probeCycle(app) {
  const ctl = C(app), id = one(app);
  if (!ctl || !id) return;
  const n = ctl.graph.nodes.find((x) => x.id === id), outs = ctl.registry.portsOf(n, ctl.graph).outs;
  if (!outs.length) return;
  const cur = ctl.probe?.node === id ? outs.findIndex((p) => p.name === ctl.probe.port) : -1;
  const next = outs[(cur + 1) % outs.length];
  ctl.setProbe(id, next.name);
  U(app).say(`probing ${next.name}`);
}

const editorCommands = [
  { id: 'graph.show', title: 'Graph: show the graph editor', keys: ['Ctrl+Alt+Shift+G'], ...M, run: show },
  // creates the controller on demand (like graph.doc.*): the panel need not have been shown first
  { id: 'graph.new', title: 'Graph: new graph', ...M, run: (app) => { const c = ctlOf(app); if (!c) return; const id = c.newGraph({ name: `Graph ${c.graphs.length + 1}` }); if (id) c.openGraph(id); show(app); } },
  { id: 'graph.add', title: 'Graph: add node (append to the focused node)', keys: ['Shift+A', 'Shift+F10', 'ContextMenu'], ...M, when: focused,
    run: (app) => { const ed = E(app), id = ed?.current?.(); ed?.openPalette(id ? { append: id } : {}); } },
  { id: 'graph.insertBefore', title: 'Graph: insert node before the focused node', keys: ['Ctrl+Shift+A'], when: hasOne, run: (app) => E(app)?.openPalette({ before: one(app) }) },
  { id: 'graph.editParam', title: 'Graph: edit the focused card\'s first parameter', keys: ['Enter'], ...H,
    when: (app) => focused(app) && !!globalThis.document?.activeElement?.dataset?.gid, run: (app) => E(app)?.editCard?.() },
  { id: 'graph.connect', title: 'Graph: connect… (pick a compatible socket)', keys: ['C'], when: hasOne, run: (app) => E(app)?.connectPicker() },
  { id: 'graph.followDown', title: 'Graph: follow wire downstream', keys: ['Alt+ArrowRight'], when: hasOne, ...H, run: (app) => E(app)?.followWire('down') },
  { id: 'graph.followUp', title: 'Graph: follow wire upstream', keys: ['Alt+ArrowLeft'], when: hasOne, ...H, run: (app) => E(app)?.followWire('up') },
  { id: 'graph.siblingPrev', title: 'Graph: previous sibling', keys: ['Alt+ArrowUp'], when: hasOne, ...H, run: (app) => E(app)?.followWire('prev') },
  { id: 'graph.siblingNext', title: 'Graph: next sibling', keys: ['Alt+ArrowDown'], when: hasOne, ...H, run: (app) => E(app)?.followWire('next') },
  ...[['Left', 'left'], ['Right', 'right'], ['Up', 'up'], ['Down', 'down']].flatMap(([k, d]) => {
    const dx = { left: -1, right: 1, up: 0, down: 0 }[d] * 20, dy = { left: 0, right: 0, up: -1, down: 1 }[d] * 20;
    return [
      { id: `graph.move${k}`, title: `Graph: move selection ${d}`, keys: [`Arrow${k}`], when: hasSel, ...H, run: (app) => E(app)?.moveSel(dx, dy) },
      { id: `graph.move${k}Far`, title: `Graph: move selection ${d} ×5`, keys: [`Shift+Arrow${k}`], when: hasSel, ...H, run: (app) => E(app)?.moveSel(dx * 5, dy * 5) },
      { id: `graph.walk${k}`, title: `Graph: go to the node ${d}`, keys: [`Ctrl+Arrow${k}`], when: focused, ...H, run: (app) => E(app)?.walk(d) },
    ];
  }),
  { id: 'graph.delete', title: 'Graph: delete selection', keys: ['Delete', 'Backspace'], when: guard((app) => focused(app) && (U(app).sel.size > 0 || !!U(app).wire), (app) => whyOf(app, focused) || 'Select nodes or a wire first'), run: (app) => E(app)?.remove(false) },
  { id: 'graph.dissolve', title: 'Graph: dissolve (delete, keep the wires through)', keys: ['Ctrl+Delete', 'Ctrl+Backspace'], when: hasSel, run: (app) => E(app)?.remove(true) },
  { id: 'graph.duplicate', title: 'Graph: duplicate', keys: ['Ctrl+D'], when: hasSel, run: (app) => E(app)?.duplicate() },
  { id: 'graph.copy', title: 'Graph: copy nodes', keys: ['Ctrl+C'], when: hasSel, run: (app) => E(app)?.copy() },
  { id: 'graph.cut', title: 'Graph: cut nodes', keys: ['Ctrl+X'], when: hasSel, run: (app) => E(app)?.cut() },
  { id: 'graph.paste', title: 'Graph: paste nodes', keys: ['Ctrl+V'], when: focused, run: (app) => E(app)?.paste() },
  { id: 'graph.selectAll', title: 'Graph: select all', keys: ['Ctrl+A'], when: focused, run: (app) => E(app)?.selectAll() },
  { id: 'graph.mute', title: 'Graph: bypass / mute', keys: ['M'], when: hasSel, run: (app) => E(app)?.toggleMute() },
  { id: 'graph.collapse', title: 'Graph: collapse / expand', keys: ['H'], when: hasSel, run: (app) => E(app)?.toggleCollapse() },
  { id: 'graph.probe', title: 'Graph: probe the node in the timeline', keys: ['P'], when: hasOne, run: (app) => { const c = C(app), id = one(app); c.setProbe(c.probe?.node === id ? null : id); } },
  { id: 'graph.probeCycle', title: 'Graph: probe the next output', keys: ['Shift+P'], when: hasOne, run: probeCycle },
  { id: 'graph.pinA', title: 'Graph: pin as A', keys: ['Alt+A'], when: hasOne, run: (app) => { const c = C(app), id = one(app); c.pin('A', c.pins.A?.node === id ? null : id); } },
  { id: 'graph.pinB', title: 'Graph: pin as B', keys: ['Alt+B'], when: hasOne, run: (app) => { const c = C(app), id = one(app); c.pin('B', c.pins.B?.node === id ? null : id); } },
  { id: 'graph.swapAB', title: 'Graph: swap A and B', keys: ['X'], when: guard((app) => focused(app) && !!(C(app).pins.A || C(app).pins.B), (app) => whyOf(app, focused) || 'Pin a node as A or B first'), run: (app) => C(app).swapPins() },
  { id: 'graph.snapshot', title: 'Graph: snapshot output to a ghost', keys: ['S'], when: hasOne, run: (app) => { const id = C(app).snapshot(one(app)); if (id) U(app).say('snapshot saved as a ghost'); } },
  { id: 'graph.diff', title: 'Graph: show what the node changed', keys: ['D'], when: hasSel, run: (app) => E(app)?.toggleDiff() },
  { id: 'graph.frameSelection', title: 'Graph: frame selection', keys: ['F'], when: focused, run: (app) => E(app)?.frameSelection() },
  { id: 'graph.fit', title: 'Graph: fit all', keys: ['Home'], when: focused, run: (app) => E(app)?.fit() },
  { id: 'graph.nextProblem', title: 'Graph: next problem', keys: ['F8'], when: focused, run: (app) => problem(app, 1) },
  { id: 'graph.prevProblem', title: 'Graph: previous problem', keys: ['Shift+F8'], when: focused, run: (app) => problem(app, -1) },
  { id: 'graph.bake', title: 'Graph: bake selected outputs (all when none)', keys: ['Ctrl+Enter'], ...M, when: focused, run: (app) => bake(app, false) },
  { id: 'graph.bakeAll', title: 'Graph: bake all outputs', keys: ['Ctrl+Shift+Enter'], when: focused, run: (app) => bake(app, true) },
  { id: 'graph.undo', title: 'Graph: undo', keys: ['Ctrl+Z'], ...H, when: (app) => focused(app) && C(app).undoMode === 'local', run: (app) => C(app).undo() },
  { id: 'graph.redo', title: 'Graph: redo', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], ...H, when: (app) => focused(app) && C(app).undoMode === 'local', run: (app) => C(app).redo() },
  { id: 'graph.escape', title: 'Graph: cancel / close / deselect', keys: ['Escape'], ...H, when: (app) => !!E(app)?.escapable?.(), run: (app) => E(app)?.escape() },
  { id: 'graph.group', title: 'Graph: group selection in a frame', keys: ['Ctrl+G'], when: hasSel, run: (app) => E(app)?.group() },
  { id: 'graph.note', title: 'Graph: add a sticky note', keys: ['N'], when: focused, run: (app) => E(app)?.note() },
  { id: 'graph.arrange', title: 'Graph: auto-arrange (selection, or all)', keys: ['Shift+L'], when: focused, run: (app) => E(app)?.arrange() },
  ...[['Left', 'left'], ['Right', 'right'], ['Top', 'top'], ['Bottom', 'bottom'], ['CentreH', 'hcenter'], ['CentreV', 'vcenter']].map(([k, m]) => (
    { id: `graph.align${k}`, title: `Graph: align ${m === 'hcenter' ? 'centres horizontally' : m === 'vcenter' ? 'centres vertically' : m + ' edges'}`, when: guard((app) => hasSel(app) && U(app).sel.size > 1, (app) => whyOf(app, hasSel) || 'Select two or more nodes first'), run: (app) => E(app)?.align(m) })),
  { id: 'graph.distributeH', title: 'Graph: distribute horizontally', when: guard((app) => hasSel(app) && U(app).sel.size > 2, (app) => whyOf(app, hasSel) || 'Select three or more nodes first'), run: (app) => E(app)?.distribute('x') },
  { id: 'graph.distributeV', title: 'Graph: distribute vertically', when: guard((app) => hasSel(app) && U(app).sel.size > 2, (app) => whyOf(app, hasSel) || 'Select three or more nodes first'), run: (app) => E(app)?.distribute('y') },
  { id: 'graph.savePreset', title: 'Graph: save selection as preset…', when: hasSel, run: (app) => E(app)?.savePreset() },
  { id: 'graph.inspector', title: 'Graph: show / hide the inspector', keys: ['Ctrl+I'], when: focused, run: (app) => U(app).setInspector(!U(app).inspector) },
  { id: 'graph.maximise', title: 'Graph: maximize / restore the panel', keys: ['Ctrl+Shift+M'], when: guard((app) => !!C(app)?.graph && (U(app).focused || U(app).maximised), graphWhy), run: (app) => { U(app).maximised = !U(app).maximised; } },
  { id: 'graph.rename', title: 'Graph: rename the node', keys: ['F2'], when: hasOne, run: (app) => { U(app).setInspector(true); setTimeout(() => document.querySelector('[data-graph-panel] .gins-name')?.focus()); } },
];

export default [...editorCommands, ...integrationCommands];
