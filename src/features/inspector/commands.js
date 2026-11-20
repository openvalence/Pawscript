// Inspector commands. Every tool is `tool.<opId>` (open it in the panel) and `tool.<opId>.apply` (apply with the
// remembered parameters). Quick actions are `quick.<id>`. Keys are Alt-based so they never meet the outline's
// shortcut map (Space, arrows, , . 0-9 Q Del Ctrl+Z/Y L T M, copy/paste) which the lanes/transport own.
import { OPS } from './catalog.js';
import { inspector as insp, DEFAULT_QUICK } from './state.svelte.js';
import { DIALOGS, moveSelectionToPlayhead, rangeFromSelection } from './dialogs.js';
import { selectRange, pasteSnippet } from './actions.js';
import { yielded } from './logic.js';
import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live
import { guard } from '../../app/commands.js';

const I = (app) => insp.init(app);
const hasSel = guard((app) => app.doc.selection?.axis === app.doc.activeAxis && app.doc.selection.ats.size > 0, 'Select points first');
const PANELS =[['selection', 'Points', 'Alt+D'], ['tools', 'Transform tools', 'Alt+T'], ['quick', 'Quick actions', ''], ['snippets', 'Snippets', 'Alt+N'], ['history', 'History', 'Alt+H']];

const toolCmds = OPS.flatMap((op) => [
  { id: `tool.${op.id}`, title: `Transform: ${op.title}`, menu: 'Edit', group: 'Transform tools', run: (app) => { I(app).open(op.id); } },
  { id: `tool.${op.id}.apply`, title: `Apply ${op.title} (remembered settings)`, menu: 'Edit', group: 'Transform tools', run: (app) => { I(app).run(op, insp.paramsFor(op)); } },
]);

const quickCmds = DEFAULT_QUICK.map((q) => ({
  id: `quick.${q.id}`, title: `Quick: ${q.label}`, keys: q.keys, menu: 'Edit', group: 'Quick actions',
  run: (app) => { const i = I(app); i.runQuick(i.quick.find((x) => x.id === q.id) ?? q); },
}));

export default [
  ...quickCmds,
  { id: 'quick.run', title: 'Run quick action by id', hidden: true, run: (app, a) => { const i = I(app), q = i.quick.find((x) => x.id === a?.id); if (q) i.runQuick(q); } },
  { id: 'tool.repeat', title: 'Repeat last transform', keys: ['Alt+R'], menu: 'Edit', group: 'Transform tools', run: (app) => { I(app).repeatLast(); } },
  ...toolCmds,

  ...PANELS.map(([id, title, key]) => ({
    id: `inspector.toggle.${id}`, title: `Toggle ${title} panel`, keys: key ? [key] : [], menu: 'View',
    run: (app) => { if (app.togglePanel) app.togglePanel(`inspector.${id}`); else app.toast?.('Panel toggling is not available in this shell', 'warn'); },
  })),

  // Ctrl+G is broad, but the inspector registers before graph/video: yield the key while a later contextual
  // command on it is enabled (graph.group with the graph focused), else nothing after us could ever run it.
  { id: 'nav.goto', title: 'Go to time or frame…', keys: ['Ctrl+G'], menu: 'View', group: 'Navigate', when: guard((app) => !yielded(app, 'nav.goto'), (app) => { const c = app.commands, k = c?.keysFor?.('nav.goto')?.find((x) => c.winner?.(x, ['nav.goto'])), w = k && c.winner(k, ['nav.goto']); return w ? `${k} goes to ${c.get?.(w)?.title || 'another command'} here` : 'Its key goes to another command here'; }), run: (app) => DIALOGS.goto(app) },
  { id: 'range.set', title: 'Set range start / end…', menu: 'Edit', group: 'Range', run: (app) => DIALOGS.range(app) },
  { id: 'range.fromSelection', title: 'Range from selection', menu: 'Edit', group: 'Range', when: hasSel, run: (app) => rangeFromSelection(app) },
  { id: 'range.selectPoints', title: 'Select points in range', menu: 'Edit', group: 'Range', when: guard((app) => !!app.doc.range, 'Set a range first (I / O)'), run: (app) => { app.toast?.(`${selectRange(app)} points selected`, 'quiet'); } },
  { id: 'selection.setPos', title: 'Set position of selection…', menu: 'Edit', group: 'Selection', run: (app) => DIALOGS.setPos(app) },
  { id: 'selection.shift', title: 'Shift selection in time…', menu: 'Edit', group: 'Selection', run: (app) => DIALOGS.shift(app) },
  { id: 'selection.toPlayhead', title: 'Move selection to playhead', keys: ['Alt+P'], menu: 'Edit', group: 'Selection', when: hasSel, run: (app) => moveSelectionToPlayhead(app) },

  { id: 'snippet.saveSelection', title: 'Save selection as snippet', keys: ['Alt+K'], menu: 'Edit', group: 'Snippets', when: guard((app) => hasSel(app) || !!app.doc.range, 'Select points or set a range first'),
    run: (app) => {
      const i = I(app), d = app.doc, script = scriptOf(app, d.activeAxis);
      const acts = hasSel(app) ? script.filter((a) => d.selection.ats.has(a.at)) : script.filter((a) => a.at >= d.range.t0 && a.at <= d.range.t1);
      const s = i.addSnippet(acts, `Snippet ${i.snippets.length + 1}`);
      app.toast?.(s ? `Saved "${s.name}"` : 'Nothing to save', s ? 'ok' : 'warn');
    } },
  { id: 'snippet.pasteLatest', title: 'Paste latest snippet at playhead', keys: ['Alt+V'], menu: 'Edit', group: 'Snippets',
    run: (app) => { const s = I(app).snippets[0]; if (s) pasteSnippet(app, s); else app.toast?.('No snippets saved yet', 'info'); } },

  { id: 'history.clear', title: 'Clear undo history…', menu: 'Edit', group: 'History',
    run: async (app) => { if (app.history.entries.length && await app.confirm({ title: 'Clear undo history?', message: 'The script stays as it is now.', ok: 'Clear history', danger: true })) app.history.reset(); } },
];
