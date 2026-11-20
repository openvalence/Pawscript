// project-commands.js -- File menu commands over app.project (project.svelte.js).

import { packProject, packReady, NEEDS_SHELL, PACK_TIP } from './pack.js';
import { cleanTip } from './clean.js';
import { estimateOf, refreshEstimate, cleanProject } from './clean.svelte.js';
import { shown as shownApp } from '../lib/shown.svelte.js';
import { scriptOf } from '../lib/script-of.js';   // paw-x7w7: baked + live
import { guard, whyOf } from './commands.js';

const P = (app) => app.project;
// the tips have no app: the menu is the shown document's (its own estimate, per app)
const est = (app = shownApp.app) => estimateOf(app);
const packTip = () => (est().shell === false ? NEEDS_SHELL : PACK_TIP);
const hasDoc = guard((app) => !!P(app)?.hasDoc, 'Open a video or script first');
const idle = guard((app) => !!P(app) && !P(app).busy, (app) => (!P(app) ? 'Open a video or script first' : 'Wait for the save or load to finish'));
const hasPoints = (app) => Object.values(app.doc.axes).some((s) => s.length) || scriptOf(app, 'stroke').length > 0;   // paw-x7w7: live runs count
// from the home tab: what was opened or imported is shown (a new document shows by itself, app.load; an import into
// the open one does not load)
// the open / import into its own tab already shows (paw-shgb tabs.open); an import into this document from home shows it
const shown = (app) => (ok) => { if (ok && app.tabs?.home && app.tabs.list.some((t) => t.app === app)) app.tabs.show(app.tabId); return ok; };

export default [
  { id: 'file.open', title: 'Open…', keys: ['Ctrl+O'], menu: 'File', group: 'open', when: idle, run: (app) => Promise.resolve(P(app).openDialog()).then(shown(app)) },
  { id: 'file.openRecent', title: 'Open recent file', menu: 'File', group: 'open', hidden: true, when: idle, run: (app, args) => P(app).openRecent(args?.path) },
  { id: 'file.import', title: 'Import funscript…', keys: ['Ctrl+Shift+O'], menu: 'File', group: 'open', when: idle, run: (app) => Promise.resolve(P(app).importDialog()).then(shown(app)) },
  // paw-up1r stage 2: the project is written as it changes; Ctrl+S commits (its dialog lists the changes since the last
  // commit, an optional note), Publish is the only write of the funscripts beside the video. The id stays file.save (bindings).
  { id: 'file.save', title: 'Commit…', keys: ['Ctrl+S'], menu: 'File', group: 'save', when: hasDoc, aliases: ['checkpoint'], tip: 'A named point in the history, with what changed', run: (app) => P(app).askCommit() },
  { id: 'file.publish', title: 'Publish', keys: ['Ctrl+Alt+S'], menu: 'File', group: 'save', when: (app) => idle(app) && hasPoints(app),
    why: (app) => (!P(app) ? 'No document open' : P(app).busy ? 'Busy: wait for the save or load to finish' : 'Nothing to publish yet: no axis has points'), tip: 'Write the funscripts beside the video, as the next version', run: (app) => P(app).publish() },
  { id: 'file.history', title: 'Project history', aliases: ['checkpoints', 'commits', 'versions'], menu: 'File', group: 'save', when: hasDoc, run: (app) => { app.tabs?.show(app.tabId); app.showPanel?.('history.entries'); } },
  { id: 'file.saveAs', title: 'Save project as…', keys: ['Ctrl+Shift+S'], menu: 'File', group: 'save', when: hasDoc, run: (app) => P(app).saveAs() },
  { id: 'file.export', title: 'Export funscripts…', keys: ['Ctrl+E'], menu: 'File', group: 'save', when: (app) => idle(app) && hasPoints(app),
    why: (app) => (!P(app) ? 'No document open' : P(app).busy ? 'Busy: wait for the save or load to finish' : 'Nothing to export yet: no axis has points (track a shot: it plays at once; or place points with 0-9)'), run: (app) => P(app).exportDialog() },
  { id: 'file.revert', title: 'Revert to saved', menu: 'File', group: 'save', when: guard((app) => idle(app) && app.doc.dirty && !!(P(app).path || P(app).base), (app) => whyOf(app, idle) || (app.doc?.dirty ? 'Save the project once first' : 'No changes since it was saved')), run: (app) => P(app).revert() },
  // paw-2k9s / paw-zkvc: share one file, free what is cached. Their tips read the shell's answer (cleanTip / packTip)
  { id: 'file.pack', title: 'Pack project…', menu: 'File', group: 'share', get tip() { return packTip(); }, when: guard((app) => { refreshEstimate(app); return idle(app) && hasDoc(app) && packReady(app); }, (app) => whyOf(app, idle, hasDoc)), why: (app) => (packReady(app) ? '' : NEEDS_SHELL), run: (app) => packProject(app) },
  { id: 'file.clean', title: 'Clean project', menu: 'File', group: 'share', get tip() { return cleanTip(est()); }, when: (app) => { refreshEstimate(app); return idle(app) && !!app.doc.media?.path && !!app.backend.mediaCacheRemoveOf; }, why: (app) => cleanTip(est(app)), run: (app) => cleanProject(app) },
  { id: 'file.cleanRuns', title: 'Clean project and remove tracker runs', menu: 'File', group: 'share', get tip() { return cleanTip(est(), { runs: true }); }, when: (app) => idle(app) && !!app.doc.media?.path && !!app.backend.removeRecoverably, why: (app) => cleanTip(est(app), { runs: true }), run: (app) => cleanProject(app, { runs: true }) },
  // Ctrl+W does nothing while the home tab hides the document (paw-idb5, the owner); the tab's x and File > Close still close it
  { id: 'file.close', title: 'Close', keys: ['Ctrl+W'], menu: 'File', group: 'close', when: guard((app) => idle(app) && hasDoc(app), (app) => whyOf(app, idle, hasDoc)), run: (app) => (app.tabs?.hidden && app.commands.via === 'key' ? undefined : P(app).close()) },
];
