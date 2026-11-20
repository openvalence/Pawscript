// commands.js -- the director (menu Track, contract README §9.3). director.run runs draft in director mode (all pending
// steps, or from args.from); the others act on the decisions. redecide / answer take args, so they are hidden (the panel
// and CDP use them).
import { directorFor, peekDirector } from './director.svelte.js';
import { guard } from '../../app/commands.js';

async function exportTrace(app, to = 'file') {
  const { json, md } = directorFor(app).exportTrace();
  if (to === 'clipboard') { await navigator.clipboard?.writeText(md); app.toast('Director trace copied (markdown)', 'ok'); return; }
  const v = app.doc.media?.path || '', dir = v.replace(/[\\/][^\\/]*$/, ''), sep = v.includes('\\') ? '\\' : '/';
  const path = await app.backend.saveDialog({ title: 'Export the director trace', defaultPath: (dir ? dir + sep : '') + 'DIRECTOR-TRACE.json', filters: [{ name: 'Trace JSON', extensions: ['json'] }] });
  if (!path) return;
  try {
    await app.backend.writeText(path, JSON.stringify(json, null, 1));
    await app.backend.writeText(path.replace(/\.json$/i, '') + '.md', md);
    app.toast('Director trace exported: ' + path.split(/[\\/]/).pop() + ' (+ .md)', 'ok');
  } catch (e) { app.toast('Export failed: ' + (e?.message || e), 'error'); }
}

export default [
  { id: 'director.run', title: 'Run the automated director', keys: ['Ctrl+Alt+Shift+D'], menu: 'Track', group: 'director', when: guard((app) => !!app.doc.media, 'Open a video first'),
    run: (app, args) => { app.showPanel?.('director'); directorFor(app).run(args || {}); } },
  { id: 'director.show', title: 'Director: show the decisions', menu: 'Track', group: 'director', run: (app) => { directorFor(app); app.showPanel?.('director'); } },
  { id: 'director.cancel', title: 'Director: cancel', menu: 'Track', group: 'director', when: guard((app) => !!peekDirector(app)?.running, 'The director is not running'), run: (app) => peekDirector(app)?.cancel() },
  { id: 'director.redecide', title: 'Director: re-decide', hidden: true, when: (app) => !!peekDirector(app), run: (app, a) => a?.id && directorFor(app).redecide(a.id, { brain: a.brain }) },
  { id: 'director.answer', title: 'Director: answer a question', hidden: true, when: (app) => !!peekDirector(app),
    run: (app, a) => { const e = a?.id ? directorFor(app).answer(a.id, a.value) : 'no id'; if (e) app.toast('Answer not taken: ' + e, 'warn'); return e; } },
  { id: 'director.exportTrace', title: 'Director: export the trace', menu: 'Track', group: 'director', when: guard((app) => !!peekDirector(app)?.list.length, 'Run the director first'), run: (app, a) => exportTrace(app, a?.to) },
  { id: 'director.setPreset', title: 'Director: choose the brains', hidden: true, run: (app, a) => { if (a?.preset) directorFor(app).setSettings({ preset: a.preset }); } },
];
